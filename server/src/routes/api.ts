import { Router } from 'express';
import { z } from 'zod';
import type { CopilotSession, MCPServerConfig } from '@github/copilot-sdk';
import {
  sessionService,
  assertValidSessionId,
  ownerFromHeaders,
} from '../services/session-service.js';
import {
  executionStore,
  type LlmUsageSample,
} from '../execution/index.js';
import { listProviderStatus } from '../providers/index.js';
import {
  listMcp,
  getMcpServerConfig,
  testMcpServer,
  assertSafeOutboundUrl,
} from '../mcp/registry.js';
import { listHooks } from '../hooks/registry.js';
import { config } from '../config.js';

export const apiRouter = Router();

/**
 * 管理接口保护：COPILOT_ADMIN_TOKEN 留空=本地开发不设防；
 * 生产一旦设置，/api/debug 与 /api/hooks 必须带 x-admin-token 头（或由 ingress 统一鉴权）。
 */
function requireAdmin(
  req: import('express').Request,
  res: import('express').Response,
  next: import('express').NextFunction,
) {
  if (!config.adminToken) return next();
  if (req.header('x-admin-token') === config.adminToken) return next();
  return res.status(401).json({ error: 'unauthorized（管理接口需 x-admin-token）' });
}

const SESSION_ID_HINT = '须字母数字开头，仅含字母/数字/-/_，最长 128 字符（推荐 user-xxx-task-yyy）';
const sessionIdSchema = z
  .string()
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9-_]{0,127}$/, `sessionId 非法，${SESSION_ID_HINT}`);

const customAgentSchema = z.object({
  name: z.string().min(1),
  prompt: z.string().min(1, 'agent prompt 不能为空'),
  displayName: z.string().optional(),
  description: z.string().optional(),
  tools: z.array(z.string()).nullable().optional(),
  infer: z.boolean().optional(),
  skills: z.array(z.string()).optional(),
  model: z.string().optional(),
});

const mcpLocalSchema = z.object({
  type: z.enum(['local', 'stdio']).optional(),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  cwd: z.string().optional(),
  workingDirectory: z.string().optional(),
  tools: z.array(z.string()).optional(),
  timeout: z.number().positive().optional(),
});

const mcpHttpSchema = z.object({
  type: z.enum(['http', 'sse']),
  url: z.string().url('mcp http server 必须带合法 url'),
  headers: z.record(z.string(), z.string()).optional(),
  tools: z.array(z.string()).optional(),
  timeout: z.number().positive().optional(),
});

const mcpServerSchema = z.union([mcpLocalSchema, mcpHttpSchema]);

const sessionConfigSchema = z.object({
  model: z.string().optional(),
  systemMessage: z.string().optional(),
  agents: z.array(z.string()).optional(),
  customAgents: z.array(customAgentSchema).optional(),
  agent: z.string().optional(),
  skillDirs: z.array(z.string()).optional(),
  disabledSkills: z.array(z.string()).optional(),
  noBuiltinSkills: z.boolean().optional().default(false),
  defaultAgentExcludedTools: z.array(z.string()).optional(),
  mcp: z.array(z.string()).optional(),
  mcpServers: z.record(z.string(), mcpServerSchema).optional(),
  disabledMcpServers: z.array(z.string()).optional(),
  hooks: z.array(z.string()).optional(),
  sessionContext: z.string().max(4000, 'sessionContext 最长 4000 字符').optional(),
  agentStopChecklist: z.string().max(2000, 'agentStopChecklist 最长 2000 字符').optional(),
});

const createSessionSchema = sessionConfigSchema.extend({
  sessionId: sessionIdSchema.optional(),
});

/** 内联 MCP 里 cwd 是 workingDirectory 的别名，统一映射成 SDK 字段 */
function normalizeInlineMcp(
  input: z.infer<typeof sessionConfigSchema>['mcpServers'],
): Record<string, MCPServerConfig> | undefined {
  if (!input) return undefined;
  const out: Record<string, MCPServerConfig> = {};
  for (const [name, cfg] of Object.entries(input)) {
    if ('url' in cfg) {
      const { cwd: _drop, ...rest } = cfg as Record<string, unknown>;
      out[name] = rest as unknown as MCPServerConfig;
    } else {
      const { cwd, workingDirectory, ...rest } = cfg;
      out[name] = {
        ...(rest as object),
        ...((cwd ?? workingDirectory) ? { workingDirectory: (cwd ?? workingDirectory) as string } : {}),
      } as MCPServerConfig;
    }
  }
  return out;
}

const chatSchema = z.object({
  prompt: z.string().min(1, 'prompt 不能为空'),
  streaming: z.boolean().optional().default(false),
  model: z.string().optional(),
});

/**
 * usage 事件流入当前 execution 的累加器（execution-local，并发 turn 不串数据）。
 * assistant.usage = 每次 LLM 调用的 token/耗时；session.usage_info = 上下文窗口水位。
 */
function attachUsageListener(session: CopilotSession, executionId: string): () => void {
  const offUsage = session.on('assistant.usage', (evt) => {
    const data = (evt as unknown as { data?: LlmUsageSample }).data;
    if (data) executionStore.addUsage(executionId, data);
  });
  const offInfo = session.on('session.usage_info', (evt) => {
    const data = (evt as unknown as { data?: { tokenLimit?: number } }).data;
    executionStore.setContextWindow(executionId, data?.tokenLimit);
  });
  return () => {
    offUsage();
    offInfo();
  };
}

/** GET /api/providers — 通道列表与当前生效项（是否配好 key 一目了然） */
apiRouter.get('/providers', (_req, res) => {
  res.json({ providers: listProviderStatus() });
});

/** GET /api/models — 前端模型选择器用（附带当前 provider id） */
apiRouter.get('/models', async (_req, res, next) => {
  try {
    res.json(await sessionService.listModels());
  } catch (err) {
    next(err);
  }
});

/** GET /api/agents — agent 预设、技能目录与可发现的技能（前端建会话表单用） */
apiRouter.get('/agents', (_req, res) => {
  res.json(sessionService.listAgents());
});

/** GET /api/mcp — MCP 预设与内联开关（只含元信息，密钥字段永不返回） */
apiRouter.get('/mcp', (_req, res) => {
  res.json(listMcp());
});

const mcpTestSchema = z
  .object({
    /** 预设名（与 server 二选一） */
    name: z.string().optional(),
    /** 内联自定义 server（与 name 二选一；local 同样受内联安全门约束） */
    server: mcpServerSchema.optional(),
  })
  .refine((v) => (v.name ? !v.server : !!v.server), {
    message: 'name 与 server 二选一、必传其一',
  });

/**
 * POST /api/mcp/test — MCP 连通性自检（不建会话、不执行命令）。
 * local 验证可执行文件是否存在；http 发一次 8s 超时 GET，任何 HTTP 响应即算可达。
 */
apiRouter.post('/mcp/test', async (req, res, next) => {
  try {
    const body = mcpTestSchema.parse(req.body ?? {});
    if (body.name) {
      const cfg = getMcpServerConfig(body.name);
      return res.json({ name: body.name, ...(await testMcpServer(cfg)) });
    }
    const serverCfg = body.server;
    if (!serverCfg) return res.status(400).json({ error: 'server 与 name 必传其一' });
    const normalized = normalizeInlineMcp({ tmp: serverCfg });
    const cfg = normalized?.tmp;
    if (!cfg) return res.status(400).json({ error: 'server 解析失败' });
    const t = cfg.type ?? 'local';
    if ((t === 'local' || t === 'stdio') && !config.allowInlineMcpLocal) {
      return res.status(400).json({
        error:
          '内联 local MCP 测试被拒绝：在服务器执行任意命令风险高，如确需开放请设 COPILOT_ALLOW_INLINE_MCP_LOCAL=true',
      });
    }
    if ((t === 'http' || t === 'sse') && !config.allowInlineMcpHttp) {
      return res.status(400).json({
        error:
          '内联 http MCP 测试被拒绝：服务端已关闭（生产请用运维预置的 COPILOT_MCP_SERVERS）',
      });
    }
    if ((t === 'http' || t === 'sse') && 'url' in cfg && typeof cfg.url === 'string') {
      try {
        await assertSafeOutboundUrl(cfg.url);
      } catch (e) {
        return res.status(400).json({
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    return res.json({ name: null, ...(await testMcpServer(cfg)) });
  } catch (err) {
    return next(err);
  }
});

/** GET /api/debug — 诊断包（版本/平台/脱敏配置/runtime 状态/会话计数；按需启动 runtime） */
apiRouter.get('/debug', requireAdmin, async (_req, res, next) => {
  try {
    res.json(await sessionService.getDebugInfo());
  } catch (err) {
    next(err);
  }
});

/** GET /api/hooks — hook 预设与最近 hook 事件（审计；事件环纯内存，重启清空） */
apiRouter.get('/hooks', requireAdmin, (req, res) => {
  const limit = Math.max(1, Math.min(200, Number(req.query.limit ?? 50) || 50));
  res.json(listHooks(limit));
});

/** POST /api/sessions — 创建 Copilot 会话（可挂 agents/skills/mcp；传 sessionId 即为可恢复会话） */
apiRouter.post('/sessions', async (req, res, next) => {
  try {
    const body = createSessionSchema.parse(req.body ?? {});
    const { mcpServers, ...rest } = body;
    const session = await sessionService.createSession(
      {
        ...rest,
        mcpServers: normalizeInlineMcp(mcpServers),
      },
      ownerFromHeaders(req.headers),
    );
    res.status(201).json({
      sessionId: session.sessionId,
      workspacePath: sessionService.getSessionOwner(session.sessionId)?.workspacePath,
    });
  } catch (err) {
    if (err instanceof Error && /无权访问/.test(err.message)) {
      return res.status(403).json({ error: err.message });
    }
    next(err);
  }
});

/** GET /api/sessions — 当前调用方的会话（按 Session Registry 归属过滤，不再返回全量） */
apiRouter.get('/sessions', async (req, res, next) => {
  try {
    const owner = ownerFromHeaders(req.headers);
    res.json({ sessions: await sessionService.listSessions(owner) });
  } catch (err) {
    next(err);
  }
});

/** GET /api/sessions/:id — 单个会话元信息（含 attached 标记） */
apiRouter.get('/sessions/:id', async (req, res, next) => {
  try {
    assertValidSessionId(req.params.id);
    const owner = ownerFromHeaders(req.headers);
    const meta = await sessionService.getSessionMeta(req.params.id, owner);
    if (!meta) return res.status(404).json({ error: `session 不存在："${req.params.id}"` });
    return res.json(meta);
  } catch (err) {
    if (err instanceof Error && /无权访问/.test(err.message)) {
      return res.status(403).json({ error: err.message });
    }
    return next(err);
  }
});

/**
 * POST /api/sessions/:id/resume — 恢复磁盘会话（服务重启/换实例后继续）。
 * 可附带重配（model/agents/skills/mcp…）；BYOK 凭证由服务端当前通道自动重传，无需调用方操心。
 * 已附着在本进程时直接复用（避免同一会话双附着）。
 */
apiRouter.post('/sessions/:id/resume', async (req, res, next) => {
  try {
    assertValidSessionId(req.params.id);
    const body = sessionConfigSchema.parse(req.body ?? {});
    const { mcpServers, ...rest } = body;
    const session = await sessionService.resumeSession(
      req.params.id,
      {
        ...rest,
        mcpServers: normalizeInlineMcp(mcpServers),
      },
      ownerFromHeaders(req.headers),
    );
    res.json({ sessionId: session.sessionId, resumed: true });
  } catch (err) {
    if (err instanceof Error && /无权访问/.test(err.message)) {
      return res.status(403).json({ error: err.message });
    }
    if (err instanceof Error && /无法恢复/.test(err.message)) {
      return res.status(404).json({ error: err.message });
    }
    return next(err);
  }
});

/**
 * DELETE /api/sessions/:id — 默认断开内存附着（保留磁盘数据，仍可 resume）。
 * ?permanent=true → 彻底删除磁盘数据，不可恢复。
 */
apiRouter.delete('/sessions/:id', async (req, res, next) => {
  try {
    assertValidSessionId(req.params.id);
    const owner = ownerFromHeaders(req.headers);
    if (req.query.permanent === 'true') {
      await sessionService.deleteSessionPermanently(req.params.id, owner);
      return res.json({ sessionId: req.params.id, deleted: true });
    }
    const wasAttached = await sessionService.disconnectSession(req.params.id, owner);
    return res.json({ sessionId: req.params.id, detached: wasAttached, resumable: true });
  } catch (err) {
    if (err instanceof Error && /无权访问/.test(err.message)) {
      return res.status(403).json({ error: err.message });
    }
    if (err instanceof Error && /无法删除/.test(err.message)) {
      return res.status(404).json({ error: err.message });
    }
    return next(err);
  }
});

/**
 * POST /api/sessions/:id/chat
 * - { streaming: false } → 等待完成，一次性返回 { sessionId, executionId, content, usage }
 * - { streaming: true }  → SSE：event: execution / delta / message / subagent / done / error
 *   （subagent.* 为 custom agent 生命周期事件，原样透传，含 agentId/agentName 等）
 *
 * 每次请求 = 一个 execution（session 与 execution 是两层：审计/usage/工具证据/取消
 * 全部挂在 executionId 上，不挂 sessionId）。
 */
apiRouter.post('/sessions/:id/chat', async (req, res, next) => {
  /** SSE 已开流后的错误收尾（写 error 帧 + 停心跳 + 摘监听），由下面 SSE 分支赋值 */
  let sseFail: ((err: unknown) => void) | null = null;
  /** execution 终态兜底：任何路径出错/取消都在这里落 failed/cancelled */
  let executionId: string | null = null;
  try {
    const body = chatSchema.parse(req.body ?? {});
    const owner = ownerFromHeaders(req.headers);
    let session;
    try {
      // 内存未附着时尝试从 runtime 磁盘状态恢复（重启/换 Pod 后不断连；失败才 404）
      session = await sessionService.getOrResumeSession(req.params.id, {}, owner);
    } catch (err) {
      if (err instanceof Error && /无权访问/.test(err.message)) {
        return res.status(403).json({ error: err.message });
      }
      if (err instanceof Error && /无法恢复/.test(err.message)) {
        return res.status(404).json({ error: 'session not found, 请先 POST /api/sessions' });
      }
      throw err;
    }
    void sessionService.touch(session.sessionId);

    const execution = executionStore.start({
      sessionId: session.sessionId,
      owner,
      prompt: body.prompt,
      model: body.model,
      streaming: !!body.streaming,
    });
    executionId = execution.executionId;

    if (!body.streaming) {
      try {
        const content = await sessionService.withSessionLock(session.sessionId, async () => {
          executionStore.setActive(session.sessionId, execution.executionId);
          const offUsage = attachUsageListener(session, execution.executionId);
          try {
            if (body.model) {
              await session.setModel(body.model);
            }
            const finalEvent = await session.sendAndWait({ prompt: body.prompt });
            return (
              // sendAndWait 返回 AssistantMessageEvent | undefined
              (finalEvent as unknown as { data?: { content?: string } } | undefined)?.data
                ?.content ?? ''
            );
          } finally {
            offUsage();
            executionStore.clearActive(session.sessionId, execution.executionId);
          }
        });
        executionStore.finish(execution.executionId, {
          status: 'completed',
          contentChars: content.length,
        });
        return res.json({
          sessionId: session.sessionId,
          executionId: execution.executionId,
          content,
          usage: executionStore.get(execution.executionId)?.usage,
        });
      } catch (err) {
        executionStore.finish(execution.executionId, {
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
    }

    // ---- SSE 流式 ----
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // 首个帧就把 executionId 给客户端：之后 tool 证据/usage/报错都能按它对齐
    send('execution', { executionId: execution.executionId, sessionId: session.sessionId });

    // Ingress/ALB 空闲超时保护：长推理无输出时保活
    const heartbeat = setInterval(() => {
      if (!res.writableEnded) {
        res.write(': heartbeat\n\n');
      }
    }, 15000);

    let finished = false;
    let turnRunning = false;
    let chars = 0;
    let offs: Array<() => void> = [];
    /** execution 终态（幂等：非 running 时 store 不再改） */
    const settle = (
      status: 'completed' | 'failed' | 'cancelled',
      extra: { error?: string; contentChars?: number } = {},
    ) => executionStore.finish(execution.executionId, { status, ...extra });
    sseFail = (err) => {
      const message = err instanceof Error ? err.message : String(err);
      settle('failed', { error: message });
      finish('error', { error: message });
    };

    const finish = (event: 'done' | 'error', data: unknown) => {
      if (finished) return;
      finished = true;
      clearInterval(heartbeat);
      for (const off of offs) off();
      offs = [];
      sessionService.markTurnIdle(session.sessionId);
      if (!res.writableEnded) {
        send(event, data);
        res.end();
      }
    };

    // 客户端断开 = 中止当前 turn（server agent 无人看输出，继续跑只会白烧 token 并改文件）。
    // 注意是 abort 当前 turn，不是断开 session：之后还能继续对话。
    req.on('close', () => {
      if (turnRunning && !finished) {
        settle('cancelled');
        void sessionService.abortTurn(session.sessionId).catch(() => undefined);
      }
      finished = true; // 客户端已走，后面的写一律跳过
      turnRunning = false;
      clearInterval(heartbeat);
      for (const off of offs) off();
      offs = [];
    });

    /**
     * 锁必须覆盖整个 agent turn：session.send() 只是把消息排进队列就返回，
     * 真正的 loop 仍在后台跑（sendAndWait() 才等到 session.idle）。
     * 监听器也必须在锁内注册，否则并发请求会互相收到对方的 delta。
     */
    await sessionService.withSessionLock(session.sessionId, async () => {
      const offDelta = session.on('assistant.message_delta', (evt) => {
        const delta = (evt as unknown as { data?: { deltaContent?: string } }).data
          ?.deltaContent;
        if (delta) {
          chars += delta.length;
          send('delta', { delta });
        }
      });
      const offMsg = session.on('assistant.message', (evt) => {
        const content = (evt as unknown as { data?: { content?: string } }).data?.content;
        if (content) send('message', { content });
      });
      // sub-agent 生命周期事件透传（selected/started/completed/failed/deselected）
      const offAll = session.on((evt) => {
        const t = (evt as unknown as { type?: string }).type;
        if (typeof t === 'string' && t.startsWith('subagent.')) send('subagent', evt);
      });
      const offIdle = session.on('session.idle', () => {
        settle('completed', { contentChars: chars });
        finish('done', {
          sessionId: session.sessionId,
          executionId: execution.executionId,
          usage: executionStore.get(execution.executionId)?.usage,
        });
      });
      offs = [offDelta, offMsg, offAll, offIdle, attachUsageListener(session, execution.executionId)];

      turnRunning = true;
      sessionService.markTurnActive(session.sessionId);
      executionStore.setActive(session.sessionId, execution.executionId);
      try {
        if (body.model) {
          await session.setModel(body.model);
        }
        await session.sendAndWait({ prompt: body.prompt });
      } finally {
        turnRunning = false;
        executionStore.clearActive(session.sessionId, execution.executionId);
        for (const off of offs) off();
        offs = [];
      }
    });
    // sendAndWait 已等到 idle；idle 监听若未触发（少见）在这里兜底收尾
    settle('completed', { contentChars: chars });
    finish('done', {
      sessionId: session.sessionId,
      executionId: execution.executionId,
      usage: executionStore.get(execution.executionId)?.usage,
    });
    return undefined;
  } catch (err) {
    // 未开流的错误：execution 落 failed（SSE 分支由 sseFail 统一收尾）
    if (executionId) {
      executionStore.finish(executionId, {
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      });
    }
    // SSE 已开始写头时不能再 next(err) 走 JSON：交给 SSE 自己的收尾（停心跳/摘监听/结束响应）
    if (res.headersSent) {
      sseFail?.(err);
      if (!res.writableEnded) res.end();
      return undefined;
    }
    return next(err);
  }
});

/** GET /api/executions — 最近 execution 记录（审计：usage + tool 证据；可按 sessionId 过滤） */
apiRouter.get('/executions', requireAdmin, (req, res) => {
  const limit = Math.max(1, Math.min(500, Number(req.query.limit ?? 50) || 50));
  const sessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId : undefined;
  // 多租户（身份头可信）时按调用方过滤；单租户部署返回全部
  const owner = config.trustIdentityHeaders ? ownerFromHeaders(req.headers) : undefined;
  res.json({
    executions: executionStore.list({ sessionId, owner, limit }),
    stats: executionStore.stats(),
  });
});

/** GET /api/executions/:id — 单条 execution（含 toolCalls 与 usage） */
apiRouter.get('/executions/:id', requireAdmin, (req, res) => {
  const id = String(req.params.id);
  const record = executionStore.get(id);
  if (!record) return res.status(404).json({ error: `execution 不存在："${req.params.id}"` });
  if (config.trustIdentityHeaders) {
    const owner = ownerFromHeaders(req.headers);
    if (record.tenantId !== owner.tenantId || record.userId !== owner.userId) {
      return res.status(403).json({ error: `无权访问 execution："${req.params.id}"` });
    }
  }
  return res.json(record);
});

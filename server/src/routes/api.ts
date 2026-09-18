import { Router } from 'express';
import { z } from 'zod';
import type { MCPServerConfig } from '@github/copilot-sdk';
import { sessionService, assertValidSessionId } from '../services/session-service.js';
import { listProviderStatus } from '../providers/index.js';
import { listMcp, getMcpServerConfig, testMcpServer } from '../mcp/registry.js';
import { listHooks } from '../hooks/registry.js';
import { config } from '../config.js';

export const apiRouter = Router();

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
    return res.json({ name: null, ...(await testMcpServer(cfg)) });
  } catch (err) {
    return next(err);
  }
});

/** GET /api/debug — 诊断包（版本/平台/脱敏配置/runtime 状态/会话计数；按需启动 runtime） */
apiRouter.get('/debug', async (_req, res, next) => {
  try {
    res.json(await sessionService.getDebugInfo());
  } catch (err) {
    next(err);
  }
});

/** GET /api/hooks — hook 预设与最近 hook 事件（审计；事件环纯内存，重启清空） */
apiRouter.get('/hooks', (req, res) => {
  const limit = Math.max(1, Math.min(200, Number(req.query.limit ?? 50) || 50));
  res.json(listHooks(limit));
});

/** POST /api/sessions — 创建 Copilot 会话（可挂 agents/skills/mcp；传 sessionId 即为可恢复会话） */
apiRouter.post('/sessions', async (req, res, next) => {
  try {
    const body = createSessionSchema.parse(req.body ?? {});
    const { mcpServers, ...rest } = body;
    const session = await sessionService.createSession({
      ...rest,
      mcpServers: normalizeInlineMcp(mcpServers),
    });
    res.status(201).json({ sessionId: session.sessionId });
  } catch (err) {
    next(err);
  }
});

/** GET /api/sessions — 磁盘全部会话（含 attached 标记） */
apiRouter.get('/sessions', async (_req, res, next) => {
  try {
    res.json({ sessions: await sessionService.listSessions() });
  } catch (err) {
    next(err);
  }
});

/** GET /api/sessions/:id — 单个会话元信息（含 attached 标记） */
apiRouter.get('/sessions/:id', async (req, res, next) => {
  try {
    assertValidSessionId(req.params.id);
    const meta = await sessionService.getSessionMeta(req.params.id);
    if (!meta) return res.status(404).json({ error: `session 不存在："${req.params.id}"` });
    return res.json(meta);
  } catch (err) {
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
    const session = await sessionService.resumeSession(req.params.id, {
      ...rest,
      mcpServers: normalizeInlineMcp(mcpServers),
    });
    res.json({ sessionId: session.sessionId, resumed: true });
  } catch (err) {
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
    if (req.query.permanent === 'true') {
      await sessionService.deleteSessionPermanently(req.params.id);
      return res.json({ sessionId: req.params.id, deleted: true });
    }
    const wasAttached = await sessionService.disconnectSession(req.params.id);
    return res.json({ sessionId: req.params.id, detached: wasAttached, resumable: true });
  } catch (err) {
    if (err instanceof Error && /无法删除/.test(err.message)) {
      return res.status(404).json({ error: err.message });
    }
    return next(err);
  }
});

/**
 * POST /api/sessions/:id/chat
 * - { streaming: false } → 等待完成，一次性返回 { sessionId, content }
 * - { streaming: true }  → SSE：event: delta / message / subagent / done / error
 *   （subagent.* 为 custom agent 生命周期事件，原样透传，含 agentId/agentName 等）
 */
apiRouter.post('/sessions/:id/chat', async (req, res, next) => {
  try {
    const body = chatSchema.parse(req.body ?? {});
    const session = sessionService.getSession(req.params.id);
    if (!session) {
      return res.status(404).json({ error: 'session not found, 请先 POST /api/sessions' });
    }

    if (body.model) {
      await session.setModel(body.model);
    }

    if (!body.streaming) {
      const finalEvent = await session.sendAndWait({ prompt: body.prompt });
      const content =
        // sendAndWait 返回 AssistantMessageEvent | undefined
        (finalEvent as unknown as { data?: { content?: string } } | undefined)?.data
          ?.content ?? '';
      return res.json({ sessionId: session.sessionId, content });
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

    const offDelta = session.on('assistant.message_delta', (evt) => {
      const delta = (evt as unknown as { data?: { deltaContent?: string } }).data
        ?.deltaContent;
      if (delta) send('delta', { delta });
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
      cleanup();
      send('done', { sessionId: session.sessionId });
      res.end();
    });

    const cleanup = () => {
      offDelta();
      offMsg();
      offAll();
      offIdle();
    };

    req.on('close', cleanup);

    await session.send({ prompt: body.prompt });
    return undefined;
  } catch (err) {
    // SSE 已开始写头时不能再 next(err) 走 JSON
    if (res.headersSent && !res.writableEnded) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: (err as Error).message })}\n\n`);
      return res.end();
    }
    return next(err);
  }
});

import { Router } from 'express';
import { runTurn } from '../agent/agent-runner.js';
import { SSE_EVENTS } from '../agent/agent-events.js';
import { assertValidSessionId, sessionService } from '../services/session-service.js';
import { withTurnSlot } from '../services/turn-runner.js';
import {
  collaborationService,
  executionService,
  participantService,
  sessionAccessService,
} from '../wiring.js';
import {
  chatSchema,
  createSessionSchema,
  normalizeInlineMcp,
  principalOf,
  sendServiceError,
  sessionConfigSchema,
} from './shared.js';

export const sessionRouter = Router();

/**
 * Session API（生命周期 + chat）。
 *
 * 协作端点（participants / messages / events）在 session-collaboration.ts，同样挂在
 * /api/sessions 下 —— 拆开是为了不让单个文件长成什么都装的巨型模块。
 *
 * 授权分层：会话访问（谁能进、能做什么）走 SessionAccessService；
 * 业务授权（能不能批准某笔交易）走 Principal.roles → ApprovalPolicy。两者不合并。
 */

/** POST /api/sessions — 创建会话（传 sessionId 即为可恢复会话；collaborationMode 缺省 single） */
sessionRouter.post('/', async (req, res, next) => {
  try {
    const body = createSessionSchema.parse(req.body ?? {});
    const { mcpServers, ...rest } = body;
    const session = await sessionService.createSession(
      { ...rest, mcpServers: normalizeInlineMcp(mcpServers) },
      principalOf(req),
    );
    const record = await sessionService.getRegistryRecord(session.sessionId);
    res.status(201).json({
      sessionId: session.sessionId,
      collaborationMode: record?.collaborationMode ?? 'single',
      workspacePath: sessionService.getSessionOwner(session.sessionId)?.workspacePath,
    });
  } catch (err) {
    return sendServiceError(res, err, next);
  }
});

/** GET /api/sessions — 调用方可访问的会话（自己拥有的 + 自己参与的共享会话） */
sessionRouter.get('/', async (req, res, next) => {
  try {
    const principal = principalOf(req);
    const extraSessionIds = await sessionAccessService.visibleSessionIds(principal);
    res.json({ sessions: await sessionService.listSessions(principal, { extraSessionIds }) });
  } catch (err) {
    next(err);
  }
});

/** GET /api/sessions/:id — 元信息 + 模式 + 参与人（前端据此决定 Private / Shared 界面） */
sessionRouter.get('/:id', async (req, res, next) => {
  try {
    const id = req.params.id;
    assertValidSessionId(id);
    const access = await sessionAccessService.assertCanView(id, principalOf(req));
    const meta = await sessionService.getSessionMeta(id, access.owner);
    if (!meta) return res.status(404).json({ error: `session 不存在："${id}"` });
    const participants = await participantService.listForSession(id);
    return res.json({
      ...meta,
      collaborationMode: access.mode,
      owner: access.owner,
      role: access.role,
      participants: participants.map((p) => ({
        userId: p.userId,
        role: p.role,
        status: p.status,
        joinedAt: p.joinedAt,
      })),
      participantCount: participants.filter((p) => p.status === 'active').length,
    });
  } catch (err) {
    return sendServiceError(res, err, next);
  }
});

/**
 * POST /api/sessions/:id/resume — 恢复磁盘会话，可附带重配（BYOK 凭证服务端重传）。
 * 不接受 collaborationMode：模式是授权、并发、可见性、传输四件事的根，改了会全盘失效。
 */
sessionRouter.post('/:id/resume', async (req, res, next) => {
  try {
    const id = req.params.id;
    assertValidSessionId(id);
    if (req.body && typeof req.body === 'object' && 'collaborationMode' in req.body) {
      return res.status(400).json({
        error: 'resume 不能修改 collaborationMode（会话模式创建后不可修改）',
      });
    }
    const access = await sessionAccessService.assertCanSend(id, principalOf(req));
    const body = sessionConfigSchema.parse(req.body ?? {});
    const { mcpServers, ...rest } = body;
    const session = await sessionService.resumeSession(
      id,
      { ...rest, mcpServers: normalizeInlineMcp(mcpServers) },
      access.owner,
    );
    return res.json({ sessionId: session.sessionId, resumed: true, collaborationMode: access.mode });
  } catch (err) {
    return sendServiceError(res, err, next);
  }
});

/**
 * DELETE /api/sessions/:id — owner 专属。
 * 不带 permanent：断开 runtime 附着（仍可 resume）；带 permanent：连数据与 workspace 一起删。
 * 成员退出用 POST /api/sessions/:id/leave —— 业务退出与技术脱离不是一回事，
 * 一个成员不该把别人的 Copilot session 摘掉。
 */
sessionRouter.delete('/:id', async (req, res, next) => {
  try {
    const id = req.params.id;
    assertValidSessionId(id);
    const access = await sessionAccessService.assertCanDelete(id, principalOf(req));
    if (req.query.permanent === 'true') {
      await sessionService.deleteSessionPermanently(id, access.owner);
      return res.json({ sessionId: id, deleted: true });
    }
    const wasAttached = await sessionService.disconnectSession(id, access.owner);
    return res.json({ sessionId: id, detached: wasAttached, resumable: true });
  } catch (err) {
    return sendServiceError(res, err, next);
  }
});

/**
 * POST /api/sessions/:id/chat
 *
 *   single  { streaming: false } → { sessionId, executionId, content, usage }
 *           { streaming: true }  → SSE：execution / delta / message / subagent / done / error
 *   shared  202 + { messageId, executionId, status } —— 结果走会话事件流。
 *           每个请求各开一条 SSE 会退化成自己做 fan-out，共享会话的传输就是事件流。
 */
sessionRouter.post('/:id/chat', async (req, res, next) => {
  let sseFail: ((err: unknown) => void) | null = null;
  let executionId: string | null = null;
  try {
    const id = req.params.id;
    assertValidSessionId(id);
    const body = chatSchema.parse(req.body ?? {});
    const submitted = await collaborationService.submitMessage({
      sessionId: id,
      principal: principalOf(req),
      prompt: body.prompt,
      ...(body.model ? { model: body.model } : {}),
      ...(body.clientMessageId ? { clientMessageId: body.clientMessageId } : {}),
      streaming: body.streaming,
    });

    // ---- shared：入队即返回，不等 agent turn ----
    if (submitted.mode === 'shared') {
      return res.status(202).json({
        sessionId: id,
        collaborationMode: 'shared',
        messageId: submitted.messageId,
        executionId: submitted.execution.executionId,
        status: submitted.execution.status,
        reused: submitted.reused,
        eventsUrl: `/api/sessions/${id}/events`,
      });
    }

    const { session, execution } = submitted;
    executionId = execution.executionId;

    // ---- single：HTTP 请求当场跑（全局闸门 → session 锁 → agent turn） ----
    let send: (event: string, data: unknown) => void = () => undefined;
    const runTurnOnce = () =>
      withTurnSlot({ sessionId: session.sessionId, executionId: execution.executionId }, () =>
        runTurn({
          session,
          executionId: execution.executionId,
          prompt: body.prompt,
          ...(body.model ? { model: body.model } : {}),
          ...(body.streaming
            ? {
                handlers: {
                  onDelta: (delta) => send('delta', { delta }),
                  onMessage: (content) => send('message', { content }),
                  onSubagent: (event) => send('subagent', event),
                },
              }
            : {}),
        }),
      );

    if (!body.streaming) {
      try {
        const result = await runTurnOnce();
        await executionService.complete(execution.executionId, {
          contentChars: result.content.length,
          result: { content: result.content },
        });
        return res.json({
          sessionId: session.sessionId,
          executionId: execution.executionId,
          collaborationMode: 'single',
          content: result.content,
          usage: executionService.usageSnapshot(execution.executionId),
        });
      } catch (err) {
        await executionService.fail(execution.executionId, err);
        throw err;
      }
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    send = (event: string, data: unknown) => {
      if (res.writableEnded) return;
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };
    // 首个帧给 executionId：之后工具证据/usage/报错都能按它对齐
    send(SSE_EVENTS.execution, {
      executionId: execution.executionId,
      sessionId: session.sessionId,
    });

    // Ingress/ALB 空闲超时保护：长推理无输出时保活
    const heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(': heartbeat\n\n');
    }, 15000);

    let finished = false;
    let turnRunning = false;
    const finish = (event: 'done' | 'error', data: unknown) => {
      if (finished) return;
      finished = true;
      clearInterval(heartbeat);
      if (!res.writableEnded) {
        send(event, data);
        res.end();
      }
    };
    sseFail = (err) => {
      const message = err instanceof Error ? err.message : String(err);
      void executionService.fail(execution.executionId, err);
      finish(SSE_EVENTS.error, { error: message, executionId: execution.executionId });
    };

    // 客户端断开 = 中止当前 turn（不是断开 session）；execution 落 cancelled
    req.on('close', () => {
      if (turnRunning && !finished) {
        void executionService.cancel(execution.executionId);
        void sessionService.abortTurn(session.sessionId).catch(() => undefined);
      }
      finished = true;
      turnRunning = false;
      clearInterval(heartbeat);
    });

    try {
      turnRunning = true;
      const result = await runTurnOnce();
      turnRunning = false;
      await executionService.complete(execution.executionId, {
        contentChars: result.chars || result.content.length,
      });
      finish(SSE_EVENTS.done, {
        sessionId: session.sessionId,
        executionId: execution.executionId,
        usage: executionService.usageSnapshot(execution.executionId),
      });
    } catch (err) {
      turnRunning = false;
      sseFail?.(err);
    }
    return undefined;
  } catch (err) {
    if (executionId && !res.headersSent) {
      await executionService.fail(executionId, err).catch(() => undefined);
    }
    // SSE 已开始写头时不能再 next(err) 走 JSON
    if (res.headersSent) {
      sseFail?.(err);
      if (!res.writableEnded) res.end();
      return undefined;
    }
    return sendServiceError(res, err, next);
  }
});

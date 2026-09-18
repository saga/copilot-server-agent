import { Router } from 'express';
import { runTurn } from '../agent/agent-runner.js';
import { executionContext } from '../agent/agent-context.js';
import { SSE_EVENTS } from '../agent/agent-events.js';
import { executionService } from '../execution/index.js';
import {
  sessionService,
  assertValidSessionId,
} from '../services/session-service.js';
import { withExecutionSlot } from '../services/concurrency.js';
import {
  chatSchema,
  createSessionSchema,
  normalizeInlineMcp,
  ownerOf,
  sendServiceError,
  sessionConfigSchema,
} from './shared.js';

export const sessionRouter = Router();

/** POST /api/sessions — 创建 Copilot 会话（传 sessionId 即为可恢复会话） */
sessionRouter.post('/', async (req, res, next) => {
  try {
    const body = createSessionSchema.parse(req.body ?? {});
    const { mcpServers, ...rest } = body;
    const session = await sessionService.createSession(
      { ...rest, mcpServers: normalizeInlineMcp(mcpServers) },
      ownerOf(req),
    );
    res.status(201).json({
      sessionId: session.sessionId,
      workspacePath: sessionService.getSessionOwner(session.sessionId)?.workspacePath,
    });
  } catch (err) {
    return sendServiceError(res, err, next);
  }
});

/** GET /api/sessions — 当前调用方的会话（按 Session Registry 归属过滤） */
sessionRouter.get('/', async (req, res, next) => {
  try {
    res.json({ sessions: await sessionService.listSessions(ownerOf(req)) });
  } catch (err) {
    next(err);
  }
});

/** GET /api/sessions/:id — 单个会话元信息（含 attached 标记） */
sessionRouter.get('/:id', async (req, res, next) => {
  try {
    assertValidSessionId(req.params.id);
    const meta = await sessionService.getSessionMeta(req.params.id, ownerOf(req));
    if (!meta) return res.status(404).json({ error: `session 不存在："${req.params.id}"` });
    return res.json(meta);
  } catch (err) {
    return sendServiceError(res, err, next);
  }
});

/** POST /api/sessions/:id/resume — 恢复磁盘会话，可附带重配（BYOK 凭证服务端重传） */
sessionRouter.post('/:id/resume', async (req, res, next) => {
  try {
    assertValidSessionId(req.params.id);
    const body = sessionConfigSchema.parse(req.body ?? {});
    const { mcpServers, ...rest } = body;
    const session = await sessionService.resumeSession(
      req.params.id,
      { ...rest, mcpServers: normalizeInlineMcp(mcpServers) },
      ownerOf(req),
    );
    res.json({ sessionId: session.sessionId, resumed: true });
  } catch (err) {
    return sendServiceError(res, err, next);
  }
});

/** DELETE /api/sessions/:id — 默认断开附着（可 resume）；?permanent=true 彻底删除 */
sessionRouter.delete('/:id', async (req, res, next) => {
  try {
    assertValidSessionId(req.params.id);
    const owner = ownerOf(req);
    if (req.query.permanent === 'true') {
      await sessionService.deleteSessionPermanently(req.params.id, owner);
      return res.json({ sessionId: req.params.id, deleted: true });
    }
    const wasAttached = await sessionService.disconnectSession(req.params.id, owner);
    return res.json({ sessionId: req.params.id, detached: wasAttached, resumable: true });
  } catch (err) {
    return sendServiceError(res, err, next);
  }
});

/**
 * POST /api/sessions/:id/chat
 * - { streaming: false } → { sessionId, executionId, content, usage }
 * - { streaming: true }  → SSE：execution / delta / message / subagent / waiting / done / error
 *
 * 每次请求 = 一个 execution；SDK 事件处理全部在 AgentRunner 里，路由只做编排与传输。
 */
sessionRouter.post('/:id/chat', async (req, res, next) => {
  let sseFail: ((err: unknown) => void) | null = null;
  let executionId: string | null = null;
  try {
    const body = chatSchema.parse(req.body ?? {});
    const owner = ownerOf(req);
    const session = await sessionService.getOrResumeSession(req.params.id, {}, owner);
    void sessionService.touch(session.sessionId);

    const execution = await executionService.create({
      sessionId: session.sessionId,
      owner,
      kind: 'interactive',
      prompt: body.prompt,
      model: body.model,
      streaming: body.streaming,
    });
    executionId = execution.executionId;
    await executionService.start(execution.executionId);

    const runTurnOnce = () =>
      withExecutionSlot(() =>
        sessionService.withSessionLock(session.sessionId, async () => {
          executionContext.set(session.sessionId, execution.executionId);
          sessionService.markTurnActive(session.sessionId);
          try {
            return await runTurn({
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
            });
          } finally {
            sessionService.markTurnIdle(session.sessionId);
            executionContext.clear(session.sessionId, execution.executionId);
          }
        }),
      );

    // ---- 非流式 ----
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
          content: result.content,
          usage: executionService.usageSnapshot(execution.executionId),
        });
      } catch (err) {
        await executionService.fail(execution.executionId, err);
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

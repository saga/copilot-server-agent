import { Router } from 'express';
import type { Response } from 'express';
import { assertValidSessionId } from '../services/session-service.js';
import {
  messageService,
  participantService,
  sessionAccessService,
  sessionEventService,
} from '../wiring.js';
import type { SessionEvent } from '../collaboration/index.js';
import { addParticipantSchema, principalOf, sendServiceError } from './shared.js';

export const sessionCollaborationRouter = Router();

/**
 * 共享会话的协作端点（参与人 / 消息 / 事件流）。
 *
 * 权限只用会话角色判定（owner / member / observer），与业务角色无关：
 * 能进会话 ≠ 能批准交易。
 */

const HEARTBEAT_MS = 15000;

/** GET /api/sessions/:id/participants — 成员列表（含已退出/被移除的痕迹） */
sessionCollaborationRouter.get('/:id/participants', async (req, res, next) => {
  try {
    const id = req.params.id;
    assertValidSessionId(id);
    const participants = await participantService.list(id, principalOf(req));
    res.json({
      participants: participants.map((p) => ({
        userId: p.userId,
        role: p.role,
        status: p.status,
        joinedAt: p.joinedAt,
        ...(p.leftAt ? { leftAt: p.leftAt } : {}),
      })),
    });
  } catch (err) {
    return sendServiceError(res, err, next);
  }
});

/** POST /api/sessions/:id/participants — owner 邀请成员（只允许同租户） */
sessionCollaborationRouter.post('/:id/participants', async (req, res, next) => {
  try {
    const id = req.params.id;
    assertValidSessionId(id);
    const body = addParticipantSchema.parse(req.body ?? {});
    const participant = await participantService.add(id, principalOf(req), {
      userId: body.userId,
      role: body.role,
    });
    res.status(201).json({ participant });
  } catch (err) {
    return sendServiceError(res, err, next);
  }
});

/** DELETE /api/sessions/:id/participants/:userId — owner 移除成员（置 removed，保留痕迹） */
sessionCollaborationRouter.delete('/:id/participants/:userId', async (req, res, next) => {
  try {
    const id = req.params.id;
    assertValidSessionId(id);
    const participant = await participantService.remove(id, principalOf(req), req.params.userId);
    res.json({ participant });
  } catch (err) {
    return sendServiceError(res, err, next);
  }
});

/** POST /api/sessions/:id/leave — 成员自行退出（owner 不能退出自己的会话） */
sessionCollaborationRouter.post('/:id/leave', async (req, res, next) => {
  try {
    const id = req.params.id;
    assertValidSessionId(id);
    const participant = await participantService.leave(id, principalOf(req));
    res.json({ participant });
  } catch (err) {
    return sendServiceError(res, err, next);
  }
});

/** GET /api/sessions/:id/messages — 会话 transcript（按 sequence 升序） */
sessionCollaborationRouter.get('/:id/messages', async (req, res, next) => {
  try {
    const id = req.params.id;
    assertValidSessionId(id);
    const limit = Math.max(1, Math.min(500, Number(req.query.limit ?? 100) || 100));
    const messages = await messageService.list(id, principalOf(req), limit);
    res.json({ messages });
  } catch (err) {
    return sendServiceError(res, err, next);
  }
});

/**
 * GET /api/sessions/:id/events — 会话事件流（SSE）。
 *
 *   ?after=<sequence>  或  Last-Event-ID 头 → 先回放库里 sequence 更大的事件，再接实时推送。
 *
 * 断线重连必须能补齐错过的事件（多人协作里断 30 秒就漏十几条），
 * 所以游标是 durability 的一部分，不是可选项。
 * 事件带 `id:` 字段（= sequence），浏览器重连时会自动带回 Last-Event-ID。
 */
sessionCollaborationRouter.get('/:id/events', async (req, res, next) => {
  try {
    const id = req.params.id;
    assertValidSessionId(id);
    await sessionAccessService.assertCanView(id, principalOf(req));

    const rawCursor = typeof req.query.after === 'string' ? req.query.after : req.header('last-event-id');
    const parsed = Number(rawCursor ?? 0);
    const after = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      // 反向代理缓冲会把流式响应攒成一次性输出
      'X-Accel-Buffering': 'no',
    });

    let closed = false;
    let lastSent = after;
    const write = (event: SessionEvent) => {
      if (closed || res.writableEnded) return;
      const frame: string[] = [];
      // 瞬时事件没有 sequence（不落库），不写 id，避免污染重连游标
      if (event.sequence > 0) frame.push(`id: ${event.sequence}`);
      frame.push(`event: ${event.type}`);
      frame.push(`data: ${JSON.stringify(event)}`);
      res.write(`${frame.join('\n')}\n\n`);
      if (event.sequence > 0) lastSent = Math.max(lastSent, event.sequence);
    };

    for (const event of await sessionEventService.listAfter(id, after)) write(event);

    const unsubscribe = sessionEventService.subscribe(id, (event) => {
      // 回放与订阅之间的重叠：同一条事件不重复推
      if (event.sequence > 0 && event.sequence <= lastSent) return;
      write(event);
    });

    const heartbeat = setInterval(() => {
      if (!closed && !res.writableEnded) res.write(': heartbeat\n\n');
    }, HEARTBEAT_MS);

    const cleanup = () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
      if (!res.writableEnded) res.end();
    };
    req.on('close', cleanup);
    res.on('close', cleanup);
    return undefined;
  } catch (err) {
    if (res.headersSent) {
      if (!res.writableEnded) res.end();
      return undefined;
    }
    return sendServiceError(res, err, next) as unknown as Response;
  }
});

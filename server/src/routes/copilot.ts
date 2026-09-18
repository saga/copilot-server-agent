import { Router } from 'express';
import { z } from 'zod';
import { copilotService } from '../services/copilot.js';

export const copilotRouter = Router();

const createSessionSchema = z.object({
  model: z.string().optional(),
  systemMessage: z.string().optional(),
});

const chatSchema = z.object({
  prompt: z.string().min(1, 'prompt 不能为空'),
  streaming: z.boolean().optional().default(false),
  model: z.string().optional(),
});

/** GET /api/models — 前端模型选择器用 */
copilotRouter.get('/models', async (_req, res, next) => {
  try {
    const models = await copilotService.listModels();
    res.json({ models });
  } catch (err) {
    next(err);
  }
});

/** POST /api/sessions — 创建 Copilot 会话 */
copilotRouter.post('/sessions', async (req, res, next) => {
  try {
    const body = createSessionSchema.parse(req.body ?? {});
    const session = await copilotService.createSession(body);
    res.status(201).json({ sessionId: session.sessionId });
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/sessions/:id — 销毁会话 */
copilotRouter.delete('/sessions/:id', async (req, res, next) => {
  try {
    const ok = await copilotService.destroySession(req.params.id);
    if (!ok) return res.status(404).json({ error: 'session not found' });
    return res.status(204).end();
  } catch (err) {
    return next(err);
  }
});

/**
 * POST /api/sessions/:id/chat
 * - { streaming: false } → 等待完成，一次性返回 { sessionId, content }
 * - { streaming: true }  → SSE：event: delta / message / done / error
 */
copilotRouter.post('/sessions/:id/chat', async (req, res, next) => {
  try {
    const body = chatSchema.parse(req.body ?? {});
    const session = copilotService.getSession(req.params.id);
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
    const offIdle = session.on('session.idle', () => {
      cleanup();
      send('done', { sessionId: session.sessionId });
      res.end();
    });

    const cleanup = () => {
      offDelta();
      offMsg();
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

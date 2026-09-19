import { Router } from 'express';
import { sessionService } from '../services/session-service.js';
import { isShuttingDown, lifecycleState } from '../lifecycle.js';
import type { HealthResponse } from '../types.js';

export const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
  const body: HealthResponse = {
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    copilot: sessionService.getStatus(),
    ...(sessionService.getLastError()
      ? { copilotError: sessionService.getLastError() as string }
      : {}),
  };
  res.json(body);
});

/** liveness：进程活着即可（不碰 runtime，避免探针风暴拉起 CLI） */
healthRouter.get('/live', (_req, res) => {
  if (isShuttingDown()) {
    return res.status(503).json({ status: 'draining', uptime: process.uptime() });
  }
  return res.status(200).json({ status: 'ok', uptime: process.uptime() });
});

/**
 * readiness：runtime 能 ping 通才算就绪。
 *
 * `starting` 期间也返回 503 —— durable 状态恢复还没跑完，此时放流量进来会和恢复流程
 * 抢同一批 execution（见 `lifecycle.ts`、`index.ts`）。
 */
healthRouter.get('/ready', async (_req, res) => {
  const state = lifecycleState();
  if (state !== 'ready') {
    return res
      .status(503)
      .json({ status: state, copilot: state === 'draining' ? 'draining' : 'pending' });
  }
  try {
    const client = await sessionService.getClient();
    await client.ping('readiness');
    return res.status(200).json({ status: 'ready', copilot: 'connected' });
  } catch (err) {
    return res.status(503).json({
      status: 'not_ready',
      copilot: 'error',
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

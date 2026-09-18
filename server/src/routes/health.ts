import { Router } from 'express';
import { sessionService } from '../services/session-service.js';
import { isShuttingDown } from '../shutdown.js';
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

/** readiness：runtime 必须能 ping 通；drain 期间直接 503 让 K8s 摘流 */
healthRouter.get('/ready', async (_req, res) => {
  if (isShuttingDown()) {
    return res.status(503).json({ status: 'draining', copilot: 'draining' });
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

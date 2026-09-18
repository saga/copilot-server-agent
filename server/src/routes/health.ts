import { Router } from 'express';
import { sessionService } from '../services/session-service.js';
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

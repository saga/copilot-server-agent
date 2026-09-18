import { Router } from 'express';
import { copilotService } from '../services/copilot.js';
import type { HealthResponse } from '../types.js';

export const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
  const body: HealthResponse = {
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    copilot: copilotService.getStatus(),
    ...(copilotService.getLastError()
      ? { copilotError: copilotService.getLastError() as string }
      : {}),
  };
  res.json(body);
});

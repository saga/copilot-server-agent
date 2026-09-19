import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';

import { serviceErrorStatus } from './error-status.js';

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
) {
  console.error(err);
  // 参数校验失败 → 400（方便前端区分“传错了”还是“服务端炸了”）
  if (err instanceof z.ZodError) {
    return res.status(400).json({
      error: 'invalid request',
      details: err.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    });
  }
  const message = err instanceof Error ? err.message : 'Internal Server Error';
  // 与路由里的 sendServiceError 共用同一份判定（403 权限 / 404 不存在 / 400 调用方错误）
  const status = err instanceof Error ? serviceErrorStatus(message) : undefined;
  return res.status(status ?? 500).json({ error: message });
}

import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';

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
  // 已知的“缺配置/名字写错”类错误也给 400
  const badRequest = /未知 agent|未知 MCP|未知 hook|不存在|缺少|必须|可选：|被拒绝|非法|解析失败/.test(message);
  return res.status(badRequest ? 400 : 500).json({ error: message });
}

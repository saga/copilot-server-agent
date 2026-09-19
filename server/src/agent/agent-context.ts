import { executionSink } from '../execution/sink.js';

/**
 * Execution context（turn 级）。
 *
 * session config 是 session 级的，execution 是 turn 级的，两者不能混：
 * 需要当前 executionId 的地方（tool evidence / policy / SSE）统一从这里取，
 * 而不是把 executionId 塞进 session 配置。
 *
 * 依赖走 `execution/sink.ts` 而不是 wiring —— 本模块被 wiring 间接 import，直接取 wiring 会成环。
 */
export const executionContext = {
  set(sessionId: string, executionId: string): void {
    executionSink().setActive(sessionId, executionId);
  },
  clear(sessionId: string, executionId?: string): void {
    executionSink().clearActive(sessionId, executionId);
  },
  current(sessionId: string): string | undefined {
    return executionSink().activeFor(sessionId);
  },
};

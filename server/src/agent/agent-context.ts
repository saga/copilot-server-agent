import { executionSink, hasExecutionSink } from '../execution/sink.js';

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
  /**
   * 当前 session 正在跑的 executionId。
   *
   * 未装配 sink 时返回 undefined 而不是抛错：这个值现在被 tool-policy 每次权限请求都要读
   * （用来判断 workflow 能力边界属不属于当前执行），而权限请求在"库还没接上"的场景
   * （单测、只跑 agent 的进程）里也会发生 —— 为了一次读值把整个调用链炸掉不划算。
   * 返回 undefined 时那一层判定按"没有 execution 上下文"处理。
   */
  current(sessionId: string): string | undefined {
    return hasExecutionSink() ? executionSink().activeFor(sessionId) : undefined;
  },
};

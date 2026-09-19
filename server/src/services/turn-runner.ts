import { executionContext } from '../agent/agent-context.js';
import { withExecutionSlot } from './concurrency.js';
import { sessionService } from './session-service.js';

/**
 * 一次 agent turn 的执行槽：全局并发闸门 → session 锁 → execution context。
 *
 * 两个模式共用这一个实现（single 的 HTTP 路径与 shared 的队列路径都走它），
 * 差别只在「谁触发、结果怎么传出去」，不在怎么串行化：
 *   全局最多 N 个 turn；同一 session 恒为 1 个 turn。
 */

export interface TurnSlot {
  sessionId: string;
  executionId: string;
}

export function withTurnSlot<T>(slot: TurnSlot, fn: () => Promise<T>): Promise<T> {
  return withExecutionSlot(() =>
    sessionService.withSessionLock(slot.sessionId, async () => {
      // hook（工具证据/策略）靠这个映射把证据挂到当前 execution
      executionContext.set(slot.sessionId, slot.executionId);
      sessionService.markTurnActive(slot.sessionId);
      try {
        return await fn();
      } finally {
        sessionService.markTurnIdle(slot.sessionId);
        executionContext.clear(slot.sessionId, slot.executionId);
      }
    }),
  );
}

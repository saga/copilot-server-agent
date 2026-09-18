import type { EventRepository } from './repository.js';
import type { ExecutionEvent } from './types.js';

/**
 * ExecutionEvent：完整审计时间线（ExecutionRecord 只存“当前状态”，不能回答
 * “谁批准了 / 什么时候 / 批准前看到什么 / 后来为什么执行”）。
 *
 * 与 LangSmith 的分工：
 *   LangSmith       = runtime observability（trace、latency）
 *   ExecutionEvent  = business execution audit（regulatory evidence）
 */
export class ExecutionEventLog {
  constructor(private readonly repo: EventRepository) {}

  async append(input: {
    executionId: string;
    type: string;
    actorType: ExecutionEvent['actorType'];
    actorId?: string;
    payload?: Record<string, unknown>;
  }): Promise<ExecutionEvent> {
    return this.repo.append({
      executionId: input.executionId,
      sequence: 0, // 由 repository 分配（PG 取 max+1，内存取数组长度+1）
      type: input.type,
      actorType: input.actorType,
      ...(input.actorId ? { actorId: input.actorId } : {}),
      ...(input.payload ? { payload: input.payload } : {}),
      createdAt: new Date().toISOString(),
    });
  }

  list(executionId: string, limit = 100): Promise<ExecutionEvent[]> {
    return this.repo.list(executionId, limit);
  }
}

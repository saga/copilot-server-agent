import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import type {
  AppendExecutionEventInput,
  EventRepository,
  ExecutionRepository,
  ExecutionStats,
} from './repository.js';
import type { ExecutionEvent, ExecutionFilter, ExecutionRecord } from './types.js';

/**
 * 内存实现：单测与 `COPILOT_STATE_BACKEND=memory`（不落盘的临时验证）用。
 * 记录按插入顺序做 LRU 淘汰（COPILOT_MAX_TRACKED_EXECUTIONS），事件环同理。
 */

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export class MemoryExecutionRepository implements ExecutionRepository {
  private records = new Map<string, ExecutionRecord>();
  private order: string[] = [];

  async create(record: ExecutionRecord): Promise<ExecutionRecord> {
    const stored = clone(record);
    this.records.set(record.executionId, stored);
    this.order.push(record.executionId);
    this.evict();
    return clone(stored);
  }

  async get(executionId: string): Promise<ExecutionRecord | undefined> {
    const rec = this.records.get(executionId);
    return rec ? clone(rec) : undefined;
  }

  async update(
    executionId: string,
    patch: Partial<ExecutionRecord>,
  ): Promise<ExecutionRecord | undefined> {
    const rec = this.records.get(executionId);
    if (!rec) return undefined;
    const next = { ...rec, ...clone(patch), updatedAt: new Date().toISOString() };
    this.records.set(executionId, next);
    return clone(next);
  }

  /**
   * 单写者 / CAS：与 SQL 实现同语义 —— 版本对不上就返回 undefined，调用方停止推进。
   * 内存实现没有并发写，但版本号语义必须一致，否则单测会掩盖真实后端的问题。
   */
  async compareAndSwapWorkflowState(
    executionId: string,
    expectedVersion: number,
    workflow: ExecutionRecord['workflow'],
  ): Promise<ExecutionRecord | undefined> {
    const rec = this.records.get(executionId);
    if (!rec) return undefined;
    if ((rec.workflowVersion ?? 0) !== expectedVersion) return undefined;
    const next: ExecutionRecord = {
      ...rec,
      workflow: workflow ? clone(workflow) : undefined,
      workflowVersion: expectedVersion + 1,
      updatedAt: new Date().toISOString(),
    };
    this.records.set(executionId, next);
    return clone(next);
  }

  async list(filter: ExecutionFilter = {}): Promise<ExecutionRecord[]> {
    const matched = [...this.records.values()].filter((r) => {
      if (filter.sessionId && r.sessionId !== filter.sessionId) return false;
      if (filter.sessionIds && !filter.sessionIds.includes(r.sessionId)) return false;
      if (filter.tenantId && r.tenantId !== filter.tenantId) return false;
      if (filter.userId && r.userId !== filter.userId) return false;
      if (filter.status && r.status !== filter.status) return false;
      return true;
    });
    const limit = Math.max(1, Math.min(500, filter.limit ?? 50));
    return matched.slice(-limit).map(clone);
  }

  /**
   * 队列取活：与 SQL 实现同一定序 —— queueSequence（= 来源消息 sequence）升序，
   * 并只认协作 execution（有 sourceMessageId）。见 sql-repository.nextQueued。
   */
  async nextQueued(sessionId: string): Promise<ExecutionRecord | undefined> {
    const queued = [...this.records.values()]
      .filter(
        (r) =>
          r.sessionId === sessionId &&
          r.status === 'created' &&
          r.sourceMessageId !== undefined &&
          r.queueSequence !== undefined,
      )
      .sort(
        (a, b) =>
          (a.queueSequence ?? 0) - (b.queueSequence ?? 0) ||
          a.executionId.localeCompare(b.executionId),
      );
    return queued[0] ? clone(queued[0]) : undefined;
  }

  async queuedSessionIds(): Promise<string[]> {
    return [
      ...new Set(
        [...this.records.values()]
          .filter((r) => r.status === 'created' && r.sourceMessageId !== undefined)
          .map((r) => r.sessionId),
      ),
    ];
  }

  async interruptActive(reason: string): Promise<ExecutionRecord[]> {
    const now = new Date().toISOString();
    const hit: ExecutionRecord[] = [];
    for (const [id, rec] of this.records) {
      if (rec.status !== 'running' && rec.status !== 'resuming') continue;
      const next: ExecutionRecord = {
        ...rec,
        status: 'interrupted',
        updatedAt: now,
        completedAt: rec.completedAt ?? now,
        error: rec.error ?? reason,
      };
      this.records.set(id, next);
      hit.push(clone(next));
    }
    return hit;
  }

  async stats(): Promise<ExecutionStats> {
    let running = 0;
    let waiting = 0;
    let toolCalls = 0;
    for (const r of this.records.values()) {
      if (r.status === 'running') running += 1;
      if (r.status === 'waiting_for_input' || r.status === 'waiting_for_approval') waiting += 1;
      toolCalls += r.toolCalls.length + (r.toolCallsOmitted ?? 0);
    }
    return { tracked: this.records.size, running, waiting, toolCalls, backend: 'memory' };
  }

  /** 测试用：清空全部记录 */
  clear(): void {
    this.records.clear();
    this.order = [];
  }

  private evict(): void {
    while (this.records.size > config.maxTrackedExecutions) {
      const oldest = this.order.shift();
      if (oldest === undefined) return;
      this.records.delete(oldest);
    }
  }
}

export class MemoryEventRepository implements EventRepository {
  private events = new Map<string, ExecutionEvent[]>();
  /** 与 SQL 侧的 agent_execution.event_sequence 同义：独立计数器，不靠数组长度推算 */
  private seq = new Map<string, number>();

  async append(input: AppendExecutionEventInput): Promise<ExecutionEvent> {
    const list = this.events.get(input.executionId) ?? [];
    const sequence = (this.seq.get(input.executionId) ?? 0) + 1;
    this.seq.set(input.executionId, sequence);
    const event: ExecutionEvent = {
      ...clone(input),
      sequence,
      eventId: `ev_${randomUUID()}`,
    };
    list.push(event);
    if (list.length > 500) list.splice(0, list.length - 500);
    this.events.set(input.executionId, list);
    return clone(event);
  }

  async list(executionId: string, limit = 100): Promise<ExecutionEvent[]> {
    const list = this.events.get(executionId) ?? [];
    const n = Math.max(1, Math.min(500, limit));
    return list.slice(-n).map(clone);
  }

  clear(): void {
    this.events.clear();
    this.seq.clear();
  }
}

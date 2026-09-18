import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import type { EventRepository, ExecutionRepository, ExecutionStats } from './repository.js';
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

  async list(filter: ExecutionFilter = {}): Promise<ExecutionRecord[]> {
    const matched = [...this.records.values()].filter((r) => {
      if (filter.sessionId && r.sessionId !== filter.sessionId) return false;
      if (filter.tenantId && r.tenantId !== filter.tenantId) return false;
      if (filter.userId && r.userId !== filter.userId) return false;
      if (filter.status && r.status !== filter.status) return false;
      return true;
    });
    const limit = Math.max(1, Math.min(500, filter.limit ?? 50));
    return matched.slice(-limit).map(clone);
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

  async append(input: Omit<ExecutionEvent, 'eventId'>): Promise<ExecutionEvent> {
    const list = this.events.get(input.executionId) ?? [];
    const event: ExecutionEvent = {
      ...clone(input),
      sequence: list.length + 1,
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
  }
}

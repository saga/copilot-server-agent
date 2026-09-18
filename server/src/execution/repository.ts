import type {
  ExecutionEvent,
  ExecutionFilter,
  ExecutionRecord,
} from './types.js';

/**
 * Execution 持久化抽象。
 *
 *   api/routes → ExecutionService → ExecutionRepository → PostgreSQL | Memory
 *
 * 业务层只认接口：本地开发/单元测试用内存实现，生产用 PostgreSQL，代码零改动。
 * 注意 durable state（status / human task / approval / event）与进程内缓存
 * （active execution 映射、usage 累加器、pending tool call 栈）是两回事：
 * 后者可以是内存，前者必须落库。
 */

export interface ExecutionStats {
  tracked: number;
  running: number;
  waiting: number;
  toolCalls: number;
  backend: 'postgres' | 'memory';
}

export interface ExecutionRepository {
  create(record: ExecutionRecord): Promise<ExecutionRecord>;
  get(executionId: string): Promise<ExecutionRecord | undefined>;
  /** 局部更新（status/usage/toolCalls…）；不存在返回 undefined */
  update(
    executionId: string,
    patch: Partial<ExecutionRecord>,
  ): Promise<ExecutionRecord | undefined>;
  list(filter?: ExecutionFilter): Promise<ExecutionRecord[]>;
  stats(): Promise<ExecutionStats>;
}

export interface EventRepository {
  /** 追加事件（sequence 由实现分配，同 execution 内单调递增且唯一） */
  append(input: Omit<ExecutionEvent, 'eventId'>): Promise<ExecutionEvent>;
  list(executionId: string, limit?: number): Promise<ExecutionEvent[]>;
}

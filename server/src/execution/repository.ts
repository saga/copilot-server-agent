import type { DbBackend } from '../db/dialect.js';
import type {
  ExecutionEvent,
  ExecutionFilter,
  ExecutionRecord,
} from './types.js';

/**
 * Execution 持久化抽象。
 *
 *   api/routes → ExecutionService → ExecutionRepository → SQLite | PostgreSQL | Memory
 *
 * 业务层只认接口：本地开发/单元测试用内存实现，运行期默认 SQLite、可切 PostgreSQL，代码零改动。
 * 注意 durable state（status / human task / approval / event）与进程内缓存
 * （active execution 映射、usage 累加器、pending tool call 栈）是两回事：
 * 后者可以是内存，前者必须落库。
 */

export interface ExecutionStats {
  tracked: number;
  running: number;
  waiting: number;
  toolCalls: number;
  /** 'memory' 只在强制内存后端时出现 */
  backend: DbBackend | 'memory';
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
  /**
   * 协作队列里的下一条：同一 session 内按 `queue_sequence`（= 来源消息 sequence）升序，
   * 取仍 `created` 的那条。`created` 状态本身就是队列项，不需要另建队列表。
   *
   * 只有协作 execution（sourceMessageId 非空）算队列项：`POST /api/executions` 建的
   * kind=job 没有来源消息，由显式 `/run` 驱动，不该被会话调度器当成"等 agent 输入"。
   */
  nextQueued(sessionId: string): Promise<ExecutionRecord | undefined>;
  /** 仍有排队中协作 execution 的 session（重启后需要重新 drain —— chains 是进程内的） */
  queuedSessionIds(): Promise<string[]>;
  /**
   * 启动恢复：把进程退出时留在 running/resuming 的执行落成 interrupted（终态，不自动重试）。
   * 返回被改动的记录，供调用方逐个留痕。
   */
  interruptActive(reason: string): Promise<ExecutionRecord[]>;
  stats(): Promise<ExecutionStats>;
}

/**
 * 追加 execution 事件的输入：`eventId` 与 `sequence` 都由实现分配。
 * 序号必须来自存储（同一 execution 内单调递增且唯一），不能由调用方猜一个值进来 ——
 * 调用方填了也会被忽略，那是契约上的谎话（会话事件用的是同一套约定）。
 */
export type AppendExecutionEventInput = Omit<ExecutionEvent, 'eventId' | 'sequence'>;

export interface EventRepository {
  /** 追加事件（sequence 由实现分配，同 execution 内单调递增且唯一） */
  append(input: AppendExecutionEventInput): Promise<ExecutionEvent>;
  list(executionId: string, limit?: number): Promise<ExecutionEvent[]>;
}

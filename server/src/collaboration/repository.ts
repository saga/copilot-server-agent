import type {
  AgentMessage,
  MessageActorType,
  SessionEvent,
  SessionParticipant,
  SessionParticipantRole,
  SessionParticipantStatus,
} from './types.js';

/**
 * 协作层持久化抽象。
 *
 *   routes → CollaborationService → repositories → SQLite | PostgreSQL | Memory
 *
 * 两种 SQL 后端共用同一份实现（`sql-repository.ts`），内存实现只给单测与
 * `COPILOT_STATE_BACKEND=memory` 用。
 */

export interface ParticipantRepository {
  /** 新建或复活参与人（同一 session 内一人一行） */
  upsert(input: {
    sessionId: string;
    tenantId: string;
    userId: string;
    role: SessionParticipantRole;
    status?: SessionParticipantStatus;
    joinedAt: string;
  }): Promise<SessionParticipant>;
  get(sessionId: string, userId: string): Promise<SessionParticipant | undefined>;
  list(sessionId: string): Promise<SessionParticipant[]>;
  /** 某人在哪些 session 里是 active 参与人（GET /sessions 的可见性来源） */
  listActiveSessionIds(tenantId: string, userId: string): Promise<string[]>;
  setStatus(
    sessionId: string,
    userId: string,
    status: SessionParticipantStatus,
    leftAt?: string,
  ): Promise<SessionParticipant | undefined>;
}

export interface CreateMessageInput {
  sessionId: string;
  tenantId: string;
  actorType: MessageActorType;
  actorId?: string;
  content: string;
  clientMessageId?: string;
  executionId?: string;
  createdAt: string;
}

export interface MessageRepository {
  /**
   * 分配 session 级 sequence 并写入。
   * `clientMessageId` 命中已有记录时返回那条记录且 `created=false`（幂等重试）。
   */
  create(
    input: CreateMessageInput,
  ): Promise<{ message: AgentMessage; created: boolean }>;
  get(messageId: string): Promise<AgentMessage | undefined>;
  list(sessionId: string, limit?: number): Promise<AgentMessage[]>;
  /** 消息与执行单元关联（审计链 session message → execution） */
  attachExecution(messageId: string, executionId: string): Promise<void>;
}

/**
 * 追加事件的输入：`eventId` 与 `sequence` 都由实现分配。
 * sequence 必须来自存储（同 session 内单调递增且唯一），不能由调用方按时间戳猜。
 */
export type AppendSessionEventInput = Omit<SessionEvent, 'eventId' | 'sequence'>;

export interface SessionEventRepository {
  /** 追加事件（sequence 由实现分配，同 session 内单调递增且唯一） */
  append(input: AppendSessionEventInput): Promise<SessionEvent>;
  /** 游标回放：sequence 严格大于 afterSequence 的事件（顺序升序） */
  listAfter(sessionId: string, afterSequence: number, limit?: number): Promise<SessionEvent[]>;
}

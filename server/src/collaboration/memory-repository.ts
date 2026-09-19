import { randomUUID } from 'node:crypto';
import type {
  AppendSessionEventInput,
  CreateMessageInput,
  MessageRepository,
  ParticipantRepository,
  SessionEventRepository,
} from './repository.js';
import type {
  AgentMessage,
  SessionEvent,
  SessionParticipant,
  SessionParticipantRole,
  SessionParticipantStatus,
} from './types.js';

/**
 * 协作层内存实现（单测与 `COPILOT_STATE_BACKEND=memory`）。
 * 运行期用 `sql-repository.ts` 的实现，两套接口一致。
 */

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export class MemoryParticipantRepository implements ParticipantRepository {
  private rows = new Map<string, SessionParticipant>();
  private key = (sessionId: string, userId: string): string => `${sessionId}\u0000${userId}`;

  async upsert(input: {
    sessionId: string;
    tenantId: string;
    userId: string;
    role: SessionParticipantRole;
    status?: SessionParticipantStatus;
    joinedAt: string;
  }): Promise<SessionParticipant> {
    const row: SessionParticipant = {
      sessionId: input.sessionId,
      tenantId: input.tenantId,
      userId: input.userId,
      role: input.role,
      status: input.status ?? 'active',
      joinedAt: input.joinedAt,
    };
    this.rows.set(this.key(input.sessionId, input.userId), row);
    return clone(row);
  }

  async get(sessionId: string, userId: string): Promise<SessionParticipant | undefined> {
    const row = this.rows.get(this.key(sessionId, userId));
    return row ? clone(row) : undefined;
  }

  async list(sessionId: string): Promise<SessionParticipant[]> {
    return [...this.rows.values()]
      .filter((r) => r.sessionId === sessionId)
      .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt))
      .map(clone);
  }

  async listActiveSessionIds(tenantId: string, userId: string): Promise<string[]> {
    return [...this.rows.values()]
      .filter((r) => r.tenantId === tenantId && r.userId === userId && r.status === 'active')
      .map((r) => r.sessionId);
  }

  async setStatus(
    sessionId: string,
    userId: string,
    status: SessionParticipantStatus,
    leftAt?: string,
  ): Promise<SessionParticipant | undefined> {
    const k = this.key(sessionId, userId);
    const row = this.rows.get(k);
    if (!row) return undefined;
    const next: SessionParticipant = { ...row, status, ...(leftAt ? { leftAt } : {}) };
    this.rows.set(k, next);
    return clone(next);
  }

  clear(): void {
    this.rows.clear();
  }
}

export class MemoryMessageRepository implements MessageRepository {
  private rows: AgentMessage[] = [];
  private seq = new Map<string, number>();

  async create(
    input: CreateMessageInput,
  ): Promise<{ message: AgentMessage; created: boolean }> {
    if (input.clientMessageId) {
      const dup = this.rows.find(
        (m) => m.sessionId === input.sessionId && m.clientMessageId === input.clientMessageId,
      );
      if (dup) return { message: clone(dup), created: false };
    }
    const sequence = (this.seq.get(input.sessionId) ?? 0) + 1;
    this.seq.set(input.sessionId, sequence);
    const message: AgentMessage = {
      messageId: `msg_${randomUUID()}`,
      sessionId: input.sessionId,
      tenantId: input.tenantId,
      sequence,
      actorType: input.actorType,
      ...(input.actorId ? { actorId: input.actorId } : {}),
      ...(input.clientMessageId ? { clientMessageId: input.clientMessageId } : {}),
      content: input.content,
      ...(input.executionId ? { executionId: input.executionId } : {}),
      createdAt: input.createdAt,
    };
    this.rows.push(message);
    return { message: clone(message), created: true };
  }

  async get(messageId: string): Promise<AgentMessage | undefined> {
    const row = this.rows.find((m) => m.messageId === messageId);
    return row ? clone(row) : undefined;
  }

  async list(sessionId: string, limit = 100): Promise<AgentMessage[]> {
    const n = Math.max(1, Math.min(500, limit));
    return this.rows
      .filter((m) => m.sessionId === sessionId)
      .sort((a, b) => a.sequence - b.sequence)
      .slice(-n)
      .map(clone);
  }

  async attachExecution(messageId: string, executionId: string): Promise<void> {
    const row = this.rows.find((m) => m.messageId === messageId);
    if (row) row.executionId = executionId;
  }

  clear(): void {
    this.rows = [];
    this.seq.clear();
  }
}

export class MemorySessionEventRepository implements SessionEventRepository {
  private rows = new Map<string, SessionEvent[]>();
  /** 与 SQL 侧的 agent_session.event_sequence 同义：独立计数器，不靠数组长度推算 */
  private seq = new Map<string, number>();

  async append(input: AppendSessionEventInput): Promise<SessionEvent> {
    const list = this.rows.get(input.sessionId) ?? [];
    const sequence = (this.seq.get(input.sessionId) ?? 0) + 1;
    this.seq.set(input.sessionId, sequence);
    const event: SessionEvent = {
      ...clone(input),
      sequence,
      eventId: `sev_${randomUUID()}`,
    };
    list.push(event);
    this.rows.set(input.sessionId, list);
    return clone(event);
  }

  async listAfter(
    sessionId: string,
    afterSequence: number,
    limit = 500,
  ): Promise<SessionEvent[]> {
    const n = Math.max(1, Math.min(1000, limit));
    return (this.rows.get(sessionId) ?? [])
      .filter((e) => e.sequence > afterSequence)
      .slice(0, n)
      .map(clone);
  }

  clear(): void {
    this.rows.clear();
    this.seq.clear();
  }
}

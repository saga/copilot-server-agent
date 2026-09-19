import { randomUUID } from 'node:crypto';
import { currentDialect, getDb } from '../db/connection.js';
import { jsonParam, type SqlRow } from '../db/dialect.js';
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
 * 协作层的 SQL 仓储（PostgreSQL 与 SQLite 共用这一份实现）。
 * 方言差异走 `currentDialect()`，这里不出现 `if (backend === ...)`。
 */

const d = (): ReturnType<typeof currentDialect> => currentDialect();

function toParticipant(r: SqlRow): SessionParticipant {
  return {
    sessionId: String(r.session_id),
    tenantId: String(r.tenant_id),
    userId: String(r.user_id),
    role: r.role as SessionParticipantRole,
    status: r.status as SessionParticipantStatus,
    joinedAt: d().ts(r.joined_at) ?? new Date(0).toISOString(),
    ...(r.left_at ? { leftAt: d().ts(r.left_at) } : {}),
  };
}

function toMessage(r: SqlRow): AgentMessage {
  return {
    messageId: String(r.message_id),
    sessionId: String(r.session_id),
    tenantId: String(r.tenant_id),
    sequence: Number(r.sequence),
    actorType: r.actor_type as AgentMessage['actorType'],
    ...(typeof r.actor_id === 'string' ? { actorId: r.actor_id } : {}),
    ...(typeof r.client_message_id === 'string' ? { clientMessageId: r.client_message_id } : {}),
    content: String(r.content),
    ...(typeof r.execution_id === 'string' ? { executionId: r.execution_id } : {}),
    createdAt: d().ts(r.created_at) ?? new Date(0).toISOString(),
  };
}

function toEvent(r: SqlRow): SessionEvent {
  return {
    eventId: String(r.event_id),
    sessionId: String(r.session_id),
    sequence: Number(r.sequence),
    type: String(r.type),
    actorType: r.actor_type as SessionEvent['actorType'],
    ...(typeof r.actor_id === 'string' ? { actorId: r.actor_id } : {}),
    ...(typeof r.execution_id === 'string' ? { executionId: r.execution_id } : {}),
    ...(typeof r.message_id === 'string' ? { messageId: r.message_id } : {}),
    ...(r.payload ? { payload: d().json<Record<string, unknown>>(r.payload) } : {}),
    createdAt: d().ts(r.created_at) ?? new Date(0).toISOString(),
  };
}

export class SqlParticipantRepository implements ParticipantRepository {
  async upsert(input: {
    sessionId: string;
    tenantId: string;
    userId: string;
    role: SessionParticipantRole;
    status?: SessionParticipantStatus;
    joinedAt: string;
  }): Promise<SessionParticipant> {
    const dialect = d();
    const ph = (i: number): string => dialect.ph(i);
    const { rows } = await getDb().query<SqlRow>(
      `insert into session_participant
         (session_id, tenant_id, user_id, role, status, joined_at, left_at)
       values (${ph(1)},${ph(2)},${ph(3)},${ph(4)},${ph(5)},${ph(6)},null)
       on conflict (session_id, user_id) do update set
         tenant_id = excluded.tenant_id,
         role = excluded.role,
         status = excluded.status,
         joined_at = excluded.joined_at,
         left_at = null
       returning *`,
      [
        input.sessionId,
        input.tenantId,
        input.userId,
        input.role,
        input.status ?? 'active',
        dialect.tsParam(input.joinedAt),
      ],
    );
    return toParticipant(rows[0]!);
  }

  async get(sessionId: string, userId: string): Promise<SessionParticipant | undefined> {
    const dialect = d();
    const { rows } = await getDb().query<SqlRow>(
      `select * from session_participant
       where session_id = ${dialect.ph(1)} and user_id = ${dialect.ph(2)}`,
      [sessionId, userId],
    );
    return rows[0] ? toParticipant(rows[0]) : undefined;
  }

  async list(sessionId: string): Promise<SessionParticipant[]> {
    const dialect = d();
    const { rows } = await getDb().query<SqlRow>(
      `select * from session_participant where session_id = ${dialect.ph(1)}
       order by joined_at asc`,
      [sessionId],
    );
    return rows.map(toParticipant);
  }

  async listActiveSessionIds(tenantId: string, userId: string): Promise<string[]> {
    const dialect = d();
    const { rows } = await getDb().query<SqlRow>(
      `select session_id from session_participant
       where tenant_id = ${dialect.ph(1)} and user_id = ${dialect.ph(2)} and status = 'active'`,
      [tenantId, userId],
    );
    return rows.map((r) => String(r.session_id));
  }

  async setStatus(
    sessionId: string,
    userId: string,
    status: SessionParticipantStatus,
    leftAt?: string,
  ): Promise<SessionParticipant | undefined> {
    const dialect = d();
    const { rows } = await getDb().query<SqlRow>(
      `update session_participant
       set status = ${dialect.ph(1)}, left_at = ${dialect.ph(2)}
       where session_id = ${dialect.ph(3)} and user_id = ${dialect.ph(4)}
       returning *`,
      [status, leftAt ? dialect.tsParam(leftAt) : null, sessionId, userId],
    );
    return rows[0] ? toParticipant(rows[0]) : undefined;
  }
}

export class SqlMessageRepository implements MessageRepository {
  /**
   * sequence 从 `agent_session.message_sequence` 原子自增分配：
   * 时间戳在并发下会并列，不能做唯一次序；对 session 行加更新天然把同一 session 的分配串行化。
   * client_message_id 重复时返回已有记录（客户端重试不产生第二条消息）。
   */
  async create(
    input: CreateMessageInput,
  ): Promise<{ message: AgentMessage; created: boolean }> {
    const dialect = d();
    const ph = (i: number): string => dialect.ph(i);
    return getDb().transaction(async (tx) => {
      if (input.clientMessageId) {
        const dup = await tx.query<SqlRow>(
          `select * from agent_message
           where session_id = ${ph(1)} and client_message_id = ${ph(2)}`,
          [input.sessionId, input.clientMessageId],
        );
        if (dup.rows[0]) return { message: toMessage(dup.rows[0]), created: false };
      }

      const bumped = await tx.query<SqlRow>(
        `update agent_session
         set message_sequence = message_sequence + 1
         where session_id = ${ph(1)}
         returning message_sequence`,
        [input.sessionId],
      );
      const sequence = Number(bumped.rows[0]?.message_sequence);
      if (!sequence) throw new Error(`session 不存在："${input.sessionId}"`);

      const { rows } = await tx.query<SqlRow>(
        `insert into agent_message
           (message_id, session_id, tenant_id, sequence, actor_type, actor_id,
            client_message_id, content, execution_id, created_at)
         values (${ph(1)},${ph(2)},${ph(3)},${ph(4)},${ph(5)},${ph(6)},${ph(7)},${ph(8)},${ph(9)},${ph(10)})
         on conflict (session_id, client_message_id) do nothing
         returning *`,
        [
          `msg_${randomUUID()}`,
          input.sessionId,
          input.tenantId,
          sequence,
          input.actorType,
          input.actorId ?? null,
          input.clientMessageId ?? null,
          input.content,
          input.executionId ?? null,
          dialect.tsParam(input.createdAt),
        ],
      );
      if (rows[0]) return { message: toMessage(rows[0]), created: true };

      // 并发下被同 client key 的另一次请求抢先：返回那条，本次不再建 execution
      const again = await tx.query<SqlRow>(
        `select * from agent_message
         where session_id = ${ph(1)} and client_message_id = ${ph(2)}`,
        [input.sessionId, input.clientMessageId],
      );
      return { message: toMessage(again.rows[0]!), created: false };
    });
  }

  async get(messageId: string): Promise<AgentMessage | undefined> {
    const dialect = d();
    const { rows } = await getDb().query<SqlRow>(
      `select * from agent_message where message_id = ${dialect.ph(1)}`,
      [messageId],
    );
    return rows[0] ? toMessage(rows[0]) : undefined;
  }

  async list(sessionId: string, limit = 100): Promise<AgentMessage[]> {
    const dialect = d();
    const n = Math.max(1, Math.min(500, limit));
    const { rows } = await getDb().query<SqlRow>(
      `select * from agent_message where session_id = ${dialect.ph(1)}
       order by sequence desc limit ${dialect.ph(2)}`,
      [sessionId, n],
    );
    return rows.map(toMessage).reverse();
  }

  async attachExecution(messageId: string, executionId: string): Promise<void> {
    const dialect = d();
    await getDb().query(
      `update agent_message set execution_id = ${dialect.ph(1)} where message_id = ${dialect.ph(2)}`,
      [executionId, messageId],
    );
  }
}

export class SqlSessionEventRepository implements SessionEventRepository {
  /**
   * sequence 从 `agent_session.event_sequence` 原子自增分配。
   *
   * 不用 `max(sequence)+1`：两个并发 append 会读到同一个 max、算出同一个序号，
   * 后到的被 `on conflict do nothing` 静默丢弃 —— 但调用方拿到的却是一个"成功"的序号，
   * 于是 SSE 游标里永远缺一条、客户端也不会报错。`update ... returning` 天然把
   * 同一 session 的分配串行化（与 agent_message.sequence 同一套做法）。
   */
  async append(input: AppendSessionEventInput): Promise<SessionEvent> {
    const dialect = d();
    return getDb().transaction(async (tx) => {
      const bumped = await tx.query<SqlRow>(
        `update agent_session
         set event_sequence = event_sequence + 1
         where session_id = ${dialect.ph(1)}
         returning event_sequence`,
        [input.sessionId],
      );
      const sequence = Number(bumped.rows[0]?.event_sequence);
      if (!sequence) throw new Error(`session 不存在："${input.sessionId}"`);

      const createdAt = input.createdAt;
      const { rows } = await tx.query<SqlRow>(
        `insert into session_event
           (session_id, sequence, type, actor_type, actor_id, execution_id, message_id, payload, created_at)
         values (${dialect.ph(1)},${dialect.ph(2)},${dialect.ph(3)},${dialect.ph(4)},${dialect.ph(5)},${dialect.ph(6)},${dialect.ph(7)},${dialect.ph(8)},${dialect.ph(9)})
         returning event_id`,
        [
          input.sessionId,
          sequence,
          input.type,
          input.actorType,
          input.actorId ?? null,
          input.executionId ?? null,
          input.messageId ?? null,
          jsonParam(input.payload),
          dialect.tsParam(createdAt),
        ],
      );
      const eventId = rows[0]?.event_id;
      // 序号来自原子自增，冲突说明有并发写入绕过了分配器 —— 抛错，别伪装成成功
      if (eventId === undefined || eventId === null) {
        throw new Error(
          `session_event 写入失败（序号冲突？）：session=${input.sessionId} sequence=${sequence}`,
        );
      }
      return {
        eventId: String(eventId),
        sessionId: input.sessionId,
        sequence,
        type: input.type,
        actorType: input.actorType,
        ...(input.actorId ? { actorId: input.actorId } : {}),
        ...(input.executionId ? { executionId: input.executionId } : {}),
        ...(input.messageId ? { messageId: input.messageId } : {}),
        ...(input.payload ? { payload: input.payload } : {}),
        createdAt,
      };
    });
  }

  async listAfter(
    sessionId: string,
    afterSequence: number,
    limit = 500,
  ): Promise<SessionEvent[]> {
    const dialect = d();
    const n = Math.max(1, Math.min(1000, limit));
    const { rows } = await getDb().query<SqlRow>(
      `select * from session_event
       where session_id = ${dialect.ph(1)} and sequence > ${dialect.ph(2)}
       order by sequence asc limit ${dialect.ph(3)}`,
      [sessionId, afterSequence, n],
    );
    return rows.map(toEvent);
  }
}

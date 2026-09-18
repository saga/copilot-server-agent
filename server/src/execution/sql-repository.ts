import { currentDialect, getDb } from '../db/connection.js';
import { jsonParam, type SqlRow } from '../db/dialect.js';
import type { EventRepository, ExecutionRepository, ExecutionStats } from './repository.js';
import type {
  ExecutionEvent,
  ExecutionFilter,
  ExecutionRecord,
  ToolCallRecord,
} from './types.js';

/**
 * execution / event 的 SQL 仓储（PostgreSQL 与 SQLite 共用这一份实现）。
 *
 * 所有方言差异走 `currentDialect()` 的钩子：占位符、JSON 列编解码、布尔/时间戳表示、
 * 数组长度、聚合取整。这里不出现 `if (backend === ...)`。
 */

const d = (): ReturnType<typeof currentDialect> => currentDialect();

type ExecutionRow = SqlRow & {
  execution_id: string;
  session_id: string;
  tenant_id: string;
  user_id: string;
  kind: string;
  status: string;
};

function toRecord(r: ExecutionRow): ExecutionRecord {
  const dialect = d();
  const iso = (v: unknown): string | undefined => dialect.ts(v);
  return {
    executionId: String(r.execution_id),
    sessionId: String(r.session_id),
    tenantId: String(r.tenant_id),
    userId: String(r.user_id),
    kind: (r.kind ?? 'interactive') as ExecutionRecord['kind'],
    status: r.status as ExecutionRecord['status'],
    createdAt: iso(r.created_at) ?? new Date(0).toISOString(),
    updatedAt: iso(r.updated_at) ?? new Date(0).toISOString(),
    ...(iso(r.started_at) ? { startedAt: iso(r.started_at) } : {}),
    ...(iso(r.completed_at) ? { completedAt: iso(r.completed_at) } : {}),
    ...(typeof r.duration_ms === 'number' ? { durationMs: r.duration_ms } : {}),
    ...(r.input !== null && r.input !== undefined ? { input: dialect.json(r.input) } : {}),
    ...(typeof r.prompt_preview === 'string' ? { promptPreview: r.prompt_preview } : {}),
    ...(typeof r.model === 'string' ? { model: r.model } : {}),
    streaming: dialect.bool(r.streaming),
    ...(r.action_intent ? { actionIntent: dialect.json<ExecutionRecord['actionIntent']>(r.action_intent) } : {}),
    ...(typeof r.action_hash === 'string' ? { actionHash: r.action_hash } : {}),
    ...(typeof r.resource_version === 'string' ? { resourceVersion: r.resource_version } : {}),
    ...(typeof r.approved_resource_version === 'string'
      ? { approvedResourceVersion: r.approved_resource_version }
      : {}),
    ...(typeof r.current_human_task_id === 'string'
      ? { currentHumanTaskId: r.current_human_task_id }
      : {}),
    ...(typeof r.wait_reason === 'string' ? { waitReason: r.wait_reason as 'input' | 'approval' } : {}),
    ...(r.result !== null && r.result !== undefined ? { result: dialect.json(r.result) } : {}),
    ...(typeof r.content_chars === 'number' ? { contentChars: r.content_chars } : {}),
    ...(typeof r.error === 'string' ? { error: r.error } : {}),
    ...(r.usage ? { usage: dialect.json<ExecutionRecord['usage']>(r.usage) } : {}),
    toolCalls: dialect.json<ToolCallRecord[]>(r.tool_calls) ?? [],
    ...(typeof r.tool_calls_omitted === 'number' ? { toolCallsOmitted: r.tool_calls_omitted } : {}),
  };
}

const COLUMNS = [
  'execution_id',
  'session_id',
  'tenant_id',
  'user_id',
  'kind',
  'status',
  'input',
  'result',
  'content_chars',
  'action_intent',
  'action_hash',
  'resource_version',
  'approved_resource_version',
  'current_human_task_id',
  'wait_reason',
  'model',
  'streaming',
  'prompt_preview',
  'usage',
  'tool_calls',
  'tool_calls_omitted',
  'error',
  'started_at',
  'completed_at',
  'duration_ms',
  'created_at',
  'updated_at',
] as const;

/** 与 COLUMNS 一一对应 */
function toValues(rec: ExecutionRecord): unknown[] {
  const dialect = d();
  return [
    rec.executionId,
    rec.sessionId,
    rec.tenantId,
    rec.userId,
    rec.kind,
    rec.status,
    jsonParam(rec.input),
    jsonParam(rec.result),
    rec.contentChars ?? null,
    jsonParam(rec.actionIntent),
    rec.actionHash ?? null,
    rec.resourceVersion ?? null,
    rec.approvedResourceVersion ?? null,
    rec.currentHumanTaskId ?? null,
    rec.waitReason ?? null,
    rec.model ?? null,
    rec.streaming,
    rec.promptPreview ?? null,
    jsonParam(rec.usage),
    jsonParam(rec.toolCalls ?? []),
    rec.toolCallsOmitted ?? 0,
    rec.error ?? null,
    rec.startedAt ? dialect.tsParam(rec.startedAt) : null,
    rec.completedAt ? dialect.tsParam(rec.completedAt) : null,
    rec.durationMs ?? null,
    dialect.tsParam(rec.createdAt),
    dialect.tsParam(new Date().toISOString()),
  ];
}

function upsertSql(): string {
  const dialect = d();
  const cols = COLUMNS.join(', ');
  const placeholders = COLUMNS.map((_, i) => dialect.ph(i + 1)).join(', ');
  const updates = COLUMNS.filter((c) => c !== 'execution_id' && c !== 'created_at')
    .map((c) => `${c} = excluded.${c}`)
    .join(', ');
  return `insert into agent_execution (${cols}) values (${placeholders})
          on conflict (execution_id) do update set ${updates}
          returning *`;
}

export class SqlExecutionRepository implements ExecutionRepository {
  async create(record: ExecutionRecord): Promise<ExecutionRecord> {
    const { rows } = await getDb().query<ExecutionRow>(upsertSql(), toValues(record));
    return toRecord(rows[0]!);
  }

  async get(executionId: string): Promise<ExecutionRecord | undefined> {
    const dialect = d();
    const { rows } = await getDb().query<ExecutionRow>(
      `select * from agent_execution where execution_id = ${dialect.ph(1)}`,
      [executionId],
    );
    const row = rows[0];
    return row ? toRecord(row) : undefined;
  }

  async update(
    executionId: string,
    patch: Partial<ExecutionRecord>,
  ): Promise<ExecutionRecord | undefined> {
    const current = await this.get(executionId);
    if (!current) return undefined;
    const merged: ExecutionRecord = { ...current, ...patch, updatedAt: new Date().toISOString() };
    const { rows } = await getDb().query<ExecutionRow>(upsertSql(), toValues(merged));
    return rows[0] ? toRecord(rows[0]) : undefined;
  }

  async list(filter: ExecutionFilter = {}): Promise<ExecutionRecord[]> {
    const dialect = d();
    const where: string[] = [];
    const params: unknown[] = [];
    const push = (col: string, value: unknown): void => {
      params.push(value);
      where.push(`${col} = ${dialect.ph(params.length)}`);
    };
    if (filter.sessionId) push('session_id', filter.sessionId);
    if (filter.tenantId) push('tenant_id', filter.tenantId);
    if (filter.userId) push('user_id', filter.userId);
    if (filter.status) push('status', filter.status);
    const limit = Math.max(1, Math.min(500, filter.limit ?? 50));
    params.push(limit);
    const { rows } = await getDb().query<ExecutionRow>(
      `select * from agent_execution
       ${where.length ? `where ${where.join(' and ')}` : ''}
       order by created_at desc limit ${dialect.ph(params.length)}`,
      params,
    );
    return rows.map(toRecord);
  }

  async stats(): Promise<ExecutionStats> {
    const dialect = d();
    const { rows } = await getDb().query<SqlRow>(
      `select
         ${dialect.asInt('count(*)')} as tracked,
         ${dialect.asInt("count(*) filter (where status = 'running')")} as running,
         ${dialect.asInt(
           "count(*) filter (where status in ('waiting_for_input','waiting_for_approval'))",
         )} as waiting,
         ${dialect.asInt(
           `coalesce(sum(${dialect.arrayLength('tool_calls')} + tool_calls_omitted), 0)`,
         )} as tool_calls
       from agent_execution`,
    );
    const r = rows[0] ?? {};
    return {
      tracked: Number(r.tracked ?? 0),
      running: Number(r.running ?? 0),
      waiting: Number(r.waiting ?? 0),
      toolCalls: Number(r.tool_calls ?? 0),
      backend: dialect.name,
    };
  }
}

export class SqlEventRepository implements EventRepository {
  async append(input: Omit<ExecutionEvent, 'eventId'>): Promise<ExecutionEvent> {
    const dialect = d();
    return getDb().transaction(async (tx) => {
      const seq = await tx.query<SqlRow>(
        `select coalesce(max(sequence), 0) + 1 as seq from execution_event
         where execution_id = ${dialect.ph(1)}`,
        [input.executionId],
      );
      const sequence = Number(seq.rows[0]?.seq ?? 1);
      const createdAt = input.createdAt ?? new Date().toISOString();
      const { rows } = await tx.query<SqlRow>(
        `insert into execution_event (execution_id, sequence, type, actor_type, actor_id, payload, created_at)
         values (${dialect.ph(1)}, ${dialect.ph(2)}, ${dialect.ph(3)}, ${dialect.ph(4)}, ${dialect.ph(5)}, ${dialect.ph(6)}, ${dialect.ph(7)})
         on conflict (execution_id, sequence) do nothing
         returning event_id`,
        [
          input.executionId,
          sequence,
          input.type,
          input.actorType,
          input.actorId ?? null,
          jsonParam(input.payload),
          dialect.tsParam(createdAt),
        ],
      );
      return {
        eventId: String(rows[0]?.event_id ?? `${input.executionId}-${sequence}`),
        executionId: input.executionId,
        sequence,
        type: input.type,
        actorType: input.actorType,
        ...(input.actorId ? { actorId: input.actorId } : {}),
        ...(input.payload ? { payload: input.payload } : {}),
        createdAt,
      };
    });
  }

  async list(executionId: string, limit = 100): Promise<ExecutionEvent[]> {
    const dialect = d();
    const n = Math.max(1, Math.min(500, limit));
    const { rows } = await getDb().query<SqlRow>(
      `select * from execution_event where execution_id = ${dialect.ph(1)}
       order by sequence desc limit ${dialect.ph(2)}`,
      [executionId, n],
    );
    return rows
      .map((r) => ({
        eventId: String(r.event_id),
        executionId: String(r.execution_id),
        sequence: Number(r.sequence),
        type: String(r.type),
        actorType: r.actor_type as ExecutionEvent['actorType'],
        ...(typeof r.actor_id === 'string' ? { actorId: r.actor_id } : {}),
        ...(r.payload ? { payload: dialect.json<Record<string, unknown>>(r.payload) } : {}),
        createdAt: dialect.ts(r.created_at) ?? new Date(0).toISOString(),
      }))
      .reverse();
  }
}

import { currentDialect, getDb } from '../db/connection.js';
import { jsonParam, type SqlRow } from '../db/dialect.js';
import type {
  AppendExecutionEventInput,
  EventRepository,
  ExecutionRepository,
  ExecutionStats,
} from './repository.js';
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
    // 发起人与数据归属是两个字段：userId 是会话 owner，initiatedByUserId 是发起人。
    // 读回来必须带上，否则 shared 会话的队列从 created 恢复输入时会拿不到 sourceMessageId。
    ...(typeof r.initiated_by_user_id === 'string'
      ? { initiatedByUserId: r.initiated_by_user_id }
      : {}),
    ...(typeof r.source_message_id === 'string' ? { sourceMessageId: r.source_message_id } : {}),
    // 队列定序键（= 来源消息的 sequence）。读回来才能让单测比对"消息顺序 = 队列顺序"。
    ...(typeof r.queue_sequence === 'number' ? { queueSequence: r.queue_sequence } : {}),
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
    // Skill Flow 的编排状态：读回来，重启后的续跑才知道"停在哪个节点"
    ...(r.workflow_state ? { workflow: dialect.json<ExecutionRecord['workflow']>(r.workflow_state) } : {}),
    // 单写者版本号：**只读**，只由 compareAndSwapWorkflowState 抬高（见 repository.ts）
    ...(typeof r.workflow_version === 'number' ? { workflowVersion: r.workflow_version } : {}),
    ...(r.result !== null && r.result !== undefined ? { result: dialect.json(r.result) } : {}),
    ...(typeof r.content_chars === 'number' ? { contentChars: r.content_chars } : {}),
    ...(typeof r.error === 'string' ? { error: r.error } : {}),
    ...(r.usage ? { usage: dialect.json<ExecutionRecord['usage']>(r.usage) } : {}),
    toolCalls: dialect.json<ToolCallRecord[]>(r.tool_calls) ?? [],
    ...(typeof r.tool_calls_omitted === 'number' ? { toolCallsOmitted: r.tool_calls_omitted } : {}),
  };
}

/**
 * 可整行 upsert 的列。
 *
 * `workflow_version` **刻意不在这里**：它是 CAS 的版本号，只能由
 * `compareAndSwapWorkflowState()` 用 `workflow_version = workflow_version + 1` 抬高。
 * 若把它放进整行 upsert，一次 `addUsage()`（读 → 合并 → 写回）就会把刚被 CAS 抬高的
 * 版本号写回它读到的旧值 —— 两个并发推进者又能互相覆盖，CAS 就白做了。
 * 建行时由 DDL 的 `default 0` 兜底。
 */
const COLUMNS = [
  'execution_id',
  'session_id',
  'tenant_id',
  'user_id',
  'initiated_by_user_id',
  'source_message_id',
  'queue_sequence',
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
  'workflow_state',
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
    rec.initiatedByUserId ?? null,
    rec.sourceMessageId ?? null,
    rec.queueSequence ?? null,
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
    jsonParam(rec.workflow),
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

  /**
   * 单写者 / CAS：只有拿到当前版本号的写者能落地。
   *
   * 条件更新在 PostgreSQL 与 SQLite 上都是原子的（行级写锁），所以两个副本同时推进时
   * 只有一个 `returning *` 会给出结果 —— 另一个拿到空集，必须停止推进。
   */
  async compareAndSwapWorkflowState(
    executionId: string,
    expectedVersion: number,
    workflow: ExecutionRecord['workflow'],
  ): Promise<ExecutionRecord | undefined> {
    const dialect = d();
    const { rows } = await getDb().query<ExecutionRow>(
      `update agent_execution
          set workflow_state = ${dialect.ph(1)},
              workflow_version = workflow_version + 1,
              updated_at = ${dialect.ph(2)}
        where execution_id = ${dialect.ph(3)}
          and workflow_version = ${dialect.ph(4)}
        returning *`,
      [
        jsonParam(workflow),
        dialect.tsParam(new Date().toISOString()),
        executionId,
        expectedVersion,
      ],
    );
    const row = rows[0];
    return row ? toRecord(row) : undefined;
  }

  async list(filter: ExecutionFilter = {}): Promise<ExecutionRecord[]> {    const dialect = d();
    const where: string[] = [];
    const params: unknown[] = [];
    const push = (col: string, value: unknown): void => {
      params.push(value);
      where.push(`${col} = ${dialect.ph(params.length)}`);
    };
    if (filter.sessionId) push('session_id', filter.sessionId);
    if (filter.sessionIds) {
      if (!filter.sessionIds.length) return [];
      // 动态占位：数量取决于调用方可访问的 session 数
      const placeholders = filter.sessionIds.map((id) => {
        params.push(id);
        return dialect.ph(params.length);
      });
      where.push(`session_id in (${placeholders.join(', ')})`);
    }
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

  /**
   * 队列取活：FIFO，按 `queue_sequence`（= 来源消息 sequence）升序。
   *
   * 不用 created_at 定序：它是毫秒级 ISO 串，两个并发提交的 execution 建行顺序
   * 可能与消息落库顺序相反，而 FIFO 必须等于 transcript 顺序（用户看到的顺序 =
   * agent 实际处理顺序）。次级键 execution_id 让两个后端给出同一答案。
   */
  async nextQueued(sessionId: string): Promise<ExecutionRecord | undefined> {
    const dialect = d();
    const { rows } = await getDb().query<ExecutionRow>(
      `select * from agent_execution
       where session_id = ${dialect.ph(1)}
         and status = 'created'
         and source_message_id is not null
         and queue_sequence is not null
       order by queue_sequence asc, execution_id asc limit 1`,
      [sessionId],
    );
    const row = rows[0];
    return row ? toRecord(row) : undefined;
  }

  async queuedSessionIds(): Promise<string[]> {
    const { rows } = await getDb().query<SqlRow>(
      `select distinct session_id from agent_execution
       where status = 'created' and source_message_id is not null`,
    );
    return rows.map((r) => String(r.session_id));
  }

  /**
   * 启动恢复：把 running/resuming 落成 interrupted 终态。
   * duration_ms 刻意不补：进程被 kill，这段"时长"没有意义，留空比编一个数字诚实。
   */
  async interruptActive(reason: string): Promise<ExecutionRecord[]> {
    const dialect = d();
    const now = new Date().toISOString();
    const { rows } = await getDb().query<ExecutionRow>(
      `update agent_execution
       set status = 'interrupted',
           updated_at = ${dialect.ph(1)},
           completed_at = coalesce(completed_at, ${dialect.ph(1)}),
           error = coalesce(error, ${dialect.ph(2)})
       where status in ('running', 'resuming')
       returning *`,
      [dialect.tsParam(now), reason],
    );
    return rows.map(toRecord);
  }

  async stats(): Promise<ExecutionStats> {    const dialect = d();
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
  /**
   * sequence 从 `agent_execution.event_sequence` 原子自增分配。
   *
   * 不用 `max(sequence)+1`：两个并发 append 会读到同一个 max、算出同一个序号，
   * 后到的被 `on conflict do nothing` 静默丢弃 —— 但调用方拿到的却是一个"成功"的
   * 序号，于是审计链少一条事件而没人知道。`update ... returning` 天然串行化同一 execution。
   */
  async append(input: AppendExecutionEventInput): Promise<ExecutionEvent> {
    const dialect = d();
    return getDb().transaction(async (tx) => {
      const bumped = await tx.query<SqlRow>(
        `update agent_execution
         set event_sequence = event_sequence + 1
         where execution_id = ${dialect.ph(1)}
         returning event_sequence`,
        [input.executionId],
      );
      const sequence = Number(bumped.rows[0]?.event_sequence);
      if (!sequence) throw new Error(`execution 不存在："${input.executionId}"`);

      const createdAt = input.createdAt ?? new Date().toISOString();
      const { rows } = await tx.query<SqlRow>(
        `insert into execution_event (execution_id, sequence, type, actor_type, actor_id, payload, created_at)
         values (${dialect.ph(1)}, ${dialect.ph(2)}, ${dialect.ph(3)}, ${dialect.ph(4)}, ${dialect.ph(5)}, ${dialect.ph(6)}, ${dialect.ph(7)})
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
      const eventId = rows[0]?.event_id;
      // 序号来自原子自增，冲突说明有并发写入绕过了分配器 —— 抛错，别伪装成成功
      if (eventId === undefined || eventId === null) {
        throw new Error(
          `execution_event 写入失败（序号冲突？）：execution=${input.executionId} sequence=${sequence}`,
        );
      }
      return {
        eventId: String(eventId),
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

import { randomUUID } from 'node:crypto';
import { getSql, type SqlRow } from '../db/pool.js';
import type { HumanTaskDecision } from '../approval/types.js';
import type { HumanTaskRepository } from './repository.js';
import type { HumanTask, HumanTaskFilter } from './types.js';

/** PostgreSQL 实现（表结构见 db/migrations/001_agent_execution.sql） */

const json = (v: unknown): string | null => (v === undefined ? null : JSON.stringify(v ?? null));

type TaskRow = SqlRow & { task_id: string };

function toTask(r: TaskRow): HumanTask {
  const iso = (v: unknown): string | undefined =>
    v === null || v === undefined ? undefined : v instanceof Date ? v.toISOString() : String(v);
  return {
    taskId: r.task_id,
    executionId: String(r.execution_id),
    tenantId: String(r.tenant_id),
    type: r.type as HumanTask['type'],
    status: r.status as HumanTask['status'],
    title: String(r.title),
    ...(typeof r.description === 'string' ? { description: r.description } : {}),
    payload: (r.payload as Record<string, unknown>) ?? {},
    ...(r.input_schema ? { inputSchema: r.input_schema as HumanTask['inputSchema'] } : {}),
    ...(r.input_values ? { inputValues: r.input_values as Record<string, unknown> } : {}),
    ...(typeof r.policy_id === 'string' ? { policyId: r.policy_id } : {}),
    ...(typeof r.strategy === 'string' ? { strategy: r.strategy as HumanTask['strategy'] } : {}),
    ...(typeof r.required_count === 'number' ? { requiredCount: r.required_count } : {}),
    eligibleRoles: (r.eligible_roles as string[]) ?? [],
    eligibleUsers: (r.eligible_users as string[]) ?? [],
    ...(typeof r.initiated_by === 'string' ? { initiatedBy: r.initiated_by } : {}),
    ...(iso(r.expires_at) ? { expiresAt: iso(r.expires_at) } : {}),
    createdAt: iso(r.created_at) ?? new Date(0).toISOString(),
    ...(iso(r.completed_at) ? { completedAt: iso(r.completed_at) } : {}),
    ...(typeof r.delegated_from === 'string' ? { delegatedFrom: r.delegated_from } : {}),
    ...(typeof r.delegated_to === 'string' ? { delegatedTo: r.delegated_to } : {}),
    ...(typeof r.delegated_by === 'string' ? { delegatedBy: r.delegated_by } : {}),
    ...(iso(r.delegated_at) ? { delegatedAt: iso(r.delegated_at) } : {}),
    ...(typeof r.delegation_reason === 'string' ? { delegationReason: r.delegation_reason } : {}),
  };
}

export class PostgresHumanTaskRepository implements HumanTaskRepository {
  async create(task: HumanTask): Promise<HumanTask> {
    const sql = getSql();
    const { rows } = await sql.query<TaskRow>(
      `insert into human_task (
         task_id, execution_id, tenant_id, type, status, title, description, payload,
         input_schema, policy_id, strategy, required_count, eligible_roles, eligible_users,
         initiated_by, expires_at, created_at
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       returning *`,
      [
        task.taskId,
        task.executionId,
        task.tenantId,
        task.type,
        task.status,
        task.title,
        task.description ?? null,
        json(task.payload),
        json(task.inputSchema),
        task.policyId ?? null,
        task.strategy ?? null,
        task.requiredCount ?? null,
        JSON.stringify(task.eligibleRoles ?? []),
        JSON.stringify(task.eligibleUsers ?? []),
        task.initiatedBy ?? null,
        task.expiresAt ?? null,
        task.createdAt,
      ],
    );
    return toTask(rows[0]!);
  }

  async get(taskId: string): Promise<HumanTask | undefined> {
    const sql = getSql();
    const { rows } = await sql.query<TaskRow>('select * from human_task where task_id = $1', [
      taskId,
    ]);
    return rows[0] ? toTask(rows[0]) : undefined;
  }

  async update(taskId: string, patch: Partial<HumanTask>): Promise<HumanTask | undefined> {
    const sql = getSql();
    const sets: string[] = [];
    const params: unknown[] = [];
    const col = (name: string, value: unknown): void => {
      params.push(value);
      sets.push(`${name} = $${params.length}`);
    };
    const assign: Partial<Record<keyof HumanTask, string>> = {
      status: 'status',
      description: 'description',
      payload: 'payload',
      inputValues: 'input_values',
      completedAt: 'completed_at',
      delegatedFrom: 'delegated_from',
      delegatedTo: 'delegated_to',
      delegatedBy: 'delegated_by',
      delegatedAt: 'delegated_at',
      delegationReason: 'delegation_reason',
    };
    for (const [key, column] of Object.entries(assign) as [keyof HumanTask, string][]) {
      const v = patch[key];
      if (v === undefined) continue;
      col(column, key === 'payload' || key === 'inputValues' ? json(v) : v);
    }
    if (!sets.length) return this.get(taskId);
    params.push(taskId);
    const { rows } = await sql.query<TaskRow>(
      `update human_task set ${sets.join(', ')} where task_id = $${params.length} returning *`,
      params,
    );
    return rows[0] ? toTask(rows[0]) : undefined;
  }

  async list(filter: HumanTaskFilter = {}): Promise<HumanTask[]> {
    const sql = getSql();
    const where: string[] = [];
    const params: unknown[] = [];
    const push = (expr: string, value: unknown): void => {
      params.push(value);
      where.push(expr.replace('$N', `$${params.length}`));
    };
    if (filter.executionId) push('execution_id = $N', filter.executionId);
    if (filter.tenantId) push('tenant_id = $N', filter.tenantId);
    if (filter.status) push('status = $N', filter.status);
    if (filter.type) push('type = $N', filter.type);
    if (filter.assignee) {
      // 有资格 = 角色命中 ∩ 或显式指派给用户 ∩ 或被委派给该用户
      params.push(filter.assignee.roles);
      const roles = `$${params.length}`;
      params.push(JSON.stringify([filter.assignee.userId]));
      const users = `$${params.length}`;
      params.push(filter.assignee.userId);
      const uid = `$${params.length}`;
      where.push(
        `(eligible_roles ?| ${roles}::text[] or eligible_users @> ${users}::jsonb or delegated_to = ${uid})`,
      );
    }
    const limit = Math.max(1, Math.min(500, filter.limit ?? 50));
    params.push(limit);
    const { rows } = await sql.query<TaskRow>(
      `select * from human_task
       ${where.length ? `where ${where.join(' and ')}` : ''}
       order by created_at desc limit $${params.length}`,
      params,
    );
    return rows.map(toTask);
  }

  async addDecision(decision: HumanTaskDecision): Promise<HumanTaskDecision> {
    const sql = getSql();
    const { rows } = await sql.query<SqlRow>(
      `insert into human_task_decision
         (decision_id, task_id, approver_id, approver_role, decision, comment, created_at)
       values ($1,$2,$3,$4,$5,$6,$7) returning decision_id`,
      [
        decision.decisionId || `dec_${randomUUID()}`,
        decision.taskId,
        decision.approverId,
        decision.approverRole,
        decision.decision,
        decision.comment ?? null,
        decision.createdAt,
      ],
    );
    return { ...decision, decisionId: String(rows[0]?.decision_id ?? decision.decisionId) };
  }

  async listDecisions(taskId: string): Promise<HumanTaskDecision[]> {
    const sql = getSql();
    const { rows } = await sql.query<SqlRow>(
      'select * from human_task_decision where task_id = $1 order by created_at asc',
      [taskId],
    );
    return rows.map((r) => ({
      decisionId: String(r.decision_id),
      taskId: String(r.task_id),
      approverId: String(r.approver_id),
      approverRole: String(r.approver_role),
      decision: r.decision as HumanTaskDecision['decision'],
      ...(typeof r.comment === 'string' ? { comment: r.comment } : {}),
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    }));
  }

  async listExpired(nowIso: string, limit = 100): Promise<HumanTask[]> {
    const sql = getSql();
    const { rows } = await sql.query<TaskRow>(
      `select * from human_task
       where status = 'open' and expires_at is not null and expires_at <= $1
       order by expires_at asc limit $2`,
      [nowIso, Math.max(1, Math.min(500, limit))],
    );
    return rows.map(toTask);
  }
}

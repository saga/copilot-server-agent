import { randomUUID } from 'node:crypto';
import { currentDialect, getDb } from '../db/connection.js';
import { jsonParam, parseTsValue, type SqlRow } from '../db/dialect.js';
import type { HumanTaskDecision } from '../approval/types.js';
import type { HumanTaskRepository } from './repository.js';
import type { HumanTask, HumanTaskFilter } from './types.js';

/** human task / decision 的 SQL 仓储（PostgreSQL 与 SQLite 共用这一份实现） */

const d = (): ReturnType<typeof currentDialect> => currentDialect();

type TaskRow = SqlRow & { task_id: string };

function toTask(r: TaskRow): HumanTask {
  const dialect = d();
  return {
    taskId: String(r.task_id),
    executionId: String(r.execution_id),
    tenantId: String(r.tenant_id),
    type: r.type as HumanTask['type'],
    status: r.status as HumanTask['status'],
    title: String(r.title),
    ...(typeof r.description === 'string' ? { description: r.description } : {}),
    payload: dialect.json<Record<string, unknown>>(r.payload) ?? {},
    ...(r.input_values ? { inputValues: dialect.json<Record<string, unknown>>(r.input_values) } : {}),
    ...(r.input_schema ? { inputSchema: dialect.json<HumanTask['inputSchema']>(r.input_schema) } : {}),
    ...(typeof r.policy_id === 'string' ? { policyId: r.policy_id } : {}),
    ...(typeof r.strategy === 'string' ? { strategy: r.strategy as HumanTask['strategy'] } : {}),
    ...(typeof r.required_count === 'number' ? { requiredCount: r.required_count } : {}),
    eligibleRoles: dialect.json<string[]>(r.eligible_roles) ?? [],
    eligibleUsers: dialect.json<string[]>(r.eligible_users) ?? [],
    ...(typeof r.initiated_by === 'string' ? { initiatedBy: r.initiated_by } : {}),
    ...(r.expires_at ? { expiresAt: dialect.ts(r.expires_at) } : {}),
    createdAt: dialect.ts(r.created_at) ?? new Date(0).toISOString(),
    ...(r.completed_at ? { completedAt: dialect.ts(r.completed_at) } : {}),
    ...(typeof r.delegated_from === 'string' ? { delegatedFrom: r.delegated_from } : {}),
    ...(typeof r.delegated_to === 'string' ? { delegatedTo: r.delegated_to } : {}),
    ...(typeof r.delegated_by === 'string' ? { delegatedBy: r.delegated_by } : {}),
    ...(r.delegated_at ? { delegatedAt: dialect.ts(r.delegated_at) } : {}),
    ...(typeof r.delegation_reason === 'string' ? { delegationReason: r.delegation_reason } : {}),
  };
}

export class SqlHumanTaskRepository implements HumanTaskRepository {
  async create(task: HumanTask): Promise<HumanTask> {
    const dialect = d();
    const ph = (i: number): string => dialect.ph(i);
    const { rows } = await getDb().query<TaskRow>(
      `insert into human_task (
         task_id, execution_id, tenant_id, type, status, title, description, payload,
         input_schema, policy_id, strategy, required_count, eligible_roles, eligible_users,
         initiated_by, expires_at, created_at
       ) values (${ph(1)},${ph(2)},${ph(3)},${ph(4)},${ph(5)},${ph(6)},${ph(7)},${ph(8)},
                 ${ph(9)},${ph(10)},${ph(11)},${ph(12)},${ph(13)},${ph(14)},${ph(15)},${ph(16)},${ph(17)})
       returning *`,
      [
        task.taskId,
        task.executionId,
        task.tenantId,
        task.type,
        task.status,
        task.title,
        task.description ?? null,
        jsonParam(task.payload),
        jsonParam(task.inputSchema),
        task.policyId ?? null,
        task.strategy ?? null,
        task.requiredCount ?? null,
        jsonParam(task.eligibleRoles ?? []),
        jsonParam(task.eligibleUsers ?? []),
        task.initiatedBy ?? null,
        task.expiresAt ? dialect.tsParam(task.expiresAt) : null,
        dialect.tsParam(task.createdAt),
      ],
    );
    return toTask(rows[0]!);
  }

  async get(taskId: string): Promise<HumanTask | undefined> {
    const dialect = d();
    const { rows } = await getDb().query<TaskRow>(
      `select * from human_task where task_id = ${dialect.ph(1)}`,
      [taskId],
    );
    return rows[0] ? toTask(rows[0]) : undefined;
  }

  async update(taskId: string, patch: Partial<HumanTask>): Promise<HumanTask | undefined> {
    return this.applyPatch(taskId, patch, false);
  }

  /** 条件关闭：`where status = 'open'`，没抢到返回 undefined（并发审批只允许一个人收敛） */
  async close(taskId: string, patch: Partial<HumanTask>): Promise<HumanTask | undefined> {
    return this.applyPatch(taskId, patch, true);
  }

  private async applyPatch(
    taskId: string,
    patch: Partial<HumanTask>,
    requireOpen: boolean,
  ): Promise<HumanTask | undefined> {
    const dialect = d();
    const sets: string[] = [];
    const params: unknown[] = [];
    const col = (name: string, value: unknown): void => {
      params.push(value);
      sets.push(`${name} = ${dialect.ph(params.length)}`);
    };
    const assign: Partial<Record<keyof HumanTask, string>> = {
      status: 'status',
      description: 'description',
      payload: 'payload',
      inputValues: 'input_values',
      eligibleRoles: 'eligible_roles',
      eligibleUsers: 'eligible_users',
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
      if (key === 'payload' || key === 'inputValues' || key === 'eligibleRoles' || key === 'eligibleUsers') {
        col(column, jsonParam(v));
      } else if (key === 'completedAt' || key === 'delegatedAt') {
        col(column, dialect.tsParam(String(v)));
      } else {
        col(column, v);
      }
    }
    if (!sets.length) return requireOpen ? undefined : this.get(taskId);
    params.push(taskId);
    const idPh = dialect.ph(params.length);
    // `status = 'open'` 是这一枪的判据：并发下只有一个请求能把它从 open 改走，
    // 于是只有那一个拿到返回行 —— 它是"完成收敛的人"，由它触发 onResolved。
    const where = requireOpen
      ? `where task_id = ${idPh} and status = 'open'`
      : `where task_id = ${idPh}`;
    const { rows } = await getDb().query<TaskRow>(
      `update human_task set ${sets.join(', ')} ${where} returning *`,
      params,
    );
    return rows[0] ? toTask(rows[0]) : undefined;
  }

  async list(filter: HumanTaskFilter = {}): Promise<HumanTask[]> {
    const dialect = d();
    const where: string[] = [];
    const params: unknown[] = [];
    const push = (expr: string, value: unknown): void => {
      params.push(value);
      where.push(`${expr} = ${dialect.ph(params.length)}`);
    };
    if (filter.executionId) push('execution_id', filter.executionId);
    if (filter.tenantId) push('tenant_id', filter.tenantId);
    if (filter.status) push('status', filter.status);
    if (filter.type) push('type', filter.type);
    if (filter.assignee) {
      // 有资格 = 角色命中 ∩ 或显式指派给用户 ∩ 或被委派给该用户
      params.push(dialect.bindArray(filter.assignee.roles));
      const roles = dialect.ph(params.length);
      params.push(dialect.bindArray([filter.assignee.userId]));
      const users = dialect.ph(params.length);
      params.push(filter.assignee.userId);
      const uid = dialect.ph(params.length);
      where.push(
        `(${dialect.arrayOverlap('eligible_roles', roles)} or ${dialect.arrayOverlap(
          'eligible_users',
          users,
        )} or delegated_to = ${uid})`,
      );
    }
    const limit = Math.max(1, Math.min(500, filter.limit ?? 50));
    params.push(limit);
    const { rows } = await getDb().query<TaskRow>(
      `select * from human_task
       ${where.length ? `where ${where.join(' and ')}` : ''}
       order by created_at desc limit ${dialect.ph(params.length)}`,
      params,
    );
    return rows.map(toTask);
  }

  async addDecision(decision: HumanTaskDecision): Promise<HumanTaskDecision> {
    const dialect = d();
    const { rows } = await getDb().query<SqlRow>(
      `insert into human_task_decision
         (decision_id, task_id, approver_id, approver_role, decision, comment, created_at)
       values (${dialect.ph(1)},${dialect.ph(2)},${dialect.ph(3)},${dialect.ph(4)},${dialect.ph(5)},${dialect.ph(6)},${dialect.ph(7)})
       returning decision_id`,
      [
        decision.decisionId || `dec_${randomUUID()}`,
        decision.taskId,
        decision.approverId,
        decision.approverRole,
        decision.decision,
        decision.comment ?? null,
        dialect.tsParam(decision.createdAt),
      ],
    );
    return { ...decision, decisionId: String(rows[0]?.decision_id ?? decision.decisionId) };
  }

  async listDecisions(taskId: string): Promise<HumanTaskDecision[]> {
    const dialect = d();
    const { rows } = await getDb().query<SqlRow>(
      `select * from human_task_decision where task_id = ${dialect.ph(1)} order by created_at asc`,
      [taskId],
    );
    return rows.map((r) => ({
      decisionId: String(r.decision_id),
      taskId: String(r.task_id),
      approverId: String(r.approver_id),
      approverRole: String(r.approver_role),
      decision: r.decision as HumanTaskDecision['decision'],
      ...(typeof r.comment === 'string' ? { comment: r.comment } : {}),
      createdAt: parseTsValue(r.created_at) ?? new Date(0).toISOString(),
    }));
  }

  async listExpired(nowIso: string, limit = 100): Promise<HumanTask[]> {
    const dialect = d();
    const { rows } = await getDb().query<TaskRow>(
      `select * from human_task
       where status = 'open' and expires_at is not null and expires_at <= ${dialect.ph(1)}
       order by expires_at asc limit ${dialect.ph(2)}`,
      [dialect.tsParam(nowIso), Math.max(1, Math.min(500, limit))],
    );
    return rows.map(toTask);
  }
}

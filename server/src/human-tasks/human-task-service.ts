import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import type { ApprovalService } from '../approval/approval-service.js';
import type { ApprovalPolicy } from '../approval/types.js';
import type { Principal } from '../services/principal.js';
import { approverRoleFor, isAssignee } from './assignment.js';
import type { HumanTaskRepository } from './repository.js';
import type { HumanTask, HumanTaskFilter, InputTaskSchema } from './types.js';

export type HumanTaskResolution =
  | 'approved'
  | 'rejected'
  | 'expired'
  | 'cancelled'
  | 'input_submitted';

export interface HumanTaskServiceDeps {
  repository: HumanTaskRepository;
  approval: ApprovalService;
  /** 任务收敛后的回调（由 ExecutionService 实现：复核 hash/版本 → 执行 → 落终态） */
  onResolved?: (
    task: HumanTask,
    resolution: HumanTaskResolution,
    decisions: HumanTask['decisions'],
  ) => Promise<void>;
}

const TTL_MS = config.humanTaskTtlSeconds > 0 ? config.humanTaskTtlSeconds * 1000 : 0;

function expiresAtFrom(policy?: ApprovalPolicy | null): string | undefined {
  const seconds = policy?.timeoutSeconds ?? config.humanTaskTtlSeconds;
  if (!seconds || seconds <= 0) return undefined;
  return new Date(Date.now() + seconds * 1000).toISOString();
}

/**
 * HumanTaskService：人工任务生命周期（创建 / 审批 / 输入 / 委派 / 取消 / 过期）。
 * 路由层只调用这里，不直接写库、不直接碰 SDK。
 */
export class HumanTaskService {
  constructor(private readonly deps: HumanTaskServiceDeps) {}

  get repository(): HumanTaskRepository {
    return this.deps.repository;
  }

  async get(taskId: string): Promise<HumanTask | undefined> {
    return this.deps.repository.get(taskId);
  }

  async list(principal: Principal, filter: HumanTaskFilter = {}): Promise<HumanTask[]> {
    const tasks = await this.deps.repository.list({
      ...filter,
      tenantId: filter.tenantId ?? principal.tenantId,
    });
    return tasks.filter((t) => isAssignee(t, principal) || !filter.assignee);
  }

  async createApprovalTask(input: {
    executionId: string;
    tenantId: string;
    title: string;
    description?: string;
    payload: Record<string, unknown>;
    policy: ApprovalPolicy;
    initiatedBy?: string;
  }): Promise<HumanTask> {
    const now = new Date().toISOString();
    const task: HumanTask = {
      taskId: `task_${randomUUID()}`,
      executionId: input.executionId,
      tenantId: input.tenantId,
      type: 'approval',
      status: 'open',
      title: input.title,
      ...(input.description ? { description: input.description } : {}),
      payload: input.payload,
      policyId: input.policy.policyId,
      strategy: input.policy.strategy,
      requiredCount: this.deps.approval.required(input.policy),
      eligibleRoles: [...input.policy.eligibleRoles],
      eligibleUsers: [],
      ...(input.initiatedBy ? { initiatedBy: input.initiatedBy } : {}),
      ...(expiresAtFrom(input.policy) ? { expiresAt: expiresAtFrom(input.policy) } : {}),
      createdAt: now,
    };
    return this.deps.repository.create(task);
  }

  async createInputTask(input: {
    executionId: string;
    tenantId: string;
    title: string;
    description?: string;
    payload?: Record<string, unknown>;
    inputSchema: InputTaskSchema;
    eligibleRoles?: string[];
    eligibleUsers?: string[];
    initiatedBy?: string;
    timeoutSeconds?: number;
  }): Promise<HumanTask> {
    const now = new Date().toISOString();
    const task: HumanTask = {
      taskId: `task_${randomUUID()}`,
      executionId: input.executionId,
      tenantId: input.tenantId,
      type: 'input',
      status: 'open',
      title: input.title,
      ...(input.description ? { description: input.description } : {}),
      payload: input.payload ?? {},
      inputSchema: input.inputSchema,
      eligibleRoles: input.eligibleRoles ?? ['approver'],
      eligibleUsers: input.eligibleUsers ?? [],
      ...(input.initiatedBy ? { initiatedBy: input.initiatedBy } : {}),
      ...(expiresAtFrom(
        input.timeoutSeconds ? { timeoutSeconds: input.timeoutSeconds } as ApprovalPolicy : null,
      )
        ? {
            expiresAt: expiresAtFrom(
              input.timeoutSeconds ? { timeoutSeconds: input.timeoutSeconds } as ApprovalPolicy : null,
            ),
          }
        : {}),
      createdAt: now,
    };
    return this.deps.repository.create(task);
  }

  async approve(
    taskId: string,
    input: { principal: Principal; comment?: string },
  ): Promise<{ task: HumanTask; evaluation: ReturnType<ApprovalService['evaluate']> }> {
    return this.decide(taskId, { ...input, decision: 'approve' });
  }

  async reject(
    taskId: string,
    input: { principal: Principal; comment?: string },
  ): Promise<{ task: HumanTask; evaluation: ReturnType<ApprovalService['evaluate']> }> {
    return this.decide(taskId, { ...input, decision: 'reject' });
  }

  private async decide(
    taskId: string,
    input: { principal: Principal; comment?: string; decision: 'approve' | 'reject' },
  ): Promise<{ task: HumanTask; evaluation: ReturnType<ApprovalService['evaluate']> }> {
    const task = await this.mustGetOpen(taskId);
    if (task.type !== 'approval') throw new Error('该任务不是审批任务');
    const policy = task.policyId
      ? (this.deps.approval.policyFor(
          String(task.payload?.actionType ?? ''),
        ) ?? this.policyFromTask(task))
      : this.policyFromTask(task);
    const decisions = await this.deps.repository.listDecisions(taskId);
    // 一人一票：重复投票先于资格判定（同一个人的第二次点击不该报“顺序未轮到”）
    if (decisions.some((d) => d.approverId === input.principal.userId)) {
      throw new Error(`已投票，不能重复审批：${input.principal.userId}`);
    }
    const { approverRole } = this.deps.approval.assertEligible({
      policy,
      principal: input.principal,
      initiatedBy: task.initiatedBy,
      decisions,
    });
    const decision = await this.deps.repository.addDecision({
      decisionId: `dec_${randomUUID()}`,
      taskId,
      approverId: input.principal.userId,
      approverRole,
      decision: input.decision,
      ...(input.comment ? { comment: input.comment } : {}),
      createdAt: new Date().toISOString(),
    });
    const all = [...decisions, decision];
    const evaluation = this.deps.approval.evaluate(policy, all);
    if (!evaluation.complete) {
      const updated = { ...task, decisions: all };
      return { task: updated, evaluation };
    }
    const status: HumanTask['status'] = evaluation.outcome === 'approved' ? 'approved' : 'rejected';
    const closed = (await this.deps.repository.update(taskId, {
      status,
      completedAt: new Date().toISOString(),
    }))!;
    await this.deps.onResolved?.(
      { ...closed, decisions: all },
      evaluation.outcome === 'approved' ? 'approved' : 'rejected',
      all,
    );
    return { task: { ...closed, decisions: all }, evaluation };
  }

  /** 人工补数据：按 schema 校验，不接受自由文本 */
  async submitInput(
    taskId: string,
    input: { principal: Principal; values: Record<string, unknown> },
  ): Promise<HumanTask> {
    const task = await this.mustGetOpen(taskId);
    if (task.type !== 'input') throw new Error('该任务不是输入任务');
    const values = this.validateInput(task, input.values);
    const closed = (await this.deps.repository.update(taskId, {
      status: 'approved',
      inputValues: values,
      completedAt: new Date().toISOString(),
    }))!;
    await this.deps.onResolved?.(closed, 'input_submitted', []);
    return closed;
  }

  /** 委派：留痕 delegated_from/to/by/at + reason（金融场景的休假代班刚需） */
  async delegate(
    taskId: string,
    input: { principal: Principal; toUserId: string; reason?: string },
  ): Promise<HumanTask> {
    const task = await this.mustGetOpen(taskId);
    if (!isAssignee(task, input.principal)) {
      throw new Error('无权委派该任务（不在 eligible 范围内）');
    }
    if (!input.toUserId?.trim()) throw new Error('toUserId 不能为空');
    return (await this.deps.repository.update(taskId, {
      delegatedFrom: input.principal.userId,
      delegatedTo: input.toUserId.trim(),
      delegatedBy: input.principal.userId,
      delegatedAt: new Date().toISOString(),
      ...(input.reason ? { delegationReason: input.reason } : {}),
    }))!;
  }

  async cancel(taskId: string, input: { principal: Principal }): Promise<HumanTask> {
    const task = await this.deps.repository.get(taskId);
    if (!task) throw new Error(`human task 不存在："${taskId}"`);
    if (task.status !== 'open') return task;
    if (!isAssignee(task, input.principal)) throw new Error('无权取消该任务');
    const closed = (await this.deps.repository.update(taskId, {
      status: 'cancelled',
      completedAt: new Date().toISOString(),
    }))!;
    await this.deps.onResolved?.(closed, 'cancelled', []);
    return closed;
  }

  /** 过期扫描（进程内定时调用，多副本时由 PG 侧唯一约束/行锁保证只生效一次） */
  async sweepExpired(nowIso = new Date().toISOString()): Promise<HumanTask[]> {
    const expired = await this.deps.repository.listExpired(nowIso);
    const out: HumanTask[] = [];
    for (const task of expired) {
      const closed = await this.deps.repository.update(task.taskId, {
        status: 'expired',
        completedAt: nowIso,
      });
      if (!closed) continue;
      out.push(closed);
      await this.deps.onResolved?.(closed, 'expired', []);
    }
    return out;
  }

  private async mustGetOpen(taskId: string): Promise<HumanTask> {
    const task = await this.deps.repository.get(taskId);
    if (!task) throw new Error(`human task 不存在："${taskId}"`);
    if (task.status !== 'open') throw new Error(`human task 已关闭（${task.status}）`);
    if (task.expiresAt && task.expiresAt <= new Date().toISOString()) {
      throw new Error('human task 已过期');
    }
    return task;
  }

  /** 无注册策略时按任务自带策略字段重建（保证 evaluate 可用） */
  private policyFromTask(task: HumanTask): ApprovalPolicy {
    return {
      policyId: task.policyId ?? 'task-inline',
      actionType: String(task.payload?.actionType ?? 'unknown'),
      strategy: task.strategy ?? 'ANY',
      ...(task.requiredCount ? { requiredCount: task.requiredCount } : {}),
      eligibleRoles: task.eligibleRoles,
      allowInitiator: false,
      ...(TTL_MS ? { timeoutSeconds: config.humanTaskTtlSeconds } : {}),
    };
  }

  private validateInput(
    task: HumanTask,
    values: Record<string, unknown>,
  ): Record<string, unknown> {
    const schema = task.inputSchema;
    if (!schema) return values;
    const out: Record<string, unknown> = {};
    for (const field of schema.fields) {
      const v = values[field.name];
      if (v === undefined || v === null || v === '') {
        if (field.required) throw new Error(`缺少必填字段：${field.name}`);
        continue;
      }
      switch (field.type) {
        case 'number':
          if (typeof v !== 'number' || Number.isNaN(v)) {
            throw new Error(`字段 ${field.name} 必须是数字`);
          }
          break;
        case 'boolean':
          if (typeof v !== 'boolean') throw new Error(`字段 ${field.name} 必须是布尔`);
          break;
        case 'select':
          if (!field.options?.includes(String(v))) {
            throw new Error(`字段 ${field.name} 取值必须是 ${(field.options ?? []).join('/')}`);
          }
          break;
        default:
          if (typeof v !== 'string') throw new Error(`字段 ${field.name} 必须是字符串`);
      }
      out[field.name] = v;
    }
    return out;
  }
}

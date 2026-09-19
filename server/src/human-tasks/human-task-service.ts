import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import type { ApprovalService } from '../approval/approval-service.js';
import type { ApprovalPolicy } from '../approval/types.js';
import { authorizationService, type AuthorizationService } from '../identity/authorization-service.js';
import type { Principal } from '../services/principal.js';
import { isAssignee, type ActorRoles } from './assignment.js';
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
  /** 缺省用进程内默认实例（含 RoleRegistry 映射）。任务可见性与资格判定都走它 */
  authorization?: AuthorizationService;
  /** 任务收敛后的回调（由 ExecutionService 实现：复核 hash/版本 → 执行 → 落终态） */
  onResolved?: (
    task: HumanTask,
    resolution: HumanTaskResolution,
    decisions: HumanTask['decisions'],
  ) => Promise<void>;
}

const TTL_MS = config.humanTaskTtlSeconds > 0 ? config.humanTaskTtlSeconds * 1000 : 0;

/**
 * 输入任务没显式指定 assignee 时的兜底角色。
 * 本地单租户下 `Principal.roles` 默认就是它（`COPILOT_DEFAULT_ROLES`，见 services/principal.ts）。
 */
const DEFAULT_INPUT_ROLES = ['approver'];

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
  /** task → 队尾（链式 promise，保证不丢唤醒） */
  private readonly taskLocks = new Map<string, Promise<unknown>>();

  private readonly authorization: AuthorizationService;

  constructor(private readonly deps: HumanTaskServiceDeps) {
    this.authorization = deps.authorization ?? authorizationService;
  }

  get repository(): HumanTaskRepository {
    return this.deps.repository;
  }

  /**
   * 判定身份视图：`Principal` → `{ userId, 已解析业务角色 }`。
   *
   * 必须走这一层而不是直接 `principal.roles`：`x-user-groups` 里的 Entra group
   * 要先经 RoleRegistry 映射成业务角色，否则走 AD group 授权的人看不到自己的待办、
   * 也点不动审批按钮。纯计算、无 I/O，可以放心放在任务锁内部调用。
   */
  private actorRoles(principal: Principal): ActorRoles {
    return { userId: principal.userId, roles: this.authorization.resolveRoles(principal) };
  }

  /**
   * 同一 human task 上的复合操作串行化。
   *
   * 为什么需要：`decide()` 是「读决策 → 判资格 → 加决策 → 评估 → 关闭」。没有这层，
   * 两个审批者可能各自读到"还差一票"、各自评估 complete、各自关闭 —— 收敛出两次
   * `onResolved`（进而把同一个业务动作执行两遍）。
   *
   * `repository.close()` 的条件写是**跨副本**的最终防线（谁抢到谁触发 onResolved）；
   * 这把锁是进程内的，负责让 `evaluate()` 看到稳定的决策集合。多副本下仍有"最后一个
   * 投票者读到的集合偏旧 → 没人关闭"的漏收敛窗口，靠任务过期扫描兜底（见
   * docs/architecture.md 第 5 节）。
   */
  private async withTaskLock<T>(taskId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.taskLocks.get(taskId) ?? Promise.resolve();
    const current = previous.then(fn, fn);
    this.taskLocks.set(taskId, current);
    try {
      return await current;
    } finally {
      if (this.taskLocks.get(taskId) === current) this.taskLocks.delete(taskId);
    }
  }

  async get(taskId: string): Promise<HumanTask | undefined> {
    return this.deps.repository.get(taskId);
  }

  /**
   * 我的任务（审批 + 待补输入）。
   *
   * `tenantId` / `assignee` 一律由服务端按 principal 填，**caller 传了也不采纳**：
   * 这个 API 的语义是"我可以处理的任务"，一旦允许覆盖，调用方就能把可见范围
   * 扩到整个 tenant（或把自己的 userId 换成别人）。其余过滤条件（executionId /
   * status / type / limit）照常透传。
   */
  async list(principal: Principal, filter: HumanTaskFilter = {}): Promise<HumanTask[]> {
    const {
      tenantId: _ignoredTenantId,
      assignee: _ignoredAssignee,
      ...rest
    } = filter;
    return this.deps.repository.list({
      ...rest,
      tenantId: principal.tenantId,
      assignee: this.actorRoles(principal),
    });
  }

  /**
   * 取任务并校验「本租户 + 有资格」——所有写操作（审批/输入/委派/取消）的统一入口。
   *
   * tenant 先于 assignee 判断：跨租户的 taskId 枚举既不该命中"有资格"分支，
   * 也不该从错误文案里泄漏任务是否存在。
   */
  private async getTaskForActor(taskId: string, principal: Principal): Promise<HumanTask> {
    const task = await this.deps.repository.get(taskId);
    if (!task) throw new Error(`human task 不存在："${taskId}"`);
    if (task.tenantId !== principal.tenantId) {
      throw new Error(`无权访问 human task："${taskId}"`);
    }
    if (!isAssignee(task, this.actorRoles(principal))) {
      throw new Error(`无权操作 human task："${taskId}"（不在 eligible 范围内）`);
    }
    return task;
  }

  /** 在 `getTaskForActor` 之上再要求仍可操作（未关闭、未过期） */
  private async getOpenTaskForActor(taskId: string, principal: Principal): Promise<HumanTask> {
    const task = await this.getTaskForActor(taskId, principal);
    if (task.status !== 'open') throw new Error(`human task 已关闭（${task.status}）`);
    if (task.expiresAt && task.expiresAt <= new Date().toISOString()) {
      throw new Error('human task 已过期');
    }
    return task;
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
    // 没显式指定 assignee 时退到默认角色 —— 本地单租户够用，但可信身份的部署里角色来自
    // 网关，多半没人叫 `approver`，任务会变成"谁都不能提交"（submitInput 按 isAssignee 判定，
    // 不接受这种默认）。与其建一个没人能处理的任务，不如在创建时就拒绝。
    if (config.trustIdentityHeaders && !input.eligibleRoles?.length && !input.eligibleUsers?.length) {
      throw new Error('可信身份模式下，input human task 必须指定 eligibleRoles 或 eligibleUsers');
    }
    const eligibleRoles = input.eligibleRoles?.length ? input.eligibleRoles : DEFAULT_INPUT_ROLES;
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
      eligibleRoles: [...eligibleRoles],
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
    // 同一 task 的收敛尝试串行：并发审批不能各自读到"还差我一票"、再各自关闭任务
    return this.withTaskLock(taskId, () => this.decideLocked(taskId, input));
  }

  private async decideLocked(
    taskId: string,
    input: { principal: Principal; comment?: string; decision: 'approve' | 'reject' },
  ): Promise<{ task: HumanTask; evaluation: ReturnType<ApprovalService['evaluate']> }> {
    const task = await this.getOpenTaskForActor(taskId, input.principal);
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
    await this.deps.repository.addDecision({
      decisionId: `dec_${randomUUID()}`,
      taskId,
      approverId: input.principal.userId,
      approverRole,
      decision: input.decision,
      ...(input.comment ? { comment: input.comment } : {}),
      createdAt: new Date().toISOString(),
    });
    // 插入后重读：跨副本时并发的另一票可能刚提交，只拿自己的预读会漏算、导致永不收敛
    const all = await this.deps.repository.listDecisions(taskId);
    const evaluation = this.deps.approval.evaluate(policy, all);
    if (!evaluation.complete) {
      return { task: { ...task, decisions: all }, evaluation };
    }
    const resolution: HumanTaskResolution =
      evaluation.outcome === 'approved' ? 'approved' : 'rejected';
    // 条件关闭：并发下只有一个请求能把 task 从 open 改走。只有那一个是"完成收敛的人"，
    // 由它触发 onResolved —— 否则两个审批者会各自把同一个业务动作执行一遍。
    const closed = await this.deps.repository.close(taskId, {
      status: resolution,
      completedAt: new Date().toISOString(),
    });
    if (!closed) {
      // 另一并发请求先收敛了：本请求不再触发 onResolved，按真实状态返回
      const latest = (await this.deps.repository.get(taskId)) ?? task;
      return { task: { ...latest, decisions: all }, evaluation };
    }
    await this.deps.onResolved?.({ ...closed, decisions: all }, resolution, all);
    return { task: { ...closed, decisions: all }, evaluation };
  }

  /** 人工补数据：按 schema 校验，不接受自由文本 */
  async submitInput(
    taskId: string,
    input: { principal: Principal; values: Record<string, unknown> },
  ): Promise<HumanTask> {
    // 与 approve / reject / delegate / cancel 同一条判定：租户 + 资格 + 未关闭。
    // 只凭 task id 就能写值，等于把"谁能补这个字段"交给调用方自己声明 —— 补进去的值
    // 会直接进 execution 并把它推到 resuming。
    const task = await this.getOpenTaskForActor(taskId, input.principal);
    if (task.type !== 'input') throw new Error('该任务不是输入任务');
    const values = this.validateInput(task, input.values);
    const closed = await this.deps.repository.close(taskId, {
      status: 'approved',
      inputValues: values,
      completedAt: new Date().toISOString(),
    });
    if (!closed) {
      // 读到 open 与关闭之间被别人抢先关掉：本次不再触发 onResolved
      const latest = await this.deps.repository.get(taskId);
      throw new Error(`human task 已关闭（${latest?.status ?? 'unknown'}）`);
    }
    await this.deps.onResolved?.(closed, 'input_submitted', []);
    return closed;
  }

  /** 委派：留痕 delegated_from/to/by/at + reason（金融场景的休假代班刚需） */
  async delegate(
    taskId: string,
    input: { principal: Principal; toUserId: string; reason?: string },
  ): Promise<HumanTask> {
    await this.getOpenTaskForActor(taskId, input.principal);
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
    // 资格判定必须在「已关闭就直接返回」之前：否则知道一个已关闭 taskId 的人
    // 即使完全无权，也能把任务内容读回去。
    const task = await this.getTaskForActor(taskId, input.principal);
    if (task.status !== 'open') return task;
    const closed = await this.deps.repository.close(taskId, {
      status: 'cancelled',
      completedAt: new Date().toISOString(),
    });
    // 并发下可能已被别人关闭：那次已经触发过 onResolved，这里不再重复
    if (!closed) return (await this.deps.repository.get(taskId)) ?? task;
    await this.deps.onResolved?.(closed, 'cancelled', []);
    return closed;
  }

  /** 过期扫描（进程内定时调用，多副本时由 PG 侧唯一约束/行锁保证只生效一次） */
  async sweepExpired(nowIso = new Date().toISOString()): Promise<HumanTask[]> {
    const expired = await this.deps.repository.listExpired(nowIso);
    const out: HumanTask[] = [];
    for (const task of expired) {
      // 条件关闭：扫描期间可能已被审批/取消抢先收敛，那种情况 onResolved 已由对方触发
      const closed = await this.deps.repository.close(task.taskId, {
        status: 'expired',
        completedAt: nowIso,
      });
      if (!closed) continue;
      out.push(closed);
      await this.deps.onResolved?.(closed, 'expired', []);
    }
    return out;
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

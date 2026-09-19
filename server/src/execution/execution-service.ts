import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import type { ActionService } from '../actions/action-service.js';
import type { HumanTaskService, HumanTaskResolution } from '../human-tasks/human-task-service.js';
import type { HumanTask } from '../human-tasks/types.js';
import type { SessionOwner } from '../services/session-registry.js';
import { hashAction } from './hash.js';
import { preview } from './redact.js';
import { ExecutionEventLog } from './events.js';
import type { EventRepository, ExecutionRepository, ExecutionStats } from './repository.js';
import {
  ALLOWED_TRANSITIONS,
  EXECUTION_EVENT_TYPES as EVT,
  isTerminal,
  type ActionIntent,
  type ExecutionFilter,
  type ExecutionKind,
  type ExecutionRecord,
  type ExecutionStatus,
  type ExecutionEvent,
  type ToolCallRecord,
} from './types.js';
import { LlmUsageAccumulator, type LlmUsageSample } from './usage.js';

export interface ExecutionServiceDeps {
  repository: ExecutionRepository;
  events: EventRepository;
  /** 由 wiring 注入（避免模块循环依赖） */
  humanTasks?: HumanTaskService;
  actions?: ActionService;
  /** 取当前数据版本（resourceVersion 复核用；不配则不校验版本） */
  resolveResourceVersion?: (intent: ActionIntent) => Promise<string | undefined>;
}

export interface CreateExecutionInput {
  sessionId: string;
  /**
   * 数据归属 = 会话 owner（不是发起人）。
   * 它决定 resume 时的归属校验能否通过：shared 会话的发起人只是 participant，
   * 拿他去做 owner 校验会被 registry 拒掉。
   */
  owner: SessionOwner;
  /** 谁让这轮 agent 跑起来；缺省等于 owner（single 模式下两者恒相同） */
  initiatedByUserId?: string;
  kind?: ExecutionKind;
  prompt?: string;
  model?: string;
  streaming?: boolean;
  input?: unknown;
  /** 会话消息 id（shared：execution 挂到触发它的那条 message 上） */
  sourceMessageId?: string;
}

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * ExecutionService：agent execution 生命周期的唯一入口。
 *
 *   create → start → running → (waiting_for_input | waiting_for_approval) → resuming → completed
 *                            └→ failed / cancelled / rejected / expired
 *
 * 进程内只保存缓存态（active 映射、usage 累加器、pending tool call 栈）；
 * 状态与证据全部落 repository（PostgreSQL），Pod 重启不丢。
 */
export class ExecutionService {
  private readonly eventLog: ExecutionEventLog;
  /** session → 当前 execution（同一 session 的 turn 被 session lock 串行化，故最多一个） */
  private active = new Map<string, string>();
  /** usage 是 execution-local 的：绝不挂在 service 上做全局累加 */
  private usages = new Map<string, LlmUsageAccumulator>();
  /** session → 已开始未结束的 tool call（LIFO：sub-agent 嵌套调用按栈配对） */
  private pending = new Map<string, ToolCallRecord[]>();
  private seq = new Map<string, number>();

  constructor(private readonly deps: ExecutionServiceDeps) {
    this.eventLog = new ExecutionEventLog(deps.events);
  }

  /** 由 wiring 注入 HumanTaskService（避免 execution ↔ human-tasks 模块循环依赖） */
  bindHumanTasks(service: HumanTaskService): void {
    this.deps.humanTasks = service;
  }

  // ---------- 查询 ----------

  get(executionId: string): Promise<ExecutionRecord | undefined> {
    return this.deps.repository.get(executionId);
  }

  list(filter: ExecutionFilter = {}): Promise<ExecutionRecord[]> {
    return this.deps.repository.list(filter);
  }

  /** 队列里的下一条：同一 session 内最早创建、仍未开始（shared 会话的 drain 靠它取活） */
  nextQueued(sessionId: string): Promise<ExecutionRecord | undefined> {
    return this.deps.repository.nextCreated(sessionId);
  }

  stats(): Promise<ExecutionStats> {
    return this.deps.repository.stats();
  }

  /** 审计时间线（完整证据链，不只是当前状态） */
  events(executionId: string, limit = 100): Promise<ExecutionEvent[]> {
    return this.eventLog.list(executionId, limit);
  }

  async appendEvent(input: {
    executionId: string;
    type: string;
    actorType: 'system' | 'agent' | 'user' | 'approver';
    actorId?: string;
    payload?: Record<string, unknown>;
  }): Promise<void> {
    await this.eventLog.append(input);
  }

  // ---------- 生命周期 ----------

  async create(input: CreateExecutionInput): Promise<ExecutionRecord> {
    const now = new Date().toISOString();
    const record: ExecutionRecord = {
      executionId: `ex_${randomUUID()}`,
      sessionId: input.sessionId,
      tenantId: input.owner.tenantId,
      userId: input.owner.userId,
      initiatedByUserId: input.initiatedByUserId ?? input.owner.userId,
      ...(input.sourceMessageId ? { sourceMessageId: input.sourceMessageId } : {}),
      kind: input.kind ?? 'interactive',
      status: 'created',
      createdAt: now,
      updatedAt: now,
      streaming: input.streaming ?? false,
      ...(input.model ? { model: input.model } : {}),
      ...(input.input !== undefined ? { input: input.input } : {}),
      ...(input.prompt ? { promptPreview: preview(input.prompt, config.evidenceMaxChars) } : {}),
      toolCalls: [],
    };
    const stored = await this.deps.repository.create(record);
    this.usages.set(stored.executionId, new LlmUsageAccumulator());
    await this.eventLog.append({
      executionId: stored.executionId,
      type: EVT.created,
      actorType: 'user',
      actorId: input.owner.userId,
      payload: { sessionId: input.sessionId, kind: stored.kind },
    });
    return stored;
  }

  async start(executionId: string): Promise<ExecutionRecord> {
    const updated = await this.transition(executionId, 'running');
    await this.eventLog.append({
      executionId,
      type: EVT.started,
      actorType: 'system',
    });
    return updated;
  }

  /** 状态迁移（非法跳变直接抛错）：业务状态必须确定 */
  async transition(
    executionId: string,
    status: ExecutionStatus,
    patch: Partial<ExecutionRecord> = {},
  ): Promise<ExecutionRecord> {
    const current = await this.deps.repository.get(executionId);
    if (!current) throw new Error(`execution 不存在："${executionId}"`);
    if (current.status !== status && !ALLOWED_TRANSITIONS[current.status].includes(status)) {
      throw new Error(
        `非法状态迁移：${current.status} → ${status}（允许：${ALLOWED_TRANSITIONS[current.status].join(', ') || '(终态)'}）`,
      );
    }
    const now = new Date().toISOString();
    const next = await this.deps.repository.update(executionId, {
      status,
      updatedAt: now,
      ...(status === 'running' && !current.startedAt ? { startedAt: now } : {}),
      ...(isTerminal(status)
        ? {
            completedAt: now,
            durationMs: new Date(now).getTime() - new Date(current.startedAt ?? current.createdAt).getTime(),
          }
        : {}),
      ...patch,
    });
    return next ?? current;
  }

  async complete(executionId: string, patch: Partial<ExecutionRecord> = {}): Promise<void> {
    const rec = await this.deps.repository.get(executionId);
    if (!rec || isTerminal(rec.status)) return;
    // 等待人工期间不由 agent turn 收尾：终态由 human task 决定
    if (rec.status === 'waiting_for_approval' || rec.status === 'waiting_for_input') return;
    await this.transition(executionId, 'completed', patch);
    await this.eventLog.append({ executionId, type: EVT.completed, actorType: 'system' });
    this.cleanup(executionId, rec.sessionId);
  }

  async fail(executionId: string, error: unknown, patch: Partial<ExecutionRecord> = {}): Promise<void> {
    const rec = await this.deps.repository.get(executionId);
    if (!rec || isTerminal(rec.status)) return;
    await this.transition(executionId, 'failed', { error: errMsg(error), ...patch });
    await this.eventLog.append({
      executionId,
      type: EVT.failed,
      actorType: 'system',
      payload: { error: errMsg(error) },
    });
    this.cleanup(executionId, rec.sessionId);
  }

  async cancel(executionId: string): Promise<void> {
    const rec = await this.deps.repository.get(executionId);
    if (!rec || isTerminal(rec.status)) return;
    // running/waiting 都允许取消；waiting 态取消不需要经过 resuming
    await this.transition(executionId, 'cancelled');
    await this.eventLog.append({ executionId, type: EVT.cancelled, actorType: 'user' });
    this.cleanup(executionId, rec.sessionId);
  }

  // ---------- 过程数据（usage / tool evidence） ----------

  setActive(sessionId: string, executionId: string): void {
    this.active.set(sessionId, executionId);
  }

  clearActive(sessionId: string, executionId?: string): void {
    if (executionId && this.active.get(sessionId) !== executionId) return;
    this.active.delete(sessionId);
  }

  /** session → 当前 execution（hook 与 tool policy 靠它把证据归到 execution） */
  activeFor(sessionId: string): string | undefined {
    return this.active.get(sessionId);
  }

  async addUsage(executionId: string, sample: LlmUsageSample): Promise<void> {
    const acc = this.usages.get(executionId) ?? new LlmUsageAccumulator();
    acc.add(sample);
    this.usages.set(executionId, acc);
    await this.deps.repository.update(executionId, { usage: acc.snapshot() });
  }

  async setContextWindow(executionId: string, tokenLimit: number | undefined): Promise<void> {
    const acc = this.usages.get(executionId) ?? new LlmUsageAccumulator();
    acc.setContextWindow(tokenLimit);
    this.usages.set(executionId, acc);
    await this.deps.repository.update(executionId, { usage: acc.snapshot() });
  }

  usageSnapshot(executionId: string) {
    return this.usages.get(executionId)?.snapshot();
  }

  beginToolCall(input: { sessionId: string; toolName: string; args?: unknown }): ToolCallRecord {
    const executionId = this.active.get(input.sessionId);
    const call: ToolCallRecord = {
      toolCallId: this.nextToolCallId(executionId),
      toolName: input.toolName,
      startedAt: new Date().toISOString(),
      decision: 'allow',
      isError: false,
      ...(input.args !== undefined
        ? { arguments: preview(input.args, config.evidenceMaxChars) }
        : {}),
    };
    if (executionId) {
      const stack = this.pending.get(input.sessionId) ?? [];
      stack.push(call);
      this.pending.set(input.sessionId, stack);
    }
    return call;
  }

  denyToolCall(input: {
    sessionId: string;
    toolName: string;
    args?: unknown;
    reason: string;
  }): ToolCallRecord {
    const call = this.beginToolCall(input);
    call.decision = 'deny';
    call.deniedReason = input.reason;
    call.endedAt = call.startedAt;
    call.durationMs = 0;
    void this.attach(input.sessionId, call);
    return call;
  }

  async endToolCall(input: {
    sessionId: string;
    toolName: string;
    result?: unknown;
    error?: string;
    isError?: boolean;
  }): Promise<ToolCallRecord | undefined> {
    const stack = this.pending.get(input.sessionId) ?? [];
    let idx = -1;
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i]!.toolName === input.toolName) {
        idx = i;
        break;
      }
    }
    const call = idx >= 0 ? stack.splice(idx, 1)[0]! : stack.pop();
    this.pending.set(input.sessionId, stack);
    const record =
      call ?? this.beginToolCall({ sessionId: input.sessionId, toolName: input.toolName });
    const endedAt = new Date().toISOString();
    record.endedAt = endedAt;
    record.durationMs = new Date(endedAt).getTime() - new Date(record.startedAt).getTime();
    record.isError = input.isError ?? false;
    if (input.result !== undefined) record.result = preview(input.result, config.evidenceMaxChars);
    if (input.error) record.error = preview(input.error, config.evidenceMaxChars);
    await this.attach(input.sessionId, record);
    return record;
  }

  // ---------- HITL ----------

  /**
   * agent 提出业务动作意图 → 策略裁决 → 自动放行 / 建审批任务 / 拒绝。
   * 高风险 mutation 的执行权在 server，不在 agent 的工具集里。
   */
  async proposeAction(
    executionId: string,
    intent: ActionIntent,
    opts: { resourceVersion?: string; onTaskCreated?: (task: HumanTask) => void } = {},
  ): Promise<{ decision: 'auto_approve' | 'needs_approval' | 'denied'; taskId?: string; reason?: string; result?: unknown }> {
    const rec = await this.deps.repository.get(executionId);
    if (!rec) throw new Error(`execution 不存在："${executionId}"`);
    const actionHash = hashAction(intent);
    await this.deps.repository.update(executionId, {
      actionIntent: intent,
      actionHash,
      ...(opts.resourceVersion ? { resourceVersion: opts.resourceVersion } : {}),
    });
    await this.eventLog.append({
      executionId,
      type: EVT.actionProposed,
      actorType: 'agent',
      payload: { actionType: intent.actionType, target: intent.target, actionHash },
    });

    const actions = this.deps.actions;
    if (!actions) throw new Error('ActionService 未注入（wiring 缺失）');
    const verdict = actions.classify(intent);

    if (verdict.decision === 'denied') {
      await this.eventLog.append({
        executionId,
        type: EVT.actionDenied,
        actorType: 'system',
        payload: { reason: verdict.reason },
      });
      return { decision: 'denied', reason: verdict.reason };
    }

    if (verdict.decision === 'auto_approve') {
      const result = await this.runAction(executionId, intent, {
        approvedHash: actionHash,
        approvedResourceVersion: opts.resourceVersion,
        actor: 'system:auto',
      });
      return { decision: 'auto_approve', result };
    }

    const humanTasks = this.requireHumanTasks();
    const task = await humanTasks.createApprovalTask({
      executionId,
      tenantId: rec.tenantId,
      title: `审批：${intent.actionType}`,
      ...(intent.reason ? { description: intent.reason } : {}),
      payload: {
        actionType: intent.actionType,
        target: intent.target,
        parameters: intent.parameters,
        actionHash,
        ...(opts.resourceVersion ? { resourceVersion: opts.resourceVersion } : {}),
      },
      policy: verdict.policy,
      initiatedBy: rec.initiatedByUserId ?? rec.userId,
    });
    await this.transition(executionId, 'waiting_for_approval', {
      currentHumanTaskId: task.taskId,
      waitReason: 'approval',
      actionHash,
    });
    await this.eventLog.append({
      executionId,
      type: EVT.approvalRequired,
      actorType: 'system',
      payload: { policyId: verdict.policy.policyId, strategy: verdict.policy.strategy },
    });
    await this.eventLog.append({
      executionId,
      type: EVT.humanTaskCreated,
      actorType: 'system',
      payload: { taskId: task.taskId, type: task.type },
    });
    await this.eventLog.append({
      executionId,
      type: EVT.waitingForApproval,
      actorType: 'system',
      payload: { taskId: task.taskId },
    });
    opts.onTaskCreated?.(task);
    return { decision: 'needs_approval', taskId: task.taskId };
  }

  /** 人工补数据：execution 进入 WAITING_FOR_INPUT（SSE 不陪等，客户端可断开） */
  async pauseForInput(input: {
    executionId: string;
    title: string;
    description?: string;
    schema: NonNullable<HumanTask['inputSchema']>;
    eligibleRoles?: string[];
    eligibleUsers?: string[];
    payload?: Record<string, unknown>;
  }): Promise<HumanTask> {
    const rec = await this.deps.repository.get(input.executionId);
    if (!rec) throw new Error(`execution 不存在："${input.executionId}"`);
    const task = await this.requireHumanTasks().createInputTask({
      executionId: input.executionId,
      tenantId: rec.tenantId,
      title: input.title,
      ...(input.description ? { description: input.description } : {}),
      inputSchema: input.schema,
      ...(input.eligibleRoles ? { eligibleRoles: input.eligibleRoles } : {}),
      ...(input.eligibleUsers ? { eligibleUsers: input.eligibleUsers } : {}),
      ...(input.payload ? { payload: input.payload } : {}),
      initiatedBy: rec.initiatedByUserId ?? rec.userId,
    });
    await this.transition(input.executionId, 'waiting_for_input', {
      currentHumanTaskId: task.taskId,
      waitReason: 'input',
    });
    await this.eventLog.append({
      executionId: input.executionId,
      type: EVT.waitingForInput,
      actorType: 'system',
      payload: { taskId: task.taskId },
    });
    return task;
  }

  /** 人工任务收敛后的回调（由 HumanTaskService 触发） */
  async onHumanTaskResolved(
    task: HumanTask,
    resolution: HumanTaskResolution,
    decisions: HumanTask['decisions'],
  ): Promise<void> {
    const rec = await this.deps.repository.get(task.executionId);
    if (!rec) return;
    await this.eventLog.append({
      executionId: task.executionId,
      type: EVT.approvalSubmitted,
      actorType: 'approver',
      actorId: decisions?.[decisions.length - 1]?.approverId,
      payload: { taskId: task.taskId, resolution },
    });

    if (resolution === 'rejected') {
      await this.transition(task.executionId, 'rejected', { error: '审批被否决' });
      await this.eventLog.append({ executionId: task.executionId, type: EVT.rejected, actorType: 'approver' });
      this.cleanup(task.executionId, rec.sessionId);
      return;
    }
    if (resolution === 'expired') {
      await this.transition(task.executionId, 'expired', { error: '审批超时' });
      await this.eventLog.append({ executionId: task.executionId, type: EVT.expired, actorType: 'system' });
      this.cleanup(task.executionId, rec.sessionId);
      return;
    }
    if (resolution === 'cancelled') {
      await this.transition(task.executionId, 'cancelled');
      await this.eventLog.append({ executionId: task.executionId, type: EVT.cancelled, actorType: 'user' });
      this.cleanup(task.executionId, rec.sessionId);
      return;
    }
    if (resolution === 'input_submitted') {
      // 输入补齐 → 由调用方（ExecutionService.run / route）决定如何继续
      await this.transition(task.executionId, 'resuming', { result: task.inputValues });
      await this.eventLog.append({ executionId: task.executionId, type: EVT.resuming, actorType: 'user' });
      return;
    }

    // approved：不直接执行 —— 复核 hash + resourceVersion 后再执行
    const intent = rec.actionIntent;
    if (!intent) {
      await this.fail(task.executionId, new Error('审批通过但 execution 上没有 actionIntent'));
      return;
    }
    const currentResourceVersion = await this.deps.resolveResourceVersion?.(intent);
    const result = await this.runAction(task.executionId, intent, {
      approvedHash: rec.actionHash,
      approvedResourceVersion: rec.resourceVersion,
      ...(currentResourceVersion !== undefined ? { currentResourceVersion } : {}),
      actor: decisions?.[decisions.length - 1]?.approverId ?? 'approver',
    });
    if (result && typeof result === 'object' && (result as { ok?: boolean }).ok === false) {
      const error = String((result as { error?: string }).error ?? '执行失败');
      const verified = (result as { verified?: { hash: boolean; resourceVersion: boolean } }).verified;
      // hash/版本失配 = 需要重新审批（保持 waiting_for_approval，另开任务）
      if (verified && (!verified.hash || !verified.resourceVersion)) {
        await this.transition(task.executionId, 'waiting_for_approval', { error });
        await this.reapprove(task.executionId, intent, error);
        return;
      }
      await this.fail(task.executionId, new Error(error));
    }
  }

  /** hash 或版本失配：动作实质变了 → 重新发起审批，而不是拿旧批准继续执行 */
  private async reapprove(executionId: string, intent: ActionIntent, reason: string): Promise<void> {
    const actions = this.deps.actions;
    if (!actions) return;
    const verdict = actions.classify(intent);
    if (verdict.decision !== 'needs_approval') return;
    const rec = await this.deps.repository.get(executionId);
    if (!rec) return;
    const task = await this.requireHumanTasks().createApprovalTask({
      executionId,
      tenantId: rec.tenantId,
      title: `重新审批：${intent.actionType}`,
      description: reason,
      payload: {
        actionType: intent.actionType,
        target: intent.target,
        parameters: intent.parameters,
        actionHash: hashAction(intent),
      },
      policy: verdict.policy,
      initiatedBy: rec.initiatedByUserId ?? rec.userId,
    });
    await this.transition(executionId, 'waiting_for_approval', { currentHumanTaskId: task.taskId });
    await this.eventLog.append({
      executionId,
      type: EVT.approvalRequired,
      actorType: 'system',
      payload: { taskId: task.taskId, reason, policyId: verdict.policy.policyId },
    });
  }

  private async runAction(
    executionId: string,
    intent: ActionIntent,
    ctx: {
      approvedHash?: string;
      approvedResourceVersion?: string;
      currentResourceVersion?: string;
      actor: string;
    },
  ): Promise<unknown> {
    const actions = this.deps.actions!;
    await this.eventLog.append({
      executionId,
      type: EVT.authorizationChecked,
      actorType: 'system',
      payload: { actionType: intent.actionType, actor: ctx.actor },
    });
    const result = await actions.execute(intent, {
      executionId,
      actor: ctx.actor,
      approvedHash: ctx.approvedHash,
      approvedResourceVersion: ctx.approvedResourceVersion,
      currentResourceVersion: ctx.currentResourceVersion,
    });
    await this.eventLog.append({
      executionId,
      type: result.verified.hash ? EVT.actionHashVerified : EVT.actionHashMismatch,
      actorType: 'system',
      payload: { verified: result.verified },
    });
    if (!result.verified.resourceVersion) {
      await this.eventLog.append({
        executionId,
        type: EVT.resourceVersionMismatch,
        actorType: 'system',
        payload: {
          approved: ctx.approvedResourceVersion,
          current: ctx.currentResourceVersion,
        },
      });
    }
    await this.eventLog.append({
      executionId,
      type: EVT.actionExecuted,
      actorType: 'system',
      payload: { actionType: intent.actionType, ok: result.ok },
    });
    if (result.ok) {
      // 等待态 → resuming → running → completed（终态不允许直接跳）
      const rec = await this.deps.repository.get(executionId);
      if (rec && (rec.status === 'waiting_for_approval' || rec.status === 'waiting_for_input')) {
        await this.transition(executionId, 'resuming');
        await this.eventLog.append({ executionId, type: EVT.resuming, actorType: 'system' });
        await this.transition(executionId, 'running');
      }
      await this.complete(executionId, { result: result.output });
    }
    return result;
  }

  private requireHumanTasks(): HumanTaskService {
    if (!this.deps.humanTasks) throw new Error('HumanTaskService 未注入（wiring 缺失）');
    return this.deps.humanTasks;
  }

  // ---------- 内部 ----------

  private async attach(sessionId: string, call: ToolCallRecord): Promise<void> {
    const executionId = this.active.get(sessionId);
    if (!executionId) return;
    const rec = await this.deps.repository.get(executionId);
    if (!rec) return;
    if (rec.toolCalls.length >= config.maxToolCallsPerExecution) {
      await this.deps.repository.update(executionId, {
        toolCallsOmitted: (rec.toolCallsOmitted ?? 0) + 1,
      });
      return;
    }
    await this.deps.repository.update(executionId, { toolCalls: [...rec.toolCalls, call] });
    await this.eventLog.append({
      executionId,
      type: EVT.toolCallCompleted,
      actorType: 'agent',
      payload: {
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        decision: call.decision,
        durationMs: call.durationMs,
      },
    });
  }

  private nextToolCallId(executionId: string | undefined): string {
    if (!executionId) return `tc_${randomUUID().slice(0, 8)}`;
    const n = (this.seq.get(executionId) ?? 0) + 1;
    this.seq.set(executionId, n);
    return `${executionId}-t${n}`;
  }

  /** 终态后回收进程内缓存（durable 记录仍在库里） */
  private cleanup(executionId: string, sessionId: string): void {
    this.usages.delete(executionId);
    this.seq.delete(executionId);
    this.clearActive(sessionId, executionId);
  }
}

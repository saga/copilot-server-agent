import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import type { CommandService } from '../commands/command-service.js';
import type { HumanTaskService, HumanTaskResolution } from '../human-tasks/human-task-service.js';
import type { HumanTask } from '../human-tasks/types.js';
import type { SessionOwner } from '../services/session-registry.js';
import { hashCommand } from './hash.js';
import { preview } from './redact.js';
import { ExecutionEventLog } from './events.js';
import type { EventRepository, ExecutionRepository, ExecutionStats } from './repository.js';
import {
  ALLOWED_TRANSITIONS,
  EXECUTION_EVENT_TYPES as EVT,
  isTerminal,
  type CommandIntent,
  type ExecutionFilter,
  type ExecutionKind,
  type ExecutionRecord,
  type ExecutionStatus,
  type ExecutionEvent,
  type ToolCallRecord,
} from './types.js';
import { LlmUsageAccumulator, type LlmUsageSample } from './usage.js';
import type { WorkflowState } from '../workflow/types.js';

/**
 * 一次 workflow 状态写入的结果。
 *
 * `conflict` = 版本号对不上（另一个推进者已经改过）—— 调用方必须停止推进，
 * 但**不能**把它当失败：有别人正在推进这个 execution，落终态等于把对方跑着的流程打死。
 */
export type WorkflowStateWrite =
  | { ok: true; version: number }
  | { ok: false; conflict: true; current?: ExecutionRecord };

export interface ExecutionServiceDeps {
  repository: ExecutionRepository;
  events: EventRepository;
  /** 由 wiring 注入（避免模块循环依赖） */
  humanTasks?: HumanTaskService;
  commands?: CommandService;
  /** 取当前数据版本（resourceVersion 复核用；不配则不校验版本） */
  resolveResourceVersion?: (intent: CommandIntent) => Promise<string | undefined>;
}

/**
 * 审批通过后执行命令的结果。
 *
 * 分成三态是因为调用方要决定"接下来干什么"：
 * - `executed`：命令有结论（ok / !ok），编排层据此选下一个 route
 * - `reapproval_required`：命令内容或数据版本变了，已另开审批任务 —— 必须**继续等待**，
 *   不能当成失败继续往下走
 * - `idle`：execution 不存在或没什么可做的
 */
export type ApprovedCommandResult =
  | { status: 'executed'; ok: boolean; output?: unknown; error?: string }
  | { status: 'reapproval_required'; reason: string }
  | { status: 'idle' };

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
  /**
   * 队列定序键 = 来源消息的 sequence。
   * 有 sourceMessageId 就必须一起给，否则队列只能退化成按时间排序，
   * 并发提交时 agent 的处理顺序会与 transcript 顺序不一致。
   */
  queueSequence?: number;
  /** Skill Flow 的初始编排状态（kind = 'workflow' 时必填） */
  workflow?: WorkflowState;
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

  /** 队列里的下一条：同一 session 内按来源消息 sequence 定序（shared 会话的 drain 靠它取活） */
  nextQueued(sessionId: string): Promise<ExecutionRecord | undefined> {
    return this.deps.repository.nextQueued(sessionId);
  }

  /** 仍有排队中协作 execution 的 session（启动恢复用：chains 是进程内状态，重启即丢） */
  queuedSessionIds(): Promise<string[]> {
    return this.deps.repository.queuedSessionIds();
  }

  /**
   * 启动恢复：把进程退出时留在 running/resuming 的执行落成 interrupted。
   *
   * **刻意不自动重试**：agent 可能已经执行过业务命令（提交交易、表决），
   * 进程死在命令之后、状态落库之前时自动重跑会重复提交 —— 金融场景不可接受。
   * 是否重跑交给人工判断。
   *
   * 不在这个状态集里的：`created`（还没开跑，重新入队即可）与 `waiting_*`
   * （等人工，状态本就该跨重启保留）。
   */
  async recoverInterrupted(
    reason = '进程在 turn 中途退出（interrupted）：未自动重试，请人工确认是否需要重跑',
  ): Promise<ExecutionRecord[]> {
    const hit = await this.deps.repository.interruptActive(reason);
    for (const rec of hit) {
      this.cleanup(rec.executionId, rec.sessionId);
      await this.eventLog.append({
        executionId: rec.executionId,
        type: EVT.interrupted,
        actorType: 'system',
        payload: { reason },
      });
    }
    return hit;
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
      ...(input.queueSequence !== undefined ? { queueSequence: input.queueSequence } : {}),
      kind: input.kind ?? 'interactive',
      status: 'created',
      ...(input.workflow ? { workflow: input.workflow } : {}),
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
      // 记**发起人**而不是会话 owner：shared 会话里 owner 可能是 alice 而发起人是 bob，
      // 审计写成 owner 就等于把"谁触发了这次执行"抹掉（owner ≠ actor，见架构文档 3.4）。
      actorId: stored.initiatedByUserId,
      payload: { sessionId: input.sessionId, kind: stored.kind },
    });
    return stored;
  }

  /**
   * 落一次编排状态（每步之后都必须调，且要在推进之前）。
   *
   * 顺序要求：先把 `current` 推进到下一个节点写库，再去执行它。
   * 反过来的话，进程在"执行完了但状态还没落库"之间退出，重启后会把同一步再跑一遍
   * （子流程可能已经把命令做出去了）。
   *
   * `expectedVersion` 给了就做 **CAS**（单写者）：版本对不上返回 `{ ok: false }`，
   * 调用方必须停止推进 —— 说明另一个推进者（重启恢复 / 另一副本 / 人工任务回调）
   * 已经改过这一段状态。不给则无条件写（建流程、测试注入用）。
   *
   * 为什么不能让"读 → 合并 → 整行写回"承担这件事：两个推进者交错时，
   * 后写的会把先写的**整段覆盖掉**（某一步被跳过、步数回退），而审计链上看不出异常。
   */
  async updateWorkflowState(
    executionId: string,
    workflow: WorkflowState,
    expectedVersion?: number,
  ): Promise<WorkflowStateWrite> {
    if (expectedVersion === undefined) {
      const rec = await this.deps.repository.update(executionId, { workflow });
      if (!rec) return { ok: false, conflict: true };
      return { ok: true, version: rec.workflowVersion ?? 0 };
    }
    const rec = await this.deps.repository.compareAndSwapWorkflowState(
      executionId,
      expectedVersion,
      workflow,
    );
    if (!rec) {
      const current = await this.deps.repository.get(executionId);
      return { ok: false, conflict: true, ...(current ? { current } : {}) };
    }
    return { ok: true, version: rec.workflowVersion ?? expectedVersion + 1 };
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
   * agent 提出业务命令意图 → 策略裁决 → 自动放行 / 建审批任务 / 拒绝。
   * 高风险 mutation 的执行权在 server，不在 agent 的工具集里。
   */
  async proposeCommand(
    executionId: string,
    intent: CommandIntent,
    opts: {
      resourceVersion?: string;
      onTaskCreated?: (task: HumanTask) => void;
      /**
       * Skill Flow 的 `@command` 节点：审批任务上打 workflow 标记。
       * 收敛时的 dispatcher（wiring）据此把任务交回 WorkflowRunner 而不是当成终态命令。
       *
       * `restrictRoles` = SKILL.md 里写的 `@command role:`，只收窄不放宽（见 CommandService.classify）。
       */
      workflow?: {
        nodeId: string;
        restrictRoles?: string[];
        /**
         * 只建审批任务，**不**把 execution 推到 waiting_for_approval。
         *
         * 调用方（WorkflowRunner）拿到 taskId 之后要先把 `workflow.stepStatus = waiting`
         * 落库（带 waitingTaskId），再自己 transition —— 顺序反过来会留下一个不可判定的
         * 崩溃窗口：`execution = waiting_for_approval` + `workflow.stepStatus = running`，
         * 恢复时"在等人工"和"要重放这一步"两个判断同时成立。
         *
         * 普通命令审批（`@command` 之外的路径）不要用这个开关：那时 execution 的生命周期
         * 就归 ExecutionService 管，没有第二个写者。
         */
        deferWaitingTransition?: boolean;
      };
    } = {},
  ): Promise<{ decision: 'auto_approve' | 'needs_approval' | 'denied'; taskId?: string; reason?: string; result?: unknown }> {
    const rec = await this.deps.repository.get(executionId);
    if (!rec) throw new Error(`execution 不存在："${executionId}"`);
    const commandHash = hashCommand(intent);
    await this.deps.repository.update(executionId, {
      commandIntent: intent,
      commandHash,
      ...(opts.resourceVersion ? { resourceVersion: opts.resourceVersion } : {}),
    });
    await this.eventLog.append({
      executionId,
      type: EVT.commandProposed,
      actorType: 'agent',
      payload: { commandType: intent.commandType, target: intent.target, commandHash },
    });

    const commands = this.deps.commands;
    if (!commands) throw new Error('CommandService 未注入（wiring 缺失）');
    const verdict = commands.classify(
      intent,
      opts.workflow?.restrictRoles ? { restrictRoles: opts.workflow.restrictRoles } : {},
    );

    if (verdict.decision === 'denied') {
      await this.eventLog.append({
        executionId,
        type: EVT.commandDenied,
        actorType: 'system',
        payload: { reason: verdict.reason },
      });
      return { decision: 'denied', reason: verdict.reason };
    }

    if (verdict.decision === 'auto_approve') {
      const result = await this.runCommand(executionId, intent, {
        approvedHash: commandHash,
        approvedResourceVersion: opts.resourceVersion,
        actor: 'system:auto',
        // workflow 的命令执行完不能收尾：后面还有节点要跑
        completeOnSuccess: !opts.workflow,
      });
      return { decision: 'auto_approve', result };
    }

    const humanTasks = this.requireHumanTasks();
    const task = await humanTasks.createApprovalTask({
      executionId,
      tenantId: rec.tenantId,
      title: `审批：${intent.commandType}`,
      ...(intent.reason ? { description: intent.reason } : {}),
      payload: {
        commandType: intent.commandType,
        target: intent.target,
        parameters: intent.parameters,
        commandHash,
        ...(opts.resourceVersion ? { resourceVersion: opts.resourceVersion } : {}),
        ...(opts.workflow
          ? { workflow: { executionId, nodeId: opts.workflow.nodeId, kind: 'command' } }
          : {}),
      },
      policy: verdict.policy,
      initiatedBy: rec.initiatedByUserId ?? rec.userId,
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
    if (opts.workflow?.deferWaitingTransition) {
      // 状态迁移交给调用方：它要先落 workflow.stepStatus = waiting，再 transition。
      // 这里**不**写 waiting_for_approval 事件 —— 那条事件的含义是"execution 已经进入等待"，
      // 而此刻它还没有。等调用方真正迁移时由它自己补上。
      opts.onTaskCreated?.(task);
      return { decision: 'needs_approval', taskId: task.taskId };
    }
    await this.transition(executionId, 'waiting_for_approval', {
      currentHumanTaskId: task.taskId,
      waitReason: 'approval',
      commandHash,
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
    await this.executeApprovedCommand(task.executionId, {
      actor: decisions?.[decisions.length - 1]?.approverId ?? 'approver',
    });
  }

  /**
   * 审批通过之后的执行：复核 commandHash / resourceVersion → executor → 决定终态。
   *
   * 抽成公开方法而不是留在 onHumanTaskResolved 里，是因为 Skill Flow 的 `@command` 节点
   * 也要走**同一条**路径（同样的幂等键、同样的失配重新审批），但它成功之后不能收尾
   * —— 流程后面还有节点。两条调用路径共用这一份实现，"命令怎么执行"只有一处定义。
   */
  async executeApprovedCommand(
    executionId: string,
    opts: {
      completeOnSuccess?: boolean;
      actor?: string;
      /**
       * `@command role:` 的流程角色限制（只收窄不放宽，见 CommandService.classify）。
       *
       * **必须由调用方每次都显式传** —— 它不持久化在 execution 上，只对这一次调用生效。
       * 之所以要一路带着，是因为 hash/version 失配会触发**重新审批**（reapprove），
       * 而重新审批必须用**同一份**限制去 classify：否则新任务会按基策略放行，
       * 流程里写的 `role:` 只生效一次就被静默丢掉 —— 那是授权面被悄悄放宽，
       * 不报错、审计链上也看不出来。
       *
       * 恢复场景不需要额外存储：WorkflowRunner 每次从 SKILL.md 定义里重新读
       * `node.attrs.role`（见 runner.ts 的 resumeCommand），所以重启后依然带着同一个限制。
       */
      restrictRoles?: string[];
    } = {},
  ): Promise<ApprovedCommandResult> {
    const rec = await this.deps.repository.get(executionId);
    if (!rec) return { status: 'idle' };
    const intent = rec.commandIntent;
    if (!intent) {
      const reason = '审批通过但 execution 上没有 commandIntent';
      await this.fail(executionId, new Error(reason));
      return { status: 'executed', ok: false, error: reason };
    }
    const currentResourceVersion = await this.deps.resolveResourceVersion?.(intent);
    const result = await this.runCommand(executionId, intent, {
      approvedHash: rec.commandHash,
      approvedResourceVersion: rec.resourceVersion,
      ...(currentResourceVersion !== undefined ? { currentResourceVersion } : {}),
      actor: opts.actor ?? 'approver',
      completeOnSuccess: opts.completeOnSuccess ?? true,
    });
    const r = result as {
      ok?: boolean;
      output?: unknown;
      error?: string;
      verified?: { hash: boolean; resourceVersion: boolean };
    };
    if (r && r.ok === false) {
      const error = String(r.error ?? '执行失败');
      // hash/版本失配 = 命令实质变了 → 重新审批（保持 waiting_for_approval，另开任务）。
      // `restrictRoles` 必须继续传：重新审批用的是同一份授权要求，不是重开一次授权。
      if (r.verified && (!r.verified.hash || !r.verified.resourceVersion)) {
        await this.transition(executionId, 'waiting_for_approval', { error });
        await this.reapprove(executionId, intent, error, opts.restrictRoles);
        return { status: 'reapproval_required', reason: error };
      }
      await this.fail(executionId, new Error(error));
      return { status: 'executed', ok: false, error };
    }
    return { status: 'executed', ok: true, ...(r?.output !== undefined ? { output: r.output } : {}) };
  }

  /**
   * hash 或版本失配：命令实质变了 → 重新发起审批，而不是拿旧批准继续执行。
   *
   * `restrictRoles` 必须与**第一次**审批用的是同一份：重新审批不是"重开一次授权"，
   * 而是同一份授权要求下重走一遍。丢掉它 = 流程里 `@command role:` 只生效一次，
   * 第二次审批按基策略放行，授权面被悄悄放宽。
   */
  private async reapprove(
    executionId: string,
    intent: CommandIntent,
    reason: string,
    restrictRoles?: string[],
  ): Promise<void> {
    const commands = this.deps.commands;
    if (!commands) return;
    const verdict = commands.classify(
      intent,
      restrictRoles?.length ? { restrictRoles } : {},
    );
    if (verdict.decision !== 'needs_approval') return;
    const rec = await this.deps.repository.get(executionId);
    if (!rec) return;
    const task = await this.requireHumanTasks().createApprovalTask({
      executionId,
      tenantId: rec.tenantId,
      title: `重新审批：${intent.commandType}`,
      description: reason,
      payload: {
        commandType: intent.commandType,
        target: intent.target,
        parameters: intent.parameters,
        commandHash: hashCommand(intent),
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

  private async runCommand(
    executionId: string,
    intent: CommandIntent,
    ctx: {
      approvedHash?: string;
      approvedResourceVersion?: string;
      currentResourceVersion?: string;
      actor: string;
      /**
       * 命令成功后是否把 execution 收成 completed（默认 true）。
       * Skill Flow 的 `@command` 传 false：命令只是流程中的一步，后面还有节点。
       */
      completeOnSuccess?: boolean;
    },
  ): Promise<unknown> {
    const commands = this.deps.commands!;
    await this.eventLog.append({
      executionId,
      type: EVT.authorizationChecked,
      actorType: 'system',
      payload: { commandType: intent.commandType, actor: ctx.actor },
    });
    // 幂等键绑定「execution + 命令内容 hash」，而不是 taskId：
    // 重新审批会产出新的 HumanTask，但下游要认的是同一次业务命令。
    // 重试（外部副作用已成、进程在落终态前崩）时这两个值都不变，下游据此去重。
    //
    // 前缀 `action:` 是**冻结的 wire format**（同 hash.ts 的 frozenHashInput）：这个 key 会
    // 离开进程边界传给下游网关，改名成 `command:` 会让部署期间的在途重试换一个 key，
    // 下游去重失效、副作用执行两次。要改必须先想清楚在途重试怎么办。
    const commandHash = ctx.approvedHash ?? hashCommand(intent);
    const idempotencyKey = `action:${executionId}:${commandHash}`;
    const result = await commands.execute(intent, {
      executionId,
      actor: ctx.actor,
      idempotencyKey,
      approvedHash: ctx.approvedHash,
      approvedResourceVersion: ctx.approvedResourceVersion,
      currentResourceVersion: ctx.currentResourceVersion,
    });
    await this.eventLog.append({
      executionId,
      type: result.verified.hash ? EVT.commandHashVerified : EVT.commandHashMismatch,
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
    // 审计语义：`command.executed` = 业务 mutation 真正发生了。
    // 验证失配（根本没调 executor）或 executor 返回失败时记 `command.execution_failed`。
    await this.eventLog.append({
      executionId,
      type: result.ok ? EVT.commandExecuted : EVT.commandExecutionFailed,
      actorType: 'system',
      payload: {
        commandType: intent.commandType,
        ok: result.ok,
        ...(!result.ok && result.error ? { error: preview(result.error, config.evidenceMaxChars) } : {}),
      },
    });
    if (result.ok) {
      // 等待态 → resuming → running → completed（终态不允许直接跳）
      const rec = await this.deps.repository.get(executionId);
      if (rec && (rec.status === 'waiting_for_approval' || rec.status === 'waiting_for_input')) {
        await this.transition(executionId, 'resuming');
        await this.eventLog.append({ executionId, type: EVT.resuming, actorType: 'system' });
        await this.transition(executionId, 'running');
      }
      if (ctx.completeOnSuccess !== false) {
        await this.complete(executionId, { result: result.output });
      }
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

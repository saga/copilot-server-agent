import { runExecutionTurn } from '../agent/agent-execution.js';
import { preview } from '../execution/redact.js';
import type { ExecutionService } from '../execution/execution-service.js';
import type { ExecutionRecord } from '../execution/types.js';
import { EXECUTION_EVENT_TYPES as EVT, isTerminal } from '../execution/types.js';
import type { HumanTaskService } from '../human-tasks/human-task-service.js';
import type { HumanTask } from '../human-tasks/types.js';
import { parseSkillFlow } from '../skills/flow-parser.js';
import { validateSkillFlow } from '../skills/flow-validator.js';
import { findSkill, loadSkill, skillSearchDirs, type LoadedSkill } from '../skills/index.js';
import type { ApprovalPolicy } from '../approval/types.js';
import {
  findFlowAction,
  findFlowGate,
  findFlowReview,
  flowRegistryLookup,
} from './registry.js';
import {
  MAX_FLOW_STEPS,
  type FlowContext,
  type FlowDefinition,
  type FlowIssue,
  type FlowNode,
  type FlowNodeType,
  type WorkflowState,
} from './types.js';

/**
 * WorkflowRunner：Skill Flow 的编排器 —— 这是整个 Workflow Engine 的核心，也是它的全部。
 *
 * 没有 BPMN，没有 XState，没有第二套 runtime。底下就三层复用：
 *
 *   @agent  → runExecutionTurn（同一个 Copilot session / model / tool policy）
 *   @review → HumanTaskService（同一套 My Tasks / 委派 / SoD / 租户隔离 / 审计）
 *   @action → ExecutionService.proposeAction（同一套策略 → 审批 → hash/版本复核 → executor）
 *
 * 两步之间的"状态"就是 `agent_execution.workflow_state` 里的一个节点 id 加上它的执行状态。
 *
 * ## 步骤持久化（step durability）
 *
 * 每一步的顺序是：**先把 `stepStatus = running` 落库，再执行那个节点**；执行完把 `current`
 * 推到下一个节点并落回 `pending`。
 *
 * 只有 `current` 一个字段时，"这一步跑没跑完"是不可知的：进程在"跑完但状态没落库"之间退出，
 * 重启后只能靠猜 —— 提前写 `current = next` 会**跳过**一个其实没执行完的步骤；不提前写又会
 * 重放一个可能已经产生副作用的步骤。所以状态里多一个 `stepStatus`，把顺序显式表达成
 *
 *   pending → running → pending
 *
 * 这样 crash 恢复才能明确回答"publish 已经开始过，但它完成了没有？"。
 *
 * 恢复策略见 `admitInterruptedStep()`：`@agent` / `@gate` 是纯计算，允许重放；
 * `@action` 有真实副作用，**不自动重放**，落 failed 交人工核对（幂等键只能防重复提交，
 * 防不了"外部系统已经生效但本地没记上"）。
 */

/** 单测注入 fake，不必拉起 Copilot runtime */
export type WorkflowTurnRunner = (input: {
  execution: {
    executionId: string;
    sessionId: string;
    tenantId: string;
    userId: string;
    model?: string;
  };
  prompt: string;
}) => Promise<{ content: string; chars: number }>;

export interface WorkflowRunnerDeps {
  executions: ExecutionService;
  humanTasks: HumanTaskService;
  runTurn: WorkflowTurnRunner;
  /** 技能搜索目录（默认内置 + COPILOT_SKILL_ROOTS） */
  skillDirs?: string[];
  /** 暂停等人工时释放 SDK session（审批可能几小时，不该占着 runtime） */
  disconnectIdle?: (sessionId: string) => Promise<unknown>;
}

/** 校验失败：带行号的问题列表，路由层直接回 400 */
export class FlowValidationError extends Error {
  constructor(readonly issues: FlowIssue[]) {
    super(
      `Skill Flow 校验失败：\n${issues.map((i) => `  SKILL.md:${i.line} ${i.message}`).join('\n')}`,
    );
    this.name = 'FlowValidationError';
  }
}

export interface PreparedFlow {
  skill: LoadedSkill;
  definition: FlowDefinition;
}

/** `@agent` 输出落进 workflow_state 的截断长度（它只是下一步的判断依据，不是证据仓库） */
const OUTPUT_MAX_CHARS = 4000;

/**
 * 允许"重放"的节点类型：纯计算，重跑只是多花一次算力，不会留下副作用。
 *
 * `@action` **刻意不在里面**：它可能已经把动作做出去了，重放等于重复提交。
 */
const REPLAY_SAFE_NODE_TYPES: ReadonlySet<FlowNodeType> = new Set<FlowNodeType>(['agent', 'gate']);

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** 节点正文的第一行非空内容，用作停止/完成原因 */
function firstLine(body: string): string {
  return body.split('\n').map((s) => s.trim()).find(Boolean) ?? '';
}

/** 一步的结果：出口名 + 落进审计的细节 */
interface StepResult {
  outcome: string;
  detail?: Record<string, unknown>;
  lastOutput?: string;
}

export class WorkflowRunner {
  constructor(private readonly deps: WorkflowRunnerDeps) {}

  private skillDirs(): string[] {
    return this.deps.skillDirs ?? skillSearchDirs();
  }

  /** 加载 → 解析 → 校验。任一环节有问题就带上行号抛出去 */
  prepare(input: { skill: string; flow: string }): PreparedFlow {
    const loaded = this.load(input.skill, input.flow);
    if (!loaded.ok) throw new FlowValidationError(loaded.issues);
    return { skill: loaded.skill, definition: loaded.definition };
  }

  /** 只校验不抛（execution start 之前调用，把问题全部报出来再决定要不要建） */
  validate(input: { skill: string; flow: string }): { ok: boolean; issues: FlowIssue[] } {
    const loaded = this.load(input.skill, input.flow);
    return loaded.ok ? { ok: true, issues: [] } : { ok: false, issues: loaded.issues };
  }

  /**
   * 后台推进流程（202 之后调用，不阻塞 HTTP）。
   *
   * 编排器自己的异常**必须**在终态落地：只 log 的话，`buildIntent()` / `createApprovalTask()` /
   * `transition()` / registry 抛出来的意外错误会留下一个永远 `running` 的 execution ——
   * 它占着队列、挡住取消、也没人知道该不该重跑。
   *
   * 注意 `runSubagent()` / `runGate()` 自己 catch 了节点内的失败（那是**可路由**的出口），
   * 所以这里兜住的是真正未预期的异常，测试里不容易碰到 —— 正因为不容易碰到才必须写。
   */
  runDetached(record: ExecutionRecord): void {
    void this.run(record.executionId).catch(async (err) => {
      console.error(`[workflow] execution ${record.executionId} 推进异常：`, err);
      try {
        const current = await this.deps.executions.get(record.executionId);
        if (current && !isTerminal(current.status)) {
          await this.deps.executions.fail(record.executionId, err);
        }
      } catch (failErr) {
        // 连落 failed 都失败（库挂了）：至少日志里要有，运维才能从外部状态核对
        console.error(`[workflow] execution ${record.executionId} 无法落 failed：`, failErr);
      }
    });
  }

  /** 从 execution 上的 durable 状态开始推进 */
  async run(executionId: string): Promise<void> {
    const rec = await this.deps.executions.get(executionId);
    if (!rec) throw new Error(`execution 不存在："${executionId}"`);
    const state = rec.workflow;
    if (!state) throw new Error(`execution "${executionId}" 没有 workflow_state（不是 workflow）`);
    const loaded = await this.loadChecked(executionId, state);
    if (!loaded) return;
    if (state.steps === 0) {
      await this.append(executionId, EVT.workflowStarted, {
        skill: state.skill,
        flow: state.flow,
        start: state.current,
      });
    }
    if (!(await this.admitInterruptedStep(executionId, state, loaded.definition))) return;
    await this.loop(rec, state, loaded.definition);
  }

  /**
   * 上一次推进在**节点中途**退出（durable 状态里留着 `stepStatus = running`）时的准入判断。
   *
   * 这是 `stepStatus` 存在的全部意义：只有它能把"这一步已经开始过"和"这一步还没跑"区分开。
   *
   *   @agent / @gate  纯计算 → 记一条审计后直接重跑
   *   @action         有副作用 → 不重放，落 failed 交人工核对
   *
   * @returns false = 已落终态 / 不该继续推进
   */
  private async admitInterruptedStep(
    executionId: string,
    state: WorkflowState,
    definition: FlowDefinition,
  ): Promise<boolean> {
    if (state.stepStatus !== 'running') return true;
    const node = definition.nodes[state.current];
    await this.append(executionId, EVT.workflowStepInterrupted, {
      nodeId: state.current,
      nodeType: node?.type ?? 'unknown',
      steps: state.steps,
    });
    // 节点不存在交给 loop() 报"节点不存在"，这里不重复判定
    if (!node || REPLAY_SAFE_NODE_TYPES.has(node.type)) return true;
    await this.failWorkflow(
      executionId,
      state,
      `节点 "${state.current}" 已开始执行但未确认完成（进程在步骤中途退出）：` +
        '有副作用的步骤不自动重放。请人工核对外部系统是否已生效（幂等键 action:<executionId>:<actionHash>），' +
        '确认后再决定是否重新发起',
    );
    return false;
  }

  /**
   * 人工任务收敛后的续跑。由 wiring 的 dispatcher 按 `payload.workflow` 路由进来
   * （没有 workflow 标记的任务仍走 ExecutionService.onHumanTaskResolved，原有动作审批不受影响）。
   */
  async onHumanTaskResolved(
    task: HumanTask,
    resolution: 'approved' | 'rejected' | 'expired' | 'cancelled' | 'input_submitted',
    decisions: HumanTask['decisions'],
  ): Promise<void> {
    const rec = await this.deps.executions.get(task.executionId);
    const state = rec?.workflow;
    if (!rec || !state) return;

    const marker = task.payload?.workflow as { nodeId?: string; kind?: string } | undefined;
    const nodeId = marker?.nodeId;
    if (!nodeId) {
      await this.failWorkflow(task.executionId, state, 'workflow 人工任务缺少 nodeId 标记，无法恢复');
      return;
    }
    const loaded = await this.loadChecked(task.executionId, state);
    if (!loaded) return;
    const node = loaded.definition.nodes[nodeId];
    if (!node) {
      await this.failWorkflow(task.executionId, state, `人工任务指向的节点 "${nodeId}" 不存在`);
      return;
    }
    if (resolution === 'input_submitted') {
      await this.failWorkflow(task.executionId, state, `workflow 节点 "${nodeId}" 不接受输入任务`);
      return;
    }

    if (marker?.kind === 'action') {
      await this.resumeAction(rec, state, node, resolution, decisions);
      return;
    }
    await this.resumeReview(rec, state, node, resolution, decisions);
  }

  // ---------- 主循环 ----------

  private async loop(
    rec: ExecutionRecord,
    initial: WorkflowState,
    definition: FlowDefinition,
  ): Promise<void> {
    const executionId = rec.executionId;
    let state = initial;

    for (;;) {
      const node = definition.nodes[state.current];
      if (!node) {
        await this.failWorkflow(executionId, state, `节点 "${state.current}" 不存在（SKILL.md 可能已变更）`);
        return;
      }
      if (state.steps >= MAX_FLOW_STEPS) {
        await this.failWorkflow(
          executionId,
          state,
          `超过单次 workflow 的步数上限 ${MAX_FLOW_STEPS}（环不收敛？review 一直在打回？）`,
        );
        return;
      }

      await this.append(executionId, EVT.workflowStepStarted, {
        nodeId: node.id,
        nodeType: node.type,
        step: state.steps,
      });

      // 执行**之前**先落 running：进程在节点中途退出时，durable 状态里留下"这一步开始了"。
      // 没有它，重启后既可能重放已完成的动作，也可能跳过没跑完的动作。
      if (state.stepStatus !== 'running') {
        state = { ...state, stepStatus: 'running' };
        await this.deps.executions.updateWorkflowState(executionId, state);
      }

      let result: StepResult;
      switch (node.type) {
        case 'agent':
          result = await this.runAgent(rec, state, node);
          break;
        case 'gate':
          result = await this.runGate(rec, state, node);
          break;
        case 'action': {
          const action = await this.runAction(rec, state, node);
          // 需要审批：流程暂停，等人工任务收敛后由 onHumanTaskResolved 续跑
          if (action === 'waiting') {
            await this.releaseSession(rec.sessionId);
            return;
          }
          result = action;
          break;
        }
        case 'review':
          await this.pauseForReview(rec, state, node);
          await this.releaseSession(rec.sessionId);
          return;
        case 'stop':
          await this.stopWorkflow(rec, state, node);
          return;
        case 'end':
          await this.endWorkflow(rec, state, node);
          return;
        default:
          await this.failWorkflow(executionId, state, `不支持的节点类型：${String(node.type)}`);
          return;
      }

      if (result.lastOutput !== undefined) state = { ...state, lastOutput: result.lastOutput };

      await this.append(executionId, EVT.workflowStepCompleted, {
        nodeId: node.id,
        nodeType: node.type,
        outcome: result.outcome,
        ...(result.detail ?? {}),
      });

      const next = this.findRoute(node, result.outcome);
      if (!next) {
        await this.failWorkflow(
          executionId,
          { ...state, lastOutcome: result.outcome },
          `节点 "${node.id}" 没有匹配出口 "${result.outcome}" 的 route（已声明：${node.routes.map((r) => r.on).join(', ') || '(无)'}）`,
        );
        return;
      }

      state = {
        ...state,
        current: next,
        stepStatus: 'pending',
        steps: state.steps + 1,
        lastOutcome: result.outcome,
        waitingTaskId: undefined,
      };
      // 执行完才把 current 推到下一个节点：中途退出时停在"跑了一半"的那一步，
      // 由 admitInterruptedStep() 决定能不能重放，而不是把没执行完的步骤直接跳过
      await this.deps.executions.updateWorkflowState(executionId, state);
    }
  }

  // ---------- 节点实现 ----------

  /**
   * @agent：复用 runExecutionTurn —— Copilot session、model、tool policy、tool 证据、
   * usage 全部走现在的路径。节点**不拥有任何新的工具权限**，也不自己拼 prompt 模板。
   *
   * 注意它**不是真正的 subagent 委派**：跑的是当前 session 的又一次 agent turn，
   * 而不是另起一个独立 agent / 独立技能进程。所以关键字叫 `@agent`（旧名 `@subagent`
   * 仍然认，但含义一样）。真要做 skill → skill 的委派，得先实现 subagent invocation。
   *
   * 节点 id 就是技能名（`## @agent investment-research`）：技能必须先存在，
   * 找不到就失败，而不是让 LLM 自己猜一个。
   */
  private async runAgent(
    rec: ExecutionRecord,
    state: WorkflowState,
    node: FlowNode,
  ): Promise<StepResult> {
    const skill = findSkill(node.id, this.skillDirs());
    if (!skill) {
      return { outcome: 'fail', detail: { nodeId: node.id, error: `技能 "${node.id}" 不存在` } };
    }
    const prompt = node.body.trim() || `执行技能「${node.id}」`;
    try {
      const result = await this.deps.runTurn({
        execution: {
          executionId: rec.executionId,
          sessionId: rec.sessionId,
          tenantId: rec.tenantId,
          userId: rec.userId,
          ...(rec.model ? { model: rec.model } : {}),
        },
        prompt,
      });
      return {
        outcome: 'success',
        detail: { nodeId: node.id, skill: node.id, chars: result.chars || result.content.length },
        lastOutput: preview(result.content, OUTPUT_MAX_CHARS),
      };
    } catch (err) {
      // 跑不动是流程里一个**可路由**的出口（`- fail -> research-failed`），不是编排器崩溃
      return { outcome: 'fail', detail: { nodeId: node.id, skill: node.id, error: errMsg(err) } };
    }
  }

  /** @gate：确定性判断。结果只能来自服务端注册的实现，agent 的自我评价不算数 */
  private async runGate(
    rec: ExecutionRecord,
    state: WorkflowState,
    node: FlowNode,
  ): Promise<StepResult> {
    const gate = findFlowGate(node.id);
    if (!gate) {
      return { outcome: 'fail', detail: { nodeId: node.id, error: `gate "${node.id}" 未注册` } };
    }
    try {
      const result = await gate.evaluate(this.flowContext(rec, state, node));
      return {
        outcome: result.outcome,
        detail: { nodeId: node.id, gate: node.id, ...(result.reason ? { reason: result.reason } : {}) },
      };
    } catch (err) {
      return { outcome: 'fail', detail: { nodeId: node.id, gate: node.id, error: errMsg(err) } };
    }
  }

  /**
   * @action：**不直接调 executor**，而是走 proposeAction 的完整链路
   * （策略 → 自动放行/审批 → hash + resourceVersion 复核 → executor）。
   * 执行完不收尾（`completeOnSuccess: false`），因为后面还有节点。
   */
  private async runAction(
    rec: ExecutionRecord,
    state: WorkflowState,
    node: FlowNode,
  ): Promise<StepResult | 'waiting'> {
    const action = findFlowAction(node.id);
    if (!action) {
      return { outcome: 'fail', detail: { nodeId: node.id, error: `action "${node.id}" 未注册` } };
    }
    const intent = await action.buildIntent(this.flowContext(rec, state, node));
    const verdict = await this.deps.executions.proposeAction(rec.executionId, intent, {
      workflow: { nodeId: node.id },
    });

    if (verdict.decision === 'denied') {
      return {
        outcome: 'fail',
        detail: { nodeId: node.id, actionType: action.actionType, decision: 'denied', reason: verdict.reason },
      };
    }
    if (verdict.decision === 'needs_approval') {
      await this.deps.executions.updateWorkflowState(rec.executionId, {
        ...state,
        current: node.id,
        stepStatus: 'waiting',
        waitingTaskId: verdict.taskId,
      });
      await this.append(rec.executionId, EVT.workflowWaiting, {
        nodeId: node.id,
        taskId: verdict.taskId,
        kind: 'action',
      });
      return 'waiting';
    }
    const r = verdict.result as { ok?: boolean; error?: string } | undefined;
    const ok = r?.ok !== false;
    return {
      outcome: ok ? 'success' : 'fail',
      detail: {
        nodeId: node.id,
        actionType: action.actionType,
        decision: 'auto_approve',
        ...(r?.error ? { error: r.error } : {}),
      },
    };
  }

  /** @review：复用 HumanTask + ApprovalPolicy，不重新发明人工任务 */
  private async pauseForReview(
    rec: ExecutionRecord,
    state: WorkflowState,
    node: FlowNode,
  ): Promise<void> {
    const review = findFlowReview(node.id);
    if (!review) {
      await this.failWorkflow(rec.executionId, state, `review "${node.id}" 未注册`);
      return;
    }
    const policy: ApprovalPolicy = {
      policyId: `workflow-review:${node.id}`,
      actionType: `workflow.review.${node.id}`,
      strategy: review.strategy,
      ...(review.requiredCount !== undefined ? { requiredCount: review.requiredCount } : {}),
      eligibleRoles: review.eligibleRoles,
      allowInitiator: false,
      ...(review.timeoutSeconds !== undefined ? { timeoutSeconds: review.timeoutSeconds } : {}),
    };
    const task = await this.deps.humanTasks.createApprovalTask({
      executionId: rec.executionId,
      tenantId: rec.tenantId,
      title: review.title,
      description: review.description ?? firstLine(node.body) ?? undefined,
      payload: {
        workflow: { executionId: rec.executionId, nodeId: node.id, kind: 'review' },
        skill: state.skill,
        flow: state.flow,
      },
      policy,
      initiatedBy: rec.initiatedByUserId ?? rec.userId,
    });
    await this.deps.executions.transition(rec.executionId, 'waiting_for_approval', {
      currentHumanTaskId: task.taskId,
      waitReason: 'approval',
    });
    await this.append(rec.executionId, EVT.humanTaskCreated, { taskId: task.taskId, type: task.type });
    await this.append(rec.executionId, EVT.waitingForApproval, { taskId: task.taskId });
    await this.append(rec.executionId, EVT.workflowWaiting, {
      nodeId: node.id,
      taskId: task.taskId,
      kind: 'review',
    });
    await this.deps.executions.updateWorkflowState(rec.executionId, {
      ...state,
      current: node.id,
      stepStatus: 'waiting',
      waitingTaskId: task.taskId,
    });
  }

  /** @stop：失败/拒绝终态。execution 落 failed（终态，不自动重试） */
  private async stopWorkflow(
    rec: ExecutionRecord,
    state: WorkflowState,
    node: FlowNode,
  ): Promise<void> {
    const reason = firstLine(node.body) || `流程在节点 ${node.id} 终止`;
    // 终止节点也算一步：steps 要能和 stepCompleted 事件的条数对上，
    // 否则重启后的账目和实际推过的步数会差一步
    const settled: WorkflowState = {
      ...state,
      current: node.id,
      stepStatus: 'completed',
      steps: state.steps + 1,
      waitingTaskId: undefined,
    };
    await this.append(rec.executionId, EVT.workflowStepCompleted, {
      nodeId: node.id,
      nodeType: 'stop',
      outcome: 'stopped',
    });
    await this.deps.executions.updateWorkflowState(rec.executionId, settled);
    await this.failWorkflow(rec.executionId, settled, reason);
  }

  /** @end：成功终态 */
  private async endWorkflow(
    rec: ExecutionRecord,
    state: WorkflowState,
    node: FlowNode,
  ): Promise<void> {
    const summary = firstLine(node.body) || '流程完成';
    const steps = state.steps + 1;
    const settled: WorkflowState = {
      ...state,
      current: node.id,
      stepStatus: 'completed',
      steps,
      lastOutcome: 'completed',
      waitingTaskId: undefined,
    };
    await this.append(rec.executionId, EVT.workflowStepCompleted, {
      nodeId: node.id,
      nodeType: 'end',
      outcome: 'completed',
    });
    await this.deps.executions.updateWorkflowState(rec.executionId, settled);
    await this.append(rec.executionId, EVT.workflowCompleted, {
      nodeId: node.id,
      skill: state.skill,
      flow: state.flow,
      steps,
    });
    await this.deps.executions.complete(rec.executionId, {
      result: {
        workflow: { skill: state.skill, flow: state.flow, steps, nodeId: node.id, summary },
      },
    });
  }

  // ---------- 人工任务收敛后的续跑 ----------

  private async resumeReview(
    rec: ExecutionRecord,
    state: WorkflowState,
    node: FlowNode,
    resolution: 'approved' | 'rejected' | 'expired' | 'cancelled',
    _decisions: HumanTask['decisions'],
  ): Promise<void> {
    // 审核出口就两个：approve / reject。
    // 想表达「打回重做」不必新造一个 decision 类型 —— 把 route 指回上一步即可
    // （`- reject -> research`），环是允许的，MAX_FLOW_STEPS 兜底。
    const outcome = resolution === 'approved' ? 'approve' : resolution === 'rejected' ? 'reject' : null;
    if (!outcome) {
      // expired / cancelled 时 execution 已被落成终态，流程无法继续
      await this.append(rec.executionId, EVT.workflowFailed, {
        nodeId: node.id,
        resolution,
        reason: `人工任务 ${resolution}`,
      });
      return;
    }
    await this.append(rec.executionId, EVT.workflowStepCompleted, {
      nodeId: node.id,
      nodeType: node.type,
      outcome,
      resolution,
    });
    await this.resumeInto(rec.executionId, state, node, outcome);
  }

  private async resumeAction(
    rec: ExecutionRecord,
    state: WorkflowState,
    node: FlowNode,
    resolution: 'approved' | 'rejected' | 'expired' | 'cancelled',
    decisions: HumanTask['decisions'],
  ): Promise<void> {
    if (resolution === 'rejected') {
      await this.append(rec.executionId, EVT.workflowStepCompleted, {
        nodeId: node.id,
        nodeType: node.type,
        outcome: 'fail',
        resolution,
      });
      await this.resumeInto(rec.executionId, state, node, 'fail');
      return;
    }
    if (resolution !== 'approved') {
      await this.append(rec.executionId, EVT.workflowFailed, {
        nodeId: node.id,
        resolution,
        reason: `动作审批 ${resolution}`,
      });
      return;
    }
    // 与普通动作审批**同一条**执行路径：同幂等键、同 hash/版本复核
    const result = await this.deps.executions.executeApprovedAction(rec.executionId, {
      completeOnSuccess: false,
      actor: decisions?.[decisions.length - 1]?.approverId ?? 'approver',
    });
    if (result.status === 'reapproval_required') {
      // 动作内容或数据版本变了：已另开审批任务并回到 waiting_for_approval，继续等
      return;
    }
    const ok = result.status === 'executed' && result.ok;
    await this.append(rec.executionId, EVT.workflowStepCompleted, {
      nodeId: node.id,
      nodeType: node.type,
      outcome: ok ? 'success' : 'fail',
      ...(result.status === 'executed' && result.error ? { error: result.error } : {}),
    });
    await this.resumeInto(rec.executionId, state, node, ok ? 'success' : 'fail');
  }

  /** 从暂停点推进：补 resuming/running 状态 → 落新节点 → 继续主循环 */
  private async resumeInto(
    executionId: string,
    state: WorkflowState,
    node: FlowNode,
    outcome: string,
  ): Promise<void> {
    await this.append(executionId, EVT.workflowResumed, {
      nodeId: node.id,
      taskId: state.waitingTaskId,
      outcome,
    });
    const current = await this.deps.executions.get(executionId);
    if (!current) return;
    if (!(await this.ensureRunning(executionId))) {
      await this.append(executionId, EVT.workflowFailed, {
        nodeId: node.id,
        reason: `execution 已是 ${current.status}，流程无法继续`,
      });
      return;
    }
    const next = this.findRoute(node, outcome);
    if (!next) {
      await this.failWorkflow(
        executionId,
        { ...state, lastOutcome: outcome },
        `节点 "${node.id}" 没有匹配出口 "${outcome}" 的 route（已声明：${node.routes.map((r) => r.on).join(', ') || '(无)'}）`,
      );
      return;
    }
    const advanced: WorkflowState = {
      ...state,
      current: next,
      stepStatus: 'pending',
      steps: state.steps + 1,
      lastOutcome: outcome,
      waitingTaskId: undefined,
    };
    await this.deps.executions.updateWorkflowState(executionId, advanced);

    const rec = await this.deps.executions.get(executionId);
    if (!rec) return;
    const loaded = await this.loadChecked(executionId, advanced);
    if (!loaded) return;
    await this.loop(rec, advanced, loaded.definition);
  }

  /**
   * 把 execution 从等待态推回 running。
   * @returns false = 状态已经不可能继续（终态/被别人改走），调用方应停止推进
   */
  private async ensureRunning(executionId: string): Promise<boolean> {
    const rec = await this.deps.executions.get(executionId);
    if (!rec) return false;
    if (rec.status === 'waiting_for_approval' || rec.status === 'waiting_for_input') {
      await this.deps.executions.transition(executionId, 'resuming');
      await this.deps.executions.transition(executionId, 'running');
      return true;
    }
    return rec.status === 'running';
  }

  // ---------- 内部 ----------

  /** 唯一出口匹配：不做"只有一个出口就兜底"的猜测，出口名写错要立刻看得见 */
  private findRoute(node: FlowNode, outcome: string): string | undefined {
    return node.routes.find((r) => r.on === outcome)?.to;
  }

  private flowContext(rec: ExecutionRecord, state: WorkflowState, node: FlowNode): FlowContext {
    return {
      executionId: rec.executionId,
      sessionId: rec.sessionId,
      tenantId: rec.tenantId,
      initiatorId: rec.initiatedByUserId ?? rec.userId,
      skill: state.skill,
      flow: state.flow,
      nodeId: node.id,
      ...(rec.input !== undefined ? { input: rec.input } : {}),
      ...(state.lastOutput ? { lastOutput: state.lastOutput } : {}),
    };
  }

  private append(
    executionId: string,
    type: string,
    payload?: Record<string, unknown>,
  ): Promise<void> {
    return this.deps.executions.appendEvent({
      executionId,
      type,
      actorType: 'system',
      ...(payload ? { payload } : {}),
    });
  }

  /** 进等待态前释放 SDK session；释放失败不影响流程（下次 resume 会重新拉起） */
  private async releaseSession(sessionId: string): Promise<void> {
    try {
      await this.deps.disconnectIdle?.(sessionId);
    } catch (err) {
      console.warn(`[workflow] 释放 session ${sessionId} 失败：${errMsg(err)}`);
    }
  }

  private async failWorkflow(
    executionId: string,
    state: WorkflowState,
    reason: string,
  ): Promise<void> {
    console.warn(`[workflow] execution ${executionId} 失败：${reason}`);
    await this.append(executionId, EVT.workflowFailed, {
      nodeId: state.current,
      steps: state.steps,
      reason,
    });
    await this.deps.executions.fail(executionId, new Error(`workflow 失败：${reason}`));
  }

  /**
   * 加载并确认 SKILL.md **没有在流程中途被改过**。
   *
   * sourceHash 只是一个字段，但它挡住的是金融流程最不该发生的事：
   * 已经开始的执行悄悄切到另一个版本的流程定义上继续跑。
   */
  private async loadChecked(
    executionId: string,
    state: WorkflowState,
  ): Promise<{ definition: FlowDefinition } | undefined> {
    const dirs = this.skillDirs();
    const skill = loadSkill(state.skill, dirs);
    if (!skill) {
      await this.failWorkflow(executionId, state, `技能 "${state.skill}" 已不存在`);
      return undefined;
    }
    if (skill.sourceHash !== state.sourceHash) {
      await this.failWorkflow(
        executionId,
        state,
        `SKILL.md 已被修改（建立时 ${state.sourceHash.slice(0, 12)}…，现在 ${skill.sourceHash.slice(0, 12)}…）：` +
          '流程进行到一半不能切到另一个版本，请人工确认',
      );
      return undefined;
    }
    const loaded = this.load(state.skill, state.flow);
    if (!loaded.ok) {
      await this.failWorkflow(
        executionId,
        state,
        `SKILL.md 现在校验不过：${loaded.issues.map((i) => `SKILL.md:${i.line} ${i.message}`).join('；')}`,
      );
      return undefined;
    }
    return { definition: loaded.definition };
  }

  private load(
    skillName: string,
    flowName: string,
  ):
    | { ok: true; skill: LoadedSkill; definition: FlowDefinition }
    | { ok: false; issues: FlowIssue[] } {
    const dirs = this.skillDirs();
    const skill = loadSkill(skillName, dirs);
    if (!skill) {
      return {
        ok: false,
        issues: [
          {
            code: 'skill-missing',
            line: 0,
            message: `技能不存在："${skillName}"（搜索目录：${dirs.join(', ') || '(空)'}）`,
          },
        ],
      };
    }
    const parsed = parseSkillFlow(skill.markdown);
    const validated = validateSkillFlow(parsed, {
      flow: flowName,
      registry: flowRegistryLookup,
      hasSkill: (name) => Boolean(findSkill(name, dirs)),
    });
    if (!validated.definition) return { ok: false, issues: validated.issues };
    return { ok: true, skill, definition: validated.definition };
  }
}

import type { ApprovalPolicy } from '../approval/types.js';
import type { ExecutionRecord } from '../execution/types.js';
import type { HumanTask } from '../human-tasks/types.js';
import type { HumanTaskService } from '../human-tasks/human-task-service.js';
import type { ExecutionService } from '../execution/execution-service.js';
import {
  clearAgentCapability,
  resolveAgentTools,
  setAgentCapability,
} from './capability.js';
import { findFlowAction, findFlowGate, findFlowOutput } from './registry.js';
import type { FlowContext, FlowNode, FlowPermissionKind, WorkflowState } from './types.js';

/**
 * **节点执行器**：把"一个节点怎么跑"从状态机里拆出来。
 *
 *   WorkflowRunner   状态怎么推进、什么时候落库、人工任务怎么接回来、冲突怎么办
 *   FlowNodeRuntime  一个 @agent / @gate / @action / @review 具体怎么执行
 *
 * 两者变化原因完全不同：换一个 gate 实现、把 agent 换成真正的 subagent 委派、
 * 换一套人工任务系统 —— 都只该动这一层。
 *
 * 刻意**不**做成一个大的 `WorkflowEngine` 接口（那样等于把状态机和执行器又粘回去）：
 * 定义来源是 `definition-provider.ts`，节点执行是本文件，两条独立的轴。
 *
 * 默认实现把三类执行全部复用现有体系：
 *   @agent  → runExecutionTurn（同一 session / model / tool policy）
 *   @gate   → 服务端注册的确定性函数
 *   @action → ExecutionService.proposeAction（策略 → 审批 → hash/版本复核 → executor）
 *   @review → HumanTaskService.createApprovalTask（同一套 My Tasks / SoD / 审计）
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

export interface FlowAgentRun {
  /** 含**完成契约**的判定结果：契约没过就是 false（那是可路由的 fail 出口） */
  ok: boolean;
  /** turn 的原始输出（截断前；契约判定用的就是它） */
  content: string;
  chars: number;
  /** ok=false 时的原因（跑不动 / 契约没过） */
  error?: string;
}

export interface FlowGateRun {
  outcome: string;
  reason?: string;
  /** gate 抛错 / 未注册 —— 归到可路由的 fail 出口 */
  error?: string;
}

export type FlowActionRun =
  /** 动作已经有结论（auto_approve 执行完 / 审批通过后执行完） */
  | { status: 'executed'; ok: boolean; error?: string; detail: Record<string, unknown> }
  /** 需要人工审批：流程暂停，等任务收敛后续跑 */
  | { status: 'waiting'; taskId: string; detail: Record<string, unknown> }
  /** 策略直接拒绝（含"动作类型未登记"、"流程角色越界"）—— 走 fail 出口 */
  | { status: 'denied'; reason: string; detail: Record<string, unknown> };

export interface FlowNodeRuntime {
  runAgent(input: {
    execution: ExecutionRecord;
    state: WorkflowState;
    node: FlowNode;
    ctx: FlowContext;
    prompt: string;
  }): Promise<FlowAgentRun>;
  runGate(input: { ctx: FlowContext; node: FlowNode }): Promise<FlowGateRun>;
  runAction(input: {
    execution: ExecutionRecord;
    node: FlowNode;
    ctx: FlowContext;
  }): Promise<FlowActionRun>;
  openReview(input: {
    execution: ExecutionRecord;
    state: WorkflowState;
    node: FlowNode;
    policy: ApprovalPolicy;
    title: string;
    description?: string;
  }): Promise<{ taskId: string; type: HumanTask['type'] }>;
}

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export interface DefaultRuntimeDeps {
  executions: ExecutionService;
  humanTasks: HumanTaskService;
  runTurn: WorkflowTurnRunner;
  /**
   * `@agent` 节点的服务端**能力上限**（config.workflowAgentTools）。
   *
   * 默认不含 mcp / shell：那两样正是 agent 绕开 `@action` 审批直接对外产生业务副作用的路径。
   * 节点上的 `tools:` 只能在它之内收窄。
   */
  agentTools: readonly FlowPermissionKind[];
}

export class DefaultFlowNodeRuntime implements FlowNodeRuntime {
  constructor(private readonly deps: DefaultRuntimeDeps) {}

  /**
   * @agent：复用 runExecutionTurn —— Copilot session、model、tool policy、tool 证据、
   * usage 全部走现在的路径。节点**不拥有任何新的工具权限**，也不自己拼 prompt 模板。
   *
   * 注意它**不是真正的 subagent 委派**：跑的是当前 session 的又一次 agent turn，
   * 而不是另起一个独立 agent / 独立技能进程。所以关键字叫 `@agent`（旧名 `@subagent`
   * 仍然认，但含义一样）。真要做 skill → skill 的委派，得先实现 subagent invocation。
   *
   * 执行期间套上**能力边界**（见 capability.ts）：agent 可以读、可以在 workspace 里写、
   * 可以出站取数，但**碰不到 MCP 与 shell** —— 否则它完全可以不走 `@action`，
   * 直接调一个 MCP server 把结论发出去，整条流程的审批就成了摆设。
   *
   * 跑完之后还要过**完成契约**（`output:`）：`turn 没抛异常` ≠ `业务上做完了`。
   * 契约是服务端注册的确定性函数，不让模型自评。
   */
  async runAgent(input: {
    execution: ExecutionRecord;
    state: WorkflowState;
    node: FlowNode;
    ctx: FlowContext;
    prompt: string;
  }): Promise<FlowAgentRun> {
    const { execution, state, node, ctx, prompt } = input;
    const kinds = new Set(resolveAgentTools(this.deps.agentTools, node.attrs.tools));
    setAgentCapability(execution.sessionId, { kinds, nodeId: node.id, flow: state.flow });
    try {
      const result = await this.deps.runTurn({
        execution: {
          executionId: execution.executionId,
          sessionId: execution.sessionId,
          tenantId: execution.tenantId,
          userId: execution.userId,
          ...(execution.model ? { model: execution.model } : {}),
        },
        prompt,
      });
      const content = result.content;
      const chars = result.chars || content.length;

      if (node.attrs.output) {
        const contract = findFlowOutput(node.attrs.output);
        if (!contract) {
          // 校验器已保证契约已注册；走到这里说明注册表在运行期被改过 —— fail-closed
          return {
            ok: false,
            content,
            chars,
            error: `完成契约 "${node.attrs.output}" 未在服务端注册`,
          };
        }
        const verdict = await contract.validate({ ...ctx, content });
        if (!verdict.ok) {
          return {
            ok: false,
            content,
            chars,
            error:
              `@agent ${node.id} 未通过完成契约 "${contract.name}"（${contract.description}）：` +
              `${verdict.reason ?? '未给出原因'}`,
          };
        }
      }
      return { ok: true, content, chars };
    } catch (err) {
      // 跑不动是流程里一个**可路由**的出口（`- fail -> research-failed`），不是编排器崩溃
      return { ok: false, content: '', chars: 0, error: errMsg(err) };
    } finally {
      clearAgentCapability(execution.sessionId, node.id);
    }
  }

  /** @gate：确定性判断。结果只能来自服务端注册的实现，agent 的自我评价不算数 */
  async runGate(input: { ctx: FlowContext; node: FlowNode }): Promise<FlowGateRun> {
    const gate = findFlowGate(input.node.id);
    if (!gate) {
      return { outcome: 'fail', error: `gate "${input.node.id}" 未注册` };
    }
    try {
      const result = await gate.evaluate(input.ctx);
      return { outcome: result.outcome, ...(result.reason ? { reason: result.reason } : {}) };
    } catch (err) {
      return { outcome: 'fail', error: errMsg(err) };
    }
  }

  /**
   * @action：**不直接调 executor**，而是走 proposeAction 的完整链路
   * （策略 → 自动放行/审批 → hash + resourceVersion 复核 → executor）。
   * 执行完不收尾（`completeOnSuccess: false`），因为后面还有节点。
   *
   * `@action role:` 只**收窄**该动作类型的审批资格，不会放宽；
   * 交集为空时 ActionService 直接拒绝，流程走 `- fail -> ...`。
   */
  async runAction(input: {
    execution: ExecutionRecord;
    node: FlowNode;
    ctx: FlowContext;
  }): Promise<FlowActionRun> {
    const { execution, node, ctx } = input;
    const action = findFlowAction(node.id);
    if (!action) {
      return {
        status: 'denied',
        reason: `action "${node.id}" 未注册`,
        detail: { error: `action "${node.id}" 未注册` },
      };
    }
    const intent = await action.buildIntent(ctx);
    const verdict = await this.deps.executions.proposeAction(execution.executionId, intent, {
      workflow: {
        nodeId: node.id,
        ...(node.attrs.role ? { restrictRoles: [node.attrs.role] } : {}),
      },
    });

    if (verdict.decision === 'denied') {
      return {
        status: 'denied',
        reason: verdict.reason ?? '策略拒绝',
        detail: {
          actionType: action.actionType,
          decision: 'denied',
          ...(verdict.reason ? { reason: verdict.reason } : {}),
        },
      };
    }
    if (verdict.decision === 'needs_approval') {
      return {
        status: 'waiting',
        taskId: verdict.taskId!,
        detail: { actionType: action.actionType, taskId: verdict.taskId },
      };
    }
    const r = verdict.result as { ok?: boolean; error?: string } | undefined;
    const ok = r?.ok !== false;
    return {
      status: 'executed',
      ok,
      ...(r?.error ? { error: r.error } : {}),
      detail: {
        actionType: action.actionType,
        decision: 'auto_approve',
        ...(r?.error ? { error: r.error } : {}),
      },
    };
  }

  /** @review：复用 HumanTask + ApprovalPolicy，不重新发明人工任务 */
  async openReview(input: {
    execution: ExecutionRecord;
    state: WorkflowState;
    node: FlowNode;
    policy: ApprovalPolicy;
    title: string;
    description?: string;
  }): Promise<{ taskId: string; type: HumanTask['type'] }> {
    const { execution, state, node, policy, title, description } = input;
    const task = await this.deps.humanTasks.createApprovalTask({
      executionId: execution.executionId,
      tenantId: execution.tenantId,
      title,
      ...(description ? { description } : {}),
      payload: {
        workflow: { executionId: execution.executionId, nodeId: node.id, kind: 'review' },
        skill: state.skill,
        flow: state.flow,
      },
      policy,
      initiatedBy: execution.initiatedByUserId ?? execution.userId,
    });
    return { taskId: task.taskId, type: task.type };
  }
}

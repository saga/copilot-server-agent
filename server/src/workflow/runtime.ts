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
import { findFlowCommand, findFlowGate, findFlowOutput } from './registry.js';
import type { FlowContext, FlowNode, FlowPermissionKind, WorkflowState } from './types.js';

/**
 * **节点执行器**：把"一个节点怎么跑"从状态机里拆出来。
 *
 *   WorkflowRunner   状态怎么推进、什么时候落库、人工任务怎么接回来、冲突怎么办
 *   FlowNodeRuntime  一个 @task / @gate / @command / @review 具体怎么执行
 *
 * 两者变化原因完全不同：换一个 gate 实现、把 AI 执行后端从 Copilot 换成
 * OpenAI Agents SDK、换一套人工任务系统 —— 都只该动这一层。
 *
 * 刻意**不**做成一个大的 `WorkflowEngine` 接口（那样等于把状态机和执行器又粘回去）：
 * 定义来源是 `definition-provider.ts`，节点执行是本文件，两条独立的轴。
 *
 * 默认实现把三类执行全部复用现有体系：
 *   @task   → runExecutionTurn（同一 session / model / tool policy）
 *   @gate   → 服务端注册的确定性函数
 *   @command → ExecutionService.proposeCommand（策略 → 审批 → hash/版本复核 → executor）
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

export interface FlowTaskRun {
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

export type FlowCommandRun =
  /** 命令已经有结论（auto_approve 执行完 / 审批通过后执行完） */
  | { status: 'executed'; ok: boolean; error?: string; detail: Record<string, unknown> }
  /**
   * 需要人工审批：审批任务**已经建好**（taskId 有效），但 execution 还没被推到
   * waiting_for_approval —— 那是 runner 的事（见下面的 runCommand 契约）。
   */
  | { status: 'waiting'; taskId: string; detail: Record<string, unknown> }
  /** 策略直接拒绝（含"命令类型未登记"、"流程角色越界"）—— 走 fail 出口 */
  | { status: 'denied'; reason: string; detail: Record<string, unknown> };

export interface FlowNodeRuntime {
  runTask(input: {
    execution: ExecutionRecord;
    state: WorkflowState;
    node: FlowNode;
    ctx: FlowContext;
    prompt: string;
  }): Promise<FlowTaskRun>;
  runGate(input: { ctx: FlowContext; node: FlowNode }): Promise<FlowGateRun>;
  /**
   * 执行一个 `@command` 节点。
   *
   * **契约：它只负责"把审批任务建出来"，绝不改 execution 的状态。**
   * 需要审批时返回 `{ status: 'waiting', taskId }` 就结束，`waiting_for_approval`
   * 由 runner 在把 `workflow.stepStatus = waiting` 落库之后自己迁移。
   *
   * 为什么把这件事从执行器里拿出来：两个写者（执行器 + runner）都改 execution 时，
   * 崩溃窗口里留下的状态是**不可判定**的 —— `execution = waiting_for_approval`
   * 配 `workflow.stepStatus = running`，"这一步在等人工"与"这一步要重放"同时成立。
   * 状态机的所有权必须只有一份。
   */
  runCommand(input: {
    execution: ExecutionRecord;
    node: FlowNode;
    ctx: FlowContext;
  }): Promise<FlowCommandRun>;
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
   * `@task` 节点的服务端**能力上限**（config.workflowAgentTools）。
   *
   * 默认不含 mcp / shell：那两样正是 agent 绕开 `@command` 审批直接对外产生业务副作用的路径。
   * 节点上的 `tools:` 只能在它之内收窄。
   */
  agentTools: readonly FlowPermissionKind[];
}

export class DefaultFlowNodeRuntime implements FlowNodeRuntime {
  constructor(private readonly deps: DefaultRuntimeDeps) {}

  /**
   * `@task`：复用 runExecutionTurn —— Copilot session、model、tool policy、tool 证据、
   * usage 全部走现在的路径。节点**不拥有任何新的工具权限**，也不自己拼 prompt 模板。
   *
   * 它执行的是"**一个受约束的 AI 工作单元**"，不是"起一个 agent"：
   * 跑的是当前 session 的又一次 agent turn，而不是另起一个独立 agent / 独立技能进程。
   * 这正是关键字从 `@agent` 改成 `@task` 的原因 —— **Agent 不是 Workflow 的一级概念，
   * 它只是 `@task` 的执行实现**。换 Copilot SDK / OpenAI Agents SDK / DeepAgents /
   * LangGraph 都只影响这个方法内部，不影响 SKILL.md 里的任何一个字。
   * 真要做 skill → skill 的委派，得先实现 subagent invocation，那是另一件事。
   *
   * 执行期间套上**能力边界**（见 capability.ts）：agent 可以读、可以在 workspace 里写、
   * 可以出站取数，但**碰不到 MCP 与 shell** —— 否则它完全可以不走 `@command`，
   * 直接调一个 MCP server 把结论发出去，整条流程的审批就成了摆设。
   *
   * 跑完之后还要过**完成契约**（`output:`）：`turn 没抛异常` ≠ `业务上做完了`。
   * 契约是服务端注册的确定性函数，不让模型自评。
   */
  async runTask(input: {
    execution: ExecutionRecord;
    state: WorkflowState;
    node: FlowNode;
    ctx: FlowContext;
    prompt: string;
  }): Promise<FlowTaskRun> {
    const { execution, state, node, ctx, prompt } = input;
    const kinds = new Set(resolveAgentTools(this.deps.agentTools, node.attrs.tools));
    const ref = { executionId: execution.executionId, nodeId: node.id };
    setAgentCapability(execution.sessionId, { ...ref, kinds, flow: state.flow });
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
              `@task ${node.id} 未通过完成契约 "${contract.name}"（${contract.description}）：` +
              `${verdict.reason ?? '未给出原因'}`,
          };
        }
      }
      return { ok: true, content, chars };
    } catch (err) {
      // 跑不动是流程里一个**可路由**的出口（`- fail -> research-failed`），不是编排器崩溃
      return { ok: false, content: '', chars: 0, error: errMsg(err) };
    } finally {
      // 只清自己设的那一份（executionId + nodeId 都要对得上）：本 finally 在 turn 槽
      // **外面**跑，槽一释放，同一会话里的下一条 execution 就可能已经设上自己的边界了
      clearAgentCapability(execution.sessionId, ref);
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
   * @command：**不直接调 executor**，而是走 proposeCommand 的完整链路
   * （策略 → 自动放行/审批 → hash + resourceVersion 复核 → executor）。
   * 执行完不收尾（`completeOnSuccess: false`），因为后面还有节点。
   *
   * `@command role:` 只**收窄**该命令类型的审批资格，不会放宽；
   * 交集为空时 CommandService 直接拒绝，流程走 `- fail -> ...`。
   *
   * 需要审批时走 `deferWaitingTransition`：**只建任务，不推 execution 状态**。
   * 原因是 durable 状态必须由 runner 单写 —— 见 `FlowNodeRuntime.runCommand` 的契约说明。
   */
  async runCommand(input: {
    execution: ExecutionRecord;
    node: FlowNode;
    ctx: FlowContext;
  }): Promise<FlowCommandRun> {
    const { execution, node, ctx } = input;
    const command = findFlowCommand(node.id);
    if (!command) {
      return {
        status: 'denied',
        reason: `command "${node.id}" 未注册`,
        detail: { error: `command "${node.id}" 未注册` },
      };
    }
    const intent = await command.buildIntent(ctx);
    const verdict = await this.deps.executions.proposeCommand(execution.executionId, intent, {
      workflow: {
        nodeId: node.id,
        ...(node.attrs.role ? { restrictRoles: [node.attrs.role] } : {}),
        deferWaitingTransition: true,
      },
    });

    if (verdict.decision === 'denied') {
      return {
        status: 'denied',
        reason: verdict.reason ?? '策略拒绝',
        detail: {
          commandType: command.commandType,
          decision: 'denied',
          ...(verdict.reason ? { reason: verdict.reason } : {}),
        },
      };
    }
    if (verdict.decision === 'needs_approval') {
      return {
        status: 'waiting',
        taskId: verdict.taskId!,
        detail: { commandType: command.commandType, taskId: verdict.taskId },
      };
    }
    const r = verdict.result as { ok?: boolean; error?: string } | undefined;
    const ok = r?.ok !== false;
    return {
      status: 'executed',
      ok,
      ...(r?.error ? { error: r.error } : {}),
      detail: {
        commandType: command.commandType,
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

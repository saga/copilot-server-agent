import type { UsageRecord } from './usage.js';
import type { WorkflowState } from '../workflow/types.js';

/**
 * execution = 一次 agent 执行单元（一次 chat turn / 一个 job / 一次 workflow run）。
 *
 *   session ── execution #1 ── LLM ── tool ── human task
 *          └─ execution #2 ── LLM ── tool
 *
 * session 与 execution 是两层：审计、usage、工具证据、审批、取消全部挂 executionId，
 * 不挂 sessionId。execution 状态是 durable 的（PostgreSQL），进程重启不丢。
 */

export type ExecutionStatus =
  | 'created'
  | 'running'
  | 'waiting_for_input'
  | 'waiting_for_approval'
  | 'resuming'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'rejected'
  | 'expired'
  /**
   * 进程在 turn 中途退出（Pod 重启/被 kill）。**终态，且刻意不自动重试**：
   * agent 可能已经执行过业务动作（下单、提交表决），自动重跑会重复提交。
   * 是否重跑由人工/运维决定。
   */
  | 'interrupted';

export const TERMINAL_STATUSES: readonly ExecutionStatus[] = [
  'completed',
  'failed',
  'cancelled',
  'rejected',
  'expired',
  'interrupted',
];

export function isTerminal(status: ExecutionStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** 状态机：非法迁移直接抛错（业务状态必须确定，不允许任意跳变） */
export const ALLOWED_TRANSITIONS: Record<ExecutionStatus, readonly ExecutionStatus[]> = {
  // created → failed：排队项在开跑之前就确定跑不起来（缺来源消息、库出错等）。
  // 它必须在终态落地 —— 留在 created 就等于永远排在队头，调度器会反复取到同一条。
  // 与 cancelled 的区别：cancelled 是有人取消，failed 是自己跑不起来。
  created: ['running', 'cancelled', 'failed'],
  // running → interrupted：进程在 turn 中途退出（启动恢复时落终态，不自动重试）。
  running: [
    'waiting_for_input',
    'waiting_for_approval',
    'completed',
    'failed',
    'cancelled',
    'interrupted',
  ],
  waiting_for_input: ['resuming', 'cancelled', 'expired'],
  waiting_for_approval: ['resuming', 'rejected', 'cancelled', 'expired'],
  // resuming 同理：恢复执行的过程中进程退出 → interrupted
  resuming: ['running', 'failed', 'cancelled', 'interrupted'],
  completed: [],
  failed: [],
  cancelled: [],
  rejected: [],
  expired: [],
  interrupted: [],
};

/** execution 来源：interactive=HTTP chat；job=后台作业；workflow=工作流步骤 */
export type ExecutionKind = 'interactive' | 'job' | 'workflow';

/** execution 因为什么停下来（waiting_* 状态的语义补充） */
export type WaitReason = 'input' | 'approval';

export interface ActionTarget {
  type: string;
  id: string;
}

/**
 * 业务动作意图（审批对象）。
 *
 * 审批必须绑定到“批准了什么”：actionType + target + parameters + 发起人，
 * 再经 hashAction() 得到 actionHash，执行前复核——防止“批准 10,000 股，执行 100,000 股”。
 */
export interface ActionIntent {
  actionType: string;
  target: ActionTarget;
  parameters: Record<string, unknown>;
  reason?: string;
  requestedBy: { userId: string; tenantId: string };
  createdAt: string;
}

export interface ToolCallRecord {
  toolCallId: string;
  toolName: string;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  /** allow=过守卫并进入执行；deny=被 workspace 守卫拦下 */
  decision: 'allow' | 'deny';
  deniedReason?: string;
  /** 脱敏 + 截断后的参数预览 */
  arguments?: string;
  /** 脱敏 + 截断后的结果预览 */
  result?: string;
  error?: string;
  isError: boolean;
}

export interface ExecutionRecord {
  executionId: string;
  sessionId: string;
  tenantId: string;
  userId: string;
  /**
   * 本次 execution 由谁发起。
   * shared 会话里 userId 是会话 owner（数据归属），发起人可能是任一参与人：
   * 审计要回答「这轮是谁让 agent 跑的」，不能把 owner 当成 actor。
   */
  initiatedByUserId?: string;
  /** 触发本次 execution 的会话消息（agent_message.messageId），可回溯到原始输入 */
  sourceMessageId?: string;
  /**
   * 队列定序键：镜像来源消息的 `sequence`。
   * created_at 是毫秒级 ISO 串，两个并发提交的 execution 建行顺序可能与消息落库顺序相反，
   * 而 FIFO 必须与 transcript 顺序一致（用户看到的顺序 = agent 实际处理顺序）。
   * 只有协作 execution（sourceMessageId 非空）有值。
   */
  queueSequence?: number;

  kind: ExecutionKind;
  status: ExecutionStatus;

  /**
   * Skill Flow 的编排状态（仅 kind = 'workflow'）。
   *
   * 必须 durable：`@review` 可能等几个小时，Pod 重启后 execution 仍是 waiting_for_approval，
   * 只有这个字段能回答"停在哪个节点、等的是哪个任务"。没有它就无法安全恢复。
   */
  workflow?: WorkflowState;

  /**
   * `workflow` 的乐观锁版本号（单写者 / CAS）。
   *
   * 为什么单独一个版本号：`updateWorkflowState()` 是"读 → 合并 → 整行 upsert"，
   * 两个推进者（重启后的恢复 + 人工任务回调、或两个 Pod）并发时后写的会把先写的
   * **整段覆盖掉** —— 表现为"某一步被跳过"或"步数回退"，而审计链上什么都看不出来。
   *
   * 版本号让写入变成条件更新：`... where execution_id = ? and workflow_version = ?`，
   * 只有拿到当前版本的那个写者能落地，其余拿到冲突并停止推进。
   * 与 `resource_version` 无关 —— 那个是**动作数据**的版本（审批复核用），不是这行的版本。
   */
  workflowVersion?: number;

  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  updatedAt: string;
  durationMs?: number;

  /** 输入（脱敏预览；完整 prompt 不入审计） */
  input?: unknown;
  promptPreview?: string;
  model?: string;
  streaming: boolean;

  /** 高风险动作：agent 只提 intent，server 决定是否需要审批并负责最终执行 */
  actionIntent?: ActionIntent;
  actionHash?: string;
  /** 意图提出时依据的数据版本；执行前与 resourceVersion 现算值比对 */
  resourceVersion?: string;
  approvedResourceVersion?: string;

  currentHumanTaskId?: string;
  waitReason?: WaitReason;

  result?: unknown;
  contentChars?: number;
  error?: string;

  usage?: UsageRecord;
  toolCalls: ToolCallRecord[];
  toolCallsOmitted?: number;
}

export interface ExecutionEvent {
  eventId: string;
  executionId: string;
  sequence: number;
  type: string;
  actorType: 'system' | 'agent' | 'user' | 'approver';
  actorId?: string;
  payload?: Record<string, unknown>;
  createdAt: string;
}

export interface ExecutionFilter {
  sessionId?: string;
  /** 限定在若干 session 内（shared 会话的可见性判定用：调用方能看哪些 session） */
  sessionIds?: string[];
  tenantId?: string;
  userId?: string;
  status?: ExecutionStatus;
  limit?: number;
}

/** 审计时间线事件类型（对应 README/架构文档中的 event timeline） */
export const EXECUTION_EVENT_TYPES = {
  created: 'execution.created',
  started: 'execution.started',
  agentStarted: 'agent.started',
  toolCallStarted: 'agent.tool_call.started',
  toolCallCompleted: 'agent.tool_call.completed',
  actionProposed: 'agent.proposed_action',
  approvalRequired: 'policy.approval_required',
  actionDenied: 'policy.action_denied',
  humanTaskCreated: 'human_task.created',
  waitingForApproval: 'execution.waiting_for_approval',
  waitingForInput: 'execution.waiting_for_input',
  approvalSubmitted: 'approval.submitted',
  approvalCompleted: 'approval.completed',
  inputSubmitted: 'human_task.input_submitted',
  taskDelegated: 'human_task.delegated',
  taskExpired: 'human_task.expired',
  resuming: 'execution.resuming',
  actionHashVerified: 'action.hash_verified',
  actionHashMismatch: 'action.hash_mismatch',
  resourceVersionMismatch: 'action.resource_version_mismatch',
  authorizationChecked: 'action.authorization.checked',
  actionExecuted: 'action.executed',
  completed: 'execution.completed',
  failed: 'execution.failed',
  cancelled: 'execution.cancelled',
  rejected: 'execution.rejected',
  expired: 'execution.expired',
  /** 进程中途退出（启动恢复时写入），终态且不自动重试 */
  interrupted: 'execution.interrupted',

  // --- Skill Flow（kind = 'workflow'）：节点级时间线 ---
  // 审计链会变成：workflow.step.started → agent.started → agent.tool_call.completed
  //   → workflow.step.completed(outcome) → workflow.waiting → human_task.created
  //   → approval.submitted → workflow.resumed → action.executed → workflow.completed
  workflowStarted: 'workflow.started',
  workflowStepStarted: 'workflow.step.started',
  workflowStepCompleted: 'workflow.step.completed',
  /** 上一次推进在节点中途退出（durable 状态里留着 stepStatus = running） */
  workflowStepInterrupted: 'workflow.step.interrupted',
  /**
   * 人工任务收敛时**没有**推进流程：任务与 durable 状态对不上（stale task / 另一个
   * 推进者已经走过这一步 / execution 已是终态）。只留痕，不动状态 ——
   * 让一条过期任务把流程往前推，比停下来难排查得多。
   */
  workflowResumeRejected: 'workflow.resume.rejected',
  /**
   * 状态写入撞上版本号（另一个推进者已经改过这一段状态）：本次推进停止。
   *
   * 刻意**不是**失败事件 —— 冲突说明有别人正在推进这个 execution（重启恢复 / 另一副本 /
   * 人工任务回调），流程归拿到版本的那个推进者继续。落 failed 等于把别人跑着的流程打死。
   */
  workflowWriteConflict: 'workflow.write.conflict',
  workflowWaiting: 'workflow.waiting',
  /**
   * 人工任务建出来了，但 workflow 状态没写进去（CAS 冲突）：这条任务成了**孤儿**，
   * 不会被任何 durable 状态认领，也不会被流程续跑时接上。
   *
   * 它会自然过期，过期回调也会被绑定校验拦下（`waitingTaskId` 对不上）。
   * 单独一条事件是为了让运维排查"多出来的待办"时能找到原因 ——
   * 它是"先建任务、后落状态"这个顺序的已知代价（见 runner 的类注释）。
   */
  workflowOrphanTask: 'workflow.orphan_task',
  /**
   * 启动 / 重跑时把"等一个已经存在的任务"的状态接回来。
   *
   * 落库顺序是「建任务 → 落 workflow = waiting → 推 execution = waiting_for_approval」，
   * 所以崩溃可能停在第二与第三步之间：durable 状态说"这一步在等任务 T"，
   * 而 execution 还是 running。没有这一步对账，重跑会把那个节点**再执行一遍**，
   * 于是同一个 review 建出第二条人工任务（第一条还挂在别人的"我的任务"里）。
   */
  workflowWaitingReconciled: 'workflow.waiting.reconciled',
  workflowResumed: 'workflow.resumed',
  workflowCompleted: 'workflow.completed',
  workflowFailed: 'workflow.failed',
} as const;

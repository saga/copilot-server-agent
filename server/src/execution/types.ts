import type { UsageRecord } from './usage.js';

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
  | 'expired';

export const TERMINAL_STATUSES: readonly ExecutionStatus[] = [
  'completed',
  'failed',
  'cancelled',
  'rejected',
  'expired',
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
  running: ['waiting_for_input', 'waiting_for_approval', 'completed', 'failed', 'cancelled'],
  waiting_for_input: ['resuming', 'cancelled', 'expired'],
  waiting_for_approval: ['resuming', 'rejected', 'cancelled', 'expired'],
  resuming: ['running', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
  rejected: [],
  expired: [],
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

  kind: ExecutionKind;
  status: ExecutionStatus;

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
} as const;

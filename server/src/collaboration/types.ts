/**
 * Session 协作模型。
 *
 * 两个模式，创建时确定、生命周期内不变：
 *
 *   single  只有 owner 能进；请求直接执行（HTTP → session lock → agent turn）
 *   shared  owner + participants 能进；请求进 session 队列，per-session 串行执行
 *
 * 关键不变式（详见 docs/architecture.md）：
 * - shared 会话只有一个 Copilot runtime session，同一时刻最多跑一个 agent turn
 * - 参与人共享同一个 conversation / workspace / data scope / session 级工具与 MCP 能力
 * - 会话成员资格只给协作访问权，不给业务授权（审批仍由 ApprovalPolicy + 业务角色决定）
 * - 每次 execution 记录发起人；session owner 从不被当作 execution 的 actor
 */

export type CollaborationMode = 'single' | 'shared';

/** 会话角色（owner/member/observer），与业务角色（risk/compliance/...）是两回事 */
export type SessionParticipantRole = 'owner' | 'member' | 'observer';

export type SessionParticipantStatus = 'active' | 'left' | 'removed';

/**
 * 会话权限：固定四个，不做动态 ACL。
 * 会话角色、业务角色、审批策略、工具策略已经是四层，再叠一套 permission DSL 会失控。
 */
export type SessionPermission = 'view' | 'send' | 'manage_members' | 'delete';

const ROLE_PERMISSIONS: Record<SessionParticipantRole, readonly SessionPermission[]> = {
  owner: ['view', 'send', 'manage_members', 'delete'],
  member: ['view', 'send'],
  observer: ['view'],
};

export function roleAllows(role: SessionParticipantRole, permission: SessionPermission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function permissionsOf(role: SessionParticipantRole): SessionPermission[] {
  return [...ROLE_PERMISSIONS[role]];
}

export interface SessionParticipant {
  sessionId: string;
  tenantId: string;
  userId: string;
  role: SessionParticipantRole;
  status: SessionParticipantStatus;
  joinedAt: string;
  leftAt?: string;
}

/** 会话消息（应用层 transcript）。content 是完整正文：这就是聊天记录本身 */
export type MessageActorType = 'user' | 'agent';

export interface AgentMessage {
  messageId: string;
  sessionId: string;
  tenantId: string;
  /** session 级单调递增序号（时间戳在并发下会并列，不能做唯一次序） */
  sequence: number;
  actorType: MessageActorType;
  actorId?: string;
  /** 客户端幂等键：同一 key 重试只产生一条消息、一次 execution */
  clientMessageId?: string;
  content: string;
  executionId?: string;
  createdAt: string;
}

/** 协作事件：这个 session 对所有参与者发生了什么（区别于 execution 的审计证据链） */
export interface SessionEvent {
  eventId: string;
  sessionId: string;
  sequence: number;
  type: string;
  actorType: 'system' | 'user' | 'agent' | 'approver';
  actorId?: string;
  executionId?: string;
  messageId?: string;
  payload?: Record<string, unknown>;
  createdAt: string;
}

/**
 * 落库的会话事件类型。
 * token 级 delta 不在这里：每个 delta 写一行会造成巨大写放大，它只走 SSE。
 */
export const SESSION_EVENT_TYPES = {
  participantJoined: 'participant.joined',
  participantLeft: 'participant.left',
  participantRemoved: 'participant.removed',
  messageCreated: 'message.created',
  executionQueued: 'execution.queued',
  executionStarted: 'execution.started',
  executionCompleted: 'execution.completed',
  executionFailed: 'execution.failed',
  executionCancelled: 'execution.cancelled',
  executionWaiting: 'execution.waiting',
  assistantMessage: 'assistant.message',
  humanTaskCreated: 'human_task.created',
  humanTaskResolved: 'human_task.resolved',
} as const;

/** 只经 SSE 推送、不落库的瞬时事件 */
export const EPHEMERAL_SESSION_EVENT_TYPES = {
  assistantDelta: 'assistant.delta',
} as const;

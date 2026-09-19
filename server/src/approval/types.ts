/**
 * 审批策略与裁决类型。
 *
 * 关键边界：审批资格来自 Identity → Role → Policy，不来自请求体，
 * 也不由 LLM 决定（“我觉得这个需要 Risk 审批”不构成授权）。
 */

export type ApprovalStrategy = 'ANY' | 'ALL' | 'N_OF_M' | 'SEQUENTIAL';

export interface ApprovalPolicy {
  policyId: string;
  /** 命中的业务命令类型（submit_proxy_vote / submit_trade / publish_report …） */
  commandType: string;
  strategy: ApprovalStrategy;
  /** N_OF_M 的 N（其他策略可省略：ALL/SEQUENTIAL 取 eligibleRoles 长度，ANY 取 1） */
  requiredCount?: number;
  /** 有资格审批的角色（顺序对 SEQUENTIAL 有意义） */
  eligibleRoles: string[];
  /** 是否允许发起人自批（Separation of Duties） */
  allowInitiator: boolean;
  /** 审批 TTL（秒；0/缺省=不过期） */
  timeoutSeconds?: number;
}

export type ApprovalDecisionKind = 'approve' | 'reject';

export interface HumanTaskDecision {
  decisionId: string;
  taskId: string;
  approverId: string;
  approverRole: string;
  decision: ApprovalDecisionKind;
  comment?: string;
  createdAt: string;
}

export interface ApprovalEvaluation {
  outcome: 'approved' | 'rejected' | 'pending';
  complete: boolean;
  approvals: number;
  rejections: number;
  /** 达成批准所需票数 */
  required: number;
  /** SEQUENTIAL 当前等待的角色 */
  nextRole?: string;
  reason?: string;
}

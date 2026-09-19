import type { ApprovalStrategy, HumanTaskDecision } from '../approval/types.js';

/**
 * HumanTask：input 与 approval 共用一套抽象（前端只有一个 “My Tasks” 列表）。
 *
 *   type = 'approval' → 审批某个 CommandIntent（服务端按策略裁决）
 *   type = 'input'    → 人工补数据（按 inputSchema 校验，不是自由文本）
 *
 * Human Task 挂在 execution 下，不挂在 session 下：
 *   session → execution → human task → decision
 */

export type HumanTaskType = 'input' | 'approval';

export type HumanTaskStatus = 'open' | 'approved' | 'rejected' | 'expired' | 'cancelled';

export interface InputFieldSchema {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'select';
  required: boolean;
  options?: string[];
}

export interface InputTaskSchema {
  fields: InputFieldSchema[];
}

export interface HumanTask {
  taskId: string;
  executionId: string;
  tenantId: string;
  type: HumanTaskType;
  status: HumanTaskStatus;
  title: string;
  description?: string;
  /** 审批场景承载 CommandIntent；输入场景承载待补数据描述 */
  payload: Record<string, unknown>;
  /** 输入任务的字段定义（schema 化，不接受自由文本） */
  inputSchema?: InputTaskSchema;
  /** 输入任务提交的值 */
  inputValues?: Record<string, unknown>;

  policyId?: string;
  strategy?: ApprovalStrategy;
  requiredCount?: number;
  eligibleRoles: string[];
  eligibleUsers: string[];

  /** 发起人（SoD：默认不可自批） */
  initiatedBy?: string;

  expiresAt?: string;
  createdAt: string;
  completedAt?: string;

  delegatedFrom?: string;
  delegatedTo?: string;
  delegatedBy?: string;
  delegatedAt?: string;
  delegationReason?: string;

  decisions?: HumanTaskDecision[];
}

export interface HumanTaskFilter {
  executionId?: string;
  tenantId?: string;
  status?: HumanTaskStatus;
  type?: HumanTaskType;
  /** 按审批资格过滤（eligibleRoles ∩ 用户角色，或 eligibleUsers 含 userId） */
  assignee?: { userId: string; roles: string[] };
  limit?: number;
}

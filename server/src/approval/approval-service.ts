import type { Principal } from '../services/principal.js';
import {
  evaluateApproval,
  resolvePolicy,
  requiredApprovals,
} from './approval-policy.js';
import type { ApprovalEvaluation, ApprovalPolicy, HumanTaskDecision } from './types.js';

/**
 * ApprovalService：只回答“谁能批准、要几票、什么顺序、是否过期”。
 * 不碰 Copilot session、不碰工具执行、不碰 SSE。
 */
export class ApprovalService {
  constructor(private readonly opts: { allowInitiatorApproval: boolean }) {}

  /** 未登记的动作类型返回 null（调用方按默认拒绝处理，不放 LLM 自由发挥） */
  policyFor(actionType: string): ApprovalPolicy | null {
    return resolvePolicy(actionType);
  }

  required(policy: ApprovalPolicy): number {
    return requiredApprovals(policy);
  }

  evaluate(policy: ApprovalPolicy, decisions: HumanTaskDecision[]): ApprovalEvaluation {
    return evaluateApproval(policy, decisions);
  }

  /**
   * 审批资格判定（Identity → Role → Policy，不看请求体）。
   * - 角色必须命中 policy.eligibleRoles
   * - 默认禁止发起人自批（Separation of Duties）
   * - SEQUENTIAL 必须轮到该角色
   */
  assertEligible(input: {
    policy: ApprovalPolicy;
    principal: Principal;
    initiatedBy?: string;
    decisions: HumanTaskDecision[];
  }): { approverRole: string } {
    const { policy, principal, initiatedBy, decisions } = input;
    const role = policy.eligibleRoles.find((r) => principal.roles.includes(r));
    if (!role) {
      throw new Error(
        `无权审批：需要角色 ${policy.eligibleRoles.join('/')}，当前 ${principal.roles.join('/') || '(无角色)'}`,
      );
    }
    const selfApproval = initiatedBy && initiatedBy === principal.userId;
    if (selfApproval && !policy.allowInitiator && !this.opts.allowInitiatorApproval) {
      throw new Error('Separation of Duties：发起人不能审批自己发起的 action');
    }
    if (policy.strategy === 'SEQUENTIAL') {
      const done = new Set(
        decisions.filter((d) => d.decision === 'approve').map((d) => d.approverRole),
      );
      const next = policy.eligibleRoles.find((r) => !done.has(r));
      if (next && next !== role) {
        throw new Error(`顺序审批未轮到该角色：当前等待 ${next}`);
      }
    }
    return { approverRole: role };
  }
}

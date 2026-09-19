import type { Principal } from '../services/principal.js';
import { authorizationService, type AuthorizationService } from '../identity/authorization-service.js';
import {
  evaluateApproval,
  resolvePolicy,
  requiredApprovals,
} from './approval-policy.js';
import type { ApprovalEvaluation, ApprovalPolicy, HumanTaskDecision } from './types.js';

/**
 * ApprovalService：只回答“谁能批准、要几票、什么顺序、是否过期”。
 * 不碰 Copilot session、不碰工具执行、不碰 SSE。
 *
 * “谁能批准”这一步**不是**直接拿 `Principal.roles` 去比：角色要先经
 * AuthorizationService 解析（`x-user-groups` → RoleRegistry → 业务角色），
 * 否则走 AD group 授权的人会看到任务却点不动、或者干脆看不到任务。
 */
export class ApprovalService {
  private readonly authorization: AuthorizationService;

  constructor(
    private readonly opts: {
      allowInitiatorApproval: boolean;
      /** 缺省用进程内默认实例（含 RoleRegistry 映射），单测可注入受控实现 */
      authorization?: AuthorizationService;
    },
  ) {
    this.authorization = opts.authorization ?? authorizationService;
  }

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

  /** 当前 principal 解析出的业务角色（供路由/审计展示，别拿 Principal.roles 直接当角色用） */
  rolesOf(principal: Pick<Principal, 'roles' | 'groups'>): string[] {
    return this.authorization.resolveRoles(principal);
  }

  /**
   * 审批资格判定（Identity → Role → Policy，不看请求体）。
   * - 业务角色必须命中 policy.eligibleRoles
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
    const resolved = this.authorization.resolveRoles(principal);
    const role = policy.eligibleRoles
      .map((r) => r.trim().toLowerCase())
      .find((r) => resolved.includes(r));
    if (!role) {
      throw new Error(
        `无权审批：需要业务角色 ${policy.eligibleRoles.join(' / ')}，当前 ${resolved.join(' / ') || '(无)'}` +
          `（groups: ${principal.groups?.length ?? 0} 个；若角色应由 AD group 授予，` +
          '请确认 COPILOT_BUSINESS_ROLES 已把该角色映射到正确的 group object ID）',
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
      const next = policy.eligibleRoles.map((r) => r.trim().toLowerCase()).find((r) => !done.has(r));
      if (next && next !== role) {
        throw new Error(`顺序审批未轮到该角色：当前等待 ${next}`);
      }
    }
    return { approverRole: role };
  }
}

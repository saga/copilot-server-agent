import type { ApprovalEvaluation, ApprovalPolicy, HumanTaskDecision } from './types.js';

/**
 * ApprovalPolicy：谁可以批准、要几票、什么顺序、发起人能否自批、多久过期。
 *
 * 只保留四种策略（ANY / ALL / N_OF_M / SEQUENTIAL），不做 BPMN/条件分支/并行网关。
 * 策略由 actionType 命中，不来自请求体，也不来自 LLM 的建议。
 */

export const BUILTIN_POLICIES: ApprovalPolicy[] = [
  {
    policyId: 'proxy-vote-high-risk',
    actionType: 'submit_proxy_vote',
    strategy: 'SEQUENTIAL',
    eligibleRoles: ['portfolio_manager', 'risk', 'operations'],
    allowInitiator: false,
    timeoutSeconds: 86400,
  },
  {
    policyId: 'trade-submit',
    actionType: 'submit_trade',
    strategy: 'N_OF_M',
    requiredCount: 2,
    eligibleRoles: ['portfolio_manager', 'risk', 'compliance'],
    allowInitiator: false,
    timeoutSeconds: 43200,
  },
  {
    policyId: 'external-message',
    actionType: 'send_external_message',
    strategy: 'ANY',
    eligibleRoles: ['compliance', 'operations'],
    allowInitiator: false,
    timeoutSeconds: 86400,
  },
  {
    policyId: 'data-deletion',
    actionType: 'delete_data',
    strategy: 'ALL',
    eligibleRoles: ['compliance', 'operations'],
    allowInitiator: false,
    timeoutSeconds: 86400,
  },
  {
    // Skill Flow 的 `@action publish` 用的动作类型。
    // 即使流程里上一步已经有人工 @review，这里仍要走完整的动作审批 —— 两层授权不能互相替代：
    // @review 批的是"这个流程节点可以过"，这里批的是"这一笔具体 mutation 可以执行"，
    // 后者绑定 actionHash 与 resourceVersion，前者没有。
    policyId: 'research-publish',
    actionType: 'publish_research',
    strategy: 'ANY',
    eligibleRoles: ['investment-reviewer'],
    allowInitiator: false,
    timeoutSeconds: 43200,
  },
];

/**
 * 命中策略。未注册的动作类型返回 null —— 调用方按“默认拒绝”处理
 * （高风险动作不允许靠 LLM 自由发挥，必须先登记策略）。
 */
export function resolvePolicy(actionType: string): ApprovalPolicy | null {
  return BUILTIN_POLICIES.find((p) => p.actionType === actionType) ?? null;
}

export function requiredApprovals(policy: ApprovalPolicy): number {
  switch (policy.strategy) {
    case 'ANY':
      return policy.requiredCount ?? 1;
    case 'N_OF_M':
      return Math.max(1, policy.requiredCount ?? 1);
    case 'ALL':
    case 'SEQUENTIAL':
      return Math.max(1, policy.requiredCount ?? policy.eligibleRoles.length);
    default:
      return policy.eligibleRoles.length;
  }
}

/**
 * 策略裁决（纯函数，便于单测）：给定已有投票与策略，判断任务是否收敛。
 * 任一 reject 直接 rejected（fail-closed）；SEQUENTIAL 按 eligibleRoles 顺序推进。
 */
export function evaluateApproval(
  policy: ApprovalPolicy,
  decisions: HumanTaskDecision[],
): ApprovalEvaluation {
  const approvals = decisions.filter((d) => d.decision === 'approve');
  const rejections = decisions.filter((d) => d.decision === 'reject');
  const required = requiredApprovals(policy);
  const base = { approvals: approvals.length, rejections: rejections.length, required };

  if (rejections.length > 0) {
    return { ...base, outcome: 'rejected', complete: true, reason: '存在否决票' };
  }

  if (policy.strategy === 'SEQUENTIAL') {
    const done = new Set(approvals.map((d) => d.approverRole));
    const nextRole = policy.eligibleRoles.find((r) => !done.has(r));
    if (!nextRole) return { ...base, outcome: 'approved', complete: true };
    return { ...base, outcome: 'pending', complete: false, nextRole };
  }

  if (approvals.length >= required) {
    return { ...base, outcome: 'approved', complete: true };
  }
  return { ...base, outcome: 'pending', complete: false };
}

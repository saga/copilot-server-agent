import type { ActionIntent } from '../execution/types.js';
import type { FlowContext } from './types.js';

/**
 * Skill Flow 的三类服务端扩展点。
 *
 * SKILL.md 只写"这里需要一个 compliance gate / investment-review / publish"，
 * **谁有资格、要不要审批、动作怎么做，全在服务端**：
 *
 *   Skill（声明意图） → Registry（决定实现） → 现有 Action/Approval/HumanTask 体系
 *
 * 与「LLM 不能定义 enterprise security boundary」是同一条原则：Markdown 里出现
 * `ad-group: CN=FIL-Compliance` 就等于把安全边界交给了可编辑的文本文件。
 * SKILL.md 只能写**业务角色**（`role: compliance.reviewer`），角色到 Entra group 的映射
 * 由 `identity/business-roles.ts` 决定 —— 换组、改组名都不需要动流程定义。
 *
 * 刻意用三个 Map 而不是插件框架：现在是轻量 TS dependency wiring，没有第二个消费者。
 */

export interface FlowGate {
  name: string;
  /**
   * 确定性判断。结果只能来自这里 —— agent 的自我评价不算数。
   * outcome 一般是 pass / review / fail，但路由按 SKILL.md 里声明的出口名匹配，
   * 所以 gate 返回什么出口名由实现决定（校验器只查"出口是否有对应 route"由运行时兜底）。
   */
  evaluate(ctx: FlowContext): Promise<{ outcome: string; reason?: string }>;
}

export interface FlowReview {
  name: string;
  title: string;
  description?: string;
  /**
   * 有资格审核的**业务角色**（`compliance.reviewer`）。
   *
   * SKILL.md 的 `@review` 写了 `role:` 时以 SKILL.md 为准；这里是不写属性时的兜底，
   * 也是老流程的兼容路径。两边都没有 → 校验器报 `review-missing-role`
   * （一个没人能批的任务等于流程定义不完整）。
   *
   * 注意这是业务角色，不是 AD Group：角色到 Entra group 的映射在
   * `identity/business-roles.ts`，换组不该改流程。
   */
  eligibleRoles?: string[];
  strategy?: 'ANY' | 'ALL';
  requiredCount?: number;
  timeoutSeconds?: number;
}

export interface FlowAction {
  name: string;
  /** 真正的 actionType：必须已登记 ApprovalPolicy + ActionExecutor，否则被 ActionService 拒绝 */
  actionType: string;
  buildIntent(ctx: FlowContext): Promise<ActionIntent> | ActionIntent;
}

export const flowGates = new Map<string, FlowGate>();
export const flowReviews = new Map<string, FlowReview>();
export const flowActions = new Map<string, FlowAction>();

export function registerFlowGate(gate: FlowGate): void {
  flowGates.set(gate.name, gate);
}
export function registerFlowReview(review: FlowReview): void {
  flowReviews.set(review.name, review);
}
export function registerFlowAction(action: FlowAction): void {
  flowActions.set(action.name, action);
}

const norm = (s: string): string => s.toLowerCase();

export function findFlowGate(name: string): FlowGate | undefined {
  return flowGates.get(norm(name));
}
export function findFlowReview(name: string): FlowReview | undefined {
  return flowReviews.get(norm(name));
}
export function findFlowAction(name: string): FlowAction | undefined {
  return flowActions.get(norm(name));
}

/** 校验器用的只读视图 */
export const flowRegistryLookup = {
  hasGate: (name: string) => flowGates.has(norm(name)),
  hasReview: (name: string) => flowReviews.has(norm(name)),
  hasAction: (name: string) => flowActions.has(norm(name)),
  /** 注册表里该 review 的资格角色（SKILL.md 没写 `role:` 时的兜底来源） */
  reviewRoles: (name: string) => flowReviews.get(norm(name))?.eligibleRoles,
};

// ---------- 内置登记 ----------

/**
 * 内置示例 gate：投研证据完备度。
 *
 * 刻意写成**纯确定性函数**，与 agent 的自我评价完全无关：
 * 真实部署替换为合规策略服务 / DMN / 外部合规引擎，Flow 本身不关心实现方式。
 */
registerFlowGate({
  name: 'compliance',
  async evaluate(ctx) {
    const input = (ctx.input ?? {}) as { evidence?: unknown[]; minEvidence?: number };
    const count = Array.isArray(input.evidence) ? input.evidence.length : 0;
    const min = typeof input.minEvidence === 'number' ? input.minEvidence : 2;
    if (count === 0) {
      return { outcome: 'fail', reason: `没有任何证据材料（要求 ≥${min} 条）` };
    }
    if (count < min) {
      return { outcome: 'review', reason: `证据不足（${count}/${min}），需人工判断是否放行` };
    }
    return { outcome: 'pass', reason: `证据 ${count} 条，满足 ≥${min}` };
  },
});

registerFlowReview({
  name: 'compliance-review',
  title: '合规审核',
  description: '核对研究结论是否存在合规问题、是否需要补充证据',
  eligibleRoles: ['compliance.reviewer'],
  strategy: 'ANY',
  requiredCount: 1,
  timeoutSeconds: 86400,
});

registerFlowReview({
  name: 'investment-review',
  title: '投资审核',
  description: '审核投资结论与风险披露是否充分',
  eligibleRoles: ['investment.reviewer'],
  strategy: 'ANY',
  requiredCount: 1,
  timeoutSeconds: 86400,
});

registerFlowAction({
  name: 'publish',
  actionType: 'publish_research',
  buildIntent(ctx) {
    const input = (ctx.input ?? {}) as { securityId?: string };
    return {
      actionType: 'publish_research',
      target: { type: 'research_report', id: input.securityId ?? ctx.executionId },
      parameters: { flow: ctx.flow, nodeId: ctx.nodeId },
      reason: `skill ${ctx.skill} 的 ${ctx.nodeId} 步骤请求发布研究结论`,
      requestedBy: { userId: ctx.initiatorId, tenantId: ctx.tenantId },
      createdAt: new Date().toISOString(),
    };
  },
});

import type { ActionIntent } from '../execution/types.js';
import type { FlowContext, ReviewBasePolicy } from './types.js';

/**
 * Skill Flow 的四类服务端扩展点。
 *
 * SKILL.md 只写"这里需要一个 compliance gate / investment-review / publish / 完成契约"，
 * **谁有资格、要不要审批、动作怎么做、算不算做完了，全在服务端**：
 *
 *   Skill（声明意图） → Registry（决定实现） → 现有 Action/Approval/HumanTask 体系
 *
 * 与「LLM 不能定义 enterprise security boundary」是同一条原则：Markdown 里出现
 * `ad-group: CN=FIL-Compliance` 就等于把安全边界交给了可编辑的文本文件。
 * SKILL.md 只能写**业务角色**（`role: compliance.reviewer`），角色到 Entra group 的映射
 * 由 `identity/business-roles.ts` 决定 —— 换组、改组名都不需要动流程定义。
 *
 * 另一个方向同样成立：SKILL.md 里写的属性**只能收窄**注册表给出的基策略
 * （`role` ∩ eligibleRoles、`strategy` 只能 ANY→ALL、`required` 只能加不能减、
 * `exclude` 不能把注册表的禁止自批改成允许）。否则一个可编辑的 Markdown
 * 就能把"要 3 个人批"降成"1 个人批"。
 *
 * 刻意用四个 Map 而不是插件框架：现在是轻量 TS dependency wiring，没有第二个消费者。
 */

export interface FlowGate {
  name: string;
  /**
   * 该 gate **可能返回的全部出口名**。
   *
   * 为什么必须静态声明：`@gate` 的出口不在固定词汇表里（可以是 pass / fail / review /
   * again / escalate…），没有这份声明，校验器只能等运行时才发现
   * "gate 返回了 review，但 SKILL.md 里没有 review 的 route" —— 那时流程已经跑了一半。
   *
   * 有了它，两个方向都能在**执行之前**查出来：
   *   声明的出口没有 route → `gate-outcome-unrouted`（这条分支会掉进 fail）
   *   route 的出口没被声明 → `gate-outcome-unknown`（写了永远不会走到的分支）
   */
  outcomes: readonly string[];
  evaluate(ctx: FlowContext): Promise<{ outcome: string; reason?: string }>;
}

/**
 * `@review` 的**基策略**：服务端说"谁能批、要几票、发起人能否自批"。
 *
 * SKILL.md 的 `role:` / `strategy:` / `required:` / `exclude:` 是在它之上做收窄，
 * 不能放宽。全部省略时基策略原样生效。
 */
export interface FlowReview {
  name: string;
  title: string;
  description?: string;
  /**
   * 有资格审核的**业务角色**（`compliance.reviewer`）。
   *
   * 这是权威来源；SKILL.md 的 `role:` 只能从里面挑一个（交集）。
   * 空数组 = 没人有资格 → 校验器报 `review-missing-role`（一个没人能批的任务
   * 等于流程定义不完整，建出来只会卡住）。
   *
   * 注意这是业务角色，不是 AD Group：角色到 Entra group 的映射在
   * `identity/business-roles.ts`，换组不该改流程。
   */
  eligibleRoles: string[];
  strategy?: 'ANY' | 'ALL';
  requiredCount?: number;
  /** 是否允许发起人自批（SoD）。缺省 false；SKILL.md 只能写 `exclude: initiator` 更严 */
  allowInitiator?: boolean;
  timeoutSeconds?: number;
}

/**
 * `@agent` 的完成契约：**由服务端判定"这一步真的做完了吗"**。
 *
 * 没有它，`@agent success` 只等于"这次 turn 没有抛异常"—— 模型输出一段
 * "抱歉我无法完成"同样是 success。让模型自评是没意义的（它总是认为自己完成了）。
 *
 * 所以 `@agent output: <契约>` 之后，runner 会把 turn 的输出交给这里，
 * 只有 `ok: true` 才走 success 出口；否则走 fail（那是**可路由**的出口）。
 */
export interface FlowOutput {
  name: string;
  /** 人话说明这个契约要求什么（进审计与报错信息） */
  description: string;
  validate(ctx: FlowContext & { content: string }): Promise<{ ok: boolean; reason?: string }> | { ok: boolean; reason?: string };
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
export const flowOutputs = new Map<string, FlowOutput>();

export function registerFlowGate(gate: FlowGate): void {
  if (!gate.outcomes.length) {
    throw new Error(`gate "${gate.name}" 没有声明 outcomes：校验器无法判断出口是否都有 route`);
  }
  flowGates.set(gate.name, gate);
}
export function registerFlowReview(review: FlowReview): void {
  flowReviews.set(review.name, review);
}
export function registerFlowAction(action: FlowAction): void {
  flowActions.set(action.name, action);
}
export function registerFlowOutput(output: FlowOutput): void {
  flowOutputs.set(output.name, output);
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
export function findFlowOutput(name: string): FlowOutput | undefined {
  return flowOutputs.get(norm(name));
}

/**
 * `@review` 的**生效基策略**：把可选字段补成确定值。
 *
 * runner 与校验器都从这里取，避免两边各写一份 `?? 'ANY'` / `?? 1` 的默认值后漂移 ——
 * 一旦漂移，"校验通过但运行时不通过"就会变成一个只在生产出现的怪现象。
 * 类型定义在 `types.ts`（校验器只依赖类型，不依赖注册表实现）。
 */
export function reviewBasePolicy(review: FlowReview): ReviewBasePolicy {
  return {
    eligibleRoles: review.eligibleRoles.map(norm),
    strategy: review.strategy ?? 'ANY',
    requiredCount: review.requiredCount ?? 1,
    allowInitiator: review.allowInitiator ?? false,
    ...(review.timeoutSeconds !== undefined ? { timeoutSeconds: review.timeoutSeconds } : {}),
  };
}

/** 校验器用的只读视图（SkillFlowRegistry 的默认实现） */
export const flowRegistryLookup = {
  hasGate: (name: string) => flowGates.has(norm(name)),
  hasReview: (name: string) => flowReviews.has(norm(name)),
  hasAction: (name: string) => flowActions.has(norm(name)),
  hasOutput: (name: string) => flowOutputs.has(norm(name)),
  /** gate 声明的出口（SKILL.md 必须与它一致） */
  gateOutcomes: (name: string): readonly string[] | undefined =>
    flowGates.get(norm(name))?.outcomes.map(norm),
  /** review 的基策略（SKILL.md 的属性只能在此基础上收窄） */
  reviewPolicy: (name: string): ReviewBasePolicy | undefined => {
    const review = flowReviews.get(norm(name));
    return review ? reviewBasePolicy(review) : undefined;
  },
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
  outcomes: ['pass', 'review', 'fail'],
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
  allowInitiator: false,
  timeoutSeconds: 86400,
});

registerFlowReview({
  name: 'investment-review',
  title: '投资审核',
  description: '审核投资结论与风险披露是否充分',
  eligibleRoles: ['investment.reviewer'],
  strategy: 'ANY',
  requiredCount: 1,
  allowInitiator: false,
  timeoutSeconds: 86400,
});

/**
 * 内置示例完成契约：turn 必须产出非空内容。
 *
 * 它拦的是真实发生过的一类"假成功"：模型因为权限、工具失败或 prompt 歧义，
 * 回一句"抱歉，我无法完成该任务"，turn 本身没抛错 —— 于是流程带着一份空结论
 * 一路走到发布审批。真实部署在这里登记领域契约（"必须含风险提示章节"、
 * "必须给出 ≥2 条引用"…），机制完全一样。
 */
registerFlowOutput({
  name: 'non-empty',
  description: 'turn 必须产出非空内容（空输出 / 只有空白 = 没做完）',
  validate({ content }) {
    return content.trim()
      ? { ok: true }
      : { ok: false, reason: '@agent 没有产出任何内容（空输出不算完成）' };
  },
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

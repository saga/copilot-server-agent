import type { CommandIntent } from '../execution/types.js';
import { requiredVotes, type FlowContext, type ReviewBasePolicy } from './types.js';

/**
 * Skill Flow 的四类服务端扩展点。
 *
 * SKILL.md 只写"这里需要一个 compliance gate / investment-review / publish / 完成契约"，
 * **谁有资格、要不要审批、命令怎么做、算不算做完了，全在服务端**：
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
 * 还有一条与"收窄"同样重要、但方向不同的规则：**ALL 必须真的是全员**。
 * ANY 与 ALL 的唯一区别落在票数上，所以 `strategy: ALL + required: 1` 只是
 * 名字叫 ALL 的 ANY（见 `requiredVotes()`）。三处都要拦：注册表（启动时）、
 * 校验器（建 execution 前）、runner（运行时 clamp）。
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
 * `@task` 的完成契约：**由服务端判定"这一步真的做完了吗"**。
 *
 * 没有它，`@task success` 只等于"这次 turn 没有抛异常"—— 模型输出一段
 * "抱歉我无法完成"同样是 success。让模型自评是没意义的（它总是认为自己完成了）。
 *
 * 所以 `@task output: <契约>` 之后，runner 会把 turn 的输出交给这里，
 * 只有 `ok: true` 才走 success 出口；否则走 fail（那是**可路由**的出口）。
 */
export interface FlowOutput {
  name: string;
  /** 人话说明这个契约要求什么（进审计与报错信息） */
  description: string;
  validate(ctx: FlowContext & { content: string }): Promise<{ ok: boolean; reason?: string }> | { ok: boolean; reason?: string };
}

export interface FlowCommand {
  name: string;
  /** 真正的 commandType：必须已登记 ApprovalPolicy + CommandExecutor，否则被 CommandService 拒绝 */
  commandType: string;
  buildIntent(ctx: FlowContext): Promise<CommandIntent> | CommandIntent;
}

export const flowGates = new Map<string, FlowGate>();
export const flowReviews = new Map<string, FlowReview>();
export const flowCommands = new Map<string, FlowCommand>();
export const flowOutputs = new Map<string, FlowOutput>();

const norm = (s: string): string => s.toLowerCase();

/** 登记名统一小写：查找侧一律 `norm`，登记侧不归一化的话大小写不同 = 查不到 */
function requireName(kind: string, name: string): string {
  const id = name.trim();
  if (!id) throw new Error(`${kind} 的 name 不能为空（它同时是 SKILL.md 里引用的 id）`);
  return norm(id);
}

/**
 * 登记一个 `@gate`。
 *
 * `outcomes` 在**启动时**就校验（而不是等跑到那个 gate 才发现）：
 *
 *   非空     —— 没有它，校验器无法回答"gate 返回的出口有没有 route"
 *   归一化   —— route 的出口名由 parser 统一小写，声明里写 `PASS` 会永远匹配不上
 *   不重复   —— 重复声明只会让作者以为自己声明了两个出口
 *
 * 这些在运行期都是"静默失效"型的错误（流程走到那一步才掉进 fail），
 * 所以宁可让进程起不来。
 */
export function registerFlowGate(gate: FlowGate): void {
  if (!gate.outcomes.length) {
    throw new Error(`gate "${gate.name}" 没有声明 outcomes：校验器无法判断出口是否都有 route`);
  }
  const seen = new Set<string>();
  const outcomes: string[] = [];
  for (const raw of gate.outcomes) {
    const outcome = norm(raw.trim());
    if (!outcome) throw new Error(`gate "${gate.name}" 的 outcomes 里有空字符串`);
    if (seen.has(outcome)) {
      throw new Error(`gate "${gate.name}" 的 outcome "${outcome}" 重复声明`);
    }
    seen.add(outcome);
    outcomes.push(outcome);
  }
  flowGates.set(requireName('gate', gate.name), { ...gate, outcomes });
}

/**
 * 登记一个 `@review` 的**基策略**。
 *
 * 这里校验的是基策略本身的自洽性 —— 它是服务端权威值，一旦不自洽，
 * SKILL.md 那边无论怎么写都救不回来：
 *
 *   eligibleRoles 非空  —— 空数组 = 建出来的任务没人有资格批（流程必然卡死）
 *   requiredCount ≥ 1   —— 0 票等于自动通过
 *   ALL ⇒ 票数 ≥ 角色数 —— `ALL + requiredCount: 1` 实际只需要 1 票，
 *                          ALL 的语义被削弱成 ANY（正是本轮要修的缺陷）
 */
export function registerFlowReview(review: FlowReview): void {
  const key = requireName('review', review.name);
  const base = reviewBasePolicy(review);
  if (!base.eligibleRoles.length) {
    throw new Error(
      `review "${review.name}" 的 eligibleRoles 为空：一个没人有资格批的任务建出来只会卡住流程`,
    );
  }
  if (!Number.isInteger(base.requiredCount) || base.requiredCount < 1) {
    throw new Error(
      `review "${review.name}" 的 requiredCount 必须是 ≥1 的整数（当前：${review.requiredCount}）`,
    );
  }
  if (
    requiredVotes({
      strategy: base.strategy,
      requiredCount: base.requiredCount,
      roleCount: base.eligibleRoles.length,
    }) > base.requiredCount
  ) {
    throw new Error(
      `review "${review.name}" 声明了 strategy: ALL 但 requiredCount=${base.requiredCount} < ` +
        `资格角色数 ${base.eligibleRoles.length}：ALL 的语义是全员通过，票数不能低于角色数` +
        '（否则它只是名字叫 ALL 的 ANY）。请把 requiredCount 提到 ≥ 角色数，或改成 ANY',
    );
  }
  flowReviews.set(key, review);
}

export function registerFlowCommand(action: FlowCommand): void {
  flowCommands.set(requireName('action', action.name), action);
}

export function registerFlowOutput(output: FlowOutput): void {
  flowOutputs.set(requireName('output', output.name), output);
}

export function findFlowGate(name: string): FlowGate | undefined {
  return flowGates.get(norm(name));
}
export function findFlowReview(name: string): FlowReview | undefined {
  return flowReviews.get(norm(name));
}
export function findFlowCommand(name: string): FlowCommand | undefined {
  return flowCommands.get(norm(name));
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
 *
 * `requiredCount` 的缺省值**按策略分叉**：ALL 的语义是全员通过，缺省就该是角色数；
 * 缺省成 1 会让 `{ strategy: 'ALL', eligibleRoles: [a, b] }` 变成"任一通过"，
 * 而写它的人明明选了 ALL。这里**不 clamp**（不取 max）—— clamp 会把
 * "ALL 配了 1 票"这种自相矛盾悄悄抹平，而 `registerFlowReview()` 正需要看见它。
 */
export function reviewBasePolicy(review: FlowReview): ReviewBasePolicy {
  const eligibleRoles = review.eligibleRoles.map(norm);
  const strategy = review.strategy ?? 'ANY';
  const declared = review.requiredCount ?? (strategy === 'ALL' ? eligibleRoles.length : 1);
  return {
    eligibleRoles,
    strategy,
    requiredCount: declared,
    allowInitiator: review.allowInitiator ?? false,
    ...(review.timeoutSeconds !== undefined ? { timeoutSeconds: review.timeoutSeconds } : {}),
  };
}

/** 校验器用的只读视图（SkillFlowRegistry 的默认实现） */
export const flowRegistryLookup = {
  hasGate: (name: string) => flowGates.has(norm(name)),
  hasReview: (name: string) => flowReviews.has(norm(name)),
  hasCommand: (name: string) => flowCommands.has(norm(name)),
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
      : { ok: false, reason: '@task 没有产出任何内容（空输出不算完成）' };
  },
});

registerFlowCommand({
  name: 'publish',
  commandType: 'publish_research',
  buildIntent(ctx) {
    const input = (ctx.input ?? {}) as { securityId?: string };
    return {
      commandType: 'publish_research',
      target: { type: 'research_report', id: input.securityId ?? ctx.executionId },
      parameters: { flow: ctx.flow, nodeId: ctx.nodeId },
      reason: `skill ${ctx.skill} 的 ${ctx.nodeId} 步骤请求发布研究结论`,
      requestedBy: { userId: ctx.initiatorId, tenantId: ctx.tenantId },
      createdAt: new Date().toISOString(),
    };
  },
});

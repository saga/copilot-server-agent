import type { ApprovalService } from '../approval/approval-service.js';
import type { ApprovalPolicy } from '../approval/types.js';
import { hashCommand, verifyCommandHash } from '../execution/hash.js';
import type { CommandIntent } from '../execution/types.js';
import { getExecutor, type CommandExecutionContext, type CommandExecutionResult } from './command-registry.js';

/**
 * Business Command Policy（独立于 Tool Policy 的一层）。
 *
 *   Tool Policy      = 这个工具能不能碰这个路径/命令/URL
 *   Command Policy   = 这个业务命令要不要人批准、谁能批准、批准后能不能执行
 *
 * 裁决顺序：
 *   agent propose → resolvePolicy(commandType)
 *     ├ 未登记策略        → deny（默认拒绝，不允许 LLM 自己发明高风险命令）
 *     ├ 流程声明了角色     → eligibleRoles 与流程角色取交集；空交集 → deny；否则 → needs_approval
 *     ├ 有 executor 且策略登记为自动 → auto_approve，server 直接执行
 *     └ 否则               → needs_approval，建 HumanTask，execution 进入 WAITING_FOR_APPROVAL
 */

export type CommandClassification =
  | { decision: 'auto_approve'; policy: ApprovalPolicy }
  | { decision: 'needs_approval'; policy: ApprovalPolicy }
  | { decision: 'denied'; reason: string };

export class CommandService {
  constructor(private readonly deps: { approval: ApprovalService }) {}

  /**
   * 策略裁决（纯 server 侧，不看 LLM 的建议）。
   *
   * `restrictRoles` 来自 Skill Flow 的 `@command role:`。它**只能收窄**，不能放宽：
   * 流程里写明的业务角色必须已经在该命令类型的 ApprovalPolicy 里，交集为空就直接拒绝。
   * 否则 SKILL.md 就成了一个能扩大授权面的文件 —— 而它是会被 LLM 读到、也会被人随手改的。
   */
  classify(intent: CommandIntent, opts: { restrictRoles?: string[] } = {}): CommandClassification {
    const base = this.deps.approval.policyFor(intent.commandType);
    if (!base) {
      return {
        decision: 'denied',
        reason: `命令类型 "${intent.commandType}" 未登记审批策略（默认拒绝；高风险命令必须先登记）`,
      };
    }

    const restrict = (opts.restrictRoles ?? []).map((r) => r.trim().toLowerCase()).filter(Boolean);
    if (!restrict.length) {
      const auto = (process.env.COPILOT_AUTO_APPROVE_ACTIONS ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (auto.includes(intent.commandType)) return { decision: 'auto_approve', policy: base };
      return { decision: 'needs_approval', policy: base };
    }

    const narrowed = base.eligibleRoles.filter((r) => restrict.includes(r.trim().toLowerCase()));
    if (!narrowed.length) {
      return {
        decision: 'denied',
        reason:
          `流程要求业务角色 ${restrict.join(' / ')}，但命令 "${intent.commandType}" 的策略只允许 ` +
          `${base.eligibleRoles.join(' / ')} —— 流程可以收窄授权，不能放宽`,
      };
    }
    const policy: ApprovalPolicy = {
      ...base,
      policyId: `${base.policyId}+flow`,
      eligibleRoles: narrowed,
    };
    // 声明了角色的命令**不走 auto_approve**：那等于用一个环境变量绕过流程里写明的审批要求
    return { decision: 'needs_approval', policy };
  }

  hashFor(intent: CommandIntent): string {
    return hashCommand(intent);
  }

  /**
   * 执行（只在审批通过/自动放行后调用）。
   * 执行前复核两件事，任一不符即拒绝：
   *   commandHash      —— 批准的命令内容没被改
   *   resourceVersion —— 批准时所依据的数据版本还是当前版本
   */
  async execute(
    intent: CommandIntent,
    ctx: CommandExecutionContext & {
      approvedHash?: string;
      approvedResourceVersion?: string;
      currentResourceVersion?: string;
    },
  ): Promise<CommandExecutionResult & { verified: { hash: boolean; resourceVersion: boolean } }> {
    const verified = {
      hash: ctx.approvedHash ? verifyCommandHash(intent, ctx.approvedHash) : false,
      resourceVersion:
        ctx.approvedResourceVersion === undefined ||
        ctx.currentResourceVersion === undefined ||
        ctx.approvedResourceVersion === ctx.currentResourceVersion,
    };
    if (!verified.hash) {
      return {
        ok: false,
        commandType: intent.commandType,
        error: 'commandHash 不匹配：命令内容已被修改，必须重新审批',
        verified,
      };
    }
    if (!verified.resourceVersion) {
      return {
        ok: false,
        commandType: intent.commandType,
        error: `resourceVersion 已变更（批准 ${ctx.approvedResourceVersion} / 当前 ${ctx.currentResourceVersion}），必须重新审批`,
        verified,
      };
    }
    const executor = getExecutor(intent.commandType);
    if (!executor) {
      return {
        ok: false,
        commandType: intent.commandType,
        error: `命令类型 "${intent.commandType}" 没有服务端执行器（server-controlled command 必须登记 executor）`,
        verified,
      };
    }
    const result = await executor.execute(intent, ctx);
    return { ...result, verified };
  }
}

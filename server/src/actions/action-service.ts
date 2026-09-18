import type { ApprovalService } from '../approval/approval-service.js';
import type { ApprovalPolicy } from '../approval/types.js';
import { hashAction, verifyActionHash } from '../execution/hash.js';
import type { ActionIntent } from '../execution/types.js';
import { getExecutor, type ActionExecutionContext, type ActionExecutionResult } from './action-registry.js';

/**
 * Business Action Policy（独立于 Tool Policy 的一层）。
 *
 *   Tool Policy      = 这个工具能不能碰这个路径/命令/URL
 *   Action Policy    = 这个业务动作要不要人批准、谁能批准、批准后能不能执行
 *
 * 裁决顺序：
 *   agent propose → resolvePolicy(actionType)
 *     ├ 未登记策略        → deny（默认拒绝，不允许 LLM 自己发明高风险动作）
 *     ├ 有 executor 且策略登记为自动 → auto_approve，server 直接执行
 *     └ 否则               → needs_approval，建 HumanTask，execution 进入 WAITING_FOR_APPROVAL
 */

export type ActionClassification =
  | { decision: 'auto_approve'; policy: ApprovalPolicy }
  | { decision: 'needs_approval'; policy: ApprovalPolicy }
  | { decision: 'denied'; reason: string };

export class ActionService {
  constructor(private readonly deps: { approval: ApprovalService }) {}

  /** 策略裁决（纯 server 侧，不看 LLM 的建议） */
  classify(intent: ActionIntent): ActionClassification {
    const policy = this.deps.approval.policyFor(intent.actionType);
    if (!policy) {
      return {
        decision: 'denied',
        reason: `动作类型 "${intent.actionType}" 未登记审批策略（默认拒绝；高风险动作必须先登记）`,
      };
    }
    const auto = (process.env.COPILOT_AUTO_APPROVE_ACTIONS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (auto.includes(intent.actionType)) return { decision: 'auto_approve', policy };
    return { decision: 'needs_approval', policy };
  }

  hashFor(intent: ActionIntent): string {
    return hashAction(intent);
  }

  /**
   * 执行（只在审批通过/自动放行后调用）。
   * 执行前复核两件事，任一不符即拒绝：
   *   actionHash      —— 批准的动作内容没被改
   *   resourceVersion —— 批准时所依据的数据版本还是当前版本
   */
  async execute(
    intent: ActionIntent,
    ctx: ActionExecutionContext & {
      approvedHash?: string;
      approvedResourceVersion?: string;
      currentResourceVersion?: string;
    },
  ): Promise<ActionExecutionResult & { verified: { hash: boolean; resourceVersion: boolean } }> {
    const verified = {
      hash: ctx.approvedHash ? verifyActionHash(intent, ctx.approvedHash) : false,
      resourceVersion:
        ctx.approvedResourceVersion === undefined ||
        ctx.currentResourceVersion === undefined ||
        ctx.approvedResourceVersion === ctx.currentResourceVersion,
    };
    if (!verified.hash) {
      return {
        ok: false,
        actionType: intent.actionType,
        error: 'actionHash 不匹配：动作内容已被修改，必须重新审批',
        verified,
      };
    }
    if (!verified.resourceVersion) {
      return {
        ok: false,
        actionType: intent.actionType,
        error: `resourceVersion 已变更（批准 ${ctx.approvedResourceVersion} / 当前 ${ctx.currentResourceVersion}），必须重新审批`,
        verified,
      };
    }
    const executor = getExecutor(intent.actionType);
    if (!executor) {
      return {
        ok: false,
        actionType: intent.actionType,
        error: `动作类型 "${intent.actionType}" 没有服务端执行器（server-controlled action 必须登记 executor）`,
        verified,
      };
    }
    const result = await executor.execute(intent, ctx);
    return { ...result, verified };
  }
}

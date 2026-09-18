import type { ActionIntent } from '../execution/types.js';

/**
 * Server-controlled action 注册表。
 *
 * 高风险 mutation（提交表决/下单/对外发消息/删数据）绝不作为普通模型工具暴露。
 * agent 只能 propose（提 intent），真正执行在这里，由服务端在审批通过 + hash 复核
 * + 资源版本复核之后调用。mutation boundary 在 server，不在 model。
 *
 * 接真实系统时：在这里加 executor（走内部 API / 券商网关 / 合规系统），
 * 不要把凭证或写权限塞进 agent 的工具集。
 */

export interface ActionExecutionContext {
  executionId: string;
  sessionId?: string;
  /** 触发执行的主题（审批人 or system auto-approve） */
  actor: string;
}

export interface ActionExecutionResult {
  ok: boolean;
  actionType: string;
  output?: unknown;
  error?: string;
}

export interface ActionExecutor {
  actionType: string;
  execute(intent: ActionIntent, ctx: ActionExecutionContext): Promise<ActionExecutionResult>;
}

/** 内置示例：代理投票提交（真实实现替换为券商/托管行接口调用） */
const submitProxyVote: ActionExecutor = {
  actionType: 'submit_proxy_vote',
  async execute(intent, ctx) {
    const resolution = String(intent.parameters.resolution ?? '');
    const shares = Number(intent.parameters.shares ?? 0);
    if (!['FOR', 'AGAINST', 'ABSTAIN'].includes(resolution)) {
      return { ok: false, actionType: intent.actionType, error: `resolution 非法：${resolution}` };
    }
    if (!Number.isFinite(shares) || shares <= 0) {
      return { ok: false, actionType: intent.actionType, error: `shares 非法：${shares}` };
    }
    return {
      ok: true,
      actionType: intent.actionType,
      output: {
        receipt: `vote_${ctx.executionId}`,
        securityId: intent.target.id,
        resolution,
        shares,
        submittedAt: new Date().toISOString(),
      },
    };
  },
};

/** 内置示例：对外发消息（只写审计回执，真实实现替换为邮件/IM 网关） */
const sendExternalMessage: ActionExecutor = {
  actionType: 'send_external_message',
  async execute(intent, ctx) {
    const to = String(intent.parameters.to ?? '');
    const body = String(intent.parameters.body ?? '');
    if (!to || !body) {
      return { ok: false, actionType: intent.actionType, error: 'to/body 不能为空' };
    }
    return {
      ok: true,
      actionType: intent.actionType,
      output: { to, chars: body.length, sentAt: new Date().toISOString() },
    };
  },
};

export const ACTION_EXECUTORS: Record<string, ActionExecutor> = {
  [submitProxyVote.actionType]: submitProxyVote,
  [sendExternalMessage.actionType]: sendExternalMessage,
};

export function getExecutor(actionType: string): ActionExecutor | undefined {
  return ACTION_EXECUTORS[actionType];
}

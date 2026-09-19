import type { CommandIntent } from '../execution/types.js';

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

export interface CommandExecutionContext {
  executionId: string;
  sessionId?: string;
  /**
   * 外部 mutation 的幂等键：`action:${executionId}:${commandHash}`。
   *
   * 真实 executor 调内部交易/投票/邮件网关时必须把它透传给下游。要挡的是这个序列：
   *
   *   外部副作用已生效 → 进程在落 execution.completed 之前崩 → 重试
   *
   * 重试时 executionId 与 commandHash 都不变，下游据此识别为同一次业务命令。
   * 刻意不用 taskId：重新审批会生成新的 HumanTask，但那仍是同一个业务命令。
   */
  idempotencyKey: string;
  /** 触发执行的主题（审批人 or system auto-approve） */
  actor: string;
}

export interface CommandExecutionResult {
  ok: boolean;
  commandType: string;
  output?: unknown;
  error?: string;
}

export interface CommandExecutor {
  commandType: string;
  /**
   * 执行一次受控的业务状态变更。
   *
   * **契约：必须按 `ctx.idempotencyKey` 保证幂等** —— 同一个 key 不得产生第二次外部副作用，
   * 重试时要返回**第一次**执行的结果，而不是再执行一次。
   *
   * 为什么把这条写在接口上：调用方**会**重试。真实的触发来源是
   *
   *   外部副作用已生效 → 进程在落 execution 终态之前崩 → 恢复后重跑这一步
   *
   * （见 `execution-service.ts` 的 `runCommand`）。幂等键绑的是
   * `execution + 命令内容 hash`，所以那次重跑拿到的是**同一个** key —— 这就是它能去重的前提。
   *
   * 实现必须自己做下游去重，形态是：
   *
   *   idempotencyKey
   *        ↓
   *   下游去重表 / 透传成下游请求头
   *        ├ 已执行 → 返回历史结果
   *        └ 未执行 → 执行并记录
   *
   * ⚠️ `command-registry.ts` 里内置的几个示例 executor **只把 key 回显进 output**，
   * 没有真实下游、也就不需要去重。它们是 **demo**，不能直接当生产 executor 用 ——
   * 接真实系统时，去重是接入方必须实现的第一件事，不是可选项。
   */
  execute(intent: CommandIntent, ctx: CommandExecutionContext): Promise<CommandExecutionResult>;
}

/**
 * ⚠️ 以下三个都是 **demo executor**：只校验入参、把 `ctx.idempotencyKey` 回显进 output，
 * **不做下游去重**（没有真实下游）。接真实系统时按 `CommandExecutor.execute` 的契约实现：
 * 同一个 idempotencyKey 不得产生第二次外部副作用，重试返回第一次的结果。
 */
/** 内置示例：代理投票提交（真实实现替换为券商/托管行接口调用） */
const submitProxyVote: CommandExecutor = {
  commandType: 'submit_proxy_vote',
  async execute(intent, ctx) {
    const resolution = String(intent.parameters.resolution ?? '');
    const shares = Number(intent.parameters.shares ?? 0);
    if (!['FOR', 'AGAINST', 'ABSTAIN'].includes(resolution)) {
      return { ok: false, commandType: intent.commandType, error: `resolution 非法：${resolution}` };
    }
    if (!Number.isFinite(shares) || shares <= 0) {
      return { ok: false, commandType: intent.commandType, error: `shares 非法：${shares}` };
    }
    return {
      ok: true,
      commandType: intent.commandType,
      output: {
        receipt: `vote_${ctx.executionId}`,
        securityId: intent.target.id,
        resolution,
        shares,
        // 真实实现把 ctx.idempotencyKey 作为下游请求头/字段传给券商网关。
        // 这里回显出来，让"幂等键确实被透传到了 executor"在审计里可见。
        idempotencyKey: ctx.idempotencyKey,
        submittedAt: new Date().toISOString(),
      },
    };
  },
};

/** 内置示例：对外发消息（只写审计回执，真实实现替换为邮件/IM 网关） */
const sendExternalMessage: CommandExecutor = {
  commandType: 'send_external_message',
  async execute(intent, ctx) {
    const to = String(intent.parameters.to ?? '');
    const body = String(intent.parameters.body ?? '');
    if (!to || !body) {
      return { ok: false, commandType: intent.commandType, error: 'to/body 不能为空' };
    }
    return {
      ok: true,
      commandType: intent.commandType,
      // 真实实现把 ctx.idempotencyKey 传给邮件/IM 网关，避免重试把同一封信发两遍。
      output: {
        to,
        chars: body.length,
        idempotencyKey: ctx.idempotencyKey,
        sentAt: new Date().toISOString(),
      },
    };
  },
};

/** 内置示例：发布研究结论（Skill Flow 的 `@command publish`；真实实现替换为研报系统接口） */
const publishResearch: CommandExecutor = {
  commandType: 'publish_research',
  async execute(intent, ctx) {
    const reportId = String(intent.target.id ?? '');
    if (!reportId) {
      return { ok: false, commandType: intent.commandType, error: 'target.id（reportId）不能为空' };
    }
    return {
      ok: true,
      commandType: intent.commandType,
      output: {
        receipt: `publish_${ctx.executionId}`,
        reportId,
        idempotencyKey: ctx.idempotencyKey,
        publishedAt: new Date().toISOString(),
      },
    };
  },
};

export const COMMAND_EXECUTORS: Record<string, CommandExecutor> = {
  [submitProxyVote.commandType]: submitProxyVote,
  [sendExternalMessage.commandType]: sendExternalMessage,
  [publishResearch.commandType]: publishResearch,
};

export function getExecutor(commandType: string): CommandExecutor | undefined {
  return COMMAND_EXECUTORS[commandType];
}

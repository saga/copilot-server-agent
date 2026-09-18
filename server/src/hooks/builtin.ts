import type { SessionHooks } from '@github/copilot-sdk';
import { recordHookEvent } from './events.js';

/** SDK 只导出 handler 类型：Awaited 后即各 hook 的 Output | void */
type StartOut = Awaited<ReturnType<NonNullable<SessionHooks['onSessionStart']>>>;
type EndOut = Awaited<ReturnType<NonNullable<SessionHooks['onSessionEnd']>>>;
type ErrorOut = Awaited<ReturnType<NonNullable<SessionHooks['onErrorOccurred']>>>;

export interface HookPreset {
  name: string;
  displayName: string;
  description: string;
  /** 默认是否挂载（请求里 hooks 缺省时生效；显式传 [] 可全关） */
  enabledByDefault: boolean;
  build: (params: { sessionContext?: string; agentStopChecklist?: string }) => SessionHooks;
}

/** 合并多个 start 输出：additionalContext 拼接（文档建议保持 onSessionStart 快速，只做纯拼接） */
function mergeStart(outputs: StartOut[]): Exclude<StartOut, void> | undefined {
  const parts = outputs.flatMap((o) =>
    o && typeof o.additionalContext === 'string' && o.additionalContext ? [o.additionalContext] : [],
  );
  if (parts.length === 0) return undefined;
  return { additionalContext: parts.join('\n\n') };
}

function mergeEnd(outputs: EndOut[]): Exclude<EndOut, void> | undefined {
  const actions = outputs.flatMap((o) => (o && Array.isArray(o.cleanupActions) ? o.cleanupActions : []));
  const summaries = outputs.flatMap((o) =>
    o && typeof o.sessionSummary === 'string' && o.sessionSummary ? [o.sessionSummary] : [],
  );
  const suppress = outputs.some((o) => o?.suppressOutput === true);
  if (!actions.length && !summaries.length && !suppress) return undefined;
  return {
    ...(suppress ? { suppressOutput: true } : {}),
    ...(actions.length ? { cleanupActions: [...new Set(actions)] } : {}),
    ...(summaries.length ? { sessionSummary: summaries.join('\n') } : {}),
  };
}

/** audit：只记录不干预（start/end 打结构化日志 + 进事件环） */
const audit: HookPreset = {
  name: 'audit',
  displayName: 'Audit（审计日志）',
  description: '记录会话起止（来源/原因/耗时）到服务端日志与事件环，不改变行为',
  enabledByDefault: true,
  build: () => {
    const startedAt = new Map<string, number>();
    return {
      onSessionStart: async (input, invocation) => {
        startedAt.set(invocation.sessionId, input.timestamp.getTime());
        const line = `session started source=${input.source} cwd=${input.workingDirectory}`;
        console.log(`[hooks:audit] ${invocation.sessionId} ${line}`);
        recordHookEvent(invocation.sessionId, 'session-start', line);
        return undefined;
      },
      onSessionEnd: async (input, invocation) => {
        const start = startedAt.get(invocation.sessionId);
        const duration = start !== undefined ? `${input.timestamp.getTime() - start}ms` : 'unknown';
        startedAt.delete(invocation.sessionId);
        const line = `session ended reason=${input.reason} duration=${duration}${input.error ? ` error=${input.error}` : ''}`;
        console.log(`[hooks:audit] ${invocation.sessionId} ${line}`);
        recordHookEvent(invocation.sessionId, 'session-end', line);
        return undefined;
      },
      // 只记不干预：错误一定进日志/事件环，处置决策留给 error-policy
      onErrorOccurred: async (input, invocation) => {
        const line = `error context=${input.errorContext} recoverable=${input.recoverable} msg=${input.error.slice(0, 200)}`;
        console.error(`[hooks:audit] ${invocation.sessionId} ${line}`);
        recordHookEvent(invocation.sessionId, 'error', line);
        return undefined;
      },
    };
  },
};

/** session-context：启动时注入附加上下文（项目/偏好），resume 与新建都生效 */
const sessionContext: HookPreset = {
  name: 'session-context',
  displayName: 'SessionContext（启动上下文）',
  description: 'onSessionStart 注入 additionalContext（请求传 sessionContext 文本）',
  enabledByDefault: false,
  build: ({ sessionContext }) => ({
    onSessionStart: async (_input, invocation) => {
      if (!sessionContext?.trim()) return undefined;
      recordHookEvent(invocation.sessionId, 'session-start', 'injected additionalContext');
      return { additionalContext: sessionContext.trim() };
    },
  }),
};

/** error-policy：按 errorContext 给友好通知，可恢复的 tool 错误降噪（默认不启用） */
const errorPolicy: HookPreset = {
  name: 'error-policy',
  displayName: 'ErrorPolicy（错误策略）',
  description: 'onErrorOccurred：日志全记；model_call/system 给友好通知；可恢复 tool 错误 suppress 输出',
  enabledByDefault: false,
  build: () => ({
    onErrorOccurred: async (input, invocation): Promise<ErrorOut> => {
      const line = `error context=${input.errorContext} recoverable=${input.recoverable} msg=${input.error.slice(0, 200)}`;
      console.error(`[hooks:error] ${invocation.sessionId} ${line}`);
      recordHookEvent(invocation.sessionId, 'error', line);
      if (input.errorContext === 'tool_execution' && input.recoverable) {
        return { suppressOutput: true };
      }
      if (input.errorContext === 'model_call') {
        return { userNotification: '模型调用出错，请稍后重试；详情见服务端日志。' };
      }
      if (input.errorContext === 'system') {
        return { userNotification: '系统错误，请稍后重试；如持续出现请联系管理员。' };
      }
      return undefined;
    },
  }),
};

/**
 * stop-guard：agent 自然停机时用调用方给的检查项 block 一次继续干活。
 * 用 stopHookActive 防重复 block（runtime 也有连续 block 上限兜底）。
 */
const stopGuard: HookPreset = {
  name: 'stop-guard',
  displayName: 'StopGuard（停机检查）',
  description: 'onAgentStop：请求传 agentStopChecklist 时 block 一次让 agent 按检查项继续',
  enabledByDefault: false,
  build: ({ agentStopChecklist }) => ({
    onAgentStop: async (input, invocation) => {
      const checklist = agentStopChecklist?.trim();
      if (!checklist || input.stopHookActive) return undefined;
      recordHookEvent(
        invocation.sessionId,
        'agent-stop',
        `blocked once stopReason=${input.stopReason ?? 'unknown'}`,
      );
      return { decision: 'block', reason: checklist };
    },
  }),
};

export const HOOK_PRESETS: HookPreset[] = [audit, sessionContext, errorPolicy, stopGuard];

/**
 * 把启用的预设拼成一份 SessionHooks（同类输出按上面的 merge 策略合并）。
 * extraHooks 用于注入会话级强制 hook（如 workspace 守卫的 onPreToolUse）：
 * 先跑强制 hook，有决策就直接生效，否则交给预设。
 */
export function composeHooks(
  presets: HookPreset[],
  params: { sessionContext?: string; agentStopChecklist?: string },
  extraHooks: SessionHooks = {},
): SessionHooks {
  const built = presets.map((p) => p.build(params));
  return {
    onSessionStart: async (input, invocation) =>
      mergeStart(
        await Promise.all(built.map((h) => h.onSessionStart?.(input, invocation))),
      ) ?? undefined,
    onSessionEnd: async (input, invocation) =>
      mergeEnd(await Promise.all(built.map((h) => h.onSessionEnd?.(input, invocation)))) ??
      undefined,
    onErrorOccurred: async (input, invocation) => {
      for (const h of built) {
        const out = await h.onErrorOccurred?.(input, invocation);
        if (out) return out; // 第一个非空决策生效（audit 只记不返回，不会截胡）
      }
      return undefined;
    },
    onAgentStop: async (input, invocation) => {
      for (const h of built) {
        const out = await h.onAgentStop?.(input, invocation);
        if (out) return out;
      }
      return undefined;
    },
    ...(extraHooks.onPreToolUse || built.some((h) => h.onPreToolUse)
      ? {
          onPreToolUse: async (input, invocation) => {
            const forced = await extraHooks.onPreToolUse?.(input, invocation);
            if (forced) return forced;
            for (const h of built) {
              const out = await h.onPreToolUse?.(input, invocation);
              if (out) return out;
            }
            return undefined;
          },
        }
      : {}),
    // 工具证据（pre/post/post-failure）由 tool-evidence 注入，直接透传
    ...(extraHooks.onPostToolUse ? { onPostToolUse: extraHooks.onPostToolUse } : {}),
    ...(extraHooks.onPostToolUseFailure
      ? { onPostToolUseFailure: extraHooks.onPostToolUseFailure }
      : {}),
  };
}

import type { SessionHooks } from '@github/copilot-sdk';
import { recordHookEvent } from '../hooks/events.js';
import { executionService } from '../execution/index.js';
import { createPreToolUseGuard, type ToolPolicyContext } from './tool-policy.js';

/**
 * Tool evidence：把一次工具调用落成可审计的闭环证据。
 *
 *   onPreToolUse          → toolCallId + 开始时间 + 脱敏参数 + 守卫裁决
 *   onPostToolUse         → 结束时间 + 耗时 + 脱敏结果
 *   onPostToolUseFailure  → 结束时间 + 耗时 + 错误
 *
 * 证据挂在 executionId 下（按 session 的当前 execution 关联），经 ExecutionService
 * 落 ExecutionRepository（PostgreSQL），形成
 *   request → execution → 策略裁决 → 工具执行 → 结果 的审计链。
 */

type ToolHook = Pick<SessionHooks, 'onPreToolUse' | 'onPostToolUse' | 'onPostToolUseFailure'>;

function log(
  sessionId: string,
  call: { toolCallId: string; toolName: string; durationMs?: number } | undefined,
  outcome: string,
): void {
  if (!call) return;
  recordHookEvent(
    sessionId,
    'tool-call',
    `${call.toolCallId} ${call.toolName} ${outcome}${call.durationMs !== undefined ? ` ${call.durationMs}ms` : ''}`,
  );
}

export function createToolEvidenceHooks(ctx: ToolPolicyContext): ToolHook {
  const guard = createPreToolUseGuard(ctx);
  return {
    onPreToolUse: async (input, invocation) => {
      const decision = await guard(input, invocation);
      if (decision?.permissionDecision === 'deny') {
        const reason = decision.permissionDecisionReason ?? 'workspace guard';
        executionService.denyToolCall({
          sessionId: ctx.sessionId,
          toolName: input.toolName,
          args: input.toolArgs,
          reason,
        });
        recordHookEvent(ctx.sessionId, 'tool-call', `deny ${input.toolName} reason=${reason}`);
        return decision;
      }
      executionService.beginToolCall({
        sessionId: ctx.sessionId,
        toolName: input.toolName,
        args: input.toolArgs,
      });
      // 放行：最终裁决交给 onPermissionRequest（read/write/shell/mcp/url 分级）
      return decision;
    },
    onPostToolUse: async (input) => {
      const call = await executionService.endToolCall({
        sessionId: ctx.sessionId,
        toolName: input.toolName,
        result: input.toolResult,
      });
      log(ctx.sessionId, call, 'ok');
      return undefined;
    },
    onPostToolUseFailure: async (input) => {
      const call = await executionService.endToolCall({
        sessionId: ctx.sessionId,
        toolName: input.toolName,
        error: input.error,
        isError: true,
      });
      log(ctx.sessionId, call, 'failed');
      return undefined;
    },
  };
}

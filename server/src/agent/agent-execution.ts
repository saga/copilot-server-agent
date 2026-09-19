import type { CopilotSession } from '@github/copilot-sdk';
import { runTurn } from './agent-runner.js';
import { sessionService } from '../services/session-service.js';
import { withTurnSlot } from '../services/turn-runner.js';

/**
 * ExecutionRunner 的真实现：把一个 execution 跑成一次 Copilot turn。
 *
 * 只做三件事：取回（或 resume）这个 session 的 CopilotSession、在 turn 槽里跑一轮、
 * 把结果交回调用方。它不知道会话是 single 还是 shared —— 模式只影响「谁触发、要不要排队」。
 *
 * 参数用结构化类型：这样 agent 层不必依赖协作层，注入时按结构匹配即可。
 */

export interface ExecutionTurnInput {
  execution: {
    executionId: string;
    sessionId: string;
    tenantId: string;
    userId: string;
    /** 本次执行要用的模型（`POST /sessions/:id/chat { model }` 落到 execution 上） */
    model?: string;
  };
  prompt: string;
  onDelta?: (delta: string) => void;
  onAssistantMessage?: (content: string) => void;
}

/** 取回 CopilotSession 的方式；单测注入 fake，不必拉起真 runtime */
export type ResumeForTurn = (
  sessionId: string,
  owner: { tenantId: string; userId: string },
) => Promise<CopilotSession>;

export async function runExecutionTurn(
  input: ExecutionTurnInput,
  deps: { resumeSession?: ResumeForTurn } = {},
): Promise<{ content: string; chars: number }> {
  const { execution, prompt } = input;
  // execution 上记的是**会话 owner**（数据归属），不是发起人：
  // resume 会对 registry 做归属校验，shared 会话的发起人只是 participant，过不了这一关。
  const resume =
    deps.resumeSession ?? ((id: string, owner) => sessionService.resumeExecutionSession(id, owner));
  const session = await resume(execution.sessionId, {
    tenantId: execution.tenantId,
    userId: execution.userId,
  });
  const result = await withTurnSlot(
    { sessionId: execution.sessionId, executionId: execution.executionId },
    () =>
      runTurn({
        session,
        executionId: execution.executionId,
        prompt,
        // execution 上带了 model 就必须在本轮生效：`runTurn` 会 `session.setModel()`。
        // 丢掉它就等于 shared 会话里 `{ model }` 只在库里存了个值、对实际调用没有影响。
        ...(execution.model ? { model: execution.model } : {}),
        ...(input.onDelta || input.onAssistantMessage
          ? {
              handlers: {
                ...(input.onDelta ? { onDelta: input.onDelta } : {}),
                ...(input.onAssistantMessage ? { onMessage: input.onAssistantMessage } : {}),
              },
            }
          : {}),
      }),
  );
  return { content: result.content, chars: result.chars };
}

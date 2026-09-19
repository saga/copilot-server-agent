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
  };
  prompt: string;
  onDelta?: (delta: string) => void;
  onAssistantMessage?: (content: string) => void;
}

export async function runExecutionTurn(
  input: ExecutionTurnInput,
): Promise<{ content: string; chars: number }> {
  const { execution, prompt } = input;
  // execution 上记的是**会话 owner**（数据归属），不是发起人：
  // resume 会对 registry 做归属校验，shared 会话的发起人只是 participant，过不了这一关。
  const session = await sessionService.resumeExecutionSession(execution.sessionId, {
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

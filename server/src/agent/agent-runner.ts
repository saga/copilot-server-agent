import type { CopilotSession } from '@github/copilot-sdk';
import { executionService, type LlmUsageSample } from '../execution/index.js';
import { EXECUTION_EVENT_TYPES } from '../execution/types.js';
import type { AgentTurnHandlers, AgentTurnResult } from './agent-events.js';

/**
 * AgentRunner：Copilot SDK 事件 plumbing 的唯一收口。
 *
 * route/service 不再出现 session.on(...) / sendAndWait / setModel —— 将来换
 * backend（Copilot / Claude Agent SDK / OpenAI Agents）只改这里，
 * 路由、workflow、HITL 都不用动。
 */

export interface RunTurnInput {
  session: CopilotSession;
  executionId: string;
  prompt: string;
  model?: string;
  handlers?: AgentTurnHandlers;
  /** 客户端断开等外部中止信号（置为 true 后 runner 结束时标记 aborted） */
  shouldAbort?: () => boolean;
}

/** usage 事件流入 execution 的累加器（execution-local，并发 turn 不串数据） */
function attachUsageListener(session: CopilotSession, executionId: string): () => void {
  const offUsage = session.on('assistant.usage', (evt) => {
    const data = (evt as unknown as { data?: LlmUsageSample }).data;
    if (data) void executionService.addUsage(executionId, data);
  });
  const offInfo = session.on('session.usage_info', (evt) => {
    const data = (evt as unknown as { data?: { tokenLimit?: number } }).data;
    void executionService.setContextWindow(executionId, data?.tokenLimit);
  });
  return () => {
    offUsage();
    offInfo();
  };
}

export async function runTurn(input: RunTurnInput): Promise<AgentTurnResult> {
  const { session, executionId, prompt, model, handlers } = input;
  let chars = 0;

  await executionService.appendEvent({
    executionId,
    type: EXECUTION_EVENT_TYPES.agentStarted,
    actorType: 'agent',
  });

  const offDelta = session.on('assistant.message_delta', (evt) => {
    const delta = (evt as unknown as { data?: { deltaContent?: string } }).data?.deltaContent;
    if (delta) {
      chars += delta.length;
      handlers?.onDelta?.(delta);
    }
  });
  const offMsg = session.on('assistant.message', (evt) => {
    const content = (evt as unknown as { data?: { content?: string } }).data?.content;
    if (content) handlers?.onMessage?.(content);
  });
  const offSub = session.on((evt) => {
    const t = (evt as unknown as { type?: string }).type;
    if (typeof t === 'string' && t.startsWith('subagent.')) handlers?.onSubagent?.(evt);
  });
  const offUsage = attachUsageListener(session, executionId);

  try {
    if (model) await session.setModel(model);
    const finalEvent = await session.sendAndWait({ prompt });
    const content =
      (finalEvent as unknown as { data?: { content?: string } } | undefined)?.data?.content ?? '';
    return { content, chars, outcome: 'completed' };
  } finally {
    offDelta();
    offMsg();
    offSub();
    offUsage();
  }
}

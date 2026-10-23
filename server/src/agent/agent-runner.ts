import type { CopilotSession } from '@github/copilot-sdk';
import { config } from '../config.js';
import { executionSink } from '../execution/sink.js';
import type { LlmUsageSample } from '../execution/usage.js';
import { EXECUTION_EVENT_TYPES } from '../execution/types.js';
import type { AgentTurnHandlers, AgentTurnResult } from './agent-events.js';

/**
 * AgentRunner：Copilot SDK 事件 plumbing 的唯一收口。
 *
 * route/service 不再出现 session.on(...) / sendAndWait / setModel —— 将来换
 * backend（Copilot / Claude Agent SDK / OpenAI Agents）只改这里，
 * 路由、workflow、HITL 都不用动。
 *
 * 写证据走 `execution/sink.ts` 而不是 wiring —— 本模块被 wiring 间接 import，直接取 wiring 会成环。
 */

export interface RunTurnInput {
  session: CopilotSession;
  executionId: string;
  prompt: string;
  model?: string;
  handlers?: AgentTurnHandlers;
  /** Optional per-turn override; defaults to COPILOT_TURN_TIMEOUT_MS (300 seconds). 0 disables it. */
  timeoutMs?: number;
}

const ABORT_IDLE_GRACE_MS = 10_000;

function isTurnTimeout(error: unknown): boolean {
  return error instanceof Error
    && /Timeout after \\d+ms waiting for session\\.idle/i.test(error.message);
}

function watchSessionIdle(
  session: CopilotSession,
  timeoutMs: number,
): { promise: Promise<boolean>; cancel: () => void } {
  let settled = false;
  let off = () => {};
  let timer: NodeJS.Timeout | undefined;
  let finish: (value: boolean) => void = () => {};

  const promise = new Promise<boolean>((resolve) => {
    finish = (value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      off();
      resolve(value);
    };
    off = session.on('session.idle', () => finish(true));
    timer = setTimeout(() => finish(false), timeoutMs);
  });

  return { promise, cancel: () => finish(false) };
}

/** A sendAndWait timeout only stops waiting; explicitly abort and observe idle before failing the turn. */
async function abortTimedOutTurn(session: CopilotSession): Promise<void> {
  const idle = watchSessionIdle(session, ABORT_IDLE_GRACE_MS);
  let abortTimer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      session.abort(),
      new Promise<never>((_, reject) => {
        abortTimer = setTimeout(
          () => reject(new Error('Copilot session.abort() timed out')),
          ABORT_IDLE_GRACE_MS,
        );
      }),
    ]);
  } catch (error) {
    idle.cancel();
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Copilot turn timed out and abort failed: ${reason}`);
  } finally {
    if (abortTimer) clearTimeout(abortTimer);
  }

  if (!(await idle.promise)) {
    throw new Error(`Copilot turn timed out; session.idle was not observed within ${ABORT_IDLE_GRACE_MS}ms after abort.`);
  }
}

/** usage 事件流入 execution 的累加器（execution-local，并发 turn 不串数据） */
function attachUsageListener(session: CopilotSession, executionId: string): () => void {
  const offUsage = session.on('assistant.usage', (evt) => {
    const data = (evt as unknown as { data?: LlmUsageSample }).data;
    if (data) void executionSink().addUsage(executionId, data);
  });
  const offInfo = session.on('session.usage_info', (evt) => {
    const data = (evt as unknown as { data?: { tokenLimit?: number } }).data;
    void executionSink().setContextWindow(executionId, data?.tokenLimit);
  });
  return () => {
    offUsage();
    offInfo();
  };
}

export async function runTurn(input: RunTurnInput): Promise<AgentTurnResult> {
  const { session, executionId, prompt, model, handlers } = input;
  let chars = 0;

  await executionSink().appendEvent({
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

    const timeoutMs = input.timeoutMs ?? config.copilotTurnTimeoutMs;
    const send = session.sendAndWait({ prompt }, timeoutMs > 0 ? timeoutMs + 1_000 : undefined);
    let watchdog: NodeJS.Timeout | undefined;
    let finalEvent: Awaited<typeof send>;
    try {
      finalEvent = timeoutMs > 0
        ? await Promise.race([
            send,
            new Promise<never>((_, reject) => {
              watchdog = setTimeout(
                () => reject(new Error(`Timeout after ${timeoutMs}ms waiting for session.idle`)),
                timeoutMs,
              );
            }),
          ])
        : await send;
    } catch (error) {
      if (timeoutMs > 0 && isTurnTimeout(error)) {
        // Don't mark the execution failed while the Copilot session keeps working in the background.
        await abortTimedOutTurn(session);
      }
      throw error;
    } finally {
      if (watchdog) clearTimeout(watchdog);
    }

    const content =
      (finalEvent as unknown as { data?: { content?: string } } | undefined)?.data?.content ?? '';
    chars = content.length;
    return { content, chars, outcome: 'completed' };
  } finally {
    offDelta();
    offMsg();
    offSub();
    offUsage();
  }
}

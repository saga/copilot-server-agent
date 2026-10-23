import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CopilotSession } from '@github/copilot-sdk';

import { runExecutionTurn } from '../src/agent/agent-execution.js';
import { runTurn } from '../src/agent/agent-runner.js';
import { bindExecutionSink, type ExecutionSink } from '../src/execution/sink.js';

/**
 * `POST /sessions/:id/chat { model }` 在 shared 模式下会落到 `execution.model` 上。
 *
 * 只把它存进库、不往 turn 里传，等于这个参数没有任何作用 —— 真正换模型的是
 * `runTurn` 里的 `session.setModel()`。这里用注入的假 session 验证这条链路。
 */

test('execution.model 会作用到本轮 turn（setModel 被调用）', async () => {
  // runTurn 会往「当前 execution」写 agent.started 等证据，需要先装配写入通道
  bindExecutionSink({
    appendEvent: async () => {},
    addUsage: async () => {},
    setContextWindow: async () => {},
    setActive: () => {},
    clearActive: () => {},
    activeFor: () => undefined,
    beginToolCall: async () => {},
    endToolCall: async () => {},
    denyToolCall: async () => {},
  } as unknown as ExecutionSink);

  const setModelCalls: string[] = [];
  const session = {
    on: () => () => {},
    setModel: async (model: string) => {
      setModelCalls.push(model);
    },
    sendAndWait: async () => ({ data: { content: 'ok' } }),
  };

  const result = await runExecutionTurn(
    {
      execution: {
        executionId: 'ex-model',
        sessionId: 'sess-model',
        tenantId: 't1',
        userId: 'alice',
        model: 'gpt-5-mini',
      },
      prompt: 'hi',
    },
    { resumeSession: async () => session as unknown as CopilotSession },
  );

  assert.equal(result.content, 'ok');
  assert.deepEqual(setModelCalls, ['gpt-5-mini'], 'execution 上的 model 必须传给 runTurn');
});


test('AgentRunner aborts a turn when the application watchdog expires', async () => {
  bindExecutionSink({
    appendEvent: async () => {},
    addUsage: async () => {},
    setContextWindow: async () => {},
    setActive: () => {},
    clearActive: () => {},
    activeFor: () => undefined,
    beginToolCall: async () => {},
    endToolCall: async () => {},
    denyToolCall: async () => {},
  } as unknown as ExecutionSink);

  const listeners = new Map<string, Set<(event: unknown) => void>>();
  let abortCalls = 0;
  let sdkTimeoutMs: number | undefined;
  const session = {
    on: (eventOrHandler: string | ((event: unknown) => void), handler?: (event: unknown) => void) => {
      const eventName = typeof eventOrHandler === 'string' ? eventOrHandler : '*';
      const callback = typeof eventOrHandler === 'string' ? handler : eventOrHandler;
      if (!callback) throw new Error('listener missing');
      const eventListeners = listeners.get(eventName) ?? new Set<(event: unknown) => void>();
      eventListeners.add(callback);
      listeners.set(eventName, eventListeners);
      return () => eventListeners.delete(callback);
    },
    setModel: async () => {},
    sendAndWait: async (_body: unknown, timeoutMs?: number) => {
      sdkTimeoutMs = timeoutMs;
      return new Promise<never>(() => {});
    },
    abort: async () => {
      abortCalls += 1;
      for (const listener of listeners.get('session.idle') ?? []) {
        listener({ type: 'session.idle', data: { reason: 'success' } });
      }
    },
  } as unknown as CopilotSession;

  await assert.rejects(
    runTurn({
      session,
      executionId: 'ex-timeout',
      prompt: 'will never finish',
      timeoutMs: 5,
    }),
    /Timeout after 5ms waiting for session\.idle/,
  );
  assert.equal(sdkTimeoutMs, 1_005, 'SDK timeout is slightly later than the application watchdog');
  assert.equal(abortCalls, 1, 'timeout must explicitly stop the running Agent');
});

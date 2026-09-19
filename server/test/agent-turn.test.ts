import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CopilotSession } from '@github/copilot-sdk';

import { runExecutionTurn } from '../src/agent/agent-execution.js';
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

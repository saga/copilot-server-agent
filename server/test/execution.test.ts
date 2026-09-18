import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { preview, redactSecrets, truncate } from '../src/execution/redact.js';
import { LlmUsageAccumulator } from '../src/execution/usage.js';
import { ExecutionStore } from '../src/execution/store.js';
import { createToolEvidenceHooks } from '../src/services/tool-evidence.js';

const OWNER = { tenantId: 't1', userId: 'u1' };

test('redact：密钥字段整值替换、值形态兜底', () => {
  const out = redactSecrets({
    apiKey: 'sk-abcdef123456',
    authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig',
    nested: { password: 'hunter2', keep: 'plain' },
    note: 'call with token sk-abcdef123456 here',
  }) as Record<string, any>;
  assert.equal(out.apiKey, '<redacted>');
  assert.equal(out.authorization, '<redacted>');
  assert.equal(out.nested.password, '<redacted>');
  assert.equal(out.nested.keep, 'plain');
  assert.match(out.note, /<redacted>/);
});

test('redact：循环引用与深度收敛，不抛异常', () => {
  const cyclic: Record<string, unknown> = { name: 'x' };
  cyclic.self = cyclic;
  assert.equal((redactSecrets(cyclic) as any).self, '<circular>');
});

test('preview + truncate：截断只报长度', () => {
  assert.equal(truncate('abcdef', 3), 'abc…[+3 chars]');
  const long = 'x'.repeat(500);
  const out = preview({ blob: long }, 50);
  assert.ok(out.length < 120, `预览应被截断，实际 ${out.length}`);
  assert.match(out, /\+\d+ chars/);
});

test('usage 累加器：多次调用求和，模型去重，上下文窗口单独记', () => {
  const acc = new LlmUsageAccumulator();
  acc.add({ inputTokens: 100, outputTokens: 20, cacheReadTokens: 5, duration: 300, model: 'gpt-5' });
  acc.add({ inputTokens: 50, outputTokens: 10, reasoningTokens: 7, duration: 200, model: 'gpt-5' });
  acc.add({ inputTokens: 1, model: 'gpt-5-mini' });
  acc.setContextWindow(128_000);
  const u = acc.snapshot();
  assert.equal(u.inputTokens, 151);
  assert.equal(u.outputTokens, 30);
  assert.equal(u.cacheReadTokens, 5);
  assert.equal(u.reasoningTokens, 7);
  assert.equal(u.durationMs, 500);
  assert.equal(u.llmCalls, 3);
  assert.deepEqual(u.models, ['gpt-5', 'gpt-5-mini']);
  assert.equal(u.contextWindow, 128_000);
});

test('execution store：tool call 证据闭环（pre → post）', async () => {
  const store = new ExecutionStore();
  const exec = store.start({ sessionId: 's1', owner: OWNER, prompt: 'hello', streaming: false });
  store.setActive('s1', exec.executionId);

  const call = store.beginToolCall({ sessionId: 's1', toolName: 'edit', args: { path: 'a.ts' } });
  assert.equal(call.toolCallId, `${exec.executionId}-t1`);
  assert.equal(call.decision, 'allow');

  const done = store.endToolCall({ sessionId: 's1', toolName: 'edit', result: { ok: true } });
  assert.ok(done);
  assert.ok(done.durationMs !== undefined && done.durationMs >= 0);
  assert.equal(done.isError, false);

  const record = store.get(exec.executionId)!;
  assert.equal(record.toolCalls.length, 1);
  assert.equal(record.toolCalls[0]!.toolName, 'edit');
  assert.equal(record.toolCalls[0]!.decision, 'allow');

  store.finish(exec.executionId, { status: 'completed', contentChars: 42 });
  assert.equal(store.get(exec.executionId)!.status, 'completed');
  assert.equal(store.get(exec.executionId)!.contentChars, 42);
  assert.ok(store.get(exec.executionId)!.durationMs !== undefined);
});

test('execution store：失败/取消终态与 usage 落到 execution', () => {
  const store = new ExecutionStore();
  const a = store.start({ sessionId: 's1', owner: OWNER, streaming: true });
  const b = store.start({ sessionId: 's2', owner: OWNER, streaming: true });
  store.addUsage(a.executionId, { inputTokens: 10, outputTokens: 2, duration: 5, model: 'gpt-5' });
  store.addUsage(b.executionId, { inputTokens: 1, duration: 1 });
  // usage 是 execution-local：两个 execution 互不影响
  assert.equal(store.get(a.executionId)!.usage!.inputTokens, 10);
  assert.equal(store.get(b.executionId)!.usage!.inputTokens, 1);

  store.finish(a.executionId, { status: 'failed', error: 'boom' });
  assert.equal(store.get(a.executionId)!.status, 'failed');
  store.finish(a.executionId, { status: 'cancelled' });
  assert.equal(store.get(a.executionId)!.status, 'failed', '终态只写一次');

  assert.equal(store.list({ sessionId: 's2' }).length, 1);
  assert.equal(store.list({ owner: { tenantId: 'other', userId: 'u' } }).length, 0);
  assert.equal(store.stats().running, 1);
});

test('tool evidence hook：workspace 外写入被 deny 并留证据', async () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'evidence-'));
  // hook 内部写的是单例 store：这里验证 pre/post 与 execution 的端到端关联
  const { executionStore } = await import('../src/execution/index.js');
  const exec = executionStore.start({ sessionId: 'ev-1', owner: OWNER, streaming: false });
  executionStore.setActive('ev-1', exec.executionId);
  const hooks = createToolEvidenceHooks({
    sessionId: 'ev-1',
    workspacePath: workspace,
    mcpServers: [],
  });

  const input = (toolName: string, toolArgs: unknown) => ({
    sessionId: 'ev-1',
    timestamp: new Date(),
    workingDirectory: workspace,
    toolName,
    toolArgs,
  });

  const denied = await hooks.onPreToolUse!(input('edit', { path: '/etc/passwd' }), {
    sessionId: 'ev-1',
  });
  assert.equal(denied?.permissionDecision, 'deny');
  const deniedCall = executionStore.get(exec.executionId)!.toolCalls.at(-1)!;
  assert.equal(deniedCall.decision, 'deny');
  assert.equal(deniedCall.toolName, 'edit');

  await hooks.onPreToolUse!(input('edit', { path: path.join(workspace, 'a.ts') }), {
    sessionId: 'ev-1',
  });
  await hooks.onPostToolUse!(
    { ...input('edit', { path: path.join(workspace, 'a.ts') }), toolResult: { text: 'ok' } } as never,
    { sessionId: 'ev-1' },
  );
  const okCall = executionStore.get(exec.executionId)!.toolCalls.at(-1)!;
  assert.equal(okCall.decision, 'allow');
  assert.equal(okCall.isError, false);

  await hooks.onPostToolUseFailure!(
    { ...input('bash', { command: 'ls' }), error: 'exit 1' } as never,
    { sessionId: 'ev-1' },
  );
  assert.equal(executionStore.get(exec.executionId)!.toolCalls.at(-1)!.isError, true);
  executionStore.clearActive('ev-1');
});

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { preview, redactSecrets, truncate } from '../src/execution/redact.js';
import { LlmUsageAccumulator } from '../src/execution/usage.js';
import { ExecutionService } from '../src/execution/execution-service.js';
import {
  MemoryEventRepository,
  MemoryExecutionRepository,
} from '../src/execution/memory-repository.js';
import { createToolEvidenceHooks } from '../src/services/tool-evidence.js';

const OWNER = { tenantId: 't1', userId: 'u1' };

/** 每个用例一套内存仓储（生产是 PostgreSQL，接口一致） */
function makeService() {
  return new ExecutionService({
    repository: new MemoryExecutionRepository(),
    events: new MemoryEventRepository(),
  });
}

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

test('execution：tool call 证据闭环（pre → post）', async () => {
  const service = makeService();
  const exec = await service.create({ sessionId: 's1', owner: OWNER, prompt: 'hello' });
  await service.start(exec.executionId);
  service.setActive('s1', exec.executionId);

  const call = service.beginToolCall({ sessionId: 's1', toolName: 'edit', args: { path: 'a.ts' } });
  assert.equal(call.toolCallId, `${exec.executionId}-t1`);
  assert.equal(call.decision, 'allow');

  const done = await service.endToolCall({
    sessionId: 's1',
    toolName: 'edit',
    result: { ok: true },
  });
  assert.ok(done);
  assert.ok(done.durationMs !== undefined && done.durationMs >= 0);
  assert.equal(done.isError, false);

  const record = (await service.get(exec.executionId))!;
  assert.equal(record.toolCalls.length, 1);
  assert.equal(record.toolCalls[0]!.toolName, 'edit');

  await service.complete(exec.executionId, { contentChars: 42 });
  const settled = (await service.get(exec.executionId))!;
  assert.equal(settled.status, 'completed');
  assert.equal(settled.contentChars, 42);
  assert.ok(settled.durationMs !== undefined);
});

test('execution：终态只写一次 + usage 是 execution-local', async () => {
  const service = makeService();
  const a = await service.create({ sessionId: 's1', owner: OWNER });
  const b = await service.create({ sessionId: 's2', owner: OWNER });
  await service.start(a.executionId);
  await service.start(b.executionId);
  await service.addUsage(a.executionId, {
    inputTokens: 10,
    outputTokens: 2,
    duration: 5,
    model: 'gpt-5',
  });
  await service.addUsage(b.executionId, { inputTokens: 1, duration: 1 });
  assert.equal((await service.get(a.executionId))!.usage!.inputTokens, 10);
  assert.equal((await service.get(b.executionId))!.usage!.inputTokens, 1);

  await service.fail(a.executionId, new Error('boom'));
  assert.equal((await service.get(a.executionId))!.status, 'failed');
  await service.cancel(a.executionId);
  assert.equal((await service.get(a.executionId))!.status, 'failed', '终态只写一次');

  assert.equal((await service.list({ sessionId: 's2' })).length, 1);
  assert.equal((await service.list({ tenantId: 'other', userId: 'u' })).length, 0);
  assert.equal((await service.stats()).running, 1);
});

test('execution：状态机拒绝非法迁移', async () => {
  const service = makeService();
  const exec = await service.create({ sessionId: 's1', owner: OWNER });
  await service.start(exec.executionId);
  await service.complete(exec.executionId);
  await assert.rejects(() => service.start(exec.executionId), /非法状态迁移/);
});

test('tool evidence hook：workspace 外写入被 deny 并留证据', async () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'evidence-'));
  // hook 走 wiring 里的单例 service（内存仓储）：验证 pre/post 与 execution 的端到端关联
  const { executionService: service } = await import('../src/execution/index.js');
  const exec = await service.create({ sessionId: 'ev-1', owner: OWNER });
  await service.start(exec.executionId);
  service.setActive('ev-1', exec.executionId);
  const hooks = createToolEvidenceHooks({
    sessionId: 'ev-1',
    workspacePath: workspace,
    mcpServers: [],
  });

  const input = (toolName: string, toolArgs: unknown) =>
    ({
      sessionId: 'ev-1',
      timestamp: new Date(),
      workingDirectory: workspace,
      toolName,
      toolArgs,
    }) as never;

  const denied = await hooks.onPreToolUse!(input('edit', { path: '/etc/passwd' }), {
    sessionId: 'ev-1',
  });
  assert.equal(denied?.permissionDecision, 'deny');
  await new Promise((r) => setImmediate(r));
  const deniedCall = (await service.get(exec.executionId))!.toolCalls.at(-1)!;
  assert.equal(deniedCall.decision, 'deny');
  assert.equal(deniedCall.toolName, 'edit');

  await hooks.onPreToolUse!(input('edit', { path: path.join(workspace, 'a.ts') }), {
    sessionId: 'ev-1',
  });
  await hooks.onPostToolUse!(
    { ...(input('edit', { path: path.join(workspace, 'a.ts') }) as object), toolResult: { text: 'ok' } } as never,
    { sessionId: 'ev-1' },
  );
  const okCall = (await service.get(exec.executionId))!.toolCalls.at(-1)!;
  assert.equal(okCall.decision, 'allow');
  assert.equal(okCall.isError, false);

  await hooks.onPostToolUseFailure!(
    { ...(input('bash', { command: 'ls' }) as object), error: 'exit 1' } as never,
    { sessionId: 'ev-1' },
  );
  assert.equal((await service.get(exec.executionId))!.toolCalls.at(-1)!.isError, true);
  service.clearActive('ev-1');
});

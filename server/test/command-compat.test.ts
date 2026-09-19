import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';

/**
 * `@action` → `@command` 改名的**兼容层**回归（真起 express、走真实路由 + 真实 wiring）。
 *
 * 改名的三处风险点都是"改了不会报错、但线上会静默变坏"，所以各锁一条：
 *
 *   1. **路径**：`POST /:id/actions` 是老调用方（含部署在别处的 MCP bridge）在打的路径。
 *      改名后若只留 `/commands`，老调用方会拿到 404 —— 而 404 看起来像"execution 不存在"，
 *      排查方向会完全跑偏。
 *   2. **字段**：请求体里的 `actionType` 同理。schema 若只认 `commandType`，
 *      老调用方拿到的是 400 校验错误。
 *   3. **事件名**：审计表里的历史行是 `action.executed` 这类**旧字符串**，且刻意不迁移
 *      （见 migrations/005）。读取边界必须归一化，否则 UI 按新名字过滤就永远看不到老记录。
 *
 * 三者都是"过渡期契约"，不是永久 API：等老调用方全部升级后可以删掉，删的时候连带删本文件。
 *
 * ⚠️ 环境变量必须在 import config / wiring **之前**设好（ESM 静态 import 先于模块体执行），
 * 所以这里只用 `await import(...)`。
 */
process.env.COPILOT_STATE_BACKEND = 'memory';
process.env.COPILOT_HOME = mkdtempSync(path.join(tmpdir(), 'copilot-cmd-compat-'));
process.env.COPILOT_TRUST_IDENTITY_HEADERS = 'true';
process.env.COPILOT_ADMIN_TOKEN = 'secret';
process.env.COPILOT_WARMUP = 'false';

const { executionRouter } = await import('../src/routes/executions.js');
const { executionService, eventRepository } = await import('../src/wiring.js');
const { sessionRegistry } = await import('../src/services/session-registry.js');

const SID = 's-cmd-compat';
const OWNER = { tenantId: 't1', userId: 'alice' };
const OWNER_HEADERS = { 'x-user-id': 'alice', 'x-tenant-id': 't1' };

await sessionRegistry.create({
  sessionId: SID,
  owner: OWNER,
  workspacePath: '/workspaces/s-cmd-compat',
});

const exec = await executionService.create({
  sessionId: SID,
  owner: OWNER,
  initiatedByUserId: OWNER.userId,
  kind: 'job',
});

/** 造一条**改名之前**落库的审计行：类型字符串是旧的 `action.*` */
await eventRepository.append({
  executionId: exec.executionId,
  type: 'action.executed',
  actorType: 'system',
  payload: { note: '改名之前写的行' },
  createdAt: new Date().toISOString(),
});

const app = express();
app.use(express.json());
app.use('/api/executions', executionRouter);
app.use(
  (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  },
);

const server = await new Promise<Server>((resolve) => {
  const s = app.listen(0, () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

// 两个用例共用同一个 server，所以只在这里关一次（放在用例里的 t.after 会在第一个用例后
// 就把 server 关掉，第二个用例直接 fetch failed）。
after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function propose(
  pathname: string,
  body: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${base}/api/executions/${exec.executionId}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...OWNER_HEADERS },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const TARGET = { type: 'proxy_vote', id: 'vote-1' };
const PARAMETERS = { resolution: 'FOR', shares: 100 };

test('改名兼容：`/commands`+`commandType` 与 `/actions`+`actionType` 行为一致', async () => {
  // 1) 新路径 + 新字段名 → 建审批任务（该策略登记为 needs_approval）
  const fresh = await propose('/commands', {
    commandType: 'submit_proxy_vote',
    target: TARGET,
    parameters: PARAMETERS,
  });
  assert.equal(fresh.status, 202, `新路径应当建审批任务，实际 ${JSON.stringify(fresh.body)}`);
  assert.equal(fresh.body['decision'], 'needs_approval');
  assert.ok(fresh.body['taskId'], '要返回 taskId');

  // 2) 老路径 + 老字段名 → 必须走**同一个** handler，得到同样的裁决。
  //    404（路径没挂上）和 400（schema 不认 actionType）都是这条断言要挡的退化。
  const legacy = await propose('/actions', {
    actionType: 'submit_proxy_vote',
    target: TARGET,
    parameters: PARAMETERS,
  });
  assert.equal(
    legacy.status,
    fresh.status,
    `老路径 + 老字段名必须与新写法等价，实际 ${JSON.stringify(legacy.body)}`,
  );
  assert.equal(legacy.body['decision'], 'needs_approval');
  assert.ok(legacy.body['taskId'], '老写法也要拿到 taskId');

  // 3) 老路径 + 新字段名 / 新路径 + 老字段名：两个兼容层互不依赖
  const mixedPath = await propose('/actions', {
    commandType: 'submit_proxy_vote',
    target: TARGET,
    parameters: PARAMETERS,
  });
  assert.equal(mixedPath.status, 202, '老路径要认新字段名');
  const mixedField = await propose('/commands', {
    actionType: 'submit_proxy_vote',
    target: TARGET,
    parameters: PARAMETERS,
  });
  assert.equal(mixedField.status, 202, '新路径要认老字段名');
});

test('改名兼容：GET /events 把历史行的 `action.*` 归一化成 `command.*`', async () => {
  const res = await fetch(`${base}/api/executions/${exec.executionId}/events`, {
    headers: OWNER_HEADERS,
  });
  assert.equal(res.status, 200);
  const { events } = (await res.json()) as { events: { type: string }[] };
  const types = events.map((e) => e.type);

  assert.ok(
    types.includes('command.executed'),
    `改名前的 action.executed 必须在读取边界归一化，实际：${types.join(', ')}`,
  );
  assert.ok(
    !types.some((tp) => tp.startsWith('action.')),
    `API 不应该漏出任何旧事件名，实际：${types.join(', ')}`,
  );
});

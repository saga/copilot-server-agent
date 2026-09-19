import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';

/**
 * `GET /api/human-tasks/:id` 的读语义（真起 express、走真实路由 + 真实 wiring）。
 *
 * 三类可读：admin / 任务处理人 / 会话参与人；其余 403。
 *
 * 回归背景：此前这条路由只在 `trustIdentityHeaders` 下要求"能访问任务所属会话"，
 * 于是**风险/合规审批人读不到自己负责的任务** —— 他们通常不是业务会话的参与者。
 * 现在先看是不是 task 的 assignee，再退到会话参与人。
 *
 * ⚠️ 环境变量必须在 import config / wiring **之前**设好：config 在模块加载时读 env，
 * 而 ESM 的静态 import 会先于模块体执行。所以这里只用 `await import(...)`。
 */
process.env.COPILOT_STATE_BACKEND = 'memory';
process.env.COPILOT_HOME = mkdtempSync(path.join(tmpdir(), 'copilot-route-home-'));
process.env.COPILOT_TRUST_IDENTITY_HEADERS = 'true';
process.env.COPILOT_ADMIN_TOKEN = 'secret';
process.env.COPILOT_WARMUP = 'false';

const { humanTaskRouter } = await import('../src/routes/human-tasks.js');
const { humanTaskService, executionService, participantRepository } = await import(
  '../src/wiring.js'
);
const { sessionRegistry } = await import('../src/services/session-registry.js');

const SID = 's-route';
const NOW = new Date().toISOString();

// 造一个共享会话 + 一个参与者 + 一个 execution + 一个挂在它下面的审批任务。
// 审批任务指派给角色 risk —— 该角色的人 **不是** 会话参与者（外部审批人）。
await sessionRegistry.create({
  sessionId: SID,
  owner: { tenantId: 't1', userId: 'alice' },
  workspacePath: '/workspaces/s-route',
  collaborationMode: 'shared',
});
await participantRepository.upsert({
  sessionId: SID,
  tenantId: 't1',
  userId: 'bob',
  role: 'member',
  joinedAt: NOW,
});
const exec = await executionService.create({
  sessionId: SID,
  owner: { tenantId: 't1', userId: 'alice' },
  initiatedByUserId: 'alice',
  kind: 'job',
});
const task = await humanTaskService.createApprovalTask({
  executionId: exec.executionId,
  tenantId: 't1',
  title: '提交代理投票',
  payload: { commandType: 'custom_test_command' },
  policy: {
    policyId: 'p-route',
    commandType: 'custom_test_command',
    strategy: 'ANY',
    eligibleRoles: ['risk'],
    allowInitiator: false,
  },
});

const app = express();
app.use(express.json());
app.use('/api/human-tasks', humanTaskRouter);
// 兜底：未识别的错误给 500（与生产 errorHandler 行为一致，避免请求悬挂）
app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  },
);

const server = await new Promise<Server>((resolve) => {
  const s = app.listen(0, () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

async function getTask(headers: Record<string, string>): Promise<{
  status: number;
  body: { task?: { taskId: string }; decisions?: unknown[]; error?: string };
}> {
  const res = await fetch(`${base}/api/human-tasks/${task.taskId}`, { headers });
  return { status: res.status, body: (await res.json()) as never };
}

test('GET /api/human-tasks/:id — admin / 处理人 / 会话参与人可读，其余 403', async (t) => {
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  // 1) 外部审批人：role=risk 命中 eligibleRoles，但**不在**会话里 → 必须能读到
  const approver = await getTask({
    'x-user-id': 'carol',
    'x-tenant-id': 't1',
    'x-user-roles': 'risk',
  });
  assert.equal(approver.status, 200, '外部审批人要能读自己负责的任务');
  assert.equal(approver.body.task?.taskId, task.taskId);
  assert.deepEqual(approver.body.decisions, []);

  // 2) 会话参与人（member，角色不命中）→ 能读到（协作 UI 要看本会话挂起的任务）
  const participant = await getTask({
    'x-user-id': 'bob',
    'x-tenant-id': 't1',
    'x-user-roles': 'approver',
  });
  assert.equal(participant.status, 200);

  // 3) 同 tenant，但既不是参与人也不是 assignee → 403
  const stranger = await getTask({
    'x-user-id': 'dave',
    'x-tenant-id': 't1',
    'x-user-roles': 'approver',
  });
  assert.equal(stranger.status, 403, '同租户外人不能靠猜 taskId 读到审批内容');

  // 4) 跨租户（即使角色命中）→ 403，且不泄漏任务是否存在
  const crossTenant = await getTask({
    'x-user-id': 'mallory',
    'x-tenant-id': 't2',
    'x-user-roles': 'risk',
  });
  assert.equal(crossTenant.status, 403);

  // 5) 管理令牌 → 全量
  const admin = await getTask({ 'x-admin-token': 'secret' });
  assert.equal(admin.status, 200, 'admin 持令牌可读全量');

  // 6) 不存在的 id → 404（admin 视角也 404）
  const missing = await fetch(`${base}/api/human-tasks/task_nope`, {
    headers: { 'x-admin-token': 'secret' },
  });
  assert.equal(missing.status, 404);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Request } from 'express';

import { config } from '../src/config.js';
import { readAccess } from '../src/routes/shared.js';
import { sessionMetaFrom } from '../src/services/session-service.js';
import type { RegistryRecord } from '../src/services/session-registry.js';

/**
 * 读路径的两条规则：
 *   1. execution / human task 的读接口用什么准入（管理令牌 = 看全量，否则按会话收窄）
 *   2. 会话元信息以 registry 为真相源（磁盘索引缺失 ≠ 会话不存在）
 *
 * 回归背景：
 * - execution 查询接口此前挂 `requireAdmin`：配了 COPILOT_ADMIN_TOKEN 的部署里，
 *   共享会话的参与者读不到同会话的 execution 时间线（会话详情却读得到）——
 *   协作读路径被管理闸门截断。管理令牌应当只是"可见范围放大器"，不是独立准入闸门。
 * - `GET /sessions/:id` 此前要求会话必须出现在 runtime 的 `client.listSessions()` 里。
 *   多副本部署下每个 Pod 有自己的 runtime 磁盘索引，刚创建或由别的副本创建的会话
 *   不在本副本的列表里 → 明明在共享 registry 里、归属也匹配，却被回 404。
 */

const req = (headers: Record<string, string> = {}): Request =>
  ({ header: (name: string) => headers[name.toLowerCase()] }) as unknown as Request;

/** 临时改配置，断言后还原（本文件独立进程，仍按最小影响面处理） */
function withConfig<T>(patch: Partial<typeof config>, fn: () => T): T {
  const saved: Record<string, unknown> = {};
  for (const key of Object.keys(patch)) saved[key] = (config as never)[key];
  Object.assign(config, patch);
  try {
    return fn();
  } finally {
    Object.assign(config, saved);
  }
}

test('readAccess：没配管理令牌时按部署形态决定，不设闸或按会话收窄', () => {
  withConfig({ adminToken: undefined, trustIdentityHeaders: false }, () => {
    assert.equal(readAccess(req()), 'all', '单租户本地开发：不设闸（与改动前一致）');
  });
  withConfig({ adminToken: undefined, trustIdentityHeaders: true }, () => {
    assert.equal(readAccess(req()), 'scoped', '可信身份下的参与者：只读自己拥有/参与的会话');
  });
});

test('readAccess：管理令牌是可见范围的放大器，不是独立闸门', () => {
  withConfig({ adminToken: 'secret', trustIdentityHeaders: true }, () => {
    assert.equal(readAccess(req({ 'x-admin-token': 'secret' })), 'all', '持令牌看全量');
    assert.equal(
      readAccess(req()),
      'scoped',
      '无令牌但有可信身份：仍能读自己会话（这正是此前被截断的路径）',
    );
  });
  withConfig({ adminToken: 'secret', trustIdentityHeaders: false }, () => {
    assert.equal(readAccess(req({ 'x-admin-token': 'secret' })), 'all');
    assert.equal(readAccess(req({ 'x-admin-token': 'wrong' })), 'denied', '错令牌不是令牌');
    assert.equal(readAccess(req()), 'denied', '既无令牌又无可信身份：不给全量');
  });
});

test('readAccess：令牌生效需要部署真的配了令牌（空串不等于令牌）', () => {
  withConfig({ adminToken: undefined, trustIdentityHeaders: true }, () => {
    // 部署没配令牌时，客户端自带 x-admin-token 不具备任何意义
    assert.equal(readAccess(req({ 'x-admin-token': '' })), 'scoped');
    assert.equal(readAccess(req({ 'x-admin-token': 'secret' })), 'scoped');
  });
});

const record = (over: Partial<RegistryRecord> = {}): RegistryRecord => ({
  sessionId: 's1',
  tenantId: 't1',
  userId: 'alice',
  collaborationMode: 'shared',
  workspacePath: '/workspaces/s1',
  createdAt: '2026-01-01T00:00:00.000Z',
  lastUsedAt: '2026-01-02T00:00:00.000Z',
  status: 'active',
  ...over,
});

test('会话元信息：磁盘索引缺失时仍按 registry 返回，不回 404', () => {
  const meta = sessionMetaFrom(record(), undefined, false);
  assert.equal(meta.sessionId, 's1');
  assert.equal(meta.startTime.toISOString(), '2026-01-01T00:00:00.000Z', '按 created_at 兜底');
  assert.equal(meta.modifiedTime.toISOString(), '2026-01-02T00:00:00.000Z', '按 last_used_at 兜底');
  assert.equal(meta.isRemote, false);
  assert.equal(meta.summary, undefined);
});

test('会话元信息：磁盘索引存在时用它补充 startTime/summary，attached 照传', () => {
  const meta = sessionMetaFrom(
    record(),
    {
      sessionId: 's1',
      startTime: new Date('2025-12-31T10:00:00.000Z'),
      modifiedTime: new Date('2025-12-31T11:00:00.000Z'),
      summary: '协方差矩阵复核',
      isRemote: true,
    },
    true,
  );
  assert.equal(meta.startTime.toISOString(), '2025-12-31T10:00:00.000Z');
  assert.equal(meta.modifiedTime.toISOString(), '2025-12-31T11:00:00.000Z');
  assert.equal(meta.summary, '协方差矩阵复核');
  assert.equal(meta.isRemote, true);
  assert.equal(meta.attached, true);
});

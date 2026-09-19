import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { test } from 'node:test';

/**
 * 配置 smoke：非法值必须启动即失败（静默回退会让「开了 debug 却没日志」这类问题极难排查）。
 * 用子进程加载 config 模块，模拟真实启动时的 env。
 */
const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadConfig(extra: Record<string, string>): { code: number; stdout: string; stderr: string } {
  const res = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      '--input-type=module',
      '-e',
      "const { config } = await import('./src/config.ts'); console.log(JSON.stringify(config));",
    ],
    { cwd: serverRoot, env: { ...process.env, ...extra }, encoding: 'utf-8' },
  );
  return { code: res.status ?? -1, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

test('默认配置可加载', () => {
  const r = loadConfig({ COPILOT_BASH_POLICY: '', COPILOT_LOG_LEVEL: '' });
  assert.equal(r.code, 0, r.stderr);
  const cfg = JSON.parse(r.stdout.trim().split('\n').at(-1)!);
  assert.equal(cfg.bashPolicy, 'workspace');
  assert.equal(cfg.trustIdentityHeaders, false);
});

test('非法 bash policy 直接抛错', () => {
  const r = loadConfig({ COPILOT_BASH_POLICY: 'yolo' });
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /COPILOT_BASH_POLICY 非法/);
});

test('非法 log level 直接抛错', () => {
  const r = loadConfig({ COPILOT_LOG_LEVEL: 'loud' });
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /COPILOT_LOG_LEVEL 非法/);
});

test('执行审计相关数值配置可覆盖', () => {
  const r = loadConfig({
    COPILOT_EVIDENCE_MAX_CHARS: '100',
    COPILOT_MAX_TRACKED_EXECUTIONS: '10',
    COPILOT_MAX_TOOL_CALLS: '5',
  });
  assert.equal(r.code, 0, r.stderr);
  const cfg = JSON.parse(r.stdout.trim().split('\n').at(-1)!);
  assert.equal(cfg.evidenceMaxChars, 100);
  assert.equal(cfg.maxTrackedExecutions, 10);
  assert.equal(cfg.maxToolCallsPerExecution, 5);
});

test('DATABASE_URL 留空 = 默认走 SQLite', () => {
  const r = loadConfig({ DATABASE_URL: '' });
  assert.equal(r.code, 0, r.stderr);
  const cfg = JSON.parse(r.stdout.trim().split('\n').at(-1)!);
  assert.equal(cfg.databaseUrl, undefined);
  assert.equal(cfg.stateBackend, 'auto');
  assert.match(cfg.sqlitePath, /agent\.db$/);
});

test('DATABASE_URL 合法连接串被保留', () => {
  const dsn = 'postgresql://u:p@db:5432/copilot';
  const r = loadConfig({ DATABASE_URL: dsn });
  assert.equal(r.code, 0, r.stderr);
  const cfg = JSON.parse(r.stdout.trim().split('\n').at(-1)!);
  assert.equal(cfg.databaseUrl, dsn);
});

test('DATABASE_URL 非法（占位值 / 错 scheme）直接抛错', () => {
  for (const bad of ['REPLACE_ME', 'mysql://u:p@db:3306/x', 'db:5432/copilot']) {
    const r = loadConfig({ DATABASE_URL: bad });
    assert.notEqual(r.code, 0, `"${bad}" 应当启动失败`);
    assert.match(r.stderr, /DATABASE_URL 非法/);
  }
});

test('SQLite 路径与扩展可覆盖', () => {
  const r = loadConfig({
    DATABASE_URL: '',
    COPILOT_DB_PATH: '/var/lib/copilot/agent.db',
    COPILOT_SQLITE_EXTENSIONS: '/opt/vec0.dylib, /opt/other.dylib',
  });
  assert.equal(r.code, 0, r.stderr);
  const cfg = JSON.parse(r.stdout.trim().split('\n').at(-1)!);
  assert.equal(cfg.sqlitePath, '/var/lib/copilot/agent.db');
  assert.deepEqual(cfg.sqliteExtensions, ['/opt/vec0.dylib', '/opt/other.dylib']);
});

test('COPILOT_STATE_BACKEND 非法值启动即失败', () => {
  const ok = loadConfig({ COPILOT_STATE_BACKEND: 'memory' });
  assert.equal(ok.code, 0, ok.stderr);
  assert.equal(JSON.parse(ok.stdout.trim().split('\n').at(-1)!).stateBackend, 'memory');

  const bad = loadConfig({ COPILOT_STATE_BACKEND: 'redis' });
  assert.notEqual(bad.code, 0);
  assert.match(bad.stderr, /COPILOT_STATE_BACKEND 非法/);
});

/**
 * 业务角色映射是**启动期**加载的（identity/business-roles.ts）。
 * 配错必须启动失败：静默忽略等于"这个角色永远解析不出来"，
 * 而那时的表现是"审批人看不到任务"，比启动失败难排查得多。
 */
function loadBusinessRoles(extra: Record<string, string>): { code: number; stdout: string; stderr: string } {
  const res = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      '--input-type=module',
      '-e',
      "const m = await import('./src/identity/business-roles.ts'); console.log(JSON.stringify(m.listBusinessRoles()));",
    ],
    { cwd: serverRoot, env: { ...process.env, ...extra }, encoding: 'utf-8' },
  );
  return { code: res.status ?? -1, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

test('COPILOT_BUSINESS_ROLES：非法配置启动即失败', () => {
  const cases: Array<[string, RegExp]> = [
    ['{', /不是合法 JSON/],
    ['{}', /必须是数组/],
    ['[{"name":"x"}]', /缺少 id/],
    ['[{"id":"a","match":"SOME"}]', /只能是 ANY \| ALL/],
    ['[{"id":"a","match":"ALL","groups":[]}]', /match=ALL 但没有/],
  ];
  for (const [raw, pattern] of cases) {
    const r = loadBusinessRoles({ COPILOT_BUSINESS_ROLES: raw });
    assert.notEqual(r.code, 0, `"${raw}" 必须启动失败`);
    assert.match(r.stderr, pattern);
  }
});

test('COPILOT_BUSINESS_ROLES：把业务角色映射到 Entra group object ID（ID 归一化成小写）', () => {
  const r = loadBusinessRoles({
    COPILOT_BUSINESS_ROLES: JSON.stringify([
      {
        id: 'compliance.reviewer',
        name: '合规审核人',
        groups: ['3A7F1C2E-0000-0000-0000-000000000001'],
        match: 'ANY',
      },
    ]),
  });
  assert.equal(r.code, 0, r.stderr);
  const roles = JSON.parse(r.stdout.trim().split('\n').at(-1)!) as Array<{
    id: string;
    groups: string[];
  }>;
  const cr = roles.find((x) => x.id === 'compliance.reviewer')!;
  assert.deepEqual(cr.groups, ['3a7f1c2e-0000-0000-0000-000000000001']);
  assert.ok(roles.some((x) => x.id === 'approver'), '内置角色仍然在（配置是覆盖而不是替换）');
});

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

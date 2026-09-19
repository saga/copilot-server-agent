#!/usr/bin/env node
/**
 * SDK / runtime 版本一致性检查（CI 用）。
 *
 * 为什么必须锁死：本服务依赖 SDK 的若干行为/workaround（如 customAgents.tools 的 #2356），
 * SDK 与 runtime(CLI) 版本漂移会导致协议不兼容且极难排查。
 *
 * 校验四处必须一致：
 *   1. server/package.json 的 @github/copilot-sdk（精确版本，不带 ^）
 *   2. node_modules 实际安装版本
 *   3. Dockerfile.copilot-runtime 的 ARG COPILOT_VERSION
 *   4. k8s/deployment.yaml 的 runtime 镜像 tag
 *
 * 另校验：k8s 的 api 镜像 tag 必须等于 server/package.json 的 version
 * （不用 latest，否则回滚时不知道线上跑的是哪个构建）。
 *
 * 用法：node scripts/check-versions.mjs
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const read = (p) => readFileSync(path.join(root, p), 'utf-8');

function sdkDeclared() {
  const pkg = JSON.parse(read('server/package.json'));
  return { raw: pkg.dependencies['@github/copilot-sdk'], from: 'server/package.json' };
}

function sdkInstalled() {
  let dir = path.dirname(require.resolve('@github/copilot-sdk', { paths: [root] }));
  for (let i = 0; i < 5; i++) {
    try {
      const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf-8'));
      if (pkg.name === '@github/copilot-sdk') return { raw: pkg.version, from: 'node_modules' };
    } catch {
      /* 继续向上 */
    }
    dir = path.dirname(dir);
  }
  return { raw: null, from: 'node_modules' };
}

function runtimeDockerfile() {
  const m = read('Dockerfile.copilot-runtime').match(/ARG COPILOT_VERSION=([\w.+-]+)/);
  return { raw: m?.[1] ?? null, from: 'Dockerfile.copilot-runtime' };
}

function runtimeImageTag() {
  const m = read('k8s/deployment.yaml').match(/copilot-runtime:([\w.+-]+)/);
  return { raw: m?.[1] ?? null, from: 'k8s/deployment.yaml' };
}

function serverImageTag() {
  const m = read('k8s/deployment.yaml').match(/copilot-server-agent:([\w.+-]+)/);
  return { raw: m?.[1] ?? null, from: 'k8s/deployment.yaml (api image)' };
}

const entries = [sdkDeclared(), sdkInstalled(), runtimeDockerfile(), runtimeImageTag()];
const problems = [];

for (const e of entries) {
  if (!e.raw) problems.push(`✗ ${e.from}: 未取到版本`);
  console.log(`  ${e.from.padEnd(28)} ${e.raw ?? '(none)'}`);
}

const declared = entries[0].raw;
if (declared && /^[\^~]/.test(declared)) {
  problems.push(`✗ server/package.json 的 SDK 版本必须为精确版本（当前 "${declared}"）`);
}
const versions = new Set(entries.map((e) => e.raw).filter(Boolean));
if (versions.size > 1) {
  problems.push(`✗ 版本不一致：${[...versions].join(' vs ')}`);
}

const serverPkg = JSON.parse(read('server/package.json'));
const apiTag = serverImageTag();
console.log(`  ${apiTag.from.padEnd(28)} ${apiTag.raw ?? '(none)'}`);
if (!apiTag.raw) {
  problems.push('✗ k8s/deployment.yaml 的 api 镜像未取到版本 tag');
} else if (apiTag.raw === 'latest') {
  problems.push('✗ k8s 的 api 镜像不允许用 latest（回滚时无法复现）');
} else if (apiTag.raw !== serverPkg.version) {
  problems.push(
    `✗ k8s 的 api 镜像 tag (${apiTag.raw}) 与 server/package.json 的 version (${serverPkg.version}) 不一致`,
  );
}

if (problems.length) {
  console.error('\n版本检查失败：');
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`\n✓ SDK/runtime 版本一致：${declared}；api 镜像 tag：${apiTag.raw}`);

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { test } from 'node:test';

/**
 * 迁移 DDL 与 PG 仓储的列一致性校验。
 *
 * PostgreSQL 路径没有集成测试（CI 里没有库），代码写了一个 DDL 里不存在的列时：
 * - 读：静默拿到 undefined（审计字段丢失，没人发现）
 * - 写：运行期报 column does not exist（人工输入链路直接 500）
 * 这里用静态比对把这类漂移挡在 CI。
 */

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATION = path.join(serverRoot, 'src/db/migrations/001_agent_execution.sql');

/** PG 仓储实现：这些文件里的行属性读取必须都能在 DDL 里找到 */
const PG_IMPLEMENTATIONS = [
  'src/execution/postgres-repository.ts',
  'src/human-tasks/postgres-repository.ts',
  'src/services/session-registry.ts',
];

function parseTables(sql: string): Map<string, Set<string>> {
  const tables = new Map<string, Set<string>>();
  const tableRe = /create table if not exists\s+(\w+)\s*\(([\s\S]*?)\n\);/g;
  for (const match of sql.matchAll(tableRe)) {
    const name = match[1]!;
    const columns = new Set<string>();
    for (const rawLine of match[2]!.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('--')) continue;
      if (/^(unique|primary key|constraint|foreign key)\b/i.test(line)) continue;
      columns.add(line.split(/[\s,]+/)[0]!);
    }
    tables.set(name, columns);
  }
  return tables;
}

/** 行属性读取：r.content_chars / rows[0].task_id / row.action_hash */
function rowPropertyReads(source: string): string[] {
  const re = /\b[a-zA-Z_][a-zA-Z0-9]*\.([a-z][a-z0-9]*_[a-z0-9_]+)\b/g;
  return [...new Set([...source.matchAll(re)].map((m) => m[1]!))].sort();
}

const ddl = fs.readFileSync(MIGRATION, 'utf-8');
const tables = parseTables(ddl);
const allColumns = new Set([...tables.values()].flatMap((cols) => [...cols]));

test('迁移 DDL 解析出全部 5 张表', () => {
  assert.deepEqual(
    [...tables.keys()].sort(),
    ['agent_execution', 'agent_session', 'execution_event', 'human_task', 'human_task_decision'],
  );
});

test('PG 仓储引用的列都存在于 DDL', () => {
  const missing: string[] = [];
  for (const rel of PG_IMPLEMENTATIONS) {
    const source = fs.readFileSync(path.join(serverRoot, rel), 'utf-8');
    for (const column of rowPropertyReads(source)) {
      if (!allColumns.has(column)) missing.push(`${rel} → ${column}`);
    }
  }
  assert.deepEqual(missing, [], `代码读取了 DDL 中不存在的列：\n${missing.join('\n')}`);
});

test('级联删除：删 execution 时 task / event 一并清理', () => {
  const cascades = ddl.match(/on delete cascade/g) ?? [];
  assert.ok(
    cascades.length >= 3,
    `期望 ≥3 处级联删除（human_task / human_task_decision / execution_event），实际 ${cascades.length}`,
  );
});

test('一人一票约束存在', () => {
  assert.match(ddl, /unique\s*\(\s*task_id\s*,\s*approver_id\s*\)/i);
});

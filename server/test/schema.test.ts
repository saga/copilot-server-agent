import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SQLITE_SCHEMA_SQL } from '../src/db/sqlite-schema.js';

/**
 * 两份 DDL 与 SQL 仓储的列一致性校验。
 *
 * 运行期默认 SQLite、可切 PostgreSQL，两者**共用同一份仓储实现**，所以：
 * - 某个列只在一份 DDL 里存在 → 另一个后端上要么静默拿到 undefined，要么报 column does not exist
 * - 代码读了一个两份 DDL 都没有的列 → 同上
 * 这两种情况本地跑内存实现都发现不了（内存仓储是另一套代码），CI 里也没有真库，
 * 因此在这里做静态比对。PostgreSQL 版由运维 psql 应用，同样必须对齐。
 */

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PG_MIGRATION = path.join(serverRoot, 'src/db/migrations/001_agent_execution.sql');

/** SQL 仓储实现：这些文件里的行属性读取必须能在**两份** DDL 里都找到 */
const SQL_IMPLEMENTATIONS = [
  'src/execution/sql-repository.ts',
  'src/human-tasks/sql-repository.ts',
  'src/services/session-registry.ts',
];

const EXPECTED_TABLES = [
  'agent_execution',
  'agent_session',
  'execution_event',
  'human_task',
  'human_task_decision',
];

const createTableRe = /create table if not exists\s+(\w+)\s*\(([\s\S]*?)\n\);/g;

function parseTables(sql: string): Map<string, Set<string>> {
  const tables = new Map<string, Set<string>>();
  for (const match of sql.matchAll(createTableRe)) {
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

const pgSql = fs.readFileSync(PG_MIGRATION, 'utf-8');
const pgTables = parseTables(pgSql);
const sqliteTables = parseTables(SQLITE_SCHEMA_SQL);

test('两份 DDL 覆盖同样的 5 张表', () => {
  assert.deepEqual([...pgTables.keys()].sort(), EXPECTED_TABLES);
  assert.deepEqual([...sqliteTables.keys()].sort(), EXPECTED_TABLES);
});

test('两份 DDL 的表结构逐列一致', () => {
  const diffs: string[] = [];
  for (const table of EXPECTED_TABLES) {
    const pg = pgTables.get(table) ?? new Set<string>();
    const lite = sqliteTables.get(table) ?? new Set<string>();
    for (const col of pg) if (!lite.has(col)) diffs.push(`${table}.${col} 只在 PostgreSQL DDL 里`);
    for (const col of lite) if (!pg.has(col)) diffs.push(`${table}.${col} 只在 SQLite DDL 里`);
  }
  assert.deepEqual(diffs, [], `两份 DDL 列不一致：\n${diffs.join('\n')}`);
});

test('SQL 仓储引用的列在两份 DDL 里都存在', () => {
  const pgColumns = new Set([...pgTables.values()].flatMap((c) => [...c]));
  const liteColumns = new Set([...sqliteTables.values()].flatMap((c) => [...c]));
  const missing: string[] = [];
  for (const rel of SQL_IMPLEMENTATIONS) {
    const source = fs.readFileSync(path.join(serverRoot, rel), 'utf-8');
    for (const column of rowPropertyReads(source)) {
      if (!pgColumns.has(column)) missing.push(`${rel} → ${column}（PostgreSQL DDL 缺）`);
      if (!liteColumns.has(column)) missing.push(`${rel} → ${column}（SQLite DDL 缺）`);
    }
  }
  assert.deepEqual(missing, [], `代码读取了 DDL 中不存在的列：\n${missing.join('\n')}`);
});

test('级联删除：删 execution 时 task / event 一并清理', () => {
  for (const [label, sql] of [
    ['PostgreSQL', pgSql],
    ['SQLite', SQLITE_SCHEMA_SQL],
  ] as const) {
    const cascades = sql.match(/on delete cascade/g) ?? [];
    assert.ok(
      cascades.length >= 3,
      `${label}：期望 ≥3 处级联删除（human_task / human_task_decision / execution_event），实际 ${cascades.length}`,
    );
  }
  // SQLite 默认不启用外键，必须由执行器打开（见 db/sqlite.ts 的 pragma foreign_keys）
  const sqliteSource = fs.readFileSync(path.join(serverRoot, 'src/db/sqlite.ts'), 'utf-8');
  assert.match(sqliteSource, /pragma foreign_keys = ON/, 'SQLite 必须开启 foreign_keys，否则 cascade 不生效');
});

test('一人一票约束在两份 DDL 里都存在', () => {
  for (const sql of [pgSql, SQLITE_SCHEMA_SQL]) {
    assert.match(sql, /unique\s*\(\s*task_id\s*,\s*approver_id\s*\)/i);
  }
});

test('SQLite 时间戳列不设 SQL default（避免与 ISO 混排）', () => {
  const offenders = [...SQLITE_SCHEMA_SQL.matchAll(/^\s*(\w*(?:_at))\s+.*default\s+(?!')(\S+)/gim)].map(
    (m) => `${m[1]} default ${m[2]}`,
  );
  assert.deepEqual(offenders, [], `时间戳列不应有 SQL default：\n${offenders.join('\n')}`);
});

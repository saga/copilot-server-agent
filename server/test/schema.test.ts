import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SQLITE_COLUMN_UPGRADES, SQLITE_SCHEMA_SQL } from '../src/db/sqlite-schema.js';

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

/** PostgreSQL 侧是增量迁移：001 建表，002 加协作模型 */
const PG_MIGRATION_001 = 'src/db/migrations/001_agent_execution.sql';
const PG_MIGRATION_002 = 'src/db/migrations/002_collaboration.sql';

/** SQL 仓储实现：这些文件里的行属性读取必须能在**两份** DDL 里都找到 */
const SQL_IMPLEMENTATIONS = [
  'src/execution/sql-repository.ts',
  'src/human-tasks/sql-repository.ts',
  'src/services/session-registry.ts',
  'src/collaboration/sql-repository.ts',
];

const EXPECTED_TABLES = [
  'agent_execution',
  'agent_message',
  'agent_session',
  'execution_event',
  'human_task',
  'human_task_decision',
  'session_event',
  'session_participant',
];

const createTableRe = /create table if not exists\s+(\w+)\s*\(([\s\S]*?)\n\);/g;
/** PG 的补列语句：老库升级路径，列必须本来就在 CREATE TABLE 里 */
const addColumnRe =
  /alter table\s+(\w+)\s+add column(?:\s+if not exists)?\s+(\w+)/gi;

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

/** 把 `alter table ... add column` 折进表结构：算出 PostgreSQL 的**生效**列集，而非建表语句的列集 */
function applyColumnChanges(tables: Map<string, Set<string>>, sql: string): void {
  for (const match of sql.matchAll(addColumnRe)) {
    tables.get(match[1]!)?.add(match[2]!);
  }
}

const sql001 = fs.readFileSync(path.join(serverRoot, PG_MIGRATION_001), 'utf-8');
const sql002 = fs.readFileSync(path.join(serverRoot, PG_MIGRATION_002), 'utf-8');
const pgSql = `${sql001}\n${sql002}`;
const pgTables = parseTables(pgSql);
applyColumnChanges(pgTables, pgSql);
const sqliteTables = parseTables(SQLITE_SCHEMA_SQL);

test('两份 DDL 覆盖同样的 8 张表', () => {
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

test('补列语句只补 CREATE TABLE 已声明的列', () => {
  const allColumns = new Set([...sqliteTables.values()].flatMap((c) => [...c]));
  const stray: string[] = [];
  for (const statement of SQLITE_COLUMN_UPGRADES) {
    const parsed = addColumnRe.exec(statement);
    addColumnRe.lastIndex = 0;
    assert.ok(parsed, `无法解析的补列语句：${statement}`);
    const [, table, column] = parsed;
    if (!sqliteTables.has(table!)) stray.push(`${table} 不是 SQLite DDL 里的表`);
    else if (!allColumns.has(column!)) stray.push(`${table}.${column} 不在 SQLite CREATE TABLE 里`);
  }
  assert.deepEqual(stray, [], `补列语句与 DDL 漂移：\n${stray.join('\n')}`);

  // PostgreSQL 侧走同一个升级路径：002 的补列集合必须与 SQLite 的补列集合一致。
  // （001 里也有补列语句，那是它自己那版的升级路径，对应列已写进 SQLite 的 CREATE TABLE。）
  const pgUpgrades = [...sql002.matchAll(addColumnRe)].map((m) => `${m[1]}.${m[2]}`).sort();
  const liteUpgrades = SQLITE_COLUMN_UPGRADES.map((s) => {
    const m = addColumnRe.exec(s)!;
    addColumnRe.lastIndex = 0;
    return `${m[1]}.${m[2]}`;
  }).sort();
  assert.deepEqual(liteUpgrades, pgUpgrades, 'SQLite 补列与 PG 002 迁移的补列集合不一致');
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

test('级联删除：删 execution / session 时从属行一并清理', () => {
  for (const [label, sql] of [
    ['PostgreSQL', pgSql],
    ['SQLite', SQLITE_SCHEMA_SQL],
  ] as const) {
    const cascades = sql.match(/on delete cascade/g) ?? [];
    assert.ok(
      cascades.length >= 6,
      `${label}：期望 ≥6 处级联删除（human_task / human_task_decision / execution_event / session_participant / agent_message / session_event），实际 ${cascades.length}`,
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

test('消息幂等与序号的唯一约束在两份 DDL 里都存在', () => {
  for (const [label, sql] of [
    ['PostgreSQL', pgSql],
    ['SQLite', SQLITE_SCHEMA_SQL],
  ] as const) {
    // client_message_id 去重：客户端重试同一条消息不会产生第二次 execution
    assert.match(sql, /unique\s*\(\s*session_id\s*,\s*client_message_id\s*\)/i, `${label} 缺消息幂等约束`);
    // sequence 唯一：会话内消息序号与事件序号都必须单调且不重复
    const seqUniques = sql.match(/unique\s*\(\s*session_id\s*,\s*sequence\s*\)/gi) ?? [];
    assert.ok(seqUniques.length >= 2, `${label}：期望 ≥2 处 (session_id, sequence) 唯一约束，实际 ${seqUniques.length}`);
  }
});

test('SQLite 时间戳列不设 SQL default（避免与 ISO 混排）', () => {
  const offenders = [...SQLITE_SCHEMA_SQL.matchAll(/^\s*(\w*(?:_at))\s+.*default\s+(?!')(\S+)/gim)].map(
    (m) => `${m[1]} default ${m[2]}`,
  );
  assert.deepEqual(offenders, [], `时间戳列不应有 SQL default：\n${offenders.join('\n')}`);
});

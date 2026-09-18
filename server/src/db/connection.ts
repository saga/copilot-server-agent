import { config } from '../config.js';
import type { DbBackend, SqlDialect, SqlExecutor } from './dialect.js';
import { getPostgres, postgresDialect } from './postgres.js';
import { sqliteDialect, SqliteDatabase } from './sqlite.js';

/**
 * 后端选择（唯一一处决定用哪个库的地方）。
 *
 *   DATABASE_URL 有值 → PostgreSQL（多副本/集中部署）
 *   否则             → SQLite（默认；单文件落盘，零依赖、零配置）
 *
 * 两者都是 durable：execution / human task / approval / event / session ownership
 * 都跨进程重启存活。差别只在部署形态，不在能力。
 */

let sqlite: SqliteDatabase | null = null;
let override: SqlExecutor | null = null;

/**
 * 覆盖连接实例（**仅供测试**）。
 * 让用例在临时 SQLite 文件上跑同一套 SQL 仓储，从而验证列名/方言与「重启后数据仍在」，
 * 而不必改全局 config 或起真库。传 null 恢复默认行为。
 */
export function setTestDb(executor: SqlExecutor | null): void {
  override = executor;
}

export function currentBackend(): DbBackend {
  return config.databaseUrl ? 'postgres' : 'sqlite';
}

export function currentDialect(): SqlDialect {
  return currentBackend() === 'postgres' ? postgresDialect : sqliteDialect;
}

export function getDb(): SqlExecutor {
  if (override) return override;
  if (currentBackend() === 'postgres') return getPostgres();
  sqlite ??= new SqliteDatabase(config.sqlitePath);
  return sqlite;
}

/** 当前 SQLite 文件路径（PostgreSQL 模式下返回 undefined） */
export function sqliteFilePath(): string | undefined {
  return currentBackend() === 'sqlite' ? config.sqlitePath : undefined;
}

export async function closeDb(): Promise<void> {
  if (sqlite) {
    const inst = sqlite;
    sqlite = null;
    await inst.close();
  }
  if (currentBackend() === 'postgres') {
    try {
      await getPostgres().close();
    } catch {
      // 未建过池（或已关闭），无需收尾
    }
  }
}

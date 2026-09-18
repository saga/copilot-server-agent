import { createRequire } from 'node:module';
import { config } from '../config.js';

/**
 * PostgreSQL 访问层。
 *
 * execution / human task / approval / execution event / session ownership 都是业务状态，
 * 必须能跨 Pod 重启存活（HITL 场景下审批中的 execution 不能因为重启而消失）。
 * 未配 DATABASE_URL 时整套走内存实现（单副本本地开发），接口完全一致。
 *
 * 依赖处理：`pg` 是可选依赖，只在真正配了 DATABASE_URL 时才 require，
 * 因此未安装 pg 也能正常 typecheck / 运行内存模式。
 */

export interface SqlRow {
  [column: string]: unknown;
}

export interface SqlExecutor {
  query<T = SqlRow>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
  /** 事务：回调内所有 query 共用一个连接（execution + task + event 要原子写入） */
  transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T>;
}

const require = createRequire(import.meta.url);

let pool: SqlExecutor | null = null;
let initError: string | null = null;

/** 是否启用了 PostgreSQL 后端 */
export function isDatabaseEnabled(): boolean {
  return Boolean(config.databaseUrl);
}

interface PgLike {
  query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
  connect: () => Promise<{
    query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
    release: () => void;
  }>;
}

/** 惰性建池（首次用到才 require('pg')；失败只记一次，避免每请求刷日志） */
export function getSql(): SqlExecutor {
  if (!config.databaseUrl) {
    throw new Error('DATABASE_URL 未配置（当前为内存模式，durable state 不可跨重启）');
  }
  if (pool) return pool;
  if (initError) throw new Error(`PostgreSQL 初始化失败：${initError}`);
  try {
    const mod = require('pg') as { Pool: new (opts: { connectionString: string }) => PgLike };
    const pg = new mod.Pool({ connectionString: config.databaseUrl });
    pool = {
      async query<T>(text: string, params: unknown[] = []) {
        const res = await pg.query(text, params);
        return { rows: res.rows as T[] };
      },
      async transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
        const conn = await pg.connect();
        const tx: SqlExecutor = {
          async query<R>(text: string, params: unknown[] = []) {
            const res = await conn.query(text, params);
            return { rows: res.rows as R[] };
          },
          transaction: async (inner) => inner(tx),
        };
        try {
          await conn.query('BEGIN');
          const out = await fn(tx);
          await conn.query('COMMIT');
          return out;
        } catch (err) {
          await conn.query('ROLLBACK').catch(() => undefined);
          throw err;
        } finally {
          conn.release();
        }
      },
    };
    return pool;
  } catch (err) {
    initError = err instanceof Error ? err.message : String(err);
    throw new Error(`PostgreSQL 初始化失败：${initError}（未安装 pg 时请 npm i pg）`);
  }
}

/** 关闭连接池（优雅退出） */
export async function closeSql(): Promise<void> {
  const p = pool as unknown as { end?: () => Promise<void> } | null;
  pool = null;
  initError = null;
  if (p && typeof p.end === 'function') await p.end().catch(() => undefined);
}

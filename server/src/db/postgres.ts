import { createRequire } from 'node:module';
import { config } from '../config.js';
import {
  parseJsonValue,
  parseTsValue,
  type SqlDialect,
  type SqlExecutor,
  type SqlRow,
} from './dialect.js';

/**
 * PostgreSQL 后端（可选）。
 *
 * `pg` 是可选依赖，只在真正配了 DATABASE_URL 时才 require，
 * 因此未安装 pg 也能正常 typecheck / 运行 SQLite 模式。
 */

const require = createRequire(import.meta.url);

interface PgLike {
  query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
  connect: () => Promise<{
    query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
    release: () => void;
  }>;
  end: () => Promise<void>;
}

export const postgresDialect: SqlDialect = {
  name: 'postgres',
  ph: (i) => `$${i}`,
  bind: (v) => (v === undefined ? null : v),
  bindArray: (values) => values,
  json: <T>(v: unknown) => parseJsonValue<T>(v),
  bool: (v) => v === true || v === 't' || v === 1,
  ts: (v) => parseTsValue(v),
  tsParam: (iso) => iso,
  // jsonb_array_elements_text 展开数组后与参数数组求交；比 ?| / @> 更贴近 SQLite 写法
  arrayOverlap: (col, param) =>
    `exists (select 1 from jsonb_array_elements_text(${col}) as v where v = any(${param}::text[]))`,
  arrayLength: (col) => `jsonb_array_length(${col})`,
  asInt: (expr) => `${expr}::int`,
};

let pool: SqlExecutor | null = null;
let initError: string | null = null;

/** 惰性建池：首次用到才 require('pg')，失败只记一次避免刷日志 */
export function getPostgres(): SqlExecutor {
  if (pool) return pool;
  if (initError) throw new Error(`PostgreSQL 初始化失败：${initError}`);
  if (!config.databaseUrl) {
    throw new Error('DATABASE_URL 未配置（当前为 SQLite 模式，无需 PostgreSQL）');
  }
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
          close: async () => undefined,
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
      async close() {
        pool = null;
        initError = null;
        await pg.end().catch(() => undefined);
      },
    };
    return pool;
  } catch (err) {
    initError = err instanceof Error ? err.message : String(err);
    throw new Error(`PostgreSQL 初始化失败：${initError}（未安装 pg 时请 npm i pg）`);
  }
}

export type { SqlRow };

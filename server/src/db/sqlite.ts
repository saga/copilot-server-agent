import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { config } from '../config.js';
import {
  parseJsonValue,
  parseTsValue,
  type SqlDialect,
  type SqlExecutor,
  type SqlRow,
} from './dialect.js';
import { SQLITE_COLUMN_UPGRADES, SQLITE_SCHEMA_SQL } from './sqlite-schema.js';

/**
 * SQLite 后端（默认）。用 Node 内置的 `node:sqlite`，不引入任何原生依赖。
 *
 * 并发模型：`node:sqlite` 是同步 API，且 SQLite 单文件同时只有一个写者。
 * 这里把**所有**语句串行化到一条 promise 链上（进程内单连接），
 * 换来两件事：不会出现两条语句交错进同一个事务，也不需要重试逻辑。
 * 本服务的库操作都在 agent turn 之间（秒级），不构成瓶颈。
 *
 * 事务：`transaction(fn)` 独占串行锁，回调内必须用传进来的 `tx` 执行语句；
 * 若在回调里改用外层 `query()` 会自己等自己（死锁）—— 这正是 tx 不给锁的原因。
 */

const require = createRequire(import.meta.url);

interface SqliteCtor {
  new (path: string, options?: { allowExtension?: boolean }): DatabaseSyncType;
}

let cachedCtor: SqliteCtor | null = null;

/**
 * 惰性要求 `node:sqlite`：Node 22.13 / 23.4 起才免 `--experimental-sqlite`。
 * 老版本上直接给出可操作的报错，而不是一个 ERR_UNKNOWN_BUILTIN_MODULE。
 */
function sqliteCtor(): SqliteCtor {
  if (cachedCtor) return cachedCtor;
  try {
    const mod = require('node:sqlite') as { DatabaseSync: SqliteCtor };
    cachedCtor = mod.DatabaseSync;
    return cachedCtor;
  } catch {
    throw new Error(
      `当前 Node ${process.version} 不支持内置 SQLite（node:sqlite 需要 Node >= 22.13 或 >= 23.4）。` +
        `升级 Node 后重试，或改用 PostgreSQL（配 DATABASE_URL）。`,
    );
  }
}


export const sqliteDialect: SqlDialect = {
  name: 'sqlite',
  ph: (i) => `?${i}`,
  bind: (v) => {
    if (v === undefined || v === null) return null;
    // node:sqlite 不接受布尔绑定，只有 0/1
    if (typeof v === 'boolean') return v ? 1 : 0;
    return v;
  },
  bindArray: (values) => JSON.stringify(values),
  json: <T>(v: unknown) => parseJsonValue<T>(v),
  bool: (v) => v === 1 || v === true || v === '1',
  ts: (v) => parseTsValue(v),
  tsParam: (iso) => iso,
  // json_each 把 JSON 数组展开成行，与参数里的数组求交
  arrayOverlap: (col, param) =>
    `exists (select 1 from json_each(${col}) where json_each.value in (select value from json_each(${param})))`,
  arrayLength: (col) => `json_array_length(${col})`,
  asInt: (expr) => expr,
};

export class SqliteDatabase implements SqlExecutor {
  private chain: Promise<unknown> = Promise.resolve();
  private readonly db: DatabaseSyncType;

  /** `filePath` 传 ':memory:' 可建内存库（测试用） */
  constructor(readonly filePath: string) {
    if (filePath !== ':memory:') {
      mkdirSync(path.dirname(filePath), { recursive: true });
    }
    const DatabaseSync = sqliteCtor();
    this.db = new DatabaseSync(filePath, {
      allowExtension: config.sqliteExtensions.length > 0,
    });
    // WAL：读写不互斥；foreign_keys：cascade 删除生效（默认是关的）；
    // busy_timeout：多进程共用一个文件时等待而不是立刻 SQLITE_BUSY
    this.db.exec('pragma journal_mode = WAL');
    this.db.exec('pragma foreign_keys = ON');
    this.db.exec('pragma busy_timeout = 5000');
    this.db.exec(SQLITE_SCHEMA_SQL);
    this.applyColumnUpgrades();
    this.loadExtensions();
  }

  /**
   * 给已存在的表补上新增列（老库文件升级路径）。
   * 逐条查 pragma_table_info，缺了才 alter —— 相当于 SQLite 版的 `add column if not exists`。
   */
  private applyColumnUpgrades(): void {
    for (const statement of SQLITE_COLUMN_UPGRADES) {
      const parsed = /^alter table (\w+) add column (\w+)/i.exec(statement.trim());
      if (!parsed) continue;
      const [, table, column] = parsed;
      const existing = this.db
        .prepare(`select name from pragma_table_info('${table}')`)
        .all() as Array<{ name: string }>;
      if (existing.some((row) => row.name === column)) continue;
      this.db.exec(statement);
    }
  }

  /** 可选扩展（如 sqlite-vec）：配了路径才加载，失败只记日志不影响启动 */
  private loadExtensions(): void {
    for (const ext of config.sqliteExtensions) {
      try {
        this.db.loadExtension(ext);
        console.log(`[sqlite] 已加载扩展：${ext}`);
      } catch (err) {
        console.warn(
          `[sqlite] 扩展加载失败 ${ext}：${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  /** 全部语句串行执行；前一条失败不阻塞后续 */
  private serialize<T>(fn: () => T | Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);
    this.chain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private runSync<T = SqlRow>(text: string, params: unknown[]): T[] {
    const stmt = this.db.prepare(text);
    const bound = params.map((p) => sqliteDialect.bind(p)) as Parameters<typeof stmt.all>;
    return stmt.all(...bound) as T[];
  }

  async query<T = SqlRow>(text: string, params: unknown[] = []): Promise<{ rows: T[] }> {
    return this.serialize(() => ({ rows: this.runSync<T>(text, params) }));
  }

  async transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    return this.serialize(async () => {
      this.db.exec('begin immediate');
      try {
        const out = await fn(this.txExecutor);
        this.db.exec('commit');
        return out;
      } catch (err) {
        try {
          this.db.exec('rollback');
        } catch {
          // 已经回滚/连接关闭，忽略
        }
        throw err;
      }
    });
  }

  /** 事务内执行器：已持有串行锁，不再上锁（重复上锁会死锁） */
  private get txExecutor(): SqlExecutor {
    return {
      query: async <R = SqlRow>(text: string, params: unknown[] = []) => ({
        rows: this.runSync<R>(text, params),
      }),
      transaction: async <R>(inner: (tx: SqlExecutor) => Promise<R>) => inner(this.txExecutor),
      close: async () => undefined,
    };
  }

  async close(): Promise<void> {
    await this.serialize(() => {
      this.db.close();
    });
  }
}

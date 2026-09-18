/**
 * SQL 方言：PostgreSQL 与 SQLite 的全部差异都收在这一层。
 *
 * 仓储只写一份实现（`execution/sql-repository.ts` 等），通过这里提供的钩子适配两种库：
 * 占位符、JSON 列编解码、布尔表示、时间戳表示、JSON 数组命中判定、聚合取整。
 * 新增一个差异点时加一个钩子，不要在仓储里写 `if (dialect.name === ...)`。
 */

export type DbBackend = 'postgres' | 'sqlite';

export interface SqlRow {
  [column: string]: unknown;
}

/** 把 SQL 引擎暴露成统一异步接口（SQLite 是同步 API，包一层即可） */
export interface SqlExecutor {
  query<T = SqlRow>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
  /** 事务：回调内所有 query 共用一个连接，失败整体回滚 */
  transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export interface SqlDialect {
  readonly name: DbBackend;

  /** 参数占位符（PG 用 $1，SQLite 用 ?1） */
  ph(index: number): string;

  /** 绑定普通参数（null / 数字 / 字符串）；undefined 一律按 null，布尔按方言转换 */
  bind(value: unknown): unknown;

  /**
   * 绑定"JSON 数组命中判定"用的值集合。
   * 同一个字符串数组在两种库里编码不同：PG 要原生数组（配 ::text[]），SQLite 要 JSON 文本。
   */
  bindArray(values: string[]): unknown;

  /** 读 JSON 列（PG 驱动已解析成对象，SQLite 返回文本需自己 parse） */
  json<T = unknown>(value: unknown): T | undefined;

  /** 读布尔列（PG 返回 boolean，SQLite 返回 0/1） */
  bool(value: unknown): boolean;

  /** 读时间戳列 → ISO 字符串（PG 返回 Date，SQLite 存 ISO 文本） */
  ts(value: unknown): string | undefined;

  /** 写时间戳（两种方言都接受 ISO 字符串） */
  tsParam(iso: string): unknown;

  /** JSON 数组列与给定值集合是否有交集（human task 的 eligible_roles / eligible_users） */
  arrayOverlap(jsonColumn: string, valuesParam: string): string;

  /** JSON 数组长度表达式 */
  arrayLength(column: string): string;

  /** 聚合计数转整型（PG 需要显式 cast，SQLite 不需要） */
  asInt(expr: string): string;
}

/**
 * JSON 列的参数编码。两种方言都接受 JSON 文本（jsonb 列由 PG 隐式转换），
 * 因此不需要按方言分叉 —— 但**必须**用它，别把对象直接丢进参数里。
 */
export function jsonParam(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value ?? null);
}

/** 读 JSON 列：兼容 PG 的已解析对象与 SQLite 的文本 */
export function parseJsonValue<T>(value: unknown): T | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') {
    if (!value) return undefined;
    try {
      return JSON.parse(value) as T;
    } catch {
      return undefined;
    }
  }
  return value as T;
}

/** 读时间戳：兼容 PG 的 Date 与 SQLite 的 ISO 文本 */
export function parseTsValue(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

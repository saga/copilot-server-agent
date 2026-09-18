/**
 * 审计数据脱敏 + 截断。
 *
 * tool 的参数与结果既可能带密钥（BYOK key、Authorization 头、cookie），
 * 也可能非常大（SQL 结果、PDF 抽取、网页抓取、目录遍历），
 * 直接塞进事件环/执行记录会打爆日志与内存，所以统一走：
 *
 *   redactSecrets（按 key + 按值形态） → preview（JSON 化后截断）
 */

export const REDACTED = '<redacted>';

/** 命中即整值替换（覆盖 token/密钥/凭证类字段的各种命名） */
const SECRET_KEY_RE =
  /(token|access[_-]?token|refresh[_-]?token|id[_-]?token|authorization|auth|api[_-]?key|apikey|password|passwd|pwd|secret|credential|private[_-]?key|client[_-]?secret|cookie|session[_-]?key|signature|bearer)/i;

/** 值形态兜底：Bearer xxx / sk-xxx / ghp_xxx / JWT / AKIA… */
const SECRET_VALUE_RE =
  /(bearer\s+[a-z0-9._\-]{8,}|sk-[a-z0-9_\-]{8,}|gh[pousr]_[a-z0-9]{8,}|github_pat_[a-z0-9_]{8,}|xox[baprs]-[a-z0-9\-]{8,}|AKIA[0-9A-Z]{12,}|ey[a-z0-9_\-]{8,}\.[a-z0-9_\-]{8,}\.[a-z0-9_\-]{8,})/gi;

const MAX_DEPTH = 6;
const MAX_ITEMS = 50;

function maskString(s: string): string {
  return s.replace(SECRET_VALUE_RE, REDACTED);
}

/**
 * 递归脱敏：命中 key 的字段整值替换；字符串再过一遍值形态匹配。
 * 循环引用与超深/超大结构按上限收敛，不抛异常（审计不该把执行打断）。
 */
export function redactSecrets(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return maskString(value);
  if (typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return REDACTED;
  if (seen.has(value as object)) return '<circular>';
  seen.add(value as object);

  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ITEMS).map((v) => redactSecrets(v, depth + 1, seen));
    return value.length > MAX_ITEMS ? [...items, `…[+${value.length - MAX_ITEMS} items]`] : items;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_KEY_RE.test(k) ? REDACTED : redactSecrets(v, depth + 1, seen);
  }
  return out;
}

/** 循环安全 + 不可序列化值的兜底（BigInt/function/undefined） */
function stringify(value: unknown): string {
  const seen = new WeakSet<object>();
  try {
    return (
      JSON.stringify(value, (_k, v) => {
        if (typeof v === 'bigint') return `${v}n`;
        if (typeof v === 'function') return '<fn>';
        if (typeof v === 'object' && v !== null) {
          if (seen.has(v)) return '<circular>';
          seen.add(v);
        }
        return v;
      }) ?? String(value)
    );
  } catch {
    return String(value);
  }
}

/** 截断：超出部分只报长度，不保留内容 */
export function truncate(s: string, maxChars: number): string {
  if (maxChars <= 0) return '';
  if (s.length <= maxChars) return s;
  return `${s.slice(0, maxChars)}…[+${s.length - maxChars} chars]`;
}

/** 审计字段统一入口：脱敏 → 序列化 → 截断 */
export function preview(value: unknown, maxChars: number): string {
  return truncate(stringify(redactSecrets(value)), maxChars);
}

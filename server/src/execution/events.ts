import { redactSecrets, truncate } from './redact.js';
import type { EventRepository } from './repository.js';
import type { ExecutionEvent } from './types.js';

/**
 * 审计 payload 的轻边界：单个长字符串上限 / 整个 payload 序列化上限。
 *
 * 为什么需要：append() 的调用方越来越多，未来有人很自然地写出
 * `payload: { output: llmFullResponse }` —— 整段文档/网页/客户数据或 prompt
 * 注入内容就会进 durable 审计表。Observability（全量 trace）与 Regulatory
 * Evidence（最小必要记录）不是一回事，边界必须落在写入侧，而不是靠每个调用者自觉。
 *
 * 刻意保持轻量：只做脱敏 + 截断，不做 schema 校验、不抛错（审计不该把执行打断）。
 */
export const MAX_EVENT_STRING_CHARS = 2000;
export const MAX_EVENT_PAYLOAD_CHARS = 8000;

/** 递归截断过长字符串（保留结构，只缩内容） */
function truncateStrings(value: unknown): unknown {
  if (typeof value === 'string') return truncate(value, MAX_EVENT_STRING_CHARS);
  if (Array.isArray(value)) return value.map(truncateStrings);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = truncateStrings(v);
    }
    return out;
  }
  return value;
}

/**
 * payload 写入前的统一收敛：脱敏 → 逐字段截断 → 总量兜底。
 * 总量仍超限时只留预览（结构丢掉，但调用链不断；返回的预览里不再含原始内容）。
 */
export function boundEventPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const bounded = truncateStrings(redactSecrets(payload)) as Record<string, unknown>;
  const serialized = JSON.stringify(bounded) ?? '';
  if (serialized.length <= MAX_EVENT_PAYLOAD_CHARS) return bounded;
  return {
    truncated: true,
    originalChars: serialized.length,
    preview: truncate(serialized, MAX_EVENT_PAYLOAD_CHARS),
  };
}

/**
 * ExecutionEvent：完整审计时间线（ExecutionRecord 只存“当前状态”，不能回答
 * “谁批准了 / 什么时候 / 批准前看到什么 / 后来为什么执行”)。
 *
 * 与 LangSmith 的分工：
 *   LangSmith       = runtime observability（trace、latency）
 *   ExecutionEvent  = business execution audit（regulatory evidence）
 */
export class ExecutionEventLog {
  constructor(private readonly repo: EventRepository) {}

  async append(input: {
    executionId: string;
    type: string;
    actorType: ExecutionEvent['actorType'];
    actorId?: string;
    payload?: Record<string, unknown>;
  }): Promise<ExecutionEvent> {
    return this.repo.append({
      executionId: input.executionId,
      type: input.type,
      actorType: input.actorType,
      ...(input.actorId ? { actorId: input.actorId } : {}),
      // 所有审计事件统一走轻边界：调用方不需要（也不应该）自己做 preview/redact
      ...(input.payload ? { payload: boundEventPayload(input.payload) } : {}),
      createdAt: new Date().toISOString(),
    });
  }

  list(executionId: string, limit = 100): Promise<ExecutionEvent[]> {
    return this.repo.list(executionId, limit);
  }
}

import { createHash } from 'node:crypto';
import type { ActionIntent } from './types.js';

/**
 * actionHash：审批绑定的是“批准了什么”，不是“批准了一次 HTTP 请求”。
 *
 *   agent 提出 intent → hash=ABC → 人工批准 ABC → 执行前重算 → 一致才执行
 *
 * 与 resourceVersion 是两个维度：
 *   actionHash      = 批准的动作内容
 *   resourceVersion = 批准时所依据的数据版本
 */

/** 稳定序列化：对象 key 排序，数组保序（保证同样语义的 intent 得到同一个 hash） */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
  return `{${entries.join(',')}}`;
}

/** createdAt 不进 hash（同样的动作在不同时间提出，hash 应一致） */
export function hashAction(action: ActionIntent): string {
  const { createdAt: _drop, ...rest } = action;
  return createHash('sha256').update(canonicalJson(rest)).digest('hex');
}

/** 执行前复核：hash 不一致说明 agent 改了动作内容，必须重新审批 */
export function verifyActionHash(action: ActionIntent, expected: string): boolean {
  return hashAction(action) === expected;
}

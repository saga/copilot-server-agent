import { createHash } from 'node:crypto';
import type { CommandIntent } from './types.js';

/**
 * commandHash：审批绑定的是“批准了什么”，不是“批准了一次 HTTP 请求”。
 *
 *   agent 提出 intent → hash=ABC → 人工批准 ABC → 执行前重算 → 一致才执行
 *
 * 与 resourceVersion 是两个维度：
 *   commandHash     = 批准的命令内容
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

/**
 * hash 的输入是一份**冻结的 wire format**，不是 `CommandIntent` 这个 TS 接口本身。
 *
 * 为什么必须解耦：hash 是对 key 排序后序列化的结果，**改一个字段名就换一个 hash**。
 * 直接把 intent 丢进去的话，`actionType` 改名成 `commandType` 的那一刻，所有已经批准、
 * 还停在 `waiting_for_approval` 的命令都会在执行前复核时报"命令内容已被修改，
 * 必须重新审批" —— 明明内容一个字都没变。
 *
 * 所以这里显式列出参与 hash 的字段，并固定用改名前的 key 名。
 * 要改这份格式必须先想清楚在途审批怎么办（迁移 or 强制重批），别顺手改。
 */
function frozenHashInput(intent: CommandIntent): Record<string, unknown> {
  return {
    actionType: intent.commandType, // ← 冻结：改名前的 key，别动
    target: intent.target,
    parameters: intent.parameters,
    requestedBy: intent.requestedBy,
    ...(intent.reason !== undefined ? { reason: intent.reason } : {}),
  };
}

/** createdAt 不进 hash（同样的命令在不同时间提出，hash 应一致） */
export function hashCommand(intent: CommandIntent): string {
  return createHash('sha256').update(canonicalJson(frozenHashInput(intent))).digest('hex');
}

/** 执行前复核：hash 不一致说明 agent 改了命令内容，必须重新审批 */
export function verifyCommandHash(intent: CommandIntent, expected: string): boolean {
  return hashCommand(intent) === expected;
}

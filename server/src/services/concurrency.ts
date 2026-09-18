import { config } from '../config.js';

/**
 * 全局并发闸门：限制同时运行的 agent turn 数。
 *
 *   request → global semaphore（可选）→ session lock → Copilot turn
 *
 * 没有它时 100 个用户会同时拉起 100 个 turn，把 runtime CPU/subprocess 打满。
 * 只做轻量 semaphore，不做队列系统（有需要时再上 worker pool）。
 */

let active = 0;
const waiters: Array<() => void> = [];

export function concurrencyState(): { active: number; limit: number; queued: number } {
  return { active, limit: config.maxConcurrentExecutions, queued: waiters.length };
}

export async function withExecutionSlot<T>(fn: () => Promise<T>): Promise<T> {
  const limit = config.maxConcurrentExecutions;
  if (!limit || limit <= 0) return fn();
  if (active >= limit) {
    await new Promise<void>((resolve) => waiters.push(resolve));
  }
  active += 1;
  try {
    return await fn();
  } finally {
    active -= 1;
    waiters.shift()?.();
  }
}

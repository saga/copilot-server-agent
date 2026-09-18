import { executionService } from '../execution/index.js';

/**
 * Hook 事件环：内置 hook 处理器把关键事件记在这里，供 GET /api/hooks 查询与审计。
 * 只保留最近 N 条、纯内存（进程重启即清空；要持久审计请接外部日志）。
 * executionId 在记录时按 session 的当前 execution 补齐，调用方不用自己传。
 */
export type HookEventKind =
  | 'session-start'
  | 'session-end'
  | 'agent-stop'
  | 'error'
  | 'permission'
  | 'tool-guard'
  | 'tool-call';

export interface HookEvent {
  ts: string;
  sessionId: string;
  /** 归属的 execution（turn 之外的 hook 没有） */
  executionId?: string;
  kind: HookEventKind;
  detail: string;
}

const MAX_EVENTS = 200;
const ring: HookEvent[] = [];

export function recordHookEvent(sessionId: string, kind: HookEventKind, detail: string): void {
  const executionId = executionService.activeFor(sessionId);
  ring.push({
    ts: new Date().toISOString(),
    sessionId,
    ...(executionId ? { executionId } : {}),
    kind,
    detail,
  });
  if (ring.length > MAX_EVENTS) ring.splice(0, ring.length - MAX_EVENTS);
}

export function recentHookEvents(limit = 50): HookEvent[] {
  return ring.slice(-Math.max(1, Math.min(limit, MAX_EVENTS)));
}

export function hookEventCount(): number {
  return ring.length;
}

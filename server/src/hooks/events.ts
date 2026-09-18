/**
 * Hook 事件环：内置 hook 处理器把关键事件记在这里，供 GET /api/hooks 查询与审计。
 * 只保留最近 N 条、纯内存（进程重启即清空；要持久审计请接外部日志）。
 */
export type HookEventKind = 'session-start' | 'session-end' | 'agent-stop' | 'error';

export interface HookEvent {
  ts: string;
  sessionId: string;
  kind: HookEventKind;
  detail: string;
}

const MAX_EVENTS = 200;
const ring: HookEvent[] = [];

export function recordHookEvent(sessionId: string, kind: HookEventKind, detail: string): void {
  ring.push({ ts: new Date().toISOString(), sessionId, kind, detail });
  if (ring.length > MAX_EVENTS) ring.splice(0, ring.length - MAX_EVENTS);
}

export function recentHookEvents(limit = 50): HookEvent[] {
  return ring.slice(-Math.max(1, Math.min(limit, MAX_EVENTS)));
}

export function hookEventCount(): number {
  return ring.length;
}

/** agent turn 的事件回调（route/SSE 决定怎么用，runner 不关心传输） */
export interface AgentTurnHandlers {
  onDelta?: (delta: string) => void;
  onMessage?: (content: string) => void;
  /** sub-agent 生命周期事件（selected/started/completed/failed/deselected） */
  onSubagent?: (event: unknown) => void;
}

export interface AgentTurnResult {
  content: string;
  chars: number;
  outcome: 'completed' | 'aborted';
}

/** SSE 事件名（前端与 route 共用；HITL 场景新增 waiting 帧） */
export const SSE_EVENTS = {
  execution: 'execution',
  delta: 'delta',
  message: 'message',
  subagent: 'subagent',
  waiting: 'waiting',
  done: 'done',
  error: 'error',
} as const;

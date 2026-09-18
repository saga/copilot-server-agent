export interface HealthResponse {
  status: 'ok';
  uptime: number;
  timestamp: string;
  copilot: 'connected' | 'disconnected' | 'error';
  copilotError?: string;
}

export interface CreateSessionBody {
  model?: string;
  systemMessage?: string;
}

export interface ChatBody {
  prompt: string;
  /** 为 true 时走 SSE 流式返回 */
  streaming?: boolean;
  model?: string;
}

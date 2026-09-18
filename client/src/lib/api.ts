const API_BASE = import.meta.env.VITE_API_BASE || '';

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export interface Health {
  status: string;
  uptime: number;
  timestamp: string;
  copilot: 'connected' | 'disconnected' | 'error';
  copilotError?: string;
}

export interface ProviderStatus {
  id: string;
  displayName: string;
  defaultModel: string;
  configured: boolean;
  active: boolean;
  hint?: string;
}

export interface AgentInfo {
  name: string;
  displayName?: string;
  description?: string;
  tools?: string[] | null;
}

export interface SkillInfo {
  name: string;
  description?: string;
  directory: string;
}

export interface CreateSessionOpts {
  model?: string;
  sessionId?: string;
  agents?: string[];
  agent?: string;
  noBuiltinSkills?: boolean;
  mcp?: string[];
  disabledMcpServers?: string[];
}

export interface SessionMeta {
  sessionId: string;
  startTime: string;
  modifiedTime: string;
  summary?: string;
  isRemote: boolean;
  attached: boolean;
}

export interface McpPreset {
  name: string;
  description: string;
  kind: 'local' | 'http';
  enabledByDefault: boolean;
  scope?: string;
  source: 'builtin' | 'operator';
}

export interface SubagentEvent {
  type: string;
  data?: {
    agentName?: string;
    agentDisplayName?: string;
    error?: string;
    totalTokens?: number;
    durationMs?: number;
  };
}

export const api = {
  health(): Promise<Health> {
    return fetch(`${API_BASE}/api/health`).then(json<Health>);
  },

  providers(): Promise<{ providers: ProviderStatus[] }> {
    return fetch(`${API_BASE}/api/providers`).then(json<{ providers: ProviderStatus[] }>);
  },

  agents(): Promise<{ agents: AgentInfo[]; skills: SkillInfo[]; skillDirectories: string[] }> {
    return fetch(`${API_BASE}/api/agents`).then(
      json<{ agents: AgentInfo[]; skills: SkillInfo[]; skillDirectories: string[] }>,
    );
  },

  models(): Promise<{ provider: string; models: unknown }> {
    return fetch(`${API_BASE}/api/models`).then(json<{ provider: string; models: unknown }>);
  },

  createSession(opts?: CreateSessionOpts): Promise<{ sessionId: string }> {
    return fetch(`${API_BASE}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts ?? {}),
    }).then(json<{ sessionId: string }>);
  },

  /** 会话列表（磁盘全部，attached 标记是否在本进程内存） */
  listSessions(): Promise<{ sessions: SessionMeta[] }> {
    return fetch(`${API_BASE}/api/sessions`).then(json<{ sessions: SessionMeta[] }>);
  },

  /** 恢复会话（可附带重配，BYOK 凭证由服务端自动重传） */
  resumeSession(id: string, opts?: CreateSessionOpts): Promise<{ sessionId: string; resumed: boolean }> {
    return fetch(`${API_BASE}/api/sessions/${encodeURIComponent(id)}/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts ?? {}),
    }).then(json<{ sessionId: string; resumed: boolean }>);
  },

  /**
   * 断开会话：默认只释放内存、保留磁盘数据（仍可 resume）；
   * permanent=true 则彻底删除，不可恢复。
   */
  disconnectSession(id: string, permanent = false): Promise<unknown> {
    return fetch(
      `${API_BASE}/api/sessions/${encodeURIComponent(id)}${permanent ? '?permanent=true' : ''}`,
      { method: 'DELETE' },
    ).then(json<unknown>);
  },

  /** MCP 预设与内联开关（只含元信息） */
  mcp(): Promise<{ presets: McpPreset[]; allowInlineLocal: boolean; allowInlineHttp: boolean }> {
    return fetch(`${API_BASE}/api/mcp`).then(
      json<{ presets: McpPreset[]; allowInlineLocal: boolean; allowInlineHttp: boolean }>,
    );
  },

  /** 非流式：一问一答 */
  chat(sessionId: string, prompt: string, model?: string): Promise<{ sessionId: string; content: string }> {
    return fetch(`${API_BASE}/api/sessions/${sessionId}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, streaming: false, model }),
    }).then(json<{ sessionId: string; content: string }>);
  },

  /**
   * 流式：SSE，回调 onDelta 增量更新。
   * 后端事件：delta {delta} / message {content} / subagent {全量事件} / done / error
   */
  chatStream(
    sessionId: string,
    prompt: string,
    callbacks: {
      onDelta: (d: string) => void;
      onSubagent?: (e: SubagentEvent) => void;
      onDone?: () => void;
      onError?: (e: Error) => void;
    },
    model?: string,
  ): void {
    fetch(`${API_BASE}/api/sessions/${sessionId}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ prompt, streaming: true, model }),
    })
      .then(async (res) => {
        if (!res.ok || !res.body) {
          const text = await res.text().catch(() => res.statusText);
          throw new Error(`HTTP ${res.status}: ${text}`);
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';

        const dispatch = (raw: string) => {
          // 按 SSE frame 切分：event: x \n data: {...}
          const frames = raw.split('\n\n');
          for (const frame of frames.slice(0, -1)) {
            const eventMatch = frame.match(/^event:\s*(.+)$/m);
            const dataMatch = frame.match(/^data:\s*(.+)$/m);
            if (!eventMatch || !dataMatch) continue;
            const event = eventMatch[1].trim();
            let data: { delta?: string; content?: string; error?: string };
            try {
              data = JSON.parse(dataMatch[1]);
            } catch {
              continue;
            }
            if (event === 'delta' && data.delta) callbacks.onDelta(data.delta);
            if (event === 'message' && data.content) callbacks.onDelta(data.content);
            if (event === 'subagent') {
              try {
                callbacks.onSubagent?.(JSON.parse(dataMatch[1]) as SubagentEvent);
              } catch {
                // 忽略解析失败的 subagent 帧
              }
            }
            if (event === 'done') callbacks.onDone?.();
            if (event === 'error') callbacks.onError?.(new Error(data.error ?? 'stream error'));
          }
          return frames[frames.length - 1];
        };

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          buf = dispatch(buf);
        }
        dispatch(buf + '\n\n');
        callbacks.onDone?.();
      })
      .catch((e: unknown) => callbacks.onError?.(e instanceof Error ? e : new Error(String(e))));
  },
};

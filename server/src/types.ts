export interface HealthResponse {
  status: 'ok';
  uptime: number;
  timestamp: string;
  copilot: 'connected' | 'disconnected' | 'error';
  copilotError?: string;
}

export interface CustomAgentBody {
  name: string;
  prompt: string;
  displayName?: string;
  description?: string;
  tools?: string[] | null;
  infer?: boolean;
  skills?: string[];
  model?: string;
}

export interface McpServerBody {
  type?: 'local' | 'stdio' | 'http' | 'sse';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  /** local 工作目录（映射为 SDK 的 workingDirectory） */
  cwd?: string;
  workingDirectory?: string;
  url?: string;
  headers?: Record<string, string>;
  tools?: string[];
  timeout?: number;
}

export interface CreateSessionBody {
  model?: string;
  systemMessage?: string;
  /** 自定义可恢复 ID（推荐 user-xxx-task-yyy 结构；缺省随机生成则不可恢复） */
  sessionId?: string;
  /** 预设 agent 名（缺省=全部；显式 []=不挂） */
  agents?: string[];
  /** 内联完整 agent 定义 */
  customAgents?: CustomAgentBody[];
  /** 建会话即激活的 agent（须匹配其一） */
  agent?: string;
  /** 额外技能目录（内置 server/skills 默认带上） */
  skillDirs?: string[];
  disabledSkills?: string[];
  noBuiltinSkills?: boolean;
  defaultAgentExcludedTools?: string[];
  /** 启用的 MCP 预设名（缺省=全部默认启用；显式 []=全关） */
  mcp?: string[];
  /** 内联自定义 MCP（local 默认被安全门拒绝） */
  mcpServers?: Record<string, McpServerBody>;
  /** 本次不启动的 MCP（精确匹配） */
  disabledMcpServers?: string[];
  /** 启用的 hook 预设名（缺省=默认启用项；显式 []=全关） */
  hooks?: string[];
  /** 启动时注入的附加上下文（自动启用 session-context 预设） */
  sessionContext?: string;
  /** agent 自然停机前的检查项（自动启用 stop-guard，block 一次继续） */
  agentStopChecklist?: string;
}

/** resume 与 create 共用全部配置项，只是 sessionId 来自路径 */
export type ResumeSessionBody = Omit<CreateSessionBody, 'sessionId'>;

export interface ChatBody {
  prompt: string;
  /** 为 true 时走 SSE 流式返回 */
  streaming?: boolean;
  model?: string;
}

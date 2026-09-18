import 'dotenv/config';
import os from 'node:os';
import path from 'node:path';

function env(name: string, fallback = ''): string {
  return process.env[name] ?? fallback;
}

const LOG_LEVELS = ['none', 'error', 'warning', 'info', 'debug', 'all'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/** 非法值直接抛错、不静默回退（否则“开了 debug 却没日志”极难排查） */
function parseLogLevel(raw: string): LogLevel | undefined {
  const v = raw.trim();
  if (!v) return undefined;
  if ((LOG_LEVELS as readonly string[]).includes(v)) return v as LogLevel;
  throw new Error(`COPILOT_LOG_LEVEL 非法："${raw}"，可选：${LOG_LEVELS.join(' | ')}（留空=SDK 默认）`);
}

/** 逗号分隔列表（空=未配置） */
function parseList(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export const config = {
  port: Number(env('PORT', '3001')),
  corsOrigin: env('CORS_ORIGIN', 'http://localhost:5173'),
  githubToken: env('GITHUB_TOKEN', '') || undefined,
  defaultModel: env('COPILOT_MODEL', 'gpt-5'),
  // --- Workspace 隔离：每 session 一独立目录（K8s 设 /workspaces；本地默认系统临时目录下） ---
  workspaceRoot: env('COPILOT_WORKSPACE_ROOT', '') || path.join(os.tmpdir(), 'copilot-workspaces'),
  /** 模型通道：copilot（GitHub 认证）| deepseek（BYOK） */
  provider: env('COPILOT_PROVIDER', 'copilot'),
  // --- DeepSeek BYOK（api key 一律从 .env 读入，不进代码） ---
  deepseekApiKey: env('DEEPSEEK_API_KEY', '') || undefined,
  deepseekModel: env('DEEPSEEK_MODEL', 'deepseek-v4-flash'),
  deepseekBaseUrl: env('DEEPSEEK_BASE_URL', 'https://api.deepseek.com/v1'),
  // --- 会话持久化：服务端 idle 超时（秒，0=关闭，无活动超时后 runtime 自动回收） ---
  sessionIdleTimeoutSeconds: Number(env('COPILOT_SESSION_IDLE_TIMEOUT', '0')) || undefined,
  // --- Runtime 连接：留空=SDK 自己拉起本地 runtime；K8s sidecar/远端填 http://127.0.0.1:4321 ---
  runtimeUrl: env('COPILOT_RUNTIME_URL', '') || undefined,
  // --- 本地 runtime 的数据目录（透传为 SDK baseDirectory → COPILOT_HOME；forUri 时被 runtime 侧忽略） ---
  // 缺省 ~/.copilot（与 runtime 默认一致；mode: "empty" 要求 client 级别显式设置，不可留空）
  baseDirectory: env('COPILOT_HOME', '') || path.join(os.homedir(), '.copilot'),
  // --- 技能目录 allowlist（逗号分隔；留空=本地开发模式不限制；生产必须配） ---
  skillRoots: parseList(env('COPILOT_SKILL_ROOTS', '')),
  // --- 管理接口令牌（留空=不设防本地开发；生产设置后 /api/debug、/api/hooks 需带 x-admin-token） ---
  adminToken: env('COPILOT_ADMIN_TOKEN', '') || undefined,
  // --- MCP：filesystem 预设开关与授权目录（生产默认关；开则必须配 COPILOT_MCP_FS_DIR） ---
  mcpFilesystem: env('COPILOT_MCP_FILESYSTEM', 'false') === 'true',
  mcpFsDir: env('COPILOT_MCP_FS_DIR', '') || undefined,
  /** 运维预置的额外 MCP servers（JSON，如 {"github":{"type":"http","url":"...","headers":{...}}}） */
  mcpServersJson: env('COPILOT_MCP_SERVERS', ''),
  /** 是否允许前端请求内联 local/stdio MCP（= 在服务器上执行任意命令，默认关） */
  allowInlineMcpLocal: env('COPILOT_ALLOW_INLINE_MCP_LOCAL', 'false') === 'true',
  /** 是否允许前端请求内联 http/sse MCP（默认关；生产只用运维预置的 COPILOT_MCP_SERVERS） */
  allowInlineMcpHttp: env('COPILOT_ALLOW_INLINE_MCP_HTTP', 'false') === 'true',
  // --- 调试（对应官方 debugging 文档）：SDK 日志级别 + CLI 日志目录 + CLI 路径 ---
  logLevel: parseLogLevel(env('COPILOT_LOG_LEVEL', '')),
  logDir: env('COPILOT_LOG_DIR', '') || undefined,
  cliPath: env('COPILOT_CLI_PATH', '') || undefined,
};

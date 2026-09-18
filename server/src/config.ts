import 'dotenv/config';

function env(name: string, fallback = ''): string {
  return process.env[name] ?? fallback;
}

export const config = {
  port: Number(env('PORT', '3001')),
  corsOrigin: env('CORS_ORIGIN', 'http://localhost:5173'),
  githubToken: env('GITHUB_TOKEN', '') || undefined,
  defaultModel: env('COPILOT_MODEL', 'gpt-5'),
  workingDirectory: env('COPILOT_WORKING_DIRECTORY', '') || undefined,
  /** 模型通道：copilot（GitHub 认证）| deepseek（BYOK） */
  provider: env('COPILOT_PROVIDER', 'copilot'),
  // --- DeepSeek BYOK（api key 一律从 .env 读入，不进代码） ---
  deepseekApiKey: env('DEEPSEEK_API_KEY', '') || undefined,
  deepseekModel: env('DEEPSEEK_MODEL', 'deepseek-v4-flash'),
  deepseekBaseUrl: env('DEEPSEEK_BASE_URL', 'https://api.deepseek.com/v1'),
  // --- 会话持久化：服务端 idle 超时（秒，0=关闭，无活动超时后 runtime 自动回收） ---
  sessionIdleTimeoutSeconds: Number(env('COPILOT_SESSION_IDLE_TIMEOUT', '0')) || undefined,
  // --- MCP：filesystem 预设开关与授权目录（agent 已有 view/edit，默认开，限定在本仓库） ---
  mcpFilesystem: env('COPILOT_MCP_FILESYSTEM', 'true') === 'true',
  mcpFsDir: env('COPILOT_MCP_FS_DIR', '') || undefined,
  /** 运维预置的额外 MCP servers（JSON，如 {"github":{"type":"http","url":"...","headers":{...}}}） */
  mcpServersJson: env('COPILOT_MCP_SERVERS', ''),
  /** 是否允许前端请求内联 local/stdio MCP（= 在服务器上执行任意命令，默认关） */
  allowInlineMcpLocal: env('COPILOT_ALLOW_INLINE_MCP_LOCAL', 'false') === 'true',
  /** 是否允许前端请求内联 http/sse MCP（默认开；header 密钥由调用方自带） */
  allowInlineMcpHttp: env('COPILOT_ALLOW_INLINE_MCP_HTTP', 'true') === 'true',
};

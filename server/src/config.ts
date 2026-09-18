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

/** bash 授权策略：workspace=命令涉及的路径必须在 session workspace 内（默认）；allow=全放行；deny=全拒 */
const BASH_POLICIES = ['workspace', 'allow', 'deny'] as const;
export type BashPolicy = (typeof BASH_POLICIES)[number];

function parseBashPolicy(raw: string): BashPolicy {
  const v = raw.trim() || 'workspace';
  if ((BASH_POLICIES as readonly string[]).includes(v)) return v as BashPolicy;
  throw new Error(`COPILOT_BASH_POLICY 非法："${raw}"，可选：${BASH_POLICIES.join(' | ')}`);
}

/**
 * Durable state 连接的 scheme 校验。
 * 留空=内存实现。一旦给了值就当作生产连接串：占位值/拼错的 scheme 会让服务切到 PG 模式
 * 却连不上，启动即失败比“上线后审批全 500”好排查。
 */
function parseDatabaseUrl(raw: string): string | undefined {
  const v = raw.trim();
  if (!v) return undefined;
  if (!/^postgres(ql)?:\/\//i.test(v)) {
    throw new Error(`DATABASE_URL 非法：必须以 postgres:// 或 postgresql:// 开头（留空=内存实现）`);
  }
  return v;
}

const homeDir = env('COPILOT_HOME', '') || path.join(os.homedir(), '.copilot');

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
  /** 启动时后台预热 runtime（首屏徽章与首个会话不用等 CLI 拉起；设 false 则纯懒加载） */
  warmup: env('COPILOT_WARMUP', 'true') === 'true',
  // --- 本地 runtime 的数据目录（透传为 SDK baseDirectory → COPILOT_HOME；forUri 时被 runtime 侧忽略） ---
  // 缺省 ~/.copilot（与 runtime 默认一致；mode: "empty" 要求 client 级别显式设置，不可留空）
  baseDirectory: homeDir,
  // --- Session Registry：ownership 持久化（重启/换 Pod 后归属不丢；K8s 指到 PVC 上的路径） ---
  // 缺省落在 baseDirectory 同目录，生产必须指到持久卷（否则重启后归属丢失 = 谁先访问谁认领）
  registryPath: env('COPILOT_REGISTRY_PATH', '') || path.join(homeDir, 'session-registry.json'),
  // --- 身份头可信开关：只有网关/IAP 会剥离客户端自带 x-tenant-id/x-user-id 时才可开 ---
  // 关闭（默认）= 单租户模式，所有请求按 DEFAULT_OWNER 处理，避免客户端自报身份越过归属校验
  trustIdentityHeaders: env('COPILOT_TRUST_IDENTITY_HEADERS', 'false') === 'true',
  // --- 工具授权策略（取代 approveAll）：write 恒限制在 workspace；bash 按此策略 ---
  bashPolicy: parseBashPolicy(env('COPILOT_BASH_POLICY', '')),
  /** URL 允许访问的域名 allowlist（逗号分隔；留空=任意公网地址，仍过 SSRF 检查） */
  urlAllowlist: parseList(env('COPILOT_URL_ALLOWLIST', '')),
  // --- 技能目录 allowlist（逗号分隔；留空=本地开发模式不限制；生产必须配） ---
  skillRoots: parseList(env('COPILOT_SKILL_ROOTS', '')),
  // --- 执行审计：execution / tool evidence 的字段预览上限与内存保留量 ---
  /** 单条 tool 参数/结果预览的最大字符数（超出只记长度，不保内容） */
  evidenceMaxChars: Number(env('COPILOT_EVIDENCE_MAX_CHARS', '2000')) || 2000,
  /** 内存保留的 execution 条数（超出按插入顺序淘汰最旧的） */
  maxTrackedExecutions: Number(env('COPILOT_MAX_TRACKED_EXECUTIONS', '200')) || 200,
  /** 单个 execution 最多记多少条 tool call（超出只累加计数） */
  maxToolCallsPerExecution: Number(env('COPILOT_MAX_TOOL_CALLS', '100')) || 100,
  // --- 管理接口令牌（留空=不设防本地开发；生产设置后 /api/debug、/api/hooks 需带 x-admin-token） ---
  adminToken: env('COPILOT_ADMIN_TOKEN', '') || undefined,
  // --- Durable state：execution / human task / approval / event / session ownership 的持久真相源 ---
  // 留空=内存实现（单副本、重启即丢，仅适合本地开发）；生产配 PostgreSQL 连接串
  databaseUrl: parseDatabaseUrl(env('DATABASE_URL', '')),
  /** 全进程同时运行的 agent turn 上限（0=不限；防止 N 个用户同时烧满 runtime CPU） */
  maxConcurrentExecutions: Number(env('COPILOT_MAX_CONCURRENT_EXECUTIONS', '0')) || 0,
  /** Human Task 默认 TTL（秒；0=不过期）。到期 OPEN → EXPIRED，execution 随之 EXPIRED */
  humanTaskTtlSeconds: Number(env('COPILOT_HUMAN_TASK_TTL', '86400')) || 0,
  /** 过期扫描间隔（秒） */
  humanTaskSweepSeconds: Number(env('COPILOT_HUMAN_TASK_SWEEP', '60')) || 60,
  /** 是否允许发起人审批自己发起的 action（Separation of Duties；默认否） */
  allowInitiatorApproval: env('COPILOT_ALLOW_INITIATOR_APPROVAL', 'false') === 'true',
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

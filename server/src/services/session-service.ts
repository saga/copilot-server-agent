import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { CopilotClient, RuntimeConnection } from '@github/copilot-sdk';
import type {
  CopilotSession,
  CustomAgentConfig,
  MCPServerConfig,
  ModelInfo,
  SessionMetadata,
} from '@github/copilot-sdk';
import { config } from '../config.js';
import { getActiveProvider } from '../providers/index.js';
import { BUILTIN_AGENTS, resolveBuiltinAgents } from '../agents/builtin.js';
import {
  discoverSkills,
  resolveSkillDirectories,
  type SkillMeta,
} from '../skills/index.js';
import { resolveMcp, listMcp } from '../mcp/registry.js';
import { resolveHooks } from '../hooks/registry.js';
import { hookEventCount } from '../hooks/events.js';
import { HOOK_PRESETS } from '../hooks/builtin.js';
import { workspaceService } from './workspace-service.js';
import {
  SessionRegistry,
  type RegistryRecord,
  type SessionOwner,
} from './session-registry.js';
import { createPermissionHandler, createPreToolUseGuard } from './tool-policy.js';

export type { SessionOwner, RegistryRecord };

const require = createRequire(import.meta.url);

function sdkVersion(): string {
  // SDK 的 exports 映射未暴露 ./package.json，从入口文件向上找包根再读版本
  try {
    let dir = path.dirname(require.resolve('@github/copilot-sdk'));
    for (let i = 0; i < 4; i++) {
      try {
        const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf-8')) as {
          name?: string;
          version?: string;
        };
        if (pkg.name === '@github/copilot-sdk') return pkg.version ?? 'unknown';
      } catch {
        // 继续向上找
      }
      dir = path.dirname(dir);
    }
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** 自定义 sessionId 规则（对应文档“结构化 ID 便于审计/清理”：字母数字开头，允许 -_） */
const SESSION_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9-_]{0,127}$/;

export function assertValidSessionId(id: string): void {
  if (!SESSION_ID_RE.test(id)) {
    throw new Error(
      `sessionId 非法："${id}"（须字母数字开头，仅含字母/数字/-/_，最长 128 字符；推荐 user-xxx-task-yyy 结构）`,
    );
  }
}

/** 内存态 session 记录（registry 是持久真相源；这里只做进程内缓存） */
export interface SessionRecord {
  sessionId: string;
  tenantId: string;
  userId: string;
  workspacePath: string;
}

export const DEFAULT_OWNER: SessionOwner = { tenantId: 'default', userId: 'default' };

/** 身份头只有在网关会剥离客户端自带头时才可信；否则一律按单租户处理 */
let identityWarned = false;

export function ownerFromHeaders(h: Record<string, unknown>): SessionOwner {
  if (!config.trustIdentityHeaders) {
    if ((h['x-tenant-id'] || h['x-user-id']) && !identityWarned) {
      identityWarned = true;
      console.warn(
        '[session] 收到 x-tenant-id/x-user-id 但 COPILOT_TRUST_IDENTITY_HEADERS=false，已忽略（按单租户处理）',
      );
    }
    return { ...DEFAULT_OWNER };
  }
  const pick = (v: unknown, fallback: string): string => {
    if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 128);
    if (Array.isArray(v) && typeof v[0] === 'string' && v[0].trim()) {
      return v[0].trim().slice(0, 128);
    }
    return fallback;
  };
  return {
    tenantId: pick(h['x-tenant-id'], DEFAULT_OWNER.tenantId),
    userId: pick(h['x-user-id'], DEFAULT_OWNER.userId),
  };
}

export interface SessionConfigOptions {
  model?: string;
  systemMessage?: string;
  /** 预设 agent 名（缺省=全部；显式 []=不挂）。未知名字抛错 */
  agents?: string[];
  /** 内联完整 agent 定义（追加到预设之后） */
  customAgents?: CustomAgentConfig[];
  /** 建会话即激活的 agent，必须匹配 customAgents 中的 name */
  agent?: string;
  /** 额外技能目录（内置 server/skills 默认带上） */
  skillDirs?: string[];
  disabledSkills?: string[];
  /** 为 true 则不加载内置技能 */
  noBuiltinSkills?: boolean;
  /** 从默认 agent 隐藏的工具（仍可被 sub-agent 使用） */
  defaultAgentExcludedTools?: string[];
  /** 启用的 MCP 预设名（缺省=全部默认启用；显式 []=全关） */
  mcp?: string[];
  /** 内联自定义 MCP servers（local 默认被安全门拒绝，见 registry） */
  mcpServers?: Record<string, MCPServerConfig>;
  /** 本次不启动的 MCP server 名（精确匹配） */
  disabledMcpServers?: string[];
  /** 启用的 hook 预设名（缺省=默认启用项；显式 []=全关） */
  hooks?: string[];
  /** 启动时注入的附加上下文（自动启用 session-context 预设） */
  sessionContext?: string;
  /** agent 自然停机前的检查项（自动启用 stop-guard，block 一次继续） */
  agentStopChecklist?: string;
}

export interface CreateSessionOptions extends SessionConfigOptions {
  /** 自定义可恢复 ID（缺省由 SDK 随机生成，则不可恢复） */
  sessionId?: string;
}

export interface DebugInfo {
  timestamp: string;
  node: string;
  platform: string;
  sdkVersion: string;
  provider: string;
  runtime: {
    state: 'connected' | 'disconnected' | 'error';
    lastError?: string;
    startError?: string;
    pingMs?: number;
    pingError?: string;
    cli?: { version: string; protocolVersion: number };
    cliError?: string;
    auth?: { isAuthenticated: boolean; authType?: string };
    authError?: string;
  };
  config: {
    logLevel: string;
    logDir?: string;
    cliPath?: string;
    sessionIdleTimeoutSeconds?: number;
    runtimeUrl?: string;
    baseDirectory: string;
    workspaceRoot: string;
  };
  sessions: { attached: number; attachedIds: string[]; onDisk: number | null; listError?: string };
  hooks: { presets: number; recentEvents: number };
  mcp: { presets: number; allowInlineLocal: boolean; allowInlineHttp: boolean };
}

/**
 * session-level 工具 allowlist（mode: "empty" 要求每个会话显式声明 availableTools；
 * 也是 SDK #2356 workaround：customAgents.tools 在特定 server/runtime 组合下会“显示选中
 * 但模型拿不到”，session-level availableTools 才是可靠的生效层）。
 * customAgents[].tools 保持为其子集（两层模型：session=最大集合，agent=子集）。
 */
export const BUILTIN_TOOLS = ['grep', 'glob', 'view', 'edit', 'bash'];

/**
 * Copilot 会话服务（单例）。
 * - Express 启动时 lazy 初始化 CopilotClient
 * - 每个前端会话对应一个 CopilotSession，用 Map 做内存管理（生产可换 Redis）
 */
class SessionService {
  private client: CopilotClient | null = null;
  private starting: Promise<CopilotClient> | null = null;
  private sessions = new Map<string, CopilotSession>();
  private owners = new Map<string, SessionRecord>();
  /** session 并发锁：同一 session 的 agent turn 串行化（进程内实现；多副本部署需换分布式锁） */
  private sessionLocks = new Map<string, Promise<unknown>>();
  /** attach 专用锁：resume 只允许一个 request 真正执行（与 chat lock 分开，避免互相阻塞） */
  private attachLocks = new Map<string, Promise<unknown>>();
  /** 正在跑 agent turn 的 session（客户端断开时按此决定是否 abort） */
  private activeTurns = new Set<string>();
  /** 持久归属表（重启后不丢；生产应换 PostgreSQL，见 README） */
  private readonly registry = new SessionRegistry(config.registryPath);
  private lastError: string | null = null;

  async getClient(): Promise<CopilotClient> {
    if (this.client) return this.client;
    if (this.starting) return this.starting;

    this.starting = (async () => {
      const provider = getActiveProvider();
      const customModels = provider.getCustomModels();
      // 多租户 server 安全基线：mode "empty" 关掉 CLI 风格 ambient tools/host filesystem，
      // 工具集由每个 session 的 availableTools 显式声明。
      const clientOptions: ConstructorParameters<typeof CopilotClient>[0] = {
        mode: 'empty',
        // 无活动超时后 runtime 自动回收（0/缺省=关闭，默认会话常驻）
        ...(config.sessionIdleTimeoutSeconds
          ? { sessionIdleTimeoutSeconds: config.sessionIdleTimeoutSeconds }
          : {}),
        // 调试：SDK 日志级别（none/error/warning/info/debug/all，缺省=SDK 默认）
        ...(config.logLevel ? { logLevel: config.logLevel } : {}),
        // BYOK：CLI 不知道第三方模型，按官方文档用 onListModels 自报
        ...(customModels ? { onListModels: () => customModels } : {}),
      };

      if (config.runtimeUrl) {
        // K8s/远端：连外部 headless runtime（COPILOT_HOME 配在 runtime 那边，本侧 baseDirectory 被忽略）
        clientOptions.connection = RuntimeConnection.forUri(config.runtimeUrl);
      } else {
        // 本地：SDK 自己拉起 runtime（工作目录是 session 级的，这里不再设 client 默认）
        Object.assign(clientOptions, {
          gitHubToken: config.githubToken,
          // 未提供 token 时默认使用 copilot CLI 已登录用户
          useLoggedInUser: config.githubToken ? false : true,
          // 会话持久化目录（mode: "empty" 强制要求；缺省 ~/.copilot，与 runtime 默认一致）
          baseDirectory: config.baseDirectory,
          // 调试：自定义 CLI 路径 / 日志目录时才显式建 connection，
          // 否则走 SDK 默认（自动 materialize 内置 runtime）
          ...(config.cliPath || config.logDir
            ? {
                connection: RuntimeConnection.forStdio({
                  ...(config.cliPath ? { path: config.cliPath } : {}),
                  ...(config.logDir ? { args: ['--log-dir', config.logDir] } : {}),
                }),
              }
            : {}),
        });
      }

      const client = new CopilotClient(clientOptions);
      await client.start();
      this.client = client;
      this.lastError = null;
      this.starting = null;
      return client;
    })().catch((err) => {
      this.starting = null;
      this.lastError = err instanceof Error ? err.message : String(err);
      throw err;
    });

    return this.starting;
  }

  getStatus(): 'connected' | 'disconnected' | 'error' {
    if (this.client) return 'connected';
    if (this.lastError) return 'error';
    return 'disconnected';
  }

  getLastError(): string | null {
    return this.lastError;
  }

  /**
   * 诊断包（对应官方 debugging 文档“收集调试信息”清单）：
   * 版本 / 平台 / 脱敏配置 / runtime 状态（ping 延迟、CLI 版本、认证状态）/ 会话计数。
   * 会按需启动 runtime（顺带把 CLI 缺失/认证失败等问题暴露出来）；密钥类字段永不包含。
   */
  async getDebugInfo(): Promise<DebugInfo> {
    const info: DebugInfo = {
      timestamp: new Date().toISOString(),
      node: process.version,
      platform: `${process.platform}-${process.arch}`,
      sdkVersion: sdkVersion(),
      provider: getActiveProvider().id,
      runtime: { state: this.getStatus(), ...(this.lastError ? { lastError: this.lastError } : {}) },
      config: {
        logLevel: config.logLevel ?? '(sdk default)',
        ...(config.logDir ? { logDir: config.logDir } : {}),
        ...(config.cliPath ? { cliPath: config.cliPath } : {}),
        ...(config.sessionIdleTimeoutSeconds
          ? { sessionIdleTimeoutSeconds: config.sessionIdleTimeoutSeconds }
          : {}),
        ...(config.runtimeUrl ? { runtimeUrl: config.runtimeUrl } : {}),
        baseDirectory: config.baseDirectory,
        workspaceRoot: config.workspaceRoot,
      },
      sessions: { attached: this.sessions.size, attachedIds: [...this.sessions.keys()], onDisk: null },
      hooks: { presets: HOOK_PRESETS.length, recentEvents: hookEventCount() },
      mcp: {
        presets: listMcp().presets.length,
        allowInlineLocal: config.allowInlineMcpLocal,
        allowInlineHttp: config.allowInlineMcpHttp,
      },
    };
    try {
      const client = await this.getClient();
      info.runtime.state = this.getStatus();
      if (this.lastError) info.runtime.lastError = this.lastError;
      const t0 = Date.now();
      try {
        await client.ping('debug');
        info.runtime.pingMs = Date.now() - t0;
      } catch (e) {
        info.runtime.pingError = errMsg(e);
      }
      try {
        info.runtime.cli = await client.getStatus();
      } catch (e) {
        info.runtime.cliError = errMsg(e);
      }
      try {
        info.runtime.auth = await client.getAuthStatus();
      } catch (e) {
        info.runtime.authError = errMsg(e);
      }
      try {
        info.sessions.onDisk = (await client.listSessions()).length;
      } catch (e) {
        info.sessions.listError = errMsg(e);
      }
    } catch (e) {
      info.runtime.startError = errMsg(e);
    }
    return info;
  }

  async listModels(): Promise<{ provider: string; models: unknown }> {
    const provider = getActiveProvider();
    const custom = provider.getCustomModels();
    if (custom) return { provider: provider.id, models: custom satisfies ModelInfo[] };
    const client = await this.getClient();
    // SDK 通过 client.listModels() 暴露可用模型
    const maybe = client as unknown as { listModels?: () => Promise<unknown> };
    const models = typeof maybe.listModels === 'function' ? await maybe.listModels() : [];
    return { provider: provider.id, models };
  }

  /**
   * create 与 resume 共用的会话配置装配。
   * 注意 BYOK 恢复必须重传 provider（key 从不落盘）：这里每次都从当前 provider 现算，
   * 所以 resume 无需调用方操心，换通道后 resume 会自动用新通道凭证。
   * workspaceDir 必传：session 级 workingDirectory + workspace 级 MCP 根，1 session = 1 目录。
   */
  private buildSessionConfig(sessionId: string, opts: SessionConfigOptions, workspaceDir: string) {
    // 经当前 provider 解析：补默认 model、BYOK 拼 ProviderConfig
    const resolved = getActiveProvider().resolve(opts);
    // agents：预设按名引用 + 内联定义；agent 预选必须命中其一
    const customAgents = [...resolveBuiltinAgents(opts.agents), ...(opts.customAgents ?? [])];
    if (opts.agent && !customAgents.some((a) => a.name === opts.agent)) {
      throw new Error(
        `agent="${opts.agent}" 不存在，可选：${customAgents.map((a) => a.name).join(', ') || '(本次未挂载任何 agent)'}；请先在 agents/customAgents 中定义`,
      );
    }
    // skills：内置 server/skills 默认带上 + 额外目录（不存在直接抛错）
    const skillDirectories = resolveSkillDirectories({
      extra: opts.skillDirs,
      includeBuiltin: !opts.noBuiltinSkills,
    });
    // MCP：预设按名启用 + 内联自定义（local/http 各有安全门；filesystem 根跟随 workspace）
    const { mcpServers } = resolveMcp({
      enable: opts.mcp,
      inline: opts.mcpServers,
      workspaceDir,
    });
    // 授权上下文：write/shell 限制在 workspace、MCP 只放行本次启用的 server
    const policyCtx = {
      sessionId,
      workspacePath: workspaceDir,
      mcpServers: mcpServers ? Object.keys(mcpServers) : [],
    };
    // Hooks：预设按名启用；传 sessionContext/agentStopChecklist 自动启用对应预设；
    // workspace 守卫（onPreToolUse）为强制项，请求无法关闭
    const { hooks } = resolveHooks({
      enable: opts.hooks,
      sessionContext: opts.sessionContext,
      agentStopChecklist: opts.agentStopChecklist,
      extraHooks: { onPreToolUse: createPreToolUseGuard(policyCtx) },
    });
    return {
      model: resolved.model,
      ...(resolved.provider ? { provider: resolved.provider } : {}),
      streaming: true,
      // session 独立工作目录（软隔离：默认 cwd；硬隔离需要 per-request container）
      workingDirectory: workspaceDir,
      // session 最大工具集合（mode: "empty" 必填；agent.tools 必须为其子集，见 #2356 说明）
      availableTools: BUILTIN_TOOLS,
      onPermissionRequest: createPermissionHandler(policyCtx),
      ...(resolved.systemMessage ? { systemMessage: resolved.systemMessage } : {}),
      ...(customAgents.length ? { customAgents } : {}),
      ...(opts.agent ? { agent: opts.agent } : {}),
      ...(skillDirectories.length ? { skillDirectories } : {}),
      ...(opts.disabledSkills?.length ? { disabledSkills: opts.disabledSkills } : {}),
      ...(opts.defaultAgentExcludedTools?.length
        ? { defaultAgent: { excludedTools: opts.defaultAgentExcludedTools } }
        : {}),
      ...(mcpServers ? { mcpServers } : {}),
      // 精确禁用的 MCP servers（本次不启动、不鉴权；常驻 resume 无法撤销已启动的）
      ...(opts.disabledMcpServers?.length ? { disabledMcpServers: opts.disabledMcpServers } : {}),
      ...(hooks ? { hooks } : {}),
    };
  }

  /**
   * 1 request = 1 session = 1 workspace。
   * 未传 sessionId 时服务端生成 UUID（SDK 可恢复 ID），所有会话天然可 resume。
   */
  async createSession(opts: CreateSessionOptions, owner: SessionOwner = DEFAULT_OWNER): Promise<CopilotSession> {
    const client = await this.getClient();
    const sessionId = opts.sessionId ?? randomUUID();
    assertValidSessionId(sessionId);
    const workspaceDir = await workspaceService.create(sessionId);
    const session = await client.createSession({
      ...this.buildSessionConfig(sessionId, opts, workspaceDir),
      sessionId,
    });
    this.sessions.set(session.sessionId, session);
    this.owners.set(session.sessionId, {
      sessionId: session.sessionId,
      tenantId: owner.tenantId,
      userId: owner.userId,
      workspacePath: workspaceDir,
    });
    // 归属落持久表：重启后不会退化成“谁先访问谁认领”
    await this.registry.upsert({ sessionId: session.sessionId, owner, workspacePath: workspaceDir });
    return session;
  }

  /**
   * 恢复磁盘上的会话（服务重启/换实例后继续），回到同一 workspace。
   * 若内存里已有同 id 的附着会话则直接复用，避免同一会话双附着（文档：并发访问未定义）。
   */
  async resumeSession(
    sessionId: string,
    opts: SessionConfigOptions,
    owner: SessionOwner = DEFAULT_OWNER,
  ): Promise<CopilotSession> {
    assertValidSessionId(sessionId);
    const attached = this.sessions.get(sessionId);
    if (attached) {
      await this.assertOwnership(sessionId, owner);
      return attached;
    }
    const client = await this.getClient();
    // workspace 路径是 sessionId 的确定性函数：resume 永远回到同一目录
    const workspaceDir = await workspaceService.create(sessionId);
    // resume 前先过归属校验（官方 multi-tenancy：session id 本身不构成访问边界）
    await this.assertOwnership(sessionId, owner, workspaceDir);
    try {
      const session = await client.resumeSession(
        sessionId,
        this.buildSessionConfig(sessionId, opts, workspaceDir),
      );
      this.sessions.set(session.sessionId, session);
      this.owners.set(session.sessionId, {
        sessionId: session.sessionId,
        tenantId: owner.tenantId,
        userId: owner.userId,
        workspacePath: workspaceDir,
      });
      return session;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/not found|no such|unknown session|does not exist/i.test(msg)) {
        throw new Error(`session 不存在（无法恢复）："${sessionId}"。${msg}`);
      }
      throw err;
    }
  }

  /**
   * 内存未附着时尝试从 runtime 磁盘状态恢复（跨 Pod/重启后的 resume-on-miss）。
   * 恢复失败抛“无法恢复”（调用方按 404 处理）。
   */
  async getOrResumeSession(
    sessionId: string,
    opts: SessionConfigOptions,
    owner: SessionOwner = DEFAULT_OWNER,
  ): Promise<CopilotSession> {
    assertValidSessionId(sessionId);
    const attached = this.sessions.get(sessionId);
    if (attached) {
      await this.assertOwnership(sessionId, owner);
      return attached;
    }
    // attach lock：并发首访只允许一个 request 真正 resume，其余复用同一个 session object
    // （“检查 sessions 是否有” 与 “真正 resume” 之间必须原子，否则会双附着同一 runtime session）
    return this.withAttachLock(sessionId, async () => {
      const again = this.sessions.get(sessionId);
      if (again) {
        await this.assertOwnership(sessionId, owner);
        return again;
      }
      return this.resumeSession(sessionId, opts, owner);
    });
  }

  /** 同一 session 的 agent turn 串行化（进程内锁；多副本部署需换分布式锁） */
  async withSessionLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.sessionLocks.get(sessionId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(fn);
    this.sessionLocks.set(sessionId, current);
    try {
      return await current;
    } finally {
      if (this.sessionLocks.get(sessionId) === current) {
        this.sessionLocks.delete(sessionId);
      }
    }
  }

  /** resume 专用锁（与 chat lock 分开：attach 不该被正在跑的 turn 阻塞，反之亦然） */
  private async withAttachLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.attachLocks.get(sessionId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(fn);
    this.attachLocks.set(sessionId, current);
    try {
      return await current;
    } finally {
      if (this.attachLocks.get(sessionId) === current) {
        this.attachLocks.delete(sessionId);
      }
    }
  }

  /** 标记 turn 起止（客户端断开时据此决定是否 abort） */
  markTurnActive(sessionId: string): void {
    this.activeTurns.add(sessionId);
  }

  markTurnIdle(sessionId: string): void {
    this.activeTurns.delete(sessionId);
  }

  /** 中止当前 turn（不是断开 session；之后仍可继续对话） */
  async abortTurn(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    try {
      await session.abort();
      return true;
    } finally {
      this.activeTurns.delete(sessionId);
    }
  }

  getSessionOwner(sessionId: string): SessionRecord | undefined {
    return this.owners.get(sessionId);
  }

  /** 更新 lastUsedAt（chat 时调用；便于按活跃度清理） */
  touch(sessionId: string): Promise<void> {
    return this.registry.touch(sessionId);
  }

  /** 持久归属记录（跨重启真相源；GET /api/sessions 按此过滤） */
  async getRegistryRecord(sessionId: string): Promise<RegistryRecord | undefined> {
    return this.registry.get(sessionId);
  }

  /**
   * 归属校验：所有 session 操作（resume/chat/delete/list）统一走这里。
   * 无记录时仅在单租户（owner=default）下补登记，避免本地旧会话直接不可访问；
   * 多租户下无记录 = 无权访问（不再“谁先访问谁认领”）。
   */
  async assertOwnership(
    sessionId: string,
    owner: SessionOwner,
    workspacePath = workspaceService.pathFor(sessionId),
  ): Promise<void> {
    const isSingleTenant = this.isSingleTenant(owner);
    const record = await this.registry.assertAccess(sessionId, owner, {
      allowLegacyClaim: isSingleTenant,
      workspacePath,
    });
    this.owners.set(sessionId, {
      sessionId,
      tenantId: record.tenantId,
      userId: record.userId,
      workspacePath: record.workspacePath || workspacePath,
    });
  }

  /** 当前 owner 的会话（磁盘全量 ∩ registry 归属；不再返回所有人的会话） */
  async listSessions(
    owner: SessionOwner = DEFAULT_OWNER,
  ): Promise<(SessionMetadata & { attached: boolean })[]> {
    const client = await this.getClient();
    const mine = await this.registry.listByOwner(owner);
    const allowed = new Set(mine.map((r) => r.sessionId));
    const all = await client.listSessions();
    return all
      .filter((m) => allowed.has(m.sessionId))
      .map((m) => ({ ...m, attached: this.sessions.has(m.sessionId) }));
  }

  async getSessionMeta(
    sessionId: string,
    owner: SessionOwner = DEFAULT_OWNER,
  ): Promise<(SessionMetadata & { attached: boolean }) | null> {
    // 只读路径不认领：无归属记录时按无权处理（单租户除外，历史会话仍可读）
    const record = await this.registry.get(sessionId);
    if (record && (record.tenantId !== owner.tenantId || record.userId !== owner.userId)) {
      throw new Error(`无权访问 session："${sessionId}"`);
    }
    if (!record && !this.isSingleTenant(owner)) {
      throw new Error(`无权访问 session："${sessionId}"（无归属记录）`);
    }
    const client = await this.getClient();
    const all = await client.listSessions();
    const meta = all.find((m) => m.sessionId === sessionId);
    return meta ? { ...meta, attached: this.sessions.has(sessionId) } : null;
  }

  private isSingleTenant(owner: SessionOwner): boolean {
    return owner.tenantId === DEFAULT_OWNER.tenantId && owner.userId === DEFAULT_OWNER.userId;
  }

  /** 供 GET /api/agents：预设、内置技能目录、可发现的技能（无需启动 runtime） */
  listAgents(): { agents: CustomAgentConfig[]; skillDirectories: string[]; skills: SkillMeta[] } {
    const skillDirectories = resolveSkillDirectories({ extra: [], includeBuiltin: true });
    return {
      agents: BUILTIN_AGENTS,
      skillDirectories,
      skills: skillDirectories.flatMap((d) => discoverSkills(d)),
    };
  }

  getSession(sessionId: string): CopilotSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * 断开内存附着，释放资源但保留磁盘数据 → 之后仍可 resume。
   * 未附着时返回 false（调用方可视为“已不在内存”，照样可 resume）。
   */
  async disconnectSession(sessionId: string, owner?: SessionOwner): Promise<boolean> {
    // 与 agent turn 共用 session lock：等当前 turn 跑完再断，避免 agent 还在写文件时被拔掉
    return this.withSessionLock(sessionId, async () => {
      if (owner) await this.assertOwnership(sessionId, owner);
      const session = this.sessions.get(sessionId);
      if (!session) return false;
      try {
        await session.disconnect();
      } finally {
        this.sessions.delete(sessionId);
      }
      return true;
    });
  }

  /** @deprecated 用 disconnectSession（语义更准：断开不断数据） */
  async destroySession(sessionId: string): Promise<boolean> {
    return this.disconnectSession(sessionId);
  }

  /**
   * 彻底删除：先断开内存附着，再删磁盘全部数据 + workspace 目录 → 不可恢复。
   * 磁盘上不存在时 SDK 会抛错，调用方按 404 处理。
   */
  async deleteSessionPermanently(sessionId: string, owner?: SessionOwner): Promise<void> {
    assertValidSessionId(sessionId);
    // 同样排队在 session lock 之后：绝不在 agent turn 进行中删 runtime session 与 workspace
    await this.withSessionLock(sessionId, async () => {
      if (owner) await this.assertOwnership(sessionId, owner);
      await this.disconnectUnlocked(sessionId);
      const client = await this.getClient();
      try {
        await client.deleteSession(sessionId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/not found|no such|unknown session|does not exist/i.test(msg)) {
          throw new Error(`session 不存在（无法删除）："${sessionId}"`);
        }
        throw err;
      }
      this.owners.delete(sessionId);
      await this.registry.remove(sessionId);
      // workspace 清理失败只告警，不让整个删除 API 失败（避免孤儿 session 删不掉）
      try {
        await workspaceService.remove(sessionId);
      } catch (err) {
        console.warn(
          `[session] workspace 清理失败 ${sessionId}：${err instanceof Error ? err.message : String(err)}`,
        );
      }
    });
  }

  /** 锁内调用版本（deleteSessionPermanently 已持锁，避免重复取锁死锁） */
  private async disconnectUnlocked(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    try {
      await session.disconnect();
    } finally {
      this.sessions.delete(sessionId);
    }
    return true;
  }

  async stop() {
    for (const [, s] of this.sessions) {
      try {
        await s.disconnect();
      } catch {
        // ignore per-session errors on shutdown
      }
    }
    this.sessions.clear();
    this.owners.clear();
    this.sessionLocks.clear();
    this.attachLocks.clear();
    this.activeTurns.clear();
    if (this.client) {
      await this.client.stop();
      this.client = null;
    }
  }
}

export const sessionService = new SessionService();

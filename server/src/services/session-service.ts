import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { CopilotClient, RuntimeConnection, approveAll } from '@github/copilot-sdk';
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
    workingDirectory?: string;
  };
  sessions: { attached: number; attachedIds: string[]; onDisk: number | null; listError?: string };
  hooks: { presets: number; recentEvents: number };
  mcp: { presets: number; allowInlineLocal: boolean; allowInlineHttp: boolean };
}

/**
 * Copilot 会话服务（单例）。
 * - Express 启动时 lazy 初始化 CopilotClient
 * - 每个前端会话对应一个 CopilotSession，用 Map 做内存管理（生产可换 Redis）
 */
class SessionService {
  private client: CopilotClient | null = null;
  private starting: Promise<CopilotClient> | null = null;
  private sessions = new Map<string, CopilotSession>();
  private lastError: string | null = null;

  async getClient(): Promise<CopilotClient> {
    if (this.client) return this.client;
    if (this.starting) return this.starting;

    this.starting = (async () => {
      const provider = getActiveProvider();
      const customModels = provider.getCustomModels();
      const client = new CopilotClient({
        gitHubToken: config.githubToken,
        // 未提供 token 时默认使用 copilot CLI 已登录用户
        useLoggedInUser: config.githubToken ? false : true,
        workingDirectory: config.workingDirectory,
        // 无活动超时后 runtime 自动回收（0/缺省=关闭，默认会话常驻）
        ...(config.sessionIdleTimeoutSeconds
          ? { sessionIdleTimeoutSeconds: config.sessionIdleTimeoutSeconds }
          : {}),
        // 调试：SDK 日志级别（none/error/warning/info/debug/all，缺省=SDK 默认）
        ...(config.logLevel ? { logLevel: config.logLevel } : {}),
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
        // BYOK：CLI 不知道第三方模型，按官方文档用 onListModels 自报
        ...(customModels ? { onListModels: () => customModels } : {}),
      });
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
        ...(config.workingDirectory ? { workingDirectory: config.workingDirectory } : {}),
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
   */
  private buildSessionConfig(opts: SessionConfigOptions) {
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
    // MCP：预设按名启用 + 内联自定义（local 有安全门）
    const { mcpServers } = resolveMcp({ enable: opts.mcp, inline: opts.mcpServers });
    // Hooks：预设按名启用；传 sessionContext/agentStopChecklist 自动启用对应预设
    const { hooks } = resolveHooks({
      enable: opts.hooks,
      sessionContext: opts.sessionContext,
      agentStopChecklist: opts.agentStopChecklist,
    });
    return {
      model: resolved.model,
      ...(resolved.provider ? { provider: resolved.provider } : {}),
      streaming: true,
      onPermissionRequest: approveAll,
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

  async createSession(opts: CreateSessionOptions): Promise<CopilotSession> {
    const client = await this.getClient();
    if (opts.sessionId !== undefined) assertValidSessionId(opts.sessionId);
    const session = await client.createSession({
      ...this.buildSessionConfig(opts),
      ...(opts.sessionId ? { sessionId: opts.sessionId } : {}),
    });
    this.sessions.set(session.sessionId, session);
    return session;
  }

  /**
   * 恢复磁盘上的会话（服务重启/换实例后继续）。
   * 若内存里已有同 id 的附着会话则直接复用，避免同一会话双附着（文档：并发访问未定义）。
   */
  async resumeSession(sessionId: string, opts: SessionConfigOptions): Promise<CopilotSession> {
    assertValidSessionId(sessionId);
    const attached = this.sessions.get(sessionId);
    if (attached) return attached;
    const client = await this.getClient();
    try {
      const session = await client.resumeSession(sessionId, this.buildSessionConfig(opts));
      this.sessions.set(session.sessionId, session);
      return session;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/not found|no such|unknown session|does not exist/i.test(msg)) {
        throw new Error(`session 不存在（无法恢复）："${sessionId}"。${msg}`);
      }
      throw err;
    }
  }

  /** 磁盘上的全部会话（含未附着到本进程的），附带 attached 标记 */
  async listSessions(): Promise<(SessionMetadata & { attached: boolean })[]> {
    const client = await this.getClient();
    const all = await client.listSessions();
    return all.map((m) => ({ ...m, attached: this.sessions.has(m.sessionId) }));
  }

  async getSessionMeta(sessionId: string): Promise<(SessionMetadata & { attached: boolean }) | null> {
    const all = await this.listSessions();
    return all.find((m) => m.sessionId === sessionId) ?? null;
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
  async disconnectSession(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    try {
      await session.disconnect();
    } finally {
      this.sessions.delete(sessionId);
    }
    return true;
  }

  /** @deprecated 用 disconnectSession（语义更准：断开不断数据） */
  async destroySession(sessionId: string): Promise<boolean> {
    return this.disconnectSession(sessionId);
  }

  /**
   * 彻底删除：先断开内存附着，再删磁盘全部数据 → 不可恢复。
   * 磁盘上不存在时 SDK 会抛错，调用方按 404 处理。
   */
  async deleteSessionPermanently(sessionId: string): Promise<void> {
    assertValidSessionId(sessionId);
    await this.disconnectSession(sessionId).catch(() => false);
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
    if (this.client) {
      await this.client.stop();
      this.client = null;
    }
  }
}

export const sessionService = new SessionService();

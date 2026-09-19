import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import type { MCPServerConfig } from '@github/copilot-sdk';
import { config } from '../config.js';
import { serviceErrorStatus } from '../middleware/error-status.js';
import { ownerFromHeaders } from '../services/session-service.js';
import { principalFromHeaders, type Principal } from '../services/principal.js';
import type { ResolvedSessionAccess } from '../services/session-access.js';
import { sessionAccessService } from '../wiring.js';

/**
 * 路由公共件：管理鉴权、身份解析、请求 schema。
 * 拆分成 sessions/executions/human-tasks/meta 之后各路由共用这里，避免各写一份。
 */

export function requireAdmin(req: Request, res: Response, next: NextFunction): unknown {
  if (!config.adminToken) return next();
  if (req.header('x-admin-token') === config.adminToken) return next();
  return res.status(401).json({ error: 'unauthorized（管理接口需 x-admin-token）' });
}

/**
 * 调用方是否持有管理令牌。
 *
 * 用于「运营视角能看全量、参与者视角只能看自己的」这类读接口：管理令牌不是一个
 * 独立的准入闸门，而是**可见范围的放大器**。此前这些接口挂 `requireAdmin`，
 * 结果是配了 COPILOT_ADMIN_TOKEN 的部署里，共享会话的参与者读不到同会话的
 * execution 时间线（会话详情却读得到），协作读路径被截断。安全属性没有放松：
 * 未带令牌时仍会退到会话可见性判定，匿名拿不到全量。
 */
export function hasAdminToken(req: Request): boolean {
  return Boolean(config.adminToken) && req.header('x-admin-token') === config.adminToken;
}

/**
 * 读接口的准入与范围，一处判定、四处复用：
 *   all     管理令牌；或部署本身没设闸（没配令牌也不信任身份头 = 单租户本地开发）
 *   scoped  可信身份下的调用方：读到的范围收窄为「自己拥有的 + 自己参与的」会话
 *   denied  配了令牌、又拿不到可信身份：不给读
 *
 * 为什么不是 `requireAdmin`：execution 的可见性本就跟着 session 走（见 assertSessionVisible），
 * 管理令牌只回答「是否无视会话边界看全量」，不回答「能否读这个会话」。
 */
export function readAccess(req: Request): 'all' | 'scoped' | 'denied' {
  if (hasAdminToken(req)) return 'all';
  if (!config.adminToken) return config.trustIdentityHeaders ? 'scoped' : 'all';
  return config.trustIdentityHeaders ? 'scoped' : 'denied';
}

export const READ_ACCESS_DENIED = {
  error: 'unauthorized（需 x-admin-token，或开启可信身份头以按会话收窄）',
} as const;

/** 调用方身份（owner + roles；角色只在网关可信时来自请求头） */
export function principalOf(req: Request) {
  return principalFromHeaders(req.headers);
}

export function ownerOf(req: Request) {
  return ownerFromHeaders(req.headers);
}

/**
 * execution / human task 的可见性跟着它所属的 session 走：
 * shared 会话里，参与者能看到同会话中别人发起的 execution（这正是协作的语义）。
 * 归属过滤（tenantId/userId）不足以表达这一点，所以统一按 session 判定。
 * principal 由调用方传入：避免在这里重新解析请求头。
 */
export async function assertSessionVisible(sessionId: string, principal: Principal): Promise<void> {
  await sessionAccessService.assertCanView(sessionId, principal);
}

/** 调用方可见的 sessionId 集合（自己拥有的 + 自己参与的 active 会话） */
export function visibleSessionIds(principal: Principal): Promise<string[]> {
  return sessionAccessService.visibleSessionIds(principal);
}

/** 能否向该 session 提交工作：shared 会话里 observer 只读，送不进去 */
export async function assertSessionSendable(
  sessionId: string,
  principal: Principal,
): Promise<ResolvedSessionAccess> {
  return sessionAccessService.assertCanSend(sessionId, principal);
}

/**
 * 权限/归属/校验类错误 → 403/404/400（避免每个路由重复 if）。
 * 判定规则集中在 middleware/error-status.ts，与兜底 errorHandler 共用一份，防止两处漂移。
 * 认不出的错误继续 next(err)，由兜底按 500 处理。
 */
export function sendServiceError(res: Response, err: unknown, next: NextFunction): unknown {
  const message = err instanceof Error ? err.message : String(err);
  const status = serviceErrorStatus(message);
  if (status) return res.status(status).json({ error: message });
  return next(err);
}

const SESSION_ID_HINT = '须字母数字开头，仅含字母/数字/-/_，最长 128 字符（推荐 user-xxx-task-yyy）';

export const sessionIdSchema = z
  .string()
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9-_]{0,127}$/, `sessionId 非法，${SESSION_ID_HINT}`);

export const customAgentSchema = z.object({
  name: z.string().min(1),
  prompt: z.string().min(1, 'agent prompt 不能为空'),
  displayName: z.string().optional(),
  description: z.string().optional(),
  tools: z.array(z.string()).nullable().optional(),
  infer: z.boolean().optional(),
  skills: z.array(z.string()).optional(),
  model: z.string().optional(),
});

export const mcpLocalSchema = z.object({
  type: z.enum(['local', 'stdio']).optional(),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  cwd: z.string().optional(),
  workingDirectory: z.string().optional(),
  tools: z.array(z.string()).optional(),
  timeout: z.number().positive().optional(),
});

export const mcpHttpSchema = z.object({
  type: z.enum(['http', 'sse']),
  url: z.string().url('mcp http server 必须带合法 url'),
  headers: z.record(z.string(), z.string()).optional(),
  tools: z.array(z.string()).optional(),
  timeout: z.number().positive().optional(),
});

export const mcpServerSchema = z.union([mcpLocalSchema, mcpHttpSchema]);

export const sessionConfigSchema = z.object({
  model: z.string().optional(),
  systemMessage: z.string().optional(),
  agents: z.array(z.string()).optional(),
  customAgents: z.array(customAgentSchema).optional(),
  agent: z.string().optional(),
  skillDirs: z.array(z.string()).optional(),
  disabledSkills: z.array(z.string()).optional(),
  noBuiltinSkills: z.boolean().optional().default(false),
  defaultAgentExcludedTools: z.array(z.string()).optional(),
  mcp: z.array(z.string()).optional(),
  mcpServers: z.record(z.string(), mcpServerSchema).optional(),
  disabledMcpServers: z.array(z.string()).optional(),
  hooks: z.array(z.string()).optional(),
  sessionContext: z.string().max(4000, 'sessionContext 最长 4000 字符').optional(),
  agentStopChecklist: z.string().max(2000, 'agentStopChecklist 最长 2000 字符').optional(),
});

export const createSessionSchema = sessionConfigSchema.extend({
  sessionId: sessionIdSchema.optional(),
  /**
   * 访问模型（缺省 single）。
   * 命名刻意避开 SDK 的 `mode: "empty"`：那是 runtime/工具模式，这是业务会话模式，两者不能混。
   */
  collaborationMode: z.enum(['single', 'shared']).default('single'),
});

export const chatSchema = z.object({
  prompt: z.string().min(1, 'prompt 不能为空'),
  streaming: z.boolean().optional().default(false),
  model: z.string().optional(),
  /** 客户端幂等键（shared 必需场景）：重试同一条消息不会产生第二次 execution */
  clientMessageId: z.string().min(1).max(128).optional(),
});

export const addParticipantSchema = z.object({
  userId: z.string().min(1, 'userId 不能为空').max(128),
  role: z.enum(['member', 'observer']).optional().default('member'),
});

export const actionSchema = z.object({
  actionType: z.string().min(1),
  target: z.object({ type: z.string().min(1), id: z.string().min(1) }),
  parameters: z.record(z.string(), z.unknown()).optional().default({}),
  reason: z.string().optional(),
  resourceVersion: z.string().optional(),
});

/** 内联 MCP 里 cwd 是 workingDirectory 的别名，统一映射成 SDK 字段 */
export function normalizeInlineMcp(
  input: z.infer<typeof sessionConfigSchema>['mcpServers'],
): Record<string, MCPServerConfig> | undefined {
  if (!input) return undefined;
  const out: Record<string, MCPServerConfig> = {};
  for (const [name, cfg] of Object.entries(input)) {
    if ('url' in cfg) {
      const { cwd: _drop, ...rest } = cfg as Record<string, unknown>;
      out[name] = rest as unknown as MCPServerConfig;
    } else {
      const { cwd, workingDirectory, ...rest } = cfg;
      out[name] = {
        ...(rest as object),
        ...((cwd ?? workingDirectory)
          ? { workingDirectory: (cwd ?? workingDirectory) as string }
          : {}),
      } as MCPServerConfig;
    }
  }
  return out;
}

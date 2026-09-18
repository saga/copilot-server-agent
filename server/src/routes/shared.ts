import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import type { MCPServerConfig } from '@github/copilot-sdk';
import { config } from '../config.js';
import { ownerFromHeaders } from '../services/session-service.js';
import { principalFromHeaders } from '../services/principal.js';

/**
 * 路由公共件：管理鉴权、身份解析、请求 schema。
 * 拆分成 sessions/executions/human-tasks/meta 之后各路由共用这里，避免各写一份。
 */

export function requireAdmin(req: Request, res: Response, next: NextFunction): unknown {
  if (!config.adminToken) return next();
  if (req.header('x-admin-token') === config.adminToken) return next();
  return res.status(401).json({ error: 'unauthorized（管理接口需 x-admin-token）' });
}

/** 调用方身份（owner + roles；角色只在网关可信时来自请求头） */
export function principalOf(req: Request) {
  return principalFromHeaders(req.headers);
}

export function ownerOf(req: Request) {
  return ownerFromHeaders(req.headers);
}

/** 归属/不存在类错误 → 403/404（避免每个路由重复 if） */
export function sendServiceError(res: Response, err: unknown, next: NextFunction): unknown {
  const message = err instanceof Error ? err.message : String(err);
  if (/无权访问/.test(message)) return res.status(403).json({ error: message });
  if (/不存在|无法恢复|无法删除/.test(message)) return res.status(404).json({ error: message });
  if (/非法|缺少|必须|已关闭|已过期|不能重复|不是/.test(message)) {
    return res.status(400).json({ error: message });
  }
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
});

export const chatSchema = z.object({
  prompt: z.string().min(1, 'prompt 不能为空'),
  streaming: z.boolean().optional().default(false),
  model: z.string().optional(),
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

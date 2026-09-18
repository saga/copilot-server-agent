import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MCPServerConfig } from '@github/copilot-sdk';
import { config } from '../config.js';

export interface McpPresetMeta {
  name: string;
  description: string;
  /** SDK server 类型（local=http 之外都算本地子进程） */
  kind: 'local' | 'http';
  /** 默认是否挂载（用户可用 mcp: [] 关掉） */
  enabledByDefault: boolean;
  /** 授权范围展示（如 filesystem 的允许目录），密钥类字段永不外泄 */
  scope?: string;
}

const here = path.dirname(fileURLToPath(import.meta.url));
/** 仓库根目录（src/mcp 或 dist/mcp 上两级都是 server/，再上一级即仓库根） */
export const REPO_ROOT = path.resolve(here, '../../..');

/**
 * 内置预设：filesystem MCP，授权目录限定在仓库根（与 agent 已有的 view/edit 权限对等）。
 * 用 COPILOT_MCP_FILESYSTEM=false 关闭，或 COPILOT_MCP_FS_DIR 改授权目录。
 */
function filesystemPreset(): { meta: McpPresetMeta; config: MCPServerConfig } | null {
  if (!config.mcpFilesystem) return null;
  const dir = config.mcpFsDir ? path.resolve(config.mcpFsDir) : REPO_ROOT;
  return {
    meta: {
      name: 'filesystem',
      description: '仓库文件读写（官方 @modelcontextprotocol/server-filesystem）',
      kind: 'local',
      enabledByDefault: true,
      scope: dir,
    },
    config: {
      type: 'local',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', dir],
      tools: ['*'],
    },
  };
}

/** 运维通过 COPILOT_MCP_SERVERS 预置的 servers（JSON），解析失败直接抛错、不静默吞掉 */
function operatorServers(): Record<string, MCPServerConfig> {
  const raw = config.mcpServersJson.trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, MCPServerConfig>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('must be a JSON object');
    }
    return parsed;
  } catch (err) {
    throw new Error(
      `COPILOT_MCP_SERVERS 解析失败：${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export interface McpListing {
  presets: (McpPresetMeta & { source: 'builtin' | 'operator' })[];
  allowInlineLocal: boolean;
  allowInlineHttp: boolean;
}

/** 供 GET /api/mcp：只展示元信息，headers/env 等密钥字段绝不返回 */
export function listMcp(): McpListing {
  const presets: McpListing['presets'] = [];
  const fs = filesystemPreset();
  if (fs) presets.push({ ...fs.meta, source: 'builtin' });
  for (const [name, cfg] of Object.entries(operatorServers())) {
    presets.push({
      name,
      description: '运维预置（COPILOT_MCP_SERVERS）',
      kind: cfg.type === 'http' || cfg.type === 'sse' ? 'http' : 'local',
      enabledByDefault: true,
      source: 'operator',
    });
  }
  return {
    presets,
    allowInlineLocal: config.allowInlineMcpLocal,
    allowInlineHttp: config.allowInlineMcpHttp,
  };
}

export interface ResolveMcpOptions {
  /** 要启用的预设名（缺省=全部默认启用的；显式 []=全关） */
  enable?: string[];
  /** 内联自定义 servers（前端请求里带的 mcpServers） */
  inline?: Record<string, MCPServerConfig>;
}

/**
 * 解析本次会话的 mcpServers / disabledMcpServers。
 * 安全门：内联 local/stdio = 在服务器执行任意命令，默认拒绝（COPILOT_ALLOW_INLINE_MCP_LOCAL=true 才放行）。
 */
export function resolveMcp(opts: ResolveMcpOptions): {
  mcpServers?: Record<string, MCPServerConfig>;
} {
  const available = new Map<string, MCPServerConfig>();
  const fs = filesystemPreset();
  if (fs) available.set(fs.meta.name, fs.config);
  for (const [name, cfg] of Object.entries(operatorServers())) available.set(name, cfg);

  const wanted = opts.enable ?? [...available.keys()];
  const unknown = wanted.filter((n) => !available.has(n));
  if (unknown.length) {
    throw new Error(`未知 MCP 预设：${unknown.join(', ')}，可选：${[...available.keys()].join(', ') || '(无)'}`);
  }

  // 内联 servers 安全门
  const inline = opts.inline ?? {};
  for (const [name, cfg] of Object.entries(inline)) {
    const t = cfg.type ?? 'local';
    const isLocal = t === 'local' || t === 'stdio';
    if (isLocal && !config.allowInlineMcpLocal) {
      throw new Error(
        `内联 local MCP "${name}" 被拒绝：在服务器执行任意命令风险高，` +
          `如确需开放请设 COPILOT_ALLOW_INLINE_MCP_LOCAL=true（仅信任的前端可用）`,
      );
    }
    if (!isLocal && !config.allowInlineMcpHttp) {
      throw new Error(
        `内联 http MCP "${name}" 被拒绝：服务端已关闭（COPILOT_ALLOW_INLINE_MCP_HTTP=false）`,
      );
    }
    if (!isLocal && !('url' in cfg && cfg.url)) {
      throw new Error(`内联 http MCP "${name}" 缺少 url`);
    }
    if (isLocal && !('command' in cfg && cfg.command)) {
      throw new Error(`内联 local MCP "${name}" 缺少 command`);
    }
  }

  const mcpServers: Record<string, MCPServerConfig> = {};
  for (const n of wanted) mcpServers[n] = available.get(n) as MCPServerConfig;
  for (const [n, c] of Object.entries(inline)) mcpServers[n] = c;

  // 显式 enable 为 [] 且无内联 → 不传 mcpServers，保持会话干净
  if (Object.keys(mcpServers).length === 0) return {};
  return { mcpServers };
}

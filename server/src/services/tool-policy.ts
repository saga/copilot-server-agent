import path from 'node:path';
import { realpathSync } from 'node:fs';
import type {
  PermissionHandler,
  PermissionRequest,
  PermissionRequestResult,
  SessionHooks,
} from '@github/copilot-sdk';

/** SDK 未直接导出 PreToolUse 类型，从 SessionHooks 上取 */
type PreToolUseHandler = NonNullable<SessionHooks['onPreToolUse']>;
type PreToolUseHookInput = Parameters<PreToolUseHandler>[0];
type PreToolUseHookOutput = NonNullable<Awaited<ReturnType<PreToolUseHandler>>>;
import { config } from '../config.js';
import { assertSafeOutboundUrl } from '../mcp/registry.js';
import { recordHookEvent } from '../hooks/events.js';
import type { AgentCapability } from '../workflow/capability.js';
import type { FlowPermissionKind } from '../workflow/types.js';
/**
 * 工具授权 Policy（取代 approveAll）。
 *
 * 三层防线：
 * 1. session.availableTools —— 模型能看到的工具集合（mode: "empty" 必填）
 * 2. onPermissionRequest    —— 这里：按 kind 分级裁决（read/write/shell/mcp/url）
 * 3. onPreToolUse           —— 真正执行前的最后一道：写类工具路径必须落在 session workspace
 *
 * 说明：customAgents[].tools 只当作“软约束”（SDK #2356：某些组合下 agent.tools 可能
 * 不进模型 callable set），真正边界是 availableTools + onPreToolUse。
 */

export interface ToolPolicyContext {
  sessionId: string;
  workspacePath: string;
  /** 本次会话实际启用的 MCP server 名（MCP 调用只放行这些） */
  mcpServers: string[];
  /**
   * Skill Flow 的 `@agent` 能力边界（见 workflow/capability.ts）。
   *
   * 做成**回调**而不是快照：边界在会话生命周期中间才生效（跑到 `@agent` 节点时才设），
   * 建会话时拿不到。每次权限请求现取，才能跟上"现在跑的是流程里的哪一步"。
   *
   * 返回 undefined = 当前没有 workflow 节点在跑 → 不加这层限制（原有行为不变）。
   */
  capability?: () => AgentCapability | undefined;
  /**
   * 当前 session 正在跑的 executionId（`executionContext.current`）。
   *
   * 为什么需要它：边界是**会话级**存放、**execution 级**生效。只按 sessionId 取一份
   * 就意味着 A 那条 execution 的边界会作用到 B 上 —— 而 B 的节点可能只声明了 `read`，
   * 却因为 A 的节点允许 `write` 而拿到 `write`。一次**跨 execution 的能力放宽**。
   *
   * 不提供这个回调时跳过对账（单测 / 无 execution 上下文的场景），
   * 提供时**必须**与 capability.executionId 一致，否则拒绝（fail-closed）。
   */
  activeExecution?: () => string | undefined;
}

/**
 * 放行必须用 approve-once（与 SDK 的 approveAll 一致）：
 * 类型联合里也有 `approved`，但那是“已批准”的状态回执，runtime 在 hook 响应
 * 路径上不认它 —— 用了会报 `unexpected user permission response: approved`。
 */
const ALLOW: PermissionRequestResult = { kind: 'approve-once' };

function deny(message: string): PermissionRequestResult {
  return { kind: 'denied-by-permission-request-hook', message, interrupt: false };
}

/** 规范化路径：能对上真实路径就解析 symlink，解析不了就用字面（不因异常放行） */
function canonical(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

/**
 * target 是否落在 workspace 内（相对路径按 workspace 作为 cwd 解析）。
 * 同时比对“字面路径”与“解析 symlink 后的真实路径”：macOS 的 /var → /private/var、
 * K8s 里 workspace 经 symlink 挂载都会让两者不一致，只比一边会误杀或误放行。
 */
export function isWithinWorkspace(target: string, workspacePath: string): boolean {
  if (!target) return false;
  const wsLiteral = path.resolve(workspacePath);
  const wsReal = canonical(workspacePath);
  const abs = path.isAbsolute(target) ? path.resolve(target) : path.resolve(wsLiteral, target);
  const roots = new Set([wsLiteral, wsReal]);
  const targets = new Set([abs, canonical(abs)]);
  for (const root of roots) {
    for (const t of targets) {
      if (t === root || t.startsWith(root + path.sep)) return true;
    }
  }
  return false;
}

function hostAllowed(url: URL): boolean {
  if (config.urlAllowlist.length === 0) return true;
  const host = url.hostname.toLowerCase();
  return config.urlAllowlist.some((d) => {
    const dd = d.toLowerCase();
    return host === dd || host.endsWith(`.${dd}`);
  });
}

/**
 * onPermissionRequest：按 kind 分级裁决。
 *
 * **第 0 层（Skill Flow 能力边界）**：跑 `@agent` 节点时先按该节点的能力集合过一道。
 * 它只**收窄**，不替代下面的检查 —— 过了这一层还要继续走 workspace / SSRF 等原有判定。
 * 它先和"当前正在跑的 execution"对一次账，边界不属于当前 execution 就直接拒绝：
 * 边界是会话级存放、execution 级生效的，不比对账就会串台（见 ToolPolicyContext）。
 *
 * - read：放行（只读无副作用；workspace 外的库/系统文件读取是刚需）
 * - write：只允许落在 session workspace
 * - shell：COPILOT_BASH_POLICY=workspace 时，命令涉及路径必须落在 workspace；
 *   任何 sandbox bypass 提权请求一律拒绝
 * - mcp：只放行本次会话实际启用的 server（会话未配置的 server 名 = 越权）
 * - url：SSRF 检查 + 可选域名 allowlist
 * - 其它（memory/custom-tool/extension…）：默认拒绝（服务端 agent 无人在环）
 */
export function createPermissionHandler(ctx: ToolPolicyContext): PermissionHandler {
  return async (request: PermissionRequest) => {
    const audit = (decision: string, detail: string) => {
      recordHookEvent(ctx.sessionId, 'permission', `${decision} kind=${request.kind} ${detail}`);
    };

    // 第 0 层：workflow @agent 的能力边界。
    // 放在最前面，是为了让拒绝理由说清"这是流程节点的能力限制"，
    // 而不是让它落进下面某个 kind 分支、报一个看起来无关的错。
    const capability = ctx.capability?.();
    if (capability) {
      // 先对账：这份边界真的是**当前这条 execution** 的吗？
      //
      // 边界按 sessionId 存一份，而一条会话可以先后（甚至排队）承载多条 execution。
      // 只按 sessionId 取，A 的边界就会作用到 B 上：A 的节点允许 write、B 的节点
      // 只声明了 read，B 却拿到了 write —— 一次跨 execution 的能力放宽，而且
      // 审计链上只会看到"B 用了 write 工具"，看不出是边界串了台。
      //
      // 对不上就拒绝，而不是"忽略这份边界、退回会话策略"：退回等于把 mcp / shell
      // 重新交回 agent 手上（会话策略本来就允许它们），那正是这一层要挡的东西。
      // 拒绝会让问题立刻可见 —— 包括"未来的某个 runtime 忘了设 execution 上下文"
      // 这种会让边界静默失效的改法。
      if (ctx.activeExecution) {
        const activeExecution = ctx.activeExecution();
        if (activeExecution !== capability.executionId) {
          const detail =
            `workflow capability 与当前 execution 不一致：` +
            `capability=${capability.executionId}/${capability.nodeId}，当前=${activeExecution ?? '(无)'}`;
          audit('deny', detail);
          console.warn(`[tool-policy] session ${ctx.sessionId} ${detail}`);
          return deny(
            `流程节点的能力边界不属于当前执行（边界属于 execution ${capability.executionId} 的节点 ${capability.nodeId}）：` +
              '为避免把另一条执行的权限用在这里，本次调用被拒绝',
          );
        }
      }
      if (!capability.kinds.has(request.kind as FlowPermissionKind)) {
        const detail = `workflow node ${capability.nodeId} 不允许 ${request.kind}（允许：${[...capability.kinds].join(',') || '(无)'}）`;
        audit('deny', detail);
        return deny(
          `流程节点 @agent ${capability.nodeId} 没有 ${request.kind} 权限：` +
            `它只能使用 ${[...capability.kinds].join(' / ') || '(无工具)'}。` +
            '业务动作必须通过流程里声明的 @action 节点走审批，不能由 agent 直接执行。',
        );
      }
    }

    switch (request.kind) {
      case 'read':
        audit('allow', `path=${'path' in request ? request.path : '?'}`);
        return ALLOW;
      case 'write': {
        const target = (request.resolvedPath ?? request.fileName ?? '') as string;
        if (!isWithinWorkspace(target, ctx.workspacePath)) {
          audit('deny', `write outside workspace: ${target}`);
          return deny(`禁止写入 workspace 之外的路径：${target}（workspace=${ctx.workspacePath}）`);
        }
        audit('allow', `write ${target}`);
        return ALLOW;
      }
      case 'shell': {
        if (config.bashPolicy === 'deny') {
          audit('deny', 'bash policy=deny');
          return deny('当前策略禁止执行 shell 命令');
        }
        if (request.requestSandboxBypass) {
          audit('deny', 'sandbox bypass requested');
          return deny('禁止 shell 请求绕过沙箱执行');
        }
        if (config.bashPolicy === 'workspace') {
          const paths = [
            ...(request.possiblePaths ?? []),
            ...Object.values(request.resolvedPaths ?? {}).filter((v): v is string => !!v),
          ];
          const outside = paths.filter((p) => !isWithinWorkspace(p, ctx.workspacePath));
          if (outside.length) {
            audit('deny', `shell paths outside workspace: ${outside.join(', ')}`);
            return deny(
              `命令涉及 workspace 之外的路径：${outside.slice(0, 5).join(', ')}（workspace=${ctx.workspacePath}）`,
            );
          }
        }
        audit('allow', 'shell');
        return ALLOW;
      }
      case 'mcp': {
        if (!ctx.mcpServers.includes(request.serverName)) {
          audit('deny', `mcp server not enabled: ${request.serverName}`);
          return deny(`MCP server 未在本次会话启用：${request.serverName}`);
        }
        audit('allow', `mcp ${request.serverName}/${request.toolName}`);
        return ALLOW;
      }
      case 'url': {
        try {
          const url = await assertSafeOutboundUrl(request.url);
          if (!hostAllowed(url)) {
            audit('deny', `url host not allowlisted: ${url.hostname}`);
            return deny(`URL 域名不在 allowlist：${url.hostname}`);
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          audit('deny', `url rejected: ${msg}`);
          return deny(msg);
        }
        audit('allow', `url ${request.url}`);
        return ALLOW;
      }
      default:
        audit('deny', `unhandled kind=${request.kind}`);
        return deny(`未授权的权限请求类型：${request.kind}`);
    }
  };
}

/** 写类工具（view/grep/glob 只读，不限制） */
const WRITE_TOOLS = new Set([
  'edit',
  'create',
  'write',
  'apply_patch',
  'str_replace_editor',
  'insert',
  'notebook_edit',
]);

/** 从 toolArgs 里抠出可能的路径字段（不同工具字段名不统一，取常见几个） */
function extractPaths(toolName: string, args: unknown): string[] {
  if (!args || typeof args !== 'object') return [];
  const rec = args as Record<string, unknown>;
  const out: string[] = [];
  for (const key of ['path', 'filePath', 'file_path', 'target', 'filename', 'notebookPath']) {
    const v = rec[key];
    if (typeof v === 'string' && v.trim()) out.push(v.trim());
  }
  // bash 的 command 不做静态解析（静态判断极易误伤），由 onPermissionRequest 的
  // possiblePaths 与 bash policy 兜底
  void toolName;
  return out;
}

/**
 * onPreToolUse：真正执行前的最后一道门。
 * 只拦写类工具（读类放开），路径必须落在 session workspace。
 */
export function createPreToolUseGuard(ctx: ToolPolicyContext): PreToolUseHandler {
  return async (input: PreToolUseHookInput): Promise<PreToolUseHookOutput | void> => {
    if (!WRITE_TOOLS.has(input.toolName)) return undefined;
    const paths = extractPaths(input.toolName, input.toolArgs);
    const outside = paths.filter((p) => !isWithinWorkspace(p, ctx.workspacePath));
    if (outside.length) {
      const reason = `工具 ${input.toolName} 只能操作 session workspace 内的路径：${outside.join(', ')}（workspace=${ctx.workspacePath}）`;
      // 事件由 tool-evidence 统一记录（带 toolCallId/executionId），这里不重复写
      return { permissionDecision: 'deny', permissionDecisionReason: reason };
    }
    return undefined;
  };
}

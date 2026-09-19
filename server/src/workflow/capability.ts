import { FLOW_PERMISSION_KINDS, type FlowPermissionKind } from './types.js';

/**
 * `@agent` 节点的**能力边界**：这一步允许用哪些类别的工具权限。
 *
 * ## 它挡的是什么
 *
 * 流程把业务动作收敛到 `@action` 节点（策略 → 审批 → hash/版本复核 → executor），
 * 但 agent 手上还有工具 —— 它可以不走 `@action`，直接调一个 MCP server 把研究报告
 * 发出去、或者用 shell curl 一个内部接口。那样整条流程的审批就成了摆设。
 *
 * 所以 `@agent` 节点默认**碰不到 `mcp` 与 `shell`**：
 *
 *   read    允许（只读无副作用；没有它 agent 什么都干不了）
 *   write   允许（只能落在 session workspace 内，onPermissionRequest 已有路径守卫）
 *   url     允许（出站请求另有 SSRF 检查 + 域名 allowlist）
 *   shell   默认拒绝 —— 命令可以绕过路径守卫触达任意外部系统
 *   mcp     默认拒绝 —— MCP server 就是外部业务系统，正是"绕开 @action"的路径
 *
 * 上限由 `COPILOT_WORKFLOW_AGENT_TOOLS` 配置（企业配置，不是 SKILL.md）；
 * SKILL.md 的 `@agent tools:` 只能在它之内**收窄**（见 flow-validator 的 agent-tools-widens）。
 *
 * ## 为什么是一份进程内状态
 *
 * 工具授权上下文（`ToolPolicyContext`）在**建会话时**就固定了，而 `@agent` 节点是在
 * 会话生命周期中间跑的 —— 没法把它烘进 session config。所以这里按 sessionId 存一份
 * 当前生效的边界，权限回调在**每次请求时**读它。
 *
 * 它刻意不是 durable 状态：这是运行期的守卫，进程重启后由 runner 在进入节点时重新设。
 * 丢失它只会让"节点执行期间"的边界消失，而那时节点本来也没在跑。
 *
 * 依赖方向：本模块**不 import 任何业务模块**（只 import 类型），
 * 这样 tool-policy / session-service / workflow runner 都能引用它而不成环。
 */

export interface AgentCapability {
  /** 本次 `@agent` 允许的权限类别 */
  kinds: ReadonlySet<FlowPermissionKind>;
  /** 哪个节点在跑（拒绝理由与审计要能看出是谁） */
  nodeId: string;
  flow: string;
}

/** sessionId → 当前生效的能力边界 */
const active = new Map<string, AgentCapability>();

export function setAgentCapability(sessionId: string, capability: AgentCapability): void {
  active.set(sessionId, capability);
}

/**
 * 清除边界。**只清自己设的那一份**：
 * 节点 id 对不上说明期间又有人设过（嵌套 / 并发），清掉会把新的那份误删。
 */
export function clearAgentCapability(sessionId: string, nodeId: string): void {
  if (active.get(sessionId)?.nodeId === nodeId) active.delete(sessionId);
}

export function agentCapabilityFor(sessionId: string): AgentCapability | undefined {
  return active.get(sessionId);
}

/** 测试用：清空（避免用例之间互相影响） */
export function clearAllAgentCapabilities(): void {
  active.clear();
}

/**
 * 算出一个 `@agent` 节点的生效权限集合：**服务端上限 ∩ SKILL.md 声明**。
 *
 * 两边都为空 / 声明为空数组时返回空集 —— 空集意味着"这个节点什么工具都不能用"，
 * 这是 fail-closed 的正确表现（校验器已经会报 `agent-tools-widens`，走到这里说明
 * 是运行期才发现的异常情况）。
 */
export function resolveAgentTools(
  ceiling: readonly FlowPermissionKind[],
  declared?: readonly FlowPermissionKind[],
): FlowPermissionKind[] {
  const base = new Set(ceiling);
  if (!declared) return FLOW_PERMISSION_KINDS.filter((k) => base.has(k));
  return FLOW_PERMISSION_KINDS.filter((k) => base.has(k) && declared.includes(k));
}

/** 解析 `COPILOT_WORKFLOW_AGENT_TOOLS` 这类逗号分隔配置 */
export function parseAgentTools(raw: string, fallback: readonly FlowPermissionKind[]): FlowPermissionKind[] {
  const out = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is FlowPermissionKind => (FLOW_PERMISSION_KINDS as readonly string[]).includes(s));
  return out.length ? out : [...fallback];
}

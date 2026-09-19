import {
  FLOW_PERMISSION_KINDS,
  WORKFLOW_AGENT_ALLOWED_KINDS,
  isWorkflowAgentKind,
  type FlowPermissionKind,
} from './types.js';

// 硬上限是 `@agent` 能力边界的一部分，从这一层再导出：调用方（校验器、配置解析、测试）
// 引用"生效边界"时只需要认 capability.ts 一个入口
export { WORKFLOW_AGENT_ALLOWED_KINDS, WORKFLOW_AGENT_FORBIDDEN_KINDS, isWorkflowAgentKind } from './types.js';

/**
 * `@agent` 节点的**能力边界**：这一步允许用哪些类别的工具权限。
 *
 * ## 它挡的是什么
 *
 * 流程把业务动作收敛到 `@action` 节点（策略 → 审批 → hash/版本复核 → executor），
 * 但 agent 手上还有工具 —— 它可以不走 `@action`，直接调一个 MCP server 把研究报告
 * 发出去、或者用 shell curl 一个内部接口。那样整条流程的审批就成了摆设。
 *
 * 所以 `@agent` 节点**永远**碰不到 `mcp` 与 `shell`（见 `WORKFLOW_AGENT_ALLOWED_KINDS`）：
 *
 *   read    允许（只读无副作用；没有它 agent 什么都干不了）
 *   write   允许（只能落在 session workspace 内，onPermissionRequest 已有路径守卫）
 *   url     允许（出站请求另有 SSRF 检查 + 域名 allowlist）
 *   shell   禁止 —— 命令可以绕过路径守卫触达任意外部系统
 *   mcp     禁止 —— MCP server 就是外部业务系统，正是"绕开 @action"的路径
 *
 * ## 为什么 mcp / shell 是**硬禁止**（连配置也放不开）
 *
 * 上一版把它们做成"配置默认值"（`COPILOT_WORKFLOW_AGENT_TOOLS` 不含即拒绝）。
 * 那等于说：把 `mcp` 写进环境变量，`@agent` 就能重新拿到绕开审批的路径 ——
 * 一条**企业配置**能悄悄取消流程的授权模型，而 SKILL.md、审计、审批链上都看不出来。
 *
 * 现在它是代码里的不变式（`WORKFLOW_AGENT_ALLOWED_KINDS`）：配置只能在
 * `read`/`write`/`url` 之内选，SKILL.md 的 `@agent tools:` 只能在此之上再收窄。
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
 * ## 为什么记录里带 executionId
 *
 * 边界是**会话级**存放、**execution 级**生效。会话以后会承载多条 execution
 * （shared 会话的队列、人工任务续跑、同一会话里先后跑两条流程），只按 sessionId
 * 存一份就意味着 A 的边界会作用到 B 上：A 的节点允许 `write`、B 的节点只声明
 * `read`，B 却拿到了 `write` —— 一次**跨 execution 的能力放宽**。
 * 所以边界里带上 executionId，权限回调再和"当前正在跑的 execution"对一次账
 * （见 `tool-policy.ts` 第 0 层）。
 *
 * 依赖方向：本模块**不 import 任何业务模块**（只 import 类型与契约常量），
 * 这样 tool-policy / session-service / workflow runner 都能引用它而不成环。
 */

export interface AgentCapability {
  /**
   * 这份边界属于哪次 execution。
   *
   * 权限回调必须拿它和"当前正在跑的 execution"比对：对不上说明这是上一轮残留
   * （或者会话里换了另一条 execution），不能拿它当当前边界用。
   */
  executionId: string;
  /** 本次 `@agent` 允许的权限类别 */
  kinds: ReadonlySet<FlowPermissionKind>;
  /** 哪个节点在跑（拒绝理由与审计要能看出是谁） */
  nodeId: string;
  flow: string;
}

/** 清除时用来确认"要清的就是我设的那一份" */
export interface AgentCapabilityRef {
  executionId: string;
  nodeId: string;
}

/** sessionId → 当前生效的能力边界 */
const active = new Map<string, AgentCapability>();

export function setAgentCapability(sessionId: string, capability: AgentCapability): void {
  active.set(sessionId, capability);
}

/**
 * 清除边界。**只清自己设的那一份**。
 *
 * 为什么要同时比 executionId 与 nodeId：`@agent` 的 `finally` 在 turn 槽**外面**跑，
 * 而 turn 槽一释放，同一会话里的下一条 execution 就可能立刻开始并设上自己的边界。
 * 只比 nodeId 时，同一个节点 id 在两条 execution 里是相同的，先跑完的那条会把
 * 后开始的那条的边界误删 —— 于是"节点执行期间"这段窗口里边界凭空消失。
 */
export function clearAgentCapability(sessionId: string, ref: AgentCapabilityRef): void {
  const current = active.get(sessionId);
  if (!current) return;
  if (current.nodeId !== ref.nodeId || current.executionId !== ref.executionId) return;
  active.delete(sessionId);
}

export function agentCapabilityFor(sessionId: string): AgentCapability | undefined {
  return active.get(sessionId);
}

/** 测试用：清空（避免用例之间互相影响） */
export function clearAllAgentCapabilities(): void {
  active.clear();
}

/**
 * 算出一个 `@agent` 节点的生效权限集合：**服务端上限 ∩ SKILL.md 声明**，
 * 结果再与硬上限（`WORKFLOW_AGENT_ALLOWED_KINDS`）取交集。
 *
 * 最后那次交集是**兜底**而不是主判定：校验器已经会报 `agent-tools-forbidden` /
 * `agent-tools-widens`，配置解析也会过滤。它在这里是因为这一层是"真正决定
 * agent 拿到什么权限"的地方 —— 无论调用方传进来什么（配置、注入的上限、测试里的
 * 假注册表），`mcp` / `shell` 都不会出现在结果里。
 *
 * 两边都为空 / 声明为空数组时返回空集 —— 空集意味着"这个节点什么工具都不能用"，
 * 这是 fail-closed 的正确表现。
 */
export function resolveAgentTools(
  ceiling: readonly FlowPermissionKind[],
  declared?: readonly FlowPermissionKind[],
): FlowPermissionKind[] {
  const base = new Set(ceiling);
  const allowed = new Set(WORKFLOW_AGENT_ALLOWED_KINDS);
  const pick = (k: FlowPermissionKind): boolean =>
    base.has(k) && allowed.has(k) && (!declared || declared.includes(k));
  return FLOW_PERMISSION_KINDS.filter(pick);
}

/**
 * 解析 `COPILOT_WORKFLOW_AGENT_TOOLS` 这类逗号分隔配置。
 *
 * 认不出的类别、以及硬禁止的 `mcp` / `shell`，都**直接丢掉**（不报错、不静默放行）：
 * 配置写错时退回默认值是安全的，把 `mcp` 放进去才是不安全的。
 * 过滤后为空时退回 `fallback`（调用方传的默认值），绝不会变成"什么都能用"。
 */
export function parseAgentTools(
  raw: string,
  fallback: readonly FlowPermissionKind[],
): FlowPermissionKind[] {
  const out = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is FlowPermissionKind => isWorkflowAgentKind(s));
  const usable = out.length ? out : [...fallback];
  // fallback 本身也过一遍硬上限：调用方误传 mcp/shell 时同样不生效
  return FLOW_PERMISSION_KINDS.filter((k) => usable.includes(k) && isWorkflowAgentKind(k));
}

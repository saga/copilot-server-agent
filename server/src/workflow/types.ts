/**
 * Skill Flow：`SKILL.md` 里的轻量编排层。
 *
 * 刻意不定义第二套 Workflow DSL，也不引入 BPMN / XState：
 *
 *   SKILL.md（Markdown AST）
 *        ↓  remark-parse
 *   FlowDefinition（本文件的类型）
 *        ↓
 *   WorkflowRunner ── 复用现有 Execution / HumanTask / Action 体系
 *
 * 节点只有 6 种，没有 parallel / timer / subprocess / expression：
 *
 *   @agent     跑一次 agent turn（走 Copilot session）—— 旧名 @subagent，语义相同
 *   @gate      确定性判断（走服务端注册的 gate，LLM 不决定合规边界）
 *   @review    人工审核（复用 HumanTask + ApprovalPolicy）
 *   @action    业务动作（复用 ActionService：策略 → 审批 → hash/版本复核 → executor）
 *   @stop      失败/拒绝终态
 *   @end       成功终态
 *
 * 权限、角色、审批策略**不写在 SKILL.md 里**：节点只声明"这里需要 compliance-review"，
 * 由服务端 registry 决定谁有资格（与"LLM 不能定义 enterprise security boundary"一致）。
 */

export type FlowNodeType = 'agent' | 'gate' | 'review' | 'action' | 'stop' | 'end';

/** 解析期出现的块类型，比节点多一个 `@flow`（流程入口） */
export type FlowBlockType = FlowNodeType | 'flow';

export interface FlowRoute {
  /** 出口名：agent/action 用 success|fail；gate 用 gate 自己返回的 outcome；review 用 approve|reject */
  on: string;
  /** 目标节点 id */
  to: string;
}

export interface FlowNode {
  id: string;
  type: FlowNodeType;
  /** 节点正文（原样保留 Markdown，不做 LLM 解析）。**已剥掉开头的保留属性行** */
  body: string;
  /** 保留属性（只有 @review / @action 有；由校验器校验并归一化） */
  attrs: FlowNodeAttrs;
  routes: FlowRoute[];
  /** `## @xxx` 所在行（1-based）；报错指给用户看的那一行 */
  headingLine: number;
  /** 正文内容的首行 / 末行（1-based） */
  startLine: number;
  endLine: number;
}

export interface FlowDefinition {
  /** `## @flow <id>` 的 id */
  id: string;
  /** 入口节点 id（`start -> research`） */
  start: string;
  nodes: Record<string, FlowNode>;
}

/**
 * 当前节点的执行状态。**只有 `current` 一个字段是表达不了"这步跑没跑完"的**：
 *
 *   pending   还没开始 —— 可以安全执行
 *   running   已经开始 —— 进程在这里退出的话，无法确认它是否已经完成
 *   waiting   停在等人工任务（review / action 审批）
 *   completed 终态节点（@stop / @end）已收尾
 *
 * 缺省（老数据）按 `pending` 处理。
 */
export type WorkflowStepStatus = 'pending' | 'running' | 'waiting' | 'completed';

/**
 * 运行中的 workflow 状态，落在 `agent_execution.workflow_state`。
 *
 * 必须 durable：`@review` 可能等几个小时，Pod 重启后要靠它回答"我停在哪个节点、
 * 等的是哪个任务"。否则 execution = waiting_for_approval 但没人知道等的是哪一步。
 */
export interface WorkflowState {
  /** 技能名（= 节点 `@agent <skill>` 的名字） */
  skill: string;
  flow: string;
  /**
   * SKILL.md 内容的 SHA-256。
   * resume 时重新算一遍并比对：流程进行到一半时有人改了技能文件，
   * 我们不能让这次执行悄悄切到另一个版本的流程上（金融流程的审计要求）。
   */
  sourceHash: string;
  /** 当前节点 id */
  current: string;
  /** 当前节点的执行状态（见 WorkflowStepStatus） */
  stepStatus?: WorkflowStepStatus;
  /** 已执行步数（上限见 MAX_FLOW_STEPS） */
  steps: number;
  /** 正等着的人工任务（review / action 审批） */
  waitingTaskId?: string;
  /** 最近一个节点的出口名，便于审计与排障 */
  lastOutcome?: string;
  /** 最近一个 @agent 的输出（截断），供后续 gate/action 判断依据 */
  lastOutput?: string;
}

/**
 * 传给 gate / action 的上下文。
 * 没有 variables / expressions：只有这一层的执行信息。
 */
export interface FlowContext {
  executionId: string;
  sessionId: string;
  tenantId: string;
  /** 发起人（构建 ActionIntent 的 requestedBy 用；不是会话 owner） */
  initiatorId: string;
  skill: string;
  flow: string;
  nodeId: string;
  /** execution 建立时带的 input（如 { securityId } ） */
  input?: unknown;
  /** 上一个 @agent 的输出（截断后） */
  lastOutput?: string;
}

/**
 * 单次 workflow 的步数上限。
 *
 * 允许环（research → review → research 是研究流程的常态），所以必须有这条硬闸门：
 * 没有它，一个永远不收敛的 review 会把同一个 execution 跑成无限循环。
 * 刻意不放进 DSL —— 这是运行时保护，不是流程语义。
 */
export const MAX_FLOW_STEPS = 100;

/** 解析/校验问题（带 SKILL.md 行号） */
export interface FlowIssue {
  code: string;
  message: string;
  /** SKILL.md 内的 1-based 行号；0 表示与具体行无关 */
  line: number;
  nodeId?: string;
}

/**
 * 运行时出口词汇表 —— 校验器与 runner 共用这一份，避免两边各写一份字面量后漂移。
 *
 *   @agent / @action     只会给出 success | fail（跑成功或跑失败）
 *   @review              只会给出 approve | reject（打回重做=把 reject 的 route 指回上一步）
 *   @gate                出口由服务端注册的实现决定 —— 见 FlowGate.outcomes（静态可校验）
 *   @stop / @end         终态，没有出口
 */
export const NODE_OUTCOMES: Record<FlowNodeType, readonly string[]> = {
  agent: ['success', 'fail'],
  // gate 没有固定词汇表：出口名由注册的实现声明（registry.gateOutcomes），
  // 所以这里给空数组，校验器改走注册表那条路径 —— 硬编码 pass/fail 会把
  // "again / review / escalate" 这类合法出口误判成缺 route。
  gate: [],
  review: ['approve', 'reject'],
  action: ['success', 'fail'],
  stop: [],
  end: [],
};

/**
 * 节点正文最前面允许出现的**保留属性**（`name: value` 行）。
 *
 *   @review   role / strategy / required / exclude   —— 谁能批、要几票、发起人能否自批
 *   @action   role                                   —— 把动作审批资格收窄到某个业务角色
 *   @agent    output / tools                         —— 完成契约 / 能力边界
 *
 * 一条贯穿全部属性的规则：**属性只能比服务端更严**（见 flow-validator 的 `attr-widens`）。
 * SKILL.md 是会被 LLM 读到、也会被人随手改的文件，不能靠它扩大授权面或放宽能力边界。
 *
 * `@gate` 刻意不支持任何属性：gate 的语义完全由服务端注册的实现决定，SKILL.md 里
 * 写什么都改变不了它 —— 能写的东西只有"看起来有影响"的假象。
 */
export const NODE_ATTRS: Record<FlowNodeType, readonly string[]> = {
  agent: ['output', 'tools'],
  gate: [],
  review: ['role', 'strategy', 'required', 'exclude'],
  action: ['role'],
  stop: [],
  end: [],
};

/**
 * 权限类别 —— 与 SDK `PermissionRequest.kind` 对齐的**白名单**子集。
 *
 * 只列 @agent 节点可能被允许的类别：SDK 里还有 memory / custom-tool / extension 等，
 * 它们**不在白名单里**，因此永远无法通过能力边界（默认拒绝，与 tool-policy 一致）。
 */
export type FlowPermissionKind = 'read' | 'write' | 'shell' | 'mcp' | 'url';

export const FLOW_PERMISSION_KINDS: readonly FlowPermissionKind[] = [
  'read',
  'write',
  'shell',
  'mcp',
  'url',
];

export function isFlowPermissionKind(value: string): value is FlowPermissionKind {
  return (FLOW_PERMISSION_KINDS as readonly string[]).includes(value);
}

/**
 * `@review` 的**生效基策略** —— 服务端注册表的权威值（可选字段已补成确定值）。
 *
 * 放在这里而不是 registry.ts，是为了让校验器只依赖类型定义，不依赖注册表实现：
 * 校验器只回答"SKILL.md 有没有越过这条基策略"，不关心它从哪来。
 */
export interface ReviewBasePolicy {
  /** 有资格审核的业务角色（权威来源；SKILL.md 的 `role:` 只能从中挑） */
  eligibleRoles: string[];
  strategy: 'ANY' | 'ALL';
  requiredCount: number;
  /** 是否允许发起人自批（SoD）；false 时 SKILL.md 不能写 `exclude: none` */
  allowInitiator: boolean;
  timeoutSeconds?: number;
}

/** 完成契约 / gate 名等流程内引用的 id 形态（与业务角色 id 同一套规则） */
export const FLOW_CONTRACT_ID = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;


/** 全部保留属性名（用于"属性名认得、但用错了节点类型"的判定） */
export const ALL_ATTR_NAMES: readonly string[] = [...new Set(Object.values(NODE_ATTRS).flat())];

/**
 * 解析后的节点保留属性。**只有校验器会产出它** —— parser 只做词法切分，
 * 值的合法性（strategy 只能是 ANY/ALL 等）与角色是否已登记都归校验器。
 */
export interface FlowNodeAttrs {
  /** 业务角色 id（`compliance.reviewer`），不是 AD Group */
  role?: string;
  /** 多人审核规则。相对注册表的基策略**只能更严**：基策略是 ANY 时才允许改成 ALL */
  strategy?: 'ANY' | 'ALL';
  /** 需要的批准票数。**只能 ≥** 注册表的 requiredCount（降票数 = 放宽） */
  required?: number;
  /**
   * 排除的审批主体。
   *
   * `initiator` = 发起人不能批自己发起的事（SoD）；`none` = 显式允许（仍受全局
   * `COPILOT_ALLOW_INITIATOR_APPROVAL` 限制，两个开关都开才真的放行）。
   *
   * 注册表没开 `allowInitiator` 时，写 `exclude: none` 属于放宽 → 校验失败。
   */
  exclude?: 'initiator' | 'none';
  /**
   * `@agent` 的完成契约 id（服务端注册，见 registry 的 FlowOutput）。
   *
   * 它解决的问题：`@agent success` 只代表"这次 turn 没抛异常"，不代表业务上做完了。
   * 有了契约，节点返回 success 之前必须先过服务端注册的确定性校验 —— 不让 LLM 自评。
   */
  output?: string;
  /**
   * `@agent` 允许的权限类别（`read,write`）。
   *
   * 与 `role:` 同理，**只能比服务端上限更严**（上限见 config.workflowAgentTools）：
   * 默认上限是 read/write/url —— 也就是"能读能写工作区文件，但**碰不到 MCP 与 shell**"，
   * 因为那两样正是绕开 `@action` 审批直接产生业务副作用的路径。
   */
  tools?: FlowPermissionKind[];
}

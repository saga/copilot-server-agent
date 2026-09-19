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
 *   @gate                出口由服务端注册的实现决定，SKILL.md 必须与它一致（无法静态校验）
 *   @stop / @end         终态，没有出口
 */
export const NODE_OUTCOMES: Record<FlowNodeType, readonly string[]> = {
  agent: ['success', 'fail'],
  gate: [],
  review: ['approve', 'reject'],
  action: ['success', 'fail'],
  stop: [],
  end: [],
};

/**
 * 节点正文最前面允许出现的**保留属性**（`name: value` 行）。
 *
 * 只有 `@review` / `@action` 有：属性表达的是"这一步需要什么业务角色、要几票、发起人能否自批"，
 * 属于流程语义，写进 SKILL.md 是合理的；**AD Group 不在这里**，那是企业访问控制配置
 * （见 `identity/business-roles.ts`）。
 *
 * `@agent` / `@gate` 刻意不支持任何属性：agent 的正文就是 prompt，往里面塞角色声明
 * 只会让"谁有权跑这个 skill"变成一句写给 LLM 的话。
 */
export const NODE_ATTRS: Record<FlowNodeType, readonly string[]> = {
  agent: [],
  gate: [],
  review: ['role', 'strategy', 'required', 'exclude'],
  action: ['role'],
  stop: [],
  end: [],
};

/** 全部保留属性名（用于"属性名认得、但用错了节点类型"的判定） */
export const ALL_ATTR_NAMES: readonly string[] = [...new Set(Object.values(NODE_ATTRS).flat())];

/**
 * 解析后的节点保留属性。**只有校验器会产出它** —— parser 只做词法切分，
 * 值的合法性（strategy 只能是 ANY/ALL 等）与角色是否已登记都归校验器。
 */
export interface FlowNodeAttrs {
  /** 业务角色 id（`compliance.reviewer`），不是 AD Group */
  role?: string;
  /** 多人审核规则 */
  strategy?: 'ANY' | 'ALL';
  /** 需要的批准票数 */
  required?: number;
  /**
   * 排除的审批主体。
   *
   * `initiator` = 发起人不能批自己发起的事（SoD）；`none` = 显式允许（仍受全局
   * `COPILOT_ALLOW_INITIATOR_APPROVAL` 限制，两个开关都开才真的放行）。
   */
  exclude?: 'initiator' | 'none';
}

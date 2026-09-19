# copilot-server-agent — 长期项目笔记

## 仓库结构
- `server/src/` 唯一后端：`routes/` → `services/` → `execution/` `human-tasks/` `approval/` `actions/` → `db/`。
- `server/src/wiring.ts` 是**唯一装配点**（决定用哪个后端、哪套实现），routes 从这里 import 单例。
- `server/skills/<name>/SKILL.md` 是技能目录；`client/` 是前端；`docs/architecture.md` 是设计真相源。

## 命令
- 测试：`npm --prefix server test`（node:test + tsx，无 vitest/jest）
- 类型：`npm --prefix server run typecheck`（src + test 两份 tsconfig）
- `server/dist/`、`client/dist/`、`/dist/` 已 gitignore —— 改 src 不用提交 dist。

## 身份与授权（三层，别混）
```
SKILL.md / ApprovalPolicy  →  业务角色（compliance.reviewer）
      ↓ RoleRegistry（server/src/identity/business-roles.ts + COPILOT_BUSINESS_ROLES）
Entra / AD Group object ID（用 ID 不用显示名）
      ↓ group membership（网关注入 x-user-groups；overage 由网关走 Graph 取全）
Principal { userId, roles, groups }
```
- 角色解析只有一条入口：`AuthorizationService.resolveRoles(principal)`（**同步、无 I/O**）。
  它被 `HumanTaskService.withTaskLock()` 的临界区包着，绝不能变成网络调用。
- 用到解析后角色的地方有**两处**：`ApprovalService.assertEligible`（能不能批）
  与 `HumanTaskService.isAssignee`（看不看得到）。加新授权点时别只改前者。
- `Principal.groups` 是 optional（本地开发/单测可不传），`principalFromHeaders` 总会填。

## Skill Flow（`@flow` / `@agent` / `@gate` / `@review` / `@action` / `@stop` / `@end`）
- 定义写在 `SKILL.md` 里，Markdown AST 解析（remark），**没有第二套 YAML/BPMN DSL**。
- 🧱 **四层流水线（不要合并、也不要再加第五层）**：
  `flow-parser.ts` → `FlowAst`（作者写了什么）→ `flow-validator.ts` → `FlowDefinition`
  （允许执行什么）→ `flow-analyzer.ts`（图的形状）→ `runner.ts`。
  类型在 `skills/flow-ast.ts`。CFG 只是 `flow-analyzer.ts` 里的 `Map<string, Set<string>>`，
  **不建 cfg.ts**。
- ⚠️ **AST 必须能携带不合法的内容**：`FlowAstAttr.value` 是原样字符串（不是
  `'ANY'|'ALL'`），否则 `strategy: all` 报不出"第 12 行不合法"；route 指向不存在的节点、
  未注册的 role 也照收。`@flow` 是 `flows[]`（可能 0 个或 2 个）。
  AST route 用 `{outcome, target, line}`，`FlowDefinition` 用 `{on, to}`，中间是接缝。
- `FlowIssue.severity?: 'error' | 'warning'`，**缺省 error**；`hasBlockingIssue()` 判定。
  三条控制流检查**刻意不重叠**：`node-unreachable`（start 走不到）、
  `no-terminal-path`（可达节点到不了终态）、`no-success-path`（**整条流程没有 @end**，
  warning）。环本身不报错。
- 结构错误存在时**不跑分析器**（边指向不存在节点会得出"这节点出不去"的错误结论）。
- 离线 lint：`npm --prefix server run flow:lint -- <SKILL.md|技能目录|技能根目录>`，
  用**与生产同一份**注册表与配置；输出 `path:line ERROR|WARN code  message`，error 退出码 1。
- `@subagent` 是 `@agent` 的旧名（parser 归一化）；**别动** SDK 的 `subagent.*` 事件，那是另一回事。
- `@agent <id>` 的 **id 必须等于技能目录名**（`findSkill` 按目录找），否则 `skill-missing`。
- 三个文件分工：`workflow/runner.ts`（状态机）/ `workflow/runtime.ts`（节点怎么执行）/
  `workflow/definition-provider.ts`（定义从哪来）。**不要**合并成一个 WorkflowEngine 接口。
- 保留属性：`@review`（role/strategy/required/exclude）、`@action`（role）、
  `@agent`（output/tools），**必须写在正文最前面**；parser 把属性区从正文剥掉。
- 🔒 **属性一律只能比服务端更严**（`attr-widens` / `role-not-allowed` / `agent-tools-widens`）：
  `@review role` 与注册表 `eligibleRoles` 取**交集**；`strategy` 只能 ANY→ALL；
  `required` 只能 ≥ 基策略；`exclude: none` 在基策略禁止自批时报错。
  注册表 `FlowReview` 是权威（`eligibleRoles` 必填 + `allowInitiator`）。
- ⚠️ **"更严"必要但不充分**：`ALL` 必须真的全员。`base ANY + strategy ALL + required 1`
  方向合法但语义是谎言。唯一共享定义 `requiredVotes({strategy,requiredCount,roleCount})`
  （`types.ts`）三处共用：`registerFlowReview` 启动即 throw、`reviewPolicyFor` 运行时 clamp、
  validator 出 `review-all-required`。`reviewBasePolicy()` 的 `ALL` 缺省值 = 角色数（**不是 1**）
  且**不 clamp**（clamp 掉就查不出矛盾）。比的是**生效后**的角色集。
- `@gate` 必须静态声明 `outcomes`（`gate-outcome-unrouted` / `gate-outcome-unknown`）；
  outcomes 非空/去重/归一化小写。**注册键一律小写**（`norm` + `requireName`）——
  只在查找侧归一化的话，含大写的注册永远查不到。
- `@agent output:` 走服务端 `FlowOutput` 完成契约（`success` ≠ 业务成功，不让 LLM 自评），
  **默认必填**（`COPILOT_WORKFLOW_REQUIRE_AGENT_OUTPUT` 默认 true）。
- 🔒 `@agent tools:` 里 **mcp/shell 是代码硬禁，不是配置默认**：
  `WORKFLOW_AGENT_ALLOWED_KINDS = ['read','write','url']`（`types.ts`），
  `parseAgentTools` 过滤 + `resolveAgentTools` 再取交集 + validator 无条件查
  （`agent-tools-forbidden`，与"超部署上限"的 `agent-tools-widens` **分开两个 code**）。
  `COPILOT_WORKFLOW_AGENT_TOOLS=mcp` **不再有任何效果**。
- 推进顺序：**先落 `stepStatus = running`，再执行节点**；执行完落 `{current: next, pending}`。
  中断恢复：`@agent`/`@gate` 可重放；`@action`/`@review` 落 failed 交人工核对
  （`admitInterruptedStep`）。`@review` 不重放的理由：其产物是人工任务，
  崩在 `waitingTaskId` 落库前时该产物在持久化状态里不可见。
- 🔑 **等待态落库顺序**（`@review`/`@action` 通用）：
  `create HumanTask → CAS 写 workflow=waiting + waitingTaskId → transition execution=waiting_for_approval`。
  **不能反过来** —— 反过来中间崩会得到 `execution=waiting_for_approval` + `workflow=running`
  的**不可判定**态。代价是可能留**孤儿任务**（靠过期+四重绑定自愈，不写清理器）；
  CAS 冲突时记 `workflow.orphan_task`（**别复用** `workflow.write.conflict`）。
- ⚠️ **`waitingTaskId` 记的是"任务被创建过"，不是"任务还没结束"** —— 对账必须**解引用**：
  `reconcileWaiting()` 回查 `humanTasks.get(taskId)`。同一个字段形状有两个来源：
  甲、崩在建任务与迁移之间（任务 open → 补迁移）；
  乙、崩在 `resumeInto()` 的 `ensureRunning` 与 CAS 写 `current=next` 之间
  （任务**已收敛** → 摆回 waiting_for_approval 后 `resumeFromTask()` 重放）。
  只看字段按甲处理 → 推回等待等一个永不再来的回调，而 `complete()` 在
  `waiting_for_approval` 下**静默 return** → **永久卡住**。乙还顺带覆盖
  "停机期间任务过期/取消、回调没送达"。查不到任务 → 落 failed，不瞎猜。
- ⚠️ **`failWorkflow()` 在等待态会抛"非法状态迁移"**：`ALLOWED_TRANSITIONS` 里
  `waiting_for_approval`/`waiting_for_input` 只有 `resuming/rejected/cancelled/expired`，
  **没有 `failed`**。它跑在收尾路径上 → 异常往上抛 → execution 反而永远停在等待态。
  必须走 `exitWaitingIfNeeded()`：等待态先补 `→ resuming`，再 `resuming → failed`。
  （`resumeFromTask()` 里"节点不存在"/"input_submitted"、`loadChecked()` 失败原本都会抛。）
- 契约：`runtime.runAction()` **只建任务，绝不碰 execution 状态**（单写者）。
  `ExecutionService.proposeAction()` 的 `workflow.deferWaitingTransition` 置位时
  只建任务+发事件就 return，不 transition、不发 `waitingForApproval`。
- 能力边界 `AgentCapability` 带 `executionId`；`tool-policy` Layer-0 先比
  `ctx.activeExecution()` 与 `capability.executionId`，**不匹配或 undefined 一律 deny**。
  ⚠️ **故意不**"忽略能力退回 session 策略" —— 退回等于把 mcp/shell 还给 agent。
- `loadSkill()` **每个候选只读一次**（匹配+frontmatter+hash 同一份字节），
  `definition-provider` 只用它，**不在执行期重新解析**（第二套解析路径 = 校验期与执行期可能不一致）。
- 单写者：`agent_execution.workflow_version` + `compareAndSwapWorkflowState()`。
  ⚠️ 该列**不在** `sql-repository.ts` 的 `COLUMNS` 里（否则整行 upsert 会写回旧值）。
  冲突 → `workflow.write.conflict` + 停止推进，**绝不落 failed**。
- 人工任务回调必须四重绑定（waitingTaskId / current / stepStatus / execution status），
  不匹配只写 `workflow.resume.rejected`，**不动状态**。
- 编排器未预期异常由 `runDetached()` 兜底落 failed（不能只 log，否则 execution 永远 running）。
- 校验先于执行：`POST /api/executions` 建之前跑 `validateSkillFlow`，不过就 400 + 行号。

## 改动习惯
- 注释写"为什么"，尤其是**反直觉的取舍**（例：为什么角色解析不放服务端、为什么允许环）。
- 失败一律 fail-closed：未登记的 actionType 拒绝、没配 group 的角色不授予、
  `@action role:` 越界直接 deny。
- 新配置项要在 `config.ts` 集中声明 + `test/config.test.ts` 加"非法值启动即失败"用例。

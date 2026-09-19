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
- `@gate` 必须静态声明 `outcomes`（`gate-outcome-unrouted` / `gate-outcome-unknown`）。
- `@agent output:` 走服务端 `FlowOutput` 完成契约（`success` ≠ 业务成功，不让 LLM 自评）；
  `@agent tools:` 收窄能力边界，上限 `COPILOT_WORKFLOW_AGENT_TOOLS`（默认 read,write,url，
  **不含 mcp/shell** —— 那两条是绕开 `@action` 审批的路）。
- 推进顺序：**先落 `stepStatus = running`，再执行节点**；执行完落 `{current: next, pending}`。
  中断恢复：`@agent`/`@gate` 可重放，`@action` 落 failed 交人工核对（`admitInterruptedStep`）。
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

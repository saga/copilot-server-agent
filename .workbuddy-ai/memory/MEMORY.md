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
- 保留属性只有 `@review`（role/strategy/required/exclude）与 `@action`（role），
  且**必须写在正文最前面**；parser 会把属性区从正文里剥掉。
- 推进顺序：**先落 `stepStatus = running`，再执行节点**；执行完落 `{current: next, pending}`。
  中断恢复：`@agent`/`@gate` 可重放，`@action` 落 failed 交人工核对（`admitInterruptedStep`）。
- 编排器未预期异常由 `runDetached()` 兜底落 failed（不能只 log，否则 execution 永远 running）。
- 校验先于执行：`POST /api/executions` 建之前跑 `validateSkillFlow`，不过就 400 + 行号。

## 改动习惯
- 注释写"为什么"，尤其是**反直觉的取舍**（例：为什么角色解析不放服务端、为什么允许环）。
- 失败一律 fail-closed：未登记的 actionType 拒绝、没配 group 的角色不授予、
  `@action role:` 越界直接 deny。
- 新配置项要在 `config.ts` 集中声明 + `test/config.test.ts` 加"非法值启动即失败"用例。

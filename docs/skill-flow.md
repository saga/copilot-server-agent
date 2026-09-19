# Skill Flow

Skill Flow 是在标准 `SKILL.md` Markdown 中加入少量保留关键字，用来描述一个 Skill 的**业务执行流程**。

它不负责定义 Agent Runtime、权限模型或企业安全边界，而只描述：

* 哪一步由 Agent 执行
* 哪一步由确定性规则判断
* 哪一步需要人工处理
* 哪一步执行业务动作
* 每一步完成后流向哪里
* 哪些情况直接结束流程

Skill Flow 采用普通 Markdown，不引入 BPMN、XML、YAML Workflow DSL 或复杂编程语言。

---

## 1. 设计原则

Skill Flow 遵循以下原则：

### 1.1 Markdown 优先

`SKILL.md` 首先仍然是一份给人阅读的 Skill 文档。

例如：

```md
# Investment Research

## Purpose

Analyze an investment opportunity and prepare a research report.

## Instructions

...
```

这些普通 Markdown 不参与 workflow execution。

只有使用保留格式：

```md
## @flow ...
## @agent ...
## @gate ...
## @review ...
## @action ...
## @stop ...
## @end ...
```

的部分具有机器可执行语义。

---

### 1.2 Workflow 只描述业务流程，不描述权限

Skill Flow 可以写：

```md
## @review investment-review
```

但不能写：

```md
eligibleRoles: portfolio-manager
```

也不能写：

```md
allow: portfolio-manager
```

原因是：

> `SKILL.md` 可以被 Agent / Skill 作者修改，但企业授权边界不能由 LLM 或 Skill 文本自行定义。

角色、权限、SoD、tenant、policy、审批资格等继续由服务端 registry / policy system 控制。

---

### 1.3 Agent 可以推理，但不能决定企业边界

`@agent` 表示：

> 这一阶段由 Copilot Agent 执行。

它可以：

* 阅读资料
* 调用工具
* 使用 MCP
* 生成分析结果
* 根据上下文进行推理

但不能自行决定：

* 是否满足合规要求
* 是否有审批权限
* 是否可以执行高风险动作
* 是否可以突破 Data Entitlement

这些由 `@gate`、`@review`、`@action` 对应的服务端逻辑决定。

---

### 1.4 Gate 必须是确定性的业务判断

`@gate` 表示：

> 对当前业务状态执行一个服务端定义的确定性判断。

例如：

```md
## @gate compliance
```

实际执行：

```text
Flow
  ↓
ComplianceGate
  ↓
Policy / Rules / External Decision Service
  ↓
pass / review / fail
```

而不是：

```text
LLM
  ↓
"I think this is compliant"
```

---

### 1.5 Review 表示真正的人工流程

`@review` 表示：

> 流程需要一个由服务端定义的 Human Task / Approval。

具体：

* 谁有资格审批
* 是否需要两人审批
* 是否要求 SoD
* 超时怎么办
* 是否允许代理人
* 是否允许委派

都不写在 Skill Flow 里，而由 `HumanTaskService` / `ApprovalService` / policy registry 决定。

---

### 1.6 Action 表示业务副作用

`@action` 表示：

> 当前节点要执行一个受控的业务操作。

例如：

```md
## @action publish
```

并不意味着 Agent 可以直接：

```text
POST /publish
```

而是：

```text
Skill Flow
   ↓
Action registry
   ↓
ActionIntent
   ↓
ActionPolicy
   ↓
Approval / Authorization
   ↓
ActionService
   ↓
Business mutation
```

因此：

> `@action` 是业务动作的声明，不是直接授予 Agent 执行权限。

---

### 1.7 实现分层：三个模型，各答一个问题

Skill Flow 的实现是**四层流水线**，每层只回答一个问题。这不是抽象洁癖 —— 每一层都
对应一条**必须单独成立**的不变量，混在一起就没法分别保证。

```text
                        SKILL.md
                            │
                            ▼
                   ┌─────────────────┐
                   │  flow-parser    │  语法层
                   └────────┬────────┘
                            ▼
                        FlowAst                 「作者**写了**什么」
                            │                   → skills/flow-ast.ts
                            ▼
                   ┌─────────────────┐
                   │ flow-validator  │  语义层（唯一需要注册表的层）
                   └────────┬────────┘
                            ▼
                     FlowDefinition             「系统确认这是什么、允许执行什么」
                            │                   → workflow/types.ts
                            ▼
                   ┌─────────────────┐
                   │  flow-analyzer  │  控制流层
                   └────────┬────────┘
                            ▼
                       issues / warnings
                            │
                            ▼
                     WorkflowRunner
```

| 层 | 输入 → 输出 | 回答 | 不做 |
| --- | --- | --- | --- |
| `flow-parser.ts` | Markdown → `FlowAst` | 作者写了什么 | 任何语义判断 |
| `flow-validator.ts` | `FlowAst` → `FlowDefinition` | 允许执行什么 | 图的分析 |
| `flow-analyzer.ts` | `FlowDefinition` → issues | 图的形状对不对 | 授权判断 |
| `runner.ts` | `FlowDefinition` → 状态推进 | 怎么跑 | 定义从哪来 / 节点怎么执行 |

#### 为什么 AST 必须允许携带"不合法的内容"

这是整个分层能不能成立的关键。`FlowAst` 里的 `strategy` 值就是原样的字符串，
**不是** `'ANY' | 'ALL'`：

```ts
interface FlowAstAttr {
  name: string;
  value: string;   // 原样值 —— `strategy: all` 也要能被记下来
  line: number;    // 属性自己的行号
}
```

如果 AST 提前把值"类型化"，那么 `strategy: maybe` 这种写法只有两个下场：强制转换
（把合法性的判定偷偷搬进语法层），或者丢掉。两者都会让校验器**报不出**
"你写的第 12 行不合法" —— 因为那一行已经不存在了。

同理，route 指向不存在的节点、`role:` 是个没登记的角色，AST 都照收不误。

#### 为什么不让 parser 顺手做语义判断

一旦 parser 开始"顺手"过滤，`FlowAst` 就不再是"作者写了什么"的忠实记录，而变成
"作者写的、且服务端认可的部分"。那时下游既拿不到问题，也说不出位置。

#### 为什么 `FlowDefinition` 不叫 AST

`FlowDefinition` 是**经过语义验证后的可执行模型**，它保证：

```text
route.target 一定存在
属性一定合法且已归一化
@gate / @review / @action 一定已注册
```

两个模型各自承担一条不变量，中间那次转换（校验器）就是"把 AST 提升为可执行模型"。

#### 为什么不再加一层（CST / IR / CFG 模型）

控制流分析需要的只是一张邻接表：

```ts
type Graph = Map<string, Set<string>>;
```

它就是 `flow-analyzer.ts` 里的一个局部变量，**不单独建 `cfg.ts`**。
一旦为图单独建模型，下一步就会有人想给它加节点属性、再加一层 lowering，
而这里真正需要的只是"能不能走到"。

#### 问题级别：`error` 阻断，`warning` 不阻断

```ts
interface FlowIssue {
  code: string;
  message: string;
  line: number;
  nodeId?: string;
  severity?: 'error' | 'warning';   // 缺省 = error
}
```

缺省是 `error`（新增检查默认拦住），要放宽必须显式写 `warning` —— 反过来会让新加的
检查静默失效。

三条控制流检查刻意**互不重叠**，否则同一个问题会被说两遍：

| code | 级别 | 含义 |
| --- | --- | --- |
| `node-unreachable` | error | 从 start 走不到这个节点，它永远不会被执行 |
| `no-terminal-path` | error | 从这个节点出发无法到达任何终态 —— 走进来就出不去 |
| `no-success-path` | warning | 整条流程**没有任何 `@end`**，只可能以失败收尾 |

`no-success-path` 只查"有没有 `@end` 这个节点"，不查"到不到得了"：后者与
`node-unreachable` 完全重叠（`@end` 到不了 ⇔ 它不可达），再报一条只是让人以为有两处要改。

**环本身不报错**（`research → review → research` 是打回重做的常态），真正要拦的是
**没有出口的环** —— 那恰好被 `no-terminal-path` 覆盖，用"活跃性"表达比"找环"更准，
也少一个概念。

#### 离线 lint

```bash
npm --prefix server run flow:lint -- server/skills
```

```text
server/skills/x/SKILL.md:18 ERROR node-missing-outcome  @agent research 缺少出口 fail 的 route
server/skills/x/SKILL.md:31 ERROR gate-outcome-unrouted  @gate compliance 声明的出口 review 没有 route
server/skills/x/SKILL.md:47 ERROR no-terminal-path  @gate retry 无法到达任何终态（@end / @stop）

✖ 3 errors —— 1 个 flow 已检查，2 个非 flow 技能已跳过
```

它不是"另写一套校验"：调用的就是运行时那三个函数，用的是**同一份**服务端注册表
（`flowRegistryLookup` / `businessRoleLookup`）与同一份配置。如果 lint 与运行时判定
有分歧，它给出的"通过"就是假的。

结构错误存在时**不报图的问题** —— 一条边指向不存在的节点时，分析器会得出
"这个节点出不去"这种**错误**结论。先修结构，再跑一次看逻辑，与编译器"先报语法
再报类型"是同一个节奏。

---

# 2. 保留关键字总览

当前只保留下面 7 个：

| 关键字       | 作用            | 是否执行代码 | 是否允许自然语言正文 |
| --------- | ------------- | -----: | ---------: |
| `@flow`   | 定义一个 workflow |      否 |          是 |
| `@agent`  | Agent 执行步骤    |      是 |          是 |
| `@gate`   | 确定性业务判断       |      是 |          是 |
| `@review` | 人工审核 / 审批     |      是 |          是 |
| `@action` | 受控业务动作        |      是 |          是 |
| `@stop`   | 明确终止流程        |      是 |          是 |
| `@end`    | 正常结束流程        |      是 |          是 |

不再使用：

```text
@subagent
@route
```

---

# 3. `@flow`

## 语法

```md
## @flow <flow-id>
```

例如：

```md
## @flow investment-review
```

`@flow` 是整个 workflow 的入口。

一个 Skill 中：

* 必须有且只有一个 `@flow`
* `flow-id` 必须唯一
* 必须包含一个 `start -> <node>` 路由
* `start` 必须指向一个存在的节点

例如：

```md
## @flow investment-review

start -> investment-research
```

---

## 作用

`@flow` 本身不执行 Agent。

它只定义：

> 整个业务流程从哪里开始。

---

# 4. `@agent`

## 语法

```md
## @agent <node-id>

<instructions>

- <outcome> -> <next-node>
- <outcome> -> <next-node>
```

例如：

```md
## @agent investment-research

Analyze the investment opportunity.

Review:

- company fundamentals
- valuation
- competitive position
- key risks

Produce a structured research result.

- success -> compliance
- fail -> research-failed
```

---

## 作用

`@agent` 表示：

> 这一阶段交给 Agent Runtime 执行。

在当前实现中，它由 Copilot SDK 执行一个 Agent turn。

因此：

```text
@agent
   ↓
Copilot SDK
   ↓
Agent reasoning
   ↓
Tool / MCP / Skill
   ↓
result
```

未来如果 Copilot SDK 自己提供更完整的 agent/sub-agent orchestration，也不影响 Skill Flow。

---

## Outcome

当前默认结果：

```text
success
fail
```

即：

```md
- success -> next
- fail -> failure
```

`@agent` 的业务意义不是“调用一个新的独立 Agent 实例”，而是：

> 当前流程进入一个 Agent execution step。

如果未来需要真正多 Agent，可以在 Agent Runtime 层实现，而不需要改变 Skill Flow 语法。

---

## 保留属性：`output` 与 `tools`

`@agent` 的正文最前面可以写两行保留属性（必须**紧跟标题**，否则会被当成 prompt 正文）：

```md
## @agent investment-research

output: non-empty
tools: read,url

使用本次会话已加载的 investment-research 能力完成研究。

- success -> compliance
- fail -> research-failed
```

### `output: <契约 id>` —— 完成契约

`turn 没有抛异常` **不等于** `业务上做完了`。模型因为权限、工具失败或 prompt 歧义回一句
“抱歉，我无法完成该任务”时，turn 同样是成功的 —— 于是一份空结论会一路走到发布审批。

所以完成条件由**服务端注册的确定性校验**判定，不由模型自评：

```ts
registerFlowOutput({
  name: 'non-empty',
  description: 'turn 必须产出非空内容',
  validate: ({ content }) => (content.trim() ? { ok: true } : { ok: false, reason: '空输出' }),
});
```

契约没过 → 走 `fail` 出口（**可路由**，不是编排器崩溃）。契约 id 必须在服务端注册，
SKILL.md 不能自己定义“什么叫做完了”（`registry-missing-output`）。

**默认强制**：每个 `@agent` 都必须声明契约，否则 `prepare()` 直接 400
（`agent-output-missing`）。理由就是上面那句 —— 没有契约时 `@agent success`
只等于“这次 turn 没抛异常”。迁移期可以用
`COPILOT_WORKFLOW_REQUIRE_AGENT_OUTPUT=false` 临时关掉，但那是例外而非常态。

### `tools: <权限类别>` —— 能力边界

流程把业务动作收敛到 `@action`（策略 → 审批 → hash/版本复核 → executor），
但 agent 手上还有工具：它完全可以不走 `@action`，直接调一个 MCP server 把研究报告发出去。
那样整条流程的审批就成了摆设。

所以 `@agent` 节点执行期间会套上一个能力边界：

```text
read    允许（只读无副作用）
write   允许（只能落在 session workspace 内，路径守卫仍然生效）
url     允许（出站请求另有 SSRF 检查 + 域名 allowlist）
shell   永久禁止 —— 命令可以绕过路径守卫触达任意外部系统
mcp     永久禁止 —— MCP server 就是外部业务系统，正是"绕开 @action"的路径
```

`mcp` / `shell` 是**代码里的不变式**（`WORKFLOW_AGENT_ALLOWED_KINDS`），不是配置：

```md
tools: read,mcp    # ❌ agent-tools-forbidden（与部署配置无关，永远拒绝）
tools: read,url    # ✅
```

这条区别很关键。做成“配置默认值不含 mcp”的话，把 `COPILOT_WORKFLOW_AGENT_TOOLS=mcp`
一写，`@agent` 就重新拿到了绕开审批的路径 —— 一条**环境变量**取消了整条流程的授权模型，
而 SKILL.md、审批记录、审计链上都看不出任何异常。所以：

- 配置只能在 `read` / `write` / `url` 之内选，写 `mcp` 会被直接丢掉（不生效）
- SKILL.md 的 `tools:` 只能在这个硬上限之上再**收窄**
- 超出**部署上限**是另一条规则（`agent-tools-widens`，改配置可以放开）
- 要真正放开 `mcp` / `shell`，必须改代码（一次代码评审）

这条与 `role:` 是同一条规则：SKILL.md 是会被 LLM 读到、也会被人随手改的文件，
不能靠它扩大授权面或能力边界。

---

# 5. `@gate`

## 语法

```md
## @gate <node-id>

<description>

- <outcome> -> <next-node>
```

例如：

```md
## @gate compliance

Evaluate whether the research package satisfies compliance requirements.

Use the registered compliance policy.

- pass -> investment-review
- review -> compliance-review
- fail -> compliance-rejected
```

---

## 作用

`@gate` 是：

> 确定性的业务判断节点。

它对应服务端注册的 `FlowGate`：

```ts
interface FlowGate {
  name: string;

  /** 该 gate 可能返回的**全部**出口名（静态声明） */
  outcomes: readonly string[];

  evaluate(ctx): Promise<{
    outcome: string;
    reason?: string;
  }>;
}
```

例如：

```text
@gate compliance
        ↓
ComplianceGate
        ↓
Compliance Policy
        ↓
pass / review / fail
```

`outcomes` 不是装饰：`@gate` 的出口不在固定词汇表里（pass / fail / review / again / escalate…），
没有这份声明，校验器只能等运行时才发现“gate 返回了 review，但 SKILL.md 里没有 review 的 route”
—— 而那时流程已经跑了一半。有了它，两个方向都能在**执行之前**查出来：

```text
声明的出口没有 route   → gate-outcome-unrouted（这条分支只能在运行时落 failed）
route 的出口没被声明   → gate-outcome-unknown（一条永远不会走到的死分支）
```

---

## 重要约束

`@gate` 的决定不能由 Skill 文本中的自然语言直接定义。

例如：

```md
## @gate compliance

The agent decides whether the investment is compliant.
```

这种写法虽然可以作为说明文字，但不能成为真正的 policy authority。

真正 authority 是：

```text
FlowGate Registry
Policy Engine
Rules
External Compliance Service
```

---

# 6. `@review`

## 语法

```md
## @review <node-id>

<description>

- approve -> <next-node>
- reject -> <next-node>
```

例如：

```md
## @review investment-review

The investment proposal requires human approval.

- approve -> publish
- reject -> investment-rejected
```

---

## 作用

`@review` 表示：

> 流程进入 Human Task。

它通常产生：

```text
HumanTask
    ↓
waiting
    ↓
approve / reject
    ↓
resume workflow
```

---

## 服务端负责什么

Skill Flow 不定义：

```text
who can approve
how many people
SoD
delegation
timeout
tenant
external approver
```

这些由：

```text
HumanTaskService
ApprovalService
Policy Registry
```

负责。

例如：

```text
@review investment-review
```

服务端可能实际配置：

```text
eligibleRoles:
  - portfolio-manager
  - investment-committee

strategy:
  ALL

requiredCount:
  2
```

这些配置不属于 Skill Flow。

---

## 保留属性：四个都**只能更严**

`@review` 的正文最前面可以写四行保留属性：

```md
## @review compliance-review

role: compliance.reviewer
strategy: ALL
required: 2
exclude: initiator

核对研究结论是否存在合规问题。

- approve -> publish
- reject -> compliance-rejected
```

| 属性 | 含义 | 相对服务端基策略 |
| --- | --- | --- |
| `role` | 审核业务角色（**不是 AD Group**） | 必须是基策略 `eligibleRoles` 的**子集**（交集） |
| `strategy` | `ANY` / `ALL` | 只能 `ANY → ALL`；且 `ALL` 必须真的全员（见下） |
| `required` | 需要几票 | 只能 **≥** 基策略的 `requiredCount` |
| `exclude` | `initiator`（禁止自批）/ `none` | 不能把基策略的禁止自批改成允许 |

### `strategy: ALL` 必须真的全员

`ANY` 与 `ALL` 的唯一区别落在**票数**上。所以 `strategy: ALL` 配 `required: 1`
（3 个资格角色）实际仍然只需要 1 票 —— 它只是**名字叫 ALL 的 ANY**。这种写法比写错
更危险：审批链上写着 `ALL`，没人会再去核对票数。

```md
strategy: ALL
required: 1      # ❌ review-all-required：生效角色有 3 个，ALL 要求 ≥3 票
```

规则是**票数必须覆盖全部生效角色**（`requiredVotes()`，`types.ts` 里唯一定义，
注册表 / 校验器 / runner 三处共用）：

| 场景 | 结果 |
| --- | --- |
| 基策略 `ANY` + 3 个角色 + `strategy: ALL` + `required: 1` | ❌ `review-all-required` |
| 同上但 `required: 3` | ✅ 全员通过 |
| 同上但 `required: 5` | ✅ 更严（票数只能加不能减） |
| `role: risk` 把角色收窄到 1 个 + `strategy: ALL` + `required: 1` | ✅ 1 个角色的全员就是 1 票 |
| 服务端注册 `strategy: 'ALL'` 但 `requiredCount: 1`（2 个角色） | ❌ **启动即失败**（`registerFlowReview`） |
| 服务端注册 `strategy: 'ALL'` 不写 `requiredCount` | ✅ 缺省 = 角色数（不是 1） |

判定用的是**生效值**（`role` 收窄之后），而不是 SKILL.md 的字面值。
runner 在运行时还会再 clamp 一次（`reviewPolicyFor`）：校验器可能没被调用
（比如直接构造 `WorkflowState`），那一道是 fail-closed 的最后防线。

服务端注册的基策略才是**权威**：

```ts
registerFlowReview({
  name: 'compliance-review',
  title: '合规审核',
  eligibleRoles: ['compliance.reviewer', 'risk'],   // 权威来源
  strategy: 'ANY',
  requiredCount: 1,
  allowInitiator: false,                             // SoD
});
```

SKILL.md 是在它之上做收窄，**不能放宽**。四条违规各自有独立的 issue code
（`role-not-allowed` / `attr-widens`）。

这条规则的由来：SKILL.md 会被 LLM 读到、也会被人随手改。如果它能**覆盖**基策略，
那么一个 Markdown 文件就能把“要 3 个人批”降成“1 个人批”，
把“投资委员会”换成任意一个角色 —— 企业审批要求不该由一个文本文件决定。

注意 `role:` 只能写**业务角色 id**（`compliance.reviewer`）。写 AD Group 名或 object ID
会直接被形态校验拒掉：角色到 Entra group 的映射在服务端 `COPILOT_BUSINESS_ROLES`，
换组、改组名都不该要求改 SKILL.md。

---

# 7. `@action`

## 语法

```md
## @action <node-id>

<description>

- success -> <next-node>
- fail -> <next-node>
```

例如：

```md
## @action publish

Publish the approved research report.

- success -> completed
- fail -> publish-failed
```

---

## 作用

`@action` 是：

> 一个具有业务副作用的受控操作。

它对应：

```ts
FlowAction
```

例如：

```text
@action publish
       ↓
ActionRegistry
       ↓
ActionIntent
       ↓
ActionPolicy
       ↓
ActionService
```

---

## 为什么不让 Agent 直接执行

因为：

```text
Agent decision
```

和：

```text
Business authorization
```

必须分离。

典型流程：

```text
Agent
  ↓
propose ActionIntent
  ↓
Policy
  ↓
Approval
  ↓
ActionService
  ↓
Mutation
```

这也是整个设计里最重要的安全边界之一。

---

## 保留属性：`role`

```md
## @action publish

role: investment.reviewer

Publish the approved research result.

- success -> completed
- fail -> publish-failed
```

含义与 `@review role:` **不同**：这里是把该动作类型的审批资格**收窄**到声明的业务角色。

```text
ApprovalPolicy(actionType).eligibleRoles  ∩  { role: }   =  生效的审批角色
```

交集为空 → `ActionService` 直接拒绝（`decision: 'denied'`），流程走 `fail` 出口。
所以 `@action role:` 写一个策略里没有的角色，效果是**动作被拒**，而不是“换一个角色来批”。

同样只能收窄：SKILL.md 不能让一个本来只需要 `operations` 批的动作变成需要 `investment.reviewer`。

另外，声明了 `role:` 的动作**不走 auto_approve**：否则一个环境变量就能绕过
流程里写明的审批要求（`COPILOT_AUTO_APPROVE_ACTIONS` 只对没写 `role:` 的动作生效）。

---

# 8. `@stop`

## 语法

```md
## @stop <node-id>

<description>
```

例如：

```md
## @stop compliance-rejected

The research package cannot continue because compliance requirements were not satisfied.
```

---

## 作用

`@stop` 表示：

> 明确终止流程，并且不是正常完成。

例如：

```text
research
   ↓
compliance
   ↓
fail
   ↓
compliance-rejected
   ↓
FAILED
```

---

## 约束

`@stop`：

* 不需要 route
* 不能有 route
* 不允许继续执行下一个 node

它是 terminal node。

---

# 9. `@end`

## 语法

```md
## @end <node-id>

<description>
```

例如：

```md
## @end completed

Investment research and publication completed successfully.
```

---

## 作用

`@end` 表示：

> 正常结束流程。

例如：

```text
publish
   ↓
success
   ↓
completed
   ↓
COMPLETED
```

和 `@stop` 的区别是：

```text
@stop
→ abnormal / rejected / failed terminal

@end
→ successful / normal terminal
```

---

# 10. Route

目前不增加 `@route`。

Route 直接使用：

```md
- <outcome> -> <target>
```

例如：

```md
- success -> compliance
- fail -> research-failed
```

这样做的原因是：

> Route 是节点的一部分，而不是一个独立业务实体。

---

## Route 规则

### 普通节点

```md
- success -> xxx
- fail -> yyy
```

### Gate

可以有多个 outcome：

```md
- pass -> xxx
- review -> yyy
- fail -> zzz
```

### Review

默认：

```md
- approve -> xxx
- reject -> yyy
```

### Stop / End

不能有 route。

---

## Route outcome 必须唯一

例如下面这种定义应当报错：

```md
- pass -> a
- pass -> b
```

因为运行时不能依赖“第一条 route 优先”。

Validator 应直接报告：

```text
duplicate route outcome: pass
```

---

# 11. 一个完整 Skill 的结构

推荐结构：

```md
# Skill Name

## Purpose

...

## Instructions

...

## @flow business-flow

start -> first-step

## @agent first-step

...

- success -> next-step
- fail -> failed

## @gate next-step

...

- pass -> review
- review -> manual-review
- fail -> rejected

## @review manual-review

...

- approve -> review
- reject -> rejected

## @review review

...

- approve -> action
- reject -> rejected

## @action action

...

- success -> completed
- fail -> action-failed

## @stop failed

...

## @stop rejected

...

## @stop action-failed

...

## @end completed

...
```

---

# 12. Sample 1：Investment Research

这个例子对应目前 repo 的实际 `investment-research` 场景。

```md
# Investment Research

## Purpose

Analyze an investment opportunity, perform compliance checks,
obtain the required investment approval, and publish the approved research.

## Instructions

When performing research:

- use approved research sources
- distinguish facts from assumptions
- identify material risks
- cite important evidence
- do not make investment decisions on behalf of an authorized reviewer
- do not publish content directly

## @flow investment-review

start -> investment-research

## @agent investment-research

output: non-empty

Analyze the investment opportunity.

Cover:

- company fundamentals
- valuation
- competitive position
- market context
- material risks
- key assumptions

Produce a structured research package.

The result must contain enough evidence for downstream compliance
and human review.

- success -> compliance
- fail -> research-failed

## @gate compliance

Evaluate the research package against the registered compliance policy.

Check, where applicable:

- required evidence exists
- restricted information rules
- disclosure requirements
- prohibited content
- mandatory disclaimers

The gate decision must come from the registered compliance policy,
not from the Agent.

- pass -> investment-review
- review -> compliance-review
- fail -> compliance-rejected

## @review compliance-review

A compliance reviewer must resolve the compliance issue.

The reviewer may:

- approve continuation
- reject the research package

- approve -> investment-review
- reject -> compliance-rejected

## @review investment-review

The investment proposal requires human approval.

The reviewer should evaluate:

- research quality
- investment thesis
- material risks
- valuation assumptions
- compliance result

- approve -> publish
- reject -> investment-rejected

## @action publish

Publish the approved research report.

The operation is executed only through the registered
publish action and its associated authorization policy.

- success -> completed
- fail -> publish-failed

## @stop research-failed

Research could not be completed.

The workflow must remain in a failed terminal state
and preserve the execution evidence.

## @stop compliance-rejected

The research package did not satisfy the required compliance conditions.

## @stop investment-rejected

The required investment approval was not granted.

## @stop publish-failed

The investment research was approved but publication failed.

## @end completed

The research was approved and successfully published.
```

---

# 13. Sample 2：Proxy Voting

这个例子更能体现：

```text
Agent
+
deterministic gate
+
human approval
+
controlled action
```

而且比较适合金融业务。

```md
# Proxy Voting

## Purpose

Review a proxy voting item, prepare a voting recommendation,
obtain the required approval, and submit the approved vote.

## Instructions

When reviewing a proxy item:

- use approved issuer and meeting information
- identify the resolution and voting deadline
- summarize relevant research
- identify conflicts and escalation requirements
- never submit a vote directly
- do not bypass approval requirements

## @flow proxy-vote

start -> voting-analysis

## @agent voting-analysis

Analyze the proxy voting item.

Determine:

- meeting information
- resolution
- proposed voting position
- supporting evidence
- relevant policy considerations
- potential conflicts
- required escalation

Prepare a voting recommendation.

The recommendation is advisory and does not itself authorize submission.

- success -> policy-check
- fail -> analysis-failed

## @gate policy-check

Evaluate the recommendation against the registered proxy voting policy.

Check:

- policy coverage
- restricted issuer conditions
- conflict requirements
- escalation requirements
- filing deadline
- required supporting information

Possible outcomes:

- pass -> approval
- review -> escalation-review
- fail -> policy-rejected

## @review escalation-review

A designated compliance or governance reviewer must resolve
the policy escalation.

- approve -> approval
- reject -> policy-rejected

## @review approval

The voting instruction requires human approval.

The approval authority is determined by the server-side
eligibility and segregation-of-duties policy.

- approve -> submit-vote
- reject -> vote-rejected

## @action submit-vote

Submit the approved voting instruction through the registered
proxy voting action.

The action must:

- revalidate the approval
- verify the action hash
- verify the current voting instruction version
- enforce the action policy
- use an idempotency key
- record the submission result

- success -> completed
- fail -> submission-failed

## @stop analysis-failed

The voting recommendation could not be completed.

## @stop policy-rejected

The proposed voting instruction does not satisfy the applicable policy.

## @stop vote-rejected

The required human approval was not granted.

## @stop submission-failed

The vote was approved but could not be submitted successfully.

## @end completed

The approved proxy vote was successfully submitted.
```

---

# 14. 两个 Sample 的结构其实是完全一致的

虽然业务不同：

```text
Investment Research
```

和：

```text
Proxy Voting
```

最后都可以抽象成：

```text
@agent
   ↓
@gate
   ↓
@review
   ↓
@action
   ↓
@end
```

遇到问题：

```text
@agent
   ↓
@stop

@gate
   ↓
@stop

@review
   ↓
@stop

@action
   ↓
@stop
```

这正是目前这套 DSL 应该覆盖的范围。

---

# 15. 当前版本不要再继续增加关键字

暂时不要增加：

```text
@parallel
@loop
@condition
@subflow
@retry
@wait
@timeout
@human
@tool
@route
@policy
@permission
```

这些都很容易导致 DSL 膨胀。

例如：

```text
@retry
```

应该由 runtime / execution policy 处理，而不是 Workflow DSL。

```text
@permission
```

应该由 authorization / policy system 处理。

```text
@tool
```

应该由 Copilot SDK / MCP / tool registry 处理。

```text
@human
```

已经由 `@review` 表达。

```text
@route
```

已经由：

```md
- success -> next
```

表达。

---

# 16. 最终语义模型

因此整个 Skill Flow 可以压缩成一句话：

> **Agent 负责工作，Gate 负责判断，Review 负责审批，Action 负责副作用，Stop / End 负责终止状态，Flow 负责把它们连接起来。**

对应关系：

```text
@flow
  ↓
Business Process

@agent
  ↓
Agent Execution

@gate
  ↓
Deterministic Decision

@review
  ↓
Human Task / Approval

@action
  ↓
Authorized Business Mutation

@stop
  ↓
Failed / Rejected Terminal State

@end
  ↓
Successful Terminal State
```

而企业安全边界始终在 Skill Flow 之外：

```text
                 SKILL.md
                    │
             Skill Flow DSL
                    │
          ┌─────────┴─────────┐
          ↓                   ↓
     Agent Runtime       Business Policy
          ↓                   ↓
    Copilot SDK        Authorization / SoD
          │                   │
          └─────────┬─────────┘
                    ↓
               HumanTask
                    ↓
                Approval
                    ↓
              ActionService
                    ↓
              Business System
```

**这就是目前我建议固定下来的版本：`@flow / @agent / @gate / @review / @action / @stop / @end`。**

其中最关键的命名变化就是：

```text
@subagent  →  @agent
```

因为 Skill Flow 描述的是“这一步由 Agent 执行”，而不是要求 Skill DSL 自己定义什么叫 sub-agent；真正的 agent / sub-agent 层次应该交给 Copilot SDK 本身处理。

---

# 17. 运行时加固：不确定性的来源

前面 16 节描述的是**语义**。这一节描述的是**运行期**：一个已经跑起来的流程，
在进程崩溃、并发推进、人工任务乱序到达时，怎么保证它不会悄悄走错一步。

每一条对应一种不确定性 —— 状态机的不确定性（17.1 / 17.2 / 17.3 / 17.6）、
接口边界的不确定性（17.4）、授权面的不确定性（17.5 / 17.7）、
以及“校验的和执行的到底是不是同一份东西”（17.8 / 17.9）。

## 17.1 步骤持久化：`current` 一个字段是不够的

每一步的顺序是：

```text
先把 stepStatus = running 落库  →  再执行那个节点  →  执行完把 current 推到下一个节点并落回 pending
```

```ts
type WorkflowStepStatus = 'pending' | 'running' | 'waiting' | 'completed';
```

只有 `current` 时，“这一步跑没跑完”是不可知的。进程在“跑完但状态没落库”之间退出，
重启后只能靠猜：

```text
提前写 current = next   →  会跳过 一个其实没执行完的步骤
不提前写                →  会重放 一个可能已经产生副作用的步骤
```

两种做法都只是把不确定性挪了个位置。所以状态里多一个 `stepStatus`，把顺序显式表达成
`pending → running → pending`，crash 恢复才能明确回答：

> publish 已经开始过，但它完成了没有？

恢复策略按节点类型分（`admitInterruptedStep()`）：

| 节点 | 有副作用？ | 中断后 |
| --- | --- | --- |
| `@agent` / `@gate` | 否（纯计算） | 记一条审计后**允许重放** |
| `@action` | 是 | **不自动重放**，落 failed 交人工核对 |

幂等键 `action:<executionId>:<actionHash>` 只能防**重复提交**，防不了
“外部系统已经生效、但本地没记上” —— 所以有副作用的步骤必须交给人。

## 17.2 单写者：两个推进者不能同时改状态

`workflow_state` 的写入是“读 → 合并 → 整行 upsert”。两个推进者并发时
（重启恢复 + 人工任务回调，或两个 Pod），后写的会把先写的**整段覆盖掉**：

```text
某一步被跳过 / 步数回退 —— 而审计链上看不出任何异常
```

所以加一个乐观锁版本号 `agent_execution.workflow_version`，写入变成条件更新：

```sql
update agent_execution
   set workflow_state = $1, workflow_version = workflow_version + 1
 where execution_id = $2 and workflow_version = $3
```

只有一个写者能命中。拿不到版本的那个**停止推进并留痕**（`workflow.write.conflict`），
但**绝不落 failed** —— 冲突说明有别人正在推进这个 execution，落终态等于把对方跑着的流程打死。

版本号只由 CAS 语句抬高，不参与整行 upsert：否则一次 usage 更新就能把它写回旧值。

进程内另有一把按 `executionId` 的串行锁：CAS 是跨副本的正确性保证，
这把锁让“恢复推进”与“人工任务回调”不在同一进程里交错。

## 17.3 人工任务回调必须与 durable 状态绑定

一条人工任务收敛后，回调必须证明自己**就是当前这一步在等的那个任务**。四件事同时成立才续跑：

```text
state.waitingTaskId === task.taskId      这条任务就是 durable 状态里记的那条
state.current       === marker.nodeId    流程还停在任务所属的那个节点上
state.stepStatus    === 'waiting'        这一步确实在等人工
rec.status          === 'waiting_for_approval'  execution 确实在等审批
```

任一条不成立 → 只写一条 `workflow.resume.rejected` 审计事件，**不动状态**。

没有这一步，一条过期 / 重复 / 串台的任务回调就能把流程往前推一格 —— 而推错之后的状态
**是自洽的**，审计链上也看不出问题，没人能发现它推错了。

## 17.4 接口边界：两条独立的变化轴

编排器只做四件事：**推进状态、落库、路由、把人工任务接回来**。另外两件事拆出去了：

```text
definition-provider.ts   流程定义从哪来、怎么校验、怎么确认版本没变
runtime.ts               一个 @agent / @gate / @action / @review 具体怎么执行
runner.ts                状态怎么推进、什么时候落库、冲突怎么办
```

刻意**不**做成一个大的 `WorkflowEngine` 接口：定义来源与节点执行是两个独立的变化轴
（多租户按 tenant 取定义 vs. 把 agent 换成真正的 subagent 委派），
合成一个接口只会让两边互相牵扯。

## 17.5 核心不变量（一直成立，这一节没有改变它）

> **LLM 永远不能决定 Workflow State Transition。**

走向只由两样东西决定：durable 状态里的 `state.current`，以及该节点声明的 `node.routes`。

- `@gate` 的结果来自服务端注册的确定性函数
- `@action` 的审批资格来自 ApprovalPolicy，不是 SKILL.md 的自然语言
- `@review` 的四个属性只能比服务端基策略更严
- `@agent` 只能走 `success` / `fail`，且 `success` 要先过服务端注册的完成契约
- `@agent` 执行期间套着能力边界（**永远**碰不到 MCP 与 shell）——
  否则它可以绕开 `@action` 直接对外产生副作用

## 17.6 进入等待态的顺序：先落 workflow，再迁移 execution

`@review` / `@action` 进入等待态是**三步**，顺序不能换：

```text
1. 建人工任务（拿到 taskId）
2. CAS 落 workflow.stepStatus = waiting + waitingTaskId
3. 把 execution 迁移到 waiting_for_approval
```

先做 3 再做 2 会留下一个**不可判定**的崩溃窗口：

```text
execution = waiting_for_approval   +   workflow.stepStatus = running
```

恢复时“这一步在等人工”和“这一步要重放”**同时成立** —— 没有任何字段能判断该信哪个。
信前者会漏掉一步，信后者会重复提交（`@action` 那一步可能已经发出去过）。

按上面的顺序，崩溃留下的最长是 `stepStatus = waiting` + `execution = running`。
那是一个**可判定**的状态：任务确实已经建出来了，只需要把它接回来
（`reconcileWaiting()`，重跑时补一次 `waiting_for_approval` 迁移 + 一条
`workflow.waiting.reconciled` 审计），然后等任务回调。

为什么这件事必须由编排器做、而不是让 `ExecutionService` 顺手迁完：两个写者
（执行器 + 编排器）都改 execution 时，崩溃窗口里的状态是**不可判定**的。
状态机的所有权必须只有一份 —— 所以 `runtime.runAction()` 的契约是
“只建审批任务、绝不改 execution 状态”。

代价：2 与 3 之间崩溃会留下一条**孤儿人工任务**（流程那边会重新走一遍）。
这是刻意选的 —— 任务会自然过期，过期回调也会被 17.3 的绑定校验拦下；
而“流程状态不可判定”是没法靠超时自愈的。

### 17.6.1 `waitingTaskId` 说的是“任务被创建过”，不是“任务还没结束”

上面那个形状 `running` + `stepStatus = waiting` + `waitingTaskId = T` **不止一个来源**：

| 来源 | T 的状态 | 该怎么办 |
| --- | --- | --- |
| 甲：崩在“落 waiting”与“迁移 execution”之间 | `open` | 接回等待态，等回调 |
| 乙：崩在续跑的“推出等待态”与“CAS 写 `current = next`”之间 | **已收敛** | 把那次续跑补完 |

乙之所以存在，是因为**退出等待态**也是分两步的（`resumeInto()`）：

```text
ensureRunning(): waiting_for_approval → resuming → running
updateWorkflowState(current = next, stepStatus = pending)   ← CAS
```

崩在两步之间就留下甲的形状，但 T 已经批完了 —— 那次续跑正是在处理它。

只看 durable 字段、一律按甲处理的话，会把 execution 推回 `waiting_for_approval`
去等一个**永不再来的回调**；而 `waiting_for_approval` 下 `complete()` 是**静默 return** 的
（见 `ExecutionService.complete`），于是这条流程**永久卡住**，连超时都救不回来
（超时只对 `open` 的任务产生回调）。换句话说：可判定性不等于判定正确 ——
判定必须包含**回查任务本身的终态**。

所以 `reconcileWaiting()` 回查 `humanTasks.get(taskId)`，按三种结果分派：

| 任务的当前状态 | 动作 |
| --- | --- |
| `open` | 甲：补一次 `waiting_for_approval` 迁移，等回调 |
| `approved` / `rejected` / `expired` / `cancelled` | 乙：摆回 `waiting_for_approval` 以满足四重绑定，再**原样重放** `resumeFromTask()`（幂等） |
| 查不到 | durable 状态与任务对不上 → 落 failed，不瞎猜 |

第二行顺带覆盖了**停机期间任务自然过期 / 被人取消、回调没有送达**的情况：
恢复时自己发现任务已收敛，按它收敛的方式把 execution 落终态（`expired` / `cancelled`），
而不是留着等一个不会来的回调。

### 17.6.2 收尾路径必须能合法地退出等待态

`ALLOWED_TRANSITIONS` 里 `waiting_for_approval` / `waiting_for_input` 的出口是
`resuming / rejected / cancelled / expired` —— **没有 `failed`**。

于是 `failWorkflow()` 在等待态被调用时会抛“非法状态迁移”。而它跑在**收尾路径**上：
异常往上抛的结果是 execution **反而永远停在等待态**（`runDetached` 的兜底 catch
再调一次 `fail()` 还是同一个异常，只剩一行日志）。而“状态与任务对不上”这类内部不一致
恰恰最常发生在等待态 —— 也就是说，最需要落 failed 的地方正好落不下去。

所以 `failWorkflow()` 先调 `exitWaitingIfNeeded()`：状态在等待态时补一次
`→ resuming`，再走 `resuming → failed`（这条边表里已有，语义也对 ——“本来要恢复，恢复不了”）。

## 17.7 能力边界属于哪条 execution

`@agent` 的能力边界是**会话级存放、execution 级生效**的（`capability.ts`）：

```ts
interface AgentCapability { executionId: string; nodeId: string; flow: string; kinds: Set<...> }
```

工具授权上下文在建会话时就固定了，而 `@agent` 节点是在会话生命周期**中间**跑的，
没法烘进 session config —— 所以按 `sessionId` 存一份，权限回调每次现取。

但一条会话会先后（甚至排队）承载多条 execution。只按 `sessionId` 取一份，
A 的边界就会作用到 B 上：A 的节点允许 `write`、B 的节点只声明了 `read`，
B 却拿到了 `write` —— 一次**跨 execution 的能力放宽**，而审计链上只会看到
“B 用了 write 工具”，看不出是边界串了台。

所以权限回调（`tool-policy.ts` 第 0 层）先对账一次：`capability.executionId`
必须等于当前正在跑的 executionId，否则**拒绝**。

对不上必须拒绝，而不是“忽略这份边界、退回会话策略”：会话策略本来就允许 mcp / shell，
退回等于把它们重新交回 agent 手上 —— 那正是这一层要挡的东西。拒绝会让问题立刻可见，
包括“未来的某个 runtime 忘了设 execution 上下文”这种会让边界**静默失效**的改法。

清除时同样要比对 `executionId + nodeId`：`@agent` 的 `finally` 在 turn 槽**外面**跑，
槽一释放，同一会话里的下一条 execution 就可能已经设上自己的边界了。

## 17.8 定义只读一次：`read → hash → parse → validate`

`sourceHash` 的唯一用途是回答“这个执行还在用建立时那一版流程定义吗”。
如果**解析用的内容**与**算哈希的内容**来自两次读，文件在两次读之间被替换就会得到
一份自相矛盾的结果：

```text
定义来自旧版本、哈希来自新版本（或者反过来）
```

之后 `reload()` 会判定“版本没变”而放行，流程继续跑在一个**从未被校验过**的定义上，
审计链上完全看不出来。

所以 `loadSkill()` 只读一次文件，那次读同时用于：匹配技能名、解析 frontmatter、算哈希；
解析与校验全部消费同一份 `markdown`。

同理，`runAgentStep()` **不再**回头调 `findSkill()` 做存在性检查 —— 那是第二条解析路径
（`findSkill` 会把每个候选 SKILL.md 重读一遍、重新解析 frontmatter），
会让“校验时看到的定义”和“执行时用的定义”变成两份内容。技能是否存在已经在校验期
查过（`hasSkill`），而且每次 resume 都会重新校验一遍。

## 17.9 注册表在启动时就自洽

四张注册表（gate / review / action / output）的错误都是**静默失效**型的，
所以它们在登记时就校验，宁可让进程起不来：

| 登记 | 校验 |
| --- | --- |
| `registerFlowGate` | `outcomes` 非空、不重复、归一化成小写（route 出口名由 parser 统一小写，写 `PASS` 会永远匹配不上） |
| `registerFlowReview` | `eligibleRoles` 非空（空 = 建出来的任务没人有资格批，流程挂到超时）、`requiredCount ≥ 1`、`ALL ⇒ requiredCount ≥ 角色数` |
| 全部 | 登记名归一化成小写（查找侧一律 `norm`，登记侧不归一化 = 大小写不同就查不到） |


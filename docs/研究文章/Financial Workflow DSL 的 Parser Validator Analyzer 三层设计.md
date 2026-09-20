# Financial Workflow DSL 的 Parser / Validator / Analyzer 三层设计

## 一、为什么金融 Workflow DSL 不能只有一个 Parser

把金融 Workflow 做成 DSL，真正困难的地方通常不是“怎么定义 YAML”。

真正困难的是：

> **一段 Workflow DSL，到底应该经过哪些阶段，什么时候才算“可以运行”？**

一个很常见的实现是：

```text
workflow.yaml
    ↓
parse
    ↓
Workflow Object
    ↓
execute
```

这在简单自动化工具里可能足够，但金融 Agent Workflow 往往还需要回答：

* 这个节点类型合法吗？
* 节点之间的数据类型匹配吗？
* 是否存在不可达节点？
* 是否存在没有终点的路径？
* 是否存在无限循环？
* Agent 是否要求 Evidence，但 Workflow 没有提供？
* Side Effect 前是否存在必要的 Policy Gate？
* Human Approval 的角色是否满足职责分离？
* Tool 是否存在？
* Skill / Policy / Workflow 是否全部 pin 到明确版本？
* 某条路径是不是可能绕过审批？
* Replay 所需的历史输入是否可保存？
* 该 Workflow 是否允许进入 Production？
* 这个变化是否需要更高等级的审批？

这些已经不是 parser 的问题。

因此，一个适合金融场景的 Workflow DSL，至少应该有三层：

```text
                Workflow Source
                      │
                      ▼
                ┌───────────┐
                │  Parser   │
                └─────┬─────┘
                      │
                Syntax AST
                      │
                      ▼
                ┌───────────┐
                │ Validator │
                └─────┬─────┘
                      │
             Valid Semantic Model
                      │
                      ▼
                ┌───────────┐
                │ Analyzer  │
                └─────┬─────┘
                      │
          Graph / Data / Policy /
          Security / Risk Findings
                      │
                      ▼
                Execution IR
```

这三层并不是为了“把系统做复杂”。

相反，它们的目的，是把三个不同问题明确分开：

> **Parser 回答“这是什么”；Validator 回答“这是否合法”；Analyzer 回答“它在企业上下文中意味着什么”。**

这一区分是整个设计的核心。

---

# 二、先看成熟系统：这三层其实已经存在，只是名字不完全一样

现代 Workflow 产品很少真的只有一个“parse”。

AWS Step Functions 使用 Amazon States Language（ASL）描述 State Machine；AWS 提供专门的 `ValidateStateMachineDefinition` API，可以在创建 State Machine 之前检查定义，并返回 `ERROR` / `WARNING` diagnostics。AWS 官方明确建议把这类检查接入 code review、CI 或 pre-commit；同时也明确把其中一部分能力称为 static analysis。

Microsoft Agent Framework 的 Declarative Workflows 使用 YAML 定义 Workflow，并将 YAML 转换成 executable workflow graph；其 Workflow Builder 在构建时会检查消息类型兼容性、图连通性、executor binding、重复或非法 edge 等问题。

Camunda 的 Web Modeler 则把 BPMN 模型检查拆成大量 design-time lint rules，例如 element type、FEEL、called element、error reference、infinite loop 等；它还支持在 CI 中通过 `bpmnlint` / `dmnlint` 自动验证模型。

Open Policy Agent 更是一个非常清楚的例子：`opa check` 负责 Rego 的 parse 和 compile error 检查，同时还可以结合 schema 与 strict mode；Policy Bundle 还可以进行完整性和签名验证。

因此本文提出的三层不是一个纯粹理论上的分类，而是对已有工程实践做出的架构抽象：

```text
Parser
≈ syntax / structural parsing

Validator
≈ definition / schema / local correctness checks

Analyzer
≈ graph-wide / semantic / policy / risk analysis
```

不同产品会把其中若干能力合并在同一个 API 或工具中，但**架构责任最好不要合并**。

---

# 三、Parser：只负责把“文字”变成“结构”

## 3.1 Parser 的职责应该非常克制

Parser 最核心的任务：

```text
Source Text
    ↓
Syntax Tree / AST
```

它回答：

> **“输入的 Workflow DSL 在语法上表达了哪些节点、字段和关系？”**

例如：

```yaml
workflow:
  id: trade-review

  nodes:
    - id: load_client
      type: task
      action: client.load

    - id: risk_review
      type: agent
      skill: risk-review@7.2
```

Parser 应该识别：

```text
Workflow
├── id = trade-review
└── nodes
    ├── Node
    │   ├── id = load_client
    │   ├── type = task
    │   └── action = client.load
    └── Node
        ├── id = risk_review
        ├── type = agent
        └── skill = risk-review@7.2
```

它不应该在这个阶段判断：

```text
risk_review 是否需要 Evidence
```

也不应该判断：

```text
submit_trade 是否需要审批
```

这些都属于后面的 Validator / Analyzer。

---

# 四、为什么 Parser 不应该承担 Business Logic

很多第一版 DSL 实现会直接这样做：

```typescript
parseWorkflow(text)
```

里面顺便：

```typescript
if (node.type === "side_effect" && !node.approval) {
    throw new Error(...)
}
```

这会产生一个长期问题：

> **语法解析器开始变成业务规则引擎。**

最终会演化成：

```text
Parser
 ├── YAML parsing
 ├── schema checking
 ├── business rule checking
 ├── policy lookup
 ├── security validation
 ├── version lookup
 └── deployment checking
```

结果是：

```text
Parser
=
God Object
```

以后 DSL 一升级，所有业务规则都被绑死在 parser 中。

更合理：

```text
Parser
    ↓
AST
    ↓
Validator
    ↓
Analyzer
```

---

# 五、Parser 的输出最好不是直接 Runtime Object，而是 Syntax AST

一个推荐的模型：

```text
Markdown / YAML / JSON
          │
          ▼
     Concrete Syntax
          │
          ▼
       Syntax AST
```

这里的 Syntax AST 主要保留：

* 节点类型
* 字段
* source location
* line / column
* comments（如需要）
* source span

例如：

```json
{
  "kind": "Workflow",
  "id": "trade-review",
  "location": {
    "line": 1,
    "column": 1
  },
  "nodes": [
    {
      "kind": "AgentNode",
      "id": "risk_review",
      "location": {
        "line": 8,
        "column": 5
      }
    }
  ]
}
```

`location` 很重要。

因为 Validator / Analyzer 最终应该能够返回：

```text
workflow.yaml:17:5
ERROR
side_effect node "submit_trade"
has no policy gate
```

而不是：

```text
ERROR
invalid workflow
```

这对 IDE、CI 和人工 review 都非常重要。

Tree-sitter 这样的 parser infrastructure 就是一个很好的底层参考：它明确区分 parse tree 与更高层抽象，并支持基于语法树进行结构化查询和增量更新。

---

# 六、如果 Workflow 可以用 Markdown 写，Parser 更应该分层

例如：

```markdown
# Trade Review

:::agent
id: risk_review
skill: risk-review@7.2

:::policy
id: trade_policy
policy: trade-limit@23
:::
```

实际上可能需要：

```text
Markdown Parser
       ↓
Markdown AST
       ↓
Directive Extractor
       ↓
Workflow Syntax AST
```

因为：

```text
Markdown
```

本身是通用文档语言。

而：

```text
:::agent
```

才属于 Workflow DSL。

所以不要让 Markdown Parser 直接理解：

```text
trade policy
risk review
approval
side effect
```

而是：

```text
Generic Markdown Parser
        ↓
Workflow-specific Directive Parser
```

这样以后你甚至可以支持：

```text
Markdown
YAML
JSON
Visual Editor
API
```

多个 front-end，最终都进入：

```text
Canonical Workflow AST
```

---

# 七、Parser 最应该做到的是“无业务判断地完整保留信息”

这是一个很重要的设计原则：

> **Parser 宁可多解析，不要过早判断。**

例如：

```yaml
type: agent
skill: risk-review@unknown-version
```

Parser 应该产生：

```text
AgentNode
skill = risk-review@unknown-version
```

而不是：

```text
ParserError: skill version does not exist
```

因为：

```text
“语法合法但引用不存在”
```

不是 parser error。

这是 Validator / Analyzer 的责任。

这样以后才能区分：

```text
Parse Error
Schema Error
Reference Error
Semantic Error
Control Error
Risk Warning
```

不同类型的错误，处理方式不同。

---

# 八、Validator：把“结构”变成“合法定义”

Parser 解决：

> “我读懂了这段 DSL。”

Validator 解决：

> **“它是不是一个合法的 Workflow Definition？”**

这是第二层。

可以理解成：

```text
Syntax AST
    ↓
Validator
    ↓
Validated Workflow Model
```

---

# 九、Validator 最好分成三个子层

实际工程中，可以把 Validator 再分成：

```text
Validator
├── Schema Validator
├── Structural Validator
└── Reference Validator
```

这样会非常清晰。

---

## 9.1 Schema Validation

例如：

```yaml
type: agent
```

要求：

```text
skill: string
input: object
output: schema
```

那么：

```yaml
type: agent
skill:
  - risk-review
```

就是：

```text
SCHEMA ERROR
skill must be string
```

JSON Schema 就很适合作为这一层的基础技术。它专门用于表达 JSON 数据结构、类型和约束。

但：

> **Schema 不等于 Workflow Semantic Validation。**

Schema 可以验证：

```text
字段存在
类型正确
格式正确
```

却很难完整表示：

```text
这个节点是否可达？
这个 side effect 是否被 approval gate 保护？
这个 policy 是否真的覆盖这条路径？
```

---

# 十、Structural Validation：图本身必须正确

Workflow 不是简单的 JSON object。

它本质上是：

```text
Graph
=
Nodes + Edges
```

因此至少需要验证：

### Start 唯一

```text
0 or >1 start
→ Error
```

### End 可达

```text
Start
  ↓
A
  ↓
B
```

如果 B 后面永远没有终点：

```text
→ Error
```

### 所有节点可达

```text
Start → A → B

X
```

如果 `X` 没有 incoming edge：

```text
→ Unreachable Node
```

### Edge 合法

```text
A → A
```

是否允许？

```text
A → UnknownNode
```

是否允许？

### Node ID 唯一

```text
risk_check
risk_check
```

必须：

```text
Error
```

Microsoft Agent Framework 现在已经在构建 Workflow 时检查 graph connectivity、executor binding、duplicate edge 和 invalid connections；这就是典型的 structural validation。

---

# 十一、Reference Validation：引用必须真实存在

例如：

```yaml
skill: risk-review@7.2
policy: trade-limit@23
tool: trade.submit
```

Validator 至少应该检查：

```text
Skill Registry
Policy Registry
Tool Registry
Schema Registry
```

是不是存在。

结果：

```text
risk-review@7.2       ✓
trade-limit@23        ✓
trade.submit          ✓
unknown-tool          ✗
```

这里还有一个非常重要的原则：

> **Reference Validation 应该只回答“引用是否存在、可解析”，而不要在这一层决定“这个引用在当前业务风险下是否允许”。**

例如：

```text
tool: trade.submit
```

是存在的。

是否允许当前 Workflow 使用它：

```text
Analyzer
```

再判断。

---

# 十二、Validator 应该尽量是 Deterministic 的

这一点对 Agent Workflow 特别重要。

推荐：

```text
Validator
=
pure + deterministic
```

同一个 AST：

```text
validate(ast)
```

应该稳定得到：

```text
same diagnostics
```

而不是：

```text
LLM:
“我觉得这个流程可能有风险……”
```

原因很简单：

> **Validation 本身就是企业控制边界的一部分。**

如果验证器本身具有随机性，那么：

```text
CI pass
```

并不一定意味着：

```text
CI pass again
```

更不应该出现：

```text
Yesterday:
invalid

Today:
valid
```

---

# 十三、Validator 应该能够输出 Warning，而不是只有 Pass/Fail

真实 Workflow 很多时候不是：

```text
valid
/
invalid
```

而是：

```text
ERROR
WARNING
INFO
```

AWS Step Functions 的 `ValidateStateMachineDefinition` 就提供这种诊断模型：`ERROR` 会阻止部署，而 `WARNING` 可以提示潜在问题但不一定阻止创建/更新。AWS 同时明确提醒自动化应该依赖诊断整体结果，而不要依赖具体 warning message 的文字或顺序。

金融 Workflow 可以设计成：

```text
ERROR
    无法执行 / 不允许部署

WARNING
    可以继续，但需要 review

INFO
    可优化但不影响执行
```

例如：

```text
ERROR:
Policy version is missing

WARNING:
Agent node has high autonomy but no explicit timeout

WARNING:
Evidence freshness is not specified

INFO:
Parallel execution could reduce latency
```

---

# 十四、Validator 应该做到“快速反馈”

因为它会频繁运行：

```text
Editor
CI
Pre-commit
Pull Request
Deployment
```

所以 Validator 应该：

```text
fast
local
deterministic
```

而不应该依赖：

```text
实时 LLM
外部市场 API
人工审批系统
生产数据库
```

否则开发体验会非常差。

推荐：

```text
Parser
    < 50ms

Schema
    < 100ms

Structural
    < 100ms

Reference
    cached registry
```

具体数字不是标准要求，而是工程目标。

---

# 十五、Analyzer：真正决定这个 Workflow “有没有业务问题”

这是第三层，也是金融场景最重要的一层。

Parser：

```text
看得懂
```

Validator：

```text
格式正确
```

Analyzer：

> **理解整个 Workflow 的语义，并判断它在业务、控制、安全、数据和运行层面有没有问题。**

可以理解为：

```text
Validated Workflow
        ↓
Semantic Graph
        ↓
Analyzer
        ↓
Findings
```

---

# 十六、Analyzer 与 Validator 的核心区别

一个非常实用的区分方式：

### Validator

关注：

> **局部、规则明确、定义级别的问题。**

例如：

```text
节点类型不合法
字段缺失
引用不存在
edge 指向不存在的节点
```

### Analyzer

关注：

> **跨节点、跨资源、跨层次的关系。**

例如：

```text
Side Effect 前没有 Approval

虽然有 Approval，
但某条 branch 可以绕过它

虽然有 Policy，
但 Policy 输出没有连接到 Decision

虽然有 Evidence requirement，
但 retrieval path 并没有提供对应数据

虽然 Tool 有授权，
但 Agent 在这个 Workflow role 下无权使用

虽然 Workflow 有 Retry，
但 side effect 没有 idempotency contract
```

这些都不是一个 node 自己能够知道的。

---

# 十七、Analyzer 的本质是“建立语义图”

Validator 之后，建议建立：

```text
Workflow Semantic Graph
```

例如：

```text
Node Graph
+
Data Flow Graph
+
Control Flow Graph
+
Policy Graph
+
Capability Graph
+
Evidence Graph
```

最终形成：

```text
                Workflow
                    │
        ┌───────────┼───────────┐
        ↓           ↓           ↓
   Control Flow   Data Flow   Capability
        │           │           │
        └───────────┼───────────┘
                    ↓
             Policy / Evidence
```

这就是 Analyzer 真正发挥作用的地方。

---

# 十八、第一类 Analyzer：Control-Flow Analysis

最基本的是：

```text
Reachability
Dead Node
Dead End
Cycle
Loop
Branch Coverage
Join Correctness
```

例如：

```text
A
├── B
│   └── D
└── C
    └── E
```

Analyzer 可以检查：

```text
D → End ?
E → End ?
```

如果：

```text
C
```

永远不可能发生：

```text
D
```

就是 dead branch。

Camunda 的 lint rules 中就已经包含 `no-loop` 等模型分析规则，说明 workflow tooling 会对结构合法性之外的图语义进行分析。

---

# 十九、第二类 Analyzer：Data-Flow Analysis

金融 Workflow 最常见的错误不一定是流程错，而是：

> 数据在错误的时候被使用。

例如：

```text
load_client
    ↓
risk_review
    ↓
submit_trade
```

但 `risk_review` 输出：

```json
{
  "riskLevel": "HIGH"
}
```

而 `submit_trade` 需要：

```json
{
  "approved": true,
  "limit": 10000000
}
```

Analyzer 可以判断：

```text
required field = approved
producer = none
```

然后报：

```text
ERROR:
submit_trade.approved has no producer
```

这已经超出了 Schema Validation。

因为单独看：

```text
submit_trade
```

它完全合法。

问题是：

> **整个图里没有任何地方产生 `approved`。**

---

# 二十、数据流还可以做“过度传播”分析

金融系统一个非常重要的问题是：

> 数据有没有不应该流入某个节点？

例如：

```text
Restricted M&A Information
       ↓
Agent Context
       ↓
External LLM
```

如果 Workflow AST 标记：

```text
data.classification = MNPI
```

Analyzer 就可以发现：

```text
ExternalModelNode
accepts Restricted Data
```

然后：

```text
ERROR:
Restricted data crosses external model boundary
```

这比单纯 IAM 更高一层。

IAM 解决：

```text
“谁能访问”
```

Analyzer 还可以解决：

```text
“这条 Workflow 是否把数据送到不应该到达的地方”
```

---

# 二十一、第三类 Analyzer：Capability Analysis

对于 Agent Workflow，必须知道：

```text
谁可以做什么
```

例如：

```text
Agent
risk-review
```

允许：

```text
read:risk
read:client
read:exposure
```

不允许：

```text
write:trade
transfer:money
change:client
```

如果 Workflow：

```text
risk-review
    ↓
trade.submit
```

Analyzer 应该发现：

```text
Agent capability
≠
Required capability
```

这里最好形成一个：

```text
Capability Graph
```

```text
Agent
  ↓
Skill
  ↓
Tools
  ↓
Permissions
```

然后和 Workflow：

```text
Node
  ↓
Tool
  ↓
Required Permission
```

进行匹配。

---

# 二十二、第四类 Analyzer：Policy Path Analysis

这是金融 Workflow 最重要的 Analyzer 之一。

例如：

```text
risk_review
      ↓
trade_policy
      ↓
approval
      ↓
submit_trade
```

表面很好。

但如果存在：

```text
risk_review
   ├── HIGH → approval
   └── LOW  → submit_trade
```

Analyzer 就要知道：

```text
LOW
```

是否可以直接执行？

假设 Policy 定义：

```text
trade > $5m
requires human approval
```

那么 Analyzer 可以进一步检查：

```text
LOW
+
amount > 5m
```

仍然必须进入：

```text
approval
```

如果 DSL 中不存在这条路径：

```text
ERROR:
Possible policy bypass
```

这是一种典型的：

> **Path-sensitive Policy Analysis**

---

# 二十三、第五类 Analyzer：Evidence Analysis

对于金融 Agent，建议把 Evidence Requirement 也纳入 Workflow AST。

例如：

```yaml
type: agent
id: trade_recommendation

evidence:
  required:
    - client-risk
    - current-exposure
    - applicable-limit
```

Analyzer 可以沿着数据流检查：

```text
required evidence
      ↓
retrieval
      ↓
agent input
      ↓
claim
      ↓
decision
```

如果：

```text
applicable-limit
```

虽然被声明为 required，但是 Workflow 没有任何生产来源：

```text
ERROR:
Required evidence "applicable-limit"
has no producer
```

如果是：

```text
optional
```

则：

```text
WARNING:
Evidence may be unavailable
```

这一层直接把前面的 Evidence-First 架构原则落到了 Workflow DSL。

---

# 二十四、第六类 Analyzer：Replayability Analysis

这也是前一篇文章可以直接接过来的能力。

一个 Workflow 不是“有 State”就代表可 Replay。

Analyzer 可以检查：

```text
Agent
  ↓
External API
  ↓
Side Effect
```

每个 external dependency 是否定义：

```text
replay.mode
```

例如：

```yaml
tool: risk-api
replay:
  mode: recorded
```

或者：

```yaml
tool: calculate-limit
replay:
  mode: recompute
```

如果：

```yaml
tool: trade.submit
```

没有：

```text
replay: prohibited
```

或者：

```text
recovery: idempotent
```

就可以：

```text
WARNING:
Side-effect tool has no replay semantics
```

更严格可以：

```text
ERROR:
Production workflow is not replay-safe
```

---

# 二十五、第七类 Analyzer：Idempotency Analysis

金融 Workflow 中：

```text
retry
+
side effect
```

是一个非常危险的组合。

例如：

```text
submit_trade
```

有：

```yaml
retry:
  max_attempts: 3
```

但：

```yaml
idempotency_key: none
```

Analyzer 应直接报告：

```text
ERROR:
Retryable side-effect action is missing
idempotency contract
```

因为：

```text
retry
→ duplicate order
```

风险很明确。

Google Cloud Workflows 官方文档也专门区分 idempotent 和 non-idempotent steps，并指出 retry 策略应根据 action 是否幂等来配置。

---

# 二十六、第八类 Analyzer：Human-Approval Analysis

一个金融 Workflow 的：

```text
human_approval
```

不能只是：

```yaml
type: human_approval
```

Analyzer 可能检查：

```text
Role exists?
Role authorized?
Separation of duties?
Self-approval possible?
Approval after evidence?
Approval before side effect?
Timeout defined?
Reject path exists?
```

例如：

```text
Trader
   ↓
Agent
   ↓
Trader Approval
   ↓
Submit Trade
```

如果企业 Policy 禁止：

> Requester 自己审批自己的交易。

Analyzer 就应该发现：

```text
ERROR:
Potential segregation-of-duties violation
```

这就是为什么：

> **Business Control Analysis 必须建立在整个 Workflow Graph 上。**

---

# 二十七、第九类 Analyzer：Version Analysis

金融 Agent Workflow 中，很多东西都应该 pin：

```text
Workflow Version
Skill Version
Policy Version
Tool Version
Evidence Requirement Version
Model Identity
```

例如：

```yaml
skill: risk-review@latest
policy: trade-limit@current
```

Validator 可以知道：

```text
字符串合法
```

Analyzer 则知道：

```text
生产 Workflow 不允许 floating reference
```

然后报告：

```text
ERROR:
skill reference is not immutable
```

或者：

```text
WARNING:
model endpoint does not expose immutable snapshot identity
```

FINRA 2026 年监管报告明确把“记录使用了哪个 model version 以及何时使用”列为 GenAI monitoring 可以采用的控制措施，同时要求建立正式治理和风险管理框架、综合文档、持续测试和监控。

---

# 二十八、第十类 Analyzer：Change Impact Analysis

这是 Analyzer 与 Validator 最大的价值差异之一。

假设 Workflow 从：

```text
W17
```

变成：

```text
W18
```

AST Diff 显示：

```text
+ policy_check
+ senior_approval
```

Analyzer 可以进一步回答：

```text
哪些 Business Decision Type 受到影响？

哪些 Tool 新增？

哪些权限新增？

哪些数据新增？

哪些路径发生变化？

哪些 Production Execution 可能受影响？
```

因此：

```text
AST Diff
    ↓
Dependency Graph
    ↓
Impact Analysis
```

这可以直接支持金融 change management。

DORA Article 9 要求金融实体对 ICT changes 建立 documented change management controls，使变更被记录、测试、评估、批准、实施和验证。

需要注意：

> AST impact analysis 是实现这些控制目标的一种工程能力，不应直接宣称“有 Analyzer 就等于满足 DORA”。

---

# 二十九、第十一类 Analyzer：Risk Analysis

Analyzer 最终可以把多个检查结果汇总成：

```text
Workflow Risk Profile
```

例如：

```text
Control Risk
├── high autonomy
├── direct side effect
├── no human gate
└── external model

Data Risk
├── PII
├── restricted research
└── cross-boundary transfer

Operational Risk
├── non-idempotent retry
├── external dependency
└── missing timeout

Replay Risk
├── live-only API
└── model output not recorded
```

这类结果可以用于：

```text
Deployment Tier
Approval Requirement
Testing Scope
Monitoring Level
```

但这里有一个重要边界：

> **Analyzer 可以计算风险特征，最终风险评级和审批政策仍应由企业 Governance / Policy 定义。**

不要让 Analyzer 自己变成：

```text
“AI 判断这是 High Risk，所以可以上线/不能上线。”
```

更合理：

```text
Analyzer
    ↓
Facts / Findings
    ↓
Governance Policy
    ↓
Decision
```

---

# 三十、三层架构其实对应三种不同的“真相”

这是理解整个设计最简单的方法。

### Parser 的真相

```text
Syntax Truth
```

> 这段文字结构是什么？

### Validator 的真相

```text
Definition Truth
```

> 这个定义是否构成一个合法 Workflow？

### Analyzer 的真相

```text
System / Business Truth
```

> 这个 Workflow 在当前业务和控制环境中会造成什么含义？

因此：

```text
Text
  ↓
Syntax
  ↓
Definition
  ↓
Meaning
```

和传统编译器：

```text
Source
  ↓
AST
  ↓
Semantic Analysis
  ↓
IR
```

本质上是相似思想。

---

# 三十一、不要把 Validator 和 Analyzer 合并成“lint”

很多项目一开始会简单做：

```text
workflow lint
```

这没有问题。

问题是长期以后会出现：

```text
lint rule 001
lint rule 002
lint rule 003
...
lint rule 153
```

最后没有人知道：

```text
001
属于 parser？
schema？
graph？
policy？
security？
risk？
```

更好的组织方式是：

```text
Parser
  └── Syntax errors

Validator
  ├── Schema
  ├── Structural
  └── References

Analyzer
  ├── Dataflow
  ├── Controlflow
  ├── Capability
  ├── Policy
  ├── Evidence
  ├── Replay
  ├── Idempotency
  ├── SoD
  └── Risk
```

每一层输出自己的诊断。

---

# 三十二、诊断模型也应该结构化

不要只返回字符串：

```json
{
  "message": "something is wrong"
}
```

建议：

```json
{
  "code": "WF-POLICY-001",
  "severity": "ERROR",
  "phase": "ANALYZER",
  "message": "Side effect is reachable without required approval",
  "location": {
    "node": "submit_trade",
    "line": 31
  },
  "related_nodes": [
    "risk_review",
    "approval"
  ],
  "rule": "side-effect-requires-approval",
  "explainable": {
    "path": [
      "risk_review",
      "direct_submit"
    ]
  }
}
```

这样 IDE 可以：

```text
highlight node
```

CI 可以：

```text
fail build
```

Governance 平台可以：

```text
aggregate control findings
```

Audit 可以：

```text
保存 analyzer result
```

---

# 三十三、Analyzer 不应该每次从头“看懂” Workflow

如果 Analyzer 每次都接受：

```text
Markdown
```

然后通过 LLM 判断：

> “我认为这里应该需要审批。”

架构会很脆弱。

正确做法：

```text
Source
  ↓
Parser
  ↓
AST
  ↓
Normalized Semantic Model
  ↓
Analyzer
```

Analyzer 工作在：

```text
typed graph
```

上。

例如：

```typescript
type WorkflowGraph = {
  nodes: Map<NodeId, Node>;
  edges: Edge[];
  dataFlows: DataFlow[];
  capabilities: Capability[];
  policies: PolicyRef[];
};
```

然后 analyzer 可以是普通 deterministic code：

```typescript
analyzeSideEffects(graph)
analyzeReachability(graph)
analyzeEvidence(graph)
analyzeReplayability(graph)
```

这样：

```text
Analyzer
=
可测试的普通程序
```

而不是：

```text
Analyzer
=
另一个 LLM
```

---

# 三十四、LLM 可以参与，但只能当“辅助解释器”

并不是说 Analyzer 中不能用 LLM。

例如：

```text
Deterministic Analyzer
        ↓
Finding
        ↓
LLM
        ↓
Human-readable explanation
```

是合理的。

例如：

```text
WF-POLICY-001:
side_effect may bypass approval
```

LLM 可以生成：

> “当前 `risk_review` 有一条路径直接连接到 `submit_trade`，该路径未经过 `approval` 节点。”

但 LLM 不应该决定：

```text
“我觉得这个 Workflow 大概没有问题。”
```

所以：

> **LLM 可以负责 explanation，不应该承担 deterministic validation boundary。**

---

# 三十五、Parser / Validator / Analyzer 最好共享一个 Canonical Semantic Model

不要：

```text
Parser → Object A
Validator → Object B
Analyzer → Object C
Runtime → Object D
```

这样会导致：

```text
semantic drift
```

更好的结构：

```text
Parser
   ↓
Syntax AST
   ↓
Normalizer
   ↓
Canonical Semantic Model
   ├── Validator
   ├── Analyzer
   ├── Compiler
   ├── Visualizer
   ├── Simulator
   └── Runtime
```

这个 `Canonical Semantic Model` 才是真正的：

> **Single Source of Truth**

---

# 三十六、Canonical Semantic Model 应该比 Runtime Object 更稳定

例如：

```text
AgentNode
```

的语义：

```text
id
skillRef
input
output
evidenceRequirement
capabilities
timeout
```

Runtime 可以变成：

```text
DeepAgentsAgentNode
LangGraphAgentNode
CustomAgentNode
```

但 DSL 不应该改变。

因此：

```text
DSL Semantic Model
        ↓
Compiler / Adapter
        ↓
Runtime-specific Model
```

这使得企业未来可以从：

```text
LangGraph
```

迁移到：

```text
Microsoft Agent Framework
```

或者：

```text
自研 Runtime
```

而 Workflow DSL 不一定需要重新设计。

Microsoft Agent Framework 当前明确把 declarative workflow 定义转换为 executable workflow graph，这也说明“声明模型”和“执行对象”可以作为两个不同层次来处理。

---

# 三十七、Financial Workflow DSL 的 Analyzer 应该优先分析什么

如果资源有限，不应该一开始做几十种 analyzer。

第一批建议优先：

```text
1. Reachability
2. Dead End
3. Data Dependency
4. Side-effect Gate
5. Authorization
6. Evidence Requirement
7. Retry / Idempotency
8. Version Pinning
9. Human Approval / SoD
10. Replayability
```

原因是这些直接对应金融 Workflow 的：

```text
Control
Risk
Audit
Recovery
```

而不是：

```text
UI aesthetics
```

---

# 三十八、建议把 Analyzer 分成“通用层”和“金融 Control Pack”

这是非常重要的可扩展性设计。

### Generic Analyzer

适用于所有 Workflow：

```text
reachability
cycles
type compatibility
dead ends
data flow
retry
timeout
```

### Financial Control Analyzer

只适用于金融场景：

```text
side-effect approval
SoD
entitlement
evidence sufficiency
restricted data boundary
policy coverage
model/skill pinning
replayability
audit evidence
```

于是：

```text
Workflow DSL Core
       │
       ├── Generic Analyzer
       │
       ├── Banking Control Pack
       │
       ├── Insurance Control Pack
       │
       └── Investment Management Pack
```

这比把所有金融规则硬编码进 core parser 更合理。

---

# 三十九、Financial Control Pack 可以是 Policy-as-Code

例如：

```yaml
rule: side-effect-requires-approval

when:
  node.type == "side_effect"

require:
  reachable_before:
    node.type == "human_approval"
```

或者：

```yaml
rule: high-risk-agent-evidence

when:
  node.type == "agent"
  && node.risk_level == "high"

require:
  evidence.required.size > 0
```

再例如：

```yaml
rule: production-version-pinning

when:
  workflow.environment == "production"

require:
  refs.skill.version != "latest"
  refs.policy.version != "current"
```

这里就可以结合 OPA / Rego。

OPA 本身提供 parse/compile checking、schema checking、strict mode 和 bundle validation / signing 能力，可以作为 Policy-as-Code 层的技术参考。

这样：

```text
Workflow AST
      ↓
Extract Facts
      ↓
Policy Engine
      ↓
Analyzer Findings
```

会比：

```text
Workflow Parser
→ hard-coded if/else
```

更可治理。

---

# 四十、Analyzer 最终可以产生“Workflow Facts”

例如：

```json
{
  "facts": [
    {
      "node": "submit_trade",
      "kind": "side_effect"
    },
    {
      "node": "submit_trade",
      "kind": "approval_required",
      "value": true
    },
    {
      "node": "risk_review",
      "kind": "uses_external_model",
      "value": true
    },
    {
      "node": "risk_review",
      "kind": "required_evidence",
      "value": [
        "risk-score",
        "exposure"
      ]
    }
  ]
}
```

然后：

```text
Governance Policy
        ↓
evaluate(facts)
        ↓
ALLOW / REVIEW / DENY
```

这样能够保持：

```text
Analyzer
=
事实发现

Policy
=
控制判断
```

这和金融企业应有的治理边界非常一致。

---

# 四十一、为什么不要让 Analyzer 直接负责“上线”

例如：

```text
Analyzer
  ↓
Risk = HIGH
  ↓
reject deployment
```

表面上简单。

但以后很容易出现：

```text
不同业务
不同监管区域
不同环境
不同风险 appetite
```

都要求不同处理。

更好的：

```text
Analyzer
  ↓
Findings
  ↓
Deployment Policy
  ↓
Decision
```

例如：

```text
HIGH_AUTONOMY
+
EXTERNAL_DATA
+
SIDE_EFFECT
```

Analyzer 只报告。

Deployment Policy 再决定：

```text
Production:
require senior approval

UAT:
allow

Sandbox:
allow with mock tools
```

这样职责才不会混乱。

---

# 四十二、三层之间最重要的是“不越界”

可以用下面这张表判断：

| 问题                     | Parser |  Validator | Analyzer |
| ---------------------- | -----: | ---------: | -------: |
| YAML/Markdown 合法吗      |      ✓ |            |          |
| 字段类型正确吗                |        |          ✓ |          |
| Node ID 唯一吗            |        |          ✓ |          |
| Reference 存在吗          |        |          ✓ |          |
| 所有 Node 可达吗            |        | ✓/Analyzer |        ✓ |
| 数据是否产生/消费匹配            |        |            |        ✓ |
| Side Effect 是否绕过审批     |        |            |        ✓ |
| Evidence 是否满足 Decision |        |            |        ✓ |
| Authorization 是否足够     |        |            |        ✓ |
| 是否违反 SoD               |        |            |        ✓ |
| 是否可 Replay             |        |            |        ✓ |
| 是否需要更高审批               |        |            |        ✓ |
| 是否获准上线                 |        |            |   不应直接决定 |

最后一行非常重要：

> **Analyzer 可以发现风险事实，但 Deployment Governance 才决定是否批准上线。**

---

# 四十三、CI/CD 应该如何接入这三层

推荐：

```text
Pull Request
    ↓
Parser
    ↓
Validator
    ↓
Analyzer
    ↓
Control Policy
    ↓
Test
    ↓
Approval
    ↓
Deploy
```

具体可以：

### PR 阶段

```text
Parser
Validator
Basic Analyzer
```

快速反馈。

### CI 阶段

```text
Full Analyzer
Regression Tests
Policy Checks
```

### Staging

```text
Integration Test
Play / Simulation
Mock Side Effects
```

### Production

```text
Approval
Signed Artifact
Immutable Version
Deploy
```

Camunda 官方当前支持在 CI/CD 中使用 `bpmnlint` / `dmnlint` 自动验证模型，并支持 Play 环境测试；这可以作为企业 Workflow DSL 开发生命周期的现实参考。

---

# 四十四、Parser / Validator / Analyzer 应该具有不同的失败策略

### Parser Error

```text
STOP
```

因为没有可理解的 AST。

### Validator Error

```text
STOP
```

因为定义本身非法。

### Analyzer Error

分情况：

```text
CONTROL VIOLATION
→ STOP

RISK WARNING
→ REVIEW / configurable

OPTIMIZATION
→ INFORMATION
```

所以：

```text
severity
```

应该和：

```text
phase
```

分开。

例如：

```json
{
  "phase": "ANALYZER",
  "severity": "ERROR",
  "rule": "side-effect-requires-policy"
}
```

---

# 四十五、Analyzer 还应该支持“解释为什么报错”

金融系统尤其不能只有：

```text
ERROR WF-104
```

应该能解释：

```text
submit_trade
   ↓
reached from
   ↓
risk_review
   ↓
branch condition = approved == true

But:
approval node is not reachable
from this branch.
```

也就是说，Analyzer 应该返回：

```text
Finding
+
Evidence Path
```

这和传统静态分析中的：

```text
source → propagation → sink
```

思路非常接近。

对于金融 Workflow，这个“路径证据”本身也可以成为：

```text
Audit
Control Review
```

的输入。

---

# 四十六、Analyzer 应该建立“解释图”，而不只是 boolean result

例如：

```text
Policy Bypass Found

Path:
Start
 → load_client
 → risk_review
 → low_risk_branch
 → submit_trade

Required:
approval.senior

Observed:
none
```

这比：

```text
false
```

有价值很多。

最终 IDE 可以直接：

```text
highlight path
```

Risk 可以直接：

```text
review violation path
```

Audit 可以直接：

```text
保存 analyzer evidence
```

---

# 四十七、Analyzer 与 Replay 可以直接连起来

例如 Analyzer 发现：

```text
workflow uses external API:
pricing-api
```

Replay Analyzer：

```text
pricing-api
replay.mode = live_only
```

于是：

```text
WARNING:
forensic replay cannot reconstruct pricing input
```

如果：

```text
model result
recorded = false
```

则：

```text
ERROR:
forensic replay completeness < required threshold
```

这样，Workflow 在上线前就能知道：

> **以后出了事故，系统是否有能力重建自己。**

这是非常适合金融场景的一项“设计时审计”。

---

# 四十八、Analyzer 可以提前发现“未来无法审计”的 Workflow

例如：

```text
Agent
   ↓
Current Web Search
   ↓
LLM
   ↓
Trade Proposal
```

如果：

```text
Web Search
```

没有：

```text
snapshot
source hash
timestamp
```

Analyzer 可以报告：

```text
AUDIT WARNING:
external evidence has no immutable snapshot contract
```

又例如：

```text
Agent
   ↓
LLM
   ↓
Trade Proposal
```

没有：

```text
model identity
```

Analyzer：

```text
AUDIT ERROR:
execution context cannot be reconstructed
```

这就把：

```text
审计能力
```

从生产事故后的补救，提前变成：

```text
Design-time Analysis
```

---

# 四十九、三层设计也可以直接服务“Agent Governance”

金融 Agent 的一个核心目标不是：

> “Agent 能运行。”

而是：

> **Agent 只能运行在批准过的边界之内。**

那么：

```text
Parser
```

把边界显式化。

```text
Validator
```

确保定义合法。

```text
Analyzer
```

检查定义是否突破组织控制边界。

最终：

```text
                    Workflow Source
                           │
                           ▼
                        Parser
                           │
                           ▼
                     Canonical AST
                           │
                           ▼
                       Validator
                           │
                           ▼
                    Valid Workflow
                           │
                           ▼
                       Analyzer
            ┌──────────────┼──────────────┐
            ▼              ▼              ▼
         Security        Policy        Replay
         Analysis       Analysis       Analysis
            │              │              │
            └──────────────┼──────────────┘
                           ▼
                     Governance Gate
                           │
                           ▼
                    Approved Version
                           │
                           ▼
                        Runtime
```

这个结构非常适合企业 Agent Control Plane。

---

# 五十、金融场景为什么尤其适合这种设计

金融机构的 Workflow 通常具有几个特点：

```text
明确流程
确定审批点
严格权限
强审计要求
高副作用成本
长生命周期
多团队协作
频繁版本变化
```

这与自然语言 Agent 最擅长的：

```text
模糊问题
开放式推理
动态规划
非结构化信息处理
```

恰好是互补关系。

所以比较合理的设计不是：

```text
Workflow → LLM
```

而是：

```text
Deterministic Control Layer
        ↓
Agent Reasoning Layer
```

Bank of England 2026 年 AI Consortium 的公开讨论也明显朝这一方向发展：与会者讨论 agentic tools 的 safe deployment、model harness、execution boundaries，以及把 deterministic system actions 与 LLM 的 probabilistic reasoning 分离；同时强调 AI system 需要从单一模型扩展到由多个互联组件组成的系统级治理。

这里的“Parser / Validator / Analyzer”正好可以成为这个控制层的基础。

---

# 五十一、一个完整的 Financial Workflow DSL 示例

假设定义：

```yaml
dsl: finance-workflow/v1

workflow:
  id: trade-review
  version: 3.2

nodes:

  - id: load_client
    type: task
    action: client.load

  - id: risk_review
    type: agent
    skill: risk-review@7.2

    evidence:
      required:
        - client-risk
        - exposure
        - applicable-limit

    output:
      schema: RiskReviewResult

  - id: trade_policy
    type: policy
    policy: trade-limit@23

  - id: approval
    type: human_approval
    role: senior-compliance

  - id: submit_trade
    type: side_effect
    tool: trade.submit

edges:

  - from: load_client
    to: risk_review

  - from: risk_review
    to: trade_policy

  - from: trade_policy
    when: "decision == 'ALLOW'"
    to: approval

  - from: approval
    when: "approved == true"
    to: submit_trade
```

---

# 五十二、Parser 的结果

Parser 只产生：

```text
Workflow
├── metadata
├── nodes
│   ├── TaskNode
│   ├── AgentNode
│   ├── PolicyNode
│   ├── HumanApprovalNode
│   └── SideEffectNode
└── edges
```

没有判断：

```text
是否安全
```

---

# 五十三、Validator 的结果

Validator 检查：

```text
✓ Workflow ID exists
✓ Version valid
✓ Node IDs unique
✓ Node types valid
✓ edge targets exist
✓ all required fields exist
✓ skill reference format valid
✓ policy reference format valid
✓ output schema valid
```

结果：

```text
VALID
```

---

# 五十四、Analyzer 的结果

Analyzer 进一步检查：

```text
✓ submit_trade is downstream of approval

✓ approval role exists

✓ trade_policy exists

✓ required evidence declared

✓ risk_review output feeds policy

⚠️ trade.submit has external side effect

⚠️ idempotency contract not declared

⚠️ model identity not pinned

⚠️ replay adapter for trade.submit = prohibited

✓ evidence snapshot supported
```

于是：

```text
Analyzer Findings
```

可能得到：

```text
ERROR:
production requires model identity

ERROR:
side effect requires idempotency contract

WARNING:
forensic replay cannot execute trade.submit
```

注意：

> 这里的 Analyzer 并没有“自己决定是否可以上线”，只是把事实和违反规则的关系找出来。

---

# 五十五、最终的 Governance Decision

再交给：

```text
Deployment Policy
```

例如：

```text
High-risk Workflow
+
External Side Effect
+
No Idempotency Contract
```

组织政策规定：

```text
DENY
```

于是：

```text
Governance
→ DENY
```

整个链条非常清楚：

```text
Parser
→ 我理解了它

Validator
→ 它是一个合法 Workflow

Analyzer
→ 它存在这些风险 / 控制缺口

Governance Policy
→ 因此当前不允许 Production
```

而不是：

```text
LLM
→ 我觉得看起来可以
```

---

# 五十六、一个成熟的 DSL Toolchain 可以长这样

```text
                 Financial Workflow DSL
                          │
                          ▼
                    ┌──────────┐
                    │  Parser  │
                    └────┬─────┘
                         AST
                          │
                          ▼
                 ┌────────────────┐
                 │   Validator    │
                 ├────────────────┤
                 │ Schema         │
                 │ Structure      │
                 │ References     │
                 └───────┬────────┘
                         │
                  Semantic Model
                         │
                         ▼
                 ┌────────────────┐
                 │    Analyzer    │
                 ├────────────────┤
                 │ Control Flow   │
                 │ Data Flow      │
                 │ Capability     │
                 │ Policy         │
                 │ Evidence       │
                 │ Replay         │
                 │ Idempotency    │
                 │ SoD            │
                 │ Version        │
                 └───────┬────────┘
                         │
                       Findings
                         │
                         ▼
                 Governance Policy
                         │
                    ┌────┴─────┐
                    ▼          ▼
                  DENY       APPROVE
                               │
                               ▼
                        Canonical IR
                               │
                               ▼
                          Workflow Runtime
```

这个架构最大的好处是：

> **每一层都可以独立演进。**

---

# 五十七、实现技术上可以采用哪些组件

并不要求自己从零发明 parser。

可以采用：

```text
Parser
├── Tree-sitter
├── ANTLR
├── PEG / parser combinator
└── YAML / JSON parser + custom DSL layer
```

AST / Semantic Model：

```text
TypeScript types
JSON Schema
Zod
Protobuf
Avro
custom IR
```

Validator：

```text
schema validator
graph validator
reference resolver
```

Analyzer：

```text
custom graph algorithms
data-flow engine
OPA / Rego
policy engine
static analysis rules
```

Workflow Runtime：

```text
Step Functions
Camunda
Microsoft Agent Framework
LangGraph
自研 Orchestrator
```

关键不在于具体技术选择。

关键在于：

```text
Parser
≠
Validator
≠
Analyzer
≠
Runtime
```

---

# 五十八、不建议直接让 LLM 生成最终 AST JSON

一个看起来很诱人的方案：

```text
User
 ↓
LLM
 ↓
JSON AST
 ↓
Runtime
```

虽然简单，但是仍然存在问题：

> LLM 生成的 JSON 即使 schema-valid，也不代表 semantic-valid。

例如：

```json
{
  "type": "side_effect",
  "tool": "trade.submit"
}
```

完全可以是合法 JSON。

也完全可以满足 JSON Schema。

但业务上可能是：

```text
NO APPROVAL
NO POLICY
NO AUTHORIZATION
```

所以至少：

```text
LLM
 ↓
DSL
 ↓
Parser
 ↓
Validator
 ↓
Analyzer
```

而不是：

```text
LLM
 ↓
AST
 ↓
execute
```

---

# 五十九、LLM 最适合作为“Parser Frontend Generator”，而不是 Validator

也就是说：

```text
LLM
负责：
理解自然语言
生成 DSL
修改 DSL
解释 DSL
```

而：

```text
Parser
负责：
确定语法

Validator
负责：
确定定义正确

Analyzer
负责：
确定业务/控制含义

Runtime
负责：
执行
```

这是一条非常强的架构边界。

原因是：

> **LLM 的概率性适合意图转换，不适合最终的 deterministic control gate。**

Bank of England 2026 年 AI Consortium 的 discussion 也强调 GenAI 系统的 variability / unpredictability，以及需要 outcome-based validation、system-level governance 和明确 execution boundaries。

---

# 六十、最终可以形成一个非常清晰的 Mental Model

把 Workflow DSL 想成一门语言：

```text
Parser
=
词法/语法层

Validator
=
类型/结构层

Analyzer
=
语义/控制层

Runtime
=
执行层
```

例如：

```text
“submit_trade”
```

Parser 看到：

```text
Identifier
```

Validator 知道：

```text
这是一个合法 Tool Reference
```

Analyzer 知道：

```text
这是一个 Side Effect
它需要 Approval
它需要 Authorization
它需要 Idempotency
```

Runtime 才真正：

```text
call trade.submit
```

这四层各自知道什么，是整个架构是否健康的关键。

---

# 六十一、最终结论

Financial Workflow DSL 的 Parser / Validator / Analyzer 三层设计，本质上是在把：

```text
“可以运行的文本”
```

变成：

```text
“可以证明自己应该怎么运行的业务模型”
```

三层职责可以最终浓缩为：

### Parser：理解语法

```text
Source
→ Syntax AST
```

回答：

> “这段 DSL 写了什么？”

---

### Validator：证明定义合法

```text
AST
→ Valid Workflow
```

回答：

> “这是一个结构上合法、引用完整的 Workflow 吗？”

---

### Analyzer：理解系统含义

```text
Valid Workflow
→ Semantic / Control Findings
```

回答：

> “这个 Workflow 在实际金融系统里会形成什么控制、数据、权限、Evidence、风险和副作用关系？”

---

真正成熟的架构最终应该是：

```text
Markdown / YAML / UI
          ↓
        Parser
          ↓
     Syntax AST
          ↓
       Validator
          ↓
 Canonical Semantic Model
          ↓
       Analyzer
   ┌──────┼────────┐
   ↓      ↓        ↓
Policy  Data     Security
   ↓      ↓        ↓
Evidence Replay  SoD
   └──────┼────────┘
          ↓
     Governance Gate
          ↓
    Approved Workflow
          ↓
      Execution IR
          ↓
       Runtime
```

这个架构真正解决的，不是：

> “如何写一个漂亮的 Workflow DSL。”

而是：

> **如何让 Agent 生成的 Workflow 从自然语言意图，逐步变成一个可验证、可分析、可审计、可 Replay、最终才允许执行的企业控制对象。**

AWS Step Functions 已经展示了从结构化 Workflow Language、定义验证到 static-analysis diagnostics 的工程路径；Microsoft Agent Framework 已经展示了 declarative YAML 到 executable graph 以及 graph/type validation 的实现；Camunda 把 workflow model linting、设计时验证、CI 验证和运行测试作为独立能力；OPA 则证明了 Policy-as-Code 可以拥有独立的 parse / compile / schema / bundle integrity 检查。

这些实践共同说明了一点：

> **Workflow DSL 真正的价值并不在于“让 Workflow 写起来像配置文件”，而在于把 Workflow 变成一个能够被 parser、validator、analyzer、governance 和 runtime 共同理解的正式领域模型。**

对于金融 Agent，这个领域模型还应该进一步纳入：

```text
Evidence
Policy
Authorization
Human Approval
Side Effect
Idempotency
Version
Replay
```

从而形成：

> **Workflow Definition → Semantic Analysis → Governance → Execution**

这条确定性的控制链。

最终，可以把整个设计浓缩成一句话：

> **Parser 负责把文字变成结构，Validator 负责把结构变成合法定义，Analyzer 负责把合法定义变成可理解、可检查的业务语义；只有经过这三层之后，Workflow 才应该成为 Runtime 可以执行的对象。**

对于金融 Agent，真正需要避免的不是“DSL 太复杂”，而是：

> **让 LLM 的自然语言理解结果直接成为生产 Workflow 的执行语义。**

DSL + Parser + Validator + Analyzer 的意义，恰恰是给这个中间过程增加一个可以被机器验证的确定性边界。
:::

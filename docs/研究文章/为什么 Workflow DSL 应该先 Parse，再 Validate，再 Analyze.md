# 为什么 Workflow DSL 应该先 Parse，再 Validate，再 Analyze

## 一、这不是代码组织问题，而是 Workflow 能不能被可靠治理的问题

当企业开始用 DSL 描述 Agent Workflow，很容易出现一种实现：

```text
workflow.yaml
    ↓
读取 YAML
    ↓
检查几个字段
    ↓
直接执行
```

再复杂一点，就变成：

```text
workflow.yaml
    ↓
一个巨大的 validateWorkflow()
    ├── 解析
    ├── 查 Registry
    ├── 查 Policy
    ├── 分析 Graph
    ├── 查权限
    ├── 算风险
    └── 决定能不能上线
```

短期看都能工作。

长期却会出现一个根本问题：

> **系统没有把“语法”“定义合法性”和“业务含义”分开。**

而金融 Agent Workflow 恰恰需要同时处理三种完全不同的问题。

例如：

```yaml
id: trade_review

nodes:
  - id: risk_check
    type: agent
    skill: risk-review@7.2

  - id: submit_trade
    type: side_effect
    tool: trade.submit
```

系统至少需要依次回答：

### Parse

> 这段 DSL 到底写了什么？

### Validate

> 这是不是一个结构上合法的 Workflow？

### Analyze

> 这个 Workflow 在金融业务环境里有没有绕过审批、数据越权、Evidence 不足、不可 Replay、Side Effect 未保护等问题？

三个问题的答案都可能不同。

因此，一个成熟的 Workflow DSL 应该形成：

```text
Source
  ↓
Parse
  ↓
AST / Semantic Model
  ↓
Validate
  ↓
Valid Workflow
  ↓
Analyze
  ↓
Control / Risk / Impact Findings
  ↓
Governance
  ↓
Execution
```

核心原则可以概括成：

> **Parser 负责理解结构，Validator 负责证明定义合法，Analyzer 负责解释系统含义。**

“先 Parse，再 Validate，再 Analyze”不是为了形式上的三层架构，而是因为后一个阶段在语义上依赖前一个阶段已经建立的对象。

---

# 二、为什么顺序本身很重要

最简单的理由是：

> **没有 AST，就没有稳定的 Validate 对象；没有经过 Validate 的语义模型，Analyze 就无法判断自己分析的到底是不是一个合法 Workflow。**

例如原始文本：

```yaml
nodes:
  - id: risk_check
    type: agent
    skill: risk-review@7.2
```

Parser 得到：

```text
AgentNode
  id = risk_check
  skill = risk-review@7.2
```

Validator 才能进一步问：

```text
skill 字段是合法类型吗？
risk-review@7.2 的引用格式合法吗？
```

而 Analyzer 再继续问：

```text
这个 Skill 是否允许当前 Agent 使用？
这个 Agent 是否需要 Evidence？
该节点最终是否能到达 Side Effect？
```

如果没有这一层层建立起来的中间表示，Analyzer 最后只能重新解释原始文本。

于是系统实际上变成：

```text
每个模块
都自己“读一遍 DSL”
```

最终非常容易产生：

```text
Parser 理解一套
Validator 理解一套
Analyzer 理解一套
Runtime 再理解一套
```

这就是 DSL 系统最危险的 **semantic drift**。

---

# 三、这套分层其实就是编译器的基本思想

Workflow DSL 虽然不是通用编程语言，但它同样属于一种“语言”。

LLVM 的官方教程把一个简单语言的实现明确分成：

```text
Lexer
  ↓
Parser
  ↓
AST
  ↓
IR
  ↓
Code Generation
```

其中 AST 的作用，是把源语言表达的行为变成后续阶段能够理解的结构；后续章节再将 AST 转换成 LLVM IR。LLVM 还专门把控制流、优化和代码生成作为后续阶段，而不是全部塞进 parser。

Workflow DSL 完全可以采用类似的思想：

```text
Workflow Source
      ↓
Parser
      ↓
AST
      ↓
Semantic Model
      ↓
Validation
      ↓
Analysis
      ↓
Execution IR
      ↓
Workflow Runtime
```

区别只是：

```text
编程语言
→ CPU / VM / JIT

Workflow DSL
→ Workflow Runtime / Orchestrator
```

所以：

> **Workflow DSL 并不是“写个 YAML parser 就结束了”。一旦 DSL 具有条件、并行、Agent、Policy、Approval、Retry、Side Effect 等语义，它实际上已经进入 compiler / interpreter 的问题域。**

---

# 四、为什么 Agent Workflow 尤其需要这种设计

传统 Workflow 里的节点通常比较确定：

```text
Task
Task
Task
```

Agent Workflow 则经常出现：

```text
Agent
  ↓
Evidence
  ↓
LLM
  ↓
Claim
  ↓
Policy
  ↓
Human Approval
  ↓
Side Effect
```

这会带来更多“跨节点语义”。

例如：

```text
AgentNode
```

自身看起来完全合法：

```yaml
type: agent
skill: risk-review@7.2
```

但整个 Workflow 可能存在：

```text
Agent
  ↓
submit_trade
```

并且：

```text
没有 Policy
没有 Approval
没有 Evidence Requirement
```

这不是 Parser 可以发现的问题，也不只是 Schema 问题。

它属于：

> **Workflow-level semantic analysis。**

FINRA 2026 年关于 GenAI 的监管报告也明确指出，Agent 的多步骤推理和行动会增加 auditability / transparency 的难度，企业需要考虑如何监控 Agent 的访问、数据处理、Actions 和 Decisions，并设置适当的 guardrails。

因此 Agent 越自主，Workflow DSL 越不能只停留在“配置解析”。

---

# 五、Parser 的职责：把文本变成稳定结构

## 5.1 Parser 只应该回答一个问题

> **“这段 DSL 的结构是什么？”**

例如：

```yaml
- id: risk_check
  type: agent
  skill: risk-review@7.2
```

Parser 产生：

```text
AgentNode
├── id = risk_check
├── type = agent
└── skill = risk-review@7.2
```

而不是直接产生：

```text
ERROR:
Agent risk_check needs senior approval
```

因为后一句已经不是语法问题。

---

## 5.2 Parser 应该保留 Source Location

一个真正可用的 DSL Parser，不应该只产生：

```json
{
  "type": "agent"
}
```

最好还保存：

```json
{
  "type": "agent",
  "location": {
    "line": 12,
    "column": 5
  }
}
```

这样后面的 Validator / Analyzer 才能返回：

```text
workflow.yaml:12:5
ERROR WF-SEC-014
side_effect node "submit_trade"
has no authorization gate
```

而不是：

```text
Workflow invalid
```

这对 IDE、CI、Pull Request Review 和 Governance 都非常重要。

Tree-sitter 等现代 parser infrastructure 也采用这种树状表示，并支持对 syntax tree 进行结构化查询和增量处理。

---

# 六、Parser 不应该知道“金融业务规则”

这是最容易犯的架构错误。

错误设计：

```typescript
parseNode(node) {
  if (node.type === "side_effect" &&
      !node.approval) {
    throw new Error("Approval required");
  }
}
```

这样做以后 Parser 会开始不断增加：

```text
approval rules
authorization rules
evidence rules
risk rules
replay rules
SoD rules
```

最终：

```text
Parser
=
Workflow Compiler
+
Risk Engine
+
Policy Engine
+
Security Scanner
```

这是一个典型的 God Object。

正确结构是：

```text
Parser
  ↓
AST
  ↓
Validator
  ↓
Analyzer
```

Parser 可以告诉你：

```text
这是一个 SideEffectNode
```

但不能自己决定：

```text
SideEffectNode 是否允许出现
```

---

# 七、Parser 阶段允许什么，真正重要的是“不要过早丢失信息”

例如：

```yaml
skill: risk-review@unknown
```

Parser 最好仍然解析成：

```text
SkillRef("risk-review@unknown")
```

而不是：

```text
ParseError
```

因为：

```text
“语法合法，但引用不存在”
```

是 Reference Validation 问题。

这一区分很重要，因为以后可能出现：

```text
Parser Error
Schema Error
Reference Error
Semantic Error
Control Error
Risk Warning
```

这些错误具有不同的 owner 和处理方式。

---

# 八、Validator 的职责：证明“这是一个合法 Workflow”

Parser 完成以后：

```text
Syntax AST
```

只是：

> “我们理解了它写了什么。”

Validator 进一步回答：

> **“这个定义是否构成一个合法的 Workflow？”**

这一层通常可以拆成：

```text
Validator
├── Schema Validation
├── Structural Validation
└── Reference Validation
```

---

# 九、第一层 Validator：Schema Validation

最基础的问题：

```text
type 对吗？
字段存在吗？
字段类型对吗？
枚举值合法吗？
```

例如：

```yaml
type: agent
skill:
  - risk-review
```

如果 `skill` 的 schema 定义是字符串，就应该：

```text
ERROR
skill must be string
```

JSON Schema 很适合承担这一层职责，因为它专门用于描述 JSON 数据结构、类型和约束。

但需要特别注意：

> **Schema Validation 不是 Workflow Semantic Validation。**

Schema 可以很好地描述：

```text
skill: string
```

却未必能表达：

```text
每个 side effect 都必须受到 approval path 保护
```

这就是下一层和 Analyzer 的工作。

---

# 十、第二层 Validator：Structural Validation

Workflow 不是普通 JSON。

它实际上是：

```text
Graph
=
Nodes + Edges
```

因此需要检查：

```text
Start
End
Reachability
Edges
Duplicate IDs
Duplicate Edges
Invalid References
```

例如：

```text
Start → A → B

X
```

如果 `X` 从 Start 永远无法到达，那么它应该被标记。

同样：

```text
A → B
B → C
C → nowhere
```

可能形成一个没有合法终点的路径。

Microsoft Agent Framework 当前在 Workflow build 阶段就进行类似的检查，包括 type compatibility、graph connectivity、executor binding、duplicate edges 和 invalid connections。

AWS Step Functions 也提供专门的 state-machine definition validation：定义通过后可以创建/更新，发现错误则返回 `FAIL`；同时可以请求 `WARNING` 级别诊断，用于 static analysis。

---

# 十一、第三层 Validator：Reference Validation

例如：

```yaml
skill: risk-review@7.2
policy: trade-limit@23
tool: trade.submit
```

Validator 可以检查：

```text
Skill Registry
Policy Registry
Tool Registry
Schema Registry
```

是否能够解析这些引用。

结果：

```text
risk-review@7.2    ✓
trade-limit@23     ✓
trade.submit       ✓
unknown.tool       ✗
```

这里仍然不要过早判断：

> “trade.submit 对这个 Agent 是否安全？”

Validator 只应该确认：

> `trade.submit` 是不是一个存在并且结构正确的 Tool Reference。

“是否允许使用”属于 Analyzer / Policy。

---

# 十二、为什么 AWS 的 Validation API 是一个非常好的参考

AWS Step Functions 的 `ValidateStateMachineDefinition` 非常值得借鉴，因为它清楚地区分了：

```text
Result
Diagnostics
Severity
Location
```

`OK` 表示定义可以创建或更新，`FAIL` 表示存在阻止创建或更新的错误；同时可以返回 `WARNING` 和 `ERROR` 两类 diagnostics。AWS 还明确要求自动化不要依赖 diagnostic message 的具体文字和顺序，而应该依赖稳定的 result / code 等机器接口。

对于企业 Workflow DSL，这意味着错误结构最好类似：

```json
{
  "code": "WF-REF-001",
  "severity": "ERROR",
  "phase": "VALIDATE",
  "location": "nodes[3].tool",
  "message": "Unknown tool reference",
  "resource": "trade.submit"
}
```

而不是：

```json
{
  "error": "something went wrong"
}
```

---

# 十三、Validator 应该是确定性的

Validator 是企业控制链的一部分，因此：

```text
same AST
    ↓
same validator configuration
    ↓
same result
```

应该稳定。

不应该让：

```text
LLM
```

参与：

```text
“这个字段是否合法？”
```

或者：

```text
“这个 graph 是否存在 orphan node？”
```

这些属于确定性问题。

OPA 的 `opa check` 就采用非常明确的方式：检查 Rego source 的 parse 和 compile errors，并可以结合 schema 和 strict mode 做更严格的静态检查。

这类设计说明：

> **声明式语言的“合法性”最好由确定性的 parser / compiler / validator 体系保证，而不是靠另一个模型进行主观判断。**

---

# 十四、Analyzer 为什么不能和 Validator 合并

因为两者处理的问题复杂度完全不同。

Validator 问：

```text
“这个定义合法吗？”
```

Analyzer 问：

```text
“这个合法定义意味着什么？”
```

例如：

```text
type: side_effect
tool: trade.submit
```

Schema：

```text
合法
```

Reference：

```text
tool 存在
```

Graph：

```text
路径存在
```

全部通过。

但是 Analyzer 可能发现：

```text
submit_trade
  ↑
approval node not guaranteed
```

因此：

```text
Validator = PASS
Analyzer  = ERROR
```

这不是矛盾，而是正确的分层。

---

# 十五、Analyzer 才是真正的“Workflow Intelligence”

Analyzer 处理的是：

```text
Cross-node
Cross-resource
Cross-path
Cross-policy
Cross-data
Cross-version
```

关系。

它不是简单检查某一个节点。

可以把它理解成：

```text
Valid Workflow
     ↓
Semantic Graph
     ↓
Analyzer
```

这里最好建立多个视图：

```text
Control-flow graph
Data-flow graph
Capability graph
Policy graph
Evidence graph
Dependency graph
```

这些 graph 可以共享同一套 Canonical Semantic Model。

---

# 十六、第一类 Analyzer：Control-Flow Analysis

它关注：

```text
Reachability
Dead Nodes
Dead Ends
Cycles
Loops
Branch Completeness
Join Correctness
```

例如：

```text
Start
 ↓
Risk
 ├── High → Approval
 └── Low  → Submit
```

Analyzer 可以进一步问：

```text
Submit 是否所有路径都经过 Policy？
```

这已经不是单节点检查。

而是：

```text
Path-sensitive analysis
```

Camunda 当前的 BPMN tooling 就采用 lint rule 对 workflow model 进行设计时验证，并把这些检查放入 CI/CD；其官方文档还支持 custom rules。

---

# 十七、第二类 Analyzer：Data-Flow Analysis

例如：

```text
risk_review
output:
  riskLevel
```

而：

```text
submit_trade
requires:
  approvalStatus
```

Validator 看：

```text
字段类型合法
```

Analyzer 看：

```text
approvalStatus 从哪里来？
```

如果整个 Workflow 中没有 producer：

```text
ERROR:
No producer for approvalStatus
```

这就是典型的数据流分析。

对于金融 Workflow，它尤其重要，因为很多风险不是：

> “字段格式错了。”

而是：

> **“数据从错误的来源、在错误的时点、以错误的权限流到了错误的节点。”**

---

# 十八、第三类 Analyzer：Capability / Authorization Analysis

Agent Workflow 与普通 Workflow 最大的区别之一，是：

```text
Agent
Tool
Data
Permission
```

之间存在动态关系。

例如：

```text
Agent: risk-review
Allowed:
  read:risk
  read:client

Tool:
  trade.submit
Requires:
  write:trade
```

Graph 看起来完全正确：

```text
risk-review → trade.submit
```

Analyzer 可以发现：

```text
Capability Mismatch
```

也就是：

```text
Agent Capability
    ≠
Tool Required Capability
```

于是：

```text
ERROR:
Agent cannot legally invoke trade.submit
```

这里的重点是：

> IAM / Authorization 是运行时控制。

Analyzer 是设计时控制。

两者应该并存，而不是互相取代。

---

# 十九、第四类 Analyzer：Policy-Path Analysis

这是金融领域最值得做的一类分析。

例如企业规定：

```text
交易金额 > 5m
→ Senior Approval Required
```

Workflow：

```text
Risk Review
   ↓
Condition
 ├── amount <= 5m → Submit
 └── amount > 5m  → Approval
```

表面上没有错误。

但如果还有另一个分支：

```text
Risk Review
   ↓
Exception Path
   ↓
Submit
```

并且 Exception Path 也可以处理：

```text
amount > 5m
```

那么就存在：

```text
Policy Bypass
```

只有把：

```text
Workflow Graph
+
Policy
```

结合分析，才能发现。

DMN 的定位本身就是对 business decisions / business rules 做精确建模，并且官方标准特别强调 DMN 与 BPMN 的互补关系：BPMN 描述流程，而 DMN 描述决策。

这对 Agent Workflow 很有启发：

> **Workflow 不应该把所有业务规则都硬编码进 Agent 或 DSL，而应该让 Policy / Decision Model 成为独立语义来源，再由 Analyzer 检查二者之间是否一致。**

---

# 二十、第五类 Analyzer：Evidence Analysis

前面的 Evidence-First 设计，在这里真正落到 Workflow 层。

例如：

```yaml
type: agent

evidence:
  required:
    - client-risk
    - current-exposure
    - applicable-limit
```

Analyzer 需要追踪：

```text
Required Evidence
      ↓
Retriever / Tool
      ↓
Agent Input
      ↓
Claim
      ↓
Decision
```

如果：

```text
applicable-limit
```

没有任何来源：

```text
ERROR:
Required evidence has no producer
```

如果只有：

```text
search.web
```

但企业 Policy 要求：

```text
approved_policy
```

则：

```text
ERROR:
Evidence authority is insufficient
```

如果数据可能超过：

```text
freshness = 1h
```

则：

```text
WARNING:
Evidence freshness constraint not guaranteed
```

于是 Evidence 不再是：

```text
Agent Prompt 中的一段 Context
```

而成为：

> **Workflow 的正式 dependency。**

---

# 二十一、第六类 Analyzer：Replayability Analysis

如果 Workflow 要求事后可 Replay，那么 Analyzer 可以在设计阶段检查：

```text
Agent
  ↓
LLM
  ↓
External API
  ↓
Side Effect
```

每个依赖是否声明：

```text
recorded
snapshot
recompute
sandbox
prohibited
```

例如：

```yaml
tool: risk-api

replay:
  mode: recorded
```

而：

```yaml
tool: calculate-exposure

replay:
  mode: recompute
```

如果：

```yaml
tool: trade.submit
```

完全没有 Replay Semantics：

```text
ERROR:
Workflow is not forensically replayable
```

这很适合金融场景，因为 Replay 的完整性应该尽可能在设计时被分析，而不是事故发生之后才发现：

> “当时的 API response 根本没保存。”

---

# 二十二、第七类 Analyzer：Retry / Idempotency Analysis

例如：

```text
retry:
  max_attempts: 3

action:
  trade.submit
```

如果没有：

```text
idempotency_key
```

那么：

```text
Retry
→ Duplicate Trade
```

这种问题很难仅通过 Schema 捕获。

因为：

```text
retry.max_attempts = 3
```

语法完全合法。

但：

```text
retry
+
side_effect
+
non-idempotent
```

组合起来就构成高风险。

这正是 Analyzer 的典型职责。

Google Cloud Workflows 的官方文档也明确要求根据步骤是否幂等选择 Retry 策略，并区分 idempotent 与 non-idempotent operations。

---

# 二十三、第八类 Analyzer：Human-in-the-loop / SoD Analysis

金融 Workflow 中：

```text
Human Approval
```

不是简单一个节点。

Analyzer 可以检查：

```text
Approver role exists
Approver has required authority
Requester ≠ Approver where required
Approval happens before Side Effect
Reject path exists
Timeout defined
Evidence available before approval
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

如果企业要求：

```text
requester cannot approve own request
```

那么 Analyzer 应该发现：

```text
ERROR:
Potential segregation-of-duties violation
```

这就是：

```text
Syntax
→ Validator
→ Analyzer
```

的典型完整链路。

---

# 二十四、第九类 Analyzer：Version / Provenance Analysis

生产 Workflow 不应该依赖：

```text
latest
current
main
```

尤其：

```yaml
skill: risk-review@latest
policy: trade-limit@current
```

Syntax：

```text
合法
```

Reference：

```text
可以解析
```

Analyzer：

```text
ERROR:
Production workflow contains floating control dependency
```

金融治理尤其需要这一层。

FINRA 2026 年公开报告建议企业在 GenAI Monitoring 中考虑存储 prompt/output logs，并记录“which model version was used and when”，同时建立正式监督/治理/模型风险管理框架。

DORA Article 9 则要求金融实体对 ICT change management 建立记录、测试、评估、批准、实施和验证的控制。

这些监管要求并没有规定：

> “一定要有 Workflow Analyzer。”

但从架构角度可以推导出：

> **设计时发现版本漂移、未固定依赖和控制路径变化，是实现这些治理目标的一种合理工程能力。**

这属于架构推论，不是法规原文。

---

# 二十五、Parser / Validator / Analyzer 其实对应三种完全不同的错误

可以建立一个非常清晰的错误模型：

| 阶段       | 问题              | 示例                       |
| -------- | --------------- | ------------------------ |
| Parse    | 我读不懂            | YAML syntax error        |
| Validate | 我读懂了，但定义不合法     | tool reference 不存在       |
| Analyze  | 定义合法，但业务/控制上有问题 | Side Effect 可绕过 Approval |

例如：

```text
type: agent
skill: risk-review@7.2
```

### Parse

```text
✓ valid syntax
```

### Validate

```text
✓ AgentNode schema valid
✓ SkillRef format valid
✓ Skill exists
```

### Analyze

```text
ERROR:
Agent result can reach trade.submit
without evidence requirement.
```

这种错误分层以后，系统的责任边界非常清楚。

---

# 二十六、为什么不能反过来：先 Analyze，再 Parse

这听起来很荒谬，但很多 Agent 系统实际上就是这么做的。

例如：

```text
Markdown
   ↓
LLM
   ↓
“我觉得这个 Workflow 有风险”
```

问题是：

> 这个“风险”到底对应源文件中的哪个结构？

如果 LLM 自己决定：

```text
这里是一个 approval
那里是一个 side effect
```

你实际上已经把 DSL 的解析语义交给了概率模型。

这会让：

```text
Analyzer
=
第二个 Parser
```

最终产生两个问题：

1. 每次分析可能得到不同 interpretation。
2. 无法形成稳定的 machine-readable source of truth。

正确方法是：

```text
Parser
→ 明确结构

Analyzer
→ 分析明确结构
```

而不是：

```text
Analyzer
→ 猜结构
→ 再分析
```

---

# 二十七、为什么也不能 Parse 完直接 Analyze

因为一个未经 Validation 的 AST 可能根本不是一个合法 Workflow。

例如：

```text
A → B
B → UnknownNode
```

或者：

```text
A → B
A → B
A → A
```

如果 Analyzer 在这种状态上工作，结果可能：

```text
不确定
难解释
难复现
难测试
```

例如 Analyzer 发现：

```text
“B 永远不可达”
```

但实际上：

```text
edge target
```

写错了。

那么你究竟是在分析：

```text
合法 Workflow
```

还是：

```text
一个坏掉的 Workflow
```

Validator 的作用，就是给 Analyzer 一个契约：

> **Analyzer 处理的是一个符合 DSL Structural Contract 的语义对象。**

---

# 二十八、但是“Validate 完才能 Analyze”也不是绝对的实现禁忌

这里需要避免把文章的观点说得过头。

现实中的 parser、validator、analyzer 经常会共享阶段。

例如：

```text
Parser
同时发现：
syntax error

Schema Validator
可能在 parse 后立即执行

Static Analyzer
也可能在 compiler 中做
```

AWS 的 State Machine validation API 本身就同时暴露 syntax validation 与 static-analysis diagnostics；Camunda Web Modeler 也是在建模过程中持续执行 lint checks；OPA 的 `check` 同时涉及 parse / compile / schema / strict checks。

因此本文说的：

> **“先 Parse，再 Validate，再 Analyze”**

应该理解成：

> **三种逻辑责任有明确的依赖顺序。**

而不是：

> **必须在三个独立进程中严格串行执行。**

实际实现完全可以：

```text
Parser + cheap schema checks
```

或者：

```text
Compiler pass 1 / pass 2 / pass 3
```

关键是：

> **责任边界分离，而不是代码文件必须分离。**

---

# 二十九、Canonical Semantic Model 是三层之间真正重要的东西

推荐架构不要变成：

```text
Parser → object A
Validator → object B
Analyzer → object C
Runtime → object D
```

这样很容易出现不同模块理解不同语义。

更合理的是：

```text
Source
  ↓
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
      ├── Simulator
      ├── Visualizer
      ├── Replay
      └── Runtime Adapter
```

其中：

```text
Canonical Semantic Model
```

才是真正的 Single Source of Truth。

---

# 三十、为什么需要“AST → Semantic Model”这一层

因为 Workflow 不一定只是树。

例如：

```text
A
├── B
│   └── D
└── C
    └── D
```

这更接近：

```text
Directed Graph
```

而不是普通 AST。

所以推荐：

```text
Source
 ↓
Syntax AST
 ↓
Semantic Model
 ↓
Workflow Graph IR
```

例如：

```typescript
type WorkflowGraph = {
  nodes: Map<NodeId, WorkflowNode>;
  edges: Edge[];
  dataFlows: DataFlow[];
  policies: PolicyRef[];
  capabilities: CapabilityRef[];
  evidenceRequirements: EvidenceRequirement[];
};
```

这样 Analyzer 可以直接工作在：

```text
WorkflowGraph
```

上。

而不是重新从 YAML 找：

```text
“哪个字段表示 next”
```

---

# 三十一、一个适合金融 Agent 的三层内部结构

推荐最终形成：

```text
                    Source
                      │
                      ▼
              ┌──────────────┐
              │    Parser    │
              └──────┬───────┘
                     │
                Syntax AST
                     │
                     ▼
              ┌──────────────┐
              │   Validator  │
              └──────┬───────┘
                     │
              Valid Semantic Model
                     │
                     ▼
              ┌──────────────┐
              │   Analyzer   │
              └──────┬───────┘
                     │
           ┌─────────┼─────────┐
           ▼         ▼         ▼
       Control     Data     Governance
        Flow       Flow       Policy
           │         │         │
           └─────────┼─────────┘
                     ▼
                Findings
                     │
                     ▼
              Deployment Policy
                     │
              ┌──────┴──────┐
              ▼             ▼
            Reject        Approve
                              │
                              ▼
                         Execution IR
```

这才是完整的 Workflow Compiler / Governance Pipeline。

---

# 三十二、为什么 Analyzer 应该晚于 Validator：因为 Analyzer 的输入应该是“事实”，不是“猜测”

这是三层设计最深的原因。

Parser 产生：

```text
结构事实
```

Validator 产生：

```text
定义事实
```

Analyzer 基于这些事实推导：

```text
语义事实
```

例如：

```text
Parser:
Node X is side_effect

Validator:
Tool trade.submit exists

Analyzer:
Node X is reachable from branch Y
without approval
```

每一层都是前一层的信息增量。

可以表示成：

```text
T0 = Source Text

T1 = Parsed Structure(T0)

T2 = Valid Semantic Model(T1)

T3 = Analyzed System Model(T2)

T4 = Governance Decision(T3)
```

这样每一步都可以独立检查。

这也是编译器架构为什么长期采用阶段化 pipeline 的根本原因之一。LLVM 官方教程从 parser/AST 到 IR，再到 code generation 的逐阶段结构，本质上就是为了让不同语义责任具有稳定中间表示。

---

# 三十三、这对 LLM 特别重要：让模型负责生成，不负责最终解释

一个合理的 Agent Workflow authoring pipeline 可以是：

```text
Business Analyst
       ↓
Natural Language / Markdown
       ↓
LLM
       ↓
Workflow DSL
       ↓
Parser
       ↓
Validator
       ↓
Analyzer
       ↓
Human Review
       ↓
Approved Workflow
```

这样 LLM 的责任是：

```text
生成候选 Workflow
```

而不是：

```text
决定它是否合法
```

也不是：

```text
决定它是否安全
```

也不是：

```text
决定它是否应该上线
```

这和近期金融 AI 治理讨论非常契合。Bank of England 2026 年 AI Consortium 讨论了 agentic tools 的 model harness 和 execution boundaries，并强调将 LLM 的概率性推理与确定性的系统动作分离；同时强调需要从单一模型转向整个 AI model system 的治理。

所以：

```text
LLM
=
Author / Planner

Parser
=
Language Frontend

Validator
=
Deterministic Correctness Gate

Analyzer
=
System-level Reasoning

Governance
=
Organizational Decision

Runtime
=
Execution
```

这个边界非常重要。

---

# 三十四、金融 Workflow 最好增加一个“Control Analyzer”

通用 Analyzer 可以解决：

```text
Graph
Data
Type
Dependency
```

金融领域则需要进一步：

```text
Control Analyzer
```

可以分析：

### Authorization

```text
谁可以调用这个 Tool？
```

### SoD

```text
Requester 是否可能自己审批？
```

### Policy Coverage

```text
所有高风险路径是否都有 Policy Gate？
```

### Evidence

```text
这个 Decision 需要的 Evidence 是否存在？
```

### Side Effect

```text
真实业务动作是否被明确隔离？
```

### Replay

```text
历史执行是否能够重建？
```

### Version

```text
关键依赖是否 immutable？
```

这样可以：

```text
Generic Analyzer
+
Financial Control Pack
```

而不是把所有金融规则硬编码进 Core DSL。

---

# 三十五、Analyzer 结果应该是“Findings”，不是最终业务决定

例如：

```json
{
  "code": "FIN-SOD-001",
  "severity": "ERROR",
  "message": "Requester may approve own transaction"
}
```

或者：

```json
{
  "code": "FIN-REPLAY-003",
  "severity": "WARNING",
  "message": "External pricing result is not snapshot-capable"
}
```

这些是：

```text
facts / findings
```

再交给：

```text
Governance Policy
```

决定：

```text
DENY
REVIEW
ALLOW
```

这样：

```text
Analyzer
≠
Risk Appetite Engine
```

这非常重要。

否则以后：

```text
不同业务
不同国家
不同监管主体
不同产品
```

都要重写 Analyzer。

---

# 三十六、把 Analyzer 直接做成“上线按钮”是一个坏架构

错误：

```text
Analyzer
   ↓
riskScore = 0.8
   ↓
Deploy / Deny
```

更合理：

```text
Analyzer
   ↓
Findings
   ↓
Governance Rules
   ↓
Approval Requirements
   ↓
Release Decision
```

例如：

```text
Analyzer:
HIGH_AUTONOMY
+
EXTERNAL_MODEL
+
SIDE_EFFECT
+
NO_HUMAN_GATE
```

Governance Policy：

```text
Production:
require senior approval
```

UAT：

```text
allow
```

Sandbox：

```text
allow
```

这种设计更符合金融机构风险治理，而不是让一个静态 analyzer 变成“万能风险评分器”。

---

# 三十七、CI/CD 正是三层设计最合适的落点

一个金融 Workflow Pull Request 可以经过：

```text
PR
 ↓
Parser
 ↓
Validator
 ↓
Analyzer
 ↓
Unit Tests
 ↓
Integration / Simulation
 ↓
Human Review
 ↓
Signed Artifact
 ↓
Deployment
```

例如：

### PR 阶段

```text
Parse
Schema
Structure
Basic References
```

### CI 阶段

```text
Graph Analysis
Data Flow
Policy Analysis
Security Analysis
Replayability
```

### Staging

```text
Integration Tests
Simulation
Mock Side Effects
```

### Production

```text
Approval
Immutable Version
Deploy
```

Camunda 当前官方 CI/CD 文档就明确建议在 pipeline 中使用 `bpmnlint` / `dmnlint` 自动检查流程模型，并结合 unit / integration tests 和 version review；Web Modeler 还支持设计阶段持续 validation。

这说明：

> **Workflow DSL 的静态分析不是 IDE 附属功能，而可以成为正式的 Release Gate。**

---

# 三十八、为什么金融场景尤其需要把 Analyze 放在 Deployment 之前

DORA Article 9 要求金融机构对 ICT changes 建立风险导向的、文档化的 change-management controls，使变化：

```text
recorded
tested
assessed
approved
implemented
verified
```

在受控条件下完成。

这并没有规定：

```text
“必须有 Workflow Analyzer”
```

但可以自然映射成：

```text
Parse
→ recorded structure

Validate
→ technically valid definition

Analyze
→ assessed control / risk impact

Test
→ verified behavior

Governance
→ approved change

Deploy
→ implemented change
```

因此：

> **Parser / Validator / Analyzer 三层，是把金融 change management 前移到 Workflow Definition 的一个合理工程实现。**

---

# 三十九、真实产品已经证明“定义检查”和“业务分析”可以独立存在

AWS Step Functions：

```text
ASL
  ↓
ValidateStateMachineDefinition
  ↓
Diagnostics
```

Microsoft Agent Framework：

```text
Declarative YAML
  ↓
Executable Graph
  ↓
Workflow Validation
```

Camunda：

```text
BPMN/DMN
  ↓
Lint
  ↓
CI Verification
  ↓
Test
```

OPA：

```text
Rego
  ↓
parse
  ↓
compile
  ↓
schema / strict checks
  ↓
policy evaluation
```

这些产品的内部实现当然不完全等于本文的三层模型，也不能据此断言它们都严格采用“Parser/Validator/Analyzer”三个独立模块。

但它们共同支持一个事实：

> **正式的声明式语言通常需要把解析、定义正确性检查、以及更高层的静态/语义分析区别开来。**

---

# 四十、三层之间最重要的不是“代码分目录”，而是“语义不越界”

建议明确下面这张边界表：

| 问题                    | Parser | Validator | Analyzer |
| --------------------- | :----: | :-------: | :------: |
| YAML / Markdown 是否能解析 |    ✓   |           |          |
| 节点类型是否合法              |        |     ✓     |          |
| 字段类型是否正确              |        |     ✓     |          |
| Node ID 是否唯一          |        |     ✓     |          |
| Reference 是否存在        |        |     ✓     |          |
| Graph 是否完整            |        |    ✓ /    |     ✓    |
| Data dependency       |        |           |     ✓    |
| Policy path           |        |           |     ✓    |
| Evidence coverage     |        |           |     ✓    |
| Authorization         |        |           |     ✓    |
| SoD                   |        |           |     ✓    |
| Replayability         |        |           |     ✓    |
| Idempotency           |        |           |     ✓    |
| Impact Analysis       |        |           |     ✓    |
| 最终是否允许 Production     |        |           |   不直接决定  |

最后一条尤其重要。

Analyzer 应该产生：

```text
Findings
```

而最终：

```text
Governance Policy
```

决定：

```text
Approve
Review
Deny
```

---

# 四十一、推荐的错误码体系

建议从一开始就设计：

```text
WF-PARSE-xxx
WF-SCHEMA-xxx
WF-REF-xxx
WF-GRAPH-xxx
WF-DATA-xxx
WF-POLICY-xxx
WF-EVIDENCE-xxx
WF-AUTH-xxx
WF-REPLAY-xxx
WF-IDEMP-xxx
WF-SOD-xxx
WF-VERSION-xxx
```

例如：

```text
WF-PARSE-001
Unexpected token

WF-SCHEMA-002
Missing required field

WF-REF-003
Unknown skill reference

WF-GRAPH-004
Unreachable node

WF-POLICY-005
Side effect reachable without policy gate

WF-EVIDENCE-006
Required evidence has no producer

WF-REPLAY-007
External dependency has no replay contract

WF-SOD-008
Potential segregation-of-duties violation
```

这样：

```text
Editor
CI
Governance
Audit
```

都可以消费同一套 diagnostics。

---

# 四十二、还应该给 Finding 一个“Evidence Path”

金融 Analyzer 不应该只是：

```text
WF-POLICY-005
```

最好能够告诉：

```text
Start
→ risk_review
→ low_risk_branch
→ submit_trade
```

以及：

```text
Required:
approval
Observed:
none
```

于是 analyzer 的结果本身就变成：

```text
Finding
+
Path Evidence
```

这对人工审查非常有价值。

它把：

```text
“我认为不安全”
```

变成：

```text
“这条具体路径绕过了这个具体控制点”
```

这种结果才容易进入企业 Architecture Review / Risk Review。

---

# 四十三、Analyzer 应该尽量采用图算法，而不是 LLM

例如：

```text
Reachability
DFS / BFS

Cycle
SCC / graph algorithm

Dead End
sink analysis

Data Flow
producer-consumer graph

Capability
set intersection

Policy Coverage
path analysis

Version Pinning
reference inspection

Replayability
dependency closure
```

这些都可以确定性实现。

LLM 可以用在：

```text
Natural-language explanation
Suggested fix
Generate test cases
Generate initial DSL
```

但不要用来替代：

```text
deterministic analyzer
```

因为：

> **Analyzer 本身就是企业控制链的一部分。**

---

# 四十四、Analyzer 可以给 LLM 提供结构化反馈

这反而是 LLM 最适合参与的地方。

例如：

```text
LLM generates:

risk_review
→ submit_trade
```

Analyzer：

```text
ERROR WF-POLICY-005
Missing approval gate
```

再把结构化 feedback 给 LLM：

```text
Fix:
Add human_approval node satisfying
policy "trade-approval@23"
```

LLM 修改 DSL：

```text
risk_review
→ trade_policy
→ approval
→ submit_trade
```

再次：

```text
Parse
→ Validate
→ Analyze
```

直到：

```text
No blocking findings
```

于是：

```text
LLM
=
Generator

Analyzer
=
Deterministic critic
```

而不是：

```text
LLM
=
Generator + Judge + Executor
```

这会明显更可靠。

---

# 四十五、这是“Structured Compiler Loop”，而不是 Agent 自我反思

可以形成：

```text
Natural Language
      ↓
LLM
      ↓
Workflow DSL
      ↓
Parser
      ↓
Validator
      ↓
Analyzer
      ↓
Findings
      ↓
LLM Fix
      ↓
Parser
      ↓
Validator
      ↓
Analyzer
      ↓
Approved
```

这比：

```text
LLM
“请检查你刚才的 Workflow 有没有问题”
```

更加确定。

因为后者仍然是：

```text
LLM
→ LLM
```

前者是：

```text
LLM
→ formal language
→ formal checks
```

这正是 DSL 在 Agent 时代重新变得重要的原因之一。

---

# 四十六、Workflow AST 还可以成为 Visualization / Replay / Audit 的共同基础

一旦 Canonical Semantic Model 稳定：

```text
Workflow AST
      ├── Runtime
      ├── Validator
      ├── Analyzer
      ├── Visualizer
      ├── Simulator
      ├── Replay
      ├── Audit
      └── Documentation
```

Microsoft Agent Framework 当前已经提供 Workflow visualization，将 workflow 结构渲染为 Mermaid 或 Graphviz；这说明 Workflow graph 可以成为多种工具的共同底层表示，而不是只服务 runtime。

因此：

> **不要让 Mermaid、UI diagram、Runtime JSON 和 DSL 各自成为一份 workflow definition。**

最好是：

```text
Canonical Model
      ↓
多种 Projection
```

---

# 四十七、这也能解决“图和代码漂移”的老问题

传统系统经常出现：

```text
BPMN Diagram
    ≠
Java Implementation
```

或者：

```text
Wiki Documentation
    ≠
Actual Runtime
```

Agent 时代还会增加：

```text
Prompt
    ≠
Runtime Behavior
```

Canonical Workflow Model 可以变成唯一真相：

```text
Source
  ↓
Canonical Model
  ├── Diagram
  ├── Runtime
  ├── Docs
  ├── Tests
  └── Audit
```

于是：

```text
one semantic source
many projections
```

而不是：

```text
many sources
manual synchronization
```

---

# 四十八、Financial Workflow DSL 最后最好形成“Compiler + Control Plane”

最终架构可以是：

```text
                    Workflow Control Plane

                     ┌──────────────┐
Source ─────────────▶│    Parser    │
                     └──────┬───────┘
                            │
                            ▼
                     ┌──────────────┐
                     │  Validator   │
                     └──────┬───────┘
                            │
                     Canonical Model
                            │
                            ▼
                     ┌──────────────┐
                     │   Analyzer   │
                     └──────┬───────┘
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
     Security            Policy             Replay
     Analysis            Analysis            Analysis
        │                   │                   │
        └───────────────────┼───────────────────┘
                            ▼
                     Governance Gate
                            │
                            ▼
                      Versioned IR
                            │
                            ▼
                       Runtime
```

这时：

```text
Agent Runtime
```

只负责运行 Agent Node。

而：

```text
Control Plane
```

负责决定：

```text
这个 Workflow 是什么
是否合法
有没有控制问题
有没有审批
能不能上线
```

这与 Bank of England 2026 年对 Agentic AI 的讨论高度一致：其 AI Consortium 明确讨论了 model harness、execution boundaries，以及将 LLM 的概率性推理与确定性的系统动作隔离，并强调应该从整个 AI system / model system 的层次治理多个相互连接、可以独立变化的组件。

---

# 四十九、一个实际可落地的最小版本

不需要一开始就造完整编译器。

第一阶段可以只做：

```text
Parser
  ↓
AST
  ↓
Validator
  ↓
5 个 Analyzer
```

五个最值得优先做的 Analyzer：

```text
1. Reachability
2. Side-effect / Approval
3. Authorization / Capability
4. Evidence Requirement
5. Version Pinning
```

第二阶段增加：

```text
6. Data Flow
7. Policy Path
8. Retry / Idempotency
9. SoD
10. Replayability
```

第三阶段再增加：

```text
11. Change Impact
12. Risk Analysis
13. Simulation
14. Automatic Test Generation
15. Historical Execution Comparison
```

这样可以从一个很小的 DSL 开始逐步演进，而不必一开始设计成一个完整 BPMN 替代品。

---

# 五十、不要把 Parser / Validator / Analyzer 三层做成三个微服务

这是最后一个容易走偏的问题。

逻辑职责应该分离。

不代表一定要：

```text
parser-service
validator-service
analyzer-service
```

三个网络服务。

对于很多企业平台，第一阶段完全可以是：

```text
workflow-compiler
├── parser
├── validator
└── analyzer
```

一个进程。

关键在于：

```text
interface separation
semantic separation
test separation
ownership separation
```

以后规模增长，才考虑拆分。

否则很容易为了架构而架构。

---

# 五十一、推荐的代码结构

例如：

```text
workflow-dsl/
├── grammar/
│   └── workflow.grammar
│
├── parser/
│   ├── parser.ts
│   ├── syntaxAst.ts
│   └── sourceMap.ts
│
├── semantic/
│   ├── model.ts
│   ├── normalize.ts
│   └── graph.ts
│
├── validator/
│   ├── schema.ts
│   ├── structure.ts
│   └── references.ts
│
├── analyzer/
│   ├── controlFlow.ts
│   ├── dataFlow.ts
│   ├── policy.ts
│   ├── evidence.ts
│   ├── capability.ts
│   ├── replay.ts
│   ├── idempotency.ts
│   └── sod.ts
│
├── diagnostics/
│   └── findings.ts
│
├── compiler/
│   └── executionPlan.ts
│
└── runtime/
    └── executor.ts
```

这个结构最大的价值不是目录好看，而是：

> **每个阶段都有清晰输入和输出。**

---

# 五十二、最终的数据流应该明确

```text
Source
↓
ParseResult
↓
SyntaxAST
↓
SemanticModel
↓
ValidationResult
↓
AnalyzedModel
↓
AnalysisFindings
↓
GovernanceDecision
↓
ExecutionIR
```

例如：

```typescript
type ParseResult = {
  ast?: SyntaxAst;
  diagnostics: Diagnostic[];
};

type ValidationResult = {
  model?: WorkflowModel;
  diagnostics: Diagnostic[];
};

type AnalysisResult = {
  findings: Finding[];
  facts: WorkflowFacts;
};

type GovernanceResult = {
  status: "APPROVED" | "REVIEW" | "REJECTED";
};
```

这比：

```typescript
compileWorkflow(source): ExecutableWorkflow
```

更加适合金融环境。

因为每一步都可以被：

```text
review
test
audit
cache
replay
```

---

# 五十三、最终应该把三层的职责压缩成三个问题

## Parser

> **“你写了什么？”**

输出：

```text
Syntax AST
```

---

## Validator

> **“这是不是一个合法的 Workflow？”**

输出：

```text
Valid Semantic Model
```

---

## Analyzer

> **“这个合法 Workflow 在企业环境里意味着什么？”**

输出：

```text
Facts
Findings
Control Paths
Risk Signals
Impact
```

然后：

```text
Governance
```

回答：

> **“因此现在允许不允许它上线？”**

最后：

```text
Runtime
```

回答：

> **“已经批准的 Workflow 如何执行？”**

---

# 五十四、结论

“先 Parse，再 Validate，再 Analyze”真正重要的地方，不是软件工程上的代码整洁。

它实际上定义了 Agent Workflow 的控制边界：

```text
Parse
=
不要让系统靠猜来理解 Workflow

Validate
=
不要让非法 Workflow 进入后续流程

Analyze
=
不要把业务、权限、Policy、Evidence 和风险问题留到 Runtime 才发现

Governance
=
不要让 Analyzer 自己决定企业是否接受风险

Runtime
=
只执行已经被验证和批准的 Workflow
```

因此最终架构应该是：

```text
Natural Language / Markdown / YAML
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
       ┌─────────┼──────────┐
       ↓         ↓          ↓
    Policy    Evidence    Security
     Flow       Flow        Flow
       ↓         ↓          ↓
       └─────────┼──────────┘
                 ↓
            Governance
                 ↓
        Approved Workflow
                 ↓
           Execution IR
                 ↓
              Runtime
```

这条链路与成熟的 Workflow / DSL / Policy-as-Code 实践是相符的：AWS Step Functions 对结构化 Workflow Definition 提供独立 validation 和 static-analysis diagnostics；Microsoft Agent Framework 将 Declarative Workflow 转换为 executable graph 并执行 graph/type validation；Camunda 把模型 linting、CI verification 和运行测试作为独立质量控制；OPA 则将 parse、compile、schema 和 strict checking 分成可自动化的语言工具链。

金融环境进一步放大了这种分层的价值。DORA 要求 ICT 变化被记录、测试、评估、批准、实施和验证；FINRA 2026 年对 GenAI 的监管观察强调治理、综合文档、持续测试监控、模型版本跟踪以及 Agent Actions / Decisions 的可审计性；Bank of England 2026 年 AI Consortium 讨论则进一步强调 Agentic AI 的 execution boundaries、model harness 和整个 AI system 的系统级治理。

因此，金融 Workflow DSL 不应该是：

```text
YAML
  ↓
Runtime
```

而应该是：

```text
YAML / Markdown
  ↓
Parse
  ↓
Validate
  ↓
Analyze
  ↓
Govern
  ↓
Execute
```

其中最关键的一点是：

> **Parser、Validator、Analyzer 不应该互相“猜”；每一层都应建立下一层可以信任的结构化事实。**

对于 Agent，尤其应该坚持：

```text
LLM 可以生成 Workflow
      ↓
但不能自行定义 Workflow 的正式语义
      ↓
Parser 建立结构
      ↓
Validator 建立合法性
      ↓
Analyzer 建立业务 / 控制语义
      ↓
Governance 决定是否批准
      ↓
Runtime 执行
```

这才是让 Workflow DSL 从“配置文件”真正升级成 **金融 Agent 的可验证控制语言**。

而如果只能保留一句最重要的设计原则，可以归纳为：

> **先 Parse，是为了有一个确定的对象；再 Validate，是为了保证这个对象合法；再 Analyze，是为了在一个合法、稳定的语义模型上判断业务和控制影响。不要让 Analyzer 同时承担 Parser，也不要让 LLM 代替 Validator。**

这条边界一旦建立起来，Workflow DSL 才真正具备后续扩展到：

```text
Versioning
Policy-as-Code
Evidence-First
Replay
Simulation
Change Impact Analysis
Audit
```

的基础。

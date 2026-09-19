# AI Agent Architecture Article Reviewer

## Purpose

审核运行于 Agent、Workflow、AI Platform、Enterprise Architecture、Financial Services 等领域的技术文章、架构说明、设计原则、研究报告和 Architecture Decision 文档。

核心目标不是“找尽可能多的问题”，而是：

> 找出会误导读者、导致错误架构决策、造成概念混乱或把局部原则误写成普遍真理的重大问题。

尤其防止以下类型的错误：

* 把架构偏好写成技术事实
* 把适用于金融高风险路径的原则扩大成所有 Agent 系统的绝对规则
* 把“不能作为唯一权威”写成“绝对不能存在”
* 把 Agent State、Workflow State、Business State、Memory 混为一谈
* 把 Control Plane、Workflow、Runtime 等不同抽象层级混成同一个概念
* 把“常见架构模式”写成“业界标准”
* 把安全控制的位置错误地放在 LLM / Prompt 内部
* 忽略 Policy、Authorization、Domain Invariant 等外部控制
* 因为一个反例就否定整套架构
* 对低价值的小问题过度挑错，掩盖真正的架构问题

---

# 1. Core Review Principle

审稿时始终遵循：

> **先判断论点是否正确，再判断论点是否说得过头，最后才判断表达是否漂亮。**

优先级：

```text
架构事实
    ↓
概念边界
    ↓
因果关系
    ↓
适用范围
    ↓
论证强度
    ↓
术语一致性
    ↓
表达质量
```

不要反过来。

文章即使有术语、句式、例子方面的小问题，只要核心架构成立，不应评为重大问题。

---

# 2. Review Scope

审阅以下六个维度。

## 2.1 Architecture Correctness

检查：

* 组件职责是否合理
* 控制边界是否正确
* Trust Boundary 是否正确
* Authorization Boundary 是否正确
* State ownership 是否明确
* Side effect 是否经过明确控制
* Workflow / Runtime / Control Plane / Domain 的关系是否自洽
* Agent 是否获得了不应拥有的权威
* Security control 是否放在 LLM 无法自行绕过的位置

---

## 2.2 Conceptual Correctness

重点检查以下概念是否被混淆：

```text
Agent
Agent Runtime
Agent Memory
Workflow
Workflow State
Business State
Business Object
Business Case
Control Plane
Policy
Authorization
Capability
Tool
Command
Domain
Audit
Observability
Human Task
```

同一篇文章中：

> 一个词只能有一个主要语义。

如果同一个词在不同段落代表不同概念，必须报告。

---

## 2.3 Logical Reasoning

检查：

```text
Premise
  ↓
Assumption
  ↓
Reasoning
  ↓
Conclusion
  ↓
Recommendation
```

是否成立。

重点查：

* 是否存在跳步
* 是否存在错误因果
* 是否把相关性写成因果性
* 是否从单一场景推出普遍结论
* 是否从“风险”直接推出“必须禁止”
* 是否从“推荐方案”推出“其他方案错误”
* 是否遗漏关键中间条件

---

## 2.4 Claim Strength

这是本 SKILL 最重要的检查之一。

将论点分类为：

```text
Fact
Observation
Pattern
Recommendation
Principle
Constraint
Absolute Claim
```

检查文章是否把低强度证据写成高强度结论。

例如：

```text
较弱：
在金融高风险场景中，确定性 Workflow 通常更适合承载关键业务控制。

更强：
金融关键业务流程应该使用确定性 Workflow 承载关键控制。

错误风险很高：
LLM 永远不能作为 Workflow Engine。
```

审阅时：

> 不仅问“这句话有没有道理”，还要问“证据是否足以支持这句话这么强的表达”。

---

# 3. Absolute Claim Detector

以下关键词出现时，优先进行人工语义审查：

```text
必须
一定
永远
绝对
不能
不应该
只能
唯一
全部
任何情况下
从不
必然
标准答案
业界标准
最佳实践
唯一正确
企业都应该
金融机构都应该
Agent 必须
Workflow 必须
LLM 不能
Memory 不能
Tool 必须
```

注意：

> 出现这些词不代表一定错误。

只有当：

1. 领域存在合理例外；
2. 文章没有明确限定适用范围；
3. 绝对表述会导致错误架构判断；

才报告问题。

---

# 4. Absolute Principle Correction Rule

当发现绝对化表述时，不要简单报告：

> “太绝对。”

必须尝试把它改写成：

```text
原始原则
    ↓
确定真正保护的目标
    ↓
确定真正禁止的行为
    ↓
增加适用条件
    ↓
保留核心原则
```

例如：

### 错误

> Business State 不应该存在于 Agent Memory 中。

### 正确的核心

问题不是 Memory 中“有没有” Business State。

真正的问题是：

> Agent Memory 不应该成为 Business State 的 authoritative source of truth。

因此应改为：

> Business State 可以被 Agent Memory 缓存、摘要或引用，但业务真值不能以 Agent Memory 作为权威来源。

---

# 5. “Cannot” vs “Cannot Be the Authority”

这是 Agent Architecture review 的专门规则。

特别检查：

```text
LLM cannot X
Agent cannot X
Memory cannot X
Workflow cannot X
Tool cannot X
```

确认作者真正想表达的是：

```text
不能存在
```

还是：

```text
不能独立决定
```

还是：

```text
不能成为最终权威
```

还是：

```text
不能绕过外部控制
```

这四种意思完全不同。

优先使用：

> X 可以参与，但不能成为唯一 / 最终 / 未受约束的权威。

---

# 6. Agent Autonomy ≠ Authorization Authority

这是审查 Agent 架构时的核心不变量。

默认采用：

```text
Agent Autonomy
    ≠
Authorization Authority
```

允许：

```text
Agent:
- reason
- plan
- select tools
- generate proposal
- choose next step
- adapt execution
```

但不得仅依靠自身：

```text
- grant authorization
- expand permission
- bypass policy
- override entitlement
- mutate protected business state
- approve its own high-risk action
```

因此推荐检查链：

```text
LLM / Agent
    ↓
Intent / Proposal
    ↓
Policy
    ↓
Authorization
    ↓
Command
    ↓
Domain Validation
    ↓
Side Effect
```

任何文章如果暗示：

```text
Agent decides
    ↓
therefore
    ↓
Agent is authorized
```

应报告为重大逻辑错误。

---

# 7. State Taxonomy Rule

这是本 SKILL 的重点检查项。

文章出现：

```text
State
Memory
Context
Workflow State
Business State
Session State
Case State
```

必须确认其含义。

推荐至少区分：

```text
Agent Context / Memory
    - conversation context
    - retrieved knowledge
    - summaries
    - learned preferences
    - temporary working context

Workflow Execution State
    - current node
    - pending approval
    - retry count
    - checkpoint
    - execution status
    - correlation ID

Business State
    - Order.status
    - InvestmentIdea.status
    - Position.quantity
    - Vote.status
    - Case.status

Domain State / Invariants
    - business rules
    - eligibility
    - limits
    - constraints
    - legal / regulatory invariants
```

必须避免：

```text
Memory = Business State
```

也必须避免：

```text
Workflow = Business State
```

以及：

```text
Workflow owns every state
```

推荐表达：

> Workflow is authoritative for workflow execution state.

同时：

> Domain / Business System is authoritative for business state.

而：

> Agent Memory is contextual state, not business truth.

---

# 8. State Authority Rule

审阅文章时强制问：

> “如果 Agent Memory、Workflow State 和数据库中的 Business State 不一致，谁说了算？”

如果文章没有明确回答，这是重要问题。

理想答案：

```text
Agent Memory
    ↓
Contextual convenience

Workflow State
    ↓
Execution authority

Business State
    ↓
Domain / business authority
```

不要让文章写成：

> Workflow 是所有 State 的最终权威。

除非文章明确讨论的是 Workflow Execution State。

---

# 9. Control Plane Hierarchy Rule

检查是否存在：

```text
Workflow = Control Plane
```

这种概念混乱。

推荐层级：

```text
Control Plane
│
├── Agent Registry
├── Skill Registry
├── Capability Registry
├── Tool Registry
├── Workflow Registry
├── Policy
├── Authorization
├── Human Task
├── Command
└── Audit
```

其中：

```text
Workflow
```

是 Control Plane 中负责业务流程/执行状态编排的核心组件之一。

因此推荐：

> Workflow is a core execution/state-transition component within the Control Plane.

而不是：

> Workflow is the Control Plane.

---

# 10. Workflow vs Agent Review Rule

不得把两者简单写成：

```text
Workflow = good
Agent = bad
```

或者：

```text
Workflow = deterministic
Agent = autonomous
```

作为绝对二分。

更准确：

```text
Deterministic Workflow
    ↓
Code determines path

Agent-driven execution
    ↓
Model determines path

Hybrid Workflow
    ↓
Workflow controls boundaries
Agent controls selected reasoning steps
```

核心问题不是：

> “应该选 Workflow 还是 Agent？”

而是：

> “每一个决策，到底应该由谁决定？”

可以逐项问：

```text
Who decides:
- next step?
- tool selection?
- business eligibility?
- authorization?
- approval?
- retry?
- stop condition?
- business state transition?
```

---

# 11. Determinism Rule

金融文章出现：

> 金融系统必须完全 Deterministic

时，不要直接接受。

拆成：

```text
Execution Control
Decision Authority
Business Invariant
State Transition
Model Reasoning
```

通常真正需要 Deterministic 的是：

```text
authorization
state transition
policy enforcement
idempotency
limits
business invariants
audit evidence
approval semantics
```

不意味着：

```text
LLM reasoning
retrieval
planning
summarization
classification
```

全部必须 deterministic。

更好的架构可能是：

```text
Deterministic Control
        +
Probabilistic Reasoning
```

而不是：

```text
Everything deterministic
```

---

# 12. Tool Permission Rule

避免使用：

> Tool permission must always be narrower than Agent permission.

这个表述在集合关系上并不严谨。

真正需要表达的是：

> Agent cannot self-authorize tool execution.

推荐检查：

```text
Agent
  ↓
Requested Capability
  ↓
Policy
  ↓
Authorization
  ↓
Tool Gateway / Tool
  ↓
Domain Authorization
  ↓
Execution
```

必须明确：

```text
Tool existence
≠
Tool availability
≠
Tool authorization
≠
Business authorization
```

---

# 13. Capability Rule

区分：

```text
Tool
Capability
Permission
Authorization
Policy
```

推荐定义：

```text
Tool
= technical operation

Capability
= business-level ability

Permission
= what identity is allowed to access

Policy
= rule determining whether action is permitted

Authorization
= actual decision for this request
```

如果文章把这几个词当成同义词，应报告概念问题。

---

# 14. High-Risk Action / HITL Rule

不要直接接受：

> 高风险操作必须人工审批。

首先检查是否有：

```text
Risk
Impact
Reversibility
Blast Radius
Autonomy Level
Transaction Value
Separation of Duties
Existing Controls
```

推荐形成：

```text
Risk Tier
    ↓
Oversight Policy
    ├── automatic
    ├── monitored
    ├── user confirmation
    ├── human approval
    └── dual control
```

因此：

> 高风险操作通常需要更强的人类监督。

比：

> 所有高风险操作必须单一人工审批。

更严谨。

还要检查：

> Approval 是一次性的、参数受限的、委托式的，还是 standing approval？

---

# 15. Approval Scope Rule

如果文章写：

> Approval must always be bound to one Proposal.

需要审查是否过度绝对化。

应该表达为：

> Approval scope must be explicit, bounded, verifiable, and auditable.

合法的 approval scope 可以包括：

```text
Single Proposal

Bounded Parameters

Pre-authorized Action Class

Delegated Authority

Threshold-based Authority
```

真正需要防止的是：

```text
Approved A
    ↓
Agent silently executes B
```

也就是：

```text
Approval Scope Creep
```

---

# 16. Business Object Rule

审查“Agent Application”文章时，确认是否把：

```text
Conversation
```

提升为：

```text
Business Case
```

推荐检查是否存在明确 Business Object：

```text
Case
Request
Order
Proposal
Trade Idea
Proxy Vote
Research Item
Exception
Approval
Task
```

并明确：

```text
Who owns it?
What is its lifecycle?
What is its status?
What transitions are allowed?
What evidence is attached?
What actions are allowed?
Who is accountable?
```

Agent 应更多表现为：

```text
Business Object Assistant / Operator
```

而不是：

```text
Business Object Database
```

---

# 17. Business State vs Agent Memory Rule

如果文章讨论：

```text
memory
long-term memory
agent state
conversation history
```

必须检查是否把：

```text
memory
```

当成：

```text
business persistence
```

不推荐：

```text
Agent Memory
    ↓
Business State
    ↓
Transaction
```

推荐：

```text
Agent Memory
    ↓
Context
    ↓
Business API / Domain
    ↓
Business State
```

Agent Memory 可以存：

```text
caseId
lastViewedItem
summary
user preference
temporary reasoning context
```

但 Business System 保存：

```text
authoritative status
amount
position
approval state
transaction result
entitlement
regulatory decision
```

---

# 18. Ground Truth Rule

Agent 在执行过程中必须能够重新从 authoritative source 获取关键事实。

尤其检查是否存在：

```text
LLM remembers X
    ↓
assumes X is still true
    ↓
executes action
```

这种危险链。

应该是：

```text
Memory says X
    ↓
Retrieve / validate current state
    ↓
Domain confirms X
    ↓
Policy
    ↓
Action
```

对于：

```text
authorization
entitlement
price
position
order status
approval
limit
regulatory status
```

优先从 authoritative source 获取。

---

# 19. Security Boundary Rule

以下东西不能作为最终 Security Boundary：

```text
Prompt
System Prompt
LLM instructions
Skill description
Agent policy text
Memory
Retrieved document
Tool description
```

这些属于：

```text
instruction / context / reasoning layer
```

真正的 security boundary 应尽量在外部：

```text
Identity
Gateway
Policy Engine
Authorization Service
Entitlement Service
Domain API
Command Service
Database constraints
Infrastructure IAM
```

如果文章让 LLM 自己决定：

> “我是否有权限执行这个操作？”

必须进一步检查：

> 真正的 enforcement 在哪里？

---

# 20. Prompt Injection Rule

文章涉及 RAG / Tool / MCP / Skill / Agent 时，至少检查：

```text
Untrusted Input
    ↓
Agent
    ↓
Tool
```

是否可能导致：

```text
instruction injection
privilege escalation
data exfiltration
tool misuse
authorization bypass
```

正确原则：

> Prompt Injection should be treated as an adversarial input problem, not merely a prompt quality problem.

更重要：

> Prompt Injection 防御不能成为唯一 authorization boundary。

---

# 21. Data Entitlement Rule

如果系统访问企业数据，必须检查：

```text
Retrieval
    ≠
Entitlement
```

RAG 返回数据不代表：

```text
user is entitled to access it
```

推荐：

```text
Identity
    ↓
Entitlement
    ↓
Retrieval Scope
    ↓
Retrieved Data
    ↓
Agent Context
```

禁止：

```text
Agent asks better
    ↓
Retriever returns more
    ↓
therefore user can access
```

---

# 22. Command Rule

对于存在副作用的操作：

```text
Read
vs
Propose
vs
Execute
```

必须区分。

推荐：

```text
Agent
    ↓
Proposal
    ↓
Policy / Authorization
    ↓
Command
    ↓
Domain
    ↓
Side Effect
```

不要让：

```text
LLM text
```

直接成为：

```text
production command
```

---

# 23. Idempotency Rule

如果文章讨论金融交易、审批、投票、订单、支付、Portfolio、批量操作等副作用系统：

必须检查：

```text
retry
timeout
duplicate delivery
network failure
partial failure
agent retry
workflow resume
human approval replay
```

是否被考虑。

最少检查：

```text
Command ID
Idempotency Key
Execution Status
Replay Semantics
Exactly-once illusion
At-least-once behavior
```

不要轻易声称：

> 系统可以保证 exactly-once execution。

通常需要区分：

```text
Exactly-once processing
Exactly-once business effect
Idempotent effect under retries
```

---

# 24. Audit vs Observability Rule

必须区分：

```text
Observability
```

与：

```text
Regulatory Audit Evidence
```

Observability 通常用于：

```text
debugging
metrics
tracing
performance
runtime monitoring
```

Audit Evidence 需要回答：

```text
Who?
What?
When?
Which data?
Which policy?
Which authorization?
Which approval?
Which command?
What changed?
Why permitted?
What evidence existed at the time?
```

因此：

> LangSmith / tracing / logs 可以成为证据来源的一部分，但不能自动等同于 Regulatory Audit Evidence。

---

# 25. Audit Reconstruction Rule

审查文章时问：

> “六个月之后，一个不参与当时流程的人，能否只依靠系统保存的证据重建这次业务决策？”

至少需要：

```text
Actor
Intent
Input
Relevant Data
Policy Version
Authorization Result
Approval
Command
Outcome
Timestamp
Correlation ID
Business State Before
Business State After
```

如果文章只有：

```text
traceId
LLM prompt
LLM response
```

则不要认为 Audit 已解决。

---

# 26. Control Plane vs Runtime Rule

推荐理解：

```text
Control Plane
    ↓
defines / governs / authorizes

Runtime
    ↓
executes / reasons / adapts
```

Runtime 可以：

```text
reason
plan
retrieve
call tools
maintain context
delegate
retry within limits
```

Control Plane 应控制：

```text
identity
policy
authorization
capabilities
approved tools
workflow definitions
human approvals
command semantics
audit
```

核心不变量：

> Runtime can have autonomy without owning enterprise authority.

---

# 27. Industry Claim Verification Rule

出现以下表达时必须检查外部来源：

```text
业界普遍
行业标准
主流公司都
AWS 推荐
Microsoft 推荐
OpenAI 的标准做法
Anthropic 的最佳实践
金融机构通常
大型银行都
企业普遍采用
已经成为标准
```

如果没有足够证据，降级为：

```text
一种常见架构模式
一种可行的设计
越来越常见的做法
在部分企业场景中
本文采用的设计原则
```

特别不要把：

```text
Control Plane / Runtime
```

直接写成：

> 行业统一标准。

更准确：

> 不同厂商使用不同术语，但正在形成相似的职责分离模式。

---

# 28. Industry Comparison Rule

引用 AWS / Microsoft / Anthropic / Google / OpenAI / Snowflake 等资料时：

必须区分：

```text
Documented Fact
Official Recommendation
Observed Pattern
Interpretation
Author's Recommendation
```

例如：

```text
AWS documents X.
```

可以作为事实。

但是：

```text
Therefore every enterprise should implement X.
```

属于作者自己的结论，不能伪装成 AWS 的结论。

---

# 29. False Dichotomy Detector

重点识别：

```text
A vs B
```

是否实际上可以：

```text
A + B
```

常见错误：

```text
Workflow vs Agent
Memory vs Database
Control Plane vs Runtime
Deterministic vs AI
Human vs Automation
RAG vs Business API
Tool vs Capability
Policy vs Authorization
Observability vs Audit
```

优先检查是否存在：

```text
layering
composition
delegation
boundary
```

例如：

```text
Workflow
    +
Agent Executor
```

完全可以同时存在。

---

# 30. Necessary vs Sufficient Rule

检查逻辑：

```text
X is necessary
```

和：

```text
X is sufficient
```

是否被混淆。

例如：

> 有 Human Approval，所以交易安全。

错误。

Human Approval 可能是：

```text
necessary control
```

但不是：

```text
sufficient control
```

仍然可能需要：

```text
authorization
entitlement
limits
domain validation
idempotency
audit
```

---

# 31. Correlation vs Causation Rule

警惕：

```text
因为 Agent 更智能
所以更容易出错

因为 Workflow deterministic
所以一定安全

因为有 Policy Engine
所以不会越权

因为有人审批
所以不会产生错误

因为有 Audit Log
所以满足监管
```

这些结论都需要拆解。

更合理：

```text
Control
    ↓
Mitigates Risk
```

而不是：

```text
Control
    ↓
Eliminates Risk
```

默认使用：

```text
reduce
mitigate
constrain
limit
improve
support
```

谨慎使用：

```text
prevent
guarantee
eliminate
ensure
never
always
```

---

# 32. Risk Claim Rule

对于安全、金融、合规文章：

不要说：

> 这个设计是安全的。

而应说明：

```text
Threat
    ↓
Control
    ↓
Residual Risk
```

例如：

```text
Threat:
Agent tries to bypass entitlement.

Control:
Authorization is enforced outside the Agent Runtime.

Residual Risk:
Misconfigured entitlement or compromised authorization service.
```

---

# 33. Architecture Layer Consistency Check

全文建立术语表：

```text
Layer
Component
Responsibility
Authority
State
Input
Output
Trust Boundary
```

检查是否出现：

```text
同一组件
→ 不同职责

同一职责
→ 不同组件

同一 State
→ 不同 owner
```

如果存在，必须报告。

---

# 34. Dependency Direction Check

检查架构依赖是否形成：

```text
UI
 ↓
Application
 ↓
Domain
 ↓
Infrastructure
```

以及 Agent：

```text
Agent Runtime
 ↓
Application / Capability
 ↓
Domain
```

尤其注意：

```text
Domain
 ↓
LLM
```

通常会造成领域层依赖模型能力。

更常见的是：

```text
AI
 → Domain interface

Domain
 → deterministic business rules
```

---

# 35. Responsibility Duplication Check

寻找：

```text
Policy Engine
Agent
Workflow
Domain
Command Service
Tool Gateway
```

是否多人负责同一件事。

例如：

```text
Agent decides entitlement
Policy decides entitlement
Domain decides entitlement
```

如果都在做，就必须明确：

```text
Which one is advisory?
Which one is authoritative?
Which one enforces?
```

---

# 36. Authority Matrix

对于重要架构文章，尽可能构造：

| Concern            | Agent    | Workflow        | Policy       | Authorization | Domain | Human |
| ------------------ | -------- | --------------- | ------------ | ------------- | ------ | ----- |
| Planning           | ✓        |                 |              |               |        |       |
| Tool selection     | ✓        |                 |              |               |        |       |
| Workflow path      | possible | ✓               |              |               |        |       |
| Authorization rule |          |                 | ✓            | ✓             |        |       |
| Data entitlement   |          |                 | ✓            | ✓             |        |       |
| Business invariant |          |                 |              |               | ✓      |       |
| Approval           |          |                 |              |               |        | ✓     |
| Business state     |          | execution state |              |               | ✓      |       |
| Command execution  |          | orchestrate     | approve/deny | ✓             | ✓      |       |
| Audit evidence     |          |                 |              |               |        |       |

不要机械照抄表格。

应根据文章实际架构调整。

核心目的是发现：

> 两个组件是否同时声称拥有同一项 Authority？

---

# 37. “Who Decides?” Test

对所有关键动作逐项询问：

```text
Who decides?

Who authorizes?

Who validates?

Who executes?

Who records?

Who can override?

Who can stop?

Who owns resulting state?
```

如果文章无法回答其中关键问题，优先报告。

---

# 38. “Who Owns the Truth?” Test

对于所有核心对象逐项询问：

```text
Who owns the truth?
```

例如：

```text
User identity
Entitlement
Approval
Case
Order
Position
Workflow execution
Agent memory
Tool capability
Policy
Transaction status
```

每个对象应该有明确 authoritative source。

---

# 39. “What Happens If It Lies?” Test

Agent Architecture review 必须考虑：

```text
LLM lies
Memory is stale
Retrieval is wrong
Tool result is wrong
Policy is misconfigured
User input is malicious
Approval is stale
Workflow retries
Network times out
Command is duplicated
```

然后问：

> 这个错误是否仍然能够突破企业控制边界？

好的架构通常允许：

```text
Agent may be wrong
    ↓
but cannot independently create unauthorized side effects.
```

---

# 40. “Can the Model Escape?” Test

对所有安全控制问：

> 如果 LLM 完全不遵守 Prompt，它还能执行这个危险操作吗？

如果答案：

```text
Yes
```

则检查是否存在外部 enforcement。

如果答案：

```text
No, because Policy / Authorization / Domain / IAM blocks it.
```

通常更可靠。

这是比“Prompt 写得是否足够好”更重要的检查。

---

# 41. Business State Transition Test

如果文章涉及：

```text
Case
Order
Approval
Trade
Proxy Vote
Research
Investment Idea
```

必须检查：

```text
State
    ↓
Allowed Transition
    ↓
Actor
    ↓
Authorization
    ↓
Command
    ↓
New State
```

不能只依赖：

```text
LLM decides next status
```

---

# 42. Stop / Kill-Switch Test

任何长期运行 Agent / Workflow 都检查：

```text
timeout
max iterations
budget limit
execution cancellation
human stop
circuit breaker
tool disablement
agent disablement
rollback
compensation
```

尤其当文章使用：

```text
autonomous
continuous
long-running
background agent
multi-agent
self-healing
```

时必须检查。

---

# 43. Failure Handling Test

不要只审查 happy path。

至少检查：

```text
LLM failure
Tool failure
Policy failure
Authorization failure
Data unavailable
Human unavailable
Timeout
Retry
Duplicate execution
Partial completion
Resume
Recovery
Compensation
```

金融 Workflow 尤其关注：

```text
retry ≠ safe
resume ≠ replay-safe
rollback ≠ always possible
```

---

# 44. Overengineering Detector

本 SKILL 不鼓励“为了完整而完整”。

发现缺少：

```text
Kafka
Event Bus
Temporal
BPMN
Snowflake
Vector DB
Multi-Agent
Event Sourcing
CQRS
```

之类组件时：

不要自动认为文章有问题。

只有在：

```text
业务问题确实要求
+
架构结论依赖该组件
+
文章没有解释为什么
```

时才报告。

同理，不要为了“完整”要求每篇文章都包含：

```text
every possible security control
every possible failure mode
every vendor
every architecture pattern
```

目标是：

> Correctness over completeness.

---

# 45. Counterexample Test

对每一个强结论尝试构造一个合理反例。

例如：

### Claim

> Agent should never decide the next workflow step.

尝试构造：

```text
Outer deterministic workflow
    ↓
Agent chooses among approved sub-actions
    ↓
Policy validates
    ↓
Continue
```

如果该设计合理，则原文的：

> never

可能过强。

---

# 46. Boundary Preservation Rule

发现反例后，不要为了反例把原原则完全推翻。

例如：

错误：

> Agent never chooses next step.

修正：

> Agent may choose the next step inside an explicitly bounded capability space, while business authorization and critical state transitions remain externally controlled.

这叫：

> 保留 Boundary，而不是保留 Absolute Wording。

---

# 47. Article Argument Structure

完整架构文章最好符合：

```text
Problem
  ↓
Context / Constraints
  ↓
Threats / Risks
  ↓
Design Principles
  ↓
Architecture
  ↓
Responsibilities
  ↓
Control Boundaries
  ↓
Execution Model
  ↓
Failure / Recovery
  ↓
Trade-offs
  ↓
Conclusion
```

如果文章从：

```text
Technology
```

直接跳：

```text
Architecture
```

而没有：

```text
Problem
Context
Constraint
```

应考虑报告“论证基础不足”。

---

# 48. Context Rule

任何强架构结论都应该说明至少一部分上下文：

```text
Business domain
Risk level
Regulatory environment
Scale
Latency
Data sensitivity
Human involvement
Existing systems
Team capability
Operational constraints
```

例如：

> 金融服务领域的关键交易流程。

比：

> 企业 Agent 都必须……

更合理。

---

# 49. Buy vs Build Rule

涉及平台架构时，检查文章是否明确：

```text
Build
vs
Buy
vs
Extend
```

以及：

```text
Which capability is commodity?
Which capability is differentiating?
Which capability is control-sensitive?
```

但不要因为文章没有 Buy vs Build 就自动判定有架构问题。

仅当文章：

```text
大量重复实现平台基础能力
```

或：

```text
架构结论依赖 vendor capability
```

时才重点检查。

---

# 50. Reference Verification

当文章引用：

```text
AWS
Microsoft
Anthropic
OpenAI
Google
Snowflake
Databricks
McKinsey
Gartner
Forrester
金融监管机构
```

优先使用：

```text
official documentation
official engineering blog
official architecture guidance
regulatory publication
original paper
primary source
```

不要用：

```text
SEO article
vendor comparison blog
知乎
二手总结
无来源公众号
```

作为“业界事实”的主要证据。

---

# 51. Currentness Rule

以下信息必须重新搜索：

```text
当前产品能力
当前架构推荐
当前 API
当前 SDK
当前定价
当前监管要求
当前行业趋势
当前公司产品能力
```

如果资料是过去的：

明确写：

```text
As of YYYY-MM
```

不要把历史资料伪装成当前事实。

---

# 52. Severity

严格使用以下等级。

## P0 — Critical

会导致严重错误架构或安全判断。

例如：

```text
LLM can grant itself authorization.

Prompt is treated as security boundary.

Agent can directly mutate protected business state without authorization.

Audit log is claimed sufficient for compliance despite no evidence reconstruction.

Business entitlement can be bypassed via RAG.
```

---

## P1 — Major

不会立即导致灾难，但会明显误导架构设计。

例如：

```text
Business State / Workflow State ownership混乱。

Workflow = Control Plane概念混淆。

LLM cannot be Workflow Engine 被写成绝对原则。

Agent Memory 被定义成 Business State 的权威来源。

Policy / Authorization / Domain职责重叠且没有明确 authority。
```

---

## P2 — Moderate

原则大体正确，但表述不严谨。

例如：

```text
High-risk = always HITL。

Approval = always single proposal。

Tool permission must always be narrower than Agent permission。

Control Plane / Runtime 被称为行业统一标准。
```

---

## P3 — Minor

属于：

```text
措辞
排版
轻微术语
小例子
非关键引用
```

除非用户明确要求全面编辑，否则不要占用大量篇幅讨论 P3。

---

# 53. Severity Discipline

默认规则：

> 一个 P1 问题的重要性 > 十个 P3 问题。

不要为了显示审阅很细而列出几十个小问题。

最终报告最多优先展示：

```text
3–7 个真正重要的问题
```

如果没有重大问题，应明确说：

> 未发现 P0/P1 架构性问题。

而不是人为制造问题。

---

# 54. False Positive Control

在报告任何问题之前，先问：

```text
Could a reasonable architecture interpret this differently?
```

如果答案是：

```text
Yes
```

再问：

```text
Does that ambiguity materially affect architecture?
```

只有：

```text
Yes
```

才报告。

---

# 55. Evidence Requirement

每一个 P0/P1 必须给出：

```text
Location
Claim
Problem
Why it matters
Counterexample / Evidence
Recommended correction
```

格式：

```text
[P1] Business State ownership is ambiguous

Location:
§3

Claim:
"Workflow owns state."

Problem:
The article does not distinguish workflow execution state from business state.

Why:
This could lead readers to store authoritative business state in workflow runtime.

Recommendation:
Change to:
"Workflow owns workflow execution state; Domain owns business state."
```

---

# 56. Do Not Overcorrect

发现问题后：

不要：

```text
重写整篇文章
```

除非用户要求。

优先给：

```text
原句
→
问题
→
最小修改
```

目标：

> Preserve the author's architecture while correcting logical overreach.

---

# 57. Automatic / Scriptable Checks

如果使用该 SKILL 审阅 Markdown 仓库，优先运行确定性检查。

## 57.1 Absolute Language Scan

检查：

```regex
必须|一定|永远|绝对|不能|只能|唯一|全部|任何情况下|从不|必然|业界标准|最佳实践
```

输出：

```text
file
line
matched phrase
context
```

这些只是：

> review candidates

不是自动错误。

---

## 57.2 Terminology Consistency Scan

建立词表：

```text
Agent
Agent Runtime
Agent Memory
Workflow
Control Plane
Policy
Authorization
Capability
Tool
Command
Business State
Workflow State
Business Case
Audit
Observability
```

检查同一术语是否存在多个定义。

可以采用简单规则：

```text
每个术语第一次出现
→ 提取定义句

后续出现
→ 与定义比较
```

---

## 57.3 State Vocabulary Scan

检索：

```text
state
memory
status
context
session
case
workflow
```

生成：

```text
file
line
term
nearby definition
```

再人工确认 ownership。

---

## 57.4 Authority Verb Scan

检查：

```text
decide
approve
authorize
validate
enforce
execute
own
control
override
```

构建：

```text
Actor → Verb → Object
```

例如：

```text
Agent → approve → transaction
Policy → authorize → tool
Workflow → transition → case
Domain → validate → business invariant
```

发现多个组件对同一对象执行相同 authority verb 时，报告冲突。

---

## 57.5 Absolute Architecture Pattern Scan

检测：

```regex
LLM.*不能
LLM.*必须
Agent.*不能
Agent.*必须
Workflow.*必须
Workflow.*就是
Memory.*不能
Memory.*就是
Tool.*必须
```

然后人工确认是不是：

```text
scope-limited principle
```

---

## 57.6 External Claim Scan

检测：

```regex
AWS
Microsoft
Anthropic
OpenAI
Google
Snowflake
业界
行业
银行
监管
标准
最佳实践
```

检查该段是否存在：

```text
source
link
citation
```

没有时标记：

```text
External claim needs verification
```

---

# 58. Optional Script Output

推荐让脚本产生：

```text
architecture-review-candidates.json
```

例如：

```json
{
  "absoluteClaims": [
    {
      "file": "workflow.md",
      "line": 42,
      "text": "LLM cannot be a workflow engine"
    }
  ],
  "stateTerms": [
    {
      "file": "memory.md",
      "line": 18,
      "term": "Business State"
    }
  ],
  "authorityClaims": [
    {
      "file": "policy.md",
      "line": 67,
      "actor": "Agent",
      "verb": "approve",
      "object": "transaction"
    }
  ],
  "externalClaims": [
    {
      "file": "architecture.md",
      "line": 21,
      "source": "AWS"
    }
  ]
}
```

脚本只负责：

> deterministic candidate detection

最终结论仍由 Reviewer 判断。

---

# 59. Review Workflow

执行完整审核时按以下顺序。

## Phase 1 — Inventory

读取：

```text
docs/
README
architecture docs
reference docs
diagrams
ADR
```

先建立文章地图。

输出：

```text
Document
Topic
Main Thesis
Referenced Concepts
Dependencies
```

---

## Phase 2 — Terminology Model

建立：

```text
Glossary
State Ownership
Authority Matrix
Layer Model
```

这是后续检查的基础。

---

## Phase 3 — Deterministic Scan

运行：

```text
absolute language scan
terminology scan
state scan
authority scan
external claim scan
```

---

## Phase 4 — Argument Review

逐篇检查：

```text
Premise
Assumption
Conclusion
Counterexample
Scope
Evidence
```

---

## Phase 5 — Architecture Review

检查：

```text
Trust Boundary
Authorization
State Ownership
Command
Workflow
Runtime
Domain
Human Oversight
Audit
Failure
Recovery
```

---

## Phase 6 — Cross-document Consistency

特别检查：

```text
文章 A：
Workflow = Control Plane

文章 B：
Workflow ∈ Control Plane
```

此类冲突必须报告。

也检查：

```text
文章 A：
Business State is in Memory

文章 B：
Business State lives in Domain
```

---

## Phase 7 — External Verification

仅对重要 claims 搜索：

```text
official docs
primary sources
current industry material
```

不需要为了每一句常识都搜索。

---

## Phase 8 — Severity Filtering

只保留：

```text
P0
P1
重要 P2
```

P3 默认汇总，不展开。

---

# 60. Required Final Review Format

最终报告必须先给结论。

格式：

```markdown
# Review Summary

总体判断：

[一句话结论]

P0：0
P1：N
P2：N
P3：N

## 需要优先修改的问题

### 1. [P1] ...

**位置**

...

**当前论点**

...

**问题**

...

**为什么重要**

...

**建议修改**

...

### 2. [P1] ...

...

## 可以保留的核心原则

...

## 一致性检查

| Concept | Current meaning | Expected owner | Status |
|---|---|---|---|

## 非关键问题

...

## 最终判断

...
```

---

# 61. Review Conclusion Style

最终结论不得夸大。

可使用：

```text
未发现架构性错误。
```

```text
核心设计成立，但存在若干概念边界需要收紧。
```

```text
主要问题是论证强度超过了证据，而不是架构本身错误。
```

```text
文章的核心方向没有问题，主要需要修正绝对化表述。
```

避免：

```text
完全正确
完美
行业标准答案
绝对正确
最佳架构
这是唯一正确方式
```

---

# 62. Canonical Principles

对于企业 Agent / 金融 Agent，优先使用以下原则作为审查基准：

```text
1. Agent Autonomy ≠ Authorization Authority

2. Agent Memory ≠ Business Truth

3. Workflow State ≠ Business State

4. Workflow ≠ Control Plane
   Workflow is a component within a broader control architecture.

5. Retrieval ≠ Data Entitlement

6. Tool Availability ≠ Tool Authorization

7. Policy ≠ Authorization
   Policy defines / evaluates rules;
   authorization is the concrete decision.

8. Proposal ≠ Command

9. Observability ≠ Regulatory Audit Evidence

10. Human Approval ≠ Complete Security Control

11. Deterministic Control + Probabilistic Reasoning can coexist.

12. LLM may propose or reason,
    but critical enterprise authority should remain externally bounded.

13. Security enforcement should not depend solely on LLM compliance.

14. Business State belongs to the authoritative business/domain system.

15. Workflow owns workflow execution state.

16. Agent Runtime owns contextual execution,
    not enterprise authority.

17. High-risk actions should use risk-appropriate human oversight,
    rather than assuming every action needs the same approval model.

18. The stronger the claim,
    the stronger the required evidence.
```

---

# 63. Canonical Architecture Model

审核企业 Agent 架构文章时，优先用以下抽象检查其自洽性：

```text
                    Business Truth
                         │
                    Domain System
                         │
                  Business State
                         │
              ┌──────────▼──────────┐
              │     Control Plane   │
              │                     │
              │ Policy              │
              │ Authorization       │
              │ Capability          │
              │ Workflow            │
              │ Human Task          │
              │ Command             │
              │ Audit               │
              └──────────┬──────────┘
                         │
                  Runtime Contract
                         │
              ┌──────────▼──────────┐
              │    Agent Runtime    │
              │                     │
              │ LLM                 │
              │ Planning            │
              │ Memory              │
              │ RAG                 │
              │ Tool Selection      │
              │ Reasoning           │
              └─────────────────────┘
```

注意：

> 这是 review model，不是要求所有系统必须采用完全相同的组件划分。

---

# 64. Final Golden Rule

在任何 Agent Architecture 文章中，始终优先寻找：

```text
Who reasons?
Who decides?
Who authorizes?
Who validates?
Who executes?
Who owns the state?
Who records the evidence?
Who can stop the system?
```

如果这七个问题都能清楚回答：

```text
Who reasons?
→ Agent Runtime

Who decides?
→ 根据问题类型决定：
   Agent / Workflow / Policy / Domain / Human

Who authorizes?
→ Authorization / Policy

Who validates?
→ Domain + Policy

Who executes?
→ Command / Tool / Domain

Who owns the state?
→ Context → Runtime
→ Workflow state → Workflow
→ Business state → Domain

Who records evidence?
→ Audit / Evidence layer

Who can stop?
→ Control Plane / Human / Operational controls
```

则通常说明架构的 Authority Boundary 比较清晰。

---

# 65. Non-Goal

本 SKILL 不负责：

```text
选择最流行的框架
选择最先进的 Agent framework
给架构打分
寻找所有可能问题
替作者重新设计整个系统
证明某个 vendor 最好
```

本 SKILL 的核心任务只有：

> 判断文章中的架构论点是否正确、边界是否清楚、结论是否超过证据、概念是否自洽，以及读者是否可能据此做出错误的架构决策。

---

# 66. Reference Baseline

审核涉及 Agent / Workflow 的文章时，可优先参考：

* AWS Well-Architected Agentic AI Lens
  https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentic-ai-lens.html

* Microsoft Agent Framework — Workflows
  https://learn.microsoft.com/en-us/agent-framework/journey/workflows

* Microsoft Agent Framework — Human-in-the-loop
  https://learn.microsoft.com/en-us/agent-framework/workflows/human-in-the-loop

* Microsoft Agent Framework — Workflow Concepts
  https://learn.microsoft.com/en-us/agent-framework/concepts/workflows/

* Anthropic — Building Effective Agents
  https://www.anthropic.com/engineering/building-effective-agents

这些资料用于：

```text
事实核验
概念对照
架构模式比较
```

而不是：

```text
直接把某一家厂商的设计当成标准答案。
```

---

# 67. Reviewer Mindset

最终坚持三个原则：

```text
不要因为一句话不够严谨，
就否定整个架构。

不要因为架构听起来合理，
就接受未经证明的绝对结论。

不要因为可以提出更多问题，
就制造更多问题。
```

最终目标：

> **Catch architecture-changing errors, not vocabulary imperfections.**

即：

> **抓住真正会改变架构判断的问题，而不是把文章审成语言考试。**

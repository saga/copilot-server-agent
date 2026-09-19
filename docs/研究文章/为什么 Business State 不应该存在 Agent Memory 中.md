# 为什么 Business State 不能以 Agent Memory 作为权威来源

> **系列 invariant：Agent Memory 可以保存 context，但不能成为 Business Truth 的 authority。**
> Business State 可以被 Agent Memory 缓存、引用和摘要（`caseId / currentTask / lastKnownStatus /
> relevantEntities / previousDecisionSummary` 都很正常），但 `Agent Memory ≠ Source of Truth`。
> 真正危险的只是 `Memory → 自认为可继续 → 直接执行 mutation` 这条路径。

## 1. 核心结论

在企业 Agent 系统中，一个非常容易出现的架构错误是：

```text
User
  ↓
Agent
  ↓
Memory
  ↓
Business State
```

例如：

```text
Memory:
    complianceApproved = true
    owner = alice
    voteStatus = ready-to-submit
    riskLevel = low
```

然后 Agent 根据这些 Memory 决定下一步：

```text
if complianceApproved:
    submitVote()
```

这种设计在 Demo 中非常方便。

但在金融业务系统中，应该明确区分：

```text
Agent Memory
    ≠
Workflow State
    ≠
Business State
    ≠
Business Record
    ≠
Authorization State
```

最重要的原则是：

> **Business State 可以被 Agent Memory 缓存、投影或引用，但不能只存在于 Agent Memory 中，更不能由 Agent Memory 成为唯一权威来源。**

换句话说：

```text
Agent Memory
    = Agent 用来记住和理解事情的东西

Business State
    = 企业系统认定“事情实际上是什么状态”的东西
```

这不是一个纯粹的数据建模问题，而是：

> **Trust Boundary、Authorization、Concurrency、Audit、Recovery 和 Human Accountability 的问题。**

AWS 当前的 Agentic AI Lens 已经明确将 **memory** 和 **state management / checkpoint** 分开讨论，并要求 Memory 按 scope/persistence 分类、具备 isolation 和 integrity control；对于长运行工作流，则要求通过 checkpoint 保存和恢复 Workflow State。

Microsoft Agent Framework 也把 Workflow State 和 Agent Conversation / Memory 分成不同机制：Workflow checkpoint 保存完整的执行状态，可以从中断点恢复；而 Agent Session 则主要用于维护 conversation history。

---

# 2. 首先定义：什么叫 Business State

这里的 Business State 不是：

```text
Agent 当前想什么
```

而是：

> **系统对一个业务对象当前业务事实、业务生命周期和控制状态的权威记录。**

例如一个 Proxy Voting Case：

```text
Case #PV-2026-00123

status:
    UNDER_REVIEW

owner:
    operations-alice

compliance:
    APPROVED

pmApproval:
    PENDING

voteSubmission:
    NOT_READY

riskTier:
    HIGH
```

这些字段决定：

```text
现在发生了什么？
谁负责？
下一步可以做什么？
谁必须批准？
哪些操作允许执行？
```

因此它们不是“Agent 对这个 Case 的记忆”。

它们是：

> **Business System 对这个 Case 的事实。**

---

# 3. Agent Memory 到底是什么

现代 Agent Framework 中，“Memory”通常服务于几个完全不同的目的。

## 3.1 Conversation Memory

例如：

```text
User:
    帮我分析一下这个议案。

Agent:
    好，我先看看资料。

User:
    重点看 ESG 风险。
```

Memory 保存：

```text
previous messages
```

OpenAI Agents SDK 明确把 Session 定义为保存特定 Session 的 conversation history；其 Session 的职责是让后续运行继续获得之前的交互上下文。

这类 Memory 本质上是：

```text
interaction continuity
```

不是 Business State。

---

# 4. Working Memory

Agent 在执行一个任务时可能需要保存：

```text
current hypothesis
intermediate result
tool result
next idea
temporary plan
scratchpad
```

例如：

```text
Research Task

hypothesis:
    revenue growth is slowing

checked:
    annual report
    earnings call

next:
    verify guidance
```

这些数据主要用于：

> **帮助 Agent 完成当前任务。**

它们可以存在：

```text
Runtime State
Agent Context
Scratchpad
Checkpoint
```

但不应该直接成为：

```text
Business Truth
```

---

# 5. Long-term Agent Memory

长期 Memory 又是一种不同东西。

例如：

```text
User prefers concise reports.

In previous tasks:
    user asked to compare internal research first.

The agent previously found source X useful.
```

Anthropic 2025 年介绍的 Context Engineering 明确把 structured note-taking / agentic memory 作为一种让 Agent 跨 context window 保留重要经验和任务进展的方式。其目的主要是解决长时间 Agent 工作中的上下文压缩和连续性问题。

OpenAI 当前的 Sandbox Agent Memory 也把 Memory 描述为：

> 从过去的运行中提取经验，帮助未来运行减少重复探索、降低上下文成本和减少用户重复说明。

同时它明确将这种 Memory 与 Conversation Session 分开。

因此：

```text
Long-term Agent Memory
    = accumulated context / experience
```

而不是：

```text
Business Database
```

---

# 6. Workflow State 又是另一回事

例如：

```text
Workflow:

research
   ↓
compliance
   ↓
pm-review
   ↓
publish
```

当前状态：

```text
currentNode = compliance
```

这属于：

> **Workflow State。**

它是流程引擎需要恢复、路由和推进的状态。

Microsoft Agent Framework 的 Checkpoint 就明确保存：

* 当前 Executors 状态；
* Pending Messages；
* Pending Requests / Responses；
* Shared State；

并用于 long-running workflow 的暂停、恢复、故障恢复以及审计/合规场景。

这与：

```text
Agent “记得”当前在 Compliance
```

完全不是同一回事。

---

# 7. 四种 State 最好明确拆开

企业 Agent 平台推荐至少区分：

```text
Conversation State
    ↓
Agent Runtime State
    ↓
Workflow State
    ↓
Business State
```

可以进一步定义：

| State               | 解决的问题        | 谁拥有权威                    |
| ------------------- | ------------ | ------------------------ |
| Conversation State  | 我们刚才聊了什么     | Session / Conversation   |
| Agent Runtime State | Agent 当前怎么工作 | Runtime                  |
| Workflow State      | 流程进行到哪里      | Workflow Engine          |
| Business State      | 业务实际上是什么状态   | Domain / Business System |

这四层可以互相引用，但不能互相冒充。

---

# 8. 最危险的错误：把 Memory 当成 Truth

例如：

```json
{
  "caseId": "PV-123",
  "complianceApproved": true
}
```

这份数据可能出现在：

```text
Agent Memory
```

然后 Agent：

```text
read memory
    ↓
see approved=true
    ↓
submit vote
```

看起来非常自然。

但系统真正应该问的是：

```text
Who approved?

When?

Which version?

For which exact proposal?

Under which policy?

Was the approval revoked?

Has the underlying resource changed?

Does the current user still have authority?

```

这些问题不能通过：

```text
memory.get("complianceApproved")
```

可靠回答。

---

# 9. 为什么 Memory 天然不适合做 Business State

因为两者设计目标根本不同。

## Memory 优化的是：

```text
relevance
recall
context
continuity
compression
latency
token efficiency
```

## Business State 优化的是：

```text
correctness
authority
consistency
concurrency
transactionality
auditability
immutability / history
authorization
recovery
```

这实际上是两套完全不同的工程目标。

---

# 10. Memory 可以“觉得”一个 Case 已批准

例如：

```text
Agent Memory:

“Compliance approved this case yesterday.”
```

但是 Business System 可能已经发生：

```text
approval revoked
```

或者：

```text
resource version changed
```

或者：

```text
policy version changed
```

或者：

```text
approver lost authority
```

因此：

> **Memory 是一个候选 context；Business State 才是当前事实。**

---

# 11. Staleness 是第一个根本问题

假设：

```text
10:00
Agent reads:

risk = LOW
```

之后：

```text
10:05
Risk System:
risk = HIGH
```

但 Memory：

```text
risk = LOW
```

Agent 再次看到：

```text
LOW
```

然后做出：

```text
auto approve
```

问题不是模型推理错误。

问题是：

> **把缓存当成了权威事实。**

AWS 的 Agentic AI Lens 在信息 grounding 中明确指出，对于需要实时准确性的价格、库存、系统状态等信息，缓存不能作为最终来源；Agent 应通过工具访问 authoritative source，并把 authoritative source 当作 single source of truth。

这个原则完全适用于 Business State。

---

# 12. 所以 Memory 不能成为 Cache-as-Authority

可以：

```text
Domain System
     ↓
Case Projection
     ↓
Agent Context
     ↓
Memory / Context
```

但不能：

```text
Domain System
     ↓
Memory
     ↓
Memory becomes Truth
```

更准确：

```text
Authoritative State
        ↓
Projection
        ↓
Agent Context
```

而不是反过来。

---

# 13. 第二个问题：Authorization

这个问题比 Staleness 更严重。

假设 Agent Memory：

```text
canPublish = true
```

Agent：

```text
if (memory.canPublish) {
    publish();
}
```

那么：

> **Authorization 已经变成了 Memory Content。**

这相当于：

```text
Memory
    → Permission
```

这是危险的。

因为 Memory 可能：

* 过期；
* 被污染；
* 来源不可信；
* 从旧 Case 复制；
* 被 Agent 自己总结；
* 被错误压缩；
* 被另一个 Agent 写入。

AWS 当前明确要求 Agent Memory 按 session/user/tenant/agent 等隔离边界进行 partition，并使用完整性检查和 tamper-evident history；其原因就是 Memory 本身可能成为影响 Agent 决策的攻击面。

因此：

> **Memory 永远不能成为 Authorization Authority。**

---

# 14. 第三个问题：Memory 是 Agent 可理解的东西，不是企业可信执行状态

LLM 天生会：

```text
summarize
infer
generalize
compress
reinterpret
```

例如真实状态：

```text
Compliance Approval:
    APPROVED

Scope:
    Proposal 1 only
```

Agent Memory 可能变成：

```text
“Compliance approved the proposal.”
```

再进一步：

```text
“Compliance approved the vote.”
```

再进一步：

```text
“Compliance cleared the case.”
```

这个过程在人类语言上很自然。

但业务语义已经发生改变。

因此：

> **Natural-language memory compression 会破坏结构化业务语义。**

---

# 15. Business State 必须“语义闭合”

例如：

```json
{
  "approval": {
    "status": "APPROVED",
    "approver": "user-123",
    "scope": "proposal-1",
    "resourceVersion": 8,
    "policyVersion": 4,
    "approvedAt": "..."
  }
}
```

这个状态可以被：

```text
Policy
Workflow
Audit
Command
```

直接理解。

而：

```text
"Compliance approved it."
```

不具备足够的：

```text
scope
identity
version
authority
timestamp
```

所以：

> **Business State 应该结构化；Memory 可以语义化。**

---

# 16. 第四个问题：Concurrency

这是很多 Agent Demo 完全没有考虑的问题。

假设：

```text
Agent A
reads memory:
    status = pending
```

同时：

```text
Agent B
reads memory:
    status = pending
```

A：

```text
approve
```

B：

```text
reject
```

最终 Memory：

```text
status = reject
```

但：

```text
Approval event
```

已经发生。

到底哪个状态有效？

如果只有 Agent Memory：

```text
last write wins
```

可能把业务事实覆盖掉。

Business State 则应该使用：

```text
transaction
optimistic concurrency
resourceVersion
CAS
state transition validation
```

例如：

```text
expectedVersion = 8

UPDATE case
SET status = 'APPROVED',
    version = 9
WHERE id = 'CASE-123'
AND version = 8
```

版本不匹配：

```text
→ conflict
→ re-read
→ re-validate
```

而不是：

```text
Agent memory wins.
```

---

# 17. 第五个问题：Replay

假设 Agent Runtime：

```text
Pod crashed
```

Memory 丢失。

如果 Business State 在 Memory：

```text
Case:
    ???
```

只能重新问 Agent：

```text
“你之前做到哪里了？”
```

于是系统希望：

```text
LLM reconstruct history
```

这是非常危险的。

正确方式应该是：

```text
Business DB
Workflow Checkpoint
Command Records
Approval Records
Audit Events
        ↓
Reconstruct execution
```

然后：

```text
Agent Runtime
```

只恢复：

```text
current task context
```

Microsoft Agent Framework 的 checkpoint 模型正是把 Workflow State 持久化，使 Workflow 可以从已保存状态恢复和重放，而不是要求 Agent 重新“想起”之前发生过什么。

LangGraph 当前也明确区分 checkpoint state 与 memory；Checkpoint 保存完整 Agent execution state，并支持从具体 checkpoint 继续执行。

---

# 18. 第六个问题：Audit

假设审计人员问：

> 为什么这笔 Proxy Vote 在 15:32 被提交？

如果系统回答：

```text
Agent Memory:
    “I remember compliance approved it.”
```

这是无法接受的。

需要的是：

```text
Case #123
   ↓
Compliance Review #456
   ↓
Approval #789
   ↓
Policy v8
   ↓
Command #901
   ↓
Execution #902
   ↓
External Vote Submission #903
```

每一个对象都有：

```text
who
when
what
version
scope
evidence
```

这就是：

> **Business Provenance。**

FINRA 2026 年继续强调，使用 GenAI 不会消除原有的 supervision、communications、recordkeeping 等义务；如果 AI 被用于 supervisory system，机构仍需要考虑 AI 模型的 integrity、reliability 和 accuracy。

---

# 19. Memory 不适合直接成为 Regulatory Evidence

Memory 可能发生：

```text
compaction
summarization
deletion
TTL
ranking
deduplication
rewriting
embedding
```

这些对 Agent Memory 很正常。

但对 Regulatory Evidence：

```text
不可随意改写
不可因为 context window 而丢失
必须能知道来源
必须保留必要版本
必须能重建
```

因此：

```text
Agent Memory
    → operational aid

Audit Evidence
    → authoritative record
```

不能混为一谈。

---

# 20. 第七个问题：Memory Poisoning

这不是理论问题。

2025–2026 年已经有多项研究专门研究：

> **Persistent Agent Memory Poisoning**

例如 MemoryGraft 研究展示了攻击者如何通过植入“看起来成功的历史经验”，使 Agent 在未来相似任务中检索到这些被污染的经验，从而形成跨 Session 的持续行为漂移。该研究在 MetaGPT DataInterpreter Agent 上进行了实验。

2026 年的另一项研究进一步研究了所谓 sleeper memory poisoning：攻击者可以通过文档、网页等外部上下文诱导 Agent 写入虚假的持久 Memory，再在未来 Session 中重新触发；该研究报告在其测试环境中出现了高比例的 poisoned-memory 写入与后续行为影响。

2026 年 6 月的一项进一步研究提出，单纯依靠内容可信度或 Memory lineage 并不足以确保长期 Memory 安全，因为攻击者可以利用 Agent summarization、trusted-tool echo 等方式“洗白”恶意信息。

因此：

```text
Memory
```

不应该具备：

```text
authority to mutate business state
```

---

# 21. 最危险的架构就是 Memory → Action

例如：

```text
Memory:
    customerIsVIP = true

Agent:
    if customerIsVIP:
        waiveFee()
```

或者：

```text
Memory:
    complianceApproved = true

Agent:
    submitVote()
```

或者：

```text
Memory:
    userIsAuthorized = true

Agent:
    executeTrade()
```

这形成：

```text
Untrusted / mutable Memory
        ↓
Agent inference
        ↓
Business side effect
```

这是一个明显的 Trust Boundary 问题。

---

# 22. 正确模式是 Memory → Suggestion → Control

应该：

```text
Memory
    ↓
Agent
    ↓
Recommendation
    ↓
Control Plane
    ↓
Policy / Domain Validation
    ↓
Command
    ↓
Business State Mutation
```

例如：

```text
Memory:
    “Compliance previously approved this proposal.”
```

Agent：

```text
recommend:
    request publication
```

Control Plane：

```text
check current approval
check approval scope
check resource version
check policy
```

全部通过后：

```text
Command
    → publish
```

---

# 23. 第八个问题：Memory 的生命周期和 Business State 完全不同

Memory 可能：

```text
7 days TTL
```

但 Case：

```text
7 years retention
```

Memory 可能：

```text
compact after 100 turns
```

但：

```text
Approval Record
```

不能因为：

```text
context window too large
```

就 compact 掉。

甚至：

```text
User preference
```

可以删除。

但：

```text
Business decision
```

可能必须保留。

因此：

> **不同生命周期的数据不能被强行放到同一个 Memory abstraction。**

---

# 24. Data Retention 也是这个问题

金融系统中的数据可能受：

```text
retention
legal hold
data residency
privacy
deletion
records management
```

约束。

而 Agent Memory 经常天然倾向于：

```text
“保存一点，以后可能有用。”
```

这在：

```text
personal assistant
```

很方便。

但对金融业务：

> **“以后可能有用”不是合法的数据保留依据。**

所以：

```text
Memory Retention Policy
```

与：

```text
Business Record Retention Policy
```

必须独立。

BIS 2026 年关于金融机构 AI 数据使用的研究强调，AI 数据治理涉及数据质量、隐私、安全、第三方依赖等问题，而且金融机构需要管理 AI 数据从获取、使用到保护的完整生命周期。

---

# 25. 第九个问题：多 Agent

假设：

```text
Research Agent
Compliance Agent
Operations Agent
```

共同处理：

```text
Case #123
```

如果 Business State 存在：

```text
shared agent memory
```

那么：

```text
Agent A
    writes status=approved

Agent B
    writes status=rejected

Agent C
    interprets current memory
```

整个系统很快进入：

```text
shared mutable semantic state
```

而且每个 Agent：

```text
different model
different prompt
different runtime
different permissions
```

导致：

> 谁拥有最终 authority？

无法回答。

---

# 26. 正确的 Multi-Agent 模式是共享 Case，不是共享 Memory Authority

应该：

```text
                  Business Case
                  Source of Truth
                       │
         ┌─────────────┼─────────────┐
         ▼             ▼             ▼
   Research Agent  Compliance     Operations
         │             │             │
         ▼             ▼             ▼
      Artifact       Decision       Command
```

每个 Agent 可以拥有：

```text
private memory
```

也可以有：

```text
shared case context
```

但：

```text
Case Authority
```

仍属于：

```text
Control Plane / Domain
```

---

# 27. Salesforce 的做法非常值得参考

Salesforce 在 Agentforce 中引入了结构化 Variables，把一些短期状态做成结构化数据，并可以作为 Action 的输入输出和触发条件，从而提高 Agent 行为的确定性。

这说明一个重要事实：

> **Agent Runtime 完全可以拥有结构化 State。**

因此本文不是：

> “Agent 不应该保存 State。”

真正的边界是：

```text
Agent State
    ≠
Business System of Record
```

Salesforce 对 Atlas Reasoning Engine 的架构描述也把 Agent 的：

```text
State
Flow
Side Effects
```

作为三个不同组成部分；State 支撑 Agent 的上下文，Flow 决定行为路径，而 Side Effect 才是对业务环境产生实际影响的操作。

这个分层非常值得保留。

---

# 28. 这是一个非常好的架构原则

可以浓缩成：

```text
State helps Agent think.
Flow controls Agent process.
Command changes Business.
```

进一步：

```text
Memory
    → helps the Agent remember

Workflow State
    → helps the system resume

Business State
    → tells the enterprise what is true

Command
    → changes what is true
```

四者不能合并。

---

# 29. 第十个问题：Domain Invariant

Business State 不只是：

```text
status = APPROVED
```

它通常还受到：

```text
business invariants
```

约束。

例如：

```text
A vote cannot be submitted unless:
    recordDate confirmed
    AND
    compliance approved
    AND
    PM approved
```

这些规则应该由：

```text
Domain / Policy
```

验证。

不能由：

```text
Agent Memory
```

自己维持。

否则：

```text
Memory:
    allChecksPassed = true
```

就可能绕过：

```text
actual domain invariants
```

---

# 30. Business State 是“受约束的事实”

一个成熟的 Business State 应该满足：

```text
typed
validated
authorized
versioned
transactional
auditable
recoverable
```

而 Agent Memory 更倾向：

```text
semantic
probabilistic
retrievable
compressible
evolvable
```

因此：

| 维度   | Business State          | Agent Memory                |
| ---- | ----------------------- | --------------------------- |
| 目的   | 记录业务事实                  | 提供上下文                       |
| 权威性  | authoritative           | non-authoritative           |
| 结构   | strict schema           | flexible                    |
| 修改   | controlled              | agent/application-driven    |
| 版本   | required where material | optional                    |
| 并发控制 | required                | often weak / app-specific   |
| 审计   | required                | supporting                  |
| TTL  | business-defined        | context-defined             |
| 授权   | explicit                | must be externally enforced |
| 可压缩  | 一般不允许语义损失               | 可以                          |
| 可总结  | 谨慎                      | 常见                          |
| 可删除  | 按业务/法规                  | 按 memory policy             |

---

# 31. Business State 应该由谁拥有

建议：

```text
Domain System
    or
Business Case Store
```

拥有。

例如：

```text
InvestmentIdea
ProxyVote
TradeException
ComplianceCase
```

这些业务对象可以存在：

```text
PostgreSQL
```

或者：

```text
Domain Service + DB
```

或者：

```text
existing enterprise system
```

而 Agent Memory：

```text
Redis
Vector Store
Document Store
Session DB
Agent Memory Service
```

只保存适合 Agent 使用的内容。

---

# 32. 推荐的架构关系

```text
                 ┌─────────────────────┐
                 │   Business State    │
                 │     / Domain DB     │
                 └──────────┬──────────┘
                            │
                     authoritative
                            │
                            ▼
                 ┌─────────────────────┐
                 │  Context Resolver   │
                 └──────────┬──────────┘
                            │
                 authorized projection
                            │
                            ▼
                 ┌─────────────────────┐
                 │    Agent Runtime    │
                 │                     │
                 │ Conversation        │
                 │ Working Memory      │
                 │ Long-term Memory    │
                 └──────────┬──────────┘
                            │
                       Recommendation
                            │
                            ▼
                 ┌─────────────────────┐
                 │    Control Plane    │
                 │                     │
                 │ Policy              │
                 │ Workflow            │
                 │ Approval            │
                 │ Command             │
                 └──────────┬──────────┘
                            │
                         mutation
                            │
                            ▼
                 ┌─────────────────────┐
                 │    Domain System    │
                 └─────────────────────┘
```

---

# 33. Read Path 与 Write Path 应该完全不同

## Read

```text
Business State
      ↓
authorization
      ↓
context projection
      ↓
Agent
```

## Write

```text
Agent
   ↓
proposed change
   ↓
Policy
   ↓
Approval if required
   ↓
Command
   ↓
Domain validation
   ↓
transaction
   ↓
Business State
```

这里最重要的区别：

> **Read Context 可以进入 Memory；Write Authority 不能进入 Memory。**

---

# 34. Read Path 不意味着 Memory 可以无限缓存

即使是：

```text
read-only business data
```

仍然要考虑：

```text
Data Entitlement
Staleness
Retention
Sensitivity
Tenant isolation
Case scope
```

例如：

```text
Portfolio holding
```

可能几分钟就过期。

所以 Memory 中：

```text
holding = 50%
```

最多应该是：

```text
cached observation
```

不是：

```text
current authoritative holding
```

---

# 35. Agent Memory 最适合保存什么

推荐保存：

### 1. Conversation Context

```text
用户说了什么
Agent 回答了什么
```

### 2. Working Context

```text
当前 Task 已尝试什么
哪些路径已经失败
```

### 3. Derived Notes

```text
这次研究发现哪些值得进一步调查
```

### 4. User Preferences

```text
报告偏好
语言偏好
输出风格
```

### 5. Reusable Experience

```text
某类任务之前采用了什么策略
```

### 6. Cached Retrieval Result

```text
最近一次查询的市场数据
```

但明确标记：

```text
cached
source
retrievedAt
expiresAt
```

---

# 36. Agent Memory 最不应该保存什么

尤其不要把以下内容仅保存到 Memory：

```text
authorization
approval
official business status
financial balance
position
trade status
legal status
risk limit
case ownership
regulatory decision
final settlement state
external transaction status
```

这些必须来自：

```text
authoritative system
```

---

# 37. 一个简单规则：凡是会决定“能不能做”，不要只放 Memory

例如：

```text
Can publish?
Can trade?
Can submit vote?
Can approve?
Can waive fee?
Can access client data?
Can close case?
```

这些最终都必须：

```text
Policy / Domain / Control Plane
```

重新验证。

而不是：

```text
memory says yes
```

---

# 38. 一个更简单的判断公式

可以问：

> **如果 Memory 被删除，企业是否仍然应该能够知道这个业务对象真实处于什么状态？**

如果答案是：

```text
NO
```

说明：

> Business State 错放进 Memory 了。

正确系统应该：

```text
Delete Agent Memory
        ↓
Agent loses convenience
        ↓
Business remains correct
```

---

# 39. 再问第二个问题

> **如果 Agent Memory 被篡改，企业业务状态是否会被直接改变？**

正确答案应该是：

```text
NO
```

如果答案是：

```text
YES
```

说明：

```text
Memory
```

已经越过了：

```text
Trust Boundary
```

---

# 40. 再问第三个问题

> **如果换一个 Agent Runtime，Business State 是否仍然完整？**

应该：

```text
YES
```

例如：

```text
Copilot Runtime
```

换成：

```text
DeepAgents Runtime
```

Case：

```text
INV-123
```

不应该改变：

```text
status
approval
owner
decision
commands
```

---

# 41. 再问第四个问题

> **如果 Agent Session 消失，Business Case 是否仍然可以恢复？**

应该：

```text
YES
```

例如：

```text
Session #A
    crashed
```

仍可以：

```text
Case #123
    ↓
Work Item #456
    ↓
Workflow checkpoint
    ↓
new Session
```

重新工作。

---

# 42. 再问第五个问题

> **如果模型升级，Business State 是否自动改变？**

正常应该：

```text
NO
```

例如：

```text
Model v1
    → Recommendation

Model v2
    → different Recommendation
```

可以改变：

```text
new recommendation
```

但不能偷偷修改：

```text
previous approval
```

或者：

```text
previous business fact
```

---

# 43. Memory 不应该拥有“时间旅行权”

这是一个非常实用的概念。

假设：

```text
今天:
risk = HIGH

三天前:
risk = LOW
```

Agent Memory：

```text
“之前是 LOW。”
```

这是可以的。

但不能：

```text
read old memory
    ↓
treat old value as current truth
```

因此 Memory 应保存：

```text
observation
timestamp
source
validity
```

而不是：

```text
truth forever
```

---

# 44. Recommendation 也不要写回 Memory 后当成事实

例如 Agent：

```text
Recommendation:
    client is high risk
```

不要：

```text
Memory:
    clientRisk = HIGH
```

然后下次：

```text
Agent sees clientRisk = HIGH
    ↓
assumes authoritative
```

更合理：

```text
Recommendation
    ↓
Risk Assessment Artifact
    ↓
validated
    ↓
Business Risk State
```

这是一个正式的业务状态转化过程。

---

# 45. AI 输出进入 Business State 必须经过“promotion”

可以定义：

```text
Agent Observation
       ↓
Candidate Fact
       ↓
Validation
       ↓
Policy / Human Review where required
       ↓
Business State
```

这就是：

> **AI output promotion。**

而不是：

```text
LLM output
    ↓
write database
```

---

# 46. 这个 Promotion 对 Agent 平台特别重要

它把：

```text
probabilistic world
```

和：

```text
deterministic business world
```

连接起来。

例如：

```text
Agent:
    “I believe this is a regulatory breach.”

        ↓

Finding:
    potential-breach

        ↓

Rule / Human Review

        ↓

Case State:
    INVESTIGATION_REQUIRED
```

于是：

```text
Agent
```

不直接定义：

```text
Business State
```

而是：

```text
propose
```

---

# 47. Salesforce Structured Variables 给出的启发

Salesforce 的 Variables 设计实际上展示了一个很好的中间层：

```text
Agent
    ↓
Structured Variable
    ↓
deterministic condition
    ↓
Action
```

Variables 可以用于：

```text
execution condition
```

这比自然语言 Memory 更可靠。

但企业级金融场景仍需要再向外加一层：

```text
Business Policy / Domain
```

即：

```text
Agent State
    ↓
Control Decision
    ↓
Business Command
```

而不是：

```text
Agent State
    =
Business Truth
```

---

# 48. LangGraph 的 State 也不能直接理解成 Business State

LangGraph 当前把 State 定义为 Agent nodes 共享的 state，并强调它可以保存执行所需的原始数据、支持节点之间共享、checkpoint、interrupt 和 recovery。

这是非常合理的 Runtime Design。

但：

```text
LangGraph State
```

仍然首先是：

> **Agent / Workflow execution state。**

如果它承载了：

```text
caseStatus
approvalStatus
tradeStatus
```

那么最好只是：

```text
projection / snapshot
```

而不是唯一的 Business Authority。

---

# 49. Agent Framework 的 Checkpoint 也不能直接等于 Business Database

Microsoft Agent Framework 的 checkpoint 非常适合：

```text
resume workflow
recover executor state
replay workflow
```

但是：

```text
Checkpoint
```

和：

```text
Business Record
```

仍然是不同抽象。

例如：

```text
checkpoint:
    currentExecutor = complianceAgent
    pendingRequest = approval
```

Business System：

```text
approval:
    requestId = APR-123
    requestedBy = workflow-456
    approvers = [alice, bob]
    status = PENDING
```

前者是：

```text
execution recovery
```

后者是：

```text
business authority
```

---

# 50. Control Plane / Runtime 分离后，这个边界就更加自然

前文的架构可以进一步明确为：

```text
                  CONTROL PLANE
                        │
              ┌─────────┼─────────┐
              │         │         │
          Workflow    Policy    Business State
              │         │         │
              └─────────┼─────────┘
                        │
                  Runtime Contract
                        │
                        ▼
                 AGENT RUNTIME
              ┌─────────┼─────────┐
              │         │         │
          Session     Memory    Checkpoint
```

这里的语义非常清楚：

```text
Control Plane
    = authoritative control

Runtime
    = executable context
```

---

# 51. Case-centric Architecture 中尤其不能混淆

假设：

```text
Business Case #123
```

应该：

```text
Case Store:
    status = UNDER_REVIEW
    owner = Alice
```

而 Agent Session：

```text
Session:
    "We are currently discussing compliance."
```

Workflow checkpoint：

```text
currentNode = compliance-review
```

Agent Memory：

```text
"Compliance seems concerned about ESG exposure."
```

四个信息都可以同时存在：

```text
Case
    = business truth

Workflow
    = process truth

Session
    = conversation truth

Memory
    = agent context
```

这就是最干净的边界。

---

# 52. Business Case 不应该因为 Memory Clear 而改变

例如用户点击：

```text
Clear Agent Memory
```

应该：

```text
Agent Memory
    → deleted
```

但：

```text
Case
    → untouched
```

否则：

```text
clear memory
```

实际上变成：

```text
delete business history
```

这显然不合理。

---

# 53. 同理，模型 Context Compaction 不应该改变 Business State

Anthropic 明确把 compaction 和 structured memory 作为跨 context window 管理上下文的重要技术；这些机制本质上是在减少 token/context 负担。

因此：

```text
Context compaction
```

应该影响：

```text
what the Agent remembers
```

而不应该影响：

```text
what the enterprise believes is true
```

---

# 54. Memory Summarization 是高风险边界

例如：

```text
原始事实：

Compliance approved Proposal 1
with scope = ESG resolution
on Sep 15
under Policy v4.
```

Summary：

```text
Compliance approved the case.
```

摘要非常自然。

但已经丢失：

```text
scope
date
policy
```

如果 Summary 后来成为 Memory：

```text
“approved”
```

然后 Agent 执行：

```text
publish
```

就发生了：

> **Semantic information loss → business control failure**

因此：

> Memory summary 不能替代 authoritative structured record。

---

# 55. Memory Retrieval 也是非确定的

例如：

```text
Case has 100 memories.
```

Embedding retrieval：

```text
top 5
```

今天可能返回：

```text
approval-related memory
```

明天因为：

```text
new documents
new embedding model
new ranking
```

返回：

```text
old research memory
```

因此：

```text
retrieval result
```

不是：

```text
business state resolver
```

---

# 56. Agent Memory 的语义本质是“相关性”

Memory 系统常常问：

```text
What is relevant?
```

Business State 系统问：

```text
What is true?
```

这是两个不同的问题。

因此：

```text
Vector similarity
```

非常适合：

```text
relevant prior context
```

却不能定义：

```text
current approval state
```

---

# 57. 这也是为什么 RAG 不能成为 State Store

例如：

```text
RAG:
    “Compliance approval document says approved.”
```

可以成为：

```text
Evidence
```

但不能直接变成：

```text
approvalStatus = APPROVED
```

需要：

```text
document
    ↓
validated interpretation
    ↓
business process
    ↓
structured state
```

尤其是高风险金融业务。

---

# 58. Authority 应该沿着“结构化链”传播

推荐：

```text
Authoritative Data
      ↓
Business State
      ↓
Workflow State
      ↓
Task Context
      ↓
Agent Memory
```

信息可以：

```text
向下投影
```

但 authority 不应该：

```text
向上自动提升
```

即：

```text
Memory → Business State
```

必须经过：

```text
controlled promotion
```

---

# 59. 这可以叫做“Authority Gradient”

可以用一个很实用的概念表示：

```text
                    Authority
                       ↑

Domain / Business DB  ██████████
Policy / Approval     █████████
Workflow State        ███████
Case Artifact         █████
Agent Context         ███
Agent Memory          ██
Conversation          █
```

越靠近顶部：

```text
authority
```

越高。

越靠近底部：

```text
flexibility
```

越高。

---

# 60. 不要让低 Authority 数据直接驱动高 Authority 动作

例如：

```text
Conversation
    ↓
Agent Memory
    ↓
Command
```

这条路径太短。

正确：

```text
Conversation
    ↓
Agent Reasoning
    ↓
Recommendation
    ↓
Policy / Review
    ↓
Command
```

这样：

```text
low-authority input
```

必须经过：

```text
control boundary
```

才能影响：

```text
high-authority side effect
```

---

# 61. Business State 应该具有明确的写入口

例如：

```text
PUT /cases/{id}
```

也未必适合直接暴露给 Agent。

更安全：

```text
Command:
    ApproveCase
    RejectCase
    SubmitVote
    CloseCase
```

然后：

```text
Command
   ↓
Policy
   ↓
Domain
   ↓
Business State
```

这样：

```text
Memory
```

永远没有：

```text
write arbitrary business fields
```

的能力。

---

# 62. Memory 最多允许“提议状态变更”

例如：

```text
Agent:
    propose:
      status = "READY_FOR_REVIEW"
```

Control Plane：

```text
validate:
    required work complete?
    evidence complete?
    policy satisfied?
```

然后才：

```text
Case.status = READY_FOR_REVIEW
```

---

# 63. 这一点对 `@task` 特别重要

前面设计中：

```text
@task
```

是：

> AI Work Unit

因此：

```text
@task
```

应该返回：

```text
structured result
```

而不是直接：

```text
update case.status
```

例如：

```json
{
  "outcome": "success",
  "finding": {
    "risk": "high"
  },
  "evidence": [
    "E-123"
  ]
}
```

Workflow / Domain 再决定：

```text
Case State
```

---

# 64. 一个完整的金融 Agent 示例

## 错误架构

```text
Proxy Vote Agent

Memory:
    recordDateConfirmed = true
    complianceApproved = true
    pmApproved = true

Agent:
    if all:
        submitVote()
```

这里：

```text
Memory
    ↓
Authorization
    ↓
Business Side Effect
```

---

# 65. 正确架构

```text
Proxy Vote Case
     │
     ├── recordDate = confirmed
     ├── compliance = approved
     ├── pmApproval = pending
     └── voteStatus = not-ready
```

Agent：

```text
reads Case
    ↓
finds PM approval pending
    ↓
recommends:
    request PM review
```

Control Plane：

```text
Workflow:
    currentNode = pm-review
```

Human：

```text
PM approves
```

Business State：

```text
pmApproval = approved
```

然后：

```text
Command:
    SubmitVote
```

再进行：

```text
Policy
+
Domain
+
Idempotency
```

最终：

```text
voteStatus = submitted
```

---

# 66. 为什么这个结构更可靠

因为即使 Agent Memory 被删除：

```text
Case
    compliance = approved
    pmApproval = pending
```

仍然存在。

即使 Agent Runtime 崩溃：

```text
Business State
```

仍然存在。

即使 Model 升级：

```text
Business State
```

仍然存在。

即使 Memory 被污染：

```text
Policy / Domain
```

仍然重新检查。

---

# 67. Runtime 只需要重新获取“当前事实”

恢复时：

```text
Runtime starts
    ↓
Execution = waiting_for_review
    ↓
Load Case
    ↓
Resolve current authorized context
    ↓
Create Agent Context
```

而不是：

```text
Load old memory
    ↓
hope it still represents reality
```

这是 Durable Agent 最核心的设计之一。

---

# 68. Case State 与 Agent Memory 可以同时存在

正确架构不是：

```text
Case State
OR
Memory
```

而是：

```text
Case State
      │
      ├───────────────┐
      │               │
      ▼               ▼
Workflow State    Agent Context
                      │
                      ▼
                   Memory
```

也就是说：

> **Memory 是 State 的消费者，而不是 State 的替代品。**

---

# 69. 可以把 Memory 看成“Materialized Intelligence”

这是一个很适合 Agent 平台的抽象。

传统系统：

```text
Database
    ↓
Materialized View
```

Agent：

```text
Business State
    ↓
Context Projection
    ↓
Agent Memory
```

Memory 保存的是：

> **为了让 Agent 工作更高效而生成的、面向 Agent 的派生视图。**

这样就不会误把：

```text
Agent-facing projection
```

当成：

```text
Business-facing authority
```

---

# 70. Memory 可以被重建，Business State 不应该靠 Memory 重建

例如：

```text
Delete Agent Memory
```

可以：

```text
rebuild from Case + Evidence + Decisions
```

这很好。

反过来：

```text
Delete Business State
```

然后：

```text
rebuild from Memory
```

通常不可接受。

这个不对称性非常重要：

> **Memory 应该是可重建的；Authoritative Business State 才是被保留的。**

---

# 71. 这也解释了为什么 Memory Store 不应该成为企业 System of Record

Memory Store 通常支持：

```text
semantic retrieval
summarization
embedding
TTL
namespace
```

而 System of Record 需要：

```text
transaction
constraint
version
authorization
audit
history
reconciliation
```

二者的设计目标完全不同。

---

# 72. Memory Store 甚至可以完全换掉

例如：

```text
2026:
    Redis + Vector DB

2027:
    Agent Memory Service

2028:
    vendor managed memory
```

只要：

```text
Business State
```

仍然在：

```text
Domain / Case Store
```

系统就不会改变业务语义。

---

# 73. 这与 Control Plane / Runtime 分离天然一致

前面定义：

```text
Control Plane
    = authority

Agent Runtime
    = reasoning
```

现在进一步：

```text
Business State
    = Control Plane / Domain

Memory
    = Runtime
```

于是：

```text
Control Plane
     │
     ├── Business State
     ├── Workflow State
     ├── Policy
     └── Command
            │
            ▼
       Runtime Contract
            │
            ▼
       Agent Runtime
            │
            ├── Session
            ├── Memory
            └── Working State
```

边界非常自然。

---

# 74. 这也是为什么“Memory-first Agent Architecture”需要谨慎

一些 Agent 框架会提供：

```text
Memory
State
Checkpoint
Tool history
```

这些能力非常有价值。

但企业平台不能因为 Framework 提供：

```text
state store
```

就把：

```text
enterprise business state
```

塞进去。

Framework State 解决的是：

> “这个 Agent / Workflow 如何继续运行？”

企业 Business State 解决的是：

> “我们的业务现在到底是什么状态？”

两个问题不同。

---

# 75. OpenAI Agents SDK 的接口也体现了这种边界

OpenAI 当前把：

```text
Session
Run State
Context
```

作为不同概念。

Session 用来保存：

```text
conversation history
```

而 `RunContext` 被定位为当前运行的本地应用状态；官方文档同时明确把 conversation state 与本地 run context 区分开。

这说明现代 Agent SDK 本身也没有要求：

```text
everything = one global memory object
```

企业平台更应该进一步分层。

---

# 76. 推荐的 Business State 数据模型

例如：

```ts
interface BusinessCase {
  caseId: string;

  caseType: string;
  status: CaseStatus;

  owner: ActorRef;

  subject: CaseSubject;

  riskTier: RiskTier;

  version: number;

  openedAt: string;
  updatedAt: string;
}
```

这里：

```text
status
owner
riskTier
version
```

都是：

```text
authoritative
```

---

# 77. Agent Context 模型

```ts
interface AgentContext {
  caseId: string;

  currentTask: {
    taskId: string;
    purpose: string;
  };

  caseSnapshot: {
    status: string;
    owner: string;
    relevantFacts: unknown;
  };

  evidence: EvidenceRef[];

  capabilities: CapabilityRef[];

  runtimeLimits: RuntimeLimits;
}
```

这里的：

```text
caseSnapshot
```

只是：

> **给 Agent 用的 projection。**

它不是新的 Source of Truth。

---

# 78. Agent Memory 模型

```ts
interface AgentMemoryEntry {
  memoryId: string;

  scope: {
    tenantId: string;
    agentId: string;
    caseId?: string;
  };

  type:
    | "conversation"
    | "note"
    | "experience"
    | "preference"
    | "cache";

  content: unknown;

  source?: EvidenceRef[];

  createdAt: string;
  expiresAt?: string;
}
```

特别注意：

```text
caseId
```

可以作为 Memory scope。

但：

```text
caseId
```

不意味着 Memory 获得：

```text
authority over Case
```

---

# 79. 一个极其重要的规则

> **Memory 可以记住 Case，但不能代表 Case。**

例如：

```text
Memory:
    "Case 123 is waiting for PM approval."
```

这很好。

但：

```text
Case Store:
    status = WAITING_FOR_PM
```

才是正式业务状态。

---

# 80. 同理，Memory 可以记住 Approval，但不能创造 Approval

例如：

```text
Memory:
    "Alice approved this."
```

不等于：

```text
Approval:
    approver=Alice
    status=APPROVED
```

真正的 Approval 应来自：

```text
Human Task
Approval Service
Policy
```

并具有：

```text
identity
timestamp
scope
version
evidence
```

---

# 81. Memory 可以帮助 Agent 发现“应该查什么”

例如：

```text
Memory:
    “上次类似 Case 最后发现一个 hidden restriction。”
```

Agent：

```text
→ search relevant policy
```

这非常好。

也就是说 Memory 适合：

```text
question generation
retrieval planning
hypothesis
```

不适合：

```text
authority
```

---

# 82. Memory 可以帮助 Agent 提高效率，而不能降低控制强度

这是很好的设计原则：

```text
Memory
    ↓
fewer turns
better context
faster reasoning
```

但不能：

```text
Memory
    ↓
skip policy
skip approval
skip domain validation
```

所以：

> **Memory 可以减少 Agent 的工作量，但不能减少 Business Control。**

---

# 83. Cache 与 Authority 必须严格分离

可以缓存：

```text
current customer profile
current portfolio summary
current risk score
```

但每当它影响：

```text
high-risk action
```

仍要：

```text
revalidate against source of truth
```

例如：

```text
Cache:
    balance = 10M

Before transfer:
    query authoritative balance
```

这是金融系统非常常见的设计思想，同样应该被 Agent 平台继承。

---

# 84. Business State 的读也需要 Policy

即使：

```text
Case
```

是权威业务对象：

```text
Agent
```

也不应该：

```text
read entire Case
```

而应该：

```text
Case
  ↓
Data Entitlement
  ↓
authorized projection
```

例如：

```text
Compliance Agent
```

可能看到：

```text
compliance facts
```

但不能自动看到：

```text
trading strategy
```

所以：

```text
Business State
    ≠
universally readable state
```

---

# 85. Case Projection 很重要

例如：

```text
Full Case

{
  portfolioValue: ...,
  holdings: ...,
  clientPII: ...,
  compliance:
    ...,
  internalStrategy:
    ...
}
```

Research Agent：

```text
projection:

{
  security,
  marketData,
  publicResearch
}
```

Compliance Agent：

```text
projection:

{
  security,
  relevantPolicies,
  internalComplianceFindings
}
```

同一个：

```text
Case
```

可以产生：

```text
different Agent Context projections
```

这比把整个 Business State 放进 Memory 更安全。

---

# 86. Business State 与 Memory 的版本也应分开

例如：

```text
Case Version:
    14

Workflow:
    v13

Agent Memory:
    generated at 10:14
```

Memory 必须知道：

```text
derivedFromCaseVersion = 14
```

如果 Case 升级到：

```text
version = 15
```

那么旧 Memory 可以被标记：

```text
stale
```

而不能继续假设：

```text
current
```

---

# 87. 推荐加入 `derivedFrom` / `observedAt`

例如：

```json
{
  "memory": "risk appears high",
  "derivedFrom": [
    "case:123:v14",
    "evidence:456:v2"
  ],
  "observedAt": "2026-09-19T09:30:00Z"
}
```

这样 Agent Memory 至少能够回答：

```text
这条 Memory 从哪里来的？
```

但注意：

> lineage 提高可信度，不会自动把 Memory 变成 authority。

2026 年关于 Memory Poisoning 的研究甚至显示，仅靠 lineage 也可能被攻击者利用“summarization / echo / corroboration”方式污染，因此真正的权限边界仍应放在 Memory 之外。

---

# 88. Business State 要有明确写模型

一个不错的金融 Agent 架构：

```text
Agent
   ↓
Observation / Recommendation
   ↓
Workflow
   ↓
Policy
   ↓
Human Approval
   ↓
Command
   ↓
Domain
   ↓
Business State
```

而不是：

```text
Agent
   ↓
Memory
   ↓
Business State
```

---

# 89. 这实际上就是 CQRS 思想在 Agent 系统里的延伸

可以理解成：

```text
Read Model
    → Agent Context

Command Model
    → Business Mutation

Authoritative Model
    → Business State
```

Agent 是：

```text
intelligent reader / proposer
```

Command 是：

```text
controlled writer
```

Domain 是：

```text
final invariant enforcer
```

Memory 只是：

```text
context optimization layer
```

---

# 90. 为什么 Command 必须存在

因为：

```text
Memory
```

不应该修改：

```text
Business State
```

所以需要：

```text
Command
```

把：

```text
probabilistic intent
```

转化为：

```text
deterministic business mutation
```

例如：

```text
Agent:
    “I recommend submitting the vote.”

Command:
    SubmitVote {
      caseId,
      proposalIds,
      resourceVersion
    }
```

然后：

```text
Policy
    ↓
Domain
    ↓
Business State
```

---

# 91. Command 是 Memory 和 Business State 之间的防火墙

可以把它画成：

```text
            AGENT WORLD
 ┌──────────────────────────┐
 │ Conversation             │
 │ Working Memory           │
 │ Long-term Memory         │
 │ Recommendations         │
 └─────────────┬────────────┘
               │
          proposal only
               │
               ▼
        ┌─────────────┐
        │   COMMAND   │
        └──────┬──────┘
               │
          Policy / Auth
               │
          Domain Validation
               │
               ▼
      ┌──────────────────┐
      │ BUSINESS STATE    │
      └──────────────────┘
```

这是一条很强的 Trust Boundary。

---

# 92. Human Approval 也应该作用于 Command，而不是 Memory

错误：

```text
Agent Memory:
    approved=true
```

正确：

```text
Command:
    SubmitVote(...)

Human Approval:
    Approved
    for exact Command hash
```

然后：

```text
Execution
```

这与前面 Approval / Command 设计完全一致。

---

# 93. 为什么批准“Memory”没有意义

例如：

```text
Human:
    “这份分析没问题。”
```

这可能只是：

```text
feedback
```

而不代表：

```text
authorize command
```

所以：

```text
Human text
   ↓
Memory
```

不能自动产生：

```text
Business Authority
```

必须存在：

```text
structured decision / approval
```

---

# 94. Business State 需要 Event History

例如：

```text
CaseStatusChanged
    PENDING → UNDER_REVIEW

ApprovalGranted

RiskChanged
    LOW → HIGH

OwnerChanged

CommandExecuted
```

这样系统可以回答：

```text
什么时候变的？
谁改的？
为什么？
基于什么？
```

Memory 很难承担这个职责，因为：

```text
memory retrieval
```

本身不保证完整事件序列。

---

# 95. Event History 也不是 Agent Conversation History

这两个经常被混淆。

```text
Conversation History:
    “我们是不是可以先让 PM 看一下？”

Business Event:
    ReviewRequested
```

第一条是：

```text
communication
```

第二条是：

```text
business fact
```

只有第二条可以驱动：

```text
workflow
```

---

# 96. 企业 Agent 系统的“真相链”应该这样设计

推荐：

```text
External Systems
       ↓
Domain Records
       ↓
Business State
       ↓
Workflow State
       ↓
Case Context
       ↓
Agent Memory
```

而变化：

```text
Agent Recommendation
       ↓
Decision
       ↓
Command
       ↓
Domain
       ↓
Business State
```

形成闭环：

```text
Truth
 ↓
Context
 ↓
Reasoning
 ↓
Decision
 ↓
Command
 ↓
Truth'
```

---

# 97. 这个闭环非常重要

Agent 不是：

```text
truth owner
```

它是：

```text
reasoning engine
```

Business System：

```text
truth owner
```

因此：

```text
Agent reads reality
       ↓
Agent reasons
       ↓
Control validates
       ↓
Domain changes reality
```

而不是：

```text
Agent invents reality
       ↓
Memory stores reality
```

---

# 98. 金融业务为什么尤其不能反过来

金融业务中：

```text
position
approval
risk
limit
order
vote
settlement
client entitlement
```

这些状态都有：

```text
financial consequence
legal consequence
operational consequence
```

因此不能依赖：

```text
semantic memory
```

作为唯一事实。

BIS 2026 年强调，金融机构仍然对 AI-informed decisions 负责，同时 AI 数据使用需要强数据治理；BIS 还特别强调模型可能 hallucinate、biased、opaque。

FSB 2026 年关于金融机构 AI 治理的 Consultation Report 也强调需要围绕 AI 生命周期建立组织治理、风险管理、数据、网络和第三方风险等一整套控制，而不是把责任交给 AI 系统本身。

---

# 99. 最终可以形成一个“Authority Ladder”

建议平台明确规定：

```text
Level 5
Domain / External System
    ↓
authoritative business fact

Level 4
Control Plane
    ↓
policy / workflow / approval

Level 3
Case / Artifact
    ↓
business context / derived record

Level 2
Agent Runtime State
    ↓
execution context

Level 1
Agent Memory
    ↓
semantic convenience

Level 0
Conversation
    ↓
untrusted user interaction
```

一个低等级对象：

```text
不能自动提升自己成为高等级 Authority。
```

---

# 100. “Memory → State Promotion”必须显式

例如：

```text
Memory:
    "customer appears eligible"
```

经过：

```text
Eligibility Assessment
```

才可能形成：

```text
Business State:
    eligibility = ELIGIBLE
```

Promotion 需要：

```text
schema
validation
source
actor
timestamp
policy
version
```

---

# 101. Agent Memory 也不应该作为 Workflow Router

错误：

```text
Memory:
    phase = compliance

Agent:
    route to compliance
```

正确：

```text
Workflow State:
    currentNode = compliance
```

Memory 可以提示：

```text
“Compliance seems relevant.”
```

但：

```text
Workflow Runtime
```

决定：

```text
next node
```

这样 Workflow 才是可恢复、可检查、可版本化的。

---

# 102. Memory 也不能决定 Case Closure

错误：

```text
Memory:
    all done
```

正确：

```text
Case Closure Policy
    ↓
Required Work complete
    ↓
Required Decisions complete
    ↓
Required Commands complete
    ↓
Case → CLOSED
```

---

# 103. Agent Memory 可以保存“任务摘要”，但不应该保存“任务完成事实”

例如：

```text
Memory:
    “I believe the research task is complete.”
```

很好。

Business State：

```text
WorkItem:
    status = COMPLETED
```

需要：

```text
task completion contract
```

而不是相信 Memory。

---

# 104. 为什么 Agent Memory 特别容易产生“事实漂移”

典型链条：

```text
Original Record
    ↓
Agent reads
    ↓
Agent summarizes
    ↓
Memory stores summary
    ↓
Next Agent reads summary
    ↓
Agent summarizes again
    ↓
Memory updates
```

最终：

```text
Original Fact
    ↓
semantic drift
```

如果这个链条最终控制：

```text
Business State
```

就非常危险。

---

# 105. 因此推荐“evidence first”

Memory 可以说：

```text
“Risk may be high.”
```

但 Business Decision 应该引用：

```text
Evidence:
    E1
    E2
    E3
```

然后：

```text
Decision:
    HIGH
```

这样：

```text
Memory
```

只是：

```text
reasoning aid
```

而：

```text
Evidence + Decision
```

才进入业务记录。

---

# 106. Memory 可以丢，Evidence 不能随便丢

例如：

```text
Agent Memory:
    temporary analysis
```

可以过期。

但：

```text
Decision Evidence
```

如果属于正式业务记录：

```text
must follow business retention policy
```

因此：

> **不要让 Memory Store 同时承担 Evidence Store 的职责。**

---

# 107. Runtime Memory 与 Evidence Store 的数据质量也不同

Memory：

```text
may be summarized
may be deduplicated
may be ranked
```

Evidence：

```text
source-preserved
versioned
traceable
hashable
```

如果需要 Regulatory Evidence：

```text
Evidence
```

应该独立存储。

---

# 108. 一个很实用的字段：`sourceType`

例如：

```ts
type FactSource =
  | "domain"
  | "external-system"
  | "human-decision"
  | "policy"
  | "agent-observation"
  | "agent-memory";
```

这样平台可以明确：

```text
source = agent-memory
```

不应该与：

```text
source = domain
```

等价。

---

# 109. 更进一步可以增加 `authorityLevel`

例如：

```ts
type AuthorityLevel =
  | "untrusted"
  | "observed"
  | "derived"
  | "validated"
  | "authoritative";
```

那么：

```text
Agent Memory
    → observed / derived

Human Decision
    → validated

Domain Record
    → authoritative
```

这能够让平台显式区分：

```text
information
vs
authority
```

---

# 110. 这比“memory confidence score”更可靠

不能简单：

```text
Memory confidence = 0.98
```

然后：

```text
if confidence > .95:
    trust memory
```

因为：

> **Confidence 不是 Authority。**

Memory 可以非常 confident 地错。

真正应该考虑：

```text
source
scope
freshness
authority
validation
```

---

# 111. Recent research 也支持“Authority ≠ Memory Confidence”

2026 年的长期 Memory Poisoning 研究指出，基于内容检测或 lineage 的 Memory defense 可能被攻击者通过 summarization、trusted-tool echo 等方式操纵；因此不能把“看起来可信的 Memory”简单视为可信 authority。

这对企业 Agent 的启发非常直接：

> **“可信 Memory”仍然不等于“业务权威”。**

---

# 112. Case Memory 最合理的用途

在 Business Case 架构中，Case Memory 可以保存：

```text
what has been investigated
what hypotheses were rejected
what documents have been reviewed
what questions remain
what the previous Agent suggested
```

非常有用。

但 Case 的：

```text
status
owner
approval
decision
command
outcome
```

仍应来自：

```text
Case / Control / Domain
```

---

# 113. 这样 Agent 可以拥有“Case Understanding”

Agent Memory：

```text
Case #123:
    likely issue = data inconsistency
    already checked = document A, B, C
    unresolved = source D
```

这非常有价值。

但不要：

```text
Memory:
    case.status = resolved
```

除非：

```text
Business Case
```

已经正式：

```text
status = RESOLVED
```

---

# 114. Business State 也不应该全部复制给 Agent

即使 Case 是 authoritative：

```text
Agent
```

也不需要：

```text
all columns
```

应该通过：

```text
Context Projection
```

只给：

```text
current task relevant state
```

这样可以同时解决：

```text
security
privacy
latency
context size
cost
```

---

# 115. 一个推荐的 Context Assembly Pipeline

```text
Business Case
      │
      ▼
Case Context Resolver
      │
      ├── current business state
      ├── related entities
      ├── current workflow state
      ├── relevant evidence
      ├── authorized data
      └── open work
      │
      ▼
Task-specific Context
      │
      ▼
Agent Runtime
      │
      ├── conversation memory
      ├── working memory
      └── long-term memory
      │
      ▼
LLM
```

注意最后：

```text
LLM
```

看到的是：

```text
projection
```

而不是：

```text
entire business database
```

---

# 116. Memory 读取也应经过 Scope

例如：

```text
MemoryScope:
    tenant
    case
    agent
    user
```

AWS 当前明确建议对 Agent Memory 按 session、user、tenant、agent、group 等 workload-relevant boundary 进行 partition，并限制每个 Agent 的 namespace 访问范围。

因此至少应该避免：

```text
Agent A:
    read global memory
```

---

# 117. Business Case Memory 特别需要防止跨 Case 污染

错误：

```text
Case A
    ↓
Memory
    ↓
Case B
    ↓
same memory namespace
```

可能导致：

```text
wrong client
wrong investment
wrong approval
wrong context
```

所以：

```text
caseId
```

通常应该成为重要 Memory namespace。

---

# 118. 但 Case Scope 仍不是 Security Boundary 的全部

即使：

```text
caseId = 123
```

Agent 也必须经过：

```text
Data Entitlement
Capability
Policy
```

所以：

```text
Case Scope
    ≠
Authorization
```

---

# 119. 这最终形成四层安全边界

```text
Tenant Boundary
      ↓
Case Boundary
      ↓
Capability / Data Entitlement
      ↓
Task Context
      ↓
Memory
```

越往下：

```text
scope
```

越小。

这比：

```text
one giant shared memory
```

安全得多。

---

# 120. Business State 与 Agent Memory 的恢复策略也不同

## Business State

```text
backup
replication
transaction
reconciliation
DR
```

## Workflow State

```text
checkpoint
resume
CAS
retry
```

## Agent Memory

```text
rebuild
compaction
eviction
TTL
semantic retrieval
```

三套恢复机制不同。

AWS 当前的 Agentic AI Lens 也将 Memory Reliability 与 Checkpoint-based Recovery 分开：Memory 需要冗余、隔离、failover，而长流程需要在阶段边界持久化 checkpoint 并从最近的有效状态恢复。

---

# 121. 不要用 Memory Backup 替代 Business Disaster Recovery

例如：

```text
Backup:
    agent-memory.json
```

不能替代：

```text
Case DB backup
Approval DB backup
Command DB backup
Audit evidence backup
```

因为：

```text
Memory backup
```

并不一定包含：

```text
complete business history
```

更不保证：

```text
transactional consistency
```

---

# 122. Business State 需要 Reconciliation

例如：

```text
Command:
    SubmitVote

Internal:
    EXECUTING
```

External vendor：

```text
UNKNOWN
```

此时不能：

```text
Memory:
    “probably submitted”
```

然后：

```text
Case = submitted
```

需要：

```text
reconciliation process
```

重新确认外部系统。

这是 Business State 与 Memory 的本质区别：

> **Business State 需要对外部世界负责。Memory 不需要。**

---

# 123. “Unknown” 也是 Business State

例如：

```text
voteSubmission = UNKNOWN
```

比：

```text
Agent Memory:
    “looks submitted”
```

可靠得多。

因为：

```text
UNKNOWN
```

明确表示：

```text
system does not know yet
```

而 Memory：

```text
probably submitted
```

可能被模型误当事实。

---

# 124. 这也是金融系统为什么应该允许“暂时不知道”

Agent 往往倾向：

```text
give an answer
```

Business System 必须允许：

```text
UNKNOWN
PENDING
UNVERIFIED
CONFLICT
STALE
```

这几个状态对 Agent 非常重要。

因为：

> **不确定性应该成为显式业务状态，而不是被 Memory 的自然语言消解掉。**

---

# 125. 一个很有价值的状态集合

例如：

```text
VALID
PENDING
UNKNOWN
STALE
CONFLICTED
REVOKED
```

Agent 可以：

```text
explain
recommend
investigate
```

但不能把：

```text
UNKNOWN
```

自动变成：

```text
VALID
```

---

# 126. Business State 的“权威性”应该可验证

例如：

```ts
interface BusinessFact {
  value: unknown;

  source: FactSource;

  observedAt: string;

  validatedAt?: string;

  version: number;

  authority: "authoritative" | "derived";
}
```

这样 Agent 可以理解：

```text
This is a cached observation.
```

而不是：

```text
This is the truth.
```

---

# 127. 对现有 Agent 平台，建议不要只设计一个 `state` 表

这是很容易走入的坑：

```text
agent_execution.state JSONB
```

然后所有东西都往里面塞：

```text
caseStatus
approvalStatus
owner
agentThoughts
toolResults
memory
workflow
```

最终无法区分：

```text
authority
lifecycle
retention
security
versioning
```

---

# 128. 至少应该拆成这些逻辑对象

```text
Case
WorkflowExecution
WorkItem
AgentSession
AgentMemory
Evidence
Decision
Approval
Command
AuditEvent
```

即使物理数据库暂时仍然可以：

```text
modular tables
```

也要保证语义分离。

---

# 129. 例如当前项目的合理映射

当前平台如果已经有：

```text
agent_execution.workflow_state
```

那么：

```text
workflow_state
```

应该保存：

```text
currentNode
stepStatus
workflowVersion
sourceHash
waitingTask
```

这些属于：

```text
Workflow Execution State
```

而：

```text
Case
```

可以另外保存：

```text
case.status
case.owner
case.subject
case.outcome
```

而 Agent Runtime：

```text
session
```

保存：

```text
conversation
```

Memory：

```text
agent notes / context
```

这样整个架构会非常清晰。

---

# 130. 最终形成这样的对象关系

```text
Business Case
│
├── Business State
│
├── Workflow Execution
│     └── Workflow State
│
├── Work Items
│
├── Decisions
│
├── Approvals
│
├── Commands
│
├── Evidence
│
├── Agent Sessions
│     └── Conversation
│
└── Agent Memory
      └── contextual / experiential information
```

这实际上就是：

> **Business Case-centered Agent Architecture。**

---

# 131. Business State → Agent Memory 是“复制”

这一点最好明确：

```text
Business State
    ↓
projection / snapshot
    ↓
Memory
```

所以：

```text
Memory
```

应该是：

```text
derived
```

而不是：

```text
canonical
```

因此它可以：

```text
invalidate
refresh
rebuild
discard
```

---

# 132. Agent Memory → Business State 是“Promotion”

它不是普通复制。

它应该是：

```text
proposal
+
validation
+
authorization
+
possibly human review
```

例如：

```text
Agent:
    "I found a potential breach."

    ↓

Finding:
    potential_breach

    ↓

Compliance Workflow

    ↓

Human Decision

    ↓

Case Status:
    INVESTIGATION_REQUIRED
```

这才是安全的。

---

# 133. 这个模型非常适合 AI Agent

因为 AI 的天然定位就是：

```text
interpret
infer
summarize
recommend
plan
```

而企业系统负责：

```text
validate
authorize
persist
commit
audit
```

因此：

```text
AI
    = probabilistic interpretation

Business State
    = deterministic commitment
```

---

# 134. Business State 是“Commit Point”

可以把它理解成数据库事务：

```text
Agent reasoning
    = pre-commit

Command / Policy
    = validation

Domain mutation
    = commit

Business State
    = committed truth
```

Agent Memory 则：

```text
working copy
```

非常类似：

```text
editor buffer
```

与：

```text
committed repository
```

的关系。

---

# 135. 一个非常实用的比喻

可以把：

```text
Agent Memory
```

理解成：

> **Agent 的工作笔记。**

而：

```text
Business State
```

是：

> **公司的正式账簿。**

工作笔记可以：

```text
写错
涂改
总结
删掉
重新整理
```

正式账簿：

```text
必须有规则
有责任人
可追溯
可核对
可恢复
```

因此：

> **Agent 可以根据自己的笔记工作，但不能让笔记成为公司的正式账簿。**

---

# 136. 另一个更准确的比喻：IDE 与 Git

```text
Agent Memory
    ≈ working tree / editor state

Business State
    ≈ committed repository
```

Agent 可以：

```text
change
experiment
branch
discard
```

但：

```text
business mutation
```

必须：

```text
commit
```

并且：

```text
policy / review / validation
```

决定是否允许 commit。

---

# 137. 这也解释了为什么 Agent 可以“犯错”

Memory：

```text
wrong hypothesis
```

完全允许。

因为：

```text
hypothesis
    ≠
business fact
```

只要错误被挡在：

```text
Command / Domain / Policy
```

之前：

```text
blast radius
```

就是有限的。

---

# 138. 所以成熟 Agent 的目标不是“Memory 永远正确”

这是不现实的。

真正目标应该是：

> **即使 Memory 不可靠，业务状态仍然可靠。**

也就是：

```text
Memory may fail
       ↓
Control remains correct
       ↓
Business remains safe
```

这比：

```text
Memory must be perfect
```

更现实，也更符合 Agent 的本质。

---

# 139. Agent Memory Failure Modes

平台应该主动测试：

```text
stale memory
wrong summary
memory poisoning
cross-case contamination
cross-tenant leakage
memory deletion
memory corruption
retrieval miss
retrieval of obsolete fact
conflicting memories
malicious memory
```

而不是只测：

```text
“Agent 会不会忘记用户喜欢什么？”
```

---

# 140. Business State Failure Modes

另外一套测试：

```text
lost update
race condition
double approval
stale version
replayed command
partial external execution
unknown external outcome
policy drift
workflow upgrade
recovery after crash
```

两套测试完全不同。

---

# 141. Memory Security 与 Business Security 也应该分开

Memory Security：

```text
isolation
integrity
poisoning
retention
privacy
retrieval control
```

Business Security：

```text
authorization
SoD
policy
command integrity
idempotency
domain invariant
audit
```

AWS 当前 Agentic AI Lens 正是把 Memory Isolation / Integrity 与 Tool Authorization / Workflow Security 分成不同控制域。

---

# 142. 这也是为什么一个“Memory Gateway”不能替代 Business Control Plane

即使企业拥有：

```text
central memory service
```

它仍然只是：

```text
Memory Control
```

而不是：

```text
Business Control
```

需要：

```text
Policy Service
Workflow
Case Store
Command Service
Domain APIs
```

共同完成业务控制。

---

# 143. Business State 的最终写入者应该非常少

推荐：

```text
Domain Service
```

或：

```text
Business Case Service
```

负责：

```text
write
validate
version
emit event
```

而：

```text
Agent
```

没有：

```text
direct DB write
```

权限。

这是：

> **Agent cannot independently break authorization**

原则的自然实现。

---

# 144. Memory 甚至可以采用 Eventually Consistent

例如：

```text
Agent Memory update
    async
```

没问题。

因为它只是：

```text
context optimization
```

但是：

```text
Business State
```

对于高风险 mutation：

```text
must revalidate
```

不能依赖最终一致 Memory。

---

# 145. 这使系统可以更容易水平扩展

多个 Runtime：

```text
Runtime A
Runtime B
Runtime C
```

都可以：

```text
load Case
```

然后得到：

```text
same authoritative business state
```

而各自拥有：

```text
different working memory
```

这样：

```text
Runtime scale-out
```

不会造成：

```text
business state divergence
```

---

# 146. Case State 也可以有 Cache

注意：

本文并不是要求：

```text
每次都直接查主库
```

而是：

```text
Business State
     ↓
cache / projection
     ↓
Agent
```

可以。

关键是：

```text
Cache != Authority
```

并且高风险操作：

```text
revalidate
```

AWS 对实时数据的建议也是：对于必须实时准确的数据，不应仅使用缓存，而应从 authoritative source 获取。

---

# 147. 一个推荐的“Freshness Contract”

Context Projection 可以携带：

```json
{
  "field": "riskScore",
  "value": 83,
  "source": "risk-system",
  "observedAt": "2026-09-19T10:10:00Z",
  "maxAgeSeconds": 300
}
```

Agent 可以看到：

```text
riskScore = 83
```

但：

```text
Command
```

执行前：

```text
if now - observedAt > maxAge:
    re-read authoritative source
```

这让 Agent Context 具有明确的数据新鲜度语义。

---

# 148. 推荐增加 `sourceOfTruth`

例如：

```json
{
  "value": "APPROVED",
  "sourceOfTruth": "compliance-service",
  "observedAt": "...",
  "version": 14
}
```

这样 Agent Context 不只是：

```text
value
```

而是：

```text
value + provenance + freshness
```

这非常适合金融业务。

---

# 149. Memory 中的事实最好保存 `evidenceRef`

例如：

```json
{
  "memory": "Compliance seems to have approved Proposal 1.",
  "evidenceRefs": [
    "approval:APR-123"
  ]
}
```

Agent 可以快速回忆。

但真正的：

```text
approval:APR-123
```

仍然来自：

```text
Approval Service
```

---

# 150. 这样 Memory 变成一个导航层

可以理解为：

```text
Memory:
    “去这里找真相。”
```

而不是：

```text
Memory:
    “我就是真相。”
```

这是一个很重要的 Agent Memory 设计思想。

---

# 151. 这种设计也更适合 Context Engineering

Anthropic 当前强调 Context Engineering：关键问题不是“Prompt 写什么”，而是“在当前采样时刻提供什么 Context 才最有助于正确行为”；其中包括 just-in-time retrieval、compaction、structured memory 等。

这其实进一步说明：

> Context 是给模型使用的信息集合，而不是企业 System of Record。

因此：

```text
Business State
    ↓
Context Engineering
    ↓
LLM
```

是更合理的方向。

---

# 152. Context 是“view”，不是“database”

这是本文最核心的技术抽象之一：

```text
Business Database
       ↓
Context View
       ↓
LLM
```

Context View 可以：

```text
filter
summarize
rank
compress
retrieve
```

而 Business Database：

```text
authoritative
structured
transactional
```

因此：

> **不要反过来让 Context 成为 Database。**

---

# 153. 最终可以定义三类数据

## A. Source Data

```text
Domain Records
External Systems
Documents
```

## B. Business State

```text
Case
Decision
Approval
Command
Workflow
```

## C. Agent Context

```text
Conversation
Working Memory
Long-term Memory
Summaries
Retrieved Context
```

方向永远应该是：

```text
A + B
   ↓
C
```

而不是：

```text
C
   ↓
A / B
```

除非经过明确的：

```text
Command / Promotion
```

---

# 154. 最终数据流

```text
                AUTHORITATIVE WORLD

   Domain Systems / Business Case / Decisions
                       │
                       ▼
              Context Projection
                       │
                Entitlement Filter
                       │
                       ▼
                Agent Context
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
 Conversation      Memory        Working State
        │              │              │
        └──────────────┼──────────────┘
                       ▼
                    LLM
                       │
                Recommendation
                       │
                       ▼
                  Policy / Review
                       │
                       ▼
                    Command
                       │
                       ▼
                    Domain
                       │
                       ▼
              AUTHORITATIVE WORLD'
```

这就是比较完整的闭环。

---

# 155. 对平台实现的最小要求

一个生产级 Agent Platform 至少应该能回答：

### Business State

```text
Where is the case?
Who owns it?
What is officially approved?
What is the current risk?
What is the business outcome?
```

### Workflow State

```text
Which node is running?
Which work is waiting?
What happens next?
```

### Runtime State

```text
Which Agent session is running?
What tools were called?
What is the current execution?
```

### Memory

```text
What context does the Agent remember?
What assumptions is it carrying?
What prior experience is it retrieving?
```

如果这些问题都来自同一个：

```text
state JSON
```

说明模型还没有分清楚。

---

# 156. 最重要的四条规则

可以压缩成：

```text
1. Memory may inform Business State, but never define it.

2. Business State may feed Memory, but Memory is only a projection.

3. Memory may propose a change, but only Command / Domain can commit it.

4. Clearing Memory must never erase Business Truth.
```

---

# 157. 再进一步，可以形成完整的职责矩阵

| 对象             | 谁写                     | 谁读                 | 谁决定其语义             | 能否直接产生业务副作用 |
| -------------- | ---------------------- | ------------------ | ------------------ | ----------- |
| Conversation   | User/Agent             | Runtime            | Conversation layer | 否           |
| Agent Memory   | Agent/Runtime          | Agent              | Runtime            | 否           |
| Workflow State | Workflow Runtime       | Control Plane      | Workflow Engine    | 间接          |
| Case State     | Domain / Case Service  | Control/Apps/Agent | Domain             | 间接          |
| Approval       | Human/Approval Service | Control            | Approval Policy    | 否           |
| Command        | Agent/System           | Control/Domain     | Command Policy     | 是，经授权       |
| Business Event | Domain                 | 全平台                | Domain             | 已发生         |
| Audit Evidence | Audit Service          | Audit/Compliance   | Governance         | 否           |

这个表基本可以作为架构评审的标准。

---

# 158. 一个非常强的测试：删掉 Memory

对于任何 Business Agent，可以做一个 Chaos Test：

```text
1. Delete all Agent Memory.
2. Restart Agent Runtime.
3. Reload Case.
4. Rebuild Context.
5. Continue Workflow.
```

正确系统应该：

```text
Business correctness preserved.
```

可能损失：

```text
Agent convenience
Agent familiarity
Some historical context
```

但不应该损失：

```text
approval
ownership
business status
audit
command safety
```

---

# 159. 第二个 Chaos Test：污染 Memory

故意写入：

```text
Memory:
    complianceApproved = true
```

实际上：

```text
Approval = PENDING
```

然后启动 Agent。

系统应该：

```text
Agent may initially misunderstand
        ↓
Control Plane rechecks
        ↓
Command denied / blocked
```

而不是：

```text
Memory says approved
        ↓
submit
```

这非常适合作为 Agent Security Test。

---

# 160. 第三个 Chaos Test：Runtime 替换

```text
Runtime A
    → memory exists

switch to Runtime B
```

检查：

```text
Case state unchanged
Workflow unchanged
Approval unchanged
Command policy unchanged
```

只有：

```text
agent context
```

发生变化。

这可以验证：

> Runtime / Business State 是否真正解耦。

---

# 161. 第四个 Chaos Test：Memory 完全不可用

```text
Memory Store = DOWN
```

系统应该至少：

```text
Business State still available
Workflow still recoverable
High-risk actions still controlled
```

Agent 可能进入：

```text
degraded mode
```

例如：

```text
cannot retrieve long-term memory
```

但不应该：

```text
Business Control unavailable
```

AWS 当前 Agent Reliability guidance 就要求 Memory/State 出现问题时进行 graceful degradation，并让系统清楚表达当前 degraded capability。

---

# 162. 最终建议的架构

```text
                         BUSINESS SYSTEM
                              │
             ┌────────────────┴────────────────┐
             │                                 │
             ▼                                 ▼
      Business State                      Evidence
             │                                 │
             └────────────────┬────────────────┘
                              │
                       Context Resolver
                              │
                    Authorization / Entitlement
                              │
                              ▼
                       Agent Runtime
              ┌───────────────┼───────────────┐
              │               │               │
          Session          Memory         Working State
              │               │               │
              └───────────────┼───────────────┘
                              │
                              ▼
                             LLM
                              │
                        Recommendation
                              │
                              ▼
                       Control Plane
                 ┌────────────┼────────────┐
                 │            │            │
              Policy      Human Review   Workflow
                 │            │            │
                 └────────────┼────────────┘
                              ▼
                           Command
                              │
                              ▼
                            Domain
                              │
                              ▼
                       Business State
```

---

# 163. 最后把它压缩成一句话

> **Agent Memory 是 Agent 的“工作记忆”，Business State 是企业的“正式事实”。**

因此：

```text
Memory can be wrong.
Business State cannot be allowed to depend on Memory being right.
```

更准确地说：

> **即使 Agent Memory 被删除、污染、压缩、过期、替换或完全不可用，企业仍然必须能够知道 Business Case 真实处于什么状态，以及什么操作被谁授权。**

这就是为什么：

```text
Business State
```

应该存在于：

```text
Domain / Business Case Store / Control Plane
```

而：

```text
Agent Memory
```

应该存在于：

```text
Runtime / Memory Layer
```

两者之间通过：

```text
Context Projection
+
Policy
+
Command
```

连接。

---

# 164. 与整个 Agent Architecture 系列的最终关系

到这里，前面的所有设计可以统一起来：

```text
                         BUSINESS CASE
                              │
                    ┌─────────┴─────────┐
                    │                   │
              Business State       Evidence
                    │
                    ▼
               CONTROL PLANE
      ┌─────────────┼─────────────┐
      │             │             │
   Workflow       Policy       Command
      │             │             │
      └─────────────┼─────────────┘
                    │
              Runtime Contract
                    │
                    ▼
               AGENT RUNTIME
      ┌─────────────┼─────────────┐
      │             │             │
   Session        Memory       Working State
      │             │             │
      └─────────────┼─────────────┘
                    ▼
                   LLM
```

最终形成一条非常清晰的关系：

```text
Business Case
    → What business are we handling?

Business State
    → What is actually true?

Workflow
    → Where are we in the process?

Policy
    → What is allowed?

Command
    → What mutation is being requested?

Agent Runtime
    → How should the work be done?

Agent Memory
    → What context helps the Agent do the work?

Evidence
    → What supports the conclusion?

Human Decision
    → Who is accountable?
```

这也是企业 Agent 与传统 Chatbot 最大的架构区别：

> **Chatbot 可以把“记住”当成体验；企业 Agent 不能把“记住”当成事实。**

---

## 参考资料

**AWS — Secure agent memory and state, Agentic AI Lens**
AWS 明确指出 Agent Memory 可能被植入虚假信息、影响 Agent 决策，因此应按 Session、User、Tenant、Agent、Group 等维度隔离，并实施完整性检查和 tamper-evident history。

**AWS — Agent memory and state management**
AWS 将 Memory Reliability 与 Workflow State / Checkpoint Recovery 明确分开，要求长期 Workflow 在阶段边界保存 Checkpoint，并在中断后从最近的有效状态恢复。

**AWS — Ground agents in real information**
AWS 明确指出对于需要实时准确的数据，缓存不能作为最终来源，应该从 authoritative source 获取，并将其作为 single source of truth。

**Microsoft Agent Framework — Checkpoints**
Checkpoint 保存 Workflow Executor 状态、pending messages、requests/responses 和 shared state，用于长期运行、暂停/恢复、迁移以及审计/合规场景。

**Microsoft Agent Framework — State**
Microsoft 将 Workflow State 作为多个 Executors 之间可共享的数据，并提供显式 State Scope 与访问机制。

**OpenAI Agents SDK — Sessions**
OpenAI Agents SDK 将 Session 明确定义为 Conversation History 的持久化层，用于跨多个 Agent Run 保持会话上下文。

**OpenAI Agents SDK — Context Management**
OpenAI 区分 RunContext、Conversation State、Session 和其他状态机制，并指出 LLM-visible context 应通过 input、instructions、tools、retrieval 等机制提供。

**Anthropic — Effective context engineering for AI agents**
Anthropic 将 Context Engineering 描述为围绕“当前运行需要哪些信息”进行系统化管理，并将 compaction、just-in-time retrieval、structured memory 等作为长上下文 Agent 的重要机制。

**Anthropic — Effective harnesses for long-running agents**
Anthropic 强调跨多个 context window 的长期 Agent 工作需要借助明确的 artifacts / structured handoff，而不是依赖单次 context 一直存在。

**LangGraph — Thinking in LangGraph**
LangGraph 将 State 定义为 Agent Nodes 共享的执行状态，强调保存 raw data、支持节点间共享、interrupt 和 durable execution。

**LangGraph — Time Travel / Checkpoints**
LangGraph checkpoint 保存具体执行状态，包括 values、tasks 和 next nodes，并支持恢复到具体 checkpoint。

**Salesforce — Agentforce Variables**
Salesforce 将结构化 Variables 作为短期 Agent Memory，用于 Action 输入输出和条件触发，以增强 Agent 行为的确定性。这说明 Agent Runtime 可以有结构化 State，但并不等价于 Business System of Record。

**Salesforce — Atlas Reasoning Engine**
Salesforce 将 Agent 的 State、Flow 和 Side Effects 区分开来，分别承担上下文、流程逻辑和对业务环境产生实际影响的职责。

**MemoryGraft, 2025**
研究展示了 Persistent Agent Memory Poisoning：攻击者可以把恶意经验植入长期 Memory，使后续相似任务检索到这些经验并发生持续行为漂移。

**Sleeper Memory Poisoning, 2026**
研究进一步展示了跨 Session、延迟触发的 Memory Poisoning，说明持久 Memory 本身可以成为长期攻击面。该研究属于近期学术预印本，应结合后续独立验证理解。

**Non-Malleable Memory Authority, 2026**
研究指出仅凭内容可信度或 Memory lineage 并不足以安全决定 Memory authority，并分析了 summarization、trusted-tool echo 等“authority laundering”路径。该工作同样属于近期预印本研究。

**BIS — In data we trust? 2026**
BIS 强调金融领域 AI 数据使用的核心问题包括数据隐私、质量、安全以及第三方依赖，并要求 AI 数据治理覆盖完整生命周期。

**BIS — AI in finance: what can change, what must never change, 2026**
BIS 强调金融机构仍需承担 AI-assisted decision 的责任，并强调数据治理、可解释性和机构治理的重要性。

**FSB — Sound Practices for Responsible Adoption of AI, 2026**
FSB 2026 年提出覆盖金融机构 AI 治理、生命周期风险管理、网络与第三方风险的 12 类 sound practices，并特别讨论 GenAI / Agentic AI 带来的新风险。

**FINRA — GenAI: Continuing and Emerging Trends, 2026**
FINRA 明确指出既有监督、通信、记录保存和公平交易等义务仍然适用于金融机构使用 GenAI 的场景。

---

## 最终架构原则

可以把全文最终压缩成下面这段，作为整个 Agent Architecture 文档系列的共用原则：

```text
Agent Memory:
    remembers.

Agent Runtime:
    reasons.

Workflow:
    progresses.

Policy:
    authorizes.

Command:
    requests mutation.

Domain:
    validates and commits.

Business State:
    tells the enterprise what is true.

Audit:
    proves what happened.
```

以及最重要的一条：

> **让 Agent Memory 可以不可靠，让 Business State 仍然可靠。**

这才是金融级 Agent 架构能够容忍模型错误、Memory Poisoning、Runtime 崩溃、Context Compaction、多 Agent 并发以及模型替换的根本原因。

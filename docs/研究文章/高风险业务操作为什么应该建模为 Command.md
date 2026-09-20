# 高风险业务操作为什么应该建模为 Command

在企业 Agent 系统里，最容易被低估的架构问题，不是“Agent 能不能调用工具”，而是：

> **当 Agent 准备做一件真正改变业务世界的事情时，系统究竟把什么东西当成“要执行的对象”？**

如果答案是：

```text
LLM
  ↓
Tool Call
  ↓
API
  ↓
业务系统
```

那么授权、审批、幂等、审计、数据版本、人工复核等职责很容易全部挤进 Tool 层，最后形成一种危险的模型：

```text
“模型决定调用哪个工具”
        ≈
“模型决定执行什么业务操作”
```

对于查询型工作，这未必是严重问题；但对于下单、转账、代理投票、发布正式研究结论、修改客户数据、关闭账户、变更权限等高风险业务操作，这种设计很难形成清晰、稳定、可验证的控制边界。

本文的核心主张是：

> **高风险业务操作应该从普通 Tool / Task 中分离出来，以显式的 Command 建模。**

这里的 Command 不是某一个行业监管标准中的固定术语，而是结合 CQRS / DDD、Agent 安全实践、金融业务控制以及当前大厂 Agent Framework 的演进后得到的一种架构归纳。

更准确地说：

```text
Tool
    = Agent 可以调用什么能力

Task
    = Agent 可以完成什么工作

Command
    = 系统准备对业务世界实施什么明确的状态变化

Approval
    = 谁允许这项 Command 发生

Workflow
    = Command 在什么业务流程中、什么条件下发生
```

这几个概念分开之后，Agent 的自主性仍然可以保留，但“自主性”不会直接等价于“业务执行权”。

---

# 1. 首先要区分：Tool、Task 和 Command 不是一回事

在传统应用里，很多业务系统直接把“调用接口”当成操作本身：

```text
POST /orders
POST /payments
POST /publish
```

在 Agent 系统里，Tool 又进一步把这些接口包装成：

```text
create_order(...)
send_payment(...)
publish_report(...)
```

于是看起来已经很合理：

```text
Agent
  ↓
Tool
  ↓
Business API
```

问题在于，Tool 描述的是**技术能力**，而不是完整的业务语义。

例如：

```text
submitTrade(...)
```

回答的是：

> 系统有没有一个接口可以提交交易？

但企业真正需要回答的是：

> 谁要求提交？
> 为哪个投资组合？
> 哪个证券？
> 什么数量？
> 什么价格限制？
> 当时依据的数据是什么？
> 哪些规则已经通过？
> 谁批准？
> 当前市场/业务对象版本还是不是原来那一版？
> 这次请求是否已经执行过？

这些信息已经远远超出了一个普通 Tool Call。

CQRS 的经典思想本身就是把“读取状态”和“改变状态”分开建模；Microsoft 的架构文档将 Command 描述为改变系统状态的责任，与 Query 的读取责任分离。微软关于 DDD/CQRS 应用层的实践也明确把 Command 作为一个对象，由 Command Handler 承担验证、加载 Aggregate、执行领域规则并完成事务。([Microsoft Learn][1])

所以从企业 Agent 架构角度，更自然的模型是：

```text
Task
  ↓
产生 Proposal / Candidate

Command
  ↓
表达明确的业务 Mutation Intent

Executor
  ↓
真正修改业务系统
```

Agent 负责提出“想做什么”，而不是天然拥有“把它做掉”的权力。

---

# 2. 为什么普通 Tool 在高风险操作上不够

真正的问题不是 Tool 这个技术形式不好，而是：

> **Tool 往往把“能力”和“执行权”绑定在了一起。**

例如给 Agent 一个：

```text
send_money(
    accountId,
    amount,
    currency
)
```

从模型角度，这是一个很漂亮的函数。

但从企业控制角度，它隐含了很多问题：

```text
谁允许 Agent 调用？
谁允许这个用户操作这个账户？
谁决定金额是否合理？
是否需要双人审批？
批准的是哪个金额？
审批后账户余额发生变化怎么办？
网络超时后重试会不会重复扣款？
执行结果写入审计了吗？
```

如果这些控制都写在 Tool 实现里面，Tool 就会越来越胖：

```text
Tool
 ├─ identity
 ├─ authorization
 ├─ business rule
 ├─ approval
 ├─ idempotency
 ├─ concurrency
 ├─ audit
 ├─ retry
 └─ actual execution
```

最后 Tool 已经不再是“工具”，而变成了一个隐式 Business Application Service。

更严重的是，同一个业务操作可能有多个入口：

```text
Agent Tool
Web UI
Batch Job
Trader UI
Workflow
API
```

如果只有 Agent 路径有这些控制，那么系统的真正业务控制面就被绑定到了 Agent。

高风险业务操作不应该依赖“调用它的人恰好是 Agent，因此这里多做一些安全检查”。

真正应该成为业务系统边界的是：

```text
Command
  ↓
Policy / Authorization
  ↓
Execution
```

这样无论 Command 来自：

```text
Agent
User
Workflow
Batch
External API
```

最终都进入同一条业务控制路径。

---

# 3. Agent 特有的问题：LLM 输出不能天然拥有执行权

这里是 Command 模型最重要的理由。

LLM 的输出可能受到很多非可信输入影响：

```text
User prompt
RAG document
Email
Web page
Tool result
MCP result
Memory
Other agent
Previous output
        ↓
     Context
        ↓
       LLM
        ↓
Tool Call / Structured Output
```

OWASP 将这种风险归纳为 Excessive Agency：当 LLM 被赋予过多功能、权限或自主性时，模型的错误、幻觉、直接或间接 Prompt Injection 都可能转化为真实的破坏性动作。([OWASP Gen AI Security Project][2])

AWS Agentic AI Lens 也明确要求：

> Tool invocation 必须在执行前经过外部、确定性的授权检查，而不是依赖 Agent 自己判断。

同时 AWS 将 high-risk mutating operations 作为应该进入 Human-in-the-loop checkpoint 的对象。([AWS Documentation][3])

OpenAI 对其 Agent 产品采取的实践也类似：对具有现实世界后果的动作要求显式用户确认，并对银行转账等更高风险任务采取更严格限制。([OpenAI][4])

因此：

```text
LLM Output
    ≠
Authorization

LLM Tool Call
    ≠
Approved Business Action

LLM Proposal
    ≠
Business Decision
```

中间必须存在一个能够被系统独立验证的对象。

这个对象就是 Command。

---

# 4. Command 的本质不是“函数”，而是“业务意图”

一个好的 Command，应该描述：

> **系统准备对哪个业务对象做什么改变。**

例如交易：

```json
{
  "commandType": "place_trade",
  "target": {
    "portfolioId": "P123",
    "securityId": "AAPL"
  },
  "parameters": {
    "side": "BUY",
    "quantity": 10000,
    "limitPrice": 220
  }
}
```

代理投票：

```json
{
  "commandType": "submit_proxy_vote",
  "target": {
    "meetingId": "M2026-0312",
    "securityId": "US000000"
  },
  "parameters": {
    "resolution": "FOR",
    "shares": 125000
  }
}
```

发布研究结论：

```json
{
  "commandType": "publish_research",
  "target": {
    "researchId": "R-2026-0312"
  },
  "parameters": {
    "version": "v7"
  }
}
```

这些对象都有一个重要特点：

> **它们可以在真正执行之前被完整描述、审查、比较、授权、哈希、审批和记录。**

这正是普通 Tool Call 不容易做到的地方。

---

# 5. Command 应该是“不可隐式变化”的对象

高风险业务里最重要的问题之一是：

> **批准的东西和最终执行的东西，是不是同一个东西？**

例如：

```text
Agent:
“提交 10,000 股 AAPL Buy”

        ↓

Human Approval:
“批准”

        ↓

实际执行：
50,000 股 AAPL Buy
```

如果系统只记录：

```text
approval = true
```

这条审批基本没有业务意义。

所以 Command 更适合被设计成一个明确、可比较的对象：

```text
Command
├─ type
├─ target
├─ parameters
├─ requester
├─ reason
├─ business context
├─ resource version
└─ timestamp
```

然后计算：

```text
Command
   ↓
Canonical Representation
   ↓
Hash
```

审批保存：

```text
approvedCommandHash
```

真正执行前重新计算：

```text
currentCommandHash
```

然后：

```text
currentHash === approvedHash
    ↓
继续
```

否则：

```text
重新审批
```

这不是为了给系统增加密码学装饰，而是为了把“**审批对象**”变成一个明确的业务实体。

---

# 6. Command 还解决另一个金融系统长期存在的问题：版本变化

高风险业务通常不是：

```text
Request
   ↓
Execute
```

而是：

```text
读取业务状态
   ↓
分析
   ↓
Proposal
   ↓
审批
   ↓
等待
   ↓
执行
```

在等待期间，业务状态可能已经改变。

例如：

```text
上午 10:00
Agent：
买入 10,000 股 AAPL

上午 10:02
Risk approval：
批准

上午 10:15
当前持仓 / 风控状态已经变化

上午 10:16
系统真正执行
```

如果批准只针对：

```text
“某个 Agent 想买 AAPL”
```

而不是针对：

```text
“在某个资源版本下，
以这些具体参数，
执行这条 Command”
```

那么审批实际上非常脆弱。

因此 Command 可以携带：

```text
resourceVersion
```

执行前：

```text
approved.resourceVersion
        ==
current.resourceVersion
```

如果不一致：

```text
重新验证 / 重新审批
```

这和传统并发控制思想是一致的，只不过在 Agent 系统里尤其重要，因为 Agent 会让“提出操作”和“真正执行”之间的时间窗口变长。

---

# 7. 为什么高风险 Command 必须拥有独立的 Authorization Boundary

最重要的一条边界是：

```text
Tool Authorization
    ≠
Business Command Authorization
```

Tool Policy 回答：

> Agent 能不能调用这个工具？

例如：

```text
read_file
web_search
query_portfolio
call_market_data
```

而 Command Policy 回答：

> 这个业务操作，现在能不能发生？

例如：

```text
place_trade
submit_proxy_vote
publish_research
send_external_message
close_account
change_beneficiary
```

这两个问题完全不同。

一个 Agent 可能：

```text
允许：
read_portfolio
query_market_data
```

但：

```text
禁止：
place_trade
```

即使它被允许调用某个交易工具，也仍然不代表：

```text
BUY 10,000 shares
```

已经获得业务授权。

AWS Agentic AI Lens 当前的安全模型正是沿着这个方向设计：工具调用需要外部授权、身份传播和参数约束；高风险 mutation 需要独立的人机检查点。([AWS Documentation][5])

---

# 8. 金融服务为什么特别需要这个边界

金融行业不是简单地“比较重视安全”。

它有一个更具体的问题：

> **很多业务操作本身就是受监督、受限额、受职责分离以及受记录要求约束的状态变化。**

SEC 的 Market Access Rule 就是很典型的例子。

SEC 明确指出，broker-dealer 必须建立风险管理控制和监督程序，用于在订单进入市场前系统性限制风险暴露；这些控制适用于手工订单，也适用于由计算机自动生成的订单，而且这些控制必须处在 firm 的直接和专属控制下，并定期复核。SEC 还特别指出，自动化错误可能快速累积，因此在订单进入市场之前进行控制非常重要。([SEC][6])

这对 Agent 架构有一个非常直接的启发：

```text
Agent generated order
        ↓
不能直接进入 market
```

而应该类似：

```text
Agent
  ↓
TradeCommand
  ↓
Pre-trade Policy
  ↓
Risk Controls
  ↓
Approval if required
  ↓
Execution Gateway
  ↓
Market
```

FINRA 2026 年的监管报告也继续强调订单处理的 supervision、系统与控制、持续监控，以及能够解释和提供相关分析证据。([FINRA][7])

这意味着：

> **在金融场景里，“执行一个业务操作”本身就已经是一个独立的治理对象。**

Command 只是把这个事实显式建模出来。

---

# 9. Command 的价值并不只是审批

如果把 Command 理解成：

```text
“等待用户点击 Approve 的 Tool”
```

就把它理解得太窄了。

审批只是 Command 生命周期中的一个可能环节。

一个完整的 Command 生命周期更接近：

```text
                    ┌───────────────┐
                    │ Agent / User  │
                    └───────┬───────┘
                            │
                            ▼
                     Command Proposal
                            │
                            ▼
                    Schema Validation
                            │
                            ▼
                   Identity / Entitlement
                            │
                            ▼
                     Policy Decision
                       /          \
                  denied          allowed
                                  │
                           ┌──────┴──────┐
                           │             │
                       auto-execute   approval
                           │             │
                           │         Human Decision
                           │             │
                           │          approved
                           │             │
                           └──────┬──────┘
                                  │
                                  ▼
                        Re-validate State
                                  │
                                  ▼
                           Idempotency Check
                                  │
                                  ▼
                           Command Executor
                                  │
                                  ▼
                         Business State Change
                                  │
                                  ▼
                            Audit Event
```

因此 Command 可以成为多个系统能力的共同锚点：

```text
Authorization
Approval
Audit
Idempotency
Concurrency
Versioning
Execution
```

---

# 10. Command 应该具备哪些最小属性

没有必要建立一个庞大的通用 Command 元模型。

高风险业务通常只需要一组比较稳定的核心字段：

| 字段                | 作用           |
| ----------------- | ------------ |
| `commandType`     | 表达业务动作       |
| `target`          | 表达作用对象       |
| `parameters`      | 表达具体业务参数     |
| `requestedBy`     | 谁提出          |
| `reason`          | 为什么提出        |
| `resourceVersion` | 提出/审批时基于哪个状态 |
| `commandHash`     | 锁定审批对象       |
| `idempotencyKey`  | 防止重复副作用      |
| `createdAt`       | 时间边界         |
| `expiresAt`       | 必要时限制授权有效期   |

其中几个字段尤其重要。

### `commandType`

不要让 Agent 自由生成：

```text
POST /api/*
```

或者：

```text
operation = whatever
```

而应该让它只能选择：

```text
submit_proxy_vote
place_trade
publish_research
close_account
```

这些都是服务端注册过的业务命令。

---

### `parameters`

参数应该是有 schema 的，而不是：

```json
{
  "instruction": "尽可能按照我的意思完成这件事"
}
```

对于：

```text
place_trade
```

应该是：

```json
{
  "side": "BUY",
  "quantity": 10000,
  "orderType": "LIMIT",
  "limitPrice": 220
}
```

这不是为了方便 LLM，而是为了让后续：

```text
Validation
Policy
Approval
Audit
```

都能针对结构化对象工作。

AWS Agentic AI Lens 特别强调，对模型生成的工具参数也要做 schema 和 policy 检查，不能假设“模型生成的参数天然可信”。([AWS Documentation][3])

---

# 11. Command Hash 为什么比“审批了这个 Tool”更可靠

错误的审批模型：

```text
Approve:
    submit_trade tool
```

这意味着：

```text
Tool 可以执行
```

但没有说明：

```text
执行什么交易
```

正确的审批对象应该是：

```text
Approve:
    Command #abc123
```

它具体对应：

```text
BUY
AAPL
10,000
LIMIT 220
Portfolio P123
Resource Version 781
```

那么审批记录就能成为一个明确的事实：

```text
谁批准了？
批准了什么？
批准的时候依据什么？
后来执行的是否还是同一个 Command？
```

这也是为什么 Command 更适合成为审计边界。

NIST AI RMF 强调 AI 系统的 accountability、human oversight、文档化和审计记录；其 Playbook 也明确建议保存 histories、audit logs，并记录 human oversight、override、escalation 和相关决策。([AIRC][8])

---

# 12. Command Idempotency：这是 Agent 系统特别容易漏掉的一层

传统同步请求：

```text
request
  ↓
response
```

比较容易理解。

Agent 系统经常是：

```text
Agent
  ↓
Tool
  ↓
External API
  ↓
timeout
  ↓
Agent thinks it failed
  ↓
retry
```

如果操作有副作用，就可能变成：

```text
第一次：
wire transfer $1,000

第二次 retry：
wire transfer $1,000
```

因此 Command 最好天然携带：

```text
idempotencyKey
```

业界成熟支付 API 已长期使用这种模式。例如 Stripe 的 API 使用 idempotency key 防止网络错误后的重试产生第二次创建或更新，并且要求相同 key 对应同一请求参数。([Stripe Docs][9])

在 Agent 架构里，Command 可以非常自然地成为这个 idempotency boundary：

```text
Command
   ↓
Canonical Hash
   ↓
idempotencyKey
   ↓
Executor
```

这样：

```text
same Command
    +
same idempotencyKey
```

才能安全地恢复。

---

# 13. 为什么 Command Executor 不应该等于 Agent Tool

这是实现层非常重要的一条边界。

建议结构：

```text
Agent Tool
    ↓
Propose Command
    ↓
Command Service
    ↓
Policy
    ↓
Approval
    ↓
Command Executor
    ↓
Domain API / External System
```

而不是：

```text
Agent Tool
    ↓
Command Executor
```

因为 Executor 应该是一个**不信任 Agent 的业务执行组件**。

它应该假设：

```text
Command 可能来源于 Agent
Command 可能被篡改
Command 可能过期
Command 可能已经执行
Command 可能没有当前授权
```

因此：

```text
Executor
```

最后仍然要重新验证：

```text
hash
authorization
resourceVersion
idempotency
```

这实际上与传统 DDD 的 Command Handler / domain model boundary 是相容的。微软关于 DDD/CQRS 的实现指导明确将 Command 作为输入对象，在处理时验证 Command、加载 Aggregate、执行领域规则并在事务中持久化状态。([Microsoft Learn][10])

---

# 14. Command 和 Workflow 的关系

另一个常见错误是：

```text
Workflow
    =
Command
```

它们实际上是不同层。

例如代理投票：

```text
Workflow

1. 拉取会议资料
2. 获取投资组合持仓
3. 分析议案
4. 生成投票建议
5. Compliance Review
6. PM Review
7. Submit Proxy Vote
```

这里：

```text
1-4
```

可能主要是 Task。

```text
5-6
```

是 Review。

```text
7
```

才是：

```text
Command
```

所以 Workflow 是：

```text
“什么时候做什么”
```

而 Command 是：

```text
“真正准备改变哪个业务状态”
```

一个 Workflow 可以包含多个 Command：

```text
Workflow
 ├─ Task
 ├─ Gate
 ├─ Review
 ├─ Command
 ├─ Task
 ├─ Review
 └─ Command
```

同样，一个 Command 也可能被多个 Workflow 使用：

```text
                    ┌─ Proxy Voting Workflow
submit_proxy_vote ──┼─ Manual Operations Workflow
                    └─ Exception Workflow
```

这也是为什么 Command 不应该嵌在某个特定 Workflow 里。

它是业务动作本身。

---

# 15. Command 和 Approval 也不是一回事

这两个概念经常被混淆。

错误模型：

```text
Approval
    ↓
“批准这个流程”
```

更准确的是：

```text
Approval
    ↓
批准某个特定 Command
```

例如：

```text
Review:
    Compliance approves proxy vote

Command:
    submit_proxy_vote
    security=AAPL
    resolution=FOR
    shares=125000
```

真正批准的是：

```text
这个具体操作
```

而不是：

```text
“这个流程整体看起来没问题”
```

这一区别非常重要，因为审批应当绑定到一个不可隐式变化的对象。

---

# 16. Command 和 Agent Proposal 也不是一回事

Agent 可以提出：

```text
Proposal
```

例如：

```text
建议：
对提案 3 投 FOR
因为：
公司治理风险较低
```

但这还不是业务 Command。

可以形成这样的分层：

```text
Agent Proposal
    ↓
Human / Policy Decision
    ↓
Command
    ↓
Execution
```

或者在系统中直接把 Proposal 结构化成：

```text
CommandIntent
```

但必须明确：

> **Agent 生成的是 Candidate，服务端确认后才成为可执行的 Command。**

这样就不会把：

```text
LLM JSON Schema valid
```

错误地理解为：

```text
Business command authorized
```

OWASP 对 LLM 输出和 excessive agency 的安全分析恰好说明了为什么不能这样推导。([OWASP Gen AI Security Project][2])

---

# 17. 高风险 Command 最好有分级，而不是所有操作都一样

不是所有业务写操作都需要双人审批。

AWS 当前 Agentic AI Lens 也建议根据风险进行分级，把动作区分为 autonomous、notify 和 approve 三类；高风险或不可逆操作进入明确的审批路径。([AWS Documentation][11])

因此 Command 可以简单分为：

```text
Tier 1 — Low Risk
    自动执行

Tier 2 — Controlled
    自动执行 + 记录 / 通知

Tier 3 — High Risk
    人工审批

Tier 4 — Critical
    多人审批 / Maker-Checker / 特殊流程
```

例如：

| Command                     | 风险示例 | 典型控制                                   |
| --------------------------- | ---- | -------------------------------------- |
| `refresh_market_data`       | 低    | 自动                                     |
| `create_internal_draft`     | 低    | 自动                                     |
| `publish_external_research` | 中高   | Review                                 |
| `submit_proxy_vote`         | 高    | Approval                               |
| `place_trade`               | 高    | Policy + pre-trade controls + Approval |
| `wire_transfer`             | 很高   | 强身份 + 多重授权 + Approval                  |
| `change_entitlement`        | 很高   | SoD + Approval                         |

这里需要特别强调：

> **Command 化不等于“一律人工审批”。**

Command 是为了建立业务执行边界，不是为了让所有自动化重新变成人工操作。

---

# 18. Maker-Checker 为什么天然适合 Command

金融业务中经常存在职责分离：

```text
Maker
    ↓
提出操作

Checker
    ↓
批准操作
```

如果业务对象是一个显式 Command，那么这个过程就很自然：

```text
Command #1234
    │
    ├─ requestedBy = Alice
    ├─ commandHash = abc123
    ├─ status = PENDING_APPROVAL
    │
    └─ Approval
          └─ Bob → APPROVED
```

而不是：

```text
Alice
  ↓
Agent
  ↓
Tool
  ↓
“等待一下用户”
```

后者很难稳定形成：

```text
是谁提出
是谁审批
审批的是什么
审批后有没有改变
执行结果是什么
```

AWS 也明确建议高风险 Agent 操作采用独立的人机审查点，并在权限模型中区分 Agent 与 Human identity。([AWS Documentation][5])

---

# 19. Command 还应该成为 Audit Evidence 的锚点

传统系统可能只记录：

```text
2026-09-20 10:31
user=alice
action=submit
status=success
```

但 Agent 系统真正需要的是：

```text
Who initiated?
Which agent?
Which command?
Which resource?
Which parameters?
Which data version?
Which policy?
Which approver?
Which approval decision?
Which executor?
Which external system?
What changed?
```

Command 可以成为这些记录的共同关联键：

```text
Execution
    ↓
Command
    ↓
Approval
    ↓
Execution Result
    ↓
Business State Change
```

而不是让审计依赖：

```text
LLM transcript
```

或：

```text
Agent trace
```

FSB 关于 AI 在金融体系中的研究强调，AI 带来的风险包括模型风险、数据质量与治理、网络风险以及第三方依赖等，而且这些风险可能放大金融系统的脆弱性。([Financial Stability Board][12])

FINRA 对 GenAI 的监管观察也明确指出，GenAI 的使用可能涉及 supervision、communications、recordkeeping 等既有监管义务。([FINRA][13])

因此：

> **Agent Trace 可以解释 Agent 怎么运行；Command Record 更接近解释业务为什么发生。**

这两者不应该混为一谈。

---

# 20. 一个比较合理的整体架构

综合前面的原则，一个企业 Agent 系统可以采用：

```text
                         ┌───────────────┐
                         │      User     │
                         └───────┬───────┘
                                 │
                                 ▼
                         ┌───────────────┐
                         │     Agent     │
                         │ reasoning     │
                         │ proposal      │
                         └───────┬───────┘
                                 │
                         Tool / Function Call
                                 │
                                 ▼
                       ┌────────────────────┐
                       │ Command Proposal   │
                       │                    │
                       │ type               │
                       │ target             │
                       │ parameters         │
                       │ requester          │
                       │ reason             │
                       └─────────┬──────────┘
                                 │
                                 ▼
                    ┌─────────────────────────┐
                    │ Validation              │
                    │ Schema / Semantic Check │
                    └───────────┬─────────────┘
                                │
                                ▼
                    ┌─────────────────────────┐
                    │ Authorization / Policy  │
                    │ Identity                │
                    │ Data Entitlement        │
                    │ Action Authorization    │
                    └───────────┬─────────────┘
                                │
                     ┌──────────┴──────────┐
                     │                     │
                 denied                 approved?
                                           │
                                  ┌────────┴────────┐
                                  │                 │
                               auto             human review
                                  │                 │
                                  │              approved
                                  │                 │
                                  └────────┬────────┘
                                           │
                                           ▼
                                  Re-validation
                                  ├ commandHash
                                  ├ resourceVersion
                                  ├ authorization
                                  └ idempotency
                                           │
                                           ▼
                                  ┌─────────────────┐
                                  │ Command Executor│
                                  └───────┬─────────┘
                                          │
                                          ▼
                                Domain API / Gateway
                                          │
                                          ▼
                                  External System
                                          │
                                          ▼
                                   Business State
                                          │
                                          ▼
                                     Audit Event
```

这套架构有一个很重要的特征：

> **Agent 永远不是最终 mutation boundary。**

最终 mutation boundary 是：

```text
Command Executor
```

而 Executor 之前还有：

```text
Authorization
Approval
Validation
Version Check
Idempotency
```

---

# 21. Command Registry 是不是必要？

建议有，但可以非常简单。

不需要做一个通用插件平台。

最基础的形式就可以是：

```text
CommandRegistry

place_trade
submit_proxy_vote
publish_research
send_external_message
close_account
```

每个 Command 至少注册：

```text
commandType
schema
authorization policy
approval policy
executor
```

例如：

```ts
registerCommand({
  commandType: "submit_proxy_vote",

  schema: proxyVoteSchema,

  policy: proxyVotePolicy,

  approval: {
    required: true,
    roles: ["portfolio_manager", "operations"]
  },

  executor: submitProxyVote
});
```

这样 Skill / Agent 不需要知道：

```text
AD Group
OAuth scope
database table
internal API URL
secret
```

它只需要知道：

```text
submit_proxy_vote
```

这也符合 AWS 对工具注册、版本、权限、审查和生命周期治理的方向。AWS Agentic AI Lens 建议建立受治理的 Tool Registry，并将授权与工具治理放在服务端边界，而不是依赖 Agent 自己判断。([AWS Documentation][3])

---

# 22. Command 不应该包含什么

为了避免 Command 再次变成“大杂烩”，有几类信息最好不要塞进去。

### 不要把完整 Agent Memory 放进去

```text
Command
  ❌ conversation history
  ❌ scratchpad
  ❌ chain-of-thought
  ❌ model reasoning
```

Command 是业务事实的候选执行对象，不是 Agent 的工作记忆。

---

### 不要把 Workflow State 全塞进去

```text
Command
  ❌ 当前 workflow 所有节点
  ❌ 所有历史 Task
  ❌ 所有 conversation
```

Command 只需要与本次业务动作相关的上下文。

---

### 不要把 Authorization 结果写成 Agent 自己给出的字段

例如不要：

```json
{
  "approved": true,
  "riskLevel": "low"
}
```

然后相信 Agent。

应该：

```text
Command
   ↓
Server Policy
   ↓
Authorization Result
```

因为：

```text
LLM Output
    ≠
Authorization
```

AWS 也明确指出仅依赖 Prompt 中的授权指示是不够的，授权应该由外部确定性机制执行。([AWS Documentation][5])

---

# 23. Command 并不等于 Event

另一个常见混淆是：

```text
Command
Event
```

实际上：

```text
Command
    = 希望发生什么

Event
    = 已经发生什么
```

例如：

```text
Command:
submit_proxy_vote
```

执行成功之后：

```text
Event:
proxy_vote_submitted
```

或者：

```text
Command:
place_trade
```

执行结果：

```text
Event:
trade_order_submitted
```

因此：

```text
Command
    ↓
Execution
    ↓
Event
```

是更清晰的模型。

Command 是：

```text
intent
```

Event 是：

```text
fact
```

这个区别对于审计尤其重要。

---

# 24. 为什么不应该直接把 POST API 当作 Command

从 HTTP 层来看：

```text
POST /api/orders
```

已经是一个写操作。

但架构上仍然不能简单认为：

```text
HTTP POST = Command
```

因为 HTTP 是：

```text
transport protocol
```

Command 是：

```text
business semantic
```

例如：

```text
POST /api/orders
```

到底表示：

```text
CreateDraftOrder
SubmitOrder
AmendOrder
CancelOrder
RetryOrder
```

HTTP URL 不应该承担完整业务语义。

Command 则应该明确表达：

```text
SubmitTradeOrder
CancelTradeOrder
AmendTradeOrder
```

因此：

```text
HTTP Request
    ↓
Command DTO
    ↓
Command Handler
```

是更稳定的边界。

---

# 25. 什么情况下不需要专门建 Command

这同样重要。

不是所有 Tool 都需要 Command。

以下操作通常没必要过度设计：

```text
get_market_price()
search_research()
retrieve_document()
calculate_exposure()
list_positions()
summarize_report()
extract_entities()
```

它们主要是：

```text
read
compute
retrieve
transform
```

即使内部存在缓存、分页或者数据库访问，也不需要强行变成 Command。

真正值得建 Command 的特征是：

```text
会改变 Business State
        +
具有业务副作用
        +
需要明确授权
        +
可能需要审批
        +
需要保证不可重复/可追踪
```

因此：

```text
write database row
```

本身未必是高风险 Command。

但：

```text
change customer entitlement
```

明显属于高风险 Command。

关键不是：

> “它是不是数据库写操作？”

而是：

> **“它是不是一个需要被业务治理的明确状态变化？”**

---

# 26. 一个简单的判断标准

可以把这个问题收敛成五个问题。

如果答案大部分是“是”：

```text
1. 它是否改变业务状态？
2. 它是否可能产生不可逆或昂贵的副作用？
3. 它是否需要明确授权？
4. 它是否可能需要人工审批或职责分离？
5. 系统是否需要知道“到底执行了哪个具体动作”？
```

那么更适合：

```text
Command
```

而不是：

```text
普通 Agent Tool
```

可以进一步用一个非常简单的边界图：

```text
                 Does it change business state?
                            │
                    ┌───────┴───────┐
                   No              Yes
                    │                │
                  Tool          Is impact significant?
                                     │
                              ┌──────┴──────┐
                             No             Yes
                              │               │
                          Simple write      Command
                                              │
                                    Authorization / Policy
                                              │
                                      Approval if required
                                              │
                                            Execute
```

---

# 27. 最小实现，不需要一个巨大的 Command Framework

一个企业 Agent 平台完全可以从一个很小的实现开始：

```text
CommandIntent
CommandRegistry
CommandService
CommandExecutor
```

### `CommandIntent`

```ts
interface CommandIntent {
  commandType: string;

  target: {
    type: string;
    id: string;
  };

  parameters: Record<string, unknown>;

  requestedBy: {
    tenantId: string;
    userId: string;
  };

  reason?: string;

  resourceVersion?: string;

  createdAt: string;
}
```

### `CommandService`

负责：

```text
validate
authorize
classify risk
create approval
verify hash
verify resourceVersion
execute
```

### `CommandExecutor`

只负责：

```text
真正调用 Domain API / External API
```

并接收：

```text
executionId
idempotencyKey
actor
```

然后真正的业务系统继续自己执行领域规则。

这与微软 DDD/CQRS 所描述的 Command Handler 思路是一致的：Command 进入应用层后，经过验证，驱动目标 Aggregate / Domain Model，最终通过事务改变业务状态。([Microsoft Learn][10])

---

# 28. 最重要的架构边界

最终可以把整个 Agent 系统压缩成一句话：

```text
Agent decides what it proposes.
Policy decides what is allowed.
Human decides what requires human judgment.
Command defines what will change.
Executor decides how the change is performed.
Business system remains the source of truth.
```

或者用更适合金融系统的一组不变量表示：

```text
Agent can reason
    but cannot independently authorize.

Agent can propose
    but cannot define enterprise security boundary.

Tool can access capability
    but capability is not business authorization.

Approval authorizes a specific Command
    not a vague future action.

Command can execute
    only after re-validation.

Execution can retry
    only with idempotency protection.

Business State remains in the business system
    not in Agent Memory.

Audit records what actually happened
    not merely what the model intended.
```

---

# 29. 最终结论

“高风险业务操作应该建模为 Command”并不是因为 Command 这个名字本身更先进，也不是因为金融系统必须采用 CQRS。

真正原因是：

> **高风险业务操作需要一个独立于 LLM、Tool、Conversation 和 Workflow 的稳定业务边界。**

这个边界需要同时承载：

```text
Business Intent
Authorization
Approval
Version
Idempotency
Execution
Audit
```

如果这些信息只存在于：

```text
Prompt
Tool Call
LLM Output
Workflow Memory
```

它们就很容易随着 Agent 的推理过程发生变化，也难以被外部系统独立验证。

而显式 Command 可以把过程变成：

```text
LLM Proposal
      ↓
Command
      ↓
Policy
      ↓
Approval
      ↓
Re-validation
      ↓
Execution
      ↓
Business State
      ↓
Audit
```

对于金融服务而言，这种分离尤其重要。监管框架并没有规定“金融 Agent 必须使用 Command Pattern”——这是一个架构归纳，而不是监管条文；但现有金融控制实践、AI 风险管理框架以及当前 AWS、Microsoft、OpenAI 等 Agent 平台的安全设计，都越来越强调同一个基本事实：**模型的推理能力与真正的业务执行权限应该处在不同的控制边界上。** ([AIRC][8])

因此，一个成熟的企业 Agent 平台不应该把：

```text
Tool = Action
```

作为默认假设。

更合理的模型是：

```text
Tool      = Capability
Task      = Work
Proposal  = Candidate
Command   = Authorized Business Mutation
Approval  = Human / Policy Decision
Executor  = Controlled Side Effect
Event     = Business Fact
```

而对于高风险金融业务，最值得守住的那条线是：

```text
LLM 可以提出 Command
        ↓
但只有业务系统自己的 Command Boundary
才能决定它是否真正改变世界。
```

---

# 参考资料

### Agent 安全与高风险操作

**AWS Well-Architected Agentic AI Lens — Secure agent tool usage**
明确要求工具调用在执行前进行外部授权，并指出高风险 mutation 应进入 human-in-the-loop checkpoint。([AWS Documentation][3])
[AWS Agentic AI Lens — Secure agent tool usage](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentsec02.html?utm_source=chatgpt.com)

**AWS Agentic AI Lens — Agent identity and permission management**
强调 Agent identity 与 Human identity 分离、最小权限以及用户上下文传播。([AWS Documentation][14])
[AWS Agent identity and permission management](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentsec03.html?utm_source=chatgpt.com)

**AWS Agentic AI Lens — Tiered human oversight and approval workflows**
将 Agent 行为按照风险进行分级，并建议高风险/不可逆操作使用显式审批。([AWS Documentation][11])
[AWS tiered human oversight and approval workflows](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentrel02-bp05.html?utm_source=chatgpt.com)

**OWASP GenAI Security — LLM06:2025 Excessive Agency**
讨论过多功能、过多权限、过多自主性如何把模型错误或 Prompt Injection 转化成真实副作用。([OWASP Gen AI Security Project][2])
[OWASP LLM06:2025 Excessive Agency](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/?utm_source=chatgpt.com)

**OpenAI — Introducing ChatGPT agent**
描述现实世界副作用、显式确认、高风险操作限制以及 Prompt Injection 风险。([OpenAI][4])
[OpenAI — Introducing ChatGPT agent](https://openai.com/index/introducing-chatgpt-agent/?utm_source=chatgpt.com)

**OpenAI — Computer-Using Agent**
描述在提交订单、发送邮件等具有外部副作用的动作前要求用户确认，以及对银行交易等高风险任务的限制。([OpenAI][15])
[OpenAI — Computer-Using Agent](https://openai.com/index/computer-using-agent/?utm_source=chatgpt.com)

### Agent Framework / Human-in-the-loop

**Microsoft Agent Framework — Tool Approval**
展示工具执行前的人工批准机制，以及批准请求与 Tool Call 参数绑定的方式。([Microsoft Learn][16])
[Microsoft Agent Framework — Tool approval](https://learn.microsoft.com/en-us/agent-framework/agents/tools/tool-approval?utm_source=chatgpt.com)

**Microsoft Agent Framework — Human-in-the-loop Workflows**
展示 Workflow 在等待人工请求时暂停、保存 pending request 并在恢复后继续执行的机制。([Microsoft Learn][17])
[Microsoft Agent Framework — Human-in-the-loop workflows](https://learn.microsoft.com/en-us/agent-framework/workflows/human-in-the-loop?utm_source=chatgpt.com)

### CQRS / DDD / Command

**Microsoft Azure Architecture Center — CQRS Pattern**
定义 Command 与 Query 的职责分离，并说明 Command 负责改变系统状态。([Microsoft Learn][1])
[Microsoft — CQRS Pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/cqrs?utm_source=chatgpt.com)

**Microsoft Learn — Implementing the application layer using Web API / DDD + CQRS**
说明 Command Object、Command Handler、Aggregate 与事务之间的关系。([Microsoft Learn][10])
[Microsoft — DDD / CQRS application layer](https://learn.microsoft.com/dotnet/architecture/microservices/microservice-ddd-cqrs-patterns/microservice-application-layer-implementation-web-api?utm_source=chatgpt.com)

### 金融服务与监管控制

**SEC — Rule 15c3-5 Risk Management Controls FAQ**
要求 market access 场景实施 pre-trade 和其他风险控制，并明确这些控制适用于手工和自动生成的订单。([SEC][6])
[SEC — Rule 15c3-5 risk management controls](https://www.sec.gov/files/faq-15c-5-risk-management-controls-bd.htm?utm_source=chatgpt.com)

**FINRA — 2026 Regulatory Oversight Report: Customer Order Handling / Best Execution**
涉及订单监督、系统控制、持续监控以及对执行分析和程序的证明要求。([FINRA][7])
[FINRA — Customer Order Handling / Best Execution](https://www.finra.org/rules-guidance/guidance/reports/2026-finra-annual-regulatory-oversight-report/best-execution?utm_source=chatgpt.com)

**FINRA — 2026 Regulatory Oversight Report: GenAI**
指出 GenAI 的使用可能涉及 supervision、communications、recordkeeping 等既有义务。([FINRA][13])
[FINRA — 2026 Regulatory Oversight Report](https://www.finra.org/media-center/newsreleases/2025/finra-publishes-2026-regulatory-oversight-report-empower-member-firm?utm_source=chatgpt.com)

**FSB — The Financial Stability Implications of Artificial Intelligence**
讨论金融机构采用 AI 后的模型风险、数据治理、网络风险、第三方依赖及系统性风险问题。([Financial Stability Board][12])
[FSB — The Financial Stability Implications of AI](https://www.fsb.org/2024/11/the-financial-stability-implications-of-artificial-intelligence/?utm_source=chatgpt.com)

**FSB — Monitoring Adoption of AI and Related Vulnerabilities in the Financial Sector**
进一步讨论 AI 供应链、第三方依赖和金融系统治理风险。([Financial Stability Board][18])
[FSB — Monitoring adoption of AI](https://www.fsb.org/2025/10/monitoring-adoption-of-artificial-intelligence-and-related-vulnerabilities-in-the-financial-sector/?utm_source=chatgpt.com)

**BIS / Basel Committee — Operational resilience**
将 governance、critical operations 和风险容忍度作为金融机构 operational resilience 的核心组成部分。([Bank for International Settlements][19])
[BIS — Operational resilience](https://www.bis.org/committees/bcbs/basel-consolidated-guidelines/module/orr/20.htm?utm_source=chatgpt.com)

### AI 风险管理与审计

**NIST AI RMF Core**
强调 governance、accountability、human oversight、风险管理、文档与持续评估。([AIRC][8])
[NIST AI RMF Core](https://airc.nist.gov/airmf-resources/airmf/5-sec-core/?utm_source=chatgpt.com)

**NIST AI RMF Playbook**
建议维护历史、审计日志、human oversight、override、escalation 和责任记录。([AIRC][20])
[NIST AI RMF Playbook](https://airc.nist.gov/docs/AI_RMF_Playbook.pdf?utm_source=chatgpt.com)

### Idempotency

**Stripe — Idempotent Requests**
展示通过 idempotency key 防止重试产生重复副作用的成熟 API 实践。([Stripe Docs][9])
[Stripe — Idempotent requests](https://docs.stripe.com/api/idempotent_requests?utm_source=chatgpt.com)

[1]: https://learn.microsoft.com/en-us/azure/architecture/patterns/cqrs?utm_source=chatgpt.com "CQRS Pattern - Azure Architecture Center | Microsoft Learn"
[2]: https://genai.owasp.org/llmrisk/llm062025-excessive-agency/?utm_source=chatgpt.com "LLM06:2025 Excessive Agency - OWASP Gen AI Security Project"
[3]: https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentsec02.html?utm_source=chatgpt.com "Secure agent tool usage - Agentic AI Lens"
[4]: https://openai.com/index/introducing-chatgpt-agent/?utm_source=chatgpt.com "Introducing ChatGPT agent: bridging research and action | OpenAI"
[5]: https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentsec02-bp01.html?utm_source=chatgpt.com "AGENTSEC02-BP01 Implement tool authorization - Agentic AI Lens"
[6]: https://www.sec.gov/files/faq-15c-5-risk-management-controls-bd.htm?utm_source=chatgpt.com "SEC.gov | Responses to Frequently Asked Questions Concerning Risk Management Controls for Brokers or Dealers with Market Access"
[7]: https://www.finra.org/rules-guidance/guidance/reports/2026-finra-annual-regulatory-oversight-report/best-execution?utm_source=chatgpt.com "Customer Order Handling: Best Execution and Order Routing Disclosures | FINRA.org"
[8]: https://airc.nist.gov/airmf-resources/airmf/5-sec-core/?utm_source=chatgpt.com "AI RMF Core - AIRC"
[9]: https://docs.stripe.com/api/idempotent_requests?...=&utm_source=chatgpt.com "Idempotent requests | Stripe API Reference"
[10]: https://learn.microsoft.com/he-il/%20dotnet/architecture/microservices/microservice-ddd-cqrs-patterns/microservice-application-layer-implementation-web-api?utm_source=chatgpt.com "Implementing the microservice application layer using the Web API - .NET | Microsoft Learn"
[11]: https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentrel02-bp05.html?utm_source=chatgpt.com "AGENTREL02-BP05 Establish tiered human oversight and approval workflows - Agentic AI Lens"
[12]: https://www.fsb.org/2024/11/the-financial-stability-implications-of-artificial-intelligence/?utm_source=chatgpt.com "The Financial Stability Implications of Artificial Intelligence - Financial Stability Board"
[13]: https://www.finra.org/media-center/newsreleases/2025/finra-publishes-2026-regulatory-oversight-report-empower-member-firm?utm_source=chatgpt.com "FINRA Publishes 2026 Regulatory Oversight Report to Empower Member Firm Compliance | FINRA.org"
[14]: https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentsec03.html?utm_source=chatgpt.com "Agent identity and permission management - Agentic AI Lens"
[15]: https://openai.com/index/computer-using-agent/?utm_source=chatgpt.com "Computer-Using Agent | OpenAI"
[16]: https://learn.microsoft.com/en-us/agent-framework/agents/tools/tool-approval?utm_source=chatgpt.com "Using function tools with human in the loop approvals | Microsoft Learn"
[17]: https://learn.microsoft.com/en-us/agent-framework/workflows/human-in-the-loop?utm_source=chatgpt.com "Microsoft Agent Framework Workflows - Human-in-the-loop (HITL) | Microsoft Learn"
[18]: https://www.fsb.org/2025/10/monitoring-adoption-of-artificial-intelligence-and-related-vulnerabilities-in-the-financial-sector/?utm_source=chatgpt.com "Monitoring Adoption of Artificial Intelligence and Related Vulnerabilities in the Financial Sector - Financial Stability Board"
[19]: https://www.bis.org/committees/bcbs/basel-consolidated-guidelines/module/orr/20?utm_source=chatgpt.com "Operational resilience | Bank for International Settlements"
[20]: https://airc.nist.gov/docs/AI_RMF_Playbook.pdf?trk=public_post_comment-text&utm_source=chatgpt.com "AI RMF
AI RMF
PLAYBOOK
PLAYBOOK"


---------


# 高风险业务操作为什么应该建模为 Command，以及如何建模

在 AI Agent 进入金融服务生产环境以后，一个非常容易被低估的架构问题是：

> Agent 最终要“做一件事情”时，到底应该直接调用一个 Tool，还是先把这件事情建模成一个独立的业务 Command？

例如：

```text
Agent
  ↓
submitOrder(...)
```

看起来非常自然。

但一旦进入真实金融业务，这个 `submitOrder()` 背后实际上包含了大量问题：

```text
谁发起？
替谁发起？
为什么发起？
针对哪个客户？
针对哪个账户？
针对哪个资产？
数量是多少？
当前状态是否允许？
当前权限是否允许？
风险限额是否允许？
是否需要审批？
审批时看到的参数与现在是否一致？
重复执行怎么办？
下游已经成功但上游超时怎么办？
最终业务状态是什么？
事后如何证明是谁批准、谁执行、执行了什么？
```

如果这些问题最终全部隐藏在一个 Tool Call 后面：

```text
tool = submitOrder
arguments = {...}
```

那么 Agent 的“推理”与企业真正的“业务动作”之间几乎没有结构化边界。

这在普通软件里已经是一个值得警惕的设计，在金融服务领域更危险。

AWS 当前的 Agentic AI Lens 明确要求：Agent 的 Tool Invocation 应在执行前通过外部、确定性的授权策略检查；高风险的 mutating operation 应通过人类监督或其他明确控制；权限应限制在 Agent 完成工作所需的最小范围。

这并不意味着 AWS 或任何监管机构要求企业必须采用名为“Command”的对象。更准确地说，**Command 是一种很适合把“Agent 提出的业务意图”和“企业最终允许发生的业务状态变化”分开的架构模式**。它建立在 CQRS、DDD、任务型业务建模和金融风险控制等已有思想之上。Microsoft 的 CQRS 指南明确建议 Command 表示具体的业务任务，而不是底层数据字段更新；例如使用“Book hotel room”，而不是“Set ReservationStatus = Reserved”。

本文讨论的重点不是“Command 这个名字是否标准”，而是一个更重要的问题：

> **为什么 Agent 的高风险业务操作不应该直接等同于 Tool Call，以及如何把它建模成一个可以授权、审批、校验、重试、审计和执行的业务对象。**

---

# 一、先给结论：Tool 是能力，Command 是业务动作

最简单的区分是：

```text
Tool
=
Agent 可以调用什么能力

Command
=
Agent 想让业务系统发生什么变化
```

例如：

```text
Tool:
portfolio.read

Command:
CreateRebalanceProposal
```

或者：

```text
Tool:
order.prepare

Command:
SubmitCustomerOrder
```

或者：

```text
Tool:
proxyVote.submit

Command:
CastProxyVote
```

二者不是同一个层次。

可以画成：

```text
                         Agent
                           │
                      proposes
                           │
                           ▼
                   ┌───────────────┐
                   │    Command    │
                   │               │
                   │ Business      │
                   │ Intent        │
                   └───────┬───────┘
                           │
                deterministic controls
                           │
             ┌─────────────┼─────────────┐
             │             │             │
             ▼             ▼             ▼
       Authorization     Policy       Approval
             │             │             │
             └─────────────┼─────────────┘
                           ▼
                    Command Executor
                           │
                           ▼
                    Business System
                           │
                           ▼
                     New State
```

关键是：

> **Agent 可以产生 Command，但 Agent 本身不应该因此拥有“让 Command 生效”的最终权力。**

Command 是边界，不是授权。

---

# 二、为什么直接把高风险动作设计成 Tool 会有问题？

假设一个 Agent 有：

```text
search_customer
get_portfolio
calculate_risk
submit_order
send_email
```

在普通 Agent Framework 中，最终可能只是：

```text
LLM
 ↓
Tool Call
 ↓
submit_order(...)
 ↓
Business API
```

这里至少混合了五种不同的责任：

```text
LLM Reasoning
Authorization
Business Intent
Risk Control
State Mutation
```

而这些本来应该由不同层负责。

最危险的问题是：

> **Tool Call 同时承担了“模型想这么做”和“系统真的这么做”。**

这让一个随机、概率性的模型输出，直接成为确定性的业务状态变化。

AWS 的 Agentic AI Lens 明确把“依赖 Agent 自己的 reasoning 来完成 authorization”视为反模式，并要求在 Tool 执行前使用外部授权机制；对于高风险 mutation，则应进一步设置 human checkpoint。

---

# 三、Command 的思想其实并不新，Agent 只是让它重新变得重要

Command 并不是 Agent 时代才出现的概念。

经典的 Command Query Separation 将操作分成两类：

* Query：读取状态，不改变可观察状态；
* Command：改变系统状态。

Microsoft 的 CQRS 文档进一步强调：

> Command 应该表示具体的业务任务，而不是低层次的数据更新。

也就是说：

```text
不好：

UpdateOrderStatus(status=SUBMITTED)
```

更好的：

```text
SubmitCustomerOrder(...)
```

前者描述数据库状态变化。

后者描述业务意图。

Microsoft 的 CQRS 文档还明确指出，Command-side 适合承载 validation 和 business logic，以保证写入后的业务一致性。

因此，Agent 并不是创造了 Command Pattern。

它只是让一个老问题变得更加尖锐：

> **当“决定要做什么”的主体从确定性代码变成了概率性的 LLM 时，业务 Command 边界的重要性进一步上升。**

---

# 四、为什么金融业务尤其适合 Command 模型？

金融系统长期以来就非常重视：

```text
Order
Payment
Transfer
Instruction
Approval
Trade
Vote
Settlement
```

这些都不是简单的 CRUD。

例如：

```text
Update Order Status = Submitted
```

并不能描述真正的业务语义。

真正业务动作是：

```text
Submit Customer Order
```

因为这个动作背后可能隐含：

```text
客户是否有权交易
交易品种是否允许
订单数量是否合理
市场是否开放
账户是否有足够资金
风控限额是否通过
是否满足监管要求
是否需要人工审批
```

SEC Rule 15c3-5 就是一个很具体的金融领域例子：具有市场准入的 broker-dealer 必须建立、记录和维护风险控制及监督程序，以防止超过预设信用/资本阈值或明显错误的订单进入市场，并限制市场访问系统只供授权人员使用；相关控制还必须定期审查其有效性。

这并不意味着 SEC 要求使用 `Command` 类。

真正值得借鉴的是：

> **高风险业务动作不能只是一个“API 被调用了”，而应该是一个受业务规则、权限和风险控制约束的明确业务动作。**

FINRA 2026 年的 Best Execution 指导同样强调对整个订单流进行监督、持续监控，并要求定期、严格地检查订单执行质量和相关分析。

---

# 五、Command 最核心的价值：把“建议”和“执行”彻底分开

这是 Agent 架构里最重要的边界之一。

传统方式：

```text
Agent
 ↓
Tool Call
 ↓
Mutation
```

Command 方式：

```text
Agent
 ↓
Command Proposal
 ↓
Validation
 ↓
Authorization
 ↓
Approval
 ↓
Execution
```

于是 Agent 的角色发生了变化。

不是：

> Agent 决定并执行。

而是：

> Agent 提出业务动作，系统判断这个动作是否允许执行。

可以抽象成：

```text
LLM
=
Proposal Generator

Policy
=
Decision Maker

Command
=
Business Intent

Executor
=
Side Effect Owner

Business System
=
Source of Truth
```

AWS 当前建议的高风险 Agent 模式与这一思想是一致的：按风险和可逆性划分 Autonomous / Notify / Approve，并在高风险动作执行之前设置人工或其他外部控制。

---

# 六、什么样的操作应该建模为 Command？

并不是所有写操作都需要 Command。

简单 CRUD：

```text
update user preference
```

未必需要一个复杂 Command Framework。

更值得建模为 Command 的通常具有以下一个或多个特征：

### 1. 改变重要业务状态

例如：

```text
SubmitOrder
ApprovePayment
CastProxyVote
ChangeClientStatus
CloseAccount
```

### 2. 具有明确业务意图

不是：

```text
UPDATE table
```

而是：

```text
ApproveTrade
```

### 3. 需要权限判断

```text
谁有权做？
```

### 4. 需要业务规则

```text
什么情况下允许？
```

### 5. 需要审批

```text
什么时候必须 Human Approval？
```

### 6. 存在不可逆或高代价副作用

```text
付款
交易
投票
外部通信
数据删除
```

### 7. 需要审计

```text
谁发起
谁批准
何时执行
执行什么
为什么允许
```

### 8. 需要重试 / 恢复 / 幂等

如果执行具有明显 side effect，Command 会成为非常合适的生命周期锚点。

---

# 七、不应该把所有 Write 都叫 Command

这里很容易过度设计。

例如：

```text
PATCH /user/preferences
```

如果只是普通低风险设置变更，而且：

* 没有审批；
* 没有复杂业务规则；
* 没有跨系统副作用；
* 不需要专门追踪业务意图；

那么完全可以使用普通 Application Service。

因此：

> **Command 不是“任何写操作的高级名字”，而是对重要业务动作进行显式建模。**

Microsoft 的 CQRS 文档也提醒，CQRS 本身并不适合所有系统；简单领域和简单 CRUD 场景可以继续使用普通 CRUD。

---

# 八、Command 应该是“业务意图”，而不是数据库变化

这是 Command 建模最关键的原则。

错误：

```json
{
  "operation": "UPDATE",
  "table": "orders",
  "where": {
    "id": "123"
  },
  "set": {
    "status": "SUBMITTED"
  }
}
```

这实际上不是业务 Command。

它只是数据库 mutation。

更好的：

```json
{
  "commandType": "SubmitCustomerOrder",
  "orderId": "123",
  "requestedBy": "user-456",
  "reason": "Customer requested execution"
}
```

因为 `SubmitCustomerOrder` 表达了真正的 domain intent。

Microsoft 的 CQRS 指南明确建议 Command 表示具体业务任务，例如 `Book hotel room`，而不是直接修改底层实体状态。

---

# 九、推荐的 Command 最小数据模型

一个企业 Agent 系统不需要一开始就设计几十个字段。

建议一个基础 Command 至少包含：

```json
{
  "commandId": "cmd_01J...",
  "commandType": "SubmitCustomerOrder",

  "target": {
    "type": "Order",
    "id": "order_123"
  },

  "parameters": {
    "quantity": 1000,
    "side": "BUY",
    "instrument": "XYZ"
  },

  "requestedBy": {
    "userId": "user_456",
    "agentId": "research-agent"
  },

  "reason": "Customer instruction",

  "createdAt": "2026-09-20T09:30:00Z",
  "expiresAt": "2026-09-20T09:35:00Z",

  "expectedVersion": 17
}
```

这里最重要的是：

```text
commandType
target
parameters
requestedBy
reason
createdAt
expiresAt
expectedVersion
```

其余字段根据业务需要增加。

---

# 十、Command 与 Agent Session、Workflow、Tool 不应该混淆

这几个对象应该明确区分。

| 对象        | 回答的问题                |
| --------- | -------------------- |
| Session   | 这是谁和 Agent 的一次交互上下文？ |
| Execution | 这一次任务执行是什么？          |
| Tool      | Agent 可以调用什么能力？      |
| Workflow  | 业务流程走到哪一步？           |
| Command   | 要让业务发生什么具体变化？        |
| Approval  | 谁是否批准这个具体动作？         |
| Event     | 这个动作/状态变化已经发生了什么？    |

例如：

```text
Session
  ↓
Execution
  ↓
Agent
  ↓
Command
  ↓
Approval
  ↓
Execution
  ↓
Business State
  ↓
Event
```

不要让：

```text
lastOutput
```

等同于：

```text
Command
```

也不要让：

```text
Tool Call
```

直接等同于：

```text
Business Decision
```

---

# 十一、Command 不是 Approval

这是金融系统里非常重要的区分。

例如：

```text
Command:
SubmitCustomerOrder
```

表示：

> 有一个具体的业务动作请求。

而：

```text
Approval:
Approved by Alice
```

表示：

> 某个具有批准权的人或规则，对这个具体动作作出了允许决定。

因此：

```text
Command
≠
Approval
```

更合理的关系是：

```text
Command
   │
   ├── Policy Decision
   │
   └── Approval Requirement
            │
            ▼
         Approval
```

AWS 明确建议高风险 Agent 操作通过审批机制拦截，而且审批记录应保存 reviewer identity、timestamp 和 decision。

---

# 十二、Approval 应该绑定“具体 Command”，而不是绑定 Agent

假设：

```text
Agent = TradingAgent
```

然后：

```text
Approval:
TradingAgent approved
```

这是没有意义的。

正确的是：

```text
Approval
  commandId = cmd-123
  commandHash = ...
  decision = APPROVED
  reviewer = Alice
  timestamp = ...
```

因为审批必须回答：

> **批准的到底是哪一个动作？**

如果：

```text
Command A
quantity = 100

```

被批准以后，Agent 把参数改成：

```text
quantity = 1,000,000
```

如果 Approval 没有绑定具体 Command，那么审批就失去了意义。

AWS Agentic AI Lens 也特别强调，对于持久信任或审批，应把 grant 限定到特定 command、参数形状或资源；对未来所有同类操作进行 wildcard approval 会实质上取消应有的人类监督。

---

# 十三、Command 应该尽量是不可变的

Command 一旦进入：

```text
Policy
Approval
```

就不应该再被偷偷修改。

推荐：

```text
Draft Command
      ↓
Validated Command
      ↓
Authorized Command
      ↓
Approved Command
      ↓
Executing Command
      ↓
Executed Command
```

而不是：

```text
Command
 ↓
随时修改 parameters
 ↓
继续执行
```

因此，一个非常实用的字段是：

```text
commandHash
```

例如：

```text
commandHash =
SHA256(
    canonical(commandType)
    +
    canonical(target)
    +
    canonical(parameters)
    +
    canonical(requestedBy)
)
```

需要注意：

> `commandHash` 本身并不提供授权，也不能证明业务动作一定安全。

它主要用于检测：

```text
审批时的 Command
```

和：

```text
执行时的 Command
```

是否相同。

真正的安全性仍然来自：

```text
Authorization
Policy
State Validation
Domain Rules
```

---

# 十四、为什么 Command 需要 `expectedVersion` / `resourceVersion`？

因为金融业务最大的一个问题是：

> **批准和执行之间可能有时间差。**

例如：

```text
09:00
Agent 提交订单
```

当前：

```text
Position Version = 17
```

Human 在：

```text
09:05
```

批准。

但到了：

```text
09:06
```

业务状态已经：

```text
Position Version = 18
```

如果系统仍然执行原来的 Command：

```text
Command
expectedVersion = 17
```

就可能基于旧状态执行。

因此：

```text
Command
    +
expectedVersion
```

可以用于执行前条件检查：

```text
currentVersion == expectedVersion ?
```

不是：

```text
YES → execute
```

就是：

```text
NO → reject / revalidate / reapprove
```

这也是 CQRS/DDD 写模型非常重要的一个作用：Command-side 承担 validation、business rules 和 consistency enforcement。

---

# 十五、Command 应该有 Expiration

并不是所有 Command 都应该永久有效。

例如：

```text
SubmitOrder
expiresAt = 09:35
```

过期之后：

```text
DENY
```

这对于：

* 市场价格快速变化；
* 风险状态快速变化；
* 权限可能变化；
* 审批等待较久；

尤其重要。

对于金融交易，这个原则甚至比普通 SaaS 更重要，因为一个小时前有效的执行条件，不一定现在仍然有效。

---

# 十六、Command 的完整生命周期

推荐设计成：

```text
                    ┌──────────────┐
                    │ Agent / User │
                    └──────┬───────┘
                           │
                      proposes
                           ▼
                 ┌─────────────────┐
                 │ Command Draft   │
                 └────────┬────────┘
                          │
                    Schema Validate
                          │
                          ▼
                 ┌─────────────────┐
                 │ Validated       │
                 │ Command         │
                 └────────┬────────┘
                          │
                    Authorization
                          │
                  ┌───────┴────────┐
                  │                │
                DENY             ALLOW
                  │                │
                  ▼                ▼
               Rejected       Risk Policy
                                  │
                       ┌──────────┴─────────┐
                       │                    │
                    Auto-Allow          Human Approval
                       │                    │
                       │              ┌─────┴─────┐
                       │              │           │
                       │           Approved     Rejected
                       │              │           │
                       └──────────────┼───────────┘
                                      ▼
                             Re-validation
                                      │
                               Idempotency
                                      │
                                      ▼
                              Command Executor
                                      │
                                      ▼
                               Business System
                                      │
                                      ▼
                               Post-condition
                                      │
                                      ▼
                                  Result/Event
```

这里每一步都有不同职责。

---

# 十七、不要让 Agent 自己决定 Risk Tier

例如：

```text
Agent:
I think this is a low-risk action.
```

然后：

```text
riskLevel = LOW
```

再继续执行。

这是错误的设计。

AWS 当前 Agentic AI Lens 明确指出，风险分类不应交给与不可信输入处于同一路径的 LLM 自己决定，否则模型可能被操纵为把高风险请求标成低风险。

更合理的是：

```text
Command
   ↓
Deterministic Risk Classifier
   ↓
Risk Tier
```

例如根据：

```text
commandType
targetType
amount
resourceClassification
externalSideEffect
reversibility
frequency
```

确定：

```text
R0
R1
R2
R3
R4
```

---

# 十八、Risk Tier 应该决定 Command 的执行路径

例如：

| Tier | 示例                | 执行路径                              |
| ---- | ----------------- | --------------------------------- |
| R0   | 查询、低风险内部更新        | 自动                                |
| R1   | 低影响业务修改           | Policy + 自动                       |
| R2   | 重要业务修改            | Policy + 二次校验                     |
| R3   | 高风险状态修改           | Command + Approval                |
| R4   | 交易、付款、投票等重大/不可逆操作 | Command + Policy + Approval + 强校验 |

这是一种建议性的内部工程模型，不是监管统一分类。

AWS 当前建议根据 impact 和 reversibility 建立分层监督：低风险可自治，中风险通知，高风险或不可逆动作需要明确批准。

---

# 十九、Command 与 Tool 的职责边界应该这样设计

错误：

```text
submitOrder()
```

既：

```text
判断权限
决定风险
创建订单
提交订单
发消息
写审计
```

最后变成一个“超级 Tool”。

更合理：

```text
Tool:
order.prepare

        ↓

Command:
SubmitCustomerOrder

        ↓

Policy:
CanSubmitOrder?

        ↓

Approval:
Approved?

        ↓

Executor:
OrderService.submit()

        ↓

Business System
```

也就是说：

> **Tool 暴露能力；Command 表达业务动作；Executor 执行业务动作。**

---

# 二十、Command Executor 应该是 Server-side 的

这是 Agent 架构非常值得强调的一点。

不推荐：

```text
LLM
 ↓
Command
 ↓
LLM-generated JavaScript
 ↓
business API
```

也不推荐：

```text
LLM
 ↓
SQL
 ↓
UPDATE
```

更合理：

```text
Agent
 ↓
CommandIntent
 ↓
Server-side CommandService
 ↓
Registered CommandExecutor
 ↓
Domain Service
 ↓
Business System
```

也就是说：

> **模型只产生“想做什么”的数据，真正决定如何执行的是服务端代码。**

这样才能保证：

```text
LLM
≠
Business Logic
```

---

# 二十一、Command Registry 是很有价值的

建议不要：

```text
if commandType == ...
```

散落在各个 Agent 里。

可以建立：

```text
Command Registry
```

例如：

```text
SubmitCustomerOrder
ApproveWithdrawal
CastProxyVote
ChangeClientStatus
CancelPayment
```

每个 Command 定义：

```text
commandType
schema
riskTier
authorizationPolicy
approvalPolicy
executor
idempotencyPolicy
resourceVersionPolicy
auditPolicy
```

例如：

```yaml
command:
  type: SubmitCustomerOrder
  version: v2

risk:
  tier: R4

authorization:
  policy: order.submit

approval:
  required: true
  policy: maker-checker

execution:
  executor: OrderCommandExecutor

concurrency:
  requireResourceVersion: true

idempotency:
  required: true

audit:
  level: regulatory
```

这会让 Command 成为一个真正可治理的业务能力。

---

# 二十二、Command Schema 不应该和 Tool Schema 完全相同

这是一个很容易偷懒的地方。

例如 Tool：

```json
{
  "customerId": "123",
  "amount": 1000
}
```

然后直接当 Command：

```json
{
  "customerId": "123",
  "amount": 1000
}
```

这样做丢失了大量业务信息。

Command 应该体现：

```text
Business intent
Initiator
Reason
Target
Conditions
Version
Expiration
Risk
```

例如：

```json
{
  "commandType": "ApproveWithdrawal",

  "target": {
    "accountId": "ACC-123"
  },

  "parameters": {
    "amount": 10000,
    "currency": "USD"
  },

  "requestedBy": {
    "userId": "U-001",
    "agentId": "operations-agent"
  },

  "reason": "Client withdrawal instruction",

  "expectedVersion": 47,

  "expiresAt": "2026-09-20T10:30:00Z"
}
```

Tool Call 只是：

```text
“请执行这个 Tool。”
```

Command 是：

```text
“业务系统被请求执行这个明确的业务动作。”
```

---

# 二十三、Command 的字段应该尽量表达“事实”，不要塞进“模型解释”

例如可以包含：

```text
reason
```

但不建议把一大段：

```text
chain of thought
```

作为 Command 的业务依据。

更适合：

```text
reason =
"Customer requested a rebalance"
```

而不是：

```text
reason =
"After thinking through 17 steps, I concluded..."
```

Command 是 business record，不应该变成 LLM internal reasoning dump。

---

# 二十四、Approval 需要看到足够的 Context

另一方面，也不能让审批者只看到：

```text
Approve Command?
YES / NO
```

AWS 当前 Human Oversight guidance 特别指出，如果 reviewer 没有足够上下文，审批很容易沦为形式主义。审阅者至少需要了解 action、相关政策检查、数据来源以及潜在后果等关键信息。

对于金融 Command，审批界面至少建议看到：

```text
Action
Target
Parameters
Requester
Reason
Risk Tier
Policy Result
Relevant Limits
Relevant Data
Current State
Expected State
Expiration
Warnings
```

例如：

```text
Submit Order

Client:
ABC Fund

Instrument:
XYZ

Side:
BUY

Quantity:
10,000

Estimated Value:
$1.2M

Risk Tier:
R4

Limit Check:
PASS

Client Entitlement:
PASS

Policy:
PASS

Requested By:
Investment Agent / Alice

Expires:
10:35 UTC

Approval:
[Approve] [Reject]
```

这才是“真正的审批”。

---

# 二十五、Command 的执行前 Re-validation 是不可缺少的

很多系统会做：

```text
Create Command
↓
Approve
↓
Execute
```

但忘了：

```text
Approve
↓
state may have changed
```

因此推荐：

```text
Approve
  ↓
Revalidate:
  identity
  authorization
  policy
  resource version
  business limits
  expiration
  command hash
  data freshness
  approval validity
```

然后才执行。

这其实是金融业务很熟悉的思想：

> **审批不是让未来永远自动有效，而是允许一个明确动作在满足条件时执行。**

---

# 二十六、Idempotency 是 Command 的必要配套

为什么？

因为 Agent Workflow 很容易出现：

```text
Tool timeout
↓
Agent retries
↓
Command executes again
```

如果没有幂等：

```text
$10,000
↓
$10,000 again
```

Stripe 的 API 文档把这一问题说得非常清楚：对于可能重试的 mutation，请求可以带 Idempotency Key，使重复请求不会再次创建对象或重复执行更新；Stripe 还会检查相同 idempotency key 对应请求的参数一致性。

对于 Agent Command，可以使用：

```text
idempotencyKey =
commandId
```

或者：

```text
hash(command + execution context)
```

但实际定义需要考虑业务语义。

例如：

```text
SubmitOrder
```

通常：

```text
commandId = unique
```

即可作为一次业务动作的唯一身份。

---

# 二十七、但是 Idempotency 不等于 Exactly Once

这一点一定要说清楚。

假设：

```text
Command Executor
   ↓
External Trading System
   ↓
Order accepted
```

随后：

```text
Executor
   ↓
network timeout
```

系统不知道交易系统是否真的成功。

重新执行：

```text
Command
```

即使带 Idempotency Key：

```text
下游系统如果支持同一业务幂等键
→ 可以避免重复
```

但如果下游完全不支持：

```text
系统仍然无法凭空保证 exactly-once
```

所以真实世界经常需要：

```text
Command
+
Idempotency
+
External reconciliation
+
Post-condition verification
```

而不是一句：

> “我们用了幂等键，所以安全了。”

---

# 二十八、Command 执行结束后，还应该有 Post-condition Verification

执行成功并不一定意味着业务状态正确。

例如：

```text
POST /orders
→ HTTP 200
```

不等于：

```text
Order is actually ACTIVE
```

所以：

```text
Command
  ↓
Execute
  ↓
Read authoritative state
  ↓
Verify expected post-condition
```

例如：

```text
Expected:
order.status = SUBMITTED

Actual:
order.status = REJECTED
```

那么：

```text
Command execution result
=
FAILED / BUSINESS_REJECTED
```

而不是：

```text
HTTP 200
```

这种设计非常适合金融系统，因为真正重要的是：

> **Business State 最终是什么。**

---

# 二十九、Command 应该与 Business Transaction 对齐，但不一定等于数据库 Transaction

这是另一个常见误区。

例如：

```text
Command = SubmitTrade
```

背后可能发生：

```text
DB update
+
Risk service
+
Order management
+
Audit
+
External broker API
```

Command 是：

```text
business transaction boundary
```

但不一定是：

```text
single SQL transaction
```

当跨系统时，可以使用：

```text
Command
↓
Workflow / Saga
↓
multiple actions
```

但需要注意：

> Command 本身表达一次业务意图，不等于整个长流程的状态机。

例如：

```text
SubmitTradeCommand
```

可能触发：

```text
validate
→ reserve
→ route
→ confirm
```

这属于 execution workflow。

Command 仍然只是：

```text
“我要提交这笔交易”
```

---

# 三十、Command 与 Event 也不能混淆

这两个概念方向正好相反。

### Command

```text
“请做这件事。”
```

### Event

```text
“这件事情已经发生了。”
```

例如：

```text
Command:
SubmitOrder
```

之后：

```text
Event:
OrderSubmitted
```

所以：

```text
Command
=
Intent / Request

Event
=
Fact / Occurrence
```

这一区分对于审计很重要。

如果系统记录：

```text
OrderSubmitted
```

不能自动证明：

```text
谁请求？
谁批准？
当时为什么允许？
```

因此高风险业务通常需要同时保存：

```text
Command record
+
Approval record
+
Execution result
+
Business event
```

---

# 三十一、为什么 Command 对审计特别有价值？

因为它可以成为一个天然的业务审计锚点。

例如：

```text
Command ID:
CMD-7821

Requested By:
Agent A / User Alice

Action:
SubmitCustomerOrder

Target:
Client ABC

Parameters:
...

Policy:
PASS

Approval:
Alice-2 APPROVED

Executed By:
OrderService

Execution Time:
10:31:12

Result:
ORDER_ACCEPTED
```

这样事后调查时，不需要从一堆：

```text
LLM token
Prompt
Tool trace
HTTP log
```

里“推理出”业务到底发生了什么。

可以直接从：

```text
Command
```

开始查询。

但这里必须避免另一个过度推论：

> **Command Record 本身并不自动等于监管 Audit Evidence。**

具体监管记录保存要求取决于业务、法人实体、司法辖区和具体规则。

更准确的说法是：

> Command 很适合成为构成业务审计证据的一项结构化记录，但完整的 Regulatory Evidence 仍应单独设计。

FINRA 2026 年的 GenAI 观察明确强调了 documentation、monitoring、model version tracking 和 accountability；这说明金融机构不仅需要模型日志，也需要能够解释系统如何被使用、监督和控制。

---

# 三十二、Command Hash 是很好的审计辅助，但不是安全机制本身

一个常见设计：

```text
commandHash
```

可以用来证明：

```text
审批时的 Command
=
执行时的 Command
```

这是很有价值的。

但是不要把它理解成：

```text
commandHash
=
authorization
```

也不能证明：

```text
command 本身合法
```

正确的关系应该是：

```text
Hash
→ integrity check

Policy
→ authorization

Business Rule
→ semantic validation

Approval
→ human/business decision
```

四者职责不同。

---

# 三十三、Command 最好由确定性代码创建最终版本

Agent 可以产生：

```json
{
  "intent": "submit order",
  "client": "ABC",
  "instrument": "XYZ",
  "quantity": 10000
}
```

但是建议由服务器把它规范化成：

```text
Canonical Command
```

包括：

```text
normalized IDs
validated parameters
current actor
server timestamp
risk classification
resource version
expiry
```

也就是说：

```text
LLM
   ↓
CommandIntent
   ↓
Server validation / normalization
   ↓
Canonical Command
```

而不是：

```text
LLM
   ↓
完全可信的 Command object
```

这也符合 AWS 对 Agent output 必须进行外部验证、不能把模型输出当作可信输入的整体设计思想。

---

# 三十四、CommandIntent 和 Command 最好区分

这是一个很实用的设计。

### CommandIntent

Agent 产生：

```json
{
  "type": "SubmitOrder",
  "client": "ABC",
  "quantity": 10000
}
```

它仍然是不可信输入。

### Canonical Command

服务器确认：

```json
{
  "commandId": "cmd-123",
  "commandType": "SubmitCustomerOrder",
  "target": {
    "orderId": "order-789"
  },
  "parameters": {
    "instrument": "XYZ",
    "quantity": 10000
  },
  "requestedBy": {
    "userId": "alice",
    "agentId": "trade-agent"
  },
  "expectedVersion": 42,
  "expiresAt": "..."
}
```

这才进入：

```text
Authorization
Approval
Execution
```

因此：

> **LLM 输出应该叫 Intent；经过确定性验证后形成的，才叫真正的 Command。**

这是一个非常值得在 Agent 平台标准化的边界。

---

# 三十五、一个完整的 Command Service 应该负责什么？

建议：

```text
CommandService
```

至少负责：

```text
1. validate schema
2. normalize input
3. classify risk
4. resolve authorization
5. evaluate policy
6. create canonical command
7. create approval request if needed
8. freeze command
9. verify approval
10. revalidate before execute
11. enforce idempotency
12. call executor
13. verify result/post-condition
14. write audit
```

而 Agent Runtime 不应该负责这些事情。

Agent Runtime 更应该负责：

```text
reasoning
planning
tool interaction
conversation
```

这样：

```text
Agent Runtime
≠
Business Control Plane
```

这与很多成熟企业 Agent 架构的方向是一致的：运行时负责 Agent execution，独立控制面负责 identity、authorization、approval 和治理。AWS AgentCore Gateway/Policy 以及当前 Agentic AI Lens 就是非常典型的实现参考。

---

# 三十六、推荐的 CommandService 接口

例如：

```typescript
interface CommandService {
  createIntent(input: CommandIntent): Promise<Command>;

  classify(
    command: Command
  ): Promise<CommandRiskClassification>;

  authorize(
    command: Command,
    context: AuthorizationContext
  ): Promise<AuthorizationDecision>;

  requestApproval(
    command: Command
  ): Promise<ApprovalRequest>;

  approve(
    commandId: string,
    decision: ApprovalDecision
  ): Promise<void>;

  execute(
    commandId: string
  ): Promise<CommandExecutionResult>;
}
```

关键在于：

```text
Agent
```

不应该直接得到：

```typescript
execute(command)
```

而是：

```text
Agent
  ↓
createIntent
```

剩下的事情由服务端控制。

---

# 三十七、Command Executor 应该是 Registry-based

例如：

```typescript
interface CommandExecutor<T extends Command> {
  execute(
    command: T,
    context: ExecutionContext
  ): Promise<ExecutionResult>;
}
```

然后：

```text
Command Registry
--------------------------------
SubmitCustomerOrder
  → TradeOrderExecutor

CastProxyVote
  → ProxyVoteExecutor

ApproveWithdrawal
  → WithdrawalExecutor
```

这样：

```text
Agent
```

不需要知道：

```text
怎样调用 Trade API
```

它只需要表达：

```text
SubmitCustomerOrder
```

这可以显著降低 LLM 与下游 API 的耦合。

---

# 三十八、Command Executor 不应该重新相信 Command

即使：

```text
CommandService
```

已经验证过：

```text
authorization
policy
approval
```

Executor 在自己的业务边界上仍然应该做必要的 domain checks。

例如：

```text
TradeOrderExecutor
  ↓
check order state
check account state
check position
check limit
check version
```

因为最终：

> **Business Service 才是维护业务不变量的地方。**

CQRS 的写模型之所以重要，就是因为 command-side 可以承载 validation 和 domain logic，而查询侧无需承担这些写约束。

---

# 三十九、Command 最容易犯的一个错误：把“Reason”当成 Authorization

例如：

```json
{
  "commandType": "SubmitOrder",
  "reason": "Customer requested"
}
```

不代表：

```text
authorized = true
```

Reason 是：

```text
business context
```

不是：

```text
authorization evidence
```

正确：

```text
reason
+
identity
+
entitlement
+
policy
+
approval
```

共同决定是否执行。

---

# 四十、另一个错误：把“Approval”当成“Business Rule”

例如：

```text
Manager Approved
```

不代表：

```text
Limit Check Passed
```

Approval 不是替代业务规则。

应该：

```text
Business Rules
    +
Authorization
    +
Approval
```

都通过之后才能执行。

尤其对于交易、付款、投票等金融操作：

```text
Approved
```

也不应该意味着：

```text
state unchanged
```

所以必须在执行前重新检查。

---

# 四十一、Command 的状态机建议保持很小

不要把 Command 做成一个新的 Workflow Engine。

一个实用状态机通常足够：

```text
DRAFT
  ↓
VALIDATED
  ↓
AUTHORIZED
  ↓
PENDING_APPROVAL
  ↓
APPROVED
  ↓
EXECUTING
  ↓
SUCCEEDED

or

REJECTED
EXPIRED
CANCELLED
FAILED
```

不要轻易增加：

```text
PRE_APPROVED
PARTIALLY_APPROVED
DEFERRED
RESUMING
RETRY_WAITING
```

这些更适合在：

```text
Approval
Execution
Workflow
```

里建模，而不是无限扩张 Command 本身。

---

# 四十二、Command 不应该成为 Workflow State Machine

这也是一个非常重要的边界。

例如：

```text
Workflow:
Trade Review
   ↓
Risk Check
   ↓
Manager Approval
   ↓
Submit
   ↓
Settlement
```

这是 Workflow。

其中：

```text
SubmitCustomerOrder
```

是 Command。

所以：

```text
Workflow
=
整个过程

Command
=
过程中的一个明确业务动作
```

一个 Workflow 可以产生多个 Command。

一个 Command 也可以由非 Agent 的传统 UI 发起。

这种解耦非常重要。

---

# 四十三、Command 不应该只服务 Agent

成熟设计里，Command 最好同时支持：

```text
Human UI
Agent
Batch
External Integration
Workflow
```

例如：

```text
React UI
  ↓
SubmitCustomerOrder Command

Agent
  ↓
SubmitCustomerOrder Command

Batch Job
  ↓
SubmitCustomerOrder Command
```

所有入口最后进入：

```text
同一个 Command Service
```

这样业务规则不会因为：

```text
“这是 AI 调用”
```

而出现另一套实现。

这也是金融架构非常值得采用的方式：

> **AI 是新的调用者，不应该成为新的业务规则实现者。**

---

# 四十四、这会形成一个非常好的“AI as Another Caller”架构

```text
                 ┌────────────┐
                 │ Human UI   │
                 └──────┬─────┘
                        │
                 ┌──────▼─────┐
                 │ API Client │
                 └──────┬─────┘
                        │
             ┌──────────▼──────────┐
             │   Command Service   │
             └──────────┬──────────┘
                        │
        ┌───────────────┼────────────────┐
        │               │                │
        ▼               ▼                ▼
 Authorization       Policy         Approval
        │               │                │
        └───────────────┼────────────────┘
                        ▼
                  Domain Service
                        │
                        ▼
                  Business System
```

Agent 只是变成：

```text
┌─────────────┐
│    Agent    │
└──────┬──────┘
       │
       ▼
Command Service
```

而不是：

```text
Agent
 ↓
一套新的业务逻辑
```

这是我认为 Command 对企业 Agent 最重要的架构价值之一。

---

# 四十五、金融领域为什么尤其应该做这层隔离？

因为金融系统已经有成熟的控制模式：

```text
Maker
Checker
Approval
Pre-trade Control
Limit
Entitlement
Supervision
Reconciliation
Audit
```

Agent 不应该推翻这些控制，而应该成为这些控制体系中的一个新的“提案者/调用者”。

例如：

```text
传统：

Trader
 ↓
Order Entry
 ↓
Risk Check
 ↓
Approval
 ↓
Execution
```

Agent 化之后：

```text
Agent
 ↓
Order Proposal
 ↓
Command
 ↓
Risk Check
 ↓
Approval
 ↓
Execution
```

最大的变化是：

```text
Trader
```

可能被部分替换为：

```text
Agent
```

但：

```text
Risk Check
Approval
Execution
Audit
```

不应该因为 Agent 出现而消失。

SEC 对市场准入控制的要求就是一个很直观的例子：订单进入市场前仍需要适当的风险控制和监督，而不是因为订单由自动化系统生成就跳过这些控制。

---

# 四十六、Command 设计还解决了 Agent Behavior Drift 的问题

之前讨论过：

> Model、Prompt、Skill、Tool 改了，代码没变，Agent 行为也可能发生变化。

如果：

```text
Agent
 ↓
Tool
 ↓
Direct Mutation
```

那么：

```text
Behavior Drift
```

可能直接变成：

```text
Business State Drift
```

而 Command 架构提供了一个缓冲层：

```text
Agent Behavior Drift
        ↓
New Command Proposal
        ↓
Policy
        ↓
Validation
        ↓
Approval
        ↓
Execution
```

因此：

> **Command 不会消灭 Agent Drift，但可以阻止行为漂移自动等价于业务状态漂移。**

这也是 AWS 当前强调“bounded autonomy”与外部 authorization / human oversight 的原因。

---

# 四十七、Command 是“业务控制边界”，不是“模型控制边界”

这一点非常重要。

不要设计：

```text
Command = LLM output object
```

应该：

```text
LLM output
   ↓
untrusted intent
   ↓
validation
   ↓
canonical command
```

所以：

```text
LLM
=
untrusted proposal
```

而：

```text
Command
=
trusted-but-not-yet-authorized business request
```

最后：

```text
Authorized Command
=
approved business request eligible for execution
```

这三个层次应该区分开。

---

# 四十八、推荐的 Command 数据模型

一个比较平衡的生产模型可以是：

```typescript
type Command<TParameters> = {
  commandId: string;

  commandType: string;
  commandVersion: string;

  target: {
    type: string;
    id: string;
  };

  parameters: TParameters;

  requestedBy: {
    userId?: string;
    agentId?: string;
    source: "user" | "agent" | "system";
  };

  reason?: string;

  riskTier: "R0" | "R1" | "R2" | "R3" | "R4";

  createdAt: string;
  expiresAt?: string;

  expectedVersion?: string;

  commandHash: string;
};
```

但需要强调：

```text
riskTier
```

最好由服务端根据：

```text
commandType
target
parameters
context
```

确定，而不是由 Agent 自己填写后直接信任。

---

# 四十九、Approval 数据也应独立

例如：

```typescript
type Approval = {
  approvalId: string;

  commandId: string;
  commandHash: string;

  decision: "APPROVED" | "REJECTED";

  approver: {
    userId: string;
    role: string;
  };

  reason?: string;

  createdAt: string;
  expiresAt?: string;
};
```

这样可以非常清楚：

```text
Command
=
需要做什么

Approval
=
谁允许了这件事
```

而不是把：

```text
approvedBy
```

简单塞进 Command 本身。

---

# 五十、Execution Record 也应该独立

例如：

```typescript
type CommandExecution = {
  executionId: string;

  commandId: string;

  executor: string;

  startedAt: string;
  completedAt?: string;

  status:
    | "RUNNING"
    | "SUCCEEDED"
    | "FAILED"
    | "REJECTED";

  idempotencyKey: string;

  result?: unknown;

  errorCode?: string;
};
```

最终关系：

```text
Command
   │
   ├── Approval*
   │
   └── Execution*
```

这样：

```text
一个 Command
```

可以有：

```text
一次或多次 execution attempt
```

但必须通过：

```text
idempotency
```

保证业务不会被重复执行。

---

# 五十一、Command、Approval、Execution、Event 最好形成一个完整证据链

例如：

```text
cmd-1001
   │
   ├── approval-2001
   │      └── APPROVED
   │
   ├── execution-3001
   │      └── FAILED / TIMEOUT
   │
   ├── execution-3002
   │      └── SUCCEEDED
   │
   └── event-4001
          └── OrderSubmitted
```

这比：

```text
Agent Trace
```

更接近业务审计。

---

# 五十二、如果 Command 执行跨系统怎么办？

例如：

```text
SubmitTradeCommand
```

实际需要：

```text
Order System
Risk System
Broker API
Settlement System
Audit System
```

不要把 Command Executor 变成一个“大事务脚本”。

可以：

```text
Command
 ↓
Workflow / Saga
 ↓
Step 1
Step 2
Step 3
```

但仍然保留：

```text
Command
```

作为业务意图起点。

例如：

```text
SubmitTradeCommand
       ↓
Validate
       ↓
Reserve
       ↓
Route
       ↓
Confirm
       ↓
Settlement
```

这里 Command 不负责描述所有步骤。

它只描述：

> “我要提交这笔交易。”

而：

```text
Workflow
```

负责：

> “为了完成这个动作，需要经过哪些步骤。”

这样边界非常清晰。

---

# 五十三、Command 也不等于 Event Sourcing

很多团队看到：

```text
Command
```

就开始想到：

```text
Event Sourcing
CQRS
Kafka
Saga
Temporal
```

这些并不是 Command 的必需条件。

最简单的实现完全可以是：

```text
POST /commands

→ CommandService
→ Domain Service
→ PostgreSQL
```

甚至：

```text
Command Table
Approval Table
Execution Table
```

就足够。

Microsoft 的 CQRS 指南也指出，CQRS 可以只有一个底层数据存储；是否进一步采用事件溯源、不同数据库或异步消息是独立的设计选择。

因此：

> **引入 Command ≠ 必须引入 CQRS 全家桶。**

---

# 五十四、最小可用 Command 架构

对于一个已经有 Agent Runtime 的企业平台，我建议最小实现只有五个部分：

```text
1. CommandIntent
2. CommandRegistry
3. CommandService
4. ApprovalService
5. CommandExecutor
```

外加：

```text
Audit
Idempotency
ResourceVersion
```

执行路径：

```text
Agent
 ↓
CommandIntent
 ↓
CommandService
 ├─ schema validation
 ├─ normalization
 ├─ risk classification
 ├─ authorization
 ├─ policy
 ├─ approval
 ├─ command freeze
 ├─ revalidation
 ├─ idempotency
 └─ executor
        ↓
   Business Service
```

这已经足够解决 80% 的核心问题。

---

# 五十五、什么时候不应该做 Command？

为了避免过度设计，可以明确几个反例。

### 1. 纯查询

```text
GetPortfolio()
```

Query 即可。

### 2. 无副作用的计算

```text
CalculateRisk()
```

如果只是返回计算结果，不改变状态，也未必需要 Command。

### 3. Agent 内部临时状态

```text
updateScratchpad()
```

不应该进入业务 Command。

### 4. 纯 UI 状态

```text
setPanelExpanded()
```

当然不需要。

### 5. 普通低风险 CRUD

如果没有复杂业务规则、审批、审计或重要副作用，普通 Application Service 可能更简单。

所以：

> **Command 应该服务于重要业务意图，而不是作为所有代码的统一包装层。**

---

# 五十六、什么时候 Command 特别值得做？

可以用一个非常实用的判断表：

| 特征                | 是否建议 Command |
| ----------------- | ------------ |
| 纯 Read            | 否            |
| 无副作用计算            | 通常否          |
| 普通低风险 CRUD        | 可选           |
| 重要业务状态变化          | 是            |
| 财务交易              | 强烈建议         |
| 付款/转账             | 强烈建议         |
| Proxy Vote Submit | 强烈建议         |
| 权限变更              | 强烈建议         |
| 对外正式通信            | 通常建议         |
| 不可逆删除             | 强烈建议         |
| 需要审批              | 几乎总是         |
| 需要强审计             | 强烈建议         |
| 需要幂等/重试/恢复        | 强烈建议         |

---

# 五十七、真正成熟的 Command 设计应该满足七个条件

可以将最终标准浓缩成：

### 1. Explicit

业务动作是明确的。

```text
SubmitOrder
```

而不是：

```text
update()
```

### 2. Typed

有明确 schema。

### 3. Immutable after approval

审批后不能偷偷修改。

### 4. Authorized

有独立 authorization。

### 5. Validatable

可以在执行前进行确定性检查。

### 6. Idempotent

重复 execution 不会产生重复业务副作用。

### 7. Auditable

能够知道：

```text
who
what
why
when
approved by whom
executed by whom
result
```

---

# 五十八、一个完整的金融 Agent Command 示例

以交易为例。

Agent 生成：

```json
{
  "intent": "submit_order",
  "client": "ABC Fund",
  "instrument": "XYZ",
  "side": "BUY",
  "quantity": 10000
}
```

系统转换：

```json
{
  "commandId": "cmd_789",

  "commandType": "SubmitCustomerOrder",
  "commandVersion": "v3",

  "target": {
    "type": "TradingAccount",
    "id": "ACC-123"
  },

  "parameters": {
    "instrument": "XYZ",
    "side": "BUY",
    "quantity": 10000
  },

  "requestedBy": {
    "userId": "alice",
    "agentId": "investment-agent",
    "source": "agent"
  },

  "reason": "Customer instruction",

  "riskTier": "R4",

  "expectedVersion": "order-state-41",

  "expiresAt": "2026-09-20T10:35:00Z",

  "commandHash": "sha256:..."
}
```

然后：

```text
1. Identity Check
   ↓
2. Client Entitlement
   ↓
3. Instrument Permission
   ↓
4. Limit Check
   ↓
5. Market Rule Check
   ↓
6. Risk Tier = R4
   ↓
7. Human Approval
   ↓
8. Revalidate order-state-41
   ↓
9. Revalidate commandHash
   ↓
10. Idempotency Check
   ↓
11. Execute
   ↓
12. Verify post-condition
```

这时候 Agent 的作用非常清晰：

> **Agent 提出了一个候选业务动作，但整个企业系统仍然拥有最终的决定权。**

---

# 五十九、这个架构与“Agent can reason, but cannot independently break authorization”完全一致

可以把整个原则浓缩成：

```text
Agent
  = Reason

Command
  = Intent

Policy
  = Authorization

Approval
  = Human / Business Decision

Executor
  = Action

Business System
  = Truth
```

因此：

```text
LLM
≠
Authorization

LLM
≠
Business Rule

LLM
≠
Business State

Tool
≠
Approval

Approval
≠
Execution
```

这些边界一旦明确，Agent 系统就会稳定很多。

---

# 六十、最终结论

高风险业务操作之所以值得建模为 Command，不是因为“Command 是一种高级 API 写法”，也不是因为某个框架规定 Agent 必须使用 Command。

真正原因是：

> **Agent 的 reasoning 是概率性的，而高风险业务状态变化必须是确定的、受约束的、可审计的。**

如果直接：

```text
LLM
 ↓
Tool
 ↓
Business Mutation
```

那么：

```text
模型输出
```

与：

```text
业务状态变化
```

之间几乎没有足够强的结构化边界。

而 Command 架构变成：

```text
LLM
 ↓
CommandIntent
 ↓
Canonical Command
 ↓
Authorization
 ↓
Policy
 ↓
Approval
 ↓
Re-validation
 ↓
Idempotency
 ↓
Executor
 ↓
Business State
```

这让系统能够把几个本来混在一起的问题拆开：

```text
“想做什么？”
→ Command

“能不能做？”
→ Authorization / Policy

“是否需要人批准？”
→ Approval

“现在状态还允许吗？”
→ Re-validation

“执行一次还是重复执行？”
→ Idempotency

“最终发生了什么？”
→ Business State / Event

“事后怎么证明？”
→ Audit Evidence
```

这正是金融系统特别需要的结构。

尤其需要强调：

> **Command 本身不是安全机制。**

它不能替代 IAM、Data Entitlement、Policy、Risk Engine、Approval 或 Domain Rules。

Command 的价值在于：

> **它给这些控制提供了一个明确、稳定、可审计的业务对象。**

这也是为什么 Command 非常适合成为 Agent 与传统 Enterprise Business System 之间的桥梁。

---

# 最终推荐的架构原则

可以压缩成八句话：

```text
1. Agent 可以 propose，但不直接决定 Business State。
2. Tool 表达 capability，Command 表达 business intent。
3. Command 不等于 Authorization。
4. Approval 必须绑定具体 Command。
5. Approval 后执行前必须重新验证关键条件。
6. Side-effecting Command 必须具备幂等和明确的失败语义。
7. Business State 永远由 Business System 持有。
8. Command / Approval / Execution / Business Event 应形成完整证据链。
```

再进一步：

```text
                 Reasoning Space
                      很大
                       │
                       ▼
                  Command
                Boundary
                      │
                       ▼
                 Authority Space
                      很小
                       │
                       ▼
                Business Side Effect
                      最小
```

这应该成为金融服务 Agent 平台设计高风险操作时的一条基础原则：

> **允许 Agent 自主思考，但不要允许 Agent 自主把思考直接变成业务事实。**

---

# 参考资料

### 1. AWS — Secure Agent Tool Usage / Agentic AI Lens

AWS 当前 Agentic AI Lens 将 Tool Authorization、最小权限、身份传播、高风险 mutation、Human-in-the-loop 和 Tool Registry 作为核心 Agent 安全控制。

[AWS Agentic AI Lens — Secure agent tool usage](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentsec02.html?utm_source=chatgpt.com)

### 2. AWS — Tiered Human Oversight and Approval

按动作风险和可逆性分类 Autonomous / Notify / Approve，并要求高风险操作经过明确审批。

[AWS Agentic AI Lens — Tiered human oversight and approval workflows](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentrel02-bp05.html?utm_source=chatgpt.com)

### 3. AWS — Human-in-the-loop for Critical Decisions

强调高风险操作执行前的人工监督、审批上下文、审计记录，以及将持久授权限制到具体 command、parameter shape 或 resource。

[AWS Agentic AI Lens — Human-in-the-loop for critical decisions](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentsec04-bp02.html?utm_source=chatgpt.com)

### 4. AWS — Security Design Principles

明确提出 Agent 本身不是信任边界；应给予每个 Agent 独立身份和最小权限，并在 intent 与 action 之间设置分层 guardrails。

[AWS Agentic AI Lens — Security design principles](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/security-design-principles.html?utm_source=chatgpt.com)

### 5. Microsoft — CQRS Pattern

Microsoft 的 CQRS 指南明确区分 Query 和 Command，并强调 Command 应代表具体业务任务，而不是低层数据更新；Command-side 负责 validation 和 business logic。

[Microsoft Azure Architecture Center — CQRS Pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/cqrs?utm_source=chatgpt.com)

### 6. Martin Fowler — Command Query Separation

经典 Command Query Separation 定义：Query 返回结果且不修改系统可观察状态；Command 修改系统状态。

[Martin Fowler — Command Query Separation](https://martinfowler.com/bliki/CommandQuerySeparation.html?utm_source=chatgpt.com)

### 7. Microsoft — CQRS and Domain Model / Command Stack

Microsoft 关于 DDD + CQRS 的资料进一步说明 command stack 负责修改状态、业务逻辑和一致性，是复杂业务模型的重要写入边界。

[Microsoft — Cutting Edge: Rewrite a CRUD System with Events and CQRS](https://learn.microsoft.com/en-us/archive/msdn-magazine/2016/december/cutting-edge-rewrite-a-crud-system-with-events-and-cqrs?utm_source=chatgpt.com)

### 8. Stripe — Idempotent Requests

Stripe 的公开 API 文档说明 idempotency key 如何保护带副作用的请求免受重复 retry，并检查相同 key 对应参数的一致性。

[Stripe API — Idempotent requests](https://docs.stripe.com/api/idempotent_requests?utm_source=chatgpt.com)

### 9. SEC — Rule 15c3-5 Market Access Risk Controls

SEC 要求具有市场准入的 broker-dealer 建立、记录、维护风险控制和监督程序，包括 pre-order risk controls、authorized-person restrictions、定期审查控制有效性等。这里是金融高风险自动化控制的具体监管案例，并非要求使用 Command Pattern。

[SEC — Risk Management Controls for Brokers or Dealers With Market Access](https://www.sec.gov/rules-regulations/2011/06/risk-management-controls-brokers-dealers-market-access?utm_source=chatgpt.com)

### 10. FINRA — Customer Order Handling / Best Execution

FINRA 2026 年报告强调订单流监督、持续监控、定期严格评审以及对执行质量的证据化分析。

[FINRA — Customer Order Handling: Best Execution and Order Routing Disclosures](https://www.finra.org/rules-guidance/guidance/reports/2026-finra-annual-regulatory-oversight-report/best-execution?utm_source=chatgpt.com)

### 11. FINRA — GenAI: Continuing and Emerging Trends

FINRA 2026 年针对 GenAI 的监管观察强调正式的 review/approval、治理与监控框架，以及对模型版本、Prompt、Output、可靠性和准确性的持续测试与监控。

[FINRA — GenAI: Continuing and Emerging Trends](https://www.finra.org/rules-guidance/guidance/reports/2026-finra-annual-regulatory-oversight-report/gen-ai?utm_source=chatgpt.com)

### 12. FSB — Financial Stability Implications of AI

FSB 从金融稳定角度指出 AI 带来的 third-party dependency、provider concentration、cyber risk、model risk、data quality 和 governance 风险。

[FSB — The Financial Stability Implications of Artificial Intelligence](https://www.fsb.org/2024/11/the-financial-stability-implications-of-artificial-intelligence/?utm_source=chatgpt.com)

### 13. MCP Architecture

MCP 官方架构将 Host 定位为负责连接权限、用户授权和安全边界的一侧，而 Server 负责提供聚焦能力；这支持“Tool/Protocol 与真正 Authorization Boundary 分离”的设计。

[Model Context Protocol — Architecture](https://modelcontextprotocol.io/specification/2025-03-26/architecture?utm_source=chatgpt.com)

### 14. AWS — AgentCore Policy / Tool Authorization

AWS AgentCore 当前提供外部 Policy、Tool Authorization、细粒度工具访问和 Human-in-the-loop 能力，可作为 Command 前置控制层的实现参考。

[AWS AgentCore Policy Permissions](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/policy-permissions.html?utm_source=chatgpt.com)

### 15. AWS — Appendix A: Agentic AI Lens Best Practice Reference

包含 Agent Security、Human Oversight、Reliability、Memory/State、AgentOps 等完整 best practice 列表，适合作为进一步 Architecture Review 的扩展参考。

[AWS Agentic AI Lens — Appendix A](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/appendix-a.html?utm_source=chatgpt.com)

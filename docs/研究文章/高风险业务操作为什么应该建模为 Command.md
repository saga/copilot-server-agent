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

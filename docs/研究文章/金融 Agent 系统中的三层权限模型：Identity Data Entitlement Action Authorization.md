# 金融 Agent 系统中的三层权限模型：Identity / Data Entitlement / Action Authorization

金融 Agent 做到最后，真正困难的通常不是“模型能不能调用工具”，而是：

> **这个 Agent 到底是谁？它能看到哪些数据？它在当前情况下到底被允许做什么？**

这三个问题经常被一个“权限”概念混在一起。

但在金融服务场景中，最好把它们明确拆开：

```text
Identity
   ↓
Who is acting?

Data Entitlement
   ↓
What data may this principal access?

Action Authorization
   ↓
What may this principal do, on which resource,
under which conditions, right now?
```

本文把这三层称为：

> **Identity → Data Entitlement → Action Authorization**

这不是一个已经被监管机构或某一家云厂商正式命名的统一“三层标准”。它是对 Zero Trust、企业 IAM、金融数据 entitlement，以及当前 Agent identity / tool authorization 实践的一个架构归纳。

但这个归纳非常有用，因为它能够解释一个金融 Agent 系统中最常见的三个错误：

```text
有 Identity
≠
可以访问所有数据

可以读取数据
≠
可以执行相关操作

Agent 代表某个用户
≠
Agent 自动继承用户全部权限
```

NIST Zero Trust 的核心思想本身就要求把 authentication 和 authorization 作为离散职能，并针对具体资源进行访问判断，而不是因为“这个主体已经通过认证”就给予隐含信任。

---

## 1. 为什么传统的“一个 IAM 权限”模型在 Agent 时代不够了

传统应用经常可以简化成：

```text
User
  ↓
Authentication
  ↓
Role
  ↓
Permission
  ↓
Resource
```

例如：

```text
Alice
  ↓
Portfolio Manager
  ↓
read:portfolio
  ↓
Portfolio API
```

Agent 出现之后，请求链条变成：

```text
Human
  ↓
Agent
  ↓
Skill
  ↓
Tool
  ↓
API
  ↓
Data / Business System
```

而且 Agent 可能：

* 代表某个用户工作；
* 作为后台 autonomous workload 工作；
* 调用其他 Agent；
* 调用多个不同权限级别的工具；
* 读取不同数据域；
* 最终执行具有业务副作用的 Command。

AWS 当前 Agentic AI Lens 已经明确区分两种 Agent 身份场景：一类是 Agent 代表用户执行操作，另一类是 Agent 在没有用户直接参与的情况下自主运行。AWS 同时要求 Agent 与 Human 身份分离、采用最小权限，并在“代表用户”时传播用户上下文，而不是让 Agent 直接继承用户凭证。

Microsoft 的 Agent ID 设计也采用类似方向：Agent 拥有自己的身份，同时可以请求用户允许的数据和操作权限；Microsoft 还特别把“让 Agent 加入组织”和“允许 Agent 访问具体数据/操作”分成不同授权步骤。

因此，一个成熟 Agent 系统至少需要回答三个不同的问题。

---

# 2. 第一层：Identity —— “到底是谁在调用？”

Identity 解决的是：

> **这个请求来自谁？**

在 Agent 系统中，这个“谁”至少可能包括：

```text
Human User
Agent
Application / Workload
Tool
Service
Organization / Tenant
```

而在 delegated / on-behalf-of 场景中，还需要保留：

```text
User
  +
Agent
```

两层身份。

AWS 当前的 Agentic AI guidance 明确要求每个 Agent-to-Agent 和 Agent-to-Service communication 使用可验证身份；如果 Agent 代表用户操作，应传播用户上下文，但不要让 Agent 直接假设用户的身份或凭证。

因此：

```text
User = Alice
Agent = InvestmentResearchAgent
```

与：

```text
User = Alice
Agent = TradeExecutionAgent
```

应该是可以区分的两个主体。

审计日志至少应该能回答：

```text
谁发起？
哪个 Agent 执行？
是否代表某个用户？
哪个 Workflow / Case？
```

而不是只记录：

```text
user_id = Alice
```

否则以后无法区分：

```text
Alice manually submitted trade
```

和：

```text
Alice asked Agent X
Agent X called Tool Y
Tool Y executed the trade
```

AWS 明确把“Agent identity 与 Human identity 分离”和“audit attribution unambiguous”作为 Agent 身份治理的重要目标。

---

# 3. Identity 本身不等于 Permission

这是第一条必须建立的边界。

```text
Identity
    = Who

Authorization
    = What is allowed
```

NIST Zero Trust 明确将 authentication 和 authorization 作为离散功能：先验证主体，然后由 policy decision / enforcement mechanisms 判断它是否可以访问具体资源。

因此：

```text
Agent X 已经认证成功
```

并不意味着：

```text
Agent X 可以读取所有客户数据
Agent X 可以调用所有工具
Agent X 可以修改所有账户
Agent X 可以执行交易
```

这也是 Microsoft Entra Agent ID 为什么不仅提供 Agent identity，还提供 roles、Graph permissions、resource access 和 Conditional Access 等授权机制。

---

# 4. 第二层：Data Entitlement —— “这个主体能看到哪些数据？”

Identity 解决：

> **Who are you?**

Data Entitlement 解决：

> **What data are you entitled to see or use?**

这是金融服务里特别重要的一层。

一个 Portfolio Manager 可能：

```text
可以看到：
Asia Equity Portfolio

不能看到：
另一团队的 Private Credit Portfolio
```

一个 Trader 可能：

```text
可以看到：
Assigned Accounts

不能看到：
Unrelated Clients
```

一个 Research Agent 可能：

```text
可以读取：
Licensed Market Data

不能读取：
Restricted Research
MNPI-sensitive data
另一个业务单元的客户资料
```

Goldman Sachs 在介绍其 Cloud Entitlements Service 时，对 entitlement 的定义非常接近这里的概念：已知“用户是谁”以后，还必须回答“这个用户在应用中具体被允许做什么、看到哪些数据、是否可以调用某个 API”。Goldman 的 OCES 就是一个基于 policy 和 attributes 的企业级 entitlement 平台。

FINRA 自己的 API 平台也直接使用 **Entitlement** 作为服务访问控制概念，并通过 entitlement 决定客户账户可以访问哪些服务和权限；其 API 认证流程再通过 OAuth token 进入具体 API。

这说明在金融行业，“身份”和“entitlement”本身就是两个长期存在的概念，而不是 Agent 时代才创造出来的。

---

# 5. Data Entitlement 与普通 IAM Permission 有什么不同？

两者可以有重叠，但不应该在概念上混为一谈。

普通 IAM 更常表达：

```text
principal
→ action
→ resource
```

例如：

```text
agent-role
→ s3:GetObject
→ bucket-A
```

而 Data Entitlement 更接近：

```text
principal
+
business context
+
data attributes
→
which data is visible
```

例如：

```text
User = Alice
Role = Portfolio Manager
Region = APAC
Desk = Equity
ClientScope = Fund-A / Fund-B
DataClassification = Internal
```

最终决定：

```text
哪些 Portfolio
哪些 Client
哪些 Security
哪些 rows
哪些 fields
```

AWS 对金融数据访问也有类似实践。AWS 的数据架构资料强调，需要把数据资产、业务过程、数据所有者和适用的数据控制识别清楚；而其金融 Data Mesh guidance 也强调在跨业务单元共享数据时，需要中央治理和安全访问机制。

Microsoft Purview 的数据访问策略更直接区分 data-plane access 和 control-plane access：数据访问策略决定谁可以对具体数据资源执行 Read / Modify 等操作，而资源管理权限则属于另一层。

因此：

> **“可以访问数据库”与“可以看到数据库中的哪些数据”不是同一个问题。**

---

# 6. 金融数据 Entitlement 往往比“RBAC”更细

金融机构中的数据访问往往不是简单：

```text
Role = Trader
→ all trading data
```

而可能受到多个维度约束：

```text
Role
Desk
Legal Entity
Client
Account
Region
Asset Class
Security
Data Classification
Vendor License
Purpose
Time
```

Goldman Sachs 对其 OCES 的介绍就是典型例子：它强调 attribute-driven entitlements，并用它处理“特定用户能看到哪些数据”“谁能够调用什么 API”等问题。

AWS 的一个金融服务 Redshift 案例也明确描述了 entitlement-based data access：同一个数据平台服务 Traders、Quants 和 Risk Managers，但不同用户并不被授权访问全部数据集。

所以 Agent 系统不能简单设计成：

```text
Agent Identity
    ↓
Role
    ↓
All data accessible to that role
```

更合理的是：

```text
Agent Identity
      ↓
Effective Entitlements
      ↓
Data Access Decision
      ↓
Only authorized data enters Agent context
```

---

# 7. 最重要的一条：Data Entitlement 必须在数据进入 Agent Context 之前生效

这是 Agent 系统与传统应用最容易出现差别的地方。

传统应用可能：

```text
Database
  ↓
Application
  ↓
Filter
  ↓
User
```

但 Agent 系统如果变成：

```text
Database
  ↓
Retriever
  ↓
Agent Context
  ↓
LLM
  ↓
Filter
```

就已经太晚了。

因为未经授权的数据已经进入了：

```text
Model Context
Memory
Prompt
Tool Result
Trace
Cache
```

Microsoft 当前 Agent 安全指导明确提醒，AI memory、retrieved documents、conversation summaries、tool outputs 和 cached grounding data 都可能成为敏感信息泄露载体，因此应当像传统数据存储一样受到访问控制、审计和 DLP 保护。

AWS Bedrock 的 RetrieveAndGenerate API 甚至专门提供 `userContext`，用于 access-control filtering，确保检索结果只包含用户有权访问的文档。

因此：

> **Retrieval can return data, but Retrieval must not decide entitlement.**

更准确地说：

```text
Entitlement
   ↓
Retrieval Scope
   ↓
Retrieved Data
   ↓
Agent Context
```

而不是：

```text
Retrieve everything
   ↓
Ask LLM to ignore unauthorized data
```

后者不是可靠的访问控制。

---

# 8. 第三层：Action Authorization —— “现在到底允许做什么？”

这一层解决的问题又不同：

> **即使 Agent 身份正确、数据访问也合法，它现在是否被允许执行这个具体动作？**

例如：

```text
Agent can read portfolio
```

并不意味着：

```text
Agent can place trade
```

又例如：

```text
Agent can read client record
```

不意味着：

```text
Agent can change client address
```

再例如：

```text
Agent can read proxy proposal
```

不意味着：

```text
Agent can submit proxy vote
```

所以：

```text
Data Access
≠
Action Authorization
```

这是金融 Agent 架构中非常重要的一条边界。

---

# 9. Action Authorization 应该针对“具体动作 + 具体资源 + 当前上下文”

传统：

```text
Can Alice execute trades?
```

在 Agent 系统里通常不够。

更合理的问题是：

```text
Can Agent X
perform ExecuteTrade
on Account A
for Security S
with Quantity Q
under Workflow Case C
at this moment
for this purpose?
```

也就是说，Action Authorization 至少可以包含：

```text
Principal
Action
Resource
Parameters
Context
Policy
Workflow State
Approval
Risk
```

AWS AgentCore 的 Policy 就是这种模型。

其 Cedar Policy 明确以：

```text
principal
action
resource
```

作为授权范围，并允许条件访问 token claims 和具体 tool input；例如可以要求某个用户才允许执行退款，同时金额必须低于指定阈值。

AWS AgentCore 的 Gateway Policy 可以在工具调用之前拦截请求，对每个 tool call 进行确定性 authorization；默认 deny，只有显式匹配 permit policy 才能继续。

这正是 Action Authorization 的典型实现。

---

# 10. Action Authorization 不应该由 LLM 自己决定

例如：

```text
Agent:

"I think the user probably intended to execute this trade."
```

不能成为：

```text
Authorization = ALLOW
```

更合理：

```text
Agent Proposal
     ↓
Tool Call Request
     ↓
Authorization Policy
     ↓
ALLOW / DENY / REVIEW
     ↓
Tool
```

AWS 当前 Agentic AI Lens 对 Tool Security 的要求非常直接：每个 tool invocation 应在执行前经过声明式 policy 授权；Agent identity 和 originating user context 应沿授权链传播；高风险 mutating operations 应在必要时进入 human checkpoint。

Microsoft 当前 Agent 安全指导也采用相同思路：在 tool execution 前进行 policy check，至少考虑 user、tenant、agent、tool、target resource、permission、approval 和 audit，并明确指出 authorization should be enforced outside the model。

因此：

> **LLM 可以提出 Action，但不能成为 Action Authorization 的最终权威。**

---

# 11. 三层权限不是三个互相独立的系统

“分层”不意味着必须部署三个不同的 Policy Engine。

可以：

```text
一个 IAM 平台
+
一个 Entitlement 服务
+
一个 Policy Engine
```

也可以：

```text
Entra
+
Purview
+
Application Policy
```

还可以：

```text
IAM
+
Data Platform RLS
+
Tool Gateway
```

真正需要分离的是：

```text
decision semantics
```

而不是：

```text
physical infrastructure
```

例如一个统一 Authorization Service 完全可以同时处理：

```text
Identity Claims
Data Entitlements
Action Policy
```

但内部仍然应该明确：

```text
identity decision
data decision
action decision
```

这样以后才能知道：

```text
为什么这个请求被拒绝？
```

究竟是：

```text
Identity invalid
Data not entitled
Action not authorized
```

否则所有失败最终都会变成：

```text
403 Forbidden
```

对运营、审计和问题排查都不够。

---

# 12. 三层模型可以理解成三道不同的问题

可以用下面的方式理解：

```text
┌───────────────────────────────────────┐
│ 1. Identity                           │
│                                       │
│ Who are you?                          │
│ Who initiated this request?           │
│ Which agent is acting?                │
│ On behalf of whom?                    │
└──────────────────┬────────────────────┘
                   ↓
┌───────────────────────────────────────┐
│ 2. Data Entitlement                   │
│                                       │
│ What data may you access?             │
│ Which client/account/security?        │
│ Which rows/fields/documents?          │
└──────────────────┬────────────────────┘
                   ↓
┌───────────────────────────────────────┐
│ 3. Action Authorization               │
│                                       │
│ What may you do now?                  │
│ On which resource?                    │
│ Under which policy / state / approval?│
└──────────────────┬────────────────────┘
                   ↓
                 Execute
```

可以浓缩成：

> **Identity answers WHO.
> Data Entitlement answers WHAT DATA.
> Action Authorization answers WHAT ACTION.**

---

# 13. 为什么“有数据权限”不能推出“有操作权限”

考虑一个投资经理：

```text
Alice
```

她可以读取：

```text
Fund A
Holdings
Risk
Research
```

所以：

```text
Data Entitlement = ALLOW
```

但是：

```text
ExecuteTrade(Fund A)
```

是否允许，还要看：

```text
Trading mandate
Limit
Restricted list
Workflow state
Approval requirement
Time window
Segregation of duties
```

结果可能是：

```text
Read portfolio → ALLOW

Analyze portfolio → ALLOW

Create trade proposal → ALLOW

Submit trade → REVIEW

Execute trade → DENY
```

这才符合金融业务实际。

FFIEC 关于金融机构 authentication and access 的指导也强调 access approval、least-privilege provisioning，以及对 service accounts 和系统访问权限的治理。

AWS Financial Services Industry Lens 进一步把 Agent action boundaries、fine-grained permission、least privilege、tool access controls 和 separation of duties 都作为金融 Agent 的重要安全实践。

---

# 14. 反过来，“有 Action 权限”也不能自动推出“有数据权限”

这同样容易被忽略。

假设 Agent 有：

```text
SubmitProxyVote()
```

这个 Command 权限。

并不意味着 Agent 可以：

```text
ReadEveryClientPortfolio()
```

也不能因为：

```text
Agent can ExecuteTrade
```

就允许：

```text
Agent can read all customer data
```

因此最小权限不能简单按：

```text
Agent Role
```

一次性授予全部东西。

应该分别约束：

```text
Data Scope
+
Tool Scope
+
Action Scope
```

AWS 当前建议每个 Agent 只获得其特定功能所需的最小权限，并强调 runtime access boundaries 应限制模型推理本身无法扩大 Agent 的可达范围。

---

# 15. “代表用户”尤其容易出现 Confused Deputy

最危险的模式之一是：

```text
Alice
  ↓
Agent
  ↓
Assume Alice's full role
  ↓
Everything Alice can do
```

这样非常方便，但风险很大。

AWS 明确将“Agent 直接 assume user role”列为需要避免的模式，因为它会模糊 audit attribution，并可能让 Agent 获得用户全部权限；推荐的是保留 Agent 自己的 identity，同时传播 signed user context。

因此：

```text
Effective Principal
```

最好不是：

```text
Alice
```

而是能够表示：

```text
User = Alice
Agent = ResearchAgent
Workflow = InvestmentIdea#123
Purpose = Research
```

然后 downstream policy 再决定：

```text
这次请求到底允许什么。
```

---

# 16. 一个更适合 Agent 的权限上下文

可以抽象成：

```json
{
  "subject": {
    "user": "alice",
    "agent": "trade-analysis-agent"
  },
  "delegation": {
    "actingOnBehalfOf": "alice"
  },
  "tenant": "fund-platform",
  "workflow": {
    "id": "trade-case-123",
    "state": "APPROVED"
  },
  "dataScope": {
    "accounts": ["A123"],
    "assetClasses": ["equity"]
  },
  "action": {
    "name": "ExecuteTrade",
    "resource": "Order-456",
    "parameters": {
      "quantity": 100000
    }
  }
}
```

这不是某个标准 JSON schema，而是一个架构模型。

它的价值在于：

> 不再把“身份”“数据权限”“动作权限”压缩成一个 token 中的一个 `role=trader`。

---

# 17. Workflow State 应该进入 Action Authorization

这是金融 Agent 很关键的一层。

例如：

```text
TradeCase.state = DRAFT
```

那么：

```text
ExecuteTrade()
```

应该：

```text
DENY
```

即使：

```text
Identity = valid
Data Entitlement = valid
```

如果：

```text
TradeCase.state = APPROVED
```

并且：

```text
Limit OK
RestrictedList = false
Reviewer = authorized
```

才：

```text
ALLOW
```

因此 Action Authorization 不应该只看：

```text
who
```

还要看：

```text
what
where
when
under what workflow state
with which parameters
under which policy
```

AWS AgentCore 当前的 Cedar policy 支持把 tool input、OAuth claims 和 session context 纳入 policy evaluation，甚至支持基于同一 session 历史的 temporal policies。

这正好说明：

> **Action Authorization 是 context-aware decision，而不是简单的 role lookup。**

---

# 18. Proxy Voting 是最容易理解的例子

假设：

```text
Agent = ProxyVotingAgent
User = Portfolio Manager Alice
```

### Identity

```text
Alice
+
ProxyVotingAgent
```

系统知道：

```text
是谁发起？
哪个 Agent 执行？
```

---

### Data Entitlement

Agent 只能读取：

```text
Authorized Fund Holdings
Applicable Proxy Proposals
Approved Research
Relevant Corporate Policy
```

不能读取：

```text
Other Client Holdings
Restricted Research
Unrelated Mandates
```

---

### Action Authorization

即使它可以读取 Proposal，也不意味着：

```text
SubmitProxyVote
```

一定允许。

还需要：

```text
Voting deadline valid
Security eligible
Fund has voting authority
Required Review completed
Reviewer authorized
Workflow state = APPROVED
```

最终：

```text
Identity
   ↓
Data Entitlement
   ↓
Analyze Proposal
   ↓
Workflow Gate
   ↓
Review
   ↓
Action Authorization
   ↓
SubmitProxyVote
```

这个结构与前面讨论的：

```text
Proposal
≠
Business Decision
≠
Command
```

自然衔接。

---

# 19. Trade Execution 更能体现三层分离

考虑：

```text
User:
Alice

Agent:
TradeAgent
```

### Identity

```text
Alice
TradeAgent
```

---

### Data Entitlement

允许：

```text
Account A123
Equities
Research
Risk
```

不允许：

```text
Account B999
Private Credit
Restricted Client Data
```

---

### Action Authorization

请求：

```text
ExecuteTrade
Account = A123
Security = XYZ
Quantity = 100,000
```

Policy 再检查：

```text
Trading Mandate
Position Limit
Order Limit
Restricted List
Market Hours
Workflow Approval
Segregation of Duties
```

结果：

```text
ALLOW
```

或：

```text
DENY
```

或：

```text
REVIEW
```

注意：

```text
Data Entitlement = ALLOW
```

并不自动意味着：

```text
Action Authorization = ALLOW
```

这是三层模型最核心的价值。

---

# 20. 为什么金融行业尤其需要这种模型

金融监管和行业实践并没有规定一个叫做：

```text
Identity / Data Entitlement / Action Authorization
```

的统一三层标准。

但它们长期反复要求的是：

```text
authentication
authorization
least privilege
access approval
segregation of duties
data governance
accountability
auditability
```

FFIEC 对金融机构访问控制明确讨论了 access approval policies、least privilege、authentication 和 service accounts。

BIS 关于 AI 治理的报告则建议把 AI 风险纳入既有 risk management framework，并使用 three lines of defence 明确业务、风险监督和独立 assurance 的责任。

英国金融部门近年的实践也非常明确。Bank of England 2024 年金融服务 AI 调查显示，数据隐私、数据质量、数据安全和数据偏差是企业感知的主要 AI 风险；同时多数使用 AI 的机构已经配置 AI accountability 和 data governance。

2026 年 Bank of England 发布的 Frontier AI “harness engineering” 文章进一步强调，控制不应该只放在模型内部，而应通过用户访问控制、环境隔离、approval workflows、rules of engagement 等方式嵌入 AI 周边 harness 和 operating environment。

这与三层模型的方向高度一致。

---

# 21. Data Entitlement 最容易被 Agent 平台忽视

传统企业其实已经有：

```text
IAM
RBAC
ABAC
Data Governance
RLS
DLP
Entitlement
```

Agent 平台最容易犯的错误是：

```text
用户
  ↓
Agent Platform
  ↓
Vector Search
  ↓
LLM
```

然后认为：

> “因为用户已经登录，所以 Agent 可以搜索公司的知识库。”

实际上需要进一步回答：

```text
用户有什么数据权限？
Agent 是否可以代表用户使用这些权限？
这个 Skill 是否允许读取这些数据？
这个知识库结果是否已经应用 entitlement？
Vendor License 是否允许这种使用？
数据是否允许被发送给这个模型？
```

Microsoft 当前的 Agent 安全指导也明确强调 Agent 应继承已有权限边界，同时由 Purview 等数据控制机制治理数据本身；Agent 不应该因为使用 AI 就获得新的数据访问权。

---

# 22. 金融数据还存在“License Entitlement”

这是金融场景比普通企业更复杂的地方。

例如：

```text
LSEG
FactSet
S&P
MSCI
Bloomberg
```

很多数据并不是：

```text
公司买了
→ 公司所有 Agent 都可以无限访问
```

而可能存在：

```text
license
user scope
desk scope
display rights
non-display use
derived-data rules
redistribution restrictions
```

J.P. Morgan 面向机构投资者的数据管理研究也把 data entitlements 和 secured data sharing 作为金融机构数据管理中的实际挑战。

因此对金融 Agent：

```text
Data Entitlement
```

不仅可能意味着：

```text
security entitlement
```

还可能意味着：

```text
business entitlement
+
vendor / contractual entitlement
```

这也是为什么仅仅依靠：

```text
IAM Role
```

往往不够。

---

# 23. Tool Authorization 是第三层非常关键的 Enforcement Point

Agent 不应该直接拥有：

```text
database credentials
```

然后自由生成 SQL。

更合理的是：

```text
Agent
  ↓
Tool
  ↓
Authorization
  ↓
Business / Data API
```

AWS 当前建议所有 Agent tool 都进入经过安全审查和版本治理的 registry，并在 invocation time 执行 policy；每个 tool 都应该明确其 permissions、data classification 和安全边界。

Microsoft 的 Agent 安全指导也是类似结构：

```text
Agent
  ↓
Tool
  ↓
Policy check
  ↓
Execution
```

而不是：

```text
Agent
  ↓
Prompt
  ↓
LLM decides access
```

---

# 24. 可以把三层权限看成三个不同的 Policy Enforcement Point

一个成熟实现可以是：

```text
                     Request
                        │
                        ↓
                ┌──────────────┐
                │ Identity PEP │
                └──────┬───────┘
                       ↓
                ┌──────────────┐
                │ Data PEP     │
                └──────┬───────┘
                       ↓
                ┌──────────────┐
                │ Action PEP   │
                └──────┬───────┘
                       ↓
                    Execute
```

NIST 对 Policy Enforcement Point 的定义就是：实际保护资源、执行 policy decision 的机制；Zero Trust 架构则通过 PDP/PEP 对具体访问请求进行判断。

在实际系统中，这三个 Enforcement Point 可以位于不同层：

```text
Identity PEP
→ IAM / IdP / Gateway

Data PEP
→ Data API / RLS / Query Layer / Retrieval Layer

Action PEP
→ Tool Gateway / Policy Engine / Domain API
```

这样就算 Agent Runtime 被绕过或者模型输出错误，关键控制仍然存在于 Agent 外部。

---

# 25. 三层模型与“Agent Proposal → Business Decision → Command”正好对应

前面的几个架构问题可以连接起来：

```text
                    Identity
                       │
                       ↓
                  Data Entitlement
                       │
                       ↓
                 Agent Analysis
                       │
                       ↓
                    Proposal
                       │
                       ↓
                 Workflow Gate
                       │
                       ↓
                    Review
                       │
                       ↓
             Action Authorization
                       │
                       ↓
                   Command
                       │
                       ↓
                Business State
```

这里：

```text
Identity
```

解决：

> 谁在做？

```text
Data Entitlement
```

解决：

> 它可以看到什么？

```text
Proposal
```

解决：

> Agent 建议做什么？

```text
Review / Gate
```

解决：

> 这个业务决定是否成立？

```text
Action Authorization
```

解决：

> 这个具体动作现在是否真的被允许？

```text
Command
```

解决：

> 最终改变了什么业务状态？

这个链条比“Agent 有什么权限”精确得多。

---

# 26. 三层模型与 Workflow / Skill 的关系

如果把前面的架构进一步组合起来：

```text
Workflow Control Plane
│
├── Business State
├── Task
├── Gate
├── Review
└── Command
      │
      ↓
Action Authorization
      │
      ↓
Business API
```

Agent Runtime：

```text
Agent Runtime
│
├── Identity
├── Context
├── Skills
├── Tools
└── Reasoning
```

Data layer：

```text
Data Platform
│
├── Entitlement
├── RLS
├── Data Classification
└── Audit
```

于是：

```text
Workflow
   controls process

Agent
   reasons inside bounded scope

Skill
   teaches agent how

Data Entitlement
   controls what data enters scope

Action Authorization
   controls what side effects can occur
```

这是一个非常稳定的企业 Agent 架构边界。

---

# 27. 最常见的五个错误

## 错误一：把 Agent Identity 当成全部权限

```text
Agent has identity
→ grant broad role
```

结果就是：

```text
Identity
=
Data access
=
Tool access
=
Action authority
```

这违反 least privilege，也很难处理 delegated access。AWS 明确建议保持 Agent 与 Human identity 分离，并对 Agent 使用 permission boundaries、短期凭证和动态限制。

---

## 错误二：Retriever 先拿所有数据，再让 LLM 过滤

```text
Retrieve everything
→ LLM
→ filter
```

这是错误的控制边界。

应该：

```text
Entitlement
→ Retrieval
→ Context
```

AWS 和 Microsoft 当前文档都提供了直接证据，说明 retrieval/context 本身必须纳入 data access controls。

---

## 错误三：能读取就能修改

```text
read:portfolio
→ execute_trade
```

这不成立。

Read permission 与 mutate permission 应该分开。

Microsoft 当前 Agent enterprise-readiness guidance 甚至建议把 tools 明确标记为：

```text
read-only
draft-only
write-capable
privileged
external-facing
```

并对 write-capable / high-impact operations 增加 approval。

---

## 错误四：用 Prompt 代替 Action Authorization

```text
System Prompt:
Never transfer more than $1M.
```

这不是可靠的 Authorization Boundary。

正确：

```text
Tool Call
   ↓
Policy Engine
   ↓
amount <= limit ?
```

AWS AgentCore Policy 和 Microsoft Agent security guidance 都把 deterministic policy enforcement 放在 model 外部。

---

## 错误五：Agent 直接继承用户全部权限

```text
User
  ↓
Agent
  ↓
AssumeUserRole
```

这会产生 confused-deputy 和 audit attribution 问题。

更合理：

```text
User Identity
+
Agent Identity
+
Delegation Context
+
Policy
```

AWS 当前 Agentic AI Lens 对这一点已经有非常明确的建议。

---

# 28. 一个推荐的企业 Agent Authorization Architecture

可以把整体架构设计成：

```text
                         Human
                           │
                           ↓
                    ┌─────────────┐
                    │   Identity  │
                    │  IdP / IAM  │
                    └──────┬──────┘
                           │
                     user context
                           │
                           ↓
                    ┌─────────────┐
                    │ Agent       │
                    │ Identity    │
                    └──────┬──────┘
                           │
                           ↓
                  ┌─────────────────┐
                  │ Workflow / Case │
                  │ Context         │
                  └────────┬────────┘
                           │
             ┌─────────────┴─────────────┐
             ↓                           ↓
      Data Entitlement             Action Policy
             │                           │
             ↓                           ↓
       Retrieval / Data API        Tool Gateway
             │                           │
             ↓                           ↓
        Agent Context                Command
                                         │
                                         ↓
                                  Business System
```

其中：

```text
Identity
```

负责：

```text
authenticate
identify
delegate
audit
```

```text
Data Entitlement
```

负责：

```text
read
query
retrieve
row/field/document scope
data license
tenant scope
```

```text
Action Authorization
```

负责：

```text
tool
command
write
submit
approve
delete
execute
```

---

# 29. Audit 也应该按三层记录

金融 Agent 不应该只记录：

```text
Agent invoked tool X
```

至少应该能够重建：

### Identity Evidence

```text
User
Agent
Delegation
Session
Tenant
```

### Data Evidence

```text
Which data scope was authorized?
Which policy applied?
Which resources were accessed?
Which entitlement version?
```

### Action Evidence

```text
Which action?
Which resource?
Which parameters?
Which policy?
Which workflow state?
Which approval?
ALLOW / DENY / REVIEW
```

Microsoft 当前 Agent identity guidance 也明确要求 audit 记录能够连接：

```text
user request
agent decision
policy check
tool execution
resource touched
outcome
```

这比单纯的 LLM trace 更接近金融真正需要的 audit evidence。

---

# 30. 三层模型也适合做“最小权限”的计算

可以把 effective authority 概念化为：

```text
Effective Data Access
=
Identity
∩
Data Entitlement
∩
Context
```

而：

```text
Effective Action Authority
=
Identity
∩
Action Policy
∩
Resource Scope
∩
Workflow State
∩
Approval / Risk Conditions
```

这不是一个正式标准公式，而是设计时非常有用的思考模型。

例如：

```text
Agent
```

即使拥有：

```text
trade:execute
```

如果：

```text
Account ∉ Data Scope
```

仍然不能操作这个账户。

即使：

```text
Account ∈ Data Scope
```

如果：

```text
WorkflowState != APPROVED
```

仍然不能执行。

即使：

```text
WorkflowState = APPROVED
```

如果：

```text
Amount > Limit
```

仍然应该：

```text
DENY / REVIEW
```

这样就不会把所有权限压缩成一个粗粒度的：

```text
role = trader
```

---

# 31. 最终设计原则

### Principle 1

**Identity 只回答“谁”，不回答“能访问什么”。**

### Principle 2

**Data Entitlement 决定数据范围，不自动授予业务动作权限。**

### Principle 3

**Action Authorization 决定当前具体操作是否允许，不应该由 LLM 自己决定。**

### Principle 4

**Agent Identity 与 Human Identity 应保持可区分。**

### Principle 5

**代表用户执行时，不要让 Agent 直接继承用户全部权限；保留 delegation context，并在下游重新进行 authorization。**

### Principle 6

**数据 entitlement 必须在数据进入 Agent context 之前生效。**

### Principle 7

**Read 权限与 Write / Execute 权限应该明确区分。**

### Principle 8

**高风险 Action 应结合 Workflow State、Policy、Approval、Limit、Segregation of Duties 等上下文重新授权。**

### Principle 9

**同一个 Policy Engine 可以实现多层控制，但 Identity、Data Entitlement、Action Authorization 的语义必须分开。**

### Principle 10

**不要把 Skill、Prompt、Memory 或 Agent reasoning 当作企业最终的 Authorization Boundary。**

---

# 32. 最终模型

金融 Agent 的权限模型可以浓缩成：

```text
                 ┌──────────────────┐
                 │    Identity      │
                 │ Who?             │
                 └────────┬─────────┘
                          ↓
                 ┌──────────────────┐
                 │ Data Entitlement │
                 │ What data?       │
                 └────────┬─────────┘
                          ↓
                     Agent / LLM
                          ↓
                      Proposal
                          ↓
                 ┌──────────────────┐
                 │ Action AuthZ     │
                 │ What action?     │
                 │ Which resource?  │
                 │ Under conditions?│
                 └────────┬─────────┘
                          ↓
                       Command
                          ↓
                  Business System
                          ↓
                  Business State
```

最终可以记成三句话：

> **Identity：你是谁。**

> **Data Entitlement：你能看到什么。**

> **Action Authorization：你现在被允许做什么。**

在普通应用中，这三个问题有时可以被一个 IAM 体系部分覆盖；但在金融 Agent 中，随着 Agent、Tool、Data、Workflow、Human Approval 和 Business Command 串联起来，**把三者明确分层会显著减少权限扩大、数据越权、Agent confused deputy 和高风险操作绕过控制的风险。**

更重要的是，它建立了一个非常明确的控制原则：

```text
Agent can reason.
Agent cannot grant itself identity.

Retrieval can return data.
Retrieval cannot grant data entitlement.

Agent can propose an action.
Agent cannot grant itself action authorization.

Only the authorized control path
can change the business state.
```

这与当前 AWS Agentic AI Lens、Microsoft Agent Identity / Agent Security、NIST Zero Trust 以及金融行业长期采用的 least privilege、entitlement、separation of duties 和 auditability 思路是一致的。

## 参考资料

**[1] NIST — Zero Trust Architecture (SP 800-207)**
NIST 将 authentication 与 authorization 明确定义为离散职能，并强调针对资源进行访问控制，而不是基于网络位置建立隐含信任。
[NIST SP 800-207](https://csrc.nist.gov/pubs/sp/800/207/final?utm_source=chatgpt.com)

**[2] NIST — Zero Trust Architecture Model for Cloud-Native Applications (SP 800-207A)**
强调针对 user、service、resource 的 identity-based authentication / authorization，以及 PDP / PEP 的政策控制。
[NIST SP 800-207A](https://csrc.nist.gov/pubs/sp/800/207/a/final?utm_source=chatgpt.com)

**[3] AWS — Agent identity and permission management, Agentic AI Lens**
AWS 对 Agent identity、Human identity separation、delegated user context、least privilege、short-lived credentials 和 permission boundaries 的当前指导。
[AWS Agentic AI Lens — Agent identity and permission management](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentsec03.html?utm_source=chatgpt.com)

**[4] AWS — Secure agent tool usage, Agentic AI Lens**
要求 Tool invocation 在执行前通过 policy 授权，并强调工具范围、参数校验、高风险操作和审计。
[AWS Agentic AI Lens — Secure agent tool usage](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentsec02.html?utm_source=chatgpt.com)

**[5] AWS — Limit agent permissions to minimum required access**
AWS 对 Agent least privilege 和 runtime access boundaries 的具体建议。
[AWS Agentic AI Lens — Limit agent permissions to minimum required access](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentrel02-bp02.html?utm_source=chatgpt.com)

**[6] AWS — Amazon Bedrock AgentCore: Authorization with Cedar**
展示 principal / action / resource / condition 的细粒度授权，以及 default deny 和 forbid-wins 模型。
[AgentCore — Understanding Cedar policies](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/policy-understanding-cedar.html?utm_source=chatgpt.com)
[AgentCore — Authorization flow](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/policy-authorization-flow.html?utm_source=chatgpt.com)

**[7] AWS — Amazon Bedrock AgentCore: Identity and Access Management**
说明身份认证与基于 policy 的 authorization 如何在 AgentCore 中分离。
[AgentCore IAM](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/security-iam.html?utm_source=chatgpt.com)

**[8] AWS — Bedrock RetrieveAndGenerate: userContext access filtering**
明确支持通过 user context 对 retrieval result 做授权过滤，确保只返回用户有权访问的文档。
[Amazon Bedrock RetrieveAndGenerate API](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_agent-runtime_RetrieveAndGenerate.html?utm_source=chatgpt.com)

**[9] AWS — Financial Services Industry Lens: Security**
金融服务场景中的 Agent authentication / authorization、fine-grained permissions、agent action boundaries、tool access controls 等。
[AWS Financial Services Industry Lens — Security](https://docs.aws.amazon.com/wellarchitected/latest/financial-services-industry-lens/security.html?utm_source=chatgpt.com)

**[10] AWS — Financial Services Industry Lens: Separation of Duties**
讨论金融服务中的 separation of duties、审批和 IAM 历史审计。
[AWS Financial Services Industry Lens — Separation of Duties](https://docs.aws.amazon.com/wellarchitected/latest/financial-services-industry-lens/fsisec04.html?utm_source=chatgpt.com)

**[11] AWS — Financial Services Industry Lens: Elevated Credentials and Privilege Escalation**
讨论金融机构对 IAM permissions、高权限凭证以及生成式 AI 工作流中的权限边界治理。
[AWS Financial Services Industry Lens — Elevated Credentials and Privilege Escalation](https://docs.aws.amazon.com/wellarchitected/latest/financial-services-industry-lens/fsisec03.html?utm_source=chatgpt.com)

**[12] Microsoft — Authorization in Microsoft Entra Agent ID**
微软对 Agent identity、roles、permissions 和 Agent-specific authorization 的当前设计。
[Microsoft Entra Agent ID — Authorization](https://learn.microsoft.com/en-us/entra/agent-id/authorization-agent-id?utm_source=chatgpt.com)

**[13] Microsoft — Entra Agent ID sign-in and data access**
区分 Agent identity、组织信任以及对具体数据 / 操作的允许。
[Microsoft Entra Agent ID — Sign-in process](https://learn.microsoft.com/en-us/entra/agent-id/sign-in-process?utm_source=chatgpt.com)

**[14] Microsoft — Least privilege for AI agents with Entra Agent ID**
将 identity、scope、tool access、auditability 和 JIT entitlements 作为 Agent least-privilege 的核心。
[Microsoft — Least privilege for AI agents](https://learn.microsoft.com/en-us/security/zero-trust/sfi/least-privilege-for-ai-agents?utm_source=chatgpt.com)

**[15] Microsoft — Access patterns and controls for AI agents**
强调 tool execution 前的 deterministic policy check，并建议显式考虑 user、tenant、agent、tool、resource、permission 和 approval。
[Microsoft — Access patterns and controls for AI agents](https://learn.microsoft.com/en-us/startups/build/identity-management/access-patterns-controls?utm_source=chatgpt.com)

**[16] Microsoft — Secure agents: Identity, access, and data protection**
讨论 Agent 应继承用户已有数据权限，以及通过 Purview 控制数据层访问。
[Microsoft — Secure agents: Identity, access, and data protection](https://learn.microsoft.com/en-us/agents/center-of-excellence/secure-agents?utm_source=chatgpt.com)

**[17] Microsoft Purview — Data owner policies**
明确区分 data-plane access policy 与 control-plane IAM，并展示 data policy 的 Subject / Action / Data Resource 模型。
[Microsoft Purview — Data owner policies](https://learn.microsoft.com/en-us/purview/legacy/concept-policies-data-owner?utm_source=chatgpt.com)

**[18] Goldman Sachs — Using Entitlements for Privileged Access to APIs and Applications**
Goldman Sachs 对 enterprise entitlement 和 attribute-driven access control 的实际金融机构实践。
[Goldman Sachs — Cloud Entitlements Service](https://developer.gs.com/blog/posts/using-entitlements-for-privileged-access-to-apis-and-applications-in-a-cloud-environment?utm_source=chatgpt.com)

**[19] FINRA — fileX Entitlement and Access Control**
FINRA API 平台使用 Entitlement Service 管理客户账户可访问的服务和权限，并结合 OAuth 进行 API authorization。
[FINRA fileX — Entitlement and Access Control](https://developer.finra.org/fileX?utm_source=chatgpt.com)

**[20] FFIEC — Authentication and Access to Financial Institution Services and Systems**
金融机构访问管理中的 access approval、least privilege、authentication、service accounts 等控制实践。
[FFIEC — Authentication and Access to Financial Institution Services and Systems](https://www.ffiec.gov/sites/default/files/media/press-releases/2021/authentication-and-access-to-financial-institution-services-and-systems.pdf?utm_source=chatgpt.com)

**[21] BIS — Governance of AI adoption in central banks**
使用现有 risk-management framework、three lines of defence 和明确责任体系治理 AI 风险。
[BIS — Governance of AI adoption in central banks](https://www.bis.org/publications/governance-ai-adoption-central-banks.htm?utm_source=chatgpt.com)

**[22] Bank of England — Artificial intelligence in UK financial services 2024**
金融机构对 AI 风险、数据治理、accountability 和 governance 的调查结果。
[Bank of England — Artificial intelligence in UK financial services 2024](https://www.bankofengland.co.uk/report/2024/artificial-intelligence-in-uk-financial-services-2024?utm_source=chatgpt.com)

**[23] Bank of England — Frontier AI: Harness engineering, 2026**
强调 AI harness 中的 controlled user access、approval workflows、rules of engagement、environment segregation 和 operational controls。
[Bank of England — Frontier AI: Harness engineering](https://www.bankofengland.co.uk/research/fintech/artificial-intelligence-consortium/frontier-ai-information-sharing-forum/frontier-ai-harness-engineering?utm_source=chatgpt.com)

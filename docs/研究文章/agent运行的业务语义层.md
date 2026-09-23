# 金融服务企业如何为 DeepAgents 建立业务语义层

## ——从 Snowflake Semantic Views 到可执行 Business Ontology

对于一家大型财富管理、资产管理或金融服务企业，真正把 Agent 从“会回答问题”推进到“能够可靠地参与业务”，最容易被低估的并不是模型能力，而是一个更基础的问题：

> **Agent 到底知道什么叫“Account”“Portfolio”“Position”“Client”“Mandate”“Trade”“Vote”“Approval”，以及这些概念在本公司业务中究竟意味着什么？**

大模型已经拥有大量金融常识，但这与企业真正需要的“业务知识”不是一回事。

例如：

> “Client”

模型知道这个词的通用含义，但企业内部可能同时存在：

```text
Retail Customer
Institutional Client
Beneficial Owner
Account Holder
Household
Advisory Client
Fund Investor
```

它们之间存在业务关系、权限边界和生命周期差异。

再例如：

> “Position”

对于模型来说通常就是“持仓”。

但企业内部可能至少存在：

```text
Accounting Position
Trading Position
Custody Position
Available Position
Tax Lot Position
End-of-Day Position
Intraday Position
```

如果 Agent 没有企业自己的语义层，它只能依赖：

```text
LLM pretraining
+
RAG 文档
+
Prompt
```

最终很容易出现一种危险的状态：

> **它“知道金融”，但不知道“我们公司所说的金融业务到底是什么”。**

这正是企业需要建立 Business Semantic Layer / Business Ontology 的原因。

Snowflake 当前的 Semantic Views 非常适合解决其中一部分问题：它把 business entities、facts、dimensions、metrics 和 relationships 建成数据库中的 schema-level semantic objects，并直接服务于 Cortex Analyst / Cortex Agents 的结构化数据查询。Snowflake 还提供 verified queries、custom instructions、tags、RBAC、row access policy 等能力。

但这里需要特别强调：

> **Snowflake Semantic View 可以成为企业 Business Semantic Plane 的重要组成部分，但不应该直接等同于完整的 Business Ontology。**

因为金融企业真正需要的语义不仅有：

```text
Noun
```

还有：

```text
State
Verb
Policy
Constraint
Lifecycle
Evidence
Authorization
```

而 Snowflake Semantic Views 当前官方定义的核心对象主要是逻辑表、事实、维度、指标、关系、过滤器、verified query、custom instructions 等；它非常适合表达“业务数据是什么意思、怎么查询”，但不是完整的业务流程、动作和决策权模型。这个判断是根据其公开数据语义模型边界得出的架构结论。

因此，对于 `DeepAgents + LangSmith + AWS + Kubernetes + Snowflake` 这一组合，更合理的设计不是：

```text
Snowflake Semantic View
        ↓
全部业务语义
        ↓
DeepAgents
```

而是：

```text
                 Business Semantic Plane

        ┌─────────────────────────────────┐
        │ Business Ontology               │
        │ nouns / relationships / types   │
        ├─────────────────────────────────┤
        │ Analytical Semantic Layer       │
        │ Snowflake Semantic Views        │
        ├─────────────────────────────────┤
        │ Operational Semantics            │
        │ states / actions / workflows    │
        ├─────────────────────────────────┤
        │ Policy Semantics                 │
        │ authorization / constraints     │
        ├─────────────────────────────────┤
        │ Evidence & Provenance            │
        │ source / owner / effective date │
        └─────────────────────────────────┘
                         ↓
                  DeepAgents Runtime
                         ↓
                 Tools / Enterprise APIs
```

这篇文章讨论的就是这套架构应该怎样设计、怎样落地，以及 Snowflake Semantic Views 在其中究竟应该放在哪里。

---

# 一、先明确一个最重要的原则：不要二选一

企业经常会把下面三个概念混在一起：

```text
Business Glossary
Semantic Layer
Ontology
```

它们其实不是同一种东西。

## Business Glossary

回答：

> “这个词是什么意思？”

例如：

```text
Net Asset Value:
基金在某一估值时点的资产减去负债后的净值。
```

它解决的是语言统一。

---

## Semantic Layer

回答：

> “这个业务概念如何与企业数据对应？”

例如：

```text
Net Asset Value
    ↓
fund_nav.nav_amount
    ↓
SUM(nav_amount)
    ↓
by fund / valuation_date
```

Snowflake Semantic Views 正是在解决这个层面的问题。

官方定义的 logical tables、dimensions、facts、metrics、relationships，就是把业务概念映射到物理数据。

---

## Ontology

回答：

> “企业世界里到底有哪些东西，它们之间是什么关系？”

例如：

```text
Client
 ├── owns → Account
 ├── advised_by → Advisor
 └── belongs_to → Household

Account
 ├── contains → Position
 └── places → Order

Order
 └── executes_as → Trade

Trade
 └── references → Instrument
```

FIBO 就属于这种更正式的金融业务 ontology。EDM Council 将 FIBO 定义为描述金融业务中感兴趣的概念以及它们之间关系的正式、机器可读本体，并以 OWL 等形式发布；FIBO 经过金融行业机构和 SMEs 的共同治理。

---

# 二、Agent 真正需要的是“四维语义”，而不只是数据字典

对于企业 Agent，我建议把 Business Semantics 定义成四个维度：

```text
1. What
2. How measured
3. What can happen
4. Under what conditions
```

也就是：

```text
Concept
Metric
Action / Process
Policy
```

进一步展开：

| 语义            | Agent 需要知道什么                       |
| ------------- | ---------------------------------- |
| Concept       | Account 是什么？                       |
| Relationship  | Account 与 Client / Portfolio 什么关系？ |
| Metric        | AUM 怎么计算？                          |
| State         | Account 当前处于什么状态？                  |
| Action        | 可以执行什么动作？                          |
| Preconditions | 什么情况下动作合法？                         |
| Policy        | 谁可以执行？                             |
| Process       | 下一步应该进入什么业务状态？                     |
| Evidence      | 这个定义来自哪里？                          |
| Temporal      | 定义在哪个时间点有效？                        |

这比传统的：

```text
table
column
description
```

高了一个层次。

---

# 三、为什么“大模型本身已经知道这些知识”远远不够？

FINRA 在 2026 年对证券行业 Agent 的监管观察中，把 **Domain Knowledge** 单独列为 Agent 风险之一：通用 Agent 可能缺乏完成复杂、行业特定任务所需的领域知识；同时 FINRA 还强调需要考虑 Agent 的 system access、data handling、human-in-the-loop、actions/decisions tracking 和 guardrails。

这里最重要的一点是：

> “金融知识”与“企业业务定义”不是同一个问题。

例如一个模型知道：

```text
AUM = Assets Under Management
```

并不代表它知道：

```text
OurCompanyAUM
```

究竟包括：

```text
discretionary accounts?
non-discretionary accounts?
sub-advisory assets?
fund-of-fund exposure?
temporary cash?
double-counted custody relationships?
```

同样，模型知道：

```text
Trade
```

并不意味着它知道公司内部：

```text
Trade
→ Order
→ Allocation
→ Confirmation
→ Settlement
```

分别由哪些系统产生，哪个对象是 system of record，哪个状态才算真正完成。

因此：

> **企业 Agent 的 semantic grounding，本质上是在把 foundation model 的“世界知识”转换成企业自己的“业务世界模型”。**

---

# 四、行业实际上已经出现了三种不同的答案

目前业界可以看到三条明显路线。

## 第一类：Financial Ontology

典型代表：

```text
FIBO
```

FIBO 的目标就是建立金融行业通用概念和关系的正式模型。它包含金融机构、法律实体、证券、基金、债务、衍生品等多个领域，并用机器可读形式表达概念之间的关系。

优点是：

```text
industry vocabulary
+
formal semantics
+
cross-company interoperability
```

缺点是：

```text
不是你的企业定义
不是你的 workflow
不是你的 authorization
不是你的 system-of-record mapping
```

所以不应该把 FIBO 直接当作企业 Agent ontology，而应该：

> **把 FIBO 作为上层行业参考 ontology，再建立企业自己的 extension。**

---

## 第二类：Business Capability / Service Model

银行业中一个非常成熟的例子是 BIAN。

BIAN 当前 Service Landscape 14.0 包含大量 Service Domains，并提供 Business Capability Model、Business Object Model、Semantic APIs 等结构。

BIAN 特别值得借鉴的一点是，它把：

```text
Business Capability
Business Object
Service Domain
Semantic API
```

联系起来。

BIAN 自己也强调 Business Object Model 是一种业务信息的概念定义，而 Service Domain 的 control record 会把这些通用业务对象放进具体业务上下文。

对于企业 Agent，这实际上非常接近：

```text
Concept
→ Context
→ Capability
→ API / Tool
```

但是 BIAN 更偏银行业务能力架构，不应该直接拿来作为一家资产管理公司的完整 ontology。

---

## 第三类：Operational Ontology

一个很值得研究的商业实践是 Palantir Ontology。

Palantir 将 Ontology 定义为企业 operational layer，不只包含：

```text
objects
properties
links
```

还包含：

```text
actions
functions
security
```

并明确把 objects 视为“nouns”，actions 视为“verbs”，从而让 Ontology 不只是分析层，而可以参与 operational decision-making。

Palantir 的 Action 机制还进一步把 ontology edit、permissions、functions 和外部 side effects 连接起来。

这对企业 Agent 很有启发：

> **如果 Agent 需要真正执行业务，光有“语义数据模型”还不够，还需要把“可做什么”也建模。**

---

# 五、因此，Snowflake Semantic View 应该放在“语义平面”中的什么位置？

我会明确建议：

```text
                 Business Semantic Plane
                         │
        ┌────────────────┼────────────────┐
        │                │                │
        ▼                ▼                ▼
   Business Ontology  Snowflake       Operational
                      Semantic View   Semantics
        │                │                │
        │                │                │
        └────────────────┼────────────────┘
                         │
                     Policy Layer
                         │
                     Evidence Layer
```

其中：

### Business Ontology

负责：

```text
Customer
Account
Portfolio
Fund
Instrument
Position
Order
Trade
Research
Meeting
Vote
Case
Approval
```

以及它们之间的关系。

### Snowflake Semantic Views

负责：

```text
AUM
NAV
Market Value
Exposure
Turnover
Performance
Net Flow
Client Count
```

以及：

```text
dimensions
facts
metrics
relationships
filters
```

### Operational Semantics

负责：

```text
Order states
Trade states
Case states
Approval states
Workflow
Actions
Events
```

### Policy

负责：

```text
who can do what
under what conditions
using which data
```

### Evidence

负责：

```text
definition source
policy source
owner
effective date
version
provenance
```

这五层共同构成 Agent 的“业务世界”。

---

# 六、Snowflake Semantic Views 非常适合做“数据语义真相”，但不要让它承担全部 ontology

Snowflake 当前明确将 Semantic Views 定位为 database-level semantic objects：

```text
business entities
facts
dimensions
metrics
relationships
```

并可直接用于 Cortex Analyst / Cortex Agents。Snowflake 还允许通过 `SEMANTIC_VIEW(...)` 语法直接查询这些语义对象。

这非常适合企业统一定义：

```text
AUM
Market Value
Net Flow
Return
Exposure
Client Count
```

例如：

```text
metric:
    name: assets_under_management

definition:
    market value of eligible managed assets

expression:
    SUM(position.market_value)

dimensions:
    client
    portfolio
    asset_class
    valuation_date
```

这个定义应该尽量只有一个。

不要让：

```text
Power BI
Tableau
dbt
Python
Agent Prompt
Snowflake SQL
```

各自再定义一遍。

Snowflake 自己也强调 semantic views 的价值之一就是让 business definitions 统一，并减少多个应用重复实现 metric logic。

---

# 七、2026 年 Snowflake 的发展方向其实很值得关注

Snowflake 在 2025 年推动 Open Semantic Interchange，参与方包括 Snowflake、Salesforce、dbt Labs、RelationalAI，并有 BlackRock 等金融机构参与生态。2026 年 1 月，Snowflake 宣布 OSI 第一版规范正式发布，用于在 AI、BI 和 analytics 工具之间交换 semantic model，包括 datasets、metrics、dimensions、relationships 和 contexts。该项目目前已转入 Apache Ossie 项目。

这件事的重要意义不在于“再多一个标准”。

而是说明业界正在逐渐形成一个共识：

> **业务语义应该从具体应用和具体 Prompt 中抽出来，成为可交换、可治理、可版本化的独立资产。**

Apache Ossie 当前也明确把目标描述为：让同一套 semantic definitions 可以在 AI agents、BI platforms 和其他工具之间交换使用。

对于企业来说，这意味着：

```text
Snowflake Semantic View
```

不应该是 Agent 的私有 Prompt 数据。

它应该成为企业 semantic infrastructure 的一部分。

---

# 八、但不要把 Snowflake Semantic View 当成“整个企业 Ontology”

这是本文最重要的架构判断。

Snowflake Semantic View 能很好地表达：

```text
Table
Dimension
Fact
Metric
Relationship
Filter
Verified Query
```

甚至当前已经支持：

```text
variables
tags
private/public access
custom instructions
verified queries
ASOF / range relationships
```

这些能力非常强。

但是企业 Agent 还需要：

```text
State
Action
Transition
Precondition
Policy
Approval
Escalation
Evidence
Owner
Business Capability
```

这些不应该全部硬塞进 Semantic View。

因此我建议：

> **Snowflake Semantic View 是企业 Business Semantic Plane 的 analytical projection，而不是全部 ontology 的唯一物理载体。**

这是一条非常重要的边界。

---

# 九、建议把“企业业务语义”设计成一个 Canonical Business Concept Model

企业应该先定义一个自己的 canonical model。

例如投资管理场景：

```text
Party
 ├── Individual
 ├── Organization
 └── Household

Client
 └── Party

Account
 ├── owned_by → Client
 ├── managed_by → Advisor
 └── contains → Position

Portfolio
 ├── managed_by → InvestmentStrategy
 └── contains → Position

Instrument
 ├── Equity
 ├── Bond
 ├── Fund
 └── Derivative

Position
 ├── held_in → Account
 ├── references → Instrument
 └── valued_by → Price

Order
 ├── submitted_for → Account
 ├── references → Instrument
 └── may_result_in → Trade

Trade
 ├── references → Order
 └── settles_to → Position
```

这里每一个概念都有一个稳定的 ID。

例如：

```text
FIN:Account
FIN:Portfolio
FIN:Instrument
FIN:Position
FIN:Order
FIN:Trade
```

不要直接用：

```text
"account"
"portfolio"
"position"
```

作为唯一标识。

因为名称会变，同义词会变，语言会变，但概念身份不应该轻易变化。

---

# 十、每一个 Concept 应该至少有这些属性

建议定义：

```yaml
concept_id: FIN:Position

name: Position

domain: InvestmentManagement

definition: >
  A holding of an instrument within an account
  as of a specified valuation context.

synonyms:
  - holding
  - investment position
  - security position

parent:
  - FIN:InvestmentExposure

relations:
  - type: held_in
    target: FIN:Account

  - type: references
    target: FIN:Instrument

context:
  - accounting
  - trading
  - custody

canonical_sources:
  - system: PortfolioAccounting
    object: positions

owner:
  team: InvestmentDataOffice

effective_from: 2026-01-01

sensitivity:
  classification: Confidential

status: APPROVED

version: 3
```

注意这里真正重要的不是 YAML。

重要的是：

> **Business Concept 成为稳定的企业资产，而不是某个 Prompt 里的自然语言。**

---

# 十一、Concept 和 Data Mapping 必须分开

例如：

```text
FIN:Position
```

在系统里可能对应：

```text
Postgres.position
Snowflake.positions
CustodyAPI.Holding
PortfolioAccounting.Position
```

因此：

```text
Concept
       ↓
Mappings
       ├── Snowflake
       ├── API
       ├── Event
       └── Document
```

一个 Agent 问：

> “这个客户的 AAPL 仓位是多少？”

不能让模型猜：

```text
position_table
holding_table
security_position
account_position
```

应该：

```text
"AAPL position"
       ↓
Concept Resolver
       ↓
FIN:Position
       ↓
Mapping
       ↓
Portfolio Semantic View
```

这就是 semantic grounding 真正应该发生的地方。

---

# 十二、Snowflake Semantic View 可以成为这个 Mapping 的重要落点

例如：

```text
FIN:Position
       ↓
Snowflake Semantic View
       ↓
logical table: position
```

定义：

```text
account_id
instrument_id
quantity
market_value
valuation_date
```

然后：

```text
metric:
    market_value = SUM(position.market_value)
```

这时 Agent 看到的是：

```text
Position
Market Value
Instrument
Account
Valuation Date
```

而不是：

```text
POS_MV_AMT
ACCT_NO
SEC_ID
VAL_DT
```

这正是 Semantic View 对 Agent 的价值。

Snowflake 官方明确指出，Semantic Views 就是为了把业务语言与物理数据 schema 解耦，并帮助 AI 使用 business concepts 生成 SQL。

---

# 十三、不要让 DeepAgents 直接看到整个 Snowflake Schema

这是很重要的实现原则。

不要：

```text
DeepAgents
  ↓
show all tables
  ↓
show all columns
  ↓
LLM 自己选择
```

而应该：

```text
DeepAgents
  ↓
Business Concept Resolver
  ↓
Relevant Semantic Domain
  ↓
Relevant Semantic View
  ↓
Structured Query
```

例如用户问：

> “过去三个月欧洲股票组合的净流入是多少？”

Agent 首先解析成：

```json
{
  "concepts": [
    "FIN:Portfolio",
    "FIN:AssetClass",
    "FIN:NetFlow",
    "FIN:Region"
  ],
  "time": {
    "from": "2026-06-23",
    "to": "2026-09-23"
  }
}
```

再决定：

```text
PortfolioFlowSemanticView
```

然后生成：

```json
{
  "metrics": ["net_flow"],
  "dimensions": ["portfolio_region"],
  "filters": {
    "asset_class": "Equity",
    "region": "Europe"
  },
  "time_range": "..."
}
```

最后由程序编译成 Snowflake Semantic View query。

---

# 十四、最好不要让 Agent 自由生成企业级 SQL

对于高价值业务语义，推荐：

```text
LLM
 ↓
Semantic Query DSL
 ↓
Validator
 ↓
SQL Compiler
 ↓
Snowflake Semantic View
```

而不是：

```text
LLM
 ↓
raw SQL
 ↓
Snowflake
```

例如：

```json
{
  "subject": "FIN:Portfolio",
  "metrics": [
    "FIN:NetFlow"
  ],
  "dimensions": [
    "FIN:PortfolioRegion"
  ],
  "filters": [
    {
      "field": "FIN:AssetClass",
      "operator": "=",
      "value": "Equity"
    }
  ],
  "as_of": {
    "from": "2026-06-23",
    "to": "2026-09-23"
  }
}
```

程序层负责：

```text
concept validation
metric validation
relationship validation
date validation
access control
query generation
```

Snowflake Semantic View 再负责：

```text
join semantics
metric formula
aggregation semantics
relationship paths
```

这样可以显著减少 Agent 自己发明业务 SQL 的空间。

---

# 十五、Snowflake Verified Queries 可以成为 Agent 的“业务黄金样例”

Snowflake 当前允许在 Semantic View 中定义 verified queries，即：

```text
Natural language question
+
Verified SQL
```

官方明确说明 verified queries 可以帮助 Cortex Analyst 在类似问题中提高准确性，并且可以作为业务文档和 onboarding 示例。

这实际上非常适合企业 Agent。

例如：

```yaml
verified_queries:

  - question:
      "What is AUM by asset class?"

    sql:
      "..."

    verified_by:
      "InvestmentDataOffice"

  - question:
      "What was the monthly net flow for managed portfolios?"

    sql:
      "..."

    verified_by:
      "PerformanceAnalytics"
```

这些不是简单的 few-shot examples。

它们可以作为：

```text
business contract examples
```

的一部分。

---

# 十六、但“verified query”也不是业务定义本身

这是又一个很容易混淆的地方。

例如：

```text
Question:
"What is AUM?"
```

Verified SQL 可以保证：

```text
正确算出某个 AUM
```

但不能单独证明：

```text
“AUM”在整个公司的治理语义中究竟定义为何物。
```

所以仍然需要：

```text
Concept Definition
+
Metric Definition
+
Verified Query
```

三者组合。

---

# 十七、推荐的 Semantic Object Model

可以设计成：

```text
BusinessConcept
    │
    ├── Definition
    ├── Synonyms
    ├── Relationships
    ├── Contexts
    ├── Owners
    ├── Evidence
    │
    ├── SemanticMappings
    │      ├── SnowflakeSemanticView
    │      ├── API
    │      └── Document
    │
    ├── Metrics
    │      └── Snowflake Metric
    │
    ├── Processes
    │      └── Workflow
    │
    ├── Actions
    │      └── Tool Contract
    │
    └── Policies
           └── Authorization
```

这样：

```text
Concept
```

成为核心。

Snowflake、API、Document、Workflow 都只是这个 Concept 的不同“投影”。

---

# 十八、Business Ontology 和 Snowflake Semantic View 的关系可以理解为“本体 + 投影”

例如：

```text
                 FIN:Position
                      │
           ┌──────────┼──────────┐
           │          │          │
           ▼          ▼          ▼
       Snowflake     API      Document
       Semantic      Object    Evidence
         View
```

Snowflake Semantic View：

```text
分析视图
```

API：

```text
操作 / 实时查询
```

Document：

```text
定义 / 规则 / 证据
```

Ontology：

```text
“Position”这个概念本身
```

这比试图把所有东西塞进 Snowflake 要干净很多。

---

# 十九、Operational Semantics 是 Agent 真正从“懂数据”变成“懂业务”的关键

例如：

```text
ProxyVote
```

不能只有：

```text
vote_id
meeting_id
fund_id
instruction
```

Agent 真正需要知道：

```text
DRAFT
↓
REVIEW_REQUIRED
↓
APPROVED
↓
SUBMITTED
↓
CONFIRMED
```

以及：

```text
submit
amend
withdraw
approve
reject
```

以及：

```text
submit
requires:
    instruction_complete
    authorization_valid
    before_deadline
    no_restricted_condition
```

这才是：

> **Business Semantics → Business Execution Semantics**

---

# 二十、Action 应该成为 ontology 的“verb”

可以参考 Palantir 的设计思想，但不照搬其产品模型。

例如：

```text
Object:
    ProxyVoteCase

Actions:
    create_vote
    amend_vote
    request_review
    approve_vote
    submit_vote
    withdraw_vote
```

每个 Action 定义：

```yaml
action_id: PROXY:SubmitVote

target:
  object: PROXY:VoteCase

inputs:
  - vote_case_id
  - instruction_version

preconditions:
  - case.status == APPROVED
  - instruction.status == VALID
  - current_time < meeting.deadline

authorization:
  capability: PROXY_VOTE_SUBMIT

side_effect:
  system: ISS
  operation: submitVote

idempotency:
  key: vote_case_id + instruction_version

success_state:
  CONFIRMED
```

现在 Agent 才真正知道：

> “Submit Vote”不是一个自然语言概念，而是一个有 contract 的 business action。

---

# 二十一、Policy 也应该关联到 Concept 和 Action，而不是 Prompt

例如：

```yaml
policy_id: PROXY.SUBMIT.001

action:
  PROXY:SubmitVote

resource:
  PROXY:VoteCase

conditions:
  - actor.has_capability("PROXY_VOTE_SUBMIT")
  - actor.has_entitlement(vote_case.fund)
  - vote_case.status == "APPROVED"
  - now < vote_case.deadline
```

Agent 可以读取这个 Policy 的解释：

```text
“SubmitVote requires an approved VoteCase...”
```

但是最终 enforcement 必须由 Policy service 完成。

这与 AWS Agentic AI Lens 对 agent purpose、autonomy boundary、business process、guardrails 和 decision controls 的要求一致。AWS 当前也明确要求 Agent 的 documented purpose、business process、success criteria 和 escalation path 能够被组织持续维护。

---

# 二十二、所以完整 Business Semantic Plane 应该至少包含五种关系

```text
IS-A
HAS-A
RELATES-TO
CAN-DO
REQUIRES
```

例如：

```text
Equity
    IS-A
Instrument

Portfolio
    HAS-A
Position

Position
    RELATES-TO
Account

Advisor
    CAN-DO
RecommendTrade

SubmitTrade
    REQUIRES
TradeApproval
```

这已经远远超出了一个 metric semantic layer。

---

# 二十三、时间语义必须成为金融 Ontology 的一等公民

这是金融服务里非常容易遗漏、但极其重要的一项。

例如：

```text
“Client's position”
```

到底是：

```text
as of trade time?
end of day?
valuation date?
settlement date?
current time?
```

金融数据经常同时存在：

```text
valid time
transaction time
effective date
valuation date
trade date
settlement date
as-of date
```

Snowflake Semantic Views 当前支持 ASOF / range relationships 等能力，这对某些 point-in-time semantics 很有用。

但企业层面还需要显式建模：

```yaml
temporal_context:
  valid_from:
  valid_to:
  observed_at:
  valuation_date:
  timezone:
```

否则 Agent 很容易回答出：

> “ technically correct，但不是你问的那个时间点。”

---

# 二十四、Context 也是 Ontology 的一部分

同一个概念可以在不同业务上下文中拥有不同含义。

例如：

```text
Position
```

在：

```text
Trading
Custody
Accounting
Risk
Tax
```

中的语义可能并不完全相同。

所以不要试图建立一个绝对扁平的：

```text
Position = ...
```

而应该：

```text
Concept:
    FIN:Position

Context:
    TradingPosition
    AccountingPosition
    CustodyPosition
```

Agent 通过 task context 选择：

```text
FIN:Position@Trading
```

这比给 LLM 一段：

```text
Position has several meanings...
```

可靠得多。

---

# 二十五、真正进入 DeepAgents 的不是整个 Ontology，而是 Context Pack

这是整个实现中非常关键的一步。

DeepAgents 本身已经强调 context management、skills 和 progressive disclosure；它的架构目标之一就是避免把所有信息一次性塞进主 Agent context。

因此 Agent 不应该每次都收到：

```text
20000 concepts
50000 relationships
10000 policies
```

而应该动态生成：

```text
Business Context Pack
```

例如：

```json
{
  "task": "submit proxy vote",

  "concepts": [
    "PROXY:VoteCase",
    "PROXY:VoteInstruction",
    "FUND:Fund",
    "PARTY:Advisor"
  ],

  "relationships": [
    "VoteCase -> belongs_to -> Fund",
    "VoteCase -> has_instruction -> VoteInstruction"
  ],

  "states": [
    "DRAFT",
    "REVIEW_REQUIRED",
    "APPROVED",
    "SUBMITTED"
  ],

  "allowed_actions": [
    "request_review",
    "submit_vote"
  ],

  "policy_refs": [
    "PROXY.SUBMIT.001"
  ],

  "semantic_views": [
    "PROXY_VOTE_CASE_SV"
  ],

  "evidence": [
    "policy://proxy-voting/submission"
  ]
}
```

然后才交给 DeepAgents。

---

# 二十六、Agent 只应该“看到”与当前任务有关的语义

这可以叫：

> **Semantic Context Retrieval**

流程：

```text
User Request
    ↓
Intent / Concept Resolution
    ↓
Candidate Concepts
    ↓
Relationship Expansion
    ↓
Context Filtering
    ↓
Policy Filtering
    ↓
Context Pack
    ↓
DeepAgents
```

例如用户问：

> “为什么这个欧洲客户的 AUM 下降？”

不要把整个企业 ontology 放进去。

只需要：

```text
Client
Portfolio
AUM
Valuation
Flow
Performance
Region
Time
```

以及相关 definitions。

---

# 二十七、Concept Resolver 是整个系统最重要的新组件之一

推荐建立一个：

```text
Semantic Resolver Service
```

提供：

```text
resolve_concept()
resolve_entity()
resolve_metric()
get_relationships()
get_process()
get_action_contract()
get_policy_refs()
get_semantic_views()
```

例如：

```text
resolve_concept(
    text="净资产",
    domain="investment"
)
```

返回：

```json
{
  "concept_id": "FUND:NetAssetValue",
  "confidence": 0.97,
  "context": "fund_valuation",
  "alternatives": [
    "ACCOUNT:NetAssets"
  ]
}
```

关键是：

> **LLM 可以提出 candidate，但 Resolver 决定 canonical ID。**

---

# 二十八、Entity Resolution 也应该进入这个层

例如用户说：

> “我的苹果仓位”

需要解决：

```text
苹果
→ Apple Inc.
→ AAPL
→ Security ID
```

然后：

```text
Position
→ Account
→ Client
```

因此 Agent 需要一个：

```text
Entity Resolver
```

而不是自己猜 ID。

可以使用：

```text
exact match
synonym
Cortex Search
embedding
LLM rerank
business rules
```

但最后必须得到：

```text
canonical_entity_id
```

Snowflake Semantic Views 可以配合 Cortex Search 对高基数文本维度进行模糊匹配；Snowflake 官方也建议为高基数文本维度配置搜索服务，并把 verified queries、synonyms、relationships 等作为 semantic model 的增强手段。

---

# 二十九、不要把 Entity Resolution 全部交给 RAG

例如：

```text
“AAPL”
```

应该尽量通过：

```text
security master
```

解决。

而不是：

```text
vector search → 找一段“Apple”
```

同样：

```text
“Fidelity 401(k) account”
```

最好通过：

```text
Account Master
```

而不是文档。

所以：

```text
Knowledge Retrieval
```

适合：

```text
解释
规则
政策
文档
非结构化知识
```

而：

```text
Semantic Registry
```

适合：

```text
Canonical concepts
Canonical entities
Definitions
relationships
metrics
```

---

# 三十、Document Knowledge 与 Semantic Knowledge 应该分开

这是 Agent architecture 中很值得明确的一点。

### Semantic Layer

回答：

> “这个概念是什么？”

### Knowledge Layer

回答：

> “为什么是这样？依据是什么？”

例如：

```text
Semantic:
    PROXY:SubmissionDeadline

Knowledge:
    Proxy Voting Policy 2026, section 4.3
```

两者组合：

```text
Agent:
“Proxy submission deadline 是 meeting date 前两个工作日。
依据是 Proxy Voting Policy v6.2 section 4.3。”
```

这样：

```text
ontology
+
document evidence
```

共同构成真正的业务 grounding。

AWS 当前 Agentic AI Lens 也明确强调：成熟 Agent 应将组织知识、决策树、验证点和升级路径结构化，而不是只依赖基础模型内的知识。

---

# 三十一、企业业务定义应该有 Evidence

每一个高价值 Concept 不应该只有：

```text
definition
```

还应该：

```yaml
evidence:
  - source_type: policy
    source_id: POL-123
    location: section-4.2

  - source_type: business_glossary
    source_id: GLOSSARY-87

  - source_type: data_contract
    source_id: DC-44

  - source_type: SME_APPROVAL
    reviewer: InvestmentDataOffice
```

这样可以回答：

> “为什么 Agent 认为 `Managed AUM` 是这个定义？”

而不是：

> “因为 Prompt 这么写了。”

---

# 三十二、定义需要 Owner、Version 和 Effective Date

对于金融机构：

```text
Metric Definition
```

可能随时间发生变化。

例如：

```text
AUM v1
effective:
2025-01-01 → 2026-06-30

AUM v2
effective:
2026-07-01 →
```

所以 Agent Run 应该记录：

```text
ontology_version
semantic_view_version
policy_version
process_version
skill_version
model_version
```

这样在审计时可以回答：

> 2026 年 6 月 15 日这个 Agent 为什么这样回答？

因为当时：

```text
Ontology = 3.4
Semantic View = 2.8
Policy = 6.1
Skill = 4.0
```

而不是只知道：

```text
GPT-xxx
```

---

# 三十三、Semantic View 自己也要走软件工程生命周期

Snowflake 现在已经明确支持把 Semantic Views 纳入 data engineering pipeline / data product，并建议业务团队和 data engineering 团队共同拥有 semantic model；Semantic Studio 目前还提供 Git-backed versioning。

因此建议：

```text
Business SME
   ↓
Business Concept Change
   ↓
PR
   ↓
Semantic View Change
   ↓
Automated Validation
   ↓
Semantic Evaluation
   ↓
Review
   ↓
Deploy
```

而不是：

```text
Data Engineer
  ↓
直接修改生产 Semantic View
```

---

# 三十四、自动 Validation 是必须的

Snowflake 本身已经对 Semantic Views 提供 validation rules，例如：

```text
required elements
primary / foreign keys
relationship rules
expression rules
metric semantics
```

语义视图定义时会被验证。

企业平台还应该增加自己的检查：

```text
Concept exists?
All synonyms unique?
Relationships valid?
No circular business definition?
Metric has owner?
Policy reference exists?
Action exists?
System-of-record mapping exists?
Effective date valid?
Security classification present?
```

这些完全可以脚本化。

---

# 三十五、DeepAgents 的 Rule 不应该复制 Ontology

一个常见反模式：

```text
SKILL.md

Position means...
Account means...
AUM means...
Order means...
Trade means...
```

然后几年以后：

```text
Snowflake Semantic View
+
Data Catalog
+
Glossary
+
SKILL.md
+
Prompt
```

里面有五套定义。

结果：

```text
semantic drift
```

应该：

```text
SKILL.md
```

只引用：

```text
FIN:Position
FIN:AUM
FIN:Order
```

然后运行时动态取得 authoritative definitions。

---

# 三十六、Skill 应该告诉 Agent“去哪里找语义”，而不是复制语义

例如：

```markdown
## Business semantics

Before reasoning about investment data:

1. Resolve business concepts through Semantic Resolver.
2. Do not infer enterprise definitions from model knowledge.
3. Use canonical concept IDs.
4. For analytical questions, use approved Snowflake Semantic Views.
5. For business actions, resolve the Action Contract.
6. Never infer authorization from semantic definitions.
7. When concepts are ambiguous, request clarification.
```

这样 Skill 变得非常轻：

```text
Skill
=
how to use semantic infrastructure
```

而不是：

```text
Skill
=
business ontology dump
```

---

# 三十七、DeepAgents 中建议增加一组专门的 Semantic Tools

例如：

```text
resolve_concept
resolve_entity
get_business_context
get_metric_definition
query_semantic_view
get_business_object
get_process_definition
get_action_contract
get_policy_context
get_evidence
```

这些工具应该是：

```text
read-only
typed
auditable
tenant-aware
```

例如：

```python
semantic_query(
    view="INVESTMENT_POSITION",
    metrics=["market_value"],
    dimensions=["asset_class"],
    filters=[
        {"field": "account_id", "op": "=", "value": "ACC123"}
    ],
    as_of="2026-09-22"
)
```

而不是：

```python
run_sql("SELECT * FROM ...")
```

---

# 三十八、对于 DeepAgents，建议把 Semantic Context 放进 `context_schema`

DeepAgents / LangGraph 的 context mechanism 很适合传递 run-scoped business context。DeepAgents 当前的 graph creation 支持自定义 `context_schema` 和 state/checkpointer 等机制。

例如：

```python
class BusinessContext(TypedDict):
    tenant_id: str
    user_id: str

    domain: str

    ontology_version: str
    semantic_context_id: str

    business_object_type: str
    business_object_id: str | None

    authorization_context_id: str
    policy_version: str
```

然后：

```text
Agent
  ↓
context
  ├── domain
  ├── concepts
  ├── semantic views
  ├── business object
  └── policy refs
```

这样不会把：

```text
business semantics
```

全部变成：

```text
chat history
```

---

# 三十九、真正要避免的是“语义漂移”

假设系统里有：

```text
AUM
```

Snowflake：

```text
SUM(position.market_value)
```

Agent Prompt：

```text
“all customer assets”
```

BI：

```text
managed_assets + custody_assets
```

Risk：

```text
gross_exposure
```

最终同一个词：

```text
AUM
```

出现四种含义。

这比模型 hallucination 更难发现，因为每个结果看起来都“合理”。

因此：

> **Enterprise Agent 的 semantic correctness，本质上是防止 business definition drift。**

---

# 四十、为什么 Snowflake Semantic Views 是很好的起点？

因为它已经解决了几个传统企业语义层最难的问题。

第一：

```text
Business definition
```

可以进入数据平台。

第二：

```text
Metric logic
```

不再散落在 SQL / dashboards / notebooks。

第三：

```text
Relationships
```

可以显式定义。

第四：

```text
RBAC
```

可以与 Snowflake privileges 一起管理。

第五：

```text
Verified queries
```

可以作为 production feedback loop。

第六：

```text
Git / CI/CD
```

已经有官方支持路径。

所以我不建议因为“ontology”这个词很大，就重新造一个完整 knowledge graph platform。

---

# 四十一、第一阶段甚至不需要 Graph Database

这是非常重要的实践建议。

不要一开始就：

```text
Neo4j
RDF
OWL
reasoner
knowledge graph
```

全套上。

第一阶段完全可以：

```text
Git
+
YAML/JSON
+
PostgreSQL
+
Snowflake Semantic Views
```

实现：

```text
Business Concept Registry
```

关系也可以先存成：

```text
concept_relation
```

例如：

```text
source_concept
relation_type
target_concept
context
effective_from
effective_to
```

只有当需要：

```text
复杂 graph traversal
semantic inference
cross-domain ontology reasoning
```

时，再考虑 graph database / RDF / OWL reasoner。

FIBO 本身采用 OWL，但这是行业级正式本体的实现形式，并不意味着企业 Agent 平台第一天就必须采用 RDF/OWL 存储。

---

# 四十二、FIBO 更适合用作“外部参考层”

推荐：

```text
External Industry Ontology
        ↓
FIBO
        ↓
Enterprise Extension
        ↓
Company Ontology
```

例如：

```text
FIBO:Security
        ↓
OurCo:TradableSecurity
        ↓
OurCo:RestrictedSecurity
        ↓
OurCo:ProxyEligibleSecurity
```

这样做可以：

```text
避免重新发明金融术语
+
保持行业互操作性
+
保留公司自己的定义
```

而不是：

```text
把 FIBO 原样当成公司 ontology
```

---

# 四十三、BIAN 可以作为 Capability / Service 边界参考

如果公司跨越：

```text
Retail Banking
Wealth Management
Payments
Lending
```

BIAN 的 Business Capability / Service Domain 模型也可以用于帮助定义：

```text
谁负责什么能力
哪个 domain 拥有哪些 business objects
有哪些 API boundaries
```

BIAN 当前 Service Landscape 14.0 继续演进，并包含大量 Service Domains、Business Capability 以及 Information Architecture / Business Object Model。

但对类似 Fidelity 的资产管理、经纪和财富管理企业：

> **FIBO 更适合作为金融概念参考；BIAN 更适合作为 capability/service boundary 参考；企业自己的 ontology 才是 Agent runtime 的最终语义上下文。**

---

# 四十四、Palantir Ontology 给出的最重要启发是“nouns + verbs”

如果只建立：

```text
Client
Account
Portfolio
Position
Trade
```

Agent 会变成：

> “会看数据的 Agent。”

如果进一步建立：

```text
approve
submit
amend
allocate
rebalance
review
escalate
```

Agent 才逐渐变成：

> “知道业务如何运转的 Agent。”

Palantir 官方把对象称作企业的 nouns，把 actions 称作 verbs，并把 actions、functions、security 与 objects 放进统一 operational ontology。

不一定要采用 Palantir 的平台实现，但这个设计思想值得借鉴。

---

# 四十五、因此我建议企业建立“Business Object + Business Action”模型

例如：

```text
Business Object
    ProxyVoteCase

Business Actions
    CreateVote
    AmendVote
    RequestReview
    ApproveVote
    SubmitVote
    WithdrawVote
```

每个 action 有：

```text
input
output
precondition
authorization
policy
state transition
side effect
idempotency
audit event
```

这就形成：

```text
Ontology
    ↓
Operational Contract
    ↓
Tool Contract
```

而 Tool 只是它的一个技术实现。

---

# 四十六、Tool 不应该成为业务定义的 source of truth

例如：

```python
submit_vote(
    case_id,
    instruction
)
```

这个 API 并不应该独自决定：

```text
什么时候 allowed
```

它应该根据：

```text
Action Contract
+
Policy
+
Business State
```

执行。

于是：

```text
Agent
→ Action Proposal
→ Policy
→ Tool
```

而不是：

```text
Agent
→ Tool
→ Tool 自己判断业务含义
```

这会让不同 Agent、不同 UI、不同 workflow 使用同一套业务定义。

---

# 四十七、Semantic Layer 还应该作为 Tool Discovery 的入口

Agent 不应该只问：

> “我有哪些 MCP tools？”

更应该问：

> “当前业务对象有哪些合法动作？”

例如：

```text
Current Object:
    ProxyVoteCase #123

Allowed Actions:
    amend
    request_review
    submit
    withdraw
```

如果：

```text
status = DRAFT
```

则：

```text
submit
```

可能不存在。

或者：

```text
status = APPROVED
```

则：

```text
request_review
```

可能不再合法。

这种动态 capability discovery 比静态：

```text
tools = [
  submit_vote,
  amend_vote,
  approve_vote
]
```

更安全。

---

# 四十八、业务语义应该影响 Agent Routing

例如：

```text
Question:
“帮我算一下这个基金过去一年的净流入。”
```

应路由：

```text
Investment Analytics Agent
```

而：

```text
“帮我修改这个投票指令。”
```

应路由：

```text
Proxy Voting Agent
```

再进一步：

```text
“提交这个投票。”
```

则必须进入：

```text
Controlled Action Workflow
```

而不是仍然使用普通 conversational Agent。

AWS 当前 Agentic AI Lens 强调每个 Agent 应有明确的 business purpose、scope、autonomy level 和 success criteria，并建议把这些规格作为版本化的 operational artifacts。

这与 Semantic Registry 可以自然结合：

```text
Agent
    belongs_to → BusinessDomain
    supports  → Capability
    reads     → Concepts
    acts_on   → BusinessObjects
    performs  → Actions
```

---

# 四十九、于是可以建立 Agent Capability Registry

例如：

```yaml
agent_id: investment_research_agent

business_domain:
  - InvestmentResearch

capabilities:
  - ResearchCompany
  - AnalyzePortfolio
  - ExplainExposure

concepts:
  reads:
    - Client
    - Portfolio
    - Position
    - Instrument
    - ResearchReport

actions:
  allowed:
    - CreateResearchNote

  prohibited:
    - SubmitTrade
    - ChangePosition
```

再例如：

```yaml
agent_id: proxy_voting_agent

business_domain:
  - ProxyVoting

capabilities:
  - AnalyzeMeeting
  - DraftVoteInstruction
  - SubmitVote

actions:
  allowed:
    - CreateVoteProposal
    - RequestReview
    - SubmitVote

constraints:
  submit_vote:
    approval_required: true
```

这样 Agent Registry 与 Business Ontology 就开始连接起来。

---

# 五十、LangSmith 应该成为“语义正确性”的观测与评估层

LangSmith 当前不仅提供 tracing，还支持 offline / online evaluations、human feedback、trajectory evaluation、production monitoring 和 CI/CD evaluation。

这非常适合验证：

> Agent 有没有使用正确的企业语义？

例如每次 Trace 增加：

```text
business_domain
ontology_version
concept_ids
semantic_context_id
semantic_view
business_object_type
business_object_id
policy_version
action_id
workflow_id
```

那么 LangSmith Trace：

```text
User request
    ↓
Concept Resolver
    ↓
Context Pack
    ↓
DeepAgents
    ↓
Semantic Query
    ↓
Tool
```

就可以完整观察。

---

# 五十一、LangSmith Evaluation 应该增加四类 Semantic Evals

## 1. Concept Grounding

问题：

```text
“账户余额”
```

Agent 是否选择了正确：

```text
FIN:AccountBalance
```

而不是：

```text
FIN:CashBalance
```

---

## 2. Relationship Grounding

问题：

```text
“这个客户持有的基金”
```

Agent 是否沿正确关系：

```text
Client
→ Account
→ Position
→ Fund
```

而不是误走：

```text
Client
→ Advisor
→ Fund
```

---

## 3. Metric Grounding

例如：

```text
“净流入”
```

必须使用：

```text
FIN:NetFlow
```

而不是自己写：

```sql
SUM(deposit) - SUM(withdrawal)
```

---

## 4. Process Grounding

例如：

```text
“提交投票”
```

必须知道：

```text
DRAFT
→ REVIEW_REQUIRED
→ APPROVED
→ SUBMIT
```

不能：

```text
DRAFT
→ SUBMIT
```

---

# 五十二、可以把 Semantic Eval 做成一个评分矩阵

例如：

| Eval                   | 类型                     | 是否可自动 |
| ---------------------- | ---------------------- | ----- |
| Concept ID correct     | deterministic          | 是     |
| Entity ID correct      | deterministic / search | 是     |
| Metric selected        | deterministic          | 是     |
| SQL semantics          | deterministic          | 是     |
| Relationship path      | deterministic          | 是     |
| Definition explanation | LLM judge + SME        | 部分    |
| Process step           | deterministic          | 是     |
| Policy interpretation  | deterministic + LLM    | 部分    |
| Evidence completeness  | deterministic          | 是     |
| Business outcome       | domain evaluator       | 部分    |

这和 LangSmith 当前支持的 code evaluator、LLM-as-judge、human feedback、production online evaluation 很吻合。

---

# 五十三、Snowflake 的 Verified Queries 与 LangSmith Dataset 可以形成两级测试体系

这是非常实用的一套组合。

```text
Snowflake
    ↓
Verified Queries
    ↓
SQL / Semantic correctness
```

同时：

```text
LangSmith
    ↓
Evaluation Dataset
    ↓
Agent trajectory / tool selection / response
```

最终：

```text
Semantic Layer CI
+
Agent CI
```

两边一起验证。

---

# 五十四、Business Context Pack 也应该进入 Eval Dataset

例如一个样例：

```json
{
  "input": "欧洲股票组合过去一年的净流入是多少？",

  "expected_concepts": [
    "Portfolio",
    "AssetClass",
    "NetFlow",
    "Region"
  ],

  "expected_metric": "FIN:NetFlow",

  "expected_view": "PORTFOLIO_FLOW_SV",

  "expected_filters": {
    "region": "Europe",
    "asset_class": "Equity"
  }
}
```

这样测试的已经不是：

> “回答像不像正确答案？”

而是：

> **“Agent 有没有进入正确的企业语义世界？”**

---

# 五十五、自动发现 Business Ontology 应该怎么做？

这也是企业真正落地时的难点。

不可能人工从零写：

```text
5000 个 concepts
10000 条 relationships
2000 个 metrics
```

应该建立：

```text
Semantic Discovery Pipeline
```

输入：

```text
Data
+
Documents
+
APIs
+
Code
+
SQL
+
Dashboards
+
Policies
+
Existing Glossary
```

自动提取：

```text
Candidate Concepts
Candidate Relationships
Candidate Definitions
Candidate Metrics
Candidate Synonyms
Candidate Processes
Candidate Actions
```

但必须经过：

```text
LLM extraction
        ↓
deterministic normalization
        ↓
conflict detection
        ↓
SME review
        ↓
approved registry
```

---

# 五十六、哪些内容适合自动发现？

非常适合自动化的包括：

```text
table/column names
business glossary candidates
metric names
synonyms
entity candidates
relationship candidates
workflow verbs
state enum values
policy references
document definitions
existing SQL patterns
```

例如系统发现：

```text
"UMV"
"Managed Value"
"Assets Managed"
"AUM"
"Managed Assets"
```

可以自动聚类成：

```text
candidate concept:
FIN:AssetsUnderManagement
```

但不要自动直接发布成 authoritative definition。

---

# 五十七、自动发现最重要的不是“生成”，而是“冲突发现”

例如：

```text
Business Team A:
AUM excludes custody assets.

Business Team B:
AUM includes custody assets.
```

这不是 LLM 该替企业决定的问题。

Ontology Pipeline 应该产生：

```text
CONFLICT
```

而不是：

```text
AI chose A.
```

建议状态：

```text
DISCOVERED
→ CANDIDATE
→ CONFLICTED
→ SME_REVIEW
→ APPROVED
→ DEPRECATED
```

---

# 五十八、每个 Concept 都可以有“语义置信度”和“治理状态”

例如：

```yaml
status: APPROVED
confidence: HIGH

governance:
  owner: InvestmentDataOffice
  reviewer: PortfolioAccounting
  approved_at: 2026-09-10
```

注意：

```text
confidence
```

不是：

> LLM 觉得它有多自信。

这里更重要的是：

> **Governance confidence**

例如：

```text
LOW
= LLM 自动抽取但没人确认

MEDIUM
= 多数据源一致

HIGH
= SME 审核 + policy/evidence 支持
```

---

# 五十九、Semantic Layer 的治理应该类似代码治理

建议：

```text
Git Repository
    │
    ├── concepts/
    ├── relationships/
    ├── metrics/
    ├── processes/
    ├── actions/
    ├── policies/
    └── semantic-views/
```

例如：

```text
semantic/
  domains/
    investment/
      concepts.yaml
      relationships.yaml
      metrics.yaml
      processes.yaml
      actions.yaml

  mappings/
    snowflake/
    api/

  evidence/
    glossary/
    policies/
```

然后 CI：

```text
lint
↓
schema validation
↓
relationship validation
↓
Snowflake semantic-view validation
↓
verified-query tests
↓
Agent semantic eval
↓
approval
↓
deploy
```

---

# 六十、Snowflake Semantic Studio 可以成为这一流程的一部分

Snowflake 在 2026 年 8 月将 Semantic Studio 以 public preview 形式开放，用于 Semantic View 的 conversational authoring、YAML 编辑、部署，以及 Git-backed version control。

这非常适合：

```text
Data / Analytics Team
```

维护：

```text
metrics
dimensions
relationships
verified queries
```

但建议不要让 Semantic Studio 独自成为企业完整 ontology editor。

企业还需要：

```text
Business Domain Team
```

管理：

```text
concept definition
business process
action
policy
```

---

# 六十一、组织上也应该拆 ownership

推荐：

| 内容                        | Owner                                  |
| ------------------------- | -------------------------------------- |
| Business Concept          | Business SME                           |
| Industry Ontology mapping | Enterprise Data Architecture           |
| Snowflake Semantic View   | Data / Analytics Engineering           |
| Metric                    | Business + Data jointly                |
| Business Process          | Process / Domain Architecture          |
| Action Contract           | Domain API / Engineering               |
| Policy                    | Risk / Compliance / Security           |
| Evidence                  | Data Governance / Knowledge Management |
| Agent usage               | AI Platform                            |
| Evaluation                | AI Platform + SME                      |

这与 Snowflake 自己建议 semantic model 由 business team 与 data engineering team 共同负责的方向一致。

---

# 六十二、对于类似 Fidelity 的组织，最重要的不是“建一个全公司大 ontology”

大型金融机构很容易陷入另一个极端：

```text
Enterprise Ontology Project
    ↓
3000 meetings
    ↓
5000 concepts
    ↓
2 years
    ↓
Nobody uses it
```

不建议这样。

应该采用：

> **Task-driven Ontology**

也就是：

```text
先选 Agent
↓
选具体业务
↓
找必要 Concept
↓
建立最小语义闭环
↓
上线
↓
从真实 Trace 发现缺口
↓
扩展 Ontology
```

---

# 六十三、第一批 Concept 最好围绕高价值 Agent 场景构建

例如一个资产管理企业可以首先建立：

### Investment Research

```text
Client
Portfolio
Fund
Instrument
Position
Exposure
Performance
Benchmark
ResearchReport
Analyst
```

### Proxy Voting

```text
Fund
Security
Meeting
Resolution
VoteInstruction
VoteCase
Policy
Approval
Deadline
```

### Trading

```text
Account
Order
Allocation
Trade
Execution
Settlement
Instrument
Restriction
Mandate
```

### Client Service

```text
Client
Household
Account
Advisor
ServiceCase
Request
Entitlement
Interaction
```

而不是一开始建一个覆盖全公司的抽象 ontology。

---

# 六十四、Business Semantic Plane 最终可以形成“一个概念，多种消费者”

例如：

```text
FIN:Position
```

同时被：

```text
BI
    ↓
Snowflake Semantic View

Agent
    ↓
Semantic Resolver

RAG
    ↓
Document retrieval metadata

Workflow
    ↓
Business Process

API
    ↓
Position Service

Policy
    ↓
Data entitlement
```

这才是真正的 enterprise semantic asset。

---

# 六十五、为什么这比“把业务定义放 Prompt”可靠得多？

Prompt：

```text
Position means...
```

的问题是：

```text
不可查询
不可版本控制
不可审计
不可跨 Agent 复用
不可自动验证
不可与数据直接绑定
不可与 API / workflow 统一
```

Business Semantic Registry：

```text
可查询
可版本控制
可审计
可共享
可评估
可映射
可治理
```

这就是从：

```text
Prompt Engineering
```

向：

```text
Semantic Engineering
```

的变化。

---

# 六十六、Research 也在支持这种方向，但需要谨慎理解

金融知识图谱研究已经明显增加。

例如 2025 年的 FinReflectKG 研究尝试从 S&P 100 公司 10-K 文件中构建金融知识图谱，并采用 schema-guided extraction、rule-based validation、统计验证和 LLM-as-a-judge 等多层评估。研究报告称 reflection-agent 模式在其数据集上的综合表现优于单次和多次抽取基线。

2026 年另一项研究提出 “Structure First, Reason Next”，在 FinQA 上使用知识图谱增强金融文档数值推理，报告相对于 vanilla LLM 约 12% 的 execution-accuracy 提升。

这些研究不能直接证明：

> “企业一定需要 ontology”。

但它们支持一个更谨慎的工程观察：

> **把金融领域的结构化语义显式提供给模型，可以成为提高复杂金融任务可靠性的有效手段；但具体增益依赖任务、数据和实现方式，不能简单外推到所有企业 Agent。**

---

# 六十七、Morgan Stanley 的实践说明：业务知识必须进入 Agent 的可验证上下文

Morgan Stanley 公开介绍其 AI @ Morgan Stanley Assistant 时，重点并不仅是模型，而是企业内部知识检索、专家反馈、eval framework 和持续 regression testing。其公开材料称该助手用于帮助财务顾问访问公司的 knowledge base，并通过持续 evaluation 和 retrieval 调优提高可靠性。

这说明一个关键事实：

> 企业 AI 的问题不是“模型有没有金融知识”，而是“模型能不能在正确的企业知识和业务 context 中工作”。

这正是 Business Semantic Plane 应该解决的问题。

---

# 六十八、Deutsche Bank 的 Agentic AI 实践进一步证明：复杂业务需要“业务流程 + 业务上下文”

Deutsche Bank 在 2026 年公开了两个很有代表性的 Agentic AI 场景。

其 TPRM AI 使用多个 Agent 依次完成 control question 检索、供应商材料分析和结果建议，最终由 trained human assessor review、edit 或 override。

2026 年 9 月，Deutsche Bank Private Bank 又宣布把 Agentic AI 用于 Source of Wealth KYC 流程：系统分析客户材料和批准的外部信息，识别缺口和不一致，并准备供人工审核的 Source of Wealth assessment；银行明确强调 automation 与 human accountability 并存。

这两个案例都没有公开其内部 ontology 实现，因此不能说它们使用了本文提出的具体 semantic architecture。

但它们清楚说明：

```text
Agent
+
Business Process
+
Approved Information
+
Human Decision
+
Governance
```

必须同时存在。

单纯给模型一套通用金融知识是不够的。

---

# 六十九、Fidelity 自身的公开材料也支持这个方向，但不能据此推断其内部实现

Snowflake 在 2022 年公开介绍 Fidelity Investments 的数据云建设时称，Fidelity 当时正在把大量应用迁往云端，并将分散在 100 多个 data warehouses、data marts 和其他 repositories 中的数据进行整合，以提高数据 liquidity。

2026 年 Snowflake 仍有面向 Fidelity 的 Snowflake AI 专场，并覆盖 “Retrieval & Agentic Business Insights”；同年另一个 Fidelity 专场则涉及 Agentic AI、open standards 和 Horizon Catalog 的 semantic context。

这些公开资料说明：

```text
Snowflake
+
统一数据
+
AI
+
semantic context
```

确实是大型金融机构正在关注的方向。

但目前没有可靠公开资料能够证明 Fidelity 内部已经采用：

```text
DeepAgents
+
LangSmith
+
AWS K8s sandbox
+
Snowflake Semantic Views
```

这一整套具体架构。

因此本文把“类似 Fidelity 的企业”作为架构场景，而不是声称 Fidelity 已经采用下面的具体设计。

---

# 七十、Snowflake 本身也已经明确把“shared context”视为 Agent 生产化基础

Snowflake 在 2026 年金融服务相关材料中明确提出：

> models alone do not create business value；需要 shared context、shared business definitions、relationships、accessible data 和 secure connectivity，Agent 才能从回答问题进入 business execution。

这与本文的核心架构判断高度一致：

```text
Model
≠
Business Context
```

而：

```text
Business Context
=
Definitions
+
Relationships
+
Data
+
Actions
+
Governance
```

---

# 七十一、最终建议采用“Business Semantic Plane”这个架构概念

我不建议在企业内部把所有东西简单叫：

```text
Semantic Layer
```

因为这个词容易被理解成：

```text
BI semantic layer
```

更准确的名字可以是：

> **Business Semantic Plane**

里面包含：

```text
1. Business Ontology
2. Analytical Semantic Layer
3. Operational Semantics
4. Policy Semantics
5. Evidence / Provenance
```

其中：

```text
Snowflake Semantic Views
```

属于第 2 层。

---

# 七十二、完整架构

最终可以设计成：

```text
                         USER / APPLICATION
                                │
                                ▼
                     ┌──────────────────────┐
                     │      Session API     │
                     │                      │
                     │ identity             │
                     │ conversation         │
                     │ UI context           │
                     └──────────┬───────────┘
                                │
                                ▼
                    ┌─────────────────────────┐
                    │  Semantic Resolver      │
                    │                         │
                    │ concept resolution      │
                    │ entity resolution        │
                    │ context resolution       │
                    │ business object          │
                    └────────────┬────────────┘
                                 │
                         Business Context
                                 │
                                 ▼
                ┌────────────────────────────────┐
                │      BUSINESS SEMANTIC PLANE   │
                │                                │
                │  ┌──────────────────────────┐  │
                │  │ Business Ontology        │  │
                │  │ Concepts / Relations     │  │
                │  └────────────┬─────────────┘  │
                │               │                │
                │  ┌────────────▼─────────────┐  │
                │  │ Snowflake Semantic Views │  │
                │  │ Metrics / Dimensions     │  │
                │  │ Facts / Relationships    │  │
                │  └────────────┬─────────────┘  │
                │               │                │
                │  ┌────────────▼─────────────┐  │
                │  │ Process / Action Model   │  │
                │  │ State / Transition       │  │
                │  └────────────┬─────────────┘  │
                │               │                │
                │  ┌────────────▼─────────────┐  │
                │  │ Policy Model             │  │
                │  │ Entitlement / Approval   │  │
                │  └────────────┬─────────────┘  │
                │               │                │
                │  ┌────────────▼─────────────┐  │
                │  │ Evidence / Provenance    │  │
                │  └──────────────────────────┘  │
                └───────────────┬────────────────┘
                                │
                         Context Pack
                                │
                                ▼
                      ┌──────────────────┐
                      │    DeepAgents    │
                      │                  │
                      │ Planning         │
                      │ Skills           │
                      │ Subagents        │
                      │ Reasoning        │
                      └────────┬─────────┘
                               │
                     Proposal / Query / Action
                               │
                               ▼
                    ┌────────────────────────┐
                    │ Policy / Action Gateway│
                    └───────────┬────────────┘
                                │
              ┌─────────────────┼──────────────────┐
              ▼                 ▼                  ▼
       Snowflake Query       Domain API        Workflow
       Semantic Views       Business API       Execution
              │                 │                  │
              ▼                 ▼                  ▼
         Analytics/Data     Enterprise SoR     Business State
```

旁边：

```text
DeepAgents
      │
      ▼
LangSmith
  ├── Trace
  ├── Evaluation
  ├── Semantic Grounding Eval
  ├── Tool Trajectory
  └── Business Outcome
```

下面：

```text
AWS / Kubernetes
  ├── Agent Runtime Service
  ├── Sandbox
  ├── Identity
  ├── Secrets
  ├── Network Isolation
  └── Observability
```

---

# 七十三、Kubernetes 在这套架构中的位置反而很清楚

它不负责：

```text
business semantics
business workflow
policy
ontology
```

它只负责：

```text
execute agent safely
```

也就是说：

```text
K8s
=
Execution Plane
```

而：

```text
Business Semantic Plane
=
meaning
```

```text
Policy / Workflow
=
control
```

```text
DeepAgents
=
reasoning
```

```text
LangSmith
=
observability + evaluation
```

这种职责边界非常干净。

---

# 七十四、AWS Agentic AI Lens 对这个设计提供了一个很强的外部验证

AWS 当前的 Agentic AI Lens 已经明确要求 Agent：

```text
documented purpose
business process
scope
autonomy
success criteria
escalation
```

同时建议把 agent roles、handoffs、failure tests、configuration、policies 和 business outcomes 作为长期治理资产。

因此：

> **Business Semantic Plane 不只是帮助模型“回答得更准确”，它实际上也是 Agent Governance 的一部分。**

---

# 七十五、最终应该把 Agent Grounding 做成一个完整链路

最终一次 Agent execution 应该类似：

```text
User Request

“帮我准备这个基金的 proxy vote，
如果已经达到审批条件就提交。”

            ↓

Intent Resolution

PROXY:SubmitVote

            ↓

Concept Resolution

Fund
VoteCase
VoteInstruction
Approval
Deadline

            ↓

Entity Resolution

Fund = FUND:12345
VoteCase = VC:98765

            ↓

Semantic Context

Definitions
Relationships
State
Metric
Policy

            ↓

DeepAgents

Analyze
Retrieve
Plan

            ↓

Business Proposal

SubmitVote(
    VoteCase=VC:98765
)

            ↓

Policy

authorized?
approved?
deadline?
restricted?
entitled?

            ↓

Workflow

APPROVED
→ SUBMISSION_READY

            ↓

Tool Gateway

submit_vote()

            ↓

External System

ISS / Internal Proxy System

            ↓

Business Event

VoteSubmitted

            ↓

Execution State

SUCCEEDED
```

到这里，Agent 才真正从：

```text
“会说金融”
```

变成：

```text
“在公司的业务世界里工作”
```

---

# 七十六、最值得避免的错误

最终可以把整个设计压缩成八个“不要”。

### 不要 1：把 LLM 的金融知识当企业知识

```text
Financial knowledge
≠
Enterprise business definition
```

---

### 不要 2：把 Snowflake Semantic View 当完整 Ontology

它非常适合：

```text
data semantics
metrics
dimensions
relationships
```

但：

```text
workflow
action
approval
policy
```

应该有专门模型。

---

### 不要 3：把整个 Ontology 塞进 Prompt

应该：

```text
resolve
retrieve
contextualize
```

而不是：

```text
dump everything
```

---

### 不要 4：让 LLM 自己决定 canonical concept

应该：

```text
LLM candidate
→ Resolver
→ canonical ID
```

---

### 不要 5：让 Tool 定义业务语义

应该：

```text
Ontology
→ Action Contract
→ Tool implementation
```

---

### 不要 6：让 Snowflake SQL 成为 Agent 的自由发挥空间

推荐：

```text
LLM
→ Semantic Query DSL
→ Validator
→ Semantic View
```

---

### 不要 7：让 Prompt 成为最终业务规则

真正的：

```text
Authorization
State
Policy
Approval
```

必须有确定性控制。

---

### 不要 8：一开始就做全公司的知识图谱

从：

```text
top Agent workflows
```

开始。

用真实 Agent Trace 反推：

```text
missing concept
ambiguous definition
missing relation
missing metric
missing policy
```

再逐步扩大。

---

# 七十七、最终最推荐的落地路线

### 第一层：建立企业 Concept Registry

先建立：

```text
50～200 个高价值概念
```

围绕：

```text
Client
Account
Portfolio
Fund
Instrument
Position
Order
Trade
Research
Vote
Case
Approval
```

等核心对象。

---

### 第二层：让 Snowflake Semantic Views 成为分析语义标准

把：

```text
metrics
facts
dimensions
relationships
filters
verified queries
```

逐步迁移到 Semantic Views。

Snowflake 当前已经提供 semantic-view validation、verified queries、tags、RBAC、row access policy 和 Git/CI/CD 路径，可以成为这一层的主要平台。

---

### 第三层：建立 Semantic Resolver

把：

```text
natural language
```

转换成：

```text
canonical concept/entity IDs
```

这一步对于 Agent 是关键。

---

### 第四层：建立 Business Action Registry

例如：

```text
SubmitVote
CreateOrder
AmendOrder
RequestApproval
GenerateClientNote
```

每个 Action 都拥有：

```text
input
output
preconditions
policy
approval
state transition
side effect
idempotency
```

---

### 第五层：让 DeepAgents 只消费 Context Pack

Agent 不直接维护企业定义。

它消费：

```text
Business Context Pack
```

并通过：

```text
semantic tools
business object tools
action tools
policy tools
```

完成工作。

---

### 第六层：LangSmith 建立 Semantic Evaluation

每次 Agent run 都记录：

```text
ontology_version
semantic_view_version
concepts
entities
metrics
actions
policy
workflow
```

然后建立：

```text
Concept Grounding Eval
Metric Grounding Eval
Process Conformance Eval
Policy Conformance Eval
Evidence Grounding Eval
Business Outcome Eval
```

LangSmith 当前已经支持完整 trace、trajectory、offline/online evaluation、human feedback 与 CI/CD evaluation，可以承载这套质量闭环。

---

### 第七层：从真实生产 Trace 自动发现语义缺口

这是整个系统真正“越用越好”的地方：

```text
Production Trace
       ↓
Wrong Concept?
Ambiguous Concept?
Missing Relationship?
Wrong Metric?
Missing Process?
Missing Policy?
       ↓
Semantic Backlog
       ↓
SME Review
       ↓
Ontology Update
       ↓
Semantic View Update
       ↓
Agent Eval
       ↓
Production
```

这样 Semantic Layer 不再是一个一次性 data modeling 项目。

而是：

> **Agent Production Feedback Loop 的核心资产。**

---

# 七十八、最终架构判断

对于一个类似 Fidelity 的大型金融服务企业，我会采用下面这个定义：

> **不要建设一个“给 Agent 用的 Semantic Layer”；应该建设一个“企业 Business Semantic Plane”，而 Snowflake Semantic Views 是其中负责数据和分析语义的第一等实现。**

整体关系是：

```text
                         ENTERPRISE BUSINESS SEMANTICS
                                      │
               ┌──────────────────────┼──────────────────────┐
               │                      │                      │
               ▼                      ▼                      ▼
       BUSINESS ONTOLOGY       ANALYTICAL SEMANTICS    OPERATIONAL SEMANTICS
               │                      │                      │
        nouns / relations       Snowflake SV          state / action
               │                      │                      │
               └──────────────────────┼──────────────────────┘
                                      │
                                POLICY SEMANTICS
                                      │
                                EVIDENCE / PROVENANCE
                                      │
                                      ▼
                              BUSINESS CONTEXT PACK
                                      │
                                      ▼
                                DEEPAGENTS
                                      │
                         ┌────────────┼─────────────┐
                         ▼            ▼             ▼
                      Analyze       Query         Act
                         │            │             │
                         │            │             ▼
                         │            │        Policy Gateway
                         │            │             │
                         ▼            ▼             ▼
                     Documents    Snowflake      Domain APIs
                                      │
                                      ▼
                                BUSINESS SYSTEMS
```

这里真正的控制边界是：

```text
LLM
    = Reasoning

Ontology
    = Meaning

Snowflake Semantic Views
    = Data Semantics

Process / Action Model
    = How business operates

Policy
    = What is allowed

Evidence
    = Why the definition is trusted

DeepAgents
    = How to reason through the task

LangSmith
    = How to observe and evaluate the reasoning

Kubernetes
    = Where the computation runs safely
```

最终最重要的一句话是：

> **Agent 不应该通过“大模型已经学会的金融知识”理解企业业务，而应该通过一个版本化、可治理、可查询、可验证的 Business Semantic Plane 来理解企业自己的业务世界。**

而在你们准备启用 Snowflake Semantic Views 的情况下，最合适的路径不是另起炉灶建设一套与 Snowflake 平行的“第二个 Semantic Layer”。

更合理的是：

```text
                Canonical Business Concept
                         │
             ┌───────────┼───────────┐
             │           │           │
             ▼           ▼           ▼
        Snowflake      APIs       Documents
      Semantic View   / Tools      / Policy
             │           │           │
             └───────────┼───────────┘
                         ▼
                Business Semantic Plane
                         │
                         ▼
                    DeepAgents
                         │
                         ▼
                   Business Action
```

**Snowflake Semantic Views 负责把“业务定义”可靠地落到企业数据；Business Ontology 负责定义企业世界中的“对象和关系”；Process/Action/Policy 负责定义“这些对象可以发生什么”；Evidence 负责说明“这些定义为什么可信”。DeepAgents 最终消费的是这个统一的 Business Context，而不是自己从大模型知识、RAG 文档和数据库 schema 中临时拼出一个“看起来合理”的业务世界。**

对于金融服务 Agent，这种设计比单纯增加更多 Prompt、更多 RAG、甚至更换更强的模型，都更接近真正的企业级语义基础设施。

---

# 参考资料

1. **Snowflake — Overview of Semantic Views**
   Semantic Views 是 schema-level objects，可以定义 business entities、facts、dimensions、metrics 和 relationships，并用于 Cortex Agents。
   [Snowflake Semantic Views](https://docs.snowflake.com/en/user-guide/views-semantic/overview)

2. **Snowflake — Cortex Analyst**
   说明 Semantic Views 如何把业务概念与物理数据库 schema 解耦，以及 logical tables、dimensions、facts、metrics、relationships、verified queries 和 custom instructions。
   [Snowflake Cortex Analyst](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-analyst)

3. **Snowflake — YAML specification for semantic views**
   Semantic View YAML 规范，包括 relationships、metrics、non-additive dimensions、verified queries、tags 等。
   [Snowflake Semantic View YAML](https://docs.snowflake.com/en/user-guide/views-semantic/semantic-view-yaml-spec)

4. **Snowflake — CREATE SEMANTIC VIEW**
   Semantic View 的正式 DDL 能力，包括 dimensions、facts、metrics、relationships 和 access modifiers。
   [CREATE SEMANTIC VIEW](https://docs.snowflake.com/en/sql-reference/sql/create-semantic-view)

5. **Snowflake — Validation rules for Semantic Views**
   Snowflake 对 Semantic View 的结构、关系、表达式等进行编译时验证。
   [Semantic View Validation](https://docs.snowflake.com/en/user-guide/views-semantic/validation-rules)

6. **Snowflake — Best practices for modeling Semantic Views**
   讨论 scope、descriptions、synonyms、relationships、metrics、verified queries、custom instructions、evaluation 等。
   [Semantic View Modeling Best Practices](https://docs.snowflake.com/en/user-guide/views-semantic/best-practices-modeling)

7. **Snowflake — Best practices for developing and deploying Semantic Views**
   强调业务团队与数据工程团队共同 ownership，以及 RBAC、masking、row access policy 和 CI/CD。
   [Semantic View Development and Deployment](https://docs.snowflake.com/en/user-guide/views-semantic/best-practices-dev)

8. **Snowflake — Semantic Studio**
   2026 年 public preview，支持 conversational authoring、YAML、Git-backed version control 和部署到 live Semantic View。
   [Semantic Studio](https://docs.snowflake.com/en/user-guide/views-semantic/semantic-studio)

9. **Snowflake — Cortex Agents**
   当前 Snowflake Agent 平台使用 Semantic Views 查询 structured data，同时结合 Cortex Search、code execution、custom tools 和 MCP。
   [Snowflake Cortex Agents](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents)

10. **Snowflake — Transition from Cortex Analyst to Cortex Agents**
    2026 年 8 月 Snowflake 推荐逐步转向 Cortex Agents，同时 Semantic Views 和 verified queries 可继续复用。
    [Snowflake transition guidance](https://docs.snowflake.com/en/release-notes/2026/other/2026-08-28-cortex-analyst-transition-cortex-agents)

11. **Open Semantic Interchange / Apache Ossie**
    当前 Apache Ossie 是原 Open Semantic Interchange 项目的延续，目标是为 analytics、BI 和 AI agents 提供 vendor-neutral semantic model exchange。
    [Apache Ossie](https://github.com/apache/ossie)

12. **Snowflake — Open Semantic Interchange specification finalized**
    2026 年 1 月发布 OSI specification，并介绍 Snowflake、BlackRock、Salesforce、dbt Labs、RelationalAI 等参与者。
    [OSI specification announcement](https://www.snowflake.com/en/blog/open-semantic-interchanges-specs-finalized/)

13. **EDM Council — FIBO**
    金融行业业务本体，正式描述金融业务概念及其关系，以 OWL 等机器可读形式发布。
    [Financial Industry Business Ontology](https://edmcouncil.org/financial-industry-business-ontology/)

14. **FIBO ontology repository**
    展示 FIBO 中的证券、基金、债务、衍生品、交易等金融领域 ontology 结构。
    [FIBO ontology tree](https://spec.edmcouncil.org/fibo/ontology/master/latest/tree.html)

15. **BIAN — Service Landscape 14.0**
    银行业 Business Capability、Service Domain、Business Object 和 Semantic API 的成熟参考模型。
    [BIAN Service Landscape](https://bian.org/deliverables/service-landscape/)

16. **BIAN — Business Capability / Business Object Model**
    讨论 Business Capability、Service Domain 与 Business Object Model 的关系，特别值得参考其“业务词典 + 具体业务上下文”的思路。
    [BIAN Business Capability material](https://bian.org/wp-content/uploads/2023/09/20230829_Webinar_QA-GR.pdf)

17. **Palantir — Ontology architecture**
    Palantir 将 Ontology 定义为 operational layer，将 objects/properties/links 与 actions/functions/security 组合起来。
    [Palantir Ontology Architecture](https://www.palantir.com/docs/foundry/object-backend/overview)

18. **Palantir — Why create an Ontology?**
    强调 Ontology 中的 objects 是业务“nouns”，actions 是业务“verbs”，并把决策执行纳入 operational model。
    [Why create an Ontology?](https://www.palantir.com/docs/foundry/ontology/why-ontology)

19. **Palantir — Ontology Actions / Functions**
    说明 function-backed actions、permissions、ontology edits 和 external side effects。
    [Palantir Actions](https://www.palantir.com/docs/foundry/action-types/function-actions-getting-started)

20. **LangChain — Deep Agents**
    DeepAgents 当前被定位为 agent harness，提供 planning、filesystem、subagents、context management、skills，并构建在 LangGraph persistence/checkpointing 之上。
    [DeepAgents](https://github.com/langchain-ai/deepagents)

21. **DeepAgents — Architecture**
    DeepAgents 的 backend、filesystem、store、state、skills、subagents 等架构能力。
    [DeepAgents Architecture](https://github.com/langchain-ai/deepagents/blob/main/libs/ARCHITECTURE.md)

22. **LangSmith — Observability**
    提供 agent tracing、trajectory monitoring、cost/latency、online evaluations 和 production monitoring。
    [LangSmith Observability](https://www.langchain.com/langsmith/observability)

23. **LangSmith — Evaluation**
    支持 offline / online evals、LLM-as-judge、code evaluators、human review、CI/CD evaluation 和 trajectory evaluation。
    [LangSmith Evaluation](https://www.langchain.com/langsmith/evaluation)

24. **AWS Well-Architected Agentic AI Lens — Agent governance**
    强调 Agent 必须与 business processes、roles、responsibilities、success criteria 和 autonomy boundaries 建立明确联系。
    [AWS Agentic AI Lens](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/)

25. **AWS Agentic AI Lens — Organizational knowledge and competencies**
    强调成熟 Agent 应把组织已有的 workflow、decision trees、validation checkpoints、escalation paths 和 domain knowledge 结构化，而不是依赖 foundation model 自身知识。
    [AWS organizational knowledge guidance](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentsus03-bp02.html)

26. **AWS Agentic AI Lens — Operational practices**
    强调 Agent purpose、success criteria、business outcomes、handoffs、failure testing 和持续改进。
    [AWS Agentic AI Operational Practices](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentops01.html)

27. **FINRA — 2026 Annual Regulatory Oversight Report: GenAI Agents**
    对证券业 Agent 风险的讨论，特别涉及 domain knowledge、scope/authority、data sensitivity、auditability、人机协作和 guardrails。
    [FINRA 2026 GenAI Report](https://www.finra.org/sites/default/files/2025-12/2026-annual-regulatory-oversight-report.pdf)

28. **Financial Stability Board — Sound Practices for Responsible Adoption of AI**
    2026 年金融机构 AI governance 与 lifecycle 管理的 consultation framework。
    [FSB AI Sound Practices](https://www.fsb.org/2026/06/sound-practices-for-responsible-adoption-of-artificial-intelligence-ai-consultation-report/)

29. **Morgan Stanley / OpenAI — AI evaluations in financial services**
    Morgan Stanley 使用企业知识库、专家反馈、evaluation framework 和 regression testing 改进金融顾问 AI。
    [Morgan Stanley AI Evals](https://openai.com/index/morgan-stanley/)

30. **Deutsche Bank — Agentic AI in Third-Party Risk Management**
    多 Agent 分阶段处理供应商风险材料，最终由人工 assessor review/edit/override。
    [Deutsche Bank TPRM Agentic AI](https://www.db.com/news/detail/20260513-putting-agentic-ai-to-work-in-third-party-risk-management)

31. **Deutsche Bank Private Bank — Agentic AI for Source of Wealth KYC**
    2026 年 9 月在 Singapore/Hong Kong 等 booking centres 上线，用 Agentic AI 辅助 SoW KYC research、documentation 和 narrative preparation，并保留 human accountability。
    [Deutsche Bank SoW Agentic AI](https://wealth.db.com/en/about-us/news/2026/deutsche-bank-private-bank-launches-agentic-ai-kyc-processes.html)

32. **Fidelity Investments / Snowflake — Data Liquidity**
    Snowflake 公开介绍 Fidelity 的数据云建设以及整合分散 data warehouses、data marts 和其他 repositories 的历史实践。该资料可作为类似 Fidelity 规模企业的数据基础背景，但不能据此推断其当前 Agent 内部架构。
    [Fidelity Data Liquidity on Snowflake](https://www.snowflake.com/en/blog/fidelity-achieves-data-liquidity-cloud/)

33. **Fidelity / Snowflake — 2026 AI and agentic sessions**
    2026 年面向 Fidelity 的 Snowflake 活动公开涉及 Snowflake AI、Retrieval & Agentic Business Insights、Agentic AI、open standards 与 semantic context。该资料反映双方持续围绕 AI/data architecture 合作，但不证明 Fidelity 内部已经采用本文提出的具体架构。

34. **State Street — AI-Enhanced Alpha Data Platform on Snowflake**
    真实金融服务案例，展示大型投资机构如何基于 Snowflake 构建统一数据与 AI foundation；这是数据平台实践案例，并非 Semantic View / Ontology 的直接证明。
    [State Street Snowflake case study](https://www.snowflake.com/en/customers/all-customers/case-study/state-street/)

35. **FinReflectKG — Agentic Construction and Evaluation of Financial Knowledge Graphs**
    2025 年金融知识图谱研究，采用 schema-guided extraction、rule-based validation、统计验证和 LLM-as-a-judge 评估金融知识结构化。
    [FinReflectKG](https://arxiv.org/abs/2508.17906)

36. **Structure First, Reason Next — Knowledge Graph enhanced financial reasoning**
    2026 年金融文档研究，报告知识图谱增强后在 FinQA 上较 vanilla LLM 提升约 12% execution accuracy；这是特定实验的结果，不应外推成所有企业 Agent 都能获得同等收益。
    [Structure First, Reason Next](https://arxiv.org/abs/2601.07754)






-------------------------




# 金融服务企业如何构建可自动演进的 Agent 业务语义层

## ——从现有资产自动挖掘，到 Snowflake Semantic Views，再到 DeepAgents Runtime

### 摘要

对于一家类似 Fidelity 的大型金融服务企业，真正落地 Agent 时，最现实的问题不是“要不要建 Ontology”，而是：

> **公司已经有大量表、SQL、Dashboard、Power BI/Tableau 模型、业务文档、API、Data Catalog、流程定义和历史查询，能不能从这些已有资产里自动挖出业务语义，再逐步沉淀成 Agent 可以可靠使用的 Semantic Layer？**

答案是可以，而且**不应该从手工写 Ontology 开始**。

目前 Snowflake、Databricks、Atlan 等平台正在采用非常相似的方向：

```text
已有数据资产
+
SQL / Query History
+
Dashboard / BI Model
+
Data Lineage
+
业务文档
+
人工已验证结果
        ↓
自动发现 Candidate Semantics
        ↓
权威性 / 冲突 / 新鲜度评估
        ↓
业务人员确认
        ↓
Canonical Semantic Registry
        ↓
Snowflake Semantic Views / 其他投影
        ↓
Agent Runtime
```

其中有一个非常值得借鉴的行业事实：Snowflake 2026 年公开介绍自己的内部实践时，并不是从零手工定义所有语义，而是结合 Semantic Views、Query History、Dashboard 使用情况、真实用户问题和持续评估不断扩展语义层。Snowflake 称其内部产品数据科学 Agent 在 2025 年 7 月由 400 多名内部用户运行了 5,400 多次查询；更广泛的语义层当月被 5,600 多名员工及 Agent 使用了超过 32 万次。Snowflake 还明确表示，内部团队通过实际查询日志持续新增 Semantic Views 和 Verified Queries。这个数字和具体实现属于 Snowflake 自己公开的内部实践，因此应视为厂商自述，而不是独立审计结果。

Databricks 目前的 Genie Ontology 更直接采用了“**Curated Semantics + Inferred Context**”双层模型：除人工治理的 Metric Views、Domains 等语义外，还自动从 Metric Views、Dashboard、SQL Query 和 Genie Agents 中抽取 context，并根据来源、使用频率、新鲜度计算 authority score，再受到 Unity Catalog 权限控制。

因此，对于 `DeepAgents + LangSmith + AWS + Kubernetes + Snowflake`，我建议不要设计成一个“大而全的 Ontology 项目”，而应该建设一个：

> **Semantic Discovery → Semantic Registry → Semantic Projection → Semantic Runtime**

的持续闭环。

---

# 一、先给结论：你们真正需要的不是“Ontology 项目”，而是一个 Semantic Pipeline

实际架构可以非常简单：

```text
                    Existing Enterprise Assets
                              │
          ┌───────────────────┼────────────────────┐
          │                   │                    │
          ▼                   ▼                    ▼
       Snowflake            BI / SQL          Documents / APIs
          │                   │                    │
          └───────────────────┬────────────────────┘
                              ▼
                  Semantic Discovery Pipeline
                              │
                 ┌────────────┴────────────┐
                 │                         │
          Deterministic Mining       LLM Enrichment
                 │                         │
                 └────────────┬────────────┘
                              ▼
                    Candidate Semantic Layer
                              │
                    Conflict / Authority
                              │
                         SME Review
                              │
                              ▼
                 Canonical Semantic Registry
                              │
             ┌────────────────┼────────────────┐
             │                │                │
             ▼                ▼                ▼
       Snowflake SV       API / Tool       Document / Policy
             │                │                │
             └────────────────┼────────────────┘
                              ▼
                    Semantic Resolver
                              │
                       Context Pack
                              │
                              ▼
                         DeepAgents
                              │
                  ┌───────────┼───────────┐
                  ▼           ▼           ▼
               Analyze      Query        Act
                  │           │           │
                  │           │           ▼
                  │           │      Policy / Workflow
                  │           │
                  ▼           ▼
              Documents   Snowflake
```

真正需要自己建设的核心不是一个巨大的 Knowledge Graph，而是中间这几个组件：

```text
Semantic Discovery
Semantic Registry
Semantic Resolver
Semantic Context Pack
Semantic Evaluation
```

Snowflake Semantic Views 则成为其中**分析语义的主要落点**。

---

# 二、第一原则：先挖已有语义，不要从零手工建

大型金融机构通常已经有大量“隐形 Semantic Layer”，只是没有集中管理。

例如：

### 数据库里已经有

```text
ACCOUNT
ACCOUNT_MASTER
POSITION
POSITION_DAILY
TRADE
ORDER
FUND
SECURITY
CLIENT
```

### SQL 中已经存在

```sql
SUM(market_value)
```

```sql
SUM(buy_amount) - SUM(sell_amount)
```

```sql
COUNT(DISTINCT client_id)
```

### Dashboard 已经存在

```text
AUM
Net Flow
Active Client
Performance
Exposure
```

### Power BI / Tableau 中已经存在

```text
DAX measure
calculated field
relationship
filter
hierarchy
```

### 文档中已经存在

```text
“Managed AUM excludes custody-only assets”
```

### API 中已经存在

```text
POST /orders
POST /trades/{id}/cancel
GET /accounts/{id}/positions
```

### Workflow 中已经存在

```text
DRAFT
→ REVIEW
→ APPROVED
→ SUBMITTED
```

### 业务人员已经长期使用

```text
“managed assets”
“eligible account”
“restricted security”
“active client”
```

这些东西合起来，本来就是企业 Ontology 的绝大部分原材料。

所以第一件事不是：

```text
让 SME 开始写 YAML
```

而是：

> **把已有业务语义从现有系统中“考古”出来。**

---

# 三、自动挖掘应该从六类输入开始

建议第一版只接以下六类数据源：

| 来源                      | 可以挖出什么                  |
| ----------------------- | ----------------------- |
| Snowflake / DB metadata | 表、列、PK/FK、类型、基数         |
| SQL Query History       | 常用指标、Join、Filter、业务口径   |
| BI                      | Dashboard、Measure、维度、关系 |
| Data Lineage            | 概念之间的真实数据关系             |
| Documents               | 定义、政策、业务规则              |
| API / Workflow          | Action、State、输入输出、生命周期  |

不要一开始接几十个系统。

---

# 四、第一层自动挖掘：数据库 Metadata

这是完全不需要 LLM 的部分。

从：

```text
INFORMATION_SCHEMA
+
ACCOUNT_USAGE
+
HORIZON CATALOG
```

得到：

```text
table
column
datatype
primary key
foreign key
unique key
nullability
row count
distinct count
min/max
```

例如：

```text
POSITION
--------------------------------
ACCOUNT_ID
SECURITY_ID
QUANTITY
MARKET_VALUE
VALUATION_DATE
```

自动推断候选：

```yaml
candidate:
  concept: Position

possible_relations:
  Position -> Account
  Position -> Security

possible_metrics:
  MarketValue
  Quantity
```

Snowflake Semantic View Autopilot 当前已经会利用表 metadata、primary/unique keys、cardinality 等信息帮助发现 relationships 和列信息。

---

# 五、第二层自动挖掘：SQL Query History

这一层的价值其实比表结构大得多。

因为：

```text
schema
=
数据库怎么存

query history
=
人真正怎么用
```

例如你发现过去半年出现大量：

```sql
SELECT
    fund_id,
    SUM(market_value)
FROM position
GROUP BY fund_id;
```

以及：

```sql
SELECT
    client_id,
    SUM(market_value)
FROM position
GROUP BY client_id;
```

系统就可以产生 Candidate：

```text
Metric:
    Market Value

Possible dimensions:
    Fund
    Client
```

如果进一步发现：

```sql
SUM(buy_amount) - SUM(sell_amount)
```

在 80 个 Query 中反复出现，可以产生：

```text
Candidate Metric:
    Net Flow
```

Snowflake 当前的 Semantic View Suggestions 就已经在做类似事情：分析最近 SQL Query History，发现频繁使用但尚未进入 Semantic Model 的 metrics、filters，以及可能加入 Verified Query Repository 的问题。

Snowflake 甚至可以根据 Verified Query 自动反推缺失的 metric/filter 定义，例如从“active users”对应的 verified SQL 推导 `is_active` filter。

这说明：

> **真实 Query History 是自动挖掘企业业务语义最有价值的输入之一。**

---

# 六、不要直接让 LLM 从 SQL “猜业务定义”

正确流程应该是：

```text
SQL
 ↓
SQL Parser / AST
 ↓
Deterministic Extraction
 ↓
Candidate Metric
 ↓
LLM Semantic Interpretation
 ↓
Evidence
 ↓
Authority Scoring
```

例如 SQL：

```sql
SUM(position.market_value)
```

程序先确定：

```text
function = SUM
column = position.market_value
```

LLM 才负责判断：

```text
这可能是什么业务指标？
```

然后得到：

```json
{
  "candidate_metric": "Market Value",
  "expression": "SUM(position.market_value)",
  "evidence": [
    "query_123",
    "query_891",
    "dashboard_42"
  ]
}
```

这样 LLM 是：

```text
semantic extractor
```

而不是：

```text
source of truth
```

---

# 七、第三层自动挖掘：Dashboard 是极高价值的“业务问题数据集”

这是 Snowflake 自己的内部经验中特别值得直接采用的一点。

Snowflake 2026 年介绍内部语义层时明确说，他们把“**popular dashboard tiles**”作为高信号 Evaluation 来源，因为 Dashboard 本身就是业务用户真实用来回答问题的工具；同时他们记录实际用户问题，用来持续扩展 evaluation set 和 Semantic View。

因此不要只扫描：

```text
table
column
SQL
```

还应该扫描：

```text
Dashboard
    ↓
Tile
    ↓
Metric
    ↓
Underlying SQL
    ↓
Business Name
```

例如：

```text
Dashboard:
Investment Performance

Tile:
AUM by Asset Class

Metric:
AUM

Dimension:
Asset Class

SQL:
...
```

这几乎就是一个已经半完成的 Semantic View。

---

# 八、Power BI / Tableau 不要废弃，直接拿来“考古”

这也是一个非常实用的捷径。

Snowflake 当前 Semantic View Autopilot 已经支持直接导入 Power BI `.pbit` / `.pbix`，可以把已有 DAX measures、table relationships 和 column descriptions 转换到 Semantic View；也支持 Tableau 文件。

所以如果企业已经积累：

```text
Power BI
Tableau
Looker
```

不要要求业务团队重新定义一遍。

应该：

```text
Existing BI Model
       ↓
Auto Import
       ↓
Candidate Semantic View
       ↓
Validation
       ↓
Business Review
```

这是非常典型的：

> **Legacy Semantics → New Semantic Layer**

迁移路径。

---

# 九、第四层自动挖掘：Lineage

假设你已经发现：

```text
CLIENT
ACCOUNT
POSITION
SECURITY
```

仅靠名字，你不知道它们真正怎么关联。

但 Lineage 可以告诉你：

```text
POSITION.ACCOUNT_ID
    ↓
ACCOUNT.ID

POSITION.SECURITY_ID
    ↓
SECURITY.SECURITY_ID
```

甚至：

```text
Dashboard
    ↓
View
    ↓
dbt Model
    ↓
Table
```

这样就可以自动生成：

```text
Position
    belongs_to → Account

Position
    references → Security
```

这也是为什么 Snowflake Horizon 当前把 column-level lineage 与 semantic views、auto-generated descriptions、object tagging 等一起放到 AI context layer 中。

Atlan 的 Context Agents 也采用同样方向：其 Description Agent 不只看 table/column name，而是同时分析 lineage、query history、business glossary 和关联知识文件。

---

# 十、第五层自动挖掘：文档

文档主要用于发现：

```text
Definition
Business Rule
Policy
Exception
Process
Synonym
```

例如从：

```text
Investment Policy.pdf
Proxy Voting Policy.docx
AUM Methodology.pdf
Operations Manual.docx
```

抽取：

```json
{
  "type": "business_rule",
  "subject": "ManagedAUM",
  "rule": "Custody-only assets are excluded",
  "source": "AUM_Methodology",
  "location": "section 3.2"
}
```

但文档中的规则不要直接升级成：

```text
APPROVED
```

应该：

```text
DISCOVERED
→ CANDIDATE
→ REVIEW
→ APPROVED
```

---

# 十一、第六层自动挖掘：API 和 Workflow

这一层非常容易被忽略，但对于 Agent 来说反而最重要。

如果发现 OpenAPI：

```text
POST /proxy-votes
GET /proxy-votes/{id}
POST /proxy-votes/{id}/approve
POST /proxy-votes/{id}/submit
```

可以自动发现：

```text
Business Object:
    ProxyVote

Candidate Actions:
    create
    approve
    submit

Candidate Lifecycle:
    DRAFT
    APPROVED
    SUBMITTED
```

如果 Workflow / State Machine 已经存在，则可以直接读取：

```text
state
transition
event
precondition
```

这时候 Agent 获得的不再只是：

```text
“Vote 是什么”
```

而是：

```text
“Vote 可以怎么走”
```

这就是从：

```text
Data Semantics
```

进入：

```text
Operational Semantics
```

---

# 十二、把所有自动发现结果放入 Candidate Semantic Registry

第一版甚至不需要 Knowledge Graph。

PostgreSQL 就够了。

建议最少这几张表：

```text
semantic_concept
semantic_relation
semantic_metric
semantic_mapping
semantic_action
semantic_evidence
semantic_conflict
semantic_release
```

例如：

```sql
semantic_concept
----------------------------
concept_id
domain
name
definition
status
authority_score
owner
version
effective_from
effective_to
```

```sql
semantic_relation
----------------------------
source_concept_id
relation_type
target_concept_id
context
authority_score
status
```

```sql
semantic_mapping
----------------------------
concept_id
source_type
source_id
source_path
mapping_type
authority_score
```

---

# 十三、非常关键：不要只有一个 Confidence，要有 Authority

这是 Databricks Genie Ontology 很值得借鉴的一点。

Databricks 当前把：

```text
Inferred Context
```

作为正式的 Ontology 输入，并为每个 snippet 计算 authority score，依据包括来源、使用频率、新鲜度；同时权限控制决定 Agent 是否可以使用该 context。

你们可以采用类似思想。

例如：

```yaml
semantic:
  concept_id: FIN:NetFlow

  authority:
    score: 0.87

    source:
      dashboard: 0.95
      verified_query: 0.95
      policy_document: 0.90
      sql_pattern: 0.70
      llm_inference: 0.30

    certification:
      status: REVIEWED
      owner: InvestmentDataOffice

    freshness:
      updated_at: 2026-09-20
```

但注意：

> **Authority ≠ LLM confidence。**

LLM 说“我 99% 确信这是 AUM”，不代表企业应该信它。

---

# 十四、建议直接建立四级语义成熟度

这是你们现在最需要的“中间方案”。

## L0：Raw Metadata

只有：

```text
table
column
datatype
lineage
query
```

用途：

```text
探索
数据发现
```

不能直接用于高风险决策。

---

## L1：Inferred Context

已经自动发现：

```text
candidate concept
candidate metric
candidate relationship
candidate synonym
```

但尚未经过业务认证。

用途：

```text
Agent exploration
query routing
RAG retrieval
候选分析
```

不应该成为高风险动作的依据。

---

## L2：Curated Semantic

已经：

```text
Business Owner reviewed
Definition approved
Metric verified
Relationships validated
Evidence attached
```

可以用于：

```text
生产分析
Text-to-SQL
Agent grounding
```

---

## L3：Executable Business Semantics

进一步拥有：

```text
Action
Precondition
Policy
State Transition
Authorization
Idempotency
```

才允许：

```text
Agent business action
```

例如：

```text
SubmitTrade
SubmitProxyVote
ApproveCase
```

---

# 十五、这样就不需要等 Semantic Layer 全部完成

这是最重要的中间方案。

当前可能是：

```text
Position       L2
Portfolio      L2
AUM            L2
NetFlow        L1
ProxyVote      L1
Trade          L0
```

那么 Agent 可以：

```text
“回答 AUM”
        ↓
使用 L2
        ↓
正常回答
```

用户问：

```text
“NetFlow 是多少？”
```

使用：

```text
L1
```

但回答明确：

```text
This definition is inferred from query history and
has not yet been certified by Investment Data Office.
```

而用户问：

```text
“提交 Trade”
```

如果：

```text
Trade Action = L1
```

则：

```text
Agent
→ 不允许执行
→ 只能生成 proposal
→ 转人工 / 进入人工流程
```

这比：

```text
Semantic Layer 没完成
→ Agent 什么都不能做
```

实际得多。

---

# 十六、建议把“语义权威等级”直接做进 Runtime Contract

例如：

```json
{
  "semantic_context": {
    "concept": "FIN:Trade",
    "authority": "L1",
    "allowed_usage": [
      "READ",
      "ANALYZE"
    ],
    "forbidden_usage": [
      "EXECUTE"
    ]
  }
}
```

然后 Tool Gateway 不需要理解自然语言，只需要：

```python
if action.requires_semantic_level == "L3":
    if context.authority < L3:
        deny()
```

于是：

```text
Semantic Quality
```

就真的影响 Agent Runtime，而不是停留在文档里。

---

# 十七、推荐建立三个 Agent 使用模式

## Explore

允许：

```text
L0
L1
L2
```

Agent 可以：

```text
搜索
比较
提出假设
发现数据
```

但应该明确显示 provenance。

---

## Assist

要求：

```text
L1+
```

主要用于：

```text
分析
摘要
解释
报告草稿
```

高风险结论要求 evidence。

---

## Act

要求：

```text
L3
+
Policy
+
Authorization
+
Workflow
```

例如：

```text
submit trade
submit vote
change account
approve case
```

没有 L3 不允许。

---

# 十八、Agent 不应该直接查询 Semantic Registry 的全部内容

需要一个：

```text
Semantic Resolver
```

例如 API：

```http
POST /semantic/resolve
```

输入：

```json
{
  "query": "欧洲股票组合过去一年的净流入",
  "domain": "investment"
}
```

输出：

```json
{
  "concepts": [
    {
      "id": "FIN:Portfolio",
      "authority": "L2"
    },
    {
      "id": "FIN:NetFlow",
      "authority": "L2"
    },
    {
      "id": "FIN:AssetClass",
      "authority": "L2"
    },
    {
      "id": "FIN:Region",
      "authority": "L2"
    }
  ],

  "semantic_view": "INVESTMENT_FLOW_SV",

  "evidence": [
    "SV:INVESTMENT_FLOW_SV",
    "VQ:NET_FLOW_004"
  ]
}
```

这就是 Agent 的第一站。

---

# 十九、DeepAgents 不要直接“搜索 Semantic Registry”，最好给它几个专门 Tool

推荐：

```text
resolve_business_context
resolve_entity
get_business_definition
get_metric
query_semantic_view
get_action_contract
get_workflow_state
get_policy
get_evidence
```

其中最重要的是：

```text
resolve_business_context()
```

让 Agent 一次获得：

```text
Concept
Relation
Metric
State
Action
Policy
Evidence
```

而不是自己拼 20 次查询。

---

# 二十、给 DeepAgents 的不是完整 Ontology，而是 Context Pack

例如：

```json
{
  "task": {
    "intent": "ANALYZE_PORTFOLIO_FLOW"
  },

  "business_context": {
    "domain": "InvestmentManagement",

    "concepts": [
      {
        "id": "FIN:Portfolio",
        "definition": "..."
      },
      {
        "id": "FIN:NetFlow",
        "definition": "..."
      }
    ],

    "relationships": [
      "Portfolio -> hasPosition -> Position",
      "Position -> references -> Instrument"
    ],

    "metrics": [
      {
        "id": "FIN:NetFlow",
        "semantic_view": "INVESTMENT_FLOW_SV"
      }
    ]
  },

  "allowed_data_sources": [
    "INVESTMENT_FLOW_SV"
  ],

  "evidence": [
    "metric://FIN:NetFlow"
  ]
}
```

然后 DeepAgents 才开始 reasoning。

---

# 二十一、分析型 Agent 的完整调用流程

用户：

> “过去一年欧洲股票组合净流入是多少？”

系统首先：

```text
User
 ↓
Semantic Resolver
```

解析：

```text
Portfolio
Region
AssetClass
NetFlow
DateRange
```

然后：

```text
Semantic View Resolver
 ↓
INVESTMENT_FLOW_SV
```

DeepAgents 收到：

```text
metric = FIN:NetFlow
dimension = Region / Portfolio
filter = Equity + Europe
time = last 12 months
```

再生成：

```json
{
  "semantic_view": "INVESTMENT_FLOW_SV",
  "metrics": ["FIN:NetFlow"],
  "dimensions": ["FIN:Portfolio"],
  "filters": [
    {
      "concept": "FIN:AssetClass",
      "value": "Equity"
    },
    {
      "concept": "FIN:Region",
      "value": "Europe"
    }
  ]
}
```

最后由程序编译成：

```sql
SELECT ...
FROM SEMANTIC_VIEW(...)
```

Snowflake 当前的 `SEMANTIC_VIEW()` 查询语法本身就提供 metrics、facts、dimensions、WHERE 等明确结构，因此很适合作为这个 Query DSL 的后端。

---

# 二十二、关键点：Agent 永远不知道底层物理表

Agent 不应该看到：

```text
POSITION_EOD_V2
POSITION_MKT_VALUE
FND_POS_HST
CLIENT_ACCOUNT_XREF
```

而应该看到：

```text
Position
Market Value
Account
Client
Portfolio
```

这正是 Snowflake 内部 context layer 的核心做法：Semantic View 位于下游消费者与 raw tables 之间，把 physical schema 转换成 governed business language、facts、dimensions 和 metrics。

---

# 二十三、Snowflake Semantic View 自动生成可以直接作为你们的第一阶段生产方案

现在完全不需要自己写生成器。

Snowflake Semantic View Autopilot 已经可以：

```text
选择 tables
↓
分析 metadata
↓
识别 keys / cardinality
↓
推断 relationships
↓
根据 column names + sample values
生成 descriptions
↓
结合 query history
产生 metrics / filters / verified query suggestions
```

还可以：

```text
Power BI
Tableau
SQL examples
YAML
```

作为输入。

因此第一阶段应该优先：

> **把现有 Snowflake 数据资产通过 Autopilot 自动产生 Semantic View 初稿。**

而不是自己重新开发一套：

```text
LLM → YAML semantic view generator
```

---

# 二十四、但 Autopilot 产生的是“初稿”，不是权威业务语义

Snowflake 自己也强调：

```text
Start with Autopilot
→ Refine in Semantic Studio
→ Test
→ Verify
→ Iterate
```

而且官方建议从单一业务域、5–10 张相关表开始，而不是把整个企业数据仓库一次性建成一个 Semantic View。

所以可以：

```text
Autopilot
= Semantic Discovery / Drafting
```

而：

```text
Business Owner
= Semantic Certification
```

---

# 二十五、真实案例：Snowflake 内部已经在使用这种闭环

Snowflake 2026 年公开介绍内部 semantic layer 时，核心流程非常值得照搬：

```text
Semantic Views
      ↓
Internal Agent
      ↓
Real User Questions
      ↓
Query Logs
      ↓
Dashboard Usage
      ↓
New Semantic Views / Verified Queries
      ↓
Evaluation
      ↓
Semantic Layer Expansion
```

Snowflake 明确表示：

* semantic views 作为 raw data 与 Agent/BI 之间的统一层；
* 使用 dbt 做 version control、peer review、CI/CD；
* 使用 popular dashboard tiles 构建 evaluation；
* 记录真实问题；
* 根据实际 query 持续新增 semantic views 和 verified queries；
* 用 Cortex Agents 对多个 semantic views 做 routing。

这比“先建一个五千个概念的 Ontology”现实得多。

---

# 二十六、真实案例：Databricks 正在做“自动推断语义”

Databricks 2026 年的 Genie Ontology 已经明确区分：

```text
Modeled Context
```

和：

```text
Inferred Context
```

后者自动从：

```text
Metric Views
Dashboards
SQL Queries
Genie Agents
```

中抽取。

更有意思的是，它不是简单地把所有候选文本塞进 Agent，而是为每条 inferred snippet 建立：

```text
Authority Score
Freshness
Usage
Source
Permission
```

然后运行时进行 ranking 和 conflict resolution。

这和我建议的：

```text
L0 / L1 / L2 / L3
```

非常接近。

---

# 二十七、真实案例：Mastercard 的经验说明“自动化不等于没有人工治理”

Mastercard 目前公开介绍的 “Context by Design” 实践很值得参考。

根据 Atlan 的客户案例，Mastercard 已经有多年积累的数据 catalog、lineage、ownership 和 steward-confirmed definitions；在这些已有治理基础上，再用 Context Agents 自动生成和补充数据资产描述。Atlan 声称这一过程已经为 Mastercard 自动丰富超过 30,000 个资产并节省超过 6,000 小时。该数字属于 Atlan/Mastercard 案例披露，不能视为独立审计结论。

这里真正应该学的不是：

```text
买 Atlan
```

而是：

> **自动化的效果高度依赖已有 metadata、lineage、ownership 和 business definitions。**

也就是：

```text
好的基础资产
        ↓
AI enrichment
        ↓
更好的 semantic layer
```

而不是：

```text
没有治理
        ↓
直接 LLM
        ↓
自动生成 Ontology
```

---

# 二十八、这意味着“自动挖掘”其实应该分两条管道

## Pipeline A：Deterministic Mining

```text
Schema
SQL
Lineage
BI
API
Workflow
```

产生：

```text
事实
关系
频率
依赖
枚举
状态
```

---

## Pipeline B：Semantic Enrichment

```text
Candidate
+
Documents
+
Business Glossary
+
Existing Usage
```

LLM 生成：

```text
description
concept label
candidate synonym
candidate relation
candidate metric meaning
candidate process meaning
```

最后合并：

```text
Candidate Semantic
        ↓
Evidence Aggregation
        ↓
Conflict Detection
        ↓
Authority Score
```

---

# 二十九、一个具体的自动挖掘例子：发现 AUM

假设系统里没有定义：

```text
FIN:AUM
```

但有以下数据。

### SQL

```sql
SELECT
    client_id,
    SUM(market_value)
FROM managed_positions
GROUP BY client_id;
```

出现 1,820 次。

### Dashboard

```text
Dashboard: Client AUM
Tile: Total AUM
```

出现 15 个 Dashboard 引用。

### Power BI

```text
Measure:
Managed AUM
```

### 文档

```text
“Managed AUM excludes custody-only assets.”
```

### Query

```text
“How much AUM did we manage last month?”
```

于是系统自动产生：

```yaml
candidate:
  concept_id: FIN:AssetsUnderManagement

  evidence:
    sql_patterns: 1820
    dashboard_references: 15
    powerbi_measure: 1
    document_definition: 1
    user_queries: 37

  proposed_definition:
    "Market value of eligible managed assets..."

  proposed_expression:
    "SUM(managed_positions.market_value)"

  conflict:
    NONE

  authority:
    HIGH
```

这时候才进入：

```text
Investment Data Owner
```

点击：

```text
Approve
```

然后发布：

```text
FIN:AUM
status = APPROVED
```

再自动产生：

```text
Snowflake Semantic View metric:
AUM
```

这个过程比：

```text
让 SME 打开空白 YAML
```

容易得多。

---

# 三十、一个具体例子：发现“Active Client”冲突

Snowflake 自己内部就遇到过非常典型的这种问题。

同样一个“active customer”，不同数据源可能采用：

```text
last login < 30 days
```

或者：

```text
credits consumed > 0
and account_type != TRIAL
```

或者：

```text
COUNT(DISTINCT account_id)
```

Snowflake 把这种例子直接作为内部 Semantic Layer 的动机：没有统一 context，AI 会面对多个“看起来都合理”的定义。

你们的自动挖掘系统应该**把这种冲突作为一等对象**：

```text
semantic_conflict
-------------------------
concept = ActiveClient

definition_A
source_A
usage_A

definition_B
source_B
usage_B

status = CONFLICTED
```

而不是：

```text
LLM:
我认为 A 比较合理。
```

---

# 三十一、Conflict Detection 是自动 Semantic Layer 最重要的价值之一

应该主动检测：

```text
同名概念
不同定义

同一 SQL metric
不同表达式

同一 KPI
不同 Dashboard 数字

同一概念
不同 owner

同一个词
多个 business context
```

例如：

```text
AUM
```

出现：

```text
Finance AUM
Investment AUM
Client AUM
Regulatory AUM
```

不要强迫它们合成：

```text
AUM
```

可以建立：

```text
FIN:AUM
INV:ManagedAUM
REG:RegulatoryAUM
```

再定义：

```text
related_to
```

而不是：

```text
synonym
```

---

# 三十二、自动 Synonym 要谨慎

这个细节很容易被忽略。

Snowflake 当前文档明确建议：

> 对于 frontier models，synonyms 通常增加的准确性有限，却会消耗 context；应只为内部术语、缩写和 legacy names 手工添加，避免大量自动生成 synonym。

所以不要做：

```text
LLM:
AUM synonyms = assets, wealth, money, portfolio value, holdings...
```

这很容易污染模型。

应该优先提取：

```text
AUM
Assets Under Management
Managed Assets
UMV
```

这些是真实业务使用过的词。

---

# 三十三、Semantic Registry 不要成为一个“第二个 Data Catalog”

这个边界也很重要。

Data Catalog 已经有：

```text
table
column
lineage
owner
classification
quality
```

不要再复制一遍。

Semantic Registry 应该只增加：

```text
business concept
business meaning
semantic relation
metric meaning
business context
action
process
evidence
authority
```

所以最好：

```text
Data Catalog
        ↓
metadata source

Semantic Registry
        ↓
business interpretation
```

---

# 三十四、如果公司已有 Data Catalog，更不要重建 Catalog

例如已有：

```text
Collibra
Alation
Atlan
Informatica
DataHub
Microsoft Purview
Snowflake Horizon
```

就直接读取：

```text
Glossary
Owner
Lineage
Classification
Certification
```

Atlan 当前的 Context Layer 方案也是将 metadata、semantics、lineage、business knowledge 和 policy 统一起来，再通过 MCP/API 提供给 Agent，而不是让每一个 Agent 各自重建一套 context。

---

# 三十五、如果什么都没有怎么办？

也不要手工从零写全部。

先建立：

```text
Minimal Semantic Registry
```

只需要：

```text
50–200 Concepts
20–50 Metrics
20–50 Actions
主要 Relationships
```

剩余：

```text
L0/L1
```

全部自动挖掘。

于是整个企业 Semantic Layer 会变成：

```text
              APPROVED
                 ▲
                 │
             SME review
                 ▲
                 │
              CANDIDATE
                 ▲
        ┌────────┴────────┐
        │                 │
    SQL Mining        LLM Extraction
        │                 │
        └────────┬────────┘
                 ▲
                 │
          Existing Assets
```

---

# 三十六、这里我非常建议采用“Shadow Semantic Layer”

如果当前 Semantic Layer 还没准备好，可以先建设一个：

> **Shadow Semantic Layer**

它不直接控制生产 Agent。

它只：

```text
监听
解析
推断
评分
记录
```

例如：

```text
Production Agent
      │
      ▼
Normal execution
      │
      └──────────────┐
                     ▼
              Semantic Observer
                     │
          ┌──────────┼───────────┐
          ▼          ▼           ▼
       Concepts    Metrics    Relationships
          │          │           │
          └──────────┼───────────┘
                     ▼
             Candidate Registry
```

然后观察：

```text
Agent 到底缺什么？
```

例如：

```text
每周：
327 次出现“managed AUM”
210 次出现“active account”
89 次 Agent 查询无法映射到 canonical concept
45 次指标冲突
17 次 Entity Resolution 失败
```

这时候再决定：

```text
哪些最值得正式建模
```

---

# 三十七、这样 Semantic Layer 建设本身也由 Agent Usage 驱动

形成：

```text
Agent Usage
      ↓
Semantic Gap
      ↓
Candidate Discovery
      ↓
Business Review
      ↓
Semantic Asset
      ↓
Agent Usage improves
      ↓
New semantic gaps
```

这比：

```text
Enterprise Ontology
      ↓
一次性建设
      ↓
两年后上线
```

现实得多。

---

# 三十八、Semantic Gap 应该自动分类

每一次 Agent 无法正确回答，都不要简单记：

```text
hallucination
```

应该归类：

```text
CONCEPT_MISSING
ENTITY_MISSING
METRIC_MISSING
RELATIONSHIP_MISSING
DEFINITION_AMBIGUOUS
SEMANTIC_VIEW_MISSING
POLICY_MISSING
PROCESS_MISSING
EVIDENCE_MISSING
```

例如：

```text
Question:
“What is managed AUM?”

Agent:
not sure
```

系统：

```text
CONCEPT_MISSING
```

另一个：

```text
“What is AUM?”

Agent chooses:
AUM = all custody assets

Correct:
Managed AUM
```

记录：

```text
CONTEXT_AMBIGUOUS
```

第三个：

```text
“How do I submit vote?”
```

Agent 找到了 API，却不知道：

```text
approval required
```

记录：

```text
PROCESS_MISSING
POLICY_MISSING
```

这样每次 Agent 运行都在帮助 Semantic Layer 建设。

---

# 三十九、Semantic Layer 也应该拥有“coverage”

可以建立：

```text
semantic_coverage
```

例如：

```text
Investment Research
-------------------------
Concept coverage       87%
Metric coverage        92%
Entity coverage        81%
Process coverage       63%
Action coverage        40%
Policy coverage        35%
Evidence coverage      58%
```

这样就能明确回答：

> “我们目前的 Semantic Layer 到底完成到什么程度？”

而不是：

> “感觉差不多了。”

---

# 四十、Agent 也可以根据 coverage 动态降级

例如：

```text
Trade Action
coverage = 40%
```

那么：

```text
Agent mode = Assist
```

只能：

```text
draft
explain
prepare
```

不能：

```text
execute
```

而：

```text
Investment Analysis
coverage = 92%
```

可以：

```text
fully automated analysis
```

这就把：

```text
Semantic Maturity
```

真正连接到：

```text
Agent Autonomy
```

---

# 四十一、建议定义一个非常简单的 Runtime Rule

```python
def allowed_usage(semantic_level, action_type):
    if action_type == "ANALYZE":
        return semantic_level >= L1

    if action_type == "REPORT":
        return semantic_level >= L2

    if action_type == "EXECUTE":
        return semantic_level >= L3

    return False
```

然后：

```text
L0 → explore
L1 → assist
L2 → production analysis
L3 → business execution
```

真正 enforcement 在代码里。

---

# 四十二、Snowflake Semantic View 作为 L2 的最佳承载方式

例如：

```text
Canonical Concept:
FIN:NetFlow

Semantic View:
INVESTMENT_FLOW_SV

Metric:
net_flow

Expression:
SUM(inflow) - SUM(outflow)

Verified Queries:
...
```

这时：

```text
L2
```

可以直接映射到：

```text
Snowflake Semantic View
```

Snowflake 当前已经支持：

```text
metrics
dimensions
facts
relationships
filters
verified queries
```

并支持 RBAC、CI/CD 和 dbt 集成。

---

# 四十三、L1 则不一定需要 Semantic View

例如：

```text
Candidate Metric:
Active Client
```

只有：

```text
query history
dashboard
SQL pattern
```

那么可以暂存在：

```text
semantic_metric_candidate
```

Agent 需要时可以得到：

```text
Candidate definition
Authority = 0.62
Evidence = ...
Status = CANDIDATE
```

但不能让它进入：

```text
production metric resolver
```

---

# 四十四、这种设计可以显著降低前期成本

因为你不需要：

```text
先把 100% 语义建好
再上线 Agent
```

而是：

```text
先建立 20% 的高价值 L2/L3
+
80% 自动发现的 L1
```

然后：

```text
Agent production
↓
observe
↓
identify top gaps
↓
upgrade L1 → L2
↓
high-value action L2 → L3
```

这才是实际可运行的路线。

---

# 四十五、DeepAgents 的 Skill 应该变得非常简单

不要在：

```text
SKILL.md
```

里塞：

```text
AUM means...
Position means...
Trade means...
```

而写：

```markdown
## Business semantics

Before answering business questions:

1. Resolve relevant business concepts through `resolve_business_context`.
2. Use canonical concept IDs instead of inferred enterprise terminology.
3. Use approved Semantic Views for metrics and structured data.
4. Treat candidate/inferred semantics as non-authoritative.
5. Include semantic evidence for important business claims.
6. For actions, resolve the Action Contract before proposing a tool call.
7. Never infer authorization from natural-language definitions.
8. If semantic authority is insufficient, downgrade to analysis/draft mode or request clarification.
```

Skill 本身只描述：

> **Agent 怎样使用 Semantic Plane。**

Business 定义本身不放在 Skill。

---

# 四十六、Semantic Context Pack 应该成为 DeepAgents 的系统输入之一

推荐：

```python
class SemanticContext(TypedDict):
    domain: str

    ontology_version: str
    semantic_release: str

    concepts: list[ConceptContext]
    relationships: list[RelationContext]

    metrics: list[MetricContext]
    semantic_views: list[str]

    business_objects: list[BusinessObjectContext]

    actions: list[ActionContext]
    policies: list[PolicyReference]

    evidence: list[EvidenceReference]
```

每一次 Execution 固定：

```text
semantic_release = 2026.09.23
```

这样 Agent 执行中语义不会莫名其妙变化。

---

# 四十七、为什么需要 Semantic Release？

假设：

```text
11:00 Agent Run
```

使用：

```text
Semantic Release 42
```

11:05：

```text
AUM definition changed
```

发布：

```text
Semantic Release 43
```

那么：

```text
old Run
→ continues with 42
```

而：

```text
new Run
→ uses 43
```

否则长时间运行 Agent 可能出现：

```text
同一次 Execution
前半段用旧 AUM
后半段用新 AUM
```

这在金融业务中很危险。

---

# 四十八、LangSmith 应该把语义版本打进 Trace

每一次 Agent Run 至少记录：

```text
semantic_release
ontology_version
semantic_view_versions
context_ids
concept_ids
metric_ids
action_ids
policy_versions
```

例如：

```json
{
  "metadata": {
    "semantic_release": "2026.09.23",
    "ontology_version": "3.4",
    "semantic_views": [
      "INVESTMENT_FLOW_SV@8"
    ],
    "policy_version": "PROXY-6.2"
  }
}
```

这样 LangSmith 发现：

```text
Agent answer wrong
```

可以进一步回答：

> 是模型问题，还是 Semantic Layer 问题？

这非常重要。

---

# 四十九、LangSmith 的 Evaluation 不应该只评分最终答案

建议直接增加：

```text
semantic_grounding_eval
```

至少检查：

```text
Concept correct?
Entity correct?
Metric correct?
Semantic View correct?
Relationship path correct?
Evidence correct?
Policy reference correct?
Action correct?
```

例如：

```text
User:
“欧洲股票基金过去一年净流入？”

Agent chooses:
FIN:NetFlow
INVESTMENT_FLOW_SV
Europe
Equity
2025-09-23 → 2026-09-23

Expected:
✓
✓
✓
✓
✓
```

这类 Eval 大量可以脚本化，不需要 LLM Judge。

---

# 五十、Semantic Layer 还有一个非常现实的价值：减少 Agent Context

如果没有 Semantic Layer：

```text
Agent
↓
发现 table
↓
读 schema
↓
读 sample
↓
试 join
↓
查 dashboard
↓
看 query
↓
自己猜 metric
```

每次执行可能消耗大量 context。

Snowflake 自己的内部实践指出，Semantic Views 能让 Agent 直接使用 business context 执行 SQL，避免 Agent 自己发现和理解大量 raw data，并且可降低 token 消耗和执行时间。

因此 Semantic Layer 不只是“准确性”基础，也是：

```text
Latency
Cost
Context Window
```

基础。

---

# 五十一、但不要把所有 Context 都塞 Snowflake

建议：

```text
Snowflake Semantic View
→ structured analytical semantics

Postgres Semantic Registry
→ canonical concepts / relations / actions / status / authority

Object Storage / Search
→ documents / evidence

Domain APIs
→ live business objects

Policy Service
→ authorization
```

最终 Resolver 负责聚合。

这比：

```text
Snowflake
=
所有语义
```

更灵活。

---

# 五十二、为什么建议 Registry 先放 Postgres，而不是马上上 Knowledge Graph？

因为第一阶段你真正需要的是：

```text
CRUD
version
approval
relations
search
authority
provenance
```

Postgres 已经很好解决。

例如：

```sql
semantic_concept
semantic_relation
semantic_evidence
semantic_action
semantic_release
```

完全可以支持。

当关系复杂到需要：

```text
multi-hop reasoning
ontology inference
graph traversal
```

再考虑：

```text
Neo4j
RDF
OWL
```

这与 FIBO 的 OWL 形式并不矛盾；FIBO 是行业级标准 Ontology，而企业自己的第一阶段实现不需要复制它的存储复杂度。

---

# 五十三、Apache Ossie 可以解决一个长期问题：不要被 Snowflake 锁死

2026 年 Apache Ossie（原 Open Semantic Interchange）正在成为一个 vendor-neutral semantic metadata exchange 标准，目标是让 analytics、AI 和 BI 平台共享 metrics、dimensions、joins、contexts 等语义。

所以建议：

```text
Canonical Semantic Registry
          │
          ├── Snowflake Semantic View
          ├── OSSIE export
          ├── Agent Context
          └── BI / Analytics
```

而不是：

```text
Snowflake YAML
=
Enterprise Ontology
```

Snowflake 自己也已经公开说明其 Semantic Views 可以与 Apache Ossie interoperability。

---

# 五十四、真正的自动挖掘 Pipeline 应该长这样

```text
             EXISTING ENTERPRISE ASSETS
                       │
       ┌───────────────┼────────────────┐
       │               │                │
       ▼               ▼                ▼
   Data Schema       SQL/BI        Docs/APIs
       │               │                │
       └───────────────┼────────────────┘
                       ▼
               Deterministic Parser
                       │
              ┌────────┼─────────┐
              ▼        ▼         ▼
           Entities Metrics   Relations
              │        │         │
              └────────┼─────────┘
                       ▼
                 LLM Enrichment
                       │
            ┌──────────┼───────────┐
            ▼          ▼           ▼
        Definition  Synonyms   Business Rules
            │          │           │
            └──────────┼───────────┘
                       ▼
                Evidence Join
                       │
                       ▼
               Conflict Detection
                       │
                       ▼
               Authority Scoring
                       │
             ┌─────────┴─────────┐
             ▼                   ▼
        AUTO ACCEPT          SME REVIEW
             │                   │
             └─────────┬─────────┘
                       ▼
              Canonical Registry
                       │
          ┌────────────┼─────────────┐
          ▼            ▼             ▼
      Snowflake      API/Tool     Agent Context
      Semantic View
```

这是我最推荐的“自动挖掘而非纯人工”实现。

---

# 五十五、自动挖掘哪些东西可以直接上线？

建议非常保守。

### 可以自动发布

```text
metadata
lineage
column description
technical relationships
query frequency
usage statistics
sample values
```

---

### 自动生成但需要 Review

```text
business definition
metric
business relation
synonym
process interpretation
entity mapping
```

---

### 必须明确批准

```text
authorization rule
policy
approval requirement
high-impact action
business state transition
regulatory definition
```

也就是说：

> **越接近业务决策，自动化程度越低。**

---

# 五十六、一个简单的 Authority Policy

可以规定：

```text
L0
→ metadata only

L1
→ agent can retrieve
→ cannot cite as authoritative

L2
→ agent can analyze
→ may answer with evidence

L3
→ agent can drive action
→ policy still required

L4
→ regulatory/high-impact definition
→ explicit business-owner certification
```

甚至可以把它写成：

```yaml
usage_policy:
  L0:
    analyze: false
    cite: false
    execute: false

  L1:
    analyze: true
    cite: "inferred"
    execute: false

  L2:
    analyze: true
    cite: "authoritative"
    execute: false

  L3:
    analyze: true
    cite: "authoritative"
    execute: true

  L4:
    analyze: true
    cite: "certified"
    execute: true
```

---

# 五十七、这也是 Semantic Layer 不完整时最实用的中间方案

假设今天：

```text
Ontology coverage = 20%
```

完全没关系。

可以：

```text
20% L2/L3
+
50% L1
+
30% L0
```

而 Agent：

```text
分析类问题
→ L1/L2 都能工作

指标类问题
→ 优先 L2

动作类问题
→ 只用 L3

监管/高风险
→ L4 + Policy
```

于是不会出现：

```text
Semantic Layer 没建完
→ Agent 不能上线
```

也不会出现：

```text
Semantic Layer 没建完
→ Agent 什么都可以猜
```

---

# 五十八、建议第一期不要建设“全公司 Ontology”，而建立三个 Domain

对于类似 Fidelity 的环境，我会从：

```text
Investment
```

开始，再选择：

```text
Proxy Voting
```

或者：

```text
Client Service
```

作为第二个 Domain。

比如 Investment：

```text
Client
Account
Portfolio
Fund
Instrument
Position
Order
Trade
Benchmark
Performance
AUM
Exposure
```

只需要围绕一个 Agent use case 闭环。

---

# 五十九、第一期真正要交付的不是“Ontology 文件”，而是下面八个东西

```text
1. Concept Registry
2. Semantic Discovery Pipeline
3. Semantic Resolver
4. One or more Snowflake Semantic Views
5. Context Pack Contract
6. DeepAgents Semantic Tools
7. LangSmith Semantic Evals
8. Semantic Coverage Dashboard
```

只要这八个东西存在，Semantic Layer 就已经进入生产工程体系。

---

# 六十、一个非常实际的第一版技术栈

如果不额外引入大型平台，我会采用：

```text
                    Semantic Registry
                         │
                     PostgreSQL
                         │
        ┌────────────────┼────────────────┐
        │                │                │
        ▼                ▼                ▼
    Concepts          Relations        Actions
        │                │                │
        └────────────────┼────────────────┘
                         ▼
                 Semantic Resolver
                         │
                  Python / FastAPI
                         │
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
      DeepAgents      Snowflake      Documents
          │           Semantic Views    │
          │                              │
          ▼                              ▼
       LangSmith                    Hybrid Search
```

自动发现：

```text
Snowflake Query History
Snowflake metadata
dbt
Power BI
Tableau
OpenAPI
Git
Docs
```

统一进入：

```text
Discovery Pipeline
```

这套方案不要求再引进一个新的 Ontology 产品。

---

# 六十一、Discovery Pipeline 可以自己写，但不要自己重新造 Catalog

程序可以非常简单：

```text
collector/
    snowflake.py
    dbt.py
    powerbi.py
    tableau.py
    openapi.py
    docs.py

extractor/
    sql_metrics.py
    relations.py
    entities.py
    states.py
    actions.py

enricher/
    llm_definition.py
    llm_relation.py
    llm_process.py

governance/
    authority.py
    conflict.py
    certification.py

publisher/
    snowflake_semantic_view.py
    ossie.py
```

这样架构非常清晰。

---

# 六十二、一个具体的 Candidate Concept JSON

例如：

```json
{
  "candidate_id": "cand_10293",

  "concept": {
    "name": "Managed AUM",
    "domain": "Investment"
  },

  "evidence": [
    {
      "type": "powerbi_measure",
      "id": "pbi_measure_42"
    },
    {
      "type": "dashboard",
      "id": "dash_aum_01"
    },
    {
      "type": "sql_pattern",
      "id": "sql_cluster_918"
    },
    {
      "type": "document",
      "id": "aum_policy_v7"
    }
  ],

  "proposed_definition":
    "Market value of eligible managed assets...",

  "proposed_metric":
    "SUM(position.market_value)",

  "authority": {
    "score": 0.91,
    "status": "REVIEW_REQUIRED"
  }
}
```

业务人员只需要回答：

```text
Approve
```

或者：

```text
Reject
```

或者：

```text
Modify definition
```

而不是从零开始写。

---

# 六十三、真正重要的是“证据链”

一个 Concept 最终最好能回答：

```text
这个定义从哪里来的？
```

例如：

```text
Managed AUM

Definition:
...

Evidence:
├── AUM methodology v7.1
├── 14 Power BI reports
├── 2,813 SQL queries
├── 3 dashboard tiles
└── Investment Data Office certification
```

这样 Agent 最后回答：

> “Managed AUM 为什么这样计算？”

可以直接引用：

```text
AUM methodology v7.1
```

而不是：

> “因为模型认为这是行业标准。”

---

# 六十四、Semantic Discovery 其实可以成为你们现有 Agent 平台自己的一个 Skill

例如：

```text
skills/
  semantic-discovery/
    SKILL.md
    scripts/
      parse_sql.py
      extract_metrics.py
      extract_relationships.py
      validate_candidate.py
    references/
      semantic-model-spec.md
```

但注意：

```text
Skill
=
如何发现和整理语义
```

最终的：

```text
Canonical Registry
```

仍然属于平台级资产。

---

# 六十五、甚至可以让 Agent 自动提出 Ontology PR

这是一个非常适合后续阶段的模式。

例如发现：

```text
300 个 SQL
都把:

SUM(position.market_value)

当作：

Managed AUM
```

系统自动生成：

```text
semantic PR #142

Add:
FIN:ManagedAUM

Metric:
SUM(position.market_value)

Evidence:
2,813 queries
14 dashboards
AUM policy v7.1

Proposed owner:
Investment Data Office
```

然后：

```text
Business SME
→ Review
→ Merge
```

这和代码开发非常像：

```text
Agent discovers
→ PR
→ Human Review
→ Merge
→ CI
→ Deploy
```

这才是比较现实的“AI-assisted ontology engineering”。

---

# 六十六、CI 应该验证什么？

至少：

```text
Concept schema valid
Relation target exists
Metric expression valid
Semantic View compiles
No duplicate canonical concept
No conflicting active definition
Evidence exists
Owner exists
Effective dates valid
Policy references valid
Verified queries pass
Agent semantic eval passes
```

Snowflake Semantic Views 本身已经提供 schema、relationship、expression 等 validation；企业层只需要在此之上增加业务治理检查。

---

# 六十七、LangSmith 则验证“Agent 有没有正确使用这些语义”

两套 CI 分开：

```text
Semantic CI
    ↓
Semantic Asset Correctness
```

和：

```text
Agent CI
    ↓
Agent Semantic Grounding
```

例如 Semantic CI：

```text
FIN:NetFlow exists
expression correct
owner exists
```

Agent CI：

```text
Question → FIN:NetFlow
Question → correct Semantic View
Question → correct filter
```

---

# 六十八、生产运行时还可以做 Online Semantic Evaluation

例如每天自动统计：

```text
Unknown concept rate
Semantic resolver fallback rate
L1 usage rate
L2 usage rate
L3 usage rate
Metric correction rate
Human correction rate
Tool rejection due semantic deficiency
```

这样可以直接知道：

```text
Agent 出问题
```

究竟是不是：

```text
Semantic Layer 缺口
```

---

# 六十九、一个非常值得关注的指标：Semantic Escape Rate

建议定义：

> **Semantic Escape Rate = Agent 在没有经过 canonical semantic resolution 的情况下自行推断业务概念/指标/动作的比例。**

目标：

```text
Analysis:
< 5%

High-impact actions:
0%
```

例如：

```text
10,000 Agent runs
8,900 使用 canonical concepts
700 使用 fallback metadata
400 自己推断
```

那么：

```text
Semantic Escape Rate = 4%
```

可以持续降低。

这个指标比：

```text
LLM accuracy = 92%
```

更贴近企业 Agent 的业务 grounding。

---

# 七十、另一个关键指标：Semantic Conflict Rate

```text
Conflict Rate
=
有多个高权威定义的 Concept
/
全部 active concepts
```

例如：

```text
AUM
Revenue
Active Client
Net Flow
Exposure
```

如果大量存在：

```text
两个定义
两个 owner
两个 SQL
两个 dashboard
```

说明 Semantic Layer 本身还没治理好。

这时候继续调 LLM prompt 没意义。

---

# 七十一、最终把 Agent 错误分成三类

### Model Error

```text
正确 semantic context
→ Agent 推理错
```

### Semantic Error

```text
Agent 正确使用 semantic layer
→ semantic definition 本身错误
```

### Integration Error

```text
semantic definition 正确
→ mapping / API / policy / execution 错
```

这三类一定要分开。

否则所有问题最后都会变成：

```text
“模型不够聪明”
```

---

# 七十二、你们最应该避免的“大坑”

## 坑一：纯人工建 Ontology

结果：

```text
慢
贵
过时
没人维护
```

自动从：

```text
SQL
BI
Lineage
Docs
API
```

挖 candidate。

---

## 坑二：全自动 LLM 建 Ontology

结果：

```text
看起来完整
实际上很多定义是模型自己编的
```

必须：

```text
Evidence
Authority
SME
Certification
```

---

## 坑三：把 Semantic View 当完整 Ontology

结果：

```text
metrics 很好
但 agent 不懂 workflow
不懂 action
不懂 policy
```

---

## 坑四：只建“名词”

```text
Client
Account
Trade
```

却没有：

```text
state
action
precondition
```

Agent 还是不会真正操作业务。

---

## 坑五：把所有语义都塞到 Prompt

结果：

```text
Prompt 巨大
版本难控
不同 Agent 不一致
```

---

## 坑六：语义层没有版本

最终无法解释：

```text
为什么 Agent 当时这么回答？
```

---

## 坑七：语义层没有 Evidence

结果：

```text
“这个定义是谁说的？”
```

没人知道。

---

# 七十三、最实际的落地路径：不要从 Ontology 开始，而从一个 Agent 开始

例如：

```text
Proxy Voting Agent
```

第一步只需要挖：

```text
Fund
Security
Meeting
Resolution
VoteCase
VoteInstruction
Deadline
Approval
```

然后自动发现：

```text
SQL
BI
Policy docs
API
Workflow
```

建立：

```text
Proxy Voting Semantic Context
```

再上线 Agent。

真实生产运行：

```text
Agent Trace
↓
Semantic Gaps
↓
New Candidate Concepts
↓
Business Review
↓
Semantic Release
```

然后再进入：

```text
Trading Agent
```

共享：

```text
Fund
Security
Account
Instrument
```

这样 Semantic Layer 会自然成长。

---

# 七十四、一个适合你们场景的最终架构

```text
                      ENTERPRISE DATA / KNOWLEDGE
                                  │
        ┌─────────────────────────┼────────────────────────┐
        │                         │                        │
        ▼                         ▼                        ▼
     Snowflake                  BI / SQL             Docs / API / BPM
        │                         │                        │
        └─────────────────────────┼────────────────────────┘
                                  ▼
                       ┌─────────────────────┐
                       │ Semantic Discovery  │
                       │                     │
                       │ metadata mining     │
                       │ SQL mining          │
                       │ lineage mining      │
                       │ BI mining            │
                       │ document mining     │
                       │ API/workflow mining │
                       └──────────┬──────────┘
                                  ▼
                       ┌─────────────────────┐
                       │ Candidate Registry  │
                       │                     │
                       │ L0 / L1             │
                       │ evidence            │
                       │ authority            │
                       │ conflicts            │
                       └──────────┬──────────┘
                                  │
                            SME Certification
                                  │
                                  ▼
                       ┌─────────────────────┐
                       │ Canonical Registry  │
                       │                     │
                       │ Concepts            │
                       │ Relations           │
                       │ Metrics             │
                       │ Actions             │
                       │ States              │
                       │ Policies            │
                       │ Evidence            │
                       └──────────┬──────────┘
                                  │
               ┌──────────────────┼──────────────────┐
               ▼                  ▼                  ▼
       Snowflake SV        Semantic API        Evidence API
               │                  │                  │
               └──────────────────┼──────────────────┘
                                  ▼
                      ┌──────────────────────┐
                      │ Semantic Resolver    │
                      └──────────┬───────────┘
                                 ▼
                       Business Context Pack
                                 │
                                 ▼
                          ┌───────────────┐
                          │  DeepAgents   │
                          └───────┬───────┘
                                  │
             ┌────────────────────┼─────────────────────┐
             ▼                    ▼                     ▼
         Analysis               Query                  Act
             │                    │                     │
             ▼                    ▼                     ▼
       Documents          Snowflake SV          Policy Gateway
                                                      │
                                                      ▼
                                                Domain Workflow
                                                      │
                                                      ▼
                                            Business System of Record
```

旁边：

```text
                     LangSmith
                         │
       ┌─────────────────┼───────────────────┐
       ▼                 ▼                   ▼
     Trace          Semantic Eval       Outcome Eval
       │                 │                   │
       └─────────────────┼───────────────────┘
                         ▼
                 Semantic Gap Mining
                         │
                         └──────→ Candidate Registry
```

这就是一个真正可以持续演进的系统。

---

# 七十五、最后给一个非常具体的实施优先级

### P0：不要先建 Ontology UI

先建立：

```text
semantic_concept
semantic_metric
semantic_relation
semantic_evidence
semantic_conflict
```

用 PostgreSQL + Git 即可。

---

### P1：把 Snowflake Query History 接进来

自动发现：

```text
Top repeated metrics
Top repeated joins
Top filters
Top business questions
```

Snowflake 本身已有 Query History 驱动的 Semantic View Suggestions，可以优先复用，而不是自己重新实现全部逻辑。

---

### P2：把 Dashboard / BI 接进来

优先：

```text
Power BI
Tableau
```

已有业务定义尽可能自动迁移到 Semantic View。Snowflake Autopilot 已提供 Power BI / Tableau ingestion。

---

### P3：把文档和 Policy 接进来

只抽：

```text
Definition
Rule
Exception
Effective Date
Evidence
```

---

### P4：建立 Semantic Resolver

让 Agent 首先：

```text
resolve business context
```

再 reasoning。

---

### P5：把 Snowflake Semantic View 接成标准 Query Tool

不要：

```text
raw SQL
```

而：

```text
semantic query
```

---

### P6：LangSmith 建 Semantic Eval

至少先做：

```text
Concept
Metric
Entity
Semantic View
Evidence
```

五个。

---

### P7：Shadow Semantic Layer

即便只有：

```text
L0/L1
```

也开始监听 Agent：

```text
semantic miss
semantic ambiguity
fallback
```

---

### P8：把高价值业务逐步升级到 L2/L3

最终：

```text
L2
→ trustworthy analytics

L3
→ executable business actions
```

---

# 七十六、最终判断

**不要把“构建 Semantic Layer”当成一个数据建模项目。**

对于 Agent，真正应该建设的是一个持续演进的：

> **Enterprise Business Context System**

而最现实的构建方式不是：

```text
Business SME
→ 手工写 5000 个 Concept
```

也不是：

```text
LLM
→ 自动生成 5000 个 Concept
```

而是：

```text
               Existing Enterprise Knowledge
                           │
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
       SQL / BI         Metadata          Docs/API
          │                │                │
          └────────────────┼────────────────┘
                           ▼
                    Automated Mining
                           ▼
                    Candidate Semantics
                           ▼
                Evidence + Authority
                           ▼
                     Conflict Check
                           ▼
                     Human Review
                           ▼
                  Canonical Semantics
                           ▼
              ┌────────────┼────────────┐
              ▼            ▼            ▼
          Snowflake      APIs       Documents
        Semantic Views    Tools        Policy
              │            │            │
              └────────────┼────────────┘
                           ▼
                   Semantic Resolver
                           ▼
                    Context Pack
                           ▼
                       DeepAgents
                           ▼
                      Business Work
```

其中最重要的设计决定是：

### 第一

**自动挖掘优先于手工创建。**

从 SQL、Dashboard、BI Measure、Lineage、API、Workflow、Policy 和 Query History 里挖已有业务语义。

### 第二

**LLM 负责发现和整理候选语义，不负责定义最终事实。**

最终定义必须有：

```text
Evidence
Owner
Authority
Version
Certification
```

### 第三

**Snowflake Semantic Views 直接作为分析语义的生产载体。**

不需要再造第二套 metric semantic layer。Snowflake 已经提供 Autopilot、Query History Suggestions、Verified Queries、Semantic Studio、CI/CD、RBAC 等完整能力。

### 第四

**不要等待 Semantic Layer 100% 完成。**

采用：

```text
L0 Raw
L1 Inferred
L2 Curated
L3 Executable
```

并让 Agent 根据语义成熟度自动降级：

```text
L0/L1 → Explore
L2 → Analyze
L3 → Act
```

### 第五

**真正的 Agent Runtime 应该使用 Semantic Context，而不是直接使用整个 Semantic Layer。**

```text
User Request
→ Resolver
→ Context Pack
→ DeepAgents
```

### 第六

**LangSmith 不只是记录 Agent Trace，还应该记录 Semantic Trace。**

回答：

```text
Agent 使用了哪个 Concept？
用了哪个 Metric？
哪个 Semantic View？
哪个 Evidence？
哪个 Policy？
哪个 Semantic Release？
```

这样才能区分：

```text
Model Error
Semantic Error
Integration Error
```

### 第七

**让生产 Agent 反过来建设 Semantic Layer。**

```text
Real Agent Traffic
       ↓
Semantic Gaps
       ↓
Candidate Concepts / Metrics / Rules
       ↓
SME Certification
       ↓
New Semantic Release
       ↓
Better Agent
```

这最终形成一个非常重要的闭环：

> **Agent 不是 Semantic Layer 的消费者而已；Agent 的真实使用记录本身，就是下一代 Semantic Layer 的主要数据来源。**

这也是目前 Snowflake 自己的内部实践、Databricks Genie Ontology 的 inferred context，以及 Mastercard 等企业正在采用的 context engineering 方向中最值得借鉴的一点。

对于你们这样的金融服务企业，真正值得建设的最终不是一个“漂亮的 Ontology”，而是：

```text
可自动发现
+
可人工认证
+
可版本管理
+
可投影到 Snowflake
+
可被 DeepAgents 查询
+
可被 Policy 使用
+
可被 LangSmith 评估
+
可从生产 Trace 持续反哺
```

的 **Business Semantic Plane**。

这才是让 Agent 从“拥有金融知识的大模型”变成“真正懂本公司业务的企业 Agent”的实际工程路径。

---

# 参考资料

1. **Snowflake — Building an Internal Context Layer for AI Agents at Snowflake**
   最值得直接借鉴的实践案例。Snowflake 公开介绍内部 semantic layer、Query History、Dashboard eval、Semantic Views、Verified Queries、CI/CD，以及 2025 年内部 Agent 使用规模。
   [Snowflake Internal Context Layer](https://www.snowflake.com/en/blog/snowflake-internal-context-layer-for-ai-agents/?utm_source=chatgpt.com)

2. **Snowflake — Semantic View Autopilot**
   支持从表 metadata、keys、cardinality、Query History、SQL examples、Power BI、Tableau 等自动产生 Semantic View 初稿。
   [Semantic View Autopilot](https://docs.snowflake.com/en/user-guide/views-semantic/autopilot?utm_source=chatgpt.com)

3. **Snowflake — Best Practices for Modeling Semantic Views**
   包括从业务视角建模、按 domain/use case 拆 Semantic View、metrics、filters、relationships、verified queries、Cortex Search 和持续评估。
   [Semantic View Modeling Best Practices](https://docs.snowflake.com/en/user-guide/views-semantic/best-practices-modeling?utm_source=chatgpt.com)

4. **Snowflake — Best Practices for Developing and Deploying Semantic Views**
   介绍 Semantic View 的代码化、CI/CD、dbt、RBAC 和 business/data-engineering 共同 ownership。
   [Semantic View Development and Deployment](https://docs.snowflake.com/en/user-guide/views-semantic/best-practices-dev?utm_source=chatgpt.com)

5. **Snowflake — Semantic View Suggestions**
   直接利用 Query History 和实际使用情况自动产生 verified query、metric、filter 等建议。
   [Semantic View Suggestions](https://docs.snowflake.com/en/user-guide/views-semantic/verified-query-suggestions?utm_source=chatgpt.com)

6. **Snowflake — Optimization with Verified Queries**
   展示如何从真实 verified SQL 反推出更完整的 semantic model，例如自动建议 `is_active` 等业务过滤器。
   [Verified Query Optimization](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-analyst/analyst-optimization?utm_source=chatgpt.com)

7. **Snowflake — Power BI ingestion for Semantic View Autopilot**
   2026 年 8 月 GA，支持把既有 Power BI DAX measures、table relationships 和 column descriptions 迁移到 Semantic View。
   [Power BI Semantic View Ingestion](https://docs.snowflake.com/en/release-notes/2026/other/2026-08-18-semantic-views-power-bi-ingestion-ga?utm_source=chatgpt.com)

8. **Snowflake — Semantic Studio**
   2026 年 public preview，支持 conversational authoring、YAML、Git-backed versioning、部署和 request-ID debugging。
   [Semantic Studio](https://docs.snowflake.com/en/user-guide/views-semantic/semantic-studio?utm_source=chatgpt.com)

9. **Snowflake — Horizon Catalog / AI Context Layer**
   包含 Semantic Views、column-level lineage、auto-generated descriptions、tags 和治理能力。
   [Snowflake Horizon Catalog](https://docs.snowflake.com/en/user-guide/snowflake-horizon?utm_source=chatgpt.com)

10. **Snowflake — Horizon Context**
    讨论把 business logic、semantic definitions 和 AI context 从单独应用中抽离出来。
    [Snowflake Horizon Context](https://www.snowflake.com/en/blog/horizon-context-governed-context/?utm_source=chatgpt.com)

11. **Databricks — Genie Ontology**
    当前非常值得借鉴的“Curated Context + Inferred Context”架构；自动从 metric views、dashboards、SQL queries 和 Genie Agents 中抽取 context，并计算 authority score。
    [Databricks Genie Ontology](https://docs.databricks.com/aws/en/genie/genie-ontology?utm_source=chatgpt.com)

12. **Databricks — Curate an Effective Genie Agent**
    强调企业 Agent 的准确性依赖于业务定义、dataset documentation、SQL business semantics、example queries 和 domain-specific instructions。
    [Genie Agent Best Practices](https://docs.databricks.com/aws/en/genie-agents/best-practices?utm_source=chatgpt.com)

13. **Atlan — Context Agents**
    说明如何从 table/column metadata、lineage、query history、business glossary 和 knowledge files 自动生成 context。
    [Atlan Context Agents](https://docs.atlan.com/product/capabilities/governance/context-agents-studio/concepts/agents?utm_source=chatgpt.com)

14. **Atlan — Enterprise Context Layer**
    说明 governed context layer 如何把 metadata、lineage、glossary、policy 统一，再通过 MCP 提供给 Agent。
    [Atlan Enterprise Context Layer](https://docs.atlan.com/agents/how-tos/build-an-enterprise-context-layer?utm_source=chatgpt.com)

15. **Atlan — Context Agents Studio**
    描述利用 SQL、lineage、BI usage 等信号自动丰富数据资产，而不是只根据表名生成描述。
    [Atlan Context Agents Studio](https://docs.atlan.com/product/capabilities/governance/context-agents-studio?utm_source=chatgpt.com)

16. **Mastercard / Atlan — Context-by-Design**
    Mastercard 的公开案例：已有多年 data governance、lineage、ownership 和 steward-confirmed definitions，再通过 Context Agents 批量 enrich AI-ready data；Atlan 披露超过 30,000 assets、节省 6,000+ 小时。该数字属于案例方披露。
    [Mastercard Context-by-Design Case](https://atlan.com/customers/mastercard-databricks-summit-2026/?utm_source=chatgpt.com)

17. **Apache Ossie**
    原 Open Semantic Interchange，当前作为 Apache Incubating 项目，目标是提供 vendor-neutral semantic metadata exchange standard。
    [Apache Ossie](https://ossie.apache.org/?utm_source=chatgpt.com)

18. **EDM Council — FIBO**
    金融行业正式业务本体，适合作为企业金融 Ontology 的外部参考层，而不是直接替代企业自己的业务定义。
    [FIBO](https://edmcouncil.org/financial-industry-business-ontology/?utm_source=chatgpt.com)

19. **BIAN — Service Landscape**
    Business Capability、Service Domain、Business Object 和 Semantic API 的银行业参考模型。
    [BIAN Service Landscape](https://bian.org/deliverables/service-landscape/?utm_source=chatgpt.com)

20. **Palantir — Ontology Architecture**
    重要参考是把 enterprise ontology 从“objects/properties/links”扩大到 actions、functions、security，使 ontology 能参与 operational decision-making。
    [Palantir Ontology](https://www.palantir.com/docs/foundry/object-backend/overview?utm_source=chatgpt.com)

21. **LangChain — DeepAgents**
    DeepAgents 基于 LangGraph，提供 skills、filesystem、subagents、memory、planning 和 HITL 等 Agent harness 能力。
    [DeepAgents](https://github.com/langchain-ai/deepagents?utm_source=chatgpt.com)

22. **LangSmith — Evaluation**
    支持 offline/online evaluation、LLM-as-judge、code evaluator、human review、trajectory evaluation 和 CI/CD eval，可用于 Semantic Grounding Eval。
    [LangSmith Evaluation](https://www.langchain.com/langsmith/evaluation?utm_source=chatgpt.com)

23. **FINRA — 2026 Annual Regulatory Oversight Report: GenAI**
    对证券业 AI Agent 的 domain knowledge、scope/authority、system access、data handling、human oversight、actions/decisions 和 guardrails 等问题的监管观察。
    [FINRA 2026 Report](https://www.finra.org/sites/default/files/2025-12/2026-annual-regulatory-oversight-report.pdf?utm_source=chatgpt.com)

24. **Morgan Stanley / OpenAI — AI Evals**
    真实金融服务案例，展示企业知识库、专家反馈、evaluation 和持续 regression testing 如何进入生产 AI 系统。
    [Morgan Stanley AI Evals](https://openai.com/index/morgan-stanley/?utm_source=chatgpt.com)

25. **Deutsche Bank — Third-Party Risk Management Agentic AI**
    多 Agent 分阶段处理供应商风险材料，并保留人工 review、edit 和 override。
    [Deutsche Bank TPRM Agentic AI](https://www.db.com/news/detail/20260513-putting-agentic-ai-to-work-in-third-party-risk-management?utm_source=chatgpt.com)

26. **Snowflake — Fidelity Data Liquidity**
    Snowflake 对 Fidelity 数据云与 data liquidity 建设的公开案例；可作为类似大型金融服务机构数据基础的参考，但不能由此推断 Fidelity 当前内部 Agent 架构。
    [Fidelity / Snowflake Data Liquidity](https://www.snowflake.com/en/blog/fidelity-achieves-data-liquidity-cloud/?utm_source=chatgpt.com)





------------------------




前面反复说 Policy，确实容易把它和 Prompt、Tool、Workflow、权限系统混在一起。对于你现在这种 **DeepAgents + Tool Gateway/MCP + AWS AgentCore + Snowflake/Postgres + 金融业务** 的架构，我建议把 Policy 定义得非常窄：

> **Policy 是一组独立于 Agent 推理的、可版本化、可测试、可审计的规则，用来对一个“受保护的请求”做确定性决策，并由系统强制执行。**

最典型的结果不是一段自然语言，而是：

```json
{
  "decision": "ALLOW",
  "policy_id": "proxy-vote.submit.v3",
  "policy_version": "3.2.1",
  "obligations": [],
  "reason_code": "USER_ENTITLED_AND_WORKFLOW_READY"
}
```

也可以是：

```json
{
  "decision": "DENY",
  "policy_id": "trade-order.submit.v7",
  "reason_code": "LIMIT_EXCEEDED"
}
```

或者：

```json
{
  "decision": "REQUIRE_APPROVAL",
  "policy_id": "trade-order.high-risk.v2",
  "reason_code": "HIGH_VALUE_TRADE"
}
```

这和“请 Agent 不要做危险的事情”完全不是一个层次。

---

# 1. Policy 本质上是什么？

可以把它抽象成：

```text
Policy(Request Context) -> Decision
```

其中 Request Context 通常包含：

```text
Who
  principal / user / agent / service

What
  action / tool / operation

Which
  resource / account / portfolio / document / dataset

Context
  amount
  jurisdiction
  time
  workflow state
  data classification
  user attributes
  business attributes
  risk signals
```

然后 Policy 给出一个确定性结果：

```text
ALLOW
DENY
REQUIRE_APPROVAL
ALLOW_WITH_CONSTRAINTS
```

这其实是非常成熟的传统架构。

XACML 很早就把它拆成：

```text
PAP = Policy Administration Point
PDP = Policy Decision Point
PEP = Policy Enforcement Point
```

也就是：

```text
              Policy Admin
                  │
                  ▼
             ┌─────────┐
             │   PDP   │
             │ Decision│
             └────┬────┘
                  │
                  ▼
Request ───────► PEP ───────► Protected Resource
```

OASIS 的定义就是：PDP 根据 Policy 产生决策，PEP 负责在真正访问资源时执行这个决策。([OASIS Open][1])

OPA 也是这个思路：Policy 独立于业务代码，应用把结构化请求交给 OPA，OPA 返回 Policy Decision。([Open Policy Agent][2])

Cedar 同样明确把 authorization logic 从应用业务逻辑中分离出来，通过 `principal / action / resource / context` 做授权决策。([Cedar Policy Language Reference Guide][3])

---

# 2. 所以 Policy 不是 Prompt

这是 Agent 架构里最容易犯的错误。

例如：

```text
You are a financial assistant.
Never submit a trade without approval.
Never expose confidential information.
Only use authorized data.
```

这是一组 **Agent Instructions / Guardrails**。

它可以帮助 LLM 行为更符合预期，但它不是可靠的 Policy。

因为 Agent 可以：

```text
理解错
忘记
忽略
被 prompt injection 干扰
自己重新解释
根本不调用某个 tool
```

所以：

```text
Prompt says:
"Only access data you're authorized to access."

```

和：

```text
System says:
"Before executing getPortfolioHoldings(),
PEP MUST call PDP.
PDP returns DENY.
Request cannot execute."

```

完全不是同一个安全等级。

你之前总结的：

> LLM 可以生成建议，但是不能定义 enterprise security boundary。

实际上就是在说这个问题。

---

# 3. Policy 也不是 Tool

Tool 是：

> **“我可以做什么？”**

Policy 是：

> **“在什么情况下允许我做？”**

例如：

```text
Tool:
submit_trade(order)

Policy:
- trader must have trading entitlement
- portfolio must belong to trader's scope
- instrument must be permitted
- amount <= limit
- market must be open
- if amount > threshold -> approval required
```

Tool 是能力。

Policy 是约束能力的条件。

所以不要把它们合起来。

---

# 4. Policy 更不是 MCP Service

MCP 是一个通信 / capability exposure mechanism。

比如：

```text
Agent
   │
   ▼
MCP
   │
   ├── search_holdings
   ├── get_trade
   ├── submit_trade
   └── cancel_trade
```

MCP 本身只是把这些能力暴露出来。

真正的架构应该是：

```text
Agent
  │
  │ tool call
  ▼
Tool Gateway / MCP Gateway
  │
  │ Policy Check
  ▼
Policy Decision Point
  │
  ├── ALLOW
  ├── DENY
  └── REQUIRE_APPROVAL
  │
  ▼
MCP Tool
  │
  ▼
Domain API
```

AWS AgentCore 目前自己的 Policy 设计实际上就是这个模式：Gateway 拦截 tool invocation，Policy Engine 用 Cedar 对每次工具调用做授权，默认 deny，并在工具执行之前做判断。([AWS Documentation][4])

这对你的架构非常有参考价值。

---

# 5. 最危险的设计：把 Policy 做成 Agent Tool

例如：

```text
Agent tools:

search_data()
submit_trade()
evaluate_policy()
```

然后 Prompt：

```text
Before every sensitive operation,
call evaluate_policy().
```

这实际上不够安全。

因为：

```text
Agent
  │
  ├── evaluate_policy()
  └── submit_trade()
```

Agent 自己决定是否调用 `evaluate_policy()`。

于是：

```text
LLM: 我觉得这次没必要检查 Policy
```

系统就失去了控制点。

正确方式是：

```text
Agent
  │
  ▼
submit_trade()
  │
  ▼
PEP
  │
  ├── automatically → PDP
  │
  ├── DENY → stop
  ├── APPROVAL → pause workflow
  └── ALLOW → invoke submit_trade
```

**Policy enforcement 不能依赖 LLM 自觉。**

这是你整个 Agent Governance 架构里非常重要的一条。

---

# 6. 哪些事情应该用 Policy？

我建议主要使用下面四类。

## 6.1 Authorization Policy

这是最经典的一类：

> 谁可以对什么资源执行什么动作？

例如：

```text
Alice
CAN
read
Portfolio-A
```

或者：

```text
Agent-X
CAN
read
Fund-Holdings
WHEN
user has entitlement
```

典型：

```text
principal
+
action
+
resource
+
context
```

Cedar、OPA、XACML 等都非常适合这一类。AWS Verified Permissions 也是围绕这种细粒度授权建立的。([AWS Documentation][5])

---

# 7. 7.2 Risk / Action Control Policy

这对 Agent 比普通 RBAC 更重要。

例如：

```text
trade.submit

IF
amount > 1,000,000
THEN
REQUIRE_APPROVAL
```

或者：

```text
proxy_vote.submit

IF
workflow_state != APPROVED
THEN
DENY
```

或者：

```text
payment.execute

IF
new_counterparty == true
THEN
REQUIRE_STEP_UP_AUTH
```

这些不是简单的：

```text
"User has permission"
```

而是：

> User 虽然有权限，但**这一次操作**是否满足控制条件？

这正是 Agent 比普通 API 更需要 Policy 的地方。

---

# 8. 7.3 Data Access Policy

例如：

```text
Agent
   │
   ▼
search holdings
   │
   ▼
Policy
   │
   ├── user entitlement
   ├── data classification
   ├── legal entity
   ├── geography
   └── portfolio scope
```

然后决定：

```text
ALLOW dataset
ALLOW rows
MASK columns
DENY
```

这里尤其要注意：

> **Policy 必须在数据真正返回之前执行。**

不要：

```text
Retriever
  ↓
拿到所有数据
  ↓
LLM
  ↓
"请不要泄露不能看的数据"
```

这是典型错误。

正确是：

```text
Query Request
     ↓
Data Policy
     ↓
authorized query / filtered dataset
     ↓
Retriever
     ↓
LLM
```

这与你之前提出的：

> Retrieval can return data, but cannot bypass Data Entitlement.

是一致的。

---

# 9. 7.4 Human Approval Policy

这也是 Agent 场景非常有价值的一类。

例如：

```text
IF
trade.amount > 5M
OR
counterparty == new
OR
action == external_submission
THEN
REQUIRE_APPROVAL
```

这里 Policy **不负责审批本身**。

Policy 只决定：

```text
需要审批
```

Workflow 才负责：

```text
create approval case
→ wait
→ approve/reject
→ resume execution
```

因此：

```text
Policy ≠ Approval Workflow
```

这点非常重要。

---

# 10. 哪些东西不应该用 Policy？

这个边界同样重要。

## 不应该拿 Policy 做 Workflow

例如：

```text
DRAFT
  ↓
REVIEW
  ↓
APPROVED
  ↓
EXECUTED
```

这是 Workflow / Business State。

不要把它写成：

```text
if A then B
if B then C
if C then D
```

全部塞进 Policy Engine。

Policy 可以判断：

```text
"当前 workflow_state 是否允许 execute？"
```

但不应该拥有整个 workflow state machine。

---

# 11. 不应该拿 Policy 做业务计算

比如：

```text
NAV = asset_value - liabilities
```

或者：

```text
performance =
    (ending_value - beginning_value) / beginning_value
```

这是：

```text
Business Logic
```

不是 Policy。

再比如：

```text
isEligibleForFund(user, fund)
```

可能内部需要非常复杂的业务计算。

不要为了“Policy 化”而全部塞进 Rego/Cedar。

更好的方式：

```text
Domain Service
     │
     ├── computes eligibility
     │
     ▼
Context
     │
     ▼
Policy
     │
     └── decides whether action is allowed
```

---

# 12. 不应该拿 Policy 做 LLM 行为指导

例如：

```text
回答必须引用来源

回答不要太长

先搜索再回答

如果没有证据就说不知道

应该优先使用官方文档
```

这些通常更适合：

```text
Agent instruction
+
Tool selection
+
Evaluation
+
Output validation
```

而不是 Policy。

当然，其中某些内容在高风险场景可以变成系统级控制。

例如：

```text
external regulatory filing
```

不能因为 LLM “觉得没问题”就提交。

于是就可以变成：

```text
Policy:
external_submission requires approved evidence set
```

这时候它已经不再只是“提示模型怎么写”，而是在控制实际 side effect。

---

# 13. 一个非常实用的判断标准

判断一条东西是不是 Policy，我建议问：

> **如果 LLM 完全忽略这句话，系统仍然必须阻止/限制这个动作吗？**

如果答案是：

### 是

很可能应该是 Policy。

例如：

```text
User 没有 portfolio entitlement
→ 必须拒绝
```

```text
Trade > 5M
→ 必须审批
```

```text
Workflow != APPROVED
→ 不能提交
```

### 否

大概率只是 Prompt / Instruction / Evaluation。

例如：

```text
回答的时候尽量引用资料
```

```text
优先使用公司内部知识库
```

```text
遇到不确定问题先搜索
```

---

# 14. Policy 真正在 Agent Runtime 里长什么样？

对于你现在的架构，我建议把执行链路明确成：

```text
                    ┌──────────────────┐
                    │      Agent       │
                    │   DeepAgents     │
                    └────────┬─────────┘
                             │
                       Tool Proposal
                             │
                             ▼
                ┌────────────────────────┐
                │ Tool Gateway / PEP      │
                │                        │
                │ authenticate           │
                │ normalize request      │
                │ policy enforcement     │
                └────────────┬───────────┘
                             │
                        Policy Request
                             │
                             ▼
                ┌────────────────────────┐
                │ Policy Decision Point  │
                │                        │
                │ Cedar / OPA / etc.    │
                └────────────┬───────────┘
                             │
                  ┌──────────┼───────────┐
                  │          │           │
                ALLOW       DENY     APPROVAL
                  │          │           │
                  │          │           ▼
                  │          │       Workflow
                  │          │
                  ▼          ▼
               Tool      Execution stops
                  │
                  ▼
             Domain API
                  │
                  ▼
             Business DB
```

这里有一个非常关键的架构点：

> **Agent Runtime 可以是“Policy requester”，但不能是最终 Policy enforcer。**

真正的 enforcement 应该在 Tool Gateway / Domain API / Data Access Boundary。

---

# 15. Policy 的输入应该是什么？

不要把输入做成自然语言。

例如不要：

```text
"Can Alice make this trade?"
```

而应该：

```json
{
  "principal": {
    "type": "user",
    "id": "alice"
  },
  "agent": {
    "id": "trade-agent",
    "version": "2026.09.3"
  },
  "action": {
    "type": "trade.submit"
  },
  "resource": {
    "type": "portfolio",
    "id": "PF-123"
  },
  "context": {
    "instrument": "AAPL",
    "quantity": 100000,
    "notional": 2500000,
    "workflow_state": "APPROVED",
    "jurisdiction": "US"
  }
}
```

然后：

```text
PDP
  ↓
ALLOW / DENY / REQUIRE_APPROVAL
```

这样才可以：

```text
test
version
audit
replay
compare
```

---

# 16. Policy 最好不要自己去“猜”上下文

比如 Policy 不应该自己：

```text
查数据库
理解自然语言
调用 LLM
搜索互联网
```

然后决定：

```text
应该允许
```

这会让 Policy 又变成一个 Agent。

更合理：

```text
Identity Service
     ↓
Entitlement Service
     ↓
Workflow Service
     ↓
Risk Service
     ↓
Domain Service
     ↓
Policy Context
     ↓
PDP
```

Policy 使用这些已经定义好的 facts：

```text
user.role = PM
user.region = US
user.entitlement = portfolio-A
workflow.state = APPROVED
trade.amount = 2.5M
```

而不是：

```text
Policy:
"自己去理解这个用户应该不应该交易"
```

---

# 17. Policy 和 Business Rule 的边界

这是实际项目里最容易失控的地方。

例如：

```text
A client is eligible for Product X
```

到底是：

```text
Business Rule
```

还是：

```text
Policy
```

取决于它的职责。

如果它是：

```text
Product Eligibility Engine
```

负责计算：

```text
eligible = true
```

这是 Business Logic。

然后：

```text
Policy:
Only eligible clients may submit Product-X application.
```

才是 Policy。

也就是说：

```text
Business Logic
     ↓
Facts / Decision Inputs
     ↓
Policy
     ↓
Authorization / Control Decision
```

不要把整个业务系统重写成 Policy Language。

---

# 18. Policy 应该做成 Web Service 吗？

答案是：

> **Policy 本身不是 Web Service，但企业通常应该有一个 Policy Control Plane；Policy Decision Point 是否做成远程 Web Service，则取决于执行位置和延迟要求。**

这是两个问题。

## Control Plane

我建议做成服务。

例如：

```text
Policy Management Service

GET  /policies
POST /policies
POST /policies/{id}/validate
POST /policies/{id}/test
POST /policies/{id}/publish
GET  /policies/{id}/versions
GET  /decisions/{requestId}
```

再配：

```text
Web UI
Git
Pull Request
Approval
Versioning
Audit
Test
Deployment
```

---

# 19. Data Plane 不一定要远程调用

可以是：

```text
Agent
  ↓
Gateway
  ↓
local OPA/Cedar
  ↓
decision
```

或者：

```text
Gateway
  ↓
Policy Service
  ↓
decision
```

也可以：

```text
Gateway
  ↓
Sidecar PDP
  ↓
decision
```

OPA 官方也明确支持多种部署方式，并建议在对延迟和可靠性敏感的情况下让 PDP 尽可能靠近 PEP；同时也存在适合通过网络集中调用的场景。([Open Policy Agent][6])

所以不要简单得出：

> “Policy 一定应该是一个 HTTP 微服务。”

这不是必须的。

---

# 20. 对你们的架构，我更建议这个形态

你们已经有：

```text
Agent Platform
DeepAgents
AWS AgentCore
K8s sandbox
LangSmith
Postgres
Snowflake
MCP / Tool Gateway
```

我不会再做一个“万能 Policy Microservice”，然后所有事情都调用它。

建议分成：

```text
                 Policy Control Plane
                         │
             ┌───────────┴───────────┐
             │                       │
       Policy Registry          Policy Authoring
             │                       │
             └───────────┬───────────┘
                         │
                    Policy Bundle
                         │
          ┌──────────────┴──────────────┐
          │                             │
     AgentCore Gateway             Domain APIs
          │                             │
          ▼                             ▼
      PDP / Cedar                  PDP / OPA
          │                             │
          ▼                             ▼
        Tools                     Business Actions
```

其中：

### AgentCore Policy

主要处理：

```text
Agent / Principal
      ↓
Tool
      ↓
Gateway
      ↓
Allow / Deny
```

AWS AgentCore 现在的 Policy 就是围绕 Gateway tool invocation 做这个事情，并支持 `LOG_ONLY` 和 `ENFORCE` 两种模式，便于先观察再强制。([AWS Documentation][7])

### Enterprise Policy

处理更复杂的业务控制：

```text
trade.submit
proxy_vote.submit
client_data.read
external_message.send
document.publish
```

例如：

```text
用户有权限
+
业务对象属于用户范围
+
Workflow 状态正确
+
风险条件满足
+
没有 regulatory restriction
```

最终才决定：

```text
ALLOW
DENY
REQUIRE_APPROVAL
```

---

# 21. 一个金融 Agent 的实际例子

假设 Agent 要执行：

```text
submit_proxy_vote()
```

Agent 本身可能产生：

```json
{
  "proposal_id": "P123",
  "vote": "AGAINST"
}
```

这只是 Proposal。

真正执行：

```text
Agent
 ↓
submit_proxy_vote()
 ↓
Policy Enforcement Point
 ↓
PDP
```

Policy 输入：

```json
{
  "principal": "user-123",
  "action": "proxy_vote.submit",
  "resource": "fund-456",
  "context": {
    "workflow_state": "READY_FOR_SUBMISSION",
    "user_entitled": true,
    "voting_deadline_passed": false,
    "market_restriction": false
  }
}
```

Policy：

```text
ALLOW
when:
  entitled == true
  AND
  workflow_state == READY_FOR_SUBMISSION
  AND
  deadline_passed == false
  AND
  market_restriction == false
```

然后：

```text
ALLOW
 ↓
ISS / Domain API
```

如果：

```text
workflow_state = DRAFT
```

那么：

```text
DENY
```

Agent 再聪明也没用。

这就是：

> **Agent can reason autonomously, but cannot independently break authorization.**

---

# 22. Policy 不应该成为“第二套业务系统”

这是我特别建议你们警惕的。

很容易出现这样的东西：

```text
Policy Service
 ├── trade rules
 ├── workflow rules
 ├── eligibility rules
 ├── pricing rules
 ├── portfolio rules
 ├── compliance rules
 ├── approval rules
 ├── data rules
 └── 2000 条 Rego/Cedar
```

最后整个企业业务逻辑都进了 Policy Engine。

这样会非常难维护。

我更建议：

```text
Business Logic
    ↓
计算事实 / 业务状态

Policy
    ↓
决定“这个主体在这个上下文中能不能做这件事”

Workflow
    ↓
决定业务过程接下来走哪个状态

Agent
    ↓
决定如何完成任务 / 提出下一步动作
```

四者不要混。

---

# 23. Policy 应该如何维护？

我建议把 Policy 当成一个真正的软件制品，而不是配置文件。

最少需要：

```text
Policy ID
Policy version
Owner
Business domain
Effective time
Expiration time
Source / regulatory basis
Policy definition
Test cases
Approval record
Deployment status
```

例如：

```yaml
id: trade.submit.high-value
version: 3.4.0

owner: trading-controls

effective_from: 2026-09-01

rule:
  action: trade.submit
  condition:
    notional_gt: 5000000

decision:
  type: REQUIRE_APPROVAL
  approval_type: senior_trader

tests:
  - normal_trade
  - exactly_5m
  - above_5m
  - missing_entitlement
```

然后：

```text
Git
 ↓
PR
 ↓
Automated Tests
 ↓
Policy Review
 ↓
Business Approval
 ↓
Deploy
 ↓
LOG_ONLY
 ↓
ENFORCE
```

AWS AgentCore 自己现在也提供 `LOG_ONLY` → `ENFORCE` 的策略部署模式，这个思路很适合拿来做你们自己的 Policy rollout。([AWS Documentation][8])

---

# 24. Policy 绝对应该版本化

例如：

```text
Policy v3.1
2026-08-01

Policy v3.2
2026-09-01
```

Agent 执行记录：

```json
{
  "policy_id": "trade.submit.high-value",
  "policy_version": "3.2.0",
  "decision": "REQUIRE_APPROVAL",
  "timestamp": "2026-09-23T10:15:23Z"
}
```

这样几个月以后才能回答：

> 当时为什么允许？

而不是：

> 现在 Policy 是这样，当时大概也是这样。

对于金融服务，这个区别非常大。

---

# 25. Policy Decision 本身要进入 Audit Evidence

你之前强调：

> LangSmith 可以记录 runtime，但 Regulatory Audit Evidence 必须单独定义。

这里 Policy 是一个非常重要的证据来源。

例如：

```text
Business Execution ID: EX-123

Agent Run:
  agent = proxy-vote-agent
  run = RUN-456

Tool:
  submit_proxy_vote

Policy:
  policy_id = proxy_vote.submit
  version = 4.1

Decision:
  ALLOW

Inputs:
  user_entitlement = true
  workflow_state = READY
  deadline_passed = false

Decision timestamp:
  ...

Executor:
  Gateway-7
```

于是最终形成：

```text
Who approved
What ran
What was accessed
What was done
Why allowed
Which policy allowed it
Which policy version was active
```

这个比单纯保存：

```text
LLM said "I am allowed to do this"
```

有意义得多。

---

# 26. Policy 能不能让 LLM 生成？

可以，但只能生成 **candidate**。

例如：

```text
Business Owner:

"超过 500 万美元的交易必须由 Senior Trader 审批。"
```

LLM 可以生成：

```cedar
permit(...)
when { context.notional < 5000000 };
```

或者：

```text
REQUIRE_APPROVAL if notional >= 5000000
```

但不能：

```text
LLM → production policy
```

正确应该是：

```text
Human requirement
       ↓
LLM candidate
       ↓
Policy compiler / validator
       ↓
Automated tests
       ↓
Business owner review
       ↓
Security / compliance review
       ↓
Deploy
```

AWS AgentCore 现在也支持从自然语言生成 Cedar Policy，但其文档同时要求对生成的 Cedar Policy 进行审核和验证；这正好说明 Natural Language 只是 authoring interface，不应该取代 Policy 本身。([AWS Documentation][9])

---

# 27. 最后，把整个 Agent 架构里的几个东西彻底分开

我建议你们内部直接采用下面这个划分：

| 东西                   | 主要回答的问题         | LLM 能否绕过                    |
| -------------------- | --------------- | --------------------------- |
| Prompt / Instruction | Agent 应该怎么思考    | 能                           |
| Tool                 | Agent 能做什么      | 不能单独代表授权                    |
| MCP                  | 如何暴露/调用能力       | 不能单独代表授权                    |
| Business Logic       | 业务怎么算           | 不能                          |
| Workflow             | 业务过程现在在哪一步      | 不能                          |
| Policy               | **现在允许不允许做这件事** | **不能**                      |
| Authorization        | 谁对什么有权限         | 不能                          |
| Approval             | 谁必须确认           | 不能                          |
| Audit                | 事后证明发生了什么       | 不能                          |
| Evaluation           | Agent 做得好不好     | 不应该作为 runtime authorization |

最重要的是最后这句话：

> **Policy 的职责不是告诉 Agent“应该怎么做”，而是告诉系统“这个具体动作现在能不能做”。**

---

# 28. 对你们当前平台，我会定一个非常明确的原则

我建议把 Policy 的边界定成：

```text
Agent
    = propose

Workflow
    = orchestrate

Business Service
    = execute business logic

Policy
    = decide whether execution is permitted

PEP
    = enforce the decision

Audit
    = prove what happened
```

于是一次 Agent Action 就变成：

```text
LLM Proposal
     ↓
Tool Gateway
     ↓
Authentication
     ↓
Policy Evaluation
     ↓
Workflow / Approval Check
     ↓
Domain API
     ↓
Side Effect
     ↓
Audit Evidence
```

而不是：

```text
Prompt:
"Please follow our policy."

Agent:
"I think this is allowed."

Tool:
"OK."
```

后者从工程治理角度几乎肯定是不够的。

---

## 对你们的最终落地建议

第一阶段其实不需要建设一个巨大的“Enterprise Policy Platform”。

先做四件事就足够：

```text
1. Policy Registry
   Git + metadata + version

2. PDP
   Cedar 或 OPA

3. PEP
   Tool Gateway / MCP Gateway / Domain API

4. Policy Audit
   decision + policy version + context + evidence
```

然后把 Policy 暂时严格限制在三类：

```text
Authorization
Action / Risk Control
Data Access
```

**Workflow、业务计算、Agent Instructions、Evaluation 不要一开始都塞进 Policy。**

这会比做一个“什么都叫 Policy”的平台清晰很多。

对于你现在已经使用 **AWS AgentCore Gateway** 的环境，一个很实际的组合是：**AgentCore Policy/Cedar 负责工具边界授权；企业自己的 Policy 层负责跨工具、业务对象、Workflow、数据 entitlement 和金融业务控制。** AgentCore 本身已经提供了工具调用拦截、Cedar Policy Engine、默认拒绝、Policy 版本资源等机制，可直接作为第一层 PEP/PDP 的参考实现。([AWS Documentation][4])

这也意味着你们后面设计 **Agent Control Plane** 时，Policy 不应该只是其中一个“配置页面”，而应该是一个独立的 **Policy Control Plane + Policy Enforcement Plane**。

[1]: https://docs.oasis-open.org/xacml/3.0/xacml-profile-saml2.0-v2-spec-cs-01-en.html?utm_source=chatgpt.com "SAML 2.0 Profile of XACML 2.0 v2"
[2]: https://www.openpolicyagent.org/docs?utm_source=chatgpt.com "Open Policy Agent (OPA) | Open Policy Agent"
[3]: https://docs.cedarpolicy.com/?utm_source=chatgpt.com "What is Cedar? | Cedar Policy Language Reference Guide"
[4]: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/policy-core-concepts.html?utm_source=chatgpt.com "Core concepts - Amazon Bedrock AgentCore"
[5]: https://docs.aws.amazon.com/verifiedpermissions/?utm_source=chatgpt.com "Amazon Verified Permissions Documentation"
[6]: https://www.openpolicyagent.org/docs/deploy?utm_source=chatgpt.com "How to Deploy OPA | Open Policy Agent"
[7]: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/policy-getting-started.html?utm_source=chatgpt.com "Getting started with Policy in AgentCore - Amazon Bedrock AgentCore"
[8]: https://docs.aws.amazon.com/bedrock-agentcore-control/latest/APIReference/API_GatewayPolicyEngineConfiguration.html?utm_source=chatgpt.com "GatewayPolicyEngineConfiguration - Amazon Bedrock AgentCore Control Plane"
[9]: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/policy-create-policies.html?utm_source=chatgpt.com "Create a policy - Amazon Bedrock AgentCore"



-----------


LangSmith 当然可以继续用，而且我建议你们**一定继续用 LangSmith 做 Logging / Tracing / Evaluation**。但要把两个概念分开：

> **LangSmith 是 Observability / Trace Evidence 平台，不应该被当成 Runtime Policy Engine，也不应该直接等同于 Regulatory Audit System。**

这三个东西的职责不一样。

## 1. LangSmith 有没有 Policy？

从目前 LangSmith 的能力来看，它有一些相关能力，但**没有等价于 OPA/Cedar/AgentCore Policy Engine 那种“受保护动作执行前的、强制性的 Policy Decision Point”**。

LangSmith 现在有：

* Agent / Assistant 的权限控制；
* Tool / MCP server 的配置；
* Online Evaluator；
* Automation / Webhook；
* Trace filtering；
* 对生产 Trace 做 LLM-as-a-Judge 或 code evaluator。

例如 LangSmith 的 online evaluator 可以针对生产 trace 做实时或近实时评估，也可以针对特定 tool call、metadata、feedback 等条件触发。它还可以通过 webhook 把结果发送出去。([Docs by LangChain][1])

但它和这种东西不是一回事：

```text
Agent
   │
   │ submit_trade()
   ▼
Policy Enforcement Point
   │
   ▼
Policy Decision Point
   │
   ├── DENY
   ├── REQUIRE_APPROVAL
   └── ALLOW
   │
   ▼
submit_trade()
```

也就是说，LangSmith 的 evaluator 更接近：

```text
"这次 Agent 执行得怎么样？"
```

而 Policy 是：

```text
"这个动作现在到底准不准执行？"
```

这两个不要混。

---

# 2. LangSmith 的 Trace 其实非常适合你们做 Audit Evidence 的一部分

这一点我反而建议你利用起来。

LangSmith Trace 能记录：

```text
Root Agent Run
 ├── model call
 ├── tool call
 │    ├── input
 │    └── output
 ├── retrieval
 ├── sub-agent
 ├── MCP call
 └── final response
```

LangSmith SDK 也允许给 Run 附加 metadata / tags 等信息；当前 SDK 已经可以查询、检索和导出 runs/traces。官方 CLI 目前直接支持：

```bash
langsmith trace export ./traces \
  --project my-app \
  --limit 20 \
  --full
```

以及：

```bash
langsmith run export llm_calls.jsonl \
  --project my-app \
  --run-type llm \
  --full
```

官方 CLI 文档明确提供了 `trace list/get/export` 和 `run list/get/export`。([GitHub][2])

程序化访问也可以：

```python
from langsmith import Client

client = Client()

runs = client.list_runs(
    project_name="my-agent",
    start_time=...
)
```

不过当前 Python SDK 已经把 `list_runs()` 标记为 deprecated，新的接口是：

```text
client.runs.query()
client.runs.retrieve()
```

官方 SDK 源码已经明确标注这个迁移方向。([GitHub][3])

所以：

> **LangSmith 的数据不是只能在 UI 里面看。完全可以通过 API / SDK / CLI 抽取出来。**

---

# 3. 但我不建议“每天把 LangSmith 导出来，再当 Audit Log”

这里是你这个架构里一个很关键的区别。

假设：

```text
09:00 Agent calls submit_trade
09:00 Policy says ALLOW
09:01 trade actually submitted
```

LangSmith 记录：

```text
Agent
 └── submit_trade(...)
```

这只能说明：

> Agent 发起了这个 tool call。

它未必天然证明：

> 谁授权的？

> 哪个 Policy version 做出的决定？

> Policy 当时使用的输入是什么？

> 最终业务系统是否真的执行成功？

> 中间是否发生 retry？

> 是不是审批后才真正执行？

> 业务系统最终产生了什么结果？

所以我会把审计证据设计成：

```text
                ┌──────────────────┐
                │    LangSmith     │
                │                  │
                │ traces           │
                │ LLM calls        │
                │ tool calls       │
                │ retrieval        │
                │ agent reasoning  │
                └────────┬─────────┘
                         │
                         │
                         ▼
                Observability Store
```

与此同时：

```text
                   Agent
                     │
                     ▼
              Policy Enforcement
                     │
                     ▼
                Domain Action
                     │
                     ▼
               Audit Event
                     │
                     ▼
          ┌─────────────────────┐
          │ Regulatory Audit    │
          │ Evidence Store      │
          └─────────────────────┘
```

**两个系统同时存在。**

---

# 4. 最好不要让 LangSmith 成为 Audit System of Record

我会把职责这样定：

| 系统            | 主要职责                                 |
| ------------- | ------------------------------------ |
| LangSmith     | Agent Observability                  |
| LangSmith     | Debugging                            |
| LangSmith     | Evaluation                           |
| LangSmith     | Trace reconstruction                 |
| Policy Engine | Authorization / Policy Decision      |
| Workflow      | Business State                       |
| Domain API    | Business execution                   |
| Audit Store   | Regulatory / business audit evidence |

这样就非常清楚。

尤其对于你们前面一直讨论的金融 Agent：

```text
LangSmith
    ≈ "发生了什么过程？"

Audit Evidence
    ≈ "发生了什么具有业务/监管意义的事件？"
```

---

# 5. 那么 LangSmith Trace 应该怎么和 Audit 串起来？

这里其实很好解决。

每一次 Agent Execution 生成一个：

```text
execution_id
```

例如：

```text
EXE-2026-000123
```

然后整个链路统一携带：

```text
execution_id
business_case_id
agent_run_id
trace_id
user_id
tenant_id
```

比如 LangSmith metadata：

```json
{
  "execution_id": "EXE-2026-000123",
  "business_case_id": "PV-98765",
  "agent_id": "proxy-vote-agent",
  "agent_version": "4.2.1",
  "semantic_release": "2026-09-20",
  "policy_context": "proxy-vote"
}
```

Tool call 再带：

```json
{
  "execution_id": "EXE-2026-000123",
  "action": "proxy_vote.submit",
  "resource_id": "FUND-123"
}
```

Policy Decision：

```json
{
  "execution_id": "EXE-2026-000123",
  "policy_id": "proxy_vote.submit",
  "policy_version": "3.1.0",
  "decision": "ALLOW",
  "reason_code": "WORKFLOW_APPROVED"
}
```

Audit event：

```json
{
  "event_id": "AUD-123456",
  "execution_id": "EXE-2026-000123",
  "event_type": "ACTION_AUTHORIZED",

  "principal": "user-123",
  "agent_id": "proxy-vote-agent",

  "action": "proxy_vote.submit",
  "resource": "FUND-123",

  "policy_id": "proxy_vote.submit",
  "policy_version": "3.1.0",

  "decision": "ALLOW",

  "timestamp": "2026-09-23T10:15:23Z"
}
```

于是 Audit 系统可以直接跳到：

```text
execution_id
    │
    ├── LangSmith Trace
    │
    ├── Policy Decision
    │
    ├── Workflow History
    │
    └── Domain Execution Result
```

这才是真正完整的 audit trail。

---

# 6. 甚至可以把 LangSmith 当成“详细过程证据”

这个模型我比较推荐：

```text
Audit Event
     │
     ├── who
     ├── what
     ├── when
     ├── why
     ├── policy
     ├── decision
     └── trace_id
              │
              ▼
         LangSmith Trace
              │
              ├── LLM
              ├── retrieval
              ├── tool
              ├── MCP
              ├── subagent
              └── output
```

于是 Audit Store 不需要复制所有 LLM prompt/token/tool payload。

只保存：

```text
business-significant evidence
```

以及：

```text
LangSmith trace_id
```

需要调查的时候再进入 LangSmith 看完整 execution trace。

这样成本和架构复杂度都会低很多。

---

# 7. 但是有一个很重要的问题：LangSmith 本身不是“不可修改的 Audit Ledger”

这是为什么我前面一直强调：

> LangSmith logging ≠ Regulatory Audit Evidence。

Trace 系统主要是为了 observability。

例如当前 Agent Server / LangGraph 系统会把 tracing 发给 LangSmith，LangSmith 作为运行观测平台保存这些 runs。官方也区分了 Cloud、Hybrid、Self-hosted 等 tracing 部署模式。([Docs by LangChain][4])

而真正的审计系统往往还有：

```text
retention
immutability
access separation
tamper evidence
legal hold
data residency
write-once / append-only
audit export
regulatory retention
```

这些不能因为：

```text
"LangSmith 有 trace"
```

就自动认为满足。

---

# 8. 你现在最适合的架构其实不是“二选一”

不是：

```text
LangSmith
    OR
自建 Audit
```

而是：

```text
                         Agent
                           │
                    ┌──────┴──────┐
                    │             │
                    ▼             ▼
              LangSmith      Audit Emitter
                    │             │
                    │             ▼
                    │       Audit Event Store
                    │             │
                    │             ▼
                    │       Regulatory Evidence
                    │
                    ▼
              Observability
```

而且：

**Audit Emitter 不应该放在 Agent Prompt 或 Agent Tool 里面。**

应该放在：

```text
Tool Gateway
Policy Enforcement Point
Workflow Engine
Domain API
```

这些确定性的边界。

---

# 9. 举一个完整流程

假设 Agent 要执行：

```text
submit_proxy_vote
```

实际运行：

```text
User
 │
 ▼
Agent
 │
 ├── LangSmith trace: root
 │
 ▼
Tool Gateway
 │
 ├── LangSmith trace: tool call
 │
 ▼
Policy Engine
 │
 ├── LangSmith trace: policy evaluation
 │
 └── Audit Event:
 │      POLICY_EVALUATED
 │
 ▼
ALLOW
 │
 ▼
Workflow
 │
 └── Audit:
 │      ACTION_AUTHORIZED
 │
 ▼
Domain API
 │
 ├── execute
 │
 └── Audit:
 │      ACTION_EXECUTED
 │
 ▼
External System
 │
 └── Audit:
        ACTION_CONFIRMED
```

LangSmith 得到的是：

```text
完整 execution tree
```

Audit Store 得到的是：

```text
关键业务事件
```

这两者通过：

```text
execution_id
trace_id
business_case_id
```

关联起来。

---

# 10. LangSmith 的 Export 在你们这里怎么用？

我建议不要只做“定期导出”。

可以有三层。

### 第一层：在线 Trace

正常：

```text
Agent → LangSmith
```

用于：

```text
debug
observability
evaluation
incident investigation
```

### 第二层：按需 API / CLI Export

例如事故调查：

```bash
langsmith trace export ./incident-20260923 \
  --project production-agent \
  --full
```

把相关 Trace 导出来保存到 investigation workspace。官方 CLI 已经支持这种 trace export。([GitHub][2])

### 第三层：Audit Event 实时落自己的 Store

例如：

```text
Policy decision
Approval
Business execution
External side effect
```

直接：

```text
Postgres / Kafka
      ↓
Audit Store
      ↓
S3 / Object Lock / SIEM / compliance archive
```

而不是等 LangSmith trace 产生以后再“推断”这些事件。

---

# 11. LangSmith 甚至可以承担一部分“事后控制”

这个能力可以充分利用。

例如：

```text
Production Trace
      ↓
LangSmith Online Evaluator
      ↓
发现：
  agent accessed restricted data
      ↓
Webhook
      ↓
Security Incident Service
```

LangSmith 官方支持针对 production traces 的 online evaluation，也支持根据 metadata/tool call 等条件过滤，并可以和 webhook automation 配合。([Docs by LangChain][1])

这非常适合作为：

```text
Detective Control
```

但不能拿它替代：

```text
Preventive Control
```

也就是：

```text
Policy Gateway
   = Prevent

LangSmith Evaluator
   = Detect / Evaluate
```

这个划分很漂亮。

---

# 12. 所以你们的 Control Plane 可以最终变成这样

我会调整我们前面的架构：

```text
                     Agent Control Plane
                            │
       ┌────────────────────┼───────────────────┐
       │                    │                   │
       ▼                    ▼                   ▼
   Agent Registry       Policy Registry    Semantic Registry
       │                    │                   │
       │                    ▼                   │
       │                  PDP                  │
       │                    │                   │
       └──────────────┬─────┴──────────────┬────┘
                      │                    │
                      ▼                    ▼
                Runtime / Gateway      Workflow
                      │                    │
                      └─────────┬──────────┘
                                │
                                ▼
                           Domain APIs
                                │
                                ▼
                          External Systems
```

同时旁路：

```text
             Runtime
               │
       ┌───────┴────────┐
       ▼                ▼
  LangSmith          Audit Emitter
       │                │
       ▼                ▼
  Trace Store       Audit Store
       │                │
       ▼                ▼
 Observability     Regulatory Evidence
```

---

# 13. 对你当前平台，我会直接采用这个原则

你前面提出的：

> LangSmith 可以记录 runtime，但 Regulatory Audit Evidence 必须单独定义。

我现在会进一步把它具体化成：

> **LangSmith 是 Trace Evidence Provider，不是 Audit System of Record。**

然后：

```text
LangSmith
负责：
  "Agent 是怎么执行的？"

Policy
负责：
  "为什么允许/拒绝？"

Workflow
负责：
  "业务流程当时处于什么状态？"

Domain System
负责：
  "业务动作实际上发生了什么？"

Audit Store
负责：
  "把这些关键事实以长期、可查询、可审计的方式串起来。"
```

这比让 LangSmith 承担全部 audit 职责合理得多。

尤其你们已经使用 LangSmith，所以**没必要另外造一个完整的 Agent Trace 平台**。真正值得自己建设的是一个很小的 `Audit Evidence Layer`，把 **Execution ID + Business Case + Policy Decision + Approval + Domain Action + LangSmith Trace ID** 串起来。

另外，LangSmith 当前的数据平面文档明确区分 Cloud / Hybrid / Self-Hosted 的 tracing 路径；如果你们有金融服务的数据驻留、留存、跨境或长期证据保存要求，这也应该纳入最终 deployment decision，而不能只看“有没有 trace”。([Docs by LangChain][4])

[1]: https://docs.langchain.com/langsmith/online-evaluations-llm-as-judge?utm_source=chatgpt.com "Set up LLM-as-a-judge online evaluators - Docs by LangChain"
[2]: https://github.com/langchain-ai/docs/blob/main/src/langsmith/langsmith-cli.mdx?utm_source=chatgpt.com "docs/src/langsmith/langsmith-cli.mdx at main · langchain-ai/docs · GitHub"
[3]: https://github.com/langchain-ai/langsmith-sdk/blob/main/python/langsmith/async_client.py?utm_source=chatgpt.com "langsmith-sdk/python/langsmith/async_client.py at main · langchain-ai/langsmith-sdk · GitHub"
[4]: https://docs.langchain.com/langsmith/data-plane?utm_source=chatgpt.com "LangSmith data plane - Docs by LangChain"

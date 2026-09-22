# 金融服务企业如何为 DeepAgents 建立业务语义层

## ——从 Snowflake Semantic Views 到可执行 Business Ontology

对于一家类似 Fidelity 的大型财富管理、资产管理或金融服务企业，真正把 Agent 从“会回答问题”推进到“能够可靠地参与业务”，最容易被低估的并不是模型能力，而是一个更基础的问题：

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

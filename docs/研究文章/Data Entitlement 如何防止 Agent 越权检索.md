# Data Entitlement 如何防止 Agent 越权检索

在企业 Agent 系统里，“用户已经登录，所以 Agent 可以搜索企业知识库”是一个非常危险的简化。

真正的问题不是：

> Agent 能不能调用 Search API？

而是：

> **这个 Agent 在当前用户、当前 Workflow、当前业务上下文下，到底有权让 Retrieval 看见哪些数据？**

这就是 Data Entitlement 要解决的问题。

可以把整个问题抽象成：

```text
Identity
   ↓
Data Entitlement
   ↓
Retrieval Scope
   ↓
Search / RAG
   ↓
Authorized Context
   ↓
Agent
```

而不是：

```text
Identity
   ↓
Search Everything
   ↓
LLM 自己判断哪些内容不能用
```

后者把真正的数据安全边界交给了模型。

AWS 的 Bedrock Knowledge Bases 已经提供了 document-level ACL-aware retrieval：检索请求携带用户上下文后，系统可以在检索阶段过滤只允许该用户访问的文档。但 AWS 同时明确指出，**ACL-aware filtering 本身不是 authorization**，它不负责验证用户身份，调用方必须提供经过验证的 identity context。([AWS](https://docs.aws.amazon.com/bedrock/latest/userguide/kb-test-retrieve-acl.html))

Microsoft Azure AI Search 同样把 document-level access control 放在 ingestion metadata 和 query-time enforcement 两个阶段，并明确将 permission filtering 作为 agentic AI / RAG 安全的基础能力。([Microsoft](https://learn.microsoft.com/en-us/azure/search/search-security-best-practices))

这说明一个越来越明确的行业方向：

> **Retrieval 不能只解决“相关性”，还必须解决“授权范围”。**

---

# 1. Retrieval 的问题不是“搜得准”，而是“搜什么有资格被搜到”

传统 Search Engine 的核心问题是：

```text
Query
 ↓
Relevance
 ↓
Ranking
 ↓
Results
```

RAG 最早也基本沿用这个思路：

```text
Question
 ↓
Embedding
 ↓
Vector Search
 ↓
Top-K Documents
 ↓
LLM
```

但企业环境里还有一个维度：

```text
Authorization
```

因此真正的检索问题应该是：

```text
                   Query
                     │
           ┌─────────┴─────────┐
           ↓                   ↓
       Relevance          Authorization
           │                   │
           └─────────┬─────────┘
                     ↓
                Final Results
```

更严格地说：

```text
Allowed Results
=
Relevant Results
∩
Authorized Results
```

而不是：

```text
Allowed Results
=
Top-K Relevant Results
```

最近针对企业 RAG 的研究也指出了这个基本问题：传统 retrieval 依据 semantic relevance、keyword matching 或 hybrid ranking 找文档，却未天然解决“调用者是否有权访问该文档”；在多租户场景下，如果授权没有进入 retrieval pipeline，就可能出现 cross-tenant leakage。([arXiv](https://arxiv.org/abs/2605.05287))

2026 年一篇企业 RAG 安全系统综述也指出，目前研究对安全架构的覆盖仍然明显不足，而 data privacy / access-control 是企业部署中的重要空白。([ACL Anthology](https://aclanthology.org/2026.nlpaics-1.25/))

---

# 2. Data Entitlement 到底是什么

Data Entitlement 不是简单的：

```text
User → Role
```

而是：

> **给定一个已经确定身份的主体，它在当前业务上下文中到底可以看到哪些数据对象。**

Goldman Sachs 对 Entitlements 的公开介绍很接近这个定义：在已经知道用户是谁的前提下，进一步判断用户在具体应用里能够做什么、看到哪些数据、调用哪些 API，以及谁可以查看特定的 proprietary data；其 Cloud Entitlements Service 采用 policy-based、attribute-driven 的方式统一管理这些决策。([Goldman Sachs](https://developer.gs.com/blog/posts/using-entitlements-for-privileged-access-to-apis-and-applications-in-a-cloud-environment))

因此：

```text
Identity:
Alice

Data Entitlement:
Portfolio = Fund-A
ClientScope = APAC
SecurityScope = Equities
DataClass = Internal
```

最终得到的并不是：

```text
Alice can use Search
```

而是：

```text
Alice can retrieve
  Fund-A
  APAC client data
  authorized equity research
```

这才是 Agent Retrieval 真正需要的输入。

---

# 3. “能登录知识库”与“能读取知识库中的哪些文档”是两件事

这是企业 RAG 架构里非常容易犯的错误。

错误设计：

```text
User
 ↓
Login
 ↓
RAG Service
 ↓
Knowledge Base
 ↓
Everything searchable
```

这里的 IAM 只能回答：

> 谁可以调用这个 RAG 服务？

却没有回答：

> 这个用户可以检索哪些内容？

Microsoft Azure AI Search 把这一点明确拆成两层：Search service/data-plane access 负责调用搜索服务本身；document-level access control 则通过权限 metadata 在查询时进一步裁剪结果。([Microsoft](https://learn.microsoft.com/en-us/azure/search/search-security-rbac))

所以：

```text
Permission A:
Can call Search API

Permission B:
Can retrieve Document X
```

不能混成一个 Permission。

---

# 4. Agent 越权检索通常发生在三个地方

一个 Agent Retrieval Pipeline：

```text
User
 ↓
Agent
 ↓
Retriever
 ↓
Index
 ↓
Document Store
```

实际上至少存在三个不同的权限边界。

## 第一层：谁在发起请求

```text
Identity
```

解决：

```text
User
Agent
Tenant
Delegation
```

---

## 第二层：哪些数据可以进入检索结果

```text
Data Entitlement
```

解决：

```text
Documents
Chunks
Rows
Fields
Records
```

---

## 第三层：取到以后还能不能继续使用

```text
Context / Output Policy
```

解决：

```text
Cross-session reuse
Memory persistence
External export
Prompt context
Tool input
Output
```

因此：

```text
Identity
   ≠
Data Entitlement
   ≠
Context / Output Control
```

只做其中一层是不够的。

OWASP 当前 Agent Security Cheat Sheet 也把 data exfiltration、tool abuse、privilege escalation、memory poisoning 与 prompt injection 并列为 Agent 系统的重要风险。([OWASP](https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html))

---

# 5. 最关键的架构原则：授权必须进入 Retrieval Path

很多系统是这样：

```text
Query
 ↓
Vector Search
 ↓
Top 20
 ↓
Filter unauthorized docs
 ↓
Top 5
```

这个方式比完全不做权限过滤好，但架构上仍然有问题。

因为最理想的安全边界应该尽可能靠近 retrieval。

更合理：

```text
Query
 +
Entitlement Filter
 ↓
Authorized Candidate Set
 ↓
Semantic Ranking
 ↓
Top-K
```

或者：

```text
Query
 ↓
Authorization-aware retrieval
 ↓
Only authorized candidates
 ↓
Ranking
```

Azure AI Search 当前的 document-level access control 就支持在查询阶段把 caller identity 与 document permission metadata 相匹配，返回结果只包含授权文档。([Microsoft](https://learn.microsoft.com/en-us/azure/search/search-query-access-control-rbac-enforcement))

AWS Bedrock Knowledge Bases 的 ACL-aware retrieval 也采用类似思路：权限 metadata 随文档进入索引，query-time 根据 user context 进行筛选。([AWS](https://docs.aws.amazon.com/bedrock/latest/userguide/kb-managed-acl.html))

所以：

> **Data Entitlement 不应该是 Retrieval 完成之后的一次“清理”，而应该成为 Retrieval 本身的一部分。**

---

# 6. 为什么不能“先搜出来，再让 LLM 忽略没有权限的内容”

这是一个非常常见的错误：

```text
Vector DB
 ↓
Top-K documents
 ↓
LLM
 ↓
"ignore anything user shouldn't see"
```

这种设计的问题不是“模型可能偶尔犯错”这么简单。

而是：

> **未经授权的数据已经进入了 Agent 的计算边界。**

一旦进入：

```text
Prompt Context
Tool Result
Memory
Cache
Trace
Summary
Sub-Agent Context
```

就可能产生后续传播。

OWASP 2025 Prompt Injection 文档明确指出，攻击者可以通过外部网页、文件等间接注入 prompt，进而诱导系统访问或泄露后端数据；因此安全边界不能建立在模型是否正确遵守 instructions 上。([OWASP](https://genai.owasp.org/llmrisk/llm01-prompt-injection/))

所以：

```text
Retrieve unauthorized data
   ↓
Tell LLM not to use it
```

不是可靠的 Data Entitlement。

真正的边界应该是：

```text
Entitlement
   ↓
Retrieval
   ↓
Authorized Data
```

---

# 7. Retrieval Authorization 的第一步：建立有效权限上下文

Agent 不应该直接传：

```json
{
  "user": "alice"
}
```

然后希望 Retrieval 自己推断所有权限。

更合理的是先生成：

```text
Effective Data Context
```

例如：

```json
{
  "subject": {
    "user": "alice",
    "agent": "investment-research-agent"
  },
  "tenant": "fil",
  "desk": "asia-equity",
  "businessUnit": "investment-management",
  "portfolioScope": [
    "fund-a",
    "fund-b"
  ],
  "dataClasses": [
    "internal",
    "licensed-research"
  ]
}
```

这里的 JSON 只是架构示意，不是某个厂商标准格式。

关键是：

> **Retrieval 层应该接收已经验证过的 authorization context，而不是相信 LLM 自己生成的 user / role / entitlement。**

AWS 的 Bedrock 文档非常明确：ACL-aware retrieval 使用调用方提供的 `userContext`，但 Bedrock Knowledge Base 本身不认证终端用户，应用必须负责认证并传递 verified identity context。([AWS](https://docs.aws.amazon.com/bedrock/latest/userguide/kb-test-retrieve-acl.html))

---

# 8. 这也是为什么“userId 参数”本身不是安全边界

很多系统容易这样写：

```http
POST /search

{
  "query": "portfolio policy",
  "userId": "alice"
}
```

然后：

```text
WHERE allowed_users contains "alice"
```

看起来有权限控制。

但如果：

```text
userId
```

只是用户可以修改的普通参数：

```http
"userId": "bob"
```

系统就被绕过了。

Azure AI Search 对 security filter 的文档专门提醒：简单的 identity string filter 只是过滤机制，不是 authentication / authorization；调用方必须首先拥有可信身份。([Microsoft](https://learn.microsoft.com/en-us/azure/search/search-security-trimming-for-azure-search))

所以必须是：

```text
Verified Token
   ↓
Identity Resolution
   ↓
Entitlement
   ↓
Retrieval Filter
```

而不是：

```text
User JSON
   ↓
Retrieval Filter
```

---

# 9. 第二步：权限必须随数据进入 Index

如果权限信息只存在于原始系统：

```text
SharePoint
Database
File System
Document Management System
```

而索引里只有：

```text
chunk
embedding
document_id
```

那么 Retrieval 很难高效地做文档级授权。

因此通常需要：

```text
Source Document
+
Permission Metadata
+
Business Metadata
```

一起进入 Search Index。

例如：

```json
{
  "chunk_id": "doc123#chunk7",
  "document_id": "doc123",
  "embedding": "...",
  "tenant": "fund-a",
  "classification": "confidential",
  "allowed_users": ["alice", "bob"],
  "allowed_groups": ["asia-equity"],
  "entitlement_tags": [
    "research.apac",
    "fund.a"
  ]
}
```

AWS Bedrock 的 custom data source 支持在 ingestion 时把 document ACL 写入 metadata，并在 retrieval 前按 ACL 过滤。([AWS](https://docs.aws.amazon.com/bedrock/latest/userguide/kb-managed-ds-custom-acl.html))

Azure AI Search 也要求在 indexing 时保存 document permission metadata，然后在 query time 进行安全过滤。([Microsoft](https://learn.microsoft.com/en-us/azure/search/search-security-best-practices))

---

# 10. ACL 应该挂在 Document 还是 Chunk？

这是 RAG 架构中特别容易被忽略的问题。

假设一个文档：

```text
Annual Report
```

被切成：

```text
chunk1
chunk2
chunk3
...
chunk50
```

如果：

```text
Document ACL
```

是：

```text
Alice = allowed
Bob = denied
```

那么通常需要：

```text
chunk1 → ACL(doc)
chunk2 → ACL(doc)
...
chunk50 → ACL(doc)
```

而不能：

```text
只有 parent document 有 ACL
chunk 本身完全不带授权信息
```

否则 vector retrieval 已经绕过了 document object，授权信息可能无法参与 query。

更稳妥的设计是：

```text
Document Entitlement
        ↓
Chunk Entitlement
```

并要求 ingestion pipeline 保证：

```text
ACL inheritance
```

不能由每次 query 临时猜测。

Azure AI Search 的 document-level access control 就是以 permission metadata 随 indexed content 保存为基本模式。([Microsoft](https://learn.microsoft.com/en-us/azure/search/search-document-level-access-overview))

---

# 11. 第三步：Data Entitlement 最好在检索前过滤，而不是检索后过滤

考虑：

```text
100,000 documents
```

其中：

```text
Alice 有权限 → 10,000
Alice 无权限 → 90,000
```

错误设计：

```text
Search entire index
↓
Top 100
↓
Filter unauthorized
```

可能导致：

```text
Authorized docs not in top 100
```

最后结果可能只剩很少甚至没有。

更重要的是，未经授权的文档已经参与了：

```text
Similarity
Ranking
Scoring
Candidate Selection
```

在极端情况下，甚至元数据都可能形成侧信道。

正确思路：

```text
Search domain
=
Authorized subset

然后在 Authorized subset 中做 ranking
```

概念上：

```text
All Documents
    │
    ↓
Authorization Filter
    │
    ↓
Authorized Documents
    │
    ↓
Semantic Search
    │
    ↓
Ranking
    │
    ↓
Top-K
```

Azure AI Search 当前的 query-time permission enforcement 就是在 search request 上结合 caller claims 和 document permission metadata，再返回授权结果。([Microsoft](https://learn.microsoft.com/en-us/azure/search/search-query-access-control-rbac-enforcement))

---

# 12. 但“Pre-filter”并不是简单 SQL WHERE 条件这么简单

金融企业的 entitlement 往往包括：

```text
User
Group
Desk
Legal Entity
Client
Account
Region
Asset Class
Data Classification
Purpose
Time
Vendor License
```

因此：

```sql
WHERE user_id = ?
```

远远不够。

更合理的是：

```text
Effective Entitlement
=
f(
  identity,
  groups,
  attributes,
  business context,
  data classification,
  purpose,
  temporal rules
)
```

这正是 Goldman Sachs 采用 attribute-driven entitlement platform 的原因之一：把 entitlement logic 从业务代码中抽离出来，形成集中式 policy service，并提供 entitlement decision audit。([Goldman Sachs](https://developer.gs.com/blog/posts/using-entitlements-for-privileged-access-to-apis-and-applications-in-a-cloud-environment))

---

# 13. ABAC 往往比纯 RBAC 更适合 Agent Retrieval

RBAC 很容易表示：

```text
Trader
→ Trade Data
```

但复杂数据访问往往需要：

```text
User.role
+
Desk
+
Region
+
Client
+
Data.classification
+
Purpose
```

这更接近 ABAC。

Databricks Unity Catalog 当前的 row filters / column masks 就支持在查询时根据属性限制用户可以看到的 rows 和 columns，并推荐使用 catalog/schema 级的 ABAC policy 进行统一治理。([Databricks](https://docs.databricks.com/gcp/en/data-governance/unity-catalog/filters-and-masks))

对于 Agent：

```text
Agent Identity
+
User Context
+
Business Attributes
```

可以映射成：

```text
ABAC / Entitlement
```

然后最终变成：

```text
Authorized Retrieval Scope
```

---

# 14. Data Entitlement 不一定意味着“一个 ACL 列表”

这是另一个设计误区。

最简单：

```json
{
  "allowedUsers": ["alice", "bob"]
}
```

但企业可能更适合：

```text
document.classification = confidential
AND
user.businessUnit = research
AND
user.region = APAC
AND
user.clientScope contains document.client
```

或者：

```text
user.role = analyst
AND
document.assetClass = equity
AND
document.region = APAC
```

再或者：

```text
license.vendor = factset
AND
license.product = package-x
AND
user.entitlement contains package-x
```

因此：

> **Data Entitlement 是 policy decision，不一定是 ACL array。**

ACL 是实现形式之一。

---

# 15. 金融领域特别需要考虑“Purpose”

这是普通企业 RAG 经常忽略的一层。

假设：

```text
Alice
```

可以访问：

```text
Client A
```

并不意味着任何 Agent 都可以为了任何用途检索 Client A。

可能存在：

```text
Research
Risk
Client Service
Trading
Compliance
```

不同业务目的。

因此一个更丰富的 entitlement 可以是：

```text
Principal
+
Resource
+
Purpose
+
Context
```

例如：

```text
Agent = ResearchAgent
Purpose = InvestmentResearch
Client = Fund-A
```

只能访问：

```text
approved research
portfolio holdings
public filings
```

而另一个：

```text
Agent = ClientServiceAgent
Purpose = ClientService
```

可能允许：

```text
client contact information
service records
```

但不允许：

```text
investment strategy documents
```

2026 年 BIS 关于金融机构 AI data use 的研究指出，AI 应用扩大了数据使用范围，也放大了 data privacy、quality、security 和 third-party dependency 风险，因此 data governance 是负责任采用 AI 的核心问题之一。([BIS](https://www.bis.org/publications/fsi-insight-73-data-we-trust-emerging-policy-and-supervisory-approaches-ai-data-use-financial-services))

---

# 16. Vendor Data Entitlement 不能忽略

金融企业的数据权限不一定全部来自内部 IAM。

例如：

```text
Bloomberg
FactSet
LSEG
MSCI
S&P
```

某些数据还存在：

```text
contractual entitlement
display right
non-display use
redistribution restriction
```

所以 Agent Retrieval 的最终权限可能是：

```text
Internal Entitlement
∩
Vendor Entitlement
∩
Business Purpose
```

即：

```text
User can access data
```

并不自动意味着：

```text
Agent can retrieve data
```

更不意味着：

```text
Agent can send data to another AI provider
```

这也是金融 Agent 与普通企业 FAQ Bot 在数据治理上的一个关键差异。

---

# 17. 最容易被忽略的问题：权限的新鲜度

Entitlement 是动态的。

今天：

```text
Alice
→ Fund A
```

明天可能：

```text
Alice
→ Fund B
```

再过一周：

```text
Alice
→ no access to Fund A
```

但 Search Index 里的 permission metadata 可能仍然是：

```text
Alice → Fund A
```

于是：

```text
Stale ACL
→ Unauthorized Retrieval
```

AWS 的不同知识库数据源已经体现出这个问题的差异：

* Confluence / SharePoint 等连接器可以在 query time 做 real-time permission verification；
* S3 和 custom data source 的某些 ACL 模式则以 ingestion-time metadata 为准，不支持实时验证。

AWS 明确说明，custom data source 的 ACL metadata 是 source of truth，而不是实时重新检查上游权限。([AWS](https://docs.aws.amazon.com/bedrock/latest/userguide/kb-managed-ds-custom-acl.html))

Azure AI Search 也明确警告，某些 SharePoint permission ingestion 模式的权限变更在重新索引之前可能仍然是 stale。([Microsoft](https://learn.microsoft.com/en-us/azure/search/search-security-best-practices))

因此：

> **Data Entitlement 不只是“有没有 ACL”，还要问 ACL freshness 是多少。**

---

# 18. Entitlement Freshness 应该成为架构指标

建议企业 Agent 平台明确一个：

```text
Entitlement Freshness SLA
```

例如：

```text
Public data
≤ 24h

Internal data
≤ 1h

Confidential
≤ 5m

Highly restricted
real-time
```

这不是通用行业标准数值，而应该由企业根据风险确定。

关键是：

```text
Source Permission Changed
      ↓
How long until Retrieval stops returning data?
```

这应该有明确答案。

而不是：

> “索引每天晚上更新。”

---

# 19. 更严格的场景还需要 Query-Time Revalidation

如果：

```text
Index ACL
```

只是缓存：

```text
Source ACL
```

那么最高风险的场景可以：

```text
Pre-filter
+
Real-time authorization
```

即：

```text
Query
 ↓
Index ACL filter
 ↓
Candidate docs
 ↓
Current source authorization
 ↓
Final results
```

AWS 的 SharePoint、Confluence、OneDrive connector 就采用了不同程度的“pre-retrieval + real-time verification”模式。([AWS SharePoint](https://docs.aws.amazon.com/bedrock/latest/userguide/kb-managed-ds-sharepoint-acl.html))

Azure 的 query-time access control 也以 synchronized permission metadata 为基础，并指出权限变化和索引同步存在时效问题。([Microsoft](https://learn.microsoft.com/en-us/azure/search/search-query-access-control-rbac-enforcement))

---

# 20. Retrieval Security 其实是一个 TOCTOU 问题

可以类比传统安全中的：

```text
Time Of Check
vs
Time Of Use
```

例如：

```text
10:00
Alice 有权限

10:01
Search → returns Document X

10:02
Alice 权限被撤销

10:03
Agent 再次使用 Document X
```

这里就产生：

```text
authorization at retrieval time
≠
authorization at use time
```

因此企业需要明确：

> **Data entitlement 是针对 retrieve 时刻，还是针对 data use 的整个生命周期？**

对于普通搜索，可能：

```text
retrieve-time authorization
```

已经足够。

但对于：

```text
Long-running Workflow
Memory
Cached context
Scheduled Agent
Multi-step research
```

可能需要更严格的 revalidation。

---

# 21. Agentic Retrieval 比普通 RAG 更难

普通 RAG：

```text
Query
 ↓
Retrieve
 ↓
Answer
```

Agentic Retrieval：

```text
Query
 ↓
Agent plans search
 ↓
Subquery A
 ↓
Retrieve
 ↓
Observe
 ↓
Subquery B
 ↓
Retrieve
 ↓
Maybe Tool
 ↓
Maybe another Retriever
 ↓
Synthesize
```

因此不能：

```text
Session starts
→ authorize once
→ trust all later retrievals
```

更安全的是：

```text
Each retrieval
   ↓
Identity / Entitlement Context
   ↓
Authorization-aware retrieval
```

AWS Bedrock 的 agentic retrieval API 仍然保留 `userContext` 用于 access control filtering，即便底层已经引入多步查询规划和 reranking。([AWS](https://docs.aws.amazon.com/bedrock/latest/userguide/kb-test-agentic-retrieve.html))

这很重要：

> **Agent 更自主，不意味着 Retrieval Authorization 可以更松。**

恰恰相反。

---

# 22. Sub-Agent 也不能继承一个“大权限 Retrieval Context”

例如：

```text
Main Agent
   ↓
Research Sub-Agent
   ↓
Search
```

错误做法：

```text
Main Agent has access to Fund A+B
→ Sub-Agent automatically gets Fund A+B+C+D
```

更合理：

```text
Parent Context
      ↓
Delegation
      ↓
Child-specific entitlement
      ↓
Child Retrieval
```

即：

```text
Agent A
DataScope = Fund A+B

Agent B
DataScope = Fund A
```

Agent-to-Agent delegation 应该是 scoped delegation，不是权限复制。

AWS 当前 Agentic AI Lens 明确要求 Agent identity 与用户权限分离，并强调 least privilege 和 identity propagation；对多 Agent 环境，权限传播也不应扩大原始访问范围。([AWS](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentsec03.html))

---

# 23. Agent Skill 也不应该决定 Data Entitlement

例如：

```text
Skill:
financial-research
```

里面写：

```text
Search all available research.
```

这不能变成：

```text
Agent may access all research.
```

Skill 只能声明：

```text
需要什么类型的数据
```

不能授予：

```text
实际访问权限
```

因此：

```text
Skill Requirement
       ↓
Entitlement Resolution
       ↓
Authorized Retrieval
```

而不是：

```text
Skill
 ↓
Grant access
```

这与前面的原则完全一致：

> **Skill 是 Capability；Entitlement 是 Authorization。**

---

# 24. 最危险的架构：Service Account + Full Index

一个很多企业很容易采用的方案：

```text
User
 ↓
Agent
 ↓
RAG API
 ↓
Service Account
 ↓
Full Knowledge Base
```

因为这样开发起来最简单。

但此时：

```text
Service Account
```

可能拥有：

```text
All Documents
```

于是用户权限已经丢失。

Microsoft 当前 Agent 安全指南强调，Agent 应继承用户已有权限边界，而不是因为 Agent 运行在 backend service identity 下就自动获得更大的数据访问范围。([Microsoft](https://learn.microsoft.com/en-us/agents/center-of-excellence/secure-agents))

更合理：

```text
User
 ↓
Verified Identity
 ↓
Entitlement Resolution
 ↓
RAG Retrieval Scope
```

如果底层必须使用 Service Account：

```text
Service Account
```

也只能作为：

```text
infrastructure identity
```

而不能成为：

```text
business entitlement identity
```

真正的用户 / agent context 仍需向下传播。

---

# 25. Snowflake、Databricks 证明了数据层 Enforcement 是可行的

如果 Agent 最终访问的是结构化金融数据，Data Entitlement 不一定要完全依赖 RAG 服务。

例如 Snowflake 当前支持：

```text
RBAC
Row Access Policy
Masking Policy
Session Attributes
```

Cortex Agents 查询底层数据时，可以通过 row access policies 根据 session attributes 限制结果。Snowflake 当前的 multi-tenancy 文档还特别建议将用于 row access policy 的 session attributes 设为 immutable，避免 Agent 生成的 SQL 或工具执行修改这些属性。([Snowflake](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-multi-tenancy))

Snowflake 的 data protection policies 也支持 row access、column masking、projection 和 join policies，用于控制 agentic interactions 对数据的访问范围。([Snowflake](https://docs.snowflake.com/en/user-guide/data-protection-policies-snowsight))

Databricks Unity Catalog 同样提供 row filter / column mask / ABAC，可以在查询时限制 Agent 实际能看到的数据。([Databricks](https://docs.databricks.com/gcp/en/data-governance/unity-catalog/filters-and-masks))

因此对于金融 Agent：

> **Data Entitlement 最好尽量在数据源或数据服务本身就有 Enforcement，而不是全部集中到 Agent Runtime。**

---

# 26. Retrieval 与 Data API 应该形成“双重防线”

对于高价值数据，一个成熟架构可以是：

```text
                 Agent
                   │
                   ↓
            Retrieval Service
                   │
          Entitlement Filter
                   │
                   ↓
              Search Index
                   │
                   ↓
             Data Source
                   │
          Row / Column Policy
                   │
                   ↓
               Final Data
```

即：

```text
Layer 1:
Retrieval entitlement

Layer 2:
Source data authorization
```

这样即使 Retrieval Filter 配置错误：

```text
Data Source
```

仍然可以成为第二道防线。

这与 Snowflake row access / column masks、Databricks row filters / column masks、Microsoft Purview 等数据层控制的设计方向是一致的。([Microsoft Purview](https://learn.microsoft.com/en-us/agents/center-of-excellence/secure-agents))

---

# 27. 但两层防线不能互相替代

有些团队会说：

> “底层数据库已经有 RLS，因此向量检索不需要 ACL。”

这通常也不够。

因为：

```text
Vector Index
```

可能已经独立复制了：

```text
documents
chunks
embeddings
metadata
```

如果 Agent 首先从 Vector DB 获得了：

```text
unauthorized document
```

然后再访问原数据库被 RLS 拒绝，数据已经泄露了一部分。

所以：

```text
Source authorization
```

不能代替：

```text
Retrieval authorization
```

反过来：

```text
Retrieval authorization
```

也不应该代替：

```text
Source authorization
```

更合理：

```text
Retrieval
+
Source
```

双重控制。

---

# 28. “Metadata Leakage” 也需要考虑

很多团队只关注：

```text
Unauthorized document content
```

却忽略：

```text
document title
document id
file name
classification
existence
score
snippet
```

例如一个没有权限的用户搜索：

```text
"Project Alpha acquisition"
```

如果 Search 返回：

```text
document_id = M&A-2026-001
title = Project Alpha Acquisition
score = 0.97
```

即使没有返回全文，系统可能已经泄露了：

> 某个敏感项目存在。

因此：

> **Data Entitlement 不应该只隐藏 document content，还应该明确哪些 metadata 可以被暴露。**

Azure AI Search 的 security-filter pattern 特别提醒 security field 本身可以设置为 non-retrievable，因为 metadata 也不应该被不必要地返回。([Microsoft](https://learn.microsoft.com/en-us/azure/search/search-security-trimming-for-azure-search))

金融场景中，这一点尤其适用于：

```text
M&A
IPO
Restricted List
MNPI
Client Identity
Investigation
Regulatory Case
```

---

# 29. Cache 是另一个容易绕过 Entitlement 的地方

假设：

```text
Alice
→ Query Q
→ gets Document X
→ Cache(Q) = X
```

随后：

```text
Bob
→ Query Q
→ Cache hit
→ gets X
```

如果 cache key 只有：

```text
query
```

那么 Data Entitlement 直接被绕过。

因此 Retrieval Cache 至少要考虑：

```text
tenant
identity
entitlement context
policy version
data version
query
```

甚至：

```text
authorization decision hash
```

即：

```text
Cache Key
=
Query
+
Identity Scope
+
Entitlement Version
```

这也是为什么 Data Entitlement 不应该只被理解成“Search query 加一个 filter”。

它必须贯穿：

```text
Index
Query
Ranking
Cache
Context
Memory
Replay
```

---

# 30. Memory 甚至可能成为 Retrieval 后的“隐形数据库”

例如：

```text
Day 1
Alice has access to Fund A
Agent retrieves Fund A research
Agent stores memory
```

然后：

```text
Day 10
Alice no longer has access to Fund A
```

但：

```text
Agent Memory
→ still contains Fund A research
```

如果 Memory Retrieval 没有再检查 Data Entitlement：

```text
Current Entitlement = DENY

Memory Retrieval = ALLOW
```

整个 Data Entitlement 体系就被绕过去了。

Microsoft 当前 Agent security guidance 明确把 long-lived context、conversation summaries、memory 和 cached grounding data 视为潜在敏感数据存储，需要像传统数据一样纳入访问控制和 DLP。([Microsoft](https://learn.microsoft.com/en-us/security/zero-trust/catalog-ai-attack-techniques/sensitive-information-disclosure))

因此：

> **Data Entitlement 必须适用于 Memory Retrieval，而不仅仅是原始 Document Retrieval。**

---

# 31. 多租户 Agent 特别需要注意 session binding

对于：

```text
Tenant A
```

和：

```text
Tenant B
```

最危险的不是数据库共享，而是：

```text
Agent Session
Memory
Cache
Vector Search
```

发生跨租户串线。

Snowflake 的 Cortex Agents multi-tenancy 模式就使用 immutable session attributes，并将其作为 row access policy 的输入；官方明确建议只传当前 invocation 真正需要的最窄范围变量，并测试 row-access policy 独立行为。([Snowflake](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-multi-tenancy))

因此建议：

```text
Tenant
User
Workflow
Session
Agent
```

都可以成为 Authorization Context 的一部分。

---

# 32. Data Entitlement 需要 fail-closed

如果：

```text
Entitlement Service
```

不可用，会发生什么？

错误方案：

```text
Entitlement unavailable
→ skip filtering
→ return search results
```

这实际上是：

```text
fail-open
```

对于金融敏感数据通常不应该接受。

更合理：

```text
Entitlement unavailable
→ no retrieval
```

即：

```text
fail-closed
```

AWS Bedrock ACL awareness 的文档也展示了一种安全默认值：如果 ACL-enabled data source 的 retrieval 请求没有提供 required user context，则该数据源不会返回结果。([AWS](https://docs.aws.amazon.com/bedrock/latest/userguide/kb-test-retrieve-acl.html))

当然，具体业务是否允许 fallback，需要按风险分级设计：

```text
Public data
→ fallback possible

Internal
→ degraded

Highly Restricted
→ fail closed
```

这属于架构推论，不是统一监管规则。

---

# 33. Data Entitlement 也需要 Versioning

如果一次 Agent Workflow 发生：

```text
2026-09-20 10:00
Entitlement Policy v12

2026-09-20 10:03
Entitlement Policy v13
```

那么审计时必须知道：

```text
某次 Retrieval
```

当时依据的是：

```text
Policy v12
```

还是：

```text
Policy v13
```

否则：

```text
"为什么 Agent 当时能看到这个文件？"
```

很难复现。

建议 Retrieval audit 至少记录：

```text
principal
agent
tenant
entitlement policy version
policy decision id
data resource id
retrieval timestamp
source version
```

不一定记录整个文档内容。

Goldman Sachs 对其 Cloud Entitlements Service 特别强调 entitlement decision audit 和 policy distribution observability，这说明在大型金融机构里，entitlement decision 本身就是需要独立治理的对象。([Goldman Sachs](https://developer.gs.com/blog/posts/using-entitlements-for-privileged-access-to-apis-and-applications-in-a-cloud-environment))

---

# 34. 最好的 Retrieval Audit 不是“Agent 搜过什么”

而应该回答：

```text
Who requested?
Which agent?
Under which workflow?
What entitlement context?
Which policy version?
Which documents were eligible?
Which were filtered out?
Which documents were actually returned?
```

特别是：

```text
Query = "client profitability"
```

不一定要把：

```text
100,000 denied document IDs
```

全部记录。

更实用的是：

```json
{
  "principal": "alice",
  "agent": "research-agent",
  "tenant": "fund-platform",
  "policyVersion": "ent-v17",
  "queryHash": "…",
  "retrievalScope": "fund-a",
  "returnedDocumentIds": ["d1", "d8"],
  "decisionId": "authz-98321"
}
```

这样可以把：

```text
Data Access Evidence
```

与：

```text
Agent Trace
```

分开。

---

# 35. Data Entitlement 与 DLP / Output Filtering 不是一回事

这一点必须明确。

假设：

```text
Alice
```

确实有权限读取：

```text
Document X
```

那么：

```text
Data Entitlement = ALLOW
```

但她未必有权限：

```text
把 Document X 发送给外部邮箱
```

所以需要：

```text
Retrieval Authorization
```

再加：

```text
Output / Exfiltration Control
```

即：

```text
Can Read?
   ↓
Can Use?
   ↓
Can Export?
```

这三个问题不是完全相同。

OWASP 当前 Agent Security guidance 把 data exfiltration 单独列为 Agent 风险，说明“能够读取”和“能够安全传出”应该分别考虑。([OWASP](https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html))

---

# 36. 金融 Agent 的 Data Entitlement 推荐模型

一个比较完整的模型是：

```text
                   ┌───────────────┐
                   │   Identity    │
                   └───────┬───────┘
                           ↓
                  ┌─────────────────┐
                  │ Entitlement     │
                  │ Resolution      │
                  └────────┬────────┘
                           ↓
             ┌───────────────────────────┐
             │ Effective Data Scope      │
             │                           │
             │ Tenant                    │
             │ Business Unit             │
             │ Desk                      │
             │ Client                    │
             │ Account                   │
             │ Security                  │
             │ Classification            │
             │ Purpose                   │
             │ License                   │
             └─────────────┬─────────────┘
                           ↓
                  ┌─────────────────┐
                  │ Retrieval Gate  │
                  └────────┬────────┘
                           ↓
                     Search / RAG
                           ↓
                 ┌─────────────────┐
                 │ Context Gate    │
                 └────────┬────────┘
                           ↓
                        Agent
                           ↓
                  Output / Tool Call
```

这里：

```text
Entitlement Resolution
```

负责：

> 得出“哪些数据可以看”。

```text
Retrieval Gate
```

负责：

> 确保只能从这个范围中检索。

```text
Context Gate
```

负责：

> 确保只有授权数据真正进入 Agent Context。

---

# 37. 这套模型与前面的三层权限模型正好对应

前面讨论的：

```text
Identity
Data Entitlement
Action Authorization
```

可以进一步展开成：

```text
Identity
   ↓
Data Entitlement
   ↓
Retrieval Authorization
   ↓
Agent Context
   ↓
Proposal
   ↓
Workflow Gate / Review
   ↓
Action Authorization
   ↓
Command
```

这样：

```text
Identity
```

回答：

> 谁？

```text
Data Entitlement
```

回答：

> 看什么？

```text
Workflow
```

回答：

> 在业务流程中下一步允许发生什么？

```text
Action Authorization
```

回答：

> 这个具体动作现在能不能执行？

这四层最好不要合并。

---

# 38. 最终建议：把 Data Entitlement 做成独立 Control Plane Capability

如果是企业内部 Agent Platform，我不建议把：

```text
Data Entitlement
```

写进：

```text
Agent Prompt
```

也不建议让：

```text
Skill
```

自己决定。

更适合：

```text
                 Agent Platform
                       │
       ┌───────────────┼────────────────┐
       ↓               ↓                ↓
   Identity        Entitlement       Policy
       │               │                │
       ↓               ↓                ↓
      Agent         Retrieval        Actions
                       │
                       ↓
                  Data Platform
```

Agent Runtime 只拿到：

```text
effective entitlement context
```

而不是：

```text
raw IAM credentials
```

然后所有 Retrieval 都走：

```text
Entitlement-aware Retrieval API
```

这能让：

```text
LangChain
DeepAgents
Copilot SDK
OpenAI Agents
Custom Agent
```

都共享同一套 Data Access Control，而不是每个 Agent Framework 自己实现一套。

---

# 39. 一个实际可落地的接口

可以设计一个：

```http
POST /entitlements/evaluate
```

输入：

```json
{
  "subject": {
    "user": "alice",
    "agent": "investment-research-agent"
  },
  "resourceType": "knowledge",
  "purpose": "investment-research",
  "tenant": "fund-platform"
}
```

返回：

```json
{
  "decision": "ALLOW",
  "scope": {
    "fundIds": ["F001", "F002"],
    "regions": ["APAC"],
    "classifications": ["internal", "approved-research"],
    "vendors": ["vendor-a"]
  },
  "policyVersion": "ent-v17",
  "decisionId": "dec-1234",
  "expiresAt": "2026-09-20T07:00:00Z"
}
```

然后：

```http
POST /retrieval/search
Authorization: Bearer ...
X-Entitlement-Decision: dec-1234
```

Retriever 不需要重新理解业务规则，只需要执行：

```text
Authorized Scope
```

这个架构可以把：

```text
Entitlement Resolution
```

和：

```text
Retrieval Execution
```

解耦。

---

# 40. 更进一步：不要让 Agent 直接控制 Retrieval Filter

错误：

```text
Agent:
{
  "filter": "fund_id IN ('F001','F002')"
}
```

因为 Agent 自己决定：

```text
F001, F002
```

就是自己决定权限。

应该：

```text
Agent:
query = "Asia equity exposure"

Entitlement Service:
scope = F001, F002

Retriever:
query + server-side scope
```

即：

```text
Agent controls:
WHAT TO SEARCH

Entitlement controls:
WHERE IT MAY SEARCH
```

这是一条非常值得写进平台设计的原则。

---

# 41. Retrieval Filter 也应该由服务端注入

最安全的架构是：

```text
Agent
   ↓
Query
   ↓
Retrieval Gateway
   ↓
Trusted Identity
   ↓
Entitlement
   ↓
Server-side Filter
   ↓
Vector / Search Engine
```

而不是：

```text
Agent
   ↓
Query + filter
   ↓
Vector DB
```

后者允许 Agent 自己修改：

```text
filter
```

从而产生：

```text
Privilege Escalation
```

Azure AI Search 的 query-time security filtering 以及 Snowflake 的 immutable session attributes 都体现了同一个工程思想：**权限输入不应该由 Agent 自己任意修改。** ([Microsoft](https://learn.microsoft.com/en-us/azure/search/search-query-access-control-rbac-enforcement)) ([Snowflake](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-multi-tenancy))

---

# 42. Data Entitlement Review Checklist

一个金融 Agent Retrieval 在上线前至少应该回答：

```text
Identity
□ 谁是最终 caller？
□ Agent Identity 是否独立？
□ 是否保留 on-behalf-of 信息？

Entitlement
□ 数据权限来自哪里？
□ 是否支持 user / group / role / attribute？
□ 是否支持 business context？
□ 是否支持 purpose / license？

Index
□ ACL / entitlement 是否随文档进入 Index？
□ Chunk 是否继承 parent entitlement？
□ metadata 是否可能泄露敏感信息？

Retrieval
□ 权限是否在 retrieval time enforce？
□ 是否 server-side？
□ Agent 是否能修改 entitlement filter？
□ 是否 fail-closed？

Freshness
□ 权限变更多久生效？
□ 是否支持 query-time revalidation？
□ 是否处理 TOCTOU？

Context
□ Unauthorized data 是否绝不会进入 context？
□ Memory 是否重新检查 entitlement？
□ Cache 是否按 entitlement 隔离？

Multi-Agent
□ Sub-Agent 是否继承最小权限？
□ Delegation 是否会扩大 scope？
□ A2A 是否重新授权？

Audit
□ 记录了谁、哪个 Agent、哪个 policy、哪些 resource？
□ 是否可以解释为什么某份数据被返回？
□ 是否记录 entitlement / policy version？

Defense in Depth
□ Retrieval 层有控制吗？
□ Source Data 层还有第二道控制吗？
□ Output / Exfiltration 是否还有控制？
```

---

# 43. 最终架构原则

### Principle 1

**Data Entitlement 决定 Agent 可以检索什么，而不是 Agent Prompt 决定什么。**

### Principle 2

**Authorization Context 必须来自可信身份和策略系统，不能由 LLM 自己生成。**

### Principle 3

**Data Entitlement 应尽可能在 Retrieval 前或 Retrieval 内生效。**

### Principle 4

**未经授权的数据不应该先进入 Agent Context，再依靠 LLM 过滤。**

### Principle 5

**Document ACL 必须能够可靠地传播到实际被检索的 chunk / row / field。**

### Principle 6

**Retrieval Authorization 与 Source Data Authorization 最好形成纵深防御，而不是相互替代。**

### Principle 7

**权限 freshness 必须有明确的 SLA；高敏感数据不能默认接受长时间 stale ACL。**

### Principle 8

**每次新的 Agentic Retrieval / Sub-Agent Retrieval 都应重新带入有效的 Data Entitlement Context，而不是无限继承一次性的搜索结果。**

### Principle 9

**Cache、Memory、Summary 和 Context 都属于潜在的数据存储 / 传播边界，也必须受到 Entitlement 约束。**

### Principle 10

**Data Entitlement 不是简单 ACL，而是可以由 Identity、Business Attributes、Purpose、Classification、License 和时间共同决定的 Policy Decision。**

---

# 44. 最终模型

可以把整个 Data Entitlement 架构浓缩成：

```text
                         User
                           │
                           ↓
                      Authentication
                           │
                           ↓
                    Agent Identity
                           │
                           ↓
                 ┌──────────────────┐
                 │ Entitlement      │
                 │ Resolution       │
                 └────────┬─────────┘
                          ↓
                Effective Data Scope
                          │
                          ↓
                 ┌──────────────────┐
                 │ Retrieval Gate   │
                 │                  │
                 │ server-side      │
                 │ fail-closed      │
                 └────────┬─────────┘
                          ↓
                 Search / Vector DB
                          ↓
                 Authorized Results
                          ↓
                 Context / Memory Gate
                          ↓
                       Agent
                          │
             ┌────────────┴────────────┐
             ↓                         ↓
        Answer / Evidence          Tool Request
                                       │
                                       ↓
                               Action Authorization
```

最重要的原则可以浓缩成一句话：

> **Agent 决定“搜什么”，Data Entitlement 决定“它有资格在哪里搜”。**

再进一步：

> **Retrieval 的安全边界不是 LLM，而是“可信身份 + Entitlement Policy + Server-side Enforcement”。**

对于金融服务，这个区别尤其重要。Goldman Sachs 的企业 Entitlements 实践、AWS 的 ACL-aware retrieval、Microsoft 的 document-level access control、Snowflake 的 row access policies、Databricks 的 ABAC / row filters，以及当前 RAG 安全研究，都指向同一个方向：**把数据授权从模型行为中拿出来，让它成为 Retrieval 和 Data Platform 可以真正执行的控制。** ([Goldman Sachs](https://developer.gs.com/blog/posts/using-entitlements-for-privileged-access-to-apis-and-applications-in-a-cloud-environment)) ([AWS](https://docs.aws.amazon.com/bedrock/latest/userguide/kb-managed-acl.html)) ([Microsoft](https://learn.microsoft.com/en-us/azure/search/search-document-level-access-overview)) ([Snowflake](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-multi-tenancy)) ([Databricks](https://docs.databricks.com/gcp/en/data-governance/unity-catalog/filters-and-masks))

这也是金融 Agent 与普通 RAG 应用真正开始出现架构差异的地方：

```text
普通 RAG
    = Search + LLM

金融 Agent Retrieval
    = Identity
    + Entitlement
    + Policy
    + Retrieval
    + Context Control
    + Audit
```

当 Agent 可以自主规划查询、调用多个工具、使用长期 Memory、跨 Workflow 工作时，**Data Entitlement 不再是一个“搜索功能的小过滤器”，而应该成为 Agent Control Plane 的核心能力。**

## 参考资料

**[1] AWS — ACL-aware retrieval on managed knowledge bases**
AWS 官方明确说明 ACL-aware retrieval 可在检索阶段根据 user context 返回用户获准访问的文档，同时强调该能力本身不负责终端用户认证。
[AWS — ACL-aware retrieval](https://docs.aws.amazon.com/bedrock/latest/userguide/kb-test-retrieve-acl.html)

**[2] AWS — Document-level access controls for managed knowledge bases**
说明 custom data source 的 ACL metadata、pre-retrieval filtering，以及“ACL-aware filtering 不是 authorization”的边界。
[AWS — Document-level access controls](https://docs.aws.amazon.com/bedrock/latest/userguide/kb-managed-ds-custom-acl.html)

**[3] AWS — Access Control Lists awareness enablement**
介绍 document ACL ingestion、query-time user context、allow/deny user/group 以及权限过滤机制。
[AWS — ACL awareness](https://docs.aws.amazon.com/bedrock/latest/userguide/kb-managed-acl.html)

**[4] AWS — SharePoint / Confluence document-level access controls**
展示同步 ACL + query-time real-time verification 的模式，以及权限变化与索引之间的 freshness 问题。
[AWS — SharePoint ACL](https://docs.aws.amazon.com/bedrock/latest/userguide/kb-managed-ds-sharepoint-acl.html)
[AWS — Confluence ACL](https://docs.aws.amazon.com/bedrock/latest/userguide/kb-managed-ds-confluence-acl.html)

**[5] AWS — Agentic retrieval**
说明 Agentic Retrieval 同样支持 `userContext` 进行 access-control filtering。
[AWS — Agentic retrieval](https://docs.aws.amazon.com/bedrock/latest/userguide/kb-test-agentic-retrieve.html)

**[6] AWS — Secure agent tool usage, Agentic AI Lens**
强调 Agent tool call 的 identity、user context、authorization 和 policy enforcement。
[AWS — Secure agent tool usage](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentsec02.html)

**[7] AWS — Implement tool authorization**
强调 tool authorization 应外部、确定性执行，Agent 不应拥有超出必要范围的工具访问。
[AWS — Tool authorization](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentsec02-bp01.html)

**[8] AWS — Agent identity and permission management**
区分 Agent 代表用户运行与 autonomous agent 两种模式，并强调 agent / human permissions separation 与 least privilege。
[AWS — Agent identity and permission management](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentsec03.html)

**[9] Microsoft — Azure AI Search: document-level access control**
Microsoft 当前把 document-level authorization 作为 secure enterprise search、RAG 和 agentic AI 的基础能力，并支持 ACL、RBAC、Purview 和 security-filter 等模式。
[Microsoft — Document-level access control](https://learn.microsoft.com/en-us/azure/search/search-document-level-access-overview)

**[10] Microsoft — Query-time ACL and RBAC enforcement**
说明 query-time permission enforcement 如何使用 caller claims 与 index 中 permission metadata 过滤 search results。
[Microsoft — Query-time access control](https://learn.microsoft.com/en-us/azure/search/search-query-access-control-rbac-enforcement)

**[11] Microsoft — Security filters for trimming Azure AI Search results**
展示自定义 security filter 模式，同时明确指出 principal string 本身不是 authentication / authorization。
[Microsoft — Security filtering](https://learn.microsoft.com/en-us/azure/search/search-security-trimming-for-azure-search)

**[12] Microsoft — RAG and Generative AI / security**
以 finance data 为例，说明 Agentic Retrieval 可以继承 SharePoint / Entra permission metadata 或通过 query-time filtering 做 document-level security trimming。
[Microsoft — RAG and Generative AI](https://learn.microsoft.com/en-us/azure/search/retrieval-augmented-generation-overview)

**[13] Microsoft — Secure agents: Identity, access, and data protection**
微软强调 Agent 应在用户原有权限边界内工作，Purview 等数据治理系统负责数据层保护。
[Microsoft — Secure agents](https://learn.microsoft.com/en-us/agents/center-of-excellence/secure-agents)

**[14] Microsoft — Entra Agent ID authorization**
介绍 Agent identity、delegated/application permissions、least privilege 和高权限 Agent 权限限制。
[Microsoft — Entra Agent ID authorization](https://learn.microsoft.com/en-us/entra/agent-id/authorization-agent-id)

**[15] Microsoft — Agent ID inheritable permissions**
说明 required resource access、inheritable permissions、admin consent 与真正 authorization grant 之间的区别。
[Microsoft — Inheritable permissions](https://learn.microsoft.com/en-us/entra/agent-id/concept-inheritable-permissions)

**[16] Microsoft — Secure SharePoint retrieval with user identity**
展示 Foundry Agent 使用 delegated user authentication，让 SharePoint 在 retrieval 时应用原有 user/site/folder/document permissions，并提供 permitted / denied user 的测试方法。
[Microsoft — SharePoint agent tool](https://learn.microsoft.com/en-us/azure/ai-foundry/agents/how-to/tools/sharepoint)

**[17] Snowflake — Multi-tenancy for Cortex Agents**
通过 immutable session attributes + row access policies 在 Agent query 时进行 tenant/data isolation。
[Snowflake — Multi-tenancy for Cortex Agents](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-multi-tenancy)

**[18] Snowflake — Data protection policies**
支持 row access、masking、projection、join policies，并用于 agentic data access。
[Snowflake — Data protection policies](https://docs.snowflake.com/en/user-guide/data-protection-policies-snowsight)

**[19] Databricks — Row filters and column masks**
Unity Catalog 在 query time 使用 row filters、column masks 和 ABAC 限制数据可见范围。
[Databricks — Row filters and column masks](https://docs.databricks.com/gcp/en/data-governance/unity-catalog/filters-and-masks)

**[20] Goldman Sachs — Cloud Entitlements Service**
金融机构实践中的 policy-based、attribute-driven entitlement；讨论数据访问、API access 与 entitlement decision audit。
[Goldman Sachs — Using Entitlements](https://developer.gs.com/blog/posts/using-entitlements-for-privileged-access-to-apis-and-applications-in-a-cloud-environment)

**[21] Goldman Sachs Transaction Banking — Authentication + Entitlements**
展示金融 API 体系中的 dual-layer authentication / authorization，以及 zero-entitlement-by-default、按业务需求逐步授予权限。
[Goldman Sachs — API authentication and entitlements](https://developer.gs.com/docs/services/transaction-banking/best-practices-api-connect/)

**[22] BIS — In data we trust? Emerging policy and supervisory approaches to AI data use in financial services, 2026**
讨论金融机构 AI 数据使用中的 data privacy、quality、security、third-party dependencies 和 supervisory expectations。
[BIS — FSI Insights 73](https://www.bis.org/publications/fsi-insight-73-data-we-trust-emerging-policy-and-supervisory-approaches-ai-data-use-financial-services)

**[23] BIS — Governance of AI adoption in central banks**
强调金融机构 AI 的 data security、confidentiality、risk management 与 governance。
[BIS — Governance of AI adoption in central banks](https://www.bis.org/publications/governance-ai-adoption-central-banks)

**[24] FSB — Sound Practices for Responsible Adoption of AI, 2026**
金融稳定委员会 2026 年提出 12 项 AI responsible adoption sound practices，覆盖组织治理和 AI lifecycle。
[FSB — Sound Practices for Responsible Adoption of AI](https://www.fsb.org/2026/06/sound-practices-for-responsible-adoption-of-artificial-intelligence-ai-consultation-report/)

**[25] OWASP — AI Agent Security Cheat Sheet**
把 prompt injection、tool abuse、privilege escalation、data exfiltration、memory poisoning 等作为 Agent 系统的独立安全风险。
[OWASP — AI Agent Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html)

**[26] OWASP — LLM01: Prompt Injection**
说明直接 / 间接 prompt injection 可以影响 LLM 对后端数据和工具的使用，要求通过外部访问控制减少成功攻击后的影响。
[OWASP — LLM01:2025 Prompt Injection](https://genai.owasp.org/llmrisk/llm01-prompt-injection/)

**[27] ACL Anthology — LLMs in the Enterprise: Security Architectures for RAG-Augmented Chatbots, 2026**
系统综述企业 RAG 安全研究，指出 data privacy 与 security architecture 仍是企业落地的重要研究缺口。
[ACL Anthology](https://aclanthology.org/2026.nlpaics-1.25/)

**[28] arXiv — Securing the Agent: Vendor-Neutral, Multitenant Enterprise Retrieval and Tool Use, 2026**
讨论多租户 Agent 中 relevance 与 authorization 的分离、retrieval-time gating、policy-aware ingestion 和 server-side enforcement。
[arXiv — Securing the Agent](https://arxiv.org/abs/2605.05287)

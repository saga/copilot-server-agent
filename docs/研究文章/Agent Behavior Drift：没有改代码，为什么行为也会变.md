# Agent Behavior Drift：没有改代码，为什么行为也会变

很多 Agent 系统上线以后，会遇到一种很容易误判的问题：

> “昨天还好好的，代码没改，为什么今天行为不一样了？”

模型换了吗？
Prompt 改了吗？
Skill 改了吗？
Tool 改了吗？
业务逻辑明明都没有提交新代码，为什么 Agent 突然更啰嗦了、工具选择变了、检索结果变了，甚至开始走不同的业务路径？

这类问题不能再用传统软件的“代码版本”来解释。

对于 Agent，代码只是影响行为的一个因素。真正决定一次运行会怎么做的，是一整套动态的 **Effective Behavior Surface**：模型版本、模型参数、System Prompt、Skill、Tool Schema、Policy、Retrieval 数据、Memory、Workflow State、外部服务以及运行时本身。

因此：

> **Agent 的行为版本，不等于代码版本。**

这也是为什么金融机构在建设 Agent 平台时，如果仍然只用 Git commit、Docker image 和软件 release 来描述系统版本，最终会发现一个很现实的问题：

> 你知道“部署了哪个版本的代码”，却未必知道“当时这个 Agent 为什么做出了这个决定”。

这篇文章讨论的核心问题，就是 **Agent Behavior Drift**：什么是行为漂移，为什么没有改代码也会发生，哪些因素最容易造成漂移，以及企业尤其是金融机构应该如何把它变成一个可观察、可评估、可审计、可回滚的架构问题。

---

## 一、先区分两个概念：随机变化不等于 Behavior Drift

首先需要把一个容易混淆的问题说清楚。

同一个 Prompt，连续调用两次，结果不同，不一定叫 Drift。

LLM 本身具有随机性。即使使用看似确定性的参数，生产环境中的推理系统也可能因为采样、数值计算、路由和基础设施等因素产生不同输出。近期关于 LLM 可复现性的研究也观察到，即使输入和参数保持不变，API 服务的模型输出仍可能发生变化。OpenAI 自己的 API 文档也明确指出，不同 model snapshot 之间的 prompting behavior 会变化，并建议生产应用使用 pinned model versions 和 evals。

所以：

**Variance：**

```text
同一个系统
同一个输入
         ↓
Run A → 输出 A
Run B → 输出 B
```

这是概率系统的正常现象。

而 **Behavior Drift** 更接近：

```text
Baseline
  ↓
长期表现：工具选择 A、检索策略 A、拒绝率 A、成功率 A

            ↓ 某些系统因素发生变化

Current
  ↓
长期表现：工具选择 B、检索策略 B、拒绝率 B、成功率 B
```

也就是说，Drift 关注的不是“某一次输出不同”，而是：

> **Agent 的行为分布、能力边界、决策路径或风险特征发生了持续或系统性的变化。**

NIST 对生产环境中的 AI drift 也采用了类似思路：当环境随时间发生变化后，AI 系统可能不再满足最初设计时的假设和限制，因此需要持续监控其功能和行为。

这一区分非常重要。

否则很容易出现两个完全相反的问题：

一方面，把正常随机性误认为故障；

另一方面，因为“LLM 本来就是不确定的”，而忽略真正的系统性行为变化。

---

# 二、Agent 为什么特别容易 Drift？

传统软件可以近似理解为：

```text
Behavior = Code + Configuration + Input
```

而 Agent 更接近：

```text
Behavior
    =
    Model
  + Model Configuration
  + System Prompt
  + Skill
  + Tool Set
  + Tool Schema
  + Policy
  + Retrieval
  + Memory
  + Workflow State
  + External Data
  + Runtime
  + Serving Environment
  + Input
```

甚至更严格地说：

```text
Agent Behavior
=
F(
    Model Snapshot,
    Prompt,
    Context,
    Tools,
    Policies,
    State,
    Data,
    Runtime,
    Environment
)
```

这意味着：

> **只要上述任意一个输入发生变化，Agent 的行为就可能发生变化，即使 Git repository 完全没有变化。**

这不是理论上的可能，而已经成为主流 Agent 平台设计中需要显式处理的问题。

AWS Bedrock AgentCore 甚至直接提供了 **versioned configuration bundles**：可以把 system prompt、model ID、tool descriptions 等配置独立版本化，在不重新部署代码的情况下改变 Agent behavior。AWS 同时提供 batch evaluation 和 A/B testing，用于比较 Prompt、Model、Tool 等配置变化前后的行为。

LangSmith 也把 Prompt versioning 设计成独立于代码的版本体系：Prompt 每次保存都会产生 commit，而 tag 可以移动到不同 commit，因此生产使用的 Prompt 可以改变，而调用代码本身不必改变。

这实际上已经说明了一个很关键的架构事实：

> **Prompt、Model、Tool Description 等东西虽然不是代码，但它们是行为配置。**

因此它们应该被当作 release artifact，而不能当成“随手改一下的配置”。

---

# 三、第一类 Drift：Model Drift

这是最容易被发现，也最容易被低估的一类。

## 3.1 你写的是模型名称，不一定代表永远是同一个模型

例如企业代码中可能写：

```text
model = "gpt-xxx"
```

或者：

```text
model = "claude-xxx"
```

真正运行时却可能经过：

```text
Application
   ↓
LiteLLM / Gateway
   ↓
Provider Routing
   ↓
Model Deployment
   ↓
Actual Model Version
```

只要其中任何一层发生变化，行为就可能变化。

Microsoft Azure OpenAI / Foundry 明确区分模型版本和自动升级策略；某些 deployment 可以自动升级到新的默认版本，并明确提醒模型版本升级后，应用和 workflow 的行为与兼容性可能发生变化。

Google Vertex AI 也提供可变的 model alias。默认 alias 可以从一个模型版本移动到另一个版本；如果生产系统不指定固定版本，而使用默认版本或 alias，那么实际运行的模型可能发生变化。

Anthropic 则明确维护模型 lifecycle，会 retire 旧模型并推荐迁移到新模型，同时建议开发者在迁移前对自己的任务进行测试。

OpenAI API 文档同样明确指出，不同 model snapshots 之间 prompting behavior 可能发生变化，并建议使用 pinned model versions 和 evals 来保证应用行为的一致性。

所以：

```text
Git commit
    = unchanged

Model
    = changed
```

完全可能。

---

## 3.2 Model Drift 不只是“回答质量变了”

对于普通 Chatbot：

```text
回答更长
回答风格变化
```

可能只是 UX 问题。

对于 Agent：

```text
原来：

SearchCustomer
→ GetPortfolio
→ PrepareReport

现在：

SearchCustomer
→ GetPortfolio
→ SendEmail
```

或者：

```text
原来：
需要 Human Review

现在：
模型认为可以直接执行
```

这已经不是“语言风格变化”。

它改变的是：

> **Decision Path。**

而对于 Agent，Decision Path 比文字输出本身更重要。

---

# 四、第二类 Drift：Prompt / Skill Drift

很多团队已经开始给 Prompt 做版本管理，但仍然容易忽略：

> Prompt 本身就是 Agent 的一部分代码，只不过它通常不放在 `.ts` 或 `.py` 里。

例如：

```text
System Prompt
Skill
Policy Instruction
Tool Description
Output Format
Few-shot Examples
```

任何一个变化，都可能改变模型行为。

例如原来：

```text
When the user asks about a trade:
1. retrieve relevant data
2. explain the rationale
3. never submit the order
```

后来有人为了提高体验改成：

```text
When the user asks about a trade:
1. retrieve relevant data
2. prepare the order if appropriate
3. proceed efficiently
```

代码完全没变。

但 Agent 的行为边界已经改变了。

因此：

```text
Prompt Diff
```

从治理角度看，本质上应该类似于：

```text
Code Diff
```

而不是：

```text
Documentation Diff
```

OpenAI 对 Model Spec 的持续更新也反映了这一点：模型的目标行为不是一个静态常量，而是会随着研究、反馈和部署经验持续演进。OpenAI 甚至明确把 Model Spec 定义成一种使“预期行为”变得可检查、可评估、可迭代的框架。

因此，一个 Agent 平台如果允许：

```text
Prompt Editor
    ↓
直接修改 Production Prompt
```

却没有：

```text
Version
Diff
Evaluation
Approval
Rollback
```

那么从行为治理角度看，它实际上已经允许“无代码部署”。

---

# 五、第三类 Drift：Tool Drift

这是 Agent 特有、也非常危险的一类。

传统应用中，API schema 一旦变化，一般会引发版本管理、兼容性测试。

但在 Agent 世界里，Tool 不只是 API。

LLM 会根据：

```text
Tool Name
Tool Description
Parameter Schema
Examples
Availability
Previous Results
```

决定“我要不要调用这个 Tool”。

因此 Tool 的下面这些变化都可能改变 Agent 行为：

```text
Tool Description 改了
Parameter schema 改了
返回字段改了
Tool 增加了
Tool 删除了
Tool 顺序改变
Tool permission 改了
Tool endpoint 改了
```

AWS AgentCore 的官方文档甚至把 **tool descriptions** 与 system prompts、model IDs 一起列为可独立版本化的 Agent configuration。AgentCore 还提供 tool selection accuracy、tool parameter accuracy 等评估维度。

这说明：

> **Tool metadata 本身就是行为输入。**

例如：

```text
Tool A

description:
"Retrieve customer portfolio."
```

与：

```text
Tool A

description:
"Retrieve customer portfolio and update
portfolio information when necessary."
```

虽然底层 API 甚至没有变化，但模型对 Tool 的理解已经不同。

---

# 六、第四类 Drift：Policy Drift

这是金融领域特别容易出现的问题。

很多系统把 Policy 做成：

```text
YAML
JSON
Database Configuration
Policy Engine
Environment Variable
Feature Flag
```

例如：

```yaml
trade_order:
  requireApproval: true
```

后来：

```yaml
trade_order:
  requireApproval: false
```

代码没有改。

但是系统行为当然改变了。

更复杂的是：

```text
Agent
  ↓
Tool Policy
  ↓
Business Policy
  ↓
Authorization
  ↓
Approval Policy
```

这些东西可能由不同团队维护。

因此，一次 Agent 执行真正的行为边界可能来自多个不同的配置源。

这也是为什么不能把：

```text
Git version
```

直接当成：

```text
Behavior version
```

---

# 七、第五类 Drift：Retrieval / Data Drift

这一类最容易被传统工程团队忽略，因为：

> “RAG 代码没变。”

确实。

但数据变了。

例如：

```text
Monday

Query
 ↓
Document A
Document B
Document C
```

到了 Friday：

```text
Query
 ↓
Document B
Document D
Document E
```

代码没有任何变化。

Prompt 没有任何变化。

Model 也没有变化。

Agent 依然可能给出完全不同的结论。

所以：

> **RAG 系统中的 Knowledge Base 是 Agent 的运行时依赖，而不是单纯的静态数据库。**

进一步的问题是：

```text
Document
Embedding
Chunk
Index
Ranking
Metadata Filter
Freshness
Access Control
```

每一层都可能影响最终 Context。

因此下面两个问题完全不同：

```text
为什么代码变了？
```

与：

```text
为什么这次拿到的 Context 和上次不一样？
```

Agent 需要回答的是第二个问题。

NIST 对部署后的 AI monitoring 特别强调动态输入和不断变化的生产环境会产生新的问题；其 GAI 风险框架也强调数据质量、持续监控以及系统整个生命周期中的风险管理。

---

# 八、第六类 Drift：Memory / State Drift

如果 Agent 有：

```text
Conversation Memory
User Memory
Long-term Memory
Workflow State
Previous Tool Results
Business Context
```

那么：

```text
Same Code
Same Model
Same Prompt
```

依然可能产生完全不同的行为。

例如：

```text
Run 1:

Memory:
customer prefers low risk
```

而几周以后：

```text
Memory:
customer prefers aggressive growth
```

Agent 当然会做出不同的判断。

这时问题甚至不是“模型 Drift”。

而是：

> **Agent 的输入状态发生了变化。**

因此，Memory 不能与 Business State 混为一谈。

尤其是金融系统中：

```text
客户风险等级
投资授权范围
交易状态
审批状态
持仓状态
订单状态
```

这些应该继续由企业业务系统作为 source of truth，而不是依赖 Agent Memory。

Agent Memory 可以帮助推理。

它不应该成为业务事实的最终来源。

---

# 九、第七类 Drift：Runtime / Dependency Drift

这是最像传统软件工程的问题。

例如：

```text
LangChain version
DeepAgents version
Agent SDK
MCP SDK
Python / Node
Inference gateway
HTTP client
Serialization library
Browser / Computer-use runtime
```

某个依赖发生变化：

```text
Git repository
unchanged
```

但：

```text
Container base image
changed
```

或者：

```text
dependency resolution
changed
```

行为仍然可能变化。

Agent 系统比传统 CRUD 应用更加敏感，因为一个 runtime 变化可能影响：

```text
Tool ordering
Streaming
Retry
Timeout
Context assembly
Serialization
Token truncation
Parallel execution
Tool error handling
```

最终表现为：

```text
Agent behavior changed
```

因此 Agent 的 Supply Chain 不能只看到：

```text
Application repository
```

还应该看到：

```text
Model supply chain
Prompt supply chain
Tool supply chain
Data supply chain
Runtime supply chain
```

---

# 十、第八类 Drift：外部系统 Drift

Agent 经常依赖：

```text
Market Data
CRM
Email
Search
SaaS
MCP Server
External API
Enterprise Database
Third-party Service
```

如果这些系统行为改变，Agent 也可能发生变化。

例如：

```text
API returns:

status = pending
```

改成：

```text
status = awaiting_review
```

模型看到的结果不同。

或者：

```text
Search API ranking algorithm
```

变了。

或者：

```text
External service
```

增加了一个字段。

代码仍然没变。

因此：

> **Agent 是开放系统，而不是封闭的软件包。**

这也是金融机构特别需要关注第三方 AI / Cloud / Data Provider dependency 的原因。

FSB 已经将 AI 带来的第三方依赖、供应商集中、模型风险、数据质量和治理列为金融体系的重要脆弱性。FINMA 对金融机构使用 AI 的指导同样强调模型风险、数据风险、IT/cyber 风险、第三方依赖以及持续的风险识别、评估、管理和监控。

---

# 十一、真正危险的不是“Behavior Change”，而是“Unobserved Behavior Change”

因此，Agent 平台真正应该解决的问题，不是：

> 怎样保证 Agent 永远不变？

这是不现实的。

而应该是：

> **行为变化是否可被发现、解释、评估、批准和回滚？**

这实际上是从：

```text
Change Prevention
```

转向：

```text
Change Governance
```

这是一个非常重要的架构变化。

---

# 十二、传统软件的 Version 不够了

传统系统通常会记录：

```text
Application Version
Build Version
Docker Image
Git Commit
```

对于 Agent，这远远不够。

一次执行真正应该能够回答：

```text
Which code?
Which model?
Which model version?
Which prompt?
Which skill?
Which tools?
Which policies?
Which retrieval data?
Which runtime?
Which permissions?
Which approval rules?
Which external dependencies?
```

因此可以把一次 Agent Execution 描述成：

```text
Execution
   │
   ├── Code Version
   ├── Runtime Version
   ├── Model Provider
   ├── Model Version
   ├── Inference Config
   ├── System Prompt Version
   ├── Skill Versions
   ├── Tool Manifest Version
   ├── Policy Version
   ├── Retrieval Context
   ├── Memory / Session State
   ├── Identity / Entitlement
   └── External Dependency Versions
```

这比简单的：

```text
agentVersion = 1.8.2
```

有意义得多。

---

# 十三、建议引入 Effective Behavior Fingerprint

这里不一定需要再造一个庞大的 Agent Registry。

一个更简单、也更容易落地的做法是：

> **每次 Agent Execution 记录一个 Effective Behavior Fingerprint。**

例如：

```text
behaviorFingerprint =
  SHA256(
      modelVersion
    + inferenceConfigVersion
    + systemPromptVersion
    + skillVersions
    + toolManifestHash
    + policyVersion
    + runtimeVersion
    + retrievalContextHash
  )
```

它不是为了证明“两个执行一定完全相同”。

而是为了回答：

> **这两个执行是不是运行在同一个已知的行为环境里？**

例如：

```text
Execution A

code       = abc123
model      = gpt-x-2026-08
prompt     = prompt:42
tools      = tools:17
policy     = policy:91
runtime    = image:2026.09.18

fingerprint = F123
```

三天后：

```text
Execution B

code       = abc123
model      = gpt-x-2026-09
prompt     = prompt:42
tools      = tools:17
policy     = policy:91
runtime    = image:2026.09.18

fingerprint = F987
```

于是调查人员可以马上看到：

```text
代码没有变化

但 Model 变化了
```

这比“最近模型好像变笨了”有工程价值高得多。

---

# 十四、Retrieval 不应该只记录“Query”，还应该记录“Evidence”

对于 RAG Agent：

```text
query = "客户 A 的风险限制是什么？"
```

是不够的。

还应该能够追溯：

```text
retrieved document IDs
document versions
document timestamps
ranking
access decision
content hash
```

例如：

```text
Retrieval Evidence

doc-1023
version-8
updatedAt=2026-09-18

doc-8831
version-12
updatedAt=2026-09-19
```

这样才能解释：

```text
为什么昨天 Agent 说 A，
今天 Agent 说 B？
```

否则 LangSmith / OpenTelemetry 里只有：

```text
prompt
response
```

仍然无法完整解释行为。

---

# 十五、金融领域为什么尤其不能忽略 Behavior Drift？

普通企业 Chatbot 的 Drift 可能表现为：

```text
回答风格变化
回答准确率下降
```

金融 Agent 则可能表现为：

```text
Recommendation Changed
↓
Approval Path Changed
↓
Action Changed
↓
Business State Changed
```

尤其是：

```text
Trade Preparation
Order Submission
Portfolio Rebalancing
Proxy Voting
Client Communication
Credit Decision Support
AML / Surveillance
Payment Operations
```

很多场景中，真正重要的并不是 Agent 说了什么，而是：

> **它最终采取了什么行动。**

这也是金融监管与风险管理一直强调的重点：重要的不是技术名字，而是系统实际承担的业务功能、风险和控制。

例如 SEC Rule 15c3-5 对具有市场准入的 broker-dealer 要求风险管理控制覆盖订单，并特别强调自动化系统产生的订单同样需要适当控制。这并不意味着 SEC 要求使用某种 Agent 架构，而是说明在高风险金融操作中，“最终动作”必须处于独立、可验证的控制边界内。

类似地，金融机构的 AI 风险讨论也越来越强调模型、数据、第三方依赖以及持续监控，而不只是“上线前验证一次”。

---

# 十六、一个重要的金融治理区别：Model Risk ≠ Agent Behavior Drift

这里需要避免一个常见的过度推论。

不能简单说：

> “Behavior Drift 就是 Model Risk。”

不是。

它们有交集，但不是同一个概念。

更准确地说：

```text
Model Risk
    ↓
关注模型使用带来的风险

Agent Behavior Drift
    ↓
关注系统运行行为相对于基线发生变化
```

Agent Behavior Drift 可能来自：

```text
Model
Prompt
Tool
Policy
Data
Memory
Runtime
Environment
```

所以它实际上比传统 Model Drift 更宽。

另一方面，OCC、Federal Reserve、FDIC 在 2026 年更新后的 Model Risk Management guidance 明确说明，Generative AI 和 agentic AI 目前不属于该 guidance 的 scope；因此，不能把这套 guidance 当成“监管已经明确要求所有 Agent 做 Behavior Drift Management”的直接依据。

但这份 guidance 仍然提供了一个重要的治理思路：模型相关风险需要结合模型用途和重要性进行验证、监控，并关注第三方产品和供应商风险。

因此更合适的说法是：

> **Agent Behavior Drift 不是一个现成的监管合规术语，而是一个适合企业 Agent 架构的工程治理概念。**

它可以吸收传统 Model Risk Management、Third-party Risk、Change Management、Operational Resilience 和 AI Governance 中已经成熟的思想。

---

# 十七、不要只监控“回答质量”，要监控 Behavior

一个 Agent Eval 如果只有：

```text
Answer Correctness = 87%
```

远远不够。

对于 Agent，至少应该监控四层：

## 1. Outcome

```text
Task Success
Answer Correctness
Business Outcome
```

## 2. Trajectory

```text
Tool Selection
Tool Order
Number of Steps
Retry Count
Escalation Frequency
```

## 3. Control

```text
Unauthorized Attempts
Policy Denials
Approval Rate
Approval Bypass Attempts
Permission Errors
```

## 4. Side Effects

```text
Data Mutation
External API Calls
Commands Executed
Messages Sent
Orders Submitted
Business State Changed
```

Anthropic 在 2026 年的 Agent eval 研究中明确强调，Agent 是多轮运行、调用工具、修改状态并根据中间结果不断调整的系统，因此不能只用单轮 answer-based evaluation；需要更贴近实际 Agent trajectory 的评价方法。

AWS AgentCore 当前也把 tool usage、task completion、behavioral assertions 和 expected tool execution sequences 纳入 Agent evaluation，并支持在 prompt、tool、model 发生变化前后做 batch evaluation 和 A/B testing。

这意味着：

> **Agent Regression Test 不应该只比较文本，而应该比较行为轨迹。**

---

# 十八、推荐建立“Behavior Baseline”

例如生产 Agent 有一组长期稳定的行为：

```text
Task Success Rate       94%
Tool Selection Accuracy 97%
Escalation Rate          8%
Unauthorized Attempt     0%
Average Tool Calls       4.1
```

某次 Model 或 Prompt 更新后：

```text
Task Success Rate       95%
Tool Selection Accuracy 89%
Escalation Rate         3%
Unauthorized Attempt     2%
Average Tool Calls       6.7
```

如果只看第一项：

```text
95% > 94%
```

似乎变好了。

但如果看完整的 Behavior Vector：

```text
Tool selection ↓
Approval rate ↓
Unauthorized attempt ↑
Tool calls ↑
```

就会发现这个版本可能发生了非常重要的行为变化。

因此：

> **不能只做单指标评估，而应该建立 Behavior Baseline。**

---

# 十九、Behavior Drift Detection 应该检测什么？

可以把 Drift Detection 分成四层。

### 第一层：Configuration Drift

检测：

```text
Model Version
Prompt Version
Skill Version
Tool Manifest
Policy Version
Runtime Version
```

是否发生变化。

这是最容易实现的。

---

### 第二层：Context Drift

检测：

```text
Retrieval sources
Knowledge base
Memory
Business state
External data
```

是否发生变化。

---

### 第三层：Behavior Drift

检测：

```text
Tool selection
Tool ordering
Trajectory length
Escalation
Refusal
Output structure
Task completion
```

是否出现统计变化。

---

### 第四层：Risk Drift

检测：

```text
Authorization violation
Sensitive data access
High-risk commands
Approval bypass
Policy denial
External side effects
```

是否发生变化。

其中第四层对于金融 Agent 最重要。

因为：

```text
Answer changed
```

可能只是质量问题。

而：

```text
Risk behavior changed
```

可能是控制问题。

---

# 二十、真正合理的 Agent Release 应该是什么样？

传统软件是：

```text
Code
 ↓
Build
 ↓
Test
 ↓
Deploy
```

Agent 更适合：

```text
Behavior Change
        ↓
Identify Changed Surface
        ↓
Build Effective Behavior Snapshot
        ↓
Offline / Batch Evaluation
        ↓
Behavior Regression
        ↓
Security / Policy Evaluation
        ↓
Shadow / A-B / Canary
        ↓
Production
        ↓
Continuous Monitoring
        ↓
Rollback if Needed
```

尤其需要注意：

> **“没有代码变化”不能成为跳过 Release Control 的理由。**

因为以下变化同样可以改变 Agent：

```text
Model upgrade
Prompt update
Skill update
Tool update
Policy update
Knowledge update
Runtime update
Provider routing update
```

AWS AgentCore 当前提供的 optimization workflow，本身就是类似的思路：对生产 trace 产生建议，把 prompt/model/tool descriptions 等配置形成版本化 bundle，然后通过 batch evaluation 和 A/B testing 验证，最后再逐步发布。

这可以被理解为一种很典型的：

> **Behavior CI/CD**

---

# 二十一、Behavior Release 不等于“每次改文档都开变更单”

这里同样不能走向另一个极端。

不是所有变化都值得走同样强度的流程。

更合理的是按影响面分类。

例如：

| 变化      | 示例                                    | 建议控制                |
| ------- | ------------------------------------- | ------------------- |
| 非行为变化   | UI、日志格式                               | 普通发布                |
| 低风险行为变化 | Prompt wording、回答格式                   | Regression Eval     |
| 中风险变化   | Model、Tool、Retrieval ranking          | Regression + Canary |
| 高风险变化   | Authorization、Policy、Command、Approval | 强制评估 + 审批 + Canary  |
| 极高风险    | 可直接产生金融业务副作用的 Agent 行为                | 独立控制、人工审批、可回滚       |

这里的关键不是增加管理流程，而是：

> **风险越高，Behavior Change 的证据要求越高。**

这与 NIST AI RMF 的思路一致：在生产环境监控 AI 功能和行为，并针对生产表现与预部署测试之间的变化进行持续评估。

---

# 二十二、Command 为什么能成为解决 Drift 的一个重要边界？

这也是 Agent 架构里非常关键的一点。

假设一个 Agent 可以直接调用：

```text
submitOrder(...)
```

那么：

```text
Model behavior
        ↓
Tool Call
        ↓
Side Effect
```

Model 的一次行为变化，就可能直接进入业务系统。

而如果建模为：

```text
Agent
  ↓
Command Proposal
  ↓
Policy
  ↓
Approval
  ↓
Command Execution
```

那么：

```text
Agent Behavior Drift
```

即使发生，也不应该自动等于：

```text
Business State Drift
```

中间多了一道确定性的业务控制边界。

这不是说 Command 能阻止 Agent Drift。

而是：

> **Command 把“Agent 可能怎么做”和“业务系统最终允许做什么”分开。**

因此，一个比较成熟的架构应该是：

```text
             Agent
               │
               │ proposes
               ▼
        ┌───────────────┐
        │    Command    │
        │  Business     │
        │    Intent     │
        └───────┬───────┘
                │
        deterministic checks
                │
     ┌──────────┼───────────┐
     ▼          ▼           ▼
 Authorization  Policy    Approval
     │          │           │
     └──────────┼───────────┘
                ▼
        Command Executor
                │
                ▼
        Business System
```

于是：

```text
LLM = proposes
Policy = decides
Executor = acts
Business System = owns truth
Audit = records
```

这个边界对于金融服务尤其重要。

AWS Agentic AI Lens 同样强调，不应依赖 Agent 自己的 reasoning 来完成高风险授权，而应通过外部、确定性的 authorization controls；高风险变更可以进一步设置 human approval checkpoint。OWASP 对 Excessive Agency 的定义也明确指出，风险来自过大的 functionality、permissions 和 autonomy，并建议高影响行动由独立控制和人工批准进行保护。

---

# 二十三、所以真正应该记录的不是“Agent Version”

如果系统只记录：

```text
Agent = investment-agent-v3
```

这个信息价值有限。

更重要的是：

```text
Agent Definition
        +
Effective Behavior Snapshot
        +
Execution Context
        +
Decision / Control Evidence
```

例如：

```text
Execution ID
    │
    ├── codeVersion
    ├── runtimeVersion
    ├── modelVersion
    ├── promptVersion
    ├── skillVersions
    ├── toolManifestHash
    ├── policyVersion
    ├── retrievalEvidence
    ├── identity
    ├── entitlement
    ├── commandIntent
    ├── approvalDecision
    ├── executorVersion
    └── resulting business state
```

这样事后才能回答：

> 这次执行到底是什么环境下发生的？

而不是只回答：

> 当时运行的是哪个 Agent？

---

# 二十四、Observability 和 Audit Evidence 仍然不是一回事

这里还要再区分一个经常被混淆的问题。

LangSmith、OpenTelemetry、AgentCore Observability 等可以告诉你：

```text
发生了什么
```

但是金融监管意义上的：

```text
为什么允许
谁批准
依据什么政策
访问了什么数据
最终执行了什么
业务状态发生了什么变化
```

可能需要另外设计。

因此：

```text
Trace
```

和：

```text
Audit Evidence
```

不应被简单等同。

Behavior Drift 的治理也一样：

```text
Trace
    ↓
detect drift
```

只是第一步。

真正完整的是：

```text
Detect
  ↓
Explain
  ↓
Assess Risk
  ↓
Approve / Reject
  ↓
Release
  ↓
Monitor
  ↓
Audit
```

NIST 的生成式 AI 风险框架与 AI RMF Playbook 都强调生命周期中的记录、评估、生产监控和持续风险管理，而不是只依赖部署前测试。

---

# 二十五、一个适合企业 Agent 平台的最小架构

不需要为此重新造一套巨大平台。

最小实现实际上只需要四部分。

## 1. Behavior Manifest

描述：

```yaml
model:
  provider: openai
  version: xxx

prompt:
  version: prompt-42

skills:
  - research-v7
  - trade-v3

tools:
  manifestHash: xxx

policy:
  version: policy-91

runtime:
  version: image-2026-09-20
```

---

## 2. Behavior Fingerprint

根据 Manifest 和实际运行上下文生成：

```text
behaviorFingerprint
```

---

## 3. Behavior Eval

至少包括：

```text
Outcome
Trajectory
Tool Use
Policy
Safety
Side Effects
```

而不是只评价最终答案。

---

## 4. Execution Evidence

每一次生产 execution 至少记录：

```text
behaviorFingerprint
model
prompt
tool manifest
policy
retrieval evidence
identity
commands
approvals
outcome
```

这样已经足以覆盖大部分企业 Agent 最重要的行为追踪问题。

不需要因此马上引入：

```text
新的 Workflow Engine
新的 Event Bus
新的 Agent Registry
新的复杂 DSL
```

---

# 二十六、对于现有 Agent 平台，最值得先做什么？

一个现实中的企业 Agent 平台，通常已经有：

```text
LiteLLM / Model Gateway
DeepAgents / LangChain
AgentCore
LangSmith
RAG
Tools / MCP
Policy
Workflow
Audit
```

这时最容易犯的错误，是再增加一个：

```text
Behavior Governance Platform
```

实际上没有必要。

更简单的做法是把已有能力串起来：

```text
                    ┌──────────────┐
                    │ Model Gateway│
                    └──────┬───────┘
                           │
┌─────────────┐      ┌─────▼─────┐
│ Prompt/Skill │─────►│   Agent   │
└─────────────┘      └─────┬─────┘
                           │
                     Tool / RAG
                           │
                    ┌──────▼──────┐
                    │ Policy Layer│
                    └──────┬──────┘
                           │
                     Command / HITL
                           │
                    ┌──────▼──────┐
                    │ Business API │
                    └──────────────┘

          每次 Execution 都记录
                   │
                   ▼
          Effective Behavior
              Fingerprint
```

LangSmith 负责：

```text
Trace / Eval
```

AgentCore 或类似运行时负责：

```text
Execution / Runtime
```

现有 Policy 层负责：

```text
Authorization / Risk Control
```

Command 层负责：

```text
Business Mutation Boundary
```

而新增的其实只有：

```text
Behavior Manifest
Behavior Fingerprint
Behavior Regression
```

这就足够形成一个闭环。

---

# 二十七、最终可以形成一个非常重要的架构原则

传统软件可以近似认为：

> **Code is the behavior.**

Agent 系统则应该改成：

> **Code is only one input to behavior.**

进一步：

```text
Model
Prompt
Tool
Policy
Data
Memory
Runtime
Environment
```

共同决定：

```text
Effective Agent Behavior
```

因此：

> **没有代码变化，不等于没有行为变化。**

更准确地说：

> **没有代码变化，只能证明 Software Artifact 没变，不能证明 Effective Behavior 没变。**

---

# 二十八、对于金融 Agent，可以进一步形成四条原则

### 原则一：Behavior Change 必须能够被识别

任何可能影响 Agent 行为的 Model、Prompt、Skill、Tool、Policy、Data 或 Runtime 变化，都应该有版本或可追踪标识。

### 原则二：Behavior Change 必须能够被评估

不能只测试：

```text
"回答是不是正确"
```

还需要测试：

```text
"调用了什么"
"执行了什么"
"是否绕过控制"
"是否改变了风险边界"
```

### 原则三：Risk Boundary 不能由 Drift 之后的 Agent 自己决定

尤其是：

```text
Authorization
Data Entitlement
Approval
High-risk Command
Business State Mutation
```

必须由独立的确定性控制层处理。

### 原则四：Production Behavior 必须能够解释

事后必须能够回答：

```text
当时运行什么模型？
用了哪个 Prompt？
拿到了哪些数据？
有什么 Tool？
遵守什么 Policy？
谁批准？
执行了什么 Command？
最终改变了什么 Business State？
```

如果这些问题回答不了，那么真正的问题不是：

```text
Agent 最近是不是变笨了？
```

而是：

> **企业根本还没有建立 Agent Behavior Governance。**

---

# 二十九、结语：Agent 的版本号应该从 Git Commit 扩展到 Behavior Snapshot

Agent 时代，一个成熟系统不能再只问：

```text
What version of the software was deployed?
```

而应该问：

```text
What behavior configuration was effective
when this decision was made?
```

两者的差别非常大。

传统软件：

```text
Git Commit
      ↓
Build
      ↓
Release
```

Agent：

```text
Code
Model
Prompt
Skill
Tool
Policy
Data
Memory
Runtime
Environment
      ↓
Effective Behavior
      ↓
Evaluation
      ↓
Production
```

因此，Agent 平台真正需要建立的，不是一个“永远不会变化”的 Agent。

而是一套能够做到：

```text
Version
→ Detect
→ Evaluate
→ Explain
→ Approve
→ Deploy
→ Monitor
→ Rollback
```

的 **Behavior Lifecycle**。

对于普通 Chatbot，这是提高质量的问题。

对于企业 Agent，这是可靠性问题。

对于金融 Agent，则进一步是：

> **Operational Risk、Authorization、Auditability 和 Business Control 的问题。**

真正成熟的 Agent 架构，不是让模型变得“永远不会犯错”，而是让：

> **模型即使行为发生变化，也不会悄悄改变企业系统的安全边界和业务控制边界。**

这才是 Agent Behavior Drift 最值得关注的架构问题。

---

# 参考资料

1. **OpenAI — API Backward Compatibility / Model Snapshots**
   OpenAI 明确说明不同 model snapshots 之间 prompting behavior 可能变化，并建议生产应用使用 pinned model versions 与 evals。
   [OpenAI API Reference — Backward Compatibility](https://platform.openai.com/docs/api-reference/backward-compatibility?utm_source=chatgpt.com)

2. **Microsoft — Model Versioning in Microsoft Foundry Models**
   说明模型版本升级、自动升级策略，以及模型升级可能对应用和 workflow 行为造成影响。
   [Microsoft Foundry — Model versions](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/model-versions?utm_source=chatgpt.com)

3. **Google Cloud — Vertex AI Model Version Aliases**
   说明 model alias 可以在不同版本之间移动，因此不指定固定版本时，实际运行模型可能发生变化。
   [Google Cloud — Model version aliases](https://docs.cloud.google.com/vertex-ai/docs/model-registry/model-alias?utm_source=chatgpt.com)

4. **Anthropic — Model Deprecations**
   说明 Claude 模型生命周期、弃用、迁移以及在迁移前对应用进行测试的重要性。
   [Anthropic — Model deprecations](https://docs.anthropic.com/en/docs/about-claude/model-deprecations?utm_source=chatgpt.com)

5. **AWS — Amazon Bedrock AgentCore Optimization**
   AWS 将 system prompt、model ID、tool descriptions 等作为可独立版本管理的 Agent configuration，并支持 Batch Evaluation 与 A/B testing。
   [AWS — AgentCore optimization](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/optimization.html?utm_source=chatgpt.com)

6. **AWS — AgentCore How It Works**
   展示了将 Prompt、Model、Tool Description 等配置做成 immutable configuration bundle，并与 runtime code deployment 解耦的设计。
   [AWS — AgentCore optimization: How it works](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/optimization-how-it-works.html?utm_source=chatgpt.com)

7. **LangChain — LangSmith Prompt Versioning**
   说明 Prompt commit、tag 和环境 promotion，可以在不改变调用代码的情况下切换 Prompt 版本。
   [LangSmith — Prompt engineering concepts](https://docs.langchain.com/langsmith/prompt-engineering-concepts?utm_source=chatgpt.com)

8. **Anthropic — Demystifying Evals for AI Agents**
   讨论 Agent 的多轮、工具调用、状态修改和动态轨迹，以及为什么 Agent evaluation 不能只关注最终文本。
   [Anthropic — Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents?utm_source=chatgpt.com)

9. **NIST — AI RMF Measure 2.4 / Production Monitoring**
   强调在生产环境持续监控 AI 系统及其组件的功能与行为，并关注环境变化带来的 drift。
   [NIST AI RMF Playbook — Measure](https://airc.nist.gov/airmf-resources/playbook/measure/?utm_source=chatgpt.com)

10. **NIST — Challenges to the Monitoring of Deployed AI Systems**
    2026 年报告指出，模型非确定性和动态生产输入会产生预部署测试难以捕获的实际行为变化，因此需要 post-deployment monitoring。
    [NIST — Challenges to the monitoring of deployed AI systems](https://www.nist.gov/publications/challenges-monitoring-deployed-ai-systems-center-ai-standards-and-innovation?utm_source=chatgpt.com)

11. **OWASP — LLM06:2025 Excessive Agency**
    将 excessive functionality、permissions 和 autonomy 视为 Agent 风险来源，并建议最小化 Tool 权限、在下游执行授权以及对高影响操作采用 human approval。
    [OWASP LLM06:2025 — Excessive Agency](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/?utm_source=chatgpt.com)

12. **FSB — The Financial Stability Implications of Artificial Intelligence**
    从金融稳定角度讨论 AI 带来的 model risk、data quality、governance、third-party dependency 和 concentration risk。
    [FSB — The Financial Stability Implications of Artificial Intelligence](https://www.fsb.org/2024/11/the-financial-stability-implications-of-artificial-intelligence/?utm_source=chatgpt.com)

13. **FINMA — Governance and Risk Management when Using AI**
    讨论金融机构使用 AI 时的 model、data、IT/cyber、third-party、legal 和 reputational risks，并强调识别、评估、管理和监控。
    [FINMA Guidance 08/2024](https://www.finma.ch/en/news/2024/12/20241218-mm-finma-am-08-24/?utm_source=chatgpt.com)

14. **Federal Reserve / OCC / FDIC — Revised Model Risk Management Guidance, 2026**
    2026 年新版指导明确说明 GenAI 和 agentic AI 当前不在该 guidance scope，但同时强调 risk-based validation、monitoring、governance 和 third-party product considerations，可作为金融风险治理的相邻参考。
    [Federal Reserve SR 26-2](https://www.federalreserve.gov/supervisionreg/srletters/SR2602.htm?utm_source=chatgpt.com)

15. **SEC — Rule 15c3-5 Risk Management Controls**
    对 broker-dealer market access 的风险控制提供了一个具体金融场景：订单及自动化订单均应处于适当的预先风险控制之下。
    [SEC — Risk Management Controls for Brokers or Dealers with Market Access](https://www.sec.gov/rules-regulations/final-rules/risk-management-controls-brokers-dealers-market-access?utm_source=chatgpt.com)

16. **LLM Behavior Drift Research — How Is ChatGPT’s Behavior Changing Over Time?**
    研究比较了不同时间版本的 GPT 行为，观察到模型随时间推移可能出现 instruction-following 等能力变化，说明长期行为监控具有研究基础。
    [How Is ChatGPT’s Behavior Changing Over Time?](https://doi.org/10.1162/99608f92.5317da47?utm_source=chatgpt.com)

17. **LLM Reproducibility Research — Randomness in Large Language Models**
    讨论 LLM 输出差异可能来自采样、静默模型更新、数值计算和 expert routing 等因素，因此仅固定 Prompt 和温度并不足以保证生产环境中的完全复现。
    [Randomness in large language models: What researchers need to know (and report)](https://arxiv.org/abs/2607.24372?utm_source=chatgpt.com)

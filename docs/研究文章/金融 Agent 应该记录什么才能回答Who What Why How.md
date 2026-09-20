# 金融 Agent 应该记录什么，才能回答“Who / What / Why / How”

金融 Agent 真正进入生产以后，一个问题迟早会出现：

> **半年以后，如果审计、合规、监管、客户投诉处理或内部调查人员问：Who / What / Why / How，我们到底能不能回答？**

很多 Agent 平台对此的第一反应是：

```text
保存 Prompt
+
保存 LLM Response
+
保存 Tool Call
+
保存 Trace
```

从工程 Observability 的角度看，这已经相当不错。

但从金融业务和监管角度看，仍然可能远远不够。

因为真正需要回答的问题不是：

```text
模型当时生成了什么文本？
```

而是：

```text
谁触发了这件事？

系统究竟做了什么？

为什么这个动作被允许？

它是通过什么数据、模型、Policy、Tool 和人工控制完成的？

最终业务系统到底发生了什么？
```

因此，金融 Agent 的审计设计不应该从“我要存多少日志”开始，而应该从一个更加严格的问题开始：

> **对于一个需要事后证明的业务事实，我们究竟需要哪些证据，才能把 Who / What / Why / How 串成一个可验证的证据链？**

这也是为什么：

> **AI Observability ≠ Regulatory Audit Evidence。**

Observability 是重要的数据来源，但真正的金融 Agent Evidence Architecture，需要在其之上再增加身份、授权、业务语义、Policy、数据来源、版本、外部结果、完整性、留存和重建能力。

---

# 1. 先定义：Who / What / Why / How 到底分别在问什么

把这个问题拆开以后，会发现四个词实际上对应四类不同证据。

| 问题       | 真正要证明的事情                                      |
| -------- | --------------------------------------------- |
| **Who**  | 谁发起、谁授权、谁批准、哪个 Agent/系统执行、谁进行了人工干预            |
| **What** | Agent 做了什么、访问了什么、调用了什么、改变了什么、最终业务结果是什么        |
| **Why**  | 为什么采取这个动作、依据什么业务意图、Policy、授权、风险检查和事实          |
| **How**  | 通过哪个 Agent、模型、版本、数据、Tool、Workflow、外部系统和控制路径完成 |

因此可以把它理解成：

```text
Who
  ↓
Actor / Authority

What
  ↓
Action / State / Outcome

Why
  ↓
Intent / Policy / Decision Basis

How
  ↓
Execution / Data / Model / Tool / Control Path
```

真正的审计问题通常还会追问第五个问题：

> **Can you prove it?**

也就是：

```text
Evidence
=
这些记录本身是否可靠、完整、可追溯、可长期保存并可重建？
```

PCAOB AS 1105 对 audit evidence 的核心要求正是 sufficient and appropriate evidence，并明确区分 evidence 的数量与质量；相关性和可靠性决定 evidence quality。对于企业自己生成的信息，审计人员还需要关注其准确性、完整性以及相关 IT controls。

因此，金融 Agent 的设计不能只解决：

```text
What happened?
```

还必须解决：

```text
Can we prove what happened?
```

---

# 2. 第一原则：不要把 Agent Trace 当成完整审计记录

典型 Agent Trace 大致是：

```text
Trace
 ├── Agent invocation
 ├── LLM call
 ├── Retrieval
 ├── Tool A
 ├── Tool B
 └── Final response
```

它非常适合回答：

```text
为什么这次 Agent 失败？
哪一个 Tool 慢？
模型调用了几次？
哪个步骤产生了错误？
```

但监管或审计可能问：

```text
谁授权了这次交易？

为什么这个 Agent 有权访问这份客户数据？

当时使用的是哪一版 Policy？

当时究竟看到了哪些数据？

哪个控制检查通过？

谁进行了人工批准？

外部系统最终有没有真正执行？

这个记录后来有没有被修改？
```

这些问题通常无法单靠普通 Trace 回答。

AWS Agentic AI Lens 对这个问题给出了非常直接的架构建议：Agent 的 decision artifacts 和日志应该进入独立于 Agent 自身 operational scope 的、具有篡改保护能力的存储；同时应该使用一个独立于 trace ID 的 correlation identifier，跨越异步边界，把 Agent、Tool、Log 和 Decision Artifact 串起来，并使调查人员能够在不依赖 Agent 自己“描述发生了什么”的情况下重建历史交互。

因此：

```text
Trace ID
```

应该被理解为：

> 技术执行关联标识。

而：

```text
Case ID
Decision ID
Operation ID
Approval ID
```

才是更接近：

> 业务和控制证据关联标识。

---

# 3. Who：首先记录“谁让这件事发生”

很多 Agent 日志只记录：

```json
{
  "agent": "proxy-vote-agent",
  "action": "submit_vote"
}
```

这远远不够。

因为 Agent 并不是业务主体。

一个 Agent 可能因为：

```text
Human User
Scheduled Job
Business Event
Upstream Workflow
Another Agent
System Process
```

而被触发。

所以第一层应该记录：

```text
Initiating Source
```

例如：

```text
initiator_type
initiator_id
initiator_session
initiator_channel
initiated_at
```

可以区分：

```text
HUMAN
SCHEDULE
EVENT
WORKFLOW
AGENT
SYSTEM
```

AWS Agentic AI Lens 明确要求每一个 logged action 能追溯到 initiating source，例如 human session、upstream event、schedule 或 another agent。

---

# 4. Who 不只是“谁发起”，还包括“谁有权让它发生”

金融系统中：

```text
Initiator ≠ Approver ≠ Executor
```

例如：

```text
Client instruction
      ↓
Portfolio manager
      ↓
Policy check
      ↓
Supervisor approval
      ↓
Agent execution
      ↓
Broker
```

因此至少应该有：

```text
initiator
requester
approver
policy_authority
executor
human_intervention_actor
```

这不是所有场景都必须存在多个不同的人，而是系统应该有能力区分这些角色。

例如：

```text
initiator = USER-123
approver = USER-456
executor = AGENT-07
```

这样才能回答：

> 是谁要求做这件事？

和：

> 是谁批准做这件事？

以及：

> 到底是谁执行了？

FINRA 2026 年对 GenAI / Agent 的监管观察明确提出，金融机构应考虑如何跟踪 agent actions and decisions、如何实施 human-in-the-loop oversight，以及如何建立限制 Agent 行为的 guardrails。

---

# 5. Who 还需要记录“哪个版本的身份和权限”

只记录：

```text
user_id = alice
```

也可能不够。

因为真正需要回答的是：

> **Alice 在当时是什么身份？当时具有什么权限？**

因此对于高风险动作，最好能够关联：

```text
principal_id
role_snapshot
entitlement_snapshot
authorization_policy
authorization_decision
effective_time
```

例如：

```text
user = U123
role = PortfolioManager
entitlement = TRADE_US_EQUITIES
policy = TRADE_POLICY_v17
decision = ALLOW
```

重点不应该是无限保存整个 IAM 数据库快照，而是：

> 对关键业务操作，保存足以证明当时授权判断的必要信息，并能够指向权威授权系统。

这样既避免把所有权限数据复制进 Agent 平台，也能够支持事后重建。

---

# 6. What：记录的不是“模型说了什么”，而是“业务上做了什么”

这是金融 Agent 最重要的区别之一。

例如：

```text
LLM Output:
"我建议投赞成票。"
```

这不是最重要的 What。

真正重要的是：

```text
business_action = SUBMIT_PROXY_VOTE
security = ABC
meeting = M2026-001
resolution = 3
instruction = FOR
```

再例如：

```text
LLM Output:
"建议买入 10,000 股。"
```

真正重要的是：

```text
decision = BUY
quantity = 10000
instrument = XYZ
```

而最终业务事实可能又是：

```text
broker_order_id = B123
filled_quantity = 7000
status = PARTIALLY_FILLED
```

因此：

```text
Agent Recommendation
        ≠
Authorized Decision
        ≠
Submitted Operation
        ≠
External Business Outcome
```

这几个状态必须分开。

---

# 7. 建议把 What 拆成五个阶段

```text
Intent
   ↓
Proposal
   ↓
Authorized Decision
   ↓
Execution
   ↓
Outcome
```

例如一个投资交易 Agent：

```text
Intent
“客户要求进行资产再平衡”

Proposal
“建议卖出 ABC 10,000 股”

Authorized Decision
“允许执行该交易”

Execution
“发送订单到 OMS”

Outcome
“Broker 成交 7,000 股”
```

如果只保存：

```text
final_response
```

那么整个链条会消失。

---

# 8. What 还必须记录“访问了什么”

Agent 特别容易出现一个传统系统不太一样的问题：

> Agent 不仅执行动作，还会动态访问数据。

例如：

```text
客户资料
持仓
市场数据
研究报告
内部政策
第三方研究
历史交易
```

因此对金融 Agent，What 不能只包括 Action，还应包括：

```text
data_access
tool_access
external_system_access
```

至少要能回答：

```text
访问了哪个数据域？
哪个对象？
为什么允许访问？
什么时候访问？
通过哪个 Tool？
```

FINRA 当前针对 Agent 的监管考虑也明确提到 system access 和 data handling 的监控。

---

# 9. 数据访问本身也应该区分“Retrieved”与“Used”

这是 RAG Agent 很容易踩坑的地方。

例如：

```text
Search
 ↓
Document A
Document B
Document C
 ↓
LLM
```

Trace 可以证明：

```text
Retrieved A/B/C
```

但是不能自动证明：

```text
Decision was based on A/B/C
```

所以最好区分：

```text
Retrieved Sources
```

和：

```text
Decision Sources
```

前者回答：

> Agent 看到了什么？

后者回答：

> 哪些输入被纳入这次 Decision Evidence？

这两个集合可能一样，也可能不同。

---

# 10. Why：不要把 Why 等同于 LLM 的自然语言解释

这是整个主题里最需要谨慎的一点。

很多系统会记录：

```text
Agent:
“我之所以建议 BUY，是因为……”
```

然后把这段文本当成：

```text
decision rationale
```

在金融领域，这种设计并不稳妥。

BIS Financial Stability Institute 2025 年的研究明确指出，复杂 AI 和 LLM 的 explainability 存在 inaccuracy、instability 和 misleading explanations 等问题。换句话说，模型生成的解释不应自动被当成真实、稳定的因果证明。

因此：

```text
Natural-language explanation
```

应该和：

```text
Evidence-backed decision basis
```

分开。

---

# 11. Why 真正应该记录什么

对于金融 Agent，一个更可靠的 Why 可以拆成：

```text
Business Intent
+
Applicable Policy
+
Authorization
+
Risk Checks
+
Input Facts
+
Decision Factors
+
Human Review
```

例如：

```text
Business Intent
→ Client requested proxy vote

Policy
→ Client mandate allows FOR

Risk Check
→ Conflict check passed

Data
→ Current holding exists

Human Review
→ Approved by U456

Decision
→ Submit FOR
```

这里的 Why 是一个：

```text
Decision Evidence Set
```

而不是一段：

```text
LLM reasoning narrative
```

---

# 12. Why 的第一层应该是 Business Intent

很多系统只保存：

```text
Prompt
```

但 Prompt 不一定等于业务意图。

例如：

```text
Prompt:
“帮我把这个组合调整一下。”
```

实际业务意图可能是：

```text
Business Case:
Quarterly Rebalancing
Target Allocation:
60/40
Risk Profile:
Moderate
Mandate:
Client Policy v12
```

因此要建立：

```text
business_case_id
```

或者：

```text
intent_id
```

把自然语言请求和业务对象关联起来。

这一步非常重要，因为以后审计真正问的通常不是：

> 用户当时输入了什么文字？

而是：

> **企业当时认为自己在执行什么业务行为？**

---

# 13. Why 的第二层是 Policy

例如：

```text
Agent proposed:
BUY XYZ
```

Policy Layer 记录：

```text
TRADE_POLICY_v17
→ Instrument Allowed
→ Client Mandate Allowed
→ Limit Check Passed
→ Restricted List Check Passed
```

于是可以回答：

> 为什么这个动作在当时是允许的？

注意这里应该保存：

```text
policy_id
policy_version
policy_decision_id
decision
evaluation_time
```

而不仅仅是：

```text
allowed = true
```

因为今天：

```text
Policy v21
```

不能证明三个月前：

```text
Policy v17
```

也是这样。

---

# 14. Why 的第三层是“Decision Factors”，而不是“完整思维过程”

可以记录结构化：

```text
decision_factors = [
  "CLIENT_MANDATE_MATCH",
  "POSITION_EXISTS",
  "LIMIT_CHECK_PASS",
  "CONFLICT_CHECK_PASS"
]
```

而不是试图保存：

```text
模型的全部内部推理文本
```

这样做有三个好处：

```text
可读
可验证
可结构化查询
```

例如：

```text
Why = BUY?
```

系统可以回答：

```text
MANDATE_ALLOWED
RISK_LIMIT_PASSED
REBALANCING_THRESHOLD_TRIGGERED
```

审计人员不需要阅读数千 token 的模型生成文本。

---

# 15. Why 还应该记录“不选择其他路径”的控制事实

这是容易被忽略的一点。

例如：

```text
Agent recommends BUY.
```

为什么？

可能不只是：

```text
BUY_ALLOWED
```

还因为：

```text
SELL_BLOCKED
HOLD_NOT_SUFFICIENT
REBALANCING_REQUIRED
```

因此对重要决策，可以记录：

```text
selected_action
rejected_actions
policy_constraints
```

但这里需要注意：

> 不能要求所有 Agent 永久记录所有模型内部候选 thought。

更合理的是在确定性 Policy / Workflow 层记录：

```text
policy-eligible alternatives
control failures
decision constraints
```

这是真正可以验证的内容。

---

# 16. How：记录“这件事究竟是怎么完成的”

How 最接近传统 Observability，但金融 Agent 的 How 应该比普通 trace 更完整。

至少应该覆盖：

```text
Agent
Model
Prompt / Configuration
Data
Retrieval
Tool
Workflow
Policy
External System
Version
Timestamp
```

例如：

```text
Agent:
proxy-vote-agent v4.2

Model:
model-x release 2026-09

Policy:
proxy-policy v12

Tool:
iss.submit_vote v2.1

Workflow:
proxy-vote-workflow v7

External:
ISS

Reference:
VOTE-123
```

这样才能回答：

> 技术上到底是怎么实现的？

---

# 17. How 的核心是“Point-in-Time Reconstruction”

不能只记录：

```text
current_agent_version = 5
current_policy_version = 20
current_model = X
```

而应该能够证明：

```text
At 2026-09-20 10:31

Agent = v4
Policy = v17
Model = X-release-2026-08
Tool = v2.1
Retrieval Index = idx-20260901
```

否则事后看到当前系统状态，并不能证明历史行为。

美联储 2026 年修订的 Model Risk Management 指导强调模型的设计、假设、数据、验证、持续监控、治理、角色责任以及第三方模型的理解和验证，并要求模型生命周期中的关键活动保持清晰的 accountability 和 documentation。

因此，金融 Agent 的 How 不是：

```text
How does it work today?
```

而是：

> **How did this specific decision work at that point in time?**

---

# 18. Model Identity 只是 How 的第一层

很多系统保存：

```text
model = gpt-x
```

这通常不够。

至少应该能够关联：

```text
model_provider
model_name
model_version
deployment_id
agent_version
prompt_version
tool_schema_version
guardrail_version
policy_version
```

是否还要保存：

```text
temperature
sampling parameters
routing metadata
```

则需要根据 Use Case 和风险决定，不应该机械地永久保存所有参数。

但对于高风险业务，一个明确原则是：

> **事后必须能够定位到当时真正运行的 Agent / Model / Policy configuration。**

---

# 19. Tool Version 同样重要

例如：

```text
submit_trade()
```

今天和半年前可能是同一个函数名。

但实际上：

```text
v1
→ POST /order

v2
→ POST /order + extra precheck

v3
→ different broker route
```

如果只记录：

```text
tool = submit_trade
```

那么 How 并不完整。

应该至少保存：

```text
tool_id
tool_version
tool_configuration_version
target_system
```

---

# 20. Retrieval Configuration 也属于 How

RAG Agent 的结果很大程度取决于：

```text
index
chunking
embedding model
retrieval query
filters
reranker
tenant
entitlement
```

因此：

```text
retrieval
```

如果对业务决策有实质影响，就不能只记录：

```text
document_ids
```

还应该能定位：

```text
index_version
retrieval_policy
filter_policy
retriever_version
```

NIST AI RMF Playbook 在治理与透明度部分也明确建议记录 AI 系统的数据 provenance，包括 sources、origins、transformations、dependencies、constraints 和 metadata，并关注 accountability 和 auditability。

---

# 21. Data Provenance 是金融 Agent Evidence 的核心

很多 AI 系统记录：

```text
prompt
response
```

但是金融审计真正可能需要：

```text
这个回答所依据的数据从哪里来？
当时是什么版本？
谁允许它访问？
数据有没有经过转换？
```

因此建议：

```text
source_id
source_type
source_version
retrieved_at
transformation
access_policy
content_hash
```

例如：

```text
ISS Research
Version = 2026-09-17
Retrieved = 2026-09-20 09:31
Entitlement = ALLOW
Hash = ...
```

这样才能回答：

> Agent 当时到底看到了什么？

而不仅仅是：

> Agent 现在看起来调用过什么。

---

# 22. 第三方数据也必须记录 Provenance

金融 Agent 很多时候依赖：

```text
Vendor Research
Market Data
Credit Data
ESG Data
Broker Data
Corporate Action Data
```

这意味着：

```text
Source
```

不一定是内部数据库。

PCAOB AS 1105 特别强调，企业提供的外部电子信息作为审计证据时，需要理解信息的来源、接收和维护过程，并评估是否经过修改。

因此：

```text
Vendor API response
```

不能只变成：

```text
LLM input
```

而应该在需要的场景下能够成为：

```text
Provenance-linked Evidence
```

---

# 23. How 还应该记录 Workflow Path

Agent 是非确定性的。

例如同一个 Use Case 可能出现：

```text
Agent
 → Search A
 → Tool B
 → Human Review
```

或者：

```text
Agent
 → Search A
 → Search C
 → Tool B
```

对于高风险业务，最好能够重建：

```text
workflow_version
step
transition
condition
decision
tool
human_intervention
```

这样才能回答：

> Agent 为什么经过了这个 Workflow Path？

这也是为什么金融 Agent 更适合：

```text
Agent Reasoning
        +
Deterministic Workflow
```

而不是把整个业务流程全部留在 LLM 自由决策中。

---

# 24. How 必须记录“失败和异常”，不能只记录成功

假设：

```text
Tool A
SUCCESS

Tool B
TIMEOUT

Tool B
RETRY

Tool B
SUCCESS
```

如果最后只保存：

```text
final_status = SUCCESS
```

那么审计人员看不到：

```text
发生过什么异常？
有没有重新执行？
有没有人工干预？
```

金融证据应该能够重建：

```text
Attempt 1
Attempt 2
Recovery
Final Outcome
```

因为“成功”本身不一定意味着流程没有产生风险。

---

# 25. What / Why / How 必须覆盖 Recovery

结合前面金融 Agent 的 Retry / Timeout / Compensation 设计，一个高风险操作还要记录：

```text
failure
timeout
unknown
reconciliation
retry
compensation
manual intervention
```

例如：

```text
Operation = PAY-123

Attempt 1
→ timeout

Reconciliation
→ payment pending

Attempt 2
→ not executed

Retry
→ success

Final Outcome
→ posted
```

如果只记录：

```text
payment = success
```

就失去了整个恢复链。

因此 Recovery 是：

```text
What
+
How
+
Why
```

的一部分。

---

# 26. Compensation 也必须进入证据链

例如：

```text
Payment = SUCCESS
```

后来：

```text
Business Workflow = FAILED
```

然后：

```text
Refund = SUCCESS
```

最终：

```text
Account State = CORRECTED
```

需要能够回答：

```text
Who authorized refund?
Why was refund necessary?
How was refund initiated?
What was the original payment?
What is the external refund reference?
What is the final account state?
```

因此：

```text
Compensation
```

不能只是：

```text
technical rollback
```

而应该成为：

```text
first-class business operation
```

并拥有自己的：

```text
operation_id
decision_id
approval
external_reference
outcome
```

---

# 27. What 最终必须落到“业务事实”

这是整个设计的一个关键边界。

例如 Agent Trace：

```text
Tool:
create_order
HTTP 200
```

仍然不能自动证明：

```text
Order = EXECUTED
```

最终业务事实应该来自：

```text
OMS
Broker
Settlement
Ledger
Vendor System
```

等 authoritative system。

因此建议记录：

```text
agent_observed_outcome
```

和：

```text
authoritative_business_outcome
```

两个字段。

例如：

```text
Agent observed:
SUCCESS

External system:
PENDING

Final:
FILLED
```

这样才能避免：

```text
Trace = Truth
```

这种危险假设。

---

# 28. “Who / What / Why / How”其实可以映射成一个 Evidence Graph

可以把一次高风险 Agent 行为表示成：

```text
                         ┌─────────────┐
                         │   Intent    │
                         └──────┬──────┘
                                │
                                ▼
                         ┌─────────────┐
                         │   Actor     │
                         │   Who       │
                         └──────┬──────┘
                                │
                                ▼
                         ┌─────────────┐
                         │   Policy    │
                         │   Why       │
                         └──────┬──────┘
                                │
                                ▼
                         ┌─────────────┐
                         │   Agent     │
                         │   How       │
                         └──────┬──────┘
                                │
                 ┌──────────────┼──────────────┐
                 ▼              ▼              ▼
              Model         Data/ RAG        Tools
                 │              │              │
                 └──────────────┼──────────────┘
                                ▼
                         ┌─────────────┐
                         │  Decision   │
                         │   What      │
                         └──────┬──────┘
                                │
                                ▼
                         ┌─────────────┐
                         │  Approval   │
                         └──────┬──────┘
                                │
                                ▼
                         ┌─────────────┐
                         │  Operation  │
                         └──────┬──────┘
                                │
                                ▼
                         ┌─────────────┐
                         │  External   │
                         │   Result    │
                         └──────┬──────┘
                                │
                                ▼
                         ┌─────────────┐
                         │ Business    │
                         │   Outcome   │
                         └─────────────┘
```

这个图实际上说明了一件很重要的事：

> **Audit Trail 不是一条日志，而是一张跨系统、跨主体、跨时间的证据关系图。**

---

# 29. 一个完整的 Financial Agent Evidence Record

可以设计成：

```json
{
  "case": {
    "case_id": "CASE-2026-00123",
    "business_type": "PROXY_VOTE"
  },

  "who": {
    "initiator": {
      "type": "HUMAN",
      "id": "USER-123"
    },
    "approver": {
      "id": "USER-456"
    },
    "executor": {
      "type": "AGENT",
      "id": "proxy-vote-agent"
    }
  },

  "what": {
    "intent": "SUBMIT_PROXY_VOTE",
    "decision": "FOR",
    "security": "ABC",
    "meeting_id": "M-2026-001",
    "resolution_id": "R-3",
    "operation_id": "OP-9988",
    "business_outcome": "SUBMITTED"
  },

  "why": {
    "policy_id": "PROXY_POLICY",
    "policy_version": "12",
    "policy_decision_id": "PD-8831",
    "risk_checks": [
      "CLIENT_MANDATE_PASS",
      "CONFLICT_CHECK_PASS"
    ],
    "decision_factors": [
      "MANDATE_ALLOWS_FOR"
    ]
  },

  "how": {
    "agent_version": "4.2",
    "model_id": "MODEL-X",
    "model_version": "2026-09",
    "prompt_version": "17",
    "workflow_version": "8",
    "tool": "vendor.submit_vote",
    "tool_version": "2.1",
    "retrieval_index": "IDX-20260920",
    "external_system": "VENDOR-A",
    "external_reference": "V-123456"
  },

  "provenance": {
    "sources": [
      {
        "source_id": "DOC-123",
        "version": "4",
        "retrieved_at": "2026-09-20T10:30:00Z",
        "content_hash": "..."
      }
    ]
  },

  "recovery": {
    "attempts": 2,
    "reconciled": true,
    "manual_intervention": false
  },

  "audit": {
    "trace_id": "abc123",
    "recorded_at": "2026-09-20T10:31:20Z",
    "evidence_policy": "EP-04",
    "integrity_reference": "..."
  }
}
```

这里最重要的不是 JSON 具体字段名。

而是它把：

```text
Who
What
Why
How
Evidence
```

明确分开。

---

# 30. 为什么不应该把所有东西都存进一张表

一个常见反应是：

```text
CREATE TABLE agent_audit_log (...)
```

把所有字段塞进去。

这会很快出现：

```text
user
agent
model
prompt
tool
policy
approval
trade
payment
document
retrieval
external_reference
...
```

最终变成一张无法治理的“万能表”。

更合理的是：

```text
Actor
Decision
Policy Evaluation
Approval
Operation
Model Artifact
Input Provenance
Execution Event
External Outcome
Evidence Manifest
```

然后通过：

```text
case_id
decision_id
operation_id
trace_id
```

关联。

这样更接近一个：

```text
Evidence Graph
```

而不是：

```text
Audit Log Blob
```

---

# 31. Trace、Control Record、Business Record、Evidence Record 应该分层

推荐至少分成四类：

```text
1. Telemetry
2. Control Record
3. Business Record
4. Evidence Record
```

### Telemetry

```text
trace
span
log
metric
```

回答：

> 系统怎么运行？

### Control Record

```text
authorization
policy decision
approval
entitlement
risk check
```

回答：

> 为什么允许？

### Business Record

```text
trade
payment
order
vote
settlement
```

回答：

> 实际发生了什么？

### Evidence Record

```text
evidence_manifest
artifact references
integrity metadata
retention metadata
```

回答：

> 我们怎样证明前三类事实？

这四层可以共享基础设施，但语义不应该混为一谈。

---

# 32. Evidence Record 本身不是 Source of Truth

这是另一个重要边界。

例如：

```text
Evidence Manifest
business_outcome = FILLED
```

并不意味着：

```text
Evidence Store
```

就是交易的最终权威系统。

真正的权威系统可能是：

```text
OMS
Broker
Settlement
Ledger
```

因此 Evidence Store 更接近：

```text
proof index
+
retained evidence
```

而不是：

```text
business database
```

这样能够避免：

```text
复制了一份状态
```

逐渐变成：

```text
第二个业务事实源
```

---

# 33. Evidence 的可靠性需要来源层级

对于同一个事实：

```text
Order = FILLED
```

可能有：

```text
Agent trace
API response
OMS
Broker execution report
Settlement
```

不应该简单把它们当成同等权威。

建议至少区分：

```text
Authoritative
Primary Supporting
Observational
```

例如：

```text
Settlement record
    → Authoritative

Broker Execution Report
    → Primary Supporting

Agent Trace
    → Observational
```

PCAOB AS 1105 强调 evidence 的可靠性与其来源、独立性和相关 controls 有关；来自更独立、直接的来源通常具有更高可靠性。

因此：

> **Agent 记录自己“做了什么”，与业务系统证明“发生了什么”，应该是两份不同的证据。**

---

# 34. Why 也不能只来自 Agent

这一点非常重要。

例如：

```text
Agent:
“我选择这个交易，因为客户允许。”
```

这不能自动证明：

```text
客户 mandate = ALLOW
```

应该有独立的：

```text
Mandate Service
Policy Service
Entitlement Service
Risk Service
```

产生：

```text
ALLOW
```

并关联：

```text
decision_id
policy_version
evaluation_time
```

也就是说：

```text
Agent Explanation
```

是：

```text
supporting narrative
```

而：

```text
Policy Decision
```

才是：

```text
control evidence
```

---

# 35. 这也是为什么“Agent 自己生成 Audit Summary”不是最终方案

让 Agent 最后生成：

```text
“本次业务已经合规完成，原因如下……”
```

作为 audit record，很诱人。

但问题是：

```text
Agent
```

既是：

```text
被审计对象
```

又成为：

```text
证据解释者
```

这会造成证据独立性问题。

AWS Agentic AI Lens 特别强调，调查人员应当能够在不依赖 Agent 自己 account 的情况下重建历史行为。

所以可以让 Agent 生成：

```text
Human-readable Summary
```

但真正的 evidence 应由：

```text
control systems
+
workflow
+
business records
+
external systems
```

共同提供。

---

# 36. “Why”最好有两条线：Machine-verifiable 与 Human-readable

一个成熟系统可以同时保存：

```text
Why / Machine
```

和：

```text
Why / Human
```

例如：

```text
Machine-verifiable:

POLICY_PASS
MANDATE_PASS
LIMIT_PASS
CONFLICT_PASS
APPROVAL_PASS
```

以及：

```text
Human-readable:

“该操作符合客户授权范围，
并通过了适用的交易限制和冲突检查，
最终由主管批准。”
```

第一条负责：

```text
auditability
```

第二条负责：

```text
reviewability
```

不要让第二条替代第一条。

---

# 37. 这比保存长篇 Chain-of-Thought 更有意义

如果一笔金融决策的证据最后变成：

```text
LLM:
“首先，我认为……其次，我又想到……然后我推测……”
```

会出现几个问题：

```text
不可稳定验证
难以结构化查询
难以比较版本
难以证明因果关系
可能包含不必要敏感信息
```

BIS 对金融 AI explainability 的研究正好提醒了这一点：复杂模型的 post-hoc explanations 可能存在不准确、不稳定和误导风险。

因此：

> **金融 Agent 需要的是 Evidence-backed Decision Record，而不是把模型内部生成的所有文本都变成审计材料。**

---

# 38. Regulatory Evidence 还需要“完整性”和“完整覆盖”

这两个概念不能混淆。

### Integrity

> 已保存的信息有没有被修改？

### Completeness

> 应该保存的证据是不是都保存了？

例如：

```text
S3 Object Lock
+
Immutable Archive
```

可能保证：

```text
Integrity = High
```

但是：

```text
Approval record missing
External result missing
Policy version missing
```

则：

```text
Completeness = Low
```

仍然不够。

PCAOB 对公司生成数据的审计证据明确要求评估 accuracy、completeness 和 controls。

所以：

> **不可篡改的不完整记录，仍然是不完整的记录。**

---

# 39. 真实案例：为什么“记录缺失”本身就是金融风险

SEC 在 2022 年对 16 家华尔街机构的 recordkeeping failures 提起执法，机构合计支付超过 11 亿美元罚款。SEC 指出，这些机构及员工存在长期、广泛的电子通信保存失败。

2024 年 SEC 又对 12 家机构采取相关措施，合计民事处罚超过 8,800 万美元；同一财年，SEC 还表示针对 70 多家机构的 recordkeeping cases 产生超过 6 亿美元罚款，自 2021 年 12 月以来相关 initiative 涉及超过 100 家机构、超过 20 亿美元处罚。

这些案例并不是 AI Agent 案例，但对于 Agent 架构有一个非常直接的启示：

> **监管记录缺失本身就可能成为独立的治理问题。**

因此，如果 Agent 已经进入：

```text
Trade
Advisory
Customer Communication
Supervision
Investment Process
Proxy Voting
Financial Decision
```

不能假设：

```text
“我们有很好的 observability”
```

就自动解决 recordkeeping。

---

# 40. SEC Rule 17a-4 特别值得作为 Agent Evidence 的参考

SEC 对 broker-dealer electronic recordkeeping 的规则很有代表性。

当前规则保留了：

```text
WORM
```

作为方式之一，同时增加了：

```text
Audit-trail Alternative
```

这种方式要求保存完整、带时间戳的 audit trail，并能够记录：

```text
修改
删除
时间
身份
```

以及足够的信息来维护 record 的安全性、真实性和可靠性，并允许重建原始记录。SEC 同时要求在检查时能够以 reasonably usable electronic format 提供记录以及适用的 audit trail。

这对 Agent 有一个非常直接的启示：

> **不要只保存“当前 Agent State”，还要能够重建“历史发生过什么”。**

---

# 41. “Historical Reconstruction”应该成为核心能力

例如今天：

```text
Policy = v21
Agent = v5
Model = X2
Tool = v4
```

不能证明昨天：

```text
Policy = v19
Agent = v4
Model = X1
Tool = v3
```

因此至少要保存：

```text
artifact_id
version
effective_from
effective_to
hash
owner
approval
deployment_event
```

这样：

```text
Operation
```

可以关联：

```text
Agent v4
Policy v19
Model X1
```

形成真正的 point-in-time reconstruction。

---

# 42. How 还包括“配置”

一个常被遗漏的内容是：

```text
Configuration
```

例如：

```text
system prompt
tool routing
model routing
temperature
guardrails
retrieval threshold
tenant configuration
feature flags
```

不一定全部要永久保存。

但对高风险业务，至少需要能够定位：

```text
configuration snapshot
```

或者：

```text
configuration version
```

这样才能回答：

> 当时这个 Agent 的行为边界是什么？

---

# 43. Who / What / Why / How 最终应该拥有自己的 ID

推荐形成一个最小 ID 集：

```text
case_id
intent_id
decision_id
approval_id
operation_id
trace_id
external_reference
evidence_id
```

其中：

```text
case_id
```

代表业务案例。

```text
decision_id
```

代表一次关键决策。

```text
operation_id
```

代表一次业务副作用。

```text
trace_id
```

代表一次技术执行链。

```text
external_reference
```

代表外部系统中的权威引用。

```text
evidence_id
```

代表保存的证据对象。

这比：

```text
trace_id
```

承担所有职责合理得多。

---

# 44. 一个关键设计：Trace ID 不要成为业务主键

推荐：

```text
Business Operation
       │
       ├── Decision ID
       ├── Approval ID
       ├── Operation ID
       ├── External Reference
       └── one or more Trace IDs
```

因为一个业务操作可能经历：

```text
Agent run
↓
Queue
↓
Worker
↓
Vendor callback
↓
Reconciliation
```

完全可能存在多个 trace。

因此：

```text
Business Operation
```

应该高于：

```text
Technical Trace
```

---

# 45. 异步边界尤其重要

例如：

```text
Agent
  ↓
Kafka
  ↓
Worker
  ↓
Vendor
  ↓
Webhook
  ↓
Reconciliation
```

如果只靠 trace：

```text
Trace A
Trace B
Trace C
Trace D
```

很容易断掉。

所以必须有一个：

```text
business_correlation_id
```

或者：

```text
operation_id
```

贯穿整个生命周期。

AWS Agentic AI Lens 已明确提出独立于 tracing system 的 correlation identifier，并要求它跨 asynchronous boundaries 传播。

---

# 46. 金融 Agent 的 Data Provenance 还应该包括 Entitlement

例如 Agent 读取：

```text
Client Portfolio
```

不仅要记录：

```text
source = Portfolio DB
```

最好还能够关联：

```text
entitlement_check_id
entitlement_policy_version
decision = ALLOW
```

这样以后才能回答：

> Agent 当时为什么有权看到这些数据？

这就是：

```text
What data?
+
Why allowed?
```

两个问题同时被解决。

---

# 47. Data Provenance 还应该考虑 Transformation

例如：

```text
Raw Market Data
   ↓
Normalize
   ↓
Aggregate
   ↓
Feature
   ↓
RAG Context
   ↓
Agent
```

只记录：

```text
final_input
```

可能无法说明：

```text
这个数据怎么来的？
```

NIST AI RMF 对 data provenance 的建议明确涵盖 sources、origins、transformations、dependencies、constraints 和 metadata。

所以高风险金融 Agent 如果依赖经过处理的数据，应该至少保留：

```text
source
transformation
version
timestamp
```

以及必要的 hash / lineage reference。

---

# 48. “Who”还包括第三方

越来越多金融 Agent 依赖：

```text
LLM Vendor
RAG Vendor
Cloud Provider
External Research Vendor
Broker
Payment Provider
```

那么：

```text
Who
```

也可能变成：

```text
Which third party provided the capability?
Which deployment?
Which contract/service version?
```

BIS 的金融 AI 研究反复强调第三方 AI、数据和技术服务带来的 governance 和 operational risk；美联储 2026 年修订的模型风险指导也明确要求银行理解并验证 vendor products，并对定制、验证和持续监控保持适当记录。

因此：

```text
vendor_model
vendor_service_version
vendor_reference
```

都可能成为重要证据。

---

# 49. Third-party observability ≠ your regulatory evidence

例如 Vendor 告诉你：

```text
“我们有完整 tracing。”
```

企业仍然需要问：

```text
Who owns the records?
Who can delete them?
How long retained?
Can we independently access them?
Can we export them?
Can we reconstruct historical state?
Can the vendor alter the record?
What happens after the contract ends?
```

SEC Rule 17a-4 对第三方保存 broker-dealer 记录本身就有独立 access 和 production 方面的要求。

因此：

> **第三方提供 observability capability，不等于它自动满足金融机构自己的 recordkeeping obligation。**

---

# 50. “Why”还需要区分规则与判断

例如：

```text
Policy Rule:
client mandate allows FOR

Agent Judgment:
based on available evidence, FOR is appropriate
```

这两件事不应混为一谈。

推荐记录：

```text
rules_applied
policy_results
agent_decision
human_decision
```

而不是：

```text
reason = "LLM thought this was best"
```

这样未来可以分别检查：

```text
规则是否正确？
Agent 是否正确应用规则？
人是否正确批准？
```

---

# 51. Human override 是重要的 What / Who / Why / How

例如：

```text
Agent recommends SELL
Human overrides to HOLD
```

这应该记录成：

```text
Agent Decision:
SELL

Human Decision:
HOLD

Override Actor:
USER-456

Override Reason:
CLIENT_EXCEPTION

Approval:
APPROVED
```

否则最后只看到：

```text
HOLD
```

就无法解释：

> Agent 到底有没有提出不同方案？

FINRA 2026 年报告对 human-in-the-loop 和 tracking agent actions / decisions 的强调，正是这一类控制需求的现实体现。

---

# 52. Audit Evidence 不应该只记录“最终结果”

例如：

```text
Trade = Filled
```

审计仍然可能关心：

```text
谁发起？
谁授权？
为什么下这个订单？
限制检查是否通过？
Agent 看到了什么？
有没有人工 override？
发送过几次？
是否出现过 timeout？
哪个 broker reference 对应它？
```

所以：

```text
Outcome
```

只是 Evidence Chain 的最后一个节点。

---

# 53. 一笔业务操作的最小 Evidence Chain

对于金融 Agent，可以把最小链条定义成：

```text
1. Intent
2. Identity
3. Authorization
4. Policy Decision
5. Decision
6. Approval
7. Execution
8. External Confirmation
9. Final Outcome
```

再根据 Use Case 增加：

```text
Input Provenance
Model Metadata
Tool Metadata
Recovery
Human Intervention
```

这比：

```text
保存所有 Agent logs
```

更容易治理。

---

# 54. 为什么 Evidence Requirement 应该从 Business Action 反推

不要先规定：

```text
所有 Agent 都必须记录：
100 个字段
```

应该从：

```text
Business Action
```

出发。

例如：

### Read-only Research Agent

可能只需要：

```text
Who
What data accessed
Why access allowed
How retrieved
```

### Trade Agent

需要：

```text
Who
What
Why
How
Approval
Policy
Risk Checks
External Outcome
Recovery
```

### Customer-facing Advisory Agent

可能重点是：

```text
Who
What advice
Why
Source provenance
Model version
Human escalation
Customer communication record
```

所以：

> **Evidence schema 应该 Risk-based，而不是 Agent-wide one-size-fits-all。**

NIST AI RMF 强调应根据风险容忍度、用途、影响和生命周期建立适当的治理和文档，而不是把同一套控制无差别应用于所有 AI 系统。

---

# 55. 可以建立一个 Agent Evidence Profile

例如：

```yaml
agent: proxy-vote-agent

risk:
  tier: high

business_actions:
  - submit_vote

evidence:
  who:
    - initiator
    - approver
    - executor

  what:
    - instruction
    - security
    - meeting
    - resolution
    - external_outcome

  why:
    - client_mandate
    - policy_decision
    - conflict_check

  how:
    - agent_version
    - model_version
    - prompt_version
    - tool_version
    - source_versions
    - external_reference

integrity:
  tamper_evident: true

reconstruction:
  required: true
```

这样平台就可以根据：

```text
Evidence Profile
```

自动生成：

```text
capture rules
retention
correlation
access control
evidence manifest
```

---

# 56. 记录什么，最终取决于“未来要证明什么”

这是一个非常重要的架构原则：

> **Evidence 是由未来的 Claim 反推出来的。**

例如要证明：

```text
“这次交易经过授权。”
```

需要：

```text
Actor
+
Authorization
+
Approval
```

要证明：

```text
“Agent 当时使用的 Policy 是合法版本。”
```

需要：

```text
Policy Version
+
Effective Time
+
Approval / Release
```

要证明：

```text
“这笔订单最终确实执行。”
```

需要：

```text
Operation ID
+
External Reference
+
Authoritative Outcome
```

要证明：

```text
“Agent 的判断来自被允许的数据。”
```

需要：

```text
Source Provenance
+
Entitlement Decision
```

这就是：

```text
Claim → Evidence
```

设计方法。

---

# 57. 因此建议建立 Evidence Catalog

例如：

| Claim        | Required Evidence                         |
| ------------ | ----------------------------------------- |
| 谁发起          | Identity / Session / Event                |
| 谁批准          | Approval Record                           |
| Agent 有权访问数据 | Entitlement Decision                      |
| 为什么允许交易      | Policy Decision                           |
| 用了哪个模型       | Model Version                             |
| 用了什么数据       | Data Provenance                           |
| 做了什么动作       | Operation Record                          |
| 调用了哪个 Tool   | Tool Event                                |
| 外部是否执行       | External Reference / Authoritative Record |
| 最终结果是什么      | Business System of Record                 |
| 谁进行人工干预      | Intervention Record                       |
| 当时规则是什么      | Versioned Policy                          |
| 记录有没有被修改     | Integrity / Audit Trail                   |

这样 Audit Evidence 设计就从：

```text
Log Collection
```

变成：

```text
Evidence Mapping
```

---

# 58. 一个非常关键的原则：不要把“完整日志”误认为“完整证据”

假设：

```text
10 TB Logs
```

但缺：

```text
Approval
Policy
External Outcome
Data Provenance
```

那么：

```text
Evidence Completeness = low
```

相反：

```text
100 MB well-structured records
```

如果恰好包含：

```text
Intent
Identity
Policy
Approval
Decision
Execution
Outcome
```

反而可能更有用。

PCAOB AS 1105 对 audit evidence 的表述很明确：增加同一类低质量 evidence 的数量不能简单弥补其质量不足。

因此：

> **Evidence Quality > Evidence Volume。**

---

# 59. Regulatory Evidence 需要独立的生命周期

Telemetry：

```text
High volume
Short retention
Sampling
Aggregation
Deletion
```

Evidence：

```text
Policy-driven capture
Long-term retention
Integrity protection
Legal hold
Version preservation
Controlled access
Production
```

这两个 lifecycle 不应该强行统一。

SEC 17a-4 就体现了这一点：监管记录有明确的保存、完整审计轨迹以及按要求以 reasonably usable electronic format 提供的要求。

---

# 60. Evidence Store 应该独立于 Agent 的权限边界

一个简单但重要的架构：

```text
Agent
  │
  │ emit
  ▼
Evidence Collector
  │
  ▼
Evidence Store
```

而不是：

```text
Agent
  │
  ▼
Agent-controlled database
```

原因很简单：

```text
Agent
```

不应该能够：

```text
rewrite its own history
delete unfavorable records
```

AWS Agentic AI Lens 对这一点非常明确：decision artifacts 应进入 agent operational scope 之外、具有 tamper-evident controls 的存储。

---

# 61. 但“不可删”也需要配套治理

真正的 Evidence Store 还需要：

```text
Access Control
Encryption
Retention
Legal Hold
Deletion Policy
Audit of Evidence Access
```

因为：

```text
Regulatory evidence
```

同时也是：

```text
Sensitive enterprise data
```

不能因为为了审计就永久保存所有：

```text
Prompt
Customer Data
LLM Context
Tool Payload
```

正确的方法是：

```text
Classify
→ Minimize
→ Protect
→ Retain according to purpose
```

而不是：

```text
Store everything forever
```

---

# 62. How 要记录“数据版本”，而不是只记录 Data ID

例如：

```text
Research Report = R123
```

今天：

```text
R123 = v6
```

但交易发生时：

```text
R123 = v4
```

如果只保存：

```text
source_id = R123
```

事后无法重建。

因此：

```text
source_id
source_version
retrieved_at
content_hash
```

通常比：

```text
source_id
```

有更高证据价值。

---

# 63. How 还要记录时间语义

金融系统里：

```text
event_time
ingestion_time
processing_time
```

可能不同。

例如：

```text
Approval event:
10:01:02

Agent receives:
10:01:08

Order submitted:
10:01:10
```

因此至少要区分：

```text
event_time
recorded_at
```

不要把：

```text
日志写入时间
```

误认为：

```text
业务发生时间
```

对于监管调查尤其重要。

---

# 64. Evidence Chain 需要支持“反向查询”

工程 Observability 经常是：

```text
Trace → spans
```

监管调查更常见的是：

```text
Business Case
    ↓
What happened?
    ↓
Who?
Why?
How?
```

所以 Evidence Platform 应支持：

```text
case_id
client_id
transaction_id
order_id
meeting_id
operation_id
```

反向追踪到：

```text
decision
approval
agent run
trace
tool calls
external system
```

而不是要求审计人员先知道：

```text
trace_id
```

---

# 65. 一个很实用的“Evidence Reconstruction Test”

不要只测试：

```text
“LangSmith 查不到了怎么办？”
```

而应该定期做：

> **Random Historical Case Reconstruction**

随机抽取一笔：

```text
Trade
Payment
Proxy Vote
Advisory
Account Change
```

只提供：

```text
case_id
```

然后让一个没有参与开发的人回答：

```text
Who initiated it?
Who approved it?
What happened?
Why was it allowed?
What data were used?
Which model was used?
Which policy version applied?
Which tools were invoked?
What external system confirmed the result?
Were there retries or manual interventions?
Can every important claim be backed by evidence?
Can the historical configuration be reproduced?
```

这比：

```text
Trace Coverage = 99%
```

更能说明系统是否真的具备审计能力。

---

# 66. 这也是“AI Auditability”应该测量的对象

可以定义一个内部成熟度维度：

```text
Identity Coverage
Decision Coverage
Policy Coverage
Data Provenance Coverage
Execution Coverage
Outcome Coverage
Version Coverage
Integrity Coverage
Retention Coverage
Reconstruction Coverage
```

例如：

```text
Identity Coverage     100%
Policy Coverage        98%
Outcome Coverage       91%
Provenance Coverage    87%
Reconstruction         85%
```

比：

```text
Trace Coverage = 99%
```

更有意义。

这不是监管机构规定的统一 KPI，而是一种架构治理方法。

---

# 67. 一个成熟平台应该提供 Evidence API，而不是只提供 Trace API

例如：

```text
GET /cases/{caseId}/evidence
```

返回：

```text
Intent
Actor
Approval
Policy
Decision
Agent
Model
Sources
Tool Calls
External References
Outcome
Recovery
Integrity
```

而不是：

```text
GET /traces/{traceId}
```

然后让合规团队自己拼出业务事实。

Trace API 仍然应该存在。

但：

```text
Trace API
```

服务：

```text
Engineering / SRE
```

而：

```text
Evidence API
```

服务：

```text
Audit / Compliance / Legal / Operations
```

---

# 68. Evidence Manifest 可以作为两个世界之间的桥梁

推荐每一个高风险业务操作生成一个：

```text
Evidence Manifest
```

它不取代原始系统，而是告诉调查人员：

```text
这一项业务事实，
由哪些系统的哪些记录共同证明。
```

例如：

```text
Evidence Manifest
│
├── Approval Record #A123
├── Policy Decision #P456
├── Agent Run #R789
├── Tool Event #T001
├── External Broker Record #B999
└── Settlement Record #S222
```

这样：

```text
Observability
```

只是 Manifest 中的一部分。

---

# 69. 为什么 Evidence Manifest 比“大日志文件”更适合审计

因为监管问题通常是：

```text
“给我证明这个结论的材料。”
```

而不是：

```text
“给我过去六个月所有 Agent logs。”
```

Evidence Manifest 直接表达：

```text
Claim
  ↓
Supporting Evidence
```

例如：

```text
Claim:
Trade was authorized.

Evidence:
Approval A123
Policy Decision P456
Entitlement E777
```

这种结构更符合实际调查方式。

---

# 70. 第三方模型尤其需要 Evidence Boundary

如果：

```text
Bank
 ↓
Internal Agent
 ↓
External LLM
```

至少需要明确：

```text
Internal Evidence
External Evidence
```

内部可以记录：

```text
prompt_hash
model_version
request_time
request_id
```

外部可能提供：

```text
provider_request_id
model_release
safety_metadata
```

然后形成：

```text
Agent Decision
   ↓
Vendor Model Invocation
   ↓
Vendor Evidence Reference
```

如果 vendor 无法提供某些信息，就必须明确：

```text
Evidence Gap
```

而不是假设：

```text
“vendor 有 logs，所以不用管。”
```

美联储 2026 年模型风险指导明确指出第三方模型的 proprietary code/data/methodology 会增加验证挑战，但金融机构仍需建立适当的理解、验证和持续监控能力。

---

# 71. Evidence Gap 本身也应该被记录

例如：

```text
model reasoning = unavailable
```

或者：

```text
external vendor reference = unavailable
```

不要简单忽略。

更合理的是：

```text
evidence_gap:
  type: EXTERNAL_MODEL_METADATA
  severity: MEDIUM
  reason: PROVIDER_LIMITATION
  compensating_control:
    - HUMAN_REVIEW
    - RETAIN_INPUT_OUTPUT
```

这比：

```text
field = null
```

有治理价值。

---

# 72. Why / How 还应该记录“限制和不确定性”

金融 AI 并不是只记录：

```text
decision = BUY
```

也应该记录：

```text
limitations
confidence
uncertainty
data gaps
human escalation
```

但要注意：

> 不要把模型随意输出的“confidence = 0.93”当成真实风险概率。

更合理的是记录：

```text
risk_flags
known_limitations
missing_data
escalation_required
```

因为金融 AI 的 explainability 和 uncertainty 本身存在挑战，BIS 也强调复杂 AI 的解释局限性。

---

# 73. 人工审批应该是结构化证据，不应该只是“有一封邮件”

例如：

```text
Subject:
Approved.
```

不够。

应该结构化：

```text
approval_id
approver_id
approval_type
approved_object
approval_scope
decision
timestamp
policy
comments
```

邮件、Teams 等可以作为 supporting artifact，但：

```text
Approval Record
```

应该成为正式业务对象。

这样才能回答：

```text
Who?
What?
Why?
When?
```

---

# 74. 人工 Override 也是一项业务操作

例如：

```text
Agent decision = Reject
Human override = Approve
```

这是一个重要业务事实。

建议：

```text
override_id
original_decision
new_decision
actor
authority
reason
timestamp
case_id
```

否则：

```text
最终结果 = APPROVED
```

却无法知道：

```text
Agent 原本其实不同意。
```

---

# 75. Evidence Architecture 应该和 Workflow Architecture 一致

Workflow 已经有：

```text
Case
Step
State
Operation
Approval
Recovery
```

Evidence 应该跟着这些实体走。

例如：

```text
Workflow
   │
   ├── Step
   │    └── Decision
   │         └── Evidence
   │
   ├── Approval
   │    └── Evidence
   │
   └── Operation
        └── External Evidence
```

这样：

```text
Workflow State
```

和：

```text
Evidence State
```

不会脱节。

---

# 76. 不要让 Agent Memory 承担 Evidence

例如：

```text
Agent memory:
“我已经批准这个交易。”
```

不能当作：

```text
Approval Record
```

因为 Memory 是：

```text
context
```

而不是：

```text
authority
```

真正的证据必须来自：

```text
Approval Service
Policy Engine
Business System
External System
```

这也是企业 Agent 架构里：

```text
Memory
≠
Business State
≠
Audit Evidence
```

的一个具体体现。

---

# 77. AI Governance 也应该进入 Evidence Chain

一个 Agent 的一次业务决策之外，还存在：

```text
Model Approval
Agent Approval
Policy Approval
Deployment Approval
```

这些是生命周期控制证据。

NIST AI RMF 将 governance 作为贯穿 AI lifecycle 的 cross-cutting function，并强调 roles、documentation、accountability、data provenance、model documentation 和 AI system auditability。

美联储 2026 年 Model Risk Management 指导同样要求明确的 roles and responsibilities、validation、ongoing monitoring、documentation，以及对 vendor models 的治理。

因此：

```text
Runtime Evidence
```

只是：

```text
AI Governance Evidence
```

中的一部分。

---

# 78. 可以把 Evidence 分为四个时间维度

一个完整金融 Agent 的 evidence 可以分成：

```text
Before
During
After
Lifecycle
```

### Before

```text
Model approval
Agent approval
Policy approval
Tool approval
Risk assessment
```

### During

```text
Identity
Input
Decision
Policy
Approval
Tool
Data
Model
Execution
```

### After

```text
Outcome
Settlement
Reconciliation
Incident
Manual Intervention
```

### Lifecycle

```text
Change
Validation
Monitoring
Retirement
Vendor Review
```

这样才真正覆盖：

```text
AI System Lifecycle
+
Business Execution Lifecycle
```

---

# 79. 金融 Agent 的监管证据本质上是两个时间轴的交叉

第一条：

```text
AI Lifecycle
Design
Approve
Deploy
Change
Monitor
Retire
```

第二条：

```text
Business Lifecycle
Intent
Decision
Approve
Execute
Settle
Recover
Close
```

真正完整的证据是：

```text
AI Lifecycle
        ×
Business Lifecycle
```

例如：

```text
Trade on Sep 20
↓
Agent v4
↓
Model release X
↓
Policy v17
↓
Deployment approved Sep 10
↓
Execution Sep 20
↓
Settlement Sep 21
```

这才可以回答：

> 当这个业务动作发生时，AI 系统处于什么受控状态？

---

# 80. “Who / What / Why / How”最终应该形成一个最小模型

可以把金融 Agent 的 Evidence Model 浓缩为：

```text
WHO
├── Initiator
├── Approver
├── Executor
├── Reviewer
└── Authority

WHAT
├── Intent
├── Decision
├── Action
├── Data Access
├── Tool Invocation
└── Business Outcome

WHY
├── Business Intent
├── Policy
├── Authorization
├── Risk Checks
├── Decision Factors
└── Human Override

HOW
├── Agent Version
├── Model Version
├── Prompt/Config Version
├── Workflow Version
├── Data Provenance
├── Tool Version
├── External System
└── Recovery Path
```

然后再加一个横向层：

```text
EVIDENCE
├── Timestamp
├── Correlation IDs
├── Integrity
├── Retention
├── Source Authority
├── Version
└── Reconstruction
```

这就是一个比较完整的 Financial Agent Evidence Model。

---

# 81. 哪些数据应该直接记录，哪些应该只记录引用

不是所有数据都应该完整复制。

例如：

```text
Customer Portfolio
```

可能已经在：

```text
Portfolio System
```

保存。

Agent Evidence 不一定需要再复制整个 Portfolio。

可以保存：

```text
portfolio_snapshot_id
version
source_system
retrieved_at
hash
```

然后：

```text
Evidence
   ↓
Reference
   ↓
Authoritative Record
```

这样可以减少：

```text
duplication
privacy exposure
storage
```

同时保持：

```text
traceability
```

---

# 82. Evidence 的设计应该遵循“Reference First”

因此对于大型金融企业，更合理的是：

```text
Evidence
=
structured metadata
+
references
+
hashes
+
critical immutable artifacts
```

而不是：

```text
Evidence
=
copy all enterprise data
```

例如：

```text
client_id
order_id
policy_version
approval_id
source_id
source_version
hash
```

然后通过企业授权系统访问原始数据。

---

# 83. 但关键时点的记录要避免“未来可能变了”

例如：

```text
Policy v17
```

如果未来：

```text
Policy v17
```

的实际存储对象被覆盖，就失去了 point-in-time evidence。

所以关键 Artifact 至少需要：

```text
versioned immutable reference
```

或者：

```text
content hash
```

以保证：

```text
“当时是什么”
```

不会被：

```text
“现在是什么”
```

覆盖。

---

# 84. Evidence Integrity 可以设计成 Hash Chain，但不要误解其作用

对于内部高风险记录，可以采用：

```text
Event 1
 hash1

Event 2
 hash2 = H(event2 + hash1)

Event 3
 hash3 = H(event3 + hash2)
```

形成：

```text
hash chain
```

这有助于发现：

```text
missing
reordered
tampered
```

但需要强调：

> Hash chain 证明的是记录之间的完整性关系，不自动证明记录内容本身就是正确的业务事实。

如果：

```text
source system
```

一开始就产生错误数据，

那么：

```text
perfectly immutable evidence
```

仍然可能是错误事实。

因此：

```text
Integrity
+
Source Reliability
+
Completeness
```

必须同时考虑。

---

# 85. Evidence 的 Source Reliability 不应被忽略

PCAOB 对 evidence 的 Reliability 明确区分：

```text
internal source
external source
independent source
direct evidence
indirect evidence
```

并指出公司生成的信息只有在相应 controls 有效时，其可靠性才会更高。

对金融 Agent，可以类比为：

```text
Agent Self-report
    ↓
low

Agent Trace
    ↓
supporting

Policy Engine Record
    ↓
control evidence

Broker Execution Report
    ↓
external primary evidence

Settlement Ledger
    ↓
authoritative business fact
```

具体层级要根据业务系统决定，但这一思想非常重要。

---

# 86. Evidence 与 Regulatory Mapping 应该显式关联

例如：

```text
Evidence Policy
EP-TRADE-01
```

关联：

```text
Regulation / Rule
Record Type
Retention Class
Control Requirement
```

这样以后法规变化：

```text
Regulation changes
```

不需要从所有 Agent 代码里找：

```text
“哪些地方要记录什么？”
```

而是修改：

```text
Evidence Policy
```

这也是为什么：

> Evidence 应该是 Control Plane 的能力，而不是 Tool 的附属功能。

---

# 87. 对 Agent Platform，最合理的架构不是“Central Audit Log”

而是：

```text
Central Evidence Control Plane
```

它负责：

```text
evidence policy
schema
classification
routing
correlation
integrity
retention
search
reconstruction
```

而不是：

```text
把所有应用日志集中进一个 Elasticsearch
```

两者完全不同。

---

# 88. 一个推荐的整体架构

```text
                         ┌──────────────────┐
                         │      Human       │
                         └────────┬─────────┘
                                  │
                                  ▼
                         ┌──────────────────┐
                         │      Agent       │
                         └────────┬─────────┘
                                  │
                   ┌──────────────┼──────────────┐
                   │              │              │
                   ▼              ▼              ▼
               Model/RAG       Policy         Tools
                   │              │              │
                   └──────────────┼──────────────┘
                                  │
                                  ▼
                          Business Workflow
                                  │
                 ┌────────────────┼────────────────┐
                 │                │                │
                 ▼                ▼                ▼
             Approval          Operation       Human Override
                 │                │                │
                 └────────────────┼────────────────┘
                                  │
                                  ▼
                           External System
                                  │
                                  ▼
                       Authoritative Outcome
                                  │
        ┌─────────────────────────┴─────────────────────┐
        │                                               │
        ▼                                               ▼
Observability                                      Evidence Events
        │                                               │
        ▼                                               ▼
Telemetry Store                              Evidence Control Plane
                                                    │
                          ┌─────────────────────────┼───────────────┐
                          ▼                         ▼               ▼
                    Policy Records           Business Records   External Records
                          │                         │               │
                          └─────────────────────────┼───────────────┘
                                                    ▼
                                           Evidence Manifest
                                                    │
                                                    ▼
                                      Audit / Compliance / Legal
```

其中：

```text
Observability
```

解决：

```text
How did the system behave?
```

而：

```text
Evidence Control Plane
```

解决：

```text
How can we prove what happened?
```

---

# 89. 一个关键的设计原则：Agent 不应该拥有“证据真相权”

Agent 可以产生：

```text
proposal
explanation
summary
```

但它不应该单独决定：

```text
approval
policy result
authorization result
business outcome
```

这些都应该来自：

```text
authoritative control/business systems
```

这与 BIS 近年来对金融 AI accountability 的强调高度一致：AI 可以支持决策，但责任仍在金融机构和人类治理体系，而不能由模型或供应商承担。

---

# 90. 监管真正关心的通常不是“Agent 有没有 Thought”

而是：

```text
Who was responsible?
What happened?
Why was it allowed?
What controls existed?
Can the firm demonstrate that?
```

因此金融 Agent 设计不需要把监管需求误解成：

```text
“必须把模型全部内部思考保存下来。”
```

更合理的是：

```text
Decision
+
Evidence-backed Factors
+
Policy
+
Authorization
+
Human Oversight
+
Outcome
```

这同时比单纯保存 Chain-of-Thought 更容易实现，也更容易长期治理。

---

# 91. 最终的 Architecture Review Checklist

任何一个金融 Agent 上生产前，至少应该能够回答：

## Who

```text
谁触发？
谁授权？
谁批准？
哪个 Agent 执行？
谁人工干预？
```

## What

```text
执行了什么业务动作？
访问了什么数据？
调用了哪些 Tool？
改变了什么状态？
最终业务结果是什么？
```

## Why

```text
业务意图是什么？
适用什么 Policy？
授权依据是什么？
哪些风险检查通过？
哪些事实构成 Decision Basis？
是否有人批准或 Override？
```

## How

```text
用了什么 Agent？
什么 Model？
什么版本？
什么 Prompt / Configuration？
什么 Workflow？
什么 Tool？
什么 Data Source？
什么 Retrieval Index？
什么 External System？
是否发生 Retry / Recovery？
```

## Evidence

```text
这些信息来自哪里？
哪个系统是权威来源？
有没有 version？
有没有 timestamp？
有没有 integrity protection？
有没有 retention policy？
几年以后还能不能重建？
```

最后一个问题尤其重要：

> **如果 Agent 自己的日志全部不可信，我们还能不能从其他系统重建这次业务行为？**

如果答案是：

```text
可以
```

说明 Evidence Architecture 已经比较成熟。

如果答案是：

```text
不行，只能相信 Agent trace
```

那么系统仍然高度依赖被审计对象自身的叙述。

---

# 92. 一个更实际的成熟度模型

可以把金融 Agent 的审计能力分成五级。

### Level 1：Log

```text
Agent started
Tool called
Response returned
```

只能基本排错。

### Level 2：Trace

```text
LLM
RAG
Tool
Workflow
```

可以重建技术执行路径。

### Level 3：Control Trace

增加：

```text
Identity
Policy
Approval
Entitlement
Model Version
```

开始能够解释为什么允许。

### Level 4：Business Evidence

增加：

```text
Business Operation
External Reference
Authoritative Outcome
Data Provenance
Human Intervention
Recovery
```

能够支撑完整业务调查。

### Level 5：Regulatory Evidence Architecture

进一步具备：

```text
Retention
Legal Hold
Tamper Evidence
Historical Reconstruction
Evidence Manifest
Regulatory Mapping
Independent Evidence Authority
Production Workflow
Testing
```

这才接近真正的监管级 evidence capability。

---

# 93. 一个非常重要的现实判断

并不是所有金融 Agent 都需要 Level 5。

例如：

```text
内部会议摘要 Agent
```

和：

```text
自动提交证券交易 Agent
```

不能使用同一套证据要求。

真正合理的设计是：

```text
Risk Tier
      ↓
Business Action
      ↓
Evidence Profile
      ↓
Required Evidence
```

而不是：

```text
所有 Agent 一律保存全部数据
```

这样才能在：

```text
Compliance
Privacy
Cost
Performance
Auditability
```

之间取得可管理的平衡。

---

# 94. 最后的核心结论

“Who / What / Why / How”看起来只是四个简单的问题，但对金融 Agent 来说，它们实际上对应一整套架构。

```text
Who
=
Identity + Authority + Accountability

What
=
Intent + Action + Data Access + Business Outcome

Why
=
Policy + Authorization + Risk Checks + Decision Factors

How
=
Agent + Model + Version + Data + Workflow + Tool + External System

Evidence
=
Provenance + Integrity + Retention + Reconstruction + Source Authority
```

所以一个金融 Agent 最终不应该只有：

```text
Trace
```

而应该形成：

```text
Intent
  ↓
Actor
  ↓
Authorization
  ↓
Policy
  ↓
Decision
  ↓
Approval
  ↓
Agent Execution
  ↓
Data / Model / Tool Provenance
  ↓
Business Operation
  ↓
External Confirmation
  ↓
Final Outcome
  ↓
Evidence Manifest
```

这张链才是：

> **Financial Agent Evidence Chain。**

---

# 95. 最终架构原则

可以把全文归纳成十二条。

### 1. 不要从“我要记录什么日志”开始

从：

> **我要证明什么 Claim？**

开始。

---

### 2. Who / What / Why / How 必须独立建模

不要把所有信息塞进一个：

```text
trace metadata
```

---

### 3. Trace ID 不是业务主键

至少需要：

```text
case_id
decision_id
operation_id
trace_id
external_reference
```

---

### 4. What 必须落到 Business Outcome

```text
Agent observed
```

不等于：

```text
Business fact
```

---

### 5. Why 不等于 Chain-of-Thought

应该优先记录：

```text
Policy
Authorization
Decision Factors
Source References
Human Approval
```

而不是把所有模型内部 reasoning 当成最终监管解释。复杂 AI 的解释本身可能不稳定或误导。

---

### 6. How 必须能够做 Point-in-Time Reconstruction

要能够回答：

```text
当时用了什么 Agent / Model / Policy / Tool / Data？
```

而不是：

```text
现在系统是什么版本？
```

---

### 7. Data Provenance 是核心证据

至少要能够定位：

```text
Source
Version
Retrieved At
Transformation
Entitlement
```

NIST AI RMF 也将 data provenance、documentation、accountability 和 auditability 作为 AI governance 的重要组成部分。

---

### 8. Authoritative Business Record 优先于 Agent Self-report

Agent Trace 是：

```text
supporting evidence
```

不是所有业务事实的：

```text
source of truth
```

---

### 9. Evidence 必须独立于 Agent 的控制范围

Agent 可以：

```text
emit
```

但不应该：

```text
rewrite
delete
```

关键历史证据。AWS Agentic AI Lens 对此明确提出 tamper-evident、agent-independent storage 和 historical reconstruction。

---

### 10. 完整性和完整覆盖是两个问题

```text
Immutable
```

不等于：

```text
Complete
```

---

### 11. Regulatory Evidence 应该是 Control Plane 能力

而不是：

```text
Agent Runtime feature
```

---

### 12. 最重要的测试不是“Trace 能不能查”

而是：

> **只给一个历史 Business Case ID，能不能完整回答 Who / What / Why / How，并且每一个关键答案都能指向可信证据？**

---

# 96. 最后的判断

金融 Agent 最终需要建立的，不是一个更复杂的：

```text
AI Logging System
```

而是一套：

```text
Business Evidence Architecture
```

它应该把：

```text
Human
Agent
Model
Policy
Data
Tool
Workflow
Approval
External System
Business Outcome
```

连接成一个可验证、可重建、可治理的证据链。

因此，真正成熟的系统应该能够从：

```text
Case ID
```

出发，一直回答：

```text
WHO
谁发起、谁批准、谁执行、谁负责？

WHAT
做了什么、访问了什么、改变了什么、最终发生了什么？

WHY
为什么做、依据什么 Policy、通过了什么控制、谁授权？

HOW
用了哪个 Agent、Model、Version、Data、Tool、Workflow、External System？
```

然后再进一步回答：

```text
PROVE
这些信息来自哪里？
为什么这些来源可信？
是否完整？
是否被保护？
能否长期保存？
五年以后还能不能重建？
```

这才是金融 Agent 真正意义上的 **Auditability**。

而不是：

```text
“我们有 LangSmith。”
“我们有 OpenTelemetry。”
“我们可以看到所有 Tool Calls。”
“我们有完整 Trace。”
```

这些都是很重要的基础能力，但它们回答的主要还是：

> **系统发生了什么。**

金融监管、审计和内部控制真正需要的是更进一步：

> **企业能否证明当时究竟发生了什么、是谁负责、为什么被允许、通过什么控制、最终产生了什么业务结果。**

因此，最值得沉淀成企业 Agent 平台标准的，不是一个巨大的 Audit Log Schema，而是：

```text
Evidence Policy
        ↓
Evidence Profile
        ↓
Evidence Events
        ↓
Evidence Manifest
        ↓
Historical Reconstruction
```

再通过：

```text
case_id
decision_id
operation_id
trace_id
external_reference
```

把：

```text
Agent Runtime
+
Control Plane
+
Business Systems
+
External Systems
```

真正连接起来。

最终可以把整个原则压缩成一句话：

> **金融 Agent 记录的不是“它当时想了什么”，而是要留下足够可信的证据，证明“谁，在什么授权和控制下，基于什么信息，让 Agent 以什么方式做了什么，并最终产生了什么业务结果”。**

这才是回答 **Who / What / Why / How** 的真正含义。

---

# 参考资料

1. **PCAOB AS 1105 — Audit Evidence**
   关于 audit evidence 的 sufficiency、relevance、reliability，以及企业生成信息的 accuracy、completeness 和 IT controls。
   [PCAOB — AS 1105: Audit Evidence](https://pcaobus.org/oversight/standards/auditing-standards/details/AS1105)

2. **AWS Well-Architected Agentic AI Lens — Agent observability and non-repudiation**
   关于 Agent 行为记录、initiating source、独立于 trace ID 的 correlation identifier、tamper-evident storage 和历史重建。
   [AWS — Agent observability and non-repudiation](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentsec05.html)

3. **AWS Well-Architected Agentic AI Lens — Observability and Monitoring**
   关于 Agent tracing、decision path、tool invocation、structured logging 和 behavioral monitoring。
   [AWS — Agentic AI Lens](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/)

4. **FINRA — GenAI: Continuing and Emerging Trends, 2026 Annual Regulatory Oversight Report**
   关于金融机构使用 GenAI 时的 supervision、communications、recordkeeping，以及 Agent system access、data handling、human oversight、agent actions and decisions。
   [FINRA — GenAI: Continuing and Emerging Trends](https://www.finra.org/rules-guidance/guidance/reports/2026-finra-annual-regulatory-oversight-report/gen-ai)

5. **SEC — Amendments to Electronic Recordkeeping Requirements for Broker-Dealers**
   关于 WORM、audit-trail alternative、完整时间戳 audit trail、修改/删除记录、身份、真实性、可靠性和监管要求下的 electronic production。
   [SEC — Electronic Recordkeeping Requirements](https://www.sec.gov/investment/amendments-electronic-recordkeeping-requirements-broker-dealers)

6. **SEC — 16 Wall Street Firms Recordkeeping Failures, 2022**
   16 家金融机构因广泛的电子通信 recordkeeping failures 被处罚，合计罚款超过 11 亿美元。
   [SEC — 2022 Recordkeeping Enforcement](https://www.sec.gov/newsroom/press-releases/2022-174)

7. **SEC — FY2024 Enforcement Results**
   2024 财年，SEC 针对 70 多家机构的 recordkeeping cases 产生超过 6 亿美元民事处罚；自 2021 年底起相关 initiative 已涉及超过 100 家机构、超过 20 亿美元处罚。
   [SEC — Enforcement Results for Fiscal Year 2024](https://www.sec.gov/newsroom/press-releases/2024-186)

8. **SEC — 2024 Recordkeeping Enforcement, 12 Firms**
   12 家机构因电子通信 recordkeeping failures 被处罚，合计民事罚款超过 8,800 万美元。
   [SEC — 12 Firms Recordkeeping Failures](https://www.sec.gov/newsroom/press-releases/2024-144)

9. **Federal Reserve — SR 26-2: Revised Guidance on Model Risk Management, April 17, 2026**
   关于模型文档、验证、持续监控、治理、职责、vendor model 以及生命周期管理。
   [Federal Reserve — SR 26-2](https://www.federalreserve.gov/supervisionreg/srletters/SR2602.htm)

10. **Federal Reserve — Supervisory Guidance on Model Risk Management**
    关于 model documentation、validation、ongoing monitoring、governance、roles and responsibilities 和 vendor model oversight。
    [Federal Reserve — Model Risk Management Guidance](https://www.federalreserve.gov/frrs/guidance/supervisory-guidance-on-model-risk-management.htm)

11. **NIST AI Risk Management Framework 1.0**
    关于 GOVERN、documentation、accountability、AI lifecycle、transparency 和 risk governance。
    [NIST — AI RMF](https://www.nist.gov/itl/ai-risk-management-framework)

12. **NIST AI RMF Playbook — GOVERN**
    关于角色责任、数据 provenance、模型文档、透明度、第三方 AI 以及 auditability。
    [NIST — AI RMF Playbook: Govern](https://airc.nist.gov/airmf-resources/playbook/govern/)

13. **BIS Financial Stability Institute — Managing explanations: how regulators can address AI explainability, 2025**
    关于复杂 AI / LLM explainability 的局限，包括 inaccuracy、instability 和 misleading explanations。
    [BIS FSI — Managing Explanations](https://www.bis.org/publications/fsi-paper-24-managing-explanations-how-regulators-can-address-ai-explainability)

14. **BIS — Regulating AI in the financial sector: recent developments and main challenges**
    关于金融 AI 的 governance、accountability、transparency、explainability、third-party AI services 和 data security。
    [BIS FSI — Regulating AI in the Financial Sector](https://www.bis.org/fsi/publ/insights63.htm)

15. **BIS — AI in finance: what can change, what must never change, 2026**
    强调金融机构对 AI 决策的责任不能转移给模型或供应商，以及 supervisors 需要 robust、auditable、well-governed systems。
    [BIS — AI in Finance](https://www.bis.org/speeches/20260416-ai-finance-what-can-change-what-must-never-change)

16. **BIS — Supervising banks in an AI-shaped economy, September 2026**
    关于 AI governance、accountability、transparency、human oversight，以及金融机构对 AI 决策承担最终责任。
    [BIS — Supervising Banks in an AI-Shaped Economy](https://www.bis.org/speeches/20260918-supervising-banks-ai-shaped-economy)

17. **BIS — Governance of AI adoption in central banks, 2025**
    关于金融机构 / 中央银行 AI governance、risk management、third-party risk 和 three lines of defence。
    [BIS — Governance of AI Adoption in Central Banks](https://www.bis.org/publications/other/governance_ai_adoption_central_banks.htm)

18. **DORA — Regulation (EU) 2022/2554**
    关于 ICT response/recovery、记录、recovery procedures、checks、reconciliation 和 data integrity。
    [EUR-Lex — DORA](https://eur-lex.europa.eu/eli/reg/2022/2554/oj)

19. **FINRA Rule 3110 / GenAI regulatory obligations**
    FINRA 2026 报告明确指出，GenAI 使用仍然受 supervision、recordkeeping、fair dealing 等现有义务约束。
    [FINRA — GenAI Regulatory Obligations](https://www.finra.org/rules-guidance/guidance/reports/2026-finra-annual-regulatory-oversight-report/gen-ai)

20. **NIST AI RMF Core — Govern / Map / Measure / Manage**
    关于 AI 风险管理生命周期、治理、透明度、问责和文档化。
    [NIST — AI RMF Core](https://airc.nist.gov/airmf-resources/airmf/5-sec-core/)

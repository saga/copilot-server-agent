# AI Observability 与 Regulatory Audit Evidence

## 金融服务领域 AI Agent 审计与可追溯性设计

## 1. 引言

传统企业系统的审计通常比较直接：

```text id="1k0h2d"
User
  ↓
API
  ↓
Business Service
  ↓
Database
  ↓
Audit Log
```

因此只要记录：

```text id="c5w5nb"
Who
What
When
```

很多情况下就已经足够。

但 AI Agent 系统变成：

```text id="qf9d7t"
User
  ↓
Agent
  ↓
LLM
  ↓
Tool A
  ↓
Retrieval
  ↓
LLM
  ↓
Tool B
  ↓
Human Review
  ↓
Policy
  ↓
Command
  ↓
Domain API
  ↓
External System
```

一次业务操作可能跨越多个：

* Model invocation
* Tool call
* Agent turn
* Retrieval
* Memory
* Workflow Node
* Human Task
* Policy Decision
* Command
* External API

因此单纯保存：

```text id="wo4j0m"
"Agent execution succeeded"
```

远远不够。

真正需要回答的是：

> **谁发起了这次行为？Agent 做了什么？使用了什么模型和 Skill？访问了什么数据？调用了什么工具？产生了什么建议？经过什么 Policy？谁批准了？执行了什么 Command？最终改变了什么业务状态？**

这就是 AI Agent 时代的 **observability 与 auditability** 问题。

但两者不能混为一谈：

> **Observability 是为了理解系统如何运行；Regulatory Audit Evidence 是为了证明业务行为、控制执行和记录本身具有可信性。**

AWS 当前 Agentic AI Lens 已明确把 Agent observability、non-repudiation、structured audit trails 和 decision artifact storage 分开考虑；其要求覆盖 Agent 行为、工具调用、异步边界、触发来源以及 tamper-evident storage。([docs.aws.amazon.com](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentsec05.html))

---

# 2. 核心结论

金融 Agent 应至少设计四类记录：

```text id="1x0y78"
1. Runtime Observability
      ↓
2. Agent Telemetry
      ↓
3. Business Audit Trail
      ↓
4. Regulatory Evidence
```

它们之间的关系：

```text id="4q84c4"
Runtime Observability
    = 系统运行得怎么样？

Agent Telemetry
    = Agent 到底做了什么？

Business Audit Trail
    = 业务为什么发生、谁允许它发生？

Regulatory Evidence
    = 哪些记录必须以受监管要求认可的方式保存、保护和提供？
```

最重要的一点：

> **不是所有 Agent Log 都是 Audit Evidence，也不是所有 Audit Evidence 都应该来自 Agent Runtime。**

例如：

```text id="y9av2w"
LLM latency = 2.3 sec
```

是 Observability。

而：

```text id="89gck2"
Compliance Reviewer:
User B

Decision:
APPROVED

Command:
publish-investment-idea

Command Hash:
abc123

Policy:
investment-publish-v4
```

才接近业务审计证据。

对于特定受监管业务，最终哪些记录属于法律意义上的 books and records，取决于具体司法管辖区、实体、业务和规则。FINRA 2026 年对 GenAI 的监管提示就明确指出，GenAI 使用可能涉及 supervision、communications 和 recordkeeping；使用第三方 AI 也不会把最终合规责任转移给供应商。([finra.org](https://www.finra.org/rules-guidance/guidance/reports/2026-finra-annual-regulatory-oversight-report/gen-ai))

---

# 3. 为什么传统日志模型不够

传统：

```text id="7u3w87"
2026-09-19 14:22
user=alice
action=publish
status=success
```

只能回答：

> Alice 发起了 Publish。

但 Agent 系统还需要知道：

```text id="g5vqvz"
哪个 Agent？

代表哪个 User？

属于哪个 Case？

当前 Workflow Node 是什么？

使用了哪个 Model？

哪个 Skill？

读取了哪些 Evidence？

调用了哪些 Tools？

Policy 为什么 Allow？

谁批准？

批准的具体内容是什么？

执行的 Command Hash 是什么？

执行前 Resource Version 是多少？

最终外部系统返回什么？

```

所以 AI Agent 需要：

```text id="cbtd34"
End-to-End Provenance
```

而不是简单的：

```text id="a8r20j"
Application Log
```

AWS 当前 Agentic AI Lens 明确要求一个独立于普通 tracing ID 的 correlation identifier 穿过异步边界，并使过去的 Agent interaction chain 可以被完整重建。([docs.aws.amazon.com](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentsec05.html))

---

# 4. Observability 与 Audit Evidence 的根本区别

这是整个体系最值得明确的一条边界。

| 项目         | Observability                    | Audit Evidence                              |
| ---------- | -------------------------------- | ------------------------------------------- |
| 目的         | Debug / Performance / Operations | Accountability / Compliance / Investigation |
| 主要消费者      | Developer / SRE / Platform       | Compliance / Risk / Audit / Regulator       |
| 是否允许采样     | 可以                               | 受监管记录通常不能随意采样                               |
| 是否允许丢失     | 某些 telemetry 可以                  | 关键证据不能                                      |
| 是否可以变更     | 可以按日志生命周期处理                      | 必须具备完整性/可重建能力                               |
| 保存时间       | 通常较短                             | 按业务/监管要求                                    |
| 关注点        | latency / error / token / cost   | who / what / why / authority / outcome      |
| 数据格式       | trace / log / metric             | Evidence / Record                           |
| 是否一定具备法律意义 | 否                                | 取决于适用规则                                     |

因此：

```text id="7p5d6c"
LangSmith / OpenTelemetry / CloudWatch
```

可以很好地解决：

```text id="8ri4f4"
"Agent 为什么用了 45 秒？"
```

但未必直接回答：

```text id="9r0e4b"
"谁批准了这次受监管业务操作？
批准的具体内容是什么？
如何证明记录没有被修改？"
```

---

# 5. 四层记录体系

推荐建立：

```text id="c0g8da"
                    ┌────────────────────┐
                    │ Regulatory Evidence│
                    │                    │
                    │ Immutable / WORM   │
                    │ Audit Trail        │
                    └─────────▲──────────┘
                              │
                    ┌─────────┴──────────┐
                    │ Business Audit     │
                    │                    │
                    │ Case / Approval /  │
                    │ Policy / Command   │
                    └─────────▲──────────┘
                              │
                    ┌─────────┴──────────┐
                    │ Agent Telemetry    │
                    │                    │
                    │ Tool / Model /      │
                    │ Retrieval / Agent   │
                    └─────────▲──────────┘
                              │
                    ┌─────────┴──────────┐
                    │ Runtime            │
                    │ Observability      │
                    │                    │
                    │ Trace / Metric /    │
                    │ Log / Event        │
                    └────────────────────┘
```

这四层可以共享 correlation ID，但不应该共用同一个数据模型。

---

# 6. Runtime Observability

这是最底层。

应该回答：

```text id="j1k8sy"
服务健康吗？
延迟多少？
失败率多少？
Token 消耗多少？
模型哪次调用慢？
哪个 Tool 慢？
哪里发生 retry？
哪个 Agent 卡住？
```

推荐采用：

```text id="l7mg4x"
Metrics
Logs
Traces
Events
```

OpenTelemetry 已经形成统一的 Semantic Conventions；GenAI observability 正在标准化 model invocation、token usage、tool calls 等信息，使 Agent Trace 可以和传统分布式系统 Trace 关联。([opentelemetry.io](https://opentelemetry.io/blog/2026/genai-observability/))

例如：

```text id="x0hyc5"
Trace
 └── invoke_agent
      ├── chat
      ├── execute_tool
      │    └── HTTP
      ├── retrieval
      ├── chat
      └── command
```

---

# 7. Agent Telemetry

传统 Trace 对 Agent 来说还不够。

至少需要：

```text id="q8gdd0"
Agent Run
├── agentId
├── executionId
├── sessionId
├── workflowId
├── nodeId
├── model
├── modelVersion
├── skillVersion
├── toolCalls
├── retrievals
├── memoryOperations
├── retries
├── handoffs
└── output
```

AWS 当前 Agentic AI Lens 建议捕获 reasoning steps、tool invocations、memory operations、model invocations 和 inter-agent handoffs，并贯穿 service boundaries。([docs.aws.amazon.com](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentops05.html))

---

# 8. Tool Call 应该成为一等事件

不能只记录：

```text id="bjwj83"
Agent finished.
```

应该记录：

```json id="yqmq58"
{
  "eventType": "tool.called",
  "executionId": "exec-84721",
  "agentId": "research-agent-42",
  "tool": "research.search",
  "inputHash": "...",
  "startedAt": "...",
  "completedAt": "...",
  "status": "success"
}
```

对于敏感参数：

```text id="lbn0wh"
不要直接记录原始值
```

而可以：

```text id="a57zv1"
hash
reference
classification
redacted summary
```

OpenTelemetry 的 GenAI semantic conventions 支持模型、Token、Tool invocation 等结构化 telemetry，同时特别强调高敏感、体积大的内容属性应谨慎 opt-in。([opentelemetry.io](https://opentelemetry.io/docs/specs/semconv/how-to-write-conventions/))

---

# 9. 为什么不应该默认记录完整 Prompt 和完整 Tool Result

这是一个非常容易犯的错误：

```text id="b2q6kz"
"为了审计，把 Agent 的所有输入输出全部保存。"
```

这可能产生：

* PII 泄露；
* 客户机密泄露；
* credentials 泄露；
* 大量重复数据；
* retention 成本；
* cross-border data concerns；
* Prompt injection 内容进入长期存储；
* 第三方模型数据再次被复制。

AWS 当前明确建议敏感字段在进入长期日志存储前进行 mask / redaction；同时指出把 PII、credentials 等直接写入 reasoning traces 会产生合规和安全风险。([docs.aws.amazon.com](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentops05-bp03.html))

因此：

> **Audit completeness ≠ record everything verbatim.**

---

# 10. Evidence Reference 比 Raw Data 更重要

例如不要保存：

```text id="vkrm2d"
完整 300 页 PDF
```

作为一次 AI Decision 的审计日志。

可以保存：

```text id="gqg0pa"
documentId
documentVersion
page
section
retrievalTimestamp
contentHash
```

形成：

```text id="2f4q8z"
Decision
   ↓
Evidence Reference
   ↓
Source Version
   ↓
Content Hash
```

这样系统可以证明：

> 当时的决策依据是哪一个数据版本。

同时不必在 Audit Store 中复制整个业务数据库。

---

# 11. Business Audit Trail

这是 Agent Runtime 与金融业务之间真正重要的一层。

建议围绕：

```text id="md8zj7"
Business Case
Workflow
Human Decision
Policy Decision
Command
Business State
```

建立独立 Audit Model。

例如：

```text id="x1ng3d"
Case #1234

Workflow:
    investment-review@v13

Node:
    compliance-review

AI Result:
    research@v8

Policy:
    investment-publish-policy@v4

Approval:
    User B

Command:
    publish-investment-idea

Command Hash:
    abc123

Domain:
    publish()

Result:
    SUCCESS
```

这才是真正的：

```text id="2mw5k1"
Business Provenance
```

---

# 12. 谁、什么、为什么、依据什么

一个完整的金融 Agent 审计模型至少要回答：

```text id="qzhqg4"
WHO
    谁发起？
    谁批准？
    哪个 Agent？

WHAT
    做了什么？
    调用了什么？
    改变了什么？

WHEN
    什么时候？
    持续多久？

WHY
    为什么进入这个流程？
    为什么允许？

BASED ON WHAT
    使用了什么数据？
    哪个 Policy？
    哪个 Workflow？
    哪个 Model？
```

因此建议形成：

```text id="r7q9c8"
Who
+
What
+
When
+
Why
+
Evidence
+
Authority
+
Outcome
```

---

# 13. Provenance 比 Log 更重要

一个普通 Log：

```text id="5p5cdw"
command executed
```

而 Provenance：

```text id="m6s7in"
User Alice
    ↓
Workflow InvestmentReview
    ↓
Agent Research
    ↓
Evidence A / B / C
    ↓
Recommendation
    ↓
Compliance Review
    ↓
Approval User B
    ↓
Policy V4
    ↓
Command Hash ABC
    ↓
Domain Publish
    ↓
Business State
```

W3C PROV 标准本身就是围绕 Entity、Activity、Agent 和它们之间的 provenance relationships 建模，适合用作企业 AI decision provenance 的概念参考。([w3.org](https://www.w3.org/TR/prov-primer/))

---

# 14. 推荐的 Provenance 模型

可以抽象成：

```text id="x6fgd7"
Agent
    │
    │ generated
    ▼
Decision Artifact
    │
    │ based_on
    ▼
Evidence
    │
    │ governed_by
    ▼
Policy
    │
    │ approved_by
    ▼
Human Decision
    │
    │ authorizes
    ▼
Command
    │
    │ changes
    ▼
Business Entity
```

这个模型比“保存所有 Prompt”更接近真正的审计需求。

---

# 15. 为什么不要把 Chain-of-Thought 当 Regulatory Evidence

这是一个非常重要的设计结论。

Agent 可能有：

```text id="w94t9n"
internal reasoning
```

但监管真正关心的通常不是：

> “模型内部每一个 token 是怎么想的？”

而是：

```text id="19ru7e"
What decision was made?
What information materially supported it?
What controls were applied?
Who was accountable?
What action occurred?
```

更重要的是，BIS 在 2025 年关于 AI explainability 的研究指出，对复杂 AI / LLM 使用事后生成的 explanations 本身可能存在不准确、不稳定以及误导风险，因此不能简单把一段模型生成的“解释”当成真实的 causal explanation。([bis.org](https://www.bis.org/publications/fsi-paper-24-managing-explanations-how-regulators-can-address-ai-explainability))

因此：

> **审计不应该依赖模型自己叙述“我为什么这样想”。**

应该依赖：

```text id="mx7xpx"
Structured Decision
+
Evidence
+
Policy
+
Workflow
+
Human Approval
+
Command
+
Outcome
```

---

# 16. Decision Artifact

建议每个重要 Agent Decision 都产生结构化 Artifact：

```json id="w6n8f3"
{
  "decisionId": "decision-123",
  "type": "investment-research",
  "recommendation": "proceed",
  "keyFindings": [
    "...",
    "..."
  ],
  "evidence": [
    {
      "sourceId": "doc-123",
      "version": "v8",
      "location": "p87",
      "hash": "..."
    }
  ],
  "uncertainties": [
    "Latest quarter unavailable"
  ],
  "limitations": [
    "Market data delayed"
  ]
}
```

这个 Artifact 才应该进入：

```text id="f3qfgi"
Business Audit / Evidence
```

而不是把整段隐藏推理直接当作审计字段。

---

# 17. Audit Evidence 的核心对象

推荐至少包含：

```text id="d2n2b5"
Execution
├── Trigger
├── Actor
├── Agent
├── User Context
├── Workflow
├── Node
├── Model
├── Skill
├── Input References
├── Retrieval References
├── Decision Artifact
├── Policy Decision
├── Human Approval
├── Command
├── Command Hash
├── Resource Version
├── Execution Result
└── Final Business State
```

---

# 18. Version 是 Audit Evidence 的关键

一次 AI 决策必须能够回答：

```text id="2dcrx6"
哪个 Model？
哪个 Prompt / Skill？
哪个 Workflow？
哪个 Policy？
哪个 Data Version？
```

因此至少需要：

```text id="5yyn1e"
modelVersion
skillVersion
workflowVersion
policyVersion
dataVersion
commandVersion
```

例如：

```text id="23q1bb"
Execution #84721

Model:
    model-x@2026-09-10

Skill:
    investment-research@v8

Workflow:
    investment-review@v13

Policy:
    publish-policy@v4

Evidence:
    annual-report@2025/v3

Command:
    publish-investment-idea@v2
```

否则半年后模型已经变了：

```text id="2wgxmf"
same prompt
```

也无法证明当时的行为。

---

# 19. “当前 Prompt”不是 Version

例如：

```text id="7y8kvd"
现在的 System Prompt
```

不能用于证明：

```text id="h1osbq"
6 个月前执行时使用什么 Prompt。
```

需要保存：

```text id="n8cqcc"
Prompt / Skill Artifact
+
Version
+
Hash
```

甚至可以：

```text id="s9b8zo"
skillHash = SHA-256(skill source)
```

然后 Audit Event：

```text id="7cqb6s"
skillVersion = v8
skillHash = ...
```

这与当前项目的 `sourceHash` 思路非常契合。

---

# 20. Workflow Version 也必须可追溯

例如：

```text id="s9yq3z"
investment-review@v13
```

因为：

```text id="q4q1og"
v12:
    Compliance → PM

v13:
    Compliance → Risk → PM
```

同一个 Agent Output：

```text id="11a4hs"
```

在两个 Workflow 下可能产生完全不同的业务路径。

因此：

> **Workflow Version 是业务审计的一部分，而不是单纯代码版本。**

---

# 21. Policy Version 同样重要

例如：

```text id="fcv0f4"
Policy v3:
    one Compliance approval

Policy v4:
    two Compliance approvals
```

一次执行记录：

```text id="2y7aon"
Policy Decision = ALLOW
```

没有：

```text id="6e85oi"
policyVersion = v3
```

未来就很难证明：

> 当时为什么允许。

---

# 22. Audit Event 与 Evidence Record 应该分开

建议：

```text id="j3qjoa"
Event
    = 发生了什么

Evidence
    = 为什么可以证明发生了什么
```

例如：

```text id="fz9d2a"
Event:
    command.executed
```

Evidence：

```text id="dp2j05"
Command:
    hash

Approval:
    User B

Policy:
    version 4

Resource:
    version 8

Result:
    external transaction ID
```

---

# 23. 推荐 Event Model

```json id="4a1r64"
{
  "eventId": "evt-123",
  "eventType": "command.executed",
  "occurredAt": "2026-09-19T10:32:00Z",

  "correlationId": "case-123",

  "actor": {
    "type": "agent",
    "agentId": "research-agent-42",
    "onBehalfOf": "alice"
  },

  "workflow": {
    "workflowId": "investment-review",
    "version": "v13",
    "executionId": "exec-84721",
    "nodeId": "publish"
  },

  "command": {
    "type": "publish-investment-idea",
    "resourceId": "1234",
    "hash": "abc123"
  },

  "policy": {
    "policyId": "publish-policy",
    "version": "v4",
    "decision": "allow"
  },

  "approval": {
    "required": true,
    "decision": "approved",
    "reviewer": "user-b"
  },

  "result": {
    "status": "success"
  }
}
```

---

# 24. Correlation ID 是整个系统的主线

不要只依赖：

```text id="zj8t3s"
OpenTelemetry traceId
```

作为业务审计标识。

因为一个业务流程可能：

```text id="d28pqf"
跨多个 Trace
跨多个 Service
跨多个 Agent
跨多个异步 Queue
跨几天
```

因此推荐建立独立：

```text id="l2x0vn"
businessCorrelationId
```

例如：

```text id="p3qfgr"
caseId = CASE-1234
```

或：

```text id="m9v0xw"
executionId = EXEC-84721
```

并让它贯穿：

```text id="xq4m3s"
Case
Workflow
Agent
Trace
Tool
Human Task
Command
Audit
External Request
```

AWS 明确建议使用 independent correlation ID 跨 asynchronous boundaries，而不仅依赖 tracing system 的 trace ID。([docs.aws.amazon.com](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentsec05.html))

---

# 25. Trace ID 与 Business Correlation ID 的关系

推荐：

```text id="h1f2b0"
Business Case ID
     │
     ├── Trace A
     │
     ├── Trace B
     │
     ├── Human Task
     │
     ├── Trace C
     │
     └── Command Execution
```

而不是：

```text id="a8zv54"
One Trace = One Business Case
```

因为金融流程经常长时间运行。

例如：

```text id="pbd01j"
Monday:
    Agent Research

Tuesday:
    Compliance Review

Wednesday:
    PM Approval

Thursday:
    Execute
```

必须仍然能够完整关联。

---

# 26. Audit Store 不应该等于 Log Store

推荐：

```text id="xk0t0f"
Observability Store
    ├── traces
    ├── logs
    ├── metrics
    └── events

Audit Store
    ├── decisions
    ├── approvals
    ├── commands
    ├── policy decisions
    └── business state changes

Evidence Store
    ├── source artifacts
    ├── versions
    ├── hashes
    └── immutable records
```

可以通过：

```text id="7b4n5w"
correlationId
executionId
eventId
```

关联。

但是生命周期和权限可以完全不同。

---

# 27. Regulatory Evidence 必须防篡改

一旦某条记录可能用于监管、争议或调查：

```text id="5a9swt"
agent.executed
approval.approved
command.executed
```

就不能依赖：

```text id="1bz4a6"
ordinary mutable application log
```

AWS 建议 Audit Trail 使用 tamper-evident / immutable storage；DORA 相关实施法规也要求保护异常活动记录，防止未经授权的修改和访问。([docs.aws.amazon.com](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentops05-bp03.html) )

---

# 28. “Immutable”不一定意味着 WORM

这是金融系统中很重要的技术细节。

SEC 对 broker-dealer 的 Rule 17a-4 已经允许两种主要路径：

```text id="wlsqj1"
WORM
```

或者：

```text id="8gg72s"
Audit Trail
```

后者需要能够在记录被修改/删除后重建原始记录，并保留完整的 time-stamped audit trail、修改/删除记录以及相关身份信息。([sec.gov](https://www.sec.gov/investment/amendments-electronic-recordkeeping-requirements-broker-dealers))

因此：

> **真正的要求是记录的完整性、真实性、可重建性和可提供性，而不一定只能使用某一种物理存储技术。**

这也是为什么当前企业云架构可以使用符合要求的云存储，而不是简单理解成“监管审计必须上磁带/WORM”。

---

# 29. Audit Evidence 应该支持“原始记录重建”

例如：

```text id="k90y6w"
Version 1:
    recommendation = proceed

Version 2:
    human edited

Version 3:
    final approved
```

不能只保存：

```text id="z6s1c7"
final = Version 3
```

应该能够回答：

```text id="m1x6s2"
Version 1 是什么？
谁修改了？
什么时候修改？
修改了什么？
Version 2 为什么产生？
最终批准的是哪一版？
```

SEC Rule 17a-4 的 audit-trail alternative 明确要求能够重建记录原始状态。([sec.gov](https://www.sec.gov/investment/amendments-electronic-recordkeeping-requirements-broker-dealers))

---

# 30. 修改不是删除

Audit Store 不应该：

```text id="h6b6n1"
UPDATE audit_event
SET result = corrected_value
```

而应该：

```text id="2mr9s2"
Original Event
     ↓
Correction Event
     ↓
Current Interpretation
```

例如：

```text id="07m5fp"
command.executed
result = SUCCESS

correction:
externalReference corrected
reason = data-entry-error
actor = system-admin
```

这样原始事实仍然存在。

---

# 31. Audit Trail 应该能回答“谁改过记录”

因此至少记录：

```text id="apq5c3"
recordId
operation
oldVersion
newVersion
actor
timestamp
reason
```

SEC 的 audit-trail alternative 同样要求记录创建、修改、删除行为的时间和相关身份，并保证记录可重新构建。([sec.gov](https://www.sec.gov/investment/amendments-electronic-recordkeeping-requirements-broker-dealers))

---

# 32. Retention 不是统一的一个数字

非常危险的做法：

```text id="phb8p5"
All AI Logs:
    retain = 7 years
```

不同数据应该不同：

```text id="8cu97q"
Debug Trace
    short

Performance Metrics
    medium

Agent Telemetry
    policy-defined

Business Audit
    business/regulatory-defined

Regulatory Evidence
    applicable-law-defined
```

EU AI Act 对适用的高风险 AI 系统要求自动日志，并规定了至少六个月的默认保存要求，同时特别说明金融机构应将相关日志纳入适用金融服务法下的文档体系；但这并不意味着所有金融 AI 日志的法定保存期都是六个月。([eur-lex.europa.eu](https://eur-lex.europa.eu/legal-content/EN/TXT/?qid=1731313259402&uri=CELEX%3A32024R1689))

因此：

> **Retention 是 Legal / Compliance Policy，不应该写死在 Observability System。**

---

# 33. EU AI Act 对金融机构特别值得注意的一点

当前 EU AI Act Article 12 要求适用的 high-risk AI systems 具备整个生命周期的自动事件记录能力，以支持风险识别、post-market monitoring 和系统运行监控。Article 19 / Article 26 又要求相关自动生成日志在其控制范围内进行保存；金融机构需按照相应的 Union financial-services governance / documentation requirements 维护这些记录。([eur-lex.europa.eu](https://eur-lex.europa.eu/eli/reg/2024/1689/2026-07-27/eng))

但要注意：

> **并非所有金融领域 AI 都自动属于 EU AI Act 的 high-risk AI。**

例如信用评分/creditworthiness 等特定用途被列为 high-risk，而某些 fraud detection、内部 prudential monitoring 等用途存在不同分类规定。([eur-lex.europa.eu](https://eur-lex.europa.eu/legal-content/EN/TXT/?qid=1731313259402&uri=CELEX%3A32024R1689))

因此架构上应该先做：

```text id="2wgppe"
AI Use Case Classification
```

再决定：

```text id="eg35l2"
required evidence
retention
monitoring
documentation
```

而不是：

```text id="v5zz5w"
AI
→ always regulatory high risk
```

---

# 34. FINRA 的启示：AI 产生的记录可能进入现有 Recordkeeping 体系

FINRA 2026 年明确指出，GenAI 的使用可能产生新的 records，企业应审查 AI tools 是否触发现有的 books-and-records、communications 等保存义务。与此同时，第三方提供 AI 工具并不会免除企业本身的监管责任。([finra.org](https://www.finra.org/rules-guidance/guidance/reports/2026-finra-annual-regulatory-oversight-report/gen-ai))

所以架构原则应该是：

```text id="ji8xf5"
AI Record
    ↓
Does this support / constitute a regulated business record?
    ↓
Applicable Recordkeeping Policy
```

而不是：

```text id="nbcvjs"
Agent Log
    ↓
automatically regulatory record
```

---

# 35. DORA 的启示：Audit 还要服务于 Operational Resilience

DORA 不只是监管记录。

它要求金融实体：

* 持续监控 ICT 系统；
* 记录 ICT incidents 和 significant cyber threats；
* 能够识别、跟踪、记录和分类 incidents；
* 记录并分析 anomaly；
* 对相关记录进行保护，防止篡改和未授权访问。([eur-lex.europa.eu](https://eur-lex.europa.eu/legal-content/EN/TXT/?qid=1706204622385&uri=CELEX%3A32022R2554))

所以 AI Audit Architecture 应该同时服务：

```text id="k4p0pb"
Regulatory Audit
+
Security Investigation
+
Operational Resilience
+
Business Dispute
+
Model Risk Management
```

---

# 36. Agent Incident Investigation

假设：

```text id="xn9k8u"
Agent accidentally sent confidential data externally.
```

调查人员需要：

```text id="dbbhg3"
1. 谁发起？
2. 哪个 Agent？
3. 哪个 Workflow？
4. 哪个 Node？
5. 哪个 Model？
6. 哪个 Tool？
7. 查询了什么数据？
8. 哪个 Data Entitlement 放行？
9. 哪个 Policy 放行？
10. 为什么 Command 被执行？
11. 是否有人批准？
12. 数据发送到了哪里？
13. 第一次何时发生？
14. 是否重试？
15. 是否发生多次？
```

这就是：

```text id="1j7pq1"
Forensic Reconstruction
```

而不是简单：

```text id="c8a5d3"
grep logs
```

---

# 37. 一个完整的 Agent Evidence Graph

建议把一次重要业务操作最终形成：

```text id="j3jxcm"
                     User
                      │
                      ▼
               Agent Execution
                      │
          ┌───────────┼────────────┐
          ▼           ▼            ▼
       Model       Retrieval       Tool
          │           │            │
          └───────────┼────────────┘
                      ▼
               Decision Artifact
                      │
                      ▼
                    Policy
                      │
                      ▼
                  Human Review
                      │
                      ▼
                   Approval
                      │
                      ▼
                   Command
                      │
                      ▼
                Domain Mutation
                      │
                      ▼
              External Outcome
```

每一个节点都有：

```text id="urwukm"
identity
timestamp
version
reference
hash
```

这比单纯保留日志更接近：

> **可验证的 Business Provenance Graph。**

---

# 38. 推荐的 Event Taxonomy

建议不要让：

```text id="0mgiua"
eventType
```

无限自由增长。

可以建立标准事件族。

### Execution

```text id="3vt9wl"
execution.started
execution.completed
execution.failed
execution.cancelled
```

### Agent

```text id="j8v0h3"
agent.invoked
agent.decision.created
agent.handoff
```

### Model

```text id="c3yd4w"
model.invoked
model.completed
model.failed
```

### Retrieval

```text id="pbz3l3"
retrieval.requested
retrieval.completed
```

### Tool

```text id="b7byyf"
tool.requested
tool.authorized
tool.denied
tool.executed
```

### Human

```text id="b2c0tp"
review.created
review.assigned
review.approved
review.rejected
review.escalated
```

### Policy

```text id="f4g2f8"
policy.evaluated
policy.allowed
policy.denied
```

### Command

```text id="r2k0t4"
command.proposed
command.approved
command.rejected
command.executing
command.executed
command.failed
```

### Business

```text id="xv7h7j"
entity.created
entity.updated
entity.published
entity.rejected
```

这样可以建立统一审计查询。

---

# 39. Event 与 Span 的职责区别

不要把所有东西都变成 Span。

OpenTelemetry 的原则是：

```text id="k78xdl"
Span
    = 有持续时间的操作

Event
    = 某一时刻发生的有意义事件
```

例如：

```text id="ft3cl3"
Span:
    model.invoke
    duration = 2.4s
```

Event：

```text id="w1h5jd"
policy.denied
```

Event 可以描述：

```text id="w0t7fk"
state change
checkpoint
decision
approval
exception
```

OpenTelemetry 当前 semantic conventions 对 Event 的定义正适用于这种状态变化和异步事件。([opentelemetry.io](https://opentelemetry.io/docs/specs/semconv/general/events/))

---

# 40. Audit Event 应该独立于 Trace 生命周期

例如：

```text id="6ymrzx"
Trace
    TTL = 30 days
```

但：

```text id="ud1tq9"
command.executed
```

可能需要保存：

```text id="iv9w47"
years
```

因此：

```text id="rkx2v4"
Trace retention
    ≠
Audit retention
```

Trace 可以结束生命周期。

Audit Evidence 仍然必须存在。

---

# 41. 为什么不能直接把 LangSmith 当 Audit System

LangSmith、OpenTelemetry 等非常适合：

```text id="d6w8yx"
debug
evaluation
trace
performance
prompt investigation
```

但是监管证据还需要：

```text id="o4f5q2"
immutability
retention policy
access control
legal hold
record classification
reconstruction
regulatory export
```

因此：

```text id="p5jzi7"
LangSmith
     ↓
Runtime Observability

Audit Store
     ↓
Business Evidence

Regulatory Archive
     ↓
Regulated Record
```

三者可以互相引用，但不应互相替代。

---

# 42. Audit Evidence Store 应该拥有不同权限模型

开发人员：

```text id="8ta1m8"
can read traces
```

不意味着：

```text id="17f4i5"
can modify audit evidence
```

Compliance：

```text id="q4l1r0"
can query evidence
```

但不应该：

```text id="1fuvh0"
modify original record
```

System Admin：

```text id="d8o4a8"
can operate storage
```

也不意味着：

```text id="4bfgm7"
can silently alter historical evidence
```

因此：

> **Audit Store 的管理员权限必须和普通 application administrator 分离。**

---

# 43. Audit Evidence 本身也应该被审计

例如：

```text id="01v7sp"
谁查询了审计记录？
谁导出了记录？
谁申请 Legal Hold？
谁进行了 Correction？
谁改变了 Retention Policy？
```

因此：

```text id="j1n7oe"
Audit
    ↓
Audit the Audit System
```

这在监管环境尤其重要。

---

# 44. Data Minimization 与 Audit 完整性

存在一个现实矛盾：

```text id="5h6f6p"
越完整的日志
    ↑
    │
    ↓
越高的数据泄露风险
```

因此推荐三层策略：

### Level 1 — Metadata

```text id="r8v1x6"
hash
ID
type
timestamp
classification
```

### Level 2 — Reference

```text id="8yoh5b"
documentId
version
location
```

### Level 3 — Raw Content

```text id="3y5txg"
only when justified
```

也就是：

> **Evidence 优先记录“可验证引用”，而不是无条件复制所有原始数据。**

---

# 45. PII / Confidential Data 应在进入长期日志前处理

例如：

```text id="f4s5h9"
Customer Name
Account Number
Portfolio Holdings
Personal Identifiers
```

不要默认进入：

```text id="47h7sw"
Agent Reasoning Log
```

可以采用：

```text id="yf84vq"
mask
hash
tokenize
reference
field-level encryption
```

并且：

```text id="e4x5p6"
raw content
```

只保存在本来就应该拥有该权限的系统里。

AWS 当前建议 PII redaction at write time，并明确指出 Agent reasoning traces 中记录 credentials 或敏感内容会产生安全和合规风险。([docs.aws.amazon.com](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentops05-bp03.html))

---

# 46. Audit Evidence 应支持 Reasonable Search

监管调查不是：

```text id="0fa4qb"
"请把 8 TB log 给我。"
```

而通常需要：

```text id="6an0aa"
Find all actions:
    by User B
    during period X
    involving Case 1234
    approved by Compliance
    under Policy V4
```

因此 Audit Store 必须支持：

```text id="7y24y8"
caseId
executionId
userId
agentId
commandId
eventType
policyId
timestamp
resourceId
```

高效查询。

SEC 的 Rule 17a-4 现行框架也要求相关电子记录能够以 reasonably usable electronic format 提供，以便监管人员能够搜索和排序。([sec.gov](https://www.sec.gov/investment/amendments-electronic-recordkeeping-requirements-broker-dealers))

---

# 47. Audit Export 应该是一等能力

不能要求：

```text id="gq5mi6"
Developer:
    manually query database
    write SQL
    zip logs
```

应该：

```text id="26o8l0"
Audit Query
   ↓
Evidence Bundle
   ↓
Integrity Manifest
   ↓
Export
```

例如：

```text id="p37r6b"
Case #1234

manifest.json
events.jsonl
approvals.json
commands.json
policy-decisions.json
evidence-index.json
hashes.json
```

这样更容易进行：

```text id="4onq3a"
regulatory inquiry
internal audit
incident investigation
legal discovery
```

---

# 48. Evidence Bundle 应该有完整性校验

可以建立：

```text id="j82fry"
Evidence Bundle
      ↓
SHA-256 hashes
      ↓
Manifest
      ↓
Signature
```

例如：

```json id="kj3u1e"
{
  "bundleId": "audit-123",
  "records": [
    {
      "file": "commands.json",
      "sha256": "..."
    },
    {
      "file": "approvals.json",
      "sha256": "..."
    }
  ]
}
```

这样导出之后能够验证：

```text id="yzmwc3"
Evidence changed?
```

---

# 49. 不要只记录“最终结果”

这是 Agent Audit 最常见的错误之一：

```text id="7xzmpm"
Result:
    APPROVED
```

但审计最重要的问题可能是：

```text id="c5x0t2"
Why?
```

所以必须保存：

```text id="znv5tz"
Decision
+
Evidence
+
Policy
+
Human Decision
+
Business Context
```

NIST AI RMF 通过 Govern、Map、Measure、Manage 强调持续记录、测量、风险管理和系统上下文；其核心思想不是单纯保存模型输出，而是形成能够支持风险管理生命周期的证据。([nist.gov](https://www.nist.gov/itl/ai-risk-management-framework))

---

# 50. AI Decision 的“可解释性”应拆开

金融 Agent 经常要求：

> “请解释 AI 为什么这么决定。”

这里其实有三个层次：

### Level 1

```text id="jfw5v0"
Model Output
```

### Level 2

```text id="01x7ew"
Structured Rationale
```

例如：

```text
Finding A
Evidence B
Risk C
```

### Level 3

```text id="7h93by"
Business Provenance
```

例如：

```text
Policy
Workflow
Approval
Evidence
Command
```

对于审计而言：

> **Level 3 往往比要求模型暴露所谓“内部思维过程”更重要。**

BIS 对 AI Explainability 的研究也指出复杂模型的 explanations 存在准确性和稳定性限制。([bis.org](https://www.bis.org/publications/fsi-paper-24-managing-explanations-how-regulators-can-address-ai-explainability))

---

# 51. Model Version 不等于 Decision Version

一次模型调用：

```text id="pzwo07"
model = model-x@v1
```

并不意味着：

```text id="9w6k0s"
decision = v1
```

因为：

```text id="0ty6wl"
Input
Skill
Retrieval Context
Temperature
Tool Results
Workflow State
```

也可能变化。

因此一个完整 Decision Version 至少要关联：

```text id="g0s7kd"
Model
Skill
Input
Evidence
Workflow
Policy
Output
```

---

# 52. RAG Evidence 需要版本化

对于金融 Agent：

```text id="8rrzbp"
"What data did the model use?"
```

是非常重要的问题。

因此不要只保存：

```text id="1f3d0e"
query = "company risk"
```

而应该保存：

```text id="xp12z6"
query
retrieval timestamp
source ID
source version
chunk ID
ranking
content hash
```

例如：

```text id="zy5lk3"
Evidence:
    annual-report
    version = 2025.3
    page = 87
    hash = ...
```

这样可以实现：

```text id="jfhb4q"
Decision
    ←
exact source snapshot
```

---

# 53. External Data 也需要 Provenance

例如：

```text id="5zj4q5"
Market Data
Vendor A
```

不能只记录：

```text id="w4n1s9"
market_data_used = true
```

更应该：

```text id="hgp2pz"
provider
dataset
timestamp
data version
query
response hash
```

因为外部数据供应商也可能：

```text id="vwv6oa"
update
correct
retract
```

未来需要知道：

> 当时 Agent 使用的到底是哪一个数据版本。

---

# 54. 第三方模型也是 Evidence Dependency

例如：

```text id="8rj4gn"
OpenAI
Anthropic
Google
```

不能只保存：

```text id="8i0v4x"
model = GPT-x
```

还应该：

```text id="bg2xnd"
provider
model identifier
model version / snapshot where available
endpoint / region where material
configuration
timestamp
```

金融机构尤其要考虑第三方依赖，因为 FSB 已将第三方 AI 服务提供商依赖与集中度列为金融领域 AI 风险。([fsb.org](https://www.fsb.org/2024/11/fsb-assesses-the-financial-stability-implications-of-artificial-intelligence/))

---

# 55. Audit Evidence 与 Model Evaluation 还应该连起来

假设：

```text id="yn2f72"
1000 executions
```

其中：

```text id="plpgd9"
3% human override
```

长期升到：

```text id="7x9kqq"
15%
```

这可能意味着：

```text id="l1hj01"
Model Drift
Prompt Drift
Data Drift
Workflow Change
Policy Change
```

因此 Audit Evidence 不应该只是“保存过去”，还应该用于：

```text id="bgq7kh"
Model Monitoring
Agent Evaluation
Risk Monitoring
```

AWS 当前 Agent Observability guidance 也要求建立 agent behavioral baselines、drift detection 和 workflow KPI。([docs.aws.amazon.com](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentops05.html))

---

# 56. Agent Observability 应该监控哪些指标

至少分五类。

### Runtime

```text
latency
error rate
retry count
availability
```

### Model

```text
token usage
model latency
model error
fallback rate
```

### Agent

```text
turn count
tool count
loop count
handoff count
failure rate
```

### Workflow

```text
completion rate
time per node
approval wait time
stuck executions
escalation rate
```

### Business

```text
human override rate
false approval
false rejection
rework rate
financial impact
customer impact
```

---

# 57. Human Override 是非常重要的 Agent Risk Signal

例如：

```text id="n2w09t"
AI:
    APPROVE

Human:
    REJECT
```

应该记录：

```text id="3u4b9v"
AI Recommendation:
    APPROVE

Human Decision:
    REJECT
```

而不是只留下：

```text id="1w3e7n"
Final:
    REJECT
```

因为前者可以帮助分析：

```text id="a41trv"
为什么 Agent 和人经常不同意？
```

这对于模型风险和持续监控非常重要。

---

# 58. Policy Override 也必须记录

例如：

```text id="o9p4cb"
Policy:
    DENY

Authorized Human:
    Emergency Override
```

最终：

```text id="2rwyzx"
EXECUTED
```

如果只看到：

```text id="f2yn1y"
command.executed
```

整个事件就无法解释。

因此：

```text id="vju1ma"
Policy Decision
    ↓
Override
    ↓
Authority
    ↓
Reason
    ↓
Execution
```

必须完整保存。

---

# 59. Audit Evidence 必须能区分“建议”和“事实”

例如：

```text id="7d76xk"
AI:
    "Risk is high."
```

不是：

```text id="bll51x"
Risk = HIGH
```

除非后者是一个正式 Domain / Policy Decision。

因此：

```text id="p6g2r6"
Agent Recommendation
```

和：

```text id="j6q7a3"
System Decision
```

必须不同 Event Type。

否则审计人员可能无法判断：

> 这是模型的观点，还是系统正式认定的业务事实？

---

# 60. Audit Evidence 应该具有 Authority Metadata

例如：

```text id="kqoues"
Evidence:
    AI recommendation

Authority:
    Agent
```

而：

```text id="t6vw70"
Evidence:
    Approval

Authority:
    Human reviewer

Evidence:
    Policy decision

Authority:
    Policy engine

Evidence:
    Published state

Authority:
    Domain system
```

这样可以清楚表达：

```text id="v8p4t7"
谁对这个事实负责？
```

W3C PROV 中的 Agent、Activity、Entity 和 responsibility / attribution 模型可以作为构造这种 provenance graph 的概念参考。([w3.org](https://www.w3.org/TR/prov-primer/))

---

# 61. 一个完整的 Audit Evidence Schema

可以设计成：

```ts id="7e9b9n"
interface AuditEvidence {
  evidenceId: string;

  correlationId: string;
  caseId?: string;
  executionId: string;

  occurredAt: string;

  actor: {
    type: "human" | "agent" | "system";
    id: string;
    onBehalfOf?: string;
  };

  workflow?: {
    id: string;
    version: string;
    nodeId: string;
  };

  agent?: {
    id: string;
    runtime: string;
    model?: string;
    modelVersion?: string;
    skill?: string;
    skillVersion?: string;
  };

  evidence: {
    type: string;
    ref: string;
    version?: string;
    hash?: string;
  }[];

  policy?: {
    id: string;
    version: string;
    decision: "allow" | "deny" | "review";
  };

  approval?: {
    reviewer: string;
    decision: string;
    commandHash: string;
  };

  command?: {
    type: string;
    resourceId?: string;
    hash: string;
    resourceVersion?: string;
  };

  result?: {
    status: string;
    externalReference?: string;
  };
}
```

---

# 62. 当前项目的 Event Model 可以进一步演进

当前项目已有：

```text id="u6yv9z"
execution events
SSE
command events
policy events
approval events
```

可以进一步明确三种目的：

```text id="nb98fk"
Runtime Event
    → operational

Business Event
    → business state

Audit Evidence
    → compliance / accountability
```

例如：

```text id="0r5tq3"
agent.proposed_command
```

是 Runtime / Business Event。

而：

```text id="s29a9y"
command.executed
```

可以进一步产生：

```text id="1pxy8j"
Audit Evidence
```

但不要简单认为：

```text id="1bpfid"
every SSE event
=
audit record
```

---

# 63. SSE 不应该成为 Regulatory Store

SSE 很适合：

```text id="vlz1ka"
live UI
Agent progress
token delta
workflow status
```

但是：

```text id="ydyd55"
SSE
≠
durable audit
```

因为：

* client 可能断开；
* event 可能只存在内存；
* streaming sequence 不适合作为长期查询；
* retention 不由 SSE 管理；
* immutable storage 不由 SSE 保证。

正确：

```text id="2k0h0k"
Domain Event
   ├──→ SSE
   └──→ Durable Event / Audit Store
```

---

# 64. Audit Event 应该先落盘，再广播

对于关键事件：

```text id="x0cjq0"
Approval
Command
Policy
Execution
```

推荐：

```text id="g0q8sm"
Event
  ↓
Durable Store
  ↓
Publish SSE
```

而不是：

```text id="qqy4nf"
Event
  ↓
SSE
  ↓
hope client receives it
```

否则 Live UI 的可靠性会影响 Audit Evidence。

---

# 65. Audit Store 与 Event Bus 也不是一回事

Event Bus 主要解决：

```text id="6k4qvw"
delivery
fan-out
asynchronous processing
```

Audit Store 主要解决：

```text id="mnf26x"
historical record
integrity
retention
query
reconstruction
regulatory production
```

可以：

```text id="3jr8i6"
Business Event
   ↓
Event Bus
   ├── Analytics
   ├── Notifications
   └── Audit Writer
```

但不能：

```text id="z3b2yf"
Kafka retention expired
→ audit evidence gone
```

---

# 66. 推荐 Evidence Pipeline

```text id="u3y0f0"
Agent / Workflow
       │
       ▼
Structured Event
       │
       ├── Runtime Telemetry
       │
       ├── Business Event
       │
       └── Audit Candidate
                 │
                 ▼
            Classification
                 │
          ┌──────┴──────┐
          ▼             ▼
     Operational    Regulatory
       Store          Evidence
          │             │
     short/medium   immutable /
                      controlled
```

这样：

```text id="i8hyt4"
Audit policy
```

可以决定什么最终成为：

```text id="ujy1x7"
Regulatory Evidence
```

---

# 67. Audit Candidate 与 Regulatory Record Classification

建议所有重要 Agent Event 先成为：

```text id="zhrv6x"
Audit Candidate
```

然后根据：

```text id="1v5k3d"
business process
jurisdiction
entity
record type
risk tier
```

分类：

```text id="h8w9qf"
Operational
Business
Compliance
Regulatory
```

这样不会把平台设计硬编码到某一个监管制度。

---

# 68. Legal Hold

对于调查、诉讼或监管检查：

```text id="oaq3z9"
Retention Policy:
    expires after 2 years
```

但：

```text id="l4n64s"
Legal Hold:
    CASE-1234
```

应该阻止自动删除。

所以 Evidence Store 需要至少考虑：

```text id="hbznj4"
retentionPolicy
retentionExpiry
legalHold
deletionEligibility
```

---

# 69. Correction 不应该破坏原始证据

例如发现：

```text id="m5f8wx"
wrong metadata
```

不要：

```text id="1s7x1d"
UPDATE original
```

而应该：

```text id="5x9x4c"
Original
   ↓
Correction Event
   ↓
Corrected View
```

最终：

```text id="h1hvdo"
Original record remains available.
```

这与 SEC 对 audit-trail alternative 要求能够重建原始记录的方向一致。([sec.gov](https://www.sec.gov/investment/amendments-electronic-recordkeeping-requirements-broker-dealers))

---

# 70. Audit Access 也必须 Least Privilege

建议：

```text id="t0ug3e"
Developer
    → technical telemetry

SRE
    → operations telemetry

Compliance
    → business evidence

Risk
    → policy / model evidence

Internal Audit
    → full audit evidence

Regulator
    → scoped export
```

不要：

```text id="p2v7sa"
everyone
    → all prompts + all customer data
```

因为 Audit 数据本身往往包含最高敏感度信息。

---

# 71. 供应商的 Observability 不等于你的 Audit Evidence

这是金融 Agent 使用第三方 LLM 时尤其容易出现的问题。

例如：

```text id="mfr5c4"
OpenAI
Anthropic
Google
AWS
LangSmith
```

可以提供：

```text id="x3v9zz"
model telemetry
request logs
traces
```

但：

> **企业不能因此认为“供应商替我们完成了 Audit”。**

FINRA 已明确提醒，企业将 AI 功能外包给第三方并不会转移其最终合规责任；企业需要考虑供应商安全、审计权和 records。([finra.org](https://www.finra.org/rules-guidance/key-topics/fintech/report/artificial-intelligence-in-the-securities-industry/key-challenges))

因此：

```text id="4l15mg"
Vendor Telemetry
    = supporting evidence

Enterprise Audit Store
    = authoritative business evidence
```

---

# 72. 模型供应商日志可能只是 Evidence Dependency

例如：

```text id="5lqn84"
Model:
    gpt-x

Vendor Request ID:
    abc123
```

企业自己的 Audit Store 保存：

```text id="jmts2e"
executionId
agentId
model
vendorRequestId
timestamp
skillVersion
workflowVersion
policyVersion
```

必要时：

```text id="wuwj8m"
Vendor Request ID
```

可以追溯到供应商侧 telemetry。

这样企业自己掌握：

```text id="k4e7v4"
Business Audit Chain
```

供应商只是：

```text id="6v9x5x"
Supporting Runtime Detail
```

---

# 73. Regulatory Evidence 与 Model Audit 也应该结合

对于真正重要的 AI 决策：

```text id="b0ytf1"
Business Audit
        +
Model Governance
```

例如：

```text id="0qzz0t"
Which model?
Which version?
Approved for which use case?
Which validation result?
Which risk tier?
Which monitoring threshold?
```

这与 BIS 关于金融 AI explainability 和 model risk governance 的讨论一致：金融机构仍需对 AI 影响的决策承担责任，并管理模型限制、数据质量和治理。([bis.org](https://www.bis.org/speeches/20260520-regulation-and-supervision-financial-sector-age-artificial-intelligence))

---

# 74. Evidence Completeness 应成为可测量指标

不能只说：

```text id="v7d4g9"
"We have audit logs."
```

应该衡量：

```text id="6d91lw"
% executions with actor
% executions with workflow version
% executions with policy version
% commands with hash
% approvals with reviewer identity
% decisions with evidence references
% executions with final outcome
% records with valid correlation IDs
```

例如：

```text id="8yym2a"
Audit completeness:
    99.997%
```

剩下：

```text id="z05xv8"
0.003%
missing policyVersion
```

就可以触发治理问题。

---

# 75. Audit Completeness 应该有硬性不变量

推荐：

```text id="u8i7gj"
High-risk Command
    MUST have:

    actor
    executionId
    workflowVersion
    nodeId
    commandHash
    policyDecision
    approval if required
    resourceVersion
    executionResult
```

缺任何一个：

```text id="8oxz5p"
audit-incomplete
```

而不是：

```text id="1lmg05"
best effort
```

---

# 76. Audit Evidence 的完整链

最终，一次关键业务操作应该能够重建：

```text id="6x4o54"
Trigger
  ↓
Human / Agent Identity
  ↓
Business Case
  ↓
Workflow Version
  ↓
Agent / Skill / Model
  ↓
Input Evidence
  ↓
AI Decision Artifact
  ↓
Policy Decision
  ↓
Human Approval
  ↓
Command Hash
  ↓
Resource Version
  ↓
Idempotency Key
  ↓
Domain Validation
  ↓
Execution
  ↓
External Result
  ↓
Final Business State
```

这条链就是：

> **Business Audit Provenance Chain**

---

# 77. 当前项目的推荐架构

结合当前项目，可以形成：

```text id="y9q0ii"
                         Agent Runtime
                              │
                              ▼
                        WorkflowRunner
                              │
               ┌──────────────┼──────────────┐
               ▼              ▼              ▼
            @task          @review        @command
               │              │              │
               ▼              ▼              ▼
           Agent Event     Approval       Command Event
                              │              │
                              └──────┬───────┘
                                     ▼
                              Business Event
                                     │
                        ┌────────────┴────────────┐
                        ▼                         ▼
                 Observability              Audit Writer
                  / LangSmith                    │
                        │                        ▼
                        │                 Audit Evidence
                        │                        │
                        │                 Immutable Store
                        │                        │
                        └────────────┬───────────┘
                                     ▼
                             Audit Query / Export
```

---

# 78. 当前项目最值得补强的 Event Envelope

建议每个关键 Event 统一包含：

```ts id="ydj1os"
interface EventEnvelope {
  eventId: string;
  eventType: string;

  occurredAt: string;

  correlationId: string;
  executionId?: string;
  caseId?: string;

  actor: {
    type: "human" | "agent" | "system";
    id: string;
    onBehalfOf?: string;
  };

  workflow?: {
    id: string;
    version: string;
    nodeId?: string;
    sourceHash?: string;
  };

  agent?: {
    id: string;
    runtime?: string;
    model?: string;
    modelVersion?: string;
    skillId?: string;
    skillVersion?: string;
    skillHash?: string;
  };

  policy?: {
    policyId: string;
    policyVersion: string;
    decision?: string;
  };

  resource?: {
    type: string;
    id: string;
    version?: string;
  };

  command?: {
    type: string;
    hash: string;
    idempotencyKey?: string;
  };

  evidenceRefs?: string[];

  dataClassification?: string;

  payload?: unknown;
}
```

这样未来无论：

```text id="y6w5qk"
Copilot SDK
DeepAgents
OpenAI Agents
其他 Runtime
```

都能产生统一的 Audit Event。

---

# 79. Runtime Event 与 Audit Event 应该采用同一 Correlation Model

例如：

```text id="bgtm2f"
Case:
CASE-1234

Execution:
EXEC-84721
```

Agent Trace：

```text id="p5x9ab"
trace-001
```

Human Task：

```text id="eyf0q3"
task-567
```

Command：

```text id="3r0x0j"
command-891
```

External Request：

```text id="av53z8"
vendor-req-xyz
```

全部关联：

```text id="u8t0s5"
CASE-1234
```

这样调查人员可以：

```text id="9b4kni"
Case
 → Workflow
 → Agent
 → Tool
 → Human
 → Command
 → External
```

完整重建。

---

# 80. Trace Sampling 的特殊注意点

普通生产系统经常：

```text id="3yssuc"
sample 1%
```

但金融 Agent 不能简单把这个策略用于所有数据。

应该区分：

```text id="v0qkqj"
Operational Trace
    → sampling allowed

High-risk Agent Execution
    → full business event

Regulatory Evidence
    → no sampling
```

例如：

```text id="0p6u12"
Low-risk search
    → 1% full trace

Trade execution
    → 100% trace metadata
    → 100% audit evidence
```

这样才能兼顾成本和审计完整性。

---

# 81. 失败事件不能比成功事件记录得更完整

一个常见 anti-pattern：

```text id="9k87ci"
只记录 errors
```

那么未来：

```text id="z2j1s9"
Why did this successful transaction happen?
```

无法解释。

AWS 明确把“只记录错误而不记录成功操作”列为 Agent Audit 的 anti-pattern，因为无法完整重建行为序列。([docs.aws.amazon.com](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentops05-bp03.html))

所以：

```text id="2x9dj7"
success
failure
deny
approve
retry
cancel
```

都需要结构化记录。

---

# 82. Audit 不是单纯的“日志越多越好”

真正好的 Audit Architecture 是：

```text id="4qyt4e"
Less Raw Data
+
More Structured Context
+
Strong Provenance
+
Strong Integrity
+
Good Queryability
```

而不是：

```text id="g54m82"
TBs of Prompt Logs
```

因此：

> **高价值证据不是数据量，而是上下文、关联性、完整性和可重建性。**

---

# 83. 最终推荐的 Evidence Maturity Model

### Level 1 — Infrastructure Observability

```text id="lk71k4"
CPU
Latency
Errors
```

无法解释 Agent。

### Level 2 — Agent Observability

```text id="94j9h6"
Agent
Model
Tool
Trace
```

可以 Debug。

### Level 3 — Business Audit

```text id="3c7o8d"
Case
Workflow
Policy
Approval
Command
Outcome
```

可以审计业务。

### Level 4 — Regulatory Evidence

```text id="5lpn8v"
Immutable
Versioned
Traceable
Retained
Reconstructable
Searchable
Exportable
```

可以作为受监管记录体系的一部分。

金融机构真正应该把高风险 Agent Workflow 至少做到 Level 3，并根据适用监管要求对相关 Record 做到 Level 4。

---

# 84. 最终设计原则

整篇可以浓缩成 18 条：

```text id="1qv8na"
1. Observability and Regulatory Audit Evidence are different systems with different purposes.

2. Runtime traces are not automatically regulatory records.

3. Every consequential Agent execution needs an independent Business Correlation ID.

4. Human identity and Agent identity must both be recorded.

5. Record who initiated the execution and on whose behalf the Agent acted.

6. Record Workflow, Node, Skill, Model and Policy versions.

7. Record Tool invocations and important retrieval provenance.

8. Prefer structured decision artifacts and evidence references over raw Chain-of-Thought.

9. Never rely on the Agent's own narrative as the sole explanation of why an action happened.

10. Audit evidence must connect Recommendation → Policy → Approval → Command → Outcome.

11. High-risk Commands must have complete evidence bundles.

12. Resource versions and command hashes should be preserved for consequential actions.

13. Audit records need tamper-evident or otherwise compliant integrity controls.

14. Corrections must preserve the original record and create a traceable correction.

15. Retention must be driven by applicable business and regulatory requirements, not a universal platform default.

16. PII and confidential information should be redacted or referenced rather than copied indiscriminately into long-lived telemetry.

17. Regulatory evidence must be searchable, reconstructable and exportable.

18. Audit completeness itself should be monitored as a production control.
```

---

# 85. 最值得记住的六层模型

最终可以用下面这张图理解：

```text id="l9iqi6"
                ┌──────────────────────────┐
                │ Regulatory Evidence      │
                │                          │
                │ Immutable / Retention    │
                │ Search / Export          │
                └────────────▲─────────────┘
                             │
                ┌────────────┴─────────────┐
                │ Business Audit           │
                │                          │
                │ Who / Why / Approval     │
                │ Policy / Command / State │
                └────────────▲─────────────┘
                             │
                ┌────────────┴─────────────┐
                │ Decision Provenance       │
                │                          │
                │ Evidence / Version /     │
                │ Recommendation            │
                └────────────▲─────────────┘
                             │
                ┌────────────┴─────────────┐
                │ Agent Telemetry          │
                │                          │
                │ Model / Tool / Retrieval │
                │ Agent / Handoff          │
                └────────────▲─────────────┘
                             │
                ┌────────────┴─────────────┐
                │ Distributed Tracing      │
                │                          │
                │ Trace / Span / Event     │
                └────────────▲─────────────┘
                             │
                ┌────────────┴─────────────┐
                │ Infrastructure           │
                │                          │
                │ CPU / Network / DB / API │
                └──────────────────────────┘
```

---

# 86. 当前项目最核心的设计结论

当前项目已经有：

```text id="0h6s28"
Workflow Execution
SSE Events
Command Hash
Resource Version
Approval
Policy
Execution Events
sourceHash
```

下一步不应该简单增加：

```text id="w4n7n1"
更多日志
```

而应该增加一层：

```text id="3hxik4"
Business Audit Evidence
```

把现有事件统一关联：

```text id="j7f7m5"
Case
   ↓
Execution
   ↓
Workflow
   ↓
Agent Task
   ↓
Decision Artifact
   ↓
Policy
   ↓
Human Approval
   ↓
Command
   ↓
Idempotency
   ↓
Domain
   ↓
Result
```

同时保持：

```text id="xv1z7q"
SSE
    = live runtime experience

LangSmith / OpenTelemetry
    = runtime observability

Business Audit Store
    = business accountability

Regulatory Archive
    = applicable regulated records
```

不要让四者混在一起。

---

# 87. 最终结论

金融 Agent 的审计不能简单理解为：

> **“把 Prompt、Tool Call、Response 全部保存下来。”**

真正成熟的设计是：

> **保存一条能够从业务触发一路追溯到 Agent、Evidence、Policy、Human Decision、Command、Execution 和最终 Business State 的完整 Provenance Chain。**

因此：

```text id="4kz4db"
Observability
    tells you:
    "What happened inside the system?"

Audit Evidence
    tells you:
    "What business action happened,
     under whose authority,
     based on what evidence,
     according to which control,
     and what was the final result?"
```

在金融领域，这一区别尤其重要。BIS 已明确指出，金融机构仍然需要对 AI 所影响的决策承担责任，并需要处理模型的不可解释性、数据治理以及过度自动化带来的风险。([bis.org](https://www.bis.org/speeches/20260520-regulation-and-supervision-financial-sector-age-artificial-intelligence))

因此，一个真正成熟的金融 Agent 平台应该追求的不是：

```text id="9er1mc"
More Logs
```

而是：

```text id="r2juh0"
More Provenance
+
More Deterministic Control
+
More Evidence Integrity
```

最终用一句话概括：

> **Observability 让工程团队知道 Agent 做了什么；Audit Evidence 让企业能够证明 Agent 为什么被允许这样做、谁承担责任，以及最终究竟发生了什么。**

---

# 参考资料

**AWS — Agentic AI Lens: Agent observability and non-repudiation**
讨论 Agent 全链路 traceability、initiating source、correlation ID、tamper-evident storage、敏感数据处理和事后重建。([docs.aws.amazon.com](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentsec05.html))

**AWS — Agentic AI Lens: Observability and monitoring**
要求 Agent traces 覆盖 reasoning steps、tool calls、memory operations、model invocations、handoffs，并建立 behavioral baselines、drift monitoring 和 workflow KPIs。([docs.aws.amazon.com](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentops05.html))

**AWS — Structured logging and comprehensive audit trails**
强调 structured logs、immutable audit trails、retention、PII redaction，并明确把只记录 error 而不记录 successful operations 列为 anti-pattern。([docs.aws.amazon.com](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentops05-bp03.html))

**AWS — Comprehensive logging and decision artifact storage**
强调 decision artifact、原始触发源、tamper-evident storage 和 forensic reconstruction。([docs.aws.amazon.com](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentsec05-bp01.html))

**OpenTelemetry — GenAI Observability**
介绍 GenAI semantic conventions 对 model invocation、token usage、tool calls、prompt/response content 等 telemetry 的标准化。([opentelemetry.io](https://opentelemetry.io/blog/2026/genai-observability/))

**OpenTelemetry — Semantic Conventions**
定义跨语言、跨服务的统一 attribute 和 event conventions，为 Agent / LLM / Tool tracing 提供标准化基础。([opentelemetry.io](https://opentelemetry.io/docs/specs/semconv/))

**W3C PROV**
以 Entity、Activity、Agent 和其 provenance relationships 建模数据和决策来源，可作为 AI Business Provenance 的概念参考。([w3.org](https://www.w3.org/TR/prov-primer/))

**NIST AI RMF**
通过 Govern、Map、Measure、Manage 建立 AI 生命周期的风险治理、测量、文档和监控框架。([nist.gov](https://www.nist.gov/itl/ai-risk-management-framework))

**NIST — Challenges to monitoring deployed AI systems, 2026**
指出部署后的 AI monitoring 对验证现实环境中的可靠性、发现非预期行为和处理模型非确定性非常重要，而相关实践仍处于快速发展阶段。([nist.gov](https://www.nist.gov/publications/challenges-monitoring-deployed-ai-systems-center-ai-standards-and-innovation))

**BIS — Managing explanations: how regulators can address AI explainability, 2025**
指出复杂 AI/LLM 的 explanation 存在准确性、不稳定性和误导风险，因此需要更加谨慎地处理 Explainability 与监管责任。([bis.org](https://www.bis.org/publications/fsi-paper-24-managing-explanations-how-regulators-can-address-ai-explainability))

**BIS — Regulation and supervision of the financial sector in the age of AI, 2026**
强调金融机构仍对 AI 影响的决策负责，并必须处理模型风险、数据治理和 explainability。([bis.org](https://www.bis.org/speeches/20260520-regulation-and-supervision-financial-sector-age-artificial-intelligence))

**FSB — Financial Stability Implications of AI**
指出 AI 在金融领域会增加第三方依赖、网络风险、模型风险和相互关联等脆弱性，并要求加强监控和治理。([fsb.org](https://www.fsb.org/2024/11/the-financial-stability-implications-of-artificial-intelligence/))

**DORA — Regulation (EU) 2022/2554**
要求金融实体持续监控 ICT、记录 ICT incidents 和 significant cyber threats，并建立识别、跟踪、记录、分类和保护相关记录的机制。([eur-lex.europa.eu](https://eur-lex.europa.eu/legal-content/EN/TXT/?qid=1706204622385&uri=CELEX%3A32022R2554))

**DORA RTS — Regulation (EU) 2024/1774**
进一步要求监测 anomaly、记录相关时间和类型信息，并保护异常活动记录免受篡改和未授权访问。([eur-lex.europa.eu](https://eur-lex.europa.eu/legal-content/EN/TXT/?qid=1782719247887&uri=CELEX%3A32024R1774))

**EU AI Act — Article 12 / 19 / 26**
对于适用的 high-risk AI systems，要求自动记录事件，并对自动生成日志的保存和金融机构记录管理提出要求；具体适用范围取决于 AI use case 是否属于 high-risk。([eur-lex.europa.eu](https://eur-lex.europa.eu/eli/reg/2024/1689/2026-07-27/eng))

**FINRA — 2026 GenAI Regulatory Oversight**
指出 GenAI 使用可能触及 supervision、communications 和 recordkeeping，企业需审视 AI 使用产生的新 records。([finra.org](https://www.finra.org/rules-guidance/guidance/reports/2026-finra-annual-regulatory-oversight-report/gen-ai))

**FINRA — AI Regulatory Considerations**
强调使用第三方 AI 不会转移企业最终合规责任，并提醒 AI 使用可能产生需要纳入 books-and-records 管理的新记录。([finra.org](https://www.finra.org/rules-guidance/key-topics/fintech/report/artificial-intelligence-in-the-securities-industry/key-challenges))

**SEC — Electronic Recordkeeping Requirements**
Rule 17a-4 的现代化要求允许 WORM 或 audit-trail alternative，并要求记录能够保持真实性、完整性、可重建性以及以 reasonably usable electronic format 提供。([sec.gov](https://www.sec.gov/investment/amendments-electronic-recordkeeping-requirements-broker-dealers))

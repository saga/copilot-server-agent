# AI Observability ≠ Regulatory Audit Evidence

在企业 Agent 平台里，`Observability` 已经成为标准能力。

我们可以看到完整的：

```text
Trace
 ├── Agent invocation
 ├── LLM call
 ├── Retrieval
 ├── Tool call
 ├── Memory access
 ├── External API
 └── Final response
```

于是很容易产生一个看起来合理的判断：

> 既然 Agent 的每一步都已经被 trace 下来了，那么监管检查、内部审计、模型风险管理需要的证据，不就已经有了吗？

这个判断通常是不成立的。

更准确地说：

> **AI Observability 是理解系统“发生了什么”的技术能力；Regulatory Audit Evidence 是为了证明“某个受监管事实、控制或决策成立”而被保存、保护、关联和提供的证据体系。**

二者大量重叠，但不是同一个东西。

而且这不是一个纯粹的术语区别。到了金融服务领域，二者如果没有被明确拆开，最终很容易出现一种架构假象：

```text
LangSmith / OpenTelemetry / CloudWatch
            ↓
       已经有完整 trace
            ↓
       所以“合规可审计”
```

真正的检查往往会继续追问：

```text
谁发起的？
谁批准的？
当时使用的是什么模型、版本和配置？
Agent 当时实际看到了哪些数据？
哪些数据真正影响了决策？
执行的是哪一条业务规则？
什么 Policy 允许这个 Tool 调用？
Tool 最终改变了什么业务状态？
外部系统是否真的执行？
当时的记录是否可以证明没有被事后修改？
保留期限是否满足要求？
能否在监管要求的格式和时间内重建完整事实？
```

一个普通 trace 往往并不能独立回答这些问题。

因此，金融 Agent 平台真正需要建设的不是“更完整的 observability”，而是：

> **在 observability 之上，再建立一套独立的 Regulatory Evidence Architecture。**

---

# 1. 先定义问题：什么是 AI Observability，什么是 Regulatory Audit Evidence

首先需要避免一个概念陷阱：

**“Regulatory Audit Evidence”并不是所有金融监管体系都统一使用的一个法律术语。**

本文把它作为一个架构概念，指：

> 为了证明某项业务行为、控制执行、授权、模型使用、风险处理或监管义务履行情况，而被设计、保存、保护并可重建的证据集合。

这个概念实际上包含了两个不同来源。

第一类是：

```text
Regulatory Records
```

例如证券业的 books and records、电子通信记录、交易记录等。

第二类是：

```text
Audit Evidence
```

也就是审计人员为了得出结论所使用的证据。

PCAOB AS 1105 对 audit evidence 的定义非常重要：审计证据是审计人员据以形成结论的各种信息；证据必须具有足够的数量，并且具有相关性和可靠性。标准还特别指出，如果企业自己生成的信息被作为审计证据使用，需要评价其准确性、完整性以及相关 IT 控制。

这与：

```text
“系统里有一个 JSON trace”
```

完全是两个层次的问题。

---

# 2. Observability 解决的是“系统为什么这样运行”

OpenTelemetry 对 observability 的定义非常典型：

> Observability 是通过系统输出了解其内部状态的能力。

工程上主要依靠：

```text
Metrics
Logs
Traces
```

等 telemetry signals。

所以 Observability 的核心问题是：

```text
为什么请求这么慢？
为什么 Agent 调错 Tool？
为什么 token 成本突然升高？
为什么某个 workflow 大量失败？
哪一个 downstream API 出错？
哪一版 prompt 导致成功率下降？
```

它关注的是：

```text
System Health
Debugging
Performance
Incident Response
Behavior Monitoring
Optimization
```

这也是当前 AI Observability 产品的主要定位。

例如 Microsoft Foundry 的 Agent tracing 可以记录：

```text
LLM calls
Tool invocations
Agent decision flows
Retrieval operations
Latency
Exceptions
```

目标是帮助开发者调试 Agent、分析性能和理解行为。

Amazon Bedrock AgentCore 同样提供 trace、span、tool invocation、request/response payload、错误与 recovery attempt 等运行时 telemetry。

这些能力都非常重要。

但它们解决的是：

> **“系统是怎么跑的？”**

而不是完整的：

> **“企业能否证明当时的业务行为符合监管和内部控制要求？”**

---

# 3. Regulatory Evidence 解决的是另一个问题

监管证据更接近：

```text
What happened?
Who authorized it?
Why was it permitted?
What control applied?
What data and version were used?
What business state changed?
Can the record be trusted?
Can it be reproduced?
Can it be produced later?
```

因此，两者最根本的区别可以概括成：

| 维度    | AI Observability   | Regulatory Audit Evidence             |
| ----- | ------------------ | ------------------------------------- |
| 主要目的  | 诊断、监控、优化           | 证明、审查、调查、监管                           |
| 关注对象  | 系统运行过程             | 受监管事实与控制                              |
| 数据粒度  | Trace / Span / Log | 业务事实 + 控制证据 + 原始记录                    |
| 时间范围  | 经常偏短期              | 依据法律/政策长期保存                           |
| 完整性目标 | 足以排障               | 足以支持审计/监管结论                           |
| 数据完整性 | 可写、可聚合很常见          | 常需更强的完整性和修改追踪控制                       |
| 来源    | 系统 telemetry       | 系统 + 业务系统 + 人员 + 外部来源                 |
| 关联方式  | Trace ID           | Business/Case/Transaction/Decision ID |
| 访问对象  | 工程、SRE、开发          | Compliance、Audit、Legal、Regulator      |
| 证明能力  | “系统记录了 X”          | “X 是什么、谁授权、依据什么、记录可信”                 |
| 最终产物  | Dashboard / Trace  | Evidence Package / Record Set         |

所以：

> **Observability 是 evidence 的潜在数据来源之一，但不是 evidence architecture 的同义词。**

---

# 4. 最容易产生误解的一点：有 Trace，不代表有 Audit Trail

在传统系统中：

```text
Trace ID
```

通常用于把：

```text
Service A
 → Service B
 → Database
 → Service C
```

串起来。

例如：

```text
trace_id = 8f4a...

Agent
   ├── LLM
   ├── RAG
   ├── Tool
   └── API
```

这对于排查：

```text
“为什么这次 Agent 失败了？”
```

非常有价值。

但一个监管人员可能问：

> 这笔交易是谁授权的？

Trace 可能没有。

再问：

> 当时采用的是哪一版业务 Policy？

Trace 可能也没有。

再问：

> 当时的权限边界是什么？

可能没有。

再问：

> 交易提交后，外部系统最终到底形成了什么业务记录？

也可能没有。

因此：

```text
Trace ID
```

并不是：

```text
Business Audit ID
```

更不是：

```text
Regulatory Evidence ID
```

成熟架构至少需要两层标识：

```text
Trace ID
    ↓
Technical execution correlation

Business Operation / Case / Decision ID
    ↓
Durable business evidence correlation
```

AWS 当前的 Agentic AI Lens 已经明确提出类似思路：除了 trace context，还应该有独立的 correlation identifier 跨越 asynchronous boundary，把 span、log 和 decision artifact 连接起来。

这是非常关键的区别。

---

# 5. 一个典型例子：Agent 提交一笔交易

假设 Agent 完成一个交易 workflow：

```text
User
  ↓
Agent
  ↓
Research
  ↓
Risk Check
  ↓
Approval
  ↓
Order Submission
  ↓
Broker
```

Observability 可能保存：

```json
{
  "trace_id": "abc123",
  "model": "model-x",
  "tool": "submit_order",
  "latency_ms": 832,
  "status": "success"
}
```

对于工程排障，这已经很有用了。

但合规调查可能需要：

```text
case_id
client_id
order_id
initiator
approver
approval_timestamp

agent_id
agent_version
model_provider
model_version

prompt/template_version
policy_version
tool_version

data_sources_used
entitlements_evaluated

decision
decision_reason_code

requested_order
normalized_order

authorization_result
risk_result

external_broker
external_reference

execution_timestamp
execution_result

post-trade state

record retention class
integrity metadata
```

这已经不是一条 trace 了。

而是一个：

```text
Regulatory Evidence Package
```

---

# 6. AWS 自己实际上已经把两者分开

这一点非常值得注意。

AWS 最新的 Agentic AI Lens 并不是简单说：

> “有 tracing 就完成 audit。”

相反，它分别讨论：

```text
Observability and Monitoring
```

以及：

```text
Observability and Non-repudiation
```

在 AGENTOPS05 中，AWS 强调：

* distributed tracing
* reasoning / decision path
* tool invocations
* memory operations
* behavioral baselines
* workflow KPIs

这些主要属于 observability 和 monitoring。

而 AGENTSEC05 则进一步要求：

* tamper-evident storage
* initiating source attribution
* correlation across asynchronous boundaries
* sensitive-field protection
* reconstruction without relying on the agent's own account

也就是说：

> **“我可以看到 Agent 怎么跑”与“我能够事后证明这个行为是谁触发、经过什么控制、且记录没有被篡改”是两项不同能力。**

甚至 AWS 的 maturity model 直接指出：如果日志存放在 mutable storage、没有 integrity controls，那么其 evidentiary value 会下降。

因此，本文的核心结论其实并不是：

> Observability 没用。

恰恰相反。

而是：

> **Observability 是 Regulatory Evidence 的重要底层数据源，但必须经过另外一层治理、关联、完整性保护和证据编排，才能成为可依赖的 evidence。**

---

# 7. 第一个本质区别：目的不同

这是所有其他差异的根源。

Observability 的优化目标通常是：

```text
MTTD
MTTR
Availability
Latency
Cost
Error Rate
Quality
```

所以它天然偏向：

```text
“最有助于发现和解决问题的数据”
```

而不是：

```text
“所有未来可能需要证明的事实”
```

这会形成一个天然的信息选择偏差。

例如为了节省成本，团队可能：

```text
Sampling = 10%
Prompt Body = not stored
Tool Payload = redacted
Long-term trace = disabled
```

对于 SRE 来说，这可能完全合理。

但如果某类交易后来进入监管调查：

```text
为什么这个客户在 2026-09-20 被 Agent 提出了这个投资建议？
```

你可能发现：

```text
那次 trace 已经过期
+
prompt 没保存
+
retrieval result 没保存
+
policy version 没保存
+
human approval 没关联
```

这时系统仍然：

```text
Observable
```

但：

```text
Not auditable
```

---

# 8. 第二个本质区别：Observability 是 telemetry，Audit Evidence 是 record

Telemetry 是：

```text
Signals
```

Record 是：

```text
Durable representation of a relevant fact
```

这意味着生命周期完全不同。

例如 observability：

```text
CloudWatch
   ↓
30 days
   ↓
Delete
```

在工程上可能完全合理。

但是某项金融业务记录可能要求：

```text
retain
preserve
produce
reconstruct
```

SEC 对 broker-dealer electronic recordkeeping 的要求就是一个非常具体的例子。

SEC Rule 17a-4 的现行机制允许两种电子记录保存方式：

```text
WORM
```

或者：

```text
Audit-trail alternative
```

后者要求保存能够重建原始记录的 audit trail，并包含修改、删除、时间以及相关身份等信息，同时要求保障记录的 authenticity 和 reliability。

这和：

```text
“我们有一个 trace backend”
```

不是同一个要求。

---

# 9. 第三个区别：完整性要求不同

工程日志可以是：

```text
append-ish
```

也可以是：

```text
mutable
```

可以被：

```text
TTL
sampling
aggregation
redaction
re-indexing
```

处理。

这对于 observability 完全正常。

但监管记录通常需要更严格的：

```text
Integrity
Authenticity
Completeness
Availability
Traceability
Retention
```

SEC 对 Rule 17a-4 的 audit-trail alternative 明确要求能够重建原始记录，并记录对记录的修改和删除。

PCAOB 的 AS 1105 更进一步指出，如果企业自产信息被用作 audit evidence，审计人员需要评价其准确性和完整性，以及支撑这些信息的 IT general controls 和 application controls。

因此：

```text
Immutable Storage
```

本身也不是终点。

因为还有一个问题：

> 你保存下来的，究竟是不是完整、准确的原始事实？

---

# 10. “不可修改”不等于“可信”

这是很多所谓 audit log 架构容易犯的错误。

例如：

```text
S3 Object Lock
+
Trace Archive
```

可以解决：

```text
“保存以后不能轻易修改”
```

但它没有自动解决：

```text
Agent 在生成原始 trace 时有没有漏掉字段？
Tool 有没有绕过 tracing？
异步任务有没有断链？
审批有没有记录？
外部系统结果有没有被纳入？
时钟是否正确？
用户身份是否可靠？
```

所以 evidence trust 有至少两个阶段：

```text
阶段 1
Capture Integrity
    ↓
原始事实被正确记录

阶段 2
Preservation Integrity
    ↓
记录被可靠保存、不能被事后任意改变
```

如果第一步失败，第二步做得再好也没用。

AWS 当前 Agentic AI Lens 明确建议使用独立于 Agent 自身权限范围的 tamper-evident storage，并强调 correlation、attribution 和完整链路重建。

---

# 11. 第四个区别：Observability 可以允许 Sampling，Evidence 不一定可以

Observability 经常做：

```text
100% traces
↓
sampling
↓
10%
```

或者：

```text
full payload
↓
redaction
↓
metadata only
```

这是为了：

```text
cost
privacy
performance
storage
```

但如果被抽样掉的刚好是一笔：

```text
high-risk trade
large payment
client complaint
regulatory case
```

那么：

```text
Operational telemetry = okay
Regulatory evidence = missing
```

因此金融 Agent 平台应该避免：

```text
“所有东西都统一从 trace backend 走 sampling”
```

更合理的是：

```text
                Agent Execution
                      │
          ┌───────────┴───────────┐
          │                       │
          ▼                       ▼
   Observability Stream     Evidence Stream
          │                       │
     sampling okay         policy-driven capture
     TTL okay               retention required
     aggregation okay       integrity controls
          │                       │
          ▼                       ▼
    Debug / SRE           Audit / Compliance
```

这并不意味着所有 Agent 数据都必须永久保存。

正确的设计应该是：

> **根据业务风险确定哪些事实必须升级成 evidence，而不是要求 telemetry 本身满足所有监管要求。**

---

# 12. 第五个区别：Observability 关注执行链，Audit Evidence 还必须关注“业务语义”

Agent Trace 通常表达：

```text
Step A
Step B
Tool C
Step D
```

而审计真正关心的是：

```text
为什么允许 Step C？

Step C 对应的业务操作是什么？

谁授权？

适用什么规则？

输入是什么？

数据从哪里来？

哪个控制检查通过？

最终业务效果是什么？
```

这意味着 evidence architecture 必须加入：

```text
Business Context
```

例如：

```text
Trace
  ↓
Tool: submit_vote
```

不够。

必须能关联：

```text
business_case_id
meeting_id
security_id
resolution_id
client_instruction_id
approval_id
policy_decision_id
external_reference
```

这样才能从：

```text
“技术执行”
```

跳到：

```text
“受监管业务事实”
```

---

# 13. 第六个区别：Evidence 必须能够证明“谁批准了”

Agent 场景尤其容易遗漏这一层。

例如：

```text
Agent recommended trade
```

和：

```text
Human approved trade
```

是完全不同的事实。

再比如：

```text
Agent called Tool
```

不能证明：

```text
Agent was authorized to call Tool
```

所以应该形成：

```text
Proposal
   ↓
Policy Evaluation
   ↓
Approval
   ↓
Execution
   ↓
External Result
```

每一层都应该有自己的证据。

推荐至少有：

```text
proposal_id
policy_decision_id
approval_id
operation_id
external_reference
```

而不是所有东西都靠：

```text
trace_id
```

FINRA 最新 2026 年 GenAI 监管报告明确指出，企业在使用 GenAI 时仍然需要遵守既有的 supervision、communications、recordkeeping 等义务；对于 Agent，FINRA 特别指出 auditability / transparency 是挑战，并建议考虑如何监控系统访问和数据处理、在哪里设置 human oversight，以及如何追踪 agent actions and decisions。

注意 FINRA 使用的是“consider”这类监督建议，而不是规定所有 Agent 必须采用某一个固定日志 schema。因此更合理的架构结论是：

> **金融 Agent 必须能够把动作与授权、监督和业务上下文关联起来；具体证据字段由业务场景和适用监管要求决定。**

---

# 14. 第七个区别：模型版本只是开始，不是完整的 Model Evidence

很多 AI Observability 系统记录：

```text
model = gpt-x
```

这仍然不够。

对于金融领域，重要的是：

```text
model identity
model version
provider
deployment
system prompt version
developer prompt version
tool definitions version
retrieval configuration
policy version
model parameters / relevant configuration
safety configuration
evaluator / guardrail version
```

因为：

```text
同一个 model
+
不同 system prompt
+
不同 tool schema
+
不同 retrieval index
```

完全可能得到不同的行为。

FINRA 2026 年报告也明确提到，持续监控可包括保存 prompt/output logs、跟踪使用的 model version 和使用时间，以及 human-in-the-loop review。

因此：

> **Model ID 是 evidence 的一个字段，不是 evidence 本身。**

---

# 15. 第八个区别：Input Provenance 比 Prompt 更重要

很多 Agent observability 设计会记录：

```text
prompt
response
tool call
```

但金融审计往往更需要知道：

```text
Agent 当时实际依据了哪些数据？
```

例如：

```text
User asks:
Should we vote FOR resolution 3?
```

Agent 使用：

```text
Research Document A
Vendor Data B
Internal Position C
Policy D
Meeting Data E
```

最终给出了：

```text
FOR
```

之后发生争议：

> 这个建议依据的资料是什么？

此时只保存：

```text
prompt + final answer
```

几乎没有意义。

更合理的是：

```text
Evidence Input Set
├── source_id
├── source_version
├── retrieved_at
├── entitlement_check
├── content_hash
└── excerpt / reference
```

这实际上已经从：

```text
AI Observability
```

进入：

```text
Decision Evidence
```

---

# 16. “RAG Trace”也不等于“Decision Evidence”

例如：

```text
Retrieval
   ↓
Document A
Document B
Document C
   ↓
LLM
   ↓
Answer
```

Trace 可以证明：

> Agent 检索过 A、B、C。

但还不能证明：

> Agent 的这个判断真正基于 A、B、C 中哪些事实。

更进一步：

```text
Retrieved
≠
Used
```

某个文档进入 context，不代表：

```text
它实际影响了 decision。
```

所以如果业务要求可审计，应该考虑将：

```text
retrieval event
```

和：

```text
decision rationale / source references
```

建立显式关系。

不过这里还有一个重要边界。

---

# 17. Audit Evidence 不应该简单等于“保存 Chain-of-Thought”

这是 AI 审计架构里一个非常重要的误区。

很多团队想到：

> 如果要证明 Agent 为什么这么决定，那就把模型完整 reasoning 全部保存下来。

这并不一定是正确答案。

OpenAI 公开说明过，raw chain-of-thought 不适合直接向用户展示；其研究也说明 chain-of-thought 可以成为安全监控信号，但不意味着它天然就是适合业务审计的最终解释。

BIS Financial Stability Institute 在 2025 年关于 AI explainability 的研究也指出，复杂 AI、尤其是 LLM 的解释存在准确性、稳定性和可能误导的问题。换言之，“给出一个看起来合理的解释”并不自动等于“解释可靠”。

因此更合理的企业设计是：

```text
Raw model reasoning
       │
       ├── Internal monitoring / safety use
       │
       └── not automatically the legal record
       
Decision Evidence
       │
       ├── input facts
       ├── policy checks
       ├── model/version
       ├── tool calls
       ├── approvals
       ├── output
       └── business outcome
```

重点应该是：

> **记录可验证的 decision artifacts，而不是把模型“内心独白”当作监管解释。**

对于高风险决策，可以记录结构化的：

```text
Decision
Decision Factors
Policy Checks
Source References
Risk Flags
Human Review
Final Outcome
```

这通常比保存一大段自然语言 reasoning 更有审计价值。

---

# 18. 第九个区别：Observability 默认是“系统视角”，Evidence 需要“独立性”

这是一个容易被低估的问题。

假设：

```text
Agent
   ↓
Agent-owned logger
```

如果 Agent 被入侵，或者逻辑本身出错：

```text
Agent
   ↓
modify own logs
```

那么：

```text
“Agent 自己说自己做了什么”
```

并不能成为高可信度证据。

AWS Agentic AI Lens 因此特别强调：

> decision artifacts 应放在 Agent 自身 operational scope 之外。

并要求调查人员能够在不依赖 Agent 自己陈述的情况下，重建完整交互链。

这可以直接转化为金融 Agent 的架构原则：

```text
Agent
  ≠
Evidence Custodian
```

更好的结构是：

```text
Agent
   │
   │ emit evidence event
   ▼
Evidence Collector
   ▼
Independent Evidence Store
```

并通过：

```text
separate credentials
access control
immutable / tamper-evident storage
integrity validation
```

降低 Agent 对自己证据链的控制权。

---

# 19. 第十个区别：Regulatory Evidence 有明确的保留和生产义务

Observability backend 通常问：

```text
TTL = 30 days or 90 days?
```

Compliance 体系问：

```text
Retention class?
Legal hold?
Regulatory retention?
Deletion restriction?
Production format?
Access rights?
Who can retrieve?
Can historical data be reconstructed?
```

SEC Rule 17a-4 是一个非常具体的例子：不仅要求电子记录以 WORM 或 audit-trail alternative 的方式保存，还要求记录能够在监管要求下以 reasonably usable electronic format 提供。

这意味着：

```text
“我们还没删”
```

和：

```text
“我们可以在监管要求下可靠提供”
```

不是同一个标准。

---

# 20. 一个真实金融案例：SEC 的 off-channel recordkeeping enforcement

这可能是理解这一主题最好的现实案例之一。

2022 年 9 月，SEC 对 16 家华尔街机构的 widespread recordkeeping failures 提起执法，合计罚款超过 11 亿美元。问题之一就是企业没有保存员工通过个人设备和非正式消息渠道进行的业务通信。SEC 明确指出，这些记录缺失可能使监管调查无法获得所需材料。

这件事最值得 AI 架构师关注的，不是罚款金额，而是：

> **企业不能因为“系统里有很多其他日志”就证明“需要保留的业务记录已经存在”。**

2024 年 SEC 又对多批金融机构持续开展 recordkeeping enforcement。仅 2024 财年，SEC 就表示针对 70 多家机构的 recordkeeping cases 产生了超过 6 亿美元民事罚款；自 2021 年 12 月以来，相关 initiative 已涉及超过 100 家机构、超过 20 亿美元罚款。

这说明：

```text
Recordkeeping
```

本身就是一个独立控制领域。

因此，把：

```text
Observability
```

直接等价于：

```text
Regulatory Recordkeeping
```

在金融机构里尤其危险。

---

# 21. SEC Rule 17a-4 给出了一个很好的设计启示

SEC 当前允许的 audit-trail alternative 要求：

```text
Original Record
      ↓
Modify
      ↓
Modification recorded

Delete
      ↓
Deletion recorded
```

并保留：

```text
timestamp
identity
changes
metadata
```

从而：

```text
Original state
```

仍然可以被重建。

这对于 Agent 平台有非常直接的启发。

例如：

```text
Policy Version v17
```

不能只是当前数据库里：

```text
policy_version = v17
```

而应该能够回答：

```text
当时 v17 的具体内容是什么？

什么时候生效？

谁发布？

有没有在之后被修改？

当时决策实际引用的是哪个版本？
```

所以 evidence architecture 要保存的是：

```text
Versioned Artifact
```

而不是：

```text
Current State
```

---

# 22. 金融 AI 的“现在状态”与“当时状态”是两个问题

例如今天：

```text
agent_version = 5
policy_version = 17
model = X
```

不能证明：

```text
2026-06-01
```

执行时也是这些版本。

因此需要：

```text
Point-in-time reconstruction
```

即：

> 给定一个历史业务事件，系统能够尽可能重建当时真正生效的运行环境。

这通常意味着：

```text
Agent Version
Prompt Version
Tool Version
Model Version
Policy Version
Retrieval Index Version
Data Version
Access Policy Version
```

都需要可追溯。

这其实与传统金融 Model Risk Management 的思想非常接近。

---

# 23. Model Risk Management 早就在要求“可重建”

美联储当前的模型风险管理指导强调：

```text
model development
validation
ongoing monitoring
governance
documentation
```

并特别强调 documentation 的重要性，以及需要了解模型的设计、假设、数据和性能。

2026 年更新后的监管指导仍强调：

* model inventory
* documentation
* validation
* ongoing monitoring
* governance
* third-party model oversight

并明确指出 vendor model 也需要被理解、验证和持续监控。

这意味着对于金融 Agent：

```text
Runtime Trace
```

只是 model / agent lifecycle evidence 的一部分。

真正完整的 evidence 还包括：

```text
Design
Approval
Validation
Deployment
Change
Monitoring
Incident
Remediation
Retirement
```

换句话说：

> **金融 AI 的审计对象不是某一次 prompt，而是完整的 AI control lifecycle。**

---

# 24. FINRA 2026 的 Agent 指导实际上也指向同一个方向

FINRA 2026 年的 Annual Regulatory Oversight Report 对 GenAI 和 Agents 的表述很值得注意。

它没有提出：

```text
“所有 Agent 必须保存完整 trace”
```

而是从 supervision、recordkeeping、accuracy、governance、monitoring 等现有监管义务出发。

对 GenAI monitoring，FINRA 举例指出，企业可能考虑保存：

```text
prompt
output
model version
timestamp
human review
```

对 Agent，则进一步关注：

```text
system access
data handling
human oversight
agent actions
agent decisions
guardrails
```

并明确指出复杂、多步骤 Agent reasoning 会增加 auditability 和 transparency 的难度。

这其实恰好说明：

> **监管关注的不是“有没有一个 tracing 产品”，而是能否实现有效 supervision、recordkeeping 和 reconstruction。**

---

# 25. DORA 进一步强调“恢复”和“数据一致性”

在欧盟金融服务环境中，DORA 也是一个重要参考。

DORA Article 11 要求金融实体建立 documented ICT business continuity、response 和 recovery arrangements，并在相关计划激活时保存活动记录。

Article 12 更直接：

在从 ICT incident 中恢复时，金融实体应进行必要的 checks，包括 reconciliations，以保持数据完整性；从外部 stakeholder 重建数据时也需要检查系统之间的数据一致性。

这里的关键词不是：

```text
logs
```

而是：

```text
records
recovery
checks
reconciliation
data integrity
```

因此金融 Agent 的 evidence architecture 不能只考虑：

```text
“发生了什么调用”
```

还应该保存：

```text
“最终形成了什么业务事实”
```

---

# 26. EU AI Act 也没有把“有 logs”当成全部要求

对于适用的 high-risk AI systems，EU AI Act Article 11 要求 technical documentation；Article 12 要求系统具备自动记录事件的能力，以支持对系统运行的追踪；Article 19 要求 provider 在其控制范围内保存相应自动生成日志至少六个月，除非适用法律另有规定。对于 financial institutions，相关 technical documentation 和 logs 还与金融服务法下的 documentation obligations 发生衔接。

Article 26 对 deployers 也规定了日志保存义务，在适用的情况下至少保存六个月，并要求金融机构将相关 logs 作为适用金融服务法律下 documentation 的一部分。

这里非常值得注意：

```text
Logs
+
Technical Documentation
+
Sector-specific documentation
```

是不同层次。

所以：

> **即使监管法规明确要求 logs，也不能推导出“任意 observability traces 自动满足全部监管 documentation requirements”。**

---

# 27. Observability 的数据模型天然偏“执行”，Evidence 的数据模型应该偏“事实”

可以把二者抽象成两个 schema。

## Observability Event

```json
{
  "trace_id": "abc",
  "span_id": "123",
  "service": "agent-runtime",
  "operation": "submit_order",
  "start_time": "...",
  "duration_ms": 732,
  "status": "OK"
}
```

它很适合回答：

```text
Where did it fail?
How long did it take?
Which service was involved?
```

---

## Evidence Event

```json
{
  "case_id": "...",
  "business_operation_id": "...",
  "initiator": "...",
  "approver": "...",

  "agent_id": "...",
  "agent_version": "...",
  "model_id": "...",
  "model_version": "...",

  "policy_version": "...",
  "authorization_decision": "ALLOW",

  "input_refs": [
    {
      "source_id": "...",
      "version": "...",
      "retrieved_at": "...",
      "content_hash": "..."
    }
  ],

  "decision": "...",
  "decision_reason_codes": [],

  "tool": "...",
  "tool_version": "...",

  "external_system": "...",
  "external_reference": "...",

  "business_effect": "...",

  "timestamp": "...",
  "integrity_metadata": "..."
}
```

它回答的是：

```text
Who?
What?
Why?
Under which policy?
Using which version?
Based on which data?
What happened?
What changed?
Can we prove it later?
```

---

# 28. 最重要的架构原则：不要让 Trace Schema 承担 Evidence Schema

这是很多企业 Agent 平台最容易走偏的地方。

第一阶段：

```text
OpenTelemetry
+
LangSmith
+
CloudWatch
```

非常合理。

第二阶段：

```text
Compliance says:
“Need audit trail.”
```

于是团队开始：

```text
在 trace metadata 里
不断加字段
```

最后：

```text
trace
 ├── user_id
 ├── approval_id
 ├── policy_version
 ├── model_version
 ├── customer_id
 ├── transaction_id
 ├── retention_class
 ├── legal_hold
 ├── risk_level
 ├── external_reference
 ├── source_hash
 └── ...
```

Trace 逐渐变成：

```text
Audit Database
```

这是架构上的危险信号。

原因是二者生命周期不同。

```text
Telemetry
    ├── sampling
    ├── aggregation
    ├── TTL
    └── performance optimization

Evidence
    ├── retention
    ├── legal hold
    ├── immutability
    ├── integrity
    ├── versioning
    ├── production
    └── access governance
```

正确方式不是：

> “把 trace 做得越来越重。”

而是：

> **从 trace 中提取或旁路产生 Evidence Events。**

---

# 29. 推荐的三层架构：Telemetry / Control Record / Evidence

一个金融 Agent 平台可以采用三层：

```text
                    Agent Execution
                           │
            ┌──────────────┼──────────────┐
            │              │              │
            ▼              ▼              ▼
       Telemetry       Control Events   Business Events
            │              │              │
            ▼              ▼              ▼
       Observability     Control Store   Evidence Store
```

具体来说：

## Layer 1：Operational Telemetry

保存：

```text
trace
span
metric
log
latency
token
error
```

主要服务：

```text
SRE
Engineering
AgentOps
Performance
```

---

## Layer 2：Control Records

保存：

```text
authorization decision
policy evaluation
approval
risk decision
entitlement check
human review
guardrail decision
```

主要服务：

```text
Risk
Compliance
Control Owners
Model Risk
```

---

## Layer 3：Business Evidence

保存：

```text
business operation
transaction
instruction
external reference
business outcome
source data
versioned artifact
reconciliation
```

主要服务：

```text
Audit
Legal
Compliance
Regulator
Operations
```

三者通过：

```text
case_id
decision_id
operation_id
trace_id
```

进行关联。

---

# 30. 其中最重要的不是 Trace ID，而是 Evidence Graph

简单的 log archive：

```text
trace_id → spans
```

对于 Agent 不够。

更合理的是一个：

```text
Evidence Graph
```

例如：

```text
Case
 │
 ├── User
 │
 ├── Approval
 │
 ├── Policy Decision
 │
 ├── Agent Run
 │      │
 │      ├── Model
 │      ├── Prompt Version
 │      ├── Retrieval
 │      └── Tool Calls
 │
 ├── Business Operation
 │      │
 │      └── External Reference
 │
 └── Final Business Outcome
```

这样调查人员可以从：

```text
Case ID
```

一路追到：

```text
User
 ↓
Approval
 ↓
Policy
 ↓
Agent
 ↓
Model
 ↓
Input Sources
 ↓
Tool
 ↓
External System
 ↓
Outcome
```

而不是：

```text
先搜 trace
再搜 logs
再搜 database
再搜 approval system
再搜 email
```

这种架构的价值远大于单纯增加日志量。

---

# 31. Evidence Graph 还必须跨异步边界

Agent Workflow 中越来越多：

```text
Queue
Event Bus
Webhook
Callback
Human Task
Scheduled Job
Batch
```

因此：

```text
Trace
```

很容易在这里断掉。

例如：

```text
Agent
  │
  └── EventBus → Worker
                    │
                    └── Vendor API
                              │
                              └── Webhook
                                      │
                                      └── Workflow
```

如果每一跳都重新生成：

```text
trace_id
```

最终得到：

```text
Trace A
Trace B
Trace C
Trace D
```

调查人员无法可靠知道：

```text
A = B = C = D
```

是不是同一个业务事件。

所以应该明确区分：

```text
trace_id
```

和：

```text
business_correlation_id
```

AWS Agentic AI Lens 也明确建议使用独立于 tracing system 的 correlation identifier 穿过异步边界。

---

# 32. “Audit Evidence”不应该依赖单一系统

再成熟的 LangSmith、AgentCore、Azure Monitor、Datadog，都不应该成为：

```text
唯一 regulatory source of truth
```

原因不是它们不够强，而是：

```text
Agent platform
```

只是整个金融业务链的一部分。

真实业务可能是：

```text
Agent
  ↓
Domain API
  ↓
Order Management System
  ↓
Broker
  ↓
Clearing
  ↓
Settlement
```

真正决定业务事实的可能是：

```text
OMS
Broker
Settlement System
```

而不是 Agent trace。

因此 evidence architecture 应该有：

```text
System of Record
        +
Agent Evidence
        +
Control Evidence
        +
External Confirmation
```

最终才能得到完整事实。

---

# 33. “Agent 说它做了”与“业务系统确认做了”必须区分

例如：

```text
Agent Trace:
submit_payment = success
```

并不一定意味着：

```text
Payment Ledger:
PAYMENT = POSTED
```

尤其在：

```text
timeout
message loss
async processing
partial failure
```

情况下。

因此推荐定义：

```text
Agent Observed Outcome
```

和：

```text
Authoritative Business Outcome
```

两个字段。

例如：

```text
agent_observed = SUCCESS

external_system = UNKNOWN
```

这种状态应该被允许存在。

最终：

```text
external_system = POSTED
```

才形成：

```text
Business Fact
```

这和前面的 Recovery Architecture 是完全一致的。

---

# 34. Regulatory Evidence 更接近“证明链”，而不是“日志集合”

一个成熟 evidence package 可以理解为：

```text
Intent
  ↓
Authorization
  ↓
Policy
  ↓
Decision
  ↓
Execution
  ↓
External Confirmation
  ↓
Outcome
```

每一层都应该有可验证的信息。

例如一次交易：

```text
Intent
  └── Client requested trade

Authorization
  └── Authorized actor

Policy
  └── Allowed under Policy v17

Decision
  └── Agent proposed BUY

Approval
  └── Human approved

Execution
  └── Operation ID = OP123

External
  └── Broker Reference = BR456

Outcome
  └── Partially Filled
```

这比：

```text
Trace:
Agent -> Tool -> 200 OK
```

更接近监管调查真正需要的东西。

---

# 35. 证据应该有“Claim → Evidence”关系

金融审计并不是：

```text
collect everything
```

而是：

```text
Claim
  ↓
What evidence proves this?
```

例如：

### Claim

> 这笔交易经过授权。

Evidence：

```text
approval_id
approver
approval_time
authorization_policy
approval_record
```

### Claim

> Agent 当时使用了批准的模型版本。

Evidence：

```text
deployment_id
model_version
release_record
configuration snapshot
```

### Claim

> 客户数据访问符合 entitlement。

Evidence：

```text
entitlement_check
identity
data_object
policy_version
decision = ALLOW
```

### Claim

> 外部系统实际执行了交易。

Evidence：

```text
external_reference
execution report
settlement record
```

这就是：

```text
Evidence Mapping
```

而不是：

```text
Log Collection
```

---

# 36. 这也是为什么“日志越多”不代表“审计能力越强”

很多 Agent 平台会陷入：

```text
More Logs
=
More Compliance
```

其实不是。

假设每天有：

```text
10 TB traces
```

但缺少：

```text
policy version
approval
business reference
external outcome
```

那么这些日志再多，也可能无法证明关键事实。

PCAOB 对 evidence 的要求恰好说明这一点：证据质量取决于 relevant + reliable，而更多同类信息并不能简单弥补低质量证据。

所以：

> **Evidence Quality > Evidence Volume**

这是金融 Agent 平台非常重要的一条原则。

---

# 37. 一个高价值设计：Evidence Manifest

可以给每个重要业务事件生成一个：

```text
Evidence Manifest
```

例如：

```json
{
  "case_id": "CASE-123",
  "operation_id": "OP-456",

  "subject": {
    "business_object": "TRADE",
    "customer_id": "..."
  },

  "actors": {
    "initiator": "...",
    "approver": "..."
  },

  "ai": {
    "agent_id": "...",
    "agent_version": "...",
    "model": "...",
    "model_version": "..."
  },

  "controls": {
    "policy_version": "...",
    "authorization": "ALLOW",
    "entitlement_check": "ALLOW",
    "risk_check": "PASS"
  },

  "inputs": [
    {
      "source_id": "...",
      "version": "...",
      "hash": "..."
    }
  ],

  "execution": {
    "operation_id": "...",
    "trace_id": "...",
    "tool": "...",
    "timestamp": "..."
  },

  "external": {
    "system": "...",
    "reference": "...",
    "result": "..."
  },

  "artifacts": [
    {
      "type": "approval",
      "uri": "...",
      "hash": "..."
    }
  ]
}
```

Evidence Manifest 的作用不是取代原始记录，而是：

> **告诉审计人员“这项业务事实由哪些证据共同支持”。**

因此它更像：

```text
Evidence Index
```

而不是：

```text
source of truth
```

---

# 38. Evidence Manifest 自己也不应该由 Agent 生成并自证

例如：

```text
Agent says:
"Approval = TRUE"
```

不能直接成为：

```text
Evidence Manifest
```

应该由独立的 control system：

```text
Approval Service
```

产生：

```text
approval_id
approver
approval_timestamp
decision
```

同样：

```text
Agent says:
"entitlement = allowed"
```

应该关联：

```text
Entitlement Service
```

真正的 decision record。

因此：

> **关键证据应该尽量来自产生事实的系统，而不是由 Agent 汇总后自我声明。**

这和 PCAOB 对 external/internal evidence reliability 的思路也是一致的。审计人员需要关注信息的来源、维护过程及其控制。

---

# 39. 真实系统中通常需要多个 Evidence Authority

因此可以形成：

```text
Identity Authority
       ↓
Approval Authority
       ↓
Policy Authority
       ↓
Data Entitlement Authority
       ↓
AI Runtime Evidence
       ↓
Business System of Record
       ↓
External Confirmation
```

最终：

```text
Evidence Aggregator
```

把它们组合起来。

这比建立：

```text
“One Big Agent Log”
```

要合理得多。

---

# 40. Evidence retention 也不应该照搬 observability retention

一个非常常见的反模式：

```text
Observability retention = 30 days
```

然后：

```text
Audit retention = 30 days
```

直接复用。

更合理的是：

```text
Telemetry Retention
        ↓
SRE / Cost Policy

Evidence Retention
        ↓
Business / Legal / Regulatory Policy
```

例如：

```text
Low-risk Agent telemetry
    → 30–90 days

High-risk business evidence
    → according to applicable recordkeeping schedule

Legal hold
    → override deletion policy where applicable
```

具体期限必须由适用的：

```text
jurisdiction
business activity
record type
regulatory regime
legal hold
```

决定，不能用一个平台级数字解决所有问题。

---

# 41. Privacy 也不能简单通过“少记日志”解决

金融 Agent 会天然接触：

```text
customer data
portfolio data
transaction data
research data
PII
confidential information
```

所以常见反应是：

```text
为了保护隐私
→ 不保存 prompt
→ 不保存 tool input
→ 不保存 retrieval
```

这又会损害 auditability。

更合理的是：

```text
Capture
   ↓
Classify
   ↓
Minimize
   ↓
Redact / Tokenize
   ↓
Controlled retention
```

AWS Agentic AI Lens 明确把：

```text
tamper-evident logging
+
PII redaction
```

作为成熟 observability / audit trail 的共同要求。

Microsoft Foundry 也明确提醒，traces 可能包含 user inputs、model outputs、tool arguments/results 等敏感信息，因此应对 telemetry 使用适当的 access control、redaction 和 retention。

所以目标不是：

```text
不要记录
```

而是：

> **让 evidence 本身成为受治理的数据资产。**

---

# 42. “原始 Prompt”也未必是最佳 Regulatory Artifact

例如：

```text
System Prompt
+ User Prompt
```

可能包含：

```text
PII
internal secrets
vendor data
security details
```

直接保存原文可能不合适。

因此可以采用：

```text
Prompt Artifact
├── prompt_version
├── content_hash
├── classification
├── storage_reference
└── controlled raw payload
```

同时在 Evidence Manifest 中保存：

```text
prompt_version
prompt_hash
```

审计需要时，由受控流程访问原文。

这样可以同时解决：

```text
Traceability
+
Data Minimization
+
Integrity
```

---

# 43. 对 Agent Decision，推荐保存“Decision Record”，而不是“完整思维过程”

一个 Decision Record 可以是：

```text
decision_id
case_id

decision_type
decision_value

input_facts
source_refs

policy_checks
risk_checks

model_id
model_version

tool_actions

human_review

decision_timestamp

final_business_effect
```

例如：

```text
decision_type = PROXY_VOTE
decision_value = FOR

source_refs = [
  ISS_RESEARCH_v4,
  INTERNAL_POLICY_v12
]

policy_checks = [
  CLIENT_MANDATE_ALLOWED,
  POSITION_EXISTS,
  CONFLICT_CHECK_PASS
]

human_review = APPROVED

operation = VOTE_SUBMIT_123
```

这样的信息对监管、内部控制和事后调查通常比：

```text
LLM generated 15,000 tokens of reasoning
```

更有价值。

---

# 44. 但 Decision Record 也不能“伪造解释”

这里尤其需要谨慎。

不要让模型输出：

```text
"我做这个决定是因为 A、B、C。"
```

然后把这段话直接当作：

```text
Audit Explanation
```

原因是模型生成的 explanation 本身可能不可靠。

BIS 2025 年关于 explainability 的研究明确提醒，复杂 AI 的 post-hoc explanation 可能存在：

```text
inaccuracy
instability
misleading explanation
```

因此：

```text
Generated Explanation
```

应该与：

```text
Evidence-backed Decision Factors
```

分开。

前者可以帮助人阅读。

后者才应该支撑关键合规判断。

---

# 45. 一个更可靠的模式：Decision Record + Supporting Evidence

```text
Decision Record
       │
       ├── Decision
       ├── Policy Results
       ├── Risk Results
       ├── Source References
       └── Human Approval
              │
              ▼
       Supporting Evidence
              │
       ├── Source Documents
       ├── Model Metadata
       ├── Tool Results
       ├── External Records
       └── Business System State
```

这样：

```text
Natural-language explanation
```

只是：

```text
presentation layer
```

而不是：

```text
proof layer
```

---

# 46. 一个重要的金融架构边界：Observation ≠ Decision ≠ Outcome

这是整个问题最值得形成的平台标准之一。

### Observation

```text
Agent retrieved document A
```

### Decision

```text
Agent recommended BUY
```

### Authorized Decision

```text
Human approved BUY
```

### Execution

```text
Order submitted
```

### Outcome

```text
Broker accepted 10,000 shares
```

这五件事必须分开。

否则：

```text
Agent trace:
tool call successful
```

很容易被误读成：

```text
business decision successful
```

更不用说：

```text
business outcome successful
```

---

# 47. 对金融 Agent，最重要的 Evidence Chain 可以这样设计

```text
                ┌───────────────┐
                │ Human / Event │
                └───────┬───────┘
                        │
                        ▼
                  Intent Record
                        │
                        ▼
                Agent Execution
                        │
          ┌─────────────┼─────────────┐
          ▼             ▼             ▼
       Model         Retrieval       Tools
          │             │             │
          └─────────────┼─────────────┘
                        ▼
                 Decision Record
                        │
                        ▼
                 Policy Decision
                        │
                        ▼
                    Approval
                        │
                        ▼
                Business Operation
                        │
                        ▼
                External System
                        │
                        ▼
                Authoritative State
                        │
                        ▼
                Evidence Manifest
```

其中：

```text
Observability
```

贯穿整个链路。

但是：

```text
Evidence Manifest
```

是另外一条面向审计的组织结构。

---

# 48. Evidence 需要“完整性”，但也需要“完整覆盖”

这两个概念很容易混淆。

### Integrity

> 保存下来的东西有没有被改？

### Completeness

> 应该保存的东西是不是都保存了？

一个系统可能：

```text
Integrity = Excellent
Completeness = Poor
```

例如：

```text
所有 trace 都用了 WORM
```

但是：

```text
approval system 没接入
external outcome 没接入
failed calls 没记录
manual intervention 没记录
```

那么：

```text
完整性很好
但证据链不完整
```

PCAOB 对企业生成的信息同样强调 accuracy 和 completeness 的控制，而不是单纯保存。

所以：

> **Immutable incomplete evidence 仍然是不完整的 evidence。**

---

# 49. 成功请求反而是必须保存的

Observability 很容易偏向：

```text
只关心异常
```

比如：

```text
ERROR
WARN
TIMEOUT
```

但 Audit Evidence 更关心：

```text
What actually happened?
```

因此：

```text
SUCCESS
```

同样重要。

AWS Agentic AI Lens 也明确指出，只记录 errors 和 exceptions 而不记录成功操作，会导致 sequence reconstruction 不完整。

金融业务尤其如此。

例如监管调查：

> 为什么某项交易获得批准？

需要看到：

```text
成功的 policy evaluation
成功的 approval
成功的 execution
```

而不只是：

```text
失败的日志
```

---

# 50. Manual intervention 也必须进入 Evidence Chain

Agent 出现异常时，操作员可能：

```text
修改参数
重跑一次
手工批准
取消交易
联系 Vendor
重新提交
```

如果这些行为只存在于：

```text
Slack
Teams
Email
电话
```

而没有进入业务 evidence chain，就会出现：

```text
Agent trace 完整
+
Human recovery 没有记录
```

最终无法回答：

> 为什么最终业务状态和 Agent 原始执行不同？

因此 Manual Intervention 应当产生：

```text
intervention_id
actor
timestamp
reason
old_state
new_state
approved_by
case_id
operation_id
```

并与原始 operation 关联。

---

# 51. 这正是“Agent Auditability”真正难的地方

传统应用：

```text
User
 ↓
API
 ↓
Service
 ↓
DB
```

Agent：

```text
User
 ↓
Agent
 ├── LLM
 ├── Retrieval
 ├── Memory
 ├── Tool A
 ├── Tool B
 ├── Sub-agent
 ├── Event
 ├── Human approval
 └── External system
```

问题已经从：

```text
“记录一次 API 调用”
```

升级为：

```text
“重建一个跨多系统、多主体、多状态、多时间点的因果链。”
```

FINRA 2026 也明确指出，多步骤 Agent reasoning 会让 auditability / transparency 更难。

因此 Agent 的 regulatory evidence 不能简单理解为：

```text
Observability × 2
```

而需要：

```text
Business semantics
+
Control evidence
+
External authoritative records
```

---

# 52. 一个推荐的数据架构

可以把平台划成：

```text
                  ┌─────────────────────┐
                  │     Agent Runtime   │
                  └──────────┬──────────┘
                             │
                     emits telemetry
                             │
               ┌─────────────┴─────────────┐
               ▼                           ▼
      ┌────────────────┐          ┌─────────────────┐
      │ Observability  │          │ Evidence Events │
      │ Pipeline       │          │ Pipeline        │
      └───────┬────────┘          └────────┬────────┘
              │                            │
              ▼                            ▼
       Trace / Metrics /             Evidence Store
       Logs / Evaluations                 │
                                          │
                             ┌────────────┼─────────────┐
                             ▼            ▼             ▼
                         Policy      Approval      Business
                         Records     Records       Records
                             │            │             │
                             └────────────┼─────────────┘
                                          ▼
                                  Evidence Manifest
                                          │
                                          ▼
                                    Audit / Legal
```

这里：

```text
Observability Pipeline
```

可以使用：

```text
OpenTelemetry
LangSmith
AgentCore
Azure Monitor
Datadog
```

等产品。

而：

```text
Evidence Store
```

应该是企业自己的 control / recordkeeping architecture，而不是简单把 observability backend 当作最终证据仓库。

---

# 53. Evidence Store 应该与 Agent Runtime 解耦

不建议：

```text
Agent
 ↓
write audit log
```

更不建议：

```text
Agent
 ↓
delete / rewrite audit log
```

应该是：

```text
Agent
 ↓
Evidence Event
 ↓
Collector
 ↓
Policy Validation
 ↓
Evidence Store
```

并考虑：

```text
separate identity
separate credentials
write-only path
tamper-evident storage
retention policy
legal hold
access logging
```

这也是 AWS Agentic AI Lens 强调 independent, tamper-evident artifact storage 的原因。

---

# 54. Evidence 应该采用事件模型，而不是只保存最终快照

例如：

```text
Current state:
status = APPROVED
```

远远不够。

应该保存：

```text
2026-09-20 10:01  PROPOSED
2026-09-20 10:02  POLICY_CHECKED
2026-09-20 10:03  APPROVED
2026-09-20 10:04  SUBMITTED
2026-09-20 10:04  ACKNOWLEDGED
2026-09-20 10:05  EXECUTED
```

这样才能：

```text
reconstruct
```

而不是：

```text
inspect current state
```

这与 SEC Rule 17a-4 audit-trail alternative 的思想高度一致：重要的不是当前值是什么，而是能否重建原始记录和发生过的变更。

---

# 55. 对 Agent Version 也应该采用 event history

不要只有：

```text
agent_version = 6
```

还应该能查询：

```text
Deployment
Change
Approval
Effective Time
Rollback
```

例如：

```text
Agent v5
  │
  ├── approved 09:00
  ├── deployed 09:05
  └── retired 12:00

Agent v6
  │
  ├── approved 11:30
  └── deployed 12:00
```

这样一笔 11:45 的操作才能证明：

```text
Agent v5
```

而不是根据今天的：

```text
Agent v6
```

倒推过去。

---

# 56. 同样的问题存在于 Policy

例如：

```text
Current Policy = v21
```

但交易发生时是：

```text
Policy = v19
```

如果没有：

```text
effective_from
effective_to
version hash
publication event
approval event
```

之后很难证明：

```text
当时哪个 policy 生效。
```

因此：

> **Regulatory Evidence 的核心不是保存当前状态，而是保存历史时间点的可验证状态。**

---

# 57. 对模型来说也是一样

模型经常：

```text
provider
model_name
```

不断变化。

甚至：

```text
same model name
```

也可能存在：

```text
backend update
system configuration
safety layer
routing
```

因此生产级 Agent evidence 至少应该能定位：

```text
logical model
model release/version
provider deployment
request timestamp
configuration reference
```

对于部分场景，还需要：

```text
temperature / sampling parameters
tool configuration
retrieval config
guardrail version
```

具体记录项应该根据：

```text
risk
materiality
business use
regulatory requirements
```

决定，而不是机械地把每一个模型参数永久保存。

---

# 58. Vendor AI 尤其容易产生 Evidence Gap

金融企业越来越可能：

```text
Agent Platform
      ↓
Vendor LLM
      ↓
Vendor Guardrail
      ↓
Vendor Retrieval
```

这会导致：

```text
Vendor Observable
≠
Bank Auditable
```

例如：

```text
Vendor:
“we provide trace.”
```

并不能自动回答：

```text
Bank:
“我们能不能满足自己的 recordkeeping requirements?”
```

Fed 当前的模型风险指导明确指出，第三方 vendor model 可能因为 proprietary code、data 或 methodology 而存在 validation challenges；金融机构仍然需要理解、验证和持续监控 vendor model，并适当记录 vendor model 的使用与定制。

这意味着：

> **Vendor Observability 是能力输入，不是金融机构自身的 regulatory evidence conclusion。**

---

# 59. 第三方平台必须做 Evidence Contract

如果 Agent Platform 调用：

```text
Vendor LLM
Vendor RAG
Vendor Tool
Vendor Broker
```

应该定义：

```text
Evidence Contract
```

至少明确：

```text
What is logged?
Who owns the records?
Who can delete?
How long retained?
Can original records be reconstructed?
How is integrity protected?
What identifiers are exposed?
Can records be exported?
What happens after service termination?
What is the timestamp source?
What is the incident / legal hold process?
```

这样才能真正回答：

> 如果监管五年后要求查一笔交易，我们还能不能重建当时的 Agent execution？

---

# 60. Time synchronization 是一个容易遗漏的 evidence 问题

Observability 往往假设：

```text
timestamp ≈ timestamp
```

但跨：

```text
Agent
Vendor
Broker
Human Approval
Batch
```

系统时，时间精度可能不同。

而审计常常需要判断：

```text
Did approval happen before execution?
```

如果记录显示：

```text
Approval: 10:01:03
Execution: 10:01:02
```

就需要知道：

```text
clock drift?
timezone?
event ingestion delay?
source timestamp?
```

所以 Evidence Record 最好区分：

```text
event_time
ingestion_time
processing_time
```

并明确时间来源。

这又是为什么：

```text
trace timestamp
```

不能简单等同于：

```text
regulatory event time
```

---

# 61. Evidence 的“来源优先级”也应该定义

对于一个关键事实：

```text
Transaction executed = ?
```

可以存在：

```text
Agent trace
API response
OMS record
Broker execution report
Settlement record
```

这些证据的可靠性不应默认相同。

通常应该明确：

```text
Authoritative source
Supporting source
Observational source
```

例如：

```text
Settlement record
    = authoritative

Broker Execution Report
    = primary supporting

Agent trace
    = operational supporting
```

这与 PCAOB 对 evidence source reliability 的思想相一致：证据来源、独立性、维护过程以及控制都会影响其可靠性。

---

# 62. 因此不应该把“Trace = Truth”

一个非常重要的平台原则：

> **Trace 是系统对执行过程的观察，不自动等于业务世界的真相。**

例如：

```text
Agent Trace:
payment submitted = true
```

可能只是：

```text
API returned 202
```

真正的业务事实可能是：

```text
Payment = PENDING
```

或者：

```text
Payment = REJECTED
```

因此：

```text
Observation
```

和：

```text
Authoritative Outcome
```

必须区分。

---

# 63. 一个金融 Agent 应该至少有四种“事实”

可以定义：

```text
Observed Fact
```

系统看到什么。

```text
Control Fact
```

控制系统确认什么。

```text
Business Fact
```

业务系统实际发生什么。

```text
Regulatory Record
```

企业为了证明上述事实而保存什么。

例如：

```text
Observed:
Agent called submit_order

Control:
Policy engine allowed it

Business:
Broker accepted order

Regulatory:
Evidence package proves authorization and execution
```

这比一条“超级 trace”清晰得多。

---

# 64. 一个成熟的 Evidence Lifecycle

建议：

```text
Capture
  ↓
Normalize
  ↓
Classify
  ↓
Correlate
  ↓
Validate
  ↓
Protect
  ↓
Retain
  ↓
Query
  ↓
Produce
  ↓
Dispose
```

分别代表：

### Capture

从：

```text
Agent
Policy
Approval
Business System
External System
```

取得原始证据。

### Normalize

统一：

```text
timestamp
identity
operation_id
version
schema
```

### Classify

确定：

```text
business-critical?
regulatory?
sensitive?
legal hold candidate?
```

### Correlate

建立：

```text
case_id
decision_id
operation_id
trace_id
```

### Validate

检查：

```text
complete?
accurate?
consistent?
```

### Protect

采用：

```text
tamper-evident
access control
encryption
```

### Retain

根据：

```text
regulation
policy
contract
legal hold
```

保存。

### Query / Produce

能够：

```text
reconstruct
export
search
```

### Dispose

只有满足：

```text
retention expired
no legal hold
no regulatory restriction
```

才能删除。

这已经是：

```text
Records Management
```

而不是：

```text
Observability
```

---

# 65. “Audit Evidence”需要一个明确 Owner

一个常见问题：

```text
SRE owns logs
Security owns CloudTrail
AI team owns LangSmith
Data team owns data
Compliance owns policy
Operations owns transaction
```

最后：

```text
Nobody owns evidence
```

这是不行的。

建议明确：

```text
Evidence Owner
```

负责：

```text
schema
capture coverage
retention
integrity
access
retrieval
regulatory mapping
testing
```

同时让：

```text
SRE
Security
AI Platform
Business
Compliance
Legal
Internal Audit
```

共同参与设计。

---

# 66. Auditability 应该进入 Architecture Review，而不是上线后补

一个 Agent Use Case 从一开始就应该回答：

```text
What business action can it take?
What records does that action generate?
Which regulation applies?
What evidence must exist?
Who is the authoritative source?
How long must it be retained?
How can investigators reconstruct the event?
```

而不是上线以后再问：

```text
“LangSmith 有没有 audit export？”
```

因为产品能力解决不了业务证据模型没有定义的问题。

---

# 67. 推荐的 Architecture Decision Record

对于每个金融 Agent，可以建立：

```text
Agent Evidence Profile
```

例如：

```yaml
agent:
  id: proxy-vote-agent
  version: 4.2

business_risk:
  tier: high

regulated_activities:
  - proxy_voting

authoritative_records:
  - vote_instruction_system
  - vendor_submission_system

required_evidence:
  - initiator
  - approval
  - policy_decision
  - agent_version
  - model_version
  - source_documents
  - tool_invocation
  - external_reference
  - final_business_outcome

telemetry:
  trace: required
  metrics: required

evidence:
  immutable: true
  retention_class: financial-record
  legal_hold: supported

correlation:
  business_operation_id: required
  trace_id: required
```

这样：

```text
Agent Deployment
```

就可以自动继承：

```text
Evidence Policy
```

而不是每个团队凭经验决定。

---

# 68. Observability 和 Evidence 可以共享技术基础设施，但不能共享语义

这一点非常重要。

可以共享：

```text
OpenTelemetry
S3
Kafka
EventBridge
PostgreSQL
Object Storage
IAM
KMS
SIEM
```

但不应该共享：

```text
schema semantics
retention assumptions
ownership
lifecycle
authority
```

例如：

```text
OpenTelemetry
```

完全可以同时服务：

```text
Operational Telemetry
```

和：

```text
Evidence Event Capture
```

但不能因此得出：

```text
OTel trace
=
Regulatory record
```

技术层可以共用。

治理层必须分开。

---

# 69. LangSmith、AgentCore、Foundry 应该处于什么位置？

如果企业已经使用：

```text
LangSmith
AWS AgentCore
Microsoft Foundry
OpenTelemetry
```

不需要因为本文结论而放弃它们。

正确的位置是：

```text
                    Agent
                      │
                      ▼
               Agent Runtime
                      │
             ┌────────┴────────┐
             │                 │
             ▼                 ▼
       Observability       Evidence Events
             │                 │
      ┌──────┴──────┐          ▼
      │             │    Evidence Platform
 LangSmith      AgentCore       │
 OTel            Foundry        │
      │             │            │
      ▼             ▼            ▼
Operational      Tracing     Audit Evidence
Visibility
```

这些 observability 平台仍然非常重要，因为：

```text
Audit without observability
```

同样会很痛苦。

问题只是：

> **不要把 observability backend 当成全部 evidence architecture。**

---

# 70. 如何判断一个 Observability 平台的数据能不能直接作为证据？

可以用一个简单的六问。

### 第一问：它记录的是“运行”，还是“受监管事实”？

如果只有：

```text
span
latency
tool call
```

通常不够。

### 第二问：能否关联授权？

```text
who approved?
```

### 第三问：能否关联版本？

```text
which policy/model/configuration?
```

### 第四问：能否证明完整性？

```text
can original record be reconstructed?
```

### 第五问：能否证明完整性覆盖？

```text
what was NOT logged?
```

### 第六问：能否在未来生产？

```text
retention
legal hold
export
access
```

如果其中多项答案为：

```text
No
```

那它就是：

```text
Observability
```

而不是：

```text
Regulatory Evidence Platform
```

---

# 71. 一个更实用的成熟度模型

可以把企业 Agent 的能力分成五级。

## Level 1：Application Logs

```text
Agent started
Tool failed
Response generated
```

只能基本排错。

---

## Level 2：Distributed Tracing

```text
Trace
Span
Tool Calls
LLM Calls
```

可以重建执行路径。

这是现代 Agent Observability 的基础。

---

## Level 3：Controlled Observability

增加：

```text
standard schema
correlation
prompt/model metadata
PII controls
retention
access control
```

已经可以支持较成熟的 AgentOps。

---

## Level 4：Evidence-Ready

增加：

```text
business operation ID
policy decision
approval
source provenance
external reference
immutable/tamper-evident archive
versioned artifacts
authoritative outcome
```

此时已经可以支撑部分合规调查和内部控制。

---

## Level 5：Regulatory Evidence Architecture

进一步具备：

```text
regulatory mapping
record classification
retention schedule
legal hold
evidence manifest
cross-system reconciliation
independent evidence authority
production workflow
integrity validation
point-in-time reconstruction
audit testing
```

这才是真正意义上的：

```text
Regulatory Audit Evidence Capability
```

---

# 72. 这五级里最容易出现的误判

很多企业实际上处于：

```text
Level 2 / Level 3
```

但内部材料已经开始写：

```text
“Agent is fully auditable.”
```

这很容易把：

```text
Observability maturity
```

误写成：

```text
Audit maturity
```

二者应该明确拆开。

例如：

```text
Observability Maturity: Level 4
Evidence Maturity: Level 2
```

完全可能。

而且这在实际企业里并不罕见。

---

# 73. Auditability 不能用一个 KPI 表示

不要用：

```text
Trace Coverage = 99%
```

推出：

```text
Auditability = 99%
```

这在逻辑上是不成立的。

因为真正的 auditability 至少包括：

```text
Capture Coverage
+
Business Context Coverage
+
Authorization Coverage
+
Integrity
+
Retention
+
Reconstruction
+
Authoritative Outcome
```

可以把它理解为：

```text
Auditability
=
Coverage
×
Integrity
×
Context
×
Retention
×
Reconstructability
```

这只是一个架构分析模型，不是监管规定或行业标准公式。

它表达的只是：

> 某一项能力为零时，整体证据能力也可能出现实质缺口。

---

# 74. 最有价值的测试不是“Trace 能不能查到”

真正应该做的是：

> **Regulatory Reconstruction Test**

随机选择一笔历史业务事件：

```text
Case ID = X
```

然后要求一个没有参与原开发的调查人员回答：

```text
谁发起？
谁批准？
Agent 是哪个版本？
Model 是哪个版本？
Policy 是哪个版本？
Agent 看到了什么？
访问了哪些数据？
调用了哪些工具？
哪些控制通过？
哪个外部系统收到请求？
最终是否执行？
最终业务状态是什么？
是否发生人工介入？
为什么允许这次操作？
所有这些证据是否可以验证完整性？
```

如果团队只能：

```text
打开 LangSmith
看 trace
```

然后再：

```text
查 Slack
查数据库
查 email
查某个 vendor portal
```

最后仍不能完整回答：

```text
What happened?
Why was it allowed?
What was the final outcome?
```

那么：

```text
Observability ≠ Audit Evidence
```

这个架构事实就已经被现实验证了。

---

# 75. 反向测试也很重要：Evidence Completeness Test

再随机选择一笔：

```text
Business Transaction
```

从：

```text
System of Record
```

开始反查：

```text
Can I find the Agent Execution?
Can I find the Policy Decision?
Can I find the Approval?
Can I find the Model Version?
Can I find the Input Sources?
Can I find the Tool Call?
Can I find the External Result?
```

这叫：

```text
Backward Reconstruction
```

比：

```text
Forward Trace Search
```

更能发现 evidence gaps。

---

# 76. Incident Response 和 Regulatory Investigation 也应该分开设计

Observability 通常支持：

```text
Incident Response
```

例如：

```text
Service X is failing
```

Regulatory Investigation 则可能是：

```text
Why did Client Y receive this recommendation on Date Z?
```

前者需要：

```text
fast
searchable
correlated
```

后者需要：

```text
historical
complete
authoritative
immutable
defensible
```

因此可以有：

```text
Observability Query Interface
```

和：

```text
Evidence Investigation Interface
```

前者给：

```text
SRE
```

后者给：

```text
Compliance
Audit
Legal
```

两者可以共享底层数据，但不能假设是同一个产品界面。

---

# 77. Evidence Query 应该支持“按业务事件”搜索

不要要求合规人员知道：

```text
trace_id = abc123
```

他们更可能知道：

```text
Client
Trade ID
Case ID
Meeting ID
Order ID
Review Case
Date Range
```

因此 evidence platform 应支持：

```text
Business-first Search
```

例如：

```text
Find all Agent decisions
for Client X
between 2026-06-01 and 2026-06-30
that resulted in a trade.
```

然后系统自动找到：

```text
Case
Decision
Approval
Agent Run
Trace
Tool Calls
External Record
```

这才是审计真正需要的用户体验。

---

# 78. Compliance 不应该直接依赖 Trace UI

Trace UI 是工程界面。

它通常假设使用者知道：

```text
span
trace
latency
token
model
service
```

而审计更关注：

```text
assertion
control
exception
evidence
business event
```

因此需要一个：

```text
Evidence View
```

例如：

```text
Transaction: TR-10293

Business Event
  BUY 10,000 XYZ

Authorization
  Approved by: User A

Policy
  Policy v17 → PASS

AI
  Agent v4.2
  Model X release 2026-08

Inputs
  Research A
  Mandate B
  Position C

Execution
  OMS Ref: OMS-8831

Outcome
  Filled 10,000

Supporting Evidence
  [5 records]
```

底层当然可以链接回：

```text
LangSmith Trace
```

但不应该要求审计人员直接从 trace 拼事实。

---

# 79. 一个更完整的金融 Agent Evidence Package

最终可以组织成：

```text
Evidence Package
│
├── 01 Intent
│
├── 02 Identity
│
├── 03 Authorization
│
├── 04 Policy Decision
│
├── 05 Approval
│
├── 06 Agent Configuration
│
├── 07 Model Metadata
│
├── 08 Input Provenance
│
├── 09 Tool / Action History
│
├── 10 External System Records
│
├── 11 Business Outcome
│
├── 12 Exceptions / Recovery
│
├── 13 Human Intervention
│
└── 14 Integrity / Retention Metadata
```

注意：

```text
LangSmith Trace
```

可能只是：

```text
09 Tool / Action History
```

中的一个 supporting artifact。

---

# 80. 对平台来说，最值得建设的是 Evidence Policy，而不是 Audit Log API

不要从：

```text
POST /audit-log
```

开始。

应该从：

```text
What must be evidenced?
```

开始。

例如：

```yaml
business_action:
  type: trade_execution

evidence_requirements:
  identity: required
  authorization: required
  approval: required
  policy_version: required
  agent_version: required
  model_version: required
  input_provenance: required
  external_reference: required
  business_outcome: required
  human_intervention: required_if_any

integrity:
  tamper_evident: true

retention:
  class: securities-record

reconstruction:
  required: true
```

平台再根据这个 policy 自动产生：

```text
capture rules
routing
retention
storage
validation
evidence manifest
```

---

# 81. 对 Agent Tool，也应该有 Evidence Contract

普通 Tool Contract：

```typescript
execute(input): Promise<Output>
```

金融 Tool Contract 更适合：

```typescript
interface FinancialOperation {
  execute(input: Input): Promise<Output>;

  evidence: {
    operationType: string;
    riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

    requiredContext: string[];

    authoritativeSystem: string;

    requiredApprovals?: string[];

    requiredPolicyChecks?: string[];
  };
}
```

这样：

```text
Tool
```

从一开始就声明：

```text
“I am not just a function. I am a business operation with evidence obligations.”
```

---

# 82. 最终应该区分四种 Store

对于企业金融 Agent 平台，一个比较清晰的划分是：

```text
1. Telemetry Store
2. Workflow / Control State Store
3. Business System of Record
4. Evidence Store
```

### Telemetry Store

```text
trace
span
metrics
logs
```

### Workflow / Control State

```text
workflow state
policy decision
approval
recovery
```

### Business System of Record

```text
order
payment
position
vote
account
settlement
```

### Evidence Store

```text
retained records
evidence manifests
versioned artifacts
integrity metadata
```

四者可能：

```text
物理上共享基础设施
```

但：

```text
逻辑职责
ownership
retention
access
```

应该清晰。

---

# 83. “Observability ≠ Regulatory Audit Evidence”真正要解决的不是工具问题，而是治理问题

如果只是工具：

```text
LangSmith vs Datadog
AgentCore vs Foundry
OpenTelemetry vs vendor tracing
```

这个问题很快就会变成产品选型。

其实真正的问题是：

```text
What is the business fact?
What proves it?
Who owns the proof?
How is it preserved?
Who can alter it?
How do we retrieve it?
```

换句话说：

> **Regulatory evidence 是 Governance Architecture，不是 Observability Feature。**

---

# 84. 最终推荐的分层模型

可以把整个体系浓缩成四层：

```text
┌──────────────────────────────────────────┐
│             Business Outcome             │
│          “What actually happened?”       │
└─────────────────────┬────────────────────┘
                      │
┌─────────────────────▼────────────────────┐
│             Evidence Layer               │
│ identity / approval / policy / outcome   │
│ provenance / integrity / retention       │
└─────────────────────┬────────────────────┘
                      │
┌─────────────────────▼────────────────────┐
│             Control Layer                │
│ authorization / entitlement / risk       │
│ workflow / human oversight / policy      │
└─────────────────────┬────────────────────┘
                      │
┌─────────────────────▼────────────────────┐
│          Observability Layer             │
│ traces / logs / metrics / evaluations    │
└──────────────────────────────────────────┘
```

这个顺序很重要。

不能反过来：

```text
Trace
 ↓
“所以我们推断 business outcome”
```

应该是：

```text
Business Outcome
 ↓
Evidence
 ↓
Control
 ↓
Observability
```

Observability 提供过程可见性。

Evidence 负责证明。

Control 负责解释为什么允许。

Business System 负责记录最终事实。

---

# 85. 一个最终可以直接用于 Architecture Review 的问题

对于任何金融 Agent，只问一句：

> **“五年以后，一个完全不了解这个系统的监管检查人员，只拿到 Case ID，我们能否在不依赖 Agent 自己解释的情况下，重建这次业务行为，并证明它为什么被允许、使用了什么、谁批准、最终发生了什么？”**

如果答案是：

```text
可以
```

那么才有比较成熟的 regulatory auditability。

如果答案是：

```text
可以看 LangSmith trace
```

那么只是：

```text
Observability
```

如果答案是：

```text
需要开发人员帮忙翻日志
再查数据库
再找 Slack
再找 vendor
```

那么：

```text
Evidence architecture
```

还没有建立。

---

# 86. 最终架构原则

综合 OpenTelemetry、AWS Agentic AI Lens、Microsoft Foundry、金融监管机构关于 recordkeeping / model risk / GenAI supervision 的公开材料，可以得到一组相对稳定的架构原则。

### 原则 1：Observability 是必要条件，但不是充分条件

没有 observability，Agent 很难调查。

但有 observability，不自动意味着：

```text
regulatory auditable
```

---

### 原则 2：Trace ≠ Record

Trace 是技术执行记录。

Record 是具有规定保存、完整性和生产要求的业务/监管记录。

---

### 原则 3：Trace ID ≠ Business Evidence ID

应该有：

```text
trace_id
+
case_id
+
decision_id
+
operation_id
```

---

### 原则 4：Current State ≠ Historical Evidence

真正需要的是：

```text
point-in-time reconstructability
```

而不是当前数据库值。

---

### 原则 5：Immutable ≠ Complete

即使：

```text
WORM
```

做得很好，如果漏记录：

```text
approval
policy
external outcome
```

仍然是不完整证据。

---

### 原则 6：More Logs ≠ Better Evidence

证据价值取决于：

```text
relevance
reliability
completeness
context
integrity
```

而不是数据量。PCAOB 对 audit evidence 的相关性、可靠性以及 sufficiency 的要求很好地体现了这一点。

---

### 原则 7：Business System of Record 优先于 Agent Self-report

Agent trace 可以证明：

```text
Agent observed X
```

但最终业务事实应尽可能来自：

```text
authoritative business system
```

---

### 原则 8：Policy / Approval / Authorization 必须成为 Evidence

不能只记录：

```text
Agent called Tool
```

还需要知道：

```text
为什么允许？
谁批准？
适用什么 Policy？
```

---

### 原则 9：不要把 Raw Chain-of-Thought 当成默认审计记录

应该优先建设：

```text
Decision Record
+
Supporting Evidence
```

而不是简单保存整个模型思维过程。复杂 AI 的解释本身也可能存在不稳定和误导风险。

---

### 原则 10：Evidence Store 应独立于 Agent Runtime 的控制范围

Agent 可以：

```text
emit
```

但不应该能够：

```text
rewrite
delete
```

自己的关键证据。AWS Agentic AI Lens 对独立、不可篡改的 evidence storage 也采取类似设计方向。

---

### 原则 11：Retention 必须由监管与业务定义

不能简单：

```text
Observability retention = Regulatory retention
```

---

### 原则 12：Regulatory Evidence 是企业控制平面的一部分

它不属于：

```text
Agent Runtime
```

也不应该只是：

```text
LLM Observability
```

它更适合位于：

```text
Enterprise Control Plane
```

---

# 87. 最后的架构判断

对于金融 Agent，最危险的一句话不是：

> “我们没有 audit logs。”

而是：

> **“我们有完整 traces，所以已经 fully auditable。”**

前一句至少明确知道存在缺口。

后一句则可能掩盖更严重的问题：

```text
Trace exists
but

business context missing
authorization missing
policy version missing
source provenance missing
external outcome missing
record integrity unverified
retention not guaranteed
historical reconstruction impossible
```

真正成熟的金融 Agent 架构应该是：

```text
                    ┌───────────────────┐
                    │       Agent       │
                    │  reason / propose │
                    └─────────┬─────────┘
                              │
                              ▼
                    ┌───────────────────┐
                    │ Workflow / Policy │
                    │ authorize / allow │
                    └─────────┬─────────┘
                              │
                              ▼
                    ┌───────────────────┐
                    │ Business Action   │
                    └─────────┬─────────┘
                              │
              ┌───────────────┼────────────────┐
              │               │                │
              ▼               ▼                ▼
        Observability     Control Events   Business Records
              │               │                │
              └───────────────┼────────────────┘
                              ▼
                    ┌───────────────────┐
                    │ Evidence Platform │
                    │                   │
                    │ correlation       │
                    │ provenance        │
                    │ integrity         │
                    │ retention          │
                    │ reconstruction     │
                    └─────────┬─────────┘
                              │
                              ▼
                    Audit / Compliance /
                    Legal / Regulator
```

因此，真正合理的关系不是：

```text
AI Observability
        =
Regulatory Audit Evidence
```

而是：

```text
AI Observability
        │
        │ one source of execution evidence
        ▼
Evidence Architecture
        │
        ├── Identity
        ├── Authorization
        ├── Policy
        ├── Approval
        ├── Model / Agent Version
        ├── Data Provenance
        ├── Tool Execution
        ├── External Record
        ├── Business Outcome
        ├── Integrity
        └── Retention
                │
                ▼
        Regulatory Audit Evidence
```

最核心的一句话可以归纳为：

> **Observability 让你能够看到系统发生了什么；Regulatory Audit Evidence 要让你能够证明一个受监管事实确实发生了、为什么被允许、由谁负责、依据什么、最终产生了什么结果，而且多年以后仍然可以重建和验证。**

这两个目标高度相关，但不是同一个架构问题。

对企业 Agent 平台而言，最成熟的做法不是把 LangSmith、OpenTelemetry、AgentCore 或其他 tracing 产品“改造成审计系统”，而是：

> **把它们作为 Observability Layer，然后在上面建立独立的 Control Record、Business Evidence 和 Evidence Management 能力。**

这样才能避免一个非常典型的金融技术陷阱：

```text
有很多 telemetry
        ↓
看起来非常透明
        ↓
误以为已经可审计
        ↓
真正需要监管重建时
        ↓
发现关键事实没有被保存
```

真正的目标应该是：

```text
Observable
        +
Controlled
        +
Attributable
        +
Reconstructable
        +
Provable
```

而不是单纯：

```text
Traceable
```

---

# 参考资料

1. **OpenTelemetry — Observability Primer**
   OpenTelemetry 对 observability、telemetry、traces、metrics、logs 的官方定义。
   [OpenTelemetry Observability Primer](https://opentelemetry.io/docs/concepts/observability-primer/?utm_source=chatgpt.com)

2. **AWS Well-Architected — Agentic AI Lens: Observability and Monitoring**
   关于 Agent tracing、decision paths、tool invocation、memory operations、workflow monitoring 以及 immutable audit trails 的分层实践。
   [AWS Agentic AI Lens — Observability and monitoring for agentic systems](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentops05.html?utm_source=chatgpt.com)

3. **AWS Well-Architected — Agentic AI Lens: Agent Observability and Non-repudiation**
   关于独立证据存储、initiating source、跨异步边界 correlation、tamper-evident evidence 和历史 reconstruction。
   [AWS Agentic AI Lens — Agent observability and non-repudiation](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentsec05.html?utm_source=chatgpt.com)

4. **AWS Agentic AI Lens — Structured logging and comprehensive audit trails**
   关于结构化日志、immutable audit trail、retention 和 mutable storage 的风险。
   [AWS Agentic AI Lens — Structured logging and comprehensive audit trails](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentops05-bp03.html?utm_source=chatgpt.com)

5. **Amazon Bedrock AgentCore — Observability and telemetry**
   Agent runtime trace、tool invocation、request/response、decision points 和 recovery attempts 等实际 observability 能力。
   [Amazon Bedrock AgentCore — Observability](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/observability-telemetry.html?utm_source=chatgpt.com)

6. **Microsoft Foundry — Tracing for AI Agents**
   官方关于 LLM calls、tool invocations、agent decision flows、retrieval、security/privacy、retention 的 tracing 能力。
   [Microsoft Foundry — Configure tracing for AI agent frameworks](https://learn.microsoft.com/en-us/azure/foundry/observability/how-to/trace-agent-framework?utm_source=chatgpt.com)

7. **FINRA — GenAI: Continuing and Emerging Trends, 2026 Annual Regulatory Oversight Report**
   当前金融证券行业对 GenAI/Agent 的 supervision、recordkeeping、monitoring、model version、prompt/output logs、human oversight 和 agent auditability 的监管观察。
   [FINRA — GenAI: Continuing and Emerging Trends](https://www.finra.org/rules-guidance/guidance/reports/2026-finra-annual-regulatory-oversight-report/gen-ai?utm_source=chatgpt.com)

8. **SEC — Amendments to Electronic Recordkeeping Requirements for Broker-Dealers**
   Rule 17a-4 的 WORM / audit-trail alternative、original record reconstruction、timestamp、identity、authenticity、reliability 和 reasonably usable production。
   [SEC — Amendments to Electronic Recordkeeping Requirements](https://www.sec.gov/investment/amendments-electronic-recordkeeping-requirements-broker-dealers?utm_source=chatgpt.com)

9. **SEC — SEC Charges 16 Wall Street Firms with Widespread Recordkeeping Failures, 2022**
   16 家金融机构因电子通信 recordkeeping failures 被处罚，合计超过 11 亿美元；是金融 recordkeeping 重要性的真实案例。
   [SEC — 16 Wall Street Firms Recordkeeping Failures](https://www.sec.gov/newsroom/press-releases/2022-174?utm_source=chatgpt.com)

10. **SEC — Enforcement Results for Fiscal Year 2024**
    SEC 2024 财年 recordkeeping enforcement 的最新总结：70 多家机构、超过 6 亿美元罚款，自 2021 年起相关 initiative 涉及超过 100 家机构和超过 20 亿美元罚款。
    [SEC — Enforcement Results for Fiscal Year 2024](https://www.sec.gov/newsroom/press-releases/2024-186?utm_source=chatgpt.com)

11. **PCAOB AS 1105 — Audit Evidence**
    关于 evidence 的 sufficient / appropriate、relevance、reliability，以及企业生成信息的 accuracy / completeness 和 IT controls。
    [PCAOB — AS 1105 Audit Evidence](https://pcaobus.org/oversight/standards/auditing-standards/details/AS1105?utm_source=chatgpt.com)

12. **Federal Reserve — Supervisory Guidance on Model Risk Management, current guidance**
    关于 model inventory、documentation、validation、ongoing monitoring、governance、vendor models 和 third-party model risk。
    [Federal Reserve — Supervisory Guidance on Model Risk Management](https://www.federalreserve.gov/frrs/guidance/supervisory-guidance-on-model-risk-management.htm?utm_source=chatgpt.com)

13. **DORA — Regulation (EU) 2022/2554**
    Article 11 关于 ICT response/recovery 和 records；Article 12 关于 restoration、recovery、checks、reconciliation 和 data integrity。
    [EUR-Lex — DORA Regulation (EU) 2022/2554](https://eur-lex.europa.eu/eli/reg/2022/2554/oj?utm_source=chatgpt.com)

14. **EU AI Act — Regulation (EU) 2024/1689**
    Article 11 technical documentation、Article 12 record-keeping、Article 19 automatically generated logs、Article 26 deployer log retention 等。
    [EUR-Lex — Artificial Intelligence Act](https://eur-lex.europa.eu/eli/reg/2024/1689/oj?utm_source=chatgpt.com)

15. **BIS Financial Stability Institute — Managing explanations: how regulators can address AI explainability, 2025**
    关于复杂 AI / LLM explainability 的准确性、稳定性和 misleading explanations 风险。
    [BIS FSI — Managing explanations](https://www.bis.org/fsi/publ/insights24.htm?utm_source=chatgpt.com)

16. **FSB — The Financial Stability Implications of Artificial Intelligence, 2024**
    关于金融业 AI 的 model risk、third-party dependencies、cyber risk 和 governance challenges。
    [FSB — The Financial Stability Implications of Artificial Intelligence](https://www.fsb.org/2024/11/the-financial-stability-implications-of-artificial-intelligence/?utm_source=chatgpt.com)

17. **FSB — Monitoring Adoption of AI and Related Vulnerabilities in the Financial Sector, 2025**
    关于金融机构 AI adoption、第三方依赖、数据缺口以及监测框架。
    [FSB — Monitoring Adoption of AI and Related Vulnerabilities](https://www.fsb.org/2025/10/monitoring-adoption-of-artificial-intelligence-and-related-vulnerabilities-in-the-financial-sector/?utm_source=chatgpt.com)

18. **OpenAI — Learning to reason with LLMs**
    关于 raw chain-of-thought 的性质及其不适合作为普通用户直接展示内容的官方说明。
    [OpenAI — Learning to reason with LLMs](https://openai.com/index/learning-to-reason-with-llms/?utm_source=chatgpt.com)

19. **OpenAI — Detecting misbehavior in frontier reasoning models**
    关于 chain-of-thought 作为 monitoring signal 的研究，以及不应简单把 CoT 等同为面向用户的最终解释。
    [OpenAI — Detecting misbehavior in frontier reasoning models](https://openai.com/index/chain-of-thought-monitoring/?utm_source=chatgpt.com)

# AI Agent Audit Trail 的最小数据模型

金融 Agent 真正进入生产后，一个问题迟早会出现：

> **如果半年以后，审计、合规、监管、客户投诉处理或内部调查人员只给我们一个 Business Case ID，我们能不能回答：Who / What / Why / How？**

很多 Agent 平台对此的第一反应是：

```text id="ktj3i2"
保存 Prompt
保存 LLM Output
保存 Tool Call
保存 Trace
```

这对于 Agent Observability 很有价值，但并不能自动形成一个可审计的业务证据链。

原因在于，监管和内部调查通常并不只想知道：

```text id="qf7s9n"
“模型当时输出了什么？”
```

而是：

```text id="6c2k0q"
Who:
谁触发？谁授权？谁批准？谁执行？谁干预？

What:
到底做了什么？访问了什么？改变了什么？最终结果是什么？

Why:
为什么允许？依据什么业务意图、Policy、授权和控制？

How:
通过哪个 Agent、Model、Version、Data、Tool、Workflow 和 External System 完成？

Proof:
这些信息从哪里来？是否完整？是否可信？多年以后还能不能重建？
```

因此，本文讨论的不是一个“完整 Audit Platform”应该有哪些功能，而是一个更严格的问题：

> **如果必须从最小数据模型开始，哪些信息绝不能丢，否则金融 Agent 就无法形成一个可重建、可验证的 Audit Trail？**

这里的“最小”不是“字段越少越好”，而是：

> **最小可审计闭环（Minimum Auditable Model）**。

这个模型是本文提出的架构模型，不是某个监管机构规定的一套统一 schema。具体字段、留存期限、记录类型和控制强度仍必须由适用业务、监管辖区和机构内部政策决定。

---

# 1. 先把“最小”定义清楚

一个 Audit Trail 如果要回答：

```text id="s2ur37"
Who / What / Why / How
```

最少需要保存五类事实：

```text id="67qj7s"
1. Identity
2. Action
3. Decision / Authorization
4. Execution Context
5. Outcome
```

再加两个横向属性：

```text id="1qj8en"
6. Correlation
7. Evidence Integrity / Provenance
```

可以浓缩成：

```text id="3vhr2k"
Audit Event
├── Who
├── What
├── Why
├── How
├── Outcome
├── Correlation
└── Evidence
```

注意一个重要区别：

```text id="g3x31k"
Log
```

只需要：

> “某件事情发生了。”

而：

```text id="kl8k6p"
Audit Event
```

需要：

> “谁，在什么业务上下文中，以什么权限，通过什么控制，做了什么，产生什么结果，并且以后可以把相关证据重新拼起来。”

---

# 2. 最小模型不应该从 Trace 开始，而应该从 Business Event 开始

OpenTelemetry 对 Observability 的核心抽象是 traces、metrics 和 logs，用于从系统外部理解和诊断系统行为。W3C Trace Context 则标准化了分布式 tracing 中的 `trace-id`、`parent-id` 等传播机制。([opentelemetry.io](https://opentelemetry.io/docs/concepts/observability-primer/); [w3.org](https://www.w3.org/TR/trace-context/))

这些能力解决的是：

```text id="i04y32"
“系统怎么跑的？”
```

而 Audit Trail 更关心：

```text id="xs8d4g"
“业务事实是什么？”
```

因此最小模型的根应该是：

```text id="7p5clq"
business_operation_id
```

而不是：

```text id="55zv0x"
trace_id
```

一个业务操作可能有：

```text id="x9r5v3"
Agent trace
Queue trace
Worker trace
Vendor trace
Webhook trace
Reconciliation trace
```

但这些技术 trace 都可能属于同一个：

```text id="0jibxp"
Business Operation
```

AWS 当前 Agentic AI Lens 也明确建议使用独立于 tracing system 的 application-level correlation ID，跨 Agent、Queue 和 Event Bus 等异步边界传播；`trace_id` 负责技术 tracing，correlation ID 负责跨边界保持业务关联。

所以：

> **Audit Trail 的主键应该是业务关联，Trace ID 应该是技术关联。**

---

# 3. 最小数据模型：三个逻辑实体足够起步

一个企业 Agent 平台不需要一开始就建立几十张审计表。

最小可以抽象成三类逻辑实体：

```text id="1d7g0a"
1. Audit Event
2. Evidence Artifact
3. Business Operation
```

关系是：

```text id="a1m4z9"
Business Operation
       │
       ├── Audit Event
       │     ├── Intent
       │     ├── Authorization
       │     ├── Decision
       │     ├── Approval
       │     ├── Action
       │     ├── Outcome
       │     └── Intervention
       │
       └── Evidence Artifact
             ├── Policy
             ├── Model Version
             ├── Source Data
             ├── Approval Record
             ├── External Record
             └── Trace
```

其中：

### Business Operation

回答：

> 这件业务事情是什么？

### Audit Event

回答：

> 这件事情在生命周期中发生了什么？

### Evidence Artifact

回答：

> 我们凭什么证明这个事件？

这是比：

```text id="b0q9kk"
AuditLog(id, json_blob)
```

更稳定的模型。

---

# 4. Business Operation：整个模型的根

建议最小字段：

```text id="d44bxl"
BusinessOperation
────────────────────────────────
operation_id
operation_type
business_case_id
subject_ref
created_at
status
```

例如一笔交易：

```json id="6l4v4k"
{
  "operation_id": "OP-20260920-00123",
  "operation_type": "TRADE_EXECUTION",
  "business_case_id": "CASE-8831",
  "subject_ref": "ORDER-12345",
  "created_at": "2026-09-20T10:31:00Z",
  "status": "PARTIALLY_FILLED"
}
```

这里没有记录：

```text id="0y6s0v"
Prompt
LLM tokens
latency
embedding
```

因为这些不是 Business Operation 的核心身份。

它们属于：

```text id="v9qb7n"
Evidence / Execution Detail
```

---

# 5. 为什么 `operation_id` 是整个模型最重要的字段

金融 Agent 的一个基本问题是：

```text id="y42d6x"
“这一次 Tool Call 到底属于哪个业务操作？”
```

例如：

```text id="m1u8m5"
Agent
  ↓
Tool: submit_order
  ↓
HTTP request
  ↓
Broker
```

如果没有：

```text id="x4w9ai"
operation_id
```

以后很难可靠关联：

```text id="a0i4o1"
Approval
+
Tool Call
+
External Reference
+
Settlement
```

因此：

```text id="6iz0gi"
operation_id
```

应该贯穿：

```text id="iqh6ve"
Workflow
Agent
Tool
Message
Database
External API
Webhook
Reconciliation
Audit
```

这是一个业务级 correlation key，而不是单纯 tracing key。

---

# 6. 第二层：Audit Event

推荐最小结构：

```text id="e1z1z0"
AuditEvent
────────────────────────────────
event_id
operation_id

event_type
occurred_at

actor
action
target

decision_ref
policy_ref

execution_ref
outcome

trace_id
correlation_id

evidence_refs
```

其中最重要的是：

```text id="5y0j0n"
event_type
```

它不要被设计成无限自由文本。

建议最少支持：

```text id="6wt0l1"
INTENT
AUTHORIZATION
DECISION
APPROVAL
ACTION
OUTCOME
INTERVENTION
RECOVERY
```

这样整个生命周期可以表示成：

```text id="vnyubj"
INTENT
  ↓
AUTHORIZATION
  ↓
DECISION
  ↓
APPROVAL
  ↓
ACTION
  ↓
OUTCOME
```

异常情况下：

```text id="xq60ob"
ACTION
  ↓
RECOVERY
  ↓
OUTCOME
```

这已经足以表达大多数金融 Agent 的核心审计链。

---

# 7. 为什么需要 Event，而不是只有最终状态

错误模型：

```text id="kh2y3w"
operation.status = SUCCESS
```

它回答不了：

```text id="8w3b0w"
谁批准？
之前失败过吗？
有没有 Retry？
有没有人工 Override？
Policy 检查什么时候通过？
```

正确模型：

```text id="kqj4h7"
10:00 INTENT
10:01 AUTHORIZATION
10:02 DECISION
10:03 APPROVAL
10:04 ACTION
10:04 RECOVERY
10:05 ACTION
10:06 OUTCOME
```

这样才能重建业务生命周期。

SEC 当前 Rule 17a-4 对 broker-dealer electronic records 的 audit-trail alternative 正是强调这一思想：系统需要能够重建原始记录，并保存完整、带时间戳的 audit trail，包括对记录的修改和删除、发生时间、适用时的身份，以及保证真实性、可靠性和重建能力所需的其他信息。

因此：

> **Audit Trail 的核心不是“当前状态”，而是“状态是如何形成的”。**

---

# 8. `event_type` 是最重要的枚举之一

建议明确限制：

```text id="yskd89"
INTENT
AUTHORIZATION
DECISION
APPROVAL
ACTION
OUTCOME
INTERVENTION
RECOVERY
```

而不是：

```text id="zth5ri"
message_type = arbitrary-string
```

因为 Audit Trail 的价值很大程度来自：

```text id="zoqf0g"
queryability
```

例如：

```sql id="xtxk8n"
SELECT *
FROM audit_event
WHERE operation_id = 'OP-123'
ORDER BY occurred_at;
```

就可以重建：

```text id="lmccg8"
谁 → 为什么 → 批准 → 执行 → 结果
```

---

# 9. `Who`：最小只需要一个 Actor Envelope

建议不要一开始建立：

```text id="6mxo6r"
User table
Role table
Session table
IAM snapshot table
```

这些都属于外部权威系统。

Audit Trail 只需要：

```text id="38zxqq"
Actor
├── actor_type
├── actor_id
└── authority_ref
```

例如：

```json id="9z9g1j"
{
  "actor_type": "HUMAN",
  "actor_id": "USER-123",
  "authority_ref": "AUTHZ-8891"
}
```

Agent：

```json id="2aqs7o"
{
  "actor_type": "AGENT",
  "actor_id": "proxy-vote-agent",
  "authority_ref": "AGENT-AUTH-22"
}
```

系统：

```json id="0t3lba"
{
  "actor_type": "SYSTEM",
  "actor_id": "scheduler",
  "authority_ref": "SCHEDULE-19"
}
```

AWS Agentic AI Lens 要求记录 initiating source，并明确列举 human session、upstream event、schedule、another agent 等触发来源。

所以最小原则是：

> **一定要知道“谁让这件事开始了”，不一定要把整个 IAM 数据库复制进 Audit Store。**

---

# 10. Who 不应该只存 User ID

以下两种记录：

```text id="s4x6hi"
actor_id = alice
```

和：

```text id="yj8z0v"
actor_id = alice
authority_ref = AUTH-8842
```

审计价值完全不同。

第二种可以进一步追到：

```text id="jnd1zg"
当时 Alice 以什么权限作出这个动作？
```

因此建议：

```text id="rh0i4d"
actor_id
+
authority_ref
```

作为最小组合。

具体 authority 是否需要保存：

```text id="nqfo5m"
role
entitlement
authorization policy
```

应根据业务风险决定。

---

# 11. `What`：Action 和 Target 必须分开

最小：

```text id="jblt0i"
action
target
```

例如：

```json id="5kcizw"
{
  "action": "SUBMIT_PROXY_VOTE",
  "target": {
    "type": "RESOLUTION",
    "id": "RES-003"
  }
}
```

而不是：

```text id="te08d3"
description =
"Agent submitted the proxy vote for the third resolution."
```

原因是结构化 Action 才可以查询：

```sql id="f52eqb"
WHERE action = 'SUBMIT_PROXY_VOTE'
```

也可以统计：

```text id="jx4ktz"
所有 Agent 提交过的 Proxy Vote
```

这比自然语言日志可靠得多。

AWS Agentic AI Lens 也明确推荐 structured logging，而不是 free-text logging，并强调成功操作也必须记录，否则无法完整重建执行顺序。

---

# 12. Target 是金融 Audit Trail 很重要的字段

例如：

```text id="d65b2h"
TRADE
PAYMENT
ACCOUNT
POSITION
VOTE
CLIENT
DOCUMENT
```

需要知道 Agent 到底作用于哪个业务对象。

最小可以：

```text id="2v5a7b"
target_type
target_id
```

例如：

```json id="mg2m2x"
{
  "target_type": "ORDER",
  "target_id": "ORDER-9912"
}
```

如果涉及多个对象，可以：

```text id="1lphv6"
targets[]
```

但不要把所有业务对象复制进 Agent Audit Store。

最好保存：

```text id="h8v2rj"
reference
```

并指向：

```text id="wlzviy"
authoritative business system
```

---

# 13. `Why`：最小模型不要保存“完整 CoT”，而要保存 Decision Basis

这一点必须非常明确。

建议：

```text id="0f62ps"
decision_ref
policy_ref
reason_codes
```

例如：

```json id="e1if94"
{
  "decision_ref": "DEC-7731",
  "policy_ref": "TRADE-POLICY-v17",
  "reason_codes": [
    "CLIENT_MANDATE_PASS",
    "LIMIT_CHECK_PASS",
    "RESTRICTED_LIST_PASS"
  ]
}
```

这足以回答：

> 为什么允许这次行动？

而不需要把模型生成的大段 reasoning 变成监管记录。

FINRA 2026 年监管报告建议金融机构持续监控 prompts、responses 和 outputs，并可保存 prompt/output logs、追踪模型版本和使用时间、进行 validation 与 human-in-the-loop review；针对 Agent，FINRA 进一步指出复杂的多步骤 reasoning 会增加 auditability / transparency 难度，并建议跟踪 agent actions and decisions、system access 和 data handling。

这更接近：

```text id="x09j3x"
Decision Evidence
```

而不是：

```text id="t0rjha"
Chain-of-Thought Archive
```

---

# 14. `policy_ref` 是 Why 的核心

例如：

```text id="btz68w"
policy_ref = TRADE-POLICY-v17
```

比：

```text id="wx3k2n"
policy_allowed = true
```

更有价值。

因为以后需要回答：

> 当时依据的是哪一版规则？

至少要能追到：

```text id="d5dl72"
policy_id
policy_version
effective_time
policy_decision
```

但 Audit Event 不应该复制整个 Policy。

应该：

```text id="u6f0az"
Audit Event
    ↓
policy_ref
    ↓
Policy Registry
    ↓
versioned policy artifact
```

这样避免形成第二个 Policy Source of Truth。

---

# 15. `reason_codes` 比 `reason_text` 更适合最小模型

推荐：

```text id="d7uvf9"
reason_codes
```

而不是：

```text id="ux8izq"
reason = "The AI thought this was appropriate..."
```

例如：

```text id="7t4a7e"
[
  "MANDATE_ALLOWED",
  "RISK_LIMIT_PASS",
  "CONFLICT_CHECK_PASS"
]
```

优势是：

```text id="tca21m"
可查询
可统计
可比较
可版本化
```

同时可以提供：

```text id="6dmx6z"
reason_summary
```

作为人工阅读层。

于是：

```text id="j9m08w"
Machine evidence
=
reason_codes

Human explanation
=
reason_summary
```

二者不混淆。

---

# 16. `How`：最小不需要记录全部 Runtime Metadata

很多人设计 Audit Trail 时容易走向：

```text id="1qimz4"
model
temperature
top_p
tokens
latency
GPU
container
pod
node
region
availability_zone
SDK
library
```

最后把 Trace 复制一份。

这不是最小模型。

对于高价值业务 Audit，最重要的是：

```text id="xpm3bp"
agent_version
model_ref
workflow_version
tool_version
```

即：

> **能够定位“当时到底运行了哪个版本”。**

而：

```text id="yj8h9c"
latency
token count
CPU
memory
```

属于 Observability。

---

# 17. 一个极简但有意义的 `How`

推荐：

```text id="q5p7yg"
ExecutionContext
├── agent_ref
├── model_ref
├── workflow_ref
├── tool_ref
└── config_ref
```

例如：

```json id="mxa9n1"
{
  "agent_ref": "proxy-vote-agent:v4.2",
  "model_ref": "model-x:2026-09",
  "workflow_ref": "proxy-vote-workflow:v8",
  "tool_ref": "vendor.submit_vote:v2.1",
  "config_ref": "agent-config:17"
}
```

这已经足够把一次业务操作定位到具体执行环境。

---

# 18. 为什么需要 `config_ref`

Agent 的行为不只由：

```text id="j0jdv9"
model
```

决定。

还受到：

```text id="o4f2lu"
system prompt
tool catalog
guardrails
routing
retrieval configuration
feature flags
policy
```

影响。

AWS Agentic AI Lens 的设计原则明确提出，prompts、tool catalogs、role definitions、model selections 和 policies 都应被视为 versioned artifacts，与代码一样进行 review、testing、staged rollout 和 rollback。

所以最小 Audit Trail 不必保存全部配置内容，但应该至少：

```text id="gqv3ry"
config_ref
```

能够追到当时的版本化 Artifact。

---

# 19. Data Provenance：最小应该保存 Source Reference，而不是全部数据

对于 RAG 或金融数据 Agent：

```text id="i0kx9u"
Agent
 ↓
Research A
 ↓
Portfolio B
 ↓
Policy C
 ↓
Decision
```

审计真正可能问：

> 这次决策依据哪些数据？

因此建议：

```text id="4bkx7r"
provenance_refs[]
```

每个 reference 最小：

```text id="yvjph7"
source_system
source_id
source_version
retrieved_at
```

如果需要更强完整性：

```text id="0h4im9"
content_hash
```

例如：

```json id="p8xwnc"
{
  "source_system": "RESEARCH_VENDOR",
  "source_id": "REPORT-123",
  "source_version": "4",
  "retrieved_at": "2026-09-20T10:30:00Z",
  "content_hash": "sha256:..."
}
```

这比直接复制完整 Vendor Research 更接近“最小数据模型”。

---

# 20. 为什么 `source_version` 很重要

今天：

```text id="pw6jri"
REPORT-123 = v7
```

但交易发生时：

```text id="sj8k9b"
REPORT-123 = v4
```

如果只保存：

```text id="xu5i7w"
source_id = REPORT-123
```

未来无法回答：

> Agent 当时真正看到的是什么版本？

因此：

```text id="z7q7da"
source_id
+
source_version
```

比：

```text id="q3jvpd"
source_id
```

重要得多。

---

# 21. Data Provenance 还应该记录 Entitlement Reference

金融 Agent 不只是“用了什么数据”，还需要解释：

> **为什么它有权使用这些数据？**

因此可以增加：

```text id="51t4ob"
entitlement_ref
```

例如：

```json id="w8u3lo"
{
  "source_system": "PORTFOLIO_DB",
  "source_id": "PORT-889",
  "source_version": "20260920",
  "entitlement_ref": "ENT-7712"
}
```

这样可以进一步追到：

```text id="8z4b72"
谁
→ 为什么有权
→ 看到什么
```

FINRA 2026 年的 Agent 监管观察明确把 system access 和 data handling 列为 Agent oversight 应考虑的问题。

---

# 22. `Who / What / Why / How` 其实可以变成固定字段组

最终：

```text id="r14e52"
WHO
├── actor
└── authority_ref

WHAT
├── action
├── target
└── outcome

WHY
├── decision_ref
├── policy_ref
└── reason_codes

HOW
├── agent_ref
├── model_ref
├── workflow_ref
├── tool_ref
├── config_ref
└── provenance_refs
```

横向再有：

```text id="fx8r45"
operation_id
event_id
correlation_id
trace_id
occurred_at
evidence_refs
```

这基本就是：

> **金融 Agent Audit Trail 的最小逻辑模型。**

---

# 23. 建议的最小 Audit Event Schema

综合以上，可以定义：

```typescript id="9b2s92"
interface AuditEvent {
  event_id: string;
  operation_id: string;

  event_type:
    | "INTENT"
    | "AUTHORIZATION"
    | "DECISION"
    | "APPROVAL"
    | "ACTION"
    | "OUTCOME"
    | "INTERVENTION"
    | "RECOVERY";

  occurred_at: string;

  actor: {
    type: "HUMAN" | "AGENT" | "SYSTEM" | "EVENT" | "SCHEDULE";
    id: string;
    authority_ref?: string;
  };

  action?: {
    type: string;
    target_type?: string;
    target_id?: string;
  };

  decision?: {
    decision_ref: string;
    policy_ref?: string;
    reason_codes?: string[];
  };

  execution?: {
    agent_ref?: string;
    model_ref?: string;
    workflow_ref?: string;
    tool_ref?: string;
    config_ref?: string;
  };

  outcome?: {
    status: string;
    external_ref?: string;
  };

  correlation: {
    correlation_id: string;
    trace_id?: string;
  };

  provenance_refs?: string[];
  evidence_refs?: string[];
}
```

这不是说所有字段每次都必须填写。

而是：

> **这个模型定义了一个最小能力边界。**

例如：

```text id="a5w9nm"
DECISION
```

不一定有：

```text id="q7lhci"
external_ref
```

而：

```text id="ACTION"
```

通常应该有：

```text id="target"
```

---

# 24. 为什么 `event_id` 和 `operation_id` 两个都需要

二者不能合并。

例如：

```text id="l3l8s4"
operation_id = OP-123
```

下面可能有：

```text id="2h01gj"
event_id = E1  INTENT
event_id = E2  AUTHORIZATION
event_id = E3  DECISION
event_id = E4  APPROVAL
event_id = E5  ACTION
event_id = E6  OUTCOME
```

所以：

```text id="3pp6rj"
operation_id
=
业务生命周期

event_id
=
生命周期中的一个不可变事件
```

这使 Audit Trail 天然适合：

```text id="nnv4de"
append-only event model
```

---

# 25. 为什么事件应该尽量 Append-only

审计模型最好：

```text id="j1qip7"
INSERT event
```

而不是：

```text id="b3f2vf"
UPDATE event
```

例如：

```text id="a0i1zi"
E1:
status = SUBMITTED
```

后来：

```text id="phdce8"
不要改成:
status = REJECTED
```

而应该：

```text id="sz9r0o"
E2:
status = REJECTED
```

这样：

```text id="l9uvgr"
original history
```

不会消失。

SEC Rule 17a-4 的 audit-trail alternative 要求能够重建原始记录并记录对记录的修改或删除，这与 Append-only 的思路具有很强的架构一致性。

---

# 26. 但 Append-only ≠ Regulatory Compliance

需要明确：

```text id="0z4d4m"
append-only database
```

并不自动意味着：

```text id="e5pr3e"
regulatory record
```

还需要：

```text id="bb0q2r"
integrity
retention
access control
source reliability
completeness
production
```

SEC 的规则要求的不只是“不修改”，还涉及原始记录重建、时间戳、修改/删除历史、真实性、可靠性，以及监管要求下独立访问和合理格式的提供能力。

因此最小数据模型应该包含：

```text id="ab1guo"
evidence_refs
```

而不是试图单靠数据库设计解决全部监管要求。

---

# 27. Evidence Artifact：第二个最小实体

建议：

```text id="9z4kmp"
EvidenceArtifact
────────────────────────────────
artifact_id
artifact_type
source_system
source_ref
version
content_hash
created_at
retention_class
```

例如：

```json id="hw4x9o"
{
  "artifact_id": "ART-1001",
  "artifact_type": "POLICY",
  "source_system": "POLICY_REGISTRY",
  "source_ref": "TRADE_POLICY",
  "version": "17",
  "content_hash": "sha256:...",
  "created_at": "2026-09-01T00:00:00Z",
  "retention_class": "SEC_RECORD"
}
```

然后：

```text id="sp2x1e"
AuditEvent.policy_ref
```

指向：

```text id="dp90c0"
ART-1001
```

这样：

```text id="5bwsiq"
Audit Event
```

不承担 Policy、Document、Approval、Prompt 等 Artifact 本体的存储职责。

---

# 28. 为什么 Evidence Artifact 必须有 `source_system`

因为：

```text id="t4js6k"
同一个 artifact
```

可能有多个副本。

例如：

```text id="tyvdy5"
Policy
Vendor Data
Broker Execution
Approval
```

最值得信任的通常是：

```text id="7xg7eo"
authoritative source
```

所以必须知道：

```text id="v1p6l0"
这个 evidence 从哪个系统来的？
```

然后可以标记：

```text id="qptm1g"
source_authority =
  AUTHORITATIVE
  PRIMARY
  SUPPORTING
  OBSERVATIONAL
```

这样可以区分：

```text id="g8ne4g"
Broker Execution Report
```

和：

```text id="7cx9r8"
Agent Trace
```

对同一个交易事实的不同证据等级。

---

# 29. Evidence Artifact 不应该默认保存原始 payload

例如：

```text id="fyemip"
Prompt
Tool Input
Customer Portfolio
Research Report
```

可能非常敏感。

最小模型更适合：

```text id="xv1y0t"
source_ref
version
content_hash
secure_uri
```

而不是：

```text id="0r3nt4"
full_payload
```

只有在业务和监管要求下，才将原始数据作为受保护 Artifact 保存。

这样能够同时满足：

```text id="j74rj0"
Auditability
+
Data Minimization
```

AWS Agentic AI Lens 也明确强调，长期保存的 Agent logs 应在进入长期存储之前进行敏感字段 masking / redaction；同时要求 Evidence Storage 位于 Agent 自身 operational scope 外，并具备 tamper-evident controls。

---

# 30. `content_hash` 的意义是什么

例如：

```text id="zoxqaf"
Policy v17
```

将：

```text id="o5b3gg"
SHA-256
```

写进 Evidence Record。

以后就可以验证：

```text id="9x4igo"
当前拿到的 Policy Artifact
```

是否仍是：

```text id="0x3ing"
当时引用的那个版本。
```

它解决的是：

```text id="6zv7vy"
artifact integrity / identity
```

不是：

```text id="7q86tj"
business truth
```

因此：

```text id="p93j5n"
Hash
≠
Proof that the content was correct
```

只是：

```text id="mq4j28"
Proof that this content matches the referenced artifact
```

---

# 31. Third Entity：Business Operation 不应该变成 Audit Event

这三个东西最好明确分开：

```text id="pih8am"
Business Operation
=
业务事实

Audit Event
=
生命周期事件

Evidence Artifact
=
支持事实的证据
```

例如：

```text id="52x5y1"
Business Operation:
TRADE-123

Audit Events:
Decision
Approval
Action
Outcome

Evidence:
Policy v17
Approval #888
Broker Report #999
Trace #abc
```

这样模型非常清晰。

---

# 32. 一个完整例子：交易 Agent

假设客户要求：

```text id="ch4y2e"
Buy 10,000 XYZ
```

Audit Trail 可以形成：

```text id="d2e8y3"
Operation
OP-100

E1
INTENT
actor = USER-123
action = REQUEST_TRADE
target = ORDER-100

E2
AUTHORIZATION
actor = USER-123
authority = AUTH-20
decision = ALLOW

E3
DECISION
actor = AGENT-TRADE-v4
policy = TRADE-POLICY-v17
reason_codes = [
  MANDATE_PASS,
  LIMIT_PASS
]

E4
APPROVAL
actor = USER-456
decision = APPROVE

E5
ACTION
actor = AGENT-TRADE-v4
tool = OMS.SUBMIT_ORDER:v3
target = ORDER-100

E6
OUTCOME
status = PARTIALLY_FILLED
external_ref = BRK-8899
```

这已经可以回答：

```text id="9ntx4u"
WHO
USER-123 / USER-456 / AGENT-v4

WHAT
BUY 10,000 XYZ

WHY
Policy v17 + mandate/limit checks + approval

HOW
Agent v4 + Tool v3 + OMS + Broker

OUTCOME
Partially Filled
```

而：

```text id="m8z7v6"
EvidenceArtifact
```

可以分别引用：

```text id="gni2ow"
AUTH-20
POLICY-v17
APPROVAL-456
TRACE-abc
BROKER-8899
```

---

# 33. 一个 Proxy Vote 例子

假设业务是：

```text id="z8a6sk"
Submit FOR
Resolution 3
```

Audit Trail：

```text id="1j9q6s"
INTENT
actor = CLIENT-001
target = RES-3

AUTHORIZATION
authority_ref = MANDATE-17
decision = ALLOW

DECISION
agent_ref = proxy-vote-agent:v4.2
policy_ref = PROXY-POLICY:v12
reason_codes = [
  MANDATE_ALLOWS_FOR,
  POSITION_EXISTS,
  CONFLICT_CHECK_PASS
]

APPROVAL
actor = PORTFOLIO-MANAGER-42
decision = APPROVE

ACTION
tool = vendor.submit_vote:v2
target = VOTE-001

OUTCOME
status = SUBMITTED
external_ref = VENDOR-8831
```

一笔 Audit Record 就能重建整个业务事实。

---

# 34. 最小模型不需要一个“巨型 JSON”

不推荐：

```json id="jb7sol"
{
  "everything": {
    "prompt": "...",
    "chainOfThought": "...",
    "allDocuments": ["..."],
    "allToolResponses": ["..."],
    "allLogs": ["..."],
    "allMetrics": ["..."]
  }
}
```

这实际上只是：

```text id="8w0otl"
把 Observability 全量塞进 Audit Log
```

正确的方向是：

```text id="xxjunj"
Audit Event
   ↓
References
   ↓
Evidence Artifacts
```

这更像：

```text id="6m3e8e"
Evidence Graph
```

而不是：

```text id="5y53f7"
Log Blob
```

---

# 35. Audit Event 最好保持“薄”

一个好的原则：

> **Event 记录事实，Artifact 保存事实的证据。**

例如：

```text id="54g7b8"
AuditEvent
{
  policy_ref: "POLICY-v17"
}
```

而 Policy 本体：

```text id="e8l8tc"
EvidenceArtifact
{
  artifact_id: "ART-17",
  content_hash: "...",
  uri: "..."
}
```

这样未来：

```text id="y5hfrk"
Audit Schema
```

可以稳定几十年，而：

```text id="yd3lj1"
Artifact Format
```

可以不断演进。

---

# 36. 为什么 `trace_id` 仍然必须存在

既然不应该把 Trace 当 Audit Trail，为什么还要保存 `trace_id`？

因为它仍然是极有价值的 supporting evidence。

例如：

```text id="d0g4lp"
Audit Event
   │
   └── trace_id = 4bf...
```

可以跳到：

```text id="3cpnm3"
LLM Call
Retrieval
Tool Call
Latency
Error
Retry
```

于是：

```text id="8g7llm"
Audit
```

和：

```text id="9iur6k"
Observability
```

真正连接起来。

因此：

> **Trace 不应该成为 Audit Trail，但应该成为 Audit Trail 的一个证据引用。**

---

# 37. `correlation_id` 与 `trace_id` 不要合并

W3C Trace Context 的 `trace-id` 是技术 tracing 语义。AWS Agentic AI Lens 则明确建议额外使用 application-level correlation ID，以跨异步边界保持业务关联。

因此最小模型应该同时支持：

```text id="cf6baw"
correlation_id
trace_id
```

例如：

```text id="0n9wq5"
correlation_id = OP-123
trace_id       = 4bf92f...
```

这样：

```text id="yaq7u0"
一个 Business Operation
```

可以对应多个：

```text id="8rkhp3"
Trace
```

---

# 38. `event_time` 和 `recorded_at` 也不应合并

例如：

```text id="4v5x8r"
外部 Broker 在 10:01:02 执行
```

你的系统可能：

```text id="66mxgq"
10:01:05 收到消息
10:01:06 写入 Audit Store
```

所以应该区分：

```text id="z6c9w5"
occurred_at
recorded_at
```

否则以后无法区分：

```text id="v8ovon"
业务发生时间
```

和：

```text id="5e4ox5"
系统记录时间
```

对于跨银行、Broker、Vendor、Human Approval 的金融流程，这非常重要。

---

# 39. 最小时间字段可以只有两个

```text id="w1n5wz"
occurred_at
recorded_at
```

不需要一开始加入：

```text id="c3g2st"
received_at
processed_at
indexed_at
archived_at
```

那些属于：

```text id="c9p2ux"
operational telemetry
```

除非特定业务需要。

---

# 40. `outcome` 必须结构化

不要：

```text id="3pp6ti"
outcome = "Everything went well."
```

至少：

```text id="cz20e1"
status
code
external_ref
```

例如：

```json id="v7g9bx"
{
  "status": "PARTIALLY_FILLED",
  "code": "BROKER_ACCEPTED",
  "external_ref": "BRK-8899"
}
```

因为：

```text id="d9tx1s"
status
```

是机器可以查询的事实。

`description` 可以另外提供。

---

# 41. Outcome 不能只看 Agent 自己的结果

这是 Agent Audit Trail 和传统 Application Log 的关键区别。

例如：

```text id="bg8d7n"
Agent Tool:
HTTP 200
```

真正可能是：

```text id="7xg85e"
Broker:
PENDING
```

因此：

```text id="k8l7y4"
outcome.authoritative_ref
```

非常重要。

建议：

```text id="gr8khs"
outcome = {
  "observed_status": "SUCCESS",
  "authoritative_status": "PENDING",
  "external_ref": "BRK-8899"
}
```

这种设计尤其适合金融 Agent 的异步外部系统。

---

# 42. Recovery 应该是 Event Type，而不是一个布尔字段

错误：

```text id="j2hze5"
retry = true
```

正确：

```text id="5l6glo"
RECOVERY
```

例如：

```json id="txbqi4"
{
  "event_type": "RECOVERY",
  "action": {
    "type": "RECONCILE"
  },
  "outcome": {
    "status": "CONFIRMED"
  }
}
```

之后：

```text id="1q5pi0"
ACTION
```

再：

```text id="jo8m0q"
OUTCOME
```

这样才能回答：

> 中间为什么又执行了一次？

---

# 43. Human Intervention 也应该是 Event

不要：

```text id="yt0ec5"
final_status = MANUAL
```

而应该：

```text id="8ozbvg"
INTERVENTION
actor = USER-555
action = OVERRIDE
reason = VENDOR_STATUS_UNAVAILABLE
```

这样可以回答：

```text id="4n9o0m"
谁介入？
什么时候？
做了什么？
为什么？
```

BIS 长期以来对金融 AI accountability 的讨论都强调明确角色、责任和人工参与的重要性。

---

# 44. 最小模型不需要把完整 Role Snapshot 存下来

例如：

```text id="h5lc6w"
role = PORTFOLIO_MANAGER
```

够不够？

取决于业务。

对很多场景：

```text id="a9qfxh"
authority_ref
```

更合理。

例如：

```text id="m8l4qr"
authority_ref = AUTHZ-7781
```

之后由：

```text id="d70g3f"
Authorization Authority
```

证明：

```text id="0v3c9e"
该主体当时拥有适用权限。
```

这样可以避免：

```text id="ywe34i"
Audit DB
```

变成：

```text id="5c6q8s"
IAM Replica
```

---

# 45. 同样不要把完整 Policy 复制进 Audit Event

只需要：

```text id="0x3n9l"
policy_ref
```

再保存：

```text id="y6cpeh"
Policy Artifact
```

这样可以做到：

```text id="dv2upn"
reference
+
hash
+
version
+
effective_time
```

同时保持：

```text id="zkq5j2"
Single Source of Truth
```

---

# 46. 一个建议的数据库模型

如果采用关系数据库，可以从四张表起步：

```text id="ih1clp"
business_operation
audit_event
evidence_artifact
audit_event_artifact
```

### business_operation

```sql id="k3ye9m"
CREATE TABLE business_operation (
    operation_id       TEXT PRIMARY KEY,
    business_case_id   TEXT,
    operation_type     TEXT NOT NULL,
    subject_type       TEXT,
    subject_id         TEXT,
    status             TEXT NOT NULL,
    created_at         TIMESTAMPTZ NOT NULL
);
```

### audit_event

```sql id="99kbur"
CREATE TABLE audit_event (
    event_id           TEXT PRIMARY KEY,
    operation_id       TEXT NOT NULL,
    event_type         TEXT NOT NULL,

    occurred_at        TIMESTAMPTZ NOT NULL,
    recorded_at        TIMESTAMPTZ NOT NULL,

    actor_type         TEXT NOT NULL,
    actor_id           TEXT NOT NULL,
    authority_ref      TEXT,

    action_type        TEXT,
    target_type        TEXT,
    target_id          TEXT,

    decision_ref       TEXT,
    policy_ref         TEXT,
    reason_codes       JSONB,

    agent_ref          TEXT,
    model_ref          TEXT,
    workflow_ref       TEXT,
    tool_ref           TEXT,
    config_ref         TEXT,

    status             TEXT,
    external_ref       TEXT,

    correlation_id     TEXT NOT NULL,
    trace_id           TEXT,

    previous_event_hash TEXT
);
```

### evidence_artifact

```sql id="d2k6ym"
CREATE TABLE evidence_artifact (
    artifact_id        TEXT PRIMARY KEY,

    artifact_type      TEXT NOT NULL,
    source_system      TEXT NOT NULL,
    source_ref         TEXT NOT NULL,
    source_version     TEXT,

    content_hash       TEXT,

    artifact_uri       TEXT,

    source_authority   TEXT,

    retention_class    TEXT,

    created_at         TIMESTAMPTZ NOT NULL
);
```

### audit_event_artifact

```sql id="z8u6ym"
CREATE TABLE audit_event_artifact (
    event_id           TEXT NOT NULL,
    artifact_id        TEXT NOT NULL,

    relationship       TEXT NOT NULL,

    PRIMARY KEY (event_id, artifact_id)
);
```

这是一个实际可落地的最小关系模型。

---

# 47. 为什么不把 Evidence Artifact 直接作为 JSON 放进 Event

可以这么做，但长期看不理想。

例如：

```text id="p5l9xq"
audit_event.evidence = [...]
```

会带来：

```text id="8pu1n9"
大对象
重复数据
难以共享
难以 version
难以独立 retention
```

而独立 Artifact 可以被多个 Event 引用。

例如：

```text id="m5scm1"
Policy v17
```

可能支持：

```text id="7rwfph"
Decision A
Decision B
Decision C
```

这样可以节省数据，同时保留一致性。

---

# 48. `previous_event_hash` 是否属于最小模型？

它不是所有金融场景都必须有，所以建议把它定位为：

```text id="zlh7x6"
Minimum Integrity Extension
```

如果采用：

```text id="lk4p5y"
append-only log
```

可以：

```text id="3m3kxu"
hash(event + previous_event_hash)
```

形成简单链。

这样可以发现：

```text id="3qbdm0"
删除
插入
重排
修改
```

但如果机构已经有：

```text id="d2eea0"
WORM
Object Lock
database audit trail
digital signature
external SIEM
```

不一定还需要自己实现 hash chain。

SEC 的规则允许 broker-dealers 在符合条件时采用 WORM 或 audit-trail alternative，所以具体完整性技术应由适用监管要求和企业控制环境决定，而不是固定成一种实现。

---

# 49. 一个更合理的“最小字段集”

如果必须再压缩，可以得到：

```text id="3w8a8f"
Required Core
────────────────────────
event_id
operation_id
event_type

occurred_at

actor_type
actor_id

action_type
target_ref

decision_ref
policy_ref

agent_ref
execution_ref

outcome

correlation_id
evidence_refs
```

其中：

```text id="8lz0sp"
execution_ref
```

可以进一步指向：

```text id="f1u9vr"
Agent / Model / Tool / Workflow configuration
```

而：

```text id="0v72xh"
target_ref
```

可以统一引用：

```text id="4xqq1w"
Business Object
```

这样整个核心实际上只有：

```text id="w2w5cd"
15 个左右逻辑字段
```

这就是本文意义上的：

> **Minimum Auditable Data Model。**

---

# 50. 如果连 15 个字段都嫌多，可以压缩成 10 个

极限压缩：

```text id="7ze7f1"
1. event_id
2. operation_id
3. event_type
4. actor
5. action
6. target
7. decision
8. execution
9. outcome
10. correlation/evidence
```

但这只有在：

```text id="z0zwii"
decision
execution
evidence
```

都是结构化子对象时才可行。

所以不应该把：

```text id="w4kh02"
10
```

理解为：

> 真正只有 10 个数据库列。

它更准确地表示：

> **10 个不可缺失的语义块。**

---

# 51. “最小模型”的核心不是字段数量，而是语义闭环

一个极小记录：

```json id="s9u7i4"
{
  "event_id": "E1",
  "operation_id": "OP1",
  "event_type": "ACTION",
  "actor": "AGENT-7",
  "action": "SUBMIT_ORDER",
  "target": "ORDER-9",
  "decision": "DEC-3",
  "execution": "AGENT-v4",
  "outcome": "ACCEPTED",
  "correlation": "OP1"
}
```

已经能够回答：

```text id="0dscmf"
WHO
AGENT-7

WHAT
SUBMIT_ORDER / ORDER-9

WHY
DEC-3

HOW
AGENT-v4

OUTCOME
ACCEPTED
```

但如果：

```text id="l9cf3g"
DEC-3
```

无法追到 Policy 或 Approval，它仍然不是完整的证据链。

所以真正的最小模型是：

```text id="pg7zaf"
Minimal Event
+
Resolvable References
```

不是：

```text id="9clkjx"
Minimal Event
alone
```

---

# 52. 这就是为什么“Reference”是最关键的设计

Audit Trail 不应该保存所有内容。

它应该保存：

```text id="0a5p08"
what
+
where to verify
```

例如：

```text id="2h0ukj"
policy_ref
```

意味着：

```text id="ydj51m"
“去 Policy Registry 看当时的 Policy”
```

```text id="ng7k4s"
approval_ref
```

意味着：

```text id="vcq8j3"
“去 Approval System 看原始批准”
```

```text id="e0f22v"
external_ref
```

意味着：

```text id="2z2r9x"
“去 Broker / OMS 看权威结果”
```

这个模式能够让 Audit Store：

```text id="s3i8x2"
小
稳定
低耦合
```

而不会变成整个企业的数据仓库。

---

# 53. Evidence Reference 需要一个关系类型

例如：

```text id="rh5v8q"
event_id
artifact_id
relationship
```

`relationship` 可以是：

```text id="5mn4ec"
POLICY_BASIS
APPROVAL
INPUT_SOURCE
EXECUTION_TRACE
EXTERNAL_CONFIRMATION
RECOVERY_EVIDENCE
```

于是：

```text id="2vy1pf"
Decision Event
   ├── POLICY_BASIS → Policy v17
   ├── INPUT_SOURCE → Research v4
   └── APPROVAL → Approval #991
```

这实际上已经开始形成：

```text id="kuqhl4"
Evidence Graph
```

---

# 54. Audit Trail 最小模型应该支持“一个 Event 对多个 Evidence”

例如：

```text id="hnxjwb"
ACTION
   │
   ├── Tool Trace
   ├── OMS Request
   ├── Broker ACK
   └── Execution Report
```

这样以后出现争议：

> Agent 说提交成功，但 Broker 实际是什么状态？

可以比较多个证据。

---

# 55. 为什么需要 Source Authority

建议：

```text id="g9x0u8"
EvidenceArtifact.source_authority
```

至少：

```text id="h8o8e7"
AUTHORITATIVE
PRIMARY
SUPPORTING
OBSERVATIONAL
```

例如：

```text id="pcf7g0"
Settlement Ledger
→ AUTHORITATIVE

Broker Execution Report
→ PRIMARY

Agent Trace
→ OBSERVATIONAL
```

这不是某个监管机构规定的统一枚举，而是一个非常实用的内部证据治理模型。

它能够防止：

```text id="ee7b5j"
Agent Trace
```

被误当成：

```text id="9g6piv"
Business System of Record
```

---

# 56. `outcome` 最好包含 Authority

可以进一步：

```json id="c1jb7v"
{
  "observed": "SUCCESS",
  "authoritative": "PARTIALLY_FILLED",
  "source_ref": "BROKER-EXEC-8899"
}
```

这样：

```text id="zpybkl"
Agent observed outcome
```

与：

```text id="hp5o6d"
Business outcome
```

被明确区分。

这对于之前讨论的：

```text id="a9wlqg"
Timeout
UNKNOWN
Reconciliation
```

非常重要。

---

# 57. Audit Trail 应记录 Recovery，但不需要保存整个 Retry Policy

例如：

```text id="h0kq01"
RECOVERY
action = RECONCILE
```

再引用：

```text id="j38m5h"
recovery_policy_ref = RECOVERY-POLICY-v3
```

而不是把：

```text id="c8z8hv"
maxAttempts
backoff
jitter
timeout
circuitBreaker
```

全部复制进 Event。

这样 Policy 仍然是：

```text id="u0o3s3"
versioned artifact
```

而 Audit Trail 只是引用：

```text id="j8z0az"
what policy was applied
```

---

# 58. 同样，Agent Version 不应该等于 Runtime Container Version

对于金融 Agent：

```text id="t6d8kh"
agent_ref = trade-agent:v4
```

通常就足够做业务关联。

底层：

```text id="g77qft"
container image
pod
node
library
runtime
```

属于技术 Observability。

只有当：

```text id="e8q2h1"
某个基础设施差异
```

真正影响：

```text id="nq9u7c"
行为
监管
模型风险
```

时，才应该提升为 Evidence Artifact。

---

# 59. Audit Trail 最小模型和 OpenTelemetry 应该如何结合

可以很明确地分层：

```text id="eq3n1v"
OpenTelemetry
    ↓
Trace / Span
```

以及：

```text id="9ksqyz"
Audit Event
    ↓
trace_id
```

即：

```text id="c2q9o4"
Audit Event
    │
    └── trace_id
           ↓
        OTel Trace
           ↓
      LLM / Tool / DB / API
```

这样：

```text id="x8g0s0"
Audit Trail
```

保持稳定。

而：

```text id="i2o2ak"
Observability backend
```

可以随时从：

```text id="LangSmith"
→
OpenTelemetry
→
AgentCore
→
other vendor
```

迁移。

这对企业平台长期生命周期非常重要。

---

# 60. Agent Observability 产品不应该成为 Audit Schema Owner

例如平台使用：

```text id="gpj5e6"
LangSmith
```

今天可以记录：

```text id="4yo46w"
run_id
trace
span
prompt
output
tool call
```

未来换成：

```text id="3soxpi"
OpenTelemetry
```

不应该导致：

```text id="lc2kfg"
Audit model changed
```

因此：

```text id="kq89fg"
Platform-neutral Audit Schema
```

应该高于：

```text id="o7v0dd"
Observability Vendor Schema
```

---

# 61. 这也是为什么 `audit_event.event_type` 不应该复用 OTel Span Type

例如：

```text id="96vc3n"
OTel span = CLIENT
```

不能等于：

```text id="le3t9x"
Audit Event = ACTION
```

因为二者语义不同。

OpenTelemetry 描述的是：

```text id="q28xgm"
technical execution
```

Audit Trail 描述：

```text id="q4b8ie"
business/control event
```

二者应该：

```text id="kuhy8w"
related
```

而不是：

```text id="0o8m6z"
identical
```

---

# 62. Audit Event 应尽量“稳定”，Observability Schema 可以“快速变化”

这是企业架构中特别重要的一点。

例如：

```text id="8c1zi6"
OTel GenAI semantic conventions
```

仍在持续发展。

但：

```text id="d19g7c"
金融业务 Audit Model
```

通常希望：

```text id="j8v8yg"
5 年后仍然稳定
```

因此 Audit Schema 不应过度依赖某一个 AI observability standard 的当前字段集合。

---

# 63. EU AI Act 也支持“logs 是 traceability 基础，但不是全部”

对于适用的 high-risk AI systems，EU AI Act Article 12 要求系统具备自动记录事件的能力，并要求日志支持与 intended purpose 相匹配的 traceability；对于 Annex III 相关类别，还规定了特定最小日志信息。Article 20/19 等相关条款还涉及日志保存和在金融机构受欧盟金融服务法约束时将这些日志作为相关 documentation 的组成部分。

这里需要注意范围：

> **这并不是“所有金融 Agent 都必须使用本文 schema”。**

而是说明一个重要方向：

```text
automatic logs
+
traceability
+
documentation
```

是不同层次的问题。

日志只是形成可追踪性的技术机制之一。

---

# 64. DORA 也没有给出一个“Agent Audit Schema”

DORA Article 11 要求金融实体建立 documented ICT response/recovery arrangements，并在相关业务连续性或恢复计划激活时保留 readily accessible records of activities。Article 12 进一步要求恢复过程中实施必要的 checks 和 reconciliations，维护数据完整性。

DORA 没有定义：

```text id="2i2r0a"
operation_id
decision_ref
agent_ref
```

这样的具体字段。

但是它说明了更高层的架构要求：

```text id="f8n64n"
记录
可访问
可恢复
可重建
数据一致
```

因此本文的数据模型应该理解为：

> **为满足这些更高层治理要求而设计的工程模型，而不是法规原文的字段映射。**

---

# 65. FINRA 2026 对 Agent 的要求同样是“能力导向”

FINRA 2026 年的报告指出，现有证券监管义务仍然适用于 GenAI；对于 Agent，特别关注：

```text id="m6d8bd"
Autonomy
Scope and Authority
Auditability and Transparency
Data Sensitivity
```

并建议考虑：

```text id="4i8ivb"
system access
data handling
human oversight
agent actions
agent decisions
guardrails
```

同时对 GenAI monitoring，FINRA 举例提出保存 prompt/output logs、追踪模型版本和时间，以及 human-in-the-loop review。

因此一个合理的推论是：

> **Audit Trail Schema 应该围绕“动作、责任、控制和业务结果”设计，而不是围绕某个 LLM API 的 request/response schema 设计。**

这是架构推论，而不是 FINRA 发布的固定字段列表。

---

# 66. Federal Reserve 2026 Guidance 要谨慎使用

2026 年 4 月，Federal Reserve、OCC 和 FDIC 发布 Revised Guidance on Model Risk Management，强调 risk-based model governance，并适用于相关大型银行组织。([federalreserve.gov](https://www.federalreserve.gov/supervisionreg/srletters/SR2602.htm))

但需要特别注意：

该修订指导对 Generative AI 和 Agentic AI 并没有直接纳入传统 model-risk guidance 的 scope；其附件明确指出 generative AI 和 agentic AI 不在该 guidance 的定义 scope 内，不过相关治理原则可以帮助机构判断其他工具和流程需要什么 governance 和 controls。

因此在设计 Audit Trail 时，比较严谨的用法是：

```text
Fed Model Risk Guidance
=
governance analogue

不是：
=
Agent Audit Log specification
```

这一区分非常重要。

---

# 67. 一个真实案例说明为什么“最小模型”必须包含 Actor + Action + Record Lifecycle

SEC 2022 年对 16 家华尔街机构的 recordkeeping failures 执法，相关机构合计支付超过 11 亿美元罚款。SEC 指出这些机构长期未能保存和维护业务电子通信。

这件事对 Agent 的直接启示不是：

```text id="4quw0k"
“Agent 应该把 Slack 全部记录下来。”
```

而是：

> **当一项沟通、决定或业务行动本身属于需要留存的业务记录时，平台必须能够识别它是什么、谁参与、何时发生、如何保存，并能够在之后提供。**

这就是为什么最小模型不能只有：

```text id="j7vwr5"
request_id
trace_id
latency
```

而必须有：

```text id="r1e0ps"
actor
action
target
time
operation
evidence
```

---

# 68. SEC Rule 17a-4 还说明“独立访问”是数据模型之外的要求

SEC 对第三方电子记录保存特别提出：

```text id="7u2n5w"
broker-dealer must have independent access
```

记录必须能在不依赖第三方人工介入的情况下访问；同时应能向监管机构提供符合要求的记录和 audit trail。

所以：

> **Audit Trail 数据模型正确，不等于 Audit Architecture 完整。**

模型之外还需要：

```text id="pl4h9n"
Storage
Retention
Access
Export
Legal Hold
Integrity
```

这也是为什么本文把：

```text id="om4jbl"
EvidenceArtifact
```

和：

```text id="4q67ol"
AuditEvent
```

分开。

---

# 69. 最小模型应该记录“引用”，而不是“所有事实复制”

这是企业金融系统特别重要的原则。

例如：

```text id="pv4g2n"
OMS 是 Order Source of Truth
```

Agent Audit Store 不应该复制整个 Order。

它应该：

```text id="gcf5v1"
operation_id
target_ref
external_ref
outcome
evidence_ref
```

然后：

```text id="a1qz6e"
Order
   ↓
OMS
```

仍然是权威业务记录。

这样可以避免：

```text id="4xkg8e"
Agent Audit DB
```

逐渐成为：

```text id="wepbif"
Shadow Business Database
```

---

# 70. 这也意味着 Audit Trail 不等于 Data Warehouse

不要设计：

```text id="twbqzq"
Agent Audit Store
=
everything
```

更合理的是：

```text id="2h8g0t"
Audit Store
=
Control Evidence
+
References
+
Metadata
```

而：

```text id="z5v8ee"
Business Systems
=
Business Facts
```

```text id="q4wy9s"
Observability
=
Technical Facts
```

这是三个完全不同的数据领域。

---

# 71. 一个最小数据模型的最终形态

可以把全文浓缩成下面这张图：

```text id="0r4n2p"
                 ┌────────────────────┐
                 │ Business Operation │
                 │                    │
                 │ operation_id       │
                 │ operation_type     │
                 │ business_case_id   │
                 │ subject_ref        │
                 └─────────┬──────────┘
                           │
                           ▼
                 ┌────────────────────┐
                 │    Audit Event     │
                 │                    │
                 │ event_id           │
                 │ event_type         │
                 │ occurred_at        │
                 │ actor              │
                 │ action             │
                 │ target             │
                 │ decision           │
                 │ execution          │
                 │ outcome            │
                 │ correlation        │
                 └─────────┬──────────┘
                           │
                  ┌────────┴────────┐
                  ▼                 ▼
        ┌────────────────┐   ┌──────────────────┐
        │ Trace / OTel   │   │ Evidence Artifact│
        │                │   │                  │
        │ trace_id       │   │ policy           │
        │ spans          │   │ approval         │
        │ tool calls     │   │ source data      │
        └────────────────┘   │ external record  │
                             │ version / hash   │
                             └──────────────────┘
```

这就是一个合理的：

> **Minimum Auditable Agent Model**

---

# 72. 如果只能留下 12 个语义字段

可以进一步压缩为：

```text id="3wbn8h"
1. operation_id
2. event_id
3. event_type
4. occurred_at
5. actor
6. action
7. target
8. decision
9. execution
10. outcome
11. correlation
12. evidence_refs
```

其中：

```text id="biw4l4"
decision
execution
actor
```

都是结构化对象，而不是简单字符串。

例如：

```json id="ysnzzg"
{
  "operation_id": "OP-123",
  "event_id": "E-456",
  "event_type": "ACTION",
  "occurred_at": "2026-09-20T10:31:00Z",

  "actor": {
    "type": "AGENT",
    "id": "trade-agent:v4"
  },

  "action": {
    "type": "SUBMIT_ORDER"
  },

  "target": {
    "type": "ORDER",
    "id": "ORDER-99"
  },

  "decision": {
    "ref": "DEC-77",
    "policy_ref": "POLICY-v17"
  },

  "execution": {
    "agent_ref": "trade-agent:v4",
    "model_ref": "MODEL-X:2026-09",
    "tool_ref": "OMS.submit:v3"
  },

  "outcome": {
    "status": "ACCEPTED",
    "external_ref": "BROKER-8899"
  },

  "correlation": {
    "correlation_id": "OP-123",
    "trace_id": "4bf92f..."
  },

  "evidence_refs": [
    "ART-POLICY-17",
    "ART-APPROVAL-88",
    "ART-BROKER-99"
  ]
}
```

从数据模型角度看，这已经相当小。

---

# 73. 但这个最小模型有几个“不能删”的语义

如果必须进一步做删减，优先保留：

```text id="6g8t5x"
operation_id
actor
action
decision/policy
execution
outcome
correlation
evidence
```

最先可以考虑不放在核心 event 中的是：

```text id="e02vvl"
token usage
latency
temperature
container
host
CPU
memory
```

因为这些属于：

```text id="sq4m2u"
Observability
```

而不是：

```text id="w9ayxg"
minimum business audit trail
```

---

# 74. 为什么 Prompt 不在核心必选字段里

这是非常有意的设计。

Prompt 对 Agent 很重要，但：

```text id="r1s22g"
Prompt
≠
Business Intent
```

例如：

```text id="6wiu8w"
Prompt:
“帮我处理一下这个客户的账户。”
```

并不等于：

```text id="kr0o3s"
Business Action:
UPDATE_ACCOUNT
```

所以核心模型应该：

```text id="m7o8z4"
business intent
+
action
```

而 Prompt：

```text id="ai7hz8"
prompt_ref
```

作为 supporting artifact。

FINRA 2026 对 prompt/output logs 的建议也把它们作为 GenAI monitoring/accountability 的一种记录，而不是定义全部 Agent audit semantics。

---

# 75. 为什么完整 LLM Output 也不在核心必选字段里

因为：

```text id="3tzl31"
LLM output
```

对于不同 Agent 可能有不同意义。

Research Agent：

```text id="iyh6jr"
answer
```

Trade Agent：

```text id="yqjxbh"
proposal
```

Compliance Agent：

```text id="h4z7bs"
draft
```

因此更通用的模型是：

```text id="f4s6io"
decision_ref
action
outcome
```

而具体 LLM output：

```text id="x5el5j"
artifact_ref
```

保存。

---

# 76. 为什么 Chain-of-Thought 更不应该进入 Minimum Model

原因不是“不能保存”，而是：

```text id="g6w1h7"
它不是最稳定、最适合作为 business evidence 的 representation。
```

更合适的是：

```text id="2ikg0n"
decision factors
policy results
source references
risk flags
human approval
```

BIS 关于金融 AI explainability 的研究指出，复杂模型解释可能不准确、不稳定甚至误导，因此不能简单把模型生成的解释当成可靠因果证明。

所以：

> **最小 Audit Model 应记录“可验证的决策证据”，而不是“模型生成的全部内部推理”。**

---

# 77. Evidence Reference 应该支持“多证据”

例如：

```text id="41bxf4"
decision_ref = DEC-100

evidence_refs:
  - POLICY-17
  - MANDATE-12
  - POSITION-999
  - APPROVAL-33
  - TRACE-8f3
```

这就把：

```text id="c1d7e5"
Why
```

变成：

```text id="f5o2vy"
一个 Evidence Set
```

而不是一句解释。

---

# 78. 可以进一步建立 Claim → Evidence Mapping

在复杂金融场景里，可以在 Evidence Manifest 层加入：

```text id="hj4c03"
claim_id
claim_type
evidence_refs
```

例如：

```json id="fcyh4h"
{
  "claim_id": "CLAIM-1",
  "claim_type": "AUTHORIZED_ACTION",
  "evidence_refs": [
    "AUTHZ-77",
    "APPROVAL-88"
  ]
}
```

另一个：

```json id="c9k0qa"
{
  "claim_id": "CLAIM-2",
  "claim_type": "BUSINESS_OUTCOME",
  "evidence_refs": [
    "BROKER-99",
    "SETTLEMENT-100"
  ]
}
```

这样 Audit 平台可以从：

```text id="s2x1nh"
Claim
```

反向找到：

```text id="g1a0ri"
Evidence
```

---

# 79. 这比“存全部日志”更适合金融审计

因为审计通常不是：

```text id="u7sy6g"
“给我 5 TB logs。”
```

而是：

```text id="x2q9bz"
“证明这笔操作经过授权。”
```

所以：

```text id="w4pss0"
Claim
  ↓
Evidence
```

才是审计真正关心的数据关系。

---

# 80. Audit Trail 最小模型应该可以回答四个问题

可以直接做成四个 API：

```text id="9miyg3"
GET /operations/{operation_id}/who
GET /operations/{operation_id}/what
GET /operations/{operation_id}/why
GET /operations/{operation_id}/how
```

例如：

### Who

```json id="1n6hqu"
{
  "initiator": "USER-123",
  "approver": "USER-456",
  "executor": "trade-agent:v4"
}
```

### What

```json id="e4g03y"
{
  "action": "SUBMIT_ORDER",
  "target": "ORDER-99",
  "outcome": "PARTIALLY_FILLED"
}
```

### Why

```json id="f7dl1p"
{
  "policy": "TRADE-POLICY-v17",
  "reason_codes": [
    "MANDATE_PASS",
    "LIMIT_PASS"
  ]
}
```

### How

```json id="5b5i3p"
{
  "agent": "trade-agent:v4",
  "model": "model-x:2026-09",
  "workflow": "trade-workflow:v8",
  "tool": "OMS.submit:v3"
}
```

这样：

> Audit Trail 本身就具备一个稳定的业务语义 API。

---

# 81. 最小模型之外，再增加三个横向控制

数据模型本身解决不了：

```text id="c70l6q"
谁能修改？
保存多久？
如何验证？
```

所以最小模型之上至少需要三个控制：

```text id="4df3nn"
Integrity
Retention
Access
```

即：

```text id="7gk4y4"
Audit Event
    +
Integrity Policy
    +
Retention Policy
    +
Access Policy
```

SEC Rule 17a-4、DORA 和 EU AI Act 都从不同角度说明，记录保存、可访问性、追溯性和完整性不能只靠“有日志”解决。

---

# 82. Integrity：最小需要知道“证据是什么”

因此：

```text id="4e6ku1"
evidence_refs
content_hash
source_authority
```

非常有价值。

如果一个记录被：

```text id="xqgka1"
修改
删除
替换
```

至少能够发现：

```text id="h7yzop"
artifact no longer matches
```

---

# 83. Retention：最小只需要一个 `retention_class`

不建议：

```text id="tno1q0"
retention_days = 1825
```

直接硬编码。

更好的模型：

```text id="xppn0n"
retention_class = SEC_RECORD
```

然后外部 Policy 定义：

```text id="w2d1yo"
SEC_RECORD
→ applicable retention schedule
```

这样法规变化时：

```text id="5vtrq2"
Policy changes
```

不需要迁移所有 Audit Event。

SEC 的电子记录规则和 EU AI Act / DORA 的不同记录要求都说明，保存期限具有业务和法律上下文，而不是一个所有 Agent 通用的数字。

---

# 84. Access：Audit Trail 不是普通日志

金融 Audit Store 可能包含：

```text id="b2f0y4"
customer
portfolio
transaction
PII
trade
internal policy
LLM context
```

因此：

```text id="3n3h1u"
who-can-read
```

也属于治理的一部分。

建议：

```text id="4z5e4t"
Audit Viewer
Audit Investigator
Compliance
Legal
SRE
Developer
```

采用：

```text id="m8b66h"
different access levels
```

而不是：

```text id="x2m1z7"
everyone can query all audit data
```

---

# 85. 为什么“保存 Prompt”不应该默认代表“可审计”

例如 Prompt 包含：

```text id="zxy29v"
客户姓名
账户信息
持仓
内部策略
Vendor Data
```

如果原文直接保存进：

```text id="a4t5vd"
long-term audit store
```

可能造成新的数据保护风险。

AWS Agentic AI Lens 就明确要求在长期存储前进行 sensitive-field masking / redaction。

因此推荐：

```text id="0s1cph"
prompt_ref
prompt_version
prompt_hash
secure_artifact_uri
```

而不是：

```text id="7cf6c6"
prompt_text
```

作为核心必选字段。

---

# 86. 一个非常重要的“最小模型”判断标准

删除一个字段后，问：

> **我们是否因此无法回答某个关键 Who / What / Why / How 问题？**

例如删：

```text id="16rr3r"
trace_id
```

仍然可能可以回答：

```text id="ez1ymn"
Who / What / Why / How
```

只是失去技术细节。

所以：

```text id="ggsmj0"
trace_id
```

不是绝对核心业务字段，而是：

```text id="6ay43p"
supporting correlation
```

再删：

```text id="w8w0z4"
operation_id
```

整个业务链可能就无法关联。

所以：

```text id="pf4lyh"
operation_id
```

是核心。

再删：

```text id="qfxh5w"
actor
```

无法回答：

```text id="jkv7k5"
Who?
```

所以不能删。

这就是“最小模型”最好的设计方法。

---

# 87. 按这种方法，可以得到一个核心字段优先级

### Tier 0：绝不能缺

```text id="8w93hd"
operation_id
event_id
event_type
occurred_at
actor
action
```

### Tier 1：没有它就无法回答完整 Why / How

```text id="2q1jgv"
decision_ref
policy_ref
execution_ref
outcome
correlation_id
```

### Tier 2：强烈建议

```text id="k3c5kw"
evidence_refs
trace_id
external_ref
authority_ref
target_ref
```

### Tier 3：风险场景增加

```text id="q0l0dy"
source_version
entitlement_ref
recovery
human_override
content_hash
retention_class
```

### Tier 4：Observability

```text id="6x8tgm"
latency
tokens
model parameters
host
CPU
memory
```

这就把：

```text id="cf3wlp"
minimum audit
```

和：

```text id="z7eq9y"
full observability
```

明确分开了。

---

# 88. 一个高风险交易的推荐最小记录

如果是：

```text id="8r5wvm"
Trade Agent
```

建议至少：

```json id="1q7h46"
{
  "operation_id": "OP-100",
  "event_id": "E-200",
  "event_type": "ACTION",
  "occurred_at": "2026-09-20T10:31:00Z",

  "actor": {
    "type": "AGENT",
    "id": "TRADE-AGENT:v4",
    "authority_ref": "AGENT-AUTH-22"
  },

  "action": {
    "type": "SUBMIT_ORDER",
    "target_type": "ORDER",
    "target_id": "ORDER-991"
  },

  "decision": {
    "ref": "DEC-300",
    "policy_ref": "TRADE-POLICY:v17"
  },

  "execution": {
    "workflow_ref": "TRADE-WF:v8",
    "tool_ref": "OMS.SUBMIT:v3",
    "model_ref": "MODEL-X:2026-09"
  },

  "outcome": {
    "status": "ACCEPTED",
    "external_ref": "BROKER-8831"
  },

  "correlation": {
    "correlation_id": "OP-100",
    "trace_id": "4bf92f..."
  },

  "evidence_refs": [
    "ART-POLICY-17",
    "ART-APPROVAL-301",
    "ART-BROKER-8831"
  ]
}
```

这已经足够支持：

```text id="53b0bh"
Who
What
Why
How
Outcome
Evidence
```

---

# 89. 高风险 Proxy Vote 可以复用完全相同的模型

只需要换：

```text id="6f0zvh"
operation_type
action_type
target
policy_ref
external_ref
```

例如：

```text id="d7cjrl"
operation_type = PROXY_VOTE
action_type = SUBMIT_VOTE
target = RESOLUTION-3
policy_ref = PROXY-POLICY-v12
external_ref = VENDOR-VOTE-883
```

说明：

> **Audit Model 应该是业务动作通用的，而不是每个 Agent 独立设计一套。**

---

# 90. 对平台而言，最值得标准化的是 `AuditEvent Contract`

例如：

```typescript id="rccyzt"
interface AuditEventContract {
  eventId: string;
  operationId: string;

  type:
    | "INTENT"
    | "AUTHORIZATION"
    | "DECISION"
    | "APPROVAL"
    | "ACTION"
    | "OUTCOME"
    | "INTERVENTION"
    | "RECOVERY";

  occurredAt: string;

  actor: {
    type: ActorType;
    id: string;
    authorityRef?: string;
  };

  action?: {
    type: string;
    targetRef?: string;
  };

  decision?: {
    ref: string;
    policyRef?: string;
    reasonCodes?: string[];
  };

  execution?: {
    agentRef?: string;
    modelRef?: string;
    workflowRef?: string;
    toolRef?: string;
    configRef?: string;
  };

  outcome?: {
    status: string;
    externalRef?: string;
  };

  correlationId: string;
  traceId?: string;

  evidenceRefs?: string[];
}
```

然后所有：

```text id="axkkhk"
Trade Agent
Payment Agent
Proxy Vote Agent
Account Agent
Research Agent
```

都共享同一个 Contract。

---

# 91. 这比要求每个 Agent 自己写 audit log 强得多

否则会出现：

```text id="rw0g1l"
Agent A:
user
action
model

Agent B:
user
prompt
tool

Agent C:
actor
decision
result
```

最终无法：

```text id="4w3qws"
cross-agent query
```

一个平台级 Audit Event Contract 可以强制：

```text id="f1w8z0"
Who
What
Why
How
```

一致存在。

---

# 92. 但不要把 Agent SDK 和 Audit Store 强耦合

推荐：

```text id="n8n4yx"
Agent SDK
  ↓
Audit Event
  ↓
Message / Event Bus
  ↓
Evidence Collector
  ↓
Audit Store
```

而不是：

```text id="5z6p3x"
Agent
  ↓
direct SQL
```

这样可以实现：

```text id="ez44m4"
Agent cannot rewrite audit history
```

并允许：

```text id="v3l2p4"
centralized controls
```

例如：

```text id="7p2tzw"
masking
schema validation
classification
routing
integrity
```

统一处理。

---

# 93. Audit Event 应该先进入一个“Control Boundary”

例如：

```text id="7xzi79"
Agent
  ↓
Audit Event
  ↓
Evidence Gateway
       │
       ├── schema validation
       ├── sensitive data masking
       ├── identity normalization
       ├── correlation validation
       ├── retention classification
       └── integrity protection
       ↓
Evidence Store
```

这样 Agent 只能：

```text id="92h1j9"
emit
```

而不能：

```text id="yk06j4"
control
```

整个 evidence lifecycle。

---

# 94. 这个设计也解决 Multi-Agent

例如：

```text id="w3sswz"
Supervisor Agent
    ↓
Research Agent
    ↓
Risk Agent
    ↓
Execution Agent
```

同一个：

```text id="operation_id"
```

贯穿：

```text id="ocf0w7"
INTENT
DECISION
SUBTASK
RISK_CHECK
APPROVAL
ACTION
OUTCOME
```

每个 Agent 产生：

```text id="f3mc5o"
actor_type = AGENT
actor_id = ...
```

同时：

```text id="r6x4i6"
parent_operation_id
```

可以用来表达层级。

但不要把：

```text id="tvp0hc"
parent_agent
```

和：

```text id="l1cxtt"
business operation
```

混在一起。

---

# 95. Agent-to-Agent Audit 需要两个维度

例如：

```text id="q62pnm"
Supervisor Agent
  ↓
Research Agent
```

应该记录：

```text id="l8p1f3"
actor = supervisor-agent
action = INVOKE_AGENT
target = research-agent
operation = OP-123
```

而 Research Agent 内部：

```text id="cm9h2q"
actor = research-agent
action = SEARCH
operation = OP-123
```

这样可以同时回答：

```text id="6z8w8f"
业务上属于什么操作？
技术上是哪个 Agent 调了哪个 Agent？
```

AWS Agentic AI Lens 对 agent-to-agent correlation 也明确要求通过 correlation identifiers 重建跨 Agent 的调用链。

---

# 96. Audit Trail 最小模型还需要一个 Schema Version

推荐：

```text id="h4k8qb"
schema_version
```

例如：

```text id="9o4iub"
audit_schema_version = 1
```

原因是：

```text id="i5d5y6"
五年后
```

Audit Event Schema 很可能已经升级。

但是：

```text id="klj4p5"
旧记录
```

仍然必须能被解释。

所以：

```text id="dz8q5h"
schema_version
```

非常值得进入最小模型。

---

# 97. 一个更完整的核心字段列表

最终推荐：

```text id="5e5y9m"
AuditEvent v1
──────────────────────────────────
event_id
operation_id
event_type

occurred_at
recorded_at

actor_type
actor_id
authority_ref

action_type
target_ref

decision_ref
policy_ref
reason_codes

agent_ref
model_ref
workflow_ref
tool_ref
config_ref

outcome_status
external_ref

correlation_id
trace_id

evidence_refs

schema_version
```

虽然字段看起来不少，但实际上它们都是：

```text id="d7sw3u"
Who
What
Why
How
Outcome
Correlation
Evidence
```

七个语义组。

---

# 98. 真正可以进一步压缩的是 `execution`

可以：

```text id="x3c8zj"
execution_ref
```

代替：

```text id="b74h6p"
agent_ref
model_ref
workflow_ref
tool_ref
config_ref
```

例如：

```json id="7e3f7s"
{
  "execution_ref": "EXEC-8821"
}
```

然后：

```text id="i0hhv8"
Execution Artifact
```

保存：

```text id="23w8xu"
agent
model
workflow
tool
config
```

这样 Audit Event 可以变得非常薄。

这其实是我更推荐的企业实现。

---

# 99. 最终推荐：两个核心 + 两个引用

如果目标是真正“最小”，可以进一步压缩成：

```text id="uwloq6"
AuditEvent
├── operation_id
├── event_id
├── event_type
├── actor
├── action
├── decision_ref
├── execution_ref
├── outcome
├── correlation_id
└── evidence_refs
```

再由：

```text id="e0f7c7"
Decision Artifact
Execution Artifact
Evidence Artifact
```

承载详细信息。

这样：

```text id="ng4gq4"
AuditEvent
```

只负责：

> **“这件事情发生了什么？”**

而 Artifact 负责：

> **“凭什么证明？”**

---

# 100. 这实际上比一个完整 Audit Log 更接近金融系统

因为它明确区分：

```text id="4j6b03"
Fact
```

和：

```text id="stg7q8"
Proof
```

例如：

```text id="c4woaj"
Fact:
ORDER SUBMITTED
```

Proof：

```text id="ls7z2m"
OMS request
Broker ACK
Execution report
Trace
Approval
Policy
```

这就是金融 Audit Trail 真正的语义。

---

# 101. 一个很有用的检验方法：删字段实验

设计完 Schema 后，逐个删除：

```text id="9tbi98"
operation_id
actor
action
decision
execution
outcome
evidence
correlation
```

每删一个，问：

> 是否仍然可以从这个 Audit Store 和其引用的权威系统回答 Who / What / Why / How？

例如删除：

```text id="p9p0yt"
operation_id
```

可能无法把：

```text id="u4l1xr"
Approval
Decision
Action
Outcome
```

关联起来。

因此：

```text id="kqgu3m"
不可删
```

删除：

```text id="jcex2a"
trace_id
```

也许还能完成审计，只是失去技术调查能力。

因此：

```text id="h8vc9w"
important
```

但不是同一级别的必需字段。

这就是一个非常实际的 Minimum Data Model Design 方法。

---

# 102. 最小模型还应该支持“审计失败”

如果：

```text id="o3w0tq"
policy_ref = null
```

不要默默接受。

应该能够表达：

```text id="w1l58q"
evidence_gap
```

例如：

```json id="r5m4hn"
{
  "operation_id": "OP-123",
  "event_type": "DECISION",
  "evidence_gap": [
    {
      "type": "POLICY_REFERENCE_MISSING",
      "severity": "HIGH",
      "reason": "POLICY_SERVICE_UNAVAILABLE"
    }
  ]
}
```

因为：

> **缺证据本身就是一个风险状态。**

---

# 103. 但 Evidence Gap 不应该混入普通 Action

可以有：

```text id="3tsmco"
AUDIT_EVENT
```

以及：

```text id="n5s3al"
EVIDENCE_GAP
```

作为特殊事件。

例如：

```text id="f1giyy"
DECISION
 ↓
EVIDENCE_GAP
 ↓
MANUAL_REVIEW
```

这样以后可以统计：

```text id="x08rw9"
哪些 Agent 最容易产生 evidence gaps？
```

这比把：

```text id="t3h6u6"
null fields
```

留在那里更有治理意义。

---

# 104. Evidence Completeness 应该成为平台指标

例如：

```text id="lq7fdh"
audit_completeness_score
```

但不要把它理解成监管统一定义的分数。

更实用的是记录：

```text id="w8lj40"
required_evidence
present_evidence
missing_evidence
```

例如：

```text id="4u5zqf"
required:
  approval
  policy
  external_outcome

present:
  approval
  policy

missing:
  external_outcome
```

然后 Workflow 自动进入：

```text id="4a6gwn"
REQUIRES_RECONCILIATION
```

---

# 105. 一个非常重要的架构结论：Audit Trail 不应该是“被动日志”

传统日志：

```text id="k7a3jt"
application logs event
```

而金融 Agent Audit Trail 应该是：

```text id="3tmq7c"
business workflow
        ↓
control decision
        ↓
audit event
        ↓
evidence
```

即：

> **Audit Event 是业务控制流程的一部分，而不是业务执行完成后顺便写一条日志。**

这样才能避免：

```text id="f8qcyo"
business operation succeeds
but audit write fails
```

造成：

```text id="k9s5k4"
Business Fact exists
Audit Fact missing
```

对于关键操作，应考虑 Transactional Outbox / durable event 等模式，让业务状态变化与 Audit Event 的可靠持久化具有一致性保障。

---

# 106. DORA 的 recovery / reconciliation 要求进一步证明了这一点

DORA Article 12 明确要求金融实体在从 ICT incident 恢复时执行必要的 checks 和 reconciliations，以维持数据完整性，也要求在从外部 stakeholder 重建数据时验证系统间的一致性。

这说明：

```text id="m0i2d8"
Business State
+
Recovery State
+
Audit Evidence
```

不能完全割裂。

因此对于：

```text id="UNKNOWN
```

或者：

```text id="RECOVERED"
```

也应该有对应的 Audit Events。

---

# 107. 一个完整 Operation 最小事件序列

```text id="u4z3gl"
INTENT
   ↓
AUTHORIZATION
   ↓
DECISION
   ↓
APPROVAL
   ↓
ACTION
   ↓
OUTCOME
```

失败时：

```text id="7x08kv"
ACTION
   ↓
RECOVERY
   ↓
ACTION
   ↓
OUTCOME
```

人工介入：

```text id="3qefbk"
INTERVENTION
   ↓
ACTION
   ↓
OUTCOME
```

这其实已经可以覆盖：

```text id="dz0i8k"
Trade
Payment
Proxy Vote
Account Mutation
Client Communication
Approval Workflow
```

---

# 108. 为什么 `INTENT` 值得进入最小模型

因为：

```text id="4wxm48"
Action
```

并不一定能够说明：

> 为什么做这件事？

例如：

```text id="7dtgjc"
ACTION = SELL
```

可能来自：

```text id="w4tpku"
Client Request
Rebalancing Rule
Risk Override
Automatic Stop
Human Override
```

因此：

```text id="by7f18"
INTENT
```

最好至少由：

```text id="intent_ref"
```

表示。

它不必保存完整自然语言 Prompt。

---

# 109. `INTENT` 可以由业务 Case 系统提供

例如：

```text id="m1or2h"
case_id = REBALANCE-2026-Q3
```

已经足够成为 Intent Reference。

因此：

```text id="qv7s1c"
Audit Event
  └── intent_ref
```

即可。

这样 Audit Trail 不需要保存：

```text id="7u6kps"
prompt text
```

也能回答：

> 这次操作属于什么业务意图？

---

# 110. 为什么 `DECISION` 与 `AUTHORIZATION` 必须分开

例如：

```text id="eprw4m"
Agent Decision:
BUY

Authorization:
ALLOW
```

这是两个不同事实。

即：

```text id="w73x6z"
Decision
=
Agent 提出了什么

Authorization
=
系统允许不允许
```

这两者如果合并：

```text id="1r5bmt"
decision = ALLOW_BUY
```

会丢失：

```text id="x4mzpv"
Agent judgment
vs
Control decision
```

这在金融 Agent 中非常重要。

---

# 111. Approval 与 Authorization 也不是同一件事

同样：

```text id="q48l8z"
Authorization
=
技术/Policy 层允许

Approval
=
业务责任人明确批准
```

例如：

```text id="4e3k5s"
Policy: ALLOW
Human: NOT YET APPROVED
```

完全可能。

因此：

```text id="l1d8xb"
AUTHORIZATION
   ↓
DECISION
   ↓
APPROVAL
   ↓
ACTION
```

比：

```text id="f9n6m4"
decision = approved
```

更安全。

---

# 112. 最小模型因此不是四个字段，而是一条状态链

可以定义：

```text id="7b5d2k"
Intent
  ↓
Authorization
  ↓
Decision
  ↓
Approval
  ↓
Action
  ↓
Outcome
```

字段只是这条链的实现载体。

因此真正的 Minimum Model 可以理解为：

> **A minimal state transition record that preserves actor, intent, control, decision, action and outcome.**

---

# 113. 这是金融 Agent 与普通 AI Chatbot 最大的分界之一

Chatbot：

```text id="i1rfq4"
User
 ↓
LLM
 ↓
Answer
```

Audit Trail：

```text id="4fovqk"
Business Case
 ↓
Identity
 ↓
Authorization
 ↓
Agent
 ↓
Decision
 ↓
Approval
 ↓
Action
 ↓
External Outcome
```

所以一旦 Agent 开始：

```text id="t91r4w"
change state
send money
trade
vote
approve
modify account
```

它就应该从：

```text id="5a5t0u"
Conversation Log
```

升级为：

```text id="w4n7f2"
Business Audit Trail
```

---

# 114. 最小模型不应该记录“所有 Agent 思考”，而应该记录“控制边界”

这是整个模型设计最核心的思想。

需要知道：

```text id="hq7ts7"
Agent proposed X
```

但更重要：

```text id="zj8rb1"
Policy allowed X
Human approved X
Tool executed X
External System confirmed Y
```

因为这些才是能够：

```text id="0x0n87"
验证
复核
追责
重建
```

的事实。

---

# 115. 一个非常推荐的 Evidence Manifest

在 Audit Event 之外，再生成：

```json id="f1yd80"
{
  "operation_id": "OP-123",

  "claims": [
    {
      "type": "INITIATED_BY",
      "value": "USER-123",
      "evidence": ["ACTOR-123"]
    },
    {
      "type": "AUTHORIZED",
      "value": true,
      "evidence": ["AUTHZ-88"]
    },
    {
      "type": "DECISION",
      "value": "BUY",
      "evidence": ["DEC-77", "POLICY-17"]
    },
    {
      "type": "EXECUTED",
      "value": true,
      "evidence": ["OMS-99", "BROKER-77"]
    },
    {
      "type": "OUTCOME",
      "value": "PARTIALLY_FILLED",
      "evidence": ["SETTLEMENT-88"]
    }
  ]
}
```

它解决：

```text id="h2m0n4"
“这条 Audit Trail 到底证明了什么？”
```

---

# 116. Evidence Manifest 是“证明索引”，不是 Source of Truth

这一点必须继续强调。

```text id="2p0u65"
Evidence Manifest
```

不应该成为：

```text id="9d7c93"
新业务事实
```

而应该是：

```text id="0yemms"
map:
claim → source evidence
```

这样：

```text id="r6n9m4"
Audit Platform
```

不会慢慢变成：

```text id="67pmf7"
第二个交易系统
```

---

# 117. Audit Trail 应该支持外部系统事实

例如：

```text id="v1svz7"
Broker Order
```

最少：

```text id="c6s70z"
external_system
external_ref
external_status
external_timestamp
```

如果：

```text id="8cno0e"
Broker = authoritative
```

那么：

```text id="2nd4pr"
outcome.source_authority = AUTHORITATIVE
```

这样：

```text id="5d0j0n"
Agent Action
```

和：

```text id="s41j9b"
Broker Outcome
```

形成明确区别。

---

# 118. 这与传统金融系统的 Order Identity 思路很接近

FIX 协议中，`ClOrdID` / `OrderID` 与 `OrderStatusRequest` 等机制允许参与者通过稳定订单标识和状态查询来重建订单状态。FIX 的 `OrderStatusRequest` 可以使用 `OrderID` 或 `ClOrdID` 查询订单状态。

这给 Agent Audit Trail 一个很好的启发：

```text id="p2fv0c"
业务操作应该有稳定身份
+
外部系统应该有外部引用
+
状态变化应该可追踪
```

这比：

```text id="rx4zwd"
Agent log says success
```

强得多。

---

# 119. 一个真正适合金融 Agent 的 Audit Trail 查询

例如：

```sql id="rzs4it"
SELECT
    event_type,
    occurred_at,
    actor_id,
    action_type,
    target_id,
    decision_ref,
    policy_ref,
    agent_ref,
    model_ref,
    tool_ref,
    outcome_status,
    external_ref
FROM audit_event
WHERE operation_id = 'OP-20260920-00123'
ORDER BY occurred_at;
```

得到：

```text id="ve4op3"
10:01 INTENT
10:02 AUTHORIZATION
10:03 DECISION
10:04 APPROVAL
10:05 ACTION
10:06 OUTCOME
```

这是一个非常好的 Audit UX。

---

# 120. 但调查人员不应该需要写 SQL

因此上层应该提供：

```text id="8l9d6l"
Audit Case View
```

例如：

```text id="3fplx0"
CASE-2026-00123

WHO
Client User → Manager → Agent

WHAT
Submit BUY 10,000 XYZ

WHY
Mandate → Policy → Approval

HOW
Agent v4 → Model X → Tool v3 → OMS

OUTCOME
7,000 Filled

EVIDENCE
Policy / Approval / Broker / Settlement
```

这就是：

```text id="h9w2b0"
Audit Trail
```

真正对金融组织有用的形态。

---

# 121. 最终建议：平台只规定“Core”，业务定义“Profile”

不要把所有 Agent 强制：

```text id="x4t7e9"
保存 50 个字段
```

而是平台定义：

```text id="lczl55"
Core Audit Contract
```

业务再定义：

```text id="z89i8o"
Evidence Profile
```

例如：

```yaml id="6xnqp0"
core:
  actor: required
  action: required
  target: required
  decision: required
  execution: required
  outcome: required
  correlation: required
  evidence_refs: required
```

交易 Agent：

```yaml id="h6f85g"
profile:
  approval: required
  external_reference: required
  entitlement: required
  settlement: required
  recovery: required
```

Research Agent：

```yaml id="ytdg5o"
profile:
  approval: not_required
  data_provenance: required
  external_reference: not_required
```

这样平台统一、业务灵活。

---

# 122. 一个推荐的 Agent Evidence Profile

例如：

```yaml id="1p8m0b"
agent: trade-agent
risk_tier: high

business_operations:
  - TRADE_EXECUTION

audit:
  intent: required
  authorization: required
  decision: required
  approval: required
  action: required
  outcome: required
  recovery: required

execution:
  agent_version: required
  model_version: required
  tool_version: required
  workflow_version: required

provenance:
  input_sources: required
  source_version: required
  entitlement: required

integrity:
  tamper_evident: required

retention:
  class: SEC_RECORD
```

这就是企业 Agent Platform 真正值得做的平台能力。

---

# 123. 最终完整关系图

```text id="4k6q9f"
                    Business Case
                          │
                          ▼
                    Business Operation
                          │
                 operation_id
                          │
         ┌────────────────┼─────────────────┐
         │                │                 │
         ▼                ▼                 ▼
      INTENT        AUTHORIZATION        DECISION
         │                │                 │
         │                │            policy_ref
         │                │                 │
         │                ▼                 ▼
         │             APPROVAL       reason_codes
         │                │                 │
         └────────────────┼─────────────────┘
                          ▼
                        ACTION
                          │
                     execution_ref
                          │
          ┌───────────────┼─────────────────┐
          ▼               ▼                 ▼
        Agent           Model              Tool
          │               │                 │
          └───────────────┼─────────────────┘
                          ▼
                  External System
                          │
                          ▼
                       OUTCOME
                          │
                  external_ref
                          │
                          ▼
                 Authoritative Record

             ┌──────────────────────────────┐
             │      Evidence Artifacts      │
             │                              │
             │ Policy / Approval / Source   │
             │ Model / Trace / External     │
             │ Version / Hash / Retention   │
             └──────────────────────────────┘
```

这已经是一个比较完整、同时又没有过度设计的金融 Agent Audit Trail。

---

# 124. 最重要的架构结论

如果把所有讨论压缩成一句话：

> **AI Agent Audit Trail 的最小数据模型，不应该记录“所有 Agent 行为”，而应该记录一条能够把业务操作、责任主体、决策依据、执行环境和最终业务结果连接起来的可验证事件链。**

最小语义模型就是：

```text id="3yr1u6"
Operation
  +
Event
  +
Actor
  +
Action
  +
Decision/Policy
  +
Execution
  +
Outcome
  +
Correlation
  +
Evidence Reference
```

其中：

```text id="4r4n2x"
Trace
```

只是：

```text id="h2l4z0"
Execution Evidence
```

而：

```text id="q25qmv"
Policy / Approval / External Record
```

则是：

```text id="f3q6xj"
Control / Business Evidence
```

最终形成：

```text id="6j0s0k"
WHO
actor + authority

WHAT
action + target + outcome

WHY
decision + policy + reason

HOW
agent + model + workflow + tool + provenance

PROOF
evidence + source + version + integrity
```

这才是一个金融 Agent 最小 Audit Trail。

---

# 125. 最终判断：什么应该进入 Core，什么应该留在 Observability

可以用一张表收尾。

| 数据                 | Core Audit | Evidence Artifact | Observability |
| ------------------ | ---------: | ----------------: | ------------: |
| `operation_id`     |         必须 |                   |               |
| `event_id`         |         必须 |                   |               |
| `event_type`       |         必须 |                   |               |
| `actor`            |         必须 |                   |               |
| `action`           |         必须 |                   |               |
| `target`           |         必须 |                   |               |
| `decision_ref`     |         必须 |                   |               |
| `policy_ref`       |         必须 |                   |               |
| `outcome`          |         必须 |                   |               |
| `external_ref`     |        高价值 |                   |               |
| `agent_ref`        |         必须 |                   |               |
| `model_ref`        |        高价值 |                   |               |
| `workflow_ref`     |        高价值 |                   |               |
| `tool_ref`         |        高价值 |                   |               |
| `source_version`   |       场景需要 |                必须 |               |
| `content_hash`     |            |                必须 |               |
| `approval record`  |         引用 |                必须 |               |
| `prompt`           |   通常不必直接保存 |               按风险 |               |
| `LLM output`       |   通常不必直接保存 |               按风险 |               |
| `chain-of-thought` |    不建议作为核心 |              特殊场景 |               |
| `trace_id`         |      高价值引用 |                   |            必须 |
| latency            |            |                   |            必须 |
| token usage        |            |                   |            必须 |
| CPU / memory       |            |                   |            必须 |
| raw logs           |            |               按需要 |            必须 |

这里体现了一个非常重要的边界：

```text id="o63aq5"
Audit Trail
=
Business / Control Evidence

Observability
=
Technical Execution Evidence
```

二者应该关联，但不应该合并。

---

# 126. 最终的最小模型

如果必须给金融 Agent 平台制定一个最小、统一、平台级的标准，我会把它压缩成：

```text id="l0mguj"
AuditEvent
────────────────────────────────────
event_id
operation_id
event_type

occurred_at

actor
action
target

decision_ref
policy_ref

execution_ref

outcome

correlation_id
trace_id

evidence_refs

schema_version
```

再定义：

```text id="gzhwry"
EvidenceArtifact
────────────────────────────────────
artifact_id
artifact_type
source_system
source_ref
source_version
content_hash
source_authority
retention_class
```

以及：

```text id="6ci5wm"
BusinessOperation
────────────────────────────────────
operation_id
operation_type
business_case_id
subject_ref
status
created_at
```

这三类实体已经足够形成一个：

> **Minimum Auditable Agent Model**

之后再按业务风险增加：

```text id="g8gd7i"
authorization detail
approval
entitlement
recovery
human override
data provenance
settlement
legal hold
```

而不是一开始把：

```text id="5w5c5v"
Prompt
Tool Payload
LLM Output
Trace
Metrics
Infrastructure Logs
```

全部塞进同一个 Audit Schema。

---

# 127. 最后一个检验标准

一个金融 Agent 是否拥有合格的最小 Audit Trail，不应该问：

> “我们的日志有多少字段？”

应该问：

> **“只给一个历史 `operation_id`，我们能不能不用依赖 Agent 自己解释，就证明 Who / What / Why / How，以及最终发生了什么？”**

如果能：

```text id="yh9tyr"
operation
→ events
→ actor
→ decision
→ policy
→ execution
→ outcome
→ evidence
```

形成完整链条，那么这个模型已经足够作为平台基础。

如果只能：

```text id="k82x9d"
operation
→ trace
→ prompt
→ response
```

那么系统拥有的是：

```text id="mq1q1h"
Agent Observability
```

还不是：

```text id="3e8u9r"
Financial Audit Trail
```

真正成熟的金融 Agent 架构应该把这个区别固定下来：

```text id="8pp5mv"
                Agent Runtime
                      │
               emits telemetry
                      │
        ┌─────────────┴─────────────┐
        ▼                           ▼
 Observability                 Audit Event
   Trace/Logs                      │
        │                          │
        │                    ┌─────┴─────┐
        │                    ▼           ▼
        │                Decision     Evidence
        │                /Policy     Artifacts
        │                    │           │
        └────────────────────┴───────────┘
                             │
                             ▼
                    Business Outcome
                             │
                             ▼
                     Audit / Compliance
```

最终，Audit Trail 的本质不是：

> **“把 Agent 的所有行为都保存下来。”**

而是：

> **“保留足够少、但足够完整的结构化事实和证据引用，使一个历史金融业务操作可以被重新解释、验证和追责。”**

这就是“最小数据模型”真正应该追求的目标：

```text id="krn6o0"
最少的 Schema
+
明确的业务语义
+
稳定的引用关系
+
可验证的证据
=
可长期治理的 Financial Agent Audit Trail
```

---

# 参考资料

1. **AWS Well-Architected Agentic AI Lens — Agent observability and non-repudiation**
   AWS 明确区分 trace 与 application-level correlation ID，并要求记录 initiating source、decision artifacts、tool interactions、tamper-evident storage 和跨异步边界的重建能力。
   [AWS Agentic AI Lens — Agent observability and non-repudiation](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentsec05.html?utm_source=chatgpt.com)

2. **AWS Agentic AI Lens — Implement distributed tracing for agent interactions**
   关于 trace ID、application-level correlation ID、跨 Queue/Event Bus/Agent 边界传播，以及 Tool Invocation 的完整 tracing。
   [AWS — Distributed tracing for agent interactions](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentsec05-bp02.html?utm_source=chatgpt.com)

3. **AWS Agentic AI Lens — Implement comprehensive logging and decision artifact storage**
   关于 initiator attributes、structured artifact key、CloudTrail validation、dedicated evidence storage 和 tiered retention。
   [AWS — Comprehensive logging and decision artifact storage](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentsec05-bp01.html?utm_source=chatgpt.com)

4. **AWS Agentic AI Lens — Structured logging and comprehensive audit trails**
   关于 structured logs、成功操作记录、immutable/tamper-evident audit trail 和 retention。
   [AWS — Structured logging and comprehensive audit trails](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentops05-bp03.html?utm_source=chatgpt.com)

5. **AWS Agentic AI Lens — Design principles**
   关于把 prompts、tool catalogs、role definitions、model selection、policies 视为 versioned artifacts，以及 proportionate human oversight。
   [AWS — Agentic AI Lens Design Principles](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/design-principles.html?utm_source=chatgpt.com)

6. **OpenTelemetry — Observability Primer**
   OpenTelemetry 对 traces、metrics、logs 和 observability 的定义，可作为 Technical Observability Layer 的基础参考。
   [OpenTelemetry — Observability primer](https://opentelemetry.io/docs/concepts/observability-primer/?utm_source=chatgpt.com)

7. **W3C — Trace Context**
   标准化 `trace-id`、`parent-id`、`traceparent` 等跨服务 Trace Context；它定义的是技术 tracing 关联，不是业务 Audit ID。
   [W3C — Trace Context](https://www.w3.org/TR/trace-context/?utm_source=chatgpt.com)

8. **SEC — Amendments to Electronic Recordkeeping Requirements for Broker-Dealers**
   Rule 17a-4 的 WORM / audit-trail alternative、原始记录重建、修改/删除记录、时间、身份、真实性、可靠性及独立访问要求。
   [SEC — Amendments to Electronic Recordkeeping Requirements for Broker-Dealers](https://www.sec.gov/investment/amendments-electronic-recordkeeping-requirements-broker-dealers?utm_source=chatgpt.com)

9. **SEC — Rule 17a-4 Electronic Recordkeeping FAQs**
   关于 audit-trail alternative 的实施和合规日期，以及独立访问记录等要求。
   [SEC — Electronic Recordkeeping FAQs](https://www.sec.gov/rules-regulations/staff-guidance/trading-markets-frequently-asked-questions/rule-amendments-broker?utm_source=chatgpt.com)

10. **SEC — 2022 Recordkeeping Enforcement**
    16 家华尔街机构因广泛的电子通信 recordkeeping failures 被处罚，合计罚款超过 11 亿美元，是金融记录保存风险的典型真实案例。
    [SEC — Charges 16 Wall Street Firms with Widespread Recordkeeping Failures](https://www.sec.gov/newsroom/press-releases/2022-174?utm_source=chatgpt.com)

11. **FINRA — GenAI: Continuing and Emerging Trends, 2026**
    当前证券行业对 GenAI / Agent 的 supervision、recordkeeping、model version、prompt/output logs、human oversight、system access、agent actions 和 auditability 的监管观察。
    [FINRA — GenAI: Continuing and Emerging Trends](https://www.finra.org/rules-guidance/guidance/reports/2026-finra-annual-regulatory-oversight-report/gen-ai?utm_source=chatgpt.com)

12. **DORA — Regulation (EU) 2022/2554, Articles 11–12**
    关于 ICT response/recovery、活动记录、recovery procedures、checks、reconciliation 和 data integrity。
    [EUR-Lex — DORA Regulation (EU) 2022/2554](https://eur-lex.europa.eu/eli/reg/2022/2554/oj?utm_source=chatgpt.com)

13. **EU AI Act — Regulation (EU) 2024/1689, Article 12 / 19 / 21**
    对适用的 high-risk AI systems，要求自动记录事件、提供适当 traceability，并规定日志保存及向主管机关提供日志等义务；金融机构还存在与欧盟金融服务法 documentation obligations 的衔接。
    [EUR-Lex — Regulation (EU) 2024/1689](https://eur-lex.europa.eu/eli/reg/2024/1689/2026-07-27/eng?utm_source=chatgpt.com)

14. **Federal Reserve / OCC / FDIC — SR 26-2: Revised Guidance on Model Risk Management, 2026**
    关于 risk-based governance、model documentation、validation、ongoing monitoring 和 governance。需要特别注意：该 guidance 明确不把 generative / agentic AI 纳入其传统 model 定义，因此本文仅将其作为治理方法参考，而不是 Agent Audit Schema 的直接法规来源。
    [Federal Reserve — SR 26-2](https://www.federalreserve.gov/supervisionreg/srletters/SR2602.htm?utm_source=chatgpt.com)

15. **PCAOB AS 1105 — Audit Evidence**
    关于 evidence 的 relevance、reliability、sufficiency，以及企业生成信息的 accuracy、completeness 和相关 controls。
    [PCAOB — AS 1105 Audit Evidence](https://pcaobus.org/oversight/standards/auditing-standards/details/AS1105?utm_source=chatgpt.com)

16. **BIS FSI — Humans keeping AI in check**
    关于金融 AI 的 accountability、transparency、explainability、human involvement 和 auditability 的监管研究。
    [BIS FSI — Humans keeping AI in check](https://www.bis.org/fsi/publ/insights35.pdf?utm_source=chatgpt.com)

17. **FIX Trading Community — Trade Appendix**
    `ClOrdID` / `OrderID`、`OrderStatusRequest` 等机制，为金融交易中的稳定业务身份和状态重建提供了成熟参考。
    [FIX Trading Community — Trade Appendix](https://www.fixtrading.org/online-specification/trade-appendix/?utm_source=chatgpt.com)

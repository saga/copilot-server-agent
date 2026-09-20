# 外部系统执行失败时，Agent Workflow 应该如何恢复

> **核心结论**
>
> Agent Workflow 遇到外部系统执行失败时，真正需要解决的通常不是“要不要重试”，而是：
>
> **我们究竟不知道外部操作有没有发生。**
>
> 因此，一个可靠的 Agent Workflow 不应该把 `timeout / connection reset / 5xx / process crash` 简单映射成 `FAILED`，更不能因为“调用没有返回成功”就再次执行同一项具有副作用的业务操作。
>
> 更合理的架构是：
>
> **把外部操作建模为一个独立的、可恢复的业务操作（Operation），区分 Workflow State、Operation State 和 Attempt State；对明确失败执行受控 Retry，对结果不确定的情况进入 UNKNOWN / RECONCILING 状态；通过幂等键、状态查询、Webhook、对账和人工介入把 UNKNOWN 最终收敛到业务事实。**
>
> 对金融服务而言，这一点尤其重要：对于付款、交易、赎回、公司行动、投票、账户修改等操作，“多执行一次”往往比“晚执行一次”危险得多。因此恢复策略的首要目标不是最大化自动成功率，而是避免产生未经授权的重复业务效果，同时让系统最终能够确定业务事实。

---

## 1. 为什么“调用失败”不是一个完整的状态

一个典型的 Agent Workflow 可能如下：

```text
Agent
  │
  ▼
Workflow
  │
  ├── Validate
  ├── Get Data
  ├── Create Order
  ├── Send Approval
  └── Update Internal State
```

假设执行到：

```text
Create Order
```

Workflow 向外部 OMS / Broker / Payment Gateway / Vendor API 发出请求：

```http
POST /orders
```

随后发生：

```text
HTTP 500
```

或者：

```text
Connection reset
```

或者：

```text
Request timeout
```

最容易出现的错误设计是：

```text
HTTP 500
   ↓
Task Failed
   ↓
Retry
   ↓
POST /orders again
```

问题在于：

**HTTP 请求失败，不等于业务操作失败。**

例如：

```text
Workflow
    │
    │ POST /orders
    ▼
External System
    │
    ├── order accepted
    ├── order persisted
    └── response generated
            │
            X network failure
```

结果可能是：

```text
External System = Order Created
Workflow        = Timeout
```

Workflow 如果把这个 timeout 当作：

```text
Order Creation = Failed
```

然后重新 POST：

```text
POST /orders
```

就可能变成：

```text
Order A = Created
Order B = Created
```

这不是普通的技术错误，而是**业务语义错误**。

Amazon Builders' Library 对这个问题有非常明确的描述：复杂工作流调用多个服务时，调用方必须考虑重试产生的副作用，因此 Amazon 的相关 API 使用 caller-provided request identifier 来表达“这是同一个业务意图的重复请求”；这种标识同时也能够帮助审计和资源归属判断。

支付领域的实践同样如此。Stripe 的 API 使用 idempotency key，使客户端可以在连接错误等情况下安全重试；相同 key 的后续请求会返回第一次请求的结果。 Adyen 也明确把 timeout 视为可能存在“请求已被处理但响应丢失”的场景，并要求使用相同 idempotency key 重试，同时结合异步 webhook 追踪缺失响应。

因此：

> **Workflow 应该恢复的是“业务操作”，而不是简单恢复“函数调用”。**

---

# 2. 第一原则：把 Operation、Attempt 和 Workflow State 分开

这是整个架构最重要的设计。

很多 Agent 系统实际上只有：

```text
Workflow Node
    ↓
Tool Call
    ↓
Success / Error
```

对于没有副作用的工作，这已经足够。

例如：

```text
Search document
Calculate value
Generate summary
Call LLM
```

但是对于：

```text
Create order
Submit payment
Approve transaction
Cancel trade
Send instruction
Update account
Submit proxy vote
```

必须进一步建模。

建议至少区分三层：

```text
Business Workflow
       │
       ▼
Business Operation
       │
       ├── Attempt 1
       ├── Attempt 2
       ├── Attempt 3
       └── Reconciliation
```

### 2.1 Workflow State

描述整个业务流程：

```text
PENDING
RUNNING
WAITING
COMPLETED
FAILED
CANCELLED
```

例如：

```text
PortfolioRebalance = WAITING
```

它回答的是：

> 整个业务流程走到哪里了？

---

### 2.2 Operation State

描述某一个具有业务含义的外部操作：

```text
OrderSubmission
PaymentInstruction
VoteSubmission
DocumentPublication
AccountUpdate
```

例如：

```text
operation_id = OP-20260920-1234

operation_state =
    UNKNOWN
```

它回答的是：

> 这项业务操作究竟有没有成功？

---

### 2.3 Attempt State

描述某一次技术调用：

```text
attempt_id = ATTEMPT-01

STARTED
SENT
RESPONSE_RECEIVED
TIMEOUT
CONNECTION_ERROR
```

它回答的是：

> 这一轮具体网络调用发生了什么？

这三个状态不能混在一起。

例如：

```text
Workflow       = RUNNING
Operation      = UNKNOWN
Attempt #1     = TIMEOUT
```

这完全合理。

相反，下面这种模型是不够的：

```text
Workflow node = FAILED
```

因为它丢失了最关键的信息：

> **失败的是“调用”，还是“业务操作”？**

---

# 3. 外部操作至少应该有六种结果

一个成熟 Workflow 不应该只有：

```text
SUCCESS / FAILURE
```

至少应该支持：

| 结果          | 含义         | 是否可以直接 Retry |
| ----------- | ---------- | ------------ |
| `SUCCEEDED` | 已确认执行成功    | 否            |
| `REJECTED`  | 外部系统明确拒绝   | 通常否          |
| `FAILED`    | 明确没有产生业务效果 | 可能           |
| `PENDING`   | 已接受，但尚未完成  | 否，应等待/查询     |
| `UNKNOWN`   | 无法判断是否执行   | 不能盲目 Retry   |
| `CANCELLED` | 已确认取消      | 视业务定义        |

尤其重要的是：

```text
UNKNOWN ≠ FAILED
```

这是整个恢复模型的核心。

---

# 4. UNKNOWN 是最重要的 Workflow State

分布式系统中存在一个非常难处理的窗口：

```text
Client                 Remote System
  │                         │
  │──── Request ───────────>│
  │                         │
  │                    Operation commits
  │                         │
  │<──── Response ──────────X
  │
  Timeout
```

Client 看到了：

```text
Timeout
```

但真正发生的是：

```text
Remote = SUCCESS
Client  = UNKNOWN
```

因此，合理状态机应该是：

```text
                ┌───────────────┐
                │    START      │
                └───────┬───────┘
                        │
                        ▼
                ┌───────────────┐
                │   DISPATCH    │
                └───────┬───────┘
                        │
          ┌─────────────┼──────────────┐
          │             │              │
          ▼             ▼              ▼
      SUCCEEDED      REJECTED       UNKNOWN
                                         │
                                         ▼
                                  RECONCILING
                                    │     │
                          ┌─────────┘     └──────────┐
                          ▼                          ▼
                      SUCCEEDED                   FAILED
                          │                          │
                          ▼                          ▼
                       CONTINUE                    RETRY
```

其中：

```text
RECONCILING
```

不是补丁，而应该是一等状态。

---

# 5. Retry 的正确对象不是“错误”，而是“可重试的业务操作”

很多系统实现成：

```typescript
catch (error) {
  retry();
}
```

这种设计过于粗糙。

正确的模型应该是：

```typescript
type OperationOutcome =
  | "SUCCEEDED"
  | "FAILED"
  | "REJECTED"
  | "PENDING"
  | "UNKNOWN";

type RecoveryDecision =
  | "CONTINUE"
  | "RETRY"
  | "RECONCILE"
  | "COMPENSATE"
  | "MANUAL";
```

然后根据：

```text
error type
+
operation semantics
+
idempotency capability
+
remote status capability
+
business risk
```

共同决定恢复方式。

例如：

| 错误                                  | 推荐动作                   |
| ----------------------------------- | ---------------------- |
| 参数校验失败                              | `REJECTED → STOP`      |
| HTTP 400                            | 通常停止                   |
| HTTP 401/403                        | 停止并处理权限问题              |
| 明确业务拒绝                              | STOP / Business Branch |
| DNS failure before request          | Retry                  |
| Connection refused                  | Retry                  |
| HTTP 503                            | 有条件 Retry              |
| Request timeout                     | `UNKNOWN → RECONCILE`  |
| Connection reset after request sent | `UNKNOWN → RECONCILE`  |
| 外部系统返回 `PENDING`                    | WAIT / POLL / CALLBACK |
| 外部系统明确返回 duplicate                  | 查询已有操作                 |
| 已确认成功但本地写库失败                        | Reconcile              |

---

# 6. Timeout 应该特别小心：它通常不是 FAILED

这是最容易被工程团队误判的一类情况。

假设：

```text
timeout = 10 seconds
```

10 秒到了。

可能发生：

```text
A. Remote 没收到请求
B. Remote 收到了，但没执行
C. Remote 执行了，但没返回
D. Remote 执行了，但响应在网络中丢失
E. Remote 已进入异步 processing
F. Remote 已成功，但本地没有保存 response
```

因此：

```text
timeout
```

本身只能证明：

> Workflow 没有在规定时间内拿到结果。

不能证明：

> Remote operation 没有发生。

AWS Well-Architected 文档明确指出，过短的 timeout 可能增加 retry traffic，甚至造成进一步故障；AWS 同时建议控制 retry 数量、采用 exponential backoff 和 jitter。

Google SRE 对 retry storm 的研究也强调，重试会放大故障负载，因此应该使用 randomized exponential backoff；否则一个下游故障可能演变成 cascading failure。

因此更合理的是：

```text
Timeout
   ↓
UNKNOWN
   ↓
Can query remote status?
   ├── Yes → Query
   │          ├── SUCCESS → Continue
   │          ├── FAILED  → Retry / Stop
   │          └── PENDING → Wait
   │
   └── No → Manual / Reconciliation
```

---

# 7. Idempotency Key 是恢复架构的基础设施，而不是 HTTP 小技巧

如果一个外部 API 支持幂等，应该把 idempotency key 设计成：

> **Business Operation 的稳定身份，而不是某一次 Attempt 的身份。**

错误：

```text
Operation = Pay $100

Attempt 1 → Idempotency-Key=A
Attempt 2 → Idempotency-Key=B
Attempt 3 → Idempotency-Key=C
```

这样实际上每次 Retry 都创造了新的操作。

正确：

```text
Operation ID = OP-123

Attempt 1 → Idempotency-Key=OP-123
Attempt 2 → Idempotency-Key=OP-123
Attempt 3 → Idempotency-Key=OP-123
```

于是外部系统能够理解：

```text
A / A / A
```

都是：

> 同一个业务意图的重新传输。

Amazon 对这一设计有非常直接的经验总结：caller-provided request identifier 不仅能让重试变得安全，还能让服务端明确区分“同一个请求的重试”和“用户真正发起了两个相同请求”。

Stripe、Adyen 都采用了类似思想。

---

# 8. 但是不能假设所有外部系统都支持 Idempotency

现实企业环境往往更复杂。

外部系统可能是：

```text
Modern REST API
Legacy SOAP
Vendor API
SFTP
Message Queue
FIX
Mainframe
Database
Vendor Portal
Human-operated application
```

其中很多系统根本没有：

```text
Idempotency-Key
```

这时不能简单得出：

> “既然不能幂等，所以无法自动恢复。”

而应该采用分层策略。

## 8.1 第一优先级：Remote Query

如果外部系统支持：

```text
GET /orders/{clientOrderId}
GET /payments/{instructionId}
GET /operations/{reference}
```

那么：

```text
Timeout
   ↓
Query
   ↓
Existing Operation?
   ├── YES → adopt existing result
   └── NO  → retry
```

这是非常强的恢复模式。

---

## 8.2 第二优先级：Correlation ID

如果系统没有幂等接口，但支持业务 reference：

```text
ClientOrderId
InstructionId
TransactionReference
CorrelationId
```

Workflow 至少应该生成一个稳定的业务标识：

```text
operation_id = OP-123
external_reference = CLIENT-ORDER-20260920-00123
```

然后所有：

```text
Request
Response
Webhook
Reconciliation
Manual Review
Audit
```

都围绕它关联。

---

## 8.3 第三优先级：异步反馈

如果外部系统支持 webhook / callback：

```text
Workflow
   │
   │ Submit
   ▼
External
   │
   │ async
   ▼
Webhook
   │
   ▼
Workflow
```

那么：

```text
Request response
```

就不应该被当成最终事实。

Adyen 的公开 API 文档把 webhook 与 idempotency 结合起来，明确指出异步 webhook 能帮助处理 timeout 导致的响应缺失。

AWS Step Functions 也把“调用第三方系统、等待外部流程、人工作业完成”作为 callback task 的标准使用场景，并允许 Workflow 暂停直到收到 callback。

---

# 9. 对账 Reconciliation 应该成为 Workflow 的一等能力

很多系统把 reconciliation 当作：

```text
每天凌晨跑一次脚本
```

这是不够的。

对于具有副作用的外部操作：

> **Reconciliation 本身就是业务 Workflow 的一个恢复步骤。**

例如：

```text
Submit Payment
      │
      ▼
   UNKNOWN
      │
      ▼
Query Payment Status
      │
 ┌────┼────┐
 ▼    ▼    ▼
PAID PENDING NOT_FOUND
 │     │       │
 ▼     ▼       ▼
Next   Wait   Retry / Manual
```

因此应该有专门的：

```text
Reconciliation Workflow
```

它可以：

```text
1. 使用 operation_id 查询
2. 使用 external_reference 查询
3. 查询多个 source of truth
4. 接收 webhook
5. 检查消息队列
6. 对比内部与外部状态
7. 修复内部状态
8. 必要时升级人工
```

---

# 10. 金融服务中尤其要采用“先查后做”，而不是“失败就再做”

这在交易系统中非常典型。

FIX Trading Community 的公开规范中，订单生命周期本身就不是简单的：

```text
SEND → SUCCESS
```

而是通过 Execution Report、Order Status 等机制持续反映：

```text
Pending New
New
Partially Filled
Filled
Canceled
Rejected
```

并且规范专门处理重复消息和重复订单，例如通过 `ClOrdID` 等标识识别重复信息。

例如：

```text
Send Order
     │
     X timeout
     │
     ▼
UNKNOWN
     │
     ▼
Order Status Request
     │
 ┌───┴──────────────┐
 ▼                  ▼
Existing Order    Unknown
     │                  │
     ▼                  ▼
Continue             Controlled Retry
```

这个思路不仅适用于证券交易。

同样适用于：

```text
Payment
Cash Transfer
Loan Instruction
Fund Subscription
Redemption
Corporate Action
Proxy Vote
Client Account Update
```

共同特征都是：

> **外部操作具有不可逆或高成本副作用，必须优先避免重复。**

---

# 11. “Retry”本身也必须成为可治理的 Workflow Policy

不能简单地写：

```text
retry = 3
```

一个企业级 Retry Policy 至少应该考虑：

```text
max attempts
retryable error types
backoff
jitter
overall deadline
per-attempt timeout
concurrency limit
rate limit
circuit breaker
business criticality
idempotency support
reconciliation support
```

AWS 的可靠性指导明确建议限制 retry 次数、采用 exponential backoff 和 jitter；同时指出 retry 层级过多可能放大问题，因此底层服务不应该无限重试。

例如：

```text
Agent Runtime
    max retry = 0

Workflow
    max retry = 3

HTTP Client
    max retry = 1
```

而不是：

```text
Agent = 3
Workflow = 3
SDK = 3
Proxy = 3
```

否则最坏情况可能接近：

```text
3 × 3 × 3 × 3 = 81 calls
```

对于金融外部系统，这种 retry multiplication 尤其危险。

---

# 12. 不要让 Agent 自己决定是否重复执行高风险操作

这是 Agent Workflow 与传统 Workflow 最大的区别之一。

传统 Workflow 通常是：

```text
Error Code
   ↓
Deterministic Rule
   ↓
Retry
```

Agent Workflow 很容易变成：

```text
Tool Error
   ↓
LLM reads error
   ↓
"Maybe I should try again"
   ↓
Tool Call
```

这在低风险任务中可以接受，例如：

```text
Search
Retrieve document
Summarize
Generate draft
```

但对于：

```text
Payment
Trade
Transfer
Approval
Vote
Account Mutation
```

不应该让 LLM 从自然语言错误信息中自由决定：

```text
Retry
Compensate
Cancel
Reverse
```

更合理的边界是：

```text
                    ┌──────────────────┐
                    │      Agent       │
                    │                  │
                    │ Reason / Propose │
                    └────────┬─────────┘
                             │
                             │ proposal
                             ▼
                    ┌──────────────────┐
                    │ Workflow Policy  │
                    │                  │
                    │ deterministic    │
                    │ business rules   │
                    └────────┬─────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │ Recovery Engine  │
                    │                  │
                    │ retry/reconcile  │
                    │ wait/compensate  │
                    │ manual escalation│
                    └────────┬─────────┘
                             │
                             ▼
                       External System
```

Agent 可以帮助：

```text
解释错误
识别可能原因
生成诊断建议
总结外部系统状态
准备人工处理方案
```

但不应该拥有：

```text
“timeout 了，我决定再扣一次钱”
```

这种权限。

---

# 13. Compensation 不是 Retry 的另一种写法

Saga 模式经常被错误理解为：

```text
Step failed
   ↓
Undo previous step
```

实际上 compensation 的前提是：

> **你已经知道前面的操作确实发生了。**

AWS 对 Saga 的定义正是把 forward recovery 与 compensation 区分开来：基础设施级暂时故障可以通过 retry 继续推进；业务级失败则可能需要执行补偿事务。

因此：

```text
Payment = UNKNOWN
```

不能直接：

```text
UNKNOWN
   ↓
Compensate Payment
```

因为：

```text
如果根本没支付：
    → Compensation 可能制造新的错误

如果已经支付：
    → Compensation 才有业务意义
```

正确的是：

```text
UNKNOWN
   ↓
RECONCILE
   │
   ├── NOT_EXECUTED
   │       ↓
   │     Retry
   │
   └── EXECUTED
           ↓
       Continue / Compensate
```

---

# 14. Compensation 本身也必须是可恢复操作

另一个常见错误是：

```text
Step A = SUCCESS
Step B = FAILURE
       ↓
Compensate A
       ↓
SUCCESS
```

实际情况可能是：

```text
Compensate A
      │
      X timeout
      │
      ▼
Compensation = UNKNOWN
```

所以真正的模型应该是：

```text
Forward Operation
       │
       ▼
   UNKNOWN
       │
       ▼
 Reconciliation
       │
       ▼
 Compensating Operation
       │
       ▼
   UNKNOWN
       │
       ▼
 Reconciliation
```

也就是说：

> **Compensation 不是恢复机制的终点，它只是另一个需要同样具备可靠恢复能力的 Operation。**

这也是 AWS 对 Saga 复杂性的提醒：补偿事务本身需要被设计、实现和运维，其复杂度会随着参与服务数量增加。

---

# 15. Workflow Engine 应该支持“从失败点继续”，而不是从头重跑

这是成熟 Workflow Engine 与普通 Agent Loop 的重要差异。

假设：

```text
A → B → C → D → E
```

已经完成：

```text
A = SUCCESS
B = SUCCESS
C = SUCCESS
D = FAILED
E = NOT_STARTED
```

恢复应该：

```text
Restart(D)
   ↓
E
```

而不是：

```text
Restart(A)
   ↓
B
   ↓
C
   ↓
D
```

AWS Step Functions 的 redrive 就采用了这种思想：对于失败的 Standard Workflow，redrive 会从失败的步骤继续，并保留成功步骤的结果和历史，不重新执行成功步骤。

Camunda 也采用类似的 incident 模型：任务耗尽 retries 后进入 incident，问题解决后恢复执行，而不是简单结束整个 process。

LangGraph 当前的 fault-tolerance 设计也把 retry、timeout、error handler 分开，并允许在 retries exhausted 后进入恢复或 compensation flow；其 persistence/checkpoint 机制则支持 workflow 在中断或失败之后继续执行。

因此，对于 Agent Workflow：

> **Checkpoint 应该是 Workflow 的恢复边界，而不是 LLM conversation 的记忆。**

---

# 16. 建议的 External Operation 数据模型

企业级 Agent Workflow 可以将外部操作单独持久化。

例如：

```text
workflow_operation
──────────────────────────────────────
operation_id
workflow_execution_id
step_id

operation_type
target_system

idempotency_key
correlation_id
external_reference

business_payload_hash

state
  ├─ CREATED
  ├─ DISPATCHED
  ├─ PENDING
  ├─ UNKNOWN
  ├─ RECONCILING
  ├─ SUCCEEDED
  ├─ FAILED
  ├─ REJECTED
  ├─ COMPENSATING
  └─ MANUAL_REVIEW

last_attempt_id

attempt_count
first_attempt_at
last_attempt_at

remote_status
remote_reference

next_retry_at
next_reconciliation_at

recovery_policy_version

created_by
approved_by

created_at
updated_at
```

然后单独记录：

```text
workflow_operation_attempt
──────────────────────────────────────
attempt_id
operation_id

attempt_number

started_at
request_sent_at
response_received_at

timeout
http_status
error_code
error_class

request_metadata
response_metadata

network_outcome
application_outcome

trace_id
```

这两个实体的意义不同：

```text
Operation
=
“我要完成什么业务动作？”

Attempt
=
“我刚才具体尝试调用了几次？”
```

这一区分对于审计和恢复非常重要。

---

# 17. Audit Log 也不应该只记录 Agent Trace

对于金融场景：

```text
LangSmith Trace
```

或者：

```text
LLM Conversation
```

不能自动等同于：

```text
Regulatory Audit Evidence
```

一次外部业务操作至少应该能够回答：

```text
Who initiated?
Who approved?
What business operation?
What external system?
What payload?
What idempotency key?
What attempt?
When sent?
What response?
What remote reference?
What was the last known remote state?
Why was it retried?
Who / what policy allowed retry?
Was reconciliation performed?
What finally happened?
```

DORA 明确要求金融实体建立 documented response/recovery arrangements，并对关键第三方相关业务连续性进行测试；同时要求在恢复过程中进行必要的 checks and reconciliations，以维护数据完整性。

因此，对于金融 Agent：

```text
Agent Trace
```

应该只是：

```text
Observability Evidence
```

而：

```text
Operation History
Recovery Decision
Remote Confirmation
Reconciliation Evidence
Approval Evidence
```

应该形成另一条能够长期保存和审计的证据链。

---

# 18. External State 应该是 Source of Truth，而不是 Agent Memory

这是 Agent Architecture 中一个非常容易犯的错误。

例如：

```text
Agent Memory:
"Yesterday I submitted payment successfully."
```

不能作为：

```text
Payment = SUCCESS
```

的依据。

正确的是：

```text
Agent Memory
      ↓
Context / Hint
      │
      X
      │
      ▼
External System of Record
      ↓
Authoritative Status
```

甚至：

```text
Workflow State
```

本身也不应该假定永远正确。

例如：

```text
Workflow DB = SUCCESS
External DB = UNKNOWN
```

可能意味着：

```text
Local transaction committed
Remote response was not durable
```

此时仍然需要 reconciliation。

因此：

> **Workflow State 描述“系统认为什么发生了”；Reconciliation 负责确认“业务事实上发生了什么”。**

---

# 19. Outbox 解决的是另一类故障，但非常重要

假设：

```text
Workflow DB
+
Send Message
```

必须同时发生。

典型问题：

```text
DB Commit
   ↓
Process Crash
   ↓
Message never sent
```

或者：

```text
Message sent
   ↓
Process Crash
   ↓
DB Commit failed
```

Transactional Outbox 的做法是：

```text
BEGIN TRANSACTION

Business State Update
        +
Outbox Event

COMMIT
```

然后异步 relay：

```text
Outbox
  ↓
Message Broker
  ↓
Consumer
```

AWS 将 transactional outbox 明确作为解决 distributed dual-write 问题的标准模式，并特别指出消费者必须具备幂等性，因为消息可能重复投递。

这对于 Agent Workflow 很重要：

```text
Workflow DB
       +
Operation State
       +
Recovery Event
```

可以在同一个本地事务中持久化。

例如：

```text
operation.state = UNKNOWN

outbox.insert(
   OperationNeedsReconciliation
)
```

然后：

```text
COMMIT
```

无论后续 worker 是否立刻成功，系统都不会丢失：

> “这个操作需要恢复。”

这比：

```typescript
await db.update(...)
await queue.publish(...)
```

可靠得多。

---

# 20. 需要区分“恢复 Workflow”和“恢复外部系统”

一个非常重要的架构边界是：

> Workflow 可以决定什么时候继续，但通常不能直接修复一个已经坏掉的外部系统。

例如：

```text
Vendor API Down
```

不是：

```text
Agent Retry 100 times
```

就能解决的。

正确可能是：

```text
Vendor API Down
     │
     ├── Retry within budget
     │
     ├── Circuit Breaker
     │
     ├── Queue
     │
     ├── Reconciliation
     │
     └── Manual Escalation
```

金融服务尤其需要把：

```text
Application Recovery
```

与：

```text
Third-party Operational Resilience
```

联系起来。

Basel Committee 当前 consolidated guidelines 中明确要求银行考虑 critical operations 的内部和外部依赖，并管理包括第三方在内的依赖关系。

DORA 也要求金融实体对关键或重要功能涉及的 ICT third-party provider 建立业务连续性安排和恢复机制。

2026 年 ESAs 首份 DORA major ICT incident 年度报告统计了 3,383 起重大 ICT incident，并指出 system failures 和 external events 是主要驱动因素之一，同时强调第三方风险管理及与服务提供商协作的重要性。

这说明：

> 外部系统恢复不是“Agent 的异常处理细节”，而是企业 operational resilience 的一部分。

---

# 21. 一个更完整的恢复架构

推荐的整体结构如下：

```text
                         ┌────────────────────┐
                         │       Agent        │
                         │                    │
                         │ reason / propose   │
                         └─────────┬──────────┘
                                   │
                                   ▼
                         ┌────────────────────┐
                         │ Business Workflow │
                         │                    │
                         │ deterministic flow │
                         └─────────┬──────────┘
                                   │
                                   ▼
                         ┌────────────────────┐
                         │ Recovery Policy    │
                         │                    │
                         │ retry?             │
                         │ reconcile?         │
                         │ compensate?        │
                         │ manual?            │
                         └─────────┬──────────┘
                                   │
                                   ▼
                         ┌────────────────────┐
                         │ Operation Registry │
                         │                    │
                         │ operation_id       │
                         │ idempotency_key    │
                         │ state              │
                         │ attempts           │
                         └─────────┬──────────┘
                                   │
                       ┌───────────┴────────────┐
                       │                        │
                       ▼                        ▼
                ┌──────────────┐        ┌────────────────┐
                │ External API │        │ Reconciliation │
                │              │        │ Engine         │
                └──────┬───────┘        └───────┬────────┘
                       │                         │
              response/webhook/status            │
                       │                         │
                       └───────────┬─────────────┘
                                   ▼
                         ┌────────────────────┐
                         │ Business Outcome   │
                         │                    │
                         │ success            │
                         │ failed             │
                         │ compensated        │
                         │ manual             │
                         └────────────────────┘
```

其中：

```text
Agent
```

负责理解和推理；

```text
Workflow
```

负责业务流程；

```text
Recovery Policy
```

负责定义什么时候可以恢复；

```text
Operation Registry
```

负责保存业务操作事实；

```text
Recovery Engine
```

负责 Retry / Reconcile / Compensation；

```text
External System
```

负责实际业务效果。

这几层不应该被 Agent Loop 混成一个循环。

---

# 22. 一个实用的 Recovery State Machine

一个金融级外部操作可以设计成：

```text
CREATED
   │
   ▼
DISPATCHING
   │
   ├────────────── success ───────────────► SUCCEEDED
   │
   ├────────────── rejected ─────────────► REJECTED
   │
   ├────────────── pending ──────────────► PENDING
   │
   ├────────────── retryable failure ────► RETRY_WAIT
   │
   └────────────── timeout/unknown ──────► UNKNOWN
                                             │
                                             ▼
                                      RECONCILING
                                         │   │
                           ┌─────────────┘   └─────────────┐
                           ▼                               ▼
                       CONFIRMED                       NOT_FOUND
                           │                               │
                  ┌────────┴───────┐                      │
                  ▼                ▼                      ▼
              SUCCESS          NEED_COMPENSATE         RETRY
                  │                │                      │
                  ▼                ▼                      │
               CONTINUE       COMPENSATING ◄─────────────┘
                                     │
                                     ▼
                               RECONCILING
```

这里最重要的不是状态数量，而是三个原则：

### 原则一：UNKNOWN 必须持久化

不能只存在于内存。

### 原则二：Retry 与 Reconcile 是不同动作

```text
Retry
=
再次尝试执行

Reconcile
=
确认之前到底发生了什么
```

### 原则三：Compensation 需要已知事实

```text
Unknown → Reconcile → Confirmed
```

之后才决定：

```text
Continue
或者
Compensate
```

---

# 23. 人工介入不是架构失败

对于高风险金融操作，某些 UNKNOWN 永远可能无法自动判断。

例如：

```text
External system:
“Operation received”

Local system:
timeout

Status API:
unavailable

Webhook:
missing

SFTP:
delayed
```

此时系统可能无法证明：

```text
Executed
```

或者：

```text
Not Executed
```

继续自动执行可能引发：

```text
Duplicate Payment
Duplicate Order
Duplicate Vote
Duplicate Instruction
```

合理的终点应该是：

```text
MANUAL_REVIEW
```

并提供：

```text
Operation ID
External Reference
Attempt History
Raw Error
Last Known Remote State
Reconciliation Result
Recommended Actions
Risk Level
Approval Required
```

Camunda 的 incident 模型体现了这一思想：当 retries 耗尽时，process 会停在 incident 上，问题解决后由操作人员恢复，而不是让流程无限自动尝试。

因此：

> **人工介入不是“自动化没有做好”；对于无法证明安全性的高风险 UNKNOWN，它本身就是一种正确的最终状态。**

---

# 24. 什么时候才适合自动 Retry

可以采用一个简单的决策矩阵：

| 条件                  | 自动 Retry      |
| ------------------- | ------------- |
| 操作无副作用              | 可以更积极         |
| 明确没有发送出去            | 可以            |
| 明确业务失败              | 通常根据业务规则决定    |
| HTTP 5xx            | 需要结合幂等性       |
| timeout             | 先 Reconcile   |
| response 丢失         | 先 Reconcile   |
| external system 已接受 | Wait / Query  |
| 有 Idempotency Key   | Retry 更安全     |
| 有 Status API        | Reconcile 更可靠 |
| 高金额/高风险             | 更保守           |
| 无幂等 + 无查询能力         | 通常进入人工        |
| Compensation 也具有副作用 | 同样需要幂等和恢复     |

因此：

> **“能不能重试”不是技术问题，而是 Operation Contract 的问题。**

---

# 25. 推荐把 External Operation Contract 标准化

企业 Agent Platform 可以要求所有具有副作用的 Tool 实现统一声明：

```typescript
interface ExternalOperationContract {
  operationType: string;

  idempotency: {
    supported: boolean;
    keyScope?: "operation" | "request";
  };

  statusQuery: {
    supported: boolean;
    strategy?: "poll" | "callback" | "webhook";
  };

  retry: {
    retryableErrors: string[];
    maxAttempts: number;
    backoff: "exponential";
    jitter: boolean;
  };

  reconciliation: {
    supported: boolean;
    timeoutPolicy: string;
  };

  compensation?: {
    supported: boolean;
    operationType: string;
  };

  riskLevel:
    | "LOW"
    | "MEDIUM"
    | "HIGH"
    | "CRITICAL";

  manualReview: {
    allowed: boolean;
    requiredAfterUnknown?: boolean;
  };
}
```

这样：

```text
Tool
```

就不再只是：

```text
execute()
```

而变成：

```text
execute()
+
operation semantics
+
recovery semantics
+
audit semantics
```

这对于企业 Agent Platform 比单纯增加更多 Tool API 更重要。

---

# 26. Agent Platform 应该提供一个统一 Recovery Runtime

如果每个业务团队都自己实现：

```text
retry
timeout
reconciliation
idempotency
manual review
audit
compensation
```

最终一定会出现：

```text
A team:
timeout → retry

B team:
timeout → stop

C team:
timeout → duplicate request

D team:
timeout → manual

E team:
timeout → LLM decides
```

这会形成巨大的企业风险。

更合理的是平台提供：

```text
ExternalOperation SDK
```

例如：

```typescript
await operations.execute({
  operationType: "PAYMENT_SUBMISSION",
  operationId,
  idempotencyKey,
  execute: () => paymentApi.submit(...),
  reconcile: () => paymentApi.getStatus(...),
  compensate: ...
});
```

平台统一负责：

```text
operation persistence
attempt history
retry policy
backoff
timeouts
reconciliation scheduling
manual escalation
audit
metrics
tracing
```

业务系统只需要定义：

```text
What is the operation?
How do I execute it?
How do I query it?
How do I compensate it?
What is its risk?
```

---

# 27. 对 Agent Runtime 的一个重要架构结论

因此，应该避免下面这种结构：

```text
Agent Runtime
   ├── Workflow State
   ├── Business State
   ├── Tool Retry
   ├── Compensation
   ├── Approval
   ├── Reconciliation
   └── External System State
```

更合理的是：

```text
                    Agent Runtime
                         │
                         │ proposals / tasks
                         ▼
                ┌──────────────────┐
                │ Workflow Engine  │
                └────────┬─────────┘
                         │
                ┌────────▼─────────┐
                │ Operation Engine │
                └────────┬─────────┘
                         │
             ┌───────────┼───────────┐
             ▼           ▼           ▼
          Retry     Reconcile    Compensate
             │           │           │
             └───────────┼───────────┘
                         ▼
                 External Systems
```

Agent Runtime 的职责应该接近：

```text
reason
plan
invoke
observe
```

而：

```text
durable business recovery
```

属于：

```text
Workflow / Control Plane
```

---

# 28. 一个非常实用的判断标准

设计任何：

```text
Agent → Tool → External System
```

连接时，架构评审至少应该问：

### 1. 这个 Tool 有没有副作用？

```text
Read
vs
Write
```

---

### 2. 如果请求发出后进程立刻 crash，会发生什么？

必须能够回答：

```text
Remote:
?

Local:
?
```

而不是：

```text
“理论上会失败。”
```

---

### 3. 如果 response 丢失，怎么办？

必须明确：

```text
Retry
还是
Reconcile
还是
Manual
```

---

### 4. 是否有稳定的 Operation ID？

如果没有：

```text
如何判断 retry 是同一个业务操作？
```

---

### 5. 外部系统是否支持幂等？

如果支持：

```text
key 的生命周期是什么？
scope 是什么？
```

如果不支持：

```text
是否支持 Query by Reference？
```

---

### 6. 是否有明确的 Source of Truth？

例如：

```text
Local DB
Vendor API
Message Bus
Webhook
Settlement System
```

哪一个最终决定：

```text
SUCCESS？
```

---

### 7. Recovery 是否持久化？

如果：

```text
Agent process crash
Workflow worker crash
Database restart
```

恢复信息是否还存在？

---

### 8. Compensation 是否也是 Operation？

如果 compensation timeout：

```text
怎么办？
```

---

### 9. Manual Review 是否是正式状态？

而不是：

```text
Slack message
Email
```

---

### 10. 是否能够完整回答：

```text
What did we intend to do?
What did we actually attempt?
Did the external system receive it?
Did it execute?
How do we know?
Who approved the recovery?
What happened after recovery?
```

如果这些问题无法回答，那么这个 Workflow 还没有真正解决 external failure recovery。

---

# 29. 最终推荐架构原则

综合 AWS Saga、Amazon Builders' Library、Step Functions、Camunda、LangGraph，以及支付和证券系统公开实践，可以归纳为以下架构原则：

### 原则 1：不要把 Tool Error 等同于 Business Failure

```text
Tool Error ≠ Operation Failure
```

---

### 原则 2：UNKNOWN 是一等业务状态

```text
Timeout
Connection Reset
Lost Response
Process Crash
```

都可能导致：

```text
UNKNOWN
```

---

### 原则 3：先确认，再重复执行

对于具有副作用的操作：

```text
UNKNOWN
   ↓
RECONCILE
   ↓
Retry
```

而不是：

```text
UNKNOWN
   ↓
Retry
```

---

### 原则 4：Idempotency Key 应绑定 Business Operation

而不是绑定 Attempt。

```text
Operation ID
     │
     ├── Attempt 1
     ├── Attempt 2
     └── Attempt 3
```

所有 Attempt 使用同一个业务幂等身份。

---

### 原则 5：Retry、Reconciliation、Compensation 是三种不同能力

```text
Retry
=
重新执行

Reconcile
=
确认事实

Compensate
=
纠正已经发生的业务效果
```

不能混为一谈。

---

### 原则 6：Recovery 必须 Durable

恢复状态必须进入：

```text
Persistent Workflow State
+
Operation History
```

不能只保存在：

```text
Agent Memory
LLM Context
Process Memory
```

LangGraph 当前的 persistence / fault-tolerance 设计，以及 Step Functions 的 redrive，都体现了这一方向。

---

### 原则 7：Agent 可以建议，但 Recovery Policy 应该是确定性的

```text
LLM
  ↓
Proposal

Policy
  ↓
Decision

Workflow
  ↓
Execution
```

尤其对于：

```text
money
trade
approval
account mutation
vote
```

不能让模型自行决定重复执行。

---

### 原则 8：人工介入是安全边界的一部分

当：

```text
External outcome = UNKNOWN
```

并且：

```text
Cannot safely retry
+
Cannot reconcile
```

正确答案不是：

```text
retry forever
```

而是：

```text
MANUAL_REVIEW
```

---

### 原则 9：Reconciliation 应该是一等 Workflow

不是：

```text
nightly script
```

而应该是：

```text
first-class recovery workflow
```

---

### 原则 10：金融 Workflow 的优化目标不是“尽快成功”

更合理的优化目标是：

```text
Correctness
+
Safety
+
Recoverability
+
Auditability
+
Eventual Convergence
```

而不是：

```text
Maximum automatic retry success rate
```

---

# 30. 最后的架构判断

对于普通 AI Agent：

```text
Tool Call
   ↓
Error
   ↓
Retry
```

可能已经够用。

但对于企业特别是金融服务领域的 Agent：

```text
Agent
  ↓
Workflow
  ↓
External Operation
  ↓
External System
```

真正需要建设的是：

```text
                     ┌────────────────────┐
                     │       Agent        │
                     │                    │
                     │ reasoning          │
                     │ proposal           │
                     └─────────┬──────────┘
                               │
                               ▼
                     ┌────────────────────┐
                     │ Workflow / Control │
                     │                    │
                     │ deterministic      │
                     │ business state     │
                     │ approval policy    │
                     └─────────┬──────────┘
                               │
                               ▼
                     ┌────────────────────┐
                     │ Operation Engine   │
                     │                    │
                     │ idempotency        │
                     │ retry              │
                     │ timeout            │
                     │ reconciliation     │
                     │ compensation       │
                     │ manual review      │
                     └─────────┬──────────┘
                               │
                               ▼
                     ┌────────────────────┐
                     │ External Systems   │
                     └────────────────────┘
```

其中最重要的一条边界是：

> **Agent 可以不知道答案，但 Workflow 不能不知道自己处于什么恢复状态。**

更准确地说：

> **Agent 可以对下一步提出建议；Workflow 必须能够证明下一步为什么安全。**

对于外部系统执行失败，最终目标也不是实现一个“万能 Retry”。

真正成熟的设计应该实现：

```text
Every external side effect has:
    a durable operation identity
    a known state model
    an attempt history
    an idempotency strategy
    a reconciliation strategy
    a compensation strategy
    a manual escalation path
    an auditable recovery decision
```

这样，即使：

```text
Agent crash
Workflow crash
Network timeout
Vendor outage
Lost response
Duplicate message
External system partial failure
```

系统仍然能够沿着：

```text
UNKNOWN
   ↓
RECONCILE
   ↓
CONFIRMED FACT
   ↓
CONTINUE / RETRY / COMPENSATE / MANUAL
```

最终收敛。

这才是企业 Agent Workflow 真正意义上的 **recoverable execution**。

---

# 参考资料

1. **AWS Prescriptive Guidance — Saga patterns**：介绍 Saga 的 forward recovery 与 compensation，以及 orchestration / choreography 两种模式。
   [AWS — Saga patterns](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/saga-patterns.html?utm_source=chatgpt.com)

2. **AWS Prescriptive Guidance — Saga orchestration**：讨论分布式事务、Saga Orchestration 及其适用场景。
   [AWS — Saga orchestration pattern](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/saga-orchestration.html?utm_source=chatgpt.com)

3. **AWS Step Functions — Handling errors in workflows**：官方 Retry / Catch 错误处理模型。
   [AWS — Handling errors in Step Functions workflows](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-error-handling.html?utm_source=chatgpt.com)

4. **AWS Step Functions — Redrive executions**：失败 Workflow 从失败点继续、保留成功步骤历史的官方实现。
   [AWS — Restarting state machine executions with redrive](https://docs.aws.amazon.com/step-functions/latest/dg/redrive-executions.html?utm_source=chatgpt.com)

5. **AWS Step Functions — Callback with Task Token**：用于第三方系统、人工作业和异步系统的 callback 模式。
   [AWS — Wait for a Callback with Task Token](https://docs.aws.amazon.com/step-functions/latest/dg/connect-to-resource.html?utm_source=chatgpt.com)

6. **Amazon Builders' Library — Making retries safe with idempotent APIs**：关于幂等 API、caller-provided request identifier、重试副作用和可审计 request identity 的重要实践。
   [Amazon Builders' Library — Making retries safe with idempotent APIs](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/?utm_source=chatgpt.com)

7. **AWS Well-Architected Reliability Pillar — Control and limit retry calls**：关于 retry budget、exponential backoff 和 jitter。
   [AWS — Control and limit retry calls](https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/rel_mitigate_interaction_failure_limit_retries.html?utm_source=chatgpt.com)

8. **AWS Well-Architected Reliability Pillar — Set client timeouts**：关于 timeout 配置、过短 timeout 导致 retry amplification 等问题。
   [AWS — Set client timeouts](https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/rel_mitigate_interaction_failure_client_timeouts.html?utm_source=chatgpt.com)

9. **Google SRE — Addressing Cascading Failures**：关于 retry amplification、exponential backoff 和 jitter。
   [Google SRE — Addressing Cascading Failures](https://sre.google/sre-book/addressing-cascading-failures/?utm_source=chatgpt.com)

10. **AWS Prescriptive Guidance — Transactional Outbox**：解决数据库状态与事件发布之间的 dual-write 问题，并明确指出重复投递要求消费者具备幂等性。
    [AWS — Transactional outbox pattern](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html?utm_source=chatgpt.com)

11. **Stripe — Idempotent requests**：公开 API 对 idempotency key 和安全重试的实际实现。
    [Stripe — Idempotent requests](https://docs.stripe.com/api/idempotent_requests?utm_source=chatgpt.com)

12. **Adyen — API idempotency**：支付系统对 timeout、idempotency key、webhook 和 retry 的公开实践。
    [Adyen — API idempotency](https://docs.adyen.com/development-resources/api-idempotency?utm_source=chatgpt.com)

13. **Camunda 8 — Incidents**：任务 retries 耗尽后进入 incident，通过人工/运维解决后恢复流程。
    [Camunda — Incidents](https://docs.camunda.io/docs/components/concepts/incidents/?utm_source=chatgpt.com)

14. **LangGraph — Fault tolerance**：当前官方文档中的 per-node retry、timeout、error handler 和 compensation flow。
    [LangGraph — Fault tolerance](https://docs.langchain.com/oss/javascript/langgraph/fault-tolerance?utm_source=chatgpt.com)

15. **LangGraph — Persistence**：官方 checkpoint / persistence 设计，用于 workflow 恢复、human-in-the-loop 和 fault tolerance。
    [LangGraph — Persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence?utm_source=chatgpt.com)

16. **FIX Trading Community — FIX Session Layer**：电子交易中可靠、可恢复消息通信的标准会话机制。
    [FIX Trading Community — FIX Session Layer](https://fixtrading.org/standards/fixsession/?utm_source=chatgpt.com)

17. **FIX Trading Community — Trade Appendix / Execution Report**：订单状态、Execution Report、Order Status 和 ClOrdID 等机制。
    [FIX Trading Community — Trade Specification](https://www.fixtrading.org/online-specification/trade-appendix/?utm_source=chatgpt.com)

18. **Basel Committee — Operational resilience**：银行关键业务、内外部依赖、第三方依赖和恢复能力原则。
    [Basel Committee — Operational resilience](https://www.bis.org/committees/bcbs/basel-consolidated-guidelines/module/orr/20.htm?utm_source=chatgpt.com)

19. **EUR-Lex — Digital Operational Resilience Act (DORA), Article 11/12**：金融实体 ICT response/recovery、第三方依赖、恢复、记录以及 reconciliation 要求。
    [EUR-Lex — Regulation (EU) 2022/2554 (DORA)](https://eur-lex.europa.eu/eli/reg/2022/2554/oj?utm_source=chatgpt.com)

20. **European Supervisory Authorities — First report on DORA major ICT-related incidents, 3 June 2026**：对欧盟金融行业重大 ICT incident 的首次年度统计，报告显示 system failures 与 external events 是重要驱动因素，并强调第三方风险和恢复能力。
    [EBA — First report on DORA major ICT-related incidents](https://www.eba.europa.eu/publications-and-media/press-releases/esas-publish-first-report-dora-major-ict-related-incidents?utm_source=chatgpt.com)

# 金融 Agent 的 Retry / Timeout / Compensation 设计

在普通应用里，`Retry`、`Timeout`、`Compensation` 经常被当成异常处理技术；到了金融 Agent，这三个机制实际上已经进入了**业务一致性和风险控制**的范畴。

原因很简单：金融 Agent 调用的工具，很多并不是“计算函数”，而是能够改变外部业务状态的操作：

```text
查询持仓
查询研究资料
        ↓
        低副作用

提交订单
提交付款
发起赎回
修改账户
发送指令
提交 Proxy Vote
        ↓
        有业务副作用
```

对于前一类操作，失败后再试一次通常只是性能问题；对于后一类操作，失败后再试一次可能意味着：

```text
重复下单
重复扣款
重复提交指令
重复投票
重复发送客户通知
重复修改账户
```

所以金融 Agent 的可靠性设计不能从：

> “这个 API 失败了，要不要 Retry？”

开始。

真正应该问的是：

> **这个业务操作目前究竟处于什么状态？我们是否知道它有没有发生？如果不知道，下一步怎样恢复才不会创造第二个业务效果？**

这也是 Retry、Timeout、Compensation 三者在金融 Agent 中最重要的关系：

```text
Retry
= 再执行一次

Timeout
= 我还没有得到结果

Compensation
= 已经确认发生过，需要纠正其业务效果
```

三者不能混为一谈。

更准确地说，一个金融 Agent 的外部副作用应该被设计成：

```text
Business Operation
        │
        ├── Operation Identity
        ├── Attempt History
        ├── Timeout Policy
        ├── Retry Policy
        ├── Reconciliation
        ├── Compensation
        └── Audit Evidence
```

而不是：

```text
Agent
  ↓
Tool Call
  ↓
try / catch
  ↓
retry()
```

---

# 1. 首先改变一个假设：Timeout 不是 Failure

这是整个设计最重要的起点。

假设 Agent 要提交一个订单：

```text
Agent
  │
  │ submitOrder()
  ▼
Broker / OMS
  │
  │ order accepted
  │ order persisted
  │
  X response lost
  │
Agent → timeout
```

Agent 看到的是：

```text
TIMEOUT
```

但是外部系统可能已经是：

```text
ORDER = ACCEPTED
```

所以：

```text
Client timeout
        ≠
Remote business failure
```

这不是理论上的边界情况，而是分布式系统的基本问题。

AWS 的可靠性指南明确指出，客户端 timeout 过短可能导致额外 retry traffic，而 retry 又可能进一步放大后端压力；AWS 同时建议为连接和请求分别设置 timeout，并结合 retry / backoff / circuit breaker 等机制。

Google SRE 也把 retry amplification 视为 cascading failure 的重要来源，并明确建议采用 randomized exponential backoff。

因此，在金融 Agent 中：

```text
Timeout
   ↓
UNKNOWN
```

往往比：

```text
Timeout
   ↓
FAILED
```

更正确。

---

# 2. 金融 Agent 不应该只保存 SUCCESS / FAILED

对于具有副作用的 Tool，至少应该把以下概念分开：

```text
Workflow State
Operation State
Attempt State
```

例如：

```text
Workflow
────────────────
RUNNING


Operation: SubmitOrder
────────────────
UNKNOWN


Attempt #1
────────────────
REQUEST_SENT
TIMEOUT
```

这三个状态同时成立完全没有问题。

## Workflow State

回答：

> 整个业务流程现在进行到哪里？

例如：

```text
PENDING
RUNNING
WAITING
COMPLETED
FAILED
CANCELLED
```

## Operation State

回答：

> 某个具有业务含义的动作现在是什么状态？

例如：

```text
CREATED
DISPATCHED
PENDING
UNKNOWN
RECONCILING
SUCCEEDED
REJECTED
FAILED
COMPENSATING
MANUAL_REVIEW
```

## Attempt State

回答：

> 某一次技术调用到底发生了什么？

例如：

```text
STARTED
REQUEST_SENT
RESPONSE_RECEIVED
TIMEOUT
CONNECTION_RESET
HTTP_503
```

这三个层次分开以后，很多问题自然变得清楚：

```text
Workflow      = RUNNING
Operation     = UNKNOWN
Attempt #1    = TIMEOUT
```

这时 Workflow 不能简单地说：

```text
Task failed → retry
```

它应该进入：

```text
UNKNOWN → RECONCILE
```

---

# 3. Retry 的前提不是“错误可重试”，而是“重复业务效果可接受”

这是金融场景和普通微服务最大的差别之一。

AWS Builders' Library 对这一点有非常直接的生产经验：重试本身非常有效，但前提是重复调用不会产生额外副作用；因此 AWS 使用 caller-provided request identifier 和 idempotent API，使相同业务请求可以安全重传。

AWS Well-Architected 也明确把“Make mutating operations idempotent”列为可靠性最佳实践，并强调 retry 前需要确认服务具备幂等能力。

所以金融 Agent 不应该使用：

```text
if (isRetryable(error)) {
    retry();
}
```

而应该接近：

```text
if (
    transientFailure(error)
    &&
    retryBudgetAvailable()
    &&
    operation.retrySafe()
) {
    retry();
}
```

而 `retrySafe()` 至少应该考虑：

```text
是否幂等
是否已经发送
是否支持状态查询
是否有稳定 operation identity
是否可能产生资金/交易/法律效果
是否已有其他 attempt 在执行
```

---

# 4. Idempotency Key 应该属于 Operation，而不是 Attempt

假设一个 Agent 要执行：

```text
PAY $100
```

错误设计：

```text
Attempt 1 → Idempotency-Key=A
Attempt 2 → Idempotency-Key=B
Attempt 3 → Idempotency-Key=C
```

这实际上告诉远端：

> 这是三个不同的操作。

正确模型应该是：

```text
Operation ID = OP-20260920-001

Attempt 1 → Key=OP-20260920-001
Attempt 2 → Key=OP-20260920-001
Attempt 3 → Key=OP-20260920-001
```

因此：

```text
Operation
   │
   ├── Attempt 1
   ├── Attempt 2
   └── Attempt 3
```

所有 attempt 都继承同一个业务身份。

Stripe 的公开 API 就采用这种方式：创建或更新对象时使用 idempotency key，在 connection error 等情况下可以安全重复请求；相同 key 会返回第一次执行保存的结果。Stripe 还会对相同 key 的参数进行一致性检查，并在一定时间后自动清理 key。

Adyen 的支付 API 也明确支持使用相同 idempotency key 重试 timeout 请求，并指出 webhook 可以帮助追踪因传输 timeout 而缺失的响应。

这些是比较典型的真实金融支付系统实践。

---

# 5. 但是 Idempotency 不是万能的

金融机构大量依赖的系统并不一定是现代 REST API。

现实中可能存在：

```text
REST
SOAP
FIX
SFTP
MQ
Mainframe
Vendor Gateway
Batch
Legacy Adapter
Manual Portal
```

其中一些系统根本没有：

```text
Idempotency-Key
```

这时候不能简单得出：

> “不能幂等，所以只能失败。”

更现实的恢复层级是：

```text
第一层：Idempotency
        ↓
第二层：Stable Business Reference
        ↓
第三层：Status Query
        ↓
第四层：Webhook / Event
        ↓
第五层：Reconciliation
        ↓
第六层：Manual Review
```

其中：

```text
Idempotency
```

最强。

如果做不到，就至少需要一个稳定业务 reference：

```text
clientOrderId
instructionId
paymentReference
voteInstructionId
correlationId
```

---

# 6. 证券交易实际上早已解决了类似问题

金融 Agent 不需要为这些问题重新发明一套理论。

FIX 的订单协议本身就是一个很好的参考。

FIX 中的 `ClOrdID` 是由机构或中间机构分配的订单唯一标识；同时存在 `Order Status Request`，可以基于 `ClOrdID` 或 `OrderID` 查询订单状态。FIX 标准还定义了 `DuplicateClOrdIDIndicator` 等字段。

典型生命周期可以是：

```text
Send New Order
       │
       X response missing
       │
       ▼
UNKNOWN
       │
       ▼
Order Status Request
       │
       ├── New
       ├── Pending New
       ├── Partially Filled
       ├── Filled
       ├── Rejected
       └── Unknown
```

FIX 的标准示例甚至专门描述了：

```text
New Order
   ↓
Status Request
   ↓
Order Status
```

以及订单消息与状态消息交错到达的情况。

这说明：

> **金融系统处理不确定执行结果的核心方法，从来不是单纯 Retry，而是“通过稳定身份重新获得业务事实”。**

---

# 7. 金融 Agent 应该先 Reconcile，再决定 Retry

因此最重要的一条恢复规则是：

```text
UNKNOWN
   ↓
Can I determine what happened?
   │
   ├── YES → SUCCEEDED
   │
   ├── YES → FAILED
   │
   ├── YES → PENDING
   │
   └── NO  → MANUAL_REVIEW
```

只有在：

```text
NOT_EXECUTED
```

已经足够可信地得到确认之后，才进入：

```text
RETRY
```

所以：

```text
UNKNOWN → RETRY
```

不是默认路径。

更接近金融业务的路径是：

```text
UNKNOWN
   ↓
RECONCILE
   ↓
┌───────────────┬───────────────┬─────────────────┐
│               │               │
▼               ▼               ▼
SUCCEEDED      PENDING        NOT_EXECUTED
│               │               │
▼               ▼               ▼
Continue       Wait           Retry
```

如果 reconciliation 也失败：

```text
UNKNOWN
   ↓
RECONCILING
   ↓
STILL_UNKNOWN
   ↓
MANUAL_REVIEW
```

这实际上比“Retry three times”安全得多。

---

# 8. Retry 应该使用 Error Taxonomy，而不是 HTTP Status 一刀切

常见错误可以大致分成四类。

## 8.1 明确的业务拒绝

例如：

```text
INSUFFICIENT_FUNDS
INVALID_ACCOUNT
MARKET_CLOSED
LIMIT_BREACHED
USER_NOT_AUTHORIZED
```

这类通常不能通过 retry 解决。

```text
Business Reject
      ↓
STOP / BUSINESS BRANCH
```

---

## 8.2 明确的客户端错误

例如：

```text
400
401
403
invalid payload
schema validation error
```

一般不应该自动 retry。

否则：

```text
400
 ↓
retry
 ↓
400
 ↓
retry
 ↓
400
```

只是扩大资源消耗。

AWS Well-Architected 特别提醒不要因为 retry 机制存在就重试那些明确无法通过重试解决的错误，例如权限和配置错误。

---

## 8.3 暂时性基础设施错误

例如：

```text
connection refused
DNS transient failure
HTTP 503
rate limit
temporary unavailable
```

这类通常可以考虑 retry。

但还必须满足：

```text
Retryable
+
Retry Safe
+
Budget Available
```

---

## 8.4 结果不确定

例如：

```text
timeout
connection reset after request sent
response body lost
process crash after dispatch
```

这类最危险。

因为：

```text
Failure
```

其实只是：

```text
Outcome Unknown
```

因此应该：

```text
UNKNOWN → RECONCILE
```

而不是：

```text
UNKNOWN → RETRY
```

---

# 9. Timeout 应该被设计成 Budget，而不是一个数字

工程团队经常把 timeout 配成：

```text
timeout = 30s
```

但对于 Agent Workflow，真正需要的是：

```text
End-to-end deadline
```

例如：

```text
Workflow deadline = 120 seconds
```

而不是每一层都自由配置：

```text
Agent timeout = 120s
Workflow timeout = 120s
HTTP timeout = 120s
SDK timeout = 120s
Retry = 3
```

这种配置很容易产生：

```text
120s
 ×
 multiple attempts
```

甚至造成整个 Workflow 已经超时，但内部 HTTP call 还在执行。

更合理的是预算分配：

```text
Workflow Deadline
      │
      ├── Step 1: 20s
      ├── Step 2: 40s
      ├── Retry Backoff: 15s
      ├── Reconciliation: 30s
      └── Reserve: 15s
```

可以抽象为：

```text
T_total
=
Σ T_attempt
+
Σ T_backoff
+
T_reconciliation
+
T_overhead
```

并要求：

```text
T_total <= Workflow Deadline
```

这是一条架构设计规则，而不是某个具体产品的硬性参数。

AWS Agentic AI Lens 当前也强调为每个 step 和 workflow 设置 timeout；对于动态 workflow，还建议从整体 task SLO 推导 branch latency budget。

---

# 10. Connection Timeout、Request Timeout、Workflow Timeout 不应该混为一谈

至少建议区分：

```text
Connection Timeout
=
建立连接最长等待时间

Request Timeout
=
一次远程调用的最大执行等待时间

Operation Deadline
=
业务操作允许等待的最长时间

Workflow Deadline
=
整个业务流程允许运行的最长时间
```

例如：

```text
Workflow = 5 min

External API:
  connect timeout = 2s
  request timeout = 10s

Retry:
  max attempts = 3

Reconciliation:
  max duration = 2 min
```

这四层应该互相协调。

一个非常常见的反模式是：

```text
Workflow deadline = 30s

HTTP request timeout = 60s
```

此时 timeout 已经失去意义，因为外层业务已经不可能继续等待。

AWS 明确建议不要依赖默认 timeout，并指出 timeout 太高会长期占用资源，太低则可能导致更多 retry、更多延迟甚至 outage。

---

# 11. Retry 必须有 Exponential Backoff + Jitter

金融 Agent 不应该：

```text
Retry after 1s
Retry after 1s
Retry after 1s
```

因为多个 workflow 可能在同一时刻一起 retry。

更合理的是：

```text
Attempt 1
   ↓
1s + jitter

Attempt 2
   ↓
2s + jitter

Attempt 3
   ↓
4s + jitter

Attempt 4
   ↓
8s + jitter
```

AWS Well-Architected 明确建议：

```text
Exponential Backoff
+
Jitter
+
Maximum Retry
```

并特别指出多个 retry layer 叠加会放大 retry storm。

Google SRE 也把 randomized exponential backoff 作为避免 cascading failure 的基本措施。

对于金融 Agent，更应该增加：

```text
Retry Budget
```

例如：

```text
per-operation budget
per-external-system budget
per-workflow budget
per-minute global rate
```

因为一个大型基金平台可能同时产生：

```text
10,000 agents
×
same vendor outage
```

这时问题已经不再是单个 workflow 的 retry，而是：

> **整个 Agent 平台是否会把外部系统压垮。**

---

# 12. Retry 不应该出现在多个层级

这是 Agent 平台很容易犯的错误。

例如：

```text
Agent
  retry × 3

Workflow
  retry × 3

HTTP SDK
  retry × 3

Proxy
  retry × 3
```

最坏情况可能迅速膨胀。

因此应该明确：

```text
哪一层拥有 Retry Authority？
```

推荐：

```text
Agent
  retry = 0
      │
      ▼
Workflow / Operation Engine
  retry = policy-driven
      │
      ▼
HTTP client
  retry = 0 或极少
```

具体值需要根据所用 SDK 和协议确定，但原则是：

> **同一个业务操作不要由多个层级各自独立重试。**

AWS 的可靠性文档明确把多层 retry 造成的 attempt multiplication 列为 anti-pattern。

---

# 13. Agent 不应该自己决定 Retry

这是 Agent Architecture 与传统 Workflow 最重要的边界之一。

一个普通 Agent Loop 很容易变成：

```text
Tool error:
"Request timed out."

LLM:
"I should try again."

→ call tool again
```

对于：

```text
Search
Read document
Calculate
Fetch data
```

问题通常不大。

对于：

```text
Submit trade
Transfer money
Approve transaction
Update account
Submit proxy vote
```

则不应该让 LLM 自由决定：

```text
retry
cancel
reverse
compensate
```

AWS 当前 Agentic AI Lens 也明确建议，对高风险操作采用确定性的 risk classification 和 human oversight，并指出风险分类不应完全依赖暴露于同一不可信输入的 LLM；高风险操作应由 deterministic policy 进行约束。

因此更合理的控制链是：

```text
Agent
  │
  │ proposal
  ▼
Policy Engine
  │
  │ allowed?
  ▼
Workflow
  │
  ▼
Operation Engine
  │
  ├── retry
  ├── reconcile
  ├── compensate
  └── manual review
```

LLM 可以：

```text
解释错误
分析上下文
提出恢复建议
总结外部状态
```

但：

```text
“再扣一次款”
```

不应该因为模型“认为应该再试一次”就直接发生。

---

# 14. Compensation 不是 Retry 的高级版本

这是另一个容易混淆的地方。

假设 Workflow：

```text
A = Create Account
B = Reserve Cash
C = Submit Trade
```

如果：

```text
C fails
```

有人会直接想到：

```text
Compensate B
Compensate A
```

但只有在：

```text
A definitely happened
B definitely happened
C definitely failed
```

这个事实足够明确时，compensation 才具有正确语义。

如果：

```text
C = UNKNOWN
```

不能直接：

```text
UNKNOWN
   ↓
Compensate
```

因为：

```text
可能 C 已经成功
```

正确流程是：

```text
UNKNOWN
   ↓
RECONCILE
   ↓
C = SUCCESS
   │
   ├── Continue
   └── Maybe compensate according to business rule

C = NOT_EXECUTED
   │
   └── Retry
```

所以：

> **Compensation 的前提是知道发生了什么；Retry 的前提是知道重复执行是安全的。**

---

# 15. Compensation 也必须当成一个新的 Operation

这是很多 Saga 实现没有充分强调的地方。

假设：

```text
Payment = SUCCESS
```

于是执行：

```text
Refund
```

但是：

```text
Refund
   ↓
timeout
```

那么：

```text
Refund = UNKNOWN
```

而不是：

```text
Refund = FAILED
```

于是又回到：

```text
Refund
   ↓
Reconciliation
```

完整模型其实是：

```text
Forward Operation
       ↓
    UNKNOWN
       ↓
Reconcile
       ↓
Confirmed
       ↓
Compensation
       ↓
UNKNOWN
       ↓
Reconcile
```

所以：

> **Compensation 并不是恢复流程的终点；它本身也是一个需要 Retry / Timeout / Reconciliation / Idempotency 的业务操作。**

Azure Architecture Center 对 Saga 的定义也强调，compensating transaction 是显式的业务操作，而不是数据库自动 rollback；它同时提醒 compensation 自身可能失败，并可能留下不一致状态。

---

# 16. Compensation 也不等于“恢复原状”

尤其在金融业务中：

```text
支付
```

和：

```text
退款
```

并不是数据库意义上的：

```text
rollback
```

因为两者可能发生在不同的业务时间点，并受到：

```text
fees
settlement
FX
interest
market price
regulatory state
downstream notifications
accounting entries
```

影响。

例如：

```text
Buy $1m bond
```

之后价格变化。

所谓 compensation 可能不是：

```text
把系统恢复到昨天
```

而是：

```text
执行一个新的合法业务动作
```

例如：

```text
Reverse
Cancel
Refund
Sell
Release Hold
Reject
Create Adjustment
```

因此金融领域更应该把 Compensation 理解为：

> **把系统从当前错误业务状态推进到另一个被业务规则认可的一致状态。**

而不是：

> “把所有数据库字段改回去。”

---

# 17. Saga 应该尽量减少真正需要 Compensation 的步骤

Saga 并不意味着：

```text
每个步骤都必须有 rollback
```

一个更好的设计往往是：

```text
Business Validation
        ↓
Irreversible / Pivot Decision
        ↓
Retryable Operations
        ↓
Completion
```

Azure 的 Saga 资料明确区分：

```text
Compensable transaction
Pivot transaction
Retryable transaction
```

并指出 pivot transaction 是一个“point of no return”；pivot 之后更适合依靠可重试操作把流程推到最终一致状态，而不是不断做 compensation。

这对金融 Workflow 很重要。

例如：

```text
Validate Order
Check Permission
Check Limit
Reserve Capacity
        ↓
PIVOT
        ↓
Submit
        ↓
Wait Settlement
        ↓
Complete
```

如果能把可失败的业务判断尽量放在 pivot 前，就可以减少：

```text
Submit
 ↓
Failure
 ↓
Rollback
```

这种昂贵且风险更高的流程。

---

# 18. 金融 Agent 更应该采用“Pre-check → Pivot → Retryable Execution”

一个典型结构可以是：

```text
                 Agent Proposal
                       │
                       ▼
             ┌──────────────────┐
             │ Deterministic    │
             │ Policy Checks    │
             └────────┬─────────┘
                      │
             ┌────────┴────────┐
             │                 │
           Reject            Approve
                               │
                               ▼
                        ┌────────────┐
                        │    Pivot   │
                        └─────┬──────┘
                              │
                              ▼
                   Retryable / Async Work
                              │
                    ┌─────────┼─────────┐
                    ▼         ▼         ▼
                 Success    Pending   Unknown
                              │         │
                              │         ▼
                              │      Reconcile
                              │
                              ▼
                         Completion
```

这比：

```text
Agent
 ↓
调用外部系统
 ↓
出了错再想怎么办
```

更加适合金融业务。

---

# 19. “先批准，再执行”和“执行失败后的恢复”必须是两套状态机

金融 Agent 经常有：

```text
Draft
→ Review
→ Approve
→ Execute
```

这时候不要把：

```text
Approval
```

和：

```text
Execution
```

混成一个状态。

例如：

```text
Approval:
  APPROVED

Execution:
  UNKNOWN
```

这是完全合理的。

它表示：

> 人已经批准了这项业务操作，但我们还不知道外部系统最终有没有执行。

同样：

```text
Approval:
  APPROVED

Execution:
  SUCCEEDED

Compensation:
  REQUIRED
```

也可能合理。

因此推荐：

```text
Business Decision State
        │
        ▼
Execution State
        │
        ▼
Settlement / External State
```

而不是：

```text
Agent Memory = "approved and done"
```

---

# 20. Human Approval 也需要 Timeout 和 Safe Fallback

Agent Workflow 中还有一个经常被忽略的 timeout：

```text
Human reviewer timeout
```

例如：

```text
Agent proposes payment
        ↓
Await approval
        ↓
Reviewer unavailable
```

最危险的设计是：

```text
timeout
 ↓
auto approve
```

更合理的是：

```text
timeout
   ↓
escalate
   ↓
secondary reviewer
   ↓
still unavailable
   ↓
safe stop
```

AWS Agentic AI Lens 当前也明确建议审批流程配置 timeout 和 escalation path，并指出 reviewer unavailable 时应有安全 fallback；对高风险操作，安全默认值通常是阻止操作，而不是放行。

---

# 21. 金融 Agent 应该明确区分 Reversible 和 Irreversible Action

可以把 Tool 按业务风险分成：

| 类型               | 示例                 | Retry              | Compensation  |
| ---------------- | ------------------ | ------------------ | ------------- |
| Read-only        | 查询行情、查询文档          | 通常可积极 Retry        | 无             |
| Low-risk write   | 草稿、临时任务            | 可 Retry            | 通常简单          |
| Reversible write | 创建 pending record  | 谨慎 Retry           | 可设计           |
| Financial action | Payment / Transfer | 强幂等 + Reconcile    | 业务定义          |
| Trading          | Order / Cancel     | 强身份 + Status Query | 不应假设 rollback |
| Irreversible     | 投票、不可逆指令           | 极其谨慎               | 通常需要人工/业务补救   |

这里没有一个适用于所有机构的统一 risk tier；具体分类必须由业务、合规、风险和内部控制共同定义。

但一个重要的架构规律是：

> **操作越不可逆，自动 Retry 的自由度越低，Reconciliation 和 Approval 的权重越高。**

---

# 22. Payment 是最容易理解的真实案例

考虑：

```text
Agent
  ↓
Submit Payment
  ↓
timeout
```

Stripe 的做法是：

```text
same Idempotency-Key
       ↓
safe retry
```

而 Adyen 也明确支持相同 idempotency key 的重复请求，并结合 webhook 追踪缺失 response。

因此：

```text
timeout
 ↓
retry same operation identity
 ↓
remote system
```

远端能够判断：

```text
这是原来的 payment attempt
```

而不是：

```text
这是另一笔 payment
```

这正是金融 Agent 平台应该借鉴的地方。

不是：

> Agent 更聪明，所以它知道 timeout 后怎么办。

而是：

> **平台给每个业务操作一个稳定身份，使系统不依赖模型“猜”发生了什么。**

---

# 23. Trading 的核心不是 Idempotency，而是 Order Identity + State Query

交易系统更典型。

一笔订单可能经历：

```text
PENDING NEW
NEW
PARTIALLY FILLED
FILLED
CANCELED
REJECTED
```

所以：

```text
POST /order timeout
```

并不能告诉 Agent：

```text
order failed
```

它应该：

```text
UNKNOWN
   ↓
query by ClOrdID / OrderID
   ↓
obtain authoritative order state
```

FIX 的 `OrderStatusRequest` 就是为此类状态查询设计的。

因此对于 Trading Agent：

```text
Retry
```

通常应该发生在：

```text
NOT_ACCEPTED / NOT_FOUND
```

等已知事实之后，而不是单纯因为：

```text
HTTP timeout
```

---

# 24. Proxy Vote 这类金融操作同样需要 Operation Identity

假设 Agent 根据用户批准的指令执行：

```text
Vote:
Issuer = X
Meeting = Y
Resolution = 3
Choice = FOR
```

然后 vendor API：

```text
timeout
```

此时最危险的设计是：

```text
retry submitVote()
```

如果 vendor 不支持幂等，可能产生：

```text
duplicate instruction
```

更合理的是：

```text
VoteOperationId
  ↓
VendorReference
  ↓
Submit
  ↓
UNKNOWN
  ↓
Query / Reconcile
  ↓
Submitted?
```

如果 vendor 只有 portal 而没有状态 API，则：

```text
UNKNOWN
   ↓
Manual Review
```

可能反而比自动重复提交更正确。

这里体现出一个很重要的原则：

> **自动化程度取决于外部系统的可恢复性，不取决于 Agent 有多聪明。**

---

# 25. Reconciliation 应该是正式的 Workflow，而不是脚本

如果一个外部操作进入：

```text
UNKNOWN
```

建议创建：

```text
Reconciliation Job
```

而不是：

```text
setTimeout(...)
```

Reconciliation 可以：

```text
1. Query external status
2. Query by business reference
3. Consume webhook/event
4. Compare internal/external records
5. Check settlement system
6. Detect duplicate operation
7. Determine final outcome
8. Update operation state
9. Resume original workflow
```

这在金融业尤其重要，因为 DORA Article 12 明确要求金融实体在 ICT incident recovery 中进行必要的 checks 和 reconciliations，以维持数据完整性；对于由 external stakeholders 重建的数据，也要求确保跨系统数据一致。

所以从金融架构角度看：

```text
Reconciliation
```

不是一个“运维脚本”，而是：

> **Operational Recovery Control。**

---

# 26. Workflow Resume 不应该从头开始

假设：

```text
A → B → C → D → E
```

执行结果：

```text
A SUCCESS
B SUCCESS
C SUCCESS
D UNKNOWN
E NOT_STARTED
```

正确的恢复应该是：

```text
D → Reconcile
        ↓
        E
```

而不是：

```text
A → B → C → D
```

因为从 A 开始重新执行可能又产生：

```text
duplicate A
duplicate B
duplicate C
```

AWS Step Functions 的 redrive 是一个很好的成熟实现参考：失败、abort 或 timeout 的 Standard Workflow 可以从失败步骤继续，成功步骤的结果和历史被保留，不重新执行。

这对 Agent Workflow 的架构有一个直接启示：

> **Durable Checkpoint 必须位于业务操作边界，而不只是位于 LLM conversation boundary。**

---

# 27. Agent Memory 不能承担 Recovery State

例如：

```text
Agent Memory:
"I already submitted this payment."
```

不能作为：

```text
Payment = SUCCESS
```

的权威依据。

因为 Memory 可能：

```text
过期
错误
丢失
被截断
受到错误上下文影响
```

Recovery State 应该来自：

```text
Workflow State Store
+
Operation Registry
+
External System of Record
```

而不是：

```text
LLM Context
```

因此：

```text
Agent Memory
=
context

Operation Registry
=
execution fact

External System
=
business fact
```

三者职责不同。

---

# 28. Operation Registry 是金融 Agent 平台很值得建设的基础设施

一个统一的 operation registry 可以类似：

```text
operation
─────────────────────────────
operation_id
workflow_id
step_id

operation_type

business_reference
idempotency_key
correlation_id

target_system

state
remote_state
remote_reference

risk_level

attempt_count

first_attempt_at
last_attempt_at

retry_policy_version
timeout_policy_version

reconciliation_policy_version

approved_by
approved_at

created_at
updated_at
```

Attempt 则单独记录：

```text
operation_attempt
─────────────────────────────
attempt_id
operation_id
attempt_number

started_at
request_sent_at
response_received_at

connect_timeout
request_timeout

transport_result
http_status
business_error_code

trace_id
```

这会带来三个好处。

第一，能够回答：

> 到底尝试了几次？

第二，能够回答：

> 哪一次真的发出去了？

第三，能够回答：

> 最终状态为什么是现在这样？

这比只在 LangSmith 或普通 application log 中保存：

```text
Tool call failed
```

要可靠得多。

---

# 29. Audit Evidence 不能只等于 Agent Trace

对于金融系统，一个 Agent Trace 很有价值，但不能自动等同于业务操作的完整审计证据。

一次高风险操作至少应该能回答：

```text
Who initiated?
Who approved?
What operation?
What business object?
What external system?
What payload or payload hash?
What operation identity?
What attempt happened?
What was sent?
What response was received?
What was the last known external state?
Why was retry allowed?
Who / what policy allowed recovery?
Was reconciliation performed?
What was the final business outcome?
```

DORA Article 11 同时要求金融实体在业务连续性和 recovery plan 被激活时保存活动记录；Article 12 又要求 recovery 中执行必要的 checks and reconciliations。

因此：

```text
Agent Trace
```

应该和：

```text
Business Operation Evidence
```

分开设计。

前者回答：

> Agent 做了什么？

后者回答：

> 企业到底执行了什么业务操作，以及为什么允许这样做？

---

# 30. Outbox 解决的是“我自己的状态和恢复事件没有同时落盘”

还有一类故障经常和 Retry 混在一起。

例如：

```text
Operation = UNKNOWN

DB UPDATE
    ↓
success

Publish Reconciliation Event
    ↓
process crash
```

结果：

```text
Database:
UNKNOWN

Queue:
没有 reconciliation event
```

此时 operation 永远不会恢复。

因此推荐：

```text
BEGIN

operation.state = UNKNOWN

outbox.insert(
  RECONCILE_OPERATION
)

COMMIT
```

然后由 relay：

```text
Outbox
   ↓
Queue
   ↓
Reconciliation Worker
```

这样：

```text
operation state
+
recovery command
```

可以在本地事务里可靠落盘。

AWS 的 Transactional Outbox 指南把这一模式用于解决 database 和 message broker 之间的 dual-write 问题，并同时指出 consumer 仍然需要具备幂等性。

---

# 31. Recovery Engine 应该成为 Agent Platform 的平台能力

如果每个业务团队自己写：

```text
retry()
timeout()
reconcile()
compensate()
manualReview()
```

最终会得到：

```text
Team A → timeout → retry
Team B → timeout → stop
Team C → timeout → retry with new ID
Team D → timeout → email
Team E → timeout → ask LLM
```

这会形成很大的治理问题。

更合理的是平台提供：

```text
Operation Runtime
```

例如：

```typescript
await operationRuntime.execute({
  operationId,
  type: "PAYMENT",

  execute: submitPayment,

  reconcile: queryPayment,

  compensate: refundPayment,

  policy: paymentRecoveryPolicy
});
```

平台统一提供：

```text
idempotency
timeout
retry
backoff
reconciliation
checkpoint
compensation tracking
manual escalation
audit
metrics
```

业务团队只定义：

```text
execute
reconcile
compensate
business semantics
risk classification
```

---

# 32. 一个推荐的总体架构

```text
                         ┌──────────────────────┐
                         │        Agent         │
                         │                      │
                         │ reason / propose     │
                         │ interpret / explain  │
                         └──────────┬───────────┘
                                    │
                                    ▼
                         ┌──────────────────────┐
                         │   Policy / Control   │
                         │                      │
                         │ authorization        │
                         │ risk classification  │
                         │ approval              │
                         └──────────┬───────────┘
                                    │
                                    ▼
                         ┌──────────────────────┐
                         │   Workflow Engine    │
                         │                      │
                         │ durable state        │
                         │ checkpoints           │
                         │ deadlines             │
                         └──────────┬───────────┘
                                    │
                                    ▼
                         ┌──────────────────────┐
                         │   Operation Engine   │
                         │                      │
                         │ idempotency          │
                         │ timeout               │
                         │ retry                 │
                         │ reconcile             │
                         │ compensate            │
                         │ manual escalation     │
                         └──────────┬───────────┘
                                    │
                    ┌───────────────┼────────────────┐
                    │               │                │
                    ▼               ▼                ▼
              External API       Message Bus      Vendor
                    │               │                │
                    └───────────────┼────────────────┘
                                    │
                                    ▼
                         ┌──────────────────────┐
                         │ External Source of   │
                         │ Truth / Settlement   │
                         └──────────────────────┘
```

这个架构的核心不是多几个组件，而是把职责明确分开：

```text
Agent
=
Reasoning

Policy
=
Authorization / Risk Boundary

Workflow
=
Business Process

Operation Engine
=
Reliable Side Effect Execution

External System
=
Business Fact
```

---

# 33. 一个更完整的 Operation State Machine

可以设计成：

```text
                  ┌─────────────┐
                  │   CREATED   │
                  └──────┬──────┘
                         │
                         ▼
                  ┌─────────────┐
                  │ DISPATCHING │
                  └──────┬──────┘
                         │
        ┌────────────────┼────────────────┐
        │                │                │
        ▼                ▼                ▼
   SUCCEEDED         PENDING          UNKNOWN
        │                │                │
        │                │                ▼
        │                │          RECONCILING
        │                │             │   │
        │                │             │   │
        │                │             │   └──────────────┐
        │                │             ▼                  │
        │                │         SUCCEEDED              │
        │                │             │                  │
        │                │             ▼                  │
        │                │         CONTINUE               │
        │                │                                │
        │                ▼                                │
        │              WAIT                                │
        │                │                                │
        │                └───────────────┐                │
        │                                │                │
        ▼                                ▼                ▼
      DONE                          NOT_EXECUTED       MANUAL
                                        │
                                        ▼
                                      RETRY
                                        │
                                        └──────→ DISPATCHING
```

这里故意没有：

```text
UNKNOWN → FAILED
```

因为：

```text
UNKNOWN
```

意味着：

> 当前系统缺乏足够证据判断结果。

这和：

```text
FAILED
```

完全不是一回事。

---

# 34. 一个实用的 Retry / Timeout / Compensation 决策表

| 场景                               | 默认动作                         | 原因                          |
| -------------------------------- | ---------------------------- | --------------------------- |
| Read API 502                     | Retry                        | 通常无副作用                      |
| Read API timeout                 | Retry                        | 查询通常可重复                     |
| POST + idempotency key + 503     | Retry                        | 重复业务身份                      |
| POST + idempotency key + timeout | Retry same key / reconcile   | 结果可能已发生                     |
| Payment timeout                  | Reconcile first              | 可能已经扣款                      |
| Trade timeout                    | Status Query first           | 订单可能已经接受                    |
| 业务明确拒绝                           | Stop                         | Retry 无法改变业务条件              |
| 401/403                          | Stop / escalate              | 权限问题                        |
| Vendor unavailable               | Backoff / queue              | 防止 retry storm              |
| External status = PENDING        | Wait                         | 不应重复执行                      |
| Compensation timeout             | Reconcile compensation       | compensation 自身也是 operation |
| 无幂等、无状态查询、高风险 write              | Manual Review                | 无法证明重复安全                    |
| Agent reasoning error            | Policy / workflow correction | 不是技术 retry 问题               |

---

# 35. Circuit Breaker 与 Retry 不是竞争关系

在金融 Agent 平台里：

```text
Retry
```

解决的是：

> 一个 operation 的 transient failure。

而：

```text
Circuit Breaker
```

解决的是：

> 一个 dependency 当前整体不可用，继续发送请求没有意义。

例如：

```text
Vendor API
  │
  ├── 503
  ├── 503
  ├── 503
  └── 503
```

继续：

```text
retry every operation
```

只会：

```text
vendor down
     ↓
agent retry
     ↓
more traffic
     ↓
vendor even more overloaded
```

所以应该有：

```text
Retry Budget
+
Circuit Breaker
+
Queue
+
Reconciliation
```

AWS Well-Architected 和 Agentic AI Lens 都把 retry limiting、circuit breaker 和 failure isolation 作为可靠 agent/workflow 的重要机制。

---

# 36. Dead Letter Queue 也应该与 Manual Review 区分

例如：

```text
Retry exhausted
```

不等于：

```text
Business manually reviewed
```

推荐：

```text
Retry Exhausted
      ↓
Recovery Queue
      ↓
Reconciliation
      │
      ├── recoverable
      │
      └── unresolved
                ↓
          MANUAL_REVIEW
```

而不是：

```text
Retry exhausted
 ↓
DLQ
```

然后永远没人处理。

对于金融平台，DLQ 应该能够转化成：

```text
Operational Case
```

具备：

```text
case_id
operation_id
risk
last_error
attempt history
external reference
recommended action
required approver
SLA
```

这样：

```text
Failure
```

才能进入真正的 operational recovery。

---

# 37. Recovery 需要同时有“自动”和“人工”路径

建议不是：

```text
automatic OR manual
```

而是：

```text
automatic
   ↓
reconciliation
   ↓
controlled retry
   ↓
controlled compensation
   ↓
manual
```

其中 manual 并不是系统失败后的“人工补丁”。

在高风险金融操作里：

```text
MANUAL_REVIEW
```

本身就是一种合法的业务状态。

例如：

```text
Payment = UNKNOWN
+
No idempotency
+
No query endpoint
+
Large amount
```

此时：

```text
MANUAL_REVIEW
```

比：

```text
Retry
```

更符合风险控制逻辑。

---

# 38. 金融监管环境进一步强化了这种设计

DORA 自 2025 年起适用于欧盟金融实体，其 Article 11 要求金融实体建立 ICT business continuity policy、response and recovery arrangements，并要求在 recovery 中维护相应记录；Article 12 要求 restoration/recovery procedures，并明确要求在从 ICT incident 恢复时进行必要的 checks 和 reconciliations 以维持数据完整性。

这并不意味着 DORA 规定了某种具体的：

```text
retry = 3
timeout = 30s
```

它规定的是更高层的 resilience 和 recovery 能力。

因此，从架构上应把：

```text
Retry
Timeout
Reconciliation
Audit
Recovery
```

视为：

> **Operational Resilience mechanisms**

而不只是 application exception handling。

Basel Committee 的 operational resilience guidance 同样要求银行识别和映射关键业务的内部、外部以及第三方依赖，并确保 recovery arrangements 覆盖 critical operations。

2026 年 EBA 的风险评估报告显示，在 DORA incident reporting 开始之后，system failures 是报告中占主导地位的事件类别之一；EBA 也强调第三方依赖和外部事件对金融机构 operational resilience 的影响。

因此，“外部系统失败”不应该被当作 Agent 的边缘异常。

它本身就是金融 operational resilience 的一部分。

---

# 39. Agent 平台需要增加一个“Recovery Contract”

如果 Tool 只有：

```typescript
interface Tool {
  execute(input): Promise<Result>;
}
```

对于金融场景是不够的。

更合理的是：

```typescript
interface ExternalOperation {
  execute(input): Promise<ExecutionResult>;

  reconcile?(
    operation: OperationContext
  ): Promise<ReconciliationResult>;

  compensate?(
    operation: OperationContext
  ): Promise<CompensationResult>;

  idempotency: IdempotencyContract;

  timeout: TimeoutPolicy;

  retry: RetryPolicy;

  risk: RiskClassification;
}
```

例如：

```typescript
const paymentOperation = {
  execute,
  reconcile: getPaymentStatus,
  compensate: refundPayment,

  idempotency: {
    supported: true,
    key: operationId
  },

  retry: {
    retryable: ["503", "429"],
    maxAttempts: 3,
    backoff: "exponential-jitter"
  },

  timeout: {
    request: "10s",
    operation: "2m"
  },

  risk: "HIGH"
};
```

这样平台才真正知道：

```text
这个 Tool 是什么性质的业务操作？
```

而不是只知道：

```text
这个函数叫什么。
```

---

# 40. 测试不能只测试“Retry 后成功”

金融 Agent 的 fault-injection 测试至少应该覆盖：

```text
Request never sent
Request sent / response lost
Request accepted / process crashed
Response delayed
Duplicate request
Concurrent retry
Vendor returns 503
Vendor rate limits
Webhook delayed
Webhook duplicated
Webhook arrives before local response
Workflow worker crashes
Database commit succeeds / queue publish fails
Queue publish succeeds / worker crashes
Compensation timeout
Manual reviewer timeout
External status unavailable
External status contradicts local state
```

尤其应该测试：

```text
          external system
                │
       ┌────────┴────────┐
       │                 │
      YES               NO
       │                 │
operation happened?     operation happened?
```

而不是只测试：

```text
HTTP 500 → retry
```

真正应该验证的是：

> **系统能否在每一个 failure point 上最终收敛到一个可解释、可审计的 business state。**

---

# 41. 核心监控指标也应该从“错误率”升级为“Recovery Health”

普通 API 常看：

```text
5xx rate
latency
availability
```

金融 Agent 还应该看：

```text
Unknown Operation Count
Unknown Duration
Reconciliation Success Rate
Reconciliation Latency
Retry Attempts / Operation
Retry Exhaustion Rate
Duplicate Operation Rate
Compensation Success Rate
Compensation Unknown Rate
Manual Review Rate
Manual Review SLA Breach
External System Dependency Failure Rate
Operation Recovery Time
```

特别值得监控：

```text
UNKNOWN duration
```

因为：

```text
UNKNOWN 5 seconds
```

和：

```text
UNKNOWN 5 days
```

完全不是同一个 operational risk。

---

# 42. 可以进一步定义一个 Recovery SLO

传统 SLO：

```text
99.9% request success
```

对于高风险金融 operation 不够。

可以定义：

```text
99.9%
of external operations
reach a determinable final business state
within X minutes
```

例如：

```text
99.95%
payment operations
reach
SUCCESS / FAILED / MANUAL_REVIEW
within 5 minutes
```

这里的关键不是要求所有操作自动成功，而是：

> **系统必须及时把“不确定”变成“已知”。**

因此金融 Agent 的可靠性指标可以从：

```text
availability
```

进一步扩展到：

```text
recoverability
```

---

# 43. 一个更适合金融 Agent 的可靠性模型

可以把 operation reliability 分解为：

```text
Reliable Operation
=
Execution Safety
+
Result Determinability
+
Recovery Safety
+
Auditability
```

其中：

### Execution Safety

确保：

```text
duplicate execution
```

不会产生未授权业务效果。

依赖：

```text
idempotency
operation identity
authorization
policy
```

### Result Determinability

确保：

```text
timeout
```

最终可以通过：

```text
status API
webhook
reconciliation
```

知道发生了什么。

### Recovery Safety

确保：

```text
retry
compensation
manual action
```

不会进一步扩大问题。

### Auditability

确保能够回答：

```text
what happened?
why?
who approved?
what policy?
what external state?
```

---

# 44. 一个非常实用的 Architecture Review Checklist

任何金融 Agent Tool 进入 production 前，可以逐项问：

## Operation

```text
这个 Tool 是否产生业务副作用？
```

```text
业务操作是否有稳定 Operation ID？
```

```text
是否存在 external reference？
```

## Timeout

```text
Connection Timeout 是多少？
Request Timeout 是多少？
Operation Deadline 是多少？
Workflow Deadline 是多少？
```

```text
timeout 后业务结果是否可能已经发生？
```

## Retry

```text
什么错误可以 retry？
```

```text
什么错误不能 retry？
```

```text
谁拥有 retry authority？
```

```text
有没有指数退避和 jitter？
```

```text
有没有 retry budget？
```

```text
有没有 global rate limit / circuit breaker？
```

## Idempotency

```text
是否支持 idempotency key？
```

```text
key 是 Operation 级还是 Attempt 级？
```

```text
key 保存多久？
```

```text
并发 retry 如何处理？
```

## Reconciliation

```text
timeout 后如何确认外部状态？
```

```text
有没有 status API？
```

```text
有没有 webhook？
```

```text
没有这些能力时怎么办？
```

## Compensation

```text
什么情况下允许 compensation？
```

```text
compensation 本身是否幂等？
```

```text
compensation timeout 怎么办？
```

```text
compensation 是否可能产生新的业务副作用？
```

## Human

```text
什么时候进入 Manual Review？
```

```text
谁能批准？
```

```text
审批 timeout 怎么办？
```

```text
是否存在 safe fallback？
```

## Audit

```text
能不能重建完整 operation history？
```

```text
能不能知道每次 retry 为什么发生？
```

```text
能不能知道最终 external state？
```

```text
能不能证明谁批准了 recovery？
```

如果这些问题没有明确答案，那么这个 Tool 即使“功能已经跑通”，也还不适合直接成为金融 Agent 的生产级 action。

---

# 45. 最终推荐的设计原则

可以把整套设计归纳为十条。

### 1. Retry 不是第一反应，先判断 Operation State

```text
Error
≠
Business Failure
```

---

### 2. Timeout 的语义是“结果未知”

尤其是：

```text
request sent
+
response missing
```

应该优先考虑：

```text
UNKNOWN
```

---

### 3. Retry 的前提是重复安全

至少满足：

```text
idempotency
or
confirmed-not-executed
```

否则不要盲目 Retry。

---

### 4. Idempotency Key 应属于 Business Operation

```text
Operation
   ├── Attempt 1
   ├── Attempt 2
   └── Attempt 3
```

所有 attempt 应继承同一业务身份。

---

### 5. Reconciliation 是正式的恢复能力

```text
UNKNOWN
   ↓
RECONCILE
```

应该是正式 Workflow，而不是异常处理里的一个临时函数。

---

### 6. Compensation 不是 Rollback

它是：

```text
新的业务操作
```

因此也需要：

```text
idempotency
timeout
retry
reconciliation
audit
```

---

### 7. Agent 不应该拥有高风险 Recovery Authority

Agent：

```text
reason
propose
explain
```

Policy / Workflow：

```text
authorize
decide
execute
recover
```

AWS 当前 Agentic AI guidance 也强调 deterministic policy、risk-tiered approval 和可审计的 workflow orchestration。

---

### 8. Recovery State 必须 Durable

不要把：

```text
UNKNOWN
retry count
operation ID
compensation state
```

只存放在：

```text
LLM context
agent memory
process memory
```

---

### 9. 高风险场景应允许 MANUAL_REVIEW 成为终态

当：

```text
不能安全 Retry
+
不能可靠 Reconcile
```

就不应该为了自动化率强行继续。

---

### 10. 真正的目标不是“Retry until success”

而是：

```text
Execute safely
      ↓
Know what happened
      ↓
Recover safely
      ↓
Reach a determinable business state
```

因此，对于金融 Agent：

> **可靠性不是“请求成功率”，而是“业务操作能够在失败、不确定和部分成功的情况下，安全地收敛到一个确定且可审计的状态”。**

---

# 46. 最终架构判断

从企业 Agent 平台的角度看，最不应该出现的是：

```text
Agent
 ↓
Tool
 ↓
catch
 ↓
retry
```

更成熟的架构应该是：

```text
                     Agent
                       │
                       │ proposal
                       ▼
                ┌──────────────┐
                │    Policy    │
                └──────┬───────┘
                       │
                       ▼
                ┌──────────────┐
                │   Workflow   │
                └──────┬───────┘
                       │
                       ▼
                ┌──────────────┐
                │  Operation   │
                │   Runtime    │
                └──────┬───────┘
                       │
        ┌──────────────┼───────────────┐
        │              │               │
        ▼              ▼               ▼
      Retry       Reconcile       Compensate
        │              │               │
        └──────────────┼───────────────┘
                       ▼
                External System
                       │
                       ▼
                 Business Fact
```

其中最重要的关系是：

```text
Retry
    解决 transient failure

Timeout
    表达 result uncertainty

Reconciliation
    把 uncertainty 变成 fact

Compensation
    把已发生的错误业务效果推进到可接受状态

Manual Review
    处理系统无法安全证明的情况
```

所以金融 Agent 的核心设计原则可以浓缩成一句话：

> **不要让 Agent 通过“再试一次”解决它其实不知道的问题。**

当一个外部操作超时时，系统首先应该问：

```text
“它到底发生了吗？”
```

而不是：

```text
“我要不要再调用一次？”
```

当一个操作已经确认发生，而后续步骤失败时，系统应该问：

```text
“什么业务状态才是正确的最终状态？”
```

而不是：

```text
“怎么把数据库 rollback 回去？”
```

当 Agent 提出：

```text
retry / cancel / compensate
```

时，系统应该问：

```text
“什么 Policy 授权了这个恢复动作？”
```

而不是：

```text
“LLM 为什么这么认为？”
```

这几个边界一旦明确，Retry、Timeout、Compensation 就不再是零散的异常处理技巧，而会自然形成一个完整的 **Financial Agent Recovery Architecture**：

```text
                 Business Intent
                       │
                       ▼
                 Authorization
                       │
                       ▼
                 Operation ID
                       │
                       ▼
                 Controlled Execute
                       │
          ┌────────────┼────────────┐
          │            │            │
       SUCCESS      FAILURE      UNKNOWN
          │            │            │
          │            │            ▼
          │            │       RECONCILIATION
          │            │            │
          │            ├────────────┤
          │            │            │
          ▼            ▼            ▼
       CONTINUE      RETRY      CONFIRMED STATE
                       │            │
                       │       ┌────┴────┐
                       │       │         │
                       │     Continue  Compensate
                       │                 │
                       │                 ▼
                       │            Reconcile
                       │
                       ▼
                 Retry Budget
                       │
                ┌──────┴──────┐
                │             │
             Recover       Manual Review
```

最终真正应该被平台保证的，不是：

```text
“Agent 可以一直 retry。”
```

而是：

```text
Every side-effecting operation has:

a durable identity,
a bounded timeout,
a controlled retry policy,
a known reconciliation path,
a defined compensation strategy,
a manual escalation path,
and an auditable final outcome.
```

这才是金融 Agent 从“能够调用工具”走向“能够可靠执行金融业务”的关键分界线。

---

# 参考资料

1. **AWS Builders' Library — Making retries safe with idempotent APIs**
   Amazon 对复杂分布式 workflow、幂等 API、caller-provided request identifier 和 retry side effects 的生产经验。
   [Amazon Builders' Library — Making retries safe with idempotent APIs](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/)

2. **AWS Well-Architected Framework — Make mutating operations idempotent**
   关于 idempotency token、重复请求、mutating operations 和分布式系统 exactly-once 限制的官方指导。
   [AWS — Make mutating operations idempotent](https://docs.aws.amazon.com/wellarchitected/latest/framework/rel_prevent_interaction_failure_idempotent.html)

3. **AWS Well-Architected Framework — Control and limit retry calls**
   关于 exponential backoff、jitter、maximum retries、多层 retry 与 retry storm。
   [AWS — Control and limit retry calls](https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/rel_mitigate_interaction_failure_limit_retries.html)

4. **AWS Well-Architected Framework — Set client timeouts**
   关于 connection timeout、request timeout、过短/过长 timeout 的后果。
   [AWS — Set client timeouts](https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/rel_mitigate_interaction_failure_client_timeouts.html)

5. **Google SRE — Addressing Cascading Failures**
   关于 retry amplification、cascading failure、randomized exponential backoff。
   [Google SRE — Addressing Cascading Failures](https://sre.google/sre-book/addressing-cascading-failures/)

6. **AWS Step Functions — Handling errors in workflows**
   Retry、Catch、Timeout、Backoff 等 Workflow-level error handling。
   [AWS Step Functions — Handling errors](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-error-handling.html)

7. **AWS Step Functions — Restarting executions with redrive**
   从失败步骤继续执行、保留已成功步骤结果和历史的实际实现。
   [AWS Step Functions — Redrive executions](https://docs.aws.amazon.com/step-functions/latest/dg/redrive-executions.html)

8. **AWS Well-Architected Agentic AI Lens — Predictable task execution**
   关于 Agent 原子任务、least privilege、风险分层和 predictable execution。
   [AWS Agentic AI Lens — Predictable task execution](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentrel02.html)

9. **AWS Well-Architected Agentic AI Lens — Human-in-the-loop for critical decisions**
   关于 deterministic risk classification、高风险操作审批、timeout、escalation 和 safe fallback。
   [AWS Agentic AI Lens — Human-in-the-loop for critical decisions](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentsec04-bp02.html)

10. **AWS Well-Architected Agentic AI Lens — Implement idempotent task execution patterns**
    针对 agentic workflow 的 deterministic operation key、idempotency store 和跨 workflow propagation。
    [AWS Agentic AI Lens — Implement idempotent task execution patterns](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentrel06-bp04.html)

11. **AWS Well-Architected Agentic AI Lens — Workflow orchestration security controls**
    关于 workflow orchestration、state machine validation、circuit breaker 和执行路径控制。
    [AWS Agentic AI Lens — Workflow orchestration security controls](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentsec06-bp02.html)

12. **Stripe — Idempotent requests**
    Stripe 生产支付 API 的 idempotency key、connection error retry、结果缓存和 key 生命周期实践。
    [Stripe — Idempotent requests](https://docs.stripe.com/api/idempotent_requests)

13. **Adyen — API idempotency**
    Adyen 对 payment timeout、相同 idempotency key 重试、webhook 和 transient error 的实际支付平台实践。
    [Adyen — API idempotency](https://docs.adyen.com/development-resources/api-idempotency)

14. **FIX Trading Community — Trade Appendix**
    `ClOrdID`、`OrderStatusRequest`、`OrderID`、`DuplicateClOrdIDIndicator` 等真实证券交易协议机制。
    [FIX — Trade Appendix](https://www.fixtrading.org/online-specification/trade-appendix/)

15. **FIX Trading Community — Order State Changes**
    订单状态变化、Status Request、Execution Report 等交易生命周期示例。
    [FIX — Order State Changes](https://www.fixtrading.org/online-specification/order-state-changes/)

16. **FIX Trading Community — Business Area: Trade**
    Order Status Request、Execution Report 和 cancel / reject 等交易恢复相关机制。
    [FIX — Business Area: Trade](https://archive.fixtrading.org/online-specification/business-area-trade/)

17. **Azure Architecture Center — Saga Design Pattern**
    对 compensating transaction、pivot transaction、retryable transaction，以及 compensation 局限性的系统性说明。
    [Microsoft — Saga Design Pattern](https://learn.microsoft.com/azure/architecture/patterns/saga)

18. **AWS Prescriptive Guidance — Transactional Outbox**
    Database 与 message broker dual-write、可靠发布和 consumer idempotency。
    [AWS — Transactional Outbox](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html)

19. **European Union — Digital Operational Resilience Act (DORA), Regulation (EU) 2022/2554**
    Article 11 的 response/recovery、Article 12 的 recovery procedures、reconciliation、data integrity 和 ICT third-party resilience。
    [EUR-Lex — Regulation (EU) 2022/2554](https://eur-lex.europa.eu/eli/reg/2022/2554/oj)

20. **Basel Committee — Operational Resilience**
    银行关键业务、内外部依赖、第三方依赖和恢复能力的监管原则。
    [BIS — Operational resilience](https://www.bis.org/committees/bcbs/basel-consolidated-guidelines/module/orr/20.htm)

21. **European Banking Authority — Risk Assessment Report, June 2026**
    DORA incident reporting 背景下，金融机构 ICT incidents、system failures 和 external events 的最新风险观察。
    [EBA — Risk Assessment Report June 2026](https://www.eba.europa.eu/publications-and-media/publications/risk-assessment-report-june-2026)

22. **European Supervisory Authorities / EBA — First report on DORA major ICT-related incidents, June 2026**
    欧盟金融部门首份 DORA major ICT incident 汇总报告，强调 system failures、external events 和 third-party risk。
    [EBA — First report on DORA major ICT-related incidents](https://www.eba.europa.eu/publications-and-media/press-releases/esas-publish-first-report-dora-major-ict-related-incidents)

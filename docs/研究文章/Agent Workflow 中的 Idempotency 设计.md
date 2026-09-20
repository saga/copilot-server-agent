# Agent Workflow 中的 Idempotency 设计：具体实现和注意要点

## 摘要

在传统 Web 应用里，Idempotency 往往被理解成一个 API 的工程细节：客户端超时后重试一次，服务端不要把订单创建两遍、付款扣款两次。

进入 Agent Workflow 后，这个问题会明显扩大。

Agent Workflow 天然具有：

* LLM 自主决定下一步；
* Tool Call；
* 多步骤执行；
* 异步消息；
* Workflow checkpoint / resume；
* 自动 retry；
* 并发 worker；
* human approval；
* 长时间等待；
* 外部 API；
* Agent Runtime 重启；
* partial failure。

因此：

```text
一次逻辑操作
        ↓
可能产生多个技术上的执行尝试
```

如果没有明确的 Idempotency 设计，就可能出现：

```text
Agent
  ↓
Tool Call
  ↓
Payment API
  ↓
timeout
  ↓
Agent retry
  ↓
Payment API
```

第一次调用实际上已经成功，只是响应没有回来。

于是最终可能：

```text
扣款 2 次
```

而 Agent 认为：

```text
第一次失败
第二次成功
```

这不是 LLM 特有的问题，而是分布式系统中经典的“未知执行结果 + retry”问题。但 Agent 把它从少数底层基础设施问题，提升成了 Workflow Architecture 的核心问题。

AWS 当前的 Agentic AI Lens 已经把 **“Implement idempotent task execution patterns”** 单独列为高风险最佳实践，并明确指出：retry 如果没有幂等保障可能产生重复副作用；幂等 key 应该稳定，并且需要在多步骤 Workflow 中传播。

因此，一个成熟的 Agent Workflow 不应该把：

```text
retry
```

和：

```text
idempotency
```

分开设计。

正确关系是：

```text
Retry
   ↓
需要重复执行的可能
   ↓
Idempotency
   ↓
允许安全恢复
```

更完整地说：

> **Agent Workflow 的可靠执行，不是“尽量少 retry”，而是让 retry 成为一种安全的正常控制流。**

---

# 1. 先把 Idempotency 说清楚

Idempotency 的经典定义是：

> 一个操作执行一次或多次，在系统最终可观察状态上的效果相同。

AWS Agentic AI Lens 对 Agent 场景的定义也是：相同输入重复执行时，应产生相同结果，并且可以安全 retry 而不产生重复副作用。

例如：

```text
SetAccountStatus(A123, FROZEN)
```

执行：

```text
1 次
```

结果：

```text
A123 = FROZEN
```

执行：

```text
5 次
```

最终仍然：

```text
A123 = FROZEN
```

这类操作天然比较容易实现幂等。

但是：

```text
ChargeCreditCard($100)
```

天然不是幂等操作。

执行：

```text
1 次 → -$100
2 次 → -$200
```

因此需要额外引入：

```text
idempotency key
```

把多个技术请求绑定到同一个**逻辑业务操作**。

---

# 2. Idempotency 不等于 Deduplication

这是整个主题最容易出现的概念混淆。

```text
Deduplication
```

是：

> 判断两次请求是不是同一个请求。

而：

```text
Idempotency
```

是：

> 即使这个请求被执行多次，最终业务效果也不会因为重复执行而被放大。

两者经常一起实现，但不是同一个概念。

例如：

```text
Request A
Request A
Request A
```

服务端可以通过：

```text
idempotencyKey = X
```

检测到：

```text
重复
```

但如果系统只是简单：

```text
if duplicate:
    return
```

并不意味着整个系统就真的幂等。

因为：

```text
第一次请求：
DB 已经更新
外部 Payment API 可能已经成功

第二次请求：
本地 dedupe record 丢失
```

仍然可能重复产生副作用。

因此更完整的定义应该是：

```text
Idempotency
=
Stable operation identity
+
Persistent execution state
+
Atomic duplicate detection
+
Safe result replay
+
Correct handling of uncertain outcomes
```

---

# 3. 最核心的问题其实是：Unknown Outcome

很多系统设计 Idempotency 时，首先想到的是：

```text
duplicate request
```

但真正困难的是：

```text
unknown outcome
```

例如：

```text
Agent
  ↓
Payment Service
  ↓
Payment processed successfully
  ↓
Network timeout
```

Agent 获得：

```text
TIMEOUT
```

但实际世界是：

```text
PAYMENT SUCCEEDED
```

Agent 不知道。

此时：

```text
retry
```

在技术上完全合理。

问题是：

```text
retry
```

可能产生：

```text
second payment
```

这就是分布式系统中的经典 ambiguity：

```text
Did the operation fail?
or
Did the operation succeed but the response fail?
```

Stripe 很早就在其 API 设计中专门针对这个问题引入 Idempotency，指出客户端在看到错误时需要能够安全 retry，以便最终与服务端状态重新收敛。

因此：

> **Idempotency 最重要的价值，不是防止“用户点了两次按钮”，而是解决“我不知道上一次到底有没有成功”。**

---

# 4. Agent Workflow 为什么比普通 API 更需要 Idempotency

传统 API：

```text
Client
 ↓
HTTP
 ↓
Service
```

可能就只有一次 retry。

Agent Workflow：

```text
User
 ↓
Agent
 ↓
Planner
 ↓
Tool
 ↓
Workflow
 ↓
Queue
 ↓
Worker
 ↓
Business API
 ↓
External API
```

任何一层都可能 retry。

而且 retry 来源可能完全不同：

```text
Agent retry
Tool retry
HTTP client retry
SDK retry
Queue redelivery
Worker retry
Workflow resume
Checkpoint replay
Human approval resume
Runtime recovery
Provider retry
```

所以最终不是：

```text
一次请求 → 一次执行
```

而是：

```text
Logical Operation
        │
        ├── Attempt 1
        ├── Retry 1
        ├── Retry 2
        ├── Worker replay
        ├── Queue redelivery
        └── Workflow resume
```

如果每一层都自己生成一个新的：

```text
requestId
```

就完全失去了幂等能力。

AWS Agentic AI Lens 明确把“没有向多步骤 Workflow 传播 Idempotency Key”列为反模式，并建议 Workflow 的每一步使用稳定、可重复计算的 key。

---

# 5. 最重要的设计原则：Idempotency Key 标识“逻辑操作”，不是“技术请求”

这是实现中最值得牢牢记住的一条原则：

> **Idempotency Key 应该标识一次 Logical Operation，而不是一次 HTTP Request、LLM Call 或 Worker Attempt。**

错误：

```text
Attempt 1
idempotencyKey = UUID-1

Retry
idempotencyKey = UUID-2
```

这实际上是在告诉系统：

```text
这是两个操作
```

而不是：

```text
这是同一个操作的两次尝试
```

AWS 当前 Agentic AI Lens 明确警告：如果 retry 时重新生成 timestamp 或 UUID，key 就失去幂等作用；对于 Agent Workflow，应根据 Workflow ID、task type 和 request body 等稳定信息生成 key。

---

# 6. 但“完全根据业务 Payload 做 Hash”也有陷阱

这一点非常容易被 AWS 的“deterministic key”建议误解。

例如：

```text
TransferMoney(
    from=A,
    to=B,
    amount=100
)
```

如果直接：

```text
idempotencyKey = hash(payload)
```

那么：

```text
用户今天转 100
```

和：

```text
用户明天再次主动转 100
```

可能得到完全一样的 key。

但这两笔可能是：

```text
两个合法、不同的业务操作
```

因此：

> **幂等 key 应该对同一个 Logical Operation 稳定，而不应该把所有“参数相同的业务操作”错误地合并。**

更合理的是：

```text
logicalOperationId
+
stepIdentity
+
canonicalInput
```

例如：

```text
workflowId:
WF-2026-001

step:
PAYMENT

logicalOperationId:
OP-9988

payloadHash:
abc123
```

形成：

```text
idempotencyKey =
WF-2026-001:PAYMENT:OP-9988
```

或者：

```text
hash(
    workflowId
    + stepType
    + logicalOperationId
    + canonicalPayload
)
```

这样：

```text
同一 Workflow 的同一步 retry
```

使用同一个 key。

而：

```text
新的 Workflow
```

即使参数完全一样，也可以拥有新的 key。

---

# 7. 推荐把 Idempotency Identity 分成三层

一个成熟的 Agent Workflow 可以同时拥有：

```text
workflowId
operationId
attemptId
```

例如：

```text
workflowId
    WF-100

operationId
    REFUND-P123

attemptId
    ATTEMPT-7
```

语义分别是：

### Workflow ID

整个业务流程：

```text
WF-100
```

### Operation ID

Workflow 中的一个逻辑业务操作：

```text
REFUND-P123
```

### Attempt ID

这个操作的某一次实际技术执行：

```text
ATTEMPT-7
```

所以：

```text
Workflow
  WF-100
     │
     └── Operation
          REFUND-P123
              │
              ├── Attempt 1
              ├── Attempt 2
              └── Attempt 3
```

Idempotency 应该绑定：

```text
Operation
```

而不是：

```text
Attempt
```

这是整个模型最关键的结构。

---

# 8. Agent Run ID 也不应该直接等于 Idempotency Key

另一个常见错误：

```text
idempotencyKey = agentRunId
```

这通常过于粗粒度。

一个 Agent Run 可能执行：

```text
Search customer
Get portfolio
Create draft
Submit approval
Send notification
```

这些都是不同的业务操作。

因此：

```text
AgentRunId
```

适合作为：

```text
trace / causation context
```

而：

```text
IdempotencyKey
```

应该属于具体的 mutation operation。

例如：

```text
agentRunId:
RUN-123

step 1:
SearchCustomer

step 2:
CreatePaymentCommand
idempotencyKey:
RUN-123:CREATE-PAYMENT:PAY-789

step 3:
SendNotification
idempotencyKey:
RUN-123:SEND-NOTIFICATION:PAY-789
```

---

# 9. 一个可靠的 Agent Workflow Identity 模型

可以统一定义：

```typescript
interface WorkflowContext {
  workflowId: string;

  agentRunId: string;

  logicalOperationId: string;

  parentOperationId?: string;
}
```

每一个真正产生业务副作用的 Step：

```typescript
interface OperationIdentity {
  workflowId: string;
  operationId: string;
  stepType: string;

  idempotencyKey: string;
}
```

例如：

```typescript
const identity = {
  workflowId: "WF-100",
  operationId: "REFUND-P123",
  stepType: "REFUND_PAYMENT",

  idempotencyKey:
    "WF-100:REFUND_PAYMENT:REFUND-P123"
};
```

如果 Worker 重启：

```text
same workflow
same operation
same key
```

如果 retry：

```text
same workflow
same operation
same key
```

如果新的业务请求：

```text
new operation
new key
```

---

# 10. Idempotency Store 的核心结构

一个最基础的表可以：

```sql
CREATE TABLE idempotency_record (
    idempotency_key     VARCHAR(255) PRIMARY KEY,

    operation_type      VARCHAR(100) NOT NULL,

    request_hash        VARCHAR(128) NOT NULL,

    status              VARCHAR(30) NOT NULL,

    response_code       INTEGER,

    response_body       JSONB,

    resource_reference  VARCHAR(255),

    created_at          TIMESTAMP NOT NULL,

    updated_at          TIMESTAMP NOT NULL,

    expires_at          TIMESTAMP
);
```

状态至少可以有：

```text
PROCESSING
SUCCEEDED
FAILED_RETRYABLE
FAILED_FINAL
```

必要时还可以增加：

```text
UNKNOWN
EXPIRED
CANCELLED
```

---

# 11. 最基本的执行流程

一个简单的伪代码：

```typescript
async function executeIdempotently(
  key: string,
  request: Request
) {
  const existing =
    await idempotencyStore.get(key);

  if (existing?.status === "SUCCEEDED") {
    return existing.response;
  }

  if (existing?.status === "PROCESSING") {
    return waitOrRecover(existing);
  }

  await idempotencyStore.createIfAbsent({
    key,
    requestHash: hash(request),
    status: "PROCESSING"
  });

  try {
    const result =
      await doSideEffect(request);

    await idempotencyStore.markSucceeded(
      key,
      result
    );

    return result;
  } catch (error) {
    await idempotencyStore.markFailed(
      key,
      error
    );

    throw error;
  }
}
```

看起来简单，但这里隐藏了一个极其重要的问题：

```text
createIfAbsent
```

必须是原子的。

否则：

```text
Worker A
check → not found

Worker B
check → not found
```

然后：

```text
A → execute
B → execute
```

还是重复执行。

因此：

> **Idempotency 的第一道真正控制是 atomic claim，而不是普通的 SELECT。**

---

# 12. 必须使用 Atomic Create / Conditional Write

例如 PostgreSQL：

```sql
INSERT INTO idempotency_record (
    idempotency_key,
    operation_type,
    request_hash,
    status,
    created_at,
    updated_at
)
VALUES (
    $1,
    $2,
    $3,
    'PROCESSING',
    now(),
    now()
)
ON CONFLICT (idempotency_key)
DO NOTHING;
```

然后检查：

```text
inserted = 1
```

还是：

```text
inserted = 0
```

如果：

```text
inserted = 1
```

代表：

```text
当前 worker 获得执行权
```

如果：

```text
inserted = 0
```

代表：

```text
已经有另一个 execution instance
```

再读取现有记录。

AWS 推荐在 Agentic AI 场景中使用 DynamoDB conditional writes 来保证并发 retry 只有一个 execution owner，并通过 TTL 控制幂等记录的增长。

---

# 13. DynamoDB Conditional Write 也非常适合这种场景

概念上：

```text
PutItem
Condition:
attribute_not_exists(idempotencyKey)
```

只有第一次可以成功。

第二个并发请求：

```text
ConditionalCheckFailed
```

然后：

```text
读取现有 execution record
```

这比：

```text
SELECT
INSERT
```

两个独立步骤更加安全。

---

# 14. PROCESSING 状态其实是最难处理的状态

很多实现只考虑：

```text
SUCCEEDED
```

和：

```text
NOT FOUND
```

但真正难的是：

```text
PROCESSING
```

例如：

```text
Worker A
    ↓
create PROCESSING
    ↓
call external payment
    ↓
payment succeeds
    ↓
worker crashes
    ↓
没有写 SUCCEEDED
```

现在：

```text
Worker B
    ↓
same key
    ↓
sees PROCESSING
```

问题：

> B 应该重新执行吗？

不能简单：

```text
retry immediately
```

因为 A 可能已经：

```text
成功扣款
```

也不能永远：

```text
wait forever
```

因为 A 可能真的挂死。

因此必须区分：

```text
execution ownership
```

和：

```text
business completion
```

---

# 15. PROCESSING 状态需要 Lease

可以设计：

```text
leaseOwner
leaseExpiresAt
heartbeatAt
```

例如：

```text
idempotencyKey:
REFUND:P123

status:
PROCESSING

leaseOwner:
worker-7

leaseExpiresAt:
16:30
```

如果 Worker A 正常执行：

```text
heartbeat
```

不断续期。

如果 Worker A 崩溃：

```text
lease expires
```

Worker B 才能尝试 recovery。

但是：

> **Lease 解决的是“谁可以继续执行”，并不能证明外部副作用有没有发生。**

这是非常重要的区别。

---

# 16. “Lease Expired” 不等于“Operation Failed”

例如：

```text
Worker A
lease expired
```

不能直接推断：

```text
payment failed
```

实际可能：

```text
payment succeeded
worker died
```

或者：

```text
payment never started
```

所以 Recovery 需要：

```text
state reconciliation
```

例如：

```text
query Payment Provider
    ↓
查 payment reference
    ↓
FOUND
    ↓
mark SUCCEEDED
```

如果：

```text
NOT FOUND
```

才可以考虑：

```text
safe retry
```

这就是为什么：

> **对有外部副作用的系统，Idempotency 最终必须和 Reconciliation 结合。**

---

# 17. 这也是为什么“Exactly Once”经常被说得过头

很多架构文档会说：

```text
Idempotency
→ Exactly Once
```

这是不准确的。

Idempotency 可以帮助你做到：

```text
same logical operation
不会因为 retry 被重复应用
```

但无法在任意分布式系统中凭空创造：

```text
exactly-once side effect
```

例如：

```text
Your Database
        ↓
External Bank API
```

如果没有跨系统事务：

```text
DB
commit

Bank API
success
```

和：

```text
DB
commit

Bank API
success
but response lost
```

以及：

```text
DB
rollback

Bank API
success
```

都可能发生。

因此：

> **Idempotency 是控制重复效果的机制，不是分布式系统的“魔法 exactly-once”。**

AWS Transactional Outbox 文档也明确指出，Outbox 可以解决数据库写入与消息发布之间的 dual-write 问题，但消费者仍必须处理 duplicate messages。

Kafka 官方文档同样区分 producer idempotence、transactional exactly-once 与 consumer 侧语义；即使 Kafka 可以提供特定范围内的 exactly-once 处理，也不能自动把任意外部 side effect 变成 exactly once。

---

# 18. Agent Workflow 更应该采用“至少一次执行 + 幂等”

对于大多数企业 Workflow：

```text
At-least-once delivery
+
Idempotent execution
```

往往比：

```text
At-most-once
```

更加可靠。

因为：

### At-most-once

```text
只执行一次
```

如果执行过程中发生：

```text
failure
```

可能：

```text
操作丢失
```

### At-least-once + Idempotency

```text
可以 retry
```

同时：

```text
不会放大副作用
```

这正是 AWS、Azure Durable Functions 等 Workflow 基础设施普遍强调的模型。Azure Durable Task 明确说明 Activity 是 at-least-once execution，因此应尽可能使 Activity logic 幂等。

---

# 19. Workflow Runtime 本身可能 Replay

Agent Workflow 的另一个特殊问题是：

```text
Workflow State
```

经常需要：

```text
checkpoint
resume
replay
```

例如 Azure Durable Task 会通过事件历史重新执行 Orchestrator 代码来重建状态；Activity 如果在完成后、结果记录前发生故障，可能重新运行，因此微软明确建议 Activity 尽可能幂等。

AWS 当前 Agentic AI Lens 也明确把“checkpoint + idempotent step”作为长流程恢复的基础：如果没有幂等，resume 可能把已经完成的 side effect 再做一次。

因此：

```text
checkpoint
```

和：

```text
idempotency
```

必须一起设计。

---

# 20. Checkpoint 并不能自动保证安全 Resume

例如：

```text
Workflow
  Step 1 ✓
  Step 2 ✓
  Step 3 in progress
  Step 4 pending
```

系统重启后：

```text
resume from Step 3
```

看起来很合理。

但是 Step 3 可能已经：

```text
完成 external side effect
```

只是：

```text
checkpoint
```

还没有写入。

所以 resume：

```text
Step 3 again
```

还是可能重复。

因此：

```text
checkpoint
≠
execution proof
```

需要：

```text
checkpoint
+
idempotency record
```

一起判断。

---

# 21. Workflow Step 的 Idempotency Key 应如何设计

假设：

```text
Workflow:
WF-100

Steps:
1. ReserveCash
2. SubmitOrder
3. SendNotification
```

推荐：

```text
WF-100:ReserveCash
WF-100:SubmitOrder
WF-100:SendNotification
```

或者：

```text
hash(
    workflowId
    + stepType
    + logicalInputIdentity
)
```

不要：

```text
WF-100:SubmitOrder:attempt-1
WF-100:SubmitOrder:attempt-2
WF-100:SubmitOrder:attempt-3
```

因为这样每次 retry 都变成新的业务操作。

---

# 22. 但同一个 Step 可能合法执行两次

这正是 Workflow 幂等设计中另一个很重要的 nuance。

例如：

```text
Workflow:
GenerateClientNotice
```

今天执行一次。

明天用户明确发起：

```text
RegenerateClientNotice
```

这应该是：

```text
新的 Logical Operation
```

因此：

```text
workflowId
```

不能单独决定 Idempotency。

真正应该决定的是：

```text
logical operation
```

例如：

```text
WF-100
  Notice-1
```

与：

```text
WF-101
  Notice-2
```

即使内容完全一样，也是两个合法操作。

所以：

> **幂等不是“相同参数永远只执行一次”，而是“同一次逻辑操作可以安全重复执行”。**

---

# 23. Fan-out Workflow 必须特别小心

例如：

```text
Agent
 ↓
批量处理 100 个账户
```

Workflow：

```text
for account in accounts:
    FreezeAccount(account)
```

不能只有：

```text
idempotencyKey =
WF-100:FreezeAccount
```

否则 100 个不同账户全部冲突。

应该包含：

```text
workflowId
stepType
resourceIdentity
```

例如：

```text
WF-100:FreezeAccount:A001
WF-100:FreezeAccount:A002
WF-100:FreezeAccount:A003
```

这类结构特别适合：

```text
batch
fan-out
map
parallel execution
```

---

# 24. Parallel Execution 也需要 Idempotency + Concurrency Control

例如两个 worker 同时执行：

```text
RefundPayment(P123)
```

即使两者使用：

```text
same idempotency key
```

如果实现错误：

```text
A read → not found
B read → not found
A execute
B execute
```

仍可能重复。

所以真正需要：

```text
Atomic claim
```

而不是：

```text
Read then write
```

可以使用：

```text
unique constraint
conditional write
compare-and-swap
distributed lock
```

但一般来说：

> **优先使用数据库原子条件写，而不是自己实现分布式锁。**

锁本身通常只是控制并发，不自动解决：

```text
external side effect
```

---

# 25. Idempotency 与 Optimistic Concurrency 是两个不同问题

两者很容易混淆。

### Idempotency

回答：

> “同一个操作被重复提交怎么办？”

例如：

```text
Refund P123
```

retry 两次。

### Optimistic Concurrency

回答：

> “两个不同操作同时修改了同一个资源怎么办？”

例如：

```text
Workflow A:
Change limit → 100

Workflow B:
Change limit → 200
```

二者可能需要：

```text
version = 7
```

让其中一个失败。

所以一个成熟 Command：

```text
idempotencyKey
+
expectedVersion
```

两个字段都很重要。

---

# 26. 一个金融例子：Proxy Vote

假设 Agent 得到用户请求：

> “提交这次会议的 Proposal 4 = FOR。”

Workflow：

```text
1. Read meeting
2. Validate position
3. Check policy
4. Create vote command
5. Submit vote
6. Confirm vendor result
```

真正有副作用的是：

```text
SubmitProxyVote
```

可以定义：

```text
idempotencyKey =
PROXY-VOTE:
firm-1:
meeting-M100:
account-A100:
proposal-P4:
version-V7
```

那么：

```text
Agent retry
Workflow retry
Worker retry
Vendor timeout retry
```

都可以使用同一个 logical operation identity。

但是要特别注意：

```text
same proposal
same account
same vote
```

并不一定意味着：

```text
永远只能投一次
```

如果业务真的允许：

```text
修改投票
```

那么：

```text
new instruction
```

应该有新的 operation identity，或者使用：

```text
vote version / instruction version
```

显式表达：

```text
这是同一业务指令的更新
```

而不能简单依赖：

```text
payload hash
```

---

# 27. 一个金融例子：Payment

支付是最典型的 Idempotency 场景。

例如：

```text
CreatePayment
```

第一次：

```text
Payment Provider
→ success
```

但响应丢失。

Workflow 收到：

```text
timeout
```

于是 retry。

如果：

```text
idempotencyKey
=
WF-123:PAYMENT-456
```

并传递给 Provider：

```http
Idempotency-Key: WF-123:PAYMENT-456
```

Provider 就可以识别：

```text
same logical payment
```

Stripe 将这种模式作为 API Reliability 的核心设计之一；Adyen 明确支持使用 `idempotency-key` 对 payment 请求安全重试；PayPal 也建议 POST/PUT 请求使用 `PayPal-Request-Id`，并说明相同 request ID 的重试不会重复执行。

---

# 28. Adyen 的实践特别值得关注

Adyen 官方文档明确说明：

```text
timeout
→ retry same idempotency key
```

如果原请求已经成功处理：

```text
返回原操作结果
```

而不是：

```text
再次执行
```

Adyen 还说明：

* idempotency key 有有效期；
* 同一 key 的并发请求可能得到冲突/进行中的响应；
* 其幂等机制依赖服务端保存请求状态；
* retry 应结合 exponential backoff。

这恰好说明企业 Agent Workflow 的实现不能只做：

```text
idempotencyKey = UUID
```

还必须有：

```text
persistent idempotency state
concurrency handling
retention
retry semantics
```

---

# 29. PayPal 的实践说明 Idempotency 是 API Contract

PayPal 官方要求对于创建或修改数据的 POST/PUT 调用，可以使用：

```http
PayPal-Request-Id
```

来防止重复交易，并说明服务器会保存该 ID 一段时间，同一 ID 的 retry 会得到原请求结果。

这告诉我们：

> **Idempotency 不应该只是 Workflow 内部的实现细节，而应该成为跨服务 API Contract。**

如果一个企业 Agent Platform 要调用：

```text
Payment API
Broker API
CRM API
Vendor API
Corporate Action API
```

最好在平台级标准里明确：

```text
supportsIdempotency: true/false
```

以及：

```text
header
key format
key scope
retention
conflict behavior
result replay behavior
```

---

# 30. 外部系统不支持 Idempotency 怎么办

这是现实系统里最麻烦的情况。

例如：

```text
Agent Platform
    ↓
Legacy Vendor
```

Vendor API：

```text
POST /submit
```

没有：

```text
Idempotency-Key
```

那就不能假装：

```text
我们自己加了 key
```

就自动得到幂等。

因为：

```text
Vendor
```

根本不知道这个 key。

---

# 31. 第一种办法：使用 External Business Reference

如果 Vendor 支持：

```text
clientReference
instructionId
orderId
correlationId
externalReference
```

可以将：

```text
logicalOperationId
```

传进去。

例如：

```text
ClientInstructionId =
WF-100:SUBMIT-VOTE:P4
```

retry：

```text
same ClientInstructionId
```

Vendor 可以识别：

```text
已经提交
```

然后：

```text
return existing status
```

这种方式在 Legacy Integration 中非常有价值。

---

# 32. 第二种办法：先 Query 再 Retry

如果 Vendor 不支持 Idempotency Key，但支持：

```text
GET /status?reference=...
```

可以：

```text
timeout
   ↓
查询 status
   ↓
FOUND SUCCESS
   ↓
mark success
```

只有：

```text
明确没有执行
```

时才 retry。

但这里仍然存在 race condition：

```text
query = NOT FOUND
vendor processes immediately after query
retry
```

因此：

> **Query-before-retry 只能降低风险，不能自动建立 exactly-once guarantee。**

---

# 33. 第三种办法：把 Vendor 调用包在一个 Idempotent Adapter 里

例如：

```text
Agent
 ↓
Command
 ↓
Execution Service
 ↓
Vendor Adapter
 ↓
Legacy API
```

Adapter 自己维护：

```text
operationId
vendorReference
status
result
```

例如：

```text
operationId = REFUND-P123

status:
SUBMITTING

vendorReference:
V-88382
```

如果 retry：

```text
same operationId
```

Adapter 首先查：

```text
have vendorReference?
```

如果有：

```text
query vendor status
```

而不是：

```text
blind POST again
```

这会把：

```text
Legacy non-idempotent API
```

封装为：

```text
internally idempotent operation
```

虽然不能创造绝对保证，但可以显著改善可恢复性。

---

# 34. 第四种办法：让业务对象本身具有自然幂等性

有些操作根本不应该设计成：

```text
increment
```

而可以设计成：

```text
set
```

例如：

非幂等：

```text
POST /balance/add
amount=100
```

幂等性更强：

```text
PUT /balance
target=1000
```

或者：

```text
SetOrderStatus(
    orderId,
    status=APPROVED
)
```

重复调用：

```text
APPROVED
```

不会进一步改变状态。

Azure 官方关于 Idempotent Functions 的文档也给出了类似思路，例如优先使用已存在检查、upsert、状态设置等方式减少重复副作用。

---

# 35. Create 与 Set 的幂等性差异

例如：

```text
CreateCustomer
```

通常不是天然幂等的：

```text
call 1 → C123
call 2 → C124
```

如果改成：

```text
CreateCustomer(
    businessId=CLIENT-123
)
```

并要求：

```text
UNIQUE businessId
```

那么：

```text
retry
```

可以返回：

```text
same customer
```

这实际上是在业务层建立：

```text
natural idempotency key
```

因此设计新业务 API 时：

> **比起事后给所有 API 补 Idempotency，更好的方式是从业务数据模型层面设计稳定的 operation identity。**

---

# 36. “Create” 最好配合 Client-Generated Resource ID

例如：

```text
POST /payments
```

每次都会：

```text
server generates paymentId
```

可以导致：

```text
retry
→ new paymentId
```

更容易重复。

另一种模式：

```text
PUT /payments/PAY-123
```

客户端提前定义：

```text
paymentId = PAY-123
```

然后：

```text
PUT /payments/PAY-123
```

重复执行：

```text
仍然是 PAY-123
```

更容易做到幂等。

这也是一个非常值得在 Agent Platform 设计阶段考虑的 API contract。

---

# 37. Idempotency Key 应该与 Request Hash 绑定

仅靠：

```text
key = ABC
```

还不够。

例如第一次：

```text
key = ABC
amount = 100
```

第二次：

```text
key = ABC
amount = 1000
```

系统不能简单：

```text
return cached result
```

因为这可能意味着：

```text
same key
different business operation
```

所以应该保存：

```text
requestHash
```

第一次：

```text
ABC
hash(payload1)
```

再次请求：

```text
ABC
hash(payload2)
```

如果：

```text
hash(payload1)
!=
hash(payload2)
```

应该：

```text
IDEMPOTENCY_CONFLICT
```

而不是：

```text
execute
```

或者：

```text
silently return old result
```

Stripe、Adyen 等成熟支付 API 都在各自的 Idempotency 合同中对重复请求的行为进行约束；企业内部 API 同样应该显式定义这个 contract。

---

# 38. Canonicalization 很重要

如果：

```json
{
  "amount": 100,
  "currency": "USD"
}
```

和：

```json
{
  "currency": "USD",
  "amount": 100
}
```

语义相同：

```text
hash
```

就不应该因为 JSON 字段顺序不同而变化。

所以推荐：

```text
raw JSON
    ↓
canonicalize
    ↓
normalized representation
    ↓
hash
```

例如：

```typescript
function canonicalize(input: unknown): string {
  // deterministic JSON serialization
}
```

然后：

```typescript
const requestHash =
  sha256(
    canonicalize(request)
  );
```

这样：

```text
same logical input
→ same hash
```

---

# 39. 不要把时间戳直接塞进 Request Hash

例如：

```json
{
  "paymentId": "P123",
  "amount": 100,
  "timestamp": "..."
}
```

如果 timestamp 每次 retry 都变化：

```text
requestHash
```

也变化。

于是：

```text
same operation
```

又变成：

```text
different operation
```

应该把：

```text
technical attempt timestamp
```

与：

```text
logical business input
```

分开。

---

# 40. AttemptId 可以变化，IdempotencyKey 不应该变化

例如：

```text
operationId:
PAY-123

attemptId:
ATTEMPT-1
```

第一次执行：

```text
PAY-123
ATTEMPT-1
```

retry：

```text
PAY-123
ATTEMPT-2
```

但：

```text
idempotencyKey:
PAY-123
```

保持不变。

这样 audit 可以记录：

```text
PAY-123
   ├── ATTEMPT-1
   ├── ATTEMPT-2
   └── ATTEMPT-3
```

并明确：

```text
这是一个业务操作
产生了三个执行尝试
```

这比把三次 retry 看成三个 Command 清晰得多。

---

# 41. 一个完整的 Idempotency State Machine

推荐至少：

```text
                 ┌─────────────┐
                 │   ABSENT    │
                 └──────┬──────┘
                        │
                   claim key
                        │
                        ▼
                 ┌─────────────┐
                 │ PROCESSING  │
                 └──────┬──────┘
                        │
             ┌──────────┼──────────┐
             │          │          │
          success     retryable   fatal
             │          │          │
             ▼          ▼          ▼
        SUCCEEDED   RETRYABLE    FAILED
                        │
                        │ recovery
                        ▼
                   PROCESSING
```

同时还需要考虑：

```text
PROCESSING
   ↓ lease expired
   ↓
RECOVERY
```

以及：

```text
SUCCESS
   ↓
replay result
```

对于一个 retry request：

```text
SUCCEEDED
```

应该：

```text
return original response
```

而不是：

```text
execute again
```

---

# 42. FAILED 是否天然可以 Retry？

不能。

至少区分：

```text
FAILED_RETRYABLE
```

和：

```text
FAILED_FINAL
```

例如：

```text
Payment provider timeout
```

可能：

```text
retryable
```

而：

```text
INSUFFICIENT_FUNDS
```

通常：

```text
not retryable
```

同样：

```text
INVALID_ACCOUNT
```

不是：

```text
network problem
```

因此 retry policy 应由：

```text
error classification
```

决定。

AWS Agentic AI Lens 明确建议 Workflow 先分类失败，再决定 retry、fallback 或升级人工处理；同时应使用 exponential backoff、jitter 和 retry budget。

---

# 43. Retry Budget 与 Idempotency 是互补关系

即使操作幂等：

```text
retry forever
```

仍然是错误。

例如：

```text
Vendor down
```

Agent：

```text
retry
retry
retry
retry
...
```

虽然不会：

```text
duplicate payment
```

但可能：

```text
overload vendor
overload queue
consume compute
increase latency
cascade failures
```

所以：

```text
Idempotency
```

解决：

```text
重复副作用
```

而：

```text
Retry Budget
```

解决：

```text
无限恢复
```

二者应该一起设计。

---

# 44. Exponential Backoff + Jitter 仍然需要

AWS Prescriptive Guidance 明确建议在 retry 场景使用 exponential backoff，并指出 retry 本身可能造成网络带宽和服务降级问题；同时要求只有具有幂等语义的操作才适合安全 retry。

例如：

```text
Attempt 1
wait 100ms

Attempt 2
wait 500ms

Attempt 3
wait 2s

Attempt 4
wait 8s
```

再加：

```text
jitter
```

防止：

```text
大量 Worker
同时 retry
```

形成：

```text
thundering herd
```

---

# 45. Agent 不应该自己决定 Retry Policy

这是 Agent Workflow 特别需要强调的一点。

不要：

```text
LLM:
"Payment timed out.
I'll try 5 more times."
```

应该：

```text
Executor
 ↓
error classifier
 ↓
retry policy
```

Agent 只收到：

```text
RETRYING
```

或者：

```text
PENDING_RECONCILIATION
```

或者：

```text
FAILED_FINAL
```

否则 Agent 自己拥有：

```text
retry count
backoff
scope
```

就可能产生：

```text
runaway retry
```

AWS 对 Agent Workflow 的相关最佳实践明确把 automatic cutoffs、retry budgets 和 circuit breakers 作为防止 cascading failure 的控制手段。

---

# 46. Command Execution 和 Idempotency Store 最好靠近

如果：

```text
Command Executor
```

和：

```text
Idempotency Store
```

距离太远：

```text
microservice A
        ↓
network
        ↓
idempotency service
        ↓
network
        ↓
executor
```

可能增加：

```text
race
latency
partial failure
```

通常更简单的是：

```text
Execution Service
    │
    ├── Command State
    ├── Idempotency Record
    └── Business Transaction
```

如果业务数据库就是 PostgreSQL，可以：

```text
command
idempotency
business state
outbox
```

放在同一数据库事务里。

这会大幅简化：

```text
claim
business update
outbox
```

之间的一致性。

---

# 47. Command + Idempotency + Outbox 是一组很自然的组合

例如：

```text
DB Transaction
 ├── business_command
 ├── idempotency_record
 ├── business_state
 └── outbox_event
```

然后：

```text
commit
  ↓
Outbox Relay
  ↓
Queue
  ↓
Executor
```

这样可以避免：

```text
Command persisted
but message lost
```

同时：

```text
message delivered twice
```

也可以由：

```text
Idempotent Consumer
```

处理。

AWS Transactional Outbox guidance 明确推荐在同一数据库事务中写业务状态和 outbox，再异步发布消息，同时要求 consumer 能处理 duplicate event。

---

# 48. Idempotent Consumer 是 Agent Workflow 必须理解的模式

假设：

```text
Queue
 ↓
Message: ExecutePayment
```

Consumer：

```text
receive
 ↓
process
 ↓
commit
 ↓
ack
```

如果：

```text
process success
 ↓
consumer crashes
 ↓
ack not sent
```

Queue 会再次发送：

```text
same message
```

因此 Consumer 必须：

```text
idempotent
```

经典的 Idempotent Consumer Pattern 通常通过记录已经处理过的 message ID 来避免重复处理；既可以使用独立的 processed message table，也可以把处理过的 ID 记录在业务实体中。

Agent Workflow 中：

```text
messageId
```

和：

```text
idempotencyKey
```

可以有关联，但不应该简单等同。

---

# 49. Message ID 与 Idempotency Key 的区别

```text
messageId
```

表示：

> 这条消息。

而：

```text
idempotencyKey
```

表示：

> 这个逻辑操作。

可能出现：

```text
同一个 operation
```

被包装成：

```text
Message A
Message B
Message C
```

例如：

```text
Workflow retry
Worker retry
DLQ replay
```

所以：

```text
messageId
```

用于：

```text
message deduplication
```

而：

```text
idempotencyKey
```

用于：

```text
business operation deduplication
```

两个层级都值得保留。

---

# 50. DLQ Replay 是 Idempotency 的现实考验

例如：

```text
Queue
 ↓
processing failed
 ↓
DLQ
```

运维人员：

```text
replay DLQ
```

这实际上就是：

```text
repeat execution
```

如果业务没有 Idempotency：

```text
DLQ replay
→ duplicate payment
```

因此：

> **任何 DLQ Replay 设计，都应该把它视作一次“正常的业务 retry”。**

不能依赖：

```text
“运维人员应该知道不能重复执行”
```

这种人工约束。

---

# 51. Workflow Redrive 同样必须走 Idempotency

AWS Agentic AI Lens 当前建议使用持久化 Workflow state，并从最后完成阶段增量恢复；Step Functions 的 redrive 能从失败点恢复，而不是把全部步骤从头重跑。AWS 同时明确要求 Workflow Steps 本身保持 idempotent。

例如：

```text
Step 1 ✓
Step 2 ✓
Step 3 ✗
Step 4 not started
```

redrive：

```text
resume Step 3
```

如果 Step 3：

```text
已经实际上产生过 side effect
```

仍然需要：

```text
Step 3 idempotency
```

因此：

> **Checkpoint 降低重复工作的范围，Idempotency 防止重复副作用。**

两者作用不同。

---

# 52. Agent Memory 不应该成为 Idempotency Store

一个错误做法：

```text
Agent Memory:
“I already sent the payment.”
```

这不是可靠的幂等记录。

Agent Memory 可能：

```text
被截断
被清理
不可用
不同 Session 不共享
模型错误理解
Context window 不包含
```

而 Idempotency Record 必须是：

```text
authoritative
durable
transactional
queryable
```

所以：

```text
Agent Memory
```

可以帮助：

```text
reasoning
```

但不能作为：

```text
business execution truth
```

AWS Agentic AI Lens 也明确把长期 workflow state 与 Agent memory 区分开，并建议多步骤 Workflow 通过 durable state + checkpoint 管理，而不是依赖普通 memory。

---

# 53. LLM Conversation History 也不能保证 Idempotency

例如：

```text
User:
“帮我再试一次。”

Agent:
“I already did it.”
```

这不意味着系统真的知道：

```text
是否成功
```

因为：

```text
conversation
```

只是：

```text
natural language context
```

而不是：

```text
execution state
```

正确做法应该是：

```text
Agent
 ↓
lookup command / operation
 ↓
read authoritative state
 ↓
decide response
```

即：

```text
Business State
>
Agent Memory
```

---

# 54. Idempotency 与 Human Approval 的关系

对于：

```text
high-risk action
```

常见流程：

```text
Agent
 ↓
Command
 ↓
Approval
 ↓
Execution
```

如果 Approval 后发生：

```text
timeout
```

然后系统 retry：

```text
Execution
```

不应该重新：

```text
Approval
```

只要：

```text
same approved command
same command hash
same idempotency key
```

就可以安全恢复执行。

这就是为什么：

```text
Approval
Command
Idempotency
```

三者必须紧密关联。

例如：

```text
approvalId
commandId
commandHash
idempotencyKey
```

应该在 Audit 中关联起来。

---

# 55. Approved Command 应该有自己的 Idempotency Identity

例如：

```json
{
  "commandId": "CMD-100",
  "commandHash": "abc123",
  "idempotencyKey": "WF-100:PAYMENT:OP-1",
  "approvalId": "AP-10"
}
```

retry：

```text
commandId = CMD-100
commandHash = abc123
idempotencyKey = same
approvalId = AP-10
```

这样：

```text
same command
same approval
same business operation
```

只是：

```text
different execution attempt
```

---

# 56. 如果 Command 内容发生变化，必须生成新的 Operation

例如：

```text
Payment:
$100
```

已经批准。

后来 Agent 改：

```text
$120
```

不能：

```text
same idempotencyKey
```

继续 execute。

应该：

```text
new command
new command hash
new logical operation version
```

例如：

```text
PAY-1:v1
PAY-1:v2
```

并重新：

```text
policy
approval
```

否则可能出现：

```text
approved $100
executed $120
```

这是非常严重的控制漏洞。

---

# 57. 一个完整的 Command + Idempotency 数据模型

建议：

```sql
CREATE TABLE business_command (
    command_id            UUID PRIMARY KEY,

    workflow_id           VARCHAR(100) NOT NULL,
    operation_id          VARCHAR(100) NOT NULL,

    command_type          VARCHAR(100) NOT NULL,
    schema_version        INTEGER NOT NULL,

    payload               JSONB NOT NULL,
    payload_hash          VARCHAR(128) NOT NULL,

    actor_user_id         VARCHAR(100) NOT NULL,
    actor_agent_id        VARCHAR(100) NOT NULL,

    idempotency_key       VARCHAR(255) NOT NULL,

    status                VARCHAR(40) NOT NULL,

    created_at            TIMESTAMP NOT NULL,
    expires_at            TIMESTAMP
);

CREATE UNIQUE INDEX ux_command_idempotency
ON business_command(idempotency_key);
```

再：

```sql
CREATE TABLE command_execution (
    command_id            UUID NOT NULL,

    attempt_id            UUID PRIMARY KEY,

    status                 VARCHAR(40) NOT NULL,

    worker_id              VARCHAR(100),

    started_at             TIMESTAMP NOT NULL,
    completed_at           TIMESTAMP,

    error_code             VARCHAR(100),

    external_reference     VARCHAR(255),

    response               JSONB
);
```

这样可以明确：

```text
Command
    1
    ↓
Execution Attempts
    1..N
```

这与：

```text
Logical Operation
    ≠
Physical Attempts
```

完全一致。

---

# 58. 为什么要分 Command 与 Execution Attempt

因为：

```text
Command
```

回答：

> 业务上想做什么？

而：

```text
ExecutionAttempt
```

回答：

> 技术上第几次尝试做这个业务动作？

例如：

```text
Command:
RefundPayment(P123, $100)

Attempts:
ATTEMPT-1 timeout
ATTEMPT-2 provider 503
ATTEMPT-3 success
```

审计结果：

```text
ONE business action
THREE technical attempts
```

这是比：

```text
three refund commands
```

正确得多的语义。

---

# 59. 外部系统 Reference 是非常重要的字段

例如：

```text
commandId:
CMD-100

idempotencyKey:
REFUND:P123

externalReference:
ADYEN-99882
```

这样最终可以建立：

```text
Agent Run
   ↓
Command
   ↓
Execution Attempt
   ↓
External Reference
   ↓
External Outcome
```

当：

```text
timeout
```

发生以后，系统可以：

```text
query by externalReference
```

进行 reconciliation。

这对于：

```text
payments
trading
proxy voting
corporate actions
```

尤其有价值。

---

# 60. Financial Workflow 特别需要 Reconciliation

在普通内部业务里：

```text
DB state
```

可能已经足够。

但金融 Workflow 经常涉及：

```text
内部系统
    ↓
Vendor
    ↓
External Market / Payment Network
```

这意味着：

```text
internal state
```

和：

```text
external state
```

可能暂时不一致。

因此：

```text
Idempotency
```

最好和：

```text
Reconciliation
```

同时设计。

例如：

```text
Execution State:
UNKNOWN
```

不是：

```text
FAILED
```

而是：

```text
需要查询外部系统
```

---

# 61. UNKNOWN 应该成为正式状态

很多实现只有：

```text
SUCCESS
FAIL
```

这不适合分布式金融执行。

更合理：

```text
PENDING
PROCESSING
SUCCEEDED
FAILED_RETRYABLE
FAILED_FINAL
UNKNOWN
```

其中：

```text
UNKNOWN
```

表示：

> 系统无法证明操作没有发生。

例如：

```text
external timeout
```

这时最危险的行为就是：

```text
treat UNKNOWN as FAILED
```

然后：

```text
blind retry
```

正确方式：

```text
UNKNOWN
   ↓
reconcile
   ↓
FOUND SUCCESS
```

或者：

```text
NOT FOUND
   ↓
safe retry
```

---

# 62. UNKNOWN 是金融 Agent 特别需要警惕的状态

对于：

```text
SendEmail
```

可能还能接受重复。

但对于：

```text
Payment
Trade
Proxy Vote
Position Change
Account Freeze
```

不能简单：

```text
UNKNOWN → retry
```

而应该：

```text
UNKNOWN
   ↓
determine authoritative external state
```

这是传统金融系统与 Agent Workflow 的一个重要交汇点：

> **Agent 可以负责 reasoning，但不能负责解释未知的 external side effect。**

必须由：

```text
Execution Adapter
+
Reconciliation Service
```

处理。

---

# 63. Idempotency Key 的 Scope 必须明确

一个 key 到底在什么范围内唯一？

可能是：

```text
global
tenant
client
account
API credential
provider
workflow
```

例如 Adyen 官方文档说明其 idempotency key 在 company account 层面进行唯一性检查，并定义有效期。

企业内部也应该明确：

```text
scope = tenant + operation type
```

例如：

```text
tenant=A
key=X
```

和：

```text
tenant=B
key=X
```

是否冲突？

一般不应该。

因此数据库可能设计：

```sql
PRIMARY KEY (
    tenant_id,
    idempotency_key
)
```

---

# 64. Idempotency Key 的 TTL 不能随意设置

Idempotency Record 不一定永久保存。

需要考虑：

```text
retry window
workflow duration
business correction window
external provider retention
audit retention
```

例如：

```text
Agent retry window = 24h
```

那么：

```text
TTL = 5 min
```

显然不够。

但：

```text
TTL = 10 years
```

又可能导致：

```text
storage growth
privacy / retention complexity
```

AWS Agentic AI Lens 提到可使用 TTL 控制 Idempotency Store 的增长；Adyen、PayPal 等外部支付 API 也各自定义自己的 key retention period，因此内部系统不能假设所有 provider 的窗口都相同。

---

# 65. 内部 TTL 不能短于关键外部系统的幂等窗口

假设：

```text
Internal idempotency TTL = 1h
External provider retains key = 7d
```

内部 1 小时后忘了：

```text
PAY-123
```

于是：

```text
retry
```

再次生成：

```text
new internal operation
```

但外部系统可能仍然把它认为：

```text
same external operation
```

产生难以理解的状态。

反过来也有问题：

```text
internal retains 7d
external retains 10min
```

10 分钟之后：

```text
same external request
```

可能已经不能被 provider 去重。

所以：

> **Idempotency retention 是跨系统 Contract，而不是单个数据库表的随意 TTL。**

---

# 66. Payload Mismatch 必须明确处理

例如：

```text
key = PAYMENT-100
request #1
amount = 100
```

然后：

```text
request #2
key = PAYMENT-100
amount = 1000
```

应该：

```text
409 IDEMPOTENCY_CONFLICT
```

而不是：

```text
return success of first request
```

也不是：

```text
execute second request
```

这是 API Contract 的一部分。

建议：

```typescript
interface IdempotencyConflict {
  code: "IDEMPOTENCY_CONFLICT";

  key: string;

  originalRequestHash: string;

  incomingRequestHash: string;
}
```

---

# 67. Idempotency Record 应保存原始响应

如果第一次执行成功：

```text
Payment created
paymentId=P123
```

retry：

```text
same key
```

最好的行为是：

```text
return same response
```

因此建议保存：

```text
responseStatus
responseBody
resourceReference
```

而不是只有：

```text
processed=true
```

否则 retry 之后系统只能说：

```text
“已经执行过。”
```

却不能告诉调用方：

```text
“执行结果是什么。”
```

---

# 68. 但不要无限保存敏感 Response

金融系统尤其要注意：

```text
response body
```

可能包含：

```text
customer data
payment data
account information
PII
```

因此应该考虑：

```text
data classification
encryption
retention
masking
access control
```

更稳妥的是：

```text
resourceReference
status
resultCode
```

作为长期状态。

而：

```text
完整 response
```

按业务需要短期保存。

Idempotency Store 与 Audit Store 也不一定需要使用同样的 retention policy。

---

# 69. Idempotency Store 不是 Audit Store

两者很容易被合并。

### Idempotency Store

回答：

> 这个操作是不是已经执行过？

需要：

```text
fast lookup
atomic claim
response replay
TTL
```

### Audit Store

回答：

> 谁在什么时候做了什么？

需要：

```text
immutability
traceability
retention
completeness
```

因此：

```text
Idempotency
```

是：

```text
execution control
```

而：

```text
Audit
```

是：

```text
evidence
```

可以关联：

```text
commandId
operationId
attemptId
```

但不建议把二者强行变成同一个表。

---

# 70. Idempotency 与 Audit 应形成关联链

推荐：

```text
workflowId
  ↓
operationId
  ↓
commandId
  ↓
idempotencyKey
  ↓
attemptId
  ↓
externalReference
```

这样发生 incident 时可以：

```text
Agent Run
→ Workflow
→ Command
→ Idempotency Record
→ Attempts
→ External Transaction
```

整个链路可以重建。

这对于金融系统尤其重要，因为 AI 只是执行链中的一个参与者，不应该成为唯一的证据来源。

Bank of England 在其 2025 年关于 AI 与金融系统的报告中强调，金融机构使用 AI 时仍然需要适当的 risk management、controls 和 governance，并将 agentic AI 视为会自主采取行动的新型 AI 系统形态。

---

# 71. Agentic Payment 正在把这些问题变成现实基础设施

Visa 当前公开推动 Agentic Commerce，并特别强调 Agent 代表消费者完成交易时需要 trust、security、control 等机制。2025 年 Visa 宣布其合作伙伴已经完成数百笔 secure agent-initiated transactions；2026 年其公开材料进一步将 autonomous payments 与异步决策、复杂 Workflow 联系起来。

Mastercard 也在 Agent Pay 中使用 Agentic Tokens，并强调 Agentic Payments 所需的 trust、security 和 control。

这些方案并不是“实现了某一种 Agent Workflow Idempotency Pattern”的公开案例，因此不能把它们直接解释成某个具体内部实现。

但它们说明了一个现实趋势：

```text
Agent
 ↓
financial transaction
```

一旦真正进入生产支付基础设施，就必须面对：

```text
identity
authorization
transaction state
retry
duplicate prevention
external confirmation
```

这些传统分布式系统问题。

换句话说：

> **Agentic Commerce 并没有取消金融基础设施原有的 reliability discipline，而是在更高的自主性下放大了这些问题。**

---

# 72. Agentic Trading 更应该坚持确定性执行路径

在金融交易场景中，Agent 可以：

```text
分析市场
识别机会
生成 Trade Proposal
```

但：

```text
SubmitTrade
```

依然应该经过确定性的：

```text
risk checks
limits
entitlement
order validation
idempotency
execution
reconciliation
```

而不是：

```text
LLM
 ↓
Broker API
```

Bank of England 也指出 AI 在金融领域的使用会逐渐深入核心决策与市场活动，因此 AI 使用带来的 operational 与 system-level resilience 问题需要相应的风险管理和控制。

因此：

> **Agent Workflow 中的 Idempotency，不应被理解成“AI Tool 的小优化”，而应被理解成业务执行基础设施的一部分。**

---

# 73. 一个更完整的金融 Agent Workflow 架构

```text
┌──────────────────────────────────────┐
│            Agent Runtime             │
│                                      │
│ LLM / Planning / RAG / Memory       │
│                                      │
│ Responsibility:                     │
│ reasoning / proposal / coordination  │
└──────────────────┬───────────────────┘
                   │
                   ▼
┌──────────────────────────────────────┐
│          Workflow Control Plane      │
│                                      │
│ Workflow State                       │
│ Checkpoints                          │
│ Retry Policy                         │
│ Retry Budget                         │
│ Timeout / Circuit Breaker            │
└──────────────────┬───────────────────┘
                   │
                   ▼
┌──────────────────────────────────────┐
│             Command Layer            │
│                                      │
│ Command ID                           │
│ Operation ID                         │
│ Request Hash                         │
│ Idempotency Key                      │
│ Policy / Approval                    │
└──────────────────┬───────────────────┘
                   │
                   ▼
┌──────────────────────────────────────┐
│           Execution Service          │
│                                      │
│ Atomic Claim                         │
│ Idempotency Store                    │
│ Preconditions                        │
│ Business Transaction                 │
│ Outbox                               │
└──────────────────┬───────────────────┘
                   │
                   ▼
┌──────────────────────────────────────┐
│           External Adapter           │
│                                      │
│ Provider Idempotency                 │
│ External Reference                   │
│ Timeout Handling                     │
│ Reconciliation                       │
└──────────────────┬───────────────────┘
                   │
                   ▼
┌──────────────────────────────────────┐
│         Financial / Business         │
│             System                   │
└──────────────────────────────────────┘

          ┌──────────────────────┐
          │ Audit / Telemetry    │
          │                      │
          │ workflowId           │
          │ operationId          │
          │ commandId            │
          │ attemptId            │
          │ externalReference    │
          └──────────────────────┘
```

这个架构的关键是：

```text
Agent Runtime
    ≠
Workflow Control
    ≠
Command Execution
```

---

# 74. Agent Runtime 不应该负责最终 Retry

例如：

```text
DeepAgents
LangGraph
OpenAI Agents SDK
Copilot SDK
自研 Runtime
```

可以决定：

```text
下一步应该是什么
```

但：

```text
是否 retry side effect
retry 几次
如何 backoff
何时进入 reconciliation
```

最好由：

```text
Workflow / Execution Infrastructure
```

决定。

这样即使未来更换：

```text
Agent Runtime
```

业务可靠性机制也不会改变。

---

# 75. LLM 输出本身不是 Idempotency Boundary

例如：

```text
LLM 输出：

“请退款 $100”
```

即使输出完全相同：

```text
5 次
```

也不能自动理解为：

```text
同一个退款操作
```

因为：

```text
用户可能明确要求执行 5 次
```

或者：

```text
5 个不同客户
```

所以：

> **Idempotency 必须建立在显式业务 identity 上，而不能建立在 LLM 文本相似性上。**

错误：

```text
hash(LLM response)
```

正确：

```text
business operation identity
```

然后：

```text
canonical command
→ hash
```

---

# 76. 不要用 Embedding / Semantic Similarity 做 Idempotency

这在 Agent 系统中特别值得强调。

例如：

```text
“帮我退款100美元”
```

和：

```text
“把这100美元退给客户”
```

semantic similarity 很高。

但系统不能因此认为：

```text
same operation
```

相反：

```text
“两笔完全相同的订单付款”
```

可能 semantic similarity = 1.0，但实际上：

```text
是两次合法交易
```

所以：

```text
Idempotency
```

必须建立于：

```text
deterministic business identity
```

而不是：

```text
LLM / embedding similarity
```

---

# 77. 一个成熟 Agent Platform 应该标准化 Idempotency Context

建议所有 mutation Tool 都接受：

```typescript
interface ExecutionContext {
  workflowId: string;
  operationId: string;
  commandId: string;

  idempotencyKey: string;

  correlationId: string;
  causationId?: string;
}
```

例如：

```typescript
await paymentService.capture({
  orderId,
  amount,

  executionContext: {
    workflowId,
    operationId,
    commandId,
    idempotencyKey,
    correlationId
  }
});
```

这样：

```text
Agent
Workflow
Command
Executor
External Adapter
```

可以共享同一个业务执行 identity。

---

# 78. Idempotency Key 必须贯穿整个调用链

推荐：

```text
User Request
  │
  ▼
Agent Run
  │
  ▼
Workflow
  │
  ▼
Command
  │
  ▼
Tool
  │
  ▼
Service
  │
  ▼
External API
```

最终都能看到：

```text
idempotencyKey
```

但要注意：

> **传播并不意味着所有层都必须使用完全相同的 key。**

例如：

```text
Parent:
WF-100

Child:
WF-100:PAYMENT:P123

External:
PAYMENT:P123
```

可以使用：

```text
derived keys
```

关键是：

```text
stable mapping
```

这样 upstream：

```text
same logical operation
```

可以确定地映射到 downstream：

```text
same logical effect
```

AWS Agentic AI Lens 明确建议在多步骤 Workflow 中传播原始 key 或其确定性派生值。

---

# 79. Idempotency Key 应该避免包含 Attempt Number

错误：

```text
WF-100:PAYMENT:P123:ATTEMPT-1
WF-100:PAYMENT:P123:ATTEMPT-2
```

因为：

```text
retry
```

会产生：

```text
different keys
```

正确：

```text
WF-100:PAYMENT:P123
```

attempt number 单独记录：

```text
attemptId
attemptNo
```

这样：

```text
Logical operation
```

稳定。

---

# 80. Idempotency 不一定意味着“返回完全相同的响应”

这也是一个值得说明的细节。

如果：

```text
GET-like result
```

完全相同很容易。

但对于：

```text
Async command
```

第一次可能返回：

```text
202 Accepted
status=PENDING
```

稍后 retry：

```text
same idempotency key
```

可能已经变成：

```text
200 SUCCESS
```

因此：

> **Idempotency 的核心不是 HTTP response 字节级相同，而是业务操作不被重复产生副作用。**

对于异步业务，推荐：

```text
202
operationId
```

然后：

```text
GET /operations/{operationId}
```

查询最终状态。

AWS 对异步通信中的 Claim Check 模式也强调，用一个 durable identifier 获取稍后完成的结果，而不是要求调用方一直保持同步连接。

---

# 81. Async Workflow 很适合使用 Operation Resource

例如：

```http
POST /refunds
Idempotency-Key: REFUND-P123
```

第一次：

```http
202 Accepted
```

返回：

```json
{
  "operationId": "OP-123",
  "status": "PENDING"
}
```

然后：

```http
GET /operations/OP-123
```

返回：

```json
{
  "operationId": "OP-123",
  "status": "SUCCEEDED",
  "externalReference": "PAY-998"
}
```

retry POST：

```text
same idempotency key
```

不创建：

```text
OP-124
```

而应该返回：

```text
same logical operation
```

这种 API Contract 很适合 Agent Workflow，因为：

```text
Agent
```

可以：

```text
submit
→ suspend
→ later resume
→ query
```

而不是：

```text
Agent process
必须一直存活
```

---

# 82. Idempotency 与 Human-in-the-Loop Resume

一个长流程：

```text
Agent
 ↓
CreatePaymentCommand
 ↓
Approval
 ↓
WAIT 8 hours
 ↓
Approved
 ↓
Execute
```

如果 Agent Runtime 在：

```text
WAIT
```

期间完全停止：

```text
没有问题
```

因为真正保存的是：

```text
Workflow State
Command
Approval
Idempotency State
```

恢复后：

```text
same operationId
same command
same idempotencyKey
```

再继续。

所以：

> **Idempotency 是让 Agent Workflow 真正“可暂停、可恢复、可重放”的基础条件之一。**

---

# 83. Idempotency 与 Event Sourcing

如果采用 Event Sourcing：

```text
Command
 ↓
Event
 ↓
State
```

也不能自动解决 Idempotency。

例如：

```text
Command:
RefundPayment
```

如果被提交两次：

```text
RefundInitiated
RefundInitiated
```

event store 本身可能完全正常。

所以仍需要：

```text
commandId
deduplication
idempotency
```

作为 Command ingestion 的控制。

Event Sourcing 解决：

```text
what happened
```

Idempotency 解决：

```text
did we apply the same logical operation more than once?
```

二者解决不同问题。

---

# 84. Idempotency 与 Saga

Saga：

```text
Step A
 ↓
Step B
 ↓
Step C
```

如果：

```text
Step B
```

失败：

```text
retry
```

或：

```text
compensate
```

都可能再次执行。

因此：

```text
Saga
```

本身不能代替：

```text
Idempotency
```

反过来：

```text
Idempotency
```

也不能代替：

```text
Saga
```

关系应该是：

```text
Workflow / Saga
    ↓
Commands
    ↓
Idempotent Execution
```

AWS 的 Saga guidance 同样把跨服务一致性和补偿逻辑与 Outbox、事件顺序、恢复问题分开讨论。

---

# 85. 一个典型的 Agent Investment Workflow

例如：

```text
User:
“帮我执行这笔投资订单。”
```

Agent：

```text
1. Read portfolio
2. Read mandate
3. Analyze instrument
4. Propose trade
```

之后进入业务 Workflow：

```text
CreateTradeOrder
       ↓
RiskCheck
       ↓
Approval
       ↓
SubmitTrade
       ↓
Broker Confirmation
       ↓
Reconciliation
```

其中：

```text
RiskCheck
```

可能是：

```text
read-only / deterministic
```

但：

```text
SubmitTrade
```

必须具备：

```text
idempotency
```

如果：

```text
Broker timeout
```

不能让：

```text
Agent
```

自己决定是否重新提交。

应该：

```text
Execution Adapter
    ↓
UNKNOWN
    ↓
Broker reconciliation
    ↓
FOUND
```

或者：

```text
NOT FOUND
    ↓
same idempotency key
    ↓
retry
```

---

# 86. Agent Workflow 中，Idempotency 应该属于“Execution Plane”

可以这样划分：

```text
Agent Plane
    reasoning
    planning
    proposal

Control Plane
    authorization
    policy
    approval

Workflow Plane
    state
    checkpoint
    retry
    compensation

Execution Plane
    command
    idempotency
    transaction
    external side effect

Evidence Plane
    audit
    trace
    reconciliation
```

这里：

```text
Idempotency
```

不是：

```text
LLM feature
```

而是：

```text
Execution Infrastructure
```

这也是最适合作为企业 Agent Platform 公共能力建设的位置。

---

# 87. 企业 Agent Platform 应该提供统一 Idempotency SDK

如果有：

```text
100 agents
500 tools
```

不要让每个开发者自己写：

```text
if (alreadyProcessed) ...
```

应该提供：

```typescript
const result =
  await idempotentExecutor.run({
    operation: {
      type: "SubmitProxyVote",
      identity: {
        workflowId,
        operationId
      }
    },

    request,

    execute: async () => {
      return proxyVoteGateway.submit(
        request
      );
    }
  });
```

SDK 统一处理：

```text
key generation
claim
concurrency
state
retry
result replay
metrics
audit correlation
```

---

# 88. 但是 SDK 不应该隐藏业务语义

例如：

```typescript
idempotentExecutor.run({
  key: "abc",
  execute: ...
});
```

虽然方便，但容易让开发者随意生成：

```text
key = random UUID
```

更好的 API 是强制使用：

```typescript
identity: {
  operationType,
  workflowId,
  operationId
}
```

SDK 再帮助生成：

```text
idempotencyKey
```

例如：

```typescript
function buildIdempotencyKey(
  identity: OperationIdentity
) {
  return hash(
    canonicalize({
      workflowId: identity.workflowId,
      operationType: identity.operationType,
      operationId: identity.operationId
    })
  );
}
```

这样平台可以统一防止：

```text
timestamp key
random retry key
attempt-based key
```

等错误。

---

# 89. 一个更完整的 TypeScript 实现

```typescript
interface IdempotencyRecord<TResponse> {
  key: string;

  requestHash: string;

  status:
    | "PROCESSING"
    | "SUCCEEDED"
    | "FAILED_RETRYABLE"
    | "FAILED_FINAL"
    | "UNKNOWN";

  response?: TResponse;

  resourceReference?: string;

  leaseOwner?: string;
  leaseExpiresAt?: string;

  createdAt: string;
  updatedAt: string;
}
```

Executor：

```typescript
async function executeIdempotently<
  TRequest,
  TResponse
>(
  identity: OperationIdentity,
  request: TRequest,
  execute: () => Promise<TResponse>
): Promise<TResponse> {

  const key =
    buildIdempotencyKey(identity);

  const requestHash =
    hashCanonicalRequest(request);

  const record =
    await store.claimOrGet({
      key,
      requestHash
    });

  if (
    record.status === "SUCCEEDED"
  ) {
    return record.response!;
  }

  if (
    record.status === "PROCESSING" &&
    !leaseExpired(record)
  ) {
    throw new OperationInProgressError(
      key
    );
  }

  if (
    record.status === "UNKNOWN"
  ) {
    throw new ReconciliationRequiredError(
      key
    );
  }

  try {
    const result = await execute();

    await store.markSucceeded({
      key,
      response: result
    });

    return result;

  } catch (error) {

    if (isUnknownOutcome(error)) {
      await store.markUnknown({
        key,
        error
      });

      throw error;
    }

    if (isRetryable(error)) {
      await store.markRetryable({
        key,
        error
      });

      throw error;
    }

    await store.markFailedFinal({
      key,
      error
    });

    throw error;
  }
}
```

这里最重要的是：

```text
UNKNOWN
```

被显式建模。

---

# 90. 不要把 Timeout 自动归类成 Retryable

这是实现里的另一个关键细节。

例如：

```text
HTTP 504
```

并不一定表示：

```text
operation never happened
```

它只表示：

```text
client did not receive a response in time
```

所以：

```text
Timeout
```

应该根据具体 API contract 判断：

```text
known no-side-effect
```

还是：

```text
unknown outcome
```

例如：

```text
Input validation failed
```

通常没有 side effect。

而：

```text
connection lost after request transmission
```

可能是：

```text
UNKNOWN
```

---

# 91. Failure Classification 推荐至少四类

```text
1. NON_RETRYABLE
2. SAFE_RETRYABLE
3. UNKNOWN_OUTCOME
4. REQUIRES_RECONCILIATION
```

例如：

| Failure                                              | 分类                      |
| ---------------------------------------------------- | ----------------------- |
| Schema validation failed                             | NON_RETRYABLE           |
| Authorization denied                                 | NON_RETRYABLE           |
| Rate limit                                           | SAFE_RETRYABLE          |
| Connection refused before request                    | SAFE_RETRYABLE          |
| Timeout after request sent                           | UNKNOWN_OUTCOME         |
| Provider 503 with documented no-processing semantics | SAFE_RETRYABLE          |
| Broker timeout after order submission                | REQUIRES_RECONCILIATION |

具体分类必须由外部系统契约决定，不能一概而论。

---

# 92. Idempotency 设计要考虑“Side Effect 边界”

一个 Workflow：

```text
1. Read account
2. Calculate amount
3. Save command
4. Send email
5. Submit payment
6. Update database
```

并不是所有步骤都需要同样的 Idempotency 设计。

例如：

```text
Read account
```

没有业务副作用。

而：

```text
Submit payment
```

是：

```text
critical side effect
```

因此应该首先识别：

```text
side-effect boundary
```

然后在 boundary 上建立：

```text
idempotency
```

这也是为什么 AWS Agentic AI Lens 强调“side-effectful operation”在执行前需要检查既有结果，而不是把所有 Agent 工作都一律套用相同机制。

---

# 93. 不要把所有 Agent Step 都设计成 Idempotency Operation

例如：

```text
LLM summarize document
```

没有必要：

```text
idempotency record
```

如果：

```text
Generate report
```

输出只是：

```text
ephemeral artifact
```

通常也不需要完整的 business idempotency。

但如果：

```text
PublishReport
```

会：

```text
写入正式系统
发送客户
创建监管记录
```

就应该进入严格执行路径。

所以更实用的是：

```text
Read / Compute
    ↓
轻量 recovery

Mutation
    ↓
Idempotency

Critical Mutation
    ↓
Idempotency + Approval + Reconciliation
```

---

# 94. Idempotency 与 Deterministic Execution

AWS 最新 Agentic AI 系统设计建议明确指出：除非确有必要，否则应优先使用 deterministic execution logic，而不是让 AI 来决定确定性控制流程。

这一点和 Idempotency 有直接关系。

因为：

```text
LLM
```

很难保证：

```text
same prompt
→ same tool path
```

但：

```text
Idempotency
```

要求：

```text
same logical operation
→ same execution identity
```

所以应该：

```text
LLM:
what should happen?

Workflow:
which step is active?

Executor:
what exact operation is being retried?

Idempotency:
is this the same operation?
```

不要让 LLM 同时决定这些事情。

---

# 95. Idempotency 与 Prompt Injection

假设攻击者通过：

```text
Prompt Injection
```

诱导 Agent：

```text
“重新提交支付。”
```

如果系统：

```text
Agent
→ Payment API
```

攻击可能产生：

```text
duplicate side effect
```

但如果：

```text
Agent
→ same logical Command
→ same idempotencyKey
```

攻击者即使让 Agent 多次 retry：

```text
same key
```

也可以被 execution layer deduplicate。

当然：

> **Idempotency 不是 Prompt Injection 防御机制。**

如果攻击者可以生成：

```text
new valid operationId
```

它仍然可能产生新的业务操作。

因此 Idempotency 与：

```text
authorization
policy
approval
```

是互补关系。

OWASP 将 excessive agency 视为 Agent 系统的重要风险，特别强调需要限制功能、权限和自主性。

---

# 96. Idempotency 不是 Authorization

这两个问题必须严格分开：

```text
Authorization:
“这个操作允许吗？”

Idempotency:
“这个允许的操作是否已经执行过？”
```

例如：

```text
User A
无权限
```

即使：

```text
idempotencyKey = X
```

也不能执行。

正确顺序：

```text
Authentication
 ↓
Authorization
 ↓
Policy
 ↓
Approval
 ↓
Idempotency Check
 ↓
Execution
```

有些系统也可以先 claim key 后做 authorization，但必须小心防止攻击者污染 Idempotency Store；因此实际实现应该明确：

```text
key namespace
authorization context
resource ownership
```

而不能只靠一个全局字符串。

---

# 97. Idempotency Key 不应该由用户完全控制

例如用户请求：

```text
Idempotency-Key: ADMIN
```

如果系统没有 namespace 和权限隔离：

```text
不同用户
```

可能碰撞。

因此推荐：

```text
tenant
+
actor
+
operation scope
+
logical operation id
```

共同确定最终 key。

例如：

```text
hash(
  tenantId
  + userId
  + operationType
  + operationId
)
```

如果外部 provider 已经定义自己的 key scope，则需要按照 provider contract 处理，而不是直接把内部 key 原样暴露出去。

---

# 98. Idempotency Key 是否需要包含 UserId？

不一定。

更重要的是：

```text
逻辑操作 identity
```

如果：

```text
operationId
```

已经全局唯一：

```text
OP-123
```

就不一定需要：

```text
userId
```

但如果 key 只在：

```text
tenant scope
```

或：

```text
account scope
```

唯一，就需要明确加入相应 namespace。

因此不要机械套用：

```text
userId + timestamp + UUID
```

而应先定义：

```text
uniqueness scope
```

---

# 99. 一个很实用的 Key Design 方法

先问四个问题：

```text
1. What is the logical operation?

2. At what scope must it be unique?

3. Which retries belong to the same operation?

4. Which legitimate operations must remain distinct?
```

例如：

```text
Payment
```

答案：

```text
logical operation:
capture order O123

scope:
merchant + order

same operation:
network retry

different operation:
second explicit capture after user creates new capture intent
```

于是 key 可以：

```text
merchant:M1
order:O123
capture:C1
```

而不是：

```text
hash(amount)
```

---

# 100. Idempotency 与 Versioning

对于可修改业务对象，可以设计：

```text
operationId
version
```

例如：

```text
Order O123
Instruction V1
Instruction V2
```

这样：

```text
V1 retry
```

仍然：

```text
same idempotency
```

而：

```text
V2
```

是：

```text
new logical operation version
```

如果系统支持：

```text
Optimistic Concurrency
```

还可以：

```text
expectedVersion
```

防止：

```text
stale operation
```

这使：

```text
Idempotency
+
Concurrency
+
Versioning
```

形成完整的 mutation safety model。

---

# 101. Command Hash、Request Hash 与 Idempotency Key 三者不要混淆

推荐：

```text
Command Hash
```

表示：

> 这个业务 Command 的具体内容。

```text
Request Hash
```

表示：

> 这次 API 请求的 canonical payload。

```text
Idempotency Key
```

表示：

> 这次逻辑业务操作的 identity。

例如：

```text
commandId:
CMD-001

commandHash:
H1

idempotencyKey:
PAYMENT-123
```

retry：

```text
same command
same H1
same PAYMENT-123
```

如果 payload 改变：

```text
H2
```

但还继续使用：

```text
PAYMENT-123
```

应：

```text
CONFLICT
```

---

# 102. 一个成熟的 Idempotency Contract

企业内部 API 可以统一：

```text
Idempotency-Key
```

请求：

```http
POST /payments
Idempotency-Key: WF-100:PAYMENT:OP-1
```

服务端行为：

### 第一次请求

```text
201 / 202
```

保存：

```text
key
hash
status
result
```

### 相同 Key + 相同 Payload

```text
return original result
```

### 相同 Key + 不同 Payload

```text
409 IDEMPOTENCY_CONFLICT
```

### Key 正在执行

```text
409 / 202
OPERATION_IN_PROGRESS
```

具体返回码应由企业 API 标准统一，不应该每个服务自己定义一套。

---

# 103. 一个适合 Agent Workflow 的标准 Response

例如：

```json
{
  "operationId": "OP-123",
  "idempotencyKey": "WF-100:PAYMENT:OP-123",
  "status": "PENDING"
}
```

稍后：

```json
{
  "operationId": "OP-123",
  "status": "SUCCEEDED",
  "resource": {
    "paymentId": "P-999"
  }
}
```

Agent 只需要：

```text
observe state
```

而不是：

```text
guess whether request succeeded
```

---

# 104. 不要让 Agent 根据 HTTP Status 猜业务状态

例如：

```text
HTTP 500
```

并不等于：

```text
operation failed
```

也不等于：

```text
operation succeeded
```

它只意味着：

```text
server returned an error response
```

如果请求已经到达 external side effect boundary：

```text
UNKNOWN
```

可能是正确状态。

因此 Execution Service 应该把：

```text
transport failure
```

转换成：

```text
business execution state
```

例如：

```text
PROVIDER_TIMEOUT
→ RECONCILIATION_REQUIRED
```

而不是直接把：

```text
HTTP 504
```

交给 LLM。

---

# 105. Agent Workflow 应该有一个统一的 Operation State API

可以：

```http
GET /operations/{operationId}
```

返回：

```json
{
  "operationId": "OP-123",
  "status": "RECONCILIATION_REQUIRED",
  "createdAt": "...",
  "updatedAt": "...",
  "externalReference": "EXT-888"
}
```

这样：

```text
Agent
Workflow
UI
Operations
Support
```

都可以读取同一个 authoritative state。

这比：

```text
Agent memory
```

或者：

```text
LLM transcript
```

可靠得多。

---

# 106. 对高风险金融操作，建议“Execute → Confirm → Reconcile”三段式

对于：

```text
Trade
Payment
Proxy Vote
Corporate Action
```

可以明确：

```text
1. Execute
2. Confirm
3. Reconcile
```

### Execute

向外部系统发送操作。

### Confirm

得到：

```text
accepted
rejected
pending
```

### Reconcile

确认：

```text
external state
=
internal state
```

如果：

```text
UNKNOWN
```

进入：

```text
reconciliation
```

而不是：

```text
blind retry
```

---

# 107. 为什么 Reconciliation 是 Idempotency 的“最后一道保险”

因为：

```text
Idempotency Store
```

只能告诉你：

```text
我们的系统认为发生了什么
```

而：

```text
External reconciliation
```

回答：

```text
外部世界实际发生了什么
```

金融系统尤其需要后一种。

例如：

```text
Internal:
PROCESSING

External:
SETTLED
```

系统必须能够修正：

```text
internal
→
SUCCEEDED
```

因此：

> **高可靠的 Agent Workflow 不是“Idempotency only”，而是 Idempotency + Durable State + Reconciliation。**

---

# 108. 监控 Idempotency 本身

很多团队只监控：

```text
success rate
latency
error rate
```

但 Agent Workflow 还应该监控：

```text
idempotency hit rate
duplicate request rate
conflict rate
unknown outcome rate
reconciliation rate
processing lease expiry
stale operation rate
```

例如：

```text
Idempotency Hit Rate
```

突然从：

```text
1%
```

升到：

```text
20%
```

可能意味着：

```text
upstream retry storm
workflow duplication
provider instability
agent loop
```

AWS Agentic AI Lens 当前也建议监控 idempotency cache hits，以判断 retry 是否正在正确地落到已有结果，而不是产生新的副作用。

---

# 109. 尤其应该监控 UNKNOWN Outcome

例如：

```text
UNKNOWN > threshold
```

说明：

```text
External system reliability
或
network reliability
```

出现问题。

这比单纯的：

```text
HTTP 5xx
```

更能反映业务风险。

例如：

```text
Payment UNKNOWN = 100/hour
```

可能比：

```text
Payment 500 = 100/hour
```

更加严重，因为 UNKNOWN 需要：

```text
reconciliation
```

而不是简单 retry。

---

# 110. Chaos Testing 必须专门测试 Idempotency

不能只测试：

```text
API returns 500
```

还应该模拟：

```text
1. external side effect succeeds
2. response lost

3. worker crashes after side effect
4. worker crashes before state update

5. queue message duplicated

6. workflow replayed

7. DLQ replay

8. two workers execute same key concurrently

9. idempotency store temporarily unavailable

10. provider idempotency store unavailable

11. approval resumes after long delay
```

然后验证：

```text
No duplicate business effect
```

这才是真正的 Idempotency Test。

---

# 111. 特别推荐一个“Crash Window Test”

例如：

```text
1. Claim idempotency
2. Call external API
3. External API succeeds
4. Kill worker
5. Restart worker
6. Retry same operation
```

这是最有价值的测试之一。

因为它模拟：

```text
UNKNOWN OUTCOME
```

也是生产事故里最容易发生问题的窗口。

如果系统能够安全处理：

```text
side effect success
+
local crash
```

它的 Idempotency 设计通常才比较成熟。

---

# 112. 另一个关键测试：Concurrent Duplicate

同时启动：

```text
Worker A
Worker B
```

执行：

```text
same idempotencyKey
```

要求：

```text
A wins execution
B gets existing operation
```

而不是：

```text
A executes
B executes
```

测试结果应该验证：

```text
external side effect count = 1
```

而不是：

```text
HTTP response count = 1
```

这是很关键的区别。

---

# 113. 第三个关键测试：Same Key, Different Payload

第一次：

```json
{
  "amount": 100
}
```

第二次：

```json
{
  "amount": 200
}
```

相同：

```text
idempotencyKey
```

要求：

```text
IDEMPOTENCY_CONFLICT
```

不能：

```text
execute 200
```

也不能：

```text
silently return result of 100
```

---

# 114. 第四个关键测试：合法重复业务操作

测试：

```text
Operation A:
PAYMENT $100

Operation B:
PAYMENT $100
```

两者：

```text
payload identical
```

但：

```text
operationId different
```

要求：

```text
two legitimate operations
```

这可以验证：

```text
key = business identity
```

而不是：

```text
key = payload hash only
```

---

# 115. 第五个关键测试：Long-running Workflow

例如：

```text
Start
 ↓
Approval
 ↓
wait 24h
 ↓
resume
 ↓
execute
```

模拟：

```text
Agent Runtime restart
Worker restart
Queue redelivery
Workflow replay
```

最终仍然：

```text
one business effect
```

这直接验证：

```text
durable state
+
idempotency
+
resume
```

是否真的协同工作。

---

# 116. Idempotency 不应该阻止合法业务修正

有一个常见误区：

```text
只要 same key
永远不允许重新执行
```

这会导致：

```text
business correction
```

变得困难。

更合理：

```text
Operation V1
```

已经：

```text
SUCCEEDED
```

如果业务需要：

```text
correction
```

就创建：

```text
Operation V2
```

例如：

```text
CorrectionCommand
```

而不是：

```text
reuse V1 key
```

所以：

> **Idempotency 是保证一次逻辑操作的执行语义，不是禁止业务世界发生第二次合法操作。**

---

# 117. Idempotency 与 Compensation

例如：

```text
TransferMoney
```

已经：

```text
SUCCEEDED
```

后来发现：

```text
wrong amount
```

不能：

```text
retry same idempotency key
```

因为：

```text
same operation
```

已经完成。

需要：

```text
Compensating Operation
```

例如：

```text
ReverseTransfer
```

这应该拥有：

```text
new operationId
new idempotencyKey
new audit record
```

所以：

```text
Idempotency
```

不会取代：

```text
Compensation
```

---

# 118. 一个统一的 Recovery Decision Tree

推荐：

```text
Failure
  │
  ▼
Is operation outcome known?
  │
 ┌┴───────────┐
 │            │
YES          NO
 │            │
 ▼            ▼
Is retry     Reconcile
safe?          │
 │             ├── SUCCESS → complete
 ├──YES        │
 │             ├── NOT FOUND → retry
 ▼             │
Retry same     └── UNKNOWN → manual / delayed reconcile
key
 │
 └──NO
     │
     ▼
  Fail / Escalate
```

这比简单：

```text
error → retry
```

成熟得多。

---

# 119. 一个 Agent Workflow 的最终执行算法

可以把整个执行过程浓缩为：

```text
1. Identify logical operation
2. Create stable operation identity
3. Canonicalize input
4. Calculate request hash
5. Claim idempotency key atomically
6. If existing success → replay result
7. If conflicting payload → reject
8. If active execution → wait / recover
9. Validate authorization and policy
10. Check business preconditions
11. Execute external side effect
12. Persist result
13. Emit business event
14. On uncertain outcome → reconcile
15. Retry only according to retry policy
16. Propagate derived idempotency identity downstream
```

这其实已经是一个非常稳定的 Enterprise Execution Pattern。

---

# 120. 最推荐的架构原则

最终可以浓缩成下面这些原则。

### 原则 1：Idempotency Key 标识 Logical Operation

不是：

```text
HTTP request
```

不是：

```text
LLM call
```

不是：

```text
Worker attempt
```

而是：

```text
Logical Business Operation
```

---

### 原则 2：Retry 不得生成新的 Logical Operation

```text
retry
=
same operation
```

而：

```text
new business intent
=
new operation
```

---

### 原则 3：Key 必须稳定，但不能把合法不同操作错误合并

不要：

```text
UUID per retry
```

也不要：

```text
hash(payload) globally
```

优先：

```text
workflow identity
+
operation identity
+
canonical input
```

---

### 原则 4：必须保存 Request Hash

```text
same key
+
same payload
→ replay

same key
+
different payload
→ conflict
```

---

### 原则 5：Atomic Claim 是必须的

不要：

```text
SELECT
+
INSERT
```

分两步执行而没有并发保护。

使用：

```text
unique constraint
conditional write
CAS
```

等原子机制。

---

### 原则 6：PROCESSING 是正式状态

不能只设计：

```text
success / absent
```

必须考虑：

```text
PROCESSING
UNKNOWN
```

---

### 原则 7：Unknown Outcome 不应该自动等于 Failed

尤其：

```text
payment
trade
proxy vote
```

应该：

```text
reconcile first
```

---

### 原则 8：Checkpoint 与 Idempotency 必须一起设计

```text
Checkpoint
=
where to resume

Idempotency
=
how to resume safely
```

---

### 原则 9：Idempotency 必须向下游传播

```text
Workflow
 ↓
Command
 ↓
Service
 ↓
Adapter
 ↓
External API
```

每一层都需要：

```text
stable operation identity
```

---

### 原则 10：外部系统支持 Idempotency 时优先使用

不要：

```text
internal dedupe only
```

然后 blind retry external API。

应该：

```text
Internal key
 ↓
Provider idempotency key
```

---

### 原则 11：外部系统不支持 Idempotency 时必须有 Recovery Strategy

至少考虑：

```text
business reference
status query
reconciliation
idempotent adapter
unique resource identity
```

---

### 原则 12：Retry Budget 与 Idempotency 是一体两面

```text
Idempotency
→ 防止重复副作用

Retry Budget
→ 防止无限恢复
```

---

### 原则 13：Agent Memory 不是 Idempotency Store

```text
Memory
=
context

Idempotency Store
=
execution truth
```

---

### 原则 14：Audit 不等于 Idempotency Store

```text
Idempotency
=
control

Audit
=
evidence
```

---

### 原则 15：金融高风险操作必须有 Reconciliation

尤其：

```text
Payment
Trade
Corporate Action
Proxy Vote
```

---

# 121. 一个最终推荐的企业 Agent Platform 模型

```text
                           ┌───────────────┐
                           │   User        │
                           └───────┬───────┘
                                   │
                                   ▼
                           ┌───────────────┐
                           │ Agent / LLM   │
                           │               │
                           │ reasoning     │
                           │ planning      │
                           │ proposal      │
                           └───────┬───────┘
                                   │
                                   ▼
                     ┌────────────────────────┐
                     │ Workflow Control Plane │
                     │                        │
                     │ workflowId              │
                     │ checkpoints             │
                     │ retry policy            │
                     │ retry budget             │
                     │ failure classification   │
                     └───────────┬────────────┘
                                 │
                                 ▼
                     ┌────────────────────────┐
                     │ Command / Control      │
                     │                        │
                     │ commandId               │
                     │ operationId             │
                     │ commandHash             │
                     │ policy                  │
                     │ approval                │
                     └───────────┬────────────┘
                                 │
                                 ▼
                     ┌────────────────────────┐
                     │ Execution Infrastructure│
                     │                        │
                     │ atomic claim            │
                     │ idempotency store       │
                     │ preconditions            │
                     │ DB transaction          │
                     │ outbox                  │
                     └───────────┬────────────┘
                                 │
                                 ▼
                     ┌────────────────────────┐
                     │ External Adapter       │
                     │                        │
                     │ provider idempotency   │
                     │ timeout handling       │
                     │ external reference     │
                     │ reconciliation         │
                     └───────────┬────────────┘
                                 │
                                 ▼
                     ┌────────────────────────┐
                     │ Financial System       │
                     │ Payment / Broker /     │
                     │ Voting / CRM / Vendor  │
                     └────────────────────────┘

              ┌─────────────────────────────────┐
              │ Audit / Observability           │
              │                                 │
              │ workflowId                      │
              │ operationId                     │
              │ commandId                       │
              │ attemptId                       │
              │ idempotencyKey                   │
              │ externalReference               │
              └─────────────────────────────────┘
```

---

# 122. 最终结论

Agent Workflow 中的 Idempotency，表面上是在解决：

```text
“retry 会不会执行两次？”
```

实际上解决的是一个更深层的问题：

```text
一个业务操作
如何在一个充满 retry、replay、queue、worker、timeout、
checkpoint、approval 和 external API 的分布式系统中，
保持唯一、可恢复、可追踪的执行语义？
```

最重要的不是：

```text
给 API 增加一个 Idempotency-Key Header
```

而是建立下面这套完整模型：

```text
Logical Operation
        │
        ▼
Stable Operation Identity
        │
        ▼
Canonical Command
        │
        ▼
Idempotency Key
        │
        ▼
Atomic Claim
        │
        ▼
Execution
        │
        ├──────────────┐
        │              │
     SUCCESS        UNKNOWN
        │              │
        ▼              ▼
Persist Result     Reconcile
        │              │
        └───────┬──────┘
                ▼
        Final Business State
```

对于 Agent 来说，还要再加一层：

```text
Agent
   ↓
Workflow
   ↓
Command
   ↓
Idempotency
   ↓
Execution
```

这样：

```text
LLM retry
Workflow retry
Queue redelivery
Worker restart
Checkpoint replay
Human approval resume
DLQ replay
Provider retry
```

都可以被视为：

```text
同一个 Logical Operation 的不同技术执行尝试
```

而不是：

```text
新的业务动作
```

这才是 Agent Workflow 中 Idempotency 真正应该解决的问题。

---

## 123. 对金融 Agent 的特殊结论

金融系统尤其不应该把 Idempotency 简化成：

```text
duplicate request protection
```

更完整的执行安全模型应该是：

```text
                    Agent
                      │
                      ▼
                  Proposal
                      │
                      ▼
                   Command
                      │
                      ▼
          Authorization / Policy
                      │
                      ▼
                  Approval
                      │
                      ▼
             Stable Operation ID
                      │
                      ▼
              Idempotency Claim
                      │
                      ▼
             Preconditions Check
                      │
                      ▼
                  Execute
                      │
              ┌───────┴────────┐
              │                │
           SUCCESS          UNKNOWN
              │                │
              │          Reconciliation
              │                │
              └───────┬────────┘
                      ▼
                Business State
                      │
                      ▼
                  Audit Event
```

其中：

```text
Approval
```

解决：

```text
Who allows this action?
```

```text
Command
```

解决：

```text
What exact business action is being requested?
```

```text
Idempotency
```

解决：

```text
What if this same action is attempted again?
```

```text
Reconciliation
```

解决：

```text
What if we cannot tell whether the external action happened?
```

```text
Audit
```

解决：

```text
What actually happened?
```

这五个问题必须分别回答。

---

# 124. 最值得在企业 Agent Platform 中标准化的东西

如果要把这篇文章进一步落到企业 Agent Platform，真正值得平台统一提供的不是：

```text
LLM wrapper
```

而是：

```text
Operation Identity
Command Registry
Idempotency SDK
Command Store
Retry Policy
Failure Classification
Reconciliation Framework
External Adapter Contract
Audit Correlation
```

尤其建议规定一条平台级不变量：

> **任何产生业务副作用的 Agent Workflow Step，必须拥有稳定的 Logical Operation Identity，并且任何 retry、replay、redelivery、resume 都不得创建新的 Logical Operation Identity。**

再进一步：

> **任何金融高风险操作，在无法确定上一次 external attempt 是否成功时，不得仅依据 timeout/5xx 直接重试；必须进入既定的 reconciliation 或 provider-level idempotency path。**

这两条规则，比单纯规定：

```text
“所有 API 都必须支持 Idempotency-Key”
```

更接近真正的架构原则。

---

# 125. 一句话总结

最终可以把 Agent Workflow 的 Idempotency 设计浓缩成：

```text
One Business Operation
        ↓
One Stable Identity
        ↓
Many Technical Attempts
        ↓
One Business Effect
```

而金融 Agent 真正需要达到的目标不是：

```text
Exactly Once HTTP Request
```

而是：

> **同一个业务操作可以被安全地重试、恢复、重放和重新调度，但不会因为这些基础设施行为而重复产生业务副作用。**

这才是 Agent Workflow 中 Idempotency 的真正含义。

---

# 参考资料

## 一、Agentic AI 与 Idempotent Task Execution

**AWS Well-Architected Framework — Agentic AI Lens: Implement idempotent task execution patterns**

AWS 当前将 Idempotent Task Execution 单独列为高风险最佳实践，明确要求稳定的 Idempotency Key、执行前结果检查、多步骤 Workflow 中的 key propagation，以及与外部系统 Idempotency 能力的衔接。

[AWS — Implement idempotent task execution patterns](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentrel06-bp04.html?utm_source=chatgpt.com)

---

**AWS Well-Architected Framework — Agent memory and state management**

讨论长流程 Workflow 的 durable state、checkpoint、idempotent steps，以及为什么 Workflow state 不应简单等同于 Agent Memory。

[AWS — Agent memory and state management](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentrel03.html?utm_source=chatgpt.com)

---

**AWS Well-Architected Framework — Agent monitoring, management and recovery**

讨论 failure classification、exponential backoff、jitter、retry budget、incremental recovery 和 distributed tracing。

[AWS — Agent monitoring, management and recovery](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentrel07.html?utm_source=chatgpt.com)

---

**AWS Well-Architected Framework — Workflow orchestration security controls**

讨论 Workflow input validation、circuit breaker 和避免过度宽松 retry configuration。

[AWS — Implement workflow orchestration security controls](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentsec06-bp02.html?utm_source=chatgpt.com)

---

## 二、可靠分布式系统与 Idempotency

**AWS Prescriptive Guidance — Transactional Outbox Pattern**

说明数据库状态与消息发布之间的 dual-write 问题，并明确提醒消息可能重复、consumer 必须 idempotent。

[AWS — Transactional Outbox Pattern](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html?utm_source=chatgpt.com)

---

**AWS Prescriptive Guidance — Retry with Backoff**

说明 retry 与 idempotency 的关系，并讨论 exponential backoff、transient errors 和 failure amplification。

[AWS — Retry with backoff](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/retry-backoff.html?utm_source=chatgpt.com)

---

**microservices.io — Idempotent Consumer Pattern**

经典的 Idempotent Consumer Pattern，说明 at-least-once messaging 为什么要求 consumer 能识别并安全处理重复消息。

[microservices.io — Idempotent Consumer](https://microservices.io/patterns/communication-style/idempotent-consumer.html?utm_source=chatgpt.com)

---

**Confluent — Kafka Delivery Semantics**

区分 at-most-once、at-least-once、idempotent producer 和 Kafka transaction-based exactly-once semantics，并说明这些语义的边界。

[Confluent — Kafka Delivery Semantics](https://docs.confluent.io/kafka/design/delivery-semantics.html?utm_source=chatgpt.com)

---

**Microsoft — Durable Task Programming Model**

明确说明 Durable Activity 是 at-least-once execution，因此 Activity 应尽可能设计为 idempotent；同时说明 orchestrator replay 和 durable state。

[Microsoft — Durable Task Programming Model](https://learn.microsoft.com/en-us/azure/azure-functions/durable/durable-functions-types-features-overview?utm_source=chatgpt.com)

---

## 三、支付领域的真实 Idempotency 实践

**Stripe — Designing robust and predictable APIs with idempotency**

Stripe 介绍为什么分布式 API 必须考虑失败后的安全 retry，以及如何通过 Idempotency 让客户端与服务端状态最终收敛。

[Stripe — Designing robust and predictable APIs with idempotency](https://stripe.com/blog/idempotency?utm_source=chatgpt.com)

---

**Adyen — API idempotency**

Adyen 官方文档明确说明 payment API 支持 Idempotency，timeout 后可以使用同一个 key retry；同时定义 key scope、有效期、并发冲突和 transient error 行为。

[Adyen — API idempotency](https://docs.adyen.com/development-resources/api-idempotency/?utm_source=chatgpt.com)

---

**PayPal — Making API Requests / PayPal-Request-Id**

PayPal 建议 POST/PUT 使用 `PayPal-Request-Id` 防止重复交易，并说明相同 Request ID 的 retry 可以获得原请求结果。

[PayPal — Making API Requests](https://developer.paypal.com/api/make-api-requests?utm_source=chatgpt.com)

---

**Amazon SQS — Exactly-once processing in FIFO queues**

说明 FIFO queue 的 deduplication window、content-based deduplication 和显式 message deduplication ID。

[AWS — Exactly-once processing in Amazon SQS](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/FIFO-queues-exactly-once-processing.html?utm_source=chatgpt.com)

---

## 四、金融服务与 Agentic AI

**Bank of England — Financial Stability in Focus: Artificial intelligence in the financial system**

2025 年金融稳定报告讨论 AI 在金融机构的实际使用、agentic AI 的自主行动特征、AI service-provider operational risk，以及金融机构需要的 governance、risk management 和 controls。

[Bank of England — AI in the financial system](https://www.bankofengland.co.uk/financial-stability-in-focus/2025/april-2025?utm_source=chatgpt.com)

---

**Bank for International Settlements — AI agents for cash management in payment systems**

BIS 2025 年工作论文研究 AI Agent 在 RTGS payment systems 中进行现金与流动性管理的可能性，说明 Agent 正逐渐进入真实金融基础设施场景。

[BIS — AI agents for cash management in payment systems](https://www.bis.org/publications/working-paper-1310-ai-agents-cash-management-payment-systems.htm?utm_source=chatgpt.com)

---

**Visa — Trusted Agent Protocol**

Visa 2025 年发布 Trusted Agent Protocol，用于 Agent-driven commerce 中的 Agent recognition、trust 和 secure interactions。

[Visa — Trusted Agent Protocol](https://corporate.visa.com/en/sites/visa-perspectives/newsroom/visa-unveils-trusted-agent-protocol-for-ai-commerce.html?utm_source=chatgpt.com)

---

**Visa — Visa and Partners Complete Secure AI Transactions**

Visa 于 2025 年 12 月宣布合作伙伴已经完成数百笔 secure agent-initiated transactions；这一数量属于 Visa 官方披露。

[Visa — Secure AI Transactions](https://corporate.visa.com/en/sites/visa-perspectives/newsroom/visa-partners-complete-secure-agentic-transactions.html?utm_source=chatgpt.com)

---

**Visa — Agentic Commerce: Designing for autonomous payments**

Visa 讨论 autonomous payments、异步决策、复杂 Workflow，以及 Agent 代表用户协调端到端商业操作的趋势。

[Visa — Designing for autonomous payments](https://corporate.visa.com/content/VISA/visacorporate/global/en/home/services/visa-consulting-analytics/insights/vca-agentic-commerce-autonomous-payments.html?utm_source=chatgpt.com)

---

**Mastercard — Agent Pay**

Mastercard 的 Agent Pay 采用 Agentic Tokens，并强调 agentic payments 中的 trust、security 和 control。

[Mastercard — Agent Pay](https://newsroom.mastercard.com/news/press/2025/april/mastercard-unveils-agent-pay-pioneering-agentic-payments-technology-to-power-commerce-in-the-age-of-ai/?utm_source=chatgpt.com)

---

## 五、架构落地时最值得遵守的最终原则

可以最终压缩成一张表：

| 问题                 | 应由什么解决                                |
| ------------------ | ------------------------------------- |
| Agent 下一步做什么       | LLM / Agent                           |
| Workflow 当前在哪一步    | Durable Workflow State                |
| 这是什么业务操作           | Operation ID / Command                |
| 是否允许执行             | Authorization / Policy                |
| 是否需要人工确认           | Approval                              |
| 重试是不是同一个操作         | Idempotency Key                       |
| 是否已经执行过            | Idempotency Store                     |
| 两个 Worker 同时执行怎么办  | Atomic Claim / Conditional Write      |
| 上次 timeout 后到底发生没有 | Reconciliation                        |
| 能不能继续 retry        | Failure Classification / Retry Policy |
| retry 多久           | Retry Budget                          |
| 消息重复怎么办            | Idempotent Consumer                   |
| DB + Event 如何一致    | Transactional Outbox                  |
| 多系统失败怎么办           | Workflow / Saga / Compensation        |
| 最终实际发生了什么          | Audit / External Reference            |

最终应形成一个非常明确的工程不变量：

```text
One Logical Operation
        ↓
One Stable Operation Identity
        ↓
Many Technical Attempts
        ↓
At Most One Intended Business Effect
        ↓
Authoritative Final State
```

这比简单写一句：

```text
“API 支持 Idempotency”
```

要完整得多。

在 Agent Workflow 中，Idempotency 最终不是一个 HTTP Header，也不是一个 Redis Key，而是：

> **围绕“同一个业务操作在各种 retry、replay、resume、redelivery 和 partial failure 下仍保持单一业务语义”建立的一整套执行架构。**

对于金融 Agent，这应该被视为业务执行基础设施的基本能力，而不是 Agent Framework 的附加功能。

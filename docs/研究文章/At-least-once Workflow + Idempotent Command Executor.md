# At-least-once Workflow + Idempotent Command Executor：Agent 业务执行的可靠性架构

## 摘要

Agent 开始进入真实业务系统以后，一个核心问题会逐渐浮现：

> **Workflow 到底应该追求 exactly-once，还是接受 at-least-once，然后在业务执行边界解决重复副作用？**

对于金融服务、支付、交易、Proxy Voting、客户服务等存在真实业务副作用的系统，一个更现实、也更容易工程化的架构是：

```text
Agent / Workflow
        ↓
At-least-once delivery / recovery
        ↓
Idempotent Command Executor
        ↓
Business / External Side Effect
```

其核心思想不是让整个分布式 Workflow 获得一个很难真正保证的“全局 exactly-once”，而是：

> **允许 Workflow、消息系统和 Worker 在故障恢复过程中重复投递、重复调度甚至重复调用；但是要求真正产生业务副作用的 Command Executor 能识别同一个 Logical Operation，并保证它不会因为这些重复执行而产生重复业务效果。**

这实际上把问题拆成两个不同层次：

```text
Workflow Layer
解决：
任务有没有丢？
失败后能不能恢复？
消息能不能重新投递？
Workflow 能不能 replay / redrive？

Command Execution Layer
解决：
同一个业务动作被调用多次怎么办？
上一次 timeout 到底有没有成功？
两个 Worker 同时执行怎么办？
外部 API 已经成功但本地状态没写怎么办？
```

这种设计并非 Agent 独有，而是来自成熟的分布式系统实践。Amazon SQS Standard 明确采用 at-least-once delivery，因此同一消息可能被多次投递，并要求消费者具有幂等性；Microservices.io 也将 Idempotent Consumer 作为处理 at-least-once messaging 的经典模式。([docs.aws.amazon.com](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/standard-queues.html?utm_source=chatgpt.com))

Azure Durable Task 对 Activity 也采用 at-least-once execution，并明确建议 Activity logic 尽可能幂等；AWS 当前 Durable Execution SDK 同样把 at-least-once 作为默认 Step semantics，并明确指出 side-effecting operations 需要相应的 idempotency 或其他控制。([learn.microsoft.com](https://learn.microsoft.com/en-sg/azure/azure-functions/durable/durable-functions-types-features-overview?utm_source=chatgpt.com)；[docs.aws.amazon.com](https://docs.aws.amazon.com/durable-execution/patterns/best-practices/idempotency/?utm_source=chatgpt.com))

对 Agent 来说，这种模式尤其适合，因为 Agent Workflow 本身包含：

```text
LLM reasoning
Tool Call
Workflow state
Queue
Worker
Retry
Checkpoint
Resume
Human Approval
External API
```

这些组件天然会增加重复执行的可能。

因此，一个值得标准化的企业 Agent 架构原则是：

> **Workflow 可以允许重复；Command 不允许重复产生业务副作用。**

---

# 1. 先把问题定义准确：我们到底想保证什么

很多架构讨论一开始就提出：

> “我们能不能做到 exactly-once？”

这个问题本身就容易把讨论带偏。

需要区分至少三个概念：

```text
Delivery Semantics
        ↓
Execution Semantics
        ↓
Business Effect Semantics
```

例如：

### Delivery

```text
Message:
M123
```

可能：

```text
deliver once
```

也可能：

```text
deliver multiple times
```

### Execution

```text
Worker:
ExecuteCommand(M123)
```

可能：

```text
execute once
```

也可能：

```text
execute multiple attempts
```

### Business Effect

最终我们真正关心：

```text
Payment:
$100
```

到底是：

```text
一次扣 $100
```

还是：

```text
两次扣 $100
```

因此：

> **真正要保护的不是“代码函数执行一次”，而是“同一个业务操作只产生一次有效业务效果”。**

这也是为什么：

```text
At-least-once Workflow
+
Idempotent Command Executor
```

比：

```text
Entire Workflow Exactly Once
```

更有工程意义。

---

# 2. At-least-once 为什么反而是一个合理选择

At-least-once 的基本含义是：

> 系统宁可重复交付，也尽量避免任务丢失。

例如一个 Queue：

```text
Producer
   ↓
Message M123
   ↓
Queue
   ↓
Worker
```

Worker 收到：

```text
M123
```

处理完成以后：

```text
process success
```

但在：

```text
process success
       ↓
ack
```

之间 Worker 崩溃。

Queue 不知道：

```text
M123
```

是不是已经成功处理，于是再次投递：

```text
M123
```

这就是 at-least-once 的典型场景。

Amazon SQS Standard 明确说明其消息采用 at-least-once delivery，同一消息可能被多次交付，因此应用应该设计成能够安全处理重复消息。([docs.aws.amazon.com](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/standard-queues.html?utm_source=chatgpt.com))

从可靠性角度看，这通常比：

```text
“我宁愿丢掉任务，也不要重复。”
```

更可接受。

因为：

```text
Duplicate
```

可以通过：

```text
Idempotency
```

解决。

但：

```text
Lost Business Operation
```

往往更加难以自动恢复。

所以成熟的分布式系统经常采用：

```text
At-least-once delivery
+
Idempotent processing
```

而不是试图让整个消息系统保证全局 exactly-once。

---

# 3. Agent Workflow 为什么天然倾向于 at-least-once

Agent Workflow 和普通同步 HTTP Request 最大的不同是：

```text
它通常是长流程。
```

一个金融 Agent 可能：

```text
1. Retrieve documents
2. Analyze data
3. Create proposal
4. Run policy check
5. Request approval
6. Wait 6 hours
7. Resume
8. Submit transaction
9. Wait external confirmation
10. Reconcile
```

任何一个阶段都可能：

```text
timeout
process restart
worker crash
queue redelivery
workflow replay
checkpoint restore
manual redrive
```

因此：

```text
Workflow Execution
```

不应该依赖：

```text
一次连续的 process lifetime
```

而应该依赖：

```text
durable state
+
replay
+
recovery
```

AWS Step Functions Standard 支持 failed execution redrive，并从失败状态继续，保留此前成功状态的执行结果，不重新运行这些成功步骤；Azure Durable Task 则明确依靠 orchestration replay 恢复状态。([docs.aws.amazon.com](https://docs.aws.amazon.com/step-functions/latest/dg/redrive-executions.html?utm_source=chatgpt.com)；[learn.microsoft.com](https://learn.microsoft.com/en-sg/azure/azure-functions/durable/durable-functions-types-features-overview?utm_source=chatgpt.com))

这正是 durable workflow 的价值。

但 replay 带来一个直接问题：

```text
Workflow resume
      ↓
Step executes again
```

于是：

> **Workflow Recovery 必须假设某些执行可能重复。**

---

# 4. AWS Durable Execution SDK 已经把这个问题表达得非常清楚

AWS 当前 Durable Execution SDK 直接区分：

```text
AtLeastOncePerRetry
AtMostOncePerRetry
```

默认是：

```text
AtLeastOncePerRetry
```

如果执行在 checkpoint 完成前中断，Step 在 replay 时可能再次执行。

AWS 文档明确指出：

> At-least-once 是默认语义，而代码必须能够安全地重复运行；对于支持 idempotency key 的外部 API，应在 Step 中生成稳定的 key，并把它传递给每次 retry。([docs.aws.amazon.com](https://docs.aws.amazon.com/durable-execution/patterns/best-practices/idempotency/?utm_source=chatgpt.com))

同时 AWS 还特别说明：

```text
At-most-once
```

也并不等价于：

```text
Exactly-once across workflow
```

它只是控制某次 attempt 的 re-execution 行为；只要 Workflow 本身继续 retry，Step 仍然可能在不同 retry attempts 中执行多次。([docs.aws.amazon.com](https://docs.aws.amazon.com/durable-execution/patterns/best-practices/idempotency/?utm_source=chatgpt.com))

这恰恰支持本文的核心观点：

> **不要把“减少重复执行”误认为“完全消除了重复业务效果”。**

---

# 5. 真正应该放 exactly-once-like 保证的位置

推荐架构：

```text
                    Agent
                      │
                      ▼
                 Workflow
                      │
                 at-least-once
                      │
                      ▼
               Command Message
                      │
             may be delivered
             more than once
                      │
                      ▼
          ┌───────────────────────┐
          │ Idempotent Command    │
          │ Executor              │
          │                       │
          │ claim operation       │
          │ validate command      │
          │ check result          │
          │ execute side effect  │
          │ persist result        │
          └───────────┬───────────┘
                      │
                      ▼
                Business Effect
```

也就是说：

```text
Workflow
```

不负责证明：

```text
“我绝对只发一次。”
```

而：

```text
Command Executor
```

负责证明：

```text
“同一个业务操作即使被送来很多次，
也只产生一个业务效果。”
```

这是一种非常重要的职责分离。

---

# 6. 为什么 Command Executor 是最佳幂等边界

因为 Command Executor 恰好位于：

```text
Intent
   ↓
Business Action
   ↓
Side Effect
```

之间。

例如：

```text
SubmitProxyVoteCommand
```

进入：

```text
SubmitProxyVoteExecutor
```

Executor 可以看到完整业务语义：

```text
accountId
meetingId
proposalId
vote
```

同时它又是：

```text
真正调用 Vendor / DB / Broker API
```

的地方。

因此：

```text
LLM
```

不需要理解 Idempotency。

```text
Workflow
```

也不需要理解所有底层 API 的 retry semantics。

只需要：

```text
Workflow
→ dispatch command
```

而：

```text
Command Executor
```

统一负责：

```text
dedupe
claim
precondition
execution
result replay
reconciliation
```

这是一个非常适合企业 Agent Platform 标准化的边界。

---

# 7. 不要把 Idempotency 放在 Agent Runtime

错误设计：

```text
Agent Runtime
 ├── retry
 ├── dedupe
 ├── external API
 └── business state
```

这样 Agent Runtime 会逐渐变成：

```text
Workflow Engine
+
Transaction Manager
+
Business Executor
+
Retry System
```

最终非常难治理。

更合理：

```text
Agent Runtime
     │
     └── proposal / command
              │
              ▼
       Workflow Control
              │
              ▼
       Command Executor
              │
              ▼
      Business Systems
```

未来即使：

```text
DeepAgents
→ LangGraph
→ Copilot SDK
→ 自研 Agent Runtime
```

发生变化：

```text
Command Executor
```

仍然可以保持。

这对于企业平台尤其重要。

---

# 8. 核心对象：Logical Operation

整个架构最重要的不是：

```text
requestId
```

也不是：

```text
messageId
```

更不是：

```text
agentRunId
```

而是：

```text
Logical Operation ID
```

例如：

```text
OP-123
```

代表：

```text
“执行这笔退款”
```

无论它经过：

```text
Attempt 1
Attempt 2
Attempt 3
Queue Redelivery
Worker Restart
Workflow Redrive
```

都还是：

```text
OP-123
```

所以：

```text
Logical Operation
       │
       ├── Message 1
       ├── Message 2
       ├── Attempt 1
       ├── Attempt 2
       └── Attempt 3
```

这才是正确的抽象。

---

# 9. 四个 ID 最好明确区分

推荐至少有：

```text
workflowId
operationId
commandId
attemptId
```

它们分别代表：

### workflowId

一次业务 Workflow：

```text
WF-100
```

### operationId

Workflow 中一个逻辑业务动作：

```text
PAYMENT-123
```

### commandId

该业务动作对应的具体 Command：

```text
CMD-987
```

### attemptId

某一次实际执行：

```text
ATTEMPT-3
```

结构：

```text
WF-100
   │
   └── PAYMENT-123
          │
          └── CMD-987
                  │
                  ├── ATTEMPT-1
                  ├── ATTEMPT-2
                  └── ATTEMPT-3
```

这样：

```text
retry
```

不会生成新的：

```text
operationId
```

而只是新的：

```text
attemptId
```

---

# 10. Agent Run ID 不应该承担业务幂等身份

例如：

```text
RUN-2026-001
```

可能同时完成：

```text
search
calculate
propose
approve
submit
notify
```

所以：

```text
agentRunId
```

适合作为：

```text
trace / causation
```

不适合作为：

```text
idempotency identity
```

正确关系应该是：

```text
agentRunId
      │
      └── Workflow
              │
              ├── Operation A
              ├── Operation B
              └── Operation C
```

而不是：

```text
Agent Run
      =
One Idempotency Key
```

---

# 11. Command 应该是不可变的业务快照

Command 建议：

```typescript
interface Command<T> {
  readonly commandId: string;

  readonly workflowId: string;
  readonly operationId: string;

  readonly type: string;
  readonly schemaVersion: number;

  readonly payload: T;

  readonly actor: {
    readonly userId: string;
    readonly agentId: string;
  };

  readonly idempotencyKey: string;

  readonly commandHash: string;

  readonly createdAt: string;
  readonly expiresAt?: string;
}
```

其中：

```text
payload
commandHash
operationId
idempotencyKey
```

都应该在 Command 创建后保持稳定。

如果：

```text
amount = 100
```

已经批准。

后来变成：

```text
amount = 1000
```

应该创建一个新的 Command / operation，而不是：

```text
UPDATE CMD-123
```

---

# 12. Idempotency Key 与 Command Hash 不是同一个东西

这两个概念必须分开。

### Command Hash

回答：

> “这个 Command 的具体内容是什么？”

例如：

```text
H = SHA256(canonical(command))
```

### Idempotency Key

回答：

> “这是哪一次 Logical Operation？”

例如：

```text
PAYMENT-123
```

于是：

```text
Command:
CMD-001
operationId=PAYMENT-123
hash=H1
idempotencyKey=PAYMENT-123
```

retry：

```text
same operationId
same hash
same idempotency key
new attemptId
```

如果：

```text
same idempotency key
different hash
```

则应该：

```text
IDEMPOTENCY_CONFLICT
```

而不是执行第二个操作。

Stripe 官方 API 采用类似 contract：同一 Idempotency Key 后续请求会复用第一次请求的结果，并检查后续请求参数是否与原始请求一致；如果参数不同，则报错。Stripe 同时保存请求结果至少 24 小时后才允许自动清理。([docs.stripe.com](https://docs.stripe.com/api/idempotent_requests?utm_source=chatgpt.com))

---

# 13. 为什么不能简单使用 Payload Hash 当 Idempotency Key

看起来很自然：

```text
idempotencyKey = SHA256(payload)
```

但这可能把两个合法业务操作错误合并。

例如：

```text
今天：
Transfer(A, B, $100)

明天：
Transfer(A, B, $100)
```

Payload 完全一样。

但这是：

```text
两个不同业务操作
```

所以：

```text
payloadHash
```

适合表达：

```text
“输入内容相同”
```

而：

```text
operationId
```

表达：

```text
“这是同一次逻辑业务操作”
```

正确组合通常是：

```text
operationId
+
canonical payload hash
```

而不是：

```text
payload hash alone
```

AWS Agentic AI Lens 建议根据 Workflow ID、task type、request body 等稳定信息构造 deterministic idempotency key；但在企业业务系统中，还需要明确区分“相同输入”和“同一个业务操作”，否则会把合法重复交易错误去重。([docs.aws.amazon.com](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentrel06-bp04.html?utm_source=chatgpt.com))

---

# 14. Workflow 的 at-least-once 不意味着 Command 无限重复

这里要强调一个重要区别：

```text
At-least-once Workflow
```

表示：

```text
系统允许为了可靠性再次尝试
```

并不表示：

```text
Command Executor 可以无限执行
```

Executor 应该通过：

```text
Idempotency Record
```

把：

```text
N technical attempts
```

收敛为：

```text
1 logical business effect
```

也就是说：

```text
At-least-once
```

是一种：

```text
Delivery / Recovery semantic
```

而：

```text
Idempotent Command Executor
```

是一种：

```text
Business Effect semantic
```

这两个层次不要混淆。

---

# 15. Command Executor 的核心状态机

推荐：

```text
                    ABSENT
                       │
                 atomic claim
                       │
                       ▼
                  PROCESSING
                       │
        ┌──────────────┼──────────────┐
        │              │              │
      success       retryable       unknown
        │              │              │
        ▼              ▼              ▼
    SUCCEEDED     RETRYABLE       RECONCILE
                       │              │
                       │              ├── SUCCESS
                       │              ├── NOT_FOUND
                       │              └── UNKNOWN
                       │
                       ▼
                   PROCESSING

                     FAILED_FINAL
```

建议至少定义：

```text
PROCESSING
SUCCEEDED
FAILED_RETRYABLE
FAILED_FINAL
UNKNOWN
```

而不是：

```text
SUCCESS / FAIL
```

因为：

```text
UNKNOWN
```

在金融业务中非常重要。

---

# 16. 为什么 UNKNOWN 是必须的

例如：

```text
Command Executor
   ↓
Payment Provider
```

发生：

```text
request sent
provider processes
response lost
```

Executor 得到：

```text
timeout
```

此时不能安全断言：

```text
FAILED
```

真正状态可能：

```text
SUCCESS
```

因此：

```text
UNKNOWN
```

应该是业务执行状态，而不是简单的异常。

然后进入：

```text
Reconciliation
```

例如：

```text
Query payment by reference
```

如果找到：

```text
SUCCESS
```

如果确认没有：

```text
NOT_FOUND
→ safe retry
```

如果仍然无法判断：

```text
UNKNOWN
→ escalate / delayed retry
```

这是金融执行系统中极其重要的一条原则：

> **Timeout 是 transport state，不是 business outcome。**

---

# 17. Atomic Claim 是整个 Executor 的第一道防线

错误：

```text
if (!exists(key)) {
    insert(key);
    execute();
}
```

因为并发时：

```text
Worker A
   ↓
exists = false

Worker B
   ↓
exists = false
```

两边都执行。

正确：

```text
INSERT
WHERE key does not already exist
```

通过：

```text
unique constraint
conditional write
CAS
```

完成原子抢占。

AWS Agentic AI Lens 建议使用 deterministic key + conditional write；其示例使用 DynamoDB conditional writes，使两个并行 retry 不会同时创建相同 idempotency record。([docs.aws.amazon.com](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentrel06-bp04.html?utm_source=chatgpt.com))

---

# 18. PostgreSQL 实现

如果企业平台已经使用 PostgreSQL，一个非常直接的实现：

```sql
CREATE TABLE command_execution (
    idempotency_key  VARCHAR(255) PRIMARY KEY,

    command_type     VARCHAR(100) NOT NULL,

    request_hash     VARCHAR(128) NOT NULL,

    status           VARCHAR(40) NOT NULL,

    result           JSONB,

    resource_ref     VARCHAR(255),

    created_at       TIMESTAMP NOT NULL,
    updated_at       TIMESTAMP NOT NULL,

    lease_owner      VARCHAR(255),
    lease_expires_at TIMESTAMP
);
```

抢占：

```sql
INSERT INTO command_execution (
    idempotency_key,
    command_type,
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

如果 insert 成功：

```text
current worker owns operation
```

如果 insert 被 conflict：

```text
operation already exists
```

然后读取：

```text
SUCCEEDED?
PROCESSING?
FAILED_RETRYABLE?
UNKNOWN?
```

---

# 19. PostgreSQL 中最好把业务更新和幂等记录放进同一事务

例如：

```text
BEGIN

INSERT command_execution
  key = OP-123
  status = PROCESSING

UPDATE business_state
  ...

INSERT outbox_event
  ...

COMMIT
```

这样：

```text
Command state
+
Business state
+
Outbox
```

可以一起提交。

AWS Transactional Outbox Pattern 解决的正是“数据库更新 + 消息发布”的 dual-write 问题，并明确指出 downstream consumer 仍需要幂等，因为消息可能重复。([docs.aws.amazon.com](https://docs.aws.amazon.com/en_en/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html?utm_source=chatgpt.com))

不过这里有一个重要边界：

> **同库事务可以很好地解决内部数据库状态的一致性，却无法把外部银行、券商、支付网关自动纳入同一个 ACID transaction。**

外部副作用仍然需要：

```text
provider idempotency
external reference
reconciliation
```

---

# 20. Command Executor 的一个基础实现

```typescript
interface ExecuteContext {
  workflowId: string;
  operationId: string;
  commandId: string;
  idempotencyKey: string;
}

interface ExecutionRecord {
  key: string;
  requestHash: string;

  status:
    | "PROCESSING"
    | "SUCCEEDED"
    | "FAILED_RETRYABLE"
    | "FAILED_FINAL"
    | "UNKNOWN";

  result?: unknown;

  externalReference?: string;
}

async function executeCommand<TRequest, TResult>(
  context: ExecuteContext,
  request: TRequest,
  execute: () => Promise<TResult>,
): Promise<TResult> {

  const requestHash =
    hashCanonical(request);

  const existing =
    await executionStore.claimOrGet({
      key: context.idempotencyKey,
      requestHash,
      commandId: context.commandId,
    });

  if (existing.status === "SUCCEEDED") {
    return existing.result as TResult;
  }

  if (existing.status === "FAILED_FINAL") {
    throw new BusinessExecutionError(
      "ALREADY_FAILED_FINAL",
    );
  }

  if (
    existing.status === "PROCESSING"
    && !isLeaseExpired(existing)
  ) {
    throw new OperationInProgressError();
  }

  if (existing.status === "UNKNOWN") {
    throw new ReconciliationRequiredError();
  }

  try {
    const result = await execute();

    await executionStore.markSucceeded(
      context.idempotencyKey,
      result,
    );

    return result;

  } catch (error) {

    if (isUnknownOutcome(error)) {
      await executionStore.markUnknown(
        context.idempotencyKey,
        error,
      );
    } else if (isRetryable(error)) {
      await executionStore.markRetryable(
        context.idempotencyKey,
        error,
      );
    } else {
      await executionStore.markFailedFinal(
        context.idempotencyKey,
        error,
      );
    }

    throw error;
  }
}
```

这里最核心的不是代码，而是这五个步骤：

```text
claim
 ↓
existing result?
 ↓
execute
 ↓
persist result
 ↓
reconcile if uncertain
```

---

# 21. Executor 为什么需要保存 Result

不能只保存：

```text
processed = true
```

因为 retry 时：

```text
Workflow
```

通常需要得到：

```text
operation result
```

例如第一次：

```text
Payment created
paymentId = P123
```

retry：

```text
same operation
```

Executor 应该：

```text
return P123
```

而不是：

```text
“已经处理过。”
```

Stripe 正是保存第一次请求的 status code 和 body，并在后续使用相同 Idempotency Key 时返回原结果。([docs.stripe.com](https://docs.stripe.com/api/idempotent_requests?utm_source=chatgpt.com))

---

# 22. Result Replay 对 Agent Workflow 特别重要

假设：

```text
Step 4:
SubmitPayment
```

第一次：

```text
success:
paymentId=P123
```

但 Workflow 在：

```text
Step 4 success
      ↓
checkpoint
```

之前崩溃。

恢复：

```text
Step 4 executes again
```

Executor：

```text
idempotency key
   ↓
SUCCEEDED
   ↓
return P123
```

Workflow 就可以继续：

```text
Step 5:
NotifyCustomer
```

而不是：

```text
Step 4:
create payment again
```

这就是：

> **At-least-once Workflow + Idempotent Executor 的核心闭环。**

---

# 23. Checkpoint 与 Idempotency 各自解决什么

这两个机制经常被混淆。

### Checkpoint

回答：

> Workflow 应该从哪里继续？

### Idempotency

回答：

> 这个 Step 再执行一次会不会产生重复副作用？

所以：

```text
Checkpoint
=
resume location
```

而：

```text
Idempotency
=
side-effect safety
```

AWS Step Functions 的 redrive 会保留成功状态，不重新执行成功步骤；AWS Durable Execution SDK 则通过 checkpointed results 在 replay 时返回已保存结果。([docs.aws.amazon.com](https://docs.aws.amazon.com/step-functions/latest/dg/redrive-executions.html?utm_source=chatgpt.com)；[docs.aws.amazon.com](https://docs.aws.amazon.com/durable-execution/sdk-reference/operations/step/?utm_source=chatgpt.com))

但在 side-effect boundary 上仍然需要 Idempotency，因为总存在：

```text
external effect
```

已经发生，而：

```text
checkpoint
```

尚未记录的窗口。

---

# 24. Step 应该尽可能小，并且一个 Step 一个主要副作用

一个非常危险的实现：

```typescript
await step("process-order", async () => {
  await chargePayment();
  await sendEmail();
  await updateInventory();
});
```

如果：

```text
chargePayment()
成功

sendEmail()
失败
```

整个 Step retry：

```text
chargePayment()
再次执行
```

这就把一个 Step 里的多个独立副作用绑在了一起。

AWS 当前 Durable Execution SDK 的 Step Design 明确建议：每个 Step 应该具有单一逻辑意图；有外部副作用的 API 调用应尽量独立成 Step，因为一个 Step 包含多个不相关 side effects 时，retry 可能重新执行前面的成功操作。([docs.aws.amazon.com](https://docs.aws.amazon.com/durable-execution/patterns/best-practices/step-design/?utm_source=chatgpt.com))

更合理：

```text
Step 1: charge-payment
Step 2: send-email
Step 3: update-inventory
```

每个 Step：

```text
own operationId
own idempotency key
own result
```

---

# 25. “One Step = One Side Effect Boundary” 是很好的设计规则

可以把：

```text
Step
```

理解成：

```text
一个可以独立重试、独立记录结果、独立恢复的业务动作。
```

例如：

```text
validate-order
reserve-cash
submit-trade
send-client-email
confirm-trade
```

每一个都可以有：

```text
operationId
idempotencyKey
result
```

这样：

```text
Step 3 failure
```

不会让：

```text
Step 1
Step 2
```

被无谓重复执行。

---

# 26. External Provider 支持 Idempotency 时应直接传播

这是整个模式最理想的情况。

例如：

```text
Agent Workflow
    ↓
Command Executor
    ↓
Payment Adapter
    ↓
Stripe / Adyen / PayPal
```

内部：

```text
idempotencyKey =
PAYMENT:OP-123
```

向下游：

```http
Idempotency-Key: PAYMENT:OP-123
```

或者 provider 对应的 header。

Adyen 官方文档明确支持使用同一个 idempotency key 安全重试 payment request，并说明在第一次请求已经处理的情况下，重复请求不会再次收费，而会返回原请求结果；Adyen 还定义了 key 的生命周期和并发冲突行为。([docs.adyen.com](https://docs.adyen.com/development-resources/api-idempotency?utm_source=chatgpt.com))

PayPal 也支持 `PayPal-Request-Id`，并明确说明同一个 request ID 的 retry 不会重复执行交易，而是返回原请求结果。([developer.paypal.com](https://developer.paypal.com/api/make-api-requests?utm_source=chatgpt.com))

---

# 27. Provider Idempotency Key 不一定等于内部 Idempotency Key

内部：

```text
WORKFLOW-100:
PAYMENT-OP-1
```

Provider：

```text
PAY-OP-1
```

或者：

```text
UUID
```

都可以。

重要的是建立一个稳定映射：

```text
Internal Operation ID
        │
        ▼
Provider Operation ID
        │
        ▼
External Reference
```

例如：

```text
operationId:
PAYMENT-OP-1

providerIdempotencyKey:
merchantA:PAYMENT-OP-1

externalReference:
STRIPE-PI-9988
```

这样：

```text
same internal operation
```

始终能映射到：

```text
same external operation
```

---

# 28. 外部系统不支持 Idempotency 时怎么办

现实中经常会遇到：

```text
POST /submit
```

没有：

```text
Idempotency-Key
```

此时不能因为内部有：

```text
idempotencyKey
```

就声称：

```text
“这个 API 已经幂等。”
```

更可靠的方案依次可以考虑：

```text
1. External business reference
2. Client-generated resource ID
3. Status query / reconciliation
4. Idempotent adapter
5. Natural business uniqueness
6. At-most-once + no automatic retry
```

具体采用哪一种，取决于业务能接受：

```text
duplicate
```

还是：

```text
lost / ambiguous execution
```

的哪一种风险。

---

# 29. External Reference 是 Legacy Integration 的关键

例如 Vendor API 不支持：

```text
Idempotency-Key
```

但支持：

```text
clientInstructionId
```

那么：

```text
operationId =
VOTE-123
```

可以映射：

```text
clientInstructionId =
VOTE-123
```

retry 时再次发送：

```text
VOTE-123
```

Vendor 可以：

```text
return existing instruction
```

或者：

```text
reject duplicate
```

这比：

```text
blind retry POST
```

安全得多。

---

# 30. 如果 Vendor 只支持 Status Query

那么：

```text
Timeout
```

可以：

```text
query status
```

例如：

```text
GET /instructions/VOTE-123
```

得到：

```text
SUBMITTED
```

那么：

```text
mark internal command SUCCEEDED
```

如果：

```text
NOT_FOUND
```

才可以考虑 retry。

不过：

> **“先 Query 再 Retry”只是风险降低机制，不是绝对 exactly-once 保证。**

因为：

```text
Query
→ NOT_FOUND
```

和：

```text
Vendor processes request immediately after query
```

之间仍然可能发生竞态。

所以如果业务很关键：

```text
reconciliation
```

仍然是必要的。

---

# 31. Payment 是这个架构最直观的真实案例

Stripe、Adyen、PayPal 都已经长期把 Idempotency 做成 Payment API Contract，而不是把它留给调用方自行猜测。

Stripe 明确允许调用方使用 Idempotency Key 安全 retry，并保存第一次请求结果；Adyen 说明使用相同 key 可以在 timeout 后安全重试而不会产生第二次 payment；PayPal 通过 `PayPal-Request-Id` 对 POST/PUT 等修改操作提供幂等。([docs.stripe.com](https://docs.stripe.com/api/idempotent_requests?utm_source=chatgpt.com)；[docs.adyen.com](https://docs.adyen.com/development-resources/api-idempotency?utm_source=chatgpt.com)；[developer.paypal.com](https://developer.paypal.com/api/make-api-requests?utm_source=chatgpt.com))

这类成熟支付系统非常能说明本文的核心模式：

```text
Retry
不是危险本身。

没有 Idempotency 的 Retry
才是危险。
```

---

# 32. 一个 Payment Workflow

例如：

```text
User
 ↓
Agent
 ↓
CreatePaymentProposal
 ↓
Policy
 ↓
Approval
 ↓
CreatePaymentCommand
 ↓
Workflow
      ├── validate
      ├── reserve
      └── capture
```

真正的副作用步骤：

```text
capture-payment
```

使用：

```text
operationId =
PAYMENT:ORDER-123:CAPTURE-1
```

内部：

```text
idempotencyKey =
PAYMENT:ORDER-123:CAPTURE-1
```

外部：

```text
Provider idempotency key =
merchantA:PAYMENT:ORDER-123:CAPTURE-1
```

如果：

```text
timeout
```

Workflow 可以：

```text
retry same command
```

Executor：

```text
same operationId
```

Provider：

```text
same idempotency key
```

最终：

```text
one payment effect
```

---

# 33. Trade Workflow 更需要 Unknown + Reconciliation

考虑：

```text
Agent
 ↓
Trade Proposal
 ↓
Approval
 ↓
SubmitTradeCommand
 ↓
Broker API
```

如果：

```text
broker request accepted
network timeout
```

不能：

```text
blind retry
```

而应该：

```text
UNKNOWN
  ↓
Broker Query / Execution Report
  ↓
FOUND
```

如果已经成交：

```text
SUCCEEDED
```

如果没有：

```text
NOT_FOUND
```

才考虑：

```text
retry same logical operation
```

这类模式在金融市场基础设施里尤其重要，因为：

```text
duplicate execution
```

和：

```text
lost execution
```

都可能比普通业务系统严重得多。

BIS 2025 年关于 AI agents 在支付系统现金与流动性管理中的研究明确指出，AI Agent 进入高价值支付基础设施后，需要监管 safeguards、human oversight 和更进一步的研究。这里并没有公开证明其内部采用某一种 Idempotency Executor，但它说明 agentic systems 正逐步进入本身就要求强可靠性与控制的金融基础设施场景。([bis.org](https://www.bis.org/publications/working-paper-1310-ai-agents-cash-management-payment-systems?utm_source=chatgpt.com))

---

# 34. Proxy Voting 同样适合这个模式

例如：

```text
SubmitProxyVoteCommand
```

可以定义：

```text
operationId =
PROXYVOTE:
meeting:M100:
account:A123:
instruction:I7
```

Workflow：

```text
1. Validate meeting
2. Validate entitlement
3. Validate mandate
4. Approval
5. Submit vote
6. Confirm vendor
7. Reconcile
```

如果：

```text
Step 5
```

timeout：

```text
same operationId
```

retry。

如果 Vendor 返回：

```text
already submitted
```

Executor 将其视为：

```text
successful completion / existing operation
```

而不是：

```text
failure
```

这里的关键不是说 Proxy Voting 系统一定支持这个 API contract，而是：

> **如果业务领域不存在天然的 vendor-level idempotency，就应该在 adapter / command executor 层建立操作 identity + reconciliation。**

---

# 35. Idempotency 与 Approval 的关系

假设：

```text
Command:
CMD-123

Approval:
APP-456
```

Approval 完成以后：

```text
Workflow retries
```

不能重新产生：

```text
CMD-124
```

而应该继续：

```text
CMD-123
```

使用：

```text
same commandHash
same operationId
same idempotencyKey
```

所以：

```text
Approval
     ↓
Approved Command
     ↓
Idempotent Executor
```

自然形成：

```text
one approved business action
→ many technical attempts
```

而不是：

```text
one approval
→ multiple commands
```

这对金融场景非常关键。

---

# 36. Human Approval 不能成为 Idempotency Shortcut

错误设计：

```text
Approval = true
```

然后：

```text
每次 retry
都直接执行
```

这会让：

```text
Approval
```

变成：

```text
永不过期的 permission
```

正确应该：

```text
Approved Command
   ↓
same Command Hash
   ↓
same Operation
   ↓
Executor dedupe
```

如果 Command 改变：

```text
new Command
```

那么：

```text
new approval
```

如果：

```text
same command
same hash
same operation
```

只是：

```text
retry
```

不需要重新审批。

---

# 37. Workflow Retry 与 Business Retry 要分开

这是企业架构中一个非常值得标准化的概念。

### Workflow Retry

表示：

```text
“执行环境出了问题，我继续运行这个 Step。”
```

例如：

```text
worker crash
network timeout
transient 503
```

### Business Retry

表示：

```text
“业务操作本身需要重新发起一次。”
```

例如：

```text
User explicitly resubmits a rejected payment
```

二者不能混淆。

```text
Workflow Retry
=
same operation
```

而：

```text
Business Retry
=
possibly new operation
```

例如：

```text
PAY-123
```

因为网络失败而 retry：

```text
same operation
```

而用户第二天又说：

> “再支付一次。”

可能是：

```text
new operation
```

必须使用新的：

```text
operationId
```

---

# 38. 一个非常重要的规则

可以直接作为平台开发规范：

> **Infrastructure Retry MUST preserve operation identity. Business Resubmission MUST create a new operation identity.**

即：

```text
基础设施重试
→ same operationId
```

而：

```text
用户重新发起
→ new operationId
```

这条规则非常有价值，因为它让：

```text
retry
```

和：

```text
new business intent
```

在系统里具有明确语义。

---

# 39. Command Executor 不应该自己决定 Business Retry

Executor 可以：

```text
retry same operation
```

但不应该自行创造：

```text
new business operation
```

例如：

```text
payment failed
```

Executor 可以：

```text
retry PAYMENT-123
```

但不能：

```text
create PAYMENT-124
```

除非上层业务 Workflow 明确产生：

```text
new business command
```

否则：

```text
technical recovery
```

和：

```text
business decision
```

就混在一起了。

---

# 40. Workflow 应该负责“什么时候继续”，Executor 负责“这次操作是否安全”

可以定义成：

```text
Workflow
   ↓
Should I attempt this step?
```

而：

```text
Command Executor
   ↓
Is this the same operation?
Can I safely execute it?
What happened last time?
```

于是：

```text
Workflow
```

负责：

```text
orchestration
retry policy
timeout
branching
compensation
human wait
```

而：

```text
Executor
```

负责：

```text
idempotency
preconditions
business execution
result persistence
reconciliation
```

这是非常清晰的职责边界。

---

# 41. 不应该让 Workflow Engine 自己直接调用 External API

不推荐：

```text
Workflow
   ↓
HTTP POST
```

而推荐：

```text
Workflow
   ↓
Command
   ↓
Command Executor
   ↓
External Adapter
   ↓
API
```

原因是：

```text
Workflow
```

如果直接调用 API，需要自己理解：

```text
idempotency
provider semantics
unknown state
external reference
response replay
```

最终 Workflow Engine 就开始承载 Business Execution。

这与：

```text
Agent Runtime
不应该拥有业务状态机
```

的原则类似。

---

# 42. Command Executor 是一个稳定的防腐层

尤其是：

```text
Legacy System
Vendor API
Broker API
Payment Provider
MCP Server
```

都可能具有不同的：

```text
retry
timeout
idempotency
error
authentication
```

Command Executor / Adapter 可以把它们统一成：

```text
SUCCESS
FAILED_RETRYABLE
FAILED_FINAL
UNKNOWN
```

以及统一：

```text
operationId
externalReference
idempotencyKey
```

于是 Workflow 不需要知道：

```text
Adyen
PayPal
ISS
Broker X
Vendor Y
```

各自的特殊实现。

---

# 43. Executor 最终返回的应该是 Business Result

错误：

```json
{
  "httpStatus": 504,
  "message": "upstream timeout"
}
```

更合适：

```json
{
  "operationId": "PAY-123",
  "status": "UNKNOWN",
  "reasonCode": "PROVIDER_TIMEOUT",
  "reconciliationRequired": true
}
```

或者：

```json
{
  "operationId": "PAY-123",
  "status": "SUCCEEDED",
  "resourceReference": "PAY-998"
}
```

Workflow 只需要理解：

```text
业务状态
```

而不需要理解：

```text
底层 HTTP error
```

---

# 44. Failure Classification 应该成为平台公共能力

建议标准化：

```text
NON_RETRYABLE
SAFE_RETRYABLE
UNKNOWN_OUTCOME
RECONCILIATION_REQUIRED
```

例如：

| Failure                                     | Classification          |
| ------------------------------------------- | ----------------------- |
| Schema invalid                              | NON_RETRYABLE           |
| Authorization denied                        | NON_RETRYABLE           |
| Business rule violation                     | NON_RETRYABLE           |
| Connection failed before request sent       | SAFE_RETRYABLE          |
| Provider rate limit                         | SAFE_RETRYABLE          |
| Timeout after request transmitted           | UNKNOWN_OUTCOME         |
| External reference exists but response lost | RECONCILIATION_REQUIRED |

最后两类尤其重要。

AWS Agentic AI Lens 将失败处理与 retry、backoff、retry budget、checkpoint recovery 作为 Agent reliability 的独立能力。([docs.aws.amazon.com](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentrel07.html?utm_source=chatgpt.com))

---

# 45. Retry Budget 是必需的

即使：

```text
same operation
```

可以安全 retry，也不能：

```text
retry forever
```

需要：

```text
maxAttempts
maxDuration
retryBudget
backoff
jitter
circuitBreaker
```

例如：

```typescript
const retryPolicy = {
  maxAttempts: 5,
  maxElapsedTimeMs: 60_000,
  backoff: "exponential",
  jitter: true,
};
```

AWS 的 Agentic AI reliability guidance 也强调避免无限 retry，并通过 retry budgets、backoff、circuit breakers 等机制控制故障传播。([docs.aws.amazon.com](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentrel07.html?utm_source=chatgpt.com))

---

# 46. 为什么 Idempotency 不能代替 Retry Budget

例如：

```text
Provider down
```

有：

```text
idempotency
```

确实不会重复扣款。

但如果：

```text
1000 workers
```

全部每隔：

```text
100ms
```

retry：

```text
provider
```

仍然会被进一步压垮。

因此：

```text
Idempotency
```

解决：

```text
correctness
```

而：

```text
Retry Budget
```

解决：

```text
stability
```

二者必须同时存在。

---

# 47. Idempotency 与 Circuit Breaker

假设：

```text
Payment Provider
```

连续：

```text
500
500
500
500
```

Workflow 仍然可能：

```text
retry
```

但：

```text
Circuit Breaker
```

可以：

```text
OPEN
```

进入：

```text
reconciliation / pending
```

而不是：

```text
继续向下游发请求
```

所以完整执行控制可以：

```text
Idempotency
+
Retry Budget
+
Circuit Breaker
+
Reconciliation
```

这比单独的：

```text
retry = 3
```

更适合金融系统。

---

# 48. Queue Redelivery 必须由 Executor 吞掉

例如：

```text
Queue
 ↓
Command CMD-123
 ↓
Worker A
```

Worker A：

```text
side effect success
```

然后：

```text
worker crashes
```

Queue 再次：

```text
CMD-123
```

Worker B：

```text
Command Executor
```

读取：

```text
operationId = PAY-123
status = SUCCEEDED
result = PAY-998
```

直接返回：

```text
PAY-998
```

而不是：

```text
Payment Provider
again
```

这就是经典 Idempotent Consumer 模式在 Agent Command Executor 上的直接应用。([microservices.io](https://microservices.io/patterns/communication-style/idempotent-consumer.html?utm_source=chatgpt.com))

---

# 49. Message Deduplication 与 Business Idempotency 也不要混为一谈

例如 SQS FIFO 可以在 5 分钟 deduplication interval 内根据 `MessageDeduplicationId` 去重。([docs.aws.amazon.com](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_SendMessage.html?utm_source=chatgpt.com))

但这不能取代：

```text
Business Idempotency
```

因为：

```text
Message Deduplication Window
```

只是：

```text
消息层
```

而：

```text
Payment operation
```

可能持续：

```text
小时
天
```

甚至：

```text
人工审批后才继续
```

所以：

```text
Queue dedup
```

只能是：

```text
transport optimization
```

而：

```text
Command Idempotency
```

才是：

```text
business correctness
```

---

# 50. Standard Queue + Idempotent Consumer 通常更容易扩展

如果业务允许：

```text
unordered
```

并且执行逻辑支持：

```text
idempotency
```

那么：

```text
Standard Queue
+
Idempotent Consumer
```

通常比：

```text
严格 FIFO
```

更灵活。

Amazon SQS Standard 采用 at-least-once delivery，并允许高吞吐，但消息可能重复和乱序；FIFO 则提供顺序和更强的去重/处理语义。([docs.aws.amazon.com](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/standard-queues.html?utm_source=chatgpt.com)；[docs.aws.amazon.com](https://docs.aws.amazon.com/en_en/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-fifo-queues.html?utm_source=chatgpt.com))

这也说明：

> **如果业务真正要求顺序，应该使用显式 concurrency / ordering control；不能把顺序问题假设成 Idempotency 能自动解决。**

---

# 51. Idempotency 与 Ordering 是两个不同问题

例如：

```text
Command A:
SetLimit(100)

Command B:
SetLimit(200)
```

两个命令都可以各自幂等。

但如果：

```text
B
先执行

A
后执行
```

最终：

```text
limit = 100
```

仍然可能错误。

所以：

```text
Idempotency
```

解决：

```text
重复
```

而：

```text
Ordering
```

解决：

```text
顺序
```

金融 Workflow 往往需要：

```text
Idempotency
+
Ordering / Versioning
```

而不是只做其中一个。

---

# 52. Optimistic Concurrency 也是补充机制

例如：

```text
Order version = 7
```

Command：

```text
expectedVersion = 7
```

执行：

```sql
UPDATE order
SET status = 'SUBMITTED',
    version = version + 1
WHERE id = ?
  AND version = 7;
```

如果：

```text
affected rows = 0
```

说明：

```text
状态已经被其他操作修改
```

这与 Idempotency 的关系是：

```text
Idempotency
→ 同一 operation 被重复执行不会重复产生效果

Optimistic Concurrency
→ 不同 operations 不应该覆盖彼此的状态
```

二者非常适合共同使用。

---

# 53. Fan-out / Parallel Agent Workflow 更需要 Operation Identity

例如：

```text
Agent
 ↓
Process 10,000 accounts
```

Workflow：

```text
Map
 ├── Account A
 ├── Account B
 ├── Account C
 ...
```

每一个 Mutation Step 都应得到独立：

```text
operationId
```

例如：

```text
WF-100:FREEZE:A001
WF-100:FREEZE:A002
WF-100:FREEZE:A003
```

而不能：

```text
WF-100:FREEZE
```

否则所有 parallel tasks 会被错误视为同一个 operation。

---

# 54. Parallel Execution 还需要资源级并发控制

例如两个 Agent 同时：

```text
Withdraw $50
```

同一个账户：

```text
A123
```

两个操作：

```text
OP-1
OP-2
```

各自都可以幂等。

但：

```text
available balance = $50
```

仍不能让两个都成功。

因此：

```text
Idempotency
```

不能代替：

```text
Concurrency Control
Balance Constraint
Business Invariant
```

这也是为什么 Command Executor 需要：

```text
idempotency
+
precondition
+
optimistic lock
```

的组合。

---

# 55. Long-running Workflow 的关键是“耐久身份”

例如：

```text
Workflow started:
09:00

Approval:
09:03

Human approval:
15:30

Execution:
15:31
```

如果：

```text
operation identity
```

依赖：

```text
current process
```

就会失效。

正确：

```text
workflowId
operationId
commandId
```

全部持久化。

然后：

```text
runtime restart
```

不会改变业务身份。

---

# 56. Agent Memory 不应该承担这些身份

不要：

```text
Memory:
"payment operation is PAY-123"
```

作为唯一来源。

应该：

```text
Command Store
Operation Store
Workflow Store
```

记录：

```text
PAY-123
```

Agent Memory 只保留：

```text
context:
user is working on payment X
```

而真正的执行身份来自：

```text
business state
```

AWS Durable Execution 体系将 durable execution state、checkpoint 和 step result 与普通 agent context 分开；这正是长流程恢复的基础。([docs.aws.amazon.com](https://docs.aws.amazon.com/durable-execution/patterns/best-practices/?utm_source=chatgpt.com))

---

# 57. Workflow State 应该与 Command State 分离

推荐：

```text
Workflow State
    currentStep
    status
    retryCount
    waitingForApproval

Command State
    operationId
    commandHash
    idempotencyKey
    executionStatus
    result
    externalReference
```

例如：

```text
Workflow:
WAITING_FOR_APPROVAL
```

同时：

```text
Command:
AWAITING_APPROVAL
```

Approval 后：

```text
Workflow:
READY_TO_EXECUTE
```

Command：

```text
APPROVED
```

Executor：

```text
PROCESSING
```

这比只用一个：

```text
status
```

表达全部语义清晰得多。

---

# 58. Command Executor 不应该拥有整个 Workflow State Machine

Executor 只需要知道：

```text
当前这个 Command 是什么？
```

不需要知道：

```text
Workflow 下一步还有哪 20 个 Step。
```

所以：

```text
Workflow
```

拥有：

```text
business process state
```

而：

```text
Executor
```

拥有：

```text
command execution state
```

两个状态机可以关联：

```text
workflowId
operationId
```

但不应该变成一个巨大状态机。

---

# 59. 一个完整的状态关系

```text
Workflow
──────────────
RUNNING
WAITING_APPROVAL
SUSPENDED
FAILED
COMPLETED

Command
──────────────
CREATED
APPROVED
QUEUED
PROCESSING
SUCCEEDED
FAILED
UNKNOWN

Execution Attempt
─────────────────
STARTED
COMPLETED
INTERRUPTED
TIMED_OUT
```

这样：

```text
Workflow = business orchestration
Command = business action
Attempt = technical execution
```

这三个层次非常清晰。

---

# 60. At-least-once Workflow 的“重复”必须是可控重复

好的重复：

```text
same operation
same command
same key
executor dedupe
```

坏的重复：

```text
new operation
new key
new external side effect
```

所以：

> **真正的工程目标不是“系统永远不重复调用”，而是“重复调用永远不能偷偷变成新的业务操作”。**

这是这个架构最值得记住的一句话。

---

# 61. 一个完整的支付故障案例

考虑：

```text
09:00
Workflow:
PAYMENT-123
```

发送：

```text
Payment Provider
```

Provider：

```text
processed payment
```

但：

```text
network response lost
```

Workflow：

```text
timeout
```

于是：

```text
retry PAYMENT-123
```

Executor：

```text
idempotencyKey=PAYMENT-123
```

发现：

```text
PROCESSING
```

如果 Provider 支持同 key：

```text
retry same external key
```

Provider：

```text
already processed
→ return original result
```

最终：

```text
Payment:
ONE

Execution Attempts:
TWO
```

这正是：

```text
At-least-once
+
Idempotent Executor
```

的理想结果。

---

# 62. 没有 Idempotent Executor 会发生什么

相同场景：

```text
Attempt 1:
Provider success
response lost

Attempt 2:
Provider sees a new request
Provider success
```

最终：

```text
Payment:
TWO
```

Workflow 本身可能完全正确：

```text
retry on timeout
```

真正错误的是：

```text
Business Execution Boundary
```

没有提供：

```text
same logical operation
```

的执行语义。

因此：

> **Workflow Retry 不是业务 Bug；没有幂等的 Command Executor 才是架构 Bug。**

---

# 63. 不能通过减少 Retry 来“解决”问题

一个常见反应：

> “那我们把 retry 关掉不就好了？”

这会把问题变成：

```text
duplicate effect
```

换成：

```text
lost operation
```

例如：

```text
Provider response lost
retry disabled
```

现在系统不知道：

```text
Payment succeeded?
```

Workflow 可能：

```text
FAILED
```

但真实世界：

```text
SUCCEEDED
```

这更加危险。

因此：

```text
retry off
```

并不是一般性的可靠性方案。

AWS Durable Execution SDK 也明确指出，at-most-once semantics 只是控制单次 retry attempt 的重新执行，并不能自动提供全流程 exactly-once。([docs.aws.amazon.com](https://docs.aws.amazon.com/durable-execution/patterns/best-practices/idempotency/?utm_source=chatgpt.com))

---

# 64. At-most-once 什么时候才更合适

对于某些真正无法幂等的外部副作用：

```text
one-shot SMS
某些 legacy POST
某些 broker instruction
```

系统可能选择：

```text
At-most-once
+
No automatic retry
```

AWS Durable Execution SDK 官方文档就给出了类似建议：对支付扣款、一次性短信、无法幂等的 POST 等外部 side effects，可以使用 at-most-once semantics，并关闭 retry。([docs.aws.amazon.com](https://docs.aws.amazon.com/durable-execution/patterns/best-practices/idempotency/?utm_source=chatgpt.com))

但是这意味着：

```text
unknown outcome
```

必须交给：

```text
manual reconciliation
```

而不能假设：

```text
failure = no side effect
```

所以它是：

```text
trade-off
```

而不是：

```text
universally better
```

---

# 65. 这也是为什么本文选择“Idempotent Command Executor”

因为：

```text
At-least-once Workflow
```

和：

```text
Idempotent Command Executor
```

组合以后，可以把：

```text
reliability
```

交给 Workflow，把：

```text
correctness
```

交给 Executor。

这是一个很好的分层：

```text
Workflow
=
delivery + recovery

Executor
=
business effect correctness
```

---

# 66. Command Executor 应该是 Deterministic 的

Agent：

```text
probabilistic
```

Workflow control：

```text
deterministic
```

Command Executor：

```text
deterministic
```

这意味着：

```text
same command
same operation
same current state
```

应该产生：

```text
same decision / same execution semantics
```

而不能：

```text
LLM decides whether duplicate is okay
```

AWS Agentic AI Lens 当前把“constrain LLM stochasticity through atomic task design、explicit contracts 和 deterministic execution logic”作为 reliability 原则。([docs.aws.amazon.com](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentrel02.html?utm_source=chatgpt.com))

---

# 67. 不要把 Idempotency 判断交给 LLM

不能：

```text
LLM:
“I think this payment was already processed.”
```

正确：

```text
Executor:
operationId = PAYMENT-123
↓
Idempotency Store
↓
SUCCEEDED
```

然后：

```text
LLM:
reads authoritative business result
```

LLM 可以：

```text
解释
```

不能：

```text
决定事实
```

---

# 68. 不要用 Semantic Deduplication 做 Business Idempotency

不能：

```text
embedding("refund $100")
≈
embedding("return 100 dollars")
```

所以：

```text
deduplicate
```

这是因为：

```text
两个不同客户
两笔不同订单
两个不同账户
```

可能语义非常相似。

业务 Idempotency 应使用：

```text
deterministic identifiers
```

而不是：

```text
semantic similarity
```

---

# 69. 一个成熟的 Command Identity

推荐：

```typescript
interface CommandIdentity {
  workflowId: string;
  operationId: string;

  commandType: string;
  schemaVersion: number;

  requestHash: string;

  idempotencyKey: string;
}
```

例如：

```json
{
  "workflowId": "WF-100",
  "operationId": "PAYMENT-123",
  "commandType": "CapturePayment",
  "schemaVersion": 2,
  "requestHash": "abc123",
  "idempotencyKey": "PAYMENT-123"
}
```

Attempt：

```json
{
  "attemptId": "ATTEMPT-7",
  "startedAt": "...",
  "workerId": "worker-9"
}
```

这就形成：

```text
logical
vs
physical
```

的明确边界。

---

# 70. Command Executor 应支持 Result Replay

推荐：

```typescript
if (record.status === "SUCCEEDED") {
  return record.result;
}
```

而不是：

```typescript
if (record.exists()) {
  throw DuplicateOperationError();
}
```

因为：

```text
duplicate request
```

不一定应该是：

```text
error
```

它通常是：

```text
same operation
```

在 retry 场景下：

```text
return original result
```

才是最有用的语义。

Stripe 与 Adyen 都采用了类似的“same key → recover/replay original result”的 API 模式。([docs.stripe.com](https://docs.stripe.com/api/idempotent_requests?utm_source=chatgpt.com)；[docs.adyen.com](https://docs.adyen.com/development-resources/api-idempotency?utm_source=chatgpt.com))

---

# 71. 如果状态是 PROCESSING 怎么办

不能：

```text
PROCESSING
→ execute again
```

也不能：

```text
PROCESSING
→ forever wait
```

推荐：

```text
PROCESSING
    │
    ├── active lease
    │      ↓
    │    wait / poll
    │
    └── expired lease
           ↓
        recovery
```

Recovery：

```text
1. inspect execution attempt
2. inspect external reference
3. query provider
4. determine outcome
5. resume or retry
```

这就是：

```text
Lease
+
Reconciliation
```

的作用。

---

# 72. Lease 不能代替 Idempotency

Lease 只是：

```text
“谁现在有权执行”
```

它不能回答：

```text
“外部系统到底有没有执行成功”
```

例如：

```text
Worker A
lease acquired
external payment success
worker dies
lease expires
```

Worker B：

```text
lease acquired
```

不能直接：

```text
charge again
```

而是：

```text
reconcile first
```

所以：

```text
Lease
=
execution ownership

Idempotency
=
logical operation identity

Reconciliation
=
external truth
```

三个概念必须分开。

---

# 73. Idempotency Store 的 TTL 也需要设计

不能永久保存所有：

```text
idempotencyKey
```

但也不能太短。

应该考虑：

```text
workflow max duration
retry window
human approval wait
provider idempotency retention
business correction window
```

Adyen 官方文档例如说明其 key 默认有效 7–14 天；PayPal 的 `PayPal-Request-Id` 可以保存最多 45 天。([docs.adyen.com](https://docs.adyen.com/development-resources/api-idempotency?utm_source=chatgpt.com)；[developer.paypal.com](https://developer.paypal.com/api/make-api-requests?utm_source=chatgpt.com))

因此：

```text
Internal TTL
```

应该至少经过：

```text
external provider contract
+
workflow recovery requirement
```

的设计，而不是随便设置：

```text
24h
```

---

# 74. 如果 Idempotency Record 过期，会发生什么

这是一个非常危险的边界。

例如：

```text
Day 1
PAYMENT-123
→ SUCCEEDED
```

Day 8：

```text
Idempotency record expired
```

Agent 又重新发：

```text
same key
```

如果：

```text
provider key
```

也已经 expired，那么：

```text
new external operation
```

可能发生。

所以：

> **Idempotency guarantee 只能在它覆盖的 retention window 内成立。**

系统必须明确：

```text
How long is the same operation considered retryable?
```

超出这个窗口：

```text
new business operation
```

或者：

```text
manual reconciliation
```

必须由业务规则决定。

---

# 75. 高风险金融命令不应该只依赖 TTL

例如：

```text
Trade
Payment
Proxy Vote
Corporate Action
```

如果：

```text
old operation
```

多年以后再次出现：

```text
same operationId
```

不应该简单：

```text
execute
```

应该至少检查：

```text
business expiry
command expiration
policy version
approval validity
resource state
```

所以：

```text
Idempotency TTL
```

不是：

```text
Business Validity
```

两者完全不同。

---

# 76. Command Executor 应在执行前重新做 Preconditions

即使：

```text
same idempotencyKey
```

也不能跳过：

```text
current business state
```

例如：

```text
TradeCommand
```

创建时：

```text
account = ACTIVE
```

执行时：

```text
account = FROZEN
```

那么：

```text
same operation
```

仍不能执行。

因此：

```text
Idempotency
```

保证：

```text
不重复
```

而：

```text
Precondition
```

保证：

```text
仍然合法
```

两者必须同时存在。

---

# 77. 一个完整的 Executor Pipeline

推荐：

```text
Command
  ↓
1. Schema validation
  ↓
2. Identity validation
  ↓
3. Authorization
  ↓
4. Approval validation
  ↓
5. Command hash validation
  ↓
6. Idempotency claim
  ↓
7. Existing result?
  ├── yes → replay
  └── no
       ↓
8. Business precondition
       ↓
9. Execute
       ↓
10. Persist result
       ↓
11. Publish event / outbox
       ↓
12. Return result
```

这里：

```text
Idempotency
```

不是整个 Executor 唯一的控制。

而是：

```text
执行安全链
```

的一部分。

---

# 78. 为什么 Idempotency Claim 不一定应该最先执行

有一种简单实现：

```text
claim key
→ execute
```

但复杂企业系统还要考虑：

```text
unauthorized request
```

是否可以污染：

```text
Idempotency Store
```

例如攻击者可以不断提交：

```text
random operationId
```

造成：

```text
store pollution
```

因此通常更合理：

```text
authenticate
authorize
validate command
validate resource
then claim / execute
```

但具体顺序仍需根据：

```text
security model
```

和：

```text
business semantics
```

设计。

关键是：

> **Idempotency 不是 Authorization 的替代品。**

---

# 79. Idempotent Executor 仍然需要 Rate Limiting

即使：

```text
same key
```

不会重复产生业务效果：

```text
100000 duplicate requests
```

仍然会：

```text
consume DB
consume CPU
consume queue
consume provider bandwidth
```

所以需要：

```text
rate limit
quotas
retry budgets
circuit breaker
```

这也是 AWS Agentic AI Lens 将 agent runaway loop containment 与 idempotency 分开作为 reliability/security concerns 的原因。([docs.aws.amazon.com](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/reliability-design-principles.html?utm_source=chatgpt.com))

---

# 80. Agent Workflow 的“至少一次”不等于“无限自动恢复”

一个稳健系统应该：

```text
retry
→ retry
→ retry
→ stop
→ reconcile
→ human / business decision
```

而不是：

```text
retry forever
```

对于金融高风险动作尤其如此。

例如：

```text
Trade UNKNOWN
```

在三次：

```text
provider query
```

之后仍然：

```text
UNKNOWN
```

更合理的是：

```text
RECONCILIATION_REQUIRED
```

进入：

```text
Operations Queue
```

而不是继续让 Agent 自己尝试。

---

# 81. Human Escalation 是可靠性机制，不只是合规功能

例如：

```text
UNKNOWN
+
cannot reconcile
```

这不是：

```text
LLM reasoning problem
```

而是：

```text
operational uncertainty
```

因此可以：

```text
Command
→ UNKNOWN
→ Operations Case
→ Human resolution
```

而：

```text
Agent
```

只负责：

```text
notify user
explain current status
```

FINRA 当前 2026 Regulatory Oversight Report 明确建议金融机构建立 review/approval processes、clear governance、ongoing monitoring，以及 agent access、agent actions、guardrails 和 human-in-the-loop controls。([finra.org](https://www.finra.org/rules-guidance/guidance/reports/2026-finra-annual-regulatory-oversight-report/gen-ai?utm_source=chatgpt.com))

---

# 82. Agent 不应该“修复” UNKNOWN

危险：

```text
Agent:
“I think the payment probably failed,
so I'll submit it again.”
```

正确：

```text
Executor:
UNKNOWN

Reconciliation:
check provider

Result:
FOUND

Business State:
SUCCEEDED
```

或者：

```text
Result:
NOT_FOUND

Decision:
retry same operation
```

因此：

> **Unknown Outcome 必须由 deterministic recovery logic 处理，而不是让 LLM 猜。**

---

# 83. Transactional Outbox 与 Idempotent Executor 是天然组合

推荐：

```text
DB Transaction
 ├── Command State
 ├── Business State
 ├── Idempotency Record
 └── Outbox
```

commit：

```text
↓
Outbox Relay
↓
Queue
↓
Idempotent Executor
```

这样：

```text
Message sent twice
```

没关系。

因为：

```text
same operationId
same idempotencyKey
```

Executor 会：

```text
return existing result
```

AWS 官方的 Transactional Outbox guidance 正是建议业务数据库和 outbox 同事务，同时让下游 consumer 做幂等。([docs.aws.amazon.com](https://docs.aws.amazon.com/en_en/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html?utm_source=chatgpt.com))

---

# 84. 但 Outbox 不要被误认为 exactly-once

Outbox 解决：

```text
DB write
+
Message publication
```

之间的一致性。

它不解决：

```text
External Payment
```

的 exactly-once。

所以：

```text
Outbox
+
Idempotent Consumer
```

解决：

```text
Internal distributed messaging
```

而：

```text
Provider Idempotency
+
Reconciliation
```

解决：

```text
External side effect
```

这两层都需要。

---

# 85. Message ID、Command ID 和 Idempotency Key 应该全部保留

建议：

```text
messageId
commandId
operationId
idempotencyKey
attemptId
```

不要只保留：

```text
requestId
```

原因：

```text
messageId
```

回答：

```text
是哪条消息？
```

```text
commandId
```

回答：

```text
是哪一个业务 Command？
```

```text
operationId
```

回答：

```text
是哪一个逻辑业务动作？
```

```text
idempotencyKey
```

回答：

```text
如何做重复执行保护？
```

```text
attemptId
```

回答：

```text
这是第几次技术尝试？
```

---

# 86. Audit Trail 应该能重建整个链路

最终至少应该可以：

```text
Agent Run
 ↓
Workflow
 ↓
Operation
 ↓
Command
 ↓
Approval
 ↓
Message
 ↓
Attempt
 ↓
External Reference
 ↓
Outcome
```

这样发生事故时：

```text
“为什么扣了两次？”
```

系统可以回答：

```text
Operation:
PAY-123

Attempts:
1. provider accepted
2. network timeout
3. workflow retry

External reference:
PAY-998

Idempotency:
same key

Final result:
SUCCEEDED

Second business effect:
none
```

这比：

```text
Agent trace
```

能够提供的证据完整得多。

---

# 87. 金融服务为什么特别适合这个模式

金融系统天然具有：

```text
high-value side effects
long-running workflow
human approval
external counterparties
asynchronous confirmations
reconciliation
regulatory audit
```

这恰好对应：

```text
At-least-once workflow
+
Idempotent executor
```

例如：

```text
Trade
Payment
Proxy Vote
Corporate Action
Client Instruction
Account Freeze
Refund
```

都不是简单：

```text
HTTP Request
```

而是：

```text
Business Operation
```

它们通常都有：

```text
business identity
status
approval
external reference
reconciliation
```

所以非常适合以：

```text
Command
```

作为可靠执行边界。

---

# 88. FINRA 的实际监管视角支持这种控制分层

FINRA 2026 Regulatory Oversight Report 明确指出，GenAI 使用并不会取代现有监管义务；使用 AI 可能影响：

```text
supervision
communications
recordkeeping
fair dealing
```

同时 FINRA 建议金融机构建立正式 review/approval process、governance framework、持续 monitoring、agent access/action tracking 和 human-in-the-loop controls。([finra.org](https://www.finra.org/rules-guidance/guidance/reports/2026-finra-annual-regulatory-oversight-report/gen-ai?utm_source=chatgpt.com))

这并没有直接规定：

```text
“金融 Agent 必须使用 Idempotent Command Executor”
```

没有这样的直接监管条文。

但从架构角度可以得到一个合理推论：

> 如果 Agent 的行为会产生业务副作用，那么 supervision、action tracking、control 和 recovery 不能仅停留在 LLM 层；必须有稳定的业务操作身份和可重建的执行状态。

这里是架构推论，不应被表述成监管要求本身。

---

# 89. Bank of England 的研究也说明 Agent 将逐渐进入核心金融流程

Bank of England 2025 年的 Financial Stability in Focus 明确指出，AI 已经被金融机构用于内部流程自动化和客户交互，并可能越来越多地影响核心金融决策。报告同时强调 AI 使用需要相应的治理、风险管理与控制。([bankofengland.co.uk](https://www.bankofengland.co.uk/financial-stability-in-focus/2025/april-2025?utm_source=chatgpt.com))

BIS 2025 年对 payment systems 中 AI agents 的研究也已经模拟了 GenAI Agent 参与高价值支付系统流动性管理，并特别强调 regulatory safeguards 和 human oversight。([bis.org](https://www.bis.org/publications/working-paper-1310-ai-agents-cash-management-payment-systems?utm_source=chatgpt.com))

这些研究并没有证明：

```text
金融 Agent 已经普遍采用本文架构
```

但它们说明：

```text
Agent
→ financial execution
```

已经从理论问题逐渐进入实际金融基础设施研究。

因此可靠的 execution semantics 会越来越重要。

---

# 90. Agent Workflow 的真正可靠性模型

如果把本文所有内容压缩成一条链：

```text
Agent
   ↓
Proposal
   ↓
Workflow
   ↓
Command
   ↓
Stable Operation Identity
   ↓
At-least-once delivery
   ↓
Idempotent Command Executor
   ↓
Business preconditions
   ↓
External side effect
   ↓
Result persistence
   ↓
Reconciliation
```

其中：

```text
At-least-once
```

保证：

```text
不容易丢
```

```text
Idempotency
```

保证：

```text
重复不会放大副作用
```

```text
Precondition
```

保证：

```text
当前状态仍然允许
```

```text
Reconciliation
```

保证：

```text
未知结果最终能够收敛
```

---

# 91. 最重要的反模式

## 反模式一：Workflow 自己调用 API

```text
Workflow
 ↓
POST /payment
```

应该：

```text
Workflow
 ↓
Command
 ↓
Executor
 ↓
Payment API
```

---

## 反模式二：每次 Retry 重新生成 UUID

```text
attempt 1 → key A
attempt 2 → key B
```

这会破坏幂等。

正确：

```text
same logical operation
→ same key
```

---

## 反模式三：使用 Agent Run ID 作为全局 Idempotency Key

一个 Agent Run 通常有多个 mutation。

正确：

```text
operationId per side effect
```

---

## 反模式四：只记录 `processed=true`

这样 retry 无法：

```text
replay result
```

应保存：

```text
status
result
resource reference
```

---

## 反模式五：Timeout = Failed

这是金融系统非常危险的错误。

应该：

```text
Timeout
→ UNKNOWN
→ Reconcile
```

---

## 反模式六：Idempotency Store 与业务事务完全脱离

可能出现：

```text
idempotency = SUCCESS
business state = rollback
```

或者：

```text
business state = SUCCESS
idempotency state = PROCESSING
```

所以同一数据库时应尽量使用事务一起提交；跨系统则使用 Outbox / Saga / reconciliation 等模式。

---

## 反模式七：仅依赖 Queue Deduplication

例如：

```text
SQS FIFO
```

只解决：

```text
message delivery deduplication window
```

不能代替：

```text
business idempotency
```

---

## 反模式八：把整个 Workflow 做成一个巨型 Step

```text
charge
send email
update DB
call vendor
```

一个 Step 全包。

这样 retry 的 blast radius 非常大。

应拆成：

```text
charge
→ email
→ update
→ vendor
```

每个 side effect 独立控制。

AWS Durable Execution SDK 当前 Step Design 正是建议将有独立副作用的工作拆成单独 Step。([docs.aws.amazon.com](https://docs.aws.amazon.com/durable-execution/patterns/best-practices/step-design/?utm_source=chatgpt.com))

---

# 92. 一个值得平台强制执行的 Invariant

企业 Agent Platform 可以定义：

> **Every side-effecting Workflow Step MUST map to exactly one durable Logical Operation Identity.**

进一步：

> **Every infrastructure retry, replay, redelivery, redrive, or worker recovery MUST preserve that Logical Operation Identity.**

然后：

> **The Command Executor MUST make repeated execution attempts of the same Logical Operation converge to one business outcome.**

这是比：

```text
“所有 API 都要加 Idempotency-Key”
```

更完整的架构规范。

---

# 93. 推荐的企业 API Contract

每个 Mutation Command 都应包含：

```typescript
interface CommandEnvelope<T> {
  commandId: string;

  workflowId: string;
  operationId: string;

  type: string;
  schemaVersion: number;

  payload: T;

  idempotencyKey: string;

  commandHash: string;

  actor: {
    userId: string;
    agentId: string;
  };

  correlationId: string;
  causationId?: string;

  createdAt: string;
  expiresAt?: string;
}
```

每个 Executor 返回：

```typescript
interface CommandResult {
  operationId: string;

  status:
    | "SUCCEEDED"
    | "FAILED_RETRYABLE"
    | "FAILED_FINAL"
    | "UNKNOWN"
    | "PENDING";

  resourceReference?: string;

  externalReference?: string;

  reasonCode?: string;
}
```

这可以成为整个企业 Agent Platform 的标准。

---

# 94. 推荐的 Executor Interface

```typescript
interface CommandExecutor<TPayload, TResult> {

  execute(
    command: Command<TPayload>
  ): Promise<CommandResult<TResult>>;

  reconcile(
    operationId: string
  ): Promise<CommandResult<TResult>>;
}
```

把：

```text
execute
```

与：

```text
reconcile
```

直接作为两个一级能力，是一个很值得考虑的设计。

因为：

```text
execute()
```

解决：

```text
“发起业务动作”
```

而：

```text
reconcile()
```

解决：

```text
“确认外部世界发生了什么”
```

这对支付、交易、Proxy Vote 尤其有价值。

---

# 95. Reconciliation 不应该只是人工脚本

如果每次：

```text
UNKNOWN
```

都需要 DBA：

```text
SELECT ...
```

然后：

```text
curl Vendor API
```

那么系统并没有真正实现：

```text
durable business execution
```

更好的方式是：

```text
UNKNOWN
 ↓
Reconciliation Job
 ↓
External Query
 ↓
State Mapping
 ↓
Command State Update
```

人工只处理：

```text
cannot reconcile
```

而不是所有：

```text
timeout
```

---

# 96. Reconciliation 应该也是幂等的

例如：

```text
reconcile(PAY-123)
```

也可能：

```text
retry
```

所以：

```text
reconcile operation
```

本身也应该具有：

```text
stable operation identity
```

否则：

```text
reconciliation
```

又可能修改内部状态多次。

因此：

```text
Execution
+
Reconciliation
```

都应该采用 deterministic state transition。

---

# 97. Reconciliation 最终应该收敛到有限状态

例如：

```text
UNKNOWN
   ↓
RECONCILING
   ↓
 ┌───────┬──────────┐
 ↓       ↓          ↓
FOUND   NOT_FOUND   UNKNOWN
 ↓       ↓           ↓
SUCCESS RETRY      ESCALATE
```

这样系统不会永远：

```text
UNKNOWN
```

也不会：

```text
retry forever
```

---

# 98. Observability 应该围绕 Logical Operation，而不是只围绕 Request

监控：

```text
HTTP request
```

不够。

更应该：

```text
operationId
```

例如：

```text
PAYMENT-123

Attempts:
1
2
3

Provider:
PAY-9988

Final:
SUCCEEDED
```

这样 Operations 能够看到：

```text
一次业务动作
```

而不是：

```text
三个 HTTP requests
```

这对于 Agent 尤其重要，因为 Agent 可能制造多个技术调用，但人需要理解的是一个业务动作。

---

# 99. 关键 Metrics

建议至少监控：

```text
operation_success_rate
idempotency_hit_rate
idempotency_conflict_rate
duplicate_delivery_rate
processing_lease_expiry
unknown_outcome_rate
reconciliation_rate
reconciliation_duration
retry_count
retry_budget_exhaustion
external_provider_idempotency_conflicts
```

尤其值得关注：

```text
UNKNOWN rate
```

和：

```text
Idempotency hit rate
```

因为：

```text
UNKNOWN ↑
```

通常说明：

```text
external reliability
```

正在恶化。

而：

```text
Idempotency hit rate ↑
```

可能意味着：

```text
retry storm
workflow duplication
queue redelivery
agent loop
```

---

# 100. Chaos Testing 应该模拟什么

建议至少测试：

```text
1. worker crash before execute

2. worker crash after external side effect

3. worker crash before result persistence

4. queue duplicate delivery

5. concurrent same-operation execution

6. workflow replay

7. workflow redrive

8. DLQ replay

9. provider timeout after processing

10. idempotency store unavailable

11. provider idempotency store unavailable

12. reconciliation service unavailable
```

其中最重要的测试之一：

```text
external side effect SUCCESS
+
local persistence FAIL
```

如果这个窗口没有被正确处理：

```text
系统就不能真正声称自己具备可靠的幂等执行能力。
```

---

# 101. 一个简单的测试不变量

每一个 mutation test 都可以验证：

```text
Given:
same operationId

When:
execute N times
under arbitrary retry/replay/concurrency

Then:
business side effect count <= 1
```

更严格：

```text
Given:
same operationId
same command hash

And:
N concurrent attempts

Then:
exactly one business effect
and all callers converge to the same result
```

需要注意：

> “exactly one business effect”必须建立在具体业务系统确实支持相应执行控制的前提上；如果外部系统完全不支持幂等、也没有可靠状态查询，则不能仅凭内部 Executor 宣称全局 exactly-once。

---

# 102. 不能忽略 Business Compensation

如果：

```text
Step A
SUCCESS

Step B
SUCCESS

Step C
FAILED
```

有时候：

```text
retry C
```

足够。

但有些场景：

```text
Step B
```

已经造成不可逆外部影响。

这时需要：

```text
Compensation
```

例如：

```text
ReserveCash
 ↓
SubmitTrade
 ↓
TradeAccepted
 ↓
DownstreamFailure
```

可能需要：

```text
Compensating Command
```

但 Compensation 本身也是：

```text
new logical operation
```

所以：

```text
Original Operation
+
Compensating Operation
```

各自都有自己的：

```text
operationId
idempotencyKey
audit
```

---

# 103. Idempotency 与 Saga 是上下层关系

可以理解：

```text
Saga / Workflow
       ↓
defines
      “what steps and compensation”

Idempotent Executor
       ↓
defines
      “how each command tolerates replay”
```

所以：

```text
Saga
```

不是：

```text
Idempotency
```

的替代品。

而：

```text
Idempotency
```

是：

```text
Saga Step
```

的可靠执行基础之一。

---

# 104. 对 Agent Runtime 的最终架构建议

比较推荐：

```text
┌─────────────────────────────────────────┐
│              Agent Runtime              │
│                                         │
│ LLM / Planner / RAG / Memory / Tools   │
│                                         │
│ Responsibility: reasoning / proposal    │
└───────────────────┬─────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────┐
│          Workflow Control Plane         │
│                                         │
│ Workflow State                          │
│ Checkpoint                              │
│ Retry Policy                            │
│ Retry Budget                            │
│ Approval Wait                           │
│ Redrive                                 │
└───────────────────┬─────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────┐
│            Command Layer                │
│                                         │
│ operationId                             │
│ commandId                               │
│ commandHash                             │
│ idempotencyKey                          │
│ authorization / policy / approval       │
└───────────────────┬─────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────┐
│        Idempotent Command Executor      │
│                                         │
│ atomic claim                            │
│ duplicate detection                     │
│ result replay                           │
│ precondition                            │
│ concurrency                             │
│ retry classification                    │
│ reconciliation                          │
└───────────────────┬─────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────┐
│          External Adapter               │
│                                         │
│ provider idempotency                    │
│ external reference                     │
│ status query                            │
│ reconciliation                          │
└───────────────────┬─────────────────────┘
                    │
                    ▼
             Business Systems
```

这套模型特别适合：

```text
金融 Agent Platform
```

因为 Agent Framework 本身可以变化，而：

```text
Command Executor
```

可以保持为企业级稳定能力。

---

# 105. 与 AWS Agentic AI Lens 的关系

AWS 在 2026 年更新的 Agentic AI Lens 已经把：

```text
deterministic execution
durable workflow
checkpoint
idempotent task execution
retry
recovery
```

作为 Agent reliability 的一组核心实践。该 Lens 的总体目标就是把 Agent 从 prototype 发展到 production-grade system，并专门讨论如何在 Agent 的非确定性之上建立可预测、可恢复的执行系统。([docs.aws.amazon.com](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentic-ai-lens.html?utm_source=chatgpt.com))

AWS 甚至直接提出：

> recover from the last known good state, not the beginning

并将：

```text
checkpointed workflows
+
idempotent steps
+
graceful degradation
```

作为恢复模式。([docs.aws.amazon.com](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/reliability-design-principles.html?utm_source=chatgpt.com))

这与本文：

```text
At-least-once Workflow
+
Idempotent Command Executor
```

的核心逻辑高度一致。

不过本文进一步把：

```text
idempotent task
```

收敛成：

```text
Idempotent Command Executor
```

目的是更明确地建立 Agent Runtime 与 Business Side Effect 之间的企业架构边界。

---

# 106. 一个非常重要的边界：这不是要求所有 Workflow 都使用“Exactly Once”

不同 Workflow Engine 的语义不同。

例如：

* AWS SQS Standard 使用 at-least-once delivery；
* Azure Durable Task Activity 明确 at-least-once；
* AWS Durable Execution SDK 默认 Step semantics 为 at-least-once per retry；
* AWS Step Functions Standard 提供 durable execution 和 redrive；
* AWS Step Functions Express 明确支持 at-least-once execution model。([docs.aws.amazon.com](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/standard-queues.html?utm_source=chatgpt.com)；[learn.microsoft.com](https://learn.microsoft.com/en-sg/azure/azure-functions/durable/durable-functions-types-features-overview?utm_source=chatgpt.com)；[docs.aws.amazon.com](https://docs.aws.amazon.com/durable-execution/sdk-reference/operations/step/?utm_source=chatgpt.com)；[docs.aws.amazon.com](https://docs.aws.amazon.com/step-functions/latest/dg/sfn-best-practices.html?utm_source=chatgpt.com))

因此：

> **“At-least-once Workflow + Idempotent Command Executor”是一种推荐的架构模式，不是对所有 Workflow Engine 的统一产品语义描述。**

这点必须明确，否则容易把：

```text
Workflow engine capability
```

与：

```text
Architecture design principle
```

混为一谈。

---

# 107. 一个实用的选择原则

对于一个新的金融 Agent Workflow，可以从下面的决策开始：

### 情况 A：Step 没有副作用

例如：

```text
read
calculate
retrieve
classify
```

可以使用：

```text
at-least-once
```

通常无需复杂 Idempotency。

---

### 情况 B：内部数据库副作用

例如：

```text
upsert
set status
create internal record
```

优先：

```text
at-least-once
+
transactional idempotency
```

---

### 情况 C：外部 API 支持 Idempotency

例如：

```text
payment
```

优先：

```text
at-least-once
+
same provider idempotency key
```

---

### 情况 D：外部 API 不支持 Idempotency

考虑：

```text
at-most-once
+
no automatic retry
+
reconciliation
```

或者：

```text
idempotent adapter
+
external reference
+
status query
```

---

### 情况 E：高价值、不可逆金融操作

推荐：

```text
at-least-once workflow
+
command idempotency
+
precondition
+
approval
+
provider idempotency
+
reconciliation
+
audit
```

---

# 108. 最终推荐的设计原则

可以压缩为 15 条。

### 1. Workflow 允许重复，Business Effect 不允许重复

```text
replay
retry
redelivery
redrive
```

都属于正常恢复行为。

---

### 2. Logical Operation Identity 必须稳定

```text
operationId
```

不能因为 retry 改变。

---

### 3. Attempt Identity 必须与 Operation Identity 分开

```text
operationId
≠
attemptId
```

---

### 4. Command Executor 是副作用控制边界

不是 Agent Runtime。

---

### 5. Atomic Claim 必须是数据库级别原子操作

优先：

```text
unique constraint
conditional write
CAS
```

---

### 6. 相同 Key + 相同 Payload 应 Replay Result

不是再次执行。

---

### 7. 相同 Key + 不同 Payload 应 Conflict

不能默默接受。

---

### 8. PROCESSING 必须可恢复

需要：

```text
lease
heartbeat
timeout
recovery
```

---

### 9. UNKNOWN 必须是正式状态

不能：

```text
timeout = failure
```

---

### 10. UNKNOWN 必须进入 Reconciliation

不能让 LLM 猜。

---

### 11. Workflow Retry 与 Business Resubmission 必须分离

```text
retry
=
same operation

resubmit
=
new operation
```

---

### 12. Idempotency 与 Concurrency Control 必须同时考虑

```text
duplicate
+
race
```

是两个问题。

---

### 13. Idempotency 与 Ordering 也不能混淆

```text
duplicate
≠
out-of-order
```

---

### 14. Idempotency 与 Retry Budget 必须同时设计

```text
correctness
+
stability
```

---

### 15. External Side Effect 最终必须能够 Reconcile

否则：

```text
UNKNOWN
```

无法收敛。

---

# 109. 最终架构结论

整个模型可以最终浓缩成一张图：

```text
                         ┌─────────────┐
                         │    Agent    │
                         │ reasoning   │
                         └──────┬──────┘
                                │
                                ▼
                         ┌─────────────┐
                         │  Workflow   │
                         │             │
                         │ checkpoint  │
                         │ retry       │
                         │ redrive     │
                         └──────┬──────┘
                                │
                         at-least-once
                                │
                                ▼
                         ┌─────────────┐
                         │   Command   │
                         │             │
                         │ operationId │
                         │ commandHash │
                         │ idempotency │
                         └──────┬──────┘
                                │
                                ▼
                    ┌───────────────────────┐
                    │ Idempotent Command    │
                    │ Executor              │
                    │                       │
                    │ atomic claim          │
                    │ result replay         │
                    │ precondition          │
                    │ concurrency            │
                    │ retry classification  │
                    └──────────┬────────────┘
                               │
                    ┌──────────┴───────────┐
                    │                      │
                 SUCCESS                UNKNOWN
                    │                      │
                    │                 Reconcile
                    │                      │
                    └──────────┬───────────┘
                               ▼
                    ┌───────────────────────┐
                    │ Business / External   │
                    │ Side Effect            │
                    └───────────────────────┘
```

这套架构真正解决的是：

```text
Workflow:
“我可以为了可靠性再次尝试。”

Executor:
“没关系，只要这是同一个 Logical Operation，
我不会让它变成第二个业务动作。”
```

因此：

> **At-least-once Workflow 并不是一个妥协方案，而可以成为可靠 Agent Workflow 的基础执行语义；真正需要严格控制的，是业务副作用边界。**

把：

```text
exactly-once
```

强行追求在整个 Workflow、Queue、Worker、External API、Database、Agent Runtime 上同时成立，往往会得到一个复杂、脆弱、难以验证的系统。

而：

```text
At-least-once Workflow
        +
Durable State
        +
Idempotent Command Executor
        +
Reconciliation
```

则允许各层采用更现实的分布式语义，同时把真正关键的 correctness 集中到：

```text
Business Command
```

这一层。

---

# 110. 对金融 Agent 最终可以形成一个非常明确的不变量

对于任何产生金融或外部业务副作用的 Agent Workflow：

```text
One Logical Operation
        ↓
One Stable Operation Identity
        ↓
Many Possible Technical Attempts
        ↓
One Convergent Business Effect
```

同时：

```text
Workflow
    负责可靠地送达和恢复

Command
    负责表达明确的业务动作

Executor
    负责幂等地执行

Reconciliation
    负责处理未知外部结果

Audit
    负责保留证据
```

最终形成：

> **可靠性不是要求 Agent “不要犯第二次错误”，而是即使 Workflow 重试、Worker 崩溃、消息重复、执行恢复、外部响应丢失，系统仍能够把多个技术尝试收敛回同一个业务操作。**

这正是：

```text
At-least-once Workflow
+
Idempotent Command Executor
```

作为企业 Agent Execution Architecture 的真正价值。

---

# 参考资料

## 1. AWS Agentic AI / Durable Execution

**AWS Well-Architected Agentic AI Lens — Implement idempotent task execution patterns**
AWS 当前直接将 Idempotent Task Execution 作为 Agent reliability 最佳实践，建议 deterministic key、conditional writes、existing-result lookup，以及在多步骤 Workflow 和外部系统间传播 idempotency identity。([docs.aws.amazon.com](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentrel06-bp04.html?utm_source=chatgpt.com))

[AWS — Implement idempotent task execution patterns](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentrel06-bp04.html?utm_source=chatgpt.com)

---

**AWS Durable Execution SDK — Idempotency and retries**
详细解释 at-least-once、at-most-once per retry、replay、idempotency token 和 external side effects，是本文核心模式最直接的官方参考。([docs.aws.amazon.com](https://docs.aws.amazon.com/durable-execution/patterns/best-practices/idempotency/?utm_source=chatgpt.com))

[AWS — Idempotency and retries](https://docs.aws.amazon.com/durable-execution/patterns/best-practices/idempotency/)

---

**AWS Durable Execution SDK — Step**
说明 Step checkpointed result、replay、retry、AtLeastOncePerRetry / AtMostOncePerRetry 语义。([docs.aws.amazon.com](https://docs.aws.amazon.com/durable-execution/sdk-reference/operations/step/?utm_source=chatgpt.com))

[AWS — Step](https://docs.aws.amazon.com/durable-execution/sdk-reference/operations/step/)

---

**AWS Durable Execution SDK — Step Design**
建议将独立副作用拆成独立 Step，避免一个 Step 中多个 side effect 在 retry 时被整体重新执行。([docs.aws.amazon.com](https://docs.aws.amazon.com/durable-execution/patterns/best-practices/step-design/?utm_source=chatgpt.com))

[AWS — Step design](https://docs.aws.amazon.com/durable-execution/patterns/best-practices/step-design/)

---

**AWS Well-Architected Agentic AI Lens — Reliability Design Principles**
讨论 durable messaging、checkpointed workflows、idempotent steps 和 failure recovery。([docs.aws.amazon.com](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/reliability-design-principles.html?utm_source=chatgpt.com))

[AWS — Reliability design principles](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/reliability-design-principles.html)

---

## 2. Workflow / Durable Execution 实践

**AWS Step Functions — Restarting state machine executions with redrive**
Standard Workflow 支持从失败 Step redrive，并保留成功 Step 的结果而不重新执行成功部分。([docs.aws.amazon.com](https://docs.aws.amazon.com/step-functions/latest/dg/redrive-executions.html?utm_source=chatgpt.com))

[AWS — Redrive executions](https://docs.aws.amazon.com/step-functions/latest/dg/redrive-executions.html)

---

**AWS Step Functions — Best practices**
说明 Express Workflow 的 at-least-once execution model 以及适用边界。([docs.aws.amazon.com](https://docs.aws.amazon.com/step-functions/latest/dg/sfn-best-practices.html?utm_source=chatgpt.com))

[AWS — Step Functions best practices](https://docs.aws.amazon.com/step-functions/latest/dg/sfn-best-practices.html)

---

**Microsoft Durable Task / Durable Functions — Programming model**
明确说明 Activity 至少执行一次，因此 Activity logic 应尽可能幂等；同时介绍 orchestration replay。([learn.microsoft.com](https://learn.microsoft.com/en-sg/azure/azure-functions/durable/durable-functions-types-features-overview?utm_source=chatgpt.com))

[Microsoft — Durable Task Programming Model](https://learn.microsoft.com/en-sg/azure/azure-functions/durable/durable-functions-types-features-overview)

---

**Microsoft — Handle Errors and Retries in Durable Functions**
说明 Activity/Sub-orchestration 的 retry policy 与 error handling。([learn.microsoft.com](https://learn.microsoft.com/en-us/azure/azure-functions/durable/durable-functions-error-handling?utm_source=chatgpt.com))

[Microsoft — Durable Functions error handling](https://learn.microsoft.com/en-us/azure/azure-functions/durable/durable-functions-error-handling)

---

## 3. Messaging / At-least-once / Idempotent Consumer

**Amazon SQS — Standard queues**
标准队列采用 at-least-once delivery，消息可能重复或乱序。([docs.aws.amazon.com](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/standard-queues.html?utm_source=chatgpt.com))

[AWS — Standard queues](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/standard-queues.html)

---

**Amazon SQS — At-least-once delivery**
明确建议消费者设计为 idempotent，以便在消息重复投递时不产生错误副作用。([docs.aws.amazon.com](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/standard-queues.html?utm_source=chatgpt.com))

[AWS — At-least-once delivery](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/standard-queues-at-least-once-delivery.html)

---

**Microservices.io — Idempotent Consumer Pattern**
经典的 at-least-once message processing + idempotent consumer 模式，包括 processed message table 和业务实体内记录 message IDs 的实现。([microservices.io](https://microservices.io/patterns/communication-style/idempotent-consumer.html?utm_source=chatgpt.com))

[Microservices.io — Idempotent Consumer](https://microservices.io/patterns/communication-style/idempotent-consumer.html)

---

**AWS — Transactional Outbox Pattern**
解决 database + messaging dual-write，并指出 downstream consumers 仍需要 idempotency。([docs.aws.amazon.com](https://docs.aws.amazon.com/en_en/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html?utm_source=chatgpt.com))

[AWS — Transactional Outbox](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html)

---

## 4. 支付行业真实 Idempotency 案例

**Stripe — Idempotent requests**
Stripe API 支持 idempotency key、安全 retry、结果 replay，并检查相同 key 对应的参数是否一致。([docs.stripe.com](https://docs.stripe.com/api/idempotent_requests?utm_source=chatgpt.com))

[Stripe — Idempotent requests](https://docs.stripe.com/api/idempotent_requests)

---

**Stripe — Designing robust and predictable APIs with idempotency**
Stripe 对 timeout、retry 和幂等 API 设计的工程解释。([stripe.com](https://stripe.com/blog/idempotency?utm_source=chatgpt.com))

[Stripe — Idempotency engineering](https://stripe.com/blog/idempotency)

---

**Adyen — API idempotency**
Adyen 官方支持相同 idempotency key 的 payment retry，并详细定义 key scope、retention、concurrent duplicate、transient error 和 backoff。([docs.adyen.com](https://docs.adyen.com/development-resources/api-idempotency?utm_source=chatgpt.com))

[Adyen — API idempotency](https://docs.adyen.com/development-resources/api-idempotency)

---

**PayPal — Making API Requests**
PayPal 推荐 POST/PUT 使用 `PayPal-Request-Id`，并允许使用相同 request ID 安全 retry。([developer.paypal.com](https://developer.paypal.com/api/make-api-requests?utm_source=chatgpt.com))

[PayPal — Making API Requests](https://developer.paypal.com/api/make-api-requests)

---

## 5. 金融服务 / Agentic AI

**FINRA 2026 Regulatory Oversight Report — GenAI**
明确指出金融机构使用 GenAI 时既有监管义务仍适用，并建议 formal review/approval、governance、monitoring、agent action tracking 和 human-in-the-loop controls。([finra.org](https://www.finra.org/rules-guidance/guidance/reports/2026-finra-annual-regulatory-oversight-report/gen-ai?utm_source=chatgpt.com))

[FINRA — GenAI: Continuing and Emerging Trends](https://www.finra.org/rules-guidance/guidance/reports/2026-finra-annual-regulatory-oversight-report/gen-ai)

---

**Bank of England — Financial Stability in Focus: Artificial intelligence in the financial system**
讨论 AI 在金融机构的自动化、核心金融决策以及治理和金融稳定风险。([bankofengland.co.uk](https://www.bankofengland.co.uk/financial-stability-in-focus/2025/april-2025?utm_source=chatgpt.com))

[Bank of England — AI in the financial system](https://www.bankofengland.co.uk/financial-stability-in-focus/2025/april-2025)

---

**BIS Working Paper 1310 — AI agents for cash management in payment systems**
研究 GenAI agents 在 RTGS 高价值支付系统流动性管理中的表现，并指出监管 safeguards、human oversight 等必要性。([bis.org](https://www.bis.org/publications/working-paper-1310-ai-agents-cash-management-payment-systems?utm_source=chatgpt.com))

[BIS — AI agents for cash management in payment systems](https://www.bis.org/publications/working-paper-1310-ai-agents-cash-management-payment-systems)

---

## 6. 最终架构参考

可以把整篇文章最终浓缩成：

```text
                   Agent / LLM
                        │
                        ▼
               Durable Workflow
                        │
              at-least-once
              delivery/retry
                        │
                        ▼
                     Command
                        │
               stable operationId
                        │
                        ▼
           Idempotent Command Executor
                        │
              ┌─────────┴─────────┐
              │                   │
        existing result       first execution
              │                   │
              ▼                   ▼
          replay result       execute side effect
                                  │
                      ┌───────────┴───────────┐
                      │                       │
                   SUCCESS                 UNKNOWN
                      │                       │
                      │                  reconcile
                      │                       │
                      └──────────┬────────────┘
                                 ▼
                        Durable Business State
                                 │
                                 ▼
                               Audit
```

最终的核心原则可以浓缩成一句话：

> **让 Workflow 对“重复交付”保持宽容，让 Command Executor 对“重复业务效果”保持严格。**

这比试图让整个 Agent Workflow 获得一个跨数据库、消息队列、Worker 和外部金融系统的全局 exactly-once 语义，更符合成熟分布式系统和金融业务执行的实际约束。

而对于金融 Agent，最终真正值得平台级标准化的也不是某一个 LLM 或 Agent Framework，而是：

```text
Workflow State
+
Operation Identity
+
Command
+
Idempotency
+
Precondition
+
Reconciliation
+
Audit
```

一旦这层稳定下来，Agent 才可以在：

```text
支付
交易
Proxy Voting
Corporate Action
客户服务
运营自动化
```

等具有真实副作用的业务中获得可控的自治能力。

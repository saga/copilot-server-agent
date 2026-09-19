
# 金融服务领域 AI Agent 的 Command / Approval / Idempotency 安全执行模型

## 1. 引言

在金融业务中，AI Agent 最有价值的能力往往不是“回答问题”，而是参与真实业务操作：

```text id="qx9s8v"
Research
   ↓
Review
   ↓
Approve
   ↓
Publish
   ↓
Execute
```

一旦 Agent 能够产生真实业务副作用，系统就必须回答三个问题：

> **Command：到底准备执行什么？**

> **Approval：谁允许执行这个具体操作？**

> **Idempotency：如果重试、超时、宕机，如何确保不会把同一个副作用执行两次？**

这三个问题实际上构成了金融 Agent 从“AI 助手”走向“生产业务执行系统”的核心安全边界。

推荐的基本模型：

```text id="g82r4n"
Agent
  │
  │ proposal
  ▼
Command Intent
  │
  ▼
Policy
  │
  ├── DENY
  │
  ├── AUTO APPROVE
  │
  └── HUMAN APPROVAL
          │
          ▼
      Approval Record
          │
          ▼
      Re-validation
          │
          ▼
    Idempotency Gate
          │
          ▼
    Domain Validation
          │
          ▼
    Command Executor
          │
          ▼
   External / Business System
          │
          ▼
      Audit Evidence
```

核心原则：

> **Agent 提议操作，Policy 决定是否允许，Human 在需要时承担审批责任，Domain 验证业务合法性，Executor 保证副作用安全执行。**

AWS 当前 Agentic AI Lens 将工具授权、Human-in-the-loop、风险分级、Agent identity、idempotency 和 legacy integration reliability 都作为独立控制点；OWASP 则把 excessive functionality、excessive permissions 和 excessive autonomy 统一归入 Excessive Agency 风险。

---

# 2. 为什么普通 Tool Calling 不够

普通 Agent：

```text id="x5my5k"
LLM
 ↓
Tool Call
 ↓
Tool
 ↓
Result
```

对于：

```text id="vfo6h6"
search()
get_data()
calculate()
```

通常没有太大问题。

但是对于：

```text id="a8u1bd"
publish()
submit()
send()
approve()
execute()
transfer()
```

这已经不是普通的 Tool Call，而是：

```text id="k19lpj"
Business Side Effect
```

例如：

```text id="9u1dzt"
Agent:
    "publish investment idea #1234"
```

这句话不能直接映射：

```text id="a0m4nq"
publish()
```

因为系统还必须确认：

```text id="d1du9j"
谁发起？
什么 Case？
什么版本？
当前 Workflow 是什么？
当前用户是否有权限？
Agent 是否有 Capability？
是否需要审批？
谁批准？
批准的是不是同一个 Command？
业务对象现在是否仍然处于正确状态？
上一次是否已经执行？
```

因此：

> **高风险 Tool Call 应该先变成 Command Intent，再进入受控执行链。**

---

# 3. Command：把“Agent 想做什么”变成结构化业务意图

Command 的第一职责不是执行，而是：

> **定义一个具体、可验证、可审计的业务意图。**

例如不要保存：

```text id="8w8fku"
"Please publish this."
```

而应该：

```json id="c7n8yh"
{
  "commandType": "publish-investment-idea",
  "resourceType": "investment-idea",
  "resourceId": "1234",
  "parameters": {
    "channel": "internal"
  }
}
```

这样系统才能对它进行：

```text id="ow8j8k"
Validation
Hashing
Authorization
Approval
Idempotency
Audit
```

---

# 4. Command 不等于执行

必须严格区分：

```text id="x0q7fa"
Command Intent
```

和：

```text id="d76v9o"
Command Execution
```

Command Intent：

> “我要执行什么？”

Command Execution：

> “这个操作已经真正产生了业务副作用。”

例如：

```text id="e7xep2"
Agent
  ↓
CommandIntent
  ↓
Policy
  ↓
Approval
  ↓
CommandExecutor
  ↓
Published = true
```

这四层不能混在一起。

尤其不能：

```text id="4nizb9"
Agent Tool Call
=
Business Mutation
```

---

# 5. Command 的最小数据模型

建议至少包含：

```text id="g4g4s2"
Command
├── commandId
├── commandType
├── resourceType
├── resourceId
├── parameters
├── commandHash
├── executionId
├── workflowId
├── nodeId
├── actor
├── delegatedUser
├── expectedResourceVersion
├── createdAt
└── status
```

状态可以是：

```text id="gd9i3j"
PROPOSED
WAITING_FOR_APPROVAL
APPROVED
REJECTED
EXECUTING
SUCCEEDED
FAILED
STALE
CANCELLED
```

---

# 6. Command Hash 是非常重要的安全锚点

一个 Command 应该有 canonical representation：

```text id="p3p8s2"
Canonical Command
      ↓
SHA-256
      ↓
Command Hash
```

例如：

```text id="klx3x5"
commandHash =
    H(
      commandType +
      resourceType +
      resourceId +
      canonical(parameters)
    )
```

它解决的是：

> **审批、执行和审计所针对的是不是同一个操作？**

例如：

```text id="31u0zk"
Approve:

publish #1234
channel = internal
```

然后 Agent 改成：

```text id="q9p3b6"
publish #1234
channel = external
```

则：

```text id="z0w91l"
hash(v1) != hash(v2)
```

之前的 Approval 不应该继续有效。

---

# 7. Command Hash 不应该包含每次 Retry 都会变化的字段

不要把这些内容直接作为 Command identity：

```text id="eg6v2j"
timestamp
random request id
approval token
retry count
session id
```

否则：

```text id="gmbpr3"
Retry #1
→ hash A

Retry #2
→ hash B
```

系统就无法判断它们其实是同一个业务操作。

应该区分：

```text id="0cxfrk"
Business Command Identity
```

和：

```text id="d57qv0"
Execution Attempt Identity
```

例如：

```text id="t8p6uq"
Command Hash
    = operation identity

Attempt #
    = execution attempt
```

---

# 8. Approval：批准的是一个具体 Command

这是整个设计中最重要的一点：

> **Approval 不是“允许这个 Agent 做某类事情”，而是批准一个具体、可识别的业务操作。**

错误：

```text id="7hwpma"
Compliance:
    "I approve investment publication."
```

然后 Agent 可以：

```text id="39v61n"
publish #1234
publish #1235
publish #1236
```

正确：

```text id="b9jol3"
Approval
    commandType = publish-investment-idea
    resourceId = 1234
    commandHash = abc123
    caseVersion = 8
    policyVersion = 4
```

AWS 当前 Agentic AI Lens 特别强调，所谓 persistent trust 必须绑定到 specific command、parameter shape 或 resource，不能提供 wildcard trust，否则实际上等于取消了后续 Human Oversight。

---

# 9. Approval 不是 Authorization

这两个概念必须分开。

### Approval

回答：

> 人有没有对这个具体操作做出正式决定？

### Authorization

回答：

> 这个人是否有资格做出这个决定？

例如：

```text id="bq9oat"
User A:
    clicks Approve
```

不代表：

```text id="5lqd84"
approval = valid
```

系统仍然需要：

```text id="zoqt4o"
User A
  ↓
Role
  ↓
Policy
  ↓
Can approve this command?
```

因此：

```text id="u0x0zt"
Human Approval
+
Authorization
```

两者缺一不可。

---

# 10. Approval Record 的最小模型

建议保存：

```text id="1cx6on"
Approval
├── approvalId
├── commandHash
├── commandId
├── executionId
├── workflowId
├── nodeId
├── caseVersion
├── resourceVersion
├── policyVersion
├── reviewerId
├── reviewerRole
├── decision
├── reason
├── createdAt
├── decidedAt
├── expiresAt
└── status
```

这样未来可以回答：

```text id="y4m2oc"
谁批准的？
以什么身份？
批准了什么？
批准的是哪个版本？
当时采用什么 Policy？
批准是否已经过期？
```

---

# 11. Approval 必须有 Scope

推荐把 Approval 看成：

```text id="ws0hyn"
Grant(
    actor,
    command,
    resource,
    parameters,
    version,
    policy
)
```

而不是：

```text id="s6gqkn"
Grant(
    "permission to publish"
)
```

例如：

```text id="8wmn8s"
ALLOW:

command = publish-investment-idea
resource = InvestmentIdea#1234
parameter = channel: internal
version = 8
```

而不是：

```text id="fvgw9z"
ALLOW:
    publish-investment-idea/*
```

这直接对应 AWS 对 bounded persistent trust 的建议。

---

# 12. Approval 必须有有效期

高风险 Approval 不应该永久有效：

```text id="w1ew9x"
Approved today
→ execute three months later
```

不合理。

至少应该考虑：

```text id="9zyyim"
expiresAt
```

或者：

```text id="0b1otm"
valid until:
    Case version changes
    Policy version changes
    Resource version changes
    Time window expires
```

高风险动作尤其应该要求重新确认。

AWS 当前明确建议高风险操作不要使用无限期 persistent trust，而应要求重新确认并让授权可撤销、可审计。

---

# 13. Approval 的生命周期

推荐：

```text id="wslkvl"
PROPOSED
   │
   ▼
WAITING_FOR_APPROVAL
   │
   ├── APPROVED
   │      │
   │      ▼
   │   EXECUTABLE
   │
   ├── REJECTED
   │
   ├── EXPIRED
   │
   └── CANCELLED
```

如果 Command 内容发生变化：

```text id="e13fg7"
APPROVED
   ↓
COMMAND CHANGED
   ↓
STALE
```

不能继续执行。

---

# 14. Approval 后为什么还要 Re-validation

一个常见错误：

```text id="g48e6x"
Human approves
     ↓
execute()
```

中间可能已经发生：

```text id="s3f4nk"
Resource changed
Policy changed
Workflow changed
User role changed
Approval revoked
Command changed
Risk changed
```

因此真正执行之前必须再次验证。

推荐：

```text id="cnp3f1"
Approval
   ↓
Re-validation
   ├── current workflow node
   ├── command hash
   ├── resource version
   ├── policy
   ├── reviewer authorization
   ├── approval status
   └── expiry
   ↓
Execute
```

---

# 15. Resource Version 是 Approval 的第二根安全锚

假设：

```text id="c0vc53"
InvestmentIdea #1234
version = 8
```

Compliance 批准。

随后：

```text id="e7d8n9"
version = 9
```

因为其他人修改了数据。

此时：

```text id="4odg4e"
Approval(version 8)
```

不能直接支持：

```text id="vmr2nw"
Execute(version 9)
```

应该：

```text id="7rsv6u"
resourceVersion mismatch
        ↓
STALE
        ↓
re-review
```

这类控制通常通过 optimistic locking / conditional writes 实现。AWS DynamoDB 官方文档明确使用 version + conditional write 检测并发更新冲突。

---

# 16. Approval + Hash + Resource Version 的关系

三者解决三个不同问题：

```text id="d9u9f7"
Command Hash
    → 你批准的到底是什么？

Resource Version
    → 你批准时业务对象是哪一个版本？

Policy Version
    → 当时根据什么授权规则批准？
```

因此：

```text id="v0k6d2"
Approval
├── commandHash
├── resourceVersion
└── policyVersion
```

构成一个非常强的审计边界。

---

# 17. Idempotency：真正困难的地方

分布式系统永远会出现：

```text id="apfjc2"
Request sent
   ↓
Server executes
   ↓
Response lost
   ↓
Client thinks failed
   ↓
Retry
```

例如：

```text id="3vwlv0"
publish()
```

第一次其实已经成功。

第二次 Retry 如果再次执行：

```text id="0d9e3l"
duplicate side effect
```

金融系统尤其不能接受：

```text id="4v31bj"
double publish
double submit
double send
double trade
double payment
```

Amazon Builders' Library 把这个问题作为分布式系统的基础问题：为了让调用者能够安全重试，服务端需要提供 idempotent API，并把请求标识与执行副作用的记录可靠地关联起来。

---

# 18. Idempotency 的正确理解

一个操作具有 Idempotency，意味着：

```text id="x0d1by"
execute(X)
execute(X)
execute(X)
```

最终业务效果等价于：

```text id="ak4peo"
execute(X)
```

而不是：

```text id="1w2zqj"
execute X
+
execute X again
+
execute X again
```

---

# 19. Idempotency Key 应该代表业务操作

推荐：

```text id="l4qz9e"
idempotencyKey =
    executionId + ":" + commandHash
```

例如：

```text id="0h6j5h"
exec-84721:sha256-abc123
```

这样：

```text id="w3r8b1"
Retry #1
Retry #2
Retry #3
```

都指向：

```text id="st7x3j"
同一个 business operation
```

而不是每次 Retry 新生成：

```text id="cni4t9"
UUID()
```

Stripe 的公开 API 就采用这一思路：客户端为同一请求提供 Idempotency-Key，服务端保存第一次执行结果；后续使用相同 key 的请求返回同一结果，并且如果相同 key 对应的参数不同则报错，以防止 key 被误复用。

---

# 20. Idempotency Key 不应该等于 Request ID

这两个东西职责不同：

```text id="7r8g7k"
Request ID
    = this network request

Idempotency Key
    = this business operation
```

例如：

```text id="y6adkb"
Request 1
    requestId = abc

Request 2
    requestId = def

Request 3
    requestId = ghi
```

可能都是：

```text id="x6p9yd"
idempotencyKey = exec-84721:commandHash
```

这样即使请求发生重试：

```text id="4orv1v"
business operation = same
```

系统仍然能够识别。

---

# 21. Idempotency Key 必须和参数绑定

一个非常危险的错误：

```text id="hpl1ck"
Key:
    operation-123
```

第一次：

```text id="ocqg1l"
amount = 100
```

第二次：

```text id="8y8y41"
amount = 1000
```

如果系统只看 Key：

```text id="v4swk6"
→ accidentally treat as same operation
```

Stripe 明确会比较重用 Idempotency Key 时的参数，并在参数不一致时返回错误。

因此：

```text id="iwtgw3"
Idempotency Key
+
Command Fingerprint
```

应该绑定。

---

# 22. 推荐的 Idempotency Record

可以建立：

```text id="n7qvgu"
IdempotencyRecord
├── key
├── commandHash
├── requestFingerprint
├── status
├── startedAt
├── completedAt
├── result
├── error
└── expiresAt
```

状态：

```text id="om3cyz"
IN_PROGRESS
SUCCEEDED
FAILED_RETRYABLE
FAILED_FINAL
```

---

# 23. 第一次请求发生什么

```text id="h3pk8r"
Request
   ↓
Idempotency Key
   ↓
Check Record
   ↓
Not Found
   ↓
Create IN_PROGRESS
   ↓
Execute
   ↓
Persist Result
   ↓
SUCCEEDED
```

---

# 24. 第二次请求同时到达怎么办

例如：

```text id="zfo4qd"
Request A ─────┐
               ├── same idempotencyKey
Request B ─────┘
```

必须保证只有一个请求能够成功“claim”。

例如数据库：

```text id="tjfgo9"
INSERT idempotency_record
WHERE key = X
```

利用：

```text id="zdd7wu"
UNIQUE(key)
```

或者 conditional write。

一个请求：

```text id="lc7f3d"
→ owns execution
```

另一个：

```text id="8lv6wl"
→ sees IN_PROGRESS
```

不能让两个 Worker 都认为自己是 owner。

AWS 的 Builders' Library 强调 idempotent request token 的记录与真正 mutation 之间需要可靠的一致性保证；如果二者脱节，会出现“记录了 token 但没完成操作”或“操作已经完成但 token 没记录”的竞态。

---

# 25. 最危险的时间窗口

最典型的失败：

```text id="9v6tlh"
1. create idempotency record
2. execute external API
3. external API succeeds
4. process crashes
5. result not persisted
```

恢复后：

```text id="7o1ptb"
Should we retry?
```

系统不知道：

```text id="we37w7"
External operation happened or not?
```

这就是 distributed systems 中最难处理的：

> **unknown outcome**

---

# 26. 为什么单靠 Workflow 不足以解决这个问题

即使 Workflow 自己是：

```text id="8dy1fl"
durable
exactly-once
```

也不一定意味着：

```text id="y39zcn"
external API side effect
```

exactly once。

AWS Step Functions Standard Workflow 的状态机本身提供 exactly-once execution semantics，但只要你显式配置 Retry，Task 仍然可能重新执行。AWS 同时明确建议对可能重复执行的流程使用幂等操作。

Microsoft Durable Task 则明确采用 at-least-once activity execution，并要求 activity 尽量设计成 idempotent。

所以：

> **Workflow Execution Semantics ≠ Business Side-Effect Semantics**

这是整个设计最重要的结论之一。

---

# 27. 不要追求“分布式系统绝对 Exactly Once”

对于跨系统操作：

```text id="q1lu9e"
Workflow DB
     ↓
HTTP
     ↓
External System
```

很难仅靠 Workflow 保证真正的：

```text id="8i3vck"
exactly-once side effect
```

更实际的设计是：

```text id="e4d3v1"
Durable Workflow
+
Idempotent Command Executor
+
Downstream Idempotency
+
Reconciliation
```

AWS Durable Execution 文档也明确指出，即使 at-most-once per retry，也不能自动推出整个 Workflow 的 exactly-once；如果真正需要避免重复副作用，需要根据 side effect 选择 retry semantics 和 idempotency。

---

# 28. 三种副作用类型

建议把 Command 分成三类。

## A. Naturally Idempotent

例如：

```text id="lgbn0w"
PUT resource state = X
upsert record
set status = APPROVED
```

重复执行结果相同。

可以：

```text id="fa7vx2"
at-least-once + retry
```

---

## B. Idempotent via Idempotency Key

例如：

```text id="d2arj2"
submit payment
publish document
create external order
```

下游提供：

```text id="35urh0"
Idempotency-Key
```

则：

```text id="q1g0ve"
at-least-once
+
downstream dedupe
```

通常是非常实用的方案。

Stripe 的 API 就采用服务端保存结果、同 key 返回原结果的模式。

---

## C. Non-idempotent External Side Effect

例如某些：

```text id="w4pkn8"
one-shot message
legacy POST
external trading gateway
physical action
```

如果下游没有 idempotency 能力，就存在 unknown outcome。

此时可以考虑：

```text id="w2w9j2"
no automatic retry
+
manual reconciliation
```

或者：

```text id="d6lp6l"
outbox / transaction boundary
+
downstream acknowledgement
```

但不能假装：

```text id="qzhe3x"
"Exactly once guaranteed"
```

---

# 29. 推荐的执行模式

对于金融业务，推荐：

```text id="1r2k7i"
          Command
             │
             ▼
       Authorization
             │
             ▼
         Approval
             │
             ▼
       Re-validation
             │
             ▼
       Idempotency Gate
             │
             ▼
       Domain Validation
             │
             ▼
       Durable Executor
             │
             ▼
    External Idempotent API
```

其中真正不可逆的副作用：

```text id="3u0teq"
必须有 downstream idempotency
```

---

# 30. Command Executor 应该成为真正的安全边界

不建议：

```text id="5djgup"
Agent
   ↓
HTTP Client
   ↓
External API
```

应该：

```text id="9yd7hp"
Agent
   ↓
Command Intent
   ↓
Policy
   ↓
Command Executor
   ↓
Idempotency
   ↓
External API
```

Executor 的责任包括：

```text id="s2aex1"
authorization context
validation
idempotency
resource version
external request
result persistence
audit
```

因此：

> **CommandExecutor 是真正的 Side-effect Boundary。**

---

# 31. Domain Validation 应在真正执行前发生

例如：

```text id="l9tl7x"
Approval:
    PASS
```

但 Domain 当前状态：

```text id="f2l7f8"
InvestmentIdea.status = REJECTED
```

不能执行。

推荐：

```text id="15yq0c"
Policy
   ↓
Approval
   ↓
Idempotency
   ↓
Domain Validation
   ↓
Execute
```

Domain 应检查：

```text id="3tq8gz"
state
invariants
resource version
business constraints
```

---

# 32. 最好让 Domain Mutation 与 Idempotency Record 尽可能处于同一个事务边界

对于内部数据库操作，理想：

```text id="8bo0gz"
BEGIN TRANSACTION

1. claim idempotency key
2. verify resource version
3. validate business state
4. mutate business state
5. persist execution result

COMMIT
```

这样可以避免：

```text id="7au8de"
Idempotency record
```

和：

```text id="v8yvdg"
Business mutation
```

彼此不一致。

AWS Builders' Library 对 idempotent API 的建议也强调：记录 idempotency token 与相关 mutation 应具备 ACID 性质，避免只记录 token 却没有成功完成 mutation，或反过来。

---

# 33. External API 无法共享事务怎么办

这是最常见的情况：

```text id="4vcz3v"
Our DB
     ↓
HTTP
     ↓
External System
```

不能：

```text id="72t93v"
BEGIN local transaction
HTTP external
COMMIT
```

来实现分布式原子性。

更实际：

```text id="bpn3kz"
Local Command Record
      ↓
Outbox / Durable Executor
      ↓
External API with idempotency key
      ↓
Persist external result
      ↓
Reconciliation if unknown
```

核心不是追求跨系统 ACID，而是：

> **把不确定性显式建模。**

---

# 34. Unknown Outcome 必须是一个正式状态

不要只有：

```text id="2g5z1d"
SUCCESS
FAILED
```

应该支持：

```text id="tdxp9q"
UNKNOWN
```

例如：

```text id="v5qf8e"
External API request sent
   ↓
network timeout
   ↓
UNKNOWN
```

此时系统不能：

```text id="d70ys8"
blind retry
```

而应该：

```text id="3vtxj8"
reconcile
   ↓
query external system by idempotency key
   ↓
FOUND → success
NOT FOUND → retry
```

这是金融业务非常值得显式建模的状态。

---

# 35. Idempotency + Reconciliation

推荐：

```text id="h56nm4"
EXECUTING
   │
   ├── SUCCESS → SUCCEEDED
   │
   ├── KNOWN FAILURE → FAILED
   │
   └── UNKNOWN
          │
          ▼
      RECONCILING
          │
       ┌──┴──┐
       ▼     ▼
    FOUND  NOT FOUND
       │       │
   SUCCESS    RETRY
```

Google Cloud 关于 at-least-once 事件处理也明确建议：使用 event ID / idempotency key、在事务中检查状态，并对 duplicate calls 进行处理和 reconciliation。

---

# 36. Approval Callback 也必须 Idempotent

不仅 Command Execute 会重复：

```text id="9z5y5f"
Approve callback
```

也可能重复。

例如：

```text id="ul3f0l"
Reviewer clicks Approve
   ↓
network timeout
   ↓
UI retries
   ↓
second callback
```

必须保证：

```text id="nqv7j1"
same approval
```

不会：

```text id="cx9pn3"
advance workflow twice
```

Microsoft Agent Framework 的 HITL 模型把 pending request 与 checkpoint 一起持久化，并在恢复时重新发出 pending request；AWS Step Functions 的 callback pattern 则使用 Task Token 暂停和恢复 Workflow。

但在金融业务系统中，不应仅凭 callback token 推进状态；还应该验证当前 Workflow / Task / Approval 状态。

---

# 37. Approval Callback 的安全检查

推荐：

```text id="z6x8yo"
callback
   ↓
Find approval
   ↓
check approval status == PENDING
   ↓
check reviewer identity
   ↓
check reviewer authorization
   ↓
check commandHash
   ↓
check executionId
   ↓
check current node
   ↓
check resourceVersion
   ↓
check policyVersion
   ↓
transition atomically
```

如果任意条件不满足：

```text id="kvl8zi"
STALE / INVALID
```

而不是：

```text id="h7r2xo"
continue
```

---

# 38. Approval Transition 本身需要 CAS

例如：

```text id="j4w32k"
UPDATE human_task
SET status = 'APPROVED'
WHERE task_id = ?
  AND status = 'PENDING'
```

这样：

```text id="mkh46l"
Request A
Request B
```

只有一个可以把：

```text id="x9hv8z"
PENDING → APPROVED
```

另一个得到：

```text id="g24b0p"
already processed
```

AWS 的 conditional write / optimistic locking 是同类机制：通过条件检查确保并发更新不会覆盖或重复推进状态。

---

# 39. Workflow CAS 与 Command Idempotency 是两个不同问题

这两个经常被混淆。

### Workflow CAS

解决：

> **两个 Worker 能不能同时推进 Workflow？**

例如：

```text id="eq0t1x"
workflowVersion = 8
```

只有持有 version 8 的 Worker 才能更新成 9。

### Command Idempotency

解决：

> **同一个业务副作用能不能执行两次？**

例如：

```text id="l3c6m8"
idempotencyKey = exec-123:hash-abc
```

两者应该同时存在。

```text id="ubk1u8"
Workflow CAS
    +
Command Idempotency
```

不能互相替代。

---

# 40. 一个完整执行状态机

推荐：

```text id="hzw3fu"
PROPOSED
   │
   ▼
CLASSIFYING
   │
   ├── DENIED ─────────→ REJECTED
   │
   ├── AUTO_APPROVED ──┐
   │                    │
   └── NEEDS_APPROVAL ──┘
                        │
                        ▼
                WAITING_FOR_APPROVAL
                        │
                ┌───────┴────────┐
                │                │
             REJECT           APPROVE
                │                │
                ▼                ▼
             REJECTED       REVALIDATING
                                 │
                           ┌─────┴──────┐
                           │            │
                        INVALID       VALID
                           │            │
                           ▼            ▼
                         STALE      IDEMPOTENCY
                                       │
                                       ▼
                                    EXECUTING
                                       │
                              ┌────────┼────────┐
                              │        │        │
                           SUCCESS   FAILED   UNKNOWN
                              │        │        │
                              ▼        ▼        ▼
                          COMPLETED  FAILED  RECONCILING
```

---

# 41. 为什么 `APPROVED` 不是 `EXECUTABLE`

这是一个很重要的建模区别。

```text id="3jgkvo"
APPROVED
```

表示：

> 人做出了允许执行的决定。

但：

```text id="8knt2p"
EXECUTABLE
```

意味着：

> 现在这一刻仍然满足所有执行条件。

中间可能发生：

```text id="r1k7kr"
resource changed
policy changed
approval expired
workflow changed
command changed
domain state changed
```

因此：

```text id="v4spjv"
APPROVED
    ↓
REVALIDATE
    ↓
EXECUTABLE
```

这是金融领域尤其应该保留的边界。

---

# 42. Approval 不应该成为长期 Permission

错误：

```text id="2n15qh"
Compliance approved:
    "Agent may publish investment ideas."
```

这相当于创建长期权限。

正确：

```text id="rm6ljy"
Compliance approved:
    CommandHash=abc123
    Resource=1234
    Version=8
```

这只是：

```text id="7esv01"
one bounded execution authorization
```

而不是：

```text id="g3w8ak"
Agent Permission Grant
```

---

# 43. Auto-Approval 也应该走同一套 Command 模型

低风险 Command：

```text id="q3n0vy"
classify()
   ↓
AUTO_APPROVE
```

并不意味着：

```text id="3z8jwu"
skip authorization
```

仍然必须：

```text id="1w7fyu"
Capability
+
Policy
+
Workflow
+
Domain
+
Idempotency
```

只是：

```text id="kn8p0u"
Human Approval
```

这一环可以跳过。

所以：

```text id="0r6s1z"
Auto Approval
≠
No Control
```

而是：

```text id="8j5gqr"
Deterministic Approval Policy
```

---

# 44. 高风险 Command 不应支持无限期 Auto-Approval

例如：

```text id="zjhw1x"
"Always approve publish-investment-idea"
```

这种 wildcard trust 会把：

```text id="7f00j8"
Human Approval
```

实际上删除。

AWS 当前明确反对没有 command/resource/parameter scope 的 wildcard persistent trust。

更合理：

```text id="6ahhwq"
Auto approval only if:
    command = internal-draft-save
    resource = user's own draft
    risk = low
```

---

# 45. Idempotency Key 的生命周期也需要治理

Idempotency 不能简单永久保存：

```text id="f6jw7j"
every key forever
```

因为数据库会无限增长。

但也不能太短：

```text id="6d7d3q"
5 minutes
```

如果：

```text id="hy0e4w"
workflow waits 2 days
```

Retry 可能已经失去保护。

因此 TTL 应根据：

```text id="bf0p4s"
maximum retry window
+
workflow duration
+
external reconciliation window
+
business risk
```

决定。

Stripe 的实现允许服务器在至少 24 小时后自动移除 Idempotency Key，并且 key 被回收后重新使用会被视为新的请求；这是具体 API 的选择，而不是通用规则。

所以金融业务不要机械复制 Stripe 的 24 小时，而应该根据自身风险定义。

---

# 46. Idempotency Key 不应该永远等于 Workflow Execution ID

例如：

```text id="kxnj4r"
executionId = exec-123
```

如果 Workflow 中有：

```text id="hyci5g"
publish
```

和：

```text id="u06j0j"
send-email
```

它们必须拥有不同的 idempotency identity。

因此：

```text id="ss4u6h"
executionId
+
command identity
```

更合理。

例如：

```text id="z5r8zv"
exec-123:publish:hash-abc
exec-123:send:hash-def
```

---

# 47. 同一个 Command 是否应该跨 Workflow 去重

一般不建议简单使用：

```text id="e1j0b0"
commandHash
```

作为全局 Idempotency Key。

因为两个不同业务 Case 可能合法地产生完全相同的 Command：

```text id="z8jv1p"
Case A:
publish internal

Case B:
publish internal
```

业务上是两个不同操作。

因此常见选择：

```text id="fcd2sf"
executionId + commandHash
```

如果业务要求跨 Execution 去重，则应该引入明确的：

```text id="f2x8k7"
business operation ID
```

不能无意中把两个合法业务操作当成重复请求。

---

# 48. Idempotency Scope 应该由业务语义决定

例如：

### 创建资源

```text id="4ed9ae"
customer-request-id
```

### 发布 Case

```text id="s7c5p7"
case-id + operation
```

### 支付

```text id="tz9z8t"
payment-order-id
```

### 交易

```text id="xx2f9v"
business-order-id
```

因此：

> **Idempotency Key 不是一个技术字段，而是业务操作身份。**

---

# 49. Command Hash 与 Idempotency Key 也不是同一个东西

推荐区分：

```text id="6d21kp"
Command Hash
    = 内容指纹

Idempotency Key
    = 操作身份
```

例如：

```text id="a2z5bd"
commandHash:
    sha256(canonical-command)

idempotencyKey:
    executionId + ":" + commandHash
```

这样：

```text id="ljf4vb"
same content
different business execution
```

可以有不同 idempotency key。

---

# 50. Executor 必须返回稳定的语义结果

不要：

```text id="f0f6jv"
first call:
    success

retry:
    "already exists"
```

然后让上层自己猜：

```text id="3f8jgj"
Is this success or failure?
```

更好的 contract：

```ts id="7n67r9"
interface CommandExecutionResult {
  ok: boolean;
  commandType: string;
  output?: unknown;
  error?: string;
  idempotentReplay?: boolean;
}
```

例如：

```json id="x43v7m"
{
  "ok": true,
  "idempotentReplay": true,
  "output": {
    "resourceId": "1234"
  }
}
```

表示：

> 这次请求没有重新执行，但返回的是之前执行产生的同一个业务结果。

Stripe 采用的也是保存第一次请求结果并让相同 key 的后续请求得到一致结果的模式。

---

# 51. “Already Executed” 不应该算异常

例如：

```text id="5w1pe7"
Retry
   ↓
same idempotency key
   ↓
previous success exists
```

应该：

```text id="fvx0or"
return previous result
```

而不是：

```text id="q7qv9e"
throw DuplicateExecutionError
```

对于业务调用方来说：

```text id="sc7w29"
same successful business effect
```

通常应该被视为成功。

---

# 52. 参数变化则必须报冲突

另一种情况：

```text id="7d8a6e"
same key
different commandHash
```

不能：

```text id="xf5j12"
execute new command
```

也不能：

```text id="r1j3p8"
return old result silently
```

应该：

```text id="6j5zfg"
IDEMPOTENCY_CONFLICT
```

Stripe 对这一点有明确实践：同一 Idempotency Key 如果参数与首次请求不一致，会报错，而不会把它当作同一个操作。

---

# 53. Command 的最终执行链

推荐最终采用：

```text id="r4ppgk"
              LLM / Agent
                    │
                    ▼
              Command Intent
                    │
                    ▼
          Canonicalize + Hash
                    │
                    ▼
            Workflow Validation
                    │
                    ▼
               Policy
            ┌───────┼────────┐
            │       │        │
          DENY    AUTO     HUMAN
                    │        │
                    │       Approval
                    │        │
                    └───┬────┘
                        ▼
                 Re-validation
                        │
                        ▼
                Idempotency Gate
                        │
                        ▼
                Domain Validation
                        │
                        ▼
                  Executor
                        │
                 ┌──────┴──────┐
                 ▼             ▼
            Internal DB    External API
                              │
                        idempotency key
                              │
                              ▼
                         Result Store
                              │
                              ▼
                            Audit
```

---

# 54. 金融场景：Investment Idea Publish

假设：

```text id="8axmcd"
@command publish
```

Agent 产生：

```json id="28yqje"
{
  "commandType": "publish-investment-idea",
  "resourceId": "1234",
  "parameters": {
    "audience": "internal"
  }
}
```

---

## Step 1：Canonicalize

```text id="yqskj4"
canonical =
    publish-investment-idea
    + 1234
    + audience=internal
```

得到：

```text id="rg5zds"
hash = ABC123
```

---

## Step 2：Workflow Check

```text id="forx4j"
currentNode = publish
```

允许产生这个 Command。

---

## Step 3：Policy

检查：

```text id="7l0d6k"
User role
Agent capability
Portfolio scope
Workflow context
Risk tier
Approval requirement
```

结果：

```text id="0wqmh1"
REQUIRE_APPROVAL
```

---

## Step 4：Human Approval

Compliance：

```text id="au7d8o"
APPROVE
```

记录：

```text id="r5teh1"
commandHash = ABC123
resourceVersion = 8
policyVersion = 4
reviewer = User B
```

---

## Step 5：Resume

Workflow 恢复：

```text id="3so3po"
check:
    same node?
    same hash?
    same version?
    approval valid?
    policy valid?
```

---

## Step 6：Idempotency

生成：

```text id="v0aw5g"
exec-84721:ABC123
```

---

## Step 7：Domain Validation

检查：

```text id="v3s77x"
status == APPROVED
version == 8
not already published
```

---

## Step 8：Execute

调用：

```text id="3n9xxf"
publish()
```

如果外部系统支持：

```http
Idempotency-Key: exec-84721:ABC123
```

---

## Step 9：Retry

如果网络超时：

```text id="v7nr7t"
same idempotency key
```

再次调用。

外部系统返回：

```text id="zmthgr"
previous result
```

最终只有一次真实 Publish。

---

# 55. 一个非常重要的边界：Retry ≠ Re-approval

这两个必须区分。

### Retry

同一个 Command：

```text id="6c1rwi"
same hash
same parameters
same resource
same approval
```

应该：

```text id="z6q0oo"
reuse same approval
reuse same idempotency key
```

### Re-approval

Command 或安全上下文发生变化：

```text id="ma27fi"
resourceVersion changed
policy changed
command changed
approval expired
approval revoked
```

应该：

```text id="h61iwm"
new approval
```

甚至：

```text id="x6f7v2"
new command hash
```

这两个概念绝对不能混为：

```text id="7l14g1"
"只要失败了就重新审批"
```

也不能：

```text id="3q7iaa"
"只要批准过一次，未来都不用再审"
```

---

# 56. Re-approval 必须保持原 Authorization Boundary

这一点对当前项目特别重要。

例如：

```text id="u4n1m2"
@command publish
role: investment.reviewer
```

第一次：

```text id="3lmt7p"
restrictRoles = ["investment.reviewer"]
```

如果执行过程中因为：

```text id="z2y0v6"
resourceVersion mismatch
```

需要重新审批。

不能：

```text id="1m7x9h"
reapprove()
    → base command policy
```

然后把：

```text id="t7y0w2"
investment.reviewer
```

这个 Workflow 约束丢掉。

正确：

```text id="75n5n2"
reapprove()
    → same restrictRoles
    → same command boundary
    → new approval
```

核心原则：

> **Re-approval 是重新确认同一个授权边界内的 Command，而不是重新定义授权边界。**

---

# 57. Command Hash 与 Resource Version 一起解决 TOCTOU

典型问题：

```text id="g56x7v"
Time T1:
    inspect resource

Time T2:
    approve

Time T3:
    resource changed

Time T4:
    execute
```

如果没有 version：

```text id="0xv3qp"
批准的是 T1
执行的是 T3
```

这就是典型的 TOCTOU：

```text id="f0q3h8"
Time Of Check
       ≠
Time Of Use
```

因此：

```text id="2uw3gc"
Command Hash
+
Expected Resource Version
```

应在执行前再次验证。

AWS 的 optimistic locking 正是通过写入时检查 version，确保应用更新的对象仍然是它之前读到的那个版本。

---

# 58. Command Executor 的最小契约

推荐：

```ts id="p5j3a8"
interface CommandExecutionContext {
  executionId: string;
  sessionId?: string;
  idempotencyKey: string;
  actor: string;
}

interface CommandExecutionResult {
  ok: boolean;
  commandType: string;
  output?: unknown;
  error?: string;
  idempotentReplay?: boolean;
}

interface CommandExecutor {
  commandType: string;

  /**
   * The same idempotencyKey must not create
   * a second external side effect.
   */
  execute(
    intent: CommandIntent,
    ctx: CommandExecutionContext,
  ): Promise<CommandExecutionResult>;
}
```

其中：

```text id="clj0fs"
idempotencyKey
```

不是可选的“性能优化”。

对于有副作用的 Command：

> **它应该是执行契约的一部分。**

---

# 59. Executor 不应该假设 Workflow 会帮它保证 Exactly Once

错误：

```text id="rhquv3"
CommandExecutor:
    "Workflow says this runs once,
     so I don't need idempotency."
```

因为：

```text id="8wtl6g"
Worker crash
Network timeout
Manual retry
Process replay
Message duplicate
```

都可能再次触发 Executor。

Microsoft Durable Task 明确指出 Activity 为 at-least-once，因此 Activity 应尽可能幂等；AWS Durable Execution 同样指出 retry/replay 可能重复执行 side effect。

---

# 60. 为什么“单机锁”不够

例如：

```text id="4dyc26"
Map<string, Promise>
```

可以防止：

```text id="h6n4yb"
同一个 Node.js process
```

里的重复调用。

但是 K8s：

```text id="cbp7tl"
Pod A
Pod B
Pod C
```

之间完全不知道这个 Map。

因此：

> **跨进程 Idempotency 必须依赖 durable shared state。**

例如：

```text id="zwv7a0"
PostgreSQL
Redis + durable record
DynamoDB
External system
```

具体实现取决于一致性要求。

---

# 61. 不要一开始就上复杂 Distributed Lock

很多系统看到：

```text id="z62p42"
double execution
```

马上想：

```text id="du8zy0"
distributed lock
Redlock
consensus
lease
...
```

通常不是第一选择。

更实际：

```text id="an3uu7"
Durable Idempotency Record
+
Unique Constraint
+
Optimistic Concurrency
+
Downstream Idempotency
```

只有确实需要：

```text id="n2mxl5"
exclusive ownership
long-lived resource lock
```

时，才引入 distributed lock。

AWS DynamoDB 官方也把 optimistic locking 定位为低冲突、重试成本较低场景的实用方式，并将 pessimistic locking 作为高争用或需要互斥时的选择。

---

# 62. Approval + Idempotency 的完整关系

可以理解成：

```text id="s6t28a"
Approval
    = "Can this exact operation proceed?"

Idempotency
    = "Has this exact operation already produced its effect?"

Domain Validation
    = "Is this operation still valid?"

Workflow
    = "Is this operation occurring at the correct step?"
```

所以一次安全执行：

```text id="jl1lh6"
Workflow
    AND
Policy
    AND
Approval
    AND
Idempotency
    AND
Domain
```

全部正确才能执行。

---

# 63. 最终推荐的执行模型

```text id="e6b2e8"
                  Agent
                    │
                    ▼
              Command Intent
                    │
                    ▼
            Canonical Command
                    │
                    ▼
               Command Hash
                    │
                    ▼
                Workflow
                    │
                    ▼
                 Policy
             ┌──────┼──────┐
             │      │      │
           DENY   AUTO    HUMAN
                    │       │
                    │    Approval
                    │       │
                    └──┬────┘
                       ▼
                  Re-validation
                       │
           ┌───────────┼────────────┐
           │           │            │
        Hash OK    Version OK   Policy OK
           │           │            │
           └───────────┼────────────┘
                       ▼
                Idempotency Gate
                       │
               ┌───────┴────────┐
               │                │
          Already Done       New Operation
               │                │
               ▼                ▼
        Return Result      Domain Validation
                                 │
                                 ▼
                            Execute
                                 │
                    ┌────────────┴─────────────┐
                    │                          │
              Internal Domain           External System
                    │                          │
             atomic mutation            idempotency key
                    │                          │
                    └────────────┬─────────────┘
                                 ▼
                              Audit
```

---

# 64. 这个模型为什么适合金融业务

它把四个经常混在一起的问题分开：

```text id="5n9a1g"
Authorization
    "Can I?"

Approval
    "Human said yes?"

Validity
    "Is it still legal/business-valid?"

Idempotency
    "Did it already happen?"
```

例如：

```text id="j20a5k"
Policy = ALLOW
Approval = APPROVED
Domain = VALID
Idempotency = ALREADY_EXECUTED
```

最终：

```text id="5m7e3d"
DO NOT execute again
RETURN previous result
```

再例如：

```text id="vh8aob"
Policy = ALLOW
Approval = APPROVED
Domain = INVALID
```

最终：

```text id="6c6r27"
REJECT
```

再例如：

```text id="u9ar41"
Policy = DENY
Approval = APPROVED
```

最终仍然：

```text id="9b6b1m"
REJECT
```

因为：

> Human Approval 不能覆盖 Policy。

---

# 65. 当前项目的推荐映射

当前项目的结构非常适合实现这套模型：

```text id="yh8ql8"
@task
   │
   ▼
AI produces CommandIntent
   │
   ▼
ExecutionService.proposeCommand()
   │
   ▼
CommandService.classify()
   │
   ├── DENIED
   ├── AUTO_APPROVED
   └── NEEDS_APPROVAL
             │
             ▼
       HumanTaskService
             │
             ▼
        Approval Record
             │
             ▼
       WorkflowRunner.resume
             │
             ▼
   Revalidate workflow / approval
             │
             ▼
 ExecutionService.runCommand()
             │
             ▼
      CommandExecutor
             │
             ▼
        External API
```

---

# 66. 当前项目应该坚持的 Command 不变量

### 1. Command Hash 不变

同一个业务操作的 retry：

```text id="ymwd52"
same commandHash
```

---

### 2. Idempotency Key 不变

同一个 Command 的 retry：

```text id="2rpv8q"
same idempotencyKey
```

---

### 3. Approval 不因为 Retry 自动失效

只要：

```text id="3jt0fb"
same command
same resource version
same policy boundary
```

就可以继续。

---

### 4. Command 内容变化必须产生新的 Hash

```text id="m3t3ko"
parameters changed
→ new hash
→ old approval invalid
```

---

### 5. Resource Version 变化必须触发重新验证

```text id="o6o89w"
version changed
→ stale
→ re-review / reject / regenerate
```

---

### 6. Reapproval 不能扩大 Authorization Boundary

```text id="5mnk06"
original role restriction
    ↓
must remain in reapproval
```

---

### 7. Executor 必须理解 Idempotency Key

不能只是在：

```text id="ajp1ok"
ExecutionService
```

中生成：

```text id="z0c4c0"
idempotencyKey
```

但 Executor 完全不用。

真正的副作用边界必须执行 deduplication。

---

# 67. 当前项目最值得补强的 Executor Contract

当前 demo executor 可以继续简单，但生产契约应该明确：

```ts id="s7u1p5"
/**
 * A CommandExecutor MUST treat idempotencyKey as the
 * identity of the business side effect.
 *
 * The same key must not cause a second external side effect.
 *
 * A retry should return the original execution result
 * whenever the original result is durably known.
 */
interface CommandExecutor {
  commandType: string;

  execute(
    intent: CommandIntent,
    ctx: CommandExecutionContext,
  ): Promise<CommandExecutionResult>;
}
```

并且：

```text id="e7jz1s"
Idempotency responsibility
```

应该由：

```text id="8zg5py"
Executor / Downstream System
```

最终承担，而不是只由 Workflow Runner 承担。

---

# 68. 当前项目不需要做什么

这个模型不意味着现在就需要加入：

```text id="c69kmh"
Distributed Saga Framework
Complex Transaction Coordinator
Temporal
Full BPMN Runtime
Global Distributed Lock
Exactly-once Message Bus
```

对于当前架构，更实际的是：

```text id="7gk3kg"
Durable Workflow
+
CAS
+
Command Hash
+
Resource Version
+
Human Approval
+
Idempotency Key
+
Idempotent Executor
```

这是一个明显更小、更可控的解决方案。

AWS 的架构实践也倾向于针对具体 failure mode 使用幂等 API、retry、callback、conditional write 和 durable execution，而不是默认引入一个庞大的分布式事务系统。

---

# 69. 失败场景检查表

生产系统至少要测试这些场景：

| 场景                   | 正确结果                        |
| -------------------- | --------------------------- |
| Agent 重试             | 不产生第二副作用                    |
| 同一 Command 并发两次      | 只有一个真正执行                    |
| 第二次请求超时后重试           | 返回第一次结果                     |
| Approval callback 重复 | 只推进一次                       |
| Approval 已过期         | 拒绝                          |
| Approval 对应 hash 不一致 | 拒绝                          |
| Resource version 变化  | 重新验证                        |
| Policy version 变化    | 重新授权/审批                     |
| 用户失去权限               | 执行前拒绝                       |
| Command 已执行          | 返回历史结果                      |
| Executor crash       | 可恢复/查询最终状态                  |
| External API timeout | 进入 UNKNOWN / reconciliation |
| Workflow crash       | 不重复副作用                      |
| Pod A / Pod B 同时执行   | 通过 durable idempotency 防重   |
| Agent 改变 parameters  | 新 hash，旧 approval 无效        |
| Reapproval           | 不扩大原授权边界                    |

---

# 70. 推荐的审计链

一次高风险 Command 最终应该形成：

```text id="j1p3c5"
Agent Proposal
      │
      ▼
Command Intent
      │
      ▼
Command Hash
      │
      ▼
Policy Decision
      │
      ▼
Human Approval
      │
      ▼
Resource Version
      │
      ▼
Idempotency Key
      │
      ▼
Domain Validation
      │
      ▼
Execution
      │
      ▼
External Result
```

因此系统最终可以回答：

```text id="hsh4x3"
What did the Agent propose?
What exactly was approved?
Who approved it?
Under which Policy?
Against which resource version?
What idempotency key represented the operation?
Did it actually execute?
Was this a retry?
What was the final external result?
```

这比只保存：

```text id="a6vca2"
"Agent called publish tool."
```

要可靠得多。

---

# 71. 与金融运营韧性的关系

DORA 要求金融实体限制信息和 ICT 资产访问到完成合法、获批准的功能所需的范围，并要求 ICT 风险管理、恢复能力、变更控制和业务连续性形成制度化控制。

Command / Approval / Idempotency 模型正好可以对应这些要求：

```text id="w0owct"
Command
    → explicit business operation

Approval
    → authorized human control

Policy
    → access / permission boundary

Idempotency
    → duplicate execution protection

Resource Version
    → concurrency / stale decision protection

Audit
    → reconstructability

Reconciliation
    → operational resilience
```

因此它不是单纯的“Agent 工程技巧”，而是金融 Agent 进入生产业务后必须解决的 operational control。

---

# 72. 最终设计原则

整套模型可以压缩成 15 条：

```text id="r2pp9m"
1. Agent never directly performs high-risk business mutation.

2. Every consequential Agent action becomes a structured Command.

3. Approval applies to a specific Command, not a broad future permission.

4. Approval must be bound to Command Hash / Resource Version / Policy Version.

5. Approval is not Authorization.

6. Authorization must be revalidated immediately before execution.

7. Resource Version protects against stale approvals and TOCTOU.

8. Idempotency Key identifies the business operation, not the network request.

9. Retries reuse the same Idempotency Key.

10. Different parameters with the same Idempotency Key are a conflict.

11. Command Executor, not the LLM, owns side-effect safety.

12. Internal mutations should atomically bind idempotency state and business mutation whenever practical.

13. External side effects require downstream idempotency or explicit reconciliation.

14. UNKNOWN outcome must be modeled; timeout must not be treated blindly as failure.

15. Workflow correctness and side-effect correctness are separate guarantees.
```

---

# 73. 最值得记住的四句话

```text id="2n3dmt"
Command
    = What do we intend to do?

Approval
    = Who authorized this exact operation?

Idempotency
    = Has this exact operation already taken effect?

Domain
    = Is this operation still valid in the business?
```

进一步：

```text id="3kq7gq"
Workflow
    = Is this the right step now?

Policy
    = Are we allowed to do it?

Approval
    = Has the required human decision happened?

Command
    = What exactly will happen?

Idempotency
    = Has it already happened?

Domain
    = Is it still valid?

Executor
    = Make the side effect happen safely.
```

---

# 74. 最终架构图

```text id="bq5hkg"
                         ┌─────────────┐
                         │    Agent    │
                         │             │
                         │ Reasoning   │
                         │ Proposal    │
                         └──────┬──────┘
                                │
                                ▼
                       ┌─────────────────┐
                       │ Command Intent  │
                       └────────┬────────┘
                                │
                         canonical + hash
                                │
                                ▼
                       ┌─────────────────┐
                       │    Workflow     │
                       └────────┬────────┘
                                │
                                ▼
                       ┌─────────────────┐
                       │     Policy      │
                       └───────┬─────────┘
                         ┌──────┼───────┐
                         ▼      ▼       ▼
                       DENY    AUTO    HUMAN
                                  │       │
                                  │   Approval
                                  │       │
                                  └───┬───┘
                                      ▼
                              Re-validation
                                      │
                          ┌───────────┼────────────┐
                          │           │            │
                       Hash OK   Version OK   Policy OK
                          │           │            │
                          └───────────┼────────────┘
                                      ▼
                            ┌─────────────────┐
                            │ Idempotency     │
                            │ Gate            │
                            └────────┬────────┘
                                     │
                           already executed?
                              ┌──────┴──────┐
                              ▼             ▼
                            YES            NO
                              │             │
                        return result       ▼
                                     ┌──────────────┐
                                     │ Domain       │
                                     │ Validation   │
                                     └──────┬───────┘
                                            │
                                            ▼
                                     ┌──────────────┐
                                     │ Executor     │
                                     └──────┬───────┘
                                            │
                              ┌─────────────┴─────────────┐
                              ▼                           ▼
                         Internal DB                External API
                              │                    Idempotency-Key
                              └─────────────┬─────────────┘
                                            ▼
                                         Result
                                            │
                                            ▼
                                          Audit
```

---

# 75. 最终结论

金融 Agent 的安全执行模型，不应该是：

```text id="8fny7y"
Agent
 ↓
Approval
 ↓
Tool
```

而应该是：

```text id="zde5a2"
Agent
 ↓
Command
 ↓
Policy
 ↓
Approval
 ↓
Re-validation
 ↓
Idempotency
 ↓
Domain
 ↓
Controlled Executor
 ↓
Business / External System
```

这里最重要的不是某一个组件，而是**每个组件承担不同的责任**：

```text id="j5z0m8"
Agent
    → proposes

Workflow
    → controls process

Policy
    → authorizes

Human
    → approves where required

Command
    → defines exact mutation

Idempotency
    → prevents duplicate effect

Resource Version
    → prevents stale execution

Domain
    → protects business invariants

Executor
    → controls real side effects

Audit
    → proves what happened
```

因此，金融 Agent 的执行原则可以最终浓缩成：

> **Approve the exact Command, execute it only when the authorization and business state are still valid, and make every retry resolve to the same business effect.**

再进一步：

> **不要试图让 Workflow “保证 Exactly Once”；应该让 Workflow 管流程一致性，让 Command 管业务意图，让 Idempotency 管重复副作用，让 Domain 管业务合法性，让下游系统共同承担最终执行安全。**

这比单纯追求一个“绝不重复执行”的 Workflow Engine 更符合真实金融分布式系统的边界。

---

# 参考资料

**AWS — Amazon Builders' Library: Making retries safe with idempotent APIs**
Amazon 对 idempotent API、client request token、重复请求识别，以及 idempotency token 与 mutation 必须保持可靠一致性的工程经验。

**AWS — Agentic AI Lens: Implement tool authorization**
要求每次 Tool Invocation 在执行前通过外部 Policy 授权，并传播 Agent Identity 与 originating user context；高风险 mutation 需要 Human Review。

**AWS — Agentic AI Lens: Human-in-the-loop for critical decisions**
风险分级审批、避免 rubber-stamping、Approval Scope、Command/Parameter/Resource 绑定、可撤销与审计化的 persistent trust。

**AWS — Durable Execution: Idempotency and retries**
明确区分 at-least-once、at-most-once 与整个 Workflow 的 exactly-once，并要求根据副作用类型选择相应语义。

**AWS — Step Functions Standard Workflows**
Standard Workflow 具有 exactly-once workflow execution model，但显式 Retry 仍会让 Task 再次执行；同时提供长时间运行、审计和 Callback 模式。

**AWS — DynamoDB Optimistic Locking / Conditional Writes**
通过 version + conditional write 检测并发修改，防止 stale update；这种模式也适合 Approval / Command 的 Resource Version 检查。

**Stripe — Idempotent Requests**
使用 Idempotency-Key 保存首次请求结果；相同 key 的后续请求返回相同结果，并对参数不一致的 key reuse 进行冲突检测。

**Microsoft Agent Framework — Human-in-the-loop**
Request/Response、RequestPort、checkpoint、pending request 和 resume，为长时间 Approval 提供持久化 Workflow 模型。

**Microsoft Durable Task**
Activity 使用 at-least-once execution，官方明确建议 Activity 尽可能 idempotent，并建议对写操作使用 upsert 或存在性检查。

**Google Cloud — Retry / Idempotent Event Handlers**
Google 建议在 at-least-once delivery 下使用 event ID / idempotency key、事务检查和 reconciliation 处理重复事件。

**OWASP — LLM06:2025 Excessive Agency**
将 excessive functionality、permissions、autonomy 作为 Agentic 系统的主要风险，并要求 downstream authorization、least privilege 和 high-impact human approval。

**DORA — Regulation (EU) 2022/2554**
要求金融实体限制 ICT / information asset access 到合法且获批准的功能，并建立审计、恢复、变更控制和数字运营韧性框架。


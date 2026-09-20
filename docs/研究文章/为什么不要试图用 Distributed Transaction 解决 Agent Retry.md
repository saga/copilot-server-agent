# 为什么不要试图用 Distributed Transaction 解决 Agent Retry：从 2PC/XA 到 Idempotent Command Executor

## 摘要

Agent 开始进入支付、交易、Proxy Voting、Corporate Action、客户服务和运营自动化之后，一个非常容易出现的架构误区是：

> **既然 Agent Workflow 会因为 timeout、worker crash、queue redelivery、checkpoint replay 而重复执行，那就把整个 Agent Workflow 包进 Distributed Transaction，用 2PC/XA 保证“只执行一次”。**

这个方向的问题不在于 Distributed Transaction 没有价值。

恰恰相反：

> **Distributed Transaction 解决的是“多个事务参与者如何原子提交”，而 Agent Retry 需要解决的是“同一个业务操作被重复尝试以后，如何避免重复业务副作用”。**

这是两个不同的问题。

可以把它们写成：

```text id="a1f3h4"
Distributed Transaction
    ↓
Atomic Commit

Idempotent Command Executor
    ↓
Duplicate-Safe Business Effect
```

例如：

```text id="n7s4dk"
Transaction A:
DB1 update
DB2 update
```

需要解决：

```text id="f8a2k1"
要么两个都 commit
要么两个都 rollback
```

这是 Distributed Transaction / 2PC 的问题。

而：

```text id="w9c5p2"
Agent
 ↓
Payment Command
 ↓
Payment Provider
 ↓
timeout
 ↓
retry
```

真正的问题是：

```text id="q4m7vx"
第一次 payment 到底有没有成功？
```

如果第一次已经成功，第二次 retry 就必须被识别为：

```text id="x3r8z1"
same logical operation
```

而不是：

```text id="p6t1ku"
new transaction
```

这正是 Idempotency 要解决的问题。

AWS 当前 Agentic AI Lens 已经把 **idempotent task execution** 作为高风险可靠性最佳实践，明确指出 retry 如果没有幂等保障会产生重复副作用，并建议通过稳定的 idempotency key、conditional write、结果复用和向下游传播来解决。

AWS 最新 Durable Execution SDK 甚至直接把：

```text id="u2m5na"
at-least-once
```

作为默认 Step 语义，并明确指出：

> retry / replay 可以让一个操作执行多次；如果它有副作用，就必须让它具备幂等性。

同时 AWS 明确说明，即使使用 at-most-once per retry，也不意味着整个 Workflow 获得 exactly-once；如果 Workflow 本身配置 retry，Step 仍可能再次执行。

因此，本文的核心结论是：

> **不要试图用 Distributed Transaction 作为 Agent Retry 的主要解决方案。**

更合理的架构是：

```text id="r5j1kt"
At-least-once Workflow
        ↓
Stable Logical Operation
        ↓
Idempotent Command Executor
        ↓
Business Side Effect
        ↓
Reconciliation
```

Distributed Transaction 仍然有价值，但应当把它限制在真正适合 ACID/atomic commit 的边界内，例如：

```text id="v8n2cy"
Command State
+
Idempotency Record
+
Business DB Update
+
Outbox
```

这些内部数据可以用一个本地数据库事务解决。

而：

```text id="y1k6wh"
Agent
Workflow
Human Approval
Payment Provider
Broker
ISS / Vendor
```

这种跨运行时、跨网络、跨组织、跨时间的长流程，不应该通过 2PC/XA 强行变成一个巨大 Transaction。

---

# 1. 先区分三个完全不同的问题

讨论 Agent Retry 时，最容易犯的错误是把以下问题混成一个：

```text id="v2q6jz"
1. Atomicity
2. Retry Safety
3. Business Compensation
```

它们分别对应：

```text id="w9n1k4"
Atomicity
    → Distributed Transaction / ACID / 2PC

Retry Safety
    → Idempotency

Business Recovery
    → Workflow / Saga / Compensation / Reconciliation
```

---

## 1.1 Atomicity：要么全部提交，要么全部不提交

例如：

```text id="r3k8yb"
DB A:
debit account

DB B:
create ledger entry
```

希望：

```text id="g4s8fm"
A commit
+
B commit
```

否则：

```text id="z5p2jh"
A commit
B rollback
```

就产生不一致。

如果两个数据库都是支持 XA / 2PC 的事务参与者，那么 Distributed Transaction 可以解决这种问题。

PostgreSQL 原生支持 prepared transactions / two-phase commit，并明确将其定位为外部 transaction manager 使用的机制。

---

## 1.2 Retry Safety：相同操作重复执行怎么办

例如：

```text id="3n7yqp"
Payment
```

第一次：

```text id="u4c2mw"
provider:
SUCCESS
```

但：

```text id="s6d1rz"
response:
TIMEOUT
```

Agent / Workflow retry。

这里真正要解决的不是：

```text id="k7m9bx"
A 和 B 是否 atomic commit？
```

而是：

```text id="n4q3fj"
这个 retry 是不是同一个 Payment Operation？
```

答案通常应该是：

```text id="a8s5hd"
same logical operation
```

这就是：

```text id="e2m6cr"
Idempotency
```

---

## 1.3 Business Recovery：业务已经发生以后怎么办

例如：

```text id="u7t2pz"
Reserve Cash
     ↓
Submit Trade
     ↓
Trade accepted
     ↓
Update downstream system
     ↓
failure
```

这时：

```text id="m9k4xw"
rollback
```

未必存在。

你可能需要：

```text id="c6p8ra"
Compensation
Reconciliation
Manual Review
```

这属于：

```text id="y5h1vd"
Saga / Workflow
```

而不是 2PC。

AWS 对 Saga 的定义就是：通过一系列 local transactions 和 compensating transactions 在跨服务流程中保持业务一致性；同时 AWS 明确指出，Saga 的复杂度会随着参与服务数量增加而上升。

---

# 2. Distributed Transaction 到底解决什么

经典 2PC 可以简单理解成：

```text id="e8n1vz"
Coordinator
      │
      ├── PREPARE → Participant A
      ├── PREPARE → Participant B
      │
      ▼
    decision
      │
      ├── COMMIT → A
      └── COMMIT → B
```

第一阶段：

```text id="k7p4mv"
Prepare
```

参与方回答：

```text id="a6x3dq"
我能提交
```

第二阶段：

```text id="q5c9wy"
Commit
```

协调者统一要求：

```text id="n2m7lf"
commit
```

这样能提供：

```text id="z1f6ra"
atomic commit
```

AWS 对 Saga / 2PC 的说明也明确指出，2PC 的 prepare 阶段要求参与者承诺可以 commit 或 rollback，随后 coordinator 决定最终 commit。

它最擅长的问题是：

```text id="p8c3tm"
多个事务参与者
+
明确的事务边界
+
支持 prepare/commit
```

---

# 3. Agent Retry 的问题完全不同

Agent Workflow 更像：

```text id="s4g1fx"
User
 ↓
Agent
 ↓
Workflow
 ↓
Command
 ↓
External API
```

执行：

```text id="n7d3kc"
request sent
```

然后：

```text id="x9m5qb"
timeout
```

这时候系统不知道：

```text id="j3a8pw"
external operation happened?
```

于是：

```text id="c4f6zd"
retry
```

这不是“两个数据库需要一起 commit”的问题。

真正的问题是：

```text id="y6r1tb"
Unknown outcome
```

因此：

```text id="m4c8vk"
2PC
```

并没有直接回答：

> “如果我不知道上一个 Agent attempt 是否已经产生外部副作用，我现在应该如何安全 retry？”

---

# 4. 最核心的误区：把 Retry 当成 Transaction

这是整篇文章最重要的一点：

> **Retry 是执行语义，Transaction 是提交语义。**

例如：

```text id="q1v9dc"
Attempt #1
Attempt #2
Attempt #3
```

并不意味着：

```text id="m7x3fk"
Transaction #1
Transaction #2
Transaction #3
```

事实上它们通常是：

```text id="j8a5nr"
ONE logical operation

└── Attempt 1
└── Attempt 2
└── Attempt 3
```

所以 retry 时真正需要的是：

```text id="w3f9ks"
保持 Logical Operation Identity
```

而不是：

```text id="c1p7va"
重新启动一个 Distributed Transaction
```

---

# 5. 为什么 2PC 解决不了最典型的 Agent Retry 场景

假设：

```text id="v5h2rx"
Agent
 ↓
Payment Command
 ↓
Payment Provider
```

Provider 是：

```text id="q8z4md"
外部 SaaS
```

它没有：

```text id="n3k7wf"
XA resource manager
```

也不支持：

```text id="j2p8qa"
PREPARE
COMMIT
ROLLBACK
```

你根本无法把这个 provider 纳入：

```text id="f6c1zr"
2PC transaction
```

那么：

```text id="e9m5tx"
Distributed Transaction
```

自然就不能成为真正的 side-effect boundary。

此时你需要的是：

```text id="y8v3rq"
Provider idempotency
+
External Reference
+
Reconciliation
```

---

# 6. 更重要的是：Human Approval 根本不是一个 Transaction Participant

考虑金融 Agent：

```text id="c7n2mz"
Agent
 ↓
Create Trade Command
 ↓
Risk Check
 ↓
Human Approval
 ↓
Execute
```

Approval 可能：

```text id="a5r8kd"
10 minutes
```

也可能：

```text id="p4v9xy"
8 hours
```

甚至：

```text id="h2m6qz"
2 days
```

你不可能合理地要求：

```text id="u7c3ns"
DB
Broker
Payment
Approval UI
Agent Runtime
```

全部在一个：

```text id="s8m5hf"
distributed transaction
```

中保持 prepared state。

PostgreSQL 官方文档对 prepared transactions 的警告非常明确：prepared transaction 应保持很短时间，因为它会继续持有事务锁；长时间保持 prepared state 会干扰 VACUUM，严重情况下甚至可能导致数据库为避免事务 ID wraparound 而关闭。

所以：

```text id="g6x3bn"
Human Approval
```

天然应该是：

```text id="w4r7kc"
durable business state
```

而不是：

```text id="u1t9fz"
open 2PC transaction
```

---

# 7. Agent 的 Workflow 生命周期和 DB Transaction 生命周期完全不同

数据库 Transaction 通常：

```text id="v1b4qz"
milliseconds
seconds
```

Agent Workflow 可能：

```text id="f8c3jy"
seconds
minutes
hours
days
```

例如：

```text id="r7m2ka"
09:00
Agent creates trade proposal

09:01
Risk check

09:03
Approval request

12:30
Human approves

12:31
Broker submit

12:32
Execution report

13:00
Reconciliation
```

试图让这个整个生命周期成为：

```text id="x3n8pd"
one 2PC transaction
```

会直接把：

```text id="p2k5va"
long-lived business process
```

错误建模为：

```text id="n6d1wr"
short-lived database transaction
```

这不是架构复杂度问题，而是**抽象层次错误**。

---

# 8. 2PC 的主要优势其实不应该被否定

这里必须把结论说准确。

不能简单说：

> “2PC 不可靠。”

这并不准确。

2PC 在适合的环境里可以很好地提供：

```text id="k4j9zc"
atomic commit
```

例如：

```text id="a1z5vw"
多个数据库
相同 transaction boundary
可靠 transaction manager
可接受的 lock duration
所有参与者支持协议
```

甚至 Google Spanner 本身就提供跨分片、跨机器的强事务语义；它可以让应用在多服务器上执行读写事务，并提供 serializable / external consistency 等强保证。

所以真正的结论不是：

```text id="q9x8sb"
Distributed Transaction 很糟
```

而是：

> **不要把它当作 Agent Retry 的通用解决方案。**

这是一个非常重要的区别。

---

# 9. Distributed Transaction 与 Idempotent Command Executor 是互补关系

正确的架构并不是：

```text id="v6m2jd"
2PC
OR
Idempotency
```

而是：

```text id="p7k3rx"
Local ACID / Distributed Transaction
             +
Idempotent Command Executor
             +
Workflow / Saga
             +
Reconciliation
```

例如企业内部：

```text id="t5j8cn"
Command DB
+
Business DB
+
Outbox
```

如果都在：

```text id="m9w2qa"
同一个 PostgreSQL
```

可以用一个本地 transaction：

```text id="x6p5rb"
BEGIN

insert command
insert idempotency record
update business state
insert outbox event

COMMIT
```

这是非常好的地方使用 Transaction。

但是：

```text id="w8f1yk"
Outbox
 ↓
Payment Provider
```

不能因为前面的：

```text id="a7r2cz"
DB transaction
```

就自动拥有：

```text id="c3m9fv"
external exactly-once
```

仍然需要：

```text id="h5x8dw"
provider idempotency
+
external reference
+
reconciliation
```

---

# 10. 推荐的边界：Transaction 到 Command Executor

可以把：

```text id="k5w8df"
Transaction
```

放在：

```text id="v2z7bc"
Command Executor
```

内部。

例如：

```text id="g1p4sm"
             Agent
               │
               ▼
          Workflow
               │
               ▼
           Command
               │
               ▼
      ┌───────────────────┐
      │ Command Executor  │
      │                   │
      │ BEGIN             │
      │ claim idempotency │
      │ update state      │
      │ write outbox      │
      │ COMMIT            │
      └────────┬──────────┘
               │
               ▼
       External Adapter
               │
               ▼
       Payment / Broker /
       Voting / Vendor
```

这里的核心是：

> **Transaction 用于保证 Command Executor 自己管理的数据状态一致；Idempotency 用于保证一个逻辑 Command 的重复执行不会产生第二次业务效果。**

---

# 11. 一个推荐的分层模型

```text id="b9r2q5"
Agent Plane
─────────────────────────
LLM
Reasoning
Planning
RAG
Memory

Workflow Plane
─────────────────────────
Durable State
Checkpoint
Retry
Redrive
Timeout
Human Wait

Command Plane
─────────────────────────
Business Command
Operation ID
Command Hash
Authorization
Approval

Execution Plane
─────────────────────────
Idempotency
Atomic Claim
Precondition
Local Transaction
Outbox
External Adapter
Reconciliation

Business Systems
─────────────────────────
Payment
Trade
Proxy Vote
CRM
Vendor
```

这比：

```text id="z8y4vx"
Agent
↓
One Giant Distributed Transaction
```

清晰得多。

---

# 12. 为什么不能把 Agent Runtime 当 Distributed Transaction Coordinator

表面上看：

```text id="n6t4br"
Agent Runtime
```

非常像一个：

```text id="y7k2fa"
Coordinator
```

因为它知道：

```text id="c4m8sd"
Step 1
Step 2
Step 3
```

所以很容易得出：

```text id="x9q2ew"
Agent Runtime = Transaction Coordinator
```

这是危险的。

Agent Runtime 的核心任务是：

```text id="g4f8zm"
reasoning
planning
tool selection
context management
```

而 Transaction Coordinator 需要：

```text id="m3v9la"
deterministic state
commit protocol
durable recovery
participant protocol
transaction IDs
timeout handling
```

尤其：

```text id="e4q1xc"
LLM reasoning
```

本身不应该参与：

```text id="x2z5pk"
COMMIT / ROLLBACK
```

这样的底层一致性控制。

AWS Agentic AI Lens 明确建议通过 atomic task design、显式 contract 和 deterministic execution 约束 LLM 的随机性，而不是让 LLM 本身承担可靠性边界。

---

# 13. 更严重的问题：Agent Reasoning 无法被 Prepare

2PC 的 Prepare 有一个核心语义：

```text id="q2v5ns"
参与者承诺：

“我已经完成必要准备，
后面只差 COMMIT 或 ROLLBACK。”
```

但 Agent Reasoning 不具备这种性质。

例如：

```text id="s5c9ak"
LLM:
“根据最新市场信息，
我可能应该调整订单。”
```

这不是：

```text id="f7k1me"
prepared state
```

Agent 的上下文可能因为：

```text id="p3x8zd"
new market data
new message
new policy
new user instruction
new retrieval result
```

发生改变。

所以：

> **Reasoning 是开放式决策过程，不适合作为 2PC Participant。**

业务上真正应该 prepare 的是：

```text id="w5a8cz"
Canonical Command
```

而不是：

```text id="j2s4px"
LLM Context
```

---

# 14. Approval 更不应该是 2PC Prepare

例如：

```text id="b7x5rq"
Command:
Buy 100,000 shares
```

Approval：

```text id="m2k8fz"
Waiting for supervisor
```

正确建模：

```text id="q9w4sa"
Command.status = AWAITING_APPROVAL
```

而不是：

```text id="a6n2fc"
Broker transaction = PREPARED
```

因为批准人可能：

```text id="e9j1kx"
reject
```

或者：

```text id="v2p6s8"
take hours
```

甚至：

```text id="c3r7mg"
ask Agent to revise proposal
```

这是一种：

```text id="s8w5dz"
business state transition
```

不是：

```text id="q4m6bn"
transaction phase
```

---

# 15. 2PC 解决不了“重复提交不同 Transaction”的问题

这是最容易被忽略的一点。

假设 Agent：

```text id="r4t9cj"
创建 Transaction T1
```

执行：

```text id="z8p2ya"
Payment
```

timeout。

Agent retry：

```text id="d1m7wx"
创建 Transaction T2
```

如果：

```text id="k5s8bq"
T1
```

其实已经 commit：

那么：

```text id="f6c3zn"
T2
```

仍然是一个新的 transaction。

2PC 能保证：

```text id="u9b2me"
T2 本身 atomic
```

但它并不能自动理解：

```text id="a7d4qx"
T1 和 T2 其实表达同一个 Business Operation
```

这就是最关键的区别。

因此：

> **Distributed Transaction 的 identity 是 Transaction Identity；Agent Retry 要控制的是 Business Operation Identity。**

如果两者不一致：

```text id="v5m1z9"
New Transaction
```

并不会自动等于：

```text id="s4y8pk"
Safe Retry
```

---

# 16. 这也是为什么 Transaction ID 不能替代 Idempotency Key

例如：

```text id="h3k6pa"
Transaction ID:
TX-001
```

retry：

```text id="r8m2cz"
Transaction ID:
TX-002
```

从 Transaction Manager 看：

```text id="b4v9xd"
两个合法 transaction
```

从业务角度：

```text id="n7q1ks"
同一个 payment
```

因此必须存在另一层：

```text id="z8c3ra"
operationId = PAYMENT-123
```

让：

```text id="h2y6vt"
TX-001
TX-002
```

都映射到：

```text id="p6w4ns"
PAYMENT-123
```

然后 Executor 才可以判断：

```text id="x9m7zk"
TX-002
=
retry of PAYMENT-123
```

而不是：

```text id="b1q5fd"
new payment
```

---

# 17. Distributed Transaction 的 Coordinator 也会引入额外故障状态

2PC 本身需要：

```text id="b2k7ws"
Coordinator
```

维护：

```text id="m8r5dz"
transaction state
```

参与者：

```text id="f3p9qx"
prepare
```

之后可能：

```text id="d7k2sa"
participant prepared
coordinator unavailable
```

于是参与者：

```text id="j9x4bn"
不能随意 commit
也不能随意 rollback
```

具体实现可以通过 durable coordinator logs、recovery protocol 等机制进行恢复，但本质上：

```text id="v6m2cx"
distributed coordination
```

本身增加了故障状态和运维复杂度。

PostgreSQL 官方文档明确指出，prepared transaction 会保持锁，应尽快完成 commit/rollback；如果没有外部 transaction manager 正确关闭 prepared transactions，官方甚至建议将 `max_prepared_transactions` 保持为 0 以避免遗留 prepared transactions 带来的问题。

因此，把 Agent Workflow 的：

```text id="r8m3zy"
hours / days
```

生命周期放进：

```text id="t7c2qa"
2PC
```

往往是非常糟糕的资源管理方式。

---

# 18. Prepared Transaction 不适合 Human-in-the-loop

这一点在金融 Agent 中尤其重要。

例如：

```text id="y7n5kv"
Trade Command
```

上午：

```text id="g8p3dm"
risk check passed
```

需要 Portfolio Manager：

```text id="r1x7nc"
approve
```

直到下午：

```text id="c5m4za"
approved
```

如果为了“保证整个流程 atomic”而让：

```text id="m6w2hf"
database transaction
```

保持：

```text id="p3z7ck"
prepared
```

几个小时：

* 数据库锁可能持续存在；
* 资源无法高效回收；
* 长时间故障恢复变得复杂；
* Coordinator/participant 状态需要长期保留。

PostgreSQL 对 prepared transaction 的官方警告正是针对这种问题。

正确模型应该是：

```text id="t5r8sm"
Command
status = AWAITING_APPROVAL
```

而不是：

```text id="j2c7vn"
Transaction
status = PREPARED
```

---

# 19. Distributed Transaction 还无法跨越“不可事务化”的副作用

Agent Workflow 常见副作用包括：

```text id="z8f4qj"
发送邮件
发短信
调用支付服务
提交证券订单
提交 Proxy Vote
调用 SaaS API
发布消息
调用 MCP Server
写入第三方 CRM
```

其中很多根本不是：

```text id="x3n6wm"
XA Resource
```

更不支持：

```text id="f7c9as"
prepare
commit
rollback
```

因此：

```text id="s4p8dj"
“把整个 Agent Workflow 包进 2PC”
```

从能力边界上就很难成立。

---

# 20. 更重要的是：外部系统可能已经产生不可逆业务效果

假设：

```text id="h5q1vn"
Broker
```

已经接受：

```text id="z9f4kc"
BUY 100,000 XYZ
```

之后：

```text id="p7b2mx"
network timeout
```

内部：

```text id="m8k5cw"
transaction rollback
```

并不能让：

```text id="j1r7va"
Broker
```

自动：

```text id="q3v5nx"
rollback
```

因为：

```text id="w8c1sz"
external side effect
```

已经发生。

这时候需要：

```text id="u4p2ka"
external query
execution report
reconciliation
```

甚至：

```text id="e7y1mz"
compensating order
```

而不是：

```text id="x5c8qd"
ROLLBACK
```

---

# 21. 2PC 与 Saga 的根本区别

可以这样理解：

### 2PC

```text id="k7m3xc"
Prepare all
    ↓
Commit all
```

目标：

```text id="v8q4zn"
atomicity
```

### Saga

```text id="r6b2ws"
Local Tx A
    ↓
Local Tx B
    ↓
Local Tx C
```

失败：

```text id="j3x9kp"
Compensate C/B/A
```

目标：

```text id="n2f7cm"
business consistency
```

AWS 对 Saga 的定义就是 local transactions + continuation + compensation，并明确将它用于长生命周期跨服务事务。

因此：

```text id="q4j9az"
Long-running Agent Workflow
```

更自然的是：

```text id="h8m3yk"
Saga / Workflow
+
Idempotent Commands
```

而不是：

```text id="z5b1pv"
2PC
```

---

# 22. 但 Saga 也不等于 Idempotency

这是另一个必须避免的误区。

例如：

```text id="a2z7km"
Saga Step:
ChargePayment
```

Saga 可以告诉你：

```text id="f8n4qc"
payment failed
→ compensate previous steps
```

但如果：

```text id="m6p2yd"
ChargePayment
```

因为 timeout 重试两次：

```text id="r7c5wn"
$100
$100
```

Saga 本身不会自动阻止第二次扣款。

因此：

```text id="j8s4mv"
Saga
+
Idempotent Command
```

通常需要一起使用。

---

# 23. 推荐的组合不是 Transaction vs Saga，而是四层组合

更完整：

```text id="v5m3cz"
Local Transaction
        ↓
Command Idempotency
        ↓
Workflow / Saga
        ↓
Reconciliation
```

分别解决：

```text id="d7w1rx"
Local Transaction
→ 本地数据原子性

Idempotency
→ 重试安全

Workflow / Saga
→ 跨步骤业务一致性

Reconciliation
→ 外部未知结果收敛
```

这四个问题不能靠一个机制全部解决。

---

# 24. 一个推荐的 Agent Execution Pipeline

```text id="m1v7qa"
                 Agent / LLM
                      │
                      ▼
                 Proposal
                      │
                      ▼
             Durable Workflow
                      │
              at-least-once
                      │
                      ▼
               Business Command
                      │
                      ▼
         Authorization / Approval
                      │
                      ▼
          Idempotent Command Executor
                      │
             ┌────────┴────────┐
             │                 │
         Existing Result     New Operation
             │                 │
             ▼                 ▼
         Replay Result     Local Transaction
                               │
                               ▼
                             Outbox
                               │
                               ▼
                         External Adapter
                               │
                         ┌─────┴─────┐
                         │           │
                      SUCCESS      UNKNOWN
                         │           │
                         │      Reconciliation
                         │           │
                         └─────┬─────┘
                               ▼
                         Final Business State
```

注意：

```text id="p7c1ma"
Transaction
```

是在：

```text id="z5n3vx"
Command Executor
```

内部使用的。

不是：

```text id="k8q2bn"
包住整个 Agent Workflow
```

---

# 25. 为什么这个边界特别适合金融服务

金融 Workflow 的典型性质：

```text id="w4d6zp"
Long-lived
External systems
Human approval
High-value side effects
Asynchronous confirmation
Reconciliation
Audit
```

这些特点天然和：

```text id="q8f1nm"
2PC
```

的假设不匹配。

而：

```text id="s5k4xa"
Command
+
Idempotency
+
Reconciliation
```

正好适合。

例如：

```text id="a9c6rx"
Trade
```

可以是：

```text id="e4n7vm"
Command
    ↓
approval
    ↓
idempotent executor
    ↓
broker
    ↓
execution report
    ↓
reconciliation
```

而不是：

```text id="n8k3bd"
2PC transaction
open for hours
```

---

# 26. Payment 行业已经证明 Retry 应该通过 Idempotency，而不是“大事务”解决

Stripe 官方 API 明确将 Idempotency Key 定义为安全 retry 的机制：相同 key 的后续请求返回第一次请求的结果，并检查参数是否一致；Stripe 也明确允许自动清理至少 24 小时前的 key。

Adyen 同样明确表示：

> timeout 后，可以用相同 idempotency key 安全重试，而不会再次扣款。

同时 Adyen 的服务端维护状态来保证同 key 的重复请求不会重复处理，并对并发请求定义冲突/进行中语义。

这两个真实支付系统的模式非常能说明问题：

```text id="z6j2bw"
Payment Retry
```

实际解决方案不是：

```text id="m9x5qa"
2PC across client + payment network
```

而是：

```text id="h1c7vz"
Stable Operation Identity
+
Idempotent Provider API
```

---

# 27. PayPal 也是类似模式

PayPal 官方通过：

```text id="m4c8jn"
PayPal-Request-Id
```

为 POST/PUT 等可能产生副作用的 API 提供重复请求保护。

核心模型仍然是：

```text id="w3s7km"
same logical request
→ same request identifier
→ safe retry
```

而不是：

```text id="u5b1qp"
long-lived distributed transaction
```

这说明 Idempotency 已经在金融技术中被广泛作为：

```text id="r8c2mj"
API Contract
```

使用。

---

# 28. Agentic Payment 正在把这个问题推向下一层

Visa 当前的 Trusted Agent Protocol 针对 Agent-driven commerce 引入：

```text id="j7m4xf"
Agent recognition
Signed requests
Consumer intent
Payment container
```

其目标是让 Merchant 能够识别并安全处理代表消费者行动的 AI Agent。

Mastercard 的 Agent Pay 则引入 Agentic Tokens，并把：

```text id="g8m2np"
trust
security
control
```

作为 Agentic Payments 的基础能力。

这些公开方案并没有证明其内部使用某一种具体的 Command Executor 或 Idempotency Store，因此不应把它们描述成本文架构的直接实现。

但它们证明了一个更基础的趋势：

> 当 Agent 真正进入支付基础设施以后，关键问题不是“LLM 会不会发 HTTP 请求”，而是“Agent 产生的业务操作如何获得明确身份、授权、交易状态和安全重试语义”。

这恰恰是：

```text id="k1b7zx"
Command
+
Idempotency
+
Execution State
```

存在的价值。

---

# 29. BIS 对 Agent 进入支付基础设施的研究也提供了重要背景

BIS 2025 年 Working Paper 1310 研究了生成式 AI Agent 在 RTGS 高价值支付系统中进行现金与流动性管理的可能性，并指出真实金融基础设施中的 Agent 使用需要监管 safeguards、human oversight 和进一步研究。

这里不能据此断言：

```text id="b4c7qn"
BIS 推荐 Idempotent Command Executor
```

并没有这样的公开结论。

但它说明：

```text id="m8z1wr"
Agent
→ payment system
```

已经不是单纯的软件 demo 问题。

一旦 Agent 进入：

```text id="x2n6jy"
high-value payment infrastructure
```

传统分布式系统的：

```text id="y4k7ms"
failure
retry
reconciliation
state
```

都会重新成为核心架构问题。

---

# 30. 为什么“整个 Workflow 一个 Transaction”特别不适合 Agent

假设：

```text id="s1j4vp"
Agent Workflow
```

包含：

```text id="a6m3zq"
LLM call
RAG
Tool
Approval
Payment
Notification
Reconciliation
```

如果强行：

```text id="t8y2dn"
BEGIN Distributed Transaction
```

一直持续到：

```text id="v5r8fk"
COMMIT
```

那么整个事务必须承受：

```text id="m2x6ca"
LLM latency
model failure
tool latency
human latency
network partition
vendor outage
queue delay
approval delay
```

但数据库 Transaction 的设计目标通常不是：

```text id="d7p9sx"
等待人类审批 8 小时
```

而是：

```text id="g3q4mw"
short-lived atomic operation
```

因此这种设计会造成：

```text id="e2r6na"
transaction duration ↑
locks / prepared state ↑
resource coupling ↑
failure surface ↑
```

PostgreSQL 官方对 prepared transaction 长时间存在的警告，就是一个非常直接的证据：prepared transaction 会持有锁，长时间存在会干扰数据库维护和资源管理。

---

# 31. Distributed Transaction 的参与者需要非常强的协议一致性

2PC 的前提之一是：

```text id="n5x7mk"
所有 participant
```

都知道：

```text id="c8q3vf"
prepare
commit
rollback
```

而 Agent Workflow 中：

```text id="g4v8za"
LLM
```

不知道这些概念。

```text id="x6m2rs"
Human Approval
```

也不是 XA participant。

```text id="p9k3yw"
Payment Provider
```

可能没有 XA。

```text id="q2d7mc"
Broker
```

通常也不会参与你的 local transaction manager。

所以：

> **如果参与者之间没有统一的 transactional protocol，2PC 就不是可用的边界。**

AWS 的 microservice guidance 直接指出，在 database-per-service 架构中，2PC 不适用，通常通过 Saga 处理跨服务事务。

---

# 32. 这不是“微服务才不能用 2PC”

也需要避免另一个过度结论：

> “只要是 Microservices，2PC 一定不能用。”

这也不准确。

如果：

```text id="f8j4xk"
服务
共享统一事务系统
参与者支持 XA
事务很短
可以接受协调成本
```

那么 2PC 仍然可能是可行的。

真正的问题是：

```text id="p2m9wr"
它不适合拿来承担 Agent Workflow 的业务恢复语义。
```

Microservices.io 将 2PC 视为跨服务事务的一种方式，并指出在数据库独立、松耦合的微服务架构里，Saga 更适合解决跨服务业务事务。

因此本文不是：

```text id="w6x1kr"
反 2PC
```

而是：

```text id="g8q2dz"
反对把 2PC 当作 Agent Retry Control。
```

---

# 33. 两个问题可以同时存在

例如：

```text id="b5m8qc"
Command Executor
```

内部：

```text id="s4x7pn"
PostgreSQL
```

里面有：

```text id="c8q2rm"
commands
idempotency_records
business_state
outbox
```

这些完全可以：

```text id="w3f7nk"
ONE local ACID transaction
```

同时：

```text id="m6j1xb"
External payment call
```

由：

```text id="r8q5zc"
Idempotent Adapter
```

控制。

因此最终架构：

```text id="z1f6mx"
Local Transaction
        +
Idempotent External Command
```

而不是：

```text id="a7p2qw"
One Giant Distributed Transaction
```

---

# 34. 典型实现

可以用 PostgreSQL：

```sql id="e8d9h1"
BEGIN;

INSERT INTO command_execution (
    operation_id,
    command_id,
    idempotency_key,
    request_hash,
    status
)
VALUES (
    $1,
    $2,
    $3,
    $4,
    'PROCESSING'
)
ON CONFLICT (idempotency_key)
DO NOTHING;

-- claim check

UPDATE business_state
SET ...
WHERE ...;

INSERT INTO outbox_event (
    event_id,
    operation_id,
    event_type,
    payload
)
VALUES (...);

COMMIT;
```

然后异步：

```text id="z7k3pm"
Outbox
 ↓
Queue
 ↓
Command Executor
 ↓
External Adapter
```

外部：

```text id="c4m8xz"
Provider Idempotency Key
=
derived from operationId
```

这样：

```text id="r3q9vn"
内部数据
```

可以获得真正的：

```text id="t8m5zw"
ACID atomicity
```

而：

```text id="p6c2kr"
external side effect
```

获得：

```text id="w9x4hf"
idempotent retry
```

这比 2PC 更符合各层的职责。

---

# 35. 一个非常重要的设计原则：Transaction 越小越好，Business Operation 可以很长

这可以成为 Agent Platform 的一条重要原则：

> **Short transaction, long-lived operation.**

例如：

```text id="v6m9qc"
Business Operation:
PAY-123
```

可以持续：

```text id="g3r5xb"
6 hours
```

但数据库 transaction：

```text id="n8q2mf"
claim operation
update state
write outbox
```

只持续：

```text id="c4j7hz"
milliseconds
```

外部执行：

```text id="p5x1vr"
async
```

最终：

```text id="w2k8mg"
reconcile
```

这样：

```text id="a7r4cn"
business lifetime
```

和：

```text id="v9m3yx"
transaction lifetime
```

彻底分离。

---

# 36. “Long-running Transaction”在这里是概念陷阱

有些人看到：

```text id="e8f2kn"
Trade Workflow
```

会称之为：

```text id="c7m4az"
long-running transaction
```

但这容易造成设计误导。

更准确：

```text id="m5n8vy"
long-running business process
```

其中包含多个：

```text id="u2q7wx"
short local transactions
```

以及：

```text id="p9f3ak"
commands
events
approvals
compensations
```

这正是 Saga 的思路。

AWS 对 Saga 的介绍也明确强调其适用于 long-lived transactions，并通过 local transactions 和 compensation 管理这种生命周期。

---

# 37. Agent Workflow 的状态应该是 Durable State，而不是 Transaction State

推荐：

```text id="h4r6ka"
Workflow:
WAITING_FOR_APPROVAL
```

存到：

```text id="j7m3yp"
Workflow Store
```

而不是：

```text id="v9q2cw"
数据库 transaction
```

保持：

```text id="a5f6rz"
open
```

8 小时。

Approval 到来：

```text id="n4k1xm"
Workflow resumes
```

创建：

```text id="r7t3pb"
Execution Command
```

然后：

```text id="j8m6ca"
local transaction
```

保存：

```text id="q2v9sd"
command accepted
```

整个系统就可以稳定恢复。

---

# 38. Checkpoint 与 2PC 的思维模型也完全不同

Checkpoint：

```text id="p2n7cx"
“我已经完成到这里。”
```

2PC Prepare：

```text id="r8k4vm"
“所有参与者已经准备好，
现在只等最终 Commit。”
```

两者看似相似，但语义不同。

Checkpoint 是：

```text id="y6m4az"
Recovery Marker
```

而 Prepare 是：

```text id="q3f7xn"
Transaction Protocol State
```

Agent Workflow 更需要：

```text id="s5p8yd"
durable checkpoint
+
idempotent execution
```

而不是：

```text id="n1c6vr"
open prepared transaction
```

---

# 39. Agent Replay 更进一步说明为什么需要 Idempotency

Agent Workflow 很可能发生：

```text id="f3r8zy"
replay
```

例如：

```text id="b7n2qx"
Step 1:
retrieve

Step 2:
calculate

Step 3:
submit payment
```

如果 Workflow 重新 replay：

```text id="h5q9mc"
Step 3
```

被再次执行。

如果：

```text id="w1c7fa"
Command Executor
```

发现：

```text id="p8r4kx"
operationId = PAYMENT-123
status = SUCCEEDED
```

就可以：

```text id="j3m9cz"
return existing result
```

这正是 AWS Durable Execution 推荐的模型：replay / retry 是正常机制，而 side-effecting steps 必须能够安全处理重复执行。

---

# 40. 为什么不能靠“Workflow Engine 保证 exactly once”来解决

这是现实架构中最容易出现的误区。

有些 Workflow Engine 确实可以提供：

```text id="r5c3nx"
exactly-once task execution
```

例如 AWS Step Functions Standard 的官方文档描述其默认 task/state execution model 为 exactly-once，除非显式配置 Retry。

但这里仍然不能推出：

```text id="q7m2va"
整个业务系统
=
exactly once
```

因为：

```text id="p8x5fj"
Workflow Engine
```

之外仍然可能有：

```text id="x6q3wy"
external API
payment network
broker
email
MCP server
legacy system
```

而且只要你显式配置：

```text id="t4m7kc"
Retry
```

就重新引入：

```text id="v8n2ya"
multiple attempts
```

AWS 自己也明确说明，在 Durable Execution SDK 中，即使是 at-most-once per retry，也不等于整个 workflow exactly-once。

所以：

> **Workflow Engine 的 execution semantics 不能替代 Business Command 的 idempotency semantics。**

---

# 41. 这也是为什么 Step Functions 的最佳实践仍然要求注意 Idempotency

AWS Step Functions Standard 确实提供强执行语义，但一旦状态机显式使用 retry，就可能再次执行 task。

因此：

```text id="e4n9bc"
Workflow-level recovery
```

与：

```text id="s7k2vm"
Task-level side effect safety
```

依然是两个问题。

这正好说明：

```text id="x5c8na"
Workflow Engine guarantees
```

和：

```text id="f9m3vb"
Application semantic guarantees
```

之间有一道边界。

---

# 42. 不能把事务锁当作 Agent 的业务防重机制

假设：

```text id="h7n2vp"
Account row locked
```

有人可能认为：

```text id="k6m3rx"
这就不会重复执行了。
```

不成立。

如果：

```text id="y3v8fz"
Transaction A
```

提交以后锁释放。

然后：

```text id="p6c4wm"
Retry transaction B
```

依然可以：

```text id="v8m2qr"
执行第二次业务动作
```

锁解决的是：

```text id="j4z7mc"
concurrent access
```

不是：

```text id="u5r8fn"
same logical operation
```

因此：

```text id="q7m3ha"
Lock
≠
Idempotency
```

---

# 43. Spanner 的事务语义也不能替代 External Idempotency

Google Spanner 提供非常强的事务语义，包括 serializable isolation / external consistency；但官方文档也明确提醒：

> Spanner 的内部锁只用于保护 Spanner 自身的数据一致性，不应该用来保证 Spanner 之外的 external resource exclusive access。

同时，Spanner transaction 可能因为内部优化或竞争而 abort，从而需要 transaction retry。

这对 Agent 架构有一个非常有价值的启示：

> **即使底层数据库本身提供非常强的分布式事务，进入数据库之外的 side effect 时，仍然需要单独的执行语义。**

所以：

```text id="v6c1wy"
DB Transaction
```

可以非常强。

但是：

```text id="h2n8zr"
DB Transaction
→ Broker
```

不能因此成为：

```text id="f9k3ws"
one global transaction
```

---

# 44. 推荐一个“Transaction Boundary Rule”

可以直接制定一条架构规则：

> **Transaction Boundary SHOULD end at the point where the system loses transactional control.**

例如：

```text id="v7q4mx"
Agent Platform
      ↓
PostgreSQL
      ↓
Outbox
```

可以属于：

```text id="s5w8pj"
local transaction
```

但：

```text id="a6r2bn"
Outbox
      ↓
Payment Provider
```

应该切换为：

```text id="k8m3vz"
Command Execution
+
Idempotency
+
Reconciliation
```

而不是：

```text id="p4y7sc"
extend the transaction
```

这条规则对金融系统尤其有用。

---

# 45. 一个完整的 Payment Architecture

```text id="e3j7vr"
                 Agent
                   │
                   ▼
              Workflow
                   │
                   ▼
          CreatePaymentCommand
                   │
                   ▼
            Policy / Approval
                   │
                   ▼
         Command Executor
                   │
          ┌────────┴─────────┐
          │ Local Transaction │
          │                  │
          │ command state    │
          │ idempotency      │
          │ outbox           │
          └────────┬─────────┘
                   │
                   ▼
              Payment Adapter
                   │
                   ▼
             Payment API
                   │
           ┌───────┴───────┐
           │               │
        SUCCESS          TIMEOUT
           │               │
           │               ▼
           │          RECONCILIATION
           │               │
           └───────────────┘
                   │
                   ▼
             Final State
```

这套设计不需要：

```text id="x6p9nf"
one global XA transaction
```

但可以得到：

```text id="y3k7va"
durable workflow
+
safe retry
+
atomic internal state
+
external reconciliation
```

---

# 46. 为什么这个模型更适合 Payment Provider

因为 Payment Provider 本身已经提供：

```text id="n2f8wx"
idempotency key
```

例如 Adyen：

```text id="s5k2ma"
same key
→ same payment effect
```

Stripe：

```text id="b8p4zr"
same key
→ same result
```

PayPal：

```text id="v6q3mn"
same request ID
→ same operation semantics
```

因此企业 Agent Platform 没有必要重新发明：

```text id="k9m4yx"
distributed transaction protocol
```

它只需要：

```text id="p5r7cw"
map internal operation identity
→ provider idempotency identity
```

这是更加简单、可扩展、与外部系统契约一致的设计。

---

# 47. Proxy Voting 也可以采用同样模式

例如：

```text id="c8f4nz"
SubmitProxyVoteCommand
```

内部：

```text id="r3m7yp"
operationId =
VOTE:M100:A123:P4:I7
```

Command Executor：

```text id="f6x2qm"
claim
validate entitlement
validate cutoff
validate policy
```

然后：

```text id="u8n5kr"
Outbox
```

到：

```text id="w2m4vc"
Proxy Voting Adapter
```

Vendor 如果支持：

```text id="p1x7dz"
instructionId
```

则：

```text id="s6n4qa"
instructionId = operationId
```

如果不支持：

```text id="h7m2cp"
adapter maintains
external reference
+
status query
```

这样：

```text id="e9f3ks"
workflow retry
```

不会直接：

```text id="r5k8zm"
blind resubmit vote
```

---

# 48. 交易系统尤其不能依赖长事务

例如：

```text id="q8r4sm"
Order lifecycle:
Created
Approved
Submitted
Accepted
PartiallyFilled
Filled
Settled
```

这个生命周期可能跨：

```text id="v3n6yk"
seconds
minutes
hours
```

显然不能：

```text id="m1q5cz"
keep database transaction open
```

正确模型应该是：

```text id="j8n2xf"
Order State
```

由：

```text id="w5k3pr"
durable state machine
```

管理。

每一个状态转移：

```text id="p7m4qa"
Command
```

通过：

```text id="v8n3sz"
Idempotent Executor
```

执行。

---

# 49. Command + Optimistic Concurrency 比 Distributed Transaction 更符合长流程

例如：

```text id="r6t2mk"
TradeOrder
version=7
```

Command：

```text id="n3c8qp"
expectedVersion=7
```

Executor：

```sql id="f4m9yb"
UPDATE trade_order
SET status = 'SUBMITTED',
    version = version + 1
WHERE order_id = ?
  AND version = 7;
```

如果：

```text id="q7c5zn"
affectedRows = 0
```

意味着：

```text id="v9m2kp"
stale command
```

这解决的是：

```text id="b3n5fx"
current state consistency
```

而：

```text id="t8q1wm"
idempotencyKey
```

解决：

```text id="j4z6pc"
duplicate execution
```

二者组合起来，通常比：

```text id="h7m3va"
keep everything under distributed lock / transaction
```

更适合长流程。

---

# 50. 一个成熟 Command Executor 应该同时具备四种能力

```text id="x6v2qp"
1. Idempotency
2. Concurrency Control
3. Preconditions
4. Reconciliation
```

可以理解为：

### Idempotency

```text id="q7m4sc"
同一个操作重复
→ 不重复副作用
```

### Concurrency

```text id="p3n8vk"
不同操作并发
→ 不违反资源竞争规则
```

### Preconditions

```text id="y5c2xm"
当前状态仍满足执行条件
```

### Reconciliation

```text id="r8m1qa"
不知道外部结果
→ 查询并收敛
```

这四个能力共同构成：

```text id="d7x4kp"
Business Execution Reliability
```

而 Distributed Transaction 只覆盖其中一部分：

```text id="m9c2vz"
atomicity
```

---

# 51. 什么时候 Distributed Transaction 反而是正确答案

为了避免过度结论，必须明确适用边界。

如果系统是：

```text id="w3q8mc"
Service A DB
Service B DB
```

并且：

```text id="g5k2nz"
双方支持 XA
事务很短
业务要求严格 atomic commit
参与者稳定
不跨人类审批
不跨外部 SaaS
```

那么：

```text id="p8v3rx"
2PC/XA
```

完全可以是合理选择。

例如：

```text id="q4m7ny"
金融内部记账系统
```

两个强关联 ledger tables / databases 必须原子更新。

这时候：

```text id="h8c3mz"
Distributed Transaction
```

确实可能比：

```text id="u9b5kq"
eventual consistency
```

更合适。

因此正确原则不是：

> “永远不要使用 Distributed Transaction。”

而是：

> **不要使用 Distributed Transaction 去承担本来属于 Idempotency、Workflow Recovery 和 Reconciliation 的职责。**

---

# 52. 甚至可以同时使用 2PC 和 Idempotency

这是现实系统里最合理的组合之一。

例如：

```text id="s8q3km"
Command Executor
```

内部：

```text id="n6v1rx"
XA transaction
```

更新：

```text id="g2m8yc"
Command state DB
Ledger DB
```

同时：

```text id="p3j7va"
operationId = OP-123
```

保证：

```text id="r5k9cw"
retry
```

不会重复创建第二笔业务操作。

所以：

```text id="v7m2qx"
2PC
+
Idempotency
```

完全可以共存。

区别在于：

```text id="x9k4pn"
2PC
=
internal atomicity

Idempotency
=
operation retry safety
```

---

# 53. 一个非常好的企业架构模板

```text id="m4q7xs"
                    Agent
                      │
                      ▼
                 Workflow
                      │
                at-least-once
                      │
                      ▼
              Business Command
                      │
                      ▼
           Authorization / Approval
                      │
                      ▼
          Idempotent Command Executor
                      │
             ┌────────┴─────────┐
             │                  │
       Local Atomic Tx       External
             │                  │
      ┌──────┼───────┐          │
      │      │       │          │
   Command  Idemp   Outbox      │
    State   Record   Event      │
      │      │       │          │
      └──────┴───────┘          │
             │                  ▼
             │           External Adapter
             │                  │
             │           idempotency /
             │           reference /
             │           reconcile
             │                  │
             └──────────┬───────┘
                        ▼
                 Business Outcome
```

如果内部多个数据库确实需要：

```text id="g2q8rm"
atomic commit
```

可以在：

```text id="n5v4px"
Local Atomic Tx
```

一层内部引入：

```text id="p7k3zm"
2PC/XA
```

而不是把整个：

```text id="v9m2aq"
Agent Workflow
```

包进去。

---

# 54. 为什么这个设计在金融企业特别重要

金融企业通常存在：

```text id="k2m7xf"
PostgreSQL
SQL Server
Snowflake
Broker
Payment Provider
Vendor Portal
CRM
Email
Message Bus
Legacy Mainframe
```

这些系统的：

```text id="m9r3vb"
transaction semantics
```

不同。

你很难把它们全部变成：

```text id="q5c7yn"
one global transaction manager
```

而且很多：

```text id="x1n8mk"
外部系统
```

属于：

```text id="v6r4ps"
organizational boundary
```

根本不可能允许你的 transaction manager：

```text id="z3m7qa"
prepare / commit / rollback
```

因此金融企业更现实的架构通常是：

```text id="g8p2mc"
Local ACID
+
Messaging
+
Workflow
+
Idempotency
+
Reconciliation
```

而不是：

```text id="k7x4nz"
Global XA
```

---

# 55. Regulatory/Audit 视角也更适合 Command + Idempotency

对于金融系统，最终需要能够回答：

```text id="h4x2qp"
谁发起？
哪个 Agent？
什么 Command？
什么时候执行？
执行了几次？
为什么 retry？
第一次发生了什么？
最终外部 reference 是什么？
```

如果整个系统只有：

```text id="v8n5mr"
distributed transaction log
```

通常无法直接回答：

```text id="a2k7cz"
业务操作 identity
```

而有：

```text id="m9q4vw"
operationId
commandId
attemptId
externalReference
```

就可以明确建立：

```text id="x5p3ka"
ONE business action
+
N technical attempts
```

这更接近 Agent Business Audit 所需要的结构。

FINRA 当前对 GenAI 的监管观察强调监督、审查/批准、agent actions、guardrails、持续监控等要求；这些是治理层面的要求，并非规定 2PC 或 Idempotency 的具体技术实现。

---

# 56. “为什么不用 Distributed Transaction”最重要的五个理由

可以把全文归纳成五个核心原因。

## 原因一：问题不同

```text id="f7m3ax"
2PC
→ atomic commit

Agent Retry
→ duplicate side-effect prevention
```

---

## 原因二：参与者不同

2PC 要求：

```text id="j5n8qm"
transaction participants
```

Agent Workflow 中常见：

```text id="v4c2xr"
LLM
Human
SaaS
Broker
Payment Network
MCP Server
```

这些不是天然的 XA participants。

---

## 原因三：生命周期不同

2PC：

```text id="k9w3pa"
short-lived transaction
```

Agent Workflow：

```text id="m6r1vx"
minutes → days
```

Human Approval 尤其不适合保持 prepared transaction。PostgreSQL 官方明确警告 prepared transactions 会持有锁，应尽快完成。

---

## 原因四：2PC 不理解业务操作 Identity

```text id="p5k8zm"
T1
T2
```

对 Transaction Manager 来说是两个合法 transaction。

对业务来说：

```text id="x2f7nc"
可能是同一个 Payment Operation 的两次 retry。
```

所以需要：

```text id="g9m4qa"
operationId
idempotencyKey
```

---

## 原因五：2PC 无法回滚外部不可事务化副作用

```text id="z4n7vx"
Broker accepted trade
Payment processed
Proxy vote submitted
Email sent
```

这些一旦发生：

```text id="j8m3kp"
ROLLBACK
```

通常并不存在。

需要：

```text id="r5c9ay"
idempotency
reconciliation
compensation
```

---

# 57. 一个简单的决策表

| 问题                | 更合适的机制                         |
| ----------------- | ------------------------------ |
| 两个数据库必须原子提交       | ACID / 2PC / XA                |
| 同一 API retry 不得重复 | Idempotency                    |
| Queue 重复投递        | Idempotent Consumer            |
| Workflow 中断后恢复    | Durable State / Checkpoint     |
| 跨服务长流程            | Workflow / Saga                |
| 外部操作结果不确定         | Reconciliation                 |
| 已发生操作需要业务逆转       | Compensation                   |
| DB + Message 双写   | Transactional Outbox           |
| 不同命令并发修改同一资源      | Optimistic Concurrency         |
| Retry 太多导致雪崩      | Retry Budget / Circuit Breaker |
| Agent 产生 mutation | Command + Policy + Approval    |

---

# 58. 一个非常实用的 Rule of Thumb

可以直接用下面这句话进行架构评审：

> **如果你发现自己正在考虑“为了防止 Agent Retry，把整个 Agent Workflow 放进一个 Distributed Transaction”，先问：这个问题究竟是 Atomicity，还是 Idempotency？**

如果答案是：

```text id="c7x4pm"
Idempotency
```

那么：

```text id="a5m8zr"
不要优先考虑 2PC。
```

而应该先设计：

```text id="y2n6vx"
operationId
commandId
idempotencyKey
atomic claim
result replay
reconciliation
```

如果答案是：

```text id="h8r3mw"
Atomicity
```

再考虑：

```text id="p4x7cz"
local transaction
distributed transaction
2PC
XA
```

---

# 59. Agent Platform 应该把这两种能力显式分开

平台 API 不要只有：

```typescript id="q8r5km"
transaction.execute(...)
```

而应该有：

```typescript id="m3v7pa"
commandExecutor.execute({
  operationId,
  command,
});
```

内部如果需要事务：

```typescript id="f9x2nc"
transaction.run(...)
```

这样：

```text id="a7m4zw"
Agent
```

面对的是：

```text id="t2k5vr"
Business Command
```

而不是：

```text id="x4p8qa"
Distributed Transaction
```

---

# 60. 一个更合理的 Command Executor API

```typescript id="v7m3qa"
interface CommandExecutor<TCommand, TResult> {

  execute(
    command: TCommand,
    context: ExecutionContext,
  ): Promise<ExecutionResult<TResult>>;

  reconcile(
    operationId: string,
  ): Promise<ReconciliationResult>;

  getStatus(
    operationId: string,
  ): Promise<ExecutionStatus>;
}
```

例如：

```typescript id="k8n4xz"
await executor.execute(
  submitProxyVoteCommand,
  {
    operationId: "VOTE:M100:A123:P4"
  }
);
```

内部：

```text id="r5j2kc"
idempotency
transaction
outbox
external adapter
```

全部由 Executor 管理。

---

# 61. 一个推荐的状态模型

```text id="m3r8qw"
Operation
──────────────
CREATED
VALIDATED
APPROVED
QUEUED
PROCESSING
SUCCEEDED
FAILED_RETRYABLE
FAILED_FINAL
UNKNOWN
RECONCILING
CANCELLED
EXPIRED
```

其中：

```text id="c8n5vz"
PROCESSING
```

表示：

```text id="x4r1ma"
当前执行中
```

```text id="w7m3kq"
UNKNOWN
```

表示：

```text id="v9n2cf"
不知道 external effect 是否发生
```

```text id="r6p8ax"
RECONCILING
```

表示：

```text id="q2k4mz"
正在通过 authoritative source 解决 UNKNOWN
```

这比：

```text id="j5v7nc"
RUNNING / FAILED
```

更加适合金融执行。

---

# 62. 外部系统不支持 Idempotency 时的最后选择

如果：

```text id="n4k7cz"
External API
```

完全：

```text id="f8m2rx"
non-idempotent
```

又不提供：

```text id="j3x5va"
status query
reference
```

那么必须承认：

> **系统无法同时保证自动 retry、零重复副作用和完全自动恢复。**

这不是：

```text id="b7m5qz"
代码写得不够好
```

而是：

```text id="c9x2kd"
系统能力边界
```

此时只能选择：

```text id="r6f3wm"
1. at-most-once + no automatic retry
2. manual reconciliation
3. business-level compensation
4. redesign integration contract
```

这是一个非常重要的架构诚实原则。

---

# 63. 不要为了“exactly once”牺牲系统可用性

如果外部系统：

```text id="h4n7vc"
不支持 idempotency
```

你可以选择：

```text id="m8p2zf"
at-most-once
```

来避免重复。

但代价可能是：

```text id="x7k5ra"
operation lost
```

而：

```text id="c6v4wm"
at-least-once
```

加 idempotency 的优势是：

```text id="g3r9pz"
recoverable
```

所以架构应该明确：

```text id="w5n2cy"
Which failure is more dangerous?
```

在金融系统中：

```text id="q2r7ma"
Duplicate payment
```

和：

```text id="f9k3vx"
Lost payment instruction
```

都可能严重。

而：

```text id="u8m5pw"
UNKNOWN
```

必须由：

```text id="j4q7zn"
reconciliation
```

解决。

---

# 64. 最终架构建议：不要追求“全局 exactly-once”，追求“业务效果可收敛”

这是全文最重要的结论。

不要把目标定义成：

```text id="c6m8zr"
Agent Workflow
=
Exactly Once
```

更合理的是：

```text id="r5p2xn"
Workflow
=
At-least-once + durable recovery

Command Executor
=
Idempotent

External Adapter
=
Provider-specific retry/idempotency

Reconciliation
=
Unknown outcome recovery
```

最终结果：

```text id="k8f4ya"
Many technical attempts
        ↓
One logical business operation
        ↓
One convergent business outcome
```

这是一种更现实的：

```text id="q4v7mz"
exactly-once-like business effect
```

但应避免把它表述成：

```text id="m6x2pc"
global exactly-once guarantee
```

因为跨组织、跨协议、跨外部系统的绝对 exactly-once，通常需要比单纯应用层 Idempotency 更强的基础设施和协议条件。

---

# 65. 对金融 Agent 最终可以形成一个六层模型

```text id="c2m7vx"
Layer 1 — Agent
────────────────────────
Reason
Plan
Propose

Layer 2 — Workflow
────────────────────────
State
Checkpoint
Retry
Redrive

Layer 3 — Command
────────────────────────
Business Intent
Operation ID
Command Hash

Layer 4 — Execution
────────────────────────
Idempotency
Precondition
Concurrency
Local Transaction

Layer 5 — External Effect
────────────────────────
Provider Idempotency
External Reference
Reconciliation

Layer 6 — Evidence
────────────────────────
Audit
Trace
Execution History
```

其中：

```text id="z8v5kn"
Distributed Transaction
```

只是 Layer 4 某些内部实现中的一个工具。

而不是：

```text id="g2n7wa"
覆盖整个六层模型的总机制。
```

---

# 66. 最终结论

为什么不要试图用 Distributed Transaction 解决 Agent Retry？

因为两者解决的是不同的故障模型。

Distributed Transaction 的核心问题是：

```text id="a8x3qb"
多个事务参与者
如何原子提交？
```

Agent Retry 的核心问题是：

```text id="r5m9cz"
同一个逻辑业务操作
被重复尝试以后
如何不产生重复业务副作用？
```

前者是：

```text id="v2q7ka"
Atomic Commit
```

后者是：

```text id="c4m8zy"
Idempotent Execution
```

再往外：

```text id="g6n3rx"
未知外部结果
```

又是：

```text id="p8r5mw"
Reconciliation
```

而：

```text id="y7c2va"
多步骤业务流程
```

则是：

```text id="m4q8zn"
Workflow / Saga
```

最合理的架构不是：

```text id="q9m3bx"
Agent
 ↓
Huge Distributed Transaction
 ↓
Everything
```

而是：

```text id="j6p2vz"
Agent
 ↓
At-least-once Durable Workflow
 ↓
Business Command
 ↓
Idempotent Command Executor
 ↓
Local ACID Transaction
 ↓
Outbox
 ↓
External Adapter
 ↓
Provider Idempotency / Reference
 ↓
Reconciliation
 ↓
Final Business State
```

这套设计的关键思想可以压缩为一句话：

> **不要让 Transaction 负责解决 Retry，也不要让 Retry 迫使整个业务流程变成一个 Transaction。**

应该让每种机制只解决它擅长的问题：

```text id="s3w7mq"
Transaction
→ atomic persistence

Workflow
→ durable orchestration

Idempotency
→ duplicate-safe retry

Saga
→ cross-step business recovery

Reconciliation
→ unknown external outcome

Compensation
→ reverse a completed business effect
```

对于金融 Agent，这一点尤其重要。

因为未来 Agent 不只是：

```text id="x5m2qr"
“回答一个问题”
```

而是会逐渐进入：

```text id="n7c4vz"
支付
交易
Proxy Voting
Corporate Action
Client Instruction
Cash Management
Operations
```

这些业务。

BIS 已经开始研究 Agent 在 RTGS 高价值支付系统中承担流动性管理工作的可能性；Visa 和 Mastercard 也正在将 Agent 引入支付交易基础设施。

在这种环境下，真正重要的不是：

```text id="e8m4za"
Agent 能不能“绝对只执行一次”
```

而是：

```text id="p6r9xn"
同一个业务操作，
即使发生 retry、replay、redelivery、worker crash、
workflow redrive 或 external timeout，
系统仍能识别它是同一个操作，
并最终收敛到唯一、可解释、可审计的业务结果。
```

这就是：

> **At-least-once Workflow + Idempotent Command Executor**

比“用 Distributed Transaction 解决 Agent Retry”更加合理的架构基础。

---

# 参考资料

## 一、Agent Workflow Reliability

**AWS Well-Architected Agentic AI Lens — Implement idempotent task execution patterns**
AWS 直接将 Idempotent Task Execution 定义为 Agent reliability 的高风险最佳实践，要求 deterministic idempotency key、conditional write、existing-result lookup，以及跨 Workflow 和 external system 的 key propagation。

[AWS — Implement idempotent task execution patterns](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentrel06-bp04.html?utm_source=chatgpt.com)

---

**AWS Well-Architected Agentic AI Lens — Reliability Design Principles**
强调 durable messaging、checkpointed workflow、idempotent steps、failure injection 与 recovery。

[AWS — Reliability design principles](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/reliability-design-principles.html?utm_source=chatgpt.com)

---

**AWS Durable Execution SDK — Idempotency and retries**
直接说明 at-least-once per retry、at-most-once per retry 的区别，并强调二者都不能自动提供整个 Workflow 的 exactly-once；同时给出 external idempotency key 的实践。

[AWS — Idempotency and retries](https://docs.aws.amazon.com/durable-execution/patterns/best-practices/idempotency/?utm_source=chatgpt.com)

---

**AWS Durable Execution SDK — Step Design**
说明有独立副作用的操作应适当拆分 Step，避免一个 Step 中多个 side effects 因 retry 被整体重做。

[AWS — Durable Execution best practices](https://docs.aws.amazon.com/durable-execution/patterns/best-practices/?utm_source=chatgpt.com)

---

**AWS Agentic AI Lens — Checkpoint-based recovery**
明确指出 checkpoint 如果没有 idempotency，就可能在 resume 时造成 duplicate side effects。

[AWS — Checkpoint-based recovery](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentrel03-bp03.html?utm_source=chatgpt.com)

---

## 二、Distributed Transaction / 2PC

**AWS Prescriptive Guidance — Saga Orchestration Pattern**
介绍 2PC 的 prepare/commit 机制，并说明 database-per-service 场景通常采用 Saga；同时说明长事务和跨服务事务的适用边界。

[AWS — Saga orchestration pattern](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/saga-orchestration.html?utm_source=chatgpt.com)

---

**AWS Prescriptive Guidance — Saga Pattern**
说明 Saga 如何通过 local transactions、continuation 和 compensation 管理跨服务长事务，并提醒 Saga 的复杂度会随参与者数量增加。

[AWS — Saga pattern](https://docs.aws.amazon.com/prescriptive-guidance/latest/modernization-data-persistence/saga-pattern.html?utm_source=chatgpt.com)

---

**Microservices.io — Saga Pattern**
讨论 database-per-service 场景下跨服务业务事务，以及为什么通常使用 Saga 而不是直接依赖 2PC。

[Microservices.io — Saga](https://microservices.io/patterns/data/saga.html?utm_source=chatgpt.com)

---

**PostgreSQL — Two-Phase Transactions**
PostgreSQL 官方对 2PC / prepared transaction 的实现、外部 transaction manager 以及 prepared state 的行为进行说明。

[PostgreSQL — Two-Phase Transactions](https://www.postgresql.org/docs/current/two-phase.html?utm_source=chatgpt.com)

---

**PostgreSQL — PREPARE TRANSACTION**
官方明确警告 prepared transaction 不应长时间存在，因为它会持续持有锁并影响 VACUUM 等数据库维护工作。

[PostgreSQL — PREPARE TRANSACTION](https://www.postgresql.org/docs/current/sql-prepare-transaction.html?utm_source=chatgpt.com)

---

**Microsoft SQL Server — COMMIT TRANSACTION / MS DTC**
说明 distributed transaction 在 SQL Server 中由 MS DTC 使用 two-phase commit 处理。

[Microsoft — COMMIT TRANSACTION](https://learn.microsoft.com/en-us/sql/t-sql/language-elements/commit-transaction-transact-sql?utm_source=chatgpt.com)

---

## 三、强一致分布式数据库为什么仍不能替代 External Idempotency

**Google Cloud Spanner — Transactions**
介绍 Spanner 的 serializable / external consistency 以及跨服务器事务，并特别指出其内部锁不能用于保护 Spanner 外部资源。

[Google Cloud — Spanner Transactions](https://cloud.google.com/spanner/docs/transactions?utm_source=chatgpt.com)

---

**Google Cloud Spanner — TrueTime and external consistency**
说明 Spanner 如何为数据库内部事务提供 external consistency。

[Google Cloud — TrueTime and external consistency](https://cloud.google.com/spanner/docs/true-time-external-consistency?utm_source=chatgpt.com)

---

## 四、真实支付系统中的 Idempotency

**Stripe — Idempotent Requests**
Stripe 官方直接把 Idempotency 用作安全 retry 的 API contract，并保存第一次请求结果、校验后续参数一致性。

[Stripe — Idempotent requests](https://docs.stripe.com/api/idempotent_requests?utm_source=chatgpt.com)

---

**Adyen — API Idempotency**
Adyen 明确说明 timeout 后可以使用相同 key retry，并不会重复扣款；同时定义 key scope、retention、concurrency conflict 和 backoff。

[Adyen — API idempotency](https://docs.adyen.com/development-resources/api-idempotency?utm_source=chatgpt.com)

---

**PayPal — Making API Requests**
PayPal 使用 `PayPal-Request-Id` 防止重复创建或修改业务对象，并支持相同 request ID 的 retry。

[PayPal — Making API Requests](https://developer.paypal.com/api/rest/?utm_source=chatgpt.com)

---

## 五、Messaging / At-least-once / Outbox

**Amazon SQS — Standard Queues**
SQS Standard 采用 at-least-once delivery，因此同一消息可能重复投递，消费者应能处理重复消息。

[Amazon SQS — Standard queues](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/standard-queues.html?utm_source=chatgpt.com)

---

**AWS — Transactional Outbox Pattern**
说明如何用 local transaction 同时写 business state 与 outbox，并强调 downstream consumer 仍必须支持 duplicate message。

[AWS — Transactional Outbox](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html?utm_source=chatgpt.com)

---

**Microservices.io — Idempotent Consumer**
经典 Idempotent Consumer Pattern，用于处理 at-least-once message delivery。

[Microservices.io — Idempotent Consumer](https://microservices.io/patterns/communication-style/idempotent-consumer.html?utm_source=chatgpt.com)

---

## 六、金融 Agent 与 Agentic Commerce

**BIS Working Paper 1310 — AI agents for cash management in payment systems**
研究 GenAI Agent 在 RTGS 高价值支付体系中的现金与流动性管理，并强调 regulatory safeguards 与 human oversight 的必要性。

[BIS — AI agents for cash management in payment systems](https://www.bis.org/publications/working-paper-1310-ai-agents-cash-management-payment-systems.htm?utm_source=chatgpt.com)

---

**Visa — Trusted Agent Protocol**
面向 Agentic Commerce 的 Agent recognition、签名消息、Consumer intent 和支付安全机制。

[Visa — Trusted Agent Protocol](https://developer.visa.com/capabilities/trusted-agent-protocol?utm_source=chatgpt.com)

---

**Mastercard — Agent Pay**
介绍 Agentic Tokens，以及 agentic commerce 中围绕 trust、security、control 建立的支付基础设施。

[Mastercard — Agent Pay](https://www.mastercard.com/us/en/business/artificial-intelligence/mastercard-agent-pay.html?utm_source=chatgpt.com)

---

## 七、金融监管与治理背景

**FINRA — 2026 Regulatory Oversight Report: GenAI**
讨论金融机构 GenAI 使用中的 supervision、review/approval、monitoring、agent actions、guardrails 和 human-in-the-loop。这里引用的是治理背景，不应被解释成 FINRA 对 2PC 或 Idempotency 的具体技术规定。

[FINRA — 2026 Regulatory Oversight Report: GenAI](https://www.finra.org/rules-guidance/guidance/reports/2026-finra-annual-regulatory-oversight-report/gen-ai?utm_source=chatgpt.com)

---

# 最终架构原则

如果只保留这一张图：

```text id="k9z4mf"
                Agent
                  │
                  ▼
        At-least-once Workflow
                  │
             durable state
             checkpoint
             retry
                  │
                  ▼
            Business Command
                  │
          stable Operation ID
                  │
                  ▼
      Idempotent Command Executor
                  │
        ┌─────────┴─────────┐
        │                   │
   Local ACID          External Effect
        │                   │
   command state        provider API
   idempotency          broker/vendor
   business state             │
   outbox                     │
        │                 idempotency /
        │                 reference /
        │                 reconciliation
        │                   │
        └──────────┬────────┘
                   ▼
             Final State
                   │
                   ▼
                 Audit
```

最终可以浓缩成三句话：

> **Distributed Transaction 解决 Atomic Commit，不解决 Agent Retry。**

> **Workflow 可以 At-least-once，真正产生业务副作用的 Command Executor 必须 Idempotent。**

> **对于无法事务化的外部金融系统，UNKNOWN Outcome 应通过 Idempotency + Reconciliation 收敛，而不是靠一个更大的 Distributed Transaction 掩盖问题。**

这才是从传统分布式系统走向金融 Agent Execution Architecture 时，更稳健的设计方向。

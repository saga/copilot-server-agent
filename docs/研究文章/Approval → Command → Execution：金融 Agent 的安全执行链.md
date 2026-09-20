# Approval → Command → Execution：金融 Agent 的安全执行链，具体实现和注意要点

## 摘要

当 Agent 只是查询资料、总结报告、解释政策时，错误通常停留在“输出错误”。

但当 Agent 开始：

* 提交交易；
* 发起付款或退款；
* 修改客户资料；
* 提交 Proxy Vote；
* 发送客户通信；
* 修改账户权限；
* 启动跨系统业务流程；

问题就发生了根本变化：

> **Agent 的输出不再只是文本，而可能成为现实世界的业务副作用。**

这也是金融 Agent 与普通 Chatbot 最大的架构区别之一。

传统应用通常由确定性的程序控制业务执行：

```text
User
  ↓
UI
  ↓
Application Service
  ↓
Business Logic
  ↓
Database / External API
```

Agent 则增加了一个概率性推理层：

```text
User
  ↓
Agent / LLM
  ↓
Tool Call
  ↓
Business System
```

如果直接允许 LLM 通过 Tool 调用业务 API，就会出现一个非常危险的隐含等式：

```text
LLM decides what to do
        =
System allows what can be done
```

这个等式在金融业务中不应该成立。

AWS 当前的 Agentic AI Lens 明确要求：每次 Agent Tool Invocation 都应在执行前经过外部声明式策略授权，并传播 Agent identity 和 originating user context；高风险写入、删除和金融操作应设置人工审查或其他控制。

因此，一个更合理的模型是：

```text
Agent
  ↓
Intent / Proposal
  ↓
Canonical Command
  ↓
Authorization / Policy
  ↓
Approval
  ↓
Execution
  ↓
Business Side Effect
```

本文将其进一步收敛成一个适合金融企业的控制链：

```text
Approval → Command → Execution
```

但这里必须先澄清一个非常重要的问题：

> **从工程实现顺序上，Approval 不应该真的发生在 Command 生成之前。**

因为审批必须知道自己批准的究竟是什么。

正确实现应该是：

```text
Proposal
   ↓
Canonical Command Snapshot
   ↓
Approval Request
   ↓
Approval Decision
   ↓
Approved Command
   ↓
Execution
```

也就是说：

> **“Approval → Command → Execution”描述的是安全控制关系，而不是对象创建的时间顺序。**

Command 必须在审批之前被冻结并成为审批对象；审批结果必须绑定到这个具体 Command，而不能只批准一个模糊的“Agent 操作”。

这实际上是传统金融控制中的一个老问题，在 Agent 时代被重新包装了一次：谁提出、谁授权、谁执行，必须形成明确的职责边界。Basel Committee 的操作风险框架长期强调审批权限、风险阈值以及 segregation of duties / dual control；其核心原则之一就是关键职责不能集中在同一个主体。

---

# 1. 为什么金融 Agent 需要一条独立的安全执行链

Agent 的危险性并不只是“模型可能 hallucinate”。

更准确地说，风险来自多个环节叠加：

```text
Prompt Injection
       ↓
错误理解用户意图
       ↓
选择错误 Tool
       ↓
生成错误参数
       ↓
使用错误上下文
       ↓
越权访问资源
       ↓
触发业务副作用
       ↓
重试 / 并发 / 超时
       ↓
重复执行或错误执行
```

例如用户说：

> “帮我把客户这笔费用退掉。”

一个普通 LLM 可能得到：

```json
{
  "paymentId": "P123",
  "amount": 20000
}
```

但真正执行一个退款还需要回答：

```text
这个 Payment 是否属于该客户？

是否确实可以退款？

已经退款了多少？

剩余可退款金额是多少？

当前用户是否有退款权限？

Agent 是否有该业务 Scope？

金额是否超过自动处理限额？

是否需要第二人审批？

客户是否存在特殊限制？

原交易状态是否发生变化？

这个退款是否已经执行过？

下游 Payment Provider 是否已经接受？

```

这些都不是 Prompt Engineering 可以可靠解决的问题。

FINRA 目前明确强调，证券行业在使用 GenAI 时，原有的监督、通信、记录保存和公平交易等义务仍然适用；其 2026 年 Regulatory Oversight Report 还特别指出，企业需要在部署 GenAI 之前考虑其监管责任、监督体系以及模型的 integrity、reliability 和 accuracy。

FCA 当前也采用类似思路：并没有把 AI 当作一个完全独立的监管领域，而是强调现有 accountability、governance、Consumer Duty 等框架仍然适用于 AI。

这意味着：

> **Agent 不会因为增加了 AI 这一层，就获得一个新的“业务责任真空”。**

原来由人和确定性系统承担的控制责任，在 Agent 场景仍然存在。

---

# 2. Approval、Command、Execution 到底分别解决什么问题

这三个概念必须严格区分。

| 层         | 核心问题          | 典型内容                                  |
| --------- | ------------- | ------------------------------------- |
| Approval  | 谁允许这个动作发生？    | approver、decision、policy、scope        |
| Command   | 究竟准备执行什么动作？   | operation、resource、parameters         |
| Execution | 如何可靠地产生业务副作用？ | handler、transaction、retry、idempotency |

因此：

```text
Approval ≠ Command
Command ≠ Execution
```

更加完整地说：

```text
Approval
    = authorization decision

Command
    = immutable business action

Execution
    = controlled realization of that action
```

例如：

```text
Approval:
“允许提交该账户、该会议、该 Proposal 的 FOR 投票。”

Command:
SubmitProxyVote(
    account = A123,
    meeting = M456,
    proposal = P7,
    vote = FOR
)

Execution:
调用投票执行系统并记录结果。
```

这三个对象应该分别存在。

---

# 3. 为什么“先批准、再生成 Command”其实是错误设计

表面上看：

```text
Approval
   ↓
Command
   ↓
Execution
```

非常符合直觉。

但如果系统真的这么实现：

```text
User
  ↓
Approval:
  “批准这个退款”
  ↓
LLM 生成 RefundCommand
  ↓
Execute
```

就出现了一个严重漏洞：

> **批准人批准的“这个退款”，和最终执行的 Command 可能不是同一个东西。**

例如批准时显示：

```text
Customer: C123
Amount: $1,000
Payment: P123
```

但 Agent 在批准之后修改成：

```text
Customer: C999
Amount: $100,000
Payment: P999
```

如果系统只保存：

```text
approval = approved
```

而没有绑定具体 Command，那么审批实际上失去了意义。

因此正确结构是：

```text
Agent Proposal
      ↓
Canonical Command
      ↓
Command Hash
      ↓
Approval Request
      ↓
Human / Policy Decision
      ↓
Approved Command
      ↓
Execution
```

所以本文所谓：

```text
Approval → Command → Execution
```

应该理解成：

```text
Approved Command
       ↓
Execution
```

其中：

```text
Approval
```

是 Command 的控制状态，而不是它的数据来源。

---

# 4. 推荐的完整生命周期

一个金融 Agent 的 mutation 应该经过：

```text
                 ┌────────────────────┐
                 │       Agent        │
                 │  reasoning / plan  │
                 └─────────┬──────────┘
                           │
                           ▼
                 ┌────────────────────┐
                 │     Proposal       │
                 │ untrusted input    │
                 └─────────┬──────────┘
                           │
                           ▼
                 ┌────────────────────┐
                 │ Command Builder    │
                 │ schema validation  │
                 │ canonicalization   │
                 │ identity binding   │
                 └─────────┬──────────┘
                           │
                           ▼
                 ┌────────────────────┐
                 │ Canonical Command  │
                 │ immutable snapshot │
                 └─────────┬──────────┘
                           │
                           ▼
                 ┌────────────────────┐
                 │ Policy / AuthZ     │
                 └─────────┬──────────┘
                           │
                 ┌─────────┴───────────┐
                 │                     │
              DENY              REQUIRES_APPROVAL
                 │                     │
                 ▼                     ▼
             Rejected              Approval
                                       │
                             ┌─────────┴─────────┐
                             │                   │
                           DENY                APPROVE
                             │                   │
                             └─────────┬─────────┘
                                       │
                                       ▼
                              ┌─────────────────┐
                              │ ApprovedCommand │
                              └────────┬────────┘
                                       │
                                       ▼
                              ┌─────────────────┐
                              │    Executor     │
                              │                 │
                              │ precondition    │
                              │ idempotency     │
                              │ transaction     │
                              │ retry           │
                              └────────┬────────┘
                                       │
                                       ▼
                              Business Side Effect
                                       │
                                       ▼
                                  Audit/Event
```

这个结构的核心是：

> **Agent 可以产生 Proposal；只有 Control Plane 才能把 Proposal 变成 Approved Command。**

---

# 5. Agent Proposal 不应该等于 Command

这是整个设计里最重要的边界之一。

Agent 可以输出：

```json
{
  "type": "RefundPayment",
  "paymentId": "P123",
  "amount": 1000,
  "reason": "customer requested refund"
}
```

但它不能输出：

```json
{
  "commandId": "CMD-123",
  "userId": "ADMIN",
  "approved": true,
  "policyDecision": "ALLOW",
  "approver": "CEO",
  "riskLevel": "LOW"
}
```

因为第二组字段属于可信系统控制域。

推荐：

```typescript
interface AgentProposal<T> {
  type: string;
  payload: T;
}
```

而系统生成：

```typescript
interface CommandEnvelope<T> {
  commandId: string;
  commandType: string;
  schemaVersion: number;

  payload: T;

  actor: {
    userId: string;
    agentId: string;
  };

  correlationId: string;
  causationId?: string;

  idempotencyKey: string;

  commandHash: string;

  createdAt: string;
  expiresAt?: string;
}
```

其中：

```text
commandId
actor
agentId
authorization context
policy decision
approval state
commandHash
```

都不应该由 LLM 自行声明。

AWS Agentic AI Lens 当前明确建议区分 Agent identity 与 Human identity，并在代表用户行动时传播用户上下文，而不是让 Agent 直接拿用户凭证。

---

# 6. Command 必须是业务级对象

一个常见错误是把底层技术调用直接包装成 Command：

```text
HttpRequestCommand
PostgresCommand
GraphQLCommand
LambdaCommand
MCPCallCommand
```

这并没有真正建立控制边界。

更合理的是：

```text
SubmitProxyVoteCommand
CreateTradeOrderCommand
RefundPaymentCommand
ChangeCustomerAddressCommand
ApprovePaymentCommand
FreezeAccountCommand
SendClientCommunicationCommand
```

也就是说：

> **Command 的粒度应该对应业务能力，而不是底层 API。**

例如：

```text
Agent
 ↓
SubmitProxyVoteCommand
 ↓
Policy
 ↓
Approval
 ↓
ProxyVoteExecutor
 ↓
ISS / internal voting system
```

而不是：

```text
Agent
 ↓
POST https://iss.example.com/api/v1/vote
```

后者把 Agent 直接暴露在技术接口层，导致：

* Vendor API 细节暴露给 Agent；
* Policy 很难基于业务语义工作；
* Vendor 更换影响 Agent；
* audit 无法自然表达业务动作；
* 权限容易按 API 粒度失控。

---

# 7. Command 必须 Immutable

Approval 最大的一个安全要求是：

> **审批之后，Command 的关键业务字段不能被修改。**

典型关键字段包括：

```text
account
customer
amount
currency
instrument
order side
order quantity
beneficiary
vote
recipient
permissions
```

因此：

```typescript
interface ApprovedCommand<T> {
  readonly command: Command<T>;
  readonly commandHash: string;

  readonly approval: {
    decision: "APPROVED";
    approverId: string;
    approvedAt: string;
    policyId: string;
    policyVersion: string;
    approvedCommandHash: string;
  };
}
```

执行前重新计算：

```typescript
const currentHash =
  hashCanonicalCommand(command);

if (
  currentHash !==
  approval.approvedCommandHash
) {
  throw new Error(
    "Approved command has been modified"
  );
}
```

这是整个 Approval → Command 链中非常值得标准化的机制。

---

# 8. 为什么 Command Hash 很重要

假设审批页面显示：

```text
Account: A123
Instrument: XYZ
Quantity: 10,000
Side: BUY
Limit Price: 100
```

审批人点击：

```text
Approve
```

此时系统应该保存：

```text
commandHash = SHA-256(canonical command)
```

批准记录：

```json
{
  "commandId": "CMD-001",
  "commandHash": "9e5c...",
  "approverId": "U123",
  "approvedAt": "2026-09-20T08:00:00Z"
}
```

执行时：

```text
commandHash at approval
            ==
commandHash at execution
```

才允许执行。

这建立了一个非常清晰的控制关系：

```text
Human approved X
        ↓
System executes exactly X
```

而不是：

```text
Human approved something
        ↓
Agent later decides what it means
```

---

# 9. Approval 不应该只是一个 Boolean

很多系统最终会做成：

```typescript
approved: boolean;
```

这对于金融业务远远不够。

至少建议：

```typescript
interface ApprovalDecision {
  approvalId: string;

  commandId: string;
  commandHash: string;

  decision:
    | "APPROVED"
    | "REJECTED"
    | "EXPIRED"
    | "CANCELLED";

  approver: {
    userId: string;
    role: string;
  };

  policyId: string;
  policyVersion: string;

  decidedAt: string;

  reason?: string;
}
```

必要时还需要：

```text
approvalLevel
approvalScope
delegation
expiresAt
secondApprover
businessJustification
stepUpAuthentication
```

这样才能形成：

```text
Command
   ↓
Approval Request
   ↓
Approval Decision
   ↓
Execution Evidence
```

---

# 10. Approval 本身也应该有权限模型

最危险的设计之一是：

```text
Requester = Approver
```

例如：

```text
Agent proposes trade
        ↓
Agent approves trade
        ↓
Agent executes trade
```

这样 Approval 根本没有控制价值。

传统金融内部控制长期强调职责分离、双重控制和明确审批权限。Basel Committee 的相关原则要求银行建立清晰的授权和审批流程、风险阈值监控以及适当的 segregation of duties / dual controls。

因此：

```text
Maker
  ≠
Checker
```

至少对于高风险操作：

```text
Agent / Operator
       ↓
Proposal
       ↓
Approver
       ↓
Executor
```

Approver 的权限应该通过独立的 Authorization 系统验证：

```typescript
authorization.canApprove({
  user,
  command,
  approvalLevel
});
```

而不是：

```typescript
if (user.role === "admin") {
  approved = true;
}
```

---

# 11. Approval Policy 应该是声明式的

不要让：

```text
LLM
```

自行决定：

```text
"this seems low risk"
```

也不要让每个 Agent Developer 自己写：

```typescript
if (amount > 10000) ...
```

更好的设计是：

```text
Command
   ↓
Risk classification
   ↓
Policy Engine
   ↓
Approval requirement
```

例如：

```yaml
command: CreateTradeOrder

rules:
  - when:
      amount: "<= 100000"
      instrumentRisk: "STANDARD"
    then:
      approval: "NONE"

  - when:
      amount: "> 100000"
    then:
      approval:
        required: true
        role: "TRADER_SUPERVISOR"

  - when:
      instrumentRisk: "RESTRICTED"
    then:
      approval:
        required: true
        role: "COMPLIANCE"
```

这样：

```text
Agent
```

不会知道也不会控制：

```text
"what amount requires approval?"
```

它只能看到最终结果：

```text
REQUIRES_APPROVAL
```

---

# 12. Approval 与 Authorization 不是一回事

这是另外一个容易混淆的地方。

Authorization 回答：

> “这个主体有没有权限执行这个动作？”

Approval 回答：

> “对于这次具体操作，在当前条件下，是否需要并且已经获得额外授权？”

例如：

```text
Trader A
```

本来就有：

```text
TRADE_SUBMIT
```

但：

```text
BUY $50m of restricted asset
```

仍然可能需要：

```text
Supervisor Approval
```

所以：

```text
Authentication
    ↓
Authorization
    ↓
Policy
    ↓
Approval
    ↓
Execution
```

这几个控制点不能合并。

AWS 对 Agent Tool Authorization 的建议也是把授权放在 Agent 外部，并在 Tool 执行前基于策略进行检查；对高风险 mutation 则进一步采用 human review。

---

# 13. Agent Identity 与 Human Identity 必须分开

不要：

```text
Agent
  =
User
```

也不要：

```text
Agent
  =
User's OAuth credential
```

更合理的是：

```text
Human Identity
      │
      │ initiates
      ▼
Agent Identity
      │
      │ acts on behalf of
      ▼
Command
      │
      ▼
Authorization
```

例如：

```json
{
  "actor": {
    "userId": "U123",
    "agentId": "AGENT-456"
  }
}
```

系统应该能够回答：

```text
这个人是谁？

哪个 Agent 执行？

Agent 是代表谁？

Agent 当时具有什么权限？

最终谁承担业务责任？

```

AWS 当前的 Agentic AI Lens 明确建议 Agent 使用独立的 service identity，并在代表用户执行时传播 signed user context，同时避免 Agent 直接取得用户凭证。

---

# 14. Data Entitlement 和 Command Authorization 也必须分离

金融系统中：

```text
Can Read
```

不等于：

```text
Can Act
```

例如用户可以：

```text
读取客户持仓
```

但不一定可以：

```text
提交客户交易
```

因此：

```text
Retrieval
  ↓
Data Entitlement
```

与：

```text
Command
  ↓
Business Authorization
```

是两套控制。

一个 Agent 可能拥有：

```text
portfolio.read
```

但只有：

```text
trade.submit
```

才能形成：

```text
CreateTradeOrderCommand
```

甚至：

```text
trade.submit
```

也不意味着：

```text
trade.approve
```

这使得 Agent 的权限体系能够真正遵循 least privilege。

---

# 15. Policy 决策不能依赖 RAG

这是金融 Agent 中非常重要的一条边界。

错误模型：

```text
RAG
 ↓
"Policy allows trades under 10%"
 ↓
LLM
 ↓
Execute
```

因为 RAG 找到的材料只是：

```text
evidence
```

而不是：

```text
authoritative authorization decision
```

更合理的是：

```text
RAG
 ↓
Agent reasoning
 ↓
Proposal
 ↓
Policy Engine
 ↓
Current authoritative policy
 ↓
Approval
 ↓
Execution
```

RAG 可以帮助 Agent：

```text
理解政策
寻找证据
解释原因
```

但是不能绕过：

```text
current entitlement
current policy
current limits
current approval requirement
```

这也是为什么：

> **Retrieval 是 information plane，Command 是 control plane。**

---

# 16. Command Executor 才是副作用真正发生的地方

Command 不应该自己调用：

```text
database
HTTP
MCP
payment provider
broker
```

例如：

```typescript
class RefundPaymentCommand {
  execute() {
    stripe.refunds.create(...);
  }
}
```

这会让 Command 同时承担：

```text
data
authorization
policy
execution
infrastructure
```

更合理的是：

```text
Command
   ↓
Command Handler
   ↓
Domain Service
   ↓
Infrastructure Adapter
```

例如：

```typescript
class RefundPaymentHandler {

  constructor(
    private paymentRepository: PaymentRepository,
    private refundPolicy: RefundPolicy,
    private paymentGateway: PaymentGateway,
  ) {}

  async execute(
    command: RefundPaymentCommand
  ) {
    const payment =
      await this.paymentRepository.get(
        command.payload.paymentId
      );

    this.refundPolicy.validate(
      payment,
      command
    );

    return this.paymentGateway.refund(
      ...
    );
  }
}
```

这样 Agent Runtime 根本不知道：

```text
Stripe
Adyen
ISS
Broker API
```

这些细节。

---

# 17. Execution 前必须重新检查业务前置条件

Agent 的一个特殊问题是：

> **它经常基于过去读到的状态做决定。**

例如：

```text
10:00
Agent reads:

Order = PENDING
```

然后：

```text
10:03
Another system changes:

Order = CANCELLED
```

最后：

```text
10:04
Agent executes:

CancelOrderCommand
```

不能假设：

```text
Agent 之前看到的状态
=
Execution 时的状态
```

所以 Command 应该包含：

```typescript
expectedVersion: number;
```

执行：

```sql
UPDATE orders
SET status = 'CANCELLED',
    version = version + 1
WHERE id = :id
  AND status = 'PENDING'
  AND version = :expectedVersion;
```

如果：

```text
affectedRows = 0
```

就说明：

```text
PRECONDITION_FAILED
```

此时应该停止，而不是让 Agent 自己猜：

```text
“那我是不是继续执行？”
```

---

# 18. Command 应该有明确状态机

推荐至少：

```text
DRAFT
   ↓
VALIDATED
   ↓
POLICY_CHECKED
   ↓
AWAITING_APPROVAL
   ↓
APPROVED
   ↓
QUEUED
   ↓
EXECUTING
   ↓
SUCCEEDED

                         ↘
                          FAILED
```

以及：

```text
REJECTED
EXPIRED
CANCELLED
STALE
FAILED_FINAL
```

例如：

```typescript
type CommandStatus =
  | "DRAFT"
  | "VALIDATED"
  | "AWAITING_APPROVAL"
  | "APPROVED"
  | "QUEUED"
  | "EXECUTING"
  | "SUCCEEDED"
  | "REJECTED"
  | "EXPIRED"
  | "STALE"
  | "FAILED"
  | "CANCELLED";
```

重要的是：

> **这些状态属于 Business Control Plane，而不是 Agent Memory。**

Agent Memory 不应该是：

```json
{
  "tradeStatus": "AWAITING_APPROVAL"
}
```

真正的状态应该存放在：

```text
Command Store
Workflow Store
Business Database
```

中的 durable state。

---

# 19. Idempotency 是 Command Execution 的基础

金融操作绝不能简单理解为：

```text
timeout
→ retry
→ execute again
```

例如：

```text
Agent
 ↓
Payment Provider
 ↓
timeout
```

到底是：

```text
payment failed
```

还是：

```text
payment succeeded but response lost
```

系统不知道。

如果 Agent 自己 retry：

```text
$100
+
$100
```

就可能发生重复扣款。

Stripe 官方文档明确支持通过 idempotency key 在网络错误后安全重试创建或更新请求，并让相同 key 的后续请求得到同一结果。

因此 Command 至少需要：

```text
commandId
idempotencyKey
```

例如：

```text
commandId:
CMD-82A1

idempotencyKey:
PAYMENT:ORDER-123:CAPTURE
```

重试时：

```text
commandId = CMD-82A2
```

可以不同。

但：

```text
idempotencyKey
```

必须保持一致。

---

# 20. Command ID 与 Idempotency Key 不应该混为一谈

这是实现中一个经常被忽略的小细节。

```text
commandId
```

表示：

> 某个 Command instance。

而：

```text
idempotencyKey
```

表示：

> 同一个业务操作的重复请求。

例如：

```text
第一次：
commandId = CMD-1
idempotency = REFUND:P123:1000

retry：
commandId = CMD-2
idempotency = REFUND:P123:1000
```

Executor 看到：

```text
same idempotency key
```

应该返回之前的业务结果，而不是再次执行。

---

# 21. Execution Retry 不应该交给 LLM

不要让模型自己决定：

```text
retry 3 times
```

应该由 Executor / Workflow 控制：

```text
retryable?
maxAttempts
backoff
jitter
timeout
circuitBreaker
deadLetter
```

例如：

```typescript
const retryPolicy = {
  maxAttempts: 3,
  backoff: "exponential",
  retryOn: [
    "PROVIDER_TIMEOUT",
    "HTTP_503"
  ]
};
```

但：

```text
INSUFFICIENT_ENTITLEMENT
APPROVAL_REQUIRED
INVALID_AMOUNT
STALE_VERSION
```

不应该自动 retry。

否则可能出现：

```text
Agent
 ↓
permission denied
 ↓
retry
 ↓
permission denied
 ↓
retry
 ↓
runaway loop
```

AWS Agentic AI Lens 也强调应该通过 rate limits 等机制限制 Agent runaway loop 的影响范围。

---

# 22. Transactional Outbox：Command 如何可靠进入 Execution

假设：

```text
Command Service
```

需要同时：

```text
1. 保存 command
2. 发布 message
```

如果：

```text
DB commit 成功
Message publish 失败
```

Command 就可能永远没人执行。

反过来：

```text
Message publish 成功
DB commit 失败
```

消费者收到一个不存在的 Command。

Transactional Outbox 的基本做法是：

```text
DB Transaction
 ├── command
 └── outbox event

COMMIT
    ↓
Outbox Relay
    ↓
Queue
    ↓
Executor
```

AWS 官方 Prescriptive Guidance 正是用 Transactional Outbox 解决这种 dual-write 问题，同时特别提醒消费者必须考虑 duplicate delivery，因此 downstream consumer 仍需幂等。

因此：

> **Outbox 保证可靠发布，不等于 exactly-once execution。**

仍然需要：

```text
Outbox
+
Idempotent Consumer
+
Downstream Idempotency
```

---

# 23. 一个典型的 Command Store

建议 Command Store 至少保存：

```sql
CREATE TABLE business_command (
    command_id           UUID PRIMARY KEY,

    command_type         VARCHAR(100) NOT NULL,
    schema_version       INTEGER NOT NULL,

    payload              JSONB NOT NULL,

    user_id              VARCHAR(100) NOT NULL,
    agent_id             VARCHAR(100) NOT NULL,

    correlation_id       VARCHAR(100) NOT NULL,
    causation_id         VARCHAR(100),

    idempotency_key      VARCHAR(255) NOT NULL,

    command_hash         VARCHAR(128) NOT NULL,

    status               VARCHAR(50) NOT NULL,

    policy_id            VARCHAR(100),
    policy_version       VARCHAR(50),

    approval_id          UUID,

    created_at           TIMESTAMP NOT NULL,
    approved_at          TIMESTAMP,
    started_at           TIMESTAMP,
    completed_at         TIMESTAMP,
    expires_at           TIMESTAMP
);

CREATE UNIQUE INDEX ux_command_idempotency
ON business_command(idempotency_key);
```

实际系统还需要根据业务定义：

```text
tenant
resource scope
classification
retention
regional boundary
external reference
execution attempt
failure reason
```

但核心思想是：

> **Command 是 durable business state，而不是 HTTP request。**

---

# 24. Approval Store 与 Command Store 可以分开

并不要求：

```text
Command
```

和：

```text
Approval
```

一定存储在同一张表。

更清晰的设计通常是：

```text
Command Store
     │
     ├── command
     ├── status
     └── execution state

Approval Store
     │
     ├── approval request
     ├── approver
     ├── decision
     └── command hash

Audit Store
     │
     ├── immutable events
     └── evidence
```

通过：

```text
commandId
approvalId
correlationId
```

关联。

这样：

```text
Approval
```

是一个独立的治理对象，而不是 Command 的一个简单 Boolean 字段。

---

# 25. Approval Request 应该展示什么

金融业务中，最危险的审批 UI 是：

```text
Agent asks for approval

[Approve] [Reject]
```

但没有告诉审批人：

```text
Approve what?
```

一个合格的 Approval Request 至少应展示：

```text
Business Action
    Submit Proxy Vote

Account
    A123

Security
    XYZ

Meeting
    M456

Proposal
    P7

Vote
    FOR

Reason
    Based on policy X

Agent
    ProxyVotingAgent v3

User
    U123

Policy
    ProxyVotingPolicy v7

Risk
    Medium

Expires
    2026-09-20 17:00

Command Hash
    9e5c...
```

审批人应该真正知道：

> **我正在批准哪个业务动作。**

而不是：

> **Agent 说它需要批准。**

---

# 26. Approval 页面不应该使用未经验证的 Agent Summary 作为唯一依据

Agent 可以帮助生成：

```text
“为什么建议执行这个操作”
```

但 Approval UI 的关键事实应该从：

```text
canonical command
authoritative business data
policy engine
```

生成。

例如：

```text
Agent explanation:
“我认为该客户要求退款。”

```

不能代替：

```text
Source:
Customer Case #123
Payment P456
Refundable amount = $1,000
```

NIST AI RMF 强调 AI 系统需要具备 accountability、transparency、reliability 等可信属性，并指出人在 AI 系统中仍需要承担判断和监督作用；其 GenAI Profile 还特别提醒 automation bias，即人可能因为系统看起来复杂或可靠而过度依赖模型输出。

因此：

> **Human Approval 应该审核业务事实和风险，而不是只审核 LLM 的措辞。**

---

# 27. 这也是为什么 Approval 不能简单等于 “HITL”

很多 Agent Framework 已经提供 Human-in-the-loop。

例如 OpenAI Agents SDK 当前支持：

```text
Tool Call
   ↓
needsApproval
   ↓
interruption
   ↓
RunState
   ↓
approve / reject
   ↓
resume
```

这是很有价值的 runtime 能力。

但企业金融系统不能把：

```text
Agent Runtime Approval
```

直接等价成：

```text
Enterprise Business Approval
```

因为 Runtime HITL 通常回答的是：

> “这个 Tool Call 是否可以继续？”

而企业业务审批可能需要回答：

> “这个交易是否符合授权矩阵、业务限额、账户委托、监管要求和四眼原则？”

因此推荐：

```text
Agent Runtime
    ↓
Tool approval interrupt
    ↓
Business Command
    ↓
Enterprise Approval Service
```

也就是说：

> **Agent Runtime HITL 是机制，Business Approval 是治理对象。**

---

# 28. Proxy Voting 是非常典型的金融 Agent 场景

假设用户说：

> “帮我处理这次股东大会投票。”

Agent 可以：

```text
读取会议材料
读取公司政策
读取历史投票
读取研究报告
分析 Proposal
提出：

Proposal 4 → FOR
Proposal 5 → AGAINST
```

这些都是：

```text
Agent Proposal
```

而不是：

```text
SubmitProxyVoteCommand
```

真正执行时应该生成：

```typescript
interface SubmitProxyVotePayload {
  meetingId: string;
  accountId: string;
  securityId: string;

  proposalId: string;
  vote: "FOR" | "AGAINST" | "ABSTAIN";

  expectedMeetingVersion: number;
}
```

然后：

```text
Agent
 ↓
Vote Proposal
 ↓
Command
 ↓
Check:
   - account entitlement
   - mandate
   - voting policy
   - market restrictions
   - cutoff time
   - duplicate submission
 ↓
Approval if required
 ↓
SubmitProxyVoteExecutor
 ↓
Voting System / Vendor
```

注意：

```text
“FOR”
```

只是 Agent 的判断。

而：

```text
SubmitProxyVoteCommand
```

才是企业系统要控制的业务动作。

这个区别对于任何“Agent 给建议 + 人确认 + 系统执行”的金融场景都适用。

---

# 29. Trade Order 更能体现 Maker / Checker

例如：

```text
User:
“买入 100,000 股 XYZ，限价 100。”
```

Agent 得到：

```text
CreateTradeOrderProposal
```

系统 canonicalize 后形成：

```json
{
  "account": "A123",
  "instrument": "XYZ",
  "side": "BUY",
  "quantity": 100000,
  "limitPrice": 100
}
```

然后：

```text
Policy
 ↓
Check:
    account entitlement
    position limits
    buying power
    restricted list
    trading permissions
    instrument eligibility
    order size
```

随后：

```text
Approval
```

最终：

```text
CreateTradeOrderCommand
```

进入：

```text
Trade Execution Service
```

这其实与传统金融系统中的：

```text
maker
checker
execution
audit
```

结构高度兼容。

Basel 的操作风险原则长期强调清晰的审批权限、风险限额以及职责分离；其核心控制思想并不会因为业务入口从 GUI 变成 Agent 而消失。

---

# 30. Payment / Refund 是 Idempotency 最明显的案例

例如：

```text
RefundPaymentCommand
```

包含：

```text
paymentId
amount
currency
```

系统生成：

```text
idempotencyKey =
REFUND:P123:1000:USD
```

执行：

```text
Payment Provider
```

如果出现：

```text
timeout
```

Executor 可以：

```text
retry same idempotencyKey
```

而不是：

```text
create new refund
```

支付行业已经长期采用这一类机制。Stripe 将 idempotency 明确作为安全 retry 的机制；Adyen 等支付平台同样提供相关能力。

Agent 只是让这个问题变得更加重要，因为 Agent 天生具有：

```text
autonomous retry
tool selection
multi-step reasoning
```

因此 retry boundary 必须放在 Agent 之外。

---

# 31. Command Expiration 对金融业务尤其重要

很多金融操作具有明确的时间窗口。

例如：

```text
Proxy Vote
Trade Order
Payment Approval
Client Instruction
Corporate Action
```

因此 Command 应该可以：

```typescript
expiresAt: string;
```

例如：

```text
createdAt:
2026-09-20 15:00

expiresAt:
2026-09-20 16:00
```

即使：

```text
Approval = APPROVED
```

到了：

```text
16:01
```

也不能执行。

执行前必须检查：

```text
currentTime < expiresAt
```

这样：

```text
Approval
```

不会永久有效。

---

# 32. Approval 可以失效

即使已经批准，也可能因为业务状态改变而失效。

例如：

```text
10:00
Trade approved
```

随后：

```text
10:05
Limit breached
```

或者：

```text
10:06
Account frozen
```

或者：

```text
10:07
Instrument placed on restricted list
```

这时：

```text
approved = true
```

仍然不足以执行。

因此 Execution 前需要：

```text
Approval valid?
+
Policy still valid?
+
Business precondition still valid?
+
Command still fresh?
```

最终才：

```text
execute
```

---

# 33. Approval 应该绑定 Policy Version

假设：

```text
Approval:
Policy v4
```

但执行时：

```text
Policy v5
```

已经发布。

应该怎样处理必须由业务规则明确决定：

```text
继续使用批准时的 policy？
```

还是：

```text
重新按最新 policy 评估？
```

推荐对高风险业务显式定义：

```text
approvalPolicyVersion
executionPolicyVersion
```

例如：

```json
{
  "approvalPolicyVersion": "TRADE-7",
  "executionPolicyVersion": "TRADE-7"
}
```

如果不一致：

```text
POLICY_VERSION_CHANGED
```

重新检查。

不要让这种行为隐含在代码里。

---

# 34. Command 与 Workflow / Saga 必须分开

Command 表示：

```text
一个业务动作
```

Workflow 表示：

```text
多个动作的状态、顺序和失败处理
```

例如：

```text
CreateInvestmentOrder
```

可能属于：

```text
InvestmentOrderWorkflow
```

流程：

```text
ValidateAccount
    ↓
ReserveCash
    ↓
CreateOrder
    ↓
SendToBroker
    ↓
ReceiveExecution
    ↓
UpdatePosition
    ↓
NotifyOperations
```

这里：

```text
Command
```

不是：

```text
整个 workflow
```

而是：

```text
workflow 的一个业务动作
```

当多个系统发生分布式业务事务时，Saga 可以使用本地事务和补偿事务来管理长流程；AWS 官方 guidance 也明确指出 Saga 适用于跨多个服务的长事务，但随着服务和补偿逻辑增加，其复杂度也会显著上升。

因此：

```text
Command = action
Workflow = orchestration
Saga = distributed consistency strategy
```

不要混成一个抽象。

---

# 35. “Undo” 在金融系统里不能简单理解成 Rollback

一个常见误区是：

```text
Command
  ↓
execute
  ↓
undo()
```

例如：

```text
SubmitTrade
```

不意味着可以：

```text
rollback database
```

因为外部世界可能已经发生变化：

```text
Broker accepted
Market executed
Position changed
Settlement started
```

这时不是：

```text
rollback
```

而可能需要：

```text
Compensating Command
```

例如：

```text
SubmitTrade
      ↓
TradeExecuted
      ↓
ReverseTrade / CorrectiveTrade
```

但补偿操作本身又是一个高风险 Command。

所以：

> **Command 的失败恢复与数据库事务 rollback 是两回事。**

---

# 36. Audit 必须独立于 Agent Trace

这是企业 Agent 很容易做错的地方。

LangSmith、Agent Runtime、OpenTelemetry 等可以记录：

```text
LLM call
tool call
latency
token usage
prompt
response
```

这些属于：

```text
Agent Telemetry
```

但金融审计需要：

```text
Business Audit Evidence
```

例如：

```text
Who:
    U123

Which Agent:
    ProxyVotingAgent v3

What:
    SubmitProxyVote

Command:
    CMD-123

Command Hash:
    9e5c...

Resource:
    Account A123 / Meeting M456 / Proposal P7

Policy:
    ProxyVotingPolicy v8

Authorization:
    APPROVED

Approval:
    AP-888

Approver:
    U999

Execution:
    2026-09-20T08:30:12Z

External Reference:
    VOTE-99881

Result:
    SUCCEEDED
```

SEC 对 broker-dealer electronic recordkeeping 的要求提供了一个很有价值的传统参照：电子记录需要能够保持完整审计轨迹，包括修改、删除、时间、身份等信息，并能够重建原始记录；SEC 的 Consolidated Audit Trail 也强调需要把订单从生成、路由、修改、取消到执行的生命周期关联起来。

因此 Agent Trace 不应该被视为 Business Audit 的替代品。

---

# 37. 金融 Agent 的审计对象应该是“业务事实”

推荐审计：

```text
Proposal
Command
Authorization
Policy
Approval
Execution
External Effect
Outcome
```

而不是只审计：

```text
Prompt
Response
Tool Call
```

例如：

```text
Agent Trace:
tool.submit_vote(...)
```

不够。

更应该能回答：

```text
为什么投？

谁允许？

针对哪个账户？

哪一个 Proposal？

当时适用哪个 policy？

哪个人批准？

批准的具体内容是什么？

实际提交的内容是什么？

Vendor 返回什么？

```

这也是为什么：

> **Command 是 Agent Trace 与 Business Audit 之间非常重要的桥梁。**

---

# 38. 真实行业案例：Bank of England 的做法体现了“AI 能做事，但治理独立存在”

Bank of England 在 2025 年的《Financial Stability in Focus: Artificial intelligence in the financial system》中明确表示，AI 已经被金融机构用于内部流程自动化和客户交互，并指出 AI 未来可能越来越多地影响核心金融决策；同时，Bank 自身明确要求 AI 应有 policies 和 governance framework，并设立 Artificial Intelligence and Data Ethics Governance Committee 负责内部 AI 使用和建设。

这个案例并不是说 Bank of England 使用了本文所定义的 `Approval → Command → Execution` 架构；没有这样的公开证据。

它真正说明的是一个更重要的事实：

```text
AI capability
      ≠
AI governance
```

AI 可以被嵌入业务流程，但：

```text
policy
governance
accountability
risk management
```

仍然需要独立存在。

这与本文的 Control Plane / Execution Plane 分离原则是一致的。

---

# 39. FCA 的 AI Live Testing 也说明控制重点已经从“能不能用”转向“如何安全部署”

FCA 在 2025 年推出 AI Live Testing，与多家金融机构共同测试 AI，并特别关注：

```text
evaluation frameworks
live monitoring
governance
risk management
```

参与测试的机构包括 NatWest、Monzo、Santander、Scottish Widows 等。

这说明实际金融机构的 AI 落地重点并不只是：

```text
model accuracy
```

而越来越包括：

```text
deployment controls
monitoring
governance
risk management
```

对于 Agent 而言，这些控制最终必须落到：

```text
Command
Policy
Approval
Execution
Audit
```

这些可操作的系统边界上，而不能只停留在模型评估层。

---

# 40. Visa / Mastercard 的 Agentic Payment 更直接地体现了“Delegated Intent → Controlled Execution”

Visa 当前正在建设 Agentic Commerce，并公开推出 Trusted Agent Protocol。

其技术规范包括：

```text
Agent recognition
Consumer/device identity
Payment container
Signatures
Intent
Payment credentials
```

其中支付请求通过签名把 Agent、用户身份和支付数据建立可验证的关联。

Visa 在 2025 年发布 Trusted Agent Protocol 时明确表示，其目标是让 Merchant 在 Agent 驱动的交易过程中识别和信任 Agent。

Mastercard 的 Agent Pay 则提出 Agentic Tokens，并强调 Agentic Payments 中的 trust、security 和 control。

这些方案并不是 GoF Command Pattern 的直接实现，不能简单说：

```text
Visa = Command Pattern
```

但它们反映了相同的架构趋势：

```text
Natural-language user intent
        ↓
Structured / verifiable intent
        ↓
Delegated authorization
        ↓
Controlled transaction
```

也就是说：

> **Agent 真正要进入金融基础设施，不是把一个 LLM 接到 Payment API 上，而是把 Agent 的意图转换成可以被验证、授权和追踪的结构化业务操作。**

---

# 41. Approval Chain 最适合放在哪里

一个大型企业 Agent Platform 可以划分成：

```text
┌────────────────────────────────────────┐
│              Agent Runtime             │
│                                        │
│ LLM / Planner / Memory / RAG / Tools  │
│                                        │
│ Responsibility:                       │
│ reasoning / planning / proposal       │
└─────────────────────┬──────────────────┘
                      │
                      ▼
┌────────────────────────────────────────┐
│          Agent Control Plane           │
│                                        │
│ Command Registry                       │
│ Schema Validation                      │
│ Identity Binding                       │
│ Policy Engine                          │
│ Authorization                          │
│ Approval                               │
│ Risk Classification                    │
│ Entitlement                            │
└─────────────────────┬──────────────────┘
                      │
                      ▼
┌────────────────────────────────────────┐
│         Business Execution Plane       │
│                                        │
│ Command Store                          │
│ Handler                                │
│ Transaction                            │
│ Idempotency                            │
│ Retry                                  │
│ Concurrency                            │
│ Workflow / Saga                        │
└─────────────────────┬──────────────────┘
                      │
                      ▼
┌────────────────────────────────────────┐
│         Business / External Systems    │
│                                        │
│ Trading / Payment / CRM / Vendor / DB │
└────────────────────────────────────────┘

             ┌───────────────────────┐
             │ Audit / Observability │
             │                       │
             │ Command               │
             │ Approval              │
             │ Execution             │
             │ External Reference    │
             └───────────────────────┘
```

这里最重要的边界是：

```text
Agent Runtime
        ≠
Business Control Plane
        ≠
Business Execution Plane
```

---

# 42. Agent Runtime 不应该拥有最终业务执行权

例如：

```text
DeepAgents
LangGraph
OpenAI Agents SDK
Copilot SDK
自研 Agent Runtime
```

都可以负责：

```text
reasoning
planning
tool orchestration
context management
```

但不应该成为：

```text
最终业务授权系统
```

例如不应该出现：

```typescript
await agent.executeTrade({
  ...
});
```

然后：

```text
Agent runtime
    ↓
Broker API
```

更合理的是：

```text
Agent runtime
    ↓
CreateTradeProposal
    ↓
Command Service
    ↓
Policy / Approval
    ↓
Trade Execution Service
```

这样未来即使 Agent Runtime 更换：

```text
DeepAgents
→ Copilot SDK
→ 自研 Runtime
```

金融业务的：

```text
Approval
Policy
Command
Audit
Execution
```

都可以保持不变。

---

# 43. MCP 也不能绕过 Command Boundary

这是未来尤其需要注意的一点。

如果企业允许：

```text
Agent
 ↓
MCP Server
 ↓
Business API
```

并不意味着：

```text
MCP
```

天然成为安全边界。

MCP Tool 仍然只是：

```text
Tool interface
```

如果它执行：

```text
SubmitTrade
RefundPayment
ChangeBankAccount
SubmitProxyVote
```

仍然应该进入：

```text
Command
 ↓
Policy
 ↓
Approval
 ↓
Execution
```

AWS Agentic AI Lens 当前也强调 Agent Tool Registry、工具权限、schema validation、外部授权等控制。

因此不要把：

```text
MCP Server
```

误认为：

```text
Business Authorization Layer
```

---

# 44. Tool 可以分成 Query 和 Mutation 两大类

企业 Agent Platform 可以采用一个非常实用的分类：

```text
READ
```

与：

```text
MUTATION
```

例如：

```text
getCustomer
READ

getPositions
READ

searchDocuments
READ

getVotingPolicy
READ

proposeRefund
MUTATION

proposeTrade
MUTATION

proposeProxyVote
MUTATION
```

READ：

```text
Agent
 ↓
Tool
 ↓
Data
```

Mutation：

```text
Agent
 ↓
Proposal
 ↓
Command
 ↓
Policy
 ↓
Approval
 ↓
Execution
```

这样绝大部分复杂控制都集中在 Mutation Path。

这比：

```text
所有 Tool 都必须经过 Workflow
```

更实际，也避免过度设计。

---

# 45. 哪些操作应该强制进入 Command Path

可以采用一个简单判断：

> **如果调用成功以后，系统或第三方的持久状态、金融状态、权限状态、客户状态或外部关系会发生变化，就应该考虑 Command。**

例如：

| 操作                          |      Command |
| --------------------------- | -----------: |
| Search market data          |            否 |
| Search documents            |            否 |
| Get portfolio               |            否 |
| Get customer profile        |            否 |
| Calculate risk              |          通常否 |
| Generate draft              |          通常否 |
| Save internal draft         |           可选 |
| Send client email           |            是 |
| Change client data          |            是 |
| Create trade                |            是 |
| Submit trade                |            是 |
| Payment                     |            是 |
| Refund                      |            是 |
| Proxy Vote                  |            是 |
| Modify permissions          |            是 |
| Freeze account              |            是 |
| Delete regulated record     |            是 |
| Start multi-system workflow | 是 + Workflow |

---

# 46. 为什么“Send Email”也应该是 Command

很多团队只把：

```text
payment
trade
```

视为高风险。

其实：

```text
sendEmail
```

也是外部副作用。

例如客户通信可能：

```text
承诺价格
确认交易
发送敏感资料
通知合同变化
发送监管披露
```

因此：

```text
SendClientEmailCommand
```

至少应该绑定：

```text
recipient
subject
body/reference
businessCase
actor
approval
```

不能简单：

```typescript
sendEmail(to, body)
```

然后由 LLM 决定：

```text
what / who / when
```

---

# 47. “Agent 先写 draft，再由人 Send”是一种很好的渐进式模式

对于很多高风险业务，并不需要一开始就：

```text
Agent → Execute
```

可以采用：

```text
Agent
 ↓
Generate Draft Command
 ↓
Human Review
 ↓
Approve
 ↓
Execute
```

例如：

```text
Draft Client Email
Draft Trade Instruction
Draft Proxy Vote
Draft Corporate Action Instruction
```

这种模式有三个好处：

```text
1. Agent 不直接制造外部副作用
2. 人看到的是结构化业务对象
3. 后续可以逐步增加 policy-based auto approval
```

最终演进为：

```text
LOW RISK
Agent → Auto Execute

MEDIUM RISK
Agent → Command → Policy → Approval

HIGH RISK
Agent → Command → Multi-party Approval → Execution
```

---

# 48. Approval 不应该阻塞整个 Agent Runtime

一个很常见的实现方式：

```text
Agent
 ↓
Tool Call
 ↓
needsApproval
 ↓
Agent paused
```

这种方式适合简单场景。

但是企业系统更推荐：

```text
Agent
 ↓
Command
 ↓
AWAITING_APPROVAL
```

然后 Agent Run 本身可以：

```text
suspend
```

Approval Service：

```text
approve
```

Workflow：

```text
resume
```

这样可以避免：

```text
Agent process
```

一直占用 runtime resources。

OpenAI Agents SDK 的 HITL 机制已经体现了这种 pause/resume 模式：运行可以在需要审批时产生 interruption，持久化 RunState，在决策完成后继续运行。

企业级系统可以进一步把它提升为：

```text
Durable Business State
```

而不是依赖 Agent process 本身存活。

---

# 49. 高风险 Approval 可以采用多级模型

例如：

```text
Risk = LOW
    ↓
No approval

Risk = MEDIUM
    ↓
One approver

Risk = HIGH
    ↓
Two-person approval

Risk = CRITICAL
    ↓
Business + Compliance approval
```

例如：

```yaml
refund:
  <= 1000:
    approval: none

  1000-10000:
    approval:
      - operations

  > 10000:
    approval:
      - operations
      - finance
```

或者：

```text
Proxy Vote
    ↓
Standard policy
    ↓
Auto

Exception
    ↓
Portfolio Manager

Restricted issuer
    ↓
Compliance + Portfolio Manager
```

这里应该由：

```text
Policy Engine
```

决定。

不是：

```text
LLM
```

决定。

---

# 50. Break-Glass 机制必须独立于 Agent

金融系统不能只有：

```text
Normal path
```

还需要：

```text
Emergency path
```

例如：

```text
Kill Agent
Pause command type
Disable vendor
Freeze execution
Disable specific account
```

建议控制：

```text
Agent Kill Switch
Command Type Kill Switch
Resource Kill Switch
Vendor Circuit Breaker
Global Mutation Disable
```

例如：

```text
disable:
SubmitTradeCommand
```

之后：

```text
all new SubmitTradeCommand
→ REJECTED
```

无需：

```text
修改 Agent Prompt
停止所有 Agent Runtime
```

这也是一个非常重要的架构原则：

> **业务执行必须能够在 Agent 之外被停止。**

AWS Agentic AI Lens 的 security guidance 也把 containment、human oversight protection 和 break-glass runbooks 纳入 Agent 安全体系。

---

# 51. Execution 之后必须产生 Business Event

一个完整链路：

```text
Approved Command
       ↓
Execution
       ↓
Business Event
```

例如：

```text
SubmitProxyVoteCommand
       ↓
ProxyVoteSubmitted
```

或者：

```text
CreateTradeOrderCommand
       ↓
TradeOrderCreated
```

这样：

```text
Command
```

代表：

```text
what we intended to do
```

而：

```text
Event
```

代表：

```text
what actually happened
```

这是非常重要的语义区别。

---

# 52. Command 和 Event 不能互换

```text
Command:
"Submit payment."

Event:
"Payment submitted."
```

Command 是：

```text
imperative
```

Event 是：

```text
fact
```

正确关系：

```text
Command
   ↓
Execution
   ↓
Event
```

不是：

```text
Agent
 ↓
Event
 ↓
Execute
```

因为一个 Event 本身不是授权。

---

# 53. Audit Log 应该具有不可抵赖性

金融行业对于记录完整性要求本来就很高。

SEC 的电子记录规则允许 broker-dealers 使用满足要求的 audit-trail 方法；其要求包括完整时间戳、修改/删除轨迹、身份信息以及能够重建原始记录。

因此 Agent Command Audit 不应设计成：

```sql
UPDATE audit_log
SET status = 'APPROVED'
```

更适合：

```text
append-only events
```

例如：

```text
CommandCreated
CommandValidated
PolicyEvaluated
ApprovalRequested
ApprovalGranted
ExecutionStarted
ExecutionSucceeded
ExternalEffectConfirmed
```

而不是不断覆盖：

```text
status
```

这样才能回答：

> **当时发生了什么？**

---

# 54. 推荐事件模型

```typescript
type AuditEvent =
  | {
      type: "COMMAND_CREATED";
      commandId: string;
      actor: Actor;
      hash: string;
      timestamp: string;
    }
  | {
      type: "POLICY_EVALUATED";
      commandId: string;
      policyId: string;
      decision: string;
      timestamp: string;
    }
  | {
      type: "APPROVAL_GRANTED";
      commandId: string;
      approverId: string;
      commandHash: string;
      timestamp: string;
    }
  | {
      type: "EXECUTION_STARTED";
      commandId: string;
      timestamp: string;
    }
  | {
      type: "EXECUTION_SUCCEEDED";
      commandId: string;
      externalReference?: string;
      timestamp: string;
    };
```

重点不是字段必须长这样，而是：

> **每个重要控制动作都应该留下独立证据。**

---

# 55. 一个完整 TypeScript 实现骨架

下面给出一个适合作为企业 Agent Platform 基础抽象的版本。

## 55.1 Proposal

```typescript
interface AgentProposal<TPayload> {
  readonly type: string;
  readonly payload: TPayload;
}
```

---

## 55.2 Command

```typescript
interface Command<TPayload> {
  readonly commandId: string;

  readonly type: string;
  readonly schemaVersion: number;

  readonly payload: TPayload;

  readonly actor: {
    readonly userId: string;
    readonly agentId: string;
  };

  readonly correlationId: string;
  readonly causationId?: string;

  readonly idempotencyKey: string;

  readonly createdAt: string;
  readonly expiresAt?: string;

  readonly commandHash: string;
}
```

---

## 55.3 Approval

```typescript
interface ApprovalDecision {
  readonly approvalId: string;

  readonly commandId: string;
  readonly commandHash: string;

  readonly decision:
    | "APPROVED"
    | "REJECTED"
    | "EXPIRED"
    | "CANCELLED";

  readonly approver: {
    readonly userId: string;
    readonly role: string;
  };

  readonly policyId: string;
  readonly policyVersion: string;

  readonly decidedAt: string;

  readonly reason?: string;
}
```

---

## 55.4 Execution Result

```typescript
interface CommandResult {
  readonly status:
    | "SUCCEEDED"
    | "REJECTED"
    | "FAILED"
    | "PENDING";

  readonly commandId: string;

  readonly reasonCode?: string;

  readonly retryable?: boolean;

  readonly externalReference?: string;

  readonly metadata?: Record<string, unknown>;
}
```

---

# 56. Command Builder

```typescript
async function buildCommand<T>(
  proposal: AgentProposal<T>,
  context: ExecutionContext
): Promise<Command<T>> {

  const validatedPayload =
    await commandSchemaRegistry
      .get(proposal.type)
      .parse(proposal.payload);

  const base = {
    commandId: crypto.randomUUID(),

    type: proposal.type,

    schemaVersion: 1,

    payload: validatedPayload,

    actor: {
      userId: context.user.id,
      agentId: context.agent.id
    },

    correlationId:
      context.correlationId,

    causationId:
      context.agentRunId,

    idempotencyKey:
      buildIdempotencyKey(
        proposal,
        context
      ),

    createdAt:
      new Date().toISOString()
  };

  return {
    ...base,

    commandHash:
      hashCanonicalCommand(base)
  };
}
```

这里有一个极其重要的安全性质：

```text
LLM → Proposal
System → Command
```

而不是：

```text
LLM → Command
```

---

# 57. Policy Evaluation

```typescript
type PolicyEffect =
  | "ALLOW"
  | "DENY"
  | "REQUIRES_APPROVAL";

interface PolicyDecision {
  effect: PolicyEffect;

  decisionId: string;

  policyId: string;

  policyVersion: string;

  reason?: string;
}
```

然后：

```typescript
const decision =
  await policyEngine.evaluate({
    principal: {
      user: context.user,
      agent: context.agent
    },

    command,

    resourceEntitlements:
      context.resourceEntitlements,

    businessContext:
      context.businessContext
  });
```

注意：

```text
policyEngine
```

不应该使用：

```text
LLM
```

作为最终授权机制。

---

# 58. Approval Flow

```typescript
async function authorizeCommand(
  command: Command<unknown>,
  context: ExecutionContext
) {

  const decision =
    await policyEngine.evaluate({
      principal: context,
      command
    });

  switch (decision.effect) {

    case "DENY":
      return rejectCommand(
        command,
        decision
      );

    case "REQUIRES_APPROVAL":
      return approvalService
        .request({
          commandId: command.commandId,
          commandHash: command.commandHash,
          policyId: decision.policyId,
          policyVersion: decision.policyVersion
        });

    case "ALLOW":
      return executionService.execute(
        command
      );
  }
}
```

这样：

```text
Agent
```

没有任何能力决定：

```text
ALLOW
```

或：

```text
APPROVE
```

它只能发起：

```text
proposal
```

---

# 59. Approval Service

```typescript
async function approve(
  approvalId: string,
  approver: User
) {

  const request =
    await approvalRepository.get(
      approvalId
    );

  await authorization.assertCanApprove(
    approver,
    request.commandId
  );

  const command =
    await commandRepository.get(
      request.commandId
    );

  if (
    command.commandHash !==
    request.commandHash
  ) {
    throw new Error(
      "Command changed after approval request"
    );
  }

  return approvalRepository.record({
    approvalId,

    commandId:
      command.commandId,

    commandHash:
      command.commandHash,

    decision:
      "APPROVED",

    approver: {
      userId: approver.id,
      role: approver.role
    },

    policyId:
      request.policyId,

    policyVersion:
      request.policyVersion,

    decidedAt:
      new Date().toISOString()
  });
}
```

这段逻辑真正建立：

```text
Approve X
```

而不是：

```text
Approve something related to X
```

---

# 60. Execution Guard

审批通过后，Executor 仍然不能直接执行。

至少检查：

```typescript
async function execute(
  commandId: string
) {

  const command =
    await commandRepository.get(
      commandId
    );

  const approval =
    await approvalRepository.getForCommand(
      commandId
    );

  verifyCommandHash(
    command,
    approval
  );

  verifyNotExpired(command);

  await policyEngine
    .revalidate(command);

  await businessPrecondition
    .validate(command);

  await idempotency.assertNotExecuted(
    command.idempotencyKey
  );

  return handlerRegistry
    .get(command.type)
    .execute(command);
}
```

这个“execution-time revalidation”非常重要。

因为：

```text
Approval Time
```

和：

```text
Execution Time
```

可能不是同一时刻。

---

# 61. 为什么执行时仍然需要重新 Policy Check

有人可能会认为：

```text
Approved
```

就应该：

```text
execute
```

但在金融系统中：

```text
state can change
```

例如：

```text
Account frozen
Limit reduced
Security restricted
Policy changed
Mandate revoked
Approval expired
```

因此：

```text
Approval
```

应该是：

```text
authorization evidence
```

而不是：

```text
永久 bypass
```

执行时可以有：

```text
Approval Check
+
Policy Revalidation
+
Business Preconditions
```

三层控制。

---

# 62. Policy Revalidation 不意味着每次都重新要求人工审批

需要区分：

```text
Revalidate policy
```

和：

```text
Re-approve
```

例如：

```text
Policy unchanged
Command unchanged
Approval valid
```

可以：

```text
execute
```

如果：

```text
Policy version changed
```

才：

```text
re-evaluate
```

如果新策略认为：

```text
approval required
```

再：

```text
request new approval
```

这样既保证控制，又避免不必要的人工操作。

---

# 63. Execution 发生在业务边界，而不是 Agent 边界

一个成熟系统应该让：

```text
Agent Runtime
```

完全不知道：

```text
how side effect happens
```

它只得到：

```json
{
  "status": "PENDING",
  "commandId": "CMD-123"
}
```

或者：

```json
{
  "status": "SUCCEEDED",
  "commandId": "CMD-123",
  "externalReference": "EXT-998"
}
```

于是：

```text
LLM
```

只处理：

```text
business outcome
```

而不是：

```text
HTTP response
database exception
payment SDK internals
```

这样可以显著减少：

```text
LLM ↔ infrastructure
```

之间的耦合。

---

# 64. Command Result 要让 Agent 知道“不能做什么”

例如：

```json
{
  "status": "REJECTED",
  "reasonCode": "INSUFFICIENT_ENTITLEMENT"
}
```

Agent 可以解释：

> “当前用户没有提交该账户投票的权限。”

而不是：

```text
HTTP 403
java stack trace
database exception
```

甚至可以进一步区分：

```text
REJECTED
```

和：

```text
RETRYABLE_FAILURE
```

例如：

```json
{
  "status": "FAILED",
  "reasonCode": "PROVIDER_TIMEOUT",
  "retryable": true
}
```

Agent 不需要自己推断 retry policy。

---

# 65. Security Boundary 必须由确定性代码控制

这是整套架构最核心的原则：

```text
LLM:
    suggest

Policy:
    decide

Approval:
    authorize

Executor:
    execute

Audit:
    record
```

而不是：

```text
LLM:
    suggest
    decide
    approve
    execute
    explain why it was safe
```

AWS 当前 Agentic AI Lens 的基本思想正是“bounded autonomy”：Agent 可以拥有一定程度的自治，但工具访问、身份、权限、高风险 mutation 和 human review 必须通过 Agent 外部的控制机制约束。

---

# 66. 不要让 Command 变成 “God Object”

看到本文以后，很容易走向另一个极端：

```text
Command
 ├── authorization
 ├── approval
 ├── policy
 ├── workflow
 ├── transaction
 ├── retry
 ├── audit
 ├── database
 ├── HTTP
 └── LLM
```

这样就把：

```text
所有问题
```

又塞回一个对象。

正确的关系应该是：

```text
Command
   │
   ├── Policy
   │
   ├── Approval
   │
   ├── Execution
   │
   ├── Audit
   │
   └── Workflow
```

Command 是：

```text
business action
```

而不是：

```text
整个 Enterprise Control Plane
```

---

# 67. Command Pattern 也不是 Workflow Engine

例如：

```text
SubmitTradeOrderCommand
```

只表示：

```text
提交交易订单
```

而：

```text
TradeOrderWorkflow
```

可能表示：

```text
Eligibility
→ Risk Check
→ Approval
→ Submit
→ Confirmation
→ Settlement
→ Reconciliation
```

如果 Agent 负责：

```text
自己决定下一步
```

那么业务流程状态又回到了：

```text
LLM Memory
```

这在金融场景中通常并不理想。

更合理的是：

```text
Workflow Engine
    ↓
Business State
    ↓
Command
    ↓
Executor
```

而：

```text
Agent
```

可以作为：

```text
Advisor / Planner / Proposal Generator
```

参与某些决策，但不应该成为 durable business state machine。

---

# 68. 对金融企业来说，最重要的不是“全自动”，而是“可控自治”

很多 Agent 架构会把目标描述成：

```text
Fully Autonomous Agent
```

对于金融业务，这个表述通常不够准确。

更合理的是：

```text
Bounded Autonomy
```

也就是：

```text
Agent can reason broadly
        ↓
but act narrowly
```

例如：

```text
Agent
    可以：
    - 阅读 100 份资料
    - 比较政策
    - 分析市场
    - 识别异常
    - 生成建议

    不能：
    - 绕过 entitlement
    - 自己批准
    - 修改 approval
    - 改变 command
    - 绕过 policy
    - 无限 retry
    - 直接调用任意外部 API
```

这比：

```text
Agent 能不能完全自主？
```

更适合金融系统。

---

# 69. 这与金融传统控制体系其实是连续的

如果把 Agent 去掉：

```text
Maker
   ↓
Approval
   ↓
Order
   ↓
Execution
   ↓
Audit
```

本来就是金融业务的经典控制结构。

Agent 只是把：

```text
Maker
```

这一层从：

```text
Human Operator
```

扩展为：

```text
Human + AI Agent
```

因此更合理的架构不是：

```text
AI replaces controls
```

而是：

```text
AI enters existing control model
```

这也是为什么 Basel 的：

```text
approval
authorization
risk thresholds
segregation of duties
dual control
```

等原则仍然具有直接参考价值。

---

# 70. 监管视角最关心的其实不是 “用了 LLM”

FINRA 当前公开指导中，一个非常重要的原则是：

> 使用 GenAI 并不会自动改变既有监管责任。

其 2024 Regulatory Notice 明确指出，FINRA rules 和 securities laws 在使用 GenAI 时仍然适用；2026 Oversight Report 则进一步把 supervision、communications、recordkeeping 和 fair dealing 等问题与 GenAI 使用联系起来。

因此不能说：

```text
这是 Agent 做的
```

于是：

```text
没人批准
没人负责
没有审计
```

反过来，系统应该能够明确：

```text
Agent did what?
Human authorized what?
System executed what?
```

---

# 71. 审计链最终应该能够回答 8 个问题

对于任何生产 Agent Business Action，建议要求系统都能回答：

```text
1. Who initiated it?
2. Which Agent proposed it?
3. What exactly was proposed?
4. What Command was created?
5. Why was it allowed?
6. Who approved it?
7. What was actually executed?
8. What external effect occurred?
```

可以进一步扩展成：

```text
WHO
WHAT
WHY
AUTHORITY
APPROVAL
WHEN
EXECUTION
OUTCOME
```

对于金融业务，这比：

```text
prompt transcript
```

重要得多。

---

# 72. 参考一个完整的 Audit Record

```json
{
  "commandId": "CMD-123",

  "actor": {
    "userId": "U100",
    "agentId": "AGENT-007"
  },

  "command": {
    "type": "SubmitProxyVote",
    "schemaVersion": 3,
    "hash": "9e5c..."
  },

  "resource": {
    "accountId": "A123",
    "meetingId": "M456",
    "proposalId": "P7"
  },

  "policy": {
    "id": "PROXY-VOTE",
    "version": "8"
  },

  "authorization": {
    "decision": "ALLOW"
  },

  "approval": {
    "required": true,
    "approvalId": "AP-888",
    "approverId": "U999",
    "approvedHash": "9e5c..."
  },

  "execution": {
    "startedAt": "...",
    "completedAt": "...",
    "status": "SUCCEEDED",
    "externalReference": "VOTE-9988"
  }
}
```

这个结构可以让：

```text
Operations
Risk
Compliance
Audit
Engineering
```

看到的是同一个业务事实，而不是各自从不同 Agent Trace 里拼装证据。

---

# 73. 一个特别值得注意的问题：Approval 并不等于不可撤销

在金融系统中：

```text
Approve
```

之后仍然可能需要：

```text
Cancel
Suspend
Revoke
Freeze
Kill
```

例如：

```text
Approval granted
   ↓
Market incident
   ↓
Emergency policy change
   ↓
Execution paused
```

因此 Command 应支持：

```text
CANCELLED
```

并且：

```text
approval revoked
```

成为独立的 Audit Event。

不要让：

```text
approval = true
```

成为永远不可逆的状态。

---

# 74. 典型反模式一：Agent 直接拥有业务 API Credential

```text
Agent
 ↓
credentials
 ↓
Broker API
```

这是最危险的结构之一。

问题包括：

```text
credential scope
credential leakage
prompt injection
tool abuse
unbounded execution
poor audit separation
```

更合理：

```text
Agent
 ↓
Command
 ↓
Enterprise Execution Service
 ↓
short-lived / scoped credential
 ↓
Broker API
```

这样 Agent 不需要持有真正的业务凭证。

---

# 75. 典型反模式二：Approval 只绑定 Tool Name

例如：

```json
{
  "tool": "submitTrade",
  "approved": true
}
```

这是不够的。

因为：

```text
submitTrade
```

可能包含：

```text
Account A
$10,000
```

也可能：

```text
Account B
$100,000,000
```

审批必须绑定：

```text
具体参数
具体资源
具体 Command
具体 Policy
```

所以：

```text
approval ≠ tool approval
```

而应该：

```text
approval = approval of a concrete business action
```

---

# 76. 典型反模式三：Approval 只绑定聊天消息

例如：

```text
User:
“批准刚才那个交易。”

```

如果系统只存：

```text
approvedMessageId
```

而没有：

```text
commandId
commandHash
```

就存在歧义。

因为：

```text
刚才那个
```

可能在 Agent Runtime 中对应多个 Tool Call。

所以：

> **审批对象必须是结构化业务对象，而不是自然语言上下文。**

---

# 77. 典型反模式四：Agent 可以修改已经批准的 Command

例如：

```text
Approval
 ↓
Command
 ↓
Agent modifies command
 ↓
Execute
```

这是必须禁止的。

如果真的需要修改：

```text
Create new Command
```

重新：

```text
Policy
Approval
```

例如：

```text
CMD-001
amount = 1000
approved

需要改为：

CMD-002
amount = 1500
```

就应该：

```text
CMD-001
    ↓
CANCELLED

CMD-002
    ↓
new approval
```

而不是：

```text
UPDATE CMD-001
SET amount = 1500
```

---

# 78. 典型反模式五：Approval Service 直接调用 Vendor API

例如：

```text
Approve
 ↓
ISS API
```

或者：

```text
Approve
 ↓
Broker API
```

这会把：

```text
approval
```

与：

```text
execution
```

耦合。

正确是：

```text
Approval
 ↓
Approved Command
 ↓
Execution Queue
 ↓
Executor
 ↓
Vendor
```

这样：

```text
Approval Service
```

只负责：

```text
decision
```

而：

```text
Executor
```

负责：

```text
side effect
```

---

# 79. 典型反模式六：把 Agent Trace 当作 Audit Trail

```text
LangSmith
 ↓
tool call log
```

不能自动等价：

```text
regulatory audit evidence
```

Agent Trace 可以因为：

```text
sampling
retention
privacy
technical failures
vendor configuration
```

而与正式业务审计存在不同要求。

如果业务是：

```text
trade
payment
proxy vote
client instruction
```

应该建立独立：

```text
Business Audit
```

并保留：

```text
command
approval
execution
external reference
```

---

# 80. 典型反模式七：把 Workflow State 放进 Agent Memory

错误：

```json
{
  "memory": {
    "trade": {
      "step": "awaiting_settlement"
    }
  }
}
```

正确：

```text
Workflow Store
    ↓
TradeOrder.status
```

Agent Memory 可以保存：

```text
“用户正在处理 XYZ Trade”
```

但不能作为：

```text
Order.status = SETTLED
```

的 source of truth。

---

# 81. 典型反模式八：把所有 Tool 都变成 Command

这同样会导致过度设计。

例如：

```text
SearchDocumentCommand
GetStockPriceCommand
GetWeatherCommand
CalculateRiskCommand
```

没有业务副作用时，没有必要引入完整：

```text
Approval
Command Store
Execution Queue
```

因此：

```text
Query Tool
```

可以保持轻量。

只有：

```text
Mutation
```

进入严格的 Command Path。

---

# 82. 金融 Agent 最适合采用“分级自治”

可以定义：

```text
Level 0
Read Only

Level 1
Low-risk Mutation

Level 2
Policy-controlled Mutation

Level 3
Human Approval

Level 4
Multi-party Approval

Level 5
No Agent Execution
```

例如：

```text
查询价格
    Level 0

保存 draft
    Level 1

发送内部通知
    Level 2

客户退款
    Level 3

高金额交易
    Level 4

修改核心权限
    Level 5
```

这里不是说所有金融机构都应使用相同等级，而是：

> **Agent autonomy 应该按照业务副作用风险进行分级，而不是按照模型能力进行分级。**

一个很强的模型不应该因为“更聪明”而自动获得更高的交易权限。

---

# 83. 风险应与“业务动作”绑定，而不是与 Agent 绑定

不要设计：

```text
GPT-5.6 Agent = trusted
Claude Agent = untrusted
```

这种模型很快会失效。

因为真正需要管理的是：

```text
Command
```

例如同一个 Agent：

```text
getCustomerProfile
```

风险很低。

但：

```text
CreateTradeOrder
```

风险很高。

所以：

```text
Agent Risk
```

不是唯一维度。

更应该：

```text
Command Risk
+
Resource Risk
+
Amount Risk
+
Context Risk
+
User Authority
```

综合决定：

```text
approval requirement
execution scope
rate limit
```

---

# 84. Command 可以成为企业 Agent Platform 的统一控制入口

如果企业有：

```text
Agent A
Agent B
Agent C
Agent D
```

不希望每个 Agent 自己实现：

```text
authorization
approval
audit
retry
idempotency
```

而应该：

```text
                 Agent Platform
                       │
          ┌────────────┴────────────┐
          │                         │
       Query Path              Mutation Path
          │                         │
      Tool Registry             Command Registry
                                    │
                              Policy Engine
                                    │
                              Approval Service
                                    │
                              Command Store
                                    │
                              Execution Service
                                    │
                              Audit Service
```

这会形成：

```text
Common Control Plane
```

从而把金融 Agent 的治理能力平台化。

---

# 85. Command Registry 也应该经过治理

不要允许任何开发者随便注册：

```text
DeleteAccount
TransferFunds
ExecuteTrade
```

应该维护：

```text
Command Registry
```

至少包含：

```text
command type
owner
schema version
risk class
required scopes
approval policy
allowed agents
data classification
external dependencies
timeout
retry policy
audit requirement
review expiry
```

AWS Agentic AI Lens 当前建议维护受批准的 Tool Registry，并包含权限、数据分类以及定期 Review 等治理信息。

对企业 Agent Platform 而言，这个 Registry 可以自然扩展到：

```text
Business Command Registry
```

---

# 86. 一个 Command Registry 例子

```yaml
name: SubmitProxyVote

version: 3

owner:
  team: InvestmentOperations

risk:
  class: HIGH

permissions:
  - proxy_vote.submit

approval:
  policy: PROXY_VOTE_POLICY
  mode: conditional

execution:
  handler: SubmitProxyVoteHandler

idempotency:
  required: true

preconditions:
  - account_entitled
  - meeting_open
  - proposal_valid
  - command_fresh

audit:
  required: true

externalSystems:
  - voting-platform
```

这样可以让：

```text
Command
```

成为一个真正可治理的企业能力。

---

# 87. Policy、Approval、Command 的关系可以总结成一个公式

可以把安全执行抽象为：

```text
Executable Command
=
Canonical Command
+
Valid Identity
+
Current Authorization
+
Satisfied Policy
+
Required Approval
+
Valid Preconditions
+
Valid Idempotency State
```

而：

```text
Execution
```

必须在这些条件都满足以后发生。

这比：

```text
LLM says execute
```

安全得多，也更符合企业系统的职责分离。

---

# 88. 一个完整的金融 Agent 执行链

最终可以把整个模型浓缩成：

```text
┌───────────────┐
│     User      │
└───────┬───────┘
        │
        ▼
┌───────────────┐
│ Agent / LLM   │
│ reasoning     │
└───────┬───────┘
        │
        ▼
┌───────────────┐
│   Proposal    │
│ untrusted     │
└───────┬───────┘
        │
        ▼
┌────────────────────────┐
│ Canonical Command      │
│ schema + identity      │
│ hash + idempotency     │
└───────────┬────────────┘
            │
            ▼
┌────────────────────────┐
│ Policy / Authorization │
└───────────┬────────────┘
            │
      ┌─────┴──────┐
      │            │
    DENY        APPROVAL
      │            │
      │       ┌────┴─────┐
      │       │          │
      │     REJECT     APPROVE
      │                  │
      └────────┬─────────┘
               │
               ▼
┌────────────────────────┐
│ Approved Command       │
│ immutable + hash bound │
└───────────┬────────────┘
            │
            ▼
┌────────────────────────┐
│ Execution Guard        │
│                        │
│ expiry                 │
│ policy revalidation    │
│ precondition           │
│ idempotency             │
└───────────┬────────────┘
            │
            ▼
┌────────────────────────┐
│ Command Handler        │
└───────────┬────────────┘
            │
            ▼
┌────────────────────────┐
│ Business / External    │
│ System                 │
└───────────┬────────────┘
            │
            ▼
┌────────────────────────┐
│ Event + Audit Evidence │
└────────────────────────┘
```

---

# 89. 最重要的架构边界

整个设计最终可以浓缩成六句话。

### 1. Agent 可以 Reason，但不应该定义 Security Boundary

```text
LLM
→ proposal
```

而不是：

```text
LLM
→ permission
```

### 2. Approval 必须针对具体 Command

```text
Approval
→ commandId
→ commandHash
```

而不是：

```text
Approval
→ "Agent's action"
```

### 3. Command 是业务动作，不是 Tool Call

```text
SubmitProxyVote
```

优于：

```text
POST /vote
```

### 4. Execution 必须重新检查现实世界状态

```text
approved
```

不等于：

```text
still executable
```

### 5. Agent Runtime 不应拥有最终业务执行权

```text
Agent Runtime
≠
Business Execution Plane
```

### 6. Audit 必须记录 Business Evidence

```text
Prompt Trace
```

不能替代：

```text
Command
Approval
Execution
External Effect
```

---

# 90. 最终结论

“Approval → Command → Execution”真正解决的，不是如何让 Agent 更容易调用 API。

它解决的是一个更加根本的问题：

```text
Agent 是概率性的
        ↓
Business Action 是确定性的
        ↓
二者之间必须有控制边界
```

在传统应用中：

```text
Human
  ↓
Business Application
  ↓
Execution
```

很多控制天然已经嵌入业务应用。

在 Agent 系统中：

```text
Human
  ↓
LLM
  ↓
Tool
```

引入了一个具有自主推理能力的中间层。

因此必须把：

```text
“我想做什么”
```

与：

```text
“系统最终允许做什么”
```

重新分离。

Command 提供了第一个关键边界：

```text
Intent
   ↓
Business Action
```

Approval 提供第二个边界：

```text
Business Action
   ↓
Authorized Action
```

Execution 提供第三个边界：

```text
Authorized Action
   ↓
Real-world Side Effect
```

最终形成：

```text
Agent
  ↓
Proposal
  ↓
Canonical Command
  ↓
Policy / Authorization
  ↓
Approval
  ↓
Approved Command
  ↓
Execution Guard
  ↓
Executor
  ↓
External Effect
  ↓
Audit
```

这套模型与传统金融内部控制中的：

```text
authorization
approval
segregation of duties
dual control
audit trail
```

是连续的，而不是对立的。Basel 对银行操作风险的指导长期强调清晰的授权与审批流程、风险阈值、职责分离和双重控制；SEC 的交易记录体系则强调能够重建订单生命周期和保持完整的时间、身份及修改轨迹。

AI 并不会让这些原则过时。

恰恰相反：

> **Agent 越自主，这些确定性的控制边界越重要。**

金融 Agent 最终不应该追求：

```text
Unlimited Autonomy
```

而应该追求：

```text
Bounded Autonomy
```

即：

```text
Agent can reason broadly
        ↓
Agent can propose extensively
        ↓
Agent can act only through explicit business commands
        ↓
Policy decides the boundary
        ↓
Approval controls exceptional risk
        ↓
Executor controls side effects
        ↓
Audit preserves the evidence
```

因此，从架构上看，最值得标准化的并不是：

```text
某个 Agent Framework
某个 LLM
某个 MCP Server
某个 Prompt
```

而是：

```text
Business Command
+
Policy
+
Approval
+
Execution
+
Audit
```

一旦这一层建立起来，Agent 才真正从：

```text
能够调用工具的 LLM
```

变成：

```text
能够在企业控制边界内执行业务的 Agent
```

而这正是金融 Agent 从实验性 Copilot 走向生产业务系统时，最关键的架构变化之一。

---

# 参考资料

## 一、Agent 安全、授权与 Human-in-the-Loop

**AWS Well-Architected Framework — Agentic AI Lens: Secure agent tool usage**
AWS 当前 Agentic AI Lens 要求每次工具调用在执行前根据声明式策略授权，并传播 Agent identity 和 originating user context；高风险写入、删除与金融操作需要额外控制。
[AWS — Secure agent tool usage](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentsec02.html?utm_source=chatgpt.com)

**AWS — Implement tool authorization**
强调外部授权、最小权限、Agent 与用户上下文传播以及高风险 mutation 的人工审查。
[AWS — Implement tool authorization](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentsec02-bp01.html?utm_source=chatgpt.com)

**AWS — Agent identity and permission management**
讨论 Human identity 与 Agent identity 的分离、delegated user context 和 least privilege。
[AWS — Agent identity and permission management](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentsec03.html?utm_source=chatgpt.com)

**AWS — Agentic AI Lens Appendix: Best practice reference**
汇总 Tool Authorization、输入输出验证、Tool Registry、Agent Identity 等控制项。
[AWS — Agentic AI Lens Appendix A](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/appendix-a.html?utm_source=chatgpt.com)

**OpenAI Agents SDK — Human-in-the-loop**
展示 Tool Approval、interruption、RunState、approve/reject/resume 等 runtime 机制。
[OpenAI Agents SDK — Human-in-the-loop](https://openai.github.io/openai-agents-python/human_in_the_loop/?utm_source=chatgpt.com)

---

## 二、AI 风险治理与人工监督

**NIST AI Risk Management Framework**
NIST AI RMF 以 Govern、Map、Measure、Manage 为核心，并将可靠、安全、可解释、透明、可问责等作为 AI Trustworthiness 的重要属性。
[NIST — AI Risk Management Framework](https://www.nist.gov/itl/ai-risk-management-framework?utm_source=chatgpt.com)

**NIST AI RMF — Risks and Trustworthiness**
讨论 AI 系统中的 human intervention、monitoring、shutdown、accountability 和 transparency。
[NIST — AI Risks and Trustworthiness](https://airc.nist.gov/airmf-resources/airmf/3-sec-characteristics/?utm_source=chatgpt.com)

**NIST Generative AI Profile**
特别讨论 automation bias、information integrity 和人类对 GenAI 输出过度依赖的问题。
[NIST — Generative AI Profile](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf?utm_source=chatgpt.com)

---

## 三、金融监管、治理与实际实践

**FINRA Regulatory Notice 24-09 — Generative AI and LLMs**
明确说明 FINRA 规则及证券法律在金融机构采用 GenAI 时仍然适用。
[FINRA — Regulatory Notice 24-09](https://www.finra.org/rules-guidance/notices/24-09?utm_source=chatgpt.com)

**FINRA 2026 Regulatory Oversight Report — GenAI**
讨论金融机构 GenAI 使用、监督、记录保存以及模型可靠性等问题。
[FINRA — 2026 Regulatory Oversight Report](https://www.finra.org/rules-guidance/guidance/reports/2026-finra-annual-regulatory-oversight-report/gen-ai?utm_source=chatgpt.com)

**FCA — AI and the FCA: our approach**
FCA 当前强调 AI 仍受既有 accountability、governance、Consumer Duty 和 Senior Managers Regime 等框架约束。
[FCA — AI and the FCA](https://www.fca.org.uk/firms/innovation/ai-approach?utm_source=chatgpt.com)

**FCA — AI Live Testing**
FCA 与 NatWest、Monzo、Santander、Scottish Widows 等机构开展 AI 安全测试，重点包括 evaluation、live monitoring、governance 和 risk management。
[FCA — AI Live Testing](https://www.fca.org.uk/news/press-releases/fca-helps-firms-test-ai-safely?utm_source=chatgpt.com)

**Bank of England — Financial Stability in Focus: Artificial Intelligence in the Financial System**
讨论金融领域 AI 使用、风险以及 Bank 自身 AI Governance Committee 和 TRUSTED principles。
[Bank of England — AI in the financial system](https://www.bankofengland.co.uk/financial-stability-in-focus/2025/april-2025?utm_source=chatgpt.com)

**BIS — Operational Risk / Basel Framework**
强调 approval processes、risk thresholds、segregation of duties、dual controls 和 independent monitoring。
[BIS — Operational Risk](https://www.bis.org/committees/bcbs/basel-consolidated-guidelines/module/orr/10.htm?utm_source=chatgpt.com)

---

## 四、金融审计与记录生命周期

**SEC — Electronic Recordkeeping Requirements for Broker-Dealers**
要求符合条件的电子记录系统保留完整 audit trail，包括时间、修改、删除、身份以及重建原始记录所需的信息。
[SEC — Electronic Recordkeeping Requirements](https://www.sec.gov/investment/amendments-electronic-recordkeeping-requirements-broker-dealers?utm_source=chatgpt.com)

**SEC — Consolidated Audit Trail / Rule 613**
要求能够把订单从生成到路由、修改、取消和执行的生命周期进行关联，并保留时间信息和相关身份标识。
[SEC — Rule 613 Consolidated Audit Trail](https://www.sec.gov/about/divisions-offices/division-trading-markets/rule-613-consolidated-audit-trail?utm_source=chatgpt.com)

---

## 五、可靠执行：Idempotency、Outbox、Saga

**Stripe — Idempotent Requests**
官方文档说明使用 idempotency key 可以在网络错误后安全 retry，避免同一个操作重复执行。
[Stripe — Idempotent requests](https://docs.stripe.com/api/idempotent_requests?utm_source=chatgpt.com)

**AWS — Transactional Outbox Pattern**
解决数据库更新与消息发布之间的 dual-write 问题，并明确要求消息消费者考虑重复投递。
[AWS — Transactional Outbox Pattern](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html?utm_source=chatgpt.com)

**AWS — Saga Pattern**
用于跨多个服务的长事务、失败恢复和 compensating transactions。
[AWS — Saga Pattern](https://docs.aws.amazon.com/prescriptive-guidance/latest/modernization-data-persistence/saga-pattern.html?utm_source=chatgpt.com)

---

## 六、Agentic Commerce / 金融业实际案例

**Visa — Trusted Agent Protocol Specification**
定义 Agent recognition、consumer identity、payment container、signature 和 Agentic Payment Container 等机制，用于让 Merchant 识别和控制 Agent-driven commerce。
[Visa — Trusted Agent Protocol Specification](https://developer.visa.com/capabilities/trusted-agent-protocol/trusted-agent-protocol-specifications?utm_source=chatgpt.com)

**Visa — Trusted Agent Protocol**
2025 年发布的 Visa 官方方案，目标是提高 Agent 驱动交易中的 Agent recognition、trust 和 secure interaction。
[Visa — Trusted Agent Protocol](https://corporate.visa.com/en/sites/visa-perspectives/newsroom/visa-unveils-trusted-agent-protocol-for-ai-commerce.html?utm_source=chatgpt.com)

**Mastercard — Agent Pay**
介绍 Agentic Tokens 以及 Agentic Payments 中的 trust、security 和 control。
[Mastercard — Agent Pay](https://newsroom.mastercard.com/news/press/2025/april/mastercard-unveils-agent-pay-pioneering-agentic-payments-technology-to-power-commerce-in-the-age-of-ai/?utm_source=chatgpt.com)

---

## 七、补充：Agent 之外也需要明确的人类控制边界

**GitHub — Copilot code review / pull-request approval**
GitHub 的 coding agent / code review 实践展示了另一类“Agent 产生结果、人类决定是否进入正式交付”的模式；GitHub 同时强调 Agent 产出的代码仍应经过人工审查。
[GitHub — Review output from Copilot](https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/review-copilot-output?utm_source=chatgpt.com)

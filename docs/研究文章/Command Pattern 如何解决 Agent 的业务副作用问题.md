# Command Pattern 如何解决 Agent 的业务副作用问题：具体实现与架构注意事项

## 摘要

传统软件中的业务操作通常由确定性的程序触发，例如：

```text
用户点击“提交订单”
        ↓
Application Service
        ↓
OrderService.createOrder(...)
        ↓
数据库 / 支付 / 库存
```

Agent 出现以后，调用链发生了变化：

```text
用户自然语言
    ↓
LLM 推理
    ↓
Tool Call
    ↓
业务系统
```

问题在于，LLM 输出天然具有概率性，而业务副作用往往要求确定性。

“发送邮件”“修改客户资料”“提交交易”“发起付款”“批准公司行动”“修改权限”这些操作，一旦真正执行，就会改变企业系统状态，甚至产生不可逆的外部影响。OWASP 将这类问题概括为 **Excessive Agency**：当 LLM 获得过多功能、权限或自主性时，错误、提示注入或模型异常都可能转化为真实业务操作。

因此，Agent 架构中一个非常重要的设计原则是：

> **LLM 可以提出业务意图，但不应该直接拥有业务副作用。**

Command Pattern 正好提供了一个适合的架构边界：把“准备执行的业务请求”从一次函数调用，提升为一个明确、结构化、可验证、可授权、可审批、可审计、可重试的业务对象。

但必须强调：

> **Command Pattern 本身不是安全机制，也不是事务机制，更不是 Agent Governance 的完整解决方案。**

它真正解决的是一个更基础的问题：

> **把 Agent 产生的“想做什么”，转换成系统能够在确定边界内控制的“准备执行哪个业务操作”。**

在成熟的企业架构中，Command 通常需要与 Policy Engine、Authorization、Human Approval、Idempotency、Transactional Outbox、Workflow/Saga、Audit Log 等机制结合使用。

AWS 当前的 Agentic AI Lens 已明确提出，每次工具调用都应经过声明式策略授权；高风险的修改操作应设置 human-in-the-loop；同时需要传播用户和 Agent 身份并完整记录授权与执行过程。

因此，一个更完整的 Agent → Business Side Effect 架构应该是：

```text
                    ┌────────────────────┐
                    │       User         │
                    └─────────┬──────────┘
                              │
                              ▼
                    ┌────────────────────┐
                    │   Agent / LLM      │
                    │ reasoning/planning │
                    └─────────┬──────────┘
                              │
                              │ proposal
                              ▼
                    ┌────────────────────┐
                    │ Command Builder    │
                    │ schema validation  │
                    └─────────┬──────────┘
                              │
                              ▼
                    ┌────────────────────┐
                    │ Policy / AuthZ     │
                    │ entitlement/risk   │
                    └─────────┬──────────┘
                              │
                  ┌───────────┴───────────┐
                  │                       │
             auto approve           human approval
                  │                       │
                  └───────────┬───────────┘
                              │
                              ▼
                    ┌────────────────────┐
                    │ Command Store      │
                    │ immutable command   │
                    │ audit / status      │
                    └─────────┬──────────┘
                              │
                              ▼
                    ┌────────────────────┐
                    │ Command Executor   │
                    │ idempotency/retry  │
                    │ precondition check │
                    └─────────┬──────────┘
                              │
                 ┌────────────┼────────────┐
                 ▼            ▼            ▼
              Domain DB     API        Workflow/Saga
                 │            │            │
                 └────────────┴────────────┘
                              │
                              ▼
                     external side effects
```

---

# 1. Agent 最大的问题不是“回答错了”，而是“做错了”

传统 Chatbot 的错误通常是：

```text
用户：今天 USDJPY 怎么样？

LLM：……
```

最坏的情况通常只是回答错误。

但 Agent 可以执行：

```text
用户：帮我把这个客户的资料更新一下。

Agent：
  1. 查客户
  2. 判断哪个字段应该修改
  3. 调 API
  4. 修改 CRM
```

这时错误已经不再只是“文本错误”。

可能出现：

```text
Prompt Injection
       ↓
错误理解业务意图
       ↓
选择错误 Tool
       ↓
生成错误参数
       ↓
调用高权限 API
       ↓
真实业务状态改变
```

OWASP 对 Excessive Agency 的定义非常接近这个问题：风险主要来自三个方向：

* excessive functionality：Agent 能做太多事情；
* excessive permissions：Agent 权限过大；
* excessive autonomy：高影响操作缺乏独立验证和审批。

尤其需要注意的一点是：

> **LLM 是否“聪明”，与它是否应该拥有业务操作权限，是两个不同的问题。**

一个非常聪明的 Agent 仍然可能因为：

* prompt injection；
* 错误理解；
* stale data；
* tool 返回错误；
* authorization context 错误；
* retry；
* 并发；
* downstream timeout；

而产生错误副作用。

因此不能采用：

```text
LLM reasoning
    ↓
if model says "safe"
    ↓
execute()
```

作为企业级控制模型。

AWS Agentic AI Lens 对这一点的要求更加明确：Agent 的授权应该在 Agent 之外、通过工具层或其他外部边界执行，而不是由 Agent 自己决定自己是否有权限。

---

# 2. Command Pattern 到底是什么

Command 是经典行为型设计模式。

它的核心思想是：

> **把一个请求转换成包含该请求全部信息的独立对象。**

这样，请求本身就可以被：

* 延迟执行；
* 排队；
* 持久化；
* 记录；
* 传输；
* 重试；
* 审批；
* 组合。

这也是经典 Command Pattern 与普通 method call 的根本区别。

Martin Fowler 在 Command Query Separation 中也明确区分了：

* Query：读取状态，不改变系统可观察状态；
* Command：改变系统状态。

因此在传统软件中：

```typescript
account.transfer(from, to, amount);
```

可以转换为：

```typescript
const command = new TransferMoney({
  from,
  to,
  amount
});

executor.execute(command);
```

真正重要的变化不是语法，而是：

```text
method call
```

变成：

```text
business intent as data
```

这正是 Agent 架构需要的能力。

---

# 3. 为什么 Command 特别适合 Agent

Agent 最适合生成的是：

```text
Intent
```

而企业系统需要执行的是：

```text
Business Operation
```

二者并不相同。

例如：

```text
用户：

“帮我把这笔退款处理掉。”
```

LLM 可能理解成：

```json
{
  "operation": "refund",
  "amount": 1000,
  "currency": "USD"
}
```

但企业系统真正需要知道的是：

```text
谁在操作？
哪个账户？
哪个订单？
为什么退款？
退款金额是否允许？
当前状态是否允许退款？
该用户是否有权限？
是否需要二次审批？
是否超过限额？
是否已经执行过？
下游支付平台的 request id 是什么？
```

这些都不是“让 LLM 再聪明一点”可以解决的问题。

Command Pattern 的价值就在于建立这一层：

```text
                    LLM

             "refund this payment"
                      │
                      ▼
              Agent Proposal
                      │
                      ▼
       ┌────────────────────────┐
       │ RefundPaymentCommand   │
       │                        │
       │ paymentId              │
       │ amount                 │
       │ currency               │
       │ reason                 │
       │ expectedVersion        │
       └────────────────────────┘
                      │
                      ▼
                Policy Engine
                      │
                      ▼
                 Executor
```

因此 Command 不应该是：

```text
"LLM decided to call refundPayment"
```

而应该是：

```text
"系统确认有一个 RefundPayment 业务操作等待执行"
```

这个差别非常重要。

---

# 4. Tool 和 Command 不是同一个东西

这是 Agent 架构里最容易混淆的地方之一。

例如：

```typescript
refundPayment(paymentId, amount)
```

它可能同时被称为：

* Tool；
* API；
* Command；
* Service method。

但在架构上，它们承担的职责不同。

可以这样理解：

| 概念       | 解决的问题           |
| -------- | --------------- |
| Tool     | Agent 如何与外部能力交互 |
| Command  | 企业系统准备执行什么业务操作  |
| Policy   | 这个操作是否允许        |
| Executor | 如何可靠地执行         |
| Workflow | 多个操作如何编排        |
| Event    | 某个操作已经发生了什么事实   |
| Audit    | 谁、何时、基于什么依据做了什么 |

例如：

```text
Agent
  ↓
Tool: submitRefund(...)
  ↓
Command: RefundPaymentCommand
  ↓
Policy
  ↓
Executor
  ↓
Payment API
```

因此：

> **Tool 是 Agent-facing interface，Command 是 business-facing contract。**

一个 Tool 最好不要直接等于一个高权限业务 API。

---

# 5. 最重要的架构原则：LLM 不创建完整 Command

这是实现时最重要的一点。

不要让 LLM 生成：

```json
{
  "commandId": "123",
  "actorId": "admin",
  "permissions": ["PAYMENT_WRITE"],
  "approved": true,
  "riskLevel": "LOW",
  "amount": 1000000
}
```

因为这些字段本身就属于安全边界。

LLM 只应该提出：

```json
{
  "commandType": "RefundPayment",
  "paymentId": "P123",
  "amount": 1000,
  "reason": "customer request"
}
```

然后由系统补充：

```text
commandId
actor
agent identity
authorization context
tenant
policy version
risk classification
createdAt
schemaVersion
correlationId
causationId
idempotencyKey
```

甚至：

```text
approvedBy
approvalTime
approvalPolicy
policyDecision
```

也不应该由模型产生。

因此可以定义两个完全不同的对象：

```typescript
interface AgentProposal {
  type: string;
  payload: unknown;
}
```

和：

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

  createdAt: string;

  policy: {
    decisionId: string;
    policyVersion: string;
  };
}
```

前者可以来自 LLM。

后者必须由可信的 application/security infrastructure 构造。

---

# 6. 一个可用于企业 Agent 的 Command 模型

推荐至少把 Command 分成四层：

```text
1. Proposal
2. Canonical Command
3. Execution Record
4. Result
```

例如：

### Proposal

```json
{
  "type": "SubmitProxyVote",
  "meetingId": "MTG-2026-001",
  "securityId": "US123456789",
  "proposalId": "RES-4",
  "vote": "FOR"
}
```

这是 Agent 的建议。

---

### Canonical Command

系统完成：

```text
schema validation
identity binding
resource resolution
authorization
policy evaluation
business validation
normalization
```

形成：

```json
{
  "commandId": "CMD-9f8...",
  "type": "SubmitProxyVote",
  "schemaVersion": 3,
  "payload": {
    "meetingId": "MTG-2026-001",
    "securityId": "US123456789",
    "proposalId": "RES-4",
    "vote": "FOR"
  },
  "actor": {
    "userId": "U123",
    "agentId": "AGENT-7"
  },
  "idempotencyKey": "proxy-vote:MTG-2026-001:RES-4:account-88",
  "policyDecisionId": "POL-123"
}
```

---

### Execution Record

```json
{
  "commandId": "CMD-9f8...",
  "status": "EXECUTING",
  "startedAt": "2026-09-20T08:30:00Z",
  "executor": "proxy-vote-executor"
}
```

---

### Result

```json
{
  "commandId": "CMD-9f8...",
  "status": "SUCCEEDED",
  "externalReference": "ISS-88991"
}
```

这样 Agent 的 reasoning 就和业务执行状态彻底分离了。

---

# 7. 推荐的 Command 生命周期

一个完整 Command 可以具有：

```text
PROPOSED
   ↓
VALIDATED
   ↓
POLICY_CHECKED
   ↓
┌─────────────────┐
│                 │
│ auto approved   │
│                 │
└────────┬────────┘
         │
         ▼
      APPROVED
         │
         │
     human approval
         │
         ▼
      EXECUTING
         │
     ┌───┴────┐
     ▼        ▼
SUCCEEDED   FAILED
              │
              ▼
          RETRYABLE?
           /     \
         yes      no
          │        │
          ▼        ▼
       RETRY    FAILED_FINAL
```

对于高风险操作：

```text
Command
   ↓
Policy
   ↓
REQUIRES_APPROVAL
   ↓
Human Approval
   ↓
Approved
   ↓
Executor
```

OpenAI Agents SDK 当前也提供类似的 HITL 机制：工具可以声明 `needsApproval`，Agent Run 被暂停，审批后再从保存的运行状态继续。

但是这里存在一个重要架构区别：

> **Agent SDK 的 approval interruption 是 Agent Runtime 能力；企业 Command Approval 应该进一步落在业务控制层。**

例如：

```text
Agent Runtime
   ↓
"需要审批"
   ↓
Business Command
   ↓
Enterprise Approval Service
   ↓
Approved
   ↓
Command Executor
```

这样即使未来：

```text
DeepAgents
LangGraph
OpenAI Agents SDK
Copilot SDK
自研 Agent Runtime
```

发生替换，业务审批规则仍然存在。

---

# 8. Command 的核心价值之一：把“副作用”显式化

没有 Command 时：

```typescript
await service.updateCustomer(...)
```

很容易出现：

```text
Agent
  → Tool
      → service
          → DB
```

调用链中很难明确回答：

> 这是一个什么业务动作？

使用 Command 后：

```typescript
await execute(
  new UpdateCustomerAddressCommand(...)
);
```

系统天然可以回答：

```text
Business Action:
    UpdateCustomerAddress

Resource:
    Customer:C123

Actor:
    user U123

Agent:
    agent-7

Reason:
    Customer requested via service channel

Policy:
    CUSTOMER_PROFILE_WRITE_V2

Approval:
    not required

Command:
    CMD-123

Status:
    SUCCEEDED
```

这对于金融服务尤其重要。

监管和风险管理真正关心的通常不是：

```text
LLM token 到底是什么？
```

而是：

```text
谁做了什么？
基于什么数据？
以什么权限？
经过什么控制？
什么时候做的？
最终产生了什么结果？
```

NIST AI RMF 强调 AI 治理中的责任划分、文档化、人工监督以及持续风险管理；对于高风险或关键系统，尤其需要在部署前定义并评估 human oversight。

BIS 在金融领域也强调，AI 输出需要经过适当验证，并指出金融领域应建立治理、监督和必要的 safeguards。

Command 不会自动满足这些要求，但它为这些控制提供了一个非常清晰的落点。

---

# 9. Command + Policy：不要让 Command 自己决定能不能执行

这是另一个非常重要的边界。

错误设计：

```typescript
class RefundPaymentCommand {
  execute() {
    if (this.amount < 1000) {
      return refund();
    }
  }
}
```

问题是业务 policy 会不断变复杂：

```text
金额
客户等级
交易类型
地区
账户状态
风险等级
监管限制
交易时间
审批角色
Delegated Authority
```

最终 Command 变成 policy engine。

更合理：

```text
Command
   ↓
Policy Engine
   ↓
ALLOW
DENY
REQUIRES_APPROVAL
```

例如：

```typescript
const decision = policyEngine.evaluate({
  principal,
  command,
  resource,
  businessContext
});

switch (decision.effect) {
  case "DENY":
    return reject(decision.reason);

  case "REQUIRES_APPROVAL":
    return requestApproval(command, decision);

  case "ALLOW":
    return executor.execute(command);
}
```

AWS Agentic AI Lens 的核心建议正是：

> 对每一次工具调用，在执行之前根据声明式策略进行授权，而不是把授权逻辑交给 Agent。

这也意味着：

> **Command 是“要做什么”，Policy 是“能不能做”。**

二者不应该合并。

---

# 10. Command + Authorization：Agent 身份和用户身份必须区分

一个危险设计是：

```text
User
  ↓
Agent
  ↓
Assume user's full permission
```

例如用户有：

```text
TRADE_READ
TRADE_SUBMIT
TRADE_APPROVE
ADMIN
```

如果 Agent 直接继承整个用户 session，就可能把：

```text
用户可以执行
```

错误等价成：

```text
Agent 自动可以执行
```

AWS 当前 Agentic AI Lens 明确要求区分 Agent identity 和 human user permission，并建议 Agent 使用独立的 service identity，同时保持审计中的身份区分。

更合理的是：

```text
Human identity
       │
       │ initiates
       ▼
Agent identity
       │
       │ requests
       ▼
Command
       │
       ▼
Authorization
       │
       ├── user permissions
       ├── agent permissions
       ├── resource entitlement
       └── business policy
```

因此一个 Command 的 authorization context 可以是：

```typescript
interface AuthorizationContext {
  user: UserIdentity;
  agent: AgentIdentity;

  delegatedScopes: string[];

  resourceEntitlements: string[];

  tenantId: string;
}
```

而这些字段应该来自可信系统，而不是 LLM。

---

# 11. Command + Immutable Hash：解决审批后的“换参数”问题

还有一个经常被忽略的问题：

```text
Agent 提交 Command
      ↓
Human Approval
      ↓
等待 10 分钟
      ↓
Agent 改变参数
      ↓
Execute
```

那么用户到底批准了什么？

因此推荐为 canonical command 生成：

```text
commandHash
```

例如：

```typescript
const canonical = canonicalize(command);

const commandHash = sha256(
  JSON.stringify(canonical)
);
```

审批记录：

```json
{
  "commandId": "CMD-123",
  "commandHash": "abc123...",
  "approvedBy": "USER-88",
  "approvedAt": "...",
  "approvalPolicy": "TRADE_APPROVAL_V4"
}
```

真正执行前：

```text
load command
     ↓
recalculate hash
     ↓
compare approved hash
     ↓
same?
 ┌───┴───┐
yes     no
 ↓       ↓
execute reject
```

这样审批就绑定到**具体的业务请求**，而不是一句模糊的：

> “批准 Agent 的操作。”

---

# 12. Command + Idempotency：金融业务中尤其重要

Command 最大的工程价值之一，是天然可以拥有稳定的：

```text
commandId
idempotencyKey
```

考虑：

```text
Agent
 ↓
Payment API
 ↓
timeout
```

Agent 不知道：

```text
付款到底成功还是失败？
```

于是它 retry：

```text
Payment API
Payment API
Payment API
```

如果没有幂等：

```text
$100
+
$100
+
$100
```

就可能真正发生。

Stripe 官方 API 支持 idempotency key，以便客户端在网络错误后安全重试而不会重复创建或更新对象。

Adyen 也明确将 idempotency 作为避免支付操作重复执行的重要机制，并允许使用相同的 idempotency key 安全重试。

PayPal 同样推荐在创建或修改数据的 API 请求中使用 `PayPal-Request-Id`，以避免重复交易。

因此 Command Executor 中应该明确：

```typescript
await execute(command, {
  idempotencyKey: command.idempotencyKey
});
```

执行记录：

```text
commandId
idempotencyKey
status
result
externalReference
```

重复请求：

```text
same idempotency key
        ↓
lookup previous execution
        ↓
return previous result
```

而不是：

```text
same command
        ↓
execute again
```

---

# 13. commandId 和 idempotencyKey 不应该简单等同

这是实现中的细节，但非常重要。

例如：

```text
commandId = UUID
```

可以标识某一次 Command 实例。

而：

```text
idempotencyKey
```

代表：

> 这个业务操作的重复提交应该被视为同一个操作。

因此：

```text
commandId
```

可以每次创建都不同。

但重试同一个业务请求时：

```text
idempotencyKey
```

必须保持不变。

例如：

```text
CMD-001
idempotency=PAYMENT:ORDER-123:CAPTURE
```

网络超时后重新发送：

```text
CMD-002
idempotency=PAYMENT:ORDER-123:CAPTURE
```

executor 可以识别：

```text
这是同一个业务操作的 retry
```

而不是：

```text
第二次付款
```

---

# 14. Command + Transactional Outbox：解决数据库与消息的双写问题

另一个典型问题：

```text
1. 保存 Command
2. 发消息到 Queue
```

如果：

```text
DB commit 成功
Queue send 失败
```

Command 就可能永远没人执行。

反过来：

```text
Queue send 成功
DB commit 失败
```

下游可能执行不存在的 Command。

AWS 的 Transactional Outbox Pattern 专门用于解决这种 dual-write 问题：将业务数据与 outbox event 放在同一个数据库事务中提交，再由 relay 将消息发送到消息系统。AWS 同时强调消息消费者仍然需要具备幂等性，因为消息可能重复投递。

因此：

```text
DB Transaction
 ├── Command
 └── Outbox Event

commit
  ↓
Outbox Relay
  ↓
Queue
  ↓
Command Executor
```

是非常适合企业 Agent Command 的一个基础设施模式。

但是：

> **Transactional Outbox 解决的是“可靠发布”，不是“exactly once business execution”。**

最终仍然需要：

```text
idempotency
+
consumer deduplication
+
downstream idempotency
```

---

# 15. Command + Optimistic Concurrency：防止 stale command

Agent 的另外一个特点是：

> **它经常基于一个稍早之前看到的状态做决策。**

例如：

```text
10:00
Agent 查询：

Order status = PENDING
```

然后：

```text
10:05
另一系统：

Order status = CANCELLED
```

再：

```text
10:06
Agent：

CancelOrderCommand
```

此时不能简单执行。

Command 应包含：

```json
{
  "orderId": "ORDER-123",
  "expectedVersion": 7
}
```

执行时：

```sql
UPDATE orders
SET status = 'CANCELLED',
    version = version + 1
WHERE id = 'ORDER-123'
  AND version = 7
  AND status = 'PENDING';
```

如果：

```text
affected rows = 0
```

说明状态已经变化。

此时：

```text
Command = rejected due to stale state
```

而不是让 Agent 自己“猜测”怎么办。

这对于：

* 交易；
* 订单；
* Corporate Action；
* Proxy Vote；
* 客户资料；
* 权限；
* 支付；

都很重要。

---

# 16. Command 不应该把“撤销”误认为数据库 Rollback

经典 Command Pattern 经常讲：

```text
undo
```

但在企业 Agent 场景里必须谨慎。

例如：

```text
SubmitTrade
```

不能简单理解成：

```text
undo = DeleteTrade
```

因为真正发生的是：

```text
Trade sent
     ↓
Market accepted
     ↓
Position changed
     ↓
Settlement started
```

这已经不是本地数据库事务。

因此：

> **业务副作用发生以后，通常不能靠 Command Pattern 自动 rollback。**

这时需要：

```text
Compensation
```

例如：

```text
TransferMoney
       ↓
Compensating Command:
ReverseTransfer
```

或者：

```text
CreateOrder
       ↓
CancelOrder
```

这就进入 Saga / Workflow 的范畴。

AWS 将 Saga 定义为跨多个服务协调事务的一种失败管理模式，并特别指出补偿交易是复杂度的重要来源。

所以：

```text
Command
```

和：

```text
Workflow / Saga
```

不要混淆。

---

# 17. Command 不是 Workflow

一个好的架构关系应该是：

```text
Agent
   ↓
Command
   ↓
Workflow
   ├── Command A
   ├── Command B
   ├── Command C
   └── Compensation
```

例如：

```text
SubmitInvestmentOrder
       ↓
InvestmentOrderWorkflow
       │
       ├── ValidateEligibility
       ├── ReserveCash
       ├── SubmitOrder
       ├── ConfirmExecution
       └── NotifyOperations
```

这里：

```text
Command = 一个业务动作
Workflow = 一组动作及其状态、顺序、失败处理
```

尤其对于金融企业，不建议让 Agent Memory 自己承担：

```text
业务流程状态
```

例如：

```json
{
  "agentMemory": {
    "orderStatus": "STEP_4"
  }
}
```

这是危险的。

正确的是：

```text
Business Workflow State
        ↓
durable workflow / database
```

Agent Memory 只能保存：

```text
reasoning context
conversation context
working context
```

而不应该成为：

```text
source of truth for business state
```

---

# 18. 推荐的 TypeScript 实现

下面给出一个适用于企业 Agent 的简化实现。

## 18.1 Command interface

```typescript
interface Command<TPayload> {
  readonly commandId: string;
  readonly type: string;
  readonly schemaVersion: number;
  readonly payload: TPayload;

  readonly actor: {
    userId: string;
    agentId: string;
  };

  readonly correlationId: string;
  readonly causationId?: string;

  readonly idempotencyKey: string;

  readonly commandHash: string;
}
```

Command 本身应该是：

```text
immutable
serializable
deterministic
```

不要把：

```text
DB connection
HTTP client
LLM instance
Agent runtime
```

放进 Command 对象。

Command 是数据，不是执行环境。

---

## 18.2 Domain Command

```typescript
interface RefundPaymentPayload {
  paymentId: string;
  amount: number;
  currency: string;
  reason: string;

  /**
   * Protect against stale state.
   */
  expectedVersion: number;
}
```

然后：

```typescript
type RefundPaymentCommand =
  Command<RefundPaymentPayload> & {
    readonly type: "RefundPayment";
  };
```

---

## 18.3 LLM Tool

LLM 只暴露：

```typescript
const refundPaymentTool = {
  name: "propose_refund_payment",

  inputSchema: {
    type: "object",
    properties: {
      paymentId: { type: "string" },
      amount: { type: "number" },
      currency: { type: "string" },
      reason: { type: "string" }
    },
    required: [
      "paymentId",
      "amount",
      "currency",
      "reason"
    ]
  }
};
```

注意这里叫：

```text
propose_refund_payment
```

而不是：

```text
execute_refund_payment
```

语义上已经开始区分：

```text
LLM proposal
```

和：

```text
business execution
```

---

# 19. Command Builder

```typescript
async function buildCommand(
  proposal: AgentProposal,
  context: ExecutionContext
): Promise<Command<unknown>> {

  const validated =
    commandSchemaRegistry
      .get(proposal.type)
      .parse(proposal.payload);

  const command = {
    commandId: crypto.randomUUID(),

    type: proposal.type,

    schemaVersion: 1,

    payload: validated,

    actor: {
      userId: context.user.id,
      agentId: context.agent.id
    },

    correlationId: context.correlationId,

    causationId: context.agentRunId,

    idempotencyKey:
      buildIdempotencyKey(
        proposal,
        context
      )
  };

  return {
    ...command,

    commandHash:
      hashCanonicalCommand(command)
  };
}
```

这里最重要的是：

```text
LLM -> proposal
system -> command
```

而不是：

```text
LLM -> command
```

---

# 20. Policy Engine

```typescript
type PolicyEffect =
  | "ALLOW"
  | "DENY"
  | "REQUIRES_APPROVAL";

interface PolicyDecision {
  effect: PolicyEffect;
  policyId: string;
  policyVersion: string;
  decisionId: string;
  reason?: string;
}

async function authorize(
  command: Command<unknown>,
  context: ExecutionContext
): Promise<PolicyDecision> {

  return policyEngine.evaluate({
    principal: {
      user: context.user,
      agent: context.agent
    },

    command: {
      type: command.type,
      payload: command.payload
    },

    resourceEntitlements:
      context.resourceEntitlements
  });
}
```

重要的是：

```text
policyEngine
```

不能使用：

```text
LLM judgment
```

作为最终授权来源。

LLM 可以：

```text
recommend
classify
summarize
extract
```

但：

```text
authorization
entitlement
risk boundary
```

必须由确定性的系统控制。

---

# 21. Command Executor

```typescript
async function executeCommand(
  command: Command<unknown>,
  context: ExecutionContext
) {
  const decision =
    await authorize(command, context);

  if (decision.effect === "DENY") {
    return rejectCommand(
      command,
      decision
    );
  }

  if (
    decision.effect === "REQUIRES_APPROVAL"
  ) {
    return createApprovalRequest(
      command,
      decision
    );
  }

  return commandRegistry
    .get(command.type)
    .execute(command);
}
```

这里可以看到：

```text
Agent
```

并没有：

```text
permission to execute
```

它只是产生：

```text
request
```

真正执行权在：

```text
Command Executor
```

---

# 22. Executor 不应该只做 API 调用

简单实现可能是：

```typescript
execute(command) {
  return paymentApi.refund(...);
}
```

企业级实现应该大致是：

```text
1. Load Command
2. Verify schema
3. Verify command hash
4. Verify identity
5. Verify authorization
6. Verify approval
7. Verify expiry
8. Verify business preconditions
9. Verify idempotency
10. Execute
11. Persist result
12. Publish event
13. Audit
```

即：

```text
Command
   ↓
Authorization
   ↓
Approval
   ↓
Precondition
   ↓
Idempotency
   ↓
Execution
   ↓
Result
   ↓
Audit/Event
```

这就是 Command 从一个 OO Design Pattern 变成 Enterprise Agent Architecture Primitive 的关键。

---

# 23. 业务副作用应该进行风险分级

不是所有 Command 都需要人工审批。

推荐至少区分：

| 类型                       | 示例                       | 推荐控制                                         |
| ------------------------ | ------------------------ | -------------------------------------------- |
| Read                     | 查询客户、查询持仓                | normal authorization                         |
| Low-risk mutation        | 保存草稿、生成内部备注              | authorization                                |
| Reversible mutation      | 修改非关键资料                  | authorization + audit                        |
| External communication   | 发送邮件、通知客户                | authorization + optional approval            |
| Financial mutation       | refund、payment、trade     | policy + idempotency + approval/risk control |
| Irreversible/high-impact | transfer、proxy vote、权限提升 | strong policy + approval + audit             |

AWS Agentic AI Lens 建议高风险修改操作在工具执行前设置 human-in-the-loop checkpoint，同时通过 rate limits 限制 Agent runaway loop 的影响范围。

OpenAI Agents SDK 当前也支持针对具体 Tool 设置 `needsApproval`，并且支持在审批暂停后持久化 RunState 再继续执行。

因此一个合理设计不是：

```text
Agent 一律不能做 mutation
```

也不是：

```text
Agent 一律可以做 mutation
```

而是：

```text
command risk
      ↓
policy
      ↓
approval level
```

---

# 24. 金融服务中的典型例子：Proxy Voting

以 Proxy Voting 为例。

Agent 可以做：

```text
研究会议材料
分析公司治理
总结 ISS / company documents
比较 voting policy
提出建议：
Proposal 4 -> FOR
```

但是：

> **“FOR”是 Agent Proposal，不等于“已经投票”。**

最终应该转换成：

```text
SubmitProxyVoteCommand
```

包含：

```json
{
  "meetingId": "...",
  "accountId": "...",
  "securityId": "...",
  "proposalId": "...",
  "vote": "FOR",
  "policyReference": "...",
  "expectedMeetingVersion": 12
}
```

然后：

```text
Command
 ↓
position eligibility
 ↓
client mandate
 ↓
voting policy
 ↓
cut-off time
 ↓
delegated authority
 ↓
approval requirement
 ↓
ISS / voting infrastructure
```

这里最关键的是：

```text
Agent:
    recommends "FOR"

Command:
    "Submit this exact vote"

Policy:
    "This account allows this vote"

Executor:
    "send vote to external provider"
```

它们是三个不同概念。

这也说明为什么 Agent 不应该直接拥有：

```text
ISS API credentials
```

然后让 LLM 自己决定：

```text
vote(...)
```

更合理的模型是：

```text
Agent
   ↓
SubmitProxyVoteProposal
   ↓
Command
   ↓
Entitlement + Policy + Approval
   ↓
ProxyVoteExecutor
   ↓
ISS/vendor/internal platform
```

---

# 25. 另一个金融例子：支付/退款

考虑：

```text
用户：
“把这笔费用退给客户。”
```

Agent 可能找到：

```text
Payment P123
Amount = $20,000
```

但它不能直接执行：

```typescript
stripe.refunds.create(...)
```

首先形成：

```text
RefundPaymentCommand
```

然后：

```text
1. Payment belongs to customer?
2. Refundable?
3. Already refunded?
4. Amount <= remaining refundable amount?
5. User entitlement?
6. Agent scope?
7. Amount threshold?
8. Approval required?
9. Idempotency key?
```

最终才是：

```text
Payment Provider API
```

支付领域已经长期使用这种思想背后的可靠性机制。Stripe、Adyen、PayPal 都将 idempotency 作为避免重复支付/修改的重要机制。

这不是 Agent 专属技术，但 Agent 让这类问题变得更加重要，因为：

```text
传统应用：
代码确定地调用 API

Agent：
模型决定什么时候、为什么、调用哪个 API
```

所以控制边界必须更明确。

---

# 26. 真实行业案例：Visa 正在把“Agent 可以付款”变成基础设施问题

Visa 的 agentic commerce 工作是一个非常有代表性的现实案例。

Visa 在 2025 年提出 Visa Intelligent Commerce，用 tokenization、authentication、transaction controls 等能力支持 Agent 代表用户完成购买。Visa 明确将 agent identity、consumer control、delegated authorization 等问题视为 agentic payment 的基础设施问题。

Visa 随后发布 Trusted Agent Protocol，目标是让 Merchant 能够在 agent-driven transaction 中识别和信任 Agent。

到 2025 年 12 月，Visa 宣布已经与合作伙伴完成数百笔 secure agent-initiated transactions。这个数字属于 Visa 自己对其项目进展的披露，应理解为企业官方发布的数据，而不是独立监管统计。

2026 年 Visa 又进一步讨论 agentic payments，并把：

```text
structured payment instructions
agent identity
delegated credentials
authentication
risk modelling
liability
```

列为 agentic payment architecture 的核心层次。

这个案例非常能说明 Command Architecture 的必要性：

```text
Natural-language intention
        ↓
Structured payment instruction
        ↓
Delegated authority
        ↓
Risk / authentication
        ↓
Payment execution
```

它实际上正在把：

```text
Agent intention
```

转换成：

```text
bounded executable instruction
```

这和 Command Pattern 的架构思想高度一致。

需要注意的是，Visa 的产品架构并不是“实现了 GoF Command Pattern”，这里的关系是**架构思想上的类比**，而不是说 Visa 内部明确采用了 Command Pattern。

---

# 27. Mastercard 的 Agent Pay 也体现了类似边界

Mastercard 在 2025 年发布 Agent Pay，并提出 Agentic Tokens，强调在 Agent 代表用户进行支付时，需要保持：

```text
trust
security
control
```

并使用既有 tokenization 能力建立适合 Agent 的支付授权机制。

这再次说明：

> 当 Agent 开始产生金融副作用以后，真正需要解决的问题并不是“如何让 LLM 调 API”，而是“如何把 delegated intent 转换成受约束的可执行操作”。

这正是 Command 层应该承担的职责。

---

# 28. GitHub Copilot Coding Agent 是另一个很直观的类比

GitHub 当前的 coding agent 已经能够：

```text
接受任务
   ↓
研究
   ↓
修改代码
   ↓
创建 Pull Request
   ↓
请求人工 review
```

GitHub 的第三方 coding agents 文档也明确描述了类似模式：Agent 可以独立完成任务并创建 Pull Request，完成后请求用户 review；同时 GitHub 会对 Agent 修改的代码进行 CodeQL、secret scanning 等安全检查。

这不是金融业务，但很适合说明一个原则：

```text
Agent autonomous execution
        ≠
Agent final authority
```

Agent 可以完成大量工作，但仍然需要一个明确的“业务交付边界”。

在代码领域，这个边界是：

```text
Pull Request + Review
```

在金融业务领域，则可能是：

```text
Command + Policy + Approval + Execution
```

---

# 29. Command + Audit：不要只记录 Agent Trace

很多 Agent 平台已经有：

```text
LLM trace
tool call trace
token usage
latency
prompt
response
```

这些很有价值，但不等于业务审计。

例如 LangSmith / Agent Runtime trace 可以告诉你：

```text
Agent called tool:
submit_proxy_vote(...)
```

但金融业务审计真正需要回答：

```text
为什么允许这个 vote？

谁授权？

针对哪个账户？

当时账户 entitlement 是什么？

适用哪一个 policy version？

谁批准？

批准时具体 command hash 是什么？

最终发送给外部系统的是什么？

外部系统返回什么 reference？

```

因此建议区分：

```text
Agent Telemetry
```

和：

```text
Business Audit Evidence
```

例如：

```text
Agent Trace
 ├── prompt
 ├── model
 ├── tool call
 └── token usage

Business Audit
 ├── command
 ├── actor
 ├── authorization
 ├── policy
 ├── approval
 ├── execution
 ├── external reference
 └── outcome
```

二者可以关联：

```text
correlationId
causationId
commandId
agentRunId
```

但不应该互相替代。

---

# 30. Audit Record 推荐保存什么

对于高影响业务操作，至少应该可以重建：

```text
WHO
    user
    agent

WHAT
    command type
    command payload
    command version

WHY
    originating request
    business reason
    policy reference

AUTHORIZATION
    identity
    entitlement
    policy decision

APPROVAL
    approver
    approval timestamp
    approved command hash

EXECUTION
    executor
    start time
    end time
    retry count

EXTERNAL EFFECT
    external system
    external reference
    result

OUTCOME
    succeeded
    failed
    compensated
```

尤其需要保证：

```text
approved command hash
==
executed command hash
```

否则审计链条可能失去意义。

---

# 31. 一个非常重要的安全原则：Command Payload 是 Untrusted Input

即使 Command 已经通过 Agent 生成，也不应该认为它“可信”。

过程应该是：

```text
LLM output
   ↓
UNTRUSTED
   ↓
schema validation
   ↓
business validation
   ↓
authorization
   ↓
policy
   ↓
approval
   ↓
execution
```

换句话说：

> **Command Pattern 并不会把 LLM Output 变成 Trusted Input。**

它只是让系统有一个明确的位置去验证。

这一点对 prompt injection 尤其重要。

例如邮件内容：

```text
“Please update my bank account to XXXX.”
```

Agent 读取邮件后可能生成：

```text
UpdateBankAccountCommand
```

这仍然只是一个 proposal。

系统还必须检查：

```text
Does this user have authority?
Is this operation supported through this channel?
Is external verification required?
Does bank-account-change policy require step-up authentication?
```

不能因为：

```text
"它已经变成 Command 了"
```

就认为是安全的。

---

# 32. Command 不应该支持无限开放式操作

危险设计：

```typescript
interface ShellCommand {
  command: string;
}
```

然后：

```text
Agent
  ↓
ShellCommand("anything")
```

或者：

```typescript
interface GenericApiCommand {
  url: string;
  method: string;
  body: unknown;
}
```

这种设计表面上是 Command，实际上只是把：

```text
open-ended agency
```

包装了一层。

OWASP 明确建议避免过于开放的 Agent extensions，并优先使用功能粒度明确的接口；例如需要发送邮件时，不应该向 Agent 提供一个拥有整个 mailbox 写权限的开放工具。

所以应该：

```text
SendCustomerEmailCommand
```

而不是：

```text
HttpRequestCommand
```

应该：

```text
SubmitProxyVoteCommand
```

而不是：

```text
CallISSApiCommand
```

应该：

```text
CreateTradeOrderCommand
```

而不是：

```text
ExecuteBrokerApiCommand
```

这也是一个非常重要的设计原则：

> **Command 的粒度应该对应业务能力，而不是对应底层技术接口。**

---

# 33. Business Command，而不是 Technical Command

坏例子：

```text
CallPostgresCommand
CallGraphQLCommand
CallHttpCommand
CallLambdaCommand
```

好的 Command：

```text
CreateTradeOrder
ApprovePayment
SubmitProxyVote
ChangeCustomerAddress
FreezeAccount
ReleaseCash
SendClientNotification
```

前者是：

```text
technology abstraction
```

后者是：

```text
business capability
```

后者才适合作为 Agent 的控制边界。

因为 Policy 才能理解：

```text
SubmitProxyVote
```

意味着：

```text
Financial transaction
Potentially irreversible
Requires account entitlement
May require approval
Has cutoff time
```

而：

```text
POST /api/v1/proxy/votes
```

只是技术细节。

---

# 34. Command 与 Domain Service 的关系

推荐：

```text
Command
   ↓
Application Service / Handler
   ↓
Domain Model
   ↓
Infrastructure Adapter
```

例如：

```typescript
class SubmitProxyVoteHandler {

  constructor(
    private votingPolicy: VotingPolicy,
    private voteRepository: VoteRepository,
    private issGateway: IssGateway
  ) {}

  async execute(
    command: SubmitProxyVoteCommand
  ) {
    // domain validation
    const ballot =
      await this.voteRepository.getBallot(
        command.payload.meetingId
      );

    this.votingPolicy.validate(ballot, command);

    // external side effect
    return this.issGateway.submitVote({
      ...
    });
  }
}
```

Agent 不应该直接：

```typescript
issGateway.submitVote(...)
```

而应该：

```text
Agent
 ↓
Command
 ↓
Handler
 ↓
Domain
 ↓
Gateway
```

这样下游系统不会被 Agent Runtime 直接暴露。

---

# 35. Command Registry

如果 Command 数量很多，可以维护一个 registry：

```typescript
interface CommandHandler<T> {
  execute(command: Command<T>): Promise<CommandResult>;
}

const commandRegistry =
  new Map<string, CommandHandler<any>>([
    [
      "RefundPayment",
      refundPaymentHandler
    ],

    [
      "SubmitProxyVote",
      submitProxyVoteHandler
    ],

    [
      "CreateTradeOrder",
      createTradeOrderHandler
    ]
  ]);
```

Agent 所看到的是有限的：

```text
registered business capabilities
```

而不是整个系统里的：

```text
1000 APIs
```

这也和 least privilege 的思想一致。AWS 建议每个 Agent 只获取执行其特定功能所需的最小权限，并通过 runtime boundary 限制 LLM reasoning 能够到达的范围。

---

# 36. Command Versioning 很重要

业务 Command 不应该频繁破坏兼容性。

例如：

```text
SubmitProxyVoteCommand v1
```

变成：

```text
SubmitProxyVoteCommand v2
```

旧 Command 可能已经：

```text
queued
awaiting approval
scheduled
```

因此建议：

```json
{
  "type": "SubmitProxyVote",
  "schemaVersion": 2
}
```

Executor：

```text
v1 → migration
v2 → native
```

不要简单依赖当前代码的 TypeScript interface。

因为 Command 可能：

```text
stored
queued
retried
resumed
audited
replayed
```

它的生命周期已经超过一次 HTTP request。

---

# 37. Command Expiration

有些 Command 天生具有有效期。

例如：

```text
SubmitProxyVote
```

可能：

```text
cutoff = 2026-09-20 16:00
```

如果：

```text
Agent proposed
   ↓
human approval
   ↓
queue delay
   ↓
cutoff passed
```

就不能继续执行。

Command 应该有：

```typescript
expiresAt: string;
```

Executor：

```typescript
if (Date.now() > expiresAt) {
  return reject("COMMAND_EXPIRED");
}
```

这比：

```text
Agent memory:
"this vote should still be executed"
```

可靠得多。

---

# 38. Command 应该能够被安全地拒绝

一个成熟的 Agent Architecture 不应该把：

```text
command rejected
```

视为 exception。

它是正常业务结果。

例如：

```json
{
  "status": "REJECTED",
  "reasonCode": "INSUFFICIENT_ENTITLEMENT",
  "message": "User is not authorized to submit this vote."
}
```

Agent 可以得到这个结果：

```text
ToolResult:
command rejected
reason = insufficient entitlement
```

然后：

```text
Agent:
"该操作需要 Investment Operations 批准。"
```

这比让 Agent 直接得到：

```text
HTTP 403 stack trace
```

更符合企业架构。

OpenAI Agents SDK 当前的 tool guardrails 也采用了类似思想：tool invocation 可以被拒绝或触发 tripwire，而不是必须进入实际工具执行。

---

# 39. Command Result 也应该结构化

不要：

```text
"Something went wrong"
```

应该：

```typescript
interface CommandResult {
  status:
    | "SUCCEEDED"
    | "REJECTED"
    | "FAILED"
    | "PENDING";

  commandId: string;

  reasonCode?: string;

  externalReference?: string;

  retryable?: boolean;

  metadata?: Record<string, unknown>;
}
```

例如：

```json
{
  "status": "FAILED",
  "reasonCode": "PROVIDER_TIMEOUT",
  "retryable": true
}
```

Agent 可以正确处理：

```text
retry
```

而不是因为看到：

```text
"timeout"
```

自己决定：

```text
retry three times
```

因此：

> **Retry policy 也应该由系统决定，不应该由 LLM 自己决定。**

---

# 40. Retry 不能由 Agent 自由控制

危险模式：

```text
Agent:
call API
→ timeout
→ call again
→ timeout
→ call again
→ call again
```

这可能形成：

```text
runaway loop
```

因此 retry 应由：

```text
Executor / Workflow
```

决定：

```text
retryable?
max attempts?
backoff?
dead-letter?
circuit breaker?
```

而不是：

```text
LLM reasoning
```

AWS Agentic AI Lens 也专门提出 rate limiting，以限制 Agent runaway loop 的影响范围。

---

# 41. Command 与 Event 必须区分

这一点在 Event-Driven Architecture 中尤其重要。

```text
Command:
"Please approve payment."

Event:
"PaymentApproved."
```

Command 是：

```text
imperative
```

Event 是：

```text
fact
```

因此：

```text
ApprovePaymentCommand
        ↓
execution
        ↓
PaymentApprovedEvent
```

不能反过来把：

```text
PaymentApprovedEvent
```

当成：

```text
ApprovePaymentCommand
```

更不能让 Agent 从：

```text
Event
```

直接产生：

```text
side effect
```

而没有经过 policy/control boundary。

---

# 42. Command 与 Event Sourcing 也不是一回事

Command：

```text
what someone wants to do
```

Event：

```text
what happened
```

State：

```text
what is currently true
```

例如：

```text
Command
    ApproveTrade

Event
    TradeApproved

State
    Trade.status = APPROVED
```

三者应该保持明确分离。

否则很容易出现：

```text
Agent memory
  = business state
  = event log
  = command queue
```

最终系统变得不可审计。

---

# 43. 对金融服务尤其重要：Data Entitlement 与 Command Authorization 是两个问题

假设 Agent 查询：

```text
客户 A 的持仓
```

即便它有：

```text
read entitlement
```

也不意味着：

```text
可以提交交易
```

因此：

```text
Data Entitlement
```

解决：

```text
what can I read?
```

而：

```text
Command Authorization
```

解决：

```text
what may I change?
```

两者不要合并。

例如：

```text
RAG
 ↓
returns account position
```

不应该意味着：

```text
Agent can therefore trade that account
```

这也是为什么 Command 必须独立存在：

```text
Retrieval result
       ↓
Agent reasoning
       ↓
Command Proposal
       ↓
Business Authorization
```

---

# 44. Command 与 RAG 也应该分离

一个常见误区：

```text
RAG 找到：

"Investment policy allows purchase under 10%"

        ↓

LLM
        ↓

CreateTradeOrder
```

这仍然不够。

RAG 只是：

```text
evidence / context
```

它不应该成为：

```text
authorization decision
```

正确逻辑应该是：

```text
RAG
 ↓
Agent reasoning
 ↓
proposal
 ↓
policy engine
 ↓
current authoritative policy
 ↓
authorization
```

换句话说：

> **Retrieval 可以帮助 Agent 理解业务，但不能绕过业务控制。**

这对金融业务尤其重要。

---

# 45. 为什么 Command 比“直接 Tool Calling”更适合金融企业

直接 Tool Calling：

```text
LLM
 ↓
Tool
 ↓
API
```

非常适合：

```text
search_customer
get_market_price
retrieve_document
calculate_fx
```

但当 Tool 开始产生：

```text
payment
trade
approval
proxy vote
account change
permission change
client communication
```

就需要：

```text
LLM
 ↓
Tool
 ↓
Command
 ↓
Policy
 ↓
Approval
 ↓
Executor
```

这不是为了增加层数，而是因为这两类 Tool 的性质本来就不同。

可以称为：

```text
Query Tool
```

和：

```text
Mutation Tool
```

对于 Query：

```text
LLM → Tool → Data
```

通常就足够。

对于 Mutation：

```text
LLM
 → Proposal
 → Command
 → Policy
 → Approval
 → Execution
```

更合适。

---

# 46. 一个非常实用的划分：Tool 可以只有两种模式

可以把 Agent Tool 简化成：

```text
READ
```

和：

```text
PROPOSE_MUTATION
```

例如：

```text
search_customer
READ

get_positions
READ

calculate_fee
READ

propose_refund
PROPOSE_MUTATION

propose_trade
PROPOSE_MUTATION

propose_proxy_vote
PROPOSE_MUTATION
```

然后系统统一处理：

```text
PROPOSE_MUTATION
      ↓
Command Builder
      ↓
Policy
      ↓
Approval
      ↓
Execution
```

这种模型非常适合企业 Agent Platform，因为不会要求每个 Agent Developer 都重新实现：

```text
auth
audit
approval
idempotency
```

---

# 47. Command 应该作为平台能力，而不是每个 Agent 自己实现

如果企业有：

```text
100 agents
```

不能出现：

```text
Agent A:
自己实现 payment guard

Agent B:
自己实现 approval

Agent C:
自己实现 audit

Agent D:
自己实现 retry
```

应该建立：

```text
Enterprise Agent Platform
        │
        ├── Command Registry
        ├── Policy Engine
        ├── Authorization
        ├── Approval Service
        ├── Command Store
        ├── Executor
        ├── Idempotency
        ├── Audit
        └── Outbox
```

Agent 负责：

```text
reasoning
planning
proposal
```

平台负责：

```text
control
```

业务系统负责：

```text
business semantics
```

这种边界尤其适合大型金融机构。

---

# 48. 推荐的完整架构

综合起来，一个比较成熟的 Agent Command Architecture 可以是：

```text
┌───────────────────────────────────────────────────────┐
│                    Agent Layer                        │
│                                                       │
│   LLM / Agent / Planner / RAG / Memory               │
│                                                       │
│   Responsibility:                                    │
│   - understand intent                                │
│   - reason                                            │
│   - plan                                              │
│   - propose business action                           │
└───────────────────────┬───────────────────────────────┘
                        │
                        │ Proposal
                        ▼
┌───────────────────────────────────────────────────────┐
│                 Command Boundary                      │
│                                                       │
│   Schema Validation                                   │
│   Canonicalization                                    │
│   Command Versioning                                  │
│   Identity Binding                                    │
│   Idempotency                                         │
└───────────────────────┬───────────────────────────────┘
                        │
                        ▼
┌───────────────────────────────────────────────────────┐
│               Control Plane                           │
│                                                       │
│   Authorization                                       │
│   Data Entitlement                                    │
│   Business Policy                                     │
│   Risk Classification                                 │
│   Human Approval                                      │
│                                                       │
└───────────────────────┬───────────────────────────────┘
                        │
                        ▼
┌───────────────────────────────────────────────────────┐
│               Command Lifecycle                       │
│                                                       │
│   Command Store                                       │
│   Status                                               │
│   Expiration                                           │
│   Approval Binding                                     │
│   Audit                                                 │
│                                                       │
└───────────────────────┬───────────────────────────────┘
                        │
                        ▼
┌───────────────────────────────────────────────────────┐
│               Execution Layer                         │
│                                                       │
│   Handler                                              │
│   Domain Service                                       │
│   Precondition                                         │
│   Optimistic Concurrency                               │
│   Retry / Timeout / Circuit Breaker                    │
│   Idempotency                                          │
│                                                       │
└───────────────────────┬───────────────────────────────┘
                        │
              ┌─────────┴─────────┐
              ▼                   ▼
       Internal Systems      External Systems
       DB / Domain API      Payment / Broker /
                            Vendor / CRM / Email
```

---

# 49. Command Pattern 真正解决的是什么

现在可以准确回答：

### 它解决了什么？

它解决：

```text
Agent proposal
      ↓
explicit business action
```

使业务操作成为：

```text
structured
serializable
auditable
authorizable
approvable
retryable
idempotent
```

的对象。

---

### 它没有单独解决什么？

它本身不能解决：

```text
Authorization
Authentication
Prompt Injection
Data Entitlement
Human Approval
Distributed Transactions
Exactly Once
Business Policy
Fraud
Risk
Audit Retention
```

这些需要其他机制。

所以：

> **Command Pattern 是 Agent 副作用控制的“架构连接点”，而不是完整安全方案。**

这个定位非常重要。

---

# 50. Command Pattern 与其他机制的关系

可以把整个体系理解成：

| 问题                  | 机制                             |
| ------------------- | ------------------------------ |
| Agent 想做什么          | Command                        |
| Agent 有没有权限         | Authorization                  |
| 当前业务规则是否允许          | Policy                         |
| 是否需要人批准             | Approval                       |
| 能否安全 retry          | Idempotency                    |
| DB + Message 如何可靠一致 | Transactional Outbox           |
| 多系统长事务如何协调          | Workflow / Saga                |
| 资源当前是否仍满足条件         | Precondition / Optimistic Lock |
| 谁做了什么               | Audit                          |
| Agent 为什么得到这个上下文    | Trace / Evidence               |
| 已经发生了什么             | Event                          |

因此不要试图让 Command：

```text
成为所有问题的终极抽象
```

这会导致所谓的：

```text
God Command
```

最终 Command 里包含：

```text
policy
workflow
authorization
database transaction
HTTP
retry
approval
```

然后重新变成一个巨型 service。

---

# 51. 什么时候不需要 Command Pattern

也不是任何 Agent Tool 都需要 Command。

例如：

```text
SearchMarketData
GetWeather
SearchDocuments
GetCustomerProfile
CalculatePortfolioRisk
RetrievePolicy
```

如果它们：

```text
不产生业务副作用
```

直接 Tool Calling 往往就足够：

```text
Agent
 ↓
Tool
 ↓
Read-only system
```

没有必要为了设计模式而增加：

```text
Command
Command Store
Approval
Executor
```

否则会造成过度设计。

真正需要 Command 的判断条件可以简单化：

> **这个调用如果成功，会不会改变一个业务系统的持久状态、外部状态、权限状态、金融状态或对第三方产生不可逆影响？**

如果：

```text
NO
```

普通 Tool 通常够了。

如果：

```text
YES
```

就应该认真考虑 Command Boundary。

---

# 52. 一个更实用的判断表

| 操作           | Command?     |
| ------------ | ------------ |
| 搜索股票价格       | 否            |
| 查询客户资料       | 否            |
| 查询 Portfolio | 否            |
| 计算风险         | 否            |
| 生成报告         | 通常否          |
| 保存 draft     | 可选           |
| 发送邮件         | 是            |
| 修改客户资料       | 是            |
| 创建订单         | 是            |
| 提交交易         | 是            |
| 付款           | 是            |
| 退款           | 是            |
| Proxy Vote   | 是            |
| 修改权限         | 是            |
| 删除客户数据       | 是            |
| 启动跨系统流程      | 是 + Workflow |

---

# 53. 实施时最值得遵守的 12 条原则

### 1. LLM 只能 Proposal，不能定义 Security Boundary

模型可以生成：

```text
what
```

不能定义：

```text
whether allowed
```

---

### 2. Command 是业务对象，不是 HTTP 请求

不要：

```text
HttpRequestCommand
```

优先：

```text
CreateTradeOrder
SubmitProxyVote
RefundPayment
```

---

### 3. Tool 不等于 Command

Tool 是 Agent interface。

Command 是 Business interface。

---

### 4. Authorization 必须在 Agent 外部执行

不要：

```text
LLM: "I'm authorized."
```

必须：

```text
Policy Engine: ALLOW
```

AWS 的 Agentic AI Lens 明确强调这一点。

---

### 5. Approval 必须绑定具体 Command

最好至少绑定：

```text
commandId
commandHash
approver
timestamp
```

---

### 6. Mutation 必须考虑 idempotency

尤其：

```text
payment
trade
refund
external API
```

支付领域的 Stripe、Adyen、PayPal 已经长期采用这种模式。

---

### 7. Command Payload 应该不可变

Approval 之后不能偷偷改变：

```text
amount
account
instrument
recipient
vote
```

---

### 8. 重要操作必须重新检查 precondition

不能相信 Agent 之前看到的状态。

---

### 9. Workflow 状态不要存在 Agent Memory

Command 可以存储业务操作。

Workflow 应有自己的 durable state。

---

### 10. Audit 不要只依赖 Agent Trace

业务操作应该有独立的：

```text
Business Audit Record
```

---

### 11. Command Handler 应该面向业务能力

不要让 Agent 获得：

```text
arbitrary HTTP
arbitrary SQL
arbitrary shell
```

---

### 12. 高风险操作必须设置影响范围限制

包括：

```text
rate limit
amount limit
resource limit
time limit
approval
emergency stop
```

这与 AWS 对 runaway agent impact containment 的建议一致。

---

# 54. 对企业 Agent Platform 的最终建议

如果把这一套落到一个企业 AI Platform，上层最好不要提供：

```text
Agent
 → arbitrary Tool
 → arbitrary API
```

而是提供两条明显不同的路径：

```text
                 Agent
                   │
        ┌──────────┴──────────┐
        │                     │
      Query              Mutation Proposal
        │                     │
        ▼                     ▼
   Read-only Tool         Command Builder
                              │
                              ▼
                         Policy Engine
                              │
                    ┌─────────┴─────────┐
                    │                   │
                 Auto                Approval
                    │                   │
                    └─────────┬─────────┘
                              ▼
                        Command Executor
                              │
                              ▼
                         Business API
```

这是比：

```text
Agent → Tool → API
```

更适合金融服务企业的架构。

尤其当平台未来拥有：

```text
100+ Agents
1000+ Tools
多个 LLM
多个 MCP Server
多个业务系统
多个数据源
多个外部 Vendor
```

以后，真正需要规模化的不是：

```text
prompt engineering
```

而是：

```text
business action governance
```

Command 正好是这个治理体系中最值得标准化的一层。

---

# 55. 最终结论

Command Pattern 在 Agent 架构中的真正意义，不是把经典 GoF Pattern 原封不动地搬进 AI 系统。

它解决的是 Agent 时代一个非常现实的问题：

```text
LLM 可以产生开放式、概率性的行为
                    ↓
企业业务却需要确定性、可授权、可审计的副作用
```

二者之间需要一个边界。

这个边界可以表达为：

```text
LLM
    ↓
Intent / Proposal
    ↓
Command
    ↓
Authorization
    ↓
Policy
    ↓
Approval
    ↓
Execution
    ↓
External Side Effect
```

其中最重要的原则是：

> **Agent 可以决定“建议做什么”，但不能凭借自己的 reasoning 决定“企业允许做什么”。**

Command 的价值就在于把 Agent 的开放式输出转换成一个：

```text
明确的业务动作
```

然后把这个动作交给：

```text
Policy
Authorization
Approval
Idempotency
Workflow
Execution
Audit
```

这些确定性的企业机制处理。

因此，最合理的企业 Agent 架构不是：

```text
Agent = Business Automation
```

而是：

```text
Agent = Reasoning / Proposal Layer

Command = Business Action Boundary

Policy = Authorization Boundary

Workflow = Business State Boundary

Executor = Side-effect Boundary

Audit = Evidence Boundary
```

在金融服务领域尤其如此。

未来 Agent 不会只是：

```text
answer questions
```

而会逐渐进入：

```text
payments
trading
proxy voting
client servicing
operations
access management
corporate actions
treasury
```

这些领域真正的技术挑战也不会只是：

```text
“LLM 能不能调用 API？”
```

而会变成：

```text
“Agent 如何获得有限、可验证、可撤销、可审计的业务行动能力？”
```

Command Pattern 并不能单独回答这个问题，但它提供了一个非常清晰的第一层边界：

> **把“模型想做什么”转换成“企业系统准备允许执行什么”。**

这是 Agent 从 Demo 走向企业级业务系统时，一个值得优先建立的架构基础。

---

# 参考资料

### 1. Command Pattern 与软件设计

Martin Fowler, **Command Query Separation**
Fowler 对 Command 与 Query 的基本职责进行了经典定义：Command 改变系统状态，而 Query 不产生可观察副作用。
[Martin Fowler — Command Query Separation](https://martinfowler.com/bliki/CommandQuerySeparation.html?utm_source=chatgpt.com)

Refactoring Guru, **Command Design Pattern**
系统说明 Command 如何把请求转换成独立对象，从而支持延迟执行、排队、序列化、历史记录和 undo 等能力。
[Refactoring Guru — Command Pattern](https://refactoring.guru/design-patterns/command?utm_source=chatgpt.com)

---

### 2. Agent Tool Governance 与安全

AWS Well-Architected Framework, **Agentic AI Lens — Secure agent tool usage**
AWS 明确提出工具调用需要进行授权、参数与 schema 检查，高风险 mutation 应使用 human-in-the-loop，并进行端到端可观测和审计。
[AWS — Secure agent tool usage](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentsec02.html?utm_source=chatgpt.com)

AWS, **Implement tool authorization**
强调工具执行前的外部授权、身份传播和高风险操作人工审查。
[AWS — Implement tool authorization](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentsec02-bp01.html?utm_source=chatgpt.com)

AWS, **Agent identity and permission management**
讨论显式代表用户执行与自主执行两种模式，以及 Agent 与 Human identity 的权限边界。
[AWS — Agent identity and permission management](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentsec03.html?utm_source=chatgpt.com)

OWASP GenAI Security Project, **LLM06:2025 Excessive Agency**
系统讨论 excessive functionality、excessive permissions、excessive autonomy 及其缓解措施，包括最小化 tool scope、complete mediation、限制权限和人工审批。
[OWASP — Excessive Agency](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/?utm_source=chatgpt.com)

---

### 3. Agent Human-in-the-Loop

OpenAI Agents SDK, **Human-in-the-loop**
提供工具审批、中断、持久化 RunState 和审批后恢复执行的实现方式。
[OpenAI Agents SDK — Human-in-the-loop](https://openai.github.io/openai-agents-python/human_in_the_loop/?utm_source=chatgpt.com)

OpenAI Agents SDK, **Guardrails**
提供 tool-level input/output guardrails，以及在执行前阻断 Tool Call 的机制。
[OpenAI Agents SDK — Guardrails](https://openai.github.io/openai-agents-python/guardrails/?utm_source=chatgpt.com)

---

### 4. 分布式可靠性：Idempotency / Outbox / Saga

AWS Prescriptive Guidance, **Transactional Outbox Pattern**
用于解决业务数据与消息发送之间的 dual-write 问题，并明确指出消息消费者仍然需要幂等。
[AWS — Transactional Outbox Pattern](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html?utm_source=chatgpt.com)

AWS Prescriptive Guidance, **Saga Pattern**
讨论跨多个 microservices 的事务一致性、补偿操作以及 Saga 的复杂度。
[AWS — Saga Pattern](https://docs.aws.amazon.com/prescriptive-guidance/latest/modernization-data-persistence/saga-pattern.html?utm_source=chatgpt.com)

Stripe, **Idempotent Requests**
说明如何利用 idempotency key 进行安全重试，防止网络失败导致重复创建或修改。
[Stripe — Idempotent requests](https://docs.stripe.com/api/idempotent_requests?utm_source=chatgpt.com)

Adyen, **API Idempotency**
说明支付操作中的 idempotency、重复请求检测、webhook 与 retry 行为。
[Adyen — API idempotency](https://docs.adyen.com/development-resources/api-idempotency?utm_source=chatgpt.com)

PayPal, **Making API Requests / PayPal-Request-Id**
说明 API request id 如何防止重复支付以及网络超时情况下的安全重试。
[PayPal — Making API Requests](https://developer.paypal.com/api/make-api-requests?utm_source=chatgpt.com)

---

### 5. AI Risk Management 与金融服务

NIST, **AI Risk Management Framework 1.0**
提出 Govern、Map、Measure、Manage 四类 AI 风险管理活动，并强调职责、文档化、人类监督和持续风险管理。
[NIST — AI RMF Core](https://airc.nist.gov/airmf-resources/airmf/5-sec-core/?utm_source=chatgpt.com)

NIST, **AI RMF Playbook — Map / Human Oversight**
强调在高风险、关键系统中，需要事先定义并评估 human oversight，并明确人与 AI 系统之间的职责。
[NIST — AI RMF Playbook](https://airc.nist.gov/airmf-resources/playbook/?utm_source=chatgpt.com)

BIS, **Opportunities and challenges of AI in the economy, finance and supervision**
讨论金融领域 AI 的透明度、可解释性、网络风险和 human oversight。
[BIS — AI in finance and supervision](https://www.bis.org/speeches/20241120-opportunities-and-challenges-ai-economy-finance-and-supervision.htm?utm_source=chatgpt.com)

BIS, **Central banks — opportunities and implications posed by artificial intelligence**
讨论金融系统中 AI 错误、依赖、集中化和缺乏人工验证可能带来的风险，以及治理和监督的重要性。
[BIS — AI and financial stability](https://www.bis.org/speeches/20250613-central-banks-opportunities-and-implications-posed-artificial-intelligence.htm?utm_source=chatgpt.com)

---

### 6. Agentic Commerce / 金融业真实实践

Visa, **What is Agentic Commerce?**
介绍 AI Agent 代表消费者进行搜索、选择和支付，以及 tokenization、authentication、consumer control 等机制。
[Visa — What is Agentic Commerce?](https://corporate.visa.com/en/sites/visa-perspectives/innovation/what-is-agentic-commerce.html?utm_source=chatgpt.com)

Visa, **Trusted Agent Protocol**
介绍 Visa 与 Cloudflare 合作推出的 Agent 信任与交易协议。
[Visa — Trusted Agent Protocol](https://corporate.visa.com/en/sites/visa-perspectives/newsroom/visa-unveils-trusted-agent-protocol-for-ai-commerce.html?utm_source=chatgpt.com)

Visa, **Visa and Partners Complete Secure AI Transactions**
Visa 于 2025 年 12 月宣布已经完成数百笔 secure agent-initiated transactions；该数字属于 Visa 官方披露。
[Visa — Secure AI Transactions](https://corporate.visa.com/en/sites/visa-perspectives/newsroom/visa-partners-complete-secure-agentic-transactions.html?utm_source=chatgpt.com)

Visa, **Agentic Commerce: Designing for autonomous payments**
讨论 structured payment instructions、agent identity、delegated credentials、authentication、risk modelling 等 agentic payment 基础设施。
[Visa — Designing for autonomous payments](https://corporate.visa.com/content/VISA/visacorporate/global/en/home/services/visa-consulting-analytics/insights/vca-agentic-commerce-autonomous-payments.html?utm_source=chatgpt.com)

Mastercard, **Agent Pay**
介绍 Mastercard Agent Pay 与 Agentic Tokens，以及围绕 Agent 交易建立 trust、security 和 control 的方案。
[Mastercard — Agent Pay](https://www.mastercard.com/news/press/2025/april/mastercard-unveils-agent-pay-pioneering-agentic-payments-technology-to-power-commerce-in-the-age-of-ai?utm_source=chatgpt.com)

---

### 7. Agent 执行与现实工程实践

GitHub, **About third-party coding agents**
展示当前 coding agent 可以异步执行任务、创建 Pull Request 并请求人工 review，同时结合代码安全扫描。
[GitHub — Third-party coding agents](https://docs.github.com/en/copilot/concepts/agents/about-third-party-coding-agents?utm_source=chatgpt.com)

GitHub, **Concepts for GitHub Copilot agents**
介绍 GitHub 当前 Agent 在研究、规划、编码和 PR 生命周期中的自治执行能力。
[GitHub — Concepts for Copilot agents](https://docs.github.com/en/copilot/concepts/agents?utm_source=chatgpt.com)

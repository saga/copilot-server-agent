# Capability-based Tool Access：Agent Tool 权限的最小化设计

AI Agent 真正进入企业生产环境以后，一个非常现实的问题会迅速出现：

> Agent 到底应该被允许调用哪些 Tool？

表面看，这是一个普通的权限问题：

```text
Agent A → Tool 1
Agent A → Tool 2
Agent A → Tool 3
```

但对于 Agent，这种传统的“给角色分配一组 API 权限”的方式很容易变得过于粗糙。

因为 Agent 与普通服务不同：

```text
传统服务：

Code
  ↓
明确调用 API
  ↓
固定业务路径

Agent：

User Request
  ↓
LLM Reasoning
  ↓
选择 Tool
  ↓
决定参数
  ↓
决定下一步 Tool
  ↓
继续推理
  ↓
最终产生副作用
```

开发者并没有完全写死“什么时候调用哪个 Tool”。

于是，一个原本看似正常的权限：

```text
Agent → customer.update
```

实际上意味着：

```text
Agent 可以修改哪个客户？
修改什么字段？
在什么时间修改？
由谁发起？
修改多少次？
是否可以批量修改？
是否可以把结果发到外部系统？
```

如果这些问题最终都由一个宽泛的 API Permission 解决，那么所谓的 Least Privilege 实际上很可能只是：

> **Least Privilege 的名义，Broad Privilege 的实际效果。**

这正是 Agent Tool Access 需要重新设计的原因。

AWS 当前 Agentic AI Lens 已经把这一问题明确提升为独立的 Agent Security 问题：每次 Tool Invocation 都应在执行前通过外部、声明式的授权策略检查；Agent 只能调用批准范围内的 Tool；Tool 参数和结果需要独立验证；高风险变更需要进一步控制；Tool 和 MCP Server 应进入经过安全审查的注册表。

这篇文章讨论的核心思想是：

> **不要把 Tool Access 理解成“Agent 有哪些 API 权限”，而应该把它设计成 Agent 在当前任务中被授予了哪些最小 Capability。**

---

# 一、先定义：什么是 Capability-based Tool Access？

这里首先需要澄清一个容易产生误解的地方。

传统计算机安全里的 Capability，是一个具有授权意义的、不可伪造或受保护的权能引用。经典 capability-security 研究强调：权限应该尽可能接近“具体资源 + 具体操作”，而不是让程序先拿到过大的 ambient authority，再在程序内部自行决定如何使用。Capability model 与 Principle of Least Authority（POLA）密切相关。

MCP 中的“capability negotiation”则是另一个概念，它描述客户端和服务器在协议层声明支持哪些协议特性，并不等同于业务授权。

因此本文所说的 **Capability-based Tool Access**，不是声称 Agent Framework 已经形成了某种统一的“Capability Token 标准”。

更准确地说，它是一个适合企业 Agent 的架构模式：

> **把 Agent 可以使用的工具能力收敛成一个明确、可枚举、可限制、可审计、可撤销的最小授权集合，并在 Tool Discovery 和 Tool Execution 两个阶段都执行边界控制。**

可以表示为：

```text
Agent Capability
=
Who
+ What Tool
+ Which Operation
+ Which Resource
+ Which Constraints
+ Which Context
+ Which Time
```

例如：

```text
Agent A
  ↓
Capability:
  tool        = portfolio.readPositions
  operation   = read
  resource    = portfolio:12345
  user        = user:alice
  maxScope    = current-tenant
  expiresAt   = 2026-09-20T12:00:00Z
```

这和：

```text
Agent A
  ↓
Role = PortfolioManager
  ↓
Can use portfolio.*
```

是完全不同的粒度。

---

# 二、为什么 Agent 特别需要 Capability，而传统 RBAC 很容易不够

传统 RBAC 非常适合表达：

```text
Trader
  → trade.read
  → trade.prepare
  → trade.submit
```

因为传统应用的执行路径通常相对确定。

但 Agent 的问题是：

```text
一个 Session
   ↓
当前用户
   ↓
当前 Task
   ↓
当前业务对象
   ↓
当前风险状态
   ↓
Agent 动态选择 Tool
```

Agent 能否调用某个 Tool，不应该只取决于：

```text
Role = Analyst
```

还可能取决于：

```text
User = Alice
Task = research
Portfolio = Fund-A
DataClassification = Internal
Time = current
RiskLevel = low
Approval = not required
```

因此实际判断更接近：

```text
Can(
    Principal,
    Action,
    Resource,
    Context
)
```

这正是现代 Policy Engine，例如 Cedar 所表达的基本模型：授权请求由 Principal、Action、Resource 和 Context 构成，然后由独立的 Policy Engine 决定 Allow/Deny。

AWS 当前 AgentCore Gateway 的细粒度访问控制也已经把控制粒度进一步拆成：

```text
Gateway
Tool
Operation
Parameter
```

并支持基于 JWT claims、IAM principal、外部授权服务等上下文做决策。

所以，对于 Agent，更合理的权限模型不是：

```text
Role → Tool
```

而是：

```text
Identity
   +
Task Context
   +
Tool Capability
   +
Resource Scope
   +
Policy
```

---

# 三、最重要的原则：Tool Availability ≠ Tool Authorization

这是 Capability-based Tool Access 最容易被误解，也最重要的一点。

很多 Agent Framework 做的是：

```text
tools = [
  searchCustomer,
  updateCustomer,
  submitOrder,
  sendEmail
]
```

然后把全部 Tool schema 发送给模型。

模型自己决定：

```text
我要调用 updateCustomer
```

这种情况下，即使后面加一个授权层：

```text
LLM
 ↓
Tool Call
 ↓
Authorization
 ↓
DENY
```

安全性确实比没有 Authorization 好。

但它仍然不是理想状态。

因为 Agent 在 Planning 阶段已经知道了：

```text
updateCustomer
submitOrder
sendEmail
```

这些能力存在。

于是它可能：

* 尝试调用本不属于当前任务的工具；
* 因为看到更多工具而产生错误计划；
* 被 prompt injection 引导去尝试高风险能力；
* 增大 Tool Selection 和攻击面；
* 产生大量无意义的 denied calls。

所以应该做两层控制：

```text
             Capability Control
                    │
        ┌───────────┴───────────┐
        ▼                       ▼
 Tool Discovery             Tool Execution
 “你可以看到什么”             “你最终可以做什么”
```

### Discovery-time control

只把 Agent 当前真正可能使用的 Tool 暴露给模型：

```text
Research Agent
   ↓
search_market
read_portfolio
read_research
```

而不是：

```text
search_market
read_portfolio
read_research
submit_order
approve_trade
send_external_email
delete_customer
```

### Runtime enforcement

即使模型通过异常路径产生了未授权 Tool Call，仍然由外部 Policy 强制：

```text
Tool Call
   ↓
Capability Check
   ↓
ALLOW / DENY
```

AWS AgentCore 当前已经提供了类似的机制：`PartiallyAuthorizeActions` 可用于根据 Policy 判断调用者允许使用哪些 Tool，而 `AuthorizeAction` 用于具体调用的授权判断。

这说明：

> **“只给 Agent 看得到它应该用的 Tool”与“运行时再强制检查”应该同时存在。**

---

# 四、一个真正有用的 Capability 应该包含什么？

不要把 Capability 设计成：

```json
{
  "tool": "portfolio.read"
}
```

这还是太粗。

一个更实际的 Capability 可以包含：

```json
{
  "capabilityId": "cap_8f2a",
  "principal": {
    "agentId": "investment-research-agent",
    "userId": "alice"
  },
  "tool": "portfolio.readPositions",
  "operation": "read",
  "resource": {
    "type": "portfolio",
    "ids": ["fund-a", "fund-b"]
  },
  "constraints": {
    "dataClassification": ["internal"],
    "purpose": "research",
    "maxResults": 500
  },
  "validity": {
    "notBefore": "2026-09-20T10:00:00Z",
    "expiresAt": "2026-09-20T12:00:00Z"
  },
  "policyVersion": "policy-v17"
}
```

不一定真的需要把整个 JSON 作为 token 传输。

重要的是这些**授权语义必须存在**。

---

# 五、Capability 最核心的六个维度

## 1. Principal

谁拥有这个能力？

可能是：

```text
Human
Agent
Agent Session
Workflow
Service
Task
```

尤其要明确：

```text
Agent Identity
≠
Human Identity
```

AWS 当前明确建议区分 Agent 与 Human Identity；当 Agent 代表用户执行时，应传播用户上下文，而不是直接让 Agent 假设用户凭证。

---

## 2. Action

到底允许什么操作？

不要：

```text
customer.*
```

而应该尽可能表达：

```text
customer.readProfile
customer.readContact
customer.prepareAddressChange
customer.submitAddressChange
```

Capability 最重要的价值之一，就是把：

> “这个 Agent 可以访问 Customer API”

缩小成：

> “这个 Agent 可以执行这个具体业务动作。”

---

## 3. Resource

可以操作哪个资源？

例如：

```text
portfolio.read
```

仍然太大。

更合理：

```text
portfolio = Fund-A
```

甚至：

```text
portfolio = Fund-A
fields = [
  position,
  quantity,
  market_value
]
```

AWS 当前 Gateway 的 fine-grained access control 已经支持从 Tool 到 Operation 再到 Parameter 层面的控制，这正体现了权限需要随着访问对象和输入范围进一步收敛。

---

## 4. Context

权限是否取决于当前上下文？

例如：

```text
purpose = research
```

可以读。

但：

```text
purpose = order-execution
```

才允许执行。

或者：

```text
riskLevel = high
```

则：

```text
submitOrder = DENY
```

直到：

```text
approval = approved
```

这其实就是 ABAC / policy evaluation 与 capability-oriented access 的结合。

---

## 5. Time

Capability 不一定永久存在。

可以：

```text
Start
End
TTL
Session lifetime
Workflow lifetime
Approval lifetime
```

经典 capability security 中，“只在完成当前任务需要的时间获得 authority”是实现 Least Authority 的重要思想。Miller 等人特别强调应尽量动态地分配“恰好需要的 authority”，而不是长期授予可能用到的所有权限。

AWS 当前 Agentic AI Lens 也明确建议临时凭证、动态 permission boundaries 和 Just-in-Time access。

---

## 6. Constraints

这是 Capability 真正比粗粒度 RBAC 有价值的地方。

例如：

```text
approveRefund
```

可以限制：

```text
amount < 1000
```

或者：

```text
sendEmail
```

限制：

```text
recipientDomain = internal.company.com
```

或者：

```text
trade.submit
```

限制：

```text
instrument ∈ approvedUniverse
quantity <= currentLimit
client ∈ entitledClients
market = approvedMarket
```

这时候 Capability 已经不是：

> “你可以调用这个 API。”

而是：

> **“你只能在这个非常具体的安全空间内调用这个 API。”**

---

# 六、不要把 Capability 做成“大 Tool + 大 Permission”

这是实践中最容易失败的地方。

例如：

```text
Tool:
customer.manage
```

参数：

```json
{
  "operation": "read|update|delete",
  "customerId": "...",
  "field": "...",
  "value": "..."
}
```

这个 Tool 看似灵活，实际上极难做最小权限。

因为 Capability 最后只能表达：

```text
customer.manage = ALLOW
```

于是：

```text
read
update
delete
```

全部成为同一个授权面。

更好的设计：

```text
customer.readProfile
customer.readContact
customer.prepareAddressChange
customer.submitAddressChange
customer.closeAccount
```

然后：

```text
Agent capability
    ↓
customer.readProfile
```

而不是：

```text
Agent capability
    ↓
customer.manage
```

---

# 七、Tool 应该按照“业务能力”拆，而不是按照“数据库 CRUD”拆

但这里也不能走向另一个极端。

错误做法：

```text
getPortfolioPositionRow
getPortfolioPositionField
getPortfolioPositionCurrency
getPortfolioPositionMarketValue
```

这会让 Tool 数量爆炸。

更合理的原则：

> **Tool 的边界应该对应一个可理解、可验证的业务能力，而不是一个数据库表字段。**

例如：

```text
portfolio.readPositions
```

是一个合理 capability。

而：

```text
portfolio.executeSQL
```

通常不是。

因为后者实际上代表：

```text
读取数据库
+
任意 SQL
+
任意表
+
任意条件
```

已经完全破坏了最小能力边界。

同理：

```text
customer.httpRequest
```

也通常是极其危险的 Tool。

---

# 八、Capability 的最小化，其实是“收窄 Blast Radius”

这是理解整个设计最简单的方式。

假设 Agent 被 Prompt Injection 影响。

### Broad Tool

```text
Agent
  ↓
httpRequest
  ↓
internal.company.com/*
```

那么攻击结果可能是：

```text
CRM
Portfolio
Order
Email
Admin API
```

全部暴露。

### Narrow Capability

```text
Agent
  ↓
portfolio.readPositions
  ↓
Fund-A
  ↓
read-only
```

即使 Agent 做出错误决定：

```text
最多影响 Fund-A 的读取
```

而不是：

```text
整个企业 API surface
```

AWS 当前对 Agent Least Privilege 的表述本质上也是如此：权限越宽，错误推理或恶意 Prompt 越容易造成级联影响；权限边界越窄，blast radius 越小，也越容易从 baseline 中识别异常。

所以：

> **Capability-based access 的第一价值不是“防止 Agent 犯错”，而是“让 Agent 犯错时影响尽可能小”。**

---

# 九、Capability 与 RBAC、ABAC 到底是什么关系？

不是三选一。

可以这样理解。

## RBAC

回答：

> 这个角色通常可以做什么？

例如：

```text
InvestmentAnalyst
→ read portfolio
→ read research
```

优点是简单。

缺点是通常较粗。

---

## ABAC

回答：

> 在当前属性和上下文下，这个主体是否可以执行这个动作？

例如：

```text
user.department = research
AND
portfolio.region = APAC
AND
classification <= Internal
```

粒度更高。

---

## Capability

回答：

> 这个 Agent 当前被明确授予了哪些具体权能？

例如：

```text
capability:
  read portfolio Fund-A
  read research APAC
  expires in 30 minutes
```

更偏向**authority delegation**。

---

## 实际企业 Agent 最合理的组合

通常不是：

```text
Capability OR RBAC OR ABAC
```

而是：

```text
Identity
   ↓
RBAC / Group
   ↓
ABAC / Entitlement
   ↓
Task-specific Capability
   ↓
Tool Authorization
   ↓
Business Authorization
```

即：

> **RBAC 是基础身份模型，ABAC/Entitlement 是条件判断，Capability 是当前任务可用的最小 authority envelope。**

这比纯粹追求“全部 capability-based”更加现实。

---

# 十、Capability 不应该直接交给 LLM

这是实现时一个非常重要的安全点。

假设系统生成：

```text
capabilityToken = eyJ...
```

然后把：

```text
You may call:
portfolio.read
CapabilityToken: eyJ...
```

发送给模型。

这是很差的设计。

因为模型本身是一个不可信的推理组件。

Capability 应该存在于：

```text
Agent Runtime
Tool Gateway
Policy Engine
Credential Broker
```

而不是：

```text
LLM Context
```

更合理：

```text
LLM
  ↓
Tool Call
  ↓
Runtime
  ↓
Capability Check
  ↓
Capability / Credential injected internally
  ↓
Tool
```

也就是说：

> **LLM 可以请求使用某个 capability，但不应该直接持有企业访问凭证本身。**

MCP 当前的架构也强调 Host 负责连接权限、用户授权和安全边界；Server 提供聚焦的能力，而不应获得整个会话上下文。

---

# 十一、Tool Discovery 也应该 Capability-aware

传统 MCP：

```text
tools/list
    ↓
返回所有 Tool
```

企业 Agent 更理想的是：

```text
tools/list
    ↓
Policy Evaluation
    ↓
Only permitted tools
```

例如：

```text
User = Alice
Agent = ResearchAgent
Task = portfolio research
```

最终 Tool Catalog：

```text
portfolio.read
research.search
market.read
```

而：

```text
portfolio.trade
proxy_vote.submit
payment.execute
```

根本不会出现在模型看到的 Tool Schema 中。

AWS AgentCore 当前对 `PartiallyAuthorizeActions` 的设计正是一个很有参考价值的例子：Policy 可以先决定调用者允许使用哪些工具，再针对具体调用执行完整授权。

---

# 十二、但“Tool 不显示”绝对不能代替 Runtime Authorization

这是另一个极其重要的原则。

不能因为：

```text
Tool 不在 Prompt
```

就认为：

```text
Tool 不可访问
```

因为攻击者可能通过：

* Prompt injection；
* Tool name manipulation；
* MCP protocol manipulation；
* runtime bug；
* direct API access；

绕过 Tool Discovery。

因此：

```text
Discovery filtering
         +
Runtime authorization
```

必须同时存在。

AWS 的官方建议同样不是“只把 Tool 隐藏起来”，而是要求**每次 Tool Invocation 都进行外部 Authorization**。

---

# 十三、一个实际的 Capability Gateway

一个典型实现可以是：

```text
                  ┌──────────────────┐
                  │       User       │
                  └────────┬─────────┘
                           │
                           ▼
                  ┌──────────────────┐
                  │   Agent Runtime  │
                  │                  │
                  │ LLM / DeepAgents │
                  └────────┬─────────┘
                           │
                       Tool Call
                           │
                           ▼
                ┌──────────────────────┐
                │ Capability Gateway   │
                │                      │
                │ 1. identity          │
                │ 2. task context      │
                │ 3. capability        │
                │ 4. policy            │
                │ 5. parameter check   │
                └──────────┬───────────┘
                           │
                   ALLOW / DENY
                           │
                           ▼
                ┌──────────────────────┐
                │ Business Tool / MCP  │
                └──────────┬───────────┘
                           │
                           ▼
                     Business API
```

这个 Gateway 不应该只是：

```text
HTTP Proxy
```

真正需要的是：

```text
Authentication
Authorization
Capability
Policy
Rate Limit
Parameter Validation
Audit
```

---

# 十四、Capability Gateway 应该检查什么？

建议至少检查：

```text
1. Who?
2. Which Agent?
3. Which Session?
4. Which Task?
5. Which Tool?
6. Which Operation?
7. Which Resource?
8. Which Parameters?
9. Which Data Classification?
10. Which Purpose?
11. Which Risk Level?
12. Which Approval?
13. Which Expiration?
```

最终：

```text
ALLOW
```

或者：

```text
DENY
```

而不是：

```text
LLM said it was okay.
```

---

# 十五、参数级 Capability 是真正重要的地方

例如：

```text
submitOrder
```

仅做 Tool-level ACL：

```text
Agent X → submitOrder = ALLOW
```

仍然很危险。

因为：

```json
{
  "client": "Client-A",
  "instrument": "XYZ",
  "quantity": 1000000
}
```

可能完全超出权限。

Capability 应进一步表达：

```text
Tool:
submitOrder

Allowed resource:
Client-A

Allowed instrument:
XYZ

Allowed quantity:
<= 10000

Allowed market:
NYSE

Allowed action:
submit only after approval
```

AWS AgentCore Gateway 当前已经把 Parameter-level access 作为细粒度授权层级之一，并支持根据 JWT claims、IAM principal、外部授权服务等上下文决定是否允许具体请求。

---

# 十六、Capability 的一个关键设计：Attenuation

Capability Security 有一个非常值得 Agent 架构借鉴的概念：

> **Authority 应该可以被进一步收窄，而不是只能继承完整权限。**

例如：

```text
Base Capability

portfolio.read
```

一个具体 Task 得到：

```text
portfolio.read
scope = Fund-A
```

更进一步：

```text
portfolio.read
scope = Fund-A
fields = positions
```

再进一步：

```text
portfolio.read
scope = Fund-A
fields = positions
maxRows = 100
expires = 30m
```

这就是一种：

> **Capability attenuation**

即：

```text
Broad capability
      ↓
Narrower capability
      ↓
Task-specific capability
```

这与经典 capability security 强调的 Least Authority 思路高度一致。

对于 Agent，这是一个非常实用的模式。

---

# 十七、因此，不要一开始就把 Agent 绑定到“完整 Role”

一个常见企业设计：

```text
Agent → InvestmentAnalyst Role
```

然后：

```text
InvestmentAnalyst
→ 30 个 Tool
→ 10 个 API
→ 20 个 Data Source
```

这是典型的“先给大权限，再希望 Agent 自律”。

更好的方式：

```text
User Role
    ↓
Agent Identity
    ↓
Task
    ↓
Capability Broker
    ↓
Narrow Capability Set
```

例如：

```text
Task:
Prepare Fund-A daily research

Capability:
  market.read
    scope = Fund-A universe

  portfolio.read
    scope = Fund-A

  research.search
    scope = Internal Research

  risk.read
    scope = Fund-A
```

而不是：

```text
InvestmentAnalyst
→ *
```

---

# 十八、Capability 应该是“任务作用域”的，而不是“Agent 永久属性”

这是最值得强调的设计变化。

传统权限：

```text
User
  ↓
Role
  ↓
长期权限
```

Agent 权限更合理的是：

```text
User
  ↓
Agent
  ↓
Task
  ↓
Capability
  ↓
Execution
```

所以：

```text
Same Agent
+
Different Task
=
Different Capability Set
```

例如：

```text
Research Task
→ read only

Portfolio Review
→ read + calculate

Trade Preparation
→ read + prepare

Trade Submission
→ command + approval
```

这比：

```text
InvestmentAgent
→ permanent trade.submit permission
```

安全得多。

---

# 十九、High-risk Tool 不一定应该被 Capability 直接授予

对于高风险操作，我建议再分一层：

```text
Capability
```

与：

```text
Command Authorization
```

不要完全等同。

例如：

```text
Capability:
trade.prepare
```

可以授予 Agent。

但：

```text
trade.submit
```

即使 Agent technically “有能力”：

```text
Capability = submitOrder
```

仍然必须：

```text
Policy
+
Approval
+
Resource validation
+
Risk limit
```

因此：

```text
Capability
    ↓
is this action even possible?

Policy
    ↓
is this action allowed now?

Approval
    ↓
does a human/business authority approve it?

Command
    ↓
what exact business action is being executed?
```

这也是为什么不能把 Capability Model 当成整个 Authorization Architecture。

---

# 二十、Capability-based Access 与 Command Architecture 是互补关系

两者分别解决不同问题。

### Capability

回答：

> Agent 有没有能力做这件事？

```text
Can Agent invoke submitOrder?
```

### Policy

回答：

> 当前条件下允许吗？

```text
Is Agent allowed to submit this order?
```

### Command

回答：

> 具体要执行什么业务动作？

```text
Submit Order:
Client=A
Instrument=XYZ
Quantity=1000
Price=...
```

### Approval

回答：

> 这个具体业务动作是否经过所需审批？

### Executor

回答：

> 由谁真正改变业务状态？

所以：

```text
Capability
    ↓
Policy
    ↓
Command
    ↓
Approval
    ↓
Execution
```

是一个很干净的链路。

---

# 二十一、MCP 不应该被误解为 Capability Boundary

这是当前 Agent 架构里一个非常常见的误区。

有人看到：

```text
MCP Server
  ↓
Tools
```

就认为：

> “这个 MCP Server 就是权限边界。”

不是。

MCP 本身解决的是：

```text
Protocol
Discovery
Tool / Resource / Prompt exchange
```

它不是你的完整企业 Authorization Architecture。

MCP 官方架构中，Host 负责连接权限、用户授权和安全边界；Server 提供聚焦的 capabilities，并且 Server 之间保持隔离。

更重要的是，MCP 自己目前的 Tool Annotations 也明确只是 **hints**，例如：

```text
readOnlyHint
destructiveHint
idempotentHint
openWorldHint
```

它们不是 enforcement。MCP 官方 2026 年的说明明确指出，不受信任的 Server 可以错误甚至恶意地声明这些 hint，因此真正的安全保证必须放在 authorization layer、runtime、network controls 或 sandbox 中。

因此：

```text
MCP Tool Annotation
       ≠
Authorization
```

最多：

```text
Tool Metadata
       ↓
Policy Input
```

---

# 二十二、Capability Metadata 可以成为 Policy Engine 的输入

一个很有价值的方向是，把 Tool 描述成：

```json
{
  "name": "submit_order",
  "capability": {
    "readOnly": false,
    "destructive": true,
    "idempotent": false,
    "openWorld": true
  }
}
```

但是不要直接信这些字段。

应该：

```text
Tool Registry
   ↓
Trusted Metadata
   ↓
Policy Engine
```

例如：

```text
IF
tool.destructive = true
AND
tool.openWorld = true
AND
session.hasPrivateData = true

THEN
DENY
```

这里有一个非常重要的安全思想：

> **权限风险不是单个 Tool 的属性，而是 Tool 组合后的属性。**

MCP 2026 年官方讨论 Tool Annotations 时也特别指出，真正危险的行为往往来自 capability combination，而不是单个工具本身。例如同时拥有私密数据访问、不受信内容输入和外部通信能力，可能构成严重的数据外泄路径。

这对于 Agent Capability Design 非常重要。

---

# 二十三、因此需要从“Tool Permission”进一步升级到“Capability Composition”

例如：

```text
Capability A
= read private customer data

Capability B
= access arbitrary web content

Capability C
= send external email
```

单独看：

```text
A = allowed
B = allowed
C = allowed
```

可能全部合理。

但：

```text
A + B + C
```

可能意味着：

```text
Read Private Data
     ↓
Injected Instruction
     ↓
Send to external recipient
```

因此 Capability Review 不能只有：

```text
Tool A allowed?
Tool B allowed?
Tool C allowed?
```

还应该问：

> **这个 Session 拥有哪些 Capability，它们组合起来形成了什么新的攻击能力？**

---

# 二十四、Capability Set 应该有“组合风险”

建议在 Tool Registry 里增加：

```text
capabilityRisk
```

例如：

| Capability               | 风险       |
| ------------------------ | -------- |
| read_public_data         | Low      |
| read_internal_data       | Medium   |
| read_client_data         | High     |
| write_internal_state     | High     |
| send_external_message    | High     |
| execute_financial_action | Critical |

然后在 Session 层计算：

```text
Capability Set Risk
```

例如：

```text
PrivateData
+
UntrustedWeb
+
ExternalSend
=
Critical
```

这样：

```text
单 Tool Policy
```

升级成：

```text
Session Capability Policy
```

这比传统 RBAC 更适合 Agent。

---

# 二十五、Capability Registry 应该是什么样？

企业平台建议维护一个 Tool/Capability Registry。

例如：

```yaml
capability:
  id: portfolio.readPositions
  version: v3

owner:
  team: Portfolio Platform

purpose:
  "Read authorized portfolio positions"

risk:
  tier: medium

authorization:
  action: read
  resourceType: portfolio

scope:
  tenantRequired: true
  userEntitlementRequired: true

constraints:
  maxRows: 500

data:
  classification: confidential

sideEffects:
  mutatesState: false
  externalCommunication: false

reliability:
  idempotent: true

review:
  securityReviewedAt: 2026-08-20
  expiresAt: 2027-02-20
```

这样 Agent 不再直接“发现一个 Python function”。

而是：

```text
Agent
 ↓
Capability Registry
 ↓
Approved capability
 ↓
Policy
 ↓
Tool
```

AWS 当前 Agentic AI Lens 建议 Tool/MCP Server 进入经过安全审查的 registry，并记录权限、数据分类、版本和 review expiry；AWS 的 Tool Integration guidance 也将共享 registry 作为工具治理的重要组成部分。

---

# 二十六、Capability Registry 不是 API Catalog

两者看起来很像，但关注点不同。

传统 API Catalog：

```text
GET /customers
POST /orders
```

主要描述：

```text
Endpoint
Schema
Owner
SLA
```

Capability Registry 还应该描述：

```text
Who can use it?
For what purpose?
On which resource?
With what constraints?
What side effects?
What data?
What risk?
What approval?
What combinations are forbidden?
```

所以：

> **API Catalog 描述“系统有什么 API”；Capability Registry 描述“Agent 在什么条件下获得什么 authority”。**

---

# 二十七、Capability 的“默认状态”应该是没有，而不是有

这是一个非常关键的设计原则。

错误：

```text
New Agent
  ↓
All tools available
  ↓
Later remove dangerous tools
```

正确：

```text
New Agent
  ↓
No capability
  ↓
Explicitly grant
  ↓
Narrow scope
```

也就是：

```text
Default Deny
```

AWS AgentCore Policy 当前就是这种语义：没有匹配的 permit 时默认 DENY；如果存在 forbid，则 forbid 优先。

AWS 的 Tool Authorization guidance 也明确把 blanket tool access 列为 anti-pattern，并要求未授权 Tool Invocation 被阻止和记录。

---

# 二十八、Capability 的生命周期

一个成熟的 Capability 应该经历完整生命周期：

```text
Define
  ↓
Review
  ↓
Register
  ↓
Grant
  ↓
Discover
  ↓
Invoke
  ↓
Audit
  ↓
Review Usage
  ↓
Attenuate / Revoke
```

而不是：

```text
create role
↓
never touch again
```

AWS 当前 Agent identity guidance 明确提出持续 permission posture validation、unused-access findings 和 periodic access review；Tool Authorization guidance 也建议定期删除未使用权限和收紧边界。

---

# 二十九、最实用的权限管理方法：从 Usage 反推 Least Privilege

不要完全依赖设计人员“猜 Agent 会需要什么权限”。

可以：

```text
初始：
small safe allowlist

      ↓

Production Usage

      ↓

观察实际 Tool Calls

      ↓

Unused Capability
→ Remove

Denied but legitimate calls
→ Review

Unexpected calls
→ Investigate

      ↓

New Least-Privilege Baseline
```

AWS IAM Access Analyzer 就提供了根据实际访问模式帮助生成 least-privilege policy 的能力；AWS 的 Agentic AI guidance 也建议利用实际 usage data 做权限收敛。

对 Agent 来说，这种方式尤其重要，因为：

> **Agent 的实际 Tool Usage 往往会随着 Prompt、Model、Task、用户行为变化。**

所以 Capability Set 也应该持续优化。

---

# 三十、Capability Review 应该问什么？

对于每一个 Agent，至少问：

### Capability Scope

```text
这个 Agent 最多需要哪些 Tool？
```

### Necessity

```text
为什么每一个 Tool 都需要？
```

### Resource Scope

```text
它可以访问整个系统，还是部分资源？
```

### Operation Scope

```text
read / prepare / approve / execute 是否分开？
```

### Parameter Scope

```text
金额、客户、数量、地区、字段有没有限制？
```

### Context Scope

```text
什么 Task 下才允许？
```

### Time Scope

```text
权限可以持续多久？
```

### Combination Risk

```text
哪些 Capability 组合不能同时存在？
```

### Runtime Enforcement

```text
真正执行时谁强制检查？
```

### Revocation

```text
如何立即撤销？
```

---

# 三十一、金融场景下应该怎么拆 Capability？

这是最值得实际落地的地方。

## 投资研究 Agent

可以：

```text
market.read
research.search
portfolio.readPositions
risk.readSummary
```

不应该：

```text
order.submit
cash.transfer
proxyVote.submit
client.email.external
```

---

## Portfolio Review Agent

可以：

```text
portfolio.read
risk.calculate
performance.calculate
research.search
```

但：

```text
portfolio.rebalance
```

应该进入：

```text
Command + Policy + Approval
```

---

## Proxy Voting Agent

可以：

```text
vote.readMeeting
vote.readProposal
vote.readPolicy
vote.prepareRecommendation
```

但：

```text
vote.submit
```

应该是独立的高风险 Capability / Command。

---

## Trade Preparation Agent

可以：

```text
portfolio.read
market.read
order.prepare
risk.calculate
limit.check
```

但：

```text
order.submit
```

不能因为：

```text
Agent = TradingAgent
```

就自动获得。

---

# 三十二、一个非常重要的设计：把 Prepare 和 Execute 分开

这是金融 Agent 很值得标准化的模式。

不要：

```text
trade.execute
```

一个 Tool 完成全部事情。

拆成：

```text
trade.prepare
trade.validate
trade.review
trade.submit
```

于是：

```text
Agent
 ↓
trade.prepare
 ↓
risk/limit validation
 ↓
approval
 ↓
trade.submit
```

这样：

```text
Read
Prepare
Decide
Execute
```

就拥有不同权限。

这与金融系统长期使用的 pre-trade controls 思路一致。SEC Rule 15c3-5 对 broker-dealer market access 要求在订单进入市场前设置相应的风险控制，并明确要求限制超额、错误或受限制订单，以及将 market-access technology 限制给授权人员。

这里并不是说监管规则要求“Capability Object”。

真正可以借鉴的是：

> **高风险动作必须在真正产生业务副作用之前经过独立、确定性的控制。**

---

# 三十三、Capability 不应该取代 Domain Authorization

例如：

```text
Capability:
trade.submit
```

只能说明：

> Agent 被允许尝试提交订单。

它仍然不代表：

```text
Client entitled?
Trading window open?
Instrument allowed?
Position limit okay?
Credit limit okay?
Order size okay?
Approval valid?
Order version current?
```

这些应该仍由：

```text
Domain Policy
Risk Engine
Entitlement
Business Service
```

决定。

所以：

```text
Capability
=
Can attempt this class of action

Business Authorization
=
Can this exact business action happen now?
```

两者不能混为一谈。

---

# 三十四、Capability 最容易失败的四种方式

## 失败 1：Capability 太粗

```text
agent → customer.manage
```

结果：

```text
read
update
delete
```

全开放。

---

## 失败 2：Capability 只在 Prompt 中表达

```text
System:
Do not use submitOrder.
```

但：

```text
submitOrder
```

在 Tool list 里。

这是软控制，不是真正的 authorization。

AWS 明确把“依赖 Agent 自己决定是否应该调用 Tool”列为 anti-pattern。

---

## 失败 3：Capability 只在 Gateway 做一次粗粒度检查

例如：

```text
Agent X → order.submit = ALLOW
```

但没有：

```text
resource
parameter
risk
context
```

最终还是过宽。

---

## 失败 4：只控制单个 Tool，不控制 Capability 组合

例如：

```text
readPrivateData = ALLOW
webFetch = ALLOW
sendEmail = ALLOW
```

单项都合理。

组合起来却可能形成数据外泄链。

MCP 当前安全讨论已经明确指出，Agent 风险往往来自多个能力组合，而不是单个 Tool。

---

# 三十五、Capability-based Tool Access 的推荐最小架构

对于企业金融 Agent，我更推荐下面这个模式：

```text
                         User
                           │
                           ▼
                    Identity Provider
                           │
                           ▼
                  ┌─────────────────┐
                  │ Agent Runtime   │
                  │                 │
                  │ LLM / Skill     │
                  └────────┬────────┘
                           │
                     Task Context
                           │
                           ▼
                ┌──────────────────────┐
                │ Capability Broker    │
                │                      │
                │ Identity             │
                │ Entitlement          │
                │ Task                 │
                │ Capability Set       │
                │ Context              │
                └──────────┬───────────┘
                           │
                 permitted Tool Catalog
                           │
                           ▼
                        LLM
                           │
                      Tool Call
                           │
                           ▼
                ┌──────────────────────┐
                │ Tool Gateway         │
                │                      │
                │ Capability Check     │
                │ Policy Check         │
                │ Param Validation     │
                │ Rate Limit           │
                │ Audit                │
                └──────────┬───────────┘
                           │
                    High-risk?
                       /     \
                     No       Yes
                     │         │
                     │    Command / Approval
                     │         │
                     └────┬────┘
                          ▼
                    Business API
                          │
                          ▼
                    Business System
```

这里真正关键的是：

```text
Capability Broker
        +
Tool Gateway
```

而不是在 Agent Code 里面到处写：

```text
if user.role == ...
```

---

# 三十六、现有成熟产品能不能直接做？

可以，而且已经有比较成熟的组合。

## 方案一：AWS AgentCore Gateway + Policy

如果使用 AWS 体系，这是目前与本文模式最贴近的现成方案之一。

AgentCore Gateway 支持：

* Gateway-level control；
* Tool-level control；
* Operation-level control；
* Parameter-level control；
* JWT / IAM identity；
* interceptor；
* external authorization；
* Cedar Policy；
* `PartiallyAuthorizeActions`；
* `AuthorizeAction`。

AgentCore Policy 还支持：

```text
LOG_ONLY
```

用于先验证 Policy，再：

```text
ENFORCE
```

正式阻断，这对于企业逐步迁移尤其有用。

---

# 三十七、Cedar 很适合成为 Capability Policy Language

Cedar 的优势在于它直接表达：

```text
Principal
Action
Resource
Context
```

例如：

```cedar
permit (
    principal,
    action == Action::"portfolio.read",
    resource
)
when {
    context.userEntitled == true &&
    context.purpose == "research"
};
```

再加限制：

```cedar
forbid (
    principal,
    action == Action::"portfolio.read",
    resource
)
when {
    context.dataClassification == "restricted"
};
```

Cedar 当前采用 default-deny，并具有 forbid-overrides-permit 的授权语义。

对于 Agent：

```text
LLM
 ↓
Tool Request
 ↓
Cedar
 ↓
ALLOW / DENY
```

比：

```text
Prompt:
Please only use appropriate tools.
```

强得多。

---

# 三十八、Microsoft Agent Framework / OpenAI Agents SDK 更适合处理 Approval，而不是完整 Capability Plane

Microsoft Agent Framework 已经支持 per-tool approval，例如可以声明某个 Tool：

```text
approval_mode = always_require
```

执行前由 middleware 拦截，并等待 approval。

OpenAI Agents SDK 当前也支持：

```text
needs_approval
```

并提供 Tool Input / Output Guardrails，在 Tool 执行前后做检查。

这些能力很适合：

```text
High-risk Tool
      ↓
Approval
```

但不要因此认为：

```text
needs_approval
=
Capability Architecture
```

Approval 解决的是：

> **“这次是否允许执行？”**

Capability 解决的是：

> **“这个 Agent 在原则上拥有哪些能力？”**

二者应该组合。

---

# 三十九、对于已经使用 DeepAgents + AgentCore + LangSmith 的企业平台

如果现有平台已经是：

```text
LiteLLM
+
DeepAgents
+
AgentCore
+
LangSmith
```

我不会建议再引入一个大型 Agent Authorization Framework。

更合理的是：

```text
DeepAgents
    ↓
Agent reasoning / planning

AgentCore Gateway
    ↓
Tool Gateway / MCP Gateway

Cedar / Existing Policy
    ↓
Capability Authorization

Existing Data Entitlement
    ↓
Resource scope

Existing Command Service
    ↓
High-risk action

LangSmith
    ↓
Trace / Eval
```

也就是说，Capability Architecture 可以建立在已有组件上，而不需要再造一个新的 Runtime。

---

# 四十、Capability Registry 的最小实现甚至不需要一套新产品

最小版本只需要四张表/四类配置。

## 1. Tool Registry

```text
toolId
version
owner
risk
dataClass
sideEffect
schema
```

## 2. Capability Definition

```text
capabilityId
toolId
operation
resourceType
constraints
riskTier
```

## 3. Agent Grant

```text
agentId
capabilityId
scope
expiresAt
policyVersion
```

## 4. Authorization Event

```text
executionId
agentId
userId
capabilityId
resource
decision
reason
policyVersion
timestamp
```

已经足以形成：

```text
Define
→ Grant
→ Discover
→ Enforce
→ Audit
```

的完整闭环。

---

# 四十一、Capability Grant 最好是动态生成的

不要：

```text
Agent deployment
  ↓
Permanent capability set
```

更推荐：

```text
User Request
      ↓
Task Classification
      ↓
Entitlement
      ↓
Capability Resolution
      ↓
Task-scoped capability set
```

例如：

```text
User asks:

“分析 Fund A 今天的风险。”
```

系统得到：

```json
{
  "task": "portfolio-risk-analysis",
  "capabilities": [
    "portfolio.readPositions(Fund-A)",
    "market.read(Fund-A-universe)",
    "risk.calculate(Fund-A)"
  ]
}
```

而另一个请求：

```text
“准备 Fund A 的交易调整方案。”
```

得到：

```json
{
  "task": "trade-preparation",
  "capabilities": [
    "portfolio.readPositions(Fund-A)",
    "market.read(Fund-A-universe)",
    "risk.calculate(Fund-A)",
    "order.prepare(Fund-A)"
  ]
}
```

但：

```text
order.submit
```

仍然需要独立控制。

---

# 四十二、这实际上也是解决 Agent Behavior Drift 的一个重要手段

前面讨论过：

> Agent 的行为可能在没有代码变化时发生变化。

Capability Architecture 可以把问题进一步隔离。

假设：

```text
Model changed
```

导致：

```text
Agent suddenly tries:
submitOrder
```

如果没有 Capability Boundary：

```text
Model
 ↓
submitOrder
 ↓
Business State
```

模型行为变化直接造成业务变化。

而有 Capability Boundary：

```text
Model
 ↓
submitOrder
 ↓
Capability Check
 ↓
DENY
```

于是：

```text
Behavior Drift
```

不会自动变成：

```text
Business State Drift
```

这就是 Capability-based Tool Access 对 Agent Reliability 的一个重要价值：

> **它不保证模型行为正确，但可以把模型错误限制在一个可控的 authority envelope 内。**

---

# 四十三、Capability 不是“越细越安全”

这里需要特别避免过度设计。

如果把每个字段、每个 API、每个 HTTP operation 都做成独立 Capability：

```text
5000 tools
20000 capabilities
```

系统很快会变得不可运营。

所以真正的目标不是：

> 最细粒度。

而是：

> **最小但可运营的 authority boundary。**

一个好的 Capability 应满足：

```text
业务语义清晰
+
权限边界清晰
+
容易测试
+
容易审计
+
容易撤销
+
不造成数量爆炸
```

因此：

```text
business capability
```

通常比：

```text
database operation
```

更适合作为 Agent Tool 的边界。

---

# 四十四、推荐一个实用的 Capability Design Checklist

每新增一个 Agent Tool，都应该问：

### 1. Capability

```text
这个 Tool 到底授予了什么能力？
```

### 2. Necessity

```text
Agent 为什么真的需要它？
```

### 3. Scope

```text
需要整个资源，还是部分资源？
```

### 4. Operation

```text
read / prepare / approve / execute 能否拆开？
```

### 5. Parameter

```text
哪些参数必须受限？
```

### 6. Context

```text
什么 Task/Session 才能使用？
```

### 7. Side Effect

```text
是否改变状态？
是否对外发送？
是否不可逆？
```

### 8. Combination

```text
和其他 Tool 组合后是否形成更高风险能力？
```

### 9. Enforcement

```text
谁在 LLM 之外真正阻止未授权调用？
```

### 10. Audit

```text
能否回答谁在什么时候为什么获得了这个 Capability？
```

### 11. Revocation

```text
如何立即撤销？
```

### 12. Review

```text
多长时间检查一次它是否仍然需要？
```

如果其中任何一个问题回答不清楚，这个 Tool 通常还没有达到适合生产 Agent 的权限设计成熟度。

---

# 四十五、最终可以建立一个非常简单的 Capability Policy Model

可以把 Agent Tool Authorization 抽象为：

```text
ALLOW
=
Identity
∧
AgentScope
∧
TaskScope
∧
Capability
∧
ResourceEntitlement
∧
ContextPolicy
∧
ParameterConstraint
∧
ApprovalRequirement
∧
TimeValidity
```

而：

```text
DENY
=
Any mandatory condition fails
```

这比：

```text
ALLOW
=
Agent has tool
```

安全得多。

---

# 四十六、最值得建立的三个控制面

Capability-based Tool Access 最终可以浓缩成：

```text
                 Agent Control Plane
                         │
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
    Capability       Policy         Entitlement
     Registry        Engine            Store
          │              │              │
          └──────────────┼──────────────┘
                         ▼
                  Tool Gateway
                         │
                 ┌───────┴───────┐
                 ▼               ▼
               Tool           MCP Server
                 │               │
                 └───────┬───────┘
                         ▼
                    Business API
```

其中：

### Capability Registry

回答：

> **有哪些能力？**

### Policy Engine

回答：

> **现在允许吗？**

### Entitlement Store

回答：

> **这个用户/Agent 对哪个资源有权？**

### Tool Gateway

回答：

> **真正调用前，在哪里强制执行？**

这四者组成 Agent Tool Authorization 的最小闭环。

---

# 四十七、最终的架构原则

把整篇文章压缩成几条原则：

## 原则一：Tool Access 不是一个 Role

```text
Agent
≠
Role
```

Agent 应根据任务获得有限 Capability Set。

---

## 原则二：Capability 不应该等于 Tool Name

```text
tool = submitOrder
```

不是完整权限定义。

应该至少包含：

```text
Tool
+
Operation
+
Resource
+
Context
+
Constraints
+
Time
```

---

## 原则三：Tool Discovery 和 Tool Execution 都要控制

```text
只显示允许的 Tool
```

但绝不能因此取消：

```text
Runtime Authorization
```

---

## 原则四：Capability 应该尽量短、窄、临时

```text
Least
+
Scoped
+
Task-specific
+
Time-bounded
```

而不是：

```text
Permanent
+
Broad
+
Agent-wide
```

---

## 原则五：LLM 不应该持有企业权限本身

LLM 可以：

```text
request capability
```

但应该由 Runtime/Gateway：

```text
hold capability
enforce capability
```

---

## 原则六：MCP 是能力交换协议，不是企业授权边界

```text
MCP Tool Annotation
≠
Security Enforcement
```

真正的授权应该在：

```text
Gateway
Policy
Business API
```

执行。MCP 当前官方讨论也明确指出，Tool annotations 是 hints，不是 enforcement。

---

## 原则七：Capability 要控制 Blast Radius，而不仅仅是“拒绝非法请求”

最好的 Capability Design，不是希望 Agent 永远正确。

而是：

```text
Agent 偶尔犯错
        ↓
Capability 限制 authority
        ↓
Policy 再次检查
        ↓
Business Rule 再次验证
        ↓
高风险动作进入 Command / Approval
        ↓
错误不会轻易变成重大业务事故
```

这才是真正的 Agent Least Privilege。

---

# 四十八、结论：Capability-based Tool Access 的真正价值，是把 Agent 的“能力”变成一个受控的安全边界

传统应用通常是：

```text
Identity
 ↓
Role
 ↓
API
```

Agent 更应该变成：

```text
Identity
 ↓
Agent
 ↓
Task
 ↓
Capability
 ↓
Policy
 ↓
Tool
 ↓
Business Authorization
 ↓
Business State
```

Capability 不是为了让权限系统变得更复杂。

恰恰相反，它的目标是解决一个越来越严重的问题：

> **Agent 的推理空间可以很大，但它真正拥有的行动空间必须很小。**

这是 Agent Security 与传统 RBAC 最大的区别之一。

LLM 可以看到很多可能性：

```text
“我可以搜索。”
“我可以读取。”
“我可以计算。”
“我可以准备交易。”
“我可以发送邮件。”
```

但真正能够发生的事情应该被压缩成：

```text
当前 User
+
当前 Task
+
当前 Resource
+
当前 Context
+
当前 Policy
=
当前 Capability Set
```

最终形成：

```text
Reasoning Space
     很大

        ↓

Authority Space
     很小

        ↓

Business Side Effect
     更小
```

这应该成为企业尤其是金融 Agent 平台的一个基本设计目标。

真正成熟的 Agent 不应该是：

> **“一个拥有很多 Tools、希望它自己知道什么时候该用什么的 LLM。”**

而应该是：

> **“一个能够自主推理，但每一步行动都只能在一个由 Identity、Capability、Entitlement 和 Policy 明确定义的最小 authority envelope 中发生的系统。”**

这也是为什么 AWS 当前 Agentic AI Lens 将 Tool Authorization、Least Privilege、Agent Identity、Dynamic Permission Boundary 和 Tool Registry 分开作为独立控制，并强调授权必须在模型之外强制执行。

对于金融服务而言，这种设计尤其有价值，因为高风险业务系统并不需要假设 AI 永远正确；更重要的是，即使 AI 判断错误、被 Prompt Injection 影响或者模型发生 Behavior Drift，系统仍然能够把错误限制在一个明确、可审计、可撤销的权限边界之内。

> **Agent 可以拥有很强的 reasoning ability，但不应该因此拥有很大的 authority。**
>
> **Reasoning 可以开放，Capability 必须收敛。**

---

# 参考资料

### 1. AWS — Well-Architected Agentic AI Lens

AWS 当前最完整的 Agent 架构与安全参考之一，明确覆盖 Tool Authorization、Agent Identity、Least Privilege、Tool Registry、Human Oversight、Reliability 等。
[AWS Well-Architected Agentic AI Lens](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentic-ai-lens.html?utm_source=chatgpt.com)

### 2. AWS — Implement Tool Authorization

明确提出每次 Tool Invocation 应在执行前根据声明式 Policy 授权；反对 Blanket Tool Access 和依赖 Agent 自己判断是否允许调用。
[AWS Agentic AI Lens — Implement tool authorization](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentsec02-bp01.html?utm_source=chatgpt.com)

### 3. AWS — Limit Agent Permissions to Minimum Required Access

说明 Least Privilege 如何限制 Agent 错误行为的 blast radius，并建议持续根据实际 usage 收敛权限。
[AWS Agentic AI Lens — Limit agent permissions](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentrel02-bp02.html?utm_source=chatgpt.com)

### 4. AWS — Least Privilege with Dynamic Boundaries

讨论 temporary credentials、permission boundaries、JIT access 和根据实际访问情况生成 least-privilege policy。
[AWS Agentic AI Lens — Dynamic permission boundaries](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentsec03-bp03.html?utm_source=chatgpt.com)

### 5. AWS — AgentCore Gateway Fine-Grained Access Control

当前比较完整的 Agent Tool authorization 实现案例，支持 Gateway、Tool、Operation、Parameter 多层控制，以及 JWT、IAM、外部授权服务和 interceptor。
[Amazon Bedrock AgentCore Gateway — Fine-grained access control](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/gateway-fine-grained-access-control.html?utm_source=chatgpt.com)

### 6. AWS — AgentCore Policy / Cedar

AgentCore Policy 使用 Cedar 对 Tool Calls 做实时授权，并支持 default deny、forbid-overrides-permit 等策略语义。
[Understanding Cedar policies in AgentCore](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/policy-understanding-cedar.html?utm_source=chatgpt.com)

### 7. AWS — PartiallyAuthorizeActions

用于在 Tool Discovery 阶段确定调用者允许访问哪些 Tool；这对于“只暴露当前 capability set”具有直接参考价值。
[AWS AgentCore Gateway Policy permissions](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/policy-permissions.html?utm_source=chatgpt.com)

### 8. AWS — Tool Integration and Management Practices

强调统一 Tool Registry、版本、Owner、Deprecation、Least Privilege 和服务层统一授权。
[AWS Agentic AI Lens — Tool integration and management](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentops04.html?utm_source=chatgpt.com)

### 9. OWASP — Top 10 for Agentic Applications 2026

面向 autonomous / agentic AI 的安全风险框架，可用于 Tool Access、Excessive Agency、权限与组合风险的 Security Review。该项目由 100+ 行业专家、研究者和实践者协作形成。
[OWASP Top 10 for Agentic Applications 2026](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/?utm_source=chatgpt.com)

### 10. Cloud Security Alliance — AI Agents: Architecture and Control Plane

从 Agent Control Plane、Governance、Execution、Accountability 等角度讨论 Agent 的整体架构和控制。
[CSA — AI Agents: Architecture and Control Plane](https://cloudsecurityalliance.org/artifacts/ai-agents-architecture-and-control-plane?utm_source=chatgpt.com)

### 11. Model Context Protocol — Architecture

MCP 官方架构强调 Host 管理连接权限、安全策略与用户授权，Server 应提供聚焦能力并保持边界隔离。
[MCP Architecture](https://modelcontextprotocol.io/specification/2025-03-26/architecture?utm_source=chatgpt.com)

### 12. Model Context Protocol — Tool Annotations as Risk Vocabulary

MCP 官方 2026 年关于 Tool Annotations 的说明，明确指出 `readOnlyHint`、`destructiveHint` 等是 hints 而不是 enforcement；真正的安全保证应该放在 authorization layer、runtime、network controls 或 sandbox。文章还讨论了多个 Tool capability 组合带来的“lethal trifecta”风险。
[MCP — Tool Annotations as Risk Vocabulary](https://blog.modelcontextprotocol.io/posts/2026-03-16-tool-annotations/?utm_source=chatgpt.com)

### 13. Microsoft Agent Framework — Tools

Microsoft Agent Framework 当前支持 Function Tools、Hosted MCP、Local MCP，并提供 Tool Approval 机制，可在模型实际获得 Tool Result 之前要求人工批准。
[Microsoft Agent Framework — Tools](https://learn.microsoft.com/en-us/agent-framework/agents/tools/?utm_source=chatgpt.com)

### 14. Microsoft Agent Framework — Tool Approval

展示将特定 Tool 标记为 `approval_mode="always_require"`，在 Tool 执行前拦截并等待审批。
[Microsoft Agent Framework — Tool Approval](https://learn.microsoft.com/en-us/agent-framework/agents/tools/tool-approval?utm_source=chatgpt.com)

### 15. OpenAI Agents SDK — Tool Approval / Guardrails

OpenAI Agents SDK 当前支持 Tool `needs_approval`，以及 Tool Input/Output Guardrails，用于在 Tool 执行前后进行检查。
[OpenAI Agents SDK — Tools](https://openai.github.io/openai-agents-python/ref/tool/?utm_source=chatgpt.com)
[OpenAI Agents SDK — Guardrails](https://openai.github.io/openai-agents-python/guardrails/?utm_source=chatgpt.com)

### 16. Mark Miller, Bill Tulloh, Jonathan Shapiro — The Structure of Authority

经典 Least Authority / Object-Capability 研究，强调不要向程序授予超过任务所需的 authority，并讨论动态、按需分配 authority 的重要性。
[The Structure of Authority](https://www.erights.org/talks/no-sep/?utm_source=chatgpt.com)

### 17. IEEE — Capability-Based Security

概述 capability-based security：通过 capability 表达具体资源和操作权能，与传统 ACL 模式进行比较，并强调 least privilege 和受控 delegation。
[IEEE Technology Navigator — Capability-based security](https://technav.ieee.org/topic/capability-based-security/?utm_source=chatgpt.com)

### 18. NIST SP 800-171 — Least Privilege

NIST 对 Least Privilege 的经典定义和实践要求，可作为 Agent Tool Permission 设计的基础安全原则之一。
[NIST SP 800-171 Rev. 3](https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-171r3.html?utm_source=chatgpt.com)

### 19. FINMA — Governance and Risk Management when Using AI

FINMA 从金融机构治理角度强调 AI 带来的 model risk、data risk、IT/cyber risk、third-party dependency 及 legal/reputational risk。
[FINMA Guidance 08/2024](https://www.finma.ch/en/news/2024/12/20241218-mm-finma-am-08-24/?utm_source=chatgpt.com)

### 20. FSB — Financial Stability Implications of AI

FSB 将 AI 的 third-party dependency、provider concentration、cyber risk、model risk、data quality/governance 等视为金融体系需要关注的重要脆弱性。
[FSB — The Financial Stability Implications of Artificial Intelligence](https://www.fsb.org/2024/11/the-financial-stability-implications-of-artificial-intelligence/?utm_source=chatgpt.com)

### 21. SEC — Rule 15c3-5 Market Access Risk Controls

这是金融高风险自动化操作的一个具体监管案例：对于 broker-dealer market access，需要在订单进入市场之前实施相应的风险控制和监管检查，并限制系统和市场访问到授权主体。这里并不意味着 SEC 要求使用 Capability Model，而是说明高风险自动化动作必须处于独立、确定性的控制边界内。
[SEC — Risk Management Controls for Brokers or Dealers With Market Access](https://www.sec.gov/rules-regulations/2011/06/risk-management-controls-brokers-dealers-market-access?utm_source=chatgpt.com)

---

## 最终原则

> **Agent 的 reasoning 可以很开放，但 Agent 的 authority 必须很窄。**

最理想的 Tool Access 不是：

```text
Agent
  ↓
Role
  ↓
Many APIs
```

而是：

```text
User
  ↓
Identity
  ↓
Task
  ↓
Capability Set
  ↓
Resource / Context Constraints
  ↓
Policy
  ↓
Tool Gateway
  ↓
Business Authorization
```

而对于金融高风险动作：

```text
Capability
  ↓
Policy
  ↓
Command
  ↓
Approval
  ↓
Execution
```

真正需要保护的，不是让 Agent “永远不会想错”，而是确保：

> **即使 Agent 想错、选错 Tool、被 Prompt Injection 影响，或者模型版本发生变化，它所拥有的 authority 仍然不足以轻易突破企业既定的安全和业务边界。**

这才是 Capability-based Tool Access 最值得引入 Agent 平台的原因。

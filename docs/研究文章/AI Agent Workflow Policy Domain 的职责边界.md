
# AI Agent / Workflow / Policy / Domain 的职责边界


# AI Agent / Workflow / Policy / Domain 的职责边界

## 1. 为什么需要重新定义四者的边界

传统企业系统通常已经存在几个相对成熟的概念：

```text
Application / Workflow
Authorization / Policy
Domain
Data / Infrastructure
```

AI Agent 加入以后，多了一个具有“推理、规划、动态选择工具”能力的执行者。

于是很容易出现这种情况：

```text
Agent
    ↓
自己判断业务规则
    ↓
自己决定下一步
    ↓
自己判断是否有权限
    ↓
自己调用 Domain API
    ↓
修改业务状态
```

表面上系统非常“智能”，实际上却把原本分散在业务流程、权限系统和 Domain 中的控制权集中给了 LLM。

这也是当前大厂 Agent 架构逐渐强调“bounded autonomy”的原因：AWS 的 Agentic AI Lens 要求工具调用经过外部、确定性的授权检查，Workflow 层保护状态机和状态转换，并明确限制 Agent 的权限；Microsoft Agent Framework 则明确区分“由代码决定结果的 deterministic executor”“由人决定的 HITL gate”和“由模型动态决定下一步的 Agent”。

因此，金融服务领域更应该建立下面这个基本分工：

```text
Agent
    = 负责理解和推理

Workflow
    = 负责流程和状态

Policy
    = 负责权限和约束

Domain
    = 负责业务事实和业务不变量
```

最重要的一句话：

> **Agent 决定“怎么完成工作”，Workflow 决定“业务流程走到哪里”，Policy 决定“是否允许这样做”，Domain 决定“这样做在业务上是否成立”。**

---

# 2. 四者不是四种“业务逻辑”

首先要纠正一个非常常见的错误：

```text
Agent Logic
Workflow Logic
Policy Logic
Domain Logic
```

并不是四份可以随便放置的 Business Logic。

它们处理的是四种不同的问题：

| 层        | 核心问题                  | 典型输出                                 |
| -------- | --------------------- | ------------------------------------ |
| Agent    | 应该如何完成当前工作？           | 分析、建议、候选方案                           |
| Workflow | 当前流程应该处于什么状态？下一步是什么？  | State Transition                     |
| Policy   | 当前主体是否被允许做这件事？需要什么控制？ | Allow / Deny / Require Approval      |
| Domain   | 这个业务操作本身是否成立？         | Business State Change / Domain Event |

可以把它们看成四个连续的过滤器：

```text
                    User / Event
                         │
                         ▼
                    Workflow
               “现在应该做什么？”
                         │
                         ▼
                     Agent
               “怎么完成这项工作？”
                         │
                         ▼
                     Policy
                “允许这么做吗？”
                         │
                         ▼
                     Domain
               “业务上真的成立吗？”
                         │
                         ▼
                  Business State
```

这里顺序不是绝对固定的，但职责必须保持。

---

# 3. 最重要的边界：四个问题

设计时可以始终问四个问题。

## 3.1 Agent：How

> **如何完成这项工作？**

例如：

* 查哪些资料？
* 比较哪些文档？
* 如何分析风险？
* 如何组织研究结果？
* 哪些证据值得关注？
* 如何形成 Recommendation？

这些天然适合 AI。

---

## 3.2 Workflow：When / Where

> **什么时候做？现在处于流程的哪一步？下一步去哪？**

例如：

```text
Research
    ↓
Compliance
    ↓
Portfolio Manager
    ↓
Operations
```

Workflow 决定：

* 当前 Node；
* 下一 Node；
* 是否等待人工；
* 哪个结果进入哪条路径；
* 是否允许 retry；
* 是否进入 terminal state。

这类问题应该尽量确定性。

---

## 3.3 Policy：Who / Whether

> **谁在什么条件下可以做这件事？**

例如：

```text
Can analyst publish?
Can compliance approve?
Can the initiator approve their own request?
Can this agent access client X?
Does this command require human approval?
```

Policy 处理：

* 身份；
* 角色；
* 资源；
* Capability；
* Data Entitlement；
* SoD；
* 风险等级；
* 条件；
* 审批要求。

AWS 的 Cedar / Verified Permissions 架构明确将 Policy Decision Point 与应用业务逻辑分开：应用发起授权请求，由 Policy Engine 返回 Allow / Deny。

---

## 3.4 Domain：What

> **这个业务操作本身是否成立？**

例如：

```text
InvestmentIdea cannot be published twice.

An order cannot exceed the permitted position limit.

A portfolio cannot contain an asset with an invalid state.

A completed transaction cannot be modified arbitrarily.

Approval cannot transition a case directly from Draft to Settled.
```

这是业务 Domain 的责任。

AWS 对 DDD / Hexagonal Architecture 的指导也强调 Domain 是业务逻辑核心，应独立于外部框架和基础设施；Microsoft 的 DDD 指导同样明确要求业务规则和 Domain knowledge 不应放在 Application Layer，而应由 Domain Model 持有。

---

# 4. 最容易混淆的：Policy 与 Domain

这是四层设计中最重要的边界。

很多团队会问：

> “这个规则到底放 Policy 还是 Domain？”

推荐使用下面这个判断标准：

> **如果规则回答“谁、在什么上下文中，可以做什么”，优先考虑 Policy。**
>
> **如果规则回答“这个业务对象怎样才是合法的”，优先考虑 Domain。**

---

## 4.1 Policy Rule

例如：

```text
只有 Portfolio Manager 可以 approve Investment Idea。

Compliance Reviewer 不能批准自己发起的 Case。

Analyst 可以创建 Investment Idea，但不能 publish。

Japan desk 可以访问 Japan portfolio。

超过某个风险等级时必须进行 Compliance Review。
```

这些都是：

```text
Actor
+
Context
+
Permission
```

因此属于 Policy。

---

## 4.2 Domain Rule

例如：

```text
Investment Idea 必须处于 APPROVED 状态才能 Published。

一个 Investment Idea 不能被 Publish 两次。

Order quantity 不能为负数。

Settlement completed 后不能重新进入 Pending。

Position 不允许出现违反 Domain invariant 的状态。
```

这些规则即使：

```text
Actor = Admin
Actor = System
Actor = Agent
```

也应该成立。

因此它们属于 Domain。

---

# 5. 一个非常实用的判断方法

看到一条规则时，可以问：

### 换一个用户，规则还成立吗？

例如：

> “Investment Idea 必须经过 Compliance Approval 才能 Publish。”

无论谁操作，这个业务状态要求都成立。

所以核心部分属于 Domain / Workflow。

再看：

> “只有 Compliance Reviewer 才能执行这个 Approval。”

换一个用户可能就不成立。

所以属于 Policy。

再看：

> “Compliance Approval 完成以后进入 PM Review。”

这是流程顺序。

所以属于 Workflow。

再看：

> “Compliance Reviewer 应该分析哪些风险点？”

这是工作方法。

所以属于 Agent Skill。

最终形成：

```text
Rule:
“需要 Compliance”
        ↓
Workflow

Rule:
“谁可以做 Compliance”
        ↓
Policy

Rule:
“Compliance 后 Case 才能进入下一合法业务状态”
        ↓
Domain / Workflow

Rule:
“如何进行 Compliance Analysis”
        ↓
Agent
```

---

# 6. Domain 不应该知道 Agent

这是 AI 架构里最容易破坏 DDD 的地方。

错误：

```text
Domain
   ↓
call LLM
   ↓
Agent decides whether transaction is valid
```

或者：

```text
InvestmentIdea.publish()
   ↓
ask Agent:
    "Is this safe?"
```

这样 Domain 的业务合法性依赖了一个概率性系统。

Domain 应该仍然保持：

```text
Domain
   ↓
Deterministic Business Rules
```

例如：

```ts
investmentIdea.publish()
```

必须自己保证：

```text
status == APPROVED
```

而不是：

```ts
if (await agent.isItOkayToPublish()) {
   publish();
}
```

AI 可以提供：

```text
Recommendation
Risk Assessment
Evidence
Classification
```

但 Domain 不应该把 LLM 结果当作自身的不变量。

---

# 7. Agent 不应该知道整个 Domain

反过来也一样。

不要让 Agent 获得：

```text
Database
+
all Domain APIs
+
all Commands
```

然后：

```text
Agent decides what business state to change
```

Agent 应该通过受控 Capability 与业务系统交互。

例如：

```text
Agent
 │
 ├── search-research
 ├── read-investment-data
 ├── get-compliance-status
 │
 └── propose-publish-command
```

真正执行：

```text
propose-publish-command
        ↓
Policy
        ↓
Approval
        ↓
Domain API
```

AWS 对 Agent Tool Security 的指导明确要求：每次 Tool Invocation 都应该在执行之前经过外部 Policy 授权，而且不能依赖 Agent 自己判断“这次操作是否允许”。

---

# 8. Workflow 不应该成为新的 Domain

Workflow 也很容易不断膨胀。

例如最开始：

```text
Research
  ↓
Compliance
  ↓
Approval
```

后来有人不断往 Workflow 中增加：

```text
if portfolio.value > X
if client.type == Y
if riskScore > Z
if country == JP
if user.role == PM
if position > limit
```

最后 Workflow 变成：

```text
巨大 Business Rule Engine
```

这不是理想状态。

Workflow 应该主要回答：

```text
What happens next?
```

而不是：

```text
What is mathematically or semantically true about the business?
```

---

# 9. Workflow 的职责

Workflow 最适合：

```text
State
Transition
Sequencing
Waiting
Retry
Timeout
Escalation
Human Gate
Command Invocation
```

例如：

```text
@task research
    ↓
@gate quality
    ↓
@review compliance
    ↓
@review PM
    ↓
@command publish
    ↓
@end
```

Workflow 不应该负责实现：

```text
InvestmentIdea.calculateFairValue()
Portfolio.calculateExposure()
Order.validateSettlement()
```

这些应该属于 Domain。

---

# 10. Workflow 也不应该拥有最终 Authorization

例如：

```text
@command publish
role: investment.reviewer
```

这个信息可以成为 Workflow 对 Policy 的一个约束，但不能意味着：

```text
Workflow == Authorization System
```

更合理的是：

```text
Workflow
   ↓
Command Intent
   ↓
Policy
   ↓
Authorization Decision
   ↓
Domain Command
```

即：

> **Workflow 可以提出“现在需要执行什么”，Policy 才决定“当前主体是否有资格执行”。**

这样可以防止：

```text
workflow YAML / Markdown
```

成为一套偷偷实现的 IAM 系统。

AWS Prescriptive Guidance 建议将 Policy Decision Point 和 Policy Enforcement Point 作为独立授权架构，并强调 Authorization Logic 与 Application Logic 解耦。

---

# 11. Policy 也不应该成为 Business Workflow

反过来也不能把所有流程都写成：

```text
if user.role == compliance
    then...
```

Policy 应该回答：

```text
Allowed?
Denied?
Require approval?
Which constraints apply?
```

而不应该回答：

```text
Step 1
Step 2
Step 3
Step 4
```

例如：

```text
Policy:
PM can publish after required approvals.

Workflow:
Compliance Review
    ↓
PM Review
    ↓
Publish
```

Workflow 管顺序。

Policy 管权限。

---

# 12. Policy 也不应该负责真正的业务 Mutation

错误：

```text
Policy says:
    ALLOW

Policy Engine:
    UPDATE investment_idea SET status = 'PUBLISHED'
```

正确：

```text
Policy
    ↓
ALLOW

Domain / Command Handler
    ↓
publish()
```

Policy 的结果应该类似：

```json
{
  "decision": "allow",
  "reason": "...",
  "policyVersion": "investment-publish-v4"
}
```

然后 Command / Domain 执行实际业务操作。

Cedar 的设计正是如此：Policy Engine 返回授权决策，应用在获得 ALLOW 后执行操作；Cedar 明确强调 Authorization Logic 与 Business Logic 的分离。

---

# 13. Command 是四层之间非常重要的“桥”

这也是为什么在 Agent Workflow 中建议显式引入：

```text
Command
```

它连接：

```text
Workflow
   ↓
Policy
   ↓
Domain
```

完整链条：

```text
Agent
  │
  │ recommendation
  ▼
Workflow
  │
  │ command intent
  ▼
Policy
  │
  │ allow / deny / approval
  ▼
Command Handler
  │
  ▼
Domain
  │
  │ validate invariants
  ▼
Business State
```

因此：

> **Command 不是 Agent Tool，也不是 Domain Entity。**

它是一个明确描述：

> “我要对哪个业务对象执行什么业务操作”

的结构化意图。

---

# 14. 一个完整的 Investment Idea 示例

假设业务需求：

> Analyst 创建一个 Investment Idea，经过 AI Research、Compliance Review、Portfolio Manager Approval，最后 Publish。

架构应该这样拆。

## Agent

负责：

```text
Search research
Read documents
Analyze financial information
Identify risks
Generate Investment Memo
Recommend next step
```

输出：

```json
{
  "recommendation": "proceed",
  "riskFindings": [...],
  "evidence": [...]
}
```

---

## Workflow

负责：

```text
Draft
  ↓
Research
  ↓
Compliance Review
  ↓
PM Review
  ↓
Publish
```

以及：

```text
Research failed → retry
Compliance rejected → rejected
PM rejected → rejected
Publish failed → failed
```

---

## Policy

负责：

```text
Can this user perform Compliance Review?
Can initiator approve?
Does this risk class require additional approval?
Can this PM publish this portfolio?
Does this command require human approval?
```

---

## Domain

负责：

```text
InvestmentIdea.status
InvestmentIdea.publish()
InvestmentIdea.reject()
InvestmentIdea.approve()
```

以及：

```text
Cannot publish unless status == APPROVED
Cannot approve an already rejected idea
Cannot publish twice
```

---

# 15. 四者的完整关系

可以形成：

```text
                         User / Event
                              │
                              ▼
                       ┌─────────────┐
                       │  Workflow   │
                       │             │
                       │ State       │
                       │ Routing     │
                       │ Human Gate  │
                       └──────┬──────┘
                              │
                        AI Work / Intent
                              │
              ┌───────────────┴──────────────┐
              ▼                              ▼
       ┌─────────────┐                ┌─────────────┐
       │    Agent    │                │    Policy   │
       │             │                │             │
       │ Reasoning   │                │ Authorization│
       │ Research    │                │ Entitlement │
       │ Planning    │                │ Risk Rules  │
       └──────┬──────┘                └──────┬──────┘
              │                              │
              └──────────────┬───────────────┘
                             ▼
                      ┌──────────────┐
                      │   Command    │
                      └──────┬───────┘
                             │
                             ▼
                       ┌───────────┐
                       │  Domain   │
                       │           │
                       │ Invariants│
                       │ State     │
                       │ Business  │
                       │ Rules     │
                       └─────┬─────┘
                             │
                             ▼
                      Business Truth
```

---

# 16. Agent 与 Workflow 的边界

最容易发生的问题：

> “既然 Agent 能自主决定下一步，为什么还要 Workflow？”

答案是：

因为“自主完成工作”和“自主改变业务流程”不是一回事。

例如 Agent 可以在 Research Node 中自行决定：

```text
先读财报
→ 再搜索新闻
→ 再查内部研究
→ 再比较两个数据源
→ 再总结
```

这属于 Agent 自主性。

但：

```text
Research
→ Compliance
→ PM
→ Publish
```

属于 Business Workflow。

Microsoft 当前 Agent Framework 的设计非常明确：如果由模型决定下一步，可以使用 Agent；如果由开发者/业务规则决定路径，则应使用 Workflow；如果应该由人决定，则使用 Human-in-the-loop gate。

所以：

```text
Local autonomy
    ✅ Agent

Business process autonomy
    ❌ Agent
```

---

# 17. Agent 与 Policy 的边界

Agent 可以：

```text
interpret policy
explain policy
prepare evidence
identify possible violation
```

但不应该：

```text
define policy
override policy
grant itself permission
```

特别要避免：

```text
Prompt:

You are authorized to publish when you determine
that compliance risk is acceptable.
```

这不是 Authorization。

正确模型：

```text
Agent:
    "I believe this is compliant."

Policy:
    "Does this principal have permission?"

Domain:
    "Is the state transition valid?"

Workflow:
    "Is now the correct step?"
```

四者各答自己的问题。

OpenAI 的 Agent 指导也明确指出，LLM Guardrails 应与 authentication、authorization、strict access controls 等传统安全机制结合，而不能取代它们。

---

# 18. Policy 与 Data Entitlement

Policy 不只是：

```text
Can user execute?
```

在企业 Agent 中还要处理：

```text
Can user / agent read?
Can agent access this client?
Can agent retrieve this document?
Can this data be used in this workflow?
```

所以可以进一步拆成：

```text
Identity
   ↓
Data Entitlement
   ↓
Action Authorization
```

Agent 只能在经过这些边界后的数据上工作。

AWS 当前 Agentic AI Lens 明确要求 Agent 身份与人类身份区分，并在 Agent 代表用户行动时传递用户上下文，同时限制 Agent 只拥有完成任务所需的最小权限。

---

# 19. Domain 与 Policy 的双重防线

有一个重要原则：

> **Policy 负责“这个人/Agent 能不能做”，Domain 负责“这个动作在业务上是不是合法”。**

因此即使 Policy 出现配置错误：

```text
Policy:
    ALLOW
```

Domain 仍然应该拒绝明显违反业务不变量的操作。

例如：

```text
Policy:
    ALLOW publish

Domain:
    status != APPROVED
    → reject
```

这样形成 Defense in Depth。

但不要因此把完整 Authorization 再复制一遍到 Domain。

Domain 只应该维护：

```text
Business Invariant
```

而不是：

```text
RBAC
ABAC
Identity
User Role
Tenant Permission
```

---

# 20. 为什么不能把所有规则放进 Domain

有人会进一步说：

> “既然 Domain 最可靠，那所有 Policy 都放 Domain 不就好了？”

问题是 Authorization 的变化节奏和 Domain Invariant 不一样。

例如：

```text
业务规则：
An Investment Idea must be approved before publication.
```

可能几年都不变。

但：

```text
Compliance Reviewer
can approve only if...
```

可能因为：

* 组织变化；
* Region 变化；
* Regulation 变化；
* Desk 变化；
* Temporary Delegation；

而不断变化。

因此：

```text
Domain Rule
    → stable business truth

Policy
    → contextual authorization
```

二者应该分开管理。

Cedar 的设计明确把 Authorization Logic 与 Business Logic 解耦，就是为了让授权规则可以独立于业务代码进行管理和分析。

---

# 21. 为什么不能把所有规则放进 Workflow

反过来也一样。

例如：

```text
Workflow:
if user.role == analyst
if portfolio.region == JP
if riskScore > 70
if account.type == institutional
...
```

最后 Workflow DSL 会变成一个：

```text
Authorization + Rules Engine + Domain Engine
```

这会产生三个问题：

1. Workflow 难以复用；
2. Policy 无法统一治理；
3. 业务规则与流程顺序纠缠。

更好的做法：

```text
Workflow
    ↓
ask policy
    ↓
decision
```

Workflow 只消费 Policy Decision。

---

# 22. 哪些内容必须是确定性的

金融领域建议把以下内容尽量确定性化：

```text
Workflow State
Workflow Transition
Authorization
Data Entitlement
Approval Requirement
Role Separation
Command Validation
Business Invariants
Idempotency
Audit Event
```

而以下内容可以保持概率性：

```text
Research
Summarization
Classification
Recommendation
Natural Language Generation
Information Extraction
Hypothesis Generation
```

因此可以画成：

```text
Probability
   ↑
   │       Agent
   │
   │
   │
   │
   └────────────────────────→ Control
          Workflow
          Policy
          Domain
```

不是“越靠近业务越要 AI”，而恰恰相反：

> **越靠近业务最终控制点，越应该减少不确定性。**

---

# 23. Human 不是第四个技术组件，而是责任边界

在金融业务中还需要特别强调：

```text
Agent
Workflow
Policy
Domain
```

之外还有：

```text
Human Responsibility
```

例如：

```text
AI:
    "风险可接受"

Policy:
    "当前用户可以提交"

Workflow:
    "现在进入审批阶段"

Domain:
    "状态变化合法"

Human:
    "我承担这个审批决定"
```

尤其涉及：

* 客户影响；
* 投资决策；
* 重大合规判断；
* 重大财务结果；
* 不可逆操作；

不能因为：

```text
Agent confidence = 0.98
```

就自动替代需要承担责任的人。

AWS Financial Services Industry Lens 明确要求关键金融流程保留适当 Human-in-the-loop 能力，并强调风险级别、职责和 Three Lines of Defense。

---

# 24. 四层架构下的典型反模式

## 反模式 1：Agent 决定 Workflow

```text
Agent:
    "Next I will call Compliance."
```

然后系统真的进入 Compliance。

问题：

```text
Agent = Workflow Engine
```

应该改为：

```text
Agent → output
Workflow → transition
```

---

## 反模式 2：Agent 决定 Authorization

```text
Agent:
    "I am acting for the PM,
     therefore I can publish."
```

错误。

应该：

```text
Agent Identity
+
User Context
+
Policy
→
Allow / Deny
```

---

## 反模式 3：Workflow 实现 Authorization

```text
if role == PM:
    next = publish
```

把流程和授权混在一起。

应该：

```text
Workflow
    → policy.check()
    → decision
```

---

## 反模式 4：Domain 调 Agent

```text
Domain:
    ask LLM whether transaction is valid
```

这样 Domain 不再是确定性业务核心。

---

## 反模式 5：Policy 改业务状态

```text
Policy:
    if allowed:
        update status = APPROVED
```

Policy 不应该执行 Mutation。

---

## 反模式 6：Domain 管理 Agent Permission

```text
InvestmentIdea:
    if user.role == ...
```

Domain 应该关心：

```text
"可以进入什么业务状态"
```

而不是：

```text
"谁拥有这个权限"
```

---

## 反模式 7：所有四层都实现同一条规则

例如：

```text
Agent Prompt:
    only PM can publish

Workflow:
    only PM can publish

Policy:
    only PM can publish

Domain:
    only PM can publish
```

这不是 Defense in Depth，而是 Rule Duplication。

真正应该是：

```text
Agent:
    不决定权限

Workflow:
    请求 Publish

Policy:
    判断 PM 是否允许

Domain:
    检查业务状态是否合法
```

---

# 25. 一个简单的职责判断表

以后设计任何新功能，可以直接使用这张表。

| 问题                  | 放哪里                       |
| ------------------- | ------------------------- |
| 如何完成任务？             | Agent                     |
| 查什么资料？              | Agent                     |
| 如何总结？               | Agent                     |
| 如何生成 Draft？         | Agent                     |
| 当前流程在哪一步？           | Workflow                  |
| 下一步是什么？             | Workflow                  |
| 是否等待人？              | Workflow                  |
| 失败后去哪？              | Workflow                  |
| 谁可以做？               | Policy                    |
| 谁可以看到？              | Policy / Data Entitlement |
| 谁不能做？               | Policy                    |
| 是否需要审批？             | Policy                    |
| 是否允许这个 Tool？        | Policy / Capability       |
| 业务对象是否合法？           | Domain                    |
| 状态转换是否合法？           | Domain                    |
| 交易是否满足业务不变量？        | Domain                    |
| 真正写入 Business State | Domain                    |
| 真正产生副作用             | Domain / Command Handler  |

---

# 26. 一个更进一步的四层模型

可以把四层理解成四种“Authority”。

```text
Agent Authority
    = Work Authority

Workflow Authority
    = Process Authority

Policy Authority
    = Authorization Authority

Domain Authority
    = Business Truth Authority
```

也就是：

```text
Agent
    owns HOW

Workflow
    owns WHEN

Policy
    owns WHETHER

Domain
    owns WHAT IS TRUE
```

这是整个架构最重要的总结。

---

# 27. `@task / @gate / @review / @command` 为什么是合理抽象

在实际 Workflow DSL 中，可以把这个模型非常直接地映射：

```text
@task
    → Agent

@gate
    → deterministic business/process decision

@review
    → Human Decision

@command
    → controlled business mutation
```

例如：

```text
## @flow investment-review
start -> research

## @task research
output: non-empty
tools: read,url

## @gate compliance
- pass -> compliance-review
- fail -> rejected

## @review compliance-review
role: compliance.reviewer
strategy: ALL
required: 2

## @command publish
role: investment.reviewer
- success -> completed
- fail -> publish-failed

## @stop rejected
## @end completed
```

这个 DSL 的价值不在于“语法漂亮”，而在于：

> **它把 Agent Work、Process Decision、Human Decision、Business Mutation 四种完全不同的责任显式区分出来。**

这样 Parser / Validator / Runtime 都可以围绕明确的语义进行约束。

---

# 28. 一个 Command 的完整生命周期

在这套模型中，Command 最适合作为四层之间的控制边界：

```text
                Agent
                  │
             suggestion
                  │
                  ▼
              Workflow
                  │
             CommandIntent
                  │
                  ▼
               Policy
          ┌───────┼────────┐
          │       │        │
        DENY    APPROVE   REVIEW
                          │
                          ▼
                        Human
                          │
                       APPROVE
                          │
                          ▼
                  Command Executor
                          │
                          ▼
                       Domain
                          │
                          ▼
                    Business State
```

这条链路非常适合金融系统，因为每一层都可以回答不同的审计问题：

```text
Agent:
    为什么建议这么做？

Workflow:
    为什么现在执行？

Policy:
    为什么允许？

Human:
    谁承担审批责任？

Domain:
    最终改变了什么业务状态？
```

---

# 29. 四层都应该有自己的测试方式

边界清晰还有一个巨大的工程价值：测试可以分层。

## Agent

测试：

```text
Quality
Evidence
Correctness
Hallucination
Tool selection
```

## Workflow

测试：

```text
State transitions
Reachability
Dead paths
Retry
Timeout
Approval waiting
Recovery
```

## Policy

测试：

```text
Allow
Deny
Boundary
Role
Tenant
Resource
SoD
```

## Domain

测试：

```text
Business invariants
State transitions
Commands
Transactions
Concurrency
Consistency
```

因此：

> **Agent Evaluation、Workflow Testing、Policy Testing、Domain Testing 不应该成为一种测试。**

---

# 30. 版本管理也应该分开

生产系统里必须能够区别：

```text
Agent Version
Skill Version
Workflow Version
Policy Version
Domain Version
```

例如一次操作：

```text
Execution #12345

Agent:
    research-agent v8

Skill:
    investment-research v12

Workflow:
    investment-review v7

Policy:
    publication-policy v4

Domain:
    investment-service v21
```

这样才可能回答：

> “为什么 9 月 1 日这次允许操作，而 9 月 15 日不允许？”

因为可能变化的是：

```text
Policy
```

也可能变化：

```text
Workflow
```

甚至只是：

```text
Agent / Skill
```

如果四者混在一起，事故调查会非常困难。

AWS Financial Services Industry Lens 已把 AI model governance、审批、版本生命周期、权限控制和审计作为独立治理问题。

---

# 31. 金融服务领域的推荐最终架构

```text
                         HUMAN
                    responsibility
                           │
                           ▼
                  ┌─────────────────┐
                  │    WORKFLOW     │
                  │                 │
                  │ State           │
                  │ Routing         │
                  │ Retry           │
                  │ Human Gate      │
                  │ Command Intent  │
                  └────────┬────────┘
                           │
                 ┌─────────┴─────────┐
                 ▼                   ▼
          ┌─────────────┐     ┌──────────────┐
          │    AGENT    │     │    POLICY    │
          │             │     │              │
          │ Reason      │     │ Authorization│
          │ Research    │     │ Entitlement  │
          │ Plan        │     │ SoD          │
          │ Generate    │     │ Risk Control │
          └──────┬──────┘     └──────┬───────┘
                 │                   │
                 └─────────┬─────────┘
                           ▼
                    ┌──────────────┐
                    │   COMMAND    │
                    └──────┬───────┘
                           ▼
                    ┌──────────────┐
                    │    DOMAIN    │
                    │              │
                    │ Invariants   │
                    │ Business     │
                    │ State        │
                    │ Transactions │
                    └──────┬───────┘
                           ▼
                    BUSINESS TRUTH
```

---

# 32. 最终设计原则

可以把这份文档最终压缩成 12 条原则：

```text
1. Agent owns reasoning, not authorization.

2. Workflow owns process state, not business truth.

3. Policy owns authorization, not business mutation.

4. Domain owns business invariants and business state.

5. LLM output is always an untrusted proposal.

6. Workflow transitions should be deterministic wherever possible.

7. Authorization must be externally enforceable.

8. Data entitlement must not depend on the model following a prompt.

9. High-risk side effects must pass through an explicit Command boundary.

10. Domain must not depend on LLM reasoning.

11. Human approval is a business decision, not a chat message.

12. Every production operation should make it possible to answer:
    Who?
    What?
    When?
    Why?
    Allowed by which Policy?
    Validated by which Domain rule?
```

---

# 33. 最值得记住的一张图

最终可以把整个模型理解成：

```text
                         ┌──────────────┐
                         │    AGENT     │
                         │              │
                         │   How?       │
                         └──────┬───────┘
                                │
                                ▼
                         ┌──────────────┐
                         │  WORKFLOW    │
                         │              │
                         │  When/Where? │
                         └──────┬───────┘
                                │
                                ▼
                         ┌──────────────┐
                         │   POLICY     │
                         │              │
                         │ Who/Whether? │
                         └──────┬───────┘
                                │
                                ▼
                         ┌──────────────┐
                         │   DOMAIN     │
                         │              │
                         │ What is true?│
                         └──────┬───────┘
                                │
                                ▼
                         Business State
```

因此，真正需要避免的不是“Agent 太聪明”，而是**四种 Authority 发生了错误合并**：

```text
Agent → Workflow
Agent → Policy
Policy → Domain
Workflow → Domain
Domain → Agent
```

一个成熟的金融 Agent 架构应该做到：

> **让 Agent 足够聪明地完成工作，让 Workflow 足够确定地控制流程，让 Policy 足够独立地控制授权，让 Domain 足够稳定地维护业务真相。**

这也是为什么金融领域不应该简单追求“Fully Autonomous Agent”。FSB 已将 AI 在金融领域的模型风险、数据治理、网络风险以及第三方依赖列为重要风险；AWS 的金融服务指导进一步要求明确职责、人机协作、Agent Governance、权限边界和审计。

从架构上看，真正值得追求的不是：

```text
More Autonomous Agent
```

而是：

```text
More Autonomous Work
+
More Deterministic Control
```

这两者并不矛盾，反而应该同时增强。

---

## 参考资料

**AWS — Agentic AI Lens**：Agent 工具授权、Agent Identity、Workflow Orchestration Security、Least Privilege、工具治理等。

**AWS — Financial Services Industry Lens**：职责分离、Human-in-the-loop、Agent Governance、AI Model Governance、访问控制。

**AWS — Cedar / Verified Permissions**：Policy Decision Point、Authorization Logic 与 Business Logic 的解耦。

**Microsoft Agent Framework**：Workflow、deterministic executor、Agent delegation、HITL 的职责区分。

**Anthropic — Building Effective Agents**：Workflows 与 Agents 的区别，以及避免不必要 Agent 自主性的工程原则。

**OpenAI — A Practical Guide to Building Agents**：Agent、Workflow、Guardrails、Authorization 和 Human Intervention 的组合方式。

**AWS / Microsoft DDD Guidance**：Domain Model、Business Rules、Application Layer 与 Domain Layer 的职责分离。

**FSB — The Financial Stability Implications of AI**：金融领域 AI 的模型风险、数据治理、网络风险和第三方依赖。

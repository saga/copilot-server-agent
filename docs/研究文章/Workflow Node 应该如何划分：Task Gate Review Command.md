下面给出一版可以直接作为架构研究文档使用的版本。核心结论不是简单地把 BPMN 的 `Task / Gateway / User Task` 换成四个新名字，而是要解决 **Agent 参与之后，Workflow Node 到底应该表达什么语义**。

---

# Workflow Node 应该如何划分：Task / Gate / Review / Command

> **研究范围**：企业 Workflow / Agentic Workflow，重点关注金融服务场景
> **核心问题**：当一个 Workflow 同时包含确定性业务流程、Agent 推理、业务规则、人类审批以及真实业务操作时，Node 应该如何划分，才能保持可审计、可控制、可测试，并避免把 Agent Runtime 变成隐式 Workflow Engine？
>
> **结论先行**：
>
> 一个面向金融业务的 Agentic Workflow，建议将业务节点收敛为四类核心语义：
>
> **Task = 做事情**
> **Gate = 判断能不能继续**
> **Review = 让有权限的人做决定**
> **Command = 真正改变业务世界**
>
> 其中最重要的一条边界是：
>
> **Command 不是普通 Task。**
>
> Task 可以计算、查询、转换、生成 Proposal；Command 才拥有明确的业务副作用。
> Agent 可以参与 Task，可以产生 Gate 的输入，也可以提出 Command Proposal，但 **不能因为 Agent 推理结果就直接获得 Command 的执行权**。

---

# 1. 为什么 Workflow Node 的划分在 Agent 时代变得重要

传统 Workflow 中，Node 往往按照技术实现划分：

```text
Service Task
User Task
Script Task
Business Rule Task
Gateway
Event
```

BPMN 本身就是这种思想的典型代表。

Camunda 对 Task 的定义非常明确：Task 是流程中的 atomic unit of work；Service Task、User Task、Business Rule Task 等只是不同类型的工作单元。([Camunda 8 Docs][1])

AWS Step Functions 也是类似思路：

```text
Task
Choice
Parallel
Map
Pass
Wait
Succeed
Fail
```

其中 Task 表示实际执行的工作，而 Choice、Wait、Parallel 等负责控制流程。([AWS Documentation][2])

这套模型在传统自动化系统中非常合理。

但 Agent 加入之后，一个新的问题出现了：

```text
Agent
  ↓
"我认为下一步应该审批"
  ↓
Workflow
  ↓
"那就调用 approve API"
```

这里实际上混合了至少四件不同的事情：

1. Agent 做了一个推理；
2. 系统判断某个条件是否满足；
3. 人做了一个审批决定；
4. 系统执行了一个具有业务副作用的操作。

如果这些都叫 `Task`，Workflow 看起来非常简单，但控制边界会逐渐消失。

对于金融业务尤其危险。

BCBS 关于 Operational Resilience 的原则明确强调治理、风险控制、关键业务流程、授权、审批、控制措施以及责任边界。([Bank for International Settlements][3])

因此，Agentic Workflow 不应该只是：

```text
Node A → Node B → Node C
```

而应该明确表达：

```text
         ┌──────────────┐
         │     Task     │
         │  做事情       │
         └──────┬───────┘
                ↓
         ┌──────────────┐
         │     Gate     │
         │  能否继续？   │
         └──────┬───────┘
                ↓
         ┌──────────────┐
         │    Review    │
         │  谁来决定？   │
         └──────┬───────┘
                ↓
         ┌──────────────┐
         │   Command    │
         │  改变业务世界 │
         └──────────────┘
```

这四种语义应该成为 Workflow Design 的基本 vocabulary。

---

# 2. 四种 Node 的基本定义

建议使用下面的定义。

| Node        | 核心问题       | 是否产生业务副作用 |       是否允许 Agent 主导 | 是否需要权限控制 |
| ----------- | ---------- | --------: | ------------------: | -------: |
| **Task**    | 要做什么工作？    |       通常否 |                  可以 |        是 |
| **Gate**    | 能不能继续？     |         否 |   原则上不应由 Agent 独立决定 |        是 |
| **Review**  | 谁来做决定？     |       通常否 | Agent 可以提供 Proposal |        是 |
| **Command** | 要改变什么业务状态？ |     **是** |     Agent 不应直接拥有执行权 |   **强制** |

可以进一步理解为：

### Task

```text
Input → Processing → Output
```

例如：

```text
Fetch ISS voting data
Calculate exposure
Retrieve research documents
Generate investment summary
Extract entities from document
Calculate portfolio concentration
Generate proxy voting proposal
```

它的核心是：

> **产生一个结果。**

---

### Gate

```text
Input → Deterministic Rule → Branch
```

例如：

```text
Is voting deadline passed?
Is position above threshold?
Is this security restricted?
Does the user have entitlement?
Is approval required?
Is the requested amount within limit?
Is the data complete?
```

它的核心是：

> **决定 Workflow 是否允许进入下一阶段。**

Gate 不应该负责：

```text
"我觉得这个交易应该批准"
```

而应该负责：

```text
approval_required == true
```

或者：

```text
amount <= approval_limit
```

AWS Step Functions 的 Choice state 就是这种语义：根据输入评估规则，然后决定下一条 Workflow path。([AWS Documentation][4])

---

### Review

Review 的核心不是“做一个 Task”。

它的核心是：

> **把一个需要责任主体承担的判断正式交给人或被授权的决策主体。**

例如：

```text
Investment Committee Review
Compliance Review
Proxy Voting Review
Trade Approval
Exception Approval
Risk Override Review
```

一个 Review 应该具有明确的：

```text
Reviewer
Decision
Context
Evidence
Timestamp
Reason
```

而不是简单：

```text
Approve / Reject
```

AWS Agentic AI Lens 对 Human-in-the-loop 的描述非常接近这一原则：高风险操作应该暂停并等待人工 review，同时记录 reviewer identity、timestamp，并提供足够上下文；同时避免所有操作都进入人工审批，否则会产生 rubber-stamp approval。([AWS Documentation][5])

Microsoft Durable Task 对 Approval Workflow 的实现也是同样结构：

```text
Workflow
   ↓
Notify Approver
   ↓
Wait for External Event
   ↓
Approve / Reject
   ↓
Continue / Stop
```

并且支持 timeout 和 workflow status。([Microsoft Learn][6])

---

### Command

Command 是四种 Node 中最特殊的一类。

它表示：

> **对业务系统发出一个明确、受权限约束、具有业务副作用的操作请求。**

例如：

```text
SubmitProxyVote
ApproveTrade
ReleasePayment
PlaceOrder
ChangePosition
CreateClientInstruction
PublishResearch
ChangeInvestmentRestriction
```

Command 的特点是：

```text
Command
   ↓
Business State Change
```

例如：

```text
TradeProposal
      ↓
Approval
      ↓
ApproveTrade
      ↓
Trade.status = APPROVED
```

这里：

```text
ApproveTrade
```

不是普通 Task。

因为它真正改变了 Business State。

---

# 3. Task 与 Command 为什么必须分开

这是整个模型最重要的一条边界。

很多 Workflow Engine 会把两者都表示成：

```text
Task
```

例如 AWS Step Functions 的 Task state，本质上就是执行一个 unit of work，可以调用 Lambda、AWS API 或其他服务。([AWS Documentation][2])

技术上没有问题。

但在**企业业务架构层**，最好不要因此把两者混为一谈。

因为：

```text
CalculateTradeRisk
```

和：

```text
ExecuteTrade
```

虽然都可以实现成 API call，但风险完全不同。

前者：

```text
Input
 ↓
Calculation
 ↓
Risk Score
```

后者：

```text
Input
 ↓
Authorization
 ↓
Policy
 ↓
Execution
 ↓
External Side Effect
```

因此建议：

```text
Task
    = computation / retrieval / transformation / proposal

Command
    = authorized business state transition
```

这会带来一个非常重要的架构边界：

```text
Agent
   │
   ├── Task
   │    ├── Search
   │    ├── Analyze
   │    ├── Summarize
   │    └── Propose
   │
   ├── Gate
   │    └── Policy / Rule
   │
   ├── Review
   │    └── Human decision
   │
   └── Command
        ↓
      Policy
        ↓
   Authorization
        ↓
    Business API
```

而不是：

```text
Agent
  ↓
Tool
  ↓
Anything
```

---

# 4. Gate 不应该等同于 Agent Decision

这是 Agent Workflow 最容易犯的错误之一。

例如：

```text
Agent:
"根据目前的信息，我认为这笔交易风险较低。"
```

不能直接变成：

```text
Gate:
risk = LOW
→ Continue
```

因为这里实际上把：

```text
Probabilistic inference
```

当成了：

```text
Authoritative policy decision
```

这两个东西应该分开。

更合理的是：

```text
Agent Task
   ↓
Risk Assessment Proposal
   ↓
Gate
   ↓
Deterministic Policy
   ↓
LOW / HIGH / REVIEW_REQUIRED
```

例如：

```text
Agent:
estimated_risk = LOW

Gate:
if restricted_security == true
    → Review

else if transaction_amount > approval_limit
    → Review

else if sanctions_hit == true
    → Stop

else
    → Continue
```

Agent 可以提供：

```text
risk_assessment
reasoning
evidence
recommendation
```

但 Gate 应该依据：

```text
policy
authorization
entitlement
threshold
regulation
business state
```

来决定 Workflow 是否继续。

AWS 当前 Agentic AI Lens 也明确区分了 deterministic enforcement 和 probabilistic controls，并建议 risk classification 使用确定性机制，高风险操作进入 human review。([AWS Documentation][7])

---

# 5. Review 也不能只是一个 UI 页面

另一个常见错误是：

```text
Agent Proposal
     ↓
Approval Page
     ↓
User clicks Approve
```

然后把这个页面叫：

```text
Human Review
```

从架构上看还不够。

真正的 Review 应该是一个**Workflow State**。

例如：

```text
                    ┌──────────────┐
                    │ Agent Task   │
                    │ Create       │
                    │ Proposal     │
                    └──────┬───────┘
                           ↓
                    ┌──────────────┐
                    │    Gate      │
                    │ Approval     │
                    │ required?    │
                    └──────┬───────┘
                           ↓
                    ┌──────────────┐
                    │   Review     │
                    │              │
                    │ reviewer     │
                    │ context      │
                    │ evidence     │
                    │ decision     │
                    │ timestamp    │
                    └──────┬───────┘
                           ↓
                     Approved?
                      /       \
                    No         Yes
                    ↓           ↓
                  Stop       Command
```

Review 本身应该留下：

```text
review_id
reviewer
decision
decision_time
decision_reason
input_version
evidence_version
policy_version
```

这样未来才能回答：

> 谁批准的？

> 当时看到了什么？

> 批准的是哪个版本？

> 当时使用的 Policy 是什么？

> Agent 提出了什么？

> 最终真正执行了什么？

这与金融行业强调的 accountability、controls、approvals 和 segregation of duties 是一致的。BCBS 对控制环境明确提到 required approvals、appropriate management accountability，以及对 overrides / exceptions / deviations 的跟踪。([Bank for International Settlements][8])

---

# 6. Review ≠ Gate

两者非常容易混淆。

最简单的区分：

> **Gate 是系统判断。Review 是责任主体决定。**

例如：

### Gate

```text
Transaction Amount > $1M?
```

结果：

```text
YES
```

这是 Gate。

---

### Review

```text
Investment Committee:
Approve / Reject
```

这是 Review。

---

组合起来：

```text
Transaction
     ↓
Gate
amount > $1M?
     │
     ├── No → Continue
     │
     └── Yes
          ↓
       Review
          ↓
    ┌─────┴─────┐
    ↓           ↓
 Approved     Rejected
    ↓           ↓
 Command      Stop
```

因此：

```text
Gate = eligibility / routing
Review = accountability / decision
```

这是一个非常值得在 Workflow DSL 中直接体现的区别。

---

# 7. Gate 与 Business Rule Task 的关系

这也是为什么不应该简单地认为：

```text
Gate = Gateway
```

实际上至少存在两种东西。

### Routing Gate

例如：

```text
amount > 1M
```

它只是决定路径。

对应 BPMN / Step Functions：

```text
Gateway
Choice
```

---

### Decision Gate

例如：

```text
DetermineApprovalLevel
DetermineRiskTier
DetermineEntitlement
DetermineRequiredControls
```

这里可能需要执行一套正式 Business Rule。

例如：

```text
Transaction
    ↓
Determine Approval Level
    ↓
ApprovalLevel = IC
    ↓
Review
```

这更接近：

```text
Business Rule Task
        ↓
Decision
        ↓
Gateway
```

Camunda 对 Business Rule Task 的定义就是评估 Business Rule，例如 DMN Decision；Decision 结束后流程继续。([Camunda 8 Docs][9])

所以在实际 Workflow DSL 中，我更建议把：

```text
Gate
```

作为一个**架构语义类别**，底层可以实现成：

```text
Gateway
Business Rule
Policy Engine
Authorization Check
Entitlement Check
Risk Classification
```

而不需要把每一种技术实现都暴露给业务流程设计者。

---

# 8. Agent 在四种 Node 中到底应该放在哪里

这是 Agentic Workflow 和传统 Workflow 最大的不同。

不应该：

```text
Agent = Workflow Node
```

而应该：

```text
Agent = 一种可能被 Task / Review / Decision 调用的执行能力
```

例如：

```text
Workflow
│
├── Task
│    └── Agent Analysis
│
├── Gate
│    └── Policy Engine
│
├── Review
│    └── Human
│
└── Command
     └── Business API
```

Agent 可以在 Task 中做：

```text
Search
Analyze
Reason
Summarize
Generate Proposal
```

也可以帮助 Review：

```text
Reviewer
   ↓
Agent prepares:
   - summary
   - evidence
   - exceptions
   - recommendation
```

但 Agent 不应该因为：

```text
"I think this is safe"
```

而绕过：

```text
Gate
Review
Authorization
Command
```

AWS 对 Agentic AI 的建议也强调 Agent 应该执行 atomic tasks，并把不同风险等级的操作路由到不同的人类监督等级。([AWS Documentation][10])

---

# 9. 一个金融服务例子：Proxy Voting

这个模型在 Proxy Voting 中非常容易看清楚。

假设业务要求：

> 根据公司政策和 ISS 数据形成 Proxy Vote Proposal，由授权人员审核后提交投票。

可以设计成：

```text
┌──────────────────────────┐
│ Task                     │
│ Retrieve ISS Proposal    │
└────────────┬─────────────┘
             ↓
┌──────────────────────────┐
│ Task                     │
│ Analyze Policy / Research │
│ Agent-assisted           │
└────────────┬─────────────┘
             ↓
┌──────────────────────────┐
│ Task                     │
│ Generate Vote Proposal   │
└────────────┬─────────────┘
             ↓
┌──────────────────────────┐
│ Gate                     │
│ Is approval required?    │
└────────────┬─────────────┘
             ↓
┌──────────────────────────┐
│ Review                   │
│ Authorized Reviewer      │
│ Approve / Reject / Edit  │
└────────────┬─────────────┘
             ↓
┌──────────────────────────┐
│ Gate                     │
│ Entitlement / Deadline   │
│ / Policy / Authorization │
└────────────┬─────────────┘
             ↓
┌──────────────────────────┐
│ Command                  │
│ SubmitProxyVote          │
└──────────────────────────┘
```

这里有一个很重要的设计：

**Agent 产生的是 Vote Proposal，不是 Vote。**

```text
Agent
  ↓
VoteProposal
```

而：

```text
SubmitProxyVote
```

是 Command。

这样：

```text
Agent Proposal
      ≠
Business Decision
      ≠
Business Command
```

三个东西不会混在一起。

---

# 10. 一个交易审批例子

同样的思想可以用于 Trade Workflow：

```text
Client Instruction
       ↓
Task: Validate Data
       ↓
Task: Agent Analysis
       ↓
Task: Generate Trade Proposal
       ↓
Gate: Restricted Security?
       │
       ├── Yes → Review
       │
       └── No
             ↓
        Gate: Amount Limit?
             │
             ├── Exceeded → Review
             │
             └── OK
                  ↓
              Command
            ExecuteTrade
```

这里 Agent 可以非常强：

```text
Research
Portfolio Analysis
Risk Explanation
Alternative Generation
Scenario Analysis
```

但它不能直接变成：

```text
Agent
 ↓
ExecuteTrade()
```

因为：

```text
Proposal
Decision
Command
```

分别属于三个不同的控制层次。

---

# 11. 四类 Node 应该有不同的失败语义

这是一个经常被忽略的问题。

如果所有东西都叫 Task，那么失败基本都是：

```text
Task failed
```

但四类节点的失败含义完全不同。

| Node    | Failure 含义      |
| ------- | --------------- |
| Task    | 工作没有完成          |
| Gate    | 不满足继续条件         |
| Review  | 人拒绝 / 超时 / 无法决定 |
| Command | 业务操作没有成功        |

例如：

```text
Task failed
```

可能需要：

```text
Retry
```

但：

```text
Gate failed
```

通常不能 Retry。

例如：

```text
Amount > Limit
```

你 Retry 100 次也不会改变结果。

而：

```text
Review timeout
```

可能需要：

```text
Escalate
Notify
Reassign
Expire
```

而：

```text
Command failed
```

则需要考虑：

```text
Retry
Idempotency
Compensation
Reconciliation
Manual intervention
```

这就是为什么 Command 应该被单独建模。

---

# 12. Command 必须具有明确的业务语义

不建议：

```text
Command:
POST /api/xxx
```

而应该：

```text
Command:
ApproveTrade
SubmitProxyVote
ReleasePayment
PublishResearch
```

因为 Workflow 应该表达：

> **Business Intent**

而不是：

> HTTP implementation detail。

例如：

```text
SubmitProxyVote
```

内部可以实现成：

```text
POST /iss/vote
```

以后也可以改成：

```text
POST /internal/proxy-voting
```

Workflow 不应该因此改变。

这也让 Command 成为一个天然的 Policy Enforcement Point：

```text
SubmitProxyVote
      ↓
Authorization
      ↓
Entitlement
      ↓
Policy
      ↓
Idempotency
      ↓
Audit
      ↓
ISS API
```

---

# 13. Command 是 Business State Transition

可以把 Command 定义得更严格一些：

> **Command 是请求一个受授权的 Business State Transition。**

例如：

```text
Trade:
PROPOSED
   ↓
Approved
```

Command：

```text
ApproveTrade
```

再比如：

```text
ProxyVote:
DRAFT
   ↓
SUBMITTED
```

Command：

```text
SubmitProxyVote
```

这样 Workflow 和 Domain Model 就可以很好地连接起来：

```text
Workflow
   │
   │ invokes
   ↓
Command
   │
   │ changes
   ↓
Business Aggregate
   │
   ↓
Business State
```

这比：

```text
Workflow
   ↓
API Call
```

更加适合金融服务领域。

---

# 14. 一个推荐的完整 Node 模型

最终可以把 Workflow Node 定义成：

```text
                    Workflow Node
                          │
          ┌───────────────┼────────────────┐
          │               │                │
        Work            Control         Decision
          │               │                │
          ↓               ↓                ↓
        Task             Gate            Review
          │
          │
          ↓
      Command
```

但从语义上，我更建议直接采用：

```text
                    ┌───────────────┐
                    │ Workflow Node │
                    └───────┬───────┘
                            │
        ┌───────────────────┼───────────────────┐
        ↓                   ↓                   ↓
      Work                Control            Decision
        │                   │                   │
        ↓                   ↓                   ↓
      Task                Gate                Review
        │
        ↓
     Command
```

其中：

### Task

**Produce something.**

```text
Data
Analysis
Transformation
Retrieval
Calculation
Proposal
```

### Gate

**Allow or block progression.**

```text
Policy
Eligibility
Authorization
Entitlement
Threshold
Risk classification
```

### Review

**Create accountable human decision.**

```text
Approve
Reject
Amend
Escalate
Override
```

### Command

**Change business state.**

```text
Execute
Submit
Approve
Release
Publish
Create
Cancel
```

---

# 15. 四类 Node 的设计 Contract

建议 Workflow Engine 不只是保存：

```text
type
input
output
next
```

而是让四类 Node 有不同 Contract。

## Task

```yaml
type: task

input:
  - ...

output:
  - ...

execution:
  retryable: true
  timeout: 5m

audit:
  record: true
```

---

## Gate

```yaml
type: gate

condition:
  policy: trade-approval-v3

on:
  pass: next-step
  fail: review

audit:
  record: true
```

Gate 应该尽可能：

```text
deterministic
versioned
testable
explainable
```

---

## Review

```yaml
type: review

reviewer:
  role: investment-manager

decision:
  - approve
  - reject
  - amend

timeout: 24h

escalation:
  role: team-lead

audit:
  required: true
```

---

## Command

```yaml
type: command

command:
  name: SubmitProxyVote

authorization:
  required: true

policy:
  required: true

idempotency:
  required: true

audit:
  required: true
```

这四种 Contract 比单纯：

```yaml
type: task
```

能够表达更多真正重要的业务约束。

---

# 16. 为什么金融服务尤其需要这种划分

金融业务和普通 SaaS Workflow 最大的不同之一，是很多 Workflow 不只是：

> 把事情自动做完。

而是必须回答：

```text
Who authorized it?
What was decided?
Under which policy?
Based on which data?
What did the system actually execute?
Who could override it?
What happened if the system failed?
```

BCBS 的 Operational Risk / Operational Resilience 原则明确要求银行建立能够识别、评估、监控、报告和控制 operational risk 的机制，同时强调 controls、accountability、approvals 和 change management。([Bank for International Settlements][3])

因此：

```text
Task
```

解决：

> 工作怎么完成？

```text
Gate
```

解决：

> 什么情况下允许继续？

```text
Review
```

解决：

> 谁承担决定责任？

```text
Command
```

解决：

> 最终到底执行了什么？

这四个问题正好对应金融 Workflow 最核心的四个控制面。

---

# 17. 不要把所有东西都塞进 Agent

一个成熟的 Agentic Workflow 应该是：

```text
                Workflow
                    │
        ┌───────────┼───────────┐
        ↓           ↓           ↓
       Task        Gate       Review
        │           │           │
        │           │           │
      Agent       Policy       Human
        │           │           │
        └───────────┼───────────┘
                    ↓
                 Command
                    ↓
             Business System
```

而不是：

```text
             Agent
               │
        ┌──────┼──────┐
        ↓      ↓      ↓
      Search  Decide Execute
```

后者的问题是 Agent 同时拥有：

```text
Reasoning
Decision
Authorization
Execution
```

这实际上把：

```text
Control Plane
+
Decision Plane
+
Execution Plane
```

全部塞进了一个 probabilistic runtime。

对于金融服务，这是非常不理想的边界。

AWS Agentic AI Lens 也把 deterministic enforcement、policy engine、IAM、schema validation 与 probabilistic agent controls 区分开来，并强调高风险操作应该在执行前进入适当的人类监督。([AWS Documentation][7])

---

# 18. Workflow Engine 应该拥有这些 Node，Agent Runtime 不应该拥有

这也直接回答一个更大的架构问题：

> **为什么 Agent Runtime 不应该自己维护 Workflow State Machine？**

因为 Workflow Engine 需要理解：

```text
Task
Gate
Review
Command
```

以及：

```text
Timeout
Retry
Escalation
Compensation
Authorization
Audit
Business State
```

而 Agent Runtime 更适合理解：

```text
Prompt
Context
Tool
Memory
Reasoning
Plan
Iteration
```

两者应该是：

```text
┌─────────────────────────────────────────┐
│            Workflow / Control Plane     │
│                                         │
│ Task → Gate → Review → Command          │
│  │      │       │        │              │
│ State  Policy  Human  Authorization     │
│ Audit  Routing Decision Business State  │
└───────────────┬─────────────────────────┘
                │
                │ invokes
                ↓
┌─────────────────────────────────────────┐
│              Agent Runtime              │
│                                         │
│ Reason → Tool → Observe → Reason → ...  │
└─────────────────────────────────────────┘
```

Agent Runtime 可以成为：

```text
Task 的 execution engine
```

但不应该成为：

```text
Business Workflow 的 source of truth
```

---

# 19. 与 BPMN 的关系：不是替代，而是提高业务语义层

这套模型并不是反 BPMN。

实际上可以看成：

| 本文模型     | BPMN 常见对应                                         |
| -------- | ------------------------------------------------- |
| Task     | Service Task / Script Task / Business Rule Task 等 |
| Gate     | Gateway / Business Rule                           |
| Review   | User Task                                         |
| Command  | Service Task + 明确的 Domain Command                 |
| Wait     | Event / Timer                                     |
| Workflow | Process                                           |

因此：

```text
BPMN
```

依然可以作为底层表达语言。

但业务架构层不要直接暴露全部 BPMN primitive。

可以定义一个更简单的：

```text
Enterprise Workflow Model
```

然后映射到底层：

```text
Task
  → Service Task

Gate
  → Gateway / DMN / Policy Engine

Review
  → User Task

Command
  → Domain Command / API
```

这会比直接让业务团队面对几十种 BPMN element 更容易控制。

---

# 20. 为什么不应该只有 Task / Gate / Review 三种

有一种设计可能会说：

> Command 其实就是一种 Task，为什么要单独拆？

从 Workflow Engine 的实现角度，这个观点完全合理。

但从 **Enterprise Architecture / Governance** 角度，我仍然建议把 Command 单独暴露。

原因是它代表一个非常重要的安全边界：

```text
Task:
"我计算出了什么"

Command:
"我要改变什么"
```

这两个问题应该分别审计。

例如：

```text
Agent Task
GenerateTradeProposal
```

可以：

```text
retry
rerun
compare
evaluate
```

而：

```text
Command
ExecuteTrade
```

则需要：

```text
authorization
policy
idempotency
audit
reconciliation
```

所以：

> **Command 可以在底层实现成 Task，但不应该在业务架构语义上被隐藏成 Task。**

这是整个设计中非常关键的一点。

---

# 21. 一个更完整的 Workflow 生命周期

最终可以形成这样的结构：

```text
                  ┌─────────────┐
                  │   Trigger   │
                  └──────┬──────┘
                         ↓
                  ┌─────────────┐
                  │    Task     │
                  │ Analyze     │
                  │ Retrieve    │
                  │ Propose     │
                  └──────┬──────┘
                         ↓
                  ┌─────────────┐
                  │    Gate     │
                  │ Policy      │
                  │ Entitlement │
                  │ Threshold   │
                  └──────┬──────┘
                         ↓
              ┌──────────┴──────────┐
              │                     │
           No Review              Review
              │                     │
              │               ┌─────┴─────┐
              │               │           │
              │             Reject      Approve
              │               │           │
              │               ↓           ↓
              │             Stop       Gate
              │                           │
              └───────────────────────────┤
                                          ↓
                                   ┌─────────────┐
                                   │  Command    │
                                   │ Execute     │
                                   └──────┬──────┘
                                          ↓
                                  Business State
                                          ↓
                                      Audit
```

这里有一个很重要的原则：

> **Gate 决定是否允许进入 Command；Review 决定责任主体是否批准；Command 才真正改变 Business State。**

---

# 22. 推荐的架构原则

可以把整个文档最后浓缩成下面 10 条设计原则。

### Principle 1

**Task 是工作，不是决策。**

---

### Principle 2

**Gate 是控制，不是推理。**

---

### Principle 3

**Review 是责任主体的决定，不是 UI 页面。**

---

### Principle 4

**Command 是 Business State Transition，不是普通 API Call。**

---

### Principle 5

**Agent 可以产生 Proposal，但 Proposal 不等于 Decision。**

---

### Principle 6

**Decision 不等于 Authorization。**

即使：

```text
Agent recommends APPROVE
```

也不代表：

```text
system is authorized to execute
```

---

### Principle 7

**所有高风险 Command 都必须经过明确的 Policy / Authorization Boundary。**

---

### Principle 8

**Workflow State 应由 Workflow Engine 持有，而不是 Agent Memory。**

---

### Principle 9

**Human Review 应该 risk-tiered，而不是所有操作一律审批。**

AWS 对这一点尤其明确：全部人工审批会造成 reviewer fatigue 和 rubber-stamping，而完全没有人工审批则可能让高风险操作失去监督。([AWS Documentation][5])

---

### Principle 10

**Audit 应记录 Business Decision 和 Command，而不只是 Agent Trace。**

Agent Trace 可以告诉我们：

```text
Agent thought / tool call / model output
```

但金融审计真正需要的还包括：

```text
Policy version
Authorization
Reviewer
Decision
Command
Business State Change
```

---

# 23. 最终推荐模型

如果这是一个企业级、尤其是金融服务领域的 Agent Workflow 平台，我建议最终把 Workflow Node vocabulary 收敛为：

```text
                    Enterprise Workflow
                           │
       ┌───────────────────┼───────────────────┐
       │                   │                   │
       ↓                   ↓                   ↓
     Task                Gate               Review
       │                   │                   │
       │                   │                   │
  Do the work        Can we continue?    Who decides?
       │                   │                   │
       └───────────────────┼───────────────────┘
                           ↓
                       Command
                           │
                    Change business state
                           │
                           ↓
                    Business System
```

然后规定：

```text
Agent
  ├── may execute Task
  ├── may produce Proposal
  ├── may provide Review assistance
  ├── may NOT redefine Gate
  ├── may NOT grant Authorization
  └── may NOT directly bypass Command controls
```

这实际上形成了一个非常清晰的控制链：

```text
        Agent
          ↓
      Proposal
          ↓
        Gate
          ↓
       Review
          ↓
     Authorization
          ↓
       Command
          ↓
   Business State
```

这比“Agent 可以调用哪些 Tools”更接近金融企业真正需要解决的问题。

---

## 参考资料与进一步阅读

### AWS / Agentic AI

* [AWS Well-Architected Agentic AI Lens — Human-in-the-loop for critical decisions](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentsec04-bp02.html?utm_source=chatgpt.com) — 风险分级审批、审批上下文、超时、升级和审计。
* [AWS Agentic AI Lens — Agent goal alignment and manipulation prevention](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentsec04.html?utm_source=chatgpt.com) — deterministic enforcement、policy、authorization 与 probabilistic controls 的分层。
* [AWS Step Functions — Workflow states](https://docs.aws.amazon.com/step-functions/latest/dg/workflow-states.html?utm_source=chatgpt.com) — Task、Choice、Parallel、Map、Wait、Succeed、Fail 的基础状态模型。
* [AWS Step Functions — Choice state](https://docs.aws.amazon.com/step-functions/latest/dg/state-choice.html?utm_source=chatgpt.com) — Workflow 中确定性分支判断。
* [AWS Step Functions — Human approval workflow](https://docs.aws.amazon.com/step-functions/latest/dg/tutorial-human-approval.html?utm_source=chatgpt.com) — 使用 callback/task token 实现异步人工审批。

### Microsoft

* [Microsoft Durable Task — Human interaction pattern](https://learn.microsoft.com/en-us/azure/durable-task/common/durable-task-human-interaction?source=recommendations&utm_source=chatgpt.com) — Approval、timeout、external event、workflow status。
* [Microsoft Durable Functions — Human interaction pattern](https://learn.microsoft.com/en-us/azure/durable-task/common/durable-task-human-interaction?utm_source=chatgpt.com) — 人工审批作为 durable workflow state 的实现模式。

### Camunda / BPMN

* [Camunda 8 — Tasks overview](https://docs.camunda.io/docs/components/modeler/bpmn/tasks/?utm_source=chatgpt.com) — Task 作为 workflow 中的 atomic unit of work。
* [Camunda 8 — User Tasks](https://docs.camunda.io/docs/components/modeler/bpmn/user-tasks/?utm_source=chatgpt.com) — 人工任务、assignment、scheduling、HITL。
* [Camunda 8 — Business Rule Tasks](https://docs.camunda.io/docs/components/modeler/bpmn/business-rule-tasks/?utm_source=chatgpt.com) — Business Rule / DMN 与 Workflow 的结合。

### 金融服务 / 金融监管框架

* [Basel Committee — Operational resilience](https://www.bis.org/committees/bcbs/basel-consolidated-guidelines/module/orr/20?utm_source=chatgpt.com) — Governance、operational risk、controls、critical operations、change management。
* [Basel Committee — Core Principles, Principle 25: Operational risk and operational resilience](https://www.bis.org/committees/bcbs/basel-framework/standard/bcp/40/inforce/2024-04-25/published/2024-04-25?utm_source=chatgpt.com) — 银行 operational risk / resilience 的治理和控制要求。
* [Basel Committee — Revisions to the Principles for the Sound Management of Operational Risk](https://www.bis.org/bcbs/publ/d515.pdf?utm_source=chatgpt.com) — approvals、accountability、policy exceptions、management overrides 等控制要求。
* [Bank of England — AI and Machine Learning discussion paper](https://www.bankofengland.co.uk/prudential-regulation/publication/2022/october/artificial-intelligence?utm_source=chatgpt.com) — AI 决策中的 human oversight、automation bias 和“有意义的人类介入”问题。

### OpenAI

* [OpenAI Agents SDK — Guardrails](https://openai.github.io/openai-agents-js/guides/guardrails/?utm_source=chatgpt.com) — Input、Output、Tool guardrails 以及不同 workflow boundary 的控制方式。

---

**一句话总结：**

> **Task 负责“做”，Gate 负责“放不放行”，Review 负责“谁来决定”，Command 负责“真正改变业务世界”。**
>
> 对 Agentic Workflow 来说，最重要的不是让 Agent 变得更像 Workflow Engine，而是让 Agent 的能力被放进这四个边界里，并且让 **Proposal → Decision → Authorization → Command** 始终保持可区分、可审计、可控制。

[1]: https://docs.camunda.io/docs/components/modeler/bpmn/tasks/?utm_source=chatgpt.com "Overview | Camunda 8 Docs"
[2]: https://docs.aws.amazon.com/step-functions/latest/dg/workflow-states.html?utm_source=chatgpt.com "Discovering workflow states to use in Step Functions - AWS Step Functions"
[3]: https://www.bis.org/committees/bcbs/basel-consolidated-guidelines/module/orr/20?utm_source=chatgpt.com "Operational resilience | Bank for International Settlements"
[4]: https://docs.aws.amazon.com/step-functions/latest/dg/state-choice.html?utm_source=chatgpt.com "Choice workflow state - AWS Step Functions"
[5]: https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentsec04-bp02.html?utm_source=chatgpt.com "AGENTSEC04-BP02 Human-in-the-loop for critical decisions - Agentic AI Lens"
[6]: https://learn.microsoft.com/en-us/azure/durable-task/common/durable-task-human-interaction?utm_source=chatgpt.com "Human Interaction Pattern | Microsoft Learn"
[7]: https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentsec04.html?utm_source=chatgpt.com "Agent goal alignment and manipulation prevention - Agentic AI Lens"
[8]: https://www.bis.org/committees/bcbs/basel-consolidated-guidelines/module/orr/10?utm_source=chatgpt.com "Operational risk | Bank for International Settlements"
[9]: https://docs.camunda.io/docs/components/modeler/bpmn/business-rule-tasks/?utm_source=chatgpt.com "Business rule tasks | Camunda 8 Docs"
[10]: https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentrel02.html?utm_source=chatgpt.com "Predictable task execution - Agentic AI Lens"

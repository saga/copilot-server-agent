# Human Task、Approval、Review 的统一建模

## 一、问题：为什么 Human Task、Approval、Review 总是越做越乱？

在传统 Workflow 系统中，常见的业务动作包括：

```text
填写信息
人工处理
Review
Approval
Reject
确认
复核
异常处理
升级
```

到了 AI Agent Workflow 中，名字更多了：

```text
Human-in-the-loop
Human Task
Approval
Review
Validation
Confirmation
Feedback
Escalation
Handoff
```

很容易出现一种系统设计：

```text
HumanTask
ApprovalTask
ReviewTask
ValidationTask
ConfirmationTask
```

每一种都建立自己的：

```text
Table
API
State Machine
UI
Assignment
Notification
Audit
```

最后得到：

```text
Human Task System
      +
Approval System
      +
Review System
      +
Agent HITL System
```

四套系统。

这通常不是一个好结果。

因为从 Workflow Runtime 的角度看，它们有大量共同属性：

```text
需要谁处理？
什么时候产生？
处理什么对象？
给处理人什么上下文？
可以做什么？
结果是什么？
什么时候完成？
超时怎么办？
没人处理怎么办？
谁最终提交？
如何审计？
```

真正不同的，是：

> **这个 Human Interaction 对业务流程产生什么语义。**

这也是目前主流 Workflow / Agent 平台比较一致的方向。

Camunda 将 User Task 定义为“由人完成、由 Workflow Engine / Application 辅助执行的工作”，User Task 可以有 Form、Assignment、Lifecycle、Task Listener 等能力，并明确把 AI Agent 触发的 human review / approval 作为 User Task 的典型用途。

Microsoft Agent Framework 则从更底层提供通用的 Request/Response 机制：Workflow 可以暂停、向外部系统提出一个请求、等待响应，然后继续执行；Tool Approval 只是这种机制的一种应用，要求用户提供信息或进行多轮交互则属于其他 Request / Handoff 场景。

AWS Step Functions 同样没有建立一个特殊的“Approval Runtime”。它提供的是通用的 Callback / Task Token：Workflow 暂停，等待外部参与者完成任务后再恢复；Human Approval 只是其中一种典型用法。

因此，一个更合理的方向是：

> **Human Task 是 Runtime Primitive，Approval 和 Review 是业务语义。**

---

# 二、先给结论：统一什么，不统一什么？

推荐采用四层模型：

```text id="2wo0ib"
Human Task
    ↓
Interaction Contract
    ↓
Decision / Completion Semantics
    ↓
Workflow / Authorization Effect
```

也可以简单理解成：

```text id="7wj4cy"
Human Task
= 谁来做什么

Review
= 人需要对什么进行判断

Approval
= 判断结果是否具有授权/放行语义

Workflow Transition
= 这个结果会不会改变流程状态

Authorization
= 这个人是否有权做这个决定
```

因此：

> **Review 和 Approval 不应该成为完全独立于 Human Task 的基础运行时对象。**

但也不能反过来：

> 把 Approval 和 Review 简化成 Human Task 上的一个 `type` 字段。

因为 Approval 和 Review 的业务语义差异很大。

更好的统一模型应该把：

```text
Task
```

和：

```text
Decision Semantics
```

分开。

---

# 三、Human Task 到底是什么？

最基础的定义可以是：

> **Human Task 是 Workflow 为一个具有明确责任边界的人类工作而创建的可追踪、可分配、可恢复的工作实例。**

IBM 对 Human Task 的定义也非常接近这一层：Human Task 是一个需要人参与的工作单元，可以用于人工异常处理、审批，以及多人协作。

Camunda 则将 User Task 建模为：

```text
Process arrives
    ↓
User Task created
    ↓
Process waits
    ↓
Human completes task
    ↓
Process continues
```

同时支持 Assignment、Form、Lifecycle、Listener 等机制。

所以 Human Task 本身应该解决：

```text
Assignment
Lifecycle
Context
Input
Output
SLA
Escalation
Timeout
Persistence
Audit
Resume
```

而不负责解释：

> 为什么这个人正在做这件事？

这个由上层业务语义解决。

---

# 四、Approval 是什么？

Approval 的核心不是：

> 有一个人做了一个 Task。

而是：

> **某个具有相应 Authority 的主体，对某个明确范围的 Proposed Action / Business Decision 表达授权性决定。**

例如：

```text id="y41a8p"
Proposal
    ↓
Human Checker
    ↓
Approve
```

这里真正重要的是：

```text
Approve
```

具有什么意义。

例如：

```text
Approve
→ allow workflow transition

Approve
→ authorize command

Approve
→ accept document

Approve
→ release payment
```

因此：

> Approval 是一种 **Decision Semantic**。

它通常具有：

```text
Approved
Rejected
```

这样的 completion outcome。

IBM 的 Approval Task 也是这样建模的：它和 User Action 类似，但完成动作被专门限定为 Approve / Reject，并把结果映射为成功 / 失败。

Power Automate 的 Approval 也是一个围绕“请求、审查、批准/拒绝、后续动作”设计的 Workflow 能力。

但要特别注意：

> **Approval 的业务语义不等于系统 Authorization。**

例如：

```text
Human Approves
    ≠
System Authorization Automatically Granted
```

这个区别对于金融 Agent 尤其重要。

---

# 五、Review 又是什么？

Review 比 Approval 更宽泛。

Review 的核心是：

> **对某个对象、Proposal、结果或者证据进行检查、评价、提出意见或形成建议。**

它可能产生：

```text
Accept
Reject
Comment
Findings
Score
Recommendation
Request Changes
Need More Evidence
```

而不一定产生：

```text
Authorization
```

例如：

```text id="t1fscn"
Agent
  ↓
生成 Investment Idea
  ↓
Human Review
  ↓
发现两个风险
  ↓
提出修改建议
```

此时 Review 已经完成，但没有：

```text
Approve
```

也不应该改变：

```text
APPROVED
```

因此：

> **Review 是一种评价 / 检查语义，而 Approval 是一种授权 / 放行语义。**

二者可能重叠，但不能当成同义词。

IBM 的 Workflow 设计甚至明确区分了 Review Step 与 Approval Step：Review 可以与 Approval 并行进行，并不阻塞最终 Approval。

这非常值得借鉴。

---

# 六、Review 不一定阻塞 Workflow

这是统一建模时最容易犯的错误。

如果把：

```text
Review
```

统一理解成：

```text
Workflow must pause
```

那么就把 Review 的语义做窄了。

实际上可能存在：

```text
Case
 ├── Review A
 ├── Review B
 └── Main Workflow
```

Review A / Review B 可以：

```text
并行
异步
事后
抽样
持续
```

甚至：

```text
Review complete
```

并不意味着：

```text
Workflow can continue
```

IBM 的 Workflow 产品就有这种明确的模型：Review Task 可以并行存在，而 Approval 是决定流程是否继续的控制点。

因此：

> **Task Completion 与 Workflow Advancement 不能是同一个概念。**

---

# 七、这是统一建模最重要的一层：Task Completion ≠ Workflow Transition

例如：

```text id="p09j34"
Human Task
    ↓
Completed
```

并不自动意味着：

```text
Workflow
    ↓
Next State
```

应该拆开：

```text
Human Task
    ↓
Completion Result
    ↓
Business Semantics
    ↓
Workflow Decision
    ↓
State Transition
```

例如：

```text
Review Task
    ↓
Completed
    ↓
Finding = MATERIAL_RISK
    ↓
Workflow routes to Exception
```

或者：

```text
Approval Task
    ↓
Approved
    ↓
Authorization requirement satisfied
    ↓
Workflow → APPROVED
```

这意味着：

> Human Task 是执行容器；Workflow Transition 是流程语义。

---

# 八、推荐的统一模型

最推荐的模型不是：

```text
HumanTask(type=APPROVAL)
HumanTask(type=REVIEW)
```

而是：

```text
HumanTask
├── Assignment
├── Lifecycle
├── Interaction
├── Decision
├── Completion
├── Workflow Effect
└── Governance
```

具体可以写成：

```text
HumanTask
{
  id

  caseId
  workflowId
  taskType

  assignee
  candidateUsers
  candidateGroups

  subject
  context
  evidence

  formSchema
  allowedActions

  decisionSchema
  completionPolicy

  workflowEffect
  authorizationRequirement

  dueAt
  timeoutPolicy
  escalationPolicy

  status
  outcome

  createdAt
  completedAt

  audit
}
```

然后：

```text
taskType:
  INPUT
  REVIEW
  APPROVAL
  DECISION
  ACKNOWLEDGEMENT
  EXCEPTION
  ESCALATION
```

但这里有一个重要设计原则：

> **taskType 主要用于表达业务语义，不应该决定整个 Runtime State Machine。**

Runtime 仍然统一处理：

```text
CREATED
ASSIGNED
IN_PROGRESS
WAITING
COMPLETED
CANCELLED
EXPIRED
ESCALATED
```

---

# 九、一个更重要的拆分：Task Type 与 Outcome Type

例如：

```text
Review Task
```

可能产生：

```text
FINDINGS
RECOMMENDATION
REQUEST_CHANGES
NO_ISSUE
```

而：

```text
Approval Task
```

可能产生：

```text
APPROVED
REJECTED
```

因此建议：

```text id="l4jkco"
Task Type
    ≠
Outcome Type
```

例如：

```json
{
  "taskType": "REVIEW",
  "outcome": {
    "type": "REQUEST_CHANGES",
    "findings": [...]
  }
}
```

或者：

```json
{
  "taskType": "APPROVAL",
  "outcome": {
    "type": "APPROVED"
  }
}
```

这比：

```json
{
  "status": "APPROVED"
}
```

更清楚。

---

# 十、再进一步：Outcome 也不能直接等于 Authority

例如：

```text
HumanTask outcome = APPROVED
```

还不能直接推出：

```text
Command can execute
```

应该：

```text
HumanTask
    ↓
APPROVED
    ↓
Check approval scope
    ↓
Check approver authority
    ↓
Check current policy
    ↓
Check business state
    ↓
Authorize command
    ↓
Execute
```

因此：

> **Approval 是一个业务决定；Authorization 是系统对于当前请求是否允许执行的决定。**

这两者一定要分开。

---

# 十一、为什么不应该设计三个独立 Runtime

一个很常见的早期设计是：

```text
ApprovalService
ReviewService
HumanTaskService
```

然后：

```text
Approval
    ↓
Approval API

Review
    ↓
Review API

Human Task
    ↓
Task API
```

问题在于它们很快开始重复：

```text
Assignment
Notification
SLA
Escalation
Identity
Task Inbox
Timeout
Audit
Comment
Attachment
Delegation
Reassignment
Reminder
```

最后：

```text
Approval
Review
HumanTask
```

三套状态。

甚至会出现：

```text
Approval.status
Task.status
Review.status
Workflow.status
```

然后问：

> 到底哪个状态是真的？

这正是应该避免的。

---

# 十二、真正应该统一的是 Runtime Lifecycle

建议所有 Human Interaction 都共用：

```text id="8swhg7"
CREATED
    ↓
ASSIGNED
    ↓
IN_PROGRESS
    ↓
WAITING
    ↓
COMPLETED
```

以及异常状态：

```text
CANCELLED
EXPIRED
ESCALATED
REASSIGNED
```

Camunda 当前的 User Task lifecycle 就体现了这种思想：Assignment 与 Task State 分离，任务可以被重新分配，同时支持 start、pause、resume、return 等应用级动作。

这一点很重要：

> **Assignment 不是 State。**

例如：

```text
Assigned to Bob
```

不意味着：

```text
Bob is working
```

同样：

```text
Assigned to Bob
```

也不意味着：

```text
Bob has approved
```

三个概念应该分离。

---

# 十三、推荐一个四维统一模型

可以把 Human Task 抽象成：

```text
              Human Task
                   │
      ┌────────────┼────────────┐
      │            │            │
  Work Context   Decision     Control
      │            │            │
   Who/What      Outcome     Workflow Effect
      │            │            │
      └────────────┼────────────┘
                   │
               Lifecycle
```

具体：

### Work Context

```text
case
subject
evidence
inputs
attachments
```

### Decision

```text
allowed actions
decision schema
outcome
reason
```

### Control

```text
required authority
SoD
approval policy
reviewer role
```

### Lifecycle

```text
assignment
status
SLA
timeout
escalation
completion
```

这四个维度组合起来，Review、Approval、Input、Exception 都能表达。

---

# 十四、Review 应该怎么建模？

建议：

```json
{
  "taskType": "REVIEW",

  "subject": {
    "type": "InvestmentIdea",
    "id": "INV-1024"
  },

  "reviewContract": {
    "criteria": [
      "thesis_supported",
      "risk_identified",
      "data_current"
    ],

    "allowedOutcomes": [
      "NO_ISSUE",
      "REQUEST_CHANGES",
      "ESCALATE"
    ]
  },

  "workflowEffect": {
    "blocking": true
  }
}
```

但也允许：

```json
{
  "workflowEffect": {
    "blocking": false
  }
}
```

此时：

> Review 完成只是产生一个 Review Result。

Workflow 可以：

```text
继续
等待
忽略
汇总
升级
```

---

# 十五、Approval 应该怎么建模？

Approval 应该有更强的语义：

```json
{
  "taskType": "APPROVAL",

  "subject": {
    "type": "ProxyVoteProposal",
    "id": "PV-1024"
  },

  "approvalContract": {
    "allowedOutcomes": [
      "APPROVED",
      "REJECTED"
    ],

    "scope": {
      "action": "SUBMIT_PROXY_VOTE",
      "resource": "ABC",
      "quantity": 125000
    }
  },

  "authorizationRequirement": {
    "role": "PortfolioManager",
    "independentOf": "maker"
  },

  "workflowEffect": {
    "approved": "CONTINUE",
    "rejected": "REJECT"
  }
}
```

这里很明显：

```text
Approval
```

不仅仅是：

```text
Task Type
```

它还有：

```text
Approval Scope
Authority Requirement
Decision Semantics
Workflow Effect
```

---

# 十六、Approval Scope 应该成为统一模型的一等字段

这和前面 Maker-Checker 文档直接相关。

不能只有：

```text
approved = true
```

而应有：

```text
approved = true

approvedObject
approvedAction
approvedParameters
approvedResource
approvedVersion
approvedBy
approvedAt
expiresAt
```

AWS 当前明确建议把 persistent approval / trust 绑定到具体 command、参数形状或 resource；没有范围约束的 wildcard approval 会把一个具体批准变成一整类未来操作的永久信任。

因此：

> Approval 是“对一个明确范围的决策”。

---

# 十七、Review Scope 也应该被明确

例如：

```text
Review
```

到底 review：

```text
Case
Proposal
Evidence
Agent Output
Transaction
Risk Assessment
```

需要明确。

尤其 Agent 场景中：

```text
Agent generated 100-page report
```

Reviewer 不能只看到：

```text
"Please review."
```

而应明确：

```text
Review Subject
Review Criteria
Evidence
Known Risks
Expected Outcome
Reviewer Authority
```

AWS 对 HITL 的要求也强调 reviewer 需要足够上下文，否则 review 很容易退化成形式审批。

---

# 十八、Input Task 也应该被统一进来

还有一类很容易被误认为 Review：

```text
“请填写缺少的客户信息。”
```

这其实不是 Review，也不是 Approval。

它是：

```text
Human Task
taskType = INPUT
```

例如：

```json
{
  "taskType": "INPUT",

  "inputSchema": {
    "fields": [
      {
        "name": "investmentThesis",
        "type": "text",
        "required": true
      }
    ]
  }
}
```

Microsoft Agent Framework 当前的 Request/Response 机制就明确支持这种“请求外部输入然后继续 Workflow”的模式，而不仅仅是 Approval。

Power Automate 的 Human-in-the-loop connector 也已经提供 Request for information：Workflow 向指定人请求输入，得到响应后，该响应可以进入后续步骤。

所以：

```text
Approval
Review
Input
```

应该是：

```text
Human Interaction Semantics
```

而不是：

```text
Three unrelated runtime systems
```

---

# 十九、Exception Task 也属于同一套模型

例如 Agent 发现：

```text
Policy Violation
```

不要创建：

```text
ExceptionApprovalService
```

可以直接：

```text
HumanTask
taskType = EXCEPTION
```

例如：

```json
{
  "taskType": "EXCEPTION",

  "subject": {
    "type": "Transaction",
    "id": "TX-991"
  },

  "exception": {
    "code": "LIMIT_EXCEEDED",
    "severity": "HIGH"
  },

  "allowedActions": [
    "RESOLVE",
    "OVERRIDE",
    "ESCALATE"
  ]
}
```

这样：

```text
Exception
Review
Approval
```

都能共用：

```text
Assignment
SLA
Escalation
Audit
UI
Notification
State
```

---

# 二十、Decision Task 也不等于 Approval

有时 Human 需要选择：

```text
Option A
Option B
Option C
```

例如：

```text
三个投资方案
```

这属于：

```text
DECISION
```

而不是：

```text
APPROVAL
```

因为：

> 人是在多个合法方案之间做选择，而不是决定一个 Proposal 是否获得授权。

可以建模：

```json
{
  "taskType": "DECISION",

  "decisionSchema": {
    "options": [
      "OPTION_A",
      "OPTION_B",
      "OPTION_C"
    ]
  }
}
```

结果：

```text
selected = OPTION_B
```

再由 Workflow 决定：

```text
OPTION_B
    ↓
next step
```

---

# 二十一、Confirmation 也不完全等于 Approval

例如：

> “我已经阅读并确认这个信息。”

这是：

```text
ACKNOWLEDGEMENT / CONFIRMATION
```

不一定意味着：

```text
Authorization
```

例如：

```text
User confirms:
"I understand the risk."
```

并不意味着：

```text
User authorizes:
"Execute trade."
```

因此：

```text
CONFIRM
≠
APPROVE
```

这在金融 UX 中尤其重要。

---

# 二十二、Review 与 Approval 可以在同一个 Human Task 中出现吗？

可以。

例如：

```text
Task:
Investment Committee Review & Approval
```

UI 可以同时展示：

```text
Evidence
Analysis
Comments
Approval decision
```

最终结果：

```text
APPROVED
```

但从语义上仍然应该区分：

```text
Review content
+
Approval decision
```

不要因为它们在同一个页面，就在 Domain Model 中合成：

```text
reviewStatus = APPROVED
```

更好的模型：

```text
HumanTask
    │
    ├── Review Findings
    │
    └── Approval Decision
```

这样未来可以支持：

```text
Review passed
Approval rejected
```

或者：

```text
Review requires changes
Approval not reached
```

不会把两个状态绑死。

---

# 二十三、Approval 与 Review 可能顺序执行，也可能并行

例如：

```text
         ┌── Risk Review ─────┐
Proposal ┤                    ├── Final Approval
         └── Legal Review ────┘
```

这里：

```text
Risk Review
Legal Review
```

是独立 Human Tasks。

最后：

```text
Final Approval
```

是另一种 Human Task。

这正是 Workflow Engine 应该表达的关系，而不是在 Approval Service 里硬编码。

IBM 的 Workflow 文档明确支持 Review Step 与 Approval Step 并行存在。

---

# 二十四、Approval 应该是 Workflow 的一个“Gate Semantics”

从架构上看：

```text
Review
    ↓
产生信息

Approval
    ↓
决定是否允许某个 Transition / Action
```

可以画成：

```text
               Human Task
                   │
          ┌────────┼────────┐
          │        │        │
        Input    Review   Approval
          │        │        │
       Data     Findings   Decision
                   │         │
                   └────┬────┘
                        │
                    Workflow
                        │
                    Transition
```

这样就不会把 Approval 与其他 Human Task 完全平级地看待。

---

# 二十五、Workflow Effect 应该独立于 Task Type

这是这个统一模型中最值得实现的一点。

例如：

```text
taskType = REVIEW
```

可以：

```text
blocking = false
```

也可以：

```text
blocking = true
```

而：

```text
taskType = APPROVAL
```

通常：

```text
blocking = true
```

但仍然不能简单硬编码。

更好的字段：

```text
workflowEffect
{
  blocking: boolean,

  onCompleted:
    CONTINUE |
    WAIT |
    ROUTE |
    ESCALATE |
    FAIL,

  transition:
    transitionId
}
```

这样：

```text
Human Task
```

负责：

> 人做完了什么。

Workflow 负责：

> 做完以后业务怎么走。

---

# 二十六、这也解决“Review 完成但 Workflow 不继续”的问题

例如：

```text
Compliance Review
```

Reviewer 提交：

```text
FINDINGS = MATERIAL_CONCERN
```

Human Task：

```text
COMPLETED
```

但 Workflow：

```text
Exception Handling
```

而不是：

```text
Next Step
```

所以必须存在：

```text
Task Completion
    ↓
Outcome
    ↓
Workflow Decision
```

而不是：

```text
Task Status == COMPLETED
    ↓
Workflow automatically continues
```

---

# 二十七、Approval 的结果也应该经过 Authorization Validation

一个很危险的模型：

```text
Approval Task
    ↓
Approved
    ↓
State = APPROVED
```

这里至少缺少：

```text
Was reviewer authorized?
Was approval within scope?
Is approval still valid?
Has business state changed?
Has policy changed?
```

更完整：

```text
Approval Task
   ↓
Completed
   ↓
Decision = APPROVED
   ↓
Validate:
  reviewer authority
  approval scope
  version
  expiration
  policy
  business state
   ↓
Authorize Transition
   ↓
APPROVED
```

这是金融 Workflow 需要特别强调的。

---

# 二十八、Human Task 本身也不能拥有业务状态权威

例如：

```text
HumanTask
status = APPROVED
```

不能直接成为：

```text
InvestmentIdea.status = APPROVED
```

应该：

```text
HumanTask
    ↓
Outcome
    ↓
Workflow
    ↓
Domain Command
    ↓
Business State
```

这与前面：

```text
Business State ≠ Agent Memory
Workflow State ≠ Business State
```

是一致的。

Human Task 自己有：

```text
Task State
```

Business Entity 自己有：

```text
Business State
```

二者必须分开。

---

# 二十九、统一模型其实需要四种 State

建议明确区分：

```text id="hf3umr"
1. Human Task State

2. Decision State

3. Workflow State

4. Business State
```

例如：

```text
Human Task:
IN_PROGRESS

Decision:
PENDING

Workflow:
WAITING_FOR_APPROVAL

Business Entity:
REVIEW
```

Human 点击：

```text
Approve
```

之后：

```text
Human Task → COMPLETED

Decision → APPROVED

Workflow → READY_TO_TRANSITION

Business Entity → 仍然 REVIEW
```

然后 Domain Command 成功后：

```text
Business Entity → APPROVED
```

这几个状态并不应该在一个字段里。

---

# 三十、为什么这一点对 Agent 特别重要？

因为 Agent 很容易把：

```text
“我完成了 Human Task”
```

理解成：

```text
“业务已经完成了。”
```

例如 Agent 调用：

```text
completeHumanTask()
```

之后错误地直接认为：

```text
Case.status = APPROVED
```

真正应该：

```text
Complete Task
    ↓
Workflow evaluates outcome
    ↓
Policy / Authorization
    ↓
Command
    ↓
Domain transition
```

所以：

> **Human Task Completion 是一个 workflow event，不是 Business State Mutation。**

---

# 三十一、Human Task 的统一 Schema

推荐一个企业 Agent Platform 使用类似下面的模型：

```json
{
  "id": "HT-1024",

  "workflow": {
    "instanceId": "WF-884",
    "taskId": "TASK-91"
  },

  "case": {
    "type": "InvestmentIdea",
    "id": "INV-1024"
  },

  "taskType": "REVIEW",

  "assignment": {
    "assignee": "user-123",
    "candidateUsers": [],
    "candidateGroups": ["portfolio-managers"],
    "assignmentPolicy": "ROLE"
  },

  "subject": {
    "type": "InvestmentProposal",
    "id": "PROP-991"
  },

  "context": {
    "summary": "...",
    "evidence": [],
    "references": []
  },

  "interaction": {
    "formSchema": "investment-review-v3",
    "allowedActions": [
      "REQUEST_CHANGES",
      "ESCALATE",
      "COMPLETE"
    ]
  },

  "decision": {
    "type": "REVIEW",
    "outcomeSchema": "investment-review-outcome-v2"
  },

  "control": {
    "requiresApproval": false,
    "requiredRole": "PortfolioReviewer",
    "makerChecker": true
  },

  "workflowEffect": {
    "blocking": true
  },

  "lifecycle": {
    "status": "IN_PROGRESS",
    "dueAt": "2026-09-20T18:00:00Z",
    "timeoutPolicy": "ESCALATE"
  },

  "audit": {
    "createdBy": "investment-agent-v3",
    "createdAt": "...",
    "correlationId": "CORR-992"
  }
}
```

这个模型的关键不是字段多少。

关键是：

> **把 Task、Decision、Control、Workflow Effect 拆开。**

---

# 三十二、Task Type 不应该成为一个巨大的 Enum

初期可能很容易设计：

```text
APPROVAL
REVIEW
INPUT
EXCEPTION
ESCALATION
CONFIRMATION
```

然后不停往里加：

```text
LEGAL_REVIEW
RISK_REVIEW
COMPLIANCE_REVIEW
PM_APPROVAL
IC_APPROVAL
USER_CONFIRMATION
...
```

最终：

```text
taskType
```

变成一个业务类型垃圾桶。

更好的方式是：

```text
base task type
+
typed interaction contract
+
business role
+
decision semantics
```

例如：

```text
taskType = REVIEW

reviewDomain = COMPLIANCE

outcomeSchema = compliance-review-v2

requiredRole = COMPLIANCE_OFFICER
```

而不是：

```text
taskType = COMPLIANCE_OFFICER_REVIEW
```

---

# 三十三、Approval 也不应该为每个业务建立一个新对象

不要：

```text
TradeApproval
PaymentApproval
ProxyVoteApproval
InvestmentApproval
DocumentApproval
```

五套 Approval Runtime。

应该统一：

```text
Approval Task
```

然后：

```text
subject.type
approval.scope
requiredAuthority
decision.policy
```

分别定义业务语义。

Power Automate、AWS、Microsoft 这些系统的共同趋势也是把 approval 作为 Workflow 中的一种通用互动，而不是每个业务都创造一个独立的 approval engine。

---

# 三十四、Human Task 的 UI 与 Domain Model 也应该分开

UI 可以展示：

```text
Approve
Reject
Request changes
Escalate
```

但 Domain Model 不应该简单设计成：

```text
buttons = [...]
```

应该：

```text
allowedActions
```

每个 Action 定义：

```text
id
label
requiredCapability
inputSchema
outcome
workflowEffect
```

例如：

```json
{
  "id": "APPROVE",
  "label": "Approve",
  "requiredCapability": "APPROVE_INVESTMENT",
  "outcome": "APPROVED",
  "workflowEffect": {
    "transition": "TO_APPROVED"
  }
}
```

这样：

> UI 只是 Action 的一个呈现方式。

---

# 三十五、Notification 也不应该等于 Task

一个人收到：

```text
"请关注 INV-1024"
```

不代表产生了：

```text
Human Task
```

Notification 可能只是：

```text
Event
```

真正的 Human Task 应该：

```text
需要有人承担责任
需要完成某个动作
有明确的完成条件
有 Lifecycle
```

因此：

```text
Notification
≠
Human Task
```

同样：

```text
FYI
≠
Review
```

---

# 三十六、Reminder、Escalation、Delegation 也属于 Task Lifecycle

这些不应该成为独立业务对象：

```text
ReminderTask
EscalationTask
DelegationTask
```

而应该属于：

```text
Human Task Lifecycle
```

例如：

```text
HumanTask
  ↓
Due Soon
  ↓
Reminder
  ↓
Expired
  ↓
Escalated
  ↓
Reassigned
```

Camunda 的 User Task lifecycle 已经把 Assignment、Lifecycle events、Reassignment 等作为 Task 本身的能力来处理。

---

# 三十七、多人 Review 也可以统一到同一个 Task Model

例如：

```text
Proposal
   ↓
Review Task
   ├── Reviewer A
   ├── Reviewer B
   └── Reviewer C
```

Completion Policy 可以定义：

```text
ANY
ALL
N_OF_M
MAJORITY
UNANIMOUS
```

IBM 的 Human Task Completion 也支持基于响应数量、百分比、majority 等规则决定任务何时结束。

这样：

```text
Review
```

本身不需要知道：

```text
1 reviewer
3 reviewers
majority
```

这些属于：

```text
Completion Policy
```

---

# 三十八、Approval 也可以是多人决策

例如：

```text
Investment Committee
```

需要：

```text
2 of 3 approvals
```

Human Task：

```text
taskType = APPROVAL
```

Completion Policy：

```text
2_OF_3
```

结果：

```text
APPROVED
```

这样：

```text
Approval
```

仍然是一个统一模型。

而：

```text
Approval Policy
```

定义：

```text
谁
需要几个
什么角色
是否必须不同于 Maker
```

---

# 三十九、Maker-Checker 可以直接挂在 Human Task 上

例如：

```json
{
  "taskType": "APPROVAL",

  "control": {
    "makerChecker": {
      "enabled": true,
      "makerField": "createdBy",
      "checkerMustBeDifferent": true
    }
  }
}
```

这样：

```text
Maker
  ≠
Checker
```

属于：

```text
Control Policy
```

而不是：

```text
Approval Task 本身的 Runtime 状态
```

这进一步说明：

> **Task、Approval、SoD 是三个不同层次。**

---

# 四十、Task、Review、Approval、SoD 的层次关系

推荐最终模型：

```text
                    Human Interaction
                           │
                      Human Task
                           │
             ┌─────────────┼─────────────┐
             │             │             │
          Input          Review       Approval
             │             │             │
         Data Input    Evaluation    Authorization
                           │             │
                           └──────┬──────┘
                                  │
                            Decision Outcome
                                  │
                          Workflow Transition
                                  │
                           Authorization
                                  │
                               Domain
```

而：

```text
Maker-Checker
```

横跨：

```text
Assignment
Authority
Authorization
```

它不是 Task Type。

---

# 四十一、Agent 加入后，Human Task 更应该成为统一交互原语

Agent Runtime 可能发出：

```text
RequestInput
RequestReview
RequestApproval
RequestDecision
RequestEscalation
```

这些不要都实现成独立通信协议。

更合理：

```text
Agent Runtime
       ↓
Human Task Service
       ↓
Human Task
       ↓
External Human System
       ↓
Outcome
       ↓
Workflow
```

这与 Microsoft Agent Framework 当前的方向非常接近：底层是通用 Request/Response，Approval 是一种特殊 request 类型，进一步的信息收集和多轮协作则使用更一般的交互机制。

---

# 四十二、这也是 Agent Platform 为什么应该拥有 Human Task Service

如果没有统一的 Human Task Service：

每个 Agent 都会自己实现：

```text
send approval
wait
notify
timeout
resume
```

最终：

```text
Agent A → Outlook Approval
Agent B → Teams Approval
Agent C → custom UI
Agent D → Slack
```

出现：

```text
不同状态
不同 Assignment
不同 Audit
不同 Escalation
不同权限
```

正确的架构应该是：

```text
             Agent Runtime
                    │
       Request Human Interaction
                    │
                    ▼
            Human Task Service
                    │
        ┌───────────┼───────────┐
        │           │           │
      Input       Review      Approval
        │           │           │
        └───────────┼───────────┘
                    │
             Human Experience
          Teams / Outlook / Web
                    │
                  Result
                    │
             Workflow Resume
```

Microsoft 当前通过 RequestPort 将外部人类交互作为 Workflow 的统一 Request/Response 能力；AWS 则通过 Task Token / Callback 实现类似的“暂停—外部完成—恢复”模式。

---

# 四十三、Human Task Service 与 Approval Engine 不应该互相替代

这里容易走另一个极端：

> “既然 Human Task 是统一模型，那 Approval Engine 就完全不需要了。”

也不准确。

Approval 可能需要专门的：

```text
Approval Policy
Approval Matrix
Delegation
Substitution
Four-eyes
Threshold
Quorum
Expiry
Reapproval
```

这些可以是：

```text
Human Task Service
```

调用的：

```text
Approval Policy Engine
```

而不需要：

```text
Approval Runtime
```

成为另一套 Workflow Runtime。

推荐：

```text
Human Task Service
       │
       ├── Assignment
       ├── Lifecycle
       ├── Notification
       │
       └── Decision Policy
               ├── Review Policy
               ├── Approval Policy
               └── SoD Policy
```

---

# 四十四、因此建议采用“三层架构”

### 第一层：Human Task Runtime

解决：

```text
创建
分配
暂停
恢复
完成
超时
升级
审计
```

---

### 第二层：Interaction / Decision Contract

解决：

```text
Review
Approval
Input
Decision
Exception
```

定义：

```text
Input Schema
Allowed Actions
Outcome Schema
Completion Policy
```

---

### 第三层：Business Control

解决：

```text
Authorization
SoD
Approval Scope
Workflow Transition
Domain Invariants
```

最终：

```text
Human Task
   ↓
Outcome
   ↓
Control Evaluation
   ↓
Workflow
   ↓
Domain
```

这比：

```text
HumanTask
Approval
Review
```

三个平行系统要清晰得多。

---

# 四十五、一个完整的 Runtime Flow

例如 Agent 需要审批：

```text
Agent
  ↓
Create Human Task
  ↓
taskType = APPROVAL
  ↓
Task Service
  ↓
Assignment
  ↓
Human Inbox
  ↓
Reviewer Opens
  ↓
Review Context
  ↓
Approve
  ↓
Task COMPLETED
  ↓
Outcome = APPROVED
  ↓
Approval Policy
  ↓
SoD Check
  ↓
Scope Check
  ↓
Authorization
  ↓
Workflow Transition
  ↓
Domain Command
  ↓
Business State Change
```

注意：

```text
Approve
```

只是中间一个结果。

不是整个系统的安全控制终点。

---

# 四十六、Review 的完整 Runtime Flow

```text
Agent
  ↓
Create Human Task
  ↓
taskType = REVIEW
  ↓
Assign Reviewer
  ↓
Reviewer opens evidence
  ↓
Reviewer adds findings
  ↓
Outcome = REQUEST_CHANGES
  ↓
Workflow routes back to Agent
  ↓
Agent revises proposal
```

这里根本不需要：

```text
Approval
```

但是完全可以复用：

```text
Human Task Runtime
```

---

# 四十七、Input Task 的 Flow

```text
Agent
  ↓
Create Human Task
  ↓
taskType = INPUT
  ↓
Human enters missing data
  ↓
Outcome = structured input
  ↓
Workflow resumes
  ↓
Agent continues
```

Again：

```text
Human Task Runtime
```

完全复用。

---

# 四十八、Exception Task 的 Flow

```text
Agent
  ↓
Tool failure
  ↓
Create Human Task
  ↓
taskType = EXCEPTION
  ↓
Operator investigates
  ↓
Resolve / Retry / Escalate
  ↓
Workflow resumes
```

也不需要独立的：

```text
Exception Runtime
```

---

# 四十九、统一建模最大的价值：所有 Human Interaction 都有同一套生命周期

最终可以统一：

```text
                HumanTask
                    │
             ┌──────┴──────┐
             │             │
           Input         Decision
                           │
                  ┌────────┼─────────┐
                  │        │         │
                Review  Approval   Exception
```

所有这些共享：

```text
Assignment
Lifecycle
SLA
Notification
Escalation
Delegation
Audit
Identity
Authorization
```

而不同的只是：

```text
Interaction Contract
Decision Semantics
Workflow Effect
```

这就是“统一建模”真正应该统一的东西。

---

# 五十、不要让 UI 决定 Domain Semantics

例如 UI 有：

```text
Approve
Reject
Request Changes
Escalate
```

这不意味着 Domain 就应该存：

```text
status = APPROVED
```

UI Action：

```text
Approve
```

应该映射：

```text
Action
  ↓
Outcome
  ↓
Policy
  ↓
Workflow Transition
  ↓
Command
```

这样才能支持：

```text
Web
Teams
Outlook
Mobile
API
Agent
```

多个入口。

同一个 Human Task 可以通过不同 UI 完成，而不会改变业务语义。

Camunda 的 Form / User Task 模型也是类似思路：Form 可以是任务的结构化交互界面，也可以被自定义应用消费，而不是强制把业务逻辑写进 Form。

---

# 五十一、Human Task 的“完成”应该是一个 Typed Result

不要：

```text
complete(taskId)
```

就结束。

最好：

```text
complete(taskId, result)
```

例如：

```json
{
  "taskId": "HT-1024",

  "result": {
    "type": "APPROVAL",
    "decision": "APPROVED",
    "comment": "Within mandate."
  }
}
```

或者：

```json
{
  "taskId": "HT-1025",

  "result": {
    "type": "REVIEW",
    "decision": "REQUEST_CHANGES",
    "findings": [
      {
        "code": "MISSING_EVIDENCE"
      }
    ]
  }
}
```

或者：

```json
{
  "taskId": "HT-1026",

  "result": {
    "type": "INPUT",
    "data": {
      "portfolio": "ABC"
    }
  }
}
```

这种 Typed Result 对 Agent Workflow 非常重要。

因为 Agent 可以：

```text
收到结构化反馈
```

而不是只看到：

```text
"Rejected"
```

---

# 五十二、Human Task 的输入与输出应该被 Schema 化

推荐：

```text
Task
 ├── Input Schema
 ├── Context Schema
 ├── Action Schema
 └── Result Schema
```

这样：

```text
Human
```

不是自由修改 Workflow State。

Human 只是：

```text
submit typed result
```

Workflow 再决定：

```text
what to do with result
```

这也是 Microsoft RequestPort 类型化 Request / Response，以及 Ballerina Workflow 对 Human Task 的 typed approval decision 的共同方向。

---

# 五十三、Human Task 应该有“允许动作集合”

例如：

```json
{
  "allowedActions": [
    "APPROVE",
    "REJECT",
    "REQUEST_CHANGES",
    "ESCALATE"
  ]
}
```

但要注意：

> Allowed Action ≠ Authorized Action。

例如 UI 显示：

```text
Approve
```

并不意味着当前用户真的拥有：

```text
APPROVE_INVESTMENT
```

最终还是：

```text
Action
   ↓
Authorization
   ↓
ALLOW / DENY
```

---

# 五十四、Assignment 与 Authorization 也必须分开

一个任务可以：

```text
assignedTo = Bob
```

但：

```text
Bob's role changed
```

之后 Bob 可能已经不能执行：

```text
APPROVE
```

所以：

```text
Assignment
≠
Authorization
```

Camunda 当前 User Task 也明确区分 assignment 与 task state，并强调只有授权用户才能进行 reassign 等操作。

---

# 五十五、Claim / Assign / Complete 也应该分开

例如：

```text
Task
```

可以：

```text
Unassigned
```

然后：

```text
Bob claims
```

这不等于：

```text
Bob started
```

也不等于：

```text
Bob completed
```

更不等于：

```text
Bob approved
```

推荐 Lifecycle：

```text
CREATED
    ↓
AVAILABLE
    ↓
CLAIMED
    ↓
IN_PROGRESS
    ↓
COMPLETED
```

其中：

```text
Decision Outcome
```

是另外的数据。

Camunda 的生命周期设计明确把 Assignment 和 Task State 分离，就是为了支持协作场景。

---

# 五十六、Human Task 的状态机不要被业务结果污染

不推荐：

```text
Task Status:
PENDING
APPROVED
REJECTED
```

因为：

```text
APPROVED
```

是：

```text
Decision Outcome
```

而不是：

```text
Task Lifecycle
```

更合理：

```text
Task Status:
OPEN
IN_PROGRESS
COMPLETED
CANCELLED
EXPIRED
```

然后：

```text
Outcome:
APPROVED
REJECTED
REQUEST_CHANGES
```

这样：

```text
Task completed
Outcome rejected
```

完全正常。

---

# 五十七、Workflow State 也不要被 Human Task Outcome 直接覆盖

例如：

```text
Workflow State:
REVIEW

Task Outcome:
APPROVED
```

此时：

```text
Workflow
```

可能：

```text
REVIEW → COMPLIANCE
```

也可能：

```text
REVIEW → APPROVED
```

这应该由：

```text
Workflow Rule
```

决定。

不要：

```text
Task outcome
    ↓
automatic state mapping
```

把所有业务逻辑硬编码进去。

---

# 五十八、Approval 的本质其实是“特殊 Completion Contract”

如果一定要在模型层面找 Approval 与 Human Task 的关系，可以定义：

```text
Human Task
    +
Completion Contract
```

其中：

```text
Approval Contract
```

规定：

```text
Allowed Outcomes:
APPROVED
REJECTED

Required Authority:
PortfolioManager

Scope:
Proposal P

Effect:
Approved → transition X
Rejected → transition Y
```

所以：

> Approval 是 Human Task 上的一种强业务 Contract。

---

# 五十九、Review 同样是另一种 Completion Contract

例如：

```text
Review Contract
```

规定：

```text
Allowed Outcomes:
NO_ISSUE
REQUEST_CHANGES
ESCALATE

Required Role:
Reviewer

Evidence:
Required

Findings:
0..N
```

这样：

```text
Human Task
```

仍然统一。

---

# 六十、一个更通用的模型：Human Decision Contract

如果平台希望进一步抽象，可以把：

```text
Approval
Review
Decision
```

统一为：

> **Human Decision Contract**

模型：

```text
HumanTask
   ↓
DecisionContract
{
  subject
  criteria
  allowedActions
  outcomeSchema
  requiredAuthority
  workflowEffect
}
```

然后：

```text
Review Contract
Approval Contract
Exception Resolution Contract
Decision Contract
```

都复用同一个结构。

但：

> 不要把“所有 Human Task 都变成 Decision Task”。

Input、Acknowledgement 等仍然是不同类型的 Human Interaction。

---

# 六十一、一个比较干净的最终模型

推荐：

```text
Human Interaction
│
└── Human Task
    │
    ├── Input Task
    │
    ├── Decision Task
    │   ├── Review
    │   ├── Approval
    │   ├── Exception Resolution
    │   └── Selection
    │
    └── Acknowledgement
```

这比：

```text
HumanTask
ApprovalTask
ReviewTask
```

三个平行 Runtime 更清晰。

---

# 六十二、但 Approval 与 Review 也不要强行“合并成一样”

统一建模不等于抹平差异。

### Review

核心：

```text
Evaluate
Findings
Comment
Recommendation
```

通常：

```text
advisory
```

但也可以：

```text
blocking
```

---

### Approval

核心：

```text
Authorize / Permit / Reject
```

通常：

```text
blocking
```

并且：

```text
requires authority
```

---

### Input

核心：

```text
Provide information
```

没有天然的：

```text
approval semantics
```

---

### Exception Resolution

核心：

```text
Resolve or escalate
```

可能需要：

```text
special authority
```

所以：

> **统一 Runtime，不统一 Business Meaning。**

这是整个设计最重要的一句话。

---

# 六十三、与传统 BPMN 的关系

BPMN 世界实际上早就有类似思路。

核心概念是：

```text
User Task
```

它表达：

> 这个位置需要一个 Human Participant。

至于这个 User Task 是：

```text
Approval
Review
Input
```

往往由：

```text
Task Name
Form
Assignment
Data
Outcome
Gateway
```

共同表达。

Oracle 的 Process Automation 对 Human Task 的定义也是“流程中需要最终用户执行某个动作”，并明确区分 Submit Task、Approval Task，同时允许 Approval Task 使用自定义 Action。

因此 Agent 时代不需要重新创造：

```text
Approval Runtime
Review Runtime
```

而应该把：

```text
Agent
```

接入现有的 Human Task / Workflow Semantics。

---

# 六十四、与 AI Agent 的关系

传统 Workflow：

```text
Workflow
   ↓
Human Task
   ↓
Human
```

Agent Workflow：

```text
Agent
   ↓
Human Task
   ↓
Human
   ↓
Typed Result
   ↓
Agent / Workflow
```

因此 Agent 没有创造一种新的 Human Interaction Primitive。

Agent 只是增加了：

```text
谁发起 Human Task
```

和：

```text
为什么此刻需要 Human
```

以及：

```text
Human Result 返回给谁
```

---

# 六十五、Agent 发起 Human Task 的场景非常重要

例如：

```text
Agent
  ↓
发现缺少信息
  ↓
INPUT TASK
```

或者：

```text
Agent
  ↓
发现高风险动作
  ↓
APPROVAL TASK
```

或者：

```text
Agent
  ↓
发现模型结论不确定
  ↓
REVIEW TASK
```

或者：

```text
Agent
  ↓
检测异常
  ↓
EXCEPTION TASK
```

这实际上形成：

```text
Agent Autonomy
     ↓
Uncertainty / Risk
     ↓
Human Task
     ↓
Human Input
     ↓
Agent / Workflow Resume
```

Microsoft Agent Framework 当前的 Request/Response + Checkpoint/Resume 正是这种基础机制。

---

# 六十六、因此 Human Task Service 是 Agent Control Plane 的关键组件

如果把前面的 Control Plane 架构进一步完善：

```text
                 Agent Control Plane
                        │
 ┌──────────────────────┼────────────────────────┐
 │                      │                        │
Policy              Authorization           Human Task
 │                      │                        │
 │                  Capability             Assignment
 │                                          │
 │                                      Review
 │                                      Approval
 │                                      Input
 │                                      Exception
 │
Workflow
 │
Command
 │
Audit
```

其中：

```text
Human Task
```

不是 UI 服务。

而是：

> **Control Plane 中负责 Human Authority Interaction 的核心执行组件。**

---

# 六十七、Human Task 与 Human Experience 应该分开

不要让：

```text
Teams
Outlook
Web UI
Mobile
```

直接成为：

```text
Workflow Engine State
```

它们应该只是：

```text
Human Experience Layer
```

例如：

```text
                   Human Task Service
                           │
              ┌────────────┼────────────┐
              │            │            │
            Web          Teams       Outlook
              │            │            │
              └────────────┼────────────┘
                           │
                       Human Result
                           │
                      Workflow Resume
```

这样未来换 UI 不影响业务流程。

Power Automate 的 Approval Center、邮件审批等，其实也体现了同一个方向：Approval 是 Workflow 中的对象，而 Email / Approval Center 是处理它的交互表面。

---

# 六十八、Human Task 需要处理“人不回答”的情况

任何统一模型都不能只有：

```text
Complete
```

还要：

```text
Timeout
Escalate
Delegate
Reassign
Cancel
Fallback
```

AWS 当前明确要求 Approval Workflow 设置 timeout、escalation path，否则 Reviewer 不可用会导致 Agent 永久停滞。

因此：

```text
HumanTask
```

天然应该包含：

```text
SLA
TimeoutPolicy
EscalationPolicy
FallbackPolicy
```

而不是由 Approval UI 自己解决。

---

# 六十九、Checkpoint / Resume 也是统一模型的一部分

这是 Agent Workflow 与传统人工审批非常不同的地方。

Agent 可能：

```text
run
  ↓
request human
  ↓
pause
  ↓
hours later
  ↓
human responds
  ↓
resume
```

因此 Human Task 必须能绑定：

```text
Workflow Execution
Checkpoint
Pending Request
Response
```

Microsoft 当前明确保存 checkpoint 中的 pending requests，恢复后重新发出 RequestInfoEvent，使 Human Task 能够跨进程暂停恢复。

AWS Step Functions 则通过 Task Token 实现类似的持久等待。

这说明：

> **Human Task 不是简单的 CRUD Record，而是 Workflow Execution 的一个等待点。**

---

# 七十、因此建议统一成“Human Interaction Object”

如果不希望 `HumanTask` 这个名字限制未来设计，可以在平台层定义：

```text
HumanInteraction
```

其具体 Runtime Instance：

```text
HumanTask
```

业务 Contract：

```text
Input
Review
Approval
Decision
Exception
```

结构：

```text
HumanInteraction
{
  task
  interaction
  decision
  control
  lifecycle
  workflowEffect
}
```

这可能比直接把整个系统叫：

```text
Approval Service
```

更适合企业 Agent Platform。

---

# 七十一、一个推荐的领域模型

可以最终归纳成：

```text
HumanInteraction
│
├── Identity
│   ├── requester
│   ├── actor
│   └── assignee
│
├── Subject
│   ├── case
│   ├── businessObject
│   └── proposal
│
├── Context
│   ├── evidence
│   ├── references
│   └── history
│
├── Interaction Contract
│   ├── formSchema
│   ├── allowedActions
│   └── inputSchema
│
├── Decision Contract
│   ├── type
│   ├── criteria
│   ├── outcomeSchema
│   └── completionPolicy
│
├── Control Contract
│   ├── requiredRole
│   ├── capability
│   ├── SoD
│   └── approvalScope
│
├── Workflow Effect
│   ├── blocking
│   ├── transition
│   └── resumePolicy
│
├── Lifecycle
│   ├── status
│   ├── dueAt
│   ├── timeout
│   └── escalation
│
└── Audit
    ├── createdBy
    ├── decidedBy
    ├── timestamps
    └── evidence
```

这套模型可以同时支持：

```text
Agent
Human
Workflow
Business Case
Approval
Review
Input
Exception
```

---

# 七十二、一个非常重要的建模规则：不要把“Approval”当作 Status

错误：

```text
status = APPROVAL_PENDING
status = APPROVED
status = REJECTED
```

这样很快会把：

```text
Workflow Status
Task Status
Decision Status
Business Status
```

全部混在一起。

推荐：

```text
Human Task Status:
IN_PROGRESS

Decision:
PENDING

Workflow:
WAITING_FOR_APPROVAL

Business Entity:
REVIEW
```

完成之后：

```text
Human Task:
COMPLETED

Decision:
APPROVED

Workflow:
READY_TO_TRANSITION

Business Entity:
still REVIEW
```

然后：

```text
Domain Command
    ↓
Business Entity
    ↓
APPROVED
```

这会大幅减少后续状态混乱。

---

# 七十三、与“Business State 不应该存在 Agent Memory”直接对应

整个统一建模体系应该保持：

```text
Agent Memory
    = Context

Human Task
    = Human work state

Workflow
    = Execution state

Approval / Review Result
    = Decision evidence

Domain
    = Business state
```

因此：

```text
Agent Memory
      ≠
Human Task
      ≠
Workflow State
      ≠
Business State
```

这几个状态必须明确分层。

---

# 七十四、与 Maker-Checker 的关系

前面的 Maker-Checker 原则可以直接挂进来：

```text
Maker
   ↓
Proposal
   ↓
Human Task
   ↓
Review / Approval
   ↓
Checker
   ↓
Authorization
   ↓
Command
```

这里：

```text
Human Task
```

是 Runtime。

```text
Review
```

是业务语义。

```text
Approval
```

是决策语义。

```text
Checker
```

是 Authority / SoD。

不要把这几个概念合成一个：

```text
ApprovalTask
```

否则后期很难表达：

```text
Review ≠ Approval
Checker ≠ Assignee
Approval ≠ Authorization
Task Completion ≠ Business State Transition
```

---

# 七十五、与多人业务流程的关系

前面的多人 Workflow 原则可以表达为：

```text
Human Task
     ↓
Assigned Role
     ↓
Task Authority
```

而不是：

```text
Agent
     ↓
Current User
     ↓
Everything
```

因此一个 Agent 可以：

```text
创建 Review Task
创建 Approval Task
创建 Exception Task
创建 Input Task
```

但这些 Task 各自：

```text
Assignment
Authority
Capability
Authorization
```

独立计算。

---

# 七十六、一个最终推荐架构

```text
                         Agent Runtime
                              │
                     Request Human Action
                              │
                              ▼
                    ┌──────────────────┐
                    │ Human Task       │
                    │ Service          │
                    └────────┬─────────┘
                             │
           ┌─────────────────┼──────────────────┐
           │                 │                  │
         Input             Review             Approval
           │                 │                  │
       Data Input        Findings           Decision
           │                 │                  │
           └─────────────────┼──────────────────┘
                             │
                      Typed Outcome
                             │
                    ┌────────▼─────────┐
                    │ Control Plane    │
                    │                  │
                    │ Policy           │
                    │ Authorization    │
                    │ SoD              │
                    │ Scope            │
                    └────────┬─────────┘
                             │
                       Workflow Effect
                             │
                             ▼
                         Workflow
                             │
                          Command
                             │
                          Domain
                             │
                       Business State
                             │
                           Audit
```

Human Experience：

```text
                   Human Task Service
                          │
            ┌─────────────┼─────────────┐
            │             │             │
           Web          Teams        Outlook
```

只负责：

```text
呈现
交互
提交结果
```

不负责：

```text
Business Authorization
Workflow State
Business State
```

---

# 七十七、这个模型对 Agent Platform 有什么实际价值？

如果平台提供统一的 Human Task Service，那么 Agent Skill 可以非常简单：

```text
request_human(
  type="approval",
  subject=proposal,
  required_role="portfolio_manager"
)
```

或者：

```text
request_human(
  type="review",
  subject=generated_report,
  review_schema="investment-review-v2"
)
```

或者：

```text
request_human(
  type="input",
  schema="missing-client-info-v1"
)
```

Agent 不需要知道：

```text
Teams
Outlook
Web
Power Automate
Tasklist
```

也不需要自己维护：

```text
approval table
notification
timeout
resume
assignment
```

这些全部属于：

```text
Control Plane / Human Task Service
```

---

# 七十八、这比“Human-in-the-loop Tool”更高级

一个低阶 Agent 平台可能只有：

```text
approve_tool_call()
```

这解决的是：

> “调用这个 Tool 前是否询问人？”

但成熟企业平台真正需要：

```text
request_human_task()
```

因为 Human 不一定只是：

```text
approve tool call
```

可能是：

```text
provide information
review proposal
make decision
resolve exception
approve command
select option
escalate
```

Microsoft 当前 Agent Framework 已明确把 Tool Approval 作为 Request/Response 的一个特殊场景，而不是整个 HITL 模型本身。

这正是一个非常重要的架构信号。

---

# 七十九、Human Task 不是“人类 Tool”

这是一个值得特别强调的区别。

Tool 的语义：

```text
Agent
  ↓
Tool
  ↓
Execute operation
```

Human Task 的语义：

```text
Workflow / Agent
  ↓
Ask Human
  ↓
Wait
  ↓
Human decides / provides data
  ↓
Resume
```

Human 不应该被简单封装成：

```text
human_tool()
```

因为：

```text
Human
```

具有：

```text
latency
judgment
accountability
authority
unavailability
delegation
escalation
```

这些特征。

所以：

> **Human Task 是 Workflow Interaction Primitive，而不是普通 Tool。**

---

# 八十、最终建议：统一的是“Human Task Runtime”，不是“业务语义”

可以用下面这张表总结：

| 概念                  | 本质                  |  是否应统一 Runtime |
| ------------------- | ------------------- | -------------: |
| Human Task          | Human work instance |              是 |
| Input               | 收集信息                |              是 |
| Review              | 人工评价 / 检查           |              是 |
| Approval            | 授权性决定               |              是 |
| Decision            | 选择方案                |              是 |
| Exception           | 处理异常                |              是 |
| Escalation          | 升级处理                |              是 |
| Notification        | 信息通知                |            不一定 |
| Authorization       | 系统授权判断              | 不属于 Human Task |
| Workflow Transition | 流程状态变化              | 不属于 Human Task |
| Business State      | 业务真值                | 不属于 Human Task |

这张表里最重要的是后四项：

```text
Human Task
    ≠
Authorization
    ≠
Workflow Transition
    ≠
Business State
```

---

# 八十一、最终原则

可以把整个研究结论压缩成八条。

### 1. Human Task 是 Runtime Primitive

> 人类工作、输入、审查、审批都应该能够作为统一 Human Task 执行。

### 2. Review 是业务语义

> Review 表示评价、检查、发现问题、给出意见，不天然意味着授权。

### 3. Approval 是更强的 Decision Semantic

> Approval 表示对一个明确 Scope 的 Proposed Action / Decision 进行放行或拒绝。

### 4. Approval ≠ Authorization

> 人批准了，不等于系统授权已经自动通过。

### 5. Task Completion ≠ Workflow Transition

> Human Task 完成只是产生一个 Typed Outcome，Workflow 决定下一步。

### 6. Workflow Transition ≠ Business State Mutation

> 流程状态变化最终仍应通过 Domain / Business System 修改 Business State。

### 7. Assignment ≠ Authority

> 被分配任务的人不意味着可以执行任务中的所有动作；最终仍需 Authorization。

### 8. Agent 应调用统一 Human Task Service

> Agent 不应该自行维护 Approval / Review / Input 的等待、通知、分配和恢复机制。

---

# 八十二、最终模型

可以最终形成：

```text
                         Human Interaction
                                │
                         ┌──────▼──────┐
                         │ Human Task  │
                         └──────┬──────┘
                                │
              ┌─────────────────┼────────────────┐
              │                 │                │
            Input             Review           Decision
                                                │
                                           ┌────┴────┐
                                           │         │
                                      Approval   Selection
              │                 │                │
              └─────────────────┼────────────────┘
                                │
                          Typed Outcome
                                │
                        Control Evaluation
                                │
                  ┌─────────────┼─────────────┐
                  │             │             │
                Policy         SoD      Authorization
                  │             │             │
                  └─────────────┼─────────────┘
                                │
                         Workflow Transition
                                │
                             Command
                                │
                              Domain
                                │
                         Business State
                                │
                              Audit
```

这套模型最大的好处，是不会再出现：

```text
Approval System
Review System
Human Task System
```

三个互相平行、状态各自独立的系统。

同时也不会犯另一个错误：

> “既然都叫 Human Task，那么 Approval、Review、Input 就完全一样。”

它们在 **Runtime Lifecycle** 上统一，在 **Business Semantics** 上保持差异。

因此最准确的设计原则是：

> **统一 Human Task，区分 Decision Semantics，外置 Authorization，保持 Workflow State 与 Business State 分离。**

---

# 八十三、与当前业界实践的对应关系

目前不同厂商术语不完全一致，但可以看到很相似的职责分层。

### Microsoft

Microsoft Agent Framework 的底层 HITL 是通用 Request/Response；Workflow 可以暂停等待外部响应；Tool Approval 是这种机制的一种具体类型，收集更多信息和多轮交互则可以使用不同的交互模式。Checkpoint 会保存 pending requests 并支持恢复。

### AWS

AWS Step Functions 使用 Callback / Task Token 将“等待外部完成”建模为通用 Workflow Primitive，Human Approval 只是其中一种使用方式。其 Agentic AI Lens 又在更高一层增加风险分级的 Human Oversight、Approval Scope、Timeout 和 Escalation。

### Camunda

Camunda 把 User Task 作为 BPMN / Workflow Engine 的基础 Human Work Primitive，并把 Assignment、Form、Lifecycle、Task Listener、Reassignment 等能力统一在 User Task 上；其文档也直接把 AI Agent 请求 Human Review / Approval 作为 User Task 的典型用法。

### IBM

IBM 的 Workflow 产品长期区分 Human Task、Approval Task、Review Step，但从其模型来看，Approval / Review 都建立在更大的 Human Workflow 体系上，而不是三个完全独立的执行引擎；Review 和 Approval 甚至可以在流程中并行。

### Oracle

Oracle Process Automation 明确把 Human Task 作为需要人完成的流程活动，同时支持 Submit Task、Approval Task 以及自定义 Action；这进一步说明 Approval 可以是 Human Task 的业务变体，而不必成为独立 Runtime Primitive。

---

# 八十四、最终结论

真正值得在企业 Agent 平台里统一的，不是：

```text
Approval
Review
Input
```

这些名称。

而是：

```text
Human Work Lifecycle
```

以及：

```text
Human Interaction Runtime
```

然后在其上表达不同的业务语义：

```text
Human Task
    +
Input Contract
    +
Decision Contract
    +
Control Contract
    +
Workflow Effect
```

最终：

```text
Review
    = Human Task + Evaluation Contract

Approval
    = Human Task + Authorization-oriented Decision Contract

Input
    = Human Task + Data Collection Contract

Exception
    = Human Task + Resolution Contract
```

这样既可以保持统一平台，又不会丢失金融业务真正重要的区别。

尤其需要坚持以下边界：

```text
Human Task
    ≠
Approval

Approval
    ≠
Authorization

Review
    ≠
Approval

Task Completion
    ≠
Workflow Transition

Workflow Transition
    ≠
Business State Mutation

Assignment
    ≠
Authority

Human UI Action
    ≠
Business Command
```

如果把这几个 `≠` 维护好，Human Task、Approval、Review 就可以在同一个 Control Plane 里统一运行，而不需要牺牲业务语义和组织授权边界。

---

## 参考资料

**Microsoft Agent Framework — Workflows / Human-in-the-loop**
Microsoft 当前将 HITL 建模为 Workflow 的 Request/Response 机制，支持暂停、外部响应、Checkpoint、Resume；Tool Approval 是其中一种特殊请求类型，而自由交互和信息收集属于更一般的交互模式。

**AWS Agentic AI Lens — Human-in-the-loop for critical decisions**
AWS 当前明确反对所有动作统一人工审批，建议按风险和可逆性建立分层监督，同时要求 approval scope、reviewer identity、timestamp、timeout 和 escalation 等结构化控制。

**AWS Step Functions — Callback / Task Token**
AWS 将 Workflow 等待外部系统或人员完成的能力抽象成通用 Callback Pattern；Human Approval 是一个典型应用。

**Camunda 8 — User Tasks / User Task Lifecycle**
Camunda 将 User Task 作为 Human Work 的基础执行对象，并统一支持 Assignment、Form、Lifecycle、Reassignment、Task Listener 等能力。

**IBM Business Automation Workflow — Human Tasks / Approval / Review**
IBM 长期将 Human Task 作为人机协作的基础任务，并支持 Approval Task、Review Step、多人 Completion Policy、Escalation 等模式。

**Oracle Process Automation — Human Task Activities**
Oracle 明确把 Submit Task、Approval Task 等定义为 Human Task Activities，并允许自定义 Action。

**Microsoft Power Automate — Approvals**
Power Automate 将 Approval 作为 Workflow 中的人工决策能力，并支持长时间 Approval、取消以及多个审批参与者。

**Microsoft Human-in-the-loop Connector**
Microsoft 的 Human-in-the-loop connector 同时支持 Approval 与 Request for Information，说明“人工审批”和“人工输入”可以由统一 Human Interaction 能力承载。

---

### 最终建议

对于你前面的 Agent Control Plane 体系，我建议最终把这个领域模型固定成：

```text
Human Task Service
    │
    ├── Input
    ├── Review
    ├── Decision
    ├── Approval
    ├── Exception
    └── Escalation
```

然后：

```text
Human Task
    ↓
Typed Outcome
    ↓
Policy / SoD / Authorization
    ↓
Workflow Transition
    ↓
Command
    ↓
Domain State
```

这比直接设计一个 `Approval Service` 要稳健得多，也更容易和你前面已经定义的 **Maker-Checker、HITL、Command、Authorization、Business State、Control Plane** 接起来。


# 多人协作 + Human-in-the-loop 设计：金融服务领域 AI Agent Workflow

## 1. 引言

金融业务很少由一个人、一次操作完成。

一个典型业务可能经过：

```text
Analyst
   ↓
AI Research
   ↓
Compliance
   ↓
Portfolio Manager
   ↓
Operations
   ↓
External System
```

传统系统已经解决了一部分问题：

* 谁负责；
* 谁审批；
* 谁执行；
* 当前状态是什么；
* 谁能访问什么；
* 什么情况下需要复核。

AI Agent 的加入，使系统增加了一种新的参与者：

```text
AI Agent
```

问题也因此发生变化：

> **如何让 AI 参与多人业务流程，而不是让 AI 把多人业务流程变成一个“Agent 自己做完、人类最后点一下批准”的流程？**

这两个系统完全不同。

真正成熟的 Human-in-the-loop（HITL）不是：

```text
Agent
  ↓
"Approve?"
  ↓
Human
  ↓
Yes
```

而应该是：

```text
Business Case
      ↓
Workflow
      ↓
AI Work
      ↓
Human Collaboration
      ↓
Policy
      ↓
Business Decision
      ↓
Command
      ↓
Business System
```

AWS 当前 Agentic AI Lens 明确指出：所有 Agent 行为都交给人工审核会产生 reviewer fatigue 和 rubber-stamping，而完全没有人工审核又会形成 unbounded autonomy，因此应根据操作的风险和可逆性实施分级人工监督。

Microsoft Agent Framework 当前也把 HITL 建模成 Workflow 中正式的 request/response、checkpoint 和 resume 机制，而不是聊天中的临时交互。

对于金融领域，这一点尤其重要。OECD 2026 年对意大利金融市场的调查显示，受访机构普遍把 AI 自主性限制在较低水平，human-in-the-loop 是重要的风险控制方式；BIS 也明确指出，AI 可能让决策变得更加自动化和复杂，因此治理体系必须保证仍有能够理解并承担责任的人。

---

# 2. 第一原则：Human-in-the-loop 不是“加一个人工审批节点”

这是整个设计最容易犯的错误。

低质量 HITL：

```text
Agent
   ↓
Generate result
   ↓
Approve?
   ↓
Human clicks Yes
```

高质量 HITL：

```text
Agent
   ↓
Prepare evidence
   ↓
Identify uncertainty
   ↓
Propose action
   ↓
Workflow creates Human Task
   ↓
Assign appropriate reviewer
   ↓
Reviewer inspects context
   ↓
Reviewer makes explicit decision
   ↓
Policy validates authority
   ↓
Workflow continues
```

真正的人机协作应该让人做：

> **只有机器不应该独立承担、并且人的判断会实际改变结果的工作。**

AWS 对这一点给出了非常直接的原则：如果 review 每个 Agent Action，会造成疲劳和 rubber-stamping；如果一个都不 review，则会失去重要的控制。因此审核必须针对真正需要人类判断的决策。

---

# 3. 多人协作的核心对象应该是 Business Case

不要把：

```text
Chat Session
```

作为整个协作模型的核心。

应该：

```text
Business Case
    │
    ├── Workflow
    ├── Agent Tasks
    ├── Human Tasks
    ├── Reviews
    ├── Approvals
    ├── Commands
    ├── Evidence
    ├── Decisions
    └── Audit
```

例如：

```text
Investment Idea #1234
```

才是真正的业务协作对象。

参与者可能是：

```text
Analyst
Compliance Reviewer
Portfolio Manager
Operations
AI Agent
```

他们都围绕：

```text
Case #1234
```

工作。

因此：

> **AI Session 是技术对象；Human Task 是协作对象；Business Case 才是业务对象。**

这样即使：

```text
Agent Session lost
Browser closed
Pod restarted
Model changed
```

Case 仍然存在。

---

# 4. 人的角色不是“User”，而是 Business Actor

多人协作系统不能只记录：

```text
userId
```

至少需要识别：

```text
Actor
Role
Responsibility
Relationship to Case
```

例如：

```text
User A
    Role: Investment Analyst
    Responsibility: Initiator

User B
    Role: Compliance Reviewer
    Responsibility: Reviewer

User C
    Role: Portfolio Manager
    Responsibility: Approver

User D
    Role: Operations
    Responsibility: Executor
```

这样才能实现：

```text
Initiator
   ≠
Reviewer
   ≠
Approver
```

并支持职责分离。

DORA 要求金融机构建立清晰、透明的职责和责任线，并对风险管理、控制职能和内部审计保持适当独立性；这些原则可以直接延伸到 Agent Workflow 中的人机协作设计。

---

# 5. Agent 在多人协作中的最佳定位

Agent 最有价值的角色不是：

> “替某个人做最终决定。”

而是：

> **成为每个业务角色的高能力工作助手。**

例如：

### Analyst

Agent：

```text
Search
Read
Compare
Extract
Summarize
Draft
```

### Compliance

Agent：

```text
Check policy-related evidence
Find exceptions
Compare documents
Identify missing information
Prepare review package
```

### Portfolio Manager

Agent：

```text
Summarize trade-offs
Compare alternatives
Highlight risks
Prepare decision brief
```

### Operations

Agent：

```text
Prepare execution data
Validate completeness
Explain exceptions
Draft operational instructions
```

最终：

```text
Human
    ↓
better information
    ↓
better decision
```

而不是：

```text
Human
    ↓
delegate responsibility
    ↓
Agent
```

BIS 近年来多次强调，在金融领域，AI 带来的自动化不应该导致责任和治理被“模型接管”；2026 年 BIS 关于金融 AI 的讲话再次强调，需要明确谁能够理解 AI 决策、谁对决策负责。

---

# 6. HITL 应该分成不同类型

不要把所有 Human Interaction 都称为 Approval。

至少应该区分：

```text
1. Review
2. Approve / Reject
3. Request Changes
4. Provide Information
5. Resolve Exception
6. Override
7. Assign / Reassign
8. Escalate
```

例如：

```text
@review compliance
```

并不意味着只有：

```text
approve
reject
```

实际金融业务可能需要：

```text
approve
reject
request_changes
request_more_evidence
escalate
```

这会比单纯的 Yes / No 更符合真实业务。

---

# 7. Human Task 与 Approval 必须分离

一个非常重要的设计：

```text
Human Task
```

和：

```text
Approval
```

不是同一个对象。

### Human Task

回答：

> 谁需要做什么工作？

例如：

```text
Compliance Reviewer
需要检查：

1. restricted list
2. disclosure
3. conflict of interest
4. supporting evidence
```

### Approval

回答：

> 这个人是否正式做出了业务决定？

例如：

```text
Decision:
APPROVE

Decision By:
Compliance Reviewer

Decision Time:
...

Decision Version:
...
```

所以：

```text
Human Task
   ↓
Review Work
   ↓
Decision
   ↓
Approval Record
```

这样既支持复杂人工工作，也支持正式审计。

---

# 8. “看到了 AI 结果”不等于“有效审核”

真正的人机协作必须解决：

> Reviewer 到底看到了什么？

AWS 建议在审批前持久化完整 decision context，并让 Reviewer 至少能够看到 action、相关 reasoning、数据来源、执行历史以及潜在影响，而不是只显示一个“Approve”按钮。

例如：

```text
Investment Idea #1234

AI Recommendation:
Proceed

Key Findings:
- Revenue concentration increased
- Regulatory risk identified

Evidence:
- Annual Report 2025
- Internal Research #452
- Market Data Snapshot #18

Policy Checks:
- Restricted List: PASS
- Disclosure: PASS
- Conflict Check: REVIEW

Open Issues:
- One missing disclosure

Proposed Action:
Publish Investment Idea
```

Reviewer 真正要判断的是：

```text
这些信息是否足够支持这个决定？
```

而不是：

```text
AI 看起来说得挺合理，要不要点一下？
```

---

# 9. 不要把完整 Chain of Thought 当作 Reviewer UI

Reviewer 需要的是：

```text
Decision Context
```

不是：

```text
所有 Prompt
所有 Tool Output
所有模型内部推理文本
```

更合理的 Review Context：

```text
Decision
    ↓
Key Evidence
    ↓
Important Assumptions
    ↓
Exceptions
    ↓
Policy Results
    ↓
Potential Consequences
    ↓
Proposed Action
```

而系统后台可以保留更完整的运行轨迹，用于 observability / incident investigation。

这样可以同时满足：

```text
Reviewer usability
+
Auditability
+
Security
+
Information minimization
```

---

# 10. Reviewer 不应该只看到“答案”，还要看到“反方信息”

多人协作中特别重要的一点：

> **AI 不应该只帮人形成结论，也应该帮助人发现为什么这个结论可能错。**

例如：

```text
AI Recommendation:
Approve

Supporting Evidence:
...

Contradicting Evidence:
...

Known Uncertainties:
...

Missing Evidence:
...

Potential Failure:
...
```

研究也越来越说明 Human-AI Collaboration 不能简单假设“AI Recommendation + Human Approval”一定会带来更好决策。2025 年一项涉及 2,784 名参与者的实验发现，任务设计、纠错负担和参与者对 AI 的态度都会影响人对 AI 建议的依赖，过度依赖可能导致错误建议被接受。

因此：

> **Agent 应该帮助 Reviewer 扩展判断，而不是让 Reviewer 变成 AI 的签字员。**

---

# 11. 多人 Review 不一定等于多个 Agent

假设需要：

```text
Compliance
+
Risk
+
PM
```

共同参与。

不要自然推导成：

```text
Compliance Agent
Risk Agent
PM Agent
```

这里真正需要的是：

```text
Three Human Responsibilities
```

可以由：

```text
Agent
```

分别辅助三个人。

架构：

```text
                 Business Case
                      │
                 Workflow
                      │
          ┌───────────┼───────────┐
          ▼           ▼           ▼
      Compliance     Risk         PM
       Human        Human       Human
          ▲           ▲           ▲
          │           │           │
       Agent        Agent       Agent
       Assist       Assist      Assist
```

而不是：

```text
Agent A
  ↓
Agent B
  ↓
Agent C
```

---

# 12. Sequential Review 与 Parallel Review

多人审批至少有两种基本模式。

## Sequential

```text
Compliance
    ↓
Risk
    ↓
PM
```

适合：

* 后一阶段依赖前一阶段结果；
* Review 有明显前置关系；
* 风险逐级提升。

例如：

```text
Compliance PASS
    ↓
PM Review
```

---

## Parallel

```text
              ┌→ Compliance
Case ─────────┼→ Risk
              └→ Legal
                     │
                     ▼
                 Aggregation
                     │
                     ▼
                  Decision
```

适合：

* 多个专业人员可以独立判断；
* Review 内容互不依赖；
* 需要降低整体等待时间。

然后再定义：

```text
ALL
ANY
N of M
```

例如：

```text
required: 2
strategy: ALL
```

这样的机制非常适合金融机构的职责分离和多人复核。

---

# 13. Multi-reviewer 的核心不是“人越多越安全”

三个人同时看到同一个 AI 建议，然后都点击：

```text
Approve
```

不一定比一个人有效。

因为存在：

```text
Anchoring
Automation Bias
Groupthink
Rubber Stamping
```

AWS 当前 Agentic AI Lens 已经特别提出：高风险操作可以使用独立的多 Reviewer、盲审、共识逻辑和分歧升级；同时要监控 Reviewer 工作负载和 rubber-stamping。

因此 Multi-review 应该解决：

> **独立判断质量**

而不是简单：

> **增加审批人数。**

---

# 14. 高风险操作可以采用独立 Review

例如：

```text
Critical Command
        │
        ├── Reviewer A
        │
        ├── Reviewer B
        │
        └── Reviewer C
```

每个人在提交决定之前：

```text
看不到其他人的决定
```

最后：

```text
2 / 3 approve
```

或者：

```text
ALL approve
```

发生 disagreement：

```text
Escalation
    ↓
Senior Reviewer
```

这比：

```text
A approves
   ↓
B sees A approved
   ↓
B approves
```

更能降低 anchoring effect。

---

# 15. Approval Rule 必须是结构化 Policy

不要写：

```text
"Normally two reviewers should approve this."
```

应该结构化：

```text
strategy: ALL
required: 2
role: compliance.reviewer
exclude: initiator
```

或者：

```text
strategy: ANY
roles:
  - compliance.reviewer
  - risk.reviewer
```

这样可以明确：

```text
Who
How many
Which roles
Can initiator approve?
Can delegate approve?
What happens on disagreement?
```

---

# 16. Approval 必须绑定具体内容

这是金融 Agent 中非常重要的一条。

错误：

```text
User approves:
"Publish this case."
```

然后 Agent 修改了内容，再执行 Publish。

应该：

```text
Approval
    ↓
Proposal Version
    ↓
Command Hash
    ↓
Execution
```

例如：

```text
Approval #8451

Case:
1234

Approved Command:
publish-investment-idea

Command Hash:
abc123...

Version:
7
```

如果随后：

```text
Case Version = 8
```

则之前 Approval 不应该自动继续有效。

需要：

```text
Re-review
```

因为：

> **人批准的是一个具体版本的业务状态，而不是一个永久性的“允许未来做这件事情”。**

AWS 也特别建议把 persistent trust 限制到特定 command、parameter shape 或 resource，并避免 wildcard trust。

---

# 17. Re-approval 是非常重要的安全边界

假设：

```text
AI proposes Publish
      ↓
Compliance approves
      ↓
Before execution:
    data changes
```

如果系统直接：

```text
retry
```

可能会让：

```text
旧批准
```

支持：

```text
新数据
```

这是危险的。

正确处理：

```text
Approved Version
      ↓
Execution Check
      ↓
Version same?
    ├── yes → execute
    └── no  → re-review
```

可以理解为：

> **Approval 是对特定 Proposal 的批准，不是对未来所有相似操作的授权。**

---

# 18. Reviewer 的上下文必须是“冻结的”

审批时应该能够确定：

```text
当时看到了什么？
```

因此：

```text
Case Version
Workflow Version
Evidence Version
Policy Version
AI Output Version
```

都应该可追踪。

例如：

```text
Review #9321

Case:
1234@v8

AI Result:
research@v14

Evidence:
snapshot@2026-09-18T10:00

Policy:
investment-review@v6
```

这样未来才能知道：

> Reviewer 在什么信息和规则下做出了这个决定。

---

# 19. Human Task 必须能够长期等待

金融业务经常不是：

```text
10 秒内审批
```

而可能是：

```text
几小时
一天
几天
```

因此：

```text
Human Task
```

必须持久化。

不能：

```text
await humanApproval()
```

然后把状态放在进程内。

应该：

```text
RUNNING
   ↓
WAITING_FOR_APPROVAL
   ↓
persist
   ↓
process may terminate
   ↓
human responds
   ↓
resume
```

Microsoft Agent Framework 当前采用的 request/response + checkpoint/resume 模式正是这种设计：待处理请求会随着 checkpoint 一起保存，恢复 Workflow 时重新发出 pending request。

---

# 20. Human Task 必须具有版本和状态

建议：

```text
HumanTask
├── taskId
├── caseId
├── executionId
├── workflowNodeId
├── status
├── assignedRole
├── assignedUser
├── createdAt
├── expiresAt
├── decision
├── decidedBy
├── decidedAt
├── caseVersion
├── commandHash
└── escalationLevel
```

状态例如：

```text
PENDING
CLAIMED
IN_REVIEW
APPROVED
REJECTED
CHANGES_REQUESTED
EXPIRED
ESCALATED
CANCELLED
```

---

# 21. Assignment 与 Approval 必须分开

一个非常容易犯的错误：

```text
Task Assigned To = User A
```

就认为：

```text
User A = Approver
```

不一定。

例如：

```text
Task:
Prepare Compliance Review

Assignee:
Compliance Analyst A

Approver:
Compliance Manager B
```

因此：

```text
Work Assignment
```

和：

```text
Decision Authority
```

应该分别建模。

---

# 22. 支持 Claim / Assignment / Queue

多人协作不是所有任务一开始就知道具体用户。

很多情况下只知道：

```text
Compliance Reviewer
```

因此应该：

```text
Queue
   ↓
Eligible Reviewers
   ↓
Claim / Assignment
```

例如：

```text
Compliance Queue
 ├── User A
 ├── User B
 └── User C
```

任何一个符合要求的人可以领取。

但一旦领取：

```text
Task
    assignedTo = User B
```

此时 Workflow 可以要求：

```text
只能由 User B 完成
```

或者支持：

```text
reassign
```

---

# 23. Delegation 是金融业务中的正式能力

现实里：

```text
Reviewer A
```

可能休假。

所以不能设计成：

```text
A unavailable
    ↓
workflow stuck forever
```

需要：

```text
Primary Reviewer
      ↓ timeout
Backup Reviewer
      ↓ timeout
Escalation
      ↓
Manager / Control Function
```

AWS 对 HITL 明确建议设置 timeout 和 escalation path，并在 reviewer unavailable 时采用安全 fallback。

但是：

> Delegation 本身也是 Policy。

不能让 Reviewer 随便说：

```text
"I delegate my authority to Agent."
```

应该由组织定义：

```text
谁可以 delegate
delegate 到谁
哪些操作可以 delegate
delegate 多久有效
高风险动作能不能 delegate
```

---

# 24. 超时不能默认等于 Approve

在金融业务中：

```text
Reviewer timeout
```

一般不应该：

```text
→ Approved
```

对于高风险操作，更合理的是：

```text
timeout
   ↓
escalate
   ↓
safe stop
```

例如：

```text
Publish
   ↓
No reviewer
   ↓
STOP
```

而对于低风险、可逆的内部操作，业务上才可能允许：

```text
timeout
   ↓
continue
```

所以：

> **Timeout behavior 应由风险等级定义，而不是由通用 Workflow Engine 默认决定。**

---

# 25. Risk-tiered HITL

建议至少定义三档：

```text
Tier 1 — Autonomous
Tier 2 — Notify
Tier 3 — Approve
```

AWS 当前 Agentic AI Lens 正是以 autonomous / notify / approve 三类来表达风险分级，并要求分类逻辑由确定性规则实现，而不是交给 LLM。

例如：

| 操作                            | 风险        | HITL                 |
| ----------------------------- | --------- | -------------------- |
| 搜索内部研究                        | Low       | No                   |
| 生成研究摘要                        | Low       | No                   |
| 生成投资 Memo                     | Medium    | Notify / Review      |
| Publish Investment Idea       | High      | Approve              |
| External Client Communication | High      | Approve              |
| Trade Execution               | Very High | Multi-review         |
| Fund Transfer                 | Very High | Strong multi-control |

具体阈值应由业务风险框架定义，而不是 Agent 自己判断。

---

# 26. 风险分类必须确定性

非常危险的设计：

```text
LLM:
"我觉得这个操作风险比较低，
所以不需要人工审批。"
```

错误。

正确：

```text
Command
   ↓
Deterministic Risk Classifier
   ↓
Risk Tier
   ↓
Policy
   ↓
HITL requirement
```

例如：

```text
command = publish
resource = investment_idea
portfolio = institutional
amount = X
riskClass = high
```

然后：

```text
Risk Tier = Tier 3
→ requires 2 reviewers
```

AWS 明确建议风险分类使用 deterministic logic，而不要让暴露于同一不可信输入中的 LLM 自己判断是否属于低风险。

---

# 27. Human Review 的质量比 Review 数量重要

真正需要监控的不只是：

```text
approval count
```

还应该监控：

```text
approval rate
average review time
rejection rate
change-request rate
escalation rate
override rate
rubber-stamping indicators
reviewer workload
```

例如：

```text
Reviewer A

100 approvals/hour
99.8% approval rate
average review time = 0.8 sec
```

这应该触发：

```text
Review Quality Alert
```

因为很可能人工监督已经名存实亡。

AWS 当前已经将 reviewer workload、queue depth、average review time、approval rate 以及 rubber-stamping 监控列为 Human Oversight 的成熟度指标。

---

# 28. Human-in-the-loop 最大的风险之一：Automation Bias

HITL 并不天然安全。

一个非常危险的心理过程：

```text
AI:
    "Risk = Low"

Human:
    "AI 都说 Low，那应该没问题。"
```

最后：

```text
Human Review
=
AI Confirmation
```

NIST 相关材料指出 Human-AI Teaming 存在 automation bias，即人可能过度相信算法输出，即使自己的判断与算法不一致也不愿意推翻模型。

2025 年的实验研究也发现，任务设计和 AI 输出质量会显著影响人是否纠正 AI，某些工作流设计甚至会增加接受错误建议的倾向。

因此设计上应该主动支持：

```text
AI Recommendation
+
Counter Evidence
+
Uncertainty
+
Known Limitations
```

而不是只显示：

```text
AI Confidence: 97%
```

---

# 29. 不要只给 Reviewer 一个 Confidence Score

例如：

```text
Confidence = 0.96
```

很容易产生：

```text
"96%，应该没问题。"
```

更有用的是：

```text
Evidence quality
Data freshness
Source diversity
Policy result
Contradiction count
Missing information
Known limitations
Risk tier
```

例如：

```text
Evidence:
8 sources

Contradictory:
2 sources

Latest data:
30 days old

Missing:
Client suitability data

Policy:
PASS

Risk:
HIGH
```

这比：

```text
Confidence = 96%
```

更有决策价值。

---

# 30. Agent 应该帮助 Reviewer 找异常，而不是告诉 Reviewer 点哪里

高质量 Agent Review Assistant：

```text
"这里可能存在问题：

1. AI 使用的数据只更新到 30 天前
2. 两份来源存在矛盾
3. 当前结论依赖一个未经验证的假设
4. 过去 20 个类似 Case 中有 3 个最终被拒绝
"
```

低质量 Agent：

```text
"Recommendation: Approve"
```

前者是在增强人的判断。

后者是在替人做判断。

---

# 31. Human Review 应该是“evidence-first”

推荐 Review UI：

```text
┌──────────────────────────────────┐
│ Business Case                    │
├──────────────────────────────────┤
│ Proposed Action                  │
├──────────────────────────────────┤
│ AI Summary                       │
├──────────────────────────────────┤
│ Supporting Evidence              │
├──────────────────────────────────┤
│ Contradicting Evidence           │
├──────────────────────────────────┤
│ Policy Checks                    │
├──────────────────────────────────┤
│ Exceptions / Missing Data        │
├──────────────────────────────────┤
│ Previous Decisions               │
├──────────────────────────────────┤
│ Potential Impact                 │
├──────────────────────────────────┤
│ Reviewer Decision                │
│                                  │
│ [Approve] [Reject] [Changes]     │
└──────────────────────────────────┘
```

而不是：

```text
┌──────────────────┐
│ Agent says: PASS │
│                  │
│ [Approve]        │
└──────────────────┘
```

---

# 32. 多人协作需要“共享上下文”，但不能“共享所有数据”

多人业务需要共享 Case Context：

```text
Case
Research
Decisions
Evidence
Workflow State
```

但不代表所有参与者应该看到所有内容。

例如：

```text
Analyst
    ↓
Research Data

Compliance
    ↓
Compliance-relevant Data

PM
    ↓
Investment Data

Operations
    ↓
Execution Data
```

所以：

```text
Shared Case
```

和：

```text
Shared Data Access
```

必须分开。

最终：

```text
Case
+
Role
+
Data Entitlement
→
Visible Context
```

这对于金融机构尤其重要，因为协作范围和数据访问范围并不天然相同。

---

# 33. Agent 也应该具有“角色化上下文”

不要让 Agent 在整个 Case 上拥有：

```text
Everything
```

而应该根据当前 Human Task / Workflow Node 创建：

```text
Scoped Agent Context
```

例如：

```text
Compliance Task
    ↓
Agent Capability:
    read compliance documents
    read case evidence
    run policy checks
```

而不是：

```text
Compliance Agent
    ↓
full customer DB
full portfolio DB
trade execution
```

这样：

> **Human Role、Workflow Node、Agent Capability、Data Entitlement 可以形成一致的最小权限边界。**

---

# 34. Reviewer 是否可以直接修改 Agent 结果？

应该明确区分：

```text
AI Output
```

与：

```text
Human Decision
```

例如：

```text
AI Research Memo
```

Reviewer 可以：

```text
comment
request_changes
add evidence
correct factual error
```

但不应把：

```text
Human edited text
```

静默覆盖成：

```text
AI original output
```

应该保留版本：

```text
AI Output v1
Human Correction v1
Final Case Artifact v2
```

否则未来无法知道：

> 哪些是 AI 产生的，哪些是人修改的。

---

# 35. “Request Changes” 比 Reject 更重要

真实金融业务经常不是：

```text
Approve
Reject
```

而是：

```text
Not enough evidence
Please add:
- source X
- disclosure Y
- analysis Z
```

因此推荐：

```text
APPROVE
REJECT
REQUEST_CHANGES
```

Workflow：

```text
REQUEST_CHANGES
      ↓
Agent Task / Human Task
      ↓
New Version
      ↓
Review Again
```

这比把所有问题都当 Reject 更符合现实业务。

---

# 36. 修改后必须重新评估

特别重要：

```text
AI draft
   ↓
Human requests change
   ↓
Agent changes document
```

不能直接：

```text
→ Continue
```

而应该：

```text
New Artifact Version
      ↓
Re-run affected checks
      ↓
Re-run affected approvals
```

例如：

```text
Compliance approved v3

AI modifies disclosure
→ v4

Compliance approval v3
≠
Compliance approval v4
```

必须判断：

```text
change impact
```

决定：

```text
no re-review
partial re-review
full re-review
```

这也是为什么 Approval 应该绑定：

```text
version / hash
```

---

# 37. Escalation 不只是“换个人审批”

真正成熟的 Escalation 可能包括：

```text
Reviewer unavailable
      ↓
Backup reviewer

Reviewer rejects
      ↓
Senior reviewer

Reviewers disagree
      ↓
Control function

Policy conflict
      ↓
Compliance / Risk

Agent anomalous
      ↓
Containment / Incident
```

因此 Escalation 本身也是 Workflow State。

例如：

```text
IN_REVIEW
   ↓
ESCALATED
   ↓
SENIOR_REVIEW
```

而不是简单修改：

```text
assignedUser
```

---

# 38. 高风险业务应使用“多道防线”

金融 Agent 的 HITL 不应该只依靠：

```text
Human Approval
```

而应该：

```text
Agent Guardrails
       ↓
Deterministic Gate
       ↓
Policy
       ↓
Human Review
       ↓
Domain Validation
       ↓
Command
       ↓
Audit
```

这形成 Defense in Depth。

其中：

```text
Agent
```

即使犯错：

```text
Policy
```

仍然可以拒绝。

即使 Policy 配置错误：

```text
Domain
```

仍然可以拒绝违反业务不变量的请求。

即使执行失败：

```text
Idempotency / Recovery
```

仍然可以避免产生第二次副作用。

---

# 39. Human Review 的两个方向：Before 与 After

传统 HITL 常常只关注：

```text
Before execution
```

但金融场景还需要：

```text
After execution
```

例如：

```text
Agent proposed
    ↓
Human approved
    ↓
Command executed
    ↓
Post-execution monitoring
```

如果发现：

```text
unexpected behavior
```

应该：

```text
stop
contain
rollback / compensate
escalate
```

AWS 当前 Agentic AI Lens 将 Human Oversight、behavioral anomaly detection 和 containment 放在一起考虑，而不是把“人工审批”作为唯一控制。

---

# 40. Reviewer 是生产资源，不是无限容量

这是很多 Workflow 系统忽略的问题。

假设：

```text
Agent 一天产生 20,000 个 Review
```

而：

```text
20 个 Reviewer
```

实际最多只能处理：

```text
3,000
```

那么所谓：

```text
Human-in-the-loop
```

实际上变成：

```text
Human-in-the-bottleneck
```

因此需要：

```text
Queue
Priority
SLA
Load Balancing
Capacity
Escalation
```

AWS 当前已经把 reviewer workload、queue depth 和最大 review rate 纳入 Human Oversight 的工程设计。

---

# 41. Review Queue 应支持风险优先级

例如：

```text
P0:
Trade execution

P1:
External client communication

P2:
Investment publication

P3:
Internal document update
```

Queue：

```text
P0
 ↓
P1
 ↓
P2
 ↓
P3
```

而不是：

```text
FIFO
```

否则真正危险的操作可能排在大量普通 Review 后面。

---

# 42. Reviewer workload 本身应该进入风险模型

例如：

```text
Reviewer A
```

已经：

```text
reviewed 500 cases today
```

那么即使 Policy 允许：

```text
assign to A
```

Workflow 也应该考虑：

```text
workload threshold
```

可能：

```text
→ assign B
→ escalate
```

这里不是 Authorization，而是：

```text
Operational Safety
```

---

# 43. Human Review 需要明确 SLA

例如：

```text
Critical:
15 minutes

High:
1 hour

Normal:
1 business day
```

超时：

```text
SLA breached
    ↓
Escalation
```

而不是：

```text
Agent continues waiting forever
```

这样 Workflow 才具有可运营性。

---

# 44. Approver 必须看到“为什么现在需要我”

一个好的审批任务不应该只有：

```text
Please approve.
```

应该明确：

```text
Why this task exists
What decision is needed
What will happen after approval
What happens after rejection
What policy triggered this review
What risks are involved
```

例如：

```text
You are reviewing this action because:

Risk Tier:
HIGH

Policy:
Investment publication requires Compliance approval.

After approval:
The system will publish Investment Idea #1234.

After rejection:
The case will enter REJECTED state.
```

这能够显著减少“机械点击”。

---

# 45. Approval 是一个事实，不是一个按钮事件

数据库里最终应该保存的是：

```text
Approval Record
```

而不是：

```text
buttonClicked = true
```

例如：

```text
Approval
├── approvalId
├── caseId
├── executionId
├── nodeId
├── reviewer
├── role
├── decision
├── reason
├── caseVersion
├── commandHash
├── policyVersion
├── createdAt
└── decidedAt
```

这样未来可以回答：

```text
谁批准的？
以什么身份？
在什么 Case Version 上批准？
批准的具体 Command 是什么？
当时依据什么 Policy？
```

---

# 46. 不要把 Reviewer 的“意见”与“决定”混在一起

例如：

```text
Comment:
"The disclosure section could be stronger."

Decision:
APPROVE
```

这两个信息都应该保存。

因为：

```text
Comment
```

可能只是建议。

而：

```text
Decision
```

才是正式业务事实。

因此：

```text
Review Feedback
+
Decision
```

分离存储。

---

# 47. Agent 可以参与 Reviewer 协作，但不能伪装成人

例如：

```text
Compliance Reviewer
```

旁边可以有：

```text
AI Review Assistant
```

帮助：

```text
highlight anomaly
find evidence
summarize policy
compare historical cases
```

但是最终记录应该：

```text
Decision By:
User B
```

而不能：

```text
Decision By:
Compliance Agent
```

除非该操作明确被定义为允许自主执行，并由适当的系统身份和 Policy 承担责任。

BIS 对金融 AI 的治理讨论中特别强调了 accountability：AI 输出不能消除责任主体。

---

# 48. Human-to-Human 协作和 Human-to-Agent 协作应该统一到 Workflow

一个成熟系统应该允许：

```text
User A → User B
```

也允许：

```text
User A → Agent
```

还允许：

```text
Agent → User B
```

但是最终都由：

```text
Workflow
```

统一管理。

例如：

```text
Task
   │
   ├── Human
   │
   ├── Agent
   │
   └── Human + Agent
```

这样 Agent 只是另一种 Executor。

这也是 Microsoft Agent Framework 把 Agent orchestration、HITL request/response、checkpoint/resume 放到统一 Workflow 模型中的原因。

---

# 49. 一个完整的金融业务示例

以 Investment Idea 为例：

```text
                    ┌──────────────┐
                    │ Analyst      │
                    └──────┬───────┘
                           │
                      Create Case
                           │
                           ▼
                    ┌──────────────┐
                    │ AI Research  │
                    └──────┬───────┘
                           │
                    Research Result
                           │
                           ▼
                    ┌──────────────┐
                    │ Quality Gate │
                    └──────┬───────┘
                           │
                           ▼
               ┌───────────────────────┐
               │ Compliance Review     │
               │                       │
               │ Human + AI Assistant  │
               └──────────┬────────────┘
                          │
                  ┌───────┴───────┐
                Reject          Approve
                  │                │
                  ▼                ▼
               Rejected       PM Review
                                │
                         ┌──────┴──────┐
                       Changes       Approve
                         │              │
                         ▼              ▼
                    Research v2     Publish
                                        │
                                        ▼
                                   Operations
```

这里 AI 贯穿整个流程：

```text
Research
Compliance Assistant
PM Decision Support
Operations Preparation
```

但真正的 Business Authority 仍然属于：

```text
Workflow
Policy
Human
Domain
```

---

# 50. 当前项目的推荐映射

当前项目已经具备很接近这套模型的基础。

可以对应成：

```text
Business Case
    ↓
Execution

AI Work
    ↓
@task

Deterministic Review
    ↓
@gate

Human Review
    ↓
@review

Business Mutation
    ↓
@command

Human Task
    ↓
HumanTaskService

Approval Rules
    ↓
ApprovalPolicy / Policy

Business Execution
    ↓
CommandService / Domain API
```

尤其应该坚持：

```text
@review
```

不是：

```text
Agent asks user:
"Approve?"
```

而是：

```text
Workflow
  ↓
HumanTask
  ↓
Durable WAITING state
  ↓
Reviewer
  ↓
Decision
  ↓
Policy verification
  ↓
Workflow resume
```

这与 Microsoft 当前的 request/response + checkpoint/resume 模式以及 AWS 的 Step Functions callback / approval pattern 是一致的。

---

# 51. 当前项目中应该特别保持的几个设计

### 51.1 `waiting_for_approval` 必须是持久状态

不要让：

```text
approval waiting
```

只存在内存。

---

### 51.2 Callback 必须校验 Workflow Context

Approval 回调至少验证：

```text
executionId
taskId
currentNode
workflowVersion / sourceHash
waiting status
```

避免：

```text
old approval
```

推进：

```text
new workflow state
```

---

### 51.3 Approval 必须绑定 Proposal Version

例如：

```text
commandHash
resourceVersion
caseVersion
```

任何一个发生关键变化：

```text
re-review
```

---

### 51.4 Re-approval 必须保持原 Authorization Boundary

如果：

```text
@command publish
role: investment.reviewer
```

第一次需要审批，后来因为 resourceVersion mismatch 重新审批：

```text
reapprove
```

不能重新回到：

```text
base command policy
```

必须继续使用：

```text
restrictRoles
```

否则第一次审批的授权边界会在 retry / reapproval 中被扩大。

---

# 52. HITL 应该有明确的状态机

推荐：

```text
PENDING
   │
   ▼
ASSIGNED
   │
   ▼
IN_REVIEW
   │
   ├── APPROVED ────────→ COMPLETED
   │
   ├── REJECTED ────────→ REJECTED
   │
   ├── CHANGES_REQUESTED → WORKFLOW
   │
   ├── ESCALATED ───────→ ESCALATED_REVIEW
   │
   └── EXPIRED ─────────→ TIMEOUT_POLICY
```

Workflow 自己则：

```text
RUNNING
   ↓
WAITING_FOR_REVIEW
   ↓
RESUMED
   ↓
RUNNING
```

这样：

```text
Human Task State
```

和：

```text
Workflow State
```

可以相互验证。

---

# 53. Stale Approval 必须安全失败

例如：

```text
Workflow:
Compliance Review

Reviewer approved.

Meanwhile:
Case changed.

Old callback arrives.
```

不能：

```text
resume blindly
```

应该：

```text
currentTask != callbackTask
       ↓
stale callback
       ↓
audit
       ↓
do not advance
```

这样：

> **旧的人类决定不能推进新的业务状态。**

---

# 54. Human Approval 的安全模型

最终可以形成：

```text
                    Human
                      │
                 explicit decision
                      │
                      ▼
                Human Task
                      │
                 identity
                 role
                 scope
                      │
                      ▼
                   Policy
                      │
               authorized?
                      │
                      ▼
                  Workflow
                      │
                correct state?
                      │
                      ▼
                  Command
                      │
                version/hash
                      │
                      ▼
                   Domain
                      │
              invariant valid?
                      │
                      ▼
               Business State
```

这里至少有四道关：

```text
Human Decision
Policy
Workflow
Domain
```

任何一层失败：

```text
stop
```

---

# 55. 何时应该一个人，何时应该多人

不建议简单规定：

```text
High Risk = 2 people
```

而应该根据：

```text
Impact
Reversibility
Financial Exposure
Customer Impact
Regulatory Impact
Data Sensitivity
Conflict of Interest
Operational Criticality
```

定义。

例如：

### 低风险

```text
Agent Draft
```

可能：

```text
No approval
```

### 中风险

```text
Internal publication
```

可能：

```text
Notify
or Single Review
```

### 高风险

```text
External client communication
```

可能：

```text
Single approval
```

### 极高风险

```text
Trade / Payment / Transfer
```

可能：

```text
Two-person control
+
Independent review
```

这里的具体风险等级应由机构自身风险框架定义，而不是由 Agent 平台擅自规定。

---

# 56. HITL 的正确目标不是“Human Everywhere”

最差的设计：

```text
Agent
 ↓
Human
 ↓
Human
 ↓
Human
 ↓
Human
```

最后：

```text
AI 做了 90%
Human 点了 20 次按钮
```

这只是把自动化变成审批地狱。

AWS 对这一点明确提出：所有动作都人工审批会导致瓶颈和 rubber-stamping。

更好的目标：

```text
Low Risk
    → autonomous

Medium Risk
    → notify / exception

High Risk
    → human review

Critical Risk
    → independent multi-review
```

也就是：

> **把人的时间集中到“人的判断真正改变结果”的地方。**

---

# 57. Human Oversight 的成熟度

可以建立四级模型：

### Level 1 — Human Button

```text
AI
 ↓
Approve?
```

只是最基础的 HITL。

### Level 2 — Structured Review

```text
Evidence
Policy
Impact
Action
 ↓
Human decision
```

### Level 3 — Risk-tiered Oversight

```text
Low → auto
Medium → notify
High → approve
Critical → multi-review
```

### Level 4 — Measured Oversight

进一步监控：

```text
Reviewer workload
Approval rate
Review time
Override rate
Escalation rate
False approval
False rejection
Drift
```

并根据结果重新调整流程。

AWS 当前 Agentic AI Lens 将 reviewer workload、decision quality、rubber-stamping、risk tier 和 escalation 都纳入更成熟的人机监督体系。

---

# 58. 为什么金融领域特别需要这种设计

金融领域的关键不是“AI 能否做得比人快”。

而是：

```text
Who is responsible?
Who can decide?
Who can execute?
Who reviewed?
Based on what?
Under which rule?
What happens if it is wrong?
Can the action be stopped?
Can the decision be reconstructed?
```

DORA 要求金融实体保持 ICT 风险治理、职责、数据保护和运营韧性；而金融 AI 监管研究同样持续强调 accountability、human oversight、模型治理和第三方风险。

因此：

> **Human-in-the-loop 的核心不是“保留一个人”，而是保留明确的人类责任、判断和控制能力。**

---

# 59. 最容易出现的反模式

## Anti-pattern 1：Rubber-stamp HITL

```text
AI:
Approve

Human:
OK
```

---

## Anti-pattern 2：所有操作都需要人工批准

结果：

```text
Reviewer fatigue
Queue backlog
Slow workflow
Approval shortcuts
```

---

## Anti-pattern 3：AI 直接通知某个人聊天

```text
Agent → Teams message
"Please approve"
```

然后把回复：

```text
yes
```

当正式 Approval。

缺乏：

```text
Identity
Scope
Version
Hash
Policy
Audit
```

---

## Anti-pattern 4：审批后内容继续变化

```text
Approve v1
   ↓
Agent modifies to v2
   ↓
Execute v2
```

这是严重的审批边界问题。

---

## Anti-pattern 5：Reviewer 看不到 Evidence

```text
AI recommendation
+
Approve button
```

人无法有效判断。

---

## Anti-pattern 6：Reviewer 一定看到前一个 Reviewer 的决定

可能产生：

```text
Anchoring
Groupthink
```

关键审批应考虑独立提交。

---

## Anti-pattern 7：Reviewer 无限制接收任务

最终：

```text
Human oversight
=
Human overload
```

---

## Anti-pattern 8：Agent 代表 Reviewer 做决定

```text
Compliance Agent
    ↓
"Approved"
```

而没有明确授权体系。

这会把：

```text
Human Responsibility
```

偷偷转移给 Agent。

---

# 60. 最终设计原则

可以把多人协作 + HITL 总结为 15 条：

```text
1. Business Case is the unit of collaboration.

2. Human Task is a durable business object, not a chat interaction.

3. Approval is a structured decision, not a button click.

4. Assignment and decision authority are separate concepts.

5. Agent assists human judgment; it does not silently assume human responsibility.

6. Human review should be risk-tiered, not universal.

7. Risk classification should be deterministic.

8. Review context must contain evidence, uncertainty, impact and policy results.

9. Approval must bind to a concrete Case / Proposal / Command version.

10. Material changes invalidate or re-scope prior approval.

11. High-risk decisions may require independent multi-review.

12. Reviewer workload and rubber-stamping must be observable.

13. Timeout needs explicit escalation and safe fallback.

14. Human decisions, policy decisions and agent outputs must be separately auditable.

15. When Agent fails, the business case must still be recoverable by humans or an alternative controlled path.
```

---

# 61. 最值得记住的架构模型

最终可以浓缩成：

```text
                       BUSINESS CASE
                             │
                             ▼
                         WORKFLOW
                             │
              ┌──────────────┼──────────────┐
              │              │              │
              ▼              ▼              ▼
           AI TASK       HUMAN TASK      GATE
              │              │              │
              │              ▼              │
              │        HUMAN DECISION       │
              │              │              │
              └──────────────┼──────────────┘
                             ▼
                           POLICY
                             │
                       allow / deny
                             │
                             ▼
                         COMMAND
                             │
                             ▼
                          DOMAIN
                             │
                             ▼
                      BUSINESS STATE
```

其中：

```text
Agent
    = makes work cheaper

Human
    = owns required judgment

Workflow
    = controls process

Policy
    = controls authority

Domain
    = protects business truth
```

因此，真正成熟的金融 HITL 不是：

> **“在 Agent 后面放一个人。”**

而是：

> **“重新设计一个人机共同完成的业务流程，使 AI 负责信息处理和工作执行，人负责需要人类判断和责任承担的决策，而 Workflow、Policy 和 Domain 保证任何一个参与者都不能越过既定的业务控制边界。”**

---

# 62. 与当前项目的直接对应

当前项目的设计可以进一步固化为：

```text
Business Case
        ↓
Workflow Execution
        ↓
 ┌──────┼────────┬─────────┐
 ▼      ▼        ▼         ▼
@task  @gate    @review   @command
 AI    system    human     mutation
work   decision  decision
                  │
                  ▼
             HumanTaskService
                  │
                  ▼
             ApprovalPolicy
                  │
                  ▼
             CommandService
```

其中建议长期坚持以下不变量：

```text
@task
    不创建新的业务授权

@gate
    不依赖 LLM 决策

@review
    必须产生 durable human decision

@command
    必须经过 Policy

approval
    必须绑定具体 workflow / case / command version

resume
    必须重新验证当前状态

replay
    不能重复产生不可逆副作用
```

这样 `HumanTaskService + ApprovalPolicy + WorkflowRunner + CommandService` 实际上已经构成了一个完整的 **Human-in-the-loop Control Plane**。

更重要的是，这个 Control Plane 与 Copilot SDK 本身无关。未来换 Agent Runtime，HITL 的业务语义仍然不变：

```text
Copilot / DeepAgents / OpenAI Agents / other runtime
                    │
                    ▼
                @task
                    │
                    ▼
          Human-in-the-loop Control Plane
                    │
             ┌──────┼──────┐
             ▼      ▼      ▼
          Policy  Review  Command
```

这正是金融 Agent Workflow 应该追求的架构边界。

---

# 参考资料

**AWS — Agentic AI Lens：Human-in-the-loop for critical decisions**
强调按风险和可逆性进行人工审批，避免所有操作都审核导致 rubber-stamping，同时要求上下文、超时、升级和可审计的审批记录。

**AWS — Tiered human oversight and approval workflows**
提出 Autonomous / Notify / Approve 的分级监督，并建议风险分类由确定性逻辑实现。

**AWS — Human oversight protection and agent containment**
进一步讨论 Reviewer workload、rubber-stamping、独立多 Reviewer、盲审、共识逻辑和升级。

**AWS — Cognitive load management**
把 review queue、backlog、review time 和 reviewer workload 纳入人机监督的可靠性设计。

**Microsoft Agent Framework — Human-in-the-loop**
将 HITL 实现为 Workflow request/response、RequestPort、checkpoint 和 resume，并支持需要人工批准的 Tool。

**Microsoft Agent Framework — Workflow Orchestrations**
提供 sequential、concurrent、handoff、group chat 和 magentic 等编排模型，并支持 HITL tool approval。

**OpenAI — A Practical Guide to Building Agents**
强调 human intervention，尤其是在 retry 超限和高风险、不可逆操作时进行人工介入。

**BIS — AI and financial stability / governance**
强调 AI 自动决策可能削弱传统的责任链条，金融机构仍需能够理解和承担 AI 所影响的业务决策责任。

**BIS FSI — Humans keeping AI in check**
讨论金融领域 Human-in-the-loop / Human-on-the-loop 的治理要求及比例原则。

**OECD — Supervision of artificial intelligence in finance, 2026**
总结金融监管对 AI scope、human oversight、模型验证、第三方 AI 风险和可追溯性的关注。

**OECD — AI in Italian financial markets, 2026**
基于 2025 调查描述金融机构的 AI 自主程度和 Human-in-the-loop 采用情况。

**NIST / Human-AI Teaming research**
相关研究指出 automation bias 可能导致人过度依赖模型建议，即使自己的判断与模型不一致。

**2025 Human-AI collaboration experiment**
一项 2,784 人的随机实验显示，AI 输出质量、任务负担以及用户对 AI 的态度都会影响纠错行为和 AI 依赖程度。

**DORA**
要求金融机构建立清晰责任线、内部治理与控制框架、适当职能独立性以及数字运营韧性。

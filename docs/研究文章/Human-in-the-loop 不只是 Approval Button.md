# Human-in-the-loop 不只是 Approval Button

## 一、问题：很多 Agent 系统把 HITL 做成了一个按钮

现在讨论 Agent 架构时，Human-in-the-loop（HITL）经常被简化成一个非常直观的模式：

```text
Agent
  ↓
准备执行一个危险操作
  ↓
弹出 Approval
  ↓
用户点击 Approve
  ↓
继续执行
```

这当然是一种 HITL。

但如果企业 Agent 的 HITL 最终只是：

> Agent 做完所有判断 → 人点一下“批准” → 系统继续执行

那么人很容易退化成一个 **Approval Button**。

这时真正需要问的不是：

> 系统有没有人工审批？

而是：

> **人在整个 Agent 决策和执行过程中，到底能够影响什么？**

这是两个完全不同的问题。

AWS 在 2026 年更新的 Agentic AI Lens 中明确指出，把所有 Agent 动作都交给人工审核会造成 reviewer fatigue 和 rubber-stamp approval；更合理的做法是根据风险和可逆性进行分层监督，只在真正需要人类判断的决策点暂停。

Microsoft Agent Framework 也没有把 HITL 限定为“批准工具调用”。它将 HITL 建模为 Workflow 的 request/response 机制：Workflow 可以暂停、等待外部输入，然后恢复执行；除了 tool approval，还可以请求额外信息、进行多轮交互，并通过 checkpoint 保存等待中的请求。

金融行业正在进一步扩大这个概念。FSB 2026 年关于金融机构负责任采用 AI 的咨询报告，把 Human-in-the-loop、Human-on-the-loop、Human-in-command、Kill Switch 和 Contestability 都作为不同形式的人类监督机制，而不是简单等同于“人工审批”。需要注意，这是一份 consultation report，而不是最终监管规则。

因此：

> **HITL 不是一个 UI 控件，而是一种控制架构。**

---

# 二、HITL 真正要解决的问题是什么

Agent 系统和传统 Workflow 最大的区别之一，是 Agent 可以在执行过程中自主进行：

```text
理解
  ↓
规划
  ↓
选择信息
  ↓
选择工具
  ↓
调整计划
  ↓
处理异常
  ↓
继续执行
```

传统系统通常提前定义：

```text
A → B → C → D
```

Agent 则可能是：

```text
A
 ↓
Agent 判断应该做什么
 ↓
B?
 ↓
重新获取信息
 ↓
C?
 ↓
发现异常
 ↓
改变计划
 ↓
D?
```

因此真正的人机协作问题变成：

> **人应该在哪里进入这个决策循环，以及人进入后能够改变什么？**

不是简单的：

> “最后让人点一次批准。”

可以把 HITL 理解为：

```text
                 Agent Runtime
                      │
            ┌─────────▼─────────┐
            │ Observe / Reason  │
            │ Plan / Act        │
            └─────────┬─────────┘
                      │
              Oversight Policy
                      │
        ┌─────────────┼─────────────┐
        │             │             │
      Continue      Ask Human     Escalate
        │             │             │
        │        ┌────▼────┐        │
        │        │ Human   │        │
        │        │ Decision│        │
        │        └────┬────┘        │
        │             │             │
        └─────────────▼─────────────┘
                      │
                  Resume / Stop
```

人类不是只负责：

```text
Approve / Reject
```

而可能负责：

```text
Clarify
Correct
Choose
Approve
Reject
Modify
Override
Escalate
Stop
```

---

# 三、Approval 只是 HITL 的一种形式

可以把 Agent 系统中的人工介入至少分成以下几种。

## 1. Clarification：补充信息

这是最容易被忽略的一类。

Agent 并不是一定需要一个 Yes/No。

它可能真正需要的是：

> “这个 Proposal 是针对哪个 Portfolio？”

或者：

> “这里的‘本周’是指交易日还是自然日？”

或者：

> “你希望按照现有客户授权额度处理，还是需要走例外流程？”

此时正确的动作不是：

```text
Approve / Reject
```

而是：

```text
Agent
  ↓
需要额外信息
  ↓
Ask Human
  ↓
得到信息
  ↓
继续 Planning
```

Microsoft Agent Framework 明确把这种模式作为 request/response 和 interactive handoff 的一部分，而不是单纯的 tool approval。

---

# 四、Correction：让人修改 Agent 的判断

很多 HITL 设计只有：

```text
Approve
Reject
```

实际上还需要：

```text
Edit
Correct
Constrain
```

例如 Agent 产生：

```text
Trade Proposal

Buy:
1,000 shares

Reason:
portfolio rebalance
```

人工发现：

> 数量应该是 600，而不是 1,000。

这里最自然的交互不是：

```text
Reject
```

因为 Reject 会让 Agent 重新从头开始。

更好的机制是：

```text
Agent Proposal
      ↓
Human Correction
      ↓
Adjusted Proposal
      ↓
Policy Validation
      ↓
Command
```

这时 Human 并不是单纯的 gate。

而是在：

> **修改 Agent 的中间产物。**

这对于复杂业务尤其重要。

---

# 五、Choice：人在多个可行路径之间做选择

有些 Agent 可以找到多个合法方案：

```text
Option A
Option B
Option C
```

而系统无法仅靠规则决定哪个最好。

这时可以让 Agent：

```text
生成候选方案
    ↓
解释差异
    ↓
Human chooses
    ↓
继续执行
```

例如投资研究流程：

```text
Research Agent
    ↓
识别三个可能方向

A：增加仓位
B：保持仓位
C：降低仓位
    ↓
Portfolio Manager
选择一个
    ↓
Workflow继续
```

此时人并不是审核 Agent 是否“做对了”。

而是：

> **人承担业务决策本身。**

---

# 六、Approval：批准一个已经定义好的动作

Approval 仍然非常重要。

但 Approval 最好理解成：

> 人对一个已经形成明确边界的 Proposed Action 进行授权确认。

例如：

```text
Proposal
{
  caseId: "INV-1024",
  action: "SUBMIT_PROXY_VOTE",
  security: "...",
  meeting: "...",
  vote: "FOR",
  quantity: 125000,
  targetSystem: "ISS"
}
```

然后：

```text
Policy
    ↓
Authorization
    ↓
Human Approval
    ↓
Command
```

这里有一个非常重要的原则：

> **Human Approval ≠ Authorization**

人工批准不能自动替代：

```text
Entitlement
Policy
Authorization
Segregation of Duties
Domain Validation
```

如果用户本身没有权限，即使点击了 Approval，也不应该因为“人批准了”就绕过企业授权边界。

---

# 七、Override：人可以强制改变系统行为

在长期运行的 Agent 中，必须考虑：

> 如果 Agent 明显走错了，人能不能直接改变它？

例如：

```text
Agent
  ↓
连续执行异常
  ↓
Human Operator
  ↓
Pause
  ↓
Inspect
  ↓
Change instruction / scope
  ↓
Resume
```

这里的 Human Intervention 发生在：

```text
执行过程中
```

而不是：

```text
执行之前
```

这也是 Human-on-the-loop 与传统 Human-in-the-loop 的一个重要区别。

---

# 八、Stop：人可以直接停止 Agent

对于 Agent 系统，Human Oversight 不应该只有：

```text
Approve
Reject
```

还应该有：

```text
Pause
Cancel
Stop
Disable
Degrade
```

尤其是：

```text
Long-running Agent
Autonomous Agent
Multi-agent workflow
Production operations
Trading / financial operations
```

系统需要回答：

> 如果 Agent 已经开始连续调用工具，人怎么让它停下来？

这不是 UI 问题。

这是 Control Plane 问题。

例如：

```text
Human
  ↓
Stop Request
  ↓
Control Plane
  ↓
Execution Cancellation
  ↓
Tool Invocation Block
  ↓
Agent Runtime停止
```

FSB 2026 年咨询报告已经把 Kill Switch 单独列为一种 Human Oversight 形式，并包括完全停止以及把系统从 autonomous 模式降级到 human operation 的机制。

---

# 九、Escalation：人不一定自己解决，而是把问题交给更合适的人

这也是 Approval Button 无法表达的。

例如：

```text
Agent
  ↓
发现异常
  ↓
普通 Reviewer
  ↓
无法判断
  ↓
Escalate
  ↓
Senior Reviewer
  ↓
Compliance
  ↓
Legal
```

因此 HITL 应该支持：

```text
Reviewer
Reviewer Role
Escalation Rule
Escalation SLA
Fallback Reviewer
```

AWS 当前 Agentic AI Lens 也明确要求高风险人工审核具有 escalation path，避免主要 reviewer 不可用导致 Agent 永久停滞。

---

# 十、Post-action Review：人可以在执行之后介入

HITL 不一定发生在 action 前。

对于低风险、大规模 Agent 系统，可以采用：

```text
Agent executes
      ↓
Sample / Monitor
      ↓
Human Review
      ↓
发现问题
      ↓
Correct / Retrain / Change Policy
```

例如：

```text
10,000 次低风险客户服务 Agent 操作
          ↓
自动执行
          ↓
抽样 1%
          ↓
人工复核
```

这个模式在大规模 Agent 中可能比：

```text
10,000 × human approval
```

更现实。

但这并不意味着事后审核能够替代所有事前控制。

对不可逆的高风险操作：

```text
Post-review
```

通常太晚了。

---

# 十一、HITL 的核心不是“人在哪里”，而是“人能改变什么”

因此设计 HITL 时，最好从：

```text
Human Involvement
```

升级到：

```text
Human Authority
```

可以问五个问题：

```text
1. Human 能否改变输入？

2. Human 能否改变计划？

3. Human 能否改变参数？

4. Human 能否阻止执行？

5. Human 能否推翻结果？
```

如果五个问题的答案都是否：

那么这个系统可能只是：

> Human Notification

而不是真正有意义的 Human Oversight。

---

# 十二、真正有意义的 Human Oversight，需要什么条件

人工参与并不自动意味着有效监督。

这是 HITL 最容易被忽略的问题。

研究长期发现，人对自动化系统存在 Automation Bias：

> 人可能因为系统看起来可靠，而过度接受系统建议。

系统综述发现，自动化偏差不仅发生在复杂、多任务场景，在需要较高验证复杂度的任务中同样可能出现；相关研究也发现，信任、任务复杂度、工作负荷和时间压力等都会影响人对自动化结果的依赖。

因此：

```text
Human Review
≠
Meaningful Human Review
```

一个人看到：

```text
[Approve] [Reject]
```

不代表这个人真的能够判断。

---

# 十三、Approval UI 最大的问题：人可能没有足够的信息

假设系统显示：

```text
Agent wants to execute:

Transfer $2,000,000

[Approve] [Reject]
```

这个 UI 看起来完成了 HITL。

实际上 Reviewer 不一定知道：

```text
为什么要做？
数据来自哪里？
谁提出的？
用了哪个规则？
有没有其他方案？
有什么风险？
这是第一次还是重复操作？
授权范围是什么？
这个 approval 是否已经过期？
如果执行成功会改变什么？
```

因此真正的 Approval Context 应该至少包含：

```text
Business Context
Proposed Action
Parameters
Relevant Evidence
Policy Result
Authorization Result
Risk Classification
Potential Impact
Alternative Options
Human Accountability
Expiry
```

重点是：

> **给人足够做决定的信息。**

但这不意味着需要把模型的完整内部推理链直接展示给 Reviewer。

企业系统更应该提供：

```text
Decision summary
Evidence
Source references
Policy results
Relevant facts
Proposed action
Potential consequences
```

而不是依赖所谓“完整 Chain of Thought”。

---

# 十四、一个好的 Human Task 应该长什么样

可以把 Human Task 建模成一个一等业务对象：

```text
HumanTask
{
  id
  caseId
  workflowId

  taskType

  requestedBy
  assignedTo
  reviewerRole

  proposedAction
  parameters

  evidence
  policyResults
  authorizationResult

  riskLevel
  impact
  reversibility

  expiresAt

  decision
  decisionReason

  createdAt
  decidedAt
}
```

它不应该只是：

```text
approval = true / false
```

因为：

```text
Approval
```

只是 Human Task 的一个结果。

---

# 十五、Approval Scope 必须是明确的

一个非常危险的设计是：

```text
Agent：
“我已经获得批准。”
```

然后 Agent 自己理解：

> “类似的操作也应该被批准。”

这是 Approval Scope Creep。

正确设计应该明确：

```text
Approval
    ↓
Scope
```

例如：

```text
Case = INV-1024

Action = SUBMIT_PROXY_VOTE

Security = ABC

Vote = FOR

Maximum Quantity = 125,000

Target = ISS

Valid Until = 16:00 JST
```

Approval 只能覆盖：

```text
这个明确范围
```

不能自动扩大成：

```text
所有 Proxy Vote
```

AWS 对持久信任也提出类似要求：如果采用 persistent trust，应把授权绑定到具体 command、参数范围或资源，并避免没有参数范围的 wildcard trust。

---

# 十六、Approval 还必须考虑“过期”

Agent Workflow 与传统表单最大的区别之一，是：

```text
Approval
```

和：

```text
Execution
```

之间可能存在很长时间。

例如：

```text
10:00 Agent生成Proposal

10:05 Human批准

12:30 Agent恢复

13:00 执行
```

中间发生了什么？

```text
Market changed
Position changed
Entitlement changed
Policy changed
Risk changed
User authorization changed
Business state changed
```

因此：

> Approval 不是一个永久授权令牌。

应该考虑：

```text
Approval TTL
Policy Version
Authorization Snapshot
Business State Version
Re-validation
```

例如：

```text
Human Approval
      ↓
Resume Workflow
      ↓
Re-check:
  Policy
  Authorization
  Business State
      ↓
Execute
```

这样才能避免：

> “人确实批准过，但批准时和实际执行时已经不是同一件事。”

---

# 十七、HITL 应该是一个闭环，而不是一个点

可以把完整 HITL 设计成：

```text
                   ┌───────────────────────┐
                   │     Agent Runtime     │
                   │                       │
                   │ Reason / Plan / Act   │
                   └──────────┬────────────┘
                              │
                        Risk Evaluation
                              │
                  ┌───────────┴───────────┐
                  │                       │
               Low Risk                High Risk
                  │                       │
              Continue              Human Task
                                          │
                               ┌──────────▼──────────┐
                               │      Human          │
                               │                     │
                               │ Clarify              │
                               │ Correct              │
                               │ Choose               │
                               │ Approve              │
                               │ Reject               │
                               │ Escalate             │
                               │ Override             │
                               │ Stop                 │
                               └──────────┬──────────┘
                                          │
                           ┌──────────────┼───────────────┐
                           │              │               │
                        Resume          Escalate        Stop
                           │
                           ▼
                     Re-validation
                           │
                           ▼
                     Command / Tool
                           │
                           ▼
                     Business State
                           │
                           ▼
                       Audit
```

这里真正重要的是：

> **Human Decision → Workflow State → Re-validation → Execution**

而不是：

> Human → Button → Agent。

---

# 十八、什么时候应该让人介入？

不应该简单使用：

```text
High Risk = HITL
Low Risk = No HITL
```

因为风险不是唯一变量。

更合理的是：

```text
Risk
×
Impact
×
Reversibility
×
Uncertainty
×
Autonomy
×
Blast Radius
×
Human Expertise
```

例如：

| 场景            | Risk | 可逆性 | 推荐监督                                          |
| ------------- | ---- | --- | --------------------------------------------- |
| 文档摘要          | 低    | 高   | 自动                                            |
| 内部研究建议        | 低/中  | 高   | Review / Sampling                             |
| 生成投资 Proposal | 中    | 高   | Human choice                                  |
| 修改业务 Case     | 中    | 中   | Review                                        |
| 提交 Proxy Vote | 高    | 低/中 | Explicit approval                             |
| 交易执行          | 很高   | 低   | Strong approval / dual control                |
| 删除大量数据        | 很高   | 很低  | Confirmation + policy + possibly dual control |
| Agent 持续异常运行  | 高    | 不适用 | Kill switch / escalation                      |

AWS 当前推荐的也是 risk-tiered human oversight，而不是所有动作统一人工审批。

---

# 十九、Human-in-the-loop、Human-on-the-loop、Human-in-command

这三个概念最好不要混在一起。

## Human-in-the-loop

人在具体决策路径中。

```text
Agent
 ↓
Human
 ↓
Continue
```

典型：

```text
Approve
Correct
Choose
```

---

## Human-on-the-loop

Agent 可以自行运行。

人主要：

```text
Monitor
Intervene when necessary
Handle exceptions
```

例如：

```text
Agent
  ↓
执行 1,000 个低风险任务
  ↓
Monitoring
  ↓
异常才通知 Human
```

---

## Human-in-command

人负责：

```text
Define autonomy
Define scope
Define policies
Define thresholds
Set escalation
Set kill switch
Review aggregate outcomes
```

这时人不一定参与每次执行。

而是：

> **控制 Agent 可以做什么。**

FSB 2026 的咨询报告正是把 Human-in-command 用于高自主 Agent 场景，并将其定义为包括设定自主程度、护栏和整体影响管理的高层监督。

---

# 二十、因此，“HITL”其实是多个控制层

如果从企业 Agent Architecture 来看，可以分为：

```text
                    Human Oversight
                          │
      ┌───────────────────┼────────────────────┐
      │                   │                    │
   Design-time         Run-time             Post-run
      │                   │                    │
  Autonomy level       Approval             Sampling
  Policy               Clarification        Audit
  Tool scope            Correction           Feedback
  Limits                Override             Evaluation
  Escalation            Stop                 Policy update
```

这比简单的：

```text
Approval Button
```

完整很多。

---

# 二十一、金融 Agent 尤其不能把 HITL 等同于 Approval

金融业务有一个特别重要的问题：

> **Human Approval 不能替代业务控制。**

例如一个 Trade Agent：

```text
Agent proposes trade
        ↓
Portfolio Manager approves
```

仍然需要：

```text
Entitlement
     ↓
Limit
     ↓
Compliance
     ↓
Risk
     ↓
Authorization
     ↓
Command
     ↓
Execution
```

即使：

```text
Human = Approved
```

也不能绕过：

```text
Policy
Authorization
Domain Invariant
```

所以更准确的模型是：

```text
Agent Proposal
      ↓
Risk Classification
      ↓
Policy
      ↓
Authorization
      ↓
Human Decision
      ↓
Re-validation
      ↓
Command
      ↓
Domain
      ↓
Side Effect
```

这也符合当前 AWS 对 Agent Tool Authorization 的设计：每次工具调用应经过外部策略授权，高风险变更操作可以通过 HITL checkpoint 拦截。

---

# 二十二、一个真实的金融 Workflow 示例：Proxy Voting

假设有一个 Proxy Voting Agent。

最简单的设计可能是：

```text
Agent
 ↓
生成投票
 ↓
Approve?
 ↓
Yes
 ↓
提交 ISS
```

这是典型的：

> Approval Button Architecture。

更合理的设计：

```text
ISS Data
   ↓
Voting Agent
   ↓
生成 Proposal
   ↓
┌──────────────────────────┐
│ Proxy Vote Case           │
│                          │
│ Resolution               │
│ Proposed Vote            │
│ Rationale                │
│ Supporting Evidence      │
│ Conflicts                │
│ Voting Guideline          │
│ Exceptions                │
└────────────┬─────────────┘
             │
       Policy Evaluation
             │
      ┌──────┴──────┐
      │             │
    Standard      Exception
      │             │
  Auto-route      Human
                  Review
                     │
              ┌──────┼──────┐
              │      │      │
           Approve  Modify  Escalate
              │      │      │
              └──────┴──────┘
                     │
             Re-validation
                     │
                 Command
                     │
                Submit ISS
                     │
                   Audit
```

这里 Human 的作用可能是：

```text
确认
修改
补充说明
选择例外处理方式
升级
停止
```

而不只是：

```text
Approve
```

---

# 二十三、为什么“所有 Agent 动作都审批”也不是好设计

直觉上：

> Agent 越危险 → 越多审批。

但如果进一步推成：

> 所有 Agent 动作都必须人工审批。

通常会产生三个问题。

## 1. Reviewer Fatigue

如果用户一天收到：

```text
Approve?
Approve?
Approve?
Approve?
Approve?
```

最终很容易变成：

```text
Approve
Approve
Approve
Approve
```

AWS 明确把这种模式称为 rubber-stamp approvals，并建议让人工注意力集中在真正需要人工判断的决策。

---

## 2. Automation Bias

当 Agent 长期表现不错时，人可能逐渐形成：

> Agent 大多数时候是对的。

于是人工审批会变成形式。

研究综述长期发现，自动化偏差会使人减少主动验证，并可能在自动化给出错误建议时继续接受错误结果；任务复杂度、工作负载和时间压力都会影响这种现象。

因此：

```text
More Approval
```

并不一定意味着：

```text
More Safety
```

---

## 3. Human becomes the bottleneck

如果：

```text
Agent = 1000 actions/hour

Human = 100 approvals/hour
```

那么系统所谓“Agentic”只是在把 Workflow queue 转移到了 Human queue。

真正目标应该是：

```text
Human Judgment
     ↓
只进入真正需要人判断的节点
```

而不是：

```text
Human Click
     ↓
覆盖所有 Agent Actions
```

---

# 二十四、HITL 的设计单位应该是什么？

不是：

```text
Button
```

而应该是：

```text
Decision
```

进一步：

```text
Decision Point
```

再进一步：

```text
Human Task
```

一个 Human Task 至少应该定义：

```text
Why is human involvement required?

What decision is being requested?

What information does the human need?

What choices are permitted?

What can the human modify?

What authority does the human have?

What authority does the human NOT have?

What happens after each decision?

What happens if the human does nothing?

When does the decision expire?

Who can escalate?

How is the decision audited?
```

---

# 二十五、Human Task 应该进入 Workflow，而不是藏在 Agent Prompt 里

错误设计：

```text
Agent Prompt：

“如果事情比较危险，
请询问用户是否允许。”
```

这是：

```text
LLM-level HITL
```

问题在于：

```text
Agent 可以忘记
Agent 可以误判
Prompt 可以被注入
Prompt 可以被修改
不同 Agent 可能实现不同逻辑
```

更可靠：

```text
Agent
  ↓
Proposed Action
  ↓
Risk Classification
  ↓
Workflow
  ↓
Human Task
  ↓
External Decision
  ↓
Workflow Resume
```

也就是说：

> **Human Oversight 应该是 Workflow / Control Plane 的能力，而不是 Prompt 中的一句 instructions。**

Microsoft Agent Framework 的 request/response、checkpoint/resume 正体现了这种设计方向。

---

# 二十六、Human Task 也需要 State

一个复杂 HITL Workflow 中，Human Task 自己就是一个状态机：

```text
CREATED
   ↓
ASSIGNED
   ↓
IN_REVIEW
   ├── NEED_MORE_INFO
   ├── ESCALATED
   ├── APPROVED
   ├── REJECTED
   ├── MODIFIED
   └── CANCELLED
```

这和：

```text
boolean approved
```

完全不是一个层次。

因此：

> Human Task 本身应该被视为 Workflow 中的一等执行对象。

---

# 二十七、Human Decision 必须可审计

不能只记录：

```text
approved = true
```

应该至少记录：

```text
Reviewer
Role
Timestamp

Decision
Decision Scope

Original Proposal
Modified Proposal

Evidence Presented

Policy Version
Authorization Context

Reason / Comment
Escalation History

Previous State
Resulting State
```

这使系统之后能够回答：

> 当时是谁，在什么信息基础上，批准了什么？

这也是金融环境中 Human Oversight 与 Regulatory Evidence 的交汇点。

FINRA 2026 年对 GenAI 的监管观察已经强调正式的 review/approval process、治理框架、持续监控以及 human-in-the-loop review，并要求能够跟踪 Agent 的访问、数据处理、动作和决策。

---

# 二十八、Human Review 本身也需要被治理

这是另一个容易忽略的问题：

> 人也会犯错。

所以不能简单假设：

```text
AI = potentially wrong
Human = always correct
```

正确模型应该是：

```text
AI Error
+
Human Error
+
Human-AI Interaction Error
```

因此需要考虑：

```text
Reviewer training
Decision guidelines
Second review
Sampling
Override monitoring
Reviewer disagreement
Re-review
Segregation of duties
```

ICO 对 AI Human Review 的现有指导也强调，真正有效的 human review 需要具备适当的知识、经验、权力和独立性，并要求记录 reviewer 的 challenge / override；同时应支持 re-review，防止单个 reviewer 的错误直接成为系统性结果。

---

# 二十九、因此 Human Oversight 其实也是一个系统

一个成熟的架构应该包含：

```text
Human Oversight Control Plane

├── Risk Classifier
├── Oversight Policy
├── Human Task Service
├── Reviewer Assignment
├── Approval / Decision UI
├── Notification
├── Escalation
├── Timeout
├── Delegation
├── Checkpoint / Resume
├── Kill Switch
├── Re-validation
├── Audit Evidence
└── Oversight Analytics
```

这时候：

```text
Approval Button
```

只是：

```text
Decision UI
```

里面的一个很小的部分。

---

# 三十、可以建立一个 Human Oversight Matrix

推荐从：

```text
Risk
Impact
Reversibility
Uncertainty
Autonomy
```

计算 Oversight Level。

例如：

| Oversight Level | Agent 自主程度 | Human 作用                     |
| --------------- | ---------- | ---------------------------- |
| L0              | 完全自动       | 仅监控                          |
| L1              | 自动执行       | 异常通知                         |
| L2              | 自动执行       | 人可介入                         |
| L3              | 提案 + 人决策   | Human chooses / approves     |
| L4              | Human 主导   | Agent 提供建议                   |
| L5              | 双人控制       | 高风险操作需要 separation of duties |

这里没有一个适用于所有企业的标准分级。

真正重要的是：

> **不要让所有动作都进入同一个 HITL 模式。**

AWS 当前推荐的也是根据风险和可逆性进行 tiered oversight。

---

# 三十一、一个非常重要的设计原则：Oversight 应该随着风险变化

可以简单表示：

```text
                    High Risk
                       ▲
                       │
               Human Command
                       │
                 Dual Control
                       │
              Explicit Approval
                       │
              Human Review
                       │
             Human-on-the-loop
                       │
                  Monitoring
                       │
               Full Autonomy
                       ▼
                    Low Risk
```

但不要机械理解成：

```text
Risk ↑ = Human Clicks ↑
```

真正应该是：

```text
Risk ↑
  ↓
Human Authority ↑
Human Context ↑
Human Intervention Capability ↑
Execution Constraints ↑
```

---

# 三十二、HITL 的另一个作用：把组织责任映射到 Agent

企业 Agent 最终不是“技术自己负责”。

例如：

```text
Agent
```

应该对应：

```text
Business Owner
Technology Owner
Risk Owner
Compliance Owner
Reviewer
Operator
```

因此 Human-in-command 最终解决的问题其实是：

> 谁对 Agent 可以做什么负责？

FINRA 2026 年的监管观察和 FSB 2026 年的咨询报告都强调 AI 治理中的责任分配、监督机制和组织能力，而不仅是模型本身的技术性能。

---

# 三十三、HITL 不是把 Human 放回旧 Workflow

一个错误方向是：

```text
传统 Workflow

A → B → Human Approval → C → D

      ↓

Agent Workflow

A → Agent → Human Approval → Agent → D
```

表面上升级了 Agent。

但 Human 仍然只是旧 Workflow 里的一个 Approval Node。

更合理的方式是：

```text
Agent
    ↓
自主处理大量低风险工作
    ↓
发现：
  ambiguity
  exception
  uncertainty
  high-impact action
  policy boundary
    ↓
Human
    ↓
改变决策 / 提供信息 / 升级 / 停止
    ↓
Agent继续
```

也就是：

> **Human 被放进“需要判断的地方”，而不是简单放在 Workflow 中间。**

---

# 三十四、HITL 的真正目标是 Controlled Autonomy

因此企业 Agent 的目标不是：

```text
Full Automation
```

也不是：

```text
Everything Human Approved
```

而是：

```text
Controlled Autonomy
```

可以表达成：

```text
                 Agent Autonomy
                       │
                       ▼
              ┌────────────────┐
              │ Risk / Policy  │
              │ Classification │
              └───────┬────────┘
                      │
          ┌───────────┼───────────┐
          │           │           │
        Auto       Human       Human
       Execute     Review      Command
          │           │           │
          └───────────┼───────────┘
                      │
                   Domain
                      │
                 Business State
```

Agent 越自主，不意味着 Human 越不重要。

实际上：

> **Agent 越自主，Human Oversight 就越应该从“逐次审批”升级为“定义边界、监控异常、处理例外、拥有停止权”。**

---

# 三十五、最终架构原则

可以把整篇文章压缩成以下几条。

### 原则一：HITL 不是 Approval Button

> Approval 是 HITL 的一种交互形式，不是 HITL 的全部。

---

### 原则二：Human Intervention 不只有 Approve / Reject

至少考虑：

```text
Clarify
Correct
Choose
Approve
Reject
Modify
Escalate
Override
Pause
Stop
Review
Appeal
```

---

### 原则三：HITL 的对象应该是 Decision Point

不要问：

> 哪些 Tool 需要 Approval？

更应该问：

> 哪些决策需要 Human Judgment？

---

### 原则四：Human Task 应该是 Workflow 的一等对象

不要把 HITL 隐藏在：

```text
Prompt
Agent Memory
Tool Description
```

中。

应该显式进入：

```text
Workflow / Control Plane
```

---

### 原则五：Approval 不等于 Authorization

Human Approval 只是一个 decision signal。

仍然必须经过：

```text
Policy
Authorization
Entitlement
Domain Validation
```

---

### 原则六：Human Review 必须是 Meaningful

一个人看到：

```text
Approve / Reject
```

不代表完成了有效的人类监督。

Human 必须拥有：

```text
Enough Context
Enough Authority
Enough Time
Enough Expertise
Ability to Challenge
Ability to Modify
Ability to Escalate
Ability to Stop
```

---

### 原则七：人类监督必须风险分层

不要：

```text
Everything → Approval
```

也不要：

```text
Everything → Autonomous
```

应该：

```text
Risk
+
Impact
+
Reversibility
+
Uncertainty
+
Autonomy
      ↓
Oversight Level
```

---

### 原则八：高自主 Agent 应该拥有 Kill Switch

人不一定参与每一次执行。

但应该能够：

```text
Pause
Stop
Disable
Degrade
Escalate
```

---

### 原则九：Human Decision 本身也是 Business Evidence

必须记录：

```text
Who
What
When
Scope
Context
Evidence
Decision
Reason
Override
Result
```

否则：

```text
Human Approval
```

最后只剩一个：

```text
true
```

---

# 三十六、从 Approval Button 到 Human Oversight Control Loop

最终可以把两种架构放在一起看。

## 传统 HITL

```text
Agent
  ↓
Proposal
  ↓
[ APPROVE ]
  ↓
Execute
```

这是：

> Human Approval Gate

---

## 成熟的 Agent HITL

```text
                      Agent Runtime
                           │
                   Reason / Plan / Act
                           │
                    Risk Classification
                           │
                  Oversight Policy
                           │
          ┌────────────────┼────────────────┐
          │                │                │
       Continue          Human             Escalate
          │              Task                │
          │                │                │
          │      ┌─────────┼─────────┐      │
          │      │         │         │      │
          │   Clarify   Correct   Approve   │
          │      │         │         │      │
          │      └─────────┼─────────┘      │
          │                │                │
          │             Resume              │
          │                │                │
          └────────────────┼────────────────┘
                           │
                    Re-validation
                           │
                     Authorization
                           │
                        Command
                           │
                         Domain
                           │
                   Business State
                           │
                         Audit
                           │
                  Oversight Analytics
```

这才是更适合企业 Agent，尤其是金融 Agent 的 HITL。

---

# 三十七、结论

传统 Workflow 中：

> Human 是一个 Node。

Agent 系统中：

> Human 更应该是一种 **Oversight Capability**。

区别非常大。

Human 不一定每次都参与执行。

但系统应该明确：

```text
什么时候需要人？
为什么需要人？
人应该看到什么？
人能够改变什么？
人的权限是什么？
人不能绕过什么？
人不响应怎么办？
应该升级给谁？
如何暂停 Agent？
如何恢复 Agent？
如何证明当时确实有人做出了什么决定？
```

所以真正成熟的 HITL，不是：

> **Agent → Approval Button → Continue**

而是：

> **Agent Autonomy + Risk-based Oversight + Human Judgment + External Authorization + Intervention + Escalation + Audit**

最终目标也不是让人重新接管所有工作。

而是：

> **让 Agent 自主处理机器擅长的部分，让人只在真正需要判断、承担责任或者拥有最终控制权的地方介入。**

这也是为什么在企业 Agent 架构中，更值得设计的不是一个 `ApproveButton`，而是一个完整的：

```text
Human Oversight Control Plane
```

它负责把：

```text
Autonomy
```

转换成：

```text
Controlled Autonomy
```

而不是简单把：

```text
Automation
```

重新变成人工 Workflow。

---

## 参考资料

AWS Well-Architected Agentic AI Lens，2026 年 6 月版本，重点涉及 risk-tiered human oversight、human review、escalation、tool authorization 和 agent containment。

Microsoft Agent Framework HITL 文档，展示 Request/Response、Tool Approval、Interactive Handoff、Checkpoint/Resume 等机制。

Financial Stability Board，《Sound Practices for Responsible Adoption of Artificial Intelligence》，2026 年 6 月咨询报告，其中专门讨论 Human-in-the-loop、Human-on-the-loop、AI-in-the-loop、Human-in-command、Kill Switch 和 Contestability。

FINRA，《GenAI: Continuing and Emerging Trends》，2026 年报告，对金融机构的 GenAI supervision、governance、monitoring 和 human-in-the-loop review 进行了讨论。

BIS，《Humans keeping AI in check – emerging regulatory expectations in the financial sector》，讨论金融机构中的 human-in-the-loop / human-on-the-loop 以及 proportionality。

Goddard 等，《Automation bias: a systematic review of frequency, effect mediators, and mitigators》，系统讨论人对自动化建议过度依赖的机制和缓解方法。

Goddard 等，《Automation bias and verification complexity: a systematic review》，进一步讨论验证复杂度与 Automation Bias 的关系。

ICO Human Review Guidance，讨论 meaningful human review、reviewer authority、challenge/override、re-review 和 reviewer error。

# 为什么 Agent Skill 与 Workflow Definition 必须分离

> **核心结论**
>
> Agent Skill 与 Workflow Definition 应该分离，但这里的“分离”首先是**语义和控制边界的分离**，不一定要求物理上分成两个仓库、两个文件甚至两个发布包。
>
> **Skill 解决的是“怎么把一类工作做好”；Workflow Definition 解决的是“这个业务过程必须经过什么步骤、由谁决定、什么时候允许产生副作用”。**
>
> 一个 Skill 可以包含步骤、规则、脚本，甚至描述一个复杂的 agentic procedure；但它不应该成为企业业务 Workflow 的 authoritative source of truth。
>
> 反过来，Workflow 可以调用 Skill，但不应该把大量 Agent-specific procedural knowledge、Prompt、tool-selection heuristics 塞进 Workflow Definition。
>
> 最终应形成这样的关系：
>
> ```text
>                  Workflow Definition
>                         │
>                  defines business flow
>                         │
>             ┌───────────┼───────────┐
>             ↓           ↓           ↓
>           Task         Gate       Review
>             │
>             │ invokes
>             ↓
>           Skill
>             │
>       tells agent how
>             │
>      ┌──────┼──────┐
>      ↓      ↓      ↓
>    Tools  Scripts  References
> ```
>
> **Workflow 决定“必须发生什么”；Skill 帮助 Agent 决定“如何完成其中的一项工作”。**

---

# 1. 为什么会把 Skill 和 Workflow 混在一起

Agent Skills 的一个特点恰恰是它可以描述“多步骤工作”。

Anthropic 的 Agent Skills 标准把 Skill 定义为一个包含 `SKILL.md`、instructions、scripts、references、assets 的可组合能力包，并明确把 procedural knowledge 放进 Skill。官方介绍甚至直接说 Skills 可以帮助 Agent 执行特定工作，并且可以把复杂的 procedure 编码进去。

OpenAI 的当前 Skills 文档也明确说，Skill 可以包含：

* reusable instructions；
* references；
* scripts；
* multi-step workflows。

所以如果简单地说：

> **Skill 只负责能力，绝对不能包含 Workflow。**

这个论点是不准确的。

问题真正出现在：

```text
Skill
  ↓
开始拥有
  ↓
Business Process State
Approval
Authorization
Business Transition
Workflow Persistence
```

此时 Skill 就从：

```text
Agent capability
```

越界成了：

```text
Business Workflow Definition
```

这才是需要阻止的。

---

# 2. 先定义两个东西

建议把两个概念严格定义为：

## Agent Skill

> **一种可复用的、面向 Agent 的 procedural capability package。**

它告诉 Agent：

```text
什么时候适用
应该关注什么
通常怎么做
可以使用哪些工具
有哪些常见陷阱
需要什么参考资料
哪些步骤适合脚本执行
```

典型结构：

```text
financial-analysis/
├── SKILL.md
├── scripts/
├── references/
└── assets/
```

Agent Skills 开放规范就是这样设计的：Skill 通过 metadata 被发现，激活后加载完整 instructions，需要时再读取 references 或运行 scripts；这是一种 progressive disclosure 机制。

---

## Workflow Definition

> **业务过程的 authoritative execution contract。**

它应该定义：

```text
什么时候开始
需要哪些步骤
步骤之间如何连接
什么条件允许继续
哪里需要 Review
什么时候产生 Command
发生错误如何恢复
什么时候结束
Business State 如何变化
```

因此可以简单写成：

```text
Skill
  = How to do a kind of work

Workflow
  = What business process must happen
```

更准确：

```text
Skill
  = procedural knowledge

Workflow
  = controlled process definition
```

---

# 3. 微软目前已经非常直接地把两者区分开

这一点非常重要，因为这是目前最直接的官方材料之一。

Microsoft Agent Framework 当前文档直接有一节：

> **When to use skills vs. workflows**

并明确说明两者是 fundamentally different：

| 维度             | Skill                        | Workflow                    |
| -------------- | ---------------------------- | --------------------------- |
| Control        | AI 决定如何执行                    | 显式定义 execution path         |
| Resilience     | 单次 agent turn 失败通常整体 retry   | 支持 checkpoint / resume      |
| Side effects   | 更适合低风险、幂等操作                  | 更适合有业务副作用的步骤                |
| Complexity     | focused / single-domain task | multi-step business process |
| Human approval | 不适合作为主要控制机制                  | 可以显式协调 Human Review         |

Microsoft 给出的经验法则非常直接：

> 如果希望 AI 自己决定“怎么做”，使用 Skill；如果需要保证“哪些步骤必须执行以及执行顺序”，使用 Workflow。

这几乎就是：

```text
Skill
    ↓
Agent autonomy

Workflow
    ↓
Process control
```

的官方表达。

---

# 4. Anthropic 的 Skill 设计也天然指向另一层

Anthropic 将 Skill 设计成：

```text
Discovery
   ↓
Activation
   ↓
Execution
```

Agent 先看到：

```text
name
description
```

确定相关后再加载：

```text
SKILL.md
```

需要时才进一步读取：

```text
references
scripts
assets
```

这意味着 Skill 本身的一个核心特点是：

> **它可以由 Agent 根据当前任务选择是否使用。**

这与企业 Workflow 的基本性质不同。

Workflow 往往意味着：

```text
Case Created
      ↓
Validate
      ↓
Risk Check
      ↓
Review
      ↓
Command
```

这里不能变成：

```text
Agent:
"这次我感觉不需要 Review Skill。"
```

因为 Review 是否发生，不应该由一个可动态选择的 Skill 决定。

因此：

```text
Skill selection
```

和：

```text
Business workflow control
```

必须分开。

---

# 5. AWS 当前架构同样把 Skill 定义成可复用 capability

Amazon Bedrock AgentCore 现在把 Skill 定义为：

> reusable instruction file / reusable capability that an agent loads at runtime。

AWS Agent Registry 又进一步明确：

```text
Agent
  = autonomous program

Skill
  = reusable capability shared across agents
```

这非常关键。

如果：

```text
Skill
```

本身就是：

```text
reusable capability
```

那么它天然应该能够出现在多个 Workflow 中。

例如：

```text
Skill:
Financial Statement Analysis
```

可以被：

```text
Workflow A:
Investment Research

Workflow B:
Due Diligence

Workflow C:
Portfolio Review
```

复用。

但是三个 Workflow 的业务控制流完全不同：

```text
Investment Research
    Analyze
      ↓
    Review
      ↓
    Publish

Due Diligence
    Collect
      ↓
    Analyze
      ↓
    Legal Review
      ↓
    Approve

Portfolio Review
    Analyze
      ↓
    Risk Gate
      ↓
    Escalate
```

这就是为什么：

```text
Skill
```

不能成为：

```text
Workflow
```

的同义词。

---

# 6. Skill 可以复用，Workflow 通常代表业务上下文

这是两者最根本的差异之一。

假设：

```text
Skill:
"Analyze a publicly listed company's financial statements"
```

它可能规定：

```text
1. Identify reporting period
2. Extract revenue
3. Extract operating income
4. Normalize accounting differences
5. Calculate margins
6. Flag anomalies
7. Cite sources
```

这个过程可以被很多地方使用。

但：

```text
Workflow:
"Investment Idea Creation"
```

可能是：

```text
Create Idea
   ↓
Financial Analysis
   ↓
ESG Analysis
   ↓
Risk Check
   ↓
Investment Review
   ↓
Publish
```

另一个 Workflow：

```text
Workflow:
"Quarterly Portfolio Review"
```

可能是：

```text
Select Holdings
   ↓
Financial Analysis
   ↓
Risk Review
   ↓
Portfolio Committee
```

两者都使用：

```text
Financial Analysis Skill
```

所以：

```text
Skill
     ┌───────────────┐
     ↓               ↓
Workflow A       Workflow B
```

比：

```text
Workflow A
     ↓
copy Skill logic

Workflow B
     ↓
copy Skill logic
```

更合理。

---

# 7. 如果把 Skill 当 Workflow，会产生第一个严重问题：复用失败

例如 Skill：

```text
proxy-voting-analysis
```

里面写：

```text
retrieve ISS proposal
→ compare company policy
→ generate vote recommendation
→ request human approval
→ submit vote
```

看起来很完整。

但现在它被用于：

```text
Workflow A:
Normal Proxy Vote
```

可能没问题。

然后另一个流程：

```text
Workflow B:
High Risk Proxy Vote
```

要求：

```text
retrieve
→ analyze
→ compliance review
→ legal review
→ investment committee
→ submit
```

怎么办？

最终通常只能：

```text
Skill A
Skill B
Skill C
```

不断复制和分叉 procedural logic。

真正的问题是：

> **Skill 中混进了 Workflow policy。**

---

# 8. 第二个问题：Skill 的自主选择机制与 Workflow 的确定性要求冲突

Agent Skills 的一个核心设计就是：

```text
Agent
  ↓
Skill discovery
  ↓
Select relevant skill
  ↓
Activate
```

Anthropic、OpenAI、GitHub、Microsoft 都采用类似的按需 Skill loading / selection 机制。

这种机制适合：

```text
"我要分析一个财报。"
```

Agent 判断：

```text
financial-analysis skill
```

是否适用。

但企业 Workflow 更像：

```text
Trade > $1M
   ↓
Approval Required
```

这里并不是：

```text
Agent:
"approval skill 看起来挺相关。"
```

而是：

```text
Policy
→ approval_required = true
```

因此：

```text
Skill activation
```

属于：

```text
Agent Runtime
```

而：

```text
Workflow transition
```

属于：

```text
Workflow Control Plane
```

---

# 9. 第三个问题：Skill 不能成为 Business State 的 Source of Truth

这可能是金融场景中最重要的一条。

假设：

```text
Skill:
trade-approval
```

里面写：

```text
if amount > 1M:
    ask manager for approval

if approved:
    execute trade
```

看起来非常自然。

但现在要问：

> “approved” 存在哪里？

如果答案是：

```text
Agent Context
```

或者：

```text
Skill output
```

那么系统就开始把：

```text
Business State
```

放进：

```text
Agent Runtime
```

这是不合适的。

真正的 Workflow 应该拥有：

```text
TradeCase
status = PENDING_REVIEW
```

然后：

```text
Review
   ↓
Decision
   ↓
status = APPROVED
```

Skill 只能产生：

```text
Recommendation
Evidence
Analysis
```

而不能自己定义：

```text
TradeCase.status
```

因此：

```text
Skill
    ≠ Business State Machine
```

---

# 10. 第四个问题：Retry 语义完全不同

这是 Microsoft 当前文档特别值得重视的一点。

Microsoft 明确指出：

* Skill 在单次 Agent turn 内运行，失败通常意味着整个操作需要重试；
* Workflow 支持 checkpoint，可以从成功步骤恢复；
* 有副作用的步骤应该优先放在 Workflow 中。

考虑：

```text
Workflow:

Fetch Data
   ↓
Analyze
   ↓
Review
   ↓
Submit Trade
```

如果 `Analyze` 使用 Skill：

```text
failure
→ retry analysis
```

可能没有问题。

但是：

```text
Submit Trade
```

失败后不能简单：

```text
rerun entire skill
```

否则可能发生：

```text
Approve
→ Submit
→ network timeout
→ retry
→ Submit again
```

于是需要：

```text
idempotency
reconciliation
business state
execution record
```

这些都属于 Workflow / Command execution semantics，而不是 Skill。

---

# 11. 第五个问题：Human Review 不应该依赖 Skill 内部指令

比如 Skill 写：

```text
if confidence < 0.8:
    ask human
```

这个设计在个人 Agent 中完全可以合理。

但在金融业务 Workflow 中：

```text
if transaction > limit
    → mandatory review
```

往往是企业 Policy。

两者不能混淆。

更合理的是：

```text
Skill
  ↓
Risk Assessment
  ↓
Workflow Gate
  ↓
Review
```

而不是：

```text
Skill
  ↓
"I think we need a human"
```

AWS Agentic AI Lens 明确强调：高风险操作应有适当的 deterministic enforcement 和 human oversight，而不能仅依赖 Agent 自身判断。

---

# 12. 第六个问题：Authorization 不应该存在 Skill 中

这是金融服务场景必须特别强调的一条。

假设：

```text
Skill:
submit-trade
```

里面写：

```text
Call execute_trade()
```

这个 Skill 可以告诉 Agent：

```text
如何调用
需要什么参数
如何处理返回值
哪些错误常见
```

但它不能定义：

```text
谁有权执行
什么额度允许执行
什么证券必须隔离
什么账户允许交易
什么情况下需要第二人审批
```

这些必须由：

```text
Authorization
Policy
Entitlement
Workflow Gate
```

决定。

AWS AgentCore 的安全文档明确指出，Skill 内容本身只是被注入 Agent context；IAM、authorization、input validation、skill source trust 等仍然必须由企业自己的控制层负责。

因此：

```text
Skill
  = instructions

Policy
  = authoritative control
```

绝不能反过来。

---

# 13. “Skill 不是 Workflow”不等于 Skill 不能描述 Workflow

这是必须写进架构原则的例外。

Anthropic 的官方材料明确说 Skills 可以帮助 Agent 执行 repeatable workflows。

OpenAI 也明确允许 Skills 包含：

```text
multi-step workflows
```

所以完全可以有：

```text
Skill:
"How to perform financial statement analysis"
```

里面包含：

```text
Step 1
Step 2
Step 3
Step 4
```

这些是：

> **Agent procedure**

而不是：

> **Enterprise business process state machine**

区别在于：

```text
Skill:
procedural sequence

Workflow:
authoritative business sequence
```

这两个 sequence 看起来可能很像，但控制权完全不同。

---

# 14. 一个很好的判断方法：谁能改变它？

这是实践中最好用的判断标准之一。

问：

> **谁可以改变这条规则而不改变业务流程？**

如果答案是：

```text
Agent team
Prompt engineer
Skill maintainer
AI platform team
```

那么它更像：

```text
Skill
```

例如：

```text
"先检查 EBITDA，再检查 margin，再查异常。"
```

可以不断优化。

但是：

> **谁批准改变它？**

如果答案是：

```text
Business Owner
Risk
Compliance
Operations
Architecture Governance
```

甚至需要：

```text
formal change management
testing
release approval
```

那么它更像：

```text
Workflow Definition
```

例如：

```text
Trade > $1M requires two-person approval
```

这种内容绝对不应该只存在于 Skill。

---

# 15. 第二个判断方法：失败后要不要恢复业务状态？

如果失败后需要回答：

```text
上一次执行到了哪里？
谁已经审批？
哪些副作用已经发生？
下一次应该从哪里继续？
```

那就是：

```text
Workflow
```

例如：

```text
Task A
 ↓
Review
 ↓
Command
```

Review 已经批准：

```text
approved
```

但 Command 因网络问题失败。

系统应该恢复为：

```text
APPROVED
+
COMMAND_PENDING
```

而不是让 Agent 重新读取 Skill，然后：

```text
"I think we should ask approval again."
```

Workflow 的 durable state 才是这里的 source of truth。

---

# 16. 第三个判断方法：是否存在 Business Side Effect？

这是一个非常有用的边界。

### 通常适合 Skill

```text
Summarize
Analyze
Research
Classify
Extract
Transform
Calculate
Explain
```

### 更应该由 Workflow 控制

```text
Approve
Submit
Release
Publish
Create Order
Execute Trade
Send Binding Instruction
Change Client State
Move Money
```

因为后者涉及：

```text
authorization
idempotency
audit
reconciliation
business state
```

Microsoft 当前文档也明确建议：Skill 更适合低风险或幂等操作，有副作用、需要 checkpoint / recovery 的操作应放进 Workflow。

---

# 17. 金融服务场景下，这个边界更加重要

Anthropic 在 2026 年推出金融服务 Agent 模板时，实际上给出了一个非常有价值的现实例子。

这些 finance agent templates 不是简单把所有东西塞进一个“大 Skill”，而是把：

```text
Skills
Connectors
Subagents
```

作为不同组件组合起来，并明确提到企业可以根据自身：

```text
modeling conventions
risk policies
approval flows
```

进行适配。

这实际上非常接近：

```text
Agent Capability
+
Data Access
+
Delegated Reasoning
+
Business Governance
```

各自分层。

尤其值得注意的是：

> **approval flows 被描述成企业可以调整的业务治理层，而 Skills 是 Agent capability。**

这和本文的分离模型高度一致。

---

# 18. 一个 Proxy Voting 例子

假设：

```text
Skill:
proxy-voting-analysis
```

它可以包含：

```text
1. Read ISS proposal
2. Identify resolution type
3. Retrieve corporate governance policy
4. Compare proposal with policy
5. Identify supporting evidence
6. Produce vote recommendation
7. Explain dissenting evidence
```

非常合理。

但是 Workflow 应该是：

```text
Receive Meeting
      ↓
Load Proposal
      ↓
Analyze Proposal
      ↓
Policy Gate
      ↓
Review
      ↓
Submit Proxy Vote
```

这里：

```text
Analyze Proposal
```

调用：

```text
proxy-voting-analysis Skill
```

但 Skill 不决定：

```text
Review 是否必须发生
```

也不决定：

```text
谁可以 Review
```

更不决定：

```text
SubmitProxyVote 是否有权执行
```

最终结构：

```text
Workflow
│
├── Load Proposal
│
├── Task: Analyze Proposal
│       │
│       └── Skill: proxy-voting-analysis
│
├── Gate: Approval Required?
│
├── Review: Authorized Reviewer
│
└── Command: SubmitProxyVote
```

这是一个非常干净的边界。

---

# 19. Trade Workflow 也是一样

```text
Receive Instruction
        ↓
Validate
        ↓
Analyze Risk
        ↓
Risk Gate
        ↓
Review
        ↓
Approve Trade
        ↓
Execute Trade
```

其中：

```text
Analyze Risk
```

可以使用：

```text
risk-analysis Skill
```

Skill 可以包含：

```text
risk factor interpretation
research procedure
calculation scripts
reference documents
reasoning guidelines
```

但：

```text
Risk Gate
Review
Approve Trade
Execute Trade
```

必须由 Workflow / Policy / Business System 控制。

即：

```text
               Workflow
                   │
              Analyze Risk
                   │
              ┌────┴────┐
              ↓         ↓
           Skill      Tools
              │
              ↓
          Risk Result
              │
              ↓
            Gate
              │
              ↓
           Review
              │
              ↓
           Command
```

---

# 20. Skill 与 Workflow 的版本生命周期也应该不同

这是企业级平台非常容易忽略的问题。

## Skill Version

例如：

```text
proxy-voting-analysis
v1.2
```

变化原因：

```text
better extraction procedure
better prompt
new script
new reference
new analysis technique
```

它通常属于：

```text
AI / Domain Capability lifecycle
```

---

## Workflow Version

例如：

```text
proxy-voting-workflow
v7
```

变化原因：

```text
new approval step
new control gate
new business state
new policy requirement
new external system
new escalation rule
```

它属于：

```text
Business Process lifecycle
```

两个版本应该可以独立变化：

```text
Workflow v7
   │
   ├── Skill v1.2
   │
   └── Policy v4
```

而不是：

```text
workflow-v7.zip
   └── everything
```

每次 Skill 改一个 Prompt，就不得不重新发布整个 Business Workflow。

---

# 21. 这对 Change Management 很重要

金融服务环境中，很多变化并不具有同样的风险。

例如：

```text
Skill v1.2
→ 改善研究摘要措辞
```

与：

```text
Workflow v7
→ 删除第二级审批
```

显然不是同一级别的变更。

BIS 关于金融机构 AI 治理的报告强调，应把 AI 风险纳入既有 risk-management framework，并使用清晰的治理、责任和 oversight 机制。

美国银行监管机构 2026 年修订的 Model Risk Management guidance 也强调：

```text
model development
model use
validation
monitoring
governance and controls
```

以及明确的 roles and responsibilities；同时监管机构特别指出 generative AI 和 agentic AI 当时仍处于快速演进状态，因此新的治理方法仍在发展中。

这反过来说明：

> **不能因为 AI 技术还在快速变化，就把业务过程控制也放进同一个快速变化的 Skill 生命周期。**

---

# 22. Skill 其实更像“可升级的专业知识包”

从架构角度，可以把 Skill 看成：

```text
Capability Package
```

里面可能有：

```text
instructions
scripts
references
templates
examples
```

它像：

```text
library
plugin
procedure package
expertise module
```

Agent 可以：

```text
discover
activate
compose
reuse
evaluate
upgrade
```

Anthropic、OpenAI、GitHub、AWS 都在朝这个方向演进。

Workflow 则更像：

```text
Business Process Definition
```

需要：

```text
deploy
start
pause
resume
retry
timeout
escalate
complete
audit
```

因此：

```text
Skill lifecycle
≠
Workflow lifecycle
```

---

# 23. Skill 的安全边界也与 Workflow 不同

这是一个非常重要但经常被忽略的原因。

Microsoft 明确要求把 Skill 当作第三方代码来管理，因为 Skill 可以：

```text
inject instructions
run scripts
read resources
```

因此必须审查：

```text
provenance
scripts
network access
filesystem access
permissions
```

并记录加载了哪些 Skills、读取了哪些资源、执行了哪些脚本。

AWS AgentCore 的文档更加直接：

> Skill content 被当成 trusted input 注入 Agent context，AgentCore 不会替你验证 Skill 的内容或者 source。

因此企业必须自行负责：

```text
trusted source
version control
access control
review
skill override restrictions
```

这意味着：

> **Skill 本身应该被视为一个受治理的 capability artifact，而不能天然获得“业务流程定义”的权威身份。**

如果一个 Skill 同时决定：

```text
what to do
who can do it
when it can happen
what state to change
```

那么一个 Skill package 的变更实际上就在修改企业业务控制边界。

这个风险明显比“修改一个 Agent procedure”大得多。

---

# 24. 一个非常危险的设计

不建议：

```text
workflow:
  use skill:
    trade-approval
```

然后：

```text
trade-approval/SKILL.md
```

里面直接写：

```text
1. Analyze trade
2. Determine whether approval is necessary
3. If necessary ask user
4. If approved execute trade
5. If execution fails retry
6. If retry fails escalate
```

这看起来特别“Agentic”，但 Workflow Engine 几乎失去了控制。

因为：

```text
approval policy
retry policy
escalation
execution
```

全部藏在：

```text
Skill
```

里。

最终：

```text
Workflow
```

只是：

```text
run(skill)
```

于是 Skill 实际上成为：

```text
hidden workflow engine
```

这是应该明确避免的。

---

# 25. 推荐设计：Workflow 编排 Skill，而不是 Skill 定义 Workflow

应该变成：

```text
Workflow
│
├── Task: Analyze
│     └── Skill: trade-analysis
│
├── Gate: Approval Required
│
├── Review
│
└── Command: Execute Trade
```

而不是：

```text
Workflow
│
└── Skill: trade-approval
       ├── Analyze
       ├── Gate
       ├── Review
       └── Execute
```

第一种：

```text
Workflow = authoritative
Skill = capability
```

第二种：

```text
Skill = hidden workflow
```

对于金融业务，第一种明显更容易：

```text
audit
test
change-control
authorization
recovery
```

---

# 26. 但 Skill 可以“包含一个局部流程”

这是另一个必须保留的例外。

例如：

```text
Skill:
Financial Statement Analysis
```

可以有：

```text
Step 1
→ identify periods

Step 2
→ normalize currencies

Step 3
→ calculate margins

Step 4
→ compare peers

Step 5
→ flag anomalies
```

没问题。

因为这些步骤描述的是：

```text
How the Agent performs financial statement analysis
```

不是：

```text
What the enterprise business case must do
```

因此：

```text
Skill procedure
```

可以存在。

但：

```text
Business Workflow
```

必须拥有自己的流程定义。

---

# 27. 可以用“谁拥有控制权”来最终判断

这可能是整个设计最好用的一条判断规则：

| 问题                      | Skill | Workflow |
| ----------------------- | ----- | -------- |
| 如何分析一个财报？               | ✓     |          |
| 如何寻找异常？                 | ✓     |          |
| 哪些工具通常先用？               | ✓     |          |
| 如何生成研究结果？               | ✓     |          |
| 一个业务 Case 必须经过哪些步骤？     |       | ✓        |
| 是否必须审批？                 |       | ✓        |
| 谁可以审批？                  |       | ✓        |
| 哪个状态可以进入下一状态？           |       | ✓        |
| 什么时候允许 Command？         |       | ✓        |
| 失败后从哪里恢复？               |       | ✓        |
| 哪个 Business State 已经发生？ |       | ✓        |
| Agent 如何完成一个 Task？      | ✓     |          |
| Agent 可以选择哪些工具？         | ✓     |          |
| 如何压缩 Context？           | ✓     |          |
| 如何进行内部 reasoning？       | ✓     |          |

一个特别清晰的边界是：

> **Skill 可以建议“怎么做”，Workflow 可以决定“必须发生什么”。**

---

# 28. 对 Agent Platform 来说，推荐三层

最终建议将平台模型设计成：

```text
┌─────────────────────────────────────────────┐
│              Workflow Control Plane        │
│                                             │
│  Workflow Definition                        │
│  Business State                             │
│  Task / Gate / Review / Command             │
│  Policy / Authorization                     │
│  Retry / Checkpoint / Escalation            │
│  Audit                                      │
└──────────────────────┬──────────────────────┘
                       │
                       │ invokes
                       ↓
┌─────────────────────────────────────────────┐
│               Agent Runtime                 │
│                                             │
│  Reasoning                                  │
│  Context                                    │
│  Tool selection                             │
│  Skill discovery / activation               │
│  Sub-agent delegation                       │
│  Agent memory                               │
└──────────────────────┬──────────────────────┘
                       │
                       ↓
┌─────────────────────────────────────────────┐
│               Skill Layer                   │
│                                             │
│  Instructions                               │
│  Domain knowledge                            │
│  Scripts                                    │
│  References                                 │
│  Templates                                  │
│  Examples                                   │
└─────────────────────────────────────────────┘
```

这里：

```text
Workflow
```

是：

```text
business control
```

```text
Agent Runtime
```

是：

```text
reasoning control
```

```text
Skill
```

是：

```text
procedural capability
```

三者不要互相吞掉。

---

# 29. 一个 Skill 可以被多个 Workflow 复用

例如：

```text
                     Financial Research Skill
                              │
               ┌──────────────┼──────────────┐
               ↓              ↓              ↓
         Investment       Due Diligence   Portfolio
          Workflow          Workflow      Review
```

每个 Workflow 都可以给 Skill 不同的上下文：

```text
Workflow A
  → issuer context

Workflow B
  → target company context

Workflow C
  → portfolio context
```

Skill 负责：

```text
how to analyze
```

Workflow 负责：

```text
why this analysis is being done
what happens next
```

这就是非常典型的 capability reuse。

---

# 30. 一个 Workflow 也可以调用多个 Skill

例如：

```text
Investment Idea Workflow
        │
        ├── Financial Analysis Skill
        │
        ├── ESG Research Skill
        │
        ├── Valuation Skill
        │
        └── Evidence Review Skill
```

然后：

```text
Gate:
Risk threshold?
        ↓
Review:
Investment Committee
        ↓
Command:
Publish Idea
```

这里非常清晰：

```text
Skills
  = analysis capabilities

Workflow
  = business process
```

如果把它们合并：

```text
Investment Idea Skill
```

最终会变成一个很大的：

```text
everything skill
```

失去组合性。

---

# 31. 这也解释了为什么 Skill 应该可以跨 Agent

Agent Skills 开放标准从一开始就强调：

```text
write once
use everywhere
```

并且支持 Claude、GitHub Copilot、Codex 等不同 Agent 产品。

这说明 Skill 的设计目标就是：

```text
portable capability
```

而不是：

```text
one business case's state machine
```

如果某个 Workflow 定义被塞进 Skill：

```text
Workflow-specific
approval
state
deadline
case context
```

那么这个 Skill 就无法自然跨：

```text
Agent A
Agent B
Workflow C
Workflow D
```

复用了。

因此，Skill 的可移植性本身就在推动：

```text
Skill
≠
Workflow Definition
```

---

# 32. 但是不要把“可复用”理解成“永远不绑定业务”

Skill 完全可以是：

```text
KYC Document Review
```

这是明显业务领域能力。

也完全可以是：

```text
Proxy Voting Analysis
```

它甚至可以是金融领域专用。

关键不是：

```text
generic vs domain-specific
```

而是：

```text
capability vs process control
```

例如：

```text
Proxy Voting Analysis Skill
```

完全合理。

但：

```text
Proxy Vote Submission Approval Workflow
```

应该保持在 Workflow 层。

---

# 33. Skill 和 Workflow 的关系应该类似“Library 与 Application”

这是一个很好理解的类比：

```text
Library
   ↓
提供 reusable capability

Application
   ↓
决定什么时候调用、怎么组合
```

对应：

```text
Skill
   ↓
提供 reusable procedural capability

Workflow
   ↓
决定什么时候调用、怎么组合、什么时候停止、何时产生副作用
```

因此：

```text
Skill
```

可以被多个 Workflow 使用。

而：

```text
Workflow
```

不能反过来变成：

```text
Skill
```

然后让 Agent 自己决定是否执行全部业务流程。

---

# 34. 最终推荐的 DSL

一个比较干净的 Workflow DSL：

```ts
workflow("proxyVoting", ({ task, gate, review, command }) => {

  const proposal = task("loadProposal")

  const analysis = task("analyzeProposal", {
    skill: "proxy-voting-analysis"
  })

  const policy = gate("approvalPolicy")

  const humanReview = review("investmentReview")

  const submit = command("submitProxyVote")

  proposal
    .then(analysis)
    .then(policy)

  policy
    .when("reviewRequired", humanReview)
    .when("autoApproved", submit)

  humanReview
    .when("approved", submit)
    .when("rejected", "end")
})
```

这里：

```text
skill: proxy-voting-analysis
```

只是告诉 Task：

> **完成这个 Task 时，可以使用这个 Skill。**

而不是：

```text
skill
```

决定：

```text
下一步是什么
谁批准
哪个状态改变
什么时候执行 Command
```

---

# 35. Skill 本身应该有自己的 Contract

例如：

```yaml
---
name: proxy-voting-analysis
description: Analyze proxy voting proposals using company policy, issuer materials, and approved external research.
---

## Input

Proxy proposal
Issuer context
Applicable policy

## Procedure

1. Identify resolution type
2. Gather relevant evidence
3. Compare with policy
4. Identify conflicts
5. Produce recommendation
6. Cite evidence

## Output

ProposalAnalysis
```

注意：

```text
Output:
ProposalAnalysis
```

很好。

但不要写：

```text
Output:
APPROVED
```

更不要写：

```text
If approved:
  submit vote
```

因为：

```text
ProposalAnalysis
```

是 capability result。

而：

```text
APPROVED
```

是 business decision。

---

# 36. 更清晰的输出模型

建议：

```text
Skill Output
    ↓
Task Result
    ↓
Workflow State
    ↓
Gate
    ↓
Review / Command
```

例如：

```json
{
  "recommendation": "AGAINST",
  "confidence": 0.87,
  "evidence": [
    "...",
    "..."
  ],
  "policy_alignment": "PARTIAL"
}
```

Workflow 再判断：

```text
policy_alignment == PARTIAL
→ Review required
```

这样：

```text
Skill
```

没有偷偷拥有：

```text
Workflow control
```

---

# 37. 评估体系也应该分开

这是非常实际的一点。

## Skill Evaluation

测试：

```text
Did the Agent perform the procedure correctly?
```

例如：

```text
Evidence completeness
Analysis quality
Citation correctness
Tool usage
Instruction adherence
```

AWS AgentCore 当前甚至有针对 Skill invocation 的 evaluator / trace evaluation 机制。

---

## Workflow Evaluation

测试：

```text
Did the business process behave correctly?
```

例如：

```text
Did every required Gate execute?
Did unauthorized cases stop?
Was Review mandatory?
Did Command occur only after approval?
Did retry preserve business state?
Did timeout escalate correctly?
```

这两种 Evaluation 不应该混成：

```text
Agent succeeded = Workflow succeeded
```

因为：

```text
Agent output could be excellent
```

但：

```text
Workflow control could still be wrong.
```

反过来也一样。

---

# 38. 金融领域特别需要“双轨证据”

例如一个 Proxy Vote 最终提交了：

```text
YES
```

应该至少能区分：

### Skill evidence

```text
What did the Agent analyze?
Which documents?
What evidence?
Which skill version?
Which model?
```

### Workflow evidence

```text
Which case?
Which policy?
Was review required?
Who reviewed?
When?
Which command executed?
What business state changed?
```

最终：

```text
Skill Trace
+
Workflow Audit Record
```

才构成完整证据。

FINRA 当前对 GenAI 的监管观察也明确指出，即使使用新技术，传统的 supervision、communications、recordkeeping、fair dealing 等义务仍然适用；企业需要考虑 AI 工具的可靠性、准确性以及其在监督体系中的位置。

---

# 39. 不应该让 Skill 成为“隐藏的 Policy Engine”

这是最需要写进平台设计原则的一句话：

> **Skill 可以告诉 Agent 如何遵循 Policy，但 Skill 本身不应该成为 Policy 的 authoritative enforcement point。**

例如：

```text
Skill:
"根据公司政策解释是否支持该议案。"
```

合理。

但：

```text
Skill:
"任何置信度 > 0.8 的 proposal 自动提交。"
```

如果这是企业正式 Policy，就不应该只存在 Skill。

应该：

```text
Skill
 ↓
Recommendation
 ↓
Gate / Policy Engine
 ↓
Command
```

这样即使以后：

```text
LLM
Model
Prompt
Skill version
```

全部变化：

```text
Policy
```

仍然独立存在。

---

# 40. 不应该让 Workflow 变成“Prompt Container”

反过来也同样重要。

如果 Workflow Definition 最终变成：

```yaml
task:
  prompt: |
    You are a senior investment analyst...
    Read these documents...
    Think deeply...
    Use these tools...
    If uncertain...
```

那么：

```text
Workflow
```

就开始吸收：

```text
Agent implementation details
```

应该把它变成：

```text
Workflow:
  task: analyzeProposal
  executor:
    skill: proxy-voting-analysis
```

然后 Skill：

```text
SKILL.md
```

负责：

```text
instructions
references
scripts
examples
```

这样两个层次都干净。

---

# 41. 一个更完整的企业架构

最终建议：

```text
┌────────────────────────────────────────────────┐
│                Business Control Plane          │
│                                                │
│ Workflow Definition                            │
│ Business State                                 │
│ Policy / Authorization                         │
│ Task / Gate / Review / Command                 │
│ Durable Execution / Checkpoints                │
│ Audit Evidence                                 │
└───────────────────────┬────────────────────────┘
                        │
                        │ Task invocation
                        ↓
┌────────────────────────────────────────────────┐
│                  Agent Runtime                 │
│                                                │
│ Context                                        │
│ Reasoning                                      │
│ Skill Discovery                                │
│ Skill Activation                               │
│ Tool Selection                                 │
│ Sub-Agent Delegation                           │
│ Agent Memory                                   │
└───────────────────────┬────────────────────────┘
                        │
                        ↓
┌────────────────────────────────────────────────┐
│                    Skill Layer                 │
│                                                │
│ Procedural Knowledge                           │
│ Domain Guidance                                │
│ Scripts                                        │
│ References                                     │
│ Templates                                      │
│ Examples                                       │
└────────────────────────────────────────────────┘
```

这里有三个不同的“真相来源”：

```text
Workflow
  = business process truth

Policy / Authorization
  = control truth

Skill
  = procedural knowledge truth
```

而：

```text
Agent Runtime
```

不是上述任何一个的 authoritative source of truth。

---

# 42. 最终原则

### Principle 1

**Skill 与 Workflow 必须在语义上分离。**

不是说 Skill 不能包含步骤，而是：

```text
Skill procedure
≠
Business workflow
```

---

### Principle 2

**Workflow 是 Business Process 的 authoritative source of truth。**

---

### Principle 3

**Skill 是 Agent 的 reusable procedural capability。**

---

### Principle 4

**Workflow 可以调用 Skill，但 Skill 不应该反向拥有 Workflow State。**

---

### Principle 5

**Skill 可以产生 Proposal / Analysis / Evidence，但不应直接定义 Business Decision。**

---

### Principle 6

**Skill 可以包含局部 procedure，但不应成为企业 Business State Machine。**

---

### Principle 7

**Authorization、Entitlement、Approval Requirement 和 Command Control 不应该只存在于 Skill。**

---

### Principle 8

**Skill 和 Workflow 应允许独立版本化、独立评估和独立变更治理。**

---

### Principle 9

**Skill 可以被多个 Workflow 复用；Workflow 可以组合多个 Skill。**

---

### Principle 10

**物理上可以合并，语义上不要合并。**

这是本文最重要的限定。

可以：

```text
one repository
one package
one deployment
```

但内部仍然应该有：

```text
Workflow Definition
Skill
Policy
```

三个不同的责任边界。

---

# 43. 最终模型

可以把整个设计浓缩成：

```text
                         Business Process
                               │
                               ↓
                       Workflow Definition
                               │
                ┌──────────────┼──────────────┐
                ↓              ↓              ↓
              Task            Gate          Review
                │
                │ uses
                ↓
             Skill
                │
      ┌─────────┼─────────┐
      ↓         ↓         ↓
   Tools     Scripts   References
                │
                ↓
             Agent
                │
          reasoning loop
                │
                ↓
             Result
                │
                ↓
          Workflow Gate
                │
                ↓
             Command
                │
                ↓
         Business State
```

最终可以用两句话区分：

> **Skill 决定 Agent 如何完成一类工作；Workflow 决定企业业务过程必须发生什么。**

以及：

> **Skill 可以参与 Workflow，但不应该成为 Workflow 的 authoritative source of truth。**

对于金融服务，这个边界尤其重要，因为企业需要同时管理：

```text
AI capability
+
business process
+
policy
+
authorization
+
human accountability
+
audit evidence
```

这些东西可以组合，但不应该被压缩成一个：

```text
SKILL.md
```

否则最终会得到一个“看起来很灵活”的 Agent，却失去真正需要的业务控制边界。

---

# 参考资料

### Agent Skills 标准与大厂实现

**[1] Agent Skills Open Standard — Overview**
Agent Skills 定义为可发现、可组合的 instruction / scripts / resources package，并采用 progressive disclosure。
[Agent Skills Overview](https://github.com/agentskills/agentskills/blob/main/docs/home.mdx?utm_source=chatgpt.com)

**[2] Agent Skills Open Standard — Specification**
定义 `SKILL.md`、scripts、references、assets、progressive disclosure 等格式。
[Agent Skills Specification](https://github.com/agentskills/agentskills/blob/main/docs/specification.mdx?utm_source=chatgpt.com)

**[3] Anthropic — Equipping agents for the real world with Agent Skills**
Anthropic 对 Skill 的官方设计说明，强调 procedural knowledge、scripts、resources、composability 和 progressive loading。
[Anthropic Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills?utm_source=chatgpt.com)

**[4] Anthropic — Claude Skills**
Anthropic 对 Skill 的产品级说明，包括自动发现、按需激活、跨 Claude products 使用。
[Introducing Agent Skills](https://www.anthropic.com/research/skills?utm_source=chatgpt.com)

**[5] OpenAI — Skills**
OpenAI 当前文档明确支持 reusable instructions、references、scripts，并允许 Skill 描述 multi-step workflows。
[OpenAI Skills](https://developers.openai.com/zh-Hans/api/docs/guides/tools-skills?utm_source=chatgpt.com)

**[6] OpenAI — Build skills / Evaluate skills**
OpenAI 说明 Skill 的 `name`/`description` 用于 discovery/routing，并通过 progressive disclosure 决定何时加载完整 Skill。
[OpenAI — Build skills](https://developers.openai.com/zh-Hans/docs/build-skills?utm_source=chatgpt.com)
[OpenAI — Evaluate Skills](https://developers.openai.com/zh-Hans/blog/eval-skills?utm_source=chatgpt.com)

**[7] GitHub Copilot — About agent skills**
GitHub 将 Skill 定义为可按需加载的 instructions/scripts/resources，用于 specialized tasks，并支持跨多个 agent surfaces。
[GitHub — About agent skills](https://docs.github.com/en/enterprise-cloud%40latest/copilot/concepts/agents/about-agent-skills?utm_source=chatgpt.com)

---

### Workflow 与 Agent orchestration

**[8] Microsoft — Agent Skills**
最直接的官方对比：Skill 与 Workflow 在 control、resilience、side effects、complexity 上是不同抽象。
[Microsoft — Agent Skills](https://learn.microsoft.com/en-us/agent-framework/agents/skills?utm_source=chatgpt.com)

**[9] AWS Agentic AI Lens — Workflow orchestration**
AWS 区分 static workflows、dynamic workflows 和 hybrid orchestration，并讨论多 Agent 的 workflow orchestration。
[AWS — Workflow orchestration and multi-agent collaboration](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentperf05.html?utm_source=chatgpt.com)

**[10] AWS AgentCore — Skills**
AWS AgentCore 将 Skills 作为可加载的 reusable instruction packages，通过 progressive disclosure 提供 Agent capability。
[AWS AgentCore — Skills](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/harness-skills.html?utm_source=chatgpt.com)

**[11] AWS AgentCore — Concepts and terminology**
AWS 明确区分 Agent、Skill、Custom Resource，并定义 Skill 为可以被多个 Agent 共享的 reusable capability。
[AWS AgentCore — Concepts and terminology](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/registry-concepts.html?utm_source=chatgpt.com)

---

### Skill 安全与治理

**[12] Microsoft — Agent Skills security best practices**
微软明确要求把 Skill 当作 third-party code 管理，并要求 provenance、review、sandboxing、audit/logging。
[Microsoft — Agent Skills security](https://learn.microsoft.com/en-us/agent-framework/agents/skills?utm_source=chatgpt.com#security-best-practices)

**[13] AWS AgentCore — Security and access controls**
AWS 明确指出 Skill 会被注入 Agent context，Skill source、内容和调用覆盖必须由使用方治理。
[AWS AgentCore — Security and access controls](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/harness-security.html?utm_source=chatgpt.com)

**[14] AWS AgentCore — Security best practices**
讨论 IAM、身份传播、输入验证、least privilege 和 auditing。
[AWS AgentCore — Security best practices](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-security-best-practices.html?utm_source=chatgpt.com)

---

### 金融服务实践

**[15] Anthropic — Agents for financial services**
Anthropic 的 2026 金融服务 Agent 模板把 Skills、Connectors、Subagents 与企业的 risk policies / approval flows 分开组合，这是很直接的行业案例。
[Anthropic — Agents for financial services](https://www.anthropic.com/news/finance-agents?utm_source=chatgpt.com)

**[16] BIS — Governance of AI adoption in central banks**
强调 AI 风险应纳入既有治理和 risk management framework，并使用 three lines of defence 等成熟治理结构。
[BIS — Governance of AI adoption in central banks](https://www.bis.org/publications/governance-ai-adoption-central-banks.htm?utm_source=chatgpt.com)

**[17] FINRA — GenAI: Continuing and Emerging Trends, 2026**
强调 GenAI 的使用并不会消除既有的 supervision、recordkeeping、fair dealing 等义务。
[FINRA — GenAI: Continuing and Emerging Trends](https://www.finra.org/rules-guidance/guidance/reports/2026-finra-annual-regulatory-oversight-report/gen-ai?utm_source=chatgpt.com)

**[18] Federal Reserve / OCC / FDIC — Revised Model Risk Management Guidance, 2026**
2026 修订版强调 model use、validation、monitoring、governance 和 roles/responsibilities；同时明确指出 generative AI / agentic AI 当时尚不在该 guidance 的 scope 内，监管框架仍在发展。
[Federal Reserve — SR 26-2](https://www.federalreserve.gov/supervisionreg/srletters/SR2602.htm?utm_source=chatgpt.com)
[OCC — Bulletin 2026-13](https://occ.gov/news-issuances/bulletins/2026/bulletin-2026-13.html?utm_source=chatgpt.com)

---

## 自审：先判断论点是否正确，再判断是否说过头

### 1. 核心论点是否正确？

**正确，但必须把“分离”定义为语义分离，而不是文件分离。**

目前最强的证据实际上来自 Microsoft：

> Skill：AI 决定怎么做。
> Workflow：你明确规定 execution path。

AWS 也把：

```text
Skill = reusable capability
Workflow = orchestration
```

分开描述。

Anthropic、OpenAI、GitHub 的 Skills 设计又都强调：

```text
discovery
activation
procedural instructions
resources
scripts
reuse
```

因此，把两者分别定义为：

```text
Skill
= reusable procedural capability

Workflow
= authoritative business process
```

是有充分业界依据的。

---

### 2. “必须分离”有没有说过头？

**如果理解成“Skill 和 Workflow 必须是两个独立文件/仓库/部署单元”，那就是说过头。**

实际上：

* Anthropic 的 Skill 可以描述 workflows；
* OpenAI 的 Skill 可以包含 multi-step workflows；
* Microsoft 甚至把 Skill 描述为可以承载 focused workflows。

所以不能写成：

> “Skill 里不能出现 workflow-like instructions。”

这不成立。

真正正确的限定是：

> **Skill 可以包含 procedural workflow；但它不应该成为企业 Business Workflow 的 authoritative definition。**

这一区分非常关键。

---

### 3. “Workflow 必须 deterministic”有没有说过头？

也需要修正。

AWS 当前 Agentic AI Lens 明确承认：

```text
static workflow
dynamic workflow
hybrid workflow
```

都是合理架构。

所以不能说：

> Workflow = 100% deterministic.

更准确：

> **Workflow 对其负责的业务控制边界应该是显式、可治理、可恢复的；Workflow 内部仍可以调用具有概率性的 Agent/Skill。**

即：

```text
Workflow
   ↓
Task
   ↓
Agent
   ↓
Skill
```

完全没有问题。

---

### 4. “金融监管要求 Skill 与 Workflow 分离”有没有说过头？

**有。不能这样写。**

BIS、FINRA、Fed/OCC 等材料支持的是：

```text
governance
risk management
accountability
supervision
recordkeeping
roles & responsibilities
```

它们并没有要求：

```text
SKILL.md
≠
workflow.yaml
```

所以本文的金融部分应该表述为：

> **金融服务的治理、授权、审计和责任要求，使这种架构分离非常有价值。**

而不能说：

> **监管规定必须把 Skill 和 Workflow 分开。**

尤其 2026 年 Fed/OCC/FDIC 的新 guidance 还明确说明 generative AI / agentic AI 尚未纳入该 guidance scope，并表示相关治理仍在进一步发展。

---

### 5. 哪个结论最值得保留？

我认为最终应该把整篇文章的核心原则压缩成：

> **Skill 与 Workflow 必须分离的，不是文件，而是“权威性”。**
>
> Skill 是 Agent 的 procedural capability，可以被发现、组合、替换、升级；Workflow 是 Business Process 的 authoritative control，负责状态、顺序、Gate、Review、Command、恢复和审计。
>
> **Workflow 可以调用 Skill；Skill 可以包含局部 procedure；但 Skill 不应该成为 Business Workflow 的 source of truth。**

这个版本既符合 Anthropic/OpenAI 的 Skill 实际设计，也符合 Microsoft 对 Skill vs Workflow 的明确区分，同时没有把结论夸大成“Skill 不能有流程”或“Workflow 必须完全 deterministic”。

**对于你前面设计的 `Task / Gate / Review / Command` 四类 Workflow Node，这一篇实际上正好补上了上一层边界：**

```text
Workflow Definition
│
├── Task
│     └── may invoke Agent / Skill
│
├── Gate
│
├── Review
│
└── Command
```

而：

```text
Agent Runtime
│
└── Skill
      ├── instructions
      ├── scripts
      ├── references
      └── tools
```

这样 `Workflow`、`Agent Runtime`、`Skill` 三者的职责就基本闭合了。

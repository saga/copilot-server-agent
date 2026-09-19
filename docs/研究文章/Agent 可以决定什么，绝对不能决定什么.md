# Agent 可以决定什么，绝对不能决定什么

## 一、真正应该问的不是“Agent 能不能审批”

随着 AI Agent 从 Copilot 进入 Workflow，最容易出现的一个问题是：

> **Agent 到底可以自己决定什么？**

传统系统里，这个问题通常不明显。

因为：

```text
User
  ↓
Workflow
  ↓
Rule
  ↓
Action
```

每一步都是预先定义的。

Agent 不一样：

```text
Goal
  ↓
Agent
  ├── Reason
  ├── Plan
  ├── Retrieve
  ├── Choose Tool
  ├── Change Plan
  ├── Handle Exception
  └── Execute
```

Agent 真正带来的不是：

> “又增加了一个 API Client。”

而是：

> **软件第一次开始在运行过程中自行决定下一步做什么。**

FINRA 2026 年对金融机构 AI Agents 的监管观察，已经把 `Autonomy`、`Scope and Authority`、`Auditability and Transparency` 列为 Agent 特有的重要风险，并明确提出金融机构需要考虑在哪里加入 Human-in-the-loop、如何跟踪 Agent 的 actions / decisions，以及如何通过 guardrails 限制 Agent 的行为。

因此，企业真正需要定义的是：

```text
Agent Decision Boundary
```

而不是简单的：

```text
Allowed Tools
```

---

# 二、先给结论

一个成熟的企业 Agent，应该允许它在**明确授权的边界内部自主决定“怎么做”**，但不能让它自主决定：

```text
1. 自己拥有什么权限
2. 自己是否需要人类监督
3. 自己是否可以绕过 Policy / Approval / SoD
4. 自己是否可以扩大执行范围
5. 自己是否可以改变组织授权关系
6. 自己是否可以把自己的 Recommendation 变成最终 Authority
7. 自己是否可以修改 Business Truth
8. 自己是否可以修改、删除或伪造 Audit Evidence
```

这几类应该成为企业 Agent Platform 的**硬不变量**。

除此之外，很多事情完全可以交给 Agent：

```text
搜索什么
先做什么
怎么规划
调用哪个已经获批的 Tool
如何组合多个 Tool
如何整理信息
如何生成 Proposal
如何在允许范围内重试
如何选择低风险执行路径
如何发现异常
如何请求人工帮助
```

所以最重要的一句话是：

> **Agent 可以自主决定“如何完成被授权的工作”，但不能自主决定“自己的授权边界是什么”。**

AWS 当前 Agentic AI Lens 的设计原则也是类似方向：Agent 应该是 specialized、bounded、带有明确 scope 和 authority；autonomy 必须和 proportionate human oversight 配对。

---

# 三、Agent 到底在做几种不同的“决定”？

很多系统把所有 Agent Decision 都混在一起。

实际上至少存在六类：

```text
Observation
    ↓
Interpretation
    ↓
Planning
    ↓
Recommendation
    ↓
Business Decision
    ↓
Authorization
    ↓
Execution
```

更具体：

| 类型                 | 示例                        | 是否适合 Agent 自主决定       |
| ------------------ | ------------------------- | --------------------- |
| Operational Choice | 先查哪个数据源                   | 是                     |
| Planning Choice    | 先做 Research 还是 Risk Check | 是                     |
| Tool Choice        | 调哪个已获批 Tool               | 通常是                   |
| Recommendation     | 推荐哪个方案                    | 可以                    |
| Business Decision  | 是否接受重大风险                  | 通常受 Human / Policy 约束 |
| Authority Decision | 谁可以批准、Agent 可以拥有多少权限      | 不能由 Agent 自己决定        |
| Execution          | 执行一个已经授权的 Command         | 可以在明确边界内              |

最容易出问题的是：

> Agent 在前几层获得了自主权以后，悄悄把这种自主权延伸到后两层。

例如：

```text
Agent 可以选 Tool
        ↓
所以 Agent 自己决定 Tool 可以做什么
```

或者：

```text
Agent 可以生成 Proposal
        ↓
所以 Agent 自己决定 Proposal 已经被批准
```

这就是 Authority Boundary 被穿透。

---

# 四、一个必须建立的概念：Operational Autonomy ≠ Organizational Authority

Agent 可以拥有很高的：

```text
Operational Autonomy
```

但同时只有很低的：

```text
Organizational Authority
```

例如：

```text
Research Agent
```

可以自主：

```text
搜索 30 个数据源
选择检索顺序
比较研究结果
发现数据矛盾
重新检索
生成研究摘要
生成投资 Proposal
```

这已经是相当高的自主性。

但它仍然没有：

```text
APPROVE_INVESTMENT
CHANGE_POLICY
GRANT_PERMISSION
TRANSFER_OWNERSHIP
EXECUTE_UNBOUNDED_TRADE
```

这种组织 Authority。

所以：

> **Agent 可以很“聪明”，但不应该因此变得很“有权”。**

AWS 明确要求 Agent 使用独立于 Human 的 Service Identity，并避免 Agent 假设 Human Role；当 Agent 代表用户行动时，传播用户上下文，但不直接继承用户凭证。

---

# 五、Agent 可以自主决定什么？

## 1. 信息获取路径

例如：

```text
Agent
  ↓
需要回答投资风险
```

它可以自主决定：

```text
先查询 Portfolio Data
还是先搜索 Research
还是先读取 Policy
```

只要：

```text
数据源本身已获批准
+
Data Entitlement 不被突破
```

这是 Agent 最适合自主决策的地方。

---

# 六、Agent 可以决定执行顺序

例如：

```text
Task:
Prepare Investment Review
```

Agent 可以选择：

```text
Step 1:
读取现有 Position

Step 2:
查询 Research

Step 3:
检查 Risk

Step 4:
发现缺失数据

Step 5:
补充查询

Step 6:
生成 Review Package
```

传统 Workflow 可能把这些写死。

Agent 可以动态调整。

这正是 Agent 的价值。

Microsoft 当前 Agent Framework 也明确支持 Sequential、Concurrent、Handoff、Group Chat 和动态协调等不同 Agent orchestration，而不是把所有决策都硬编码成固定路径。

---

# 七、Agent 可以选择已经获批的 Tool

只要：

```text
Tool
  ↓
已在 Agent Capability Scope 内
```

Agent 可以决定：

```text
用 Tool A
不用 Tool B
先调用 A
再调用 C
```

但：

> **Tool Choice ≠ Tool Authorization。**

Agent 可以选择：

```text
Approved Tool
```

不能选择：

```text
Unapproved Tool
```

AWS 明确要求每次 Tool Invocation 在执行前经过外部 Policy 授权，Agent 只能访问已获批范围内的 Tools；Agent 自己的判断不能成为唯一授权边界。

---

# 八、Agent 可以自主重试，但不能自主扩大失败范围

例如：

```text
API timeout
```

Agent 可以：

```text
retry
backoff
switch approved endpoint
re-read status
```

但如果失败：

```text
Payment submission failed
```

不能自动变成：

```text
“那我把 amount 从 1M 改成 2M 再试一次。”
```

也不能：

```text
“这个 API 不让我访问，那我换 Admin API。”
```

所以：

> **Retry 可以是自主决策；Scope Expansion 不是。**

---

# 九、Agent 可以自主处理低风险、可逆操作

例如：

```text
创建 Draft
整理内部笔记
生成内部报告
标记一个 Case
安排低风险内部 Task
更新非权威工作记录
```

这些操作的典型特点是：

```text
低影响
高可逆
范围明确
可自动回滚
没有新的 Authority
```

当前金融业实践也更接近这种路线。英格兰银行 2026 年金融稳定报告指出，目前金融市场中的更自主 AI 主要用于 Research、Coding、Surveillance 和其他较低风险运营任务，而不是全面自主交易；其同时关注未来更高自主性的系统如何被理解、约束和监控。

---

# 十、Agent 可以自主生成 Recommendation

这是 Agent 最重要的能力之一。

例如：

```text
Agent:
建议降低 Portfolio X 的 exposure
```

完全可以。

但：

```text
Recommendation
    ≠
Decision
```

这是整个架构必须坚持的分界。

例如：

```text
Fact:
Exposure = 18%

Agent:
Recommendation = reduce to 12%

Human:
Accept / Reject / Modify
```

这时候 Agent 没有越过 Authority Boundary。

---

# 十一、Agent 可以发现“需要人”

甚至应该允许 Agent 主动发现：

```text
数据矛盾
规则冲突
置信度低
例外情况
高风险动作
无法判断
```

然后：

```text
Agent
  ↓
Request Human
```

Microsoft Agent Framework 当前的 HITL 机制就是这样设计的：Workflow 可以暂停，发送 typed Request，等待外部响应，再继续；这个响应不仅可以是 approve/reject，也可以是补充信息或多轮交互。

但要注意：

> Agent 可以**请求 Human Decision**，不应该自己决定 Human Decision 是否“永远不需要”。

---

# 十二、Agent 绝对不能自主决定什么？

这里需要和“通常应该由人决定”严格区分。

有些 Decision 是：

```text
Human Reserved
```

但也可能在明确授权后由 Policy 或其他自动化系统完成。

而下面几类，则应该成为平台级的：

```text
Agent MUST NOT decide
```

这是架构硬边界，而不是简单的“建议”。

---

# 十三、绝对不能之一：自己决定自己的权限

这是第一原则。

Agent 不能：

```text
grant itself permission
```

例如：

```text
Agent:
“I need WRITE access.”
```

可以：

```text
RequestCapability(WRITE)
```

但不能：

```text
ModifyRole()
AssumeAdmin()
CreateCredential()
```

然后继续执行。

NIST 2026 年关于 Agent Identity and Authorization 的概念项目，正是因为 Agent 的自主访问能力扩大之后，需要重新解决 identification、authorization、auditing 和 non-repudiation；NIST 将 Agent Identity / Authority 作为独立基础设施问题，而不是依赖 Agent 自己遵守权限边界。

---

# 十四、绝对不能之二：自己决定“我不需要 Approval”

这是 Agent 系统里最危险的 Self-Authorization 模式之一。

例如：

```text
Policy:
Trade > 10M requires Human Approval
```

Agent：

```text
“虽然超过 10M，
但我判断风险不高。”
```

然后：

```text
skip human approval
```

不允许。

正确：

```text
Agent Risk Signal
       ↓
Oversight Policy
       ↓
Human Required = TRUE
       ↓
Human Task
```

AWS 当前明确反对让 Agent 自己判断 Tool Invocation 是否合适并在没有独立检查的情况下执行；高风险 Mutating Operations 可以由 Human checkpoint 拦截。

---

# 十五、绝对不能之三：自己修改自己的 Decision Boundary

例如 Agent 当前：

```text
Allowed:
READ
RESEARCH
DRAFT
```

不能：

```text
Agent
  ↓
修改 Agent Policy
  ↓
新增 WRITE
  ↓
继续
```

同样不能：

```text
Human Approval Required
      ↓
Agent changes config
      ↓
Human Approval Not Required
```

这实际上等同于：

> **Agent 自己重新定义游戏规则。**

因此：

```text
Agent Policy
Authorization Policy
Oversight Policy
Approval Policy
```

都属于：

```text
Control Plane Authority
```

而不是：

```text
Agent Runtime State
```

---

# 十六、绝对不能之四：自己改变 Maker-Checker / SoD

例如：

```text
Maker = Agent
Checker = Human
```

Agent 发现：

```text
Human unavailable
```

不能：

```text
Agent
  ↓
appoint itself as Checker
```

也不能：

```text
Agent
  ↓
change rule:
Maker can also approve
```

Maker-Checker 的意义就是：

> 第二道控制必须独立。

因此 Agent 不能修改：

```text
makerChecker.enabled
checkerMustDiffer
requiredRoles
approvalQuorum
```

---

# 十七、绝对不能之五：自己扩大 Approval Scope

例如 Human 批准：

```text
Proposal P-1024
Security = ABC
Vote = FOR
Quantity = 125,000
```

Agent 不能自行解释成：

```text
Security = ABC
Quantity = 250,000
```

或者：

```text
Proposal P-1025
```

也不能：

```text
Human approved this type of request
      ↓
all future similar requests are approved
```

Approval 必须绑定：

```text
Proposal
Version
Scope
Parameters
Time
```

AWS 当前建议持久信任或 Approval 明确绑定到具体 Command、参数结构或 Resource 范围，避免一个无限范围的 Trust 授权整个操作类别。

---

# 十八、绝对不能之六：自己从 Recommendation 生成 Authority

这是一个极其重要的边界：

```text
Agent Recommendation
        ≠
Business Decision
```

例如：

```text
Agent:
“建议接受这个 Compliance Exception。”
```

Agent 不能继续：

```text
Exception.status = APPROVED
```

如果这个 Exception 必须由：

```text
Compliance Officer
```

决定，就必须创建：

```text
Human Task
```

然后：

```text
Human Decision
     ↓
Authorization
     ↓
Command
```

---

# 十九、绝对不能之七：自己修改 Business Truth

Agent 可以：

```text
读取 Business State
分析 Business State
提出 Business State Change
```

但不应该把自己的：

```text
Memory
Reasoning
Assumption
```

直接当成：

```text
Business Truth
```

例如：

```text
Agent Memory:
“PM 已经批准。”
```

不能变成：

```text
InvestmentCase.status = APPROVED
```

真正应该：

```text
Approval Record
   ↓
Workflow
   ↓
Domain Command
   ↓
Business State
```

这也解释了为什么：

> **Business State 不应该以 Agent Memory 为 Source of Truth。**

---

# 二十、绝对不能之八：自己修改 Audit Evidence

这是经常被遗漏的一条。

Agent 不能：

```text
delete audit
rewrite approval
change actor
erase tool call
hide failure
```

例如：

```text
Agent:
“这次 Tool Call 是测试，可以不记录。”
```

不允许。

Audit 应该处在 Agent Authority 之外：

```text
Agent Runtime
      ↓
Audit Event
      ↓
Immutable / Controlled Audit Store
```

而不是：

```text
Agent
  ↓
“自己决定记录什么”
```

EU AI Act 对适用的 High-Risk AI 要求系统具备自动事件记录能力；FSB 2026 咨询报告也建议金融机构记录 Agent 的关键中间步骤、Tool / API / Data Access 和最终结果，以支持监督、Contestability 和 Kill Switch 等机制。

---

# 二十一、绝对不能之九：自己决定“什么才算成功”

这是 Agentic Workflow 特别容易出现的问题。

例如：

```text
Goal:
完成 Proxy Vote
```

Agent：

```text
ISS API timeout
```

然后：

```text
Agent:
“返回 HTTP 200 就算成功。”
```

但实际上：

```text
Vote status = unknown
```

正确：

```text
Command
   ↓
Execution
   ↓
External Result
   ↓
Reconciliation
   ↓
Business Success
```

> **Agent 自己解释“我完成了”不能成为 Business Success 的 Source of Truth。**

FSB 2026 咨询报告也特别建议金融机构记录 Agent 的最终 outcome，包括 Agent 对“success”的解释，并监控其关键中间步骤和工具访问情况；换句话说，Agent 的 success interpretation 本身也应该进入受控观察体系，而不是直接成为业务真值。

---

# 二十二、绝对不能之十：自己决定是否绕过 Domain Invariant

例如：

```text
Position quantity cannot be negative.
```

Agent：

```text
Current quantity = 100
Need sell = 150
```

不能：

```text
“为了完成用户目标，
我允许 negative position。”
```

Domain 必须拒绝。

即：

```text
Agent
   ↓
Proposal
   ↓
Domain Invariant
   ↓
ALLOW / DENY
```

Agent 不能改变：

```text
Business Invariant
```

除非业务本身正式修改了 Domain Policy。

---

# 二十三、所以 Agent 的“绝对不能”其实可以归纳成四大类

```text
             Agent Hard Boundary

      ┌──────────┬──────────┬──────────┬──────────┐
      │          │          │          │
   Authority   Boundary    Truth      Evidence
      │          │          │          │
   权限        Policy      Business    Audit
   角色        SoD         State      Evidence
   Delegation  Approval    Invariant  Logs
```

具体：

```text
Authority:
不能给自己权限

Boundary:
不能修改自己的约束

Truth:
不能自行改变 Business Truth

Evidence:
不能修改 / 隐藏 Audit Evidence
```

这四组可以成为平台级不可变原则。

---

# 二十四、金融服务领域最重要的特殊问题

金融行业不是简单地：

> “AI 更危险，所以人工更多。”

真正的问题是：

> **金融机构本来就已经有一整套责任、授权、控制、审计和风险治理体系。**

Agent 的问题是：

> 如何自动化工作，同时不破坏原来的 Control System。

FCA 在 2026 年明确表示，对于金融机构的 AI 使用，监管重点仍然依托现有框架，包括 Consumer Duty、Senior Managers and Certification Regime（SM&CR）以及现有 governance / controls，而不是简单地建立一套与既有体系完全平行的“AI Regulation”。

这意味着：

> **Agent 不是一个新的组织角色，可以直接替代原有的授权、治理和责任体系。**

---

# 二十五、金融领域真正需要保护的是四条 Authority Chain

## 1. Business Authority

```text
谁能决定业务？
```

例如：

```text
PM
Credit Committee
Risk Owner
Compliance Officer
```

---

## 2. Execution Authority

```text
谁能让外部世界发生变化？
```

例如：

```text
Payment System
Trading System
ISS
CRM
Core Banking
```

---

## 3. Policy Authority

```text
谁可以改变规则？
```

例如：

```text
Approval Threshold
Risk Limit
Data Entitlement
SoD
```

---

## 4. Accountability

```text
谁负责解释最终结果？
```

例如：

```text
Business Owner
Risk Owner
Senior Manager
```

Agent 可以参与前三条链中的工作。

但：

> **不能因为参与 Execution，就自动得到 Business Authority；不能因为参与 Business Workflow，就自动得到 Policy Authority。**

---

# 二十六、FINRA 的 Agent 风险其实可以直接转成架构问题

FINRA 当前列出的：

```text
Autonomy
Scope and Authority
Auditability and Transparency
Data Sensitivity
Domain Knowledge
Rewards / Reinforcement
Bias / Hallucination
```

可以映射成：

| FINRA 风险            | 架构控制                       |
| ------------------- | -------------------------- |
| Autonomy            | Oversight Policy           |
| Scope & Authority   | Authorization / Capability |
| Auditability        | Audit Evidence             |
| Data Sensitivity    | Data Entitlement           |
| Domain Knowledge    | Bounded Agent              |
| Reward Misalignment | Goal / Policy Boundary     |
| Hallucination       | Evidence / Validation      |
| Human Oversight     | Human Task / Approval      |

这也是为什么：

> Agent Governance 不能只有 Model Governance。

它最终必须进入：

```text
Identity
Authorization
Workflow
Policy
Human Oversight
Domain
Audit
```

---

# 二十七、金融领域一个很现实的方向：Agent 更可能先自动化“工作”，而不是自动化“最终权威”

BIS 2025 年关于 AI Agent 与现金管理的研究发现，通用 GenAI Agent 在模拟的批发支付流动性管理任务中已经可以执行复杂的常规任务，包括流动性缓冲、支付优先级和成本/延迟权衡；但研究仍强调需要监管 safeguards、Human Oversight 和进一步研究。

BIS 2025 年关于中央银行人力资本的研究也把 AI Agent 描述为可能自动化部分岗位任务，但强调 Human Oversight 对负责任采用仍然重要。

所以一个比较现实的演进：

```text
Human
   ↓
defines goal / constraints

Agent
   ↓
does work autonomously

Human / Policy
   ↓
retains important authority

Domain
   ↓
enforces business truth
```

而不是：

```text
Human
   ↓
"do everything for me"

Agent
   ↓
becomes the organization
```

---

# 二十八、金融市场尤其要警惕“集体 Agent 决策”

这不是单个 Agent 的问题。

假设：

```text
Bank A Agent
Bank B Agent
Fund A Agent
Fund B Agent
```

全部看到相似数据、相似模型、相似规则。

可能同时：

```text
Buy
Buy
Buy
Buy
```

或者：

```text
Sell
Sell
Sell
Sell
```

英格兰银行 2026 年金融稳定报告已经把更自主 Agent 在金融市场中的潜在集体行为、相关性以及系统性影响列为值得研究的问题，并通过 Project Logos 等项目探索 LLM-based agents 作为投资组合经理时的市场行为。

这意味着：

> Agent 的 Decision Boundary 还不只是“单个 Agent 会不会犯错”。

还需要考虑：

```text
Multiple Agents
      ↓
Common Model
Common Data
Common Tools
Common Objective
      ↓
Correlated Decisions
```

所以金融 Agent 的自主决策空间不能无限扩大。

---

# 二十九、Agent 可以做“局部优化”，不能自行改变“全局目标”

例如：

```text
Goal:
prepare client report
```

Agent 可以：

```text
minimize time
reduce API calls
choose efficient path
```

但不能：

```text
“为了更快完成，
减少必要的 compliance check。”
```

因为这实际上是在：

```text
Local Optimization
```

的过程中改变：

```text
Global Control Constraint
```

所以：

> **Agent 可以优化执行路径，但不能优化掉控制条件。**

---

# 三十、一个适合金融 Agent 的核心不变量

> **Agent 可以优化如何完成任务，但不能把“完成任务”当成绕过控制条件的理由。**

例如：

````text
User Goal:
Submit Vote

Agent:
“如果走人工审批，太慢。”

禁止：

```text
Agent
  ↓
skip approval
````

允许：

```text
Agent
  ↓
准备更完整的 Approval Package
  ↓
减少 Human Review Time
```

这才是真正利用 AI。

---

# 三十一、Agent 可以决定“怎么问人”，不能决定“要不要遵守必须问人的规则”

这是 Human Task 设计中的一个非常实用原则。

允许：

```text
Agent:
“我需要 Compliance Officer 决定的是以下两个选项。”
```

Agent 可以：

```text
整理 Evidence
比较 Alternatives
生成推荐
```

但如果 Policy 说：

```text
Human Decision Required
```

Agent 不能：

```text
“这个人可能今天很忙，所以不问了。”
```

---

# 三十二、同样，Agent 可以决定“如何升级”，不能决定“是否取消升级路径”

例如：

```text
Human not responding for 24h
```

Agent 可以：

```text
Escalate to backup reviewer
```

但不能：

```text
remove escalation
continue autonomously
```

AWS 当前要求高风险 Human Approval 具备 escalation path；FSB 也将不同形式的 Human Oversight 和 Kill Switch 视为金融机构 Agent Governance 的组成部分。

---

# 三十三、Human 可以决定什么？

在 Agent Workflow 中，不应该只问：

> Agent 不能做什么？

还应该明确：

> **Human 保留什么权力？**

建议至少保留：

```text
Define Goal
Define Autonomy
Define Scope
Accept Material Risk
Approve Exceptions
Approve High-impact Actions
Change Authority
Change Policy
Override Agent
Stop Agent
Transfer Responsibility
Resolve Ambiguity
Take Accountability
```

这和 FSB 2026 咨询报告提出的：

```text
Human-in-the-loop
Human-on-the-loop
Human-in-command
Kill switch
Contestability
```

基本一致。FSB 同时强调，Human Oversight 必须是 meaningful 的，人员要具备足够的 ability、authority 和 incentive，而不是形式化打勾。

需要注意：截至 2026 年 9 月，FSB 这份文件仍是 **consultation report**，FSB 8 月表示最终报告预计在随后发布，因此不应把其中内容表述成已经生效的统一监管规则。

---

# 三十四、不是所有 Human Decision 都要求“逐次人工批准”

这是必须避免的另一个极端。

例如：

```text
Policy:
All payments < $1,000
and
low-risk
and
approved vendor
```

可能允许：

```text
Agent autonomous
```

因为 Human 已经在：

```text
Policy Definition
```

这一层决定：

> 在这个边界内，可以自动做。

这是一种：

```text
Human-in-command
```

而不是：

```text
Human-in-the-loop on every action
```

FSB 明确把 Human-in-command 定义为由人决定 Agent 的 autonomy extent、guardrails 和 overall impact；AWS 也明确采用 risk-tiered oversight，而不是所有操作统一人工审批。

---

# 三十五、所以 Human Authority 可以分成三层

```text
             Human Authority

       ┌──────────┬──────────┐
       │          │          │
    Boundary    Decision   Intervention
       │          │          │
    定义边界     业务决定      停止/纠偏
```

### Boundary

```text
Agent 能做什么？
```

### Decision

```text
这个 Proposal 是否接受？
```

### Intervention

```text
Agent 已经运行时，我能不能停止？
```

三者不能只做其中一项。

---

# 三十六、Agent 可以自主决定什么，最终应该采用“分层”而不是二元模型

不应该：

```text
Agent = autonomous
Agent = not autonomous
```

而应该：

```text
L0 — Suggest
L1 — Prepare
L2 — Act within bounded scope
L3 — Act with notification
L4 — Act with human approval
L5 — Human-only authority
```

例如：

| Level | Agent 权限                               | Human       |
| ----- | -------------------------------------- | ----------- |
| L0    | 仅建议                                    | 做决定         |
| L1    | 生成 Proposal                            | Review      |
| L2    | 执行低风险动作                                | 可观察         |
| L3    | 自主运行 + 异常升级                            | On-the-loop |
| L4    | 高风险动作前暂停                               | Approval    |
| L5    | Authority / Exception / Major decision | Human-only  |

这不是行业统一标准，而是一个工程化参考模型。

---

# 三十七、金融 Agent 特别适合使用 Capability Envelope

可以为每个 Agent 定义：

```yaml
agent:
  id: investment-review-agent

autonomy:
  level: 3

allowed:
  - READ_RESEARCH
  - READ_PORTFOLIO
  - GENERATE_REVIEW
  - CREATE_PROPOSAL
  - SUBMIT_FOR_REVIEW

conditional:
  - UPDATE_CASE
  - EXECUTE_APPROVED_COMMAND

human_required:
  - APPROVE_INVESTMENT
  - ACCEPT_MATERIAL_RISK
  - APPROVE_EXCEPTION

forbidden:
  - CHANGE_POLICY
  - GRANT_PERMISSION
  - CHANGE_SOD
  - ASSUME_HUMAN_ROLE
  - DELETE_AUDIT
```

这就是：

> **Capability Envelope。**

---

# 三十八、但是 Capability Envelope 也不能是 Prompt

不要：

```text
System Prompt:
“You cannot approve trades.”
```

因为这不是强约束。

正确：

```text
Agent Runtime
  ↓
Tool Gateway
  ↓
Authorization
  ↓
Capability Envelope
```

即：

```text
Prompt = Guidance
Policy = Authority
Gateway = Enforcement
```

AWS 当前 Tool Authorization 的核心就是这种外部 enforcement。

---

# 三十九、Agent 不应该拥有 Policy Write Capability

这是我非常建议在企业平台里直接定义成：

```text
FORBIDDEN_CAPABILITY
```

即：

```text
AGENT_MODIFY_AUTHORIZATION_POLICY
```

默认：

```text
DENY
```

同样：

```text
AGENT_MODIFY_APPROVAL_POLICY
AGENT_MODIFY_SOD_POLICY
AGENT_GRANT_SELF_PERMISSION
AGENT_MODIFY_AUDIT
```

都属于高敏感控制。

---

# 四十、Agent 可以提出 Policy Change，但不能直接生效

例如：

```text
Agent:
“目前 10M 阈值导致大量人工工作，
建议提高到 20M。”
```

这是有价值的。

但正确流程：

```text
Agent Recommendation
       ↓
Governance Review
       ↓
Human / Policy Authority
       ↓
Policy Version 2
       ↓
Deploy
```

而不是：

```text
Agent
  ↓
update policy
```

---

# 四十一、Agent 可以发现规则矛盾，但不能自行选择更宽松的规则

例如：

```text
Policy A:
2 approvals

Policy B:
1 approval
```

Agent 发现冲突。

它可以：

```text
raise conflict
```

不能：

```text
choose 1 approval
```

正确：

```text
Conflict
  ↓
Escalation
  ↓
Policy Owner
```

---

# 四十二、Agent 可以发现“没有人可审批”，不能因此自己批准

例如：

```text
Required:
2 approvers
```

但：

```text
All approvers offline
```

Agent 可以：

```text
notify
escalate
queue
pause
```

不能：

```text
self-approve
```

这正是：

> **Operational Deadlock ≠ Authorization Grant**

---

# 四十三、Agent 也不能因为“业务目标很重要”而突破边界

例如：

```text
Goal:
Complete trade before market close
```

Agent：

```text
“如果不绕过 Approval，就赶不上。”
```

不能：

```text
bypass approval
```

Agent 的目标：

```text
maximize task completion
```

不能高于：

```text
Authorization
Policy
Safety
SoD
```

因此：

> **业务 Goal 永远不能自动升级成 Authority。**

---

# 四十四、这是 Agent Reward / Objective 与 Enterprise Control 的根本差异

模型可能倾向：

```text
Task success ↑
Latency ↓
Cost ↓
```

企业控制要求：

```text
Authorization
Compliance
Risk
Audit
SoD
```

所以：

```text
Agent Objective
    ≠
Enterprise Objective
```

更准确：

```text
Agent Objective
    ⊆
Enterprise-approved Objective Space
```

这是 Agent Architecture 必须明确的层次关系。

---

# 四十五、金融行业尤其不能让“成功率”成为唯一优化目标

例如：

```text
Agent:
100% complete transaction
```

但：

```text
50% bypass compliance
```

这是失败。

金融 Agent 的 Success Criteria 应该是：

```text
Business Outcome
+
Policy Compliance
+
Authorization
+
Risk Constraints
+
Auditability
```

所以：

> **Agent 的“任务完成”必须定义成满足控制条件后的成功，而不是“尽可能完成用户目标”。**

---

# 四十六、一个完整的金融 Agent Decision Flow

```text
                     User / Business Goal
                              │
                              ▼
                       Agent Reasoning
                              │
                              ▼
                           Proposal
                              │
                      Oversight Policy
                              │
           ┌──────────────────┼──────────────────┐
           │                  │                  │
       Autonomous          Human Required      Denied
           │                  │
           │             Human Decision
           │                  │
           └──────────┬───────┘
                      │
               Authorization
                      │
                 Scope Check
                      │
                 SoD Check
                      │
              Domain Invariant
                      │
                   Command
                      │
                  Execution
                      │
                Reconciliation
                      │
                    Audit
```

Agent 只负责：

```text
Reasoning
Planning
Proposal
Bounded Execution
```

而不是整个：

```text
Decision → Authorization → Truth
```

---

# 四十七、为什么“绝对不能”必须写成 Architecture Invariants？

因为如果只是：

```text
Best Practice:
Agent should not...
```

开发团队以后很容易说：

> “为了方便，我们把这个放进 Agent。”

例如：

```text
Agent decide approval
```

因为：

```text
“模型很可靠。”
```

或者：

```text
Agent write Business State
```

因为：

```text
“少一个 service。”
```

或者：

```text
Agent change permission
```

因为：

```text
“自动 provisioning 更方便。”
```

所以建议把这些直接写成：

```text
MUST NOT
```

例如：

```text
Agent MUST NOT grant itself authority.

Agent MUST NOT modify its own authorization boundary.

Agent MUST NOT bypass a mandatory approval checkpoint.

Agent MUST NOT modify authoritative business state outside approved commands.

Agent MUST NOT alter or suppress audit evidence.

Agent MUST NOT convert a recommendation into an authorized business decision.

Agent MUST NOT alter SoD / Maker-Checker constraints.
```

---

# 四十八、但不要把所有“Human Required”都写成 MUST

这里非常重要。

例如：

```text
Agent executes a $100 internal task.
```

不应该写：

```text
MUST HAVE HUMAN APPROVAL
```

更准确：

```text
MAY execute autonomously
```

而：

```text
$50M external transfer
```

可能：

```text
MUST satisfy configured human / dual authorization controls
```

这取决于：

```text
Policy
Regulation
Business Risk
```

所以：

```text
Hard Invariant
```

和：

```text
Oversight Policy
```

必须分开。

---

# 四十九、Hard Invariant 与 Oversight Policy 的区别

### Hard Invariant

任何 Agent 都不能违反：

```text
No self-authorization
No policy bypass
No audit tampering
No unauthorized scope expansion
No unauthorized role assumption
```

---

### Oversight Policy

根据业务：

```text
$ < threshold
→ Autonomous

$ > threshold
→ Human Approval

Exception
→ Human

Low-risk
→ Notify
```

可以变化。

这样：

```text
平台核心安全原则
```

和：

```text
业务具体审批规则
```

不会混在一起。

---

# 五十、金融 Agent 最适合使用“双层边界”

```text
                Agent
                   │
           ┌───────▼────────┐
           │ Hard Boundary  │
           │                │
           │ No self-auth   │
           │ No bypass     │
           │ No audit edit  │
           │ No scope      │
           └───────┬────────┘
                   │
           ┌───────▼────────┐
           │ Oversight      │
           │ Policy         │
           │                │
           │ Auto           │
           │ Notify         │
           │ Approve        │
           │ Dual Control   │
           └───────┬────────┘
                   │
                Action
```

这比：

```text
All Agent actions
→ Human approval
```

更合理。

---

# 五十一、金融服务领域还有一个非常重要的判断：客户影响

以下决策即使技术上可以自动化，也可能因为：

```text
Customer Impact
```

而需要更强监督。

例如：

```text
贷款拒绝
保险理赔
客户账户限制
重大费用
客户适当性
投资建议
客户资产操作
```

具体是否依法要求人工，必须看具体司法辖区与业务规则。

但从治理角度：

> **客户遭受重大不利后果时，不应该只问 Agent“置信度够不够”。**

应该考虑：

```text
Human Review
Contestability
Appeal
Redress
Audit
```

FSB 2026 咨询报告把 Contestability 单独作为一种 Human Oversight 机制，并以 AI-assisted loan denial 的 appeal / redress 为例。

---

# 五十二、因此“人是否必须决定”与“人是否必须可以推翻”是两个问题

例如某个系统：

```text
Agent:
Low-risk claim approved
```

不一定需要逐笔人工决定。

但是在某些受监管场景：

```text
Human:
must be able to intervene / challenge / appeal
```

也就是说：

```text
Human Decision
```

与：

```text
Human Contestability
```

不是一回事。

---

# 五十三、EU AI Act 提供了一个很好的高风险 AI 参考框架

对于适用的 High-Risk AI，EU AI Act Article 14 要求系统能够被自然人有效监督，而且监督措施要与：

```text
Risk
Autonomy
Context
```

相称。

监督人员在适当情况下应能够：

```text
理解系统限制
识别异常
避免 automation bias
忽略输出
override / reverse output
interrupt system
```

这非常适合作为企业 Agent 的设计参考。

但不要把它泛化成：

> “所有企业 Agent 都受 Article 14 的同一要求约束。”

具体适用性必须结合 AI system classification、use case、jurisdiction 等判断。

---

# 五十四、FSB 对金融机构给出的方向更加接近 Agent Platform 架构

FSB 2026 年咨询报告中的 Human Oversight 原则直接考虑：

```text
Materiality
Risk
Autonomy
Complexity
Explainability
```

并明确认为有效监督必须具备：

```text
Ability
Authority
Incentive
```

而不是形式审批。对于 Agentic AI，FSB 进一步建议：

```text
定义禁止动作
定义需要人工批准的动作
在 Agent 偏离初始 Human-defined scope 时进行人工干预
控制 Agent 对 APIs、Data、ICT systems 和其他 Agents 的访问
对金融交易设置 Human Approval / Dual Authorization
```

这和前面的：

```text
Capability
Approval Policy
SoD
Human Task
Authorization
```

正好可以拼起来。

---

# 五十五、FCA 的方向更强调：责任不会因为用了 AI 就消失

FCA 2026 年明确表示，它当前仍然依赖现有金融服务框架，包括 Consumer Duty、SM&CR 和既有治理/控制来处理 AI 使用，而不是把 AI 当成一个能够脱离原有治理体系的特殊角色。

这对应到 Agent Architecture，就是：

```text
Human / Organization
       ↓
Responsibility
       ↓
Policy
       ↓
Agent
```

而不是：

```text
Human
       ↓
“交给 Agent”
       ↓
Responsibility disappears
```

---

# 五十六、所以金融 Agent 最不应该做的是“组织模拟”

例如：

```text
PM Agent
Compliance Agent
Risk Agent
Operations Agent
```

然后认为：

```text
“整个组织已经 Agent 化了。”
```

问题是：

```text
PM Agent
```

不能因为名字叫 PM 就自动拥有：

```text
PM Authority
```

同样：

```text
Compliance Agent
```

不能因为名字叫 Compliance 就自动拥有：

```text
Compliance Officer Authority
```

Agent 是：

```text
Technical Actor
```

不是：

```text
Organizational Role Clone
```

---

# 五十七、Agent 可以拥有 Capability，但不应该继承完整 Role

正确：

```text
Investment Review Agent
Capabilities:
READ_RESEARCH
READ_CASE
GENERATE_REVIEW
SUBMIT_REVIEW
```

错误：

```text
Investment Review Agent
Role = PORTFOLIO_MANAGER
```

因为：

```text
Role
```

通常包含很多与当前任务无关的 Authority。

AWS 明确要求 Agent 与 Human identity 分离，并要求 Agent 运行在完成任务所需的最小权限下。

---

# 五十八、Agent 不应该成为“超级 Orchestrator”

一个 Multi-Agent 系统：

```text
Orchestrator
 ├── Research Agent
 ├── Risk Agent
 ├── Compliance Agent
 └── Execution Agent
```

不应该：

```text
Orchestrator
  = all authority
```

否则：

```text
Agent A
Agent B
Agent C
```

只是名字分开。

实际上：

```text
Orchestrator
```

成了：

```text
Maker
Checker
Approver
Executor
```

全部集中。

所以：

> **Orchestration Authority ≠ Business Authority。**

---

# 五十九、Agent 可以决定 Route，但不能自行跨过 Protected Transition

例如：

```text
RESEARCH
  ↓
PM_REVIEW
  ↓
COMPLIANCE
  ↓
APPROVED
```

Agent 可以建议：

```text
“下一步应该进入 Compliance。”
```

但不能：

```text
RESEARCH
  ↓
APPROVED
```

直接跳过：

```text
PM_REVIEW
COMPLIANCE
```

除非 Workflow Policy 明确允许。

Microsoft Workflow 模型支持显式 sequencing、HITL、Request/Response 等机制；AWS 也强调 Workflow / Gateway / Policy 的外部控制，而不是让 Agent 单独决定所有 Tool / Workflow transitions。

---

# 六十、Agent 可以选择“哪个已批准路径”，不能自行创建新路径

例如：

```text
Path A:
normal approval

Path B:
exception review

Path C:
escalation
```

Agent 可以：

```text
choose A
choose B
request C
```

但不能：

```text
Path D:
skip compliance
```

然后执行。

所以：

> **Agent 可以做 bounded routing，不可以做 unbounded process redesign。**

---

# 六十一、Agent 可以自主决定“怎么处理异常”，但不能决定“异常是否违反控制”

例如：

```text
Tool timeout
```

Agent 可以：

```text
retry
wait
fallback
```

但：

```text
Compliance violation
```

不能：

```text
“既然继续业务更重要，就算了。”
```

应该：

```text
exception
  ↓
policy
  ↓
human / authorized resolver
```

---

# 六十二、Agent 可以决定“请求谁帮助”，但不应该决定“谁拥有最终 Authority”

例如：

```text
Agent:
“这个 Case 应该升级给 Senior PM。”
```

可以。

但是：

```text
Agent:
“Senior PM 没空，所以我把 Approval Authority 临时转给自己。”
```

不可以。

Routing：

```text
Agent may recommend
```

Authority:

```text
Control Plane decides
```

---

# 六十三、Agent 可以提出 Ownership Transfer，但不能自己完成 Ownership Transfer

例如：

```text
Case Owner = Alice
Alice leaves team
```

Agent 可以：

```text
Detect ownership issue
Recommend Bob
Create transfer request
```

但：

```text
Case Owner = Bob
```

应该通过：

```text
authorized command
+
policy
+
audit
```

完成。

因为 Ownership 是：

```text
Accountability
```

不是普通业务字段。

---

# 六十四、Agent 可以自动完成“无 Authority 的工作”，但不能自动完成“需要 Authority 的决定”

这是一个非常实用的判断法。

例如：

```text
Prepare Document
```

通常：

```text
Work
```

可以自动化。

而：

```text
Accept Contract
```

通常：

```text
Authority
```

需要更强控制。

所以设计 Agent 时，与其问：

> “这个动作危险吗？”

不如先问：

> **“这个动作是在执行工作，还是在行使组织 Authority？”**

---

# 六十五、金融服务中最有价值的判断轴：Authority vs Mechanics

任何业务动作都可以拆成：

```text
Business Decision
      │
      ▼
Approved Intent
      │
      ▼
Execution Mechanics
```

例如：

```text
Human:
“执行这个交易。”
```

Agent 可以决定：

```text
调用哪个 Adapter
什么时候 retry
如何处理 timeout
如何检查 status
```

但不能：

```text
改变交易方向
改变数量
改变账户
改变交易对象
```

除非这些修改重新进入授权流程。

---

# 六十六、所以推荐建立“Authority-Preserving Execution”

定义：

```text
Approved Intent
```

然后：

```text
Agent
```

可以：

```text
execute mechanics
```

但必须保持：

```text
intent
scope
parameters
```

不变。

例如：

```text
Approved:
BUY ABC
100,000 shares
Account X
```

Agent 可以：

```text
choose execution adapter
retry
reconcile
```

不能：

```text
BUY XYZ
200,000
Account Y
```

---

# 六十七、如果需要改变核心参数，就重新进入 Decision Boundary

例如：

```text
approved quantity = 100k
```

Agent 发现：

```text
execution requires 120k
```

不能：

```text
adjust automatically
```

如果 120k 超出允许的 parameter tolerance：

```text
new Proposal
  ↓
new Approval
```

如果 Policy 明确定义：

```text
quantity ± 2%
```

则：

```text
within bound
→ execute
```

这就是：

> **Bounded Autonomy。**

---

# 六十八、一个非常适合金融 Agent 的最终模型

```text
                  Business Intent
                        │
                        ▼
                    Proposal
                        │
                  Decision Boundary
                        │
          ┌─────────────┼─────────────┐
          │             │             │
      Autonomous      Human        Forbidden
          │          Decision          │
          │             │              │
          └─────────────┼──────────────┘
                        │
                 Approved Intent
                        │
                 Bounded Execution
                        │
                    Command
                        │
                     Domain
                        │
                Business State
```

这里：

```text
Decision Boundary
```

是核心。

---

# 六十九、建议企业 Agent Platform 最终定义四类 Decision

### A. Autonomous Decision

Agent 可以直接决定：

```text
选择
排序
规划
检索
重试
编排
低风险操作
```

---

### B. Policy Decision

由确定性 / 外部 Policy 决定：

```text
是否允许
是否需要 Approval
是否违反 Limit
是否满足 Entitlement
是否允许 Workflow Transition
```

Agent 可以提供 Input，但不拥有最终规则。

---

### C. Human Reserved Decision

由具有 Authority 的人决定：

```text
重大风险
重大例外
关键商业承诺
组织责任
价值判断
受监管的特定决定
```

---

### D. Forbidden Decision

Agent 永远不能：

```text
授予自己权限
改变自己边界
绕过必须的审批
伪造 Audit
改变 SoD
未经授权修改 Business Truth
```

---

# 七十、再加一个特别重要的原则：Agent 不能自己决定自己属于哪一类

否则：

```text
Agent
  ↓
Classifies itself
  ↓
“This is Autonomous”
```

整个模型失效。

正确：

```text
Action
  ↓
Oversight Policy
  ↓
Autonomous / Human / Forbidden
```

而：

```text
Agent
```

只是：

```text
input
```

而不是：

```text
policy authority
```

---

# 七十一、金融 Agent 的 Decision Boundary 应该由谁定义？

推荐：

```text
Business Owner
+
Risk
+
Compliance
+
Security
+
Architecture
+
Operations
```

共同定义。

而不是：

```text
AI Team
```

自己决定。

FCA 强调金融机构继续利用现有治理、Senior Managers and Certification Regime 等框架，而 FSB 的 2026 咨询报告也要求 Board / Senior Management 把 AI adoption 纳入 business strategy、risk appetite、governance 和 oversight。

---

# 七十二、Agent 可以帮助定义 Decision Boundary，但不能拥有它

例如 Agent 可以发现：

```text
过去 90% 的低风险案例其实无需人工。
```

它可以：

```text
recommend:
move this class to autonomous
```

但：

```text
Governance
  ↓
approve policy change
```

然后：

```text
Policy V2
```

生效。

这是真正的：

> **AI-assisted Governance**

而不是：

> **AI-owned Governance**

---

# 七十三、Human Oversight 也不是万能药

如果：

```text
Human
```

每天收到：

```text
2,000 approvals
```

然后：

```text
全部 Approve
```

表面上：

```text
Human-in-the-loop
```

实际上：

```text
No meaningful oversight
```

FSB 2026 咨询报告明确指出，人类参与本身不能保证有效监督；automation bias 和过度依赖会削弱监督质量，因此监督必须是 meaningful 的，并且监督者要有足够的 authority、ability 和 incentive。

AWS 也强调，大规模把每个 Agent action 都送人工会造成 reviewer fatigue 和 rubber-stamp approval。

---

# 七十四、所以一个好的 Agent 不是“尽可能少问人”

也不是：

> “尽可能多问人。”

真正目标：

> **只在 Human Judgment 可以改变结果的时候问人。**

例如：

```text
Agent:
3 个方案

方案 A:
低风险低收益

方案 B:
高风险高收益

方案 C:
中间

```

Human：

```text
决定 Risk Appetite
```

此时 Human 的判断有价值。

但：

```text
Agent:
先读 PDF 第 3 页还是第 5 页？
```

Human：

```text
无价值
```

所以：

> **Human should decide where human judgment matters, not where machine mechanics are uncertain.**

---

# 七十五、一个最实用的判断框架

任何 Agent Decision 都可以问：

```text
Q1:
Can this decision be safely bounded?

Q2:
Can it be deterministically constrained?

Q3:
Is it reversible?

Q4:
Does it change authority?

Q5:
Does it change business truth?

Q6:
Does it create material external impact?

Q7:
Does regulation / policy reserve the decision to a human?

Q8:
Would a reasonable organization expect someone to own the judgment?
```

如果：

```text
Q4 = YES
or
Q5 = YES
or
Q7 = YES
```

Agent 不应该自行拥有最终 Authority。

如果：

```text
Q6 = HIGH
or
Q8 = YES
```

通常需要更强 Human Oversight。

---

# 七十六、这可以直接变成一个 Agent Design Checklist

| 问题                   | Agent 自主？                    |
| -------------------- | ---------------------------- |
| 选择搜索路径               | 是                            |
| 选择已批准 Tool           | 是                            |
| 调整执行顺序               | 是                            |
| 低风险 retry            | 是                            |
| 生成 Recommendation    | 是                            |
| 生成 Proposal          | 是                            |
| 判断明显的数据异常            | 是                            |
| 决定是否触发 Human Task    | Policy 决定                    |
| 计算 Approval Quorum   | Policy Engine                |
| 选择有权 Approver        | Policy / Org                 |
| 接受重大业务风险             | 通常 Human                     |
| 批准重大例外               | Human / authorized authority |
| 修改权限                 | 不允许自主                        |
| 修改自己的 Policy         | 不允许                          |
| 跳过强制 Approval        | 不允许                          |
| 修改 Maker-Checker     | 不允许                          |
| 修改 Audit             | 不允许                          |
| 修改 Business Truth    | 只能通过受控 Domain Command        |
| 扩大 Approved Scope    | 不允许自主                        |
| Stop Agent           | Human / Control Plane        |
| 修改 Decision Boundary | Governance                   |

---

# 七十七、一个很重要的工程实现：Decision Gateway

建议不要让：

```text
Agent
```

直接：

```text
Tool
```

而是：

```text
Agent
  ↓
Decision / Action Request
  ↓
Decision Gateway
  ↓
Oversight Policy
  ↓
Authorization
  ↓
Human Task if required
  ↓
Command
```

例如：

```text
POST /actions/prepare-trade
```

不直接：

```text
POST /trade/execute
```

而是：

```text
Action Request
  ↓
Policy
  ↓
Human Required?
  ↓
Authorization
```

---

# 七十八、Decision Gateway 的核心职责

它至少应该回答：

```text
Who is acting?
What action?
On what resource?
With what parameters?
Under what task?
What authority?
What policy?
Does this require human?
Is it in scope?
```

然后：

```text
ALLOW
HUMAN_REQUIRED
DENY
```

这三个结果比：

```text
true / false
```

更适合 Agent Runtime。

---

# 七十九、为什么不能只返回 DENY？

因为：

```text
DENY
```

与：

```text
HUMAN_REQUIRED
```

完全不同。

例如：

```text
Agent:
execute trade
```

结果：

```text
HUMAN_REQUIRED
```

意味着：

```text
create Human Task
```

而：

```text
DENY
```

意味着：

```text
do not continue
```

这是 Agent Workflow 中非常重要的一层语义。

---

# 八十、推荐 Decision Gateway 返回 Typed Decision

例如：

```json
{
  "decision": "HUMAN_REQUIRED",

  "reason": "HIGH_IMPACT_EXTERNAL_ACTION",

  "requiredAuthority": {
    "role": "PORTFOLIO_MANAGER"
  },

  "approvalPolicy": {
    "id": "PM_APPROVAL_V3",
    "version": 3
  },

  "scope": {
    "proposalId": "P-1024",
    "version": 7
  }
}
```

Agent：

```text
pause
→ create Human Task
```

而不是：

```text
“我自己判断一下要不要问人。”
```

---

# 八十一、金融 Agent 平台可以建立三个 Registry

最终建议至少有：

```text
1. Capability Registry
2. Policy Registry
3. Human Decision Registry
```

### Capability Registry

```text
Agent 可以做什么？
```

### Policy Registry

```text
在什么条件下可以做？
```

### Human Decision Registry

```text
什么必须保留 Human Authority？
```

这三个组合：

```text
Capability
+
Policy
+
Human Decision Boundary
```

构成 Agent 的真正 Authority Envelope。

---

# 八十二、再增加一个 Forbidden Action Registry

对于金融生产环境，我甚至建议显式维护：

```text
Forbidden Action Registry
```

例如：

```text
AGENT_GRANT_SELF_PERMISSION
AGENT_MODIFY_AUTHORIZATION_POLICY
AGENT_MODIFY_SOD_POLICY
AGENT_DELETE_AUDIT
AGENT_BYPASS_REQUIRED_APPROVAL
AGENT_ASSUME_HUMAN_ROLE
AGENT_CHANGE_APPROVED_SCOPE
AGENT_DIRECT_DB_BUSINESS_STATE_MUTATION
```

这样：

```text
Hard Boundary
```

不是写在 Prompt 里。

而是：

```text
Tool Gateway / Policy Engine
```

直接拒绝。

---

# 八十三、最终架构

```text
                         Enterprise Governance
                                  │
                ┌─────────────────┼──────────────────┐
                │                 │                  │
        Capability Registry   Policy Registry   Human Decision Registry
                │                 │                  │
                └─────────────────┼──────────────────┘
                                  │
                         Decision Gateway
                                  │
                    ┌─────────────┼─────────────┐
                    │             │             │
                AUTONOMOUS    HUMAN_REQUIRED   DENY
                    │             │
                    │         Human Task
                    │             │
                    └──────┬──────┘
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
```

Agent Runtime：

```text
                    Agent Runtime
                         │
              ┌──────────┼──────────┐
              │          │          │
            Reason      Plan       Act
              │          │          │
              └──────────┼──────────┘
                         │
                  Decision Request
                         │
                         ▼
                  Decision Gateway
```

这就是：

> **Autonomous Runtime + Governed Authority。**

---

# 八十四、最终的 Agent Decision Model

可以把所有 Decision 分成：

```text
                  Agent Decision Space
                         │
       ┌─────────────────┼──────────────────┐
       │                 │                  │
   Autonomous          Governed          Forbidden
       │                 │                  │
       │          Policy / Human            │
       │             Decision               │
       │                 │                  │
       └─────────────────┼──────────────────┘
                         │
                    Command
```

### Autonomous

Agent 可以直接决定：

```text
How
When
Which approved path
Which approved tool
Which sequence
Which retry
Which low-risk action
```

### Governed

需要：

```text
Policy
Human
Approval
Dual Control
```

决定：

```text
Whether
Under what exception
Within what authority
At what risk
```

### Forbidden

Agent 不能：

```text
Change authority
Bypass controls
Rewrite truth
Rewrite evidence
Expand scope
Impersonate role
```

---

# 八十五、金融服务领域的最终分类

可以用一个很实用的表：

| Decision                | Agent | Policy |      Human |
| ----------------------- | ----: | -----: | ---------: |
| 搜索路径                    |     ✓ |        |            |
| 数据源排序                   |     ✓ |        |            |
| 研究方法                    |     ✓ |        |            |
| Tool 选择                 |     ✓ |      ✓ |            |
| Retry                   |     ✓ |      ✓ |            |
| Draft / Proposal        |     ✓ |        |            |
| 风险初筛                    |     ✓ |      ✓ |            |
| 是否需要人工                  |       |      ✓ |            |
| Approver 资格             |       |      ✓ | Governance |
| Approval Quorum         |       |      ✓ | Governance |
| 重大风险接受                  |    建议 |     约束 |          ✓ |
| Material Exception      |    建议 |     约束 |          ✓ |
| 重大客户影响决定                |    建议 |     约束 |       通常 ✓ |
| 重大外部承诺                  |    建议 |     约束 |       通常 ✓ |
| Policy 修改               |    建议 |        |          ✓ |
| Authorization 修改        |    建议 |        |          ✓ |
| SoD 修改                  |    建议 |        |          ✓ |
| Agent 自身权限扩大            |     ✗ |      ✓ | Governance |
| 跳过 Mandatory Approval   |     ✗ |        |            |
| 修改 Audit Evidence       |     ✗ |        |            |
| 自己成为 Approver           |     ✗ |        |            |
| 修改 Domain Invariant     |     ✗ |        |            |
| 绕过 Domain Authorization |     ✗ |        |            |

这里“通常”非常重要：具体哪些业务决定必须人工，要以适用法律、监管要求和机构自身 Policy 为准，而不是把这张表当成普遍法律规则。

---

# 八十六、一个非常重要的原则：Human Reserved ≠ Human Performed

例如：

```text
Human Authority:
Approve payment
```

并不意味着：

```text
Human must manually enter every field
```

可以：

```text
Agent prepares payment
    ↓
Human approves
    ↓
Agent executes approved command
```

这样：

```text
Human Authority
+
Agent Execution
```

可以同时存在。

这也是 Agent 真正能够改变金融运营效率的地方。

---

# 八十七、同样，Agent Decision ≠ Unsupervised Decision

例如：

```text
Agent:
选择下一步 Tool
```

如果：

```text
Tool Scope
Policy
Authorization
Domain
```

全部在外部约束：

那么这是：

```text
Autonomous
```

但不等于：

```text
Uncontrolled
```

所以正确目标不是：

```text
No autonomy
```

而是：

```text
Bounded autonomy
```

AWS 当前整个 Agentic AI Lens 的核心设计理念之一就是把 Agent 拆成 specialized / bounded agents，并以 explicit limits、scope、authority 和 proportionate oversight 控制自主性。

---

# 八十八、这也是为什么“Agent 不能做什么”比“Agent 有什么 Tool”更重要

传统系统：

```text
Permission = API access
```

Agent 系统：

```text
Capability
+
Policy
+
Decision Boundary
+
Human Oversight
```

更重要。

因为 Agent 可以：

```text
组合 Tool
```

产生原本没有直接定义出来的新行为。

例如：

```text
READ A
+
READ B
+
WRITE C
```

可能产生：

```text
Unexpected Business Action
```

因此：

> **不是只有 Tool 本身需要授权，Tool 的组合及其最终 Business Effect 也需要被约束。**

AWS 当前要求每次 Tool Invocation 外部授权，并强调 Agent Tool Access 与 capability scope 的治理，正是为了防止 Tool 组合变成无边界能力。

---

# 八十九、Agent 的最终权限应该是 Capability Intersection

一个非常适合企业 Agent 的抽象：

```text
Effective Capability
=
Agent Capability
∩
User Delegation
∩
Workflow Task
∩
Resource Entitlement
∩
Policy
∩
Approval Scope
∩
Domain Constraint
```

不是：

```text
Effective Capability
=
Agent Tool List
```

因此即使 Agent 有：

```text
EXECUTE_TRADE
```

在当前 Case 中：

```text
Trade:
ABC
100k
```

不代表它拥有：

```text
Trade:
XYZ
1M
```

---

# 九十、这个模型也解决“Agent 可以自己决定什么”的争论

真正的答案不是：

> Agent 是否有 Decision 权？

而是：

> **Agent 在哪个 Decision Space 内拥有 Decision Authority？**

例如：

```text
Planning Space
→ Agent

Tool Selection Space
→ Agent

Data Retrieval Space
→ Agent

Execution Strategy Space
→ Agent

Business Authority Space
→ Policy / Human

Organizational Authority Space
→ Human / Governance
```

这比简单说：

> “Agent 可以自主决定。”

准确得多。

---

# 九十一、最终应该把 Agent 分成三个“脑”

可以用一个非常直观的架构模型：

```text
                    Agent System
                         │
          ┌──────────────┼──────────────┐
          │              │              │
       Reasoning       Control        Authority
          │              │              │
         LLM           Policy       Human/Governance
          │              │              │
       "怎么做"       "能不能做"      "谁可以决定"
```

Agent Runtime：

```text
怎么做？
```

Policy：

```text
能不能做？
```

Human / Governance：

```text
谁有权决定？
```

这三个问题不能由同一个 LLM 同时回答。

---

# 九十二、如果把整个文档只留下 10 条原则

### 1.

> Agent 可以决定如何完成授权给它的工作。

### 2.

> Agent 不能决定自己的权限。

### 3.

> Agent 不能决定自己是否可以绕过 Human / Policy。

### 4.

> Agent 不能改变 Maker-Checker、SoD、Approval Quorum 等控制边界。

### 5.

> Agent 不能把 Recommendation 自己升级成 Business Decision。

### 6.

> Agent 不能把 Approval 泛化到未经批准的 Proposal / Scope。

### 7.

> Agent 不能把 Memory / Reasoning 当作 Business Truth。

### 8.

> Agent 不能修改或删除 Audit Evidence。

### 9.

> 重大风险、重大例外、重大不可逆后果以及适用法规明确保留给人的决定，应进入 Human Authority Boundary。

### 10.

> Human Oversight 的目标不是“每件事都点一次批准”，而是让 Human Authority 在真正需要判断的地方发挥作用。

---

# 九十三、最后的 Enterprise Agent Invariants

建议直接写进企业 Agent Architecture Standard：

```text
AGENT-AUTH-01
Agent MUST NOT grant authority to itself.

AGENT-AUTH-02
Agent MUST NOT modify its own authorization boundary.

AGENT-AUTH-03
Agent MUST NOT assume or impersonate a human organizational role
to gain authority.

AGENT-AUTH-04
Agent MUST NOT bypass a mandatory policy, approval,
segregation-of-duties, or domain control.

AGENT-AUTH-05
Agent MUST NOT expand an approved action beyond its
approved scope without re-authorization.

AGENT-AUTH-06
Agent MUST NOT turn its own recommendation into an
authorized business decision.

AGENT-AUTH-07
Agent MUST NOT treat memory, reasoning, or generated text
as authoritative business state.

AGENT-AUTH-08
Agent MUST NOT modify, suppress, or fabricate regulatory /
audit evidence.

AGENT-AUTH-09
Agent MUST NOT redefine what constitutes successful completion
of a business action.

AGENT-AUTH-10
Agent MUST NOT change the organization's human oversight
requirements for itself.
```

而对应的：

```text
AGENT-AUTONOMY-01
Agent MAY choose execution strategy within approved bounds.

AGENT-AUTONOMY-02
Agent MAY choose among approved tools.

AGENT-AUTONOMY-03
Agent MAY autonomously plan and re-plan within scope.

AGENT-AUTONOMY-04
Agent MAY retry reversible operations within policy limits.

AGENT-AUTONOMY-05
Agent MAY generate recommendations and proposals.

AGENT-AUTONOMY-06
Agent MAY request human intervention.

AGENT-AUTONOMY-07
Agent MAY execute low-risk actions under approved policy.

AGENT-AUTONOMY-08
Agent MAY optimize execution mechanics without changing
approved business intent.
```

---

# 九十四、最终架构

把整个系列文章串起来，最终应该是：

```text
                        Human / Governance
                              │
                 Decision Authority / Accountability
                              │
                              ▼
                    Human Decision Boundary
                              │
                     Oversight Policy
                              │
           ┌──────────────────┼──────────────────┐
           │                  │                  │
       AUTONOMOUS          HUMAN_REQUIRED       DENY
           │                  │
           │              Human Task
           │                  │
           │              Approval /
           │               Review
           │                  │
           └────────────┬─────┘
                        │
                  Authorization
                        │
                  Capability Check
                        │
                   Scope Check
                        │
                     SoD Check
                        │
                  Domain Invariant
                        │
                     Command
                        │
                     Domain
                        │
                  Business State
                        │
                      Audit
```

Agent Runtime 则位于：

```text
Reason
Plan
Propose
Act
```

而不是：

```text
Define Authority
Define Policy
Define Truth
```

---

# 九十五、结论

真正成熟的企业 Agent，不应该被设计成：

```text
“一个会自己做决定的人”
```

而应该被设计成：

> **一个拥有明确 Decision Space、Capability Envelope 和 Execution Boundary 的自主 Software Actor。**

它可以自己决定：

```text
怎么搜索
怎么分析
怎么规划
先做什么
调用哪个已授权 Tool
怎么重试
怎么处理低风险异常
怎么生成 Proposal
什么时候请求人帮助
```

它不应该自己决定：

```text
我有什么权限
我是否需要 Approval
我是否可以跳过 Policy
我能不能改变自己的 Role
我能不能修改 SoD
这个 Approval 是否可以扩大 Scope
这个 Recommendation 是否已经成为 Decision
这个 Memory 是否就是 Business Truth
这次执行是否可以算成功
Audit 是否可以不记录
```

而在金融服务领域，还要进一步明确：

```text
重大风险
重大例外
重大不可逆业务动作
重大客户影响
组织 Authority
Policy Change
```

这些决定的最终 Authority 应该按照适用法规、机构治理和风险 Policy 明确保留给 Human / Governance，而不是因为 Agent 技术上“能够完成”就自动转给 Agent。FINRA 2026 对 Agent 的关注点恰恰集中在 autonomy、scope/authority 和 auditability；FSB 2026 的咨询报告进一步要求金融机构根据 materiality、risk、autonomy、complexity 和 explainability 设计 meaningful human oversight。

所以，整个问题最终可以压缩成一句：

> **Agent 可以自主决定“怎么做”，Policy 决定“能不能做”，Human / Governance 决定“谁有权决定”，Domain 决定“什么才是真实发生的”。**

再进一步：

```text
Agent Autonomy
        ≠
Organizational Authority

Agent Recommendation
        ≠
Business Decision

Human Approval
        ≠
Authorization Bypass

Workflow Completion
        ≠
Business State

Agent Memory
        ≠
Business Truth
```

这几组边界一旦真正落到 Control Plane、Authorization、Workflow、Domain 和 Audit 中，Agent 才能在金融企业里获得比较大的自主性，而不会因为“自主性”本身把组织的授权体系一起自动化掉。

---

## 参考资料

**AWS Well-Architected Agentic AI Lens — Design Principles**
AWS 当前把 bounded agents、explicit scope / limits / authority、proportionate human oversight 和 enforceable contracts 作为 Agentic AI 的核心设计原则。

**AWS — Implement Tool Authorization**
AWS 要求每一次 Tool Invocation 在执行前经过外部 Policy 授权，并明确反对依赖 Agent 自己判断是否适合调用 Tool；高风险 Mutating Operations 可以设置 Human checkpoint。

**AWS — Agent Identity and Permission Management**
AWS 区分 Agent Autonomous 与 On-behalf-of-user 两种模式，并要求 Agent Identity 与 Human Identity 分离、最小权限、短生命周期授权以及清晰的审计归因。

**AWS — Human-in-the-loop for Critical Decisions**
AWS 明确指出把所有 Agent Actions 都送人工会导致 reviewer fatigue / rubber-stamp，完全没有人工监督又会造成 unbounded autonomy，因此推荐 risk-tiered human oversight。

**Microsoft Agent Framework — Human-in-the-loop**
Microsoft 当前使用 Request/Response、RequestPort 和 Checkpoint/Resume 建模 HITL，使 Agent 可以请求批准、请求额外信息、等待并继续执行。

**Microsoft Agent Framework — Tool Approval**
Microsoft 将 Tool Approval 做成 Tool Execution 前的一个明确拦截点，Agent 可以继续规划，但敏感 Tool 必须等待外部批准。

**Anthropic — Trustworthy Agents in Practice**
Anthropic 2026 年强调 Agents 的价值来自自主规划、Tool Use 和执行循环，同时明确把 Human Control 作为可信 Agent 的核心原则，并提供 always allow / needs approval / block 等权限模型。

**NIST — Software and AI Agent Identity and Authorization**
NIST 2026 年 Agent Identity / Authorization 项目关注 Agent 的 identification、authorization、auditing、non-repudiation，以及 Prompt Injection 对权限边界的影响。

**FINRA — 2026 Annual Regulatory Oversight Report: GenAI / Agents**
FINRA 把 Agent 的 Autonomy、Scope and Authority、Auditability and Transparency 等列为金融机构需要关注的新风险，并建议建立 Human-in-the-loop、Action / Decision Tracking 和 Guardrails。

**FSB — Sound Practices for Responsible AI Adoption, 2026 Consultation Report**
FSB 的 2026 咨询报告提出 Human-in-the-loop、Human-on-the-loop、Human-in-command、Kill Switch、Contestability 等多种 Human Oversight 形式，并要求监督具有足够 ability、authority 和 incentive；同时针对 Agent 建议定义 prohibited actions、human-approval checkpoints、API / data / ICT boundaries，以及金融交易的 human approval / dual authorization。该文件截至 2026 年 9 月仍是 consultation report，FSB 8 月表示最终版本预计随后发布。

**FCA — AI in Financial Services, 2026**
FCA 2026 年表示，当前对金融机构 AI 的治理仍依赖 Consumer Duty、SM&CR 等既有监管和治理框架，重点是安全、负责和有效治理，而不是让 AI 成为脱离既有责任体系的新角色。

**BIS — AI Agents for Cash Management in Payment Systems**
BIS 的实验研究表明 GenAI Agent 已能执行一部分复杂的常规现金管理任务，但在高价值金融基础设施中仍需要 regulatory safeguards、human oversight 和进一步研究。

**Bank of England — Financial Stability Report, July 2026**
英国央行指出，金融市场目前更多将自主 AI 用于 research、coding、surveillance 和低风险 operational tasks，而完全自主交易仍是不同层次的问题，同时需要关注 Agent 的可治理性以及多个 Agent 可能形成的相关行为和系统性风险。

**EU AI Act — Article 14 Human Oversight**
当前 2026-07-27 consolidated text 的 Article 14 要求适用的 High-Risk AI 能被自然人有效监督，并要求监督措施与风险、自治程度和使用环境相称；在适当情况下，监督人员应能够忽略、推翻输出或安全停止系统。

---

### 最终放进企业 Agent Architecture 的版本

```text
                    Agent Decision Space

        ┌────────────────────────────────────┐
        │           Agent MAY decide         │
        │                                    │
        │  How to search                     │
        │  How to reason                     │
        │  How to plan                       │
        │  Which approved tool               │
        │  Execution sequence                │
        │  Safe retry                         │
        │  Low-risk reversible actions       │
        │  Recommendation / Proposal         │
        └──────────────────┬─────────────────┘
                           │
                    Decision Boundary
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
    Policy decides      Human decides      NEVER
        │                  │                  │
  Can / Cannot        Material risk       Self-authorize
  Oversight level      Exception           Bypass control
  Approval rule        Authority            Change own scope
  Quorum               Judgment             Alter audit
  Entitlement          Accountability       Alter truth
        │                  │                 Change SoD
        └──────────────────┼──────────────────┘
                           │
                     Authorization
                           │
                        Command
                           │
                         Domain
                           │
                     Business State
```

最值得作为整个系列的总原则的是：

> **Agent 可以拥有 Autonomy，但不能拥有决定自己 Authority Boundary 的权力。**

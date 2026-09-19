# 从 Chatbot 到 Business Case：企业 Agent 应用的业务对象设计

## 1. 引言：企业 Agent 真正缺的不是更强的 Chat

过去两年，企业 AI 应用最自然的形态是：

```text
User
  ↓
Chat
  ↓
LLM
  ↓
Tools
```

这非常适合：

* 问答；
* 总结；
* 写作；
* 翻译；
* 一次性分析；
* 信息检索。

但是，当 Agent 开始真正进入企业业务流程，问题会发生变化。

例如一个投资业务：

```text
用户提出一个投资想法
        ↓
收集研究资料
        ↓
补充市场数据
        ↓
形成 Investment Idea
        ↓
Compliance Review
        ↓
PM Review
        ↓
批准
        ↓
发布
```

或者一个 Proxy Voting 事项：

```text
收到会议资料
    ↓
创建投票事项
    ↓
获取 ISS / 内部研究
    ↓
分析议案
    ↓
生成 Vote Recommendation
    ↓
Compliance / Operations Review
    ↓
授权
    ↓
提交投票
    ↓
保存结果和证据
```

这些都已经不是：

> “用户和 Agent 聊了什么？”

而是：

> “企业现在正在处理什么业务事项？”

这就是 **Business Case**。

---

# 2. 先解决一个最重要的概念混淆

本文所说的：

> **Business Case**

不是财务管理里面的：

> “Business Case = 项目商业论证 / 投资回报分析”。

这里的 Business Case 指的是：

> **一个需要被企业处理、跟踪、协作、决策并最终达到某种业务结果的持久业务事项。**

它可以叫：

```text
Case
Business Case
Work Case
Business Matter
Service Case
Investigation Case
Review Case
```

不同企业可能使用不同名称。

核心不是名称，而是它具备：

```text
身份
生命周期
业务上下文
责任人
参与者
证据
任务
决策
状态
结果
历史
```

---

# 3. 为什么 Chat 不适合作为企业 Agent 的主业务对象

Chat 最大的问题并不是“聊天不够专业”。

真正的问题是：

> **Conversation ≠ Business State。**

例如：

```text
User:
    “帮我看看这个投资想法。”

Agent:
    “可以，我先研究一下……”

User:
    “好的。”

Agent:
    “我认为……”

```

这里几乎没有正式的业务状态。

我们真正需要知道的是：

```text
Investment Idea #INV-2026-00182

Status:
    Compliance Review

Owner:
    Analyst A

Current Reviewer:
    Compliance B

Evidence:
    17 documents

Agent Tasks:
    6 completed
    1 failed

Approval:
    Compliance approved
    PM pending

Command:
    publish.pending

SLA:
    due tomorrow

Audit:
    complete
```

这些信息很难靠：

```text
conversation history
```

可靠表达。

---

# 4. Chat 的正确位置

因此首先应该建立一个非常重要的层次：

```text
Business Case
     │
     ├── Conversations
     ├── Tasks
     ├── Reviews
     ├── Decisions
     ├── Evidence
     ├── Commands
     └── Workflow
```

而不是：

```text
Conversation
   ↓
所有东西都挂在 Chat 下面
```

因此：

> **Chat 是 Business Case 的一种 Interaction，不应该是 Business Case 本身。**

---

# 5. 企业 Agent 应该从“Conversation-centric”转向“Case-centric”

传统 Chatbot：

```text
Conversation
    ↓
LLM
    ↓
Answer
```

企业 Agent：

```text
Business Case
    ↓
Context
    ↓
Agent
    ↓
Work
    ↓
Decision
    ↓
Business Outcome
```

更完整一点：

```text
                       Business Case
                            │
       ┌────────────────────┼────────────────────┐
       │                    │                    │
   Business Data       Workflow             Participants
       │                    │                    │
       │                    ▼                    │
    Evidence            Tasks                  Roles
       │                    │                    │
       └──────────────┬─────┴─────────────┬──────┘
                      │                   │
                  Agent Work          Human Work
                      │                   │
                      └──────────┬────────┘
                                 │
                              Decision
                                 │
                              Command
                                 │
                          Business Outcome
```

---

# 6. 这其实不是 AI 新发明，而是 Case Management 的老问题

这也是为什么企业 Agent 的业务对象设计，不能只研究 LLM。

传统 Case Management 早就处理过类似问题。

OMG 的 **Case Management Model and Notation（CMMN）** 将 Case 定义为一种围绕“活的信息和关系”组织工作的模型，用于那些不完全按照预先固定的活动顺序执行、而需要知识工作者根据不断变化的信息进行处理的工作。CMMN 同时引入 Case File 等概念来保存案件上下文。

IBM 对 Case Management 的早期研究也强调：很多人类中心的业务活动，例如保险理赔、IT 问题解决，并不会严格按照预定义流程执行；实际工作包含非结构化活动、文档、通信、异常处理以及远程系统交互。Case Management 的核心因此不是把人塞进流水线，而是围绕 Case 组织信息、服务和人的工作。

这与今天 Agent 的问题非常接近。

可以把两者理解为：

```text
传统 Case Management
    = Human + Case + Information + Flexible Work

Agentic Case Management
    = Human + Agent + Case + Information + Flexible Work
```

所以：

> **Agent 并没有消灭 Case Management，反而让 Case Management 重新变得重要。**

---

# 7. 为什么 2026 年这个方向尤其明显

AWS 在 2026 年 7 月公开介绍 Amazon Quick Automate 的 Case Management 时，直接把 Case 定义为企业 Agent Workflow 中持久存在的 Work Item。

AWS 的描述非常直接：

* 每个 Work Item 被表示成一个 Case；
* Case 在整个生命周期中持续存在；
* Case 记录 Workflow 状态；
* 支持 HITL；
* 支持并行处理；
* 记录每次动作、决策和状态变化；
* 可以从创建一路跟踪到 Resolution。

AWS 甚至明确建议在设计 Agent Automation 时，第一步就是：

> **Identify what constitutes a case for your automation.**

也就是：

> 先定义“什么是一件业务工作”，再设计 Agent 怎么处理它。

这个顺序非常值得企业 Agent 平台采用。

---

# 8. Microsoft 的方向也类似：Chat 与 Case 是两层

Microsoft Dynamics 365 Customer Service 目前的 Agent 设计已经不是简单的“聊天机器人”。

Service Agent 可以：

* 理解 Case 与 Customer Context；
* 总结 Case、Conversation、Account、Contact、Timeline；
* 搜索可信知识；
* 更新 Case；
* 创建 Notes / Activities；
* 推荐 Next Best Action；
* 执行受支持的 Service Task。

更关键的是，Microsoft 允许 Agent Context 与已有 Case 关联，例如 Agent 创建 Case 后，可以把 Case Number 等上下文继续传给 Dynamics 365，使后续人工服务人员能够直接加载相关 Customer Summary。

这实际上已经是：

```text
Conversation
    ↓
Case
    ↓
Agent / Human Work
```

而不是：

```text
Conversation = Business Process
```

---

# 9. Microsoft 甚至开始把 Copilot 从 Chat UI 移向 Case Work Surface

2026 年 Dynamics 365 Customer Service 的设计进一步强调：

> Case-focused workspace

而不是把 Copilot 作为孤立聊天面板。

相关设计把：

```text
Case Lifecycle
Intent
Case History
Knowledge
Actions
SLA
```

组合成统一工作上下文；同时支持 AI 提议操作，再经过明确批准后执行。

这说明一个非常重要的趋势：

> **企业 Agent UI 的终点不是“更大的 Chat”，而是“围绕 Business Object 的 AI Work Surface”。**

---

# 10. ServiceNow 更明显地走向 Case-centric Agent

ServiceNow 2026 年 Customer Service Management 的 Agentic AI 已经直接把 Agent Workflow 嵌入 Case Record。

其 In-product Agentic AI 支持：

```text
Case Record
    ↓
Start Agentic Workflow
    ↓
AI Workflow Panel
    ↓
Progress
Findings
Required Input
History
Human Review
```

用户不需要离开 Case 页面进入另外一个 Chat 窗口。Workflow 的状态、AI Findings、Human Input 和历史执行都直接附着在 Case 上。

ServiceNow 的 CSM Agentic AI Collection 也明确支持以：

```text
Cases
Conversations
Detected Intents
```

作为 Agent Workflow 的触发来源。

甚至具体 Agent 已经是：

```text
Case Action Agent
Document Verification Agent
Triage Cases Agent
Case Wrap-up Agent
```

即：

> Agent 是处理 Case 的执行者，而不是 Case 本身。

---

# 11. Salesforce 也把 Case 作为一等业务对象

Salesforce 的 Case Object 长期就是 Service Cloud 的核心业务对象。

Salesforce 自己对 Case 的描述非常明确：

> Case 是 Service Cloud 的标准对象，每个 Case 代表一个 stakeholder 的问题、反馈或 issue。

Case Record 保存整个业务上下文，而不是仅仅保存一段对话。

Agentforce 的案例中，也可以看到这种设计：

```text
Get Case Record
      ↓
Agent processing
      ↓
Update Case Record
      ↓
Follow-up Record
```

即 Agent 调用的是：

```text
Business Record
```

而不是：

```text
Chat Transcript
```

---

# 12. 因此可以得到一个行业共识

几家大型平台的方向虽然产品名称不同，但共同结构越来越明显：

| 厂商         | AI 的中心对象                 | Agent 与业务对象关系                      |
| ---------- | ------------------------ | ---------------------------------- |
| Microsoft  | Case / Customer / Record | Agent 围绕 Case 工作                   |
| ServiceNow | Case / Record / Workflow | Agent Workflow 直接挂在 Record 上       |
| Salesforce | Case / Service Record    | Agent 读取和更新 Case                   |
| AWS        | Case / Work Item         | Case 成为 Agentic Automation 的持久工作单元 |

这并不意味着所有 Agent 都必须叫 Case。

但对于：

```text
long-running
multi-step
multi-person
stateful
auditable
business-oriented
```

的企业 Agent：

> **必须存在某种等价于 Case 的一等业务对象。**

---

# 13. Business Case 到底应该是什么

可以给出一个实用定义：

> **Business Case 是企业为了完成一个业务目标、解决一个业务问题或处理一个业务事项而建立的、具有独立身份和生命周期的协作对象。**

它至少应该拥有：

```text
Identity
Purpose
Subject
Status
Owner
Participants
Context
Evidence
Work
Decision
Commands
Workflow
Timeline
Outcome
```

因此一个 Business Case 不等于：

```text
Chat
Ticket
Workflow
Task
Approval
Agent Session
```

而是把这些东西关联起来的：

> **业务级容器。**

---

# 14. Business Case 不是“大号 Ticket”

这是设计中非常重要的一点。

传统 Ticket 通常强调：

```text
问题
负责人
优先级
状态
SLA
解决方案
```

Business Case 应该更丰富。

例如投资研究：

```text
Case
 ├── Investment Thesis
 ├── Research Tasks
 ├── Market Evidence
 ├── Internal Evidence
 ├── Analyst Decisions
 ├── Compliance Review
 ├── PM Review
 ├── Publication Command
 └── Final Outcome
```

所以：

> **Case 是业务上下文聚合，而不是简单的问题编号。**

---

# 15. Business Case 也不是 Workflow

这是另外一个容易混淆的地方。

```text
Case
    = what the business is handling

Workflow
    = how the process currently advances
```

例如：

```text
Case:
    Investment Idea #123
```

可以使用：

```text
Workflow v13:
    research
    →
    compliance
    →
    PM approval
    →
    publish
```

也可以未来改成：

```text
Workflow v14:
    research
    →
    risk
    →
    compliance
    →
    PM
```

Case 仍然是：

```text
Investment Idea #123
```

所以：

> **Case 的生命周期比某一个 Workflow 更长。**

---

# 16. Business Case 也不是 Agent

```text
Case:
    Investment Idea #123
```

可以被：

```text
Research Agent
Compliance Agent
Summary Agent
Human Analyst
PM
```

共同处理。

因此：

```text
Case
    ≠ Agent
```

更准确：

```text
Case
    ├── Human work
    ├── Agent work
    └── System work
```

---

# 17. Business Case 也不是 Session

这是 Agent 平台中特别容易发生的架构错误。

```text
Session
```

回答：

> 某个 Agent Runtime 当前正在进行哪段交互？

```text
Case
```

回答：

> 企业当前正在处理哪一件业务？

例如：

```text
Case INV-123
```

可以有：

```text
Session #1
    Analyst + Agent

Session #2
    Compliance + Agent

Session #3
    PM + Agent
```

甚至：

```text
Session #1
    Runtime A

Session #2
    Runtime B
```

Case 不应该因为 Session 结束而结束。

---

# 18. 一个很重要的关系模型

建议：

```text
Business Case
│
├── Interactions
│    ├── Chat
│    ├── Email
│    ├── Meeting
│    └── Call
│
├── Work Items
│    ├── Human Task
│    ├── Agent Task
│    └── System Task
│
├── Evidence
│    ├── Document
│    ├── Data Point
│    ├── External Source
│    └── Attachment
│
├── Decisions
│    ├── AI Recommendation
│    ├── Human Decision
│    └── Policy Decision
│
├── Commands
│    ├── Proposed
│    ├── Approved
│    └── Executed
│
├── Workflow
│
└── Outcome
```

这个模型比：

```text
Chat
 ├── messages
 ├── tools
 └── memory
```

更适合企业。

---

# 19. Chat 应该成为 Interaction Object

推荐定义：

```ts
interface CaseInteraction {
  interactionId: string;
  caseId: string;

  type:
    | "chat"
    | "email"
    | "call"
    | "meeting"
    | "system-event";

  actor: ActorRef;

  startedAt: string;
  endedAt?: string;

  transcriptRef?: string;
}
```

这样：

```text
Chat
```

成为：

```text
CaseInteraction
```

而不是系统根对象。

---

# 20. Agent Session 也应该是 Case 的子对象

例如：

```ts
interface AgentSession {
  sessionId: string;
  caseId: string;

  agentId: string;
  runtimeId: string;

  purpose: string;

  startedAt: string;
  endedAt?: string;

  status:
    | "active"
    | "waiting"
    | "completed"
    | "failed";
}
```

这样可以同时支持：

```text
Case
 ↓
multiple agents
 ↓
multiple sessions
```

---

# 21. Work Item 是 Case 中真正可执行的单位

Case 本身通常不是执行单位。

例如：

```text
Case: Proxy Vote #123

Work Items:

1. Collect Meeting Materials
2. Verify Record Date
3. Analyze Proposal 1
4. Analyze Proposal 2
5. Prepare Recommendation
6. Compliance Review
7. Operations Submission
```

因此：

```text
Case
    ↓
Work Items
```

而：

```text
Agent / Human
    ↓
executes Work Item
```

这与 AWS 当前 Case Creator / Case Processor 模型非常接近：Case 是持久 Work Item，而 Processor 执行具体工作。

---

# 22. Work Item 需要区分 Human / Agent / System

不要把所有 Task 都叫 Agent Task。

推荐：

```ts
type WorkItemExecutor =
  | {
      type: "human";
      assignee: string;
    }
  | {
      type: "agent";
      agentId: string;
    }
  | {
      type: "system";
      handler: string;
    };
```

因此：

```text
Human
Agent
Deterministic Service
```

都可以成为 Case 的 Worker。

---

# 23. 这会自然形成“多人 + Agent”协作模型

例如：

```text
Case #INV-123

        ┌───────────────┐
        │   Business    │
        │     Case      │
        └───────┬───────┘
                │
    ┌───────────┼────────────┐
    │           │            │
    ▼           ▼            ▼
 Analyst      Agent       Compliance
    │           │            │
    ▼           ▼            ▼
 Human Task   Agent Task   Review
```

这比：

```text
一个 Agent Chat
    ↓
不断 @mention 人
```

更加可治理。

---

# 24. Case 应该包含“责任”，而不是只有“参与者”

特别是在金融行业：

```text
Participant
    ≠
Owner
    ≠
Reviewer
    ≠
Approver
    ≠
Executor
```

所以 Case 应明确表达：

```text
Owner
Case Manager
Initiator
Reviewer
Approver
Executor
Observer
```

例如：

```text
Case:
    Owner = Analyst A
    Compliance Reviewer = B
    PM Approver = C
    Operations Executor = D
```

这使：

```text
SoD
Assignment
Accountability
```

都变成 Case 的显式状态。

---

# 25. Case 应该有 Subject，而不仅是 User

例如：

```text
Case
 ├── Customer
 ├── Account
 ├── Portfolio
 ├── Security
 ├── Order
 ├── Issuer
 └── Transaction
```

因为企业 Case 通常是在：

> **围绕某个业务主体处理问题。**

例如：

```text
Proxy Vote Case
    subject = Security ABC
    meeting = AGM-2026-09
    portfolio = Fund XYZ
```

---

# 26. Subject 与 Actor 必须分开

例如：

```text
Case:
    Client Complaint

Subject:
    Client A

Initiator:
    Client Service B

Owner:
    Operations C

Agent:
    Complaint Investigation Agent
```

这里：

```text
Client A
```

不是：

```text
Case Owner
```

这对客户服务、调查、合规、HR 等场景非常重要。

---

# 27. Case Context 是什么

Case Context 不应该简单等于：

```text
Conversation History
```

应该是：

```text
Case Context
├── Business Facts
├── Related Records
├── Evidence
├── Current State
├── Prior Decisions
├── Open Tasks
├── Permissions
├── Relevant Communications
└── Recent Runtime Context
```

因此：

```text
LLM Context
```

只是：

```text
Case Context
        ↓
Context Selection
        ↓
LLM Context
```

的一种投影。

---

# 28. Case Context 不等于把所有数据塞进 Prompt

正确架构：

```text
Case
 │
 ├── authoritative facts
 ├── evidence refs
 ├── task state
 ├── permissions
 └── related entities
           │
           ▼
     Context Resolver
           │
           ▼
      Agent Runtime
```

Agent 每次只拿：

```text
current task relevant context
```

而不是整个 Case 的全部信息。

这同时解决：

* Context Window；
* Data Entitlement；
* Privacy；
* Cost；
* Relevance。

---

# 29. Case 是 Context Boundary，但不是 Data Boundary

这是金融 Agent 特别重要的一点。

Case 可以定义：

```text
“当前业务相关哪些对象”
```

但不能单独定义：

```text
“Agent 是否有权访问这些对象”
```

所以：

```text
Case Context
```

还需要经过：

```text
Data Entitlement
```

最终形成：

```text
Effective Context
```

也就是说：

```text
Case
    ↓
Context candidates
    ↓
Authorization / Data Entitlement
    ↓
Agent Context
```

---

# 30. Case 应有 Timeline，但 Timeline 不是 Audit

Case Timeline 可以用于：

```text
human-friendly history
```

例如：

```text
09:01 Case created
09:03 Agent started research
09:15 Analyst added document
09:22 Compliance review requested
10:03 Compliance approved
```

但是：

```text
Regulatory Audit Evidence
```

仍应该独立保存。

因此：

```text
Case Timeline
    = operational history

Audit Evidence
    = authoritative evidence
```

---

# 31. Case 中应该保存“Business Decision”，而不是只保存消息

例如：

```text
Decision #D-123

Type:
    Compliance Review

Decision:
    Approved

Actor:
    Compliance Reviewer B

Basis:
    ...

Evidence:
    E-123
    E-124

Policy Version:
    compliance-policy@v8

Created:
    ...
```

这比：

```text
Chat message:
    “Looks good.”
```

有完全不同的业务意义。

---

# 32. AI Recommendation 与 Human Decision 必须分开

例如：

```text
AI Recommendation:
    APPROVE

Human Decision:
    REJECT
```

两者都可以挂在 Case：

```text
Case
 ├── AI Recommendation
 └── Human Decision
```

但不能把：

```text
AI recommendation
```

直接当作：

```text
business decision
```

这是金融 Agent 非常重要的对象边界。

---

# 33. Case 应保存 Decision Lineage

例如：

```text
Decision
   │
   ├── Evidence
   ├── Rule / Policy
   ├── AI Recommendation
   ├── Human Decision
   └── Command
```

于是：

```text
为什么批准？
```

可以回答：

```text
Because:
  Evidence E1/E2
  AI recommendation R4
  Compliance review D8
  Policy P6
  Human approver H3
```

而不是：

```text
因为 Agent 说可以。
```

---

# 34. Case 还应该有 “Open Work”

很多传统系统只显示：

```text
Status = In Progress
```

Agent-native Case 应该直接告诉用户：

```text
Open Work

[Agent] Verify market data
[Human] Compliance review
[Agent] Draft recommendation
[System] Awaiting external response
```

这比：

```text
Chat unread messages
```

更适合作为工作管理界面。

---

# 35. Case 的核心不是“状态”，而是“未完成的工作”

可以这样理解：

```text
Case State
    +
Open Work
    +
Evidence
    +
Decision
```

一起决定：

> 当前这个业务事项处于什么状态。

因此 Case 状态不应该只有：

```text
Open
Closed
```

而应该能表达：

```text
Open
Waiting
Blocked
Under Review
Pending Approval
Resolved
Closed
```

但具体状态应由业务 Case Type 定义，不应该平台统一强制。

---

# 36. Case Type 是非常重要的扩展点

推荐：

```text
CaseType
```

例如：

```text
InvestmentIdea
ProxyVote
TradeException
ComplianceReview
ClientOnboarding
RiskInvestigation
OperationalIncident
```

Case Type 定义：

```text
Required Data
Allowed Participants
Lifecycle
Workflow
Evidence
Risk Policy
Review Rules
Commands
SLA
```

因此：

```text
Case
    = instance

CaseType
    = business template
```

---

# 37. CaseType 与 Workflow 不应该一对一硬绑定

这是平台设计中值得提前留好的空间。

例如：

```text
InvestmentIdea
```

可以：

```text
Workflow v1
Workflow v2
Workflow v3
```

因为业务流程会发生变化。

因此：

```text
CaseType
    │
    ├── Workflow Version
    ├── Policy Version
    └── Capability Profile
```

在某个 Case 创建时绑定：

```text
workflowVersion
policyVersion
```

之后该 Case 按自己的版本继续。

---

# 38. 这解决一个非常实际的问题：Workflow 升级

例如：

```text
Investment Review v13
```

正在处理：

```text
Case #123
```

此时发布：

```text
Investment Review v14
```

不能让：

```text
Case #123
```

悄悄切到 v14。

Case 应然地持有：

```text
workflowVersion = v13
```

而新 Case：

```text
workflowVersion = v14
```

这正是 Case 作为持久业务对象带来的巨大价值。

---

# 39. Case 应支持 Reopen

Chat 一旦结束：

```text
Session closed
```

通常就是结束。

Case 则可能：

```text
Resolved
   ↓
Reopened
```

例如：

```text
Investment Idea
    ↓
Published
    ↓
New compliance concern
    ↓
Reopened
```

或者：

```text
Client issue
    ↓
Resolved
    ↓
Customer replies
    ↓
Reopened
```

因此：

> Case 生命周期不等于 Agent Session 生命周期。

---

# 40. Case 还需要关联多个 Workflow Execution

一个 Case 在生命周期内可能有：

```text
Workflow Execution #1
    Intake

Workflow Execution #2
    Research

Workflow Execution #3
    Compliance Review

Workflow Execution #4
    Reopen Investigation
```

所以：

```text
Case
  ├── Workflow Execution 1
  ├── Workflow Execution 2
  ├── Workflow Execution 3
  └── Workflow Execution 4
```

而不是：

```text
Case
    =
one workflow run
```

---

# 41. 同样，一个 Case 可以有多个 Agent Session

例如：

```text
Case #123

Agent Session A:
    Research Agent

Agent Session B:
    Compliance Agent

Agent Session C:
    Drafting Agent
```

甚至同一个 Agent：

```text
Research Agent
    Session #1
    Session #2
    Session #3
```

分别执行不同 Task。

---

# 42. 因此推荐一个完整的对象层级

```text
Case
│
├── CaseType
│
├── Subject
│
├── Parties
│
├── Participants
│
├── CaseData
│
├── Evidence
│
├── Interactions
│
├── WorkItems
│     ├── AgentTask
│     ├── HumanTask
│     └── SystemTask
│
├── Decisions
│
├── Approvals
│
├── Commands
│
├── WorkflowExecutions
│
├── AgentSessions
│
├── Timeline
│
└── Outcome
```

这是一个很值得作为企业 Agent 平台通用模型的结构。

---

# 43. Case 不应该承载所有业务数据

例如投资 Case 不应该变成：

```text
Case
    └── entire portfolio database
```

Case 更适合保存：

```text
business snapshot
references
derived facts
workflow state
evidence references
decisions
```

而原始业务事实仍然属于：

```text
Domain Systems
```

例如：

```text
Portfolio System
Security Master
Order Management
CRM
Risk System
```

因此：

> **Case 是业务上下文聚合，不是企业数据仓库。**

---

# 44. Case Data 应区分 Snapshot 与 Reference

例如：

```text
Case:
    securityId = ABC
    portfolioId = P123

Reference:
    Security Master → ABC
    Portfolio System → P123
```

同时 Case 可以保存：

```text
snapshot:
    securityNameAtReview
    ratingAtDecision
    riskScoreAtDecision
```

因为以后原始数据可能发生变化。

所以：

```text
Reference = current truth
Snapshot  = truth at decision time
```

两者不能混淆。

---

# 45. Evidence 是 Case 的核心对象

企业 Agent 的很多价值来自：

```text
documents
emails
research
database records
market data
contracts
policies
```

但这些数据应该进入：

```text
Evidence
```

而不是：

```text
Chat Message
```

例如：

```text
Evidence #E-123
Type:
    External Research

Source:
    Vendor API

RetrievedAt:
    ...

Version:
    ...

Hash:
    ...

UsedBy:
    Decision #D-456
```

---

# 46. 这样 Agent 的输出才可以成为 Case Artifact

例如：

```text
Agent
  ↓
Research Result
```

不要只存：

```text
assistant message
```

而应该形成：

```text
ResearchArtifact
```

例如：

```json
{
  "artifactId": "ART-123",
  "caseId": "CASE-456",
  "type": "research-result",
  "version": 2,
  "evidence": [
    "E-123",
    "E-127"
  ],
  "contentRef": "...",
  "createdBy": "research-agent",
  "createdAt": "..."
}
```

这样后面的：

```text
Compliance
PM
Audit
```

才能引用一个明确的业务对象。

---

# 47. Case 应允许“Artifact → Decision → Command”

完整链条：

```text
Evidence
   ↓
Agent Artifact
   ↓
Human / Policy Decision
   ↓
Command
   ↓
Business Outcome
```

例如：

```text
Market Data
   ↓
Investment Analysis
   ↓
Compliance Approval
   ↓
Publish Command
   ↓
Investment Idea Published
```

这是 Agent 应用从“聊天”走向“业务系统”的关键一步。

---

# 48. Case 的 UI 不应该只是 Chat + Sidebar

更适合的是：

```text
┌────────────────────────────────────────────┐
│ Case: Investment Idea #123                 │
│ Status: Compliance Review                  │
├────────────────────────────────────────────┤
│                                            │
│ Business Context                           │
│ ─────────────────────                      │
│ Security: ABC                              │
│ Portfolio: XYZ                             │
│ Owner: Analyst A                           │
│ SLA: Sep 20                                │
│                                            │
├────────────────────────────────────────────┤
│ Open Work                                  │
│                                            │
│ ✓ Research completed                       │
│ ✓ Data verification                        │
│ → Compliance Review                        │
│ ○ PM Approval                              │
│                                            │
├────────────────────────────────────────────┤
│ Evidence                                   │
│ 17 sources                                 │
│                                            │
├────────────────────────────────────────────┤
│ Decisions                                  │
│ Compliance: Approved                      │
│ PM: Pending                                │
│                                            │
├────────────────────────────────────────────┤
│ AI Work                                    │
│ Research Agent                              │
│ Compliance Agent                            │
│                                            │
├────────────────────────────────────────────┤
│ Conversation                               │
│ Chat / Email / Notes                       │
└────────────────────────────────────────────┘
```

这里：

> **Chat 只是 Case Work Surface 的一个区域。**

---

# 49. Chat 应该“跟随 Case”，而不是 Case 跟随 Chat

例如：

```text
User opens Case
    ↓
Chat automatically gets case context
```

而不是：

```text
User opens Chat
    ↓
Agent asks:
    “你说的是哪个 Case？”
```

Microsoft、ServiceNow 当前将 AI Workflow / Agent Context 直接嵌入 Case/Record 的方向，本质上就是这一设计。

---

# 50. Case Chat 的每条消息都可以携带 Case Context

例如：

```json
{
  "caseId": "CASE-123",
  "sessionId": "SESSION-456",
  "message": "帮我解释一下这两个风险点"
}
```

Runtime：

```text
Case Context Resolver
      ↓
authorized case context
      ↓
Agent Runtime
```

这样 Agent 不需要依赖用户重复说明上下文。

---

# 51. 但不能把 Case Context 整个注入 Prompt

应该建立：

```text
Case Context Resolver
```

根据：

```text
Case
+
Current Task
+
Actor
+
Capability
+
Data Entitlement
```

计算：

```text
Effective Agent Context
```

例如：

```text
Case:
    Investment Idea #123

Task:
    Compliance Review

Agent capability:
    compliance.read

Allowed data:
    research
    compliance
    policy

Forbidden:
    trading
```

然后 Agent 才得到：

```text
Current Context
```

---

# 52. Case 是协作单位，Session 是技术单位

这是整个设计最重要的几个定义之一：

```text
Business Case
    = collaboration unit

Workflow Execution
    = process instance

Work Item
    = work unit

Agent Session
    = runtime interaction

Conversation
    = communication interaction
```

这几个对象不能混为一谈。

---

# 53. Case 应支持多人、多 Agent、多个系统共同处理

例如：

```text
Case: Client Onboarding

        ┌── KYC Agent
        │
Case ───┼── Human Reviewer
        │
        ├── Compliance Agent
        │
        ├── Risk Service
        │
        └── Operations
```

Case 是共同的：

```text
Business Context
```

每个参与者只负责：

```text
自己的 Work
```

---

# 54. Case 与 Workflow 的关系可以概括为

```text
Case
    = State + Context + Responsibility + Evidence

Workflow
    = State Transition + Orchestration
```

因此：

```text
Case owns:
    business state

Workflow owns:
    process state

Runtime owns:
    execution state
```

例如：

```text
Case Status:
    Under Review

Workflow State:
    compliance-review

Runtime State:
    waiting for human input
```

三个状态可能同时存在。

---

# 55. 这也是为什么不能让 Workflow State 直接等于 Case Status

例如：

```text
Workflow:
    research.completed
```

并不必然意味着：

```text
Case:
    resolved
```

Case 可能还有：

```text
compliance
approval
publication
```

所以：

```text
Workflow State
    → contributes to Case State
```

而不是：

```text
Workflow State
    = Case State
```

---

# 56. Case Status 应该是业务语义

例如：

```text
Investment Idea
    DRAFT
    RESEARCHING
    UNDER_REVIEW
    APPROVED
    PUBLISHED
    REJECTED
    CLOSED
```

而：

```text
Workflow State
```

可能是：

```text
research.agent
compliance.review
pm.approval
publish.command
```

这是两个不同维度。

---

# 57. 一个 Case 可以同时有多个“状态维度”

例如：

```text
Case Status:
    UNDER_REVIEW

Workflow:
    compliance-review

Approval:
    PM_PENDING

SLA:
    AT_RISK

Risk:
    HIGH

Execution:
    WAITING_FOR_HUMAN
```

因此企业 Agent 平台不应该试图用一个：

```text
status
```

解决所有问题。

---

# 58. 推荐把 State 拆成四层

```text
Case Business State
Workflow State
Work Item State
Runtime State
```

例如：

```text
Case:
    UNDER_REVIEW

Workflow:
    compliance-review

Work Item:
    WAITING_FOR_REVIEW

Runtime:
    TERMINATED
```

Runtime 终止完全没有问题：

```text
Case
```

依然等待审批。

---

# 59. Case 应支持事件，而不是只保存当前值

例如：

```text
CaseEvent

CaseCreated
TaskAssigned
AgentStarted
EvidenceAdded
DecisionCreated
ReviewRequested
ApprovalGranted
CommandProposed
CommandExecuted
CaseReopened
CaseClosed
```

然后：

```text
Current State
```

可以由：

```text
authoritative state
+
event history
```

共同支持恢复与审计。

不一定要完整 Event Sourcing，但：

> **业务状态变更必须有明确事件/历史记录。**

---

# 60. Case Event 是业务事件，Agent Trace 是技术事件

例如：

```text
Agent Trace:
    tool.call.search
    model.response
    tool.call.database
```

Case Event：

```text
ResearchCompleted
ComplianceReviewRequested
ApprovalGranted
```

两个层级不同。

不能把：

```text
LangSmith trace
```

直接当作：

```text
Case history
```

---

# 61. Case 中可以保存 Agent Activity Summary

ServiceNow 2026 的设计已经有类似趋势：在 Case Record 中展示 AI Workflow 的进度、Findings、Inputs、历史执行等，而底层仍保留具体 Agent Execution Record。

因此可以：

```text
Case
   ↓
AI Activity
```

显示：

```text
Research Agent
Completed
6 tools
17 evidence
3 findings
```

但详细：

```text
execution trace
```

放到 Runtime Observability 系统。

---

# 62. Case 可以成为 Agent Orchestration 的入口

过去：

```text
User
   ↓
Agent
```

未来：

```text
Event
  ↓
Case
  ↓
Workflow
  ↓
Agent / Human / System
```

Event 可以是：

```text
Email received
Document uploaded
Market event
Order exception
Deadline approaching
User request
External API event
```

所以：

> Agent 不一定由 Chat 启动。

---

# 63. 这也是 Enterprise Agent 与 Chatbot 的根本区别

Chatbot：

```text
interaction-driven
```

Enterprise Agent：

```text
work-driven
```

也就是：

```text
Chatbot:
    User talks → Agent responds

Enterprise Agent:
    Business Work exists → Agent works on it
```

Chat 可以触发：

```text
Case Creation
```

但 Case 一旦创建：

```text
Email
Event
Schedule
Human
Agent
System
```

都可以继续推进 Case。

---

# 64. “Case-first, Chat-optional”

这是一个非常适合企业 Agent 平台的原则：

> **Chat-first 是一种交互模式；Case-first 才是一种业务架构。**

例如：

### Case 创建方式 1

```text
User Chat
```

### Case 创建方式 2

```text
Email
```

### Case 创建方式 3

```text
API Event
```

### Case 创建方式 4

```text
Scheduled Job
```

### Case 创建方式 5

```text
Agent detected issue
```

都可以得到：

```text
Case
```

---

# 65. 为什么这对金融业务尤其重要

金融企业大量工作天然就是：

```text
Case-like Work
```

例如：

### Investment Research Case

```text
Investment Idea
```

### Compliance Case

```text
Potential Breach
```

### Trade Exception Case

```text
Trade Break
```

### Proxy Voting Case

```text
Meeting / Resolution
```

### KYC Case

```text
Client Onboarding
```

### Risk Investigation Case

```text
Potential Risk Event
```

这些业务都不是：

```text
“一段聊天”
```

而是：

```text
一个需要被组织、处理、审核和关闭的事项。
```

---

# 66. 一个 Proxy Voting Case 示例

```text
Case ID:
    PV-2026-001823

Case Type:
    Proxy Vote

Subject:
    Security ABC
    Meeting AGM-2026-09

Status:
    UNDER_REVIEW

Owner:
    Operations A

Participants:
    Analyst B
    Compliance C
    PM D
```

下面：

```text
Evidence
├── Issuer Notice
├── ISS Analysis
├── Internal Research
└── Historical Voting Record
```

Work：

```text
✓ Collect materials
✓ Normalize proposals
→ Generate recommendation
→ Compliance review
→ PM approval
○ Submit vote
```

这就是一个完整 Business Case。

---

# 67. Agent 在这里是什么

例如：

```text
Research Agent
```

负责：

```text
Read materials
Compare proposal
Find conflicts
Draft recommendation
```

它不是：

```text
Proxy Vote Case
```

而是：

```text
Case Worker
```

同样：

```text
Compliance Agent
Operations Agent
```

都是：

```text
Case Workers
```

---

# 68. Case Worker 是一个非常有价值的企业抽象

可以统一：

```text
Human Worker
Agent Worker
System Worker
```

例如：

```text
Case #PV-123

Workers:

Research Agent
Compliance Reviewer
Operations User
Vote Submission Service
```

这比：

```text
Agent
Sub-Agent
Sub-Agent
Human
```

这种纯技术视角更接近业务。

---

# 69. Case 应保存“Work Assignment”

例如：

```ts
interface WorkAssignment {
  workItemId: string;
  caseId: string;

  role:
    | "owner"
    | "reviewer"
    | "approver"
    | "executor";

  executor:
    | "human"
    | "agent"
    | "system";

  assignee: string;

  assignedAt: string;
  completedAt?: string;
}
```

这样：

```text
谁负责什么工作？
```

成为明确的业务状态。

---

# 70. Assignment 与 Decision Authority 必须分开

例如：

```text
Agent:
    Research Worker

Human:
    Compliance Reviewer
```

Agent 可以：

```text
prepare
```

但没有：

```text
approval authority
```

因此：

```text
Case Participant
    ≠ Decision Authority
```

这是前面 Human-in-the-loop / Authorization 设计在业务对象层面的体现。

---

# 71. Case 可以保存 Recommendations，但不能把它们当 Authority

例如：

```text
Agent Recommendation:
    APPROVE

Policy:
    APPROVAL_REQUIRED

Human:
    APPROVED
```

Case 中三个对象都存在：

```text
Recommendation
Policy Decision
Human Decision
```

这让责任链非常清楚。

---

# 72. Business Case 应该是“责任聚合根”

从 Domain-Driven Design 的角度，可以把 Case 看成一个：

> **Business Aggregate Root**

Case 下面：

```text
Work
Evidence
Decision
Approval
Command
Interaction
```

都围绕：

```text
Case ID
```

关联。

但不要因此把所有对象塞进同一个数据库表。

“Aggregate Root”在这里强调的是：

> **业务语义上的统一边界。**

---

# 73. Case ID 应成为企业级 Correlation Key

例如：

```text
caseId
```

贯穿：

```text
UI
Workflow
Agent Session
Human Task
Command
Audit
Evidence
Notification
External Reference
```

例如：

```text
caseId = INV-123
```

对应：

```text
executionId = EXE-456
sessionId = SES-789
taskId = TASK-111
commandId = CMD-222
```

因此：

```text
Case
```

是业务层 correlation root。

---

# 74. Case ID 与 Execution ID 不能混用

这两个 ID 的生命周期不同：

```text
Case:
    days / weeks / months

Workflow Execution:
    seconds / days

Agent Session:
    minutes / hours
```

所以绝不能：

```text
caseId = executionId
```

或者：

```text
caseId = sessionId
```

---

# 75. Case 可以跨 Runtime

例如：

```text
Case #INV-123

Runtime A:
    Copilot

Runtime B:
    DeepAgents

Runtime C:
    Human
```

这正好与前面的：

```text
Control Plane / Runtime Plane
```

形成配套。

Case 不依赖某个 Agent Framework。

---

# 76. Case 应成为 Agent Runtime 的“稳定锚点”

Runtime：

```text
frequently changing
```

Case：

```text
stable business identity
```

因此：

```text
Agent Runtime
      ↓
Case ID
      ↓
persistent business context
```

这样模型、SDK、Prompt、Runtime 变化时：

```text
Business Case
```

不会跟着变化。

---

# 77. Agent Runtime 退出时，Case 不应该消失

例如：

```text
Agent session ends
```

Case 仍然：

```text
OPEN
```

例如：

```text
Research Agent completed
```

Case：

```text
WAITING_FOR_COMPLIANCE
```

这就是：

> **Agent Session 是 disposable；Business Case 是 durable。**

---

# 78. Case 甚至可以没有 Agent Session

例如：

```text
Case created by email
```

然后：

```text
Human handles it
```

也成立。

或者：

```text
Case created by batch import
```

然后：

```text
Workflow → deterministic services
```

也成立。

所以：

> **Business Case 是业务对象，Agent 是一种执行能力，而不是 Case 的必要组成。**

---

# 79. Case 也应该支持“Human-only”模式

例如：

```text
High-risk Regulatory Investigation
```

可以：

```text
Case
    ↓
Human
```

完全不调用 Agent。

或者：

```text
Case
    ↓
Agent prepares
    ↓
Human makes every decision
```

这让 Agent adoption 可以渐进式进行。

---

# 80. 反过来也可以 Agent-first

例如低风险：

```text
Case
    ↓
Agent
    ↓
Agent
    ↓
Auto close
```

但是即使全自动：

```text
Case
```

仍然存在。

这意味着：

> **自动化程度变化，不应该改变业务对象模型。**

---

# 81. 这是 Case-centric 架构最大的价值之一

同一个 Case 模型可以支持：

```text
Manual
        ↓
Copilot-assisted
        ↓
Supervised Agent
        ↓
Autonomous Agent
```

业务对象不变。

变化的是：

```text
Worker
```

和：

```text
Automation Level
```

---

# 82. 推荐增加 Automation Policy

例如：

```ts
type AutomationMode =
  | "manual"
  | "assisted"
  | "supervised"
  | "autonomous";
```

Case Type 可以定义默认模式：

```text
Proxy Voting:
    supervised

Information Request:
    autonomous

Regulatory Investigation:
    manual
```

甚至同一 Case 根据 Risk 动态调整：

```text
LOW
    autonomous

MEDIUM
    supervised

HIGH
    human-led
```

---

# 83. Case 是 Agent Risk 控制的天然边界

前面讨论 Agent Control Plane 时，重点是：

```text
Agent Identity
Capability
Policy
Workflow
Command
```

现在加上：

```text
Case
```

之后就可以把权限进一步限制为：

```text
Agent
    ↓
Capability
    ↓
Case
    ↓
Case Subject / Resources
```

例如：

```text
Research Agent
```

有：

```text
research.read
```

但是：

```text
Case #INV-123
```

只允许访问：

```text
portfolio = APAC
```

这样：

> **Case 可以成为业务级 Scope Boundary。**

---

# 84. 但是不能让 Case 自己授予权限

还是要强调：

```text
Case
    ≠ Authorization
```

Case 可以表达：

```text
“这个 Agent 正在处理 Case #123。”
```

但真正决定：

```text
“这个 Agent 能否读取 Case #123 的 Portfolio Data？”
```

仍然是：

```text
Policy + Data Entitlement
```

---

# 85. Case 与 Data Entitlement 的关系

可以形成：

```text
Case Scope
     +
User Entitlement
     +
Agent Capability
     +
Data Policy
     =
Effective Access
```

这样可以避免：

```text
“加入 Case 的人就能看 Case 所有数据”
```

这种危险设计。

---

# 86. Case 可以有“Case Visibility”

例如：

```text
Public-to-Team
Restricted
Highly-Restricted
```

同时：

```text
Field-Level Security
Document-Level Security
Data Entitlement
```

继续存在。

ServiceNow 的 Customer 360 Agentic Workflow 就明确强调：Agent 可以访问 Case、Customer、Orders、Documents 等上下文，但必须遵守 Role-Based Access Control，不应因为 Agent 获得上下文就绕过原有的数据限制。

---

# 87. Case 的一个重要字段：Current Attention

传统 Case：

```text
Status = Open
```

不够。

Agent-native Case 可以有：

```text
currentAttention
```

例如：

```text
WAITING_HUMAN
WAITING_AGENT
WAITING_EXTERNAL
BLOCKED
ACTION_REQUIRED
```

这样用户打开工作台时，可以马上看到：

```text
这个 Case 现在需要谁做什么？
```

---

# 88. Case Inbox 应该因此取代 Chat Inbox

传统：

```text
Unread Chats
```

Agent-native：

```text
My Open Cases
Cases Awaiting Me
Cases At Risk
Cases Blocked
Cases Where Agent Needs Input
Cases Ready for Approval
```

Microsoft Dynamics 2026 的 Customer Service 设计已经出现类似方向：通过 Copilot 帮助用户查看和优先排序最需要处理的 Cases，并把“下一步工作”直接呈现出来。

---

# 89. Agent 不应该是 UI 的中心，Work 应该是

可以形成：

```text
Bad:
    “Which Agent do you want to talk to?”

Better:
    “Which Case do you need to work on?”
```

然后：

```text
Case
    ↓
AI suggests relevant Agent
```

这符合企业用户的真实工作方式。

用户通常首先知道：

```text
我要处理这件事。
```

而不是：

```text
我要找 Agent-X。
```

---

# 90. Agent Selection 可以由 Case Type / Work Item 决定

例如：

```text
Case:
    Proxy Vote

Current Work:
    Verify Proposal

Platform:
    Research Agent
```

或者：

```text
Current Work:
    Compliance Review

Platform:
    Compliance Agent
```

所以：

> **Business Object 驱动 Agent Selection。**

而不是：

> User 先选择 Agent，再让 Agent 去找 Business Object。

---

# 91. 这也能解决 Agent 数量快速膨胀的问题

如果平台有：

```text
100 Agents
```

让用户选择：

```text
哪个 Agent？
```

会非常困难。

但如果：

```text
Case Type
+
Work Type
```

已经确定：

```text
Proxy Vote
+
Proposal Analysis
```

平台可以自动选择：

```text
Proposal Analysis Agent
```

Agent 选择就成为：

```text
Control Plane
```

的问题。

---

# 92. Agent Catalog 不应该成为用户的主要业务导航

Agent Catalog 适合：

```text
admin
developer
platform operator
```

不一定适合：

```text
business user
```

Business User 更适合看到：

```text
Cases
Tasks
Reviews
Decisions
```

这会让 Agent 从：

```text
product identity
```

变成：

```text
execution capability
```

---

# 93. 这会改变企业 Agent Product Design

传统：

```text
Homepage
 ├── Chat
 ├── Agents
 └── History
```

更企业化：

```text
Homepage
 ├── My Cases
 ├── Cases Needing Attention
 ├── Tasks
 ├── Reviews
 ├── Decisions
 └── Agent Activity
```

Chat 变成：

```text
Case → Open → Ask Agent
```

而不是：

```text
Chat → Start a topic
```

---

# 94. Business Case 与 Copilot 的关系

Copilot 最适合：

```text
inline intelligence
```

例如：

```text
Case Summary
Draft Email
Suggest Next Action
Explain Evidence
Analyze Document
Prepare Review
```

Case 提供：

```text
business context
```

Copilot 提供：

```text
intelligence
```

所以：

```text
Case + Copilot
```

比：

```text
Copilot alone
```

更适合企业业务。

---

# 95. Case 与 Agentic Workflow 的关系

AWS 2026 的 Case Management 设计给出了一个非常值得采用的模式：

```text
Case Creator
      ↓
Case
      ↓
Case Processor
      ↓
Agentic / Deterministic Workflow
```

多个 Case 可以并行处理。

Human Task 暂停某一个 Case 时：

```text
Case A → Waiting
Case B → Continue
Case C → Continue
```

这比：

```text
One giant Agent process
```

更容易扩展和恢复。

---

# 96. Case-centric 架构天然适合并发

例如：

```text
10,000 trade exceptions
```

不是：

```text
一个 Agent Session 处理 10,000 件事。
```

而是：

```text
10,000 Cases
```

然后：

```text
Runtime Pool
    ↓
parallel workers
```

因此：

```text
Case
```

也是：

> **Agent 工作的自然并发单元。**

---

# 97. Case 还有一个非常现实的价值：失败隔离

例如：

```text
Case #101
Case #102
Case #103
```

其中：

```text
Case #102
    → Agent failed
```

只影响：

```text
Case #102
```

而不是：

```text
whole batch
```

AWS 将每个 Case 作为可独立跟踪、处理、失败、恢复和人工介入的工作单位，也正是为了获得这种生产级隔离能力。

---

# 98. Case 也天然适合 SLA

例如：

```text
Case:
    SLA = 4 hours

Current:
    2h 18m

Risk:
    AT_RISK
```

Agent 可以：

```text
identify risk
```

Control Plane：

```text
escalate
```

Human：

```text
reassign
```

因此：

```text
SLA
```

应该属于 Case，而不是 Chat Session。

---

# 99. Case 可以支持 Escalation

例如：

```text
Agent cannot resolve
    ↓
Case escalation
    ↓
Senior Reviewer
```

而不是：

```text
Agent:
    “I cannot help.”
```

Escalation 是：

```text
Business State Transition
```

因此属于 Case / Workflow / Control Plane。

---

# 100. Case 可以支持 Reassignment

例如：

```text
Owner A
   ↓
Leave
   ↓
Owner B
```

不应该依赖：

```text
Agent session memory
```

因为：

```text
Case
```

是持久对象。

---

# 101. Case 也适合跨团队协作

例如：

```text
Investment Case

Investment
    ↓
Compliance
    ↓
Risk
    ↓
Operations
```

每个团队：

```text
自己的 Work Item
```

但共享：

```text
同一个 Case
```

这样就不需要：

```text
Email chain
Teams thread
Chat transcript
Excel tracker
```

作为主要状态存储。

---

# 102. 这正是 AWS 对 Case Management 特别强调的一点

AWS 在 2026 年的案例中明确指出，Case 内的通信可以替代碎片化 Email Thread，使：

```text
ownership
collaboration
status
history
```

集中在一个业务上下文中。

这也是为什么 Enterprise Agent 不应该只是：

```text
Chatbot + Tools
```

而应该：

```text
Case + Agent + Workflow + Human
```

---

# 103. Case Timeline 可以成为团队共享工作记忆

但注意：

```text
Timeline
```

不是：

```text
LLM Memory
```

Timeline：

```text
business shared memory
```

Agent Memory：

```text
runtime working memory
```

它们生命周期和可信度完全不同。

---

# 104. 一个建议的数据模型

可以从下面这个最小模型开始：

```ts
interface BusinessCase {
  caseId: string;

  caseType: string;
  caseTypeVersion: string;

  title: string;
  purpose?: string;

  status: string;

  subject: CaseSubject;

  owner: ActorRef;

  participants: CaseParticipant[];

  priority?: string;
  riskTier?: string;

  openedAt: string;
  dueAt?: string;
  closedAt?: string;

  workflow?: WorkflowRef;

  data: Record<string, unknown>;

  outcome?: CaseOutcome;
}
```

---

# 105. Related Objects

```ts
interface CaseRef {
  caseId: string;
}

interface WorkItem {
  workItemId: string;
  caseId: string;

  type: "agent" | "human" | "system";

  purpose: string;

  status:
    | "pending"
    | "running"
    | "waiting"
    | "completed"
    | "failed";

  assignee?: ActorRef;

  artifactRefs?: string[];
}
```

---

# 106. Evidence

```ts
interface CaseEvidence {
  evidenceId: string;
  caseId: string;

  type:
    | "document"
    | "record"
    | "api"
    | "research"
    | "communication";

  sourceRef: string;

  version?: string;
  retrievedAt?: string;

  hash?: string;

  metadata?: Record<string, unknown>;
}
```

---

# 107. Decision

```ts
interface CaseDecision {
  decisionId: string;
  caseId: string;

  type:
    | "recommendation"
    | "policy"
    | "human";

  decision: string;

  actor: ActorRef;

  evidenceRefs: string[];

  policyVersion?: string;

  createdAt: string;
}
```

---

# 108. Command

```ts
interface CaseCommandRef {
  commandId: string;
  caseId: string;

  type: string;

  status:
    | "proposed"
    | "approved"
    | "rejected"
    | "executed"
    | "failed"
    | "unknown";
}
```

注意：

```text
Command
```

不是 Case 本身的状态。

它是：

```text
Case → requested business mutation
```

---

# 109. Case 中的 Workflow Reference

推荐：

```ts
interface WorkflowRef {
  executionId: string;

  definitionId: string;
  version: string;

  currentNode?: string;

  status:
    | "running"
    | "waiting"
    | "completed"
    | "failed"
    | "cancelled";
}
```

Case 只需要知道：

```text
当前关联哪些 Workflow
```

而不应该把整个 Workflow Engine 数据结构嵌进去。

---

# 110. Case 数据应该区分四类字段

### 1. Business Facts

```text
customerId
securityId
portfolioId
meetingId
```

### 2. Derived Facts

```text
riskScore
classification
agentFinding
```

### 3. Control State

```text
currentOwner
approvalStatus
workflowState
```

### 4. Presentation

```text
summary
AI generated overview
next best action
```

四类数据不要混在一起。

---

# 111. 特别要避免一个“大 Summary Field”

很多 Agent 应用最后会变成：

```json
{
  "summary": "AI generated everything..."
}
```

这在 Demo 中很好用。

生产系统不行。

因为：

```text
Summary
```

无法代替：

```text
owner
status
decision
evidence
approval
command
```

正确：

```text
Structured Business State
     +
AI Summary
```

而不是：

```text
AI Summary
    = Business State
```

---

# 112. Case Summary 应该是 Derived View

例如：

```text
Case State
      ↓
Summary Generator
      ↓
Current Summary
```

这样：

```text
Summary
```

可以随时重新生成。

而：

```text
Business State
```

不会因为模型升级而改变。

---

# 113. Case 的“Next Best Action”也应该是 Recommendation

例如：

```text
Recommended Next Action:
    Request Compliance Review
```

不能等价：

```text
Workflow Next State:
    compliance-review
```

更不能等价：

```text
Command:
    publish
```

因此：

```text
Recommendation
    ≠
Workflow
    ≠
Command
```

---

# 114. Agent 可以帮助 Case Planning，但不能偷偷修改 Case Plan

这是 CMMN 和 Agent 结合后非常值得吸收的思想。

CMMN 本身就允许 Case Worker 根据不断变化的信息，在运行时选择某些可选工作；它强调的是围绕 Case 的信息和动态工作，而不是单一固定流程。

Agent 可以做类似事情：

```text
Case:
    unusual compliance issue

Agent:
    recommends additional investigation
```

然后：

```text
Control Plane / Human
    ↓
accept new Work Item
```

这比：

```text
Agent silently inserts workflow node
```

安全得多。

---

# 115. 这可以形成“Case + Deterministic Workflow + Dynamic Planning”

推荐：

```text
Case
 │
 ├── Deterministic mandatory work
 │
 └── Dynamic discretionary work
```

例如：

```text
Mandatory:
    Compliance
    Approval
    Publication

Optional:
    Additional research
    External verification
    Scenario analysis
```

Agent 可以提出：

```text
Optional Work
```

但不是直接改变：

```text
mandatory workflow
```

---

# 116. 这正是 Agent 时代 Case Management 最值得重新设计的地方

传统 Case Management：

```text
Human decides discretionary work
```

Agent-era Case Management：

```text
Human + Agent recommend discretionary work
        ↓
Policy / Control
        ↓
Case Plan updated
```

因此：

> Agent 提供的是“Case Planning Intelligence”，而不是直接拥有“Case Authority”。

---

# 117. Case-centric 架构还能解决 Agent Handoff

例如：

```text
Research Agent
    ↓
Case Artifact
    ↓
Compliance Agent
```

而不是：

```text
Research Agent
    ↓
巨大 Prompt
    ↓
Compliance Agent
```

新的 Agent 只需要读取：

```text
Case
    ├── relevant artifacts
    ├── evidence
    ├── decisions
    └── current task
```

这使 Agent Handoff 更可控。

---

# 118. Agent Handoff 应该基于 Case Artifact

例如：

```text
Research Agent
    ↓
Research Report v3

Compliance Agent
    ↓
reads Research Report v3
```

而不是：

```text
Agent A transcript
    ↓
Agent B prompt
```

这样：

* 可审计；
* 可版本化；
* 可重复读取；
* 可人工查看；
* 可替换 Agent。

---

# 119. Case Artifact 是 Multi-Agent 协作的共享语言

例如：

```text
Case
 ├── ResearchReport
 ├── RiskAssessment
 ├── ComplianceAssessment
 ├── VotingRecommendation
 └── ApprovalDecision
```

每个 Agent：

```text
produce artifact
consume artifact
```

而不是共享：

```text
unstructured memory
```

---

# 120. Multi-Agent 因此可以从“Agent-to-Agent Chat”变成“Case Collaboration”

这是一个很重要的架构变化：

错误：

```text
Agent A
   ↕
Agent B
   ↕
Agent C
```

更企业化：

```text
           Business Case
          /      |      \
         /       |       \
    Agent A   Agent B   Agent C
         \       |       /
          \      |      /
           Case Artifacts
```

Case 成为：

> **Multi-Agent Collaboration Context。**

---

# 121. 这样也更容易控制 Agent-to-Agent 权限

因为：

```text
Agent A
```

不需要直接授予：

```text
Agent B
```

权限。

它只需要：

```text
write Artifact
```

而：

```text
Agent B
```

拥有：

```text
read Artifact
```

Control Plane 根据：

```text
Case
+
Capability
+
Data Entitlement
```

决定谁可以看到什么。

---

# 122. Business Case 可以成为 Enterprise Graph 的节点

例如：

```text
Customer
   │
   ├── Case
   │     │
   │     ├── Order
   │     ├── Document
   │     ├── Task
   │     ├── Decision
   │     └── Agent Session
   │
   └── Account
```

因此：

> Case 是把分散企业数据和工作连接起来的业务节点。

这也是 ServiceNow 当前 Customer 360 + Case + Enterprise Graph 方向的重要特征：Agent 不只查询 Case 本身，而是在 Case 上连接客户、产品、订单、历史交互等关联数据。

---

# 123. Case-centric 设计会改变 RAG

传统：

```text
Question
   ↓
Global RAG
```

企业 Case：

```text
Case
   ↓
Case Scope
   ↓
Relevant Evidence
   ↓
Entitlement Filter
   ↓
Task-specific Retrieval
```

所以：

> **RAG Query 应该由 Case + Task 驱动，而不是只由 Chat Query 驱动。**

---

# 124. Case-centric RAG 更适合金融

例如：

```text
Case:
    Proxy Vote #123

Task:
    Analyze climate-resolution

Retrieval:
    issuer docs
    voting policy
    internal ESG research
    historical votes
```

而不是：

```text
用户：
    “帮我看看这个议案”
    
Global Search:
    millions of documents
```

Case 提供了：

```text
scope
subject
purpose
```

让 retrieval 更可控。

---

# 125. Memory 也应该 Case-aware

Agent Memory 不应该只有：

```text
User Memory
```

还可以有：

```text
Case Memory
```

例如：

```text
Case Memory:
    prior analyst findings
    rejected hypotheses
    previous questions
    unresolved issues
```

但注意：

```text
Case Memory
    ≠
Business Fact
```

仍然需要：

```text
Evidence / Domain Data
```

进行真实性验证。

---

# 126. Case Memory 最好分成三层

```text
Authoritative Facts
    ↑
Case Artifacts
    ↑
Agent Working Memory
```

可信度逐级降低。

例如：

```text
Domain Record
    = authoritative

Research Report
    = produced artifact

Agent Scratchpad
    = working memory
```

不要倒过来。

---

# 127. Case-centric Architecture 让“可恢复”变得简单

如果 Runtime 挂了：

```text
Case
    status = WAITING_REVIEW
```

然后：

```text
new Runtime
```

只需要：

```text
reload Case
reload open Work Item
reload relevant Artifacts
reload Workflow checkpoint
```

而不是恢复：

```text
entire conversation state
```

这与 AWS Case Management 对长期工作项、异常处理和 HITL 的设计非常一致。

---

# 128. Case 也应该支持人工接管

例如：

```text
Agent running
    ↓
Risk detected
    ↓
Case = NEEDS_HUMAN
    ↓
Human takes over
```

Human 不需要：

```text
“接管这个 Chat Session”
```

而是：

```text
Take Ownership of Case
```

这个业务语义明显更准确。

---

# 129. Case “Take Over” 可以是正式操作

例如：

```text
POST /cases/{id}/takeover
```

意味着：

```text
Agent work paused
Human becomes owner
```

而不是：

```text
User sends a message
```

这种隐式接管。

---

# 130. 同样可以有 “Return to Agent”

例如：

```text
Human investigates
    ↓
adds note
    ↓
assign back to agent
```

Case：

```text
Owner = Human
Execution = Agent
```

这比把：

```text
human message
```

作为状态控制更可靠。

---

# 131. Case 应支持明确的 Responsibility Transfer

例如：

```text
Research Agent
    ↓
Analyst
    ↓
Compliance
    ↓
PM
    ↓
Operations
```

这些都可以成为：

```text
Case Responsibility History
```

例如：

```text
09:00 Owner = Research Agent
10:30 Owner = Analyst A
13:00 Owner = Compliance B
15:00 Owner = PM C
```

这对金融业务尤其适合。

---

# 132. Case 关闭不能由 Chat Goodbye 触发

错误：

```text
User:
    “Thanks.”

Chat:
    closed

Case:
    ????
```

正确：

```text
Case Closure Criteria
```

例如：

```text
Required Work completed
AND
Required Decisions completed
AND
Required Commands completed
AND
No blocking exception
```

然后：

```text
Case → Closed
```

---

# 133. Case Closure 应该是 Domain / Policy 行为

Agent 可以：

```text
recommend close
```

但最终：

```text
Case Closure Policy
```

决定是否满足条件。

例如：

```text
Trade Exception
```

必须：

```text
reconciliation complete
+
exception reason recorded
+
approver confirmed
```

才允许关闭。

---

# 134. Case 还需要 Outcome

因为：

```text
status = Closed
```

不是结果。

例如：

```text
Outcome:
    Approved
    Rejected
    Resolved
    Withdrawn
    Duplicate
    Escalated
    No Action
```

因此：

```text
Case
 ├── Status
 └── Outcome
```

两者分开。

---

# 135. Case 的业务价值最终应该以 Outcome 衡量

不要只统计：

```text
Agent tokens
Agent turns
Chat messages
```

而应该统计：

```text
Cases created
Cases resolved
Time to resolution
Human intervention rate
Reopen rate
SLA breach
Decision quality
Exception rate
```

这才是企业 Agent 真正的业务指标。

---

# 136. Agent Metrics 仍然重要，但它们是次级指标

例如：

```text
Agent:
    avg 14 turns
    6 tool calls
    32k tokens
```

只能说明：

```text
Runtime behavior
```

而：

```text
Case:
    2 days faster
    92% straight-through
    4% reopen
```

才能说明：

```text
Business Impact
```

所以企业 Agent Evaluation 应该逐渐从：

```text
LLM Quality
```

向：

```text
Case Outcome Quality
```

扩展。

---

# 137. Case 是 Agent Evaluation 的真实单位

例如对：

```text
Proxy Vote Agent
```

不要只问：

```text
Did the answer look good?
```

而应问：

```text
Did the Case reach the correct outcome?

Were required evidence collected?

Were unauthorized data excluded?

Were approvals correct?

Was command executed correctly?

Can the Case be reconstructed?
```

这比单轮 Chat Evaluation 更接近生产。

---

# 138. Case 也是 Agent Cost Accounting 的自然单位

可以计算：

```text
Case #123
    Model Cost
    Tool Cost
    Human Cost
    External Vendor Cost
    Runtime Cost
```

最终得到：

```text
Cost per Case
```

比：

```text
Cost per Chat Session
```

更有业务意义。

---

# 139. Case 还能承载 SLA 与预算

例如：

```text
Case SLA:
    4h

Agent Budget:
    $2

Human Review Budget:
    20min

External Data Budget:
    $5
```

Control Plane 就可以：

```text
budget exceeded
    ↓
escalate
```

而不是让 Agent 无限循环。

---

# 140. 一个成熟的 Business Case 最终会成为什么

它不是：

```text
database record
```

也不是：

```text
chat container
```

而是：

> **企业业务工作的 durable coordination object。**

它连接：

```text
People
Agents
Data
Evidence
Tasks
Decisions
Workflow
Commands
Systems
```

---

# 141. 从企业架构角度，Case 是 Agent System 与 Business System 的桥

```text
                 BUSINESS WORLD
                      │
                      ▼
                ┌────────────┐
                │    Case    │
                └─────┬──────┘
                      │
         ┌────────────┼────────────┐
         ▼            ▼            ▼
      Human        Agent         Workflow
         │            │            │
         └────────────┼────────────┘
                      │
                      ▼
                 Control Plane
                      │
                      ▼
                Domain Systems
```

因此：

> **Case 是业务语义和 Agent 技术之间最重要的连接点之一。**

---

# 142. 对现有企业 Agent 平台，建议增加 Case Layer

如果当前平台是：

```text
User
 ↓
Session
 ↓
Agent Runtime
 ↓
Tool
```

建议升级为：

```text
User
 ↓
Business Case
 ↓
Work Item
 ↓
Control Plane
 ↓
Agent Runtime
 ↓
Tools / Domain
```

Session：

```text
Case
  ↓
Agent Session
```

作为技术实现。

---

# 143. 这样整个对象关系会非常清楚

```text
                    Business Case
                         │
       ┌─────────────────┼─────────────────┐
       │                 │                 │
       ▼                 ▼                 ▼
  Work Items         Evidence          Decisions
       │                                   │
 ┌─────┼─────┐                             │
 ▼     ▼     ▼                             ▼
Human Agent System                       Commands
       │
       ▼
 Agent Runtime
       │
       ▼
 Session
       │
       ▼
Conversation
```

注意这个树形结构：

```text
Business Case
    > Work Item
        > Agent Session
            > Conversation
```

而不是：

```text
Conversation
    > Agent
        > Business Case
```

---

# 144. 推荐的最小企业 Agent Case API

### 创建 Case

```http
POST /cases
```

### 获取 Case

```http
GET /cases/{caseId}
```

### 获取 Open Work

```http
GET /cases/{caseId}/work
```

### 创建 Agent Work

```http
POST /cases/{caseId}/work
```

### Start Agent

```http
POST /cases/{caseId}/work/{workItemId}/execute
```

### Submit Human Decision

```http
POST /cases/{caseId}/decisions
```

### Propose Command

```http
POST /cases/{caseId}/commands
```

### Case Timeline

```http
GET /cases/{caseId}/timeline
```

### Case Evidence

```http
GET /cases/{caseId}/evidence
```

这里：

```text
Session API
```

可以继续存在，但它不再是主要业务 API。

---

# 145. Case-first API 与 Chat-first API 的区别

### Chat-first

```http
POST /sessions
POST /sessions/{id}/messages
```

主要面向：

```text
conversation
```

### Case-first

```http
POST /cases
POST /cases/{id}/work
POST /cases/{id}/decisions
POST /cases/{id}/commands
```

主要面向：

```text
business work
```

Chat API 只是：

```http
POST /cases/{id}/sessions
```

的一种子能力。

---

# 146. 对前端也会产生重大影响

不推荐：

```text
ChatPage
```

成为整个应用中心。

更适合：

```text
CaseList
CaseWorkspace
WorkQueue
ReviewQueue
DecisionPanel
EvidencePanel
ActivityTimeline
AgentPanel
```

其中：

```text
AgentPanel
```

只是 Case Workspace 的一个组件。

---

# 147. Agent Panel 应该始终知道当前 Case

例如：

```text
CaseWorkspace
 ├── Case Header
 ├── Work Queue
 ├── Evidence
 ├── Timeline
 ├── Decisions
 └── Agent Panel
```

Agent Panel 自动收到：

```text
caseId
workItemId
```

因此用户不需要反复说：

```text
“针对刚才这个 Case……”
```

---

# 148. Case-centric 也不意味着取消 Chat

恰恰相反。

Chat 在这个模型里更有价值。

因为它变成：

```text
Case Context + Conversation
```

例如用户可以直接说：

```text
“为什么 Compliance 认为这个 Case 有问题？”
```

Agent 能回答：

```text
基于当前 Case 的三份 Evidence、
Compliance Decision #D-32
以及 Policy v8……
```

而不是从聊天记录猜。

---

# 149. Chat 是 Case 的自然语言控制面

可以把：

```text
Chat
```

看作：

> **Case 的 Natural Language Interface。**

而：

```text
Case API
Workflow
Policy
Command
```

才是：

> **Case 的 system of record / control interface。**

这是非常重要的分工。

---

# 150. 什么时候不需要 Business Case

不是所有 AI 应用都需要 Case。

例如：

```text
Translate this sentence
Summarize this document
Explain this concept
Rewrite this email
Generate code
```

通常：

```text
Chat / Request / Session
```

就够了。

不需要为了 Agent 而创建 Case。

---

# 151. 什么时候应该创建 Business Case

一个实用判断标准：

如果任务满足其中多个特征：

```text
1. 持续时间超过一次交互

2. 有明确业务主体

3. 有 Owner

4. 有多个参与者

5. 有多个 Work Item

6. 需要 Human Review / Approval

7. 有明确 Business State

8. 需要 Evidence

9. 需要 Audit

10. 可能被暂停、恢复、重开

11. 需要 SLA

12. 多个 Agent / System 会参与
```

就应该认真考虑：

> **Case-first。**

---

# 152. 一个非常实用的判断公式

可以简化成：

```text
Ephemeral Intelligence
    → Chat / Request

Persistent Business Work
    → Business Case
```

进一步：

```text
One-shot
    → Chat

Multi-step
    → Work Item

Long-running / accountable
    → Case
```

---

# 153. Case 的生命周期不需要一开始就复杂

第一版完全可以：

```text
OPEN
IN_PROGRESS
WAITING
RESOLVED
CLOSED
```

然后根据具体业务增加：

```text
UNDER_REVIEW
PENDING_APPROVAL
BLOCKED
REOPENED
CANCELLED
```

不要一开始设计几十种状态。

---

# 154. 同理，Case Type 也不要一开始过度抽象

第一阶段完全可以：

```text
CaseType
Workflow
Policy
```

建立简单绑定：

```text
InvestmentIdea
    → InvestmentWorkflow@v1
    → InvestmentPolicy@v1
```

等出现多个流程变体之后，再抽象：

```text
CaseType
    +
Workflow Profile
    +
Risk Profile
```

---

# 155. 最重要的是 Case 的业务语义，而不是字段数量

一个好的 Case 不在于有：

```text
100 fields
```

而在于能够回答：

```text
What are we handling?

Why are we handling it?

Who owns it?

Who can decide?

What has happened?

What evidence supports it?

What still needs to happen?

What can the Agent do?

What cannot the Agent do?

What was ultimately decided?

What business outcome happened?
```

---

# 156. Case 应该成为前面整套 Agent Architecture 的汇聚点

前面各层可以全部映射到 Case：

```text
                BUSINESS CASE
                      │
       ┌──────────────┼───────────────┐
       ▼              ▼               ▼
   Workflow         Policy         Identity
       │              │               │
       ▼              ▼               ▼
   Work Items     Decisions      Participants
       │
       ▼
    Agent Runtime
       │
       ▼
   Agent Sessions
       │
       ▼
    Artifacts
       │
       ▼
    Evidence
       │
       ▼
    Commands
       │
       ▼
 Business Outcome
```

所以：

> **Business Case 是整个 Agent Business Architecture 中最值得成为中心的一等对象。**

---

# 157. 最终推荐的企业 Agent 对象模型

可以归纳成：

```text
┌──────────────────────────────────────────┐
│              BUSINESS CASE              │
│                                          │
│  Identity                                │
│  Subject                                 │
│  Owner / Participants                    │
│  Business State                          │
│  SLA / Risk                              │
│  Context                                 │
│                                          │
│  ┌────────────┐ ┌────────────┐            │
│  │ Work Items │ │ Evidence   │            │
│  └────────────┘ └────────────┘            │
│                                          │
│  ┌────────────┐ ┌────────────┐            │
│  │ Decisions  │ │ Commands   │            │
│  └────────────┘ └────────────┘            │
│                                          │
│  ┌────────────┐ ┌────────────┐            │
│  │ Workflow   │ │ Timeline   │            │
│  └────────────┘ └────────────┘            │
│                                          │
│  ┌────────────────────────────────────┐   │
│  │ Interactions / Agent Sessions     │   │
│  └────────────────────────────────────┘   │
└──────────────────────────────────────────┘
```

---

# 158. 最终分层

整套企业 Agent 应用，可以形成：

```text
                    USER
                     │
                     ▼
              ┌─────────────┐
              │ Business UI │
              └──────┬──────┘
                     │
                     ▼
              ┌─────────────┐
              │ Business    │
              │ Case        │
              └──────┬──────┘
                     │
          ┌──────────┼───────────┐
          │          │           │
          ▼          ▼           ▼
       Workflow     Work       Evidence
          │          │
          │    ┌─────┼─────┐
          │    ▼     ▼     ▼
          │  Human  Agent System
          │           │
          │           ▼
          │     Agent Runtime
          │           │
          │        Session
          │           │
          │        Chat
          │
          ▼
       Control Plane
          │
          ▼
   Policy / Capability / Command
          │
          ▼
       Domain Systems
```

---

# 159. 最值得记住的五个关系

### 1. Chat ≠ Case

```text
Chat = Interaction
Case = Business Work
```

### 2. Session ≠ Execution

```text
Session = Runtime interaction
Execution = Process instance
```

### 3. Work Item ≠ Case

```text
Case = whole business matter
Work Item = one piece of work
```

### 4. Recommendation ≠ Decision

```text
Agent recommendation
    ≠
Human / Policy decision
```

### 5. Agent ≠ Case Worker Authority

```text
Agent = executor / assistant
Case = business responsibility container
```

---

# 160. 最重要的架构原则

可以浓缩成一句：

> **不要让 Conversation 成为企业 Agent 的 System of Record，让 Business Case 成为 System of Work。**

进一步：

```text
Conversation
    → communication

Agent Session
    → runtime interaction

Work Item
    → executable work

Workflow
    → process orchestration

Policy
    → authorization

Decision
    → business judgment

Command
    → controlled mutation

Business Case
    → durable business responsibility
```

---

# 161. 从 Chatbot 到 Agent Platform 的真正演进路径

不是：

```text
Chatbot
   ↓
More tools
   ↓
More autonomy
   ↓
Super Agent
```

而更应该是：

```text
Chatbot
   ↓
Context-aware Assistant
   ↓
Work Item Agent
   ↓
Case-aware Agent
   ↓
Multi-worker Case
   ↓
Agentic Business Process
```

其中真正发生的架构变化是：

```text
Conversation
        ↓
Task
        ↓
Case
        ↓
Business Outcome
```

而不是：

```text
small model
        ↓
large model
        ↓
reasoning model
```

---

# 162. 结论

企业 Agent 真正成熟的标志，不是：

```text
Agent 能不能和人聊很久。
```

也不是：

```text
Agent 能不能自己调用 50 个 Tool。
```

而是：

> **它能不能围绕一个明确的 Business Case，持续、可恢复、可审计地推进业务工作，并在 Human、Agent、Workflow、Policy 和 Domain System 之间保持清晰的责任边界。**

因此：

```text
Chat
```

适合作为：

```text
Natural Language Interaction
```

而：

```text
Business Case
```

应该成为：

```text
Business Work System of Record / System of Work
```

最终可以把整个企业 Agent Application 的核心关系概括为：

```text
                    Business Case
                         │
             ┌───────────┼───────────┐
             │           │           │
           Human       Agent       System
             │           │           │
             └───────────┼───────────┘
                         │
                    Work Items
                         │
                    Workflow
                         │
                     Policy
                         │
                    Decisions
                         │
                    Commands
                         │
                  Business Outcome
```

而 Chat：

```text
                  Business Case
                       │
                       ▼
                  ┌─────────┐
                  │  Chat   │
                  └─────────┘
```

只是其中一种交互方式。

**企业 Agent 的终点不是“一个更聪明的 Chatbot”，而是“一个以 Business Case 为核心、由 Human + Agent + Workflow + Policy 协同完成业务工作的系统”。**

---

## 参考资料

### 规范与研究

**OMG — Case Management Model and Notation (CMMN)**
CMMN 将 Case 作为处理复杂、动态、知识密集型工作的核心对象，并强调 Case File、动态活动以及知识工作者运行时决策；它与 BPMN 互补，而不是简单替代 BPMN。

**IBM Research — Advanced case management enabled by business provenance**
研究指出现实中的人本业务经常包含非结构化活动、文档、通信、异常和外部系统交互，因此 Case Management 更适合围绕知识工作者和业务信息组织工作。

### AWS

**AWS — Scaling agentic workflows with native case management in Amazon Quick Automate, July 2026**
AWS 将 Case 直接定义为持久化 Work Item，并强调 Case 生命周期、HITL、并行处理、状态追踪、异常、审计历史以及 Case Creator / Case Processor 架构。

### Microsoft

**Microsoft Dynamics 365 Customer Service — Service Agent**
Service Agent 围绕 Case、Customer、Timeline、Knowledge 和 Service Actions 工作，可以更新 Case、创建 Notes/Activities 并执行受支持的业务动作。

**Microsoft Dynamics 365 — Agent Context / Context Variables**
Microsoft 支持把当前用户、问题、最近活动、Case、Order 等业务上下文传给 Agent，并把 Agent 创建的 Case 信息继续传递到人工服务流程。

**Microsoft Dynamics 365 Customer Service — 2026 release**
2026 年的 Customer Service 方向进一步强调 Case-focused workspace、工作优先级、SLA、Case Lifecycle 和 Human-in-the-loop，而不是把 Copilot 作为孤立 Chat。

### ServiceNow

**ServiceNow — In-product trigger for agentic AI**
Agentic Workflow 可以直接从 Case Record 启动，并在 Case 中显示 Workflow Status、Findings、Required Input、History 和 Human Interaction。

**ServiceNow — CSM AI Agent Collection**
ServiceNow 的 Agentic Workflow 可以由 Case、Conversation 或 Intent 触发，并把 Agent 与 Flow Designer、Knowledge Graph、RAG、Record Operations 和 Guardrails 结合起来。

**ServiceNow — Case Action / Triage / Document Verification Agents**
多个专用 Agent 直接以 Case Record 为输入，对 Case 做分类、分析、文档验证、更新和 Wrap-up，体现“Case 是业务对象、Agent 是 Worker”的结构。

### Salesforce

**Salesforce — Case Object / Agentforce**
Salesforce 将 Case 作为 Service Cloud 的标准业务对象，用于保存问题、反馈或服务事项的完整上下文；Agentforce 可以读取和更新 Case Record，并把 Case 作为后续业务动作的上下文。

**Salesforce — Agentforce for Service**
Agentforce Service 的使用场景直接围绕 Case Record、Customer、Order、Delivery 等业务对象展开，Agent 的动作包括获取 Case、创建 Case、更新客户记录和执行相关业务操作。

---

**最值得把这篇与前几篇连起来理解的是：**

```text
Business Case
      │
      ├── Workflow        → When / Where
      ├── Policy          → Who / Whether
      ├── Work Item       → What work
      ├── Agent Runtime   → How
      ├── Human Review    → Accountability
      ├── Evidence        → Why / Based on what
      ├── Command         → Business mutation
      └── Domain          → What is actually true
```

这样一来，你前面设计的 **Control Plane / Runtime 分离**、**Human Task**、**Command / Approval**、**Audit Evidence** 和 **Workflow DSL** 都有了一个统一的业务锚点：**Business Case**。

# Maker-Checker 与 AI Agent：如何保持职责分离

## 一、AI Agent 出现以后，Maker-Checker 为什么反而更重要？

Maker-Checker 是金融系统里非常经典的一种内部控制模式：

> 一个人负责提出或准备一项操作，另一个具有不同职责的人独立检查并批准，前者不能自己把整个流程完成。

它背后的目的并不只是“多看一眼”。

真正要防止的是：

```text
同一个主体
  ↓
提出交易
  ↓
修改交易
  ↓
批准交易
  ↓
执行交易
  ↓
记录结果
```

这样一个主体拥有了完整的端到端控制权。

Basel Core Principles 将这类控制归入 checks and balances / four-eyes principle，并明确提到职责分离、交叉检查、资产双重控制和双签；同时要求关键职能之间进行适当分离，例如业务发起、付款、对账、风险管理、会计、审计和合规。

在传统系统里，Maker 和 Checker 通常对应两个不同的人或角色。

但 Agent 出现后，一个 Agent 可能同时：

```text
理解需求
  ↓
生成 Proposal
  ↓
选择数据
  ↓
选择 Tool
  ↓
计算参数
  ↓
调用 API
  ↓
修改业务状态
```

也就是说：

> **传统系统按“岗位”划分职责，Agent 系统却很容易让一个 Runtime 同时承担多个职责。**

这就是 Maker-Checker 在 Agent 时代首先遇到的问题。

---

# 二、先把三个容易混淆的概念分开

实际讨论中，经常把下面三个概念混成一个。

## 1. Segregation of Duties

Segregation of Duties（SoD）是更大的原则。

它关注的是：

> 哪些职责不能由同一个主体同时拥有？

例如：

```text
Initiate
Authorize
Execute
Record
Reconcile
```

其中某些组合可能需要分离。

Basel 对银行内部控制的要求正是从职责、授权、关键职能分离和独立控制函数的角度来定义的。

---

## 2. Maker-Checker

Maker-Checker 是 SoD 的一种具体实现方式：

```text
Maker
  ↓
Create / Prepare / Propose
  ↓
Checker
  ↓
Review / Approve
  ↓
Execute
```

它解决的是：

> 同一项敏感操作不能由同一个主体既创建又批准。

---

## 3. Dual Control / Four-eyes

Four-eyes principle 更强调：

> 对关键操作，需要独立的第二道控制。

Dual control 则更强调：

> 某项敏感资产或操作需要两个独立控制因素才能完成。

Basel 将 segregation of duties、cross-checking、dual control、double signatures 都列入 checks and balances / four-eyes principle，而不是把它们视为完全相同的机制。

因此：

```text
SoD
  ↓
更大的职责分离原则

Maker-Checker
  ↓
典型的事务级实现

Four-eyes / Dual Control
  ↓
更广泛的双重控制方式
```

这三个概念可以一起出现，但不应该当成同义词。

---

# 三、Agent 最大的问题：它很容易同时成为 Maker 和 Executor

传统系统可能是：

```text
Employee A
  ↓
Create Payment
  ↓
Employee B
  ↓
Approve
  ↓
Payment System
  ↓
Execute
```

而 Agent 系统很容易变成：

```text
Agent
  ↓
Create Payment
  ↓
Agent
  ↓
Approve
  ↓
Agent
  ↓
Execute
```

甚至更隐蔽：

```text
User
  ↓
Agent
  ↓
"确认符合规则"
  ↓
Tool
  ↓
Execute
```

这里表面上似乎存在：

```text
Agent
Policy
Tool
```

三个组件。

但如果 Agent 自己：

* 产生 Proposal
* 解释 Proposal
* 判断 Proposal 合法
* 决定可以执行
* 调用 Tool

那么职责其实仍然集中在一个主体。

因此：

> **组件数量不等于职责分离。**

---

# 四、两个 Agent 也不一定构成 Maker-Checker

这是 Agent 架构中特别容易出现的误区。

很多 Multi-Agent 设计会写成：

```text
Maker Agent
    ↓
Checker Agent
    ↓
Executor Agent
```

然后认为：

> 已经实现了职责分离。

并不一定。

真正需要检查的是：

```text
Identity
Authority
Permissions
Data
Policy
Objective
Failure Modes
Control Boundary
```

例如：

```text
Maker Agent
    ↓
GPT-X
    ↓
Checker Agent
    ↓
GPT-X
```

两个 Agent 可能：

* 使用同一个模型
* 使用同一个 Prompt
* 使用同一份 Context
* 使用同一份错误数据
* 使用同一套 Policy
* 运行在同一个 Runtime
* 拥有相同 Tool 权限
* 由同一个服务身份执行

那么：

```text
Agent A says "approve"
Agent B says "approve"
```

并不天然意味着出现了独立控制。

它只意味着：

> 同一个控制环境产生了两次判断。

真正的 SoD 需要的是：

> **控制目的、权限或权威边界存在实质分离。**

---

# 五、因此，Maker-Checker 的核心不是“两个人”

更准确的定义应该是：

> **Maker-Checker 的本质是把相互冲突的 authority 分配给不同的独立控制主体。**

所以“主体”不一定都是人。

可能是：

```text
Human
Agent
Policy Engine
Workflow
Domain Service
Control Function
```

但这里要特别注意：

> **“可以承担一个控制步骤”与“满足监管或业务所要求的独立人工判断”不是一回事。**

例如：

```text
Agent
  ↓
Proposal

Policy Engine
  ↓
Deterministic validation

Human
  ↓
Approval

Domain
  ↓
Execution
```

这实际上已经形成了多层职责分离。

但：

```text
Agent A
  ↓
Proposal

Agent B
  ↓
Approval

Agent C
  ↓
Execution
```

即使技术上可以运行，也不能自动声称：

> 已满足所有金融意义上的 Maker-Checker / Four-eyes 要求。

原因不是 AI “不算人”这么简单，而是：

> 第二道控制到底是不是独立、有效、具有所需 authority 的控制。

NIST AI RMF 也强调，需要明确区分人类与 AI 配置中的不同角色和责任，以及系统监督者与使用者之间的职责。

---

# 六、AI Agent 最合理的角色：Maker，而不是自己的 Checker

对于大多数金融 Agent，一种非常自然的设计是：

```text
Agent
    ↓
Maker
    ↓
Proposal
    ↓
Human / Independent Control
    ↓
Checker
    ↓
Command
    ↓
Domain
```

Agent 擅长：

```text
Research
Reasoning
Planning
Summarization
Option generation
Risk identification
Proposal generation
```

Checker 则负责：

```text
Verify
Challenge
Authorize
Reject
Escalate
```

这与当前金融行业对 Agent 的治理方向基本一致。

FINRA 2026 年关于 GenAI 和 Agent 的监管观察明确要求金融机构考虑监督和治理框架、正式 review/approval 流程、持续监控，以及在哪里建立 Human-in-the-loop；同时特别指出 Agent 存在 autonomy、scope and authority、auditability 等新的风险。

---

# 七、但不能把 Human Checker 简化成“批准按钮”

Maker-Checker 最危险的简化形式是：

```text
Agent
  ↓
Proposal
  ↓
[Approve]
  ↓
Execute
```

因为真正需要的是：

> Checker 对 Maker 的工作进行独立判断。

而不是：

> Checker 对 Maker 产生的按钮点击。

AWS 当前 Agentic AI Lens 明确指出，所有 Agent 动作都送人工审核会产生 reviewer fatigue 和 rubber-stamp approval；真正需要的是基于风险分级的人工监督，让人的注意力集中在真正需要判断的地方，并提供足够上下文。

因此 Checker 至少需要看到：

```text
What?
Why?
For whom?
Against which resource?
Using which evidence?
Under which policy?
With what parameters?
What will happen?
What risk exists?
What alternatives exist?
```

而不是：

```text
Approve?
Yes / No
```

---

# 八、Checker 必须能够“挑战” Maker

这是很多企业 Approval Workflow 没有真正做到的地方。

一个有效的 Checker 应该可以：

```text
Approve
Reject
Modify
Request Evidence
Request Clarification
Escalate
```

而不是：

```text
Approve
Reject
```

因为真正的职责分离意味着：

> Checker 不是 Maker 的“第二个确认按钮”。

Checker 应该有能力：

> **独立形成自己的判断。**

NIST AI RMF 对 human oversight 的要求同样强调，应定义和区分 AI 系统中的监督角色和责任，并建立可评估、可记录的人类监督流程。

---

# 九、Agent 作为 Maker 时，Proposal 必须成为明确的业务对象

这是 Agent 系统和传统表单系统一个非常重要的区别。

不要：

```text
Agent
  ↓
Natural Language
  ↓
Approval
```

应该：

```text
Agent
  ↓
Typed Proposal
  ↓
Human Review
  ↓
Command
```

例如：

```json
{
  "caseId": "INV-1024",
  "action": "SUBMIT_PROXY_VOTE",
  "securityId": "ABC",
  "meetingId": "M-2026-09",
  "vote": "FOR",
  "quantity": 125000,
  "target": "ISS"
}
```

这样 Checker 检查的是：

> 一个具体的 Proposed Action。

而不是：

> Agent 说“我认为应该这样做”。

---

# 十、Approval 之后，Maker 不能偷偷修改 Proposal

这是 Agent 时代 Maker-Checker 特别容易被忽略的一个问题。

错误模式：

```text
Agent
  ↓
Proposal A
  ↓
Human approves
  ↓
Agent changes parameters
  ↓
Execute Proposal B
```

例如：

```text
Approved:
Quantity = 100,000

Actually executed:
Quantity = 180,000
```

这在传统表单 Workflow 中可能比较容易控制，但 Agent 具有持续规划能力，如果没有明确的 immutable proposal / command binding，就可能出现：

> Approval Scope Creep。

正确模式：

```text
Maker
  ↓
Proposal
  ↓
Canonicalize
  ↓
Version / Hash / ID
  ↓
Checker Approval
  ↓
Re-validation
  ↓
Command bound to approved Proposal
  ↓
Execute
```

例如：

```text
Proposal ID = P-1024
Version = 3
Hash = ...
ApprovedBy = user-456
ApprovedAt = ...
```

执行时验证：

```text
Command.ProposalID == ApprovedProposal.ID

Command.Version == ApprovedProposal.Version

Command.Parameters == ApprovedProposal.Parameters
```

否则就：

```text
Reject Execution
```

---

# 十一、这也是为什么 Command 与 Proposal 必须分开

一个成熟的 Agent Architecture 应该有：

```text
Agent
  ↓
Intent
  ↓
Proposal
  ↓
Review / Authorization
  ↓
Command
  ↓
Domain
  ↓
Side Effect
```

而不是：

```text
Agent
  ↓
Tool Call
  ↓
Side Effect
```

其中：

### Intent

Agent 想做什么。

```text
"我要提交这个 Proxy Vote"
```

### Proposal

Agent 建议具体做什么。

```text
Vote = FOR
Quantity = 125,000
Target = ISS
```

### Authorization

系统判断是否允许。

```text
Policy
Entitlement
Role
Limit
Human Approval
```

### Command

经过控制之后可以执行的具体动作。

```text
SubmitProxyVoteCommand
```

这也是 Maker-Checker 与前面 Agent Authorization / Command 安全模型可以直接连接起来的地方。

---

# 十二、Maker-Checker 与 Authorization 是两层不同控制

这两个概念不能混为一谈。

例如：

```text
Agent
  ↓
Maker
  ↓
Proposal
```

然后：

```text
Human
  ↓
Checker
  ↓
Approve
```

也不意味着：

```text
Authorization = true
```

仍然需要：

```text
Policy
  ↓
Authorization
  ↓
Entitlement
  ↓
Domain Rule
```

原因很简单：

> Checker 有权批准，不代表这次具体操作已经满足所有系统授权条件。

AWS 当前明确建议把 Agent 身份与 Human 身份分离，并且 Agent 不应继承 Human 的权限；每个 Agent 应使用其任务所需的最小权限和独立身份。

因此：

```text
Human Approval
    ≠
Authorization
```

而更接近：

```text
Human Approval
    +
Policy
    +
Authorization
    +
Domain Validation
    ↓
Executable Command
```

---

# 十三、千万不要让 Agent 继承 Human 的完整权限

这是 Maker-Checker 在 Agent 环境里最重要的安全问题之一。

错误设计：

```text
Human User
    ↓
Login
    ↓
Agent
    ↓
Use User Token
    ↓
Everything User Can Do
```

这意味着：

> Maker 实际上变成了这个用户的完全代理。

然后再设计：

```text
Agent Maker
    ↓
Human Checker
```

看起来有两个主体。

但如果 Agent 可以直接使用这个 Human 的全部权限，那么 SoD 可能已经被绕过。

AWS 的 Agentic AI Lens 明确要求区分 Agent identity 与 Human identity，并要求 Agent 权限不能直接继承人类身份的全部权限。

正确模式应该更接近：

```text
Human Identity
       │
       ├───────────────┐
       │               │
       ▼               ▼
Human Role         Agent Identity
       │               │
       │          Limited Capability
       │               │
       └──── Policy ───┘
```

Agent 代表 Human 执行某些事情时，可以携带 Human Context，但不意味着 Agent 获得 Human 的全部 Credential。

---

# 十四、真正的 SoD 单位不是“人”，而是 Capability

这是把传统 SoD 映射到 Agent 后最重要的思想变化。

传统可能写：

```text
Bob = Maker
Alice = Checker
```

但 Agent Architecture 更应该写：

```text
Capability A:
Create Proposal

Capability B:
Approve Proposal

Capability C:
Execute Command

Capability D:
Change Approval Policy
```

然后定义冲突：

```text
Create Proposal
    conflicts with
Approve same Proposal
```

以及：

```text
Approve Proposal
    conflicts with
Execute outside approved scope
```

因此更好的权限模型是：

```text
Role
  ↓
Capability
  ↓
Resource
  ↓
Action
```

而不是：

```text
Role
  ↓
API List
```

---

# 十五、建立 Agent SoD Matrix

例如：

| Capability          | Maker Agent | Checker Human | Policy Engine | Executor |
| ------------------- | ----------: | ------------: | ------------: | -------: |
| Create Proposal     |           ✓ |               |               |          |
| Modify Draft        |           ✓ |             ✓ |               |          |
| Approve Proposal    |             |             ✓ |               |          |
| Evaluate Policy     |             |               |             ✓ |          |
| Authorize Execution |             |            ✓* |             ✓ |          |
| Issue Command       |             |               |               |        ✓ |
| Execute Side Effect |             |               |               |        ✓ |
| Change Policy       |             |               |            ✓* |          |
| Audit               |             |               |               |        ✓ |

`*` 表示具体组织中通常还需要进一步的职责分离。

重点不是这张表的固定答案。

重点是：

> **明确谁拥有哪种 Capability，以及哪些 Capability 不能由同一个主体同时持有。**

---

# 十六、Agent Checker 可以存在，但必须知道它检查的是什么

并不是说：

> AI 永远不能当 Checker。

恰恰相反，AI 很适合做大量自动验证。

例如：

```text
Maker Agent
   ↓
Trade Proposal
   ↓
Deterministic Policy
   ↓
Validation Agent
   ↓
Human
```

Validation Agent 可以检查：

```text
Missing data
Policy violations
Inconsistent rationale
Unsupported claims
Duplicate request
Out-of-range parameter
Conflict with previous state
```

这非常有价值。

但要明确：

> **AI Checker 适合做“自动化检查”，不天然等于“独立授权者”。**

尤其是需要真正独立判断、承担审批职责的场景。

---

# 十七、最合理的结构通常是“机器检查 + 人类职责分离”

例如高风险投资操作：

```text
                 Maker Agent
                     │
                     ▼
                 Proposal
                     │
            ┌────────▼────────┐
            │ Deterministic   │
            │ Policy Checks   │
            └────────┬────────┘
                     │
              Validation Agent
                     │
             ┌───────┴────────┐
             │                │
          Issues             Clean
             │                │
             ▼                ▼
          Reject           Human Checker
                              │
                         Approve / Reject
                              │
                        Re-validation
                              │
                           Command
                              │
                            Domain
                              │
                          Execution
```

这里 AI Checker 做的是：

> 找问题。

Human Checker 做的是：

> 承担需要人工判断的授权职责。

这样比：

```text
Maker Agent
    ↓
Checker Agent
    ↓
Executor Agent
```

更容易形成真正清楚的责任链。

---

# 十八、不要让 Checker 看到的是“Maker 的解释”，而忽略原始证据

Agent 的一个特殊风险是：

> Maker 可以生成一个非常有说服力的 explanation。

例如：

```text
Recommendation:
BUY

Reason:
Based on recent earnings,
valuation improvement,
strong momentum,
and portfolio diversification.
```

Checker 如果只看到这一段，很容易变成：

```text
Agent says X
Human approves X
```

而不是：

```text
Evidence
  ↓
Independent verification
  ↓
Decision
```

学术研究长期观察到 automation bias，即人可能过度依赖自动化建议、减少主动验证；2025 年关于 Human-AI collaboration 的系统综述也指出，AI literacy、专业经验、任务验证难度和 explanation complexity 都会影响人对 AI 建议的依赖。

因此 Checker UI 应优先提供：

```text
Original Evidence
Source
Current Business State
Relevant Policy
Key Parameters
Agent Proposal
Detected Risk
Known Exceptions
```

而不是把 Agent 的自然语言解释当成唯一证据。

---

# 十九、Maker-Checker 还需要“时间上的分离”

职责分离不只是：

```text
Actor A ≠ Actor B
```

还应该关注：

```text
Approval Time
Execution Time
State Version
Policy Version
```

例如：

```text
10:00 Agent creates Proposal

10:05 Human approves

11:30 Agent resumes

12:00 Execute
```

如果 11:30 期间：

```text
Position changed
Policy changed
Entitlement changed
Market state changed
Proposal changed
```

原先的 Checker Decision 未必仍然有效。

因此：

```text
Approval
    ↓
Re-validation
    ↓
Execution
```

是非常重要的一环。

AWS 当前文档也强调，持续信任授权如果被采用，应绑定到具体 Command、参数结构或资源范围，而不能形成无限范围的信任。

---

# 二十、Checker 必须不能修改 Maker 的历史事实

一个危险设计：

```text
Maker:
Proposal A

Checker:
发现错误

修改 Proposal A

Approve Proposal A
```

那么 Audit 最后可能只看到：

```text
Proposal A
Approved
```

却不知道：

```text
Original Proposal
Checker Modification
Final Proposal
```

更合理：

```text
Proposal V1
      ↓
Checker Feedback
      ↓
Proposal V2
      ↓
Checker Decision
      ↓
Command
```

保持版本链：

```text
V1 → V2 → V3
```

而不是：

```text
Proposal
  ↓
in-place mutation
```

这样才可以在事后回答：

> Maker 原来提出了什么？

> Checker 改了什么？

> 最终批准的到底是什么？

---

# 二十一、Maker-Checker 不是为了“让第二个人承担责任”

一个常见误解是：

> 有 Checker 之后，如果出事，就由 Checker 负责。

实际上职责分离恰恰不是这样。

Maker-Checker 的目的之一就是：

> 避免单一主体拥有完整控制权。

Basel 的治理原则强调，职责、授权、关键职能和独立控制应当明确；控制函数需要足够的专业能力与权威，而不能只是形式上的存在。

因此：

```text
Maker
    ≠
Checker
```

不代表：

```text
Maker 不负责
Checker 全负责
```

更合理的是：

```text
Maker → 对 Proposal 负责
Checker → 对独立 Review / Authorization 负责
Workflow → 对执行状态负责
Domain → 对业务状态负责
Organization → 对整体治理和风险负责
```

NIST AI RMF 同样强调，组织领导层需要对 AI 风险相关决策承担责任，且人类与 AI 的角色和监督职责需要明确区分。

---

# 二十二、因此需要区分“责任”与“权限”

这两个东西非常容易混淆。

例如：

```text
Agent
```

可以：

```text
执行
```

但不一定：

```text
拥有最终业务授权
```

一个 Human Checker 可以：

```text
批准
```

但也不意味着：

```text
绕过 Policy
绕过 Entitlement
绕过 Domain Rule
```

因此应该分别设计：

```text
Responsibility
Authority
Capability
Permission
Authorization
```

而不是用：

```text
Role = everything
```

---

# 二十三、在金融 Agent 中，建议把 SoD 拆成至少四层

一个比较实用的模型：

```text
                Business Decision
                       │
                       ▼
                  ┌─────────┐
                  │  Maker  │
                  │  Agent  │
                  └────┬────┘
                       │
                    Proposal
                       │
                       ▼
              ┌────────────────┐
              │ Automated      │
              │ Controls       │
              │                │
              │ Policy         │
              │ Validation     │
              │ Entitlement    │
              └───────┬────────┘
                      │
                      ▼
                 Human Checker
                      │
               Approve / Reject
                      │
                      ▼
               Command Service
                      │
                      ▼
                   Domain
                      │
                      ▼
                   Execute
                      │
                      ▼
                 Reconcile
                      │
                      ▼
                    Audit
```

这里实际上已经形成：

```text
Maker
Checker
Authorization
Execution
Reconciliation
Audit
```

多个不同控制点。

这比简单：

```text
Maker → Checker
```

更加接近金融生产系统。

---

# 二十四、尤其不要忽视 Reconciliation

Maker-Checker 通常关注：

```text
Approve before Execute
```

但金融系统还需要：

```text
Execute
  ↓
Actual Result
  ↓
Reconcile
```

因为即使：

```text
Maker 正确
Checker 正确
Command 正确
```

外部系统仍然可能：

```text
Timeout
Partial failure
Duplicate
Unexpected response
```

例如：

```text
Approved Quantity = 100,000

Command sent = 100,000

External System result = unknown
```

此时不能简单：

```text
Workflow = failed
```

然后重新发送。

可能已经执行成功。

因此：

> **Checker 解决的是“谁可以让操作发生”，Reconciliation 解决的是“实际上发生了什么”。**

---

# 二十五、Maker-Checker 不能替代 Idempotency

例如 Agent：

```text
Maker
 ↓
Proposal
 ↓
Checker approves
 ↓
Execute timeout
```

Agent retry：

```text
retry
 ↓
same Command
```

如果没有 Idempotency：

```text
100,000 shares
      ↓
执行一次

retry
      ↓
再执行一次
```

Maker-Checker 完全没有阻止这个问题。

所以完整控制链应该是：

```text
Maker
 ↓
Checker
 ↓
Authorization
 ↓
Idempotent Command
 ↓
Execution
 ↓
Reconciliation
```

---

# 二十六、Multi-Agent 不应该拿“角色扮演”冒充 SoD

以下模式看起来很好：

```text
Research Agent
        ↓
Risk Agent
        ↓
Compliance Agent
        ↓
Execution Agent
```

但必须继续问：

```text
谁可以调用 Execution Tool？

谁可以改变 Compliance Result？

谁可以重新运行 Risk Agent？

谁可以改变 Proposal？

谁可以修改 Policy？

谁拥有执行 Credential？

谁可以绕过前面的 Agent？
```

如果答案是：

> 一个 Orchestrator 拥有全部权限。

那么实际上：

```text
所有 Agent
     ↓
        Orchestrator
             ↓
       Full Authority
```

SoD 仍然可能集中在 Orchestrator。

因此：

> **职责分离必须落到 Permission / Capability / Enforcement Boundary，而不能只停留在 Agent 名称。**

---

# 二十七、Orchestrator 也不能成为“超级 Maker”

这是 Multi-Agent 架构中最容易被忽略的一层。

例如：

```text
User
 ↓
Orchestrator
 ├── Research Agent
 ├── Risk Agent
 ├── Compliance Agent
 └── Execution Agent
```

如果 Orchestrator 拥有：

```text
all tools
all credentials
all override rights
```

那么：

```text
Research / Risk / Compliance
```

虽然角色分开了，

但：

```text
Orchestrator
```

仍然掌握整个控制链。

更安全的思路：

```text
Orchestrator
    ↓
request capability
    ↓
Policy / Authorization
    ↓
specific tool
```

而不是：

```text
Orchestrator
    ↓
Everything
```

---

# 二十八、Approval Matrix 也应该扩展成 Agent SoD Matrix

传统企业：

```text
Role
  ↓
Approval Limit
```

Agent 系统最好变成：

```text
Actor
  ↓
Capability
  ↓
Action
  ↓
Resource
  ↓
Limit
  ↓
Approval Requirement
```

例如：

| Actor            | Capability      | Resource        | Limit           | Checker                      |
| ---------------- | --------------- | --------------- | --------------- | ---------------------------- |
| Research Agent   | Create Proposal | Investment Idea | Unlimited draft | None                         |
| Investment Agent | Submit Proposal | Portfolio       | ≤ threshold     | PM                           |
| Execution Agent  | Execute         | Trading System  | Bounded         | Policy + PM                  |
| Human PM         | Approve         | Proposal        | Role limit      | Separate control if required |
| Admin Agent      | Change Policy   | Policy Registry | None            | Independent control          |

这样才能回答：

> Agent 到底有没有自己批准自己的事情？

---

# 二十九、推荐使用“Conflict Matrix”

可以直接定义：

| Capability A        | Capability B                   | 是否冲突      |
| ------------------- | ------------------------------ | --------- |
| Create Proposal     | Approve same Proposal          | 是         |
| Approve Proposal    | Execute outside approved scope | 是         |
| Execute Transaction | Reconcile same Transaction     | 通常是       |
| Read Data           | Create Draft                   | 不一定       |
| Policy Evaluate     | Policy Modify                  | 视职责而定     |
| Execute             | Audit Log Write                | 通常需要隔离完整性 |
| Agent Runtime       | Change Authorization Policy    | 是         |

这样做比：

> “Agent 不应该负责审批。”

更加精确。

因为真正需要控制的是：

> **哪些 Capability 的组合会破坏控制目标？**

---

# 三十、应对小团队：SoD 不意味着一定要增加一个人

实际企业系统经常遇到：

```text
团队很小
```

无法让：

```text
A Maker
B Checker
C Executor
D Reconciler
```

全部由不同的人承担。

因此 SoD 设计应该考虑：

```text
Primary Separation
    ↓
无法实现？
    ↓
Compensating Control
```

例如：

```text
双重审批
事后独立复核
抽样检查
强制休假 / rotation
不可修改 Audit
权限定期复核
Threshold Limit
```

Basel 的原则本身也是强调需要适当的职责分离和独立控制，而不是一个简单的“所有事情必须由不同的人完成”的机械规则；具体控制需要结合风险和组织情况。

因此不要把：

> SoD

误解成：

> 每一个节点必须增加一个人工。

---

# 三十一、AI 反而可以帮助实现更强的 SoD

Agent 不只是 SoD 的风险来源，也可以成为控制能力。

例如：

```text
Policy Agent
```

负责：

```text
检查职责冲突
```

或者：

```text
SoD Monitoring Agent
```

实时发现：

```text
Agent A suddenly gained Execute + Approve
```

再例如：

```text
Audit Agent
```

检测：

```text
同一 Actor
→
Create
→
Approve
→
Execute
```

但是这里依然要保持一个原则：

> **AI 可以辅助检测职责冲突，但真正阻止违规操作的 Enforcement 必须在 Agent 之外。**

不能：

```text
SoD Agent
  ↓
"我判断没有冲突"
  ↓
Execute
```

应该：

```text
SoD Evaluation
   ↓
Policy Decision
   ↓
Enforcement Boundary
   ↓
Allow / Deny
```

AWS 当前明确建议在人类审批和风险分层之外，在 Gateway / Policy 边界实施授权和控制，而不是依赖文档或 Agent 自觉遵守。

---

# 三十二、Agent SoD 的核心其实是“不能自己扩大自己的权力”

可以把整件事情压缩成一个非常重要的原则：

> **Agent 可以提出更大的行动范围，但不能自己授予自己更大的 Authority。**

例如：

```text
Agent 当前权限：
READ portfolio

Agent Proposal：
"我需要 WRITE portfolio 才能完成任务"
```

可以：

```text
Request Capability Expansion
```

但不能：

```text
Agent
 ↓
Modify its own permissions
 ↓
Continue
```

正确：

```text
Agent
 ↓
Capability Request
 ↓
Policy
 ↓
Authorization
 ↓
Approved Scope
 ↓
Temporary Capability
```

这实际上把 Maker-Checker 与 Agent Authorization 连接起来：

```text
Request for Authority
        ↓
Independent Decision
        ↓
Authority Grant
```

---

# 三十三、对于高风险操作，推荐“4-stage separation”

金融 Agent 很适合采用：

```text
1. Propose
2. Validate
3. Authorize
4. Execute
```

对应：

```text
Agent
  ↓
PROPOSE
  ↓
Policy / Validation
  ↓
AUTHORIZE
  ↓
Command
  ↓
EXECUTE
```

如果需要人工：

```text
Agent
  ↓
PROPOSE
  ↓
Automated Validation
  ↓
Human CHECK
  ↓
Authorization
  ↓
Command
  ↓
EXECUTE
```

这比简单的：

```text
Agent → Approval → Tool
```

更清晰。

---

# 三十四、一个完整的 Proxy Voting 示例

假设业务是 Proxy Voting。

### 错误设计

```text
Voting Agent
  ↓
生成投票
  ↓
调用 ISS API
```

这里没有 Maker-Checker。

---

### 表面改善

```text
Voting Agent
  ↓
生成投票
  ↓
Human Approval
  ↓
ISS API
```

这是基本的 Maker-Checker。

但还不够。

---

### 更完整的设计

```text
                 Voting Agent
                      │
                   Maker
                      │
                      ▼
                 Vote Proposal
                      │
             ┌────────▼─────────┐
             │ Automated Checks │
             │                 │
             │ Entitlement     │
             │ Guideline       │
             │ Conflict        │
             │ Meeting State   │
             │ Parameter       │
             └────────┬─────────┘
                      │
                      ▼
                Human Checker
                      │
             ┌────────┼────────┐
             │        │        │
          Approve   Modify   Escalate
             │        │        │
             └────────┼────────┘
                      │
                 Re-validation
                      │
                      ▼
              Authorized Command
                      │
                      ▼
                ISS Adapter
                      │
                      ▼
                 Actual Vote
                      │
                      ▼
                Reconciliation
                      │
                      ▼
                    Audit
```

此时：

```text
Agent
    = Maker

Automated Control
    = Validation

Human
    = Checker / Business Decision

Policy
    = Authorization constraint

Command Service
    = Controlled execution

ISS Adapter
    = External execution

Reconciliation
    = Actual outcome verification

Audit
    = Evidence
```

职责边界非常清楚。

---

# 三十五、为什么“Agent Maker + Human Checker”通常比“Human Maker + Agent Checker”更自然

当然不是绝对规则。

但对于 Agent 化业务，通常更值得把 AI 放在：

```text
Proposal Generation
```

而不是：

```text
Final Authority
```

因为 Agent 擅长：

```text
寻找信息
综合材料
生成候选方案
发现异常
解释差异
准备 Proposal
```

人更适合承担：

```text
业务判断
例外处理
责任承担
最终授权
```

FINRA 2026 对 Agent 风险的观察也特别强调了 autonomy、scope/authority、auditability 等问题，并建议根据 Agent 的类型和范围建立相应的 supervision、HITL 和 guardrails。

但不要把这写成：

> Agent 永远只能当 Maker。

对于低风险场景，Agent 完全可以：

```text
自动检查
自动验证
自动筛选
自动拒绝明显违规
```

关键是：

> **它承担什么控制职责，以及该职责是否需要独立的人类权威。**

---

# 三十六、Maker-Checker 和 Human-in-the-loop 不是一回事

二者经常一起出现，但不应该混淆。

```text
HITL
```

回答：

> 人什么时候进入系统？

而：

```text
Maker-Checker
```

回答：

> 谁负责提出，谁负责独立检查 / 授权？

因此：

```text
HITL
    可以没有严格 Maker-Checker

Maker-Checker
    可以包含自动化 Checker

两者结合
    才形成更完整的 Agent Control
```

例如：

```text
Agent
 ↓
Proposal
 ↓
AI Validation
 ↓
Human Checker
```

这里同时有：

```text
AI Validation
+
Maker-Checker
+
HITL
```

---

# 三十七、Maker-Checker 与 Human-on-the-loop 也不是同一个东西

传统 Maker-Checker 更偏：

```text
具体事务
  ↓
第二道检查
```

Human-on-the-loop 更偏：

```text
Agent 自主运行
  ↓
Human Monitoring
  ↓
异常才介入
```

例如低风险 Agent：

```text
Agent
 ↓
执行 10,000 次低风险任务
 ↓
Monitoring
 ↓
异常才升级 Human
```

这并不意味着没有控制。

它意味着：

> 控制点从逐事务审批移动到了系统级监督。

AWS 当前的 risk-tiered oversight 就是在避免所有操作都走人工审批，同时通过自动化控制和人工升级处理高风险部分。

---

# 三十八、真正应该问的问题不是“Agent 是不是 Maker”

而是：

```text
谁提出？
谁修改？
谁检查？
谁授权？
谁执行？
谁记录？
谁可以改变 Policy？
谁可以改变权限？
谁可以停止？
谁负责最终结果？
```

如果这些问题都可以回答：

```text
Agent
Human
Policy
Workflow
Domain
Control Function
```

之间的边界通常就比较清楚。

---

# 三十九、建立 Agent SoD 的最小模型

一个企业 Agent 平台至少可以定义以下对象：

```text
Actor
Role
Capability
Resource
Action
Policy
Proposal
Approval
Command
Execution
Audit
```

然后建立：

```text
Actor
   ↓
Role
   ↓
Capability
   ↓
Action
   ↓
Resource
```

以及：

```text
Proposal
   ↓
Checker
   ↓
Approval
   ↓
Command
```

再定义：

```text
Conflict(Role, Capability)
Conflict(Actor, Action)
Conflict(Proposal, Approval)
Conflict(Approval, Execution)
```

这样 Maker-Checker 就从：

> UI Workflow

变成了：

> **Authorization + Capability + Workflow 的组合控制。**

---

# 四十、一个实用的 Agent SoD Review Checklist

设计任何金融 Agent Workflow 时，可以逐项问。

### Maker

```text
谁可以创建 Proposal？

谁可以修改 Proposal？

Agent 使用什么 Identity？

Agent 有哪些 Capability？
```

### Checker

```text
谁可以 Review？

Checker 与 Maker 是否真正独立？

Checker 是否拥有足够的信息？

Checker 是否拥有足够的 Authority？

Checker 能否 Reject / Modify / Escalate？
```

### Approval

```text
Approval 绑定的是哪个 Proposal？

是否绑定 Version / Hash / Scope？

Approval 是否有有效期？

Approval 后 Business State 是否重新验证？
```

### Execution

```text
谁真正 Execute？

Checker 是否拥有 Execute 权限？

Maker 是否可以绕过 Checker？

Agent 是否可以重新生成参数？

Command 是否 Idempotent？
```

### Policy

```text
谁可以修改 Policy？

Agent 能否修改自己的权限？

Agent 能否修改 Approval Requirement？

Orchestrator 是否拥有过大的权限？
```

### Audit

```text
谁做了 Maker？

谁做了 Checker？

Checker 看到了什么？

原始 Proposal 是什么？

最终执行的 Command 是什么？

中间修改了什么？

最终 Business State 是什么？
```

---

# 四十一、最重要的几个反模式

## Anti-pattern 1：Self-approval

```text
Agent
 ↓
Proposal
 ↓
Agent decides "approved"
 ↓
Execute
```

这是最明显的职责集中。

---

## Anti-pattern 2：Human Approval as Permission

```text
Human clicks Approve
 ↓
System bypasses Authorization
```

错误。

Approval 不能自动成为 Authorization。

---

## Anti-pattern 3：Two Agents = SoD

```text
Agent A
 ↓
Agent B
```

不代表存在真正独立控制。

---

## Anti-pattern 4：Same Human = Maker + Checker

```text
Alice creates
 ↓
Alice approves
```

这不是传统意义上的职责分离。

---

## Anti-pattern 5：Checker Can Modify Without Versioning

```text
Proposal
 ↓
Checker edits
 ↓
Approve
```

如果没有版本链，无法证明到底批准了什么。

---

## Anti-pattern 6：Approval Then Agent Replans

```text
Approved Proposal A
       ↓
Agent thinks again
       ↓
Executes Proposal B
```

这是典型 Approval Scope Creep。

---

## Anti-pattern 7：Orchestrator Has All Permissions

```text
Multi-Agent
     ↓
Orchestrator
     ↓
Full access
```

Agent 名称分开了，Authority 没分开。

---

## Anti-pattern 8：AI Checker Checks AI Maker Using Same Trust Boundary

```text
Maker Agent
      ↓
Checker Agent
```

如果两者共享：

```text
identity
credentials
policy
context
model failure mode
```

不应该轻易把它描述成强 SoD。

---

# 四十二、真正成熟的 Agent SoD

最终可以把 Maker-Checker 放进更大的 Control Plane：

```text
                         Control Plane
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
      Policy             Authorization          Human Task
        │                     │                     │
        └─────────────────────┼─────────────────────┘
                              │
                         Workflow
                              │
                         Proposal
                              │
                     ┌────────▼────────┐
                     │     Checker     │
                     │                 │
                     │ Human / Policy  │
                     └────────┬────────┘
                              │
                         Approved Scope
                              │
                           Command
                              │
                              ▼
                         Domain / Tool
                              │
                              ▼
                          Side Effect
                              │
                         Reconciliation
                              │
                            Audit

                    Agent Runtime
                         │
                 Reason / Plan / Propose
                         │
                         └──────► Proposal
```

这时候 Agent Runtime 的作用是：

```text
Reason
Plan
Research
Propose
```

而 Control Plane 负责：

```text
Policy
Authorization
Approval
Capability
Workflow
Command
Audit
```

Domain 负责：

```text
Business State
Business Invariants
```

这样才能实现：

> **Agent 可以自主提出事情，但不能自主把自己变成 Maker、Checker、Authorizer 和 Executor 的全部角色。**

---

# 四十三、一个更精确的核心原则

传统 Maker-Checker 可以概括为：

> One person makes, another checks.

进入 Agent 时代后，更精确的表述应该是：

> **No single actor should hold uncontrolled end-to-end authority over a sensitive business action.**

进一步：

> **Agent autonomy can span multiple reasoning steps, but authority over sensitive business effects must remain explicitly separated and externally enforced.**

因此：

```text
Agent Autonomy
        ≠
End-to-End Authority
```

而：

```text
Maker
  ≠
Checker
  ≠
Unbounded Executor
```

才是真正需要保护的边界。

---

# 四十四、结论：Maker-Checker 不是“两个名字”，而是 Authority Separation

AI Agent 时代，不应该把 Maker-Checker 简化为：

```text
Agent
  ↓
Human Approval Button
```

也不应该简单升级成：

```text
Agent A
  ↓
Agent B
  ↓
Agent C
```

真正应该关注的是：

```text
                    Who reasons?
                         │
                    Who proposes?
                         │
                    Who checks?
                         │
                   Who authorizes?
                         │
                    Who executes?
                         │
                  Who reconciles?
                         │
                    Who audits?
```

最终的控制目标不是：

> “一定要有两个人。”

也不是：

> “一定要有两个 Agent。”

而是：

> **任何高影响、高风险或不可逆的业务动作，都不能让一个没有外部约束的主体独自完成从 Proposal 到 Authorization 再到 Execution 的完整闭环。**

因此在金融 Agent Architecture 中，可以把 Maker-Checker 重新理解成：

```text
               Controlled Authority

        Agent
          │
       Propose
          │
          ▼
      Validation
          │
          ▼
       Checker
          │
       Approval
          │
          ▼
    Authorization
          │
          ▼
       Command
          │
          ▼
       Domain
          │
          ▼
      Execution
          │
          ▼
    Reconciliation
          │
          ▼
        Audit
```

这里最关键的已经不是：

```text
Maker ≠ Checker
```

而是：

```text
Proposal
   ≠
Authorization
   ≠
Execution
```

再进一步：

```text
Agent Autonomy
   ≠
Authorization Authority
```

这才是 Maker-Checker 进入 Agent 时代以后真正应该保留下来的控制思想。

---

## 参考资料

**Basel Committee on Banking Supervision — Core Principles for Effective Banking Supervision**
Basel Core Principles 将职责定义、关键职能分离以及 checks and balances / four-eyes principle 作为银行内部控制的重要组成部分，并明确涉及 segregation of duties、cross-checking、dual control 和 double signatures。

**Basel Committee — Corporate Governance Principles for Banks / Consolidated Guidelines**
强调不得把相互冲突的职责分配给同一人员，并要求识别、降低利益冲突以及实施独立监督。

**AWS Well-Architected Agentic AI Lens — Human-in-the-loop for Critical Decisions**
强调 risk-tiered approval，避免所有 Agent 行为统一进入人工审批导致 reviewer fatigue 和 rubber-stamp approval；同时要求足够上下文、明确的 escalation 和可审计的审批记录。

**AWS Well-Architected Agentic AI Lens — Tiered Human Oversight and Approval Workflows**
建议根据风险将 Agent 行为分为 autonomous、notify、approve 等等级，并在 Gateway / Policy 边界执行这些控制。

**AWS — Separate Agent and Human User Permissions**
明确区分 Agent Identity 与 Human Identity，并指出 Agent 不应直接继承 Human 的完整权限。

**Microsoft Agent Framework — Human-in-the-loop**
采用 Workflow request/response、pause/resume、tool approval 等机制，将人工干预作为 Workflow 的显式控制点，而不是隐藏在 Agent Prompt 中。

**Microsoft Agent Framework — Workflows**
Microsoft 将 Workflows、Agents、HITL、Checkpoint/Resume 等作为不同能力组合，并强调根据实际需求选择适当的编排模式。

**FINRA — GenAI: Continuing and Emerging Trends, 2026**
FINRA 2026 年观察指出，金融机构需要针对 Agent 的 autonomy、scope and authority、auditability 等新风险建立 supervision、HITL、tracking 和 guardrails，并继续落实正式 review/approval 和 governance processes。

**NIST AI Risk Management Framework**
NIST 强调组织需要定义并区分 human-AI configurations 中的角色和责任，并建立经过定义、评估和记录的人类监督流程。

**Automation Bias 研究**
系统综述表明，人可能过度依赖自动化建议，并受到信任、经验、任务复杂度和验证难度等因素影响；2025 年针对 Human-AI collaboration 的系统综述进一步讨论了 AI literacy、专业经验和 explanation complexity 等因素。

**BIS, 2026 — Supervising banks in an AI-shaped economy**
2026 年 9 月 BIS 的讨论指出，金融机构需要继续强化 governance、accountability、transparency 和 human oversight，同时认识到 Agentic AI 对传统模型治理和独立 review 带来的新挑战。

**BIS, 2026 — Regulation and supervision of the financial sector in the age of AI**
BIS 指出，金融机构必须承担 AI 风险责任，应通过 guardrails 管理 Agent 的风险行为，而不能把风险所有权转移给 AI 工具本身。

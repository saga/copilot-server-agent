# 多人协作 Workflow 中的 Ownership、Membership、Observer 设计

## 一、问题：为什么多人 Workflow 很容易把“谁负责、谁参与、谁能看”混在一起？

一个企业 Workflow 通常不是：

```text
一个人
  ↓
一个 Task
  ↓
一个结果
```

而更接近：

```text
Business Case
      │
      ├── Owner
      ├── Team Members
      ├── Current Assignee
      ├── Reviewers
      ├── Approvers
      ├── Delegates
      └── Observers
```

当 AI Agent 加入以后，参与者还会进一步增加：

```text
Human
Agent
Service
Group
System
```

于是非常容易出现这样的建模：

```text
owner
members
users
participants
assignee
watchers
observers
approvers
```

全部放到一个 `participants` 数组里。

然后业务逻辑到处写：

```text
if user in participants:
    allow()
```

这是一个非常危险的设计。

因为：

> **Ownership、Membership、Assignment、Observation 和 Authorization 解决的是不同问题。**

当前企业产品其实已经长期存在这种分离。

Salesforce 的 Case Team 明确区分 Case Owner 与 Case Team Member，而且 Team Member 可以拥有不同的 Case Access；ServiceNow 同时存在 Task Owner、Assignment Group 和 Watch List；Camunda 则把 task assignee、candidate users、candidate groups 和 task-level authorization 分开；Microsoft Teams 又把 Team Owner 与普通 Team Member 作为不同角色。([Salesforce][1])

因此，多人 Agent Workflow 不应该重新创造一个：

> `participants = 所有参与者`

而应该建立清晰的：

> **Responsibility Model + Participation Model + Visibility Model + Authorization Model**

---

# 二、先给结论

推荐把多人 Workflow 中的参与关系拆成至少六种概念：

```text
Ownership
Membership
Assignment
Delegation
Observation
Authorization
```

它们分别回答：

| 概念            | 回答的问题                     |
| ------------- | ------------------------- |
| Ownership     | 谁对这个对象或 Case 的整体负责？       |
| Membership    | 谁属于这个 Case / Team 的长期参与者？ |
| Assignment    | 当前这一步由谁处理？                |
| Delegation    | 原本的责任暂时由谁代行？              |
| Observation   | 谁需要了解进展？                  |
| Authorization | 当前这个人/Agent 实际可以做什么？      |

最重要的是：

```text
Owner
    ≠
Assignee
    ≠
Member
    ≠
Observer
    ≠
Approver
    ≠
Authorized Actor
```

这几个概念可以由同一个人同时拥有，但**不能因为一个关系成立，就自动推导其他关系成立。**

---

# 三、Ownership：谁对这个 Business Case 负责？

Ownership 最容易被误解成：

> “谁最后编辑这个记录？”

实际上不是。

更合理的定义是：

> **Owner 是对 Business Object / Case 的持续性业务责任主体。**

例如：

```text
Investment Case
    Owner = Portfolio Manager
```

意味着这个人或组织负责：

```text
推动 Case
处理最终业务责任
决定关键升级路径
确保 Case 不会无人负责
```

而不是意味着：

```text
Owner
= 当前执行所有 Task 的人
```

---

# 四、Ownership 不等于 Assignment

ServiceNow 当前的任务模型就是一个很好的现实例子。

它同时区分：

```text
Assignment Group
Task Owner
Watch List
```

在某些 Case Task 中：

* Assignment Group 是负责工作的组；
* Task Owner 是具体拥有该 Task 的人；
* Watch List 是需要了解 Case 的人。([ServiceNow][2])

这说明：

```text
who owns
```

与：

```text
who works
```

本身就可以不同。

例如：

```text
Case Owner = Portfolio Manager

Current Task Assignee = Analyst
```

完全合理。

---

# 五、Business Owner、Workflow Owner、Task Owner 必须分开

企业 Agent 平台特别容易出现：

```text
owner
```

一个字段打天下。

实际上至少应该考虑：

```text
Business Object Owner
Workflow Instance Owner
Task Owner
```

例如：

```text
Investment Idea
    Business Owner = Portfolio Manager
```

而：

```text
Workflow Instance
    Workflow Owner = Investment Operations
```

而：

```text
Current Task
    Task Owner = Analyst
```

这三个责任边界可能完全不同。

因此：

> **Owner 是一个带作用域的概念，不是一个通用 UserId。**

---

# 六、Workflow Owner 更像“流程责任”，不是 Business Authority

例如：

```text
Investment Review Workflow
    Owner = Investment Operations
```

这通常意味着：

```text
负责流程定义
负责流程运行
负责 SLA
负责异常处理
负责运营
```

并不意味着：

```text
Investment Operations
    可以批准 Investment Idea
```

因此：

```text
Workflow Owner
    ≠
Business Approver
```

这与前面讨论的 Control Plane / Runtime 分离是一致的。

---

# 七、Ownership 也不应该自动获得全部权限

这是更重要的一条。

错误设计：

```text
owner = Bob
```

然后：

```text
Bob can:
READ
EDIT
APPROVE
DELETE
TRANSFER
EXECUTE
```

这实际上把：

```text
Ownership
```

当成了：

```text
Authorization
```

不够严谨。

Salesforce 的 Case sharing 就明确显示出这种分离：Case Owner 有默认访问能力，但其他用户的访问可以由 Case Team、角色层级、Sharing Rules 等多个机制共同决定；团队成员也可以被授予不同的访问级别。([Salesforce][3])

所以更准确的模型是：

```text
Owner
   ↓
Accountability

Authorization
   ↓
Actual permission
```

---

# 八、Membership：谁是这个 Case / Team 的长期参与者？

Membership 与 Ownership 不同。

例如：

```text
Investment Case
```

可能有：

```text
Owner:
Portfolio Manager

Members:
Analyst
Risk Specialist
Compliance Officer
Operations Specialist
```

Membership 表示：

> 这个人属于 Case 的协作关系。

它不一定意味着：

```text
可以审批
可以修改
可以执行
```

Salesforce 的 Case Team 正是这种模型：Case Team 成员具有不同角色，而且每个角色可以定义不同的 Case Access，例如 Read/Write、Read Only 等。([Salesforce][1])

---

# 九、Membership 不是一个 Permission

这是多人 Workflow 建模最重要的原则之一：

> **Membership 表示“属于协作关系”，Permission 表示“能够做什么”。**

例如：

```text
Compliance Team Member
```

并不自动意味着：

```text
APPROVE_EXCEPTION
```

更准确的是：

```text
Membership
    +
Role
    +
Capability
    +
Policy
    ↓
Authorization
```

所以不要：

```text
if user ∈ case.members:
    allow all
```

---

# 十、Membership 应该表达 Role，而不是只有 User ID

不推荐：

```json
{
  "members": [
    "alice",
    "bob",
    "carol"
  ]
}
```

更好的：

```json
{
  "members": [
    {
      "principal": "alice",
      "role": "ANALYST"
    },
    {
      "principal": "bob",
      "role": "PORTFOLIO_MANAGER"
    },
    {
      "principal": "carol",
      "role": "COMPLIANCE_REVIEWER"
    }
  ]
}
```

因为以后一定会问：

> Bob 作为 Member，到底能做什么？

如果没有 Role / Membership Type，就只能把业务逻辑散落在代码里。

---

# 十一、Membership 最好有 Scope

例如：

```text
Case Member
```

和：

```text
Task Member
```

不是一个概念。

建议明确：

```text
membership.scope
```

可能是：

```text
CASE
WORKFLOW
TASK
TEAM
BUSINESS_OBJECT
```

例如：

```text
Bob
    Case Member
```

不意味着：

```text
Bob
    automatically
Task Assignee
```

---

# 十二、Assignment：当前这一步究竟谁来做？

Assignment 是最接近传统 Workflow 的概念。

典型：

```text
Task
    ↓
Assigned To = Alice
```

或者：

```text
Task
    ↓
Candidate Group = Compliance
```

Camunda 当前 User Task 模型明确区分：

```text
assignee
candidateUsers
candidateGroups
```

并进一步在 Task Authorization 中区分：

```text
READ
UPDATE
CLAIM
COMPLETE
```

也就是说：

> “谁被分配/候选处理”与“谁实际有权限完成 Task”并不是一个简单字段。([Camunda 8 Docs][4])

---

# 十三、Candidate Group 是非常重要的中间层

很多企业 Workflow 不应该一开始指定：

```text
Alice
```

而是：

```text
Compliance Review Group
```

然后：

```text
Compliance Group
    ↓
Alice
Bob
Carol
```

其中一个人 Claim：

```text
Task
    ↓
Candidate Group
    ↓
Alice claims
    ↓
Assignee = Alice
```

Camunda 当前就支持 candidate groups，并将 Claim / Complete 等操作与这些候选组进行授权关联。([Camunda 8 Docs][5])

这对于 Agent Workflow 非常有价值。

---

# 十四、Agent 不应该直接“挑选某个人”，除非业务真的要求

错误设计：

```text
Agent:
"我觉得 Bob 最适合。"

Agent
    ↓
assign task to Bob
```

更合理：

```text
Agent
    ↓
Task Routing Request
    ↓
Routing Policy
    ↓
Eligible Group / Role
    ↓
Assignment
```

否则 Agent 很容易把：

```text
routing decision
```

变成：

```text
authority decision
```

例如 Agent 可能因为历史上下文而一直把审批 Task 指给同一个人。

这会带来：

```text
workload imbalance
SoD violation
conflict of interest
unfair routing
```

---

# 十五、Assignment Group 与 Task Owner 也不是一回事

ServiceNow 的设计非常直观：

```text
Assignment Group
    ↓
这一类工作由哪个组负责

Task Owner / Assigned To
    ↓
具体由谁负责
```

在其 Case Task 中，Assignment Group 表示能够工作的组，而 Task Owner 是实际 owner；某些场景下，如果没有 Task Owner，组内成员都可以处理。([ServiceNow][2])

因此建议：

```text
candidateGroup
    ≠
assignee
    ≠
owner
```

---

# 十六、Observer：谁需要知道，但不需要负责？

Observer 是多人协作里最容易被低估的关系。

例如：

```text
Case Owner:
PM

Assignee:
Analyst

Observer:
Risk Manager
```

Risk Manager 可能需要：

```text
知道 Case 的进度
收到状态变化
阅读结果
```

但不需要：

```text
处理 Task
Approve
Modify
Reassign
```

ServiceNow 的 Watch List 正是经典例子：Watch List 用于订阅 Task 通知；其文档明确把 watch list 描述为订阅通知的一种机制。([ServiceNow][6])

---

# 十七、但 Observer 不等于 Watcher

这是必须特别注意的地方。

不同产品对：

```text
Watcher
Observer
Watch List
Follower
Subscriber
```

的语义并不完全一致。

例如 Jira 的 Watcher 本身主要表示：

> 订阅 Issue 的变化。

但 Watcher 仍然必须具备浏览该 Issue 的权限；Jira 官方文档也明确指出，读取 watcher 信息需要相应的项目和 Issue Security 权限。([Atlassian Developer][7])

因此：

```text
Notification Subscription
    ≠
Read Permission
```

这是一个非常重要的架构原则。

---

# 十八、ServiceNow 进一步说明了 Observer 的另一种可能

ServiceNow 某些 Legal Matter 场景中：

* Watch List User 被授予 Read-only Access；
* Ad hoc Approver 在审批期间获得 Read-only Access；
* Delegates 在委托有效期内获得相应只读访问。([ServiceNow][8])

这说明在某些业务域：

```text
Observer
```

可以同时意味着：

```text
Read-only entitlement
```

但这是具体产品的授权设计。

因此不能把：

> Watcher = Read-only access

写成普遍规则。

更准确的统一模型应该是：

```text
Observation
    ├── Notification Subscription
    └── Read Access
```

二者可以绑定，也可以分开。

---

# 十九、Observer 最好拆成两个概念

推荐：

```text
Observer
```

进一步拆成：

```text
Subscriber
Reader
```

### Subscriber

```text
可以收到变化通知
```

### Reader

```text
可以读取 Case
```

这样就可以表达：

```text
Alice
  Subscriber = true
  Reader = false
```

或者：

```text
Bob
  Subscriber = true
  Reader = true
```

或者：

```text
Carol
  Subscriber = false
  Reader = true
```

这比一个：

```text
observer = true
```

强很多。

---

# 二十、为什么 Observer 与 Permission 必须分开？

因为：

```text
通知
```

本身可能包含敏感数据。

例如：

```text
"Investment Case INV-1024 has moved to Approved."
```

这已经泄漏：

```text
Case ID
Business Status
```

所以不能因为 Observer 是“只收通知”，就默认：

```text
Notification
= no security issue
```

更安全的做法是：

```text
Notification Content
    ↓
Information Classification
    ↓
Observer Entitlement
    ↓
Minimal Payload
```

例如不允许某个用户读取 Case 内容时：

```text
Notification:
"A business item you follow has changed."
```

而不是：

```text
"INV-1024 approved USD 25M investment in ABC."
```

---

# 二十一、Case Membership 与 Read Access 也不能自动等价

Salesforce 的共享模型很好地说明了这一点。

Case Team 可以有：

```text
Role
+
Case Access
```

而一个用户也可能通过：

```text
Role hierarchy
Sharing rule
Organization default
```

获得更高权限。最终实际访问级别取决于所有适用授权中的有效结果，而不是仅仅看 Team Member 这个字段。([Salesforce][3])

因此：

> Membership 是一种授权输入，不是最终授权结果。

---

# 二十二、推荐把多人 Workflow 的参与关系分成四张表

如果做数据库设计，推荐不要一张：

```text
workflow_participants
```

塞所有东西。

更清晰的是：

```text
business_case_owner
business_case_members
workflow_task_assignment
business_case_observers
```

再配一个统一的：

```text
authorization policy
```

---

# 二十三、一个推荐的数据模型

### Case

```text
Case
{
  id

  owner_principal

  ownership_type

  created_by

  lifecycle_status
}
```

---

### Case Membership

```text
CaseMember
{
  case_id

  principal

  role

  membership_type

  valid_from
  valid_to

  added_by
}
```

---

### Task Assignment

```text
TaskAssignment
{
  task_id

  candidate_users

  candidate_groups

  assignee

  assigned_at

  assigned_by
}
```

---

### Observation

```text
CaseObserver
{
  case_id

  principal

  subscription

  read_access

  notification_preferences

  valid_from
  valid_to
}
```

注意：

```text
subscription
```

与：

```text
read_access
```

建议明确分开。

---

# 二十四、Assignment 本身也可以是时间性的

例如：

```text
Monday:
Alice

Tuesday:
Bob
```

或者：

```text
Primary:
Alice

Delegate:
Bob
```

因此不要只保存：

```text
assignee = Bob
```

最好保留：

```text
Assignment History
```

至少包括：

```text
from
to
changedBy
reason
effectiveFrom
effectiveTo
```

因为企业 Workflow 事后经常需要回答：

> 当时是谁负责？

而不是：

> 现在是谁负责？

---

# 二十五、Ownership 也需要 Transfer History

例如：

```text
Case Owner
Alice
  ↓
Bob
```

应该记录：

```text
Owner Transfer
{
  from = Alice
  to = Bob
  reason = "team change"
  authorizedBy = ...
  effectiveAt = ...
}
```

不能只覆盖：

```text
owner = Bob
```

否则历史责任链消失。

---

# 二十六、Membership 应该有生命周期

一个 Case Member 可能：

```text
加入
暂停
离开
重新加入
```

因此：

```text
CaseMembership
```

最好有：

```text
active
valid_from
valid_to
```

而不是：

```text
members = [...]
```

永久存在。

这对 Agent 更重要，因为 Agent 运行可能持续数小时甚至数天。

---

# 二十七、Agent 参与后，最容易出问题的是“隐式成员”

例如：

```text
Case Owner = Alice
```

Agent 被 Alice 调用后：

```text
Agent
```

因为：

```text
"代表 Alice"
```

被自动当成：

```text
Case Member
```

然后读取全部 Case。

这非常危险。

应该区分：

```text
delegated context
```

和：

```text
membership
```

即：

> Alice 让 Agent 帮忙处理 Case，不等于 Agent 永久加入 Case。

---

# 二十八、Agent Membership 必须有 Scope

如果 Agent 是 Case Participant：

```text
agent = research-agent
```

应该进一步定义：

```text
scope
```

例如：

```text
READ_RESEARCH
CREATE_DRAFT
READ_CASE
```

而不是：

```text
CASE_MEMBER = true
```

因为：

```text
Case Member
```

对 Human 可能意味着：

```text
Read + Comment + Edit
```

对 Agent 则可能完全不一样。

---

# 二十九、Agent Owner 通常不是一个好默认设计

尤其金融业务中，不建议：

```text
Case Owner = AI Agent
```

作为默认模式。

因为 Owner 通常意味着：

```text
accountability
responsibility
escalation
business ownership
```

Agent 可以：

```text
manage
coordinate
execute
monitor
```

但不应因此成为：

```text
最终责任主体
```

更稳妥的是：

```text
Business Owner = Human / Business Team

Workflow Runtime = System

Agent = Participant / Executor / Coordinator
```

即：

```text
Ownership
    → Human / Organization

Execution
    → Agent / Service

Accountability
    → Business Owner
```

---

# 三十、不过 Agent 可以拥有 Technical Ownership

这里需要区分：

```text
Business Ownership
```

与：

```text
Technical Resource Ownership
```

例如：

```text
Agent Definition
    Owner = AI Platform Team
```

或者：

```text
Workflow Definition
    Owner = Investment Operations
```

这完全可以。

但：

```text
Investment Case
    Owner = Agent
```

则需要非常谨慎。

这是一个很重要的同名词不同作用域问题。

---

# 三十一、Ownership 应该明确“Owner Of What”

建议平台中所有 `owner` 字段都要求：

```text
owner_of
```

例如：

```text
owner_of = BUSINESS_CASE
owner_of = WORKFLOW_DEFINITION
owner_of = WORKFLOW_INSTANCE
owner_of = TASK
owner_of = AGENT
owner_of = DOCUMENT
```

不要只有：

```text
owner_id
```

否则很容易出现：

```text
Workflow Owner
Case Owner
Task Owner
Agent Owner
```

最后无法判断：

> 这个 Owner 到底负责什么？

---

# 三十二、Membership 也需要明确“Member Of What”

同理：

```text
member_of = CASE
member_of = TEAM
member_of = WORKFLOW
member_of = TASK
```

例如：

```text
Alice
    Member of Team

Bob
    Member of Case

Carol
    Candidate for Task
```

这三件事完全不同。

---

# 三十三、Assignment 是“当前工作”，Membership 是“持续参与”

一个非常简单的判断：

```text
Membership
    → Should this person remain associated with the case?

Assignment
    → Should this person act now?
```

例如：

```text
Compliance Officer
    Member of Case

Alice
    Current Task Assignee
```

而：

```text
Risk Manager
    Member of Case
    no current task
```

都完全合理。

---

# 三十四、Observer 是“需要知道”，而不是“需要做”

也可以这样总结：

```text
Owner
    → accountable

Member
    → participates

Assignee
    → acts now

Approver
    → decides / authorizes

Delegate
    → temporarily acts for another authority

Observer
    → stays informed
```

这六个角色可以重叠。

例如：

```text
Bob
Owner + Member + Observer

Alice
Member + Assignee

Carol
Observer + Approver
```

但不能把这些关系自动互相推导。

---

# 三十五、推荐采用“Relationship Matrix”

例如：

| Relation |  读 Case | 修改 Case |       完成 Task | Approval | 分配 Task | 收通知 |
| -------- | ------: | ------: | ------------: | -------: | ------: | --: |
| Owner    | 默认由权限决定 | 默认由权限决定 |           不一定 |      不一定 |     不一定 |  可选 |
| Member   |     可配置 |     可配置 |           不一定 |      不一定 |     不一定 |  可选 |
| Assignee |    通常需要 | Task 范围 |           通常是 |      不一定 |     不一定 |  通常 |
| Approver |      通常 |     不一定 | Approval Task |        是 |     不一定 |  可选 |
| Delegate |   取决于委托 |   取决于委托 |         取决于委托 |    取决于委托 |     不一定 |  通常 |
| Observer |     可配置 |     通常否 |             否 |        否 |       否 |  通常 |

这不是一套通用的权限答案。

它的意义是：

> 强制架构团队不要把“关系名称”直接当成“权限”。

---

# 三十六、Authorization Matrix 才是最终答案

真正的权限仍然应该来自：

```text
Actor
+
Relation
+
Role
+
Capability
+
Resource
+
Action
+
Task
+
Policy
```

例如：

```text
Bob
Case Member
PortfolioManager
Capability = APPROVE_INVESTMENT
Case = INV-1024
Task = PM_APPROVAL
Policy = PM_APPROVAL_V3
```

最终：

```text
ALLOW
```

而不是：

```text
Bob is a member
→ allow
```

Camunda 当前 User Task Authorization 就是这一思想的直接例子：Task 的 READ / CLAIM / COMPLETE 可以基于 assignee、candidate users、candidate groups 等属性以及更高层的 process-level authorization 来判断。([Camunda 8 Docs][9])

---

# 三十七、Group Membership 与 Case Membership 也不应该混为一谈

例如：

```text
Alice
    member of Compliance Team
```

不等于：

```text
Alice
    member of Case INV-1024
```

更不等于：

```text
Alice
    assigned to current task
```

Microsoft Teams 说明的 Team Owner / Team Member 是一种组织协作关系；Case Team 又是 Salesforce 另一种对象级协作关系。两者说明了同一个基本事实：

> **Membership 必须有资源作用域。** ([Microsoft Learn][10])

---

# 三十八、推荐使用 Principal 抽象

多人 Workflow 不应该把 UserId 写死成唯一参与主体类型。

定义：

```text
Principal
├── HumanUser
├── Group
├── ServicePrincipal
├── Agent
└── System
```

这样：

```text
owner
member
assignee
observer
```

都可以引用：

```text
principalId
principalType
```

例如：

```text
Case Owner:
HUMAN:user-123

Assignment Group:
GROUP:compliance-apac

Executor:
AGENT:proxy-vote-agent

Observer:
HUMAN:user-789
```

---

# 三十九、Group 是 Membership 的重要压缩形式

例如：

```text
Case Members:
GROUP:INVESTMENT-COMMITTEE
```

比把：

```text
Alice
Bob
Carol
David
...
```

全部展开更容易治理。

但是：

> Group Membership 不是静态快照，也不是永久授权。

需要考虑：

```text
group changes
```

之后当前 Case 是否：

```text
动态跟随 Group
```

还是：

```text
冻结为 Case 创建时的成员
```

---

# 四十、动态 Membership 与 Snapshot Membership

这是生产 Workflow 很重要的问题。

例如：

```text
Case created:
Compliance Group = A, B, C
```

两天后：

```text
B leaves group
D joins group
```

当前 Case：

```text
Should D gain access?
Should B retain historical access?
```

没有唯一答案。

需要定义 Membership Policy：

```text
LIVE
SNAPSHOT
HYBRID
```

### LIVE

始终按照当前 Group membership。

优点：

```text
治理简单
人员变化自动生效
```

风险：

```text
历史 Case 的参与范围会动态变化
```

### SNAPSHOT

Case 创建时记录成员。

优点：

```text
历史可重建
```

风险：

```text
人员变动需要额外处理
```

### HYBRID

例如：

```text
Case Read Access = Live

Approval Authority = Snapshot / Re-validated
```

对于金融场景通常更值得考虑。

---

# 四十一、Approval Authority 不应该简单跟随 Membership

例如：

```text
Case Member = Compliance Team
```

不能简单推导：

```text
所有成员都可以 Approval
```

应该：

```text
Membership
   ↓
候选参与者

Role / Capability
   ↓
可能具有 Approval Authority

Policy
   ↓
当前是否真正允许
```

所以：

> **Membership 决定谁属于这个协作空间；Authorization 决定谁现在可以做什么。**

---

# 四十二、Observer 最适合采用订阅模型

例如：

```text
Case Observer
    subscribes:
       status_changed
       comment_added
       approval_completed
       SLA_risk
```

而不是：

```text
observer = true
```

这样可以控制：

```text
信息频率
事件类型
通知渠道
敏感级别
```

ServiceNow Watch List 的核心也是订阅 Task / Record 变化；其通知系统进一步把 Assigned To、Assignment Group、Watch List 等作为不同的通知对象。([ServiceNow][11])

---

# 四十三、不要让 Observer 自动获得 Write

这是最常见的错误之一：

```text
observer
    ↓
case access
    ↓
read/write
```

推荐默认：

```text
Observer
    → notification

Reader
    → read

Member
    → configured participation

Assignee
    → task action

Owner
    → accountability

Approver
    → decision authority
```

然后再通过 Authorization 组合。

---

# 四十四、Observer 也可能需要“信息范围”

一个风险观察者可能应该看到：

```text
Case status
Risk level
Current owner
```

但不应该看到：

```text
Sensitive research
client PII
trading rationale
legal privilege
```

因此：

```text
Observer
    ≠
read entire case
```

更合理的是：

```text
Observation Scope
```

例如：

```text
Observer
  → status_only

Risk Observer
  → risk + evidence

Executive Observer
  → summary + status

Audit Observer
  → full historical record
```

---

# 四十五、这也是为什么“Read Only”本身可能不够

很多企业系统只有：

```text
READ
WRITE
```

但多人业务流程需要：

```text
READ_SUMMARY
READ_FULL
COMMENT
DOWNLOAD
EXPORT
VIEW_SENSITIVE
VIEW_HISTORY
VIEW_AUDIT
```

Salesforce 的 Case Team 已经允许成员使用不同的 Case Access levels；ServiceNow 的 Legal Matter 则进一步根据角色区分 Full Access、Read-only、任务相关访问、Watch List 访问和 Delegation Access。([Salesforce][1])

对于金融 Agent，建议更加细化。

---

# 四十六、Ownership Transfer 是一个高风险操作

因为：

```text
transfer ownership
```

本身就是：

```text
authority-changing action
```

例如：

```text
Case Owner = Alice
```

变成：

```text
Case Owner = Agent
```

或者：

```text
Case Owner = Bob
```

可能同时改变：

```text
谁负责
谁可见
谁可分配
谁可以升级
谁收到通知
谁承担业务责任
```

因此 Ownership Transfer 应该：

```text
有明确权限
有审计
有生效时间
```

而不是普通字段 Update。

Salesforce 对 Case Ownership Transfer 就使用专门的 ownership operation，并根据 sharing model 限制哪些用户/queue 可以接管记录。([Salesforce][12])

---

# 四十七、Delegation 不应该等于 Ownership Transfer

例如：

```text
Alice = Owner
```

Alice 休假：

```text
Bob = Delegate
```

不应该直接：

```text
Owner = Bob
```

如果业务实际上是：

> Bob 临时代表 Alice 处理。

更准确的是：

```text
Owner = Alice

Delegation:
Alice → Bob
valid:
2026-09-20 ~ 2026-09-30
scope:
APPROVE_REVIEW
```

ServiceNow 的 Legal Matter 设计就明确把 Delegates 作为一种独立的访问关系，而且 Delegation 到期后会撤销相应访问。([ServiceNow][8])

---

# 四十八、Agent 尤其应该使用 Delegation，而不是 Role Impersonation

如果：

```text
Portfolio Manager
```

要求 Agent：

> 帮我处理我当前的 Approval Queue。

不要：

```text
Agent = PortfolioManager
```

而应该：

```text
Delegation
    Human = PM
    Agent = Review Assistant
    Scope = read + prepare
    TTL = 2 hours
```

如果 Agent 需要进行真正 Approval：

```text
Delegation
    Scope = APPROVE_INVESTMENT
```

也必须明确这是：

```text
Delegated Authority
```

而不是：

```text
Agent inherited PM role
```

---

# 四十九、Observer、Membership、Assignment 对 Agent 有不同含义

可以直接建立：

| Agent 关系          | 含义                         |
| ----------------- | -------------------------- |
| Agent as Owner    | 对 Business Case 负责，通常不建议默认 |
| Agent as Member   | 长期参与 Case                  |
| Agent as Assignee | 执行当前 Task                  |
| Agent as Delegate | 临时代行特定 Authority           |
| Agent as Observer | 监控 / 订阅 / 只读               |
| Agent as Executor | 执行明确 Command               |

这些角色都可以存在。

但它们不能：

```text
自动互相升级
```

---

# 五十、Agent as Observer 是一个非常有价值的模式

例如：

```text
Risk Monitoring Agent
```

加入：

```text
Investment Case
```

只拥有：

```text
READ_RISK_DATA
READ_CASE_STATUS
SUBSCRIBE_EVENTS
```

当发现：

```text
risk threshold exceeded
```

它可以：

```text
create alert
request human review
```

但不能：

```text
approve
execute
change owner
change policy
```

这是一种非常干净的：

> **Observer Agent**

---

# 五十一、Agent as Member 适合长期 Case 协作

例如：

```text
Research Agent
```

作为：

```text
Investment Case Member
```

可以持续：

```text
读取资料
准备摘要
更新 research package
响应新的 Human Task
```

但不能因此得到：

```text
Approval
Execution
Owner Transfer
```

这就是：

```text
Membership
+
bounded capability
```

---

# 五十二、Agent as Assignee 则更接近传统 Worker

例如：

```text
Task:
Prepare Voting Package

Assignee:
Proxy-Vote-Agent
```

它只需要：

```text
READ_CASE
READ_ISS_DATA
GENERATE_DRAFT
SAVE_DRAFT
```

Task 完成后：

```text
Assignee ≠ Approver
```

Workflow 再交给：

```text
Human Checker
```

这与前面 Maker-Checker 模型直接衔接。

---

# 五十三、不能因为 Agent 是 Assignee 就认为 Agent 是 Owner

例如：

```text
Case Owner = PM

Task Owner = Agent
```

完全没有问题。

甚至：

```text
Case Owner = Business Team
Task Assignee = Agent
```

更加常见。

这说明：

> **Ownership 是长期责任，Assignment 是当前工作。**

---

# 五十四、多人 Workflow 的参与模型可以最终抽象为五个维度

我更推荐企业平台最终采用：

```text
Accountability
Participation
Execution
Observation
Authority
```

映射到：

```text
Ownership
Membership
Assignment
Observer
Authorization
```

其中：

```text
Delegation
```

作为 Authority 的临时转移机制。

图示：

```text
                      Business Case
                           │
        ┌──────────────────┼───────────────────┐
        │                  │                   │
   Accountability     Participation        Observation
        │                  │                   │
      Owner             Members            Observers
                           │
                      Current Work
                           │
                        Assignee
                           │
                         Action
                           │
                    Authorization
```

这个模型比：

```text
Participants
```

一个数组清楚很多。

---

# 五十五、推荐的统一领域模型

```text
Principal
├── Human
├── Group
├── Agent
└── Service

BusinessCase
├── owner
├── members[]
├── observers[]
├── delegations[]
└── accessPolicy

WorkflowInstance
├── owner
├── participants
└── tasks[]

Task
├── candidateUsers[]
├── candidateGroups[]
├── assignee
├── delegation
└── taskPolicy

Authorization
├── principal
├── capability
├── resource
├── action
├── context
└── policyDecision
```

这里的一个核心原则是：

> **参与关系是 Domain Model；授权是 Policy Decision。**

不要反过来。

---

# 五十六、一个非常重要的关系：Case Membership ≠ Task Candidate

例如：

```text
Case Members:
Alice
Bob
Carol
```

当前 Task：

```text
Candidate Group:
Compliance
```

可能只有：

```text
Bob
Carol
```

能处理。

Alice 虽然：

```text
Case Member
```

但不是：

```text
Task Candidate
```

这样就保持了：

```text
Case Collaboration
```

和：

```text
Task Execution
```

的分离。

---

# 五十七、反过来，Task Assignee 也不一定成为 Case Member

例如外部：

```text
External Legal Reviewer
```

只被邀请：

```text
Task = Review Legal Clause
```

不一定需要成为：

```text
Case Member
```

这在金融、法务、外部供应商协作中尤其常见。

因此：

> Assignment 可以是临时的 Task-scoped relationship。

---

# 五十八、Observer 也不一定需要成为 Member

例如：

```text
Executive
```

只想：

```text
follow case progress
```

可以：

```text
Subscriber = true
Member = false
```

这正是 Observer 这个关系存在的意义。

---

# 五十九、一个人可以同时有多个关系

不要让 Role Enum 互斥。

例如：

```text
Bob:
    Owner
    Member
    Approver
    Observer
```

这是完全合理的。

所以不要建：

```text
participantType = OWNER | MEMBER | OBSERVER
```

因为现实业务中它们可以重叠。

更好的方式是：

```text
relationships[]
```

例如：

```json
{
  "principal": "bob",
  "relationships": [
    "OWNER",
    "MEMBER",
    "APPROVER",
    "OBSERVER"
  ]
}
```

但每个关系仍然必须有自己的：

```text
scope
validity
authority
```

---

# 六十、关系的组合不应该直接变成权限

例如：

```text
Bob:
OWNER + MEMBER + OBSERVER
```

不要直接：

```text
Permissions = UNION(all owner/member/observer permissions)
```

因为有些关系是：

```text
accountability
```

有些是：

```text
notification
```

有些是：

```text
authorization
```

不是所有 Relation 都是 Permission Source。

---

# 六十一、建议把 Relation Type 和 Permission Source 分开

例如：

```text
Relation:
OWNER

Can contribute authorization?
YES / NO

Can contribute visibility?
YES / NO

Can contribute routing?
YES / NO
```

这样平台未来可以表达：

```text
OWNER
    → visibility input
    → routing input
    → escalation target

OBSERVER
    → notification only

MEMBER
    → collaboration context

ASSIGNEE
    → task execution candidate
```

---

# 六十二、Workflow 中的 Ownership 最好是“Accountability”，而不是“ACL Shortcut”

这是特别值得固定成平台规范的一条：

> **Owner 表示谁负责，不应该成为绕过 Authorization 的快捷方式。**

错误：

```text
if case.owner == user:
    allow everything
```

正确：

```text
if case.owner == user:
    user is accountable owner

Authorization:
    evaluate action separately
```

---

# 六十三、同样，Membership 不应该成为 Data Entitlement Shortcut

例如：

```text
Case Member
```

不等于：

```text
可以访问 Case 中所有数据
```

尤其金融业务：

```text
Case
  ├── Portfolio Data
  ├── Client PII
  ├── Legal Advice
  ├── Restricted Research
  └── Trading Information
```

不同 Member 可能需要：

```text
不同数据范围
```

因此：

```text
Membership
    ≠
Data Entitlement
```

---

# 六十四、Observer 更不能成为 Data Entitlement Shortcut

尤其：

```text
Executive Observer
```

可能只需要：

```text
status summary
```

不应该因为：

```text
observer
```

就得到：

```text
full document access
```

所以：

```text
Case Visibility
    ≠
Document Visibility
```

仍然应该由 Data Entitlement 决定。

---

# 六十五、组织权限与 Case Membership 应该做两层控制

推荐：

```text
Organization Authorization
          +
Case / Task Relationship
          ↓
Effective Authorization
```

例如：

```text
User = Bob

Organization:
PortfolioManager

Case:
Member

Task:
Assignee

Action:
APPROVE
```

再进入：

```text
Policy
```

决定：

```text
ALLOW
```

而不是：

```text
Case Member → automatically allow
```

---

# 六十六、ServiceNow 的设计特别值得借鉴

ServiceNow 当前文档中可以看到非常清晰的一组关系：

```text
Assignment Group
Task Owner
Watch List
Delegate
```

例如：

* Assignment Group：负责工作；
* Task Owner：具体负责 Task；
* Watch List：关注进展 / 接收通知；
* Delegate：在委托期间承担特定职责；
* 在某些 Legal Matter 场景中，这些角色还对应不同的文档访问权限。([ServiceNow][13])

它没有把：

```text
参与者
```

作为一个全能角色。

这对 Agent Workflow 很有启发。

---

# 六十七、Salesforce 的设计也值得借鉴

Salesforce 的 Case Team 把：

```text
Case Owner
Case Team
Team Role
Case Access
```

分开。

Team Role 可以决定：

```text
Read
Read/Write
Private
```

而 Case 的实际 Sharing Model 又可以进一步覆盖这些关系。([Salesforce][1])

这里体现出的基本原则是：

> **Membership → Role → Access**

而不是：

> Membership → Full Access。

---

# 六十八、Camunda 的设计适合 Workflow Runtime

Camunda 将：

```text
assignee
candidateUsers
candidateGroups
```

与：

```text
READ
CLAIM
COMPLETE
UPDATE
```

权限区分开。

而且 Task Authorization 可以基于任务属性和候选组进行控制。([Camunda 8 Docs][4])

这非常适合作为：

```text
Workflow / Human Task Runtime
```

的参考。

---

# 六十九、Microsoft Teams 的经验适合说明“Membership ≠ Ownership”

Teams 明确区分：

```text
Team Owner
Team Member
```

Owner 可以管理成员和团队设置，而普通 Member 是团队成员。([Microsoft Learn][10])

它说明：

> 一个协作空间中，Membership 和 Governance 本身就不是同一个角色。

在 Business Case 中也应该如此。

---

# 七十、Power Automate 的 Flow Owner 还说明了另一层

Power Automate 当前区分：

```text
Flow Owner
Co-owner
Run-only User
```

Co-owner 可以修改 Flow、管理连接和其他 Owner；Run-only User 只能运行而不能编辑。Microsoft 明确建议仅在真正需要共同维护时授予 Co-owner，其他共享场景优先 Run-only。([Microsoft Learn][14])

这实际上进一步说明：

```text
Usage
    ≠
Ownership
```

以及：

```text
Execution
    ≠
Governance
```

这两个原则对 Agent 平台同样成立。

---

# 七十一、Agent Platform 应该避免“Owner Everything”模型

以下设计不推荐：

```text
Case
  Owner = Agent

Workflow
  Owner = Agent

Task
  Assignee = Agent

Approval
  Approver = Agent

Observer
  Agent
```

因为最终：

```text
Agent
```

同时承担：

```text
accountability
execution
approval
governance
```

这是组织授权边界被穿透的典型模式。

更合理：

```text
Case
  Owner = Business Human / Team

Workflow
  Owner = Business / Operations

Task
  Assignee = Agent

Approval
  Approver = Authorized Human / Policy

Observer
  Monitoring Agent
```

---

# 七十二、一个推荐的金融 Agent Case 示例

以 Proxy Voting 为例：

```text
Proxy Vote Case
```

### Ownership

```text
Case Owner:
Portfolio Operations Manager
```

负责：

```text
Case accountability
```

### Membership

```text
Investment Analyst
Portfolio Manager
Compliance Officer
Operations Specialist
```

### Current Assignment

```text
Current Task:
Voting Instruction Review

Assignee:
Investment Analyst
```

### Approval

```text
Portfolio Manager
```

### Observer

```text
Risk Manager
Compliance Monitoring Agent
```

### Agent Participant

```text
Proxy Voting Agent
```

拥有：

```text
READ_CASE
READ_ISS_DATA
GENERATE_PROPOSAL
PREPARE_SUBMISSION
```

没有：

```text
APPROVE_VOTE
CHANGE_POLICY
TRANSFER_OWNERSHIP
```

这个模型非常清晰。

---

# 七十三、Observer Agent 甚至可以拥有自己的不同权限

例如：

```text
Risk Monitoring Agent
```

可以：

```text
READ_STATUS
READ_RISK_METRICS
SUBSCRIBE_EVENTS
CREATE_ALERT
```

但不能：

```text
READ_CLIENT_PII
APPROVE
EXECUTE
EDIT_CASE
```

于是：

```text
Observer
```

不再意味着：

```text
passive human
```

而是一种：

> **bounded monitoring relationship**

这对 Agent 很重要。

---

# 七十四、多人 Workflow 中必须有“Participant Lifecycle”

因为参与关系不是永久的。

一个 Case 可能经历：

```text
Created
  ↓
Assigned
  ↓
Team expanded
  ↓
Reviewer added
  ↓
Reviewer removed
  ↓
Owner transferred
  ↓
Delegate appointed
  ↓
Case closed
```

所以所有关系都应该支持：

```text
effective_from
effective_to
reason
changed_by
```

否则很难进行：

```text
historical reconstruction
audit
incident analysis
```

---

# 七十五、Case Close 时 Observer 是否自动失效？

应该成为明确 Policy。

例如：

```text
Case Closed
```

可能：

```text
Subscribers:
unsubscribe

Temporary Members:
expire

Delegates:
expire

Historical Readers:
retain read-only

Audit:
retain immutable access
```

不要把它交给：

```text
UI cleanup
```

或者：

```text
cron job
```

隐式处理。

---

# 七十六、Delegation 应该有明确 TTL

例如：

```text
Bob delegates to Alice
```

应该：

```text
from
to
scope
reason
```

而不是：

```text
delegate = alice
```

否则：

> 临时权限很容易变成永久权限。

ServiceNow 的 Delegation 文档明确体现了这一点：Delegates 的访问与 delegation duties 绑定，delegation 结束后对应访问会失效。([ServiceNow][8])

---

# 七十七、Observer 的通知也应该有 TTL

例如：

```text
Risk Manager
    follow case
```

Case Close 之后：

```text
still receiving notifications?
```

不一定。

尤其是：

```text
sensitive case
```

更应该：

```text
subscription expires
```

因此 Observer Relationship 也应该有：

```text
validity
scope
event_filter
```

---

# 七十八、对于敏感金融 Case，建议使用“Explicit Access + Least Privilege”

例如：

```text
Case Member:
Compliance Officer
```

不自动推导：

```text
All Case Documents
```

而是：

```text
Case Access:
READ_CASE

Document Access:
COMPLIANCE_SET

Sensitive Research:
DENY
```

ServiceNow Legal Matter 的具体做法就是把不同关系映射到不同文档访问权限，例如 Collaborator、Ad hoc Approver、Task Owner、Assignment Group、Watch List、Delegate 各有不同访问范围。([ServiceNow][8])

---

# 七十九、多人 Agent Workflow 可以最终形成一个“Relationship Graph”

这比一个 participants 数组更准确。

例如：

```text
                    Business Case
                    INV-1024
                         │
        ┌────────────────┼────────────────┐
        │                │                │
      OWNER            MEMBER         OBSERVER
        │                │                │
        PM        ┌──────┼──────┐    Risk Manager
                  │      │      │
               Analyst Compliance Agent
                  │
              ASSIGNEE
                  │
                  ▼
          Current Review Task

                    │
                 APPROVER
                    │
                    ▼
                   PM
```

它表达的是：

```text
different relationships
```

而不是：

```text
one participant list
```

---

# 八十、Relationship Graph 不等于 Authorization Graph

这两个也必须分开。

Relationship Graph：

```text
Alice is member
Bob is owner
Carol observes
Agent assigned
```

Authorization Graph：

```text
Bob CAN_APPROVE
Alice CAN_EDIT
Agent CAN_PREPARE
Carol CAN_READ_SUMMARY
```

前者描述：

> 业务协作关系。

后者描述：

> 实际权限。

---

# 八十一、推荐建立 Effective Authorization 计算过程

```text
Principal
   ↓
Relations
   ├── Owner
   ├── Member
   ├── Assignee
   ├── Delegate
   └── Observer
   ↓
Organizational Role
   ↓
Capability
   ↓
Resource
   ↓
Action
   ↓
Workflow Task
   ↓
Policy
   ↓
Effective Authorization
```

最终：

```text
ALLOW
DENY
```

这非常符合现代企业 Workflow 系统的趋势：关系字段负责提供授权上下文，真正执行仍在 Authorization Layer 完成。Camunda 当前 Task Authorization 就是一个很直接的例子。([Camunda 8 Docs][9])

---

# 八十二、一个值得固定的原则：Relationship ≠ Authority

可以把整个文档压缩成：

```text
Ownership
    = Accountability

Membership
    = Participation

Assignment
    = Current Work

Delegation
    = Temporary Authority Transfer

Observation
    = Visibility / Subscription

Authorization
    = Actual Permission
```

这六者不要互相替代。

---

# 八十三、另一个重要原则：Observer ≠ Viewer ≠ Subscriber

最好进一步区分：

```text
Subscriber
    = receives events

Viewer
    = can read

Observer
    = business role meaning "keeps oversight"
```

其中：

```text
Observer
```

可以由：

```text
Viewer
+
Subscriber
```

组成，也可以只代表一种业务责任。

这取决于系统。

不要把三个词强行定义成所有企业通用的标准术语。

---

# 八十四、推荐的最小数据模型

如果希望保持实际系统简单，可以先用：

```text
Case
- owner_principal

CaseMember
- case_id
- principal
- role
- valid_from
- valid_to

Task
- candidate_groups
- candidate_users
- assignee

TaskObserver
- task_id
- principal
- subscribe
- read_access
- valid_until

Delegation
- delegator
- delegate
- scope
- valid_from
- valid_to
```

然后所有实际权限：

```text
Authorization Service
```

统一计算。

---

# 八十五、不要创建一个巨大的 Participant 表

例如不推荐：

```text
Participant
{
  case_id
  user_id
  type
  can_read
  can_write
  can_approve
  can_assign
  can_execute
  notify
}
```

因为最终它会变成：

> 一个 DIY Authorization Engine。

然后：

```text
type
OWNER
MEMBER
OBSERVER
ASSIGNEE
APPROVER
ADMIN
...
```

不停膨胀。

更好的：

```text
Relationship
```

与：

```text
Authorization
```

分离。

---

# 八十六、Workflow 中应该有三个不同的 Inbox

从用户体验上，也可以利用这个模型。

### My Tasks

```text
Assigned / Claimable
```

### My Cases

```text
Owned / Member
```

### Following

```text
Observed / Subscribed
```

例如：

```text
My Tasks
    → 我现在需要处理什么

My Cases
    → 哪些业务对象由我负责 / 参与

Following
    → 哪些对象我只是希望知道变化
```

这比把所有内容堆到一个：

```text
Inbox
```

里更符合真实工作。

---

# 八十七、对于 Agent，可以提供类似的三个视图

### Agent Work Queue

```text
Tasks assigned to Agent
```

### Agent Case Context

```text
Cases Agent participates in
```

### Agent Monitoring Scope

```text
Cases Agent observes
```

这样 Agent Runtime 也不会把：

```text
all accessible cases
```

当成：

```text
all cases it should act on
```

---

# 八十八、这对 Agent 很重要，因为“可见”不等于“应该行动”

例如 Agent 可以读取：

```text
1,000 cases
```

但可能只有：

```text
20 active tasks
```

真正应该自动处理的可能只有：

```text
5 tasks
```

因此至少要区分：

```text
Can Read
Can Participate
Can Act
```

这三个层次。

---

# 八十九、推荐建立三个 Agent Boundary

```text
Data Boundary
    ↓
Can see

Participation Boundary
    ↓
Can work on

Authority Boundary
    ↓
Can perform protected action
```

即：

```text
Read
   ≠
Participate
   ≠
Act
```

这是前面 Data Entitlement / Authorization 原则在多人 Workflow 中的直接延伸。

---

# 九十、一个完整的 Agent Case 示例

例如：

```text
Case = INV-1024
```

### Ownership

```text
Owner:
PM-Bob
```

### Membership

```text
Alice = Analyst
Carol = Compliance
```

### Assignment

```text
Current Task:
Prepare Compliance Review

Assignee:
Compliance-Agent-v2
```

### Delegation

```text
Carol
 → Compliance-Agent-v2
Scope:
READ_CASE
GENERATE_REVIEW
```

### Observer

```text
Risk-Agent
    Subscription:
    status_changed
    risk_changed

CFO
    Read:
    summary_only
```

### Approval

```text
Investment Committee
```

### Authorization

```text
Agent:
Cannot approve

Bob:
Can approve within mandate

Committee:
Can approve above threshold
```

这套模型已经能够表达非常复杂的多人协作，而不需要：

```text
participants = [...]
```

一个数组解决所有问题。

---

# 九十一、对于金融业务，推荐增加“Accountable Owner”

如果 Case 有多个 Member、多个 Assignee、多个 Observer，最终很容易出现：

> “出了问题到底谁负责？”

所以建议明确一个：

```text
Accountable Owner
```

它通常是：

```text
Business Owner
```

可以是：

```text
Human
Business Team
```

而不是：

```text
Agent
```

这样：

```text
AI can execute
Human remains accountable
```

在高风险金融流程里尤其重要。

---

# 九十二、但 Owner 也不能成为“单点超级用户”

这是另一个极端。

如果：

```text
Accountable Owner = Bob
```

不应该因此：

```text
Bob can approve himself
Bob can modify policy
Bob can override compliance
Bob can delete audit
```

所以：

> Accountability 与 Authority 仍然必须分离。

---

# 九十三、推荐的最终角色关系

可以画成：

```text
                         Business Case
                              │
                     Accountable Owner
                              │
                ┌─────────────┼─────────────┐
                │             │             │
             Members      Current Tasks   Observers
                │             │             │
                │          Assignee      Subscriber
                │          Candidate     Reader
                │
             Roles
                │
                └─────────────┬─────────────┘
                              │
                        Authorization
                              │
                    Policy / Capability
                              │
                           Actions
```

这张图最重要的是：

```text
Owner
Member
Assignee
Observer
```

都通过：

```text
Authorization
```

才能最终变成：

```text
Action
```

---

# 九十四、反模式一：Participant Everything

```text
Case
  participants:
    Alice
    Bob
    Agent
```

然后：

```text
participants.canEdit()
participants.canApprove()
```

这是最危险的简化。

---

# 九十五、反模式二：Owner Means Admin

```text
Owner
  ↓
Full Access
```

不要这样设计。

---

# 九十六、反模式三：Member Means Read/Write

```text
Member
  ↓
Read + Write + Execute
```

不成立。

---

# 九十七、反模式四：Observer Means Read Everything

```text
Observer
  ↓
Full Case Read
```

不成立。

应该分别定义：

```text
subscription
read scope
data entitlement
```

---

# 九十八、反模式五：Assignee Means Approval Authority

```text
Assignee
  ↓
Approve
```

不成立。

特别是金融 Workflow。

---

# 九十九、反模式六：Delegation = Ownership Transfer

```text
Alice unavailable
  ↓
owner = Bob
```

不一定。

可能只是：

```text
delegation = Bob
```

---

# 一百、反模式七：Agent Becomes Case Owner

```text
Case
  ↓
Owner = Agent
```

如果 Agent 同时：

```text
route
approve
execute
```

会导致严重 authority concentration。

---

# 一百零一、反模式八：Watcher Automatically Gets ACL

```text
add watcher
  ↓
grant read/write
```

危险。

Watcher 首先应该被理解为：

```text
subscription
```

然后再由具体产品策略决定是否附带 read access。

Jira 和 ServiceNow 的具体实现差异正好说明了这一点：Jira Watcher 主要是订阅模型，仍需满足原有浏览/Issue Security；ServiceNow 某些领域又把 Watch List 映射到只读访问。不能把某一个产品的具体实现泛化为通用语义。([Atlassian Developer][7])

---

# 一百零二、反模式九：Current User = Case Owner

```text
Workflow resumed
  ↓
currentUser
  ↓
Case Owner
```

错误。

需要区分：

```text
Initiator
Owner
Current Assignee
Current Approver
Current User
Agent
```

---

# 一百零三、反模式十：Group Membership = Case Membership

```text
Bob ∈ Compliance Group
```

不等于：

```text
Bob ∈ Case Members
```

除非明确选择：

```text
dynamic group-based case access
```

---

# 一百零四、Agent Workflow 中最应该固定的六个不变量

### Invariant 1

> **Ownership expresses accountability, not unrestricted permission.**

### Invariant 2

> **Membership expresses participation, not automatic authorization.**

### Invariant 3

> **Assignment expresses who works now, not who owns the business case.**

### Invariant 4

> **Delegation transfers bounded authority for a limited scope and time.**

### Invariant 5

> **Observation is separate from notification subscription and data entitlement.**

### Invariant 6

> **Authorization is the final enforcement decision; relationships only provide context.**

---

# 一百零五、一个更适合企业 Agent 的核心模型

最终可以把所有关系归纳成：

```text
                    Principal
                       │
         ┌─────────────┼──────────────┐
         │             │              │
    Accountability  Participation  Observation
         │             │              │
       Owner        Member/Assignee   Observer
         │             │              │
         └─────────────┼──────────────┘
                       │
                  Context Only
                       │
                 Authorization
                       │
                Policy + Capability
                       │
                    Action
                       │
                    Domain
```

这里：

```text
Relationship
    → context

Authorization
    → enforcement
```

这是一条非常值得保留的原则。

---

# 一百零六、与前面 Agent Control Plane 的连接

如果把这一模型放进前面设计的 Agent Control Plane，可以得到：

```text
                         Control Plane
                              │
       ┌──────────────────────┼─────────────────────┐
       │                      │                     │
   Identity              Relationship          Authorization
       │                      │                     │
   Human/Agent          Owner/Member          Policy
   Principal            Assignee/Observer     Capability
   Delegation                                  Entitlement
       │                      │                     │
       └──────────────────────┼─────────────────────┘
                              │
                           Workflow
                              │
                            Task
                              │
                           Command
                              │
                            Domain
                              │
                       Business State
```

这比：

```text
Agent Runtime
   ↓
users
   ↓
permissions
```

要清晰得多。

---

# 一百零七、Agent Runtime 应该只看到“当前有效关系”

Agent 不应该自己推导：

```text
"Bob is an observer, therefore Bob can approve."
```

而应该调用：

```text
GetEffectiveCapabilities(
    principal,
    case,
    task,
    action
)
```

返回：

```text
ALLOW
DENY
```

或者：

```json
{
  "canRead": true,
  "canComment": true,
  "canApprove": false,
  "canExecute": false
}
```

这样 Agent Runtime 只是：

> consumer of authorization information。

而不是：

> owner of authorization rules。

---

# 一百零八、最终推荐 API

例如：

```text
GET /cases/{caseId}/relationships
```

得到：

```json
{
  "owner": {...},
  "members": [...],
  "observers": [...]
}
```

然后：

```text
GET /tasks/{taskId}/assignment
```

得到：

```json
{
  "candidateUsers": [...],
  "candidateGroups": [...],
  "assignee": {...}
}
```

最终：

```text
POST /authorization/check
```

输入：

```json
{
  "principal": "agent:proxy-vote-v3",
  "action": "SUBMIT_VOTE",
  "resource": "case:PV-1024",
  "task": "task:vote-review"
}
```

输出：

```json
{
  "decision": "DENY",
  "reason": "human_approval_required"
}
```

这样：

```text
Relationships
```

和：

```text
Authorization
```

天然分层。

---

# 一百零九、关系本身也需要 Audit

例如：

```text
Alice added Bob as Case Member.
```

应该记录：

```text
who
when
why
scope
expires
```

同样：

```text
Bob added as Observer
Alice delegated to Carol
Owner transferred from Bob to Dave
Agent added as participant
```

都应该是审计事件。

因为：

> 改变关系本身，就可能改变后续权限。

---

# 一百一十、关系变化必须能够触发权限重新计算

例如：

```text
Owner changed
Member removed
Delegation expired
Task reassigned
Group membership changed
```

都可能使：

```text
Effective Authorization
```

发生变化。

因此：

```text
Relationship Change
      ↓
Invalidate / Recompute Authorization
      ↓
Existing Agent Execution
      ↓
Continue / Stop / Revalidate
```

不能等下一次登录才生效。

---

# 一百一十一、Agent 长时间执行时尤其需要这个机制

例如：

```text
09:00 Agent starts
```

当时：

```text
Owner = Alice
Agent = Member
Capability = PREPARE
```

11:00：

```text
Alice leaves team
```

如果 Agent 一直持有：

```text
old membership context
```

继续执行到：

```text
14:00
```

就可能突破新的组织边界。

因此长期 Agent 应支持：

```text
authorization refresh
relationship invalidation
capability expiration
task re-validation
```

这与 AWS 对 Agent 长生命周期凭据、权限边界、短期 Session 和持续监控的建议是一致的。([AWS Documentation][15])

---

# 一百一十二、最终的数据结构建议

如果从企业平台长期演进角度出发，可以使用：

```text
Principal
 ├── id
 ├── type
 └── identity_source

Relationship
 ├── resource
 ├── principal
 ├── relation_type
 ├── role
 ├── scope
 ├── valid_from
 ├── valid_to
 └── created_by

TaskAssignment
 ├── task
 ├── candidate_users
 ├── candidate_groups
 ├── assignee
 └── assignment_history

Delegation
 ├── delegator
 ├── delegate
 ├── scope
 ├── valid_from
 └── valid_to

ObservationSubscription
 ├── resource
 ├── principal
 ├── event_types
 ├── read_scope
 └── valid_to

AuthorizationDecision
 ├── principal
 ├── action
 ├── resource
 ├── context
 ├── policy_version
 ├── decision
 └── evaluated_at
```

这样可以避免后面：

```text
participant_type
```

越来越巨大。

---

# 一百一十三、一个更完整的多人 Workflow 模型

最终可以形成：

```text
                         Business Case
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
      Owner                Members              Observers
        │                     │                     │
 Accountability        Participation          Subscription
                                               / Visibility
        │                     │                     │
        └─────────────────────┼─────────────────────┘
                              │
                           Workflow
                              │
                          Current Task
                              │
             ┌────────────────┼────────────────┐
             │                │                │
       Candidate Group     Assignee         Delegate
             │                │                │
             └────────────────┼────────────────┘
                              │
                        Authorization
                              │
                     Policy + Capability
                              │
                           Command
                              │
                           Domain
                              │
                       Business State
                              │
                            Audit
```

---

# 一百一十四、最值得固定的三组“不等式”

### 第一组：责任

```text
Owner
    ≠
Assignee
```

Owner 是长期责任。

Assignee 是当前工作。

---

### 第二组：协作

```text
Member
    ≠
Observer
```

Member 是参与。

Observer 是关注。

---

### 第三组：权限

```text
Relationship
    ≠
Authorization
```

关系只是授权上下文。

Authorization 才是实际 enforcement。

---

# 一百一十五、再加上 Agent 后，应该是：

```text
Agent Membership
    ≠
Agent Authority

Agent Assignment
    ≠
Agent Ownership

Agent Delegation
    ≠
Human Role Impersonation

Agent Observation
    ≠
Full Data Access
```

这几条尤其值得写进 Agent Platform Architecture Principles。

---

# 一百一十六、最终结论

多人协作 Workflow 最容易出现的设计错误，是试图用一个：

```text
participants[]
```

解决：

```text
谁负责
谁参与
谁当前处理
谁审批
谁观察
谁可以执行
```

但这些本身是不同的业务关系。

更合理的模型是：

```text
Ownership
    → 谁对 Case 负责

Membership
    → 谁长期参与

Assignment
    → 谁当前工作

Delegation
    → 谁临时代行

Observation
    → 谁需要知道

Authorization
    → 谁现在真正能做什么
```

在 AI Agent 加入以后，这个区别更加重要。

因为 Agent 既可能：

```text
Owner
Member
Assignee
Delegate
Observer
Executor
```

但这些关系都不应该自动赋予：

```text
Business Authority
```

因此企业 Agent 最值得坚持的一条原则是：

> **Agent 可以参与 Case，但参与关系不会自动成为授权。**

进一步：

> **Ownership 表达责任，Membership 表达参与，Assignment 表达当前工作，Observer 表达关注，Authorization 才表达真正的行动权。**

再进一步：

> **Context 可以跨 Workflow Step 传播，但 Authority 应在受保护的业务边界重新计算。**

---

# 一百一十七、推荐的最终设计原则

如果要把全文压缩成平台级规范，我建议固定下面十条：

```text
1. Owner ≠ Assignee

2. Owner ≠ Admin

3. Member ≠ Permission

4. Member ≠ Assignee

5. Observer ≠ Subscriber

6. Subscriber ≠ Read Access

7. Assignment ≠ Authority

8. Delegation ≠ Ownership Transfer

9. Agent Participation ≠ Agent Authority

10. Relationship ≠ Authorization
```

然后用一个统一流程计算：

```text
Principal
   ↓
Relationship
   ↓
Role / Capability
   ↓
Resource
   ↓
Action
   ↓
Workflow Context
   ↓
Policy
   ↓
Effective Authorization
```

这套设计能够同时容纳：

```text
Human
Group
Agent
Service
```

也能够支持：

```text
Case
Workflow
Task
Approval
Review
Observation
Delegation
```

而不会让一个简单的 `participants` 字段最终变成整个企业授权系统的替代品。

---

## 参考资料

**Camunda 8 — User Tasks**
Camunda 明确区分 `assignee`、`candidateUsers`、`candidateGroups`，并支持通过任务属性和授权策略控制谁可以读取、Claim、Complete、Update User Task。([Camunda 8 Docs][4])

**Salesforce — Case Teams / Case Sharing**
Salesforce 将 Case Owner、Case Team、Team Role 和 Case Access 分开，团队成员可以被授予不同的读写级别，同时实际访问还可能受组织 Sharing Model、Role Hierarchy 和 Sharing Rule 影响。([Salesforce][1])

**Microsoft Teams — Owners and Members**
Teams 明确区分 Team Owner 与 Team Member；Owner 可以管理团队设置和成员，Member 则是参与团队的普通成员。([Microsoft Learn][10])

**Microsoft Power Automate — Flow ownership and run-only access**
Power Automate 将 Flow Owner、Co-owner 与 Run-only User 分开，Microsoft 明确建议只有真正需要维护 Flow 的用户才成为 Co-owner，其他使用者优先使用 Run-only 权限。([Microsoft Learn][14])

**ServiceNow — Assignment / Task Owner / Watch List**
ServiceNow 的任务模型明确区分 Assignment Group、Task Owner 和 Watch List；在某些 GRC Case Task 中，Owner 与 Assignment Group 是两个独立字段，Watch List 用于关注/通知。([ServiceNow][13])

**ServiceNow — Delegation / Document Access**
ServiceNow 的 Legal Matter 模型将 Matter Owner、Collaborator、Ad hoc Approver、Task Owner、Assignment Group、Watch List、Delegate 区分开，并给不同关系配置不同的文档访问范围；Delegation 到期后访问可被撤销。([ServiceNow][8])

**ServiceNow — Watch List**
Watch List 本身用于订阅记录变化；这说明 Notification Subscription 应当与业务责任关系分开。([ServiceNow][11])

**Jira — Watchers and Issue Security**
Jira Watcher 主要表达对 Issue 变化的关注，但 Watcher 仍需具备 Browse / Issue Security 等访问条件，因此 Watcher 不应简单等价为 ACL。([Atlassian Developer][7])

**AWS Step Functions — IAM / Access Control**
Step Functions 将 workflow resource 的访问控制交给 IAM，并支持基于资源和标签等条件进行更细粒度授权，说明 Workflow Ownership 与实际 Resource Authorization 应该分层。([AWS Documentation][15])

---

### 最终抽象

如果把这篇文档浓缩到你的 Agent Control Plane 体系里，我建议最终固定成：

```text
                    Relationship Model

        ┌────────────── Business Case ──────────────┐
        │                                            │
   Ownership                                    Membership
        │                                            │
 Accountable                                  Participants
        │                                            │
        └─────────────────┬──────────────────────────┘
                          │
                     Workflow Task
                          │
              ┌───────────┼───────────┐
              │           │           │
          Candidate     Assignee    Delegate
              │           │           │
              └───────────┼───────────┘
                          │
                      Observer
                          │
                    Subscription
                          │
                ──────────┼──────────
                          │
                   Authorization
                          │
                 Policy / Capability
                          │
                        Command
                          │
                        Domain
                          │
                   Business State
```

核心只有一句：

> **Relationship 告诉系统“这个人和 Case 是什么关系”；Authorization 才决定“这个人在此时此刻究竟能做什么”。**

这也是多人 Agent Workflow 不突破组织授权边界的基础。

[1]: https://help.salesforce.com/s/articleView?id=caseteam_roles.htm&language=en_US&type=5&utm_source=chatgpt.com "Create Case Team Roles | Salesforce Help"
[2]: https://www.servicenow.com/docs/r/governance-risk-compliance/privacy-workspace/prm-case-task-form.html?contentId=i5hmnXTtOkdyC~Gk7fNYSg&utm_source=chatgpt.com "Case task form"
[3]: https://help.salesforce.com/s/articleView?id=sf.managing_the_sharing_model.htm&language=en_US&type=0&utm_source=chatgpt.com "Sharing and Record Access Features | Salesforce Help"
[4]: https://docs.camunda.io/docs/components/modeler/bpmn/user-tasks/?utm_source=chatgpt.com "User tasks | Camunda 8 Docs"
[5]: https://docs.camunda.io/docs/components/admin/authorization/?utm_source=chatgpt.com "Authorizations | Camunda 8 Docs"
[6]: https://www.servicenow.com/docs/r/platform-user-interface/configure-watch-list.html?utm_source=chatgpt.com "Configure a watch list"
[7]: https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-watchers/?utm_source=chatgpt.com "The Jira Cloud platform REST API"
[8]: https://www.servicenow.com/docs/r/yokohama/employee-service-management/legal-matter-management/document-access-legal-matter.html?contentId=cdDYHjJmUZyXJTT_skL0IA&utm_source=chatgpt.com "Document access in a legal matter"
[9]: https://docs.camunda.io/docs/next/components/tasklist/user-task-authorization/?utm_source=chatgpt.com "User task authorization | Camunda 8 Docs"
[10]: https://learn.microsoft.com/en-us/microsoftteams/teams-channels-overview?utm_source=chatgpt.com "Overview of teams and channels in Microsoft Teams - Microsoft Teams | Microsoft Learn"
[11]: https://www.servicenow.com/docs/r/platform-user-interface/t_UseAWatchList.html?contentId=jZTMxM87w4RtOigl7dQ0Kg&utm_source=chatgpt.com "Add users to a watch list"
[12]: https://help.salesforce.com/s/articleView?id=cases_assign.htm&language=en_US&type=5&utm_source=chatgpt.com "Assign Cases | Salesforce Help"
[13]: https://www.servicenow.com/docs/r/governance-risk-compliance/action-task-form.html?utm_source=chatgpt.com "Create New Action task form"
[14]: https://learn.microsoft.com/en-us/power-automate/create-team-flows?utm_source=chatgpt.com "Share a cloud flow - Power Automate | Microsoft Learn"
[15]: https://docs.aws.amazon.com/step-functions/latest/dg/auth-and-access-control-sfn.html?utm_source=chatgpt.com "Identity and Access Management in Step Functions - AWS Step Functions"

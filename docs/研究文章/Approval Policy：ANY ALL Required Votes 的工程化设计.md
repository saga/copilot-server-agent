# Approval Policy：ANY / ALL / Required Votes 的工程化设计

## 一、问题：Approval Policy 不是一个 `if count > 0`

在企业 Workflow 中，最常见的 Approval Requirement 是：

```text id="fnm0pm"
ANY
ALL
2 of 3
3 of 5
67%
First responder
Sequential
```

表面上看只是几个数字。

例如：

```text id="6f2hga"
ANY
→ 1 个人批准即可

ALL
→ 所有人批准

2 of 3
→ 3 人中至少 2 人批准
```

但是一旦进入真实生产系统，很快会遇到：

```text id="y3x8be"
谁算 voter？

谁有资格投票？

一个人通过两个 Group 出现怎么办？

一票 Reject 是否立即失败？

Abstain 算不算？

超时怎么办？

Approver 不在线怎么办？

2 of 3 已经 mathematically impossible 了怎么办？

第一个 Approve 到底结束流程还是继续收集其他意见？

Approval 成功后，原始 Proposal 被修改怎么办？

Approver 在审批期间失去权限怎么办？

Maker 自己是不是 voter？

Group 动态变化后，N 是多少？

Approval Policy 修改后，已经进行的投票是否重算？
```

所以真正应该设计的不是：

```text
approvalType = "ANY"
```

而是：

> **一个明确的、版本化的 Approval Policy，以及一个可以持续计算 Policy Outcome 的 Approval Runtime。**

---

# 二、业界已经证明：Approval 本身就是一套 Voting Semantics

大型 Workflow / Business Automation 产品并没有把 Approval 简单做成一个 boolean。

Microsoft Power Automate 当前提供：

* Everyone must approve
* First to respond
* Custom Responses / Wait for all
* Custom Responses / Wait for one
* Sequential approval

其中 “Everyone must approve” 允许任意一个审批人拒绝后提前终止，而 “First to respond” 则由第一个响应直接决定结果。([learn.microsoft.com](https://learn.microsoft.com/en-us/power-automate/get-started-approvals?utm_source=chatgpt.com))

IBM Business Automation Workflow 支持：

* One
* All
* Minimum percentage
* Specific number

并且支持一个审批人拒绝就使任务进入拒绝结果。([ibm.com](https://www.ibm.com/docs/en/watsonx/wdi/2.4.x?topic=workflows-managing-governance-artifact&utm_source=chatgpt.com))

IBM Human Task 还支持：

* Percentage of workers
* One approval
* One disapproval
* Percentage of approval
* Majority reached

说明“任务什么时候结束”本身就可以是一个独立的完成条件。([ibm.com](https://www.ibm.com/docs/en/baw/24.0.x?topic=editor-completion-tab-human-task&utm_source=chatgpt.com))

Oracle Approvals Management 则把 voting regime 定义成：

* Serial Voting
* Consensus Voting
* First-Responder-Wins

并明确区分通知顺序和投票决策。([oracle.com](https://docs.oracle.com/cd/E18727-01/doc.121/e13516/T405156T405164.htm?utm_source=chatgpt.com))

ServiceNow 也提供：

* Anyone approves
* All users approve
* All responded and anyone approves
* Percentage
* Specific number

这些模式。([servicenow.com](https://www.servicenow.com/community/workflow-automation-blogs/scripted-approvals-in-flow-designer-with-flow-variables/ba-p/2284506?utm_source=chatgpt.com))

因此：

> **Approval Policy 本质上已经是一个小型的 Voting / Decision Engine。**

---

# 三、不要把 Approval Policy 设计成一个 Enum

最早期很容易设计：

```json id="oy76ft"
{
  "approvalType": "ALL"
}
```

然后：

```text id="f9z1y0"
ANY
ALL
COUNT
PERCENTAGE
```

继续增加：

```text id="wzj829"
MAJORITY
SEQUENTIAL
FIRST_RESPONDER
```

很快变成一个巨大的 Enum。

问题在于：

```text id="jvwb25"
ANY
```

到底是什么意思？

可能是：

```text id="c7fwd8"
任何一个人批准
```

也可能是：

```text id="a7mrxx"
任何一个人响应
```

还可能是：

```text id="ckq5b4"
任何一个人批准则成功，
任何一个人拒绝则失败
```

三种完全不同的语义。

因此不推荐：

```text id="ml9i0b"
approvalType = ANY
```

而建议把 Policy 分解成：

```text id="l10q78"
Eligible Voters
+
Collection Rule
+
Approval Threshold
+
Rejection Rule
+
Completion Rule
+
Timeout Rule
+
Escalation Rule
```

---

# 四、一个统一的 Approval Policy 模型

建议：

```text id="9drjm4"
ApprovalPolicy
{
  voterDefinition
  votingMode
  approvalRule
  rejectionRule
  completionRule
  timeoutRule
  escalationRule
  scope
  version
}
```

例如：

```json id="u10f2j"
{
  "voterDefinition": {
    "source": "ROLE",
    "role": "PORTFOLIO_MANAGER"
  },

  "votingMode": "PARALLEL",

  "approvalRule": {
    "type": "COUNT",
    "required": 2
  },

  "rejectionRule": {
    "type": "ANY_REJECT"
  },

  "completionRule": {
    "type": "EARLY_DECISION"
  }
}
```

这比：

```text
approvalType = "2_OF_3"
```

更适合长期演进。

---

# 五、第一步：先确定“谁有资格投票”

这是所有 Approval Policy 中最重要、也最容易被忽略的一步。

必须先计算：

```text id="g2q7e5"
Eligible Voters
```

之后才能讨论：

```text id="m7s7sf"
ANY
ALL
2 of N
```

例如：

```text id="2e6w5v"
Portfolio Managers:
Alice
Bob
Carol
```

那么：

```text id="8zv0c7"
N = 3
```

但如果：

```text id="7g0qjn"
Alice = Maker
```

同时 Policy 又规定：

```text id="3iijcc"
Maker cannot approve own proposal
```

那么：

```text id="d5n6d3"
Eligible Voters = Bob, Carol
N = 2
```

因此：

> **N 不是一个固定配置值，它应该由 voter resolution 计算出来。**

---

# 六、Voter Resolution 与 Voting Rule 必须分开

不要：

```text id="i6dr4j"
2 of 3
```

直接进入 Voting Engine。

应该：

```text id="ckcp9p"
Approval Request
      ↓
Resolve Eligible Voters
      ↓
Voter Set
      ↓
Apply Voting Rule
```

例如：

```text id="mo0pyd"
Policy:
2 approvals required
```

运行时：

```text id="g1cfnb"
Resolved voters:
Alice
Bob
Carol
Dave
```

这时真正的 Policy 就是：

```text id="r8i5al"
2 of 4
```

而不是：

```text id="8q1j1m"
2 of 3
```

因此应该记录：

```text id="3b1n5s"
policy version
voter snapshot
resolved voter count
```

---

# 七、为什么不能简单实时重新计算 N？

假设：

```text id="fxe8bm"
10:00

Approvers:
Alice
Bob
Carol
```

那么：

```text id="wqaxl0"
2 of 3
```

11:00：

```text id="9j1d6f"
Bob leaves the department
```

如果系统动态重新计算：

```text id="p9t8f7"
2 of 2
```

原本：

```text id="q3a9ec"
Alice + Bob
```

已经满足：

```text id="l8vkkc"
2 of 3
```

但现在：

```text id="k6y6b1"
2 of 2
```

又不满足。

这会导致已经完成的 Approval 状态发生反事实变化。

因此对金融、高风险 Workflow：

> **Approval 应该绑定一个明确的 voter snapshot，或者明确规定何时重新解析 voter set。**

不应该让 N 随组织目录变化而无声变化。

---

# 八、两种合法策略：Snapshot 与 Dynamic

## Snapshot

Approval 创建时：

```text id="h12h89"
Resolve voters
    ↓
Freeze voter set
```

例如：

```text id="m80e8e"
Voters:
Alice
Bob
Carol
```

之后组织变化不改变本次 Approval 的 voter set。

优点：

```text id="qg9a5z"
可审计
可重建
行为稳定
```

缺点：

```text id="3v1j49"
人员离职 / 禁用后需要处理
```

---

## Dynamic

每次重新评估：

```text id="ofhuw5"
Eligible Voters
```

优点：

```text id="v7f7x1"
实时反映组织变化
```

缺点：

```text id="v14t8q"
Approval Outcome 可能随着人员变化发生变化
```

在金融生产 Approval 中，更适合：

> **Approval Instance 使用 Snapshot，下一次新的 Approval 根据最新组织状态重新 Resolve。**

---

# 九、ANY 到底应该是什么意思？

建议不要只定义：

```text id="84yq4q"
ANY
```

而至少区分：

### ANY_APPROVE

```text id="iu9xxh"
任何一个有效 Approver approve
→ APPROVED
```

### ANY_RESPOND

```text id="0gpig0"
任何一个有效 Approver first response
→ 该 response 决定 outcome
```

### ANY_REJECT_FAIL

```text id="3s1dmg"
任何一个 Approver reject
→ REJECTED
```

### FIRST_RESPONSE

```text id="9z9ziu"
第一条有效响应
→ terminal outcome
```

Microsoft Power Automate 的 “First to respond” 属于最后一种：第一个 Approver 的批准或拒绝都会结束审批。([learn.microsoft.com](https://learn.microsoft.com/en-us/power-automate/get-started-approvals?utm_source=chatgpt.com))

而 “any approves” 可以是另一种：

```text id="jz1x6h"
任意一人批准即可
```

这时其他人的 Reject 是否立即失败，需要另行定义。

---

# 十、ALL 也不只是“所有人 Approve”

一个常见误解是：

```text id="1l4t1f"
ALL
=
所有人 Approve
```

但通常还需要定义：

```text id="8p0nvl"
如果其中一人 Reject 怎么办？
```

常见策略有两种。

### ALL + FAIL_ON_ANY_REJECT

```text id="9fd0u5"
A Approve
B Approve
C Reject

→ REJECTED
```

Microsoft Power Automate 的 “Everyone must approve” 就是这种语义：所有人必须响应，而单个 rejection 可以终止流程。([learn.microsoft.com](https://learn.microsoft.com/en-us/power-automate/get-started-approvals?utm_source=chatgpt.com))

### ALL + COLLECT_ALL

```text id="w4hlqk"
A Approve
B Approve
C Reject
```

继续收集所有人响应，最终统一得到：

```text id="3g4g4f"
REJECTED
```

后者在需要完整审计 / 收集意见时有价值。

所以：

> **Approval Threshold 与 Rejection Policy 是两个独立概念。**

---

# 十一、Required Votes：真正应该成为核心原语

与其设计：

```text id="u9nptf"
ANY
ALL
2_OF_3
3_OF_5
```

更推荐定义：

```text id="j6y02t"
requiredApproveCount = K
eligibleVoterCount = N
```

然后：

```text id="w3h2nn"
ANY
    = K = 1

ALL
    = K = N

2_OF_3
    = K = 2

3_OF_5
    = K = 3
```

这样：

```text id="7a3j1o"
ANY / ALL
```

只是：

> Required Votes 的特殊情况。

这会让 Runtime 大幅简单。

---

# 十二、Percentage 也可以统一到 Required Votes

如果：

```text id="s3ih10"
N = 5
required percentage = 60%
```

那么：

```text id="g5ftm9"
requiredVotes = ceil(5 × 0.60)
             = 3
```

如果：

```text id="n7rs1g"
N = 6
60%
```

则：

```text id="k3v0q9"
ceil(3.6) = 4
```

但是必须明确：

> 百分比基于谁？

可能是：

```text id="wyyvde"
eligible voters
all assigned voters
responded voters
```

三种结果完全不同。

IBM 当前就区分 minimum percentage of assignees 与 percentage of approval responders 等不同完成条件。([ibm.com](https://www.ibm.com/docs/en/watsonx/wdi/2.4.x?topic=workflows-managing-governance-artifact&utm_source=chatgpt.com))

---

# 十三、强烈建议不要使用“Percentage of Responses”作为默认 Approval 语义

例如：

```text id="byf2rh"
5 voters
```

只来了：

```text id="2s1o72"
3 responses
```

其中：

```text id="vufk6h"
2 approve
1 reject
```

如果规则：

```text id="m2sdy8"
50% of responses approve
```

就会：

```text id="i5zf8n"
2/3 > 50%
→ approved
```

但实际上：

```text id="l0yrdu"
2/5
```

未必符合业务的审批要求。

因此必须明确：

```text id="hjpq2c"
denominator
```

推荐明确字段：

```text id="foofxj"
thresholdBase:
  ELIGIBLE_VOTERS
  RESPONDED_VOTERS
```

金融 Approval 更常见的是：

> **基于 Eligible Voters，而不是已经响应的人。**

---

# 十四、Required Votes 最重要的数学问题：Impossibility

假设：

```text id="d2q37h"
N = 5
K = 4
```

已经：

```text id="fh9l0v"
1 Reject
```

那么即使剩余所有人都 Approve：

```text id="ck5soj"
Maximum approvals = 4
```

理论上仍然可能通过。

但如果已经：

```text id="6q6f4x"
2 Reject
```

那么：

```text id="g1qbt4"
Maximum approvals = 3
```

而：

```text id="x7bn2w"
K = 4
```

所以：

```text id="j6m3e9"
Approval is mathematically impossible.
```

Runtime 应立即：

```text id="r7efox"
REJECTED
```

或者：

```text id="9acwfa"
NEEDS_RECONFIGURATION
```

而不是：

```text id="3g1xet"
一直等待剩余三个人。
```

这是 Approval Engine 必须实现的核心逻辑。

---

# 十五、Approval Runtime 应该持续计算三个数

至少：

```text id="c8nvqf"
A = Approve count
R = Reject count
P = Pending count
```

并且：

```text id="4qj9s1"
A + R + P = N
```

对：

```text id="K = required approvals"
```

计算：

```text id="nm2r7w"
if A >= K:
    APPROVED

if A + P < K:
    REJECTED
```

这两个条件就是 Required Votes 的核心。

例如：

```text id="0fljup"
N = 5
K = 3

A = 3
R = 0
P = 2

→ APPROVED
```

或者：

```text id="2h3zga"
A = 1
R = 2
P = 2

Maximum approvals = 3
K = 3

→ still possible
```

但是：

```text id="3v4k0i"
A = 1
R = 3
P = 1

Maximum approvals = 2
K = 3

→ impossible
```

应立即停止等待。

---

# 十六、这比“等所有人回答再 count”重要得多

一个简单但低效的实现：

```text id="0myvco"
Send 5 approvals

Wait all 5

Count approvals

Decide
```

问题：

```text id="4ixdeq"
不必要等待
无法及时失败
浪费通知
无法及时 escalation
```

成熟 Approval Runtime 应该是：

```text id="f7w9x4"
Vote arrives
    ↓
Recalculate
    ↓
Can approve?
    ↓
Yes → finish

Can approve become impossible?
    ↓
Yes → reject / stop

Otherwise
    ↓
wait
```

这和 IBM / Microsoft 等系统对“满足条件后立即结束”的能力是相符的。IBM 明确支持在达到 percentage、one approval、one disapproval、majority 等条件后结束 Human Task。([ibm.com](https://www.ibm.com/docs/en/baw/24.0.x?topic=editor-completion-tab-human-task&utm_source=chatgpt.com))

---

# 十七、Required Votes 不应该忽略 Reject

这是另一个常见错误。

很多人只写：

```text id="0w9qxr"
approvedCount >= K
```

但没有定义：

```text id="wtxq2i"
Reject
```

至少要支持：

```text id="q5xcza"
Reject Mode
```

常见模式：

### ANY_REJECT

```text id="wi2b1z"
R >= 1
→ REJECT
```

### REJECT_THRESHOLD

```text id="qkkpjm"
R >= R_required
→ REJECT
```

### NO_REJECT

```text id="xrj2xd"
Only approval threshold matters
```

这适合：

```text id="q6j5y7"
vote / election
```

而不是：

```text id="1rw6vz"
strict approval
```

所以：

> **Approval threshold 和 Rejection threshold 应该是两个独立参数。**

---

# 十八、支持“2 Approvals + No Reject”与“2 Approvals + Any Reject”两种完全不同的业务

例如：

```text id="9jypbs"
K = 2
N = 3
```

### Strict Approval

```text id="4d4t0j"
2 approvals required
any rejection = reject
```

结果：

```text id="h50a0d"
A=2 R=1
→ REJECT
```

### Quorum Vote

```text id="6xd4bx"
2 approvals required
rejection is just another vote
```

结果：

```text id="o95l3g"
A=2 R=1
→ APPROVE
```

这两个业务完全不同。

因此不要把：

```text id="s9pjtq"
"2 of 3"
```

当成完整 Policy。

---

# 十九、Approval 与 Voting 是两个不同模型

这是一个非常重要的抽象。

## Approval

典型：

```text id="s9oyc3"
A = approve
R = reject
```

目标：

> 判断一个 Proposed Action 是否放行。

通常：

```text id="6hvxmm"
Reject
```

具有较强终止性。

---

## Voting

例如委员会决定：

```text id="cfkxqj"
Option A
Option B
Option C
```

这里不是：

```text id="APPROVE / REJECT"
```

而是：

```text id="4ov1qp"
Vote(option)
```

然后：

```text id="lp06l7"
plurality
majority
supermajority
runoff
```

等规则决定 Outcome。

因此：

> **不要把所有多人 Decision 都建模成 Approval。**

但 Approval Runtime 可以复用 Voting Engine 的计票基础设施。

---

# 二十、如果确实是“Required Votes”，建议把 Vote 与 Decision 分开

可以：

```json id="f9f9l7"
{
  "vote": {
    "voter": "alice",
    "value": "APPROVE",
    "timestamp": "..."
  },

  "decision": {
    "requiredApprovals": 2
  }
}
```

而不要直接：

```text id="kn38ux"
approval.status = approved
```

因为 Decision 是：

```text id="jy6hko"
derived state
```

Vote 是：

```text id="d0q6lb"
source event
```

---

# 二十一、Approval Result 最好是计算结果，而不是人工写入

建议：

```text id="nkj4l6"
Vote Events
    ↓
Approval Policy
    ↓
Derived Decision
```

例如：

```text id="sjgx0e"
Votes:
A = APPROVE
B = APPROVE
C = REJECT
```

Policy：

```text id="d19uj5"
ANY_REJECT
```

Derived Result：

```text id="8ie8f3"
REJECTED
```

不要让某个 API 直接：

```text id="3cxw5i"
setApprovalStatus("APPROVED")
```

否则：

```text id="xg7q9c"
Policy
```

和：

```text id="3qg08a"
Status
```

可能出现不一致。

---

# 二十二、建议使用 Event-based Vote Ledger

例如：

```text id="3kwj1a"
ApprovalInstance = AP-1024
```

Vote Events：

```text id="3jhwr9"
VOTE_CAST
VOTE_REVOKED
VOTE_INVALIDATED
VOTE_RECAST
```

每个事件：

```text id="xm7si7"
approvalId
voter
vote
timestamp
policyVersion
scopeHash
```

最终由 Runtime 得到：

```text id="qnct5l"
current voting state
```

这会比直接修改：

```text id="voter.approved = true"
```

更适合：

```text id="s8loqy"
audit
replay
incident investigation
```

---

# 二十三、一个 Vote 必须绑定 Proposal Scope

例如：

```text id="8p4y2z"
Proposal A
```

Bob：

```text id="f8asjh"
APPROVE
```

之后：

```text id="03tdoz"
Proposal A
```

变成：

```text id="Proposal A v2"
```

那么 Bob 原来的 Vote 是否仍然有效？

默认应该：

```text id="6fiv33"
NO
```

除非 Policy 明确允许。

因此：

```text id="s6c9l8"
Vote
    ↓
Proposal Version / Scope
```

必须绑定。

这与前面的 Approval Scope / Proposal Version 直接相关。

---

# 二十四、建议 Approval Policy 至少包含 Scope Fingerprint

例如：

```text id="us2k5k"
scopeHash
```

由：

```text id="y4x2ux"
Proposal ID
Version
Parameters
Resource
Action
```

共同计算。

Approval 时：

```text id="2j8uaw"
approvedScopeHash = H1
```

执行时：

```text id="l42hrp"
command.scopeHash = H1
```

才能：

```text id="xv8qmg"
execute
```

如果：

```text id="s9bwtl"
H2 != H1
```

则：

```text id="q1sw6s"
re-approval required
```

---

# 二十五、Approval Policy 本身必须版本化

例如：

```text id="wqb2ji"
Policy V1:
2 of 3

Policy V2:
3 of 4
```

已有 Approval：

```text id="zk0dg3"
created under V1
```

组织切换到：

```text id="m0x4mq"
V2
```

是否重新计算？

不能让 Runtime 自己猜。

应该定义：

```text id="v3xwta"
policyBinding:
  SNAPSHOT
  LIVE
```

对于金融高风险 Approval：

> 更推荐 Approval Instance 固定 Policy Version。

---

# 二十六、为什么 Policy Snapshot 对审计非常重要

事后需要回答：

> 为什么这个 Approval 在当时是通过的？

如果只知道：

```text id="qjs0ox"
currentPolicy = 3-of-5
```

却不知道：

```text id="j3ta0a"
当时其实使用的是 2-of-3
```

就无法重建决策。

所以 Audit 应记录：

```text id="a9cjhx"
approvalPolicyId
policyVersion
resolvedVoters
requiredVotes
rejectionRule
timeoutRule
scopeHash
```

---

# 二十七、ANY / ALL / K-of-N 可以统一成一个数学模型

设：

```text id="3d0jnp"
N = eligible voters

A = approvals
R = rejections
P = pending
```

满足：

```text id="m3zryc"
A + R + P = N
```

定义：

```text id="0x8n3u"
K = required approval count
```

基本规则：

```text id="xg4d7x"
APPROVED:
    A >= K

IMPOSSIBLE:
    A + P < K
```

如果要求：

```text id="r7bqtc"
any reject → reject
```

增加：

```text id="0xw3ip"
REJECTED:
    R >= 1
```

如果：

```text id="9r9kwb"
reject threshold = J
```

则：

```text id="c06dgu"
REJECTED:
    R >= J
```

这就是一个真正可以实现的 Approval Engine 核心。

---

# 二十八、ANY 与 ALL 只是 K 的两个边界

```text id="9br0p1"
ANY:
K = 1

ALL:
K = N
```

例如：

```text id="jpovvl"
N = 5

ANY → K=1
2-of-5 → K=2
3-of-5 → K=3
4-of-5 → K=4
ALL → K=5
```

这样 Approval Engine 根本不需要五种不同算法。

只有：

```text id="61b7zv"
same counting engine
+
different policy parameters
```

---

# 二十九、First Responder 是另一种算法

它不能简单映射成：

```text id="3ced0v"
K = 1
```

因为：

```text id="tqxrf6"
K=1
```

通常意味着：

> 任何一个 Approve 都可以完成。

而 First Responder 意味：

> 第一条有效响应决定最终结果，无论是 Approve 还是 Reject。

Oracle 和 Microsoft 都把 First Responder 作为独立 voting mode。([docs.oracle.com](https://docs.oracle.com/cd/E18727-01/doc.121/e13516/T405156T405164.htm?utm_source=chatgpt.com)) ([learn.microsoft.com](https://learn.microsoft.com/en-us/power-automate/get-started-approvals?utm_source=chatgpt.com))

所以：

```text id="ro9s2b"
FIRST_RESPONSE
```

应该是：

```text id="ep2qj7"
terminalOnFirstResponse = true
```

而不是：

```text id="a9s2o3"
requiredApprovals = 1
```

---

# 三十、Sequential Approval 也不是 K-of-N

例如：

```text id="7hb1mf"
Alice
 ↓
Bob
 ↓
Carol
```

这里：

```text id="r9l22p"
K = 3
```

并不能表达：

```text id="d4u2e8"
Bob cannot approve until Alice approves.
```

所以：

```text id="y03h9w"
Voting Mode
```

应该至少支持：

```text id="wjrkkx"
PARALLEL
SEQUENTIAL
FIRST_RESPONSE
```

然后：

```text id="v2w3d1"
Parallel + K-of-N
```

是最常见的组合。

Microsoft 和 Oracle 都明确区分 Parallel / Sequential 与具体 voting regime。([learn.microsoft.com](https://learn.microsoft.com/en-us/power-automate/get-started-approvals?utm_source=chatgpt.com)) ([docs.oracle.com](https://docs.oracle.com/en/cloud/saas/procurement/25c/oapro/approval-task.html?utm_source=chatgpt.com))

---

# 三十一、建议把 Routing 与 Voting 完全分离

这是 Approval Engine 的重要抽象：

```text id="c03ql8"
Routing
    = 谁什么时候收到 Approval

Voting
    = 这些人如何共同决定结果
```

例如：

```text id="r7b8w1"
Routing:
Parallel

Voting:
2 of 3
```

或者：

```text id="1q3cr0"
Routing:
Sequential

Voting:
All
```

或者：

```text id="7k6w0f"
Routing:
Parallel

Voting:
First Responder
```

Oracle 当前就是这种结构：Participant 定义 routing type 和 voting regime，两者是不同属性。([docs.oracle.com](https://docs.oracle.com/en/cloud/saas/procurement/25c/oapro/approval-task.html?utm_source=chatgpt.com))

---

# 三十二、Approval Policy 应该先定义 Voter，再定义 Routing，再定义 Decision

推荐：

```text id="3k4jwg"
1. Resolve Voters

2. Route Approval

3. Collect Votes

4. Evaluate Policy

5. Emit Outcome

6. Apply Workflow Effect
```

完整：

```text id="j0r7wx"
Business Object
    ↓
Approval Rule
    ↓
Eligible Voters
    ↓
Routing
    ↓
Vote Collection
    ↓
Approval Policy
    ↓
Decision
    ↓
Authorization
    ↓
Command / Transition
```

这比：

```text id="c93l2j"
Send Approval
```

要完整得多。

---

# 三十三、Required Votes 不应该和“必须响应人数”混为一谈

例如：

```text id="3ad0f8"
5 voters
K = 3
```

可能要求：

```text id="g5jvra"
3 approvals
```

但不一定要求：

```text id="ax1k11"
5 people all respond
```

因为：

```text id="8s00np"
A=3
R=0
P=2
```

已经可以：

```text id="odgqjt"
APPROVED
```

所以：

```text id="50qwjx"
required approval count
```

和：

```text id="on4n73"
required response count
```

是两个不同参数。

---

# 三十四、这也是“ANY / ALL”最容易产生歧义的地方

“ALL”通常意味着：

```text id="xodq96"
ALL VOTERS must respond
```

但业务可能真正需要：

```text id="rx1czx"
ALL VOTERS must approve
```

区别在于：

```text id="jkkmyw"
A approve
B reject
C pending
```

前者可能：

```text id="5mq8ft"
still pending
```

后者：

```text id="1i5n7x"
immediately rejected
```

所以建议不要只存：

```text id="l3b4qw"
mode = ALL
```

而要明确：

```text id="n9tp9m"
responseRequirement
approvalRequirement
rejectionRule
```

---

# 三十五、Recommended Policy Schema

可以定义：

```json id="7y2xtd"
{
  "policyId": "INV-COMMITTEE-APPROVAL",
  "version": 3,

  "voters": {
    "source": "APPROVAL_GROUP",
    "group": "investment-committee",
    "resolution": "SNAPSHOT"
  },

  "routing": {
    "mode": "PARALLEL"
  },

  "decision": {
    "approval": {
      "type": "COUNT",
      "required": 3
    },

    "rejection": {
      "type": "ANY"
    },

    "abstention": {
      "type": "NEUTRAL"
    },

    "earlyTermination": true
  },

  "timeout": {
    "duration": "48h",
    "onTimeout": "ESCALATE"
  },

  "scope": {
    "proposalVersion": "v7",
    "scopeHash": "..."
  }
}
```

这个模型已经可以表达大量企业审批需求。

---

# 三十六、Abstain 应该是一个显式值

很多 Approval 系统只有：

```text id="mq5h54"
APPROVE
REJECT
```

但委员会 / Governance 场景经常需要：

```text id="1e4tni"
ABSTAIN
```

例如：

```text id="5jtyam"
Conflict of Interest
```

一个成员：

```text id="fj10ds"
ABSTAIN
```

那么：

```text id="b6jyrs"
A + R + Abstain + Pending = N
```

必须定义：

```text id="h13asv"
Abstain:
  counts toward response?
  counts toward rejection?
  removed from denominator?
```

不同政策可能不同。

因此不要硬编码。

---

# 三十七、Abstain 有三种合理语义

### 语义一：Neutral Vote

```text id="zsm8sr"
ABSTAIN
```

相当于：

```text id="bohuy8"
not approve
not reject
```

但仍然属于有效 response。

---

### 语义二：Exclude from Quorum

```text id="ti4uh3"
ABSTAIN
```

从 denominator 中移除。

例如：

```text id="W4"
A approve
B approve
C abstain
D pending
```

有效人数：

```text id="nczluy"
3
```

---

### 语义三：Equivalent to Reject

某些严格业务规则可能要求：

```text id="l3nsah"
ABSTAIN = not approved
```

不推荐平台默认采用，但应该允许 Policy 明确指定。

---

# 三十八、Conflicted Voter 不应该简单等于 Abstain

例如：

```text id="l4dgn7"
Conflict of Interest
```

用户可能：

```text id="rsxqi8"
无法投票
```

这可能属于：

```text id="ej1tmf"
VOTER_INELIGIBLE
```

而不是：

```text id="meqjoc"
ABSTAIN
```

因为 Conflict 可能意味着：

> 这个人的投票资格从一开始就应该被排除。

这又回到了：

```text id="5qvn6t"
Eligible Voter Resolution
```

所以：

> **投票期间的 Abstain 和投票前的 Eligibility 是不同概念。**

---

# 三十九、Maker-Checker 可以表达成 voter eligibility constraint

例如：

```text id="a0t0we"
Maker = Alice
```

Policy：

```text id="z4z5d4"
checkerMustDiffer = true
```

那么：

```text id="po2n7z"
EligibleVoters
=
ResolvedApprovers
-
Maker
```

这比：

```text id="if voter == maker reject"
```

更干净。

同时应该审计：

```text id="9v7z20"
makerId
resolvedVoters
excludedVoters
exclusionReason
```

---

# 四十、Required Votes 与 Maker-Checker 可以自然组合

例如：

```text id="so1btm"
5 committee members

Maker excluded

Remaining = 4

Required = 2

Any reject = reject
```

那么：

```text id="sl13is"
2-of-4
+
Maker Exclusion
+
Any Reject
```

是一个合法 Policy。

不要为这种组合创建：

```text id="ps31m1"
SPECIAL_APPROVAL_TYPE_42
```

这就是参数化 Policy 的价值。

---

# 四十一、Required Votes 与 Four-Eyes Principle

金融领域尤其需要区分：

```text id="q5p0q5"
2 approvals
```

与：

```text id="l0ngvk"
Two independent persons
```

后者更强。

Basel Core Principles 将 checks and balances / four-eyes principle 与 segregation of duties、cross-checking、dual control 和 double signatures 联系起来，并强调关键职能之间应有适当分离。([bis.org](https://www.bis.org/committees/bcbs/basel-framework/standard/bcp/40/inforce/2024-04-25/published/2024-04-25))

因此：

```text id="b4r1t5"
2 of 3
```

不自动意味着：

```text id="4ojy5y"
Four-eyes
```

因为 3 人可能：

```text id="kdca9s"
all same role
same team
same authority
same conflict
```

所以 Financial Approval Policy 应支持：

```text id="bcsl4j"
Required distinct roles
Required distinct groups
Required independence
```

---

# 四十二、因此“Required Votes”最好支持身份约束

例如：

```json id="n7l6ib"
{
  "requiredApprovals": 2,

  "independence": {
    "differentFromMaker": true,
    "distinctRoles": true,
    "distinctGroups": true
  }
}
```

或者：

```text id="dlsc7q"
1 × Portfolio Manager
+
1 × Compliance Officer
```

而不是简单：

```text id="j2b1h6"
2 votes
```

这是金融场景非常重要的升级。

---

# 四十三、Approval Policy 应该支持“Role Quorum”

例如：

```text id="6iwc3d"
Required:
PM >= 1
Compliance >= 1
```

可以表示：

```text id="3x1viy"
AND(
  COUNT(role=PM, APPROVE) >= 1,
  COUNT(role=COMPLIANCE, APPROVE) >= 1
)
```

又可以：

```text id="s99jjs"
COUNT(
    APPROVE
) >= 3
```

这样就有：

```text id="p2z9as"
Role Quorum
+
Total Quorum
```

---

# 四十四、Role Quorum 比简单 K-of-N 更适合金融业务

例如：

```text id="95niq8"
3 of 5
```

可能被 3 个：

```text id="2dz3n7"
Portfolio Managers
```

批准。

但业务实际要求：

```text id="w5vpk7"
1 PM
1 Compliance
1 Risk
```

那么：

```text id="qv96hb"
3-of-5
```

是不够的。

更准确：

```text id="f3rdwq"
Role-based quorum
```

---

# 四十五、推荐支持布尔 Policy Expression

例如：

```text id="w4ovdx"
AND(
  COUNT(APPROVE) >= 2,
  COUNT(APPROVE WHERE role=Compliance) >= 1,
  COUNT(APPROVE WHERE role=PM) >= 1,
  COUNT(REJECT) = 0
)
```

或者：

```text id="jvvmku"
OR(
  COUNT(APPROVE WHERE role=IC_CHAIR) >= 1,
  COUNT(APPROVE) >= 3
)
```

但不要一开始就做成任意脚本语言。

第一阶段推荐结构化 DSL。

---

# 四十六、为什么不应该直接允许任意 JavaScript 表达式？

例如：

```text id="mt8w9b"
evaluate("some arbitrary JavaScript")
```

看起来灵活。

但会带来：

```text id="sawwmf"
Security
Determinism
Versioning
Sandboxing
Explainability
Testing
Audit
```

问题。

更好的：

```text id="0p5qdc"
Typed Approval DSL
```

例如：

```text id="rfl0m8"
COUNT
PERCENT
ANY
ALL
ROLE
GROUP
AND
OR
NOT
```

这样可以：

```text id="f9jz06"
parse
validate
compile
simulate
audit
```

---

# 四十七、Approval Policy DSL 可以非常简单

例如：

```text id="hi9vtw"
ALL(
    APPROVE(role=PM) >= 1,
    APPROVE(role=COMPLIANCE) >= 1
)
```

或者：

```text id="j0sbyr"
COUNT(APPROVE) >= 2
AND COUNT(REJECT) = 0
```

或者：

```text id="x4x2ie"
ANY(
    APPROVE(role=IC_CHAIR) >= 1,
    COUNT(APPROVE) >= 3
)
```

然后编译成：

```text id="dtyo7z"
Policy AST
```

Runtime 只执行受限 AST。

---

# 四十八、Policy Validation 在部署时就应该运行

例如 Policy：

```text id="f6soq7"
3 approvals required
```

Voters：

```text id="0l7f3e"
2 eligible voters
```

应该直接：

```text id="8e0bkj"
INVALID POLICY
```

而不是等 Runtime 启动后永久等待。

IBM 文档甚至明确提示：如果指定的 approval number 大于 assignee 数量，Workflow 无法获得批准，即使所有人都 approve。([ibm.com](https://www.ibm.com/docs/en/watsonx/wdi/2.4.x?topic=workflows-managing-governance-artifact&utm_source=chatgpt.com))

因此：

> **Approval Policy 必须有静态可验证性。**

---

# 四十九、Policy Validator 至少检查以下条件

```text id="d3ifdl"
requiredVotes >= 1

requiredVotes <= eligibleVoterUpperBound

requiredPercentage between 0 and 100

role quorum <= available role voters

maker exclusion does not make quorum impossible

sequential chain is non-empty

timeout policy exists

escalation path exists

approval scope exists
```

如果存在：

```text id="89hqju"
K > N
```

必须拒绝部署。

---

# 五十、Runtime 还要检查“动态不可能”

即使：

```text id="a4e1vo"
K <= N
```

运行时依然可能变成：

```text id="3m5u2n"
A + P < K
```

例如：

```text id="46ulfb"
N=5
K=4

A=1
R=3
P=1
```

此时：

```text id="3lwyq4"
1+1 <4
```

已经不可能。

应该即时结束。

---

# 五十一、Timeout 必须成为 Policy 的一部分

Approval 永远等待：

```text id="jbsf0r"
not acceptable
```

应该定义：

```text id="zq9z70"
timeout:
  duration
  onTimeout
```

例如：

```text id="qgzf47"
48h
→ ESCALATE
```

或者：

```text id="8yp4pu"
24h
→ REJECT
```

或者：

```text id="a3m1sb"
24h
→ ASSIGN_DELEGATE
```

AWS 当前的 HITL guidance 明确强调 timeout 和 escalation path，否则人不可用可能让 Agent / Workflow 无限暂停。([docs.aws.amazon.com](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentsec04-bp02.html?utm_source=chatgpt.com))

---

# 五十二、Timeout 不应该简单等于 Reject

例如：

```text id="z1n7q4"
Approval:
2 of 3

48h:
1 approve
1 pending
1 reject
```

Timeout 可以：

```text id="1qz8e5"
REJECT
```

也可能：

```text id="5h14mg"
ESCALATE
```

甚至：

```text id="h3q4lm"
REASSIGN_PENDING_VOTER
```

因此：

```text id="nw7nf4"
Timeout Outcome
```

是 Policy 的独立部分。

---

# 五十三、Escalation 不应该创造新的 Approval Scope

例如：

```text id="2kyk8i"
Original:
PM approves <= 10M
```

Timeout：

```text id="0th8kw"
Escalate to Senior PM
```

并不意味着：

```text id="y1j0w8"
Senior PM can approve everything.
```

Escalation 应该：

```text id="n9z2v2"
preserve original scope
```

或者显式：

```text id="xpxh8b"
new authority scope
```

---

# 五十四、Required Votes 与 Sequential Routing

例如：

```text id="8z3h2d"
3 approvals required
```

但要求：

```text id="b9db5y"
PM
 ↓
Director
 ↓
Committee
```

此时：

```text id="1n5u7u"
K=3
```

并不能表达全部规则。

应明确：

```text id="pg4n8l"
Routing = SEQUENTIAL
Voting = ALL
```

或者：

```text id="yl0d3f"
Stage 1:
1 PM

Stage 2:
1 Director

Stage 3:
2 of Committee
```

这也是 Oracle 对 routing type / voting regime 分离的意义。([docs.oracle.com](https://docs.oracle.com/en/cloud/saas/procurement/25c/oapro/approval-task.html?utm_source=chatgpt.com))

---

# 五十五、Approval Stage 是另一个非常有用的抽象

复杂金融审批不要只定义：

```text id="csq6iz"
voters
```

可以定义：

```text id="00bkow"
Approval Stage
```

例如：

```text id="lqu9pm"
Stage 1:
Analyst Review

Stage 2:
Compliance
    ALL

Stage 3:
Investment Committee
    2 of 3

Stage 4:
Operations Release
    1 designated approver
```

然后：

```text id="ws5q4b"
Stage 1
   ↓
Stage 2
   ↓
Stage 3
   ↓
Stage 4
```

或部分并行：

```text id="5pddzu"
        ┌── Risk Review ──┐
Proposal┤                 ├── Committee
        └── Legal Review ─┘
```

IBM、Oracle 等企业 Workflow 产品都有类似的 stage / participant / serial / parallel 概念。([ibm.com](https://www.ibm.com/docs/en/watsonx/wdi/2.4.x?topic=workflows-managing-governance-artifact&utm_source=chatgpt.com)) ([docs.oracle.com](https://docs.oracle.com/en/cloud/saas/procurement/25c/oapro/various-aspects-of-approval-rules.html?utm_source=chatgpt.com))

---

# 五十六、Approval Policy 最终应该形成 Policy Graph

复杂场景可以：

```text id="qoxz2a"
Approval Policy
       │
       ├── Stage 1
       │      └── ALL
       │
       ├── Stage 2
       │      ├── Compliance = 1
       │      └── Risk = 1
       │
       └── Stage 3
              └── 2 of 3
```

这比一个：

```text id="4pdn4h"
approval_type
```

表达能力强很多。

---

# 五十七、审批阶段之间也需要定义 Failure Propagation

例如：

```text id="9qqp83"
Stage 1 rejected
```

是否：

```text id="k6d9q5"
整个 Approval failed
```

通常是：

```text id="yxh8cl"
YES
```

但某些业务可能：

```text id="4exf4v"
进入 Exception
```

或者：

```text id="o9qmhh"
Return for Revision
```

因此 Stage 也应该有：

```text id="gphk2f"
onApproved
onRejected
onTimeout
onEscalated
```

---

# 五十八、Vote Revoke / Change 是非常容易漏掉的功能

例如：

```text id="ahp5tu"
Bob approved at 10:00
```

然后：

```text id="2l6tw9"
Bob discovers new information at 10:15
```

是否允许：

```text id="v5sjst"
withdraw approval
```

这需要 Policy 明确。

常见模式：

```text id="8zhq4j"
IMMUTABLE
```

一旦提交不能变。

或者：

```text id="cwr3fo"
REVOCABLE_UNTIL_DECISION
```

或者：

```text id="m9k5oc"
REVOCABLE_UNTIL_EXECUTION
```

金融操作应该谨慎使用最后一种。

---

# 五十九、Vote Change 不能简单覆盖历史

如果允许：

```text id="q7v4w9"
APPROVE
    ↓
REJECT
```

不要：

```text id="asxioc"
vote = REJECT
```

而应该记录：

```text id="2f6b0d"
VOTE_CAST(APPROVE)
VOTE_CHANGED(REJECT)
```

最终：

```text id="ybz45t"
effective vote = REJECT
```

这样 Audit 才能回答：

> 这个人什么时候改变了判断？

---

# 六十、同一个 Voter 只能拥有一个有效 Vote

如果：

```text id="o40h5j"
Alice
```

通过：

```text id="7ng0pt"
Alice User
Alice Group
Alice Delegate
```

三个入口都出现：

绝不能算成：

```text id="6p15gn"
3 votes
```

必须先做：

```text id="o8t1xa"
Principal Canonicalization
```

然后：

```text id="b44ms4"
one principal
→ one effective vote
```

这是 Group Approvals 必须特别处理的问题。

Microsoft Power Automate 支持 Group Approvals，例如 First to respond 的 group 只需要一名组成员完成；Everyone 类型则对每个 group 至少需要相应的组成员响应。([learn.microsoft.com](https://learn.microsoft.com/en-us/power-automate/group-approvals?utm_source=chatgpt.com))

因此：

> Group 是 Voter Resolution 输入，不应该直接等同于一个 Vote。

---

# 六十一、Group Approval 的一个重要问题：Group 本身是一票还是成员各一票？

例如：

```text id="dks3kk"
Compliance Group:
Alice
Bob
Carol
```

Policy：

```text id="bpy0kv"
1 Compliance approval
```

有两种解释：

### Group-as-one

```text id="5w0lg9"
Compliance = 1 vote
```

无论 Alice / Bob / Carol 谁批准：

```text id="ep35hj"
Group vote = approved
```

### Member-as-voter

```text id="3g8rto"
Alice
Bob
Carol
```

任一人批准：

```text id="mbzq7f"
count = 1
```

这两个在：

```text id="8ivkc1"
2 groups × 3 members
```

的场景下结果可能完全不同。

所以 Policy 应明确：

```text id="2kx0h1"
voterUnit:
  PRINCIPAL
  GROUP
  ROLE
```

---

# 六十二、建议默认以 Principal 为最小投票单位

例如：

```text id="obpl7e"
Voter Unit = HUMAN PRINCIPAL
```

Group 用于：

```text id="qfyfpt"
Resolve candidates
```

而不是：

```text id="eay6g6"
Group = one vote
```

除非业务明确要求 Group Quorum。

---

# 六十三、Role Quorum 也要处理“一人多角色”

例如：

```text id="h6ng7j"
Alice:
  PM
  Committee Chair
```

Policy：

```text id="j8b1x9"
1 PM
+
1 Chair
```

Alice 是否可以贡献：

```text id="n4sm3n"
2 votes
```

通常：

```text id="b9j8c5"
NO
```

同一个 Principal 不应该因为有多个 Role 就产生多个独立 Vote。

更安全：

```text id="2ej08g"
one Principal
one effective vote
```

然后 Policy 判断：

```text id="e7vk7g"
whether the single vote satisfies multiple role predicates
```

是否允许需要明确。

---

# 六十四、Required Votes 与 SoD 的组合可能比 K-of-N 更重要

例如：

```text id="7v2ybc"
K = 2
```

但要求：

```text id="g2f7a2"
voters must be independent
```

可以定义：

```text id="co9w1c"
APPROVE(
    count >= 2
)
AND
DISTINCT(group) >= 2
```

或者：

```text id="zdapyr"
APPROVE(role=PM) >= 1
AND
APPROVE(role=Compliance) >= 1
```

这样才能真正表达：

> 两个独立控制者都同意。

而不是：

> 同一个团队里的两个人点了两次按钮。

---

# 六十五、Approval Policy 应支持“Negative Authority”

例如：

```text id="66m8jt"
Compliance
```

可能不是：

```text id="APPROVER"
```

而是：

```text id="VETO"
```

规则：

```text id="djjzlw"
PM >= 1
AND
Compliance veto count = 0
```

即：

```text id="vj9j4e"
1 PM approve
+
no Compliance veto
```

这比：

```text id="2 of 3"
```

表达能力强很多。

---

# 六十六、Veto 与 Reject 不一定一样

Reject：

```text id="nw2iik"
一个普通参与者不同意
```

Veto：

```text id="g6j4m5"
一个特定角色有权阻止结果
```

例如：

```text id="k5k10l"
Compliance Officer = veto authority
```

则：

```text id="1l7m1a"
any Compliance veto
→ REJECT
```

即使：

```text id="m34v85"
10 other approvers approved
```

也无法通过。

金融流程经常需要这种结构。

---

# 六十七、Approval Policy 可以最终抽象为“Positive Quorum + Negative Constraints”

一个比较强的模型：

```text id="4qvbqk"
Positive:
required approvals

Negative:
rejection threshold
veto roles
conflict exclusions
maker exclusion
```

例如：

```text id="z6c5qp"
Positive:
PM >= 1
Compliance >= 1

Negative:
any Compliance veto
maker cannot vote
same person cannot satisfy both roles
```

这比单纯：

```text id="approvalType": "ALL"
```

强很多。

---

# 六十八、Completion Rule 和 Decision Rule 也要分开

例如：

```text id="4mgs7e"
Policy:
3 of 5

Current:
3 approve
1 pending
1 pending
```

Decision 已经确定：

```text id="y3e8n2"
APPROVED
```

但 Completion 可以：

```text id="c5f5x2"
EARLY
```

意味着立即完成。

或者：

```text id="1x1fjp"
COLLECT_ALL_RESPONSES
```

意味着：

```text id="2cu4mj"
Decision = APPROVED

Task Status = WAITING_FOR_REMAINING_RESPONSES
```

这样系统可以在：

```text id="yfiqfn"
decision fixed
```

以后继续：

```text id="p1zj5i"
collect evidence
```

这是金融 Audit 很有用的一种模式。

---

# 六十九、推荐区分三个状态

```text id="bkj10b"
Voting Status
Decision Status
Task Status
```

例如：

```text id="f7u7pk"
Voting:
COLLECTING

Decision:
APPROVED

Task:
WAITING_FOR_ALL_RESPONSES
```

或者：

```text id="d40f92"
Voting:
CLOSED

Decision:
REJECTED

Task:
COMPLETED
```

这样不会因为：

```text id="9oy9t7"
第一时间达到 K
```

而失去后续响应的 Audit 信息。

---

# 七十、这对 Agent 尤其重要

Agent 可能：

```text id="ekxvth"
看到 Decision = APPROVED
```

就想：

```text id="7smux5"
继续执行
```

这是否正确，取决于：

```text id="39cbax"
Completion Rule
Workflow Effect
Authorization
```

如果：

```text id="wfch9v"
Decision = APPROVED
```

但：

```text id="q8g4p0"
Task not formally completed
```

Agent 不应该猜。

应该由 Workflow Control Plane：

```text id="q9nbfk"
emit:
ApprovalDecisionReached
```

并根据：

```text id="w2i2ob"
workflow effect
```

决定是否继续。

---

# 七十一、Approval Policy 与 Human Task 统一模型的关系

前一篇文章提出：

```text id="ow9vqp"
Human Task
    ↓
Decision Contract
```

现在可以进一步具体化：

```text id="l44c65"
Approval Task
    ↓
Approval Policy
```

Approval Task 本身负责：

```text id="v3h0jr"
Assignment
Context
Lifecycle
```

Approval Policy 负责：

```text id="qh6w6h"
Who votes
How votes count
When decision is reached
What rejection means
What timeout means
```

这两层不要合在一起。

---

# 七十二、一个完整 Approval Runtime

```text id="f5p9f4"
                 Approval Request
                         │
                         ▼
                Resolve Voter Set
                         │
                         ▼
                Freeze / Bind Scope
                         │
                         ▼
                  Routing Engine
                         │
                ┌────────┴────────┐
                │                 │
             Parallel          Sequential
                │                 │
                ▼                 ▼
             Vote Event       Vote Event
                │                 │
                └────────┬────────┘
                         │
                    Policy Engine
                         │
          ┌──────────────┼──────────────┐
          │              │              │
       Approved       Rejected       Pending
          │              │              │
          └──────────────┼──────────────┘
                         │
                    Completion
                         │
                    Workflow
                         │
                  Authorization
                         │
                     Command
```

这就是一个真正的 Approval Engine。

---

# 七十三、Vote Event 必须先验证，再进入计票

收到：

```json id="q1ve1s"
{
  "approver": "alice",
  "decision": "APPROVE"
}
```

不能直接：

```text id="p6gg8d"
A += 1
```

必须：

```text id="ln6z3n"
1. Identify principal
2. Check eligible voter
3. Check authorization
4. Check scope
5. Check duplicate
6. Check vote window
7. Record immutable event
8. Recompute decision
```

否则攻击者可能：

```text id="9g3f5u"
submit fake vote
```

或者：

```text id="p8x9dj"
same vote twice
```

---

# 七十四、Vote Authorization 与 Business Authorization 是两层

例如：

```text id="ajy0jr"
Alice
```

有资格投票：

```text id="tqk5n2"
YES
```

并不意味着：

```text id="msqd2t"
Alice can execute transaction.
```

所以：

```text id="m5etgz"
Vote Authorization
```

只回答：

> Alice 是否可以提供这一票？

而：

```text id="gbdri3"
Execution Authorization
```

回答：

> 当前 Command 是否可以执行？

两者必须分开。

---

# 七十五、Approval Policy 的输入应该是“明确的 Proposal”

Approval Request 不应该只包含：

```text id="yc8nd6"
text = "Please approve."
```

至少应有：

```text id="4a1c3e"
proposalId
proposalVersion
action
resource
parameters
scopeHash
riskLevel
```

这样 Vote 才能绑定。

---

# 七十六、Proposal 变化应该使 Approval 失效

推荐默认：

```text id="p8w19b"
Proposal v7
    ↓
Approval in progress
```

如果：

```text id="bik0ac"
Proposal v8
```

产生：

```text id="6gl5d4"
Approval invalidated
```

然后：

```text id="w7f6fc"
new Approval instance
```

除非 Policy 明确支持：

```text id="h6p2y8"
minor change tolerance
```

---

# 七十七、但“Minor Change”也应该结构化

例如：

```text id="n3p1b9"
quantity:
100,000 → 100,500
```

Policy 可能允许：

```text id="z7q9p2"
±1%
```

但：

```text id="vx8r12"
vote
target
security
```

变化必须重新批准。

所以可以定义：

```text id="7uym31"
Approval Scope
{
  parameters:
    quantity:
      maxDelta = 1%
}
```

这比：

```text id="3q28h1"
Agent decides it's still similar
```

可靠得多。

---

# 七十八、Approval Policy 应支持 simulation

部署 Policy 时非常值得提供：

```text id="3e4qk1"
Simulate Policy
```

输入：

```text id="qpjf0a"
Voters:
A PM
B PM
C Compliance

Votes:
A approve
B reject
C approve
```

输出：

```text id="j1s5zv"
Decision:
REJECT

Reason:
rejectionRule = ANY_REJECT
```

再：

```text id="u2eqj1"
Votes:
A approve
C approve
B pending
```

输出：

```text id="vr5sdz"
Decision:
APPROVED
```

以及：

```text id="1c72ov"
Votes:
A reject
B reject
C pending
```

输出：

```text id="f35m3m"
Decision:
IMPOSSIBLE
```

这对 Policy 工程化非常重要。

---

# 七十九、Policy 静态分析应该至少发现四类错误

### 1. Impossible Quorum

```text id="9d7q5c"
K > N
```

### 2. Contradictory Rules

例如：

```text id="5j19qk"
K=2
AND
Any Reject = Reject

Voter count = 2
```

不一定错误，但需要明确这意味着：

```text id="q2x1hf"
只有两人全部 approve 才能过
```

### 3. Unreachable Rule

例如：

```text id="laz6gh"
Required approvals = 3
Role=Compliance
Eligible Compliance voters = 2
```

### 4. Non-terminating Rule

例如：

```text id="1kxn6t"
No timeout
No escalation
K=3
```

潜在永久等待。

---

# 八十、Timeout / Escalation 本身也可能制造新的 Quorum

例如：

```text id="e0w2a2"
Original:
2 of 3
```

Alice 超时：

```text id="3t4d9v"
Escalate to Dave
```

现在：

```text id="4x7r0e"
Eligible voters:
Bob
Carol
Dave
```

是：

```text id="2 of 3"
```

还是：

```text id="2 of original 3"
```

不能默认。

推荐：

> **Escalation replaces an individual voter rather than silently changing the quorum**, 除非 Policy 明确规定 quorum re-resolution。

---

# 八十一、替补 Approver 与新增 Approver 不应该混为一谈

例如：

```text id="4t4h8j"
Alice unavailable
```

Delegate：

```text id="0v6f6k"
Bob
```

如果 Bob 只是：

```text id="delegate for Alice"
```

那么通常：

```text id="Bob's vote substitutes Alice's vote"
```

不能变成：

```text id="new additional vote"
```

否则：

```text id="N"
```

发生变化。

因此应该记录：

```text id="5n6u8p"
voteSlot
principal
delegateOf
```

---

# 八十二、推荐引入 Vote Slot

这对复杂审批非常有用。

例如：

```text id="h83b91"
Approval Policy:
1 PM
1 Compliance
```

建立两个：

```text id="rjv6s6"
Vote Slots:

SLOT_PM
SLOT_COMPLIANCE
```

每个 Slot：

```text id="l4u1xk"
eligible principals
required
filledBy
```

然后：

```text id="3un49x"
Bob = PM
Carol = Compliance
```

各自填充一个 Slot。

这样不会出现：

```text id="9c8f0u"
Bob has both PM + Compliance
→ 2 votes
```

除非 Policy 明确允许。

---

# 八十三、Vote Slot 比简单 Role Quorum 更适合强控制场景

例如：

```text id="2i1ytx"
Required:
- 1 Maker-independent Reviewer
- 1 Compliance Officer
- 1 Business Owner
```

这是三个：

```text id="eh8yo8"
distinct slots
```

而不是：

```text id="0na2nv"
3 generic approvals
```

对于：

```text id="9z8fyk"
Maker-Checker
Four-eyes
Segregation of Duties
```

特别有价值。

---

# 八十四、Required Votes 可以从简单到复杂分四级

推荐平台分阶段支持。

## Level 1 — Simple

```text id="m0a1hp"
ANY
ALL
K-of-N
```

---

## Level 2 — Negative Rules

```text id="4e6kr8"
ANY_REJECT
REJECT_K
VETO
```

---

## Level 3 — Role / Slot Quorum

```text id="j1c3ev"
1 PM
+
1 Compliance
```

---

## Level 4 — Boolean Policy

```text id="7t5bpe"
AND(
  PM >= 1,
  Compliance >= 1
)
OR
(
  IC_CHAIR >= 1
)
```

不要一开始就上 Level 4。

但 Domain Model 最好预留扩展。

---

# 八十五、Approval Policy 应该有 Explain API

对于任何最终结果：

```text id="ld4j9t"
GET /approval/{id}/decision
```

不仅返回：

```json id="bks2me"
{
  "decision": "APPROVED"
}
```

还应该返回：

```json id="qmc9my"
{
  "decision": "APPROVED",

  "policy": {
    "id": "INV-COMMITTEE",
    "version": 3
  },

  "voters": {
    "eligible": 5,
    "responded": 3,
    "approved": 3,
    "rejected": 0,
    "pending": 2
  },

  "rule": {
    "requiredApprovals": 3
  },

  "reason": "approval_threshold_reached"
}
```

这样用户、审计、运营和 Agent 都可以理解：

> 为什么现在通过？

---

# 八十六、Reject 也应该有 Explain API

例如：

```text id="4m9bjx"
decision = REJECTED
```

应该能够解释：

```text id="utv2y2"
reason:
  "rejection_threshold_reached"

details:
  approvals = 1
  rejections = 2
  pending = 2
  required = 3
```

而不是：

```text id="e5xg0s"
status = rejected
```

---

# 八十七、对于 Agent，Explain API 特别重要

Agent 看到：

```text id="4k6ytd"
Approval rejected
```

下一步不应该自行推测：

> “也许是一个 Approver 不喜欢这个 Proposal。”

应该调用：

```text id="af57od"
explainApprovalDecision()
```

然后得到：

```text id="69zjgj"
2 vetoes
1 approval
2 pending
Rule = ANY_REJECT
```

Agent 才能决定：

```text id="42fns6"
request clarification
revise proposal
escalate
```

---

# 八十八、Approval Policy 的执行结果应该使用有限状态机

推荐：

```text id="8sn4gn"
DRAFT
  ↓
READY
  ↓
COLLECTING
  ├── APPROVED
  ├── REJECTED
  ├── EXPIRED
  ├── CANCELLED
  └── INVALIDATED
```

不要允许：

```text id="gozyit"
APPROVED → COLLECTING
```

这种随意倒退。

如果需要重新审批：

```text id="f3pmcf"
Approval #1 = APPROVED

Proposal changed

Approval #2 = NEW
```

而不是：

```text id="xv2y4b"
same approval status reset
```

---

# 八十九、Approval Instance 与 Approval Policy 必须分开

```text id="3yx62l"
ApprovalPolicy
```

是：

```text id="12ghkv"
definition
```

例如：

```text id="k5u3s0"
2 of 3 PM
```

而：

```text id="4c91r4"
ApprovalInstance
```

是：

```text id="eg52bm"
actual execution
```

包括：

```text id="q2m1k5"
proposal
voters
votes
decision
timestamps
```

这样 Policy 更新不会修改历史 Approval。

---

# 九十、Policy 版本必须不可变

例如：

```text id="vs0jnc"
Policy V3
```

已经被使用。

即使后来发布：

```text id="aahckn"
V4
```

不能修改 V3 的语义。

否则：

```text id="w7k8sp"
Audit replay
```

无法重建。

推荐：

```text id="ur8qf5"
Policy V3
status = immutable
```

---

# 九十一、Approval Policy 的版本绑定应该记录在每个 Vote 上

例如：

```json id="joqy2d"
{
  "approvalId": "AP-1024",
  "policyVersion": 3,
  "voter": "alice",
  "decision": "APPROVE",
  "scopeHash": "abc..."
}
```

这样即使之后发生：

```text id="7jhqey"
Policy V4
```

也不会影响：

```text id="rmo2vz"
历史 Vote
```

---

# 九十二、Approval Policy 的生命周期应该独立于 Workflow

推荐：

```text id="w83axv"
Policy Registry
```

维护：

```text id="9lbvkv"
Policy
Policy Version
Effective From
Effective To
Status
Owner
Approved By
```

Workflow 引用：

```text id="uw5n3w"
policyId + version
```

而不是复制整份规则。

这和前面 Control Plane 中：

```text id="Policy Registry"
```

的设计一致。

---

# 九十三、一个非常重要的区分：Policy Decision ≠ Human Decision

例如：

```text id="9w6jgn"
Human votes:
2 approve
1 reject
```

这是：

```text id="na4e1j"
Human Decision Inputs
```

Policy Engine 计算：

```text id="6xw8y8"
APPROVED
```

这是：

```text id="2k2vtf"
Policy Decision
```

所以：

```text id="f6f0hk"
Human Approval
    ≠
Approval Policy Outcome
```

后者是前者经过规则计算的结果。

---

# 九十四、Approval Policy 可以支持“human + machine evidence”

例如：

```text id="lzpaz2"
2 human approvals
+
Compliance policy = PASS
+
Risk check = PASS
```

最终：

```text id="1rce4e"
ALLOW
```

这种场景非常适合金融 Agent。

因此：

```text id="jz2x4x"
Approval Policy
```

可以成为更大的：

```text id="4b2yrk"
Decision Policy
```

一部分。

例如：

```text id="6ymv7n"
AND(
  HumanApproval >= 2,
  Compliance = PASS,
  RiskLimit = PASS
)
```

注意：

> 这时候已经不只是“审批人数统计”，而是一个 Policy Evaluation。

应该明确它已经进入：

```text id="x7uxb1"
Control Plane
```

而不是 Human Task UI。

---

# 九十五、但是不要把所有业务逻辑塞进 Approval Policy

例如：

```text id="0ufq23"
Approval Policy:
if portfolio.risk > 7:
    ...
if market.is_open:
    ...
if client.country == ...
```

这会迅速变成：

> 一个第二套业务规则引擎。

更好的分层：

```text id="s91oq0"
Business / Domain Policy
        ↓
Approval Eligibility
        ↓
Approval Policy
        ↓
Voting
```

即：

```text id="jgjxjf"
Domain
    → 这个 Action 是否允许被审批

Approval Policy
    → 哪些人如何批准

Authorization
    → 当前是否可以执行
```

---

# 九十六、Approval Eligibility 与 Approval Voting 也应分开

例如：

```text id="0nfn7u"
交易金额 > 10M
```

导致：

```text id="z25p98"
需要 IC approval
```

这是：

```text id="rdkw9j"
Approval Routing / Eligibility
```

而：

```text id="6i8d22"
IC = 2 of 3
```

这是：

```text id="ml7zx5"
Voting Rule
```

两者不要硬编码到一个表达式里。

---

# 九十七、最终的 Approval Pipeline

推荐：

```text id="ikb1l3"
Business Event
      ↓
Approval Eligibility
      ↓
Resolve Policy
      ↓
Resolve Voters
      ↓
Freeze Scope
      ↓
Create Approval Instance
      ↓
Route Votes
      ↓
Collect Vote Events
      ↓
Validate Vote
      ↓
Evaluate Quorum
      ↓
Check Early Termination
      ↓
Decision
      ↓
Authorization Re-check
      ↓
Workflow Transition
      ↓
Command
```

这条链非常适合金融 Agent 平台。

---

# 九十八、一个完整示例：2-of-3 Portfolio Approval

假设：

```text id="vfg0e3"
Eligible voters:
PM-A
PM-B
PM-C

Policy:
2 approvals required
Any reject does not automatically reject
Timeout = 24h
```

初始：

```text id="g72k4y"
A=0
R=0
P=3
```

PM-A：

```text id="p4lo9n"
APPROVE
```

状态：

```text id="8t8ui9"
A=1
R=0
P=2
```

继续等待。

PM-B：

```text id="jjr5z9"
APPROVE
```

状态：

```text id="a9beq3"
A=2
R=0
P=1
```

立即：

```text id="4w7l5x"
APPROVED
```

即使 PM-C 尚未响应。

---

# 九十九、如果 PM-B Reject

```text id="1uzqki"
A=1
R=1
P=1
K=2
```

最大可能：

```text id="1q7irj"
A + P = 2
```

所以仍然：

```text id="2rcxdm"
PENDING
```

PM-C：

```text id="kgc7q9"
APPROVE
```

得到：

```text id="f8c7o2"
A=2
R=1
P=0
```

最终：

```text id="y3b1jk"
APPROVED
```

这说明：

> Reject 并不一定等于 Reject Outcome。

必须由 `rejectionRule` 决定。

---

# 一百、换成 Any-Approve

```text id="x6a6dp"
K = 1
```

PM-A：

```text id="rq9t2a"
APPROVE
```

立即：

```text id="o2g2yy"
APPROVED
```

其他 voter：

```text id="t7kn9m"
optional
```

但如果 Policy 是：

```text id="lqj0wa"
ANY_RESPONSE
```

则：

```text id="7v9p4f"
PM-A REJECT
```

直接：

```text id="fp7g4z"
REJECTED
```

这就是为什么：

```text id="h3u1mw"
ANY
```

本身不够表达。

---

# 一百零一、再看 ALL

```text id="p3d8ul"
N=3
K=3
```

PM-A:

```text id="d4z31x"
APPROVE
```

状态：

```text id="6d4s75"
A=1
R=0
P=2
```

PM-B：

```text id="86uqwg"
REJECT
```

如果：

```text id="d5e7h7"
rejectionRule = ANY_REJECT
```

则立即：

```text id="t6fjn3"
REJECTED
```

如果：

```text id="f12l1q"
rejectionRule = COLLECT_ALL
```

则：

```text id="yksxli"
A=1 R=1 P=1
```

继续等待。

---

# 一百零二、Required Votes 的最小 Runtime 算法

伪代码：

```text id="p8saq7"
function evaluate(votes, policy):
    N = eligibleVoters.count
    A = count(APPROVE)
    R = count(REJECT)
    P = N - A - R

    if rejectionRule.matches(A, R, P):
        return REJECTED

    if approvalRule.matches(A, R, P):
        return APPROVED

    if impossible(A, R, P, policy):
        return REJECTED

    if timeout:
        return timeoutPolicy.outcome

    return PENDING
```

更精确：

```text id="h5m7uj"
approvePossible = A + P >= requiredApprovals

approveReached = A >= requiredApprovals
```

这样基本已经可以覆盖：

```text id="wfqslq"
ANY
ALL
K-of-N
Percentage
Majority
```

---

# 一百零三、但是金融生产环境不要只使用这个函数

因为还需要：

```text id="48l2x0"
eligibility
authorization
SoD
scope
version
independence
voter uniqueness
delegation
expiry
```

所以真正应该：

```text id="xe60nz"
validateVote(event)
    ↓
authorizeVote(event)
    ↓
applyVote(event)
    ↓
evaluatePolicy(instance)
```

而不是：

```text id="7q4jty"
countVotes()
```

---

# 一百零四、Required Votes 的 API 设计

推荐：

```http id="c4jhc6"
POST /approval-instances
```

创建：

```json id="v6b9di"
{
  "policyId": "PM-APPROVAL",
  "policyVersion": 3,
  "subject": {
    "type": "InvestmentProposal",
    "id": "INV-1024"
  },
  "scopeHash": "..."
}
```

系统返回：

```json id="ksg50x"
{
  "approvalId": "AP-991",
  "status": "COLLECTING",
  "eligibleVoters": [
    "pm-a",
    "pm-b",
    "pm-c"
  ],
  "requiredApprovals": 2
}
```

然后：

```http id="bpz5aq"
POST /approval-instances/AP-991/votes
```

```json id="m5m4j2"
{
  "decision": "APPROVE"
}
```

返回：

```json id="s7vkhb"
{
  "accepted": true,
  "decision": "APPROVED",
  "reason": "approval_threshold_reached"
}
```

---

# 一百零五、不要让 Client 自己提交 `approvalCount`

禁止：

```json id="s9fmhj"
{
  "approvalCount": 2
}
```

因为 Client 可以伪造。

只能提交：

```json id="g0dvvv"
{
  "decision": "APPROVE"
}
```

Server 根据：

```text id="y2rj7w"
immutable vote ledger
```

计算：

```text id="4cg2hl"
count
```

---

# 一百零六、Approval Result 应该可重放计算

给定：

```text id="o72j8s"
Policy V3
Voter Snapshot
Vote Events
```

应该可以得到：

```text id="z5qg9y"
same Decision
```

这对：

```text id="j81j3f"
Audit
Dispute
Regulatory Review
Incident Investigation
```

非常重要。

因此：

> **Approval Engine 最好是 Deterministic Reducer。**

---

# 一百零七、为什么这很适合你的整体 Agent Architecture？

因为前面已经形成：

```text id="4ip8ea"
Agent
  ↓
Proposal
  ↓
Human Task
  ↓
Approval Policy
  ↓
Authorization
  ↓
Command
  ↓
Domain
```

那么 Approval Policy 最适合成为：

> **Control Plane 中的确定性 Decision Component。**

Agent 可以：

```text id="v5pvbe"
request approval
prepare context
explain proposal
notify
```

但不能：

```text id="opj1mi"
choose its own quorum
count votes itself
declare itself approved
modify policy
```

---

# 一百零八、Approval Policy 不应该存进 Agent Memory

例如 Agent Memory：

```text id="r3kk5n"
"需要两个 Portfolio Manager 同意。"
```

不能成为：

```text id="8pxt3z"
approval policy source of truth
```

因为：

```text id="hmhkh2"
Policy V2
```

可能已经变成：

```text id="9s65oa"
1 PM + 1 Compliance
```

Agent Memory 只是：

```text id="xa2w8s"
context
```

Approval Policy Registry 才是：

```text id="wd8j8k"
authority
```

这和前面：

```text id="Business State ≠ Agent Memory"
```

是完全一致的架构原则。

---

# 一百零九、Approval Policy 与 Agent Reasoning 的边界

Agent 可以建议：

> “根据当前风险，我认为需要 Compliance 和 PM 双重审批。”

但不能：

```text id="i8h63w"
Agent
    ↓
changes policy
```

真正执行：

```text id="es69t4"
Policy Registry
    ↓
Resolve Approval Policy
```

例如：

```text id="vb8ytr"
amount <= 1M
→ PM only

1M < amount <= 10M
→ PM + Compliance

>10M
→ IC 2-of-3
```

这些应该由：

```text id="9o6k82"
Policy Engine
```

确定。

---

# 一百一十、Approval Rule 与 Voter Resolution 也可以独立复用

例如：

```text id="5v2cnd"
Approval Eligibility:
    amount <= 10M
```

返回：

```text id="t83f8x"
Policy = PM_COMPLIANCE
```

然后：

```text id="u9nvh0"
PM_COMPLIANCE
```

定义：

```text id="j1l6z7"
1 PM
1 Compliance
```

这使：

```text id="Business Rule"
```

与：

```text id="Approval Voting Rule"
```

解耦。

---

# 一百一十一、Approval Policy 的配置 UI 也应该结构化

不要让业务用户直接写：

```text id="bb1hyi"
IF A AND B OR C AND ...
```

建议使用：

```text id="z9j5ix"
Approval Builder

Who can vote?
[ Portfolio Manager ]

How many?
[ 2 ]

Reject rule?
[ Any reject ]

Routing?
[ Parallel ]

Timeout?
[ 48 hours ]

Escalate to?
[ Senior Portfolio Manager ]

Maker excluded?
[ Yes ]
```

然后生成：

```text id="s0l4f1"
typed policy
```

---

# 一百一十二、配置发布之前必须 Preview

推荐：

```text id="1ggs0b"
Policy Preview
```

显示：

```text id="7krq9i"
For this transaction:

Eligible voters:
PM-A
PM-B
Compliance-C

Required:
2 approvals

Early completion:
Yes

Any rejection:
No

Potential blockers:
None
```

这能极大减少生产 Approval Policy 配置错误。

---

# 一百一十三、Policy Test Cases 应该成为一等对象

例如：

```text id="f0z3a8"
Policy:
2-of-3

Test:
A approve
B approve
→ approved

A approve
B reject
C pending
→ pending

A reject
B reject
C pending
→ impossible

A approve
B approve
C reject
→ approved
```

Policy deployment 之前：

```text id="ckgdpb"
run tests
```

这是金融生产系统非常值得做的。

---

# 一百一十四、Policy Change 需要影响分析

修改：

```text id="wu2fjc"
3-of-5
```

为：

```text id="4-of-5
```

可能影响：

```text id="fvy9zz"
existing workflows
approval latency
approval failure rate
escalations
operational capacity
```

因此 Policy Registry 发布前最好展示：

```text id="6m2v6j"
Affected workflows
Affected business objects
Effective date
```

而不是简单：

```text id="Save"
```

---

# 一百一十五、Approval Policy 的四层模型

最终可以把 Policy 统一成：

```text id="kqkqz1"
Approval Policy
│
├── Eligibility
│   └── When is approval required?
│
├── Voter Resolution
│   └── Who can vote?
│
├── Decision Rule
│   ├── Required approvals
│   ├── Rejection threshold
│   ├── Veto
│   ├── Independence
│   └── Role quorum
│
└── Completion / Escalation
    ├── Early decision
    ├── Timeout
    ├── Escalation
    └── Reassignment
```

这是比：

```text id="v1h7o6"
ANY / ALL
```

更完整的抽象。

---

# 一百一十六、推荐一个统一 Policy DSL

例如：

```text id="2j8m9w"
approval {
  voters = role("PORTFOLIO_MANAGER")
  routing = parallel

  decision {
    approvals >= 2
    rejects >= 1 -> rejected
  }

  constraints {
    maker != approver
    distinct_groups >= 2
  }

  timeout {
    after = 48h
    action = escalate("SENIOR_PM")
  }
}
```

另一个：

```text id="7lq1w3"
approval {
  voters = group("INVESTMENT_COMMITTEE")
  routing = parallel

  decision {
    approvals >= 2
    rejects >= 1 -> rejected
  }
}
```

这样的 DSL 已经足以覆盖绝大多数企业 Approval。

---

# 一百一十七、DSL 不应该直接暴露底层实现

业务用户看到：

```text id="z8f3j2"
2 of 3
```

平台内部可以编译成：

```text id="3l70c2"
ApprovalReducer(
    required=2,
    denominator=eligible_voters,
    rejection_rule=...
)
```

这样：

```text id="qg0sbc"
UI
DSL
Runtime
```

三层解耦。

---

# 一百一十八、对于 Agent，最重要的是 Policy Explainability

Agent 可以收到：

```json id="7qgi3v"
{
  "decision": "PENDING",
  "reason": "awaiting_required_approval",
  "progress": {
    "approved": 1,
    "required": 2,
    "pending": 2
  }
}
```

Agent 就可以：

```text id="q3yrjv"
notify next approver
prepare reminder
escalate
```

但不能自行改变：

```text id="79nepf"
required = 1
```

---

# 一百一十九、Approval Engine 应该对 Agent 提供的是“Decision Service”，不是“Voting Logic API”

Agent 不需要：

```text id="izp2g8"
countApprovals()
```

它需要：

```text id="q07x9p"
getApprovalStatus()
explainApprovalDecision()
requestApproval()
```

这样：

```text id="3kue8w"
Agent
```

只消费：

```text id="34rjcu"
approved
pending
rejected
blocked
```

而不是：

```text id="cbpr5a"
自己计算
```

---

# 一百二十、完整状态示例

例如：

```json id="wyju7g"
{
  "approvalId": "AP-1024",

  "status": "PENDING",

  "policy": {
    "id": "INV-IC",
    "version": 7
  },

  "voterSnapshot": [
    "pm-a",
    "pm-b",
    "compliance-c"
  ],

  "decision": {
    "approved": 1,
    "rejected": 0,
    "pending": 2,
    "required": 2,
    "possible": true
  },

  "votes": [
    {
      "voter": "pm-a",
      "decision": "APPROVE"
    }
  ]
}
```

Agent 看到：

```text id="r3mfdn"
PENDING
1 / 2
```

而不是：

```text id="k8oio4"
some opaque boolean
```

---

# 一百二十一、Approval Policy 最值得加入的测试矩阵

至少测试：

|  N |  K | Approve | Reject | Pending | 结果                    |
| -: | -: | ------: | -----: | ------: | --------------------- |
|  3 |  1 |       1 |      0 |       2 | Approved              |
|  3 |  1 |       0 |      1 |       2 | 取决于 rejection rule    |
|  3 |  3 |       2 |      0 |       1 | Pending               |
|  3 |  3 |       2 |      1 |       0 | Rejected              |
|  5 |  3 |       3 |      0 |       2 | Approved              |
|  5 |  4 |       1 |      3 |       1 | Impossible / Rejected |
|  5 |  3 |       1 |      1 |       3 | Pending               |
|  5 |  3 |       1 |      2 |       2 | Pending               |
|  5 |  3 |       1 |      3 |       1 | Impossible            |

重点测试：

```text id="ewcq8u"
boundary
minimum
maximum
impossible
early completion
timeout
```

---

# 一百二十二、再增加金融专用测试

例如：

```text id="y4to4s"
Maker = voter
```

预期：

```text id="c0s8k1"
excluded
```

例如：

```text id="jdw2l7"
same human has two roles
```

预期：

```text id="x7ycc2"
one vote
```

例如：

```text id="uycrn8"
one user belongs to two approval groups
```

预期：

```text id="7qxl3d"
one principal / no double counting
```

例如：

```text id="y6q2gi"
approval scope changed
```

预期：

```text id="8nj6b8"
re-approval required
```

例如：

```text id="kj2rjp"
policy version changes
```

预期：

```text id="p0i0n7"
existing approval retains old version
```

---

# 一百二十三、一个非常重要的生产原则：Approval Decision 一旦 Terminal，就不能因为后来有人投票而反转

例如：

```text id="j9owc0"
2-of-3

A approve
B approve
→ APPROVED
```

之后：

```text id="n1f9w5"
C reject
```

不应该：

```text id="bsrn5v"
APPROVED → REJECTED
```

因为：

```text id="xugy3q"
Decision reached
```

之后其他 Votes 只能：

```text id="a6xq08"
informational
```

或者：

```text id="x4ll6t"
ignored
```

除非 Policy 明确采用：

```text id="2v8b1b"
COLLECT_ALL_BEFORE_DECISION
```

这是非常重要的状态机规则。

---

# 一百二十四、First Responder 更明显

Oracle 明确指出，在 First-Responder-Wins 模式下，第一个响应决定 Group outcome，其他成员的响应可以记录，但不会改变结果。([docs.oracle.com](https://docs.oracle.com/cd/E18727-01/doc.121/e13516/T405156T405164.htm?utm_source=chatgpt.com))

因此：

```text id="p4iufb"
Terminal Decision
```

意味着：

```text id="u96i4k"
Policy no longer evaluates later votes
```

这一点应明确写进 Engine Contract。

---

# 一百二十五、Rejected 与 Veto 的 Audit 不能只记“谁反对”

例如：

```text id="cm6pck"
Compliance vetoed
```

应该记录：

```text id="dufgn6"
voter
role
authority
policy rule
scope
reason
timestamp
```

尤其金融场景：

> “为什么一个人的拒绝足以阻止整个流程？”

Audit 必须能够回答：

```text id="opmr8f"
because:
rejectionRule = VETO(role=COMPLIANCE)
policyVersion = 7
```

---

# 一百二十六、Approval Policy 其实已经进入“Policy-as-Code”

一个成熟企业平台最终应该把：

```text id="qhk3as"
Approval Matrix
```

当成：

```text id="7cm8ft"
Policy-as-Code
```

具备：

```text id="b7y9di"
Versioning
Validation
Testing
Simulation
Deployment
Rollback
Audit
Explainability
```

而不是：

```text id="h2k91y"
some configuration row in database
```

---

# 一百二十七、为什么这对金融 Agent 很重要？

金融 Agent 越来越可能：

```text id="j2lzss"
自动准备
自动路由
自动催办
自动收集
自动执行
```

那么 Approval Policy 就成为：

```text id="2v9d0e"
Agent Autonomy
    ↓
Human Authority Boundary
```

之间的桥梁。

例如：

```text id="g0x3x5"
Agent
  ↓
Proposal
  ↓
Approval Policy
  ↓
2 PM + Compliance
  ↓
Approval
  ↓
Authorization
  ↓
Command
```

Agent 不需要知道：

```text id="4x7wtr"
2-of-3 怎么算
```

也不能修改：

```text id="1ow4fj"
quorum
```

它只需要：

```text id="65zvjm"
request
wait
interpret result
```

---

# 一百二十八、最终推荐架构

```text id="pg3b2n"
                         Agent Runtime
                              │
                           Proposal
                              │
                              ▼
                       Workflow / Case
                              │
                              ▼
                      Approval Eligibility
                              │
                              ▼
                     Approval Policy
                              │
             ┌────────────────┼────────────────┐
             │                │                │
        Voter Resolver     Routing         Scope Binding
             │                │                │
             └────────────────┼────────────────┘
                              │
                         Vote Events
                              │
                              ▼
                       Voting Reducer
                              │
              ┌───────────────┼───────────────┐
              │               │               │
           APPROVED        REJECTED         PENDING
              │               │               │
              └───────────────┼───────────────┘
                              │
                         Control Policy
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

这个结构和前面整个 Agent Control Plane 的设计是可以直接拼起来的。

---

# 一百二十九、最终统一模型

可以把 Approval Policy 压缩成：

```text id="q8tscf"
ApprovalPolicy
│
├── Eligibility
│
├── Voter Resolution
│
├── Voter Snapshot
│
├── Routing
│
├── Positive Quorum
│
├── Negative Rule
│
├── Independence / SoD
│
├── Scope Binding
│
├── Completion
│
├── Timeout
│
├── Escalation
│
└── Version
```

其中：

```text id="1z5d5j"
ANY
ALL
K-of-N
%
```

只是：

```text id="aw0ct7"
Positive Quorum
```

的不同写法。

---

# 一百三十、最终的工程化原则

### 原则 1

> **ANY / ALL 不是两种 Runtime，它们只是 Required Votes 的特殊情况。**

```text
ANY = 1 vote
ALL = N votes
```

---

### 原则 2

> **Voter Resolution 必须先于 Vote Counting。**

先确定：

```text
谁有资格投票
```

再计算：

```text
需要几票
```

---

### 原则 3

> **Routing 与 Voting 是两个不同维度。**

```text
Parallel / Sequential
```

描述：

> 什么时候让谁投票。

```text
ANY / ALL / K-of-N
```

描述：

> 这些票如何共同决定结果。

---

### 原则 4

> **Approval Threshold 与 Rejection Rule 必须分离。**

```text
2 approvals
```

不自动意味着：

```text
1 rejection = reject
```

---

### 原则 5

> **Approval Result 应由 Vote Ledger + Policy Deterministically Derived。**

不要允许任意客户端直接写：

```text
approved = true
```

---

### 原则 6

> **Approval Instance 必须绑定 Proposal Scope 和 Policy Version。**

否则：

```text
Approve A
```

很容易演变成：

```text
Execute B
```

---

### 原则 7

> **K-of-N 不自动等于 Four-eyes / SoD。**

还需要：

```text
independence
role separation
maker exclusion
group separation
```

---

### 原则 8

> **Role Quorum 比简单 K-of-N 更适合金融关键流程。**

例如：

```text
1 PM + 1 Compliance
```

通常比：

```text
2 of 3
```

更准确表达业务控制意图。

---

### 原则 9

> **Decision 达成后是否立即终止，必须显式定义。**

```text
EARLY_DECISION
```

和：

```text
COLLECT_ALL_RESPONSES
```

是不同语义。

---

### 原则 10

> **Impossible quorum 必须即时终止，不能无限等待。**

核心判断：

```text
approved + pending < required
```

即：

```text
approval impossible
```

---

# 一百三十一、最终建议的最小产品能力

如果设计一个真正可复用的企业 Approval Service，我建议至少支持：

```text id="qh2l0o"
1. Eligible Voter Resolution

2. Snapshot / Dynamic voter policy

3. Parallel / Sequential routing

4. ANY / ALL / K-of-N

5. Percentage / Majority

6. Any Reject / Reject K / Veto

7. Role Quorum

8. Maker-Checker exclusion

9. Independence constraints

10. Approval Scope

11. Policy Version

12. Vote Ledger

13. Early Termination

14. Impossible Quorum Detection

15. Timeout

16. Escalation / Delegation

17. Reassignment

18. Explain Decision

19. Policy Simulation

20. Immutable Audit
```

而：

```text id="i5c7mf"
UI
Teams
Outlook
Email
Agent
```

都只是：

```text id="f9jyqx"
Approval Interaction Clients
```

不应该自行实现 Approval Semantics。

---

# 一百三十二、最终结论

真正成熟的 Approval System，不应该从：

```text id="p3pudb"
ANY
ALL
```

开始设计。

应该从：

```text id="j2i9ri"
Who can vote?
```

开始。

然后：

```text id="fnbwdo"
Who can vote?
        ↓
How are they routed?
        ↓
What counts as approval?
        ↓
What counts as rejection?
        ↓
How many approvals are required?
        ↓
Are votes independent?
        ↓
What is the approved scope?
        ↓
When is the decision final?
        ↓
What happens on timeout?
        ↓
How is the decision enforced?
```

因此一个完整的 Approval Policy 可以概括为：

```text id="2ui7gr"
              Approval Policy

       ┌──────── Eligibility ────────┐
       │                             │
       ▼                             ▼
 Voter Resolution                Scope Binding
       │                             │
       └─────────────┬───────────────┘
                     │
                  Routing
                     │
           ┌─────────┴─────────┐
           │                   │
        Parallel            Sequential
           │                   │
           └─────────┬─────────┘
                     │
                 Vote Ledger
                     │
              Policy Evaluation
                     │
        ┌────────────┼────────────┐
        │            │            │
     Approved     Rejected      Pending
        │            │            │
        └────────────┼────────────┘
                     │
                 Finality
                     │
              Authorization
                     │
                  Command
```

最后可以把整个设计压缩成一句：

> **ANY / ALL / Required Votes 不是 Approval Policy 本身，它们只是 Policy 中“如何从一组具备资格的、独立且范围明确的 Vote 得出最终 Decision”的一部分。**

对于金融 Agent，最重要的不是：

> “几个人点了 Approve？”

而是：

> **谁有资格投票、为什么有资格、这些投票是否独立、投票针对什么版本的 Proposal、当前规则是什么、什么时候已经形成不可逆的 Decision，以及这个 Decision 如何转换成真正受 Authorization 控制的 Command。**

这才是一个可以进入生产金融 Workflow 的 Approval Engine。

---

## 参考资料

**Microsoft Power Automate — Approvals**
Microsoft 当前提供 Everyone must approve、First to respond、Custom Responses、Sequential approval 等多种 Approval Type，并明确区分“所有人响应”与“任意人响应”等行为。([learn.microsoft.com](https://learn.microsoft.com/en-us/power-automate/get-started-approvals?utm_source=chatgpt.com))

**Microsoft Power Automate — Everyone Must Approve**
明确说明“所有人必须批准”可以被单个 Reject 提前终止，非常适合作为 `approval threshold` 与 `rejection rule` 分离的实际例子。([learn.microsoft.com](https://learn.microsoft.com/en-us/power-automate/all-assigned-must-approve?utm_source=chatgpt.com))

**Microsoft Power Automate — Group Approvals**
展示 Group Approval 中“一组算一个候选来源还是组内成员参与”的实际行为，例如 First-to-respond 的 Group 只需一个组员响应，而 Everyone 模式要求每个指定 Group 至少有成员完成相应响应。([learn.microsoft.com](https://learn.microsoft.com/en-us/power-automate/group-approvals?utm_source=chatgpt.com))

**Oracle Approvals Management — Voting Regimes**
Oracle 将 Serial、Consensus、First-Responder-Wins 等 Voting Regime 与 Approver Group 分开建模，是“Routing 与 Voting 分离”的典型企业实现。([oracle.com](https://docs.oracle.com/cd/E18727-01/doc.121/e13516/T405156T405164.htm?utm_source=chatgpt.com))

**Oracle Fusion Cloud Procurement — Approval Task**
Oracle 当前文档继续区分 Serial / Parallel / FYI participant routing 与 Serial / Consensus / First Responder Wins voting regime。([docs.oracle.com](https://docs.oracle.com/en/cloud/saas/procurement/25c/oapro/approval-task.html?utm_source=chatgpt.com))

**Oracle — Approval Rules**
Oracle 的 Approval Rules 将“条件决定是否进入某个审批路径”与“Participant 中包含哪些 Approver”分开，是 Approval Eligibility 与 Voting 分层的很好例子。([docs.oracle.com](https://docs.oracle.com/en/cloud/saas/procurement/25c/oapro/various-aspects-of-approval-rules.html?utm_source=chatgpt.com))

**IBM Business Automation Workflow — Approval Completion Criteria**
IBM 支持 One、All、Minimum Percentage、Specific Number，并提供 One Approval、One Disapproval、Percentage、Majority Reached 等 Completion Criterion。([ibm.com](https://www.ibm.com/docs/en/baw/24.0.x?topic=editor-completion-tab-human-task&utm_source=chatgpt.com))

**IBM watsonx / Governance Artifact Workflow — Approval Count Rules**
IBM 当前 Workflow 仍支持 One、All、Minimum Percentage、Specific Number，并对不可能满足的 required approver 数量给出明确约束。([ibm.com](https://www.ibm.com/docs/en/watsonx/wdi/2.4.x?topic=workflows-managing-governance-artifact&utm_source=chatgpt.com))

**ServiceNow — Approval Rules**
ServiceNow 的 Approval Rules 包括 Anyone、All、All Responded + Anyone、Percentage 和 Number 等模式，说明“投票阈值 + 响应收集”的组合是常见企业实现。([servicenow.com](https://www.servicenow.com/community/workflow-automation-blogs/scripted-approvals-in-flow-designer-with-flow-variables/ba-p/2284506?utm_source=chatgpt.com))

**AWS Step Functions — Human Approval**
AWS Step Functions 采用 Callback / Task Token 模式实现 Workflow 等待外部批准，说明 Approval 本身应成为 Workflow Control Plane 的确定性等待状态，而不是一个仅存在于 UI 的按钮。([docs.aws.amazon.com](https://docs.aws.amazon.com/step-functions/latest/dg/tutorial-human-approval.html?utm_source=chatgpt.com))

**Basel Committee on Banking Supervision — Core Principles**
Basel Core Principles 把 checks and balances / four-eyes principle 与职责分离、cross-checking、dual control、double signatures，以及关键职能分离联系起来；这说明金融审批中的“多票”并不自动等于独立控制。([bis.org](https://www.bis.org/committees/bcbs/basel-framework/standard/bcp/40/inforce/2024-04-25/published/2024-04-25))

---

### 和前面几篇的最终连接

到这里，前面的几个设计已经可以组成一条非常清晰的链：

```text id="e8p9w5"
Agent
  ↓
Proposal
  ↓
Human Task
  ↓
Approval Policy
  │
  ├── Eligibility
  ├── Voter Resolution
  ├── Routing
  ├── ANY / ALL / K-of-N
  ├── Role Quorum
  ├── Maker-Checker
  └── Approval Scope
  ↓
Decision
  ↓
Authorization
  ↓
Command
  ↓
Domain
  ↓
Business State
  ↓
Audit
```

因此从平台架构角度看，**Approval Policy 不应该是 Human Task Service 里的一个简单 `approval_type` 字段，而应该是 Control Plane 中一个独立、确定性、版本化、可解释、可测试的 Policy Component。**

这也是 `ANY / ALL / Required Votes` 真正工程化之后最重要的架构结论。

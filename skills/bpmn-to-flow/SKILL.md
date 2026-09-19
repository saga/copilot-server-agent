---

name: bpmn-to-flow
description: 将 BPMN 2.0 流程模型转换为当前平台的 Skill Flow，并生成转换报告。
--------------------------------------------------------

# BPMN → Skill Flow

## Purpose

将 BPMN 2.0 XML 流程模型转换为当前平台支持的 Skill Flow。

输入可以来自 Fluxnova、Camunda 或其他兼容 BPMN 2.0 的建模工具。

输出：

1. `SKILL.md`：可供当前 Skill Flow Runtime 使用的流程定义
2. `conversion-report.md`：完整转换报告

转换必须保持原 BPMN 的业务控制流语义。

**不得为了提高转换成功率而擅自改变流程语义。**

---

# Conversion Principles

## 1. BPMN 是业务流程来源

BPMN 描述业务流程。

Skill Flow 描述 Agent-enabled business workflow。

转换目标不是复制所有 BPMN 能力，而是把能够准确表达的部分转换成：

```text
@flow
@agent
@gate
@review
@action
@stop
@end
```

当前 Skill Flow 不支持的 BPMN 语义必须明确报告。

---

## 2. BPMN XML 必须由脚本解析

不得直接让 LLM 阅读原始 BPMN XML 并自行建立流程图。

必须先运行：

```bash
node scripts/parse-bpmn.mjs <input.bpmn> --output <bpmn.json>
```

脚本负责：

* 解析 BPMN XML
* 校验 BPMN XML
* 识别 process
* 识别 nodes
* 识别 sequence flows
* 识别 lanes
* 识别 documentation
* 识别 candidate users / groups
* 识别 BPMN extensions
* 识别 DMN / decision references
* 识别 conditions
* 识别 unsupported elements

LLM 只能使用脚本产生的结构化 BPMN 数据进行语义转换。

---

# Conversion Pipeline

必须严格按以下顺序执行：

```text
BPMN XML
   ↓
Parse
   ↓
Structural Validation
   ↓
Build BPMN Graph
   ↓
Classify Nodes
   ↓
Map Roles
   ↓
Generate Flow Skill
   ↓
Generate Conversion Report
   ↓
Run Skill Flow Validator
   ↓
Final Result
```

任何阶段发现无法安全转换，都必须进入：

```text
NEEDS_REVIEW
```

或：

```text
UNSUPPORTED
```

不得静默猜测。

---

# Input

输入必须包含一个 BPMN 2.0 XML 文件：

```text
*.bpmn
*.xml
```

可以来自：

* Fluxnova
* Camunda Modeler
* BPMN.io
* 其他 BPMN 2.0 编辑器

如果存在多个 process：

* 默认只转换指定 process
* 如果没有指定 process，且文件包含多个 process，必须报告 `NEEDS_REVIEW`
* 不得随机选择一个 process

---

# Output

输出目录：

```text
<output>/
├── SKILL.md
├── conversion-report.md
└── bpmn.json
```

其中：

### `SKILL.md`

是最终生成的 Skill Flow。

### `conversion-report.md`

说明：

* 自动转换内容
* 需要人工确认的内容
* 不支持的 BPMN 元素
* Role Mapping
* Gate Mapping
* Action Mapping
* Flow 差异
* 未解决问题

### `bpmn.json`

是 BPMN 脚本解析后的结构化中间结果。

---

# BPMN → Skill Flow Mapping

## StartEvent

转换为：

```md
## @flow <flow-id>

start -> <first-node>
```

如果 StartEvent 有多个 outgoing flows：

* 如果语义明确表达默认分支，继续转换
* 否则 `NEEDS_REVIEW`

不得随机选择第一条。

---

# EndEvent

正常完成的 EndEvent：

```md
## @end <node-id>

<description>
```

如果 EndEvent 表示：

* rejected
* cancelled
* failed
* terminated
* aborted

则转换为：

```md
## @stop <node-id>

<description>
```

如果无法从 BPMN 名称、documentation 或上下文判断终止性质：

```text
NEEDS_REVIEW
```

---

# UserTask

默认转换为：

```md
## @review <node-id>

role: <business-role>

<description>

- approve -> <next>
- reject -> <next>
```

UserTask 表示：

> 需要真实人员作出业务决定。

以下 BPMN 信息可以帮助确定角色：

* lane
* candidateGroups
* candidateUsers
* assignee
* owner
* task documentation

---

# ManualTask

默认转换为：

```md
## @review <node-id>
```

如果 ManualTask 实际表示：

* 人工判断
* 人工批准
* 人工拒绝
* 人工确认

则使用 `@review`。

如果只是：

* 人工执行一个确定性操作

则可以提出 `@action` 候选，但必须记录为：

```text
NEEDS_REVIEW
```

因为 ManualTask 本身不足以证明它是业务审批还是人工操作。

---

# ServiceTask

ServiceTask 不允许机械转换成 `@agent`。

必须根据语义分类：

### AI / Analysis

例如：

```text
Analyze investment data
Summarize documents
Research customer
Generate report
```

转换：

```md
## @agent <node-id>
```

### Deterministic Decision

例如：

```text
Check compliance rules
Validate eligibility
Calculate risk limit
Evaluate policy
```

转换：

```md
## @gate <node-id>
```

### Business Mutation

例如：

```text
Submit transaction
Create customer
Publish report
Send notification
Update master data
```

转换：

```md
## @action <node-id>
```

### External / Unknown Service

如果无法判断：

```text
NEEDS_REVIEW
```

不得自动转换成 Agent。

---

# BusinessRuleTask

优先转换为：

```md
## @gate <node-id>
```

如果 BPMN 指向 DMN Decision：

```text
BusinessRuleTask
      ↓
DMN Decision
      ↓
FlowGate
```

只生成：

```md
## @gate <node-id>

<description>

- <outcome> -> <next>
```

不要把 DMN decision table 翻译成自然语言规则。

实际判断应继续由服务端注册的 `FlowGate` / DMN engine 执行。

---

# ExclusiveGateway

转换为：

```md
## @gate <node-id>

根据注册的业务规则进行判断。

- <outcome-1> -> <next-1>
- <outcome-2> -> <next-2>
```

Gateway condition 必须分析。

如果存在明确业务条件：

```text
condition → outcome
```

应生成稳定的 outcome 名称。

例如：

```text
${riskScore < 50}
```

不要生成：

```md
- riskScore < 50 -> approved
```

而应该：

```md
## @gate risk-check

根据注册的风险规则进行判断。

- acceptable -> approved
- escalation -> manual-risk-review
- rejected -> rejected
```

条件表达式可以写入 `conversion-report.md`，但不应直接成为 Flow Runtime 的业务规则。

---

# ParallelGateway

当前版本不支持自动转换。

如果发现：

```text
bpmn:ParallelGateway
```

必须：

```text
UNSUPPORTED
```

不得把并行流程自动串行化。

例如：

```text
        ┌→ Compliance ─┐
Start ──┤               ├→ Approval
        └→ Risk ────────┘
```

不能转换成：

```text
Compliance
   ↓
Risk
   ↓
Approval
```

因为这会改变原流程语义。

---

# InclusiveGateway

当前版本不支持自动转换。

结果：

```text
UNSUPPORTED
```

---

# EventBasedGateway

当前版本不支持自动转换。

结果：

```text
UNSUPPORTED
```

---

# Timer Event

当前版本不转换成 Flow Node。

必须报告：

```text
UNSUPPORTED
```

例如：

```text
wait 24 hours
wait until deadline
```

属于 runtime scheduler 能力，不属于当前 Flow DSL。

---

# Message Event

当前版本不转换。

报告为：

```text
UNSUPPORTED
```

因为它需要 external event / message subscription runtime。

---

# Signal Event

当前版本不转换。

报告为：

```text
UNSUPPORTED
```

---

# MultiInstance

当前版本不转换。

例如：

```text
approve all reviewers
run for every account
```

都必须：

```text
UNSUPPORTED
```

不得假定是串行执行。

---

# SubProcess

默认不展开。

如果 SubProcess 内部流程只有：

* agent
* gate
* review
* action
* stop
* end

且没有 unsupported BPMN 元素，可以提出：

```text
NEEDS_REVIEW
```

要求人工确认是否展开。

不得自动把复杂 SubProcess 扁平化。

---

# CallActivity

当前版本不直接转换。

如果 CallActivity 指向另一个可以独立转换的 process：

```text
NEEDS_REVIEW
```

不要自动模拟为普通 `@agent`。

未来可以映射为独立 Skill / Flow invocation。

---

# SequenceFlow

普通 BPMN SequenceFlow 转换为：

```md
- <outcome> -> <target>
```

必须保持：

```text
source
→ target
```

的真实方向。

不得：

* 反转
* 合并
* 删除
* 自动跳过节点

---

# Gateway Condition

条件必须保留其业务语义。

不能直接把 BPMN expression 复制进 Skill Flow 并假设 Flow Runtime 能执行。

例如：

```xml
${amount > 1000000}
```

转换为：

```md
## @gate amount-check

根据注册的大额交易规则进行判断。

- standard -> normal-review
- high-value -> investment-committee
```

同时在：

```text
conversion-report.md
```

记录：

```text
Original condition:
${amount > 1000000}
```

---

# Role Mapping

BPMN 中可能存在：

```text
Lane
candidateGroups
candidateUsers
assignee
owner
```

这些不能直接写入 SKILL.md。

禁止：

```md
role: APP-FIL-COMPLIANCE
```

禁止：

```md
ad-group: xxx
```

禁止：

```md
role: 3a7fxxxx-xxxx
```

Skill 中只能使用：

```text
Business Role ID
```

例如：

```md
role: compliance.reviewer
```

---

# Role Resolution

角色映射必须依次尝试：

```text
BPMN role metadata
       ↓
Business Role Registry
       ↓
Business Role ID
```

例如：

```text
BPMN:
Compliance Reviewers

        ↓

Role Registry:
compliance.reviewer

        ↓

SKILL.md:
role: compliance.reviewer
```

AD / Entra Group 映射永远由服务端维护。

不要把 AD Group 写入生成的 Skill。

---

# Role Mapping Failure

如果：

```text
Compliance Reviewers
```

无法映射到 Business Role：

不得猜测：

```text
role: compliance.reviewer
```

必须输出：

```text
NEEDS_REVIEW
```

并在 `conversion-report.md`：

```md
## Unresolved Role Mapping

BPMN Group:

Compliance Reviewers

Suggested Role:

compliance.reviewer

Confidence:

medium

Action:

需要人工确认 Business Role 映射。
```

---

# @review Mapping

生成的 Review：

```md
## @review compliance-review

role: compliance.reviewer

<description>

- approve -> next
- reject -> rejected
```

不要自动生成：

```text
strategy
required
exclude
```

除非 BPMN 明确表达了这些语义。

如果 BPMN 明确要求：

```text
all reviewers
2 of 3 reviewers
sequential approval
```

应根据当前 Skill Flow 支持能力进行转换。

无法准确表达时：

```text
NEEDS_REVIEW
```

不要近似转换。

---

# @review Approval Semantics

BPMN：

```text
All three reviewers must approve
```

只有在当前 Review Policy 能准确表达时才生成：

```md
strategy: ALL
```

BPMN：

```text
Any one reviewer
```

可以：

```md
strategy: ANY
required: 1
```

BPMN：

```text
Two of three
```

如果当前 `@review` policy 支持：

```md
strategy: ANY
required: 2
```

则可以转换。

否则：

```text
NEEDS_REVIEW
```

不得使用错误的近似策略。

---

# @agent Mapping

只有具备明显 AI / analysis / research / generation 语义的 BPMN Task 才建议转换成：

```md
## @agent <node-id>

output: <contract>

<description>

- success -> <next>
- fail -> <failure>
```

例如：

```text
Research customer
Analyze investment
Summarize documents
Generate report
```

---

# @agent Completion Contract

如果能够确定输出类型：

```text
research report
risk assessment
analysis package
```

应查找已有 `FlowOutput` registry。

如果存在：

```md
output: research.analysis
```

如果不存在：

```text
NEEDS_REVIEW
```

不得自行创建新的完成契约。

如果无法定义可靠的完成条件：

```text
NEEDS_REVIEW
```

---

# @agent Tools

不要从 BPMN 自动推导：

```md
tools: mcp
```

不要生成：

```md
tools: shell
```

默认不增加 tools 属性。

Agent 能力由服务端配置和现有 Tool Policy 决定。

---

# @action Mapping

具有业务副作用的节点优先转换为：

```md
## @action <node-id>

<description>

- success -> <next>
- fail -> <failure>
```

例如：

```text
Create supplier
Publish report
Submit vote
Send external notification
Create transaction
```

如果能找到对应的 FlowAction Registry：

```text
BPMN action
     ↓
FlowAction
```

可以自动转换。

如果不存在对应的注册 Action：

```text
NEEDS_REVIEW
```

不要生成一个不存在的 action。

---

# @action Role

如果 BPMN 明确要求特定角色执行或批准 Action：

```md
role: <business-role>
```

但该 Role 必须已经存在于服务端注册的 ActionPolicy。

如果不存在：

```text
NEEDS_REVIEW
```

---

# Agent / Gate / Review / Action 的优先级

当同一个 BPMN Task 有多个可能解释时，使用以下原则：

```text
明确的人工作决定
        ↓
@review

明确的确定性规则
        ↓
@gate

明确的业务副作用
        ↓
@action

明确的 AI / analysis 工作
        ↓
@agent
```

不要因为任务名称出现：

```text
"process"
"handle"
"check"
"review"
```

就自动分类。

必须结合：

* BPMN type
* name
* documentation
* lane
* implementation
* DMN reference
* outgoing conditions
* candidate roles
* related nodes

进行判断。

---

# Mapping Precedence

当多个 BPMN 信息冲突时：

```text
明确 BPMN implementation
>
DMN / decision reference
>
BPMN type
>
lane / role
>
documentation
>
name
>
LLM semantic inference
```

LLM inference 永远是最低优先级。

---

# Unsupported Policy

发现无法准确表示的 BPMN 语义时：

必须：

```text
UNSUPPORTED
```

或者：

```text
NEEDS_REVIEW
```

不得：

```text
猜测
简化
串行化
删除
绕过
```

尤其禁止：

* 把 Parallel Gateway 串行化
* 把 Timer 删除
* 把 UserTask 变成 Agent
* 把 BusinessRuleTask 变成 LLM 判断
* 把 ServiceTask 变成 Agent
* 把 DMN 规则翻译成自然语言并声称等价
* 把 AD Group 写成 Skill Role
* 把不存在的 Action / Gate / Output Registry 写进 Skill

---

# Conversion Confidence

每一个重要转换都应记录：

```text
AUTO
NEEDS_REVIEW
UNSUPPORTED
```

建议：

### AUTO

结构和语义都明确。

### NEEDS_REVIEW

结构明确，但业务语义存在判断。

### UNSUPPORTED

当前 Skill Flow 无法表达原 BPMN 语义。

---

# Conversion Report

必须生成：

```md
# BPMN → Skill Flow Conversion Report

## Source

- File:
- Process:
- BPMN version:

## Summary

- AUTO:
- NEEDS_REVIEW:
- UNSUPPORTED:

## Automatically Converted

...

## Requires Review

...

## Unsupported

...

## Role Mapping

...

## Gate Mapping

...

## Action Mapping

...

## Semantic Differences

...

## Unresolved Items

...
```

---

# Semantic Preservation

转换完成后必须验证以下不变量：

## Reachability

每个转换后的节点必须从 `start` 可达。

## Terminal Semantics

正常完成必须进入：

```text
@end
```

失败、拒绝、取消必须进入：

```text
@stop
```

## Decision Preservation

BPMN Gateway 的每个业务分支都必须拥有对应 Flow route。

不得丢失分支。

## Human Task Preservation

BPMN UserTask / ManualTask 如果代表审批或人工判断，不能转换成 Agent。

## Side Effect Preservation

BPMN 中存在业务副作用的节点不能转换成普通 Agent。

## Role Preservation

BPMN 中要求人工角色的任务不能丢失 Role Mapping。

## Unsupported Preservation

不能表达的 BPMN 语义必须保留在转换报告中。

---

# Generated Skill Requirements

生成的 `SKILL.md` 必须符合当前 Skill Flow 规则：

```text
@flow
@agent
@gate
@review
@action
@stop
@end
```

必须：

* 使用 `## @...`
* route 使用 `- outcome -> target`
* node ID 唯一
* route target 存在
* terminal node 不允许 route
* 非 terminal node 必须有 route
* route outcome 不得重复
* 所有节点从 start 可达
* `@agent` 只能使用 `success / fail`
* `@review` 只能使用 `approve / reject`
* `@action` 只能使用 `success / fail`
* `@gate` 必须使用注册表声明的 outcomes
* `role` 必须是 Business Role
* `output` 必须是已注册 FlowOutput
* `tools` 只能在服务端允许范围内收窄
* 不得在 Skill 中声明 AD Group

---

# Generated Skill Must Not Invent Registry Entries

转换器只能引用已经存在的：

```text
FlowGate
FlowReview
FlowAction
FlowOutput
BusinessRole
```

如果 BPMN 需要一个目前不存在的：

```text
FlowGate
```

则必须：

```text
NEEDS_REVIEW
```

并报告：

```text
Missing Registry Entry:
compliance.check
```

不要自动创建一个假的 Registry ID。

---

# Validation

生成 `SKILL.md` 后必须使用当前 Skill Flow Validator 验证。

等价于：

```text
SKILL.md
   ↓
parseSkillFlow()
   ↓
validateSkillFlow()
```

如果验证失败：

```text
conversion status = NEEDS_REVIEW
```

不得报告：

```text
conversion = successful
```

---

# Final Classification

最终转换结果必须属于以下之一：

## SUCCESS

满足：

* 没有 UNSUPPORTED
* 没有未解决的关键 NEEDS_REVIEW
* Skill Flow Validator 通过

## NEEDS_REVIEW

存在：

* Role mapping 未解决
* Gate mapping 未解决
* Action mapping 未解决
* Agent output contract 未解决
* 审批策略无法准确映射
* BPMN 语义需要业务人员确认

但已经能够生成候选 `SKILL.md`。

## UNSUPPORTED

存在无法安全表达的核心 BPMN 语义，例如：

* Parallel Gateway
* Event Based Gateway
* Multi Instance
* Timer-driven workflow
* Complex Message/Event orchestration
* 无法保真的复杂 SubProcess

此时不得生成声称可执行的 Flow。

---

# Example

输入：

```text
investment-approval.bpmn
```

BPMN：

```text
Start
  ↓
Investment Analysis
  ↓
Compliance Check
  ↓
Gateway
 ├── pass → Investment Committee Approval
 ├── review → Compliance Review
 └── fail → End Rejected
                    │
                    ↓
                 Publish
                    │
                    ↓
                   End
```

转换为：

```md
## @flow investment-approval

start -> investment-analysis

## @agent investment-analysis

output: investment.analysis

完成投资分析。

- success -> compliance-check
- fail -> analysis-failed

## @gate compliance-check

根据注册的合规规则进行判断。

- pass -> investment-committee
- review -> compliance-review
- fail -> compliance-rejected

## @review compliance-review

role: compliance.reviewer

处理需要人工判断的合规事项。

- approve -> investment-committee
- reject -> compliance-rejected

## @review investment-committee

role: investment.committee.member

完成投资委员会审批。

- approve -> publish
- reject -> investment-rejected

## @action publish

发布已经批准的研究结果。

- success -> completed
- fail -> publish-failed

## @stop analysis-failed

投资分析无法完成。

## @stop compliance-rejected

交易未通过合规要求。

## @stop investment-rejected

投资委员会未批准。

## @stop publish-failed

发布失败。

## @end completed

流程完成。
```

---

# Final Safety Rule

**本 Skill 的目标不是把 BPMN 100% 翻译成 Skill Flow。**

目标是：

> **只转换能够保持业务语义、权限边界、人工行为和副作用语义的部分。**

因此：

```text
高转换率
≠
高质量转换
```

正确目标是：

```text
准确转换
>
完整转换
```

任何无法确定的部分：

```text
NEEDS_REVIEW / UNSUPPORTED
```

而不是由 LLM 猜测。

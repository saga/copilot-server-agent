# Skill Flow

Skill Flow 是在标准 `SKILL.md` Markdown 中加入少量保留关键字，用来描述一个 Skill 的**业务执行流程**。

它不负责定义 Agent Runtime、权限模型或企业安全边界，而只描述：

* 哪一步由 Agent 执行
* 哪一步由确定性规则判断
* 哪一步需要人工处理
* 哪一步执行业务动作
* 每一步完成后流向哪里
* 哪些情况直接结束流程

Skill Flow 采用普通 Markdown，不引入 BPMN、XML、YAML Workflow DSL 或复杂编程语言。

---

## 1. 设计原则

Skill Flow 遵循以下原则：

### 1.1 Markdown 优先

`SKILL.md` 首先仍然是一份给人阅读的 Skill 文档。

例如：

```md
# Investment Research

## Purpose

Analyze an investment opportunity and prepare a research report.

## Instructions

...
```

这些普通 Markdown 不参与 workflow execution。

只有使用保留格式：

```md
## @flow ...
## @agent ...
## @gate ...
## @review ...
## @action ...
## @stop ...
## @end ...
```

的部分具有机器可执行语义。

---

### 1.2 Workflow 只描述业务流程，不描述权限

Skill Flow 可以写：

```md
## @review investment-review
```

但不能写：

```md
eligibleRoles: portfolio-manager
```

也不能写：

```md
allow: portfolio-manager
```

原因是：

> `SKILL.md` 可以被 Agent / Skill 作者修改，但企业授权边界不能由 LLM 或 Skill 文本自行定义。

角色、权限、SoD、tenant、policy、审批资格等继续由服务端 registry / policy system 控制。

---

### 1.3 Agent 可以推理，但不能决定企业边界

`@agent` 表示：

> 这一阶段由 Copilot Agent 执行。

它可以：

* 阅读资料
* 调用工具
* 使用 MCP
* 生成分析结果
* 根据上下文进行推理

但不能自行决定：

* 是否满足合规要求
* 是否有审批权限
* 是否可以执行高风险动作
* 是否可以突破 Data Entitlement

这些由 `@gate`、`@review`、`@action` 对应的服务端逻辑决定。

---

### 1.4 Gate 必须是确定性的业务判断

`@gate` 表示：

> 对当前业务状态执行一个服务端定义的确定性判断。

例如：

```md
## @gate compliance
```

实际执行：

```text
Flow
  ↓
ComplianceGate
  ↓
Policy / Rules / External Decision Service
  ↓
pass / review / fail
```

而不是：

```text
LLM
  ↓
"I think this is compliant"
```

---

### 1.5 Review 表示真正的人工流程

`@review` 表示：

> 流程需要一个由服务端定义的 Human Task / Approval。

具体：

* 谁有资格审批
* 是否需要两人审批
* 是否要求 SoD
* 超时怎么办
* 是否允许代理人
* 是否允许委派

都不写在 Skill Flow 里，而由 `HumanTaskService` / `ApprovalService` / policy registry 决定。

---

### 1.6 Action 表示业务副作用

`@action` 表示：

> 当前节点要执行一个受控的业务操作。

例如：

```md
## @action publish
```

并不意味着 Agent 可以直接：

```text
POST /publish
```

而是：

```text
Skill Flow
   ↓
Action registry
   ↓
ActionIntent
   ↓
ActionPolicy
   ↓
Approval / Authorization
   ↓
ActionService
   ↓
Business mutation
```

因此：

> `@action` 是业务动作的声明，不是直接授予 Agent 执行权限。

---

# 2. 保留关键字总览

当前只保留下面 7 个：

| 关键字       | 作用            | 是否执行代码 | 是否允许自然语言正文 |
| --------- | ------------- | -----: | ---------: |
| `@flow`   | 定义一个 workflow |      否 |          是 |
| `@agent`  | Agent 执行步骤    |      是 |          是 |
| `@gate`   | 确定性业务判断       |      是 |          是 |
| `@review` | 人工审核 / 审批     |      是 |          是 |
| `@action` | 受控业务动作        |      是 |          是 |
| `@stop`   | 明确终止流程        |      是 |          是 |
| `@end`    | 正常结束流程        |      是 |          是 |

不再使用：

```text
@subagent
@route
```

---

# 3. `@flow`

## 语法

```md
## @flow <flow-id>
```

例如：

```md
## @flow investment-review
```

`@flow` 是整个 workflow 的入口。

一个 Skill 中：

* 必须有且只有一个 `@flow`
* `flow-id` 必须唯一
* 必须包含一个 `start -> <node>` 路由
* `start` 必须指向一个存在的节点

例如：

```md
## @flow investment-review

start -> investment-research
```

---

## 作用

`@flow` 本身不执行 Agent。

它只定义：

> 整个业务流程从哪里开始。

---

# 4. `@agent`

## 语法

```md
## @agent <node-id>

<instructions>

- <outcome> -> <next-node>
- <outcome> -> <next-node>
```

例如：

```md
## @agent investment-research

Analyze the investment opportunity.

Review:

- company fundamentals
- valuation
- competitive position
- key risks

Produce a structured research result.

- success -> compliance
- fail -> research-failed
```

---

## 作用

`@agent` 表示：

> 这一阶段交给 Agent Runtime 执行。

在当前实现中，它由 Copilot SDK 执行一个 Agent turn。

因此：

```text
@agent
   ↓
Copilot SDK
   ↓
Agent reasoning
   ↓
Tool / MCP / Skill
   ↓
result
```

未来如果 Copilot SDK 自己提供更完整的 agent/sub-agent orchestration，也不影响 Skill Flow。

---

## Outcome

当前默认结果：

```text
success
fail
```

即：

```md
- success -> next
- fail -> failure
```

`@agent` 的业务意义不是“调用一个新的独立 Agent 实例”，而是：

> 当前流程进入一个 Agent execution step。

如果未来需要真正多 Agent，可以在 Agent Runtime 层实现，而不需要改变 Skill Flow 语法。

---

# 5. `@gate`

## 语法

```md
## @gate <node-id>

<description>

- <outcome> -> <next-node>
```

例如：

```md
## @gate compliance

Evaluate whether the research package satisfies compliance requirements.

Use the registered compliance policy.

- pass -> investment-review
- review -> compliance-review
- fail -> compliance-rejected
```

---

## 作用

`@gate` 是：

> 确定性的业务判断节点。

它对应服务端注册的 `FlowGate`：

```ts
interface FlowGate {
  name: string;

  evaluate(ctx): Promise<{
    outcome: string;
    reason?: string;
  }>;
}
```

例如：

```text
@gate compliance
        ↓
ComplianceGate
        ↓
Compliance Policy
        ↓
pass / review / fail
```

---

## 重要约束

`@gate` 的决定不能由 Skill 文本中的自然语言直接定义。

例如：

```md
## @gate compliance

The agent decides whether the investment is compliant.
```

这种写法虽然可以作为说明文字，但不能成为真正的 policy authority。

真正 authority 是：

```text
FlowGate Registry
Policy Engine
Rules
External Compliance Service
```

---

# 6. `@review`

## 语法

```md
## @review <node-id>

<description>

- approve -> <next-node>
- reject -> <next-node>
```

例如：

```md
## @review investment-review

The investment proposal requires human approval.

- approve -> publish
- reject -> investment-rejected
```

---

## 作用

`@review` 表示：

> 流程进入 Human Task。

它通常产生：

```text
HumanTask
    ↓
waiting
    ↓
approve / reject
    ↓
resume workflow
```

---

## 服务端负责什么

Skill Flow 不定义：

```text
who can approve
how many people
SoD
delegation
timeout
tenant
external approver
```

这些由：

```text
HumanTaskService
ApprovalService
Policy Registry
```

负责。

例如：

```text
@review investment-review
```

服务端可能实际配置：

```text
eligibleRoles:
  - portfolio-manager
  - investment-committee

strategy:
  ALL

requiredCount:
  2
```

这些配置不属于 Skill Flow。

---

# 7. `@action`

## 语法

```md
## @action <node-id>

<description>

- success -> <next-node>
- fail -> <next-node>
```

例如：

```md
## @action publish

Publish the approved research report.

- success -> completed
- fail -> publish-failed
```

---

## 作用

`@action` 是：

> 一个具有业务副作用的受控操作。

它对应：

```ts
FlowAction
```

例如：

```text
@action publish
       ↓
ActionRegistry
       ↓
ActionIntent
       ↓
ActionPolicy
       ↓
ActionService
```

---

## 为什么不让 Agent 直接执行

因为：

```text
Agent decision
```

和：

```text
Business authorization
```

必须分离。

典型流程：

```text
Agent
  ↓
propose ActionIntent
  ↓
Policy
  ↓
Approval
  ↓
ActionService
  ↓
Mutation
```

这也是整个设计里最重要的安全边界之一。

---

# 8. `@stop`

## 语法

```md
## @stop <node-id>

<description>
```

例如：

```md
## @stop compliance-rejected

The research package cannot continue because compliance requirements were not satisfied.
```

---

## 作用

`@stop` 表示：

> 明确终止流程，并且不是正常完成。

例如：

```text
research
   ↓
compliance
   ↓
fail
   ↓
compliance-rejected
   ↓
FAILED
```

---

## 约束

`@stop`：

* 不需要 route
* 不能有 route
* 不允许继续执行下一个 node

它是 terminal node。

---

# 9. `@end`

## 语法

```md
## @end <node-id>

<description>
```

例如：

```md
## @end completed

Investment research and publication completed successfully.
```

---

## 作用

`@end` 表示：

> 正常结束流程。

例如：

```text
publish
   ↓
success
   ↓
completed
   ↓
COMPLETED
```

和 `@stop` 的区别是：

```text
@stop
→ abnormal / rejected / failed terminal

@end
→ successful / normal terminal
```

---

# 10. Route

目前不增加 `@route`。

Route 直接使用：

```md
- <outcome> -> <target>
```

例如：

```md
- success -> compliance
- fail -> research-failed
```

这样做的原因是：

> Route 是节点的一部分，而不是一个独立业务实体。

---

## Route 规则

### 普通节点

```md
- success -> xxx
- fail -> yyy
```

### Gate

可以有多个 outcome：

```md
- pass -> xxx
- review -> yyy
- fail -> zzz
```

### Review

默认：

```md
- approve -> xxx
- reject -> yyy
```

### Stop / End

不能有 route。

---

## Route outcome 必须唯一

例如下面这种定义应当报错：

```md
- pass -> a
- pass -> b
```

因为运行时不能依赖“第一条 route 优先”。

Validator 应直接报告：

```text
duplicate route outcome: pass
```

---

# 11. 一个完整 Skill 的结构

推荐结构：

```md
# Skill Name

## Purpose

...

## Instructions

...

## @flow business-flow

start -> first-step

## @agent first-step

...

- success -> next-step
- fail -> failed

## @gate next-step

...

- pass -> review
- review -> manual-review
- fail -> rejected

## @review manual-review

...

- approve -> review
- reject -> rejected

## @review review

...

- approve -> action
- reject -> rejected

## @action action

...

- success -> completed
- fail -> action-failed

## @stop failed

...

## @stop rejected

...

## @stop action-failed

...

## @end completed

...
```

---

# 12. Sample 1：Investment Research

这个例子对应目前 repo 的实际 `investment-research` 场景。

```md
# Investment Research

## Purpose

Analyze an investment opportunity, perform compliance checks,
obtain the required investment approval, and publish the approved research.

## Instructions

When performing research:

- use approved research sources
- distinguish facts from assumptions
- identify material risks
- cite important evidence
- do not make investment decisions on behalf of an authorized reviewer
- do not publish content directly

## @flow investment-review

start -> investment-research

## @agent investment-research

Analyze the investment opportunity.

Cover:

- company fundamentals
- valuation
- competitive position
- market context
- material risks
- key assumptions

Produce a structured research package.

The result must contain enough evidence for downstream compliance
and human review.

- success -> compliance
- fail -> research-failed

## @gate compliance

Evaluate the research package against the registered compliance policy.

Check, where applicable:

- required evidence exists
- restricted information rules
- disclosure requirements
- prohibited content
- mandatory disclaimers

The gate decision must come from the registered compliance policy,
not from the Agent.

- pass -> investment-review
- review -> compliance-review
- fail -> compliance-rejected

## @review compliance-review

A compliance reviewer must resolve the compliance issue.

The reviewer may:

- approve continuation
- reject the research package

- approve -> investment-review
- reject -> compliance-rejected

## @review investment-review

The investment proposal requires human approval.

The reviewer should evaluate:

- research quality
- investment thesis
- material risks
- valuation assumptions
- compliance result

- approve -> publish
- reject -> investment-rejected

## @action publish

Publish the approved research report.

The operation is executed only through the registered
publish action and its associated authorization policy.

- success -> completed
- fail -> publish-failed

## @stop research-failed

Research could not be completed.

The workflow must remain in a failed terminal state
and preserve the execution evidence.

## @stop compliance-rejected

The research package did not satisfy the required compliance conditions.

## @stop investment-rejected

The required investment approval was not granted.

## @stop publish-failed

The investment research was approved but publication failed.

## @end completed

The research was approved and successfully published.
```

---

# 13. Sample 2：Proxy Voting

这个例子更能体现：

```text
Agent
+
deterministic gate
+
human approval
+
controlled action
```

而且比较适合金融业务。

```md
# Proxy Voting

## Purpose

Review a proxy voting item, prepare a voting recommendation,
obtain the required approval, and submit the approved vote.

## Instructions

When reviewing a proxy item:

- use approved issuer and meeting information
- identify the resolution and voting deadline
- summarize relevant research
- identify conflicts and escalation requirements
- never submit a vote directly
- do not bypass approval requirements

## @flow proxy-vote

start -> voting-analysis

## @agent voting-analysis

Analyze the proxy voting item.

Determine:

- meeting information
- resolution
- proposed voting position
- supporting evidence
- relevant policy considerations
- potential conflicts
- required escalation

Prepare a voting recommendation.

The recommendation is advisory and does not itself authorize submission.

- success -> policy-check
- fail -> analysis-failed

## @gate policy-check

Evaluate the recommendation against the registered proxy voting policy.

Check:

- policy coverage
- restricted issuer conditions
- conflict requirements
- escalation requirements
- filing deadline
- required supporting information

Possible outcomes:

- pass -> approval
- review -> escalation-review
- fail -> policy-rejected

## @review escalation-review

A designated compliance or governance reviewer must resolve
the policy escalation.

- approve -> approval
- reject -> policy-rejected

## @review approval

The voting instruction requires human approval.

The approval authority is determined by the server-side
eligibility and segregation-of-duties policy.

- approve -> submit-vote
- reject -> vote-rejected

## @action submit-vote

Submit the approved voting instruction through the registered
proxy voting action.

The action must:

- revalidate the approval
- verify the action hash
- verify the current voting instruction version
- enforce the action policy
- use an idempotency key
- record the submission result

- success -> completed
- fail -> submission-failed

## @stop analysis-failed

The voting recommendation could not be completed.

## @stop policy-rejected

The proposed voting instruction does not satisfy the applicable policy.

## @stop vote-rejected

The required human approval was not granted.

## @stop submission-failed

The vote was approved but could not be submitted successfully.

## @end completed

The approved proxy vote was successfully submitted.
```

---

# 14. 两个 Sample 的结构其实是完全一致的

虽然业务不同：

```text
Investment Research
```

和：

```text
Proxy Voting
```

最后都可以抽象成：

```text
@agent
   ↓
@gate
   ↓
@review
   ↓
@action
   ↓
@end
```

遇到问题：

```text
@agent
   ↓
@stop

@gate
   ↓
@stop

@review
   ↓
@stop

@action
   ↓
@stop
```

这正是目前这套 DSL 应该覆盖的范围。

---

# 15. 当前版本不要再继续增加关键字

暂时不要增加：

```text
@parallel
@loop
@condition
@subflow
@retry
@wait
@timeout
@human
@tool
@route
@policy
@permission
```

这些都很容易导致 DSL 膨胀。

例如：

```text
@retry
```

应该由 runtime / execution policy 处理，而不是 Workflow DSL。

```text
@permission
```

应该由 authorization / policy system 处理。

```text
@tool
```

应该由 Copilot SDK / MCP / tool registry 处理。

```text
@human
```

已经由 `@review` 表达。

```text
@route
```

已经由：

```md
- success -> next
```

表达。

---

# 16. 最终语义模型

因此整个 Skill Flow 可以压缩成一句话：

> **Agent 负责工作，Gate 负责判断，Review 负责审批，Action 负责副作用，Stop / End 负责终止状态，Flow 负责把它们连接起来。**

对应关系：

```text
@flow
  ↓
Business Process

@agent
  ↓
Agent Execution

@gate
  ↓
Deterministic Decision

@review
  ↓
Human Task / Approval

@action
  ↓
Authorized Business Mutation

@stop
  ↓
Failed / Rejected Terminal State

@end
  ↓
Successful Terminal State
```

而企业安全边界始终在 Skill Flow 之外：

```text
                 SKILL.md
                    │
             Skill Flow DSL
                    │
          ┌─────────┴─────────┐
          ↓                   ↓
     Agent Runtime       Business Policy
          ↓                   ↓
    Copilot SDK        Authorization / SoD
          │                   │
          └─────────┬─────────┘
                    ↓
               HumanTask
                    ↓
                Approval
                    ↓
              ActionService
                    ↓
              Business System
```

**这就是目前我建议固定下来的版本：`@flow / @agent / @gate / @review / @action / @stop / @end`。**

其中最关键的命名变化就是：

```text
@subagent  →  @agent
```

因为 Skill Flow 描述的是“这一步由 Agent 执行”，而不是要求 Skill DSL 自己定义什么叫 sub-agent；真正的 agent / sub-agent 层次应该交给 Copilot SDK 本身处理。

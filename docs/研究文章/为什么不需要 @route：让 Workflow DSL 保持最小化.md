# 为什么不需要 `@route`：让 Workflow DSL 保持最小化

> **核心结论**
>
> 如果 Workflow DSL 已经采用“节点 + 显式边”的图模型，那么通常不需要再增加一个 `@route` 来描述“下一步去哪里”。
>
> `@route` 很容易成为重复的控制流语法：节点已经通过连接关系表达了后继节点，再让节点内部声明 route，相当于同时维护两套控制流模型。
>
> 但这并不意味着 Workflow 不需要 routing。恰恰相反，**routing 是 Workflow 的核心能力；不需要的是一个额外的、与图连接关系重复的 `@route` 语法。**
>
> 对金融服务领域尤其如此：业务流程需要的是清晰、可审计、可验证的控制流，而不是更多 DSL 语法。对于确定性的业务流程，应尽量让控制流结构本身成为事实来源；对于动态 Agent 行为，则应把动态决策限制在明确的边界内，而不是通过 `@route` 把 Agent 的动态选择直接提升为 Workflow 控制流。

---

## 1. 问题从哪里开始

假设我们设计一个简单的 Workflow DSL：

```ts
@workflow
class ProxyVotingWorkflow {

  @task
  loadProposal()

  @task
  analyzeProposal()

  @review
  reviewVote()

  @command
  submitVote()
}
```

如果 DSL 已经允许这样连接：

```text
loadProposal
      ↓
analyzeProposal
      ↓
reviewVote
      ↓
submitVote
```

那么再增加：

```ts
@route(...)
```

就要回答一个问题：

> **Route 到底在表达什么，而普通的 Workflow graph 没有表达？**

如果它只是：

```ts
@route("reviewVote")
```

意思是：

```text
analyzeProposal → reviewVote
```

那么这个信息已经存在于 Workflow Graph 中。

再增加一份：

```text
Node A → Node B
```

和：

```text
Node A @route(Node B)
```

实际上是在维护两套 source of truth。

这就是 `@route` 最大的问题。

---

# 2. 先区分两个概念：Routing 与 `@route`

这是整个问题最容易被说错的地方。

**不需要 `@route` ≠ 不需要 routing。**

Workflow 必然需要 routing。

例如：

```text
                 ┌─────────────┐
                 │   Analyze   │
                 └──────┬──────┘
                        │
                 ┌──────┴──────┐
                 │             │
              approved      rejected
                 │             │
                 ↓             ↓
             Execute         Reject
```

这里存在明确的 routing：

```text
approved → Execute
rejected → Reject
```

问题只是：

> 应该通过什么语法表达？

如果 DSL 已经是 graph-oriented：

```ts
analyze
  .when("approved").to(execute)
  .when("rejected").to(reject)
```

那么再定义：

```ts
@route("approved", execute)
@route("rejected", reject)
```

并没有增加新的业务语义。

所以应该讨论的是：

```text
Routing
    ≠
@route syntax
```

而不是：

```text
不要 routing
```

---

# 3. Workflow 本质上就是一个有向图

传统 Workflow Engine 的核心模型本来就是：

```text
Node + Edge
```

例如 AWS Step Functions 将 Workflow 表达为 State Machine：

```text
Task
Choice
Parallel
Map
Wait
Succeed
Fail
```

其中 Task 是一个工作单元，而 Choice 负责选择不同执行路径。AWS 官方文档明确把 Task 与 Flow States 区分开：Task 执行工作，Flow State 控制 Workflow。
[1]

因此：

```text
        Task A
          │
          ↓
        Choice
        /    \
       /      \
      ↓        ↓
   Task B    Task C
```

本身已经完整表达：

```text
A → Choice → B
A → Choice → C
```

没有必要再让：

```text
Task A
```

内部保存：

```text
route = B / C
```

---

# 4. BPMN 也是同样的思想

BPMN 更能说明这个问题。

BPMN 中 Gateway 用于控制流程路径，而 Sequence Flow 负责表达节点之间的连接。

例如 Exclusive Gateway：

```text
              ┌────────────┐
              │  Gateway   │
              └─────┬──────┘
                 /       \
                /         \
       condition A       condition B
              /             \
             ↓               ↓
          Task A           Task B
```

Camunda 对 Exclusive Gateway 的定义就是：根据 process variables 评估条件，然后选择满足条件的 Sequence Flow。
[2]

OMG BPMN 2.0 specification 也把 Gateway、Sequence Flow 和 `conditionExpression` 作为流程控制的正式语义。
[3]

所以：

```text
Gateway
  +
Sequence Flow
  +
Condition
```

已经构成了完整的 routing model。

再加一个：

```text
@route
```

通常只是把已有的 graph semantics 再包装一遍。

---

# 5. `@route` 最大的问题不是“多一个语法”，而是产生第二套控制流

例如：

```ts
@task
async analyze() {}

@route("approved")
async submit() {}

@route("rejected")
async reject() {}
```

假设 Workflow Graph 又写成：

```text
analyze → submit
analyze → reject
```

那么现在有两套信息：

```text
Graph:
analyze → submit
analyze → reject

Route metadata:
analyze.approved → submit
analyze.rejected → reject
```

如果以后开发人员修改其中一个：

```text
analyze → review
```

却忘记：

```text
@route("approved") → review
```

系统就会出现：

```text
Visual Graph ≠ Runtime Routing
```

这不是 DSL 简洁性问题，而是 **consistency problem**。

---

# 6. 金融 Workflow 更不应该有两套控制流事实来源

金融服务的 Workflow 通常不仅要求“流程能够跑完”。

还要求能够解释：

```text
为什么走这条路径？

当时依据什么条件？

哪个 Policy 生效？

谁批准了？

哪个步骤实际执行？

发生异常后走了什么 recovery path？
```

例如 FCA 当前 operational resilience 要求金融机构识别和记录交付重要业务服务所需要的：

```text
people
processes
technology
facilities
information
```

并要求能够识别 vulnerabilities、进行 scenario testing 和 lessons learned。
[4][5]

FCA 对 operational resilience 的观察也特别强调：

* 明确的 governance framework；
* 明确的 ownership 和 accountability；
* 记录 approval processes；
* 记录 review trails；
* 能够向监管机构和董事会提供 evidence。
  [5]

因此 Workflow 最重要的不是：

> DSL 有没有一个很方便的 `@route`。

而是：

> **Workflow 的控制流是否有一个清晰、稳定、可审计的事实来源。**

如果 Graph 是 source of truth，那么就应该尽量避免另一个 route declaration 与它竞争。

---

# 7. 最小 DSL 应该表达“业务语义”，而不是“图算法”

一个好的 Workflow DSL 不应该把底层执行引擎的每一个概念都暴露出来。

例如：

```text
Task
Gate
Review
Command
```

这些是业务上有意义的概念。

而：

```text
route
jump
goto
transition
next
edge
branch
```

更多是 Workflow Engine 的实现概念。

因此可以把 DSL 分成两层：

```text
Business Workflow DSL
        │
        │
        ↓
Workflow Graph
        │
        │
        ↓
Execution Engine
```

业务 DSL 表达：

```text
Task
Gate
Review
Command
```

Graph 表达：

```text
A → B
B → C
B → D
```

Execution Engine 再负责：

```text
state
retry
timeout
parallelism
persistence
recovery
```

这比把所有 runtime primitive 都暴露到 DSL 中更容易长期维护。

---

# 8. 那条件分支怎么办？

这是支持 `@route` 最常见的理由。

例如：

```text
Analyze
   ↓
risk = high ?
  /       \
yes       no
 ↓         ↓
Review   Execute
```

确实需要表达：

```text
risk == high
```

但这里真正需要的是：

```text
condition
```

而不是：

```text
route
```

例如：

```ts
gate("riskCheck")
  .when(ctx => ctx.risk === "high", review)
  .otherwise(execute)
```

或者更图化：

```text
riskCheck
   │
   ├── high ──→ review
   │
   └── else ──→ execute
```

这里：

```text
condition
```

是业务语义。

而：

```text
route
```

只是执行关系。

因此 DSL 应优先表达：

```text
condition
```

然后由 Graph 表达：

```text
condition → destination
```

而不是引入一个泛化的：

```text
@route
```

---

# 9. 更重要的是：Gate 和 Agent Decision 不应该混在一起

对于 Agentic Workflow，这一点尤其重要。

假设：

```text
Agent
 ↓
"I think this trade is low risk."
```

不要直接把：

```text
Agent output
```

解释成：

```text
Workflow route
```

更合理的是：

```text
Agent Task
     ↓
Risk Assessment
     ↓
Gate
     ↓
Deterministic Policy
     ├── low risk → continue
     └── high risk → review
```

AWS 2026 年发布的 Agentic AI Lens 对这一点给出了非常直接的建议：risk classification 应由 deterministic logic / policy engine 等作为 authoritative signal，LLM 可以提供辅助输入，但应由 deterministic layer 重新检查；高风险操作应进入 human review。
[6]

因此：

```text
Agent decides next step
```

与：

```text
Workflow determines allowed path
```

应该是两件事情。

---

# 10. 这也是为什么 Agent Runtime 不应该通过 `@route` 控制 Business Workflow

假设 Agent Runtime 支持：

```ts
@route("executeTrade")
```

那么实际上发生的是：

```text
LLM
 ↓
Agent Runtime
 ↓
Route
 ↓
Business Command
```

这会让 Agent Runtime 逐渐承担：

```text
business workflow state
business routing
policy interpretation
authorization boundary
```

而这些东西本来应该属于 Workflow / Control Plane。

AWS Agentic AI Lens 的设计原则明确强调：

* agent scope 应该 bounded；
* agent action 应该 observable / traceable；
* autonomy 应与 human oversight 配套；
* agent 应通过 explicit contracts 工作；
* deterministic enforcement 与 probabilistic controls 应处于不同层次。
  [7]

AWS 对 workflow orchestration 甚至明确区分 dynamic graph workflows 和 deterministic workflow skeleton，并指出复杂系统可以采用 hybrid model：动态部分负责 reasoning-driven flow，确定性部分由 Step Functions 等负责。
[8]

因此更合理的是：

```text
Workflow
   │
   ├── Task
   │      └── Agent
   │
   ├── Gate
   │      └── Policy
   │
   ├── Review
   │      └── Human
   │
   └── Command
          └── Business API
```

而不是：

```text
Agent
   │
   └── @route(...)
          │
          └── Business Workflow
```

---

# 11. 但这里不能走到另一个极端：Workflow 不是只能有静态 DAG

这是这个论点最容易说过头的地方。

如果说：

> “Workflow DSL 不应该有 route，所以 Workflow 必须是固定线性流程。”

这是错误的。

真实 Workflow 经常需要：

```text
branch
loop
parallel
retry
timeout
event
wait
exception
compensation
subworkflow
```

AWS Step Functions 本身就提供 Choice、Parallel、Map、Wait、Fail 等不同 Flow States。
[1]

BPMN 也不仅仅有简单 Sequence Flow，而有：

```text
Exclusive Gateway
Parallel Gateway
Inclusive Gateway
Event-based Gateway
```

[2][3]

所以真正的观点应该是：

> **不要因为不需要 `@route`，就把 Workflow DSL 简化成只能表达线性执行。**

应该做的是：

> **让 routing 成为 Graph Semantics，而不是额外的 route declaration。**

---

# 12. `@route` 在什么情况下是合理的？

并不是所有 DSL 都不应该有 route。

至少存在几种合理情况。

## 12.1 DSL 不是 Graph DSL

例如：

```ts
@workflow
class Workflow {

  @task
  analyze()

  @route("highRisk")
  review()

  @route("normal")
  execute()
}
```

如果 DSL 本身就是：

```text
node declaration
+
decorator metadata
```

而不是显式 graph，那么 `@route` 可能就是构建 Graph 的机制。

此时：

```text
@route
```

不是重复语法，而是 graph construction syntax。

因此：

> **是否需要 `@route` 取决于 DSL 的基础模型。**

---

# 13. 如果采用显式 Graph DSL，`@route` 就开始显得多余

例如：

```ts
workflow(
  task("analyze"),
  gate("riskCheck")
    .on("high", "review")
    .on("normal", "execute"),

  review("review"),
  command("execute")
)
```

这里已经存在：

```text
riskCheck
 ├── high → review
 └── normal → execute
```

那么：

```ts
@route(...)
```

就没有必要。

这就是本文真正主张的场景。

---

# 14. Error Route 也不一定需要 `@route`

另一个常见反驳是：

> “那异常怎么办？异常本身也是 route。”

没错。

但仍然可以把它作为 Graph / Execution Policy 表达。

例如：

```text
Task A
   │
   ├── success → Task B
   │
   └── failure → Recovery
```

或者：

```yaml
task: submitVote

onFailure:
  retry: 3
  then: reconcile
```

这里：

```text
retry
reconcile
```

是 error-handling semantics。

没有必要把所有这些都统一成：

```text
@route
```

否则最终 DSL 会变成：

```text
@route
@errorRoute
@retryRoute
@timeoutRoute
@compensationRoute
@escalationRoute
```

这反而会把 Workflow DSL 重新做成一个复杂的 control-flow language。

---

# 15. `@route` 很容易导致“万能控制流注解”

这是应该特别警惕的。

一开始可能只有：

```ts
@route("approved")
```

后来需求不断增加：

```ts
@route("approved")
@route("rejected")
@route("timeout")
@route("error")
@route("retry")
@route("escalate")
@route("compensate")
@route("manual")
```

最后：

```text
@route(...)
```

实际上变成了：

> “任何情况下 Workflow 下一步怎么走，都放到 route 里。”

这会产生一个新的问题：

```text
Task
  ↓
@route
  ↓
@route
  ↓
@route
```

DSL 表面上很小，但 semantics 反而越来越复杂。

---

# 16. 最小 DSL 不等于最少关键字

这里还需要避免一个误区。

所谓：

> Keep the DSL minimal

并不是：

```text
关键字越少越好。
```

而是：

> **每一个 primitive 都应该拥有不可替代的语义。**

例如：

```text
Task
Gate
Review
Command
```

虽然只有四类核心 Node，但它们分别表达：

```text
Task     → work
Gate     → control
Review   → accountable decision
Command  → business state change
```

这四个语义并不重复。

而如果：

```text
route
```

只是表达：

```text
Node A → Node B
```

那么它和 Graph Edge 的语义重复。

所以：

```text
minimal DSL
```

真正追求的是：

```text
minimal semantic duplication
```

而不是：

```text
minimal number of tokens
```

---

# 17. 对金融 Workflow 来说，显式 Graph 还有一个额外优势

金融业务流程往往需要被不同角色理解：

```text
Business Analyst
Solution Architect
Developer
Operations
Risk
Compliance
Internal Audit
```

他们关注的东西不同。

但一个好的 Workflow Graph 可以成为共同语言：

```text
         ┌─────────────┐
         │ Analyze     │
         └──────┬──────┘
                ↓
         ┌─────────────┐
         │ Risk Gate   │
         └──────┬──────┘
            high│ low
          ┌─────┘ └──────┐
          ↓              ↓
       Review          Execute
          │
          ↓
       Command
```

Business Analyst 可以理解：

> 高风险需要 Review。

Architect 可以理解：

> Review 是一个独立控制边界。

Security 可以理解：

> Execute 前还有 authorization。

Audit 可以理解：

> Workflow 的控制路径是确定的。

如果 routing 被隐藏在：

```ts
@route(...)
```

decorator metadata 里，反而可能降低流程本身的可读性。

---

# 18. Workflow Graph 应该是 Control Flow 的 Source of Truth

因此推荐一个非常明确的原则：

> **一个 Workflow 只能有一个 Control Flow Source of Truth。**

如果选择 Graph：

```text
Graph = Source of Truth
```

那么：

```text
Node
Edge
Condition
Event
```

共同构成 Workflow Definition。

其他信息应该属于：

```text
metadata
policy
execution configuration
```

而不是再次定义控制流。

例如：

```text
Workflow Definition
│
├── Nodes
│
├── Edges
│
├── Conditions
│
└── Events
```

而：

```text
Execution Policy
│
├── Retry
├── Timeout
├── Escalation
├── Compensation
└── Idempotency
```

可以单独存在。

---

# 19. 一个推荐的最小 DSL

如果采用 TypeScript DSL，我会倾向于：

```ts
workflow("proxyVoting", ({ task, gate, review, command }) => {

  const proposal = task("loadProposal")

  const analysis = task("analyzeProposal", {
    agent: "proxy-voting-agent"
  })

  const risk = gate("riskCheck", {
    condition: "riskLevel"
  })

  const review = review("investmentReview")

  const submit = command("submitProxyVote")

  proposal
    .then(analysis)
    .then(risk)

  risk
    .when("high", review)
    .when("normal", submit)

  review
    .when("approved", submit)
    .when("rejected", "end")
})
```

注意这里没有：

```text
@route
```

但是 routing 完全存在：

```text
risk
 ├── high → review
 └── normal → submit

review
 ├── approved → submit
 └── rejected → end
```

因此：

> **去掉 `@route` 并没有减少 Workflow 的表达能力，只是把 routing 放回 Graph 本身。**

---

# 20. Agentic Workflow 的动态 routing 怎么办？

这是最重要的例外。

传统 Workflow：

```text
A
 ↓
Gate
 ↓
B / C
```

是确定性 routing。

Agent Workflow 可能出现：

```text
Agent
 ↓
决定下一步需要：
  Search
  → Tool A
  → Tool B
  → Ask Human
  → Finish
```

这确实是 dynamic routing。

但这里更合理的做法不是：

```text
Agent → @route
```

而是明确划分：

```text
Deterministic Workflow
        │
        │ invokes
        ↓
Dynamic Agent Runtime
        │
        ├── Tool A
        ├── Tool B
        ├── Tool C
        └── Reasoning loop
        │
        ↓
Structured Result
        │
        ↓
Workflow Gate
```

AWS Agentic AI Lens 也明确承认 dynamic graph workflows 的合理性，同时建议根据任务形态选择 dynamic、deterministic 或 hybrid orchestration。
[8]

所以：

```text
Dynamic routing
```

应该存在于：

```text
Agent Runtime
```

的 reasoning loop 中；

而：

```text
Business Workflow routing
```

应该尽量存在于：

```text
Workflow Graph
```

中。

---

# 21. 两种 Routing 应该明确分开

可以把它定义成：

```text
                 Routing
                    │
          ┌─────────┴─────────┐
          ↓                   ↓
   Workflow Routing      Agent Routing
          │                   │
      deterministic       probabilistic
          │                   │
       Business             Reasoning
       control               loop
          │                   │
       Gate / Edge        Tool selection
          │                   │
          ↓                   ↓
    Workflow Engine       Agent Runtime
```

这可能是整个设计里最重要的架构边界。

### Workflow Routing

回答：

> Business Process 下一步允许去哪？

### Agent Routing

回答：

> 为了完成当前 Task，Agent 下一步想尝试什么？

两者不能混为一谈。

---

# 22. `@route` 最容易造成的危险：把 Agent Routing 伪装成 Business Routing

例如：

```text
@agent
async analyze() {
   ...
}

@route(agent.output.nextStep)
```

看起来非常灵活。

但实际上：

```text
LLM output
   ↓
Workflow control flow
```

已经形成直接连接。

这意味着一个模型输出可能决定：

```text
是否需要 Review
是否需要 Authorization
是否可以执行 Command
```

这对于高风险金融 Workflow 是非常危险的边界。

AWS 当前 Agentic AI Lens 明确建议 operational/policy boundaries 不能只依赖 prompt instructions，而应该由 IAM、schema validation、policy engine 等 deterministic controls enforce。
[7]

所以更安全的结构是：

```text
Agent
 ↓
Proposal
 ↓
Validated Output
 ↓
Deterministic Gate
 ↓
Workflow Routing
```

而不是：

```text
Agent
 ↓
@route
 ↓
Workflow Routing
```

---

# 23. `@route` 并不是“坏设计”

这里必须避免过度结论。

`@route` 并不是一种错误设计。

在以下情况下，它完全合理：

### 情况一：DSL 本身是 decorator-oriented

如果：

```ts
@task
@route
@retry
@timeout
```

本来就是 DSL 的主要表达方式，那么 `@route` 可以作为 graph construction mechanism。

---

### 情况二：route 本身携带重要语义

例如：

```ts
@route({
  condition: "risk > high",
  policy: "trade-approval-v3",
  target: "review"
})
```

如果它不仅仅是：

```text
A → B
```

而是一个完整的 routing policy declaration，那么它可能具有独立语义。

但此时应该考虑是否更适合命名成：

```text
@when
@branch
@policy
```

而不是把所有控制逻辑塞进泛化的 `@route`。

---

### 情况三：动态 topology

某些 Workflow 是真正动态生成的：

```text
Agent
 ↓
discover subtasks
 ↓
create execution graph
```

这时候 runtime routing 是必要的。

但这已经属于：

```text
dynamic orchestration
```

而不是普通的静态 Business Workflow DSL。

---

# 24. 因此真正推荐的是“最小核心 + 可扩展执行模型”

不要试图让一个 DSL 同时解决：

```text
Business Workflow
+
Agent Reasoning
+
Dynamic Planning
+
Error Handling
+
Scheduling
+
Authorization
+
Policy
```

更合理的是：

```text
                  Workflow DSL
                       │
             ┌─────────┴─────────┐
             ↓                   ↓
       Business Graph       Execution Policy
             │                   │
        Task/Gate/...      retry/timeout/...
             │
             ↓
       Workflow Engine
             │
             ↓
       Agent Runtime
             │
       dynamic reasoning
```

这样 DSL 可以保持非常小。

---

# 25. 推荐的最终语法边界

如果采用本文前面的四类 Node：

```text
Task
Gate
Review
Command
```

那么建议：

### Workflow DSL 核心

```text
workflow
task
gate
review
command
```

### Graph primitives

```text
then
when
otherwise
parallel
join
```

### Execution semantics

```text
retry
timeout
wait
escalate
compensate
```

### Agent-specific

```text
agent
tool
handoff
memory
```

但不要把：

```text
@route
```

作为一个万能 primitive。

因为它容易把下面几件完全不同的事情混在一起：

```text
business routing
error handling
agent routing
policy decision
execution recovery
```

---

# 26. 最终模型

可以把整个设计浓缩成：

```text
                 Workflow Definition
                         │
              ┌──────────┴──────────┐
              ↓                     ↓
          Node Semantics        Graph Semantics
              │                     │
       ┌──────┼──────┐        ┌─────┴─────┐
       ↓      ↓      ↓        ↓           ↓
      Task   Gate  Review    Edge       Condition
              │      │
              └──┬───┘
                 ↓
              Command
                 │
                 ↓
          Business State
```

其中：

```text
Node = What happens
Edge = Where the workflow goes
Condition = Why this edge is selected
Policy = Whether this transition is allowed
Agent = How a bounded task reasons
Command = What changes business state
```

这几个概念各司其职。

---

# 27. 最重要的设计原则

最终可以把这篇文档浓缩成以下原则：

### Principle 1 — Routing 是必须的，但 `@route` 不是

```text
Routing ≠ @route
```

---

### Principle 2 — 一个 Workflow 只应该有一个 Control Flow Source of Truth

如果采用 Graph：

```text
Graph = Source of Truth
```

不要再让 `@route` 保存第二份 routing definition。

---

### Principle 3 — Edge 表达“去哪里”，Condition 表达“为什么去”

```text
Edge:
A → B

Condition:
risk == high
```

不要把两者混成一个万能 route primitive。

---

### Principle 4 — Agent Routing 与 Business Workflow Routing 必须分开

```text
Agent:
"What should I try next?"

Workflow:
"What business step is allowed next?"
```

---

### Principle 5 — DSL 的最小化目标不是减少关键字，而是减少语义重复

```text
minimal syntax
```

不是最终目标。

真正目标是：

```text
minimal semantic duplication
```

---

### Principle 6 — 高风险 Workflow 应优先确定性表达控制边界

特别是：

```text
Authorization
Entitlement
Risk threshold
Approval requirement
Command execution
```

这些不应该因为 Agent 动态 routing 而失去确定性边界。

---

### Principle 7 — 动态 Workflow 可以存在，但应该显式标记为 Dynamic / Agentic

不要让：

```text
static business workflow
```

和：

```text
agent reasoning loop
```

看起来像同一种东西。

---

# 28. 一句话结论

> **Workflow 不需要取消 routing；需要取消的是重复的 `@route` 语义。**
>
> 如果 Workflow DSL 已经以 Graph 为基础，那么：
>
> **Node 表达“做什么”，Edge 表达“去哪里”，Condition 表达“为什么走这条边”，Policy 表达“是否允许”，Agent 表达“如何在有限边界内推理”。**
>
> 这样才能让 Workflow DSL 保持足够小，同时不牺牲分支、并行、异常、审批和动态 Agent Workflow 所需要的表达能力。
>
> 对金融服务而言，这种设计尤其有价值，因为它把 **业务控制流、Agent 推理、Policy Enforcement 和 Business State Change** 分成了不同的责任边界，而不是用一个万能的 `@route` 把它们重新混在一起。

---

# 参考资料

**[1] AWS — Step Functions: Discovering workflow states**
AWS 将 Task 定义为单个工作单元，将 Choice、Parallel、Map、Wait、Succeed、Fail 等定义为控制 Workflow 的 Flow States。
[AWS Step Functions — Discovering workflow states](https://docs.aws.amazon.com/step-functions/latest/dg/workflow-states.html?utm_source=chatgpt.com)

**[2] Camunda — Gateways**
Camunda 对 BPMN Gateway 的说明：Gateway 用于比普通 sequence flow 更复杂的 token routing；Exclusive Gateway 根据数据选择执行路径。
[Camunda 8 — Gateways](https://docs.camunda.io/docs/components/modeler/bpmn/gateways/?utm_source=chatgpt.com)
[Camunda 8 — Exclusive Gateway](https://docs.camunda.io/docs/components/modeler/bpmn/exclusive-gateways/?utm_source=chatgpt.com)

**[3] OMG — BPMN 2.0 Specification**
BPMN 官方规范定义 Gateway、Sequence Flow、Condition Expression 等流程控制语义。
[OMG BPMN 2.0 Specification](https://www.omg.org/spec/BPMN/2.0/PDF/?utm_source=chatgpt.com)

**[4] FCA — Operational Resilience**
FCA 要求相关金融机构围绕 Important Business Services 建立 mapping、impact tolerance、scenario testing 和 recovery 能力。
[FCA — Operational Resilience](https://www.fca.org.uk/firms/operational-resilience?utm_source=chatgpt.com)

**[5] FCA — Operational resilience: insights and observations**
FCA 对金融机构 operational resilience 实践的观察，特别涉及 governance、ownership、accountability、approval process、review trail 和 evidence。
[FCA — Operational resilience: insights and observations](https://www.fca.org.uk/publications/good-and-poor-practice/operational-resilience-insights-observations-one-year?utm_source=chatgpt.com)

**[6] AWS — Human-in-the-loop for critical decisions**
AWS 明确建议使用 deterministic risk classification / policy logic 作为权威风险分类信号，LLM 可以作为辅助输入；高风险操作进入人工审批。
[AWS Agentic AI Lens — Human-in-the-loop for critical decisions](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentsec04-bp02.html?utm_source=chatgpt.com)

**[7] AWS — Agent goal alignment and manipulation prevention**
AWS 将 IAM、schema validation、policy engine 等 deterministic enforcement 与 probabilistic agent controls 分开，并强调 operational/policy boundaries 不应只存在于 prompt 中。
[AWS Agentic AI Lens — Agent goal alignment and manipulation prevention](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentsec04.html?utm_source=chatgpt.com)

**[8] AWS — Workflow orchestration and multi-agent collaboration**
AWS Agentic AI Lens 明确区分 dynamic graph、deterministic workflow skeleton 和 hybrid orchestration，说明确定性 Workflow 与动态 Agent orchestration 可以并存，而不应强行合并。
[AWS Agentic AI Lens — Workflow orchestration and multi-agent collaboration](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentperf05.html?utm_source=chatgpt.com)

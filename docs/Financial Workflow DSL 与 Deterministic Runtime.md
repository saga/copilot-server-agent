# Financial Workflow DSL 与 Deterministic Runtime

## 1. 引言

金融业务流程与普通 AI Agent 最大的区别之一，是**业务流程本身通常不是“智能问题”，而是“控制问题”**。

例如：

```text
Investment Idea
    ↓
Research
    ↓
Compliance
    ↓
Portfolio Manager
    ↓
Publish
```

这里真正需要确定的是：

```text
当前是什么状态？
下一步是什么？
谁可以参与？
什么情况下允许继续？
什么情况下必须暂停？
发生错误后去哪里？
什么时候终止？
```

这些问题不应该交给 LLM 自由决定。

与此同时，Research、分析、文档理解、风险识别等工作又非常适合 AI Agent。

因此更合理的架构是：

```text
                  Financial Workflow
                         │
              deterministic control
                         │
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
       AI Task        Human Review    System Gate
          │              │              │
          └──────────────┼──────────────┘
                         ▼
                      Command
                         │
                         ▼
                    Domain System
```

核心思想：

> **让 Agent 的工作具有概率性，但让 Workflow 的状态和控制具有确定性。**

AWS 当前 Agentic AI Lens 已明确区分：对预先已知的确定性工作流，应该使用确定性的 Workflow Orchestration；对执行路径本身由模型动态决定的问题，才使用更动态的 Agentic Orchestration。AWS 同时要求 Workflow 对状态转换、输入验证和执行路径实施严格控制。([AWS Documentation][1])

Microsoft Agent Framework 的当前文档也直接给出了类似的选择标准：

> 如果代码应该决定结果，使用 deterministic executor；如果模型应该决定下一步，使用 Agent；如果应该由人决定，则使用 Human-in-the-loop。([Microsoft Learn][2])

这其实就是金融 Agent Workflow 最核心的架构原则。

---

# 2. 为什么金融领域尤其需要 Deterministic Runtime

普通 Agent：

```text
Goal
 ↓
LLM
 ↓
plan
 ↓
tool
 ↓
result
```

金融业务：

```text
Business Case
 ↓
Workflow State
 ↓
Policy
 ↓
Human Decision
 ↓
Command
 ↓
Business State
```

原因在于金融系统通常具有：

* 明确的职责分离；
* 审批链；
* 合规检查；
* 风险分级；
* 强数据权限；
* 不可随意跳过的步骤；
* 长时间运行；
* 失败恢复；
* 审计要求；
* 不允许重复副作用。

例如：

```text
Compliance
   ↓
PM Review
   ↓
Publish
```

Agent 可以在 Compliance 阶段自由：

```text
查资料
比较文件
分析风险
寻找矛盾
```

但不能自由决定：

```text
“Compliance 太麻烦了，我直接进入 Publish。”
```

这不是能力问题，而是权限和流程控制问题。

---

# 3. Deterministic Runtime 到底是什么

这里的 Deterministic 并不是说：

> 所有节点都必须是确定性代码。

而是：

> **Workflow Runtime 对业务状态和状态转换的解释必须是确定性的。**

例如：

```text
Current State = compliance
Outcome = pass
```

那么 Runtime：

```text
→ 下一状态 = pm-review
```

不应该因为：

```text
model = GPT-X
temperature = ...
```

而发生变化。

可以把 Runtime 表述成：

```text
nextState =
    transition(
        currentState,
        normalizedOutcome,
        workflowDefinition
    )
```

而不是：

```text
nextState =
    LLM("Based on everything, what should happen next?")
```

---

# 4. Agent 的不确定性应该被封装在 Node 内

这是最关键的边界。

例如：

```text
@task research
```

内部：

```text
LLM
 ├── Search
 ├── Read
 ├── Compare
 ├── Analyze
 └── Draft
```

这些可以是概率性的。

但 Node 对 Workflow 只能返回：

```text
success
fail
```

或者结构化结果：

```json
{
  "status": "success",
  "output": {
    "memoId": "memo-123"
  }
}
```

然后 Workflow 再决定：

```text
success → compliance
fail    → research-failed
```

这样：

```text
Agent reasoning
        ↓
bounded output
        ↓
deterministic workflow transition
```

AWS 当前 Agentic AI Lens 把这种做法概括为 **predictable task execution**：将 Agent 拆成 atomic task，定义明确的 input/output contract，并通过结构化结果和权限边界限制模型的不确定性。([AWS Documentation][3])

---

# 5. Workflow DSL 的目的不是描述 AI，而是描述控制

因此 DSL 不应该试图表达：

```text
“Agent 要先深思，然后比较三个来源，
如果感觉风险不高再决定下一步。”
```

这种内容应该属于：

```text
Skill / Prompt / Agent Runtime
```

Workflow DSL 更适合表达：

```text
Research
    ↓
Compliance Gate
    ↓
Human Review
    ↓
Publish
```

以及：

```text
success
fail
approve
reject
pass
review
```

也就是：

> **DSL 是 Business Control Language，而不是 Prompt Language。**

---

# 6. 一个合适的最小 DSL

当前项目的：

```text
@flow
@task
@gate
@review
@command
@stop
@end
```

实际上是一个很合理的最小核心。

可以抽象为：

```text
@task
    = AI Work

@gate
    = Deterministic Decision

@review
    = Human Decision

@command
    = Business Mutation

@stop
    = Failed Terminal

@end
    = Successful Terminal
```

形成：

```text
        ┌───────────────┐
        │    @task      │
        │   AI work     │
        └───────┬───────┘
                │
                ▼
        ┌───────────────┐
        │    @gate      │
        │ deterministic │
        └───────┬───────┘
                │
                ▼
        ┌───────────────┐
        │   @review     │
        │ human decision│
        └───────┬───────┘
                │
                ▼
        ┌───────────────┐
        │   @command    │
        │ side effect   │
        └───────────────┘
```

这种设计与 Workflow 领域几十年来形成的 control-flow patterns 是一致的。Workflow Patterns 研究长期把 sequence、choice、parallel split、synchronization、multiple choice、deferred choice 等视为可复用的业务流程控制模式。([MIT Press][4])

---

# 7. 为什么 DSL 必须足够小

金融 Workflow 很容易发生一个问题：

```text
@task
@gate
@review
@command
@route
@condition
@parallel
@subflow
@loop
@switch
@foreach
@event
@wait
@timer
@exception
@compensate
...
```

最后 DSL 变成：

```text
“我们自己重新发明 BPMN。”
```

这通常不是好事。

AWS 自己的 ASL 已经有：

```text
Task
Choice
Parallel
Map
Wait
Pass
Succeed
Fail
```

以及 Retry / Catch / Timeout 等完整机制。([AWS Documentation][5])

BPMN 更加完整，OMG 的 BPMN 2.0.2 甚至定义了专门的 execution semantics。([OMG][6])

因此：

> **自定义 DSL 的价值不是“比 BPMN 功能更多”，而是用极少语义表达当前业务真正需要的控制模型。**

---

# 8. DSL 的最佳目标：Minimal Complete Language

理想状态不是：

```text
最少关键字
```

而是：

```text
最少关键字
+
覆盖当前真正需要的 Workflow Patterns
+
运行语义明确
```

例如第一阶段：

```text
Sequence
Choice
Loop
Human Review
Command
Terminal
```

已经能够覆盖大量金融流程。

Workflow Patterns 研究的核心价值就在于：流程语言不应该按照某个具体产品的 syntax 设计，而应该先从反复出现的业务流程模式出发，再判断语言是否具有足够表达能力。([MIT Press][4])

---

# 9. DSL 不应该隐藏 Control Flow

错误：

```md
## @task research

Do whatever is necessary and continue appropriately.
```

问题：

```text
谁决定 continue？
```

如果答案是 Agent：

```text
Agent = Workflow Engine
```

应该显式：

```md
## @task research

- success -> compliance
- fail -> research-failed
```

这是一个非常重要的架构不变量：

> **业务状态转换必须出现在 DSL / compiled definition 中，而不是 Prompt 中。**

---

# 10. Explicit Transition 比 Implicit Transition 更适合金融

例如：

```text
@task research
output: non-empty
```

然后默认：

```text
→ next node
```

虽然方便，但容易产生隐含行为。

更清晰：

```text
@task research
- success -> compliance
- fail -> research-failed
```

这使得：

```text
success
fail
```

都是显式业务 contract。

AWS ASL 同样要求状态机通过 `Next`、`End`、`Choice` 等字段显式定义状态关系，而不是由任务代码自行决定工作流下一步。([AWS Documentation][7])

---

# 11. AST 必须忠实表示 Source

DSL Parser 不应该直接生成 Runtime。

推荐：

```text
Source
  ↓
Parser
  ↓
AST
  ↓
Validator
  ↓
Analyzer
  ↓
Compiled Definition
  ↓
Runtime
```

这是一个非常值得坚持的设计。

原因：

### Parser

回答：

> “源文件写了什么？”

### Validator

回答：

> “写的东西合法吗？”

### Analyzer

回答：

> “即使合法，流程结构是否存在问题？”

### Runtime

回答：

> “现在执行这个已经验证过的定义。”

---

# 12. 为什么不要让 Parser 同时做 Semantic Validation

例如：

```text
@command publish
- success -> completed
- success -> rejected
```

Parser 的工作应该是：

```text
AST:
    route success -> completed
    route success -> rejected
```

然后 Validator：

```text
duplicate outcome
```

报错。

如果 Parser 直接删除重复 route：

```text
success -> completed
```

就丢失了用户真实写的东西。

这也是当前项目 AST 设计比较合理的地方：

```text
AST faithfully records source
```

然后：

```text
semantic meaning
```

在 Validator 中确定。

---

# 13. Validator 应该做什么

一个 Financial Workflow Validator 至少应检查：

```text
1. Workflow 数量
2. Start 是否存在
3. Node ID 是否唯一
4. Route Target 是否存在
5. Terminal Node 是否错误出边
6. 必需 Outcome 是否存在
7. 不允许的 Outcome 是否存在
8. Duplicate Route
9. Role / Capability 合法性
10. Registry Reference 是否存在
11. Approval Constraint 是否合法
12. Task Contract 是否满足
13. Tool Capability 是否满足
14. Policy Constraint 是否合法
```

换句话说：

> **Validator 是 DSL 的“编译期安全边界”。**

---

# 14. Analyzer 与 Validator 不应该合并

Validator：

```text
“这条定义语义上合法吗？”
```

Analyzer：

```text
“这条定义从图结构看，会不会跑不通？”
```

例如：

```text
@task research
- success -> compliance
```

合法。

但如果：

```text
compliance
```

实际上从 start 根本到不了：

```text
unreachable
```

或者：

```text
dead-end
```

那就是 Flow Analysis 的问题。

---

# 15. Static Analysis 对金融 Workflow 特别重要

传统软件编译器会做：

```text
type checking
dead code analysis
control flow analysis
```

Workflow DSL 同样应该做。

例如：

```text
Start
 ↓
A
 ↓
B

C
 ↓
D
```

如果：

```text
C
```

永远到不了，就应该提前发现。

当前项目的：

```text
forward BFS
reverse BFS
```

就是非常合适的轻量实现。

这类思想并不新：Workflow Patterns 及其 Petri-net 形式化研究长期强调流程控制流的精确定义，而 BPMN 规范本身也给出了 execution semantics。([Eindhoven Tech Research Portal][8])

---

# 16. Reachability 是最值得自动检查的规则之一

例如：

```text id="r8w2c3"
start
  ↓
research
  ↓
compliance
```

但 DSL 中：

```text
orphan-review
```

没有任何入边。

应该：

```text
node-unreachable
```

错误。

这类问题不应该等 Workflow 跑到线上才发现。

---

# 17. Terminal Path 也应该静态分析

另一个典型错误：

```text
start
  ↓
A
  ↓
B
  ↺
```

没有：

```text
@end
```

这意味着：

```text
execution can continue forever
```

因此 Analyzer 应检查：

```text
reachable nodes
        ↓
can every reachable node reach a terminal?
```

如果不能：

```text
no-terminal-path
```

当前项目已经这么做，这个方向是对的。

---

# 18. Cycle 不应该一律禁止

金融 Workflow 经常需要：

```text
Review
  ↓
Request Changes
  ↓
Research Update
  ↓
Review
```

即：

```text
cycle
```

因此：

```text
cycle = error
```

不是正确规则。

应该区分：

```text
intentional cycle
```

和：

```text
unbounded accidental cycle
```

第一阶段可以允许 cycle，同时增加：

```text
MAX_FLOW_STEPS
```

这样的 runtime breaker。

AWS 对动态 Agent Workflow 也特别建议 cycle detection、maximum depth、bounded fan-out，以防执行链无限增长。([AWS Documentation][1])

---

# 19. Runtime Step Limit 是安全控制，不是业务逻辑

例如：

```text
MAX_FLOW_STEPS = 100
```

它的意义不是：

> “业务最多允许 100 步。”

而是：

> “Runtime 不允许任何异常执行无限消耗资源。”

这属于：

```text
Execution Safety
```

和：

```text
Business Rule
```

要区分。

---

# 20. Deterministic Runtime 最重要的性质：Replayability

一个好的 Runtime 应该让：

```text
same definition
+
same persisted state
+
same event/outcome
```

得到：

```text
same next state
```

即：

```text
Transition(currentState, event)
    → deterministic
```

例如：

```text
current = compliance-review
event = reject
```

永远：

```text
→ rejected
```

这使得：

* incident investigation；
* replay；
* testing；
* recovery；
* audit；

都更加简单。

---

# 21. Agent Runtime 不能成为 Replay Authority

假设过去：

```text
@task research
```

Agent 输出：

```text
success
```

现在重新执行模型：

```text
failure
```

不能因此让历史 Workflow：

```text
compliance
```

变成：

```text
research-failed
```

因此：

> **Replay Workflow 时，应 replay persisted outcome，而不是重新让 LLM 决定过去发生了什么。**

这是金融领域非常重要的设计。

---

# 22. Agent Task Output 应该持久化

至少：

```text
task execution
├── input reference
├── output
├── outcome
├── model
├── skill version
├── timestamp
└── status
```

这样：

```text
task succeeded
```

就是一个持久事实。

Workflow Runtime 不应在恢复时：

```text
“再问一次 Agent 看看。”
```

否则：

```text
Recovery
=
new AI decision
```

就不再是 deterministic recovery。

---

# 23. External Side Effect 必须从 Replay 中隔离

例如：

```text
@command publish
```

不能：

```text
replay
    ↓
publish again
```

因此：

```text
@task
    replay by persisted result

@gate
    replay deterministic function / persisted result

@review
    replay persisted human decision

@command
    replay via idempotency-safe executor
```

这也是为什么 Command / Approval / Idempotency 与 Deterministic Runtime 是一整套设计，而不是三个独立主题。

AWS Step Functions 文档同样强调：Retry/Catch 是 Workflow 层行为，而实际 Task 仍可能再次执行；需要根据任务副作用保证幂等性。([AWS Documentation][9])

---

# 24. Runtime 必须把“状态”和“执行尝试”分开

例如：

```text
Workflow State:
    PUBLISH / WAITING

Execution Attempt:
    #1
    #2
    #3
```

这样：

```text
retry
```

不会被误认为：

```text
state transition
```

推荐：

```text
WorkflowState
    ≠
TaskAttempt
```

---

# 25. 一个更完整的 Runtime Model

可以定义：

```text
FlowExecution
├── executionId
├── definitionId
├── definitionVersion
├── sourceHash
├── currentNode
├── workflowVersion
├── executionStatus
├── stepCount
└── context

FlowStep
├── nodeId
├── status
├── attempt
├── inputReference
├── outputReference
├── outcome
├── startedAt
└── completedAt
```

Command 再拥有自己的：

```text
CommandExecution
├── commandHash
├── idempotencyKey
├── approval
├── resourceVersion
└── result
```

三个生命周期清晰分离：

```text
Workflow
Task Step
Command
```

---

# 26. Runtime 不应该直接读取 Markdown

虽然 DSL 源文件是：

```text
SKILL.md
```

但 Runtime 不应该每次：

```text
read markdown
parse markdown
interpret markdown
execute
```

更好的模型：

```text
SKILL.md
   ↓
Parser
   ↓
AST
   ↓
Validator
   ↓
Analyzer
   ↓
Compiled FlowDefinition
   ↓
Runtime
```

也就是：

> **Source is authoring representation；FlowDefinition 是 execution representation。**

---

# 27. 为什么需要 Compiled / Validated Definition

因为 Runtime 不应该承担：

```text
"这个 node 存不存在？"
"这个 outcome 合法吗？"
"这个 role 对不对？"
"这个 route 指向哪里？"
```

这些应该在加载阶段已经解决。

Runtime 获得：

```text
valid Definition
```

以后只负责：

```text
execute
```

这和传统编译器：

```text
Source
 ↓
AST
 ↓
Semantic Analysis
 ↓
IR
 ↓
Execution
```

是非常类似的。

当前项目：

```text
FlowAst
 ↓
FlowDefinition
 ↓
WorkflowRunner
```

已经很接近这种模型。

---

# 28. Source Hash 是 Runtime Integrity Boundary

假设：

```text
Execution #123
```

开始时：

```text
sourceHash = ABC
```

执行过程中：

```text
SKILL.md
```

被修改成：

```text
sourceHash = DEF
```

此时不能继续：

```text
old execution
+
new workflow definition
```

否则：

```text
Workflow semantics changed mid-flight
```

因此：

```text
Execution
    binds to
Definition Version / Source Hash
```

当前项目已经使用 `sourceHash` 做这件事，这是非常值得保留的设计。

---

# 29. Workflow Version 是运行时契约

推荐：

```text
investment-review@v13
```

而不是：

```text
investment-review
```

运行中的 Execution：

```text
executionDefinition = v13
```

即使：

```text
current latest = v14
```

旧 Execution 仍然使用：

```text
v13
```

直到它：

```text
completed
failed
cancelled
```

---

# 30. 为什么不能自动把 Running Execution 升级到最新 Definition

例如：

```text
Monday:
    Workflow v12
    Execution E1 started

Tuesday:
    Workflow v13 deployed
```

如果 E1 自动切换到 v13：

```text
Research done under v12
Compliance under v13
```

整个执行语义就不一致。

所以：

> **Definition 更新通常影响新 Execution；Running Execution 应继续使用绑定的 Definition。**

除非系统显式实现：

```text
migration
```

并对旧状态做版本迁移验证。

---

# 31. DSL Version 和 Workflow Version 不是同一个概念

例如：

```text
DSL parser version:
    v2

Workflow definition:
    investment-review v13
```

DSL v2 改变语法：

```text
@action
→ @command
```

不一定意味着：

```text
investment-review
```

业务流程发生了变化。

所以建议：

```text
DSL Schema Version
    ≠
Workflow Definition Version
```

---

# 32. Runtime 应该是 Single Writer

一个业务 Execution 最理想的模型：

```text
Execution
    ↓
one logical workflow owner
```

即使部署：

```text
Pod A
Pod B
Pod C
```

也要保证同一 Execution：

```text
only one state transition succeeds at a time
```

推荐：

```text
Optimistic Concurrency / CAS
```

例如：

```text
workflowVersion = 7

UPDATE execution
SET currentNode = 'compliance',
    workflowVersion = 8
WHERE executionId = ?
AND workflowVersion = 7
```

如果：

```text
affectedRows = 0
```

说明：

```text
stale writer
```

拒绝继续推进。

---

# 33. Runtime Lock 与 CAS 不应该混为一谈

当前项目同时存在：

```text
in-process execution lock
+
CAS
```

这两个作用不同。

### In-process lock

优化：

```text
same process concurrent execution
```

### CAS

保证：

```text
cross-process correctness
```

因此：

```text
lock
```

是性能 / contention control；

```text
CAS
```

才是 durable correctness boundary。

---

# 34. Human Review 是 Workflow State，不是 Agent State

例如：

```text
currentNode = compliance-review
status = waiting_for_approval
```

这个状态应该持久化。

不要：

```text
Agent Session
    waiting for human
```

然后依赖：

```text
session memory
```

恢复。

Microsoft Agent Framework 当前的 HITL Workflow 通过 request/response 与 checkpoint/resume 保存 pending request；AWS Step Functions 使用 callback / task token 暂停并恢复 Workflow。([Microsoft Learn][10])

---

# 35. Timeout 必须是 Runtime Semantics

例如：

```text
@review compliance
```

如果 48 小时没人处理：

```text
timeout
```

应该由 Runtime 明确执行：

```text
timeout
→ escalate
```

而不是：

```text
Agent:
    "Maybe I should proceed?"
```

Timeout 是 Workflow 行为。

---

# 36. Retry 必须分“技术失败”和“业务失败”

例如：

```text
HTTP timeout
```

通常：

```text
retryable
```

但：

```text
Compliance rejected
```

不是：

```text
retry
```

所以 Runtime 至少需要：

```text
Technical Failure
Business Rejection
Policy Denial
Human Rejection
Timeout
Stale State
Unknown External Result
```

不同类型进入不同路径。

AWS Step Functions 直接把 Retry 与 Catch 纳入状态机语义：失败可以重试，也可以进入明确的 fallback state。([AWS Documentation][11])

---

# 37. Workflow DSL 应显式表达“Outcome”

例如：

```text
@task research

- success -> compliance
- fail -> research-failed
```

这比：

```text
@task research
next: compliance
```

好，因为：

```text
success
fail
```

是业务语义。

而：

```text
exception
timeout
```

可以由 Runtime 转换为：

```text
fail
```

或者：

```text
workflow-error
```

具体取决于流程。

---

# 38. Outcome 应该有限且受验证

对于：

```text
@review
```

只允许：

```text
approve
reject
```

对于：

```text
@command
```

只允许：

```text
success
fail
```

对于：

```text
@gate
```

由 Registry 声明：

```text
pass
review
fail
```

这样 DSL：

```text
@gate compliance

- pass -> review
- fail -> rejected
```

在编译阶段就能检查：

```text
Are all outcomes registered?
```

---

# 39. Route 应该是静态图结构，而不是 Agent Tool

Workflow 路由：

```text
success → compliance
```

必须属于：

```text
FlowDefinition
```

而不是：

```text
Agent tool:
    route("compliance")
```

否则：

```text
Agent
=
workflow authority
```

这正是金融系统应该避免的。

---

# 40. 为什么不要使用 `@route`

当前项目去掉 `@route` 是合理的。

因为 Route 本质是：

```text
edge
```

而不是：

```text
node
```

最自然的表达：

```text
@task research

- success -> compliance
- fail -> research-failed
```

比：

```text
@route research-success
from: research
to: compliance
when: success
```

更简单。

而且如果未来需要复杂 routing：

```text
AST
```

内部可以自然变成：

```text
FlowNode
+
FlowEdge
```

源语法不需要把 edge 再暴露成独立业务节点。

---

# 41. “Flow Graph” 应该是 Runtime 的真正模型

Source DSL：

```text
@task research
- success -> compliance
```

Compiled Definition：

```text
nodes:
  research
  compliance

edges:
  research --success--> compliance
```

Runtime：

```text
currentNode = research
outcome = success
→ edge lookup
→ compliance
```

于是执行语义非常简单。

---

# 42. Runtime 的核心函数应该非常小

可以抽象成：

```ts
nextNode(
  definition,
  currentNode,
  outcome
): string
```

例如：

```ts
const edge = node.routes.find(
  route => route.outcome === outcome
);

return edge?.target;
```

剩下复杂度：

```text
Policy
AI
Human
Command
```

都在 Node Runtime 外围解决。

这就是 Deterministic Runtime 的核心优势：

> **核心状态转换逻辑可以被几十个单元测试覆盖，而不需要让 LLM 参与。**

---

# 43. Runtime 与 Node Execution 要分层

推荐：

```text
WorkflowRunner
      │
      ▼
FlowNodeRuntime
 ├── runTask()
 ├── runGate()
 ├── openReview()
 └── runCommand()
```

其中：

```text
WorkflowRunner
```

负责：

```text
state
transition
CAS
recovery
step limit
```

而：

```text
FlowNodeRuntime
```

负责：

```text
execute current node
```

这个分层非常合理。

---

# 44. Agent Runtime 应该只是 Task Executor

例如：

```text
WorkflowRunner
    ↓
runTask()
    ↓
WorkflowTurnRunner
    ↓
Copilot SDK
```

或者：

```text
WorkflowRunner
    ↓
runTask()
    ↓
WorkflowTurnRunner
    ↓
DeepAgents
```

Workflow 本身不关心：

```text
Copilot
DeepAgents
LangGraph
```

这就是：

```text
Workflow = deterministic orchestration
Agent Runtime = pluggable execution engine
```

AWS、Microsoft 对确定性 Workflow 与动态 Agent Orchestration 的区分，本质上也支持这种 architecture boundary。([AWS Documentation][1])

---

# 45. DSL 与 Agent Runtime 解耦还有一个重要好处

未来同一个 Workflow：

```text
investment-review@v13
```

可以：

```text
Monday:
    Copilot SDK

Tuesday:
    DeepAgents

Wednesday:
    another runtime
```

只要：

```text
@task
```

仍满足：

```text
input contract
output contract
capability contract
```

Workflow 不需要改变。

---

# 46. 一个金融 Workflow DSL 应该如何定义“契约”

建议：

```text
@task research

input:
  caseId
  researchScope

output:
  type: ResearchResult
  required:
    - findings
    - evidence

tools:
  - read
  - url
```

然后：

```text
Workflow Validator
```

验证：

```text
input schema
output schema
capability
route
```

Runtime 只接受符合 contract 的结果。

---

# 47. Agent Output Contract 比 Prompt 更可靠

不要：

```text
"Please return a good research report."
```

然后把任何输出都当作成功。

应该：

```text
output:
    required:
        findings
        evidence
```

如果：

```text
findings = missing
```

则：

```text
task failed
```

这与 AWS 当前对 atomic tasks、structured success criteria 和 explicit contracts 的要求高度一致。([AWS Documentation][3])

---

# 48. Gate 应该是真正确定性的

例如：

```text
@gate compliance
```

不是：

```text
LLM:
    "Does this look compliant?"
```

而是：

```text
registry:
    complianceGate.evaluate(context)
```

返回：

```text
pass
review
fail
```

这样：

```text
same input
→ same output
```

才具有可测试性。

---

# 49. 如果 Gate 本身需要 LLM 怎么办

可以：

```text
AI-assisted classification
```

但最终：

```text
LLM
 ↓
candidate result
 ↓
deterministic validation / policy
 ↓
final gate
```

AWS 当前 Agentic AI Lens 明确建议风险分类以 deterministic logic 作为 authoritative signal，而不是让受到相同不可信内容影响的 LLM 自己决定“低风险/高风险”。([AWS Documentation][12])

---

# 50. DSL 应避免隐含安全语义

例如：

```text
@task research
```

不应该自动意味着：

```text
tools = all
permissions = user permissions
data = all
```

必须显式或由平台明确的 ceiling 推导：

```text
tools: read,url
```

以及：

```text
capability
```

这样的设计更符合 AWS 的 bounded agent / least privilege 思路。([AWS Documentation][3])

---

# 51. Workflow Definition 本身也是安全资产

AWS 当前 Agentic AI Lens 明确提出：

> Treat agent behavior as code.

也就是：

* Prompt；
* Tool catalog；
* Role definitions；
* Model selection；
* Policies；

都应该版本化、review、test、staged rollout、rollback。([AWS Documentation][13])

Workflow DSL 更应该如此。

因此：

```text
SKILL.md
```

不能只是：

```text
documentation
```

而应该：

```text
executable policy-bearing artifact
```

需要：

```text
Git
Review
Lint
Test
Version
Hash
Release
Rollback
```

---

# 52. 推荐的 DSL 发布流程

```text
SKILL.md
   ↓
Parse
   ↓
Validate
   ↓
Static Analyze
   ↓
Tests
   ↓
Review
   ↓
Version
   ↓
Publish
   ↓
Runtime Load
```

而不是：

```text
Developer edits SKILL.md
   ↓
Production immediately executes
```

---

# 53. Lint 应该成为 CI Gate

例如：

```bash
flow-lint skills/investment-review/SKILL.md
```

检查：

```text
syntax
semantic
graph
security
capability
```

其中：

```text
error → CI failed
warning → CI may pass
```

当前项目已有：

```text
flow-lint
```

这个方向非常适合继续强化。

---

# 54. 最值得自动化的静态检查

未来至少可以有：

```text
flow-lint
├── syntax
├── node
├── route
├── outcome
├── reachability
├── terminal-path
├── capability
├── policy
├── approval
├── side-effect
└── version
```

甚至可以进一步：

```text
flow-lint --security
flow-lint --complexity
flow-lint --explain
```

---

# 55. Workflow Complexity 也应该可分析

例如：

```text
nodes = 6
edges = 8
cycles = 1
reviewNodes = 2
commands = 1
maxPathLength = 6
```

这样可以发现：

```text
流程越来越复杂
```

以及：

```text
Agent complexity
```

是否已经开始超过人能够维护的范围。

AWS 对 Agentic Workflow 本身也强调限制 depth、cycle 和 fan-out 来防止执行链无限增长。([AWS Documentation][1])

---

# 56. DSL 设计应该借鉴 Workflow Patterns，而不是 BPMN Syntax

这是当前项目一个值得明确的架构观点。

不建议：

```text
“我们需要 BPMN，所以把 BPMN 的 100 个元素翻译成 Markdown。”
```

更好的方法：

```text
Workflow Patterns
        ↓
Identify required patterns
        ↓
Choose minimal DSL constructs
        ↓
Define formal semantics
```

Workflow Patterns 研究本身就是技术无关的，目的就是把反复出现的业务流程需求抽象成 pattern，而不是绑定到某一种语言。([MIT Press][4])

---

# 57. BPMN 什么时候更适合

如果业务开始要求：

```text
复杂并行
复杂 join
timer boundary events
message events
event subprocess
compensation
choreography
visual business modeling
跨组织协作
```

BPMN 的成熟生态就有明显价值。

OMG BPMN 2.0.2 已定义完整建模元素和 execution semantics，并且大量 BPM 产品围绕它建立工具链。([OMG][6])

所以不是：

```text
BPMN bad
DSL good
```

而是：

```text
当前问题规模
    ↓
选择足够表达的最小语言
```

---

# 58. 当前项目为什么不需要 BPMN

当前 Flow DSL 的核心问题是：

```text
AI Task
+
Deterministic Gate
+
Human Review
+
Business Command
```

而不是：

```text
complete enterprise BPM suite
```

因此：

```text
Markdown DSL
+
AST
+
Validator
+
Analyzer
+
Runtime
```

已经足够。

反而引入 BPMN Runtime 会带来：

```text
引擎复杂度
建模复杂度
部署复杂度
学习成本
与 Agent Runtime 的额外耦合
```

不一定值得。

---

# 59. 当前 DSL 最重要的未来扩展候选：Parallel

如果金融业务开始真正出现：

```text
Compliance
Risk
Legal
```

并行独立 Review：

```text
             ┌→ Compliance
Case ────────┼→ Risk
             └→ Legal
                    │
                    ▼
                  Join
```

当前 DSL 还没有自然表达：

```text
parallel split
synchronization
```

这属于 Workflow Patterns 中非常基础的控制流模式。([Eindhoven Tech Research Portal][8])

但不建议现在仅为了“完整”就加入 `@parallel`。

原则：

> **出现真实业务需求后，再增加对应语义。**

而且应该先定义：

```text
join semantics
failure semantics
timeout semantics
partial completion
compensation
```

再加语法。

---

# 60. 第二个未来扩展：Structured Data

当前：

```text
- success -> compliance
```

足够简单。

但是如果未来需要：

```text
riskScore >= 80
```

这样的分支，不建议直接让 DSL 变成一套复杂表达式语言。

可以先考虑：

```text
@gate risk
registry:
    risk-classifier
```

然后：

```text
- high -> review
- low -> auto
```

也就是说：

> **把复杂业务判断封装在 deterministic registry，而不是继续扩大 DSL 表达式能力。**

---

# 61. 为什么 `@gate` 是一个非常重要的设计

如果没有 `@gate`：

```text
LLM Task
    ↓
LLM decides route
```

或者：

```text
Workflow DSL
    ↓
inline expression engine
```

都会导致复杂度增加。

有 `@gate`：

```text
Workflow
    ↓
@gate compliance
    ↓
registered deterministic function
```

DSL 只负责：

```text
控制流程
```

而 Registry 负责：

```text
业务判断
```

形成：

```text
Workflow
    = process truth

Gate
    = decision implementation
```

这也是非常好的职责边界。

---

# 62. DSL 不应该内置数据库查询语言

不要：

```text
@gate compliance
condition:
    SELECT ...
    WHERE ...
```

这会把 DSL 变成：

```text
workflow + SQL + rules engine
```

更合理：

```text
@gate compliance
handler:
    compliance.check
```

然后：

```text
Registry
    → Domain / Policy / Data
```

这样：

```text
DSL
```

继续保持稳定。

---

# 63. Deterministic Runtime 的真正安全目标

Runtime 不只是：

```text
“按图执行。”
```

还必须保证：

```text
Agent cannot:
    skip node
    invent node
    mutate state directly
    bypass gate
    bypass review
    execute arbitrary command
```

因此：

```text
Agent Output
    ↓
interpreted as data
```

而：

```text
Workflow Definition
    ↓
interpreted as authority
```

这个区别极其关键。

AWS 的 Workflow Security guidance 正是强调状态机权限、transition validation、circuit breaker 和 execution-path reconstruction，以防 Agent 或错误输入把整个 Workflow 带到未批准路径。([AWS Documentation][14])

---

# 64. Runtime 必须验证 Transition

即使：

```text
Agent says:
    next = publish
```

Runtime 也应该：

```text
current = research

allowed targets:
    compliance
    research-failed

requested:
    publish

→ reject
```

也就是说：

> **LLM 可以提出 Outcome，不能提出任意 Target Node。**

更严格一点：

```text
Agent
    → output = success

Runtime
    → lookup success edge
```

甚至 Agent 根本不知道：

```text
publish
```

是否存在。

---

# 65. 这也是为什么 Outcome 优于 Target

危险：

```json
{
  "next": "publish"
}
```

更安全：

```json
{
  "outcome": "success"
}
```

然后：

```text
Runtime:
    success → compliance
```

因为：

```text
Target
```

本身就是控制权限。

而：

```text
Outcome
```

是工作结果。

这和：

```text
Command Intent
```

的理念完全一致。

---

# 66. Runtime 应把 Agent 当“不可信执行器”

Agent 可以：

```text
成功
失败
产生结果
请求工具
产生建议
```

但是 Runtime 不应该相信 Agent 提供的：

```text
nextNode
authorization
approval
workflow state
```

所以：

```text
Agent result
    = untrusted result

Workflow definition
    = trusted control
```

---

# 67. Formal Model

如果要把 Runtime 稍微形式化，可以把 Workflow 表述成：

```text
W = (N, E, s, T)
```

其中：

```text
N = Nodes
E = Edges
s = Start Node
T = Terminal Nodes
```

每个 Node：

```text
n = (type, id, contract)
```

每条 Edge：

```text
e = (source, outcome, target)
```

Runtime 状态：

```text
S = (
  executionId,
  currentNode,
  workflowVersion,
  context,
  stepCount
)
```

Node 执行：

```text
execute(S, Node)
    → Outcome
```

状态转移：

```text
transition(
    Node,
    Outcome
)
    → NextNode
```

整个 Workflow 执行因此可以成为一个确定性的 transition system。

---

# 68. Agent Task 不需要数学确定性

这里一个很重要的认识：

```text
execute(task)
```

可以是：

```text
non-deterministic
```

但：

```text
transition(task, outcome)
```

应该是：

```text
deterministic
```

即：

```text
                   Probabilistic
                         ↑
                         │
                    AI Task
                         │
                         ▼
                Structured Outcome
                         │
                 deterministic
                         ▼
                   Workflow
```

这正是：

> **Probabilistic Work + Deterministic Control**

---

# 69. Runtime 的 Replay 模型

推荐：

```text
Execution
    ↓
Step 1
    outcome = success
    ↓
Step 2
    outcome = pass
    ↓
Step 3
    waiting
```

恢复时：

```text
load persisted state
+
load persisted outcomes
```

而不是：

```text
rerun everything
```

即：

```text
Replay = reconstruct state
```

而不是：

```text
Replay = ask all Agents again
```

这对于：

* 审计；
* 故障恢复；
* 版本兼容；
* 调查；

都非常重要。

---

# 70. Runtime 不应该偷偷重新解释历史 Definition

例如：

```text
Execution E1
Definition v13
```

恢复：

```text
Latest Definition v15
```

不能：

```text
load v15
continue E1
```

必须：

```text
E1 → v13
```

因此 Definition 需要：

```text
immutable version
```

---

# 71. Runtime Migration 是高级能力，不是默认行为

如果真的需要：

```text
v13 → v14
```

应该显式提供：

```text
migration script
```

例如：

```text
v13 current node = compliance
v14 renamed node = compliance-review
```

迁移：

```text
migration(v13-state)
    → v14-state
```

并记录：

```text
migration version
```

不要隐式兼容。

---

# 72. DSL 的错误处理应分级

建议：

```text
Syntax Error
    → cannot parse

Validation Error
    → cannot publish

Analysis Error
    → structurally unsafe

Runtime Error
    → execution failed
```

例如：

```text
@task
```

缺 ID：

```text
syntax / validation
```

Node unreachable：

```text
analysis
```

External API timeout：

```text
runtime
```

这样错误模型也非常清晰。

---

# 73. Warning 不应该等于 Error

例如：

```text
no @end
```

如果这是一个纯失败终止 Workflow：

```text
@stop
```

未必是 fatal error。

因此：

```text
error
warning
```

要有清晰语义。

当前项目已经区分两者，这个方向是合理的。

---

# 74. “No Success Path” 应该是 Warning 还是 Error

取决于 Workflow：

如果存在：

```text
@end
```

但 unreachable：

```text
error
```

因为定义本身错误。

如果只有：

```text
@stop
```

这是一个永远失败的 Workflow。

可以：

```text
warning
```

因为从语法和图结构上它仍然是合法的，但可能不符合业务意图。

这种 distinction 很有价值。

---

# 75. DSL 应该支持明确的 Terminal Semantics

例如：

```text
@stop rejected
```

表示：

```text
terminal outcome = unsuccessful
```

而：

```text
@end completed
```

表示：

```text
terminal outcome = successful
```

Runtime 不应该再猜：

```text
node.id === "completed"
```

是不是成功。

---

# 76. 为什么 Terminal Semantics 对 Audit 很重要

最终审计：

```text
execution.status = STOPPED
```

和：

```text
execution.status = COMPLETED
```

应该具有明确业务语义。

如果 Terminal 是隐含的：

```text
no outgoing edges
```

就很难区分：

```text
success
failure
abnormal end
```

所以当前的：

```text
@stop
@end
```

非常有价值。

---

# 77. DSL 应当区分 Process Decision 与 Business Decision

例如：

```text
@gate compliance
```

是：

```text
Process Decision
```

而：

```text
@review PM
```

是：

```text
Business / Human Decision
```

二者不能混为：

```text
if compliance == pass
```

因为：

```text
gate
```

可能是纯确定性系统判断，

而：

```text
review
```

承担真正的人类业务责任。

---

# 78. 一个完整的 Financial Workflow 示例

```md
## @flow investment-review
start -> research

## @task research
output: non-empty
tools: read,url
- success -> compliance
- fail -> research-failed

## @gate compliance
- pass -> compliance-review
- review -> compliance-review
- fail -> rejected

## @review compliance-review
role: compliance.reviewer
strategy: ALL
required: 2
exclude: initiator
- approve -> pm-review
- reject -> rejected

## @review pm-review
role: investment.reviewer
- approve -> publish
- reject -> rejected

## @command publish
role: investment.reviewer
- success -> completed
- fail -> publish-failed

## @stop rejected
## @stop research-failed
## @stop publish-failed
## @end completed
```

它表达了：

```text
Process:
    research
       ↓
    compliance
       ↓
    PM
       ↓
    publish

AI:
    research

System:
    compliance gate

Human:
    compliance
    PM

Business mutation:
    publish
```

这就是一个很好的 Financial Workflow DSL。

---

# 79. Runtime 执行上述 DSL

可以抽象成：

```text
START
  ↓
research
  │
  └─ success
       ↓
compliance
       │
       └─ pass
            ↓
      compliance-review
            │
            └─ approve
                 ↓
              pm-review
                 │
                 └─ approve
                      ↓
                   publish
                      │
                      └─ success
                           ↓
                       completed
```

整个路径由：

```text
FlowDefinition
```

决定。

Agent 从来没有机会：

```text
跳过 compliance
```

---

# 80. 当前项目架构为什么是合理的

当前：

```text
SKILL.md
  ↓
flow-parser.ts
  ↓
FlowAst
  ↓
flow-validator.ts
  ↓
FlowDefinition
  ↓
flow-analyzer.ts
  ↓
WorkflowRunner
  ↓
FlowNodeRuntime
  ↓
WorkflowTurnRunner
```

实际上对应：

```text
Source Language
      ↓
Parsing
      ↓
Semantic Validation
      ↓
Static Analysis
      ↓
Compiled Definition
      ↓
Deterministic Runtime
      ↓
Pluggable Agent Runtime
```

这个结构很接近一个小型编译器 / workflow engine，而不是简单的：

```text
Markdown parser + Agent
```

这正是它值得继续保留的地方。

---

# 81. 不应该进一步把 Runtime 做成 Agent Framework

不要让：

```text
WorkflowRunner
```

依赖：

```text
Copilot SDK
LangChain
OpenAI Agents
```

它只依赖：

```text
FlowDefinition
Node Runtime
Persistence
Policy
Command
Human Task
```

Agent Runtime 通过：

```text
WorkflowTurnRunner
```

提供。

这样：

```text
Workflow Layer
```

可以长期稳定。

---

# 82. Deterministic Runtime 的“可信计算基”

可以把：

```text
Parser
Validator
Analyzer
WorkflowRunner
Policy
CommandService
HumanTaskService
Domain
```

视为：

```text
Trusted Control Plane
```

而：

```text
LLM
Agent
Tool Result
Retrieved Document
External Content
```

视为：

```text
Untrusted / Probabilistic Plane
```

于是：

```text
Trusted Control
        ↓
constrains
        ↓
Probabilistic Work
```

而不是反过来。

---

# 83. DSL 其实是 Policy Boundary 的一部分

如果 Workflow 定义：

```text
@command publish
```

它不仅是在描述：

```text
流程
```

还隐含：

```text
允许流程到达一个高风险 mutation node
```

因此 Workflow Definition 本身应该受到：

```text
review
approval
version control
deployment control
```

保护。

AWS 也明确建议 Workflow Definitions 本身通过 IaC、版本控制和资源级权限来避免非正式修改。([AWS Documentation][14])

---

# 84. Workflow Definition 的变更本身需要 Audit

例如：

```text
v13:
Compliance
  ↓
PM

v14:
Compliance
  ↓
Risk
  ↓
PM
```

必须记录：

```text
who changed
what changed
when
why
approved by
deployed when
```

否则你可以审计业务运行：

```text
execution
```

却不知道：

```text
为什么流程本身变了
```

这在金融系统中是不完整的。

---

# 85. DSL Review 应当像代码 Review

建议：

```text
Pull Request
   ↓
Flow Lint
   ↓
Static Analysis
   ↓
Workflow Test
   ↓
Security Review
   ↓
Approval
   ↓
Release
```

而不是：

```text
edit SKILL.md
   ↓
production
```

AWS 当前明确把 Agent behavior、prompt、tool catalog、role definitions、model selection 和 policy 当作 versioned artifacts 管理；Workflow DSL 更应该如此。([AWS Documentation][13])

---

# 86. 测试应该分三层

## Unit

测试：

```text
parser
validator
analyzer
transition
```

---

## Scenario

例如：

```text
Research success
→ Compliance pass
→ PM approve
→ Publish success
```

---

## Recovery

例如：

```text
waiting approval
→ process crash
→ restart
→ callback
→ resume
```

以及：

```text
command timeout
→ retry
→ idempotent replay
```

---

# 87. Property-based / Graph-based Testing 也很有价值

Workflow 天然是图。

可以自动验证：

```text
all reachable nodes
    eventually:
        terminal
```

除非允许：

```text
intentional cycle
```

还可以验证：

```text
no node has undefined target
no required outcome lacks route
no terminal has outgoing route
```

这些都非常适合自动生成测试。

---

# 88. Process Mining 是 Runtime 之后的下一步

Workflow Engine 本身产生：

```text
event log
```

之后可以：

```text
process mining
```

分析：

```text
actual path
vs
defined path
```

例如：

```text
Defined:
Research → Compliance → PM → Publish

Actual:
Research → Compliance → Research → Compliance → PM → Publish
```

可以发现：

```text
rework
bottleneck
loop
unexpected path
```

Process mining 已经是成熟的 BPM 研究和产品领域，van der Aalst 的研究体系就是从 event logs 与 process models 的结合出发分析真实业务流程。([Wil van der Aalst][15])

这对于 Agent Workflow 特别有意义，因为 AI 参与后可能产生新的：

```text
rework loop
retry pattern
human bottleneck
tool overuse
```

---

# 89. Deterministic Runtime + Process Mining 是很好的组合

可以形成：

```text
Workflow Definition
       +
Execution Event Log
       ↓
Process Mining
       ↓
Actual Process
       ↓
Compare
       ↓
Workflow Improvement
```

这样 Workflow DSL 不只是：

```text
execution engine
```

还成为：

```text
process governance model
```

---

# 90. 不应该让 Agent 动态修改 Workflow Definition

高风险反模式：

```text
Agent discovers problem
   ↓
Agent edits workflow
   ↓
Workflow continues
```

这相当于：

```text
Agent changes its own control boundary
```

应该：

```text
Agent proposes change
       ↓
Human / Architecture Review
       ↓
Versioned Definition
       ↓
Release
       ↓
New executions
```

运行中的 Execution 不应该偷偷切换。

---

# 91. 动态 Agent Workflow 与 Deterministic Workflow 可以共存

这不是二选一。

推荐：

```text
Outer Workflow
    deterministic
        │
        ▼
     @task
        │
   dynamic Agent
    ┌───┼────┐
    ▼   ▼    ▼
 Search Read Analyze
    └───┼────┘
        ▼
 structured result
        │
        ▼
   deterministic
    Workflow
```

这其实是最现实的金融 Agent 架构：

> **Deterministic shell + Probabilistic core**

而不是：

```text
Everything deterministic
```

也不是：

```text
Everything agentic
```

---

# 92. 什么情况下应该让 Agent 动态规划

适合：

```text
research
investigation
open-ended information gathering
complex analysis
creative drafting
```

不适合：

```text
approval sequence
regulatory routing
authorization
financial state transition
settlement
payment
high-risk external communication
```

AWS 当前也明确把 deterministic workflows 与 dynamic agentic workflows 视为两种不同模式：预先知道执行图时使用 deterministic workflow，路径由模型中间结果决定时才用 dynamic agent orchestration。([AWS Documentation][1])

---

# 93. 金融领域最合理的执行模型

```text
                 Deterministic
                      ↑
                      │
              ┌───────────────┐
              │   Workflow    │
              │               │
              │ State         │
              │ Policy        │
              │ Approval      │
              │ Command      │
              │ Domain        │
              └───────┬───────┘
                      │
                structured
                  interface
                      │
                      ▼
              ┌───────────────┐
              │   AI Agent    │
              │               │
              │ Reasoning     │
              │ Research      │
              │ Planning      │
              │ Generation    │
              └───────────────┘
                      │
                      ▼
                 Probabilistic
```

越靠近：

```text
business state mutation
```

越应该：

```text
deterministic
```

---

# 94. 业界经验可以归纳成一个共同趋势

AWS：

```text
deterministic workflow
vs
dynamic agentic workflow
```

Microsoft：

```text
developer decides
→ Workflow

model decides
→ Agent

human decides
→ HITL
```

BPMN：

```text
formalized process model
+
execution semantics
```

Workflow Patterns：

```text
abstract control-flow patterns
```

这些路径虽然产品形态不同，但实际上指向同一个架构思想：

> **不要把“流程控制权”隐式放进模型。**

([AWS Documentation][1])

---

# 95. 最终推荐的 Financial Workflow DSL 原则

```text
1. DSL describes business control, not AI reasoning.

2. State transitions must be explicit.

3. Agent output should be a bounded outcome, not a target node.

4. Runtime owns routing; Agent does not.

5. Source DSL must be parsed into an AST before semantic validation.

6. Validation and static analysis should happen before production execution.

7. Runtime executes only validated, versioned definitions.

8. Running executions bind to an immutable workflow version/source hash.

9. Agent task results should be persisted and replayed, not blindly regenerated.

10. Human approvals are durable workflow state.

11. External side effects must be isolated behind Commands and idempotent executors.

12. Workflow cycles are allowed only as intentional process behavior.

13. Runtime needs hard execution limits as a safety boundary.

14. Business failures, technical failures and policy denials must have different semantics.

15. Workflow definitions are governed artifacts and require versioning/review.

16. DSL size should be driven by actual workflow patterns, not feature completeness.

17. Dynamic Agent reasoning should live inside bounded Workflow nodes.

18. Deterministic control should become stricter as the process approaches business state mutation.
```

---

# 96. 当前项目的最终架构模型

当前项目可以非常清晰地收敛成：

```text
                       SKILL.md
                           │
                           ▼
                    ┌─────────────┐
                    │ Flow Parser │
                    └──────┬──────┘
                           │
                           ▼
                        FlowAst
                           │
                           ▼
                  ┌─────────────────┐
                  │ Flow Validator  │
                  └────────┬────────┘
                           │
                           ▼
                    FlowDefinition
                           │
                           ▼
                  ┌─────────────────┐
                  │ Flow Analyzer   │
                  │ CFG / Reachable │
                  │ Terminal Paths  │
                  └────────┬────────┘
                           │
                           ▼
                 Validated Definition
                           │
                           ▼
                  ┌─────────────────┐
                  │ WorkflowRunner  │
                  │                 │
                  │ State / CAS     │
                  │ Retry / Resume  │
                  │ Step Limit      │
                  └────────┬────────┘
                           │
                  ┌────────┼─────────┐
                  ▼        ▼         ▼
                @task    @review   @command
                  │        │         │
                  ▼        ▼         ▼
             Agent      Human     Command
             Runtime     Task     Service
                  │                   │
                  ▼                   ▼
             LLM / Tools          Domain API
```

这个结构的核心优势是：

```text
Workflow DSL
    不依赖 Copilot SDK

Workflow Runtime
    不依赖 Copilot SDK

Agent Runtime
    可以替换

Command / Policy / Domain
    继续保持确定性
```

这也是当前项目最值得保持的架构方向。

---

# 97. 当前项目不建议继续增加的东西

现阶段不建议为了“完整 Workflow Engine”而马上加入：

```text
@route
@subflow
@condition
@parallel
@foreach
@compensation
@event
@signal
@transaction
```

尤其不应该出现：

```text
Agent DSL
```

把 Agent Framework 的全部能力复制进去。

当前更重要的是把：

```text
@task
@gate
@review
@command
@stop
@end
```

的 semantics 做到真正稳定。

---

# 98. 下一阶段真正值得增加的能力

如果真实业务出现需求，优先级更可能是：

### 1. Parallel / Join

支持：

```text
Compliance
Risk
Legal
```

并行 review。

### 2. Structured Gate Input

让：

```text
@gate risk
```

可以声明：

```text
input schema
output outcomes
```

### 3. Explicit Timeout / Escalation

特别是：

```text
@review
```

### 4. Definition Migration

处理：

```text
running execution
workflow version
```

### 5. Process Mining / Execution Analytics

使用：

```text
execution event log
```

发现真实流程瓶颈。

这些扩展都应该以**实际 Workflow Pattern**为驱动，而不是为了让 DSL 看起来完整。

---

# 99. 最终判断：这个项目到底是在做什么

它不应该被理解成：

> 一个“Markdown Agent Framework”。

更准确的定位是：

> **一个面向金融业务的轻量级 Deterministic Workflow Control Layer，用 AI Agent 作为其中一种可替换的工作执行器。**

架构上：

```text
                Business Process
                      │
                      ▼
             Deterministic Workflow
                      │
          ┌───────────┼─────────────┐
          ▼           ▼             ▼
         AI          Human        System
        Work        Decision      Action
          │           │             │
          └───────────┼─────────────┘
                      ▼
                   Domain
```

而不是：

```text
Business Process
      ↓
Autonomous Agent
      ↓
Agent decides everything
```

---

# 100. 最值得记住的一句话

> **Workflow DSL 的价值不是让 AI 学会“画流程”，而是把金融业务中不能交给 AI 自由决定的那部分控制逻辑显式、版本化、可验证、可恢复地固定下来。**

然后：

> **Agent 获得的自由度应该集中在 Workflow Node 内部的“如何完成工作”，而不是 Workflow 本身的“业务应该往哪里走”。**

最终形成：

```text
         Probabilistic Work
                │
                ▼
           @task / Agent
                │
                ▼
        Structured Outcome
                │
                ▼
       Deterministic Control
                │
      ┌─────────┼─────────┐
      ▼         ▼         ▼
    @gate     @review   @command
      │         │         │
      └─────────┼─────────┘
                ▼
             Domain
                │
                ▼
          Business Truth
```

这就是金融领域最值得采用的 **Deterministic Workflow + Probabilistic Agent** 架构。

---

## 参考资料

**AWS — Agentic AI Lens**
2026 年版 Agentic AI Lens 明确将 deterministic workflow 与 dynamic agentic workflow 区分，并强调 bounded agents、explicit contracts、least privilege、tiered human oversight 和 versioned agent behavior。([AWS Documentation][16])

**AWS — Predictable task execution**
提出 atomic task、least privilege、structured output、behavioral monitoring 和明确的 Agent instruction protocol。([AWS Documentation][3])

**AWS — Efficient workflow orchestration**
明确指出：执行图在设计时已知的 deterministic workflows 适合 Step Functions 等确定性 orchestration；模型动态决定路径的任务则适合 Agentic orchestration，并建议限制 cycle、depth 和 fan-out。([AWS Documentation][1])

**AWS Step Functions / Amazon States Language**
ASL 是结构化状态机语言，以 `Task`、`Choice`、`Parallel`、`Map`、`Wait`、`Succeed`、`Fail` 等显式状态表示 Workflow，并具有明确的 Retry / Catch / Timeout 语义。([AWS Documentation][7])

**AWS Workflow Security Controls**
Workflow Orchestration 层应保护状态机定义和执行状态，验证状态转换，使用 circuit breaker，并记录足以重构 execution path 的执行信息。([AWS Documentation][14])

**Microsoft Agent Framework — Workflows**
明确采用：“代码决定结果 → deterministic executor；模型决定下一步 → Agent；人决定 → HITL”。([Microsoft Learn][2])

**Microsoft Agent Framework — HITL**
使用 request/response、RequestPort、checkpoint 和 resume 实现持久化 Human-in-the-loop Workflow。([Microsoft Learn][10])

**OMG — BPMN 2.0.2**
BPMN 是成熟的业务流程建模标准，并定义 execution semantics，为流程语言的形式化和执行提供参考。([OMG][6])

**van der Aalst et al. — Workflow Patterns**
系统总结 sequence、choice、parallel、synchronization 等通用 Workflow Patterns，是设计轻量 DSL 语义范围的重要理论参考。([MIT Press][4])

**van der Aalst — Business Process Management**
指出 control-flow 只是 BPM 的一个视角，resource、data、time、function 等同样重要；也强调 process models 与 event logs 的结合，为后续 process mining 提供基础。([Wiley Online Library][17])

**AWS — Tiered human oversight**
风险分类应以 deterministic policy / rule 为 authoritative mechanism，并把高风险动作路由到结构化审批 Workflow。([AWS Documentation][18])

---

这篇和前面的文档串起来后，整个系列实际上已经形成：

```text
01  Financial AI Agent Workflow Architecture
        ↓
02  Agent / Workflow / Policy / Domain Boundary
        ↓
03  Multi-user Collaboration + HITL
        ↓
04  Authorization / Data Entitlement / Capability
        ↓
05  Command / Approval / Idempotency
        ↓
06  AI Observability + Regulatory Audit Evidence
        ↓
07  Financial Workflow DSL + Deterministic Runtime
```

第 7 篇实际上是这套体系的“运行时落地层”：前 6 篇定义**为什么必须这样控制**，这一篇定义**如何把这些控制编译成一个可验证、可恢复、与 Agent Runtime 解耦的执行模型**。

[1]: https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentperf05-bp01.html?utm_source=chatgpt.com "AGENTPERF05-BP01 Design efficient workflow orchestration patterns - Agentic AI Lens"
[2]: https://learn.microsoft.com/en-us/agent-framework/journey/workflows?utm_source=chatgpt.com "Workflows | Microsoft Learn"
[3]: https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentrel02.html?utm_source=chatgpt.com "Predictable task execution - Agentic AI Lens"
[4]: https://mitpress.mit.edu/9780262029827/workflow-patterns/?utm_source=chatgpt.com "Workflow Patterns"
[5]: https://docs.aws.amazon.com/step-functions/latest/dg/concepts-statemachines.html?utm_source=chatgpt.com "Learn about state machines in Step Functions - AWS Step Functions"
[6]: https://www.omg.org/spec/BPMN/?utm_source=chatgpt.com "About the Business Process Model and Notation Specification Version 2.0.2"
[7]: https://docs.aws.amazon.com/step-functions/latest/dg/concepts-amazon-states-language.html?utm_source=chatgpt.com "Using Amazon States Language to define Step Functions workflows - AWS Step Functions"
[8]: https://research.tue.nl/en/publications/workflow-control-flow-patterns-a-revised-view/?utm_source=chatgpt.com "Workflow control-flow patterns : a revised view - Research portal Eindhoven University of Technology"
[9]: https://docs.aws.amazon.com/step-functions/latest/dg/concepts-error-handling.html?utm_source=chatgpt.com "Handling errors in Step Functions workflows - AWS Step Functions"
[10]: https://learn.microsoft.com/en-us/agent-framework/workflows/human-in-the-loop?utm_source=chatgpt.com "Microsoft Agent Framework Workflows - Human-in-the-loop (HITL) | Microsoft Learn"
[11]: https://docs.aws.amazon.com/step-functions/latest/dg/workflow-studio-process-error.html?utm_source=chatgpt.com "Configure error handling with Workflow Studio in Step Functions - AWS Step Functions"
[12]: https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentsec04.html?utm_source=chatgpt.com "Agent goal alignment and manipulation prevention - Agentic AI Lens"
[13]: https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/design-principles.html?utm_source=chatgpt.com "Design principles - Agentic AI Lens"
[14]: https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentsec06-bp02.html?utm_source=chatgpt.com "AGENTSEC06-BP02 Implement workflow orchestration security controls - Agentic AI Lens"
[15]: https://vdaalst.com/research/research.html?utm_source=chatgpt.com "Research"
[16]: https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentic-ai-lens.html?utm_source=chatgpt.com "Agentic AI Lens - AWS Well-Architected - Agentic AI Lens"
[17]: https://onlinelibrary.wiley.com/doi/10.1155/2013/507984?utm_source=chatgpt.com "Business Process Management: A Comprehensive Survey - van der Aalst - 2013 - International Scholarly Research Notices - Wiley Online Library"
[18]: https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentsec04-bp02.html?utm_source=chatgpt.com "AGENTSEC04-BP02 Human-in-the-loop for critical decisions - Agentic AI Lens"

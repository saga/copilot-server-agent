# 为什么 `@task` 不应该等同于 Sub-Agent

> **核心结论**
>
> `Task` 和 `Sub-Agent` 解决的是两个不同层次的问题：
>
> **Task 定义 Workflow 要完成什么工作；Sub-Agent 定义这项工作由什么样的智能执行体完成。**
>
> 因此，在 Workflow DSL 中，`@task` 不应该天然意味着“启动一个 Sub-Agent”。
>
> 一个 Task 可以由普通代码、API、数据库操作、规则引擎、单次 LLM 调用、Agent 或 Sub-Agent 完成；反过来，一个 Sub-Agent 也可以在自己的 reasoning loop 中完成多个内部步骤，而这些步骤不一定都应该暴露成 Workflow Task。
>
> 这不是为了“少用 Agent”，而是为了让 **Workflow Semantic Model** 与 **Agent Runtime Model** 保持解耦。
>
> 对金融服务尤其重要，因为业务流程需要稳定、可审计的责任和控制边界，而 Agent 是一种具有概率性、动态性和自主性的执行机制。金融监管实践越来越强调：AI 可以参与过程，但责任、治理和风险控制仍然必须落在机构及其明确的责任主体上。FCA 曾明确指出，不能把 agency 归因于 AI，否则可能把决策责任从企业身上移走；BIS 也强调 AI 风险治理应该嵌入既有治理和三道防线体系。

---

## 1. 为什么这个问题容易被设计错

一个很自然的 DSL 是：

```ts
@task
class AnalyzeProposal {
  ...
}
```

然后很容易进一步设计成：

```ts
@task
@agent("research-agent")
class AnalyzeProposal {
  ...
}
```

再进一步：

```ts
@task
async analyzeProposal() {
  return spawnSubAgent(...)
}
```

于是系统慢慢形成了一个隐含假设：

```text
Task = Agent invocation
```

最终 Workflow 看起来就变成：

```text
Task A
 ↓
Sub-Agent A

Task B
 ↓
Sub-Agent B

Task C
 ↓
Sub-Agent C
```

这看起来很“Agentic”，但实际上把两个不同的问题混到了一起：

```text
Workflow：
“业务流程中有哪些工作？”

Agent Runtime：
“完成某项工作时，是否需要自主推理？”
```

Anthropic 对这一点的定义非常清楚：Workflow 是通过预先定义的代码路径协调 LLM 和工具；Agent 则是由 LLM 动态决定自身流程和工具使用。Anthropic 同时建议优先使用最简单的实现，只在需要动态性时增加 Agent 的复杂度。

因此：

```text
Task ≠ Agent
Task ≠ Sub-Agent
```

更准确的关系是：

```text
                 Workflow Task
                      │
            ┌─────────┼─────────┐
            ↓         ↓         ↓
         Code       API       Agent
                                │
                                ↓
                            Sub-Agent
```

Sub-Agent 只是 Task 的一种可能执行方式。

---

# 2. Task 到底是什么

建议把 Task 定义为：

> **Workflow 中具有明确输入、输出、生命周期和责任边界的一个工作单元。**

注意这里没有出现：

```text
LLM
Agent
Reasoning
Prompt
Model
```

因为这些都不是 Task 的语义。

例如：

```text
Load ISS Proposal
Calculate Exposure
Retrieve Policy
Analyze Proposal
Generate Vote Recommendation
Create Report
Validate Data
Persist Result
```

都是 Task。

其中：

```text
Calculate Exposure
```

可能完全不需要 AI：

```python
exposure = position / portfolio_value
```

而：

```text
Analyze Proposal
```

可能需要 LLM：

```text
LLM call
```

更复杂的：

```text
Research Governance Issues
```

可能需要 Sub-Agent：

```text
Sub-Agent
  ↓
Search
  ↓
Read documents
  ↓
Compare sources
  ↓
Search again
  ↓
Synthesize
  ↓
Return result
```

三者对于 Workflow 来说都可以是：

```text
Task
```

因为 Workflow 关心的是：

> **这一步要完成什么工作？**

而不是：

> **这一步内部用了什么执行技术？**

---

# 3. Sub-Agent 到底是什么

Sub-Agent 是一个 **Runtime Execution Model**。

一个 Sub-Agent 通常意味着：

```text
LLM
 +
Instructions
 +
Tools
 +
Context
 +
Reasoning loop
 +
Possibly memory
```

它不是简单地执行一次函数，而是可能：

```text
Reason
 ↓
Tool
 ↓
Observe
 ↓
Reason
 ↓
Tool
 ↓
Observe
 ↓
Decide done
```

Anthropic 对 Agent 的定义正是这种“LLM 自主使用工具的循环”；其多 Agent Research 系统采用 orchestrator-worker 架构，由 lead agent 创建多个 specialized subagents 并行完成不同研究工作。

AWS 当前 Agentic AI Lens 则进一步给出了非常有价值的区分：

> 默认优先使用 tools；只有当能力需要 independent reasoning 时，才应该升级成 sub-agent。

AWS 明确指出，Tool call 通常是单次、确定性的快速操作，而 Sub-Agent delegation 是一个完整的 LLM reasoning loop，会带来额外时间和 token 成本。只有需要自己的 reasoning、自己的 context/memory、multi-step tool orchestration、不同模型/Prompt 或独立 failure isolation 时，才更适合使用 Sub-Agent。

这实际上直接支持：

```text
Task ≠ Sub-Agent
```

因为二者的判断标准根本不同。

---

# 4. 最关键的区别：Semantic Unit vs Execution Unit

可以把两者放在不同层次理解。

```text
┌─────────────────────────────────────┐
│         Workflow Semantic Layer     │
│                                     │
│ Task / Gate / Review / Command      │
└──────────────────┬──────────────────┘
                   │
                   │ execution
                   ↓
┌─────────────────────────────────────┐
│          Execution Layer            │
│                                     │
│ Function / API / SQL / LLM / Agent  │
│ / Sub-Agent / Sub-Workflow          │
└─────────────────────────────────────┘
```

也就是说：

```text
Task
=
Business Workflow 的工作单元

Sub-Agent
=
一种执行机制
```

这个区分非常重要。

例如：

```text
Task:
Analyze Proxy Proposal
```

可以有不同 implementation：

```text
Implementation A:
Deterministic parser

Implementation B:
Single LLM call

Implementation C:
Research Agent

Implementation D:
Multi-agent research workflow
```

Workflow 本身并不因此改变。

---

# 5. 为什么这是一个重要的架构解耦

假设一开始：

```text
Analyze Proposal
→ GPT-5 Agent
```

一年以后为了成本、性能或者治理，改成：

```text
Analyze Proposal
→ Small LLM
```

再后来：

```text
Analyze Proposal
→ Rule + Retrieval + LLM
```

再后来：

```text
Analyze Proposal
→ External Research Service
```

如果：

```text
Task = Agent
```

那么 Workflow DSL 会不断随着 Agent 技术发生变化。

但如果：

```text
Task = Semantic Work Unit
Agent = Execution Strategy
```

那么：

```text
Workflow
  ↓
AnalyzeProposal
  ↓
Execution Strategy
  ├── Agent
  ├── LLM
  ├── API
  └── Code
```

可以独立演进。

这正是 Anthropic 所说的“simple, composable patterns”背后的重要思想：不要因为底层已经具备 Agent 能力，就让所有工作都采用 Agentic execution。对于结构稳定的问题，预定义 Workflow 往往更具 predictability 和 consistency。

---

# 6. Microsoft Agent Framework 其实提供了非常直接的证据

Microsoft 当前 Agent Framework 的 Workflow 模型把：

```text
Executors
```

和：

```text
Edges
```

作为 Workflow 的核心组成部分。

更重要的是：

> **Executor 可以是 AI Agent，也可以是 custom logic。**

也就是说：

```text
Workflow Executor
       │
       ├── AI Agent
       │
       └── Custom Logic
```

而不是：

```text
Workflow Executor
       ↓
Agent
```

Microsoft 的 Workflow Builder 直接把 Workflow 定义为由 Executors 和 Edges 构成的 directed graph；Executor 执行工作并产生输出。

这实际上与：

```text
Task = semantic unit
Executor = implementation
```

的模型非常接近。

Microsoft 甚至在其 Sequential Workflow 示例中明确展示了：

```text
Agents
+
Custom Executors
+
Human-in-the-loop
```

可以混合出现在同一个 Workflow 中。

---

# 7. OpenAI 也没有把 Agent 等同于 Task

OpenAI Agents SDK 当前把 Agent 看成一个可组合的组件。

官方提供两种主要组合方式：

```text
Agents as tools
Handoffs
```

其中：

### Agents as tools

一个 Agent 可以被另一个 Agent 当作一个 bounded capability 使用。

```text
Main Agent
    │
    ├── Search Tool
    ├── Calculator Tool
    └── Specialist Agent
```

主 Agent 仍然保持控制权。

OpenAI 明确建议，当 specialist 只是帮助处理一个 bounded subtask，而不应该接管整个会话时，使用 Agents as tools。

### Handoff

则表示：

```text
Agent A
   ↓
Agent B
```

Agent B 接管后续工作。

OpenAI 明确把这两个模式区分为：

```text
bounded assistance
vs
control transfer
```

而不是把“Task”作为 Agent 的同义词。

因此，在 Workflow DSL 中把：

```text
@task
```

直接定义成：

```text
spawn sub-agent
```

实际上比 OpenAI 自己的 Agent composition model 更强耦合。

---

# 8. 一个 Task 可能只需要一次 LLM Call

这是最容易被忽略的一点。

例如：

```text
Task:
Generate Meeting Summary
```

可能只需要：

```text
Prompt
+
Context
+
LLM
→
Summary
```

没有：

```text
while
reason
tool
observe
reason
tool
```

也没有：

```text
independent context
delegation
handoff
```

因此：

```text
LLM Task
```

完全可以不是：

```text
Sub-Agent
```

可以简单理解为：

```text
Task
  ↓
LLM call
  ↓
Structured Output
```

Anthropic 的“prompt chaining”也是这种模式：固定 Workflow 中，一个 LLM call 的输出成为下一步输入；这类任务不需要转化为 autonomous Agent。

---

# 9. 一个 Task 甚至可能完全没有 AI

例如：

```text
Task:
Validate Position Data
```

实现可能是：

```ts
function validatePosition(position) {
  if (!position.securityId) throw ...
  if (position.quantity < 0) throw ...
}
```

或者：

```text
Task:
Get Current Price
```

直接：

```text
Market Data API
```

或者：

```text
Task:
Calculate Voting Exposure
```

直接：

```sql
SELECT ...
```

这些都应该是 Workflow 中合法的一等工作单元。

如果 `@task` 自动意味着 Sub-Agent，那么 DSL 就会迫使：

```text
deterministic work
```

也经过：

```text
LLM reasoning
```

这是明显的架构倒置。

AWS 当前 Agentic AI Lens 甚至把“用 sub-agent 做本来可以由 tool 完成的工作”列为低成熟度实践，并建议确定性、单步、快速的能力优先做成 Tool。

---

# 10. 反过来：一个 Sub-Agent 可以内部完成多个 Task

这是另一个证明。

假设 Workflow 只有：

```text
Task:
Research Company
```

但这个 Task 内部的 Agent：

```text
Search annual report
 ↓
Search regulatory filing
 ↓
Search news
 ↓
Compare evidence
 ↓
Identify discrepancies
 ↓
Generate summary
```

这里显然存在多个内部动作。

但我们不应该强迫它们全部变成：

```text
Task 1
Task 2
Task 3
Task 4
Task 5
```

因为它们是 Sub-Agent 内部的 reasoning process，而不是必须持久化、审计或编排的 Business Workflow state。

Anthropic 的 context engineering 文章明确介绍了这种设计：Sub-Agent 可以在独立 context window 中进行大量探索，再向主 Agent 返回经过压缩的结果；这种 context isolation 本身就是使用 Sub-Agent 的重要原因。

因此：

```text
Workflow Task
      ↓
Research Sub-Agent
      │
      ├── Search
      ├── Read
      ├── Compare
      ├── Search again
      └── Synthesize
      ↓
Task Result
```

是完全合理的。

---

# 11. 不要把 Sub-Agent 的内部步骤提升成 Business Workflow

这是金融领域特别重要的一点。

假设：

```text
Workflow:
Investment Research
```

其中：

```text
Research Agent
```

内部做：

```text
Search
Read
Compare
Reason
Retry
```

那么这些内部步骤通常不需要变成：

```text
Business State
```

而：

```text
Proposal Generated
Review Required
Approved
Submitted
```

才应该成为 Workflow State。

也就是说：

```text
Agent Runtime State
```

和：

```text
Business Workflow State
```

应该分开。

```text
┌───────────────────────────────┐
│       Business Workflow       │
│                               │
│ Analyze → Gate → Review       │
│          → Command            │
└──────────────┬────────────────┘
               │
               ↓
       ┌─────────────────┐
       │   Agent Runtime │
       │                 │
       │ Reason          │
       │ Tool            │
       │ Observe         │
       │ Retry           │
       │ Reason          │
       └─────────────────┘
```

这也延续了一个更大的架构原则：

> **Agent Memory / Agent Runtime State 不是 Business State。**

---

# 12. 为什么金融服务尤其需要这种边界

金融机构真正需要审计的通常不是：

```text
Agent thought 1
Agent thought 2
Agent thought 3
```

而是：

```text
哪个业务对象发生了什么状态变化？

为什么进入 Review？

哪个 Policy 生效？

谁承担决定责任？

哪个 Command 被执行？

执行前使用了什么授权？

执行之后 Business State 发生了什么变化？
```

FCA 明确强调不能把 AI 的 agency 当成责任主体，否则会导致 accountability 从企业转移出去；其 AI 治理框架强调 responsibility 应留在 firm。

BIS 2025 年关于中央银行 AI 治理的报告则建议把 AI 风险纳入既有风险治理体系，并使用三道防线模型区分 business ownership、risk/compliance oversight 和 independent assurance。

因此：

```text
Task
```

应该属于：

```text
Workflow / Business Process
```

而：

```text
Sub-Agent
```

应该属于：

```text
Execution / AI Capability
```

这两个层次不能因为技术实现方便而合并。

---

# 13. 最危险的 DSL 设计

最不建议的是：

```ts
@task
class ReviewResearch {
  agent = "research-agent"
}
```

然后规定：

> 每个 `@task` 都运行一个 Agent。

这样最终会变成：

```text
Workflow
   ↓
Task
   ↓
Agent
   ↓
Tool
```

所有业务行为都会被“Agent 化”。

结果包括：

```text
Data Validation
→ Agent

Calculation
→ Agent

Routing
→ Agent

Approval Classification
→ Agent

API Call
→ Agent
```

这不是 Agent Architecture，而是：

> **把 Agent 当成新的 RPC mechanism。**

这样做会同时带来：

```text
latency
token cost
nondeterminism
evaluation burden
security surface
failure complexity
```

AWS 明确指出 Sub-Agent delegation 本身就是完整 LLM reasoning loop，因此应该只在确实需要 independent reasoning 时使用。

Anthropic 也明确建议：“find the simplest solution possible”，不要为了使用 Agent 而使用 Agent。

---

# 14. 推荐的 Task / Agent 关系

更合理的模型是：

```text
                    Workflow Task
                          │
                 ┌────────┼────────┐
                 │        │        │
                 ↓        ↓        ↓
              Code      API       LLM
                                    │
                                    ↓
                                  Agent
                                    │
                              ┌─────┴─────┐
                              ↓           ↓
                           Tool A      Tool B
                              │
                              ↓
                          Reasoning Loop
```

也就是说：

```text
Task
```

定义：

```text
WHAT
```

而：

```text
Agent
```

定义：

```text
HOW
```

更完整一点：

```text
Task
  = semantic work contract

Executor
  = implementation mechanism

Agent
  = autonomous reasoning executor

Sub-Agent
  = delegated autonomous reasoning executor
```

---

# 15. Task Contract 应该是什么

建议一个 Task 至少具备：

```yaml
task:
  name: analyzeProposal

  input:
    proposal: ProxyProposal

  output:
    analysis: ProposalAnalysis

  timeout: 10m

  retry:
    maxAttempts: 2

  audit:
    required: true
```

这里完全没有：

```yaml
agent: true
```

因为这是一个 Execution Concern。

如果需要 Agent：

```yaml
task:
  name: analyzeProposal

  executor:
    type: agent
    ref: proxy-research-agent
```

如果换成普通 API：

```yaml
task:
  name: analyzeProposal

  executor:
    type: service
    ref: research-service
```

如果换成本地函数：

```yaml
task:
  name: calculateExposure

  executor:
    type: function
    ref: calculateExposure
```

Task contract 不发生变化。

---

# 16. 甚至可以进一步把 Agent 从 DSL 中拿掉

在一个追求最小化的 Workflow DSL 中，我其实更倾向：

```ts
task("analyzeProposal", ...)
```

而不是：

```ts
agentTask("analyzeProposal", ...)
```

因为：

```text
Agent
```

应该是 execution configuration，而不是 Business Workflow primitive。

例如：

```ts
task("analyzeProposal", {
  executor: "proxyResearchAgent"
})
```

或者由平台的 registry 自动绑定：

```text
Task
 ↓
Capability
 ↓
Executor
```

这样未来可以：

```text
Task
 ↓
Agent v1
```

切换成：

```text
Task
 ↓
Agent v2
```

甚至：

```text
Task
 ↓
Human
```

而无需修改 Business Workflow。

---

# 17. 什么时候应该显式建模 Sub-Agent？

这并不意味着 Sub-Agent 不应该成为 Workflow 中可见的东西。

相反，在某些场景它非常值得显式化。

例如：

```text
Research Task
      ↓
Research Sub-Agent
      ↓
Result
```

如果你需要对这个 Sub-Agent 单独管理：

```text
timeout
model
tool permissions
context isolation
budget
telemetry
failure isolation
evaluation
```

那么将它作为一个独立 Execution Unit 非常合理。

AWS 建议 Sub-Agent 在需要独立 reasoning、独立 context/memory、multi-step tool orchestration、不同 model/prompt 或独立 failure isolation 时使用。

所以：

```text
Task ≠ Sub-Agent
```

不等于：

```text
Workflow 不应该知道 Sub-Agent
```

正确的是：

```text
Workflow knows the task.
Execution layer may select a sub-agent.
```

---

# 18. 动态 Workflow 中可以出现 `sub_agent` Task

这里尤其需要说明一个重要反例。

Microsoft 当前的动态 Workflow 文档实际上直接支持：

```json
{
  "id": "analyze_pr",
  "type": "sub_agent",
  "agent": "pr_status_analyst",
  "task": "Review the supplied pull request..."
}
```

并允许：

```text
depends_on
when
for_each
```

等 Workflow-level orchestration。Microsoft 同时明确说明这些 specialist 是 stateless、isolated 的独立执行单元，并由 Workflow Runtime 管理。

这意味着：

> **“Sub-Agent 绝不能作为 Task 的一种执行类型”这个说法是不成立的。**

完全可以存在：

```text
Task
  type = sub_agent
```

但这里的关系应该理解成：

```text
Task
  └── executor type = sub-agent
```

而不是：

```text
Task
  ≡
Sub-Agent
```

这是两种完全不同的架构结论。

---

# 19. 一个非常实用的分类方法

可以给 Workflow Task 做这样的分类：

| Task                      | 典型执行方式        |         是否需要 Agent |
| ------------------------- | ------------- | -----------------: |
| Validate Position         | Code          |                  否 |
| Load ISS Data             | API           |                  否 |
| Calculate Exposure        | SQL / Code    |                  否 |
| Summarize Proposal        | Single LLM    |                不一定 |
| Analyze Governance Issues | Agent         |               可能需要 |
| Deep Research             | Sub-Agent     |               经常需要 |
| Generate Report           | LLM / Agent   |               视复杂度 |
| Submit Vote               | Command / API | 不应由 Agent 自主绕过控制执行 |

这里真正重要的是：

> **从 Task 的性质决定 Executor，而不是从“平台支持 Agent”反过来决定 Task。**

AWS 的最新 Agentic AI guidance 正是这种思路：先判断 capability 是否需要独立 reasoning，再决定是 tool 还是 sub-agent。

---

# 20. Sub-Agent 更像“能力边界”，而 Task 更像“流程边界”

这是一个更适合架构设计的抽象。

```text
Task
= Workflow Boundary
```

意味着：

```text
start
input
execution
output
retry
timeout
audit
completion
```

而：

```text
Sub-Agent
= Reasoning Boundary
```

意味着：

```text
context
instructions
tools
reasoning loop
memory
delegation
model
permissions
```

因此：

```text
                 Workflow
                    │
                  Task
                    │
            ┌───────┴───────┐
            ↓               ↓
      deterministic       Agent
       execution            │
                            ↓
                       Sub-Agent
                            │
                     reasoning loop
```

这比：

```text
Task = Sub-Agent
```

要清晰得多。

---

# 21. 一个金融 Proxy Voting 示例

以 Proxy Voting 为例。

Workflow：

```text
Load Proposal
      ↓
Analyze Proposal
      ↓
Policy Gate
      ↓
Review
      ↓
Submit Vote
```

这里：

```text
Analyze Proposal
```

是 Task。

它可以使用：

```text
Option A:
ISS data + rules

Option B:
single LLM

Option C:
Research Agent

Option D:
Research Sub-Agent
```

但是：

```text
Workflow
```

始终认为它是：

```text
Analyze Proposal
```

而不是：

```text
Run Research Agent #7
```

这样可以保持：

```text
Business Workflow
```

与：

```text
AI implementation
```

解耦。

最终：

```text
Analyze Proposal
      ↓
ProposalAnalysis
      ↓
Policy Gate
      ↓
Review
      ↓
SubmitProxyVote
```

审计记录的核心仍然应该是：

```text
ProposalAnalysis
PolicyResult
Reviewer
Decision
Command
BusinessState
```

而 Agent telemetry 则作为补充：

```text
Model
Prompt/Context reference
Tool calls
Latency
Tokens
Agent execution trace
```

两者不要混成一份“Agent workflow history”。

---

# 22. 一个 Trade Workflow 示例

例如：

```text
Receive Instruction
        ↓
Validate Instruction
        ↓
Analyze Risk
        ↓
Approval Gate
        ↓
Review
        ↓
Approve Trade
        ↓
Execute Trade
```

其中：

```text
Validate Instruction
```

应该是：

```text
Code / API
```

而：

```text
Analyze Risk
```

可以是：

```text
Risk Model
+
LLM explanation
+
Research Agent
```

但是：

```text
Approve Trade
Execute Trade
```

仍然属于明确的：

```text
Review
Command
```

不能因为：

```text
Analyze Risk
```

是 Agent，就让：

```text
Agent
 ↓
ExecuteTrade
```

成为隐式后继。

金融 AI 治理资料一直强调风险、责任和控制仍由金融机构承担。FCA 明确要求 AI 的责任不能被归因给机器；BIS 也要求将 AI 风险纳入既有治理、风险管理和独立 assurance 体系。

---

# 23. Task 的稳定性反而比 Agent 的稳定性更重要

这是一个经常被忽视的设计原则。

Agent 会不断变化：

```text
Model v1
→ Model v2
→ Model v3
```

Prompt 会变化：

```text
Prompt v1
→ Prompt v2
```

Agent Toolset 也会变化：

```text
Tool A
→ Tool A+B+C
```

但是：

```text
Business Task
```

通常变化慢得多：

```text
Analyze Trade
Review Trade
Approve Trade
Execute Trade
```

因此 Workflow DSL 应该稳定在：

```text
Business Work
```

而不是稳定在：

```text
Current Agent Architecture
```

这是企业长期维护 Workflow 的关键原因。

---

# 24. 为什么这对 Workflow DSL 的最小化特别重要

如果：

```text
@task
```

已经意味着：

```text
spawn sub-agent
```

那么为了表达不同执行模式，就很快会出现：

```text
@task
@agent
@subagent
@tool
@human
@workflow
```

甚至：

```text
@parallelAgent
@handoffAgent
@supervisorAgent
```

DSL 会不断吸收 Agent Runtime 的实现细节。

最终：

```text
Workflow DSL
```

变成：

```text
Agent Framework Configuration Language
```

这正好违背了一个企业 Workflow DSL 应有的目标：

> **表达业务流程，而不是表达当前 AI Runtime 的内部结构。**

Anthropic 对 Agent 架构的实践也支持这种“逐步增加复杂度”的思想：先使用简单的 augmented LLM / workflow pattern，需要动态性时再引入 autonomous agents。

---

# 25. 推荐的 DSL

因此，一个比较干净的 DSL 可以保持：

```ts
workflow("proxyVoting", ({ task, gate, review, command }) => {

  const proposal = task("loadProposal")

  const analysis = task("analyzeProposal", {
    executor: "proxyResearchAgent"
  })

  const policy = gate("policyCheck")

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

注意：

```text
task(...)
```

是 Workflow DSL。

而：

```text
executor: "proxyResearchAgent"
```

属于 Execution Configuration。

这样可以清楚区分：

```text
Task
    ↓
Executor
    ↓
Agent
    ↓
Tools
```

---

# 26. 推荐的运行时模型

最终可以采用：

```text
                    Workflow
                       │
                       ↓
                     Task
                       │
               execution contract
                       │
       ┌───────────────┼────────────────┐
       ↓               ↓                ↓
     Code             API              Agent
                                          │
                                          ↓
                                      Sub-Agent
                                          │
                             ┌────────────┼───────────┐
                             ↓            ↓           ↓
                           Tool         Tool       Memory
```

Workflow Engine 管理：

```text
Task State
Retry
Timeout
Dependency
Checkpoint
Business State
Audit
```

Agent Runtime 管理：

```text
Reasoning
Context
Tool selection
Model invocation
Agent loop
Agent-specific state
```

两者通过：

```text
Task Input
Task Output
```

连接。

---

# 27. 这还带来一个重要优势：可以单独测试 Task

如果：

```text
Task = semantic contract
```

那么可以测试：

```text
Task Input
      ↓
Expected Output
```

例如：

```text
AnalyzeProposal
```

测试：

```text
Input:
ISS proposal + portfolio context

Expected:
ProposalAnalysis schema
```

不必把：

```text
具体 Model
具体 Agent
具体 Tool
```

全部固定。

这样就可以分别测试：

```text
Workflow correctness
```

和：

```text
Agent quality
```

Anthropic 当前也强调 Agent evaluation 需要针对 agent 的多步行为、工具调用和最终结果进行专门评估；这些 evaluation concerns 与普通 Workflow correctness 并不是同一个问题。

因此：

```text
Workflow Test
```

和：

```text
Agent Eval
```

应该分开。

---

# 28. 一个很重要的边界：不要让 Agent 成为 Task 的“身份”

错误：

```text
Task ID:
research-agent-01
```

更合理：

```text
Task ID:
analyze-proposal
```

然后：

```text
Execution:
proxy-research-agent-v3
```

这样审计时可以回答两个不同的问题：

> **Workflow 要做什么？**

```text
analyze-proposal
```

> **当时由什么能力完成？**

```text
proxy-research-agent-v3
```

这两个信息都应该保留，但不能合并。

---

# 29. 对金融服务来说，还应该记录 Agent 是“执行者”，不是“责任主体”

例如审计记录：

```yaml
task:
  id: analyze-proposal

executor:
  type: sub-agent
  id: proxy-research-agent-v3

output:
  id: proposal-analysis-1842

workflow:
  version: proxy-voting-7

policy:
  version: proxy-policy-12
```

这里：

```text
executor = Agent
```

但是：

```text
decision owner
authorization owner
business owner
```

仍然来自：

```text
Workflow / Policy / Human / Business System
```

这与 FCA 关于不能把 agency 归因于 AI 的立场是相符的：使用 AI 不应该模糊机构自身的责任。

---

# 30. 最终设计原则

### Principle 1

**`@task` 定义工作，不定义执行技术。**

---

### Principle 2

**Sub-Agent 是 Executor，不是 Task 的同义词。**

---

### Principle 3

**一个 Task 可以由 Code、API、LLM、Agent 或 Sub-Agent 执行。**

---

### Principle 4

**一个 Sub-Agent 可以在内部完成多个 reasoning steps，而不必把这些步骤全部暴露成 Workflow Tasks。**

---

### Principle 5

**Workflow State 与 Agent Runtime State 必须分离。**

---

### Principle 6

**Workflow DSL 应该稳定在 Business Semantics，而不是绑定当前 Agent Architecture。**

---

### Principle 7

**只有在需要独立 reasoning、独立 context、multi-step tool use、不同模型/Prompt 或 failure isolation 时，才值得把一个 capability 提升为 Sub-Agent。**

AWS 对此给出的建议尤其明确，并建议边界不清时先做成 Tool，观察实际调用模式后再升级成 Sub-Agent。

---

### Principle 8

**Sub-Agent 可以在 Workflow 中显式出现，但它应该表现为一种 Execution Type，而不是 Task 的定义。**

Microsoft 当前动态 Workflow 甚至直接支持 `type: "sub_agent"`，这说明“Sub-Agent 作为 Workflow execution unit”完全合理；需要避免的是把两者在语义上做成一一等价。

---

### Principle 9

**Agent 可以增强 Task，但不应该重新定义 Workflow 的 Business Semantics。**

---

### Principle 10

**金融 Workflow 的最终责任边界必须落在业务流程、Policy、授权主体和 Business System，而不是 Agent 本身。**

FCA、BIS 等金融治理资料支持这一责任分离方向，但它们并没有规定某种具体 DSL；这里是基于监管治理原则做出的架构推论，而不是监管条文直接要求使用某种 `Task/Agent` 模型。

---

# 31. 最终模型

可以把整个设计浓缩成：

```text
                     Workflow
                         │
                         ↓
                       Task
                         │
                   "What to do"
                         │
                         ↓
                      Executor
                         │
          ┌──────────────┼───────────────┐
          ↓              ↓               ↓
        Code            API             Agent
                                          │
                                          ↓
                                      Sub-Agent
                                          │
                                  "How to reason"
                                          │
                              ┌───────────┼───────────┐
                              ↓           ↓           ↓
                            Tool        Tool        Context
```

也就是说：

```text
Task
    = Workflow semantic unit

Agent
    = Reasoning capability

Sub-Agent
    = Delegated reasoning runtime

Executor
    = Mechanism that performs the Task
```

因此：

> **`@task` 不应该等同于 Sub-Agent。**
>
> 一个 Task 应该回答：
>
> **“Workflow 在这里要完成什么工作？”**
>
> 而 Sub-Agent 应该回答：
>
> **“完成这项工作时，是否需要一个拥有独立 context、tools 和 reasoning loop 的智能执行体？”**
>
> 前者属于 Workflow DSL，后者属于 Agent Runtime。
>
> 一旦这两个概念被分开，Workflow 就可以保持稳定而确定，Agent 可以持续演进；而在金融服务场景中，也可以同时保留清晰的业务责任、Policy、授权和审计边界。
>
> **最重要的不是“Workflow 要不要用 Agent”，而是不要让 Workflow 的业务语义依赖于“当前这一步是不是 Agent”。**

## 参考资料

**[1] Anthropic — Building effective agents**

Anthropic 将 Workflow 与 Agent 明确定义为两种不同架构：Workflow 通过预定义代码路径协调 LLM/Tools；Agent 则由 LLM 动态决定过程和工具使用。同时建议只在确实需要动态性的情况下引入 Agent。
[Anthropic — Building effective agents](https://www.anthropic.com/engineering/building-effective-agents?utm_source=chatgpt.com)

**[2] Anthropic — How we built our multi-agent research system**

Anthropic 的 Research 系统采用 orchestrator-worker：lead agent 创建 specialized subagents 并行完成研究任务，是 Sub-Agent 作为独立 reasoning unit 的典型实践。
[Anthropic — How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system?utm_source=chatgpt.com)

**[3] Anthropic — Effective context engineering for AI agents**

讨论 Sub-Agent 的 context isolation、独立上下文窗口以及将大量内部工作压缩成结果返回给上层 Agent。
[Anthropic — Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents?utm_source=chatgpt.com)

**[4] AWS Well-Architected Agentic AI Lens — Multi-agent collaboration**

AWS 明确建议先判断 capability 应该是 Tool 还是 Sub-Agent：确定性、单步、快速能力优先使用 Tool；需要独立 reasoning、独立 context、多步工具编排或独立 failure isolation 时再使用 Sub-Agent。
[AWS — Implement optimized multi-agent collaboration models](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentperf05-bp02.html?utm_source=chatgpt.com)

**[5] AWS Well-Architected Agentic AI Lens — Workflow orchestration**

AWS 将 dynamic workflows、deterministic workflow skeleton 和 hybrid orchestration 区分开，并强调 orchestration 应与任务结构相匹配。
[AWS — Workflow orchestration and multi-agent collaboration](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentperf05.html?utm_source=chatgpt.com)

**[6] OpenAI Agents SDK — Agents and orchestration**

OpenAI SDK 将 Agent、Agents-as-tools、Handoffs 作为独立组合 primitive。尤其明确区分“bounded subtask assistance”和“control handoff”。
[OpenAI — Agents SDK: Agents](https://openai.github.io/openai-agents-js/guides/agents/?utm_source=chatgpt.com)
[OpenAI — Agents SDK: Agent orchestration](https://openai.github.io/openai-agents-python/multi_agent/?utm_source=chatgpt.com)

**[7] Microsoft Agent Framework — Workflows**

Microsoft Agent Framework 将 Workflow 建模成 Executors + Edges 的有向图，并明确指出 Executor 可以是 AI Agent，也可以是 custom logic。
[Microsoft — Agent Framework Workflows](https://learn.microsoft.com/en-us/agent-framework/workflows/workflows?utm_source=chatgpt.com)
[Microsoft — Exploring Microsoft Agent Framework Workflows](https://microsoft.github.io/ai-agents-for-beginners/14-microsoft-agent-framework/?utm_source=chatgpt.com)

**[8] Microsoft — Dynamic workflows and sub-agents**

微软的动态 Workflow 明确支持 `type: "sub_agent"`，并把 specialist agent 作为受 Workflow Runtime 管理的独立执行单元，说明 Sub-Agent 可以是 Workflow 的一种执行类型，但这并不意味着 Task 在语义上等同于 Sub-Agent。
[Microsoft — Dynamic workflows in Azure Functions hosted skills](https://learn.microsoft.com/en-us/azure/azure-functions/functions-hosted-skills-dynamic-workflows?utm_source=chatgpt.com)

**[9] Microsoft — Orchestrator and subagent pattern**

微软将 orchestrator 与 specialist subagents 分开：orchestrator 负责整体决策，subagents 负责特定执行领域。
[Microsoft — Orchestrator and subagent multi-agent patterns](https://learn.microsoft.com/en-us/agents/architecture/multi-agent-orchestrator-sub-agent?utm_source=chatgpt.com)

**[10] FCA — AI: Moving from fear to trust**

FCA 明确提出不能把 agency 归因于 AI systems，否则可能把 accountability 从企业和责任主体转移出去；AI governance 最终责任仍在 firm。
[FCA — AI: Moving from fear to trust](https://www.fca.org.uk/news/speeches/ai-moving-fear-trust?utm_source=chatgpt.com)

**[11] BIS — Governance of AI adoption in central banks**

BIS 2025 年报告建议把 AI 风险纳入现有风险管理体系，并利用 three lines of defence 模型明确不同角色的风险责任、监督与独立 assurance。
[BIS — Governance of AI adoption in central banks](https://www.bis.org/publications/governance-ai-adoption-central-banks?utm_source=chatgpt.com)

**[12] BIS — Corporate governance / three lines of defence**

Basel 框架强调 business line 对风险拥有 ownership，risk/compliance 负责 independent challenge and oversight，internal audit 提供独立 assurance。
[BIS — Corporate governance](https://www.bis.org/committees/bcbs/basel-consolidated-guidelines/module/cgo/10.htm?utm_source=chatgpt.com)

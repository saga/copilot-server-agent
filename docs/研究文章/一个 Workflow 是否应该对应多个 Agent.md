# 一个 Workflow 是否应该对应多个 Agent

> 一个 Workflow 不应该预设“必须一个 Agent”或者“必须多个 Agent”。
>
> 更合理的设计是：**Workflow 定义业务过程，Agent 只是 Workflow 中某些工作单元的执行者。**
>
> 因此，一个 Workflow 可以没有 Agent、只有一个 Agent，也可以包含多个不同 Agent。真正应该判断的不是 Agent 数量，而是：**哪些步骤需要独立的推理边界、专业能力、上下文、权限或并行执行。**
>
> 对金融服务而言，这个区别尤其重要。多 Agent 可以带来专业化、隔离和并行能力，但同时也会增加身份管理、协调、失败传播、审计和权限治理成本。AWS 当前 Agentic AI Lens 明确指出，多 Agent 系统会引入 coordination overhead、handoff complexity 和 distributed failure modes；而金融服务场景又要求明确的角色、权限、审批和审计边界。

## 1. 不要先问“几个 Agent”，先问“这个 Workflow 有哪些工作单元”

假设有一个投资研究 Workflow：

```text
Create Investment Idea
        ↓
Collect Data
        ↓
Financial Analysis
        ↓
ESG Analysis
        ↓
Risk Review
        ↓
Investment Committee Review
        ↓
Publish
```

一个很自然的想法是：

```text
Collect Data       → Agent A
Financial Analysis → Agent B
ESG Analysis       → Agent C
Risk Review        → Agent D
Review             → Agent E
```

于是得到：

```text
Workflow = Agent A + B + C + D + E
```

但这实际上把两个不同层次的问题混在了一起。

Workflow 真正定义的是：

```text
What must happen
```

而 Agent 定义的是：

```text
Who / what performs a reasoning-heavy step
```

Microsoft 当前 Agent Framework 的 Workflow 模型正是这样设计的：Workflow 是由 executors 和 edges 组成的有向图，executor 可以执行普通逻辑，也可以调用 AI Agent；官方还直接支持把一个复杂 Workflow 包装成 Agent。

因此：

```text
Workflow
   │
   ├── Task → Code
   ├── Task → API
   ├── Task → Agent A
   ├── Task → Agent B
   ├── Review → Human
   └── Command → Business API
```

比：

```text
Workflow
   ↓
N 个 Agent
```

更准确。

---

## 2. 一个 Workflow 可以没有 Agent

这是最容易被 Agent 平台忽略的一种情况。

例如：

```text
Trade Settlement Workflow

Receive Instruction
        ↓
Validate Fields
        ↓
Check Entitlement
        ↓
Calculate Settlement Amount
        ↓
Send Settlement Instruction
        ↓
Reconcile
```

如果每一步都是确定性的：

```text
Code
API
SQL
Rule Engine
```

那么这个 Workflow 完全可以：

```text
Agent count = 0
```

这不是“非 Agent 架构”，而是一个非常正常的 Workflow。

AWS 当前 Agentic AI Lens 也强调，Agentic 系统应该根据任务形态选择 orchestration：确定性的 workflow skeleton 可以由 Step Functions 等机制承担，只有需要动态 reasoning 的部分才需要 Agent。

所以：

> **Workflow 是业务过程；Agent 是可选执行能力。**

这应该成为平台的基本原则。

---

## 3. 一个 Workflow 可以只有一个 Agent

例如：

```text
Investment Research Workflow
        ↓
Research Task
        ↓
Single Research Agent
        ↓
Result
        ↓
Risk Gate
        ↓
Review
        ↓
Publish
```

Agent 负责：

```text
Search
Read
Compare
Reason
Synthesize
```

Workflow 负责：

```text
什么时候开始
什么时候结束
是否需要 Risk Gate
是否必须 Review
什么条件允许 Publish
```

这是一种非常合理的结构。

甚至 Agent 内部可以拥有自己的动态工作流：

```text
Research Agent
   ├── Search
   ├── Search
   ├── Read
   ├── Compare
   ├── Ask another tool
   └── Synthesize
```

这些步骤不一定都需要成为 Enterprise Workflow 的显式节点。

Anthropic 的 Research 系统就是一个典型例子：一个 lead agent 可以根据问题创建多个 subagents，但这种动态研究过程属于 Agent Runtime，而不是固定的业务流程。

---

## 4. 一个 Workflow 也可以有多个 Agent

当 Workflow 中存在真正独立的专业工作时，多 Agent 就开始有意义。

例如：

```text
Investment Research
        │
        ├── Financial Analyst Agent
        │
        ├── ESG Analyst Agent
        │
        └── Market Research Agent
                 │
                 ↓
            Aggregation
                 │
                 ↓
             Risk Gate
```

这里至少有三个理由：

### 专业能力不同

Financial Analysis 和 ESG Research 使用的：

```text
knowledge
tools
prompts
evaluation
```

可能完全不同。

### 可以并行

如果三项研究互不依赖：

```text
             ┌── Financial
             │
Start ───────┼── ESG
             │
             └── Market
                    ↓
                Aggregate
```

并行可以缩短关键路径。

AWS 当前 Agentic AI Lens 明确把 parallel execution、task decomposition 和 orchestrator-worker 作为多 Agent Workflow 的重要优化方式。

### 可以形成不同的权限边界

例如：

```text
Financial Agent
→ market data

KYC Agent
→ client documents

Risk Agent
→ risk systems
```

不一定需要让所有 Agent 拥有相同权限。

AWS 的 Agentic AI guidance 要求每个 Agent 使用最小必要权限，并建议对 Agent 身份、权限和 Agent-to-Agent 通信进行明确管理。

---

## 5. 但“一个 Task 一个 Agent”通常不是好设计

这是多 Agent 架构最容易出现的过度拆分。

例如：

```text
Load Document
       ↓
Agent 1

Extract Data
       ↓
Agent 2

Validate Data
       ↓
Agent 3

Summarize
       ↓
Agent 4

Format Output
       ↓
Agent 5
```

看上去很模块化，实际上可能只是把：

```text
一个可以由单 Agent 或普通代码完成的工作
```

拆成了：

```text
5 个 LLM execution units
```

于是增加：

```text
latency
token cost
handoff complexity
failure points
state transfer
observability complexity
```

AWS 明确提醒，多 Agent 架构会增加 coordination overhead、handoff complexity 和 distributed failure modes；AWS 还建议默认把能力作为 Tool，而不是 Sub-Agent，只有真正需要 independent reasoning 时才升级。

Anthropic 的多 Agent Research 经验也说明了同样的问题：多 Agent 对高度并行、开放式研究问题有效，但其系统的 token 消耗显著高于普通对话，而且任务如果高度依赖共享上下文或存在大量依赖关系，就不一定适合多 Agent。

因此：

> **不要因为 Workflow 有五个 Task，就创建五个 Agent。**

应该逐个判断：

```text
这个 Task 是否需要独立 reasoning？
是否需要独立 context？
是否需要不同 tools？
是否需要独立权限？
是否可以并行？
是否需要独立 failure isolation？
```

只有这些条件真正存在时，Agent 边界才有意义。

---

## 6. 多 Agent 的真正价值不是“拆得更细”，而是“形成独立边界”

一个好的 Agent 边界通常至少满足其中一种：

```text
Independent reasoning
Independent expertise
Independent context
Independent toolset
Independent permissions
Independent lifecycle
Independent failure boundary
```

例如：

```text
KYC Review Agent
```

可能：

```text
独立知识
+
独立工具
+
独立数据权限
+
独立评估
```

这就有很强的边界价值。

但：

```text
Format Report Agent
```

如果只是：

```text
Input JSON
→ LLM
→ Markdown
```

很可能根本不值得独立成为 Agent。

AWS 将 Sub-Agent 与 Tool 的区别也放在 independent reasoning、独立 context、multi-step tool orchestration 和 failure isolation 上，而不是“功能多少”。

---

## 7. 一个 Workflow 可以让多个 Agent 并行，但不代表它们互相协调

例如：

```text
                Start
                  │
        ┌─────────┼─────────┐
        ↓         ↓         ↓
     Finance     ESG      Market
      Agent      Agent      Agent
        │         │         │
        └─────────┼─────────┘
                  ↓
             Aggregator
                  ↓
                Gate
```

这其实是相对简单的结构：

```text
Workflow
  controls fan-out/fan-in

Agents
  perform specialized work
```

Agent 之间不需要彼此聊天。

这种方式通常比：

```text
Agent A
  ↕
Agent B
  ↕
Agent C
  ↕
Agent D
```

更容易控制。

AWS 当前建议在多 Agent 场景中，根据任务结构选择 supervisor-worker、pipeline、peer-to-peer 等模式，并特别强调协调开销、冲突处理和失败恢复。

---

## 8. Agent-to-Agent 协作也可以存在，但不要默认采用

OpenAI 当前 Agents SDK 明确支持两种主要多 Agent 模式：

```text
Agents as tools
Handoffs
```

`Agents as tools` 中，manager agent 保留控制权，让 specialist 完成 bounded subtask；handoff 则把后续控制权交给 specialist。OpenAI 明确建议根据“谁应该拥有控制权”来选择两者。

这对 Workflow 很有启发：

```text
Workflow
   │
   ├── Agent A
   │      └── Agent B as bounded capability
   │
   ├── Agent C
   │
   └── Review
```

不需要把：

```text
Workflow
```

直接变成：

```text
Agent A ↔ Agent B ↔ Agent C
```

否则 Workflow Engine 很难再知道：

```text
现在谁负责？
谁拥有控制权？
失败应该回到哪里？
哪个 Agent 可以决定下一步？
```

因此多 Agent 不等于 Agent-to-Agent chat。

---

## 9. Workflow 本身也可以被封装成 Agent

这个反例非常重要。

Microsoft Agent Framework 当前支持：

```text
Workflow
    ↓
as_agent()
    ↓
Agent
```

一个复杂 Workflow 可以暴露成标准 Agent 接口，然后被其他 Agent 或系统调用。

例如：

```text
InvestmentResearchWorkflow
        ↓
InvestmentResearchAgent
```

从外部看：

```text
Main Agent
     ↓
Investment Research Agent
```

但内部实际上是：

```text
Workflow
 ├── Data Collection
 ├── Financial Agent
 ├── ESG Agent
 ├── Risk Analysis
 ├── Review
 └── Report
```

因此不要建立：

> Workflow 和 Agent 只能一对一或一对多。

更准确的是：

```text
Workflow ↔ Agent
```

可以存在**多种组合关系**。

---

## 10. 更合理的是三个维度，而不是一个数量

不要用：

```text
Workflow → N Agents
```

来描述架构。

最好拆成三个维度：

### Workflow

```text
Business Process
```

### Executor

```text
谁来执行这个步骤
```

### Agent

```text
哪些 Executor 需要 autonomous reasoning
```

于是：

```text
Workflow
│
├── Task A
│     └── Code Executor
│
├── Task B
│     └── Agent A
│
├── Task C
│     └── Agent B
│
├── Review
│     └── Human
│
└── Command
      └── Business API
```

这样：

```text
Workflow ≠ Agent
```

也就自然意味着：

```text
Workflow ≠ Agent Count
```

---

## 11. 金融服务中，多 Agent 的价值首先是边界，而不是“更聪明”

例如 KYC Workflow：

```text
KYC Case
    ↓
Document Collection
    ↓
Identity Review
    ↓
Sanctions Screening
    ↓
Risk Assessment
    ↓
Compliance Review
    ↓
Decision
```

可以设计：

```text
Identity Agent
Sanctions Agent
Risk Agent
```

但这些 Agent 不应该因此拥有相同的：

```text
data access
tools
permissions
decision authority
```

一个更合理的结构是：

```text
                 KYC Workflow
                      │
         ┌────────────┼────────────┐
         ↓            ↓            ↓
    Identity Agent  Sanctions    Risk Agent
         │            │            │
    Client Docs     Screening      Risk Data
         │            │            │
         └────────────┼────────────┘
                      ↓
                Compliance Review
                      ↓
                    Decision
```

这里多 Agent 的意义是：

```text
specialization
+
permission isolation
+
independent evaluation
```

而不是：

```text
每一步都必须用一个 Agent
```

AWS Financial Services Industry Lens 强调 Three Lines of Defense、明确职责、AI 模型治理、访问控制、审计以及关键业务流程的 Human-in-the-loop；这些要求使“不同 Agent 是否拥有不同权限和责任边界”成为比 Agent 数量更重要的问题。

---

## 12. 金融 Workflow 中尤其不要让多个 Agent 自己决定 Business Control Flow

例如：

```text
Risk Agent
   ↓
"I think legal review is unnecessary."
```

不能直接导致：

```text
Skip Legal Review
```

因为：

```text
Agent Recommendation
```

和：

```text
Workflow Transition
```

不是同一回事。

更合理：

```text
Risk Agent
   ↓
Risk Assessment
   ↓
Deterministic Gate
   ↓
Legal Review?
```

AWS Agentic AI Lens 对高风险决策明确建议使用 deterministic risk classification / policy 作为权威信号，LLM 可以作为辅助输入；高风险操作需要适当的 Human-in-the-loop。

所以：

> **多个 Agent 可以贡献判断，但 Business Workflow 的控制边界不能因为多个 Agent 存在就变成“Agent 投票决定下一步”。**

---

## 13. 多 Agent 还会带来身份与权限成本

一个 Agent：

```text
Agent
  ↓
Tools
```

已经需要：

```text
identity
authorization
logging
monitoring
```

如果增加到：

```text
Agent A
Agent B
Agent C
Agent D
```

那么还会增加：

```text
Agent-to-Agent authentication
Agent-specific permissions
Delegation boundaries
Identity propagation
Audit attribution
Fallback
```

AWS 当前 Agentic AI Lens 明确要求每个 Agent-to-Agent 和 Agent-to-Service communication 使用可验证身份，并强调 Agent 应采用最小权限、短期凭证和独立 service identity。

因此：

> **多 Agent 是治理成本的增加，不只是能力的增加。**

在金融服务中尤其如此。

---

## 14. Multi-Agent 还会增加失败模式

单 Agent：

```text
A
 ↓
B
 ↓
C
```

已经可能因为：

```text
A failure
B hallucination
tool error
```

导致整个流程异常。

多 Agent：

```text
       A
      / \
     B   C
      \ /
       D
```

还会出现：

```text
B timeout
C inconsistent
B/C disagree
D cannot reconcile
handoff loses context
partial result
duplicate work
```

AWS 当前明确把 multi-agent 的 distributed failure modes、conflict resolution、fallback chain 和 control-plane reliability 当作专门的架构问题。

因此：

```text
More Agents
≠
More Reliability
```

很多时候恰恰相反。

---

## 15. Anthropic 的实践很好地说明了“什么时候值得多个 Agent”

Anthropic 的多 Agent Research 系统之所以使用多个 Agent，并不是因为“Research Workflow 应该多 Agent”。

而是因为 Research 具有几个特殊特征：

```text
open-ended
breadth-first
highly parallelizable
large information space
different exploration trajectories
```

Anthropic 介绍其 Research 系统时明确指出，多 Agent 特别适合可以并行探索多个方向、上下文容量不足以容纳全部工作、工具复杂的任务；同时也明确指出多 Agent 会产生很高的 token 成本，并不适合高度依赖共享上下文或存在大量依赖的任务。

这给出一个很实用的判断方法：

> **如果把一个 Agent 拆成多个 Agent 后，没有获得真正的并行、隔离、专业化或自主推理收益，就很可能只是增加复杂度。**

---

## 16. 一个非常实用的决策表

| 问题                            | 建议                                  |
| ----------------------------- | ----------------------------------- |
| 任务是确定性的？                      | Code / API / Rule                   |
| 任务只需要简单 LLM 调用？               | Single LLM / Agent                  |
| 一个 Agent 就能完成？                | 不要拆                                 |
| 需要不同专业知识？                     | 考虑多个 Agent                          |
| 可以独立并行？                       | 强烈考虑多个 Agent                        |
| 需要不同数据权限？                     | 考虑独立 Agent identity                 |
| 需要独立 context？                 | 考虑 Sub-Agent                        |
| 需要独立 failure isolation？       | 考虑 Sub-Agent                        |
| Agent 之间高度依赖共享上下文？            | 谨慎拆分                                |
| 只是为了“架构看起来更 Agentic”？         | 不要拆                                 |
| 只是把一个函数拆成一个 Agent？            | 通常不要                                |
| 只是为了增加 prompt specialization？ | 先考虑 Skill / Tool                    |
| 涉及审批、授权、资金、交易？                | Workflow / Policy 控制，不交给 Agent 自主决定 |

---

## 17. 推荐的企业 Agent Workflow 模型

对于企业，尤其是金融服务平台，更推荐：

```text
                    Workflow
                        │
          ┌─────────────┼─────────────┐
          ↓             ↓             ↓
        Task           Gate         Review
          │
     ┌────┴─────────────┐
     ↓                  ↓
   Code                Agent
                         │
                  ┌──────┼──────┐
                  ↓      ↓      ↓
                Skill  Tool  Sub-Agent
```

然后：

```text
Command
   ↓
Policy
   ↓
Authorization
   ↓
Business System
```

这个架构中：

```text
Workflow
```

不关心：

```text
到底 1 个 Agent 还是 5 个 Agent
```

它只关心：

```text
Task contract
input
output
dependency
control
state
```

Agent Runtime 再决定：

```text
single agent
multi-agent
tool
skill
sub-agent
```

这样 Workflow 可以保持稳定，而 Agent 架构可以快速演进。

---

## 18. 一个 Workflow 最好不要硬编码 Agent 数量

不建议：

```yaml
workflow:
  agents:
    - finance-agent
    - esg-agent
    - risk-agent
```

然后让 Workflow 本身拥有：

```text
Agent topology
```

更好的方式：

```yaml
workflow:
  tasks:
    - id: financial-analysis
      executor: financial-analysis-capability

    - id: esg-analysis
      executor: esg-analysis-capability

    - id: risk-analysis
      executor: risk-analysis-capability
```

然后 Capability Registry 决定：

```text
financial-analysis-capability
    → Agent v3

esg-analysis-capability
    → Agent v2

risk-analysis-capability
    → Rule Engine + LLM
```

甚至：

```text
financial-analysis-capability
    → Agent v3
    → fallback Agent v2
```

AWS 当前多 Agent orchestration guidance 本身也强调 capability-based routing、fallback chain 和松耦合 control plane，而不是让 Workflow 绑定具体 Agent 身份。

---

## 19. 这会带来一个很重要的结果：Agent 可以替换

例如：

```text
Workflow v12
```

始终保持：

```text
Financial Analysis
```

但执行能力可以变化：

```text
2026:
FinancialAgent v1

2027:
FinancialAgent v2

2028:
FinancialAnalysisService
```

Workflow 不需要修改。

甚至：

```text
Financial Analysis
```

可以从：

```text
Agent
```

退回：

```text
Deterministic service
```

也可以从：

```text
Single Agent
```

升级成：

```text
Multi-Agent Research
```

而 Business Workflow 不变。

这正是把 Agent 当作 Executor，而不是 Workflow primitive 的价值。

---

## 20. 反过来，一个 Agent 也可以服务多个 Workflow

例如：

```text
                 Financial Analysis Agent
                    /       |       \
                   /        |        \
                  ↓         ↓         ↓
        Investment   Due Diligence   Portfolio
         Workflow       Workflow      Review
```

这是非常正常的。

因为：

```text
Agent
```

代表：

```text
capability
```

而：

```text
Workflow
```

代表：

```text
business context
```

同一个 Financial Analysis Agent 可以在不同 Workflow 中接收不同：

```text
context
input schema
policy context
output contract
```

因此关系实际上可能是：

```text
Workflow A ──┐
             ├── Agent X
Workflow B ──┘

Workflow A ── Agent Y

Workflow C ──┐
             ├── Agent Z
             └── Agent X
```

这是一个 many-to-many 的组合关系。

---

## 21. 最理想的不是“一 Workflow 对多个 Agent”，而是“一 Workflow 对多个 Executor”

这是最值得保留的架构结论。

把问题改写成：

> 一个 Workflow 是否应该对应多个 Agent？

不如问：

> 一个 Workflow 应该由哪些 Executor 完成？

答案可能是：

```text
Code
API
Rule
Human
LLM
Agent
Sub-Agent
Command
```

于是：

```text
Workflow
   │
   ├── Task → Code
   ├── Task → Agent
   ├── Task → API
   ├── Gate → Policy Engine
   ├── Review → Human
   └── Command → Domain API
```

Agent 只是其中一种 Executor。

Microsoft Agent Framework 当前正是这种模型：Workflow 可以由多个 executors 构成，Executor 可以是 Agent，也可以是自定义逻辑，并支持 sequential、concurrent、handoff、group-chat、Magentic 等多种 Agent orchestration。

---

## 22. 金融服务中的推荐边界

对于金融 Workflow，我会采用下面这个原则：

```text
Workflow
    = authoritative business process

Agent
    = bounded reasoning executor

Policy
    = authoritative control

Human
    = accountable decision maker where required

Command
    = authorized business state transition
```

于是：

```text
                     Workflow
                         │
       ┌─────────────────┼──────────────────┐
       ↓                 ↓                  ↓
      Task              Gate              Review
       │                 │                  │
       ↓                 ↓                  ↓
     Agent             Policy             Human
       │
   ┌───┼────┐
   ↓   ↓    ↓
 Skill Tool Sub-Agent
```

最后：

```text
Review
   ↓
Authorization
   ↓
Command
   ↓
Business State
```

金融服务中的多 Agent，首先应该解决：

```text
specialization
parallelism
permission isolation
context isolation
failure isolation
```

而不是：

```text
让所有步骤都变成 Agent
```

AWS Financial Services Industry Lens 当前明确强调 Agent governance、权限边界、Agent lifecycle、incident response、human oversight，以及高风险业务流程中的审计与责任。

---

## 23. 最终设计原则

### Principle 1

**Workflow 不应该绑定一个固定的 Agent 数量。**

---

### Principle 2

**一个 Workflow 可以有 0、1 或多个 Agent。**

数量由 Task 的执行需求决定，而不是由 Workflow 类型决定。

---

### Principle 3

**Workflow 应该依赖 Task / Executor Contract，而不是直接依赖具体 Agent 身份。**

---

### Principle 4

**只有当存在独立 reasoning、专业化、并行、context isolation、permission isolation 或 failure isolation 时，才值得增加 Agent 边界。**

---

### Principle 5

**不要为了“Agent 化”而把普通 Code、API、Rule 或简单 LLM Call 包装成 Agent。**

---

### Principle 6

**多 Agent 的收益必须能抵消 coordination、latency、token、identity、audit 和 failure complexity。**

AWS 与 Anthropic 的公开实践都说明，多 Agent 的价值高度依赖任务形态，而不是一种普遍优于单 Agent 的模式。

---

### Principle 7

**Workflow 控制 Business Process；Agent 控制自己的 bounded reasoning。**

---

### Principle 8

**高风险业务控制不能因为采用多个 Agent 就转化成 Agent-to-Agent 协商。**

Authorization、Entitlement、Approval Requirement 和 Command execution 仍应由确定性的控制层约束。

---

### Principle 9

**一个 Agent 可以参与多个 Workflow；一个 Workflow 也可以调用多个 Agent。**

因此不要把 Workflow 与 Agent 建模成一对一关系。

---

### Principle 10

**真正值得建模的是 Workflow → Executor，而不是 Workflow → Agent Count。**

---

# 结论

“一个 Workflow 是否应该对应多个 Agent”其实不是一个数量问题。

真正应该问的是：

> **这个 Workflow 中，有哪些工作真的需要 Agent？哪些需要多个独立 Agent？为什么这些 Agent 必须彼此独立？**

因此，一个成熟的企业 Agent Platform 不应该从：

```text
Workflow
   ↓
Multiple Agents
```

开始设计。

应该从：

```text
Workflow
   ↓
Task / Gate / Review / Command
   ↓
Executor
   ├── Code
   ├── API
   ├── Rule
   ├── Human
   └── Agent
             ├── Skill
             ├── Tool
             └── Sub-Agent
```

开始。

这样，一个 Workflow 可以自然地：

```text
没有 Agent
```

也可以：

```text
只有一个 Agent
```

也可以：

```text
多个专业 Agent 并行
```

甚至可以：

```text
Workflow 本身被包装成一个 Agent
```

这些都不是矛盾，而是不同层次的组合方式。Microsoft 当前 Agent Framework 甚至同时支持“Agents in Workflows”和“Workflows as Agents”，正说明两者并不是一对一的概念关系。

对于金融服务，最终最重要的也不是 Agent 数量，而是**控制边界**：

```text
Agent 可以推理
Workflow 决定流程
Policy 决定允许什么
Human 在必要处承担决定责任
Command 才真正改变业务状态
```

这比“一个 Workflow 配几个 Agent”更值得成为企业 Agent 架构的基本原则。

## 参考资料

**[1] AWS — Agentic AI Lens**
AWS 2026 年 Agentic AI Lens，覆盖 multi-agent orchestration、bounded autonomy、可观测性、失败恢复与人类监督。

[AWS Well-Architected Agentic AI Lens](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentic-ai-lens.html?utm_source=chatgpt.com)

**[2] AWS — Workflow orchestration and multi-agent collaboration**
讨论 static / dynamic / hybrid workflow、supervisor-worker、parallelism，以及何时采用 Sub-Agent。

[AWS — Workflow orchestration and multi-agent collaboration](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentperf05.html?utm_source=chatgpt.com)

**[3] AWS — Multi-agent orchestration**
讨论 capability-based routing、fallback chain、冲突解决、控制平面和分布式失败。

[AWS — Multi-agent orchestration](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentrel04.html?utm_source=chatgpt.com)

**[4] AWS — Human-in-the-loop for critical decisions**
讨论风险分级审批、deterministic policy、金融交易等高风险操作的人类监督。

[AWS — Human-in-the-loop for critical decisions](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentsec04-bp02.html?utm_source=chatgpt.com)

**[5] AWS — Agent identity and permission management**
讨论 Agent identity、Agent-to-Agent authentication、least privilege 和审计归因。

[AWS — Agent identity and permission management](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentsec03.html?utm_source=chatgpt.com)

**[6] AWS Financial Services Industry Lens — Risk management roles**
金融服务行业中的 Three Lines of Defense、AI governance、模型管理、关键流程 Human-in-the-loop。

[AWS — Financial Services Industry Lens: Risk management roles](https://docs.aws.amazon.com/wellarchitected/latest/financial-services-industry-lens/fsiops01.html?utm_source=chatgpt.com)

**[7] AWS Financial Services Industry Lens — Separation of duties**
金融服务中的职责分离、权限控制和 AI 系统变更审批。

[AWS — Financial Services Industry Lens: Separation of duties](https://docs.aws.amazon.com/wellarchitected/latest/financial-services-industry-lens/fsisec04.html?utm_source=chatgpt.com)

**[8] Microsoft Agent Framework — Workflows**
Workflow 由 executors 和 edges 构成；支持 checkpoints、HITL、multi-agent orchestration 和 workflow-as-agent。

[Microsoft Agent Framework — Workflows](https://learn.microsoft.com/en-us/agent-framework/workflows/?utm_source=chatgpt.com)

**[9] Microsoft Agent Framework — Workflows as Agents**
展示复杂 Workflow 可以包装成标准 Agent 接口，并被其他 Agent 或 Workflow 使用。

[Microsoft — Workflows as Agents](https://learn.microsoft.com/en-us/agent-framework/workflows/as-agents?utm_source=chatgpt.com)

**[10] OpenAI Agents SDK — Agent orchestration**
讨论 agents-as-tools、handoffs，以及 LLM orchestration 与 code orchestration 的区别。

[OpenAI Agents SDK — Agent orchestration](https://openai.github.io/openai-agents-python/multi_agent/?utm_source=chatgpt.com)

**[11] Anthropic — How we built our multi-agent research system**
Anthropic 对生产级多 Agent Research 系统的架构、并行研究、Sub-Agent、协调成本和适用任务的经验总结。

[Anthropic — How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system?utm_source=chatgpt.com)

**[12] Anthropic — Agents for financial services**
2026 年金融服务 Agent 模板，把 Skills、Connectors、Subagents 与企业自身的 risk policies、approval flows 组合起来。

[Anthropic — Agents for financial services](https://www.anthropic.com/news/finance-agents?utm_source=chatgpt.com)

**[13] FINRA — GenAI: Continuing and Emerging Trends, 2026**
说明金融机构使用 GenAI 后，supervision、recordkeeping、fair dealing 等既有义务仍然适用。

[FINRA — GenAI: Continuing and Emerging Trends](https://www.finra.org/rules-guidance/guidance/reports/2026-finra-annual-regulatory-oversight-report/gen-ai?utm_source=chatgpt.com)

**[14] FCA — AI in financial services: shaping our approach through industry engagement**
FCA 2026 年关于金融服务 AI 的治理观点，强调现有 governance、SM&CR、Consumer Duty 等框架继续适用。

[FCA — AI in financial services](https://www.fca.org.uk/news/blogs/ai-financial-services-approach?utm_source=chatgpt.com)

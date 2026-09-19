# 金融业务中的 Agent Control Plane 与 Agent Runtime 分离设计

## 1. 引言

随着 AI Agent 从聊天助手进入真实金融业务，系统很容易逐渐变成：

```text id="1n8v3a"
User
  ↓
Agent
  ↓
LLM
  ↓
Tools
  ↓
Business Systems
```

最初这样做非常简单。

但一旦 Agent 进入：

* 投资研究；
* 合规审查；
* 客户服务；
* 投资决策支持；
* Trade Operations；
* Proxy Voting；
* Client Onboarding；
* Risk Investigation；
* Regulatory Reporting；

系统马上会出现一组新的企业级问题：

```text id="x1e7yx"
谁可以运行这个 Agent？

Agent 可以访问什么？

Agent 可以调用什么 Tool？

当前 Workflow 在哪一步？

这个 Node 是否允许调用这个 Tool？

这个数据是否属于当前用户/业务范围？

是否需要 Human Approval？

Command 是否被授权？

如果 Agent 出错，如何停止？

如果 Runtime 重启，如何恢复？

如果模型换了，旧 Execution 怎么办？

谁能修改 Agent / Skill / Workflow / Policy？

这些行为如何审计？
```

这些问题实际上并不属于 LLM 本身。

它们属于：

> **Agent Control Plane。**

而：

```text
LLM
Agent loop
Planning
Tool selection
Memory
Reasoning
```

更适合属于：

> **Agent Runtime。**

因此，一个成熟的金融 Agent 平台应该从：

```text id="wca47g"
Agent
```

演进到：

```text id="3a6g7n"
            ┌─────────────────────────────┐
            │     Agent Control Plane     │
            │                             │
            │ Identity                    │
            │ Workflow                    │
            │ Policy                      │
            │ Capability                  │
            │ HITL                        │
            │ Command                     │
            │ Audit                       │
            │ Registry                    │
            │ Governance                  │
            └──────────────┬──────────────┘
                           │
                    Runtime Contract
                           │
            ┌──────────────┴──────────────┐
            │        Agent Runtime        │
            │                             │
            │ LLM                         │
            │ Planning                    │
            │ Memory                      │
            │ Tool Use                    │
            │ RAG                         │
            │ Reflection                  │
            │ Sub-agents                  │
            └─────────────────────────────┘
```

核心原则：

> **Control Plane 决定 Agent “可以做什么、什么时候做、为什么允许”；Runtime 决定 Agent “具体怎么完成工作”。**

AWS 2026 年 Agentic AI Lens 已将 Agent Identity、Tool Authorization、Workflow Orchestration Security、Human Oversight、Agent Observability、Multi-Agent Security 等作为独立控制能力，并明确要求将 orchestration layer 作为安全边界。([docs.aws.amazon.com](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentic-ai-lens.html) )

Google 2026 年则明确提出 **Agent Identity + Agent Gateway + runtime defense** 的治理模型：Agent Runtime 负责运行 Agent，而 Gateway 提供集中化的 agent-to-agent、agent-to-tool policy enforcement。([cloud.google.com](https://cloud.google.com/blog/products/identity-security/whats-new-in-iam-security-governance-and-runtime-defense)

Microsoft Agent Framework 当前也明显把 Workflows、Agent、HITL、Checkpoints、State、Hosting 等拆成不同层次，并明确支持“Agent 作为 Workflow 中的 Executor”，而不是要求 Agent 本身成为整个业务流程引擎。([learn.microsoft.com](https://learn.microsoft.com/en-us/agent-framework/concepts/workflows/)

---

# 2. 为什么金融 Agent 更需要 Control Plane / Runtime 分离

普通 AI 应用可以把：

```text id="5q0g1a"
Prompt
+
Model
+
Tools
```

放在一个服务里。

金融业务不行。

因为金融系统的关键问题是：

```text id="pymgpt"
Authority
State
Responsibility
Evidence
Control
```

而不是：

```text id="9k0d1t"
Model Quality
```

例如：

```text id="m7rvx4"
Investment Review
    ↓
Research
    ↓
Compliance
    ↓
PM Approval
    ↓
Publish
```

其中：

```text id="j4v7lh"
Research
```

可以非常 Agentic。

但：

```text id="qne4ba"
Compliance
PM Approval
Publish
```

不能简单变成：

```text id="w2rc4a"
Agent decides what's next.
```

因为后者已经涉及：

* Process Authority；
* Authorization；
* Human Responsibility；
* Business State Mutation。

所以需要一个比 Agent Runtime 更高一层的：

> **Control Plane。**

---

# 3. Control Plane 与 Runtime 的第一性原理

可以用 Kubernetes 做一个类比，但不要机械照搬。

Kubernetes 中：

```text id="5o3je8"
Control Plane
    = desired state + policy + scheduling + management

Worker Node
    = actual execution
```

Agent 平台可以类似理解：

```text id="v0tqv6"
Agent Control Plane
    = desired / allowed behavior

Agent Runtime
    = actual reasoning / execution
```

例如：

```text id="hyz8q1"
Control Plane:

Agent:
    research-agent

Capabilities:
    research.read
    market.search

Workflow:
    investment-review@v13

Current Node:
    research

Data Scope:
    APAC Equity

Policy:
    no publish

```

Runtime：

```text id="s8k23e"
收到当前 Execution Context

→ 调用 LLM
→ Search
→ Read documents
→ Compare
→ Generate analysis
→ Return structured result
```

Runtime 不应该自行改变：

```text id="4o5n6s"
Workflow
Policy
Capability
Approval
Business State
```

---

# 4. Control Plane 的定义

建议把 Agent Control Plane 定义成：

> **负责定义、约束、授权、调度、暂停、恢复、审计和治理 Agent 行为的可信系统层。**

核心职责：

```text id="c2d8ur"
Identity
Workflow
Policy
Authorization
Capability
Data Entitlement
Human Oversight
Command
Execution State
Audit
Registry
Governance
Containment
```

Control Plane 最核心的问题是：

```text id="y4aq6r"
What is allowed?
What is required?
What state are we in?
Who is responsible?
What can be executed?
What must be stopped?
```

---

# 5. Agent Runtime 的定义

Agent Runtime 是：

> **负责实际运行 Agent 逻辑和概率性计算的执行环境。**

典型组件：

```text id="v8h0u6"
Agent Loop
LLM Client
Prompt / Context
Tool Calling
Memory
RAG
Planning
Reflection
Sub-agent
Streaming
Token Management
```

Runtime 核心问题是：

```text id="1mgxjj"
How should the Agent perform the current task?
```

它不应该拥有整个企业的：

```text id="6qz5gp"
process authority
authorization authority
business truth authority
```

---

# 6. 一张最重要的边界图

```text id="w7v3d5"
                  ┌──────────────────────────────┐
                  │       AGENT CONTROL PLANE    │
                  │                              │
                  │ Identity                     │
                  │ Workflow                     │
                  │ Policy                       │
                  │ Capability                   │
                  │ Data Entitlement             │
                  │ Human Approval               │
                  │ Command                      │
                  │ State                        │
                  │ Audit                        │
                  │ Registry                     │
                  │ Governance                   │
                  │ Kill Switch                  │
                  └──────────────┬───────────────┘
                                 │
                         Runtime Contract
                                 │
                  ┌──────────────┴───────────────┐
                  │         AGENT RUNTIME        │
                  │                              │
                  │ Agent Loop                   │
                  │ Model                        │
                  │ Prompt                       │
                  │ Planning                     │
                  │ Tool Selection               │
                  │ Memory                       │
                  │ Retrieval                    │
                  │ Reflection                   │
                  │ Sub-agents                   │
                  └──────────────────────────────┘
```

核心原则：

> **Runtime 可以请求；Control Plane 才能授权。**

---

# 7. 为什么不能把 Control Plane 全塞进 Runtime

最开始很多 Agent 系统都会这样：

```text id="mwy9k7"
Agent Runtime
├── Prompt
├── Agent Loop
├── Tool Registry
├── Permission
├── Workflow
├── Approval
├── Audit
└── Business Logic
```

开发很快。

但很快出现：

```text id="y8atqg"
不同 Agent 有不同权限
不同 Workflow 有不同 Policy
不同团队部署不同 Runtime
不同模型版本
不同 Tool Registry
不同审计需求
```

然后 Runtime 开始膨胀：

```text id="u4ap3h"
Copilot Runtime
+
Security Engine
+
Workflow Engine
+
IAM
+
Audit System
+
Human Workflow
```

最终：

> **每个 Agent Runtime 都重新实现一套企业控制平面。**

这就是企业 Agent 平台最容易进入的架构陷阱。

---

# 8. Control Plane 的核心价值：统一治理，而不是统一推理

Agent Runtime 可以很多：

```text id="r6umkx"
Runtime A
Runtime B
Runtime C
```

甚至来自：

```text id="4bkjy8"
Copilot
DeepAgents
OpenAI Agents
Claude Agent SDK
LangGraph
Custom Runtime
```

但企业希望：

```text id="8pjq4c"
Identity
Policy
Capability
Workflow
Approval
Audit
```

是统一的。

所以：

```text id="f8sq0h"
Multiple Agent Runtimes
            │
            ▼
     One Control Plane
```

这是平台化最大的价值之一。

---

# 9. Control Plane 不应该直接实现 Agent Reasoning

同样，也不要反过来。

错误：

```text id="wd82wp"
Control Plane
    ↓
LLM
    ↓
decide how to solve every task
```

这样 Control Plane 就开始成为 Agent Runtime。

更合理：

```text id="w8yvyf"
Control Plane
    ↓
Task Contract
    ↓
Agent Runtime
    ↓
Result
    ↓
Control Plane
```

也就是：

```text id="uyt0b5"
Control
    → constraints

Runtime
    → execution

Control
    → verification
```

---

# 10. Control Plane 与 Runtime 的接口应该是 Contract

两者不能直接互相“猜”。

应该有明确：

```text id="2grf9j"
Runtime Contract
```

例如：

```ts
interface AgentTaskRequest {
  executionId: string;
  workflowId: string;
  workflowVersion: string;

  nodeId: string;

  actor: {
    agentId: string;
    userId?: string;
  };

  capabilities: string[];

  dataScope: string[];

  input: unknown;

  outputSchema: unknown;

  timeoutMs: number;
}
```

Runtime 返回：

```ts
interface AgentTaskResult {
  status: "success" | "fail";

  output?: unknown;

  evidence?: EvidenceReference[];

  toolUsage?: ToolUsage[];

  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
}
```

这意味着：

```text id="f83q4k"
Runtime
```

收到：

```text id="x8h0bw"
“当前只能执行这个 Task。”
```

而不是：

```text id="j5b47u"
“你自己看看还能做什么。”
```

---

# 11. Runtime Contract 是最关键的防线

建议把它理解成：

```text id="8vnzq0"
Control Plane
        │
        │ constrained contract
        ▼
Agent Runtime
        │
        │ bounded result
        ▼
Control Plane
```

Runtime 可以：

```text id="0dnm9y"
choose tools
plan
reason
retry local work
ask model
use memory
```

但不能：

```text id="mbh27v"
change workflow
grant capability
change policy
approve itself
execute unauthorized command
```

---

# 12. Runtime 应该是“租户”

可以把 Runtime 看成 Control Plane 租出去的一个计算执行器：

```text id="y0lrm5"
Control Plane

Tenant:
    execution-84721

Lease:
    capabilities = [read, search]
    workflowNode = research
    expires = 10 min

        ↓

Agent Runtime
```

时间到了：

```text id="3m1c0x"
Lease revoked
```

Runtime 继续存在也没有：

```text id="0v9zgh"
publish capability
```

这种设计特别适合高风险金融环境。

---

# 13. Capability Lease

进一步可以把：

```text id="e6hc19"
Capability
```

做成：

```text id="x7cw9z"
execution-scoped
node-scoped
time-scoped
resource-scoped
```

例如：

```json id="n8ax8m"
{
  "executionId": "exec-123",
  "nodeId": "research",
  "capabilities": [
    "research.read",
    "market.search"
  ],
  "resources": [
    "portfolio:APAC"
  ],
  "expiresAt": "2026-09-19T11:00:00Z"
}
```

Runtime 只获得：

```text id="k2l9mv"
current capability envelope
```

而不是一个永久 Role。

---

# 14. 为什么 Google 的 Agent Gateway 很值得参考

Google 2026 年明确把：

```text id="l1z9h4"
Agent Identity
Agent Gateway
Agent Runtime
```

分开。

其 Agent Gateway 被设计成所有 agent-to-agent 和 agent-to-tool connections 的集中式 policy enforcement 点，可以在不修改 Agent 业务代码的情况下，对 Agent Traffic 做身份和策略控制。([cloud.google.com](https://cloud.google.com/blog/products/identity-security/whats-new-in-iam-security-governance-and-runtime-defense) )

这正说明：

> **Runtime 不应该成为唯一的 Security Boundary。**

更好的模式是：

```text id="4n3j7w"
Agent Runtime
      │
      ▼
Agent Gateway
      │
      ▼
Policy / Identity / Guardrails
      │
      ▼
Tools / External Systems
```

---

# 15. AWS 也采用类似分层思想

AWS Agentic AI Lens 要求：

* 每个 Agent 有独立身份；
* 每次 Tool Invocation 在外部 Policy 中授权；
* agent identity 与 originating user context 沿链路传播；
* 高风险 mutation 进入 HITL；
* Tool 与 MCP Server 必须有注册、版本和安全审查；
* Workflow orchestration 层保护状态机和 execution state。

这些能力实际上就是一个 Control Plane 的组成部分。([docs.aws.amazon.com](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentsec02.html) )

---

# 16. Control Plane 不应该等于“一个服务”

Control Plane 是一个**逻辑架构层**，而不一定是一台服务。

可以：

```text id="5qf61h"
Control Plane
├── Identity Service
├── Policy Service
├── Workflow Service
├── Capability Registry
├── Tool Registry
├── Human Task Service
├── Command Service
├── Audit Service
└── Governance Service
```

部署上可能是：

```text id="z8j1c4"
10 个微服务
```

也可以在早期：

```text id="9kw0w5"
1 个 modular monolith
```

关键是：

> **职责边界必须成立。**

---

# 17. 金融场景下 Control Plane 的建议组成

推荐：

```text id="1xtdfq"
Agent Control Plane
│
├── Agent Registry
├── Agent Identity
├── Skill Registry
├── Tool Registry
├── Capability Registry
│
├── Workflow Definition
├── Workflow Runtime / State
│
├── Authorization Policy
├── Data Entitlement
│
├── Human Task / Approval
├── Command Policy
├── Command Execution
│
├── Audit Evidence
├── Runtime Telemetry
│
├── Risk Classification
├── Agent Evaluation
│
└── Kill Switch / Containment
```

---

# 18. Agent Registry

负责：

```text id="daw5t7"
Agent Name
Agent Owner
Purpose
Version
Runtime Type
Model
Capabilities
Data Scopes
Risk Tier
Status
```

例如：

```yaml id="3a5yrp"
agent:
  id: investment-research
  owner: investment-platform
  purpose: research support
  runtime: copilot
  riskTier: medium
  capabilities:
    - research.read
    - market.search
```

Agent Registry 是：

> “企业到底有哪些 Agent？”

的答案。

---

# 19. Skill Registry

Skill 是：

```text id="1c73mc"
behavior package
```

例如：

```text id="kbd3uk"
Investment Research Skill
Compliance Investigation Skill
Proxy Voting Skill
```

Control Plane 应掌握：

```text id="5o2b8e"
skillVersion
skillHash
owner
approval
allowedAgents
```

Runtime 只加载被授权的 Skill。

AWS 将 prompts、tool catalogs、role definitions、model selections 和 policies 都视为应该版本化、review、test、rollout 和 rollback 的 Agent Behavior artifacts。([docs.aws.amazon.com](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/design-principles.html)

---

# 20. Tool Registry

记录：

```text id="dc5n57"
Tool
Owner
Risk
Input Schema
Output Schema
Data Classification
Capability
Version
Review Expiry
```

特别重要：

```text id="qj7imv"
MCP Server
```

也必须进入 Registry。

AWS 当前要求 Tool 和 MCP Server 在 Agent 可使用前经过安全审查，并以 pinned version、数据分类和 review expiry 进行治理。([docs.aws.amazon.com](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentsec02.html)

---

# 21. Capability Registry

例如：

```text id="ysn2su"
research.read
market.search
case.read
case.write
publish.investment
execute.trade
```

定义：

```text id="8l3vg7"
riskTier
sideEffect
dataScope
requiredApproval
allowedAgents
```

这样 Tool：

```text id="p0sfx5"
getPortfolio()
```

可以映射到：

```text id="j3y3bd"
portfolio.read
```

Agent 获得的是 Capability，而不是底层 Tool 的无限权限。

---

# 22. Workflow Registry

Workflow：

```text id="7huh9d"
investment-review@v13
proxy-voting@v4
client-onboarding@v8
```

Control Plane 管：

```text id="z3aomr"
definition
version
sourceHash
status
owner
approvedBy
deployment
```

Runtime 只执行：

```text id="db8jpr"
validated immutable definition
```

而不是每次重新解释：

```text id="21v6cw"
SKILL.md
```

---

# 23. Policy Registry

这里可以包括：

```text id="zhl6o3"
Authorization Policy
Data Entitlement Policy
Approval Policy
Risk Policy
Tool Policy
Command Policy
```

例如：

```text id="ozshd0"
publish-investment-idea
```

可能要求：

```text id="f73y1c"
role = investment.reviewer
AND
complianceApproved = true
AND
pmApproved = true
```

Runtime 不应该把这些规则复制到 Prompt。

---

# 24. Human Task Service

负责：

```text id="kkayq9"
Review Assignment
Approval
Rejection
Request Changes
Escalation
Timeout
Delegation
```

Microsoft 当前 Agent Framework 已把 HITL request/response 和 checkpoint/resume 建成 Workflow 原生机制；pending requests 会随 checkpoint 保存，恢复时重新发出。([learn.microsoft.com](https://learn.microsoft.com/en-us/agent-framework/workflows/human-in-the-loop) )

因此：

```text id="pqi6gd"
Human Task
```

明显属于 Control Plane / Workflow Control，而不是 LLM Runtime。

---

# 25. Command Service

负责：

```text id="6n1v0e"
Command Intent
Authorization
Approval
Hash
Resource Version
Idempotency
Execution
```

Runtime 只能：

```text id="3i5g7d"
propose
```

Control Plane 决定：

```text id="w8wygz"
approve / deny / execute
```

---

# 26. Audit Service

负责：

```text id="kjyp4v"
Business Provenance
Policy Decisions
Approval
Command Execution
Agent Identity
Workflow Version
Evidence
```

Runtime telemetry 可以进：

```text id="hgk1ro"
OpenTelemetry / LangSmith
```

但：

```text id="hcjcn1"
Regulatory Evidence
```

应该由 Control Plane 自己形成。

AWS 已明确要求 Agent 行为端到端可观察，并要求 Workflow Execution 记录足以重建 execution path 的信息。([docs.aws.amazon.com](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentsec06-bp02.html)

---

# 27. Control Plane 的统一对象模型

可以形成：

```text id="o84r1m"
Agent
  │
  ├── Identity
  ├── Skills
  ├── Capabilities
  ├── Tools
  ├── Policies
  └── Runtime Binding

Execution
  │
  ├── Workflow
  ├── Node
  ├── Runtime Session
  ├── Human Tasks
  ├── Commands
  └── Audit
```

---

# 28. Runtime 需要什么对象

Runtime 不需要理解整个企业。

它主要接收：

```text id="2b2k2e"
ExecutionContext
TaskContract
CapabilityEnvelope
DataContext
ModelConfig
RuntimeLimits
```

例如：

```json id="kgyd5b"
{
  "executionId": "exec-123",
  "nodeId": "research",
  "agentId": "research-agent",
  "model": {
    "provider": "litellm",
    "model": "model-x"
  },
  "capabilities": [
    "research.read",
    "market.search"
  ],
  "limits": {
    "maxTurns": 20,
    "maxToolCalls": 30,
    "timeoutMs": 600000
  }
}
```

Runtime 只需要知道：

> “我现在要完成一个什么受限任务？”

而不是：

> “整个企业 Workflow 是什么？”

---

# 29. Runtime 不应该获得整个 Capability Registry

错误：

```text id="j8f3d8"
Runtime
    ↓
all tools
    ↓
model chooses
```

正确：

```text id="at5qj6"
Control Plane
    ↓
Capability Resolution
    ↓
current Task Capability Envelope
    ↓
Runtime
```

这符合 AWS 的 tool authorization / least privilege 原则，也与 Google Agent Gateway 的集中策略执行方向一致。([docs.aws.amazon.com](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentsec02-bp01.html) ([cloud.google.com](https://cloud.google.com/blog/products/identity-security/whats-new-in-iam-security-governance-and-runtime-defense) )

---

# 30. Runtime 与 Tool Gateway

建议不要：

```text id="4gx0zy"
Agent Runtime
   ↓
direct Tool API
```

而是：

```text id="jjf1qg"
Agent Runtime
      │
      ▼
Tool Gateway
      │
      ├── Identity
      ├── Capability
      ├── Policy
      ├── Data Entitlement
      ├── Rate Limit
      ├── Schema Validation
      └── Audit
      │
      ▼
Tool / API / MCP
```

Google 的 Agent Gateway 正是这种模式：对 agent-to-tool、agent-to-agent 流量提供统一 policy enforcement。([cloud.google.com](https://cloud.google.com/blog/products/identity-security/whats-new-in-iam-security-governance-and-runtime-defense)

AWS 也要求每次 Tool Invocation 通过外部 policy 授权，而不是由 Agent 自己决定。([docs.aws.amazon.com](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentsec02-bp01.html)

---

# 31. Agent Runtime 不是 Trust Boundary

这是整个架构最重要的结论之一。

AWS 明确写出：

> **The agent itself is not a trust boundary.**

所有：

* user input；
* memory；
* tool input/output；
* retrieved content；
* agent-to-agent messages；

都必须被视为不可信输入。([docs.aws.amazon.com](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/security-design-principles.html)

因此不能：

```text id="8u4tr7"
Agent Runtime
    = Security Boundary
```

应该：

```text id="r1u2b9"
Control Plane
    = Trust Boundary

Runtime
    = bounded worker
```

---

# 32. Runtime 可以不可信，但不能失控

这两个概念不矛盾。

Runtime 即使：

```text id="x7l4f0"
Prompt Injected
Model Hallucinates
Buggy
Misconfigured
Compromised
```

仍然应该因为：

```text id="2h6r6u"
Policy
Capability
Workflow
Domain
```

而无法突破业务边界。

即：

```text id="d6t1nu"
Runtime failure
    ↓
bounded impact
```

而不是：

```text id="m6q5q9"
Runtime failure
    ↓
enterprise-wide privilege
```

---

# 33. Control Plane 是“North-South”与“East-West”控制中心

可以把流量分为：

### North-South

```text id="m1km4w"
User
 ↓
Agent
 ↓
Business Workflow
```

### East-West

```text id="y5w7gu"
Agent A
 ↓
Agent B

Agent
 ↓
Tool

Agent
 ↓
MCP
```

Control Plane 应当覆盖：

```text id="1b7o2j"
User → Agent
Agent → Agent
Agent → Tool
Agent → Data
Agent → Command
```

AWS 当前对 Agent-to-Agent Security 单独强调 identity verification、communication security 和 trust boundaries；MCP/A2A 只是互操作协议，不是安全边界。([docs.aws.amazon.com](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentsec06.html)

---

# 34. Agent Runtime 应该支持多种 Runtime

成熟 Control Plane 不应假设：

```text id="o8x17d"
Agent Runtime = Copilot
```

应该支持：

```text id="2iljv4"
Copilot Runtime
DeepAgents Runtime
OpenAI Runtime
Claude Runtime
Custom Runtime
```

例如：

```text id="c2o74y"
Control Plane
     │
 ┌───┼────────┬─────────┐
 ▼   ▼        ▼         ▼
CP   DA      OAI       Custom
```

所有 Runtime 都遵守：

```text id="9m9i5o"
same Task Contract
same Capability Contract
same Identity Contract
same Event Contract
```

这是真正平台化的关键。

---

# 35. 当前行业正在形成类似的职责分离（术语尚未统一）

> **本文的 Control Plane / Runtime 是推荐的 architecture pattern，不是行业统一标准。**
> AWS / Google / Microsoft / Anthropic 有非常接近的分层思想，但术语并不完全一致；
> 以下只能说“可以抽象成 Control Plane / Runtime 模型”，不能反过来说业界已经统一使用这个名字。

Microsoft Agent Framework 当前把：

```text id="pl2e6g"
Agent
Workflow
Middleware
Security
Memory
Hosting
```

作为不同能力域；同时支持 Agent Executor 嵌入 Workflow。([learn.microsoft.com](https://learn.microsoft.com/en-us/agent-framework/)

Google 则已经明确把：

```text id="04tdyt"
Agent Runtime
Agent Identity
Agent Gateway
```

作为不同产品/架构组件。([cloud.google.com](https://cloud.google.com/blog/products/identity-security/whats-new-in-iam-security-governance-and-runtime-defense)

AWS 的 AgentCore 相关架构也将 runtime、identity、gateway、workflow security、observability、human oversight 等控制能力分开。([docs.aws.amazon.com](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentic-ai-lens.html)

所以：

> **Control Plane / Runtime Plane 分离不是理论上的“架构洁癖”，而是本系列推荐的 architecture pattern；
> 它与当前主要平台的职责分离方向一致，但各家术语并不统一。**

---

# 36. Anthropic 的观点：不要为了 Agent 化而 Agent 化

Anthropic 的工程经验把 Workflow 和 Agent 明确区分：

```text id="09nmur"
Workflow:
    LLM + tools orchestrated through predefined code paths

Agent:
    LLM dynamically directs its own process and tool usage
```

同时建议优先使用简单、可组合的模式，只在任务真正需要动态性时提升到更自主的 Agent。([anthropic.com](https://www.anthropic.com/engineering/building-effective-agents)

这对 Control Plane / Runtime 分离非常重要：

```text id="ll9o9n"
Control Plane
    → predefined code paths

Runtime
    → dynamic reasoning where necessary
```

---

# 37. Control Plane 可以统一 Runtime，Runtime 可以保持高度创新

这是这个架构最大的工程收益。

例如：

```text id="5lc94i"
Control Plane:
    stable
```

而 Runtime：

```text id="f1v5ao"
2026:
    Copilot

2027:
    new reasoning runtime

2028:
    local model runtime
```

不会影响：

```text id="3u4d6f"
Policy
Workflow
Approval
Audit
Capability
```

也就是说：

> **控制面长期稳定；执行面快速演进。**

这非常适合 AI 技术更新速度远快于金融业务规则变化的现实。

---

# 38. Control Plane 也可以支持多模型

例如：

```text id="lq4c7p"
Research Task
    → high-quality model

Classification Task
    → cheaper model

Summarization
    → fast model

High-risk analysis
    → validated model
```

Control Plane 统一决定：

```text id="l5f6c3"
approved model class
region
provider
budget
risk
```

Runtime 实际调用：

```text id="5r67ic"
LLM
```

这种模型治理边界非常重要。

---

# 39. Model Routing 的 Policy 边界属于 Control Plane，Runtime 在批准集合内选择

> **准确表述：在关键控制路径上，模型路由的允许集合由 Control Plane 的 Model Policy 决定；
> Runtime 只能在批准集合内选择（例如按任务类型、风险、成本），不能自行突破到未批准模型。**

不要：

```text id="ci4t5b"
Agent Prompt:
    choose the best model.
```

而应该：

```text id="ylqje4"
Task
   ↓
Model Policy
   ↓
Approved Model Set
   ↓
Runtime
```

例如：

```text id="lcr2f5"
research:
    allowed:
        model-A
        model-B

payment:
    allowed:
        validated-model-X
```

Runtime 只能选择：

```text id="z2j2tj"
within approved set
```

---

# 40. Control Plane 与 LiteLLM 的关系

如果企业内部已有：

```text id="v7io85"
LiteLLM
```

它非常适合成为：

```text id="84tmms"
Model Gateway
```

而不是完整的：

```text id="63zjvs"
Agent Control Plane
```

可以形成：

```text id="i8wjjw"
Agent Control Plane
        │
   Model Policy
        │
        ▼
     LiteLLM
        │
 ┌──────┼───────┐
 ▼      ▼       ▼
OpenAI Claude Gemini
```

LiteLLM 解决：

```text id="s4s8m0"
provider abstraction
routing
model access
usage
cost
```

Control Plane 解决：

```text id="89agyd"
business authorization
workflow
capability
human approval
command
audit
```

两者职责不同。

---

# 41. Control Plane 与 LangSmith 的关系

类似地：

```text id="pmv3fz"
LangSmith
```

非常适合：

```text id="5a6dnh"
Agent tracing
evaluation
debugging
prompt inspection
runtime telemetry
```

但不应直接成为：

```text id="2cniw2"
Business Authorization
Workflow Authority
Regulatory Evidence Authority
```

更合理：

```text id="z1w0o7"
Control Plane
      │
      ├── Business Audit
      │
      └── Runtime Telemetry
                 │
                 ▼
             LangSmith
```

这样：

> **Observability 可以采用第三方；Business Control 不应该依赖第三方 Agent UI。**

---

# 42. Control Plane 与 Kubernetes 的关系

Kubernetes 可以提供：

```text id="k8qjyf"
container scheduling
service networking
scaling
secret
deployment
```

但 Kubernetes 不是：

```text id="nqsh8k"
Business Workflow Control Plane
```

所以：

```text id="l3q8c0"
Kubernetes
    → Infrastructure Control Plane

Agent Control Plane
    → Business / Agent Control Plane

Agent Runtime
    → Workload
```

这三个层面不要混淆。

---

# 43. 一个完整的企业 Agent Stack

推荐：

```text id="k8deji"
┌─────────────────────────────────────────────┐
│                Business Apps                │
└──────────────────────┬──────────────────────┘
                       │
┌──────────────────────▼──────────────────────┐
│           Agent Control Plane               │
│                                             │
│ Workflow / Policy / Identity / Capability   │
│ Data Entitlement / HITL / Command / Audit  │
│ Registry / Governance / Containment         │
└──────────────────────┬──────────────────────┘
                       │
                Runtime Contract
                       │
┌──────────────────────▼──────────────────────┐
│               Agent Runtime                 │
│                                             │
│ Agent Loop / Planning / Memory / RAG        │
│ Model Calls / Tool Selection / Reflection   │
└──────────────────────┬──────────────────────┘
                       │
┌──────────────────────▼──────────────────────┐
│              Model Gateway                 │
│                                             │
│ LiteLLM / Provider Gateway / Routing        │
└──────────────────────┬──────────────────────┘
                       │
┌──────────────────────▼──────────────────────┐
│              AI / Data / Tools              │
│                                             │
│ LLMs / APIs / MCP / Search / DB / SaaS      │
└─────────────────────────────────────────────┘
```

---

# 44. 为什么 Control Plane 必须比 Runtime 更稳定

Runtime 变化：

```text id="a8vgr0"
model
framework
prompt
agent loop
tool strategy
memory strategy
```

变化非常快。

Control Plane：

```text id="sw05b0"
who
what
whether
when
approval
business state
audit
```

变化相对慢，而且受到组织治理和监管影响。

所以：

```text id="myutp3"
AI Innovation Rate
      ↑
      │
Runtime
      │
      │
Control Plane
      │
      ↓
Business Change Rate
```

架构上应该让：

> **快速变化的东西依赖稳定的东西，而不是让稳定的业务控制逻辑依赖快速变化的 Agent Runtime。**

---

# 45. 这是金融平台避免 Vendor Lock-in 的关键

假设 Workflow / Policy / Audit 都直接写进：

```text id="7pqmc7"
Vendor Agent SDK
```

以后换：

```text id="e0xw49"
Copilot
→ OpenAI
→ Anthropic
→ DeepAgents
```

整个系统都要重写。

如果：

```text id="8sviv3"
Control Plane
```

独立：

```text id="4t2xa5"
Runtime Adapter
```

只需要替换：

```text id="v22y0k"
Agent Runtime Connector
```

这是更合理的架构。

---

# 46. Runtime Adapter

推荐：

```ts id="9k1m4d"
interface AgentRuntime {
  executeTask(
    context: AgentTaskContext
  ): Promise<AgentTaskResult>;
}
```

实现：

```text id="2w72j2"
CopilotRuntime
DeepAgentsRuntime
OpenAIRuntime
ClaudeRuntime
CustomRuntime
```

Control Plane 只调用：

```text id="7u6nmu"
AgentRuntime.executeTask()
```

而不直接：

```text id="n8fn9a"
import CopilotClient
```

这也是为什么 Workflow Layer 本身不应该绑定某个 Agent SDK。

---

# 47. Runtime 需要知道多少 Control Plane 信息

原则：

> **只给完成当前 Task 所需的最小上下文。**

例如：

```text id="n2dqf3"
Agent Runtime
```

应该知道：

```text id="ka6xsx"
current task
input
output schema
allowed capabilities
data scope
runtime limits
```

不必知道：

```text id="8ve3zq"
所有 Policy
所有 Workflow
所有用户
所有其他 Agent
所有 Command
```

这遵循：

```text id="pkj8je"
Least Privilege
+
Least Knowledge
```

---

# 48. Control Plane 可以把 Context “编译”给 Runtime

这是一个非常值得采用的概念。

原始 Control Plane 状态：

```text id="8phwgc"
User
Agent
Workflow
Policy
Capabilities
Data Entitlement
Risk
Approval
```

经过计算：

```text id="1iuy0x"
Effective Execution Context
```

然后：

```text id="l1xw1h"
→ Runtime
```

例如：

```json id="9t4w8x"
{
  "task": "research",
  "capabilities": [
    "research.read",
    "market.search"
  ],
  "resources": [
    "portfolio:APAC"
  ],
  "maxTurns": 20,
  "maxToolCalls": 30,
  "outputContract": "ResearchResult:v2"
}
```

这可以理解成：

> **Control Plane 把复杂治理规则编译成一个短生命周期 Execution Context。**

---

# 49. Runtime 不应该重新计算 Effective Permission

例如不要：

```text id="yy2l9b"
Runtime:
    User role = PM
    Agent role = Research
    Maybe permission = ...
```

而应该：

```text id="pr0b6g"
Control Plane:
    Effective Capability = [...]
```

Runtime 直接使用。

这样：

```text id="bz4j8e"
Authorization
```

只有一个权威来源。

---

# 50. Policy Enforcement 应该靠近 Side Effect

虽然 Control Plane 提供：

```text id="vh6l2e"
Policy Decision
```

但真正执行：

```text id="q6o7c8"
Tool
Command
Domain API
```

的地方仍应该做最后的 enforcement。

即：

```text id="c5d8wq"
Control Plane Policy
       ↓
Runtime Contract
       ↓
Tool Gateway
       ↓
Domain API
```

原因：

> **Control Plane Policy 是“允许”的决定；Side-effect boundary 是最终“不能绕过”的执行约束。**

AWS 明确要求每次 Tool Invocation 在执行之前进行 external authorization；Microsoft 也强调 Agent/Framework 提供 guardrail building blocks，但最终 input validation、secure data flow 和 tool configuration 是 application responsibility。([docs.aws.amazon.com](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentsec02-bp01.html) ([learn.microsoft.com](https://learn.microsoft.com/en-us/agent-framework/agents/safety) )

---

# 51. Control Plane 应支持“Observe / Control / Stop”

对一个 Production Agent：

```text id="h18j7s"
Observe
    ↓
Control
    ↓
Stop
```

三个能力都要有。

### Observe

```text
current node
tools
cost
latency
errors
```

### Control

```text
change capability
pause
resume
reassign
escalate
```

### Stop

```text
terminate
disable tool
disable agent
block workflow
```

---

# 52. Kill Switch 是 Control Plane 的核心能力

如果 Agent 进入：

```text id="7ncvgg"
runaway loop
```

不能要求：

```text id="jprw89"
Agent 自己决定停止。
```

应该：

```text id="qzyd8k"
Control Plane
    ↓
execution.cancel
    ↓
Runtime
    ↓
stop
```

AWS 当前把 agent containment、break-glass、rogue-agent detection 和 human oversight protection 作为独立安全实践。([docs.aws.amazon.com](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/security.html)

---

# 53. Kill Switch 必须不依赖 Agent Runtime

错误：

```text id="9b8nsf"
Runtime command:
    stopSelf()
```

如果 Runtime：

```text id="pl1mza"
hung
compromised
network isolated
```

这个 Kill Switch 就失效。

更合理：

```text id="zpj8d1"
External Control Plane
    ↓
revoke execution
    ↓
revoke credentials
    ↓
block Tool Gateway
    ↓
terminate runtime
```

即：

> **Containment 必须在 Runtime 之外。**

---

# 54. Long-running Agent 更需要 Control Plane

Agent Runtime 如果只运行：

```text id="bgcyim"
30 seconds
```

可以简单。

但金融业务可能：

```text id="n1s8ej"
Day 1:
Research

Day 2:
Compliance

Day 3:
Approval

Day 4:
Execution
```

因此必须：

```text id="pjw3y3"
durable execution
pause
resume
checkpoint
state
```

Microsoft 当前 Workflow Checkpoint 就明确针对 long-running、pause/resume、auditing/compliance 和 environment migration 场景。([learn.microsoft.com](https://learn.microsoft.com/en-us/agent-framework/workflows/checkpoints)

---

# 55. Runtime Restart 不等于 Execution Restart

例如：

```text id="uf8kci"
Pod crashed
```

Control Plane：

```text id="3sm80h"
Execution:
    waiting_for_approval
```

仍然存在。

新 Runtime：

```text id="t5t4eh"
```

重新接管：

```text id="jr6kld"
execution-84721
```

而不是：

```text id="oneo2l"
new execution
```

这就是为什么：

> **Execution State 必须属于 Control Plane，而不是 Runtime Memory。**

---

# 56. Session 与 Execution 必须分开

这也是非常重要的边界。

### Session

```text id="2fd8it"
Runtime conversation
```

### Execution

```text id="yyj3s5"
Business process instance
```

例如：

```text id="e1awq1"
Session #A
```

可以结束。

但：

```text id="e6z8gq"
Execution #1234
```

仍然：

```text id="waiting_for_approval"
```

以后可以创建：

```text id="29a6av"
new Runtime Session
```

继续执行。

因此：

```text id="y6q2e3"
Session
    !=
Business Execution
```

---

# 57. Control Plane 可以实现 Runtime Failover

如果：

```text id="e3b9jv"
Copilot Runtime
```

出现问题：

```text id="3y0vzo"
```

可以：

```text id="gkp5z8"
Execution
   ↓
pause
   ↓
switch runtime
   ↓
DeepAgents Runtime
   ↓
resume
```

前提是：

```text id="3yb2p4"
Runtime Contract
```

足够稳定。

这就是 Runtime 与 Control Plane 分离后最大的韧性收益。

---

# 58. Runtime Failover 的真正困难

并不是：

```text id="blkvby"
“重新启动另一个 Agent。”
```

而是：

```text id="pbi8vh"
如何保证新的 Runtime
不会改变业务语义？
```

所以需要：

```text id="m2g4zs"
Workflow Version
Task Contract
Capability Envelope
Output Schema
State
Evidence
```

不变。

Runtime 可以换：

```text id="lnf4kg"
model
framework
provider
```

但必须满足同一 Contract。

---

# 59. Runtime Contract 是平台稳定性的真正核心

如果：

```text id="zjz5b3"
Copilot Runtime
```

和：

```text id="8y6gh3"
DeepAgents Runtime
```

输出完全不同：

```text id="s3nmrz"
```

Control Plane 就无法保证：

```text id="e6ub8x"
```

所以：

```text id="7ikxwu"
AgentTaskRequest
AgentTaskResult
Tool Contract
Capability Contract
Evidence Contract
```

应该成为平台级标准。

---

# 60. Agent Runtime 可以内部使用任何 Orchestration

例如：

```text id="6rzk6w"
Control Plane
  ↓
Research Task

Runtime:
  LangGraph
   ↓
  Planner
   ↓
  Retriever
   ↓
  Worker
   ↓
  Evaluator
```

Control Plane 完全不需要知道。

或者：

```text id="z4g0rt"
Runtime:
  DeepAgents
```

也可以。

甚至：

```text id="j4g7d3"
Runtime:
  plain SDK loop
```

也可以。

所以：

> **Control Plane / Runtime 分离不要求 Runtime 简单；只要求 Runtime 的外部语义稳定。**

---

# 61. Multi-Agent 是 Runtime 内部问题，还是 Control Plane 问题？

两者都有。

### Runtime 内部

```text id="zq3n9b"
Research Agent
    ↓
Summarizer Agent
```

如果只是为了完成：

```text id="a2zgu0"
一个 Task
```

可以由 Runtime 自己处理。

### Control Plane

如果多个 Agent 之间涉及：

```text id="x8afk2"
authority
data access
delegation
cross-team responsibility
business state
```

就需要 Control Plane 参与。

AWS 当前明确要求多 Agent communication 具有可验证身份、保护 trust boundaries，并指出 A2A/MCP 等协议本身不是 security boundary。([docs.aws.amazon.com](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentsec06.html)

---

# 62. Runtime 内部 Agent-to-Agent 不应自动获得企业权限

例如：

```text id="v3q1oz"
Research Agent
    ↓
Compliance Agent
```

不意味着：

```text id="4b6kyg"
Research Agent
→
Compliance data
```

Control Plane 必须：

```text id="b6umfs"
authorize delegation
```

然后才允许。

---

# 63. Agent Runtime 与 Data Plane 的关系

可以进一步把架构分成三层：

```text id="w4uxip"
Control Plane
       │
       ▼
Runtime Plane
       │
       ▼
Data / Service Plane
```

### Control Plane

```text id="0w66q0"
who
what
whether
when
```

### Runtime

```text id="j6g3ks"
how
```

### Data / Domain

```text id="x6x5h5"
truth
```

因此：

```text id="i7roby"
Policy
    → Control

Agent
    → Runtime

Domain
    → Truth
```

---

# 64. Agent Gateway 可以看成三层之间的“执行闸门”

例如：

```text id="8qg257"
Agent Runtime
       │
       ▼
Agent Gateway
       │
       ├── Identity
       ├── Capability
       ├── Policy
       ├── Data Entitlement
       ├── Rate Limit
       ├── Audit
       └── Schema
       │
       ▼
Domain / Tool / API
```

Google Agent Gateway 和 AWS AgentCore Gateway/Tool Authorization 都体现了这一思想。([cloud.google.com](https://cloud.google.com/blog/products/identity-security/whats-new-in-iam-security-governance-and-runtime-defense) ([docs.aws.amazon.com](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentsec02.html) )

---

# 65. Control Plane 的数据不要直接灌进 Prompt

例如：

```text id="2i9w1n"
Policy:
    user cannot publish

Capability:
    read only

Data:
    APAC only
```

不要只是：

```text id="knt0x9"
System Prompt:
    Remember these rules.
```

而是：

```text id="5r8y6g"
Capability enforcement
Policy enforcement
Data gateway
Workflow runtime
```

Prompt 可以辅助模型理解：

```text id="wz1j20"
what it is allowed to attempt
```

但真正的 enforcement 必须在 Control Plane / Gateway。

---

# 66. Control Plane 应该“拒绝”，Runtime 应该“处理拒绝”

例如：

```text id="j9b5f6"
Runtime:
    wants tool X

Gateway:
    DENY
```

Runtime 可以收到：

```json id="kb7r65"
{
  "code": "CAPABILITY_DENIED",
  "tool": "publish"
}
```

Runtime 可以：

```text id="gsk3b8"
explain
ask human
choose safe alternative
```

但不能：

```text id="a8xnzn"
retry with stronger wording
```

绕过 Control Plane。

---

# 67. “Deny” 也应该是结构化结果

不要：

```text id="t6gma2"
HTTP 403
```

结束。

可以返回：

```json id="h5rdj0"
{
  "decision": "deny",
  "reasonCode": "DATA_ENTITLEMENT",
  "retryable": false,
  "userAction": "none"
}
```

Runtime 可以根据：

```text id="vb8c0p"
retryable
```

决定：

```text id="tguvkb"
retry
or
stop
```

但不能自行改变：

```text id="4cvktp"
Authorization
```

---

# 68. Control Plane 应该拥有“Policy Decision Point”

例如：

```text id="a0q5dy"
authorize(
  principal,
  capability,
  resource,
  context
)
```

返回：

```text id="f1e5gu"
ALLOW
DENY
REQUIRE_APPROVAL
```

Runtime 可以消费结果。

而不是：

```text id="6m6kpk"
runtime.hasPermission()
```

然后自己计算。

这更容易：

* 审计；
* 测试；
* 统一治理；
* 模型替换；
* 跨 Runtime 一致性。

AWS 当前也明确要求每次 Tool Invocation 由外部 Policy 授权。([docs.aws.amazon.com](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentsec02-bp01.html)

---

# 69. Control Plane 与 Runtime 应该有明确的时序

推荐：

```text id="3t4b8x"
User
 │
 ▼
Control Plane
 │  create execution
 │  resolve identity
 │  resolve workflow
 │  resolve capabilities
 │
 ▼
Runtime
 │
 │  execute task
 │
 ▼
Control Plane
 │  validate result
 │  update workflow
 │
 ├── continue
 ├── human review
 ├── command
 └── stop
```

---

# 70. Runtime 永远不能跳过 Control Plane 的状态推进

错误：

```text id="4w95at"
Runtime
  ↓
"task complete"
  ↓
directly call next task
```

正确：

```text id="kjf8q4"
Runtime
  ↓
Task Result
  ↓
Control Plane
  ↓
state transition
  ↓
next task
```

这就是：

> **Runtime 产生事实候选；Control Plane 形成业务状态。**

---

# 71. Control Plane 处理“事实”，Runtime 处理“推理”

例如：

```text id="34rq2z"
Runtime:
    “Evidence suggests this case is high risk.”
```

Control Plane：

```text id="zs8uxn"
Risk classifier:
    riskTier = HIGH
```

或者：

```text id="7wqz1n"
Policy:
    HIGH → human approval required
```

所以：

```text id="xqzbio"
Agent Observation
    ≠
Business Fact
```

---

# 72. Runtime 返回 Evidence，而不是直接改变 State

例如：

```json id="ukqzqf"
{
  "outcome": "success",
  "evidence": [
    {
      "sourceId": "doc-123",
      "version": "v4"
    }
  ]
}
```

Control Plane：

```text id="ah3i3w"
persist
audit
route
```

这让：

```text id="08k5rm"
Agent reasoning
```

和：

```text id="ezqkv0"
business control
```

保持清晰边界。

---

# 73. 一个完整的 Investment Review 控制模型

```text id="s6g4gh"
                   User
                    │
                    ▼
             Control Plane
                    │
        create Investment Execution
                    │
                    ▼
             Workflow v13
                    │
                 @task
                    │
                    ▼
             Agent Runtime
                    │
        research / search / analyze
                    │
              structured result
                    │
                    ▼
             Control Plane
                    │
              @gate compliance
                    │
                    ▼
             Human Task
                    │
              Compliance
                    │
                 approve
                    │
                    ▼
             Human Task
                    │
                   PM
                    │
                 approve
                    │
                    ▼
              @command
                 publish
                    │
                    ▼
               Policy
                    │
               authorize
                    │
                    ▼
             CommandService
                    │
                    ▼
                 Domain
                    │
                    ▼
             Investment System
```

Agent Runtime 实际只负责：

```text id="q1q5yw"
Research
```

但业务平台拥有：

```text id="e3iuj5"
整个 Control Plane
```

---

# 74. 为什么这对金融平台特别有价值

因为：

```text id="rql0jw"
Agent Runtime
```

可以快速变化。

而：

```text id="3n9lku"
Workflow
Policy
Approval
Domain
Audit
```

不能随着模型版本一起漂移。

这样：

```text id="nfr47q"
Model upgrade
```

变成：

```text id="uvr39t"
Runtime Change
```

而不是：

```text id="o20av9"
Business Control Change
```

这是一个非常大的治理优势。

---

# 75. Change Impact Analysis 会更容易

例如：

```text id="1kyb6n"
Model changed
```

那么影响：

```text id="3xj25d"
Runtime quality
```

但不应该默认影响：

```text id="b9i4rj"
Workflow definition
Policy
Approval rules
```

如果：

```text id="m8h0r9"
Workflow changed
```

则需要：

```text id="0m2q4l"
Business process review
```

因此可以区分：

```text id="4un3g4"
Runtime Change
```

与：

```text id="1xkqlw"
Control Change
```

这对于 Change Management 非常有价值。

---

# 76. 也可以把 Release 分成两条轨道

### Runtime Release

```text id="bs7i9o"
Model
Agent Framework
Prompt
Memory
Tool selection
```

### Control Release

```text id="0b5jtk"
Workflow
Policy
Capability
Approval
Command
```

前者可以：

```text id="eh3saq"
frequent
```

后者：

```text id="pmq0n6"
strict governance
```

例如：

```text id="nbzyb3"
Runtime:
    weekly

Workflow:
    monthly / change approved

Policy:
    compliance governed

Command:
    highly controlled
```

具体周期应由组织风险框架决定。

---

# 77. Control Plane 可以提供统一 Agent Lifecycle

例如：

```text id="5jxuom"
DRAFT
 ↓
TEST
 ↓
REVIEW
 ↓
APPROVED
 ↓
ACTIVE
 ↓
SUSPENDED
 ↓
DEPRECATED
 ↓
RETIRED
```

Agent Runtime 本身不负责：

```text id="gnhgtf"
“我是不是应该上线？”
```

Control Plane 决定：

```text id="18tw3y"
status
```

---

# 78. Agent Runtime 也可以有自己的 Lifecycle

例如：

```text id="dvwv0p"
STARTING
RUNNING
WAITING
STOPPING
TERMINATED
FAILED
```

这与：

```text id="x4q4wi"
Agent Definition Status
```

完全不同。

例如：

```text id="8qz4dd"
Agent Definition:
    ACTIVE

Runtime:
    FAILED
```

定义仍存在。

这就是：

```text id="og46ot"
Control Plane Object
    ≠
Runtime Instance
```

---

# 79. Definition 与 Instance 必须分离

这是整个设计另一个非常重要的原则。

```text id="yp2nfu"
AgentDefinition
WorkflowDefinition
PolicyDefinition
```

都是：

```text id="7st0xh"
Control Plane Objects
```

而：

```text id="xj1dqe"
AgentSession
WorkflowExecution
TaskAttempt
```

属于：

```text id="fm39iy"
Runtime / Execution Objects
```

这样才能：

* 版本管理；
* Replay；
* Migration；
* Rollback；
* Audit。

---

# 80. Control Plane 可以做 Admission Control

新的 Execution 创建时：

```text id="1glqxe"
User starts workflow
```

Control Plane 检查：

```text id="vw2d0o"
Agent active?
Workflow approved?
Policy active?
Model allowed?
Data allowed?
Region allowed?
Capacity available?
```

全部通过后：

```text id="bje7k4"
admit execution
```

否则：

```text id="gkw4w1"
reject before Runtime starts
```

这个能力对于金融平台非常重要。

---

# 81. Control Plane 也是 Agent Blast Radius 的主要控制点

假设一个 Agent 被攻陷。

它真正能造成的损害取决于：

```text id="5zlzj3"
identity
capability
data scope
workflow scope
command scope
execution budget
```

这些都属于 Control Plane。

所以：

> **Control Plane 决定 Agent 的 Blast Radius；Runtime 只是决定在这个 Blast Radius 内 Agent 如何行动。**

AWS 当前将 bounded agents、minimum permissions、capability taxonomy、rate limits、human oversight 和 containment 组合成 Agent Security / Reliability 的核心实践。([docs.aws.amazon.com](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/design-principles.html)

---

# 82. Runtime 的最大价值不是“控制”，而是“可替换执行”

Control Plane 稳定后：

```text id="s7q3z2"
Research Task
```

可以分别由：

```text id="e6t4m6"
Copilot
DeepAgents
OpenAI Agent
Custom LLM Loop
```

执行。

甚至：

```text id="7x5z3b"
Human manually
```

也可以作为一种 Executor。

只要返回：

```text id="5rvmln"
TaskResult
```

即可。

这实际上让：

> **Agent Runtime 变成 Workflow Executor 的一种实现。**

---

# 83. Human 也可以看作一种 Runtime

这是一个很有价值的抽象。

例如：

```text id="3lmg7d"
@task
    → Agent Runtime

@review
    → Human Executor

@gate
    → Deterministic Executor

@command
    → Domain / Command Executor
```

于是：

```text id="2j4zom"
Workflow
    = orchestrates heterogeneous executors
```

这和 Microsoft Agent Framework 的 Workflow / Executor 模型非常接近：Executor 可以执行代码、Agent，也可以通过 RequestPort 与外部系统或人交互。([learn.microsoft.com](https://learn.microsoft.com/en-us/agent-framework/concepts/workflows/)

---

# 84. 最终 Workflow Runtime 与 Agent Runtime 的关系

可以变成：

```text id="q8w9vy"
Workflow Runtime
│
├── Agent Runtime
│
├── Human Runtime
│
├── Deterministic Function Runtime
│
└── Command Runtime
```

这比：

```text id="r6p9jd"
Workflow
    = Agent
```

更加清晰。

---

# 85. Current Project 的架构映射

当前项目可以非常自然地拆成：

```text id="j0x2t8"
                Agent Control Plane
──────────────────────────────────────────
SessionService
SessionAccessService
SessionCoordinator

Flow Parser
Flow Validator
Flow Analyzer
Workflow Definition Provider
WorkflowRunner

ApprovalPolicy
HumanTaskService

CommandPolicy
CommandService
ExecutionService

Capability Registry
Audit / Events
──────────────────────────────────────────
                     │
              Runtime Contract
                     │
                     ▼
                Agent Runtime
──────────────────────────────────────────
WorkflowTurnRunner
     │
     └── Copilot SDK
──────────────────────────────────────────
```

其中最重要的一点：

```text id="zhx0p7"
WorkflowRunner
```

应该属于 Control Plane，而：

```text id="8d8w6q"
WorkflowTurnRunner
```

应该属于 Runtime Adapter。

这种划分非常适合未来替换 Copilot Runtime，而不需要重新设计 Workflow / Policy / Approval / Command。

---

# 86. `WorkflowTurnRunner` 为什么是一个很好的边界

当前接口类似：

```ts id="4jv5a1"
type WorkflowTurnRunner = (input: {
  execution: {
    executionId: string;
    sessionId: string;
    tenantId: string;
    userId: string;
    model?: string;
  };
  prompt: string;
}) => Promise<{
  content: string;
  chars: number;
}>;
```

它实际上已经是：

> **Agent Runtime Port**

WorkflowRunner 不需要知道：

```text id="58s6cq"
Copilot SDK
```

只需要：

```text id="t2vi3p"
execute current AI task
```

这正是应该保持的方向。

---

# 87. 可以进一步把接口语义再提升一层

现在：

```text id="vw1r4a"
prompt
```

仍然偏 Runtime-specific。

更平台化的接口可以逐渐向：

```ts id="gk99r3"
interface AgentTaskRunner {
  run(input: AgentTaskInput): Promise<AgentTaskResult>;
}
```

其中：

```ts id="2fz9d9"
interface AgentTaskInput {
  execution: ExecutionContext;
  task: TaskContract;
  capabilities: CapabilityEnvelope;
  input: unknown;
}
```

这样 Runtime 不再接受：

```text id="3h0ew2"
raw prompt
```

而接受：

```text id="w9c3y9"
structured task
```

这是 Control Plane / Runtime 真正稳定的接口。

---

# 88. Runtime 返回值也应该结构化

不要：

```text id="4v4of6"
content: "..."
```

然后 Workflow 再解析自然语言。

更好：

```json id="5gcl8e"
{
  "outcome": "success",
  "output": {
    "findings": [],
    "evidence": []
  }
}
```

然后：

```text id="wf8j7q"
Workflow
    → outcome
```

而不是：

```text id="z1p4yw"
Workflow
    → parse LLM text
```

AWS 将 schemas、structured success criteria、registries 和 explicit contracts 作为 predictable agent execution 的重要基础。([docs.aws.amazon.com](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/design-principles.html)

---

# 89. Runtime Contract 必须有版本

例如：

```text id="y7e8s1"
TaskContract v2
```

如果：

```text id="9m9d5x"
Copilot Runtime
```

升级到：

```text id="w7q2jv"
TaskContract v3
```

旧 Workflow：

```text id="b8lo9r"
v13
```

仍然可以使用：

```text id="pf1x5h"
v2
```

直到显式迁移。

因此：

```text id="9ah7rq"
Runtime API Version
```

也应该进入：

```text id="2z0s5i"
Control Plane Artifact Versioning
```

---

# 90. Control Plane 应该为 Runtime 提供 Budget

包括：

```text id="3w5cz7"
maxTurns
maxToolCalls
maxTokens
maxDuration
maxCost
maxFanOut
```

这些是：

```text id="h8wqj6"
execution policy
```

而不是：

```text id="1sniq0"
Agent 自己决定
```

这样即使 Runtime 进入：

```text id="5c5m8n"
runaway loop
```

Control Plane 仍然能够：

```text id="dvlr5c"
stop
```

---

# 91. Runtime 还可以拥有“局部 Retry”

例如：

```text id="w6f8pz"
Tool timeout
```

Runtime 可以：

```text id="xz0m0v"
retry 2 times
```

因为这是：

```text id="0i2n1b"
local execution detail
```

但：

```text id="2h0i0a"
Workflow retry
```

仍然应该由 Control Plane 决定。

即：

```text id="9n1f8r"
Local Retry
    → Runtime

Business Retry
    → Control Plane
```

---

# 92. Runtime 与 Workflow Retry 必须分离

例如：

```text id="5y9h2v"
Model API timeout
```

可以：

```text id="n4y9k5"
runtime retry
```

但：

```text id="ga54v1"
Research failed after retries
```

才成为：

```text id="2h7n7n"
Workflow outcome = fail
```

否则 Runtime 很容易把：

```text id="3p8c2f"
technical retry
```

变成：

```text id="s3d4rq"
business state change
```

---

# 93. Control Plane 是 Runtime 的“Supervisor”

不是：

```text id="6f0p5l"
Supervisor Agent
```

而是：

```text id="h5b3l1"
Deterministic Supervisor
```

负责：

```text id="a9bngw"
start
pause
resume
cancel
retry
escalate
route
approve
deny
terminate
```

Runtime 只负责：

```text id="buxohq"
execute current work
```

---

# 94. 这比让 Supervisor Agent 管理其他 Agent 更可靠

错误：

```text id="7j8ycm"
Supervisor Agent
   ↓
decide
delegate
approve
retry
stop
```

这其实把：

```text id="y6psr3"
control plane
```

模型化了。

更合理：

```text id="3ekp8j"
Deterministic Control Plane
   ↓
Agent Runtime A
Agent Runtime B
Agent Runtime C
```

Agent 之间必要的协调仍然可以发生，但最终的：

```text id="7qu3ww"
business authority
```

应该回到 Control Plane。

---

# 95. Control Plane 的一条重要设计原则

> **Runtime 可以拥有更多信息，但不应该拥有更多 authority。**

例如：

```text id="0l6pde"
Agent Runtime
```

可能看到：

```text id="y2r8j5"
10,000 documents
```

但只有：

```text id="c7j0dy"
1 capability
```

可以调用：

```text id="1s5d3v"
research.search
```

这就是：

```text id="w3r0om"
Information ≠ Authority
```

---

# 96. Control Plane 的另一条原则

> **Control Plane 可以限制 Runtime，但不能替 Runtime 完成所有工作。**

否则：

```text id="0kqf6z"
Control Plane
```

会演化成一个巨大的：

```text id="p6irf8"
deterministic application
```

AI Runtime 又失去价值。

所以：

```text id="3h8j4z"
Control
    = enforce boundaries

Runtime
    = exploit intelligence
```

这才是合理平衡。

---

# 97. 金融平台最适合采用“两种状态”

建议分开：

### Control State

```text id="h6z4r9"
workflowState
approvalState
policyState
commandState
businessState
```

### Runtime State

```text id="r6p2x4"
conversation
tool history
agent memory
scratchpad
model context
```

Control State：

```text id="0z8p90"
durable
auditable
authoritative
```

Runtime State：

```text id="9cpw4c"
replaceable
ephemeral where possible
privacy-controlled
```

---

# 98. 为什么 Agent Memory 不应该成为 Control State

例如：

```text id="l1t8kz"
Memory:
"Compliance approved this case."
```

不能成为：

```text id="81kk9m"
business state = approved
```

正确：

```text id="x1g2zt"
HumanTask / Approval Record
    → authoritative
```

Memory：

```text id="ul5xnu"
supporting context
```

AWS 同样把 memory/state isolation 和 integrity controls 作为独立安全问题，说明 memory 本身不能自动等于 trusted business state。([docs.aws.amazon.com](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/appendix-a.html)

---

# 99. Control Plane 需要自己保存“事实”，而不是相信 Runtime

例如：

```text id="q7qco0"
Runtime says:
    task completed
```

Control Plane 应保存：

```text id="jt9x8v"
TaskAttempt:
    status = completed
    outputRef = ...
    runtime = ...
    timestamp = ...
```

这样 Runtime 可以消失：

```text id="qkhdd1"
Pod deleted
```

业务事实仍然存在。

---

# 100. 一个完整的 Execution 生命周期

```text id="a7c69m"
               REQUEST
                  │
                  ▼
          ┌───────────────┐
          │ Control Plane │
          └───────┬───────┘
                  │
             Admission
                  │
                  ▼
            Workflow State
                  │
                  ▼
             Task Contract
                  │
                  ▼
          ┌───────────────┐
          │ Agent Runtime │
          └───────┬───────┘
                  │
             Task Result
                  │
                  ▼
          ┌───────────────┐
          │ Control Plane │
          └───────┬───────┘
                  │
        ┌─────────┼──────────┐
        ▼         ▼          ▼
     Continue   Review     Command
        │         │          │
        └─────────┼──────────┘
                  ▼
               Next State
```

---

# 101. Control Plane 也应该支持异步

金融 Workflow 很多时候不是：

```text id="3m2jqw"
request
→ 30 sec
→ response
```

而是：

```text id="jlq54f"
request
→ 2 days
→ human approval
→ resume
```

所以：

```text id="n0q3kp"
Control Plane
```

必须是：

```text id="3zyrz7"
durable
event-driven
checkpoint-aware
```

而 Runtime 可以：

```text id="32x09q"
短生命周期
```

运行。

---

# 102. 这种设计天然适合 Kubernetes

K8s 可以管理：

```text id="a2b1j2"
Agent Runtime Pod
```

而 Control Plane 保存：

```text id="f0g58k"
Execution State
```

例如：

```text id="7qf0gm"
Execution #123
    runtimePod = agent-runtime-567
```

Pod 挂了：

```text id="yip0sy"
Control Plane
    → starts new Pod
    → rehydrates execution context
```

这比把 Workflow State 放进：

```text id="dpss1s"
Agent process memory
```

可靠很多。

Microsoft 当前也明确区分 hosting 与 protocol：self-hosting 时 application 自己负责 routing、identity、authorization、storage、deployment 和 scaling；长运行 orchestration 则可以使用 durable infrastructure。([learn.microsoft.com](https://learn.microsoft.com/en-us/agent-framework/hosting/)

---

# 103. Control Plane 与 Runtime 可以独立扩缩容

例如：

```text id="h5okb4"
Control Plane:
    100 req/s

Runtime:
    1000 concurrent agents
```

或者：

```text id="id9y0x"
Runtime GPU / CPU burst
```

而 Control Plane：

```text id="f8yykh"
steady
```

这种部署灵活性也是分层的直接收益。

---

# 104. Control Plane 的高可用等级应该更高

Runtime：

```text id="u8u5h6"
某个 Agent Pod 挂了
```

影响：

```text id="lkoq7s"
一个 Execution
```

Control Plane：

```text id="1r9o6m"
挂了
```

可能影响：

```text id="n74uxw"
整个 Agent Platform
```

所以：

> **Control Plane 是比 Runtime 更关键的基础设施。**

金融平台尤其应该：

```text id="g7l9fn"
multi-AZ
backup
DR
immutable audit
```

---

# 105. Control Plane 的数据库也不应该与 Runtime Memory 混用

建议：

```text id="0v42w6"
Control DB
    workflow
    policy
    execution
    approvals
    commands
    audit refs
```

Runtime：

```text id="jsso53"
Runtime Store
    session
    context
    ephemeral memory
    tool cache
```

必要时：

```text id="hyjnqu"
object store
vector store
```

独立。

---

# 106. Control Plane 可以拥有自己的 Event Bus

例如：

```text id="3t3e2y"
ExecutionCreated
TaskCompleted
ReviewRequested
ApprovalGranted
CommandExecuted
ExecutionFailed
```

Runtime 消费：

```text id="x7s4m3"
TaskAssigned
```

并返回：

```text id="k2n6sv"
TaskCompleted
```

形成：

```text id="j1l8m2"
Control Event
     ↕
Runtime Event
```

但是业务状态最终仍由：

```text id="vafqf7"
Control Plane
```

持有。

---

# 107. Event-driven Control Plane 比同步 API 更适合长流程

同步：

```text id="dh6c0t"
POST /run
    → wait
```

异步：

```text id="yq0ty1"
ExecutionCreated
       ↓
TaskStarted
       ↓
TaskCompleted
       ↓
WorkflowAdvanced
```

更适合：

* HITL；
* Long-running Agent；
* Retry；
* Recovery；
* External callback；
* Queue-based scaling。

---

# 108. 但不要把 Control Plane 完全做成 Eventual Consistency

金融业务需要特别注意：

```text id="7au8bo"
最终一致
```

并不意味着：

```text id="17vmlz"
authorization
approval
state transition
```

可以随便有延迟。

关键控制点仍应该使用：

```text id="5c8v4c"
strong consistency
CAS
transaction
```

特别是：

```text id="g57t35"
Approval
Command
State Transition
Idempotency
```

---

# 109. Control Plane 的最终一致部分可以放在哪里

可以接受：

```text id="bcqv48"
metrics
analytics
search index
non-critical telemetry
```

有少量延迟。

不建议：

```text id="n4b2qv"
Policy Decision
Approval State
Authorization
Command State
```

依赖异步最终一致而没有最后验证。

---

# 110. 最重要的一条：Runtime 可以失败，Control Plane 不应失去事实

例如：

```text id="dr1g8v"
Runtime crash
```

必须仍然知道：

```text id="90smrj"
currentNode = compliance
taskStatus = waiting
approval = pending
```

这样：

```text id="0ikn2s"
recovery
```

才能继续。

---

# 111. Control Plane 是系统的“Memory of Responsibility”

Agent Runtime 记住：

```text id="8x0vw3"
what it has seen
what it tried
```

Control Plane 记住：

```text id="9pm87o"
who authorized
what state
what policy
what was allowed
what command was approved
what changed
```

因此：

> **Runtime 保存工作上下文；Control Plane 保存责任上下文。**

这句话很适合成为整个设计的核心原则。

---

# 112. 另一个核心原则：Control Plane 保存“Authority State”

例如：

```text id="v9rk4p"
Agent:
    research-agent

Capability:
    research.read

Workflow:
    investment-review@v13

Node:
    research

Approval:
    pending

Command:
    publish
    denied
```

这些都是：

```text id="7lx0po"
Authority State
```

而不是：

```text id="r8a9yr"
Agent Context
```

---

# 113. Runtime 不能修改 Authority State

例如：

```text id="b0nr0h"
Runtime:
    “I need publish capability.”
```

允许提出请求。

但：

```text id="j4p6ap"
Control Plane:
    grant / deny
```

决定。

这保证：

```text id="ts5rgi"
Privilege Escalation
```

不会发生在 Runtime 内部。

---

# 114. Control Plane 应支持 Policy-as-Code

例如：

```text id="2szm52"
Policy:
    @command publish
    role: investment.reviewer
```

可以编译为：

```text id="3d8vqi"
Authorization Decision
```

这样：

```text id="65pbe0"
Policy
```

和：

```text id="16lmbv"
Runtime
```

完全解耦。

AWS Cedar/Verified Permissions 的理念也是让 Authorization Logic 与 Application / Business Logic 分离，这里同样适用于 Agent Control Plane。

---

# 115. Control Plane 也可以逐步独立于 Workflow

例如：

```text id="7ohgzv"
Workflow
    → asks Policy
```

而不是：

```text id="auvew1"
Workflow
    = Policy
```

这意味着未来：

```text id="5vx61i"
Another application
```

也可以使用：

```text id="5j5r4t"
same Policy
```

从而形成：

```text id="iofzx9"
Enterprise Agent Policy Plane
```

---

# 116. Enterprise Agent Platform 可以最终形成三个核心 Plane

从企业架构角度，我更推荐最终抽象成：

```text id="68c5zv"
┌──────────────────────────────────────┐
│          Control Plane               │
│                                      │
│ Identity / Policy / Workflow / HITL  │
│ Capability / Command / Audit         │
└──────────────────┬───────────────────┘
                   │
              Runtime Plane
                   │
┌──────────────────▼───────────────────┐
│          Agent Runtime               │
│                                      │
│ Agent / Model / Memory / Tools       │
└──────────────────┬───────────────────┘
                   │
                 Data Plane
                   │
┌──────────────────▼───────────────────┐
│          Enterprise Systems          │
│                                      │
│ Domain APIs / Data / SaaS / MCP      │
└──────────────────────────────────────┘
```

这三个 Plane 分别回答：

```text id="3e1c4g"
Control Plane
    → Can?

Runtime Plane
    → How?

Data Plane
    → What is actually changed/read?
```

---

# 117. Control Plane / Runtime / Data Plane 不是传统 IAM + App + DB 的简单重命名

区别在于：

```text id="8v4yhz"
Agent Runtime
```

有主动性。

它不是：

```text id="fy1ftq"
ordinary application code
```

所以 Control Plane 必须特别关注：

```text id="hl5hvq"
autonomy
loop
planning
tool choice
delegation
memory
```

这些是传统应用中不存在或者弱很多的因素。

AWS Agentic AI Lens 也正是因为 Agent 的“自主操作”特性，额外引入了 Agent Identity、Goal Alignment、Memory、Multi-Agent Security、Human Oversight、Observability 等 controls。([docs.aws.amazon.com](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/security.html)

---

# 118. Control Plane 是“约束自主性”的系统

可以把它归纳成：

```text id="t90h5b"
Agent Autonomy
       +
Control Plane
       =
Bounded Autonomy
```

不是：

```text id="7qa8el"
Agent Autonomy
       +
Prompt
       =
Safe Agent
```

这正是 AWS 当前 Agentic AI Security 的核心设计思想之一。([docs.aws.amazon.com](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/design-principles.html)

---

# 119. Control Plane 与 Governance Plane 是否还要再分？

大型金融机构可以进一步拆：

```text id="xwvn1a"
Control Plane
    ↓
Governance Plane
```

Governance 包括：

```text id="5a6tqx"
Agent Approval
Risk Classification
Model Inventory
Tool Inventory
Policy Approval
Evaluation
Evidence
Regulatory Mapping
```

而 Control Plane 负责：

```text id="rj8j0v"
runtime enforcement
```

但不建议一开始就物理拆成两个系统。

逻辑上分开即可。

---

# 120. “Registry”是 Governance 与 Runtime 的桥

例如：

```text id="a7l4t7"
Agent Registry
Tool Registry
Skill Registry
Capability Registry
Workflow Registry
Policy Registry
Model Registry
```

它们是：

```text id="m1yap9"
Governance Source of Truth
```

Runtime 通过：

```text id="j4d7u1"
resolve()
```

得到：

```text id="0v1y3g"
effective execution configuration
```

这是很强的平台抽象。

---

# 121. 为什么不能让 Runtime 自己读取 Git

错误：

```text id="65arw3"
Runtime
   ↓
git clone
   ↓
read SKILL.md
   ↓
execute
```

这样：

```text id="1r5x8u"
Runtime
```

同时拥有：

```text id="xm51zn"
code source
workflow definition
skill definition
policy definitions
```

难以控制。

更好：

```text id="6r82bq"
Control Plane
   ↓
validated artifact
   ↓
Runtime
```

---

# 122. Artifact Promotion 应由 Control Plane 负责

例如：

```text id="zv08mx"
SKILL.md
```

生命周期：

```text id="m6x84g"
Draft
 ↓
Validated
 ↓
Approved
 ↓
Published
 ↓
Runtime-compatible
```

Runtime 不应该直接决定：

```text id="tl3r1p"
which version becomes production
```

---

# 123. Control Plane 是真正的 Agent Supply Chain

完整链：

```text id="9r8l37"
Agent Code
Skill
Prompt
Workflow
Policy
Capability
Tool
Model
```

全部要：

```text id="12gn8c"
version
owner
approval
artifact hash
release
rollback
```

AWS 已明确把 Agent behavior 当作 code，要求这些行为组件进行版本控制、审查、测试、分阶段发布和回滚。([docs.aws.amazon.com](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/design-principles.html)

---

# 124. Runtime 只是消费这些被治理后的 Artifact

例如：

```text id="x1g0ou"
Control Plane resolves:

Agent:
    research-agent@v4

Skill:
    investment-research@v8

Workflow:
    investment-review@v13

Policy:
    publish-policy@v4

Model:
    approved-model@2026-09
```

然后 Runtime：

```text id="9sb4co"
runs them
```

---

# 125. 这样可以形成完整 Provenance

一次 Execution：

```text id="qeqav1"
Execution #84721

Agent:
    research-agent@v4

Runtime:
    copilot-runtime@v3

Skill:
    investment-research@v8

Workflow:
    investment-review@v13

Policy:
    publish-policy@v4

Model:
    model-x@v7
```

这对：

* Model Risk；
* Audit；
* Incident Investigation；
* Reproducibility；

非常重要。

---

# 126. Agent Runtime 可以产生 Telemetry，但不能定义 Audit Semantics

例如：

```text id="qrdq5k"
tool.called
model.completed
agent.turn.completed
```

Runtime 可以产生。

但：

```text id="rjv3u0"
investment.publish.approved
```

应该来自：

```text id="8l9m71"
Control Plane
```

因为：

> **业务意义不是 Runtime 自己决定的。**

---

# 127. 一个很实用的 Event Ownership 规则

```text id="m9kzq5"
Runtime owns:
    runtime events

Control Plane owns:
    control events

Domain owns:
    business events
```

例如：

```text id="sx0jtk"
Runtime:
    model.call.completed

Control:
    policy.allowed

Control:
    review.approved

Control:
    command.authorized

Domain:
    investmentIdea.published
```

这样 Audit 更清楚。

---

# 128. Runtime 的 Observability 与 Control Plane 的 Audit 要关联

共同使用：

```text id="z9zh34"
correlationId
executionId
taskId
commandId
```

例如：

```text id="pae5do"
Business Case
  ↓
Execution
  ↓
Runtime Trace
  ↓
Human Task
  ↓
Command
```

但存储体系：

```text id="bvzkl7"
可以不同
```

这符合前面 Audit / Observability 分离的设计。

---

# 129. Control Plane 与 Agent Runtime 的测试重点不同

### Control Plane

测试：

```text id="aq0yex"
Policy
Workflow
Authorization
HITL
CAS
Idempotency
Audit
Containment
```

应该尽量：

```text id="opb2p8"
deterministic
```

### Runtime

测试：

```text id="6k4g6x"
quality
tool use
reasoning
latency
memory
model performance
```

可以：

```text id="8a2hb3"
probabilistic evaluation
```

这样测试体系也分开了。

---

# 130. Control Plane 应该有更强的 SLO

例如：

```text id="fewcsg"
Policy Decision:
    p99 < 50ms

Capability Resolution:
    p99 < 100ms

Workflow State Transition:
    p99 < 100ms
```

Runtime：

```text id="9rrc1x"
Research Task:
    p95 < 30s
```

这意味着：

```text id="x42xwy"
AI Slow
```

不会影响：

```text id="7c2sbr"
Control Plane correctness
```

---

# 131. Control Plane 也必须避免“被 Agent 阻塞”

错误：

```text id="4e8h2c"
Policy service
   ↓
call LLM
   ↓
ask model whether action is allowed
```

这就把：

```text id="fc1tpu"
Control Plane
```

又交给 Runtime。

原则：

> **关键 Control Plane Decision 应优先使用确定性机制。**

LLM 可以提供：

```text id="b2k1ro"
recommendation
classification
evidence
```

但最终：

```text id="egpiz7"
authorization
state transition
approval requirement
```

应尽量 deterministic。

---

# 132. Control Plane 不能完全没有 AI

这里也需要避免另一种极端。

例如：

```text id="h6l1f0"
Risk Classification
```

可以使用 AI 做：

```text id="3ixkp7"
candidate classification
```

但最终：

```text id="za3r7i"
approved risk tier
```

应该通过：

```text id="q5n47z"
validated policy / business rule
```

确定。

也就是：

```text id="6cy3ak"
AI-assisted Control
```

而不是：

```text id="3f6bq8"
AI-owned Control
```

---

# 133. Control Plane 的“AI 辅助”与“AI 决定”需要明确区分

### AI-assisted

```text id="mvgoa0"
Agent:
    recommends high risk.

Policy:
    deterministic final decision.
```

### AI-owned

```text id="nqk6cn"
Agent:
    decides high risk.
    decides approval.
    decides transition.
```

金融平台推荐前者。

---

# 134. 典型反模式一：God Agent

```text id="v4zg9j"
One Agent
    ↓
all tools
all data
all workflows
all commands
```

问题：

```text id="7054e5"
Blast Radius huge
Governance impossible
Testing difficult
Audit complicated
```

AWS 明确推荐 decomposing workloads into specialized, bounded agents。([docs.aws.amazon.com](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/design-principles.html)

---

# 135. 典型反模式二：Runtime-Owned Workflow

```text id="yvh1pk"
Agent Runtime
    ↓
LLM
    ↓
next_node()
```

问题：

```text id="3zj4d7"
business process = model output
```

---

# 136. 典型反模式三：Runtime-Owned Authorization

```text id="h5m9hs"
Agent:
    "I think user can do this."
```

问题：

```text id="a1c9s7"
authorization = probabilistic
```

---

# 137. 典型反模式四：Runtime-Owned Approval

```text id="h9rvck"
Agent:
    "Compliance approved."
```

问题：

```text id="bcn42u"
no human authority
no audit
no SoD
```

---

# 138. 典型反模式五：Runtime-Owned Business State

```text id="gyw0eg"
Agent
   ↓
database.update()
```

问题：

```text id="d9j7xy"
bypasses
Policy
Workflow
Domain
Audit
```

---

# 139. 典型反模式六：Control Plane 直接调用每个模型

```text id="5c46x3"
Workflow Service
   ↓
OpenAI
   ↓
Anthropic
   ↓
Copilot
```

问题：

```text id="x0x2jj"
control logic tied to runtime implementation
```

应该：

```text id="gsvt9h"
Control Plane
    ↓
Runtime Contract
    ↓
Runtime Adapter
```

---

# 140. 典型反模式七：每个 Runtime 自己实现 Policy

```text id="jzg6a2"
Copilot Runtime:
    permission code

DeepAgents Runtime:
    permission code

OpenAI Runtime:
    permission code
```

结果：

```text id="f8q0mg"
policy drift
```

应该：

```text id="1g9gqi"
Central Policy
```

---

# 141. 典型反模式八：Control Plane 成为巨型 ESB

另一个极端：

```text id="9epq4s"
Control Plane
    ↓
implements every business service
```

最后变成：

```text id="6h3zix"
God Control Plane
```

正确：

```text id="llvdcf"
Control Plane
    = controls

Domain APIs
    = business implementation
```

不要把 Domain 逻辑搬进 Control Plane。

---

# 142. 所以最终应该有三个 Authority

### Control Plane

```text id="w1o9jo"
Process Authority
Authorization Authority
Execution Authority
```

### Runtime

```text id="9vqew4"
Reasoning Authority
within bounded task
```

### Domain

```text id="8v3bq4"
Business Truth Authority
```

Human 还需要：

```text id="4i4t2j"
Decision / Accountability Authority
```

于是：

```text id="e8z63d"
Agent Runtime
    = how

Control Plane
    = allowed process

Human
    = accountable judgment

Domain
    = business truth
```

---

# 143. Control Plane 是“业务级 Agent Orchestrator”

注意：

```text id="d7stc5"
Control Plane
```

不一定负责：

```text id="x8m4ry"
every token
every tool thought
```

而是负责：

```text id="rxt1f6"
business execution
```

因此更准确：

> **Control Plane 是 Business Orchestrator；Agent Runtime 是 Task Orchestrator。**

这句话非常适合作为架构原则。

---

# 144. Business Orchestrator vs Task Orchestrator

### Business Orchestrator

```text id="czjj3k"
Research
↓
Compliance
↓
Approval
↓
Publish
```

### Task Orchestrator

```text id="p9gk13"
Research:
  search
  retrieve
  compare
  reason
  summarize
```

前者：

```text id="2rmjv5"
Control Plane
```

后者：

```text id="1h3tni"
Agent Runtime
```

---

# 145. 为什么这个划分特别适合金融

因为金融业务本身就是：

```text id="wib0x6"
Business Workflow
    +
Knowledge Work
```

前者需要：

```text id="4sgn0r"
determinism
```

后者需要：

```text id="d8a22m"
AI flexibility
```

因此：

```text id="zzj5ct"
Business Workflow
    = deterministic

Knowledge Work
    = agentic
```

正好天然适合 Control Plane / Runtime 分离。

---

# 146. 一个更完整的金融平台架构

```text id="ek3c9v"
                         BUSINESS APPS
                              │
                              ▼
                  ┌────────────────────────┐
                  │   AGENT CONTROL PLANE │
                  │                        │
                  │ Agent Registry         │
                  │ Workflow               │
                  │ Policy                 │
                  │ Authorization          │
                  │ Capability             │
                  │ Data Entitlement       │
                  │ HITL                   │
                  │ Command                │
                  │ State                  │
                  │ Audit                  │
                  │ Evaluation             │
                  │ Containment             │
                  └───────────┬────────────┘
                              │
                       Runtime Contract
                              │
                  ┌───────────▼────────────┐
                  │     AGENT RUNTIME      │
                  │                        │
                  │ Planner                │
                  │ LLM                    │
                  │ Memory                 │
                  │ RAG                    │
                  │ Tool Selection         │
                  │ Sub-agents             │
                  └───────────┬────────────┘
                              │
                        Tool Gateway
                              │
                  ┌───────────▼────────────┐
                  │      DATA / DOMAIN     │
                  │                        │
                  │ Domain APIs             │
                  │ Search                 │
                  │ MCP                    │
                  │ Databases              │
                  │ SaaS                   │
                  └────────────────────────┘
```

---

# 147. 这套架构对企业平台的一个巨大好处

可以建立统一的：

```text id="t3l0l8"
Agent Runtime Marketplace
```

例如团队可以选择：

```text id="z6v2j8"
Runtime A:
Copilot SDK

Runtime B:
DeepAgents

Runtime C:
Custom

Runtime D:
OpenAI
```

但必须满足：

```text id="2n70l7"
Control Plane Contract
```

就可以接入。

于是：

> **平台创新发生在 Runtime；企业治理稳定在 Control Plane。**

---

# 148. Runtime 甚至可以是外部 SaaS

如果：

```text id="nns0n8"
Control Plane
```

只向 Runtime 暴露：

```text id="ecb6ly"
bounded Task
```

那么 Runtime 甚至可以：

```text id="wfn1a8"
external managed service
```

只要：

```text id="2b0u2w"
identity
data boundary
capability
audit
```

仍然由 Control Plane / Gateway 控制。

这也给企业未来：

```text id="s1p7k5"
Buy vs Build
```

更多选择。

---

# 149. Control Plane 可以成为企业 Agent 的“平台契约”

不同业务团队最终只需要声明：

```text id="ydxk37"
Agent
Workflow
Capabilities
Data Scope
Policy
Approval
```

而平台统一提供：

```text id="j3wbq4"
Identity
Runtime
Execution
Audit
Observability
Scaling
Containment
```

这才真正形成：

> **Enterprise Agent Platform。**

---

# 150. 最终设计原则

可以浓缩成 15 条：

```text id="7x5j1w"
1. Agent Runtime is an execution engine, not an enterprise control plane.

2. Control Plane owns identity, workflow, policy, capability and authority.

3. Runtime owns reasoning, planning, memory and local tool orchestration.

4. Runtime requests; Control Plane authorizes.

5. Runtime returns task results; Control Plane owns business state transitions.

6. Execution state must survive Runtime failure.

7. Human approvals belong to durable Control Plane state.

8. High-risk side effects must cross Control Plane / Policy boundaries.

9. Tool and data authorization must be externally enforceable.

10. Agent Runtime must be replaceable without changing business control semantics.

11. Session state and business execution state must be separate.

12. Runtime permissions should be short-lived and execution-scoped where practical.

13. Kill switch and containment must work independently of Runtime health.

14. Control Plane artifacts must be versioned, reviewable and auditable.

15. Runtime innovation should be fast; Control Plane semantics should be deliberately stable.
```

---

# 151. 最值得记住的架构公式

```text id="k0t0p4"
Agent Platform
=
Control Plane
+
Runtime Plane
+
Data / Domain Plane
```

其中：

```text id="nn0xj9"
Control Plane
    = Can / When / Who / Whether

Runtime
    = How

Domain
    = What is true
```

再加 Human：

```text id="k3wz0g"
Human
    = Accountability
```

最终：

```text id="yq9k2p"
                ACCOUNTABILITY
                     │
                   HUMAN
                     │
                     ▼
                CONTROL PLANE
          ┌──────────┼──────────┐
          │          │          │
      Workflow     Policy     Command
          │          │          │
          └──────────┼──────────┘
                     │
               Runtime Contract
                     │
                     ▼
                AGENT RUNTIME
          ┌──────────┼──────────┐
          │          │          │
        Model      Memory      Tools
          │          │          │
          └──────────┼──────────┘
                     ▼
                 DATA / DOMAIN
                     │
                     ▼
              BUSINESS TRUTH
```

---

# 152. 最终结论

金融 Agent 平台最容易犯的架构错误，是把：

```text id="c6p0w6"
Agent Runtime
```

误认为：

```text id="c5u7ne"
Agent Platform
```

两者不是一回事。

Runtime 解决：

> **如何使用 AI 完成一个当前任务。**

Control Plane 解决：

> **这个任务为什么存在、谁允许它运行、它处于哪个业务状态、可以访问什么、可以执行什么、谁批准了、失败后如何恢复、最终发生了什么。**

因此最合理的企业 Agent 架构不是：

```text id="0q4os7"
Everything inside Agent
```

而是：

```text id="h4ax6x"
              Enterprise Agent System

       ┌─────────────────────────────┐
       │      Control Plane          │
       │                             │
       │  Identity                   │
       │  Workflow                   │
       │  Policy                     │
       │  Capability                 │
       │  HITL                       │
       │  Command                    │
       │  Audit                      │
       │  Governance                 │
       │  Containment                │
       └──────────────┬──────────────┘
                      │
                Runtime Contract
                      │
       ┌──────────────▼──────────────┐
       │       Agent Runtime         │
       │                             │
       │  LLM / Planning / Memory    │
       │  RAG / Tools / Reflection   │
       └──────────────┬──────────────┘
                      │
                Tool Gateway
                      │
       ┌──────────────▼──────────────┐
       │       Domain / Data         │
       └─────────────────────────────┘
```

最重要的一句话：

> **让 Runtime 足够自由地使用 AI，让 Control Plane 足够严格地控制业务，让 Domain 足够确定地维护事实。**

这三者分开以后，才真正可能同时实现：

```text id="o6j8a7"
AI Innovation
+
Enterprise Governance
+
Financial-grade Control
```

而不是三者互相牺牲。

---

# 153. 参考资料

**AWS — Agentic AI Lens, 2026**
AWS 2026 年版 Agentic AI Lens 明确覆盖 Agent Identity、Tool Authorization、Workflow Security、Human Oversight、Agent Observability、Multi-Agent Security、Containment、Reliability 和 Idempotency。([docs.aws.amazon.com](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentic-ai-lens.html) )

**AWS — Security Design Principles**
强调“Agent 本身不是 Trust Boundary”，所有输入和输出都应视为不可信；Agent 应使用独立身份和最小权限，并在 intent 与 action 之间叠加确定性 guardrails。([docs.aws.amazon.com](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/security-design-principles.html)

**AWS — Secure Agent Tool Usage**
要求每个 Tool Invocation 经过外部 Policy 授权，传播 Agent Identity 与 User Context，高风险 mutation 进入 Human-in-the-loop；Tool/MCP Registry 需要版本、数据分类和定期审查。([docs.aws.amazon.com](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentsec02.html)

**AWS — Agent Identity and Permission Management**
区分 Agent Identity 与 Human Identity，支持用户委托上下文、最小权限、短期凭证、权限边界和持续 drift review。([docs.aws.amazon.com](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentsec03.html)

**AWS — Workflow Orchestration Security**
明确指出 orchestration layer 是重要安全边界，应保护 workflow definition、execution state、state transitions，并记录足够信息重建执行路径。([docs.aws.amazon.com](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentsec06-bp02.html)

**AWS — Design Principles**
提出 bounded agents、end-to-end traceability、Agent behavior as code、proportionate human oversight、explicit contracts 等设计原则。([docs.aws.amazon.com](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/design-principles.html)

**Google Cloud — Agent Identity / Agent Gateway**
2026 年 Google Cloud 将 Agent Identity 作为一等 principal，并通过 Agent Gateway 对 agent-to-agent、agent-to-tool 通信提供集中式 policy enforcement。([cloud.google.com](https://cloud.google.com/blog/products/identity-security/whats-new-in-iam-security-governance-and-runtime-defense)

**Google Cloud — Agentic AI Architecture Components**
将 Agent Runtime、Agent tools、memory、model runtime、application framework 等作为不同架构组件，并强调多 Agent 场景需要精确的 access control 和可靠 orchestration。([cloud.google.com](https://docs.cloud.google.com/architecture/choose-agentic-ai-architecture-components)

**Google Cloud — Agent Design Patterns**
明确区分 deterministic workflow 和 dynamic agent orchestration；对于预定义、结构化流程，不一定需要完整 Agentic Workflow。([cloud.google.com](https://docs.cloud.google.com/architecture/choose-design-pattern-agentic-ai-system)

**Microsoft Agent Framework — Workflow Concepts**
Workflow 提供显式、可检查的执行路径，连接 Executors、Edges、Events、State，并支持 Agent Executor 嵌入 Workflow。([learn.microsoft.com](https://learn.microsoft.com/en-us/agent-framework/concepts/workflows/)

**Microsoft Agent Framework — Agents in Workflows**
直接展示如何把 specialized AI agents 作为 Workflow 的执行步骤，而不是把 Agent 本身变成整个流程控制器。([learn.microsoft.com](https://learn.microsoft.com/en-us/agent-framework/workflows/agents-in-workflows)

**Microsoft Agent Framework — HITL / Checkpoint**
HITL request、response、checkpoint、pending requests 和 resume 都属于 Workflow Runtime 的持久化能力。([learn.microsoft.com](https://learn.microsoft.com/en-us/agent-framework/workflows/human-in-the-loop) ([learn.microsoft.com](https://learn.microsoft.com/en-us/agent-framework/workflows/checkpoints) )

**Microsoft Agent Framework — Hosting**
明确将 hosting、protocol、routing、identity、authorization、storage、deployment、scaling 分开，展示 Agent Runtime 与平台基础设施职责的不同。([learn.microsoft.com](https://learn.microsoft.com/en-us/agent-framework/hosting/)

**Anthropic — Building Effective Agents**
将 Workflow 与 Agent 明确定义为两类不同架构：Workflow 使用预定义代码路径；Agent 让 LLM 动态控制流程和工具使用，并建议按任务实际需要选择最简单的模式。([anthropic.com](https://www.anthropic.com/engineering/building-effective-agents)

**FSB — Sound Practices for Responsible AI Adoption, 2026**
2026 年 FSB 提出覆盖金融机构 AI 生命周期和组织治理的 12 类 sound practices，并特别讨论这些实践是否足以覆盖 GenAI 和 agentic AI 的新复杂性。([fsb.org](https://www.fsb.org/2026/06/sound-practices-for-responsible-adoption-of-artificial-intelligence-ai-consultation-report/)

**FSB — 2026 Consultation Responses**
截至 2026 年 8 月，FSB 已公开收到包括多家银行、交易所、资产管理机构、保险机构和金融基础设施机构在内的大量咨询反馈，说明 Agentic AI 治理正在从概念进入机构级治理讨论。([fsb.org](https://www.fsb.org/2026/08/public-responses-to-consultation-on-sound-practices-for-responsible-adoption-of-artificial-intelligence-ai/)

这类问题已经可以从“AI 理论”进一步落到一个比较具体的 **Agent Reliability Engineering / Agent Assurance** 体系了。

现在其实已经出现了几套可以直接拿来用的框架，但它们解决的是不同层次的问题。最接近你说的“**AWS Well-Architected 式完整架构 Review Checklist**”的，是 **AWS Well-Architected Agentic AI Lens 2026**；但它仍然不是一份可以直接拿来做金融 Agent Architecture Review 的最终清单。最实用的做法，是以它为骨架，再叠加 OWASP Agentic Security、NIST AI RMF，以及具体的 Agent Eval/Observability 工具。

下面我把它进一步收敛成一套实际可用于 **设计、Architecture Review、CI/CD、上线审批、生产监控** 的方法。

---

# 一、先说结论：现在已经有“半套标准”，但没有一套能直接覆盖金融 Agent 的完整标准

目前比较成熟的东西可以分成四层：

| 层次                                 | 推荐框架 / Solution                                           | 主要解决什么                                           |
| ---------------------------------- | --------------------------------------------------------- | ------------------------------------------------ |
| Architecture Review                | **AWS Well-Architected Agentic AI Lens**                  | Agent 整体架构                                       |
| AI Governance                      | **NIST AI RMF / Playbook**                                | AI 风险治理、生命周期                                     |
| Agent Security                     | **OWASP Top 10 for Agentic Applications 2026**            | Agent 安全风险                                       |
| Agent Architecture / Control Plane | **CSA AI Agents: Architecture and Control Plane**         | Agent Control Plane、执行与治理                        |
| Evaluation / Observability         | **LangSmith / AgentCore / Microsoft Foundry / Vertex AI** | Eval、Trace、Regression、Production Monitoring      |
| CI / Code-level Eval               | **DeepEval**                                              | Agent trajectory、tool use、RAG、custom metrics     |
| Security / Red Team                | **Promptfoo**                                             | Prompt injection、tool misuse、trajectory security |
| Enterprise AI Management           | **ISO/IEC 42001**                                         | 组织层面的 AI Management System                       |

其中：

**AWS Agentic AI Lens 是最接近你说的“AI Agent 版 AWS Well-Architected Checklist”。**

AWS 在 2026 年正式把 Agentic AI Lens 做成六个 Well-Architected pillars，并明确说明它可以直接用于新系统设计、现有部署 Review、可靠性/安全/成本评估和建立企业内部 Agent 标准。还可以导入 AWS Well-Architected Tool 做正式 Review。([AWS Documentation][1])

但是，我不建议直接拿 AWS Lens 原封不动做金融 Agent Review。

原因很简单：

> AWS Lens 解决的是“一个 Agent 系统怎样才比较合理”，而金融 Architecture Review 还要回答“这个 Agent 能不能影响什么业务状态，以及证据够不够”。

这两者不是同一个问题。

---

# 二、如果是你们这种金融 Agent 平台，我建议最终形成“三层 Checklist”

不要把所有问题堆成一张 200 项大表。

应该分成：

```text
                    Agent Assurance Review
                           │
          ┌────────────────┼────────────────┐
          │                │                │
      Architecture      Runtime           Evidence
          │                │                │
          ▼                ▼                ▼
       能不能这样建       跑起来安全吗      我怎么证明它工作正确
```

也就是：

## Layer 1：Architecture Review

回答：

> 这个 Agent 应该怎么设计？

## Layer 2：Runtime Control Review

回答：

> 这个 Agent 在生产环境有没有办法失控？

## Layer 3：Evidence / Evaluation Review

回答：

> 你凭什么证明它真的工作？

这第三层正是很多 Agent Review 缺少的地方。

---

# 三、第一层：Architecture Review

这里可以直接以 AWS Agentic AI Lens 为骨架。

AWS 当前 Lens 的六个 pillar 是：

```text
1. Operational Excellence
2. Security
3. Reliability
4. Performance Efficiency
5. Cost Optimization
6. Sustainability
```

其中对 Agent 最重要的不是 Cost/Sustainability，而是：

```text
Operational Excellence
Security
Reliability
```

AWS 当前特别强调几个 Agent 特有问题：

* Agent behavior 是 stochastic 的
* Agent 会自主调用 Tool
* Agent 会持久化 Memory
* Agent 会跨服务/Agent 协作
* 单次请求可能变成多个 LLM / Tool / Memory 操作

因此传统应用的“HTTP request 成功率”远远不够。([AWS Documentation][1])

---

# 四、我建议增加一个非常重要的 Architecture Review 入口

在进入任何技术问题之前，先问：

### A0：这个东西到底是什么？

```text
1. 它解决什么业务问题？
2. Agent 真正负责什么？
3. 哪些事情仍然必须由传统业务系统负责？
4. Agent 是建议者、分析者，还是执行者？
5. Agent 是否能够修改 Business State？
6. 最严重的错误是什么？
7. 最坏情况下，它能造成什么业务后果？
8. 是否存在不可逆操作？
9. 哪些地方必须有人批准？
```

这一组问题极其重要。

AWS 当前也要求 Agent 有明确的 purpose、scope、autonomy boundary 和 measurable success criteria。([AWS Documentation][2])

---

# 五、Agent Architecture Review Checklist V1

我会把核心清单设计成下面这样。

不是所有项目都需要全部通过。

但每项必须有：

```text
Status:
PASS
PARTIAL
FAIL
N/A
```

并且每个 FAIL 必须回答：

```text
Risk
Impact
Mitigation
Owner
```

---

## Domain 1：Agent Purpose & Boundary

### A1. Business Purpose

* [ ] Agent 是否有明确业务目标？
* [ ] 是否定义 measurable success criteria？
* [ ] 是否明确“不负责什么”？
* [ ] 是否定义 autonomy level？
* [ ] 是否定义 human escalation 条件？
* [ ] 是否定义最大允许错误后果？

### A2. Business Boundary

* [ ] Agent 是否直接拥有 Business State？
* [ ] Agent 是否可以直接写 DB？
* [ ] Agent 是否可以直接调用高风险业务 API？
* [ ] 是否存在 Command / Service Boundary？
* [ ] Agent 是否可能绕过已有业务规则？

### A3. Responsibility

* [ ] Agent 负责 reasoning / proposal？
* [ ] Workflow 负责 orchestration？
* [ ] Policy 负责 authorization？
* [ ] Business API 负责 business invariants？
* [ ] Executor 负责 side effect？

这里要特别检查：

```text
LLM
↓
Tool
↓
直接改变业务状态
```

如果出现，应当重点 review。

---

# 六、Domain 2：Deterministic Boundary

这是我建议比 AWS checklist 再加强的一层。

问题是：

> **哪些事情根本不应该让 LLM 决定？**

### A4. Deterministic Logic

* [ ] 金融计算是否由 deterministic engine 完成？
* [ ] 权限是否由 Policy / IAM / Authorization Layer 决定？
* [ ] eligibility 是否由 deterministic rule 判断？
* [ ] limit 是否由 Rule Engine 判断？
* [ ] business state transition 是否由业务系统决定？
* [ ] idempotency 是否由系统控制？
* [ ] schema validation 是否独立于 LLM？

可以形成：

```text
LLM
负责：

Understand
Plan
Propose
Explain

Deterministic system
负责：

Calculate
Authorize
Validate
Apply Rule
Mutate State
```

这是整个 Agent 可靠性架构最核心的边界之一。

---

# 七、Domain 3：Evidence & Grounding

这里开始进入你上一轮讨论的核心。

### A5. Data Source

* [ ] Agent 使用哪些数据？
* [ ] 哪些是 authoritative source？
* [ ] 哪些只是辅助信息？
* [ ] 是否有 source priority？
* [ ] 是否有 freshness requirement？
* [ ] 是否有 conflicting source policy？

### A6. Retrieval

* [ ] Retrieval 是否可观察？
* [ ] Retrieval query 是否记录？
* [ ] 返回了哪些 document？
* [ ] document version 是否记录？
* [ ] document timestamp 是否记录？
* [ ] 是否知道为什么某文档被选中？

### A7. Groundedness

* [ ] 关键 claim 是否必须有 evidence？
* [ ] 是否检查 claim ↔ evidence？
* [ ] 是否检查 citation 是否真正支持 claim？
* [ ] 是否检测 unsupported claim？
* [ ] 无 evidence 时是否允许输出？
* [ ] 是否存在 abstention path？

这里必须避免一个非常常见的问题：

```text
Citation exists
       ≠
Citation proves claim
```

---

# 八、Domain 4：Reasoning / Agent Behavior

这里不要试图 Review 模型的“思维过程”。

真正应该 Review：

```text
observable behavior
```

### A8. Tool Selection

* [ ] 是否调用了正确的 Tool？
* [ ] 是否调用了不必要的 Tool？
* [ ] 是否漏掉必要 Tool？
* [ ] Tool arguments 是否正确？
* [ ] Tool order 是否合理？
* [ ] 是否存在无限 loop？
* [ ] 是否存在重复调用？

Microsoft 当前 Agent Framework 已经把：

* tool selection
* tool input accuracy
* tool output utilization
* tool call success

分别作为 Agent Evaluation 指标。([Microsoft Learn][3])

DeepEval 也提供对应的 Tool Use / Tool Correctness metrics，可以直接针对完整 trajectory 或单个 Tool-call span 进行评估。([DeepEval][4])

---

# 九、Domain 5：Output Correctness

不要只有：

```text
Answer Accuracy
```

至少拆成：

```text
C1 Factual correctness
C2 Numerical correctness
C3 Groundedness
C4 Completeness
C5 Policy correctness
C6 Business correctness
```

例如：

```text
事实对
+
计算对
+
规则对
```

才算真正 Correct。

---

# 十、Domain 6：Agent Control

这里是金融场景非常重要的一层。

### A9. Authorization

* [ ] Agent identity 是什么？
* [ ] User identity 是否传播？
* [ ] Agent 与 User 是否区分？
* [ ] Data Entitlement 是否独立于 Prompt？
* [ ] Tool permission 是否独立于 LLM？
* [ ] MCP tool 是否受到 policy 控制？
* [ ] 默认是否 deny？

AWS Agentic AI Lens 明确强调 Agent Identity、least privilege、tool access 和 policy enforcement，而不是让 Prompt 成为安全边界。([AWS Documentation][1])

---

# 十一、Domain 7：High-risk Action

这里可以直接连接你前面“Command”那一系列设计。

### A10. High-risk Operation

* [ ] 哪些操作定义为 high risk？
* [ ] 是否定义 risk tier？
* [ ] 是否由 deterministic logic 分类？
* [ ] 是否要求 human approval？
* [ ] approval 是否绑定具体 action？
* [ ] action 是否 immutable？
* [ ] execution 前是否 re-validation？
* [ ] 是否有 resource version / concurrency control？
* [ ] 是否有 idempotency？
* [ ] 是否可以 revoke？
* [ ] 是否可以 kill switch？

AWS 当前明确建议 high-risk operations 在执行前进入 human review，并要求记录 reviewer identity、timestamp 等审计信息。([AWS Documentation][5])

---

# 十二、Domain 8：Failure / Recovery

这是传统软件和 Agent 差异很大的地方。

### A11. Failure Handling

检查：

```text
LLM Failure
Tool Failure
Retrieval Failure
Policy Failure
Network Failure
Timeout
Partial Result
Context Overflow
Provider Failure
External System Failure
```

每一个都需要回答：

```text
Retry?
Fallback?
Abort?
Escalate?
Resume?
```

AWS 当前 Agentic AI Lens 特别强调：

* checkpoint
* idempotent steps
* graceful degradation
* fallback
* failure injection
* recovery drills

而不是简单依赖 retry。([AWS Documentation][6])

尤其是：

> Retry + Side Effect = 必须考虑 Idempotency。

AWS 对 legacy integration 也直接把 idempotent task execution 作为独立最佳实践。([AWS Documentation][7])

---

# 十三、Domain 9：Observability

这是实际落地时最容易“买了产品但还是不知道发生了什么”的地方。

### A12. Trace

每次 Agent Execution 应至少能够关联：

```text
Execution ID
Session ID
User ID
Agent Version
Model
Model Version
Prompt Version
Skill Version
Tool Manifest
Policy Version
Trace ID
```

### A13. Runtime Trace

需要看到：

```text
LLM call
↓
Tool call
↓
Tool result
↓
Retrieval
↓
Policy decision
↓
Command
↓
Approval
↓
Execution
```

AWS 当前 Agentic AI Lens 已经明确要求 Agent trace 覆盖 reasoning steps、tool calls、memory operations、inter-agent handoffs，并维护 behavioral baseline。([AWS Documentation][8])

---

# 十四、Domain 10：Evaluation

这里是整个 checklist 最重要的一层。

我建议至少拆成：

```text
E1 Component Eval
E2 Trajectory Eval
E3 End-to-End Eval
E4 Regression Eval
E5 Security Eval
E6 Production Eval
```

AWS 当前 Agentic AI Lens 也明确要求 multi-layer testing，并要求 benchmark、dataset、prompt、scoring rubric 版本化，以及 rollback。([AWS Documentation][9])

---

# 十五、具体 Eval 应该测试什么？

至少建立：

| Eval                    | 检查                        |
| ----------------------- | ------------------------- |
| Output correctness      | 最终答案                      |
| Groundedness            | 是否被证据支持                   |
| Tool selection          | Tool 是否正确                 |
| Tool arguments          | 参数是否正确                    |
| Tool output utilization | 是否正确使用结果                  |
| Trajectory              | 整条执行路径                    |
| Task completion         | 是否完成目标                    |
| Step efficiency         | 是否出现无意义步骤                 |
| Policy compliance       | 是否越权                      |
| Authorization           | 是否访问不该访问的资源               |
| Safety                  | prompt injection / misuse |
| Business outcome        | 最终业务状态                    |
| Abstention              | 应该拒绝时是否拒绝                 |

这基本就是当前 AWS + Microsoft + Anthropic + DeepEval 等实践的交集。([Anthropic][10])

---

# 十六、不要把所有 Eval 都交给 LLM-as-a-Judge

这是实际实现时非常重要的一条。

应该优先：

```text
Deterministic assertion
        ↓
Rule-based evaluator
        ↓
Reference comparison
        ↓
LLM Judge
        ↓
Human review
```

例如：

### 不应该

```text
LLM Judge:
“这个用户是不是有权限？”
```

### 应该

```text
expectedEntitlement = false

actualToolCalls includes:
get_customer_portfolio(customer=123)

→ FAIL
```

DeepEval 当前甚至提供了完全 deterministic 的 `ToolPermissionMetric`，直接根据 allowlist/denylist 判断，零 token 成本，非常适合 CI gate。([DeepEval][11])

Promptfoo 当前也明确建议优先使用 deterministic assertions，例如 `equals`、`is-json`、JavaScript assertion，再使用 LLM rubric。([Promptfoo][12])

---

# 十七、这就可以形成一个真正能跑进 CI 的 Pipeline

例如：

```text
                    Git Commit
                         │
                         ▼
                ┌─────────────────┐
                │ Unit Test       │
                └────────┬────────┘
                         ▼
                ┌─────────────────┐
                │ Schema / Policy │
                │ Deterministic   │
                └────────┬────────┘
                         ▼
                ┌─────────────────┐
                │ Agent Eval      │
                │ Dataset         │
                └────────┬────────┘
                         ▼
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
      Outcome         Tool Use       Security
       Eval             Eval           Eval
          │              │              │
          └──────────────┼──────────────┘
                         ▼
                  Regression Gate
                         │
                 ┌───────┴───────┐
                 │               │
               FAIL            PASS
                 │               │
               Stop            Canary
                                 │
                                 ▼
                           Production
                                 │
                                 ▼
                       Online Evaluation
                                 │
                                 ▼
                       Drift / Anomaly
```

这已经不是“AI 实验”。

而是：

> **Agent CI/CD。**

---

# 十八、现成产品到底怎么选？

如果你问我实际工程上：

> “今天我不想自己造平台，直接引入什么？”

我会这么选。

## 方案 A：你们当前技术栈

你们现在已经是：

```text
FastAPI
+
DeepAgents
+
AgentCore
+
LangSmith
+
LiteLLM
```

我认为这里其实已经有非常好的基础。

不建议再额外引入一个“全新的 Agent Platform”。

建议变成：

```text
AgentCore
    ↓
Runtime / Identity / Policy / Observability

DeepAgents
    ↓
Agent execution

LangSmith
    ↓
Trace + Dataset + Eval + Regression

Custom deterministic layer
    ↓
Authorization
Business Rules
Command
Post-condition

Promptfoo
    ↓
Security / Red Team

pytest / custom code
    ↓
Deterministic CI gates
```

这是我最推荐的组合。

---

# 十九、为什么 LangSmith 目前已经足够作为主 Eval 平台？

因为它已经覆盖：

```text
Offline evaluation
Online evaluation
Benchmarking
Unit test
Backtesting
Regression
Pairwise comparison
LLM-as-judge
Code evaluator
Composite evaluator
Production monitoring
Anomaly detection
```

而且可以将 Production failure 转成新的 Dataset，形成：

```text
Production
 ↓
Bad Trace
 ↓
Dataset
 ↓
Regression Test
 ↓
Fix
 ↓
Re-run
```

这正是 Agent 最需要的闭环。([Docs by LangChain][13])

LangSmith 还可以对 Production traces 设置在线 evaluator，可以按照 Tool、Metadata、用户反馈等条件筛选需要检测的 trace。([Docs by LangChain][14])

对于你们已经在使用 LangSmith 的情况：

> **没有必要因为 Agent Evaluation 又引入 Braintrust / Langfuse。**

除非有非常具体的组织或部署需求。

---

# 二十、那 DeepEval 有什么价值？

DeepEval 最适合：

> **把 Agent Evaluation 变成工程师可以直接运行的 Python test。**

比如：

```text
tests/
  test_research_agent.py
  test_trade_agent.py
  test_proxy_vote_agent.py
```

里面直接：

```python
def test_trade_agent_never_submits_without_approval():
    ...
```

然后用：

```text
pytest
```

跑。

它比较强的地方是：

```text
Tool Correctness
Tool Use
Tool Permission
Task Completion
Step Efficiency
Plan Adherence
Hallucination
RAG Faithfulness
```

以及完整 trace 的 evaluation。([DeepEval][15])

所以我会把它定位成：

```text
LangSmith
= Evaluation Platform

DeepEval
= Evaluation Test Library
```

两者不是完全冲突。

但对于你们而言：

> **先不用引入 DeepEval。**

第一阶段直接：

```text
LangSmith dataset
+
pytest
+
custom deterministic evaluator
```

就够。

等发现：

> “我们不断在自己写 ToolCorrectness / Trajectory evaluator”

再考虑加 DeepEval。

---

# 二十一、Promptfoo 反而是我比较建议额外引入的

原因是它和 LangSmith 的职责差异很大。

LangSmith 更偏：

```text
Quality
Observability
Regression
Evaluation
```

Promptfoo 更适合：

```text
Security Testing
Red Team
Prompt Injection
Tool Misuse
Data Exfiltration
Boundary Violations
```

尤其当前 Promptfoo 已经支持 Agent trajectory evidence，例如检查：

```text
有没有调用 forbidden tool
tool arguments 是否越权
guardrail 是否真的在敏感 Tool 前生效
是否通过网络发送数据
```

并且可以把真实发现转成 regression test。([Promptfoo][16])

所以对于金融 Agent：

```text
LangSmith
       +
Promptfoo
```

是非常合理的组合。

---

# 二十二、AWS AgentCore 又是什么位置？

这里不要把 AgentCore 当成“又一个 Agent Eval 产品”。

对于你们，更适合作为：

```text
Runtime Control Plane
```

包括：

```text
Runtime
Identity
Gateway
Policy
Memory
Observability
Evaluation
```

AWS 当前 Agentic AI Lens 本身也是把这些能力作为 AgentCore 的一部分来定位的。([AWS Documentation][1])

因此：

```text
AgentCore
    = runtime / infrastructure / control

LangSmith
    = developer-facing trace / eval / regression

Promptfoo
    = adversarial security testing

Your own services
    = business authorization / command / business rules
```

这个边界很干净。

---

# 二十三、OWASP 2026 适合做 Security Checklist

OWASP 已经在 2025 年底发布了 **Top 10 for Agentic Applications**，2026 年继续维护和扩展。

它是一个非常适合拿来做：

```text
Security Architecture Review
```

的框架。

而且 OWASP 现在已经开始把 Agent Control Standard、Agentic Security Initiative 等内容整合起来。([OWASP Gen AI Security Project][17])

因此可以：

```text
AWS Agentic Lens
       ↓
Architecture baseline

OWASP Agentic Top 10
       ↓
Security baseline
```

---

# 二十四、CSA 2026 的 Control Plane 架构值得认真看

这个可能比传统 AI Governance 文档更贴近你现在的思路。

CSA 2026 年发布的 **AI Agents: Architecture and Control Plane** 已经给出一个比较完整的十层 Agent reference architecture，并将：

```text
Infrastructure
Intelligence
Knowledge
Agency
Environment
Execution
Governance
Accountability
```

组合成一个整体，还把 OWASP、NIST、CSA controls 放在同一个 control-plane 体系中。([Cloud Security Alliance][18])

这和你现在设计的：

```text
Agent Runtime
Control Plane
Policy
Execution
Audit
```

实际上非常接近。

---

# 二十五、NIST 不适合作为“操作 Checklist”，但适合做 Governance Overlay

这个区别非常重要。

NIST 自己明确说：

> AI RMF Playbook 不是 checklist，也不是必须逐项执行的步骤。([AIRC][19])

所以不要这样：

```text
NIST
↓
200个问题
```

而应该：

```text
NIST
↓
Govern / Map / Measure / Manage
```

然后把具体工程问题落到：

```text
AWS Lens
OWASP
Internal Checklist
```

这样更合理。

---

# 二十六、因此我建议你们最终建立自己的“四件套”

不是创造一个巨型标准。

而是：

### ① Agent Architecture Review

以：

> AWS Agentic AI Lens

为主。

### ② Agent Security Review

以：

> OWASP Top 10 for Agentic Applications 2026

为主。

### ③ Agent Evaluation Standard

自己建立一份：

> Agent Eval Standard

里面定义：

```text
Outcome
Groundedness
Tool
Trajectory
Policy
Business
Safety
```

### ④ Financial Agent Control Standard

自己定义：

```text
Identity
Data Entitlement
Action Authorization
Approval
Command
Business State
Audit Evidence
```

这个第四部分才是你们金融领域最重要的差异化。

---

# 二十七、最终可以形成你一直在做的“Agent Architecture Review Checklist”

我建议把它正式设计成：

## Agent Architecture Review Checklist v1.0

### 00. Context

```text
□ Business problem defined
□ Scope defined
□ Constraints defined
□ Buy vs Build considered
□ Regulatory / jurisdiction identified
□ Risk owner identified
□ Business owner identified
```

### 01. Agent Responsibility

```text
□ Purpose
□ Scope
□ Autonomy level
□ Success criteria
□ Failure criteria
□ Escalation criteria
```

### 02. Architecture

```text
□ Runtime
□ Workflow
□ Tool
□ Skill
□ Memory
□ Retrieval
□ Control Plane
□ Business System
```

### 03. Deterministic Boundary

```text
□ Calculation
□ Business Rule
□ Authorization
□ State Transition
□ Schema validation
□ Idempotency
```

### 04. Data

```text
□ Source of Truth
□ Data Entitlement
□ Retrieval
□ Freshness
□ Provenance
□ Conflict resolution
```

### 05. Agent Behavior

```text
□ Tool selection
□ Tool arguments
□ Tool results
□ Trajectory
□ Loop limits
□ Context limits
```

### 06. Security

```text
□ Identity
□ Least privilege
□ Prompt injection
□ Tool abuse
□ Data exfiltration
□ MCP security
□ Output filtering
```

### 07. High-risk Action

```text
□ Risk classification
□ Command
□ Authorization
□ Approval
□ Revalidation
□ Idempotency
□ Kill switch
```

### 08. Reliability

```text
□ Timeout
□ Retry
□ Fallback
□ Resume
□ Checkpoint
□ Partial failure
□ Dependency failure
□ Fault injection
```

### 09. Evaluation

```text
□ Golden dataset
□ Regression dataset
□ Deterministic assertions
□ LLM judge
□ Trajectory eval
□ Tool eval
□ Security eval
□ Business outcome eval
```

### 10. Observability

```text
□ Trace ID
□ Execution ID
□ Agent version
□ Model version
□ Prompt version
□ Tool version
□ Policy version
□ Retrieval provenance
□ Behavior baseline
```

### 11. Production

```text
□ Online evaluation
□ Drift detection
□ Anomaly detection
□ Alert
□ Rollback
□ Kill switch
□ Incident runbook
□ Post-incident dataset update
```

### 12. Governance

```text
□ Owner
□ Reviewer
□ Change approval
□ Versioning
□ Audit evidence
□ Model/provider lifecycle
□ Third-party dependency
□ Periodic review
```

---

# 二十八、再进一步：不要让所有问题都是“同等重要”

这份 Checklist 真正落地时，必须增加 **Risk Tier**。

否则很快会变成传统 Enterprise Architecture 最讨厌的东西：

> 200 个问题，每个项目都逐项打勾。

我建议：

```text
P0 — Must Pass
P1 — Required for Production
P2 — Recommended
P3 — Situational
```

例如：

### P0

```text
□ Authorization cannot be bypassed by LLM
□ High-risk action has independent policy check
□ Business state mutation has deterministic boundary
□ Critical tools have least privilege
□ Production trace is reconstructable
□ Rollback / kill switch exists
□ Critical outcomes have verification
```

### P1

```text
□ Regression dataset
□ Tool trajectory evaluation
□ Production online evaluation
□ Behavior versioning
□ Failure injection
□ Human escalation
```

### P2

```text
□ Pairwise evaluation
□ Sophisticated anomaly detection
□ Automated drift analysis
□ Multi-model comparison
```

这样就实用很多。

---

# 二十九、对于你们目前的平台，我会直接这样落地

结合你们当前：

```text
LiteLLM
FastAPI
DeepAgents
AgentCore
LangSmith
PostgreSQL / pgvector
```

不建议重新造框架。

### Architecture Review

```text
AWS Agentic AI Lens
        +
OWASP Agentic Top 10
        +
你们自己的 Financial Agent Checklist
```

### Runtime

```text
DeepAgents
        +
AgentCore
```

### Observability / Eval

```text
LangSmith
```

### Deterministic Checks

```text
pytest
+
custom evaluators
```

### Security Regression

```text
Promptfoo
```

### High-risk business operation

```text
CommandService
+
Policy
+
HumanTask
+
ApprovalPolicy
+
Idempotency
+
Post-condition
```

这个组合实际上已经足够形成一套相当完整的 Agent Assurance Platform。

---

# 三十、真正值得你们内部建立的不是“另一个 Agent Framework”

而是这个：

```text
                     Agent Assurance
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
     Design              Build             Operate
        │                  │                  │
        ▼                  ▼                  ▼
 AWS Agentic Lens      Eval CI            LangSmith
 OWASP                 pytest             AgentCore
 CSA                   DeepEval*          Monitoring
 Internal Financial    Promptfoo          Drift
 Checklist             Red Team           Incident
        │                  │                  │
        └──────────────────┼──────────────────┘
                           ▼
                  Financial Controls
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
          Identity     Entitlement    Command
              │            │            │
              └────────────┼────────────┘
                           ▼
                    Business System
```

其中 `DeepEval*` 是可选的，不建议一开始就增加。

---

# 三十一、我认为最重要的一个变化

前面关于“Agent 正确性”的讨论，如果真正落到 Architecture Review，可以收敛成一个非常简单的检查：

> **不要问“这个 Agent 聪不聪明”。**

而是问：

```text
1. What can it decide?
2. What can it access?
3. What can it do?
4. What proves the result is correct?
5. What stops it when it is wrong?
6. What evidence remains afterwards?
```

这六个问题实际上比一大堆 AI terminology 更有价值。

最终：

```text
Reasoning
    ≠
Authority

Output
    ≠
Fact

Citation
    ≠
Proof

Evaluation Score
    ≠
Business Correctness

Tool Call
    ≠
Authorization

Approval
    ≠
Execution

Trace
    ≠
Regulatory Evidence
```

如果把这些边界全部落实到架构中，Agent 就开始从“一个会调用工具的 LLM”变成一个可以真正进入金融生产系统的工程组件。

---

## 最值得直接采用的现成资源

**第一优先级：AWS Well-Architected Agentic AI Lens 2026**
最接近你说的 AWS Well-Architected checklist，而且现在已经明确覆盖 Design、Review、Production、Security、Reliability、Evaluation、Observability，并可以导入 AWS Well-Architected Tool。([AWS Documentation][1])
[AWS Well-Architected Agentic AI Lens](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentic-ai-lens.html?utm_source=chatgpt.com)

**第二优先级：OWASP Top 10 for Agentic Applications 2026**
适合作为 Security Review 的标准底稿。([OWASP Gen AI Security Project][17])
[OWASP Top 10 for Agentic Applications 2026](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/?utm_source=chatgpt.com)

**第三优先级：LangSmith Evaluation**
你们当前已经使用 LangSmith 的情况下，最省成本的方案是直接把它扩展成 offline regression + online evaluation + production feedback loop，而不是再换平台。([Docs by LangChain][13])
[LangSmith Evaluation Types](https://docs.langchain.com/langsmith/evaluation-types?utm_source=chatgpt.com)

**第四优先级：Promptfoo**
用来补 LangSmith 不擅长的 adversarial security / red-team / trajectory security regression。([Promptfoo][16])
[Promptfoo Agent Red Teaming](https://www.promptfoo.dev/docs/red-team/agents/?utm_source=chatgpt.com)

**第五优先级：CSA AI Agents: Architecture and Control Plane**
很适合拿来继续设计你们的 Agent Control Plane / Runtime / Governance 分层。([Cloud Security Alliance][18])
[CSA AI Agents: Architecture and Control Plane](https://cloudsecurityalliance.org/artifacts/ai-agents-architecture-and-control-plane?utm_source=chatgpt.com)

**NIST AI RMF** 更适合作为 governance overlay，而不是工程 checklist。NIST 自己也明确说明 Playbook 是建议集合而不是必须逐项执行的 checklist。([AIRC][19])

---

### 一个比较明确的判断

对于你们现在的平台，我不会推荐再引入一个完整的“Agent Evaluation Platform”来替代 LangSmith，也不会建议重新造一个类似 AWS AgentCore 的 Runtime。

真正值得补的是：

```text
AWS Agentic AI Lens
        ↓
Internal Agent Architecture Review Checklist

LangSmith
        ↓
Evaluation / Regression / Production

Promptfoo
        ↓
Security / Red Team Regression

Custom deterministic layer
        ↓
Authorization / Entitlement / Command / Business Verification
```

这样既不会过度设计，又能把前面讨论的“Agent 正确性、稳定性、Behavior Drift、Command、Audit”全部串起来。

[1]: https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentic-ai-lens.html "Agentic AI Lens - AWS Well-Architected - Agentic AI Lens"
[2]: https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentops01.html?utm_source=chatgpt.com "Operational practices for agentic AI systems - Agentic AI Lens"
[3]: https://learn.microsoft.com/en-us/agent-framework/agents/evaluation?utm_source=chatgpt.com "Evaluation | Microsoft Learn"
[4]: https://deepeval.com/docs/metrics-tool-use?utm_source=chatgpt.com "Tool Use | DeepEval - The LLM Evaluation Framework"
[5]: https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentsec04-bp02.html?utm_source=chatgpt.com "AGENTSEC04-BP02 Human-in-the-loop for critical decisions - Agentic AI Lens"
[6]: https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/reliability-design-principles.html?utm_source=chatgpt.com "Design principles - Agentic AI Lens"
[7]: https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentrel06.html?utm_source=chatgpt.com "Legacy system integration - Agentic AI Lens"
[8]: https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentops05.html?utm_source=chatgpt.com "Observability and monitoring for agentic systems - Agentic AI Lens"
[9]: https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentops06.html?utm_source=chatgpt.com "Testing, evaluation, and validation frameworks - Agentic AI Lens"
[10]: https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents?utm_source=chatgpt.com "Demystifying evals for AI agents \ Anthropic"
[11]: https://deepeval.com/docs/metrics-tool-permission?utm_source=chatgpt.com "Tool Permission | DeepEval - The LLM Evaluation Framework"
[12]: https://www.promptfoo.dev/docs/integrations/agent-skill/?utm_source=chatgpt.com "Agent Skills for Evals and Red Teaming | Promptfoo"
[13]: https://docs.langchain.com/langsmith/evaluation-types?utm_source=chatgpt.com "Evaluation types - Docs by LangChain"
[14]: https://docs.langchain.com/langsmith/online-evaluations-llm-as-judge?utm_source=chatgpt.com "Set up LLM-as-a-judge online evaluators - Docs by LangChain"
[15]: https://deepeval.com/docs/getting-started-agents?utm_source=chatgpt.com "AI Agent Evaluation Quickstart | DeepEval - The LLM Evaluation Framework"
[16]: https://www.promptfoo.dev/docs/red-team/agents/?utm_source=chatgpt.com "How to red team LLM Agents | Promptfoo"
[17]: https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/?utm_source=chatgpt.com "OWASP Top 10 for Agentic Applications for 2026 - OWASP Gen AI Security Project"
[18]: https://cloudsecurityalliance.org/artifacts/ai-agents-architecture-and-control-plane?utm_source=chatgpt.com "AI Agents: Architecture and Control Plane | CSA"
[19]: https://airc.nist.gov/airmf-resources/playbook/?utm_source=chatgpt.com "Playbook - AIRC"

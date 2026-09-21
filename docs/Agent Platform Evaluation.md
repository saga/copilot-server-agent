# 企业内部搭建 AI Agent 平台：Evaluation 是什么、为什么需要、怎么做以及数据如何准备

## 1. 前言：AI Agent 平台最容易被低估的不是 Runtime，而是 Evaluation

企业内部建设 AI Agent 平台，很容易把主要精力放在：

```text
Model Gateway
+
Agent Runtime
+
Tool / MCP
+
RAG
+
Memory
+
Workflow
+
Observability
```

但真正决定这个平台能不能从 PoC 走向生产的，往往不是 Agent 能不能运行，而是：

> **企业能不能知道一个 Agent 到底做得对不对、哪里做错了、为什么错、改完有没有变好，以及什么时候应该阻止它上线。**

这就是 Evaluation。

在传统软件中，测试通常回答：

```text
代码是否符合预期？
```

而 AI Agent 的问题更复杂：

```text
最终答案对不对？
检索到的资料对不对？
Tool 选对了吗？
Tool 参数对吗？
有没有漏掉必要步骤？
有没有调用不应该调用的 Tool？
有没有违反 Policy？
有没有泄露数据？
如果第一次失败，它会不会恢复？
同一个问题运行多次是否稳定？
换一个模型以后是否退化？
Prompt / Skill 修改以后是否破坏旧能力？
生产环境真实用户的问题是否仍然表现良好？
```

因此，企业 Agent Platform 的 Evaluation 不应该被理解成：

> 给模型打一个分。

更准确的定义是：

> **Evaluation 是对 AI 系统在特定业务目标、数据、环境、风险约束和控制要求下的行为与结果进行可重复测量，并将结果用于开发、发布、治理和生产监控的机制。**

NIST AI RMF 将这一类工作放在 `Measure` 和 `Manage` 中，强调 AI 系统需要在上线前测试、上线后持续测量，并建立可重复、可扩展、可记录的测试、评估、验证和确认（TEVV）过程；同时强调独立评估和部署环境中的真实性。

对于金融机构，Evaluation 也不能只看模型质量。英国央行 2026 年 AI Roundtable 已经明确指出，传统以“理解模型输入如何映射到输出”为中心的 Model Risk Management 方式，对于快速扩展的 GenAI 和 Agentic AI 并不完全可持续，风险管理需要更多转向对更广泛 AI 系统的测试、监控和 Guardrail。

所以：

```text
AI Agent Evaluation
≠
Model Benchmark
```

而应该是：

```text
                    Evaluation
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
      Model            Agent          Business
     Quality          Behavior         Outcome
        │                │                │
        └────────────────┼────────────────┘
                         ▼
                 Safety / Control
                         │
                         ▼
                 Production Monitoring
```

---

# 2. Evaluation 到底在评估什么

一个企业 Agent 通常不是一个模型，而是一整套系统：

```text
User
 ↓
Agent
 ↓
Prompt / Skill
 ↓
Model
 ↓
Retrieval
 ↓
Tool Selection
 ↓
Tool Execution
 ↓
Observation
 ↓
Reasoning
 ↓
Replanning
 ↓
Final Response / Action
```

因此至少有七个层次需要评估。

| 层次               | 核心问题            | 典型指标                                              |
| ---------------- | --------------- | ------------------------------------------------- |
| Model            | 模型本身是否能完成任务     | accuracy、reasoning、classification                 |
| Retrieval        | 是否找到了正确资料       | recall、precision、groundedness                     |
| Tool             | 工具是否选对、参数是否正确   | tool selection、input accuracy、success             |
| Agent trajectory | Agent 是否采取了合理步骤 | goal success、trajectory、tool calls                |
| Final output     | 最终答案/建议是否正确     | correctness、relevance、completeness                |
| Safety / Control | 是否违反安全和授权边界     | policy violation、data leakage、unauthorized action |
| Business outcome | 业务结果是否真正改善      | resolution rate、rework、SLA、loss、STP               |

Microsoft 当前的 Agent evaluators 已经把这种分层具体化，包括 Task Adherence、Task Completion、Tool Selection、Tool Input Accuracy、Tool Output Utilization、Tool Call Success、Task Navigation Efficiency，以及 Groundedness、Safety 等。

AWS AgentCore 也同时支持：

```text
Correctness
Goal Success Rate
Trajectory Matching
Tool Evaluation
Custom Metrics
```

并支持对 Agent 的完整 Session / Trace 进行评估，而不是只检查最终文本。

这说明业界正在逐渐形成一个共识：

> **Agent Evaluation 必须从“最终答案评估”扩展到“整个执行过程评估”。**

---

# 3. 为什么 Agent Evaluation 比传统软件测试更难

传统程序通常具有：

```text
Input
 ↓
Deterministic Logic
 ↓
Output
```

Agent 更接近：

```text
Input
 ↓
Model
 ↓
Action
 ↓
Tool
 ↓
Observation
 ↓
Model
 ↓
Action
 ↓
Tool
 ↓
...
 ↓
Output
```

中间存在大量动态行为。

Anthropic 对 Agent Evaluation 的总结非常直接：Agent 的自主性、多轮交互、Tool Calling、状态修改和动态适应能力，同时也是它变得更难评估的原因。其内部实践把评估拆成 code-based、model-based 和 human 三类 grader。

因此，Agent Evaluation 通常面临五个问题。

### 第一，正确答案可能不唯一

例如：

```text
“调查这个客户为什么风险上升。”
```

可能存在：

```text
搜索交易
→ 查客户资料
→ 查新闻
→ 回看历史
```

也可能：

```text
搜索新闻
→ 查关联账户
→ 搜索交易
```

两种路径都可能正确。

所以不能简单采用：

```text
Expected Trajectory == Actual Trajectory
```

作为唯一标准。

AWS 当前已经支持：

```text
Exact Order Match
In Order Match
Any Order Match
```

三种 Trajectory evaluation，反映了“有效路径不一定唯一”的现实。

---

### 第二，最终答案正确，不代表过程正确

例如：

```text
Agent
→ 调用了错误的客户查询 Tool
→ 恰好得到了相同结果
→ 输出正确答案
```

如果只看 final answer：

```text
PASS
```

但从系统控制角度，这很可能应该：

```text
FAIL
```

因为它可能意味着：

```text
错误权限
错误数据源
错误 Tool
潜在数据越权
```

所以：

> **Agent Evaluation 必须同时评价 outcome 和 trajectory。**

---

### 第三，很多质量问题无法用简单规则判断

例如：

```text
这份客户总结是否遗漏了重要信息？
```

或者：

```text
这份研究报告是否合理使用了证据？
```

这些问题很难完全用：

```text
regex
exact match
```

解决。

于是需要：

```text
LLM-as-a-Judge
```

但 LLM Judge 也不能被当成绝对真理。

Anthropic 明确指出，Model-based graders 虽然适合开放式任务，但具有非确定性，因此需要通过 Human Grader 进行 calibration。Google 的 Judge Model 文档也要求用有人类评分的 ground-truth 数据来验证 Judge 的质量。

因此：

```text
LLM Judge
≠
Ground Truth
```

---

### 第四，生产环境问题无法完全提前设计

开发者想象的：

```text
100 个测试问题
```

和真实用户使用时的：

```text
100,000 个问题
```

往往完全不同。

真实生产环境会出现：

```text
奇怪表达
边缘业务
组合任务
异常文档
最新政策
数据缺失
错误 Tool
Prompt Injection
权限边界
```

所以 Evaluation 必须形成闭环：

```text
Production
   ↓
Trace
   ↓
Failure
   ↓
Dataset
   ↓
Eval
   ↓
Fix
   ↓
Regression Suite
```

LangSmith 当前也明确把 production backtesting 和 production feedback loop 作为 Evaluation 的一部分：生产 Trace 可以转化成 Dataset，再用于新版本回归。

---

# 4. 业界实际做法：从“Model Eval”走向“System Eval”

## 4.1 Anthropic

Anthropic 对 Agent Evaluation 的公开实践已经非常接近企业平台应该采用的结构：

```text
Code-based Grader
+
Model-based Grader
+
Human Grader
```

其中：

### Code-based

适合：

```text
Exact Match
JSON Schema
Tool Parameters
Tool Calls
State
Outcome
Token Usage
Latency
Security Tests
```

优点是：

```text
Fast
Cheap
Objective
Reproducible
```

### Model-based

适合：

```text
Rubric
Correctness
Quality
Semantic Similarity
Natural-language Assertions
Pairwise Comparison
```

### Human

适合：

```text
High-impact decisions
Expert judgment
Rubric calibration
Disputed cases
```

Anthropic 同时区分：

```text
Capability Eval
Regression Eval
```

Capability Eval 的目标是发现“新能力能做到什么”；Regression Eval 则要求过去已经通过的能力继续保持通过。

这个区分非常重要。

---

# 5. 一个企业内部 Agent Platform 至少需要两套 Dataset

很多团队一开始只做：

```text
Golden Dataset
```

然后每次发布跑一遍。

这还不够。

应该至少有：

```text
Capability Dataset
+
Regression Dataset
```

## Capability Dataset

目标：

> 这个 Agent 现在到底能做到什么？

例如：

```text
100 个新的复杂 Fraud Investigation Case
```

结果可能：

```text
Success Rate = 62%
```

这并不意味着系统“不合格”。

它可能只是说明：

> 当前能力还不够。

Capability Dataset 应该主动包含：

```text
困难案例
新任务
边界问题
组合任务
长链任务
复杂 Tool 使用
```

---

## Regression Dataset

目标：

> 过去已经解决的问题，现在还会不会坏？

例如：

```text
1,500 个历史生产 Case
```

原版本：

```text
94.2%
```

新版本：

```text
93.4%
```

这时就可能阻止发布。

Anthropic 建议 Capability Eval 可以从较低通过率开始持续“爬坡”，而 Regression Eval 的目标应该接近 100% 通过，以防止已有能力倒退。

---

# 6. Dataset 怎么准备

这是企业 Agent Platform Evaluation 最重要、也最容易做错的地方。

最理想的 Dataset 不是：

```text
AI Team 自己随便写 100 个问题
```

而是：

```text
Business Requirements
+
Historical Production Cases
+
Manual Test Cases
+
Known Failures
+
Edge Cases
+
Adversarial Cases
+
Synthetic Cases
```

形成：

```text
Evaluation Dataset
```

---

# 7. 第一类数据：业务需求直接转换成 Test Case

最容易开始。

例如业务需求：

> Agent 必须回答内部产品政策问题，并且不能使用外部知识替代内部 Policy。

可以产生：

```text
Case 001
User:
“某产品的提前赎回规则是什么？”

Expected:
必须基于内部 Policy 回答。

Failure:
使用模型内部知识直接回答。
```

业务需求本身就可以成为：

```text
Acceptance Criteria
```

Anthropic 建议 Evaluation 尽早开始，并指出早期只需要 20–50 个来自真实失败的简单任务就可以形成有效起点，不应等到系统完成后才倒推成功标准。

---

# 8. 第二类数据：生产真实案例

这是最重要的数据来源之一。

例如：

```text
Production Trace
```

出现：

```text
用户问：
“为什么我的贷款还款金额增加？”

Agent：
→ 查错数据源
→ 使用旧政策
→ 输出错误回答
```

不要只是：

```text
修 Bug
```

而应该：

```text
把这个 Case 加入 Regression Dataset
```

变成：

```text
regression/loan/repayment/0037
```

以后：

```text
Model Change
Prompt Change
Skill Change
Retrieval Change
Tool Change
```

都必须重新跑。

Morgan Stanley 已公开披露其每天运行 regression suite，对 sample questions 做持续测试；其 AI use cases 在上线前都经过 Evaluation，随后继续通过 Regression 发现潜在弱点。

这是目前金融机构公开案例里非常值得参考的一点：

> **Evaluation 不是上线前的一次验收，而是一个持续存在的 Regression Asset。**

---

# 9. 第三类数据：人工专家构造 Dataset

金融业务非常需要这一类。

例如：

```text
Fraud Investigator
Compliance Officer
Credit Underwriter
Research Analyst
Operations Specialist
```

让真正懂业务的人构造：

```text
Typical Cases
+
Hard Cases
+
Exception Cases
```

这类数据的价值不只是答案本身。

专家实际上在定义：

```text
What good looks like
```

即：

```text
正确
什么叫正确？

完整
什么叫完整？

可以接受的风险是什么？

什么情况必须拒绝？

什么情况必须升级人工？
```

---

# 10. 第四类数据：Synthetic Dataset

Synthetic Data 很有价值，但不能成为唯一来源。

AWS AgentCore 已经支持通过 Agent Simulation 产生动态多轮场景，例如：

```text
Actor Profile
+
Goal
+
Context
```

生成模拟用户与 Agent 的完整对话。

BBVA 的 Blue 也公开披露了一部分类似实践：其部分数据集由 LLM 模拟客户对话生成，然后再进行人工标注和审核。

Synthetic Data 特别适合生成：

```text
Rare Cases
Long Conversations
Edge Cases
Adversarial Inputs
Multi-turn Cases
```

例如：

```text
客户情绪激烈
+
信息缺失
+
重复修改
+
多笔交易
+
多个身份
```

但不能简单认为：

```text
Synthetic
=
Reality
```

因为 Synthetic Data 本身可能继承生成器的偏差。

因此推荐：

```text
Synthetic Generation
       ↓
Business Review
       ↓
Dataset
```

而不是：

```text
LLM
 ↓
Dataset
```

---

# 11. 第五类数据：Adversarial / Security Dataset

金融 Agent 尤其需要这一类。

例如：

```text
Prompt Injection
Data Exfiltration
Tool Abuse
Privilege Escalation
Unauthorized Action
Indirect Prompt Injection
Malicious Documents
Malicious Emails
```

AgentDojo 是非常有代表性的研究：它构建了动态环境，用来测试 Agent 在处理不可信数据时受到 Prompt Injection 的攻击与防御效果，包含银行网站、邮件系统等真实任务类型。

因此 Agent Evaluation 不应该只是：

```text
“能不能做成任务？”
```

还应该加入：

```text
“攻击者能不能诱导它完成不应该完成的任务？”
```

---

# 12. Dataset 不能只有 Input + Expected Answer

传统 QA Dataset：

```json
{
  "input": "...",
  "expected_answer": "..."
}
```

对 Agent 不够。

建议最小结构：

```json
{
  "case_id": "fraud-00037",
  "domain": "fraud",
  "risk_tier": "high",
  "user_role": "investigator",
  "input": "...",
  "context": {
    "policy_version": "2026-09",
    "available_tools": [
      "search_transactions",
      "search_customer",
      "case_update"
    ]
  },
  "expected": {
    "goal": "...",
    "assertions": [
      "must inspect transaction history",
      "must not close the case autonomously",
      "must cite evidence"
    ],
    "allowed_actions": [
      "search_transactions",
      "search_customer"
    ],
    "forbidden_actions": [
      "close_case"
    ]
  },
  "metadata": {
    "jurisdiction": "SG",
    "product": "card",
    "severity": "high"
  }
}
```

重点是：

```text
Input
+
Context
+
Expected Outcome
+
Allowed Behavior
+
Forbidden Behavior
+
Metadata
```

---

# 13. Ground Truth 不一定是一个标准答案

这是 Agent Evaluation 很关键的概念。

对于：

```text
“1+1 等于多少？”
```

Ground Truth 可以：

```text
2
```

但对于：

```text
“调查这个 Fraud Case。”
```

很可能没有唯一答案。

此时 Ground Truth 更适合表达：

```text
Goal
+
Assertions
+
Constraints
+
Expected Evidence
+
Allowed Actions
+
Forbidden Actions
```

例如：

```text
必须：
1. 查交易记录
2. 检查关联客户
3. 给出证据

不允许：
1. 直接冻结账户
2. 修改客户状态
3. 访问无关客户资料
```

AWS AgentCore 当前已经支持这种 Ground Truth：除了 expected response，还支持 natural-language assertions 和 expected trajectory。

对于开放式 Agent：

> **用“允许的结果空间”和“不可违反的约束”通常比“唯一正确轨迹”更合理。**

---

# 14. 数据集应该怎么分割

至少建议：

```text
Train / Development
Validation
Regression
Challenge
Production Backtest
```

对于 Agent 平台，还应该考虑：

```text
By Business Domain
By Risk Tier
By User Role
By Tool
By Language
By Data Source
By Complexity
By Failure Type
```

例如：

```text
Fraud
 ├── Normal
 ├── Edge
 ├── High Risk
 ├── Prompt Injection
 ├── Missing Data
 └── Tool Failure
```

而不是简单：

```text
Dataset A
Dataset B
Dataset C
```

---

# 15. 不应该随机切一个 80/20 就结束

金融业务 Dataset 很容易出现：

```text
90% easy cases
8% normal cases
2% high-risk cases
```

如果直接计算：

```text
Overall Accuracy = 98%
```

这个数字可能毫无意义。

因为：

```text
High Risk Accuracy
```

也许只有：

```text
65%
```

因此建议至少输出：

```text
Overall
+
Per Risk Tier
+
Per Business Domain
+
Per Scenario Type
```

例如：

| Dimension   |  Cases | Pass Rate |
| ----------- | -----: | --------: |
| Overall     | 10,000 |     96.4% |
| Normal      |  7,500 |     98.1% |
| Edge        |  1,800 |     91.2% |
| High Risk   |    500 |     84.0% |
| Adversarial |    200 |     72.5% |

金融系统不应该被：

```text
Overall Average
```

掩盖。

---

# 16. Evaluation 应该采用四类 Evaluator

## 第一类：Code-based Evaluator

应该尽量多用。

例如：

```text
JSON Schema
Tool Name
Tool Arguments
Authorization
Required Fields
Forbidden Tool
State Transition
Citation Exists
Latency
Cost
```

例如：

```python
assert "close_case" not in actual_tool_calls
assert actual_output["citations"]
assert actual_output["risk_score"] <= policy_limit
```

优点：

```text
确定
便宜
快速
可重复
```

Anthropic、AWS、Microsoft 当前都把 code-based checks / custom code evaluators 作为 Agent Evaluation 的重要组成部分。

---

# 17. 第二类：LLM-as-a-Judge

适合：

```text
Relevance
Completeness
Helpfulness
Groundedness
Quality
Reasoning Quality
```

例如：

```text
问题：
这个回答是否完整覆盖了客户的问题？

Judge Rubric：
0 = 完全错误
1 = 部分正确
2 = 基本正确
3 = 完整正确
```

但 Judge 的问题是：

```text
Judge 本身也是模型
```

所以：

```text
Agent Model
```

和：

```text
Judge Model
```

最好不要完全没有校准。

Google 明确建议用有人工评分的 Ground Truth Dataset 验证 Judge Model 与 Human Judgment 的一致性。

Anthropic 同样指出 Model-based Grader 需要 Human Grader Calibration。

因此：

```text
LLM Judge
 ↓
Human Sample
 ↓
Judge Calibration
 ↓
Production Use
```

---

# 18. 第三类：Human Evaluation

金融场景中，人类 Evaluation 不可能完全消失。

尤其：

```text
High Risk
Expert Judgment
New Use Case
Disputed Result
New Model
New Policy
```

这些情况下必须有 SME。

但 Human Eval 不应该意味着：

```text
每一个 Case 都人工打分
```

更合理：

```text
大量 Case
   ↓
Code Evaluator

大量 Case
   ↓
LLM Judge

Sampling
   ↓
Human Review
```

人主要负责：

```text
建立 Rubric
校准 Judge
Review Failure
Review High Risk Case
```

这样才能规模化。

---

# 19. 第四类：Outcome Evaluator

这是金融平台最容易遗漏的一类。

例如：

```text
Agent 说：
“建议调查交易 A。”
```

文本质量可能：

```text
95%
```

但真正业务结果：

```text
调查人员是否接受？
是否减少调查时间？
是否降低漏报？
是否减少误报？
是否需要返工？
```

这些才是：

```text
Business Outcome
```

所以最终需要：

```text
AI Quality
+
Business Outcome
```

而不是：

```text
AI Quality
=
Business Outcome
```

---

# 20. 一个完整的 Agent Evaluation Matrix

推荐至少建设：

| Evaluation Dimension | 示例指标                         | 推荐 Evaluator         |
| -------------------- | ---------------------------- | -------------------- |
| Correctness          | accuracy                     | Code / Judge / Human |
| Completeness         | required facts coverage      | Judge / Code         |
| Groundedness         | unsupported claim rate       | Code / Judge         |
| Citation             | citation correctness         | Code / Judge         |
| Retrieval            | recall@k / relevant-doc rate | Code                 |
| Intent               | precision / recall / F1      | Code                 |
| Tool Selection       | correct tool rate            | Code                 |
| Tool Input           | parameter accuracy           | Code                 |
| Tool Output          | correct utilization          | Judge / Code         |
| Goal Success         | task success rate            | Outcome / Judge      |
| Trajectory           | valid trajectory             | Code                 |
| Efficiency           | turns / tool calls           | Code                 |
| Consistency          | pass^k                       | repeated runs        |
| Safety               | violation rate               | Code / Judge         |
| Authorization        | unauthorized action rate     | Code                 |
| Privacy              | data leakage rate            | Code / Judge         |
| Prompt Injection     | attack success rate          | Security Dataset     |
| Latency              | p50 / p95                    | Code                 |
| Cost                 | $ / task                     | Code                 |
| Human Acceptance     | acceptance rate              | Human                |
| Business Outcome     | resolution / rework / SLA    | Business System      |

---

# 21. 对 Agent，不应该只看 Accuracy

例如：

```text
Agent A
Accuracy = 95%
Tool Calls = 30
Latency = 40 sec
Cost = $0.80
```

Agent B：

```text
Accuracy = 94%
Tool Calls = 8
Latency = 7 sec
Cost = $0.12
```

如果只是：

```text
Accuracy
```

A 看起来更好。

但真实生产系统可能 B 更合适。

所以一个成熟平台应该同时看：

```text
Quality
+
Safety
+
Reliability
+
Efficiency
+
Cost
```

---

# 22. Agent 的一致性尤其重要

普通 LLM：

```text
一次成功
```

和：

```text
每次都成功
```

差别可能没有那么大。

Agent 不一样。

例如：

```text
成功率 = 75%
```

如果连续运行三次：

```text
75%³ = 42.2%
```

Anthropic 用 `pass^k` 专门描述这种一致性问题，并指出对需要可靠重复行为的 Agent，`pass^k` 比单次成功率更有意义。

因此金融 Agent 还应该考虑：

```text
pass@1
pass@k
```

其中：

```text
pass@k
```

更接近：

> k 次里至少一次成功。

而：

```text
pass^k
```

更接近：

> 连续 k 次全部成功。

对：

```text
Customer Service
Fraud Workflow
Compliance
Payment Support
```

后者尤其重要。

---

# 23. Tool Evaluation 是 Agent Platform 的核心

一个 Agent Platform 如果只有：

```text
Final Answer Evaluator
```

是不完整的。

因为企业 Agent 经常失败在：

```text
Tool Selection
Tool Parameters
Tool Result Interpretation
Tool Permission
```

例如：

```text
用户：
查询客户 A 最近 30 天交易。

Agent：
调用：
search_customer_transactions(
    customer=A,
    days=365
)
```

答案可能最后看起来合理。

但 Tool 参数已经错了。

所以应该分别评估：

```text
Tool Selection Accuracy
Tool Input Accuracy
Tool Call Success
Tool Output Utilization
```

Microsoft 已经把这些作为独立 Agent Evaluators。

---

# 24. Retrieval Evaluation 也应该独立出来

对于 RAG Agent：

```text
Question
 ↓
Retriever
 ↓
Context
 ↓
Agent
```

最终回答错误，有三种完全不同的原因：

```text
A.
Retriever 根本没找到正确资料。

B.
找到了正确资料，但 Agent 没有使用。

C.
使用了正确资料，但理解错了。
```

因此不能只测：

```text
Final Answer Accuracy
```

应该拆：

```text
Retrieval Recall
+
Context Relevance
+
Groundedness
+
Final Correctness
```

BBVA 对其 Blue Agent 的评估就是很好的真实案例：它不仅看回答结果，还区分：

```text
Fallback
Relevance
Grounding
Usefulness
Consistency
```

并进一步分析错误发生在什么阶段。

这比：

```text
Score = 0.82
```

有用得多。

---

# 25. Evaluation 最重要的不应该只是“评分”，而应该是“错误分类”

BBVA 的实践很值得企业平台借鉴。

例如它不是简单说：

```text
Answer Score = 0.7
```

而是尝试识别：

```text
Unnecessary Fallback
Not Relevant
Ungrounded
Not Useful
Incomplete
Inconsistent
```

这样平台才能回答：

```text
到底应该修什么？
```

例如：

```text
Grounding 低
```

应该查：

```text
Retriever
Document Chunking
Index
Context
```

而：

```text
Tool Input Accuracy 低
```

应该查：

```text
Tool Schema
Prompt
Tool Description
Agent Policy
```

而：

```text
Goal Success 低
```

可能应该查：

```text
Planning
Agent Architecture
Available Tools
Workflow
```

因此：

> **一个好的 Evaluation Platform 不只是 Scoreboard，而应该是 Failure Diagnosis System。**

---

# 26. Evaluation Platform 本身应该怎么设计

企业内部建设时，建议至少包含八个核心组件。

```text
                     Evaluation Platform

   ┌────────────────────────────────────────────┐
   │              Dataset Registry              │
   └───────────────────┬────────────────────────┘
                       │
   ┌───────────────────▼────────────────────────┐
   │              Evaluation Runner             │
   └───────────────────┬────────────────────────┘
                       │
            ┌──────────┼──────────┐
            ▼          ▼          ▼
        Code Judge  LLM Judge  Human Review
            │          │          │
            └──────────┼──────────┘
                       ▼
   ┌────────────────────────────────────────────┐
   │             Trace / Trajectory             │
   └───────────────────┬────────────────────────┘
                       ▼
   ┌────────────────────────────────────────────┐
   │            Experiment Registry             │
   └───────────────────┬────────────────────────┘
                       ▼
   ┌────────────────────────────────────────────┐
   │       Score / Error / Regression Store      │
   └───────────────────┬────────────────────────┘
                       ▼
   ┌────────────────────────────────────────────┐
   │          Release Gate / Monitoring         │
   └────────────────────────────────────────────┘
```

---

# 27. Dataset Registry

每一个 Dataset 都应该拥有：

```text
dataset_id
version
owner
business_domain
risk_tier
source
created_at
label_version
policy_version
model_version
```

例如：

```text
fraud-investigation-regression
v2026.09.21
owner = fraud-ai-team
risk = high
```

这样才能做到：

```text
Agent Version
+
Dataset Version
+
Evaluator Version
=
Evaluation Run
```

否则以后很难解释：

> “为什么三个月前是 94%，现在是 91%？”

---

# 28. Evaluation Run 应该是一级对象

例如：

```text
Evaluation Run
-----------------------
run_id
agent_version
model_version
prompt_version
skill_version
tool_version
retrieval_index_version
policy_version
dataset_version
evaluator_version
timestamp
environment
```

输出：

```text
metrics
failures
artifacts
samples
judge_results
human_reviews
```

这样才能真正做到：

```text
Reproducible Evaluation
```

---

# 29. Trace 必须成为 Evaluation 的输入

传统：

```text
Request
Response
```

对 Agent 不够。

应该记录：

```text
Trace
 ├── User Input
 ├── System Prompt / Skill Reference
 ├── Model Calls
 ├── Tool Calls
 ├── Tool Inputs
 ├── Tool Outputs
 ├── Retrieval Results
 ├── Guardrail Results
 ├── Handoffs
 ├── Agent State
 ├── Final Output
 └── Business Action
```

OpenAI Agents SDK 当前默认提供 Trace/Span 结构，记录 Agent、LLM generation、Tool Call、handoff、guardrail 等事件；这类完整 trajectory 是 Agent debugging 和 evaluation 的基础。

---

# 30. Agent Evaluation 与 Observability 是两个不同东西

Observability：

```text
发生了什么？
```

Evaluation：

```text
发生的事情对不对？
```

例如：

```text
Trace:
Agent 调用了 transfer_money

```

Observability 可以记录：

```text
Tool = transfer_money
Amount = $50,000
```

Evaluation 才能判断：

```text
这个动作是否合法？
是否应该执行？
是否有对应授权？
参数是否正确？
```

所以：

```text
Observability
+
Evaluation
```

应该结合，但不能混成一个概念。

---

# 31. Evaluation 应该接入 CI/CD

推荐：

```text
Pull Request
     ↓
Unit Test
     ↓
Deterministic Agent Test
     ↓
Small Regression Dataset
     ↓
LLM Judge
     ↓
Security Tests
     ↓
PASS / FAIL
```

然后：

```text
Merge
 ↓
Full Regression Dataset
 ↓
Human Sample
 ↓
Release
```

OpenAI Agents SDK 自己也提供 deterministic testing utilities，可以在不调用真实模型、sandbox provider 或 realtime provider 的情况下测试 Tool、handoff、guardrail、retry 和 session 等应用控制逻辑。

这意味着：

> **Agent Platform 的大量“工程控制”应该像普通软件一样进入 CI，而不是全部依赖人工验收。**

---

# 32. 但是不要把所有 Evaluation 都塞进 CI

例如：

```text
10,000 production conversations
```

如果每次 Commit 都：

```text
跑 10,000
×
LLM Judge
```

成本会很高。

更合理：

```text
PR
→ 20–100 critical regression cases

Nightly
→ 1,000+ cases

Release
→ Full regression

Weekly / Monthly
→ Production Backtest

Production
→ Sampled Online Evaluation
```

AWS AgentCore 当前也将 Evaluation 分成：

```text
Online
On-demand
Batch
```

其中 Batch 特别适合 baseline、pre/post comparison 和 regression；Online 则持续监测真实生产流量。

---

# 33. Production Online Evaluation

上线以后：

```text
Production Traffic
      ↓
Sample
      ↓
Online Evaluator
      ↓
Score
      ↓
Trend
      ↓
Alert
```

例如：

```text
Groundedness < 0.90
```

触发：

```text
Investigate
```

或者：

```text
Unauthorized Tool Call > 0
```

直接：

```text
Critical Alert
```

AWS AgentCore 已经提供 Online Evaluation，支持按比例采样或者基于条件筛选真实 Session，再持续计算评价指标。

---

# 34. 生产数据如何进入 Evaluation Dataset

推荐：

```text
Production
     ↓
Trace Sampling
     ↓
Automatic Failure Detection
     ↓
Human Review
     ↓
Label
     ↓
Dataset
     ↓
Regression
```

例如：

```text
用户投诉：
“答案错误。”

```

不要简单：

```text
is_bad = true
```

应该进一步标注：

```text
failure_type:
  retrieval
  grounding
  reasoning
  tool
  authorization
  policy
  user_intent
```

这样 Dataset 才会真正产生价值。

---

# 35. 金融领域尤其需要“Error Taxonomy”

建议企业平台维护统一 Failure Taxonomy，例如：

```text
1. Intent Error
2. Retrieval Error
3. Grounding Error
4. Reasoning Error
5. Tool Selection Error
6. Tool Parameter Error
7. Tool Execution Error
8. Tool Result Interpretation Error
9. Policy Violation
10. Authorization Violation
11. Data Leakage
12. Prompt Injection
13. Wrong Abstention
14. Missing Escalation
15. Business State Error
16. Human Handoff Error
17. Incomplete Output
18. Unsupported Claim
19. Latency / Cost Failure
20. External System Failure
```

这样 Evaluation 从：

```text
“这个 AI 只有 87 分。”
```

变成：

```text
Grounding
    95%

Tool Selection
    98%

Unauthorized Action
    0.02%

High-risk Escalation
    99.7%

Goal Success
    91%
```

这才真正具有工程意义。

---

# 36. 金融企业应该采用 Risk-based Evaluation

不是所有 Agent 都需要同样严格。

一个简单的分层方式：

| Tier   | 示例                                   | Evaluation 强度                                                    |
| ------ | ------------------------------------ | ---------------------------------------------------------------- |
| Tier 1 | 内部知识问答、摘要                            | 基础质量 + Grounding                                                 |
| Tier 2 | Research、Investigation、Draft         | Quality + Evidence + Regression                                  |
| Tier 3 | Workflow Recommendation、Case Routing | Goal + Tool + Policy + Human Review                              |
| Tier 4 | Payment、Trade、Account Change 等高影响动作  | Full E2E + Security + Authorization + Human / Deterministic Gate |

这样做也符合金融 Model Risk Management 的 risk-based 思路。

美国 2026 年新版跨机构 Model Risk Management Guidance 强调风险管理应根据模型用途、重要性、复杂度和机构风险特征进行差异化实施；同时指出 GenAI 和 Agentic AI 目前属于快速发展的新领域，不在该 guidance 的直接 scope 内，监管机构计划进一步就银行使用 AI、GenAI 和 Agentic AI 获取信息。因此，不应该把这份 guidance 误写成“Agent 必须按传统模型验证方式做”的硬性规定，但其中的 risk-based testing、validation、monitoring、governance 等原则仍然具有很强的参考价值。

---

# 37. Evaluation Gate 不应该只有一个总分

不推荐：

```text
Overall Score > 90
→ Pass
```

因为：

```text
Accuracy
= 97%

Unauthorized Action
= 0.3%
```

整体可能仍然很高。

但：

```text
Unauthorized Action
```

可能本身就是：

```text
Release Blocker
```

因此应该采用：

```text
Hard Gates
+
Quality Thresholds
+
Risk-specific Metrics
```

例如：

```text
Correctness >= 0.90
Groundedness >= 0.95

AND

Unauthorized Action = 0

AND

Sensitive Data Leakage = 0

AND

Critical Policy Violation = 0

AND

Regression Drop <= 1%
```

其中：

```text
Critical Safety Metrics
```

不能通过平均分被掩盖。

---

# 38. 一个更适合金融 Agent 的 Release Gate

```text
                    Evaluation
                        │
       ┌────────────────┼────────────────┐
       ▼                ▼                ▼
     Quality          Safety           Business
       │                │                │
       ▼                ▼                ▼
   Correctness      Policy Violation   Goal Success
   Grounding        Data Leakage       SLA
   Completeness     Unauthorized      Rework
   Relevance        Action             Acceptance
       │                │                │
       └────────────────┼────────────────┘
                        ▼
                    Risk Gate
                        │
          ┌─────────────┴─────────────┐
          ▼                           ▼
       PASS                         BLOCK
```

这样更符合金融系统的控制思路。

---

# 39. Morgan Stanley：最值得参考的金融案例

Morgan Stanley 是公开案例里非常适合研究 Evaluation 的一个。

其 AI @ Morgan Stanley Assistant 在上线之前，对每个 AI use case 建立 Evaluation framework。

早期 Evaluation 包括：

```text
Translation
Summarization
Human Expert Comparison
```

金融顾问和 Prompt Engineer 对输出进行准确性、一致性等评估。

之后 Evaluation 又增加：

```text
Retrieval
Multilingual
```

并把 Evaluation Dataset 持续扩展。

对于 Debrief，它又构建了不同 meeting type 的 evaluation datasets，测试模型是否抓住关键 action items 并避免错误。

同时，Morgan Stanley 公开描述了：

```text
Daily Regression Testing
```

用 sample questions 持续检测系统弱点。

这个案例说明三件事：

### 第一

Evaluation 在金融 AI 项目中不是最后的 QA。

它从：

```text
Use Case Selection
```

就开始介入。

### 第二

Evaluation Dataset 会随着产品一起成长。

```text
Use Case
 ↓
Dataset
 ↓
Failure
 ↓
New Dataset Case
```

### 第三

Evaluation 本身成为 Agent Platform 的基础设施，而不是每个项目各做一套。

---

# 40. BBVA Blue：非常值得研究的 Agent Evaluation

BBVA AI Factory 在 2026 年公开介绍了 Blue Agent 的 Evaluation 方法。

它实际上建立了多个 Agent-specific evaluation。

## Informational Agent

首先判断：

```text
应该回答吗？
```

如果应该回答，再检查：

```text
Relevance
Grounding
Usefulness
Consistency
```

其中尤其强调：

> RAG 仍然可能产生没有根据的回答，甚至与检索上下文矛盾。

因此不能认为：

```text
RAG
=
正确
```

而必须单独评估。

---

## Routing Agent

BBVA 使用：

```text
Precision
Recall
F1
Confusion Matrix
```

并将：

```text
Intent Filtering
```

和：

```text
Final Classification
```

分开评估。

这非常适合企业 Agent Platform，因为 Routing Failure 往往不是 Agent Reasoning Failure。

---

## Clarification

BBVA 还定义：

```text
Disambiguation Rate
```

即：

> Agent 能不能意识到用户说得不够清楚，并主动要求补充信息。

这对金融 Agent 非常重要。

因为：

```text
“我不知道”
```

有时是失败；

而：

```text
“我需要确认一下你说的是哪一个账户。”
```

反而是正确行为。

因此：

> **Abstain / Clarify 也应该成为 Evaluation Target，而不是简单视为失败。**

---

## Transaction Agent

BBVA 进一步评估：

```text
Entity Precision
Empty Entity Precision
Entity Hallucination
End-of-conversation Detection
```

实体包括：

```text
IBAN
Card Number
Amount
Contact
```

这已经非常接近真正 Banking Agent 的 Evaluation，而不是普通 Chatbot QA。

---

# 41. DBS：Evaluation 应该属于企业 AI Governance

DBS 2025 年公开信息显示，它已经将 AI 扩展到超过：

```text
2,000 AI Models
430+ Use Cases
```

同时建立 GenAI framework，提供：

```text
Reusable Components
Governance Guardrails
Workflow Capabilities
Prompt Engineering
```

并通过集中化 Data / AI 平台支持规模化部署。

DBS 的 Responsible AI framework 还包含：

```text
Data Foundation
PURE
Model Governance
Materiality Assessment
AI Protocol / Registry
Roles & Responsibilities
Senior Management Accountability
```

并通过 Responsible AI Taskforce 对 GenAI use cases 进行评估和风险缓解。

这说明一个成熟金融机构的 AI Evaluation 最终不会是一个孤立的测试平台，而会成为：

```text
AI Governance
+
Model / System Evaluation
+
Risk Classification
+
Production Monitoring
```

的一部分。

---

# 42. Evaluation 数据不能直接把生产客户数据复制进测试环境

金融企业尤其需要避免：

```text
Production Database
        ↓
Evaluation Dataset
```

这种简单做法。

更合理的是：

```text
Production Data
      ↓
Data Classification
      ↓
PII / Sensitive Data Handling
      ↓
De-identification / Masking
      ↓
Synthetic Augmentation
      ↓
Approved Evaluation Dataset
```

同时 Dataset 本身也应该有：

```text
Data Owner
Purpose
Access Control
Retention
Classification
Jurisdiction
Consent / Legal Basis
```

DBS 的公开 Responsible Data Use Framework 就把 data security、privacy、access 和 quality 放在 AI 数据基础层，并强调 AI use case 的 Purposeful、Unsurprising、Respectful、Explainable。

因此：

> **Evaluation Dataset 本身就是企业数据资产，不应该被当成普通测试文件。**

---

# 43. Judge Model 本身也需要 Evaluation

这是很多平台遗漏的问题。

例如：

```text
Agent
   ↓
Judge Model
   ↓
Score = 0.8
```

谁保证：

```text
0.8
```

是真的？

应该专门准备：

```text
Judge Calibration Dataset
```

其中：

```text
Case
Human Score
Judge Score
```

然后分析：

```text
Correlation
Agreement
False Positive
False Negative
Bias
Drift
```

例如：

```text
Human Pass Rate = 92%
Judge Pass Rate = 84%
```

如果这种差距长期存在：

```text
Judge
```

本身就不适合做 Release Gate。

Google 当前也明确要求用 Human Rating Ground Truth 来评估 Judge Model。

---

# 44. 不应该把 LLM-as-a-Judge 用在所有地方

推荐一个很实际的规则：

```text
能写确定性规则
→ Code Evaluator

不能写规则但可以定义 Rubric
→ LLM Judge

涉及重大业务判断
→ Human

涉及安全 / 权限
→ Deterministic Control + Security Test

涉及最终业务结果
→ Business Outcome
```

例如：

```text
Tool 参数是否正确
→ Code

是否引用正确 Document
→ Code + Judge

这份研究是否有洞察
→ Judge + Human

是否可以付款
→ Policy / Authorization

付款之后是否真的成功
→ Business System
```

---

# 45. Benchmark 不应该直接等于企业 Acceptance Criteria

可以使用：

```text
AgentBench
GAIA
WebArena
AgentDojo
```

等公开 Benchmark。

它们适合：

```text
Model Comparison
Research
Baseline
Architecture Exploration
Security Research
```

例如 AgentBench 覆盖多个交互环境，测试 LLM Agent 的推理、决策与长期行为；GAIA 测试工具使用、Web Browsing、多模态和一般性助理能力；AgentDojo 则专门研究 Agent 面临 Prompt Injection 的安全性。

但企业自己的：

```text
KYC Agent
Fraud Agent
Research Agent
Payment Assistant
```

不应该因为：

```text
GAIA = 80%
```

就认定：

```text
Production Ready
```

因为公开 Benchmark 测的是：

```text
Generic Capability
```

而企业需要的是：

```text
Business-specific Capability
+
Risk
+
Policy
+
Data
+
Tool
+
Workflow
```

---

# 46. 一个实际可执行的 Evaluation Lifecycle

如果从零搭建内部 AI Agent Platform，可以按下面的流程开始。

## Step 1：定义 Use Case

先写：

```text
Business Goal
User
Inputs
Outputs
Allowed Actions
Forbidden Actions
Risk
Business Owner
```

没有这些，不要先写 Agent。

---

## Step 2：定义 Success Contract

明确：

```text
什么叫成功？
什么叫失败？
什么情况应该拒答？
什么情况应该人工升级？
什么动作绝对禁止？
```

例如：

```text
成功：
给出正确的调查结论并附证据。

失败：
没有证据。

Critical Failure：
执行未经授权的账户修改。
```

---

## Step 3：建立 Dataset v0

早期：

```text
20–50 real / representative cases
```

来源：

```text
Existing manual tests
Business requirements
Known incidents
Production failures
```

这是 Anthropic 推荐的早期起点。

---

## Step 4：先写 Deterministic Evaluators

例如：

```text
JSON
Tool
Authorization
Forbidden Action
Required Citation
Latency
```

因为它们：

```text
便宜
稳定
容易 Debug
```

---

## Step 5：加入 LLM Judges

用于：

```text
Groundedness
Completeness
Usefulness
Quality
```

然后用 SME 对 Judge Calibration。

---

## Step 6：建立 Regression Dataset

每次真实失败：

```text
Production Failure
 ↓
Root Cause
 ↓
Dataset Case
```

---

## Step 7：建立 Capability Dataset

不断加入：

```text
Hard Cases
New Tasks
Edge Cases
Adversarial Cases
```

---

## Step 8：加入 Trace Evaluation

评估：

```text
Tool Selection
Tool Input
Trajectory
Retry
Escalation
Policy
```

---

## Step 9：加入 Security Evaluation

至少包含：

```text
Prompt Injection
Data Exfiltration
Unauthorized Tool
Privilege Escalation
Sensitive Data Leakage
```

---

## Step 10：加入 Human Review

不是所有 Case，而是：

```text
High-risk
Sample
Disagreement
New Failure
Judge Calibration
```

---

## Step 11：把 Evaluation 接入 CI/CD

例如：

```text
PR
 ↓
Critical Regression
 ↓
Tool / Policy Tests
 ↓
Judge Sample
 ↓
PASS
```

---

## Step 12：上线后做 Online Evaluation

```text
Production
 ↓
Sampling
 ↓
Online Eval
 ↓
Alert
 ↓
Review
 ↓
New Dataset
```

---

# 47. 一个适合企业 Agent Platform 的最小 Evaluation Architecture

如果不希望一开始过度设计，可以先做：

```text
                Agent Platform
                     │
                     ▼
              Trace / Telemetry
                     │
          ┌──────────┴──────────┐
          ▼                     ▼
     Offline Eval           Online Eval
          │                     │
          ▼                     ▼
      Dataset              Production Sample
          │                     │
    ┌─────┼─────┐               │
    ▼     ▼     ▼               ▼
   Code  Judge Human         Monitoring
    │     │     │               │
    └─────┼─────┘               │
          ▼                     │
        Score                   │
          │                     │
          └──────────┬──────────┘
                     ▼
              Failure Analysis
                     │
                     ▼
              Regression Dataset
```

第一阶段甚至不需要自己开发复杂 Evaluation Product。

可以先用：

```text
Dataset
+
Trace
+
Code Evaluator
+
LLM Judge
+
Human Review
```

把闭环跑通。

---

# 48. 再往后，平台应该沉淀什么能力

成熟以后，平台应该逐渐形成：

```text
1. Evaluation Dataset Registry
2. Dataset Versioning
3. Trace Store
4. Evaluator Registry
5. Evaluation Runner
6. Experiment Tracking
7. Human Review
8. Regression Management
9. Release Gates
10. Online Evaluation
11. Failure Taxonomy
12. Risk / Policy Integration
13. Judge Calibration
14. Business Outcome Integration
```

最重要的是：

```text
Dataset
+
Trace
+
Evaluator
+
Version
+
Result
```

五者必须可以关联。

---

# 49. Evaluation Platform 最终应该回答哪些问题

一个成熟平台应该能够直接回答：

### 这个 Agent 现在有多好？

```text
Correctness
Groundedness
Task Success
```

### 为什么不好？

```text
Retrieval
Reasoning
Tool
Policy
Data
```

### 哪个版本变差了？

```text
Model
Prompt
Skill
Tool
Index
Policy
```

### 为什么变差？

```text
Regression Case
```

### 生产环境是否正在变差？

```text
Online Evaluation
```

### 是否安全？

```text
Unauthorized Action
Data Leakage
Prompt Injection
Policy Violation
```

### 是否值得继续使用？

```text
Business Outcome
Cost
Latency
User Acceptance
```

如果平台只能回答：

```text
Score = 87
```

那么它还不是真正意义上的企业 Agent Evaluation Platform。

---

# 50. Evaluation 与 Model Risk Management 的关系

金融机构不应该简单把：

```text
AI Evaluation
```

等同于：

```text
Model Validation
```

两者有重叠，但不是完全相同。

传统 Model Risk Management 更强调：

```text
Model
Assumptions
Data
Methodology
Validation
Monitoring
Governance
```

而 Agent Evaluation 还需要考虑：

```text
Prompt
Skill
Tool
Trajectory
Workflow
Human Interaction
External Data
Agent State
Policy
Authorization
```

美国 2026 年新版 Model Risk Management Guidance 明确采用 risk-based 方法，并强调模型开发和使用、测试、验证和监控、治理和控制；但该 guidance 同时明确 GenAI 和 Agentic AI 目前不在其直接 scope，因此企业不能直接把传统 MRM 文档模板原封不动当作 Agent Evaluation 体系。

英国央行 2026 年 AI Roundtable 更直接提出：随着 GenAI 和 Agentic AI 扩展，传统 MRM 的验证方式本身需要演进，应更多强调整个 AI 系统的测试、监控以及 Guardrails。

因此更合理的是：

```text
                  AI Governance
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
   Model Risk       Agent Eval     Security
        │              │              │
        └──────────────┼──────────────┘
                       ▼
                 Business Risk
```

---

# 51. Evaluation 不只是为了“模型好不好”，也是为了决定“AI 适不适合这个业务”

这点非常容易被忽视。

例如：

```text
Use Case A
Accuracy = 98%
```

但是：

```text
False Negative
会造成重大金融损失
```

那么：

```text
98%
```

仍然可能不能接受。

相反：

```text
Use Case B
Accuracy = 90%
```

如果：

```text
Read-only
Human Review
Low Risk
```

可能完全可接受。

因此最终：

> **Evaluation 的目标不是寻找一个“最高分模型”，而是证明某个 AI 系统在特定业务、特定风险和特定控制边界下是否达到可接受标准。**

NIST AI RMF 的 `Manage` function 也强调，应根据风险、影响和系统目的决定是否继续开发或部署，而不是把模型分数本身当成最终决定。

---

# 52. 一个更适合金融企业的 Evaluation 思维方式

可以把最终评价拆成：

```text
Can it work?
      ↓
Capability

Does it work correctly?
      ↓
Quality

Does it work consistently?
      ↓
Reliability

Does it stay within the rules?
      ↓
Safety / Policy

Can it be operated safely?
      ↓
Operational

Does it improve the business?
      ↓
Business Outcome
```

所以：

```text
Evaluation
=
Capability
+
Correctness
+
Reliability
+
Safety
+
Business Outcome
```

---

# 53. 最终建议：企业内部 Agent Platform 应该把 Evaluation 当成 Control Plane 的一部分

如果内部建设 AI Agent Platform，最不应该做的是：

```text
Agent Runtime
    +
一个 Evaluation 页面
```

真正合理的结构应该是：

```text
                    Agent Control Plane
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
     Registry            Policy             Evaluation
        │                   │                   │
        │                   │          ┌────────┼────────┐
        │                   │          ▼        ▼        ▼
        │                   │        Offline   Online   Human
        │                   │          │        │        │
        └───────────────────┼──────────┼────────┼────────┘
                            ▼
                       Release Gate
                            │
                            ▼
                      Agent Runtime
                            │
                            ▼
                         Tools
                            │
                            ▼
                      Business System
```

Evaluation 不只是：

```text
“这个模型是多少分。”
```

它应该决定：

```text
这个 Agent 能不能发布？
能不能升级 Model？
能不能换 Prompt？
能不能换 Skill？
能不能换 Tool？
能不能扩大权限？
能不能进入生产？
```

---

# 54. 最终可以浓缩成十条原则

### 1. Evaluation 评估的是系统，不只是模型

```text
Model
+
RAG
+
Tool
+
Agent
+
Policy
+
Business Outcome
```

---

### 2. Evaluation 不是 Benchmark

Benchmark 测通用能力。

企业 Evaluation 测：

```text
Business-specific Success
+
Risk-specific Constraints
```

---

### 3. Dataset 是 Evaluation 的核心资产

没有高质量 Dataset：

```text
Evaluation Score
```

很难有真正意义。

---

### 4. Ground Truth 不一定是标准答案

Agent 更适合：

```text
Expected Outcome
+
Assertions
+
Constraints
+
Allowed Actions
+
Forbidden Actions
```

---

### 5. 能代码判断的，不要让 LLM 判断

```text
Schema
Tool Params
Authorization
Forbidden Action
State
Latency
```

优先 Code Evaluator。

---

### 6. LLM Judge 必须校准

```text
LLM Judge
+
Human Ground Truth
```

才可以用于规模化质量判断。

---

### 7. Regression Dataset 比一次性 Benchmark 更重要

真正生产环境最怕：

```text
今天修好 A
明天又把 B 修坏。
```

所以：

```text
Every Production Failure
→ Regression Case
```

---

### 8. Trace 是 Agent Evaluation 的基础数据

没有：

```text
Tool
Retrieval
Trajectory
State
```

就无法真正知道 Agent 为什么错。

---

### 9. 高风险业务不能靠平均分通过

```text
Overall = 97%
```

不能掩盖：

```text
Unauthorized Action = 0.1%
```

应该使用：

```text
Hard Safety Gate
```

---

### 10. Evaluation 最终衡量的不是“AI 有多聪明”，而是“AI 是否足够可靠地完成特定业务”

最终判断应该是：

```text
Capability
+
Correctness
+
Consistency
+
Safety
+
Business Value
```

而不是：

```text
Model Benchmark Score
```

---

# 55. 结论

企业内部搭建 AI Agent Platform，Evaluation 不应该被理解成开发结束以后加上的测试工具。

它实际上应该从一开始就进入整个 Agent 生命周期：

```text
Use Case
   ↓
Risk Classification
   ↓
Success Contract
   ↓
Dataset
   ↓
Evaluator
   ↓
Baseline
   ↓
Development
   ↓
Regression
   ↓
Security / Safety
   ↓
Release Gate
   ↓
Production
   ↓
Online Evaluation
   ↓
Failure Analysis
   ↓
New Dataset
   ↓
Regression
```

业界已经出现了比较清晰的共同方向：

Anthropic 把 Agent Evaluation 明确拆成 Code、Model、Human 三类 Grader，并区分 Capability Eval 和 Regression Eval。

Microsoft 已经把 Task Completion、Task Adherence、Tool Selection、Tool Input、Tool Output、Navigation Efficiency 和 Safety 做成独立 Agent Evaluators。

AWS AgentCore 已经把 Ground Truth、Goal Success、Trajectory Matching、Batch Evaluation 和 Online Evaluation 都作为 Agent Evaluation 的基础能力。

BBVA 则进一步展示了金融 Agent 如何从 RAG Grounding、Fallback、Intent Routing、Clarification 到 Transaction Entity Extraction 做细粒度 Evaluation。

Morgan Stanley 说明金融机构可以把 Evaluation 直接放进每个 AI Use Case 的上线流程，并持续使用 Regression Suite。

DBS 则展示了当 AI 从几十个 PoC 走向数千模型、数百业务用例之后，Evaluation 必须与数据治理、Model Governance、Reusable Components 和企业级 AI Platform 一起建设。

因此，对于金融服务企业，一个真正可用的 Agent Evaluation Platform 应该最终回答六个问题：

```text
1. Agent 能不能完成任务？

2. 它完成得对不对？

3. 它是否稳定？

4. 它有没有越过 Policy / Authorization / Security Boundary？

5. 出错以后，能不能知道为什么？

6. 它是否真的改善了业务结果？
```

最终：

> **Evaluation 不是给 Agent 打分，而是建立一套能够证明“这个 Agent 在这个业务、这个数据、这个风险等级和这个控制边界下是否值得被允许运行”的工程与治理机制。**

---

# 参考资料

## Agent Evaluation 与行业实践

1. **Anthropic — Demystifying evals for AI agents**
   Agent Evaluation、Code/Model/Human Grader、Capability vs Regression、Dataset 构建、pass@k / pass^k。
   [Anthropic — Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents?utm_source=chatgpt.com)

2. **Anthropic — Building Effective Agents**
   Agent、Workflow、Tool Use、动态 orchestration 的基础架构讨论。
   [Anthropic — Building Effective Agents](https://www.anthropic.com/engineering/building-effective-agents?utm_source=chatgpt.com)

3. **Microsoft — Agent Evaluators for Generative AI**
   Task Completion、Task Adherence、Tool Selection、Tool Input Accuracy、Tool Output Utilization、Task Navigation Efficiency 等。
   [Microsoft — Agent Evaluators](https://learn.microsoft.com/en-us/azure/foundry/concepts/evaluation-evaluators/agent-evaluators?utm_source=chatgpt.com)

4. **Microsoft — Evaluate your AI agents**
   Dataset、Agent Evaluation、Rubric、Safety、Workflow Integration。
   [Microsoft — Evaluate your AI agents](https://learn.microsoft.com/en-us/azure/foundry/observability/how-to/evaluate-agent?utm_source=chatgpt.com)

5. **Microsoft Agent Framework — Evaluation**
   Agent / Workflow Evaluation、Expected Output、Pre-existing Response、Multiple Evaluators。
   [Microsoft Agent Framework — Evaluation](https://learn.microsoft.com/en-us/agent-framework/agents/evaluation?utm_source=chatgpt.com)

6. **AWS — Amazon Bedrock AgentCore Evaluations**
   Agent Trace、Goal Success、Correctness、Tool Evaluation、Custom Evaluators。
   [AWS — AgentCore Evaluations](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/evaluations.html?utm_source=chatgpt.com)

7. **AWS — Ground Truth Evaluations**
   Expected Response、Assertions、Expected Trajectory。
   [AWS — Ground Truth Evaluations](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/ground-truth-evaluations.html?utm_source=chatgpt.com)

8. **AWS — Evaluation Types**
   Online、On-demand、Batch Evaluation。
   [AWS — AgentCore Evaluation Types](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/evaluations-types.html?utm_source=chatgpt.com)

9. **AWS — Dataset Evaluation**
   Dataset-driven Agent Evaluation、CI/CD、Regression、Baseline、Pre/Post Comparison。
   [AWS — AgentCore Dataset Evaluation](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/dataset-evaluations.html?utm_source=chatgpt.com)

10. **LangChain — Evaluation Types**
    Benchmarking、Unit Test、Regression、Backtesting、Online Evaluation、LLM-as-Judge、Code Evaluator。
    [LangSmith — Evaluation Types](https://docs.langchain.com/langsmith/evaluation-types?utm_source=chatgpt.com)

11. **OpenAI Agents SDK — Tracing**
    Agent、LLM、Tool、Handoff、Guardrail 的完整 Trace / Span。
    [OpenAI Agents SDK — Tracing](https://openai.github.io/openai-agents-python/tracing/?utm_source=chatgpt.com)

12. **OpenAI Agents SDK — Testing**
    Deterministic Agent Workflow Testing、Tool/Handoff/Guardrail/Retry 测试。
    [OpenAI Agents SDK — Testing](https://openai.github.io/openai-agents-python/testing/?utm_source=chatgpt.com)

---

## 生成式 AI / Evaluation 方法

13. **Google Cloud — Evaluate Judge Models**
    用 Human Rating Ground Truth 校准 LLM-as-a-Judge。
    [Google Cloud — Evaluate a Judge Model](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/evaluate-judge-model?utm_source=chatgpt.com)

14. **Google Cloud — Evaluate Agents using Vertex AI**
    Agent Dataset、Inference、Evaluation Run、Results。
    [Google Cloud — Evaluate Agents](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/agent-engine/evaluate?utm_source=chatgpt.com)

15. **NIST — AI Risk Management Framework 1.0**
    Govern / Map / Measure / Manage，以及 TEVV、部署前和生产持续评估。
    [NIST AI RMF Core](https://airc.nist.gov/airmf-resources/airmf/5-sec-core/?utm_source=chatgpt.com)

16. **NIST — Measure Function / Playbook**
    Test Set、Metrics、Independent Review、Production Monitoring、Safety、Security、Reliability。
    [NIST AI RMF — Measure](https://airc.nist.gov/airmf-resources/playbook/measure/?utm_source=chatgpt.com)

---

## 金融机构实际案例

17. **Morgan Stanley — AI Evals in Financial Services**
    每个 AI Use Case 上线前 Evaluation、专家评估、Evaluation Dataset、Daily Regression。
    [OpenAI — Morgan Stanley uses AI evals to shape the future of financial services](https://openai.com/index/morgan-stanley/?utm_source=chatgpt.com)

18. **Morgan Stanley / OpenAI — AI in the Enterprise**
    Translation、Summarization、Human Expert Evaluation 等早期 Evaluation 实践。
    [OpenAI — AI in the Enterprise](https://cdn.openai.com/business-guides-and-resources/ai-in-the-enterprise.pdf?utm_source=chatgpt.com)

19. **BBVA AI Factory — AI Evaluation in the Age of Agents**
    RAG Grounding、Relevance、Usefulness、Fallback、Routing、F1、Confusion Matrix、Clarification、Entity Hallucination。
    [BBVA AI Factory — AI Evaluation in the Age of Agents](https://www.bbvaaifactory.com/ai-agents-evaluation/?utm_source=chatgpt.com)

20. **DBS — CIO Statement 2025**
    2,000+ AI Models、430+ Use Cases、GenAI Framework、Reusable Components、Governance、Workflow Capabilities。
    [DBS — CIO Statement 2025](https://www.dbs.com/annualreports/2025/cio-statement.html?utm_source=chatgpt.com)

21. **DBS — Responsible and Ethical AI in Banking**
    Responsible Data Use、PURE、Materiality、AI Registry、Model Governance、Responsible AI Taskforce。
    [DBS — Responsible and Ethical AI in Banking](https://www.dbs.com/artificial-intelligence-machine-learning/artificial-intelligence/ethical-and-responsible-ai-in-banking.html?utm_source=chatgpt.com)

---

## 金融监管 / Model Risk / AI Risk

22. **Federal Reserve — SR 26-2 Revised Guidance on Model Risk Management**
    2026 年新版、risk-based Model Risk Management。
    [Federal Reserve — SR 26-2](https://www.federalreserve.gov/supervisionreg/srletters/SR2602.htm?utm_source=chatgpt.com)

23. **OCC — Bulletin 2026-13 Revised Model Risk Management Guidance**
    Model Testing、Validation、Monitoring、Governance、Vendor Model；同时明确 GenAI / Agentic AI 当前不在该 guidance scope。
    [OCC — Model Risk Management: Revised Guidance](https://www.occ.treas.gov/news-issuances/bulletins/2026/bulletin-2026-13.html?utm_source=chatgpt.com)

24. **Bank of England — SS1/23 Model Risk Management Principles**
    Model Identification、Governance、Development & Use、Independent Validation、Risk Mitigants；2026 年版本自 2026-04-23 生效。
    [Bank of England — SS1/23 Model Risk Management](https://www.bankofengland.co.uk/prudential-regulation/publication/2023/may/model-risk?utm_source=chatgpt.com)

25. **Bank of England — Summary of AI Roundtables, February 2026**
    直接讨论传统 Model Risk Management 对 GenAI/Agentic AI 的局限，以及测试、监控和 Guardrail 的重要性。
    [Bank of England — AI Roundtables 2026](https://www.bankofengland.co.uk/minutes/2026/february/summary-of-ai-roundtables-feb-2026?utm_source=chatgpt.com)

---

## Agent Evaluation 学术研究与安全 Benchmark

26. **AgentBench — Evaluating LLMs as Agents**
    多环境、Multi-turn Agent Evaluation。
    [AgentBench](https://arxiv.org/abs/2308.03688?utm_source=chatgpt.com)

27. **GAIA — A Benchmark for General AI Assistants**
    工具使用、Web、Reasoning、多模态等综合 Agent 能力。
    [GAIA Benchmark](https://arxiv.org/abs/2311.12983?utm_source=chatgpt.com)

28. **AgentDojo — Evaluating Prompt Injection Attacks and Defenses**
    Agent Tool Use、Prompt Injection、银行网站、邮件等动态环境安全评估。
    [AgentDojo](https://arxiv.org/abs/2406.13352?utm_source=chatgpt.com)

29. **Google Research — Towards a Science of Scaling Agent Systems**
    研究多 Agent 的任务结构、并行性、顺序依赖与性能之间的关系。
    [Google Research — Scaling Agent Systems](https://research.google/blog/towards-a-science-of-scaling-agent-systems-when-and-why-agent-systems-work/?utm_source=chatgpt.com)

---

## 一组最值得重点阅读的核心资料

如果只保留一组，建议优先阅读：

```text
Anthropic
→ Demystifying Evals for AI Agents

BBVA
→ AI Evaluation in the Age of Agents

Morgan Stanley
→ AI Evals in Financial Services

AWS AgentCore
→ Ground Truth / Online / Batch Evaluation

Microsoft
→ Agent Evaluators

Google
→ Judge Model Evaluation

NIST
→ AI RMF Measure / Manage

Federal Reserve / OCC
→ 2026 Revised Model Risk Management Guidance

Bank of England
→ AI Roundtables 2026

DBS
→ Enterprise AI Governance + GenAI Framework
```

这组资料基本能够覆盖：

```text
Evaluation 是什么
↓
为什么 Agent 难评估
↓
Dataset 怎么建设
↓
Ground Truth 怎么定义
↓
LLM Judge 怎么使用
↓
Trace / Trajectory 怎么评
↓
Production 怎么持续评
↓
金融机构实际怎么做
↓
金融 Model Risk / Governance 怎么接
```



--------------


需要，但**不是所有 Evaluation 都需要 Human-in-the-loop，更不是每次运行 Agent 都需要使用者打分**。这三个概念最好严格分开：

```text
1. Evaluation 中的人
   → Human Evaluation / SME Review

2. 真实使用者的参与
   → User Feedback / Production Feedback

3. Agent 执行过程中需要人批准
   → Human-in-the-loop Execution
```

它们不是一回事。

## 1. Evaluation 本身：需要 Human，但应该是“少量、高价值”

最合理的结构是：

```text
大量 Case
   ↓
Code Evaluator
   ↓
LLM Judge
   ↓
少量 Human Review
```

Anthropic 公开的 Agent Evaluation 方法就是 **code-based + model-based + human graders** 的组合，并明确指出 systematic human studies 更适合主观输出和校准 LLM Judge，而不是让人给所有 Case 手工评分。([Anthropic][1])

尤其金融场景，我会要求 Human 参与下面几类：

```text
新业务第一次建立 Eval
高风险业务
主观判断
新的 Model / Agent Architecture
LLM Judge Calibration
重大 Regression
重大 Production Incident
争议 Case
```

例如 Fraud Investigation：

```text
Agent 输出：
“建议调查账户 A、B、C。”

Human SME
→ 判断这个调查建议是否合理
→ 判断证据是否充分
→ 判断是否漏掉重要风险
```

这些结果再用于：

```text
Gold Dataset
+
Judge Calibration
+
Regression Dataset
```

---

## 2. 使用者也应该参与，但不要把“用户点赞”当 Ground Truth

这个区别非常重要。

用户反馈：

```text
👍
👎
“回答不对”
“没有解决我的问题”
“这个结果很好”
```

非常有价值，因为它告诉你：

> **真实用户认为哪里有问题。**

Anthropic 把 User Feedback、Production Monitoring、A/B Testing 和 Manual Transcript Review 与 Automated Evals 并列，认为它们共同形成完整的 Agent 质量信号；同时也明确指出用户反馈具有稀疏、自选择、容易偏向严重问题等局限。([Anthropic][1])

所以：

```text
User Feedback
≠
Ground Truth
```

更合理的是：

```text
User Feedback
     ↓
Failure Candidate
     ↓
Human / SME Review
     ↓
Root Cause
     ↓
Evaluation Dataset
```

例如：

```text
用户点 👎
```

不能直接变成：

```text
expected = wrong
```

而应该进入：

```text
Review Queue
```

然后专家判断到底是：

```text
Retrieval Error
Grounding Error
Reasoning Error
Tool Error
User Intent Error
Policy Error
```

最后才加入 Regression Dataset。

---

## 3. NIST 的观点也很明确：最终评估需要用户、领域专家和独立评估者的参与

NIST AI RMF 明确要求：

* 定期评估应有内部非一线开发专家或独立评估者参与；
* 根据风险情况，可以咨询 domain experts、users 以及受影响群体；
* 应建立 end-user feedback 机制，并把反馈纳入 AI system evaluation；
* 生产环境中的实际表现也应反过来影响 Evaluation。([NIST AI Resource Center][2])

NIST 甚至专门强调，AI 生命周期中的 Human Factors 应包括 end-user involvement、user experience evaluation 和 human-centered evaluation。([NIST Publications][3])

所以对于企业平台，更准确的模型是：

```text
                    Evaluation
                         │
       ┌─────────────────┼─────────────────┐
       ▼                 ▼                 ▼
 Automated Eval      Human Eval       User Feedback
       │                 │                 │
       │                 ▼                 │
       │            Calibration            │
       │                 │                 │
       └─────────────────┼─────────────────┘
                         ▼
                  Production Evidence
                         │
                         ▼
                 Regression Dataset
```

---

## 4. 但“Evaluation 中需要 Human”不等于“Agent 运行时必须 Human Approval”

这是最容易混淆的地方。

### Evaluation Human

回答：

> 这个 Agent 做得对不对？

例如：

```text
Compliance Expert
→ 给 100 个案例评分
```

### Execution Human-in-the-loop

回答：

> Agent 这次准备做的业务动作，是否允许真正执行？

例如：

```text
Agent
 ↓
“建议冻结账户”
 ↓
Human Approval
 ↓
Freeze Account
```

这两者完全不同。

一个低风险知识 Agent：

```text
Agent
→ Research
→ Answer
```

可能：

```text
Evaluation：需要 Human Review
Production Execution：完全不需要 Human Approval
```

反过来，一个高度确定的 Payment Workflow：

```text
Workflow
→ Payment
```

可能：

```text
Evaluation：主要自动化
Production Execution：关键节点必须 Human Approval
```

---

## 5. 对你们这种金融 Agent Platform，我建议采用四层 Human Participation

### 第一层：SME 建立 Ground Truth

业务专家参与：

```text
Success Criteria
Expected Outcome
Allowed Behavior
Forbidden Behavior
Risk Level
```

这是最重要的一次人工参与。

---

### 第二层：Human Calibration

定期抽样：

```text
Agent Result
+
LLM Judge Result
+
Human Expert Result
```

检查：

```text
Judge 是否可信？
Rubric 是否正确？
```

不需要每条都人工看。

---

### 第三层：User Feedback

生产环境持续收集：

```text
Thumbs Up / Down
Correction
Rejection
Retry
Escalation
Task Abandonment
Manual Override
```

尤其重要的是，**不要只收显式反馈**。

用户行为本身也是反馈：

```text
Agent 给出答案
 ↓
用户重新问一次
```

可能意味着：

```text
Answer insufficient
```

又例如：

```text
Agent 建议
 ↓
用户完全不采用
```

可能是：

```text
Low trust
Low usefulness
```

这些都可以作为 Evaluation Signal。

---

### 第四层：高风险人工复核

对于：

```text
交易
付款
账户修改
信用审批
高风险合规判断
监管申报
```

Human Review 不是 Evaluation，而是**业务控制机制**。

---

# 6. 因此，一个企业 Agent Platform 不应该要求“用户给每次 Agent 打分”

这是我认为你那篇文章里可以明确写的一条原则：

> **用户反馈是 Evaluation 的重要输入，但不应该成为 Evaluation 的主要 Ground Truth。**

推荐：

```text
                       Ground Truth
                            │
             ┌──────────────┼──────────────┐
             ▼              ▼              ▼
         Business       Human SME      Production
        Requirements     Judgment        Evidence
             │              │              │
             └──────────────┼──────────────┘
                            ▼
                    Evaluation Dataset
                            │
             ┌──────────────┼──────────────┐
             ▼              ▼              ▼
           Code          LLM Judge        Human
          Grader           Grader         Review
             │              │              │
             └──────────────┼──────────────┘
                            ▼
                         Release
```

而：

```text
User Feedback
Production Outcome
Support Tickets
Manual Corrections
```

不断反哺：

```text
Evaluation Dataset
```

---

## 7. 如果是金融服务，我会特别建议再增加一个角色：Independent Reviewer

不要让：

```text
Agent Developer
```

同时负责：

```text
设计 Eval
+
定义 Ground Truth
+
修改 Agent
+
决定 Eval 是否通过
```

NIST 明确建议定期评估应引入**没有参与一线开发的内部专家或独立评估者**，并根据风险情况吸收领域专家和用户意见。([NIST AI Resource Center][2])

所以高风险 Agent 更适合：

```text
Business Owner
     ↓
SME / Evaluator
     ↓
Agent Team
     ↓
Independent Review
     ↓
Release Gate
```

---

## 最终结论

可以把它压缩成一句：

> **Evaluation 必须有人参与，但不应该人工评所有 Case；使用者应该持续提供真实反馈，但不应该由用户反馈单独定义 Ground Truth；高风险业务则另外需要 Runtime Human Approval。**

对应到三个层面：

| 场景                       | 是否需要人   | 人做什么               |
| ------------------------ | ------- | ------------------ |
| 自动 Evaluation            | 不需要逐条人工 | Code / Judge 大规模运行 |
| Evaluation Dataset 建设    | 需要      | SME 定义“什么叫正确”      |
| LLM Judge Calibration    | 需要抽样    | 检查 Judge 是否可靠      |
| Production User Feedback | 推荐      | 发现真实世界问题           |
| 高风险 Agent 执行             | 视业务风险需要 | 审批/授权真实业务动作        |
| 每次 Agent 都人工评分           | 通常不需要   | 成本太高且不可规模化         |

最成熟的模式不是：

```text
AI → Human → AI → Human
```

而是：

```text
            Automated Evaluation
                    ↓
             Human Calibration
                    ↓
              Production
                    ↓
              User Feedback
                    ↓
              Failure Review
                    ↓
             Regression Dataset
                    ↓
            Automated Evaluation
```

这实际上非常接近 Anthropic 当前公开描述的实践：**自动 Evaluation 负责规模和回归，Production Monitoring 负责真实世界信号，User Feedback 负责发现意料之外的问题，Human Evaluation 主要用于校准和主观/高风险判断。** ([Anthropic][1])

[1]: https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents?utm_source=chatgpt.com "Demystifying evals for AI agents \ Anthropic"
[2]: https://airc.nist.gov/airmf-resources/airmf/5-sec-core/?utm_source=chatgpt.com "AI RMF Core - AIRC"
[3]: https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-1.pdf?utm_source=chatgpt.com "Artificial Intelligence Risk Management Framework (AI RMF 1.0)"



----------------------


有。**如果你的标准是“尽量贴近 Anthropic《Demystifying evals for AI agents》里总结的经验，而不是单纯做 RAG/LLM 打分”**，我会重点看下面几个。

### 1. Harbor：最贴近 Anthropic 这篇文章

这是我最推荐先研究的一个。

Anthropic 的文章本身就把 **Harbor** 列为 Agent Evaluation 的代表性开源框架，并描述它支持：

```text
Task
Trial
Transcript / Trajectory
Graders
Environment
多次运行
大规模并行
```

这和 Anthropic 文章里的概念几乎一一对应：

```text
Task
→ Trial
→ Transcript
→ Code / Model / Human Grader
→ pass@k / pass^k
```

Harbor 当前可以直接运行 Claude Code、OpenHands、Codex CLI 等不同 Agent，也支持 Docker / Daytona / Modal 等 sandbox，并把 task、environment、tests、solution 作为标准评估单元。([Anthropic](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents?utm_source=chatgpt.com)) ([Anthropic][1])

[Harbor GitHub](https://github.com/harbor-framework/harbor?utm_source=chatgpt.com)
[Harbor Documentation](https://harborframework.com/?utm_source=chatgpt.com)
[Harbor Cookbook](https://github.com/harbor-framework/harbor-cookbook?utm_source=chatgpt.com)

它尤其适合：

```text
Coding Agent
Computer Use
Tool-heavy Agent
真实环境交互
Sandbox
多轮执行
Outcome-based Evaluation
```

而且它的概念和你现在研究的：

```text
Agent
+
Skill
+
Tool
+
Environment
+
Evaluation
```

非常接近。

**缺点**：它偏“Agent benchmark / execution environment”，如果你要做的是企业内部大量业务 Agent 的日常 Regression、RAG、Tool、Business Outcome Evaluation，它不是最轻量的起点。

---

### 2. Inspect AI：如果你要一个真正“Evaluation Framework”，我反而很推荐

**Inspect AI 是目前我认为最值得和 LangSmith 正面比较的开源 Evaluation Framework 之一。**

它由英国 AI Security Institute（AISI）维护，不是一个普通创业公司的 LLM eval SDK。它原生支持：

```text
Dataset
Task
Solver
Scorer
Model
Tool
Multi-turn
Agent
Sandbox
```

并且支持直接运行：

```text
Claude Code
Codex CLI
Gemini CLI
其他 external agents
```

还支持 Docker / Kubernetes 等 sandbox。官方仓库目前已经包含 **200+ pre-built evaluations**。([Inspect][2])

[Inspect AI Documentation](https://inspect.aisi.org.uk/?utm_source=chatgpt.com)
[Inspect AI GitHub](https://github.com/UKGovernmentBEIS/inspect_ai?utm_source=chatgpt.com)

它的模型非常适合你现在的研究：

```text
Task
 ↓
Solver / Agent
 ↓
Transcript
 ↓
Scorer
 ↓
Metric
```

和 Anthropic 的：

```text
Task
 ↓
Trial
 ↓
Transcript
 ↓
Grader
```

思路高度接近。

而且 Inspect 的 Scorer / Metric 是很明确的一等公民，可以做：

```text
Code-based
Model-based
Custom
Multiple Scorers
```

当前源码也支持对 Eval Log 重新 scoring，这对你做不同 evaluator / rubric 反复重算很有价值。([GitHub][3])

**如果让我选一个“企业内部 Agent Evaluation Framework 的架构参考”，我会把 Inspect AI 放在非常靠前的位置。**

---

### 3. DeepEval：如果你想快速接进现有 Agent 平台，它反而可能最好用

DeepEval 和 Anthropic 文章里的很多方法非常接近，但它不是“Anthropic 官方风格”，而是一个通用开源 LLM/Agent Evaluation Framework。

它现在已经明确支持：

```text
Black-box Eval
Trajectory Eval
Component-level Eval
Tool Use
Retrieval
Subagents
Task Completion
Plan Quality
Plan Adherence
Step Efficiency
```

而且把 Agent Evaluation 明确拆成：

```text
Reasoning Layer
Action Layer
Execution Layer
```

例如：

```text
PlanQualityMetric
PlanAdherenceMetric
ToolCorrectnessMetric
ArgumentCorrectnessMetric
TaskCompletionMetric
StepEfficiencyMetric
```

这个结构和 Anthropic 所讲的：

```text
最终 outcome
+
transcript
+
tool calls
+
multiple graders
```

非常契合。([GitHub][4])

[DeepEval GitHub](https://github.com/confident-ai/deepeval?utm_source=chatgpt.com)
[DeepEval Agent Evaluation](https://deepeval.com/guides/guides-ai-agent-evaluation?utm_source=chatgpt.com)

对于你现在的技术栈：

```text
FastAPI
+
LangChain DeepAgents
+
Python
```

DeepEval 会比 Harbor 更容易直接接进去。

---

### 4. Phoenix + OpenInference：非常适合作为 Evaluation 的 Trace 基础设施

Phoenix 本身更偏：

```text
Observability
+
Tracing
+
Dataset
+
Evaluation
+
Experiment
```

但它最有价值的地方其实是 **OpenInference**。

OpenInference 已经定义了：

```text
Span Evaluation
Trace Evaluation
Session Evaluation
```

以及：

```text
Human
LLM
Code
```

几类 annotation / evaluation。([GitHub][5])

Phoenix 又原生支持很多 Agent Framework：

```text
OpenAI Agents SDK
Claude Agent SDK
LangGraph
CrewAI
LlamaIndex
Google ADK
AWS Bedrock
LiteLLM
...
```

所以对于你正在做的企业 Agent Platform，我比较看重：

```text
Agent Runtime
    ↓
OpenTelemetry / OpenInference
    ↓
Trace
    ↓
Evaluation
```

而不是把 Evaluation 完全绑死在 LangChain / LangSmith 上。([GitHub][6])

[Phoenix GitHub](https://github.com/Arize-ai/phoenix?utm_source=chatgpt.com)
[OpenInference GitHub](https://github.com/Arize-ai/openinference?utm_source=chatgpt.com)

---

### 5. promptfoo：如果你还非常重视 Security / Red Team

Promptfoo 更偏：

```text
Prompt Eval
+
Agent Eval
+
RAG Eval
+
Red Team
+
CI/CD
```

现在是开源 MIT，并且当前已经并入 OpenAI，但项目继续保持开源。([GitHub][7])

[promptfoo GitHub](https://github.com/promptfoo/promptfoo?utm_source=chatgpt.com)

它对于你们金融平台特别有价值的是：

```text
Prompt Injection
Data Leakage
Jailbreak
Policy Violation
Security Regression
```

所以我不会把它作为唯一 Evaluation Framework，但会考虑把它作为：

```text
Security Evaluation Layer
```

---

## 6. Anthropic 自己还有两个非常值得直接研究的东西

这两个甚至比第三方框架更值得看。

### Anthropic `skills` 里的 Grader Agent

Anthropic 现在公开的 `skills` 仓库里已经有一个 **Grader Agent**，它直接做：

```text
Expectations
+
Execution Transcript
+
Output Files
→
Pass / Fail
```

更有意思的是，它明确要求：

> 不只是判断结果，还要检查 Eval 本身是否足够强；一个弱 assertion 导致的 pass 可能比 fail 更危险，因为它制造了 false confidence。([GitHub][8])

这非常值得你拿来做内部平台设计原则。

[Anthropic Skills — Grader Agent](https://github.com/anthropics/skills/blob/main/skills/skill-creator/agents/grader.md?utm_source=chatgpt.com)

---

### Anthropic `skills` 里的 Evaluation Harness

Anthropic 的 MCP Builder skill 里面直接提供 evaluation harness：

```text
Evaluation Dataset
+
QA pairs
+
Evaluation Script
```

虽然非常简化，但它说明 Anthropic 自己在实际工程里并不是完全依赖某一个第三方 Evaluation SaaS。([GitHub][9])

[Anthropic Skills — Evaluation Harness](https://github.com/anthropics/skills/blob/main/skills/mcp-builder/reference/evaluation.md?utm_source=chatgpt.com)

---

# 7. OpenAI Evals 也值得看，但它不是最贴近 Agent Evaluation 的

OpenAI Evals 是非常成熟的开源框架和 benchmark registry：

```text
Dataset
+
Eval
+
Registry
+
Custom Eval
```

而且支持 private evals。([GitHub][10])

[OpenAI Evals GitHub](https://github.com/openai/evals?utm_source=chatgpt.com)

但如果你的目标是：

```text
Multi-turn Agent
Tool Calls
Trajectory
Environment
Trial
Agent State
```

我会把：

```text
Inspect AI
Harbor
DeepEval
```

放在它前面。

OpenAI Evals 更像：

> **通用 LLM/System Evaluation Framework**

而 Harbor / Inspect AI 已经明显更偏：

> **Agent Evaluation Harness**

---

# 8. 我会怎么排序

如果你的问题是：

> “我想找一个真正参考 Anthropic 这篇文章，而不是只做 LLM-as-a-Judge 的开源实现。”

我会这样看：

| 项目               | 和 Anthropic 方法契合度 | Agent Trajectory | Environment | 企业业务 Eval | 开源成熟度 |
| ---------------- | ----------------: | ---------------: | ----------: | --------: | ----: |
| **Harbor**       |                很高 |               很强 |          很强 |         中 |     高 |
| **Inspect AI**   |                很高 |               很强 |          很强 |         高 |    很高 |
| **DeepEval**     |                 高 |               很强 |           中 |    **很高** |    很高 |
| **Phoenix**      |                 高 |                强 |           中 |    **很高** |    很高 |
| **promptfoo**    |                中高 |               中高 |           中 |         高 |    很高 |
| **OpenAI Evals** |                 中 |                中 |           中 |         高 |    很高 |
| **AutoEvals**    |                 中 |                弱 |           弱 |         中 |     高 |

AutoEvals 更适合作为：

```text
Scorer Library
```

而不是完整 Agent Eval Framework。它提供了 LLM-as-a-Judge、heuristic、statistical 等 scorer，但本身不负责完整 Agent trajectory / environment harness。([GitHub][11])

[Braintrust AutoEvals GitHub](https://github.com/braintrustdata/autoevals?utm_source=chatgpt.com)

---

# 9. 对你现在这个企业 Agent Platform，我反而不建议“选一个替代 LangSmith”

更合理的架构是拆开：

```text
                    Agent Evaluation Platform

               ┌──────────────┴──────────────┐
               │                             │
         Eval Harness                    Trace Layer
               │                             │
      ┌────────┼────────┐                    │
      ▼        ▼        ▼                    ▼
   Inspect   Harbor   DeepEval          OpenInference
      │        │        │                    │
      └────────┼────────┘                    │
               ▼                             ▼
           Evaluators                    Phoenix
               │
      ┌────────┼────────┐
      ▼        ▼        ▼
     Code     LLM      Human
```

如果结合你现在的架构，我会更倾向：

```text
DeepAgents
     ↓
OpenInference / OTel
     ↓
Phoenix
     ↓
Inspect AI / DeepEval
     ↓
Enterprise Dataset
     ↓
Code + LLM Judge + Human
```

而 **Harbor 单独作为需要真实环境、sandbox、multi-turn、computer-use、coding-agent 的重型 Agent Eval Harness**。

---

## 10. 最关键的一点：Anthropic 自己其实没有说“使用某个 Eval Framework 就解决问题”

这也是这篇文章最值得注意的部分。

Anthropic 在文章最后明确说：

> framework 本身没有那么重要，最重要的是你运行在 framework 上面的 **eval tasks 和 graders**。他们建议快速选一个合适的 framework，然后把精力投入到高质量 test cases 和 graders。([Anthropic][1])

所以真正值得借鉴 Anthropic 的，不是：

```text
“Claude 用了哪个框架？”
```

而是这一套模型：

```text
Task
 ↓
Trial × N
 ↓
Transcript / Trajectory
 ↓
Multiple Graders
 ├── Code
 ├── Model
 └── Human
 ↓
pass@k / pass^k / Partial Credit
 ↓
Regression
 ↓
Production Monitoring
 ↓
User Feedback
 ↓
New Eval Cases
```

**如果只选两个开源项目深入研究，我会选：**

> **Inspect AI + DeepEval**

如果你还需要真实 sandbox / coding-agent / computer-use：

> **再加 Harbor**

如果你想把你们自己的 Agent Platform 做成长期可替换 LangSmith 的企业基础设施：

> **OpenInference + Phoenix 值得单独研究。**

这四个加起来，基本已经覆盖了 Anthropic 这篇文章里绝大部分值得工程化的东西。

[1]: https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents?utm_source=chatgpt.com "Demystifying evals for AI agents \ Anthropic"
[2]: https://inspect.aisi.org.uk/?utm_source=chatgpt.com "Inspect"
[3]: https://github.com/UKGovernmentBEIS/inspect_ai/blob/main/src/inspect_ai/_eval/score.py?utm_source=chatgpt.com "inspect_ai/src/inspect_ai/_eval/score.py at main · UKGovernmentBEIS/inspect_ai · GitHub"
[4]: https://github.com/confident-ai/deepeval?utm_source=chatgpt.com "GitHub - confident-ai/deepeval: The LLM Evaluation Framework · GitHub"
[5]: https://github.com/Arize-ai/openinference/blob/main/spec/annotations.md?utm_source=chatgpt.com "openinference/spec/annotations.md at main · Arize-ai/openinference · GitHub"
[6]: https://github.com/Arize-ai/phoenix?utm_source=chatgpt.com "GitHub - Arize-ai/phoenix: AI Observability & Evaluation · GitHub"
[7]: https://github.com/promptfoo/promptfoo?utm_source=chatgpt.com "GitHub - promptfoo/promptfoo: Test your prompts, agents, and RAGs. Red teaming/pentesting/vulnerability scanning for AI. Compare performance of GPT, Claude, Gemini, DeepSeek, and more. Simple declarative configs with command line and CI/CD integration. Used by OpenAI and Anthropic. · GitHub"
[8]: https://github.com/anthropics/skills/blob/main/skills/skill-creator/agents/grader.md?utm_source=chatgpt.com "skills/skills/skill-creator/agents/grader.md at main · anthropics/skills · GitHub"
[9]: https://github.com/anthropics/skills/blob/main/skills/mcp-builder/reference/evaluation.md?utm_source=chatgpt.com "skills/skills/mcp-builder/reference/evaluation.md at main · anthropics/skills · GitHub"
[10]: https://github.com/openai/evals?utm_source=chatgpt.com "GitHub - openai/evals: Evals is a framework for evaluating LLMs and LLM systems, and an open-source registry of benchmarks. · GitHub"
[11]: https://github.com/braintrustdata/autoevals?utm_source=chatgpt.com "GitHub - braintrustdata/autoevals: AutoEvals is a tool for quickly and easily evaluating AI model outputs using best practices. · GitHub"

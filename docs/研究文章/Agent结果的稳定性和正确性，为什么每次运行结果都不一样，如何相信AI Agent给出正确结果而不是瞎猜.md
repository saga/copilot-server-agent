# Agent 结果的稳定性和正确性：为什么每次运行结果都不一样，如何判断 AI Agent 不是在瞎猜

AI Agent 上线以后，很快会遇到两个看似简单、实际上完全不同的问题：

> 为什么同一个问题，Agent 每次运行出来的结果不一样？

以及更难的问题：

> 即使这次结果看起来很合理，我怎么知道它是正确的，而不是“很像正确答案的猜测”？

这两个问题经常被混成一个问题，但架构上必须分开。

**稳定性（stability）和正确性（correctness）不是同一个维度。**

一个 Agent 可以：

```text
每次都给出同一个错误答案
```

它非常稳定，但完全不可靠。

也可以：

```text
每次措辞、推理路径、工具调用略有不同
但最终事实、计算结果和业务结论都正确
```

它并不完全稳定，却可能是可靠的。

因此，企业 Agent 真正需要解决的，不是简单地让模型“每次都返回一样的答案”，而是建立一套机制，使结果能够：

```text
可重复
可验证
可解释
可追溯
可拒答
可纠错
```

尤其在金融服务领域，最终不能依赖：

> “这个答案看起来挺合理。”

而应该逐步变成：

> “这个结果有明确证据、计算依据、业务规则和验证结果，因此系统知道自己为什么认为它成立。”

这也是当前大型模型和 Agent 平台设计逐渐从“Prompt Engineering”走向“Evaluation、Verification、Observability 和 Control”的重要原因。Anthropic、AWS、Microsoft 和 OpenAI 当前的 Agent 评估体系，都已经明显从只看最终文本，转向同时评价任务完成、工具调用、轨迹、Ground Truth、Groundedness 和安全行为。

---

# 一、先把三个问题分开：稳定、正确、可信

可以把 Agent 的质量问题拆成三个层次。

## 1. 稳定性：Repeated Run 是否一致？

例如连续执行十次：

```text
问题：
客户 A 的当前投资组合风险敞口是多少？
```

结果可能是：

```text
Run 1 → 24.7%
Run 2 → 24.8%
Run 3 → 24.7%
Run 4 → 31.4%
```

这里关注的是：

> **同一输入和相近运行条件下，行为和结果是否稳定。**

---

## 2. 正确性：结果是否真的符合事实？

假设十次运行：

```text
24.7%
24.7%
24.7%
24.7%
...
```

但数据库真实值是：

```text
37.2%
```

那只是：

```text
Stable = Yes
Correct = No
```

因此：

> **重复得到同一个答案，并不能证明答案是正确的。**

NIST 对 Generative AI 的描述非常明确：模型可能生成“confabulation”，也就是以非常有把握的方式生成错误或虚假的内容；而且生成的“解释”和“引用”本身也可能是错误的。

---

## 3. 可信性：系统有没有足够证据支持这个结果？

真正生产环境里更有价值的问题是：

```text
这个结果：

依据什么数据？
来自哪个系统？
数据是什么时间点？
用了什么计算？
有没有业务规则？
有没有经过校验？
有没有发现冲突？
```

因此，一个成熟 Agent 的结果不应该只是：

```json
{
  "answer": "24.7%"
}
```

而应该逐步变成：

```json
{
  "answer": "24.7%",
  "status": "verified",
  "evidence": [
    "portfolio-2026-09-20",
    "market-price-2026-09-20T09:30"
  ],
  "calculation": "deterministic-tool-v3",
  "policyCheck": "passed",
  "freshness": "2026-09-20T09:30:15Z"
}
```

这已经不是单纯的“LLM 输出”。

它更像一个：

> **带证据的业务结果（Evidence-backed Result）。**

---

# 二、为什么 Agent 每次运行结果都会不一样？

最直接的原因是：LLM 本身不是传统意义上的确定性函数。

简化理解：

```text
传统函数

f(input) → output
```

而 LLM 更接近：

```text
P(output | input, context, model, sampling, runtime)
```

因此，同样的输入并不天然保证完全一样的输出。

OpenAI 曾专门提供 `seed` 和 `system_fingerprint` 来帮助获得“mostly consistent”的输出，同时明确指出这并不意味着严格意义上的确定性，即使 seed、请求参数和 backend fingerprint 都一致，也可能存在输出差异。

这意味着：

```text
temperature = 0
```

并不应该被理解为：

```text
temperature = 0
↓
系统变成 deterministic program
```

它最多是降低一部分随机变化。

---

# 三、Agent 比普通 LLM 更不稳定，因为它不只是“生成文本”

普通 LLM：

```text
Input
  ↓
LLM
  ↓
Text
```

Agent：

```text
Input
  ↓
LLM
  ↓
选择 Tool
  ↓
调用 Tool
  ↓
得到结果
  ↓
再次推理
  ↓
再次调用 Tool
  ↓
修改状态
  ↓
继续推理
  ↓
Final Result
```

一次运行中存在多个不确定点。

例如：

```text
Step 1
Search A

Step 2
Search B
```

也可能是：

```text
Step 1
Search B

Step 2
Search A
```

甚至：

```text
Run A
Search → Calculate → Answer

Run B
Search → Search → Calculate → Answer
```

最终答案可能一样，也可能不一样。

OpenAI 在 2026 年对第三方 Agent 评估的总结中特别指出，现代 Agent 的性能不能只看模型本身，因为 Agent 会使用工具、跨多步保存信息并处于更大的运行环境中，最终表现取决于整个 environment 和 setup。

Anthropic 也指出，与普通 chatbot 相比，Agent 会经历多轮交互、工具调用、中间状态修改和动态轨迹，因此不能只使用传统的 final-answer evaluation。

---

# 四、Agent 的“正确性”其实至少有六种

这是设计可靠 Agent 时最重要的一个概念。

很多团队说：

> “我们已经做了 Accuracy Evaluation。”

但实际上可能只评价了“最终文本像不像参考答案”。

对于企业 Agent，这远远不够。

---

## 1. Factual Correctness

事实是不是对的？

例如：

```text
客户 A 的持仓为 1,250,000 USD
```

是否真的如此。

---

## 2. Computational Correctness

计算是不是对的？

例如：

```text
Exposure =
∑ Position × Price × FX
```

Agent 即使会解释公式，也不应该成为真正的计算器。

应该由：

```text
deterministic code
calculator
SQL
Python
financial engine
```

完成计算。

LLM 负责：

```text
决定计算什么
解释计算结果
```

而不是：

```text
凭语言模型完成关键金融计算
```

---

## 3. Groundedness

答案有没有被提供给 Agent 的真实数据支持？

例如：

```text
Document A：
客户风险等级 = Moderate
```

Agent 却回答：

```text
客户风险等级 = High
```

即使语言非常流畅，也不是 grounded。

Microsoft 当前的 Agent Evaluator 已经把 Groundedness、Context Coverage、Tool Output Utilization 等作为独立评价维度；AWS AgentCore 也支持使用 ground truth 和 assertions 检查 Agent 行为。

---

## 4. Procedural Correctness

过程是否符合要求？

例如规定：

```text
先获取客户数据
→ 检查权限
→ 计算风险
→ 风险超过阈值则要求 Review
```

Agent 即使最后得出了正确数字，如果绕过了风险检查：

```text
Result Correct = Yes
Process Correct = No
```

对于金融业务，这仍然是失败。

---

## 5. Authorization Correctness

Agent 是否在它被授权的范围内行动？

例如：

```text
Agent 可以读取 Portfolio
但不能提交 Order
```

或者：

```text
Agent 可以为客户准备 Proxy Vote
但不能直接投票
```

这里即使 Agent 最终动作“看起来合理”，没有权限也不能执行。

---

## 6. Business Outcome Correctness

最后一个层次：

> **业务状态最终是不是正确的？**

例如：

```text
Agent 提交一个交易修改请求
```

工具返回：

```text
HTTP 200
```

并不意味着：

```text
业务状态已经正确更新
```

真正应该检查：

```text
订单状态
交易记录
审批记录
资金状态
持仓状态
```

是否达到预期 post-condition。

---

# 五、所以“如何相信 Agent”这个问题，本身就问错了一半

不应该设计成：

```text
Can I trust the model?
```

更合理的问题是：

```text
Can I verify this result?
```

两者差别非常大。

因为企业系统没有必要证明：

> “模型是可信的。”

真正需要证明的是：

> **“这一次结果满足我们要求的正确性条件。”**

这也是 NIST AI RMF 中 Validity、Reliability、Accuracy 和 Robustness 分开处理的原因。NIST 明确建议 AI 系统在部署前以及运行期间持续测试，并监控生产环境中的功能和行为；对于输出，应结合新的 ground truth、异常监测和人工复核来判断可靠性。

---

# 六、最重要的原则：让 LLM 负责“生成候选”，不要让它自己证明自己

可以把 Agent 理解成：

```text
LLM
 =
Candidate Generator
```

而不是：

```text
LLM
 =
Truth Oracle
```

例如：

```text
Agent：

“根据这些数据，我认为客户风险敞口是 24.7%。”
```

接下来不要马上：

```text
return answer
```

而应该进入：

```text
Verification
```

例如：

```text
读取原始数据
      ↓
重新计算
      ↓
检查单位
      ↓
检查时间点
      ↓
检查业务规则
      ↓
比较 Agent 结果
      ↓
通过 / 拒绝 / 要求修正
```

这才是企业 Agent 真正需要的架构。

---

# 七、第一道防线：不要让 LLM 做本来可以确定性完成的事情

一个非常实用的原则：

> **Anything deterministic should stay deterministic.**

例如：

### 金融计算

不要：

```text
LLM：
1.2 million × 7.3%
≈ 87,000
```

应该：

```text
LLM
 ↓
调用 calculation tool
 ↓
deterministic result
```

---

### SQL 查询

不要：

```text
LLM 从上下文里“记住”客户余额
```

应该：

```text
LLM
 ↓
生成受控 Query
 ↓
Database
 ↓
真实结果
```

---

### 权限判断

不要：

```text
Prompt：
You must not access restricted clients.
```

然后相信模型。

应该：

```text
Agent
 ↓
Identity
 ↓
Entitlement
 ↓
Policy Engine
 ↓
Allow / Deny
```

---

### 风险阈值

不要：

```text
LLM：
这个订单看起来风险不高。
```

应该：

```text
Order
 ↓
Deterministic Risk Rule
 ↓
Risk = 1.82%
Threshold = 1.50%
 ↓
BLOCK
```

AWS 的 Agentic AI Lens 明确建议在 Tool 执行前进行外部、确定性的授权与策略检查，而不是依赖 Agent 自身 reasoning 来完成授权。

---

# 八、第二道防线：Grounding，但不要把 RAG 神化

RAG 是解决“模型凭训练记忆乱猜”的重要方法。

基本流程：

```text
User Question
      ↓
Retrieval
      ↓
Authoritative Context
      ↓
LLM
      ↓
Answer
```

比：

```text
User
 ↓
LLM Memory
 ↓
Answer
```

可靠得多。

但：

> **RAG ≠ Correctness Guarantee。**

因为 Retrieval 自己也可能错。

可能出现：

```text
Query
 ↓
错误文档
```

或者：

```text
Query
 ↓
过时文档
```

或者：

```text
Query
 ↓
文档 A
 ↓
真正相关的是文档 B
```

甚至：

```text
Retrieved Context
 ↓
模型误读
 ↓
错误结论
```

因此：

```text
Citation
≠
Proof
```

一个答案带了引用，也不意味着答案正确。

真正应该检查：

```text
Claim
 ↓
Evidence
 ↓
Evidence 是否真的支持 Claim？
 ↓
Evidence 是否 authoritative？
 ↓
Evidence 是否最新？
 ↓
是否存在 conflicting evidence？
```

NIST 也明确指出，生成模型可能生成错误的解释和虚假的引用，因此不能把“有解释”或“有引用”本身当作正确性的证明。

---

# 九、第三道防线：让结果必须能够“验算”

这是解决“Agent 是不是在瞎猜”的最强办法之一。

例如 Agent 给出：

```text
预计组合收益：
7.42%
```

系统不应该问：

> “这个数字看起来合理吗？”

而应该：

```text
输入：
Position
Price
FX
Weight

        ↓

Deterministic Calculation

        ↓

7.42%

        ↓

Compare Agent Result

        ↓

7.42% = 7.42%
```

这就从：

```text
LLM says 7.42%
```

变成了：

```text
LLM proposes 7.42%
+
Independent calculation verifies 7.42%
```

两者完全不是一个可信度级别。

---

# 十、第四道防线：Verification Agent，但不要迷信“让另一个 LLM 检查”

一个常见方案是：

```text
Agent A
 ↓
Answer
 ↓
Agent B
 ↓
Check Answer
```

这比完全没有检查好。

研究也显示，让模型生成答案后独立提出验证问题并重新验证，可以降低部分 hallucination。Chain-of-Verification（CoVe）就是这种思路的经典研究。

但是必须注意：

> **Verification Agent 本身仍然是 LLM。**

所以：

```text
LLM A：
答案 = X

LLM B：
我检查过了，X 正确。
```

不能被理解成：

```text
Proof = Yes
```

因为：

```text
Model A error
+
Model B error
```

完全可能同时发生。

特别是：

```text
同一个模型
相同训练数据
相同错误先验
```

可能导致两个模型非常一致地犯同一个错误。

因此更可靠的 Verification hierarchy 是：

```text
Level 1
LLM Self-check

Level 2
Independent LLM / Critic

Level 3
Independent Retrieval

Level 4
Deterministic Rule / Calculation

Level 5
Authoritative Business System

Level 6
Human Review
```

越靠下，越接近真正的外部证据或业务事实。

---

# 十一、多个 Agent 都同意，不等于答案一定正确

这也是很容易误用的技巧。

例如：

```text
Agent A → Buy
Agent B → Buy
Agent C → Buy
```

有人会说：

> 三个 Agent 都认为应该 Buy，所以比较可靠。

实际上这只能说明：

```text
Outputs are consistent
```

不能直接说明：

```text
Outputs are true
```

如果三个 Agent 都：

```text
共享同一个错误数据
共享同一个错误 Prompt
共享同一个模型
共享同一个错误假设
```

那么它们完全可以：

```text
一致地犯错
```

SelfCheckGPT 一类研究利用多个采样结果之间的不一致性作为 hallucination signal，说明多次采样可以帮助发现“不稳定”或可疑内容；但这种一致性/不一致性本身仍不是事实证明。

因此：

> **Multiple Runs 可以是异常检测器，但不应该成为 Truth Oracle。**

---

# 十二、真正有效的做法：验证“事实链”，而不是验证“答案像不像”

例如用户问：

> 为什么基金 A 的风险等级是 High？

Agent 最后说：

> 因为其集中度较高、波动率较高，因此风险等级为 High。

传统 Evaluation 可能直接评价：

```text
Answer similarity = 92%
```

这是不够的。

应该拆成：

```text
Claim 1:
集中度 = 47%

Evidence:
Portfolio system

Verified = Yes
```

```text
Claim 2:
Volatility = 31.2%

Evidence:
Risk system

Verified = Yes
```

```text
Rule:
If concentration > 40%
and volatility > 25%
→ High

Rule version = risk-policy-v17

Verified = Yes
```

然后：

```text
Final conclusion:
High

Verified = Yes
```

这时 Agent 的答案已经从：

```text
LLM-generated explanation
```

变成：

```text
Evidence
+
Calculation
+
Rule
+
Conclusion
```

---

# 十三、建议把 Agent Result 设计成“Evidence Graph”

对于重要业务，可以进一步把结果表达成：

```text
                       ┌──────────────┐
                       │ Final Result │
                       └──────┬───────┘
                              │
                     verified by
                              │
                    ┌─────────▼─────────┐
                    │ Business Rule     │
                    │ risk-policy-v17   │
                    └─────────┬─────────┘
                              │
                   depends on │
                              │
             ┌────────────────┼────────────────┐
             ▼                ▼                ▼
       Portfolio Data     Market Data      FX Data
             │                │                │
        source/version    timestamp       timestamp
```

这样最终结果并不是孤立的：

```text
Answer = "High"
```

而是：

```text
Answer
 ↓
Rule
 ↓
Inputs
 ↓
Source
 ↓
Timestamp
```

这种结构更适合金融领域。

因为金融业务真正关心的是：

> “这个结论当时基于什么事实、什么规则、什么时间点得出来的？”

而不只是：

> “AI 当时输出了什么？”

---

# 十四、稳定性也不能只看“最终答案”

Agent 有四层不同的稳定性。

## 1. Output Stability

最终文字是否一致。

```text
Run A:
风险较高。

Run B:
当前风险处于较高水平。
```

虽然文字不同，但可能没有实际问题。

---

## 2. Semantic Stability

意思是否一致。

例如：

```text
Run A:
High risk

Run B:
Moderate-to-high risk
```

这就已经不是纯文字变化，而是语义变化。

---

## 3. Trajectory Stability

工具路径是否一致。

```text
Run A:
Search → Portfolio → Risk Engine

Run B:
Search → Portfolio → Portfolio → Risk Engine
```

这可能反映 Agent 的 reasoning 行为发生变化。

Microsoft 当前 Agent Evaluation 已经将 Tool Selection、Tool Input Accuracy、Tool Output Utilization、Tool Call Success 等作为独立评价指标。

AWS AgentCore 也支持检查预期 Tool Trajectory 和 Goal Assertions，而不只是最终文本。

---

## 4. Outcome Stability

最终业务结果是否稳定。

例如：

```text
Run A → Approval Required
Run B → Auto Approved
```

即使两次文本看起来非常接近，实际上发生了非常严重的行为变化。

因此：

> **对企业 Agent，Outcome Stability 通常比 Text Stability 更重要。**

---

# 十五、为什么金融 Agent 不能只看“回答准确率”

假设一个投资研究 Agent：

```text
Answer Accuracy = 96%
```

看起来非常好。

但进一步观察：

```text
Tool Selection Accuracy = 82%

Restricted Data Access Attempts = 3%

Approval Bypass = 1%

Wrong Client Context = 0.7%

High-risk Action Without Review = 0.2%
```

那么这个 Agent 是否真的“96% 正确”？

不能简单这么说。

因为金融系统里：

```text
99% 正确
```

并不自动意味着：

```text
可以直接执行
```

一旦剩下的 1% 中包含：

```text
Unauthorized Trade
Wrong Client
Wrong Currency
Wrong Account
Wrong Vote
Wrong Risk Limit
```

风险完全不同。

FINRA 在 2026 年对 GenAI 的监管观察中明确指出，现有规则仍适用于使用 GenAI 的业务，并可能涉及 supervision、communications、recordkeeping 和 fair dealing；如果 AI 被用于监督系统，机构应考虑 AI 模型的 integrity、reliability 和 accuracy。

---

# 十六、金融领域最重要的原则：高风险行为不能因为“模型很有把握”而直接执行

这与“正确性”是两个不同的问题。

例如 Agent 认为：

```text
建议卖出 10,000 股
```

即使：

```text
Model Confidence = High
```

也不应该意味着：

```text
Execute Sell Order
```

更合理的是：

```text
Agent
 ↓
Proposal
 ↓
Validation
 ↓
Policy
 ↓
Approval if required
 ↓
Command
 ↓
Execution
 ↓
Post-condition verification
```

SEC 的 Rule 15c3-5 是一个非常明确的金融业例子：对于具有市场准入的 broker-dealer，需要建立风险管理控制和监督程序，对订单进行预先限制，包括信用/资本阈值、明显错误订单、合规条件以及授权市场访问等，并持续审查这些控制的有效性。这里并不是说 Agent 必须采用某种软件模式，而是说明高风险自动化行为不能只靠生成系统自己判断。

---

# 十七、因此，“正确性控制”和“业务执行控制”必须分开

一个非常容易混淆的问题是：

```text
Agent Output Correct
```

和：

```text
System Allows Action
```

不是同一回事。

应该明确拆开：

```text
                 Agent
                   │
                   ▼
            Proposed Result
                   │
          ┌────────┴────────┐
          │                 │
       Verification       Policy
          │                 │
          └────────┬────────┘
                   ▼
             Business Action
```

也就是说：

> **验证结果正确，不等于允许执行。**

反过来也成立：

> **允许执行，也不代表 Agent 的自然语言解释一定正确。**

所以：

```text
Correctness
Authorization
Execution
```

必须是三个独立控制点。

---

# 十八、一个实用的“Evidence Ladder”

对于企业 Agent，可以把可信度设计成不同等级。

| 等级 | 结果依据                | 典型场景                     |
| -- | ------------------- | ------------------------ |
| L0 | 模型自身知识              | 普通知识问答                   |
| L1 | RAG / 外部资料          | 企业知识查询                   |
| L2 | 权威数据源               | 客户、持仓、交易数据               |
| L3 | 确定性计算               | 风险、金额、收益、汇率              |
| L4 | 确定性业务规则             | Eligibility、Limit、Policy |
| L5 | 独立验证                | 第二数据源 / Verifier         |
| L6 | 业务系统 Post-condition | 实际交易、订单、审批状态             |
| L7 | Human Review        | 高风险、不可逆操作                |

这不是一个监管规定，而是一种架构设计建议。

核心原则是：

> **业务后果越严重，需要的“外部证据”越强。**

一个 FAQ 可能 L0/L1 就够。

一个投资研究摘要可能需要 L1/L2。

一个风险数值应该至少进入 L3。

一个交易执行则应进入：

```text
L3 + L4 + L6
```

并在适当情况下增加：

```text
L7
```

---

# 十九、正确性不能靠单次 Demo，需要靠 Evaluation Dataset

“这个 Prompt 我试了一下，感觉很好。”

这不是 Evaluation。

成熟的 Agent Evaluation 应该：

```text
Dataset
 ↓
Agent
 ↓
Multiple Runs
 ↓
Evaluation
 ↓
Baseline
 ↓
Regression Detection
```

OpenAI 将 evals 概括成：

```text
Specify
→ Measure
→ Improve
```

核心思想是先定义什么叫“好”，然后使用真实条件测量，再根据错误持续改进。

Anthropic 对 Agent eval 的建议也强调，测试集应该来源于真实任务和真实失败模式，而不是只包含容易的问题。

---

# 二十、Evaluation Dataset 应该测试“变化”，而不是只测试平均水平

一个好的 Agent 测试集不能只有：

```text
正常情况
```

还应该包括：

```text
正常输入
边界输入
缺失数据
冲突数据
过期数据
异常用户
权限不足
Tool Failure
Retrieval Failure
Ambiguous Request
Adversarial Input
```

例如金融研究 Agent：

```text
Case A
全部市场数据正常

Case B
市场数据延迟

Case C
两个数据源价格不一致

Case D
客户无权访问该 Portfolio

Case E
Policy 在今天刚刚变化

Case F
数据源返回空结果
```

一个真正可靠的 Agent 不仅应该：

```text
知道答案
```

还应该知道什么时候：

```text
不能回答
```

---

# 二十一、“拒答能力”本身就是正确性的一部分

很多系统把：

```text
I don't know
```

当成失败。

对于 Agent，这可能完全相反。

如果系统没有足够证据：

```text
No authoritative data
```

那么：

```text
I cannot verify this.
```

通常比：

```text
根据现有情况，应该是……
```

更可靠。

NIST AI RMF 明确提出，AI 系统应该能够在超出知识边界时安全失败，并通过监控、人类干预等机制减少不可靠输出的影响。

因此：

> **一个不肯猜的 Agent，往往比一个什么都敢回答的 Agent 更适合承担高价值业务。**

---

# 二十二、可以把 Agent Result 明确设计成四种状态

例如：

```text
VERIFIED
```

有足够证据和验证。

```text
PARTIALLY_VERIFIED
```

部分事实已经验证，但仍有未验证假设。

```text
UNVERIFIED
```

模型产生了答案，但缺乏足够外部证据。

```text
REJECTED
```

验证发现矛盾或违反规则。

这比：

```text
confidence = 0.92
```

有意义得多。

因为：

```text
confidence = 0.92
```

通常只能表达模型或 evaluator 的估计。

而：

```text
VERIFIED
```

可以对应明确的验证条件。

---

# 二十三、不要把模型 Confidence 当成事实 Probability

这是另一个常见误区。

例如：

```text
Agent：
我 97% 确信客户风险等级是 High。
```

这个“97%”不能直接解释为：

```text
事实正确概率 = 97%
```

除非经过针对具体任务的校准、定义、验证和统计证明。

而金融决策中真正有用的是：

```text
Risk rule passed
+
Data source authoritative
+
Data timestamp valid
+
Independent calculation matched
```

而不是：

```text
LLM confidence = 0.97
```

因此：

> **系统应该优先输出 Evidence Status，而不是伪精确的 AI confidence。**

---

# 二十四、稳定性测试应该怎么做？

一个简单的生产级测试框架可以这样设计。

对一批固定测试案例：

```text
Case 001
Case 002
...
Case N
```

重复运行：

```text
Run 1
Run 2
...
Run K
```

然后分别比较：

### 文本层

```text
Exact Match
Semantic Similarity
```

### 事实层

```text
Key Facts Agreement
Numeric Agreement
Citation Support
```

### 轨迹层

```text
Tool Selection
Tool Parameters
Tool Order
Number of Calls
```

### 控制层

```text
Authorization
Policy
Approval
Escalation
```

### 结果层

```text
Business Outcome
Post-condition
```

于是一个 Case 可能出现：

```text
Text Stability       72%
Fact Stability       98%
Tool Stability       91%
Outcome Stability    100%
```

这种情况其实可能完全没有问题。

因为最重要的：

```text
Fact
Outcome
Control
```

都是稳定的。

---

# 二十五、反过来，也可能出现“文字稳定但行为不稳定”

例如：

```text
Run A:
“该订单需要人工审批。”
```

```text
Run B:
“该订单需要人工审批。”
```

文字完全相同。

但 Tool Trace：

```text
Run A
→ Check Policy
→ Create Review Task

Run B
→ Submit Order
```

如果系统最后展示的只是：

```text
“该订单需要人工审批。”
```

你甚至不知道 Run B 已经产生了危险行为。

因此：

> **Agent Observability 必须观察 Trace，而不只是最终 Response。**

AWS AgentCore、Microsoft Agent Framework、Anthropic 的当前 Agent Evaluation 方向都在向这个方向发展：评价完整 session、tool call、trajectory 和 task outcome，而不仅仅是最终文本。

---

# 二十六、一个可靠的 Agent 架构应该长什么样？

可以把整个体系收敛成：

```text
                         User
                           │
                           ▼
                    ┌────────────┐
                    │   Agent    │
                    │    LLM     │
                    └─────┬──────┘
                          │
                    proposes result
                          │
             ┌────────────▼────────────┐
             │      Evidence Layer     │
             │                         │
             │ RAG / DB / API / Search │
             └────────────┬────────────┘
                          │
                          ▼
                 ┌─────────────────┐
                 │ Verification    │
                 │                 │
                 │ Rule            │
                 │ Calculation     │
                 │ Cross-check     │
                 │ Groundedness    │
                 └────────┬────────┘
                          │
                    pass / fail
                          │
              ┌───────────┴───────────┐
              │                       │
             FAIL                    PASS
              │                       │
              ▼                       ▼
          Re-check /             Policy / Auth
          Abstain /               / Approval
          Human Review               │
                                     ▼
                                  Command
                                     │
                                     ▼
                                Business API
                                     │
                                     ▼
                              Post-condition
                                Verification
                                     │
                                     ▼
                                  Result
```

这里有一个非常重要的边界：

```text
LLM = Proposal
```

而：

```text
Evidence = Facts
Verification = Check
Policy = Authorization
Command = Business Action
Business System = Source of Truth
```

这比让：

```text
LLM
↓
直接执行
```

可靠得多。

---

# 二十七、对于金融 Agent，再加一层“不可逆动作隔离”

如果 Agent 只是：

```text
总结
分类
检索
解释
```

可以允许比较大的生成自由度。

但如果 Agent 进行：

```text
交易
投票
付款
客户沟通
权限变更
持仓调整
订单提交
```

那么必须把：

```text
“生成答案”
```

与：

```text
“改变业务状态”
```

分开。

建议架构：

```text
Agent
 ↓
Command Proposal
 ↓
Schema Validation
 ↓
Data / Entitlement Check
 ↓
Business Rule
 ↓
Risk Policy
 ↓
Human Approval if required
 ↓
Idempotency
 ↓
Execution
 ↓
Post-condition Check
```

这与金融机构长期使用的 maker-checker、pre-trade control、supervision 等思想是一致的。

SEC 的市场准入规则要求相关风险控制和监督程序对订单进入市场前的风险进行限制，并要求持续审查控制有效性。FINRA 2026 对 Best Execution 的监管报告也强调了订单流监控、定期严格审查、准确性和完整性。

---

# 二十八、为什么这比“把温度调成 0”重要得多？

因为：

```text
Temperature
```

解决的是：

```text
Sampling Variance
```

而不是：

```text
Factuality
Groundedness
Authorization
Business Correctness
```

可以简单理解为：

```text
temperature ↓
        ↓
结果可能更稳定
```

但：

```text
Evidence + Verification
        ↓
结果更可验证
```

而：

```text
Policy + Command + Post-condition
        ↓
错误结果不容易直接变成错误业务动作
```

三者解决的是完全不同的问题。

因此，不应该出现：

> “我们已经把 temperature 设置成 0，所以 Agent 是可靠的。”

这是把稳定性和正确性混为了一个问题。

---

# 二十九、真正需要的是“Verification Pipeline”，而不是“更聪明的 Prompt”

可以把一次高价值任务想象成：

```text
Understand
    ↓
Retrieve
    ↓
Compute
    ↓
Reason
    ↓
Verify
    ↓
Decide
    ↓
Execute
    ↓
Verify Again
```

每一步都可能失败。

所以系统应该知道：

```text
哪个步骤失败？
为什么失败？
是否可以重试？
是否需要换数据源？
是否需要人工？
是否禁止继续执行？
```

这也是现代 Agent Evaluation 从“answer quality”逐渐走向“trajectory quality”的根本原因。Anthropic 强调 Agent evaluation 应覆盖工具使用、状态变化和多步过程；Microsoft 也将 tool selection、tool input、tool output utilization 等过程指标单独列出；AWS 则进一步提供 Ground Truth、Goal Assertions 和 Expected Tool Trajectory。

---

# 三十、Evaluation 本身也不能成为新的单点信任问题

这里还要再多走一步。

假设：

```text
Agent
 ↓
LLM Judge
 ↓
Score = 0.95
```

不能因此得出：

```text
Agent Correct = 95%
```

因为：

```text
Evaluator 也可能错
```

所以企业评估最好组合：

```text
Deterministic Checks
+
Reference / Ground Truth
+
Rule-based Assertions
+
LLM Judge
+
Human Review
```

而不是：

```text
LLM Judge
```

一家独大。

AWS 当前 AgentCore Evaluations 同时提供 LLM-as-a-Judge、Ground Truth 和 custom code-based evaluators；Microsoft 也支持多种 Agent、Tool 和 Quality Evaluators。这样的组合本身就是一个值得参考的架构方向。

---

# 三十一、生产环境应该持续监控，而不是只在上线前测试

Agent 的问题不是：

```text
Deploy
↓
Test once
↓
Done
```

因为生产环境会变化：

```text
Model
Prompt
Tool
Knowledge Base
User Behavior
Business Data
Policy
External Services
```

所以应该：

```text
Pre-deployment Eval
        ↓
Canary
        ↓
Production Monitoring
        ↓
Regression Detection
        ↓
Re-evaluation
```

AWS AgentCore 当前已经提供 Online Evaluation、On-demand Evaluation 和 Batch Evaluation；其中 Batch Evaluation 明确支持 baseline measurement、configuration change 前后比较、regression testing 和 periodic quality audits。

NIST 同样建议生产环境持续监控 AI 的 functionality 和 behavior，并用新获得的 ground truth 检查输出质量。

---

# 三十二、金融机构尤其需要关注“静默退化”

传统系统通常很容易监控：

```text
HTTP 500
Latency
CPU
Memory
```

Agent 则可能出现：

```text
HTTP 200
Latency 正常
CPU 正常
```

但：

```text
事实错误率 ↑
Tool Selection 错误率 ↑
Unsupported Claim ↑
Abstention Rate ↓
Policy Denial ↓
High-risk Path ↑
```

系统表面上一切健康。

实际上：

> **业务正确性已经在悄悄退化。**

FSB 将 AI 在金融领域带来的 model risk、data quality/governance、cyber risk、third-party dependency 等列为值得持续监测的脆弱性。FINMA 也将 robustness、correctness、explainability、data quality、third-party dependency 等列为金融机构使用 AI 时需要识别、评估、管理和监控的风险。

因此 Agent Monitoring 不应该只监控：

```text
CPU
Latency
Token Cost
```

更应该监控：

```text
Correctness
Groundedness
Tool Behavior
Policy Compliance
Outcome
```

---

# 三十三、2026 年金融模型风险治理也提供了一个重要启示

美国 OCC、Federal Reserve 和 FDIC 在 2026 年 4 月发布了新版 Model Risk Management guidance。

其中一个非常值得注意的事实是：

> **Generative AI 和 agentic AI 当时明确不在该 guidance 的 scope 内。**

因此不能简单说：

> “监管已经要求所有 Agent 按传统 Model Risk Management 完全同样的方式管理。”

这是不准确的。

但该 guidance 仍然强调几个非常值得借鉴的原则：

```text
Risk-based governance
Model validation
Monitoring
Governance and controls
Third-party product considerations
```

而且明确指出，组织应根据模型和业务的具体风险确定适当的治理控制。

因此，Agent 架构应该吸收其中的治理思路，但不能把它误写成：

```text
Agent = traditional model
```

或者：

```text
Agent 已经完全被现有 model-risk regulation 覆盖
```

这两个结论都过头了。

---

# 三十四、最终应该形成的不是“AI 信任”，而是“Evidence-based Trust”

整个架构最终可以浓缩成一个公式：

```text
Trustworthy Result
=
Evidence
+
Deterministic Verification
+
Business Validation
+
Policy Validation
+
Provenance
+
Appropriate Human Oversight
```

而不是：

```text
Trustworthy Result
=
Powerful Model
```

甚至不是：

```text
Trustworthy Result
=
RAG
+
Powerful Model
```

更不是：

```text
Trustworthy Result
=
Model Confidence 0.95
```

---

# 三十五、可以把 Agent 结果分成四类

生产系统里，一个简单而有用的分类是：

### Type A：答案型

```text
“什么是某个概念？”
```

允许：

```text
LLM + RAG + Citation
```

---

### Type B：分析型

```text
“为什么这个 Portfolio 风险提高了？”
```

建议：

```text
RAG
+
Structured Data
+
Deterministic Calculation
+
Evidence
+
Verification
```

---

### Type C：决策支持型

```text
“这个客户是否满足某个业务条件？”
```

建议：

```text
LLM
+
Authoritative Data
+
Business Rules
+
Independent Verification
+
Human Review where appropriate
```

---

### Type D：执行型

```text
“帮我提交交易。”
```

不应该只是：

```text
LLM
↓
Tool
```

而应该：

```text
LLM
↓
Command
↓
Authorization
↓
Policy
↓
Approval
↓
Execution
↓
Post-condition
```

这四类不应该使用同一套“准确率”指标。

---

# 三十六、一个成熟 Agent 的最终输出应该是什么样？

对于普通 Chatbot：

```text
Answer
```

就够了。

对于企业 Agent，尤其金融 Agent，建议逐步变成：

```json
{
  "result": "...",
  "verificationStatus": "VERIFIED",
  "evidence": [
    {
      "source": "Portfolio System",
      "version": "2026-09-20",
      "timestamp": "2026-09-20T09:30:00Z"
    }
  ],
  "calculations": [
    {
      "engine": "RiskCalculator",
      "version": "v17"
    }
  ],
  "rules": [
    {
      "policy": "PortfolioRiskPolicy",
      "version": "v12"
    }
  ],
  "assumptions": [],
  "warnings": [],
  "provenance": {
    "model": "...",
    "promptVersion": "...",
    "toolManifest": "...",
    "executionId": "..."
  }
}
```

最终用户未必需要看到全部字段。

但系统应该拥有这些信息。

因为：

> **可验证性最终要求的是 provenance，而不只是 response。**

---

# 三十七、因此，Agent 架构最重要的改变不是“让模型更确定”

真正应该改变的是：

```text
旧模式：

Question
 ↓
LLM
 ↓
Answer
```

变成：

```text
新模式：

Question
 ↓
Agent
 ↓
Evidence
 ↓
Reasoning
 ↓
Verification
 ↓
Policy
 ↓
Result / Abstain
```

对于高风险业务：

```text
Result
 ↓
Command
 ↓
Authorization
 ↓
Approval
 ↓
Execution
 ↓
Post-condition Verification
```

这时即使：

```text
LLM 有随机性
```

也没有关系。

因为系统最终依靠的不是：

```text
“LLM 这次应该是对的。”
```

而是：

```text
“这个结果经过了哪些独立条件验证。”
```

---

# 三十八、最终的工程原则

可以把整个问题浓缩成六句话。

### 1. 不要把稳定当成正确

```text
Same Answer ≠ Correct Answer
```

一个稳定错误的 Agent 仍然是错误的。

### 2. 不要让 LLM 成为事实的最终来源

```text
LLM = candidate
System of Record = truth
```

### 3. 能确定性完成的事情，不要交给语言模型

```text
Calculation
SQL
Rules
Authorization
Threshold
State Transition
```

尽可能使用确定性组件。

### 4. Citation 不是 Proof

必须验证：

```text
Claim
↔
Evidence
```

而不仅是“答案下面有一条引用”。

### 5. 多次运行可以检测异常，但不能证明真相

```text
Consistency = signal
```

不是：

```text
Consistency = proof
```

### 6. 高风险业务永远要把“正确性”和“执行权”分开

```text
Agent proposes
Verifier checks
Policy decides
Command executes
Business system owns truth
```

---

# 结语：不要问“我能不能相信 AI”，应该问“系统有没有证据让我相信这次结果”

AI Agent 最大的问题并不是：

> 它每次为什么说得不一样？

真正的问题是：

> **当它说得一样的时候，我怎么知道它不是稳定地说错？**

所以 Agent 可靠性的核心，并不是追求：

```text
100% deterministic generation
```

这种目标对于开放式生成系统本身就不现实。

更合理的目标是：

```text
Deterministic where possible
+
Grounded where factual
+
Verified where important
+
Abstain when uncertain
+
Policy-controlled when consequential
+
Auditable after execution
```

这实际上把“AI 可信”从一个模型问题变成了一个系统架构问题。

对于普通聊天场景，模型偶尔答错可能只是体验问题。

对于企业 Agent，尤其金融服务领域，真正需要控制的是：

```text
错误事实
      ↓
错误分析
      ↓
错误决策
      ↓
错误业务动作
```

成熟的架构应该尽量在这条链路的不同位置建立独立的阻断点：

```text
Wrong Data
   ↓
Retrieval / Data Validation

Wrong Reasoning
   ↓
Verification

Wrong Calculation
   ↓
Deterministic Engine

Wrong Policy Interpretation
   ↓
Policy Engine

Wrong Authorization
   ↓
Authorization Layer

Wrong Business Action
   ↓
Command + Approval

Unexpected Side Effect
   ↓
Post-condition Verification
```

因此，Agent 最终不应该要求用户：

> “相信 AI。”

而应该让系统能够回答：

> **“这是结论；这是它依据的数据；这是计算；这是适用的规则；这是验证结果；这里还有哪些没有验证；如果风险足够高，这里还有谁批准了最终动作。”**

这才是真正可以进入企业、尤其金融业务的 Agent Reliability Architecture。

---

# 参考资料

1. **NIST — Artificial Intelligence Risk Management Framework: Generative Artificial Intelligence Profile**
   NIST 将“confabulation”定义为模型以较高确信度生成错误或虚假内容，并特别提醒错误的解释和引用也可能误导用户。
   [NIST AI RMF Generative AI Profile](https://doi.org/10.6028/NIST.AI.600-1?utm_source=chatgpt.com)

2. **NIST — AI RMF Core / Measure**
   NIST 建议 AI 在部署前及运行期间持续测试和监控，并强调 ground truth、误差监控、生产行为监测、validity、reliability、robustness 和 human oversight。
   [NIST AI RMF Core](https://airc.nist.gov/airmf-resources/airmf/5-sec-core/?utm_source=chatgpt.com)

3. **NIST — AI Risks and Trustworthiness**
   说明 accuracy、robustness、validity、reliability 的区别，以及在高风险场景中通过测试、监控、人工干预和安全失败机制控制风险。
   [NIST AI Risks and Trustworthiness](https://airc.nist.gov/airmf-resources/airmf/3-sec-characteristics/?utm_source=chatgpt.com)

4. **Anthropic — Demystifying Evals for AI Agents, 2026**
   讨论为什么 Agent evaluation 必须覆盖多轮执行、工具调用、状态变化和 trajectory，而不能只依赖最终文本。
   [Anthropic — Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents?utm_source=chatgpt.com)

5. **OpenAI — A Shared Playbook for Trustworthy Third Party Evaluations, 2026**
   强调现代 Agent 的评估不应只针对模型，而要考虑工具、环境、多步 workflow 以及实际运行配置。
   [OpenAI — A shared playbook for trustworthy third party evaluations](https://openai.com/index/trustworthy-third-party-evaluations-foundations/?utm_source=chatgpt.com)

6. **OpenAI — How Evals Drive the Next Chapter of AI for Businesses**
   介绍 “Specify → Measure → Improve” 的企业 AI Evaluation 方法。
   [OpenAI — Evals for Business](https://openai.com/index/evals-drive-next-chapter-of-ai/?utm_source=chatgpt.com)

7. **OpenAI Cookbook — Reproducible Outputs with Seed**
   说明 `seed` 和 `system_fingerprint` 可以帮助提高输出一致性，但官方明确说明这不等于严格 deterministic。
   [OpenAI Cookbook — Reproducible outputs](https://cookbook.openai.com/examples/reproducible_outputs_with_the_seed_parameter?utm_source=chatgpt.com)

8. **AWS — Amazon Bedrock AgentCore Evaluations**
   AWS 当前的 Agent evaluation 支持 task correctness、tool usage、custom metrics、LLM-as-a-Judge 等。
   [AWS — AgentCore Evaluations](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/evaluations.html?utm_source=chatgpt.com)

9. **AWS — AgentCore Ground Truth Evaluations**
   支持 expected response、goal assertions 和 expected tool trajectories，用于把 Agent 行为与已知正确行为比较。
   [AWS — Ground truth evaluations](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/ground-truth-evaluations.html?utm_source=chatgpt.com)

10. **AWS — AgentCore Evaluation Types**
    支持 online、on-demand 和 batch evaluation，可用于生产持续监控、问题调查以及配置变更前后的 regression testing。
    [AWS — Evaluation types](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/evaluations-types.html?utm_source=chatgpt.com)

11. **Microsoft — Agent Framework Evaluation**
    当前评估框架覆盖 intent resolution、task completion、tool selection、tool input accuracy、groundedness、response completeness 等维度。
    [Microsoft Agent Framework — Evaluation](https://learn.microsoft.com/en-us/agent-framework/agents/evaluation?utm_source=chatgpt.com)

12. **Microsoft Foundry — Agent Evaluators**
    对 Agent 的 process evaluation 包括 Tool Call Accuracy、Tool Selection、Tool Input Accuracy、Tool Output Utilization 和 Tool Call Success。
    [Microsoft Foundry — Agent evaluators](https://learn.microsoft.com/en-us/azure/foundry/concepts/evaluation-evaluators/agent-evaluators?utm_source=chatgpt.com)

13. **Microsoft Foundry — Built-in Evaluators**
    提供 Tool Selection、Tool Input Accuracy、Tool Output Utilization、Groundedness、Abstention 等评价维度。
    [Microsoft Foundry — Built-in evaluators](https://learn.microsoft.com/en-us/azure/foundry/concepts/built-in-evaluators?utm_source=chatgpt.com)

14. **Microsoft — Agent Safety**
    明确建议把 LLM 产生的 tool arguments 当作不可信输入，并通过 allow-list 和显式验证保护工具边界。
    [Microsoft Agent Framework — Safety](https://learn.microsoft.com/en-us/agent-framework/agents/safety?utm_source=chatgpt.com)

15. **TruthfulQA**
    经典研究显示 LLM 可以非常流畅地生成错误信息，并且扩大模型规模并不自动等于更高的 truthfulness。
    [TruthfulQA paper](https://arxiv.org/abs/2109.07958?utm_source=chatgpt.com)

16. **SelfCheckGPT**
    探讨通过多次采样结果的一致性/不一致性来发现潜在 hallucination；适合作为 anomaly signal，而不是事实证明。
    [SelfCheckGPT paper](https://arxiv.org/abs/2303.08896?utm_source=chatgpt.com)

17. **Chain-of-Verification**
    研究一种“先生成、再独立提出验证问题并重新回答”的方法，在多种任务中降低 hallucination。
    [Chain-of-Verification paper](https://arxiv.org/abs/2309.11495?utm_source=chatgpt.com)

18. **FINRA — GenAI: Continuing and Emerging Trends, 2026**
    FINRA 强调其规则是 technology-neutral，GenAI 的使用可能涉及 supervision、communications、recordkeeping 和 fair dealing；当 AI 被用于监督系统时，需要考虑其 integrity、reliability 和 accuracy。
    [FINRA — GenAI: Continuing and Emerging Trends](https://www.finra.org/rules-guidance/guidance/reports/2026-finra-annual-regulatory-oversight-report/gen-ai?utm_source=chatgpt.com)

19. **FINRA — Customer Order Handling / Best Execution, 2026**
    讨论 order flow supervision、monitoring、regular and rigorous reviews，以及准确性、完整性和第三方数据核验。
    [FINRA — Best Execution and Order Routing Disclosures](https://www.finra.org/rules-guidance/guidance/reports/2026-finra-annual-regulatory-oversight-report/best-execution?utm_source=chatgpt.com)

20. **SEC — Rule 15c3-5 Risk Management Controls for Brokers or Dealers With Market Access**
    要求相关市场准入系统建立合理设计的风险控制和监督程序，在订单进入市场前限制金融和监管风险，并持续审查控制有效性。
    [SEC — Rule 15c3-5](https://www.sec.gov/rules-regulations/2011/06/risk-management-controls-brokers-dealers-market-access?utm_source=chatgpt.com)

21. **FSB — The Financial Stability Implications of Artificial Intelligence**
    从金融稳定角度讨论 AI 带来的 model risk、data quality and governance、cyber risk、third-party dependency 和 concentration 等风险。
    [FSB — Financial Stability Implications of AI](https://www.fsb.org/2024/11/the-financial-stability-implications-of-artificial-intelligence/?utm_source=chatgpt.com)

22. **FINMA — Governance and Risk Management when Using AI**
    关注金融机构使用 AI 时的 model risk、correctness、robustness、data quality、IT/cyber 和 third-party dependency，并强调持续识别、评估、管理和监控。
    [FINMA Guidance 08/2024](https://www.finma.ch/en/news/2024/12/20241218-mm-finma-am-08-24/?utm_source=chatgpt.com)

23. **Federal Reserve / OCC / FDIC — Revised Model Risk Management Guidance, 2026**
    2026 年新版 guidance 强调 risk-based model validation、monitoring、governance、controls 和 third-party considerations，同时明确说明 Generative AI 和 agentic AI 当时不在该 guidance scope 内。
    [OCC Bulletin 2026-13](https://occ.gov/news-issuances/bulletins/2026/bulletin-2026-13.html?utm_source=chatgpt.com)




----------------------




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

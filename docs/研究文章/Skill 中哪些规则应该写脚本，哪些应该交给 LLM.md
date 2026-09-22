# Skill 中哪些规则应该写脚本，哪些应该交给 LLM？

在 Agent Skill 体系里，一个很容易被忽略的问题是：

> **规则到底应该写在 `SKILL.md` 里，让 LLM “记住并遵守”；还是应该写成脚本，让程序“检查并执行”？**

这不是代码风格问题，而是 Agent 架构中的控制边界问题。

Anthropic 的 Agent Skills 标准本身已经明确把 Skill 看成“instructions + scripts + resources”的组合，并特别指出：对于某些操作，传统代码比 token generation 更适合，因为代码能够提供确定性和可重复性。其官方示例甚至直接使用 Python 脚本解析 PDF 表单字段。

GitHub Copilot 的 Agent Skills 也采用类似设计：Skill 除了 `SKILL.md`，可以包含脚本和其他资源；脚本可以由 Skill 指令引用和执行。与此同时，GitHub 明确警告 Skill 本身可能包含 prompt injection 或恶意脚本，因此 Skill 也必须被视为供应链对象，而不是天然可信的配置文件。

这实际上指向一个更普遍的架构结论：

> **LLM 应该负责“理解规则、解释规则、选择策略、生成候选方案”；程序应该负责“验证规则、执行规则、限制权限、维护状态”。**

特别是在金融服务场景中，二者不能互相替代。

FINRA 在 2026 年发布的监管观察中已经明确把 AI Agent 的访问权限、数据处理、人机监督、Agent 行为与决策追踪，以及限制 Agent 行为的 guardrails/control mechanisms 列为需要考虑的问题。

因此，真正值得讨论的不是“Skill 应该不要写脚本”，而是：

> **Skill 中哪些规则必须从自然语言升级成可执行约束？哪些规则仍然应该交给 LLM？哪些规则应该进一步从 Skill 中移出去，进入平台级 Policy / Authorization / Workflow？**

---

# 一、先给结论：不要把“规则”看成一种东西

Skill 中的规则至少可以分成三类：

| 类型      | 典型问题                      | 应该由谁负责                                    |
| ------- | ------------------------- | ----------------------------------------- |
| 硬约束     | “金额超过 100 万必须双人审批”        | 程序 / Policy Engine                        |
| 可计算约束   | “日期必须是工作日”“总金额必须等于明细之和”   | 程序                                        |
| 语义判断    | “这份文件是否真的属于投资研究”“客户意图是什么” | LLM                                       |
| 规划与选择   | “下一步应该查什么资料”              | LLM                                       |
| 业务状态    | “当前 Case 是否已经完成审批”        | Workflow / Domain State                   |
| 权限边界    | “这个 Agent 能不能查看该客户数据”     | Authorization / Policy                    |
| 风险判断    | “该行为是否可能存在利益冲突”           | LLM + deterministic checks + human review |
| 最终高风险动作 | “是否允许执行交易/提交投票/发送客户指令”    | Policy + Workflow + Approval              |

因此最危险的架构其实不是“Skill 没有脚本”，而是：

```text
SKILL.md
   ↓
“请遵守这些规则”
   ↓
LLM 自己判断
   ↓
LLM 自己调用 Tool
   ↓
业务系统发生真实变化
```

这相当于把**安全策略、业务政策、权限控制和业务逻辑全部压缩成 Prompt**。

AWS Well-Architected Agentic AI Lens 对这一点说得非常直接：仅依赖 system prompt 来定义 operational boundaries 并不能提供可靠 enforcement；对于能够确定表达的约束，应使用 IAM、schema validation、Cedar policy、permission boundary 等 deterministic controls，而把无法确定表达的内容型风险交给 probabilistic controls。

所以本文的核心原则可以浓缩成一句话：

> **能被确定计算的问题，不要让 LLM 猜。
> 不能被确定计算的问题，不要强行写成脚本。
> 真正影响权限、状态和外部副作用的规则，不应该只存在于 Skill。**

---

# 二、为什么“写在 SKILL.md 里”不是 enforcement？

假设 Skill 写了：

```text
执行交易前：

1. 检查交易金额
2. 如果超过 100 万，需要主管审批
3. 如果涉及受限证券，不允许执行
4. 必须确认客户授权
5. 完成后记录审计信息
```

表面上看已经很严格。

问题在于这些只是自然语言 instructions：

```text
LLM
  ↓
读取规则
  ↓
理解规则
  ↓
决定是否遵守
  ↓
生成 tool call
```

中间缺少一个真正的 enforcement point。

LLM 可能理解错误，也可能因为上下文发生变化而遗漏其中一步，还可能受到来自用户输入、RAG 文档、网页内容、Tool 输出的 prompt injection 影响。

AgentDojo 的研究专门评估了 tool-using agent 在不可信外部数据下受到 prompt injection 的情况，其任务包括电子邮件、电子银行和旅行预订等真实风格场景。研究发现，当前模型在无攻击情况下也会失败，而外部工具返回的数据本身也可以成为攻击载体。

Agent Security Bench 的大规模评测同样覆盖 finance 等场景，并测试 system prompt、tool usage、memory retrieval 等多个阶段的攻击。该研究报告的最高平均攻击成功率达到 84.30%，说明“把安全规则写进 Prompt，然后期待 Agent 遵守”不能被当成充分的安全控制。

因此要区分两个概念：

```text
Instruction
    = 告诉 Agent 应该怎么做

Enforcement
    = 即使 Agent 犯错，也不能突破边界
```

Skill 的 Markdown 适合前者。

脚本、Policy Engine、Authorization、Workflow Runtime 才适合后者。

---

# 三、什么时候规则应该写成脚本？

可以用一个非常实用的判断标准：

> **如果规则的答案应该是“同样输入、同样环境、应该得到同样结果”，优先考虑程序。**

例如：

```text
金额 > 1,000,000 → requires_second_approval
```

这不需要 LLM。

再例如：

```text
交易日期是否为工作日？
```

也不需要 LLM。

```text
所有 mandatory fields 是否存在？
```

不应该交给 LLM。

```text
当前用户是否拥有该账户的 READ 权限？
```

更不应该交给 LLM。

可以把这些规则进一步归为几类。

---

## 3.1 数学、计算和转换规则

最典型。

例如：

```text
total = principal + fee + tax
```

或者：

```text
risk_score = f(position, exposure, limit)
```

或者：

```text
end_date = start_date + business_days
```

这些问题让 LLM 直接生成结果没有架构上的意义。

Anthropic 的 Agent Skills 文档直接使用排序作为例子：让 LLM 通过 token generation 排序，比运行传统排序算法更加昂贵，而一些应用又要求传统代码提供的 deterministic reliability。

所以 Skill 中出现：

```text
请计算：
A + B + C
```

更好的设计不是：

```text
让 LLM 计算
```

而是：

```text
calculate.py
```

然后：

```text
LLM → 提取参数
    → calculate.py
    → 得到确定结果
    → LLM 解释结果
```

---

# 四、所有 Schema / 格式规则，都优先交给程序

例如：

```text
输出必须包含：

caseId
customerId
decision
reason
timestamp
```

这不是 LLM 规则，而是 schema。

应该：

```json
{
  "type": "object",
  "required": [
    "caseId",
    "customerId",
    "decision",
    "reason",
    "timestamp"
  ]
}
```

然后通过 validator 检查。

OpenAI Agents SDK 当前也把 input/output/tool guardrails 做成独立执行点，可以在 tool 执行前检查输入，也可以在 tool 执行后检查输出；工具级 guardrail 可以拒绝调用或直接触发终止。

这背后的架构思想非常重要：

```text
LLM output
      ↓
schema validation
      ↓
policy validation
      ↓
tool execution
```

而不是：

```text
LLM output
      ↓
“请确保格式正确”
      ↓
tool execution
```

前者是 control。

后者只是 instruction。

---

# 五、权限规则几乎总是应该写成程序

例如：

```text
Agent A 可以读取客户数据
Agent A 不可以读取交易指令
Agent B 可以生成交易建议
Agent B 不可以提交交易
```

这些不能只是：

```text
SKILL.md：

Do not access restricted data.
```

应该变成：

```text
Authorization
    ↓
subject
    ↓
resource
    ↓
action
    ↓
policy decision
```

例如：

```json
{
  "principal": "agent:investment-research",
  "resource": "client:12345",
  "action": "read"
}
```

由 Policy Engine 返回：

```text
allow
deny
```

AWS Agentic AI Lens 将 tool authorization、tool input/output validation 和 approved tool registry 作为 agent tool security 的核心实践。

OWASP 对 Excessive Agency 的建议也非常接近这个架构：最小化 extension、最小化 functionality、避免 open-ended extension、最小化 downstream permissions，并且要以具体用户的权限上下文执行操作，而不是给 Agent 一个过大的通用身份。

因此：

> **Skill 可以描述“这个工具应该怎么用”，但不能成为最终权限边界。**

---

# 六、为什么“高风险规则”不能只写在 Skill？

这是金融服务场景最容易踩坑的地方。

假设一个 Skill：

```text
Proxy Voting Skill
```

里面写：

```text
如果票数较大，则需要人工批准。

如果投票涉及敏感议题，则需要 Compliance review。

提交之前需要确认客户授权。
```

问题是：

“较大”是多少？

“敏感议题”是什么？

“客户授权”在哪里？

“需要批准”意味着什么？

这些如果仍然停留在 Prompt，系统最后其实没有明确的状态和政策。

更合理的架构是：

```text
                ┌──────────────┐
User ─────────→ │     Agent    │
                │     LLM      │
                └──────┬───────┘
                       │
                proposed_action
                       │
                       ▼
              ┌─────────────────┐
              │ Policy Engine   │
              │                 │
              │ authorization   │
              │ thresholds      │
              │ segregation     │
              │ approval rules  │
              └────────┬────────┘
                       │
                allow / deny /
                require approval
                       │
                       ▼
              ┌─────────────────┐
              │ Workflow/Case   │
              │ State Machine   │
              └────────┬────────┘
                       │
                       ▼
                 External Tool
```

这里 Skill 仍然非常重要，但它的作用发生了变化。

Skill 负责：

```text
怎么理解任务
怎么收集信息
需要调用哪些工具
怎么组织上下文
怎么解释结果
```

而 Policy / Workflow 负责：

```text
能不能做
什么时候能做
需要谁批准
当前状态是什么
做完之后状态变成什么
```

这也是金融服务里尤其重要的区别：

> **Agent 可以提出 Action，但 Agent 不应该自己定义 Authorization。**

---

# 七、哪些规则应该交给 LLM？

程序并不是万能答案。

对于大量语义问题，强行写脚本反而会把 Skill 做成一个巨大而脆弱的规则系统。

例如：

```text
这封邮件的客户意图是什么？

这份研究报告属于哪个主题？

这段文本是否描述了潜在利益冲突？

哪个政策条款和当前 Case 最相关？

这个用户真正想解决的问题是什么？

下一步应该查询哪些资料？
```

这些问题具有明显的语义不确定性。

如果把它们硬编码成：

```text
if "investment" in text:
    ...
elif "portfolio" in text:
    ...
```

很快就会出现规则爆炸：

```text
关键词
同义词
上下文
否定
例外
专业术语
语言差异
跨段落关系
```

此时使用 LLM 更合理。

---

# 八、一个非常实用的分界线：LLM 负责“分类”，程序负责“决定”

这是整个架构里最值得推广的模式。

例如：

```text
用户：
“这次交易涉及一个受限制的发行人，而且金额比较大。”
```

LLM 可以做：

```json
{
  "transaction_type": "trade",
  "restricted_security": true,
  "materiality": "high"
}
```

但不要让 LLM 最终输出：

```json
{
  "approved": false
}
```

更好的设计是：

```text
LLM
 ↓
Semantic Classification
 ↓
structured proposal
 ↓
Policy Engine
 ↓
deterministic decision
```

例如：

```json
{
  "transaction_type": "trade",
  "restricted_security": true,
  "amount": 1200000
}
```

然后程序：

```python
if transaction.restricted_security:
    return "DENY"

if transaction.amount > 1_000_000:
    return "REQUIRES_SECOND_APPROVAL"

return "ALLOW"
```

这时候 LLM 即使偶尔把一句话理解错，也不会直接获得业务系统的最终控制权。

当然，**“LLM 分类本身”仍然可能出错**，所以对于高风险场景，还需要：

```text
LLM classification
      +
confidence / evidence
      +
deterministic validation
      +
human review when required
```

不能把“结构化 JSON”误认为“正确答案”。

---

# 九、一个更准确的 Skill 分层

一个成熟的 Skill 不应该只有 `SKILL.md`。

更合理的结构是：

```text
investment-review/
│
├── SKILL.md
│
├── scripts/
│   ├── validate-input.py
│   ├── calculate-exposure.py
│   ├── verify-citation.py
│   ├── validate-schema.py
│   └── check-state.py
│
├── references/
│   ├── business-rules.md
│   ├── investment-policy.md
│   └── examples.md
│
├── schemas/
│   ├── proposal.json
│   └── result.json
│
└── policies/
    └── thresholds.yaml
```

其中职责应该明确分开。

### `SKILL.md`

写：

```text
什么时候使用这个 Skill。

任务应该怎么拆。

先收集什么信息。

哪些情况下应该调用哪些工具。

哪些 scripts 必须执行。

如何解释结果。

遇到不确定情况如何升级。
```

它主要服务于 LLM 的 reasoning。

### `references/`

写：

```text
背景知识
业务定义
政策解释
示例
领域术语
```

它主要服务于 context。

### `scripts/`

写：

```text
计算
验证
解析
规范化
确定性检查
```

它主要服务于 deterministic execution。

### `schemas/`

写：

```text
输入输出契约
```

它主要服务于 machine validation。

### `policies/`

写：

```text
阈值
权限
状态
规则参数
```

它们最好进一步由平台统一管理，而不是复制到每个 Skill 中。

---

# 十、Skill 脚本并不等于 Policy Engine

这是一个非常重要的边界。

很多团队很容易从：

```text
Skill + script
```

进一步走到：

```text
所有业务规则都写进 Skill script
```

这同样会走偏。

例如：

```text
check_client_permission.py
```

看起来很好。

但如果这个脚本只是：

```python
return user.role == "advisor"
```

它其实不一定是真正的权限系统。

真实企业中的权限可能还涉及：

```text
User
Tenant
Organization
Client
Account
Region
Desk
Data Entitlement
Purpose
Time
Delegation
Segregation of Duties
Regulatory Restriction
```

所以：

> **脚本可以是 deterministic check，但不应该因为它“是脚本”就自动成为企业级安全边界。**

更成熟的架构是：

```text
Skill script
    ↓
local validation / transformation

Enterprise Policy Service
    ↓
authorization / entitlement / compliance policy

Workflow Runtime
    ↓
business state / approval / lifecycle
```

Skill 只是调用它们。

---

# 十一、可以把所有规则放进一个“四层模型”

一个很实用的架构模型是：

```text
Layer 1 — LLM Rules
理解 / 规划 / 分类 / 解释
            │
            ▼
Layer 2 — Deterministic Checks
schema / calculation / validation / normalization
            │
            ▼
Layer 3 — Policy & Authorization
权限 / Data Entitlement / 风险限制 / approval policy
            │
            ▼
Layer 4 — Workflow & Domain State
Case / Approval / Execution / Completion
```

四层职责不同。

## Layer 1：LLM

回答：

> “这是什么意思？”

例如：

```text
这是一个 Proxy Voting request。
它涉及一个受限议题。
用户希望修改当前 vote instruction。
```

## Layer 2：Script

回答：

> “输入是否满足机器可验证条件？”

例如：

```text
voteInstruction.schema valid?
fundId exists?
meetingId exists?
deadline valid?
```

## Layer 3：Policy

回答：

> “这件事在当前上下文中允许吗？”

例如：

```text
user has entitlement?
client authorized?
restricted issuer?
maker/checker required?
```

## Layer 4：Workflow

回答：

> “业务现在处于什么状态？”

例如：

```text
DRAFT
→ SUBMITTED
→ REVIEW_REQUIRED
→ APPROVED
→ EXECUTING
→ EXECUTED
```

这个分层能够避免一个常见错误：

> **把“理解”“验证”“授权”“状态”全部塞进 LLM。**

---

# 十二、哪些规则应该“强制脚本化”？

可以直接建立一张工程判断表。

| 规则类型                                      | 建议                            |
| ----------------------------------------- | ----------------------------- |
| 数学计算                                      | 必须程序化                         |
| 日期计算                                      | 必须程序化                         |
| ID / schema validation                    | 必须程序化                         |
| 格式验证                                      | 必须程序化                         |
| 数据类型验证                                    | 必须程序化                         |
| 状态转换                                      | 必须 Workflow / code            |
| Authorization                             | 必须 Policy                     |
| Data Entitlement                          | 必须 Policy                     |
| Approval requirement                      | 必须 Policy / Workflow          |
| Rate limit                                | 必须程序化                         |
| Idempotency                               | 必须程序化                         |
| Duplicate detection（严格规则）                 | 程序优先                          |
| Cryptographic verification                | 必须程序化                         |
| Signature verification                    | 必须程序化                         |
| File parsing                              | 程序优先                          |
| Deterministic transformation              | 程序优先                          |
| Citation existence / URL / metadata check | 程序优先                          |
| 结构化数据一致性                                  | 程序优先                          |
| 纯语义分类                                     | LLM                           |
| 摘要                                        | LLM                           |
| 意图识别                                      | LLM                           |
| 自然语言解释                                    | LLM                           |
| 信息抽取                                      | LLM + schema validation       |
| 文档语义匹配                                    | LLM / embedding + validation  |
| 复杂规划                                      | LLM                           |
| 模糊异常解释                                    | LLM                           |
| 高风险语义判断                                   | LLM + evidence + human/policy |
| 最终高风险动作                                   | Policy + Workflow + Approval  |

---

# 十三、最危险的一类：LLM 负责“决定”，而脚本只负责“帮忙”

很多 Skill 会写成：

```text
如果条件 A，则使用 script A。

如果条件 B，则使用 script B。
```

表面上有脚本。

但实际上：

```text
LLM
 ↓
决定 A 还是 B
 ↓
决定是否调用 script
```

那么核心控制权依然在 LLM。

例如：

```text
Skill:
“金额超过 100 万时必须运行 approval_check.py。”
```

如果 LLM 可以决定“不运行这个 script”，那么：

```text
approval_check.py
```

就不是 enforcement。

正确方式应该是：

```text
LLM proposes action
        ↓
Runtime intercepts
        ↓
Policy check automatically runs
        ↓
allow / deny / require approval
        ↓
tool execution
```

也就是说：

> **对于真正的安全控制，不能依赖 LLM 自己记得调用脚本。**

脚本应该位于 Tool / Policy / Runtime 的强制执行路径上。

AWS 对此采用的正是 layered validation 思路：deterministic controls 与 probabilistic controls 在不同阶段组合，而不是单纯依赖 instruction-following。

---

# 十四、因此 Skill 里的“脚本调用”应该分成两类

这是实施时很有价值的区分。

## A. LLM 主动调用的辅助脚本

例如：

```text
extract-pdf-fields.py
calculate-risk.py
convert-format.py
build-report.py
```

即使 LLM 偶尔忘记调用，也主要影响：

```text
质量
效率
便利性
```

这种脚本适合直接放进 Skill。

Anthropic 的 PDF Skill 就属于这一类：Skill 中包含预写 Python script，由 Agent 按任务需要运行。

---

## B. Runtime 强制调用的控制脚本

例如：

```text
authorize-tool-call.py
check-entitlement.py
enforce-policy.py
validate-state-transition.py
```

这种脚本不能仅仅依赖：

```text
SKILL.md → LLM → script
```

而应该是：

```text
Tool Request
    ↓
Runtime
    ↓
Policy / Validation
    ↓
Tool
```

甚至最好是：

```text
Agent
  ↓
Tool Proposal
  ↓
Control Plane
  ├── Authorization
  ├── Policy
  ├── Approval
  ├── Rate Limit
  └── Audit
  ↓
Execution Plane
```

这两类脚本虽然都是“script”，架构地位完全不同。

---

# 十五、金融服务中尤其应该遵循“Proposal ≠ Decision”

金融场景可以进一步把 Agent 产物分成：

```text
Agent Proposal
```

和：

```text
Business Decision
```

例如 Agent：

```json
{
  "action": "submit_proxy_vote",
  "meeting": "ABC-2026-09",
  "recommendation": "AGAINST",
  "reason": "...",
  "evidence": [...]
}
```

这只是：

```text
Proposal
```

之后：

```text
Policy Engine
```

检查：

```text
用户是否有权限？
该基金是否属于用户职责范围？
是否存在 restricted list？
是否需要 Compliance approval？
是否超过 deadline？
是否已经提交？
```

然后：

```text
Workflow
```

决定：

```text
DRAFT
→ REVIEW_REQUIRED
→ APPROVED
→ EXECUTED
```

最终工具：

```text
ISS / internal proxy system
```

才执行。

这类架构能够形成清晰的责任链：

```text
LLM：为什么应该这么做？

Script：输入是否正确？

Policy：允许这么做吗？

Workflow：现在是不是可以做？

Tool：真正执行了吗？
```

这比让一个 Agent 同时承担全部职责更容易审计。

---

# 十六、Morgan Stanley 的实践说明：语义质量不能靠硬编码解决

Morgan Stanley 与 OpenAI 的公开案例非常有代表性。

其 AI @ Morgan Stanley Assistant 面向金融顾问使用，核心是从企业知识库中检索信息；Morgan Stanley 建立了针对真实业务场景的 evaluation framework，并持续使用 expert feedback、retrieval testing 和 regression testing。其 Debrief 工具生成会议摘要和后续行动时，顾问仍然需要 review 和调整生成结果后再最终确认。

这体现的是另一种控制逻辑：

```text
语义任务
    ↓
LLM
    ↓
Evaluation
    ↓
Human review / feedback
    ↓
持续改进
```

而不是：

```text
所有业务规则都硬编码
```

因为：

```text
“会议里真正重要的 action item 是什么？”
```

本身就很难完全写成 deterministic rule。

但：

```text
“最终 CRM update 是否允许写入？”
```

又不能只靠 LLM。

所以真正合理的方式是：

```text
Semantic layer → LLM

Business boundary → Code / Policy / Workflow
```

---

# 十七、JPMorganChase 的实践进一步说明：guardrail 本身也需要系统化

JPMorganChase 在 2026 年公开介绍了 Fence guardrail framework，用于在具体 use case 层面对 hallucination、topic drift、prompt injection 等风险进行测试和缓解，并使用 synthetic data 来构建针对具体场景的 guardrails。

这值得注意，因为它说明金融机构实践中并不是：

```text
写一个更大的 system prompt
```

而是在构建：

```text
模型
+
evaluation
+
guardrail
+
测试数据
+
监控
```

这种体系。

JPMorganChase 也已经把员工级生成式 AI 平台进一步向“AI + workflows + agents”方向推进，并公开表示其下一阶段会把生成式 AI 与 workflow 结合，让 Agent 执行一系列动作完成目标。

这恰好说明：

> **当 Agent 从“回答问题”进入“执行业务动作”，决定规则放在哪里的重要性会急剧提高。**

---

# 十八、Capital One 的经验也说明：Evaluation 与 Guardrail 是一等公民

Capital One 公开介绍其生成式 AI 客服工具时，强调的不只是模型能力，而是：

```text
Data
Evaluation
Tooling
Modeling
```

并明确指出需要通过 rigorous testing 和 guardrails 去发现 failure modes、验证信息检索质量和模型表现。

这说明 Skill 的设计不能只考虑：

```text
Prompt 写得够不够好？
```

还必须考虑：

```text
规则能否测试？
规则能否回归？
规则能否监控？
规则能否追踪？
规则能否在模型升级后重新验证？
```

而代码规则天然更容易做到：

```text
unit test
integration test
regression test
```

LLM 规则则更适合：

```text
evaluation dataset
LLM-as-judge
human review
behavioral evaluation
```

所以两者不是同一种测试方式。

---

# 十九、Skill 的测试体系也应该分成两套

## Deterministic Tests

针对：

```text
scripts/
policy/
schema/
workflow/
```

例如：

```text
amount = 999999
→ ALLOW

amount = 1000000
→ REQUIRES_APPROVAL

amount = 1000001
→ REQUIRES_APPROVAL
```

这种测试要求：

```text
same input → same result
```

可以进入 CI/CD。

---

## Behavioral Tests

针对：

```text
SKILL.md
LLM reasoning
semantic extraction
planning
```

例如：

```text
用户：
“我想把这个投票提交掉，不过我不确定当前授权是不是还有效。”
```

测试：

```text
Agent 是否意识到授权问题？
是否主动检查 entitlement？
是否错误地直接提交？
是否要求人工确认？
```

这属于行为评估，不是传统 unit test。

Morgan Stanley 对 AI use cases 建立 evaluation framework，并持续执行 regression testing，就是这类机制的代表。

---

# 二十、判断一条规则是否应该脚本化，可以用七个问题

实际设计 Skill 时，可以直接逐条问。

### 1. 这个规则是否有明确答案？

例如：

```text
金额 > 100 万？
```

有。

```text
这封邮件真正表达了什么？
```

不一定。

前者程序优先。

---

### 2. 这个答案是否应该高度重复？

如果同一个输入每次应该得到完全相同结果：

```text
script
```

优先。

---

### 3. 错误是否可能造成权限或资金后果？

如果答案是：

```text
是
```

尽量不要只使用 LLM。

尤其是：

```text
read sensitive data
send money
submit trade
change entitlement
delete record
send external communication
approve case
```

应该存在 deterministic enforcement。

---

### 4. 能否表达成结构化字段？

例如：

```json
{
  "amount": 1200000,
  "risk_level": "high",
  "restricted": true
}
```

一旦能够结构化，就可以把最终规则从：

```text
LLM reasoning
```

迁移到：

```text
code / policy
```

---

### 5. 是否需要理解自然语言？

如果必须理解：

```text
隐含含义
上下文
语气
复杂语义
跨段落关系
```

LLM 更合适。

---

### 6. 是否需要随着业务规则变化频繁修改？

这里有一个微妙区别。

如果变化的是：

```text
阈值
权限
状态
政策参数
```

应该让程序读取：

```yaml
policy:
  approval_threshold: 1000000
```

而不是重写 Prompt。

如果变化的是：

```text
对业务概念的理解方式
```

则可能适合更新 Skill instructions、examples 或 evaluation set。

---

### 7. 是否需要在 Agent 犯错时仍然有效？

这是最关键的问题。

如果答案是：

```text
必须
```

那么：

> **不要把它只放在 SKILL.md。**

---

# 二十一、一个非常实用的“Rule Promotion”机制

Skill 开发初期，可以允许一些规则先写成自然语言。

例如：

```text
如果金额较大，则需要额外审批。
```

随着业务逐渐明确，规则逐步“晋升”。

第一阶段：

```text
Prompt rule
```

第二阶段：

```text
Structured rule
```

第三阶段：

```text
Deterministic validation
```

第四阶段：

```text
Policy Engine
```

第五阶段：

```text
Workflow / Authorization Boundary
```

例如：

```text
“金额较大”
```

逐渐变成：

```yaml
approval:
  threshold:
    currency: USD
    amount: 1000000
```

再变成：

```python
if amount >= approval_threshold:
    require("SECOND_APPROVAL")
```

最后进入企业 Policy Service。

这个过程非常重要，因为不是所有规则一开始就知道应该如何 formalize。

---

# 二十二、不要过早把所有东西都写成代码

另一种错误是反过来：

```text
LLM 能不能理解？
不知道。
那就全部代码化。
```

结果很快会出现：

```text
5000 条 if/else
```

然后整个 Skill 变成一个难以维护的专家系统。

例如：

```text
这句话是不是客户拒绝了？

如果包含：
“算了”
“不用了”
“先不要”
“我考虑一下”
“暂时不想”
……
```

继续添加规则不会真正解决问题。

此时应该：

```text
LLM
   ↓
semantic classification
   ↓
structured output
   ↓
deterministic business rule
```

而不是无限扩展关键词。

因此：

> **Script 的目标不是替代 LLM，而是把“可以形式化的约束”从 LLM 中拿出来。**

---

# 二十三、最值得采用的模式：LLM → Structured Proposal → Deterministic Enforcement

综合前面的研究，可以形成一个通用 Agent Skill 执行模型：

```text
                        ┌─────────────┐
                        │   User      │
                        └──────┬──────┘
                               │
                               ▼
                     ┌──────────────────┐
                     │       LLM        │
                     │                  │
                     │ understand       │
                     │ classify         │
                     │ plan             │
                     │ propose          │
                     └────────┬─────────┘
                              │
                     Structured Proposal
                              │
                              ▼
                 ┌────────────────────────┐
                 │ Deterministic Checks   │
                 │                        │
                 │ schema                 │
                 │ validation             │
                 │ calculations           │
                 │ normalization          │
                 └───────────┬────────────┘
                             │
                             ▼
                 ┌────────────────────────┐
                 │ Policy / Authorization │
                 │                        │
                 │ entitlement            │
                 │ permission             │
                 │ risk policy            │
                 │ approval requirement   │
                 └───────────┬────────────┘
                             │
                    allow / deny /
                   require approval
                             │
                             ▼
                 ┌────────────────────────┐
                 │ Workflow / Domain State│
                 │                        │
                 │ case lifecycle         │
                 │ approval state         │
                 │ execution state        │
                 └───────────┬────────────┘
                             │
                             ▼
                       ┌───────────┐
                       │   Tool    │
                       └───────────┘
```

这时 Skill 的职责其实非常清楚：

```text
LLM-facing operating manual
```

而不是：

```text
enterprise security boundary
```

---

# 二十四、一个实际的 SKILL.md 写法

不要写成：

```markdown
## Rules

Always make sure the transaction is authorized.

Never exceed the user's permissions.

Check whether approval is required.

Make sure all calculations are correct.
```

更好的写法是：

```markdown
## Workflow

1. Understand the user's request.
2. Extract the intended action into the `ActionProposal` schema.
3. Run `scripts/validate-input.py`.
4. Before any side-effecting tool call, submit the proposal to the policy service.
5. Never infer authorization from the user's natural-language request.
6. Never bypass a denied or pending policy result.
7. If policy returns `REQUIRES_APPROVAL`, stop execution and create the required approval request.
8. After execution, run `scripts/validate-result.py`.
9. Explain the result to the user using the policy and execution records.

## Deterministic checks

The following checks must be performed by code rather than inferred by the model:

- schema validation
- amount calculation
- date validation
- identifier validation
- action/state compatibility
- execution result validation

## Semantic reasoning

Use the LLM for:

- intent interpretation
- document understanding
- classification
- summarization
- evidence extraction
- planning

Do not use LLM reasoning as a substitute for authorization or policy enforcement.
```

这个 Skill 的 Markdown 已经不再试图“自己实现整个业务规则系统”。

它是在定义：

```text
LLM 应该怎么工作
```

同时明确：

```text
哪些事情必须交给程序
```

---

# 二十五、为什么这对金融服务尤其重要？

金融服务的特点决定了：

```text
“模型回答得不错”
```

和：

```text
“系统允许这个动作”
```

是两件完全不同的事情。

BIS 对金融业 AI 风险的研究和监管讨论长期强调 model risk、data governance、third-party dependency、cyber risk、privacy 和 accountability 等问题。其 2024 年对金融 AI 监管的研究也指出，GenAI 会进一步放大 hallucination 等风险，而治理、模型风险管理、数据治理和第三方 AI 服务都需要关注。

FINRA 在 2026 年进一步指出，AI Agent 的自治性可能带来新的 regulatory、supervisory 和 operational considerations，并特别提出：

```text
monitor agent system access and data handling
human-in-the-loop
track agent actions and decisions
establish guardrails
```

这些要求天然意味着：

```text
Agent reasoning
```

和：

```text
control plane
```

需要分开。

---

# 二十六、一个简单的判断公式

可以把 Skill 规则设计抽象成：

```text
Rule Value
=
Determinism
×
Impact
×
Auditability
×
Machine-Representability
```

当四项都高时：

```text
→ Script / Policy
```

例如：

```text
“交易金额超过 100 万必须二次审批”
```

四项都很高。

而：

```text
“判断客户是否真正对这个建议感兴趣”
```

通常：

```text
Determinism        ↓
Machine-Representability ↓
```

所以更适合：

```text
LLM
```

但如果这个语义判断最终会决定：

```text
是否能执行交易
```

那么：

```text
LLM classification
        ↓
evidence
        ↓
deterministic policy
        ↓
human approval
```

而不是让 LLM 自己宣布：

```text
approved = true
```

---

# 二十七、最终可以形成一张“Skill Rule Map”

```text
                         Skill Rule
                             │
            ┌────────────────┼────────────────┐
            │                │                │
            ▼                ▼                ▼
      Can be formalized?  Semantic?      High impact?
            │                │                │
          Yes               Yes              Yes
            │                │                │
            ▼                ▼                ▼
        Script /          LLM            Policy /
         Schema                           Workflow
            │                │                │
            └──────────┬─────┴────────────────┘
                       │
                       ▼
               Structured Proposal
                       │
                       ▼
              Deterministic Enforcement
                       │
                       ▼
                  Tool Execution
```

再具体一点：

```text
LLM:
- understand
- classify
- extract
- summarize
- plan
- explain

Script:
- calculate
- validate
- normalize
- parse
- transform
- verify

Policy:
- authorize
- restrict
- permit
- deny
- require approval

Workflow:
- define state
- transition state
- persist case
- resume
- escalate
- complete

Human:
- resolve ambiguity
- approve high-impact action
- handle exceptions
```

这五者不应该互相越界。

---

# 二十八、结论

“哪些规则应该写脚本，哪些规则应该交给 LLM”真正解决的不是 Skill 文件如何组织，而是：

> **哪些决策应该允许模型参与，哪些决策必须由确定性系统掌握。**

可以归纳成四句话。

**第一，能计算的，不要猜。**

金额、日期、schema、状态、格式、权限、阈值、签名、幂等性等问题，应尽量由程序解决。

**第二，必须理解语言的，不要硬编码。**

意图识别、语义分类、摘要、信息抽取、文档理解、复杂规划等问题，应交给 LLM，但应该通过结构化输出、评估和必要的人审降低风险。

**第三，高风险规则不能只是 Skill instruction。**

Authorization、Data Entitlement、Policy、Approval、Workflow State 等必须进入可执行控制面。Skill 可以告诉 Agent“需要检查什么”，但不能成为最后一道防线。

**第四，最成熟的 Agent 架构不是“LLM 或 Script”，而是：**

```text
LLM
→ Semantic Proposal
→ Script / Schema Validation
→ Policy / Authorization
→ Workflow State
→ Tool Execution
→ Audit
```

因此，未来一个成熟的 Skill 不应该只是：

```text
SKILL.md
```

而应该逐渐形成：

```text
SKILL.md
+
scripts/
+
schemas/
+
references/
+
policy references
+
evaluation
```

同时需要明确：

> **Skill 是 Agent 的能力与行为说明书；Script 是确定性执行器；Policy 是边界；Workflow 是业务状态；LLM 是语义与规划引擎。**

一旦把这几个边界建立起来，Skill 就不再只是“一组 Prompt”，而会变成一种真正可以进入企业 Agent 平台、金融业务流程和治理体系的可组合能力单元。

---

# 参考资料

1. **Anthropic — Equipping agents for the real world with Agent Skills**
   介绍 Skill 的基本结构、progressive disclosure，以及为什么某些任务应该使用传统代码获得 deterministic reliability。
   [Anthropic Agent Skills 文章](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills?utm_source=chatgpt.com)

2. **Agent Skills Specification**
   Agent Skills 开放规范，定义 `SKILL.md`、`scripts/`、`references/`、`assets/` 和 progressive disclosure。
   [Agent Skills Specification](https://agentskills.io/specification?utm_source=chatgpt.com)

3. **GitHub — Adding agent skills for GitHub Copilot**
   GitHub Copilot 的 Skill 支持 `SKILL.md`、脚本、allowed tools，并明确提示 Skill 可能包含 prompt injection 和恶意脚本。
   [GitHub Copilot Agent Skills](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/add-skills?utm_source=chatgpt.com)

4. **AWS Well-Architected Framework — Agentic AI Lens: Implement guardrails and alignment controls**
   明确区分 deterministic technical controls 与 probabilistic controls，并指出不能仅依赖 system prompt 作为 operational boundary。
   [AWS Agentic AI Lens — Guardrails](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentsec04-bp01.html?utm_source=chatgpt.com)

5. **AWS Well-Architected Framework — Secure agent tool usage**
   关于 tool authorization、tool input/output validation 和 approved tool registry 的架构建议。
   [AWS Agentic AI Lens — Secure agent tool usage](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentsec02.html?utm_source=chatgpt.com)

6. **OWASP GenAI — LLM06:2025 Excessive Agency**
   从最小 extension、最小 function、避免 open-ended tool、最小 permission 和用户上下文执行等角度讨论 Agent 的权限边界。
   [OWASP LLM06:2025 Excessive Agency](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/?utm_source=chatgpt.com)

7. **OpenAI Agents SDK — Guardrails**
   展示 input/output/tool guardrails、blocking execution、tripwire 等机制，说明 guardrail 可以成为实际执行链上的控制点，而不是 Prompt 文本。
   [OpenAI Agents SDK Guardrails](https://openai.github.io/openai-agents-python/guardrails/?utm_source=chatgpt.com)

8. **AgentDojo — A Dynamic Environment to Evaluate Prompt Injection Attacks and Defenses for LLM Agents**
   NeurIPS 2024 工作，覆盖电子邮件、电子银行等 tool-using agent 场景，研究外部数据驱动的 prompt injection。
   [AgentDojo 论文](https://arxiv.org/abs/2406.13352?utm_source=chatgpt.com)

9. **Agent Security Bench (ASB)**
   ICLR 2025，覆盖 finance 等 Agent 场景以及 prompt、tool、memory 等攻击面。
   [Agent Security Bench](https://openreview.net/forum?id=agent-security-bench&utm_source=chatgpt.com)

10. **Morgan Stanley — AI evals to shape the future of financial services**
    真实金融服务案例：企业知识检索、会议总结、evaluation framework、daily regression testing 和人工 review。
    [Morgan Stanley AI Evals Case Study](https://openai.com/index/morgan-stanley/?utm_source=chatgpt.com)

11. **JPMorganChase — Strengthening LLM guardrails with synthetic data generation**
    2026 年公开介绍 Fence guardrail framework，以及针对 hallucination、topic drift、prompt injection 的 use-case-specific guardrails。
    [JPMorganChase Fence Framework](https://www.jpmorganchase.com/about/technology/blog/fence-framework?utm_source=chatgpt.com)

12. **JPMorganChase — LLM Suite**
    介绍企业级 GenAI 平台以及将 GenAI 与 workflows 结合、进一步构建 Agent 的实践方向。
    [JPMorganChase LLM Suite](https://www.jpmorganchase.com/about/technology/blog/llmsuite-ab-award?utm_source=chatgpt.com)

13. **Capital One — How AI Is Transforming Financial Services**
    介绍金融场景中的 generative AI agent、数据质量、evaluation、testing 和 guardrails。
    [Capital One AI in Financial Services](https://www.capitalone.com/tech/ai/transforming-financial-services/?utm_source=chatgpt.com)

14. **FINRA — GenAI: Continuing and Emerging Trends, 2026**
    从证券行业监管视角讨论 Agent access/data handling、human-in-the-loop、action/decision tracking 和 guardrails。
    [FINRA 2026 GenAI Report](https://www.finra.org/rules-guidance/guidance/reports/2026-finra-annual-regulatory-oversight-report/gen-ai?utm_source=chatgpt.com)

15. **BIS — Regulating AI in the financial sector: recent developments and main challenges**
    从金融监管和风险管理角度讨论 AI governance、model risk、data governance、第三方 AI 服务等问题。
    [BIS FSI Insight 63](https://www.bis.org/publications/fsi-insight-63-regulating-ai-financial-sector-recent-developments-and-main-challenges?utm_source=chatgpt.com)

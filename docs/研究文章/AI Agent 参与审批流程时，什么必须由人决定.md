# AI Agent 参与审批流程时，什么必须由人决定

## 一、真正的问题不是“哪些操作需要 Approval”

Agent 进入企业审批流程以后，一个很自然的问题是：

> 哪些事情必须让人批准？

但这个问题其实还不够准确。

因为“审批”只是表现形式。真正需要解决的是：

> **哪些决策的最终 Authority 应该保留在人类或组织授权体系中，而不能由 Agent 自主决定？**

例如：

```text id="3gxq2f"
Agent
  ↓
发现一个 Proposal
  ↓
判断是否符合规则
  ↓
决定是否需要升级
  ↓
选择 Approver
  ↓
请求批准
  ↓
执行
```

这里至少有五种不同的决定：

```text id="8mvk3p"
1. Agent 应该提出什么 Proposal？

2. 这个 Proposal 是否符合 Policy？

3. 谁拥有批准这个 Proposal 的 Authority？

4. Proposal 是否应该真正获得批准？

5. Approved Proposal 是否可以执行？
```

不能把这五个决定全部压缩成：

```text id="i3qjhe"
Human Approval
```

也不能反过来：

```text id="k1i70e"
Agent 判断
    ↓
全部自动完成
```

真正成熟的架构应该是：

> **让 Agent 自主处理机器擅长的判断，把不可转移的组织责任、授权和高影响业务判断保留在明确的人类控制边界内。**

AWS 当前 Agentic AI Lens 明确采用 risk-tiered human oversight，而不是“所有 Agent 动作都人工审批”：低风险动作可以自主执行，中风险可以通知，高风险或不可逆动作可以要求显式人工批准。

FINRA 在 2026 年针对 AI Agents 的监管观察也把 autonomy、scope/authority、auditability 等列为新风险，并建议金融机构确定哪些地方需要 Human-in-the-loop、如何跟踪 Agent actions / decisions，以及如何设置限制 Agent 行为的 guardrails。

因此：

> **“必须由人决定”不是一个按 Tool 列出来的清单，而是一套 Authority Allocation 原则。**

---

# 二、先把三个概念分开：Human-in-the-loop、Human Authority、Human Accountability

这三个经常被混成一个。

## 1. Human-in-the-loop

表示：

> 流程中存在一个明确的人类介入点。

例如：

```text id="7m8ujc"
Agent
  ↓
Human Task
  ↓
Continue
```

它回答：

> 人什么时候介入？

---

## 2. Human Authority

表示：

> 谁拥有作出某个组织决定的权限？

例如：

```text id="l5q7v4"
Portfolio Manager
    → approve investment

Compliance Officer
    → clear exception
```

它回答：

> 谁有权决定？

---

## 3. Human Accountability

表示：

> 如果这个业务结果造成损失，组织内部由谁承担相应的业务责任？

这可能是：

```text id="z43h0c"
Business Owner
Risk Owner
Senior Management
```

它回答：

> 谁对结果负责？

因此：

```text id="jy6c2l"
Human-in-the-loop
    ≠
Human Authority
    ≠
Human Accountability
```

一个 Agent 可以参与 HITL Workflow，但不能因此获得 Human Authority。

同样，有 Human Authority 的人也不意味着每一个动作都必须亲自操作。

NIST 明确要求 AI 系统中的 Human roles and responsibilities 要清晰定义和区分，并指出 Human-AI 配置可以覆盖从完全自主到完全人工的连续范围。

---

# 三、“必须由人决定”至少有四种来源

企业在定义 Human-reserved decisions 时，不应该只看技术风险。

至少需要考虑四个来源：

```text id="zv3u0r"
Legal / Regulatory
        ↓
Organizational Authority
        ↓
Business Accountability
        ↓
Risk / Irreversibility / Uncertainty
```

最终决定：

```text id="r9wknp"
Human-reserved Decision
```

因此：

> 不是所有高风险动作都天然必须人工，也不是所有低风险动作都可以自动化。

尤其“法律规定必须人工”与“企业架构认为应该保留人工判断”是两种完全不同的结论。

---

# 四、第一类：法律或监管明确要求人类介入

这是最强的一层。

如果适用的法律、监管规则、许可条件或内部监管承诺明确要求：

> 人必须进行确认、复核、授权或承担最终决定。

那么 Agent 不能把这个节点自动化掉。

欧盟 AI Act 第 14 条对 High-Risk AI 的 Human Oversight 提出了明确要求：系统要能够被自然人有效监督；监督人员应能理解系统能力和限制、识别异常、避免 automation bias、在特定情况下忽略或推翻模型输出，并能够通过安全停止机制中断系统。对于特定生物识别场景，法规还规定了更强的至少两名具备相应能力、训练和权限的自然人独立确认要求。

需要特别注意：

> **这不等于“所有金融审批依法都必须由人完成”。**

具体是否存在法律上的 Human Decision Requirement，仍然取决于具体业务、司法辖区、AI use case 和适用法规。

因此企业架构文档中不要写：

> “法律规定金融 AI 审批必须人工。”

更准确：

> “对于适用法律或监管规则明确要求人工监督、复核或决定的场景，Agent 不得替代该法定 Human Authority。”

---

# 五、第二类：组织授权不能被 Agent 自己改变

这是金融 Agent 最重要的一类。

例如：

```text id="n6w4r3"
Portfolio Manager
    ↓
拥有投资批准权限
```

Agent 可以：

```text id="4n8gv0"
准备 Proposal
分析风险
检查资料
提出建议
```

但不能：

```text id="71j0x6"
自己决定：

“这个操作应该由我批准。”
```

也不能：

```text id="y1d6rr"
修改 Approval Policy
↓
把自己加入 Approver
↓
继续执行
```

因此：

> **凡是决定“谁有权决定什么”的 Authority Configuration，不应该由 Agent 自己决定。**

包括：

```text id="6o1gq5"
Role assignment
Approval threshold
Capability grant
Delegation scope
Policy change
SoD rule
Ownership transfer
Exception authority
```

这与前面的 Maker-Checker 和多人 Workflow 原则直接一致。

---

# 六、Agent 最不能自己决定的，其实不是“业务结果”，而是“自己的 Authority”

这是一个非常重要的分界。

Agent 可以建议：

> “由于金额超过 10M，我建议升级到 Investment Committee。”

但不能：

> “金额超过 10M，所以我自动获得 Committee 的审批权限。”

也不能：

> “当前 Approver 不在线，因此我把自己设置成 Approver。”

所以可以形成一个强不变量：

```text id="9y0sy9"
Agent may request authority
        ↓
Agent may not grant authority to itself
```

换句话说：

> **Agent 可以消费 Authority，但不能自行创造 Authority。**

---

# 七、第三类：最终业务判断需要承担组织责任

这类问题最容易被技术人员低估。

假设 Agent 给出：

```text id="pno5v8"
Investment Recommendation:
BUY
```

这不是一个普通 Tool Result。

如果最终决定：

```text id="w6z0r4"
“公司决定买入。”
```

那么这个判断可能涉及：

```text id="d4l65k"
Mandate
Risk appetite
Investment strategy
Fiduciary responsibility
Client interest
Regulatory obligations
Business accountability
```

这时真正的问题不是：

> “模型够不够聪明？”

而是：

> **组织是否愿意把这个 Decision Authority 授予一个 Agent？**

BIS 2026 年关于 AI 与金融监管的讲话明确强调，金融机构必须自己承担 AI 风险，风险所有权不在 AI 工具本身；AI 可以参与工作，但最终责任仍属于持牌金融机构及其负责人员。

BIS 在 2026 年 9 月关于印度银行 AI 的讲话也明确强调：银行决策的责任属于银行，而不是算法；在 AI 错误可能造成重大伤害的节点，应保留有意义的人类监督，包括解释、干预和必要时推翻结果的能力。

因此：

> **如果一个 Decision 本身代表组织做出需要承担业务责任的最终判断，应明确指定 Human / Organizational Authority，而不能仅因为 Agent 能完成它，就把 Authority 自动转给 Agent。**

---

# 八、第四类：不可逆或高影响的业务动作

这是最常见的 Human Approval 场景。

典型：

```text id="jym9ax"
不可逆
高损失
大范围影响
外部法律后果
客户重大影响
声誉重大影响
金融市场影响
```

例如：

```text id="lx7hw0"
大额付款
交易执行
正式对外承诺
终止客户关系
重大信用决定
大规模数据删除
正式提交监管材料
改变关键权限
改变核心 Policy
```

AWS 当前建议使用 risk-tiered oversight，把高风险或不可逆操作纳入 explicit human approval，同时避免低风险动作全部走人工审批。

BIS 2026 年关于 AI Cash Management 的研究也指出，AI Agent 可以执行复杂的现金管理任务，但在金融市场基础设施等场景仍需要 regulatory safeguards 和 human oversight。

因此可采用：

```text id="j4svz0"
Impact × Reversibility × Risk
        ↓
Oversight Level
```

而不是：

```text id="3h2y1c"
Tool = dangerous
        ↓
always approval
```

---

# 九、但“高风险 = 必须人来做”仍然太绝对

这是非常重要的修正。

更准确的模型是：

```text id="f6e8hy"
Risk
×
Impact
×
Reversibility
×
Uncertainty
×
Autonomy
×
Blast Radius
×
Regulatory Requirement
        ↓
Oversight Requirement
```

例如：

```text id="vgn9t2"
Risk = high
Impact = high
Reversible = yes
Strong deterministic controls = yes
Regulation = no human requirement
```

可能仍然允许：

```text id="t4c8rn"
constrained automation
```

反过来：

```text id="jpn6yz"
Risk = moderate
```

但：

```text id="4f4pp5"
legal authority explicitly human
```

仍然必须人工。

因此：

> **风险是决定 Human Oversight 强度的重要变量，但不是唯一变量。**

EU AI Act 本身也强调 Human Oversight 措施应与系统的风险、自治程度和使用环境相称，而不是统一采用同一种人工介入方式。

---

# 十、真正值得“必须由人决定”的，是 Decision Authority

可以将业务动作拆成：

```text id="bw8d8h"
Observe
  ↓
Analyze
  ↓
Recommend
  ↓
Decide
  ↓
Authorize
  ↓
Execute
  ↓
Reconcile
```

Agent 可以在：

```text id="3p0m0x"
Observe
Analyze
Recommend
```

发挥很大作用。

有些场景甚至可以：

```text id="qutv2y"
Decide
```

自动完成。

但对于组织关键动作：

```text id="7yvd5j"
Authorize
```

通常应该始终由明确的外部控制决定。

所以：

> **“必须由人决定”更准确地说，是“必须由人保留最终 Decision Authority”。**

---

# 十一、推荐把“Human Reserved Decision”分成六类

这是可以直接落到企业 Agent Control Plane 中的分类。

## 1. Authority Decision

> 谁可以做什么？

例如：

```text id="g8r3e7"
grant approval authority
change role
change policy
change delegation
```

这类决定不应该由 Agent 自行完成。

---

## 2. Accountability Decision

> 组织最终要承担什么业务责任？

例如：

```text id="4qyyxv"
approve strategic investment
accept material risk
accept regulatory exception
accept major operational risk
```

通常需要明确的人类/组织 Authority。

---

## 3. Irreversible Action Decision

> 是否允许一个难以恢复的动作发生？

例如：

```text id="8yn6oc"
large payment
irreversible deletion
termination
external legal commitment
market submission
```

通常进入强监督层。

---

## 4. Exception Decision

> 是否允许偏离正常规则？

例如：

```text id="8gc1s2"
limit exception
policy exception
compliance exception
missing document exception
manual override
```

这类决定尤其不应该由：

```text id="js4ouq"
提出异常
```

的 Agent 自己：

```text id="2p3l9b"
批准异常
```

---

## 5. Ambiguous / Value-Laden Decision

> 当规则无法唯一确定答案时，谁承担判断？

例如：

```text id="kq4x7e"
两种方案都合法
两种方案风险不同
需要权衡客户利益与收益
存在战略取舍
```

Agent 可以：

```text id="e0b2c4"
分析 trade-offs
```

但最终价值判断可以需要 Human。

---

## 6. Contest / Override Decision

> 对 Agent 决定提出异议后，谁最终裁决？

例如：

```text id="a0qmtv"
Agent says reject
Human says challenge
```

系统必须存在：

```text id="t14d02"
appeal
override
re-review
```

这也是 Human Oversight 不是“Approval Button”的一个重要原因。

---

# 十二、Agent 最适合决定什么？

反过来也很重要。

不能因为强调 Human Authority，就把 Agent 变成：

```text id="k0p1f7"
高级 Calculator
```

Agent 非常适合自主处理：

```text id="v5m17f"
Information Retrieval
Classification
Summarization
Evidence Extraction
Drafting
Planning
Routing Suggestions
Anomaly Detection
Consistency Checking
Candidate Generation
Low-risk Reversible Actions
```

Anthropic 对 Agent 的定义本身就是一个自主循环：Agent 会自行规划、使用工具、观察结果并调整下一步；Anthropic 的可信 Agent 框架强调在赋予这种自主能力的同时，仍然要保持 Human Control，并允许用户决定哪些动作可以 always allow、哪些需要 approval、哪些禁止。

所以目标不是：

```text id="qxklnq"
Agent does not decide anything.
```

而是：

```text id="adwtd0"
Agent decides within its delegated autonomy boundary.
```

---

# 十三、真正应该建立的是“Decision Boundary”

一个很有用的模型：

```text id="hn1a4t"
                    Decision Space
                         │
          ┌──────────────┼──────────────┐
          │                              │
   Agent Autonomous              Human Reserved
          │                              │
  Planning                         Authority
  Research                         Accountability
  Classification                  Exceptions
  Drafting                         High Impact
  Low-risk Action                 Irreversible
  Routing                         Value Judgment
          │                              │
          └──────────────┬───────────────┘
                         │
                   Policy Boundary
```

这里：

> Agent 并不是不能做 Decision。

而是：

> **Decision Space 要被明确划分。**

---

# 十四、一个非常重要的区别：Recommendation vs Decision

例如：

```text id="ebq1b6"
Agent:
“建议批准。”
```

这可以是：

```text id="mmt8r0"
Recommendation
```

而：

```text id="scbd4m"
Workflow:
Decision = APPROVED
```

才是：

```text id="7evr88"
Business Decision
```

这两个不能只是 UI 上差了一个颜色。

Domain Model 中必须不同：

```text id="1t6j8v"
Recommendation
    ≠
Decision
```

Agent 可以大量生成 Recommendation。

但 Recommendation 是否升级成 Decision：

```text id="9jre9k"
Human
Policy
Workflow
```

共同决定。

---

# 十五、Approval 也不要被理解成“Agent 的建议加一个按钮”

正确链条应该是：

```text id="w0o0d1"
Agent Recommendation
        ↓
Proposal
        ↓
Review / Evidence
        ↓
Human Decision
        ↓
Authorization
        ↓
Command
```

而不是：

```text id="dws0kl"
Agent Recommendation
        ↓
Approve Button
        ↓
Execute
```

原因是：

> 人点击的是一个明确的 Decision，而不是给 Agent 的自然语言输出盖章。

---

# 十六、人到底应该看到什么？

如果要求 Human 决定，最重要的不是：

```text id="4nz6l9"
把按钮交给人
```

而是：

> **让人真正具备作出决定所需的信息。**

AWS 明确要求高风险 Approval 提供足够的上下文，否则人工审批容易退化为 rubber-stamp approval；结构化 review request 至少应包括 proposed action、reasoning、impact assessment 和 execution history。

一个金融 Approval Context 至少可以包括：

```text id="s0l7aj"
Business Object
Proposed Action
Parameters
Current Business State
Relevant Evidence
Data Sources
Policy Result
Risk Classification
Potential Impact
Alternatives
Agent Confidence / Uncertainty
Previous Human Decisions
Approval Scope
```

但：

> 这不等于需要展示模型完整 Chain-of-Thought。

更适合给 Human 的是：

```text id="k4j7co"
Decision Summary
Evidence
Relevant Facts
Policy Checks
Known Risks
Alternatives
Proposed Action
```

---

# 十七、Human 必须拥有“不同意 Agent”的真实能力

如果 UI 是：

```text id="q5z5ou"
Agent recommendation: APPROVE

[Approve]
[Reject]
```

但：

```text id="4sor8h"
Reject
```

以后 Agent 还是：

```text id="2l9g14"
自己继续执行
```

那么这不是真正的 Human Oversight。

Human 至少需要：

```text id="3c8mib"
Approve
Reject
Modify
Request More Evidence
Escalate
Stop
```

必要时：

```text id="r5oh4n"
Override
```

EU AI Act Article 14 明确要求适用的 High-Risk AI Human Oversight 应使人能够理解系统、避免过度依赖、选择不使用或忽略/推翻输出，并在必要时中断系统。

---

# 十八、Human 不能只拥有“否决权”，还需要拥有“纠偏权”

例如：

```text id="7x8gwz"
Agent Proposal:
Buy 1,000

Human:
“方向正确，但应该是 600。”
```

如果只有：

```text id="8x3xuq"
Approve
Reject
```

Human 只能 Reject。

然后：

```text id="wq1jz8"
Agent重新思考
```

整个流程重复。

更好的：

```text id="j5d6td"
Agent Proposal
    ↓
Human Correction
    ↓
Proposal v2
    ↓
Re-validation
    ↓
Approval
```

这才是真正把 Human 的判断力加入 Agent Loop。

Microsoft Agent Framework 当前的 HITL Request/Response 并不限于 approval，也支持外部系统向 Workflow 返回任意类型的响应；Microsoft 还明确建议，对于需要用户提供信息并多轮迭代的场景，使用交互式 handoff，而不是只有 approve/reject。

---

# 十九、什么情况必须由“有资格的人”决定？

Human 参与本身还不够。

真正需要的是：

> **Human with Authority and Competence**

例如：

```text id="nx9m5s"
Investment Proposal
```

不能因为：

```text id="a2l48p"
任何员工
```

点击：

```text id="Approve"
```

就满足控制要求。

应该：

```text id="w9o4l4"
Human
+
Required Role
+
Capability
+
Authority
+
No SoD conflict
```

EU AI Act Article 14 对 High-Risk AI Human Oversight 的设计同样强调，承担监督的人需要具备相应 competence、training 和 authority。

---

# 二十、因此“Human-in-the-loop”其实不够精确

更准确的模型是：

```text id="i1xwlj"
Human-in-the-loop
        +
Right Human
        +
Enough Context
        +
Real Authority
        +
Ability to Override
```

缺一项，都可能变成：

```text id="v9j8tc"
Human Theater
```

也就是：

> 人看起来参与了，实际上并没有真正控制。

---

# 二十一、最危险的情况：Automation Bias

如果 Agent：

```text id="g5z3ij"
99% 时间正确
```

Human 每次都点击：

```text id="q0grzj"
Approve
```

长期下来：

```text id="62m0xk"
Human
    ↓
rubber stamp
```

反而可能降低控制效果。

AWS 当前明确把 reviewer fatigue 和 rubber-stamp approvals 作为所有动作统一人工审批的反模式。

欧盟 AI Act 也明确要求 Human Oversight 人员保持对 automation bias 的意识。

因此：

> **人类监督的目标不是让人每次点击一次，而是让人的判断在真正需要时有效改变结果。**

---

# 二十二、所以“必须由人决定”并不等于“每次都要求人点击”

这是本文最重要的结论之一。

例如：

```text id="i5r5l8"
Low-risk request
```

可以：

```text id="h3u2cq"
自动执行
```

中风险：

```text id="v4vjz7"
通知 Human
```

高风险：

```text id="c6j66m"
Human Approval
```

极高风险：

```text id="8rp4mj"
Human Decision
+
Four-eyes
+
Dual Control
```

这是：

```text id="khjrl5"
Risk-tiered Human Oversight
```

而不是：

```text id="w63qj4"
Everything Human Approval
```

AWS 当前明确推荐 Autonomous / Notify / Approve 这样的分层，并强调风险、影响和可逆性。

---

# 二十三、一个实用的 Human Decision Taxonomy

可以把 Agent 决策分成五级。

| Level | Decision      | Agent    | Human                    |
| ----- | ------------- | -------- | ------------------------ |
| L0    | 信息处理          | 自主       | 不介入                      |
| L1    | 低风险可逆动作       | 自主       | 可观察                      |
| L2    | 中风险动作         | 建议/执行    | Notify / 可介入             |
| L3    | 高影响业务动作       | Proposal | Human Decision           |
| L4    | 权限、重大例外、不可逆决策 | 分析/准备    | Human Authority / 可能双人控制 |

注意：

> 这是架构模型，不是监管规定。

具体行业需要根据业务、风险和适用法规调整。

---

# 二十四、哪些 Decision 通常应该进入 L3 / L4？

## 1. 修改组织授权

```text id="8z72y7"
Role
Permission
Capability
Policy
Delegation
Approval Threshold
```

这些最好保留给 Human / Governance Function。

---

## 2. 改变 Business Ownership

```text id="f0xq2v"
Case Owner
Accountable Owner
Risk Owner
```

因为这会改变责任链。

---

## 3. 重大 Exception

```text id="4o5ozh"
Compliance Exception
Risk Limit Exception
Missing Evidence Exception
Policy Override
```

Agent 可以：

```text id="9z7fyk"
识别
解释
准备 exception package
```

但不应该自己：

```text id="fflqgb"
批准自己的 exception
```

---

## 4. 最终外部承诺

```text id="u0h2j3"
提交客户承诺
合同承诺
监管提交
正式投资决定
```

尤其当该行为无法轻易撤销时。

---

## 5. 价值判断或利益冲突

```text id="yodq0b"
客户利益
收益与风险取舍
战略例外
利益冲突
声誉风险
```

Agent 可以比较方案。

但最终：

> 谁代表组织做价值判断？

应该明确。

---

# 二十五、什么情况通常可以由 Agent 自主决定？

反过来也要明确，否则最终会得到一个“Agent 什么都不能做”的系统。

例如：

```text id="9k7kvg"
选择搜索关键词
决定检索顺序
决定先读哪些文档
整理证据
归纳风险
生成摘要
检测明显异常
生成 Draft
安排低风险工作
选择已批准的 Tool
在权限范围内重试
在预算范围内调整执行计划
```

这些通常属于：

```text id="vm0z1b"
delegated operational autonomy
```

而不是：

```text id="3n8s5d"
organizational authority
```

Anthropic 对 Agent 的工程定义同样强调 Agent 的价值来自自主规划、工具调用和根据结果调整路径，而不是简单生成答案。

---

# 二十六、一个很实用的判断法：问“错了以后，谁承担什么？”

每一个 Agent Decision 都问：

```text id="7y6nrk"
如果 Agent 错了：

1. 能不能自动恢复？
2. 能不能回滚？
3. 有没有客户直接受到影响？
4. 有没有法律后果？
5. 有没有金融损失？
6. 有没有组织责任？
7. 谁需要向客户/监管解释？
```

如果答案开始变成：

```text id="t0j0om"
无法恢复
重大损失
客户受到影响
需要组织解释
需要监管解释
```

那么这个 Decision 更应该进入：

```text id="0e7v4b"
Human Reserved Decision
```

---

# 二十七、另一个判断法：谁拥有“最终否决权”？

对每个重要 Agent Action：

```text id="8znk9g"
Who can stop this?
```

如果回答：

```text id="50y7tg"
Agent
```

需要高度警惕。

例如：

```text id="gf9q3r"
Agent decides:
"Policy exception is acceptable."
```

如果没有：

```text id="9nw8w2"
Human / external Policy veto
```

那么 Agent 已经成为自己的 Checker。

---

# 二十八、再问：谁能改变 Agent 的 Decision Boundary？

假设：

```text id="m6i2e8"
Agent currently can approve <= 1M
```

那么：

> 谁能改成 10M？

正确：

```text id="2r7ivc"
Governance / Authorized Human
```

而不是：

```text id="s3g50x"
Agent itself
```

所以：

> **Human Reserved Decisions 不只是业务决策，还包括决定 Agent 决策边界本身。**

---

# 二十九、Agent 可以在自己的边界内部做大量 Decision

例如：

```text id="6vw6qa"
Allowed:
READ
SEARCH
SUMMARIZE
DRAFT
RECOMMEND
```

Agent 可以自由决定：

```text id="unipym"
先搜哪个数据源
用哪个检索词
哪个证据相关
哪个候选方案更优
如何组织结果
```

但：

```text id="hux9bf"
Boundary change:
WRITE
APPROVE
EXECUTE
GRANT_ACCESS
CHANGE_POLICY
```

则需要进入：

```text id="8gm5bf"
Control Plane
```

这就是：

> **Controlled Autonomy**

---

# 三十、Agent 参与审批时，可以把人放在三个不同位置

## Position A：Before Decision

```text id="4pg4hl"
Agent proposes
    ↓
Human decides
    ↓
Agent executes
```

适合：

```text id="bhjtkk"
high-impact
irreversible
authority-sensitive
```

---

## Position B：During Decision

```text id="x7yx9g"
Agent analyzes
    ↓
Human corrects / chooses
    ↓
Agent continues
```

适合：

```text id="74d1ax"
ambiguity
missing information
trade-offs
```

---

## Position C：After / Around Decision

```text id="0b9hxx"
Agent operates
    ↓
Human monitors
    ↓
exception → Human
```

适合：

```text id="46s4t1"
low-risk
high-volume
reversible
```

这与 Human-in-the-loop、Human-on-the-loop、Human-in-command 的不同监督形态一致。BIS 长期将这些不同监督模式视为金融机构设计 AI 控制时的重要维度；FSB 2026 年 AI 咨询工作也进一步关注不同层级的人类监督机制。

---

# 三十一、Human-in-command 是解决“Agent 太自主”的关键

如果 Agent 长时间自主运行：

```text id="n9s0v2"
Agent
  ↓
1000 tasks
  ↓
continue
```

不可能每个动作都：

```text id="6o9tfv"
Human Approval
```

这时候 Human 应该决定：

```text id="u5v83m"
Agent 可以做什么
Agent 不能做什么
什么必须升级
预算上限
数据范围
执行范围
什么时候停止
什么时候重新确认
```

也就是：

> 人决定 Agent 的 **Decision Boundary**，而不是亲自决定每个业务动作。

这也是为什么成熟 Agent Governance 最终需要从 HITL 发展到：

```text id="s1hbwp"
Human-in-command
```

---

# 三十二、AI Agent 不能成为最终“Policy Interpreter”

例如：

```text id="dfh0tk"
Policy:
High-risk trades require approval.
```

Agent 解释：

> “我觉得这个 Trade 不算 high-risk。”

不能由它自己决定：

```text id="k8jz4y"
因此无需 Approval。
```

更好的：

```text id="5dq7p6"
Agent
  ↓
Risk Classification Request
  ↓
Policy Engine
  ↓
Risk Tier = HIGH
  ↓
Human Approval Required
```

如果分类本身允许模型参与：

```text id="fsw5uv"
Agent Classification
    ↓
Policy Validation
```

而不是：

```text id="6v6scw"
Agent Classification
    ↓
Agent decides its own requirement
```

---

# 三十三、这也是为什么“必须由人决定”应该变成“必须由 Human Authority 或 Policy Authority 决定”

有些决定并不需要每次人工。

例如：

```text id="x8frq7"
Trade amount > 10M
```

Policy 可以确定：

```text id="3yupxx"
Approval required
```

然后：

```text id="kcbjtx"
Human decides actual Approval
```

因此最终可以分为：

```text id="c3sp1b"
Machine Policy Decision
+
Human Business Decision
```

二者组合成真正的控制。

---

# 三十四、Human Decision 与 Policy Decision 的职责不同

例如：

```text id="5g6y1n"
Policy:
“这个金额超过阈值，必须经过两个 Approvers。”
```

这是：

```text id="8h2u4a"
Policy Decision
```

而：

```text id="h7cq6e"
Alice:
“我同意这个 Proposal。”
Bob:
“我不同意。”
```

这是：

```text id="chssly"
Human Decision
```

最后：

```text id="3yd4ku"
2 approvals
```

才能：

```text id="8aoz3a"
Workflow → approved
```

所以：

> **Policy 决定“需要什么样的人类决策”；Human 决定“具体业务选择是什么”。**

---

# 三十五、审批人的真正工作不是“验证 LLM”

一个错误的设计：

```text id="s9y7el"
Human:
检查 Agent 有没有算错
```

所有时间都耗在：

```text id="h4s0xq"
重新读 100 页材料
```

这不是有效的人机协作。

更好的：

```text id="f5qkyf"
Agent:
整理证据
识别冲突
指出异常
生成 alternatives

Human:
做最终判断
```

Human 应重点回答：

```text id="w4y5d5"
是否接受这个风险？
是否接受这个例外？
是否承担这个责任？
哪个方案符合业务目标？
是否批准？
```

这才是：

> Human Judgment。

---

# 三十六、Human Reviewer 必须具备 Challenge 能力

如果：

```text id="6hr3wi"
Agent recommendation
```

Human 只能：

```text id="2m5ch5"
Approve / Reject
```

那么系统容易把人变成：

```text id="l37a8w"
Binary Gate
```

应该能够：

```text id="dd4x9y"
Ask for Evidence
Request Re-analysis
Modify Proposal
Request Different Data
Escalate
```

这与 Microsoft 当前 Agent Framework 的 Request/Response 与 interactive handoff 模式相符：Human 不只是对 Tool Call 返回 true/false，也可以向 Workflow 返回结构化信息，让 Agent 继续迭代。

---

# 三十七、因此 Approval UI 最好不要只有两个按钮

对于重要 Decision：

```text id="1h4xg0"
[Approve]
[Reject]
```

可以扩展：

```text id="q9o3r5"
[Approve]
[Reject]
[Request Changes]
[Ask Agent to Re-check]
[Escalate]
[Stop]
```

不同按钮对应：

```text id="7js4gl"
不同 Decision Outcome
```

而不是：

```text id="jz2f8k"
不同 UI 操作
```

---

# 三十八、Agent 应该能够解释“为什么需要人”

这是另一个值得工程化的地方。

当 Agent 请求 Human Decision 时，不要只显示：

```text id="8m9x6j"
Approval Required
```

最好返回：

```json id="6t1sgf"
{
  "reason": "HIGH_IMPACT_IRREVERSIBLE_ACTION",

  "action": "SUBMIT_PROXY_VOTE",

  "risk": {
    "tier": "HIGH",
    "reason": [
      "external_side_effect",
      "irreversible_after_submission"
    ]
  },

  "requiredAuthority": {
    "role": "PORTFOLIO_MANAGER"
  }
}
```

这样 Human 知道：

> 为什么现在需要我。

AWS 当前的风险分级 Approval Guidance 就强调 Human Task 应包含 action、impact、reasoning / execution context，而不是只给一个批准按钮。

---

# 三十九、“为什么需要人”本身也应该由 Policy 决定

不能：

```text id="bzru8c"
Agent:
“我觉得这个有点危险，所以需要人。”
```

然后：

```text id="f9p2j7"
Agent decides if human approval is required
```

最好：

```text id="l8zi3x"
Action
   ↓
Risk / Policy Classification
   ↓
Oversight Tier
   ↓
Human Requirement
```

Agent 可以提供：

```text id="4wf4u7"
dynamic risk signals
```

但最终：

```text id="9la4l9"
Human Required = Policy Decision
```

---

# 四十、Human Approval 也应该重新验证

一个常见错误：

```text id="y4bqsd"
10:00 Agent Proposal
10:05 Human Approves
12:00 Agent Executes
```

但在 12:00：

```text id="q2y1v6"
Business State changed
Policy changed
Authorization changed
Risk changed
```

仍然直接执行。

更好的：

```text id="j7i7wf"
Human Decision
    ↓
Resume Workflow
    ↓
Revalidate:
  Policy
  Authorization
  Business State
  Approval Scope
    ↓
Command
```

所以：

> **Human Decision 是一个输入，不是跳过其他控制的万能通行证。**

---

# 四十一、Human 决定的内容应该绑定 Scope

例如：

```text id="r5pxgp"
Approve:
Proxy Vote
Security = ABC
Vote = FOR
Quantity = 125,000
```

不能变成：

```text id="b0l7vk"
Approve all future Proxy Votes
```

AWS 当前 guidance 明确建议把持久信任 / Approval 绑定到具体 command、参数范围或 resource；无参数约束的 wildcard trust 会把 Human Oversight 从整个操作类别中移除。

因此：

```text id="w4l1q6"
Human Decision
    +
Scope
    +
Version
```

一起形成：

```text id="9zwj6d"
Approved Proposal
```

---

# 四十二、Human 决定不能自动变成 Agent Memory

例如 Agent Memory：

```text id="cmv8jz"
“Bob approves this type of transaction.”
```

不能变成：

```text id="70su4t"
standing approval
```

除非组织明确配置：

```text id="m4ewhs"
Standing Approval Policy
```

Human 一次批准：

```text id="3q2k7f"
Proposal X
```

默认只批准：

```text id="qv0cy7"
X
```

不能让 Agent 自己泛化成：

```text id="x2l4g6"
X, Y, Z...
```

---

# 四十三、Standing Approval 是“人决定授权策略”，不是 Agent 自己记住批准

如果业务确实允许：

```text id="yq4tcm"
所有 < $10K 的低风险操作自动执行
```

正确建模：

```text id="wj6h8x"
Human / Governance
    ↓
Define Standing Policy
    ↓
Policy Engine
    ↓
Agent autonomous
```

而不是：

```text id="d8b7hm"
Human approved one operation
    ↓
Agent assumes all future operations approved
```

Anthropic 当前产品实践也把权限模式明确区分为 always allow、needs approval、block，而不是要求用户对每一个动作手动批准。

---

# 四十四、所以“必须由人决定”最终有三个层次

### Layer 1：Human defines the boundary

例如：

```text id="f7j8a2"
你可以做什么？
什么必须批准？
预算多少？
数据到哪里？
什么异常必须升级？
```

这是：

> Human-in-command。

---

### Layer 2：Human makes protected business decisions

例如：

```text id="j8x1wn"
Approve investment
Approve exception
Accept material risk
Make strategic choice
```

这是：

> Human decision authority。

---

### Layer 3：Human can intervene

例如：

```text id="e5zh25"
Pause
Stop
Override
Escalate
```

这是：

> Human operational control。

三层都属于 Human Oversight。

---

# 四十五、一个非常实用的 Decision Allocation Matrix

可以直接放入企业 Agent Design Review：

| 决策                        | Agent | Policy | Human | 推荐 Authority       |
| ------------------------- | ----: | -----: | ----: | ------------------ |
| 搜索哪些资料                    |     ✓ |        |       | Agent              |
| 选择检索顺序                    |     ✓ |        |       | Agent              |
| 生成 Draft                  |     ✓ |        |       | Agent              |
| 风险初筛                      |     ✓ |      ✓ |       | Agent + Policy     |
| 是否需要 Approval             |       |      ✓ |       | Policy             |
| 选择合格 Approver             |       |      ✓ |       | Policy / Org       |
| 是否接受重大业务风险                |    建议 |     约束 |     ✓ | Human              |
| 是否批准高影响动作                 |    建议 |     约束 |     ✓ | Human              |
| 是否允许 Policy Exception     |    建议 |     约束 |     ✓ | Authorized Human   |
| 是否扩大 Agent 权限             |    建议 |      ✓ |     ✓ | Governance         |
| 是否修改 Authorization Policy |       |      ✓ |     ✓ | Governance         |
| 是否执行已批准 Command           |       |      ✓ |   不一定 | Policy + Domain    |
| 是否停止异常 Agent              |       |      ✓ |     ✓ | Human / Operations |
| 最终 Business State         |       |      ✓ |       | Domain             |

重点是：

> **Agent 可以参与 Decision；并不意味着 Agent 拥有 Decision Authority。**

---

# 四十六、一个更精确的“必须由人决定”判断矩阵

对于每个 Decision，可以评分：

```text id="5huzcg"
Regulatory Human Requirement
Business Accountability
Financial Impact
Customer Impact
Irreversibility
Uncertainty
Value Judgment
Exception
Authority Change
Blast Radius
```

最终：

```text id="s3gb6p"
Human Required?
```

可以：

```text id="d1y7jz"
YES
NO
CONDITIONAL
```

其中：

```text id="f9jdj7"
CONDITIONAL
```

很重要。

因为现实中很多决策不是：

```text id="x2y8vo"
always human
```

而是：

```text id="z7l8j6"
human when:
  amount > threshold
  risk tier = high
  uncertainty > threshold
  exception exists
  customer impact = material
```

---

# 四十七、Agent 不应该自己决定“自己是否可信”

这是一个非常重要的递归问题。

错误：

```text id="5m42b7"
Agent evaluates:
“I am sufficiently confident.”
```

然后：

```text id="4z4c2f"
confidence > threshold
→ no human needed
```

这种做法可以作为模型信号之一。

但：

> Agent Confidence 不能成为 Authorization Boundary 的唯一依据。

应该：

```text id="e0u8w4"
Agent confidence
+
Risk Policy
+
Business impact
+
External controls
```

共同确定 Oversight Level。

---

# 四十八、Human 应该决定“价值”，Agent 应该尽量决定“方法”

一个非常有用的抽象：

```text id="wwywd6"
Human:
What / Why / Whether

Agent:
How
```

例如：

```text id="b6n2a2"
Human:
是否接受这个风险？

Agent:
有哪些方案？
每种方案会带来什么结果？
```

Human：

```text id="5jsswd"
是否接受这个方案？
```

Agent：

```text id="9s08g9"
如何执行已经批准的方案？
```

当然这不是普遍法律规则，而是一条很实用的架构启发式。

---

# 四十九、Human 也应该定义 Agent 的“不可越过边界”

例如：

```text id="4w2m6c"
Agent Policy:

Allowed:
- read portfolio
- research
- draft proposal
- submit review

Not allowed:
- approve
- change policy
- modify entitlement
- transfer ownership
- submit external trade
```

Human Governance：

```text id="9bdizk"
批准这套 Policy
```

Agent：

```text id="n3j0z1"
在边界内部自主工作
```

这是一种：

> **Human sets authority envelope, Agent operates inside it.**

---

# 五十、这正是 Control Plane 与 Runtime 分离的意义

```text id="k0k8o1"
                 Control Plane
                       │
             ┌─────────┼─────────┐
             │         │         │
          Policy   Authorization  Human
             │         │        Oversight
             │         │         │
             └─────────┼─────────┘
                       │
                Runtime Contract
                       │
                ┌──────▼──────┐
                │ Agent       │
                │ Runtime     │
                │             │
                │ Reason      │
                │ Plan        │
                │ Act         │
                └─────────────┘
```

Runtime 可以：

```text id="pc5jdi"
自主
```

但：

```text id="21i22o"
Control Plane
```

决定：

```text id="svb74v"
自主到什么程度
```

---

# 五十一、一个非常关键的判断：谁能改变 Business State？

这往往比：

> 谁点击 Approval？

更重要。

例如：

```text id="l4gxz0"
Human:
Approve

Agent:
Execute

Domain:
Change Business State
```

最终：

```text id="dp9y6m"
Business State
```

由 Domain System 控制。

因此：

```text id="8sq11w"
Human decision
    ↓
Command authorization
    ↓
Domain mutation
```

而不是：

```text id="82t5pj"
Human approval
    ↓
Agent directly writes database
```

---

# 五十二、Approval 是“人决定”，Command 是“系统执行”

这一点必须坚持。

```text id="18qjnn"
Human
    ↓
Decision
```

不是：

```text id="muu5bi"
Human
    ↓
Database Update
```

而是：

```text id="4d0ik2"
Human Decision
    ↓
Workflow
    ↓
Authorization
    ↓
Command
    ↓
Domain
```

这样 Human 的决定不会绕过系统控制。

---

# 五十三、Agent 可以重新规划，但不能重新定义 Human Decision

例如：

```text id="r53q2m"
Human:
Approved Proposal A
```

Agent 可以：

```text id="u4xw82"
决定先做哪个内部步骤
调用哪些已批准 Tool
怎样处理 retry
```

不能：

```text id="j2x0l4"
把 Proposal A 改成 Proposal B
```

然后：

```text id="5c79xg"
继续认为 Human 已经批准
```

如果核心业务参数变化：

```text id="s1e5uj"
new proposal
```

应该：

```text id="k1x3yd"
re-approval
```

---

# 五十四、Human Decision 也必须有有效期

例如：

```text id="zi1a9c"
Approval at 09:00
```

如果：

```text id="fzf7t5"
execute at 18:00
```

需要考虑：

```text id="6js3l2"
market changed
policy changed
business state changed
risk changed
```

所以：

```text id="cqzq3j"
Approval
    ↓
TTL
    ↓
Re-validation
```

不是永久令牌。

---

# 五十五、Human Override 不是“超级权限”

例如：

```text id="ln5n6f"
Human:
Override Agent recommendation
```

这不应该意味着：

```text id="pr4sy0"
Human can bypass every control.
```

例如：

```text id="zl0a5m"
Compliance restriction
```

即使有 Human Override，也应该：

```text id="8p1l3d"
require appropriate authority
```

所以：

> **Human Authority 仍然受 Organization Policy 约束。**

---

# 五十六、这意味着“Human in the loop”也不是 Security Boundary

一个常见错误：

```text id="q4xg8c"
有人工审批
→ 系统安全
```

并不成立。

如果：

```text id="c8k0ue"
Agent
  ↓
绕过 Approval
  ↓
Tool
  ↓
Execute
```

那么 Human Approval 根本不是 Control。

真正的 Enforcement 仍然应该在：

```text id="f0fwhv"
Gateway
Policy
Authorization
Domain
IAM
```

AWS 当前明确要求 Tool Authorization 在外部 Policy / Gateway 边界执行，而不是依赖 Agent 遵守说明。

---

# 五十七、Human Authority 也必须受到 SoD 约束

例如：

```text id="5o5wgm"
Maker:
Alice

Checker:
Bob
```

不能：

```text id="qz8lck"
Alice = Maker + Checker
```

即使：

```text id="Alice is authorized"
```

也可能违反：

```text id="bfo05b"
Segregation of Duties
```

所以 Human Decision Rule 应结合：

```text id="m5n90i"
Identity
Role
Capability
SoD
Scope
```

而不是：

```text id="8xbj3h"
user.isApprover
```

---

# 五十八、Approval Policy 与 Human Reserved Decision 是两层

这个区别非常值得固定。

```text id="jzxf0i"
Human Reserved Decision
```

决定：

> 是否必须由人。

而：

```text id="pqzk8n"
Approval Policy
```

决定：

> 如果需要人，哪些人、几个、以什么规则决定。

例如：

```text id="3h7sy6"
Decision:
Approve large investment

Human Requirement:
YES

Approval Policy:
2 of 3 Investment Committee members
+ 1 Compliance
+ maker excluded
```

因此：

> **“需要人”与“需要几个人”是两个不同的 Policy 层次。**

---

# 五十九、再进一步：Human Reserved Decision 本身也应该是 Policy

可以定义：

```text id="3d7e13"
Oversight Policy
```

例如：

```text id="5e3r4c"
IF
  action = "SUBMIT_TRADE"
  AND amount > 10M
THEN
  humanDecisionRequired = true
```

或者：

```text id="v8m7hj"
IF
  exception = true
THEN
  humanDecisionRequired = true
```

再：

```text id="7f8hck"
IF
  reversible = true
  AND risk < threshold
THEN
  autonomous = true
```

这是比 Agent Prompt 更可靠的方式。

---

# 六十、Oversight Policy 可以和 Approval Policy 串起来

最终：

```text id="7bcqxx"
Action
   ↓
Oversight Policy
   ↓
AUTONOMOUS
NOTIFY
APPROVAL
HUMAN_DECISION
DUAL_CONTROL
```

如果：

```text id="4wq9kk"
APPROVAL
```

再：

```text id="x2tkrf"
Approval Policy
```

决定：

```text id="d9v5z1"
1 PM
2 of 3
PM + Compliance
```

因此：

```text id="zvvwk9"
Oversight Policy
    ≠
Approval Policy
```

但二者相关。

---

# 六十一、一个完整金融例子：Proxy Voting

Agent 生成：

```text id="xq70p9"
Vote Proposal:
FOR
```

Oversight Policy：

```text id="o4q7c7"
External submission
+
material portfolio
→ Human Decision
```

Workflow 创建：

```text id="5s7x7s"
Human Task
type = APPROVAL
```

Approval Policy：

```text id="4yewbv"
Portfolio Manager:
1 approval
```

Human：

```text id="r9q4ha"
APPROVE
```

随后：

```text id="2ir6kh"
Revalidate:
  Proposal version
  Voting entitlement
  Approval scope
  Policy
```

然后：

```text id="w99f9v"
Command
    ↓
ISS Adapter
```

Agent 可以：

```text id="o5qh58"
准备材料
检查数据
生成 rationale
```

但：

```text id="03uf09"
是否正式提交
```

由：

```text id="2y0lq7"
Human Authority
```

决定。

---

# 六十二、另一个例子：大额付款

假设：

```text id="5w9zre"
Payment = $20M
```

Agent 可以：

```text id="ttd4gx"
verify invoice
match PO
check duplicate
identify beneficiary
calculate payment
```

这些都可以高度自动化。

但：

```text id="5yyft6"
Release Payment
```

可能需要：

```text id="1d3b5p"
two authorized human approvals
```

这是：

```text id="yrm6v1"
Maker-Checker
+
Approval Policy
+
Authorization
```

Agent 不应该：

```text id="08j6xb"
approve payment
```

也不应该：

```text id="8yupb8"
change the approval threshold
```

---

# 六十三、另一个例子：异常合规处理

Agent：

```text id="59zk3d"
发现：
KYC document missing
```

Agent 可以：

```text id="k9l4yi"
识别异常
收集证据
分类风险
准备 exception package
```

但：

```text id="odg0zv"
是否允许业务继续
```

属于：

```text id="7x9t7z"
Compliance Authority
```

因此：

```text id="w0tl2b"
Agent → recommends
Compliance → decides
Policy → enforces
```

---

# 六十四、另一个例子：投资研究

Agent：

```text id="o6p1g0"
Recommendation:
BUY
Confidence:
0.84
```

不能：

```text id="n6e1s9"
0.84 > 0.8
→ automatically invest
```

因为：

```text id="9li5c5"
Model confidence
```

不是：

```text id="q5f5e0"
Investment Authority
```

可以：

```text id="6x67u0"
Agent:
generate recommendation

Human PM:
accept / reject / modify thesis

Policy:
validate mandate

Execution:
submit approved command
```

---

# 六十五、另一个例子：Agent 自己发现“权限不够”

Agent：

```text id="5lyq5j"
Need:
READ_RESTRICTED_RESEARCH
```

正确：

```text id="94frui"
Request Capability
    ↓
Authorization
    ↓
Allow / Deny
```

错误：

```text id="72wf6z"
Agent:
"I need this, so I will use admin role."
```

这里：

> 是否扩大权限，本身就是 Human / Governance / Policy Authority 的决定。

---

# 六十六、“必须由人决定”还包括“是否放宽控制”

例如：

```text id="1fmg2g"
Agent:
当前无法完成任务，
建议暂时关闭 approval requirement。
```

这个建议可以有价值。

但最终：

```text id="pg6rki"
Approval Requirement
```

必须由：

```text id="fe8c4a"
Governance / Authorized Human
```

决定。

否则：

```text id="n2v62q"
Agent encounters constraint
    ↓
Agent removes constraint
    ↓
Agent completes goal
```

整个 Control Plane 就失效了。

---

# 六十七、这其实是 Agent Safety 最重要的一条边界

可以写成：

> **Agent may optimize execution within the permitted boundary; it may not optimize away the boundary itself.**

中文：

> **Agent 可以优化如何完成任务，但不能为了完成任务而自行取消完成任务所需要的控制边界。**

例如：

```text id="x4jnh0"
Task:
submit trade

Boundary:
human approval required
```

Agent 可以：

```text id="5xmxuv"
优化 research
优化 order preparation
优化 timing
```

不能：

```text id="vv2r6y"
为了提高成功率
取消 human approval
```

---

# 六十八、Human Decision 也必须有“不可委托”的边界

例如组织规定：

```text id="6l0t6j"
Compliance Officer
```

必须亲自：

```text id="n8y3pm"
clear regulatory exception
```

那么：

```text id="4xv5m2"
Compliance Agent
```

不能：

```text id="0q6ln0"
代替签字
```

即使：

```text id="compliance-agent"
```

拥有：

```text id="compliance tools"
```

也不等于：

```text id="compliance authority"
```

---

# 六十九、Agent 可以代替“劳动”，不能自动代替“Authority”

这是整篇文章非常适合固定下来的原则：

> **Automation of Work ≠ Delegation of Authority.**

例如：

```text id="z4bb2t"
Human PM
    ↓
需要审阅 1000 页材料
```

Agent 可以：

```text id="paf5k6"
替 PM 搜索
整理
总结
发现异常
生成 review package
```

但：

```text id="r0pp15"
是否批准
```

仍然由有 Authority 的 PM 决定。

---

# 七十、Agent 可以代替重复操作，但不能自动获得组织判断权

因此：

```text id="r5fysb"
Human Work
```

可以被大量自动化。

但：

```text id="yzyj0h"
Human Authority
```

需要显式设计。

这会导致一个更准确的企业 AI 转型目标：

```text id="4v6m1s"
Automate Work
while
Preserving Authority
```

而不是：

```text id="7z1k7y"
Automate Authority
```

---

# 七十一、Decision Boundary 最好成为 Agent Contract 的一部分

例如 Agent Definition：

```yaml id="5c70qk"
agent:
  id: investment-review-agent

autonomy:
  allowed:
    - read_research
    - analyze_proposal
    - generate_review
    - classify_risk

  requires_human:
    - approve_investment
    - accept_material_risk
    - approve_exception

  forbidden:
    - modify_approval_policy
    - grant_permission
    - transfer_business_ownership
```

这样：

```text id="s6q8nf"
Autonomy Boundary
```

成为显式 Contract。

---

# 七十二、但 Contract 本身也不能由 Agent 修改

最终链条：

```text id="u8bqqj"
Agent Definition
   ↓
Approved Configuration
   ↓
Control Plane
   ↓
Agent Runtime
```

Agent Runtime：

```text id="n2y0vq"
reads boundary
```

不能：

```text id="0gxj5x"
writes boundary
```

---

# 七十三、一个重要的 Anti-pattern：Self-Approval

最明显：

```text id="l0i55a"
Agent
  ↓
Proposal
  ↓
Agent evaluates
  ↓
Approve
  ↓
Agent Execute
```

这是：

```text id="q2l7vi"
Maker = Checker = Executor
```

直接违反职责分离。

---

# 七十四、Anti-pattern：Approval Theater

```text id="l01z0n"
Agent
  ↓
Human sees one-line summary
  ↓
Approve
  ↓
Agent executes a changed action
```

这里：

```text id="zj4n2o"
Human Approval
```

实际上没有控制意义。

正确：

```text id="y45m71"
Proposal
+
Scope
+
Evidence
+
Risk
+
Human Decision
+
Authorization
+
Command Binding
```

---

# 七十五、Anti-pattern：Agent decides whether human approval is necessary

```text id="p4o7sk"
Agent:
“This is safe.”
       ↓
skip approval
```

如果 Approval Requirement 本身由 Agent 决定：

> Agent 实际控制了自己的 Safety Boundary。

正确：

```text id="dnvy4v"
Agent risk signal
      ↓
Oversight Policy
      ↓
Human required?
```

---

# 七十六、Anti-pattern：Human approves Agent’s recommendation，而不是批准明确 Proposal

```text id="8m6c6e"
Human:
“I approve.”
```

但：

```text id="rpx8lr"
approve what?
```

不明确。

正确：

```text id="8qdbjv"
Approve:
Proposal #P-1024
Version 7
Action = SUBMIT_PROXY_VOTE
Parameters = ...
```

---

# 七十七、Anti-pattern：Human approval becomes permanent trust

```text id="p1y9b6"
Human approves one trade
    ↓
Agent stores:
“Bob trusts me”
```

错误。

应该：

```text id="czn6f3"
Approval
  → scoped
  → versioned
  → time-bounded
```

AWS 当前明确警告无参数约束的 wildcard / persistent trust 会实际上移除整个操作类别的人类监督。

---

# 七十八、Anti-pattern：Human can approve but cannot stop

如果 Agent 是：

```text id="4k30v0"
long-running
```

Human 应该至少能：

```text id="g8u5i8"
Pause
Stop
Disable
Escalate
```

EU AI Act Article 14 将能够忽略/推翻模型输出以及安全停止系统列入 Human Oversight 能力。

---

# 七十九、什么必须保留给人，可以最终形成一张表

| Decision Type         | Agent 可以做 | Human 是否保留最终 Authority  |
| --------------------- | --------- | ----------------------- |
| 信息检索路径                | 是         | 否                       |
| 摘要、分类                 | 是         | 通常否                     |
| Proposal 生成           | 是         | 否                       |
| 风险初筛                  | 是         | 通常由 Policy / Human 监督   |
| 低风险可逆执行               | 可以        | 通常不需要逐次                 |
| 是否进入审批                | 可以提供信号    | 由 Oversight Policy 决定   |
| 谁具有批准权                | 可以查询      | 不应由 Agent 自己决定          |
| 高影响业务批准               | 可以推荐      | 通常是                     |
| 重大例外                  | 可以准备材料    | 是                       |
| 改变授权                  | 可以申请      | 是 / Governance          |
| 改变 Policy             | 可以建议      | 是 / Governance          |
| 改变 Business Ownership | 可以发起请求    | 是 / Authorized Human    |
| 接受重大不可逆风险             | 可以分析      | 通常是                     |
| 停止异常 Agent            | 可以请求      | Human / Operations 保留能力 |
| Agent 自己扩大权限          | 不允许       | 永远由外部控制                 |

---

# 八十、一个更好的“Must Be Human”判断树

可以直接放进架构设计 Skill：

```text id="4v8m83"
Is this decision regulated as requiring human oversight?
              │
             Yes
              ↓
          HUMAN
              │
             No
              ↓
Does it change organizational authority?
              │
             Yes
              ↓
          HUMAN / GOVERNANCE
              │
             No
              ↓
Does it create a material business commitment?
              │
             Yes
              ↓
      HUMAN AUTHORITY
              │
             No
              ↓
Is it irreversible / high-impact?
              │
             Yes
              ↓
    RISK-TIERED HUMAN
              │
             No
              ↓
Is it ambiguous / value-laden / exceptional?
              │
             Yes
              ↓
        HUMAN JUDGMENT
              │
             No
              ↓
     Agent / Policy may decide
```

这比：

```text id="x7wwy0"
if risk == high:
    human
```

强很多。

---

# 八十一、但最终需要一个“Human Reserved Decision Registry”

对于企业 Agent Platform，建议 Control Plane 中增加：

```text id="f8j2f5"
Human Decision Registry
```

定义：

```text id="2oa8u9"
Decision Type
Risk Tier
Human Required?
Required Role
SoD Requirement
Approval Policy
Scope
Timeout
Escalation
Override
Audit Requirement
```

例如：

```yaml id="j50zsi"
decision:
  type: ACCEPT_MATERIAL_RISK

  humanRequired: true

  requiredRole:
    - RISK_OWNER

  independence:
    mustDifferFromMaker: true

  approval:
    mode: ALL
```

或者：

```yaml id="fht92g"
decision:
  type: SUBMIT_LOW_VALUE_INTERNAL_UPDATE

  humanRequired: false

  oversight: AUTONOMOUS
```

---

# 八十二、这会让 Agent Runtime 极其简单

Agent Runtime 不需要知道：

> “什么事情在企业里应该由人决定？”

只需要：

```text id="w6n6fn"
request action
    ↓
Control Plane
    ↓
Decision Boundary
    ↓
AUTONOMOUS / HUMAN_REQUIRED / DENY
```

这样：

```text id="yqbyj6"
Agent Runtime
```

负责：

```text id="eecj3y"
Reason
Plan
Execute allowed action
```

而：

```text id="k8f7ly"
Control Plane
```

负责：

```text id="m6l0j7"
Authority
Policy
Human Requirement
```

---

# 八十三、Human Reserved Decision Registry 也应该版本化

因为组织政策会变：

```text id="35m8za"
V1:
10M以上人工审批

V2:
5M以上人工审批
```

已有 Workflow 不应该突然改变。

推荐：

```text id="t8wog3"
Decision Policy Version
```

绑定到：

```text id="5thw3w"
Workflow / Approval Instance
```

这样历史行为才能重建。

---

# 八十四、Human Decision 最终也应该进入 Audit Evidence

至少记录：

```text id="v7np40"
Decision Type
Proposal
Scope
Policy Version
Reviewer
Role
Decision
Reason
Timestamp
Previous State
Resulting State
```

而不是：

```text id="5cyi6s"
approved=true
```

FINRA 当前对金融机构 AI Governance 的观察也强调 formal review/approval、持续监控、Human-in-the-loop review、模型版本和 Prompt/Output 等记录，以支持 accountability 和 troubleshooting。

---

# 八十五、Human Decision 不是最终安全边界

即使：

```text id="a16qsp"
Human approved
```

仍然：

```text id="4e2yzl"
Policy
Authorization
Data Entitlement
Domain Validation
Idempotency
```

需要继续工作。

因此：

```text id="v2u6z9"
Human Decision
    +
System Controls
```

共同构成最终控制。

不能：

```text id="3i3z5x"
Human approval
    ↓
bypass all controls
```

---

# 八十六、这也意味着“必须由人决定”与“必须由人执行”不同

非常重要。

例如：

```text id="x3cg9x"
Human:
Approve payment
```

可以：

```text id="2bg99v"
Agent / Service:
execute approved payment command
```

前提：

```text id="5z4u65"
Command scope exactly matches approval
+
Authorization valid
+
Domain validation passes
```

因此：

> **Human Decision ≠ Human Operation**

这才是 Agent 能真正提高效率的地方。

---

# 八十七、Human 决定“是否做”，Agent 可以决定“怎么做”

例如：

```text id="kprl69"
Human:
Approve Proxy Vote = FOR
```

Agent 可以：

```text id="ih2lxa"
选择：
ISS API route
retry strategy
submission timing
technical adapter
```

但不能改变：

```text id="f5h6is"
Vote = FOR
```

或：

```text id="o0ah56"
Security
Quantity
Proposal Scope
```

除非重新获得必要的人类 Decision。

---

# 八十八、这就是“Controlled Execution”

可以：

```text id="fjg2l8"
Human Decision
     ↓
Approved Command Scope
     ↓
Agent chooses execution mechanics
     ↓
Domain
```

这里 Agent 的自主性仍然很强。

但：

```text id="1lx6ev"
Execution Mechanics
```

不能改变：

```text id="b0z3i3"
Business Decision
```

---

# 八十九、对于长时间 Agent，Human Decision 必须考虑“State Drift”

例如：

```text id="89cq3k"
10:00 Human approves
```

到：

```text id="16:00"
```

之间：

```text id="iv1ebs"
business state
authorization
market state
policy
data
```

可能发生变化。

所以：

```text id="xy0k0i"
Human Approved
```

应该：

```text id="mn7i7w"
remain valid?
```

交给 Control Plane 重新判断。

---

# 九十、一个推荐的完整控制链

```text id="q0y2q2"
Agent Reasoning
      ↓
Proposal
      ↓
Oversight Policy
      ↓
Human Required?
      │
      ├── NO → Autonomous path
      │
      └── YES
            ↓
        Human Task
            ↓
        Human Decision
            ↓
        Approval Policy
            ↓
        Scope Validation
            ↓
        Authorization
            ↓
        Domain Validation
            ↓
        Command
            ↓
        Side Effect
            ↓
        Audit
```

这个模型把：

```text id="0bww91"
HITL
Maker-Checker
Approval
Authorization
Command
Business State
Audit
```

全部串起来了。

---

# 九十一、一个非常重要的原则：人不应该决定“事实”

Human Decision 和 Human Input 也需要分开。

例如 Agent：

```text id="w56e2g"
客户余额是多少？
```

应该从：

```text id="qri3yz"
authoritative data source
```

获取。

不要：

```text id="7zv0f1"
让 Human 点击：
“我认为余额是 1M。”
```

因为：

```text id="o8hz7i"
Business Fact
```

不应该变成人的主观判断。

Human 更适合决定：

```text id="5r2d3x"
What should we do with the fact?
```

而不是：

```text id="5e6jdo"
What is the authoritative fact?
```

除非业务本身就是人工输入。

---

# 九十二、这又形成了一个很重要的三分法

```text id="zvt0ma"
Fact
Recommendation
Decision
```

分别由：

```text id="gx4z9e"
System / Domain
Agent
Human / Policy
```

负责。

例如：

```text id="m2e8ir"
Fact:
Portfolio exposure = 12%

Agent:
Recommend reduce exposure

Human:
Approve / Reject
```

这是非常清晰的：

```text id="cslqql"
Truth
Recommendation
Authority
```

分离。

---

# 九十三、Agent 最不应该成为“事实 + 建议 + 决定”的单一来源

错误：

```text id="ja0f3v"
Agent:
Exposure is 12%.
Therefore reduce exposure.
I have approved it.
I executed it.
```

这里：

```text id="14f5em"
Fact
Recommendation
Decision
Execution
```

全部集中到 Agent。

成熟架构应该：

```text id="6e8vv2"
Domain
   ↓
Fact

Agent
   ↓
Recommendation

Human / Policy
   ↓
Decision

Command
   ↓
Execution
```

---

# 九十四、金融 Agent 最适合的基本分工

可以形成一个非常稳定的模型：

```text id="ru7m4o"
Domain
    owns Truth

Agent
    owns Reasoning

Policy
    owns Rules

Human
    owns Reserved Judgment

Authorization
    owns Permission

Workflow
    owns Execution State

Command
    owns Side Effect Boundary

Audit
    owns Evidence
```

这实际上已经成为前面整个文档系列的共同架构语言。

---

# 九十五、最终建议：定义“Human Decision Boundary”，而不是“Human Approval List”

不要建立：

```text id="e5t0vl"
ApprovalRequiredTools:
[
  send_payment,
  submit_trade,
  ...
]
```

因为审批需求不仅取决于 Tool。

同一个 Tool：

```text id="q41yqg"
submit_trade
```

可能：

```text id="m0y2ui"
$100 internal test
```

无需人工。

也可能：

```text id="9n3l4g"
$100M client order
```

需要多重人类控制。

所以 Human Requirement 应基于：

```text id="1ksqgk"
Action
Resource
Parameters
Business Context
Risk
Reversibility
User / Organization
```

而不是：

```text id="0t8jvj"
Tool Name
```

---

# 九十六、一个更好的 Oversight Policy 示例

```yaml id="7ibwaw"
decisionPolicy:
  id: trade-execution-v4

  rules:

    - when:
        action: EXECUTE_TRADE
        amount:
          gt: 10000000

      oversight:
        level: HUMAN_DECISION

        role:
          - PORTFOLIO_MANAGER

        approval:
          required: 1

        independence:
          differentFromMaker: true

    - when:
        action: EXECUTE_TRADE
        amount:
          lte: 100000

        riskTier: LOW

      oversight:
        level: AUTONOMOUS

    - when:
        exception: true

      oversight:
        level: HUMAN_DECISION

        role:
          - RISK_OWNER
```

这个比：

```text
send_trade → requireApproval
```

更接近真实企业系统。

---

# 九十七、最终可以把“Human Required”标准化成五个问题

每一个 Agent Decision 都问：

```text id="kckz80"
1. 这个决定是否受法规/监管的 Human Oversight 要求约束？

2. 这个决定是否改变组织的 Authority Boundary？

3. 这个决定是否代表组织承担重大业务责任？

4. 这个决定是否产生重大、不可逆或高影响后果？

5. 这个决定是否涉及无法由确定性规则解决的重大例外或价值判断？
```

如果任意一个回答是：

```text id="a5l4un"
Yes
```

就应该至少进入：

```text id="3oqi0c"
Human Oversight Design
```

不一定都是：

```text id="Approval Button"
```

可能是：

```text id="1opk6g"
Human Decision
Human Review
Human Confirmation
Human Override
Dual Control
Human-in-command
```

具体方式再由风险和规则决定。

---

# 九十八、最终的五类 Human Reserved Decision

如果要给企业 Agent Platform 建一个最小标准，我建议固定：

```text id="v0l6p4"
H1 — Authority Decisions
    谁能做什么

H2 — Accountability Decisions
    组织是否接受重大责任 / 风险

H3 — Irreversible Decisions
    是否发生重大不可逆动作

H4 — Exception Decisions
    是否允许偏离既有规则

H5 — Value / Ambiguity Decisions
    在规则不能唯一决定时，由谁承担判断
```

这些不是说：

> 永远必须由人亲自点击。

而是：

> **这些 Decision 的最终 Authority 不应该被 Agent 自己吞掉。**

---

# 九十九、最终模型：Human Reserved Authority

```text id="81rj4n"
                     Agent
                       │
                Reason / Plan
                       │
                    Proposal
                       │
               Oversight Policy
                       │
        ┌──────────────┼──────────────┐
        │              │              │
   Autonomous        Human          Denied
        │           Reserved           │
        │            Decision           │
        │                │              │
        │          Human Task          │
        │                │              │
        │          Human Judgment      │
        │                │              │
        └────────────┬───┴──────────────┘
                     │
                 Authorization
                     │
                 Command Scope
                     │
                  Domain
                     │
               Business State
```

这里最核心的是：

```text id="wta2l9"
Agent Autonomy
```

和：

```text id="1d8x6g"
Human Reserved Authority
```

同时存在。

---

# 一百、结论

“AI Agent 参与审批流程时，什么必须由人决定”最终不应该得到一个类似：

```text id="s6s2fq"
这些 Tool 必须人工审批：
- Payment
- Trade
- Delete
...
```

的静态清单。

更合理的是建立：

> **Human Decision Boundary。**

Agent 可以自主：

```text id="5e0d8g"
理解
检索
分析
规划
生成 Proposal
检查一致性
发现异常
选择已授权的执行路径
执行低风险、可逆操作
```

但至少以下五类 Authority 应当被明确保留在人类或组织治理体系中：

```text id="9c0q0j"
1. Authority：
   谁可以决定谁拥有什么权限。

2. Accountability：
   组织是否接受重大业务责任和风险。

3. Irreversible Action：
   是否允许重大、不可逆或高影响动作发生。

4. Exception：
   是否允许偏离正常规则。

5. Human Judgment：
   在规则无法唯一决定、涉及重大价值取舍或需要承担组织责任时，
   谁作最终判断。
```

其中必须特别区分：

> **Human-in-the-loop 不等于每个动作都由人点击 Approval。**

AWS 当前明确建议风险分层，避免所有动作进入人工审批造成 reviewer fatigue；Microsoft 的 Agent Framework 也把 HITL 建模成通用 Request/Response，可以请求批准，也可以请求信息、进行多轮交互和恢复 Workflow。

真正成熟的系统应该是：

```text id="jvbhz5"
Agent
    → 自主处理允许自主处理的事情

Policy
    → 决定哪些事情必须进入 Human Oversight

Human
    → 在 Reserved Decision Boundary 内承担真正的判断和 Authority

Authorization
    → 防止 Agent 或 Human 通过错误路径突破权限边界

Domain
    → 保持 Business Truth 和业务不变量

Command
    → 控制实际 Side Effect

Audit
    → 证明当时谁决定了什么、为什么可以决定
```

最终可以把这个架构原则压缩成一句：

> **Agent 可以自主决定“怎么完成被授权的工作”，但不能自主决定“谁有权决定、是否可以突破控制边界，以及组织是否接受一个重大业务结果”。**

再进一步：

> **Human-in-the-loop 的真正边界不是“哪里出现 Approval Button”，而是“哪些 Decision Authority 不应该被 Agent 自主拥有”。**

---

## 参考资料

**AWS Well-Architected Agentic AI Lens — Human-in-the-loop for critical decisions**
AWS 当前明确反对所有 Agent action 统一人工审核，也反对完全没有人工监督；推荐按风险分层，让高风险操作在执行前进入人工监督，同时要求 reviewer context、timeout、escalation、identity 和 decision audit。

**AWS — Tiered human oversight and approval workflows**
AWS 将 Agent 行为按 Autonomous、Notify、Approve 等层级处理，并以 impact、reversibility 等因素决定监督强度，同时推荐 Policy/Gateway 级别 enforcement，而不是依赖 Agent 自觉。

**Microsoft Agent Framework — Human-in-the-loop**
Microsoft 当前把 HITL 建模为 Workflow Request/Response：Workflow 可以暂停、请求外部响应，然后恢复；Request 不仅可以是 Approval，也可以是自由信息收集和多轮交互。

**Microsoft Agent Framework — Tool Approval**
Microsoft 的 Agent Tool Approval 支持在工具真正执行前暂停 Agent Run，等待用户批准或拒绝；这只是 HITL 的一种形式。

**Anthropic — Trustworthy Agents in Practice**
Anthropic 2026 年关于 Agent Trust 的实践文章强调 Human Control，并在产品层把 Tool 权限区分为 always allow、needs approval、block；同时强调 Agent 的价值来自自主规划、工具使用和根据结果调整，而不是把所有动作都交给人工。

**NIST AI RMF — Human-AI Interaction**
NIST 明确强调 Human roles and responsibilities 在 AI decision-making 与 oversight 中需要清晰区分，并认为 Human-AI 系统可以处于从 fully autonomous 到 fully manual 的连续范围。

**EU AI Act — Article 14 Human Oversight**
EU AI Act 对 High-Risk AI 的 Human Oversight 要求包括理解能力和限制、避免 automation bias、能够忽略/推翻输出以及安全停止；监督措施必须与风险、自治程度和使用环境相称。

**FINRA 2026 Annual Regulatory Oversight Report — GenAI / Agents**
FINRA 2026 年观察专门讨论 Agent 的 autonomy、scope and authority、auditability 等风险，并建议金融机构确定 Human-in-the-loop 的具体位置、跟踪 Agent actions/decisions，并建立 guardrails。

**BIS — Regulation and supervision of the financial sector in the age of AI**
BIS 2026 年强调金融机构必须承担 AI 风险的所有权，AI 工具不能成为风险责任主体；机构需要决定哪些任务由 AI、哪些由人或二者组合完成，并建立适当治理。

**BIS — Winning in the AI era: the new playbook for Indian banks**
BIS 2026 年 9 月强调金融机构决策的责任属于银行本身，而不是模型；对于 AI 错误可能造成重大伤害的场景，需要保留 meaningful human oversight，包括解释、干预和必要时推翻 AI 结果的能力。

**BIS — AI agents for cash management in payment systems**
BIS 2025 年工作论文展示了 Agent 自动完成复杂现金管理任务的潜力，同时明确指出高价值支付系统仍需要监管 safeguards、human oversight 和进一步研究。

---

### 最终与前几篇文档连接起来

这一篇实际上把前面几篇的核心概念串成了一个更完整的控制链：

```text id="7z4s8j"
Agent Autonomy
      ↓
Proposal
      ↓
Oversight Policy
      ↓
Human Decision Boundary
      │
      ├── Autonomous
      ├── Notify
      ├── Human Review
      ├── Human Approval
      └── Human / Dual Control
      ↓
Approval Policy
      ↓
Authorization
      ↓
Command
      ↓
Domain
      ↓
Business State
      ↓
Audit Evidence
```

所以真正值得作为整个金融 Agent 平台顶层原则的是：

> **Agent 可以拥有 Autonomy，但不能自行定义自己的 Authority Boundary；Human 的价值不是替 Agent 点击按钮，而是在组织必须保留的 Decision Boundary 上承担真正的判断、授权和责任。**


# Workflow Version / Skill Version / Policy Version 的审计意义

在传统企业系统里，“版本”经常被理解成发布管理问题：代码有 Git commit，应用有 release version，数据库有 migration version。

但在 Agent + Workflow 的系统里，版本的意义发生了变化。

一次业务操作可能不是由某一段固定代码直接完成，而是由多个可独立变化的控制层共同决定：

* Workflow 决定**流程怎么走、状态如何变化**
* Skill 决定**Agent 在某一步应该如何执行任务**
* Policy 决定**什么事情允许做、什么事情禁止做**
* Model 决定**Agent 实际如何生成推理和行动建议**
* Tool / API 决定**最终执行了什么外部动作**

因此，审计真正需要回答的问题已经不再只是：

> “是谁在什么时候调用了这个 Agent？”

而是：

> **“当这次业务行为发生时，系统究竟运行了哪一个 Workflow、哪一组 Skill、哪一版 Policy？这些版本经过谁批准？当时为什么允许这样做？事后能否重新构建出当时的控制环境？”**

这也是 Workflow Version、Skill Version、Policy Version 在金融服务场景中真正的审计意义。

一个比较准确的抽象是：

```text
                    Business Case
                         │
                         ▼
                ┌─────────────────┐
                │    Workflow     │
                │   version = W7  │
                └────────┬────────┘
                         │
                         ▼
                ┌─────────────────┐
                │      Skill      │
                │   version = S4  │
                └────────┬────────┘
                         │
                         ▼
                ┌─────────────────┐
                │      Policy     │
                │   version = P9  │
                └────────┬────────┘
                         │
                         ▼
                    Tool / API
                         │
                         ▼
                     Business
                      Action
```

真正完整的审计记录，不应该只留下最后的 `Action`，而应该能够反向建立：

```text
Business Action
      │
      ├── Workflow W7
      │      └── approved change CHG-1832
      │
      ├── Skill S4
      │      └── artifact sha256:...
      │
      ├── Policy P9
      │      └── policy decision DEC-82731
      │
      ├── Tool T12
      │
      ├── Model M2026.08
      │
      └── Runtime / Configuration snapshot
```

这实际上是把“Agent execution log”提升成了“business decision evidence”。

---

## 一、先区分三个概念：流程、能力和约束

这三个版本之所以都值得记录，不是因为系统里喜欢多加几个 version 字段，而是因为它们在架构上承担的是不同职责。

| 对象               | 回答的问题                | 典型内容                                                | 审计时需要回答              |
| ---------------- | -------------------- | --------------------------------------------------- | -------------------- |
| Workflow Version | **事情按什么流程发生？**       | 状态、审批、条件、重试、人工介入、分支                                 | 为什么走了这条流程？当时流程规则是什么？ |
| Skill Version    | **Agent 被要求如何完成任务？** | instructions、prompt、脚本、参考资料、工具使用方式                  | Agent 当时依据什么操作方法？    |
| Policy Version   | **什么事情被允许？**         | Authorization、risk rule、limit、segregation of duties | 当时依据什么规则允许/拒绝？       |
| Tool Version     | **实际通过什么接口执行？**      | API schema、adapter、connector                        | 哪个执行能力被调用？           |
| Model Version    | **谁生成了建议/推理？**       | Model/provider/configuration                        | 哪个模型产生了该建议？          |

这几者不能互相替代。

例如一次交易审批可能出现这样的情况：

```text
Workflow W18
  └─ Step: "Compliance Review"

       Skill S7
         └─ "检查交易是否满足制裁筛查流程"

       Policy P23
         └─ "SanctionedParty = true → Deny"

       Tool T4
         └─ Sanctions API

       Model M8
         └─ 用于解释匹配结果
```

如果最后审计日志只有：

```text
decision = approved
user = Alice
timestamp = 2026-09-20 15:32
```

其实仍然缺少几个关键问题的答案。

不知道：

* 当时 Workflow 是否已经改过？
* Skill 是否在当天早上升级？
* Policy 是否在交易发生前刚刚变化？
* Agent 调用的是哪一个 Policy bundle？
* Skill 里的脚本是不是后来已经被替换？
* 当时是否仍然存在一个后来被撤销的授权规则？

所以：

> **Audit Log 记录的是发生了什么；Version Lineage 解释的是为什么当时会发生这些事情。**

---

# 二、为什么“当前版本”不能作为审计证据

这是最容易被低估的问题。

很多系统会记录：

```json
{
  "workflow": "trade-approval",
  "skill": "compliance-review",
  "policy": "approval-policy"
}
```

甚至：

```json
{
  "workflow": "trade-approval@latest",
  "skill": "compliance-review@latest",
  "policy": "approval-policy@latest"
}
```

从运行监控角度可能足够，但从审计角度通常是不够的。

因为 `latest` 是一个**移动指针**，不是历史事实。

假设：

```text
10:00  Workflow W7
11:00  Workflow W8 发布
12:00  某案件执行
13:00  Workflow W9 发布
```

如果日志只写：

```text
workflow = trade-approval
```

那么半年后审计人员看到的是：

```text
trade-approval = W9
```

而案件实际可能使用的是 W8。

这意味着：

> **名称回答“是哪一个对象”，版本回答“当时具体是哪一个状态”。**

AWS Step Functions 对这个问题有非常明确的工程实现：State Machine Version 是不可修改的 snapshot，可以通过 version 或 alias 启动 execution；如果直接使用未限定版本的 ARN，则 execution 并不会自动绑定到某个 version。AWS 还明确区分了 revision、version 和 alias。([AWS Documentation][1])

这背后的架构原则非常重要：

> **审计日志应该保存 immutable execution reference，而不是保存一个之后还可能移动的逻辑名称。**

---

# 三、Workflow Version：证明“业务流程当时是怎么运行的”

Workflow Version 通常是三类版本中最容易被理解的。

传统 BPM / workflow 系统已经存在类似概念：

```text
Workflow
 ├── Version 1
 ├── Version 2
 ├── Version 3
 └── Production → Version 3
```

问题在于，Agent 时代的 Workflow 往往比传统 BPM 更复杂：

```text
Receive Case
      ↓
Risk Classification
      ↓
Agent Analysis
      ↓
Policy Check
      ↓
Human Approval
      ↓
Tool Execution
      ↓
Post-Execution Review
```

任何一处变化都可能改变业务行为。

例如：

```text
W12

Risk Classification
      ↓
Agent Analysis
      ↓
Human Approval
```

改成：

```text
W13

Risk Classification
      ↓
Policy Pre-check
      ↓
Agent Analysis
      ↓
Risk Re-check
      ↓
Human Approval
```

这个变化不是单纯的“代码升级”。

它改变的是：

> **业务控制点发生在哪里。**

这对金融业务尤其重要。

AWS Financial Services Industry Lens 明确把 change management、approved reusable artifacts、version control、configuration drift 作为金融服务云工作负载的重要操作控制，同时对 Agent lifecycle 直接提出 deployment、versioning 和 retirement 的治理要求。([AWS Documentation][2])

因此 Workflow Version 至少应该能够证明：

```text
Workflow Definition
Workflow Version
Deployment Version
Activation Time
Environment
Approved Change
Approver
Test Evidence
Rollback Target
```

而不是只有：

```text
workflow_name
```

---

# 四、Workflow Version 的一个隐藏问题：Version ≠ Deployment

这是架构设计里很值得区分的一点。

例如：

```text
Workflow W12
   │
   ├── Test
   ├── UAT
   └── Production
```

不能简单把：

```text
Workflow Version = W12
```

理解成：

```text
所有环境都运行相同内容
```

更准确的是：

```text
Workflow Definition Version
        │
        ├── Release R123
        │      ├── DEV
        │      ├── UAT
        │      └── PROD
        │
        └── Deployment D987
```

审计需要回答的是：

> **这次 execution 到底运行的是哪个 production artifact？**

AWS Step Functions 的 `revision` / `version` / `alias` 设计正好说明了这种区别：revision 是定义的不可变 snapshot，version 是可以执行的不可变 snapshot，而 alias 是面向部署流量的指针。([AWS Documentation][1])

所以企业 Agent 平台最好不要把以下东西混成一个字段：

```text
workflow_version
```

而可以明确区分：

```text
workflow_definition_version
workflow_release_id
workflow_deployment_id
```

---

# 五、Skill Version：Agent 时代新增的审计问题

Workflow Version 在传统系统中已经比较成熟。

真正新的难题是：

> **Skill 到底是什么？为什么它也需要版本？**

以当前 Agent Skills 生态为例，一个 Skill 不只是一个 prompt，而通常可以包含：

```text
SKILL.md
scripts/
references/
assets/
```

其中 scripts 可以是真正被 Agent 调用的 executable code。Agent Skills 官方规范明确规定了这种目录结构，并允许 skill 携带脚本、参考资料和资源。([GitHub][3])

GitHub 当前的 Copilot Agent Skills 文档也明确把 Skill 定义为 instructions、scripts 和 resources 的组合，并且其安装机制会记录 source、ref、tree SHA 等 provenance 信息，以便检查上游变化。([GitHub Docs][4])

这意味着：

> **Skill 已经不只是“prompt 文本”，而是一个可影响 Agent 行为的 executable capability bundle。**

因此：

```text
Skill v1.2
```

和：

```text
Skill v1.3
```

可能意味着：

```text
v1.2
├── instructions A
├── script X
└── reference R1

v1.3
├── instructions B
├── script Y
└── reference R2
```

Agent 最终产生的行为可能已经发生变化。

---

# 六、为什么 Skill Version 对 Agent 审计尤其重要

传统软件中，如果代码改变了，通常需要重新发布应用。

Agent Skill 则可能在不改变 Agent Runtime 本身的情况下改变行为。

例如：

```text
Agent Runtime
      │
      ├── Skill: compliance-review
      │
      └── Tool: sanctions-search
```

当天上午：

```text
Skill v4
"如果存在弱匹配，交给人工审核"
```

下午：

```text
Skill v5
"如果存在弱匹配，继续收集两个附加字段后再次查询"
```

Runtime 完全没变。

Model 也没变。

Workflow 甚至也没变。

但是业务行为已经发生变化。

如果审计日志没有记录 Skill Version，事后很容易出现：

```text
"当时 Agent 为什么这么做？"

"我们现在看到的 Skill 是这样规定的。"
```

这两句话并不一定矛盾。

问题恰恰是：

> **现在的 Skill 不一定是当时执行的 Skill。**

这也是为什么对 Agent 平台而言，Skill provenance 的价值不只是 software supply-chain provenance，而是**business behavior provenance**。

---

# 七、Skill Version 不应该只保存 SemVer

这是一个非常重要的工程细节。

很多系统会采用：

```text
skill_version = 1.4.2
```

但对于审计而言，最好同时保存：

```text
skill_name
skill_version
artifact_digest
source_repository
source_ref
commit_sha
dependency_lock
```

例如：

```json
{
  "skill": "compliance-review",
  "version": "4.3.1",
  "source_ref": "release/4.3.1",
  "commit_sha": "8e7a...",
  "artifact_sha256": "4d0f..."
}
```

原因很简单：

> **Semantic Version 是人类约定；Content Hash 才是具体内容的指纹。**

特别是 Skill 内部还可能引用：

```text
scripts/
references/
templates/
external packages
```

因此真正需要审计的是整个 artifact，而不是 frontmatter 中的一个字符串。

当前 Agent Skills 规范本身并没有把 `version` 作为必需字段；官方规范允许通过 `metadata` 扩展字段。GitHub 的 Skill 安装工具则进一步使用 source/ref/tree SHA 进行 provenance tracking。由此可以看出，Skill versioning 目前仍处在快速演化阶段，不能把某一个 Agent Skills 生态的版本字段直接当作统一监管标准。([GitHub][3])

所以企业内部应该定义自己的审计规范，而不能假设：

```text
SKILL.md 有 version
```

就已经足够。

---

# 八、Policy Version：三类版本中最接近“控制证据”的一个

Workflow 决定流程。

Skill 决定 Agent 怎么做。

Policy 决定：

> **允许不允许做。**

因此 Policy Version 与其他版本相比，有一个特殊意义：

> **它往往直接决定一次 Action 是否被授权。**

例如：

```text
Policy P17

TradeAmount > $10m
        ↓
Requires Senior Approval
```

后来变成：

```text
Policy P18

TradeAmount > $5m
        ↓
Requires Senior Approval
```

同一个 Workflow：

```text
W12
```

同一个 Skill：

```text
S7
```

也可能得到不同结果。

因此如果审计日志只记录：

```text
workflow = W12
skill = S7
decision = approved
```

依然无法回答：

> **“为什么这个金额在当时是允许的？”**

必须能够找到：

```text
Policy P18
Policy Input
Decision DEC-8821
Result = allow
```

---

# 九、Policy Version 已经存在非常成熟的工程实践

这方面 Policy-as-Code 的实践非常直接。

Open Policy Agent 的 Decision Log 会记录：

* decision ID
* trace ID
* policy path
* input
* result
* bundle revision
* timestamp

其中 `bundle revision` 就是产生该 decision 时所使用的 policy bundle revision。([Open Policy Agent][5])

OPA 的 Bundle 机制还允许对 policy bundle 使用 revision、metadata 和签名，并在加载新 bundle 后记录 active revision。([Open Policy Agent][6])

这其实已经非常接近金融企业所需要的审计模型：

```text
Policy Decision
      │
      ├── decision_id
      ├── policy_bundle
      ├── policy_revision
      ├── input
      ├── result
      └── timestamp
```

AWS IAM 也采用 Policy Version 的方式管理 managed policy，并允许设置 default version；每个 Policy Version 有独立的 version ID 和创建时间。([AWS Documentation][7])

Azure Policy 同样已经提供 policy definition version，并用 major/minor/patch 表达不同级别的规则变化。([Microsoft Learn][8])

因此：

> **Policy Version 并不是 Agent 时代才产生的新想法，而是成熟的 Policy-as-Code 与 cloud governance 已经长期使用的控制模式。**

Agent 系统真正新增的问题，是必须把它与 Workflow 和 Skill 的版本链连接起来。

---

# 十、金融监管真正要求的是什么？

需要避免一个常见误解：

> “金融监管明确要求 Workflow Version、Skill Version、Policy Version 三个字段。”

目前不能这样表述。

更准确的说法是：

> **金融监管越来越强调可追踪的变更、审批、测试、实施和运行记录；Workflow/Skill/Policy 的不可变版本，是满足这种可追溯性的一个重要工程实现方式。**

例如 DORA Article 9 要求金融实体建立 ICT change management，并确保 ICT 系统的变化被：

* recorded
* tested
* assessed
* approved
* implemented
* verified

而且是在受控方式下完成。([EUR-Lex][9])

AWS Financial Services Industry Lens 对金融机构也明确提出：

* change management
* approved reusable artifacts
* version control
* configuration drift prevention
* agent deployment/versioning/retirement

等实践。([AWS Documentation][2])

更贴近交易系统的是 ESMA 关于算法交易的材料：其讨论明确提出，投资公司应在系统、算法或策略发生变化时记录变化，以形成 audit trail，并强调更新后的系统应继续经过适当测试。([ESMA][10])

因此真正的监管逻辑可以概括成：

```text
Change
  ↓
Recorded
  ↓
Tested
  ↓
Approved
  ↓
Implemented
  ↓
Verified
  ↓
Auditable Execution
```

Version 是把这条链真正连接到某一次 execution 的关键技术索引。

---

# 十一、一个现实中的金融案例：版本追踪为什么不是“锦上添花”

2012 年 Knight Capital 的交易系统因为软件安装问题，在市场开盘后产生大量错误订单，最终造成约 4.4 亿美元的税前损失。Knight 的公开文件明确把事件与 trading software installation 联系起来。([Securities and Exchange Commission][11])

这个案例不能被简单解释成：

> “如果当时有 versioning 就不会发生事故。”

公开证据并不足以支持这种因果结论。

但它非常适合说明另外一个问题：

> **对金融交易系统而言，软件变更本身就是业务风险事件。**

因此审计需要的不只是：

```text
"系统发生了故障"
```

而应该逐步回答：

```text
Which build?
Which deployment?
Which change?
Who approved?
Which test?
Which configuration?
What was active before?
What was active after?
```

类似地，2020 年 Citi/Revlon 事件中，Citi 公开披露约 8.94 亿美元被错误支付，并将 human error、第三方供应商以及贷款处理系统限制列为主要因素；随后 Citi 增加控制并升级相关基础设施。([Securities and Exchange Commission][12])

这个案例同样不能证明某种特定 versioning 架构能够防止错误。

但它说明一个金融系统的审计问题不仅是：

```text
Who clicked?
```

还包括：

```text
What system behavior was active?
What controls were supposed to prevent it?
Which controls were active?
What changed?
```

这正是 Workflow / Skill / Policy 的版本信息开始具有审计价值的地方。

---

# 十二、最重要的区别：Change Log ≠ Execution Evidence

很多企业已经有：

```text
Change Management System
```

因此会认为：

> “所有 change 都有 ticket，已经可以审计。”

实际上还差一步。

假设：

```text
CHG-1001
   ↓
Deploy Workflow W18

CHG-1002
   ↓
Deploy Workflow W19
```

然后：

```text
Case #12345
```

发生在两个 change 中间。

审计系统必须能够回答：

```text
Case #12345
    ↓
Workflow W18
    ↓
Skill S7
    ↓
Policy P22
```

而不能让审计人员自己根据：

```text
时间 + deployment log + Git history + CI/CD logs
```

拼出答案。

因此应该建立双向关系：

```text
Change → Version

Version → Executions
```

最终形成：

```text
Change
  │
  ▼
Version
  │
  ▼
Deployment
  │
  ▼
Execution
  │
  ▼
Decision / Action
```

这比单独保存一堆日志具有更高的取证价值。

---

# 十三、真正应该审计的是“Version Set”，而不是三个孤立 Version

这是 Agent 平台设计里最值得落地的一点。

不要把一次 execution 设计成：

```json
{
  "workflow_version": "7",
  "skill_version": "4",
  "policy_version": "9"
}
```

然后认为审计已经完成。

更准确的模型应该是：

```text
Execution Context
│
├── Workflow
│   ├── Definition Version
│   ├── Release
│   └── Deployment
│
├── Skills
│   ├── Skill A
│   ├── Skill B
│   └── Skill C
│
├── Policies
│   ├── Policy A
│   ├── Policy B
│   └── Policy C
│
├── Model
│
├── Tool Definitions
│
├── Runtime Configuration
│
└── Data / Authorization Context
```

也就是说，真正的审计对象应该是：

> **Execution Version Set**

例如：

```json
{
  "execution_id": "EX-2026-0009812",

  "workflow": {
    "id": "trade-approval",
    "version": "18",
    "artifact_sha256": "..."
  },

  "skills": [
    {
      "id": "compliance-review",
      "version": "7.2.1",
      "artifact_sha256": "..."
    }
  ],

  "policies": [
    {
      "id": "trade-approval-policy",
      "version": "23",
      "bundle_revision": "9c2e..."
    }
  ],

  "model": {
    "provider": "xxx",
    "model": "xxx"
  },

  "tools": [
    {
      "id": "trade-order-api",
      "version": "4"
    }
  ],

  "authorization": {
    "decision_id": "DEC-8821"
  }
}
```

这比单纯的 application log 更接近真正的 regulatory evidence。

---

# 十四、为什么 Policy Version 还不够：Policy Input 也必须考虑

这是金融场景下另一个容易遗漏的问题。

假设 Policy：

```text
Policy P9

If:
  client_risk = high
  amount > 10m

Then:
  require senior approval
```

Policy Version 是：

```text
P9
```

但：

```text
client_risk
```

本身也可能来自变化的数据。

因此：

```text
Policy Version
        +
Policy Input
        ↓
Policy Decision
```

才是完整证据。

OPA 的 Decision Log 就把 policy revision、query、input、result 一起记录，这种设计非常有代表性。([Open Policy Agent][5])

因此金融 Agent 平台不能把审计模型简化成：

```text
Policy P9 → Allow
```

而应该是：

```text
Policy P9
   +
Input Snapshot
   +
Decision ID
   ↓
Allow
```

否则六个月以后，即便找到了完全相同的 Policy，也可能找不到当时做出该决定所使用的输入数据。

---

# 十五、为什么 Skill Version 也存在类似问题

Skill：

```text
S7
```

可能依赖：

```text
reference documents
configuration
scripts
external package
tool schema
```

因此：

```text
Skill Version
```

实际上也可能需要扩展为：

```text
Skill Artifact
    │
    ├── Instructions
    ├── Scripts
    ├── References
    ├── Assets
    └── Dependencies
```

所以建议保存：

```text
skill_version
artifact_digest
dependency_lock
source_commit
```

这与软件供应链的思想是一致的。

而 GitHub 当前的 Skill 安装机制已经把 source/ref/tree SHA 作为 provenance 信息进行记录，说明这个问题并非纯理论。([GitHub Docs][4])

---

# 十六、Agent 平台最容易犯的一个错误：把 LangSmith Trace 当作 Audit Evidence

Observability 和 Audit 是两个不同问题。

例如 LangSmith / OpenTelemetry / application logging 可以记录：

```text
Agent started
Tool called
LLM called
Tool returned
Agent finished
```

这解决的是：

> **Runtime Observability**

但监管审计可能需要：

```text
Which workflow version?
Which skill artifact?
Which policy revision?
Who approved the change?
Which authorization rule allowed it?
Which business case did it belong to?
Which human approval occurred?
```

这属于：

> **Regulatory / Business Audit Evidence**

二者应该连接，但不能认为前者自动等于后者。

一种比较合理的结构是：

```text
                    Business Audit Layer
                            │
                ┌───────────┴───────────┐
                │                       │
          Business Case            Control Evidence
                │                       │
                └───────────┬───────────┘
                            │
                       Execution ID
                            │
                 ┌──────────┼──────────┐
                 ▼          ▼          ▼
             Workflow     Skill      Policy
                │           │          │
                └───────────┼──────────┘
                            ▼
                     Runtime Trace
                            │
                            ▼
                        Tool / API
```

也就是说：

> **Trace 是证据链的一部分，而不是证据链本身。**

---

# 十七、Version 应该不可变，而不是“可以修改的记录”

如果：

```text
Policy P9
```

后来可以直接编辑内容：

```text
P9 → new content
```

那么：

```text
Audit Log:
policy = P9
```

就会失去历史意义。

正确方式应该是：

```text
P9 = immutable
P10 = new version
```

同样：

```text
Skill S7 = immutable
Skill S8 = modified
```

Workflow：

```text
W18 = immutable
W19 = modified
```

这也是为什么成熟平台把 Version 定义为 immutable snapshot，而不是数据库中的“当前行”。AWS Step Functions 对 state machine version 的定义就是不可修改的 snapshot；OPA bundle 也通过 revision 区分具体 policy 内容状态。([AWS Documentation][13])

---

# 十八、Version Number 和 Hash 应该同时存在

一个实际企业系统可以采用：

```text
Human-readable ID
+
Immutable content identifier
```

例如：

```text
Workflow
  version = 18
  sha256 = abc123...

Skill
  version = 7.2
  sha256 = def456...

Policy
  version = 23
  revision = ghi789...
```

原因是：

```text
version
```

方便人：

```text
"这次运行用的是 Policy 23"
```

而：

```text
hash / revision
```

方便机器确认：

```text
"Policy 23 的具体内容就是这个 artifact"
```

两者不是竞争关系。

---

# 十九、Version 还必须关联“谁批准了它”

另外一个常见误区是：

> “只要保存版本号，就可以审计。”

不够。

因为：

```text
Policy P23
```

只说明：

```text
What
```

不说明：

```text
Who approved it?
Why was it approved?
When was it approved?
Which test evidence?
Which risk assessment?
```

因此完整的控制链应该是：

```text
Artifact
    │
    ▼
Version
    │
    ▼
Change Request
    │
    ├── Risk Assessment
    ├── Test Evidence
    ├── Approval
    └── Deployment
          │
          ▼
       Execution
```

这与 DORA 所强调的 recorded / tested / assessed / approved / implemented / verified 的顺序是一致的。([EUR-Lex][9])

---

# 二十、三类 Version 应该采用不同的变更策略

并不是所有 version 都应该用同一种发布流程。

### Workflow Version

通常属于：

> **Business Process Change**

例如：

* 增加审批节点
* 修改状态转换
* 修改 SLA
* 修改 escalation
* 修改 human-in-the-loop 条件

这类变化通常需要业务 owner / operations / risk 等参与。

---

### Skill Version

通常属于：

> **Agent Behavior Change**

例如：

* 修改 instructions
* 增加 reasoning rules
* 修改 tool-selection guidance
* 修改脚本
* 修改 reference material

它可能不改变 Workflow，但会改变 Agent 行为。

所以 Skill 发布最好至少触发：

```text
Behavior Test
Security Test
Tool Permission Test
Regression Test
```

---

### Policy Version

通常属于：

> **Control Boundary Change**

例如：

```text
limit:
10m → 5m
```

或：

```text
approval required:
Manager → Director
```

它改变的是：

> **系统允许什么。**

因此 Policy 的发布控制通常应该比普通 Skill change 更严格。

这不是说所有 Skill 都低风险，而是三者承担的风险类型不同。

---

# 二十一、一个适用于金融 Agent 平台的 Version Matrix

| 变化                    | Workflow | Skill | Policy | 典型控制                       |
| --------------------- | -------: | ----: | -----: | -------------------------- |
| 增加审批节点                |        ✓ |       |        | Business approval          |
| 修改状态机                 |        ✓ |       |        | Workflow test              |
| 修改 Agent instructions |          |     ✓ |        | Behavioral regression      |
| 修改 Agent script       |          |     ✓ |        | Security + code review     |
| 修改允许交易额度              |          |       |      ✓ | Risk / Compliance approval |
| 修改权限规则                |          |       |      ✓ | Security approval          |
| 修改模型                  |          |       |        | Model governance           |
| 修改 Tool schema        |       可能 |    可能 |        | Integration test           |
| 修改 data entitlement   |          |       | ✓/独立控制 | Access review              |

因此不应该建立一个：

```text
generic "Agent Version"
```

然后把所有东西混在一起。

更合理的是：

```text
Workflow Version
Skill Version
Policy Version
Model Version
Tool Version
Authorization Version
```

最后形成一个：

```text
Execution Context
```

---

# 二十二、真正的审计目标：可重建，而不是可查看

两者差异非常大。

### 可查看

系统能够告诉你：

```text
15:31 Agent called Tool X
15:32 Tool X returned Y
15:33 Agent approved
```

这是 observability。

### 可重建

系统能够告诉你：

```text
Execution EX-8291
├── Workflow W18
├── Skill S7
├── Policy P23
├── Policy decision DEC-8821
├── Model M8
├── Tool T4
├── Authorization context A91
├── Change request CHG-1832
└── Approval APR-882
```

并且：

```text
W18
S7
P23
```

都能重新取回当时的 immutable artifacts。

这才是真正有取证价值的审计。

因此可以把成熟度划成：

```text
Level 0
只有 application logs

Level 1
有 execution ID

Level 2
Execution ↔ Workflow Version

Level 3
Execution ↔ Workflow + Skill + Policy Version

Level 4
Version ↔ Change ↔ Approval ↔ Deployment

Level 5
完整 Execution Context 可重建
```

这里的 Level 不是监管评级，而是架构能力模型。

---

# 二十三、一个推荐的 Audit Evidence Schema

对于金融 Agent 平台，可以考虑把 execution evidence 做成独立于 LangSmith trace 的领域对象：

```json
{
  "execution_id": "EX-2026-0009812",

  "business_case": {
    "case_id": "CASE-8821",
    "business_function": "trade-approval"
  },

  "workflow": {
    "definition_id": "trade-approval",
    "version": "18",
    "release_id": "REL-2026-091",
    "artifact_sha256": "..."
  },

  "skills": [
    {
      "id": "compliance-review",
      "version": "7.2.1",
      "artifact_sha256": "...",
      "source_commit": "..."
    }
  ],

  "policies": [
    {
      "id": "trade-limit-policy",
      "version": "23",
      "revision": "...",
      "decision_id": "DEC-8821"
    }
  ],

  "model": {
    "provider": "...",
    "model": "...",
    "configuration_hash": "..."
  },

  "authorization": {
    "principal": "...",
    "entitlement_snapshot": "...",
    "decision": "allow"
  },

  "change_control": [
    {
      "change_id": "CHG-1832",
      "approved_by": ["..."],
      "approved_at": "..."
    }
  ],

  "runtime": {
    "environment": "production",
    "deployment_id": "DEP-8271"
  },

  "timestamps": {
    "started_at": "...",
    "completed_at": "..."
  }
}
```

这里最重要的设计不是字段数量，而是：

> **所有影响业务行为的可变 artifact，都应该能够被 execution 引用到一个不可变版本。**

---

# 二十四、不要把“版本”设计成一个字符串问题

最终需要治理的其实是三个关系。

## 1. Artifact → Version

```text
Policy P23
      ↓
Immutable Artifact
```

## 2. Version → Approval

```text
P23
 ↓
CHG-1832
 ↓
Approved
```

## 3. Execution → Version

```text
Execution EX-8291
      ↓
P23
```

三者缺一不可。

否则会出现：

```text
有版本，没有审批
```

或者：

```text
有审批，但不知道哪个 execution 使用了它
```

或者：

```text
execution 有版本号，但版本内容后来被覆盖
```

这些情况下，所谓 versioning 只是 metadata，并没有形成审计证据。

---

# 二十五、Version 治理的另一个意义：Incident Response

Version 不只是为了审计人员。

它还直接影响 incident response。

假设发现：

```text
Skill S8
```

存在安全问题。

如果执行记录精确绑定：

```text
S8
```

那么可以立即查询：

```text
Which executions used S8?
Which business cases?
Which users?
Which actions?
```

再进一步：

```text
Policy P14
```

发现配置错误，也可以查询：

```text
Which decisions were evaluated under P14?
```

OPA 的 decision logs、bundle revision 和 decision ID 正是这种可回溯结构的典型实现。([Open Policy Agent][5])

所以：

> **Version 是 Audit Index，同时也是 Incident Impact Index。**

---

# 二十六、对 Agent 平台而言，“Version”最终应该升级成“Provenance”

真正成熟的模型可能不是：

```text
Workflow Version
Skill Version
Policy Version
```

而是：

```text
Execution Provenance
```

即：

```text
Who
When
What
Why
Under Which Version
Under Which Policy
Using Which Skill
Using Which Model
Using Which Data
With Which Authorization
Approved By Whom
Deployed From Where
```

换句话说：

```text
                    Provenance
                        │
        ┌───────────────┼────────────────┐
        │               │                │
     Process         Behavior          Control
        │               │                │
   Workflow          Skill            Policy
        │               │                │
        └───────────────┼────────────────┘
                        │
                    Execution
                        │
                     Action
```

这比简单增加三个 version 字段更接近金融企业真正需要的控制模型。

---

# 二十七、最终架构原则

综合 AWS Financial Services Industry Lens、DORA、ESMA 的算法交易控制要求，以及 AWS Step Functions、OPA、AWS IAM 和当前 Agent Skills 生态的工程实践，可以形成几个比较稳妥的架构原则。

### 原则一：任何影响业务行为的 Artifact，都必须可版本化

不仅包括代码：

```text
Workflow
Skill
Policy
Prompt
Model configuration
Tool definition
Authorization configuration
```

---

### 原则二：生产 Execution 必须绑定不可变版本

不要只记录：

```text
workflow = trade-approval
```

至少应该记录：

```text
workflow_version
artifact_digest
```

---

### 原则三：不要把 `latest`、`current`、alias 当作最终审计证据

它们可以用于 deployment routing。

审计记录应该保存：

```text
resolved immutable version
```

AWS Step Functions 对 alias 和具体 version 的区分就是一个直接参考。([AWS Documentation][14])

---

### 原则四：Skill Version 必须覆盖整个 Skill Artifact

不仅是：

```text
SKILL.md
```

还应考虑：

```text
scripts
references
assets
dependencies
```

当前 Agent Skills 规范允许 Skill 包含这些资源，而 GitHub 的 Skill tooling 也已经使用 source/ref/tree SHA 记录 provenance。([GitHub][3])

---

### 原则五：Policy Version 必须与 Policy Decision 和 Input 关联

不要只记录：

```text
policy = P23
```

而应该：

```text
policy revision
+
decision id
+
relevant input/context
+
result
```

OPA 的 decision log 模型可以作为直接参考。([Open Policy Agent][5])

---

### 原则六：Version 必须能够追溯到 Change 和 Approval

形成：

```text
Artifact
   ↓
Version
   ↓
Change
   ↓
Approval
   ↓
Deployment
   ↓
Execution
```

这与 DORA 对 ICT change management 的 recorded / tested / assessed / approved / implemented / verified 要求相吻合。([EUR-Lex][9])

---

### 原则七：Audit Record 和 Observability Trace 分离

可以把 LangSmith / OpenTelemetry 等作为 runtime evidence，但应另建：

```text
Business Audit Evidence
```

二者通过：

```text
execution_id
trace_id
decision_id
```

关联。

---

### 原则八：最终目标不是“保存日志”，而是“能够重建当时的控制环境”

最终希望做到：

```text
Case #12345
      ↓
Execution EX-9821
      ↓
Workflow W18
      ↓
Skill S7
      ↓
Policy P23
      ↓
Authorization A91
      ↓
Model M8
      ↓
Tool T4
      ↓
Business Action
```

并且每一个 artifact 都能够找到：

```text
版本
内容
发布时间
审批
测试
部署
使用范围
```

这样，审计人员面对的问题才真正从：

> “系统当时为什么这么做？”

变成：

> “这是当时的 Workflow、Skill、Policy 和 Authorization Evidence；下面是它们对应的批准、测试、部署和 execution 记录。”

---

# 结论

Workflow Version、Skill Version、Policy Version 表面看起来只是三个 metadata 字段，实际上分别对应三种不同的企业控制边界：

```text
Workflow Version
    = Process Control

Skill Version
    = Agent Behavior Control

Policy Version
    = Authorization / Risk Control
```

三者合起来，才能解释一次 Agent 行为的完整来源：

```text
Workflow
决定“怎么走”

Skill
决定“Agent 怎么做”

Policy
决定“允许不允许做”
```

而金融服务系统真正需要的审计能力，是把一次最终 Action 反向连接到这三个控制层，并进一步连接到：

```text
Change
Approval
Deployment
Execution
Decision
Evidence
```

因此，值得在企业 Agent 平台里建立的并不是简单的：

```text
workflow_version
skill_version
policy_version
```

而是一套更完整的：

> **Execution Provenance / Version Lineage**

其核心原则可以压缩成一句话：

> **任何能够改变 Agent 业务行为、控制边界或流程状态的 Artifact，都必须拥有可追溯、不可变、可重新取回的版本身份；每一次生产执行都必须保存当时实际使用的 Version Set，而不是依赖今天的“current”状态。**

这也是为什么在 Agent 平台里，Versioning 最终不是 CI/CD 的附属能力，而是 **Governance、Audit、Incident Response 和 Regulatory Evidence 的共同基础设施**。

---

# 参考资料

1. **AWS — Financial Services Industry Lens: Operational Excellence**
   涉及金融机构的变更管理、Agent governance、Agent versioning、retirement、monitoring 等。([AWS Documentation][2])
   [AWS Financial Services Industry Lens — Operational Excellence](https://docs.aws.amazon.com/wellarchitected/latest/financial-services-industry-lens/operational-excellence.html?utm_source=chatgpt.com)

2. **AWS — Financial Services Industry Lens: Change Management / Configuration Drift**
   涉及 approved artifacts、change management、version control、configuration drift 和审计记录。([AWS Documentation][15])
   [AWS Financial Services Industry Lens — FSIOPS4](https://docs.aws.amazon.com/wellarchitected/latest/financial-services-industry-lens/fsiops4.html?utm_source=chatgpt.com)

3. **AWS Step Functions — Versions and Aliases**
   明确定义 immutable state machine version、revision、alias，以及 execution 如何绑定 version。([AWS Documentation][1])
   [AWS Step Functions — Manage continuous deployments with versions and aliases](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-cd-aliasing-versioning.html?utm_source=chatgpt.com)

4. **EU — Digital Operational Resilience Act (DORA), Regulation (EU) 2022/2554**
   Article 9 要求 ICT 变化被记录、测试、评估、批准、实施和验证。([EUR-Lex][9])
   [EUR-Lex — Regulation (EU) 2022/2554](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32022R2554&utm_source=chatgpt.com)

5. **ESMA — MiFID II / MiFIR Discussion Paper**
   涉及算法交易系统变更、测试和建立 change audit trail。([ESMA][10])
   [ESMA — MiFID II/MiFIR Discussion Paper](https://www.esma.europa.eu/sites/default/files/library/2015/11/2014-548_discussion_paper_mifid-mifir.pdf?utm_source=chatgpt.com)

6. **Open Policy Agent — Decision Logs**
   直接记录 decision ID、policy bundle revision、input、result、timestamp，是 Policy Version 与 Decision Evidence 关联的典型实现。([Open Policy Agent][5])
   [OPA — Decision Logs](https://www.openpolicyagent.org/docs/management-decision-logs?utm_source=chatgpt.com)

7. **Open Policy Agent — Bundles**
   涉及 bundle revision、metadata、签名、版本激活等机制。([Open Policy Agent][6])
   [OPA — Bundles](https://www.openpolicyagent.org/docs/management-bundles?utm_source=chatgpt.com)

8. **AWS IAM — Versioning IAM Policies**
   Managed policy 的 immutable version、default version、rollback 和 version ID。([AWS Documentation][7])
   [AWS IAM — Versioning IAM policies](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_managed-versioning.html?utm_source=chatgpt.com)

9. **GitHub — Adding agent skills for GitHub Copilot**
   涉及 Skill 的 instructions/scripts/resources，以及 source、ref、tree SHA provenance。([GitHub Docs][4])
   [GitHub Docs — Adding agent skills for GitHub Copilot](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/add-skills?utm_source=chatgpt.com)

10. **Agent Skills — Specification**
    定义 SKILL.md、scripts、references、assets 等 Skill artifact 结构；当前标准允许通过 metadata 扩展版本字段，但并未把 version 设为强制字段。([GitHub][3])
    [Agent Skills Specification](https://github.com/agentskills/agentskills/blob/main/docs/specification.mdx?utm_source=chatgpt.com)

11. **SEC — Knight Capital 2012 Technology Incident**
    Knight 披露软件安装问题导致错误交易，并造成约 4.4 亿美元税前损失，是金融系统软件变更风险的典型历史案例。([Securities and Exchange Commission][11])
    [SEC — Knight Capital August 1, 2012 Technology Issue](https://www.sec.gov/Archives/edgar/data/1060749/000119312512332176/d391111dex991.htm?utm_source=chatgpt.com)

12. **SEC Filing — Citi / Revlon Erroneous Payment**
    Citi 披露 2020 年约 8.94 亿美元错误支付，并将 human error、第三方供应商和系统限制列为主要因素。([Securities and Exchange Commission][12])
    [SEC Filing — Citi Operational Risk / Erroneous Revlon-Related Payment](https://www.sec.gov/Archives/edgar/data/831001/000083100120000110/c-20200930.htm?utm_source=chatgpt.com)

[1]: https://docs.aws.amazon.com/step-functions/latest/dg/concepts-cd-aliasing-versioning.html "Manage continuous deployments with versions and aliases in Step Functions - AWS Step Functions"
[2]: https://docs.aws.amazon.com/wellarchitected/latest/financial-services-industry-lens/operational-excellence.html "Operational excellence - Financial Services Industry Lens"
[3]: https://github.com/agentskills/agentskills/blob/main/docs/specification.mdx "agentskills/docs/specification.mdx at main · agentskills/agentskills · GitHub"
[4]: https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/add-skills?utm_source=chatgpt.com "Adding agent skills for GitHub Copilot - GitHub Docs"
[5]: https://www.openpolicyagent.org/docs/management-decision-logs "Decision Logs | Open Policy Agent"
[6]: https://www.openpolicyagent.org/docs/management-bundles?utm_source=chatgpt.com "Bundles | Open Policy Agent"
[7]: https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_managed-versioning.html?utm_source=chatgpt.com "Versioning IAM policies - AWS Identity and Access Management"
[8]: https://learn.microsoft.com/en-us/cli/azure/policy/definition/version?view=azure-cli-latest&utm_source=chatgpt.com "az policy definition version | Microsoft Learn"
[9]: https://eur-lex.europa.eu/legal-content/EN/TXT/?qid=1706204622385&uri=CELEX%3A32022R2554 "Regulation - 2022/2554 - EN - DORA - EUR-Lex"
[10]: https://www.esma.europa.eu/sites/default/files/library/2015/11/2014-548_discussion_paper_mifid-mifir.pdf "Discussion Paper MiFID II/MiFIR"
[11]: https://www.sec.gov/Archives/edgar/data/1060749/000119312512332176/d391111dex991.htm?utm_source=chatgpt.com "Press Release of Knight Capital Group, Inc. issued on August 2, 2012"
[12]: https://www.sec.gov/Archives/edgar/data/831001/000083100120000110/c-20200930.htm?utm_source=chatgpt.com "c-20200930"
[13]: https://docs.aws.amazon.com/step-functions/latest/dg/concepts-state-machine-version.html?utm_source=chatgpt.com "State machine versions in Step Functions workflows - AWS Step Functions"
[14]: https://docs.aws.amazon.com/step-functions/latest/dg/execution-alias-version-associate.html "How Step Functions associates executions with a version or alias - AWS Step Functions"
[15]: https://docs.aws.amazon.com/wellarchitected/latest/financial-services-industry-lens/fsiops4.html "FSIOPS4: How do you assess your ability to operate a workload in the cloud? - Financial Services Industry Lens"

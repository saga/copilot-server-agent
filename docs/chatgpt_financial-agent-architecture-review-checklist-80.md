# 金融服务领域 AI Agent Architecture Review Checklist：80 个高价值问题

> **定位**：一份用于金融服务领域 AI Agent 设计评审、生产前评审和重大变更复审的风险优先 Checklist。目标不是审尽所有技术细节，而是在有限时间内尽可能早地发现结构性、高影响、难补救的问题。

> **版本**：2026-09

> **方法**：以 AWS Well-Architected Agentic AI Lens 为主要架构骨架，结合 OWASP Agentic Applications、CSA Agent Control Plane、NIST AI RMF，以及 FINMA/FSB 的金融风险治理要求；Evaluation 参考 Microsoft Agent Framework、LangSmith、Promptfoo 等当前工程实践。

> **重要说明**：这不是监管机构规定的“合规清单”，也不是某一家厂商的产品要求。它是一份风险优先的工程 Review 方法。具体监管义务仍需按业务、法人实体、地区、产品和适用规则判断。


## 1. 如何使用这份 Checklist


### 1.1 四种状态

每道题只使用：

- **PASS**：已有设计与可验证实现证据。
- **PARTIAL**：设计存在，但实现、覆盖范围或测试证据不足。
- **FAIL**：存在明确风险，或关键控制依赖模型自己遵守。
- **N/A**：明确不适用，并写明理由。

不要把下面这些回答当作 PASS 的证据：

> “Prompt 已经写了。”  
> “模型应该不会这么做。”  
> “Vendor 应该负责。”  
> “以后会加。”  
> “Demo 没发现问题。”

### 1.2 P0 / P1 / P2

- **P0 — Blocker**：原则上不能直接进入生产；如果业务决定接受风险，应有明确的 Risk Acceptance、Owner、期限和补偿控制。
- **P1 — Major**：生产前应解决，或有明确补偿控制。
- **P2 — Standard**：重要工程改进项，可进入持续改善 Backlog。

### 1.3 Review 的基本证据要求

每一个 PASS 至少要能对应一种 Evidence：

| 类型 | 例子 |
|---|---|
| D — Design | Architecture Diagram、ADR、Responsibility Matrix |
| C — Configuration | IAM、Policy、Tool Registry、Prompt/Skill Version |
| T — Test | Unit、Integration、Agent Eval、Security Test |
| R — Runtime | Trace、Metric、Production Evidence |
| G — Governance | Owner、Approval、Risk Acceptance、Review Record |

**Review 的基本原则：没有证据，不判 PASS。**


## 2. 先看 20 个红线问题


如果正式评审只有 30～60 分钟，先检查下面这些。它们不是新的“21～40”问题，而是从 80 项中抽出的快速 Gate。

1. Agent 的业务目标是否明确？
2. Agent 是否能够直接改变 Business State？
3. 最大业务损失是什么？
4. autonomy level 是否明确？
5. LLM 是否可能成为 Authorization Boundary？
6. Agent 是否能够绕过 Business API/Domain Service？
7. 关键业务规则是否依赖 Prompt？
8. 每类关键事实的 System of Record 是什么？
9. Retrieval 是否做 Data Entitlement？
10. 实际 Model Version 是否可追溯？
11. Prompt/Skill/Tool/Policy 是否版本化？
12. Tool Authorization 是否在 Agent 外部确定性执行？
13. Tool 是否默认 deny / allowlist？
14. Agent Identity 和 User Identity 是否区分且可传播？
15. Data Entitlement 与 Action Authorization 是否分离？
16. 哪些动作属于 High-risk？
17. High-risk Action 是否存在 Command / Business Action Boundary？
18. Execution 前是否重新做 Policy + State validation？
19. 关键结果是否有 Ground Truth / deterministic acceptance criteria？
20. Production Execution 是否能重建“谁、用了什么、访问了什么、批准了什么、执行了什么”？

**任意一个以下条件通常都应该直接升级为 P0：**

- LLM 本身充当授权边界；
- Agent 可直接写核心业务数据库；
- 高风险操作没有独立 Policy/Approval；
- Data Entitlement 可被 Agent reasoning 绕过；
- 关键金融计算完全依赖 LLM；
- 没有可验证的关键结果标准；
- 无法在事后重建关键业务动作；
- 无法快速停止高风险 Agent/Tool/Command。


## 3. 80 问完整 Checklist


# A. 业务目标、风险边界与 Agent 适用性

先判断为什么需要 Agent、允许它承担多大自主性，以及最坏情况下会造成什么业务后果。这里的问题优先级通常高于框架选型。


## A01 · P0 · 是否明确 Agent 要解决的具体业务问题，而不是笼统定义为“AI 助手”？


**为什么问**

避免从技术出发反推业务问题。没有明确任务边界，就无法定义成功标准、风险边界和测试集。


**检查要点 / 需要什么证据**

检查 Business Case、Use Case Definition、输入/输出说明；确认有明确用户、任务、业务结果和“不负责什么”。


**建议 / 参考方向**

把 Agent 定义成一个可验证的业务能力，例如“生成投资研究摘要并引用权威数据”，而不是“帮助投研人员提高效率”。


**主要参考**：AWS-1; AWS-2; NIST-1


## A02 · P0 · 是否明确 Agent 的输出只是信息/建议，还是可以直接导致 Business State 改变？


**为什么问**

建议、决策支持和执行行为的风险等级完全不同。把三者混在同一 Agent 中通常会造成控制边界模糊。


**检查要点 / 需要什么证据**

检查架构图是否明确 Proposal / Decision / Command / Business State；列出所有可能发生的 side effect。


**建议 / 参考方向**

采用清晰边界：Agent 可理解、分析、提出方案；业务系统负责规则和状态；高风险动作经过独立 Command/Policy/Approval。


**主要参考**：AWS-2; CSA-1


## A03 · P0 · 是否明确 Agent 最大可能造成的业务损失？


**为什么问**

只有定义“最坏情况”，才能决定权限、人工审核、验证强度和 kill switch。


**检查要点 / 需要什么证据**

要求列出 Top 5 failure scenarios，以及客户、资金、交易、数据、合规、声誉影响。


**建议 / 参考方向**

采用 risk-tiering；对不可逆、金额大、客户敏感、监管相关操作设置更高控制等级。


**主要参考**：FINMA-1; FSB-1


## A04 · P0 · 是否明确 Agent autonomy level，以及不同等级对应什么控制？


**为什么问**

“Agent”不是一个固定风险等级。只读研究、建议、半自动执行、无人值守自动执行需要不同控制。


**检查要点 / 需要什么证据**

检查是否定义 observe-only / assistive / supervised / autonomous 等等级，并明确允许的工具和 side effects。


**建议 / 参考方向**

把 autonomy level 写进 Agent Manifest / Review Record，并与 Tool、Policy、Approval 要求绑定。


**主要参考**：AWS-2; AWS-3


## A05 · P1 · 是否定义 Agent 明确不负责的事项？


**为什么问**

很多重大事故来自责任边界，而不是模型精度本身。


**检查要点 / 需要什么证据**

检查是否有 out-of-scope 清单，例如不作最终投资建议、不决定权限、不直接修改核心数据库。


**建议 / 参考方向**

把禁止事项写成系统约束和 API 权限，而不只写在 Prompt 中。


**主要参考**：AWS-1; NIST-1


## A06 · P1 · 是否定义可度量的业务成功标准？


**为什么问**

“回答好”“用户觉得不错”不能作为生产验收标准。


**检查要点 / 需要什么证据**

至少定义 task completion、correctness、groundedness、escalation、business outcome 等指标中的适用项。


**建议 / 参考方向**

为每个关键 Use Case 建立 acceptance criteria，并进入 Evaluation Dataset。


**主要参考**：AWS-2; Microsoft-1; LangSmith-1


## A07 · P1 · 是否定义什么时候必须拒答、停止或升级给人？


**为什么问**

可靠 Agent 不应该被设计成“必须回答/必须完成”。缺乏证据或出现高风险条件时，安全失败通常优于猜测。


**检查要点 / 需要什么证据**

检查无权访问、数据冲突、证据不足、工具失败、高风险动作、超过限额等条件。


**建议 / 参考方向**

建立明确的 abstain / escalate path，并将其纳入 Eval。


**主要参考**：NIST-1; Microsoft-2


## A08 · P1 · 是否确认 Agent 是解决该问题的合适架构，而不是普通 API、规则引擎、Search 或 Workflow 更合适？


**为什么问**

Agent 的不确定性和运营复杂度不是免费获得的。若任务本身高度确定，应优先使用确定性组件。


**检查要点 / 需要什么证据**

要求写出 Buy/Build 与 Agent/non-Agent comparison；说明为什么需要动态 reasoning 或 tool selection。


**建议 / 参考方向**

保持“能确定性解决就不要用 LLM”的原则，把 Agent 用在真正需要自然语言理解、动态规划、非结构化信息处理的部分。


**主要参考**：AWS-1; NIST-1


# B. 职责分离与整体架构边界

目标是防止出现一个“大而全 Agent”，让 LLM、Runtime、Workflow、Policy、Business API、Data System 各自承担清晰职责。


## B01 · P0 · 是否明确 LLM、Agent Runtime、Workflow、Policy、Business API、Data System 各自负责什么？


**为什么问**

职责不清时，后续所有安全、审计和故障处理都会变得模糊。


**检查要点 / 需要什么证据**

检查 Context/Component Diagram 和责任矩阵；每个组件必须有清晰的 authority boundary。


**建议 / 参考方向**

建议使用 RACI/Responsibility Matrix，明确谁负责 reasoning、orchestration、authorization、state mutation、audit。


**主要参考**：AWS-1; CSA-1


## B02 · P0 · LLM 是否可能成为 Authorization Boundary？


**为什么问**

Prompt、Chain-of-thought 或模型判断不应成为企业权限边界。模型输出必须被视为不可信输入。


**检查要点 / 需要什么证据**

检查所有身份、权限、数据访问和动作授权路径，确认是否存在“模型自己判断可以访问/可以执行”的路径。


**建议 / 参考方向**

Authorization 放在模型外部，由 IAM/Policy/Entitlement/Business Service 强制执行。


**主要参考**：AWS-4; OWASP-1


## B03 · P0 · Agent 是否可以绕过 Business Service 直接修改核心 Business State？


**为什么问**

直接写数据库或绕过领域服务，会绕过业务不变量、审批和审计。


**检查要点 / 需要什么证据**

检查 Tool、MCP、SQL、HTTP、Admin API 是否能直接 mutate 核心业务数据。


**建议 / 参考方向**

核心状态只能通过受控 Domain/Business API；高风险动作再经过 Command/Approval。


**主要参考**：AWS-4; CSA-1


## B04 · P0 · 业务规则是否存在于确定性的业务服务/规则层，而不是主要依赖 Prompt？


**为什么问**

Prompt 可以解释行为，但不能独立保证 invariant、limit、eligibility 和 state transition。


**检查要点 / 需要什么证据**

挑选 3~5 个关键规则，要求指出具体代码、规则引擎或服务位置，而不是 Prompt 文本。


**建议 / 参考方向**

把关键业务规则移到 deterministic service/rule engine，Agent 只负责理解、调用和解释。


**主要参考**：AWS-4; FINMA-1


## B05 · P1 · 是否明确 Skill、Workflow、Tool、Command 和 Business Logic 的边界？


**为什么问**

把这些概念混用会导致重复权限、状态散落和不可测试。


**检查要点 / 需要什么证据**

要求每个职责都有定义，并给出至少一个实际例子。


**建议 / 参考方向**

Skill 负责 agent-facing capability；Workflow 负责业务流程状态；Tool 暴露能力；Command 表达业务动作；Business Service 维护业务不变量。


**主要参考**：AWS-1; CSA-1


## B06 · P1 · 是否避免把每个 Task 都设计成独立 Autonomous Agent？


**为什么问**

无必要的多 Agent 会增加状态、通信、handoff 和故障面。


**检查要点 / 需要什么证据**

统计真正需要独立 autonomy 的节点数量，检查是否只是“为了 AI 而 AI”。


**建议 / 参考方向**

优先单 Agent + deterministic orchestration；只有职责、权限、生命周期确实不同才拆 Agent。


**主要参考**：AWS-1; AWS-5


## B07 · P1 · 是否避免一个 Agent 同时承担研究、审批、执行、审计等互相冲突的职责？


**为什么问**

同一个主体既提议又批准又执行，会削弱 segregation of duties。


**检查要点 / 需要什么证据**

检查 role、tool set、policy 和 approval path 是否允许 self-approval 或绕过 maker-checker。


**建议 / 参考方向**

将 proposal、approval、execution 分离；高风险金融场景保持独立责任主体。


**主要参考**：AWS-3; FINMA-1


## B08 · P2 · 是否可以替换 Model/Runtime/Skill，而不改变 Business Authorization Boundary？


**为什么问**

如果换模型就需要重写权限逻辑，说明 AI 层和控制层耦合过深。


**检查要点 / 需要什么证据**

做一次 hypothetical model/provider replacement review，确认权限和 business rules 仍由外部系统控制。


**建议 / 参考方向**

将 AI 作为可替换决策组件，不让它定义企业安全边界。


**主要参考**：AWS-1; CSA-1


# C. 数据、知识、检索与 Grounding

核心问题是：Agent 得出的事实到底应该相信什么。RAG、Memory 和模型知识都不是自动的 System of Record。


## C01 · P0 · 是否明确每类关键事实的 System of Record / Authoritative Source？


**为什么问**

没有权威数据源，就无法证明结果是否正确。


**检查要点 / 需要什么证据**

对客户、持仓、订单、风险、政策等关键实体建立 Source of Truth Matrix。


**建议 / 参考方向**

按业务对象定义 authoritative source、freshness SLA 和 fallback source。


**主要参考**：FINMA-1; FSB-1


## C02 · P0 · Agent 是否可能用 Memory、LLM 知识或普通 RAG 内容替代 Business System of Record？


**为什么问**

生成模型可能产生过时或错误事实；Memory 更不应成为核心业务状态的最终来源。


**检查要点 / 需要什么证据**

检查关键业务结论的 source；追踪是否存在“只从 memory/context 推断当前状态”的路径。


**建议 / 参考方向**

Business State 由业务系统持有；Agent Memory 只保存辅助上下文，不成为最终事实来源。


**主要参考**：AWS-6; FINMA-1


## C03 · P0 · Retrieval 是否受到 Data Entitlement / Document-Level / Row-Level Authorization 控制？


**为什么问**

RAG 可能成为绕过传统应用权限的新路径。


**检查要点 / 需要什么证据**

验证检索前是否根据 user/agent identity 做 entitlement；测试越权文档、跨客户、跨租户案例。


**建议 / 参考方向**

在 retrieval/data gateway 层做 deterministic entitlement，不能依赖 Prompt 让模型自行过滤。


**主要参考**：AWS-4; OWASP-1


## C04 · P1 · 是否记录关键回答实际使用过哪些数据源、文档版本和时间点？


**为什么问**

只有 query 没有 evidence，很难解释为什么得出结论。


**检查要点 / 需要什么证据**

检查 trace 中是否包含 source ID、version、timestamp、access decision。


**建议 / 参考方向**

对高价值结果保存 Evidence Set 或 Evidence Hash，并能回查原始对象。


**主要参考**：AWS-7; NIST-1


## C05 · P1 · 是否定义数据 freshness 要求？


**为什么问**

金融业务对数据时间点高度敏感；昨天的数据和今天的数据可能得出不同结论。


**检查要点 / 需要什么证据**

逐类数据标记 real-time / intraday / EOD / T+1 等 freshness class，并在执行前检查。


**建议 / 参考方向**

将 freshness requirement 作为业务规则，不满足时进入 stale-data path。


**主要参考**：FINMA-1; FSB-1


## C06 · P1 · 多个数据源冲突时是否有明确 precedence / reconciliation policy？


**为什么问**

Agent 直接“自己判断哪个更可信”会把关键业务规则交给模型。


**检查要点 / 需要什么证据**

构造冲突数据场景，检查系统是否知道该停、该选哪个源或需要人工。


**建议 / 参考方向**

定义 source hierarchy、reconciliation rule 和 conflict escalation。


**主要参考**：FINMA-1; NIST-1


## C07 · P1 · 是否检测 Agent 使用过期、空缺或不完整的数据？


**为什么问**

很多错误不是 hallucination，而是输入不完整。


**检查要点 / 需要什么证据**

测试 empty result、partial result、stale document、missing field，并检查是否仍然生成确定性结论。


**建议 / 参考方向**

在 data/retrieval layer 返回 completeness/freshness metadata，关键任务不满足时阻止继续。


**主要参考**：NIST-1; AWS-7


## C08 · P2 · 重要结论是否能够追溯 Claim → Evidence → Source？


**为什么问**

citation 有不代表 citation 真正证明 claim。


**检查要点 / 需要什么证据**

抽样 20 个关键回答，逐条核对 claim 是否被引用证据实际支持。


**建议 / 参考方向**

对高风险回答采用 claim-level evidence，而不是只提供文档列表。


**主要参考**：NIST-2; AWS-7


# D. Model、Prompt、Skill 与 Behavior Lifecycle

Agent 的有效行为不仅由代码决定。Model、Prompt、Skill、Tool Catalog、Policy 和 Runtime 任何变化都可能造成 Behavior Drift。


## D01 · P0 · 生产执行是否能准确知道实际使用的 Model Version，而不是只有一个可变 Alias？


**为什么问**

Provider alias 或自动升级可能导致代码不变而行为变化。


**检查要点 / 需要什么证据**

检查 production trace / manifest 中是否记录 provider、model、snapshot/version。


**建议 / 参考方向**

生产环境对关键 Agent 使用 pinned model/version；允许自动升级时必须有重新评估和回滚。


**主要参考**：AWS-1; AWS-8


## D02 · P0 · System Prompt、Skill、Tool Description、Policy 是否都有版本？


**为什么问**

这些都是行为输入，应当像代码一样进入 change management。


**检查要点 / 需要什么证据**

检查是否有 immutable version/commit、owner、review、release state。


**建议 / 参考方向**

建立 Behavior Manifest，汇总 code/model/prompt/skill/tool/policy/runtime version。


**主要参考**：AWS-1


## D03 · P1 · 是否能重建一次 Execution 的完整 Effective Behavior Snapshot？


**为什么问**

只有 Git commit 无法解释模型、Prompt 或数据变化。


**检查要点 / 需要什么证据**

验证是否能从一个 execution 找到实际版本及关键 runtime configuration。


**建议 / 参考方向**

保存 behaviorFingerprint 或等价 manifest hash，并与 Execution ID 关联。


**主要参考**：AWS-1; AWS-7


## D04 · P1 · Model/Prompt/Skill/Tool/Policy 的变化是否都会进入相应测试流程？


**为什么问**

“不是代码改动所以不用测”是典型 Agent release 风险。


**检查要点 / 需要什么证据**

抽查一次 prompt/tool/model 变更记录，确认是否自动触发 eval/security review。


**建议 / 参考方向**

把行为资产纳入 CI/CD：change → eval → approval → staged rollout → rollback。


**主要参考**：AWS-1; LangSmith-1


## D05 · P1 · 是否有 Model/Prompt/Skill 的 rollback 机制？


**为什么问**

模型升级失败后，不能依赖手工临时修复。


**检查要点 / 需要什么证据**

检查 rollback artifact、前一稳定版本和回滚条件。


**建议 / 参考方向**

维护 last-known-good release，并允许独立回滚 prompt/model/tool catalog。


**主要参考**：AWS-6


## D06 · P1 · 是否有固定 Evaluation Dataset 比较行为变化前后？


**为什么问**

没有 baseline 就无法判断 release 是改进还是回归。


**检查要点 / 需要什么证据**

至少保存代表性真实案例、历史失败案例和高风险案例。


**建议 / 参考方向**

将 dataset 本身版本化；每次关键行为变化运行 regression/backtest。


**主要参考**：LangSmith-1; Microsoft-1


## D07 · P2 · 是否监测生产 Behavior Drift？


**为什么问**

Agent 可能在 code unchanged 状态下由于模型、数据、tool 或用户分布变化而发生行为变化。


**检查要点 / 需要什么证据**

监测 tool selection、escalation、abstention、trajectory length、policy denial、business outcome。


**建议 / 参考方向**

建立 baseline + anomaly thresholds；异常先 quarantine/slow rollout，再调查。


**主要参考**：AWS-6; LangSmith-1


## D08 · P2 · 是否能区分 Software Version 与 Effective Behavior Version？


**为什么问**

这是 Agent 与传统应用最重要的差异之一。


**检查要点 / 需要什么证据**

要求 incident investigation 时能回答“代码没变，但哪个行为输入变了”。


**建议 / 参考方向**

把 behavior manifest/fingerprint 作为一等审计字段。


**主要参考**：AWS-1


# E. Tool、MCP 与外部能力安全

Tool 是 Agent 的能力边界。最常见的高风险设计是给 Agent 过大的工具集合，并让模型自己判断什么可以调用。


## E01 · P0 · 每个 Tool 是否有明确的 capability、data scope 和 action scope？


**为什么问**

Tool 名称和 Prompt 描述不足以构成真正的边界。


**检查要点 / 需要什么证据**

建立 Tool Registry：purpose、owner、input schema、output schema、data classification、allowed agents、side effects。


**建议 / 参考方向**

采用 capability-based design，把 Tool 拆小，并最小化权限。


**主要参考**：AWS-4; OWASP-1


## E02 · P0 · 每次 Tool Invocation 是否经过 Agent 外部、确定性的 Authorization？


**为什么问**

模型判断不能替代 gateway/API 层的授权。


**检查要点 / 需要什么证据**

检查 sensitive tool 调用前是否存在 policy decision，并记录 allow/deny。


**建议 / 参考方向**

在 Tool Gateway / API Gateway / Policy Service 层强制授权，并传播 user context。


**主要参考**：AWS-4


## E03 · P0 · 是否默认 deny，而不是给 Agent blanket tool access？


**为什么问**

工具越多，blast radius 越大。


**检查要点 / 需要什么证据**

检查 agent tool manifest 是否是 allowlist；是否存在 '*'、全 MCP server 或全 API 权限。


**建议 / 参考方向**

按 Agent / Session / User / Task scope 最小化 tool set。


**主要参考**：AWS-4; OWASP-1


## E04 · P0 · Tool 参数是否同时经过 schema validation 和 business validation？


**为什么问**

合法 JSON 不代表业务上合法；例如金额、客户 ID、交易方向仍可能错误。


**检查要点 / 需要什么证据**

对高风险 Tool 测试类型、范围、权限、resource ownership、state/version。


**建议 / 参考方向**

Schema validation + Authorization + Domain validation 分层执行。


**主要参考**：AWS-4; Microsoft-2


## E05 · P1 · Tool 返回值是否经过必要的 sanitization / normalization？


**为什么问**

Tool output 可能包含 prompt injection、内部错误栈、内部地址或敏感元数据。


**检查要点 / 需要什么证据**

模拟恶意文档、异常 API、数据库错误、内部 schema 暴露。


**建议 / 参考方向**

Tool adapter 负责 response contract、字段过滤和错误归一化，不把 raw downstream error 直接给 LLM。


**主要参考**：AWS-4; OWASP-1


## E06 · P1 · MCP Server / Tool 是否有 owner、version、security review 和 review expiry？


**为什么问**

没有 owner 的 Tool 很快会成为长期存在的未知攻击面。


**检查要点 / 需要什么证据**

检查 registry 是否有版本固定、数据分类、审查时间和废止流程。


**建议 / 参考方向**

建立 Tool/MCP Registry；默认未注册或 review expired 的能力不可用于生产。


**主要参考**：AWS-4; OWASP-1


## E07 · P1 · 是否有 Tool Call 次数、并发、金额、资源范围等 blast-radius limit？


**为什么问**

即使单次调用合法，循环调用也可能造成批量副作用。


**检查要点 / 需要什么证据**

测试 runaway loop、多次 mutation、bulk data extraction。


**建议 / 参考方向**

引入 per-session/per-tool rate limit、budget、max steps、max mutation count。


**主要参考**：AWS-4; OWASP-1


## E08 · P2 · 是否监控 Tool Usage baseline 和异常调用模式？


**为什么问**

正常 Agent 通常具有相对稳定的工具分布；异常工具链可能意味着 prompt injection 或 drift。


**检查要点 / 需要什么证据**

建立每个 Agent 的 expected tool set、频次和 sequence baseline。


**建议 / 参考方向**

对异常 Tool Chain、敏感工具突增、禁止工具尝试建立告警或阻断。


**主要参考**：AWS-6; Promptfoo-1


# F. Identity、Data Entitlement 与 Action Authorization

金融 Agent 最重要的安全边界通常不是模型，而是“谁是谁、能看到什么、能做什么”。


## F01 · P0 · 是否有明确的 Agent Identity？


**为什么问**

Agent 不是匿名模型调用。需要知道是谁在调用工具、访问资源和执行任务。


**检查要点 / 需要什么证据**

检查 service identity / workload identity / agent identity，以及密钥生命周期。


**建议 / 参考方向**

每个生产 Agent 使用可识别、可轮换、最小权限的身份。


**主要参考**：AWS-5


## F02 · P0 · Human/User Identity 是否在 Agent → Tool → Business API 链路传播？


**为什么问**

只有 Agent service account 而没有 user context，会导致下游无法做用户级授权。


**检查要点 / 需要什么证据**

做一个“用户 A 请求 Agent 读取用户 B 数据”的 negative test。


**建议 / 参考方向**

采用 delegated identity / identity propagation；下游继续执行 user-level entitlement。


**主要参考**：AWS-5


## F03 · P0 · Agent 是否无法通过 Prompt、Memory、Tool 参数变化扩大自己的权限？


**为什么问**

权限必须由外部系统决定，而不是由模型选择。


**检查要点 / 需要什么证据**

测试“ignore policy / pretend admin / use another tool / change user_id”等攻击。


**建议 / 参考方向**

将 authorization 放在不可由模型修改的 policy layer，并 fail closed。


**主要参考**：AWS-4; OWASP-1; Promptfoo-1


## F04 · P0 · Data Entitlement 是否独立于 Agent reasoning？


**为什么问**

Agent 可以理解“我需要这个数据”，但不能因此获得数据权限。


**检查要点 / 需要什么证据**

检查 retrieval、search、SQL、file、MCP 等多条数据路径。


**建议 / 参考方向**

Data Entitlement 在 Data Gateway / Business API / DB policy 层 enforce。


**主要参考**：AWS-5; FINMA-1


## F05 · P0 · Action Authorization 是否独立于 Data Entitlement？


**为什么问**

“可以读客户数据”不等于“可以修改客户订单”。


**检查要点 / 需要什么证据**

检查 read/write/approve/execute 是否使用同一权限概念。


**建议 / 参考方向**

至少分成 Identity、Data Entitlement、Action Authorization 三层。


**主要参考**：AWS-4; CSA-1


## F06 · P1 · 是否实施 least privilege，并按 Agent/Session/User/Tool 收敛权限？


**为什么问**

Agent 默认权限越大，越难控制意外路径。


**检查要点 / 需要什么证据**

检查 API scopes、IAM roles、database roles 和 tool scopes。


**建议 / 参考方向**

按最小能力授予；定期清理未使用权限。


**主要参考**：AWS-5


## F07 · P1 · 是否避免无法区分不同用户的 shared credential？


**为什么问**

共享凭证会破坏追责和用户级 authorization。


**检查要点 / 需要什么证据**

检查 downstream audit log 是否能知道真实 requester。


**建议 / 参考方向**

Agent credential 负责工作负载身份，user identity 负责发起者；两者同时记录。


**主要参考**：AWS-5


## F08 · P1 · 是否测试 cross-path privilege escalation？


**为什么问**

很多越权不是单个 API 的问题，而是多个合法工具组合形成的路径。


**检查要点 / 需要什么证据**

测试 search→SQL→file、read→export→email、MCP A→MCP B 等组合。


**建议 / 参考方向**

安全测试必须是 multi-step / trajectory-based，而不是只测单个 endpoint。


**主要参考**：OWASP-1; Promptfoo-1


# G. 高风险动作、Command、Approval 与业务执行

这里决定 Agent 是否从“会分析”变成“能够改变企业状态”。金融领域建议把高风险业务动作建立成明确的 Command 边界。


## G01 · P0 · 是否明确哪些操作属于 High-risk、Irreversible 或 Material Business Action？


**为什么问**

没有 risk classification，就无法决定是否需要 Policy、Approval 或人工复核。


**检查要点 / 需要什么证据**

列出交易、投票、付款、客户沟通、权限变更等动作，并定义 risk tier。


**建议 / 参考方向**

建立 action risk taxonomy；risk tier 决定 authorization、approval、verification 强度。


**主要参考**：AWS-4; FINMA-1


## G02 · P0 · 高风险操作是否通过独立的 Command / Business Action Boundary，而不是普通 Tool Call 直接执行？


**为什么问**

普通 Tool Call 容易把 LLM output 与最终 side effect 直接绑定。


**检查要点 / 需要什么证据**

检查是否存在 Command/Action object、registry、policy 和 executor。


**建议 / 参考方向**

Agent 只能提出 CommandIntent；服务端决定是否允许、审批和执行。


**主要参考**：AWS-4; CSA-1


## G03 · P0 · Command 是否包含完整的业务语义，而不是只有一个 Tool Name + arguments？


**为什么问**

执行动作需要明确目标、参数、发起者、理由、风险分类和约束。


**检查要点 / 需要什么证据**

检查 command schema 是否包含 commandType、target、parameters、requester、reason 等必要字段。


**建议 / 参考方向**

Command 是稳定的业务意图对象，不能由 Prompt 文本隐式表达。


**主要参考**：CSA-1; CQRS/DDD实践


## G04 · P0 · 执行前是否重新执行 Authorization / Policy Check？


**为什么问**

批准前后权限或业务状态可能发生变化；不能永久信任 Agent 最初的判断。


**检查要点 / 需要什么证据**

故意改变权限/政策，再恢复一个待执行 Command，验证系统是否重新校验。


**建议 / 参考方向**

Execution boundary 重新做 authorization、policy 和 state checks。


**主要参考**：AWS-4; AWS-5


## G05 · P0 · Approval 是否绑定到具体 Command，而不是模糊的 Workflow 或 Agent Session？


**为什么问**

“批准这个流程”不等于“批准所有可能动作”。


**检查要点 / 需要什么证据**

检查 approval payload 是否包含目标、参数、风险信息和版本/hash。


**建议 / 参考方向**

将 approval decision 与 immutable/hashed Command 绑定。


**主要参考**：AWS-4


## G06 · P0 · Approval 后执行前，业务状态变化是否会触发 re-validation？


**为什么问**

价格、余额、持仓、客户权限、订单状态都可能在等待审批期间变化。


**检查要点 / 需要什么证据**

对待审批状态制造 concurrent update，并检查是否继续执行旧条件。


**建议 / 参考方向**

使用 resourceVersion / optimistic concurrency / precondition check，必要时让审批重新生成。


**主要参考**：AWS-7


## G07 · P1 · 是否有 idempotency 防止 retry/resume/duplicate request 重复产生副作用？


**为什么问**

Agent workflow 天然存在 retry、resume、timeout 和 duplicate delivery。


**检查要点 / 需要什么证据**

测试 external timeout after side effect，再重试；验证不会重复动作。


**建议 / 参考方向**

使用业务级 idempotency key，并让下游支持幂等；不要把幂等误解成 rollback。


**主要参考**：AWS-7


## G08 · P1 · 是否有 kill switch、command cancellation、quarantine 或 emergency disable？


**为什么问**

出现模型漂移、Provider 问题或大规模异常时，必须能迅速切断副作用。


**检查要点 / 需要什么证据**

检查是否可以 disable agent、tool、command type 或 provider，而不需要重新开发代码。


**建议 / 参考方向**

实现多层 break-glass：Agent disable、Tool disable、Command deny、Provider route disable。


**主要参考**：AWS-3; AWS-6


# H. Workflow、状态、失败与恢复

Agent 的不确定性不能消灭传统 workflow 的确定性要求。金融长流程尤其需要 durable state、checkpoint、可恢复和可重复执行。


## H01 · P0 · Business State 是否仍由 Business System 持有，而不是 Agent Memory？


**为什么问**

Memory 不是事务性业务状态存储，也不应成为订单/审批/持仓等事实来源。


**检查要点 / 需要什么证据**

抽查核心状态对象，追踪真实 owner。


**建议 / 参考方向**

Business System 作为 source of truth；Agent 保存的是上下文和辅助记忆。


**主要参考**：AWS-6; FINMA-1


## H02 · P0 · 长流程是否有 durable state / checkpoint，而不是依赖进程内 state？


**为什么问**

进程重启、扩容、Provider timeout 都会让纯内存状态丢失。


**检查要点 / 需要什么证据**

测试 runtime restart、network failure、worker loss。


**建议 / 参考方向**

将 workflow/execution state 持久化；恢复从 last-known-good checkpoint 开始。


**主要参考**：AWS-7


## H03 · P1 · 能否从 last-known-good state 恢复，而不必从头重跑？


**为什么问**

从头重跑可能重复 Tool Side Effects。


**检查要点 / 需要什么证据**

模拟第 N 步失败并恢复，检查前面 mutation 是否被重复执行。


**建议 / 参考方向**

checkpoint + idempotent step + explicit recovery state。


**主要参考**：AWS-7


## H04 · P1 · 每个可重试步骤是否明确 safe retry 与 side effect？


**为什么问**

Retry 是 Agent 中最常见的隐性重复副作用来源。


**检查要点 / 需要什么证据**

逐个列出 Tool/Command 的 retry semantics。


**建议 / 参考方向**

读操作可重试；写操作必须幂等或有显式 deduplication。


**主要参考**：AWS-7


## H05 · P1 · Timeout、Retry、Fallback、Abort、Escalation 是否有明确策略？


**为什么问**

没有策略时，Agent 可能在异常环境里自行不断尝试。


**检查要点 / 需要什么证据**

对 LLM、Tool、Network、MCP、Data Provider 分别检查。


**建议 / 参考方向**

按 failure class 定义 policy；设置 max attempts、deadline、fallback 和 escalation。


**主要参考**：AWS-7


## H06 · P1 · Multi-agent/Tool/External API 部分失败是否可以隔离？


**为什么问**

一个下游 failure 不应自动造成所有 agent/workflow 状态污染。


**检查要点 / 需要什么证据**

测试单个 Tool、Agent、Provider failure。


**建议 / 参考方向**

采用 bulkhead、timeout、circuit breaker、durable queue 或隔离 execution。


**主要参考**：AWS-7


## H07 · P2 · 是否做过 fault injection / degraded dependency / provider failure 测试？


**为什么问**

系统在 happy path 下可靠不代表生产可恢复。


**检查要点 / 需要什么证据**

至少注入 timeout、5xx、partial result、stale data、empty result、model unavailable。


**建议 / 参考方向**

建立 failure-injection suite，并在 release 前定期运行。


**主要参考**：AWS-7


## H08 · P2 · Memory/Knowledge unavailable 时，Agent 是否有 graceful degradation？


**为什么问**

如果系统拿不到 context 仍然继续推断，容易把“缺数据”误当成“数据不存在”。


**检查要点 / 需要什么证据**

模拟 memory/index/DB unavailable。


**建议 / 参考方向**

进入“无法验证/人工处理/只读 fallback”路径，而不是生成猜测。


**主要参考**：AWS-7; NIST-1


# I. Correctness、Evaluation、Verification 与稳定性

核心原则：不要用“模型很强/回答很像”证明正确。关键结果必须尽可能由外部事实、确定性计算、规则或业务系统验证。


## I01 · P0 · 是否有来自真实业务的 Evaluation Dataset，而不仅是开发者手写的 demo prompts？


**为什么问**

Demo 往往覆盖正常路径，不覆盖真实异常。


**检查要点 / 需要什么证据**

检查 dataset 来源、owner、版本和覆盖范围；确认包含历史失败案例。


**建议 / 参考方向**

至少建立 representative、boundary、failure、high-risk 四类数据集。


**主要参考**：LangSmith-1; Microsoft-1


## I02 · P0 · 关键任务是否有 Ground Truth 或 deterministic acceptance criteria？


**为什么问**

没有可判断的“正确答案”，eval 容易退化成主观评分。


**检查要点 / 需要什么证据**

对每个关键 use case 指出 ground truth 来源或 acceptance assertion。


**建议 / 参考方向**

优先引用真实业务状态、规则、黄金答案、预期 Tool Trajectory。


**主要参考**：AWS-9; LangSmith-1


## I03 · P0 · 关键金融计算是否由 deterministic engine/code/SQL/rules 完成？


**为什么问**

LLM 不应成为关键数值的唯一计算器。


**检查要点 / 需要什么证据**

检查收益、风险、金额、汇率、limit、threshold 等计算路径。


**建议 / 参考方向**

LLM 负责理解和解释；实际计算由代码/SQL/专用风险引擎完成。


**主要参考**：NIST-1; FINMA-1


## I04 · P0 · 关键业务结论是否验证 Claim → Evidence → Rule/Calculation？


**为什么问**

回答有 citation 不代表结论正确。


**检查要点 / 需要什么证据**

抽样验证 claim 是否被 evidence 支持、evidence 是否 authoritative、规则是否适用。


**建议 / 参考方向**

建立 claim-level verification；关键结论记录 evidence ID、rule version、calculation version。


**主要参考**：NIST-2; AWS-7


## I05 · P1 · 是否评估 Tool Selection、Tool Arguments、Tool Output Utilization，而不仅是最终文本？


**为什么问**

Agent 可以最终回答正确，却在中间错误访问了数据或调用了危险 Tool。


**检查要点 / 需要什么证据**

检查 trajectory-level metrics。


**建议 / 参考方向**

将 tool selection/input/output utilization 纳入 regression gate。


**主要参考**：Microsoft-1; Microsoft-2


## I06 · P1 · 是否测试 ambiguous、missing-data、conflicting-data、stale-data、adversarial 场景？


**为什么问**

真实风险往往出现在非 happy path。


**检查要点 / 需要什么证据**

至少包含权限不足、来源冲突、缺字段、旧数据、恶意文档、Prompt Injection 等案例。


**建议 / 参考方向**

将每个生产 incident 自动回流为 regression case。


**主要参考**：Promptfoo-1; LangSmith-1


## I07 · P1 · Model/Prompt/Tool/Policy 变化后是否自动运行 Regression Evaluation？


**为什么问**

行为变化没有 regression gate，生产才是第一批测试。


**检查要点 / 需要什么证据**

检查 CI/CD 是否能根据 changed surface 自动触发相应 dataset。


**建议 / 参考方向**

对关键 Agent 设置 pre-merge/pre-release evaluation threshold 和 rollback criteria。


**主要参考**：AWS-6; LangSmith-1


## I08 · P1 · 是否有明确的 Abstention / Cannot Verify 路径？


**为什么问**

一个 Agent 如果任何时候都必须给出答案，就会被迫猜测。


**检查要点 / 需要什么证据**

测试证据不足、数据冲突、工具不可用等情况。


**建议 / 参考方向**

把 abstention 当作正确 outcome，并根据 use case 定义 expected refusal conditions。


**主要参考**：NIST-1; Microsoft-2


# J. Observability、审计、治理、第三方风险与生产运营

最后一组确保系统不仅“能工作”，还能解释、监控、止损和持续治理。金融场景尤其要区分普通 Trace 与真正的 Audit Evidence。


## J01 · P0 · Production Execution 是否能完整关联 User、Agent、Execution、Model、Prompt、Tool、Policy？


**为什么问**

出了问题必须能重建当时的运行环境。


**检查要点 / 需要什么证据**

从一个 execution ID 开始，验证是否可以关联这些对象。


**建议 / 参考方向**

建立统一 trace/execution identity；保存 Behavior Manifest。


**主要参考**：AWS-1; AWS-6


## J02 · P0 · 是否能重建关键 Tool Call、Policy Decision、Command、Approval、Execution 链路？


**为什么问**

最终回答不足以解释业务动作。


**检查要点 / 需要什么证据**

检查 trace timeline 是否覆盖关键控制点。


**建议 / 参考方向**

将 policy decision、command hash、approval decision、executor result 作为独立事件。


**主要参考**：AWS-6; CSA-1


## J03 · P0 · 高风险业务动作是否产生独立 Audit Evidence，而不是只依赖 LLM Trace？


**为什么问**

Trace 主要用于 observability；监管/业务审计需要稳定、结构化、可追责的业务证据。


**检查要点 / 需要什么证据**

检查是否能回答谁批准、批准什么、执行什么、为什么允许、最终状态是什么。


**建议 / 参考方向**

建立独立 audit record；不要假设 LangSmith/OpenTelemetry trace 自动等于监管证据。


**主要参考**：FINMA-1; CSA-1


## J04 · P1 · 是否记录 Model/Prompt/Skill/Tool/Policy/Runtime Version？


**为什么问**

没有这些字段就无法调查 Behavior Drift。


**检查要点 / 需要什么证据**

随机抽取生产 execution 检查 provenance。


**建议 / 参考方向**

在 Execution Manifest 中固定保存，而不是事后猜测当前版本。


**主要参考**：AWS-1


## J05 · P1 · 关键 Retrieval Evidence 是否包括 Source、Version、Timestamp 和 Access Decision？


**为什么问**

“模型说它看到了资料”不能证明当时到底使用了哪一份数据。


**检查要点 / 需要什么证据**

检查高价值结果能否回溯到原始证据。


**建议 / 参考方向**

建立 Evidence Set / provenance store；对敏感数据记录引用而不是复制原文。


**主要参考**：AWS-7; NIST-1


## J06 · P1 · 是否建立 Agent Behavior Baseline，并持续监测 drift/anomaly？


**为什么问**

传统 CPU/latency healthy 不代表 Agent behavior healthy。


**检查要点 / 需要什么证据**

监测 task success、tool distribution、policy denials、escalation、abstention、side effects 等。


**建议 / 参考方向**

建立 per-agent baseline；显著偏移时触发 investigation 或 release rollback。


**主要参考**：AWS-6; LangSmith-1


## J07 · P1 · 是否明确 Business Owner、Technology Owner、Risk/Control Owner，并有周期性 review？


**为什么问**

AI 风险容易因为责任分散而无人负责。


**检查要点 / 需要什么证据**

检查 owner registry、审批记录和 review cadence。


**建议 / 参考方向**

把 Agent 纳入 portfolio registry；重大 model/tool/policy 变化触发 re-review。


**主要参考**：AWS-6; FINMA-1; FSB-1


## J08 · P1 · 是否有第三方/Provider failure 与退出方案，包括 model retirement、outage、data vendor 或 MCP 供应商变更？


**为什么问**

金融机构对 Big Tech、Cloud、Data Provider 的依赖本身就是 operational risk。


**检查要点 / 需要什么证据**

检查 provider concentration、contract/SLA、model retirement plan、fallback 和数据外发边界。


**建议 / 参考方向**

至少准备 provider outage、model retirement、价格变化、service termination 四类 contingency。


**主要参考**：FINMA-2; FSB-1; CSA-1


## 4. 不要给 80 题简单打平均分


不建议把结果计算成：

```text
PASS = 1
PARTIAL = 0.5
FAIL = 0
80 题平均分 = 92%
```

这种评分很容易掩盖 P0 结构性问题。例如：

```text
77 / 80
```

并不能抵消：

```text
Authorization = FAIL
Data Entitlement = FAIL
High-risk Command = FAIL
```

### 推荐采用三层 Gate

#### Gate 1 — P0

```text
任意 P0 = FAIL
→ 原则上禁止 Production
```

除非存在正式 Risk Acceptance。

#### Gate 2 — P1

```text
P1 = FAIL
→ 必须有 Owner + Remediation + Due Date
```

#### Gate 3 — P2

```text
进入持续改善 Backlog
```

### 风险判断建议

| 结果 | 建议 |
|---|---|
| P0 = 0 FAIL，P1 基本通过 | 可进入下一阶段 |
| 存在少量 P1 | 有补偿控制时可继续，必须留痕 |
| 存在 P0 | 不建议直接生产 |
| 多个 P0 集中在同一边界 | 优先重做架构，而不是逐个打补丁 |


## 5. Review 时最重要的“证据优先级”


并不是所有证据同样可信。对于关键问题，优先级可以理解为：

```text
Runtime / deterministic evidence
        >
Automated test evidence
        >
Configuration / code evidence
        >
Architecture documentation
        >
Human statement
        >
Prompt text
```

例如：

**问题：Agent 是否不会访问没有权限的客户数据？**

弱证据：

> “System Prompt 明确要求不能这么做。”

中等证据：

> “Architecture Diagram 中有 Data Entitlement Service。”

强证据：

> “Integration Test 使用 User A + Customer B，实际 Tool Trace 显示拒绝；没有发生下游数据访问。”

最强证据：

> “生产 Policy Engine 在 Tool invocation 前做 deterministic deny，且 Audit Event 能证明 request 被阻断。”


## 6. 推荐的最小金融 Agent Reference Architecture


```text
                         User
                           |
                           v
                  +----------------+
                  | Agent / LLM    |
                  | understand     |
                  | plan           |
                  | propose        |
                  +-------+--------+
                          |
             +------------+-------------+
             |                          |
             v                          v
      +-------------+             +-------------+
      | Retrieval   |             | Tool Gateway|
      | / Data API  |             | / MCP       |
      +------+------+             +------+------+
             |                           |
       Data Entitlement            Tool Policy
             |                           |
             +-------------+-------------+
                           |
                           v
                  +-------------------+
                  | Business Policy  |
                  | Authorization    |
                  +---------+---------+
                            |
                 high-risk? |
                    +-------+-------+
                    |               |
                   No              Yes
                    |               |
                    |        +------v------+
                    |        | Command     |
                    |        | + Approval  |
                    |        +------+------+
                    |               |
                    +-------+-------+
                            |
                            v
                    +---------------+
                    | Domain /      |
                    | Business API  |
                    +-------+-------+
                            |
                            v
                    Business System
                            |
                            v
                    Post-condition
                     Verification

Cross-cutting:
-------------------------------------------------
Identity | Audit | Trace | Evaluation | Kill Switch
Behavior Manifest | Incident | Drift Monitoring
-------------------------------------------------
```

### 架构原则

1. **LLM 负责理解、规划和提出候选方案。**
2. **Data Entitlement 决定能看到什么。**
3. **Authorization/Policy 决定能做什么。**
4. **Command 表达高风险业务动作。**
5. **Business System 持有最终业务事实和状态。**
6. **Verification 判断结果是否满足可验证条件。**
7. **Audit 独立于普通 LLM Trace。**
8. **Kill Switch 不应依赖 Agent 自己合作。**


## 7. 推荐的 Agent Evaluation 最小体系


不要只有一个 `accuracy`。

至少拆成五层：

| 层 | 需要回答的问题 | 常见实现 |
|---|---|---|
| Outcome | 业务任务是否完成？ | Ground Truth / Rule |
| Evidence | 结论是否被权威数据支持？ | Citation/Claim verification |
| Trajectory | Tool 选择和步骤是否正确？ | Trace assertions |
| Control | 是否越权/绕过 policy？ | Deterministic policy tests |
| Stability | 版本变化/重复运行是否发生不合理退化？ | Regression / baseline |

### 最低限度的 Dataset

建议每个生产 Agent 至少有：

```text
20% 正常案例
20% 边界案例
20% 历史失败案例
20% 安全/越权案例
20% 高风险业务案例
```

这不是行业统一标准，而是一个便于启动的内部工程基线；实际比例应根据风险和历史 incident 调整。

### 特别重要

不要只测试：

```text
Input -> Final Answer
```

至少增加：

```text
Input
 -> Retrieval
 -> Tool Selection
 -> Tool Arguments
 -> Policy Decision
 -> Final Result
 -> Business Outcome
```

Microsoft 当前 Agent Evaluation 已经将 Tool Selection、Tool Input Accuracy、Tool Output Utilization、Tool Call Success、Groundedness、Task Completion 等分开评估；LangSmith 也把 offline benchmark、unit/regression、backtesting 与 online monitoring、anomaly detection、production feedback loop 作为不同的 evaluation 模式。([Microsoft](https://learn.microsoft.com/en-us/agent-framework/agents/evaluation), [LangSmith](https://docs.langchain.com/langsmith/evaluation-types))


## 8. 生产变更的最小 Behavior Release Gate


Agent Release 不应该只有：

```text
Code Change
  -> Unit Test
  -> Deploy
```

推荐：

```text
Code / Model / Prompt / Skill / Tool / Policy Change
                    |
                    v
             Identify Changed Surface
                    |
                    v
             Offline Evaluation
                    |
        +-----------+-----------+
        |                       |
   Deterministic             LLM Judge
     Assertions                  |
        |                       |
        +-----------+-----------+
                    |
                    v
             Security / Red Team
                    |
                    v
              Regression Gate
                    |
                    v
            Canary / Staged Rollout
                    |
                    v
          Online Evaluation / Drift
                    |
             +------+------+
             |             |
          Healthy        Abnormal
             |             |
             v             v
        Continue        Rollback/
                         Disable
```

### 至少触发重新评估的变化

- Model / Model Version
- System Prompt
- Skill
- Tool schema
- Tool description
- Tool permission
- MCP server
- Retrieval ranking / index
- Data source
- Business Policy
- Approval Policy
- Runtime version
- Provider routing

AWS Agentic AI Lens 明确把 prompt、tool catalogs、model selection、policies 等视为行为资产，要求版本化、测试、分阶段发布和回滚。([AWS](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/design-principles.html))


## 9. Security Testing 最小体系


建议至少覆盖：

### 身份与权限
- 越权读其他客户
- 越权写其他客户
- 修改 user/account/resource ID
- Agent 身份冒用
- shared credential abuse

### Prompt / Context Attack
- Prompt injection
- Indirect prompt injection
- Malicious retrieved document
- Tool output injection
- Memory poisoning
- Goal hijacking

### Tool / MCP
- Forbidden Tool call
- Forbidden parameter
- BOLA/BFLA
- Tool discovery
- Excessive agency
- Multi-step tool-chain abuse
- SSRF / unauthorized external destination

### 数据外泄
- Sensitive data exfiltration
- Cross-tenant retrieval
- Unauthorized export
- Email / webhook / file upload exfiltration

Promptfoo 当前 Agent red teaming 已直接覆盖 RBAC、BOLA/BFLA、excessive agency、goal hijacking、multi-stage attacks、tool/API manipulation，以及基于 OpenTelemetry trajectory 的安全断言。([Promptfoo](https://www.promptfoo.dev/docs/red-team/agents/))

OWASP Top 10 for Agentic Applications 2026 可作为风险分类底稿。([OWASP](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/))


## 10. 金融场景建议增加的风险分级


建议不要用“Agent / 非 Agent”作为唯一风险分类。

可以使用：

| Tier | 典型行为 | 控制 |
|---|---|---|
| R0 | 只读、低影响、内部知识查询 | 基础 auth + logging |
| R1 | 分析、摘要、研究建议 | Grounding + Eval + provenance |
| R2 | 业务判断支持、准备业务动作 | deterministic validation + policy |
| R3 | 修改业务状态、对外发送重要信息 | Command + authorization + audit |
| R4 | 交易、付款、投票、权限变更等高风险不可逆动作 | Command + policy + approval + re-validation + strong audit |

**注意：这是建议性的内部分类，不是监管统一分类。**

金融机构应按自身业务、法人实体和适用监管要求进一步细化。FINMA 的公开材料特别强调 AI 的风险应纳入已有治理和风险管理体系，并采用风险导向、技术中立的方式管理；其 2025 调查也指出，对关键流程或监管参数使用 AI 时，需要尽早与监管沟通。([FINMA](https://www.finma.ch/en/news/2025/04/20250424-mm-umfrage-ki/))


## 11. Architecture Review 输出模板


```markdown
# Agent Architecture Review

## 1. Scope
- Agent:
- Business Use Case:
- Business Owner:
- Technology Owner:
- Risk/Control Owner:
- Jurisdiction:
- Risk Tier:

## 2. Overall Result
- P0:
- P1:
- P2:
- Decision: PASS / CONDITIONAL / FAIL

## 3. Critical Findings
### Finding 1
- Severity:
- Checklist:
- Risk:
- Evidence:
- Recommendation:
- Owner:
- Target Date:

## 4. Architecture Decision
- Approved:
- Conditions:
- Compensating Controls:

## 5. Evidence
- Architecture:
- Config:
- Tests:
- Runtime:
- Governance:

## 6. Production Gates
- [ ] P0 all passed
- [ ] Regression Eval passed
- [ ] Security / Red Team passed
- [ ] High-risk command controls passed
- [ ] Audit evidence verified
- [ ] Kill switch verified

## 7. Review Expiry
- Next review:
- Trigger conditions:
```


## 12. 重大变更重新 Review 的 Trigger


不需要每次小改动都重新做完整 80 问，但以下变化建议至少重新执行相关章节：

| Change | 至少重审 |
|---|---|
| Model / Provider | D + I + J |
| Prompt / Skill | D + I |
| Tool / MCP | E + F + I |
| Permission / Identity | F + G + J |
| Retrieval / Data Source | C + I + J |
| Business Rule / Policy | B + F + G + I |
| New Business State Mutation | G + H + I + J |
| New External Provider | E + J |
| High-risk Use Case | A + F + G + I + J |
| Incident / Material Drift | D + I + J + 相关故障域 |

这样可以避免“所有变更都触发一次完整 Architecture Board”的低效率做法。


## 13. 参考框架如何组合，不要混成一个标准


建议将它们定位成不同层次，而不是互相替代：

| 框架 | 最适合解决 |
|---|---|
| AWS Agentic AI Lens | Agent Architecture + Operations + Security + Reliability |
| OWASP Top 10 Agentic Applications | Agent Security / Threat Review |
| CSA Agent Control Plane | Control Plane / Governance / Accountability Architecture |
| NIST AI RMF | Enterprise AI Governance Overlay |
| FINMA Guidance | 金融机构 AI Risk / Governance 的监管观察 |
| FSB | 金融稳定与第三方依赖、集中度、模型/数据/cyber 风险 |
| LangSmith | Eval / Regression / Online Evaluation / Production Feedback |
| Microsoft Agent Evaluation | Tool/Trajectory/Quality Evaluation 指标参考 |
| Promptfoo | Agent Red Team / Security Regression |

NIST 明确说明 Playbook 不是 checklist，因此不建议把 NIST 原文直接变成项目级 200 项勾选表。更合理的做法是：用 NIST 定义治理层，用 AWS/OWASP/CSA 提供 Agent-specific controls，再用企业自身的金融控制要求形成真正可执行的 Review Checklist。([NIST](https://airc.nist.gov/airmf-resources/playbook/))


## 14. 参考资料


### AWS-1. [AWS Well-Architected Agentic AI Lens](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentic-ai-lens.html)

Agent 架构总览；强调 bounded agents、end-to-end observability、behavior as code、proportionate human oversight 和 explicit contracts。


### AWS-2. [AWS Agentic AI Lens — Operational Excellence Design Principles](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/operational-excellence-design-principles.html)

强调 purpose/autonomy/success criteria、lifecycle gates、drift detection 和 business-aligned KPIs。


### AWS-3. [AWS Agentic AI Lens — Human Oversight / Security](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/security.html)

安全与人类监督相关能力，包括 human oversight、containment、secure inputs/outputs。


### AWS-4. [AWS Agentic AI Lens — Secure Agent Tool Usage](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentsec02.html)

工具授权、schema validation、high-risk mutation、MCP registry 和 tool observability。


### AWS-5. [AWS Agentic AI Lens — Agent Identity and Permission Management](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentsec03.html)

区分 agent identity / human identity，强调 least privilege 和 identity propagation。


### AWS-6. [AWS Agentic AI Lens — Operational Excellence / AgentOps](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/design-principles.html)

行为版本化、生命周期 gate、drift、portfolio governance 和可回滚性。


### AWS-7. [AWS Agentic AI Lens — Reliability Design Principles](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/reliability-design-principles.html)

checkpoint、idempotency、graceful degradation、authoritative evidence、failure injection。


### AWS-8. [AWS Well-Architected Agentic AI Lens — Appendix A](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/appendix-a.html)

完整 best-practice reference，可作为架构 Review 的扩展问题库。


### AWS-9. [AWS AgentCore Ground Truth / Evaluation](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/ground-truth-evaluations.html)

Ground Truth、expected response、goal assertions、expected tool trajectory。


### OWASP-1. [OWASP Top 10 for Agentic Applications 2026](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/)

针对 autonomous/agentic AI 的安全风险框架；适合作为安全 Review 底稿。


### CSA-1. [Cloud Security Alliance — AI Agents: Architecture and Control Plane](https://cloudsecurityalliance.org/artifacts/ai-agents-architecture-and-control-plane)

2026 reference architecture，将 Infrastructure/Intelligence/Knowledge、Agency/Environment/Execution、Governance/Accountability 纳入统一 Control Plane 视角。


### NIST-1. [NIST AI RMF Playbook](https://airc.nist.gov/airmf-resources/playbook/)

Govern / Map / Measure / Manage；NIST 明确说明 Playbook 不是必须逐项执行的 checklist。


### NIST-2. [NIST AI RMF Generative AI Profile](https://doi.org/10.6028/NIST.AI.600-1)

confabulation、citation/grounding、human oversight、risk management 等生成式 AI 风险。


### FINMA-1. [FINMA Guidance 08/2024 — Governance and Risk Management when Using AI](https://www.finma.ch/en/news/2024/12/20241218-mm-finma-am-08-24/)

金融机构 AI 的 model/data/IT-cyber/third-party/legal/reputational 风险及治理与持续监控。


### FINMA-2. [FINMA 2025 Survey — AI Adoption in Swiss Financial Institutions](https://www.finma.ch/en/news/2025/04/20250424-mm-umfrage-ki/)

金融机构 GenAI 采用、BigTech dependency、数据质量/保护/正确性/外包风险，以及 critical processes 的治理关注。


### FSB-1. [FSB — The Financial Stability Implications of Artificial Intelligence](https://www.fsb.org/2024/11/the-financial-stability-implications-of-artificial-intelligence/)

金融稳定视角下的 model risk、data governance、cyber、third-party dependency、provider concentration 等。


### Microsoft-1. [Microsoft Agent Framework — Evaluation](https://learn.microsoft.com/en-us/agent-framework/agents/evaluation)

Agent behavior、tool usage、groundedness、task completion 等 evaluator 维度。


### Microsoft-2. [Microsoft Foundry — Built-in Evaluators](https://learn.microsoft.com/en-us/azure/foundry/concepts/built-in-evaluators)

Tool Selection、Tool Input Accuracy、Tool Output Utilization、Groundedness、Abstention 等。


### LangSmith-1. [LangSmith — Evaluation Types](https://docs.langchain.com/langsmith/evaluation-types)

offline benchmark/unit/regression/backtest 与 online monitoring/anomaly detection/feedback loop。


### Promptfoo-1. [Promptfoo — How to Red Team LLM Agents](https://www.promptfoo.dev/docs/red-team/agents/)

Agent red teaming、RBAC/BOLA/BFLA、excessive agency、multi-stage attacks、trajectory evidence 和 regression assertions。



---

## 15. 最终原则



一份金融 Agent Architecture Review 最终不是为了证明“这个 Agent 很聪明”，而是为了证明：

```text
它知道自己负责什么；
它只能访问被授权的数据；
它只能调用被授权的能力；
它不能自行定义企业安全边界；
关键结论有可验证证据；
关键计算由确定性系统完成；
高风险动作经过独立 Policy / Approval；
Business State 仍然由业务系统持有；
错误时能够停止、恢复和回滚；
生产行为能够被完整重建；
重大变化能够被重新评估；
出现问题能够快速止损。
```

因此，这份 Checklist 的核心不是 80 个“知识问题”，而是 80 个**风险探针**。

最理想的 Review 结果不是：

> “80 项全部打勾。”

而是：

> “我们已经知道这个 Agent 在什么边界内可以自主运行，哪些事情它绝对不能自己决定，以及一旦它犯错，系统在哪一层会阻止错误继续扩散。”

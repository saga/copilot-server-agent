金融服务领域，AI Agent平台的搭建使用，包括Agent本身的设计变得越来越普遍。架构设计的review不可能做的事无巨细，设计一个checklist检查列表（比如80个问题），能最大程度涵盖或者发现比较严重的问题，减少风险。除了问题，还应该给出建议或者参考方向，否则到底想说明什么不清楚，给我一个完整的markdown文档让我下载，里面的问题和建议包括检查要点都说清楚。


一、架构总论
金融服务领域 AI Agent Workflow 架构设计
为什么金融 Agent 不能让 LLM 成为 Workflow Engine
AI Agent、Workflow、Policy、Domain System 的职责边界
Deterministic Workflow + Probabilistic Agent：金融 AI 系统的基本架构
金融业务中的 Agent Control Plane 与 Agent Runtime 分离设计
从 Chatbot 到 Business Case：企业 Agent 应用的业务对象设计
为什么 Business State 不应该存在 Agent Memory 中
二、多人协作 / Human-in-the-loop
多人协作金融业务中的 AI Agent 设计模式
Human-in-the-loop 不只是 Approval Button
Maker-Checker 与 AI Agent：如何保持职责分离
AI Agent 如何参与多人业务流程而不改变组织授权边界
Human Task、Approval、Review 的统一建模
多人协作 Workflow 中的 Ownership、Membership、Observer 设计
Approval Policy：ANY / ALL / Required Votes 的工程化设计
AI Agent 参与审批流程时，什么必须由人决定

三、AI Agent 与 Workflow 的边界
Agent 可以决定什么，绝对不能决定什么
LLM Output 为什么必须被视为 Untrusted Input
Agent Proposal vs Business Decision：两个经常被混淆的概念
Agent Runtime 为什么不应该拥有 Workflow 状态机
Workflow Node 应该如何划分：Task / Gate / Review / Command
为什么不需要 @route：让 Workflow DSL 保持最小化
为什么 @task 不应该等同于 Sub-Agent
Agent Skill 与 Workflow Definition 为什么必须分离
一个 Workflow 是否应该对应多个 Agent

四、Policy / Authorization / Security
金融 Agent 系统中的三层权限模型：Identity / Data Entitlement / Action Authorization
为什么 Prompt 不是 Authorization
Data Entitlement 如何防止 Agent 越权检索
Capability-based Tool Access：Agent Tool 权限的最小化设计
高风险业务操作为什么应该建模为 Command
Policy Decision Point 与 Agent Runtime 的边界
AI Agent 如何在不可信输入环境中保持权限安全
Prompt Injection 为什么首先是 Authorization 问题
MCP Tool 为什么不能天然等同于 Agent Capability
金融 Agent 中的 Least Privilege 应该落在哪里


五、Command / Side Effect / Transaction
AI Agent 的 Read 与 Write 为什么应该完全区别对待
Command Pattern 如何解决 Agent 的业务副作用问题
Approval → Command → Execution：金融 Agent 的安全执行链
Agent Workflow 中的 Idempotency 设计
At-least-once Workflow + Idempotent Command Executor
为什么不要试图用 Distributed Transaction 解决 Agent Retry
Command Hash、Resource Version 与 TOCTOU 防护
外部系统执行失败时，Agent Workflow 应该如何恢复
金融 Agent 的 Retry / Timeout / Compensation 设计

六、Audit / Governance
AI Observability ≠ Regulatory Audit Evidence
金融 Agent 应该记录什么才能回答“Who / What / Why / How”
AI Agent Audit Trail 的最小数据模型
Workflow Version / Skill Version / Policy Version 的审计意义
为什么不能把完整 Prompt 当成唯一审计证据
Agent Decision Provenance：AI 结论如何追溯到 Evidence
金融 Agent 中的 Evidence-First 设计
Model Version、Skill Version 与 Business Decision 的关联
如何设计可 Replay 的金融 Agent Workflow
如何证明一次 AI 驱动业务操作到底为什么被允许


七、Workflow DSL / 技术实现
从 Markdown 到 Workflow AST：为什么 Agent Workflow 可以用 DSL 表达 *
Financial Workflow DSL 的 Parser / Validator / Analyzer 三层设计 *
为什么 Workflow DSL 应该先 Parse，再 Validate，再 Analyze *
Workflow Static Analysis：如何在运行前发现不可达节点和死流程 *
Agent Workflow DSL 的错误模型设计 *
Workflow Definition 的 Source Hash 与运行时一致性
Workflow Runner 如何实现单写者与 CAS *
等待人工审批时，Workflow Runtime 应该如何持久化 *
Workflow Resume / Restart / Recovery 的正确设计
为什么 Workflow Runtime 不应该绑定 Copilot SDK
Agent Runtime Adapter：Copilot SDK / DeepAgents / LangGraph 如何替换 *
如何设计一个与 Agent Framework 无关的 Workflow Engine *


搜索 Web，结合业界研究、大厂实践和金融服务领域经验，写一篇完整架构研究、分析的文章，标注可靠引用和链接，如果有真实案例佐证最好。
写完后先内部 review：检查主要论点是否有充分依据、是否混淆事实与推论、是否把结论说得过头；发现问题先修改文章。
最终只输出修改后的完整文章和参考资料，不要输出 review、分析过程、修改建议或生成过程。
主题：“为什么 Workflow DSL 应该先 Parse，再 Validate，再 Analyze”


八、Agent Runtime / Skills / Tooling
Skill、Tool、Capability、Command 四者到底有什么区别
为什么 Skill 不是 Tool 的集合
Agent Skill 如何成为企业治理边界的一部分
Skill 中哪些规则应该写脚本，哪些应该交给 LLM
Deterministic Check + LLM Reasoning：企业 Agent Skill 的组合模式
为什么企业 Agent 应该尽量把确定性判断移到代码
AI Agent 的工具调用为什么需要第二层 Policy
Server-side Agent Runtime 与 IDE Agent Runtime 的架构差异

九、工程可靠性
Agent Execution 的状态机应该如何设计
Agent Session 与 Business Execution 为什么应该分离
Workflow Process Crash 后如何安全恢复
Stale Approval Callback 如何处理
Agent Session Lost 后为什么业务状态仍然不能丢
AI Workflow 的并发控制与 Single Writer 模式
AI Agent Workflow 的 Failure Boundary 如何设计
为什么 Agent Runtime 可以失败，但 Business Workflow 不能失控
十、非常值得结合你当前项目写的几个“方法论”文档

这几个我认为最容易沉淀成以后反复使用的架构文章：

Financial AI Agent Architecture Review Checklist
AI Agent Workflow Security Checklist
AI Agent Authorization Boundary Checklist
Human-in-the-loop Architecture Checklist
Agent Command Safety Checklist
AI Agent Audit Evidence Checklist
Agent Workflow Failure & Recovery Checklist
Agent Skill Security Review Checklist
Enterprise Agent Capability Design Checklist
Agent Runtime Portability Checklist





你现有这份列表已经相当完整，尤其是 **Workflow、Authorization、Command、Audit、DSL、Runtime、Failure** 这几块已经形成了比较完整的骨架。真正值得继续扩展的，不是再增加更多“为什么 Agent 不应该……”类型的小主题，而是补上目前业界正在快速形成的几个新层次：**Context / Memory、Agent Lifecycle、Supply Chain、Agent-to-Agent Trust、Runtime Containment、Evaluation & Release、Operational Resilience、Human Factors、Platform Economics**。

这几个方向在最新的大厂实践里已经非常明显：AWS 2026 Agentic AI Lens 把 memory/state、tool authorization、identity、non-repudiation、multi-agent orchestration、human containment、input/output validation、vulnerability testing 都单独列为控制域；Microsoft 进一步把 agent sprawl、supply-chain compromise、JIT entitlements、kill switch 和 downstream authorization 纳入 Agent 治理；FSB 2025–2026 则特别关注 AI 第三方依赖、集中度、可替代性和金融系统层面的 common-mode failure。([AWS Documentation][1])

下面我建议新增这些研究方向。

### 11. Context / Memory / Information Flow

| 题目                                                                           | 分析研究方向 / 主题                                                                                                     |   优先级 |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ----: |
| **Agent Context 为什么应该被视为 Privileged Workspace**                              | Context 中包含什么数据、谁可以写入、谁可以读取、哪些内容可以跨 Task / Session / Agent 传播；把 Context 当作比普通 Prompt 更高风险的安全边界                  | ★★★★★ |
| **Context Engineering 不只是 Prompt Engineering**                               | Context 的组成、裁剪、排序、检索、压缩、freshness、trust level；为什么 Agent 系统真正控制的是“模型看到什么”而不是只控制 Prompt                           | ★★★★★ |
| **Agent Context 中的 Data Provenance 应该如何建模**                                  | 每段 context 来自哪里、哪个用户/系统提供、何时获取、可信级别、是否经过授权；研究 provenance 如何进入审计                                                 | ★★★★★ |
| **为什么 Retrieved Content 不能天然成为 Agent Instruction**                           | 外部文档、网页、邮件、RAG 结果和 system instruction 的 trust-level 分离；研究 instruction/data separation                           | ★★★★★ |
| **Agent Memory 为什么需要独立的 Trust Boundary**                                     | session memory、long-term memory、shared memory、organizational memory 的不同权限与完整性要求                                 | ★★★★★ |
| **Agent Memory Poisoning：为什么 Memory Write 比 Memory Read 更危险**                | 谁能写 Memory、哪些结果可以持久化、如何验证、如何回滚、如何隔离 agent-to-agent memory contamination                                         | ★★★★★ |
| **Agent Memory 的 Namespace 隔离模型：User / Tenant / Agent / Workflow / Session** | 多租户金融 Agent 中 memory namespace 如何设计；什么可以共享，什么绝不能共享                                                              | ★★★★★ |
| **Agent Context 的 Data Minimization 原则**                                     | 不只是“用户能访问什么”，还研究“Agent 为完成当前 Task 实际需要看到什么”；least privilege 从 access scope 延伸到 context scope                    | ★★★★★ |
| **Agent Context 的 Freshness：过期数据为什么会成为业务风险**                                 | Market data、client status、approval status、policy version 的 freshness；研究 stale context 与 stale authorization 的区别 |  ★★★★ |
| **Context Compression 为什么会改变 Auditability**                                  | summary / compaction 后原始证据是否丢失，如何保留 provenance 与 evidence lineage                                               |  ★★★★ |

AWS 已经把 memory isolation、integrity、validation 和 hallucination propagation 单独列为 Agent Security domain；Anthropic 则把 context engineering 视为 Agent 系统的重要工程问题，而不再只是 Prompt Engineering。([AWS Documentation][2])

---

### 12. Agent Lifecycle / Agent Registry / Agent Sprawl

| 题目                                                                     | 分析研究方向 / 主题                                                                                 |   优先级 |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ----: |
| **企业为什么需要 Agent Registry**                                             | Agent 的身份、Owner、Sponsor、用途、风险等级、数据范围、工具范围、版本、部署环境、生命周期                                      | ★★★★★ |
| **Agent Sprawl：为什么 Agent 越多不一定越好**                                     | Agent 数量增长带来的权限、审计、成本、依赖、Shadow Agent 和 ownership 问题                                        | ★★★★★ |
| **一个 Agent 应该拥有 Owner 还是 Sponsor + Owner**                             | Business Owner、Technical Owner、Risk Owner、Sponsor 的职责划分                                     |  ★★★★ |
| **Agent 生命周期管理：Create / Approve / Deploy / Suspend / Revoke / Retire** | Agent 不只是代码部署对象，而是一个需要完整生命周期治理的 non-human principal                                         | ★★★★★ |
| **如何发现企业里的“未知 Agent”**                                                 | Shadow Agent、个人账号创建的 Agent、IDE Agent、MCP-connected Agent、第三方 Agent 的 inventory              | ★★★★★ |
| **Agent Permission Drift：为什么 Least Privilege 会随着时间失效**                 | unused permissions、scope expansion、tool proliferation、workflow changes、role drift           | ★★★★★ |
| **Agent Decommission 为什么比 Agent Deployment 更难**                        | 如何撤销 token、session、memory、tool bindings、scheduled jobs、delegations 和 downstream permissions |  ★★★★ |
| **Agent Blueprint 与 Agent Instance 应该如何分离**                            | “Agent Definition” vs “运行中的 Agent Identity / Session / Deployment”                          |  ★★★★ |

Microsoft 2026 的 Agent least-privilege guidance 已经把 **unique identity、owner/sponsor、task-scoped authorization、JIT entitlement、permission review、revocation、kill-switch testing** 明确列为治理对象；同时把 agent sprawl 单独列为风险。([Microsoft Learn][3])

---

### 13. Agent Supply Chain / Capability Supply Chain

这一块我认为你的列表里**非常值得补，而且会越来越重要**。

| 题目                                                     | 分析研究方向 / 主题                                                                                                |   优先级 |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | ----: |
| **Agent Supply Chain：Agent 到底依赖了什么**                   | Model、Skill、Tool、MCP Server、Library、Prompt、Reference、Retriever、Data Source、External API 的 dependency graph | ★★★★★ |
| **Skill / Tool / MCP Server 的 Provenance 应该怎么治理**      | 来源、作者、签名、版本、review status、security assessment、expiry                                                       | ★★★★★ |
| **为什么 MCP Server 应该进入 Enterprise Tool Registry**       | MCP 不等于可信工具；研究注册、审批、版本 pinning、scope、data classification、review expiry                                     | ★★★★★ |
| **Agent Capability Registry 应该管理什么**                   | Agent、Skill、Tool、Command、MCP Server、Model 等 capability artifact 如何统一注册                                     | ★★★★★ |
| **Capability Dependency Graph：一个 Agent 到底“间接拥有”了什么权限** | Agent → Skill → Tool → MCP → API → Data 的 transitive dependency / privilege reachability                   | ★★★★★ |
| **“一个工具被升级了”为什么可能等价于“权限边界被改变”**                        | Tool / MCP implementation change 对 Agent capability 和 risk posture 的影响                                     |  ★★★★ |
| **AI Agent 的 SBOM 应该长什么样**                             | 从传统 Software SBOM 扩展到 Model / Prompt / Skill / Tool / Data / Policy provenance                             | ★★★★★ |
| **第三方 AI Provider 的 Change Notification 应该如何进入企业治理**   | Model update、tool update、MCP update、embedding update 对生产 Agent 的影响                                         |  ★★★★ |

AWS 现在已经明确要求 Tool / MCP Server 在进入 Agent 环境之前进行 security review、registration、version pinning、data classification 和 review expiry；Microsoft 也把 model、tool、plugin、grounding data 作为 Agent supply chain 的组成部分。([AWS Documentation][4])

---

### 14. Agent-to-Agent Trust / Delegation / A2A

你现在有“一个 Workflow 是否应该对应多个 Agent”，但还缺少更深一层的 **Agent 间信任模型**。

| 题目                                                        | 分析研究方向 / 主题                                                           |   优先级 |
| --------------------------------------------------------- | --------------------------------------------------------------------- | ----: |
| **Agent-to-Agent 调用到底是谁在授权谁**                             | Caller Agent、Target Agent、Original User、Workflow 的主体关系                | ★★★★★ |
| **Delegation Chain：Agent A → Agent B → Tool C 的权限应该如何传播** | 权限是继承、委托还是重新授权；防止 transitive privilege escalation                     | ★★★★★ |
| **Agent Handoff 为什么不是简单的 RPC**                            | context、identity、authority、ownership、failure boundary 在 handoff 时如何变化 | ★★★★★ |
| **Agent-to-Agent Authorization 的最小权限模型**                  | A 能否调用 B；A 能否要求 B 代为执行 A 无权执行的动作                                      | ★★★★★ |
| **A2A Agent Card 为什么不能等同于 Trust Contract**                | capability discovery、identity、authentication、authorization、trust 分离   |  ★★★★ |
| **跨 Trust Zone 的 Agent Collaboration 如何设计**               | network boundary、message signing、encryption、schema、policy enforcement | ★★★★★ |
| **多 Agent Workflow 中如何阻止一个 Agent 横向扩散权限**                 | lateral movement、privilege propagation、compromised-agent blast radius | ★★★★★ |
| **Agent Delegation 的 Non-Repudiation 怎么做**                | 谁发起 delegation、谁批准、谁执行、每一跳如何留下证据                                      |  ★★★★ |

AWS 最新 Agentic AI Lens 已明确提出：多 Agent 系统需要 trust zones、message signing/encryption、scoped IAM、circuit breakers，而且每一次 delegation、agent discovery 和 result collection 都应具有可归属的身份。([AWS Documentation][5])

---

### 15. Runtime Containment / Kill Switch / Break Glass

这个方向非常值得单独形成一个系列，你现有列表还没有真正展开。

| 题目                                           | 分析研究方向 / 主题                                                               |   优先级 |
| -------------------------------------------- | ------------------------------------------------------------------------- | ----: |
| **为什么 Agent 必须拥有 Kill Switch**               | Agent runaway、tool loop、错误批量执行时如何立即停止                                     | ★★★★★ |
| **Kill Switch 到底应该停什么**                      | Agent、Session、Workflow、Tool、Credential、Command 哪一层应该被停止                   | ★★★★★ |
| **Agent Containment：如何限制 Blast Radius**      | rate limit、spend limit、tool count、resource scope、network scope、data scope | ★★★★★ |
| **Break-Glass 为什么不能只是“管理员关闭 Agent”**         | 紧急授权、紧急停止、恢复、双人控制与事后审计                                                    | ★★★★★ |
| **Agent Circuit Breaker 的设计**                | 连续错误、异常 tool pattern、policy violation、latency spike 如何触发自动熔断              | ★★★★★ |
| **Runaway Agent：如何定义“失控”**                   | 无限循环、tool storm、recursive delegation、data enumeration、异常 spending         | ★★★★★ |
| **动态 Capability Toggle：为什么企业 Agent 需要运行时开关** | 临时关闭某个 Tool / Skill / Model / Route，而不停止整个 Workflow                       |  ★★★★ |
| **Agent 降级模式应该是什么**                          | Full autonomy → read-only → draft-only → human-only → fail-closed         | ★★★★★ |

AWS 当前已经将 human containment、dynamic capability toggling、break-glass runbooks、rate limiting 和高风险 action containment 纳入 Agentic AI Lens；Microsoft 也明确要求测试 agent disable、credential revocation 和 kill-switch。([AWS Documentation][1])

---

### 16. Agent Evaluation / Release Engineering

你已有“Skill Evaluation”相关内容，但还可以继续向真正的 **Agent CI/CD** 深挖。

| 题目                                                             | 分析研究方向 / 主题                                                                              |   优先级 |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ----: |
| **Agent CI/CD 与传统软件 CI/CD 有什么本质区别**                            | Code Test、LLM Eval、Workflow Test、Security Test、Shadow Test 如何组合                          | ★★★★★ |
| **为什么 Prompt Change 也应该有 Release Gate**                        | Prompt 改动可能改变 tool selection、data access、action behavior                                 | ★★★★★ |
| **Model Upgrade 为什么不应该自动进入 Production Agent**                  | behavior regression、tool-calling regression、policy adherence regression                  | ★★★★★ |
| **Agent Canary Release 怎么做**                                   | 5% traffic、shadow、business-case segmentation、risk-tier rollout                           | ★★★★★ |
| **Production Shadow Agent 应该如何设计**                             | 让新 Agent “看真实流量但不能产生副作用”                                                                 | ★★★★★ |
| **Agent Rollback 到底回滚什么**                                      | Model / Prompt / Skill / Tool / Policy / Workflow 如何分别 rollback                          | ★★★★★ |
| **Agent Compatibility Matrix：Model × Skill × Tool × Workflow** | 为什么单独测试 Agent 不够，需要测试组合兼容性                                                               | ★★★★★ |
| **Agent Regression Suite 应该包含什么**                              | normal、edge、adversarial、permission、recovery、business-case scenario                       | ★★★★★ |
| **为什么 Agent Eval 不应该只看“最终答案对不对”**                              | tool selection、policy compliance、workflow adherence、cost、latency、safety、business outcome | ★★★★★ |
| **如何把 Incident 自动转化成新的 Agent Evaluation Case**                 | incident → adversarial case → regression benchmark → release gate                        | ★★★★★ |

AWS 当前把 Agent 测试分成 component、integration、end-to-end 和 production-shadow，并要求 evaluation datasets、prompts、rubrics、rollback 都版本化；这已经非常接近“Agent CI/CD”。([AWS Documentation][6])

---

### 17. Agent Behavior Drift / Model Drift / Policy Drift

这是你现有“Model Version、Skill Version 与 Business Decision”可以进一步升级的一层。

| 题目                                                 | 分析研究方向 / 主题                                                               |   优先级 |
| -------------------------------------------------- | ------------------------------------------------------------------------- | ----: |
| **Agent Behavior Drift：没有改代码，为什么行为也会变**            | Model provider update、context change、tool update、data distribution change | ★★★★★ |
| **Policy Drift 与 Model Drift 应该怎么区分**              | Policy 没变但模型变了 vs 模型没变但 Policy 变了                                         | ★★★★★ |
| **Tool Drift：Tool Schema 改变为什么会影响 Agent 行为**       | 参数语义、返回结构、错误码、侧效果变化                                                       |  ★★★★ |
| **Skill Drift：Skill 内容变了为什么可能改变 Business Outcome** | Prompt / Skill 改动与 business process regression 的联系                        |  ★★★★ |
| **Agent Capability Drift 的持续监控**                   | 工具调用比例、数据访问范围、action pattern 是否逐渐扩大                                       | ★★★★★ |
| **Effective Permission Drift：Agent 实际能做什么是否发生变化**  | IAM + Tool + Data + Workflow 的 aggregate effective privilege analysis     | ★★★★★ |

AWS 明确建议把 prompts、tool catalogs、role definitions、model selections 和 policies 都当成 versioned artifacts；Microsoft 也强调 workflow、tool、data scope 或 deployment environment 变化后重新 review access。([AWS Documentation][7])

---

### 18. Agent Policy-as-Code / Policy Testing

你已有 Authorization，但我建议继续向 **Policy Engineering** 深挖。

| 题目                                                       | 分析研究方向 / 主题                                                      |   优先级 |
| -------------------------------------------------------- | ---------------------------------------------------------------- | ----: |
| **Policy-as-Code 为什么是金融 Agent 的必要基础设施**                  | Policy versioning、testing、review、deployment、rollback             | ★★★★★ |
| **Agent Authorization Policy 应该如何单元测试**                  | allow / deny / boundary / negative cases                         | ★★★★★ |
| **Policy Conflict 如何解决**                                 | allow vs deny、多个 Policy source、workflow policy 与 IAM 冲突          | ★★★★★ |
| **Policy Simulation：真正执行前能不能先模拟一次**                      | hypothetical authorization / dry-run / explain decision          | ★★★★★ |
| **Authorization Explainability：为什么这次请求被 DENY**           | decision trace、policy matched、missing entitlement、state mismatch | ★★★★★ |
| **Policy Reachability Analysis：哪些 Tool 实际可达**            | Workflow × Agent × Skill × Tool × Identity 的权限图分析                | ★★★★★ |
| **Privilege Escalation Path Analysis for Agents**        | 从低风险 Task 到高权限 Command 的潜在路径                                     | ★★★★★ |
| **Temporal Authorization：为什么某个权限只在当前 Workflow Stage 有效** | state-based permission、JIT authorization、time-bound access       | ★★★★★ |

AWS AgentCore 的 Cedar Policy、default deny、policy evaluation 和 Microsoft 的 task-scoped/JIT authorization 都很适合成为这类研究的基础资料。([AWS Documentation][8])

---

### 19. Data Flow / Information Flow Control

这一块我认为非常值得补，尤其适合金融。

| 题目                                                 | 分析研究方向 / 主题                                                         |   优先级 |
| -------------------------------------------------- | ------------------------------------------------------------------- | ----: |
| **Agent Data Flow 如何做 Taint Tracking**             | Public / Internal / Confidential / MNPI 等信息进入 Agent 后如何标记传播         | ★★★★★ |
| **为什么“有权限读取”不代表“有权限输出”**                           | Data read permission、aggregation、export、external communication 分开   | ★★★★★ |
| **Agent 能不能把两个合法数据源组合成一个非法结果**                     | Cross-source aggregation / inference risk                           | ★★★★★ |
| **跨租户 Agent Context 如何防止数据串线**                     | tenant isolation、session isolation、memory isolation、retrieval scope | ★★★★★ |
| **Agent Data Exfiltration Boundary 应该在哪里**         | Retrieval → Context → Output → Tool → External API 全链路数据出口控制        | ★★★★★ |
| **Purpose Limitation：同一份数据为什么不能因为 Agent 能访问就任意使用** | trading purpose、research purpose、client-service purpose 的用途边界       | ★★★★★ |
| **Agent 的 Output 也应该进行 Data Entitlement Check 吗**  | 输出给用户 vs 发送到外部系统 vs 写回数据库的不同要求                                      | ★★★★★ |

Microsoft 目前已经把 agent data aggregation、long-lived context、data boundaries、output filtering 作为专门风险，并建议 deterministic rules 控制敏感数据的使用、保留和输出。([Microsoft Learn][9])

---

### 20. Operational Resilience / Third-Party / Concentration Risk

这是**金融领域很值得增加，而且在普通 Agent 文章中很少出现**的一组。

| 题目                                                         | 分析研究方向 / 主题                                                                 |   优先级 |
| ---------------------------------------------------------- | --------------------------------------------------------------------------- | ----: |
| **金融 Agent 的 Critical Third Party Dependency Map 怎么做**     | Model provider、Cloud、Embedding、Vector DB、MCP、Data Vendor 的 dependency graph | ★★★★★ |
| **一个金融 Agent 对单一 Model Provider 的依赖到底有多深**                 | model concentration、fallback、substitutability                               | ★★★★★ |
| **AI Provider Outage 时 Workflow 应该如何继续**                   | alternate model、degraded mode、human fallback、queueing                       | ★★★★★ |
| **Model Failover 为什么可能改变业务语义**                             | 不同模型的 tool selection、policy adherence、output behavior 差异                    | ★★★★★ |
| **Agent Common-Mode Failure：多个 Agent 为什么可能同时犯同一种错误**       | 同一 Model、Prompt、Tool、Vendor、Data Source 导致 correlated failure               | ★★★★★ |
| **Agent Concentration Risk 如何量化**                          | 某个 Model / Cloud / Data Vendor 被多少 Workflow / Agent 共用                      | ★★★★★ |
| **金融 Agent 的 Dependency Substitutability 应该如何评估**          | 有没有第二供应商、切换多久、切换后质量损失多少                                                     | ★★★★★ |
| **Agent Disaster Recovery 不应该只恢复服务，还要恢复 Decision Context** | workflow checkpoint、approval、policy、memory、evidence 的一致恢复                   | ★★★★★ |

FSB 2025–2026 连续把 AI 第三方依赖、criticality、concentration、substitutability 作为金融体系的重要监测问题；2026 IMF 又进一步强调共同云、软件和 AI Provider 形成 common-mode failure 的可能性。([Financial Stability Board][10])

---

### 21. Human Factors / Automation Bias

你现在的人机协作主要偏“流程建模”，还缺一层**人在 Agent 系统中的认知风险**。

| 题目                                                | 分析研究方向 / 主题                                                |   优先级 |
| ------------------------------------------------- | ---------------------------------------------------------- | ----: |
| **为什么 Human-in-the-loop 会逐渐变成 Human-on-the-loop** | 人到底是在主动判断，还是只是在“Approve”                                   | ★★★★★ |
| **Automation Bias：为什么 Agent 建议越专业，人越容易放弃独立判断**    | 金融研究、风险分析、合规审批场景                                           | ★★★★★ |
| **Human Review 的信息量应该如何设计**                       | evidence、reason、uncertainty、alternative、policy result 如何呈现 | ★★★★★ |
| **Approval UX 为什么也是安全控制**                         | reviewer 是否能发现模型错误，与“有没有 Approve Button”不是一回事              | ★★★★★ |
| **为什么高质量 Review 需要“反向证据”**                        | 不只展示 Agent recommendation，也展示 conflicting evidence         | ★★★★★ |
| **Agent Confidence 为什么不能直接作为 Approval Signal**    | confidence calibration、evidence quality、policy result 的区别  | ★★★★★ |
| **Human Override 应该如何治理**                         | 谁可以 override、override 什么、理由、二次审批、后审计                       | ★★★★★ |
| **Reviewer Fatigue 的工程化治理**                       | 风险分级、采样、升级、review queue、auto-escalation                    |  ★★★★ |

AWS 当前已经把 human oversight 从简单 approval 扩展到 autonomy levels、比例化 oversight 和 containment；FSB 也强调金融机构应该结合自身风险设计 guardrails，而不是采用统一的一刀切方案。([AWS Documentation][7])

---

### 22. Agent Business SLO / Cost / Capacity

这是你现有列表里**比较大的空白**。

| 题目                                          | 分析研究方向 / 主题                                                     |   优先级 |
| ------------------------------------------- | --------------------------------------------------------------- | ----: |
| **Agent Workflow 的 SLO 应该是什么**              | Success Rate、Decision Quality、Latency、Human Wait、Recovery Time  | ★★★★★ |
| **Agent Reliability 应该按什么粒度衡量**             | Model、Agent、Task、Workflow、Business Case 哪一级                     | ★★★★★ |
| **Token Budget 应该成为 Workflow Control 吗**    | Agent runaway 时如何限制 reasoning / tool / token budget             | ★★★★★ |
| **Agent Cost Budget 与 Business Value 怎么结合** | 一个 Business Case 最多允许多少钱的模型调用                                   |  ★★★★ |
| **Agent Latency Budget：什么时候应该停止继续推理**       | model calls、tool latency、human review SLA、business deadline     | ★★★★★ |
| **Runaway Agent 的 Rate Limit 应该限制什么**       | tool calls、tokens、API requests、money movement、data enumeration  | ★★★★★ |
| **Agent Backpressure：高峰期为什么不能无限增加 Agent**   | queue、concurrency、provider quota、human review backlog           |  ★★★★ |
| **Agent Cost Attribution：谁应该为 Agent 成本负责**  | Workflow、Business Unit、User、Model、Tool、Vendor 的 cost allocation |  ★★★★ |

AWS 当前把 cost、latency、quality、security 等纳入 agent observability，并把 workflow effectiveness 指标提升到 business KPI 层面；其 recovery guidance 还引入 retry budget、backoff 和 failure classification。([AWS Documentation][11])

---

### 23. Agent Platform Architecture / Governance

这是非常适合你后续做平台架构文章的一组。

| 题目                                                                       | 分析研究方向 / 主题                                                                 |   优先级 |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------- | ----: |
| **企业 Agent Platform 到底应该提供什么，业务团队不应该自己实现什么**                             | Identity、Policy、Workflow、Memory、Skill、Tool、Audit 哪些属于平台能力                   | ★★★★★ |
| **Agent Control Plane 应该管什么**                                            | Registry、Identity、Policy、Capability、Version、Deployment、Audit                | ★★★★★ |
| **为什么 Agent Registry、Workflow Registry、Skill Registry 不应该混成一个 Registry** | 三者生命周期、ownership、risk classification 不同                                     | ★★★★★ |
| **Capability Registry 与 Tool Registry 的边界**                              | Skill / Tool / Command / API / MCP / Agent 如何分类                             | ★★★★★ |
| **Agent Runtime Adapter 为什么比绑定某个 Framework 更重要**                         | LangGraph / DeepAgents / Copilot SDK / OpenAI Agents / ADK 的替换性             |  ★★★★ |
| **Enterprise Agent Gateway 应该控制什么**                                      | Identity、Tool、Data、Policy、Audit、Rate Limit、Containment                      | ★★★★★ |
| **Agent Platform 的“安全默认值”应该是什么**                                         | default deny、read-only、no cross-tenant、no external network、human checkpoint | ★★★★★ |
| **什么时候应该允许团队自己部署 Agent，什么时候必须经过平台**                                      | risk tier、data sensitivity、side effect、autonomy level                       | ★★★★★ |

Bank of England 在 2026 年关于 Frontier AI “harness engineering”的文章其实很值得你单独研究：它把 tools、workflows、controls、data 和 operating environment 统称为 harness，并强调真正决定企业能否安全使用 Frontier AI 的，往往是模型周围的控制架构，而不是模型本身。([Bank of England][12])

---

### 24. 我尤其建议增加的“高级方法论”主题

如果目标不是继续堆文章，而是最终形成你自己的 **Agent Architecture Review Methodology**，下面这些非常值得做。

| 题目                                                                   | 分析研究方向 / 主题                                                             |   优先级 |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------- | ----: |
| **Agent Architecture 的 Blast Radius Analysis 方法**                    | 如果某个 Agent 被攻破，最多能看到什么、修改什么、调用什么                                        | ★★★★★ |
| **Agent Privilege Reachability Analysis**                            | 从 Identity → Skill → Tool → Data → Command 计算实际可达权限                     | ★★★★★ |
| **Agent Trust Boundary Mapping：如何画出一张真正有用的 Agent Trust Map**         | User / Agent / Workflow / Tool / Data / External Vendor / Human Review  | ★★★★★ |
| **Agent Threat Modeling 应该如何区别于传统 STRIDE**                           | Prompt Injection、Tool Abuse、Memory Poisoning、Agent Handoff、Delegation 等 | ★★★★★ |
| **Agent Attack Path Analysis：从 Prompt Injection 到 Business Command** | 不只证明 injection 能发生，而是分析是否最终形成高风险 side effect                            | ★★★★★ |
| **Agent Failure Mode and Effects Analysis（Agent-FMEA）**              | 按 Task / Agent / Tool / Workflow / Human / Vendor 分析 failure mode       | ★★★★★ |
| **Agent Control Coverage：如何衡量“有多少控制真的在 Enforcement Point 上”**        | Prompt、Guardrail、Policy、IAM、Workflow、Domain API 的控制覆盖率                  | ★★★★★ |
| **Agent Autonomy Budget：一个 Agent 到底应该被允许自主到什么程度**                    | Observer / Assistant / Autonomous / Orchestrator 与风险等级映射                | ★★★★★ |
| **Agent Policy Coverage Analysis**                                   | 哪些 Tool / Command 没有 policy，哪些 policy 没有 negative tests                 | ★★★★★ |
| **Agent Architecture Decision Record（Agent-ADR）应该记录什么**              | 为什么选单 Agent、多 Agent、Skill、Workflow、Tool、Human 等                         |  ★★★★ |

这里面“Blast Radius / Reachability / Threat Modeling / Control Coverage”尤其值得做，因为它们可以从“文章”进一步变成**可以自动检查的 Architecture Review Skill**。

AWS 当前设计原则已经明确把 bounded agents、explicit contracts、proportionate human oversight、versioned agent behavior 和 end-to-end traceability作为核心原则；其 security lens 又把 memory、tool、identity、multi-agent、input/output、penetration testing 分开，因此非常适合把这些研究进一步沉淀成可执行的 review framework。([AWS Documentation][7])

---

# 我会优先增加的 20 个

如果不想一下子扩到几十篇，我建议先从下面这 20 个开始。它们和你现有文章组合后，基本能形成一套比较完整的 **Financial Agent Architecture**：

| 优先 | 研究题目                                                           | 核心价值                                              |
| -: | -------------------------------------------------------------- | ------------------------------------------------- |
|  1 | **Agent Context 为什么应该被视为 Privileged Workspace**                | 补上 Prompt / Data / Memory 中间的核心边界                 |
|  2 | **Agent Context 中的 Data Provenance 应该如何建模**                    | 把 Context 与 Audit / Evidence 连起来                  |
|  3 | **Agent Memory Poisoning：为什么 Memory Write 比 Memory Read 更危险**  | 目前 Agent Security 非常重要但你列表缺失                      |
|  4 | **企业为什么需要 Agent Registry**                                     | 从单 Agent 架构进入企业平台治理                               |
|  5 | **Agent Sprawl：为什么 Agent 越多不一定越好**                             | 企业规模化必然遇到                                         |
|  6 | **Agent Supply Chain：Agent 到底依赖了什么**                           | Model / Skill / Tool / MCP / Data 全部纳入            |
|  7 | **Agent Capability Registry 应该管理什么**                           | 对你的 Agent Platform 特别有价值                          |
|  8 | **Capability Dependency Graph：Agent 到底间接拥有了什么权限**              | 很适合发展成静态分析 Skill                                  |
|  9 | **Agent-to-Agent Authorization 的最小权限模型**                       | 补齐 Multi-Agent 安全缺口                               |
| 10 | **Delegation Chain：Agent A → Agent B → Tool C 的权限如何传播**        | 连接 Identity / Authorization / A2A                 |
| 11 | **为什么 Agent 必须拥有 Kill Switch**                                 | 从安全设计进入运行时治理                                      |
| 12 | **Agent Containment：如何限制 Blast Radius**                        | 很适合金融服务                                           |
| 13 | **Agent CI/CD 与传统软件 CI/CD 有什么本质区别**                            | 建立工程化落地体系                                         |
| 14 | **Agent Behavior Drift：没有改代码，为什么行为也会变**                        | 解决长期运营问题                                          |
| 15 | **Agent Compatibility Matrix：Model × Skill × Tool × Workflow** | 非常适合你的平台                                          |
| 16 | **Policy Reachability Analysis：哪些 Tool 实际可达**                  | 可自动化检查                                            |
| 17 | **Agent Privilege Reachability Analysis**                      | 可直接成为 Architecture Review Skill                   |
| 18 | **Agent Threat Modeling 应该如何区别于传统 STRIDE**                     | 建立安全方法论                                           |
| 19 | **Agent Architecture 的 Blast Radius Analysis 方法**              | 非常适合金融架构评审                                        |
| 20 | **Agent Autonomy Budget：一个 Agent 应该被允许自主到什么程度**                | 可以把 Human-in-the-loop、Risk Tier、Authorization 串起来 |

---

# 一个更大的结构建议

你现在的 10 个章节如果继续发展，我反而不建议继续加很多零散文章。可以逐步扩展成下面这套体系：

```text
01 Architecture
   ├── Workflow
   ├── Agent Runtime
   ├── Control Plane
   ├── Business State
   └── Business Case

02 Workflow Semantics
   ├── Task
   ├── Gate
   ├── Review
   ├── Command
   └── DSL

03 Agent Semantics
   ├── Skill
   ├── Tool
   ├── Capability
   ├── Sub-Agent
   └── Multi-Agent

04 Context & Data
   ├── Context
   ├── Retrieval
   ├── Memory
   ├── Provenance
   └── Data Flow

05 Identity & Policy
   ├── Identity
   ├── Entitlement
   ├── Authorization
   ├── Delegation
   └── Policy-as-Code

06 Execution Safety
   ├── Command
   ├── Idempotency
   ├── Transaction
   ├── Containment
   └── Kill Switch

07 Reliability
   ├── Retry
   ├── Recovery
   ├── Checkpoint
   ├── Blast Radius
   └── Disaster Recovery

08 Agent Lifecycle
   ├── Registry
   ├── Version
   ├── Evaluation
   ├── Release
   └── Drift

09 Multi-Agent
   ├── Delegation
   ├── A2A
   ├── Trust Zone
   ├── Message Security
   └── Coordination

10 Governance
   ├── Audit
   ├── Model Risk
   ├── Human Oversight
   ├── Change Management
   └── Operational Resilience

11 Platform Economics
   ├── Cost
   ├── Latency
   ├── SLO
   ├── Capacity
   └── Vendor Concentration
```

这样会比继续增加几十篇“为什么 X 不应该 Y”更有价值：最终它会从一组文章变成一套**金融 Agent Architecture Taxonomy + Review Methodology**。

尤其值得注意的是，FSB 2026 的最新工作已经把 AI 治理从单个模型风险扩展到了 **AI adoption、third-party dependency、concentration、substitutability、lifecycle governance**；OCC/Fed 2026 的 revised model-risk guidance 又明确说明 GenAI / Agentic AI 本身仍在快速演进、现有 MRM guidance 尚未直接覆盖它们。这意味着你下一阶段最有价值的研究，很可能正是把传统金融治理模型与 Agent-specific control model 连接起来，而不是继续研究单个 Agent Framework 的 API。([Financial Stability Board][13])

### 最值得优先做的一条主线

我会把下面这个链条作为你后续研究的主轴：

```text
Identity
   ↓
Data Entitlement
   ↓
Context
   ↓
Agent / Skill
   ↓
Tool
   ↓
Policy
   ↓
Workflow
   ↓
Review
   ↓
Command
   ↓
Business State
   ↓
Audit Evidence
```

然后再横向叠加：

```text
Lifecycle
Security
Reliability
Evaluation
Human Oversight
Operational Resilience
Third-Party Risk
```

这样你现在已经写的文章基本都能自然落进去，而且不会继续产生大量“孤立的观点文章”。

[1]: https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/security.html?utm_source=chatgpt.com "Security - Agentic AI Lens"
[2]: https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentsec01.html?utm_source=chatgpt.com "Secure agent memory and state - Agentic AI Lens"
[3]: https://learn.microsoft.com/en-us/security/zero-trust/sfi/least-privilege-for-ai-agents?utm_source=chatgpt.com "Least privilege for AI agents with Microsoft Entra Agent ID | Microsoft Learn"
[4]: https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentsec02.html?utm_source=chatgpt.com "Secure agent tool usage - Agentic AI Lens"
[5]: https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentsec06.html "Secure multi-agent orchestration - Agentic AI Lens"
[6]: https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentops06.html "Testing, evaluation, and validation frameworks - Agentic AI Lens"
[7]: https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/design-principles.html "Design principles - Agentic AI Lens"
[8]: https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentsec02-bp01.html?utm_source=chatgpt.com "AGENTSEC02-BP01 Implement tool authorization - Agentic AI Lens"
[9]: https://learn.microsoft.com/en-us/security/zero-trust/sfi/manage-agentic-risk?utm_source=chatgpt.com "Reduce autonomous agentic AI risk | Microsoft Learn"
[10]: https://www.fsb.org/2025/10/monitoring-adoption-of-artificial-intelligence-and-related-vulnerabilities-in-the-financial-sector/ "Monitoring Adoption of Artificial Intelligence and Related Vulnerabilities in the Financial Sector - Financial Stability Board"
[11]: https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentops05.html?utm_source=chatgpt.com "Observability and monitoring for agentic systems - Agentic AI Lens"
[12]: https://www.bankofengland.co.uk/research/fintech/artificial-intelligence-consortium/frontier-ai-information-sharing-forum/frontier-ai-harness-engineering?utm_source=chatgpt.com "Frontier AI: Harness engineering | Bank of England – the UK's central bank"
[13]: https://www.fsb.org/2026/06/sound-practices-for-responsible-adoption-of-artificial-intelligence-ai-consultation-report/ "Sound Practices for Responsible Adoption of Artificial Intelligence (AI): Consultation report - Financial Stability Board"

01  金融服务领域 AI Agent Workflow 架构设计
02  AI Agent / Workflow / Policy / Domain 的职责边界
03  多人协作 + Human-in-the-loop 设计
04  Agent Authorization / Data Entitlement / Capability
05  Command / Approval / Idempotency 安全执行模型
06  AI Observability 与 Regulatory Audit Evidence
07  Financial Workflow DSL 与 Deterministic Runtime
08  AI Agent Architecture Review Checklist


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
从 Markdown 到 Workflow AST：为什么 Agent Workflow 可以用 DSL 表达
Financial Workflow DSL 的 Parser / Validator / Analyzer 三层设计
为什么 Workflow DSL 应该先 Parse，再 Validate，再 Analyze
Workflow Static Analysis：如何在运行前发现不可达节点和死流程
Agent Workflow DSL 的错误模型设计
Workflow Definition 的 Source Hash 与运行时一致性
Workflow Runner 如何实现单写者与 CAS
等待人工审批时，Workflow Runtime 应该如何持久化
Workflow Resume / Restart / Recovery 的正确设计
为什么 Workflow Runtime 不应该绑定 Copilot SDK
Agent Runtime Adapter：Copilot SDK / DeepAgents / LangGraph 如何替换
如何设计一个与 Agent Framework 无关的 Workflow Engine
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

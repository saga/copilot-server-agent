# Server-side Agent Runtime 与 IDE Agent Runtime 的架构差异

很多 Agent 框架都提供了类似的能力：

```text
LLM
↓
Tool Calling
↓
文件 / Shell / MCP
↓
Agent Loop
↓
完成任务
```

因此很容易产生一个直觉：

> IDE 里的 Agent 能运行，搬到服务器上不就是把进程放到 Kubernetes 里吗？

从“能不能跑”的角度看，确实可以。

从生产架构的角度看，这通常是不够的。

真正的区别并不是 **LLM 在哪里调用**，甚至也不是简单的 **本地 vs 云端**。现代 IDE 已经可以把 Agent Host 独立于编辑器窗口运行，Cloud Agent 也可以完全远程运行；同一个产品甚至同时支持 Local、Agent Host 和 Cloud 三种执行方式。VS Code 在 2026 年的文档中已经明确把“Agent harness”和“Session Target”分开：harness 决定 Agent 如何运行，target 决定它运行在哪里。

因此，更准确的问题是：

> **IDE Agent Runtime 与 Server-side Agent Runtime 面对的控制边界、生命周期、身份、状态、执行环境和人机交互模型有什么根本区别？**

答案可以先压缩成一句话：

> **IDE Agent Runtime 是“围绕一个开发者当前工作环境建立的交互式执行环境”；Server-side Agent Runtime 是“围绕多个用户、长期任务、隔离执行和企业治理建立的服务运行环境”。**

这两个 Runtime 可以共享同一个 Agent Harness、Skill、Tool 协议甚至 Agent Loop，但不能简单共享运行时假设。

---

# 一、首先要纠正一个概念：IDE、Harness、Runtime 不是一回事

今天的 Agent 产品通常至少包含三个不同概念：

```text
┌───────────────────────────────┐
│          User Surface         │
│ VS Code / Web / CLI / Mobile  │
└───────────────┬───────────────┘
                │
                ▼
┌───────────────────────────────┐
│          Agent Harness        │
│ prompt / context / tool loop  │
│ planning / subagents / skills │
└───────────────┬───────────────┘
                │
                ▼
┌───────────────────────────────┐
│          Agent Runtime        │
│ process / filesystem / shell  │
│ network / credentials / state │
└───────────────────────────────┘
```

过去，三个东西经常绑定在一起。

例如传统 IDE Agent：

```text
VS Code
  +
Copilot Chat
  +
本机 Extension Host
  +
本地 workspace
  +
本地 terminal
```

但现在已经明显分离。

VS Code 当前支持 Local、Copilot、Claude、Codex 以及 Cloud 等不同 target。Local harness 可以直接运行在 VS Code extension host；Copilot harness 可以运行在本机 Agent Host；Cloud target 则在远程基础设施运行。

GitHub Copilot SDK 也进一步把这种分离显式化：应用通过 SDK 连接到 headless Copilot CLI server，CLI server 管理 Agent Session；应用与 Agent Runtime 不必位于同一个进程甚至同一个容器。

所以：

```text
IDE Agent
≠
必须本地执行

Server Agent
≠
必须使用另一套 Agent Harness
```

真正发生变化的是：

```text
Runtime Boundary
```

---

# 二、IDE Agent Runtime 的本质：一个“人的工作环境”

IDE Agent Runtime 最重要的特点不是“低延迟”，而是：

> **它天然建立在一个已经存在的人类开发环境之上。**

这个环境通常包括：

```text
Developer
   │
   ├── IDE
   ├── Workspace
   ├── Git repository
   ├── Local files
   ├── Terminal
   ├── Language Server
   ├── Extensions
   ├── Dev containers
   ├── Credentials
   └── Local services
```

Agent 只是进入这个环境，替用户完成部分工作。

VS Code 对 Local harness 的定义非常典型：它运行在本机 extension host，直接使用当前 workspace，并可以使用 VS Code 内置工具、扩展提供的工具和 MCP。

VS Code 的 Agent Tool 文档也明确描述了典型循环：

```text
search files
   ↓
read files
   ↓
decide what to change
   ↓
edit files
   ↓
run tests
   ↓
inspect output
   ↓
continue / finish
```

工具调用结果直接成为下一轮 Agent context。

这意味着 IDE Runtime 有几个非常特殊的假设。

---

# 三、IDE Runtime 的第一个核心假设：Workspace 是天然存在的

对于 IDE Agent：

```text
cwd = 当前项目目录
```

这个目录通常已经包含：

```text
.git/
package.json
node_modules/
src/
tests/
.env
.vscode/
```

甚至已经运行着：

```text
localhost:3000
localhost:5432
localhost:8080
```

Agent 不需要创建整个工作环境。

它只需要：

```text
进入 workspace
↓
理解 workspace
↓
修改 workspace
```

因此很多 IDE Agent Tool 都可以非常简单：

```text
read_file(path)
edit_file(path)
run_terminal(command)
search_code(query)
```

工具中的 `path` 甚至可以直接对应用户机器上的路径。

---

# 四、Server Runtime 没有“天然 Workspace”

Server-side Agent 收到请求时，通常只有：

```json
{
  "user": "...",
  "task": "...",
  "session": "..."
}
```

它不天然拥有：

```text
/home/user/project
```

也不知道：

```text
这个 repository 是谁的？
这个目录属于哪个 tenant？
这个 workspace 是否可以被这个 user 读取？
```

所以 Server Runtime 必须显式建立 Workspace：

```text
Session
   ↓
Workspace Provisioner
   ↓
Git checkout / artifact mount
   ↓
Sandbox
   ↓
Agent Runtime
```

例如：

```text
User A
   ↓
Session A
   ↓
Sandbox A
   ├── repo A
   ├── /workspace
   ├── shell
   └── tools

User B
   ↓
Session B
   ↓
Sandbox B
   ├── repo B
   ├── /workspace
   ├── shell
   └── tools
```

这不是实现细节，而是 Server Runtime 的核心安全边界。

Amazon Bedrock AgentCore Runtime 当前就是这种设计：每个 user session 可以获得独立 microVM，并隔离 CPU、内存和 filesystem；session 结束后环境可以被销毁。AWS 同时明确指出，session 与真实用户之间的映射仍需要由调用方维护。

GitHub Copilot SDK 的多租户文档也明确警告：共享 Server Runtime 时不能使用带有 ambient host filesystem 的模式；多用户模式需要显式限制工具、Session 和文件系统访问。

因此：

> **IDE Runtime 把 Workspace 当作前提；Server Runtime 必须把 Workspace 当作资源。**

---

# 五、IDE Runtime 的第二个核心假设：用户就在旁边

IDE Agent 最大的架构优势其实是：

```text
Agent
  ↓
Tool call
  ↓
User sees it
  ↓
Approve / Reject
  ↓
continue
```

这让 Permission System 非常容易实现。

GitHub Copilot CLI 和 VS Code 都采用这种交互式 permission model。VS Code 可以针对工具调用弹出 approval；工具可以访问文件、修改环境或访问外部服务，并由 permission level 控制是否需要用户确认。

Anthropic Claude Code 也采用类似模式：Manual mode 下对编辑文件、运行某些命令等敏感操作要求用户批准；sandbox 则进一步限制 filesystem 和 network；用户和组织可以配置 allow/deny 规则。

OpenAI Codex 的本地 CLI / IDE 模式也是类似思想：Sandbox 决定 Agent 技术上能做什么，Approval Policy 决定什么情况下必须获得用户同意。

这在 IDE 中非常自然：

```text
Agent wants to run:

git push origin main

        ↓

┌─────────────────────────┐
│ Allow this action?      │
│                         │
│ git push origin main    │
│                         │
│   Allow / Reject        │
└─────────────────────────┘
```

但 Server Runtime 很快遇到一个问题：

> **“Ask the user”到底是谁？**

Server-side Agent 可能：

```text
凌晨 3 点
用户已经下线
浏览器已经关闭
任务仍在运行
```

因此 Server Runtime 的 Approval 不再是 UI 事件，而必须成为持久化业务状态：

```text
RUNNING
   ↓
WAITING_FOR_APPROVAL
   ↓
APPROVED / REJECTED
   ↓
RESUMED
```

这会直接把 Agent Runtime 与 Workflow / durable execution 联系起来。

---

# 六、IDE Runtime 的第三个核心假设：Session 生命周期很短

典型 IDE Agent：

```text
用户输入
↓
Agent loop
↓
几十轮 tool call
↓
完成
```

用户通常一直在等。

即使任务持续十分钟，也通常仍然属于：

```text
interactive session
```

因此 Runtime 可以有一个非常简单的控制模型：

```text
while (!done) {
    response = model(...)
    tool = response.toolCall
    result = execute(tool)
}
```

VS Code 的实际 Agent loop 也是类似结构：不断进行 tool-call rounds，同时维护 conversation/session transcript、tool results、hooks、subagent trace 等信息。

这并不意味着 IDE Agent 很简单。

而是它的**失败语义很简单**：

```text
Agent crashed
→ 用户可以重新运行

IDE closed
→ 用户可以继续

command failed
→ Agent 看结果继续

tool timeout
→ retry / ask user
```

---

# 七、Server Runtime 的 Session 不能等价于进程

Server-side Agent 最大的变化之一是：

> **Session ≠ Process。**

例如：

```text
Session A
   ↓
Agent process #17
   ↓
container #81
```

可能几分钟之后变成：

```text
Session A
   ↓
Agent process #42
   ↓
container #93
```

甚至可以完全换机器。

所以 Server Runtime 必须把：

```text
conversation
agent state
tool history
pending approval
workspace state
job state
```

与：

```text
process memory
```

分离。

这就是为什么生产 Agent 平台越来越强调：

```text
Session State
+
Persistent Store
+
Sandbox Lifecycle
```

而不是只把 Agent process 放进 Kubernetes。

LangChain 的 Deep Agents 现在也明确支持可插拔 filesystem backend、跨 thread persistence、human-in-the-loop，以及 LangGraph 的 durable execution 能力。

AWS AgentCore 同样明确区分 session context、ephemeral compute 和长期 Memory；默认 filesystem 可以只活在 session 的 compute 生命周期中，而需要跨 session 保留的数据应该进入持久化存储。

---

# 八、因此，Server Runtime 必须增加“状态平面”

IDE Runtime 可以近似：

```text
┌──────────────┐
│ IDE Process  │
├──────────────┤
│ Agent Loop   │
├──────────────┤
│ Workspace    │
├──────────────┤
│ Transcript   │
└──────────────┘
```

Server Runtime 通常需要：

```text
                      ┌─────────────────────┐
                      │    Control Plane    │
                      │                     │
                      │ auth                │
                      │ policy              │
                      │ session             │
                      │ job                 │
                      │ approval            │
                      │ quotas              │
                      └──────────┬──────────┘
                                 │
                                 ▼
                      ┌─────────────────────┐
                      │    Agent Runtime    │
                      │                     │
                      │ harness             │
                      │ model               │
                      │ tool loop           │
                      │ skills              │
                      └──────────┬──────────┘
                                 │
                                 ▼
                      ┌─────────────────────┐
                      │  Execution Sandbox  │
                      │                     │
                      │ filesystem          │
                      │ shell               │
                      │ browser             │
                      │ network             │
                      └─────────────────────┘
                                 │
              ┌──────────────────┼─────────────────┐
              ▼                  ▼                 ▼
         State Store        Artifact Store     Audit Store
```

这已经不是 IDE 插件架构了。

---

# 九、最大的架构差异其实是“身份”

IDE Agent 通常可以采用：

```text
Agent = User
```

或者非常接近：

```text
Agent process
   ↓
OS user
   ↓
developer permissions
```

OpenAI 对 Codex 本地模式的描述就是：Codex 在开发者电脑上运行，并默认以真实用户权限运行；因此必须使用 OS-level sandbox 等机制限制其行为。

对于 Server Runtime，这种模型通常不成立。

服务器上可能有：

```text
1 个 Agent Runtime
1000 users
20 tenants
多个 business domains
```

不可能：

```text
Agent
 ↓
server service account
 ↓
所有数据
```

因此必须变成：

```text
Human Identity
      ↓
Session Identity
      ↓
Agent Identity
      ↓
Tool Identity
      ↓
Resource Authorization
```

例如：

```text
alice
 ↓
session-123
 ↓
agent:investment-research
 ↓
tool:portfolio.read
 ↓
portfolio:ABC
```

而不是简单：

```text
agent-service-account
 ↓
SELECT *
```

这也是 AgentCore 的 session isolation、IAM、credential vending、resource policies 等设计成为 Server Runtime 一等公民的原因。

---

# 十、IDE Runtime 的权限通常是“用户确认型”

```text
Can agent do X?

→ Ask user
```

Server Runtime 更适合：

```text
Can agent do X?

→ Policy Engine
→ Authorization
→ Risk policy
→ Approval state
```

于是最终变成：

```text
                Agent proposes action
                         │
                         ▼
                ┌─────────────────┐
                │ Policy Decision │
                └────────┬────────┘
                         │
          ┌──────────────┼───────────────┐
          ▼              ▼               ▼
        ALLOW         APPROVAL          DENY
          │              │               │
          ▼              ▼               ▼
        execute       wait            stop
```

这与前面的 IDE approval 有相似之处，但架构含义完全不同。

IDE approval：

```text
UI interaction
```

Server approval：

```text
durable business state
```

---

# 十一、IDE Runtime 可以把 Tool 当“机器能力”

IDE 中的 Tool 很多就是：

```text
readFile
editFile
terminal
git
search
browser
```

甚至 VS Code 官方工具体系就是围绕：

```text
built-in tools
MCP tools
extension tools
```

组织的。

Server Runtime 则需要问：

```text
这个 Tool 是谁的？
它访问哪个系统？
Credential 属于谁？
能访问哪个 tenant？
执行是否审计？
并发多少？
失败怎么重试？
谁有权取消？
```

因此 Server Tool 的实际模型更接近：

```text
Tool Definition
+
Tool Identity
+
Authorization
+
Credential
+
Rate Limit
+
Audit
+
Timeout
+
Retry
+
Idempotency
```

这也是为什么企业 Server Agent 平台最终往往需要独立的 Tool Gateway / MCP Gateway。

---

# 十二、MCP 在 IDE 和 Server 中的含义也不一样

IDE 中：

```text
VS Code
  ↓
MCP server
  ↓
localhost / local process
```

很常见。

Server 中：

```text
Agent Runtime
   ↓
Tool Gateway
   ↓
MCP Server
   ↓
Enterprise API
```

此时 MCP 已经不是简单的“扩展机制”，而更接近：

```text
Agent ↔ Enterprise capability interface
```

VS Code 官方文档也明确指出 MCP server 可以本地运行，也可以远程托管；其用途包括连接数据库、API 和其他外部服务。

而 AWS AgentCore Gateway 则进一步把现有 API、Lambda 和 MCP server 转换成可以受治理的 Agent Tool Endpoint。

因此：

> **IDE Runtime 更强调 Tool availability；Server Runtime 更强调 Tool governance。**

---

# 十三、为什么 Server Runtime 必须考虑多租户

IDE 通常是：

```text
one machine
→ one developer
```

Server 则很容易变成：

```text
one cluster
→ thousands of users
```

这时最重要的问题不再只是：

```text
Agent 会不会误删文件？
```

还包括：

```text
Agent A 能不能看到 Agent B 的文件？
Session A 能不能恢复 Session B？
Tenant A 的 MCP credential 会不会进入 Tenant B？
一个 Agent 的 shell 能不能访问 host filesystem？
```

GitHub 的 Copilot SDK Server 文档已经明确给出了这种考虑：多用户服务必须使用受控的 `mode: "empty"` 等方式，避免 ambient host filesystem 和默认工具集合；Session state 还必须与调用方自己的 tenant/user boundary 结合起来。

它甚至提供了一个 server-session sample：每个用户使用独立 session、虚拟 filesystem 和 virtual bash，并明确声明该 sample 本身不是生产部署方案，因为还缺少完整的 auth 和隔离措施。

这很好地说明了一个事实：

> **把 CLI Agent “包成 HTTP API”不等于已经有 Server Runtime。**

---

# 十四、Server Runtime 必须处理“长任务”

IDE Agent 最常见：

```text
request
→ run
→ response
```

Server Agent 很容易变成：

```text
request
→ start job
→ run for 30 minutes
→ wait external system
→ ask approval
→ resume
→ run again
→ generate artifact
→ notify user
```

此时 API：

```http
POST /agent/run
```

不够用了。

应该至少有：

```text
POST /sessions
POST /runs
GET  /runs/{id}
POST /runs/{id}/cancel
POST /runs/{id}/resume
POST /approvals/{id}
GET  /runs/{id}/events
```

这实际上意味着：

> **Server Agent Runtime 开始接近一个 Job Runtime / Workflow Runtime。**

但这里必须注意一个架构边界：

```text
Agent Runtime
```

负责：

```text
模型循环
工具调用
上下文管理
```

而：

```text
Workflow Runtime
```

负责：

```text
业务状态
等待
恢复
审批
超时
重试
补偿
```

两者不应该混成一个东西。

---

# 十五、Server Runtime 的“等待”与 IDE Runtime 完全不同

IDE Agent：

```text
需要批准？
↓
弹 UI
↓
用户点击
↓
继续
```

Server Agent：

```text
need approval
↓
persist checkpoint
↓
release compute
↓
notify user
↓
user approves
↓
resume session
↓
reconstruct runtime
↓
continue
```

所以 Server Runtime 必须支持：

```text
Pause
Persist
Resume
Rehydrate
```

这也是为什么 durable execution、checkpoints、interrupts、persistent state 会逐渐成为 Server Agent 架构的重要组成部分。

Deep Agents 当前已经通过 LangGraph 能力提供 human-in-the-loop 和 interrupt-style workflows，并且 filesystem 可以接入 durable stores。

---

# 十六、Server Runtime 的失败模型完全不同

IDE 中：

```text
terminal failed
```

通常只是一次 tool error。

Server 中：

```text
container died
network timeout
pod evicted
node crashed
MCP unavailable
LLM timeout
database unavailable
user disconnected
approval expired
```

都可能发生。

因此 Server Runtime 必须区分：

```text
Agent failure
Tool failure
Runtime failure
Infrastructure failure
Business failure
Policy failure
```

例如：

```text
Tool:
submit_order()

Infrastructure timeout
        ↓
Did the order execute?
        ↓
UNKNOWN
```

这时 Agent 不能简单：

```text
retry submit_order()
```

因为可能产生 duplicate side effect。

所以 Server Runtime 必须与：

```text
idempotency
execution ledger
tool transaction semantics
```

配合。

这也是企业 Agent 平台与“本地 coding agent”开始出现明显架构分界的地方。

---

# 十七、IDE 中“重新运行”与 Server 中“恢复”不是一回事

IDE：

```text
重新执行 prompt
```

通常还能接受。

Server：

```text
resume run
```

要求：

```text
exact state
+
exact pending tool call
+
authorization state
+
business state
+
workspace state
```

因此需要记录：

```text
Run
 ├── run_id
 ├── session_id
 ├── agent_version
 ├── skill_version
 ├── model
 ├── prompt/context version
 ├── tool calls
 ├── tool results
 ├── policy decisions
 ├── approvals
 ├── artifacts
 └── checkpoint
```

否则：

```text
resume
```

实际上只是：

```text
start a new agent
```

而不是恢复。

---

# 十八、Server Runtime 的 Workspace 也更接近 Sandbox

OpenHands 的 runtime architecture 是一个非常典型的研究与工程案例。

它把 Agent 与执行环境分开：

```text
Agent
   ↓
Event Stream
   ↓
Action Executor
   ↓
Sandbox
      ├── Browser
      ├── Bash
      ├── Plugins
      └── Jupyter
```

Sandbox 使用 Docker，可以隔离文件系统和任意代码执行。

SWE-agent 也把 Agent 与 `SWEEnv` 分开，Agent 产生 action，Environment 在 Docker / remote deployment 中执行 shell，并维护长期 shell session。

这两个项目说明：

> **Software Agent 的“运行环境”本身已经成为一个独立架构组件。**

IDE Runtime 可以借助开发者自己的 OS。

Server Runtime 通常不能这么做。

---

# 十九、真正成熟的 Server Runtime 应该有三层，而不是一层 Container

一个常见错误是：

```text
Agent Pod
  ├── FastAPI
  ├── Agent
  ├── Shell
  ├── MCP
  └── Filesystem
```

然后认为：

```text
部署到 Kubernetes = Production Agent Runtime
```

这通常不够。

更合理的是：

```text
                    Control Plane
 ┌────────────────────────────────────────────┐
 │                                            │
 │ Identity / Auth                            │
 │ Session Manager                           │
 │ Policy / Entitlement                      │
 │ Job / Workflow                            │
 │ Approval                                  │
 │ Quota / Cost                              │
 │ Audit                                     │
 │ Agent / Skill Version                     │
 │                                           │
 └──────────────────────┬─────────────────────┘
                        │
                        ▼
                 Agent Runtime
 ┌────────────────────────────────────────────┐
 │ Agent Harness                             │
 │                                            │
 │ LLM Loop                                  │
 │ Context Manager                           │
 │ Skill Loader                              │
 │ Tool Router                               │
 │ Subagents                                 │
 │ Memory                                    │
 └──────────────────────┬─────────────────────┘
                        │
                        ▼
                 Execution Plane
 ┌────────────────────────────────────────────┐
 │ Sandbox                                   │
 │                                            │
 │ Workspace                                 │
 │ Shell                                     │
 │ Browser                                   │
 │ Code execution                            │
 │ Network                                   │
 │ Secrets                                   │
 └────────────────────────────────────────────┘
```

这是 Server-side Runtime 与 IDE Runtime 最重要的结构差异之一。

---

# 二十、IDE Runtime 更强调“上下文丰富”

IDE Agent 很容易获得：

```text
当前文件
当前 selection
open tabs
diagnostics
terminal
git diff
workspace symbols
language server
editor state
```

这些信息对于 coding agent 非常有价值。

VS Code 当前 Agent Tool API 也明确把编辑器工具、extension tools、MCP tools 纳入同一 Agent Loop。

这意味着：

```text
IDE Agent context
=
开发者当前工作的“即时上下文”
```

Server Agent 通常没有这些东西。

它更适合：

```text
repository
database
documents
APIs
business systems
long-term memory
enterprise search
```

所以 Server Agent 的 Context Architecture 通常应该从：

```text
editor context
```

转向：

```text
task context
+
business context
+
retrieval context
+
tool context
+
persistent state
```

这不是简单增加一个 RAG。

---

# 二十一、因此“把 IDE Agent 搬到 Server”最容易犯的错误之一就是过度模拟 IDE

例如把 Server Runtime 做成：

```text
Agent
↓
virtual filesystem
↓
virtual terminal
↓
virtual VS Code
```

然后所有 Agent 都在模拟：

```text
/home/user/project
```

对于 coding agent 很合理。

但对于：

```text
Investment Research Agent
Proxy Voting Agent
Client Service Agent
Compliance Agent
Operations Agent
```

就可能开始出现错误建模。

这些 Agent 的天然工作空间不是：

```text
files
```

而是：

```text
Case
Customer
Portfolio
Fund
Meeting
Document
Approval
Workflow
```

因此 Server Runtime 的 Workspace 不应该总是：

```text
filesystem
```

更广义的定义应该是：

> **Task execution context**

可以由：

```text
Filesystem
+
Database
+
Document store
+
Business APIs
+
Memory
+
Artifacts
```

组成。

---

# 二十二、Copilot SDK 是一个很有代表性的“桥接案例”

GitHub Copilot SDK 当前的架构非常值得研究，因为它不是重新实现一个 Agent，而是把 Copilot CLI 的 Agent harness 暴露给应用。

官方架构是：

```text
Application
   ↓
SDK Client
   ↓ JSON-RPC
Copilot CLI Server
   ↓
Agent Session
   ↓
Model / Tools
```

SDK 既支持：

```text
local CLI
```

也支持：

```text
headless server
```

还支持：

```text
remote sessions
cloud sessions
plugins
skills
hooks
custom agents
fleet mode
```

它特别说明了一个重要事实：

> **Agent Harness 可以复用，但 Runtime Context 不能默认复用。**

例如 SDK 的 plugin directory 可以同时包含：

```text
skills
hooks
MCP servers
custom agents
LSP
```

但 Server 部署仍然需要：

```text
session isolation
tool allowlist
filesystem isolation
tenant mapping
auth
```

因此“在 Server 上跑 Copilot SDK”并不意味着：

```text
Server = VS Code
```

而是：

```text
Server
+
Copilot Harness
+
Server-side Runtime Controls
```

---

# 二十三、VS Code 当前产品其实已经在走这条路

VS Code 2026 年的 Agent Harness 文档已经把架构分成：

```text
Local
Copilot
Claude
Codex
Cloud
```

并明确区分：

```text
Where harness runs
Where tools run
Where code exists
How permissions work
```

例如：

| Target  | Tool 执行位置             | Code                              |
| ------- | --------------------- | --------------------------------- |
| Local   | extension host        | 当前 workspace                      |
| Copilot | Agent Host            | folder / worktree / Dev Container |
| Claude  | local machine         | folder / worktree                 |
| Codex   | local machine         | folder / worktree                 |
| Cloud   | remote infrastructure | GitHub repo / PR                  |

这个产品形态本身就是一个很好的证明：

> **未来 Agent Architecture 不应该以“IDE Agent”或“Server Agent”作为二元划分，而应该以 Runtime Target 作为抽象。**

---

# 二十四、Cloud Coding Agent 又是第三种形态

GitHub Copilot cloud agent 很典型。

它不是传统 IDE Agent：

```text
用户
↓
编辑器
↓
Agent
```

而是：

```text
Issue / Prompt
   ↓
Cloud Agent
   ↓
Ephemeral Environment
   ↓
Repository
   ↓
Code Changes
   ↓
Tests
   ↓
Branch
   ↓
Pull Request
```

GitHub 明确说明 cloud agent 会在 GitHub Actions 驱动的 ephemeral development environment 中工作，能够探索 repository、修改代码、执行 tests 和 linters；默认还有网络 firewall，并支持配置 self-hosted runner。

这比 IDE Agent 更像：

```text
Server-side task executor
```

而不是：

```text
interactive editor companion
```

因此它的产物也不同：

IDE：

```text
edit current workspace
```

Cloud Agent：

```text
branch + test results + pull request
```

这其实代表了 Agent Runtime 从：

```text
assistant
```

向：

```text
worker
```

的变化。

---

# 二十五、OpenAI Codex 也明确呈现了 Local / Cloud 双 Runtime

Codex 很适合用来观察这个边界。

本地 Codex：

```text
IDE / CLI
↓
local sandbox
↓
local workspace
```

云端 Codex：

```text
Cloud task
↓
isolated container
↓
repository
↓
tests / commands
↓
diff / PR
```

OpenAI 的 Codex 安全文档明确区分本地与云端 sandbox：本地 CLI / IDE 依靠操作系统机制限制工作目录、网络和权限；Cloud 则运行在 OpenAI 管理的隔离环境中。

更进一步，OpenAI 在 2026 年 9 月推出 Agents API 后，已经直接把 Codex harness 与 sandbox infrastructure 暴露给服务器端 Agent 应用，并允许开发者选择 OpenAI-managed sandbox、自有基础设施或第三方 sandbox provider。

这再次证明：

```text
Agent Harness
```

和：

```text
Execution Environment
```

可以分别演进。

---

# 二十六、OpenAI Agents SDK 也说明了 Server Runtime 的额外能力

OpenAI Agents SDK 当前明确把：

```text
Sessions
Human-in-the-loop
Guardrails
Tracing
MCP
```

作为 Runtime capability，并区分 SDK managed runtime 与自己控制 loop/state 的模式。

它的 tracing 记录：

```text
LLM generations
tool calls
handoffs
guardrails
custom events
```

而 server runtimes 默认启用 tracing。

其 tool guardrails 还可以在 tool execution 前后进行检查，并阻止执行。

这说明 Server Runtime 的运行记录越来越不应该只是：

```text
application log
```

而应该是：

```text
Agent Trace
   ├── model call
   ├── tool proposal
   ├── policy
   ├── approval
   ├── tool execution
   ├── tool result
   └── final outcome
```

---

# 二十七、金融服务为什么会放大这种差异？

金融服务的问题并不是：

```text
LLM 是否聪明
```

而是：

```text
Agent 到底代表谁？
Agent 能访问什么？
Agent 能做什么？
谁批准了？
执行了什么？
为什么允许？
出了问题能不能停止？
```

FINRA 在 2026 年关于 GenAI Agents 的监管观察中明确提出几个值得注意的问题：

```text
Autonomy
Scope and Authority
Auditability and Transparency
```

并建议关注：

```text
agent system access
data handling
human-in-the-loop
agent actions and decisions
guardrails / control mechanisms
```

这其实非常接近 Server Runtime 的设计问题。

因为这些问题不能靠 IDE 的：

```text
“Please press Allow”
```

来解决。

---

# 二十八、金融监管机构也特别关注 Agent 的运行边界

英国央行 2026 年 Financial Stability Report 指出，Agentic AI 可以以机器速度执行多步骤任务，并且在金融市场中目前的应用更多集中在 research、coding support、surveillance 等相对低风险场景，而对更高风险的自主金融决策，挑战之一就是如何预测、验证和约束系统行为，并确保监管者拥有足够的可见性和干预能力。

FSB 2026 年关于金融机构负责采用 AI 的 consultation report 也把 AI adoption 的治理和 guardrails 放到机构级 AI lifecycle 中讨论。

这些讨论都说明：

> Server-side Agent 不只是“把 Agent 放到云里”，而是把 Agent 纳入企业运行控制体系。

---

# 二十九、真实案例：MRH Trowe 的方向非常接近 Server Runtime

AWS 在 2026 年 9 月公开介绍了德国商业和工业保险经纪公司 MRH Trowe 的案例。

其目标不是让员工在自己的电脑上单独运行一个 AI Agent，而是给约 400 名员工提供受治理的 self-service AI agents；架构结合 Strands Agents、Amazon Bedrock AgentCore 和 LibreChat，并特别强调安全、数据驻留、合规和成本透明。AWS 报告称该体系在上线第一个月达到约 400 名员工的生产使用规模。

这个案例值得注意的不是具体 vendor，而是需求结构：

```text
many users
+
internal systems
+
sensitive client data
+
central governance
+
auditability
+
data residency
```

这已经明显不同于：

```text
developer
+
local repo
+
local terminal
```

---

# 三十、真实案例：AWS 金融服务 Multi-Agent 架构

AWS 在 2026 年介绍金融服务 Multi-Agent Systems 时，给出的 reference architecture 是：

```text
financial advisor
       ↓
orchestrator
       ├── portfolio agent
       ├── risk agent
       ├── market research agent
       └── advisor agent
```

部署在：

```text
Amazon EKS
+
Amazon Bedrock
+
AgentCore
```

并把认证、tracing、cost control 和 sandboxed code execution 作为架构的一部分。

这代表一个非常重要的趋势：

> Server-side Agent Runtime 最终往往不是“一个 Agent Pod”，而是一个能够管理多个 Agent、多个 tool、多个 session 的 execution platform。

---

# 三十一、真实案例：Bank of America 的 Erica 更能说明“运行时不等于聊天窗口”

Bank of America 从 2018 年开始运行 Erica，到 2025 年已经扩展到客户服务、财富管理、员工场景等多个领域。Bank of America 公开表示，2025 年第四季度 Erica 被使用近 2 亿次，并且相关 AI 能力已经覆盖多个业务领域。

2026 年推出的 EricaAssist 则进一步作为 human-assisted AI agent 支持超过 18,000 名员工，在客户服务通话过程中实时提供上下文和指导。

这种系统的架构重点显然不是：

```text
一个漂亮的 Chat UI
```

而是：

```text
Enterprise Identity
+
Business Context
+
AI
+
Human Interaction
+
Operational Controls
+
Scalability
```

也就是 Server Runtime 所面对的问题。

---

# 三十二、Server-side Runtime 最关键的不是“更强”，而是“可治理”

可以把两种 Runtime 放在一起：

| 维度             | IDE Agent Runtime     | Server-side Agent Runtime             |
| -------------- | --------------------- | ------------------------------------- |
| 主要用户           | 单个开发者                 | 多用户 / 团队 / 系统                         |
| Workspace      | 当前开发目录                | 显式 provisioned workspace              |
| Identity       | 通常接近 OS/user identity | human / tenant / agent / tool 多层身份    |
| Tool           | 本地能力丰富                | 受治理的 enterprise capability            |
| Permission     | 用户实时确认                | Policy + Approval + Authorization     |
| Session        | interactive           | persistent / resumable                |
| State          | 本地 session + Git      | durable state + artifact + checkpoint |
| Compute        | 用户机器                  | sandbox / container / microVM         |
| Filesystem     | 本机 workspace          | session-scoped isolated filesystem    |
| Network        | 本机网络策略                | tenant / egress / allowlist           |
| Secrets        | developer environment | credential vending / secret manager   |
| Failure        | 重新执行通常可接受             | retry / resume / idempotency          |
| Concurrency    | 通常较低                  | 高并发、多租户                               |
| Observability  | debugging-oriented    | operational + audit-oriented          |
| Human approval | UI dialog             | durable approval state                |
| Cost           | 用户级                   | service-level / tenant-level quota    |
| Lifecycle      | 用户控制                  | platform controlled                   |
| Artifact       | workspace/git diff    | artifact store / branch / case        |
| Main boundary  | developer workspace   | tenant + session + sandbox            |

这张表其实就是两种 Runtime 的架构分水岭。

---

# 三十三、因此不要把 IDE Runtime 直接“容器化”

一个常见迁移路线是：

```text
VS Code Agent
      ↓
Docker
      ↓
Kubernetes
      ↓
Server Agent
```

这种做法只解决：

```text
where process runs
```

没有解决：

```text
who owns session
who owns workspace
who can access tool
who approves action
how state resumes
how tenant is isolated
how long job runs
what gets audited
```

更合理的迁移路线是：

```text
IDE Agent Harness
       │
       ▼
Extract Runtime Contract
       │
       ├── Session
       ├── Workspace
       ├── Tool
       ├── Identity
       ├── Policy
       ├── State
       └── Artifact
       │
       ▼
Server Agent Runtime
       │
       ├── Control Plane
       ├── Harness
       └── Sandbox
```

也就是说：

> **先抽象 Runtime Contract，再移动进程。**

---

# 三十四、对于企业 Agent 平台，建议把 Runtime API 定义清楚

一个合理的 Server Agent Runtime 至少应该有：

```typescript
interface AgentRuntime {
  createSession(input: CreateSessionInput): Promise<Session>;

  startRun(input: StartRunInput): Promise<Run>;

  sendMessage(runId: string, input: Message): Promise<void>;

  approve(requestId: string): Promise<void>;

  reject(requestId: string): Promise<void>;

  cancel(runId: string): Promise<void>;

  resume(runId: string): Promise<Run>;

  getState(runId: string): Promise<RunState>;

  listEvents(runId: string): AsyncIterable<AgentEvent>;

  collectArtifacts(runId: string): Promise<Artifact[]>;
}
```

内部则：

```text
Session
   ↓
Run
   ↓
Agent Loop
   ↓
Tool Proposal
   ↓
Policy
   ↓
Tool Execution
   ↓
Observation
   ↓
Next Turn
```

这样 Agent Harness 就不会和 HTTP Server 强耦合。

---

# 三十五、Skill 也应该因此区分“IDE Skill”和“Server Skill”

IDE Skill 很容易写：

```markdown
1. Inspect the current workspace.
2. Run the tests.
3. Edit the files.
4. Check git diff.
5. Ask the user before pushing.
```

Server Skill 更适合：

```markdown
1. Resolve the task workspace.
2. Retrieve required business context.
3. Inspect relevant artifacts.
4. Propose actions.
5. Use approved tools only.
6. Do not infer authorization.
7. If approval is required, persist the run and wait.
8. Resume only after the approval state changes.
9. Record evidence and artifacts.
```

这不是把 Skill 写得更复杂，而是因为 Runtime 已经变了。

---

# 三十六、最重要的架构边界：Agent Runtime 不应该拥有 Business State

这是企业 Server Agent 最容易犯的错误之一。

不要让：

```text
Agent Memory
```

承担：

```text
Case status
Approval status
Trade status
Vote status
Payment status
```

应该：

```text
Business Domain State
        ↓
Workflow / Domain Service
        ↓
Agent
```

Agent 可以知道：

```text
Case #123
status = WAITING_APPROVAL
```

但不应该因为自己的 memory 里记着：

```text
“上次已经批准了”
```

就认为当前仍然可以执行。

否则 Server Runtime 会出现一个严重问题：

```text
Agent Memory
≠
Business Truth
```

这在 IDE 场景通常没有那么明显，因为 IDE Agent 的主要状态就是：

```text
workspace
conversation
git
```

而企业 Server Agent 的状态必须回到：

```text
system of record
```

---

# 三十七、同样的原因也解释了为什么 Audit 不能只依赖 Agent Transcript

IDE 中：

```text
conversation transcript
```

已经很有价值。

Server-side financial Agent 则至少需要：

```text
User
Agent
Session
Run
Model
Prompt / Skill version
Tool
Tool input
Policy decision
Approval
Tool result
Business object
Artifact
Final outcome
```

例如一次高风险操作应该可以回答：

```text
谁发起？
↓
哪个 Agent？
↓
使用哪个 Skill？
↓
读了什么？
↓
产生了什么 Proposal？
↓
Policy 为什么 allow？
↓
谁批准？
↓
实际执行了什么？
↓
执行结果是什么？
```

FINRA 对 Agent 的监管观察恰好把“system access/data handling”“human oversight”“agent actions and decisions”“guardrails”列为需要关注的内容。

这意味着：

> **Server Runtime 的 observability 应该是 control evidence，而不只是 developer debugging。**

---

# 三十八、但是不要把所有 IDE 能力都搬到 Server

Server Agent 并不一定需要：

```text
open tabs
cursor position
selected text
editor decorations
language server UI
mouse / keyboard
```

反过来，IDE Agent 也不应该强行承担：

```text
tenant scheduling
durable jobs
cross-user orchestration
enterprise policy
multi-hour background execution
central audit
billing / quota
```

因此最合理的设计不是：

```text
IDE Runtime + Server Features
```

而是：

```text
Shared Agent Harness
        │
        ├──────────────┐
        ▼              ▼
 IDE Runtime      Server Runtime
        │              │
        ▼              ▼
Editor Context    Business Context
Local Workspace   Tenant Workspace
Interactive HITL  Durable Approval
OS Sandbox        Managed Sandbox
Local Identity    Enterprise Identity
Git-centric       Domain-centric
```

---

# 三十九、一个更准确的统一模型：Agent Harness + Runtime Adapter

如果希望一个 Agent 同时服务：

```text
VS Code
CLI
Web
Server
Cloud
```

不要让 Skill 直接调用：

```text
local filesystem
local shell
local terminal
```

而应该定义抽象 Capability：

```text
Workspace
Shell
FileStore
Search
Browser
Git
Database
HTTP
Approval
Artifact
Identity
```

然后：

```text
IDE Runtime Adapter
   ↓
local filesystem
local terminal
local git
VS Code APIs
```

Server Runtime Adapter：

```text
sandbox filesystem
remote shell
workspace service
Git service
enterprise APIs
policy service
artifact store
```

Agent Harness 看到的是：

```text
readFile()
writeFile()
execute()
search()
requestApproval()
```

而不是：

```text
/path/on/macbook
```

这样才能真正做到：

```text
same Skill
same Agent
different Runtime
```

---

# 四十、这其实就是 Copilot SDK、OpenHands 和 AgentCore 正在共同验证的方向

虽然这些项目的实现不同，但可以观察到相似的架构趋势。

Copilot SDK：

```text
Harness
+
Session
+
Skills
+
Hooks
+
MCP
+
Server mode
+
Cloud sessions
```

OpenHands：

```text
Agent
+
Agent Server
+
Sandbox Runtime
+
REST/WebSocket
+
Local/Remote execution
```

AWS AgentCore：

```text
Agent
+
isolated Session
+
microVM
+
Identity
+
Memory
+
Gateway
+
Observability
```

OpenAI：

```text
Agent Harness
+
Sandbox
+
Sessions
+
Tools
+
Guardrails
+
Tracing
```

并进一步把 Codex harness 提供给 Server-side Agents API。

这些并不能证明存在一个唯一正确的 Agent Runtime 架构，但它们共同体现出一个趋势：

> **Agent Harness 和 Execution Runtime 正在逐渐解耦。**

---

# 四十一、最终架构应该怎么选？

可以用一个简单的决策表。

| 场景                      | 推荐 Runtime                       |
| ----------------------- | -------------------------------- |
| 修改当前代码                  | IDE Runtime                      |
| 实时调试                    | IDE Runtime                      |
| 当前 workspace 内快速重构      | IDE Runtime                      |
| 需要 editor context       | IDE Runtime                      |
| 用户实时观察每一步               | IDE Runtime                      |
| GitHub Issue 自动修复       | Cloud / Server Runtime           |
| CI/CD Agent             | Server Runtime                   |
| 多用户共享 Agent             | Server Runtime                   |
| 长时间运行任务                 | Server Runtime                   |
| 后台任务                    | Server Runtime                   |
| 企业系统操作                  | Server Runtime                   |
| 金融业务 Agent              | Server Runtime                   |
| 跨系统 workflow            | Server + Workflow                |
| 高风险业务动作                 | Server + Policy + Workflow       |
| 本地开发 Agent              | IDE Runtime                      |
| 同一 Agent 同时服务 IDE 和 Web | Shared Harness + Runtime Adapter |

---

# 四十二、对于金融服务，建议进一步采用“双 Runtime”而不是二选一

对于企业内部平台，一个很实际的架构通常是：

```text
                    Shared Agent Definition
                              │
                ┌─────────────┴─────────────┐
                │                           │
                ▼                           ▼
          IDE Runtime                Server Runtime
                │                           │
       developer context             enterprise context
       local workspace               governed workspace
       local tools                   enterprise tools
       interactive approval           policy / workflow
                │                           │
                └─────────────┬─────────────┘
                              │
                     Shared Governance
                              │
                    ┌─────────┼─────────┐
                    ▼         ▼         ▼
                  Policy    Skills    Audit
```

这样：

```text
IDE
```

负责：

```text
快速、交互式、贴近开发者
```

Server：

```text
规模化、治理、长任务、跨系统
```

而：

```text
Skill
Tool Definition
Policy
Evaluation
```

尽可能共享。

---

# 四十三、真正应该共享的不是 Runtime，而是“Agent Contract”

如果一个团队既要有 IDE Agent，又要有 Server Agent，最应该标准化的是：

```text
Agent Contract
```

包括：

```text
Input schema
Output schema
Tool contract
Skill contract
Identity contract
Policy contract
Artifact contract
Event contract
State contract
```

而不是：

```text
“所有环境都运行同一个 Node process”
```

例如：

```typescript
interface AgentContract {
  input: InputSchema;
  output: OutputSchema;

  capabilities: Capability[];

  skills: SkillRef[];

  tools: ToolRef[];

  policy: PolicyRef[];

  events: EventSchema[];

  artifacts: ArtifactSchema[];
}
```

然后：

```text
IDE Runtime
```

实现：

```text
interactive execution
```

Server Runtime：

```text
durable execution
```

Cloud Runtime：

```text
asynchronous execution
```

这才是真正可扩展的架构。

---

# 四十四、最终结论

Server-side Agent Runtime 与 IDE Agent Runtime 的差异，不能概括成：

```text
IDE = local
Server = remote
```

这个定义已经过时。

更准确的区别是：

```text
IDE Runtime
=
Interactive User Environment

Server Runtime
=
Governed Agent Execution Environment
```

IDE Runtime 可以依赖：

```text
当前用户
当前 workspace
当前机器
当前 IDE
实时 approval
```

Server Runtime 则必须主动提供：

```text
Identity
Tenant Isolation
Session Lifecycle
Workspace Provisioning
Sandbox
Policy
Authorization
Approval State
Durable State
Tool Governance
Secrets
Quota
Observability
Audit
Recovery
```

因此二者最大的架构差异不是 Agent Loop。

实际上，两者的 Agent Loop 可能几乎完全一样：

```text
LLM
↓
Tool Call
↓
Tool Result
↓
LLM
↓
Tool Call
```

真正发生变化的是 Agent Loop **外面那一圈**：

```text
               IDE
                │
     ┌──────────┴──────────┐
     │                     │
     │   Agent Harness     │
     │                     │
     └──────────┬──────────┘
                │
       Local Runtime
                │
      User / Workspace
```

而 Server：

```text
                 Server
                   │
        ┌──────────┴──────────┐
        │    Control Plane    │
        │                     │
        │ Identity            │
        │ Policy              │
        │ Session             │
        │ Workflow            │
        │ Approval            │
        │ Audit               │
        └──────────┬──────────┘
                   │
            Agent Harness
                   │
        ┌──────────┴──────────┐
        │   Execution Plane   │
        │                     │
        │ Sandbox             │
        │ Workspace           │
        │ Tools               │
        │ Network             │
        └─────────────────────┘
```

所以真正成熟的企业 Agent 平台，尤其是金融服务场景，不应该问：

> “怎样把 IDE Agent 原封不动搬到服务器？”

应该问：

> **“哪些 Agent Harness 能力应该共享，哪些 Runtime 假设必须被抽象掉，哪些控制能力必须由 Server Control Plane 接管？”**

最终比较合理的目标是：

```text
             Shared Agent Harness
                      │
       ┌──────────────┼──────────────┐
       │              │              │
       ▼              ▼              ▼
   IDE Runtime    Server Runtime   Cloud Runtime
       │              │              │
   Developer      Enterprise      Autonomous
   Workspace      Workspace       Workspace
       │              │              │
       └──────────────┼──────────────┘
                      │
                Shared Governance
                      │
          Policy / Identity / Audit
```

**IDE Runtime 追求的是“人在场时让 Agent 高效工作”；Server Runtime 追求的是“人在不在场，Agent 仍然能够在明确的身份、权限、状态、隔离和审计边界内可靠工作”。**

这就是两者真正的架构分界。

---

# 参考资料

1. **Visual Studio Code — Choose and use an agent harness**
   2026 年 VS Code 官方文档，明确区分 Local、Copilot、Claude、Codex 和 Cloud target，以及 harness、runtime location、workspace 和 permission。

   [VS Code Agent Harness 文档](https://github.com/microsoft/vscode-docs/blob/main/docs/agents/run/agent-harnesses.md?utm_source=chatgpt.com)

2. **Visual Studio Code — Understand tools in AI agents**
   说明 Agent Tool Loop、Built-in tools、MCP、Extension tools 和工具审批模型。

   [VS Code Agent Tools 文档](https://github.com/microsoft/vscode-docs/blob/main/docs/agents/concepts/tools.md?utm_source=chatgpt.com)

3. **Microsoft vscode-copilot-chat — Tool Calling Loop**
   GitHub 开源实现，可直接观察 VS Code Agent 的 tool calling loop、session transcript、hooks、subagents、tracing 和多轮执行机制。

   [VS Code Copilot Tool Calling Loop 源码](https://github.com/microsoft/vscode-copilot-chat/blob/main/src/extension/intents/node/toolCallingLoop.ts?utm_source=chatgpt.com)

4. **GitHub Copilot SDK — Architecture / Server-side applications**
   描述 Copilot SDK 与 headless Copilot CLI server 的 JSON-RPC 架构，以及 server-side、multi-user deployment。

   [GitHub Copilot SDK](https://github.com/github/copilot-sdk?utm_source=chatgpt.com)

5. **GitHub Copilot SDK — Multi-tenancy & Server Deployments**
   具体讨论 server multi-tenancy、session state、工具隔离、host filesystem 和 `mode: "empty"`。

   [Copilot SDK Multi-tenancy](https://github.com/github/copilot-sdk/blob/main/docs/setup/multi-tenancy.md?utm_source=chatgpt.com)

6. **GitHub Copilot SDK — Plugin Directories**
   说明 Skills、Hooks、MCP、Custom Agents、LSP 如何组合成可复用 plugin，以及如何使 plugin set 在 server/CI 中保持 deterministic。

   [Copilot SDK Plugin Directories](https://github.com/github/copilot-sdk/blob/main/docs/features/plugin-directories.md?utm_source=chatgpt.com)

7. **GitHub Copilot Cloud Agent**
   GitHub 对 Cloud Agent 的官方架构描述，包括 ephemeral development environment、GitHub Actions、branch、PR、测试和 59 分钟运行限制。

   [GitHub Copilot Cloud Agent](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent?utm_source=chatgpt.com)

8. **GitHub Copilot Responsible Use — Agents**
   对 Copilot CLI、Cloud Agent、SDK、permission prompt、sandbox、firewall、hooks 和本地/云端执行边界的集中说明。

   [GitHub Copilot Agents Responsible Use](https://docs.github.com/en/copilot/responsible-use/agents?utm_source=chatgpt.com)

9. **Anthropic — Claude Code Security**
   Claude Code permission architecture、sandbox、working-directory boundary、approval 和 prompt-injection protections。

   [Claude Code Security](https://docs.anthropic.com/en/docs/claude-code/security?utm_source=chatgpt.com)

10. **OpenAI — Building a safe, effective sandbox to enable Codex on Windows**
    解释本地 IDE/CLI Codex 为什么需要 OS-enforced sandbox，以及 model 在云端、tool execution 在开发者机器上的架构。

    [OpenAI Codex Windows Sandbox](https://openai.com/index/building-codex-windows-sandbox/?utm_source=chatgpt.com)

11. **OpenAI — Running Codex safely at OpenAI**
    讨论 sandbox、approval policy、managed configuration、network policy 和 agent-native telemetry。

    [Running Codex safely at OpenAI](https://openai.com/index/running-codex-safely/?utm_source=chatgpt.com)

12. **OpenAI — Introducing the Agents API**
    2026 年 9 月发布，说明将 Codex harness 以 API 形式用于 cloud/server agents，并提供 OpenAI-hosted、VPC 和第三方 sandbox 选择。

    [OpenAI Agents API](https://openai.com/index/introducing-the-agents-api/?utm_source=chatgpt.com)

13. **OpenAI Agents SDK — Sessions / Guardrails / Tracing**
    说明 server-side agent runtime 中 sessions、human-in-the-loop、tool guardrails 和 tracing 的运行时语义。

    [OpenAI Agents SDK](https://openai.github.io/openai-agents-python/?utm_source=chatgpt.com)

14. **Amazon Bedrock AgentCore — Runtime Sessions**
    讨论每个 session 的 microVM isolation、ephemeral compute、持久 filesystem、session lifecycle 和多步骤执行。

    [AgentCore Runtime Sessions](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-sessions.html?utm_source=chatgpt.com)

15. **Amazon Bedrock AgentCore — Runtime Security Best Practices**
    讨论 session isolation、IAM、credential exposure、network controls、audit 和 shared-responsibility model。

    [AgentCore Runtime Security](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-security-best-practices.html?utm_source=chatgpt.com)

16. **Amazon Bedrock AgentCore — Observability**
    说明 production Agent Runtime 的 tracing、session metrics、latency、token usage、error rates 和 OpenTelemetry 集成。

    [AgentCore Observability](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/observability.html?utm_source=chatgpt.com)

17. **LangChain — Deep Agents**
    说明 Deep Agents 的 filesystem、shell、subagents、persistent memory、filesystem permissions、human-in-the-loop 和多种 backend。

    [Deep Agents Overview](https://docs.langchain.com/oss/javascript/deepagents/overview?utm_source=chatgpt.com)

18. **OpenHands — Runtime Architecture**
    真实开源 Agent runtime 架构，展示 Agent、Event Stream、Action Executor、Docker Sandbox、Browser、Shell 的分层。

    [OpenHands Runtime Architecture](https://github.com/OpenHands/docs/blob/main/openhands/usage/architecture/runtime.mdx?utm_source=chatgpt.com)

19. **OpenHands Software Agent SDK — arXiv**
    从研究角度说明 production software agent 对可靠执行、安全隔离、local-to-remote execution 和多种用户界面的架构要求。

    [OpenHands Software Agent SDK 论文](https://arxiv.org/abs/2511.03690?utm_source=chatgpt.com)

20. **SWE-agent Architecture**
    经典 coding-agent architecture，将 Agent loop 与 Docker/remote execution environment 分离。

    [SWE-agent Architecture](https://swe-agent.com/latest/background/architecture/?utm_source=chatgpt.com)

21. **FINRA — GenAI: Continuing and Emerging Trends, 2026**
    针对证券业 AI Agent 的监管观察，重点涉及 autonomy、scope/authority、auditability、system access、human oversight、actions/decisions 和 guardrails。

    [FINRA 2026 GenAI Report](https://www.finra.org/rules-guidance/guidance/reports/2026-finra-annual-regulatory-oversight-report/gen-ai?utm_source=chatgpt.com)

22. **Financial Stability Board — Sound Practices for Responsible Adoption of AI**
    2026 年金融机构 AI 治理与生命周期管理 consultation report。

    [FSB AI Sound Practices Consultation](https://www.fsb.org/2026/06/sound-practices-for-responsible-adoption-of-artificial-intelligence-ai-consultation-report/?utm_source=chatgpt.com)

23. **Bank of England — Financial Stability Report, July 2026**
    讨论 Agentic AI 在金融机构和金融市场中的应用、验证、约束和监管可见性问题。

    [Bank of England Financial Stability Report July 2026](https://www.bankofengland.co.uk/financial-stability-report/2026/july-2026?utm_source=chatgpt.com)

24. **AWS — Multi-Agent Systems for Financial Services on EKS and AgentCore**
    金融服务 Multi-Agent reference architecture，包含 orchestrator、specialized agents、authentication、tracing、cost control 和 sandbox。

    [AWS Financial Services Multi-Agent Systems](https://aws.amazon.com/blogs/industries/multi-agent-systems-for-financial-services-on-amazon-eks-and-agentcore/?utm_source=chatgpt.com)

25. **AWS — MRH Trowe secure self-service AI agents**
    真实金融服务生产案例，涉及约 400 名员工、self-service agents、安全、数据驻留、合规和成本治理。

    [MRH Trowe AI Agent Case Study](https://aws.amazon.com/blogs/machine-learning/how-mrh-trowe-enabled-secure-self-service-ai-agents-in-financial-services/?utm_source=chatgpt.com)

26. **Bank of America — Erica / EricaAssist**
    真实金融机构案例，展示 AI 能力从客户助手延伸到企业内部员工辅助和多业务线复用。

    [Bank of America EricaAssist](https://newsroom.bankofamerica.com/content/newsroom/press-releases/2026/07/bank-of-america-enhances-ericaassist-with-generative-ai-to-help-.html?utm_source=chatgpt.com)

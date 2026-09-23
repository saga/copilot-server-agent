有，而且现在已经形成了一个比较明确的 **Agent Sandbox / Agent Computer / Code Execution Runtime** 市场。K8s Agent Sandbox 只是其中一种实现路线。

如果结合你现在的场景——**DeepAgents / Copilot SDK + 企业金融 Agent + K8s + 每个请求隔离 + skill 执行 + 文件操作 + 可能需要 shell/npm/python/git**——我会把竞品分成下面几类。

### 1. 最直接的竞品：E2B

E2B 是目前最接近“给 Agent 一个临时 Linux 电脑”的方案之一。

典型模型：

```text
Agent Runtime
     │
     │ create sandbox
     ▼
┌───────────────────┐
│ E2B Sandbox       │
│                   │
│ Linux             │
│ bash              │
│ python/node       │
│ git               │
│ filesystem        │
│ generated code    │
└───────────────────┘
```

它特别适合：

* Agent 写代码
* 执行 Python / JS / Shell
* clone repo
* npm install
* 跑测试
* 生成文件
* 数据分析
* 长一点的 Agent coding session

E2B 的核心隔离路线是 **Firecracker microVM**，因此和“普通 Docker container”相比，隔离边界更强。当前生态里也已经有 LangChain、OpenAI Agents SDK、Anthropic 等 Agent 框架的集成。([MCP.Directory][1])

**对你而言，它是 K8s Agent Sandbox 最值得直接比较的产品。**

---

### 2. Daytona

Daytona 的定位更加接近：

> 给 Agent 一个持久的开发工作空间。

例如：

```text
Agent
  │
  ▼
Daytona Workspace
  ├── /workspace
  ├── git repo
  ├── node_modules
  ├── python env
  ├── generated files
  └── processes
```

它和 E2B 最大的区别之一是 **workspace / persistence**。

如果你的 Agent：

```text
第一次：
clone repo
npm install

第二次：
修改代码
npm test

第三次：
继续修改
npm run build

第四次：
人工 review
```

这种模式，Daytona 很自然。

不过需要特别注意一个时间点：Daytona 在 2026 年已经发生了许可证/产品路线变化，网上仍然有大量“open source Daytona”的旧资料，因此如果你考虑自建，需要单独核对当前版本和许可证，而不能直接按照旧文章设计。([Helix][2])

---

### 3. Modal Sandboxes

Modal 的思路不完全是“开发环境”，而是：

> Serverless compute + sandbox。

特别适合：

```text
Agent
 │
 ├── run Python
 ├── process dataset
 ├── run ML
 ├── GPU computation
 └── temporary environment
```

它的优势是计算能力和 GPU 生态。

所以：

| 场景                     | Modal   |
| ---------------------- | ------- |
| Python                 | 很适合     |
| 数据处理                   | 很适合     |
| GPU                    | 很适合     |
| ML                     | 很适合     |
| Agent coding workspace | 可以      |
| 企业内部 K8s 自托管           | 不属于主要优势 |

Modal 的 sandbox 路线与 E2B 的 microVM 路线不同，资料中通常将其归为 gVisor / userspace isolation 一类。([MCP.Directory][1])

---

### 4. Cloudflare Sandbox

Cloudflare 的 Sandbox / Containers 路线也值得关注。

它比较像：

```text
Cloudflare Worker
       │
       ▼
   Sandbox
       │
       ├── execute code
       ├── filesystem
       └── temporary compute
```

优势在于：

* edge
* latency
* serverless
* Cloudflare ecosystem
* Agent / MCP integration

但是对于你这种 **金融企业内部 Agent + Snowflake + K8s + AD + 私有数据 + 企业网络边界**，它不是最自然的架构。

---

### 5. Vercel Sandbox

Vercel 也进入了这个方向。

定位更接近：

> 给 AI coding / web agent 一个隔离的执行环境。

适合：

```text
Agent
 ↓
clone project
 ↓
install dependencies
 ↓
modify code
 ↓
build
 ↓
run tests
```

如果你的 Agent 最终主要是 **software engineering / coding agent**，它很值得比较。

但如果你的目标是：

```text
金融业务 Agent
    ↓
读取企业数据
    ↓
执行 skill
    ↓
产生 business artifact
    ↓
人工 review
    ↓
执行 business command
```

那么它和你的核心问题已经不是完全同一层。

---

### 6. Runloop

Runloop 也是值得放进 shortlist 的。

它更偏：

> AI coding agent 的 remote development environment / execution environment。

也就是说：

```text
Agent
  ↓
Runloop
  ↓
isolated development environment
  ↓
repo / shell / tests / build
```

和 Copilot / Codex / Claude Code 这一类 Agent 的关系比较近。

目前的 Agent sandbox 市场已经不只是 E2B、Daytona、Modal；Runloop、Vercel、Cloudflare、Blaxel 等都在这个方向。([bex.co][3])

---

## 7. 更底层：直接使用 Firecracker

这是我认为**对你们企业平台尤其值得研究**的一条路线。

不买 E2B，而是：

```text
                    Control Plane
                         │
                    Sandbox Manager
                         │
            ┌────────────┼────────────┐
            ▼            ▼            ▼
       Firecracker    Firecracker   Firecracker
        microVM        microVM       microVM
            │            │            │
          Agent A      Agent B      Agent C
```

Firecracker 本身是 microVM 技术，而不是 Agent 产品。

你们自己实现：

* sandbox lifecycle
* image/template
* filesystem
* network policy
* credential injection
* timeout
* resource quota
* snapshot
* audit
* cleanup

这样得到的是一个真正属于你们平台的：

> **Agent Execution Plane**

这和你现在研究的 **Agent Control Plane / Runtime 分离**其实非常契合。

E2B 本质上也是把这类底层能力产品化了；Firecracker 路线则是自己掌握整个控制面。当前 Agent sandbox 对比资料也把 E2B、Fly 等归到 microVM 路线。([bex.co][4])

---

## 8. 更底层：gVisor

另一条路线是：

```text
Agent
 ↓
Sandbox Manager
 ↓
gVisor
 ↓
Container
```

也就是：

**container + stronger syscall isolation**

而不是：

**microVM**

代表性的商业平台包括 Modal 等。([AgentField][5])

如果你们已经非常熟 Kubernetes，那么：

```text
Kubernetes
  +
gVisor
  +
NetworkPolicy
  +
ResourceQuota
  +
ephemeral volume
```

也是一个实际可落地的企业方案。

---

# 所以可以把整个市场画成这样

```text
                         Agent
                           │
                           ▼
                  Agent Execution API
                           │
          ┌────────────────┼─────────────────┐
          │                │                 │
          ▼                ▼                 ▼
     Managed Sandbox   Enterprise K8s    Raw Compute
          │                │                 │
     ┌────┼────┐       ┌───┼────┐       ┌────┼────┐
     │    │    │       │   │    │       │    │    │
    E2B Daytona Modal   K8s gVisor Kata  Firecracker
     │      │            │   │            │
     │      │            │   │            │
  Vercel  Runloop       Agent Sandbox   自建
  CF      Blaxel
```

---

# 但对你们来说，真正应该比较的不是“谁是竞品”

而是这 **4 种架构路线**：

| 路线                    | Sandbox             |    控制权 |  企业数据 | 运维 | 适合你们         |
| --------------------- | ------------------- | -----: | ----: | -: | ------------ |
| **E2B**               | Firecracker         |      中 |     △ |  低 | 很值得 PoC      |
| **Daytona**           | Workspace/Container |      中 |     △ |  低 | coding agent |
| **Modal**             | Sandbox             |      低 |     △ |  低 | Python/GPU   |
| **Cloudflare/Vercel** | Managed             |      低 |     △ | 很低 | Web/edge     |
| **K8s + gVisor**      | 自建                  |      高 | **强** | 中高 | **企业平台**     |
| **K8s + Kata**        | VM-like             |      高 | **强** |  高 | **高隔离场景**    |
| **Firecracker 自建**    | microVM             | **最高** | **强** | 很高 | 平台级基础设施      |

---

## 对你前面那个 DeepAgents / Copilot SDK 问题，最重要的一点

其实：

**DeepAgents 并不等于 Kubernetes Sandbox。**

可以把它们拆开：

```text
                 Agent Application
                       │
             DeepAgents / Copilot SDK
                       │
                 Tool / Skill
                       │
             ┌─────────┴─────────┐
             │                   │
       ordinary API         sandbox.execute()
                                 │
                                 ▼
                         Agent Sandbox
                                 │
              ┌──────────────────┼───────────────┐
              │                  │               │
            shell              python          node
              │                  │               │
             git              analysis         build
```

因此你完全可以：

```text
Copilot SDK
     │
     └── K8s Agent Sandbox
```

也可以：

```text
DeepAgents
     │
     └── E2B
```

甚至：

```text
Copilot SDK
     │
     └── E2B
```

或者：

```text
DeepAgents
     │
     └── Firecracker
```

**Sandbox 应该是 Runtime 的执行能力，而不是 Agent Framework 的固有属性。**

这也是为什么 OpenAI Agents SDK 在 2026 年已经把 sandbox 抽象成可插拔能力，并出现多个 sandbox provider 的原因；当前生态已经明显朝“Agent framework ↔ Sandbox provider”解耦发展。([bex.co][3])

---

## 如果套到你们现在的金融 Agent 平台

我反而建议不要直接把问题定义成：

> “我们要不要用 K8s Agent Sandbox？”

而应该定义成：

```text
                    Agent Control Plane
                           │
       ┌───────────────────┼───────────────────┐
       │                   │                   │
    Policy              Workflow          Session
       │                   │                   │
       └───────────────────┼───────────────────┘
                           │
                    Agent Runtime
             DeepAgents / Copilot SDK
                           │
                     Skill / Tool
                           │
                  Execution Gateway
                           │
             ┌─────────────┼──────────────┐
             │             │              │
          K8s Sandbox      E2B         Firecracker
          gVisor/Kata                   VM
             │
       ┌─────┼─────┐
       │     │     │
      git   node  python
```

这样以后甚至可以做到：

```text
low-risk skill
      → ordinary container

normal agent coding
      → K8s + gVisor

high-risk / untrusted code
      → Kata / Firecracker

external experimentation
      → E2B
```

而 **Agent 根本不需要知道底层是哪一种 sandbox**。

这实际上比单纯选择“E2B vs K8s”更符合你们现在正在做的 **Agent Control Plane / Runtime / Skill / Policy 分层**。当前市场资料也显示，sandbox 的主要差异已经集中在隔离强度、持久工作空间、启动延迟、网络控制和自托管能力，而不是 Agent framework 本身。([MCP.Directory][1])

如果你现在准备给你们的平台选型，我会重点拿 **K8s+gVisor/Kata、E2B、Firecracker 自建、Daytona** 四个做一次架构级对比，而不是把 Modal/Cloudflare/Vercel 等全部平铺比较。

[1]: https://mcp.directory/blog/cloudflare-sandbox-vs-modal-vs-e2b-vs-daytona-2026?utm_source=chatgpt.com "AI Code Sandbox 2026: Cloudflare vs Modal vs E2B vs Daytona — MCP.Directory"
[2]: https://helix.ml/blog/self-hosted-agent-sandboxes?utm_source=chatgpt.com "Self-Hosted E2B Alternatives: 6 AI Agent Sandboxes Compared — HelixML"
[3]: https://bex.co/blog/2026/09/14/ai-agent-sandbox-market-e2b-modal-daytona?utm_source=chatgpt.com "E2B vs Daytona vs Modal: Picking an Agent Sandbox You Can Self-Host | bex.co"
[4]: https://bex.co/blog/2026/07/07/ai-agent-sandbox-wars?utm_source=chatgpt.com "The AI Agent Sandbox Wars: E2B vs Daytona vs Modal vs Fly Machines Compared | bex.co"
[5]: https://agent-field.com/articles/best-ai-agent-sandboxes-2026/?utm_source=chatgpt.com "AI Agent Sandboxes Compared in 2026 | AgentField"




----------


为什么不把整个agent运行放在sandbox里面，而只是放代码执行和文件操作这些，在webservice端，多个agent同时执行，难道就没有互相影响甚至越权不安全的风险么？

----------




有，而且这是 Agent Sandbox 架构里一个非常容易被忽略的问题。

**“只把代码执行放进 sandbox，Agent 本身运行在共享 Web Service”并不天然安全。**
关键不是“Agent 是否在 sandbox”，而是要明确区分：

> **Agent Runtime 的隔离** 和 **Agent 所执行的副作用的隔离**。

如果多个 Agent 共用一个 Web Service，而 Web Service 内的 Agent runtime 又能访问共享内存、文件、凭证、数据库连接、工具客户端等资源，那么 sandbox 只隔离了其中一小部分风险。

### 先看一个典型架构

```text
                    Agent Web Service
              ┌──────────────────────────┐
              │                          │
Request A ───►│ Agent Runtime A          │
              │   memory A               │
              │   tools A                │
              │   skill A                │
              │                          │
Request B ───►│ Agent Runtime B          │
              │   memory B               │
              │   tools B                │
              │   skill B                │
              │                          │
              │  shared process / libs   │
              │  shared filesystem       │
              │  shared credentials ?    │
              └───────────┬──────────────┘
                          │
                 Sandbox Service
                    ┌─────┴─────┐
                    ▼           ▼
                Sandbox A   Sandbox B
```

这里真正被隔离的是：

```text
Sandbox A ≠ Sandbox B
```

但不一定隔离：

```text
Agent A ≠ Agent B
```

这两个是完全不同的问题。

---

# 1. 最大的问题其实不是“Agent A 能不能访问 Agent B”

更危险的是：

> **Agent A 能不能通过 Agent Web Service 的普通能力影响 Agent B？**

例如：

```text
Agent A
  │
  ├── tool client
  ├── database connection
  ├── /tmp
  ├── environment variables
  ├── process memory
  ├── shared cache
  ├── shared MCP connection
  ├── shared credentials
  └── shared SDK state
```

如果这些东西没有按 session/tenant/request 隔离，那么：

```text
Agent A
   ↓
某个 tool / library / shared state
   ↓
Agent B 的数据
```

完全可能发生。

而且这时候：

**K8s Sandbox 再安全也救不了你。**

因为越权发生在 sandbox 外面。

---

# 2. 一个非常现实的例子：文件系统

假设 Web Service 有：

```text
/tmp/agent-a/
/tmp/agent-b/
```

理论上应该：

```text
Agent A → /tmp/agent-a
Agent B → /tmp/agent-b
```

但如果 Agent Web Service 自己执行：

```python
open("/tmp/foo.json")
```

而不是：

```text
sandbox A → /workspace/foo.json
```

那么你实际上只有：

```text
code execution：隔离
普通文件访问：没有隔离
```

于是：

```text
Agent A
  │
  └── tool / library
          │
          ▼
      /tmp/agent-b
```

就可能越权。

所以你之前说的：

> sandbox 跑代码和文件操作

实际上应该进一步问：

> **所有需要访问 Agent-owned state 的 filesystem operation 是否都必须经过 sandbox？**

通常答案应该是 **是**。

---

# 3. 更危险的是 credentials

例如 Web Service 启动的时候：

```text
AWS_ACCESS_KEY_ID=...
SNOWFLAKE_TOKEN=...
MCP_TOKEN=...
INTERNAL_API_TOKEN=...
```

那么：

```text
Agent A
  │
  └── LLM generated tool call
          │
          ▼
     Web Service
          │
          └── shared credential
```

这时候 sandbox 可能完全没意义。

Agent A 即使不能：

```text
access Sandbox B
```

却可能：

```text
call Web Service Tool
        ↓
Web Service uses privileged credential
        ↓
access Business Data
```

所以金融 Agent 最关键的边界其实不是：

```text
Agent → Sandbox
```

而是：

```text
Agent
  ↓
Identity
  ↓
Data Entitlement
  ↓
Tool Authorization
  ↓
Policy Decision
  ↓
Business Command
```

这和你之前总结的那几个原则其实是一致的：

> LLM 不能定义 security boundary。
> Retrieval 不能绕过 Data Entitlement。
> Tool 不能自行决定高风险操作是否允许。

---

# 4. 那为什么业界还经常把 Agent Runtime 放在 Web Service？

因为这里有一个非常实际的工程权衡。

Agent Runtime 通常需要：

```text
LLM API
LangChain
DeepAgents
LangSmith
MCP clients
database clients
session state
workflow state
streaming
WebSocket
callbacks
tracing
```

如果每一个 Agent 都启动一个完整 VM：

```text
Request
 ↓
create VM
 ↓
start Python
 ↓
start Agent Runtime
 ↓
load framework
 ↓
connect LLM
 ↓
connect MCP
```

成本和启动时间都会增加。

而如果：

```text
K8s Deployment
   │
   ├── Agent 1
   ├── Agent 2
   ├── Agent 3
   ├── Agent 4
   └── Agent 5
```

那么基础 runtime 可以共享。

所以现在很多平台采用的是：

```text
Control Plane
       │
       ▼
Shared Agent Runtime
       │
       ▼
Sandbox only for untrusted execution
```

它的目标是：

> **把最危险的“不可信代码执行”隔离出来，而不是把整个 Agent 当成一个需要 VM 隔离的进程。**

这个思路本身是合理的。

但有一个前提：

> **Agent Runtime 自己必须被设计成 multi-tenant / multi-session isolated。**

---

# 5. 这其实可以分成三个隔离等级

我觉得这个分类对你们平台特别有用。

## Level 1：Process Isolation

```text
                 Agent Service
              ┌─────────────────┐
              │ Agent A          │
              │ Agent B          │
              │ Agent C          │
              └─────────────────┘
```

只是：

```text
request_id
session_id
memory object
```

不同。

这适合低风险场景，但安全边界弱。

---

## Level 2：Sandbox Execution Isolation

```text
             Agent Web Service
                    │
          ┌─────────┼─────────┐
          ▼         ▼         ▼
      Sandbox A  Sandbox B  Sandbox C
```

Agent runtime 共用，但：

```text
code execution
filesystem
process
network
```

隔离。

这是现在很多 Agent 平台采用的模型。

---

## Level 3：Whole Agent Isolation

```text
                 Control Plane
                       │
       ┌───────────────┼───────────────┐
       ▼               ▼               ▼
   Agent VM A       Agent VM B      Agent VM C
       │               │               │
   Runtime A       Runtime B      Runtime C
       │               │               │
   Sandbox A       Sandbox B      Sandbox C
```

甚至可以：

```text
Agent Runtime
+ filesystem
+ credentials
+ MCP clients
+ tool clients
+ memory
+ execution
```

全部隔离。

这才是真正意义上的：

> **Agent-per-sandbox**

安全边界非常清楚，但成本明显更高。

---

# 6. 你真正应该警惕的是“半隔离”

我认为这是你现在架构评审里应该重点抓的风险。

例如：

```text
              Agent Service
                    │
       ┌────────────┼────────────┐
       │            │            │
    Memory       Tools       Credentials
       │            │            │
       └────────────┼────────────┘
                    │
                  Agent
                    │
                    ▼
                Sandbox
```

架构图看起来：

> “Agent 有 sandbox，很安全。”

实际上：

```text
              Sandbox
                 │
          code / files
              isolated
```

但是：

```text
Memory           shared ?
Tool client      shared ?
MCP session      shared ?
DB connection    shared ?
credentials      shared ?
cache            shared ?
environment      shared ?
network          shared ?
logs/traces      shared ?
workflow state   shared ?
```

这些如果没有严格隔离，**sandbox 只是解决了最下面的一部分问题。**

---

# 7. 对你们金融 Agent，我会采用一个稍微不同的模型

不是简单：

```text
Agent → Sandbox
```

而是：

```text
                    Control Plane
                         │
             ┌───────────┼───────────┐
             │           │           │
          Identity     Policy     Workflow
             │           │           │
             └───────────┼───────────┘
                         │
                    Agent Session
                         │
                  ┌──────┴──────┐
                  │             │
                  ▼             ▼
             Agent Runtime   Business State
                  │
          ┌───────┼────────┐
          │       │        │
        LLM     Tools     Skill
          │       │        │
          │       ▼        │
          │  Authorization │
          │       │        │
          │       ▼        │
          │  Tool Gateway  │
          │                │
          ▼                ▼
       reasoning        Sandbox
                           │
                     code / files
```

这里最重要的是：

### Agent Runtime 可以共享

但是：

### Agent Session 不共享

每一个 session 都应该有明确的：

```text
tenant_id
user_id
session_id
agent_id
skill_version
memory namespace
workspace
credential context
data entitlement context
trace context
```

而且这些都不能由 LLM 自己决定。

---

# 8. 甚至不一定需要“整个 Agent 放进 Sandbox”

这是一个非常重要的结论。

你真正应该隔离的是：

> **能够产生不可控副作用的东西。**

例如：

### 可以共享的

```text
LLM client
LangChain library
DeepAgents framework
prompt templates
read-only skill definitions
tracing SDK
configuration
```

### 不应该直接共享的

```text
Agent memory
workspace
temporary files
credentials
MCP sessions
database transactions
mutable caches
business state
tool authorization context
```

### 必须强隔离的

```text
arbitrary code execution
shell
package installation
untrusted repository
generated executable
browser automation
unknown binaries
```

所以最终很可能不是：

```text
everything → sandbox
```

而是：

```text
                 Shared Agent Runtime
                         │
               ┌─────────┴─────────┐
               │                   │
        controlled state       untrusted work
               │                   │
          Session scope         Sandbox
               │                   │
       Tool Gateway          shell/python/node
               │                   │
       Policy + Entitlement    filesystem
```

这通常是成本、安全性和工程复杂度之间更现实的平衡。

---

# 9. 但如果 Agent 本身就是“不可信代码”，情况就完全不同

例如你允许用户上传：

```text
agent.zip
skill.zip
python package
javascript package
```

然后 Agent 可以动态：

```text
import arbitrary_package
execute shell
read environment
spawn process
```

那么我会非常谨慎地把它放在共享 Web Service。

这时候更合理的是：

```text
User Skill
   ↓
Sandbox
   ↓
Agent Runtime
   ↓
Skill execution
```

甚至：

```text
Untrusted Agent
      ↓
Whole Agent Sandbox
      ↓
Tools through controlled gateway
```

因为这时 Agent 自身已经成为 **untrusted workload**。

---

## 最后一个很关键的判断标准

你们可以不要问：

> “Agent 要不要放进 sandbox？”

而是对每一种能力问：

> **这个东西如果被 Agent 完全控制，是否能够突破当前 Session / User / Entitlement 的安全边界？**

如果答案是：

**是 → 必须在 Agent 外部建立强制边界。**

例如：

```text
LLM reasoning
    ↓
可以不可信

Tool call
    ↓
必须重新授权

Database query
    ↓
Data Entitlement

Business command
    ↓
Policy + Approval

Shell execution
    ↓
Sandbox

Filesystem
    ↓
Sandbox / Session workspace
```

这其实比“整个 Agent 放不放 K8s Sandbox”更重要。

**所以你的担心是成立的：如果只是把代码执行和文件操作放进 sandbox，却让共享 Web Service 中的 Agent 拥有未隔离的 memory、tool、credential、MCP、database 或业务状态访问能力，那么确实存在 Agent 间串扰和越权风险。**

对于你们现在的架构，我会把 **“Agent Runtime 多租户隔离模型”单独作为一个架构评审项**，而不是把它笼统归到 “K8s Sandbox 已经解决安全问题”。



--------------



如果把每个agent service都放在各自sandbox这个考虑，k8s agent sandbox还有firecracker或者其它方案，哪个更好

---------------


如果现在把问题重新定义成：

> **每一个 Agent Session 都拥有自己的 Agent Service + 自己的 filesystem + 自己的 credentials/context，整个 Agent Runtime 本身就是隔离单元。**

那么我的结论会明显改变：

**对于你们这种金融企业 Agent 平台，我会优先考虑 `Kubernetes Agent Sandbox + Kata Containers`，其次是 `Kubernetes Agent Sandbox + gVisor`；如果追求极强隔离且愿意自己承担更多基础设施，则考虑 Firecracker。**

不是简单地说 Firecracker 一定比 K8s Agent Sandbox 好，因为这两者其实不是同一层的东西。

---

# 1. 先把三者放到正确的位置

现在的 Kubernetes Agent Sandbox 是一个 **Agent 生命周期/工作负载抽象**，不是一种虚拟化技术。

它可以：

```text
Agent Sandbox
      │
      ├── ordinary container
      │
      ├── gVisor
      │
      └── Kata Containers
```

官方文档明确支持通过 `runtimeClassName` 使用 gVisor 或 Kata 来强化隔离。([Agent Sandbox][1])

所以其实不是：

```text
K8s Agent Sandbox vs Firecracker
```

而更接近：

```text
                 Agent Sandbox API
                        │
             ┌──────────┼──────────┐
             ▼          ▼          ▼
          runc       gVisor       Kata
                                      │
                                   VM/kernel
```

而 Firecracker 是另一套 microVM runtime / infrastructure 路线。

---

# 2. 如果整个 Agent Service 都放进 Sandbox，我会优先选择 Kata

你现在的架构可能变成：

```text
                    Control Plane
                         │
                 create Agent Sandbox
                         │
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
      Sandbox A      Sandbox B      Sandbox C
          │              │              │
      Agent A        Agent B        Agent C
      Service        Service        Service
          │              │              │
      DeepAgents     Copilot SDK    DeepAgents
          │              │              │
       Tools          Tools          Tools
          │              │              │
       files          files          files
```

每个 Sandbox 内：

```text
┌─────────────────────────────┐
│ Agent Sandbox A             │
│                             │
│ Agent Web Service           │
│ ├── Agent Runtime           │
│ ├── Memory                  │
│ ├── MCP clients             │
│ ├── Tool clients            │
│ ├── /workspace              │
│ ├── credentials             │
│ └── processes               │
│                             │
│ Guest Kernel                │
└─────────────────────────────┘
              │
           Kata VM
              │
         Host Kernel
```

这样你的安全边界就非常漂亮：

```text
Agent A
   ╳
Agent B
```

而不是依赖应用层保证：

```text
Agent A
   │
   ├── session_id=A
   ├── memory namespace=A
   ├── filesystem=A
   └── credential=A
```

---

# 3. 为什么我倾向 Kata，而不是直接 Firecracker？

因为你的 Agent 本质上还是一个 **Kubernetes workload**。

你需要的东西很多：

```text
FastAPI
Python
Node
DeepAgents
Copilot SDK
MCP
Git
filesystem
long-running process
WebSocket
HTTP
logs
metrics
tracing
PVC
service discovery
```

Kata 的设计就是：

```text
Kubernetes
    ↓
containerd / CRI
    ↓
Kata
    ↓
lightweight VM
    ↓
container
```

也就是说，Kata 保留了大量 Kubernetes/OCI/container 的使用模型，同时把 kernel boundary 提高到了 VM。Kata 官方文档也是这个架构。([Kata Containers][2])

而 Kubernetes Agent Sandbox 官方现在也直接提供 Kata integration，并明确把它定位为适合 **multi-tenant / highly untrusted code** 的强隔离场景。([Agent Sandbox][3])

这对你们特别重要。

你不需要自己重新造：

```text
VM scheduler
VM lifecycle
network attachment
storage
service discovery
health check
resource quota
observability
```

---

# 4. Firecracker 的优势在哪里？

Firecracker 的隔离模型非常漂亮：

```text
Agent A
   ↓
Firecracker microVM A
   ↓
Guest Kernel A

Agent B
   ↓
Firecracker microVM B
   ↓
Guest Kernel B
```

Firecracker 本身就是针对这种强隔离 workload 设计的，使用 KVM，并进一步结合 seccomp、cgroups、namespaces 等做 defense in depth。([GitHub][4])

E2B 就是一个很好的现实例子：

```text
E2B
  ↓
Firecracker
  ↓
每个 Sandbox 一个 microVM
```

E2B 当前公开架构甚至明确是：

```text
Control Plane
      ↓
Orchestrator
      ↓
Firecracker VM
      ↓
Agent environment
```

并使用 snapshot / copy-on-write 来降低启动成本。([GitHub][5])

所以如果你问：

> **“单个 Agent 的安全边界，Firecracker 强不强？”**

答案是：**非常强。**

---

# 5. 但是你们自己直接用 Firecracker，会多出一个问题

你现在不是在做：

> “我要运行一些不可信 Python。”

你是在做：

> “我要建立一个企业 Agent 平台。”

这意味着你最终需要：

```text
Agent lifecycle
        ↓
Sandbox lifecycle
        ↓
image/template
        ↓
network
        ↓
storage
        ↓
credentials
        ↓
MCP
        ↓
observability
        ↓
autoscaling
        ↓
resource quotas
        ↓
audit
```

如果直接 Firecracker：

```text
                   Agent Control Plane
                           │
                    Firecracker Manager
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
           VM A          VM B          VM C
```

那么很多 Kubernetes 已经解决的问题，你需要自己解决。

所以：

**Firecracker 是更底层的 building block，而 Agent Sandbox 是更接近你需求的 platform abstraction。**

---

# 6. gVisor 又处于什么位置？

gVisor 是另一个非常有意思的选择：

```text
Kubernetes Agent Sandbox
          │
       gVisor
          │
   userspace kernel
          │
      container
```

它不是完整 VM，而是在 userspace 实现 kernel interface，拦截 syscall，避免 workload 直接接触 host kernel。([Agent Sandbox][1])

优势：

* 比普通 container 隔离强
* Kubernetes 集成好
* 不需要硬件虚拟化
* 兼容性通常比完整 VM 路线简单
* 运维复杂度低于自己维护 Firecracker

缺点就是：

> 隔离模型和 VM 不一样。

对于**金融企业、多租户、运行用户提供的 Agent/Skill、可能执行任意代码**，我会更倾向 Kata。

---

# 7. 我会这样做选型

|                   | 普通 K8s | gVisor           | **Kata** | Firecracker |
| ----------------- | ------ | ---------------- | -------- | ----------- |
| Agent 每实例隔离       | △      | ✓                | **✓✓**   | **✓✓**      |
| 独立 kernel         | ✗      | userspace kernel | **✓**    | **✓**       |
| Kubernetes 原生体验   | ✓✓     | ✓✓               | **✓✓**   | △           |
| OCI/container 兼容性 | ✓✓     | ✓                | **✓✓**   | △           |
| 强多租户隔离            | △      | ✓                | **✓✓**   | **✓✓**      |
| Agent 长生命周期       | ✓      | ✓                | **✓**    | ✓           |
| 运维复杂度             | 低      | 中                | **中**    | 高           |
| 自建平台              | 简单     | 中                | **中**    | **高**       |
| 适合金融企业            | △      | ✓                | **✓✓**   | ✓           |
| 适合任意不可信代码         | △      | ✓                | **✓✓**   | **✓✓**      |
| 适合你当前平台           | △      | ✓                | **首选**   | 第二阶段        |

这里的 `✓✓` 不是安全评分，而是架构适配程度。

---

# 8. 还有一个方案：Kata + Firecracker，不一定非要二选一

实际上 Kata 本身支持不同 VMM / hypervisor。Kata 的虚拟化层并不是只有一种实现。([Kata Containers][2])

因此你的企业平台可以设计成：

```text
                  Agent Sandbox API
                         │
                  SandboxClass
                         │
             ┌───────────┼───────────┐
             │           │           │
          gVisor       Kata       Firecracker
             │           │           │
          normal      secure      extreme
```

例如：

```text
SandboxClass: standard
    → gVisor

SandboxClass: secure
    → Kata

SandboxClass: isolated
    → Firecracker
```

这样 Agent Framework 完全不知道下面是什么。

---

# 9. 但我觉得你这里还有一个更重要的设计变化

如果真的采用：

> **每个 Agent Service 一个 Sandbox**

那么我建议不要把它设计成：

```text
HTTP request
   ↓
create sandbox
   ↓
start Agent
   ↓
execute
   ↓
destroy
```

而是：

```text
                 Agent Session
                      │
                      ▼
              SandboxClaim
                      │
                      ▼
              Agent Sandbox
                      │
          ┌───────────┴───────────┐
          │                       │
     Agent Service          Workspace
          │
     ┌────┼─────┐
     │    │     │
    LLM  MCP   Tools
          │
          ▼
     Controlled Gateway
```

然后 Sandbox 可以存在：

```text
30 minutes
2 hours
8 hours
甚至几天
```

因为 Agent Session 本质上已经不是 HTTP request。

这恰好也是 Kubernetes Agent Sandbox 项目设计的原因之一：它针对的是 **singleton、stateful、可能长时间 idle 的 Agent workload**，而不是普通 stateless web server。([Kubernetes][6])

它还提供 Sandbox、SandboxTemplate、SandboxClaim、WarmPool 等生命周期抽象。([Agent Sandbox][7])

---

# 10. 对你们，我会最终选这个架构

如果让我现在给你们做第一版：

```text
                         Agent Control Plane
                                │
                 ┌──────────────┼──────────────┐
                 │              │              │
              Identity        Policy        Workflow
                 │              │              │
                 └──────────────┼──────────────┘
                                │
                         Sandbox Controller
                                │
                         Agent Sandbox CRD
                                │
                       ┌────────┴────────┐
                       │                 │
                  Kata Sandbox      gVisor Sandbox
                       │
                       ▼
              ┌─────────────────────┐
              │ Agent Service        │
              │                     │
              │ DeepAgents          │
              │ FastAPI             │
              │ MCP clients         │
              │ Skill runtime       │
              │ Agent memory        │
              │ workspace           │
              └──────────┬──────────┘
                         │
                    Tool Gateway
                         │
                ┌────────┼─────────┐
                ▼        ▼         ▼
             Snowflake  Search   Business API
                │
           Data Entitlement
```

**第一阶段：Kubernetes Agent Sandbox + Kata。**

**第二阶段：如果发现某些 workload 的威胁模型特别高，再增加 Firecracker/microVM backend。**

**不要一开始就自己直接造 Firecracker orchestration。**

原因不是 Firecracker 不够好，恰恰相反，是因为它太底层。E2B 已经证明 Firecracker 可以很好地承载 Agent sandbox，但它背后实际上还需要完整的 orchestrator、template manager、network、storage、snapshot、routing、control plane 等大量系统。([GitHub][5])

而你们真正要解决的是：

> **“一个 Agent Session = 一个安全、可审计、可销毁、可恢复的 execution environment。”**

这个抽象，**Kubernetes Agent Sandbox + Kata 恰好已经非常接近。**

最后还有一个我认为对你们特别重要的点：

**Sandbox 只解决“Agent 能影响什么计算环境”，不解决“Agent 能访问哪些金融数据、调用哪些业务 API、执行哪些业务动作”。**

所以即使做到：

```text
Agent A → Kata VM A
Agent B → Kata VM B
```

仍然必须有：

```text
Identity
+
Data Entitlement
+
Tool Authorization
+
Policy
+
Approval
+
Business Command
```

否则只是把“Agent A 越权访问 Agent B 的 Linux filesystem”解决了，却没有解决“Agent A 用自己的合法 Tool Credential 查询了不属于它的 Snowflake 数据”这种更现实的金融业务越权问题。

[1]: https://agent-sandbox.sigs.k8s.io/docs/use-cases/gvisor-isolation/?utm_source=chatgpt.com "gVisor Isolation | Agent Sandbox"
[2]: https://kata-containers.github.io/kata-containers/design/virtualization/?utm_source=chatgpt.com "Virtualization in Kata Containers - Kata Containers Docs"
[3]: https://agent-sandbox.sigs.k8s.io/docs/use-cases/kata-containers-isolation/?utm_source=chatgpt.com "Kata Containers Isolation | Agent Sandbox"
[4]: https://github.com/firecracker-microvm/firecracker/blob/main/docs/design.md?utm_source=chatgpt.com "firecracker/docs/design.md at main · firecracker-microvm/firecracker · GitHub"
[5]: https://github.com/e2b-dev/runtime/blob/main/docs/ARCHITECTURE.md?utm_source=chatgpt.com "runtime/docs/ARCHITECTURE.md at main · e2b-dev/runtime · GitHub"
[6]: https://kubernetes.io/blog/2026/03/20/running-agents-on-kubernetes-with-agent-sandbox/?utm_source=chatgpt.com "Running Agents on Kubernetes with Agent Sandbox | Kubernetes"
[7]: https://agent-sandbox.sigs.k8s.io/docs/use-cases/examples/quickstart/?utm_source=chatgpt.com "Secure Agent Sandbox Quickstart | Agent Sandbox"

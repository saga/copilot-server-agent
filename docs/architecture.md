# copilot-server-agent 架构设计

> 定位：**Agent Execution Server**，不是 “Copilot SDK 的 HTTP wrapper”。
>
> Copilot SDK/Runtime 负责 session、工具执行、LLM 调用；
> 授权边界、业务状态、审批、审计由本服务掌控。

```text
                    Agent Runtime
                         │
        ┌────────────────┼────────────────┐
        │                │                │
     Session         Execution          Policy
        │                │                │
   Copilot Runtime   Human Task      Tool Authorization
        │                │                │
        └────────────────┴────────────────┘
                         │
                    Audit Events
```

---

## 1. 分层

```text
Client (Web / API / Ops UI)
        ↓
Express routes        routes/{sessions,session-collaboration,executions,human-tasks,meta}.ts
        ↓              （route 只做编排与传输，不含 SDK 事件 plumbing）
Services              SessionService / SessionAccessService / ExecutionService / HumanTaskService
                      ApprovalService / ActionService / WorkspaceService
Collaboration         CollaborationService（提交分派）/ SessionCoordinator（排队调度）
                      MessageService / ParticipantService / SessionEventService
        ↓
Repositories          ExecutionRepository / EventRepository / HumanTaskRepository
                      SessionRegistry（registry store）
                      ParticipantRepository / MessageRepository / SessionEventRepository
        ↓
SQL 仓储（一份实现）   execution|human-tasks|collaboration/sql-repository.ts + SessionRegistry
        ↓
SQLite（默认）| PostgreSQL（配 DATABASE_URL）     方言差异收敛在 db/dialect.ts
        ↓
Copilot Runtime       mode: "empty" + session 级 availableTools + hooks
```

依赖装配集中在 `server/src/wiring.ts`：唯一一处决定用哪个后端的地方。

**两种后端共用同一份仓储实现**，差异只有方言：占位符（`$1` / `?1`）、JSON 列编解码、
布尔与时间戳表示、JSON 数组命中判定、聚合取整 —— 全部由 `db/dialect.ts` 的钩子提供，
仓储里不出现 `if (backend === ...)`。这也意味着**两份 DDL 必须逐列一致**，
否则某个后端会在运行期炸（`test/schema.test.ts` 会解析两份 DDL 逐列比对拦住这种漂移）。

- **SQLite**：默认。单文件落盘，零依赖（Node 内置 `node:sqlite`）、零配置，启动自动建表。
- **PostgreSQL**：配 `DATABASE_URL` 即切换，用 `pg`（可选依赖），DDL 由运维用 `psql` 应用。
- **Memory**：仅单测与 `COPILOT_STATE_BACKEND=memory` 临时验证，重启即丢。该模式下
  execution / human task / 归属表 / 协作表全部换成内存实现（包括 `SessionRegistry`）。

## 2. 核心对象关系

```text
Session ── Execution #1 ── LLM call ── Tool call ── Human task ── Decision
       └─ Execution #2 ── LLM call ── Tool call

Session ── Participant（owner / member / observer）
        ├─ Message #1..n（应用层 transcript，人类 + agent）
        └─ SessionEvent #1..n（协作时间线，全体参与者可见）
```

| 层 | 职责 | 持久化 |
|----|------|--------|
| Session | Copilot session 生命周期（resume/disconnect/abort）、workspace、访问模型 | runtime 磁盘 + `agent_session` 表 |
| Participant | 谁能进这个会话、以什么会话角色进 | `session_participant` |
| Message | 会话 transcript：谁在什么时候说了什么 | `agent_message` |
| Execution | 一次 agent 执行单元（chat turn / job / workflow） | `agent_execution` |
| HumanTask | 审批与人工输入（统一抽象，`type` 区分） | `human_task` |
| Decision | 一人一票的审批裁决（不覆盖任务本身） | `human_task_decision`（`unique(task_id, approver_id)`） |
| ExecutionEvent | 完整审计时间线 | `execution_event`（`unique(execution_id, sequence)`） |
| SessionEvent | 协作时间线 + SSE 恢复游标 | `session_event`（`unique(session_id, sequence)`） |

`session ≠ execution ≠ tool call ≠ LLM call`：审计、usage、审批、取消全部挂 `executionId`。
`session → 当前 execution` 的映射是**进程内缓存**（`activeFor()`），状态本身是 durable 的。

## 3. Session 访问模型（single / shared）

### 3.1 single / shared

会话的访问模型在创建时确定，**生命周期内不变**：

| | `single`（缺省） | `shared` |
|---|---|---|
| 谁能进 | 只有 owner | owner + participants（member / observer） |
| 提交路径 | 直接执行（HTTP → session lock → agent turn） | 消息落库 → execution(`created`) 入队 → 202 |
| 结果怎么拿 | SSE（`POST /:id/chat`） | 会话事件流（`GET /:id/events`，带游标） |
| Copilot runtime | 每个会话一个 | **仍是每个会话一个**，同一时刻最多一个 agent turn |

字段名叫 `collaborationMode`，刻意避开 SDK 的 `mode: "empty"`：那是 runtime / 工具模式，
这是业务会话模式，两者不能混。它属于业务会话元数据（`agent_session` 的列），
**不属于 `PersistedSessionConfig`** —— 后者是给 SDK 的 resume 配置。

### 3.2 Participant 与 Session Role

```text
POST /:id/chat
      ↓
SessionAccessService.assertCanSend
      ↓
   ┌── single ──→ execution → session lock → agent turn → SSE 回应
   └── shared ──→ agent_message（幂等）→ execution(created) → 202
                        ↓
                 SessionCoordinator.drain（per-session 串行）
                        ↓
                 agent turn → 终稿进 agent_message + session_event
```

会话角色（owner / member / observer）与业务角色（risk / compliance / …）是两层，不能互相替代：

| 会话角色 | view | send | manage_members | manage_session | delete |
|---------|------|------|----------------|----------------|--------|
| owner | ✓ | ✓ | ✓ | ✓ | ✓ |
| member | ✓ | ✓ | | | |
| observer | ✓ | | | | |

`manage_session` 单独一档而不是并入 `send`：`resume` 可以重配 model / agents / MCP / hooks /
systemMessage —— 那是**整个会话的能力边界**，全体参与者共用同一份。member 能发言不等于
能改所有人的工具集与数据范围。`POST /:id/resume` 因此要 `manage_session`（owner-only）。

权限固定这五档，不做动态 ACL —— 会话角色、业务角色、审批策略、工具策略已经叠了好几层，
再叠一套 permission DSL 会失控。成员资格由 owner 控制（邀请制）：参与者共享同一个
conversation / workspace / data scope / 工具与 MCP 能力，所以"这个人的数据权限是否覆盖
本会话的数据范围"这件事发生在 owner 决定邀请的那一刻。

判定只有一条路径：`SessionAccessService.resolve(sessionId, principal) → { mode, role, owner }`，
再经 `assertCanView / assertCanSend / assertCanManageMembers / assertCanManageSession / assertCanDelete`。
`SessionRegistry.assertOwner` 只回答"你是 owner 吗"，不再承担"你能做什么"。

**会话读取的真相源是 registry（`agent_session`），不是 runtime 的磁盘索引**：
会话的**存在与归属**以 registry 为准，runtime 的 `client.listSessions()` 只用来补充
`startTime / modifiedTime / summary / context`、以及标记 `attached`。反过来（拿磁盘列表 ∩
允许集合）会漏会话：多副本部署下每个 Pod 有自己的 runtime 磁盘索引，刚创建或由别的副本创建的
会话不在本 Pod 的列表里，却明明在共享的 registry 里 —— 用户会在会话列表里看不到自己的会话，
`GET /sessions/:id` 也会误报 404。registry 有记录就直接返回，磁盘索引缺失只说明本 Pod 的
runtime 还没见过它。

### 3.3 Session Access / Execution Command / Business Authorization

授权逐层收窄，三层不能互相替代：

```text
Session Access          能不能进这个会话、能不能发言          （3.2 的五档权限）
      ↓
Execution Command       能不能指挥这一个 execution          （run / cancel / propose action）
      ↓
Business Authorization  能不能做这个业务动作、要不要人批、谁有资格批
```

**指挥一次 execution 是独立的一层**，不属于 `view / send / manage_members / manage_session / delete`
里的任何一档，判定走 `SessionAccessService.assertCanCommandExecution(sessionId, principal, execution)`：

- owner：可指挥本会话任意 execution；
- member：只能指挥**自己发起**的（`initiated_by_user_id` 是自己）；
- observer：不可。

`view` 是"看得见"，`command` 是"能动手"。observer 有 `view` 不等于有 `run / cancel / propose-action`：
只判 `view` 会让 observer 取消别人的执行、或对别人的 execution 提 `submit_proxy_vote` 这类业务意图。

**`run` / `cancel` / `propose-action` 三个端点走同一档判定**，不各判各的。
`/run` 早期只判 `send`，结果是 member 能把别人发起的 execution 跑起来、却取消不了它 ——
"owner 或发起人才能指挥 execution"这句话就不成立了。三种命令统一为
`assertCanCommandExecution`，规则只有一条，端点之间不会再漂移。

本层通过与否**都不影响第三层**：高风险动作照旧要过 ActionPolicy 与人工审批（见第 6 节），
只是连会话门都进不来的请求根本走不到那一层。

### 3.4 Shared Session 不变式

1. `collaborationMode` 创建后不可修改：`resume` 传模式返回 400；存储层 `update` 不写这一列。
   改模式的唯一入口是 `SessionRegistry.setCollaborationMode()`（一条裸 `update collaboration_mode`），
   它**当前不暴露为 HTTP API、也没有调用方**，只预留给受控迁移。
   要在生产里用它做 `single → shared` 迁移，必须先补上 owner authorization、会话空闲、
   无在途 execution 三项前置检查 —— 这三项**目前不在代码里**，是迁移脚本自身要承担的责任，
   不能指望 registry 兜住（`setCollaborationMode` 是无条件的）。
2. shared 会话只有一个 Copilot runtime session，**同一时刻最多跑一个 agent turn**。
3. **session 级能力是全体 active participant 的共同边界**：conversation / workspace / data scope /
   session 级工具与 MCP，participant 不因自己的 membership 获得任何额外 MCP / skill / workspace /
   data capability；要被加进来，得先满足本会话的 data / capability eligibility。
   也就是 shared session = shared data boundary，这一点在邀请那一刻定死。
4. 会话成员资格只给**协作访问权**，不给业务授权：审批仍由 `Principal.roles` → `ApprovalPolicy` 决定。
   加进共享会话 ≠ 获得高风险动作的执行权。
5. **session owner 永远不是 execution actor 的隐式替代。** 每次 human-initiated execution 都必须
   记录真实发起人：`agent_execution.user_id` 是**会话 owner**（resume 的归属校验、数据范围），
   `initiated_by_user_id` 是**发起人**（审计、以及 SoD"发起人不能自批"）。
   session owner 从不被当作 execution 的 actor。
6. execution / human task 的可见性跟随它所属的 session：shared 会话里，参与者能看到同会话中
   别人发起的 execution 与待办任务 —— 这正是协作的语义，按 `tenantId/userId` 收窄会漏掉它们。
7. 改会话配置（`resume`）与指挥一次 execution 是两件不同的事，判定分开：
   前者 owner-only（`manage_session`），后者 owner 可指挥任意、member 只能指挥自己发起的（见 3.3）。
8. 读接口的准入是"管理令牌 = 可见范围放大器"，不是独立闸门（见第 10 节）：
   带 `x-admin-token` 看全量，否则退到会话可见性；否则配了令牌的部署里，
   参与者读不到自己会话的执行时间线，而会话详情却读得到。

### 3.5 Shared Message / Execution Queue

`agent_message` 是应用层 transcript，**不是 Copilot history 的替代品**：Copilot history 是
agent context，这里记的是"谁在什么时候说了什么"，用于协作展示与审计（runtime session 丢了也查得到）。
`client_message_id` 是幂等键：多人 UI 必然出现"已保存但响应丢失 → 客户端重试"，
没有它就会为同一条消息跑两次 agent turn；命中时沿用已有的消息与 execution，不再排队。
`sequence` 由 `agent_session.message_sequence` 原子自增分配（见 3.6）。

队列就是 `agent_execution` 本身：`status = 'created'` 即"排队中"，不需要另建队列表
（多一张表就多一处不一致要维护）。`SessionCoordinator` 对同一 session 的 drain 串行排队
（链式 promise，因此不会丢唤醒），跑之前把 execution 置 `running`。

**什么算排队项**：`status = 'created'` **且** `source_message_id is not null`。
后者是"这条 execution 由某条会话消息触发"的标记 —— 只有协作路径会有。手工/内部创建的
后台 job 没有来源消息，不该被协作调度器顺手跑掉。

**按什么定序**：`queue_sequence`（镜像来源消息的 `sequence`），不是 `created_at`。
`created_at` 是毫秒串，并发提交时会与消息顺序相反；而 FIFO 必须与 transcript 顺序一致 ——
**用户看到的顺序就是 agent 处理的顺序**。用同一个序号还顺带让"消息序号 / 队列序号 /
agent 执行顺序"三者可互相印证，排查时不需要另做时间对齐。

shared 的 prompt 来自它绑定的会话消息（`execution.sourceMessageId → agent_message.content`）：
execution 上只留脱敏预览，不能当输入用。同一会话并发恒为 1，跨会话仍可并行
（外层还有全局 semaphore 兜底）。

**启动恢复**：`SessionCoordinator.chains` 是进程内状态，Pod 重启后内存里的 worker 就没了 ——
队列（DB 行）还在，但没人会去 drain 它。所以 `index.ts` 的启动顺序是
**建 app → `recoverPending()` → 起 sweeper → `listen`**，恢复在开始接流量之前跑完：

- `running` / `resuming` → 终态 `interrupted`（**不自动重试**）。理由：崩溃时那次 turn
  可能已经把业务动作做出去了（下单、投票、发邮件），自动重跑会二次执行。标志"服务中断过、
  结果未知、需要人看一眼"，重跑必须由人显式发起。
- `created`（排队项）→ 按 `queue_sequence` 重新入队 drain。

**恢复失败 = 不接流量**。`recoverPending()` 抛错时进程置退出码 1 直接返回：不 `listen`、
不置 ready，交给编排层重拉。恢复成功是这套服务能安全对外服务的前提 —— 没恢复完就放流量，
既会让新请求刚置成 `running` 的 execution 被恢复顺手改成 `interrupted`，又会让队列里的
`created` 永远没人 drain。逐条补写 `interrupted` 审计事件时按条 try/catch：某条写入失败
（例如 execution 指向已被删除的会话）只记一条 warn，不让一条坏记录把整轮恢复带走。

**就绪信号**：`index.ts` 维护一个生命周期状态（`starting → ready → draining`，见 `lifecycle.ts`），
`GET /api/health/ready` 只在 `ready` 时返回 200 —— 恢复没跑完时是 `503 starting`，
编排层据此"先别放流量"。关闭时先置 `draining`（同样是 503）再 `server.close()`；但 `close()`
会一并关掉监听套接字，所以关闭期**新**发起的探测通常拿到的是连接被拒而非 503，
两种都表达"未就绪"。要让探测必定看到 503，得靠 `preStop` 宽限期把摘流与关端口错开。

多副本下这份"谁在跑"仍是进程内状态，需要 DB 租约 + runtime affinity，见第 7 节。

### 3.6 SessionEvent

`session_event` 与 `execution_event` 职责不同、不互相取代（见第 8 节）：前者是协作时间线
（谁发言、谁加入、队列怎么动，供 UI 与断线续传），后者是长期保存的审计证据链。
token 级 `assistant.delta` 只走 SSE、不落库（每个 delta 写一行会造成巨大写放大）。
事件 `sequence` 同 session 内单调递增，客户端用 `?after=` / `Last-Event-ID` 断线续传。

**序号由分配器列原子自增给出，不用 `select max(sequence)+1`**：

```text
agent_message.sequence     ← agent_session.message_sequence     update ... set x = x + 1 returning
session_event.sequence     ← agent_session.event_sequence       update ... set x = x + 1 returning
execution_event.sequence   ← agent_execution.event_sequence     update ... set x = x + 1 returning
```

`max(sequence)+1` 在并发下会让两个写入算出同一个号，再靠 `on conflict do nothing` 兜住就等于
**静默丢事件**，而且调用方拿到的还是一个库里并不存在的序号（广播出去的事件 id 与实际存储对不上）。
序号冲突必须抛错。

**`unique(session_id, sequence)` 是最后一道护栏，不是序号生成机制**：它只保证不重复写进去，
保证不了分配正确 —— 把唯一约束当序号来源，正是上面那个 bug 的成因（见第 7 节）。

内存实现（`COPILOT_STATE_BACKEND=memory`）用独立的计数器，不用 `list.length + 1` ——
事件环形缓冲会裁剪旧事件，长度回退就会重号。

agent 的终稿正文由 `runTurn()` 的**返回值**写入 transcript，且在 execution 落 `completed`
**之前**完成。不能用 `void` 开一个异步回调去写：那样它和 `execution.complete()` 谁先落库不确定，
时间线会错位（完成事件先于它自己的正文）。流式 `onMessage` 只服务实时 UI，不承担持久化。

**共享会话的 `model` 要显式转发给 `runTurn`**：模型在创建 execution 时选定、存在 execution 行上，
跑 turn 时必须把它交给 `runTurn({ model })`（内部 `session.setModel`）。漏传不会报错 ——
只会静默退回 SDK 默认模型，用户选的模型没生效，且从返回结果上看不出区别。

**SSE 断线续传要先订阅再回放**（`subscribeWithReplay`）：先 subscribe（新事件进缓冲区）→
再按 `after` 从库里回放 → 最后 flush 缓冲区并按 sequence 去重。反过来的
「先 list 再 subscribe」会漏掉两步之间写入的那条事件（既不在回放结果里，也不在订阅之后）。
进程内广播只在单副本成立，多副本要把 publish 换成 PG 通知或消息总线（见第 7 节）。

## 4. Execution 状态机

```text
CREATED ──→ RUNNING ──→ COMPLETED / FAILED / CANCELLED
   │          │
   │          └─→ INTERRUPTED（启动恢复：进程崩过，结果未知）
   │
   ├─→ WAITING_FOR_INPUT ──→ RESUMING ──→ RUNNING
   │                      └→ CANCELLED / EXPIRED
   └─→ WAITING_FOR_APPROVAL ──→ RESUMING ──→ RUNNING
                           └→ REJECTED / CANCELLED / EXPIRED
```

- `ExecutionKind`：`interactive`（HTTP chat）/ `job`（后台作业）/ `workflow`
- 非法迁移直接抛错（`ALLOWED_TRANSITIONS`）
- 上面是**状态机允许的迁移**，不等于每条都有人驱动：`WAITING_FOR_INPUT → RESUMING → RUNNING`
  目前没有驱动者（`resuming` 是悬挂态），见 5.2；approval 分支是闭环的
- `created` 在 shared 会话里额外承担"排队中"的语义（见第 3 节）
- `interrupted` 是**终态**，只由启动恢复写入，没有自动出边：崩溃时那次 turn 可能已经把业务
  动作做出去了，自动重跑等于二次执行。要重来必须由人显式发起新 execution。
- **等待人工期间不持有 session lock**：session lock 只覆盖一个 agent turn，不能横跨审批的整个
  生命周期（审批可以几小时）。execution 落到 `waiting_*` 时 `SessionCoordinator.afterRun` 断开
  runtime（`session.disconnect()`）释放锁，会话配置留在 registry；之后要真正再跑 agent turn，
  得经 `resumeExecutionSession()` 用持久化配置重新附着 —— approval 分支由 server 侧执行器收尾、
  用不到它，input 分支需要它但当前没有调用方（见 5.2）

## 5. Human-in-the-loop

### 5.1 Approval：从提议到执行，闭环

```text
agent 提出 ActionIntent
        ↓
ActionService.classify(actionType)
   ├ 未登记策略      → DENIED（默认拒绝，不允许 LLM 自己发明高风险动作）
   ├ 自动放行名单    → server 直接执行
   └ 否则            → needs_approval
        ↓
HumanTaskService.createApprovalTask → execution → WAITING_FOR_APPROVAL
        ↓（HTTP 202 返回，SSE 不陪等）
人工审批（ANY / ALL / N_OF_M / SEQUENTIAL）
        ↓ 全部通过
ExecutionService.onHumanTaskResolved
   ├ actionHash 复核        （批准的动作内容没被改）
   ├ resourceVersion 复核   （批准时依据的数据版本仍是当前版本）
   └ ToolPolicy 通过后 → server 侧 executor 执行 → COMPLETED
```

- `actionHash = sha256(canonicalJson(intent 去掉 createdAt))`，执行前重算比对；
  失配 → 回到 `WAITING_FOR_APPROVAL` 并开新审批任务
- `resourceVersion` 是另一维度：批准时的数据版本 vs 执行时的当前版本
- **审批批准的是 intent，不是一次 HTTP 请求**：批准后必须重新校验才能执行
- Separation of Duties：发起人默认不能自批（`allowInitiator` / `COPILOT_ALLOW_INITIATOR_APPROVAL`）。
  这里的"发起人"取 `agent_execution.initiated_by_user_id` —— shared 会话里发起人可能只是
  一个 member，把他误判成 owner 就等于让真正的发起人绕开 SoD
- 审批资格 = `Identity → Role → Policy`；请求体里传 `approverId` 一律忽略。
  审批人不一定在共享会话里（风险/合规岗常常不在），所以**成员资格不参与审批资格判定**，
  只用于"能不能读到这个任务"
- Delegation：`POST /human-tasks/:id/delegate` 留痕 `delegated_from/to/by/at + reason`
- 过期：进程内定时扫描（默认 60s），`OPEN → EXPIRED`，execution 随之 `EXPIRED`

### 5.2 Input：人工补数据，目前没有续跑

input 与 approval 共用 `human_task`，但**收尾方式不同，而且 input 这条链当前是断的**。

```text
execution → WAITING_FOR_INPUT
      ↓  POST /human-tasks/:id/input（按 inputSchema 校验）→ 落 inputValues
HumanTaskService.submitInput → onResolved('input_submitted')
      ↓
ExecutionService.onHumanTaskResolved → transition(resuming)
      ↓
   （到此为止）
```

`input_submitted` 只把 execution 置为 `resuming`，**没有组件接着做**：没人去
`resumeExecutionSession()`、没人把 `inputValues` 拼回 prompt、没人继续 agent turn。
`resuming` 因此是个**没有出边的悬挂态**。

要让 input 也闭环，得补一个 **continuation runner**：在 `input_submitted` 之后接管 `resuming`
的 execution，用 `inputValues` 续跑 agent turn，跑完走 `resuming → running → completed`。
在它存在之前，一个 `resuming` 的 execution 不会自己动，只能靠人显式发起新 execution 兜底；
进程重启时启动恢复会把残留的 `resuming` 归到终态 `interrupted`（见 3.5），
所以它不会无声无息地永久卡在库里。

approval 不需要这个 runner：批准后由 server 侧执行器直接执行动作并收尾 ——
`runAction` 内部一次走完 `waiting_for_approval → resuming → running → completed`。

**提交输入要过 assignee 判定**：`submitInput` 与 `approve` / `reject` / `delegate` / `cancel`
一样按 `isAssignee`（角色命中 / 显式指派 / 被委派，三者之一）放行。只凭 task id 就能写值，
等于把"谁能补这个字段"交给调用方自己声明 —— 补进去的值会直接进 execution 并把它推到 `resuming`。
没显式指定 assignee 的输入任务退到默认角色 `approver`（`COPILOT_DEFAULT_ROLES`）—— 本地单租户够用。
可信身份的部署里角色来自网关，多半没人叫 `approver`，建出来的任务谁都提交不了；所以那种部署下
**创建时直接拒绝**（必须显式给出 `eligibleRoles` 或 `eligibleUsers`），而不是留一个没人能处理的死任务。

### 5.4 任务的可访问面

**写操作（approve / reject / input / delegate / cancel）走同一条判定**：
`getTaskForActor` = 本租户 + `isAssignee`（角色命中 / 显式指派 / 被委派），要动状态再加
"仍 `open` 且未过期"（`getOpenTaskForActor`）。两个顺序上的讲究：

- **tenant 先于 assignee**：跨租户的 taskId 枚举不该命中"有资格"分支，也不该从错误文案里
  泄漏任务是否存在。
- **资格先于"已关闭就直接返回"**：否则知道一个已关闭 taskId 的人，即使完全无权，也能把
  任务内容读回去（`cancel` 曾经如此）。先判资格，再判状态。

**读操作（`GET /api/human-tasks/:id`）认三类人**：admin（管理令牌看全量）、**task 的 assignee**、
**会话参与人**。assignee 这一类必须单列 —— 风险/合规审批人常常不在业务会话里，
只按会话成员资格判定会让审批人读不到自己负责的任务。三类之外一律 403，同样先判 tenant。

**"我的任务"列表（`GET /api/human-tasks`）不接受调用方指定范围**：`tenantId` 与 `assignee`
由服务端按认证身份填，请求里传了也不采纳；否则调用方把 `assignee` 一改就能看到整个 tenant 的任务。

### 5.3 任务收敛恰好一次

`human_task` 的关闭是**条件写**：`update ... set status = ? where task_id = ? and status = 'open'`。
并发审批下只有一个请求能把任务从 `open` 改走，**只有它**触发 `onResolved`
（→ hash/版本复核 → `runAction` → 落终态）。四条关闭路径（`decide` / `submitInput` /
`cancel` / `sweepExpired`）共用这一个原语，各自恰好触发一次。

没有这层时，两个审批者会各自判定"票已凑齐"、各自关闭、各自触发一次 `onResolved` ——
approval 分支由此把**同一个业务动作执行两遍**（`runAction` 在服务端真的下单/投票）。
`unique(task_id, approver_id)` 防的是"同一个人重复投票"，防不住"两个不同的人同时关闭同一个任务"。

进程内还有一把 per-task 串行锁，覆盖「读决策 → 判资格 → 加决策 → 评估 → 关闭」整段，
并在插入决策后重读一次：它让 `evaluate()` 看到稳定的决策集合，避免两个投票者各自只读到
"还差一票"于是**谁都不关闭**（漏收敛）。跨副本时这把锁不生效 —— 条件写仍然保证"不会重复执行"，
但存在"最后一个投票者读到的集合偏旧 → 没人关闭"的漏收敛窗口，兜底是任务过期扫描与人工重提。

## 6. 授权分层（Session Access → Execution Command → Business Action → Approval）

请求从外到内要过四道判定，每道回答不同的问题，不能互相替代：

```text
                          Principal
                              │
                              ▼
                  SessionAccessService
                 （3.2 的五档权限：view / send /
                  manage_members / manage_session / delete）
                              │
                 ┌────────────┴────────────┐
                 ▼                         ▼
           Session View            Execution Command        ← 能不能指挥这一个 execution
                                   run / cancel /               （run / cancel / propose-action）
                                   propose-action                见 3.3
                                            │
                                            ▼
                                Business Action Policy       ← 让不让 agent 做这个动作
                                （actionType → 策略：要不要人批、谁能批）
                                            │
                                      Human Approval
                                            │
                                            ▼
                                 Final Authorization         ← hash + resourceVersion + policy 复核
                                            │
                                            ▼
                             Server-controlled executor（真正的 mutation）
```

executor 拿到的上下文里带一个**幂等键**：`action:{executionId}:{actionHash}`。真实下游（券商网关、
合规模块、邮件网关）必须把它透传过去，用来挡"外部副作用已生效 → 进程在落 `completed` 前崩 → 重试"
造成的重复提交。刻意不绑 `taskId`：重新审批会产出新的 HumanTask，但那仍是同一次业务动作。

工具调用那一侧是另一条正交的链，决定 agent 能用哪些工具、能写到哪：

```text
availableTools（session 级最大集合）
      ↓
Permission Policy（onPermissionRequest：read / write / shell / mcp / url）
      ↓
PreToolUse Policy（强制 hook：写类工具路径必须在 session workspace）
      ↓
Business Action Policy（与上面那条链的第三层是同一个）
```

两个最容易混的边界：

- **`view` ≠ `command`**：能看见一个 execution 不等于能指挥它。observer 只有 `view`，
  没有 `run / cancel / propose-action`（见 3.3）。
- **`Session Access` ≠ `Business Authorization`**：前者是数据边界（谁能进这个会话、
  能发消息吗），后者是业务边界（能不能做这个动作、要不要审批、谁有资格批）。会话访问不通过，
  请求根本进不来；通过之后（含 execution command 也通过），高风险动作照旧要过 ActionPolicy
  与人工审批。两层合并就等于把"能进这个会"当成"能替这个会签字"。

高风险 mutation（`submit_proxy_vote` / `submit_trade` / `send_external_message` / `delete_data`）
**不作为普通模型工具暴露**：agent 只能 `propose_action`，执行器在服务端
（`server/src/actions/action-registry.ts`）。agent 侧入口见 `scripts/governance-mcp.mjs`。

## 7. 并发与锁

| 机制 | 作用域 | 说明 |
|------|--------|------|
| attach lock | resume | 并发首访只允许一个 request 真正 resume |
| session lock | **一个 agent turn** | 不能覆盖 human task 的整个生命周期（审批几小时不占锁） |
| per-session 队列 | **一个 session** | `status='created'` 的 execution 即队列项；shared 的 drain 串行，跨 session 并行 |
| 全局 semaphore | 全进程 | `COPILOT_MAX_CONCURRENT_EXECUTIONS`，防止 N 个用户同时烧满 runtime |
| DB 唯一约束 | 跨副本 | **最后一道护栏，不是序号生成机制**：`unique(task_id, approver_id)`、`unique(session_id, sequence)`、`unique(execution_id, sequence)`、`unique(session_id, client_message_id)` |

**唯一约束 ≠ 序号分配器**：`unique(session_id, sequence)` 能在重号时把第二个写入挡回去，
但它挡不住"两个写入先算出同一个号"这件事本身 —— 那是分配阶段的职责（见 3.6）。
把唯一约束当序号来源（`select max(sequence)+1` + `on conflict do nothing`）的后果是
**静默丢事件**，而且对外广播的是库里并不存在的序号。分配器是独立的列，走原子自增。

### 多副本要补的三件事

`replicas = 1` 下，上面这些进程内状态都成立。要多副本，缺的是三件具体的东西：

1. **谁拥有这个 session 的 turn** —— 现在是进程内 session lock；要换 DB 租约
   （`pg_advisory_xact_lock(hash(sessionId))` 或一张 lease 行）。
2. **哪个 Pod 持有 Copilot runtime session** —— runtime 是本地进程里的对象，
   不能跨 Pod 附着；要 runtime affinity，让某个 session 的 resume 只落在持租约的实例上。
3. **SessionEvent 怎么跨 Pod 广播** —— 现在是进程内 EventEmitter；要换成 PG `listen/notify`
   或消息总线，SSE 订阅端才能收到别的 Pod 写的事件。

方向是 PostgreSQL（advisory lock + lease 行 + notify），不需要引入 Redis / Kafka。
当前保持 `replicas: 1`。

## 8. 审计分层（不要互相取代）

| 层 | 回答什么 | 存哪里 |
|----|---------|--------|
| LangSmith / trace | runtime observability：延迟、trace | 外部 |
| ExecutionRecord | 当前状态、usage、tool 证据（查询优化） | `agent_execution` |
| ExecutionEvent | 谁批准、何时、依据什么、后来为什么执行 | `execution_event` |
| Approval / HumanTask | 授权证据 | `human_task` + `human_task_decision` |
| SessionEvent | 这个会话对所有参与者发生了什么（协作时间线） | `session_event` |

`ExecutionEvent` 是**审计证据链**（这次执行发生了什么，长期保存）；
`SessionEvent` 是**协作时间线**（谁发言、谁加入、队列怎么动，供 UI 与断线续传）。
两者的读者、保留期、粒度都不同：共享会话里参与者都能看 SessionEvent，
而 ExecutionEvent 只在能访问该会话的前提下才可读。

写入前统一 `脱敏 → 截断`：`redact.ts` 按 key（token/api_key/authorization/password/secret…）
与值形态（Bearer / sk- / ghp_ / JWT / AKIA…）替换，再截断只报长度
（`COPILOT_EVIDENCE_MAX_CHARS`）。完整 prompt / tool 结果 / 模型上下文不入库；
真正需要完整证据时写对象存储，库里只留 `artifact_uri + sha256`。

## 9. 数据模型（PostgreSQL）

**SQLite（默认）**：schema 内嵌在 `server/src/db/sqlite-schema.ts`，首次连接自动应用，
无需任何迁移命令。写成 TS 常量而不是 `.sql` 文件，是为了让构建产物自带 schema
（`tsc` 只产 JS，运行时再去磁盘找 `src/**/*.sql` 在容器里会失效）。

**PostgreSQL（可选）**：增量迁移，由运维应用：

```bash
psql "$DATABASE_URL" -f server/src/db/migrations/001_agent_execution.sql
psql "$DATABASE_URL" -f server/src/db/migrations/002_collaboration.sql
psql "$DATABASE_URL" -f server/src/db/migrations/003_workflow.sql
```

两份 DDL 的表名与列名**必须完全一致**（共用同一份仓储实现），`test/schema.test.ts` 逐列比对。

**已有库文件的升级路径**：`create table if not exists` 对**已存在**的表什么都不做，
所以老版本建的 `agent.db` 直接升上来会缺列。SQLite 侧由 `db/sqlite.ts` 启动时按
`SQLITE_COLUMN_UPGRADES` 逐条查 `pragma_table_info`、缺列才 `alter table`（等价于 PG 的
`add column if not exists`）；补列语句只允许补 `CREATE TABLE` 里已声明的列，测试会拦。

| 表 | 关键字段 |
|----|---------|
| `agent_session` | session_id, tenant_id, user_id, workspace_path, status, **collaboration_mode**, **message_sequence**（消息序号分配器）, **event_sequence**（会话事件序号分配器）, **config**（resume 用，不含凭证） |
| `session_participant` | session_id, tenant_id, user_id, role(owner/member/observer), status(active/left/removed), joined_at, left_at, `primary key(session_id, user_id)` |
| `agent_message` | message_id, session_id, sequence, actor_type(user/agent), actor_id, **client_message_id**（幂等键）, content, execution_id, `unique(session_id, sequence)`、`unique(session_id, client_message_id)` |
| `session_event` | event_id, session_id, sequence, type, actor_type, actor_id, execution_id, message_id, payload, `unique(session_id, sequence)` |
| `agent_execution` | execution_id, session_id, tenant/user（= 会话 owner）, **initiated_by_user_id**（发起人）, **source_message_id**, **queue_sequence**（队列定序键，镜像来源消息序号）, **event_sequence**（执行事件序号分配器）, kind, status, action_intent, **action_hash**, resource_version, approved_resource_version, current_human_task_id, usage, tool_calls, content_chars, **workflow_state**（Skill Flow 的 durable 状态，见第 11 节） |
| `human_task` | task_id, execution_id, type, status, payload, **input_values**（人工输入回填）, input_schema, policy_id, strategy, required_count, eligible_roles/users, initiated_by, expires_at, delegated_* |
| `human_task_decision` | decision_id, task_id, approver_id, approver_role, decision, comment, `unique(task_id, approver_id)` |
| `execution_event` | execution_id, sequence, type, actor_type, actor_id, payload, `unique(execution_id, sequence)` |

`*_sequence` 三列都是**分配器**，不属于对外记录本身：registry 的 `insert` / `update` 都不写它们
（只写归属、workspace、status、config、时间戳），所以 `saveConfig` / `touch` 这类高频写入
不会把序号打回 0。

**多副本要用的列，现在不建**：第 7 节那三件事的落地载体，是 `agent_session` 上的
`session_lease_owner` / `session_lease_until` / `runtime_instance_id`。它们**不属于当前的
SQLite / single-replica 模型**，现在不加 —— 加了也没有写入方，只会变成误导性的空列。
真要上多副本，连同租约续期与 runtime affinity 一起补，而不是先把列摆上占位。

**索引必须在补列之后建**：`create table if not exists` 不会给老表加列，若索引与建表放在同一条
exec 里，老库文件就会在建出 `queue_sequence` 之前引用它 → `no such column`，服务起不来。
所以 schema 拆成「建表 SQL → 补列 → 建索引 SQL」三步，新库老库走同一条路径。

类型映射（SQLite）：`jsonb → text`（JSON 文本）、`timestamptz → text`（ISO 8601）、
`boolean → integer`（0/1）、`bigserial → integer primary key autoincrement`。
时间戳列刻意不设 SQL default —— 应用层一律显式写 ISO 字符串，混排会破坏排序。
`pragma foreign_keys = ON` 必须开（默认关），否则 `on delete cascade` 不生效：
删 `agent_session` 会级联清掉它的参与人 / 消息 / 事件；`agent_message.execution_id` 与
`session_event.execution_id` 不设 FK —— 消息与事件先于 execution 存在，删 execution 不该抹掉会话记录。

`COPILOT_STATE_BACKEND=memory` 可强制内存实现（不落盘，仅临时验证），重启即丢。

## 10. API

| 组 | 端点 |
|----|------|
| Session | `POST /api/sessions`、`GET /api/sessions`、`GET /api/sessions/:id`（含 mode/owner/participants）、`POST /:id/resume`、`DELETE /:id[?permanent=true]`、`POST /:id/chat` |
| 协作 | `GET /:id/participants`、`POST /:id/participants`、`DELETE /:id/participants/:userId`、`POST /:id/leave`、`GET /:id/messages`、`GET /:id/events`（SSE） |
| Execution | `POST /api/executions`（202）、`GET /api/executions`、`GET /:id`、`GET /:id/events`、`GET /:id/tasks`、`POST /:id/run`（202，后台跑）、`POST /:id/cancel`、`POST /:id/actions`（提议动作） |
| HumanTask | `GET /api/human-tasks`（我的）、`GET /api/human-tasks/all`、`GET /:id`、`POST /:id/approve`、`POST /:id/reject`、`POST /:id/input`、`POST /:id/delegate`、`POST /:id/cancel` |
| 元信息 | `/api/providers`、`/api/models`、`/api/agents`、`/api/mcp`、`/api/mcp/test`、`/api/hooks`、`/api/debug` |

`POST /:id/chat` 的行为按模式分叉：**single** 返回 SSE（首帧 `execution`，随后
`delta/message/subagent`，结束 `done`）；**shared** 落消息 + 入队后立刻 202，结果走
`GET /:id/events`。`GET /:id/events` 支持 `?after=<sequence>` 与 `Last-Event-ID` 续传
（先订阅再回放，见第 3 节），另有心跳帧。

写接口的准入分两层：先会话权限（3.2 的五档），再过额外授权（command 判定、状态机、业务策略）。
一律挂 `view` 是不行的：

| 端点 | 会话权限 | 额外授权 |
|------|---------|---------|
| `POST /:id/chat` | `send` | — |
| `POST /:id/participants` / `DELETE .../:userId` | `manage_members` | — |
| `POST /:id/resume` | `manage_session` | collaborationMode 不可变（传了 400） |
| `DELETE /:id` | `delete` | — |
| `POST /executions` | `send` | — |
| `POST /executions/:id/run` | — | command 判定（与下面两条同档）+ execution 当前状态（见第 4 节） |
| `POST /executions/:id/cancel` | — | command 判定：owner 任意 / member 仅自己发起 / observer 不可 |
| `POST /executions/:id/actions` | — | command 判定 + Business Action Policy（未登记 → 403、需审批 → 202 + taskId） |

读端点（`GET /:id`、`GET /:id/events`、`GET /:id/tasks`、`GET /executions/*`）一律要 `view`
再加下面的读准入 —— **没有额外授权**。

**读接口的准入**：`readAccess(req)` 给出 `all | scoped | denied` 三态 ——
带 `x-admin-token`（且部署真的配了令牌）为 `all`（看全量）；否则若信任身份头则为 `scoped`
（收窄到自己拥有/参与的会话）；两者都没有、又配了令牌则为 `denied`（401）。
没配令牌也不信任身份头 = 单租户本地开发，直接 `all`。

为什么不是 `requireAdmin`：execution 的可见性本就跟着 session 走，管理令牌只回答
"是否无视会话边界看全量"，不回答"能否读这个会话"。挂成 `requireAdmin` 会让配了令牌的部署里，
共享会话的参与者读不到同会话的执行时间线（而 `GET /sessions/:id` 却读得到），协作读路径被截断。
`/api/human-tasks/all` 与 `/api/debug`、`/api/hooks` 仍是纯管理视图，继续用 `requireAdmin`。

`requireAdmin` 是三态，而不是"没配令牌就放行"：没配 `COPILOT_ADMIN_TOKEN` 且未开可信身份头
→ 单租户本地开发，放行；**没配令牌但开了可信身份头 → 一律 401**（否则"能伪造/注入身份头"
就等于拿到管理权限）；配了令牌 → 必须带对。第三态是第一版漏掉的：它让
`trustIdentityHeaders=true` 但忘配令牌的部署把 `/all`、`/debug` 敞开了。

`GET /api/human-tasks/:id` 不走 `readAccess` 的"会话可见性收窄"，而是认**三类人**：
admin / task 的 assignee / 会话参与人（见 5.4）。审批人不等于会话成员，只按会话判定会误伤。

**等待审批不靠 SSE 长连接** —— 用 `GET /executions/:id/events` 轮询或订阅。

### 错误 → 状态码（单一真相源）

service 层抛的是 `Error`，路由按**消息前缀族**映射状态码，规则集中在
`middleware/error-status.ts`，由路由内的 `sendServiceError` 与兜底的 `errorHandler`
共用一份。分开放两份必然会漂移，而漂移的表现就是「该 403 的变成 500」—— 曾经
`/无权访问/` 精确匹配，而"能不能写"抛的是「无权发消息到 session」，于是 observer 被拒
反而 500。

| 族 | 判据 | 状态码 |
|----|------|--------|
| 权限拒绝 | 以「无权」开头（查看 / 发消息到 / 管理成员 / 删除 / 委派 / 取消 / 审批） | 403 |
| 对象不存在 | 不存在 / 无法恢复 / 无法删除 | 404 |
| 调用方写错 | 参数校验（非法/缺少/必须/不是）、业务规则（不能/没有/无需/已经/未轮到）、状态冲突（已存在/已关闭/已过期）、配置（未知/可选：/被拒绝/解析失败） | 400 |
| 认不出来 | —— | 交给兜底 500 |

判据用**具体词**而非「已」「未」这类单字：`ActionService 未注入（wiring 缺失）`、
`写入通道尚未装配` 是服务端装配故障，必须留 500 —— 否则"服务端炸了"会被伪装成
"用户传错了"。文案清单由 `test/http-errors.test.ts` 逐条覆盖，**新增抛错文案必须补进那张表**。

## 11. Skill Flow：SKILL.md 上的编排层

一次业务流程（研究 → 合规门禁 → 合规审核 → 投资审核 → 发布）不是一次 agent turn 能做完的：中间要等人，要做确定性判断，要做受控的业务动作。**编排本身不新造 runtime。**

不引入 BPMN，不引入 XState，不做第二套 YAML DSL。流程定义写在**已有的 SKILL.md 里**，用 Markdown AST 解析：

```text
SKILL.md（Markdown）
    ↓ remark-parse（## @xxx 块 + `- outcome -> 目标` 路由）
FlowDefinition（6 种节点）
    ↓
WorkflowRunner ── 复用现有 Execution / HumanTask / Action 三层
```

理由很直接：编排要的是"下一步去哪"，而这件事的全部信息已经在技能文件里。再引一套 DSL 就会有两份流程定义、两套权限语义、两套审计口径 —— 而 authority 已经在服务端了（见第 6 节），DSL 不会让它更安全，只会让它更难对齐。

### 11.1 七种块

块必须是 `##`（depth 2）标题，`@` 开头；路由是块正文里的 `- <出口> -> <目标节点 id>` 列表项：

| 块 | 作用 | 复用 | 出口 |
|----|------|------|------|
| `@flow <id>` | 流程入口，正文第一行是 `start -> <节点 id>` | — | — |
| `@subagent <技能名>` | 跑一次技能：节点正文就是给 LLM 的 prompt | `runExecutionTurn`（同一个 session / model / tool policy / 工具证据） | `success` / `fail` |
| `@gate <注册名>` | 确定性判断，结果只来自服务端注册的实现 | registry 里的 gate 函数 | gate 自己返回的 outcome |
| `@review <注册名>` | 人工审核 | HumanTask + ApprovalPolicy | `approve` / `reject` |
| `@action <注册名>` | 业务动作 | `proposeAction`（策略 → 审批 → hash/版本复核 → executor） | `success` / `fail` |
| `@stop <id>` | 失败/拒绝终态 → execution 落 `failed` | — | 无 |
| `@end <id>` | 成功终态 → execution 落 `completed` | — | 无 |

这三类节点各自看着像"新能力"，实际全部是复用，差别只在收尾方式：

- `@review` 建出来的是**普通 HumanTask**（`payload.workflow = { nodeId, kind }` 做标记），My Tasks、委派、SoD、租户隔离、审计全都不改一行；wiring 的 dispatcher 按这个标记把收敛事件分给 `WorkflowRunner`，没有标记的仍走 `ExecutionService`。
- `@action` **不直接调 executor**，走完整的 `proposeAction` 链路，所以"上一步人工审核过了，这一步为什么还要批"是特性不是冗余 —— 审核的是"研究结论能不能发布"，批的是"这个 mutation 能不能发出去"，两者不可互相替代。唯一区别是 `completeOnSuccess: false`：动作执行完**不**收尾 execution，因为后面还有节点。
- `@gate` 的判定权在服务端注册的实现里，agent 的自我评价不算数 —— 合规边界不由 LLM 定义。

**权限、角色、审批策略不写在 SKILL.md 里。** 节点只声明"这里需要 compliance-review"，谁有资格批、要几个人批、多久超时，由服务端 registry 决定（`workflow/registry.ts`）。SKILL.md 是会被 LLM 读到、也会被人随手改的文件，不能成为 security boundary。

### 11.2 校验先于执行

`POST /api/executions` 在**建 execution 之前**就把整份流程校验完，不过就 400 并带上行号：

`flow-missing` / `flow-duplicate`、`flow-missing-start`、`node-duplicate`、`route-target-missing`、`node-missing-outcome`、`node-missing-route`（非终态必须至少一条出口）、`terminal-has-route`（`@stop` / `@end` 不能有出口）、`node-unreachable`、`skill-missing`（`@subagent` 指向的技能不存在）。

顺序有讲究：跑到一半才发现某个 `- approve -> xxx` 指向不存在的节点，那时 execution 可能已经停在等待态，或者已经把业务动作提出去了。`@gate` 的出口名无法静态校验（由服务端实现决定），所以这类节点不参与 `node-missing-outcome` 检查，但运行时找不到匹配出口会立刻失败，不做"只有一个出口就兜底"的猜测。

环是**允许**的（`- reject -> investment-research` 是研究流程的常态），所以有硬闸门 `MAX_FLOW_STEPS = 100`：超了就 failed。它刻意不在 DSL 里 —— 这是运行时保护，不是流程语义。

### 11.3 durable state 与 sourceHash

每次推进都先把 `current` 写进 `agent_execution.workflow_state`，**再**执行那个节点。反过来写的话，进程在"跑完但状态没落库"之间退出，重启会把同一步再跑一遍，而 `@action` 那一步可能已经把钱打出去了。状态里含 `current` / `steps` / `waitingTaskId` / `lastOutcome` / `lastOutput`（`@subagent` 输出截断 4000 字符，只作下一步判断依据，不是证据仓库 —— 证据在 tool_calls 里）。

`sourceHash` 是 SKILL.md 的 SHA-256，每次推进前重算比对。它只是一个字段，挡的是金融流程最不该发生的事：已经开始的执行悄悄切到另一个版本的流程定义上继续跑。不一致 → failed + 人工确认，不静默迁移。

### 11.4 API 上没有新增端点

沿用 `/api/executions`，只在 payload 上多两个字段：

```http
POST /api/executions
{ "sessionId": "...", "kind": "workflow", "skill": "investment-research", "flow": "investment-review" }
→ 202 { executionId, status, workflow: { skill, flow, current, steps } }

POST /api/executions/:id/run     # workflow 不需要 prompt（步骤说明在 SKILL.md 里，传了 400）
```

`/run` 按 `record.kind` 分派：`interactive` / `job` → SessionCoordinator，`workflow` → WorkflowRunner。**不新增 `/workflow/*` 端点** —— 否则同一个 execution 会有两条读取路径、两种清理语义、两套权限矩阵。 `/run` 的权限与 `cancel` / `actions` 同一档（`assertCanCommandExecution`）。

恢复路径：重启后等待态的 workflow execution 靠 `workflow_state.waitingTaskId` 接上 —— 人工任务收敛时 dispatcher 从 task 反查 execution，读 `workflow_state`，重新 `loadChecked` 后续跑。

### 11.5 明确不做

并行分支（fork/join）、定时器与 escalation、子流程调用、表达式与变量、动态生成流程、以及"审批超时自动通过"。这些要么在 Business Action Policy 那一层已经覆盖，要么属于真正的 workflow engine（第 13 节已排除）。当前这套只解决一件事：**把"研究→审核→发布"这类固定步骤串起来，并且串的时候不绕开现有的权限与审计。**

## 12. 目录

```text
server/src/
├── routes/      api.ts(挂载) sessions.ts session-collaboration.ts executions.ts
│                human-tasks.ts meta.ts shared.ts
├── agent/       agent-runner.ts（SDK 事件收口） agent-execution.ts（turn 实现）
│                agent-context.ts agent-events.ts
├── collaboration/ types repository sql-repository(+memory) collaboration-service
│                session-coordinator message-service participant-service session-event-service
├── services/    session-service session-access session-registry turn-runner
│                workspace-service tool-policy tool-evidence principal concurrency task-sweeper
├── execution/   types execution-service sql-repository(+memory)
│                events hash usage redact
├── human-tasks/ types repository sql-repository(+memory) human-task-service assignment
├── approval/    types approval-policy approval-service
├── actions/     action-registry（server-controlled executor） action-service
├── workflow/    types registry（gate/review/action 的服务端注册） runner（编排器）
├── skills/      index（加载 / sourceHash） flow-parser（remark AST → FlowDefinition）
│                flow-validator（行号级校验）
├── db/          connection.ts（后端选择） dialect.ts（方言钩子）
│                sqlite.ts + sqlite-schema.ts（默认后端：建表 / 补列 / 建索引 三步）
│                postgres.ts（可选）
│                migrations/001_agent_execution.sql 002_collaboration.sql 003_workflow.sql
├── middleware/  error-status.ts（错误→状态码的单一真相源） errorHandler.ts（兜底）
├── providers/ agents/ skills/ mcp/ hooks/
├── wiring.ts    依赖装配（SQLite / PostgreSQL / Memory）
├── lifecycle.ts 生命周期状态（starting / ready / draining）→ 健康就绪判定
└── index.ts     启动：recoverPending()（崩溃恢复）→ 起 sweeper → listen → markReady()
```

## 13. 明确不做

Temporal / BPMN / Camunda / Kafka / Redis / 通用 workflow DSL / A2A EventBus。

协作方向同样明确不做：

1. **参与人私有上下文**（每人一套 conversation / 工具集 / data scope）—— 那等于把会话拆成多个 runtime，
   协作语义随之消失；
2. **按参与人切换 MCP 与 runtime**（同一会话不同人看到不同工具）—— 工具集属于会话，不属于人；
3. **运行中改会话模式**（`single ⇄ shared`）—— 模式不可变是访问判定的前提；
4. **通用分布式队列 / 消息中间件**（Redis / Kafka / 通用 workflow engine）—— 队列就是
   execution 表，`replicas: 1` 下进程内串行已足够。

"不做分布式队列"与"将来要支持多副本"不冲突，两者是不同的东西：

| | 现在 | 扩展方向 |
|---|---|---|
| 队列 | `agent_execution` 表 + 进程内 per-session 串行 | 不变（表就是队列，不需要中间件） |
| 多副本调度 | 不做（`replicas: 1`） | PostgreSQL advisory lock + DB 租约 + runtime affinity（第 7 节） |
| 跨副本事件广播 | 进程内 EventEmitter | PG `listen/notify` 或消息总线 |

也就是说：**不做 Redis / Kafka 这类通用分布式队列 ≠ 永远不做多副本 session lease。**
前者是"不引入中间件"，后者是"把进程内状态搬进已有的 PostgreSQL"。

**向量检索**：当前没有语义检索需求（无 embedding 通道，也没有"按相似度召回"的功能），
因此不建向量表、不接 embedding 服务 —— 留出接入点而不是先堆空壳：

- SQLite：`COPILOT_SQLITE_EXTENSIONS=/path/to/vec0.dylib` 即可加载 sqlite-vec
  （`node:sqlite` 的 `loadExtension`，执行器已支持；加载失败只记日志不影响启动）。
- PostgreSQL：可启用 `pgvector`，在 `db/dialect.ts` 加一个距离函数钩子，
  仓储照旧一份实现。

真要做时补：embedding 通道 + 一张 `agent_embedding(owner_kind, owner_id, model, dim, vector)`
+ 一次 kNN 查询，不必改动现有表结构。

业务状态是确定的（审批确定、状态确定），`Application State Machine + PostgreSQL` 足够。

也明确不做的三件事：

1. 不让 LLM 决定谁能批准、要几票、什么算高风险——只提 intent；
2. 不把 human approval 做成 “prompt 里请等人批准”；
3. 不把 `approveAll` 当作长期策略（已按 read/write/shell/mcp/url 分级裁决）。

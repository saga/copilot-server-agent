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

### 角色与权限

会话角色（owner / member / observer）与业务角色（risk / compliance / …）是两层，不能互相替代：

| 会话角色 | view | send | manage_members | delete |
|---------|------|------|----------------|--------|
| owner | ✓ | ✓ | ✓ | ✓ |
| member | ✓ | ✓ | | |
| observer | ✓ | | | |

权限固定这四档，不做动态 ACL —— 会话角色、业务角色、审批策略、工具策略已经是四层，
再叠一套 permission DSL 会失控。成员资格由 owner 控制（邀请制）：参与者共享同一个
conversation / workspace / data scope / 工具与 MCP 能力，所以"这个人的数据权限是否覆盖
本会话的数据范围"这件事发生在 owner 决定邀请的那一刻。

判定只有一条路径：`SessionAccessService.resolve(sessionId, principal) → { mode, role, owner }`，
再经 `assertCanView / assertCanSend / assertCanManageMembers / assertCanDelete`。
`SessionRegistry.assertOwner` 只回答"你是 owner 吗"，不再承担"你能做什么"。

### 不变式

1. `collaborationMode` 创建后不可修改：`resume` 传模式返回 400；存储层 `update` 不写这一列，
   只有"单→共享"迁移脚本能经 `setCollaborationMode` 改（要求会话空闲、无在途执行、owner 确认）。
2. shared 会话只有一个 Copilot runtime session，**同一时刻最多跑一个 agent turn**。
3. 参与人共享同一个 conversation / workspace / data scope 与 session 级工具、MCP 能力。
4. 会话成员资格只给**协作访问权**，不给业务授权：审批仍由 `Principal.roles` → `ApprovalPolicy` 决定。
   加进共享会话 ≠ 获得高风险动作的执行权。
5. 每次 execution 都记发起人，且与数据归属分开：
   `agent_execution.user_id` 是**会话 owner**（resume 的归属校验、数据范围），
   `initiated_by_user_id` 是**发起人**（审计、以及 SoD"发起人不能自批"）。
   session owner 从不被当作 execution 的 actor。
6. execution / human task 的可见性跟随它所属的 session：shared 会话里，参与者能看到同会话中
   别人发起的 execution 与待办任务 —— 这正是协作的语义，按 `tenantId/userId` 收窄会漏掉它们。

### 队列

队列就是 `agent_execution` 本身：`status = 'created'` 即"排队中"，不需要另建队列表
（多一张表就多一处不一致要维护）。`SessionCoordinator` 对同一 session 的 drain 串行排队
（链式 promise，因此不会丢唤醒），取活按 `created_at, execution_id` 定序
（时间戳毫秒级会并列，所以带一个确定的次级键），跑之前把 execution 置 `running`。

shared 的 prompt 来自它绑定的会话消息（`execution.sourceMessageId → agent_message.content`）：
execution 上只留脱敏预览，不能当输入用。同一会话并发恒为 1，跨会话仍可并行
（外层还有全局 semaphore 兜底）。

这份"谁在跑"是**进程内状态**：单副本部署成立。多副本需要 DB 租约 + runtime affinity，
见第 7 节。

### 消息与事件

- `agent_message` 是应用层 transcript，**不是 Copilot history 的替代品**：Copilot history 是
  agent context，这里记的是"谁在什么时候说了什么"，用于协作展示与审计（runtime session 丢了也查得到）。
- `client_message_id` 是幂等键：多人 UI 必然出现"已保存但响应丢失 → 客户端重试"，
  没有它就会为同一条消息跑两次 agent turn。命中时沿用已有 execution，不再排队。
- `sequence` 从 `agent_session.message_sequence` **原子自增**分配（`update ... returning`），
  不用时间戳 —— 并发下时间戳会并列，做不了唯一次序。
- `session_event` 与 `execution_event` 职责不同、不互相取代（见第 8 节）。token 级
  `assistant.delta` 只走 SSE、不落库：每个 delta 写一行会造成巨大写放大。
- 事件 `sequence` 同 session 内单调递增，客户端用 `?after=` / `Last-Event-ID` 断线续传；
  进程内广播只在单副本成立，多副本要把 publish 换成 PG 通知或消息总线。

## 4. Execution 状态机

```text
CREATED ──→ RUNNING ──→ COMPLETED / FAILED / CANCELLED
              │
              ├─→ WAITING_FOR_INPUT ──→ RESUMING ──→ RUNNING
              │                      └→ CANCELLED / EXPIRED
              └─→ WAITING_FOR_APPROVAL ──→ RESUMING ──→ RUNNING
                                      └→ REJECTED / CANCELLED / EXPIRED
```

- `ExecutionKind`：`interactive`（HTTP chat）/ `job`（后台作业）/ `workflow`
- 非法迁移直接抛错（`ALLOWED_TRANSITIONS`）
- `created` 在 shared 会话里额外承担"排队中"的语义（见第 3 节）
- **等待人工期间不持有 session lock**：持久化状态 → `session.disconnect()` → 释放锁；
  审批完成后 `resumeSession` 继续（`resumeExecutionSession()` 用持久化的会话配置恢复）——
  `SessionCoordinator.afterRun` 在 execution 落到 `waiting_*` 时做这件事

## 5. Human-in-the-loop

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

## 6. 授权三层（Tool Policy ≠ Business Action Policy）

```text
availableTools（session 级最大集合）
      ↓
Permission Policy（onPermissionRequest：read / write / shell / mcp / url）
      ↓
PreToolUse Policy（强制 hook：写类工具路径必须在 session workspace）
      ↓
Business Action Policy（actionType → 策略：要不要人批、谁能批）
      ↓
Human Approval
      ↓
Final Authorization（hash + resourceVersion + policy 复核）
      ↓
Server-controlled executor（真正的 mutation）
```

```text
会话访问判定（SessionAccessService）  ← 谁能进这个会话、能发消息吗
              ↓ 与上面这条链正交
业务授权（ActionPolicy + ApprovalPolicy） ← 能不能做这个动作、要不要审批、谁有资格批
```

两层不能合并：前者是数据边界，后者是业务边界。会话访问判定不通过，请求根本进不来；
通过之后，高风险动作照旧要过 ActionPolicy 与人工审批。

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
| DB 唯一约束 | 跨副本 | `unique(task_id, approver_id)`、`unique(session_id, sequence)`、`unique(session_id, client_message_id)` |

`replicas > 1` 时这份状态不再够用：内存 session lock、进程内 session 事件广播、
"谁在跑这个会话"三处都要换。方向是 PostgreSQL advisory lock
（`pg_advisory_xact_lock(hash(sessionId))`）+ DB 租约 + runtime affinity
（session 的 Copilot runtime 只在持有租约的实例上可 resume），不需要引入 Redis。
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
```

两份 DDL 的表名与列名**必须完全一致**（共用同一份仓储实现），`test/schema.test.ts` 逐列比对。

**已有库文件的升级路径**：`create table if not exists` 对**已存在**的表什么都不做，
所以老版本建的 `agent.db` 直接升上来会缺列。SQLite 侧由 `db/sqlite.ts` 启动时按
`SQLITE_COLUMN_UPGRADES` 逐条查 `pragma_table_info`、缺列才 `alter table`（等价于 PG 的
`add column if not exists`）；补列语句只允许补 `CREATE TABLE` 里已声明的列，测试会拦。

| 表 | 关键字段 |
|----|---------|
| `agent_session` | session_id, tenant_id, user_id, workspace_path, status, **collaboration_mode**, **message_sequence**（消息序号分配器）, **config**（resume 用，不含凭证） |
| `session_participant` | session_id, tenant_id, user_id, role(owner/member/observer), status(active/left/removed), joined_at, left_at, `primary key(session_id, user_id)` |
| `agent_message` | message_id, session_id, sequence, actor_type(user/agent), actor_id, **client_message_id**（幂等键）, content, execution_id, `unique(session_id, sequence)`、`unique(session_id, client_message_id)` |
| `session_event` | event_id, session_id, sequence, type, actor_type, actor_id, execution_id, message_id, payload, `unique(session_id, sequence)` |
| `agent_execution` | execution_id, session_id, tenant/user（= 会话 owner）, **initiated_by_user_id**（发起人）, **source_message_id**, kind, status, action_intent, **action_hash**, resource_version, approved_resource_version, current_human_task_id, usage, tool_calls, content_chars |
| `human_task` | task_id, execution_id, type, status, payload, **input_values**（人工输入回填）, input_schema, policy_id, strategy, required_count, eligible_roles/users, initiated_by, expires_at, delegated_* |
| `human_task_decision` | decision_id, task_id, approver_id, approver_role, decision, comment, `unique(task_id, approver_id)` |
| `execution_event` | execution_id, sequence, type, actor_type, actor_id, payload, `unique(execution_id, sequence)` |

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
`GET /:id/events`。写接口都带会话访问判定：`chat` / `POST /participants` 要 `send` 或
`manage_members`，读接口要 `view`。`GET /:id/events` 支持 `?after=<sequence>` 与
`Last-Event-ID` 续传，另有心跳帧。

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

## 11. 目录

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
├── db/          connection.ts（后端选择） dialect.ts（方言钩子）
│                sqlite.ts + sqlite-schema.ts（默认后端，含补列升级）
│                postgres.ts（可选） migrations/001_agent_execution.sql 002_collaboration.sql
├── providers/ agents/ skills/ mcp/ hooks/
└── wiring.ts    依赖装配（SQLite / PostgreSQL / Memory）
```

## 12. 明确不做

Temporal / BPMN / Camunda / Kafka / Redis / 通用 workflow DSL / A2A EventBus。

协作方向同样明确不做：

1. **参与人私有上下文**（每人一套 conversation / 工具集 / data scope）—— 那等于把会话拆成多个 runtime，
   协作语义随之消失；
2. **按参与人切换 MCP 与 runtime**（同一会话不同人看到不同工具）—— 工具集属于会话，不属于人；
3. **运行中改会话模式**（`single ⇄ shared`）—— 模式不可变是访问判定的前提；
4. **分布式队列**（Redis / Kafka）与多副本租约 —— 队列就是 execution 表，
   `replicas: 1` 下进程内串行已足够，扩展方向见第 7 节。

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

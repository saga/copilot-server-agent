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
Express routes        routes/{sessions,executions,human-tasks,meta}.ts
        ↓              （route 只做编排与传输，不含 SDK 事件 plumbing）
Services              SessionService / ExecutionService / HumanTaskService
                      ApprovalService / ActionService / WorkspaceService
        ↓
Repositories          ExecutionRepository / EventRepository / HumanTaskRepository
                      SessionRegistry（registry store）
        ↓
SQL 仓储（一份实现）   execution|human-tasks/sql-repository.ts + SessionRegistry
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
- **Memory**：仅单测与 `COPILOT_STATE_BACKEND=memory` 临时验证，重启即丢。

## 2. 核心对象关系

```text
Session ── Execution #1 ── LLM call ── Tool call ── Human task ── Decision
       └─ Execution #2 ── LLM call ── Tool call
```

| 层 | 职责 | 持久化 |
|----|------|--------|
| Session | Copilot session 生命周期（resume/disconnect/abort）、workspace | runtime 磁盘 + `agent_session` 表 |
| Execution | 一次 agent 执行单元（chat turn / job / workflow） | `agent_execution` |
| HumanTask | 审批与人工输入（统一抽象，`type` 区分） | `human_task` |
| Decision | 一人一票的审批裁决（不覆盖任务本身） | `human_task_decision`（`unique(task_id, approver_id)`） |
| ExecutionEvent | 完整审计时间线 | `execution_event`（`unique(execution_id, sequence)`） |

`session ≠ execution ≠ tool call ≠ LLM call`：审计、usage、审批、取消全部挂 `executionId`。
`session → 当前 execution` 的映射是**进程内缓存**（`activeFor()`），状态本身是 durable 的。

## 3. Execution 状态机

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
- **等待人工期间不持有 session lock**：持久化状态 → `session.disconnect()` → 释放锁；
  审批完成后 `resumeSession` 继续（`resumeExecutionSession()` 用持久化的会话配置恢复）

## 4. Human-in-the-loop

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
- Separation of Duties：发起人默认不能自批（`allowInitiator` / `COPILOT_ALLOW_INITIATOR_APPROVAL`）
- 审批资格 = `Identity → Role → Policy`；请求体里传 `approverId` 一律忽略
- Delegation：`POST /human-tasks/:id/delegate` 留痕 `delegated_from/to/by/at + reason`
- 过期：进程内定时扫描（默认 60s），`OPEN → EXPIRED`，execution 随之 `EXPIRED`

## 5. 授权三层（Tool Policy ≠ Business Action Policy）

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

高风险 mutation（`submit_proxy_vote` / `submit_trade` / `send_external_message` / `delete_data`）
**不作为普通模型工具暴露**：agent 只能 `propose_action`，执行器在服务端
（`server/src/actions/action-registry.ts`）。agent 侧入口见 `scripts/governance-mcp.mjs`。

## 6. 并发与锁

| 机制 | 作用域 | 说明 |
|------|--------|------|
| attach lock | resume | 并发首访只允许一个 request 真正 resume |
| session lock | **一个 agent turn** | 不能覆盖 human task 的整个生命周期（审批几小时不占锁） |
| 全局 semaphore | 全进程 | `COPILOT_MAX_CONCURRENT_EXECUTIONS`，防止 N 个用户同时烧满 runtime |
| DB 唯一约束 | 跨副本 | `unique(task_id, approver_id)`、`unique(execution_id, sequence)` |

`replicas > 1` 时内存 session lock 不再足够：换 PostgreSQL advisory lock
（`pg_advisory_xact_lock(hash(sessionId))`），不需要引入 Redis。

## 7. 审计分层（不要互相取代）

| 层 | 回答什么 | 存哪里 |
|----|---------|--------|
| LangSmith / trace | runtime observability：延迟、trace | 外部 |
| ExecutionRecord | 当前状态、usage、tool 证据（查询优化） | `agent_execution` |
| ExecutionEvent | 谁批准、何时、依据什么、后来为什么执行 | `execution_event` |
| Approval / HumanTask | 授权证据 | `human_task` + `human_task_decision` |

写入前统一 `脱敏 → 截断`：`redact.ts` 按 key（token/api_key/authorization/password/secret…）
与值形态（Bearer / sk- / ghp_ / JWT / AKIA…）替换，再截断只报长度
（`COPILOT_EVIDENCE_MAX_CHARS`）。完整 prompt / tool 结果 / 模型上下文不入库；
真正需要完整证据时写对象存储，库里只留 `artifact_uri + sha256`。

## 8. 数据模型（PostgreSQL）

**SQLite（默认）**：schema 内嵌在 `server/src/db/sqlite-schema.ts`，首次连接自动应用，
无需任何迁移命令。写成 TS 常量而不是 `.sql` 文件，是为了让构建产物自带 schema
（`tsc` 只产 JS，运行时再去磁盘找 `src/**/*.sql` 在容器里会失效）。

**PostgreSQL（可选）**：`server/src/db/migrations/001_agent_execution.sql`，由运维应用：

```bash
psql "$DATABASE_URL" -f server/src/db/migrations/001_agent_execution.sql
```

两份 DDL 的表名与列名**必须完全一致**（共用同一份仓储实现），`test/schema.test.ts` 逐列比对。

| 表 | 关键字段 |
|----|---------|
| `agent_session` | session_id, tenant_id, user_id, workspace_path, status, **config**（resume 用，不含凭证） |
| `agent_execution` | execution_id, session_id, tenant/user, kind, status, action_intent, **action_hash**, resource_version, approved_resource_version, current_human_task_id, usage, tool_calls, content_chars |
| `human_task` | task_id, execution_id, type, status, payload, **input_values**（人工输入回填）, input_schema, policy_id, strategy, required_count, eligible_roles/users, initiated_by, expires_at, delegated_* |
| `human_task_decision` | decision_id, task_id, approver_id, approver_role, decision, comment, `unique(task_id, approver_id)` |
| `execution_event` | execution_id, sequence, type, actor_type, actor_id, payload, `unique(execution_id, sequence)` |

类型映射（SQLite）：`jsonb → text`（JSON 文本）、`timestamptz → text`（ISO 8601）、
`boolean → integer`（0/1）、`bigserial → integer primary key autoincrement`。
时间戳列刻意不设 SQL default —— 应用层一律显式写 ISO 字符串，混排会破坏排序。
`pragma foreign_keys = ON` 必须开（默认关），否则 `on delete cascade` 不生效。

`COPILOT_STATE_BACKEND=memory` 可强制内存实现（不落盘，仅临时验证），重启即丢。

## 9. API

| 组 | 端点 |
|----|------|
| Session | `POST /api/sessions`、`GET /api/sessions`、`GET /api/sessions/:id`、`POST /:id/resume`、`DELETE /:id[?permanent=true]`、`POST /:id/chat`（SSE） |
| Execution | `POST /api/executions`（202）、`GET /api/executions`、`GET /:id`、`GET /:id/events`、`GET /:id/tasks`、`POST /:id/run`（202，后台跑）、`POST /:id/cancel`、`POST /:id/actions`（提议动作） |
| HumanTask | `GET /api/human-tasks`（我的）、`GET /api/human-tasks/all`、`GET /:id`、`POST /:id/approve`、`POST /:id/reject`、`POST /:id/input`、`POST /:id/delegate`、`POST /:id/cancel` |
| 元信息 | `/api/providers`、`/api/models`、`/api/agents`、`/api/mcp`、`/api/mcp/test`、`/api/hooks`、`/api/debug` |

`POST /:id/chat` 的 SSE 只负责实时流：首帧 `execution`，随后 `delta/message/subagent`，
结束 `done`。**等待审批不靠 SSE 长连接** —— 用 `GET /executions/:id/events` 轮询或订阅。

## 10. 目录

```text
server/src/
├── routes/      api.ts(挂载) sessions.ts executions.ts human-tasks.ts meta.ts shared.ts
├── agent/       agent-runner.ts（SDK 事件收口） agent-context.ts agent-events.ts
├── services/    session-service workspace-service session-registry
│                tool-policy tool-evidence principal concurrency task-sweeper
├── execution/   types execution-service sql-repository(+memory)
│                events hash usage redact
├── human-tasks/ types repository sql-repository(+memory) human-task-service assignment
├── approval/    types approval-policy approval-service
├── actions/     action-registry（server-controlled executor） action-service
├── db/          connection.ts（后端选择） dialect.ts（方言钩子）
│                sqlite.ts + sqlite-schema.ts（默认后端）
│                postgres.ts（可选） migrations/001_agent_execution.sql
├── providers/ agents/ skills/ mcp/ hooks/
└── wiring.ts    依赖装配（SQLite / PostgreSQL / Memory）
```

## 11. 明确不做

Temporal / BPMN / Camunda / Kafka / Redis / 通用 workflow DSL / A2A EventBus。

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

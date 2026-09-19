# copilot-server-agent

Express + TypeScript + Vite + `@github/copilot-sdk` 全栈框架：React 前端调用 Express API，后端再调用 Copilot SDK。

```
client/ (Vite + React + TS, :5173) ── /api/* ─▶ server/ (Express + TS, :3001) ─▶ Copilot CLI runtime
```

## 快速开始

```bash
npm install          # 根目录安装 server + client + concurrently
cp .env.example server/.env        # 按需填 GITHUB_TOKEN（留空则用 copilot CLI 已登录用户）
cp client/.env.example client/.env # 一般保持默认（走 vite proxy 同源 /api）

npm run dev          # 同时启动 server(:3001) + client(:5173)
# 浏览器打开 http://localhost:5173
```

单独启动：`npm run dev:server` / `npm run dev:client`；构建：`npm run build`；类型检查：`npm run typecheck`；测试：`npm run test`。

**状态存储零配置**：默认用 SQLite（Node 内置 `node:sqlite`，不装任何依赖），库文件落在
`$COPILOT_HOME/agent.db`，首次启动自动建表 —— 开箱即 durable：会话归属、execution 审计、
审批中的任务都跨进程重启存活。要换 PostgreSQL 只需配 `DATABASE_URL`（见
[Durable state](#durable-state)），代码无需改动。

架构设计（分层、execution 状态机、HITL 审批、审计分层、数据模型）见 [`docs/architecture.md`](docs/architecture.md)。

## API 契约（React → Express）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | `{ status, uptime, copilot: connected\|idle\|error }`（`idle` = client 尚未建连的懒加载态，不是故障；判连接可用性看 `/api/health/ready`） |
| GET | `/api/health/ready` | 就绪探针：启动恢复跑完前 `503 { status: "starting" }`，关闭中 `503 { status: "draining" }`，就绪 `200 { status: "ready" }`。给编排层用 —— 别在恢复还没跑完时就把流量放进来。注意 `server.close()` 会**同时关掉监听套接字**，所以关闭期新发起的探测多半拿到的是**连接被拒**而不是 503；两者都表达"未就绪"，要保证探测一定看到 503 得配 `preStop` 宽限期 |
| GET | `/api/providers` | 通道列表 `{ providers: [{ id, displayName, defaultModel, configured, active, hint? }] }` |
| GET | `/api/models` | 当前通道可用模型列表 `{ provider, models }`（前端模型选择器用） |
| GET | `/api/agents` | agent 预设 + 技能目录 + 可发现技能（建会话表单用） |
| GET | `/api/mcp` | MCP 预设与内联开关（只含元信息，密钥不返回） |
| POST | `/api/mcp/test` `{ name? , server? }`（二选一） | MCP 连通性自检（不建会话、不执行命令；local 查可执行文件，http 发 8s 超时 GET） |
| GET | `/api/debug` | 诊断包（版本/平台/脱敏配置/runtime 状态/会话计数；按需启动 runtime）。管理接口：见下方 `requireAdmin` 三态 |
| GET | `/api/hooks` | hook 预设 + 最近 hook 事件（审计；带 `executionId`）。管理接口：同 `requireAdmin` 三态 |
| GET | `/api/executions` `?sessionId=&status=&limit=` | execution 记录（usage + tool 证据）与统计。带 `x-admin-token` 看全量，否则按**可见会话**收窄（自己拥有的 + 自己参与的）；两者都没有且配了令牌 → `401` |
| GET | `/api/executions/:id` | 单条 execution（含 `toolCalls` / `usage` / `actionIntent` / 终态）；需能访问所属会话 |
| GET | `/api/executions/:id/events` | **审计时间线**：谁批准、何时、依据什么 hash、后来为什么执行；同样跟着会话可见性 |
| GET | `/api/executions/:id/tasks` | 该 execution 挂起/已决的人工任务 |
| POST | `/api/executions` `{ sessionId, kind?, input?, prompt? }` | 建后台执行单元 → `202 { executionId, status }`（HTTP 不等 agent）；需 `send` |
| POST | `/api/executions/:id/run` `{ prompt }` | 后台跑一次 agent turn → `202`；指挥权同 `cancel`/`actions`（owner 或该 execution 发起人；observer `403`）。等待审批时用 events 端点跟踪 |
| POST | `/api/executions/:id/cancel` | 取消（running / waiting 都可）。owner 可取消任意，member 只能取消自己发起的，observer `403` |
| POST | `/api/executions/:id/actions` | **agent 提议业务动作**：服务端策略裁决 → 自动放行 / 建审批（202 + `taskId`）/ 拒绝（403）。执行权在 server；指挥权同 `cancel` |
| GET | `/api/human-tasks` `?status=&type=` | **我的任务**（审批 + 待补输入）。`tenantId` / `assignee` 由服务端按认证身份固定，请求里传了也不采纳 —— 否则调用方能把可见范围扩到整个 tenant |
| GET | `/api/human-tasks/:id` | 单任务 + 决策记录。三类人可读：`x-admin-token`（全量）/ **task 的 assignee**（风险、合规审批人常常不在业务会话里，不能只按会话成员资格判定）/ 会话参与人；其余 `403`，跨租户先于会话判定 |
| GET | `/api/human-tasks/all` `?status=` | 全部任务（管理视图，需 `x-admin-token`） |
| POST | `/api/human-tasks/:id/approve` `{ comment? }` | 批准（`approverId` 取认证身份，请求体传了也忽略） |
| POST | `/api/human-tasks/:id/reject` `{ comment? }` | 否决 |
| POST | `/api/human-tasks/:id/input` `{ values }` | 人工补数据（按 `inputSchema` 校验，不是自由文本） |
| POST | `/api/human-tasks/:id/delegate` `{ toUserId, reason? }` | 委派（留痕 from/to/by/at + reason） |
| POST | `/api/human-tasks/:id/cancel` | 取消任务 |
| POST | `/api/sessions` `{ model?, sessionId?, collaborationMode?, systemMessage?, agents?, customAgents?, agent?, skillDirs?, disabledSkills?, noBuiltinSkills?, defaultAgentExcludedTools?, mcp?, mcpServers?, disabledMcpServers?, hooks?, sessionContext?, agentStopChecklist? }` | 创建会话 → `{ sessionId }`（传 `sessionId` 即为可恢复会话）。`collaborationMode: "single" \| "shared"` 缺省 `single`，创建后不可修改 |
| GET | `/api/sessions` | **当前调用方**的会话（自己拥有的 + 自己参与的）。以持久归属表为真相源，runtime 本地索引只用来补充元信息 —— 换 Pod / 刚建的会话不会从列表里消失 |
| GET | `/api/sessions/:id` | 单个会话元信息，含 `collaborationMode` / `owner` / `participants`（越权 `403`）。同样以持久归属表为准：本副本 runtime 尚未见过该会话不等于它不存在 |
| POST | `/api/sessions/:id/resume` `{ 与创建相同的重配项 }` | 恢复会话 → `{ sessionId, resumed }`（BYOK 凭证服务端自动重传）。需 **`manage_session`（owner-only）**：resume 会重配全会话的 model / agents / MCP / hooks，那是全体参与者共用的能力边界。**不接受 `collaborationMode`**（传了 400：模式不可变） |
| POST | `/api/sessions/:id/chat` `{ prompt, streaming?, model?, clientMessageId? }` | 每次请求 = 一个 execution。**single**：`streaming:false` 返回 `{ sessionId, executionId, content, usage }`，`true` 返回 SSE（`execution/delta/message/subagent/done/error`）；**shared**：落消息 → 入队 → `202 { sessionId, collaborationMode, messageId, executionId, status, reused, eventsUrl }`，结果走 `eventsUrl` |
| GET | `/api/sessions/:id/participants` | 参与人列表 `{ participants: [{ userId, role, status, joinedAt, leftAt? }] }`（需 `view`） |
| POST | `/api/sessions/:id/participants` `{ userId, role? }` | owner 邀请成员（`role: member \| observer`，需 `manage_members`；single 会话 400）→ `201 { participant }` |
| DELETE | `/api/sessions/:id/participants/:userId` | 移除成员（置 `removed` 留痕；不能移除 owner） |
| POST | `/api/sessions/:id/leave` | 成员自己退出（置 `left`；owner 不能退出） |
| GET | `/api/sessions/:id/messages` `?limit=` | 会话 transcript（人类 + agent，按 `sequence` 升序） |
| GET | `/api/sessions/:id/events` | **协作事件流（SSE）**：`participant.*` / `message.created` / `execution.queued\|started\|completed\|failed\|interrupted` / `assistant.message` / `assistant.delta`。支持 `?after=<sequence>` 或 `Last-Event-ID` 断线续传（服务端**先订阅再回放**，两步之间写入的事件不会漏） |
| DELETE | `/api/sessions/:id` | 默认断开内存附着（保留磁盘，可 resume）；`?permanent=true` 彻底删除，不可恢复。两者都排队在当前 agent turn 之后执行 |

状态码约定：**越权一律 `403`**（如 `无权发消息到 session`、`无权管理成员`、`无权删除`）、
对象不存在 `404`、请求写错 `400`（参数非法、模式不可变、不能移除/退出 owner 等业务规则）、
读接口在「配了管理令牌、又拿不到可信身份」时 `401`（`readAccess` 的 `denied`）、
其余未识别错误 `500`。判定规则集中在 `server/src/middleware/error-status.ts`，路由与兜底共用一份，
逐条文案由 `server/test/http-errors.test.ts` 覆盖（详见 `docs/architecture.md` §10）。

前端示例见 `client/src/lib/api.ts`（`api.health/createSession/chat/chatStream`）和 `client/src/components/Chat.tsx`。

## 模型通道：Copilot 直连 / DeepSeek BYOK

参考官方 BYOK 文档（`createSession({ model, provider: { type, baseUrl, apiKey, wireApi } })` + client 级 `onListModels`），后端做了抽象：

- `server/src/providers/model-provider.ts` — `ModelProvider` 抽象类（`resolve / buildProviderConfig / getCustomModels`）
- `server/src/providers/copilot-provider.ts` — 直连 Copilot，不传 provider，模型走 CLI
- `server/src/providers/deepseek-provider.ts` — DeepSeek BYOK（OpenAI 兼容，`wireApi: completions`，自报 `deepseek-v4-flash/pro`）
- `server/src/providers/index.ts` — 注册表，新增厂商只需加一个子类并注册

切换方式（`server/.env`）：

```bash
COPILOT_PROVIDER=deepseek
DEEPSEEK_API_KEY=sk-...        # 去 https://platform.deepseek.com 申请，只放 .env
DEEPSEEK_MODEL=deepseek-v4-flash  # 或 deepseek-v4-pro
```

注意：`deepseek-chat` / `deepseek-reasoner` 已于 2026-07-24 退役，默认用 `deepseek-v4-flash`。

## Agents 与 Skills

参考官方 custom-agents / skills 两篇文档：

- **Agents**（`server/src/agents/builtin.ts`）：内置 `researcher`（只读：grep/glob/view）+ `editor`（改代码：view/edit/bash）两个预设。建会话时 `agents: ["researcher"]` 按名引用（缺省全挂，`[]` 为不挂），`customAgents` 可传完整内联定义，`agent: "researcher"` 预选首个激活 agent（对不上会 400）。运行时按 intent 自动委派 sub-agent，`subagent.*` 生命周期事件经 SSE `subagent` 帧透传，前端有 activity 时间线。
- **Skills**（`server/skills/*`）：内置 `code-review`、`commit-helper` 两个示例技能（`SKILL.md` + frontmatter）。建会话默认加载，`noBuiltinSkills: true` 可关，`skillDirs` 可追加自有目录（不存在直接 400），`disabledSkills` 按名禁用。agent 级 `skills` 预加载按文档是 opt-in：内联 `customAgents` 里写 `skills: [...]` 即从会话 `skillDirectories` 解析。

## Skill Flow：SKILL.md 里的编排

一次「研究 → 合规门禁 → 合规审核 → 投资审核 → 发布」不是一次 agent turn 能做完的。流程定义写在
**已有的 SKILL.md** 里，用 Markdown AST 解析 —— 不引入 BPMN / XState / 第二套 YAML DSL：

```markdown
## @flow investment-review
start -> investment-research

## @subagent investment-research
（节点正文就是给 LLM 的 prompt：收集证据并输出带证据的研究结论）
- success -> compliance
- fail -> research-failed

## @gate compliance
- pass -> investment-review
- fail -> compliance-rejected

## @review investment-review
- approve -> publish
- reject -> investment-research      # 打回重做 = 把 route 指回上一步

## @action publish
- success -> completed
- fail -> publish-failed
```

（`@stop research-failed` / `@stop compliance-rejected` / `@stop publish-failed` /
`@end completed` 四个终止节点略。）

`@flow @subagent @gate @review @action @stop @end` 七种块，必须 `##` 标题、`@` 开头，路由是
`- <出口> -> <目标节点>`。编排器本身不新造 runtime，三层全部复用：

- `@subagent` → `runExecutionTurn`（同一个 Copilot session / model / tool policy / 工具证据）
- `@review` → HumanTask（My Tasks、委派、SoD、租户隔离、审计全都不改一行）
- `@action` → `proposeAction`（策略 → 审批 → hash/版本复核 → executor），只是不自动收尾 execution

**权限、角色、审批策略不写在 SKILL.md 里** —— 节点只声明「这里需要 compliance-review」，谁有资格
批由服务端 `workflow/registry.ts` 决定。SKILL.md 会被 LLM 读到、也会被人改，不能是 security boundary。

```bash
curl -X POST localhost:3001/api/executions -H 'content-type: application/json' \
  -d '{"sessionId":"user-pm-task-42","kind":"workflow",
       "skill":"investment-research","flow":"investment-review"}'
curl -X POST localhost:3001/api/executions/<id>/run        # workflow 不需要 prompt
# 停在 @review → GET /api/human-tasks 里能看到任务 → approve 后自动续跑下一步
```

要点：

- **校验先于执行**：建 execution 之前就把 `flow-missing` / `route-target-missing` /
  `node-missing-outcome` / `node-unreachable` / `skill-missing` 等连同**行号**报出来（400）。
  跑到一半才发现路由指向不存在的节点时，execution 可能已经停在等待态了。
- **状态是 durable 的**：`agent_execution.workflow_state` 存 `current` / `steps` /
  `waitingTaskId`，并且**先写 current 再执行节点** —— 反过来写，进程在「跑完但没落库」之间退出，
  重启会把同一步再跑一遍，而那一步可能是已经把 mutation 发出去的 `@action`。
- **`sourceHash` 挡住中途换版本**：SKILL.md 的 SHA-256 每次推进前重算比对，不一致就 failed
  等人工确认 —— 不让已经开始的执行悄悄切到另一版流程上继续跑。
- **允许环，所以有硬闸门** `MAX_FLOW_STEPS = 100`（review 一直打回不会跑成死循环）。
- **API 没有新增端点**：`/api/executions` 多 `skill` / `flow` 两个字段，`/run` 按 `kind` 分派，
  不另开 `/workflow/*` —— 否则同一个 execution 会有两条读取路径、两套权限矩阵。

完整语义见 [`docs/architecture.md`](docs/architecture.md) 第 11 节。示例技能在
`server/skills/investment-research/SKILL.md`。

## 会话持久化与 MCP

参考官方 session-persistence / mcp 两篇文档：

- **持久化**：建会话传 `sessionId`（推荐 `user-xxx-task-yyy` 结构，非法直接 400）即为可恢复会话；`POST /api/sessions/:id/resume` 在服务重启后继续（可附带重配 model/agents/skills/mcp，BYOK 凭证由服务端当前通道自动重传，无需调用方操心）；`GET /api/sessions` 按「自己拥有的 + 自己参与的」列会话（`attached` 标记是否在本进程内存）；`DELETE` 默认断开不断数据、`?permanent=true` 彻底删除。`COPILOT_SESSION_IDLE_TIMEOUT`（秒，0=关闭）可让 runtime 自动回收无活动会话。归属与 execution 同库（默认 SQLite），重启后不会退化成“谁先访问谁认领”。
- **MCP**（`server/src/mcp/registry.ts`）：内置 `filesystem` 预设（官方 server，授权目录限定仓库根，可用 `COPILOT_MCP_FS_DIR` 改、`COPILOT_MCP_FILESYSTEM=false` 关）；运维经 `COPILOT_MCP_SERVERS`（JSON）预置额外 servers；前端建会话用 `mcp: [...]` 按名启用、`disabledMcpServers` 精确禁用。安全门：内联 `local/stdio` MCP = 在服务器执行任意命令，默认 400 拒绝（`COPILOT_ALLOW_INLINE_MCP_LOCAL=true` 才放行）；内联 `http/sse` 默认允许。`GET /api/mcp` 只返回元信息，headers/env 密钥永不外泄。

## Session 访问模型（single / shared）

会话的访问模型在创建时确定，**生命周期内不变**：

| | `single`（缺省） | `shared` |
|---|---|---|
| 谁能进 | 只有 owner | owner + participants（member / observer） |
| 提交路径 | 直接执行（HTTP → session lock → agent turn） | 消息落库 → execution(`created`) 入队 → `202` |
| 结果怎么拿 | SSE（`POST /:id/chat`） | 会话事件流（`GET /:id/events`，带游标） |
| Copilot runtime | 每个会话一个 | **仍是每个会话一个**，同一时刻最多一个 agent turn |

```bash
# 建共享会话 → 拉两个人 → 各发一条
curl -X POST localhost:3001/api/sessions -H 'content-type: application/json' \
  -d '{"sessionId":"user-pm-task-42","collaborationMode":"shared"}'
curl -X POST localhost:3001/api/sessions/user-pm-task-42/participants \
  -H 'content-type: application/json' -d '{"userId":"risk-1","role":"member"}'
curl -X POST localhost:3001/api/sessions/user-pm-task-42/chat \
  -H 'content-type: application/json' -d '{"prompt":"查一下这笔的持仓","clientMessageId":"cli-1"}'
# → 202 { sessionId, messageId, executionId, status, reused, eventsUrl }
# 结果订阅 GET /api/sessions/user-pm-task-42/events（支持 ?after=<sequence> / Last-Event-ID 续传）
```

- **字段叫 `collaborationMode` 而不是 `mode`**：后者是 SDK 的 runtime/工具模式（`mode: "empty"`），两者不能混。
- **会话角色 vs 业务角色**：`owner / member / observer` 决定「能不能进这个会话、能不能发消息」；
  `risk / compliance / …` 决定「能不能批准某笔业务」。加进共享会话 ≠ 获得高风险动作的执行权。
  observer 只读；member 能发消息，但不能管成员、不能改会话配置；owner 全能。
- **改会话配置是 owner 专属**（`manage_session`）：`resume` 可以重配 model / agents / MCP / hooks /
  systemMessage，那是全体参与者共用的能力边界 —— member 能发言不等于能改所有人的工具集与数据范围。
- **指挥一次 execution 另算**：取消、提业务动作、以及**手动跑一次 turn**（`/executions/:id/run`）
  由 owner 或**该 execution 的发起人**发起（member 只能动自己发的），observer 不可 ——
  能看见不等于能让执行跑起来。上一版 `/run` 只判 `send`，结果是 member 能把别人发起的 execution
  跑起来、却取消不了它，三档判定现已统一。
- **成员资格由 owner 控制**（邀请制）：session 级能力（conversation / workspace / data scope /
  工具与 MCP）是**全体参与者的共同边界** —— participant 不因自己的 membership 拿到额外
  MCP / skill / workspace / data capability。所以「这个人的数据权限是否覆盖本会话的数据范围」
  在邀请那一刻判定，shared session 就是 shared data boundary。
- **队列就是 execution 表**：`status='created'` 即「排队中」，同一 session 串行、跨 session 并行
  （另有全局闸门）。不用另建队列表 —— 多一张表就多一处不一致要维护。队头按来源消息的序号
  （`queue_sequence`）定序，保证**用户看到的顺序 = agent 处理的顺序**；手工建的后台 job 没有来源
  消息，不参与协作调度。
- **崩溃恢复**：启动时 `running`/`resuming` 的 execution 落终态 `interrupted`（**不自动重试** ——
  那次 turn 可能已经把业务动作做出去了），仍排队的按序重新 drain。恢复**在开始接流量之前**跑完：
  启动顺序是建 app → `recoverPending()` → 起 sweeper → `listen`，`/api/health/ready` 在恢复
  完成前返回 `503 starting`。**恢复失败就不接流量**：置退出码 1 直接返回，不 `listen`、不 ready ——
  否则会出现「DB 恢复失败 → 服务 ready → 照收业务请求」，而队列里的 `created` 永远没人 drain。
  交给编排层重拉进程。
- **单条坏记录不连坐**：恢复逐条补写 `interrupted` 审计事件，某条写入失败（例如 execution 指向
  已被删除的会话）只记一条 warn 就继续。状态照落终态、队列照重排，不让一条坏记录把整轮恢复带走。
- **人工补数据的续跑还没闭合**：`POST /api/human-tasks/:id/input` 把 execution 置到 `resuming`
  就停了 —— 没有组件把 `inputValues` 拼回 prompt、继续 agent turn，`resuming` 是个没有出边的
  悬挂态（要靠 `interrupted` 在重启时兜底）。审批（approval）不同：批准后由服务端执行器直接执行
  并收尾。要让 input 也自动续跑，需要补一个 continuation runner（见
  [`docs/architecture.md`](docs/architecture.md) 5.2）。
- **序号不靠 `max()+1`**：消息、会话事件、执行事件各有自己的分配器列，`update ... returning`
  原子自增。`max()+1` 在并发下会重号，再用 `on conflict do nothing` 兜住就变成静默丢事件。
- **幂等**：`clientMessageId` 命中的重试沿用已有消息与 execution，不会跑两次 agent turn。
- **业务动作的幂等键**：执行外部 mutation 时把 `action:{executionId}:{actionHash}` 传给 executor
  （`ActionExecutionContext.idempotencyKey`），真实网关据此去重。挡的是「外部副作用已生效 →
  进程在落 `completed` 前崩 → 重试」这一序列。刻意不绑 `taskId`：重新审批会产出新的 HumanTask，
  但那仍是同一次业务动作。
- **管理接口三态**（`requireAdmin`，作用于 `/api/debug`、`/api/hooks`、`/api/human-tasks/all`）：
  没配 `COPILOT_ADMIN_TOKEN` 且非可信身份 → 本地单租户放行；没配令牌**但**开了可信身份 →
  一律 `401`（否则「开了身份头 = 拿到管理权限」）；配了令牌 → 必须带对。
- **发起人 ≠ owner**：`agent_execution.user_id` 记会话 owner（resume 归属校验用），
  `initiated_by_user_id` 记发起人（审计与「发起人不能自批」）。
- **可见性跟着会话走**：shared 会话里参与者能看到同会话中别人发起的 execution 与待办任务。
  `x-admin-token` 是可见范围的放大器（看全量），不是独立闸门 —— 没带令牌就退到会话可见性，
  否则参与者读不到自己会话的执行时间线。
- **会话读取以 registry 为真相源**：runtime 的本地索引只用来补充 startTime/summary。
  多副本下每个 Pod 的索引不同步，拿它当真相源会让 `GET /sessions/:id` 误报 404。
- `replicas: 1` 是这份模型的前提（进程内队列与事件广播）。多副本要换 DB 租约 + runtime affinity，
  见 [`docs/architecture.md`](docs/architecture.md) 第 7 节。

## 并发隔离与多租户安全

不同 session 之间已经隔离（1 session = 1 workspace）；这一节解决的是**同一 session 内多个 request** 与**归属边界**的问题。

| 层 | 机制 | 解决什么 |
|----|------|---------|
| attach lock | `sessionAttachLocks` | 并发首访只 resume 一次，避免同一 runtime session 双附着 |
| chat lock | `withSessionLock` 覆盖整个 `sendAndWait()` | `session.send()` 只是入队就返回，锁必须持续到 `session.idle`，否则同一 session 两个 turn 会同时写 workspace |
| 会话队列 | `SessionCoordinator`（per-session 链式 drain） | shared 会话的多个请求排成一条线：`created` 的 execution 即队列项，同一 session 同一时刻只跑一个 turn，跨 session 并行 |
| lifecycle lock | `disconnect` / `permanent delete` 走同一个 session lock | 不在 agent 正在写文件时删 workspace / 删 runtime session |
| Session Registry | `server/src/services/session-registry.ts`（`SqlRegistryStore`，与 execution 同库） | 重启后归属不丢，杜绝“谁先访问谁认领”。写入按意图拆开（`create` / `saveConfig` / `touch` / `setCollaborationMode`），不用万能 upsert —— 那会在「Bob resume Alice 的共享会话」时把 owner 覆盖成 Bob |
| 会话访问判定 | `server/src/services/session-access.ts` | 唯一回答「谁能进这个会话、能做什么」的地方（single 看 owner，shared 看 active participant） |
| 全局并发闸门 | `server/src/services/concurrency.ts` | `COPILOT_MAX_CONCURRENT_EXECUTIONS`：限制同时运行的 agent turn，避免 N 个用户烧满 runtime |
| 工具授权 | `server/src/services/tool-policy.ts` | 取代 `approveAll`：write 限 workspace、bash 按策略、MCP 按会话启用名单、URL 过 SSRF + 域名 allowlist |
| 执行前守卫 | `onPreToolUse`（强制 hook，请求关不掉） | 写类工具路径必须在 session workspace |
| execution | `server/src/execution/` | session ≠ execution：每次 chat 一个 `executionId`，usage/工具证据/取消/终态全挂在它上面 |

要点：

- **归属**：`x-tenant-id` / `x-user-id` 只有在网关/IAP 会剥离客户端自带头时才可信 —— 由 `COPILOT_TRUST_IDENTITY_HEADERS=true` 显式开启（默认关闭 = 单租户，所有请求按 `default/default`）。归属校验（`assertOwner`，只回答「你是 owner 吗」）与「你能做什么」（`SessionAccessService.assertCan*`）是两件事，后者是唯一的访问判定入口，路由不再各写一份。
- **SSE**：流式仍然是 SSE，但 lock 内用 `sendAndWait()`；delta 事件照样实时出来。监听器也在锁内注册，避免并发请求互收对方增量。
- **断开**：客户端断开 = `session.abort()` 当前 turn（不是断开 session），之后还能继续对话。
- **workspace 是软隔离**：`workingDirectory` 只是默认 cwd，`bash` 仍能 `cd` 出去。策略层按 `possiblePaths` 拦截、写类工具按路径拦截；不可信代码场景仍需 per-request container。

### Durable state（默认 SQLite，可配 PostgreSQL）

execution / human task / approval / event / session ownership 都是业务状态，必须跨 Pod 重启存活
（否则“审批中的任务”会在重启后消失）。

**默认：SQLite，零配置。** 用 Node 内置的 `node:sqlite`，不装任何依赖，也不需要迁移命令：

```bash
# 什么都不用做。库文件默认落在 $COPILOT_HOME/agent.db（首次启动自动建表）
COPILOT_DB_PATH=/var/lib/copilot/agent.db npm run dev:server   # 需要改路径时
```

**可选：PostgreSQL**（多副本 / 已有数据库 / 需要集中备份时）：

```bash
npm i pg                                                     # 可选依赖，不用 PG 时不需要装
psql "$DATABASE_URL" -f server/src/db/migrations/001_agent_execution.sql
psql "$DATABASE_URL" -f server/src/db/migrations/002_collaboration.sql
DATABASE_URL=postgres://user:pass@host:5432/copilot npm run dev:server
```

八张表：`agent_session`、`session_participant`、`agent_message`、`session_event`、
`agent_execution`、`human_task`、`human_task_decision`、`execution_event`。
两种后端**共用同一份 SQL 仓储实现**（`execution|human-tasks|collaboration/sql-repository.ts`），
差异只有方言，收敛在 `server/src/db/dialect.ts`：占位符、JSON 列编解码、布尔/时间戳表示、
JSON 数组命中判定、聚合取整。业务层只认 `repository.ts` 里的接口，换存储不改代码。

两种后端都支持**已有库文件的升级**：PG 侧是 `002` 里的 `add column if not exists`；
SQLite 侧是 `create table if not exists` 补不上新增列，所以启动时按 `SQLITE_COLUMN_UPGRADES`
逐条查 `pragma_table_info`、缺列才 `alter table`。老 `agent.db` 直接升上来不会缺列
（`test/sqlite.test.ts` 用一份旧版 DDL 建库来验这条路径）。

依赖装配在 `server/src/wiring.ts`（唯一一处决定后端的地方），启动日志会打印实际后端：

```text
[wiring] durable state = SQLite：/Users/you/.copilot/agent.db
[wiring] durable state = PostgreSQL（execution/human task/approval/event/ownership/collaboration）
```

`COPILOT_STATE_BACKEND=memory` 可强制内存实现（不落盘，重启即丢，仅临时验证）：
execution / human task / 归属表 / 协作表全部换成内存实现。

**SQLite 的部署约束**：单文件、单写者，因此必须单副本部署（`k8s/deployment.yaml` 已固定
`replicas: 1`），库文件必须落在持久卷上。需要多副本时切 PostgreSQL —— 但注意 session 锁、
会话队列、session 对象与 session 事件广播仍是进程内的，多副本还需分布式锁与 runtime affinity。

## Execution Record（执行审计）

一次 chat / 一个 job = 一个 execution。session 会有很多 turn，所以审计不能只挂 `sessionId`：

```text
session ── execution #1 ── LLM ── tool ── tool
       └─ execution #2 ── LLM ── tool（被守卫 deny）
```

`GET /api/executions/:id` 返回：

```jsonc
{
  "executionId": "ex_…", "sessionId": "…", "tenantId": "…", "userId": "…",
  "initiatedByUserId": "…",     // 谁让 agent 跑的（shared 会话里可能是别的参与者）
  "sourceMessageId": "msg_…",   // 触发本次执行的会话消息（shared）
  "startedAt": "…", "completedAt": "…", "durationMs": 4646,
  "status": "completed",        // created|running|waiting_for_input|waiting_for_approval|resuming
                                // |completed|failed|cancelled|rejected|expired
  "promptPreview": "\"只回复 OK\"",
  "usage": { "inputTokens": 4128, "outputTokens": 5, "cacheReadTokens": 0,
             "cacheWriteTokens": 0, "reasoningTokens": 0, "durationMs": 1473,
             "llmCalls": 1, "models": ["…"], "contextWindow": 128000, "cost": 1 },
  "toolCalls": [
    { "toolCallId": "ex_…-t1", "toolName": "bash", "decision": "allow",
      "arguments": "{\"command\":\"…\"}", "result": "…", "durationMs": 47, "isError": false }
  ]
}
```

| 组成 | 位置 | 说明 |
|------|------|------|
| ExecutionService + Repository | `server/src/execution/execution-service.ts`（仓储：`sql-repository.ts` 一份实现跑 SQLite/PG，另有 memory） | 生命周期与状态机；默认 SQLite 落盘，`COPILOT_STATE_BACKEND=memory` 时走内存 LRU（`COPILOT_MAX_TRACKED_EXECUTIONS`） |
| ExecutionEvent | `server/src/execution/events.ts` | 审计**时间线**（`GET /api/executions/:id/events`）：ExecutionRecord 只存当前状态，回答不了“谁批准 / 何时 / 依据什么” |
| Usage | `server/src/execution/usage.ts` | **execution-local** 累加器：并发 turn 不串数据。监听 `assistant.usage`（token/耗时/模型）+ `session.usage_info`（上下文窗口） |
| 工具证据 | `server/src/services/tool-evidence.ts` | `onPreToolUse` 开条（toolCallId/参数/守卫裁决）→ `onPostToolUse` / `onPostToolUseFailure` 收口（结果/错误/耗时） |
| 脱敏截断 | `server/src/execution/redact.ts` | 参数与结果先 `redact`（token/api_key/authorization/password/secret… 按 key 与值形态）再 `truncate`（只报长度）。tool 结果可能极大（SQL/PDF/网页），不能直接进日志 |

审计链：`request → execution → 策略裁决 → 工具执行 → 结果`，hook 事件环（`GET /api/hooks`）里的每条都带 `executionId`。
LangSmith 之类的 trace 只承担 runtime observability，**不是**审计真相源。

## Human-in-the-loop（审批）

高风险 mutation（下单、代理投票、对外发消息、删数据）不作为普通模型工具暴露：
agent 只能**提议**（`POST /api/executions/:id/actions` 或 governance MCP 的 `propose_action`），
执行器在服务端（`server/src/actions/action-registry.ts`）。

```text
agent 提出 ActionIntent
   ↓  ActionService.classify(actionType)   —— 策略裁决，不看 LLM 的建议
   ├ 未登记策略 → 403 denied（默认拒绝）
   ├ 自动放行   → server 直接执行
   └ needs_approval → 建 HumanTask + execution 进入 WAITING_FOR_APPROVAL（HTTP 202 返回）
   ↓
人工审批（ANY / ALL / N_OF_M / SEQUENTIAL，一人一票，发起人默认不能自批）
   ↓ 通过
actionHash 复核 + resourceVersion 复核 + ToolPolicy
   ↓
server 侧 executor 执行 → COMPLETED
```

- `actionHash = sha256(canonicalJson(intent 去掉 createdAt))`：批准的是**动作内容**，
  执行前重算，失配 → 回到待审批并开新任务（防“批准 10,000 股 / 执行 100,000 股”）
- `resourceVersion`：批准时所依据的数据版本 vs 执行时的当前版本，不一致同样重新审批
- 等待审批期间**不持有 session lock**：持久化状态后 `session.disconnect()`，审批完成再 resume
- Delegation / 过期：`POST /:id/delegate` 留痕；过期扫描（默认 60s）`OPEN → EXPIRED`

agent 侧入口（可选）：`scripts/governance-mcp.mjs` 是 stdio MCP server，只暴露
`propose_action`，实现是回调本服务的 `/api/executions/:id/actions`。

## 环境变量（安全相关）

| 变量 | 默认 | 说明 |
|------|------|------|
| `COPILOT_TRUST_IDENTITY_HEADERS` | `false` | 是否信任 `x-tenant-id`/`x-user-id`；仅网关注入时才开 |
| `COPILOT_BASH_POLICY` | `workspace` | `workspace`=命令涉及路径须在 workspace；`allow`=放行；`deny`=禁止 bash |
| `COPILOT_WARMUP` | `true` | 启动时后台预热 runtime（首屏徽章与首个会话不必等 CLI 拉起）；`false`=纯懒加载 |
| `COPILOT_URL_ALLOWLIST` | 空 | 允许访问的域名（逗号分隔；空=任意公网，仍过 SSRF 检查） |
| `COPILOT_EVIDENCE_MAX_CHARS` | `2000` | 单条 tool 参数/结果预览的最大字符数（超出只记长度） |
| `COPILOT_MAX_TRACKED_EXECUTIONS` | `200` | **内存后端**保留的 execution 条数（SQLite/PG 模式下不生效） |
| `COPILOT_MAX_TOOL_CALLS` | `100` | 单个 execution 最多记多少条 tool call |
| `COPILOT_STATE_BACKEND` | `auto` | `auto`=按 `DATABASE_URL` 自动选（默认 SQLite）；`memory`=不落盘，仅临时验证 |
| `COPILOT_DB_PATH` | `$COPILOT_HOME/agent.db` | SQLite 库文件路径（K8s 必须指到持久卷） |
| `COPILOT_SQLITE_EXTENSIONS` | 空 | 可选 SQLite 扩展（逗号分隔绝对路径），如 sqlite-vec |
| `DATABASE_URL` | 空 | 留空=用 SQLite；配置后 execution/human task/approval/event/ownership 全部落 PostgreSQL。非空时必须是 `postgres://` / `postgresql://`，否则启动即失败 |
| `COPILOT_MAX_CONCURRENT_EXECUTIONS` | `0` | 全进程同时运行的 agent turn 上限（`0`=不限） |
| `COPILOT_HUMAN_TASK_TTL` | `86400` | Human Task 默认 TTL（秒，`0`=不过期）；到期 `OPEN → EXPIRED` |
| `COPILOT_HUMAN_TASK_SWEEP` | `60` | 过期扫描间隔（秒） |
| `COPILOT_ALLOW_INITIATOR_APPROVAL` | `false` | 是否允许发起人审批自己发起的 action（SoD） |
| `COPILOT_DEFAULT_ROLES` | `approver` | 未开启身份头可信时的默认角色（审批资格判定用） |
| `COPILOT_AUTO_APPROVE_ACTIONS` | 空 | 逗号分隔的动作类型：这些动作跳过人工审批、server 直接执行（慎用） |

## 版本锁定与自检

```bash
npm run check:versions     # SDK / runtime / K8s 镜像 tag 四处版本必须一致
npm run verify:agent-tools # custom agent 工具是否真能调用（只认 tool.execution_start）
npm run test               # execution 审计（脱敏/usage/tool 证据）+ 配置 smoke（非法值必须启动失败）
                           # + 两份 DDL 逐列比对 + SQLite 端到端（含老库补列）+ 协作模型（访问矩阵/幂等/队列串行/事件游标）
                           # + Skill Flow（AST 解析/行号校验/编排推进/重启恢复/sourceHash 防中途改版）
```

SDK 与 runtime(CLI) 版本必须完全 pin（当前 `1.0.14`）：版本漂移会触发协议不兼容，且本服务依赖若干 SDK workaround。`verify:agent-tools` 对应 SDK issue #2356 —— 只看 `subagent.selected` 不够，必须看到 `tool.execution_start`。

## Hooks（生命周期 + 错误处理）

参考官方 hooks-overview / session-lifecycle / error-handling 三篇文档（`server/src/hooks/`）：

- **预设**：`audit`（默认启用，只记录会话起止/错误到日志与事件环，不干预）、`session-context`（`onSessionStart` 注入 `sessionContext` 文本）、`error-policy`（`onErrorOccurred`：全记日志；可恢复 tool 错误降噪 suppress；model_call/system 给友好通知）、`stop-guard`（`onAgentStop`：传 `agentStopChecklist` 即 block 一次按检查项继续，用 `stopHookActive` 防重复）。
- **用法**：建/恢复会话传 `hooks: [...]`（缺省=默认启用项，`[]` 全关，未知名 400）；传 `sessionContext`/`agentStopChecklist` 自动启用对应预设；多预设 start 上下文拼接、end 汇总、error 首个非空决策生效。
- **审计**：`GET /api/hooks` 返回预设 + 最近 hook 事件（纯内存环，重启清空）。
- 注意：以 SDK 实际类型为准——handler 返回 `void`（非文档示例的 `null`），start 输入字段为 `workingDirectory`（非 `cwd`）、`timestamp` 为 `Date`。

## 调试

参考官方 debugging 文档：

- **日志**：`COPILOT_LOG_LEVEL`（none/error/warning/info/debug/all，留空=SDK 默认，非法值启动即报错）、`COPILOT_LOG_DIR`（透传 `--log-dir` 给 CLI）、`COPILOT_CLI_PATH`（CLI 不在 PATH 时指定完整路径，对应文档“CLI not found”一节）。
- **诊断包**：`GET /api/debug` 一次返回排障清单——Node/平台/SDK 版本、当前通道、脱敏配置（密钥永不出现）、runtime 状态（`ping` 延迟、CLI 版本 + 协议版本、认证状态）、会话计数（内存附着/磁盘）、hooks 与 MCP 预设数、execution 计数（追踪数/运行中/tool 调用数）。会按需启动 runtime，CLI 缺失/未认证等问题直接暴露在包里。
- **MCP 自检**：`POST /api/mcp/test`（`{ name }` 测预设，或 `{ server }` 测内联配置，内联同样受安全门约束）——local 只验证可执行文件可找到（不执行），http 发一次 8s 超时 GET（任何 HTTP 响应即算可达，MCP 端点对普通 GET 常回 4xx 属正常）。前端「调试」面板每个预设都有连通测试按钮。

## 服务端结构

- `server/src/services/session-service.ts` — `SessionService` 单例（Client 生命周期 + 会话管理 + attach/chat/lifecycle 三把锁 + 诊断包）
- `server/src/services/session-registry.ts` — 持久归属表 + `collaboration_mode` + resume 用会话配置（凭证不落库）；内存实现只给 `COPILOT_STATE_BACKEND=memory` 与单测
- `server/src/services/session-access.ts` — `SessionAccessService`：唯一的会话访问判定入口（谁能进、能做什么）
- `server/src/services/turn-runner.ts` — `withTurnSlot`：turn 槽 = 全局闸门 + session 锁 + execution 上下文
- `server/src/services/tool-policy.ts` — 工具授权 policy + `onPreToolUse` workspace 守卫
- `server/src/services/tool-evidence.ts` — 工具证据 hook（toolCallId / 裁决 / 耗时 / 脱敏结果）
- `server/src/collaboration/` — `collaboration-service.ts`（按模式分派提交）、`session-coordinator.ts`（per-session 队列调度）、`message-service.ts`、`participant-service.ts`、`session-event-service.ts`、`sql-repository.ts`(+memory)、`types.ts`
- `server/src/execution/` — `execution-service.ts`（生命周期 + 状态机 + HITL）、`sql-repository.ts`（SQLite/PG 共用的 SQL 仓储）、`memory-repository.ts`（单测用）、`events.ts`（审计时间线）、`hash.ts`（actionHash）、`usage.ts`、`redact.ts`
- `server/src/human-tasks/` — HumanTask + Decision（审批与人工输入统一抽象）、`assignment.ts`（资格判定）
- `server/src/approval/` — `approval-policy.ts`（ANY/ALL/N_OF_M/SEQUENTIAL）、`approval-service.ts`（谁能批、几票、顺序）
- `server/src/actions/` — `action-registry.ts`（server-controlled executor）、`action-service.ts`（业务动作策略裁决 + hash/版本复核）
- `server/src/agent/` — `agent-runner.ts`（Copilot SDK 事件收口）、`agent-execution.ts`（一个 execution 跑一轮 turn）、`agent-context.ts`（turn 级 execution 上下文）
- `server/src/workflow/` — `types.ts`（FlowDefinition / WorkflowState / MAX_FLOW_STEPS）、`registry.ts`（gate / review / action 的服务端注册，含审批资格）、`runner.ts`（编排器：解析校验 → 逐步推进 → 人工收敛后续跑）
- `server/src/skills/` — 技能加载与 sourceHash；`flow-parser.ts`（remark AST → 节点与路由）、`flow-validator.ts`（带行号的校验）
- `server/src/db/` — `connection.ts`（后端选择）、`dialect.ts`（SQL 方言钩子）、`sqlite.ts` + `sqlite-schema.ts`（默认后端，schema 内嵌自动应用；建表 → 补列 → 建索引三步）、`postgres.ts`（可选依赖 `pg`）、`migrations/001_agent_execution.sql` + `002_collaboration.sql` + `003_workflow.sql`（PG 版 DDL）
- `server/src/middleware/` — `error-status.ts`（错误文案 → 状态码的单一真相源，路由与兜底共用）、`errorHandler.ts`（兜底 500）
- `server/src/wiring.ts` — 依赖装配（唯一决定 SQLite / PostgreSQL / 内存的地方）
- `server/src/services/workspace-service.ts` — session workspace（路径是 sessionId 的确定性哈希）
- `server/src/routes/` — `api.ts`（挂载）+ `sessions.ts` / `session-collaboration.ts` / `executions.ts` / `human-tasks.ts` / `meta.ts` / `shared.ts`
- `server/src/index.ts` — 启动流程：`recoverPending()`（`running`/`resuming` → `interrupted`，排队项重新 drain）→ 起 sweeper → `listen` → `markReady()`。恢复在接流量之前跑完，`/api/health/ready` 在完成前返回 503
- `server/src/lifecycle.ts` — 生命周期状态（`starting` / `ready` / `draining`），健康路由据此判就绪；单独成模块以免 `index ↔ health` 循环依赖

## 前提

- Node.js ^20.19 或 >=22.12（Copilot SDK 要求），本机 `node -v` 需满足
- Copilot 认证二选一：本机 `copilot` CLI 已登录，或 `server/.env` 里填 `GITHUB_TOKEN`

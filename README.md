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

单独启动：`npm run dev:server` / `npm run dev:client`；构建：`npm run build`；类型检查：`npm run typecheck`。

## API 契约（React → Express）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | `{ status, uptime, copilot: connected\|idle\|error }`（`idle` = client 尚未建连的懒加载态，不是故障；判连接可用性看 `/api/health/ready`） |
| GET | `/api/providers` | 通道列表 `{ providers: [{ id, displayName, defaultModel, configured, active, hint? }] }` |
| GET | `/api/models` | 当前通道可用模型列表 `{ provider, models }`（前端模型选择器用） |
| GET | `/api/agents` | agent 预设 + 技能目录 + 可发现技能（建会话表单用） |
| GET | `/api/mcp` | MCP 预设与内联开关（只含元信息，密钥不返回） |
| POST | `/api/mcp/test` `{ name? , server? }`（二选一） | MCP 连通性自检（不建会话、不执行命令；local 查可执行文件，http 发 8s 超时 GET） |
| GET | `/api/debug` | 诊断包（版本/平台/脱敏配置/runtime 状态/会话计数；按需启动 runtime） |
| GET | `/api/hooks` | hook 预设 + 最近 hook 事件（审计） |
| POST | `/api/sessions` `{ model?, sessionId?, systemMessage?, agents?, customAgents?, agent?, skillDirs?, disabledSkills?, noBuiltinSkills?, defaultAgentExcludedTools?, mcp?, mcpServers?, disabledMcpServers?, hooks?, sessionContext?, agentStopChecklist? }` | 创建会话 → `{ sessionId }`（传 `sessionId` 即为可恢复会话） |
| GET | `/api/sessions` | **当前调用方**的会话（按 Session Registry 归属过滤；刚建未对话的会话 runtime 尚未落盘，可能不在列表） |
| GET | `/api/sessions/:id` | 单个会话元信息（越权 `403`） |
| POST | `/api/sessions/:id/resume` `{ 与创建相同的重配项 }` | 恢复会话 → `{ sessionId, resumed }`（BYOK 凭证服务端自动重传；越权 `403`） |
| POST | `/api/sessions/:id/chat` `{ prompt, streaming?, model? }` | `streaming:false` 返回 `{ content }`；`true` 返回 SSE（`delta/message/subagent/done/error`）。同一 session 的 turn 串行；客户端断开即 `abort` 当前 turn |
| DELETE | `/api/sessions/:id` | 默认断开内存附着（保留磁盘，可 resume）；`?permanent=true` 彻底删除，不可恢复。两者都排队在当前 agent turn 之后执行 |

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

## 会话持久化与 MCP

参考官方 session-persistence / mcp 两篇文档：

- **持久化**：建会话传 `sessionId`（推荐 `user-xxx-task-yyy` 结构，非法直接 400）即为可恢复会话；`POST /api/sessions/:id/resume` 在服务重启后继续（可附带重配 model/agents/skills/mcp，BYOK 凭证由服务端当前通道自动重传，无需调用方操心）；`GET /api/sessions` 按归属列会话（`attached` 标记是否在本进程内存）；`DELETE` 默认断开不断数据、`?permanent=true` 彻底删除。`COPILOT_SESSION_IDLE_TIMEOUT`（秒，0=关闭）可让 runtime 自动回收无活动会话。归属存 `COPILOT_REGISTRY_PATH`，重启后不会退化成“谁先访问谁认领”。
- **MCP**（`server/src/mcp/registry.ts`）：内置 `filesystem` 预设（官方 server，授权目录限定仓库根，可用 `COPILOT_MCP_FS_DIR` 改、`COPILOT_MCP_FILESYSTEM=false` 关）；运维经 `COPILOT_MCP_SERVERS`（JSON）预置额外 servers；前端建会话用 `mcp: [...]` 按名启用、`disabledMcpServers` 精确禁用。安全门：内联 `local/stdio` MCP = 在服务器执行任意命令，默认 400 拒绝（`COPILOT_ALLOW_INLINE_MCP_LOCAL=true` 才放行）；内联 `http/sse` 默认允许。`GET /api/mcp` 只返回元信息，headers/env 密钥永不外泄。

## 并发隔离与多租户安全

不同 session 之间已经隔离（1 session = 1 workspace）；这一节解决的是**同一 session 内多个 request** 与**归属边界**的问题。

| 层 | 机制 | 解决什么 |
|----|------|---------|
| attach lock | `sessionAttachLocks` | 并发首访只 resume 一次，避免同一 runtime session 双附着 |
| chat lock | `withSessionLock` 覆盖整个 `sendAndWait()` | `session.send()` 只是入队就返回，锁必须持续到 `session.idle`，否则同一 session 两个 turn 会同时写 workspace |
| lifecycle lock | `disconnect` / `permanent delete` 走同一个 session lock | 不在 agent 正在写文件时删 workspace / 删 runtime session |
| Session Registry | `server/src/services/session-registry.ts`（持久 JSON，生产换 PostgreSQL） | 重启后归属不丢，杜绝“谁先访问谁认领” |
| 工具授权 | `server/src/services/tool-policy.ts` | 取代 `approveAll`：write 限 workspace、bash 按策略、MCP 按会话启用名单、URL 过 SSRF + 域名 allowlist |
| 执行前守卫 | `onPreToolUse`（强制 hook，请求关不掉） | 写类工具路径必须在 session workspace |

要点：

- **归属**：`x-tenant-id` / `x-user-id` 只有在网关/IAP 会剥离客户端自带头时才可信 —— 由 `COPILOT_TRUST_IDENTITY_HEADERS=true` 显式开启（默认关闭 = 单租户，所有请求按 `default/default`）。归属判定统一走 `assertOwnership()`，路由不再各写一份。
- **SSE**：流式仍然是 SSE，但 lock 内用 `sendAndWait()`；delta 事件照样实时出来。监听器也在锁内注册，避免并发请求互收对方增量。
- **断开**：客户端断开 = `session.abort()` 当前 turn（不是断开 session），之后还能继续对话。
- **workspace 是软隔离**：`workingDirectory` 只是默认 cwd，`bash` 仍能 `cd` 出去。策略层按 `possiblePaths` 拦截、写类工具按路径拦截；不可信代码场景仍需 per-request container。

生产换 PostgreSQL 时表结构（字段与 Registry 一致）：

```sql
create table agent_sessions (
  session_id    varchar(128) primary key,
  tenant_id     varchar(128) not null,
  user_id       varchar(128) not null,
  workspace_id  varchar(64)  not null unique,
  created_at    timestamptz  not null,
  last_used_at  timestamptz  not null,
  status        varchar(32)  not null
);
```

## 环境变量（安全相关）

| 变量 | 默认 | 说明 |
|------|------|------|
| `COPILOT_TRUST_IDENTITY_HEADERS` | `false` | 是否信任 `x-tenant-id`/`x-user-id`；仅网关注入时才开 |
| `COPILOT_REGISTRY_PATH` | `$COPILOT_HOME/session-registry.json` | Session Registry 落盘位置；K8s 必须指到持久卷 |
| `COPILOT_BASH_POLICY` | `workspace` | `workspace`=命令涉及路径须在 workspace；`allow`=放行；`deny`=禁止 bash |
| `COPILOT_WARMUP` | `true` | 启动时后台预热 runtime（首屏徽章与首个会话不必等 CLI 拉起）；`false`=纯懒加载 |
| `COPILOT_URL_ALLOWLIST` | 空 | 允许访问的域名（逗号分隔；空=任意公网，仍过 SSRF 检查） |

## 版本锁定与自检

```bash
npm run check:versions     # SDK / runtime / K8s 镜像 tag 四处版本必须一致
npm run verify:agent-tools # custom agent 工具是否真能调用（只认 tool.execution_start）
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
- **诊断包**：`GET /api/debug` 一次返回排障清单——Node/平台/SDK 版本、当前通道、脱敏配置（密钥永不出现）、runtime 状态（`ping` 延迟、CLI 版本 + 协议版本、认证状态）、会话计数（内存附着/磁盘）、hooks 与 MCP 预设数。会按需启动 runtime，CLI 缺失/未认证等问题直接暴露在包里。
- **MCP 自检**：`POST /api/mcp/test`（`{ name }` 测预设，或 `{ server }` 测内联配置，内联同样受安全门约束）——local 只验证可执行文件可找到（不执行），http 发一次 8s 超时 GET（任何 HTTP 响应即算可达，MCP 端点对普通 GET 常回 4xx 属正常）。前端「调试」面板每个预设都有连通测试按钮。

## 服务端结构

- `server/src/services/session-service.ts` — `SessionService` 单例（Client 生命周期 + 会话管理 + attach/chat/lifecycle 三把锁 + 诊断包）
- `server/src/services/session-registry.ts` — 持久归属表（重启不丢；生产换 PostgreSQL）
- `server/src/services/tool-policy.ts` — 工具授权 policy + `onPreToolUse` workspace 守卫
- `server/src/services/workspace-service.ts` — session workspace（路径是 sessionId 的确定性哈希）
- `server/src/routes/api.ts` — `apiRouter`（全部 `/api/*` 路由）

## 前提

- Node.js ^20.19 或 >=22.12（Copilot SDK 要求），本机 `node -v` 需满足
- Copilot 认证二选一：本机 `copilot` CLI 已登录，或 `server/.env` 里填 `GITHUB_TOKEN`

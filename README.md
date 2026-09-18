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
| GET | `/api/health` | `{ status, uptime, copilot: connected\|disconnected\|error }` |
| GET | `/api/providers` | 通道列表 `{ providers: [{ id, displayName, defaultModel, configured, active, hint? }] }` |
| GET | `/api/models` | 当前通道可用模型列表 `{ provider, models }`（前端模型选择器用） |
| GET | `/api/agents` | agent 预设 + 技能目录 + 可发现技能（建会话表单用） |
| GET | `/api/mcp` | MCP 预设与内联开关（只含元信息，密钥不返回） |
| POST | `/api/sessions` `{ model?, sessionId?, systemMessage?, agents?, customAgents?, agent?, skillDirs?, disabledSkills?, noBuiltinSkills?, defaultAgentExcludedTools?, mcp?, mcpServers?, disabledMcpServers? }` | 创建会话 → `{ sessionId }`（传 `sessionId` 即为可恢复会话） |
| GET | `/api/sessions` | 磁盘全部会话（含 `attached` 标记；刚建未对话的会话 runtime 尚未落盘，可能不在列表） |
| GET | `/api/sessions/:id` | 单个会话元信息 |
| POST | `/api/sessions/:id/resume` `{ 与创建相同的重配项 }` | 恢复会话 → `{ sessionId, resumed }`（BYOK 凭证服务端自动重传） |
| POST | `/api/sessions/:id/chat` `{ prompt, streaming?, model? }` | `streaming:false` 返回 `{ content }`；`true` 返回 SSE（`delta/message/subagent/done/error`） |
| DELETE | `/api/sessions/:id` | 默认断开内存附着（保留磁盘，可 resume）；`?permanent=true` 彻底删除，不可恢复 |

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

- **持久化**：建会话传 `sessionId`（推荐 `user-xxx-task-yyy` 结构，非法直接 400）即为可恢复会话；`POST /api/sessions/:id/resume` 在服务重启后继续（可附带重配 model/agents/skills/mcp，BYOK 凭证由服务端当前通道自动重传，无需调用方操心）；`GET /api/sessions` 列磁盘会话（`attached` 标记是否在本进程内存）；`DELETE` 默认断开不断数据、`?permanent=true` 彻底删除。`COPILOT_SESSION_IDLE_TIMEOUT`（秒，0=关闭）可让 runtime 自动回收无活动会话。
- **MCP**（`server/src/mcp/registry.ts`）：内置 `filesystem` 预设（官方 server，授权目录限定仓库根，可用 `COPILOT_MCP_FS_DIR` 改、`COPILOT_MCP_FILESYSTEM=false` 关）；运维经 `COPILOT_MCP_SERVERS`（JSON）预置额外 servers；前端建会话用 `mcp: [...]` 按名启用、`disabledMcpServers` 精确禁用。安全门：内联 `local/stdio` MCP = 在服务器执行任意命令，默认 400 拒绝（`COPILOT_ALLOW_INLINE_MCP_LOCAL=true` 才放行）；内联 `http/sse` 默认允许。`GET /api/mcp` 只返回元信息，headers/env 密钥永不外泄。

## 前提

- Node.js ^20.19 或 >=22.12（Copilot SDK 要求），本机 `node -v` 需满足
- Copilot 认证二选一：本机 `copilot` CLI 已登录，或 `server/.env` 里填 `GITHUB_TOKEN`

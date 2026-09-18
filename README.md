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
| GET | `/api/models` | Copilot 可用模型列表（前端模型选择器用） |
| POST | `/api/sessions` `{ model?, systemMessage? }` | 创建会话 → `{ sessionId }` |
| POST | `/api/sessions/:id/chat` `{ prompt, streaming?, model? }` | `streaming:false` 返回 `{ content }`；`true` 返回 SSE（`delta/message/done/error`） |
| DELETE | `/api/sessions/:id` | 销毁会话 |

前端示例见 `client/src/lib/api.ts`（`api.health/createSession/chat/chatStream`）和 `client/src/components/Chat.tsx`。

## 前提

- Node.js ^20.19 或 >=22.12（Copilot SDK 要求），本机 `node -v` 需满足
- Copilot 认证二选一：本机 `copilot` CLI 已登录，或 `server/.env` 里填 `GITHUB_TOKEN`

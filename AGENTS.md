# AGENTS.md

> 给 AI coding agent 的工作指南。本仓库是 Express + TypeScript + Vite + `@github/copilot-sdk` 全栈框架：`client/ → server/ → Copilot CLI runtime`。细节见 `README.md`，设计见 `docs/architecture.md`。本文件只写**大规则**，细枝末节看源码和文档。

## 命令（仓库根）

```bash
npm run dev          # server(:3001) + client(:5173)
npm run build        # server tsc + client vite build
npm run typecheck    # server + client 类型检查
npm run test         # server 测试
npm run check:versions     # SDK / runtime / K8s tag 一致性（动版本相关才跑）
```

Node `>=22.13`。真实 `.env` 已 gitignore，**不要提交密钥**；密钥永不返回给前端。

## 大规则

1. **KISS，不 over-design**：用最简单的实现满足当前需求。不预留“以后可能用”的抽象、配置项、分支；不引入第二套 DSL / runtime / 端点 / 表，能复用 `execution` / HumanTask / `proposeCommand` 就复用。不在业务层写方言分支，不在路由里写 `if provider===`。
2. **不做向后兼容，保持干净版本**：改 API / schema / 流程语义时直接改断、同步改调用方 + 测试 + 文档。不保留 deprecated 字段、兼容 shim、`v1/v2` 双路径、新旧双读。旧列/旧路由删干净（SQLite 补列 + PG 迁移只向前走，不回头）。
3. **核心模型别碰**：`session ≠ execution`（一次 chat = 一个 execution）；`collaborationMode`（single/shared）创建后不可变；单副本 `replicas: 1`（锁/队列/广播全是进程内）；SDK 与 CLI runtime 完全 pin（当前 `1.0.14`），升级必须同步 `server/package.json`、`scripts/check-versions.mjs`、`k8s/` tag。
4. **安全边界只在服务端**：访问判定唯一入口 `services/session-access.ts`；错误码唯一真相源 `middleware/error-status.ts`（越权一律 403）；权限/审批策略由 `workflow/registry.ts` 决定，绝不写进 SKILL.md（会被 LLM 读到）；存储后端唯一决定点 `wiring.ts`。有疑问先读这四个文件，不自己发明判定。
5. **状态必须 durable**：execution / 审批 / 归属跨重启存活。启动先 `recoverPending()` 再 `listen`；序号用原子自增，禁止 `max()+1`。

## 改代码

- 前端调 API 只走 `client/src/lib/api.ts`。
- 提交前至少跑 `npm run typecheck` + `npm run test`。

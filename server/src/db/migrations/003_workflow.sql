-- Skill Flow：agent_execution 增加 workflow_state（当前节点 / 步数 / 等待中的任务 / SKILL.md 哈希）
-- 应用方式：psql "$DATABASE_URL" -f server/src/db/migrations/003_workflow.sql
--
-- 前置：先应用 001_agent_execution.sql 与 002_collaboration.sql（本文件只做增量）。
-- 幂等，重复执行安全。
--
-- 与 src/db/sqlite-schema.ts 的 agent_execution.workflow_state 一一对应：
-- 两种后端共用同一份 SQL 仓储实现，列名不一致会在运行期炸（test/schema.test.ts 会比对）。

-- 只有 kind = 'workflow' 的 execution 有值；其余为 null。
--
-- 为什么要 durable：@review 节点可能等几个小时，Pod 重启后 execution 仍是
-- waiting_for_approval —— 没有这个字段就不知道"等的是哪个流程节点"，无法安全恢复。
alter table agent_execution add column if not exists workflow_state jsonb;

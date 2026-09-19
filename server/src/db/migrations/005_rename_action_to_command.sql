-- `@action` → `@command`：agent_execution 的两列跟着改名
-- 应用方式：psql "$DATABASE_URL" -f server/src/db/migrations/005_rename_action_to_command.sql
--
-- 前置：先应用 001_agent_execution.sql / 002_collaboration.sql /
--       003_workflow.sql / 004_workflow_single_writer.sql。
--
-- **幂等，重复执行安全** —— 但注意 `rename column` 本身**不是**幂等的（第二次会报
-- `column "action_intent" does not exist`），所以这里必须显式判断"旧列在、新列不在"
-- 才执行。不这样写的话，一次误重跑就会让整个迁移脚本中断在半路。
--
-- 为什么改名：`@action` 是个"什么都能叫"的上位词 —— 它实际做的是
-- "agent 提出一个业务意图，服务端经过 Policy / Approval 检查后执行一次受控的业务状态变更"，
-- 也就是 DDD / CQRS 里的 Command。改名之后 Flow DSL 的四个执行词层级一致：
--
--   @task     AI 做事
--   @gate     系统判断
--   @review   人做决定
--   @command  系统改变业务状态
--
-- 为什么列名也要改而不是只改代码：列名会出现在运维的排查 SQL、备份恢复脚本、
-- 数据导出里。代码叫 command_intent、库里叫 action_intent，是最容易在故障现场
-- 写错一个列名然后以为"这行数据不存在"的那种不一致。
--
-- 改名的副作用（改之前必须知道）：
--   1. 滚动发布期间新旧 Pod 会各按自己的列名读写。**必须整体发布**，
--      或先停写。中间态下旧 Pod 会报 `column "action_intent" does not exist`。
--   2. 在途审批不受影响：commandHash 算的是**冻结的 wire format**
--      （见 execution/hash.ts 的 frozenHashInput），改名不会换 hash。
--   3. 历史审计事件的类型名（`action.executed` 等）**不迁移**，
--      由 execution/types.ts 的 canonicalEventType() 在读的时候归一化。
--
-- 与 src/db/sqlite-schema.ts 的 SQLITE_COLUMN_UPGRADES 一一对应
-- （那边是 `rename column ... to ...`，由 db/sqlite.ts 的 applyColumnUpgrades 幂等执行）。

do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_name = 'agent_execution' and column_name = 'action_intent'
  ) and not exists (
    select 1 from information_schema.columns
     where table_name = 'agent_execution' and column_name = 'command_intent'
  ) then
    alter table agent_execution rename column action_intent to command_intent;
  end if;

  if exists (
    select 1 from information_schema.columns
     where table_name = 'agent_execution' and column_name = 'action_hash'
  ) and not exists (
    select 1 from information_schema.columns
     where table_name = 'agent_execution' and column_name = 'command_hash'
  ) then
    alter table agent_execution rename column action_hash to command_hash;
  end if;
end $$;

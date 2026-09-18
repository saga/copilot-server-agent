-- Durable Agent Execution / HITL / Approval 初始 schema
-- 应用方式：psql "$DATABASE_URL" -f server/src/db/migrations/001_agent_execution.sql
--
-- 五张表覆盖：session ownership、execution、human task、approval decision、execution event。
-- tool call evidence 存执行记录的 tool_calls jsonb（完整审计走 execution_event）。

create table if not exists agent_session (
  session_id varchar(128) primary key,
  tenant_id varchar(128) not null,
  user_id varchar(128) not null,
  workspace_path text not null,
  status varchar(32) not null default 'active',
  -- resume 用会话配置（非敏感：不含任何 BYOK/凭证字段）
  config jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_used_at timestamptz
);

create index if not exists idx_agent_session_owner
  on agent_session(tenant_id, user_id);

create table if not exists agent_execution (
  execution_id varchar(64) primary key,
  session_id varchar(128) not null,
  tenant_id varchar(128) not null,
  user_id varchar(128) not null,
  kind varchar(32) not null default 'interactive',
  status varchar(32) not null default 'created',
  input jsonb,
  result jsonb,
  -- 输出字符数（审计留体量，不存全文）
  content_chars integer,
  action_intent jsonb,
  action_hash varchar(64),
  -- 批准时依据的数据版本；执行前必须复核（防止“批的是 v1，执行时已是 v2”）
  resource_version varchar(128),
  approved_resource_version varchar(128),
  current_human_task_id varchar(64),
  wait_reason varchar(32),
  model varchar(128),
  streaming boolean not null default false,
  prompt_preview text,
  usage jsonb,
  tool_calls jsonb not null default '[]',
  tool_calls_omitted integer not null default 0,
  error text,
  started_at timestamptz,
  completed_at timestamptz,
  duration_ms integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_execution_owner on agent_execution(tenant_id, user_id);
create index if not exists idx_execution_session on agent_execution(session_id);
create index if not exists idx_execution_status on agent_execution(status);
create index if not exists idx_execution_created on agent_execution(created_at desc);

create table if not exists human_task (
  task_id varchar(64) primary key,
  execution_id varchar(64) not null references agent_execution(execution_id) on delete cascade,
  tenant_id varchar(128) not null,
  type varchar(32) not null,
  status varchar(32) not null default 'open',
  title text not null,
  description text,
  payload jsonb not null default '{}',
  -- 人工输入/审批时实际提交的值（resume 时回填给 execution）
  input_values jsonb,
  input_schema jsonb,
  policy_id varchar(128),
  strategy varchar(32),
  required_count integer,
  eligible_roles jsonb not null default '[]',
  eligible_users jsonb not null default '[]',
  -- 发起人（SoD：默认不能自批）
  initiated_by varchar(128),
  expires_at timestamptz,
  -- delegation 留痕
  delegated_from varchar(128),
  delegated_to varchar(128),
  delegated_by varchar(128),
  delegated_at timestamptz,
  delegation_reason text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_human_task_execution on human_task(execution_id);
create index if not exists idx_human_task_status on human_task(status);
create index if not exists idx_human_task_tenant on human_task(tenant_id, status);

create table if not exists human_task_decision (
  decision_id varchar(64) primary key,
  task_id varchar(64) not null references human_task(task_id) on delete cascade,
  approver_id varchar(128) not null,
  approver_role varchar(128) not null,
  decision varchar(32) not null,
  comment text,
  created_at timestamptz not null default now(),
  -- 一个人对一个任务只能投一次
  unique(task_id, approver_id)
);

create index if not exists idx_decision_task on human_task_decision(task_id);

create table if not exists execution_event (
  event_id bigserial primary key,
  execution_id varchar(64) not null references agent_execution(execution_id) on delete cascade,
  sequence integer not null,
  type varchar(128) not null,
  actor_type varchar(32) not null,
  actor_id varchar(128),
  payload jsonb,
  created_at timestamptz not null default now(),
  unique(execution_id, sequence)
);

create index if not exists idx_execution_event on execution_event(execution_id, sequence);

-- 已建库的环境：create table if not exists 不会补列，这里保证重跑迁移即收敛。
alter table agent_execution add column if not exists content_chars integer;
alter table human_task add column if not exists input_values jsonb;

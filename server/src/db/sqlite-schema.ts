/**
 * SQLite schema（默认后端）。
 *
 * 为什么写成 TS 常量而不是 .sql 文件：`tsc` 只产 JS，运行时再去磁盘找 `src/db/migrations/*.sql`
 * 会在容器里失效。内嵌成字符串后构建产物自带 schema，启动即可自动建表。
 *
 * 与 `migrations/001_agent_execution.sql`（PostgreSQL 版，由运维 psql 应用）必须保持
 * **表名与列名逐一对齐** —— 两边共用同一份仓储实现，列名不一致会在运行期炸。
 * `test/schema.test.ts` 会解析两份 DDL 并逐列比对，防止漂移。
 *
 * 类型映射：jsonb → text（存 JSON 文本）；timestamptz → text（存 ISO 8601）；
 * boolean → integer（0/1）；bigserial → integer primary key autoincrement。
 *
 * 时间戳列刻意不设 SQL default：应用层一律显式写入 ISO 字符串，
 * 若让 SQLite 的 CURRENT_TIMESTAMP 兜底会写出 'YYYY-MM-DD HH:MM:SS' 与 ISO 混排，破坏排序。
 */

export const SQLITE_SCHEMA_SQL = `
create table if not exists agent_session (
  session_id text primary key,
  tenant_id text not null,
  user_id text not null,
  workspace_path text not null,
  status text not null default 'active',
  config text not null default '{}',
  created_at text not null,
  updated_at text not null,
  last_used_at text
);

create index if not exists idx_agent_session_owner
  on agent_session(tenant_id, user_id);

create table if not exists agent_execution (
  execution_id text primary key,
  session_id text not null,
  tenant_id text not null,
  user_id text not null,
  kind text not null default 'interactive',
  status text not null default 'created',
  input text,
  result text,
  content_chars integer,
  action_intent text,
  action_hash text,
  resource_version text,
  approved_resource_version text,
  current_human_task_id text,
  wait_reason text,
  model text,
  streaming integer not null default 0,
  prompt_preview text,
  usage text,
  tool_calls text not null default '[]',
  tool_calls_omitted integer not null default 0,
  error text,
  started_at text,
  completed_at text,
  duration_ms integer,
  created_at text not null,
  updated_at text not null
);

create index if not exists idx_execution_owner on agent_execution(tenant_id, user_id);
create index if not exists idx_execution_session on agent_execution(session_id);
create index if not exists idx_execution_status on agent_execution(status);
create index if not exists idx_execution_created on agent_execution(created_at desc);

create table if not exists human_task (
  task_id text primary key,
  execution_id text not null references agent_execution(execution_id) on delete cascade,
  tenant_id text not null,
  type text not null,
  status text not null default 'open',
  title text not null,
  description text,
  payload text not null default '{}',
  input_values text,
  input_schema text,
  policy_id text,
  strategy text,
  required_count integer,
  eligible_roles text not null default '[]',
  eligible_users text not null default '[]',
  initiated_by text,
  expires_at text,
  delegated_from text,
  delegated_to text,
  delegated_by text,
  delegated_at text,
  delegation_reason text,
  created_at text not null,
  completed_at text
);

create index if not exists idx_human_task_execution on human_task(execution_id);
create index if not exists idx_human_task_status on human_task(status);
create index if not exists idx_human_task_tenant on human_task(tenant_id, status);

create table if not exists human_task_decision (
  decision_id text primary key,
  task_id text not null references human_task(task_id) on delete cascade,
  approver_id text not null,
  approver_role text not null,
  decision text not null,
  comment text,
  created_at text not null,
  unique(task_id, approver_id)
);

create index if not exists idx_decision_task on human_task_decision(task_id);

create table if not exists execution_event (
  event_id integer primary key autoincrement,
  execution_id text not null references agent_execution(execution_id) on delete cascade,
  sequence integer not null,
  type text not null,
  actor_type text not null,
  actor_id text,
  payload text,
  created_at text not null,
  unique(execution_id, sequence)
);

create index if not exists idx_execution_event on execution_event(execution_id, sequence);
`;

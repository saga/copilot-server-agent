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

/** 建表（只建表，不建索引 —— 索引见 SQLITE_INDEX_SQL，原因见那里的注释） */
export const SQLITE_SCHEMA_SQL = `
create table if not exists agent_session (
  session_id text primary key,
  tenant_id text not null,
  user_id text not null,
  workspace_path text not null,
  status text not null default 'active',
  -- single | shared：会话的访问模型，创建时确定、生命周期内不变
  collaboration_mode text not null default 'single',
  -- session 级消息序号分配器（单人模式不使用）
  message_sequence integer not null default 0,
  -- session 级事件序号分配器：session_event.sequence 由它原子自增，不用 max()+1（并发下会重号）
  event_sequence integer not null default 0,
  config text not null default '{}',
  created_at text not null,
  updated_at text not null,
  last_used_at text
);

-- 参与人：single 模式只登记 owner 一行，shared 登记 owner + members。
-- 两种模式用同一张表，访问判定不需要按模式分叉。
create table if not exists session_participant (
  session_id text not null references agent_session(session_id) on delete cascade,
  tenant_id text not null,
  user_id text not null,
  role text not null,
  status text not null default 'active',
  joined_at text not null,
  left_at text,
  primary key (session_id, user_id)
);

create table if not exists agent_execution (
  execution_id text primary key,
  session_id text not null,
  tenant_id text not null,
  user_id text not null,
  -- 发起人：shared 会话里是发消息的 participant，绝不是 session owner
  initiated_by_user_id text,
  -- 触发本次执行的 session 消息（审计链 session message → execution）
  source_message_id text,
  -- 队列定序键：镜像来源消息的 sequence。created_at 是毫秒串，并发下会与消息顺序相反，
  -- 而 FIFO 必须与 transcript 顺序一致（用户看到的顺序 = agent 处理顺序）。仅协作 execution 有值。
  queue_sequence integer,
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
  -- Skill Flow 的编排状态（kind = 'workflow'）：当前节点 / 步数 / 等着哪个任务 / SKILL.md 哈希。
  -- 必须 durable：@review 可能等几个小时，重启后只有它能回答"停在哪个节点"。
  workflow_state text,
  -- execution 级事件序号分配器：execution_event.sequence 由它原子自增
  event_sequence integer not null default 0,
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

-- 协作 transcript：应用层的会话消息（人类 + agent），不是 Copilot history 的替代品。
-- sequence 由 agent_session.message_sequence 分配（时间戳在并发下会并列，不能做唯一次序）。
-- client_message_id 去重：客户端重试同一条消息不会产生第二次 execution。
create table if not exists agent_message (
  message_id text primary key,
  session_id text not null references agent_session(session_id) on delete cascade,
  tenant_id text not null,
  sequence integer not null,
  actor_type text not null,
  actor_id text,
  client_message_id text,
  content text not null,
  execution_id text,
  created_at text not null,
  unique(session_id, sequence),
  unique(session_id, client_message_id)
);

-- 协作事件流：这个 session 对所有参与者发生了什么（与 execution_event 的职责不同：
-- 后者是「这次 execution 发生了什么」的审计证据链）。
create table if not exists session_event (
  event_id integer primary key autoincrement,
  session_id text not null references agent_session(session_id) on delete cascade,
  sequence integer not null,
  type text not null,
  actor_type text not null,
  actor_id text,
  execution_id text,
  message_id text,
  payload text,
  created_at text not null,
  unique(session_id, sequence)
);
`;

/**
 * 索引。**必须在补列之后执行**，不能跟建表放在同一条 exec 里。
 *
 * 原因（这也是一个真实踩过的坑）：`create table if not exists` 对已存在的表什么都不做，
 * 所以老库文件里的 `agent_execution` 是**没有 queue_sequence 列**的。索引若跟建表一起执行，
 * 就会在补列之前引用该列 → `no such column: queue_sequence`，服务直接起不来。
 * 分开之后：建表 → 补列 → 建索引，新库与老库走同一条路径。
 */
export const SQLITE_INDEX_SQL = `
create index if not exists idx_agent_session_owner
  on agent_session(tenant_id, user_id);

create index if not exists idx_session_participant_user
  on session_participant(tenant_id, user_id, status);

create index if not exists idx_execution_owner on agent_execution(tenant_id, user_id);
create index if not exists idx_execution_session on agent_execution(session_id);
-- 队列取活：where session_id=? and status='created' order by queue_sequence
create index if not exists idx_execution_queue on agent_execution(session_id, status, queue_sequence);
create index if not exists idx_execution_status on agent_execution(status);
create index if not exists idx_execution_created on agent_execution(created_at desc);

create index if not exists idx_human_task_execution on human_task(execution_id);
create index if not exists idx_human_task_status on human_task(status);
create index if not exists idx_human_task_tenant on human_task(tenant_id, status);

create index if not exists idx_decision_task on human_task_decision(task_id);

create index if not exists idx_execution_event on execution_event(execution_id, sequence);

create index if not exists idx_agent_message_session on agent_message(session_id, sequence);

create index if not exists idx_session_event on session_event(session_id, sequence);
`;

/**
 * 已有库文件的补列语句。
 *
 * `create table if not exists` 对**已存在**的表什么都不做：老版本建的 `agent.db` 直接升上来，
 * 会在运行期报 `table agent_execution has no column named initiated_by_user_id`。
 * SQLite 没有 `add column if not exists`，所以由执行器先查 `pragma_table_info` 再决定是否 alter
 * （见 `db/sqlite.ts` 的 `applyColumnUpgrades`），重复启动安全。
 *
 * 与 `migrations/` 下的增量迁移（002 协作模型、003 workflow state）的 `add column if not exists`
 * 一一对应：新增列时两处都要加，否则两个后端会在运行期漂移。
 * 这里只允许出现「CREATE TABLE 里已经声明过的列」——`test/schema.test.ts` 会校验。
 */
export const SQLITE_COLUMN_UPGRADES: readonly string[] = [
  "alter table agent_session add column collaboration_mode text not null default 'single'",
  'alter table agent_session add column message_sequence integer not null default 0',
  'alter table agent_session add column event_sequence integer not null default 0',
  'alter table agent_execution add column initiated_by_user_id text',
  'alter table agent_execution add column source_message_id text',
  'alter table agent_execution add column queue_sequence integer',
  'alter table agent_execution add column event_sequence integer not null default 0',
  'alter table agent_execution add column workflow_state text',
];

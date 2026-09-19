-- Session 协作模型：collaborationMode + 参与人 + 消息 + 会话事件流
-- 应用方式：psql "$DATABASE_URL" -f server/src/db/migrations/002_collaboration.sql
--
-- 前置：先应用 001_agent_execution.sql（本文件只做增量，不重建已有表）。
-- 全部语句幂等，重复执行安全。
--
-- 两套 DDL（本文件 + src/db/sqlite-schema.ts）必须列名逐一对齐：
-- 两种后端共用同一份 SQL 仓储实现，列名不一致会在运行期炸。test/schema.test.ts 会比对。

-- 访问模型：single = 只有 owner；shared = owner + participants。创建时确定，之后不可改。
alter table agent_session add column if not exists collaboration_mode varchar(32) not null default 'single';
-- session 级消息序号分配器（单人模式不使用）
alter table agent_session add column if not exists message_sequence integer not null default 0;

-- 发起人（shared 会话里是发消息的 participant，不是 session owner）
alter table agent_execution add column if not exists initiated_by_user_id varchar(128);
-- 触发本次执行的 session 消息（审计链：session message → execution）
alter table agent_execution add column if not exists source_message_id varchar(64);

create table if not exists session_participant (
  session_id varchar(128) not null references agent_session(session_id) on delete cascade,
  tenant_id varchar(128) not null,
  user_id varchar(128) not null,
  -- owner | member | observer（会话角色，与业务角色 risk/compliance/... 无关）
  role varchar(32) not null,
  status varchar(32) not null default 'active',
  joined_at timestamptz not null,
  left_at timestamptz,
  primary key (session_id, user_id)
);

create index if not exists idx_session_participant_user
  on session_participant(tenant_id, user_id, status);

create table if not exists agent_message (
  message_id varchar(64) primary key,
  session_id varchar(128) not null references agent_session(session_id) on delete cascade,
  tenant_id varchar(128) not null,
  sequence bigint not null,
  actor_type varchar(32) not null,
  actor_id varchar(128),
  client_message_id varchar(128),
  content text not null,
  execution_id varchar(64),
  created_at timestamptz not null,
  unique(session_id, sequence),
  unique(session_id, client_message_id)
);

create index if not exists idx_agent_message_session on agent_message(session_id, sequence);

create table if not exists session_event (
  event_id bigserial primary key,
  session_id varchar(128) not null references agent_session(session_id) on delete cascade,
  sequence bigint not null,
  type varchar(128) not null,
  actor_type varchar(32) not null,
  actor_id varchar(128),
  execution_id varchar(64),
  message_id varchar(64),
  payload jsonb,
  created_at timestamptz not null,
  unique(session_id, sequence)
);

create index if not exists idx_session_event on session_event(session_id, sequence);

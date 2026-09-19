import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ActionService } from '../src/actions/action-service.js';
import { ApprovalService } from '../src/approval/approval-service.js';
import { currentDialect, getDb, setTestDb } from '../src/db/connection.js';
import { SqliteDatabase } from '../src/db/sqlite.js';
import {
  SqlMessageRepository,
  SqlParticipantRepository,
  SqlSessionEventRepository,
} from '../src/collaboration/sql-repository.js';
import { ExecutionService } from '../src/execution/execution-service.js';
import { SqlEventRepository, SqlExecutionRepository } from '../src/execution/sql-repository.js';
import type { ActionIntent } from '../src/execution/types.js';
import { HumanTaskService } from '../src/human-tasks/human-task-service.js';
import { SqlHumanTaskRepository } from '../src/human-tasks/sql-repository.js';
import { SessionRegistry, SqlRegistryStore } from '../src/services/session-registry.js';

/**
 * SQLite 后端（运行期默认）的端到端校验。
 *
 * 内存实现是另一套代码，跑通它并不代表 SQL 仓储正确 —— 列名、方言、JSON 编解码、
 * 唯一约束、级联删除都只有真库能验证。这里每个用例在**临时文件**上跑，
 * 并显式 close → 重新打开来断言「重启后仍在」（durable 的核心承诺）。
 */

const OWNER = { tenantId: 't1', userId: 'pm-1' };
const PM = { tenantId: 't1', userId: 'pm-1', roles: ['portfolio_manager'] };
const RISK = { tenantId: 't1', userId: 'risk-1', roles: ['risk'] };
const OPS = { tenantId: 't1', userId: 'ops-1', roles: ['operations'] };

const voteIntent = (over: Partial<ActionIntent> = {}): ActionIntent => ({
  actionType: 'submit_proxy_vote',
  target: { type: 'security', id: 'US1234567890' },
  parameters: { resolution: 'FOR', shares: 125000 },
  reason: 'agent recommends FOR',
  requestedBy: { userId: 'pm-1', tenantId: 't1' },
  createdAt: new Date().toISOString(),
  ...over,
});

/** 临时目录 + 打开库并接管连接；返回可 re-open 的句柄 */
function newWorkdir(): { dir: string; file: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'copilot-sqlite-'));
  return { dir, file: path.join(dir, 'agent.db') };
}

function open(file: string): SqliteDatabase {
  const db = new SqliteDatabase(file);
  setTestDb(db);
  return db;
}

function teardown(db: SqliteDatabase, dir: string): void {
  setTestDb(null);
  void db.close();
  rmSync(dir, { recursive: true, force: true });
}

function wire() {
  const approval = new ApprovalService({ allowInitiatorApproval: false });
  const actions = new ActionService({ approval });
  const execution = new ExecutionService({
    repository: new SqlExecutionRepository(),
    events: new SqlEventRepository(),
    actions,
  });
  const humanTasks = new HumanTaskService({
    repository: new SqlHumanTaskRepository(),
    approval,
    onResolved: (task, resolution, decisions) =>
      execution.onHumanTaskResolved(task, resolution, decisions),
  });
  execution.bindHumanTasks(humanTasks);
  return { execution, humanTasks };
}

test('SQLite：execution 全字段往返（JSON 列 / 布尔 / 时间戳 / contentChars）', async () => {
  const { dir, file } = newWorkdir();
  const db = open(file);
  try {
    const { execution } = wire();
    const exec = await execution.create({
      sessionId: 's-fields',
      owner: OWNER,
      kind: 'job',
      input: { prompt: 'hello' },
      streaming: true,
    });
    await execution.start(exec.executionId);
    await execution.complete(exec.executionId, {
      contentChars: 42,
      result: { receipt: 'vote_ex_1' },
      usage: {
        inputTokens: 10,
        outputTokens: 3,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        reasoningTokens: 0,
        durationMs: 120,
        llmCalls: 1,
        models: ['gpt-5'],
      },
      toolCalls: [
        {
          toolCallId: 't1',
          toolName: 'read_file',
          startedAt: new Date().toISOString(),
          decision: 'allow',
          isError: false,
        },
      ],
    });

    // 从库里重新读，而不是看返回值
    const loaded = (await new SqlExecutionRepository().get(exec.executionId))!;
    assert.equal(loaded.status, 'completed');
    assert.equal(loaded.streaming, true, '布尔列必须往返成 boolean');
    assert.equal(loaded.contentChars, 42, 'content_chars 必须落库');
    assert.equal((loaded.usage as { inputTokens: number }).inputTokens, 10);
    assert.equal((loaded.usage as { models: string[] }).models[0], 'gpt-5');
    assert.equal(loaded.toolCalls.length, 1);
    assert.equal(loaded.toolCalls[0]!.toolName, 'read_file');
    assert.deepEqual(loaded.input, { prompt: 'hello' });
    assert.deepEqual(loaded.result, { receipt: 'vote_ex_1' });
    assert.ok(Date.parse(loaded.createdAt) > 0, '时间戳必须是可解析的 ISO');
    assert.ok(Date.parse(loaded.completedAt!) > 0);
  } finally {
    teardown(db, dir);
  }
});

test('SQLite：关库重开后 execution / 事件时间线 / 审批任务都还在', async () => {
  const { dir, file } = newWorkdir();
  let db = open(file);
  let executionId = '';
  let taskId = '';
  try {
    const { execution, humanTasks } = wire();
    const exec = await execution.create({ sessionId: 's-durable', owner: OWNER, kind: 'job' });
    executionId = exec.executionId;
    await execution.start(executionId);
    const verdict = await execution.proposeAction(executionId, voteIntent());
    taskId = verdict.taskId!;
    assert.equal((await execution.get(executionId))!.status, 'waiting_for_approval');

    // 模拟进程重启：关连接 → 重新打开同一个文件
    await db.close();
    db = open(file);

    const { execution: execution2, humanTasks: humanTasks2 } = wire();
    const resumed = (await execution2.get(executionId))!;
    assert.equal(resumed.status, 'waiting_for_approval', '重启后审批中的 execution 必须还在');
    assert.equal(resumed.currentHumanTaskId, taskId);

    const task = (await humanTasks2.repository.get(taskId))!;
    assert.equal(task.status, 'open');
    assert.equal(task.eligibleRoles.length > 0, true, 'eligible_roles JSON 数组必须往返');

    const events = await execution2.events(executionId, 100);
    assert.ok(events.length >= 3, `事件时间线应保留，实际 ${events.length}`);
    assert.deepEqual(
      events.map((e) => e.sequence),
      [...events.map((e) => e.sequence)].sort((a, b) => a - b),
      'sequence 必须单调递增',
    );

    // 重启后继续审批，链路能走完
    await humanTasks2.approve(taskId, { principal: { ...PM, userId: 'pm-2' } });
    await humanTasks2.approve(taskId, { principal: RISK });
    const final = await humanTasks2.approve(taskId, { principal: OPS });
    assert.equal(final.evaluation.outcome, 'approved');
    assert.equal((await execution2.get(executionId))!.status, 'completed');
  } finally {
    teardown(db, dir);
  }
});

test('SQLite：人工输入的 input_values 落库，重启后可读且回填 execution', async () => {
  const { dir, file } = newWorkdir();
  let db = open(file);
  let taskId = '';
  let executionId = '';
  try {
    const { execution, humanTasks } = wire();
    const exec = await execution.create({ sessionId: 's-input', owner: OWNER, kind: 'job' });
    executionId = exec.executionId;
    await execution.start(executionId);
    await execution.transition(executionId, 'waiting_for_input', { waitReason: 'input' });

    const task = await humanTasks.createInputTask({
      executionId,
      tenantId: OWNER.tenantId,
      title: '补充投票取向',
      // 提交按 isAssignee 判定，所以必须显式给出 assignee（不写就退到默认角色 approver）
      eligibleRoles: ['portfolio_manager'],
      inputSchema: {
        fields: [
          { name: 'vote', type: 'select', required: true, options: ['FOR', 'AGAINST', 'ABSTAIN'] },
          { name: 'comment', type: 'string', required: false },
        ],
      },
    });
    taskId = task.taskId;
    await humanTasks.submitInput(taskId, { principal: PM, values: { vote: 'FOR', comment: 'ok' } });

    await db.close();
    db = open(file);

    const { execution: execution2, humanTasks: humanTasks2 } = wire();
    const reloaded = (await humanTasks2.repository.get(taskId))!;
    assert.deepEqual(reloaded.inputValues, { vote: 'FOR', comment: 'ok' });
    assert.deepEqual(reloaded.inputSchema?.fields.length, 2);
    const done = (await execution2.get(executionId))!;
    assert.notEqual(done.status, 'waiting_for_input', '重启后应已恢复执行');
  } finally {
    teardown(db, dir);
  }
});

test('SQLite：一人一票由唯一约束兜底（绕过应用层判断也拦得住）', async () => {
  const { dir, file } = newWorkdir();
  const db = open(file);
  try {
    const { execution, humanTasks } = wire();
    const exec = await execution.create({ sessionId: 's-vote', owner: OWNER, kind: 'job' });
    await execution.start(exec.executionId);
    const verdict = await execution.proposeAction(exec.executionId, voteIntent());
    const taskId = verdict.taskId!;

    const repo = new SqlHumanTaskRepository();
    const base = {
      decisionId: '',
      taskId,
      approverId: 'risk-1',
      approverRole: 'risk',
      decision: 'approve' as const,
      createdAt: new Date().toISOString(),
    };
    await repo.addDecision(base);
    await assert.rejects(() => repo.addDecision(base), /UNIQUE|unique/i);
    assert.equal((await repo.listDecisions(taskId)).length, 1);
    // 应用层也给出可读错误
    await assert.rejects(
      () => humanTasks.approve(taskId, { principal: RISK }),
      /不能重复审批/,
    );
  } finally {
    teardown(db, dir);
  }
});

test('SQLite：eligible_roles / eligible_users / delegated_to 命中判定', async () => {
  const { dir, file } = newWorkdir();
  const db = open(file);
  try {
    const { execution, humanTasks } = wire();
    const exec = await execution.create({ sessionId: 's-filter', owner: OWNER, kind: 'job' });
    await execution.start(exec.executionId);
    await execution.transition(exec.executionId, 'waiting_for_input', { waitReason: 'input' });

    const byRole = await humanTasks.createInputTask({
      executionId: exec.executionId,
      tenantId: OWNER.tenantId,
      title: '按角色指派',
      inputSchema: { fields: [{ name: 'a', type: 'string', required: true }] },
    });
    await humanTasks.repository.update(byRole.taskId, { eligibleRoles: ['risk', 'ops'] });

    const byUser = await humanTasks.createInputTask({
      executionId: exec.executionId,
      tenantId: OWNER.tenantId,
      title: '按用户指派',
      inputSchema: { fields: [{ name: 'b', type: 'string', required: true }] },
    });
    await humanTasks.repository.update(byUser.taskId, { eligibleUsers: ['alice'] });

    const repo = new SqlHumanTaskRepository();
    const asRisk = await repo.list({ tenantId: OWNER.tenantId, assignee: { userId: 'bob', roles: ['risk'] } });
    assert.deepEqual(asRisk.map((t) => t.taskId), [byRole.taskId], '角色交集命中');

    const asAlice = await repo.list({
      tenantId: OWNER.tenantId,
      assignee: { userId: 'alice', roles: ['other'] },
    });
    assert.ok(asAlice.some((t) => t.taskId === byUser.taskId), '显式指派命中');

    const asNobody = await repo.list({
      tenantId: OWNER.tenantId,
      assignee: { userId: 'zeta', roles: ['finance'] },
    });
    assert.deepEqual(asNobody, [], '都不命中时不应返回');

    // 委派命中也算有资格
    await repo.update(byUser.taskId, { delegatedTo: 'carol' });
    const asCarol = await repo.list({
      tenantId: OWNER.tenantId,
      assignee: { userId: 'carol', roles: ['other'] },
    });
    assert.ok(asCarol.some((t) => t.taskId === byUser.taskId), '被委派人命中');
  } finally {
    teardown(db, dir);
  }
});

test('SQLite：删 execution 时级联清理 task / event（foreign_keys 必须开启）', async () => {
  const { dir, file } = newWorkdir();
  const db = open(file);
  try {
    const { execution, humanTasks } = wire();
    const exec = await execution.create({ sessionId: 's-cascade', owner: OWNER, kind: 'job' });
    await execution.start(exec.executionId);
    const verdict = await execution.proposeAction(exec.executionId, voteIntent());

    const repo = new SqlHumanTaskRepository();
    assert.ok(await repo.get(verdict.taskId!));
    assert.ok((await execution.events(exec.executionId, 10)).length > 0);

    const dialect = currentDialect();
    const { getDb } = await import('../src/db/connection.js');
    await getDb().query(
      `delete from agent_execution where execution_id = ${dialect.ph(1)}`,
      [exec.executionId],
    );

    assert.equal(await repo.get(verdict.taskId!), undefined, 'human_task 应被级联删除');
    assert.deepEqual(
      (await getDb().query(`select * from execution_event where execution_id = ${dialect.ph(1)}`, [
        exec.executionId,
      ])).rows,
      [],
      'execution_event 应被级联删除',
    );
    void humanTasks;
  } finally {
    teardown(db, dir);
  }
});

test('默认后端 = SQLite，首次连接自动建表（无需任何迁移命令）', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'copilot-default-'));
  try {
    const serverRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
    const script = `
      const { stateBackend } = await import('./src/wiring.ts');
      // 触发首次连接：应自动建库 + 应用到最新 schema
      const { getDb } = await import('./src/db/connection.ts');
      const { rows } = await getDb().query("select name from sqlite_master where type = 'table' order by name");
      console.log(JSON.stringify({ stateBackend, tables: rows.map((r) => r.name) }));
    `;
    const res = spawnSync(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '-e', script],
      {
        cwd: serverRoot,
        // 关键：临时 HOME，绝不碰用户真实 ~/.copilot
        env: { ...process.env, COPILOT_HOME: dir, DATABASE_URL: '', COPILOT_STATE_BACKEND: '' },
        encoding: 'utf-8',
      },
    );
    assert.equal(res.status, 0, res.stderr);
    const out = JSON.parse(res.stdout.trim().split('\n').at(-1)!) as {
      stateBackend: string;
      tables: string[];
    };
    assert.equal(out.stateBackend, 'sqlite', '未配 DATABASE_URL 时应默认 SQLite');
    assert.ok(out.tables.includes('agent_execution'));
    assert.ok(out.tables.includes('human_task'));
    assert.ok(out.tables.includes('human_task_decision'));
    assert.ok(out.tables.includes('execution_event'));
    assert.ok(out.tables.includes('agent_session'));
    // 协作模型的三张表也必须自动建出来（默认后端不该要求先跑迁移脚本）
    assert.ok(out.tables.includes('session_participant'));
    assert.ok(out.tables.includes('agent_message'));
    assert.ok(out.tables.includes('session_event'));
    assert.ok(existsSync(path.join(dir, 'agent.db')), '库文件应落在 $COPILOT_HOME/agent.db');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('SQLite：session registry 归属与 config 跨重启保留', async () => {
  const { dir, file } = newWorkdir();
  let db = open(file);
  try {
    const registry = new SessionRegistry(new SqlRegistryStore());
    await registry.create({
      sessionId: 'sess-1',
      owner: OWNER,
      workspacePath: '/workspaces/sess-1',
      collaborationMode: 'shared',
      config: { model: 'gpt-5', skillDirs: ['/skills/a'] },
    });

    await db.close();
    db = open(file);

    const reopened = new SessionRegistry(new SqlRegistryStore());
    const rec = await reopened.get('sess-1');
    assert.ok(rec, '重启后归属记录必须还在');
    assert.equal(rec.tenantId, 't1');
    assert.equal(rec.collaborationMode, 'shared', 'collaboration_mode 必须往返');
    assert.equal(rec.workspacePath, '/workspaces/sess-1');
    assert.equal(rec.config?.model, 'gpt-5', 'config JSON 必须往返');
    assert.deepEqual(rec.config?.skillDirs, ['/skills/a']);

    // 归属校验：别的租户拿不到
    await assert.rejects(() => reopened.assertOwner('sess-1', { tenantId: 't2', userId: 'x' }), /无权访问/);
    // 模式不可变：同 id 换模式必须拒绝（不能在原地把 single 改成 shared）
    await assert.rejects(
      () => reopened.create({ sessionId: 'sess-1', owner: OWNER, workspacePath: '/w', collaborationMode: 'single' }),
      /模式不同/,
    );
    await reopened.remove('sess-1');
    assert.equal(await reopened.get('sess-1'), undefined);
  } finally {
    teardown(db, dir);
  }
});

/** pragma_table_info 列出真实列名 —— 补列是否生效只能这样验 */
async function columnsOf(db: SqliteDatabase, table: string): Promise<string[]> {
  const { rows } = await db.query<{ name: string }>(`select name from pragma_table_info('${table}')`);
  return rows.map((r) => r.name);
}

test('SQLite：老库文件缺协作列时自动补列（create table if not exists 补不上新增列）', async () => {
  const { dir, file } = newWorkdir();
  const now = new Date().toISOString();

  // 用「旧版 schema」直接建库：这两张表都还没有协作相关的列
  const ctor = createRequire(import.meta.url)('node:sqlite') as {
    DatabaseSync: new (p: string) => { exec(sql: string): void; close(): void };
  };
  const legacy = new ctor.DatabaseSync(file);
  legacy.exec(`
    create table agent_session (
      session_id text primary key, tenant_id text not null, user_id text not null,
      workspace_path text not null, status text not null default 'active',
      config text not null default '{}', created_at text not null,
      updated_at text not null, last_used_at text);
    create table agent_execution (
      execution_id text primary key, session_id text not null, tenant_id text not null,
      user_id text not null, kind text not null default 'interactive',
      status text not null default 'created', streaming integer not null default 0,
      tool_calls text not null default '[]', tool_calls_omitted integer not null default 0,
      created_at text not null, updated_at text not null);
    insert into agent_session
      (session_id, tenant_id, user_id, workspace_path, status, config, created_at, updated_at)
      values ('old-1', 't1', 'pm-1', '/workspaces/old-1', 'active', '{}', '${now}', '${now}');
  `);
  legacy.close();

  const db = open(file);
  try {
    assert.ok((await columnsOf(db, 'agent_session')).includes('collaboration_mode'));
    assert.ok((await columnsOf(db, 'agent_session')).includes('message_sequence'));
    assert.ok((await columnsOf(db, 'agent_session')).includes('event_sequence'));
    assert.ok((await columnsOf(db, 'agent_execution')).includes('initiated_by_user_id'));
    assert.ok((await columnsOf(db, 'agent_execution')).includes('source_message_id'));
    assert.ok((await columnsOf(db, 'agent_execution')).includes('queue_sequence'));
    assert.ok((await columnsOf(db, 'agent_execution')).includes('event_sequence'));

    // 老数据行必须拿到 default，而不是 null：否则读出来就是 undefined，模式判定会跑偏
    const { rows } = await db.query<{
      collaboration_mode: string;
      message_sequence: number;
      event_sequence: number;
    }>(
      "select collaboration_mode, message_sequence, event_sequence from agent_session where session_id = 'old-1'",
    );
    assert.equal(rows[0]!.collaboration_mode, 'single');
    assert.equal(rows[0]!.message_sequence, 0);
    assert.equal(rows[0]!.event_sequence, 0);

    // 索引引用了「补列才会出现」的列（queue_sequence）。它必须在补列之后建 ——
    // 若与建表放在同一条 exec 里，老库会在启动时直接 `no such column` 起不来。
    const idx = await db.query<{ name: string }>(
      "select name from sqlite_master where type = 'index' and name = 'idx_execution_queue'",
    );
    assert.equal(idx.rows.length, 1, '补列之后队列索引必须建起来');

    // 升级后的老 session 能真的分配事件序号（说明 event_sequence 计数器可用）
    const events = new SqlSessionEventRepository();
    const first = await events.append({
      sessionId: 'old-1',
      type: 'participant.joined',
      actorType: 'system',
      createdAt: now,
    });
    assert.equal(first.sequence, 1);

    // 升级后老会话照旧可读可写（读路径不必区分「老库新库」）
    const record = await new SqlRegistryStore().get('old-1');
    assert.equal(record?.collaborationMode, 'single');
    assert.equal(record?.workspacePath, '/workspaces/old-1');
    assert.equal(record?.lastUsedAt, now, 'last_used_at 为空时回落到 created_at');
  } finally {
    teardown(db, dir);
  }
});

test('SQLite：协作仓储往返（消息幂等 / 序号分配 / 事件游标 / 级联清理）', async () => {  const { dir, file } = newWorkdir();
  const db = open(file);
  const now = new Date().toISOString();
  try {
    const registry = new SessionRegistry(new SqlRegistryStore());
    await registry.create({
      sessionId: 'c-1',
      owner: OWNER,
      workspacePath: '/workspaces/c-1',
      collaborationMode: 'shared',
    });

    const participants = new SqlParticipantRepository();
    await participants.upsert({
      sessionId: 'c-1',
      tenantId: 't1',
      userId: 'pm-1',
      role: 'owner',
      joinedAt: now,
    });
    await participants.upsert({
      sessionId: 'c-1',
      tenantId: 't1',
      userId: 'risk-1',
      role: 'member',
      joinedAt: now,
    });
    // 同一人重复 upsert 不产生第二行（一人一行，复活而不是叠加）
    await participants.upsert({
      sessionId: 'c-1',
      tenantId: 't1',
      userId: 'risk-1',
      role: 'observer',
      joinedAt: now,
    });
    const listed = await participants.list('c-1');
    assert.equal(listed.length, 2);
    assert.equal(listed.find((p) => p.userId === 'risk-1')?.role, 'observer');
    assert.deepEqual(await participants.listActiveSessionIds('t1', 'risk-1'), ['c-1']);

    const messages = new SqlMessageRepository();
    const base = { sessionId: 'c-1', tenantId: 't1', actorType: 'user' as const, createdAt: now };
    const m1 = await messages.create({ ...base, actorId: 'pm-1', content: 'A', clientMessageId: 'k1' });
    const duplicate = await messages.create({
      ...base,
      actorId: 'pm-1',
      content: 'A',
      clientMessageId: 'k1',
    });
    assert.equal(m1.created, true);
    assert.equal(duplicate.created, false, '同 clientMessageId 必须命中已有消息');
    assert.equal(duplicate.message.messageId, m1.message.messageId);
    assert.equal(m1.message.sequence, 1);

    // 序号来自 agent_session.message_sequence 的原子自增，不是时间戳
    const m2 = await messages.create({ ...base, actorId: 'risk-1', content: 'B' });
    assert.equal(m2.message.sequence, 2);

    // 并发提交：同一 session 的序号必须互不重复（时间戳方案在这里会并列）
    const many = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        messages.create({ ...base, actorId: 'risk-1', content: `并发 ${i}` }),
      ),
    );
    assert.equal(new Set(many.map((r) => r.message.sequence)).size, 10);
    assert.deepEqual(
      (await messages.list('c-1')).map((m) => m.sequence),
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      'sequence 必须连续且升序',
    );

    // clientMessageId 为空时不做去重（NULL 不等于 NULL）
    const a = await messages.create({ ...base, content: 'no-key' });
    const b = await messages.create({ ...base, content: 'no-key' });
    assert.notEqual(a.message.messageId, b.message.messageId);

    await messages.attachExecution(m1.message.messageId, 'ex-1');
    assert.equal((await messages.get(m1.message.messageId))?.executionId, 'ex-1');

    const events = new SqlSessionEventRepository();
    const e1 = await events.append({ sessionId: 'c-1', type: 'message.created', actorType: 'user', createdAt: now });
    const e2 = await events.append({
      sessionId: 'c-1',
      type: 'execution.queued',
      actorType: 'system',
      executionId: 'ex-1',
      messageId: m1.message.messageId,
      payload: { apiKey: 'sk-live-abcdef123456', kept: 1 },
      createdAt: now,
    });
    assert.equal(e1.sequence, 1);
    assert.equal(e2.sequence, 2);
    assert.match(e1.eventId, /^\d+$/, 'SQLite 的 event_id 是自增整数');
    assert.equal(e2.executionId, 'ex-1');
    assert.equal(e2.messageId, m1.message.messageId);

    assert.deepEqual((await events.listAfter('c-1', 1)).map((e) => e.type), ['execution.queued']);
    assert.deepEqual(await events.listAfter('c-1', 2), []);

    // 删会话级联清参与人 / 消息 / 事件（而 execution 不带 FK，自己删自己）
    await getDb().query(`delete from agent_session where session_id = ${currentDialect().ph(1)}`, ['c-1']);
    assert.deepEqual(await participants.list('c-1'), []);
    assert.deepEqual(await messages.list('c-1'), []);
    assert.deepEqual(await events.listAfter('c-1', 0), []);
  } finally {
    teardown(db, dir);
  }
});

test('SQLite：execution 的发起人与来源消息必须读得回来（写进去 ≠ 读得到）', async () => {
  const { dir, file } = newWorkdir();
  const db = open(file);
  try {
    const { execution } = wire();
    const exec = await execution.create({
      sessionId: 's-attr',
      owner: OWNER,
      initiatedByUserId: 'risk-1',
      kind: 'interactive',
      sourceMessageId: 'msg-1',
      queueSequence: 7,
    });

    // 写入路径正确不代表读回路径正确：列写了但 toRecord 没映射，运行期才炸
    // （shared 会话的队列要靠 sourceMessageId 从会话消息恢复输入）。
    const back = await execution.get(exec.executionId);
    assert.equal(back?.userId, 'pm-1', 'userId 是数据归属（会话 owner）');
    assert.equal(back?.initiatedByUserId, 'risk-1', 'initiatedByUserId 是发起人');
    assert.equal(back?.sourceMessageId, 'msg-1');
    assert.equal(back?.queueSequence, 7, '队列定序键要读得回来（= 来源消息 sequence）');

    // 列表路径同样要带上，否则 GET /api/executions 看不到是谁发起的
    const [listed] = await execution.list({ sessionId: 's-attr' });
    assert.equal(listed?.initiatedByUserId, 'risk-1');
    assert.equal(listed?.sourceMessageId, 'msg-1');

    // 缺省时 initiated_by_user_id 回落成 owner（single 模式两者恒相同）
    const plain = await execution.create({ sessionId: 's-attr', owner: OWNER });
    assert.equal((await execution.get(plain.executionId))?.initiatedByUserId, 'pm-1');

    // 队列取活：协作 execution（有来源消息）按 queue_sequence 定序
    assert.equal((await execution.nextQueued('s-attr'))?.executionId, exec.executionId);

    // 边界：没有来源消息的后台 job 不算协作队列项 —— 它由显式 /run 驱动，
    // 混进队列会被调度器当成"等 agent 输入"并直接判 failed。
    const job = await execution.create({ sessionId: 's-attr', owner: OWNER, kind: 'job' });
    assert.equal(job.status, 'created');
    assert.equal(
      (await execution.nextQueued('s-attr'))?.executionId,
      exec.executionId,
      'job 不参与协作队列，取到的仍是那条协作 execution',
    );

    // 定序键决定顺序，而不是创建时间：新建一条 queue_sequence 更小的，它应该排到前面
    const earlier = await execution.create({
      sessionId: 's-attr',
      owner: OWNER,
      initiatedByUserId: 'risk-1',
      sourceMessageId: 'msg-0',
      queueSequence: 3,
    });
    assert.equal((await execution.nextQueued('s-attr'))?.executionId, earlier.executionId);
    const queuedSessions = await execution.queuedSessionIds();
    assert.deepEqual(queuedSessions, ['s-attr']);
  } finally {
    teardown(db, dir);
  }
});

test('SQLite：created 的排队项可以直接落 failed（跑不起来时不该留在队头）', async () => {
  const { dir, file } = newWorkdir();
  const db = open(file);
  try {
    const { execution } = wire();
    const exec = await execution.create({ sessionId: 's-stuck', owner: OWNER, kind: 'job' });
    assert.equal(exec.status, 'created');
    await execution.fail(exec.executionId, new Error('缺少来源消息'));
    const after = await execution.get(exec.executionId);
    assert.equal(after?.status, 'failed');
    assert.match(after?.error ?? '', /缺少来源消息/);
  } finally {
    teardown(db, dir);
  }
});

test('SQLite：事件序号冲突必须抛错，绝不能静默返回一个库里不存在的序号', async () => {
  /**
   * 回归目标：`max(sequence)+1` + `on conflict do nothing` 的组合。
   *
   * 两个并发 append 读到同一个 max、算出同一个序号，后到的被 `do nothing` 吞掉 ——
   * 但调用方拿到的却是一个"成功"的序号。表现是审计链/SSE 游标里永远缺一条事件，
   * 而没有任何一方报错。改成原子自增之后，这种状态只可能来自绕过分配器的写入，
   * 此时必须**抛错**而不是假装成功。
   */
  const { dir, file } = newWorkdir();
  const db = open(file);
  const now = new Date().toISOString();
  try {
    await new SessionRegistry(new SqlRegistryStore()).create({
      sessionId: 'conflict-1',
      owner: OWNER,
      workspacePath: '/workspaces/conflict-1',
    });
    const events = new SqlEventRepository();
    const execution = new ExecutionService({
      repository: new SqlExecutionRepository(),
      events,
    });
    const exec = await execution.create({ sessionId: 'conflict-1', owner: OWNER });

    // ---- session_event ----
    const sessionEvents = new SqlSessionEventRepository();
    const first = await sessionEvents.append({
      sessionId: 'conflict-1',
      type: 'message.created',
      actorType: 'user',
      createdAt: now,
    });
    assert.equal(first.sequence, 1);

    // 把分配器回退，制造"下一次分配撞上已存在的序号"（等价于并发算出同一序号）
    await db.query("update agent_session set event_sequence = 0 where session_id = 'conflict-1'");
    await assert.rejects(
      () =>
        sessionEvents.append({
          sessionId: 'conflict-1',
          type: 'message.created',
          actorType: 'user',
          createdAt: now,
        }),
      (err: unknown) => /UNIQUE|写入失败/.test(String(err)),
      '序号冲突必须抛错',
    );
    const afterSession = await db.query<{ n: number }>(
      "select count(*) as n from session_event where session_id = 'conflict-1'",
    );
    assert.equal(Number(afterSession.rows[0]!.n), 1, '冲突不能留下第二条，也不能假装写入成功');

    // ---- execution_event：同一条路径 ----
    await db.query('update agent_execution set event_sequence = 0 where execution_id = ?1', [
      exec.executionId,
    ]);
    await assert.rejects(
      () =>
        events.append({
          executionId: exec.executionId,
          type: 'execution.started',
          actorType: 'system',
          createdAt: now,
        }),
      (err: unknown) => /UNIQUE|写入失败/.test(String(err)),
      'execution 事件序号冲突同样必须抛错',
    );
  } finally {
    teardown(db, dir);
  }
});

test('SQLite：事件序号是 durable 的（重启后接着分配，不回头重号）', async () => {
  const { dir, file } = newWorkdir();
  const now = new Date().toISOString();

  let db = open(file);
  try {
    await new SessionRegistry(new SqlRegistryStore()).create({
      sessionId: 'seq-durable',
      owner: OWNER,
      workspacePath: '/workspaces/seq-durable',
    });
    const events = new SqlSessionEventRepository();
    for (let i = 0; i < 5; i += 1) {
      await events.append({
        sessionId: 'seq-durable',
        type: 'message.created',
        actorType: 'user',
        createdAt: now,
      });
    }
  } finally {
    setTestDb(null);
    await db.close();
  }

  // 关库重开：计数器在 agent_session 行上，不靠"数一遍已有事件"
  db = open(file);
  try {
    const events = new SqlSessionEventRepository();
    const next = await events.append({
      sessionId: 'seq-durable',
      type: 'message.created',
      actorType: 'user',
      createdAt: now,
    });
    assert.equal(next.sequence, 6, '重启后必须接着 6，而不是从 1 重来');
  } finally {
    teardown(db, dir);
  }
});

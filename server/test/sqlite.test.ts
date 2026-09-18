import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ActionService } from '../src/actions/action-service.js';
import { ApprovalService } from '../src/approval/approval-service.js';
import { currentDialect, setTestDb } from '../src/db/connection.js';
import { SqliteDatabase } from '../src/db/sqlite.js';
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
    await registry.upsert({
      sessionId: 'sess-1',
      owner: OWNER,
      workspacePath: '/workspaces/sess-1',
      config: { model: 'gpt-5', skillDirs: ['/skills/a'] },
    });

    await db.close();
    db = open(file);

    const reopened = new SessionRegistry(new SqlRegistryStore());
    const rec = await reopened.get('sess-1');
    assert.ok(rec, '重启后归属记录必须还在');
    assert.equal(rec.tenantId, 't1');
    assert.equal(rec.workspacePath, '/workspaces/sess-1');
    assert.equal(rec.config?.model, 'gpt-5', 'config JSON 必须往返');
    assert.deepEqual(rec.config?.skillDirs, ['/skills/a']);

    // 归属校验：别的租户拿不到
    await assert.rejects(() => reopened.assertAccess('sess-1', { tenantId: 't2', userId: 'x' }), /无权访问/);
    await reopened.remove('sess-1');
    assert.equal(await reopened.get('sess-1'), undefined);
  } finally {
    teardown(db, dir);
  }
});

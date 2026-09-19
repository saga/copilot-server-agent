import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CollaborationService } from '../src/collaboration/collaboration-service.js';
import {
  MemoryMessageRepository,
  MemoryParticipantRepository,
  MemorySessionEventRepository,
} from '../src/collaboration/memory-repository.js';
import { MessageService } from '../src/collaboration/message-service.js';
import { ParticipantService } from '../src/collaboration/participant-service.js';
import { SessionCoordinator } from '../src/collaboration/session-coordinator.js';
import { SessionEventService } from '../src/collaboration/session-event-service.js';
import { SESSION_EVENT_TYPES as EVT, roleAllows } from '../src/collaboration/types.js';
import { ExecutionService } from '../src/execution/execution-service.js';
import {
  MemoryEventRepository,
  MemoryExecutionRepository,
} from '../src/execution/memory-repository.js';
import { isTerminal } from '../src/execution/types.js';
import type { Principal } from '../src/services/principal.js';
import { SessionAccessService } from '../src/services/session-access.js';
import { MemoryRegistryStore, SessionRegistry } from '../src/services/session-registry.js';

/**
 * 会话协作模型：访问矩阵 / 模式不可变 / 消息幂等与序号 / 队列串行 / 事件游标。
 *
 * 全部走内存仓储：这些用例验的是**规则**（谁能进、能不能改模式、同一时刻跑几个 turn），
 * 不需要拉起 Copilot runtime，也不需要真库。真库上的等价校验在 sqlite.test.ts 与
 * schema.test.ts（两份 DDL 逐列比对）。
 */

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(5);
  }
  throw new Error('等待条件成立超时');
}

const principal = (userId: string, tenantId = 't1'): Principal => ({
  tenantId,
  userId,
  roles: ['approver'],
});

const ALICE = principal('alice');
const BOB = principal('bob');
const CAROL = principal('carol');
const MALLORY = principal('mallory', 't2');

/** 一整套内存协作栈：registry + 参与人 + 消息 + 事件流 + 队列 + 执行 */
function makeStack() {
  const registry = new SessionRegistry(new MemoryRegistryStore());
  const participants = new MemoryParticipantRepository();
  const messageRepository = new MemoryMessageRepository();
  const sessionEventRepository = new MemorySessionEventRepository();

  const access = new SessionAccessService({ registry, participants });
  const events = new SessionEventService(sessionEventRepository);
  const messages = new MessageService({ repository: messageRepository, access });
  const executions = new ExecutionService({
    repository: new MemoryExecutionRepository(),
    events: new MemoryEventRepository(),
  });
  const participantService = new ParticipantService({
    repository: participants,
    registry,
    access,
    events,
  });

  const started: Array<{ executionId: string; prompt: string; overlap: number }> = [];
  let inFlight = 0;
  let peak = 0;

  const coordinator = new SessionCoordinator({
    executions,
    messages,
    events,
    run: async ({ execution, prompt }) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      started.push({ executionId: execution.executionId, prompt, overlap: inFlight });
      await sleep(20);
      inFlight -= 1;
      // 终稿正文走返回值：协作层据此写 durable transcript（onAssistantMessage 只用于实时 UI）
      const content = `echo:${prompt}`;
      return { content, chars: content.length };
    },
  });

  const collaboration = new CollaborationService({
    access,
    messages,
    events,
    executions,
    coordinator,
    attachSingle: () => {
      throw new Error('single 路径不在本文件的测试范围内（它要拉起 Copilot runtime）');
    },
  });

  /** 建一个会话并登记 owner，返回 registry 记录 */
  const openSession = async (
    sessionId: string,
    mode: 'single' | 'shared',
    owner: Principal = ALICE,
  ) => {
    const record = await registry.create({
      sessionId,
      owner: { tenantId: owner.tenantId, userId: owner.userId },
      workspacePath: `/workspaces/${sessionId}`,
      collaborationMode: mode,
    });
    await participantService.registerOwner({
      sessionId,
      tenantId: owner.tenantId,
      userId: owner.userId,
    });
    return record;
  };

  return {
    registry,
    participants,
    messageRepository,
    sessionEventRepository,
    access,
    events,
    messages,
    executions,
    participantService,
    coordinator,
    collaboration,
    openSession,
    started,
    peak: () => peak,
  };
}

// ---------- 访问矩阵 ----------

test('访问矩阵：single 只认 owner，其他人一律无权', async () => {
  const s = makeStack();
  await s.openSession('sess-single', 'single');

  const resolved = await s.access.resolve('sess-single', ALICE);
  assert.equal(resolved.mode, 'single');
  assert.equal(resolved.role, 'owner');

  await assert.rejects(() => s.access.resolve('sess-single', BOB), /无权访问/);
  await assert.rejects(
    () => s.access.assertCanView('sess-single', MALLORY),
    /无权访问/,
    '跨租户一律拒绝',
  );
});

test('访问矩阵：shared 按会话角色给权限（observer 只读、member 不能管成员）', async () => {
  const s = makeStack();
  await s.openSession('sess-shared', 'shared');
  await s.participantService.add('sess-shared', ALICE, { userId: 'bob', role: 'member' });
  await s.participantService.add('sess-shared', ALICE, { userId: 'carol', role: 'observer' });

  assert.equal((await s.access.resolve('sess-shared', ALICE)).role, 'owner');
  assert.equal((await s.access.resolve('sess-shared', BOB)).role, 'member');
  assert.equal((await s.access.resolve('sess-shared', CAROL)).role, 'observer');
  await assert.rejects(() => s.access.resolve('sess-shared', MALLORY), /无权访问/);

  // 权限是固定四档，不做动态 ACL
  assert.ok(roleAllows('member', 'send'));
  assert.ok(!roleAllows('member', 'manage_members'));
  assert.ok(!roleAllows('observer', 'send'));
  assert.ok(roleAllows('observer', 'view'));

  await s.access.assertCanSend('sess-shared', BOB);
  await assert.rejects(() => s.access.assertCanSend('sess-shared', CAROL), /无权发消息到/);
  await assert.rejects(
    () => s.access.assertCanManageMembers('sess-shared', BOB),
    /无权管理成员/,
  );
  await assert.rejects(() => s.access.assertCanDelete('sess-shared', BOB), /无权删除/);
});

test('可见集合：自己拥有的 + 自己参与的（execution/任务列表按它收窄）', async () => {
  const s = makeStack();
  await s.openSession('sess-a', 'single');
  await s.openSession('sess-b', 'shared', BOB);
  await s.participantService.add('sess-b', BOB, { userId: 'alice', role: 'observer' });

  assert.deepEqual(await s.access.visibleSessionIds(ALICE), ['sess-a', 'sess-b']);
  assert.deepEqual(await s.access.visibleSessionIds(BOB), ['sess-b']);
  assert.deepEqual(await s.access.visibleSessionIds(CAROL), []);
});

// ---------- 模式不可变 ----------

test('模式不可变：同 id 换模式必须拒绝（不能在原地把 single 改成 shared）', async () => {
  const s = makeStack();
  await s.openSession('sess-fixed', 'single');

  await assert.rejects(
    () =>
      s.registry.create({
        sessionId: 'sess-fixed',
        owner: { tenantId: 't1', userId: 'alice' },
        workspacePath: '/workspaces/sess-fixed',
        collaborationMode: 'shared',
      }),
    /模式不同/,
  );
  assert.equal((await s.registry.get('sess-fixed'))?.collaborationMode, 'single');
});

test('模式不可变：归属不同也不能借 create 接管会话', async () => {
  const s = makeStack();
  await s.openSession('sess-owned', 'shared');

  await assert.rejects(
    () =>
      s.registry.create({
        sessionId: 'sess-owned',
        owner: { tenantId: 't1', userId: 'bob' },
        workspacePath: '/workspaces/sess-owned',
        collaborationMode: 'shared',
      }),
    /归属不同/,
  );
});

test('成员管理：single 不能加人、owner 唯一且不可移除、跨租户拉不进来', async () => {
  const s = makeStack();
  await s.openSession('sess-single2', 'single');
  await s.openSession('sess-shared2', 'shared');

  await assert.rejects(
    () => s.participantService.add('sess-single2', ALICE, { userId: 'bob' }),
    /single 模式/,
  );
  await assert.rejects(
    () => s.participantService.add('sess-shared2', ALICE, { userId: 'bob', role: 'owner' as never }),
    /owner 唯一/,
  );
  await assert.rejects(
    () => s.participantService.add('sess-shared2', ALICE, { userId: 'alice' }),
    /已经是该会话的 owner/,
  );
  await assert.rejects(() => s.participantService.remove('sess-shared2', ALICE, 'alice'), /不能移除会话 owner/);

  // tenantId 取会话 owner 的，请求方不能指定：拉进来的人天然同租户
  const added = await s.participantService.add('sess-shared2', ALICE, { userId: 'bob' });
  assert.equal(added.tenantId, 't1');

  // 移除是置 removed（留痕），不是删行；之后该用户失去访问权
  await s.participantService.remove('sess-shared2', ALICE, 'bob');
  assert.equal((await s.participants.get('sess-shared2', 'bob'))?.status, 'removed');
  await assert.rejects(() => s.access.resolve('sess-shared2', BOB), /无权访问/);

  // 被移除的人不能再自己退（他不是 active 参与人）
  await assert.rejects(() => s.participantService.leave('sess-shared2', BOB), /无权访问/);
});

test('成员退出：置 left 且不再可见，owner 不能退出', async () => {
  const s = makeStack();
  await s.openSession('sess-leave', 'shared', BOB);
  await s.participantService.add('sess-leave', BOB, { userId: 'carol', role: 'observer' });

  await assert.rejects(() => s.participantService.leave('sess-leave', BOB), /owner 不能退出/);

  await s.participantService.leave('sess-leave', CAROL);
  assert.equal((await s.participants.get('sess-leave', 'carol'))?.status, 'left');
  await assert.rejects(() => s.access.resolve('sess-leave', CAROL), /无权访问/);
  assert.deepEqual(await s.access.visibleSessionIds(CAROL), []);
});

// ---------- 消息：幂等与序号 ----------

test('消息幂等：同一条 clientMessageId 重试只产生一条消息、一个 execution', async () => {
  const s = makeStack();
  await s.openSession('sess-idem', 'shared');

  const first = await s.collaboration.submitMessage({
    sessionId: 'sess-idem',
    principal: ALICE,
    prompt: '把这份招股书摘要一下',
    clientMessageId: 'cli-1',
  });
  const second = await s.collaboration.submitMessage({
    sessionId: 'sess-idem',
    principal: ALICE,
    prompt: '把这份招股书摘要一下',
    clientMessageId: 'cli-1',
  });

  assert.equal(first.mode, 'shared');
  assert.equal(second.mode, 'shared');
  assert.equal(second.messageId, first.messageId, '同一幂等键必须命中同一条消息');
  assert.equal(second.execution.executionId, first.execution.executionId);
  assert.equal(second.reused, true);
  assert.equal(first.reused, false);

  const stored = await s.messages.list('sess-idem', ALICE);
  assert.equal(stored.length, 1, '重试不得产生第二条消息');
  assert.equal(stored[0]!.sequence, 1);
});

test('消息序号：会话内单调递增，并发提交也不重复', async () => {
  const s = makeStack();
  await s.openSession('sess-seq', 'shared');

  await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      s.messages.fromUser({
        sessionId: 'sess-seq',
        tenantId: 't1',
        userId: 'alice',
        content: `第 ${i} 条`,
      }),
    ),
  );
  const list = await s.messages.list('sess-seq', ALICE, 100);
  assert.equal(list.length, 20);
  assert.deepEqual(
    list.map((m) => m.sequence),
    Array.from({ length: 20 }, (_, i) => i + 1),
    '序号必须是 1..20 的连续值，不能并列或跳号',
  );
});

test('空消息拒绝：trim 后为空一律不进 transcript', async () => {
  const s = makeStack();
  await s.openSession('sess-empty', 'shared');
  await assert.rejects(
    () =>
      s.messages.fromUser({ sessionId: 'sess-empty', tenantId: 't1', userId: 'alice', content: '   ' }),
    /不能为空/,
  );
});

// ---------- shared 队列：串行 + FIFO ----------

test('队列串行：同一会话同一时刻只跑一个 agent turn', async () => {
  const s = makeStack();
  await s.openSession('sess-queue', 'shared');

  const results = await Promise.all(
    ['一', '二', '三'].map((prompt, i) =>
      s.collaboration.submitMessage({
        sessionId: 'sess-queue',
        principal: ALICE,
        prompt,
        clientMessageId: `cli-${i}`,
      }),
    ),
  );
  assert.equal(results.length, 3);
  assert.ok(results.every((r) => r.mode === 'shared' && !r.reused));

  await waitFor(() => s.started.length === 3);
  assert.equal(s.peak(), 1, `同一会话的 agent turn 不能重叠，实测峰值 ${s.peak()}`);

  // 三个 execution 都跑到终态，且各自挂在自己的来源消息上
  const ids = results.flatMap((r) => (r.mode === 'shared' ? [r.execution.executionId] : []));
  const done = async (): Promise<boolean> => {
    for (const id of ids) {
      if ((await s.executions.get(id))?.status !== 'completed') return false;
    }
    return true;
  };
  const deadline = Date.now() + 3000;
  while (!(await done())) {
    if (Date.now() > deadline) throw new Error('等待队列跑完超时');
    await sleep(5);
  }

  for (const result of results) {
    if (result.mode !== 'shared') continue;
    const rec = await s.executions.get(result.execution.executionId);
    assert.equal(rec?.status, 'completed');
    assert.ok(rec?.sourceMessageId, 'execution 必须能回溯到触发它的消息');
    const message = await s.messages.get(rec!.sourceMessageId!);
    assert.equal(message?.executionId, result.execution.executionId, '消息与 execution 双向关联');
  }
});

test('队列 FIFO：先提交的先跑（按创建顺序，不看谁先到达调度器）', async () => {
  const s = makeStack();
  await s.openSession('sess-fifo', 'shared');

  for (const prompt of ['第一', '第二', '第三']) {
    await s.collaboration.submitMessage({ sessionId: 'sess-fifo', principal: ALICE, prompt });
    await sleep(3); // 让 created_at 拉开，队列顺序因此是确定的
  }

  await waitFor(() => s.started.length === 3);
  assert.deepEqual(
    s.started.map((r) => r.prompt),
    ['第一', '第二', '第三'],
  );
});

test('跨会话不互相阻塞：两个会话各自串行，但整体并行', async () => {
  const s = makeStack();
  await s.openSession('sess-p1', 'shared');
  await s.openSession('sess-p2', 'shared');

  await s.collaboration.submitMessage({ sessionId: 'sess-p1', principal: ALICE, prompt: 'a' });
  await s.collaboration.submitMessage({ sessionId: 'sess-p2', principal: ALICE, prompt: 'b' });

  await waitFor(() => s.started.length === 2);
  assert.equal(s.peak(), 2, '不同会话之间不该排成一条线');
});

test('agent 终稿进同一条会话时间线，并广播 assistant.message', async () => {
  const s = makeStack();
  await s.openSession('sess-grow', 'shared');
  const seen: string[] = [];
  s.events.subscribe('sess-grow', (e) => seen.push(e.type));

  await s.collaboration.submitMessage({ sessionId: 'sess-grow', principal: ALICE, prompt: '写个摘要' });
  await waitFor(() => s.started.length === 1);
  await waitFor(() => seen.includes(EVT.assistantMessage));

  const list = await s.messages.list('sess-grow', ALICE);
  assert.equal(list.length, 2, '一条人类消息 + 一条 agent 消息');
  assert.equal(list[0]!.actorType, 'user');
  assert.equal(list[1]!.actorType, 'agent');
  assert.equal(list[1]!.content, 'echo:写个摘要');
  assert.ok(list[1]!.sequence > list[0]!.sequence);
});

// ---------- 会话事件流 ----------

test('事件游标：listAfter 只回 sequence 更大的事件', async () => {
  const s = makeStack();
  await s.openSession('sess-ev', 'shared');

  for (const type of ['a', 'b', 'c']) {
    await s.events.append({ sessionId: 'sess-ev', type, actorType: 'system' });
  }
  const all = await s.events.listAfter('sess-ev', 0);
  assert.deepEqual(all.map((e) => e.sequence), [1, 2, 3]);

  const tail = await s.events.listAfter('sess-ev', 1);
  assert.deepEqual(tail.map((e) => e.type), ['b', 'c'], '游标是排他的');
  assert.deepEqual(await s.events.listAfter('sess-ev', 3), []);
});

test('事件广播：append 落库并推送，瞬时事件只推送（不落库）', async () => {
  const s = makeStack();
  await s.openSession('sess-bc', 'shared');

  const received: Array<{ type: string; sequence: number }> = [];
  const unsubscribe = s.events.subscribe('sess-bc', (e) =>
    received.push({ type: e.type, sequence: e.sequence }),
  );

  await s.events.append({ sessionId: 'sess-bc', type: 'durable', actorType: 'user' });
  s.events.publish('sess-bc', 'assistant.delta', { delta: '一' });
  assert.deepEqual(received, [
    { type: 'durable', sequence: 1 },
    { type: 'assistant.delta', sequence: 0 },
  ]);

  // token 级 delta 不落库：只有 durable 那条在库里
  assert.deepEqual((await s.events.listAfter('sess-bc', 0)).map((e) => e.type), ['durable']);

  // 没有订阅者时 publish 直接返回，不产生任何写入
  unsubscribe();
  s.events.publish('sess-bc', 'assistant.delta', { delta: '二' });
  assert.deepEqual((await s.events.listAfter('sess-bc', 0)).map((e) => e.type), ['durable']);

  // 订阅抛错不应影响写入路径
  s.events.subscribe('sess-bc', () => {
    throw new Error('订阅者炸了');
  });
  await s.events.append({ sessionId: 'sess-bc', type: 'after-broken', actorType: 'system' });
  assert.equal((await s.events.listAfter('sess-bc', 0)).length, 2);
});

test('事件 payload 脱敏：密钥不进会话事件流', async () => {
  const s = makeStack();
  await s.openSession('sess-redact', 'shared');
  await s.events.append({
    sessionId: 'sess-redact',
    type: 'message.created',
    actorType: 'user',
    payload: { apiKey: 'sk-live-abcdef123456', note: 'x' },
  });
  const [event] = await s.events.listAfter('sess-redact', 0);
  assert.equal((event!.payload as Record<string, unknown>).apiKey, '<redacted>');
});

// ---------- 归属与发起人分离 ----------

test('shared 下成员发起：数据归属仍是会话 owner，发起人记成员', async () => {
  const s = makeStack();
  await s.openSession('sess-attr', 'shared', ALICE);
  await s.participantService.add('sess-attr', ALICE, { userId: 'bob', role: 'member' });

  const result = await s.collaboration.submitMessage({
    sessionId: 'sess-attr',
    principal: BOB,
    prompt: '帮我看下这笔',
  });
  assert.equal(result.mode, 'shared');
  if (result.mode !== 'shared') return;

  const rec = await s.executions.get(result.execution.executionId);
  assert.equal(rec?.userId, 'alice', 'userId 是会话 owner —— resume 的归属校验要靠它');
  assert.equal(rec?.initiatedByUserId, 'bob', '发起人必须是发消息的 participant');
  assert.equal(rec?.tenantId, 't1');
});

test('observer 提交被拒：只读角色进不了队列', async () => {
  const s = makeStack();
  await s.openSession('sess-ro', 'shared');
  await s.participantService.add('sess-ro', ALICE, { userId: 'carol', role: 'observer' });

  await assert.rejects(
    () =>
      s.collaboration.submitMessage({ sessionId: 'sess-ro', principal: CAROL, prompt: '删库' }),
    /无权发消息到/,
  );
  assert.equal((await s.executions.list({ sessionId: 'sess-ro' })).length, 0);
});

// ---------- 队列健壮性 ----------

test('跑不起来的排队项必须落到 failed，而不是留在队头空转', async () => {
  const s = makeStack();
  await s.openSession('sess-stuck', 'shared');

  // 直接造一个"取不到输入"的排队项：sourceMessageId 指向不存在的消息。
  // 这模拟的就是「execution 已入队但来源消息缺失 / 状态被外部改动」。
  // queueSequence 必须有：它是协作队列项的判据之一（没有它的 job 不进队列）。
  const broken = await s.executions.create({
    sessionId: 'sess-stuck',
    owner: { tenantId: 't1', userId: 'alice' },
    initiatedByUserId: 'bob',
    kind: 'interactive',
    sourceMessageId: 'msg-does-not-exist',
    queueSequence: 1,
  });
  assert.equal(broken.status, 'created');

  await s.coordinator.drain('sess-stuck');

  const after = await s.executions.get(broken.executionId);
  assert.equal(after?.status, 'failed', '跑不起来的排队项必须离开 created，否则会被反复取出');
  assert.equal(s.started.length, 0, '未成功 start 的项不该进 runner');

  // 关键回归：只写一条失败事件。曾经这里每轮 drain 都写一条，2 分钟刷了 300 万行
  const events = await s.events.listAfter('sess-stuck', 0);
  const failed = events.filter((e) => e.type === EVT.executionFailed);
  assert.equal(failed.length, 1, `失败事件只能写一条，实际 ${failed.length}`);
  assert.equal((failed[0]!.payload as Record<string, unknown>).phase, 'start');

  // 再 drain 一次必须是空跑：队列里已经没有被卡住的可取项
  await s.coordinator.drain('sess-stuck');
  assert.equal((await s.events.listAfter('sess-stuck', 0)).length, events.length);
});

test('排队项跑完之后队列继续推进下一条', async () => {
  const s = makeStack();
  await s.openSession('sess-drain', 'shared');

  const a = await s.collaboration.submitMessage({ sessionId: 'sess-drain', principal: ALICE, prompt: 'A' });
  await sleep(3);
  const b = await s.collaboration.submitMessage({ sessionId: 'sess-drain', principal: ALICE, prompt: 'B' });
  if (a.mode !== 'shared' || b.mode !== 'shared') throw new Error('应为 shared');

  const settled = async (): Promise<boolean> =>
    (await s.executions.get(a.execution.executionId))?.status === 'completed' &&
    (await s.executions.get(b.execution.executionId))?.status === 'completed';
  const deadline = Date.now() + 3000;
  while (!(await settled())) {
    if (Date.now() > deadline) throw new Error('等待队列跑完超时');
    await sleep(5);
  }

  assert.deepEqual(s.started.map((r) => r.prompt), ['A', 'B'], '队列必须按顺序推进，不丢下一条');
});

// ---------- 权限：会话配置 / execution 指挥权 ----------

test('共享会话：member 不能 resume 改会话配置（能力边界属于 owner）', async () => {
  const s = makeStack();
  await s.openSession('sess-resume', 'shared');
  await s.participantService.add('sess-resume', ALICE, { userId: 'bob', role: 'member' });
  await s.participantService.add('sess-resume', ALICE, { userId: 'carol', role: 'observer' });

  // resume 能改 model / agents / customAgents / MCP / hooks / systemMessage —— 全体参与者共用。
  // 只判 send 会让任一 member 改掉所有人的能力集与数据边界。
  await assert.rejects(
    () => s.access.assertCanManageSession('sess-resume', BOB),
    /无权管理会话配置/,
  );
  await assert.rejects(
    () => s.access.assertCanManageSession('sess-resume', CAROL),
    /无权管理会话配置/,
  );
  assert.equal((await s.access.assertCanManageSession('sess-resume', ALICE)).role, 'owner');

  // 对照：权限没有一放开就串档 —— member 也不能管理成员
  await assert.rejects(
    () => s.access.assertCanManageMembers('sess-resume', BOB),
    /无权管理成员/,
  );
});

test('共享会话：observer 不能启动 execution（run 要 send，不是 view）', async () => {
  const s = makeStack();
  await s.openSession('sess-run', 'shared');
  await s.participantService.add('sess-run', ALICE, { userId: 'carol', role: 'observer' });

  // observer 能看见这个会话
  assert.equal((await s.access.assertCanView('sess-run', CAROL)).role, 'observer');
  // 但看得见不等于能让执行跑起来
  await assert.rejects(() => s.access.assertCanSend('sess-run', CAROL), /无权发消息到/);
});

test('共享会话：execution 指挥权按 发起人/owner 收窄，observer 与旁观 member 都不可', async () => {
  const s = makeStack();
  const DAVE = principal('dave');
  await s.openSession('sess-cmd', 'shared');
  await s.participantService.add('sess-cmd', ALICE, { userId: 'bob', role: 'member' });
  await s.participantService.add('sess-cmd', ALICE, { userId: 'carol', role: 'observer' });
  await s.participantService.add('sess-cmd', ALICE, { userId: 'dave', role: 'member' });

  const submitted = await s.collaboration.submitMessage({
    sessionId: 'sess-cmd',
    principal: BOB,
    prompt: 'bob 发起',
  });
  if (submitted.mode !== 'shared') throw new Error('应为 shared');
  const exec = submitted.execution;

  // owner 可指挥本会话内任意 execution
  assert.equal((await s.access.assertCanCommandExecution('sess-cmd', ALICE, exec)).role, 'owner');
  // 发起人本人（member）可以
  assert.equal((await s.access.assertCanCommandExecution('sess-cmd', BOB, exec)).role, 'member');
  // 另一个 member 不行 —— 能看见同会话的执行 ≠ 能取消/对它提业务动作
  await assert.rejects(
    () => s.access.assertCanCommandExecution('sess-cmd', DAVE, exec),
    /无权操作该 execution/,
  );
  // observer 连"自己的"都不行（它本来也不该有执行）
  await assert.rejects(
    () => s.access.assertCanCommandExecution('sess-cmd', CAROL, exec),
    /无权操作该 execution/,
  );
  // 跨租户先被会话访问判定拦掉
  await assert.rejects(
    () => s.access.assertCanCommandExecution('sess-cmd', MALLORY, exec),
    /无权访问/,
  );
});

// ---------- 序号分配：并发下不重不漏 ----------

test('并发追加会话事件：序号 1..20 无重复、无丢失，游标可续传', async () => {
  const s = makeStack();
  await s.openSession('sess-ev', 'shared');

  await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      s.events.append({
        sessionId: 'sess-ev',
        type: 'message.created',
        actorType: 'user',
        payload: { i },
      }),
    ),
  );

  const all = await s.events.listAfter('sess-ev', 0);
  const expected = Array.from({ length: 20 }, (_, i) => i + 1);
  assert.equal(all.length, 20, '一条都不能丢');
  assert.deepEqual(all.map((e) => e.sequence), expected, '序号必须连续且唯一');

  // 断线续传：after=10 只回放 11..20
  assert.deepEqual(
    (await s.events.listAfter('sess-ev', 10)).map((e) => e.sequence),
    expected.slice(10),
  );
});

test('并发追加 execution 事件：序号连续唯一（审计链不能少一条）', async () => {
  const s = makeStack();
  await s.openSession('sess-exev', 'shared');
  const exec = await s.executions.create({
    sessionId: 'sess-exev',
    owner: { tenantId: 't1', userId: 'alice' },
  });

  await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      s.executions.appendEvent({
        executionId: exec.executionId,
        type: 'agent.tool_call.started',
        actorType: 'agent',
        payload: { i },
      }),
    ),
  );

  const events = await s.executions.events(exec.executionId, 100);
  // create 自己写了一条 execution.created，加 20 条 = 21
  const seqs = events.map((e) => e.sequence);
  assert.equal(events.length, 21, '一条都不能丢');
  assert.equal(new Set(seqs).size, 21, '不能有重复序号');
  assert.deepEqual(seqs, Array.from({ length: 21 }, (_, i) => i + 1));
});

test('事件序号不靠数组长度推算：超过事件环容量后仍然唯一', async () => {
  // 内存实现的事件环只保留最近 500 条。若序号取 `list.length + 1`，
  // 环满之后每次都会算出同一个序号 —— 这是"记录被裁剪"与"序号分配"两件事被混在一起的经典 bug。
  const repo = new MemoryEventRepository();
  const seqs: number[] = [];
  for (let i = 0; i < 520; i += 1) {
    const event = await repo.append({
      executionId: 'ex-trim',
      type: 'agent.tool_call.completed',
      actorType: 'agent',
      createdAt: new Date().toISOString(),
    });
    seqs.push(event.sequence);
  }
  assert.equal(new Set(seqs).size, 520, '序号绝不能重复');
  assert.equal(seqs[0], 1);
  assert.equal(seqs[519], 520);
  assert.equal((await repo.list('ex-trim', 500)).length, 500, '环容量仍然是 500');
});

// ---------- SSE：回放与订阅的竞态 ----------

test('事件流：回放与订阅之间落库的事件不能丢（read-then-subscribe 竞态）', async () => {
  const s = makeStack();
  await s.openSession('sess-race', 'shared');
  await s.events.append({ sessionId: 'sess-race', type: 'message.created', actorType: 'user' });

  /**
   * 场景 A：新事件在"读库拿到快照之后"才落库。
   * 先读库再订阅的实现会把这条永久丢掉（订阅时尚不存在，回放时又不在快照里）；
   * 先订阅的实现会把它送进缓冲，回放结束后补发。
   */
  const repo = s.sessionEventRepository;
  const original = repo.listAfter.bind(repo);
  let injected = false;
  repo.listAfter = async (sessionId, after, limit) => {
    const rows = await original(sessionId, after, limit);
    if (!injected) {
      injected = true;
      await s.events.append({
        sessionId: 'sess-race',
        type: 'execution.queued',
        actorType: 'system',
      });
    }
    return rows;
  };

  const got: number[] = [];
  (await s.events.subscribeWithReplay('sess-race', 0, (e) => got.push(e.sequence)))();
  assert.deepEqual(got, [1, 2], '回放期间落库的事件必须补上，且不重复');

  /**
   * 场景 B：事件既在快照里、又走了广播（回放与缓冲必然重叠）。
   * 这时的要求是**不重复**：按 sequence 去重。
   */
  repo.listAfter = async (sessionId, after, limit) => {
    const rows = await original(sessionId, after, limit);
    if (injected) {
      injected = false;
      await s.events.append({
        sessionId: 'sess-race',
        type: 'execution.started',
        actorType: 'system',
      });
    }
    return rows;
  };
  const again: number[] = [];
  (await s.events.subscribeWithReplay('sess-race', 0, (e) => again.push(e.sequence)))();
  assert.deepEqual(again, [1, 2, 3], '重叠的事件只交付一次');
});

// ---------- 启动恢复：队列与崩溃残留 ----------

test('启动恢复：队列在库里，但 worker 是进程内的 —— 重启后必须重新 drain', async () => {
  const s = makeStack();
  await s.openSession('sess-recover', 'shared');

  // 直接造一条"已入队但还没跑"的协作 execution：等价于入队后进程立刻重启
  const { message } = await s.messages.fromUser({
    sessionId: 'sess-recover',
    tenantId: 't1',
    userId: 'alice',
    content: '重启前入队',
  });
  const queued = await s.executions.create({
    sessionId: 'sess-recover',
    owner: { tenantId: 't1', userId: 'alice' },
    initiatedByUserId: 'alice',
    kind: 'interactive',
    sourceMessageId: message.messageId,
    queueSequence: message.sequence,
  });
  assert.equal((await s.executions.get(queued.executionId))?.status, 'created');
  assert.equal(s.started.length, 0, '重启前没有 worker 在跑它');

  // 进程重启：chains 是空的，没有任何 HTTP 请求会来唤醒这个会话
  const result = await s.collaboration.recoverPending();
  assert.equal(result.sessions, 1, '应当识别出 1 个待恢复的会话');
  assert.equal(result.interrupted, 0);

  const deadline = Date.now() + 3000;
  while ((await s.executions.get(queued.executionId))?.status !== 'completed') {
    if (Date.now() > deadline) throw new Error('恢复 drain 超时');
    await sleep(5);
  }
  assert.equal(s.started[0]?.prompt, '重启前入队', 'prompt 要从来源消息恢复');
});

test('启动恢复：running 的执行落成 interrupted 终态，且绝不自动重试', async () => {
  const s = makeStack();
  await s.openSession('sess-int', 'shared');
  const { message } = await s.messages.fromUser({
    sessionId: 'sess-int',
    tenantId: 't1',
    userId: 'alice',
    content: '跑到一半崩了',
  });
  const exec = await s.executions.create({
    sessionId: 'sess-int',
    owner: { tenantId: 't1', userId: 'alice' },
    initiatedByUserId: 'alice',
    kind: 'interactive',
    sourceMessageId: message.messageId,
    queueSequence: message.sequence,
  });
  await s.executions.start(exec.executionId);
  assert.equal((await s.executions.get(exec.executionId))?.status, 'running');

  const result = await s.collaboration.recoverPending();
  assert.equal(result.interrupted, 1);

  const after = await s.executions.get(exec.executionId);
  assert.equal(after?.status, 'interrupted');
  assert.ok(isTerminal(after!.status), 'interrupted 必须是终态，否则会被反复恢复');

  // 关键：不自动重跑 —— agent 可能已经执行过业务动作（下单/表决），重跑会重复提交
  assert.equal(
    s.started.filter((x) => x.executionId === exec.executionId).length,
    0,
    '恢复时绝不能重新执行 running 的项',
  );

  // 两处留痕：协作时间线 + 执行审计链
  const sessionTypes = (await s.events.listAfter('sess-int', 0)).map((e) => e.type);
  assert.ok(sessionTypes.includes(EVT.executionInterrupted), '会话事件流要有 interrupted');
  const auditTypes = (await s.executions.events(exec.executionId, 50)).map((e) => e.type);
  assert.ok(auditTypes.includes('execution.interrupted'), '审计链也要有');
});

// ---------- 顺序一致性 ----------

test('并发提交：消息顺序 = 队列顺序 = agent 实际处理顺序', async () => {
  const s = makeStack();
  await s.openSession('sess-order', 'shared');
  await s.participantService.add('sess-order', ALICE, { userId: 'bob', role: 'member' });

  const [a, b] = await Promise.all([
    s.collaboration.submitMessage({ sessionId: 'sess-order', principal: ALICE, prompt: 'A' }),
    s.collaboration.submitMessage({ sessionId: 'sess-order', principal: BOB, prompt: 'B' }),
  ]);
  if (a.mode !== 'shared' || b.mode !== 'shared') throw new Error('应为 shared');

  // ① transcript 顺序（就是参与者看到的顺序）
  const userMessages = (await s.messages.list('sess-order', ALICE)).filter(
    (m) => m.actorType === 'user',
  );
  const contentById = new Map<string, string>(
    userMessages.map((m) => [m.messageId, m.content] as const),
  );
  const transcriptOrder = userMessages.map((m) => m.content);

  // ② 队列顺序 = queueSequence 升序
  const queued = (await s.executions.list({ sessionId: 'sess-order' }))
    .filter((e) => e.sourceMessageId)
    .sort((x, y) => (x.queueSequence ?? 0) - (y.queueSequence ?? 0));
  const queueOrder = queued.map((e) => contentById.get(e.sourceMessageId!) ?? '?');

  // ③ agent 实际处理顺序
  const deadline = Date.now() + 3000;
  while (s.started.length < 2) {
    if (Date.now() > deadline) throw new Error('等待队列跑完超时');
    await sleep(5);
  }
  const runOrder = s.started.map((r) => r.prompt);

  assert.deepEqual(queueOrder, transcriptOrder, '队列顺序必须等于 transcript 顺序');
  assert.deepEqual(runOrder, transcriptOrder, 'agent 处理顺序必须等于 transcript 顺序');
  // 队列定序键就是消息 sequence，不是另算的时间戳
  assert.deepEqual(
    queued.map((e) => e.queueSequence),
    userMessages.map((m) => m.sequence),
  );
});

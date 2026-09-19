import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  findFlowGate,
  findFlowReview,
  registerFlowGate,
  registerFlowReview,
  reviewBasePolicy,
} from '../src/workflow/registry.js';
import { reviewPolicyFor } from '../src/workflow/runner.js';
import { requiredVotes, type FlowNode, type ReviewBasePolicy } from '../src/workflow/types.js';

/**
 * 服务端注册表的**启动期契约**。
 *
 * 这四张表（gate / review / action / output）是 SKILL.md 引用的"服务端语义"。
 * 它们出错的表现都是**静默失效**：gate 声明的出口写错大小写 → 永远匹配不上 route，
 * 流程跑到那一步才掉进 fail；review 的 eligibleRoles 是空的 → 任务建出来没人有资格批，
 * 流程挂到超时。这些都没法在运行期补救，只能让进程起不来。
 *
 * 另一条同样重要的规则：`strategy: ALL` 必须真的是全员。ANY 与 ALL 的唯一区别落在
 * 票数上，`ALL + requiredCount: 1` 只是名字叫 ALL 的 ANY —— 而审计链上写着 ALL，
 * 没人会再去核对票数。
 */

const gate = (over: Partial<Parameters<typeof registerFlowGate>[0]> = {}) => ({
  name: 't-gate',
  outcomes: ['pass', 'fail'],
  evaluate: async () => ({ outcome: 'pass' }),
  ...over,
});

const review = (over: Partial<Parameters<typeof registerFlowReview>[0]> = {}) => ({
  name: 't-review',
  title: '测试审核',
  eligibleRoles: ['risk', 'compliance'],
  ...over,
});

test('注册表：gate 的 outcomes 必须非空、不重复，并归一化成小写', () => {
  assert.throws(() => registerFlowGate(gate({ name: 'g-empty', outcomes: [] })), /没有声明 outcomes/);
  assert.throws(
    () => registerFlowGate(gate({ name: 'g-dup', outcomes: ['pass', 'pass'] })),
    /重复声明/,
  );
  assert.throws(
    () => registerFlowGate(gate({ name: 'g-blank', outcomes: ['pass', '  '] })),
    /空字符串/,
  );

  // 大小写归一化：route 的出口名由 parser 统一小写，声明里写 PASS 会永远匹配不上
  registerFlowGate(gate({ name: 'G-Case', outcomes: ['PASS', ' Fail '] }));
  assert.deepEqual(findFlowGate('g-case')?.outcomes, ['pass', 'fail'], '登记时就小写化');
  assert.deepEqual(findFlowGate('G-CASE')?.outcomes, ['pass', 'fail'], '查找大小写不敏感');
});

test('注册表：review 的基策略必须自洽（空角色 / 0 票 / ALL 配不够的票）', () => {
  assert.throws(
    () => registerFlowReview(review({ name: 'r-norole', eligibleRoles: [] })),
    /eligibleRoles 为空/,
  );
  assert.throws(
    () => registerFlowReview(review({ name: 'r-zero', requiredCount: 0 })),
    /必须是 ≥1 的整数/,
  );
  assert.throws(
    () => registerFlowReview(review({ name: 'r-all-1', strategy: 'ALL', requiredCount: 1 })),
    /ALL 的语义是全员通过/,
    'ALL + 1 票（2 个角色）必须启动即失败',
  );

  // ALL 不写 requiredCount 时缺省就是角色数（不是 1）—— 否则写 ALL 的人拿到的是 ANY
  registerFlowReview(review({ name: 'r-all-default', strategy: 'ALL' }));
  const allDefault = reviewBasePolicy(findFlowReview('r-all-default')!);
  assert.equal(allDefault.strategy, 'ALL');
  assert.equal(allDefault.requiredCount, 2, 'ALL 的缺省票数 = 角色数');

  // ANY 的缺省仍然是 1
  assert.equal(reviewBasePolicy(findFlowReview('t-review') ?? review({ name: 't-review' })).requiredCount, 1);
});

test('注册表：登记名归一化后仍能被 find 到（否则大小写不同 = 查不到）', () => {
  registerFlowReview(review({ name: 'R-Mixed' }));
  assert.ok(findFlowReview('r-mixed'), '登记与查找必须用同一套归一化');
  assert.ok(findFlowReview('R-MIXED'));
});

// ---------- ALL 的票数规则（注册表 / 校验器 / runner 三处共用） ----------

test('requiredVotes：ALL 取"声明票数与角色数的较大者"，ANY 原样', () => {
  assert.equal(requiredVotes({ strategy: 'ANY', requiredCount: 1, roleCount: 3 }), 1);
  assert.equal(requiredVotes({ strategy: 'ANY', requiredCount: 3, roleCount: 3 }), 3);
  assert.equal(
    requiredVotes({ strategy: 'ALL', requiredCount: 1, roleCount: 3 }),
    3,
    'ALL + 1 票（3 个角色）→ 抬到 3：ALL 的语义不能被票数削弱',
  );
  assert.equal(
    requiredVotes({ strategy: 'ALL', requiredCount: 5, roleCount: 3 }),
    5,
    '票数只能加不能减：5 票比"全员"更严，保持原样',
  );
  assert.equal(requiredVotes({ strategy: 'ALL', requiredCount: 1, roleCount: 0 }), 1);
});

/** 造一个 `@review` 节点（只关心 attrs，其余字段对 reviewPolicyFor 无意义） */
function reviewNode(attrs: FlowNode['attrs']): FlowNode {
  return {
    id: 'rev',
    type: 'review',
    body: '',
    attrs,
    routes: [],
    startLine: 1,
    headingLine: 1,
    endLine: 1,
  };
}

const base = (over: Partial<ReviewBasePolicy> = {}): ReviewBasePolicy => ({
  eligibleRoles: ['risk', 'compliance', 'ops'],
  strategy: 'ANY',
  requiredCount: 1,
  allowInitiator: false,
  ...over,
});

test('runner 的 reviewPolicyFor：ALL 的票数在运行时也 clamp 到全员（不信任校验器）', () => {
  const weakened = reviewPolicyFor(reviewNode({ strategy: 'ALL', required: 1 }), base());
  assert.ok(!('error' in weakened));
  assert.equal(weakened.policy.strategy, 'ALL');
  assert.equal(weakened.policy.requiredCount, 3, 'ALL + 1 票 → 运行时抬到全员 3 票');

  // 票数更多时不动它（只能加不能减）
  const stricter = reviewPolicyFor(reviewNode({ strategy: 'ALL', required: 5 }), base());
  assert.ok(!('error' in stricter));
  assert.equal(stricter.policy.requiredCount, 5);

  // role 收窄到 1 个角色后，1 票就是全员
  const narrowed = reviewPolicyFor(
    reviewNode({ role: 'risk', strategy: 'ALL', required: 1 }),
    base(),
  );
  assert.ok(!('error' in narrowed));
  assert.deepEqual(narrowed.policy.eligibleRoles, ['risk']);
  assert.equal(narrowed.policy.requiredCount, 1);

  // 基策略是 ALL 时，SKILL.md 写 ANY 也不改变策略（只能更严）
  const forced = reviewPolicyFor(reviewNode({ strategy: 'ANY' }), base({ strategy: 'ALL', requiredCount: 3 }));
  assert.ok(!('error' in forced));
  assert.equal(forced.policy.strategy, 'ALL');
  assert.equal(forced.policy.requiredCount, 3);
});

test('runner 的 reviewPolicyFor：没有生效角色时报错（一个没人能批的任务不该被建出来）', () => {
  const none = reviewPolicyFor(reviewNode({}), base({ eligibleRoles: [] }));
  assert.ok('error' in none);
  assert.match(none.error, /没有生效的审核角色/);

  const outside = reviewPolicyFor(reviewNode({ role: 'nobody' }), base());
  assert.ok('error' in outside);
  assert.match(outside.error, /不在注册表给该 review 的资格角色里/);
});

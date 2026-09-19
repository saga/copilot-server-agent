import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseSkillFlow } from '../src/skills/flow-parser.js';
import { validateSkillFlow } from '../src/skills/flow-validator.js';
import { loadSkill, skillSearchDirs } from '../src/skills/index.js';
import { flowRegistryLookup } from '../src/workflow/registry.js';

/**
 * Flow 静态校验：**在跑之前**把问题全报出来。
 *
 * 最容易出事的两个方向：
 *   - 路由指向不存在的节点 → 运行时走到那一步才炸，而 execution 那时可能已经等人工了
 *   - 出口写漏（@action 只写了 success，忘了 fail）→ 失败分支无处可去
 * 这两类必须在建 execution 时就 400。
 *
 * 同时确认**允许环**：research → review → research 是研究流程的常态，不能按 DAG 判。
 */

const ok = (md: string, opts: Parameters<typeof validateSkillFlow>[1] = {}) =>
  validateSkillFlow(parseSkillFlow(md), opts);

/** 拼流程用的小工具（只是 join，避免一长串 '...' 逗号列表看错行） */
const flow = (...lines: string[]): string => lines.join('\n');

const FLOW_OK = flow(
  '## @flow demo',
  '',
  'start -> work',
  '',
  '## @subagent work',
  '',
  '干活。',
  '',
  '- success -> check',
  '- fail -> failed',
  '',
  '## @gate check',
  '',
  '判断。',
  '',
  '- pass -> done',
  '- fail -> failed',
  '',
  '## @stop failed',
  '',
  '失败。',
  '',
  '## @end done',
  '',
  '完成。',
);

/** 服务端全部已注册（只测结构时用） */
const ALL_REGISTERED = {
  hasGate: () => true,
  hasReview: () => true,
  hasAction: () => true,
};

test('校验：结构完整时通过，并给出 FlowDefinition', () => {
  const r = ok(FLOW_OK);
  assert.deepEqual(r.issues, []);
  assert.ok(r.definition);
  assert.equal(r.definition!.id, 'demo');
  assert.equal(r.definition!.start, 'work');
  assert.deepEqual(Object.keys(r.definition!.nodes).sort(), ['check', 'done', 'failed', 'work']);
  assert.equal(r.definition!.nodes['work']!.type, 'subagent');
  // body 是原样 Markdown（含 route 行）：subagent 直接拿它当 prompt，非 subagent 取首行当描述
  assert.equal(r.definition!.nodes['check']!.body, '判断。\n\n- pass -> done\n- fail -> failed');
});

test('校验：缺 @flow / 多个 @flow 都报错', () => {
  assert.ok(ok(flow('## @gate x', '', '- pass -> y')).issues.some((i) => i.code === 'flow-missing'));
  const two = ok(flow('## @flow a', '', 'start -> x', '', '## @flow b', '', '## @end x', '', 'ok'));
  assert.ok(two.issues.some((i) => i.code === 'flow-duplicate'));
});

test('校验：节点 id 重复 / route 指向不存在的节点', () => {
  const dup = ok(
    flow(
      '## @flow demo',
      '',
      'start -> work',
      '',
      '## @gate work',
      '',
      '- pass -> done',
      '',
      '## @gate work',
      '',
      '- pass -> done',
      '',
      '## @end done',
      '',
      'ok',
    ),
  );
  assert.ok(dup.issues.some((i) => i.code === 'node-duplicate'));

  const dangling = ok(
    flow(
      '## @flow demo',
      '',
      'start -> work',
      '',
      '## @gate work',
      '',
      '- pass -> nowhere',
      '',
      '## @end done',
      '',
      'ok',
    ),
  );
  const hit = dangling.issues.find((i) => i.code === 'route-target-missing');
  assert.ok(hit, '指向不存在的节点必须报错');
  assert.match(hit!.message, /nowhere/);
  assert.ok(hit!.line > 0, '要带行号，作者才能定位');
});

test('校验：终态不允许再 route，非终态必须有 route', () => {
  const badStop = ok(
    flow(
      '## @flow demo',
      '',
      'start -> work',
      '',
      '## @subagent work',
      '',
      '- success -> failed',
      '- fail -> failed',
      '',
      '## @stop failed',
      '',
      '- retry -> work',
    ),
  );
  assert.ok(badStop.issues.some((i) => i.code === 'terminal-has-route'), '@stop 不该有出口');

  const noRoute = ok(
    flow('## @flow demo', '', 'start -> work', '', '## @gate work', '', '判断。', '', '## @end done', '', 'ok'),
  );
  assert.ok(noRoute.issues.some((i) => i.code === 'node-missing-route'), '非终态没有出口必须报错');
});

test('校验：出口写漏（@action 只写 success）会在执行前报出来', () => {
  const r = ok(
    flow('## @flow demo', '', 'start -> pub', '', '## @action pub', '', '- success -> done', '', '## @end done', '', 'ok'),
    { registry: ALL_REGISTERED },
  );
  const hit = r.issues.find((i) => i.code === 'node-missing-outcome');
  assert.ok(hit, '@action 缺 fail 出口必须报错');
  assert.match(hit!.message, /fail/);
});

test('校验：@review 必须同时有 approve / reject 出口', () => {
  const r = ok(
    flow('## @flow demo', '', 'start -> rev', '', '## @review rev', '', '- approve -> done', '', '## @end done', '', 'ok'),
    { registry: ALL_REGISTERED },
  );
  assert.ok(r.issues.some((i) => i.code === 'node-missing-outcome' && /reject/.test(i.message)));
});

test('校验：不可达节点报错', () => {
  const orphan = ok(
    flow(
      '## @flow demo',
      '',
      'start -> work',
      '',
      '## @subagent work',
      '',
      '- success -> done',
      '- fail -> done',
      '',
      '## @gate lonely',
      '',
      '- pass -> done',
      '',
      '## @end done',
      '',
      'ok',
    ),
  );
  const hit = orphan.issues.find((i) => i.code === 'node-unreachable');
  assert.ok(hit, '没人指向的节点必须报错');
  assert.equal(hit!.nodeId, 'lonely');
});

test('校验：**允许环**（research ⇄ review 是研究流程常态，不能按 DAG 判）', () => {
  const cyclic = ok(
    flow(
      '## @flow demo',
      '',
      'start -> research',
      '',
      '## @subagent research',
      '',
      '- success -> review',
      '- fail -> research',
      '',
      '## @gate review',
      '',
      '- pass -> done',
      '- review -> research',
      '- fail -> research',
      '',
      '## @end done',
      '',
      'ok',
    ),
  );
  assert.deepEqual(cyclic.issues, [], '允许环：不能按 DAG 判');
  assert.ok(cyclic.definition, '带环的流程要能给出定义');
});

test('校验：服务端没注册的 gate / review / action 在执行前就报错', () => {
  const md = flow(
    '## @flow demo',
    '',
    'start -> gate1',
    '',
    '## @gate gate1',
    '',
    '- pass -> rev1',
    '- fail -> rev1',
    '',
    '## @review rev1',
    '',
    '- approve -> act1',
    '- reject -> act1',
    '',
    '## @action act1',
    '',
    '- success -> done',
    '- fail -> done',
    '',
    '## @end done',
    '',
    'ok',
  );
  const r = ok(md, { registry: { hasGate: () => false, hasReview: () => false, hasAction: () => false } });
  assert.deepEqual(
    r.issues.map((i) => i.code).sort(),
    ['registry-missing-action', 'registry-missing-gate', 'registry-missing-review'],
  );
  assert.equal(r.definition, undefined, '有 issue 就不给定义');

  assert.deepEqual(ok(md, { registry: ALL_REGISTERED }).issues, []);
});

test('校验：@subagent 指向不存在的技能要报错（不能让 LLM 自己猜一个技能）', () => {
  const r = ok(FLOW_OK, { hasSkill: (n) => n === 'other-skill' });
  const hit = r.issues.find((i) => i.code === 'skill-missing');
  assert.ok(hit);
  assert.equal(hit!.nodeId, 'work');
});

test('校验：flow 名不匹配 / start 指向不存在的节点', () => {
  assert.ok(ok(FLOW_OK, { flow: 'another' }).issues.some((i) => i.code === 'flow-name-mismatch'));
  const badStart = ok(flow('## @flow demo', '', 'start -> ghost', '', '## @end done', '', 'ok'));
  assert.ok(badStart.issues.some((i) => i.code === 'start-missing-node'));
});

test('校验：真实示例技能 server/skills/investment-research 通过全部检查', () => {
  // 用真实注册表 + 真实技能目录：示例技能必须一直保持"能跑"的状态
  const dirs = skillSearchDirs();
  const skill = loadSkill('investment-research', dirs);
  assert.ok(skill, '内置示例技能必须存在');
  const r = validateSkillFlow(parseSkillFlow(skill.markdown), {
    flow: 'investment-review',
    registry: flowRegistryLookup,
    hasSkill: (n) => Boolean(loadSkill(n, dirs)),
  });
  assert.deepEqual(
    r.issues,
    [],
    `示例技能不该有校验问题：\n${r.issues.map((i) => `SKILL.md:${i.line} ${i.message}`).join('\n')}`,
  );
  assert.equal(r.definition!.start, 'investment-research');
  assert.deepEqual(r.definition!.nodes['investment-review']!.routes, [
    { on: 'approve', to: 'publish' },
    { on: 'reject', to: 'investment-rejected' },
  ]);
  assert.equal(r.definition!.nodes['compliance']!.type, 'gate');
  assert.equal(r.definition!.nodes['publish']!.type, 'action');
});

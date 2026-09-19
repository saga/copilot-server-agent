import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { lintSkillFlow } from '../src/skills/flow-lint.js';
import { flowRegistryLookup } from '../src/workflow/registry.js';
import { businessRoleLookup } from '../src/identity/business-roles.js';
import { loadSkill, skillSearchDirs, BUILTIN_SKILL_DIR } from '../src/skills/index.js';

/**
 * `flow:lint` —— 四层流水线的离线入口。
 *
 * 这里要证明的是：**lint 与运行时用的是同一套判定**。所以断言里既有"这段流程通过"，
 * 也有"这段流程会在运行时被拒，lint 必须同样报出来"。
 * 如果 lint 自己另写一套规则，它给出的"通过"就是假的。
 */

/** 与服务端无关的最小上下文：结构校验 + 图分析（注册表全放过） */
const ALL_REGISTERED = {
  hasGate: () => true,
  hasReview: () => true,
  hasAction: () => true,
  hasOutput: () => true,
};

const lint = (md: string, extra: Parameters<typeof lintSkillFlow>[1] = {}) =>
  lintSkillFlow(md, {
    registry: ALL_REGISTERED,
    hasSkill: () => true,
    hasRole: () => true,
    ...extra,
  });

const flow = (...lines: string[]): string => lines.join('\n');

const VALID = flow(
  '## @flow demo',
  '',
  'start -> work',
  '',
  '## @agent work',
  '',
  'output: non-empty',
  '',
  '干活。',
  '',
  '- success -> done',
  '- fail -> done',
  '',
  '## @end done',
  '',
  '完成。',
);

test('lint：普通技能（没有 @block）直接跳过，不算错误', () => {
  const r = lint('---\nname: plain\n---\n\n# Plain\n\n只是一份说明。\n');
  assert.equal(r.skipped, true);
  assert.equal(r.ok, true);
  assert.deepEqual(r.issues, []);
});

test('lint：块类型拼错（`## @gates`）**不能**被当成"普通技能"跳过', () => {
  // 这是 lint 最该报的一类：作者写了块、以为生效了，其实整块是空气。
  // 只看 flows / nodes 两个数组的话它会被算成"没有 @block"，真正的错误被静默吃掉。
  const r = lint('---\nname: typo\n---\n\n## @gates compliance\n\n拼错的块类型。\n');
  assert.equal(r.skipped, false, '有 ast.issues 就不算"普通技能"');
  assert.equal(r.ok, false);
  const hit = r.issues.find((i) => i.code === 'block-unknown-type');
  assert.ok(hit, '必须报出拼错的块');
  assert.match(hit!.message, /@gates compliance/);
});

test('lint：完整流程通过', () => {
  const r = lint(VALID);
  assert.equal(r.skipped, false);
  assert.equal(r.ok, true, JSON.stringify(r.issues));
  assert.deepEqual(r.issues, []);
});

test('lint：问题按行号排序（输出要能顺着文件往下读）', () => {
  const r = lint(
    flow(
      '## @flow demo',
      '',
      'start -> work',
      '',
      '## @agent work',
      '',
      'output: non-empty',
      '',
      '干活。',
      '',
      '- success -> nowhere',
      '',
      '## @end done',
      '',
      '完成。',
    ),
  );
  assert.equal(r.ok, false);
  const lines = r.issues.map((i) => i.line);
  assert.deepEqual(lines, [...lines].sort((a, b) => a - b), '按行号升序');
  assert.ok(r.issues.some((i) => i.code === 'route-target-missing'));
});

test('lint：warning 不阻断（ok 仍为 true），但会出现在 issues 里', () => {
  const r = lint(
    flow(
      '## @flow demo',
      '',
      'start -> work',
      '',
      '## @agent work',
      '',
      'output: non-empty',
      '',
      '干活。',
      '',
      '- success -> failed',
      '- fail -> failed',
      '',
      '## @stop failed',
      '',
      '失败。',
    ),
  );
  const warn = r.issues.find((i) => i.code === 'no-success-path');
  assert.ok(warn, '一条只能以 @stop 收尾的流程要提醒一句');
  assert.equal(warn!.severity, 'warning');
  assert.equal(r.ok, true, 'warning 不该让 lint 失败');
});

test('lint：结构错误存在时**不报图的问题**（避免报出误导性的结论）', () => {
  const r = lint(
    flow(
      '## @flow demo',
      '',
      'start -> work',
      '',
      '## @agent work',
      '',
      'output: non-empty',
      '',
      '干活。',
      '',
      '- success -> typpo',
      '',
      '## @end done',
      '',
      '完成。',
    ),
  );
  assert.ok(r.issues.some((i) => i.code === 'route-target-missing'), '先报结构问题');
  assert.ok(
    !r.issues.some((i) => i.code === 'no-terminal-path'),
    '边指向不存在的节点时，图分析会得出"这个节点出不去"这种**错误**结论 —— 必须先不报',
  );
});

test('lint：走进没有出口的环会被报出来（结构没问题，问题在图）', () => {
  const r = lint(
    flow(
      '## @flow demo',
      '',
      'start -> a',
      '',
      '## @agent a',
      '',
      'output: non-empty',
      '',
      '- success -> b',
      '- fail -> b',
      '',
      '## @gate b',
      '',
      '- pass -> a',
      '',
      '## @end done',
      '',
      '完成。',
    ),
  );
  assert.ok(r.issues.some((i) => i.code === 'no-terminal-path'));
  assert.equal(r.ok, false);
});

test('lint：用**生产同一份**注册表跑内置示例技能（lint 通过 ⇔ 运行时能跑）', () => {
  const skill = loadSkill('investment-research', [BUILTIN_SKILL_DIR]);
  assert.ok(skill, '内置示例技能应当存在');
  const r = lintSkillFlow(skill!.markdown, {
    registry: flowRegistryLookup,
    hasRole: businessRoleLookup.hasRole,
    hasSkill: (name) => Boolean(loadSkill(name, skillSearchDirs())),
  });
  assert.equal(r.skipped, false);
  assert.equal(
    r.ok,
    true,
    `内置示例必须通过生产注册表的检查：\n${r.issues.map((i) => `${i.line} ${i.code} ${i.message}`).join('\n')}`,
  );
});

test('lint：注册表缺项会被报出来（与服务端的判定一致）', () => {
  const skill = loadSkill('investment-research', [BUILTIN_SKILL_DIR])!;
  const r = lintSkillFlow(skill.markdown, {
    registry: { hasGate: () => false, hasReview: () => false, hasAction: () => false },
    hasRole: () => true,
    hasSkill: () => true,
  });
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => i.code.startsWith('registry-missing-')));
});

test('lint：SKILL.md 的路径参数解析成绝对路径（CLI 用）', () => {
  // 只验证 CLI 依赖的那个前提：内置技能目录可以被定位到
  assert.ok(path.isAbsolute(BUILTIN_SKILL_DIR));
  assert.ok(readFileSync(path.join(BUILTIN_SKILL_DIR, 'investment-research', 'SKILL.md'), 'utf-8').length > 0);
});

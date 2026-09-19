import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseSkillFlow } from '../src/skills/flow-parser.js';

/**
 * Skill Flow 的解析层。
 *
 * 只在**二级**标题上认 `## @gate compliance` —— 普通 Markdown section（`## Flow`）不会
 * 与它冲突，代码块里的 `- pass -> x` 也不算路由。这两点是"SKILL.md 同时是给人和机器读的
 * 业务说明"这个前提能不能成立的关键。
 */

const SAMPLE = `---
name: sample
description: 一段描述
---

# Sample

## Purpose

给人看的说明。这里不该被当成节点。

## @flow demo

start -> work

---

## @agent work

干活的说明。

- success -> check
- fail -> failed

## @gate check

确定性判断。

- pass -> done
- fail -> failed

## @stop failed

失败终止。

## @end done

完成。
`;

test('解析：frontmatter / 普通 section 不干扰，节点与路由都取到', () => {
  const parsed = parseSkillFlow(SAMPLE);
  assert.deepEqual(parsed.issues, []);
  assert.deepEqual(
    parsed.blocks.map((b) => `${b.type}:${b.id}`),
    ['flow:demo', 'agent:work', 'gate:check', 'stop:failed', 'end:done'],
  );
  const flow = parsed.blocks[0]!;
  assert.equal(flow.start, 'work', 'start 从 `start -> work` 里取');
  assert.deepEqual(parsed.blocks[1]!.routes, [
    { on: 'success', to: 'check' },
    { on: 'fail', to: 'failed' },
  ]);
  assert.deepEqual(parsed.blocks[2]!.routes, [
    { on: 'pass', to: 'done' },
    { on: 'fail', to: 'failed' },
  ]);
  // `## Purpose` 以 `@` 之外的内容开头 → 不是 block
  assert.ok(!parsed.blocks.some((b) => b.id === 'purpose'));
});

test('解析：body 行号指向 SKILL.md 真实位置（报错要能直接指给作者）', () => {
  const parsed = parseSkillFlow(SAMPLE);
  const lines = SAMPLE.split('\n');
  const gate = parsed.blocks.find((b) => b.id === 'check')!;
  assert.equal(lines[gate.headingLine - 1]!.trim(), '## @gate check', 'headingLine 指向标题行');
  assert.equal(lines[gate.startLine - 1]!.trim(), '确定性判断。', 'startLine 指向正文首行');
  assert.equal(lines[gate.endLine - 1]!.trim(), '- fail -> failed', 'endLine 指向正文末行');
  assert.equal(gate.markdown, '确定性判断。\n\n- pass -> done\n- fail -> failed');
});

test('解析：代码块里的 `->` 不算路由（否则示例代码会把流程带偏）', () => {
  const md = [
    '## @flow demo',
    '',
    'start -> work',
    '',
    '## @agent work',
    '',
    '示例（不是路由）：',
    '',
    '```md',
    '- success -> nowhere',
    '```',
    '',
    '- success -> done',
    '',
    '## @end done',
    '',
    'done',
  ].join('\n');
  const parsed = parseSkillFlow(md);
  const work = parsed.blocks.find((b) => b.id === 'work')!;
  assert.deepEqual(work.routes, [{ on: 'success', to: 'done' }]);
});

test('解析：出口名与节点 id 统一小写，避免 `pass -> Compliance-Review` 静默失配', () => {
  const md = ['## @flow Demo', '', 'Start -> Work', '', '## @gate work', '', '- PASS -> Done', '', '## @end done', '', 'x'].join('\n');
  const parsed = parseSkillFlow(md);
  assert.equal(parsed.blocks[0]!.id, 'demo');
  assert.equal(parsed.blocks[0]!.start, 'work');
  assert.deepEqual(parsed.blocks[1]!.routes, [{ on: 'pass', to: 'done' }]);
});

test('解析：`#` / `###` 上的 @block 报错而不是被静默忽略', () => {
  const md = ['# @gate check', '', '## @flow demo', '', 'start -> check', '', '## @gate check', '', '- pass -> done', '', '## @end done', '', 'ok'].join('\n');
  const parsed = parseSkillFlow(md);
  const depthIssue = parsed.issues.find((i) => i.code === 'block-depth');
  assert.ok(depthIssue, '必须报"标题层级不对"');
  assert.match(depthIssue!.message, /二级标题/);
  assert.equal(parsed.blocks.filter((b) => b.type === 'gate').length, 1, '一级标题那个不算节点');
});

test('解析：拼错的块类型（`## @gates x`）会被报出来', () => {
  const md = ['## @flow demo', '', 'start -> check', '', '## @gates check', '', '- pass -> done', '', '## @end done', '', 'ok'].join('\n');
  const parsed = parseSkillFlow(md);
  assert.ok(parsed.issues.some((i) => i.code === 'block-unknown-type'), '未识别的 @block 必须报错');
});

test('解析：缺 id 的块报错，`@flow` 缺 start 也报错', () => {
  const md = ['## @flow', '', '## @gate', '', '- pass -> x'].join('\n');
  const parsed = parseSkillFlow(md);
  const codes = parsed.issues.map((i) => i.code);
  assert.ok(codes.includes('block-missing-id'));
  assert.equal(parsed.blocks.find((b) => b.type === 'flow')?.start, undefined);
});

test('解析：SKILL.md 里没有 @block 时返回空结果（普通技能仍然可用）', () => {
  const parsed = parseSkillFlow('---\nname: plain\n---\n\n# Plain\n\n只是说明。\n');
  assert.deepEqual(parsed.blocks, []);
  assert.deepEqual(parsed.issues, []);
});

test('解析：带 `- ` 前缀的 start 也认（列表写法与裸行写法等价）', () => {
  const md = ['## @flow demo', '', '- start -> work', '', '## @agent work', '', '- success -> done', '', '## @end done', '', 'ok'].join('\n');
  const parsed = parseSkillFlow(md);
  assert.equal(parsed.blocks[0]!.start, 'work');
});

test('解析：`@subagent` 是 `@agent` 的旧名，解析成同一个节点类型（不报错、不重复）', () => {
  const md = ['## @flow demo', '', 'start -> work', '', '## @subagent work', '', '- success -> done', '', '## @end done', '', 'ok'].join('\n');
  const parsed = parseSkillFlow(md);
  assert.deepEqual(parsed.issues, [], '旧名不该让已经写好的 SKILL.md 校验失败');
  assert.equal(parsed.blocks[1]!.type, 'agent', '别名归一化成 agent，下游只认一种');
});

test('解析：保留属性从正文里剥掉（否则 `role: x` 会变成描述甚至 prompt）', () => {
  const md = [
    '## @flow demo',
    '',
    'start -> rev',
    '',
    '## @review rev',
    '',
    'role: compliance.reviewer',
    'strategy: ALL',
    'required: 2',
    'exclude: initiator',
    '',
    '合规审核，重点看证据是否充分。',
    '',
    '- approve -> done',
    '- reject -> done',
    '',
    '## @end done',
    '',
    'ok',
  ].join('\n');
  const parsed = parseSkillFlow(md);
  assert.deepEqual(parsed.issues, []);
  const rev = parsed.blocks.find((b) => b.id === 'rev')!;
  assert.deepEqual(
    rev.attrs.map((a) => `${a.name}=${a.value}`),
    ['role=compliance.reviewer', 'strategy=ALL', 'required=2', 'exclude=initiator'],
  );
  assert.equal(rev.attrs[0]!.line, 7, '属性行要带上自己的行号（报错才能指到那一行）');
  assert.ok(!rev.markdown.includes('role:'), '属性不该留在正文里');
  assert.match(rev.markdown, /合规审核，重点看证据是否充分。/);
  assert.deepEqual(rev.routes, [
    { on: 'approve', to: 'done' },
    { on: 'reject', to: 'done' },
  ], '剥属性不影响路由');
});

test('解析：`@action` 只支持 role（写别的属性会被指出来）', () => {
  const md = ['## @flow demo', '', 'start -> pub', '', '## @action pub', '', 'role: operations', '', '发布。', '', '- success -> done', '- fail -> done', '', '## @end done', '', 'ok'].join('\n');
  const parsed = parseSkillFlow(md);
  assert.deepEqual(parsed.issues, []);
  const pub = parsed.blocks.find((b) => b.id === 'pub')!;
  assert.deepEqual(pub.attrs.map((a) => `${a.name}=${a.value}`), ['role=operations']);

  const withStrategy = parseSkillFlow(
    ['## @flow demo', '', 'start -> pub', '', '## @action pub', '', 'role: operations', 'strategy: ANY', '', '发布。', '', '- success -> done', '- fail -> done', '', '## @end done', '', 'ok'].join('\n'),
  );
  const hit = withStrategy.issues.find((i) => i.code === 'block-attr-unsupported');
  assert.ok(hit, '@action 上写 strategy 必须报错，不能静默忽略');
  assert.match(hit!.message, /strategy/);
});

test('解析：`@agent` 上写 role 报错（正文是 prompt，不是权限声明的地方）', () => {
  const md = ['## @flow demo', '', 'start -> work', '', '## @agent work', '', 'role: investment.analyst', '', '做研究。', '', '- success -> done', '- fail -> done', '', '## @end done', '', 'ok'].join('\n');
  const parsed = parseSkillFlow(md);
  const hit = parsed.issues.find((i) => i.code === 'block-attr-unsupported');
  assert.ok(hit, '@agent 不支持 role —— 静默当 prompt 才是最坏的结果');
  assert.match(hit!.message, /@agent work/);
});

test('解析：属性必须写在正文最前面（`Note: ...` 开头的正文不会被误判成属性）', () => {
  const md = ['## @flow demo', '', 'start -> rev', '', '## @review rev', '', 'Note: 这条很重要。', '', 'role: compliance.reviewer', '', '- approve -> done', '- reject -> done', '', '## @end done', '', 'ok'].join('\n');
  const parsed = parseSkillFlow(md);
  assert.deepEqual(parsed.issues, [], '正文以 `Note:` 开头不该被判成属性');
  const rev = parsed.blocks.find((b) => b.id === 'rev')!;
  assert.deepEqual(rev.attrs, [], '属性区被普通段落打断 → 后面的 role 不算属性');
  assert.match(rev.markdown, /^Note: 这条很重要。/);
});

test('解析：重复属性 / 认不出的属性名都报错（同段里已认领到属性时才判）', () => {
  const dup = parseSkillFlow(
    ['## @flow demo', '', 'start -> rev', '', '## @review rev', '', 'role: a', 'role: b', '', '- approve -> done', '- reject -> done', '', '## @end done', '', 'ok'].join('\n'),
  );
  const dupHit = dup.issues.find((i) => i.code === 'block-attr-duplicate');
  assert.ok(dupHit);
  assert.equal(dupHit!.line, 8, '指到第二行 role');

  const typo = parseSkillFlow(
    ['## @flow demo', '', 'start -> rev', '', '## @review rev', '', 'role: compliance.reviewer', 'roles: extra', '', '- approve -> done', '- reject -> done', '', '## @end done', '', 'ok'].join('\n'),
  );
  assert.ok(typo.issues.some((i) => i.code === 'block-attr-unknown'), '`roles:` 是拼错，必须报出来');
});

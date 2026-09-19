import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseSkillFlow } from '../src/skills/flow-parser.js';

/**
 * Skill Flow 的**语法层**：`SKILL.md` → `FlowAst`。
 *
 * 这一层只回答"作者写了什么"，所以断言也只看三件事：
 *   - 哪些块被认出来了（`@flow` 与节点分开成两个数组）
 *   - 正文、属性、路由各自被切到了哪里（含行号）
 *   - 词法层面的书写问题有没有报出来
 *
 * 只在**二级**标题上认 `## @gate compliance` —— 普通 Markdown section（`## Flow`）不会
 * 与它冲突，代码块里的 `- pass -> x` 也不算路由。这两点是"SKILL.md 同时是给人和机器读的
 * 业务说明"这个前提能不能成立的关键。
 *
 * 语义（角色是否登记、gate 是否注册、能不能走到 @end）**一律不在这里**：
 * 见 flow-validator.test.ts 与 flow-analyzer.test.ts。
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

## @task work

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
  const ast = parseSkillFlow(SAMPLE);
  assert.deepEqual(ast.issues, []);
  assert.deepEqual(
    ast.nodes.map((n) => `${n.type}:${n.id}`),
    ['task:work', 'gate:check', 'stop:failed', 'end:done'],
  );
  assert.equal(ast.flows.length, 1, '@flow 单独成一个数组（作者可能写 0 个或 2 个）');
  assert.equal(ast.flows[0]!.id, 'demo');
  assert.equal(ast.flows[0]!.start, 'work', 'start 从 `start -> work` 里取');

  const work = ast.nodes[0]!;
  assert.deepEqual(
    work.routes.map((r) => `${r.outcome}->${r.target}`),
    ['success->check', 'fail->failed'],
  );
  assert.deepEqual(
    ast.nodes[1]!.routes.map((r) => `${r.outcome}->${r.target}`),
    ['pass->done', 'fail->failed'],
  );
  // `## Purpose` 以 `@` 之外的内容开头 → 不是 block
  assert.ok(!ast.nodes.some((n) => n.id === 'purpose'));
});

test('解析：行号指向 SKILL.md 真实位置（报错要能直接指给作者）', () => {
  const ast = parseSkillFlow(SAMPLE);
  const lines = SAMPLE.split('\n');
  const gate = ast.nodes.find((n) => n.id === 'check')!;
  assert.equal(lines[gate.line - 1]!.trim(), '## @gate check', 'line 指向标题行');
  assert.equal(lines[gate.startLine - 1]!.trim(), '确定性判断。', 'startLine 指向正文首行');
  assert.equal(lines[gate.endLine - 1]!.trim(), '- fail -> failed', 'endLine 指向正文末行');
  assert.equal(gate.body, '确定性判断。\n\n- pass -> done\n- fail -> failed');
});

test('解析：每条 route 带自己的行号（重复出口 / 目标不存在时要指到那一行）', () => {
  const ast = parseSkillFlow(SAMPLE);
  const lines = SAMPLE.split('\n');
  const work = ast.nodes.find((n) => n.id === 'work')!;
  for (const route of work.routes) {
    assert.equal(
      lines[route.line - 1]!.trim(),
      `- ${route.outcome} -> ${route.target}`,
      `route ${route.outcome} 的行号要指向它自己那一行`,
    );
  }
});

test('解析：代码块里的 `->` 不算路由（否则示例代码会把流程带偏）', () => {
  const md = [
    '## @flow demo',
    '',
    'start -> work',
    '',
    '## @task work',
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
  const ast = parseSkillFlow(md);
  const work = ast.nodes.find((n) => n.id === 'work')!;
  assert.deepEqual(
    work.routes.map((r) => `${r.outcome}->${r.target}`),
    ['success->done'],
  );
});

test('解析：出口名与节点 id 统一小写，避免 `pass -> Compliance-Review` 静默失配', () => {
  const md = ['## @flow Demo', '', 'Start -> Work', '', '## @gate work', '', '- PASS -> Done', '', '## @end done', '', 'x'].join('\n');
  const ast = parseSkillFlow(md);
  assert.equal(ast.flows[0]!.id, 'demo');
  assert.equal(ast.flows[0]!.start, 'work');
  assert.deepEqual(
    ast.nodes[0]!.routes.map((r) => `${r.outcome}->${r.target}`),
    ['pass->done'],
  );
});

test('解析：`#` / `###` 上的 @block 报错而不是被静默忽略', () => {
  const md = ['# @gate check', '', '## @flow demo', '', 'start -> check', '', '## @gate check', '', '- pass -> done', '', '## @end done', '', 'ok'].join('\n');
  const ast = parseSkillFlow(md);
  const depthIssue = ast.issues.find((i) => i.code === 'block-depth');
  assert.ok(depthIssue, '必须报"标题层级不对"');
  assert.match(depthIssue!.message, /二级标题/);
  assert.equal(ast.nodes.filter((n) => n.type === 'gate').length, 1, '一级标题那个不算节点');
});

test('解析：拼错的块类型（`## @gates x`）会被报出来', () => {
  const md = ['## @flow demo', '', 'start -> check', '', '## @gates check', '', '- pass -> done', '', '## @end done', '', 'ok'].join('\n');
  const ast = parseSkillFlow(md);
  assert.ok(ast.issues.some((i) => i.code === 'block-unknown-type'), '未识别的 @block 必须报错');
});

test('解析：缺 id 的块报错，`@flow` 缺 start 也报错', () => {
  const md = ['## @flow', '', '## @gate', '', '- pass -> x'].join('\n');
  const ast = parseSkillFlow(md);
  const codes = ast.issues.map((i) => i.code);
  assert.ok(codes.includes('block-missing-id'));
  assert.equal(ast.flows[0]!.start, undefined);
});

test('解析：SKILL.md 里没有 @block 时返回空 AST（普通技能仍然可用）', () => {
  const ast = parseSkillFlow('---\nname: plain\n---\n\n# Plain\n\n只是说明。\n');
  assert.deepEqual(ast.nodes, []);
  assert.deepEqual(ast.flows, []);
  assert.deepEqual(ast.issues, []);
});

test('解析：带 `- ` 前缀的 start 也认（列表写法与裸行写法等价）', () => {
  const md = ['## @flow demo', '', '- start -> work', '', '## @task work', '', '- success -> done', '', '## @end done', '', 'ok'].join('\n');
  const ast = parseSkillFlow(md);
  assert.equal(ast.flows[0]!.start, 'work');
});

test('解析：`@subagent` / `@agent` 都已移除 —— 写了就报 `block-unknown-type`', () => {
  // 这条是有意做成"硬改名"的：@agent 这个名字会让人把它读成"起一个 subagent"，
  // 而它实际只是"跑一个受约束的 AI 工作单元"。留着别名等于把那个误读留在 DSL 里。
  for (const legacy of ['@agent', '@subagent']) {
    const md = ['## @flow demo', '', 'start -> work', '', `## ${legacy} work`, '', '- success -> done', '', '## @end done', '', 'ok'].join('\n');
    const ast = parseSkillFlow(md);
    const hit = ast.issues.find((i) => i.code === 'block-unknown-type');
    assert.ok(hit, `${legacy} 必须报错，而不是被静默归一化成 task`);
    assert.match(hit!.message, /@task/, '报错要说清现在该写什么');
    assert.deepEqual(
      ast.nodes.map((n) => n.id),
      ['done'],
      '认不出来的块不进 AST —— 只剩后面那个 @end',
    );
  }
});

test('解析：`@action` 已硬改名为 `@command` —— 写了旧名就报 `block-unknown-type`', () => {
  // 同 `@agent` → `@task`：`action` 是个"什么都能叫"的上位词，留着别名等于把误读留在 DSL 里。
  const md = [
    '## @flow demo',
    '',
    'start -> publish',
    '',
    '## @action publish',
    '',
    '发布。',
    '',
    '- success -> done',
    '',
    '## @end done',
    '',
    'ok',
  ].join('\n');
  const ast = parseSkillFlow(md);
  const hit = ast.issues.find((i) => i.code === 'block-unknown-type');
  assert.ok(hit, '`@action` 必须报错，而不是被静默归一化成 command');
  assert.match(hit!.message, /@command/, '报错要说清现在该写什么');
  assert.deepEqual(ast.nodes.map((n) => n.id), ['done'], '认不出来的块不进 AST —— 只剩后面那个 @end');
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
  const ast = parseSkillFlow(md);
  assert.deepEqual(ast.issues, []);
  const rev = ast.nodes.find((n) => n.id === 'rev')!;
  assert.deepEqual(
    rev.attrs.map((a) => `${a.name}=${a.value}`),
    ['role=compliance.reviewer', 'strategy=ALL', 'required=2', 'exclude=initiator'],
  );
  assert.equal(rev.attrs[0]!.line, 7, '属性行要带上自己的行号（报错才能指到那一行）');
  // 值**原样保留**：`ALL` 的大写、`2` 还是字符串 —— 语义解释是校验器的事
  assert.equal(rev.attrs[1]!.value, 'ALL');
  assert.ok(!rev.body.includes('role:'), '属性不该留在正文里');
  assert.match(rev.body, /合规审核，重点看证据是否充分。/);
  assert.deepEqual(
    rev.routes.map((r) => `${r.outcome}->${r.target}`),
    ['approve->done', 'reject->done'],
    '剥属性不影响路由',
  );
});

test('解析：属性值保持原样（`strategy: all` 也要能被记下来交给校验器）', () => {
  const md = ['## @flow demo', '', 'start -> rev', '', '## @review rev', '', 'strategy: all', 'required: 很多', '', '- approve -> done', '- reject -> done', '', '## @end done', '', 'ok'].join('\n');
  const ast = parseSkillFlow(md);
  // 语法层不判断 ANY/ALL —— 它只保证"作者写的这两个值被原样记下来了"
  assert.deepEqual(
    ast.nodes.find((n) => n.id === 'rev')!.attrs.map((a) => `${a.name}=${a.value}`),
    ['strategy=all', 'required=很多'],
  );
});

test('解析：`@command` 只支持 role（写别的属性会被指出来）', () => {
  const md = ['## @flow demo', '', 'start -> pub', '', '## @command pub', '', 'role: operations', '', '发布。', '', '- success -> done', '- fail -> done', '', '## @end done', '', 'ok'].join('\n');
  const ast = parseSkillFlow(md);
  assert.deepEqual(ast.issues, []);
  const pub = ast.nodes.find((n) => n.id === 'pub')!;
  assert.deepEqual(pub.attrs.map((a) => `${a.name}=${a.value}`), ['role=operations']);

  const withStrategy = parseSkillFlow(
    ['## @flow demo', '', 'start -> pub', '', '## @command pub', '', 'role: operations', 'strategy: ANY', '', '发布。', '', '- success -> done', '- fail -> done', '', '## @end done', '', 'ok'].join('\n'),
  );
  const hit = withStrategy.issues.find((i) => i.code === 'block-attr-unsupported');
  assert.ok(hit, '@command 上写 strategy 必须报错，不能静默忽略');
  assert.match(hit!.message, /strategy/);
});

test('解析：`@task` 上写 role 报错（正文是 prompt，不是权限声明的地方）', () => {
  const md = ['## @flow demo', '', 'start -> work', '', '## @task work', '', 'role: investment.analyst', '', '做研究。', '', '- success -> done', '- fail -> done', '', '## @end done', '', 'ok'].join('\n');
  const ast = parseSkillFlow(md);
  const hit = ast.issues.find((i) => i.code === 'block-attr-unsupported');
  assert.ok(hit, '@task 不支持 role —— 静默当 prompt 才是最坏的结果');
  assert.match(hit!.message, /@task work/);
});

test('解析：属性必须写在正文最前面（`Note: ...` 开头的正文不会被误判成属性）', () => {
  const md = ['## @flow demo', '', 'start -> rev', '', '## @review rev', '', 'Note: 这条很重要。', '', 'role: compliance.reviewer', '', '- approve -> done', '- reject -> done', '', '## @end done', '', 'ok'].join('\n');
  const ast = parseSkillFlow(md);
  assert.deepEqual(ast.issues, [], '正文以 `Note:` 开头不该被判成属性');
  const rev = ast.nodes.find((n) => n.id === 'rev')!;
  assert.deepEqual(rev.attrs, [], '属性区被普通段落打断 → 后面的 role 不算属性');
  assert.match(rev.body, /^Note: 这条很重要。/);
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

test('解析：AST 忠实记录"写了什么"，不做语义筛选', () => {
  // 这条用例是分层的前提：指向不存在的节点、未注册的 gate、非法的角色 id
  // —— parser 全部原样收下，一个都不丢。丢掉就没法报"你写的第 N 行有问题"。
  const md = [
    '## @flow demo',
    '',
    'start -> nowhere',
    '',
    '## @gate not-registered',
    '',
    '- pass -> also-nowhere',
    '',
    '## @review rev',
    '',
    'role: Not-A-Role',
    '',
    '- approve -> done',
    '- reject -> done',
    '',
    '## @end done',
    '',
    'ok',
  ].join('\n');
  const ast = parseSkillFlow(md);
  assert.deepEqual(ast.issues, [], '语法完全合法 —— 问题都是语义的');
  assert.deepEqual(
    ast.nodes.map((n) => n.id),
    ['not-registered', 'rev', 'done'],
  );
  assert.equal(ast.flows[0]!.start, 'nowhere', '指向不存在的节点也照收');
  assert.equal(ast.nodes[1]!.attrs[0]!.value, 'Not-A-Role', '非法角色 id 原样保留');
});

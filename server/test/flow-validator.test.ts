import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseSkillFlow } from '../src/skills/flow-parser.js';
import { validateSkillFlow } from '../src/skills/flow-validator.js';
import { analyzeFlow } from '../src/skills/flow-analyzer.js';
import { loadSkill, skillSearchDirs } from '../src/skills/index.js';
import { businessRoleLookup } from '../src/identity/business-roles.js';
import { flowRegistryLookup } from '../src/workflow/registry.js';
import type { FlowDefinition, FlowIssue } from '../src/workflow/types.js';

/**
 * Flow 静态校验：**在跑之前**把问题全报出来。
 *
 * 最容易出事的两个方向：
 *   - 路由指向不存在的节点 → 运行时走到那一步才炸，而 execution 那时可能已经等人工了
 *   - 出口写漏（@action 只写了 success，忘了 fail）→ 失败分支无处可去
 * 这两类必须在建 execution 时就 400。
 *
 * 同时确认**允许环**：research → review → research 是研究流程的常态，不能按 DAG 判。
 *
 * 分层之后这里有两套入口：
 *   `semantics()`  只跑语义校验（AST → FlowDefinition）—— 测这一层的边界
 *   `ok()`         跑完整流水线（校验 + 控制流分析）—— 测作者看到的结果
 * 生产路径（definition-provider）用的是后者。
 */

/** 只跑语义校验：回答"允许执行什么" */
const semantics = (md: string, opts: Parameters<typeof validateSkillFlow>[1] = {}) =>
  validateSkillFlow(parseSkillFlow(md), opts);

/** 完整流水线：语义校验 + 控制流分析（与 definition-provider.load 一致） */
const ok = (md: string, opts: Parameters<typeof validateSkillFlow>[1] = {}) => {
  const ast = parseSkillFlow(md);
  const validated = validateSkillFlow(ast, opts);
  const issues: FlowIssue[] = [...validated.issues];
  if (validated.definition) issues.push(...analyzeFlow(validated.definition));
  return { definition: validated.definition, issues };
};

/** 定义一定存在时取出来（断言里的 `!` 太吵） */
const def = (r: { definition?: FlowDefinition }): FlowDefinition => r.definition!;

/** 拼流程用的小工具（只是 join，避免一长串 '...' 逗号列表看错行） */
const flow = (...lines: string[]): string => lines.join('\n');

const FLOW_OK = flow(
  '## @flow demo',
  '',
  'start -> work',
  '',
  '## @agent work',
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

/** 注册表里的 `@review` 基策略（服务端权威值；SKILL.md 的属性只能在其上收窄） */
function basePolicy(
  eligibleRoles: string[],
  over: Partial<{
    strategy: 'ANY' | 'ALL';
    requiredCount: number;
    allowInitiator: boolean;
  }> = {},
) {
  return {
    eligibleRoles,
    strategy: over.strategy ?? ('ANY' as const),
    requiredCount: over.requiredCount ?? 1,
    allowInitiator: over.allowInitiator ?? false,
  };
}

test('校验：结构完整时通过，并给出 FlowDefinition', () => {
  const r = ok(FLOW_OK);
  assert.deepEqual(r.issues, []);
  assert.ok(r.definition);
  assert.equal(r.definition!.id, 'demo');
  assert.equal(r.definition!.start, 'work');
  assert.deepEqual(Object.keys(r.definition!.nodes).sort(), ['check', 'done', 'failed', 'work']);
  assert.equal(r.definition!.nodes['work']!.type, 'agent');
  // body 是原样 Markdown（含 route 行）：agent 直接拿它当 prompt，非 agent 取首行当描述
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
      '## @agent work',
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
      '## @agent work',
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
      '## @agent research',
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

test('校验：@agent 指向不存在的技能要报错（不能让 LLM 自己猜一个技能）', () => {
  const r = ok(FLOW_OK, { hasSkill: (n) => n === 'other-skill' });
  const hit = r.issues.find((i) => i.code === 'skill-missing');
  assert.ok(hit);
  assert.equal(hit!.nodeId, 'work');
});

test('校验：同一个出口写了两条 route 必须报错（否则后一条静默失效）', () => {
  const dupGate = ok(
    flow(
      '## @flow demo',
      '',
      'start -> check',
      '',
      '## @gate check',
      '',
      '- pass -> done',
      '- pass -> failed',
      '- fail -> failed',
      '',
      '## @stop failed',
      '',
      '失败。',
      '',
      '## @end done',
      '',
      '完成。',
    ),
  );
  const hit = dupGate.issues.find((i) => i.code === 'route-outcome-duplicate');
  assert.ok(hit, '"pass" 出现两次必须报错，而不是取第一条');
  assert.equal(hit!.nodeId, 'check');
  assert.match(hit!.message, /pass/);
  assert.match(
    hit!.message,
    /-> done[\s\S]*-> failed/,
    '要把两条目标都写出来，作者才知道删哪条',
  );
  assert.equal(
    hit!.line,
    8,
    '指到**重复的那一条** route 自己的行（第 8 行），而不是节点标题行 —— 否则等于没报',
  );
  assert.equal(dupGate.definition, undefined, '有 error 就不给定义');
});

test('校验：@flow 的 start 也只能有一条（`start -> a` + `start -> b` 是歧义入口）', () => {
  const r = ok(
    flow(
      '## @flow demo',
      '',
      'start -> a',
      'start -> b',
      '',
      '## @end a',
      '',
      'ok',
      '',
      '## @end b',
      '',
      'ok',
    ),
  );
  const hit = r.issues.find((i) => i.code === 'route-outcome-duplicate');
  assert.ok(hit, '两个 start 必须报错');
  assert.match(hit!.message, /start/);
});

test('校验：同一个出口指向同一个目标重复写，不算歧义（parser 已去重）', () => {
  const r = ok(
    flow(
      '## @flow demo',
      '',
      'start -> check',
      '',
      '## @gate check',
      '',
      '- pass -> done',
      '- pass -> done',
      '- fail -> done',
      '',
      '## @end done',
      '',
      'ok',
    ),
  );
  assert.deepEqual(r.issues, [], '重复但完全一致的路由只是啰嗦，不是错误');
});

test('校验：保留属性值不合法 → attr-invalid（带属性行行号）', () => {
  const cases: Array<[string, RegExp]> = [
    ['strategy: SOMETIMES', /ANY \| ALL/],
    ['required: 0', /正整数/],
    ['required: 两个', /正整数/],
    ['exclude: same-department', /initiator \| none/],
    ['role: APP-FIL-Compliance-Reviewer', /不是业务角色 id/],
  ];
  for (const [line, pattern] of cases) {
    const r = ok(
      flow(
        '## @flow demo',
        '',
        'start -> rev',
        '',
        '## @review rev',
        '',
        line,
        '',
        '审核。',
        '',
        '- approve -> done',
        '- reject -> done',
        '',
        '## @end done',
        '',
        'ok',
      ),
      { registry: ALL_REGISTERED, hasRole: () => true },
    );
    const hit = r.issues.find((i) => i.code === 'attr-invalid');
    assert.ok(hit, `"${line}" 必须报 attr-invalid`);
    assert.match(hit!.message, pattern);
    assert.equal(hit!.line, 7, '要指到属性自己那一行');
  }
});

test('校验：role 必须是已登记的业务角色（不能凭空写一个）', () => {
  const md = flow(
    '## @flow demo',
    '',
    'start -> rev',
    '',
    '## @review rev',
    '',
    'role: nobody.knows',
    '',
    '审核。',
    '',
    '- approve -> done',
    '- reject -> done',
    '',
    '## @end done',
    '',
    'ok',
  );
  const hit = ok(md, { registry: ALL_REGISTERED, hasRole: () => false }).issues.find(
    (i) => i.code === 'role-missing',
  );
  assert.ok(hit, '未登记的业务角色必须报错，而不是等到审批时才发现没人能批');
  assert.match(hit!.message, /nobody\.knows/);
  // 登记过就通过（真实 RoleRegistry）
  assert.deepEqual(
    ok(md.replace('nobody.knows', 'compliance.reviewer'), {
      registry: ALL_REGISTERED,
      hasRole: businessRoleLookup.hasRole,
    }).issues,
    [],
  );
});

test('校验：@review 拿不到任何角色 → review-missing-role', () => {
  const md = flow(
    '## @flow demo',
    '',
    'start -> rev',
    '',
    '## @review rev',
    '',
    '审核。',
    '',
    '- approve -> done',
    '- reject -> done',
    '',
    '## @end done',
    '',
    'ok',
  );
  // 注册表里该 review 登记了，但 eligibleRoles 是空的 → 建出来就是一个"没人有资格批"的任务
  const noRoles = { ...ALL_REGISTERED, reviewPolicy: () => basePolicy([]) };
  const hit = ok(md, { registry: noRoles }).issues.find((i) => i.code === 'review-missing-role');
  assert.ok(hit, '注册表的 eligibleRoles 为空必须报错');
  assert.match(hit!.message, /eligibleRoles/, '报错要告诉作者怎么修');

  // 注册表里有 eligibleRoles 就够了（SKILL.md 不必写）
  const withRoles = {
    ...ALL_REGISTERED,
    reviewPolicy: () => basePolicy(['compliance.reviewer']),
  };
  assert.deepEqual(ok(md, { registry: withRoles }).issues, []);

  // 不提供 reviewPolicy 回调时跳过这项检查（只做结构校验的场景）
  assert.deepEqual(ok(md, { registry: ALL_REGISTERED }).issues, []);
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
    hasRole: businessRoleLookup.hasRole,
    // 与生产默认一致：每个 @agent 都必须有完成契约（见 config.workflowRequireAgentOutput）
    requireAgentOutput: true,
    agentTools: ['read', 'write', 'url'],
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
  // 保留属性：示例技能用 `role:` 声明业务角色（不是 AD Group），审批策略在服务端
  assert.deepEqual(r.definition!.nodes['compliance-review']!.attrs, {
    role: 'compliance.reviewer',
    strategy: 'ANY',
    required: 1,
    exclude: 'initiator',
  });
  assert.deepEqual(r.definition!.nodes['investment-review']!.attrs, {
    role: 'investment.reviewer',
    strategy: 'ANY',
    required: 1,
    exclude: 'initiator',
  });
  assert.deepEqual(r.definition!.nodes['publish']!.attrs, { role: 'investment.reviewer' });
  assert.deepEqual(
    r.definition!.nodes['investment-research']!.attrs,
    { output: 'non-empty' },
    '@agent 只有完成契约属性（谁有权跑这个 skill 不由 SKILL.md 决定）',
  );
});

// ---------- 属性只能比服务端更严（本轮新增的核心安全规则） ----------

/** 一个 `@review` 流程骨架，属性写在正文最前面 */
const reviewFlow = (...attrs: string[]): string =>
  flow(
    '## @flow demo',
    '',
    'start -> rev',
    '',
    '## @review rev',
    '',
    ...attrs,
    ...(attrs.length ? [''] : []),
    '审核。',
    '',
    '- approve -> done',
    '- reject -> done',
    '',
    '## @end done',
    '',
    'ok',
  );

const withPolicy = (policy: ReturnType<typeof basePolicy>) => ({
  ...ALL_REGISTERED,
  reviewPolicy: () => policy,
});

test('校验：@review 的 role 只能是注册表基策略的子集（不能引入新角色）', () => {
  const md = reviewFlow('role: compliance.reviewer');
  // 基策略里有它 → 合法的收窄
  assert.deepEqual(ok(md, { registry: withPolicy(basePolicy(['compliance.reviewer', 'risk'])) }).issues, []);

  // 基策略里没有它 → 引入了一个新角色，等于放宽
  const hit = ok(md, { registry: withPolicy(basePolicy(['risk'])) }).issues.find(
    (i) => i.code === 'role-not-allowed',
  );
  assert.ok(hit, 'role 不在基策略里必须报错');
  assert.match(hit!.message, /只能从基策略里收窄/);
});

test('校验：@review 的 strategy / required / exclude 都只能更严', () => {
  // strategy：基策略 ALL → SKILL.md 写 ANY = 放宽（3 人通过降成任一通过）
  const anyWidens = ok(reviewFlow('strategy: ANY'), {
    registry: withPolicy(basePolicy(['risk'], { strategy: 'ALL', requiredCount: 3 })),
  }).issues.find((i) => i.code === 'attr-widens');
  assert.ok(anyWidens, 'ALL → ANY 必须报错');
  assert.match(anyWidens!.message, /strategy: ANY 放宽/);

  // 基策略 ANY → 写 ALL = 更严，允许
  assert.deepEqual(
    ok(reviewFlow('strategy: ALL'), { registry: withPolicy(basePolicy(['risk'])) }).issues,
    [],
  );

  // required：基策略 3 票 → 写 1 票 = 放宽
  const fewerVotes = ok(reviewFlow('required: 1'), {
    registry: withPolicy(basePolicy(['risk'], { requiredCount: 3 })),
  }).issues.find((i) => i.code === 'attr-widens');
  assert.ok(fewerVotes, '降票数必须报错');
  assert.match(fewerVotes!.message, /低于注册表要求的 3 票/);

  // 基策略 1 票 → 写 3 票 = 更严，允许
  assert.deepEqual(
    ok(reviewFlow('required: 3'), { registry: withPolicy(basePolicy(['risk'])) }).issues,
    [],
  );

  // exclude：基策略不允许自批 → 写 none = 放宽
  const selfApprove = ok(reviewFlow('exclude: none'), {
    registry: withPolicy(basePolicy(['risk'], { allowInitiator: false })),
  }).issues.find((i) => i.code === 'attr-widens');
  assert.ok(selfApprove, '把禁止自批改成允许必须报错');
  assert.match(selfApprove!.message, /SoD/);

  // 基策略允许自批 → 写 initiator = 更严，允许
  assert.deepEqual(
    ok(reviewFlow('exclude: initiator'), {
      registry: withPolicy(basePolicy(['risk'], { allowInitiator: true })),
    }).issues,
    [],
  );
});

test('校验：@review 属性全部合法时不报错（属性只是收窄，不改变基策略本身）', () => {
  const r = ok(reviewFlow('role: risk', 'strategy: ALL', 'required: 3', 'exclude: initiator'), {
    registry: withPolicy(
      basePolicy(['risk', 'compliance'], { strategy: 'ANY', requiredCount: 1, allowInitiator: true }),
    ),
  });
  assert.deepEqual(r.issues, []);
  assert.deepEqual(r.definition!.nodes['rev']!.attrs, {
    role: 'risk',
    strategy: 'ALL',
    required: 3,
    exclude: 'initiator',
  });
});

/**
 * `strategy: ALL` 必须真的全员。
 *
 * ANY 与 ALL 的唯一区别落在票数上，所以 `ALL + required: 1`（3 个资格角色）
 * 实际仍然只需要 1 票 —— 它只是**名字叫 ALL 的 ANY**。这种写法比写错更危险：
 * 审批链上写着 ALL，没人会再去核对票数。
 */
test('校验：strategy: ALL 的票数必须覆盖全部生效角色（否则 ALL 只是名字）', () => {
  const base = basePolicy(['risk', 'compliance', 'ops'], { strategy: 'ANY', requiredCount: 1 });

  // 基策略 ANY + 3 个角色 + required 1 → ALL 被削弱成 ANY，必须报错
  const weakened = ok(reviewFlow('strategy: ALL', 'required: 1'), {
    registry: withPolicy(base),
  }).issues.find((i) => i.code === 'review-all-required');
  assert.ok(weakened, 'ALL + required 1（3 个角色）必须报错');
  assert.match(weakened!.message, /ALL 被削弱成了 ANY/);
  assert.match(weakened!.message, /required: 3/, '要告诉作者改成几票');
  assert.equal(weakened!.nodeId, 'rev');

  // 不写 required 时，基策略的 1 票同样不够（ALL 需要 3 票）
  assert.ok(
    ok(reviewFlow('strategy: ALL'), { registry: withPolicy(base) }).issues.some(
      (i) => i.code === 'review-all-required',
    ),
    'ALL 不写 required 时按基策略票数算，同样不够全员',
  );

  // required 补齐到角色数 → 合法
  assert.deepEqual(
    ok(reviewFlow('strategy: ALL', 'required: 3'), { registry: withPolicy(base) }).issues,
    [],
  );

  // 票数更多也合法（只能加不能减）：5 票比"全员"更严
  assert.deepEqual(
    ok(reviewFlow('strategy: ALL', 'required: 5'), { registry: withPolicy(base) }).issues,
    [],
  );

  // role 把角色收窄到 1 个之后，ALL + required 1 就是合法的全员通过
  assert.deepEqual(
    ok(reviewFlow('role: risk', 'strategy: ALL', 'required: 1'), {
      registry: withPolicy(base),
    }).issues,
    [],
    '生效角色只剩 1 个时，1 票就是全员',
  );

  // 基策略本身就是 ALL 且票数够 → 通过
  assert.deepEqual(
    ok(reviewFlow(), {
      registry: withPolicy(
        basePolicy(['risk', 'compliance'], { strategy: 'ALL', requiredCount: 2 }),
      ),
    }).issues,
    [],
  );
});

// ---------- @gate 的出口必须与注册表声明一致 ----------

test('校验：@gate 声明的出口必须有 route，route 的出口必须被声明', () => {
  const md = flow(
    '## @flow demo',
    '',
    'start -> check',
    '',
    '## @gate check',
    '',
    '判断。',
    '',
    '- pass -> done',
    '- fail -> done',
    '',
    '## @end done',
    '',
    'ok',
  );
  const gate = (outcomes: string[]) => ({ ...ALL_REGISTERED, gateOutcomes: () => outcomes });

  // 声明了 review 但没有它的 route → 运行时那条分支无处可去
  const unrouted = ok(md, { registry: gate(['pass', 'fail', 'review']) }).issues.find(
    (i) => i.code === 'gate-outcome-unrouted',
  );
  assert.ok(unrouted, '声明的出口没有 route 必须报错');
  assert.match(unrouted!.message, /review/);

  // route 写了一个永远不会被返回的出口 → 死分支
  const unknown = ok(
    flow(
      '## @flow demo',
      '',
      'start -> check',
      '',
      '## @gate check',
      '',
      '- pass -> done',
      '- fail -> done',
      '- escalate -> done',
      '',
      '## @end done',
      '',
      'ok',
    ),
    { registry: gate(['pass', 'fail']) },
  ).issues.find((i) => i.code === 'gate-outcome-unknown');
  assert.ok(unknown, 'route 的出口不在声明里必须报错');
  assert.match(unknown!.message, /escalate/);

  // 完全一致 → 通过
  assert.deepEqual(ok(md, { registry: gate(['pass', 'fail']) }).issues, []);

  // 不提供 gateOutcomes 回调时跳过（只做结构校验的场景）
  assert.deepEqual(ok(md, { registry: ALL_REGISTERED }).issues, []);
});

// ---------- @agent 的完成契约与能力边界 ----------

test('校验：@agent 的 tools 只能比服务端上限更严', () => {
  const md = flow(
    '## @flow demo',
    '',
    'start -> work',
    '',
    '## @agent work',
    '',
    'tools: read',
    '',
    '干活。',
    '',
    '- success -> done',
    '- fail -> done',
    '',
    '## @end done',
    '',
    'ok',
  );
  const ceiling = ['read', 'write', 'url'] as const;

  const r = ok(md, { agentTools: ceiling });
  assert.deepEqual(r.issues, []);
  assert.deepEqual(r.definition!.nodes['work']!.attrs.tools, ['read']);

  // 部署把上限收窄到 read 时，声明 read,write 就是超限
  const widened = ok(
    flow(
      '## @flow demo',
      '',
      'start -> work',
      '',
      '## @agent work',
      '',
      'tools: read,write',
      '',
      '干活。',
      '',
      '- success -> done',
      '- fail -> done',
      '',
      '## @end done',
      '',
      'ok',
    ),
    { agentTools: ['read'] },
  ).issues.find((i) => i.code === 'agent-tools-widens');
  assert.ok(widened, 'tools 超出上限必须报错');
  assert.match(widened!.message, /write/);
  assert.match(widened!.message, /COPILOT_WORKFLOW_AGENT_TOOLS/, '要告诉运维改哪里');

  // 未知权限类别 → attr-invalid
  assert.ok(
    ok(md.replace('tools: read', 'tools: teleport'), { agentTools: ceiling }).issues.some(
      (i) => i.code === 'attr-invalid',
    ),
  );
});

/**
 * `mcp` / `shell` 是**永久禁止**的类别，不是"默认上限里没有"。
 *
 * 差别很关键：做成默认值的话，把 `COPILOT_WORKFLOW_AGENT_TOOLS=mcp` 一写，
 * `@agent` 就重新拿到了绕开 `@action` 审批的路径 —— 一条环境变量取消了整条流程的
 * 授权模型，而 SKILL.md、审批记录、审计链上都看不出任何异常。
 *
 * 所以校验是**无条件**的：不传 agentTools（只做结构校验的场景）也要报。
 */
test('校验：@agent 的 tools 里写 mcp / shell 一律拒绝（与部署配置无关）', () => {
  const withTools = (tools: string): string =>
    flow(
      '## @flow demo',
      '',
      'start -> work',
      '',
      '## @agent work',
      '',
      `tools: ${tools}`,
      '',
      '干活。',
      '',
      '- success -> done',
      '- fail -> done',
      '',
      '## @end done',
      '',
      'ok',
    );

  for (const bad of ['mcp', 'shell', 'read,mcp', 'read,shell,url']) {
    // 连"不提供上限"的结构校验场景也要拒绝
    const hit = ok(withTools(bad)).issues.find((i) => i.code === 'agent-tools-forbidden');
    assert.ok(hit, `tools: ${bad} 必须报 agent-tools-forbidden`);
    assert.match(hit!.message, /永久禁止/);
    assert.match(hit!.message, /@action/, '要指出业务动作该走哪里');
    assert.ok(
      !ok(withTools(bad)).issues.some((i) => i.code === 'agent-tools-widens'),
      '不该同时报成"超出配置上限"—— 那会让人以为改配置就能放开',
    );
  }

  // 合法的收窄照常通过
  assert.deepEqual(ok(withTools('read,write,url'), { agentTools: ['read', 'write', 'url'] }).issues, []);
});

test('校验：@agent 的 output 必须是已注册的完成契约，且可被要求必填', () => {
  const md = flow(
    '## @flow demo',
    '',
    'start -> work',
    '',
    '## @agent work',
    '',
    'output: research.brief',
    '',
    '干活。',
    '',
    '- success -> done',
    '- fail -> done',
    '',
    '## @end done',
    '',
    'ok',
  );

  const withOutput = { ...ALL_REGISTERED, hasOutput: (n: string) => n === 'research.brief' };
  const r = ok(md, { registry: withOutput });
  assert.deepEqual(r.issues, []);
  assert.equal(r.definition!.nodes['work']!.attrs.output, 'research.brief');

  // 未注册的契约 → SKILL.md 不能自己定义"什么叫做完了"
  const missing = ok(md, { registry: { ...ALL_REGISTERED, hasOutput: () => false } }).issues.find(
    (i) => i.code === 'registry-missing-output',
  );
  assert.ok(missing);
  assert.match(missing!.message, /不能自己定义/);

  // requireAgentOutput：没写 output 的 @agent 直接报错（生产默认配置）
  const noOutput = flow(
    '## @flow demo',
    '',
    'start -> work',
    '',
    '## @agent work',
    '',
    '干活。',
    '',
    '- success -> done',
    '- fail -> done',
    '',
    '## @end done',
    '',
    'ok',
  );
  const required = ok(noOutput, { registry: withOutput, requireAgentOutput: true }).issues.find(
    (i) => i.code === 'agent-output-missing',
  );
  assert.ok(required, '开启 requireAgentOutput 后没写契约必须报错');
  assert.match(required!.message, /output:/);
  // 校验器**选项**的缺省仍然是不要求：这里测的是纯函数，是否要求由调用方决定
  // （生产 wiring 传的是 config.workflowRequireAgentOutput，那个默认是 true）
  assert.deepEqual(ok(noOutput, { registry: withOutput }).issues, []);
});

test('校验：@gate 不接受任何属性（语义完全由服务端决定）', () => {
  const r = ok(
    flow(
      '## @flow demo',
      '',
      'start -> check',
      '',
      '## @gate check',
      '',
      'role: risk',
      '',
      '判断。',
      '',
      '- pass -> done',
      '',
      '## @end done',
      '',
      'ok',
    ),
    { registry: { ...ALL_REGISTERED, gateOutcomes: () => ['pass'] } },
  );
  assert.ok(
    r.issues.some((i) => i.code === 'block-attr-unsupported'),
    '往 gate 上写属性必须报错（写了也不会有任何效果）',
  );
});

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseSkillFlow } from '../src/skills/flow-parser.js';
import { validateSkillFlow } from '../src/skills/flow-validator.js';
import { analyzeFlow } from '../src/skills/flow-analyzer.js';
import type { FlowDefinition } from '../src/workflow/types.js';

/**
 * 控制流分析：`FlowDefinition` → 图的问题。
 *
 * 这一层与校验器是**两个不同的变化轴**：
 *   校验器  跟着授权模型走（角色怎么映射、票数能不能降、能力边界多宽）
 *   分析器  跟着业务建模需求走（能不能走到终点、有没有走不出去的分支）
 *
 * 所以这里的用例既测"报得对不对"，也测"**不该报的时候不报**"：
 *   - 环本身不报错（research ⇄ review 是常态），只有**没有出口的环**才报
 *   - 不可达的节点只报一次（不再叠一条"走不出去"—— 它根本不会被执行）
 */

const def = (md: string): FlowDefinition => {
  const validated = validateSkillFlow(parseSkillFlow(md));
  assert.ok(validated.definition, `这段流程应当通过校验：${JSON.stringify(validated.issues)}`);
  return validated.definition;
};

const flow = (...lines: string[]): string => lines.join('\n');

const codes = (md: string): string[] => analyzeFlow(def(md)).map((i) => i.code).sort();

test('分析：从 start 走不到的节点报 node-unreachable', () => {
  const issues = analyzeFlow(
    def(
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
    ),
  );
  const hit = issues.find((i) => i.code === 'node-unreachable');
  assert.ok(hit, '没人指向的节点必须报错');
  assert.equal(hit!.nodeId, 'lonely');
  assert.equal(hit!.severity, undefined, '缺省即 error（阻断执行）');
});

test('分析：走进没有出口的环 → no-terminal-path（这才是真正要拦的"死循环"）', () => {
  const issues = analyzeFlow(
    def(
      flow(
        '## @flow demo',
        '',
        'start -> a',
        '',
        '## @agent a',
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
        'ok',
      ),
    ),
  );
  const trapped = issues.filter((i) => i.code === 'no-terminal-path').map((i) => i.nodeId).sort();
  assert.deepEqual(trapped, ['a', 'b'], '环里每个节点都到不了终态，全体报错');
  const hit = issues.find((i) => i.code === 'no-terminal-path')!;
  assert.match(hit.message, /@end \/ @stop/);
  assert.equal(hit.line, 5, '指到节点标题行');
});

test('分析：**有出口的环不报**（打回重做是研究流程的常态，不能按 DAG 判）', () => {
  assert.deepEqual(
    codes(
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
        '',
        '## @end done',
        '',
        'ok',
      ),
    ),
    [],
    'research ⇄ review 构成环，但 review 能到 @end —— 这是合法流程',
  );
});

test('分析：@end 存在却没人指向它 → 只报 node-unreachable，不叠一条"到不了 @end"', () => {
  const issues = analyzeFlow(
    def(
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
        '失败。',
        '',
        '## @end done',
        '',
        '完成。',
      ),
    ),
  );
  assert.deepEqual(
    issues.map((i) => `${i.code}:${i.nodeId}`).sort(),
    ['node-unreachable:done'],
    '同一个问题只说一遍：@end 到不了 ⇔ 它不可达，再说一次只会让人以为有两处要改',
  );
});

test('分析：整条流程没有任何 @end → no-success-path，且只是 warning（不阻断）', () => {
  const issues = analyzeFlow(
    def(
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
        '失败。',
      ),
    ),
  );
  const hit = issues.find((i) => i.code === 'no-success-path');
  assert.ok(hit, '一条只能以 @stop 收尾的流程值得提醒一句 —— 但它是合法形状');
  assert.equal(hit!.severity, 'warning');
  assert.equal(hit!.nodeId, 'work', '指到入口节点，作者从这里开始看');
});

test('分析：不可达的节点只报一次（不再叠一条"走不出去"）', () => {
  const issues = analyzeFlow(
    def(
      flow(
        '## @flow demo',
        '',
        'start -> work',
        '',
        '## @agent work',
        '',
        '- success -> done',
        '- fail -> failed',
        '',
        '## @gate lonely',
        '',
        '- pass -> lonely',
        '',
        '## @stop failed',
        '',
        '失败。',
        '',
        '## @end done',
        '',
        '完成。',
      ),
    ),
  );
  assert.deepEqual(
    issues.map((i) => `${i.code}:${i.nodeId}`).sort(),
    ['node-unreachable:lonely'],
    '不可达节点根本不会被执行，再叠一条"走不出去"只是噪音',
  );
});

test('分析：start 指向不存在的节点时不报图的问题（那是校验器的 start-missing-node）', () => {
  const ast = parseSkillFlow(
    flow(
      '## @flow demo',
      '',
      'start -> nowhere',
      '',
      '## @end done',
      '',
      'ok',
    ),
  );
  const validated = validateSkillFlow(ast);
  assert.equal(
    validated.definition,
    undefined,
    '入口解析不了 → 校验器直接拦下（error），流水线根本走不到分析器',
  );
  assert.ok(validated.issues.some((i) => i.code === 'start-missing-node'));

  // 分析器本身也要扛得住这种输入（定义可能被手工构造 / 从别处注入）：
  // 没有入口就没有图，不该跟着报一堆"不可达"。
  const dangling: FlowDefinition = {
    id: 'demo',
    start: 'nowhere',
    nodes: {
      done: {
        id: 'done',
        type: 'end',
        body: 'ok',
        attrs: {},
        routes: [],
        headingLine: 5,
        startLine: 7,
        endLine: 7,
      },
    },
  };
  assert.deepEqual(analyzeFlow(dangling), []);
});

test('分层边界：校验器**不做**图的分析（可达性/终态可达性都归分析器）', () => {
  const md = flow(
    '## @flow demo',
    '',
    'start -> a',
    '',
    '## @agent a',
    '',
    '- success -> b',
    '- fail -> b',
    '',
    '## @gate b',
    '',
    '- pass -> a',
    '',
    '## @gate lonely',
    '',
    '- pass -> lonely',
  );
  const validated = validateSkillFlow(parseSkillFlow(md));
  assert.ok(validated.definition, '每条边都合法 → 校验器放行（它只看单条边，不看整张图）');
  const validatorCodes = validated.issues.map((i) => i.code);
  assert.ok(!validatorCodes.includes('node-unreachable'), '可达性不该由校验器回答');
  assert.ok(!validatorCodes.includes('no-terminal-path'), '终态可达性不该由校验器回答');
  assert.ok(
    analyzeFlow(validated.definition).length > 0,
    '同样这份定义，分析器必须看出问题 —— 证明两个职责真的分开了',
  );
});

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { ActionService } from '../src/actions/action-service.js';
import { ApprovalService } from '../src/approval/approval-service.js';
import { ExecutionService } from '../src/execution/execution-service.js';
import {
  MemoryEventRepository,
  MemoryExecutionRepository,
} from '../src/execution/memory-repository.js';
import { EXECUTION_EVENT_TYPES as EVT } from '../src/execution/types.js';
import { HumanTaskService } from '../src/human-tasks/human-task-service.js';
import { MemoryHumanTaskRepository } from '../src/human-tasks/memory-repository.js';
import {
  registerFlowAction,
  registerFlowGate,
  registerFlowReview,
} from '../src/workflow/registry.js';
import { registerBusinessRole } from '../src/identity/business-roles.js';
import { FlowValidationError, WorkflowRunner } from '../src/workflow/runner.js';
import type { WorkflowState } from '../src/workflow/types.js';

/**
 * WorkflowRunner 端到端（内存仓储 + 假 turn，不拉 Copilot runtime）。
 *
 * 要证明的是编排本身：
 *   - @agent → @gate → @review（暂停等人工）→ 审批后续跑 → @action（再暂停）→ @end
 *   - 两条恢复路径（评审 / 动作审批）都能从 durable 状态接上
 *   - 失败与拒绝走到 @stop，execution 落 failed 而不是卡在中间
 *   - 环有步数上限兜底（否则 review 一直打回会把 execution 跑成死循环）
 *   - SKILL.md 中途被改过 → 拒绝继续，而不是悄悄换一版流程
 */

const SKILL_MD = `---
name: flow-demo
description: 编排测试用技能
---

# Flow Demo

## @flow demo

start -> flow-demo

## @agent flow-demo

做研究，输出带证据的结论。

- success -> demo-gate
- fail -> failed

## @gate demo-gate

确定性判断。

- pass -> demo-review
- fail -> failed

## @review demo-review

人工审核。

- approve -> demo-action
- reject -> failed

## @action demo-action

发布。

- success -> done
- fail -> failed

## @stop failed

失败终止。

## @end done

完成。
`;

/** 自环流程：gate 永远返回 again，用来看步数上限兜底 */
const SPIN_MD = `---
name: flow-spin
description: 环不收敛
---

## @flow spin

start -> demo-spin

## @gate demo-spin

永远再来一次。

- again -> demo-spin
`;

/** 出口写错：@action 只写了 success（校验器必须在跑之前拦住） */
const BROKEN_MD = `---
name: flow-broken
description: 缺出口
---

## @flow broken

start -> demo-action

## @action demo-action

- success -> done

## @end done

ok
`;

/** 旧名 `@subagent`：已经写好的 SKILL.md 不该因为一次改名就整片校验失败 */
const LEGACY_MD = SKILL_MD.replace('## @agent flow-demo', '## @subagent flow-demo');

/**
 * 保留属性：`@review` 声明**业务角色**（不是 AD Group），`@action` 把审批资格收窄。
 * 校验器要求 role 必须已登记，所以在用例里注册一个（组 ID 用可读串，等价于 Entra object ID）。
 */
const ROLE_MD = `---
name: flow-role
description: 保留属性用
---

## @flow demo

start -> flow-role

## @agent flow-role

做研究。

- success -> demo-review
- fail -> failed

## @review demo-review

role: demo.reviewer
strategy: ANY
required: 1
exclude: initiator

人工审核。

- approve -> demo-action
- reject -> failed

## @action demo-action

role: operations

发布。

- success -> done
- fail -> failed

## @stop failed

失败终止。

## @end done

完成。
`;

/** `@action role:` 写了一个策略里没有的角色 → 收窄成空集 → 动作被拒（不能放宽） */
const BAD_ROLE_MD = `---
name: flow-bad-role
description: 角色越界
---

## @flow demo

start -> flow-bad-role

## @agent flow-bad-role

做研究。

- success -> demo-action
- fail -> failed

## @action demo-action

role: demo.reviewer

发布。

- success -> done
- fail -> failed

## @stop failed

失败终止。

## @end done

完成。
`;

function writeSkills(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'copilot-flow-'));
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(dir, rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  return dir;
}

/** 门禁结果由用例控制：默认 pass */
let gateOutcome = 'pass';
/** 假 turn 记录收到的 prompt，并可被要求抛错 */
let turnBehavior: (prompt: string, index: number) => { content: string; chars: number } = (
  _p,
  i,
) => ({ content: `研究结论 ${i}`, chars: 20 });
let turnError: string | undefined;
const seenPrompts: string[] = [];

registerFlowGate({
  name: 'demo-gate',
  async evaluate() {
    return { outcome: gateOutcome, reason: `gate 判定 ${gateOutcome}` };
  },
});

registerFlowGate({
  name: 'demo-spin',
  async evaluate() {
    return { outcome: 'again' };
  },
});

registerFlowReview({
  name: 'demo-review',
  title: '示例审核',
  description: '看看结论',
  eligibleRoles: ['reviewer'],
  strategy: 'ANY',
  requiredCount: 1,
});

registerFlowAction({
  name: 'demo-action',
  // 复用已登记策略与 executor 的真实动作类型（未登记的动作会被 ActionService 默认拒绝）
  actionType: 'send_external_message',
  buildIntent: (ctx) => ({
    actionType: 'send_external_message',
    target: { type: 'report', id: 'r-1' },
    parameters: { to: 'compliance@example.com', body: `发布 ${ctx.skill}/${ctx.nodeId}` },
    requestedBy: { userId: ctx.initiatorId, tenantId: ctx.tenantId },
    createdAt: new Date().toISOString(),
  }),
});

/**
 * 业务角色 → AD group object ID。
 * 用例用可读串代替 GUID：映射逻辑与真实 object ID 完全一致（都是不透明字符串）。
 */
registerBusinessRole({
  id: 'demo.reviewer',
  name: '示例审核人',
  groups: ['grp-demo-reviewers'],
  match: 'ANY',
});

const ALICE = { tenantId: 't1', userId: 'alice' };
/** 审核人：不是会话 owner，也不是发起人（SoD） */
const REVIEWER = { tenantId: 't1', userId: 'bob', roles: ['reviewer'] };
/**
 * 走 AD group 授权的审核人：**没有** `roles`，只有 group object ID。
 * 他能不能批完全取决于 RoleRegistry 把 demo.reviewer 映射到哪个组。
 */
const REVIEWER_BY_GROUP = { tenantId: 't1', userId: 'dave', roles: [], groups: ['grp-demo-reviewers'] };
const OPS = { tenantId: 't1', userId: 'carol', roles: ['operations'] };

interface Wired {
  executions: ExecutionService;
  humanTasks: HumanTaskService;
  runner: WorkflowRunner;
}

function wire(dir: string): Wired {
  const approval = new ApprovalService({ allowInitiatorApproval: false });
  const actions = new ActionService({ approval });
  const executions = new ExecutionService({
    repository: new MemoryExecutionRepository(),
    events: new MemoryEventRepository(),
    actions,
  });
  const humanTasks = new HumanTaskService({
    repository: new MemoryHumanTaskRepository(),
    approval,
    // 与 wiring.ts 里的分派一致：workflow 任务交回编排器，其余仍走 ExecutionService
    onResolved: (task, resolution, decisions) => {
      if (task.payload?.workflow) return runner.onHumanTaskResolved(task, resolution, decisions);
      return executions.onHumanTaskResolved(task, resolution, decisions);
    },
  });
  executions.bindHumanTasks(humanTasks);
  const runner = new WorkflowRunner({
    executions,
    humanTasks,
    skillDirs: [dir],
    runTurn: async ({ prompt }) => {
      const index = seenPrompts.push(prompt);
      if (turnError) throw new Error(turnError);
      return turnBehavior(prompt, index);
    },
  });
  return { executions, humanTasks, runner };
}

/** 按 SKILL.md 的真实内容建一个 workflow execution（sourceHash 取自文件） */
async function startWorkflow(
  w: Wired,
  opts: { skill?: string; flow?: string; input?: unknown } = {},
): Promise<string> {
  const prepared = w.runner.prepare({ skill: opts.skill ?? 'flow-demo', flow: opts.flow ?? 'demo' });
  const workflow: WorkflowState = {
    skill: prepared.skill.meta.name,
    flow: prepared.definition.id,
    sourceHash: prepared.skill.sourceHash,
    current: prepared.definition.start,
    steps: 0,
  };
  const exec = await w.executions.create({
    sessionId: 's1',
    owner: ALICE,
    initiatedByUserId: 'alice',
    kind: 'workflow',
    ...(opts.input !== undefined ? { input: opts.input } : {}),
    workflow,
  });
  await w.executions.start(exec.executionId);
  return exec.executionId;
}

const eventTypes = async (w: Wired, id: string): Promise<string[]> =>
  (await w.executions.events(id, 200)).map((e) => e.type);

/** runDetached 是 fire-and-forget：轮询等它自己收尾（不用 sleep 硬等） */
async function waitFor(check: () => Promise<boolean>, ms = 1000): Promise<boolean> {
  const deadline = Date.now() + ms;
  for (;;) {
    if (await check()) return true;
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, 5));
  }
}

test.beforeEach(() => {
  gateOutcome = 'pass';
  turnError = undefined;
  seenPrompts.length = 0;
  turnBehavior = (_p, i) => ({ content: `研究结论 ${i}`, chars: 20 });
});

test('编排：agent → gate → review 暂停 → 审批续跑 → action 再暂停 → 审批 → 完成', async () => {
  const dir = writeSkills({ 'flow-demo/SKILL.md': SKILL_MD });
  const w = wire(dir);
  const id = await startWorkflow(w, { input: { securityId: 'AAPL' } });

  // 跑到 @review 暂停
  await w.runner.run(id);
  let rec = (await w.executions.get(id))!;
  assert.equal(rec.status, 'waiting_for_approval', '遇到 @review 必须停下来等人工');
  assert.equal(rec.workflow?.current, 'demo-review');
  assert.ok(rec.workflow?.waitingTaskId, '要记下在等哪个任务（重启后才能接上）');
  assert.equal(rec.workflow?.steps, 2, 'work + check 已推进两步');
  assert.deepEqual(seenPrompts.length, 1, '@agent 只跑一次 agent turn');
  assert.match(seenPrompts[0]!, /做研究，输出带证据的结论/, '@agent 的 prompt 就是节点正文');

  const reviewTask = (await w.humanTasks.get(rec.workflow!.waitingTaskId!))!;
  assert.equal(reviewTask.type, 'approval');
  assert.deepEqual(reviewTask.eligibleRoles, ['reviewer'], '资格来自服务端注册，不来自 SKILL.md');
  assert.deepEqual(reviewTask.payload['workflow'], {
    executionId: id,
    nodeId: 'demo-review',
    kind: 'review',
  });

  // 审核通过 → 自动续跑到 @action 的审批
  await w.humanTasks.approve(reviewTask.taskId, { principal: REVIEWER });
  rec = (await w.executions.get(id))!;
  assert.equal(rec.status, 'waiting_for_approval', '@action 需要审批 → 再次暂停');
  assert.equal(rec.workflow?.current, 'demo-action');
  assert.equal(rec.workflow?.lastOutcome, 'approve');

  const actionTask = (await w.humanTasks.get(rec.workflow!.waitingTaskId!))!;
  assert.equal(actionTask.payload['actionType'], 'send_external_message');
  assert.deepEqual(actionTask.payload['workflow'], {
    executionId: id,
    nodeId: 'demo-action',
    kind: 'action',
  });

  // 动作审批通过 → 执行 → @end
  await w.humanTasks.approve(actionTask.taskId, { principal: OPS });
  rec = (await w.executions.get(id))!;
  assert.equal(rec.status, 'completed', '流程走到 @end 应当收尾成 completed');
  assert.equal(rec.workflow?.current, 'done');
  assert.equal(rec.workflow?.waitingTaskId, undefined);
  assert.equal(rec.workflow?.steps, 5, 'work/check/reviewer/act/done');
  assert.deepEqual((rec.result as { workflow: { flow: string } }).workflow.flow, 'demo');

  const types = await eventTypes(w, id);
  for (const expected of [
    EVT.workflowStarted,
    EVT.workflowStepStarted,
    EVT.workflowStepCompleted,
    EVT.workflowWaiting,
    EVT.workflowResumed,
    EVT.workflowCompleted,
    EVT.humanTaskCreated,
    EVT.waitingForApproval,
    EVT.actionExecuted,
    EVT.completed,
  ]) {
    assert.ok(types.includes(expected), `审计时间线缺少 ${expected}`);
  }
  // 每一步的出口都留了痕（节点级审计）
  const outcomes = (await w.executions.events(id, 200))
    .filter((e) => e.type === EVT.workflowStepCompleted)
    .map((e) => `${String(e.payload?.['nodeId'])}:${String(e.payload?.['outcome'])}`);
  assert.deepEqual(outcomes, [
    'flow-demo:success',
    'demo-gate:pass',
    'demo-review:approve',
    'demo-action:success',
    'done:completed',
  ]);
});

test('编排：审核拒绝走到 @stop，execution 落 failed 而不是卡在中间', async () => {
  const dir = writeSkills({ 'flow-demo/SKILL.md': SKILL_MD });
  const w = wire(dir);
  const id = await startWorkflow(w);

  await w.runner.run(id);
  const rec = (await w.executions.get(id))!;
  await w.humanTasks.reject(rec.workflow!.waitingTaskId!, { principal: REVIEWER, comment: '证据不足' });

  const after = (await w.executions.get(id))!;
  assert.equal(after.status, 'failed');
  assert.match(String(after.error), /失败终止/);
  assert.ok((await eventTypes(w, id)).includes(EVT.workflowFailed));
});

test('编排：gate 判 fail → 走 @stop（确定性判断真的会改变走向）', async () => {
  gateOutcome = 'fail';
  const dir = writeSkills({ 'flow-demo/SKILL.md': SKILL_MD });
  const w = wire(dir);
  const id = await startWorkflow(w);

  await w.runner.run(id);
  const rec = (await w.executions.get(id))!;
  assert.equal(rec.status, 'failed');
  assert.equal(rec.workflow?.lastOutcome, 'fail');
  const gateEvent = (await w.executions.events(id, 200)).find(
    (e) => e.type === EVT.workflowStepCompleted && e.payload?.['nodeId'] === 'demo-gate',
  );
  assert.equal(gateEvent?.payload?.['outcome'], 'fail');
  assert.match(String(gateEvent?.payload?.['reason']), /gate 判定 fail/, 'gate 的理由要进审计');
});

test('编排：@agent 抛错是**可路由**的失败，不是编排器崩溃', async () => {
  turnError = 'runtime 挂了';
  const dir = writeSkills({ 'flow-demo/SKILL.md': SKILL_MD });
  const w = wire(dir);
  const id = await startWorkflow(w);

  await w.runner.run(id);
  const rec = (await w.executions.get(id))!;
  assert.equal(rec.status, 'failed', '走 - fail -> failed 而不是抛出去');
  const failed = (await w.executions.events(id, 200)).find(
    (e) => e.type === EVT.workflowStepCompleted && e.payload?.['nodeId'] === 'flow-demo',
  );
  assert.equal(failed?.payload?.['outcome'], 'fail');
  assert.match(String(failed?.payload?.['error']), /runtime 挂了/);
});

test('编排：环不收敛时由步数上限兜底（不然 review 一直打回会跑成死循环）', async () => {
  const dir = writeSkills({ 'flow-spin/SKILL.md': SPIN_MD });
  const w = wire(dir);
  const id = await startWorkflow(w, { skill: 'flow-spin', flow: 'spin' });

  await w.runner.run(id);
  const rec = (await w.executions.get(id))!;
  assert.equal(rec.status, 'failed');
  assert.match(String(rec.error), /步数上限/);
  assert.equal(rec.workflow?.steps, 100, '停在步数上限，不是无限跑');
});

test('编排：SKILL.md 中途被改过 → 拒绝继续（不能悄悄换一版流程）', async () => {
  const dir = writeSkills({ 'flow-demo/SKILL.md': SKILL_MD });
  const w = wire(dir);
  const id = await startWorkflow(w);

  // 建完 execution 之后有人改了技能文件
  writeFileSync(path.join(dir, 'flow-demo/SKILL.md'), SKILL_MD.replace('做研究', '改成别的事'));

  await w.runner.run(id);
  const rec = (await w.executions.get(id))!;
  assert.equal(rec.status, 'failed');
  assert.match(String(rec.error), /SKILL\.md 已被修改/);
  assert.equal(seenPrompts.length, 0, '版本对不上时一步都不该跑');
});

test('编排：自动放行的动作不再暂停，直接走到 @end', async () => {
  process.env.COPILOT_AUTO_APPROVE_ACTIONS = 'send_external_message';
  try {
    const dir = writeSkills({ 'flow-demo/SKILL.md': SKILL_MD });
    const w = wire(dir);
    const id = await startWorkflow(w);
    await w.runner.run(id);
    const paused = (await w.executions.get(id))!;
    await w.humanTasks.approve(paused.workflow!.waitingTaskId!, { principal: REVIEWER });

    const rec = (await w.executions.get(id))!;
    assert.equal(rec.status, 'completed', 'auto_approve 的动作不该再开人工任务');
    const autoEvent = (await w.executions.events(id, 200)).find(
      (e) => e.type === EVT.workflowStepCompleted && e.payload?.['nodeId'] === 'demo-action',
    );
    assert.equal(autoEvent?.payload?.['decision'], 'auto_approve');
  } finally {
    delete process.env.COPILOT_AUTO_APPROVE_ACTIONS;
  }
});

test('编排：旧名 @subagent 与 @agent 等价（改名不让已写好的 SKILL.md 失效）', async () => {
  const dir = writeSkills({ 'flow-demo/SKILL.md': LEGACY_MD });
  const w = wire(dir);
  const id = await startWorkflow(w);

  await w.runner.run(id);
  const rec = (await w.executions.get(id))!;
  assert.equal(rec.status, 'waiting_for_approval', '旧名照样能跑起来');
  assert.equal(rec.workflow?.current, 'demo-review');
});

test('编排：每一步**先把 stepStatus=running 落库、再执行**，执行完才落 pending', async () => {
  const dir = writeSkills({ 'flow-demo/SKILL.md': SKILL_MD });
  const w = wire(dir);
  const writes: Array<{ current: string; stepStatus?: string }> = [];
  const orig = w.executions.updateWorkflowState.bind(w.executions);
  w.executions.updateWorkflowState = async (id, state) => {
    writes.push({
      current: state.current,
      ...(state.stepStatus ? { stepStatus: state.stepStatus } : {}),
    });
    return orig(id, state);
  };

  const id = await startWorkflow(w);
  await w.runner.run(id);

  assert.deepEqual(writes, [
    { current: 'flow-demo', stepStatus: 'running' },
    { current: 'demo-gate', stepStatus: 'pending' },
    { current: 'demo-gate', stepStatus: 'running' },
    { current: 'demo-review', stepStatus: 'pending' },
    { current: 'demo-review', stepStatus: 'running' },
    { current: 'demo-review', stepStatus: 'waiting' },
  ]);
  assert.equal((await w.executions.get(id))!.workflow?.stepStatus, 'waiting');
});

test('编排：crash 在 @agent 中途 → 允许重放（纯计算），但要留审计', async () => {
  const dir = writeSkills({ 'flow-demo/SKILL.md': SKILL_MD });
  const w = wire(dir);
  const id = await startWorkflow(w);

  // 模拟"进程在 @agent 节点执行到一半被杀"：durable 状态停在 running
  const rec0 = (await w.executions.get(id))!;
  await w.executions.updateWorkflowState(id, { ...rec0.workflow!, stepStatus: 'running' });

  await w.runner.run(id);
  const rec = (await w.executions.get(id))!;
  assert.equal(rec.status, 'waiting_for_approval', '@agent 重放后照常推进');
  assert.ok(
    (await eventTypes(w, id)).includes(EVT.workflowStepInterrupted),
    '重放必须在时间线上留痕',
  );
  assert.equal(seenPrompts.length, 1);
});

test('编排：crash 在 @action 中途 → **不重放**，落 failed 交人工核对（不能重复提交）', async () => {
  const dir = writeSkills({ 'flow-demo/SKILL.md': SKILL_MD });
  const w = wire(dir);
  const id = await startWorkflow(w);

  const rec0 = (await w.executions.get(id))!;
  await w.executions.updateWorkflowState(id, {
    ...rec0.workflow!,
    current: 'demo-action',
    stepStatus: 'running',
    steps: 3,
  });

  await w.runner.run(id);
  const rec = (await w.executions.get(id))!;
  assert.equal(rec.status, 'failed', '有副作用的步骤不能自动重放');
  assert.match(String(rec.error), /未确认完成/);
  assert.match(String(rec.error), /幂等键/, '要告诉运维去哪里核对');
  assert.ok((await eventTypes(w, id)).includes(EVT.workflowStepInterrupted));
});

test('编排：未预期异常也必须落 failed，不能留下永远 running 的 execution', async () => {
  const dir = writeSkills({ 'flow-demo/SKILL.md': SKILL_MD });
  const w = wire(dir);
  const id = await startWorkflow(w);

  // 模拟推进途中的未预期异常（registry / DB / transition 都可能这样炸）
  w.executions.updateWorkflowState = async () => {
    throw new Error('DB 挂了');
  };

  w.runner.runDetached((await w.executions.get(id))!);

  const settled = await waitFor(async () => (await w.executions.get(id))?.status === 'failed');
  assert.ok(settled, 'runDetached 必须自己收尾，否则 execution 永远卡在 running');
  assert.match(String((await w.executions.get(id))!.error), /DB 挂了/);
});

test('编排：@review 的 role 覆盖注册表，且走 AD group 的人能批、只有旧角色的人不能', async () => {
  const dir = writeSkills({ 'flow-role/SKILL.md': ROLE_MD });
  const w = wire(dir);
  const id = await startWorkflow(w, { skill: 'flow-role' });

  await w.runner.run(id);
  const rec = (await w.executions.get(id))!;
  assert.equal(rec.status, 'waiting_for_approval');
  const task = (await w.humanTasks.get(rec.workflow!.waitingTaskId!))!;
  assert.deepEqual(
    task.eligibleRoles,
    ['demo.reviewer'],
    'SKILL.md 的 role: 覆盖注册表的 eligibleRoles —— 属性是流程自己的声明',
  );
  assert.equal(task.strategy, 'ANY');
  assert.equal(task.requiredCount, 1);

  // 注册表里的旧角色不再有资格：属性一旦写进 SKILL.md，就是唯一的角色来源。
  // 挡住他的是**可见性**判定（isAssignee）—— 他连这个任务都看不到，比"看得到但点不动"更严
  await assert.rejects(
    () => w.humanTasks.approve(task.taskId, { principal: REVIEWER }),
    /不在 eligible 范围内/,
  );
  assert.deepEqual(
    await w.humanTasks.list({ tenantId: 't1', userId: 'bob', roles: ['reviewer'] }),
    [],
    '没有对应业务角色的人，"我的任务"里不该出现这条',
  );

  // 只有 group、没有 roles 的人：RoleRegistry 把他解析成 demo.reviewer 之后就能批
  await w.humanTasks.approve(task.taskId, { principal: REVIEWER_BY_GROUP });
  const after = (await w.executions.get(id))!;
  assert.equal(after.status, 'waiting_for_approval', '@action 的 role: 把它收窄到 operations → 再暂停');
  assert.equal(after.workflow?.lastOutcome, 'approve');

  const actionTask = (await w.humanTasks.get(after.workflow!.waitingTaskId!))!;
  assert.deepEqual(
    actionTask.eligibleRoles,
    ['operations'],
    '@action role: 只收窄（策略里本来就有 operations）',
  );

  await w.humanTasks.approve(actionTask.taskId, { principal: OPS });
  assert.equal((await w.executions.get(id))!.status, 'completed');
});

test('编排：@action 声明了角色就不能被 auto_approve 绕过（流程写明的审批要求优先）', async () => {
  process.env.COPILOT_AUTO_APPROVE_ACTIONS = 'send_external_message';
  try {
    const dir = writeSkills({ 'flow-role/SKILL.md': ROLE_MD });
    const w = wire(dir);
    const id = await startWorkflow(w, { skill: 'flow-role' });

    await w.runner.run(id);
    const paused = (await w.executions.get(id))!;
    await w.humanTasks.approve(paused.workflow!.waitingTaskId!, { principal: REVIEWER_BY_GROUP });

    const rec = (await w.executions.get(id))!;
    assert.equal(
      rec.status,
      'waiting_for_approval',
      '环境变量不该绕过 SKILL.md 里写明的角色要求',
    );
    assert.equal(rec.workflow?.current, 'demo-action');
  } finally {
    delete process.env.COPILOT_AUTO_APPROVE_ACTIONS;
  }
});

test('编排：@action role: 越界（策略里没有这个角色）→ 动作被拒，不能靠 Skill 放宽授权', async () => {
  const dir = writeSkills({ 'flow-bad-role/SKILL.md': BAD_ROLE_MD });
  const w = wire(dir);
  const id = await startWorkflow(w, { skill: 'flow-bad-role' });

  await w.runner.run(id);
  const rec = (await w.executions.get(id))!;
  assert.equal(rec.status, 'failed', '走 - fail -> failed');
  const denied = (await w.executions.events(id, 200)).find(
    (e) => e.type === EVT.workflowStepCompleted && e.payload?.['nodeId'] === 'demo-action',
  );
  assert.equal(denied?.payload?.['decision'], 'denied');
  assert.match(String(denied?.payload?.['reason']), /不能放宽/, '拒绝理由要说清是"收窄 vs 放宽"');
});

test('校验：出口写漏 / 技能不存在都在 prepare 阶段就抛出来（含行号）', () => {
  const dir = writeSkills({ 'flow-broken/SKILL.md': BROKEN_MD });
  const w = wire(dir);

  const broken = w.runner.validate({ skill: 'flow-broken', flow: 'broken' });
  assert.equal(broken.ok, false);
  assert.ok(broken.issues.some((i) => i.code === 'node-missing-outcome'));
  assert.throws(
    () => w.runner.prepare({ skill: 'flow-broken', flow: 'broken' }),
    (err: unknown) => err instanceof FlowValidationError && /SKILL\.md:\d+/.test(String((err as Error).message)),
  );

  const missing = w.runner.validate({ skill: 'nope', flow: 'demo' });
  assert.equal(missing.ok, false);
  assert.equal(missing.issues[0]?.code, 'skill-missing');
});

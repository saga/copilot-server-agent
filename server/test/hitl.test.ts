import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ApprovalService } from '../src/approval/approval-service.js';
import { BUILTIN_POLICIES, evaluateApproval, resolvePolicy } from '../src/approval/approval-policy.js';
import type { ApprovalPolicy, HumanTaskDecision } from '../src/approval/types.js';
import { ActionService } from '../src/actions/action-service.js';
import { canonicalJson, hashAction, verifyActionHash } from '../src/execution/hash.js';
import { ExecutionService } from '../src/execution/execution-service.js';
import {
  MemoryEventRepository,
  MemoryExecutionRepository,
} from '../src/execution/memory-repository.js';
import { MemoryHumanTaskRepository } from '../src/human-tasks/memory-repository.js';
import { HumanTaskService } from '../src/human-tasks/human-task-service.js';
import type { ActionIntent } from '../src/execution/types.js';

const OWNER = { tenantId: 't1', userId: 'pm-1' };
const RISK = { tenantId: 't1', userId: 'risk-1', roles: ['risk'] };
const OPS = { tenantId: 't1', userId: 'ops-1', roles: ['operations'] };
const PM = { tenantId: 't1', userId: 'pm-1', roles: ['portfolio_manager'] };

const voteIntent = (over: Partial<ActionIntent> = {}): ActionIntent => ({
  actionType: 'submit_proxy_vote',
  target: { type: 'security', id: 'US1234567890' },
  parameters: { resolution: 'FOR', shares: 125000 },
  reason: 'agent recommends FOR',
  requestedBy: { userId: 'pm-1', tenantId: 't1' },
  createdAt: new Date().toISOString(),
  ...over,
});

/** 装配一套 execution + human task + approval（与 wiring.ts 一致，只是仓储换内存） */
function wire() {
  const approval = new ApprovalService({ allowInitiatorApproval: false });
  const actions = new ActionService({ approval });
  const execution = new ExecutionService({
    repository: new MemoryExecutionRepository(),
    events: new MemoryEventRepository(),
    actions,
  });
  const humanTasks = new HumanTaskService({
    repository: new MemoryHumanTaskRepository(),
    approval,
    onResolved: (task, resolution, decisions) =>
      execution.onHumanTaskResolved(task, resolution, decisions),
  });
  execution.bindHumanTasks(humanTasks);
  return { approval, actions, execution, humanTasks };
}

function decision(
  taskId: string,
  approverId: string,
  approverRole: string,
  kind: 'approve' | 'reject' = 'approve',
): HumanTaskDecision {
  return {
    decisionId: `dec_${approverId}`,
    taskId,
    approverId,
    approverRole,
    decision: kind,
    createdAt: new Date().toISOString(),
  };
}

test('策略裁决：ANY / ALL / N_OF_M / SEQUENTIAL 语义正确', () => {
  const anyPolicy: ApprovalPolicy = {
    policyId: 'p-any',
    actionType: 'x',
    strategy: 'ANY',
    eligibleRoles: ['risk', 'compliance'],
    allowInitiator: false,
  };
  assert.equal(evaluateApproval(anyPolicy, []).outcome, 'pending');
  assert.equal(evaluateApproval(anyPolicy, [decision('t', 'a', 'risk')]).outcome, 'approved');

  const allPolicy: ApprovalPolicy = { ...anyPolicy, policyId: 'p-all', strategy: 'ALL' };
  assert.equal(evaluateApproval(allPolicy, [decision('t', 'a', 'risk')]).outcome, 'pending');
  assert.equal(
    evaluateApproval(allPolicy, [decision('t', 'a', 'risk'), decision('t', 'b', 'compliance')])
      .outcome,
    'approved',
  );

  const nOfM: ApprovalPolicy = {
    ...anyPolicy,
    policyId: 'p-n',
    strategy: 'N_OF_M',
    requiredCount: 2,
    eligibleRoles: ['risk', 'compliance', 'ops'],
  };
  assert.equal(evaluateApproval(nOfM, [decision('t', 'a', 'risk')]).outcome, 'pending');
  assert.equal(
    evaluateApproval(nOfM, [decision('t', 'a', 'risk'), decision('t', 'b', 'compliance')]).outcome,
    'approved',
  );

  const seq: ApprovalPolicy = {
    ...anyPolicy,
    policyId: 'p-seq',
    strategy: 'SEQUENTIAL',
    eligibleRoles: ['portfolio_manager', 'risk', 'operations'],
  };
  const e1 = evaluateApproval(seq, [decision('t', 'pm', 'portfolio_manager')]);
  assert.equal(e1.outcome, 'pending');
  assert.equal(e1.nextRole, 'risk');
  const e2 = evaluateApproval(seq, [
    decision('t', 'pm', 'portfolio_manager'),
    decision('t', 'risk-1', 'risk'),
  ]);
  assert.equal(e2.nextRole, 'operations');
  assert.equal(
    evaluateApproval(seq, [
      decision('t', 'pm', 'portfolio_manager'),
      decision('t', 'risk-1', 'risk'),
      decision('t', 'ops-1', 'operations'),
    ]).outcome,
    'approved',
  );
  // 任一否决即 rejected（fail-closed）
  assert.equal(
    evaluateApproval(seq, [decision('t', 'pm', 'portfolio_manager', 'reject')]).outcome,
    'rejected',
  );
});

test('未登记的动作类型默认拒绝（不放 LLM 自己发明高风险动作）', () => {
  assert.equal(resolvePolicy('do_something_new'), null);
  const actions = new ActionService({
    approval: new ApprovalService({ allowInitiatorApproval: false }),
  });
  assert.equal(
    actions.classify(voteIntent({ actionType: 'wire_money' })).decision,
    'denied',
  );
  assert.ok(BUILTIN_POLICIES.some((p) => p.actionType === 'submit_proxy_vote'));
});

test('actionHash：内容变了必须重新审批', () => {
  const a = voteIntent();
  const b = voteIntent({ parameters: { resolution: 'AGAINST', shares: 999999 } });
  assert.equal(canonicalJson({ b: 1, a: 2 }), '{"a":2,"b":1}');
  const hash = hashAction(a);
  assert.equal(verifyActionHash(a, hash), true);
  assert.equal(verifyActionHash(b, hash), false);
  // createdAt 不进 hash：同一动作不同时间提出 hash 一致
  assert.equal(hashAction(voteIntent({ createdAt: '2020-01-01T00:00:00Z' })), hash);
});

test('SoD：发起人不能自批', async () => {
  const { approval } = wire();
  const policy = resolvePolicy('submit_proxy_vote')!;
  assert.throws(
    () =>
      approval.assertEligible({
        policy,
        principal: PM,
        initiatedBy: 'pm-1',
        decisions: [],
      }),
    /Separation of Duties/,
  );
  assert.throws(
    () => approval.assertEligible({ policy, principal: OPS, initiatedBy: 'pm-1', decisions: [] }),
    /顺序审批未轮到该角色/,
  );
  assert.deepEqual(
    approval.assertEligible({ policy, principal: PM, initiatedBy: 'other', decisions: [] }),
    { approverRole: 'portfolio_manager' },
  );
});

test('HITL 全链路：propose → 建审批 → 顺序审批通过 → hash 复核 → server 执行', async () => {
  const { execution, humanTasks } = wire();
  const exec = await execution.create({ sessionId: 's1', owner: OWNER, kind: 'job' });
  await execution.start(exec.executionId);

  const intent = voteIntent();
  const verdict = await execution.proposeAction(exec.executionId, intent);
  assert.equal(verdict.decision, 'needs_approval');
  assert.ok(verdict.taskId);

  const waiting = (await execution.get(exec.executionId))!;
  assert.equal(waiting.status, 'waiting_for_approval');
  assert.equal(waiting.waitReason, 'approval');
  assert.equal(waiting.actionHash, hashAction(intent));

  // 顺序审批：PM → risk → operations（发起人不能自批，所以这里由其他角色推进）
  await humanTasks.approve(verdict.taskId!, { principal: { ...PM, userId: 'pm-2' } });
  await humanTasks.approve(verdict.taskId!, { principal: RISK });
  const final = await humanTasks.approve(verdict.taskId!, { principal: OPS });
  assert.equal(final.evaluation.outcome, 'approved');

  const done = (await execution.get(exec.executionId))!;
  assert.equal(done.status, 'completed');
  const out = done.result as { receipt?: string };
  assert.match(String(out?.receipt ?? ''), /^vote_ex_/);

  const events = await execution.events(exec.executionId, 100);
  const types = events.map((e) => e.type);
  assert.ok(types.includes('agent.proposed_action'));
  assert.ok(types.includes('policy.approval_required'));
  assert.ok(types.includes('execution.waiting_for_approval'));
  assert.ok(types.includes('action.hash_verified'));
  assert.ok(types.includes('action.executed'));
  assert.ok(types.includes('execution.completed'));
});

test('HITL：审批后动作内容被改 → 拒绝执行并要求重新审批', async () => {
  const { execution, humanTasks } = wire();
  const exec = await execution.create({ sessionId: 's2', owner: OWNER, kind: 'job' });
  await execution.start(exec.executionId);

  const intent = voteIntent();
  const verdict = await execution.proposeAction(exec.executionId, intent);
  const taskId = verdict.taskId!;

  // 模拟 agent/系统在等待期间把动作改了（hash 失配）
  await execution
    .get(exec.executionId)
    .then(() =>
      humanTasks.approve(taskId, { principal: { ...PM, userId: 'pm-2' } }),
    );
  await humanTasks.approve(taskId, { principal: RISK });

  const rec = (await execution.get(exec.executionId))!;
  // 篡改 actionIntent（保留原 hash）后让最后一次审批通过
  await (execution as unknown as { deps: { repository: { update(id: string, patch: unknown): Promise<unknown> } } }).deps.repository.update(
    exec.executionId,
    {
      actionIntent: voteIntent({
        parameters: { resolution: 'AGAINST', shares: 100000 },
      }),
    },
  );
  const last = await humanTasks.approve(taskId, { principal: OPS });
  assert.equal(last.evaluation.outcome, 'approved');

  const after = (await execution.get(exec.executionId))!;
  assert.equal(after.status, 'waiting_for_approval', 'hash 失配应回到待审批而不是完成');
  assert.equal(after.actionHash, rec.actionHash, '批准的 hash 仍是旧值');
  assert.equal((after.actionIntent as ActionIntent).parameters.shares, 100000);
  const events = await execution.events(exec.executionId, 200);
  assert.ok(events.map((e) => e.type).includes('action.hash_mismatch'));
  // 重新审批会开新任务
  const tasks = await humanTasks.repository.list({ executionId: exec.executionId });
  assert.equal(tasks.length, 2);
});

test('HITL：否决 / 过期 → execution 落到 rejected / expired', async () => {
  const { execution, humanTasks } = wire();

  const rejected = await execution.create({ sessionId: 's3', owner: OWNER, kind: 'job' });
  await execution.start(rejected.executionId);
  const v1 = await execution.proposeAction(rejected.executionId, voteIntent());
  await humanTasks.reject(v1.taskId!, { principal: { ...PM, userId: 'pm-2' }, comment: 'no' });
  assert.equal((await execution.get(rejected.executionId))!.status, 'rejected');

  const expiring = await execution.create({ sessionId: 's4', owner: OWNER, kind: 'job' });
  await execution.start(expiring.executionId);
  const v2 = await execution.proposeAction(expiring.executionId, voteIntent());
  await humanTasks.repository.update(v2.taskId!, {
    expiresAt: new Date(Date.now() - 1000).toISOString(),
  });
  await humanTasks.sweepExpired();
  assert.equal((await execution.get(expiring.executionId))!.status, 'expired');
});

test('HITL：一人一票 + 委派留痕', async () => {
  const { execution, humanTasks } = wire();
  const exec = await execution.create({ sessionId: 's5', owner: OWNER, kind: 'job' });
  await execution.start(exec.executionId);
  const verdict = await execution.proposeAction(exec.executionId, voteIntent());
  const taskId = verdict.taskId!;

  await humanTasks.approve(taskId, { principal: { ...PM, userId: 'pm-2' } });
  await assert.rejects(
    () => humanTasks.approve(taskId, { principal: { ...PM, userId: 'pm-2' } }),
    /不能重复审批/,
  );

  const delegated = await humanTasks.delegate(taskId, {
    principal: RISK,
    toUserId: 'risk-2',
    reason: '休假代班',
  });
  assert.equal(delegated.delegatedTo, 'risk-2');
  assert.equal(delegated.delegationReason, '休假代班');
  assert.ok(delegated.delegatedAt);
});

test('人工输入：按 schema 校验，不接受自由文本', async () => {
  const { execution, humanTasks } = wire();
  const exec = await execution.create({ sessionId: 's6', owner: OWNER, kind: 'job' });
  await execution.start(exec.executionId);
  await execution.transition(exec.executionId, 'waiting_for_input', { waitReason: 'input' });

  const task = await humanTasks.createInputTask({
    executionId: exec.executionId,
    tenantId: OWNER.tenantId,
    title: '补充投票取向',
    inputSchema: {
      fields: [
        { name: 'vote', type: 'select', required: true, options: ['FOR', 'AGAINST', 'ABSTAIN'] },
        { name: 'comment', type: 'string', required: false },
      ],
    },
  });
  await assert.rejects(
    () => humanTasks.submitInput(task.taskId, { principal: PM, values: { vote: 'MAYBE' } }),
    /取值必须是/,
  );
  await assert.rejects(
    () => humanTasks.submitInput(task.taskId, { principal: PM, values: {} }),
    /缺少必填字段/,
  );
  const done = await humanTasks.submitInput(task.taskId, {
    principal: PM,
    values: { vote: 'FOR', comment: 'ok' },
  });
  assert.equal(done.status, 'approved');
  assert.deepEqual(done.inputValues, { vote: 'FOR', comment: 'ok' });
});

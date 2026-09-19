import { Router } from 'express';
import { z } from 'zod';
import {
  executionService,
  humanTaskService,
  sessionAccessService,
  sessionCoordinator,
  workflowRunner,
} from '../wiring.js';
import type { ActionIntent } from '../execution/types.js';
import type { WorkflowState } from '../workflow/types.js';
import { FlowValidationError } from '../workflow/runner.js';
import {
  actionSchema,
  assertSessionSendable,
  assertSessionVisible,
  principalOf,
  READ_ACCESS_DENIED,
  readAccess,
  sendServiceError,
  visibleSessionIds,
} from './shared.js';

export const executionRouter = Router();

const createSchema = z.object({
  sessionId: z.string().min(1),
  kind: z.enum(['interactive', 'job', 'workflow']).optional().default('job'),
  input: z.unknown().optional(),
  prompt: z.string().optional(),
  /** kind = 'workflow'：SKILL.md 所在的技能名 + 该技能里的 @flow id */
  skill: z.string().min(1).optional(),
  flow: z.string().min(1).optional(),
});

/** workflow 的推进说明在 SKILL.md 里，不需要 prompt；其余 kind 仍然必须给 */
const runSchema = z.object({ prompt: z.string().min(1).optional() });

/**
 * execution 的可见性跟着它所属的 session 走。
 *
 * 单租户（未开身份头）不分租户，保持本地开发直接可用；
 * 多租户下按「自己拥有的 + 自己参与的」session 收窄 —— 只按 tenant/user 过滤会在
 * 共享会话里漏掉同会话其他人的 execution，而那正是协作要看到的东西。
 *
 * 读接口不用 `requireAdmin`（见 shared.ts 的 readAccess）：带了管理令牌 = 看全量，
 * 否则退到会话可见性。否则配了令牌的部署里参与者读不到自己会话的执行时间线。
 */

/** GET /api/executions — execution 列表（管理令牌看全量，否则按可见会话收窄） */
executionRouter.get('/', async (req, res, next) => {
  try {
    const access = readAccess(req);
    if (access === 'denied') return res.status(401).json(READ_ACCESS_DENIED);
    const limit = Math.max(1, Math.min(500, Number(req.query.limit ?? 50) || 50));
    const sessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId : undefined;
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const sessionIds = access === 'all' ? undefined : await visibleSessionIds(principalOf(req));
    const executions = await executionService.list({
      ...(sessionId ? { sessionId } : {}),
      ...(sessionIds ? { sessionIds } : {}),
      ...(status ? { status: status as never } : {}),
      limit,
    });
    res.json({ executions, stats: await executionService.stats() });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/executions — 建后台执行单元（202，HTTP 不等 agent）。
 *
 * kind = "workflow" 时额外给 skill + flow：**建之前先把 SKILL.md 校验完**
 * （技能存在、恰好一个 @flow、路由目标存在、出口写全、gate/review/action 已注册）。
 * 校验不过直接 400 —— 不要跑到一半才发现路由指向不存在的节点，
 * 那时 execution 可能已经停在 waiting 或者已经把业务动作提出去了。
 */
executionRouter.post('/', async (req, res, next) => {
  try {
    const body = createSchema.parse(req.body ?? {});
    const principal = principalOf(req);
    const isWorkflow = body.kind === 'workflow';
    if (!isWorkflow && (body.skill || body.flow)) {
      return res.status(400).json({ error: 'skill / flow 只在 kind = "workflow" 时有效' });
    }

    let workflow: WorkflowState | undefined;
    if (isWorkflow) {
      if (!body.skill || !body.flow) {
        return res.status(400).json({ error: 'kind = "workflow" 必须同时给 skill 与 flow' });
      }
      try {
        const prepared = workflowRunner.prepare({ skill: body.skill, flow: body.flow });
        workflow = {
          skill: prepared.skill.meta.name,
          flow: prepared.definition.id,
          sourceHash: prepared.skill.sourceHash,
          current: prepared.definition.start,
          steps: 0,
        };
      } catch (err) {
        if (err instanceof FlowValidationError) {
          return res.status(400).json({
            error: 'Skill Flow 校验失败',
            issues: err.issues.map((i) => ({ ...i, file: `SKILL.md:${i.line}` })),
          });
        }
        throw err;
      }
    }

    // 建 execution = 往这个会话里送工作：先过会话访问判定，再归属到会话 owner
    const access = await assertSessionSendable(body.sessionId, principal);
    const execution = await executionService.create({
      sessionId: body.sessionId,
      owner: access.owner,
      initiatedByUserId: principal.userId,
      kind: body.kind,
      ...(body.input !== undefined ? { input: body.input } : {}),
      ...(body.prompt ? { prompt: body.prompt } : {}),
      ...(workflow ? { workflow } : {}),
    });
    res.status(202).json({
      executionId: execution.executionId,
      status: execution.status,
      ...(workflow ? { workflow } : {}),
    });
  } catch (err) {
    return sendServiceError(res, err, next);
  }
});

executionRouter.get('/:id', async (req, res, next) => {
  try {
    const access = readAccess(req);
    if (access === 'denied') return res.status(401).json(READ_ACCESS_DENIED);
    const id = String(req.params.id);
    const record = await executionService.get(id);
    if (!record) return res.status(404).json({ error: `execution 不存在："${id}"` });
    if (access !== 'all') await assertSessionVisible(record.sessionId, principalOf(req));
    return res.json(record);
  } catch (err) {
    return sendServiceError(res, err, next);
  }
});

/** GET /api/executions/:id/events — 审计时间线（谁批准、何时、依据什么） */
executionRouter.get('/:id/events', async (req, res, next) => {
  try {
    const access = readAccess(req);
    if (access === 'denied') return res.status(401).json(READ_ACCESS_DENIED);
    const id = String(req.params.id);
    const limit = Math.max(1, Math.min(500, Number(req.query.limit ?? 100) || 100));
    const record = await executionService.get(id);
    if (!record) return res.status(404).json({ error: `execution 不存在："${id}"` });
    if (access !== 'all') await assertSessionVisible(record.sessionId, principalOf(req));
    return res.json({ events: await executionService.events(id, limit) });
  } catch (err) {
    return sendServiceError(res, err, next);
  }
});

/** GET /api/executions/:id/tasks — 该 execution 挂起/已决的人工任务 */
executionRouter.get('/:id/tasks', async (req, res, next) => {
  try {
    const access = readAccess(req);
    if (access === 'denied') return res.status(401).json(READ_ACCESS_DENIED);
    const id = String(req.params.id);
    const record = await executionService.get(id);
    if (!record) return res.status(404).json({ error: `execution 不存在："${id}"` });
    if (access !== 'all') await assertSessionVisible(record.sessionId, principalOf(req));
    const tasks = await humanTaskService.repository.list({ executionId: id, limit: 100 });
    return res.json({ tasks });
  } catch (err) {
    return sendServiceError(res, err, next);
  }
});

/**
 * POST /api/executions/:id/run — 后台跑起来（202，不等结果）。
 * HITL 场景（审批可能几小时）不能靠 SSE 长连接，客户端用 events 端点轮询/SSE。
 *
 * kind 决定谁来推进，API 层不新增 /workflow/* 端点：
 *   interactive / job → SessionCoordinator（需要 prompt）
 *   workflow          → WorkflowRunner（不需要 prompt：流程定义在 SKILL.md 里）
 *
 * 权限与 cancel / actions 同一档：`assertCanCommandExecution`（owner 任意 / member 只能
 * 跑自己发起的 / observer 不可）。**不能只判 `send`** —— 那等于"能在这个会话发言就能让
 * 别人的 execution 跑起来"，与 cancel/actions 的规则自相矛盾，也让文档里
 * "owner 或发起人才能指挥 execution" 不成立。
 */
executionRouter.post('/:id/run', async (req, res, next) => {
  try {
    const body = runSchema.parse(req.body ?? {});
    const id = String(req.params.id);
    const record = await executionService.get(id);
    if (!record) return res.status(404).json({ error: `execution 不存在："${id}"` });
    await sessionAccessService.assertCanCommandExecution(record.sessionId, principalOf(req), record);

    if (record.kind === 'workflow') {
      if (body.prompt) {
        return res.status(400).json({ error: 'workflow execution 不接受 prompt（步骤说明在 SKILL.md 里）' });
      }
      if (!record.workflow) {
        return res.status(409).json({ error: `execution "${id}" 是 workflow 但没有 workflow_state` });
      }
      await executionService.start(id);
      workflowRunner.runDetached(record);
      return res.status(202).json({ executionId: id, status: 'running', workflow: record.workflow });
    }

    if (!body.prompt) return res.status(400).json({ error: 'prompt 不能为空' });
    await executionService.start(id);
    // 取 session → turn 槽 → 收尾 统一由调度器做，不阻塞 HTTP
    sessionCoordinator.runDetached(record, body.prompt);
    return res.status(202).json({ executionId: id, status: 'running' });
  } catch (err) {
    return sendServiceError(res, err, next);
  }
});

/**
 * POST /api/executions/:id/cancel — 取消（running/waiting 都可）。
 * owner 可取消任意；member 只能取消自己发起的；observer 不可 —— 判定见
 * SessionAccessService.assertCanCommandExecution。
 */
executionRouter.post('/:id/cancel', async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const record = await executionService.get(id);
    if (!record) return res.status(404).json({ error: `execution 不存在："${id}"` });
    await sessionAccessService.assertCanCommandExecution(record.sessionId, principalOf(req), record);
    await executionService.cancel(id);
    return res.json({ executionId: id, status: 'cancelled' });
  } catch (err) {
    return sendServiceError(res, err, next);
  }
});

/**
 * POST /api/executions/:id/actions — agent 提出业务动作意图。
 *
 * 两层授权，不能互相替代：
 *   会话访问  发起人必须能指挥这个 execution（owner 或发起人本人；observer 不可）
 *   业务授权  能不能做这个动作、要不要审批、谁有资格批（ActionPolicy + ApprovalPolicy）
 * 裁决全在服务端：未登记策略 → 拒绝；需审批 → 建 HumanTask + execution 进入
 * WAITING_FOR_APPROVAL；登记为自动放行 → server 直接执行。执行权不在 agent 的工具集里。
 *
 * 只判 `view` 是不行的：observer 若能调这个端点，就等于能对别人的 execution 提业务动作
 * （`submit_proxy_vote` 这类）。业务意图不是"看得见"就能提。
 */
executionRouter.post('/:id/actions', async (req, res, next) => {
  try {
    const body = actionSchema.parse(req.body ?? {});
    const id = String(req.params.id);
    const principal = principalOf(req);
    const record = await executionService.get(id);
    if (!record) return res.status(404).json({ error: `execution 不存在："${id}"` });
    await sessionAccessService.assertCanCommandExecution(record.sessionId, principal, record);
    // 提案发生在 agent turn 中；若 execution 仍是 created（异步/手工场景），先置 running
    if (record.status === 'created') await executionService.start(id);
    const intent: ActionIntent = {
      actionType: body.actionType,
      target: body.target,
      parameters: body.parameters ?? {},
      ...(body.reason ? { reason: body.reason } : {}),
      requestedBy: { userId: principal.userId, tenantId: principal.tenantId },
      createdAt: new Date().toISOString(),
    };
    const verdict = await executionService.proposeAction(id, intent, {
      ...(body.resourceVersion ? { resourceVersion: body.resourceVersion } : {}),
    });
    const status = (await executionService.get(id))?.status;
    return res.status(verdict.decision === 'denied' ? 403 : 202).json({ ...verdict, status });
  } catch (err) {
    return sendServiceError(res, err, next);
  }
});

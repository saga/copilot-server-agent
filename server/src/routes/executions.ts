import { Router } from 'express';
import { z } from 'zod';
import { executionService, humanTaskService, sessionCoordinator } from '../wiring.js';
import type { ActionIntent } from '../execution/types.js';
import { config } from '../config.js';
import {
  actionSchema,
  assertSessionSendable,
  assertSessionVisible,
  principalOf,
  requireAdmin,
  sendServiceError,
  visibleSessionIds,
} from './shared.js';

export const executionRouter = Router();

const createSchema = z.object({
  sessionId: z.string().min(1),
  kind: z.enum(['interactive', 'job', 'workflow']).optional().default('job'),
  input: z.unknown().optional(),
  prompt: z.string().optional(),
});

const runSchema = z.object({ prompt: z.string().min(1, 'prompt 不能为空') });

/**
 * execution 的可见性跟着它所属的 session 走。
 *
 * 单租户（未开身份头）不分租户，保持本地开发直接可用；
 * 多租户下按「自己拥有的 + 自己参与的」session 收窄 —— 只按 tenant/user 过滤会在
 * 共享会话里漏掉同会话其他人的 execution，而那正是协作要看到的东西。
 */

/** GET /api/executions — execution 列表 */
executionRouter.get('/', requireAdmin, async (req, res, next) => {
  try {
    const limit = Math.max(1, Math.min(500, Number(req.query.limit ?? 50) || 50));
    const sessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId : undefined;
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const principal = config.trustIdentityHeaders ? principalOf(req) : undefined;
    const sessionIds = principal ? await visibleSessionIds(principal) : undefined;
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

/** POST /api/executions — 建后台执行单元（202，HTTP 不等 agent） */
executionRouter.post('/', async (req, res, next) => {
  try {
    const body = createSchema.parse(req.body ?? {});
    const principal = principalOf(req);
    // 建 execution = 往这个会话里送工作：先过会话访问判定，再归属到会话 owner
    const access = await assertSessionSendable(body.sessionId, principal);
    const execution = await executionService.create({
      sessionId: body.sessionId,
      owner: access.owner,
      initiatedByUserId: principal.userId,
      kind: body.kind,
      ...(body.input !== undefined ? { input: body.input } : {}),
      ...(body.prompt ? { prompt: body.prompt } : {}),
    });
    res.status(202).json({ executionId: execution.executionId, status: execution.status });
  } catch (err) {
    return sendServiceError(res, err, next);
  }
});

executionRouter.get('/:id', requireAdmin, async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const record = await executionService.get(id);
    if (!record) return res.status(404).json({ error: `execution 不存在："${id}"` });
    if (config.trustIdentityHeaders) await assertSessionVisible(record.sessionId, principalOf(req));
    return res.json(record);
  } catch (err) {
    return sendServiceError(res, err, next);
  }
});

/** GET /api/executions/:id/events — 审计时间线（谁批准、何时、依据什么） */
executionRouter.get('/:id/events', requireAdmin, async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const limit = Math.max(1, Math.min(500, Number(req.query.limit ?? 100) || 100));
    const record = await executionService.get(id);
    if (!record) return res.status(404).json({ error: `execution 不存在："${id}"` });
    if (config.trustIdentityHeaders) await assertSessionVisible(record.sessionId, principalOf(req));
    return res.json({ events: await executionService.events(id, limit) });
  } catch (err) {
    return sendServiceError(res, err, next);
  }
});

/** GET /api/executions/:id/tasks — 该 execution 挂起/已决的人工任务 */
executionRouter.get('/:id/tasks', requireAdmin, async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const record = await executionService.get(id);
    if (!record) return res.status(404).json({ error: `execution 不存在："${id}"` });
    if (config.trustIdentityHeaders) await assertSessionVisible(record.sessionId, principalOf(req));
    const tasks = await humanTaskService.repository.list({ executionId: id, limit: 100 });
    return res.json({ tasks });
  } catch (err) {
    return sendServiceError(res, err, next);
  }
});

/**
 * POST /api/executions/:id/run — 后台跑一次 agent turn（202，不等结果）。
 * HITL 场景（审批可能几小时）不能靠 SSE 长连接，客户端用 events 端点轮询/SSE。
 */
executionRouter.post('/:id/run', async (req, res, next) => {
  try {
    const body = runSchema.parse(req.body ?? {});
    const id = String(req.params.id);
    const record = await executionService.get(id);
    if (!record) return res.status(404).json({ error: `execution 不存在："${id}"` });
    await assertSessionVisible(record.sessionId, principalOf(req));
    await executionService.start(id);
    // 取 session → turn 槽 → 收尾 统一由调度器做，不阻塞 HTTP
    sessionCoordinator.runDetached(record, body.prompt);
    return res.status(202).json({ executionId: id, status: 'running' });
  } catch (err) {
    return sendServiceError(res, err, next);
  }
});

/** POST /api/executions/:id/cancel — 取消（running/waiting 都可） */
executionRouter.post('/:id/cancel', async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const record = await executionService.get(id);
    if (!record) return res.status(404).json({ error: `execution 不存在："${id}"` });
    await assertSessionVisible(record.sessionId, principalOf(req));
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
 *   会话访问  发起人必须能访问这个 execution 所属的会话（SessionAccessService）
 *   业务授权  能不能做这个动作、要不要审批、谁有资格批（ActionPolicy + ApprovalPolicy）
 * 裁决全在服务端：未登记策略 → 拒绝；需审批 → 建 HumanTask + execution 进入
 * WAITING_FOR_APPROVAL；登记为自动放行 → server 直接执行。执行权不在 agent 的工具集里。
 */
executionRouter.post('/:id/actions', async (req, res, next) => {
  try {
    const body = actionSchema.parse(req.body ?? {});
    const id = String(req.params.id);
    const principal = principalOf(req);
    const record = await executionService.get(id);
    if (!record) return res.status(404).json({ error: `execution 不存在："${id}"` });
    await assertSessionVisible(record.sessionId, principal);
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

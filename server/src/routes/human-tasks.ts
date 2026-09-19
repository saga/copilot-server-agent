import { Router } from 'express';
import { z } from 'zod';
import { executionService, humanTaskService } from '../wiring.js';
import { config } from '../config.js';
import { assertSessionVisible, principalOf, requireAdmin, sendServiceError } from './shared.js';

export const humanTaskRouter = Router();

/**
 * Human Task API。
 *
 * 资格服务端算（eligibleRoles/eligibleUsers/delegatedTo），客户端不能指定 approver：
 * 请求体里传 approverId 一律忽略，身份只认认证后的 principal。
 */

const decisionSchema = z.object({ comment: z.string().max(2000).optional() });
const delegateSchema = z.object({
  toUserId: z.string().min(1, 'toUserId 不能为空'),
  reason: z.string().max(1000).optional(),
});
const inputSchema = z.object({ values: z.record(z.string(), z.unknown()) });

/** GET /api/human-tasks — 我的任务（审批 + 待补输入） */
humanTaskRouter.get('/', async (req, res, next) => {
  try {
    const principal = principalOf(req);
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const type = typeof req.query.type === 'string' ? req.query.type : undefined;
    const tasks = await humanTaskService.list(principal, {
      tenantId: principal.tenantId,
      ...(status ? { status: status as never } : {}),
      ...(type ? { type: type as never } : {}),
      limit: Math.max(1, Math.min(200, Number(req.query.limit ?? 50) || 50)),
    });
    res.json({ tasks, principal: { userId: principal.userId, roles: principal.roles } });
  } catch (err) {
    next(err);
  }
});

/** GET /api/human-tasks/all — 全部任务（管理视图，需 admin token） */
humanTaskRouter.get('/all', requireAdmin, async (req, res, next) => {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const tasks = await humanTaskService.repository.list({
      ...(status ? { status: status as never } : {}),
      limit: Math.max(1, Math.min(500, Number(req.query.limit ?? 100) || 100)),
    });
    res.json({ tasks });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/human-tasks/:id — 单个任务 + 决策记录。
 *
 * 读路径额外要求「能访问任务所属的会话」：任务挂在 execution 上，execution 挂在 session 上，
 * 不校验就靠猜 taskId 就能读到别的会话的审批内容。
 * 审批/输入/委派/取消不做这一层 —— 那些由 ApprovalPolicy 的资格判定把关：
 * 审批人不一定在共享会话里（风险/合规岗常常不在），把成员资格当审批资格会误伤。
 */
humanTaskRouter.get('/:id', async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const task = await humanTaskService.get(id);
    if (!task) return res.status(404).json({ error: `human task 不存在："${id}"` });
    if (config.trustIdentityHeaders) {
      const execution = await executionService.get(task.executionId);
      if (execution) await assertSessionVisible(execution.sessionId, principalOf(req));
    }
    const decisions = await humanTaskService.repository.listDecisions(task.taskId);
    return res.json({ task, decisions });
  } catch (err) {
    return sendServiceError(res, err, next);
  }
});

humanTaskRouter.post('/:id/approve', async (req, res, next) => {
  try {
    const body = decisionSchema.parse(req.body ?? {});
    const { task, evaluation } = await humanTaskService.approve(String(req.params.id), {
      principal: principalOf(req),
      ...(body.comment ? { comment: body.comment } : {}),
    });
    return res.json({ task, evaluation });
  } catch (err) {
    return sendServiceError(res, err, next);
  }
});

humanTaskRouter.post('/:id/reject', async (req, res, next) => {
  try {
    const body = decisionSchema.parse(req.body ?? {});
    const { task, evaluation } = await humanTaskService.reject(String(req.params.id), {
      principal: principalOf(req),
      ...(body.comment ? { comment: body.comment } : {}),
    });
    return res.json({ task, evaluation });
  } catch (err) {
    return sendServiceError(res, err, next);
  }
});

/** POST /api/human-tasks/:id/input — 人工补数据（按 inputSchema 校验） */
humanTaskRouter.post('/:id/input', async (req, res, next) => {
  try {
    const body = inputSchema.parse(req.body ?? {});
    const task = await humanTaskService.submitInput(String(req.params.id), {
      principal: principalOf(req),
      values: body.values,
    });
    return res.json({ task });
  } catch (err) {
    return sendServiceError(res, err, next);
  }
});

/** POST /api/human-tasks/:id/delegate — 委派（留痕 from/to/by/at + reason） */
humanTaskRouter.post('/:id/delegate', async (req, res, next) => {
  try {
    const body = delegateSchema.parse(req.body ?? {});
    const task = await humanTaskService.delegate(String(req.params.id), {
      principal: principalOf(req),
      toUserId: body.toUserId,
      ...(body.reason ? { reason: body.reason } : {}),
    });
    return res.json({ task });
  } catch (err) {
    return sendServiceError(res, err, next);
  }
});

humanTaskRouter.post('/:id/cancel', async (req, res, next) => {
  try {
    const task = await humanTaskService.cancel(String(req.params.id), {
      principal: principalOf(req),
    });
    return res.json({ task });
  } catch (err) {
    return sendServiceError(res, err, next);
  }
});

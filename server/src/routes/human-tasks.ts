import { Router } from 'express';
import { z } from 'zod';
import { executionService, humanTaskService } from '../wiring.js';
import { isAssignee } from '../human-tasks/assignment.js';
import {
  assertSessionVisible,
  principalOf,
  READ_ACCESS_DENIED,
  readAccess,
  requireAdmin,
  sendServiceError,
} from './shared.js';

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
 * 三类人可以读（admin / 任务处理人 / 会话参与人），其余 403：
 *
 *   admin                     管理令牌 → 全量
 *   task assignee             风险 / 合规审批人**不一定在共享会话里**（他们常常不在），
 *                             所以不能只按会话成员资格判定，否则审批人读不到自己负责的任务
 *   session participant       协作 UI 要看得到本会话挂起的任务
 *
 * tenant 检查放在 session visibility 之前：跨租户时既不该命中后两类的任何一支，
 * 也不该通过响应差异泄漏"这个 taskId 存在与否"。
 */
humanTaskRouter.get('/:id', async (req, res, next) => {
  try {
    const access = readAccess(req);
    if (access === 'denied') return res.status(401).json(READ_ACCESS_DENIED);

    const id = String(req.params.id);
    const principal = principalOf(req);
    const task = await humanTaskService.get(id);
    if (!task) return res.status(404).json({ error: `human task 不存在："${id}"` });

    if (access !== 'all') {
      if (task.tenantId !== principal.tenantId) {
        return res.status(403).json({ error: `无权访问 human task："${id}"` });
      }
      if (!isAssignee(task, principal)) {
        const execution = await executionService.get(task.executionId);
        if (!execution) {
          return res.status(404).json({ error: `execution 不存在："${task.executionId}"` });
        }
        await assertSessionVisible(execution.sessionId, principal);
      }
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

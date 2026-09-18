import { Router } from 'express';
import { z } from 'zod';
import { runTurn } from '../agent/agent-runner.js';
import { executionContext } from '../agent/agent-context.js';
import { executionService, humanTaskService } from '../execution/index.js';
import type { ActionIntent } from '../execution/types.js';
import { sessionService } from '../services/session-service.js';
import { withExecutionSlot } from '../services/concurrency.js';
import { config } from '../config.js';
import { requireAdmin, principalOf, ownerOf, actionSchema, sendServiceError } from './shared.js';

export const executionRouter = Router();

const createSchema = z.object({
  sessionId: z.string().min(1),
  kind: z.enum(['interactive', 'job', 'workflow']).optional().default('job'),
  input: z.unknown().optional(),
  prompt: z.string().optional(),
});

const runSchema = z.object({ prompt: z.string().min(1, 'prompt 不能为空') });

/** GET /api/executions — execution 列表（多租户时按调用方过滤；否则需 admin token） */
executionRouter.get('/', requireAdmin, async (req, res, next) => {
  try {
    const limit = Math.max(1, Math.min(500, Number(req.query.limit ?? 50) || 50));
    const sessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId : undefined;
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const owner = config.trustIdentityHeaders ? ownerOf(req) : undefined;
    const executions = await executionService.list({
      ...(sessionId ? { sessionId } : {}),
      ...(owner ? { tenantId: owner.tenantId, userId: owner.userId } : {}),
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
    const owner = ownerOf(req);
    const execution = await executionService.create({
      sessionId: body.sessionId,
      owner,
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
    const record = await executionService.get(String(req.params.id));
    if (!record) {
      return res.status(404).json({ error: `execution 不存在："${req.params.id}"` });
    }
    if (config.trustIdentityHeaders) {
      const owner = ownerOf(req);
      if (record.tenantId !== owner.tenantId || record.userId !== owner.userId) {
        return res.status(403).json({ error: `无权访问 execution："${req.params.id}"` });
      }
    }
    return res.json(record);
  } catch (err) {
    return next(err);
  }
});

/** GET /api/executions/:id/events — 审计时间线（谁批准、何时、依据什么） */
executionRouter.get('/:id/events', requireAdmin, async (req, res, next) => {
  try {
    const limit = Math.max(1, Math.min(500, Number(req.query.limit ?? 100) || 100));
    res.json({ events: await executionService.events(String(req.params.id), limit) });
  } catch (err) {
    next(err);
  }
});

/** GET /api/executions/:id/tasks — 该 execution 挂起/已决的人工任务 */
executionRouter.get('/:id/tasks', requireAdmin, async (req, res, next) => {
  try {
    const tasks = await humanTaskService.repository.list({
      executionId: String(req.params.id),
      limit: 100,
    });
    res.json({ tasks });
  } catch (err) {
    next(err);
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
    await executionService.start(id);
    void runExecutionBackground(id, record.sessionId, body.prompt).catch((err) =>
      executionService.fail(id, err).catch(() => undefined),
    );
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
    await executionService.cancel(id);
    return res.json({ executionId: id, status: 'cancelled' });
  } catch (err) {
    return sendServiceError(res, err, next);
  }
});

/**
 * POST /api/executions/:id/actions — agent 提出业务动作意图。
 *
 * 裁决全在服务端：未登记策略 → 拒绝；需审批 → 建 HumanTask + execution 进入
 * WAITING_FOR_APPROVAL；登记为自动放行 → server 直接执行（server-controlled action）。
 * 执行权不在 agent 的工具集里。
 */
executionRouter.post('/:id/actions', async (req, res, next) => {
  try {
    const body = actionSchema.parse(req.body ?? {});
    const id = String(req.params.id);
    const principal = principalOf(req);
    // 提案发生在 agent turn 中；若 execution 仍是 created（异步/手工场景），先置 running
    if ((await executionService.get(id))?.status === 'created') {
      await executionService.start(id);
    }
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

/** 后台执行：session lock + 全局并发闸门 + AgentRunner（不阻塞 HTTP） */
async function runExecutionBackground(
  executionId: string,
  sessionId: string,
  prompt: string,
): Promise<void> {
  const session = await sessionService.resumeExecutionSession(sessionId);
  await withExecutionSlot(() =>
    sessionService.withSessionLock(sessionId, async () => {
      executionContext.set(sessionId, executionId);
      try {
        const result = await runTurn({ session, executionId, prompt });
        await executionService.complete(executionId, {
          contentChars: result.content.length,
          result: { content: result.content },
        });
      } finally {
        executionContext.clear(sessionId, executionId);
        // 等待人工期间不占着 SDK session：释放内存附着，之后 resume 继续
        const rec = await executionService.get(executionId);
        if (rec && (rec.status === 'waiting_for_approval' || rec.status === 'waiting_for_input')) {
          await sessionService.disconnectIdleSession(sessionId);
        }
      }
    }),
  );
}

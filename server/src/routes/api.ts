import { Router } from 'express';
import { sessionRouter } from './sessions.js';
import { executionRouter } from './executions.js';
import { humanTaskRouter } from './human-tasks.js';
import { metaRouter } from './meta.js';

/**
 * /api 聚合路由：只做挂载，业务路由各自成文件。
 *
 *   /api/sessions      → 会话生命周期 + chat（SSE）
 *   /api/executions    → execution 生命周期 / 事件 / 人工任务 / 业务动作
 *   /api/human-tasks   → 审批与人工输入
 *   /api/{providers,models,agents,mcp,hooks,debug} → 元信息与诊断
 */
export const apiRouter = Router();

apiRouter.use('/sessions', sessionRouter);
apiRouter.use('/executions', executionRouter);
apiRouter.use('/human-tasks', humanTaskRouter);
apiRouter.use('/', metaRouter);

import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { healthRouter } from './routes/health.js';
import { apiRouter } from './routes/api.js';
import { errorHandler } from './middleware/errorHandler.js';
import { sessionService } from './services/session-service.js';
import { humanTaskService, collaborationService } from './wiring.js';
import { startTaskSweeper } from './services/task-sweeper.js';
import { closeDb } from './db/connection.js';
import { isShuttingDown, markShuttingDown } from './shutdown.js';

const app = express();

app.use(cors({ origin: config.corsOrigin }));
app.use(express.json({ limit: '1mb' }));

// React 前端统一调用 /api/*
app.use('/api/health', healthRouter);
app.use('/api', apiRouter);

app.use(errorHandler);

// 过期扫描：OPEN human task → EXPIRED（进程内定时器，不用 cron/工作流引擎）
const sweeper = startTaskSweeper(humanTaskService);

const server = app.listen(config.port, () => {
  console.log(`[server] listening on http://localhost:${config.port}`);
  // 后台预热 runtime：不阻塞监听，失败只记日志（/api/health 会显示 error + 原因）
  if (config.warmup) {
    void sessionService.warmup().then((r) => {
      if (r.ok) console.log('[server] copilot runtime 预热完成');
      else console.warn(`[server] copilot runtime 预热失败：${r.error}（首个会话请求会重试）`);
    });
  }
});

/**
 * 启动恢复：durable 队列 + 崩溃残留状态。
 *
 * - `running`/`resuming` → `interrupted`（终态，**不自动重试**：agent 可能已经执行过
 *   业务动作，重跑会重复提交）
 * - 仍有 `created` 协作 execution 的 session 重新 drain（队列在库里，但"谁在跑"是进程内的）
 *
 * 不阻塞监听：恢复失败只记日志，服务照常可用（待处理的会话会在下一条消息时被唤醒）。
 */
void collaborationService
  .recoverPending()
  .then((r) => {
    if (r.interrupted || r.sessions) {
      console.log(
        `[server] 启动恢复：interrupted ${r.interrupted} 条执行，重新入队 ${r.sessions} 个会话`,
      );
    }
  })
  .catch((err: unknown) => {
    console.error('[server] 启动恢复失败：', err instanceof Error ? err.message : err);
  });

// 优雅退出：SIGTERM → readiness 先 503（K8s 摘流）→ 关 HTTP（drain SSE/请求）→ 断 sessions → exit
let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown || isShuttingDown()) return;
  shuttingDown = true;
  markShuttingDown();
  console.log(`[server] received ${signal}, draining...`);
  try {
    clearInterval(sweeper);
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    await sessionService.stop();
    await closeDb();
  } finally {
    process.exit(0);
  }
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => void shutdown(sig));
}

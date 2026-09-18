import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { healthRouter } from './routes/health.js';
import { apiRouter } from './routes/api.js';
import { errorHandler } from './middleware/errorHandler.js';
import { sessionService } from './services/session-service.js';
import { humanTaskService } from './wiring.js';
import { startTaskSweeper } from './services/task-sweeper.js';
import { closeSql } from './db/pool.js';
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
    await closeSql();
  } finally {
    process.exit(0);
  }
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => void shutdown(sig));
}

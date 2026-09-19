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
import { isShuttingDown, markReady, markShuttingDown } from './lifecycle.js';

const app = express();

app.use(cors({ origin: config.corsOrigin }));
app.use(express.json({ limit: '1mb' }));

// React 前端统一调用 /api/*
app.use('/api/health', healthRouter);
app.use('/api', apiRouter);

app.use(errorHandler);

let sweeper: NodeJS.Timeout | undefined;

/**
 * 启动顺序：建 app → 恢复 durable 状态 → 起 sweeper → listen → ready。
 *
 * **恢复必须在 listen 之前。** `recoverPending()` 会把残留的 `running` / `resuming`
 * execution 判成终态 `interrupted`（不自动重试）。若它与 listen 并行，新进来的请求
 * 可能刚把一条 execution 置成 `running`，转头就被这次恢复当成"崩溃残留"改掉。
 *
 * **恢复失败就不接流量。** 恢复成功是这套服务能安全对外服务的前提：没恢复完就 listen，
 * 会出现"DB 恢复失败 → 服务 ready → 照收业务请求"，而且队列里的 `created` 永远没人 drain。
 * 所以失败时置 `exitCode = 1` 并直接返回，不起监听、不置 ready，交给编排层重启。
 * `GET /api/health/ready` 在恢复完成前一律 503，给编排层一个可靠的"先别放流量"信号。
 */
async function main(): Promise<void> {
  try {
    const r = await collaborationService.recoverPending();
    if (r.interrupted || r.sessions) {
      console.log(
        `[server] 启动恢复：interrupted ${r.interrupted} 条执行，重新入队 ${r.sessions} 个会话`,
      );
    }
  } catch (err) {
    console.error('[server] 启动恢复失败：', err instanceof Error ? err.message : err);
    // 恢复没成功就不接业务流量：不 listen、不 ready，只置退出码让编排层重拉。
    process.exitCode = 1;
    try {
      await closeDb();
    } catch {
      // 关库失败无所谓，进程马上要退出了
    }
    return;
  }

  // 过期扫描：OPEN human task → EXPIRED（进程内定时器，不用 cron/工作流引擎）。
  // 放在恢复之后：它同样会关闭任务并推进 execution，不该和恢复抢同一批行。
  sweeper = startTaskSweeper(humanTaskService);

  const server = app.listen(config.port, () => {
    markReady();
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
  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown || isShuttingDown()) return;
    shuttingDown = true;
    markShuttingDown();
    console.log(`[server] received ${signal}, draining...`);
    try {
      if (sweeper) clearInterval(sweeper);
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
}

void main();

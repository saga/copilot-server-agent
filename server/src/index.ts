import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { healthRouter } from './routes/health.js';
import { apiRouter } from './routes/api.js';
import { errorHandler } from './middleware/errorHandler.js';
import { sessionService } from './services/session-service.js';
import { isShuttingDown, markShuttingDown } from './shutdown.js';

const app = express();

app.use(cors({ origin: config.corsOrigin }));
app.use(express.json({ limit: '1mb' }));

// React 前端统一调用 /api/*
app.use('/api/health', healthRouter);
app.use('/api', apiRouter);

app.use(errorHandler);

const server = app.listen(config.port, () => {
  console.log(`[server] listening on http://localhost:${config.port}`);
});

// 优雅退出：SIGTERM → readiness 先 503（K8s 摘流）→ 关 HTTP（drain SSE/请求）→ 断 sessions → exit
let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown || isShuttingDown()) return;
  shuttingDown = true;
  markShuttingDown();
  console.log(`[server] received ${signal}, draining...`);
  try {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    await sessionService.stop();
  } finally {
    process.exit(0);
  }
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => void shutdown(sig));
}

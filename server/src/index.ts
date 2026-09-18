import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { healthRouter } from './routes/health.js';
import { copilotRouter } from './routes/copilot.js';
import { errorHandler } from './middleware/errorHandler.js';
import { copilotService } from './services/copilot.js';

const app = express();

app.use(cors({ origin: config.corsOrigin }));
app.use(express.json({ limit: '1mb' }));

// React 前端统一调用 /api/* 
app.use('/api/health', healthRouter);
app.use('/api', copilotRouter);

app.use(errorHandler);

const server = app.listen(config.port, () => {
  console.log(`[server] listening on http://localhost:${config.port}`);
});

// 优雅退出：先断开 Copilot sessions 再关 HTTP
async function shutdown(signal: string) {
  console.log(`[server] received ${signal}, shutting down...`);
  server.close();
  try {
    await copilotService.stop();
  } finally {
    process.exit(0);
  }
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => void shutdown(sig));
}

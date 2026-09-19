import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';

import { healthRouter } from '../src/routes/health.js';
import {
  isReady,
  isShuttingDown,
  lifecycleState,
  markReady,
  markShuttingDown,
} from '../src/lifecycle.js';

/**
 * 启动顺序：`index.ts` 先跑 `collaborationService.recoverPending()`，再 `listen`。
 *
 * 为什么要这个顺序：恢复会把残留的 `running` / `resuming` execution 判成终态
 * `interrupted`（不自动重试）。若恢复与 listen 并行，新请求刚置成 `running` 的
 * execution 会被这次恢复顺手改掉 —— 窗口很小，但真实存在。
 *
 * 因此 readiness 在恢复完成前必须是 503，而不是"进程起来了就算就绪"。
 */

test('生命周期：starting 期间 readiness 503，ready 放行，draining 优先且不可逆', async () => {
  // 只挂 health 路由。starting / draining 两个分支都在 ping runtime 之前返回，
  // 所以这个用例不会去拉 Copilot runtime。
  const app = express();
  app.use('/api/health', healthRouter);
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = (server.address() as AddressInfo).port;
  const ready = async (): Promise<{ status: number; body: { status: string } }> => {
    const res = await fetch(`http://127.0.0.1:${port}/api/health/ready`);
    return { status: res.status, body: (await res.json()) as { status: string } };
  };

  try {
    // 1) durable 状态还没恢复完：不接受业务流量
    assert.equal(lifecycleState(), 'starting');
    assert.equal(isReady(), false);
    const starting = await ready();
    assert.equal(starting.status, 503);
    assert.equal(starting.body.status, 'starting');

    // 2) 恢复完成 → ready
    markReady();
    assert.equal(lifecycleState(), 'ready');
    assert.equal(isReady(), true);

    // 3) SIGTERM：先摘流；且一旦进入 draining 就不能被拉回 ready
    markShuttingDown();
    assert.equal(lifecycleState(), 'draining');
    assert.equal(isShuttingDown(), true);
    markReady();
    assert.equal(lifecycleState(), 'draining', 'draining 之后不能回到 ready');

    const draining = await ready();
    assert.equal(draining.status, 503);
    assert.equal(draining.body.status, 'draining');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

/**
 * 进程生命周期状态（readiness 探针与启动顺序共用）。
 *
 *   starting  —— 已建 app，但 durable 状态还没恢复完：**不接受业务流量**
 *   ready     —— 恢复完成且已 listen，可以接流量
 *   draining  —— 收到 SIGTERM：先摘流（readiness 503），再 drain
 *
 * 为什么必须把 starting 和 ready 分开：启动恢复会把残留的 `running` / `resuming`
 * execution 判成终态 `interrupted`。如果 listen 与恢复并行，新进来的请求可能刚把一条
 * execution 置成 `running`，转头就被恢复流程当成"崩溃残留"改掉 —— 窗口很小，但真实存在。
 *
 * 单独一个模块（而不是放在 index 里）是为了让 health 路由能读状态而不与 index 循环 import。
 */
export type LifecycleState = 'starting' | 'ready' | 'draining';

let state: LifecycleState = 'starting';

export function lifecycleState(): LifecycleState {
  return state;
}

/** 恢复完成、开始接收业务流量（只从 starting 迁移） */
export function markReady(): void {
  if (state === 'starting') state = 'ready';
}

export function isReady(): boolean {
  return state === 'ready';
}

/** SIGTERM：先摘流，再 drain */
export function markShuttingDown(): void {
  state = 'draining';
}

export function isShuttingDown(): boolean {
  return state === 'draining';
}

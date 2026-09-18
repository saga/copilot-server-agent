/**
 * 进程级关闭状态（供 readiness 探针在 SIGTERM 后返回 503，
 * 让 K8s 先摘流再 drain；避免 health 路由与 index 循环 import）。
 */
let shuttingDown = false;

export function isShuttingDown(): boolean {
  return shuttingDown;
}

export function markShuttingDown(): void {
  shuttingDown = true;
}

import { config } from '../config.js';
import type { HumanTaskService } from '../human-tasks/human-task-service.js';

/**
 * 过期扫描：OPEN → EXPIRED（进程内 setInterval，不用 cron/工作流引擎）。
 * 多副本时由 repository 侧的唯一约束保证同一任务只被收敛一次。
 */
export function startTaskSweeper(service: HumanTaskService): NodeJS.Timeout {
  const intervalMs = Math.max(5, config.humanTaskSweepSeconds) * 1000;
  const timer = setInterval(() => {
    void service
      .sweepExpired()
      .then((tasks) => {
        if (tasks.length) {
          console.warn(`[human-task] ${tasks.length} 个任务已过期 → EXPIRED`);
        }
      })
      .catch((err) => {
        console.warn(
          `[human-task] 过期扫描失败：${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });
  }, intervalMs);
  // 不阻止进程退出
  timer.unref?.();
  return timer;
}

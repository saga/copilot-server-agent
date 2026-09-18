import { config } from './config.js';
import { isDatabaseEnabled } from './db/pool.js';
import { ActionService } from './actions/action-service.js';
import { ApprovalService } from './approval/approval-service.js';
import { ExecutionService } from './execution/execution-service.js';
import {
  MemoryEventRepository,
  MemoryExecutionRepository,
} from './execution/memory-repository.js';
import {
  PostgresEventRepository,
  PostgresExecutionRepository,
} from './execution/postgres-repository.js';
import type { EventRepository, ExecutionRepository } from './execution/repository.js';
import { HumanTaskService } from './human-tasks/human-task-service.js';
import { MemoryHumanTaskRepository } from './human-tasks/memory-repository.js';
import { PostgresHumanTaskRepository } from './human-tasks/postgres-repository.js';
import type { HumanTaskRepository } from './human-tasks/repository.js';

/**
 * 依赖装配（唯一一处决定用 PostgreSQL 还是内存实现的地方）。
 *
 *   routes → services → repositories → PostgreSQL | Memory
 *
 * 配了 DATABASE_URL 就走 PG（durable：execution/human task/approval/event 跨重启存活）；
 * 否则内存实现，仅适合单副本本地开发。
 */

const usePostgres = isDatabaseEnabled();

export const executionRepository: ExecutionRepository = usePostgres
  ? new PostgresExecutionRepository()
  : new MemoryExecutionRepository();

export const eventRepository: EventRepository = usePostgres
  ? new PostgresEventRepository()
  : new MemoryEventRepository();

export const humanTaskRepository: HumanTaskRepository = usePostgres
  ? new PostgresHumanTaskRepository()
  : new MemoryHumanTaskRepository();

export const approvalService = new ApprovalService({
  allowInitiatorApproval: config.allowInitiatorApproval,
});

export const actionService = new ActionService({ approval: approvalService });

export const executionService = new ExecutionService({
  repository: executionRepository,
  events: eventRepository,
  actions: actionService,
});

export const humanTaskService = new HumanTaskService({
  repository: humanTaskRepository,
  approval: approvalService,
  onResolved: (task, resolution, decisions) =>
    executionService.onHumanTaskResolved(task, resolution, decisions),
});

executionService.bindHumanTasks(humanTaskService);

export const stateBackend: 'postgres' | 'memory' = usePostgres ? 'postgres' : 'memory';

if (usePostgres) {
  console.log('[wiring] durable state = PostgreSQL（execution/human task/approval/event）');
} else {
  console.warn(
    '[wiring] durable state = 内存（未配 DATABASE_URL）：execution 与审批中的任务在重启后丢失',
  );
}

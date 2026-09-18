import { config } from './config.js';
import { currentBackend, sqliteFilePath } from './db/connection.js';
import { ActionService } from './actions/action-service.js';
import { ApprovalService } from './approval/approval-service.js';
import { ExecutionService } from './execution/execution-service.js';
import {
  MemoryEventRepository,
  MemoryExecutionRepository,
} from './execution/memory-repository.js';
import { SqlEventRepository, SqlExecutionRepository } from './execution/sql-repository.js';
import type { EventRepository, ExecutionRepository } from './execution/repository.js';
import { HumanTaskService } from './human-tasks/human-task-service.js';
import { MemoryHumanTaskRepository } from './human-tasks/memory-repository.js';
import { SqlHumanTaskRepository } from './human-tasks/sql-repository.js';
import type { HumanTaskRepository } from './human-tasks/repository.js';

/**
 * 依赖装配（唯一一处决定用哪个后端的地方）。
 *
 *   routes → services → repositories → SQLite（默认）| PostgreSQL（配 DATABASE_URL）
 *
 * 两种后端共用同一份 SQL 仓储实现，差别只在方言与部署形态；内存实现只给单测用
 * （`COPILOT_STATE_BACKEND=memory` 可强制，用于不落盘的临时验证）。
 */

const useMemory = config.stateBackend === 'memory';
const backend = useMemory ? 'memory' : currentBackend();

export const executionRepository: ExecutionRepository = useMemory
  ? new MemoryExecutionRepository()
  : new SqlExecutionRepository();

export const eventRepository: EventRepository = useMemory
  ? new MemoryEventRepository()
  : new SqlEventRepository();

export const humanTaskRepository: HumanTaskRepository = useMemory
  ? new MemoryHumanTaskRepository()
  : new SqlHumanTaskRepository();

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

export type StateBackend = 'postgres' | 'sqlite' | 'memory';

export const stateBackend: StateBackend = backend;

if (backend === 'memory') {
  console.warn('[wiring] durable state = 内存（COPILOT_STATE_BACKEND=memory）：重启后 execution 与审批中的任务丢失');
} else if (backend === 'postgres') {
  console.log('[wiring] durable state = PostgreSQL（execution/human task/approval/event/ownership）');
} else {
  console.log(`[wiring] durable state = SQLite：${sqliteFilePath()}`);
}

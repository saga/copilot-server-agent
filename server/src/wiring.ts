import { runExecutionTurn } from './agent/agent-execution.js';
import { ActionService } from './actions/action-service.js';
import { ApprovalService } from './approval/approval-service.js';
import {
  CollaborationService,
  MemoryMessageRepository,
  MemoryParticipantRepository,
  MemorySessionEventRepository,
  MessageService,
  ParticipantService,
  SessionCoordinator,
  SessionEventService,
  SqlMessageRepository,
  SqlParticipantRepository,
  SqlSessionEventRepository,
} from './collaboration/index.js';
import { config } from './config.js';
import { currentStateBackend, sqliteFilePath, type StateBackend } from './db/connection.js';
import { ExecutionService } from './execution/execution-service.js';
import {
  MemoryEventRepository,
  MemoryExecutionRepository,
} from './execution/memory-repository.js';
import { SqlEventRepository, SqlExecutionRepository } from './execution/sql-repository.js';
import { bindExecutionSink } from './execution/sink.js';
import type { EventRepository, ExecutionRepository } from './execution/repository.js';
import { HumanTaskService } from './human-tasks/human-task-service.js';
import { MemoryHumanTaskRepository } from './human-tasks/memory-repository.js';
import { SqlHumanTaskRepository } from './human-tasks/sql-repository.js';
import type { HumanTaskRepository } from './human-tasks/repository.js';
import { SessionAccessService } from './services/session-access.js';
import { sessionRegistry } from './services/session-registry.js';
import { sessionService } from './services/session-service.js';

/**
 * 依赖装配（唯一一处决定用哪个后端、哪套实现的地方）。
 *
 *   routes → services → repositories → SQLite（默认）| PostgreSQL（配 DATABASE_URL）
 *
 * 两种 SQL 后端共用同一份仓储实现，差别只在方言与部署形态；内存实现只给单测用
 * （`COPILOT_STATE_BACKEND=memory` 可强制，用于不落盘的临时验证）。
 */

const useMemory = config.stateBackend === 'memory';
const backend: StateBackend = currentStateBackend();

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

// 让 agent-runner / tool-evidence / hooks-events / agent-context 能往"当前 execution"写证据，
// 而它们不必 import 本文件（会成环）。见 execution/sink.ts。
bindExecutionSink(executionService);

export const humanTaskService = new HumanTaskService({
  repository: humanTaskRepository,
  approval: approvalService,
  onResolved: (task, resolution, decisions) =>
    executionService.onHumanTaskResolved(task, resolution, decisions),
});

executionService.bindHumanTasks(humanTaskService);

// ---- 协作层：参与人 / 消息 / 会话事件流 / 队列调度 ----

export const participantRepository = useMemory
  ? new MemoryParticipantRepository()
  : new SqlParticipantRepository();

export const messageRepository = useMemory
  ? new MemoryMessageRepository()
  : new SqlMessageRepository();

export const sessionEventRepository = useMemory
  ? new MemorySessionEventRepository()
  : new SqlSessionEventRepository();

/** 会话访问判定：single 看 owner，shared 看参与人 */
export const sessionAccessService = new SessionAccessService({
  registry: sessionRegistry,
  participants: participantRepository,
});

export const sessionEventService = new SessionEventService(sessionEventRepository);

export const messageService = new MessageService({
  repository: messageRepository,
  access: sessionAccessService,
});

export const participantService = new ParticipantService({
  repository: participantRepository,
  registry: sessionRegistry,
  access: sessionAccessService,
  events: sessionEventService,
});

export const sessionCoordinator = new SessionCoordinator({
  executions: executionService,
  messages: messageService,
  events: sessionEventService,
  run: runExecutionTurn,
  disconnectIdle: (sessionId) => sessionService.disconnectIdleSession(sessionId),
});

export const collaborationService = new CollaborationService({
  access: sessionAccessService,
  messages: messageService,
  events: sessionEventService,
  executions: executionService,
  coordinator: sessionCoordinator,
  attachSingle: async (sessionId, owner) => {
    const session = await sessionService.getOrResumeSession(sessionId, {}, owner);
    void sessionService.touch(sessionId);
    return session;
  },
});

// 建会话即登记 owner 参与人：single / shared 共一张表，访问判定不必按模式分叉
sessionService.bindParticipantRegistrar((input) => participantService.registerOwner(input));

export type { StateBackend };

export const stateBackend: StateBackend = backend;

if (backend === 'memory') {
  console.warn('[wiring] durable state = 内存（COPILOT_STATE_BACKEND=memory）：重启后 execution 与审批中的任务丢失');
} else if (backend === 'postgres') {
  console.log('[wiring] durable state = PostgreSQL（execution/human task/approval/event/ownership/collaboration）');
} else {
  console.log(`[wiring] durable state = SQLite：${sqliteFilePath()}`);
}

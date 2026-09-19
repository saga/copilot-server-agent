import type { CopilotSession } from '@github/copilot-sdk';
import type { ExecutionService } from '../execution/execution-service.js';
import type { ExecutionRecord } from '../execution/types.js';
import type { Principal } from '../services/principal.js';
import type { ResolvedSessionAccess, SessionAccessService } from '../services/session-access.js';
import type { SessionOwner } from '../services/session-registry.js';
import type { MessageService } from './message-service.js';
import type { SessionCoordinator } from './session-coordinator.js';
import type { SessionEventService } from './session-event-service.js';
import { SESSION_EVENT_TYPES as EVT } from './types.js';

/**
 * CollaborationService：会话提交消息的唯一入口，按模式分派。
 *
 *   single  HTTP → execution → 当场跑（由路由持有 SSE 连接）
 *   shared  消息落库 → execution(created) → 入队 → 202 + 会话事件流
 *
 * 这里不碰 Copilot SDK 的运行细节（AgentRunner 的事），也不管审批（ApprovalPolicy 的事）；
 * 它只决定「这次提交属于哪个模式、要不要排队、轮到谁跑」。
 */

export interface SubmitMessageInput {
  sessionId: string;
  principal: Principal;
  prompt: string;
  model?: string;
  clientMessageId?: string;
  streaming?: boolean;
}

export type SubmitMessageResult =
  | {
      mode: 'single';
      access: ResolvedSessionAccess;
      session: CopilotSession;
      execution: ExecutionRecord;
    }
  | {
      mode: 'shared';
      access: ResolvedSessionAccess;
      messageId: string;
      execution: ExecutionRecord;
      /** true = 命中 clientMessageId 幂等键，沿用了上一次的 execution */
      reused: boolean;
    };

export interface CollaborationServiceDeps {
  access: SessionAccessService;
  messages: MessageService;
  events: SessionEventService;
  executions: ExecutionService;
  coordinator: SessionCoordinator;
  /** single 模式的 session 附着（真实现 = sessionService.getOrResumeSession） */
  attachSingle: (sessionId: string, owner: SessionOwner) => Promise<CopilotSession>;
}

export class CollaborationService {
  constructor(private readonly deps: CollaborationServiceDeps) {}

  async submitMessage(input: SubmitMessageInput): Promise<SubmitMessageResult> {
    const access = await this.deps.access.assertCanSend(input.sessionId, input.principal);

    if (access.mode === 'single') {
      const session = await this.deps.attachSingle(input.sessionId, access.owner);
      const execution = await this.deps.executions.create({
        sessionId: input.sessionId,
        owner: access.owner,
        initiatedByUserId: input.principal.userId,
        kind: 'interactive',
        prompt: input.prompt,
        ...(input.model ? { model: input.model } : {}),
        streaming: input.streaming ?? false,
      });
      await this.deps.executions.start(execution.executionId);
      return { mode: 'single', access, session, execution };
    }

    const { message, created } = await this.deps.messages.fromUser({
      sessionId: input.sessionId,
      tenantId: input.principal.tenantId,
      userId: input.principal.userId,
      content: input.prompt,
      ...(input.clientMessageId ? { clientMessageId: input.clientMessageId } : {}),
    });

    // 幂等：同一条 clientMessageId 重试时沿用已有 execution，不再排队
    if (message.executionId) {
      const existing = await this.deps.executions.get(message.executionId);
      if (existing) {
        return {
          mode: 'shared',
          access,
          messageId: message.messageId,
          execution: existing,
          reused: true,
        };
      }
    }

    const execution = await this.deps.executions.create({
      sessionId: input.sessionId,
      // 数据归属是会话 owner；发起人是发消息的那个 participant，两者必须分开记：
      // owner 用来做 resume 归属校验与数据范围，发起人用来做审计与「发起人不能自批」。
      owner: access.owner,
      initiatedByUserId: input.principal.userId,
      kind: 'interactive',
      prompt: input.prompt,
      ...(input.model ? { model: input.model } : {}),
      streaming: false,
      sourceMessageId: message.messageId,
    });
    await this.deps.messages.attachExecution(message.messageId, execution.executionId);

    if (created) {
      await this.deps.events.append({
        sessionId: input.sessionId,
        type: EVT.messageCreated,
        actorType: 'user',
        actorId: input.principal.userId,
        messageId: message.messageId,
        payload: { chars: message.content.length, clientMessageId: message.clientMessageId },
      });
    }
    await this.deps.events.append({
      sessionId: input.sessionId,
      type: EVT.executionQueued,
      actorType: 'user',
      actorId: input.principal.userId,
      executionId: execution.executionId,
      messageId: message.messageId,
    });

    // 后台推进队列：HTTP 立刻返回，结果走会话事件流
    void this.deps.coordinator.drain(input.sessionId).catch((err) => {
      console.error(
        `[collaboration] drain 失败 session=${input.sessionId}：${err instanceof Error ? err.message : String(err)}`,
      );
    });

    return {
      mode: 'shared',
      access,
      messageId: message.messageId,
      execution,
      reused: false,
    };
  }
}

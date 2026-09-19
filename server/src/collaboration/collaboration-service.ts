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

  /**
   * 启动恢复（Pod 重启后调一次）。
   *
   * 两件事，缺一不可：
   *   1. `running`/`resuming` 的执行落成 `interrupted` 终态 —— 进程被杀时它永远停在 running，
   *      而**不能自动重试**（agent 可能已经执行过业务动作，重跑会重复提交）。
   *   2. 重新 drain 还有 `created` 协作 execution 的 session —— 队列数据在库里是 durable 的，
   *      但"谁在跑"（`SessionCoordinator.chains`）是进程内的，重启后没有任何东西会主动唤醒它。
   *      持久化了队列却没有恢复 worker，等于没 durable。
   *
   * 单副本前提下由 index.ts 在 listen 之后调用；多副本需要先落实 DB 租约，否则会重复 drain。
   */
  async recoverPending({ reason }: { reason?: string } = {}): Promise<{
    interrupted: number;
    sessions: number;
  }> {
    const interrupted = await this.deps.executions.recoverInterrupted(reason);
    for (const rec of interrupted) {
      await this.deps.events.append({
        sessionId: rec.sessionId,
        type: EVT.executionInterrupted,
        actorType: 'system',
        executionId: rec.executionId,
        payload: { phase: 'startup' },
      });
    }

    const sessionIds = await this.deps.executions.queuedSessionIds();
    for (const sessionId of sessionIds) {
      // 逐个 drain，互不阻塞：一个 session 的恢复不该卡住其他 session
      void this.deps.coordinator.drain(sessionId).catch((err) => {
        console.error(
          `[collaboration] 恢复 drain 失败 session=${sessionId}：${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }
    return { interrupted: interrupted.length, sessions: sessionIds.length };
  }

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
      // 队列顺序 = 消息顺序：并发提交时两边的先后可能不一致，必须显式带上消息序号
      queueSequence: message.sequence,
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

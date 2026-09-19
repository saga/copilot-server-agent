import type { MessageRepository } from './repository.js';
import type { AgentMessage } from './types.js';
import type { Principal } from '../services/principal.js';
import type { SessionAccessService } from '../services/session-access.js';

/**
 * 会话消息（应用层 transcript）。
 *
 * 它不是 Copilot history 的替代品：Copilot history 是 agent context，这里记的是
 * 「谁在什么时候说了什么」，用于协作展示与审计（runtime session 丢了也查得到）。
 *
 * `clientMessageId` 是幂等键：多人 UI 必然出现「已保存但响应丢失 → 客户端重试」，
 * 没有它就会为同一条消息跑两次 agent turn。
 */

export interface MessageServiceDeps {
  repository: MessageRepository;
  access: Pick<SessionAccessService, 'assertCanView'>;
}

export class MessageService {
  constructor(private readonly deps: MessageServiceDeps) {}

  get repository(): MessageRepository {
    return this.deps.repository;
  }

  /**
   * 人类消息；`created=false` 表示命中幂等键，调用方不得再建 execution。
   * 刻意是 async（而不是同步抛错后返回 promise）：调用方 await / .catch / assert.rejects
   * 都能拿到校验失败，不会变成逃逸的同步异常。
   */
  async fromUser(input: {
    sessionId: string;
    tenantId: string;
    userId: string;
    content: string;
    clientMessageId?: string;
  }): Promise<{ message: AgentMessage; created: boolean }> {
    const content = input.content?.trim();
    if (!content) throw new Error('消息内容不能为空');
    return this.deps.repository.create({
      sessionId: input.sessionId,
      tenantId: input.tenantId,
      actorType: 'user',
      actorId: input.userId,
      content,
      ...(input.clientMessageId ? { clientMessageId: input.clientMessageId } : {}),
      createdAt: new Date().toISOString(),
    });
  }

  /** agent 终稿消息（写进同一条会话时间线） */
  async fromAgent(input: {
    sessionId: string;
    tenantId: string;
    content: string;
    executionId?: string;
  }): Promise<AgentMessage> {
    const { message } = await this.deps.repository.create({
      sessionId: input.sessionId,
      tenantId: input.tenantId,
      actorType: 'agent',
      content: input.content,
      ...(input.executionId ? { executionId: input.executionId } : {}),
      createdAt: new Date().toISOString(),
    });
    return message;
  }

  attachExecution(messageId: string, executionId: string): Promise<void> {
    return this.deps.repository.attachExecution(messageId, executionId);
  }

  get(messageId: string): Promise<AgentMessage | undefined> {
    return this.deps.repository.get(messageId);
  }

  async list(sessionId: string, principal: Principal, limit = 100): Promise<AgentMessage[]> {
    await this.deps.access.assertCanView(sessionId, principal);
    return this.deps.repository.list(sessionId, limit);
  }
}

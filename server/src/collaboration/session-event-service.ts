import { config } from '../config.js';
import { redactSecrets } from '../execution/redact.js';
import type { SessionEventRepository } from './repository.js';
import { EPHEMERAL_SESSION_EVENT_TYPES, type SessionEvent } from './types.js';

/**
 * 会话事件流。
 *
 *   append（落库 + 推给订阅者） / publish（只推给订阅者）
 *
 * 与 execution_event 的分工：
 *   execution_event  这次 execution 发生了什么（审计证据链，长期保存）
 *   session_event    这个会话对所有参与者发生了什么（协作时间线 + SSE 恢复游标）
 *
 * token 级 delta 走 publish，不落库：每个 delta 写一行会造成巨大写放大。
 * 事件只订阅一个进程内广播（单副本部署）；多副本需要把 publish 换成 PG 通知或消息总线。
 *
 * payload 与审计证据同规矩：脱敏 + 体积上限，不存敏感全文。
 */

export type SessionEventListener = (event: SessionEvent) => void;

export class SessionEventService {
  private listeners = new Map<string, Set<SessionEventListener>>();

  constructor(private readonly repository: SessionEventRepository) {}

  /** 落库并广播（durable：支持断线重连后按游标补回） */
  async append(input: {
    sessionId: string;
    type: string;
    actorType: SessionEvent['actorType'];
    actorId?: string;
    executionId?: string;
    messageId?: string;
    payload?: Record<string, unknown>;
  }): Promise<SessionEvent> {
    const payload = this.sanitize(input.payload);
    const event = await this.repository.append({
      sessionId: input.sessionId,
      type: input.type,
      actorType: input.actorType,
      ...(input.actorId ? { actorId: input.actorId } : {}),
      ...(input.executionId ? { executionId: input.executionId } : {}),
      ...(input.messageId ? { messageId: input.messageId } : {}),
      ...(payload ? { payload } : {}),
      createdAt: new Date().toISOString(),
    });
    this.broadcast(event);
    return event;
  }

  /** 瞬时事件（assistant.delta 等）：只推给在线订阅者，不落库；没人订阅时直接返回 */
  publish(sessionId: string, type: string, payload?: Record<string, unknown>): void {
    if (!this.listeners.get(sessionId)?.size) return;
    this.broadcast({
      eventId: '',
      sessionId,
      sequence: 0,
      type,
      actorType: 'agent',
      ...(payload ? { payload } : {}),
      createdAt: new Date().toISOString(),
    });
  }

  /** cursor 回放：sequence 严格大于 afterSequence 的事件（升序） */
  listAfter(sessionId: string, afterSequence: number, limit = 500): Promise<SessionEvent[]> {
    return this.repository.listAfter(sessionId, afterSequence, limit);
  }

  subscribe(sessionId: string, listener: SessionEventListener): () => void {
    const set = this.listeners.get(sessionId) ?? new Set<SessionEventListener>();
    set.add(listener);
    this.listeners.set(sessionId, set);
    return () => {
      const current = this.listeners.get(sessionId);
      if (!current) return;
      current.delete(listener);
      if (!current.size) this.listeners.delete(sessionId);
    };
  }

  subscriberCount(sessionId: string): number {
    return this.listeners.get(sessionId)?.size ?? 0;
  }

  private broadcast(event: SessionEvent): void {
    for (const listener of this.listeners.get(event.sessionId) ?? []) {
      try {
        listener(event);
      } catch {
        // 单个订阅者报错不影响其他订阅者与写入路径
      }
    }
  }

  private sanitize(
    payload?: Record<string, unknown>,
  ): Record<string, unknown> | undefined {
    if (!payload) return undefined;
    const redacted = redactSecrets(payload) as Record<string, unknown>;
    const size = JSON.stringify(redacted)?.length ?? 0;
    if (size > config.evidenceMaxChars) return { truncated: true, chars: size };
    return redacted;
  }
}

export { EPHEMERAL_SESSION_EVENT_TYPES };

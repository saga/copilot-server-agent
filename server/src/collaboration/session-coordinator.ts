import type { ExecutionService } from '../execution/execution-service.js';
import type { ExecutionRecord } from '../execution/types.js';
import type { MessageService } from './message-service.js';
import type { SessionEventService } from './session-event-service.js';
import {
  EPHEMERAL_SESSION_EVENT_TYPES as EPHEMERAL,
  SESSION_EVENT_TYPES as EVT,
} from './types.js';

/**
 * SessionCoordinator：决定一个 session 什么时候允许跑 agent turn、下一条跑什么。
 *
 *   shared  HTTP → 消息 → execution(created) → 队列 → coordinator → AgentRunner
 *   single  直接执行（不经过队列）
 *
 * 队列就是 `agent_execution` 本身：`created` 状态即「排队中」，不需要另建队列表。
 * 同一 session 的 drain 串行排队（链式），因此不会丢唤醒；per-session 并发恒为 1，
 * 而跨 session 仍可并行（外层还有全局并发闸门）。
 *
 * 多副本部署时这份「谁在跑」是进程内状态：需要换成 DB 租约 + runtime affinity，
 * 见 docs/architecture.md。
 */

export interface ExecutionRunInput {
  execution: ExecutionRecord;
  prompt: string;
  onDelta?: (delta: string) => void;
  onAssistantMessage?: (content: string) => void;
}

/** 真实现走 sessionService + AgentRunner；单测注入 fake，不需要拉起 Copilot runtime */
export type ExecutionRunner = (
  input: ExecutionRunInput,
) => Promise<{ content: string; chars: number }>;

export interface SessionCoordinatorDeps {
  executions: ExecutionService;
  messages: MessageService;
  events: SessionEventService;
  run: ExecutionRunner;
  /** 等待人工期间释放 SDK session（不配则保持附着） */
  disconnectIdle?: (sessionId: string) => Promise<unknown>;
}

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export class SessionCoordinator {
  /** session → 队尾（链式串行，保证不丢唤醒） */
  private chains = new Map<string, Promise<void>>();

  constructor(private readonly deps: SessionCoordinatorDeps) {}

  /**
   * 推进队列，直到没有排队项。
   * 同一 session 的多次调用会串行排队：后到的那次即使发现队列已空也只是空跑一遍。
   */
  async drain(sessionId: string): Promise<void> {
    const previous = this.chains.get(sessionId) ?? Promise.resolve();
    const current = previous.then(
      () => this.drainLoop(sessionId),
      () => this.drainLoop(sessionId),
    );
    this.chains.set(sessionId, current);
    try {
      return await current;
    } finally {
      if (this.chains.get(sessionId) === current) this.chains.delete(sessionId);
    }
  }

  /** 跑一个已 start 的 execution（single / 后台 job 路径）：不阻塞调用方 */
  runDetached(execution: ExecutionRecord, prompt: string): void {
    void this.run(execution, prompt).catch((err) => {
      console.error(`[coordinator] execution ${execution.executionId} 收尾异常：${errMsg(err)}`);
    });
  }

  /** 取消排队中的 execution（已经开始跑的不在这里处理，走 cancel API） */
  async cancelPending(sessionId: string, executionId: string): Promise<boolean> {
    const rec = await this.deps.executions.get(executionId);
    if (!rec || rec.status !== 'created') return false;
    await this.deps.executions.cancel(executionId);
    await this.deps.events.append({
      sessionId,
      type: EVT.executionCancelled,
      actorType: 'system',
      executionId,
    });
    return true;
  }

  private async drainLoop(sessionId: string): Promise<void> {
    for (;;) {
      const next = await this.deps.executions.nextQueued(sessionId);
      if (!next) return;
      // 取活靠 `status = 'created'`。若这一条没能被移出 created（例如库写失败），
      // 再取一次还是它 —— 会变成"空转刷事件"的死循环。所以推进失败就停下，
      // 留给下一次 drain（下一条消息 / 重试）再处理。
      const progressed = await this.executeQueued(next);
      if (!progressed) return;
    }
  }

  /** @returns true = 这条排队项已被移出 `created`（跑完或置为终态），可以取下一个 */
  private async executeQueued(execution: ExecutionRecord): Promise<boolean> {
    const sessionId = execution.sessionId;
    let prompt: string;
    try {
      prompt = await this.promptFor(execution);
      await this.deps.executions.start(execution.executionId);
    } catch (err) {
      // 排队项跑不起来：缺来源消息 / 已被取消 / 状态被外部改动 / 库出错。
      // 留痕并把它落到 failed，不能只记事件就 return —— 状态留 created 会被反复取出。
      return this.failQueued(execution, err);
    }
    await this.deps.events.append({
      sessionId,
      type: EVT.executionStarted,
      actorType: 'system',
      executionId: execution.executionId,
      ...(execution.sourceMessageId ? { messageId: execution.sourceMessageId } : {}),
    });
    await this.run(execution, prompt);
    return true;
  }

  /**
   * 把跑不起来的排队项置为 failed，并记录原因。
   * 返回它是否真的离开了 `created`（写库失败时为 false，调用方据此停止本轮 drain）。
   */
  private async failQueued(execution: ExecutionRecord, err: unknown): Promise<boolean> {
    const reason = errMsg(err);
    try {
      await this.deps.executions.fail(execution.executionId, err);
    } catch (failErr) {
      console.error(
        `[coordinator] execution ${execution.executionId} 置为 failed 失败：${errMsg(failErr)}`,
      );
    }
    try {
      await this.deps.events.append({
        sessionId: execution.sessionId,
        type: EVT.executionFailed,
        actorType: 'system',
        executionId: execution.executionId,
        payload: { error: reason, phase: 'start' },
      });
    } catch (appendErr) {
      console.error(`[coordinator] 写 execution.failed 事件失败：${errMsg(appendErr)}`);
    }
    const after = await this.deps.executions.get(execution.executionId);
    return after?.status !== 'created';
  }

  /** 队列项的 prompt 来自它绑定的 session 消息（execution 上只留脱敏预览，不能当输入用） */
  private async promptFor(execution: ExecutionRecord): Promise<string> {
    if (!execution.sourceMessageId) {
      throw new Error(`execution "${execution.executionId}" 没有 sourceMessageId，无法从队列恢复输入`);
    }
    const message = await this.deps.messages.get(execution.sourceMessageId);
    if (!message) {
      throw new Error(`execution "${execution.executionId}" 的来源消息不存在：${execution.sourceMessageId}`);
    }
    return message.content;
  }

  private async run(execution: ExecutionRecord, prompt: string): Promise<void> {
    const sessionId = execution.sessionId;
    try {
      const result = await this.deps.run({
        execution,
        prompt,
        onDelta: (delta) =>
          this.deps.events.publish(sessionId, EPHEMERAL.assistantDelta, {
            delta,
            executionId: execution.executionId,
          }),
        onAssistantMessage: (content) => {
          void this.recordAssistantMessage(execution, content).catch((err) => {
            console.warn(`[coordinator] 写入 agent 消息失败：${errMsg(err)}`);
          });
        },
      });
      await this.deps.executions.complete(execution.executionId, {
        contentChars: result.chars || result.content.length,
        result: { content: result.content },
      });
      await this.deps.events.append({
        sessionId,
        type: EVT.executionCompleted,
        actorType: 'system',
        executionId: execution.executionId,
      });
    } catch (err) {
      await this.deps.executions.fail(execution.executionId, err);
      await this.deps.events.append({
        sessionId,
        type: EVT.executionFailed,
        actorType: 'system',
        executionId: execution.executionId,
        payload: { error: errMsg(err) },
      });
    } finally {
      await this.afterRun(execution.executionId, sessionId);
    }
  }

  /** agent 终稿进同一条会话时间线；随后所有人从事件流里看到 */
  private async recordAssistantMessage(
    execution: ExecutionRecord,
    content: string,
  ): Promise<void> {
    const message = await this.deps.messages.fromAgent({
      sessionId: execution.sessionId,
      tenantId: execution.tenantId,
      content,
      executionId: execution.executionId,
    });
    await this.deps.events.append({
      sessionId: execution.sessionId,
      type: EVT.assistantMessage,
      actorType: 'agent',
      executionId: execution.executionId,
      messageId: message.messageId,
      payload: { chars: content.length },
    });
  }

  /**
   * 等待人工期间释放 SDK session（审批可能几小时，不该占着 runtime 与内存）。
   * 释放后仍可 resume：durable 状态在库里。
   */
  private async afterRun(executionId: string, sessionId: string): Promise<void> {
    try {
      const rec = await this.deps.executions.get(executionId);
      if (!rec) return;
      if (rec.status !== 'waiting_for_approval' && rec.status !== 'waiting_for_input') return;
      await this.deps.events.append({
        sessionId,
        type: EVT.executionWaiting,
        actorType: 'system',
        executionId,
        ...(rec.waitReason ? { payload: { waitReason: rec.waitReason } } : {}),
      });
      await this.deps.disconnectIdle?.(sessionId);
    } catch (err) {
      console.warn(`[coordinator] execution ${executionId} 等待态收尾失败：${errMsg(err)}`);
    }
  }
}

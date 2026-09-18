import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import type { SessionOwner } from '../services/session-registry.js';
import { LlmUsageAccumulator, type LlmUsageSample, type UsageRecord } from './usage.js';
import { preview } from './redact.js';

/**
 * execution = 一次 agent turn（一个 HTTP chat 请求）。
 *
 * session 与 execution 是两层东西：一个 session 会有很多 turn，
 * 所以审计/指标/工具证据/usage/取消都必须挂在 executionId 上，不能只挂 sessionId。
 *
 *   session ── execution #1 ── LLM ── tool ── tool
 *          └─ execution #2 ── LLM ── tool
 *
 * 当前实现：进程内 LRU 环（纯内存，重启即清空）。要长期审计把 finish() 的记录
 * 外发到日志/审计库即可，调用方不变。
 */

export type ExecutionStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export interface ToolCallRecord {
  toolCallId: string;
  toolName: string;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  /** allow=过守卫并进入执行；deny=被 workspace 守卫拦下 */
  decision: 'allow' | 'deny';
  deniedReason?: string;
  /** 脱敏 + 截断后的参数预览 */
  arguments?: string;
  /** 脱敏 + 截断后的结果预览 */
  result?: string;
  error?: string;
  isError: boolean;
}

export interface ExecutionRecord {
  executionId: string;
  sessionId: string;
  tenantId: string;
  userId: string;
  startedAt: string;
  completedAt?: string;
  status: ExecutionStatus;
  streaming: boolean;
  model?: string;
  /** prompt 只存脱敏预览（原文可能含密钥/PII，不进审计） */
  promptPreview?: string;
  durationMs?: number;
  error?: string;
  /** 最终回复的字符数（内容本身不落审计） */
  contentChars?: number;
  usage?: UsageRecord;
  toolCalls: ToolCallRecord[];
  /** 超出 toolCalls 上限后未记录的调用数 */
  toolCallsOmitted?: number;
}

export interface StartExecutionInput {
  sessionId: string;
  owner: SessionOwner;
  prompt?: string;
  model?: string;
  streaming: boolean;
}

export interface FinishExecutionInput {
  status?: Exclude<ExecutionStatus, 'running'>;
  error?: string;
  contentChars?: number;
}

export class ExecutionStore {
  private records = new Map<string, ExecutionRecord>();
  /** usage 是 execution-local 的：绝不挂在 store 上做全局累加 */
  private usages = new Map<string, LlmUsageAccumulator>();
  /** session → 当前 execution（同一 session 的 turn 被 session lock 串行化，故最多一个） */
  private active = new Map<string, string>();
  /** session → 已开始未结束的 tool call（LIFO：sub-agent 嵌套调用按栈配对） */
  private pending = new Map<string, ToolCallRecord[]>();
  private seq = new Map<string, number>();

  start(input: StartExecutionInput): ExecutionRecord {
    const executionId = `ex_${randomUUID()}`;
    const record: ExecutionRecord = {
      executionId,
      sessionId: input.sessionId,
      tenantId: input.owner.tenantId,
      userId: input.owner.userId,
      startedAt: new Date().toISOString(),
      status: 'running',
      streaming: input.streaming,
      ...(input.model ? { model: input.model } : {}),
      ...(input.prompt ? { promptPreview: preview(input.prompt, config.evidenceMaxChars) } : {}),
      toolCalls: [],
    };
    this.records.set(executionId, record);
    this.usages.set(executionId, new LlmUsageAccumulator());
    this.evict();
    return record;
  }

  get(executionId: string): ExecutionRecord | undefined {
    return this.records.get(executionId);
  }

  /** 终态只写一次：running → completed/failed/cancelled 后不再改 */
  finish(executionId: string, input: FinishExecutionInput = {}): void {
    const rec = this.records.get(executionId);
    if (!rec || rec.status !== 'running') return;
    const now = new Date().toISOString();
    rec.status = input.status ?? 'completed';
    rec.completedAt = now;
    rec.durationMs = new Date(now).getTime() - new Date(rec.startedAt).getTime();
    if (input.error) rec.error = input.error;
    if (typeof input.contentChars === 'number') rec.contentChars = input.contentChars;
  }

  addUsage(executionId: string, sample: LlmUsageSample): void {
    const acc = this.usages.get(executionId);
    if (!acc) return;
    acc.add(sample);
    const rec = this.records.get(executionId);
    if (rec) rec.usage = acc.snapshot();
  }

  setContextWindow(executionId: string, tokenLimit: number | undefined): void {
    const acc = this.usages.get(executionId);
    if (!acc) return;
    acc.setContextWindow(tokenLimit);
    const rec = this.records.get(executionId);
    if (rec) rec.usage = acc.snapshot();
  }

  /** turn 开始时挂上：tool 证据 hook 靠它把调用归到当前 execution */
  setActive(sessionId: string, executionId: string): void {
    this.active.set(sessionId, executionId);
  }

  clearActive(sessionId: string, executionId?: string): void {
    if (executionId && this.active.get(sessionId) !== executionId) return;
    this.active.delete(sessionId);
  }

  activeFor(sessionId: string): string | undefined {
    return this.active.get(sessionId);
  }

  /** 进入执行：返回带 toolCallId 的记录（无活跃 execution 时仍生成 id，只是不挂到任何 execution） */
  beginToolCall(input: {
    sessionId: string;
    toolName: string;
    args?: unknown;
  }): ToolCallRecord {
    const executionId = this.active.get(input.sessionId);
    const call: ToolCallRecord = {
      toolCallId: this.nextToolCallId(executionId),
      toolName: input.toolName,
      startedAt: new Date().toISOString(),
      decision: 'allow',
      isError: false,
      ...(input.args !== undefined
        ? { arguments: preview(input.args, config.evidenceMaxChars) }
        : {}),
    };
    if (executionId) {
      const stack = this.pending.get(input.sessionId) ?? [];
      stack.push(call);
      this.pending.set(input.sessionId, stack);
    }
    return call;
  }

  /** 被 workspace 守卫拦下：直接落终态（不进 pending，不会有 post hook） */
  denyToolCall(input: {
    sessionId: string;
    toolName: string;
    args?: unknown;
    reason: string;
  }): ToolCallRecord {
    const call = this.beginToolCall(input);
    call.decision = 'deny';
    call.deniedReason = input.reason;
    call.endedAt = call.startedAt;
    call.durationMs = 0;
    this.attach(input.sessionId, call);
    return call;
  }

  /** 执行结束（成功走 onPostToolUse，失败走 onPostToolUseFailure） */
  endToolCall(input: {
    sessionId: string;
    toolName: string;
    result?: unknown;
    error?: string;
    isError?: boolean;
  }): ToolCallRecord | undefined {
    const stack = this.pending.get(input.sessionId) ?? [];
    let idx = -1;
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i]!.toolName === input.toolName) {
        idx = i;
        break;
      }
    }
    const call = idx >= 0 ? stack.splice(idx, 1)[0]! : stack.pop();
    this.pending.set(input.sessionId, stack);
    // pre hook 没跑到（守卫未挂载/事件错位）时补一条，保证 post 侧也有证据
    const record =
      call ??
      this.beginToolCall({ sessionId: input.sessionId, toolName: input.toolName });
    const endedAt = new Date().toISOString();
    record.endedAt = endedAt;
    record.durationMs =
      new Date(endedAt).getTime() - new Date(record.startedAt).getTime();
    record.isError = input.isError ?? false;
    if (input.result !== undefined) {
      record.result = preview(input.result, config.evidenceMaxChars);
    }
    if (input.error) record.error = preview(input.error, config.evidenceMaxChars);
    this.attach(input.sessionId, record);
    return record;
  }

  list(filter: { sessionId?: string; owner?: SessionOwner; limit?: number } = {}): ExecutionRecord[] {
    const all = [...this.records.values()];
    const matched = all.filter((r) => {
      if (filter.sessionId && r.sessionId !== filter.sessionId) return false;
      if (filter.owner && (r.tenantId !== filter.owner.tenantId || r.userId !== filter.owner.userId)) {
        return false;
      }
      return true;
    });
    const limit = Math.max(1, Math.min(500, filter.limit ?? 50));
    return matched.slice(-limit);
  }

  stats(): { tracked: number; running: number; toolCalls: number } {
    let running = 0;
    let toolCalls = 0;
    for (const r of this.records.values()) {
      if (r.status === 'running') running += 1;
      toolCalls += r.toolCalls.length + (r.toolCallsOmitted ?? 0);
    }
    return { tracked: this.records.size, running, toolCalls };
  }

  /** 挂到当前 execution；没有活跃 execution（hook 发生在 turn 之外）就只留 hook 事件 */
  private attach(sessionId: string, call: ToolCallRecord): void {
    const executionId = this.active.get(sessionId);
    if (!executionId) return;
    const rec = this.records.get(executionId);
    if (!rec) return;
    if (rec.toolCalls.length >= config.maxToolCallsPerExecution) {
      rec.toolCallsOmitted = (rec.toolCallsOmitted ?? 0) + 1;
      return;
    }
    rec.toolCalls.push(call);
  }

  private nextToolCallId(executionId: string | undefined): string {
    if (!executionId) return `tc_${randomUUID().slice(0, 8)}`;
    const n = (this.seq.get(executionId) ?? 0) + 1;
    this.seq.set(executionId, n);
    return `${executionId}-t${n}`;
  }

  /** 超出上限按插入顺序淘汰最旧的（Map 保序）；usage/pending 一并回收 */
  private evict(): void {
    while (this.records.size > config.maxTrackedExecutions) {
      const oldest = this.records.keys().next().value;
      if (oldest === undefined) return;
      this.records.delete(oldest);
      this.usages.delete(oldest);
      this.seq.delete(oldest);
    }
  }
}

export const executionStore = new ExecutionStore();

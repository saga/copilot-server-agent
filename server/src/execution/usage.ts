/**
 * LLM usage 累加器：每个 execution 一个实例（execution-local）。
 *
 * 关键点是不要在 service/executor 上挂全局累加状态：并发 session 与并发
 * execution 会互相串数据。这里每个 execution 自己 new 一个，结束后快照进
 * ExecutionRecord.usage。
 */

/** 单条 assistant.usage 事件里我们关心的字段（结构对齐 SDK 的 AssistantUsageData） */
export interface LlmUsageSample {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  /** SDK 字段名为 duration（毫秒） */
  duration?: number;
  model?: string;
  cost?: number;
}

export interface UsageRecord {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  /** 全部 LLM 调用耗时之和（毫秒） */
  durationMs: number;
  llmCalls: number;
  /** 本次 execution 实际用到的模型（sub-agent 换模型时会有多个） */
  models: string[];
  /** 模型上下文窗口上限（来自 session.usage_info） */
  contextWindow?: number;
  /** SDK 给了 cost 才带（多数通道不返回） */
  cost?: number;
}

const num = (v: number | undefined): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export class LlmUsageAccumulator {
  private acc = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    durationMs: 0,
  };
  private calls = 0;
  private models = new Set<string>();
  private contextWindow?: number;
  private cost?: number;

  add(sample: LlmUsageSample): void {
    this.calls += 1;
    this.acc.inputTokens += num(sample.inputTokens);
    this.acc.outputTokens += num(sample.outputTokens);
    this.acc.cacheReadTokens += num(sample.cacheReadTokens);
    this.acc.cacheWriteTokens += num(sample.cacheWriteTokens);
    this.acc.reasoningTokens += num(sample.reasoningTokens);
    this.acc.durationMs += num(sample.duration);
    if (sample.model) this.models.add(sample.model);
    if (typeof sample.cost === 'number' && Number.isFinite(sample.cost)) {
      this.cost = (this.cost ?? 0) + sample.cost;
    }
  }

  setContextWindow(tokenLimit: number | undefined): void {
    if (typeof tokenLimit === 'number' && Number.isFinite(tokenLimit)) {
      this.contextWindow = tokenLimit;
    }
  }

  snapshot(): UsageRecord {
    return {
      ...this.acc,
      llmCalls: this.calls,
      models: [...this.models],
      ...(this.contextWindow !== undefined ? { contextWindow: this.contextWindow } : {}),
      ...(this.cost !== undefined ? { cost: this.cost } : {}),
    };
  }
}

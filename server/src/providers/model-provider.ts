import type { ModelInfo, ProviderConfig } from '@github/copilot-sdk';

/**
 * 模型 Provider 抽象（对应官方 BYOK 文档）：
 * https://docs.github.com/en/enterprise-cloud@latest/copilot/how-tos/copilot-sdk/auth/byok
 *
 * - 直连 Copilot（GitHub 认证）：`buildProviderConfig()` 返回 undefined，
 *   会话走默认 Copilot 通道，模型列表由 CLI runtime 提供。
 * - BYOK（自带第三方 key，如 DeepSeek）：返回 ProviderConfig
 *   `{ type, baseUrl, apiKey, wireApi }`，且必须同时提供自定义模型列表，
 *   对应文档中的 client 级 `onListModels`。
 */
export abstract class ModelProvider {
  /** 唯一标识，如 'copilot' | 'deepseek'，由 COPILOT_PROVIDER 选择 */
  abstract readonly id: string;
  abstract readonly displayName: string;
  /** 未指定 model 时的默认值；BYOK 下 model 必填（文档 Troubleshooting），故总是会被使用 */
  abstract readonly defaultModel: string;
  /** false 表示缺必要配置（如 API key 未填），/api/providers 会标出，启动建会话时抛错 */
  abstract isConfigured(): boolean;
  /** 配置缺失时的可读报错，指导用户去 .env 补什么 */
  abstract missingConfigHint(): string;
  abstract buildProviderConfig(): ProviderConfig | undefined;
  /**
   * 自定义模型列表（BYOK 用，对应文档 onListModels）。
   * 返回 null 表示“委托给 CLI runtime 的 models.list”，即直连 Copilot 模式。
   */
  abstract getCustomModels(): ModelInfo[] | null;

  /** 解析一次建会话请求：补默认 model、BYOK 强制 model 必填、拼 systemMessage */
  resolve(req: { model?: string; systemMessage?: string }): {
    model: string;
    provider: ProviderConfig | undefined;
    systemMessage?: { content: string };
  } {
    if (!this.isConfigured()) throw new Error(this.missingConfigHint());
    const model = req.model?.trim() || this.defaultModel;
    // BYOK 下文档明确要求 model 必填；defaultModel 已保证此处非空
    if (!model) throw new Error(`[${this.id}] 建会话必须指定 model`);
    return {
      model,
      provider: this.buildProviderConfig(),
      ...(req.systemMessage ? { systemMessage: { content: req.systemMessage } } : {}),
    };
  }
}

export interface ProviderStatus {
  id: string;
  displayName: string;
  defaultModel: string;
  configured: boolean;
  active: boolean;
  /** 未配置时的缺失项提示，前端可直接展示 */
  hint?: string;
}

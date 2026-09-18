import type { ModelInfo, ProviderConfig } from '@github/copilot-sdk';
import { config } from '../config.js';
import { ModelProvider } from './model-provider.js';

/**
 * DeepSeek BYOK 实现（OpenAI 兼容 + Chat Completions）。
 * 注意：deepseek-chat / deepseek-reasoner 已于 2026-07-24 退役，
 * 当前可用 deepseek-v4-flash（默认）/ deepseek-v4-pro，均为 1M 上下文。
 */
export class DeepSeekProvider extends ModelProvider {
  readonly id = 'deepseek';
  readonly displayName = 'DeepSeek (BYOK)';
  readonly defaultModel = config.deepseekModel;

  isConfigured(): boolean {
    return !!config.deepseekApiKey;
  }

  missingConfigHint(): string {
    return '[deepseek] 缺少 DEEPSEEK_API_KEY，请在 server/.env 中填入后重启（去 https://platform.deepseek.com 申请）';
  }

  buildProviderConfig(): ProviderConfig {
    if (!this.isConfigured()) throw new Error(this.missingConfigHint());
    return {
      type: 'openai',
      baseUrl: config.deepseekBaseUrl,
      apiKey: config.deepseekApiKey as string,
      wireApi: 'completions',
    };
  }

  getCustomModels(): ModelInfo[] {
    // 对应官方 BYOK 文档的 client 级 onListModels：CLI 不知道第三方模型，需自报
    const base = {
      capabilities: {
        supports: { vision: false, reasoningEffort: false },
        limits: { max_context_window_tokens: 1_000_000, max_output_tokens: 384_000 },
      },
    } as const;
    return [
      { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash（默认/高性价比）', ...base },
      { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro（更强推理）', ...base },
    ] as ModelInfo[];
  }
}

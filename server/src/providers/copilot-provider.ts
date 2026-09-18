import type { ModelInfo, ProviderConfig } from '@github/copilot-sdk';
import { config } from '../config.js';
import { ModelProvider } from './model-provider.js';

/** 直连 Copilot：走 GitHub 认证（已登录用户或 GITHUB_TOKEN），不使用 BYOK provider。 */
export class CopilotProvider extends ModelProvider {
  readonly id = 'copilot';
  readonly displayName = 'GitHub Copilot';
  readonly defaultModel = config.defaultModel;

  isConfigured(): boolean {
    return true;
  }

  missingConfigHint(): string {
    return '';
  }

  buildProviderConfig(): ProviderConfig | undefined {
    return undefined;
  }

  getCustomModels(): ModelInfo[] | null {
    // 委托给 CLI runtime 的 models.list
    return null;
  }
}

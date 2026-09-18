import { config } from '../config.js';
import type { ModelProvider, ProviderStatus } from './model-provider.js';
import { CopilotProvider } from './copilot-provider.js';
import { DeepSeekProvider } from './deepseek-provider.js';

/**
 * Provider 注册表。新增厂商时：
 * 1. 新建 `<vendor>-provider.ts` 继承 ModelProvider
 * 2. 在此注册 + 在 config.ts 加对应 env
 * 3. 在 server/.env.example 补充说明
 */
const registry: ModelProvider[] = [new CopilotProvider(), new DeepSeekProvider()];

export function getProvider(id: string): ModelProvider {
  const found = registry.find((p) => p.id === id);
  if (!found) {
    throw new Error(
      `未知 COPILOT_PROVIDER="${id}"，可选：${registry.map((p) => p.id).join(' | ')}`,
    );
  }
  return found;
}

/** 当前生效的 provider，由 COPILOT_PROVIDER 环境变量选择（默认 copilot） */
export function getActiveProvider(): ModelProvider {
  return getProvider(config.provider);
}

export function listProviderStatus(): ProviderStatus[] {
  const active = config.provider;
  return registry.map((p) => {
    const configured = p.isConfigured();
    return {
      id: p.id,
      displayName: p.displayName,
      defaultModel: p.defaultModel,
      configured,
      active: p.id === active,
      ...(configured ? {} : { hint: p.missingConfigHint() }),
    };
  });
}

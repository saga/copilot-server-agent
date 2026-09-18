import { CopilotClient, approveAll } from '@github/copilot-sdk';
import type { CopilotSession } from '@github/copilot-sdk';
import { config } from '../config.js';

/**
 * Copilot SDK 单例封装。
 * - Express 启动时 lazy 初始化 client
 * - 每个前端会话对应一个 CopilotSession，用 Map 做内存管理（生产可换 Redis）
 */
class CopilotService {
  private client: CopilotClient | null = null;
  private starting: Promise<CopilotClient> | null = null;
  private sessions = new Map<string, CopilotSession>();
  private lastError: string | null = null;

  async getClient(): Promise<CopilotClient> {
    if (this.client) return this.client;
    if (this.starting) return this.starting;

    this.starting = (async () => {
      const client = new CopilotClient({
        gitHubToken: config.githubToken,
        // 未提供 token 时默认使用 copilot CLI 已登录用户
        useLoggedInUser: config.githubToken ? false : true,
        workingDirectory: config.workingDirectory,
      });
      await client.start();
      this.client = client;
      this.lastError = null;
      this.starting = null;
      return client;
    })().catch((err) => {
      this.starting = null;
      this.lastError = err instanceof Error ? err.message : String(err);
      throw err;
    });

    return this.starting;
  }

  getStatus(): 'connected' | 'disconnected' | 'error' {
    if (this.client) return 'connected';
    if (this.lastError) return 'error';
    return 'disconnected';
  }

  getLastError(): string | null {
    return this.lastError;
  }

  async listModels() {
    const client = await this.getClient();
    // SDK 通过 client.listModels() 暴露可用模型
    const maybe = client as unknown as { listModels?: () => Promise<unknown> };
    if (typeof maybe.listModels === 'function') {
      return maybe.listModels();
    }
    return [];
  }

  async createSession(opts: { model?: string; systemMessage?: string }): Promise<CopilotSession> {
    const client = await this.getClient();
    const session = await client.createSession({
      model: opts.model || config.defaultModel,
      streaming: true,
      onPermissionRequest: approveAll,
      ...(opts.systemMessage
        ? { systemMessage: { content: opts.systemMessage } }
        : {}),
    });
    this.sessions.set(session.sessionId, session);
    return session;
  }

  getSession(sessionId: string): CopilotSession | undefined {
    return this.sessions.get(sessionId);
  }

  async destroySession(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    try {
      await session.disconnect();
    } finally {
      this.sessions.delete(sessionId);
    }
    return true;
  }

  async stop() {
    for (const [, s] of this.sessions) {
      try {
        await s.disconnect();
      } catch {
        // ignore per-session errors on shutdown
      }
    }
    this.sessions.clear();
    if (this.client) {
      await this.client.stop();
      this.client = null;
    }
  }
}

export const copilotService = new CopilotService();

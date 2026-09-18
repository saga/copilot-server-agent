import { createHash } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';

/**
 * Session 级 workspace 管理（Level 1 并发隔离）。
 *
 * - 1 session = 1 workspace 目录，路径是 sessionId 的确定性函数
 *   （sha256 截断），重启/换 Pod 后 resume 仍回到同一目录，无需额外映射表
 * - 目录在 create/resume 时 `mkdir -p` 确保存在；彻底删除时才清理
 * - 注意：workingDirectory 是软隔离（默认 cwd），不是 OS sandbox；
 *   强隔离（不可信代码）需要 per-request container，见下一阶段
 */
export class WorkspaceService {
  private readonly rootDir: string;

  constructor(rootDir: string = config.workspaceRoot) {
    this.rootDir = path.resolve(rootDir);
  }

  /** workspace 路径（纯函数，不碰磁盘；key 为 hex，无路径穿越风险） */
  pathFor(sessionId: string): string {
    return path.join(this.rootDir, this.key(sessionId));
  }

  /** 确保 workspace 存在并返回路径（create 与 resume 共用） */
  async create(sessionId: string): Promise<string> {
    const dir = this.pathFor(sessionId);
    await mkdir(dir, { recursive: true });
    return dir;
  }

  /** 彻底删除 workspace（仅 permanent delete 调用；disconnect/resume 保留） */
  async remove(sessionId: string): Promise<void> {
    await rm(this.pathFor(sessionId), { recursive: true, force: true });
  }

  private key(sessionId: string): string {
    return createHash('sha256').update(sessionId).digest('hex').slice(0, 32);
  }
}

export const workspaceService = new WorkspaceService();

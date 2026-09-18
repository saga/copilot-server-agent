import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** 会话归属（K8s/多租户的 ownership 概念；单租户时为 default/default） */
export interface SessionOwner {
  tenantId: string;
  userId: string;
}

/**
 * Session Registry：session → owner/workspace 的持久映射。
 *
 * 为什么需要它：
 * - 只靠进程内存 Map，Pod 重启后 owners 清空 → “谁第一次访问谁认领 session”，
 *   这是安全问题（见官方 multi-tenancy：应用必须自己维护 session ownership）
 * - 官方多租户文档要求 resume/delete 前做访问控制；Copilot session id 本身不构成边界
 *
 * 当前实现：单文件 JSON（原子写 + 串行化写入）。适合单副本部署；生产多副本换 PostgreSQL，
 * 表结构见 README。接口全部 async，换存储不需要改调用方。
 */

export interface RegistryRecord {
  sessionId: string;
  tenantId: string;
  userId: string;
  workspacePath: string;
  createdAt: string;
  lastUsedAt: string;
  status: 'active' | 'deleted';
}

export class SessionRegistry {
  private readonly filePath: string;
  private records = new Map<string, RegistryRecord>();
  /** 写入串行化：避免并发 mutation 互相覆盖（读写全量 JSON，必须排队） */
  private writeChain: Promise<unknown> = Promise.resolve();
  private loaded: Promise<void> | null = null;

  constructor(filePath: string) {
    this.filePath = path.resolve(filePath);
  }

  private async load(): Promise<void> {
    if (!this.loaded) {
      this.loaded = (async () => {
        try {
          const raw = await readFile(this.filePath, 'utf-8');
          const parsed = JSON.parse(raw) as { sessions?: RegistryRecord[] } | RegistryRecord[];
          const list = Array.isArray(parsed) ? parsed : (parsed.sessions ?? []);
          for (const r of list) {
            if (r && typeof r.sessionId === 'string') this.records.set(r.sessionId, r);
          }
        } catch (err) {
          const code = (err as NodeJS.ErrnoException).code;
          if (code !== 'ENOENT') {
            console.warn(
              `[registry] 读取失败（按空注册表继续）${this.filePath}：${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          }
        }
      })();
    }
    return this.loaded;
  }

  /** 原子写：tmp + rename，避免进程被杀留下半截 JSON */
  private async flush(): Promise<void> {
    const payload = JSON.stringify({ sessions: [...this.records.values()] }, null, 2);
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    await writeFile(tmp, payload, 'utf-8');
    await rename(tmp, this.filePath);
  }

  /** 所有 mutation 走这里：串行 + 落盘 */
  private async mutate<T>(fn: () => T): Promise<T> {
    await this.load();
    const next = this.writeChain.catch(() => undefined).then(async () => {
      const out = fn();
      await this.flush();
      return out;
    });
    this.writeChain = next.catch(() => undefined);
    return next;
  }

  async get(sessionId: string): Promise<RegistryRecord | undefined> {
    await this.load();
    return this.records.get(sessionId);
  }

  /** 新建或更新归属（workspace 以最后一次为准） */
  async upsert(input: {
    sessionId: string;
    owner: SessionOwner;
    workspacePath: string;
  }): Promise<RegistryRecord> {
    return this.mutate(() => {
      const now = new Date().toISOString();
      const existing = this.records.get(input.sessionId);
      const record: RegistryRecord = {
        sessionId: input.sessionId,
        tenantId: input.owner.tenantId,
        userId: input.owner.userId,
        workspacePath: input.workspacePath,
        createdAt: existing?.createdAt ?? now,
        lastUsedAt: now,
        status: 'active',
      };
      this.records.set(input.sessionId, record);
      return record;
    });
  }

  async touch(sessionId: string): Promise<void> {
    await this.mutate(() => {
      const r = this.records.get(sessionId);
      if (r) r.lastUsedAt = new Date().toISOString();
    });
  }

  async remove(sessionId: string): Promise<void> {
    await this.mutate(() => {
      this.records.delete(sessionId);
    });
  }

  /** 某 owner 的全部会话（GET /api/sessions 按此过滤，不再返回全量） */
  async listByOwner(owner: SessionOwner): Promise<RegistryRecord[]> {
    await this.load();
    return [...this.records.values()].filter(
      (r) => r.status === 'active' && r.tenantId === owner.tenantId && r.userId === owner.userId,
    );
  }

  /**
   * 归属校验（create 之外的所有 session 操作统一走这里，路由不再各写一份）。
   * - 有记录但 tenant/user 不匹配 → 抛“无权访问”（路由转 403）
   * - 无记录：allowLegacyClaim=true → 认领（仅单租户/本地开发的兼容路径）；否则按无权处理
   */
  async assertAccess(
    sessionId: string,
    owner: SessionOwner,
    opts: { allowLegacyClaim?: boolean; workspacePath?: string } = {},
  ): Promise<RegistryRecord> {
    await this.load();
    const record = this.records.get(sessionId);
    if (!record) {
      if (!opts.allowLegacyClaim) {
        throw new Error(`无权访问 session："${sessionId}"（无归属记录）`);
      }
      return this.upsert({
        sessionId,
        owner,
        workspacePath: opts.workspacePath ?? '',
      });
    }
    if (record.tenantId !== owner.tenantId || record.userId !== owner.userId) {
      throw new Error(
        `无权访问 session："${sessionId}"（归属 ${record.tenantId}/${record.userId}）`,
      );
    }
    return record;
  }
}

import { currentDialect, getDb } from '../db/connection.js';
import type { SqlRow } from '../db/dialect.js';
import type { CustomAgentConfig } from '@github/copilot-sdk';

/** 会话归属（K8s/多租户的 ownership 概念；单租户时为 default/default） */
export interface SessionOwner {
  tenantId: string;
  userId: string;
}

export const DEFAULT_OWNER: SessionOwner = { tenantId: 'default', userId: 'default' };

/**
 * resume 用会话配置（持久化，不含任何凭证）。
 *
 * 为什么必须存：官方允许 resumeSession 时重新配置 model/tools/workingDirectory/mcpServers，
 * 而 BYOK provider 必须每次重传；chat 路径若用空 {} resume，会把会话配置悄悄重置。
 * 凭证一律不落库——resume 时由 provider 现算。
 */
export interface PersistedSessionConfig {
  model?: string;
  agent?: string;
  agents?: string[];
  customAgents?: CustomAgentConfig[];
  skillDirs?: string[];
  disabledSkills?: string[];
  noBuiltinSkills?: boolean;
  defaultAgentExcludedTools?: string[];
  /** MCP 预设名（内联 server 含凭证，不存） */
  mcp?: string[];
  disabledMcpServers?: string[];
  hooks?: string[];
}

export interface RegistryRecord {
  sessionId: string;
  tenantId: string;
  userId: string;
  workspacePath: string;
  createdAt: string;
  lastUsedAt: string;
  status: 'active' | 'deleted';
  config?: PersistedSessionConfig;
}

/**
 * Session Registry：session → owner/workspace/config 的持久映射。
 *
 * 为什么需要它：
 * - 只靠进程内存 Map，Pod 重启后 owners 清空 → “谁第一次访问谁认领 session”（安全漏洞）
 * - 官方多租户文档要求 resume/delete 前做访问控制；Copilot session id 本身不构成边界
 *
 * 存储后端：统一落在 SQL 库的 `agent_session` 表 —— 默认 SQLite（单文件，零配置），
 * 配了 DATABASE_URL 则 PostgreSQL。接口全部 async，换存储不需要改调用方。
 */

export interface RegistryStore {
  all(): Promise<RegistryRecord[]>;
  upsert(record: RegistryRecord): Promise<RegistryRecord>;
  remove(sessionId: string): Promise<void>;
}

export class SqlRegistryStore implements RegistryStore {
  async all(): Promise<RegistryRecord[]> {
    const { rows } = await getDb().query<SqlRow>('select * from agent_session');
    return rows.map((r) => this.toRecord(r));
  }

  async upsert(record: RegistryRecord): Promise<RegistryRecord> {
    const dialect = currentDialect();
    const ph = (i: number): string => dialect.ph(i);
    const { rows } = await getDb().query<SqlRow>(
      `insert into agent_session
         (session_id, tenant_id, user_id, workspace_path, status, config, created_at, updated_at, last_used_at)
       values (${ph(1)},${ph(2)},${ph(3)},${ph(4)},${ph(5)},${ph(6)},${ph(7)},${ph(8)},${ph(9)})
       on conflict (session_id) do update set
         tenant_id = excluded.tenant_id,
         user_id = excluded.user_id,
         workspace_path = excluded.workspace_path,
         status = excluded.status,
         config = excluded.config,
         updated_at = excluded.updated_at,
         last_used_at = excluded.last_used_at
       returning *`,
      [
        record.sessionId,
        record.tenantId,
        record.userId,
        record.workspacePath,
        record.status,
        JSON.stringify(record.config ?? {}),
        dialect.tsParam(record.createdAt),
        dialect.tsParam(new Date().toISOString()),
        record.lastUsedAt ? dialect.tsParam(record.lastUsedAt) : null,
      ],
    );
    return this.toRecord(rows[0]!);
  }

  async remove(sessionId: string): Promise<void> {
    const dialect = currentDialect();
    await getDb().query(`delete from agent_session where session_id = ${dialect.ph(1)}`, [sessionId]);
  }

  private toRecord(r: SqlRow): RegistryRecord {
    const dialect = currentDialect();
    return {
      sessionId: String(r.session_id),
      tenantId: String(r.tenant_id),
      userId: String(r.user_id),
      workspacePath: String(r.workspace_path),
      createdAt: dialect.ts(r.created_at) ?? new Date(0).toISOString(),
      lastUsedAt: dialect.ts(r.last_used_at ?? r.created_at) ?? new Date(0).toISOString(),
      status: r.status as RegistryRecord['status'],
      ...(r.config ? { config: dialect.json<PersistedSessionConfig>(r.config) } : {}),
    };
  }
}

export class SessionRegistry {
  /** 写入串行化：避免并发 mutation 互相覆盖（文件后端读写全量 JSON，必须排队） */
  private writeChain: Promise<unknown> = Promise.resolve();

  constructor(private readonly store: RegistryStore) {}

  private async mutate<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.writeChain.catch(() => undefined).then(fn);
    this.writeChain = next.catch(() => undefined);
    return next;
  }

  async get(sessionId: string): Promise<RegistryRecord | undefined> {
    const all = await this.store.all();
    return all.find((r) => r.sessionId === sessionId);
  }

  /** 新建或更新归属（workspace 以最后一次为准） */
  async upsert(input: {
    sessionId: string;
    owner: SessionOwner;
    workspacePath: string;
    config?: PersistedSessionConfig;
  }): Promise<RegistryRecord> {
    return this.mutate(async () => {
      const now = new Date().toISOString();
      const existing = await this.get(input.sessionId);
      const record: RegistryRecord = {
        sessionId: input.sessionId,
        tenantId: input.owner.tenantId,
        userId: input.owner.userId,
        workspacePath: input.workspacePath,
        createdAt: existing?.createdAt ?? now,
        lastUsedAt: now,
        status: 'active',
        ...(input.config ?? existing?.config ? { config: input.config ?? existing?.config } : {}),
      };
      return this.store.upsert(record);
    });
  }

  /** 保存/更新 resume 用配置（凭证字段不进这里） */
  async saveConfig(sessionId: string, config: PersistedSessionConfig): Promise<void> {
    await this.mutate(async () => {
      const existing = await this.get(sessionId);
      if (!existing) return;
      await this.store.upsert({
        ...existing,
        config: { ...(existing.config ?? {}), ...config },
        lastUsedAt: new Date().toISOString(),
      });
    });
  }

  /** chat/resume 时取回会话配置（避免用空 {} resume 把配置重置） */
  async getConfig(sessionId: string): Promise<PersistedSessionConfig | undefined> {
    const rec = await this.get(sessionId);
    return rec?.config;
  }

  async touch(sessionId: string): Promise<void> {
    await this.mutate(async () => {
      const existing = await this.get(sessionId);
      if (!existing) return;
      await this.store.upsert({ ...existing, lastUsedAt: new Date().toISOString() });
    });
  }

  async remove(sessionId: string): Promise<void> {
    await this.mutate(() => this.store.remove(sessionId));
  }

  /** 某 owner 的全部会话（GET /api/sessions 按此过滤，不再返回全量） */
  async listByOwner(owner: SessionOwner): Promise<RegistryRecord[]> {
    const all = await this.store.all();
    return all.filter(
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
    const record = await this.get(sessionId);
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

/** 归属表与 execution / human task 同库：默认 SQLite，配 DATABASE_URL 则 PostgreSQL */
export function createRegistryStore(): RegistryStore {
  return new SqlRegistryStore();
}

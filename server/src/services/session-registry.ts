import type { CustomAgentConfig } from '@github/copilot-sdk';
import type { CollaborationMode } from '../collaboration/types.js';
import { config } from '../config.js';
import { currentDialect, getDb } from '../db/connection.js';
import type { SqlRow } from '../db/dialect.js';

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
 *
 * 这里只放**给 SDK 的**配置：collaborationMode 是业务会话元数据（谁可以进入这个会话），
 * 属于 agent_session 的列，不属于 config。
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
  /** session owner（生命周期管理者：删除会话、增删参与人、改会话设置） */
  tenantId: string;
  userId: string;
  /** 访问模型；创建时确定，生命周期内不可修改 */
  collaborationMode: CollaborationMode;
  workspacePath: string;
  createdAt: string;
  lastUsedAt: string;
  status: 'active' | 'deleted';
  config?: PersistedSessionConfig;
}

/**
 * Session Registry：session → owner / collaborationMode / workspace / config 的持久映射。
 *
 * 为什么需要它：
 * - 只靠进程内存 Map，Pod 重启后 owners 清空 → “谁第一次访问谁认领 session”（安全漏洞）
 * - 官方多租户文档要求 resume/delete 前做访问控制；Copilot session id 本身不构成边界
 *
 * 存储后端：与 execution 同库的 `agent_session` 表 —— 默认 SQLite（单文件，零配置），
 * 配了 DATABASE_URL 则 PostgreSQL。接口全部 async，换存储不需要改调用方。
 *
 * 写入按意图拆开（create / saveConfig / touch / setCollaborationMode），不用一个万能 upsert：
 * 万能 upsert 会在「Bob resume Alice 的 shared 会话」时把 owner 覆盖成 Bob。
 */

export interface RegistryStore {
  get(sessionId: string): Promise<RegistryRecord | undefined>;
  all(): Promise<RegistryRecord[]>;
  /** 新建（session_id 冲突时由调用方决定如何处理，这里直接抛错） */
  insert(record: RegistryRecord): Promise<RegistryRecord>;
  /** 按主键全列更新；collaboration_mode 不在更新列里（模式只能走 setCollaborationMode） */
  update(record: RegistryRecord): Promise<RegistryRecord>;
  setCollaborationMode(
    sessionId: string,
    mode: CollaborationMode,
  ): Promise<RegistryRecord | undefined>;
  remove(sessionId: string): Promise<void>;
}

const SELECT_COLUMNS = [
  'session_id',
  'tenant_id',
  'user_id',
  'workspace_path',
  'status',
  'collaboration_mode',
  'config',
  'created_at',
  'updated_at',
  'last_used_at',
] as const;

export class SqlRegistryStore implements RegistryStore {
  async get(sessionId: string): Promise<RegistryRecord | undefined> {
    const dialect = currentDialect();
    const { rows } = await getDb().query<SqlRow>(
      `select * from agent_session where session_id = ${dialect.ph(1)}`,
      [sessionId],
    );
    return rows[0] ? toRecord(rows[0]) : undefined;
  }

  async all(): Promise<RegistryRecord[]> {
    const { rows } = await getDb().query<SqlRow>('select * from agent_session');
    return rows.map(toRecord);
  }

  async insert(record: RegistryRecord): Promise<RegistryRecord> {
    const dialect = currentDialect();
    const { rows } = await getDb().query<SqlRow>(
      `insert into agent_session
         (session_id, tenant_id, user_id, workspace_path, status, collaboration_mode,
          config, created_at, updated_at, last_used_at)
       values (${SELECT_COLUMNS.map((_, i) => dialect.ph(i + 1)).join(',')})
       returning *`,
      [
        record.sessionId,
        record.tenantId,
        record.userId,
        record.workspacePath,
        record.status,
        record.collaborationMode,
        JSON.stringify(record.config ?? {}),
        dialect.tsParam(record.createdAt),
        dialect.tsParam(new Date().toISOString()),
        record.lastUsedAt ? dialect.tsParam(record.lastUsedAt) : null,
      ],
    );
    return toRecord(rows[0]!);
  }

  async update(record: RegistryRecord): Promise<RegistryRecord> {
    const dialect = currentDialect();
    const { rows } = await getDb().query<SqlRow>(
      `update agent_session set
         tenant_id = ${dialect.ph(1)},
         user_id = ${dialect.ph(2)},
         workspace_path = ${dialect.ph(3)},
         status = ${dialect.ph(4)},
         config = ${dialect.ph(5)},
         updated_at = ${dialect.ph(6)},
         last_used_at = ${dialect.ph(7)}
       where session_id = ${dialect.ph(8)}
       returning *`,
      [
        record.tenantId,
        record.userId,
        record.workspacePath,
        record.status,
        JSON.stringify(record.config ?? {}),
        dialect.tsParam(new Date().toISOString()),
        record.lastUsedAt ? dialect.tsParam(record.lastUsedAt) : null,
        record.sessionId,
      ],
    );
    return rows[0] ? toRecord(rows[0]) : record;
  }

  /**
   * 单独一条 SQL：collaboration_mode 不在 update 的列里，
   * 因此「模式不可变」在存储层也成立（唯一入口且不对外暴露）。
   */
  async setCollaborationMode(
    sessionId: string,
    mode: CollaborationMode,
  ): Promise<RegistryRecord | undefined> {
    const dialect = currentDialect();
    const { rows } = await getDb().query<SqlRow>(
      `update agent_session
       set collaboration_mode = ${dialect.ph(1)}, updated_at = ${dialect.ph(2)}
       where session_id = ${dialect.ph(3)}
       returning *`,
      [mode, dialect.tsParam(new Date().toISOString()), sessionId],
    );
    return rows[0] ? toRecord(rows[0]) : undefined;
  }

  async remove(sessionId: string): Promise<void> {
    const dialect = currentDialect();
    await getDb().query(`delete from agent_session where session_id = ${dialect.ph(1)}`, [sessionId]);
  }
}

function toRecord(r: SqlRow): RegistryRecord {
  const dialect = currentDialect();
  return {
    sessionId: String(r.session_id),
    tenantId: String(r.tenant_id),
    userId: String(r.user_id),
    collaborationMode: (r.collaboration_mode as CollaborationMode) ?? 'single',
    workspacePath: String(r.workspace_path),
    createdAt: dialect.ts(r.created_at) ?? new Date(0).toISOString(),
    lastUsedAt: dialect.ts(r.last_used_at ?? r.created_at) ?? new Date(0).toISOString(),
    status: r.status as RegistryRecord['status'],
    ...(r.config ? { config: dialect.json<PersistedSessionConfig>(r.config) } : {}),
  };
}

export interface CreateSessionRecordInput {
  sessionId: string;
  owner: SessionOwner;
  workspacePath: string;
  collaborationMode?: CollaborationMode;
  config?: PersistedSessionConfig;
}

export class SessionRegistry {
  /** 写入串行化：避免并发 mutation 互相覆盖 */
  private writeChain: Promise<unknown> = Promise.resolve();

  constructor(private readonly store: RegistryStore) {}

  private async mutate<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.writeChain.catch(() => undefined).then(fn);
    this.writeChain = next.catch(() => undefined);
    return next;
  }

  get(sessionId: string): Promise<RegistryRecord | undefined> {
    return this.store.get(sessionId);
  }

  /**
   * 建会话记录。
   * 已存在同 id 时：归属不同直接拒绝（不允许悄悄接管）；模式不同也拒绝（模式不可变）；
   * 同归属同模式视为幂等重建，只刷新 workspace 与 config。
   */
  async create(input: CreateSessionRecordInput): Promise<RegistryRecord> {
    return this.mutate(async () => {
      const mode = input.collaborationMode ?? 'single';
      const now = new Date().toISOString();
      const existing = await this.store.get(input.sessionId);
      if (existing) {
        if (
          existing.tenantId !== input.owner.tenantId ||
          existing.userId !== input.owner.userId
        ) {
          throw new Error(
            `session 已存在且归属不同："${input.sessionId}"（归属 ${existing.tenantId}/${existing.userId}）`,
          );
        }
        if (existing.collaborationMode !== mode) {
          throw new Error(
            `session 已存在且模式不同："${input.sessionId}"（${existing.collaborationMode} → ${mode}）；会话模式创建后不可修改`,
          );
        }
        return this.store.update({
          ...existing,
          workspacePath: input.workspacePath,
          status: 'active',
          lastUsedAt: now,
          ...(input.config ?? existing.config ? { config: input.config ?? existing.config } : {}),
        });
      }
      return this.store.insert({
        sessionId: input.sessionId,
        tenantId: input.owner.tenantId,
        userId: input.owner.userId,
        collaborationMode: mode,
        workspacePath: input.workspacePath,
        createdAt: now,
        lastUsedAt: now,
        status: 'active',
        ...(input.config ? { config: input.config } : {}),
      });
    });
  }

  /** 保存/更新 resume 用配置（凭证字段不进这里） */
  async saveConfig(sessionId: string, config: PersistedSessionConfig): Promise<void> {
    await this.mutate(async () => {
      const existing = await this.store.get(sessionId);
      if (!existing) return;
      await this.store.update({
        ...existing,
        config: { ...(existing.config ?? {}), ...config },
        lastUsedAt: new Date().toISOString(),
      });
    });
  }

  /** chat/resume 时取回会话配置（避免用空 {} resume 把配置重置） */
  async getConfig(sessionId: string): Promise<PersistedSessionConfig | undefined> {
    const rec = await this.store.get(sessionId);
    return rec?.config;
  }

  async touch(sessionId: string): Promise<void> {
    await this.mutate(async () => {
      const existing = await this.store.get(sessionId);
      if (!existing) return;
      await this.store.update({ ...existing, lastUsedAt: new Date().toISOString() });
    });
  }

  /**
   * 改模式：不经任何 API 暴露，只给「单→共享」迁移脚本用。
   * 转换必须满足会话空闲、无执行中 execution、无待处理工具调用、owner 确认。
   */
  setCollaborationMode(
    sessionId: string,
    mode: CollaborationMode,
  ): Promise<RegistryRecord | undefined> {
    return this.store.setCollaborationMode(sessionId, mode);
  }

  remove(sessionId: string): Promise<void> {
    return this.mutate(() => this.store.remove(sessionId));
  }

  /** 某 owner 的全部会话（GET /sessions 的可见性来源之一） */
  async listByOwner(owner: SessionOwner): Promise<RegistryRecord[]> {
    const all = await this.store.all();
    return all.filter(
      (r) => r.status === 'active' && r.tenantId === owner.tenantId && r.userId === owner.userId,
    );
  }

  /**
   * 无归属记录时的补登记（仅单租户的兼容路径：历史会话/本地开发）。
   * 多租户下无记录 = 无权访问，不再“谁先访问谁认领”。
   */
  async claim(
    sessionId: string,
    owner: SessionOwner,
    workspacePath: string,
  ): Promise<RegistryRecord> {
    return this.create({ sessionId, owner, workspacePath, collaborationMode: 'single' });
  }

  /**
   * 归属校验：确认该 session 的 owner 是指定的人。
   * 注意语义 —— 这只回答「你是 owner 吗」，不回答「你能做什么」；
   * 参与者能不能进、能做什么由 SessionAccessService 判定。
   */
  async assertOwner(
    sessionId: string,
    owner: SessionOwner,
    opts: { allowLegacyClaim?: boolean; workspacePath?: string } = {},
  ): Promise<RegistryRecord> {
    const record = await this.store.get(sessionId);
    if (!record) {
      if (!opts.allowLegacyClaim) {
        throw new Error(`无权访问 session："${sessionId}"（无归属记录）`);
      }
      return this.claim(sessionId, owner, opts.workspacePath ?? '');
    }
    if (record.tenantId !== owner.tenantId || record.userId !== owner.userId) {
      throw new Error(
        `无权访问 session："${sessionId}"（归属 ${record.tenantId}/${record.userId}）`,
      );
    }
    return record;
  }
}

/**
 * 内存实现：`COPILOT_STATE_BACKEND=memory`（不落盘的临时验证）与单测用。
 * `update` 与 SQL 实现一样不写 collaboration_mode —— 模式只能走 setCollaborationMode。
 */
export class MemoryRegistryStore implements RegistryStore {
  private rows = new Map<string, RegistryRecord>();

  async get(sessionId: string): Promise<RegistryRecord | undefined> {
    return this.clone(this.rows.get(sessionId));
  }

  async all(): Promise<RegistryRecord[]> {
    return [...this.rows.values()].map((r) => this.clone(r)!);
  }

  async insert(record: RegistryRecord): Promise<RegistryRecord> {
    if (this.rows.has(record.sessionId)) {
      throw new Error(`session 已存在："${record.sessionId}"`);
    }
    this.rows.set(record.sessionId, this.clone(record)!);
    return this.clone(record)!;
  }

  async update(record: RegistryRecord): Promise<RegistryRecord> {
    const existing = this.rows.get(record.sessionId);
    if (!existing) return this.clone(record)!;
    const next: RegistryRecord = { ...this.clone(record)!, collaborationMode: existing.collaborationMode };
    this.rows.set(record.sessionId, next);
    return this.clone(next)!;
  }

  async setCollaborationMode(
    sessionId: string,
    mode: CollaborationMode,
  ): Promise<RegistryRecord | undefined> {
    const existing = this.rows.get(sessionId);
    if (!existing) return undefined;
    existing.collaborationMode = mode;
    return this.clone(existing);
  }

  async remove(sessionId: string): Promise<void> {
    this.rows.delete(sessionId);
  }

  clear(): void {
    this.rows.clear();
  }

  private clone(record: RegistryRecord | undefined): RegistryRecord | undefined {
    return record ? (JSON.parse(JSON.stringify(record)) as RegistryRecord) : undefined;
  }
}

/**
 * 归属表与 execution / human task 同库：默认 SQLite，配 DATABASE_URL 则 PostgreSQL；
 * `COPILOT_STATE_BACKEND=memory` 时不落盘 —— 与 execution/human task 的后端选择保持一致。
 */
export function createRegistryStore(): RegistryStore {
  return config.stateBackend === 'memory' ? new MemoryRegistryStore() : new SqlRegistryStore();
}

/**
 * 进程内唯一的注册表实例：API 路由、访问判定、协作层共用同一份，
 * 避免各自 new 一份导致写入串行化失效。
 */
export const sessionRegistry = new SessionRegistry(createRegistryStore());

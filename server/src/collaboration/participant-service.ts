import type { ParticipantRepository } from './repository.js';
import type { SessionEventService } from './session-event-service.js';
import {
  SESSION_EVENT_TYPES,
  type SessionParticipant,
  type SessionParticipantRole,
} from './types.js';
import type { Principal } from '../services/principal.js';
import type { SessionAccessService } from '../services/session-access.js';
import type { SessionRegistry } from '../services/session-registry.js';

/**
 * 会话参与人。
 *
 * 成员资格由 owner 控制（邀请制）：能不能让某人进入这个会话，是数据边界问题而不是
 * 单纯的成员问题 —— 参与者共享同一个 conversation / workspace / data scope / 工具与 MCP 能力，
 * 所以判断「这个人的数据权限是否覆盖本会话的数据范围」发生在 owner 决定邀请的那一刻。
 *
 * 当前可强制的规则：同租户（跨租户一律拒绝）、owner 唯一且不可移除、single 会话不可加人。
 */

export interface ParticipantServiceDeps {
  repository: ParticipantRepository;
  registry: SessionRegistry;
  access: SessionAccessService;
  events: Pick<SessionEventService, 'append'>;
}

const JOINABLE_ROLES: readonly SessionParticipantRole[] = ['member', 'observer'];

export class ParticipantService {
  constructor(private readonly deps: ParticipantServiceDeps) {}

  get repository(): ParticipantRepository {
    return this.deps.repository;
  }

  /**
   * 建会话时登记 owner。
   * single 模式也写这一行：访问判定因此不必按模式分叉
   * （single 的 participants 恒为 [owner]，shared 为 owner + members）。
   */
  async registerOwner(input: {
    sessionId: string;
    tenantId: string;
    userId: string;
  }): Promise<SessionParticipant> {
    return this.deps.repository.upsert({
      sessionId: input.sessionId,
      tenantId: input.tenantId,
      userId: input.userId,
      role: 'owner',
      status: 'active',
      joinedAt: new Date().toISOString(),
    });
  }

  async list(sessionId: string, principal: Principal): Promise<SessionParticipant[]> {
    await this.deps.access.assertCanView(sessionId, principal);
    return this.deps.repository.list(sessionId);
  }

  /** 供已完成访问判定的调用方使用（例如会话元信息里带上参与人列表） */
  listForSession(sessionId: string): Promise<SessionParticipant[]> {
    return this.deps.repository.list(sessionId);
  }

  /** 某人参与的会话（GET /sessions 的可见性来源之一） */
  listActiveSessionIds(tenantId: string, userId: string): Promise<string[]> {
    return this.deps.repository.listActiveSessionIds(tenantId, userId);
  }

  /** owner 邀请：只有 manage_members 能做，且只能拉同租户的人 */
  async add(
    sessionId: string,
    principal: Principal,
    input: { userId: string; role?: SessionParticipantRole },
  ): Promise<SessionParticipant> {
    const access = await this.deps.access.assertCanManageMembers(sessionId, principal);
    if (access.mode !== 'shared') {
      throw new Error(
        `会话 "${sessionId}" 是 single 模式，不能添加参与人（会话模式创建后不可修改）`,
      );
    }
    const userId = input.userId?.trim();
    if (!userId) throw new Error('userId 不能为空');
    const role = input.role ?? 'member';
    if (!JOINABLE_ROLES.includes(role)) {
      throw new Error(`role 必须是 ${JOINABLE_ROLES.join(' 或 ')}（owner 唯一，不可新增）`);
    }
    const owner = access.owner;
    if (userId === owner.userId) {
      throw new Error(`"${userId}" 已经是该会话的 owner，无需添加`);
    }

    const added = await this.deps.repository.upsert({
      sessionId,
      // 只能拉同租户的人；目标用户属于哪个租户由网关认证决定，请求体不可指定
      tenantId: owner.tenantId,
      userId,
      role,
      status: 'active',
      joinedAt: new Date().toISOString(),
    });
    await this.deps.events.append({
      sessionId,
      type: SESSION_EVENT_TYPES.participantJoined,
      actorType: 'user',
      actorId: principal.userId,
      payload: { userId, role },
    });
    return added;
  }

  /** owner 移除成员：置 removed 并保留痕迹（不是删行），审计要能回答“谁被移除了” */
  async remove(
    sessionId: string,
    principal: Principal,
    userId: string,
  ): Promise<SessionParticipant | undefined> {
    const access = await this.deps.access.assertCanManageMembers(sessionId, principal);
    if (userId === access.owner.userId) {
      throw new Error('不能移除会话 owner（需要删除会话或转移归属）');
    }
    const updated = await this.deps.repository.setStatus(
      sessionId,
      userId,
      'removed',
      new Date().toISOString(),
    );
    if (!updated) throw new Error(`该用户不是本会话的参与人："${userId}"`);
    await this.deps.events.append({
      sessionId,
      type: SESSION_EVENT_TYPES.participantRemoved,
      actorType: 'user',
      actorId: principal.userId,
      payload: { userId },
    });
    return updated;
  }

  /** 成员自行退出：只影响成员资格，不动 Copilot session / execution / workspace */
  async leave(sessionId: string, principal: Principal): Promise<SessionParticipant | undefined> {
    const access = await this.deps.access.assertCanView(sessionId, principal);
    if (principal.userId === access.owner.userId) {
      throw new Error('owner 不能退出自己的会话（需要删除会话或转移归属）');
    }
    if (access.mode !== 'shared') {
      throw new Error(`会话 "${sessionId}" 是 single 模式，没有可退出的成员资格`);
    }
    const updated = await this.deps.repository.setStatus(
      sessionId,
      principal.userId,
      'left',
      new Date().toISOString(),
    );
    if (!updated) throw new Error(`该用户不是本会话的参与人："${principal.userId}"`);
    await this.deps.events.append({
      sessionId,
      type: SESSION_EVENT_TYPES.participantLeft,
      actorType: 'user',
      actorId: principal.userId,
      payload: { userId: principal.userId },
    });
    return updated;
  }
}

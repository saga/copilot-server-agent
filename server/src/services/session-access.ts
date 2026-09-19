import type { ParticipantRepository } from '../collaboration/repository.js';
import {
  roleAllows,
  type CollaborationMode,
  type SessionPermission,
  type SessionParticipantRole,
} from '../collaboration/types.js';
import type { Principal } from './principal.js';
import {
  DEFAULT_OWNER,
  SessionRegistry,
  type RegistryRecord,
  type SessionOwner,
} from './session-registry.js';

/**
 * Session 访问判定（唯一的授权入口）。
 *
 *   principal + sessionId → 模式 + 会话角色 → 权限
 *
 *   single  必须是 owner
 *   shared  必须是 active participant（owner/member/observer 权限不同）
 *
 * 这里只回答「谁能进这个会话、能做什么」。业务授权（能不能批准某笔交易）不在这里，
 * 它由 Principal.roles → ApprovalPolicy 决定。两层不能合并：
 * 加进共享会话 ≠ 获得高风险动作的执行权。
 */

export interface ResolvedSessionAccess {
  mode: CollaborationMode;
  role: SessionParticipantRole;
  /** session owner（调用 session-service 时按它做归属校验） */
  owner: SessionOwner;
  record?: RegistryRecord;
}

export class SessionAccessService {
  constructor(
    private readonly deps: {
      registry: SessionRegistry;
      participants: ParticipantRepository;
    },
  ) {}

  /**
   * 解析调用方对该 session 的模式与角色；无权时抛错（路由转 403）。
   * 无归属记录时：单租户（本地开发/历史会话）按 owner 处理，多租户一律无权 —— 与既有归属校验一致。
   */
  async resolve(sessionId: string, principal: Principal): Promise<ResolvedSessionAccess> {
    const record = await this.deps.registry.get(sessionId);
    const self: SessionOwner = { tenantId: principal.tenantId, userId: principal.userId };

    if (!record) {
      if (!this.isSingleTenant(principal)) {
        throw new Error(`无权访问 session："${sessionId}"（无归属记录）`);
      }
      return { mode: 'single', role: 'owner', owner: self };
    }

    const owner: SessionOwner = { tenantId: record.tenantId, userId: record.userId };
    if (record.collaborationMode === 'single') {
      if (owner.tenantId !== principal.tenantId || owner.userId !== principal.userId) {
        throw new Error(
          `无权访问 session："${sessionId}"（归属 ${record.tenantId}/${record.userId}）`,
        );
      }
      return { mode: 'single', role: 'owner', owner, record };
    }

    const participant = await this.deps.participants.get(sessionId, principal.userId);
    if (participant && participant.tenantId === principal.tenantId && participant.status === 'active') {
      return { mode: 'shared', role: participant.role, owner, record };
    }
    // owner 恒为 owner：参与人行缺失（历史数据、登记失败）也不该把会话主人锁在门外
    if (owner.tenantId === principal.tenantId && owner.userId === principal.userId) {
      return { mode: 'shared', role: 'owner', owner, record };
    }
    throw new Error(`无权访问 session："${sessionId}"（不是该共享会话的 active 参与人）`);
  }

  async assertCan(
    sessionId: string,
    principal: Principal,
    permission: SessionPermission,
  ): Promise<ResolvedSessionAccess> {
    const access = await this.resolve(sessionId, principal);
    if (!roleAllows(access.role, permission)) {
      throw new Error(
        `无权${PERMISSION_LABEL[permission]} session："${sessionId}"（当前会话角色 ${access.role}）`,
      );
    }
    return access;
  }

  assertCanView(sessionId: string, principal: Principal): Promise<ResolvedSessionAccess> {
    return this.assertCan(sessionId, principal, 'view');
  }

  assertCanSend(sessionId: string, principal: Principal): Promise<ResolvedSessionAccess> {
    return this.assertCan(sessionId, principal, 'send');
  }

  assertCanManageMembers(sessionId: string, principal: Principal): Promise<ResolvedSessionAccess> {
    return this.assertCan(sessionId, principal, 'manage_members');
  }

  assertCanDelete(sessionId: string, principal: Principal): Promise<ResolvedSessionAccess> {
    return this.assertCan(sessionId, principal, 'delete');
  }

  /**
   * 调用方可见的 sessionId 集合：自己拥有的 + 自己参与的。
   * execution / human task 的列表按它收窄（共享会话里别人的 execution 也能看到）。
   */
  async visibleSessionIds(principal: Principal): Promise<string[]> {
    const owned = await this.deps.registry.listByOwner({
      tenantId: principal.tenantId,
      userId: principal.userId,
    });
    const participated = await this.deps.participants.listActiveSessionIds(
      principal.tenantId,
      principal.userId,
    );
    return [...new Set([...owned.map((r) => r.sessionId), ...participated])];
  }

  private isSingleTenant(principal: Principal): boolean {
    return (
      principal.tenantId === DEFAULT_OWNER.tenantId && principal.userId === DEFAULT_OWNER.userId
    );
  }
}

const PERMISSION_LABEL: Record<SessionPermission, string> = {
  view: '查看',
  send: '发消息到',
  manage_members: '管理成员',
  delete: '删除',
};

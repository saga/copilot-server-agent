import type { Principal } from '../services/principal.js';
import { resolveRolesForGroups } from './business-roles.js';

/**
 * AuthorizationService：把 `Principal` 解析成**业务角色**。
 *
 * ```text
 * Principal { userId, groups: [entra group object ID], roles: [已解析的业务角色] }
 *        ↓
 * resolveRoles()
 *        ↓
 * [ 'compliance.reviewer', 'investment.committee.member' ]
 * ```
 *
 * 两个来源，取并集：
 *
 *   1. `principal.groups` → RoleRegistry 映射（**生产主路径**）
 *   2. `principal.roles`  → 网关已解析好的业务角色（本地开发 `COPILOT_DEFAULT_ROLES`，
 *      或上游网关自己做了映射的场景）
 *
 * 刻意是**同步**的：group → role 是纯映射，不需要网络。group membership 的取全
 * （Entra group overage 时走 Graph 补齐）在网关完成 —— 否则这里会变成一次网络调用，
 * 而它被 `HumanTaskService.withTaskLock()` 的临界区包着，一次 Graph 抖动就能让
 * 同一 task 的并发审批卡住。
 *
 * 边界：这一层只回答"这个人**具备**哪些业务角色"。它不回答"这个角色在这个业务上下文里
 * 能不能做这件事" —— 那是 ApprovalPolicy（要几票、能否自批）与 HumanTaskService /
 * ActionService 的判断。
 */
export class AuthorizationService {
  /** 业务角色列表（去重、排序，便于比对与审计） */
  resolveRoles(principal: Pick<Principal, 'roles' | 'groups'>): string[] {
    const direct = (principal.roles ?? []).map((r) => r.trim().toLowerCase()).filter(Boolean);
    const fromGroups = resolveRolesForGroups(principal.groups ?? []);
    return [...new Set([...direct, ...fromGroups])].sort();
  }

  hasRole(principal: Pick<Principal, 'roles' | 'groups'>, roleId: string): boolean {
    return this.resolveRoles(principal).includes(roleId.trim().toLowerCase());
  }

  /**
   * 缺角色时的报错要能直接指向"下一步该配什么"：
   * 走 AD group 的场景里，最常见的原因不是"这个人没权限"，而是"这个角色还没映射到 group"。
   */
  assertRole(principal: Pick<Principal, 'roles' | 'groups'>, roleId: string): void {
    if (this.hasRole(principal, roleId)) return;
    const resolved = this.resolveRoles(principal);
    throw new Error(
      `缺少业务角色 "${roleId}"：当前解析到 ${resolved.join(' / ') || '(无)'}` +
        `（groups: ${(principal.groups ?? []).length} 个；若角色应由 AD group 授予，` +
        '请确认 COPILOT_BUSINESS_ROLES 已把该角色映射到正确的 group object ID）',
    );
  }
}

/** 进程内默认实例：无状态，可安全共享 */
export const authorizationService = new AuthorizationService();

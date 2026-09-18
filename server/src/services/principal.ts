import { config } from '../config.js';
import { DEFAULT_OWNER, type SessionOwner } from './session-registry.js';

/**
 * 调用方身份（比 SessionOwner 多一层角色）。
 *
 * 审批资格只能来自 Identity → Role → Policy：
 * - 未开启 COPILOT_TRUST_IDENTITY_HEADERS 时角色取 COPILOT_DEFAULT_ROLES（本地开发默认 approver）
 * - 开启后由网关/IAP 注入 x-user-roles，客户端不能自报
 */
export interface Principal extends SessionOwner {
  roles: string[];
}

const DEFAULT_ROLES = (process.env.COPILOT_DEFAULT_ROLES ?? 'approver')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

export function principalFromHeaders(h: Record<string, unknown>): Principal {
  if (!config.trustIdentityHeaders) {
    return { ...DEFAULT_OWNER, roles: [...DEFAULT_ROLES] };
  }
  const pick = (v: unknown, fallback: string): string => {
    if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 128);
    if (Array.isArray(v) && typeof v[0] === 'string' && v[0].trim()) {
      return v[0].trim().slice(0, 128);
    }
    return fallback;
  };
  const rawRoles = h['x-user-roles'];
  const roles =
    typeof rawRoles === 'string'
      ? rawRoles
          .split(',')
          .map((s) => s.trim().slice(0, 64))
          .filter(Boolean)
      : [];
  return {
    tenantId: pick(h['x-tenant-id'], DEFAULT_OWNER.tenantId),
    userId: pick(h['x-user-id'], DEFAULT_OWNER.userId),
    roles: roles.length ? roles : [...DEFAULT_ROLES],
  };
}

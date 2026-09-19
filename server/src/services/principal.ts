import { config } from '../config.js';
import { DEFAULT_OWNER, type SessionOwner } from './session-registry.js';

/**
 * 调用方身份。
 *
 * 三层要分清（见 identity/business-roles.ts）：
 *
 *   Principal.groups  Microsoft Entra / AD group **object ID**（网关注入，成员关系的真相）
 *        ↓ RoleRegistry
 *   业务角色           `compliance.reviewer`
 *        ↓ ApprovalPolicy
 *   审批资格
 *
 * 审批资格只能来自 Identity → Role → Policy：
 * - 未开启 COPILOT_TRUST_IDENTITY_HEADERS 时角色取 COPILOT_DEFAULT_ROLES（本地开发默认 approver）
 * - 开启后由网关/IAP 注入 x-user-groups（group object ID）与 x-user-roles（已解析的业务角色），
 *   客户端不能自报
 *
 * 生产建议只注入 `x-user-groups`，让 RoleRegistry 成为"角色 → 组"的唯一映射权威；
 * `x-user-roles` 保留给本地开发与网关已自行解析的场景。
 */
export interface Principal extends SessionOwner {
  roles: string[];
  /**
   * Microsoft Entra / AD group object ID（不是显示名）。
   * 网关负责在 group overage 时走 Graph 取全，服务端只收一份完整 membership。
   * 可选：本地开发与单测可以不传（等价于"不属于任何组"），`principalFromHeaders` 总会填。
   */
  groups?: string[];
}

const DEFAULT_ROLES = (process.env.COPILOT_DEFAULT_ROLES ?? 'approver')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/** 逗号分隔 → 去重列表（header 里的 group object ID 可能重复） */
function splitList(raw: unknown, maxLen: number): string[] {
  if (typeof raw !== 'string') return [];
  return [...new Set(raw.split(',').map((s) => s.trim().slice(0, maxLen)).filter(Boolean))];
}

export function principalFromHeaders(h: Record<string, unknown>): Principal {
  if (!config.trustIdentityHeaders) {
    return { ...DEFAULT_OWNER, roles: [...DEFAULT_ROLES], groups: [] };
  }
  const pick = (v: unknown, fallback: string): string => {
    if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 128);
    if (Array.isArray(v) && typeof v[0] === 'string' && v[0].trim()) {
      return v[0].trim().slice(0, 128);
    }
    return fallback;
  };
  const roles = splitList(h['x-user-roles'], 64);
  // group object ID 是 GUID（36 字符），留 64 足够；上限 200 条与 Entra 单 token 的
  // group claim 上限对齐 —— 超过这个量级本就该由网关走 Graph 取全，而不是塞进 header
  const groups = splitList(h['x-user-groups'], 64).slice(0, 200);
  return {
    tenantId: pick(h['x-tenant-id'], DEFAULT_OWNER.tenantId),
    userId: pick(h['x-user-id'], DEFAULT_OWNER.userId),
    roles: roles.length ? roles : [...DEFAULT_ROLES],
    groups,
  };
}

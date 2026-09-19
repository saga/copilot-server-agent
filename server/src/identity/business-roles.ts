import { config } from '../config.js';

/**
 * RoleRegistry：**业务角色 → Microsoft Entra / AD Group**。
 *
 * 三层必须分开，任何一层都不要越界：
 *
 *   SKILL.md / ApprovalPolicy      声明**业务角色**（`compliance.reviewer`）
 *        ↓  本文件
 *   RoleRegistry                   业务角色 → Entra group **object ID**
 *        ↓  group membership（网关注入）
 *   Actual User
 *
 * 为什么不把 AD Group 写进 SKILL.md：那样 Skill 就从"业务流程定义"变成了"企业访问控制配置"。
 * 组改名、换组、加一个替代组，都不该要求改 SKILL.md；而 SKILL.md 是会被 LLM 读到、
 * 也会被人随手改的文件，不能成为 security boundary。
 *
 * 为什么用 object ID 而不是组显示名：显示名可以改，object ID 是稳定引用。
 * Entra 的 group claim 本身也是 object ID（见 access-token-claims-reference）。
 *
 * 为什么这里没有 Microsoft Graph 调用：group membership 的**取全**（含 group overage
 * 时走 Graph 补齐）发生在网关，服务端只收一份完整 membership 做纯映射。
 * 因此 `resolveRolesForGroups()` 是同步纯函数 —— 没有网络、没有 token、没有缓存，
 * 也就不会把网络等待带进 `HumanTaskService.withTaskLock()` 的临界区。
 */

export interface BusinessRole {
  /** 业务角色 id：`compliance.reviewer` / `investment.committee.member`（小写，点分） */
  id: string;
  name: string;
  description?: string;
  /**
   * Microsoft Entra / AD group 的 **object ID**（不是显示名）。
   *
   * 留空 = 这个角色**谁都不授予**（fail-closed）。宁可审批走不通，也不要因为漏配
   * 一个 group 而变成"所有人都能批"。
   */
  groups: string[];
  /** groups 的匹配方式：ANY = 属于任一即可；ALL = 必须同时属于全部 */
  match: 'ANY' | 'ALL';
}

const roles = new Map<string, BusinessRole>();

const normRole = (s: string): string => s.trim().toLowerCase();
/** group object ID 是 GUID，大小写不敏感；两边都归一化，避免 `A-B` 与 `a-b` 静默失配 */
const normGroup = (s: string): string => s.trim().toLowerCase();

export function registerBusinessRole(role: BusinessRole): void {
  const id = normRole(role.id);
  if (!id) throw new Error('业务角色 id 不能为空');
  if (role.match === 'ALL' && role.groups.length === 0) {
    throw new Error(`业务角色 "${id}" 配了 match=ALL 但没有任何 group（永远无法满足，多半是配置写错了）`);
  }
  roles.set(id, { ...role, id, groups: role.groups.map(normGroup).filter(Boolean) });
}

export function findBusinessRole(id: string): BusinessRole | undefined {
  return roles.get(normRole(id));
}

export function listBusinessRoles(): BusinessRole[] {
  return [...roles.values()];
}

/**
 * 纯映射：当前用户所属的 group object ID → 业务角色。
 *
 * 结果排序，便于比对与写测试（角色的注册顺序不该影响输出）。
 */
export function resolveRolesForGroups(groupIds: readonly string[]): string[] {
  const owned = new Set(groupIds.map(normGroup).filter(Boolean));
  if (!owned.size) return [];
  const out: string[] = [];
  for (const role of roles.values()) {
    if (!role.groups.length) continue; // 没配 group 的角色不授予任何人
    const hit =
      role.match === 'ALL'
        ? role.groups.every((g) => owned.has(g))
        : role.groups.some((g) => owned.has(g));
    if (hit) out.push(role.id);
  }
  return out.sort();
}

/** 校验器用的只读视图：SKILL.md 里写的 `role:` 必须已登记 */
export const businessRoleLookup = {
  hasRole: (id: string): boolean => roles.has(normRole(id)),
};

/** 业务角色 id 的形态：小写字母数字，点/下划线/中划线分隔（避免 `role: APP-FIL-Compliance` 这种把组名写进来） */
export const BUSINESS_ROLE_ID = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;

// ---------- 内置角色 ----------

/**
 * 内置业务角色：**只登记 id，不登记 group**。
 *
 * 它们是"流程可以引用的词汇表"，不是"谁有这个权限"—— 后者是部署配置，
 * 由 `COPILOT_BUSINESS_ROLES` 把角色映射到真实的 Entra group object ID。
 * 没配 group 之前这些角色谁都拿不到（fail-closed），不会静默放行。
 */
const BUILTIN_ROLE_IDS: Array<{ id: string; name: string }> = [
  { id: 'approver', name: '审批人（本地开发默认角色）' },
  { id: 'portfolio_manager', name: '组合经理' },
  { id: 'risk', name: '风控' },
  { id: 'compliance', name: '合规' },
  { id: 'operations', name: '运营' },
  { id: 'compliance.reviewer', name: '合规审核人' },
  { id: 'investment.reviewer', name: '投资审核人' },
  { id: 'investment.committee.member', name: '投资委员会成员' },
];

for (const r of BUILTIN_ROLE_IDS) {
  registerBusinessRole({ id: r.id, name: r.name, groups: [], match: 'ANY' });
}

/**
 * 运维配置：`COPILOT_BUSINESS_ROLES`（JSON 数组）
 *
 * ```json
 * [
 *   { "id": "compliance.reviewer", "name": "合规审核人",
 *     "groups": ["3a7f1c2e-....-....-....-............"], "match": "ANY" },
 *   { "id": "investment.committee.member", "name": "投资委员会成员",
 *     "groups": ["8f2c....", "9ab1...."], "match": "ALL" }
 * ]
 * ```
 *
 * 配错的 JSON 直接抛错启动失败 —— 静默忽略等于"角色永远解析不出来"，
 * 而那时表现是"审批人看不到任务"，比启动失败难排查得多。
 */
function loadConfiguredRoles(raw: string): void {
  if (!raw.trim()) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`COPILOT_BUSINESS_ROLES 不是合法 JSON：${(err as Error).message}`);
  }
  if (!Array.isArray(parsed)) throw new Error('COPILOT_BUSINESS_ROLES 必须是数组');
  for (const item of parsed) {
    const r = item as Partial<BusinessRole>;
    if (typeof r?.id !== 'string' || !r.id.trim()) {
      throw new Error(`COPILOT_BUSINESS_ROLES 里有条目缺少 id：${JSON.stringify(item)}`);
    }
    if (r.match !== undefined && r.match !== 'ANY' && r.match !== 'ALL') {
      throw new Error(`业务角色 "${r.id}" 的 match 只能是 ANY | ALL，收到 "${String(r.match)}"`);
    }
    const existing = findBusinessRole(r.id);
    registerBusinessRole({
      id: r.id,
      name: r.name ?? existing?.name ?? r.id,
      ...(r.description ?? existing?.description ? { description: r.description ?? existing?.description } : {}),
      groups: Array.isArray(r.groups) ? r.groups.filter((g): g is string => typeof g === 'string') : [],
      match: r.match ?? 'ANY',
    });
  }
}

loadConfiguredRoles(config.businessRolesJson);

import type { Principal } from '../services/principal.js';
import type { HumanTask } from './types.js';

/**
 * Human Task  Assignee 判定。
 *
 * 服务端计算，前端只 GET /api/human-tasks —— 客户端不能请求“让我当 approver”，
 * 也不能指定别人的 userId 来投票。
 */
export function isAssignee(task: HumanTask, principal: Principal): boolean {
  if (task.delegatedTo && task.delegatedTo === principal.userId) return true;
  if (task.eligibleUsers.includes(principal.userId)) return true;
  if (principal.roles.length === 0) return false;
  return task.eligibleRoles.some((r) => principal.roles.includes(r));
}

/** 审批/输入的动作主体角色（取命中 eligibleRoles 的第一个；委派场景取委派前角色） */
export function approverRoleFor(task: HumanTask, principal: Principal): string {
  const role = task.eligibleRoles.find((r) => principal.roles.includes(r));
  return role ?? 'delegate';
}

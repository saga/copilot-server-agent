import type { HumanTask } from './types.js';

/**
 * Human Task  Assignee 判定。
 *
 * 服务端计算，前端只 GET /api/human-tasks —— 客户端不能请求“让我当 approver”，
 * 也不能指定别人的 userId 来投票。
 *
 * 传进来的 `roles` 必须是**已解析的业务角色**（`AuthorizationService.resolveRoles()`），
 * 不是原始的 `Principal.roles`：走 AD group 授权的人只有解析之后才会出现在这里，
 * 否则他会"看得到任务但点不动"，或者干脆看不到自己的待办。
 */

/** 判定所需的身份视图：userId + 已解析的业务角色 */
export interface ActorRoles {
  userId: string;
  roles: string[];
}

export function isAssignee(task: HumanTask, actor: ActorRoles): boolean {
  if (task.delegatedTo && task.delegatedTo === actor.userId) return true;
  if (task.eligibleUsers.includes(actor.userId)) return true;
  if (actor.roles.length === 0) return false;
  return task.eligibleRoles.some((r) => actor.roles.includes(r.trim().toLowerCase()));
}

/** 审批/输入的动作主体角色（取命中 eligibleRoles 的第一个；委派场景取委派前角色） */
export function approverRoleFor(task: HumanTask, actor: ActorRoles): string {
  const role = task.eligibleRoles.map((r) => r.trim().toLowerCase()).find((r) => actor.roles.includes(r));
  return role ?? 'delegate';
}

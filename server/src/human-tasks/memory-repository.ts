import { randomUUID } from 'node:crypto';
import type { HumanTaskDecision } from '../approval/types.js';
import type { HumanTaskRepository } from './repository.js';
import type { HumanTask, HumanTaskFilter } from './types.js';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** 内存实现（单测/强制内存后端）。运行期用 SqlHumanTaskRepository（SQLite 或 PostgreSQL）。 */
export class MemoryHumanTaskRepository implements HumanTaskRepository {
  private tasks = new Map<string, HumanTask>();
  private decisions = new Map<string, HumanTaskDecision[]>();

  async create(task: HumanTask): Promise<HumanTask> {
    const stored = clone(task);
    this.tasks.set(task.taskId, stored);
    this.decisions.set(task.taskId, []);
    return clone(stored);
  }

  async get(taskId: string): Promise<HumanTask | undefined> {
    const t = this.tasks.get(taskId);
    return t ? clone(t) : undefined;
  }

  async update(taskId: string, patch: Partial<HumanTask>): Promise<HumanTask | undefined> {
    const t = this.tasks.get(taskId);
    if (!t) return undefined;
    const next = { ...t, ...clone(patch) };
    this.tasks.set(taskId, next);
    return clone(next);
  }

  /** 条件关闭：任务已不是 open 就返回 undefined（与 SQL 版 `where status = 'open'` 对齐） */
  async close(taskId: string, patch: Partial<HumanTask>): Promise<HumanTask | undefined> {
    const t = this.tasks.get(taskId);
    if (!t || t.status !== 'open') return undefined;
    const next = { ...t, ...clone(patch) };
    this.tasks.set(taskId, next);
    return clone(next);
  }

  async list(filter: HumanTaskFilter = {}): Promise<HumanTask[]> {
    const limit = Math.max(1, Math.min(500, filter.limit ?? 50));
    const matched = [...this.tasks.values()].filter((t) => {
      if (filter.executionId && t.executionId !== filter.executionId) return false;
      if (filter.tenantId && t.tenantId !== filter.tenantId) return false;
      if (filter.status && t.status !== filter.status) return false;
      if (filter.type && t.type !== filter.type) return false;
      if (filter.assignee) {
        const { userId, roles } = filter.assignee;
        const byRole = t.eligibleRoles.some((r) => roles.includes(r));
        const byUser = t.eligibleUsers.includes(userId) || t.delegatedTo === userId;
        if (!byRole && !byUser) return false;
      }
      return true;
    });
    return matched.slice(-limit).map(clone);
  }

  async addDecision(decision: HumanTaskDecision): Promise<HumanTaskDecision> {
    const list = this.decisions.get(decision.taskId) ?? [];
    if (list.some((d) => d.approverId === decision.approverId)) {
      throw new Error(`已投票，不能重复审批：${decision.approverId}`);
    }
    const stored = clone(decision);
    list.push(stored);
    this.decisions.set(decision.taskId, list);
    return clone(stored);
  }

  async listDecisions(taskId: string): Promise<HumanTaskDecision[]> {
    return (this.decisions.get(taskId) ?? []).map(clone);
  }

  async listExpired(nowIso: string, limit = 100): Promise<HumanTask[]> {
    return [...this.tasks.values()]
      .filter((t) => t.status === 'open' && !!t.expiresAt && t.expiresAt <= nowIso)
      .slice(0, limit)
      .map(clone);
  }

  clear(): void {
    this.tasks.clear();
    this.decisions.clear();
  }
}

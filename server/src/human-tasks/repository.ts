import type { HumanTaskDecision } from '../approval/types.js';
import type { HumanTask, HumanTaskFilter } from './types.js';

/**
 * HumanTask 持久化抽象（memory 实现用于单副本/单测，PostgreSQL 用于生产）。
 * decision 与 task 分开存：审批结果不覆盖任务本身，一人一票由唯一约束保证。
 */
export interface HumanTaskRepository {
  create(task: HumanTask): Promise<HumanTask>;
  get(taskId: string): Promise<HumanTask | undefined>;
  update(taskId: string, patch: Partial<HumanTask>): Promise<HumanTask | undefined>;
  list(filter?: HumanTaskFilter): Promise<HumanTask[]>;
  /** 一人一票：重复投票由实现抛错（PG 走 unique(task_id, approver_id)） */
  addDecision(decision: HumanTaskDecision): Promise<HumanTaskDecision>;
  listDecisions(taskId: string): Promise<HumanTaskDecision[]>;
  /** 到期未决的任务（过期扫描用） */
  listExpired(nowIso: string, limit?: number): Promise<HumanTask[]>;
}

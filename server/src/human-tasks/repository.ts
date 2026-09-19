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
  /**
   * 条件关闭：只把仍处于 `open` 的任务推进到终态。
   *
   * 返回 `undefined` = 这一枪没打中（任务已被别人关闭）。调用方据此判断
   * **自己是不是完成状态收敛的那一个**，只有抢到的人才允许触发 `onResolved`
   * （否则并发审批会让 `runAction` 执行两次）。语义等价于
   * `update ... where task_id = ? and status = 'open'`，但把"条件"固化在契约里，
   * 避免调用方各写各的、漏掉 where。
   */
  close(taskId: string, patch: Partial<HumanTask>): Promise<HumanTask | undefined>;
  list(filter?: HumanTaskFilter): Promise<HumanTask[]>;
  /** 一人一票：重复投票由实现抛错（PG 走 unique(task_id, approver_id)） */
  addDecision(decision: HumanTaskDecision): Promise<HumanTaskDecision>;
  listDecisions(taskId: string): Promise<HumanTaskDecision[]>;
  /** 到期未决的任务（过期扫描用） */
  listExpired(nowIso: string, limit?: number): Promise<HumanTask[]>;
}

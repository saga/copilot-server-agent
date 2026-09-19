import { findSkill, loadSkill, type LoadedSkill } from '../skills/index.js';
import { parseSkillFlow } from '../skills/flow-parser.js';
import { validateSkillFlow, type FlowRegistryLookup } from '../skills/flow-validator.js';
import { businessRoleLookup } from '../identity/index.js';
import type { FlowDefinition, FlowIssue, FlowPermissionKind } from './types.js';

/**
 * **流程定义来源**：把"一条流程从哪来"从编排器里拆出来。
 *
 * 拆的理由不是抽象洁癖，而是这两件事的**变化原因完全不同**：
 *
 *   DefinitionProvider   流程定义从哪读、怎么校验、怎么确认版本没变
 *   WorkflowRunner       状态怎么推进、什么时候落库、人工任务怎么接回来
 *
 * 现在的实现是"技能目录里的 SKILL.md"，但它显然是会变的：多租户按 tenant 取定义、
 * 从数据库 / 配置中心下发、A/B 两个版本灰度、测试里注入内存定义 —— 每一种都只该
 * 换掉这一层，而不该动状态机。
 *
 * 刻意**不**做成一个大的 `WorkflowEngine` 接口：定义来源与节点执行是两个独立的
 * 变化轴（见 `runtime.ts`），合成一个接口只会让两边互相牵扯。
 */

export type FlowLoadResult =
  | { ok: true; skill: LoadedSkill; definition: FlowDefinition }
  | { ok: false; issues: FlowIssue[] };

export interface FlowDefinitionProvider {
  /** 解析 + 校验。任一环节有问题就把 issue 全列出来（带 SKILL.md 行号） */
  load(input: { skill: string; flow: string }): FlowLoadResult;
  /**
   * 带版本复核的加载：`sourceHash` 对不上就拒绝。
   *
   * 挡住的是金融流程最不该发生的事：已经开始的执行，悄悄切到另一个版本的流程定义上继续跑。
   */
  reload(input: { skill: string; flow: string; sourceHash: string }): FlowLoadResult;
}

export interface SkillFileProviderOptions {
  /** 技能搜索目录 */
  dirs: readonly string[];
  /** 服务端注册表（@gate/@review/@action 必须已登记） */
  registry?: FlowRegistryLookup;
  /** `role:` 指向的业务角色是否已登记 */
  hasRole?: (id: string) => boolean;
  /** `@agent tools:` 的服务端上限 */
  agentTools?: readonly FlowPermissionKind[];
  /** 是否要求每个 `@agent` 声明完成契约 */
  requireAgentOutput?: boolean;
}

/**
 * 默认实现：技能目录里的 `SKILL.md`。
 *
 * 校验用的注册表/角色表由构造参数注入（默认取全局的那两份），
 * 这样单测可以塞一份假的注册表，不必污染全局状态。
 */
export class SkillFileDefinitionProvider implements FlowDefinitionProvider {
  constructor(private readonly opts: SkillFileProviderOptions) {}

  load(input: { skill: string; flow: string }): FlowLoadResult {
    const skill = loadSkill(input.skill, [...this.opts.dirs]);
    if (!skill) {
      return {
        ok: false,
        issues: [
          {
            code: 'skill-missing',
            line: 0,
            message: `技能不存在："${input.skill}"（搜索目录：${this.opts.dirs.join(', ') || '(空)'}）`,
          },
        ],
      };
    }
    const parsed = parseSkillFlow(skill.markdown);
    const validated = validateSkillFlow(parsed, {
      flow: input.flow,
      ...(this.opts.registry ? { registry: this.opts.registry } : {}),
      hasSkill: (name) => Boolean(findSkill(name, [...this.opts.dirs])),
      // `role:` 必须指向已登记的业务角色（RoleRegistry），不是随便一个字符串
      hasRole: this.opts.hasRole ?? businessRoleLookup.hasRole,
      ...(this.opts.agentTools ? { agentTools: this.opts.agentTools } : {}),
      ...(this.opts.requireAgentOutput ? { requireAgentOutput: true } : {}),
    });
    if (!validated.definition) return { ok: false, issues: validated.issues };
    return { ok: true, skill, definition: validated.definition };
  }

  reload(input: { skill: string; flow: string; sourceHash: string }): FlowLoadResult {
    const loaded = this.load(input);
    if (!loaded.ok) return loaded;
    if (loaded.skill.sourceHash !== input.sourceHash) {
      return {
        ok: false,
        issues: [
          {
            code: 'skill-changed',
            line: 0,
            message:
              `SKILL.md 已被修改（建立时 ${input.sourceHash.slice(0, 12)}…，` +
              `现在 ${loaded.skill.sourceHash.slice(0, 12)}…）：流程进行到一半不能切到另一个版本，请人工确认`,
          },
        ],
      };
    }
    return loaded;
  }
}

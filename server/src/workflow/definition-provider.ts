import { loadSkill, type LoadedSkill } from '../skills/index.js';
import { parseSkillFlow } from '../skills/flow-parser.js';
import { validateSkillFlow, type FlowRegistryLookup } from '../skills/flow-validator.js';
import { analyzeFlow } from '../skills/flow-analyzer.js';
import { businessRoleLookup } from '../identity/index.js';
import {
  hasBlockingIssue,
  type FlowDefinition,
  type FlowIssue,
  type FlowPermissionKind,
} from './types.js';

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
 *
 * ## 流水线（三段，各答一个问题）
 *
 *   parseSkillFlow     作者写了什么      → FlowAst
 *   validateSkillFlow  允许执行什么      → FlowDefinition（语义 + 授权，需要注册表）
 *   analyzeFlow        图的形状对不对    → issues（可达性 / 能否到达终态）
 *
 * 三段都跑，**只有 error 阻断**（warning 随结果交回，由 lint 打印）。
 * 分析器也在这里跑而不是只在 lint 里跑：`node-unreachable` 与 `no-terminal-path`
 * 在运行时同样是"跑到一半才发现"的问题，不该降级成离线提示。
 */

export type FlowLoadResult =
  | { ok: true; skill: LoadedSkill; definition: FlowDefinition; warnings: FlowIssue[] }
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
  /** 服务端注册表（@gate/@review/@command 必须已登记） */
  registry?: FlowRegistryLookup;
  /** `role:` 指向的业务角色是否已登记 */
  hasRole?: (id: string) => boolean;
  /** `@task tools:` 的服务端上限 */
  agentTools?: readonly FlowPermissionKind[];
  /** 是否要求每个 `@task` 声明完成契约 */
  requireAgentOutput?: boolean;
}

/**
 * 默认实现：技能目录里的 `SKILL.md`。
 *
 * 校验用的注册表/角色表由构造参数注入（默认取全局的那两份），
 * 这样单测可以塞一份假的注册表，不必污染全局状态。
 *
 * ## 一次读、一次解析、一次校验
 *
 * `load()` 的全部产物 —— **正文、sourceHash、FlowDefinition** —— 必须来自
 * **同一份字节**。这不是洁癖：`sourceHash` 的唯一用途是"这个执行还在用建立时那一版
 * 流程定义吗"。如果哈希来自一次读、定义来自另一次读，文件在两次读之间被替换，
 * 就会得到"定义是旧版、哈希是新版"的组合 —— 之后 `reload()` 会判定"版本没变"
 * 而放行，流程继续跑在一个**从未被校验过**的定义上，审计链上完全看不出来。
 *
 * 所以这里刻意不走 `findSkill()`（它为了拿 frontmatter 的 name 会把每个候选
 * SKILL.md 各读一遍，赢了之后再读一遍）。`loadSkill()` 只读一次，那次读同时用于
 * 匹配技能名、解析 frontmatter、算哈希；下游的解析与校验全部消费它的 `markdown`。
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
    // 解析与校验都只消费 skill.markdown —— 与上面那个 sourceHash 同一份字节
    const ast = parseSkillFlow(skill.markdown);
    const validated = validateSkillFlow(ast, {
      flow: input.flow,
      ...(this.opts.registry ? { registry: this.opts.registry } : {}),
      // 刻意**不**传 `hasSkill`：`@task <id>` 的 id 只是流程图里的一个标签，
      // 不代表"去技能目录里找同名技能"。它跑的是当前 session 的一次 AI 工作单元，
      // 正文就是 prompt —— 见 runner 里 runTask 的说明。
      // `role:` 必须指向已登记的业务角色（RoleRegistry），不是随便一个字符串
      hasRole: this.opts.hasRole ?? businessRoleLookup.hasRole,
      ...(this.opts.agentTools ? { agentTools: this.opts.agentTools } : {}),
      ...(this.opts.requireAgentOutput ? { requireAgentOutput: true } : {}),
    });
    if (!validated.definition) return { ok: false, issues: validated.issues };

    // 控制流分析在**校验通过之后**跑：它只看得懂一张合法的图
    // （边都指向存在的节点），不合法时先让上面的报错说清楚问题。
    const issues = [...validated.issues, ...analyzeFlow(validated.definition)];
    if (hasBlockingIssue(issues)) return { ok: false, issues };
    return {
      ok: true,
      skill,
      definition: validated.definition,
      warnings: issues.filter((i) => i.severity === 'warning'),
    };
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

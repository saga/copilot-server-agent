import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from '../config.js';
import { businessRoleLookup } from '../identity/index.js';
import { loadSkill, skillSearchDirs } from './index.js';
import { analyzeFlow } from './flow-analyzer.js';
import { parseSkillFlow } from './flow-parser.js';
import { validateSkillFlow, type FlowRegistryLookup } from './flow-validator.js';
import { parseAgentTools } from '../workflow/capability.js';
import { flowRegistryLookup } from '../workflow/registry.js';
import {
  WORKFLOW_AGENT_ALLOWED_KINDS,
  isBlockingIssue,
  type FlowIssue,
  type FlowPermissionKind,
} from '../workflow/types.js';

/**
 * `flow:lint` —— 把四层流水线当成一个**离线检查器**跑一遍。
 *
 *   SKILL.md → FlowAst → FlowDefinition → 控制流分析 → issues
 *
 * 这不是"另写一套校验"：它调用的就是运行时用的那三个函数，只是换了个入口和输出。
 * 这一点很关键 —— 如果 lint 与运行时的判定有分歧，它给出的"通过"就是假的。
 *
 * 所以下面刻意用**与生产同一份**服务端注册表（`flowRegistryLookup`、`businessRoleLookup`）
 * 和同一份配置（`config.workflowAgentTools` / `workflowRequireAgentOutput`）：
 * 报告里说"gate 没注册"就是真的会在运行时被拒。
 *
 * 唯一与生产不同的是：**warning 不算失败**（生产也一样，warning 不阻断）。
 */

export interface LintOptions {
  /** 只校验某个流程（`@flow` 的 id）；不给则不做名字比对 */
  flow?: string;
  /** 技能搜索目录（`@agent <id>` 指向的技能是否存在） */
  dirs?: string[];
  registry?: FlowRegistryLookup;
  hasRole?: (id: string) => boolean;
  hasSkill?: (name: string) => boolean;
  agentTools?: readonly FlowPermissionKind[];
  requireAgentOutput?: boolean;
}

export interface LintResult {
  /** 文件里根本没有 flow block（普通技能）—— 不是错误，跳过即可 */
  skipped: boolean;
  issues: FlowIssue[];
  /** 是否通过了可以执行的最低标准（没有任何 error） */
  ok: boolean;
}

/**
 * 对一份 SKILL.md 内容跑完整流水线。
 *
 * 与 `definition-provider.load()` 的分工：那边要拿到 `FlowDefinition` 才能推进流程，
 * 所以遇到 error 就直接返回；这里要的是**把问题全列出来**，所以哪怕校验没过，
 * 也仍然尝试把能跑的检查跑完（例如"这个 gate 没注册"和"这条边指向不存在的节点"
 * 应该一起报出来，而不是修一个再跑一次）。
 */
export function lintSkillFlow(markdown: string, opts: LintOptions = {}): LintResult {
  const ast = parseSkillFlow(markdown);
  // 普通技能（只有说明、没有 @block）不是"校验失败"，只是不适用
  if (!ast.flows.length && !ast.nodes.length) return { skipped: true, issues: [], ok: true };

  const validated = validateSkillFlow(ast, {
    ...(opts.flow ? { flow: opts.flow } : {}),
    ...(opts.registry ? { registry: opts.registry } : {}),
    ...(opts.hasSkill ? { hasSkill: opts.hasSkill } : {}),
    ...(opts.hasRole ? { hasRole: opts.hasRole } : {}),
    ...(opts.agentTools ? { agentTools: opts.agentTools } : {}),
    ...(opts.requireAgentOutput ? { requireAgentOutput: true } : {}),
  });

  // 图的分析只在定义成立时跑得动。这不是偷懒，而是**避免报出误导性的结论**：
  // 一条边指向不存在的节点时，分析器看到的是"这个节点出不去"，于是报一条
  // `no-terminal-path` —— 而真正的问题是那个拼错的 target。先让结构错误说清楚，
  // 修完再跑一次看逻辑问题，与编译器"先报语法再报类型"是同一个节奏。
  const issues = validated.definition
    ? [...validated.issues, ...analyzeFlow(validated.definition)]
    : validated.issues;

  return {
    skipped: false,
    issues: [...issues].sort((a, b) => a.line - b.line || a.code.localeCompare(b.code)),
    ok: !issues.some(isBlockingIssue),
  };
}

// ---------- CLI ----------

const USAGE = `用法：npm run flow:lint -- <SKILL.md | 技能目录 | 技能根目录> [...]

  SKILL.md 的路径        只检查这一个文件
  技能目录（含 SKILL.md）  检查这一个技能
  技能根目录             检查它下面每个 <子目录>/SKILL.md

环境变量与运行时共用：COPILOT_WORKFLOW_AGENT_TOOLS / COPILOT_WORKFLOW_REQUIRE_AGENT_OUTPUT /
COPILOT_BUSINESS_ROLES / COPILOT_SKILL_ROOTS —— lint 与服务端看到的是同一套注册表与配置。`;

/** 把参数展开成一组要检查的 SKILL.md 路径 */
function resolveTargets(inputs: string[]): string[] {
  const files: string[] = [];
  for (const input of inputs) {
    const abs = path.resolve(input);
    if (!existsSync(abs)) {
      files.push(abs); // 交给下面报"文件不存在"
      continue;
    }
    if (statSync(abs).isFile()) {
      files.push(abs);
      continue;
    }
    if (existsSync(path.join(abs, 'SKILL.md'))) {
      files.push(path.join(abs, 'SKILL.md'));
      continue;
    }
    for (const sub of readdirSync(abs)) {
      const file = path.join(abs, sub, 'SKILL.md');
      if (existsSync(file)) files.push(file);
    }
  }
  return [...new Set(files)];
}

/** 生产同款的校验上下文（注册表 + 配置） */
function defaultOptions(dirs: string[]): LintOptions {
  return {
    dirs,
    registry: flowRegistryLookup,
    hasRole: businessRoleLookup.hasRole,
    hasSkill: (name) => Boolean(loadSkill(name, dirs)),
    agentTools: parseAgentTools(config.workflowAgentTools, WORKFLOW_AGENT_ALLOWED_KINDS),
    requireAgentOutput: config.workflowRequireAgentOutput,
  };
}

function format(file: string, issue: FlowIssue): string {
  const level = (issue.severity ?? 'error') === 'error' ? 'ERROR' : 'WARN ';
  const where = issue.line > 0 ? `${file}:${issue.line}` : file;
  return `${where} ${level} ${issue.code}  ${issue.message}`;
}

/**
 * 显示用的路径：优先相对 cwd（短、可点击），在 cwd 之外就用绝对路径。
 * 不这样做的话，检查 `/tmp/x` 会打印出 `../../../../tmp/x` —— 又长又没用。
 */
function displayPath(file: string): string {
  const rel = path.relative(process.cwd(), file);
  return rel && !rel.startsWith('..') ? rel : file;
}

export function main(argv: string[]): number {
  const inputs = argv.filter((a) => !a.startsWith('-'));
  if (!inputs.length) {
    console.error(USAGE);
    return 2;
  }

  const dirs = skillSearchDirs();
  const opts = defaultOptions(dirs);
  let errors = 0;
  let warnings = 0;
  let checked = 0;
  let skipped = 0;

  for (const file of resolveTargets(inputs)) {
    const shown = displayPath(file);
    if (!existsSync(file)) {
      console.error(`${shown} ERROR file-missing  文件不存在`);
      errors++;
      continue;
    }
    const result = lintSkillFlow(readFileSync(file, 'utf-8'), opts);
    if (result.skipped) {
      skipped++;
      continue;
    }
    checked++;
    for (const issue of result.issues) {
      console.log(format(shown, issue));
      if ((issue.severity ?? 'error') === 'error') errors++;
      else warnings++;
    }
  }

  const parts = [`${checked} 个 flow 已检查`];
  if (skipped) parts.push(`${skipped} 个非 flow 技能已跳过`);
  console.log('');
  console.log(
    errors
      ? `✖ ${errors} error${errors > 1 ? 's' : ''}${warnings ? `, ${warnings} warning${warnings > 1 ? 's' : ''}` : ''} —— ${parts.join('，')}`
      : `✔ 通过${warnings ? `（${warnings} warning）` : ''} —— ${parts.join('，')}`,
  );
  return errors ? 1 : 0;
}

// 只在被直接执行时跑 CLI（被 import 时保持纯函数，便于单测）
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}

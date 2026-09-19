import type { ParsedSkillFlow } from './flow-parser.js';
import { NODE_OUTCOMES, type FlowDefinition, type FlowIssue, type FlowNode } from '../workflow/types.js';

/**
 * Flow 静态校验。**在执行之前**把问题全部报出来，不要跑到一半才发现路由指向不存在的节点。
 *
 * 只做 8 件事（刻意不做 DAG 校验）：
 *   1. 恰好一个 @flow（v1 一个技能一条流程）
 *   2. @flow 声明了 start
 *   3. 节点 id 唯一
 *   4. 所有 route target 都存在
 *   5. @end / @stop 不允许再 route
 *   6. 非终态节点必须至少有一条 route
 *   7. 所有节点从 start 可达
 *   8. **允许环** —— research → review → research 是研究流程的常态，用可达性而不是 DAG 判定
 *
 * `@subagent <skill>` 指向的技能是否存在由调用方补校验（校验器不认识技能目录）。
 */

export interface FlowRegistryLookup {
  hasGate(name: string): boolean;
  hasReview(name: string): boolean;
  hasAction(name: string): boolean;
}

export interface ValidateSkillFlowOptions {
  /** execution 上声明的 flow 名；与 `@flow` 的 id 不一致时报错 */
  flow?: string;
  /** 服务端注册表：@gate/@review/@action 必须已登记（否则会在执行到那一步时才知道） */
  registry?: FlowRegistryLookup;
  /** `@subagent <id>` 指向的技能是否存在 */
  hasSkill?: (name: string) => boolean;
}

export interface FlowValidationResult {
  /** 仅在没有任何 issue 时给出 */
  definition?: FlowDefinition;
  issues: FlowIssue[];
}

const TERMINAL_TYPES = new Set(['stop', 'end']);

export function validateSkillFlow(
  parsed: ParsedSkillFlow,
  opts: ValidateSkillFlowOptions = {},
): FlowValidationResult {
  const issues: FlowIssue[] = [...parsed.issues];
  const flowBlocks = parsed.blocks.filter((b) => b.type === 'flow');

  // 1. 恰好一个 @flow
  if (flowBlocks.length === 0) {
    issues.push({
      code: 'flow-missing',
      line: 0,
      message: 'SKILL.md 里没有 @flow 块（写法：## @flow <id>）',
    });
    return { issues };
  }
  if (flowBlocks.length > 1) {
    issues.push({
      code: 'flow-duplicate',
      line: flowBlocks[1]!.headingLine,
      message: `v1 只支持一个 @flow，发现 ${flowBlocks.length} 个（${flowBlocks.map((b) => b.id).join(', ')}）`,
    });
    return { issues };
  }
  const flowBlock = flowBlocks[0]!;

  if (opts.flow && flowBlock.id !== opts.flow.toLowerCase()) {
    issues.push({
      code: 'flow-name-mismatch',
      line: flowBlock.headingLine,
      message: `SKILL.md 里的流程是 "${flowBlock.id}"，但请求的是 "${opts.flow}"`,
    });
  }

  // 2. start
  const start = flowBlock.start;
  if (!start) {
    // @flow 缺 start 时 parser 已经报过一条
    if (!issues.some((i) => i.code === 'flow-missing-start')) {
      issues.push({ code: 'flow-missing-start', line: flowBlock.headingLine, message: '@flow 没有声明入口（start -> <节点 id>）' });
    }
    return { issues };
  }

  const nodeBlocks = parsed.blocks.filter((b) => b.type !== 'flow');

  // 3. 节点 id 唯一
  const nodes: Record<string, FlowNode> = {};
  for (const block of nodeBlocks) {
    if (!block.id) continue; // parser 已报 block-missing-id
    if (nodes[block.id]) {
      issues.push({
        code: 'node-duplicate',
        line: block.headingLine,
        nodeId: block.id,
        message: `节点 id 重复："${block.id}"（已出现在第 ${nodes[block.id]!.headingLine} 行）`,
      });
      continue;
    }
    nodes[block.id] = {
      id: block.id,
      type: block.type as FlowNode['type'],
      body: block.markdown,
      routes: block.routes,
      startLine: block.startLine,
      headingLine: block.headingLine,
      endLine: block.endLine,
    };
  }

  // 4/5/6. 路由合法性
  for (const node of Object.values(nodes)) {
    const terminal = TERMINAL_TYPES.has(node.type);
    if (terminal && node.routes.length) {
      issues.push({
        code: 'terminal-has-route',
        line: node.headingLine,
        nodeId: node.id,
        message: `@${node.type} ${node.id} 是终态，不允许再有 route（${node.routes.map((r) => `${r.on} -> ${r.to}`).join('、')}）`,
      });
    }
    if (!terminal && node.routes.length === 0) {
      issues.push({
        code: 'node-missing-route',
        line: node.headingLine,
        nodeId: node.id,
        message: `@${node.type} ${node.id} 没有出口（非终态节点必须至少有一条 route，如 "- success -> next"）`,
      });
    }
    for (const route of node.routes) {
      if (!nodes[route.to]) {
        issues.push({
          code: 'route-target-missing',
          line: node.headingLine,
          nodeId: node.id,
          message: `@${node.type} ${node.id} 的 route "${route.on} -> ${route.to}" 指向不存在的节点："${route.to}"`,
        });
      }
    }
  }

  // 6b. 出口必须写全：@subagent/@action 只会有 success|fail，@review 只会有 approve|reject。
  // 少写一个出口，运行时那条分支就无处可去 —— 这类问题在执行前就该报出来。
  for (const node of Object.values(nodes)) {
    const required = NODE_OUTCOMES[node.type];
    if (!required.length) continue;
    const declared = new Set(node.routes.map((r) => r.on));
    const missing = required.filter((o) => !declared.has(o));
    if (missing.length) {
      issues.push({
        code: 'node-missing-outcome',
        line: node.headingLine,
        nodeId: node.id,
        message: `@${node.type} ${node.id} 缺少出口 ${missing.join('、')} 的 route（${node.type} 只会有出口：${required.join(' / ')}）`,
      });
    }
  }

  // 7. 可达性（允许环，所以只查可达、不做 DAG）
  if (nodes[start]) {
    const reachable = new Set<string>();
    const queue = [start];
    while (queue.length) {
      const id = queue.shift()!;
      if (reachable.has(id)) continue;
      reachable.add(id);
      for (const route of nodes[id]?.routes ?? []) {
        if (nodes[route.to]) queue.push(route.to);
      }
    }
    for (const node of Object.values(nodes)) {
      if (!reachable.has(node.id)) {
        issues.push({
          code: 'node-unreachable',
          line: node.headingLine,
          nodeId: node.id,
          message: `@${node.type} ${node.id} 从 start "${start}" 不可达（没有任何 route 指向它）`,
        });
      }
    }
  } else {
    issues.push({
      code: 'start-missing-node',
      line: flowBlock.headingLine,
      message: `入口 "start -> ${start}" 指向不存在的节点："${start}"`,
    });
  }

  // 服务端注册表：SKILL.md 只声明"这里需要 compliance-review"，由 registry 决定谁有资格
  for (const node of Object.values(nodes)) {
    const missing =
      (node.type === 'gate' && opts.registry && !opts.registry.hasGate(node.id)) ||
      (node.type === 'review' && opts.registry && !opts.registry.hasReview(node.id)) ||
      (node.type === 'action' && opts.registry && !opts.registry.hasAction(node.id));
    if (missing) {
      issues.push({
        code: `registry-missing-${node.type}`,
        line: node.headingLine,
        nodeId: node.id,
        message: `${node.type} "${node.id}" 没有在服务端注册（SKILL.md 不能自己定义 ${node.type} 的语义）`,
      });
    }
    if (node.type === 'subagent' && opts.hasSkill && !opts.hasSkill(node.id)) {
      issues.push({
        code: 'skill-missing',
        line: node.headingLine,
        nodeId: node.id,
        message: `@subagent ${node.id} 没有对应的技能（技能目录里没有名为 "${node.id}" 的 SKILL.md）`,
      });
    }
  }

  if (issues.length) return { issues };
  return { definition: { id: flowBlock.id, start, nodes }, issues };
}

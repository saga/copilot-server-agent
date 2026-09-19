import type { ParsedFlowAttr, ParsedFlowBlock, ParsedSkillFlow } from './flow-parser.js';
import { BUSINESS_ROLE_ID } from '../identity/business-roles.js';
import {
  NODE_ATTRS,
  NODE_OUTCOMES,
  type FlowDefinition,
  type FlowIssue,
  type FlowNode,
  type FlowNodeAttrs,
  type FlowRoute,
} from '../workflow/types.js';

/**
 * Flow 静态校验。**在执行之前**把问题全部报出来，不要跑到一半才发现路由指向不存在的节点。
 *
 * 只做 10 件事（刻意不做 DAG 校验）：
 *   1. 恰好一个 @flow（v1 一个技能一条流程）
 *   2. @flow 声明了 start，且 start 不重复
 *   3. 节点 id 唯一
 *   4. 所有 route target 都存在
 *   5. @end / @stop 不允许再 route
 *   6. 非终态节点必须至少有一条 route
 *   7. 所有节点从 start 可达
 *   8. **同一个出口不能有两条 route** —— 否则 runner 取第一条，后面那条静默失效
 *   9. **保留属性合法**（role/strategy/required/exclude），且 @review 必须能拿到业务角色
 *  10. **允许环** —— research → review → research 是研究流程的常态，用可达性而不是 DAG 判定
 *
 * `@agent <skill>` 指向的技能是否存在由调用方补校验（校验器不认识技能目录）；
 * `role:` 指向的业务角色是否已登记同理（见 `opts.hasRole`）。
 */

export interface FlowRegistryLookup {
  hasGate(name: string): boolean;
  hasReview(name: string): boolean;
  hasAction(name: string): boolean;
  /**
   * 该 review 在服务端登记的资格角色。
   *
   * SKILL.md 没写 `role:` 时，角色从注册表兜底 —— 这个回调让校验器能回答
   * "这个 @review 到底有没有角色"（两边都没有 = 建出来一个人人都不能批的任务）。
   * 不提供该回调时跳过这项检查（只做结构校验的场景）。
   */
  reviewRoles?(name: string): string[] | undefined;
}

export interface ValidateSkillFlowOptions {
  /** execution 上声明的 flow 名；与 `@flow` 的 id 不一致时报错 */
  flow?: string;
  /** 服务端注册表：@gate/@review/@action 必须已登记（否则会在执行到那一步时才知道） */
  registry?: FlowRegistryLookup;
  /** `@agent <id>` 指向的技能是否存在 */
  hasSkill?: (name: string) => boolean;
  /** `role:` 指向的业务角色是否已在 RoleRegistry 登记（见 identity/business-roles.ts） */
  hasRole?: (id: string) => boolean;
}

export interface FlowValidationResult {
  /** 仅在没有任何 issue 时给出 */
  definition?: FlowDefinition;
  issues: FlowIssue[];
}

const TERMINAL_TYPES = new Set(['stop', 'end']);

/**
 * 校验并归一化节点的保留属性。
 *
 * 词法已经由 parser 保证（名字认得、不重复），这里只管**值的语义**：
 * `strategy` 只能是 ANY/ALL、`required` 只能是正整数、`exclude` 只能是 initiator/none、
 * `role` 必须是登记过的业务角色 id。
 *
 * 一条属性不合法就丢掉它（不产出该字段）—— 有 issue 的流程本来就不会给出 definition，
 * 不存在"带着半个属性跑起来"的可能。
 */
function buildAttrs(input: {
  block: ParsedFlowBlock;
  nodeId: string;
  hasRole?: (id: string) => boolean;
  issues: FlowIssue[];
}): FlowNodeAttrs {
  const { block, nodeId, hasRole, issues } = input;
  const attrs: FlowNodeAttrs = {};
  const nodeIdField = nodeId ? { nodeId } : {};

  const bad = (attr: ParsedFlowAttr, detail: string): void => {
    issues.push({
      code: 'attr-invalid',
      line: attr.line,
      ...nodeIdField,
      message: `@${block.type}${nodeId ? ` ${nodeId}` : ''} 的属性 "${attr.name}" 不合法：${detail}`,
    });
  };

  for (const attr of block.attrs) {
    switch (attr.name) {
      case 'role': {
        // 刻意在**小写化之前**判形态：角色 id 一律全小写，而 AD Group 名几乎总是
        // `APP-FIL-Compliance-Reviewer` 这种混合大小写 —— 这条规则顺手把"把组名写进
        // SKILL.md"这个最常见的越界挡在门口。
        const id = attr.value.trim();
        if (!BUSINESS_ROLE_ID.test(id)) {
          bad(
            attr,
            `"${attr.value}" 不是业务角色 id（全小写、点分，如 compliance.reviewer）。` +
              '**不要写 AD Group 名或 object ID** —— 角色到组的映射在服务端 COPILOT_BUSINESS_ROLES',
          );
          break;
        }
        if (hasRole && !hasRole(id)) {
          issues.push({
            code: 'role-missing',
            line: attr.line,
            ...nodeIdField,
            message:
              `@${block.type}${nodeId ? ` ${nodeId}` : ''} 引用的业务角色 "${id}" 没有登记` +
              '（在 identity/business-roles.ts 或 COPILOT_BUSINESS_ROLES 里登记后才会生效）',
          });
          break;
        }
        attrs.role = id;
        break;
      }
      case 'strategy': {
        const v = attr.value.trim().toUpperCase();
        if (v !== 'ANY' && v !== 'ALL') bad(attr, `"${attr.value}" 不是 ANY | ALL`);
        else attrs.strategy = v;
        break;
      }
      case 'required': {
        const n = Number(attr.value.trim());
        if (!Number.isInteger(n) || n < 1) bad(attr, `"${attr.value}" 不是正整数（要几票）`);
        else attrs.required = n;
        break;
      }
      case 'exclude': {
        const v = attr.value.trim().toLowerCase();
        if (v !== 'initiator' && v !== 'none') {
          bad(attr, `"${attr.value}" 不是 initiator | none（更复杂的 SoD 不要写进 SKILL.md）`);
        } else attrs.exclude = v;
        break;
      }
      default:
        // parser 已经对未知属性名 / 用错节点类型的属性名报过 issue，这里不再重复
        break;
    }
  }
  return attrs;
}

/**
 * 同一个出口名不能有两条 route。
 *
 * `findRoute()` 是 `routes.find((r) => r.on === outcome)` —— 第一条命中就返回，
 * 后面的**静默被忽略**。作者以为"pass 会去 a 也可能去 b"，实际永远只去 a。
 * 这种"看不出错、但走向不由自己决定"的写法必须在执行前拦住。
 */
function checkDuplicateOutcomes(
  routes: FlowRoute[],
  line: number,
  issues: FlowIssue[],
  where: { nodeId?: string; label: string },
): void {
  const seen = new Map<string, string>();
  for (const route of routes) {
    const previous = seen.get(route.on);
    if (previous) {
      issues.push({
        code: 'route-outcome-duplicate',
        line,
        ...(where.nodeId ? { nodeId: where.nodeId } : {}),
        message:
          `${where.label} 的出口 "${route.on}" 重复：` +
          `${previous} 与 ${route.to} 不能同时存在（只会走第一条）`,
      });
      continue;
    }
    seen.set(route.on, route.to);
  }
}

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

  // 2b. `start` 也只能有一条：`start -> a` 与 `start -> b` 同时存在时 runner 取第一条，
  // 第二条静默失效 —— 金融流程不该有这种"看书写顺序决定走向"的不确定性。
  checkDuplicateOutcomes(flowBlock.routes, flowBlock.headingLine, issues, {
    nodeId: flowBlock.id,
    label: `@flow ${flowBlock.id}`,
  });

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
      attrs: buildAttrs({
        block,
        nodeId: block.id,
        ...(opts.hasRole ? { hasRole: opts.hasRole } : {}),
        issues,
      }),
      routes: block.routes,
      startLine: block.startLine,
      headingLine: block.headingLine,
      endLine: block.endLine,
    };
  }

  // 4/5/6/8. 路由合法性
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
    checkDuplicateOutcomes(node.routes, node.headingLine, issues, {
      nodeId: node.id,
      label: `@${node.type} ${node.id}`,
    });
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

  // 6b. 出口必须写全：@agent/@action 只会有 success|fail，@review 只会有 approve|reject。
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
    if (node.type === 'agent' && opts.hasSkill && !opts.hasSkill(node.id)) {
      issues.push({
        code: 'skill-missing',
        line: node.headingLine,
        nodeId: node.id,
        message: `@agent ${node.id} 没有对应的技能（技能目录里没有名为 "${node.id}" 的 SKILL.md）`,
      });
    }
  }

  // 一个没有角色的 @review 是**不完整的流程定义**：任务建出来了，但没人有资格批。
  // SKILL.md 的 `role:` 与注册表的 eligibleRoles 二选一即可（SKILL.md 优先）。
  // 只有在调用方提供了 reviewRoles 时才判定 —— 否则"没登记"和"没告诉我校验器"分不清。
  if (opts.registry?.reviewRoles) {
    for (const node of Object.values(nodes)) {
      if (node.type !== 'review') continue;
      const fromRegistry = opts.registry.reviewRoles(node.id) ?? [];
      if (!node.attrs.role && fromRegistry.length === 0) {
        issues.push({
          code: 'review-missing-role',
          line: node.headingLine,
          nodeId: node.id,
          message:
            `@review ${node.id} 没有指定审核角色：SKILL.md 里写 "role: <业务角色>"，` +
            '或在服务端 registry 登记该 review 的 eligibleRoles。' +
            '（注意属性必须写在正文最前面，紧跟标题之后）',
        });
      }
    }
  }

  if (issues.length) return { issues };
  return { definition: { id: flowBlock.id, start, nodes }, issues };
}

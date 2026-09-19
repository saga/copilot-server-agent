import type { ParsedFlowAttr, ParsedFlowBlock, ParsedSkillFlow } from './flow-parser.js';
import { BUSINESS_ROLE_ID } from '../identity/business-roles.js';
import {
  FLOW_CONTRACT_ID,
  NODE_OUTCOMES,
  isFlowPermissionKind,
  type FlowDefinition,
  type FlowIssue,
  type FlowNode,
  type FlowNodeAttrs,
  type FlowPermissionKind,
  type FlowRoute,
  type ReviewBasePolicy,
} from '../workflow/types.js';

/**
 * Flow 静态校验。**在执行之前**把问题全部报出来，不要跑到一半才发现路由指向不存在的节点。
 *
 * 只做 13 件事（刻意不做 DAG 校验）：
 *   1. 恰好一个 @flow（v1 一个技能一条流程）
 *   2. @flow 声明了 start，且 start 不重复
 *   3. 节点 id 唯一
 *   4. 所有 route target 都存在
 *   5. @end / @stop 不允许再 route
 *   6. 非终态节点必须至少有一条 route
 *   7. 所有节点从 start 可达
 *   8. **同一个出口不能有两条 route** —— 否则 runner 取第一条，后面那条静默失效
 *   9. **保留属性合法**（role/strategy/required/exclude/output/tools），且 @review 必须能拿到业务角色
 *  10. **允许环** —— research → review → research 是研究流程的常态，用可达性而不是 DAG 判定
 *  11. **属性只能比服务端更严**：`role` 必须落在注册表的 eligibleRoles 里，
 *      `strategy` 只能 ANY→ALL，`required` 只能加不能减，`exclude` 不能把禁止自批改成允许
 *      （否则一份可编辑的 Markdown 就能把"要 3 个人批"降成"1 个人批"）
 *  12. **@gate 的出口与注册表声明一致**：声明的出口必须有 route，route 的出口必须被声明
 *  13. **@agent 的完成契约与能力边界**：`output:` 必须已注册；`tools:` 只能比服务端上限更严
 *
 * `@agent <skill>` 指向的技能是否存在由调用方补校验（校验器不认识技能目录）；
 * `role:` 指向的业务角色是否已登记同理（见 `opts.hasRole`）。
 */

export interface FlowRegistryLookup {
  hasGate(name: string): boolean;
  hasReview(name: string): boolean;
  hasAction(name: string): boolean;
  /** `@agent output:` 指向的完成契约是否已注册 */
  hasOutput?(name: string): boolean;
  /**
   * 该 gate 声明的出口名。
   *
   * gate 的出口没有固定词汇表（pass / fail / review / again…），所以"出口有没有 route"
   * 只能靠这份声明来静态判定。不提供该回调时跳过这项检查（只做结构校验的场景）。
   */
  gateOutcomes?(name: string): readonly string[] | undefined;
  /**
   * 该 review 的**基策略**（服务端权威）。
   *
   * SKILL.md 的属性只能在此基础上收窄 —— 这个回调让校验器能在执行之前回答
   * "这份流程定义有没有偷偷放宽审批要求"。不提供时跳过（只做结构校验的场景）。
   */
  reviewPolicy?(name: string): ReviewBasePolicy | undefined;
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
  /**
   * `@agent tools:` 的服务端**上限**（见 config.workflowAgentTools）。
   *
   * 属性只能比它更严：默认上限不含 `mcp` 与 `shell`，因为那两样正是绕开 `@action`
   * 审批直接产生业务副作用的路径。不提供时按"全部允许"处理（只做结构校验的场景）。
   */
  agentTools?: readonly FlowPermissionKind[];
  /** 是否要求每个 `@agent` 都声明完成契约（见 config.workflowRequireAgentOutput） */
  requireAgentOutput?: boolean;
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
 * `role` 必须是登记过的业务角色 id、`tools` 必须是已知权限类别。
 *
 * 一条属性不合法就丢掉它（不产出该字段）—— 有 issue 的流程本来就不会给出 definition，
 * 不存在"带着半个属性跑起来"的可能。
 *
 * **"只能更严"的判定不在这里**：那需要对照服务端基策略，放在 `checkNarrowing()`，
 * 因为那一步要等所有节点的属性都归一化完、注册表也可用。
 */
function buildAttrs(input: {
  block: ParsedFlowBlock;
  nodeId: string;
  hasRole?: (id: string) => boolean;
  hasOutput?: (id: string) => boolean;
  issues: FlowIssue[];
}): FlowNodeAttrs {
  const { block, nodeId, hasRole, hasOutput, issues } = input;
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
      case 'output': {
        const id = attr.value.trim().toLowerCase();
        if (!FLOW_CONTRACT_ID.test(id)) {
          bad(attr, `"${attr.value}" 不是完成契约 id（小写、点分，如 research.brief）`);
          break;
        }
        if (hasOutput && !hasOutput(id)) {
          issues.push({
            code: 'registry-missing-output',
            line: attr.line,
            ...nodeIdField,
            message:
              `@agent${nodeId ? ` ${nodeId}` : ''} 引用的完成契约 "${id}" 没有在服务端注册` +
              '（SKILL.md 不能自己定义"什么叫做完了"—— 那是服务端的判定）',
          });
          break;
        }
        attrs.output = id;
        break;
      }
      case 'tools': {
        const raw = attr.value
          .split(',')
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean);
        if (!raw.length) {
          bad(attr, `"${attr.value}" 是空列表（写法：tools: read,write）`);
          break;
        }
        const unknown = raw.filter((t) => !isFlowPermissionKind(t));
        if (unknown.length) {
          bad(
            attr,
            `"${unknown.join(', ')}" 不是已知权限类别（可用：read / write / shell / mcp / url）`,
          );
          break;
        }
        attrs.tools = [...new Set(raw as FlowPermissionKind[])];
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

/**
 * `@review` 的属性只能比注册表的基策略**更严**。
 *
 * 这是本轮最重要的一条安全规则：`@review` 的四个属性都是"审批有多严格"的旋钮，
 * 如果 SKILL.md 能覆盖注册表，那么一个会被 LLM 读到、也会被人随手改的 Markdown
 * 就成了放宽企业审批要求的入口 ——
 *
 *   role      原先是覆盖（把 3 个角色换成 1 个别的角色）→ 现在是**交集**
 *   strategy  原先是覆盖（ALL 3 票 → ANY 1 票）→ 现在只能 ANY→ALL
 *   required  原先是覆盖（要 3 票 → 要 1 票）→ 现在只能 ≥ 基策略
 *   exclude   原先是覆盖（禁止自批 → 允许自批）→ 现在不能把 false 改成 true
 */
function checkNarrowing(input: {
  node: FlowNode;
  base: ReviewBasePolicy;
  issues: FlowIssue[];
}): void {
  const { node, base, issues } = input;
  const attrs = node.attrs;
  const label = `@review ${node.id}`;
  const push = (message: string): void => {
    issues.push({ code: 'attr-widens', line: node.headingLine, nodeId: node.id, message });
  };

  if (attrs.role && !base.eligibleRoles.includes(attrs.role)) {
    issues.push({
      code: 'role-not-allowed',
      line: node.headingLine,
      nodeId: node.id,
      message:
        `${label} 的 role: ${attrs.role} 不在注册表给该 review 的资格角色里` +
        `（${base.eligibleRoles.join(' / ') || '(空)'}）。` +
        'SKILL.md 只能从基策略里收窄，不能引入新角色 —— 角色到 Entra group 的映射在服务端',
    });
  }
  if (attrs.strategy && base.strategy === 'ALL' && attrs.strategy === 'ANY') {
    push(
      `${label} 的 strategy: ANY 放宽了注册表的 ALL（基策略要求全员通过，SKILL.md 不能降成任一通过）`,
    );
  }
  if (attrs.required !== undefined && attrs.required < base.requiredCount) {
    push(
      `${label} 的 required: ${attrs.required} 低于注册表要求的 ${base.requiredCount} 票` +
        '（票数只能加不能减）',
    );
  }
  if (attrs.exclude === 'none' && !base.allowInitiator) {
    push(
      `${label} 的 exclude: none 放宽了注册表的 SoD 要求（基策略不允许发起人自批）`,
    );
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
        ...(opts.registry?.hasOutput ? { hasOutput: opts.registry.hasOutput } : {}),
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
  // @gate 不在这里：它的出口词汇表由注册表声明，走下面 6c 那条路径。
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

  // 6c. @gate 的出口与注册表声明必须一一对上。
  // 没有这一条，"gate 返回 review 但流程里没有 review 的 route"只会在**跑到那一步时**
  // 才暴露 —— 而那时前面的步骤（可能已经发了邮件）都做完了。
  if (opts.registry?.gateOutcomes) {
    for (const node of Object.values(nodes)) {
      if (node.type !== 'gate') continue;
      const declared = opts.registry.gateOutcomes(node.id);
      if (!declared) continue; // 未注册由 registry-missing-gate 报
      const declaredSet = new Set(declared);
      const routedSet = new Set(node.routes.map((r) => r.on));
      const unrouted = declared.filter((o) => !routedSet.has(o));
      if (unrouted.length) {
        issues.push({
          code: 'gate-outcome-unrouted',
          line: node.headingLine,
          nodeId: node.id,
          message:
            `@gate ${node.id} 声明的出口 ${unrouted.join('、')} 没有 route：` +
            'gate 真的返回这个出口时流程无处可去（只能在运行时落 failed）',
        });
      }
      const unknown = [...routedSet].filter((o) => !declaredSet.has(o));
      if (unknown.length) {
        issues.push({
          code: 'gate-outcome-unknown',
          line: node.headingLine,
          nodeId: node.id,
          message:
            `@gate ${node.id} 的 route 出口 ${unknown.join('、')} 不在服务端声明的出口里` +
            `（${declared.join(' / ')}）：这是一条永远不会走到的分支`,
        });
      }
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

  // 8b. 一个没有角色的 @review 是**不完整的流程定义**：任务建出来了，但没人有资格批。
  // 角色只有一个来源 —— 注册表的 eligibleRoles；SKILL.md 的 `role:` 是它的子集。
  // 只有在调用方提供了 reviewPolicy 时才判定 —— 否则"没登记"和"没告诉我校验器"分不清。
  if (opts.registry?.reviewPolicy) {
    for (const node of Object.values(nodes)) {
      if (node.type !== 'review') continue;
      const base = opts.registry.reviewPolicy(node.id);
      if (!base) continue; // 未注册由 registry-missing-review 报
      if (!base.eligibleRoles.length) {
        issues.push({
          code: 'review-missing-role',
          line: node.headingLine,
          nodeId: node.id,
          message:
            `@review ${node.id} 没有审核角色：在服务端 registry 登记该 review 的 eligibleRoles` +
            '（SKILL.md 的 role: 只能收窄它，不能成为角色来源）',
        });
        continue;
      }
      checkNarrowing({ node, base, issues });
    }
  }

  // 8c. `@agent tools:` 只能比服务端上限更严。
  // 上限默认不含 mcp/shell —— 那两样正是绕开 @action 审批直接产生业务副作用的路径。
  const ceiling = opts.agentTools;
  if (ceiling) {
    for (const node of Object.values(nodes)) {
      if (node.type !== 'agent' || !node.attrs.tools) continue;
      const outside = node.attrs.tools.filter((t) => !ceiling.includes(t));
      if (outside.length) {
        issues.push({
          code: 'agent-tools-widens',
          line: node.headingLine,
          nodeId: node.id,
          message:
            `@agent ${node.id} 的 tools: ${outside.join('、')} 超出服务端允许的 ` +
            `${ceiling.join(' / ') || '(空)'} —— 能力边界只能收窄。` +
            '要放开请改服务端配置（COPILOT_WORKFLOW_AGENT_TOOLS），不要改 SKILL.md',
        });
      }
    }
  }

  // 8d. 完成契约：开启 requireAgentOutput 时，每个 @agent 都必须声明。
  // 不做成默认，是因为它会让已有的 SKILL.md 全部校验不过；但生产环境应当开启 ——
  // 没有契约时 `@agent success` 只等于"turn 没抛异常"，模型回一句"我无法完成"也是 success。
  if (opts.requireAgentOutput) {
    for (const node of Object.values(nodes)) {
      if (node.type !== 'agent' || node.attrs.output) continue;
      issues.push({
        code: 'agent-output-missing',
        line: node.headingLine,
        nodeId: node.id,
        message:
          `@agent ${node.id} 没有声明完成契约（写法：output: <契约 id>，写在正文最前面）。` +
          '当前部署要求每个 agent 步骤都有服务端可判定的完成条件',
      });
    }
  }

  if (issues.length) return { issues };
  return { definition: { id: flowBlock.id, start, nodes }, issues };
}

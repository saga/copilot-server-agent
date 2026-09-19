import type { FlowAst, FlowAstAttr, FlowAstNode, FlowAstRoute } from './flow-ast.js';
import { BUSINESS_ROLE_ID } from '../identity/business-roles.js';
import {
  FLOW_CONTRACT_ID,
  NODE_OUTCOMES,
  WORKFLOW_AGENT_ALLOWED_KINDS,
  hasBlockingIssue,
  isFlowPermissionKind,
  requiredVotes,
  type FlowDefinition,
  type FlowIssue,
  type FlowNode,
  type FlowNodeAttrs,
  type FlowPermissionKind,
  type ReviewBasePolicy,
} from '../workflow/types.js';

/**
 * Flow **语义校验**：`FlowAst` → `FlowDefinition`。
 *
 * 输入是"作者写了什么"，输出是"系统确认这是什么、允许执行什么"。中间这一步是
 * 整条流水线里唯一做**授权判断**的地方，所以它也是唯一需要注册表的层。
 *
 * 只做 13 件事：
 *   1. 恰好一个 @flow（v1 一个技能一条流程）
 *   2. @flow 声明了 start，且 start 不重复
 *   3. 节点 id 唯一
 *   4. 所有 route target 都存在
 *   5. @end / @stop 不允许再 route
 *   6. 非终态节点必须至少有一条 route
 *   7. **同一个出口不能有两条 route** —— 否则 runner 取第一条，后面那条静默失效
 *   8. **保留属性合法**（role/strategy/required/exclude/output/tools），且 @review 必须能拿到业务角色
 *   9. **允许环** —— research → review → research 是研究流程的常态，用可达性而不是 DAG 判定
 *  10. **属性只能比服务端更严**：`role` 必须落在注册表的 eligibleRoles 里，
 *      `strategy` 只能 ANY→ALL，`required` 只能加不能减，`exclude` 不能把禁止自批改成允许
 *      （否则一份可编辑的 Markdown 就能把"要 3 个人批"降成"1 个人批"）
 *  11. **`strategy: ALL` 必须真的全员**：生效票数 < 生效角色数 → `review-all-required`
 *      （`ALL + required: 1` 只是名字叫 ALL 的 ANY，审计链上却写着 ALL）
 *  12. **@gate 的出口与注册表声明一致**：声明的出口必须有 route，route 的出口必须被声明
 *  13. **@agent 的完成契约与能力边界**：`output:` 必须已注册；`tools:` 里
 *      `mcp` / `shell` 永久禁止（`agent-tools-forbidden`），其余只能比服务端上限更严
 *
 * **刻意不做**图的分析（可达性、能否到达终态）：那属于 `flow-analyzer.ts`，
 * 输入是校验完的 `FlowDefinition`。这一层只回答"每条边、每个属性合不合法"，
 * 不回答"这张图长什么样" —— 两件事的变化原因不同（前者跟着授权模型走，
 * 后者跟着业务建模需求走），混在一起会让每条新检查都要重新理解整张图。
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
  /** 在没有任何 **error** 时给出（warning 不阻断，随 issues 一起交回） */
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
  block: FlowAstNode;
  nodeId: string;
  hasRole?: (id: string) => boolean;
  hasOutput?: (id: string) => boolean;
  issues: FlowIssue[];
}): FlowNodeAttrs {
  const { block, nodeId, hasRole, hasOutput, issues } = input;
  const attrs: FlowNodeAttrs = {};
  const nodeIdField = nodeId ? { nodeId } : {};

  const bad = (attr: FlowAstAttr, detail: string): void => {
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
 *
 * 报错指到**重复的那一条** route 自己的行，而不是节点标题行 —— 一个 20 行的节点里
 * 让你自己找哪两行冲突，等于没报。
 */
function checkDuplicateOutcomes(
  routes: readonly FlowAstRoute[],
  issues: FlowIssue[],
  where: { nodeId?: string; label: string },
): void {
  const seen = new Map<string, FlowAstRoute>();
  for (const route of routes) {
    const previous = seen.get(route.outcome);
    if (previous) {
      issues.push({
        code: 'route-outcome-duplicate',
        line: route.line,
        ...(where.nodeId ? { nodeId: where.nodeId } : {}),
        message:
          `${where.label} 的出口 "${route.outcome}" 重复：` +
          `第 ${previous.line} 行的 -> ${previous.target} 与这一行的 -> ${route.target} ` +
          '不能同时存在（只会走第一条）',
      });
      continue;
    }
    seen.set(route.outcome, route);
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
 *
 * 还有一条不是"放宽 vs 收窄"、而是"名不副实"的检查：**`strategy: ALL` 必须真的全员**。
 * ANY 与 ALL 的唯一区别落在票数上，所以 `ALL + required: 1`（3 个资格角色）
 * 实际仍然只需要 1 票 —— 它只是名字叫 ALL 的 ANY。这种写法比写错更危险：
 * 审批链上写着 ALL，没人会再去核对票数。
 *
 * 判定用的是**生效值**（属性收窄之后），而不是 SKILL.md 的字面值：
 * `role: risk` 把 3 个角色收窄成 1 个之后，`ALL + required: 1` 就是合法的全员通过。
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

  // 生效策略：四个属性全部按"只能更严"折算之后的结果（与 runner.reviewPolicyFor 一致）
  const strategy = base.strategy === 'ALL' ? 'ALL' : (attrs.strategy ?? 'ANY');
  const roles = attrs.role
    ? base.eligibleRoles.filter((r) => r === attrs.role)
    : base.eligibleRoles;
  const required =
    attrs.required !== undefined ? Math.max(base.requiredCount, attrs.required) : base.requiredCount;

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

  // ALL 的语义校验：票数必须覆盖全部**生效**角色，否则 ALL 只是一个名字。
  // 只有 role 合法时才有意义 —— role 越界时 roles 是空集，这里不再叠一条报错。
  if (roles.length) {
    const need = requiredVotes({ strategy, requiredCount: required, roleCount: roles.length });
    if (need > required) {
      issues.push({
        code: 'review-all-required',
        line: node.headingLine,
        nodeId: node.id,
        message:
          `${label} 的 strategy: ALL 要求全员通过，但生效票数是 ${required}，` +
          `而生效的资格角色有 ${roles.length} 个（${roles.join(' / ')}）—— ` +
          `实际仍然只需要 ${required} 票，ALL 被削弱成了 ANY。` +
          `要么写 required: ${roles.length}（或更多），要么把 strategy 改回 ANY`,
      });
    }
  }
}

export function validateSkillFlow(
  ast: FlowAst,
  opts: ValidateSkillFlowOptions = {},
): FlowValidationResult {
  const issues: FlowIssue[] = [...ast.issues];
  const flowBlocks = ast.flows;

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
      line: flowBlocks[1]!.line,
      message: `v1 只支持一个 @flow，发现 ${flowBlocks.length} 个（${flowBlocks.map((b) => b.id).join(', ')}）`,
    });
    return { issues };
  }
  const flowBlock = flowBlocks[0]!;

  if (opts.flow && flowBlock.id !== opts.flow.toLowerCase()) {
    issues.push({
      code: 'flow-name-mismatch',
      line: flowBlock.line,
      message: `SKILL.md 里的流程是 "${flowBlock.id}"，但请求的是 "${opts.flow}"`,
    });
  }

  // 2. start
  const start = flowBlock.start;
  if (!start) {
    // @flow 缺 start 时 parser 已经报过一条
    if (!issues.some((i) => i.code === 'flow-missing-start')) {
      issues.push({ code: 'flow-missing-start', line: flowBlock.line, message: '@flow 没有声明入口（start -> <节点 id>）' });
    }
    return { issues };
  }

  const nodeBlocks = ast.nodes;

  // 2b. `start` 也只能有一条：`start -> a` 与 `start -> b` 同时存在时 runner 取第一条，
  // 第二条静默失效 —— 金融流程不该有这种"看书写顺序决定走向"的不确定性。
  checkDuplicateOutcomes(flowBlock.routes, issues, {
    nodeId: flowBlock.id,
    label: `@flow ${flowBlock.id}`,
  });

  // 3. 节点 id 唯一
  const nodes: Record<string, FlowNode> = {};
  /** 归一化后的节点 → 它在 AST 里的原样（重复出口要指到 route 自己的行，只有 AST 有行号） */
  const astNodes: Record<string, FlowAstNode> = {};
  for (const block of nodeBlocks) {
    if (!block.id) continue; // parser 已报 block-missing-id
    if (nodes[block.id]) {
      issues.push({
        code: 'node-duplicate',
        line: block.line,
        nodeId: block.id,
        message: `节点 id 重复："${block.id}"（已出现在第 ${nodes[block.id]!.headingLine} 行）`,
      });
      continue;
    }
    astNodes[block.id] = block;
    nodes[block.id] = {
      id: block.id,
      type: block.type,
      body: block.body,
      attrs: buildAttrs({
        block,
        nodeId: block.id,
        ...(opts.hasRole ? { hasRole: opts.hasRole } : {}),
        ...(opts.registry?.hasOutput ? { hasOutput: opts.registry.hasOutput } : {}),
        issues,
      }),
      // AST 用作者视角的 outcome/target，可执行模型用紧凑的 on/to；这一次映射是两层的接缝
      routes: block.routes.map((r) => ({ on: r.outcome, to: r.target })),
      startLine: block.startLine,
      headingLine: block.line,
      endLine: block.endLine,
    };
  }

  // 4/5/6/7. 路由合法性
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
    checkDuplicateOutcomes(astNodes[node.id]!.routes, issues, {
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

  // 7. 可达性与"能不能到达终态"**不在这里** —— 那是 flow-analyzer.ts 的活。
  // 这一层只保证"每条边都指向存在的节点"，图长什么样由分析器看。
  // 唯一的例外是 start 本身解析不了：那时没有任何入口，图无从谈起。
  if (!nodes[start]) {
    issues.push({
      code: 'start-missing-node',
      line: flowBlock.line,
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

  // 8c. `@agent tools:`：**硬禁止** + 部署上限。
  //
  // 硬禁止（mcp / shell）与部署配置无关，所以**无条件**检查 —— 它们是 agent 绕开
  // `@action` 审批、直接对外产生业务副作用的两条路（调 MCP server 发报告、
  // 用 shell curl 内部接口）。SKILL.md 写 `tools: mcp` 就是在要求放宽授权模型，
  // 必须在校验期拦住，而不是"等它落进上限判定、看起来像个配置问题"。
  //
  // 上限（opts.agentTools）是部署侧的（COPILOT_WORKFLOW_AGENT_TOOLS），只在提供时检查。
  for (const node of Object.values(nodes)) {
    if (node.type !== 'agent' || !node.attrs.tools) continue;

    const forbidden = node.attrs.tools.filter(
      (t) => !WORKFLOW_AGENT_ALLOWED_KINDS.includes(t),
    );
    if (forbidden.length) {
      issues.push({
        code: 'agent-tools-forbidden',
        line: node.headingLine,
        nodeId: node.id,
        message:
          `@agent ${node.id} 的 tools: ${forbidden.join('、')} 是**永久禁止**的权限类别。` +
          'MCP server 与 shell 都是"绕过流程审批直接对外产生副作用"的路径，' +
          '业务动作只能走流程里声明的 @action 节点（策略 → 审批 → hash/版本复核 → executor）。' +
          `这不是配置项：改 COPILOT_WORKFLOW_AGENT_TOOLS 也不会生效（可用：${WORKFLOW_AGENT_ALLOWED_KINDS.join(' / ')}）`,
      });
      continue;
    }

    const ceiling = opts.agentTools;
    if (!ceiling) continue;
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

  // 8d. 完成契约：开启 requireAgentOutput 时，每个 @agent 都必须声明。
  // 生产 wiring 默认就是开的（config.workflowRequireAgentOutput 默认 true）——
  // 没有契约时 `@agent success` 只等于"turn 没抛异常"，模型回一句"我无法完成"也是 success。
  // 这个开关留给"存量 SKILL.md 还没补契约"的迁移期。
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

  // 只有 **error** 阻断：warning 是"流程能跑，但你该看一眼"。
  // 定义照常产出，warning 随 issues 一起交回调用方（lint 打印，运行时忽略）。
  if (hasBlockingIssue(issues)) return { issues };
  return { definition: { id: flowBlock.id, start, nodes }, issues };
}

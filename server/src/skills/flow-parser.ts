import type { Root, RootContent } from 'mdast';
import { toString } from 'mdast-util-to-string';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';
import type {
  FlowAst,
  FlowAstAttr,
  FlowAstFlow,
  FlowAstNode,
  FlowAstRoute,
} from './flow-ast.js';
import {
  ALL_ATTR_NAMES,
  NODE_ATTRS,
  type FlowBlockType,
  type FlowIssue,
  type FlowNodeType,
} from '../workflow/types.js';

/**
 * Skill Flow 的**语法层**：`SKILL.md` → `FlowAst`。
 *
 * 职责边界（这一层只回答"作者写了什么"）：
 *
 *   ✅ 认出 `## @<type> <id>` 块、切出正文、切出保留属性、提取路由
 *   ✅ 词法层面的报错：块类型不认识、缺 id、标题层级不对、属性名不认识/重复
 *   ❌ 不做任何语义判断：角色有没有登记、gate 有没有注册、route 指向的节点存不存在、
 *      流程能不能走到 @end —— 那些全部属于 `flow-validator.ts` / `flow-analyzer.ts`
 *
 * 为什么这个边界值得守：一旦 parser 开始"顺手"做语义判断，`FlowAst` 就不再是
 * "作者写了什么"的忠实记录，而变成"作者写的、且服务端认可的部分"。那时
 * "你写的第 12 行不合法"这种报错就无从生成 —— 因为那一行已经被丢掉了。
 *
 * 只认 `## @<type> <id>` 的**二级**标题（`## @gate compliance`）：
 * - `#` / `###` 不会被当成 flow block（同时会报一条 issue，避免"写了却没生效"）
 * - 普通 Markdown section（`## Flow`）不会与它冲突，因为 `@` 是机器保留前缀
 *
 * 这样 SKILL.md 读起来仍然是一篇业务流程说明，而不是程序代码；GitHub 上也就是普通标题。
 *
 * 用 remark 解析而不是正则扫全文，是为了避开代码块/引用块里的伪路由：
 * 路由只从段落与列表项里取，` ``` ` 里的 `- pass -> x` 不算。
 *
 * 另外解析正文最前面的**保留属性**（`role: compliance.reviewer`）：只有 `@review` /
 * `@action` / `@agent` 支持，且必须写在正文最前面。属性区会被从正文里剥掉，所以它
 * 不会混进描述或 prompt；值的合法性由 flow-validator 判定。
 */

/** `## @agent research` / `## @flow investment-review` */
const FLOW_HEADING = /^@(flow|agent|subagent|gate|review|action|stop|end)(?:\s+(.+))?$/i;

/**
 * `@subagent` 是 v1 的旧名，等价于 `@agent`。
 *
 * 它启动的是**当前 session 的一次 agent turn**（`runExecutionTurn`），不是另起一个
 * 独立 agent / 独立 skill —— 名字必须说清这一点，否则会被读成真正的 subagent 委派。
 * 旧名保留为别名：已经写好的 SKILL.md 不该因为一次改名就整片校验失败。
 */
const BLOCK_ALIASES: Record<string, FlowBlockType> = { subagent: 'agent' };

/**
 * 路由：`- pass -> review`，也接受不带列表符号的 `start -> research`。
 * 刻意不支持 if (…) / ${…} / && / ||：表达式语言不在 v1 范围内。
 */
const ROUTE = /^\s*[-*]?\s*([A-Za-z0-9._-]+)\s*->\s*([A-Za-z0-9._-]+)\s*$/;

/**
 * 保留属性行：`role: compliance.reviewer`
 *
 * 只认**正文最前面连续的一段**这样的行。属性区一旦被后面的普通段落打断就结束 ——
 * 这样正文里出现的 `Note: ...` 不会被当成属性（见 `splitAttrs`）。
 */
const ATTR_LINE = /^\s*([A-Za-z][A-Za-z0-9._-]*)\s*:\s*(\S.*?)\s*$/;

/** 去掉 YAML frontmatter，但保留行号（用等量空行占位） */
function stripFrontmatter(markdown: string): string {
  const match = markdown.match(/^---[ \t]*\n[\s\S]*?\n---[ \t]*\n/);
  if (!match) return markdown;
  return '\n'.repeat(match[0].split('\n').length - 1) + markdown.slice(match[0].length);
}

/**
 * 段落/列表项里的文本候选（带偏移与首行行号）。
 *
 * 偏移用于按块归属；行号用于给 route 标出自己在 SKILL.md 的哪一行。
 */
interface TextCandidate {
  offset: number;
  text: string;
  /** 该候选文本首行在 SKILL.md 里的行号（1-based） */
  line: number;
}

/** 节点 id 与出口名统一小写：避免 `pass -> Compliance-Review` 这种大小写不一致的静默失配 */
const norm = (s: string): string => s.toLowerCase();

/**
 * 切出正文开头的**保留属性区**。
 *
 * 三条规则，全是为了"不误伤正文"：
 *
 *   1. 只认最前面**连续**的 `name: value` 行 —— 遇到别的行（包括空行）就结束。
 *      所以正文里的 `Note: ...` 不会被当成属性。
 *   2. 名字是该节点类型支持的属性 → 认领。
 *   3. 名字是**别的**节点类型的属性（`@agent` 上写 `role:`）→ 一定报错：这类写法
 *      作者的本意很明确，静默当正文/prompt 才是最坏的结果。
 *      名字完全没见过（`Note:`）→ 只有在这段确实已认领到属性时才报错，
 *      否则整段当普通正文。
 *
 * 值的合法性（`strategy` 只能是 ANY/ALL 等）不在这里 —— 词法归 parser，语义归校验器。
 */
function splitAttrs(input: {
  bodyLines: string[];
  startLine: number;
  type: FlowBlockType;
  nodeId: string;
  issues: FlowIssue[];
}): { attrs: FlowAstAttr[]; bodyLines: string[] } {
  const { bodyLines, startLine, type, nodeId, issues } = input;
  const known = NODE_ATTRS[type as FlowNodeType] ?? [];
  const label = `@${type}${nodeId ? ` ${nodeId}` : ''}`;

  const zone: Array<{ name: string; value: string; line: number }> = [];
  for (const [i, text] of bodyLines.entries()) {
    const m = text.match(ATTR_LINE);
    if (!m) break;
    zone.push({ name: m[1]!.toLowerCase(), value: m[2]!, line: startLine + i });
  }

  const intendsAttrs =
    zone.some((a) => known.includes(a.name)) || zone.some((a) => ALL_ATTR_NAMES.includes(a.name));
  if (!intendsAttrs) return { attrs: [], bodyLines };

  const attrs: FlowAstAttr[] = [];
  const seen = new Set<string>();
  for (const a of zone) {
    const nodeIdField = nodeId ? { nodeId } : {};
    if (!known.includes(a.name)) {
      const recognized = ALL_ATTR_NAMES.includes(a.name);
      issues.push({
        code: recognized ? 'block-attr-unsupported' : 'block-attr-unknown',
        line: a.line,
        ...nodeIdField,
        message: recognized
          ? `${label} 不支持属性 "${a.name}"（${type} 支持：${known.join(' / ') || '(无)'}；属性必须写在正文最前面）`
          : `${label} 里不认识的属性 "${a.name}"（可用：${known.join(' / ') || '(无)'}）`,
      });
      continue;
    }
    if (seen.has(a.name)) {
      issues.push({
        code: 'block-attr-duplicate',
        line: a.line,
        ...nodeIdField,
        message: `${label} 的属性 "${a.name}" 重复声明（保留属性只能出现一次）`,
      });
      continue;
    }
    seen.add(a.name);
    attrs.push(a);
  }
  return { attrs, bodyLines: bodyLines.slice(zone.length) };
}

/**
 * 解析 SKILL.md，产出 `FlowAst`。
 *
 * 结构性问题（缺 @flow、路由指向不存在的节点、流程走不到终点等）由
 * `flow-validator.ts` / `flow-analyzer.ts` 判定，这里只做词法解析。
 */
export function parseSkillFlow(markdown: string): FlowAst {
  const source = stripFrontmatter(markdown);
  const lines = source.split('\n');
  const tree = unified().use(remarkParse).parse(source) as Root;

  // 一次遍历收集所有可用于路由的文本；之后按块的偏移区间归属。
  // 段落与列表项之外的节点（code / html / blockquote 内的 code）天然被排除。
  const candidates: TextCandidate[] = [];
  visit(tree, (node) => {
    if (node.type !== 'paragraph' && node.type !== 'listItem') return;
    const offset = node.position?.start.offset;
    if (offset === undefined) return;
    candidates.push({ offset, text: toString(node), line: node.position?.start.line ?? 1 });
  });

  const issues: FlowIssue[] = [];
  const nodes: FlowAstNode[] = [];
  const flows: FlowAstFlow[] = [];
  const children = tree.children;

  for (let i = 0; i < children.length; i++) {
    const node = children[i]!;
    if (node.type !== 'heading') continue;
    const headingText = toString(node).trim();
    const match = headingText.match(FLOW_HEADING);
    if (!match) {
      // `@` 是机器保留前缀：写了 `## @gates x` 这类拼错的块必须报出来，
      // 否则它只是一段普通文字 —— 流程里少了一个节点却没人知道。
      const line = node.position?.start.line ?? 1;
      if (headingText.startsWith('@')) {
        issues.push({
          code: 'block-unknown-type',
          line,
          message: `未知的 flow block 类型：「${headingText}」（可用：@flow / @agent / @gate / @review / @action / @stop / @end；@subagent 是 @agent 的旧名）`,
        });
      }
      continue;
    }

    const headingLine = node.position?.start.line ?? 1;
    if (node.depth !== 2) {
      issues.push({
        code: 'block-depth',
        line: headingLine,
        message: `flow block 必须是二级标题：「${headingText}」用了 ${'#'.repeat(node.depth)}（应为 ##）`,
      });
      continue;
    }

    const type = (BLOCK_ALIASES[match[1]!.toLowerCase()] ??
      match[1]!.toLowerCase()) as FlowBlockType;
    const id = (match[2] ?? '').trim();

    // 正文 = 本标题之后、下一个同级（或更高级）标题之前的全部节点
    const body: RootContent[] = [];
    for (let j = i + 1; j < children.length; j++) {
      const next = children[j]!;
      if (next.type === 'heading' && (next.depth ?? 9) <= 2) break;
      body.push(next);
    }

    const startLine = body.length ? (body[0]!.position?.start.line ?? headingLine + 1) : headingLine;
    const endLine = body.length
      ? (body[body.length - 1]!.position?.end.line ?? headingLine)
      : headingLine;
    // 保留属性区在正文最前面，先切掉再谈"正文"：否则 `role: x` 会被当成描述/prompt
    const { attrs, bodyLines } = splitAttrs({
      bodyLines: body.length ? lines.slice(startLine - 1, endLine) : [],
      startLine,
      type,
      nodeId: norm(id),
      issues,
    });
    const bodyMarkdown = bodyLines.join('\n');

    const bodyStartOffset = node.position?.end.offset ?? 0;
    const bodyEndOffset = body.length
      ? (body[body.length - 1]!.position?.end.offset ?? bodyStartOffset)
      : bodyStartOffset;

    // 路由：本块偏移区间内的段落/列表项文本。
    // 行号 = 候选文本首行 + 文本内的第几行 —— 段落与列表项的 `toString()` 按源文件
    // 的软换行保留 `\n`，所以这个映射对"一行一条 route"的常见写法是精确的。
    const routes: FlowAstRoute[] = [];
    const seen = new Set<string>();
    for (const candidate of candidates) {
      if (candidate.offset < bodyStartOffset || candidate.offset >= bodyEndOffset) continue;
      for (const [index, lineText] of candidate.text.split('\n').entries()) {
        const rm = lineText.match(ROUTE);
        if (!rm) continue;
        const outcome = norm(rm[1]!);
        const target = norm(rm[2]!);
        const key = `${outcome}->${target}`;
        if (seen.has(key)) continue;
        seen.add(key);
        routes.push({ outcome, target, line: candidate.line + index });
      }
    }

    if (!id) {
      issues.push({
        code: 'block-missing-id',
        line: headingLine,
        message: `flow block 缺少 id：「${headingText}」（写法：## @${type} <id>）`,
      });
    }

    if (type === 'flow') {
      const start = routes.find((r) => r.outcome === 'start')?.target;
      const flow: FlowAstFlow = { id: norm(id), line: headingLine, routes };
      if (start) flow.start = start;
      else if (id) {
        issues.push({
          code: 'flow-missing-start',
          line: headingLine,
          message: `@flow ${norm(id)} 没有声明入口（写法：start -> <节点 id>）`,
        });
      }
      flows.push(flow);
      continue;
    }

    nodes.push({
      type: type as FlowNodeType,
      id: norm(id),
      body: bodyMarkdown,
      line: headingLine,
      startLine,
      endLine,
      attrs,
      routes,
    });
  }

  return { flows, nodes, issues };
}

import type { Root, RootContent } from 'mdast';
import { toString } from 'mdast-util-to-string';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';
import type { FlowBlockType, FlowIssue, FlowRoute } from '../workflow/types.js';

/**
 * Skill Flow 的解析器：`SKILL.md` → Flow blocks。
 *
 * 只认 `## @<type> <id>` 的**二级**标题（`## @gate compliance`）：
 * - `#` / `###` 不会被当成 flow block（同时会报一条 issue，避免"写了却没生效"）
 * - 普通 Markdown section（`## Flow`）不会与它冲突，因为 `@` 是机器保留前缀
 *
 * 这样 SKILL.md 读起来仍然是一篇业务流程说明，而不是程序代码；GitHub 上也就是普通标题。
 *
 * 用 remark 解析而不是正则扫全文，是为了避开代码块/引用块里的伪路由：
 * 路由只从段落与列表项里取，` ``` ` 里的 `- pass -> x` 不算。
 */

/** `## @gate compliance` / `## @flow investment-review` */
const FLOW_HEADING = /^@(flow|subagent|gate|review|action|stop|end)(?:\s+(.+))?$/i;

/**
 * 路由：`- pass -> review`，也接受不带列表符号的 `start -> research`。
 * 刻意不支持 if (…) / ${…} / && / ||：表达式语言不在 v1 范围内。
 */
const ROUTE = /^\s*[-*]?\s*([A-Za-z0-9._-]+)\s*->\s*([A-Za-z0-9._-]+)\s*$/;

/** 去掉 YAML frontmatter，但保留行号（用等量空行占位） */
function stripFrontmatter(markdown: string): string {
  const match = markdown.match(/^---[ \t]*\n[\s\S]*?\n---[ \t]*\n/);
  if (!match) return markdown;
  return '\n'.repeat(match[0].split('\n').length - 1) + markdown.slice(match[0].length);
}

export interface ParsedFlowBlock {
  type: FlowBlockType;
  id: string;
  /** 节点正文（原样 Markdown） */
  markdown: string;
  /** `## @xxx` 所在行（1-based）—— 报错时指向这一行，作者一眼能定位 */
  headingLine: number;
  /** 正文内容的首行 / 末行（1-based）；正文为空时都等于 headingLine */
  startLine: number;
  endLine: number;
  routes: FlowRoute[];
  /** 仅 `@flow`：`start -> research` 的目标 */
  start?: string;
}

export interface ParsedSkillFlow {
  blocks: ParsedFlowBlock[];
  /** 解析期问题（未知块类型、缺 id、标题层级不对等） */
  issues: FlowIssue[];
}

/** 段落/列表项里的文本候选（带偏移，用于按块归属） */
interface TextCandidate {
  offset: number;
  text: string;
}

/** 节点 id 与出口名统一小写：避免 `pass -> Compliance-Review` 这种大小写不一致的静默失配 */
const norm = (s: string): string => s.toLowerCase();

/**
 * 解析 SKILL.md 里的全部 flow blocks。
 * 结构性问题（缺 @flow、路由指向不存在的节点等）由 flow-validator 判定，这里只做词法解析。
 */
export function parseSkillFlow(markdown: string): ParsedSkillFlow {
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
    candidates.push({ offset, text: toString(node) });
  });

  const issues: FlowIssue[] = [];
  const blocks: ParsedFlowBlock[] = [];
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
          message: `未知的 flow block 类型：「${headingText}」（可用：@flow / @subagent / @gate / @review / @action / @stop / @end）`,
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

    const type = match[1]!.toLowerCase() as FlowBlockType;
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
    const bodyMarkdown = body.length ? lines.slice(startLine - 1, endLine).join('\n') : '';

    const bodyStartOffset = node.position?.end.offset ?? 0;
    const bodyEndOffset = body.length
      ? (body[body.length - 1]!.position?.end.offset ?? bodyStartOffset)
      : bodyStartOffset;

    // 路由：本块偏移区间内的段落/列表项文本
    const routes: FlowRoute[] = [];
    const seen = new Set<string>();
    for (const candidate of candidates) {
      if (candidate.offset < bodyStartOffset || candidate.offset >= bodyEndOffset) continue;
      for (const lineText of candidate.text.split('\n')) {
        const rm = lineText.match(ROUTE);
        if (!rm) continue;
        const on = norm(rm[1]!);
        const to = norm(rm[2]!);
        const key = `${on}->${to}`;
        if (seen.has(key)) continue;
        seen.add(key);
        routes.push({ on, to });
      }
    }

    if (!id) {
      issues.push({
        code: 'block-missing-id',
        line: headingLine,
        message: `flow block 缺少 id：「${headingText}」（写法：## @${type} <id>）`,
      });
    }

    const block: ParsedFlowBlock = {
      type,
      id: norm(id),
      markdown: bodyMarkdown,
      headingLine,
      startLine,
      endLine,
      routes,
    };
    if (type === 'flow') {
      const start = routes.find((r) => r.on === 'start')?.to;
      if (start) block.start = start;
      else if (id) {
        issues.push({
          code: 'flow-missing-start',
          line: headingLine,
          message: `@flow ${id} 没有声明入口（写法：start -> <节点 id>）`,
        });
      }
    }
    blocks.push(block);
  }

  return { blocks, issues };
}

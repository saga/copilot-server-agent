import type { FlowIssue, FlowNodeType } from '../workflow/types.js';

/**
 * **Flow AST** —— `SKILL.md` 的语法结构。
 *
 * 它是流水线的第一个模型，回答的问题只有一个：
 *
 *   > 作者**写了**什么？
 *
 * 刻意不回答的问题（那些属于 `flow-validator.ts` 与 `flow-analyzer.ts`）：
 *
 *   - 这个 `role:` 在服务端登记过吗
 *   - 这个 `@gate` 注册了吗、它的出口词汇表是什么
 *   - 这条 route 指向的节点存在吗
 *   - 流程能不能走到 `@end`
 *
 * 所以 AST **允许携带不合法的内容**（`strategy: all`、拼错的属性名、指向不存在节点的
 * route）。这不是缺陷，是分层的前提：只有允许"先记下来"，校验器才可能给出
 * "你写的这一行不合法"这种带行号的报错。
 *
 * 三个模型的分工（不要合并、也不要再加一层）：
 *
 *   FlowAst           作者写了什么（本文件）
 *   FlowDefinition    系统确认这是什么、允许执行什么（workflow/types.ts）
 *   CFG               流程的逻辑形状 —— 只是 flow-analyzer.ts 里的局部变量，
 *                     不单独建模型（`Map<string, Set<string>>` 就够）
 */

/**
 * AST 里的一条保留属性（`role: compliance.reviewer`）。
 *
 * 值**一律是原样的字符串**，且带上自己的行号。
 *
 * 为什么不是 `{ role?: string; strategy?: 'ANY' | 'ALL'; required?: number }`
 * 这种"类型化的属性包"：
 *
 *   1. **报错要指到具体那一行**。`strategy` 不合法时用户要看的是
 *      `SKILL.md:12`，而不是 `SKILL.md:9`（标题行）—— 行号必须随属性走。
 *   2. **AST 表达不了"写了但不合法"**。`strategy: 'ANY' | 'ALL'` 这个类型没法表示
 *      `strategy: all` 或 `strategy: maybe`；硬塞进去只能靠强制转换，等于把
 *      "合法性"提前搬进语法层 —— 而那正是校验器存在的理由。
 *   3. **顺序是作者书写的顺序**，lint 输出可以保持原文次序。
 *
 * 值的合法性（ANY/ALL、正整数、已知权限类别）与"只能更严"的判定全部在
 * `flow-validator.ts`。
 */
export interface FlowAstAttr {
  /** 小写属性名（parser 归一化） */
  name: string;
  /** 原样值，未做任何语义解释 */
  value: string;
  /** 该属性行在 SKILL.md 里的行号（1-based） */
  line: number;
}

/** 属性区。有序数组，理由见 `FlowAstAttr` 的注释 */
export type FlowAstAttrs = FlowAstAttr[];

/**
 * 一条路由（`- success -> check`）。
 *
 * 字段名刻意与 `FlowRoute`（`on` / `to`）不同：这里是**作者视角**的
 * "出口 → 目标"，而 `FlowRoute` 是可执行模型里的紧凑形状。两边各自表达自己的
 * 阶段，中间由校验器做一次显式映射 —— 好过共用一个类型之后被两边各自拉扯。
 */
export interface FlowAstRoute {
  /** 出口名（parser 已归一化小写） */
  outcome: string;
  /** 目标节点 id（parser 已归一化小写） */
  target: string;
  /** 该 route 所在行（1-based）—— 重复出口、指向不存在节点时指到这一行 */
  line: number;
}

/** 一个 `## @agent work` 之类的节点块 */
export interface FlowAstNode {
  type: FlowNodeType;
  id: string;
  /** 正文（原样 Markdown，**已剥掉开头的保留属性行**） */
  body: string;
  /** `## @xxx` 标题所在行（1-based） */
  line: number;
  /** 正文首行 / 末行（1-based）；正文为空时都等于 `line` */
  startLine: number;
  endLine: number;
  /** 保留属性（大多数节点类型是空数组） */
  attrs: FlowAstAttrs;
  routes: FlowAstRoute[];
}

/**
 * `## @flow <id>` 块。
 *
 * 用 `FlowAst.flows`（数组）而不是单个 `flow`：作者可能**一个都没写**，也可能
 * **写了两个**，而这两种都必须在流水线里报得出来（`flow-missing` / `flow-duplicate`）。
 * 把 AST 的类型定成"必然恰好一个"，就等于让语法层替语义层做了决定，
 * 遇到 0 个或 2 个时只能丢信息或抛异常。
 */
export interface FlowAstFlow {
  id: string;
  /** `## @flow` 标题所在行（1-based） */
  line: number;
  /** `@flow` 自己的 route 行（`start -> work` 就是其中一条） */
  routes: FlowAstRoute[];
  /** 从 `start -> <节点>` 里取出的入口节点 id；没写则为 undefined */
  start?: string;
}

/**
 * 解析结果。**同时携带 AST 与解析期问题**：
 *
 * 词法层面的问题（未知块类型、缺 id、标题层级不对、属性名不认识/重复）在这一层就
 * 已经确定，没有必要为了"AST 必须干净"而把它们丢掉再让下游重新发现一遍。
 *
 * 注意区分两类问题：
 *   `issues`（这里）      词法/书写问题 —— "你写的这个东西我不认识"
 *   校验器的问题          语义问题   —— "我认识，但服务端不允许"
 */
export interface FlowAst {
  flows: FlowAstFlow[];
  nodes: FlowAstNode[];
  issues: FlowIssue[];
}

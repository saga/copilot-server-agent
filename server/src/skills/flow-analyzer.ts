import type { FlowDefinition, FlowIssue } from '../workflow/types.js';

/**
 * **控制流分析** —— 输入是 `FlowDefinition`（已校验、已归一化的可执行模型）。
 *
 * 为什么输入不是 Markdown、也不是 `FlowAst`：
 *
 *   - 分析 AST 等于把"route 指向不存在的节点"和"流程走不到终点"混成同一类问题，
 *     还得在分析器里重新回答"这个 target 存不存在"—— 那是校验器已经回答过的事；
 *   - 到 `FlowDefinition` 这一步，`node.target` 一定存在、`route` 一定合法、
 *     `@gate` 一定注册、属性一定归一化。分析器只需要看**图的形状**。
 *
 * 所以这里只有三件事：建图 → 正向可达 → 反向活跃。没有第二个 IR，也没有
 * `cfg.ts` / `control-flow-model.ts` 之类的中间模型 —— 一张邻接表就够：
 *
 *   Graph = Map<nodeId, Set<nodeId>>
 *
 * 这与"不要 over-design"是同一件事：一旦为图单独建模型，下一步就会有人想给它加
 * 节点属性、再加一层 lowering，而这里真正需要的只是"能不能走到"。
 *
 * ## 三条检查
 *
 *   node-unreachable   从 start 走不到这个节点（error）—— 它永远不会被执行
 *   no-terminal-path   从这个节点出发**无法到达任何终态**（error）—— 走进来就出不去
 *   no-success-path    整条流程没有任何 `@end`（warning）—— 它只可能以失败收尾
 *
 * 三条刻意互不重叠：
 *   - `node-unreachable` 只查正向可达，`no-terminal-path` 只查**可达**节点的活跃性
 *     （不可达的节点已经报过一次，再叠一条"走不出去"只是噪音）；
 *   - `no-success-path` 只查"有没有 `@end` 这个节点"，**不查到不到得了** ——
 *     后者与 `node-unreachable` 完全重叠（`@end` 到不了 ⇔ 它不可达），
 *     再报一条就是把同一个问题说两遍，还让人以为有两处要改。
 *
 * 第三条刻意是 warning 而不是 error：只以 `@stop` 收尾的流程是**合法形状**
 * （审批被拒就是终态，不需要成功出口）。但它通常不是作者的本意，所以提醒一句。
 *
 * ## 为什么"环"本身不报错
 *
 * `research → review → research` 是研究流程的常态（打回重做就是走环）。真正要拦的不是
 * 环，而是**没有出口的环** —— 而那恰好被 `no-terminal-path` 覆盖：环内任何节点都
 * 到不了终态时，它们全体报错。用"活跃性"表达比"找环"更准，也少一个概念。
 */
export function analyzeFlow(definition: FlowDefinition): FlowIssue[] {
  const issues: FlowIssue[] = [];
  const nodes = definition.nodes;
  const ids = Object.keys(nodes);

  /** 邻接表：只保留指向**存在节点**的边（不存在由校验器的 route-target-missing 报） */
  const graph = new Map<string, Set<string>>();
  for (const id of ids) {
    const edges = new Set<string>();
    for (const route of nodes[id]!.routes) {
      if (nodes[route.to]) edges.add(route.to);
    }
    graph.set(id, edges);
  }

  // start 解析不了（指向不存在的节点）时校验器已经报过 start-missing-node，
  // 那时没有任何"入口"可言，分析无从谈起 —— 直接不报，避免叠一堆无意义的不可达。
  if (!nodes[definition.start]) return issues;

  const reachable = bfs([definition.start], graph);

  for (const id of ids) {
    if (reachable.has(id)) continue;
    const node = nodes[id]!;
    issues.push({
      code: 'node-unreachable',
      line: node.headingLine,
      nodeId: id,
      message: `@${node.type} ${id} 从 start "${definition.start}" 不可达（没有任何 route 指向它）`,
    });
  }

  // 反向图：能到达终态 ⇔ 从终态反向可达。一次 BFS 就够，不必对每个节点各搜一遍。
  const reverse = new Map<string, Set<string>>();
  for (const id of ids) reverse.set(id, new Set());
  for (const [from, edges] of graph) {
    for (const to of edges) reverse.get(to)!.add(from);
  }

  const terminals = ids.filter((id) => {
    const type = nodes[id]!.type;
    return type === 'stop' || type === 'end';
  });
  const live = bfs(terminals, reverse);

  for (const id of ids) {
    // 只查**可达**的节点：不可达的已经报过 node-unreachable，
    // 再叠一条"走不出去"只是噪音（而且它根本不会被执行）
    if (!reachable.has(id) || live.has(id)) continue;
    const node = nodes[id]!;
    issues.push({
      code: 'no-terminal-path',
      line: node.headingLine,
      nodeId: id,
      message:
        `@${node.type} ${id} 无法到达任何终态（@end / @stop）：` +
        '从它出发的每一条路径都只能在这个环里打转，流程永远收不了尾。' +
        '要么给它一条通向 @end / @stop 的 route，要么删掉这个节点',
    });
  }

  // 成功出口：**只查"有没有 @end"**，不查"到不到得了"。
  //
  // 后者与 node-unreachable 完全重叠：`@end` 到不了 ⇔ 那个 `@end` 不可达，
  // 上面已经报过 error 了。再报一条只是把同一个问题说两遍，还会让人以为有两处要改。
  const ends = ids.filter((id) => nodes[id]!.type === 'end');
  if (!ends.length) {
    const node = nodes[definition.start]!;
    issues.push({
      code: 'no-success-path',
      severity: 'warning',
      line: node.headingLine,
      nodeId: definition.start,
      message:
        '这条流程没有任何 @end（成功终态）：它只可能以 @stop 收尾。' +
        '如果这是有意的（"被拒即终态"之类）可以忽略；如果不是，多半是漏了一个 @end 节点',
    });
  }

  return issues;
}

/** 从一组起点出发的正向可达集（起点本身算可达） */
function bfs(starts: readonly string[], graph: ReadonlyMap<string, ReadonlySet<string>>): Set<string> {
  const seen = new Set<string>();
  const queue = [...starts];
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const next of graph.get(id) ?? []) queue.push(next);
  }
  return seen;
}

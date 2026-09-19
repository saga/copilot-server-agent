import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  WORKFLOW_AGENT_ALLOWED_KINDS,
  agentCapabilityFor,
  clearAgentCapability,
  clearAllAgentCapabilities,
  parseAgentTools,
  resolveAgentTools,
  setAgentCapability,
} from '../src/workflow/capability.js';
import { createPermissionHandler, type ToolPolicyContext } from '../src/services/tool-policy.js';

/**
 * `@agent` 的能力边界：**流程里声明的业务动作只能走 @action 审批，agent 不能自己干**。
 *
 * 这一层挡的不是"agent 会不会做错"，而是"agent 完全可以绕开流程"：
 * 它手上如果有 MCP 或 shell，就能直接把研究报告发出去、或者 curl 一个内部下单接口 ——
 * 那样前面所有节点、所有审批都成了摆设。
 *
 * 三件事都要证明：
 *   1. 上限与声明的交集算得对（只能更严，不能更宽）
 *   2. `mcp` / `shell` 是**硬禁止**：配置写成 mcp 也不生效（不是"默认值不含"）
 *   3. 权限回调真的按它拒绝，而且**只在"属于这条 execution 的节点执行期间"**生效
 */

const ceiling = ['read', 'write', 'url'] as const;
/** 全部类别（含被禁止的），用于验证"上限被误配成 mcp 也不生效" */
const withForbidden = ['read', 'write', 'url', 'mcp', 'shell'] as const;

const cap = (over: Partial<Parameters<typeof setAgentCapability>[1]> = {}) => ({
  executionId: 'e1',
  nodeId: 'research',
  flow: 'investment-review',
  kinds: new Set(['read', 'write', 'url'] as const),
  ...over,
});

/**
 * SDK 的权限回调签名是 `(request, invocation)`；单测只关心 request，
 * 这里把 invocation 补成一个固定值，免得每处调用都写一遍。
 */
function permissionHandler(ctx: ToolPolicyContext) {
  const handler = createPermissionHandler(ctx);
  return (request: unknown) => handler(request as never, { sessionId: ctx.sessionId });
}

const request = (kind: string, extra: Record<string, unknown> = {}) =>
  ({ kind, ...extra }) as unknown;

test('能力边界：上限 ∩ 声明 —— 只能收窄，不能凭空多出权限', () => {
  assert.deepEqual(resolveAgentTools(ceiling), ['read', 'write', 'url'], '不声明 = 上限原样');
  assert.deepEqual(resolveAgentTools(ceiling, ['read']), ['read']);
  assert.deepEqual(resolveAgentTools(ceiling, ['read', 'write']), ['read', 'write']);

  // 声明了上限之外的类别：交集里不会出现它（校验器会报 agent-tools-widens，这里再兜一次）
  assert.deepEqual(resolveAgentTools(ceiling, ['read', 'mcp']), ['read']);
  assert.deepEqual(resolveAgentTools(ceiling, ['mcp', 'shell']), [], '全都不在上限内 = 一个都不给');
});

test('能力边界：mcp / shell 是**硬禁止** —— 连上限本身放开了也不生效', () => {
  // 运维把上限显式配成含 mcp/shell（改错了配置 / 老部署的遗留值）
  assert.deepEqual(
    resolveAgentTools(withForbidden),
    ['read', 'write', 'url'],
    'mcp / shell 永远不出现在生效集合里',
  );
  assert.deepEqual(resolveAgentTools(withForbidden, ['read', 'mcp']), ['read']);
  assert.deepEqual(
    resolveAgentTools(['mcp'], []),
    [],
    '上限只有 mcp 时结果是空集（fail-closed），不是"退回默认"',
  );

  // 解析配置时同样过滤：写 mcp 只会被丢掉，不会变成"什么都能用"
  assert.deepEqual(parseAgentTools('mcp', ceiling), ['read', 'write', 'url'], '只剩 mcp = 退回默认');
  assert.deepEqual(parseAgentTools('mcp,shell', ceiling), ['read', 'write', 'url']);
  assert.deepEqual(parseAgentTools('read,mcp', ceiling), ['read'], '合法的那个照常生效');
  assert.deepEqual(
    parseAgentTools('mcp', withForbidden),
    ['read', 'write', 'url'],
    'fallback 自己带 mcp 时也要被硬上限过掉',
  );
  assert.deepEqual(
    WORKFLOW_AGENT_ALLOWED_KINDS,
    ['read', 'write', 'url'],
    '硬上限就是这三个，改动必须是一次代码评审',
  );
});

test('能力边界：配置解析 —— 认不出的类别直接丢掉，空配置退回默认', () => {
  assert.deepEqual(parseAgentTools('read,write', ceiling), ['read', 'write']);
  assert.deepEqual(parseAgentTools(' READ , url ', ceiling), ['read', 'url']);
  assert.deepEqual(parseAgentTools('read,teleport', ceiling), ['read'], '未知类别不生效');
  assert.deepEqual(parseAgentTools('', ceiling), [...ceiling], '空配置不能变成"什么都能用"');
  assert.deepEqual(parseAgentTools('teleport', ceiling), [...ceiling], '全都不认识时同样退回默认');
});

test('能力边界：只清自己设的那一份（executionId + nodeId 都要对得上）', () => {
  clearAllAgentCapabilities();
  setAgentCapability('s1', cap({ executionId: 'e1', nodeId: 'work-a' }));
  assert.equal(agentCapabilityFor('s1')?.nodeId, 'work-a');

  // 另一个节点覆盖了它：此时用旧 nodeId 去清，不能把新的那份清掉
  setAgentCapability('s1', cap({ executionId: 'e1', nodeId: 'work-b' }));
  clearAgentCapability('s1', { executionId: 'e1', nodeId: 'work-a' });
  assert.equal(agentCapabilityFor('s1')?.nodeId, 'work-b');

  // 同一个 nodeId、**另一条 execution**：也不能清 —— @agent 的 finally 在 turn 槽外面跑，
  // 槽一释放，同一会话里的下一条 execution 就可能已经设上自己的边界了
  setAgentCapability('s1', cap({ executionId: 'e2', nodeId: 'work-b' }));
  clearAgentCapability('s1', { executionId: 'e1', nodeId: 'work-b' });
  assert.equal(agentCapabilityFor('s1')?.executionId, 'e2', 'executionId 对不上时不能误删');

  clearAgentCapability('s1', { executionId: 'e2', nodeId: 'work-b' });
  assert.equal(agentCapabilityFor('s1'), undefined);
});

test('能力边界：权限回调真的拒绝 mcp / shell，且只在节点执行期间生效', async () => {
  clearAllAgentCapabilities();
  const ask = permissionHandler({
    sessionId: 's1',
    workspacePath: '/tmp/ws',
    // 这个 MCP server 本来是**已启用**的：拒绝只能来自能力边界，不能来自别的检查
    mcpServers: ['github'],
    capability: () => agentCapabilityFor('s1'),
  });

  // 没有 workflow 节点在跑 → 原有行为完全不变
  const mcpWithout = await ask(request('mcp', { serverName: 'github', toolName: 'issue' }));
  assert.equal(mcpWithout.kind, 'approve-once', '不在流程节点里时不受能力边界影响');

  setAgentCapability('s1', cap());

  const mcp = await ask(request('mcp', { serverName: 'github', toolName: 'issue' }));
  assert.equal(mcp.kind, 'denied-by-permission-request-hook');
  assert.match(
    String((mcp as { message?: string }).message),
    /流程节点 @agent research 没有 mcp 权限/,
    '拒绝理由要说清是流程节点的能力限制，而不是一个看起来无关的错',
  );
  assert.match(String((mcp as { message?: string }).message), /@action/, '要指出业务动作该走哪里');

  const shell = await ask(request('shell', { possiblePaths: ['/tmp/ws/a.sh'] }));
  assert.equal(shell.kind, 'denied-by-permission-request-hook', 'shell 默认也不给');

  // 允许的类别照常走原有判定（能力边界只收窄，不替代 workspace 守卫）
  assert.equal((await ask(request('read', { path: '/etc/hosts' }))).kind, 'approve-once');
  assert.equal((await ask(request('write', { resolvedPath: '/tmp/ws/report.md' }))).kind, 'approve-once');
  assert.equal(
    (await ask(request('write', { resolvedPath: '/etc/passwd' }))).kind,
    'denied-by-permission-request-hook',
    'workspace 守卫仍然生效（能力边界不替代它）',
  );

  // 节点跑完 → 边界清掉 → MCP 恢复原来的判定
  clearAgentCapability('s1', { executionId: 'e1', nodeId: 'research' });
  const mcpAfter = await ask(request('mcp', { serverName: 'github', toolName: 'issue' }));
  assert.equal(mcpAfter.kind, 'approve-once');
});

test('能力边界：声明的 tools 收窄后，未声明的类别立刻被拒', async () => {
  clearAllAgentCapabilities();
  const ask = permissionHandler({
    sessionId: 's2',
    workspacePath: '/tmp/ws',
    mcpServers: [],
    capability: () => agentCapabilityFor('s2'),
  });
  setAgentCapability('s2', cap({ executionId: 'e2', nodeId: 'work', kinds: new Set(['read'] as const) }));

  assert.equal((await ask(request('read', { path: '/x' }))).kind, 'approve-once');
  assert.equal(
    (await ask(request('url', { url: 'https://example.com' }))).kind,
    'denied-by-permission-request-hook',
    'tools: read 之后连出站请求都不给',
  );
});

/**
 * 边界是**会话级存放、execution 级生效**。
 *
 * 一条会话会先后（甚至排队）承载多条 execution：A 的 `@agent` 节点允许 `write`，
 * B 的节点只声明 `read`。只按 sessionId 取一份，B 就会拿到 `write` ——
 * 一次**跨 execution 的能力放宽**，而审计链上只会看到"B 用了 write 工具"。
 *
 * 对不上必须**拒绝**而不是"忽略这份边界、退回会话策略"：会话策略本来就允许 mcp /
 * shell，退回等于把它们重新交回 agent 手上 —— 那正是这一层要挡的东西。
 */
test('能力边界：边界不属于当前 execution 时拒绝（不串台、不静默放宽）', async () => {
  clearAllAgentCapabilities();
  let activeExecution: string | undefined = 'e1';
  const ask = permissionHandler({
    sessionId: 's3',
    workspacePath: '/tmp/ws',
    mcpServers: ['github'],
    capability: () => agentCapabilityFor('s3'),
    activeExecution: () => activeExecution,
  });

  setAgentCapability('s3', cap({ executionId: 'e1', nodeId: 'research' }));

  // 同一条 execution：边界照常生效
  assert.equal((await ask(request('read', { path: '/x' }))).kind, 'approve-once');
  assert.equal(
    (await ask(request('mcp', { serverName: 'github', toolName: 'issue' }))).kind,
    'denied-by-permission-request-hook',
  );

  // 换成了另一条 execution：边界不属于它，任何工具调用都被拒（fail-closed）
  activeExecution = 'e2';
  const foreign = await ask(request('read', { path: '/x' }));
  assert.equal(foreign.kind, 'denied-by-permission-request-hook');
  assert.match(
    String((foreign as { message?: string }).message),
    /不属于当前执行/,
    '拒绝理由要说清"边界与 execution 对不上"',
  );
  assert.equal(
    (await ask(request('mcp', { serverName: 'github', toolName: 'issue' }))).kind,
    'denied-by-permission-request-hook',
  );

  // 没有 execution 上下文（比如自定义 runtime 忘了设）同样是拒绝，不是"放行"
  activeExecution = undefined;
  assert.equal(
    (await ask(request('read', { path: '/x' }))).kind,
    'denied-by-permission-request-hook',
    '拿不到当前 execution 时不能按"没有边界"处理 —— 那会让边界静默失效',
  );

  // 不提供 activeExecution 回调时跳过对账（无 execution 上下文的场景）
  const noCheck = permissionHandler({
    sessionId: 's3',
    workspacePath: '/tmp/ws',
    mcpServers: [],
    capability: () => agentCapabilityFor('s3'),
  });
  assert.equal((await noCheck(request('read', { path: '/x' }))).kind, 'approve-once');
});

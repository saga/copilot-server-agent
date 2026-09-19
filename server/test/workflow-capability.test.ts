import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
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
 * 两个方向都要证明：
 *   1. 上限与声明的交集算得对（只能更严，不能更宽）
 *   2. 权限回调真的按它拒绝，而且**只在节点执行期间**生效
 */

const ceiling = ['read', 'write', 'url'] as const;

test('能力边界：上限 ∩ 声明 —— 只能收窄，不能凭空多出权限', () => {
  assert.deepEqual(resolveAgentTools(ceiling), ['read', 'write', 'url'], '不声明 = 上限原样');
  assert.deepEqual(resolveAgentTools(ceiling, ['read']), ['read']);
  assert.deepEqual(resolveAgentTools(ceiling, ['read', 'write']), ['read', 'write']);

  // 声明了上限之外的类别：交集里不会出现它（校验器会报 agent-tools-widens，这里再兜一次）
  assert.deepEqual(resolveAgentTools(ceiling, ['read', 'mcp']), ['read']);
  assert.deepEqual(resolveAgentTools(ceiling, ['mcp', 'shell']), [], '全都不在上限内 = 一个都不给');

  // 上限本身被放宽（运维显式配置）时，声明仍然能收窄
  assert.deepEqual(resolveAgentTools(['read', 'mcp'], ['read']), ['read']);
});

test('能力边界：配置解析 —— 认不出的类别直接丢掉，空配置退回默认', () => {
  assert.deepEqual(parseAgentTools('read,write', ceiling), ['read', 'write']);
  assert.deepEqual(parseAgentTools(' READ , url ', ceiling), ['read', 'url']);
  assert.deepEqual(parseAgentTools('read,teleport', ceiling), ['read'], '未知类别不生效');
  assert.deepEqual(parseAgentTools('', ceiling), [...ceiling], '空配置不能变成"什么都能用"');
  assert.deepEqual(parseAgentTools('teleport', ceiling), [...ceiling], '全都不认识时同样退回默认');
});

test('能力边界：只清自己设的那一份（嵌套 / 并发时不能误删别人的）', () => {
  clearAllAgentCapabilities();
  setAgentCapability('s1', { kinds: new Set(['read']), nodeId: 'work-a', flow: 'f' });
  assert.equal(agentCapabilityFor('s1')?.nodeId, 'work-a');

  // 另一个节点覆盖了它：此时用旧 nodeId 去清，不能把新的那份清掉
  setAgentCapability('s1', { kinds: new Set(['read', 'write']), nodeId: 'work-b', flow: 'f' });
  clearAgentCapability('s1', 'work-a');
  assert.equal(agentCapabilityFor('s1')?.nodeId, 'work-b');

  clearAgentCapability('s1', 'work-b');
  assert.equal(agentCapabilityFor('s1'), undefined);
});

test('能力边界：权限回调真的拒绝 mcp / shell，且只在节点执行期间生效', async () => {
  clearAllAgentCapabilities();
  const ctx: ToolPolicyContext = {
    sessionId: 's1',
    workspacePath: '/tmp/ws',
    // 这个 MCP server 本来是**已启用**的：拒绝只能来自能力边界，不能来自别的检查
    mcpServers: ['github'],
    capability: () => agentCapabilityFor('s1'),
  };
  const handler = createPermissionHandler(ctx);

  const request = (kind: string, extra: Record<string, unknown> = {}) =>
    ({ kind, ...extra }) as never;

  // 没有 workflow 节点在跑 → 原有行为完全不变
  const mcpWithout = await handler(request('mcp', { serverName: 'github', toolName: 'issue' }));
  assert.equal(mcpWithout.kind, 'approve-once', '不在流程节点里时不受能力边界影响');

  setAgentCapability('s1', {
    kinds: new Set(['read', 'write', 'url']),
    nodeId: 'research',
    flow: 'investment-review',
  });

  const mcp = await handler(request('mcp', { serverName: 'github', toolName: 'issue' }));
  assert.equal(mcp.kind, 'denied-by-permission-request-hook');
  assert.match(
    String((mcp as { message?: string }).message),
    /流程节点 @agent research 没有 mcp 权限/,
    '拒绝理由要说清是流程节点的能力限制，而不是一个看起来无关的错',
  );
  assert.match(String((mcp as { message?: string }).message), /@action/, '要指出业务动作该走哪里');

  const shell = await handler(request('shell', { possiblePaths: ['/tmp/ws/a.sh'] }));
  assert.equal(shell.kind, 'denied-by-permission-request-hook', 'shell 默认也不给');

  // 允许的类别照常走原有判定（能力边界只收窄，不替代 workspace 守卫）
  const read = await handler(request('read', { path: '/etc/hosts' }));
  assert.equal(read.kind, 'approve-once');
  const write = await handler(request('write', { resolvedPath: '/tmp/ws/report.md' }));
  assert.equal(write.kind, 'approve-once');
  const writeOutside = await handler(request('write', { resolvedPath: '/etc/passwd' }));
  assert.equal(
    writeOutside.kind,
    'denied-by-permission-request-hook',
    'workspace 守卫仍然生效（能力边界不替代它）',
  );

  // 节点跑完 → 边界清掉 → MCP 恢复原来的判定
  clearAgentCapability('s1', 'research');
  const mcpAfter = await handler(request('mcp', { serverName: 'github', toolName: 'issue' }));
  assert.equal(mcpAfter.kind, 'approve-once');
});

test('能力边界：声明的 tools 收窄后，未声明的类别立刻被拒', async () => {
  clearAllAgentCapabilities();
  const handler = createPermissionHandler({
    sessionId: 's2',
    workspacePath: '/tmp/ws',
    mcpServers: [],
    capability: () => agentCapabilityFor('s2'),
  });
  setAgentCapability('s2', { kinds: new Set(['read']), nodeId: 'work', flow: 'f' });

  assert.equal((await handler({ kind: 'read', path: '/x' } as never)).kind, 'approve-once');
  assert.equal(
    (await handler({ kind: 'url', url: 'https://example.com' } as never)).kind,
    'denied-by-permission-request-hook',
    'tools: read 之后连出站请求都不给',
  );
});

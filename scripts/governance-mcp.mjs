#!/usr/bin/env node
/**
 * Governance MCP bridge（stdio）。
 *
 * 目的：让 agent 只能「提议」高风险动作，执行权留在 server。
 * 这个 MCP server 只暴露一个工具 propose_action，实现是回调本服务的
 * POST /api/executions/:id/actions —— 服务端做策略裁决、建审批任务、最终执行。
 *
 * agent 侧可见：
 *   propose_action（提 intent，拿回 approved / pending_approval / denied）
 * server 侧独占：
 *   approve_action / execute_action（审批通过在服务端执行，不作为模型工具暴露）
 *
 * 用法（作为本地 MCP server 挂到会话）：
 *   COPILOT_MCP_SERVERS='{"governance":{"type":"local","command":"node","args":["scripts/governance-mcp.mjs"],"tools":["propose_action"]}}'
 * 环境变量：
 *   COPILOT_API_URL       默认 http://127.0.0.1:3001
 *   COPILOT_ADMIN_TOKEN   与服务端一致（用于管理接口）
 *   COPILOT_EXECUTION_ID  propose_action 未显式传 executionId 时的兜底
 */

const API_URL = process.env.COPILOT_API_URL ?? 'http://127.0.0.1:3001';
const ADMIN_TOKEN = process.env.COPILOT_ADMIN_TOKEN ?? '';
const DEFAULT_EXECUTION_ID = process.env.COPILOT_EXECUTION_ID ?? '';

const TOOLS = [
  {
    name: 'propose_action',
    description:
      '提出一个高风险业务动作意向（如下单、代理投票、对外发消息）。服务端按策略裁决：自动放行 / 需人工审批 / 拒绝。返回 taskId 表示已建审批任务。',
    inputSchema: {
      type: 'object',
      properties: {
        executionId: { type: 'string', description: '当前 execution id' },
        actionType: { type: 'string', description: 'submit_proxy_vote / submit_trade / ...' },
        target: {
          type: 'object',
          properties: { type: { type: 'string' }, id: { type: 'string' } },
          required: ['type', 'id'],
        },
        parameters: { type: 'object' },
        reason: { type: 'string' },
        resourceVersion: { type: 'string' },
      },
      required: ['actionType', 'target'],
    },
  },
];

function respond(res) {
  process.stdout.write(`${JSON.stringify(res)}\n`);
}

async function callApi(pathname, body) {
  const res = await fetch(`${API_URL}${pathname}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(ADMIN_TOKEN ? { 'x-admin-token': ADMIN_TOKEN } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text };
  }
  return { status: res.status, body: parsed };
}

async function proposeAction(args = {}) {
  const executionId = args.executionId ?? DEFAULT_EXECUTION_ID;
  if (!executionId) {
    return { error: '缺少 executionId（或设 COPILOT_EXECUTION_ID）' };
  }
  const { executionId: _drop, ...intent } = args;
  const { status, body } = await callApi(`/api/executions/${executionId}/actions`, intent);
  return { status, ...body };
}

let buffer = '';
process.stdin.setEncoding('utf-8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    void handle(line);
  }
});

async function handle(line) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return respond({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } });
  }
  const { id, method, params } = msg;
  switch (method) {
    case 'initialize':
      return respond({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'copilot-server-agent-governance', version: '1.0.0' },
        },
      });
    case 'notifications/initialized':
    case 'initialized':
      return undefined;
    case 'tools/list':
      return respond({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
    case 'tools/call': {
      const name = params?.name;
      if (name !== 'propose_action') {
        return respond({
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: `unknown tool: ${name}` }],
            isError: true,
          },
        });
      }
      try {
        const out = await proposeAction(params?.arguments ?? {});
        return respond({
          jsonrpc: '2.0',
          id,
          result: { content: [{ type: 'text', text: JSON.stringify(out) }] },
        });
      } catch (err) {
        return respond({
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: `propose_action 失败：${String(err)}` }],
            isError: true,
          },
        });
      }
    }
    default:
      return respond({
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `method not found: ${method}` },
      });
  }
}

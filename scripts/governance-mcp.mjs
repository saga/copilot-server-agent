#!/usr/bin/env node
/**
 * Governance MCP bridge（stdio）。
 *
 * 目的：让 agent 只能「提议」高风险命令，执行权留在 server。
 * 这个 MCP server 只暴露一个工具 propose_command，实现是回调本服务的
 * POST /api/executions/:id/commands —— 服务端做策略裁决、建审批任务、最终执行。
 *
 * agent 侧可见：
 *   propose_command（提 intent，拿回 approved / pending_approval / denied）
 * server 侧独占：
 *   approve_command / execute_command（审批通过在服务端执行，不作为模型工具暴露）
 *
 * 改名兼容：这个工具曾经叫 `propose_action`，入参字段叫 `actionType`。
 * 工具名是**部署契约**（写在 COPILOT_MCP_SERVERS 的 `tools` 里），改了名不会自动生效 ——
 * 所以 `tools/call` 同时认 `propose_command` 与 `propose_action`，老配置不用改也能跑；
 * 服务端那条路径同理（`/commands` 与 `/actions` 指向同一个 handler）。
 *
 * 用法（作为本地 MCP server 挂到会话）：
 *   COPILOT_MCP_SERVERS='{"governance":{"type":"local","command":"node","args":["scripts/governance-mcp.mjs"],"tools":["propose_command"]}}'
 * 环境变量：
 *   COPILOT_API_URL       默认 http://127.0.0.1:3001
 *   COPILOT_ADMIN_TOKEN   与服务端一致（用于管理接口）
 *   COPILOT_EXECUTION_ID  propose_command 未显式传 executionId 时的兜底
 */

const API_URL = process.env.COPILOT_API_URL ?? 'http://127.0.0.1:3001';
const ADMIN_TOKEN = process.env.COPILOT_ADMIN_TOKEN ?? '';
const DEFAULT_EXECUTION_ID = process.env.COPILOT_EXECUTION_ID ?? '';

const TOOLS = [
  {
    name: 'propose_command',
    description:
      '提出一个高风险业务命令意向（如下单、代理投票、对外发消息）。服务端按策略裁决：自动放行 / 需人工审批 / 拒绝。返回 taskId 表示已建审批任务。',
    inputSchema: {
      type: 'object',
      properties: {
        executionId: { type: 'string', description: '当前 execution id' },
        commandType: { type: 'string', description: 'submit_proxy_vote / submit_trade / ...' },
        /** @deprecated 改名前的字段名，等价于 `commandType` */
        actionType: { type: 'string', description: '（旧名）同 commandType' },
        target: {
          type: 'object',
          properties: { type: { type: 'string' }, id: { type: 'string' } },
          required: ['type', 'id'],
        },
        parameters: { type: 'object' },
        reason: { type: 'string' },
        resourceVersion: { type: 'string' },
      },
      // 两个字段名二选一（与服务端 commandSchema 的兼容层一致），target 必填
      required: ['target'],
      anyOf: [{ required: ['commandType'] }, { required: ['actionType'] }],
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

async function proposeCommand(args = {}) {
  const executionId = args.executionId ?? DEFAULT_EXECUTION_ID;
  if (!executionId) {
    return { error: '缺少 executionId（或设 COPILOT_EXECUTION_ID）' };
  }
  const { executionId: _drop, ...intent } = args;
  const { status, body } = await callApi(`/api/executions/${executionId}/commands`, intent);
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
      // 旧工具名 `propose_action` 继续可用：工具名写在部署配置里，改名不能让它静默失效
      if (name !== 'propose_command' && name !== 'propose_action') {
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
        const out = await proposeCommand(params?.arguments ?? {});
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
            content: [{ type: 'text', text: `propose_command 失败：${String(err)}` }],
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

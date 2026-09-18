#!/usr/bin/env node
/**
 * custom agent 工具可用性验证（SDK #2356 回归测试）。
 *
 * 背景：customAgents[].tools 在某些 SDK/runtime 组合下会“被宣布但模型拿不到”，
 * 表现为 subagent.selected 有事件、但永远没有 tool.execution_start。
 * 本脚本只认 tool.execution_start —— 证明工具真的进了模型的 callable tool set。
 *
 * 前置：server 已启动（npm run dev:server 或 docker），且已认证（GITHUB_TOKEN / CLI 登录）。
 * 用法：node scripts/verify-agent-tools.mjs [baseUrl]
 */
import { existsSync, readFileSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:3001';

async function createSession(body) {
  const res = await fetch(`${BASE}/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`create session 失败 ${res.status}: ${await res.text()}`);
  return res.json();
}

/** 流式 chat，收集 SSE 事件 */
async function chat(sessionId, prompt) {
  const res = await fetch(`${BASE}/api/sessions/${encodeURIComponent(sessionId)}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, streaming: true }),
  });
  if (!res.ok) throw new Error(`chat 失败 ${res.status}: ${await res.text()}`);
  const events = [];
  let buf = '';
  const decoder = new TextDecoder();
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    const parts = buf.split('\n\n');
    buf = parts.pop() ?? '';
    for (const part of parts) {
      const name = part.match(/^event:\s*(.+)$/m)?.[1]?.trim();
      const data = part.match(/^data:\s*(.+)$/m)?.[1];
      if (!name) continue; // heartbeat 注释行
      let parsed = data;
      try {
        parsed = JSON.parse(data);
      } catch {
        /* 保留原文 */
      }
      events.push({ type: name, data: parsed });
    }
  }
  return events;
}

/** 从事件里取工具名（不同 runtime 字段位置略有差异，尽量兜住） */
function toolNames(events) {
  const names = new Set();
  for (const e of events) {
    const t = e.type ?? '';
    if (!t.startsWith('tool.')) continue;
    const d = e.data ?? {};
    const candidate =
      d.toolName ?? d.data?.toolName ?? d.name ?? d.data?.name ?? d.tool?.name ?? d.data?.tool?.name;
    if (typeof candidate === 'string') names.add(`${t}:${candidate}`);
  }
  return [...names];
}

function starts(events) {
  return events.filter((e) => e.type === 'tool.execution_start');
}

const results = [];

async function checkEditor() {
  const { sessionId, workspacePath } = await createSession({
    agents: ['editor'],
    agent: 'editor',
    sessionId: `verify-editor-${Date.now()}`,
  });
  const events = await chat(sessionId, '在当前目录创建文件 verify.txt，内容为 hello，然后读回确认。');
  const started = starts(events);
  const names = toolNames(events);
  const wroteSomething = names.some((n) => /edit|create|write|bash/i.test(n));
  results.push({
    case: 'editor 可用写类工具',
    ok: started.length > 0 && wroteSomething,
    detail: `tool.execution_start=${started.length} tools=[${names.join(', ') || 'none'}]`,
  });
  if (workspacePath && existsSync(`${workspacePath}/verify.txt`)) {
    const content = readFileSync(`${workspacePath}/verify.txt`, 'utf-8');
    results.push({
      case: '写入落在 session workspace',
      ok: /hello/i.test(content),
      detail: `${workspacePath}/verify.txt = ${content.slice(0, 40)}`,
    });
  } else {
    results.push({
      case: '写入落在 session workspace',
      ok: false,
      detail: `未找到 ${workspacePath}/verify.txt`,
    });
  }
}

async function checkResearcher() {
  const { sessionId } = await createSession({
    agents: ['researcher'],
    agent: 'researcher',
    sessionId: `verify-researcher-${Date.now()}`,
  });
  const events = await chat(sessionId, '用只读工具列出当前目录有什么文件，并说明内容。不要修改任何文件。');
  const names = toolNames(events);
  const usedWrite = names.some((n) => /tool\.execution_start:(edit|create|write|bash)/i.test(n));
  results.push({
    case: 'researcher 只用只读工具',
    ok: starts(events).length > 0 && !usedWrite,
    detail: `tools=[${names.join(', ') || 'none'}]`,
  });
}

async function main() {
  console.log(`验证目标：${BASE}\n`);
  try {
    await checkEditor();
    await checkResearcher();
  } catch (e) {
    console.error(`运行失败：${e instanceof Error ? e.message : String(e)}`);
    process.exit(2);
  }
  let failed = 0;
  for (const r of results) {
    if (!r.ok) failed++;
    console.log(`${r.ok ? '✓' : '✗'} ${r.case} — ${r.detail}`);
  }
  console.log(
    failed === 0
      ? '\n全部通过：custom agent 的工具确实可调用'
      : `\n${failed} 项失败：若 tool.execution_start 为 0，基本可判定命中 #2356，改由 session-level availableTools 提供工具`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

await main();

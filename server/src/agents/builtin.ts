import type { CustomAgentConfig } from '@github/copilot-sdk';

/**
 * 内置 custom agent 预设（对应官方 custom-agents 文档）。
 * 前端 POST /api/sessions 时用 `agents: ["researcher", "editor"]` 按名引用；
 * 也可用 `customAgents` 传完整内联定义，用 `agent` 预选首个激活的 agent。
 */
export const BUILTIN_AGENTS: CustomAgentConfig[] = [
  {
    name: 'researcher',
    displayName: 'Researcher（只读调研）',
    description:
      'Explores the codebase and answers questions using read-only tools; never modifies files',
    tools: ['grep', 'glob', 'view'],
    prompt:
      'You are a research assistant. Thoroughly explore the codebase to answer questions. ' +
      'Use only read-only tools. Do not modify any files; summarize findings instead.',
  },
  {
    name: 'editor',
    displayName: 'Editor（定向改代码）',
    description: 'Makes minimal, targeted code changes and verifies they compile',
    tools: ['view', 'edit', 'bash'],
    prompt:
      'You are a code editor. Make minimal, surgical changes to files as requested. ' +
      'Always verify that changes compile or pass checks before finishing.',
  },
];

export function getBuiltinAgentNames(): string[] {
  return BUILTIN_AGENTS.map((a) => a.name);
}

/**
 * 按名解析预设。names 缺省 = 全部预设；显式传 [] = 不挂任何预设。
 * 未知名字直接抛错（路由层转为 400）。
 */
export function resolveBuiltinAgents(names?: string[]): CustomAgentConfig[] {
  const wanted = names ?? getBuiltinAgentNames();
  return wanted.map((name) => {
    const found = BUILTIN_AGENTS.find((a) => a.name === name);
    if (!found) {
      throw new Error(
        `未知 agent "${name}"，可选预设：${getBuiltinAgentNames().join(', ') || '(无)'}`,
      );
    }
    return found;
  });
}

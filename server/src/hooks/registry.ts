import type { SessionHooks } from '@github/copilot-sdk';
import { composeHooks, HOOK_PRESETS } from './builtin.js';
import { recentHookEvents, type HookEvent } from './events.js';

export interface HookPresetMeta {
  name: string;
  displayName: string;
  description: string;
  enabledByDefault: boolean;
}

export interface ResolveHooksOptions {
  /** 要启用的预设名（缺省=全部默认启用；显式 []=全关） */
  enable?: string[];
  /** 注入的启动上下文（传了即自动启用 session-context 预设） */
  sessionContext?: string;
  /** 停机检查项（传了即自动启用 stop-guard 预设） */
  agentStopChecklist?: string;
}

/** 供 GET /api/hooks：预设元信息 + 最近 hook 事件（审计） */
export function listHooks(limit = 50): { presets: HookPresetMeta[]; recentEvents: HookEvent[] } {
  return {
    presets: HOOK_PRESETS.map(({ name, displayName, description, enabledByDefault }) => ({
      name,
      displayName,
      description,
      enabledByDefault,
    })),
    recentEvents: recentHookEvents(limit),
  };
}

/**
 * 解析本次会话的 hooks。传参即隐式启用对应预设（如只传 sessionContext
 * 也会挂上 session-context），未知名字直接抛错（路由层转为 400）。
 */
export function resolveHooks(opts: ResolveHooksOptions): { hooks?: SessionHooks } {
  const wanted = new Set(opts.enable ?? HOOK_PRESETS.filter((p) => p.enabledByDefault).map((p) => p.name));
  if (opts.sessionContext?.trim()) wanted.add('session-context');
  if (opts.agentStopChecklist?.trim()) wanted.add('stop-guard');

  const unknown = [...wanted].filter((n) => !HOOK_PRESETS.some((p) => p.name === n));
  if (unknown.length) {
    throw new Error(
      `未知 hook 预设：${unknown.join(', ')}，可选：${HOOK_PRESETS.map((p) => p.name).join(', ')}`,
    );
  }
  if (wanted.size === 0) return {};
  const presets = HOOK_PRESETS.filter((p) => wanted.has(p.name));
  return {
    hooks: composeHooks(presets, {
      sessionContext: opts.sessionContext,
      agentStopChecklist: opts.agentStopChecklist,
    }),
  };
}

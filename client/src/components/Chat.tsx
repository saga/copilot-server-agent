import { useEffect, useRef, useState } from 'react';
import {
  api,
  type AgentInfo,
  type DebugInfo,
  type HookEvent,
  type HookPreset,
  type McpPreset,
  type McpTestResult,
  type SessionMeta,
  type SkillInfo,
  type SubagentEvent,
} from '../lib/api';

interface Msg {
  role: 'user' | 'assistant';
  content: string;
}

function describeSubagent(e: SubagentEvent): string | null {
  const name = e.data?.agentDisplayName || e.data?.agentName || 'sub-agent';
  switch (e.type) {
    case 'subagent.selected':
      return `🎯 选中 ${name}`;
    case 'subagent.started':
      return `▶ ${name} 开始执行`;
    case 'subagent.completed': {
      const extra = [
        e.data?.durationMs !== undefined ? `${e.data.durationMs}ms` : '',
        e.data?.totalTokens !== undefined ? `${e.data.totalTokens} tokens` : '',
      ]
        .filter(Boolean)
        .join(' · ');
      return `✅ ${name} 完成${extra ? `（${extra}）` : ''}`;
    }
    case 'subagent.failed':
      return `❌ ${name} 失败：${e.data?.error ?? 'unknown'}`;
    case 'subagent.deselected':
      return `↩ ${name} 交回主会话`;
    default:
      return null;
  }
}

export function Chat() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [model, setModel] = useState('gpt-5');
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [providerLabel, setProviderLabel] = useState<string>('');
  const [presets, setPresets] = useState<AgentInfo[]>([]);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [enabledAgents, setEnabledAgents] = useState<string[]>([]);
  const [preSelect, setPreSelect] = useState('');
  const [useSkills, setUseSkills] = useState(true);
  const [activity, setActivity] = useState<string[]>([]);
  // 最近一次 execution（审计/usage 查询用：GET /api/executions/:id）
  const [executionId, setExecutionId] = useState<string | null>(null);
  // 会话持久化：自定义 ID + 会话列表
  const [customId, setCustomId] = useState('');
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [showSessions, setShowSessions] = useState(false);
  // MCP 预设开关
  const [mcpPresets, setMcpPresets] = useState<McpPreset[]>([]);
  const [enabledMcp, setEnabledMcp] = useState<string[]>([]);
  // Hooks 预设开关 + 参数 + 事件查看
  const [hookPresets, setHookPresets] = useState<HookPreset[]>([]);
  const [enabledHooks, setEnabledHooks] = useState<string[]>([]);
  const [sessionContext, setSessionContext] = useState('');
  const [stopChecklist, setStopChecklist] = useState('');
  const [hookEvents, setHookEvents] = useState<HookEvent[]>([]);
  const [showHooks, setShowHooks] = useState(false);
  // 调试面板 + MCP 自检结果
  const [debug, setDebug] = useState<DebugInfo | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  const [mcpTests, setMcpTests] = useState<Record<string, McpTestResult | 'testing'>>({});
  const listRef = useRef<HTMLDivElement>(null);

  // 后端当前 provider（copilot/deepseek）决定默认模型；用户手动改过则不覆盖
  useEffect(() => {
    let alive = true;
    api
      .providers()
      .then(({ providers }) => {
        if (!alive) return;
        const active = providers.find((p) => p.active);
        if (!active) return;
        setProviderLabel(
          `${active.displayName}${active.configured ? '' : '（未配置）'}`,
        );
        setModel((cur) => {
          if (cur !== 'gpt-5') return cur; // 用户已手动修改
          return active.defaultModel;
        });
        if (!active.configured && active.hint) setError(active.hint);
      })
      .catch(() => {});
    api
      .agents()
      .then(({ agents, skills }) => {
        if (!alive) return;
        setPresets(agents);
        setSkills(skills);
        setEnabledAgents(agents.map((a) => a.name)); // 默认全挂
      })
      .catch(() => {});
    api
      .mcp()
      .then(({ presets }) => {
        if (!alive) return;
        setMcpPresets(presets);
        setEnabledMcp(presets.filter((p) => p.enabledByDefault).map((p) => p.name));
      })
      .catch(() => {});
    api
      .hooks()
      .then(({ presets }) => {
        if (!alive) return;
        setHookPresets(presets);
        setEnabledHooks(presets.filter((p) => p.enabledByDefault).map((p) => p.name));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  async function refreshSessions() {
    try {
      const { sessions } = await api.listSessions();
      setSessions(sessions);
    } catch {
      // 列表失败不打断主流程
    }
  }

  /** 当前表单拼出的会话配置（创建与恢复共用） */
  function sessionConfig() {
    return {
      model: model || undefined,
      agents: enabledAgents,
      ...(preSelect ? { agent: preSelect } : {}),
      noBuiltinSkills: !useSkills,
      mcp: enabledMcp,
      hooks: enabledHooks,
      ...(sessionContext.trim() ? { sessionContext: sessionContext.trim() } : {}),
      ...(stopChecklist.trim() ? { agentStopChecklist: stopChecklist.trim() } : {}),
    };
  }

  async function refreshHookEvents() {
    try {
      const { recentEvents } = await api.hooks(50);
      setHookEvents(recentEvents);
    } catch {
      // 失败不打断主流程
    }
  }

  async function refreshDebug() {
    try {
      setDebug(await api.debug());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function testMcpPreset(name: string) {
    setMcpTests((m) => ({ ...m, [name]: 'testing' }));
    try {
      const r = await api.testMcp({ name });
      setMcpTests((m) => ({ ...m, [name]: r }));
    } catch (e) {
      setMcpTests((m) => ({
        ...m,
        [name]: {
          ok: false,
          kind: 'local',
          target: name,
          error: e instanceof Error ? e.message : String(e),
        },
      }));
    }
  }

  const scrollBottom = () => {
    requestAnimationFrame(() => {
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
    });
  };

  async function ensureSession(): Promise<string> {
    if (sessionId) return sessionId;
    const { sessionId: id } = await api.createSession({
      ...sessionConfig(),
      ...(customId.trim() ? { sessionId: customId.trim() } : {}),
    });
    setSessionId(id);
    void refreshSessions();
    return id;
  }

  /** 恢复磁盘会话：附着到本进程并切当前聊天（重配用当前表单） */
  async function resume(id: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { sessionId: rid } = await api.resumeSession(id, sessionConfig());
      setSessionId(rid);
      setMessages([]);
      setActivity([]);
      setCustomId(rid);
      void refreshSessions();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  /** 断开（默认保留磁盘可恢复）或彻底删除 */
  async function removeSession(id: string, permanent: boolean) {
    if (busy) return;
    if (permanent && !window.confirm(`彻底删除会话 ${id}？磁盘数据不可恢复。`)) return;
    try {
      await api.disconnectSession(id, permanent);
      if (id === sessionId) {
        setSessionId(null);
        setMessages([]);
        setActivity([]);
      }
      void refreshSessions();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function send() {
    const prompt = input.trim();
    if (!prompt || busy) return;
    setBusy(true);
    setError(null);
    setInput('');
    setMessages((m) => [...m, { role: 'user', content: prompt }]);
    scrollBottom();

    try {
      const id = await ensureSession();
      if (streaming) {
        let acc = '';
        setMessages((m) => [...m, { role: 'assistant', content: '' }]);
        api.chatStream(
          id,
          prompt,
          {
            onDelta: (d) => {
              acc += d;
              setMessages((m) => {
                const next = [...m];
                next[next.length - 1] = { role: 'assistant', content: acc };
                return next;
              });
              scrollBottom();
            },
            onSubagent: (e) => {
              const line = describeSubagent(e);
              if (line) setActivity((a) => [...a.slice(-19), line]);
            },
            onExecution: (id) => setExecutionId(id),
            onDone: () => setBusy(false),
            onError: (e) => {
              setError(e.message);
              setBusy(false);
            },
          },
          model || undefined,
        );
      } else {
        const { content, executionId: exId } = await api.chat(id, prompt, model || undefined);
        setExecutionId(exId ?? null);
        setMessages((m) => [...m, { role: 'assistant', content }]);
        setBusy(false);
        scrollBottom();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  async function reset() {
    // 断开不断数据：旧会话仍在磁盘，可在会话列表里恢复
    if (sessionId) {
      try {
        await api.disconnectSession(sessionId, false);
      } catch {
        // 断开失败也不阻塞开新会话
      }
    }
    setSessionId(null);
    setMessages([]);
    setError(null);
    setActivity([]);
    void refreshSessions();
  }

  function toggleAgent(name: string) {
    setEnabledAgents((cur) => (cur.includes(name) ? cur.filter((n) => n !== name) : [...cur, name]));
    if (preSelect === name) setPreSelect('');
  }

  function toggleMcp(name: string) {
    setEnabledMcp((cur) => (cur.includes(name) ? cur.filter((n) => n !== name) : [...cur, name]));
  }

  const sessionStarted = sessionId !== null;

  return (
    <div className="chat">
      <div className="toolbar">
        {providerLabel && <span className="badge badge-ok">{providerLabel}</span>}
        <label>
          Model{' '}
          <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="模型名" />
        </label>
        <label>
          <input
            type="checkbox"
            checked={streaming}
            onChange={(e) => setStreaming(e.target.checked)}
          />{' '}
          流式 (SSE)
        </label>
        <button onClick={() => void reset()} disabled={busy}>
          新会话
        </button>
        {sessionId && <code className="sid">{sessionId.slice(0, 8)}…</code>}
      </div>

      <div className="toolbar">
        <span title="建会话时挂载的 custom agents（sub-agent 编排）">
          Agents:{' '}
          {presets.length === 0 && <span className="hint">加载中…</span>}
          {presets.map((a) => (
            <label key={a.name} style={{ marginRight: 8 }} title={a.description ?? a.name}>
              <input
                type="checkbox"
                checked={enabledAgents.includes(a.name)}
                disabled={sessionStarted || busy}
                onChange={() => toggleAgent(a.name)}
              />{' '}
              {a.displayName ?? a.name}
            </label>
          ))}
        </span>
        <label>
          预选{' '}
          <select
            value={preSelect}
            disabled={sessionStarted || busy}
            onChange={(e) => setPreSelect(e.target.value)}
          >
            <option value="">（自动推断）</option>
            {enabledAgents.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label title={skills.map((s) => s.name).join(', ') || '无'}>
          <input
            type="checkbox"
            checked={useSkills}
            disabled={sessionStarted || busy}
            onChange={(e) => setUseSkills(e.target.checked)}
          />{' '}
          技能 ({skills.length})
        </label>
      </div>
      {sessionStarted && (
        <div className="hint" style={{ padding: '4px 12px' }}>
          会话已创建，agents/技能/预选/MCP/hooks 在下次「新会话」时生效（恢复会话则用当前表单重配）。
        </div>
      )}

      <div className="toolbar">
        <span title="启用的 hook 预设（传上下文/检查项会自动启用对应预设）">
          Hooks:{' '}
          {hookPresets.length === 0 && <span className="hint">加载中…</span>}
          {hookPresets.map((p) => (
            <label key={p.name} style={{ marginRight: 8 }} title={p.description}>
              <input
                type="checkbox"
                checked={enabledHooks.includes(p.name)}
                disabled={sessionStarted || busy}
                onChange={() =>
                  setEnabledHooks((cur) =>
                    cur.includes(p.name) ? cur.filter((n) => n !== p.name) : [...cur, p.name],
                  )
                }
              />{' '}
              {p.name}
            </label>
          ))}
        </span>
        <label title="onSessionStart 注入的附加上下文">
          上下文{' '}
          <input
            value={sessionContext}
            onChange={(e) => setSessionContext(e.target.value)}
            placeholder="如：回答用中文、简洁"
            disabled={sessionStarted || busy}
            style={{ width: 200 }}
          />
        </label>
        <label title="onAgentStop：agent 自然停机时 block 一次按此检查项继续">
          停机检查{' '}
          <input
            value={stopChecklist}
            onChange={(e) => setStopChecklist(e.target.value)}
            placeholder="如：确认 tests 通过再结束"
            disabled={sessionStarted || busy}
            style={{ width: 200 }}
          />
        </label>
        <button
          disabled={busy}
          onClick={() => {
            setShowHooks((s) => !s);
            if (!showHooks) void refreshHookEvents();
          }}
        >
          {showHooks ? '收起事件' : 'hook 事件'}
        </button>
        <button
          disabled={busy}
          onClick={() => {
            setShowDebug((s) => !s);
            if (!showDebug) void refreshDebug();
          }}
        >
          {showDebug ? '收起调试' : '调试'}
        </button>
      </div>

      {showHooks && (
        <div className="sessions">
          {hookEvents.length === 0 && <span className="hint">暂无 hook 事件（建会话并对话后产生）</span>}
          {hookEvents.map((e, i) => (
            <div key={i} className="session-row">
              <span className="badge">{e.kind}</span>
              <code className="sid" title={e.sessionId}>
                {e.sessionId.length > 16 ? `${e.sessionId.slice(0, 16)}…` : e.sessionId}
              </code>
              <span className="hint">{new Date(e.ts).toLocaleTimeString()}</span>
              <span>{e.detail}</span>
            </div>
          ))}
        </div>
      )}

      {showDebug && (
        <div className="sessions">
          {!debug && <span className="hint">加载诊断包…</span>}
          {debug && (
            <>
              <div className="session-row">
                <span className="badge badge-ok">{debug.runtime.state}</span>
                <span>SDK {debug.sdkVersion}</span>
                <span className="hint">
                  {debug.node} · {debug.platform} · 通道 {debug.provider}
                </span>
                <button disabled={busy} onClick={() => void refreshDebug()}>
                  刷新
                </button>
              </div>
              <div className="session-row">
                <span>
                  CLI: {debug.runtime.cli ? `${debug.runtime.cli.version} (proto ${debug.runtime.cli.protocolVersion})` : (debug.runtime.cliError ?? '…')}
                </span>
                <span>
                  认证: {debug.runtime.auth ? `${debug.runtime.auth.isAuthenticated ? '✅' : '❌'} ${debug.runtime.auth.authType ?? ''}` : (debug.runtime.authError ?? '…')}
                </span>
                <span className="hint">
                  ping {debug.runtime.pingMs !== undefined ? `${debug.runtime.pingMs}ms` : (debug.runtime.pingError ?? '…')}
                </span>
              </div>
              {(debug.runtime.lastError || debug.runtime.startError) && (
                <div className="error">
                  {debug.runtime.lastError ?? debug.runtime.startError}
                </div>
              )}
              <div className="session-row">
                <span className="hint">
                  会话 附着 {debug.sessions.attached} / 磁盘 {debug.sessions.onDisk ?? '?'}
                  · hooks {debug.hooks.presets} 预设 / {debug.hooks.recentEvents} 事件
                  · MCP {debug.mcp.presets} 预设
                  · 日志 {debug.config.logLevel}
                  {debug.config.logDir ? ` → ${debug.config.logDir}` : ''}
                </span>
              </div>
              {mcpPresets.map((p) => {
                const t = mcpTests[p.name];
                return (
                  <div key={p.name} className="session-row">
                    <code className="sid">{p.name}</code>
                    <button disabled={busy || t === 'testing'} onClick={() => void testMcpPreset(p.name)}>
                      {t === 'testing' ? '测试中…' : '连通测试'}
                    </button>
                    {t && t !== 'testing' && (
                      <span className={t.ok ? '' : 'error'} style={t.ok ? undefined : { padding: 0 }}>
                        {t.ok
                          ? `✅ ${t.kind === 'http' ? `可达 (HTTP ${t.httpStatus})` : t.target}`
                          : `❌ ${t.error}`}
                      </span>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}

      <div className="toolbar">
        <span title="启用的 MCP servers（filesystem 预设限定在仓库目录；内联 local 默认被服务端拒绝）">
          MCP:{' '}
          {mcpPresets.length === 0 && <span className="hint">无预设</span>}
          {mcpPresets.map((p) => (
            <label key={p.name} style={{ marginRight: 8 }} title={`${p.description}${p.scope ? `（${p.scope}）` : ''}`}>
              <input
                type="checkbox"
                checked={enabledMcp.includes(p.name)}
                disabled={sessionStarted || busy}
                onChange={() => toggleMcp(p.name)}
              />{' '}
              {p.name}
            </label>
          ))}
        </span>
        <label title="自定义可恢复 ID（推荐 user-xxx-task-yyy；留空则随机生成、不可恢复）">
          会话ID{' '}
          <input
            value={customId}
            onChange={(e) => setCustomId(e.target.value)}
            placeholder="留空=随机"
            disabled={sessionStarted}
            style={{ width: 180 }}
          />
        </label>
        <button
          disabled={busy}
          onClick={() => {
            setShowSessions((s) => !s);
            if (!showSessions) void refreshSessions();
          }}
        >
          {showSessions ? '收起会话' : '会话列表'}
        </button>
      </div>

      {showSessions && (
        <div className="sessions">
          {sessions.length === 0 && <span className="hint">暂无磁盘会话</span>}
          {sessions.map((s) => (
            <div key={s.sessionId} className="session-row">
              <code className="sid" title={s.sessionId}>
                {s.sessionId.length > 24 ? `${s.sessionId.slice(0, 24)}…` : s.sessionId}
              </code>
              {s.attached && <span className="badge badge-ok">内存</span>}
              <span className="hint">{new Date(s.modifiedTime).toLocaleString()}</span>
              {s.sessionId !== sessionId && (
                <button disabled={busy} onClick={() => void resume(s.sessionId)}>
                  恢复
                </button>
              )}
              <button disabled={busy} onClick={() => void removeSession(s.sessionId, false)}>
                断开
              </button>
              <button disabled={busy} onClick={() => void removeSession(s.sessionId, true)}>
                删除
              </button>
            </div>
          ))}
        </div>
      )}

      {activity.length > 0 && (
        <div className="activity">
          {activity.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      )}

      {executionId && (
        <div className="activity" title="本次 turn 的审计记录：GET /api/executions/{id}">
          execution: {executionId}
        </div>
      )}

      <div className="messages" ref={listRef}>
        {messages.length === 0 && (
          <p className="hint">在下方输入问题，React 会调用 Express 的 /api/sessions/:id/chat。</p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            {m.role !== 'user' && <b>Copilot</b>}
            <pre>{m.content || (busy ? '▍' : '')}</pre>
          </div>
        ))}
      </div>

      {error && <div className="error">出错：{error}</div>}

      <div className="composer">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void send()}
          placeholder="输入 prompt 回车发送…"
          disabled={busy}
        />
        <button onClick={() => void send()} disabled={busy || !input.trim()}>
          {busy ? '思考中…' : '发送'}
        </button>
      </div>
    </div>
  );
}

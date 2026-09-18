import { useEffect, useState } from 'react';
import { api, type Health } from '../lib/api';

export function HealthBadge() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .health()
      .then((h) => alive && setHealth(h))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, []);

  if (error) return <span className="badge badge-error">API 不可达：{error}</span>;
  if (!health) return <span className="badge">连接 Express 中…</span>;
  return (
    <span className={`badge ${health.copilot === 'connected' ? 'badge-ok' : 'badge-warn'}`}>
      Express ✓ · Copilot: {health.copilot}
      {health.copilotError ? ` (${health.copilotError})` : ''}
    </span>
  );
}

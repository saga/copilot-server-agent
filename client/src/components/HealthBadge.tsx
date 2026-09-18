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

  // idle 只是懒加载尚未建连（中性色），不是故障；error 才用 warn 色并附原因
  const { copilot, copilotError } = health;
  if (copilot === 'connected') {
    return <span className="badge badge-ok">Express ✓ · Copilot: connected</span>;
  }
  if (copilot === 'idle') {
    return (
      <span className="badge" title="会话操作或预热时会自动建连；连接可用性见 /api/health/ready">
        Express ✓ · Copilot: 未启动（首次会话时连接）
      </span>
    );
  }
  return (
    <span className="badge badge-warn">
      Express ✓ · Copilot: error{copilotError ? ` (${copilotError})` : ''}
    </span>
  );
}

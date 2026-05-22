import React, { useEffect, useState } from 'react';
import { fmtTime } from '../../utils/formatters';
import { ConnectionStatus } from '../../socket/useMarketSocket';

interface Props {
  connectionStatus: ConnectionStatus;
  lastUpdate: Date | null;
}

export function StatusBar({ connectionStatus, lastUpdate }: Props) {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  const isOnline     = connectionStatus === 'connected';
  const isConnecting = connectionStatus === 'connecting';

  const systemColor = isOnline ? 'var(--green)' : isConnecting ? 'var(--yellow-gc)' : 'var(--red-gc)';
  const systemLabel = isOnline ? 'ONLINE'       : isConnecting ? 'CONECTANDO'       : 'OFFLINE';

  const lastUpdateStr = lastUpdate ? fmtTime(lastUpdate) : null;

  return (
    <header style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 20px',
      height: 36,
      flexShrink: 0,
      backgroundColor: '#060b18',
      borderBottom: '1px solid var(--border-dark)',
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: 11,
      letterSpacing: '0.04em',
      userSelect: 'none',
    }}>
      {/* Left: empty for balance */}
      <div />

      {/* Right: status + last update + clock */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            className={isOnline ? 'pulse-dot' : ''}
            style={{
              width: 6, height: 6, borderRadius: '50%',
              backgroundColor: systemColor,
              display: 'inline-block',
              boxShadow: isOnline ? `0 0 6px ${systemColor}` : 'none',
            }}
          />
          <span style={{ color: systemColor, fontWeight: 600 }}>{systemLabel}</span>
        </div>
        {lastUpdateStr && (
          <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>
            upd <span style={{ color: 'var(--text-secondary)' }}>{lastUpdateStr}</span>
          </span>
        )}
        <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{fmtTime(now)} ET</span>
      </div>
    </header>
  );
}

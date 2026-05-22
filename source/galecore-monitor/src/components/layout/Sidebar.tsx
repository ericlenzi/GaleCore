import React from 'react';
import { AccountSummary } from '../account/AccountSummary';

export function Sidebar() {
  return (
    <aside style={{
      width: 220,
      flexShrink: 0,
      display: 'flex',
      flexDirection: 'column',
      backgroundColor: '#060b18',
      borderRight: '1px solid var(--border-dark)',
      height: '100%',
      overflow: 'hidden',
    }}>
      {/* Logo */}
      <div style={{
        padding: '20px 16px 16px',
        borderBottom: '1px solid var(--border-dark)',
      }}>
        <div style={{
          fontFamily: 'JetBrains Mono, monospace',
          fontWeight: 700,
          fontSize: 15,
          letterSpacing: '0.22em',
          color: 'var(--text-primary)',
          textAlign: 'center',
        }}>
          GALECORE
        </div>
        <div style={{
          fontFamily: 'Inter, sans-serif',
          fontSize: 8,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: 'var(--text-muted)',
          textAlign: 'center',
          marginTop: 3,
        }}>
          Trading Monitor
        </div>
      </div>

      {/* Account — always visible */}
      <div style={{
        padding: '12px 10px',
        flex: 1,
        overflowY: 'auto',
      }}>
        <AccountSummary />
      </div>
    </aside>
  );
}

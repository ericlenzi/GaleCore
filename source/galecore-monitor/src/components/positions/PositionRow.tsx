import React from 'react';
import { EnrichedPosition, AlertType } from '../../types/position';
import { fmtPrice, fmtPct } from '../../utils/formatters';

interface Props {
  position: EnrichedPosition;
}

function AlertBadge({ type }: { type: AlertType }) {
  if (!type) return <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>—</span>;
  const cfg: Record<NonNullable<AlertType>, { label: string; color: string }> = {
    CERRAR:        { label: '🟢 CERRAR',         color: 'var(--green)' },
    STOP_LOSS:     { label: '🔴 STOP LOSS',       color: 'var(--red-gc)' },
    TIME_EXIT:     { label: '🟡 TIME EXIT',       color: 'var(--yellow-gc)' },
    EVALUAR_ROLL:  { label: '🟠 EVALUAR ROLL',    color: '#f97316' },
    MACRO_PROXIMO: { label: '🟡 MACRO PRÓXIMO',   color: 'var(--yellow-gc)' },
  };
  const { label, color } = cfg[type];
  return (
    <span className="text-xs font-semibold" style={{ color, fontFamily: 'JetBrains Mono, monospace', fontSize: 10 }}>
      {label}
    </span>
  );
}

const TYPE_LABELS: Record<string, string> = {
  PUT_CS:  'PUT CS',
  CALL_CS: 'CALL CS',
  IC:      'IC',
  LONG:    'LONG',
};

export function PositionRow({ position: p }: Props) {
  const pnlColor =
    p.currentPnl == null ? 'var(--text-muted)' :
    p.currentPnl >= 0 ? 'var(--green)' : 'var(--red-gc)';

  return (
    <tr
      style={{
        borderBottom: '1px solid var(--border-dark)',
        fontSize: 12,
        fontFamily: 'JetBrains Mono, monospace',
      }}
    >
      <td className="px-3 py-2 font-bold" style={{ color: 'var(--text-primary)' }}>
        {p.symbol}
      </td>
      <td className="px-3 py-2" style={{ color: 'var(--text-muted)' }}>
        {TYPE_LABELS[p.type] ?? p.type}
      </td>
      <td className="px-3 py-2" style={{ color: 'var(--text-primary)' }}>
        {fmtPrice(p.shortStrike)}/{fmtPrice(p.longStrike)}
        {p.type === 'IC' && p.shortStrike2 != null && (
          <span style={{ color: 'var(--text-muted)' }}> · {fmtPrice(p.shortStrike2)}/{fmtPrice(p.longStrike2!)}</span>
        )}
      </td>
      <td className="px-3 py-2" style={{ color: 'var(--text-muted)' }}>
        {p.expiration} <span style={{ color: p.dte <= 21 ? 'var(--yellow-gc)' : 'var(--text-muted)' }}>({p.dte}d)</span>
      </td>
      <td className="px-3 py-2 text-right" style={{ color: 'var(--text-primary)' }}>
        ${fmtPrice(p.credit, 2)}
      </td>
      <td className="px-3 py-2 text-right" style={{ color: pnlColor }}>
        {p.currentPnl != null ? `$${fmtPrice(p.currentPnl, 2)}` : '—'}
      </td>
      <td className="px-3 py-2 text-right" style={{ color: pnlColor }}>
        {p.pnlPct != null ? fmtPct(p.pnlPct) : '—'}
      </td>
      <td className="px-3 py-2 text-center">
        {p.contracts}
      </td>
      <td className="px-3 py-2">
        <AlertBadge type={p.alert} />
      </td>
    </tr>
  );
}

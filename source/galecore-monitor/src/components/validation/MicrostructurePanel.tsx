import React from 'react';
import { ValidationLayerApiResponse } from '../../types/api';
import { fmtPrice } from '../../utils/formatters';

/**
 * Microestructura (capa 3): calidad de ejecución del candidato — OI por leg, spread bid-ask
 * y crédito contra el mínimo exigido.
 *
 * El bloque queda siempre visible: cada fila cae a '—' si la capa 3 no corrió (la cascada cortó
 * antes) o si el dato puntual no vino, así la columna no cambia de alto entre refrescos.
 */

function ListRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '2px 0',
      borderBottom: '1px solid var(--border-dark)',
    }}>
      <span style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'Inter, sans-serif', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
        {label}
      </span>
      <span className="tabular-nums" style={{
        fontSize: 11,
        color: 'var(--text-secondary)',
        fontFamily: 'JetBrains Mono, monospace',
        fontWeight: 600,
      }}>
        {value}
      </span>
    </div>
  );
}

function fmtOI(v: number): string {
  return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${v}`;
}

export function MicrostructurePanel({ vlData }: { vlData: ValidationLayerApiResponse | null }) {
  const l3 = vlData?.positionBuilder?.microstructure;

  const bidAskDetail = l3?.bidAskChecks
    ? [l3.bidAskChecks.shortPut, l3.bidAskChecks.shortCall]
        .filter(Boolean)
        .map(c => c!.spreadPct != null ? `${(c!.spreadPct * 100).toFixed(1)}%` : '—')
        .join(' / ') || '—'
    : '—';

  return (
    <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase', color: '#a78bfa', fontFamily: 'Inter, sans-serif' }}>
        Microstructure
      </span>
      <span style={{ fontSize: 8.5, color: 'var(--text-muted)', fontFamily: 'Inter, sans-serif', marginBottom: 4, lineHeight: 1.3 }}>
        Calidad de ejecución del candidato (capa 3) — OI, spread y crédito.
      </span>

      <ListRow label="ATM Strike" value={l3?.atmStrike != null ? fmtPrice(l3.atmStrike, 0) : '—'} />
      <ListRow label="Short Call OI" value={l3?.oiChecks?.shortCall ? fmtOI(l3.oiChecks.shortCall.value) : '—'} />
      <ListRow label="Short Put OI" value={l3?.oiChecks?.shortPut ? fmtOI(l3.oiChecks.shortPut.value) : '—'} />
      <ListRow label="Bid-Ask" value={bidAskDetail} />
      <ListRow label="Credit" value={l3?.creditMinimum ? `$${l3.creditMinimum.midCredit.toFixed(2)} (min $${l3.creditMinimum.minRequired.toFixed(2)})` : '—'} />
      <ListRow label="ATM Delta" value={l3?.atmCallDelta != null ? l3.atmCallDelta.toFixed(2) : '—'} />
    </div>
  );
}

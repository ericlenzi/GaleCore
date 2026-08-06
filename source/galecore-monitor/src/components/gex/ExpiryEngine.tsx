import React from 'react';
import { GexExpiryApi } from '../../types/gex';
import { fmtExpiry, fmtGex, fmtPrice } from '../../utils/formatters';

interface Props {
  expiry: GexExpiryApi | null;
  label?: string;
}

// Misma fila que StrikesEnginePanel — el Expiry Engine es ese cuadro sin las filas de estructura
// (estructura, short put, short call, dentro de muros): acá no hay operación que armar.
function ListRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '2px 0',
      borderBottom: '1px solid var(--border-dark)',
    }}>
      <span style={{
        fontSize: 9, color: 'var(--text-muted)', fontFamily: 'Inter, sans-serif',
        fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.07em',
      }}>
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

/**
 * Lectura numérica del vencimiento seleccionado: es lo que dibuja el gráfico de barras, en números.
 * Todos los valores son de ESE vencimiento, no del agregado global.
 */
export function ExpiryEngine({ expiry, label = 'Expiry Engine' }: Props) {
  return (
    <div style={{ padding: 8 }}>
      <div style={{
        backgroundColor: 'var(--bg-tertiary)',
        borderRadius: 6,
        padding: '8px 10px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}>
        <span style={{
          fontSize: 9, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase',
          color: '#a78bfa', fontFamily: 'Inter, sans-serif',
        }}>
          {label}
        </span>

        <ListRow label="Vencimiento" value={expiry ? fmtExpiry(expiry.expiration) : '—'} />
        <ListRow label="DTE" value={expiry ? `${expiry.dte}` : '—'} />
        <ListRow label="Net GEX" value={expiry ? fmtGex(expiry.netGex) : '—'} />
        <ListRow label="ZGL" value={expiry?.gammaZeroLevel != null ? fmtPrice(expiry.gammaZeroLevel, 0) : '—'} />
        <ListRow label="Call Wall" value={expiry?.callWall != null ? fmtPrice(expiry.callWall, 0) : '—'} />
        <ListRow label="Put Wall" value={expiry?.putWall != null ? fmtPrice(expiry.putWall, 0) : '—'} />
        <ListRow
          label="Expected Move"
          value={expiry?.expectedMove != null ? `±${fmtPrice(expiry.expectedMove, 1)} pts` : '—'}
        />
      </div>
    </div>
  );
}

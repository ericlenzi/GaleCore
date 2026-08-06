import React from 'react';
import { GexExpiryApi } from '../../types/gex';
import { fmtExpiry, fmtGex } from '../../utils/formatters';

interface Props {
  expiries: GexExpiryApi[];
  selected: string | null;
  onSelect: (expiration: string) => void;
  label?: string;
}

/**
 * Lista de vencimientos de la cadena (0DTE primero). Elegir uno acota el Expiry Engine y el
 * gráfico a ese vencimiento; el cuadro Details sigue mostrando el GEX global.
 */
export function OptionsChainList({ expiries, selected, onSelect, label = 'Options Chain' }: Props) {
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

        {!expiries.length ? (
          <span style={{ fontSize: 10, color: 'var(--text-muted)', padding: '4px 0' }}>Sin vencimientos.</span>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', maxHeight: 190, overflowY: 'auto' }}>
            {expiries.map((e) => {
              const isActive = e.expiration === selected;
              // Los mensuales (Regular) concentran el OI y son los que anclan el gamma: van en
              // bold y con check. Los diarios/semanales (Weekly) quedan marcados con W.
              const isRegular = e.expirationType === 'Regular';
              return (
                <button
                  key={e.expiration}
                  onClick={() => onSelect(e.expiration)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 6,
                    padding: '3px 5px',
                    border: 'none',
                    borderBottom: '1px solid var(--border-dark)',
                    borderLeft: `2px solid ${isActive ? 'var(--blue-gc)' : 'transparent'}`,
                    backgroundColor: isActive ? 'var(--bg-secondary)' : 'transparent',
                    cursor: 'pointer',
                    textAlign: 'left',
                    width: '100%',
                  }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 4, minWidth: 0 }}>
                    <span className="tabular-nums" style={{
                      fontSize: 10.5,
                      fontFamily: 'JetBrains Mono, monospace',
                      fontWeight: isRegular || isActive ? 700 : 400,
                      color: isRegular || isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                      whiteSpace: 'nowrap',
                    }}>
                      {fmtExpiry(e.expiration)}
                    </span>
                    <span
                      title={isRegular ? 'Regular (mensual)' : 'Weekly'}
                      style={{
                        fontSize: 8.5,
                        fontFamily: 'JetBrains Mono, monospace',
                        fontWeight: 700,
                        color: isRegular ? 'var(--green)' : 'var(--text-muted)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {isRegular ? '✓' : 'W'}
                    </span>
                  </span>
                  <span className="tabular-nums" style={{
                    fontSize: 9,
                    fontFamily: 'JetBrains Mono, monospace',
                    color: e.dte === 0 ? 'var(--yellow-gc)' : 'var(--text-muted)',
                    whiteSpace: 'nowrap',
                  }}>
                    {e.dte === 0 ? '0DTE' : `${e.dte}d`} · {fmtGex(e.netGex)}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

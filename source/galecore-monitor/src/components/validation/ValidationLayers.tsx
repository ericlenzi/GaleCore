import React from 'react';
import { LayerStatus } from '../../types/market';
import { fmtPrice, fmtGex } from '../../utils/formatters';

interface Props {
  symbol: string;
  layers: LayerStatus;
  ivRank: number | null;
  iv30: number | null;
  netLiq: number | null;
  openPositions: number;
  maxPositions: number;
}

// Colores semáforo
function dotColor(ok: boolean | null) {
  if (ok === null) return 'var(--text-muted)';
  return ok ? 'var(--green)' : 'var(--red-gc)';
}

function DotSmall({ ok }: { ok: boolean | null }) {
  const color = dotColor(ok);
  return (
    <span style={{
      display: 'inline-block',
      width: 6, height: 6,
      borderRadius: '50%',
      backgroundColor: ok === null ? 'transparent' : color,
      border: ok === null ? `1px solid ${color}` : 'none',
      boxShadow: ok != null && ok ? '0 0 4px rgba(34,197,94,0.5)' : ok === false ? '0 0 4px rgba(244,63,94,0.4)' : 'none',
      flexShrink: 0,
    }} />
  );
}

interface MetricCellProps {
  label: string;
  value: string;
  sub: string;
  ok: boolean | null;
}

function MetricCell({ label, value, sub, ok }: MetricCellProps) {
  const valueColor = ok === null ? 'var(--text-secondary)' : ok ? 'var(--green)' : 'var(--red-gc)';
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      padding: '7px 8px',
      gap: 2,
      backgroundColor: 'var(--bg-tertiary)',
      borderRadius: 6,
      minWidth: 0,
    }}>
      {/* Label */}
      <span style={{
        fontSize: 8.5,
        fontWeight: 600,
        letterSpacing: '0.09em',
        textTransform: 'uppercase',
        color: 'var(--text-muted)',
        fontFamily: 'Inter, sans-serif',
      }}>
        {label}
      </span>

      {/* Big value */}
      <span className="tabular-nums" style={{
        fontSize: 14,
        fontWeight: 700,
        color: valueColor,
        fontFamily: 'JetBrains Mono, monospace',
        letterSpacing: '-0.02em',
        lineHeight: 1.1,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>
        {value}
      </span>

      {/* Sub label + dot */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <DotSmall ok={ok} />
        <span style={{
          fontSize: 9,
          color: 'var(--text-muted)',
          fontFamily: 'Inter, sans-serif',
          fontWeight: 400,
        }}>
          {sub}
        </span>
      </div>
    </div>
  );
}

function InfoLine({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: '6px 10px',
      backgroundColor: 'var(--bg-tertiary)',
      borderRadius: 6,
      flexWrap: 'wrap',
    }}>
      {children}
    </div>
  );
}

function InfoItem({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  return (
    <span style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
      <span style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'Inter, sans-serif', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
        {label}
      </span>
      <span className="tabular-nums" style={{
        fontSize: 11,
        color: 'var(--text-secondary)',
        fontFamily: mono ? 'JetBrains Mono, monospace' : 'Inter, sans-serif',
        fontWeight: 600,
      }}>
        {value}
      </span>
    </span>
  );
}

export function ValidationLayers({ symbol, layers, ivRank, netLiq, openPositions, maxPositions }: Props) {
  const sizingMax = netLiq != null ? Math.min(netLiq * 0.02, 10000) : null;

  const emDetail = layers.expectedMove != null
    ? `±${fmtPrice(layers.expectedMove, 1)}`
    : '—';


  return (
    <div style={{
      padding: '10px 12px 12px',
      height: '100%',
      overflowY: 'auto',
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
    }}>
      {/* Title */}
      <div style={{
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: 'var(--text-muted)',
        fontFamily: 'Inter, sans-serif',
        paddingBottom: 6,
        borderBottom: '1px solid var(--border-dark)',
      }}>
        {symbol} · Capas de validación
      </div>

      {/* ── Grid Capa 1: 3 columnas × 2 filas ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 5 }}>
        {/* Row 1 */}
        <MetricCell
          label="IV Rank"
          value={ivRank != null ? `${ivRank.toFixed(0)}` : '—'}
          sub={layers.ivRankOk === null ? 'sin datos' : layers.ivRankOk ? '25–65 ✓' : '25–65 ✗'}
          ok={layers.ivRankOk}
        />
        <MetricCell
          label="GEX"
          value={layers.gexValue != null ? fmtGex(layers.gexValue) : '—'}
          sub={layers.gexOk === null ? 'sin datos' : layers.gexOk ? '≥$100B ✓' : '≥$100B ✗'}
          ok={layers.gexOk}
        />
        <MetricCell
          label="VIX TS"
          value={layers.vixTermStructureOk === null ? '—' : layers.vixTermStructureOk ? 'OK' : 'INV'}
          sub={layers.vixTermStructureOk === null ? 'esperando' : layers.vixTermStructureOk ? '9D < 3M ✓' : '9D > 3M ✗'}
          ok={layers.vixTermStructureOk}
        />

        {/* Row 2 */}
        <MetricCell
          label="ZGL"
          value={layers.zglValue != null ? fmtPrice(layers.zglValue, 0) : '—'}
          sub="Gamma Zero"
          ok={null}
        />
        <MetricCell
          label="Spot > ZGL"
          value={layers.spotAboveZgl === null ? '—' : layers.spotAboveZgl ? 'SÍ' : 'NO'}
          sub={layers.spotAboveZgl === null ? 'sin datos' : layers.spotAboveZgl ? 'encima ✓' : 'abajo ✗'}
          ok={layers.spotAboveZgl}
        />
        <MetricCell
          label="Señal"
          value={layers.signal}
          sub={layers.signal === 'OPERAR' ? 'todos OK' : layers.signal === 'ESPERAR' ? 'parcial' : 'no ok'}
          ok={layers.signal === 'OPERAR' ? true : layers.signal === 'ESPERAR' ? null : false}
        />
      </div>

      {/* ── Motor de Strikes (línea horizontal) ── */}
      <InfoLine>
        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase', color: '#a78bfa', fontFamily: 'Inter, sans-serif' }}>
          Motor de Strikes
        </span>
        <InfoItem label="EM" value={emDetail !== '—' ? `${emDetail} pts` : '—'} />
        <InfoItem label="Call Wall" value={layers.callWall != null ? fmtPrice(layers.callWall, 0) : '—'} />
        <InfoItem label="Put Wall"  value={layers.putWall  != null ? fmtPrice(layers.putWall,  0) : '—'} />
      </InfoLine>

      {/* ── Microestructura (línea horizontal, si hay datos) ── */}
      {layers.atmStrike != null && (
        <InfoLine>
          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase', color: 'var(--yellow-gc)', fontFamily: 'Inter, sans-serif' }}>
            Microestructura
          </span>
          <InfoItem label="ATM" value={fmtPrice(layers.atmStrike, 0)} />
          {layers.atmCallOI != null && (
            <InfoItem label="OI Calls" value={layers.atmCallOI >= 1000 ? `${(layers.atmCallOI / 1000).toFixed(1)}k` : `${layers.atmCallOI}`} />
          )}
          {layers.atmPutOI != null && (
            <InfoItem label="OI Puts"  value={layers.atmPutOI >= 1000  ? `${(layers.atmPutOI  / 1000).toFixed(1)}k` : `${layers.atmPutOI}`} />
          )}
          {layers.atmCallDelta != null && (
            <InfoItem label="Δ" value={layers.atmCallDelta.toFixed(2)} />
          )}
        </InfoLine>
      )}

      {/* ── Sizing (línea horizontal) ── */}
      <InfoLine>
        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase', color: 'var(--green)', fontFamily: 'Inter, sans-serif' }}>
          Sizing
        </span>
        <InfoItem
          label="2% Net Liq"
          value={sizingMax != null ? `$${sizingMax.toLocaleString('en-US', { maximumFractionDigits: 0 })} máx` : '—'}
        />
        <InfoItem
          label="Posiciones"
          value={`${openPositions} / ${maxPositions}`}
        />
      </InfoLine>
    </div>
  );
}

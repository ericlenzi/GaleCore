import React, { useState } from 'react';
import { LayerStatus } from '../../types/market';
import { ValidationLayerApiResponse } from '../../types/api';
import { fmtPrice, fmtGex, signalColor } from '../../utils/formatters';

interface Props {
  symbol: string;
  layers: LayerStatus;
  vlData: ValidationLayerApiResponse | null;
}

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

interface TooltipRow { label: string; value: string }

interface MetricCellProps {
  label: string;
  value: string;
  sub: string;
  ok: boolean | null;
  tooltip?: TooltipRow[];
}

function MetricCell({ label, value, sub, ok, tooltip }: MetricCellProps) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const valueColor = ok === null ? 'var(--text-secondary)' : ok ? 'var(--green)' : 'var(--red-gc)';

  const handleEnter = (e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setPos({ x: rect.left + rect.width / 2, y: rect.bottom + 6 });
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        padding: '7px 8px',
        gap: 2,
        backgroundColor: 'var(--bg-tertiary)',
        borderRadius: 6,
        minWidth: 0,
        cursor: tooltip ? 'help' : undefined,
      }}
      onMouseEnter={tooltip ? handleEnter : undefined}
      onMouseLeave={tooltip ? () => setPos(null) : undefined}
    >
      {pos && tooltip && (
        <div style={{
          position: 'fixed',
          top: pos.y,
          left: pos.x,
          transform: 'translateX(-50%)',
          padding: '6px 10px',
          backgroundColor: 'var(--bg-primary)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
          zIndex: 9999,
          whiteSpace: 'nowrap',
          display: 'flex',
          flexDirection: 'column',
          gap: 3,
          pointerEvents: 'none',
        }}>
          {tooltip.map((r) => (
            <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <span style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'Inter, sans-serif', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                {r.label}
              </span>
              <span className="tabular-nums" style={{ fontSize: 10, color: 'var(--text-primary)', fontFamily: 'JetBrains Mono, monospace', fontWeight: 600 }}>
                {r.value}
              </span>
            </div>
          ))}
        </div>
      )}
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

const structureLabels: Record<string, string> = {
  iron_condor: 'IC',
  put_credit_spread: 'PCS',
  call_credit_spread: 'CCS',
};

function fmtOI(v: number): string {
  return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${v}`;
}

export function ValidationLayers({ symbol, layers, vlData }: Props) {
  const l1 = vlData?.layer1;
  const l2 = vlData?.layer2;
  const l3 = vlData?.layer3;
  const l4 = vlData?.layer4;

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
        {symbol} · Validations Layer
      </div>

      {/* ── Grid Capa 1: 4 checks + señal ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 5 }}>
        <MetricCell
          label="IV Rank"
          value={layers.ivRankValue != null ? `${layers.ivRankValue.toFixed(0)}` : '—'}
          sub={layers.ivRankOk === null ? '—' : layers.ivRankOk ? '25–65 ✓' : '25–65 ✗'}
          ok={layers.ivRankOk}
          tooltip={l1?.ivRank ? [
            { label: 'Value', value: l1.ivRank.value.toFixed(2) },
            { label: 'Range', value: `${l1.ivRank.min} – ${l1.ivRank.max}` },
          ] : undefined}
        />
        <MetricCell
          label="GEX"
          value={layers.gexValue != null ? fmtGex(layers.gexValue) : '—'}
          sub={layers.gexOk === null ? '—' : layers.gexOk ? `≥threshold ✓` : `<threshold ✗`}
          ok={layers.gexOk}
        />
        <MetricCell
          label="VIX TS"
          value={layers.vixTermStructureOk === null ? '—' : layers.vixTermStructureOk ? 'OK' : 'INV'}
          sub={layers.vixTermStructureOk === null ? '—' : layers.vixTermStructureOk ? '9D < 3M ✓' : '9D > 3M ✗'}
          ok={layers.vixTermStructureOk}
          tooltip={l1?.vixTermStructure ? [
            { label: 'IV 9D', value: l1.vixTermStructure.iV30_9d?.toFixed(2) ?? '—' },
            { label: 'IV 3M', value: l1.vixTermStructure.iV30_90d?.toFixed(2) ?? '—' },
          ] : undefined}
        />
        <MetricCell
          label="IV Momentum"
          value={layers.ivMomentumValue != null ? `${layers.ivMomentumValue.toFixed(1)}%` : '—'}
          sub={layers.ivMomentumOk === null ? '—' : layers.ivMomentumOk ? '≤12% ✓' : '>12% ✗'}
          ok={layers.ivMomentumOk}
          tooltip={l1?.ivMomentum ? [
            { label: 'ROC 5d', value: l1.ivMomentum.value != null ? `${l1.ivMomentum.value.toFixed(2)}%` : '—' },
            { label: 'Threshold', value: `≤ ${l1.ivMomentum.threshold}%` },
          ] : undefined}
        />
        <MetricCell
          label="Spot > ZGL"
          value={layers.spotAboveZgl === null ? '—' : layers.spotAboveZgl ? 'YES' : 'NO'}
          sub={layers.spotAboveZgl === null ? '—' : layers.spotAboveZgl ? 'above ✓' : 'below ✗'}
          ok={layers.spotAboveZgl}
        />
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          padding: '7px 8px',
          gap: 4,
          backgroundColor: 'var(--bg-tertiary)',
          borderRadius: 6,
        }}>
          <span style={{
            fontSize: 8.5, fontWeight: 600, letterSpacing: '0.09em',
            textTransform: 'uppercase', color: 'var(--text-muted)', fontFamily: 'Inter, sans-serif',
          }}>
            Signal
          </span>
          <span
            style={{
              fontSize: 11, fontWeight: 700, letterSpacing: '0.06em',
              padding: '3px 10px', borderRadius: 4, textTransform: 'uppercase',
              fontFamily: 'JetBrains Mono, monospace', whiteSpace: 'nowrap',
              color: signalColor(layers.signal),
              backgroundColor: signalColor(layers.signal) + '22',
              border: `1px solid ${signalColor(layers.signal)}44`,
              alignSelf: 'flex-start',
            }}
          >
            {layers.signal}
          </span>
        </div>
      </div>

      {/* ── Motor de Strikes ── */}
      <div style={{
        backgroundColor: 'var(--bg-tertiary)',
        borderRadius: 6,
        padding: '8px 10px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}>
        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase', color: '#a78bfa', fontFamily: 'Inter, sans-serif' }}>
          Strikes Engine
        </span>
        <ListRow label="ZGL" value={layers.zglValue != null ? fmtPrice(layers.zglValue, 0) : '—'} />
        <ListRow label="Call Wall" value={layers.callWall != null ? fmtPrice(layers.callWall, 0) : '—'} />
        <ListRow label="Put Wall" value={layers.putWall != null ? fmtPrice(layers.putWall, 0) : '—'} />
        {l2 && (
          <>
            <ListRow label="Z-Score" value={l2.zScore.toFixed(2)} />
            <ListRow label="Estructura" value={structureLabels[l2.selectedStructure] ?? l2.selectedStructure} />
            {l2.shortPutStrike != null && (
              <ListRow label="Short Put" value={`${fmtPrice(l2.shortPutStrike, 0)} (Δ${l2.shortPutDelta?.toFixed(2) ?? '?'})`} />
            )}
            {l2.shortCallStrike != null && (
              <ListRow label="Short Call" value={`${fmtPrice(l2.shortCallStrike, 0)} (Δ${l2.shortCallDelta?.toFixed(2) ?? '?'})`} />
            )}
            <ListRow label="Dentro de muros" value={l2.strikesInsideWalls ? '✓' : '✗'} />
          </>
        )}
        <ListRow label="Expected Move" value={emDetail !== '—' ? `${emDetail} pts` : '—'} />
      </div>

      {/* ── Microestructura ── */}
      {l3 && (
        <div style={{
          backgroundColor: 'var(--bg-tertiary)',
          borderRadius: 6,
          padding: '8px 10px',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}>
          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase', color: 'var(--yellow-gc)', fontFamily: 'Inter, sans-serif' }}>
            Microstructure
          </span>
          <ListRow label="ATM Strike" value={fmtPrice(l3.atmStrike, 0)} />
          <ListRow label="Call OI" value={fmtOI(l3.shortCallOI.value)} />
          <ListRow label="Put OI" value={fmtOI(l3.shortPutOI.value)} />
          {l3.atmCallDelta != null && (
            <ListRow label="ATM Delta" value={l3.atmCallDelta.toFixed(2)} />
          )}
        </div>
      )}

      {/* ── Sizing ── */}
      <div style={{
        backgroundColor: 'var(--bg-tertiary)',
        borderRadius: 6,
        padding: '8px 10px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}>
        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase', color: 'var(--green)', fontFamily: 'Inter, sans-serif' }}>
          Sizing
        </span>
        {l4 ? (
          <>
            <ListRow label="Máx riesgo" value={`$${l4.maxRiskAmount.toLocaleString('en-US', { maximumFractionDigits: 0 })}`} />
            <ListRow label="Positions" value={`${l4.openPositions} / ${l4.maxPositions}`} />
            <ListRow label="Heat" value={`${l4.currentHeatPct.toFixed(1)}% / ${l4.maxHeatPct.toFixed(1)}%`} />
          </>
        ) : (
          <>
            <ListRow label="Máx riesgo" value="—" />
            <ListRow label="Positions" value="—" />
          </>
        )}
      </div>
    </div>
  );
}

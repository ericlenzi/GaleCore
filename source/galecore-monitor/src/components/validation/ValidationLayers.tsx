import React, { useState } from 'react';
import { LayerStatus } from '../../types/market';
import { ValidationLayerApiResponse } from '../../types/api';
import { fmtGex } from '../../utils/formatters';

interface Props {
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


export function ValidationLayers({ layers, vlData }: Props) {
  const checks = vlData?.macroRegime?.checks;

  return (
    <div style={{
      padding: '10px 12px 12px',
      height: '100%',
      overflowY: 'auto',
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
    }}>
      {/* Title — mismo formato que Diagnóstico de mercado (título violeta + descripción) */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase', color: '#a78bfa', fontFamily: 'Inter, sans-serif' }}>
          Capa de Validaciones
        </span>
        <span style={{ fontSize: 8.5, color: 'var(--text-muted)', fontFamily: 'Inter, sans-serif', marginBottom: 4, lineHeight: 1.3 }}>
          Régimen macro de la cascada (capa 1) — si falla, no se evalúa nada más.
        </span>
      </div>

      {/* ── Grid Capa 1: 6 checks + señal ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 5 }}>
        <MetricCell
          label="VIX"
          value={layers.vixAbsoluteValue != null ? layers.vixAbsoluteValue.toFixed(1) : '—'}
          sub={layers.vixAbsoluteOk === null ? '—' : layers.vixAbsoluteOk ? `<${checks?.vixAbsolute?.threshold ?? 30} ✓` : `≥${checks?.vixAbsolute?.threshold ?? 30} ✗`}
          ok={layers.vixAbsoluteOk}
          tooltip={checks?.vixAbsolute ? [
            { label: 'Value', value: checks.vixAbsolute.value?.toFixed(2) ?? '—' },
            { label: 'Max', value: `< ${checks.vixAbsolute.threshold}` },
          ] : undefined}
        />
        <MetricCell
          label="VIX TS"
          value={layers.vixTermStructureOk === null ? '—' : layers.vixTermStructureOk ? 'OK' : 'INV'}
          sub={layers.vixTermStructureOk === null ? '—' : layers.vixTermStructureOk ? '9D < 30D ✓' : '9D > 30D ✗'}
          ok={layers.vixTermStructureOk}
          tooltip={checks?.vixTermStructure ? [
            { label: 'IV 9D', value: checks.vixTermStructure.iv9d?.toFixed(2) ?? '—' },
            { label: 'IV 30D', value: checks.vixTermStructure.iv30d?.toFixed(2) ?? '—' },
          ] : undefined}
        />
        <MetricCell
          label="IV Rank"
          value={layers.ivRankValue != null ? `${layers.ivRankValue.toFixed(0)}` : '—'}
          sub={layers.ivRankOk === null ? '—' : layers.ivRankOk ? '25–65 ✓' : '25–65 ✗'}
          ok={layers.ivRankOk}
          tooltip={checks?.ivRank ? [
            { label: 'Value', value: checks.ivRank.value.toFixed(2) },
            { label: 'Range', value: `${checks.ivRank.min} – ${checks.ivRank.max}` },
          ] : undefined}
        />
        <MetricCell
          label="IV Momentum"
          value={layers.ivMomentumValue != null ? `${layers.ivMomentumValue.toFixed(1)}%` : '—'}
          sub={layers.ivMomentumOk === null ? '—' : layers.ivMomentumOk ? '≤12% ✓' : '>12% ✗'}
          ok={layers.ivMomentumOk}
          tooltip={checks?.ivMomentum ? [
            { label: 'ROC 5d', value: checks.ivMomentum.value != null ? `${checks.ivMomentum.value.toFixed(2)}%` : '—' },
            { label: 'Threshold', value: `≤ ${checks.ivMomentum.threshold}%` },
          ] : undefined}
        />
        <MetricCell
          label="GEX"
          value={layers.gexValue != null ? fmtGex(layers.gexValue) : '—'}
          sub={layers.gexOk === null ? '—' : layers.gexOk ? `≥threshold ✓` : `<threshold ✗`}
          ok={layers.gexOk}
          tooltip={checks?.gexTotal ? [
            { label: 'Value', value: `${checks.gexTotal.value.toFixed(1)}B` },
            { label: 'Min', value: `≥ ${checks.gexTotal.threshold}B` },
          ] : undefined}
        />
        <MetricCell
          label="Spot > ZGL"
          value={layers.spotAboveZgl === null ? '—' : layers.spotAboveZgl ? 'YES' : 'NO'}
          sub={layers.spotAboveZgl === null ? '—' : layers.spotAboveZgl ? 'above ✓' : 'below ✗'}
          ok={layers.spotAboveZgl}
          tooltip={checks?.spotVsZgl ? [
            { label: 'Spot', value: checks.spotVsZgl.spot.toFixed(2) },
            { label: 'ZGL', value: checks.spotVsZgl.zgl?.toFixed(2) ?? '—' },
            { label: 'Buffer', value: `${(checks.spotVsZgl.bufferPct * 100).toFixed(1)}%` },
          ] : undefined}
        />
      </div>

    </div>
  );
}

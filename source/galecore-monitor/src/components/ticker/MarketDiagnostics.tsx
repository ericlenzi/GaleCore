import React from 'react';
import { StructureInputs } from '../../types/api';

/**
 * Diagnóstico de mercado: los factores del motor de selección de estructura multi-factor
 * (z-score direccional, skew de GEX, tendencia EMA, régimen de RV).
 *
 * IMPORTANTE: el motor está `enabled:false` (forzado a PCS), así que estos factores NO dirigen
 * la estructura hoy — son contexto de mercado. Fuente: PositionBuilder.structureInputs
 * (macro-independiente → disponibles aunque la cascada corte en macro).
 */

function Row({ label, value, detail, muted }: { label: string; value: React.ReactNode; detail?: string; muted?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1, padding: '5px 0', borderBottom: '1px solid var(--border-dark)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 10.5, color: 'var(--text-secondary)', fontFamily: 'Inter, sans-serif' }}>{label}</span>
        <span className="tabular-nums" style={{ fontSize: 11, fontWeight: 600, color: muted ? 'var(--text-muted)' : 'var(--text-primary)', fontFamily: 'JetBrains Mono, monospace' }}>{value}</span>
      </div>
      {detail && <span style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'Inter, sans-serif' }}>{detail}</span>}
    </div>
  );
}

export function MarketDiagnostics({ inputs }: { inputs: StructureInputs | null }) {
  const n = (v: number | null | undefined, d = 2) => (v == null ? '—' : v.toFixed(d));

  return (
    <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase', color: '#a78bfa', fontFamily: 'Inter, sans-serif' }}>
        Diagnóstico de mercado
      </span>
      <span style={{ fontSize: 8.5, color: 'var(--text-muted)', fontFamily: 'Inter, sans-serif', marginBottom: 4, lineHeight: 1.3 }}>
        Motor multi-factor OFF (forzado PCS) — contexto, no dirige la estructura.
      </span>

      {!inputs
        ? <span style={{ fontSize: 10, color: 'var(--text-muted)', padding: '6px 0' }}>Sin datos del motor.</span>
        : <>
            <Row
              label="z-score direccional"
              value={n(inputs.priceZScore?.value)}
              detail={inputs.priceZScore?.interpretation}
            />
            <Row
              label="GEX skew"
              value={inputs.gexSign?.value ?? '—'}
              detail={`ratio ${n(inputs.gexSign?.skewRatio)} · ${inputs.gexSign?.interpretation ?? ''}`}
            />
            <Row
              label="Trend EMA"
              value={inputs.trend?.signal ?? '—'}
              detail={inputs.trend?.ema20 != null && inputs.trend?.ema50 != null
                ? `EMA20 ${n(inputs.trend.ema20, 1)} / EMA50 ${n(inputs.trend.ema50, 1)}`
                : inputs.trend?.interpretation}
            />
            <Row
              label="RV régimen"
              value={inputs.realizedVolRegime?.signal ?? '—'}
              detail={inputs.realizedVolRegime?.rv10d != null && inputs.realizedVolRegime?.rv30d != null
                ? `RV10 ${n(inputs.realizedVolRegime.rv10d, 1)} / RV30 ${n(inputs.realizedVolRegime.rv30d, 1)}`
                : inputs.realizedVolRegime?.interpretation}
            />
          </>}
    </div>
  );
}

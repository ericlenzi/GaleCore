import React from 'react';
import { useValidationStore } from '../../store/useValidationStore';
import { mapValidationToLayers, EMPTY_LAYERS } from '../../utils/validationLayers';
import { fmtPrice } from '../../utils/formatters';

const structureLabels: Record<string, string> = {
  iron_condor: 'IC',
  put_credit_spread: 'PCS',
  call_credit_spread: 'CCS',
};

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

interface Props {
  symbol: string;
}

// Panel del motor de strikes (ZGL, muros, estructura, shorts, EM). Va junto al gráfico gamma
// porque es la lectura numérica de lo que el gráfico dibuja. Lee del useValidationStore.
export function StrikesEnginePanel({ symbol }: Props) {
  const cached = useValidationStore((s) => s.cache[symbol]);
  const vlData = cached?.vlData ?? null;
  const layers = vlData ? mapValidationToLayers(vlData) : EMPTY_LAYERS;
  const l2 = vlData?.positionBuilder?.strikeEngine;

  // EM: strikeEngine lo calcula, pero si no corrió se puede derivar de spot, dte (gexData) + ivAtm (structureInputs).
  const si = cached?.structureInputs;
  const gex = cached?.vlData?.gexData;
  let em = layers.expectedMove;
  if (em == null && gex && gex.spot > 0 && gex.dte > 0 && si?.priceZScore?.ivAtm) {
    em = gex.spot * si.priceZScore.ivAtm * Math.sqrt(gex.dte / 365);
  }
  const emDetail = em != null ? `±${fmtPrice(em, 1)}` : '—';

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
        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase', color: '#a78bfa', fontFamily: 'Inter, sans-serif' }}>
          Strikes Engine
        </span>
        <ListRow label="ZGL" value={layers.zglValue != null ? fmtPrice(layers.zglValue, 0) : '—'} />
        <ListRow label="Call Wall" value={layers.callWall != null ? fmtPrice(layers.callWall, 0) : '—'} />
        <ListRow label="Put Wall" value={layers.putWall != null ? fmtPrice(layers.putWall, 0) : '—'} />
        <ListRow label="Estructura" value={l2 ? (structureLabels[l2.selectedStructure] ?? l2.selectedStructure) : '—'} />
        <ListRow label="Short Put" value={l2?.shortPutStrike != null ? `${fmtPrice(l2.shortPutStrike, 0)} (Δ${l2.shortPutDelta?.toFixed(2) ?? '?'})` : '—'} />
        <ListRow label="Short Call" value={l2?.shortCallStrike != null ? `${fmtPrice(l2.shortCallStrike, 0)} (Δ${l2.shortCallDelta?.toFixed(2) ?? '?'})` : '—'} />
        <ListRow label="Dentro de muros" value={l2 ? (l2.strikesInsideWalls ? '✓' : '✗') : '—'} />
        <ListRow label="Expected Move" value={emDetail !== '—' ? `${emDetail} pts` : '—'} />
      </div>
    </div>
  );
}

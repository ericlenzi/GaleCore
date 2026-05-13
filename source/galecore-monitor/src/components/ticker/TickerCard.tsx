import React from 'react';
import { TickerState, SignalType, LayerStatus } from '../../types/market';
import { fmtPrice, fmtPct, calcChange, fmtTime, isStale, fmtGex } from '../../utils/formatters';

interface Props {
  ticker: TickerState;
  layers: LayerStatus;
  selected: boolean;
  onClick: () => void;
}

function SignalBadge({ signal }: { signal: SignalType }) {
  const cfg =
    signal === 'OPERAR'    ? { color: '#22c55e', bg: 'var(--green-muted)',  border: 'var(--green-border)'  } :
    signal === 'ESPERAR'   ? { color: '#f59e0b', bg: 'var(--yellow-muted)', border: 'var(--yellow-border)' } :
                             { color: '#f43f5e', bg: 'var(--red-muted)',    border: 'var(--red-border)'    };
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, letterSpacing: '0.08em',
      padding: '3px 8px', borderRadius: 20,
      color: cfg.color, backgroundColor: cfg.bg, border: `1px solid ${cfg.border}`,
      fontFamily: 'JetBrains Mono, monospace', whiteSpace: 'nowrap', lineHeight: 1.4,
    }}>
      {signal}
    </span>
  );
}

function LayerRow({ label, ok, value }: { label: string; ok: boolean | null; value: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
      <span style={{
        width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
        backgroundColor: ok === null ? 'transparent' : ok ? 'var(--green)' : 'var(--red-gc)',
        border: ok === null ? '1px solid var(--text-muted)' : 'none',
      }} />
      <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>{label}</span>
      <span style={{ color: 'var(--text-secondary)', fontFamily: 'JetBrains Mono, monospace', marginLeft: 'auto', fontSize: 10 }} className="tabular-nums">
        {value}
      </span>
    </div>
  );
}

export function TickerCard({ ticker, layers, selected, onClick }: Props) {
  // Use prevClose as change basis (like TradingView); fallback to open
  const basis      = ticker.prevClose && ticker.prevClose > 0 ? ticker.prevClose : ticker.open;
  const { abs: changeAbs, pct: changePct } = calcChange(ticker.price, basis);
  const positive   = changeAbs >= 0;
  const changeColor = positive ? 'var(--green)' : 'var(--red-gc)';
  const stale      = isStale(ticker.lastUpdate);
  const hasPrice   = ticker.price > 0;

  return (
    <button
      onClick={onClick}
      className="w-full text-left card-interactive"
      style={{
        backgroundColor: selected ? 'var(--bg-tertiary)' : 'var(--bg-secondary)',
        border: `1px solid ${selected ? 'var(--blue-gc)' : 'var(--border)'}`,
        boxShadow: selected ? 'var(--shadow-glow-blue)' : 'var(--shadow-sm)',
        borderRadius: 10,
        padding: '14px 16px',
        minWidth: 210,
        display: 'block',
      }}
    >
      {/* Symbol + Signal */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ color: 'var(--text-primary)', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, fontSize: 13, letterSpacing: '0.05em' }}>
          {ticker.symbol}
        </span>
        <SignalBadge signal={layers.signal} />
      </div>

      {/* Price + change */}
      {hasPrice ? (
        <div style={{ marginBottom: 12 }}>
          <div className="flex items-center justify-between">
            <div className="tabular-nums" style={{
              fontSize: 24, fontWeight: 700,
              color: 'var(--text-primary)',
              fontFamily: 'JetBrains Mono, monospace',
              lineHeight: 1.1,
              letterSpacing: '-0.02em',
            }}>
              {fmtPrice(ticker.price)}
            </div>
            {ticker.extendedTradingHours != null && (
              <div className="flex items-center gap-1" style={{ fontSize: 9, fontFamily: 'JetBrains Mono, monospace' }}>
                <span style={{
                  width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                  backgroundColor: !ticker.extendedTradingHours ? 'var(--green)' : 'var(--text-muted)',
                  boxShadow: !ticker.extendedTradingHours ? '0 0 4px var(--green)' : 'none',
                }} />
                <span style={{ color: 'var(--text-muted)', textAlign: 'center' }}>
                  {!ticker.extendedTradingHours ? 'open' : 'closed'}
                </span>
              </div>
            )}
          </div>
          <div className="tabular-nums" style={{ fontSize: 12, fontWeight: 500, color: changeColor, fontFamily: 'JetBrains Mono, monospace', marginTop: 2 }}>
            {positive ? '+' : ''}{fmtPrice(changeAbs, 2)}{' '}
            <span style={{ opacity: 0.85 }}>({fmtPct(changePct)})</span>
          </div>
          {/* Bid / Ask / Volume */}
          <div className="flex items-center gap-3 tabular-nums" style={{ marginTop: 5, fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}>
            <span>
              <span style={{ color: 'var(--text-muted)' }}>Bid </span>
              <span style={{ color: 'var(--blue-gc)' }}>
                {ticker.bid > 0 ? fmtPrice(ticker.bid, 2) : '—'}
              </span>
            </span>
            <span>
              <span style={{ color: 'var(--text-muted)' }}>Ask </span>
              <span style={{ color: 'var(--red-gc)' }}>
                {ticker.ask > 0 ? fmtPrice(ticker.ask, 2) : '—'}
              </span>
            </span>
            {ticker.volume != null && ticker.volume > 0 && (
              <span style={{ marginLeft: 'auto' }}>
                <span style={{ color: 'var(--text-muted)' }}>Vol </span>
                <span style={{ color: 'var(--text-secondary)' }}>{(ticker.volume / 1e6).toFixed(1)}M</span>
              </span>
            )}
          </div>
        </div>
      ) : (
        <div style={{ marginBottom: 12 }}>
          <div className="skeleton" style={{ height: 28, width: '60%', marginBottom: 4 }} />
          <div className="skeleton" style={{ height: 14, width: '38%' }} />
          <div className="skeleton" style={{ height: 12, width: '55%', marginTop: 5 }} />
        </div>
      )}

      {/* Divider */}
      <div style={{ borderTop: '1px solid var(--border-dark)', marginBottom: 10 }} />

      {/* Layer rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <LayerRow label="GEX"      ok={layers.gexOk}             value={layers.gexValue != null ? fmtGex(layers.gexValue) : '—'} />
        <LayerRow label="IV Rank"  ok={layers.ivRankOk}          value={ticker.ivRank != null ? `${ticker.ivRank.toFixed(0)}` : '—'} />
        <LayerRow label="Spot>ZGL" ok={layers.spotAboveZgl}      value={layers.zglValue != null ? fmtPrice(layers.zglValue, 0) : '—'} />
        <LayerRow label="VIX TS"   ok={layers.vixTermStructureOk} value={layers.vixTermStructureOk !== null ? (layers.vixTermStructureOk ? 'OK' : 'NO') : '—'} />
      </div>

      {/* Timestamp */}
      <div style={{ textAlign: 'right', marginTop: 10, fontSize: 9, fontFamily: 'JetBrains Mono, monospace', color: stale ? 'var(--yellow-gc)' : 'var(--text-muted)' }}>
        {ticker.lastUpdate ? fmtTime(ticker.lastUpdate) : 'Sin datos'}
        {!ticker.isStreaming && ticker.price > 0 && <span style={{ color: 'var(--yellow-gc)', marginLeft: 4 }}>⚠ REST</span>}
      </div>
    </button>
  );
}

import React, { useEffect, useRef } from 'react';
import { useMarketStore } from '../store/useMarketStore';
import { useRulesStore } from '../store/useRulesStore';
import { useAccountStore } from '../store/useAccountStore';
import { fetchMarketDataByType } from '../api/marketdata';
import { fetchIVRank, fetchImpliedVolatility } from '../api/analytics';
import { fmtPrice } from '../utils/formatters';
import { SignalType } from '../types/market';

// ── Score helpers ────────────────────────────────────────────────────────────

interface TickerScore {
  symbol: string;
  price: number;
  ivRank: number | null;
  iv30: number | null;
  ivRankOk: boolean | null;
  vixOk: boolean | null;
  score: number;        // 0–2 (3 when GEX also loaded)
  signal: SignalType;
  em: number | null;    // Expected move in points (using rules DTE ideal)
  suggestedPut: number | null;
  suggestedCall: number | null;
}

function computeScore(
  symbol: string,
  price: number,
  ivRank: number | null,
  iv30: number | null,
  vix9d: number | null,
  vix3m: number | null,
  ivRankMin: number,
  ivRankMax: number,
  dteIdeal: number,
): TickerScore {
  const ivRankOk = ivRank != null ? ivRank >= ivRankMin && ivRank <= ivRankMax : null;
  const vixOk    = vix9d != null && vix3m != null ? vix9d < vix3m : null;

  let score = 0;
  if (ivRankOk === true) score++;
  if (vixOk === true) score++;

  const totalChecks = [ivRankOk, vixOk].filter(v => v !== null).length;
  const passed      = [ivRankOk, vixOk].filter(v => v === true).length;

  const signal: SignalType =
    totalChecks === 0 ? 'NO OPERAR' :
    passed === totalChecks && totalChecks === 2 ? 'ESPERAR' :
    'NO OPERAR';

  // Expected Move  (needs GEX DTE — use rules ideal DTE as approximation)
  let em: number | null = null;
  let suggestedPut: number | null = null;
  let suggestedCall: number | null = null;
  if (iv30 && iv30 > 0 && price > 0 && dteIdeal > 0) {
    em = price * (iv30 / 100) * Math.sqrt(dteIdeal / 365);
    suggestedPut  = Math.round((price - em) / 5) * 5; // round to $5
    suggestedCall = Math.round((price + em) / 5) * 5;
  }

  return { symbol, price, ivRank, iv30, ivRankOk, vixOk, score, signal, em, suggestedPut, suggestedCall };
}

// ── Sub-components ───────────────────────────────────────────────────────────

function SignalPill({ signal }: { signal: SignalType }) {
  const color =
    signal === 'OPERAR'   ? '#22c55e' :
    signal === 'ESPERAR'  ? '#f59e0b' :
                            '#f43f5e';
  const bg =
    signal === 'OPERAR'   ? 'rgba(34,197,94,0.12)' :
    signal === 'ESPERAR'  ? 'rgba(245,158,11,0.12)' :
                            'rgba(244,63,94,0.12)';
  return (
    <span style={{
      fontSize: 8.5, fontWeight: 700, letterSpacing: '0.08em',
      padding: '2px 7px', borderRadius: 20,
      color, backgroundColor: bg, border: `1px solid ${color}40`,
      fontFamily: 'JetBrains Mono, monospace', whiteSpace: 'nowrap',
    }}>
      {signal}
    </span>
  );
}

function ScoreDots({ score, total = 2 }: { score: number; total?: number }) {
  return (
    <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
      {Array.from({ length: total }).map((_, i) => (
        <span key={i} style={{
          width: 7, height: 7, borderRadius: '50%',
          backgroundColor: i < score ? '#22c55e' : 'var(--border)',
          boxShadow: i < score ? '0 0 4px rgba(34,197,94,0.5)' : 'none',
        }} />
      ))}
    </div>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th style={{
      padding: '8px 12px',
      fontSize: 8.5,
      fontWeight: 700,
      letterSpacing: '0.1em',
      textTransform: 'uppercase',
      color: 'var(--text-muted)',
      textAlign: right ? 'right' : 'left',
      fontFamily: 'Inter, sans-serif',
      whiteSpace: 'nowrap',
      borderBottom: '1px solid var(--border-dark)',
      backgroundColor: 'var(--bg-secondary)',
    }}>
      {children}
    </th>
  );
}

function Td({ children, right, mono = false }: { children: React.ReactNode; right?: boolean; mono?: boolean }) {
  return (
    <td style={{
      padding: '10px 12px',
      fontSize: 12,
      color: 'var(--text-secondary)',
      textAlign: right ? 'right' : 'left',
      fontFamily: mono ? 'JetBrains Mono, monospace' : 'Inter, sans-serif',
      fontVariantNumeric: 'tabular-nums',
      borderBottom: '1px solid var(--border-dark)',
      whiteSpace: 'nowrap',
    }}>
      {children}
    </td>
  );
}

function OkValue({ ok, value }: { ok: boolean | null; value: string }) {
  const color = ok === null ? 'var(--text-muted)' : ok ? '#22c55e' : '#f43f5e';
  return (
    <span style={{ color, fontFamily: 'JetBrains Mono, monospace', fontVariantNumeric: 'tabular-nums' }}>
      {value}
    </span>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export function PortfolioManager() {
  const { tickers: symbols = [], rules } = useRulesStore();
  const marketStore  = useMarketStore();
  const { balances } = useAccountStore();

  const ivRankMin  = rules?.options_filters?.iv_rank?.min ?? 25;
  const ivRankMax  = rules?.options_filters?.iv_rank?.max ?? 65;
  const dteIdeal   = rules?.trade_construction?.dte_target?.ideal ?? 35;
  const maxConc    = rules?.risk_limits?.max_concurrent_positions ?? 3;
  const riskPct    = rules?.risk_limits?.risk_per_trade_pct ?? 0.02;
  const riskMaxUsd = rules?.risk_limits?.risk_per_trade_usd_max ?? 10000;

  const netLiq     = balances?.netLiquidatingValue ?? null;
  const riskAmount = netLiq != null
    ? Math.min(netLiq * riskPct, riskMaxUsd)
    : null;

  const { tickers, vix9d, vix3m, setIVRank, setIV, setOpen, updatePrice } = marketStore;
  const loadedRef = useRef<Set<string>>(new Set());

  // Load data for all tickers on mount (may already be loaded by TickerGrid)
  useEffect(() => {
    symbols.forEach(symbol => {
      if (loadedRef.current.has(symbol)) return;
      loadedRef.current.add(symbol);

      // Market data (price, open, prevClose)
      fetchMarketDataByType(symbol)
        .then(d => {
          setOpen(symbol, d.open, d.prevClose, d.volume);
          const t = useMarketStore.getState().tickers[symbol];
          if (!t?.price) {
            updatePrice(symbol, { price: d.last, size: 0, timestamp: new Date().toISOString() });
          }
        })
        .catch(() => {});

      // IV Rank
      fetchIVRank(symbol)
        .then(d => setIVRank(symbol, d.ivRank))
        .catch(() => {});

      // IV
      fetchImpliedVolatility(symbol)
        .then(d => setIV(symbol, d.iv30, d.iv9d, d.iv3m))
        .catch(() => {});
    });
  }, [symbols.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  // Build scored list
  const scored: TickerScore[] = symbols.map(symbol => {
    const t = tickers[symbol];
    return computeScore(
      symbol,
      t?.price ?? 0,
      t?.ivRank ?? null,
      t?.iv30 ?? null,
      vix9d, vix3m,
      ivRankMin, ivRankMax,
      dteIdeal,
    );
  });

  // Sort by score descending, then by IVRank descending
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (b.ivRank ?? 0) - (a.ivRank ?? 0);
  });

  const vixStatusColor = vix9d != null && vix3m != null
    ? (vix9d < vix3m ? '#22c55e' : '#f43f5e')
    : 'var(--text-muted)';

  return (
    <div style={{ padding: '16px 20px', minHeight: '100%', backgroundColor: 'var(--bg-primary)' }}>
      {/* Header */}
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'Inter, sans-serif', margin: 0 }}>
            Portfolio Manager
          </h2>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '2px 0 0', fontFamily: 'Inter, sans-serif' }}>
            Análisis de setup por ticker · DTE objetivo {dteIdeal}d
          </p>
        </div>

        {/* Context pills */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 10, fontFamily: 'JetBrains Mono, monospace', padding: '3px 10px', borderRadius: 20, backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-dark)', color: 'var(--text-secondary)' }}>
            IVR {ivRankMin}–{ivRankMax}
          </span>
          <span style={{
            fontSize: 10, fontFamily: 'JetBrains Mono, monospace',
            padding: '3px 10px', borderRadius: 20,
            backgroundColor: 'var(--bg-secondary)',
            border: `1px solid ${vixStatusColor}40`,
            color: vixStatusColor,
          }}>
            VIX9D {vix9d != null ? vix9d.toFixed(1) : '—'} / VIX3M {vix3m != null ? vix3m.toFixed(1) : '—'}
          </span>
          {netLiq != null && (
            <span style={{ fontSize: 10, fontFamily: 'JetBrains Mono, monospace', padding: '3px 10px', borderRadius: 20, backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-dark)', color: 'var(--text-secondary)' }}>
              Risk/trade: ${riskAmount?.toLocaleString('en-US', { maximumFractionDigits: 0 }) ?? '—'}
            </span>
          )}
          <span style={{ fontSize: 10, fontFamily: 'JetBrains Mono, monospace', padding: '3px 10px', borderRadius: 20, backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-dark)', color: 'var(--text-secondary)' }}>
            Máx {maxConc} posiciones
          </span>
        </div>
      </div>

      {/* Table */}
      <div style={{ borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border-dark)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <Th>Ticker</Th>
              <Th right>Precio</Th>
              <Th right>IV Rank</Th>
              <Th right>IV30</Th>
              <Th>VIX TS</Th>
              <Th>Score</Th>
              <Th>Señal</Th>
              <Th right>EM ±{dteIdeal}d</Th>
              <Th right>Put sugerido</Th>
              <Th right>Call sugerido</Th>
            </tr>
          </thead>
          <tbody>
            {scored.map((row, idx) => {
              const t = tickers[row.symbol];
              const loading = t?.loading?.ivRank || t?.loading?.iv;
              const rowBg = idx % 2 === 0 ? 'var(--bg-primary)' : 'rgba(17,30,51,0.4)';

              return (
                <tr key={row.symbol} style={{ backgroundColor: rowBg }}>
                  {/* Ticker */}
                  <Td>
                    <span style={{
                      fontFamily: 'JetBrains Mono, monospace',
                      fontWeight: 700,
                      color: 'var(--text-primary)',
                      fontSize: 13,
                      letterSpacing: '0.05em',
                    }}>
                      {row.symbol}
                    </span>
                  </Td>

                  {/* Precio */}
                  <Td right mono>
                    {row.price > 0 ? fmtPrice(row.price) : '—'}
                  </Td>

                  {/* IV Rank */}
                  <Td right>
                    {loading ? (
                      <span style={{ opacity: 0.4 }}>…</span>
                    ) : (
                      <OkValue
                        ok={row.ivRankOk}
                        value={row.ivRank != null ? `${row.ivRank.toFixed(0)}` : '—'}
                      />
                    )}
                  </Td>

                  {/* IV30 */}
                  <Td right mono>
                    {row.iv30 != null ? `${(row.iv30).toFixed(1)}%` : '—'}
                  </Td>

                  {/* VIX TS */}
                  <Td>
                    <OkValue
                      ok={row.vixOk}
                      value={row.vixOk === null ? '—' : row.vixOk ? 'OK' : 'INV'}
                    />
                  </Td>

                  {/* Score */}
                  <Td>
                    <ScoreDots score={row.score} total={2} />
                  </Td>

                  {/* Señal */}
                  <Td>
                    <SignalPill signal={row.signal} />
                  </Td>

                  {/* Expected Move */}
                  <Td right mono>
                    {row.em != null ? `±${fmtPrice(row.em, 1)}` : '—'}
                  </Td>

                  {/* Put sugerido */}
                  <Td right>
                    {row.suggestedPut != null ? (
                      <span style={{ color: '#f43f5e', fontFamily: 'JetBrains Mono, monospace' }}>
                        {fmtPrice(row.suggestedPut, 0)}P
                      </span>
                    ) : '—'}
                  </Td>

                  {/* Call sugerido */}
                  <Td right>
                    {row.suggestedCall != null ? (
                      <span style={{ color: '#22c55e', fontFamily: 'JetBrains Mono, monospace' }}>
                        {fmtPrice(row.suggestedCall, 0)}C
                      </span>
                    ) : '—'}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Footnote */}
      <p style={{ fontSize: 9.5, color: 'var(--text-muted)', marginTop: 10, fontFamily: 'Inter, sans-serif', lineHeight: 1.6 }}>
        Score = IV Rank ✓ + VIX Term Structure ✓ (máx 2). Señal "ESPERAR" indica macro OK, falta confirmar GEX en el detalle del ticker.
        Strikes sugeridos = EM a {dteIdeal} DTE redondeado a $5. Expandir el ticker en Inicio para validar GEX, Put Wall y Call Wall.
      </p>
    </div>
  );
}

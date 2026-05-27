import React, { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useMarketStore } from '../store/useMarketStore';
import { useRulesStore } from '../store/useRulesStore';
import { useAccountStore } from '../store/useAccountStore';
import { useFlowStore } from '../store/useFlowStore';
import { fetchMarketDataByType } from '../api/marketdata';
import { fetchIVRank, fetchImpliedVolatility, fetchPositionBuilder } from '../api/analytics';
import { fmtPrice } from '../utils/formatters';
import { PositionBuilderApiResponse } from '../types/api';
import { SignalType } from '../types/market';

// ── Types ───────────────────────────────────────────────────────────────────

interface TickerRow {
  symbol: string;
  price: number;
  ivRank: number | null;
  iv30: number | null;
  signal: SignalType;
  structure: string | null;
  structureLabel: string | null;
  shortPut: number | null;
  shortPutDelta: number | null;
  shortCall: number | null;
  shortCallDelta: number | null;
  em: number | null;
  dte: number | null;
  credit: number | null;
  flowSignal: string | null;
  pbLoaded: boolean;
}

const structureLabels: Record<string, string> = {
  iron_condor: 'IC',
  put_credit_spread: 'PCS',
  call_credit_spread: 'CCS',
};

const signalMap: Record<string, SignalType> = {
  'OPERAR': 'OPERAR',
  'ESPERAR': 'ESPERAR',
  'NO_OPERAR': 'NO OPERAR',
};

// ── Sub-components ──────────────────────────────────────────────────────────

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

function FlowBadge({ signal }: { signal: string | null }) {
  if (!signal || signal === 'unavailable') return <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>—</span>;
  const color =
    signal === 'bullish' ? '#22c55e' :
    signal === 'bearish' ? '#f43f5e' :
                           '#f59e0b';
  return (
    <span style={{
      fontSize: 8, fontWeight: 700, letterSpacing: '0.06em',
      padding: '1px 5px', borderRadius: 10,
      color, backgroundColor: color + '18', border: `1px solid ${color}40`,
      fontFamily: 'JetBrains Mono, monospace', textTransform: 'uppercase',
    }}>
      {signal}
    </span>
  );
}

function StructurePill({ structure }: { structure: string | null }) {
  if (!structure) return <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>—</span>;
  const label = structureLabels[structure] ?? structure;
  const color =
    structure === 'iron_condor'        ? 'var(--blue-gc)' :
    structure === 'put_credit_spread'  ? 'var(--green)' :
    structure === 'call_credit_spread' ? 'var(--red-gc)' :
                                         'var(--text-secondary)';
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, letterSpacing: '0.06em',
      padding: '2px 6px', borderRadius: 4,
      color, backgroundColor: color + '18', border: `1px solid ${color}30`,
      fontFamily: 'JetBrains Mono, monospace',
    }}>
      {label}
    </span>
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

// ── Main component ──────────────────────────────────────────────────────────

export function PortfolioManager() {
  const { tickers: symbols = [], rules } = useRulesStore();
  const marketStore  = useMarketStore();
  const { balances } = useAccountStore();
  const flowSnapshots = useFlowStore((s) => s.snapshots);

  const ivRankMin  = rules?.options_filters?.iv_rank?.min ?? 25;
  const ivRankMax  = rules?.options_filters?.iv_rank?.max ?? 65;
  const maxConc    = rules?.risk_limits?.max_concurrent_positions ?? 3;
  const riskPct    = rules?.risk_limits?.risk_per_trade_pct ?? 0.02;
  const riskMaxUsd = rules?.risk_limits?.risk_per_trade_usd_max ?? 10000;

  const netLiq     = balances?.netLiquidatingValue ?? null;
  const riskAmount = netLiq != null
    ? Math.min(netLiq * riskPct, riskMaxUsd)
    : null;

  const { tickers, setIVRank, setIV, setOpen, updatePrice } = marketStore;
  const loadedRef = useRef<Record<string, boolean>>({});

  // PositionBuilder data per symbol
  const [pbData, setPbData] = useState<Record<string, PositionBuilderApiResponse>>({});
  const [pbLoading, setPbLoading] = useState<Record<string, boolean>>({});
  const [pbError, setPbError] = useState<Record<string, string | null>>({});

  // Load market data for all tickers on mount
  useEffect(() => {
    symbols.forEach(symbol => {
      if (loadedRef.current[symbol]) return;
      loadedRef.current[symbol] = true;

      fetchMarketDataByType(symbol)
        .then(d => {
          setOpen(symbol, d.open, d.prevClose, d.volume);
          const t = useMarketStore.getState().tickers[symbol];
          if (!t?.price) {
            updatePrice(symbol, { price: d.last, size: 0, timestamp: new Date().toISOString() });
          }
        })
        .catch(() => {});

      fetchIVRank(symbol)
        .then(d => setIVRank(symbol, d.ivRank))
        .catch(() => {});

      fetchImpliedVolatility(symbol)
        .then(d => setIV(symbol, d.iv30, d.iv9d, d.iv3m))
        .catch(() => {});
    });
  }, [symbols.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch PositionBuilder for all symbols
  const fetchAllPB = () => {
    symbols.forEach(symbol => {
      setPbLoading(prev => ({ ...prev, [symbol]: true }));
      setPbError(prev => ({ ...prev, [symbol]: null }));
      fetchPositionBuilder(symbol)
        .then(data => {
          setPbData(prev => ({ ...prev, [symbol]: data }));
        })
        .catch(e => {
          setPbError(prev => ({ ...prev, [symbol]: e.message }));
        })
        .finally(() => {
          setPbLoading(prev => ({ ...prev, [symbol]: false }));
        });
    });
  };

  useEffect(() => {
    if (symbols.length > 0) fetchAllPB();
  }, [symbols.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  const anyPbLoading = symbols.some(s => pbLoading[s]);

  // Build rows from PB data + market store fallbacks
  const rows: TickerRow[] = symbols.map(symbol => {
    const t = tickers[symbol];
    const pb = pbData[symbol];
    const flowSnap = flowSnapshots[symbol];

    if (pb) {
      const se = pb.strikeEngine;
      const micro = pb.microstructure;
      const ivRank = t?.ivRank ?? null;

      // Flow: prefer live WebSocket snapshot, fall back to PB aggressiveFlow
      const liveFlow = flowSnap?.signal ?? null;
      const pbFlow = pb.structureInputs?.aggressiveFlow?.signal ?? null;
      const flowSignal = liveFlow ?? (pbFlow !== 'unavailable' ? pbFlow : null);

      return {
        symbol,
        price: t?.price ?? pb.spotPrice,
        ivRank,
        iv30: t?.iv30 ?? null,
        signal: signalMap[pb.overallSignal] ?? 'NO OPERAR',
        structure: pb.selectedStructure?.output ?? null,
        structureLabel: pb.selectedStructure?.ruleLabel ?? null,
        shortPut: se?.shortPutStrike ?? null,
        shortPutDelta: se?.shortPutDelta ?? null,
        shortCall: se?.shortCallStrike ?? null,
        shortCallDelta: se?.shortCallDelta ?? null,
        em: se?.expectedMove ?? null,
        dte: se?.dte ?? null,
        credit: micro?.creditMinimum?.midCredit ?? null,
        flowSignal,
        pbLoaded: true,
      };
    }

    // Fallback while PB is loading
    return {
      symbol,
      price: t?.price ?? 0,
      ivRank: t?.ivRank ?? null,
      iv30: t?.iv30 ?? null,
      signal: 'NO OPERAR',
      structure: null,
      structureLabel: null,
      shortPut: null,
      shortPutDelta: null,
      shortCall: null,
      shortCallDelta: null,
      em: null,
      dte: null,
      credit: null,
      flowSignal: flowSnap?.signal ?? null,
      pbLoaded: false,
    };
  });

  // Sort: OPERAR first, then ESPERAR, then NO OPERAR; within same signal, by IVR desc
  const signalOrder: Record<string, number> = { 'OPERAR': 0, 'ESPERAR': 1, 'NO OPERAR': 2 };
  rows.sort((a, b) => {
    const sa = signalOrder[a.signal] ?? 2;
    const sb = signalOrder[b.signal] ?? 2;
    if (sa !== sb) return sa - sb;
    return (b.ivRank ?? 0) - (a.ivRank ?? 0);
  });

  return (
    <div style={{ padding: '16px 20px', minHeight: '100%', backgroundColor: 'var(--bg-primary)' }}>
      {/* Header */}
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'Inter, sans-serif', margin: 0 }}>
            Portfolio Manager
          </h2>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '2px 0 0', fontFamily: 'Inter, sans-serif' }}>
            Análisis de setup por ticker · PositionBuilder real
          </p>
        </div>

        {/* Context pills + refresh */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 10, fontFamily: 'JetBrains Mono, monospace', padding: '3px 10px', borderRadius: 20, backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-dark)', color: 'var(--text-secondary)' }}>
            IVR {ivRankMin}–{ivRankMax}
          </span>
          {netLiq != null && (
            <span style={{ fontSize: 10, fontFamily: 'JetBrains Mono, monospace', padding: '3px 10px', borderRadius: 20, backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-dark)', color: 'var(--text-secondary)' }}>
              Risk/trade: ${riskAmount?.toLocaleString('en-US', { maximumFractionDigits: 0 }) ?? '—'}
            </span>
          )}
          <span style={{ fontSize: 10, fontFamily: 'JetBrains Mono, monospace', padding: '3px 10px', borderRadius: 20, backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-dark)', color: 'var(--text-secondary)' }}>
            Máx {maxConc} pos
          </span>
          <button
            onClick={fetchAllPB}
            disabled={anyPbLoading}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              fontSize: 10, fontFamily: 'Inter, sans-serif', fontWeight: 600,
              padding: '4px 10px', borderRadius: 6,
              backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border)',
              color: 'var(--text-secondary)', cursor: 'pointer',
            }}
          >
            <RefreshCw size={10} className={anyPbLoading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* Table */}
      <div style={{ borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border-dark)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <Th>Ticker</Th>
              <Th right>Precio</Th>
              <Th right>IVR</Th>
              <Th>Señal</Th>
              <Th>Estructura</Th>
              <Th right>Short Put</Th>
              <Th right>Short Call</Th>
              <Th right>EM</Th>
              <Th right>Crédito</Th>
              <Th>Flow</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => {
              const t = tickers[row.symbol];
              const loading = pbLoading[row.symbol] || t?.loading?.ivRank;
              const error = pbError[row.symbol];
              const rowBg = idx % 2 === 0 ? 'var(--bg-primary)' : 'rgba(17,30,51,0.4)';
              const ivRankOk = row.ivRank != null ? row.ivRank >= ivRankMin && row.ivRank <= ivRankMax : null;

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
                    {row.dte != null && (
                      <span style={{ fontSize: 9, color: 'var(--text-muted)', marginLeft: 6 }}>
                        {row.dte}d
                      </span>
                    )}
                  </Td>

                  {/* Precio */}
                  <Td right mono>
                    {row.price > 0 ? fmtPrice(row.price) : '—'}
                  </Td>

                  {/* IV Rank */}
                  <Td right>
                    {loading && !row.pbLoaded ? (
                      <span style={{ opacity: 0.4 }}>…</span>
                    ) : (
                      <OkValue
                        ok={ivRankOk}
                        value={row.ivRank != null ? `${row.ivRank.toFixed(0)}` : '—'}
                      />
                    )}
                  </Td>

                  {/* Señal */}
                  <Td>
                    {loading && !row.pbLoaded ? (
                      <span style={{ opacity: 0.4, fontSize: 10 }}>…</span>
                    ) : error ? (
                      <span style={{ fontSize: 9, color: 'var(--red-gc)' }}>Error</span>
                    ) : (
                      <SignalPill signal={row.signal} />
                    )}
                  </Td>

                  {/* Estructura */}
                  <Td>
                    <StructurePill structure={row.structure} />
                  </Td>

                  {/* Short Put */}
                  <Td right>
                    {row.shortPut != null ? (
                      <span style={{ color: '#f43f5e', fontFamily: 'JetBrains Mono, monospace' }}>
                        {fmtPrice(row.shortPut, 0)}
                        {row.shortPutDelta != null && (
                          <span style={{ color: 'var(--text-muted)', fontSize: 10, marginLeft: 3 }}>
                            Δ{row.shortPutDelta.toFixed(2)}
                          </span>
                        )}
                      </span>
                    ) : '—'}
                  </Td>

                  {/* Short Call */}
                  <Td right>
                    {row.shortCall != null ? (
                      <span style={{ color: '#22c55e', fontFamily: 'JetBrains Mono, monospace' }}>
                        {fmtPrice(row.shortCall, 0)}
                        {row.shortCallDelta != null && (
                          <span style={{ color: 'var(--text-muted)', fontSize: 10, marginLeft: 3 }}>
                            Δ{row.shortCallDelta.toFixed(2)}
                          </span>
                        )}
                      </span>
                    ) : '—'}
                  </Td>

                  {/* Expected Move */}
                  <Td right mono>
                    {row.em != null ? `±${fmtPrice(row.em, 1)}` : '—'}
                  </Td>

                  {/* Crédito */}
                  <Td right mono>
                    {row.credit != null ? (
                      <span style={{ color: row.credit > 0 ? 'var(--green)' : 'var(--text-muted)' }}>
                        ${row.credit.toFixed(2)}
                      </span>
                    ) : '—'}
                  </Td>

                  {/* Flow */}
                  <Td>
                    <FlowBadge signal={row.flowSignal} />
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Footnote */}
      <p style={{ fontSize: 9.5, color: 'var(--text-muted)', marginTop: 10, fontFamily: 'Inter, sans-serif', lineHeight: 1.6 }}>
        Datos del endpoint PositionBuilder (capas 2-4). Estructura seleccionada por motor multi-factor (Z-Score, GEX, EMA, RV).
        Crédito basado en mid-price de las patas short/long. Flow requiere SubscribeFlow activo via WebSocket.
      </p>
    </div>
  );
}

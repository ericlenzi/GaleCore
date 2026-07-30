import React, { useEffect, useRef, useState, useCallback } from 'react';
import { RefreshCw } from 'lucide-react';
import { useMarketStore } from '../store/useMarketStore';
import { useRulesStore } from '../store/useRulesStore';
import { useAccountStore } from '../store/useAccountStore';
import { fetchMarketDataByType } from '../api/marketdata';
import { fetchIVRank, fetchImpliedVolatility, fetchPositionBuilder, fetchValidationLayer } from '../api/analytics';
import { ConnectionStatus } from '../socket/useMarketSocket';
import { ValidationLayerApiResponse } from '../types/api';
import { fmtPrice, fmtOI, fmtExpiry, tint } from '../utils/formatters';
import { PositionBuilderApiResponse, StrikeEngineCandidate, StrikeEngineResult, RiskAndSizingResult, LegMeta } from '../types/api';
import { TickerState } from '../types/market';

// ── Props ────────────────────────────────────────────────────────────────────

interface Props {
  subscribeLeg: (occ: string) => void;
  unsubscribeLeg: (occ: string) => void;
  socketStatus: ConnectionStatus;
  /** Símbolos a mostrar. Si se omite, usa el universo completo de las reglas.
   *  Main lo pasa scopeado al ticker seleccionado (una sola fila). */
  symbols?: string[];
  /** Modo embebido en Main: header compacto, sin padding/fondo propios. */
  embedded?: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const structureLabels: Record<string, string> = {
  iron_condor: 'IC',
  put_credit_spread: 'PCS',
  call_credit_spread: 'CCS',
};

function legMid(bid?: number, ask?: number): number | null {
  if (!bid || !ask || bid <= 0 || ask <= 0) return null;
  return (bid + ask) / 2;
}

function computeNetCredit(
  structure: string | null,
  shortPutMid: number | null,
  longPutMid: number | null,
  shortCallMid: number | null,
  longCallMid: number | null,
): number | null {
  if (structure === 'put_credit_spread' && shortPutMid != null && longPutMid != null)
    return shortPutMid - longPutMid;
  if (structure === 'call_credit_spread' && shortCallMid != null && longCallMid != null)
    return shortCallMid - longCallMid;
  if (structure === 'iron_condor'
    && shortPutMid != null && longPutMid != null
    && shortCallMid != null && longCallMid != null)
    return (shortPutMid - longPutMid) + (shortCallMid - longCallMid);
  return null;
}

// ── Candidate helpers ─────────────────────────────────────────────────────────

/** Fallback: convierte StrikeEngineResult en StrikeEngineCandidate cuando el backend no devuelve strikeCandidates */
function seToCandidate(se: StrikeEngineResult): StrikeEngineCandidate {
  return {
    rank: 1,
    shortPutStrike: se.shortPutStrike,
    shortCallStrike: se.shortCallStrike,
    shortPutDelta: se.shortPutDelta,
    shortCallDelta: se.shortCallDelta,
    longPutStrike: se.longPutStrike,
    longCallStrike: se.longCallStrike,
    strikesInsideWalls: se.strikesInsideWalls,
    pop: se.pop,
    creditRatio: se.creditRatio,
    priorityScore: se.priorityScore,
    legSymbols: se.legSymbols,
    legMeta: se.legMeta,
  };
}

// ── Sub-components ───────────────────────────────────────────────────────────

const signalLabels: Record<string, string> = {
  OPERAR: 'TRADE',
  ESPERAR: 'WAIT',
  NO_OPERAR: 'NO TRADE',
};

function SignalPill({ signal }: { signal: string }) {
  const color =
    signal === 'OPERAR'  ? '#22c55e' :
    signal === 'ESPERAR' ? '#f59e0b' : '#f43f5e';
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
      padding: '3px 9px', borderRadius: 20,
      color, backgroundColor: tint(color, 9), border: `1px solid ${tint(color, 25)}`,
      fontFamily: 'JetBrains Mono, monospace', whiteSpace: 'nowrap',
    }}>
      {signalLabels[signal] ?? signal}
    </span>
  );
}

function StructurePill({ structure }: { structure: string | null }) {
  if (!structure || structure === 'no_trade') return <Dash />;
  const label = structureLabels[structure] ?? structure;
  const color =
    structure === 'iron_condor'       ? 'var(--blue-gc)' :
    structure === 'put_credit_spread' ? 'var(--green)' :
                                        'var(--red-gc)';
  return (
    <span style={{
      fontSize: 12, fontWeight: 700, letterSpacing: '0.03em',
      padding: '3px 5px', borderRadius: 4,
      color, backgroundColor: tint(color, 9), border: `1px solid ${tint(color, 19)}`,
      fontFamily: 'JetBrains Mono, monospace',
    }}>
      {label}
    </span>
  );
}

function LiveDot({ live }: { live: boolean }) {
  if (!live) return null;
  return (
    <span style={{
      display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
      backgroundColor: '#22c55e', marginLeft: 5, verticalAlign: 'middle',
      boxShadow: '0 0 4px #22c55e88',
    }} />
  );
}

function Dash() {
  return <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>—</span>;
}

function MonoVal({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <span style={{ fontFamily: 'JetBrains Mono, monospace', fontVariantNumeric: 'tabular-nums', color: color ?? 'var(--text-secondary)', fontSize: 13 }}>
      {children}
    </span>
  );
}

/** Sub-línea bajo el strike: OI + cierre del período anterior (datos estáticos del candle previo). */
function StrikeMeta({ meta }: { meta: LegMeta | null | undefined }) {
  if (!meta || (meta.openInterest == null && meta.prevClose == null)) return null;
  const parts: string[] = [];
  if (meta.openInterest != null) parts.push(`OI ${fmtOI(meta.openInterest)}`);
  if (meta.prevClose != null) parts.push(fmtPrice(meta.prevClose, 2));
  return (
    <span style={{
      display: 'block', fontSize: 9, color: 'var(--text-muted)',
      fontFamily: 'JetBrains Mono, monospace', fontVariantNumeric: 'tabular-nums',
      marginTop: 2, whiteSpace: 'nowrap',
    }}>
      {parts.join(' · ')}
    </span>
  );
}

// Table cell helpers
function Th({ children, span, rowSpan, muted }: {
  children: React.ReactNode; right?: boolean; center?: boolean;
  span?: number; rowSpan?: number; muted?: boolean;
}) {
  return (
    <th colSpan={span} rowSpan={rowSpan} style={{
      padding: '7px 5px',
      fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase',
      color: muted ? 'var(--text-muted)' : 'var(--text-secondary)',
      textAlign: 'center',
      fontFamily: 'Inter, sans-serif',
      borderBottom: '1px solid var(--border-dark)',
      borderRight: '1px solid rgba(255,255,255,0.04)',
      backgroundColor: 'var(--bg-secondary)',
      verticalAlign: 'middle',
    }}>
      {children}
    </th>
  );
}

function Td({ children, rowSpan }: { children: React.ReactNode; right?: boolean; center?: boolean; rowSpan?: number }) {
  return (
    <td rowSpan={rowSpan} style={{
      padding: '11px 5px',
      textAlign: 'center',
      borderBottom: '1px solid var(--border-dark)',
      borderRight: '1px solid rgba(255,255,255,0.03)',
      whiteSpace: 'nowrap',
      verticalAlign: 'middle',
    }}>
      {children}
    </td>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export function PortfolioManager({ subscribeLeg, unsubscribeLeg, socketStatus, symbols: symbolsProp, embedded = false }: Props) {
  const { tickers: rulesTickers = [], rules } = useRulesStore();
  const symbols = symbolsProp ?? rulesTickers;
  const marketStore = useMarketStore();
  const { tickers } = marketStore;
  const { balances } = useAccountStore();

  const netLiq = balances?.netLiquidatingValue ?? null;
  const maxConc = rules?.risk_limits?.max_concurrent_positions ?? 3;

  const loadedRef = useRef<Record<string, boolean>>({});
  const subscribedLegsRef = useRef<string[]>([]);

  // PB data per symbol (structure/strikes/premiums)
  const [pbData, setPbData] = useState<Record<string, PositionBuilderApiResponse>>({});
  const [pbLoading, setPbLoading] = useState<Record<string, boolean>>({});

  // VL data per symbol (authoritative signal with macro)
  const [vlData, setVlData] = useState<Record<string, ValidationLayerApiResponse>>({});

  // Load market data for underlying
  useEffect(() => {
    symbols.forEach(symbol => {
      if (loadedRef.current[symbol]) return;
      loadedRef.current[symbol] = true;
      fetchMarketDataByType(symbol)
        .then(d => {
          marketStore.setOpen(symbol, d.open, d.prevClose, d.volume);
          if (!tickers[symbol]?.price)
            marketStore.updatePrice(symbol, { price: d.last, size: 0, timestamp: new Date().toISOString() });
        }).catch(() => {});
      fetchIVRank(symbol).then(d => marketStore.setIVRank(symbol, d.ivRank)).catch(() => {});
      fetchImpliedVolatility(symbol).then(d => marketStore.setIV(symbol, d.iv30, d.iv9d, d.iv3m)).catch(() => {});
    });
  }, [symbols.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch PositionBuilder + ValidationLayer
  const fetchAllPB = useCallback(() => {
    symbols.forEach(symbol => {
      setPbLoading(prev => ({ ...prev, [symbol]: true }));
      Promise.all([
        fetchPositionBuilder(symbol),
        fetchValidationLayer(symbol),
      ])
        .then(([pb, vl]) => {
          setPbData(prev => ({ ...prev, [symbol]: pb }));
          setVlData(prev => ({ ...prev, [symbol]: vl }));
        })
        .catch(() => {})
        .finally(() => setPbLoading(prev => ({ ...prev, [symbol]: false })));
    });
  }, [symbols.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (symbols.length > 0) fetchAllPB(); }, [symbols.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  // Subscribe / unsubscribe option leg OCC symbols when PB data or socket status changes
  useEffect(() => {
    if (socketStatus !== 'connected') return;

    // Unsubscribe previous legs
    subscribedLegsRef.current.forEach(occ => unsubscribeLeg(occ));

    const newLegs: string[] = [];
    // Solo los símbolos mostrados (scopeados por prop). Iterar todo pbData dejaría legs de
    // símbolos ya no visibles suscriptos al cambiar de ticker en Main.
    symbols.forEach(sym => {
      const pb = pbData[sym];
      if (!pb) return;
      // Suscribir legs de todos los candidatos (rank 1-3)
      const candidates = pb.strikeCandidates ?? (pb.strikeEngine ? [seToCandidate(pb.strikeEngine)] : []);
      candidates.forEach(c => {
        const ls = c.legSymbols;
        if (!ls) return;
        [ls.shortPut, ls.longPut, ls.shortCall, ls.longCall]
          .filter((s): s is string => !!s)
          .forEach(occ => {
            marketStore.initTicker(occ);
            subscribeLeg(occ);
            newLegs.push(occ);
          });
      });
    });

    subscribedLegsRef.current = newLegs;
    return () => {
      newLegs.forEach(occ => unsubscribeLeg(occ));
    };
  }, [socketStatus, symbols.join(','), JSON.stringify(symbols.map(s => pbData[s]?.strikeEngine?.legSymbols))]); // eslint-disable-line react-hooks/exhaustive-deps

  const anyLoading = symbols.some(s => pbLoading[s]);

  // Sort: priorityScore desc (calculado por la API según position_builder.ranking) → symbol asc (tiebreak estable)
  const sortedSymbols = [...symbols].sort((a, b) => {
    const scoreA = pbData[a]?.strikeEngine?.priorityScore ?? -1;
    const scoreB = pbData[b]?.strikeEngine?.priorityScore ?? -1;
    if (scoreB !== scoreA) return scoreB - scoreA;
    return a.localeCompare(b);
  });

  // Las columnas call (Short/Long Call, strikes + premium) solo tienen sentido con IC o CCS.
  // En PCS-only (producción) ningún candidato tiene lado call → se ocultan para no mostrar
  // media tabla en '—'. Si se reactivara IC/CCS, reaparecen solas.
  const showCall = sortedSymbols.some((sym) => {
    const st = pbData[sym]?.strikeEngine?.selectedStructure ?? pbData[sym]?.selectedStructure?.output;
    return st === 'iron_condor' || st === 'call_credit_spread';
  });

  const refreshBtn = (
    <button
      onClick={fetchAllPB} disabled={anyLoading}
      style={{
        display: 'flex', alignItems: 'center', gap: 4,
        fontSize: 11, fontFamily: 'Inter, sans-serif', fontWeight: 600,
        padding: '6px 12px', borderRadius: 6,
        backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border)',
        color: 'var(--text-secondary)', cursor: anyLoading ? 'wait' : 'pointer',
      }}
    >
      <RefreshCw size={11} className={anyLoading ? 'animate-spin' : ''} />
      Refresh
    </button>
  );

  // Header compacto embebido en Main vs header de página completo.
  const header = embedded ? (
    <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
      <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', fontFamily: 'Inter, sans-serif' }}>
        Setup candidato · primas en vivo
      </span>
      {refreshBtn}
    </div>
  ) : (
    <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
      <div>
        <h2 style={{ fontSize: 19, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'Inter, sans-serif', margin: 0 }}>
          Portfolio Manager
        </h2>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '3px 0 0', fontFamily: 'Inter, sans-serif' }}>
          Setup per ticker · live premiums via socket · risk values with instant credit
        </p>
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        {netLiq != null && (
          <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', padding: '3px 10px', borderRadius: 20, backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-dark)', color: 'var(--text-muted)' }}>
            NL ${netLiq.toLocaleString('en-US', { maximumFractionDigits: 0 })}
          </span>
        )}
        <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', padding: '3px 10px', borderRadius: 20, backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-dark)', color: 'var(--text-muted)' }}>
          Max {maxConc} pos
        </span>
        {refreshBtn}
      </div>
    </div>
  );

  return (
    <div style={embedded ? undefined : { padding: '14px 16px', minHeight: '100%', backgroundColor: 'var(--bg-primary)' }}>

      {header}

      {/* Table */}
      <div style={{ borderRadius: 8, border: '1px solid var(--border-dark)', overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
          <thead>
            {/* Row 1 — group headers */}
            <tr>
              <Th rowSpan={2}>Ticker</Th>
              <Th rowSpan={2}>Signal</Th>
              <Th rowSpan={2} right>Price</Th>
              <Th rowSpan={2} right>Call Wall</Th>
              <Th rowSpan={2} right>Put Wall</Th>
              <Th rowSpan={2} center>Structure</Th>
              <Th span={showCall ? 4 : 2} center>Strikes</Th>
              <Th span={showCall ? 4 : 2} center>Premium (live)</Th>
              <Th rowSpan={2} right>Net Credit</Th>
              <Th rowSpan={2} right>1/3 Rule</Th>
              <Th rowSpan={2} right>POP</Th>
              <Th rowSpan={2} right>Max Profit</Th>
              <Th rowSpan={2} right>Max Loss</Th>
              <Th rowSpan={2} right>BPR</Th>
            </tr>
            {/* Row 2 — sub-headers for groups */}
            <tr>
              <Th right>Long Put</Th>
              <Th right>Short Put</Th>
              {showCall && <Th right>Short Call</Th>}
              {showCall && <Th right>Long Call</Th>}
              <Th right>Long Put</Th>
              <Th right>Short Put</Th>
              {showCall && <Th right>Short Call</Th>}
              {showCall && <Th right>Long Call</Th>}
            </tr>
          </thead>
          <tbody>
            {sortedSymbols.map((symbol, idx) => (
              <PortfolioRow
                key={symbol}
                symbol={symbol}
                pb={pbData[symbol] ?? null}
                vl={vlData[symbol] ?? null}
                loading={pbLoading[symbol] ?? false}
                tickers={tickers}
                rowBg={idx % 2 === 0 ? 'var(--bg-primary)' : 'rgba(17,30,51,0.4)'}
                showCall={showCall}
              />
            ))}
          </tbody>
        </table>
      </div>

    </div>
  );
}

// ── Row component ────────────────────────────────────────────────────────────

interface RowProps {
  symbol: string;
  pb: PositionBuilderApiResponse | null;
  vl: ValidationLayerApiResponse | null;
  loading: boolean;
  tickers: Record<string, TickerState>;
  rowBg: string;
  showCall: boolean;
}

function PortfolioRow({ symbol, pb, vl, loading, tickers, rowBg, showCall }: RowProps) {
  const t = tickers[symbol];
  const se = pb?.strikeEngine;
  const rs = pb?.riskAndSizing;

  const price    = t?.price ?? pb?.spotPrice ?? 0;
  const structure = se?.selectedStructure ?? pb?.selectedStructure?.output ?? null;

  // Obtener candidatos — fallback a rank-1 derivado de strikeEngine
  const candidates: StrikeEngineCandidate[] =
    pb?.strikeCandidates?.length
      ? pb.strikeCandidates
      : se ? [seToCandidate(se)] : [];

  const rowSpan = Math.max(candidates.length, 1);

  if (loading && !pb) {
    return (
      <tr style={{ backgroundColor: rowBg }}>
        <Td><MonoVal color="var(--text-primary)">{symbol}</MonoVal></Td>
        <Td><span style={{ opacity: 0.4, fontSize: 12 }}>…</span></Td>
        {Array.from({ length: showCall ? 18 : 14 }).map((_, i) => <Td key={i}><Dash /></Td>)}
      </tr>
    );
  }

  if (candidates.length === 0) {
    // NO_OPERAR sin candidatos — fila única simple
    return (
      <tr style={{ backgroundColor: rowBg }}>
        <Td>
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: 'var(--text-primary)', fontSize: 15, letterSpacing: '0.05em' }}>{symbol}</span>
          {se?.dte != null && <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 6 }}>{se.dte}d</span>}
          {se?.expiration && (
            <span style={{ display: 'block', fontSize: 9, color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', marginTop: 2 }}>
              {fmtExpiry(se.expiration)}
            </span>
          )}
        </Td>
        <Td center>
          {vl ? <SignalPill signal={vl.overallSignal} /> : pb ? <SignalPill signal={pb.overallSignal} /> : <Dash />}
        </Td>
        <Td right><MonoVal color="var(--text-primary)">{price > 0 ? fmtPrice(price) : '—'}</MonoVal></Td>
        <Td right><MonoVal color="#22c55e">{se?.callWall != null ? fmtPrice(se.callWall, 0) : '—'}</MonoVal></Td>
        <Td right><MonoVal color="#f43f5e">{se?.putWall != null ? fmtPrice(se.putWall, 0) : '—'}</MonoVal></Td>
        <Td center><StructurePill structure={structure} /></Td>
        {Array.from({ length: showCall ? 14 : 10 }).map((_, i) => <Td key={i}><Dash /></Td>)}
      </tr>
    );
  }

  return (
    <>
      {candidates.map((c, idx) => (
        <CandidateRow
          key={c.rank}
          symbol={symbol}
          candidate={c}
          isFirstRow={idx === 0}
          rowSpan={rowSpan}
          pb={pb}
          vl={vl}
          se={se ?? null}
          rs={rs ?? null}
          tickers={tickers}
          rowBg={rowBg}
          price={price}
          structure={structure}
          showCall={showCall}
        />
      ))}
    </>
  );
}

// ── Candidate row ─────────────────────────────────────────────────────────────

interface CandidateRowProps {
  symbol: string;
  candidate: StrikeEngineCandidate;
  isFirstRow: boolean;
  rowSpan: number;
  pb: PositionBuilderApiResponse | null;
  vl: ValidationLayerApiResponse | null;
  se: StrikeEngineResult | null;
  rs: RiskAndSizingResult | null;
  tickers: Record<string, TickerState>;
  rowBg: string;
  price: number;
  structure: string | null;
  showCall: boolean;
}

function CandidateRow({ symbol, candidate: c, isFirstRow, rowSpan, pb, vl, se, rs, tickers, rowBg, price, structure, showCall }: CandidateRowProps) {
  const ls = c.legSymbols;

  const shortPutQ  = ls?.shortPut  ? tickers[ls.shortPut]  : undefined;
  const longPutQ   = ls?.longPut   ? tickers[ls.longPut]   : undefined;
  const shortCallQ = ls?.shortCall ? tickers[ls.shortCall] : undefined;
  const longCallQ  = ls?.longCall  ? tickers[ls.longCall]  : undefined;

  const shortPutMid  = legMid(shortPutQ?.bid,  shortPutQ?.ask);
  const longPutMid   = legMid(longPutQ?.bid,   longPutQ?.ask);
  const shortCallMid = legMid(shortCallQ?.bid, shortCallQ?.ask);
  const longCallMid  = legMid(longCallQ?.bid,  longCallQ?.ask);

  const spreadWidth = c.shortPutStrike != null && c.longPutStrike != null
    ? Math.abs(c.shortPutStrike - c.longPutStrike)
    : c.shortCallStrike != null && c.longCallStrike != null
      ? Math.abs(c.shortCallStrike - c.longCallStrike)
      : null;

  const netCreditLive = computeNetCredit(structure, shortPutMid, longPutMid, shortCallMid, longCallMid);
  const contracts = rs?.contracts ?? 1;
  const maxProfitLive = netCreditLive != null ? netCreditLive * 100 * contracts : null;
  const maxLossLive   = netCreditLive != null && spreadWidth != null
    ? (spreadWidth - netCreditLive) * 100 * contracts : null;
  const bprLive       = netCreditLive != null && spreadWidth != null
    ? (spreadWidth - netCreditLive) * 100 : null;

  // Rank badge
  const rankColor = c.rank === 1 ? '#22c55e' : c.rank === 2 ? '#f59e0b' : 'var(--text-muted)';
  const rankBadge = (
    <span style={{
      fontSize: 11, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace',
      color: rankColor, opacity: c.rank === 1 ? 1 : 0.7,
    }}>#{c.rank}</span>
  );

  const rowStyle: React.CSSProperties = {
    backgroundColor: rowBg,
    opacity: c.rank === 1 ? 1 : 0.75,
  };

  return (
    <tr style={rowStyle}>

      {/* Celdas macro — solo en la primera fila del ticker (rowSpan) */}
      {isFirstRow && (
        <>
          <Td rowSpan={rowSpan}>
            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: 'var(--text-primary)', fontSize: 15, letterSpacing: '0.05em' }}>
              {symbol}
            </span>
            {se?.dte != null && (
              <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 6 }}>{se.dte}d</span>
            )}
            {se?.expiration && (
              <span style={{ display: 'block', fontSize: 10, fontWeight: 600, color: 'var(--text-secondary)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.02em', marginTop: 3 }}>
                {fmtExpiry(se.expiration)}
              </span>
            )}
          </Td>

          <Td rowSpan={rowSpan} center>
            {vl ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                <SignalPill signal={vl.overallSignal} />
                {vl.failedAtLayer != null && (
                  <span style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'Inter, sans-serif' }}>
                    fails L{vl.failedAtLayer}
                  </span>
                )}
              </div>
            ) : pb ? <SignalPill signal={pb.overallSignal} /> : <Dash />}
          </Td>

          <Td rowSpan={rowSpan} right>
            <MonoVal color="var(--text-primary)">{price > 0 ? fmtPrice(price) : '—'}</MonoVal>
          </Td>

          <Td rowSpan={rowSpan} right>
            <MonoVal color="#22c55e">{se?.callWall != null ? fmtPrice(se.callWall, 0) : '—'}</MonoVal>
          </Td>

          <Td rowSpan={rowSpan} right>
            <MonoVal color="#f43f5e">{se?.putWall != null ? fmtPrice(se.putWall, 0) : '—'}</MonoVal>
          </Td>

          <Td rowSpan={rowSpan} center>
            <StructurePill structure={structure} />
          </Td>
        </>
      )}

      {/* Strikes — por candidato (con OI + cierre anterior debajo) */}
      <Td right>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3 }}>
            {rankBadge}
            <MonoVal color="#f43f5e">{c.longPutStrike  != null ? fmtPrice(c.longPutStrike,  0) : '—'}</MonoVal>
          </div>
          <StrikeMeta meta={c.legMeta?.longPut} />
        </div>
      </Td>
      <Td right>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <MonoVal color="#f43f5e">{c.shortPutStrike  != null ? fmtPrice(c.shortPutStrike,  0) : '—'}</MonoVal>
          <StrikeMeta meta={c.legMeta?.shortPut} />
        </div>
      </Td>
      {showCall && (
        <>
          <Td right>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <MonoVal color="#22c55e">{c.shortCallStrike != null ? fmtPrice(c.shortCallStrike, 0) : '—'}</MonoVal>
              <StrikeMeta meta={c.legMeta?.shortCall} />
            </div>
          </Td>
          <Td right>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <MonoVal color="#22c55e">{c.longCallStrike  != null ? fmtPrice(c.longCallStrike,  0) : '—'}</MonoVal>
              <StrikeMeta meta={c.legMeta?.longCall} />
            </div>
          </Td>
        </>
      )}

      {/* Premiums live */}
      <Td right>
        {longPutMid != null
          ? <span><MonoVal>{fmtPrice(longPutMid, 2)}</MonoVal><LiveDot live /></span>
          : ls?.longPut ? <span style={{ opacity: 0.4, fontSize: 12 }}>…</span> : <Dash />}
      </Td>
      <Td right>
        {shortPutMid != null
          ? <span><MonoVal>{fmtPrice(shortPutMid, 2)}</MonoVal><LiveDot live /></span>
          : ls?.shortPut ? <span style={{ opacity: 0.4, fontSize: 12 }}>…</span> : <Dash />}
      </Td>
      {showCall && (
        <>
          <Td right>
            {shortCallMid != null
              ? <span><MonoVal>{fmtPrice(shortCallMid, 2)}</MonoVal><LiveDot live /></span>
              : ls?.shortCall ? <span style={{ opacity: 0.4, fontSize: 12 }}>…</span> : <Dash />}
          </Td>
          <Td right>
            {longCallMid != null
              ? <span><MonoVal>{fmtPrice(longCallMid, 2)}</MonoVal><LiveDot live /></span>
              : ls?.longCall ? <span style={{ opacity: 0.4, fontSize: 12 }}>…</span> : <Dash />}
          </Td>
        </>
      )}

      {/* Net Credit live */}
      <Td right>
        {netCreditLive != null ? (
          <span>
            <MonoVal color={netCreditLive > 0 ? '#22c55e' : '#f43f5e'}>${fmtPrice(netCreditLive, 2)}</MonoVal>
            <LiveDot live />
          </span>
        ) : c.rank === 1 && rs?.maxProfit != null ? (
          <MonoVal color="var(--text-muted)">${fmtPrice(Number(rs.maxProfit) / 100 / contracts, 2)}</MonoVal>
        ) : <Dash />}
      </Td>

      {/* 1/3 Rule */}
      <Td right>
        {(() => {
          const liveRatio = netCreditLive != null && spreadWidth != null && spreadWidth > 0
            ? (netCreditLive / spreadWidth) * 100 : null;
          const ratio = liveRatio ?? c.creditRatio ?? null;
          if (ratio == null) return <Dash />;
          const color = ratio >= 33.3 ? '#22c55e' : ratio >= 25 ? '#f59e0b' : '#f43f5e';
          return (
            <span>
              <MonoVal color={color}>{ratio.toFixed(1)}%</MonoVal>
              {liveRatio != null && <LiveDot live />}
            </span>
          );
        })()}
      </Td>

      {/* POP */}
      <Td right>
        {c.pop != null
          ? <MonoVal color="#22c55e">{c.pop.toFixed(0)}%</MonoVal>
          : <Dash />}
      </Td>

      {/* Máx Profit */}
      <Td right>
        {maxProfitLive != null ? (
          <span><MonoVal color="#22c55e">${fmtPrice(maxProfitLive, 0)}</MonoVal><LiveDot live /></span>
        ) : c.rank === 1 && rs?.maxProfit != null ? (
          <MonoVal color="var(--text-muted)">${fmtPrice(Number(rs.maxProfit), 0)}</MonoVal>
        ) : <Dash />}
      </Td>

      {/* Máx Loss */}
      <Td right>
        {maxLossLive != null ? (
          <span><MonoVal color="#f43f5e">${fmtPrice(maxLossLive, 0)}</MonoVal><LiveDot live /></span>
        ) : c.rank === 1 && rs?.maxLoss != null ? (
          <MonoVal color="var(--text-muted)">${fmtPrice(Number(rs.maxLoss), 0)}</MonoVal>
        ) : <Dash />}
      </Td>

      {/* BPR */}
      <Td right>
        {bprLive != null ? (
          <span><MonoVal>${fmtPrice(bprLive, 0)}</MonoVal><LiveDot live /></span>
        ) : c.rank === 1 && rs?.buyingPowerReq != null ? (
          <MonoVal color="var(--text-muted)">${fmtPrice(Number(rs.buyingPowerReq), 0)}</MonoVal>
        ) : <Dash />}
      </Td>

    </tr>
  );
}

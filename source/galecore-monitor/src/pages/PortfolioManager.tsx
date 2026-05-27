import React, { useEffect, useRef, useState, useCallback } from 'react';
import { RefreshCw } from 'lucide-react';
import { useMarketStore } from '../store/useMarketStore';
import { useRulesStore } from '../store/useRulesStore';
import { useAccountStore } from '../store/useAccountStore';
import { fetchMarketDataByType } from '../api/marketdata';
import { fetchIVRank, fetchImpliedVolatility, fetchPositionBuilder, fetchValidationLayer } from '../api/analytics';
import { ConnectionStatus } from '../socket/useMarketSocket';
import { ValidationLayerApiResponse } from '../types/api';
import { fmtPrice, fmtGex } from '../utils/formatters';
import { PositionBuilderApiResponse } from '../types/api';
import { TickerState } from '../types/market';

// ── Props ────────────────────────────────────────────────────────────────────

interface Props {
  subscribeLeg: (occ: string) => void;
  unsubscribeLeg: (occ: string) => void;
  socketStatus: ConnectionStatus;
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

// ── Sub-components ───────────────────────────────────────────────────────────

function SignalPill({ signal }: { signal: string }) {
  const color =
    signal === 'OPERAR'  ? '#22c55e' :
    signal === 'ESPERAR' ? '#f59e0b' : '#f43f5e';
  return (
    <span style={{
      fontSize: 8, fontWeight: 700, letterSpacing: '0.08em',
      padding: '2px 6px', borderRadius: 20,
      color, backgroundColor: color + '18', border: `1px solid ${color}40`,
      fontFamily: 'JetBrains Mono, monospace', whiteSpace: 'nowrap',
    }}>
      {signal}
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
      fontSize: 9, fontWeight: 700, letterSpacing: '0.06em',
      padding: '2px 6px', borderRadius: 4,
      color, backgroundColor: color + '18', border: `1px solid ${color}30`,
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
      display: 'inline-block', width: 5, height: 5, borderRadius: '50%',
      backgroundColor: '#22c55e', marginLeft: 4, verticalAlign: 'middle',
      boxShadow: '0 0 4px #22c55e88',
    }} />
  );
}

function Dash() {
  return <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>—</span>;
}

function MonoVal({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <span style={{ fontFamily: 'JetBrains Mono, monospace', fontVariantNumeric: 'tabular-nums', color: color ?? 'var(--text-secondary)', fontSize: 11 }}>
      {children}
    </span>
  );
}

// Table cell helpers
function Th({ children, right, center, span, rowSpan, muted }: {
  children: React.ReactNode; right?: boolean; center?: boolean;
  span?: number; rowSpan?: number; muted?: boolean;
}) {
  return (
    <th colSpan={span} rowSpan={rowSpan} style={{
      padding: '5px 8px',
      fontSize: 8, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase',
      color: muted ? 'var(--text-muted)' : 'var(--text-secondary)',
      textAlign: center ? 'center' : right ? 'right' : 'left',
      fontFamily: 'Inter, sans-serif', whiteSpace: 'nowrap',
      borderBottom: '1px solid var(--border-dark)',
      borderRight: '1px solid rgba(255,255,255,0.04)',
      backgroundColor: 'var(--bg-secondary)',
      verticalAlign: 'bottom',
    }}>
      {children}
    </th>
  );
}

function Td({ children, right, center }: { children: React.ReactNode; right?: boolean; center?: boolean }) {
  return (
    <td style={{
      padding: '9px 8px',
      textAlign: center ? 'center' : right ? 'right' : 'left',
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

export function PortfolioManager({ subscribeLeg, unsubscribeLeg, socketStatus }: Props) {
  const { tickers: symbols = [], rules } = useRulesStore();
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
    Object.values(pbData).forEach(pb => {
      const ls = pb.strikeEngine?.legSymbols;
      if (!ls) return;
      [ls.shortPut, ls.longPut, ls.shortCall, ls.longCall]
        .filter((s): s is string => !!s)
        .forEach(occ => {
          marketStore.initTicker(occ);
          subscribeLeg(occ);
          newLegs.push(occ);
        });
    });

    subscribedLegsRef.current = newLegs;
    return () => {
      newLegs.forEach(occ => unsubscribeLeg(occ));
    };
  }, [socketStatus, JSON.stringify(Object.fromEntries(Object.entries(pbData).map(([k, v]) => [k, v.strikeEngine?.legSymbols])))]); // eslint-disable-line react-hooks/exhaustive-deps

  const anyLoading = symbols.some(s => pbLoading[s]);

  // Sort: priorityScore desc (calculado por la API según position_builder.ranking) → symbol asc (tiebreak estable)
  const sortedSymbols = [...symbols].sort((a, b) => {
    const scoreA = pbData[a]?.strikeEngine?.priorityScore ?? -1;
    const scoreB = pbData[b]?.strikeEngine?.priorityScore ?? -1;
    if (scoreB !== scoreA) return scoreB - scoreA;
    return a.localeCompare(b);
  });

  return (
    <div style={{ padding: '14px 16px', minHeight: '100%', backgroundColor: 'var(--bg-primary)' }}>

      {/* Header */}
      <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h2 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'Inter, sans-serif', margin: 0 }}>
            Portfolio Manager
          </h2>
          <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: '2px 0 0', fontFamily: 'Inter, sans-serif' }}>
            Setup por ticker · premiums live via socket · valores de riesgo con crédito instantáneo
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {netLiq != null && (
            <span style={{ fontSize: 9, fontFamily: 'JetBrains Mono, monospace', padding: '2px 8px', borderRadius: 20, backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-dark)', color: 'var(--text-muted)' }}>
              NL ${netLiq.toLocaleString('en-US', { maximumFractionDigits: 0 })}
            </span>
          )}
          <span style={{ fontSize: 9, fontFamily: 'JetBrains Mono, monospace', padding: '2px 8px', borderRadius: 20, backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-dark)', color: 'var(--text-muted)' }}>
            Máx {maxConc} pos
          </span>
          <button
            onClick={fetchAllPB} disabled={anyLoading}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              fontSize: 9, fontFamily: 'Inter, sans-serif', fontWeight: 600,
              padding: '4px 9px', borderRadius: 6,
              backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border)',
              color: 'var(--text-secondary)', cursor: anyLoading ? 'wait' : 'pointer',
            }}
          >
            <RefreshCw size={9} className={anyLoading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* Table */}
      <div style={{ borderRadius: 8, border: '1px solid var(--border-dark)', overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1400 }}>
          <thead>
            {/* Row 1 — group headers */}
            <tr>
              <Th rowSpan={2}>Ticker</Th>
              <Th rowSpan={2}>Señal</Th>
              <Th rowSpan={2} right>Precio</Th>
              <Th rowSpan={2} right>Call Wall</Th>
              <Th rowSpan={2} right>ZGL</Th>
              <Th rowSpan={2} right>Put Wall</Th>
              <Th rowSpan={2} right>Z-Spot</Th>
              <Th rowSpan={2} right>GEX</Th>
              <Th rowSpan={2} right>EM</Th>
              <Th rowSpan={2} center>Estructura</Th>
              <Th span={4} center muted>Strikes</Th>
              <Th span={4} center muted>Premium (live)</Th>
              <Th rowSpan={2} right>Net Credit</Th>
              <Th rowSpan={2} right>1/3 Rule</Th>
              <Th rowSpan={2} right>POP</Th>
              <Th rowSpan={2} right>Máx Profit</Th>
              <Th rowSpan={2} right>Máx Loss</Th>
              <Th rowSpan={2} right>BPR</Th>
            </tr>
            {/* Row 2 — sub-headers for groups */}
            <tr>
              <Th right muted>Long Put</Th>
              <Th right muted>Short Put</Th>
              <Th right muted>Short Call</Th>
              <Th right muted>Long Call</Th>
              <Th right muted>Long Put</Th>
              <Th right muted>Short Put</Th>
              <Th right muted>Short Call</Th>
              <Th right muted>Long Call</Th>
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
              />
            ))}
          </tbody>
        </table>
      </div>

      <p style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 8, fontFamily: 'Inter, sans-serif', lineHeight: 1.6 }}>
        EM = Expected Move · ZGL = Gamma Zero Level · BPR = Buying Power Requirement por contrato · POP = proxy (1−|Δ|)×100
        · 1/3 Rule = crédito / ancho spread (target ≥ 33.3% · verde ≥ 33.3% · amarillo 25–33% · rojo &lt; 25%)
        · Premiums, crédito y 1/3 Rule en tiempo real del socket (dot verde = live). Máx Profit / Loss / BPR se recalculan con crédito live.
      </p>
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
}

function PortfolioRow({ symbol, pb, vl, loading, tickers, rowBg }: RowProps) {
  const t = tickers[symbol];
  const se = pb?.strikeEngine;
  const rs = pb?.riskAndSizing;
  const ls = se?.legSymbols;

  // Live leg quotes from socket
  const shortPutQ  = ls?.shortPut  ? tickers[ls.shortPut]  : undefined;
  const longPutQ   = ls?.longPut   ? tickers[ls.longPut]   : undefined;
  const shortCallQ = ls?.shortCall ? tickers[ls.shortCall] : undefined;
  const longCallQ  = ls?.longCall  ? tickers[ls.longCall]  : undefined;

  const shortPutMid  = legMid(shortPutQ?.bid,  shortPutQ?.ask);
  const longPutMid   = legMid(longPutQ?.bid,   longPutQ?.ask);
  const shortCallMid = legMid(shortCallQ?.bid, shortCallQ?.ask);
  const longCallMid  = legMid(longCallQ?.bid,  longCallQ?.ask);

  const structure = se?.selectedStructure ?? pb?.selectedStructure?.output ?? null;
  const spreadWidth = se?.shortPutStrike != null && se?.longPutStrike != null
    ? Math.abs(se.shortPutStrike - se.longPutStrike)
    : se?.shortCallStrike != null && se?.longCallStrike != null
      ? Math.abs(se.shortCallStrike - se.longCallStrike)
      : null;

  const netCreditLive = computeNetCredit(structure, shortPutMid, longPutMid, shortCallMid, longCallMid);
  const contracts = rs?.contracts ?? 1;
  const maxProfitLive  = netCreditLive != null ? netCreditLive * 100 * contracts : null;
  const maxLossLive    = netCreditLive != null && spreadWidth != null
    ? (spreadWidth - netCreditLive) * 100 * contracts : null;
  const bprLive        = netCreditLive != null && spreadWidth != null
    ? (spreadWidth - netCreditLive) * 100 : null;

  const isLive = (mid: number | null) => mid != null;

  const price = t?.price ?? pb?.spotPrice ?? 0;

  const gexLabel = pb?.netGexBillions != null
    ? fmtGex(pb.netGexBillions)
    : '—';

  if (loading && !pb) {
    return (
      <tr style={{ backgroundColor: rowBg }}>
        <Td><MonoVal color="var(--text-primary)">{symbol}</MonoVal></Td>
        <Td><span style={{ opacity: 0.4, fontSize: 10 }}>…</span></Td>
        {Array.from({ length: 22 }).map((_, i) => <Td key={i}><Dash /></Td>)}
      </tr>
    );
  }

  return (
    <tr style={{ backgroundColor: rowBg }}>

      {/* Ticker */}
      <Td>
        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: 'var(--text-primary)', fontSize: 12, letterSpacing: '0.05em' }}>
          {symbol}
        </span>
        {se?.dte != null && (
          <span style={{ fontSize: 8, color: 'var(--text-muted)', marginLeft: 5 }}>{se.dte}d</span>
        )}
      </Td>

      {/* Señal — usa VL (todas las capas) si disponible, fallback a PB */}
      <Td center>
        {vl ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
            <SignalPill signal={vl.overallSignal} />
            {vl.failedAtLayer != null && (
              <span style={{ fontSize: 7, color: 'var(--text-muted)', fontFamily: 'Inter, sans-serif' }}>
                falla L{vl.failedAtLayer}
              </span>
            )}
          </div>
        ) : pb ? <SignalPill signal={pb.overallSignal} /> : <Dash />}
      </Td>

      {/* Precio */}
      <Td right>
        <MonoVal color="var(--text-primary)">{price > 0 ? fmtPrice(price) : '—'}</MonoVal>
      </Td>

      {/* Call Wall */}
      <Td right>
        <MonoVal color="#22c55e">{se?.callWall != null ? fmtPrice(se.callWall, 0) : '—'}</MonoVal>
      </Td>

      {/* ZGL */}
      <Td right>
        <MonoVal>{pb?.gammaZeroLevel != null ? fmtPrice(pb.gammaZeroLevel, 0) : '—'}</MonoVal>
      </Td>

      {/* Put Wall */}
      <Td right>
        <MonoVal color="#f43f5e">{se?.putWall != null ? fmtPrice(se.putWall, 0) : '—'}</MonoVal>
      </Td>

      {/* Z-Spot */}
      <Td right>
        {se?.zScore != null ? (
          <MonoVal color={Math.abs(se.zScore) >= 1.5 ? '#f59e0b' : 'var(--text-secondary)'}>
            {se.zScore > 0 ? '+' : ''}{se.zScore.toFixed(2)}
          </MonoVal>
        ) : <Dash />}
      </Td>

      {/* GEX */}
      <Td right>
        <MonoVal>{gexLabel}</MonoVal>
      </Td>

      {/* Expected Move */}
      <Td right>
        <MonoVal>{se?.expectedMove ? `±${fmtPrice(se.expectedMove, 1)}` : '—'}</MonoVal>
      </Td>

      {/* Estructura */}
      <Td center>
        <StructurePill structure={structure} />
      </Td>

      {/* Strikes */}
      <Td right><MonoVal color="#f43f5e">{se?.longPutStrike   != null ? fmtPrice(se.longPutStrike,   0) : '—'}</MonoVal></Td>
      <Td right><MonoVal color="#f43f5e">{se?.shortPutStrike  != null ? fmtPrice(se.shortPutStrike,  0) : '—'}</MonoVal></Td>
      <Td right><MonoVal color="#22c55e">{se?.shortCallStrike != null ? fmtPrice(se.shortCallStrike, 0) : '—'}</MonoVal></Td>
      <Td right><MonoVal color="#22c55e">{se?.longCallStrike  != null ? fmtPrice(se.longCallStrike,  0) : '—'}</MonoVal></Td>

      {/* Premiums live */}
      <Td right>
        {longPutMid != null ? (
          <span><MonoVal>{fmtPrice(longPutMid, 2)}</MonoVal><LiveDot live={isLive(longPutMid)} /></span>
        ) : ls?.longPut ? <span style={{ opacity: 0.4, fontSize: 10 }}>…</span> : <Dash />}
      </Td>
      <Td right>
        {shortPutMid != null ? (
          <span><MonoVal>{fmtPrice(shortPutMid, 2)}</MonoVal><LiveDot live={isLive(shortPutMid)} /></span>
        ) : ls?.shortPut ? <span style={{ opacity: 0.4, fontSize: 10 }}>…</span> : <Dash />}
      </Td>
      <Td right>
        {shortCallMid != null ? (
          <span><MonoVal>{fmtPrice(shortCallMid, 2)}</MonoVal><LiveDot live={isLive(shortCallMid)} /></span>
        ) : ls?.shortCall ? <span style={{ opacity: 0.4, fontSize: 10 }}>…</span> : <Dash />}
      </Td>
      <Td right>
        {longCallMid != null ? (
          <span><MonoVal>{fmtPrice(longCallMid, 2)}</MonoVal><LiveDot live={isLive(longCallMid)} /></span>
        ) : ls?.longCall ? <span style={{ opacity: 0.4, fontSize: 10 }}>…</span> : <Dash />}
      </Td>

      {/* Net Credit live */}
      <Td right>
        {netCreditLive != null ? (
          <span>
            <MonoVal color={netCreditLive > 0 ? '#22c55e' : '#f43f5e'}>
              ${fmtPrice(netCreditLive, 2)}
            </MonoVal>
            <LiveDot live />
          </span>
        ) : rs?.maxProfit != null ? (
          <MonoVal color="var(--text-muted)">${fmtPrice(Number(rs.maxProfit) / 100 / contracts, 2)}</MonoVal>
        ) : <Dash />}
      </Td>

      {/* 1/3 Rule — credit / spread_width × 100. Target ≥ 33.3% */}
      <Td right>
        {(() => {
          const liveRatio = netCreditLive != null && spreadWidth != null && spreadWidth > 0
            ? (netCreditLive / spreadWidth) * 100 : null;
          const ratio = liveRatio ?? se?.creditRatio ?? null;
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
        {se?.pop != null ? (
          <MonoVal color="#22c55e">{se.pop.toFixed(0)}%</MonoVal>
        ) : <Dash />}
      </Td>

      {/* Máx Profit */}
      <Td right>
        {maxProfitLive != null ? (
          <span><MonoVal color="#22c55e">${fmtPrice(maxProfitLive, 0)}</MonoVal><LiveDot live /></span>
        ) : rs?.maxProfit != null ? (
          <MonoVal color="var(--text-muted)">${fmtPrice(Number(rs.maxProfit), 0)}</MonoVal>
        ) : <Dash />}
      </Td>

      {/* Máx Loss */}
      <Td right>
        {maxLossLive != null ? (
          <span><MonoVal color="#f43f5e">${fmtPrice(maxLossLive, 0)}</MonoVal><LiveDot live /></span>
        ) : rs?.maxLoss != null ? (
          <MonoVal color="var(--text-muted)">${fmtPrice(Number(rs.maxLoss), 0)}</MonoVal>
        ) : <Dash />}
      </Td>

      {/* BPR */}
      <Td right>
        {bprLive != null ? (
          <span><MonoVal>${fmtPrice(bprLive, 0)}</MonoVal><LiveDot live /></span>
        ) : rs?.buyingPowerReq != null ? (
          <MonoVal color="var(--text-muted)">${fmtPrice(Number(rs.buyingPowerReq), 0)}</MonoVal>
        ) : <Dash />}
      </Td>

    </tr>
  );
}

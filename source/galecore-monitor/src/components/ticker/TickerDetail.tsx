import React, { useState, useCallback } from 'react';
import { X, RefreshCw } from 'lucide-react';
import { GexChart } from '../chart/GexChart';
import { ValidationLayers } from '../validation/ValidationLayers';
import { useMarketStore } from '../../store/useMarketStore';
import { useAccountStore } from '../../store/useAccountStore';
import { useRulesStore } from '../../store/useRulesStore';
import { fetchGammaExposure } from '../../api/analytics';
import { GammaExposureResponse } from '../../types/api';
import { fmtTime, isStale } from '../../utils/formatters';
import { LayerStatus, SignalType } from '../../types/market';

interface Props {
  symbol: string;
  onClose: () => void;
}

function deriveLayersWithGex(
  symbol: string,
  gexData: GammaExposureResponse | null,
  ivRankMin: number,
  ivRankMax: number,
  gexMinB: number,
  dteDays: number,
): LayerStatus {
  const t = useMarketStore.getState().tickers[symbol];
  const ivRankOk   = t?.ivRank != null ? t.ivRank >= ivRankMin && t.ivRank <= ivRankMax : null;
  const gexValue   = gexData ? gexData.netGex : null;
  const gexOk      = gexValue != null ? gexValue >= gexMinB : null;
  const spotAboveZgl = gexData && t?.price ? t.price > gexData.zeroGammaLevel : null;

  let passCount = 0, totalDefined = 0;
  [ivRankOk, gexOk, spotAboveZgl].forEach(v => {
    if (v !== null) { totalDefined++; if (v) passCount++; }
  });

  const signal: SignalType =
    totalDefined === 0          ? 'NO OPERAR' :
    passCount === totalDefined  ? 'OPERAR'    :
    passCount >= Math.ceil(totalDefined / 2) ? 'ESPERAR' :
                                  'NO OPERAR';

  const rawIv = dteDays <= 15
    ? (t?.iv9d ?? t?.iv30 ?? 0)
    : dteDays <= 60
      ? (t?.iv30 ?? 0)
      : (t?.iv3m ?? t?.iv30 ?? 0);
  const iv = rawIv > 0 ? rawIv / 100 : 0;
  const expectedMove = t?.price && iv ? t.price * iv * Math.sqrt(dteDays / 365) : null;

  let atmStrike = null, atmCallOI = null, atmPutOI = null, atmCallDelta = null, atmPutDelta = null;
  if (gexData?.strikes?.length && t?.price) {
    const atm = gexData.strikes.reduce((prev, curr) =>
      Math.abs(curr.strike - t.price) < Math.abs(prev.strike - t.price) ? curr : prev
    );
    atmStrike    = atm.strike;
    atmCallOI    = atm.callOI    ?? null;
    atmPutOI     = atm.putOI     ?? null;
    atmCallDelta = atm.callDelta ?? null;
    atmPutDelta  = atm.putDelta  ?? null;
  }

  return {
    vixTermStructureOk: null,
    ivRankOk, ivRankValue: t?.ivRank ?? null,
    gexOk, gexValue,
    spotAboveZgl, zglValue: gexData?.zeroGammaLevel ?? null,
    expectedMove,
    callWall: gexData?.callWall ?? null,
    putWall:  gexData?.putWall  ?? null,
    atmStrike, atmCallOI, atmPutOI, atmCallDelta, atmPutDelta,
    signal,
  };
}

const DETAIL_HEIGHT = 500; // px — chart fills this minus header

export function TickerDetail({ symbol, onClose }: Props) {
  const ticker = useMarketStore((s) => s.tickers[symbol]);
  const { balances, positions } = useAccountStore();
  const { rules } = useRulesStore();

  const [gexData,    setGexData]    = useState<GammaExposureResponse | null>(null);
  const [gexLoading, setGexLoading] = useState(false);
  const [gexError,   setGexError]   = useState<string | null>(null);
  const [gexUpdated, setGexUpdated] = useState<Date | null>(null);

  const loadGex = useCallback(() => {
    setGexLoading(true);
    setGexError(null);
    fetchGammaExposure(symbol)
      .then(d => { setGexData(d); setGexUpdated(new Date()); })
      .catch(e => setGexError(e.message))
      .finally(() => setGexLoading(false));
  }, [symbol]);

  React.useEffect(() => { loadGex(); }, [loadGex]);

  const ivRankMin = rules?.options_filters?.iv_rank?.min  ?? 25;
  const ivRankMax = rules?.options_filters?.iv_rank?.max  ?? 65;
  const gexMinB   = rules?.gamma_regime?.gex_total?.min_billion_usd ?? 100;
  const dteDays   = rules?.trade_construction?.dte_target?.ideal    ?? 35;

  const layers = deriveLayersWithGex(symbol, gexData, ivRankMin, ivRankMax, gexMinB, dteDays);

  const gexStale = isStale(gexUpdated);

  return (
    <div
      style={{
        margin: '0 12px 12px',
        borderRadius: 10,
        overflow: 'hidden',
        border: '1px solid var(--border)',
        backgroundColor: 'var(--bg-secondary)',
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 14px',
        borderBottom: '1px solid var(--border-dark)',
        backgroundColor: 'var(--bg-tertiary)',
      }}>
        <span style={{
          fontFamily: 'JetBrains Mono, monospace',
          fontWeight: 700, fontSize: 13,
          color: 'var(--text-primary)',
          letterSpacing: '0.04em',
        }}>
          {symbol} · Detalle
        </span>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {gexUpdated && (
            <span style={{
              fontSize: 10,
              fontFamily: 'JetBrains Mono, monospace',
              color: gexStale ? 'var(--yellow-gc)' : 'var(--text-muted)',
            }}>
              GEX {fmtTime(gexUpdated)}
            </span>
          )}
          <button
            onClick={loadGex}
            disabled={gexLoading}
            className="btn"
            title="Refrescar GEX"
          >
            <RefreshCw size={10} className={gexLoading ? 'animate-spin' : ''} />
            GEX
          </button>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--text-muted)', lineHeight: 1, padding: 2,
              borderRadius: 4, transition: 'color 150ms',
            }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-primary)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* ── Body ─────────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', height: DETAIL_HEIGHT }}>

        {/* Left: validation layers — fixed width, scrollable */}
        <div style={{
          width: 230,
          flexShrink: 0,
          borderRight: '1px solid var(--border-dark)',
          overflowY: 'auto',
        }}>
          <ValidationLayers
            symbol={symbol}
            layers={layers}
            ivRank={ticker?.ivRank ?? null}
            iv30={ticker?.iv30 ?? null}
            netLiq={balances?.netLiquidatingValue ?? null}
            openPositions={positions.length}
            maxPositions={rules?.risk_limits?.max_concurrent_positions ?? 3}
          />
        </div>

        {/* Right: chart — fills remaining space */}
        <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
          {gexError ? (
            <div style={{ padding: 16, fontSize: 12, color: 'var(--red-gc)' }}>
              Error cargando GEX: {gexError}
            </div>
          ) : gexLoading && !gexData ? (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              height: '100%', gap: 8, fontSize: 12, color: 'var(--text-muted)',
            }}>
              <span className="spinner" /> Cargando GEX…
            </div>
          ) : (
            <GexChart
              symbol={symbol}
              currentPrice={ticker?.price ?? 0}
              openPrice={ticker?.open ?? 0}
              iv30={ticker?.iv30}
              gexData={gexData}
            />
          )}
        </div>
      </div>
    </div>
  );
}

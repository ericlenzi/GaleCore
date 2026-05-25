import React, { useEffect, useRef } from 'react';
import { X, RefreshCw } from 'lucide-react';
import { GexChart } from '../chart/GexChart';
import { ValidationLayers } from '../validation/ValidationLayers';
import { useMarketStore } from '../../store/useMarketStore';
import { useValidationStore } from '../../store/useValidationStore';
import { LayerStatus, SignalType } from '../../types/market';
import { ValidationLayerApiResponse } from '../../types/api';
import { fmtTime, isStale } from '../../utils/formatters';

interface Props {
  symbol: string;
  onClose: () => void;
}

const AUTO_REFRESH_MS = 30_000;

function mapValidationToLayers(v: ValidationLayerApiResponse): LayerStatus {
  const l1 = v.layer1;
  const l2 = v.layer2;
  const l3 = v.layer3;
  const g = v.gexData;

  const signalMap: Record<string, SignalType> = {
    'OPERAR': 'OPERAR',
    'ESPERAR': 'ESPERAR',
    'NO_OPERAR': 'NO OPERAR',
  };

  let gexCallWall: number | null = null;
  let gexPutWall: number | null = null;
  if (g && g.strikes?.length) {
    const cw = g.strikes.reduce((best, s) => (s.callGEX > best.callGEX ? s : best), g.strikes[0]);
    const pw = g.strikes.reduce((best, s) => (s.putGEX < best.putGEX ? s : best), g.strikes[0]);
    gexCallWall = cw.strike;
    gexPutWall = pw.strike;
  }

  return {
    vixTermStructureOk: l1?.vixTermStructure.passed ?? null,
    ivRankOk: l1?.ivRank.passed ?? null,
    ivRankValue: l1?.ivRank.value ?? null,
    gexOk: l1?.gexTotal.passed ?? null,
    gexValue: l1?.gexTotal.value ?? null,
    spotAboveZgl: l1?.spotVsZGL.passed ?? null,
    zglValue: l1?.spotVsZGL.zgl ?? g?.gammaZeroLevel ?? null,

    expectedMove: l2?.expectedMove ?? null,
    callWall: l2?.callWall ?? gexCallWall,
    putWall: l2?.putWall ?? gexPutWall,

    atmStrike: l3?.atmStrike ?? null,
    atmCallOI: l3?.shortCallOI?.value ?? null,
    atmPutOI: l3?.shortPutOI?.value ?? null,
    atmCallDelta: l3?.atmCallDelta ?? null,
    atmPutDelta: l3?.atmPutDelta ?? null,

    signal: signalMap[v.signal] ?? 'NO OPERAR',
  };
}

const DETAIL_HEIGHT = 500;

export function TickerDetail({ symbol, onClose }: Props) {
  const ticker = useMarketStore((s) => s.tickers[symbol]);
  const cached = useValidationStore((s) => s.cache[symbol]);
  const loading = useValidationStore((s) => s.loading[symbol] ?? false);
  const error = useValidationStore((s) => s.error[symbol] ?? null);
  const fetchValidation = useValidationStore((s) => s.fetchValidation);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Initial load (only if no cache) + auto-refresh every 30s
  useEffect(() => {
    if (!cached) fetchValidation(symbol);

    intervalRef.current = setInterval(() => fetchValidation(symbol), AUTO_REFRESH_MS);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [symbol]); // eslint-disable-line react-hooks/exhaustive-deps

  const vlData = cached?.vlData ?? null;
  const gexData = cached?.gexData ?? null;
  const updated = cached?.updatedAt ?? null;

  const iv30 = (() => {
    const l2 = vlData?.layer2;
    const g = vlData?.gexData;
    if (l2 && l2.expectedMove > 0 && g && g.spot > 0 && g.dte > 0) {
      return (l2.expectedMove / g.spot) / Math.sqrt(g.dte / 365) * 100;
    }
    return undefined;
  })();

  const layers: LayerStatus = vlData
    ? mapValidationToLayers(vlData)
    : {
        vixTermStructureOk: null, ivRankOk: null, ivRankValue: null,
        gexOk: null, gexValue: null, spotAboveZgl: null, zglValue: null,
        expectedMove: null, callWall: null, putWall: null,
        atmStrike: null, atmCallOI: null, atmPutOI: null,
        atmCallDelta: null, atmPutDelta: null, signal: 'NO OPERAR',
      };

  const stale = isStale(updated);

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
          {symbol} · Details
        </span>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {updated && (
            <span style={{
              fontSize: 10,
              fontFamily: 'JetBrains Mono, monospace',
              color: stale ? 'var(--yellow-gc)' : 'var(--text-muted)',
            }}>
              {fmtTime(updated)}
            </span>
          )}
          <button
            onClick={() => fetchValidation(symbol)}
            disabled={loading}
            className="btn"
            title="Refrescar validación"
          >
            <RefreshCw size={10} className={loading ? 'animate-spin' : ''} />
            Reload
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
            vlData={vlData}
          />
        </div>

        {/* Right: chart — fills remaining space */}
        <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
          {error ? (
            <div style={{ padding: 16, fontSize: 12, color: 'var(--red-gc)' }}>
              Error cargando datos: {error}
            </div>
          ) : loading && !gexData ? (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              height: '100%', gap: 8, fontSize: 12, color: 'var(--text-muted)',
            }}>
              <span className="spinner" /> Loading…
            </div>
          ) : !gexData ? (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              height: '100%', fontSize: 12, color: 'var(--text-muted)',
            }}>
              No GEX data
            </div>
          ) : (
            <GexChart
              symbol={symbol}
              currentPrice={ticker?.price ?? 0}
              openPrice={ticker?.open ?? 0}
              iv30={iv30}
              gexData={gexData}
            />
          )}
        </div>
      </div>
    </div>
  );
}

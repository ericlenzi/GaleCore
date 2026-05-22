import React, { useState, useCallback } from 'react';
import { X, RefreshCw } from 'lucide-react';
import { GexChart } from '../chart/GexChart';
import { ValidationLayers } from '../validation/ValidationLayers';
import { useMarketStore } from '../../store/useMarketStore';
import { fetchGammaExposure, fetchValidationLayer } from '../../api/analytics';
import { GammaExposureResponse, ValidationLayerApiResponse } from '../../types/api';
import { fmtTime, isStale } from '../../utils/formatters';
import { LayerStatus, SignalType } from '../../types/market';

interface Props {
  symbol: string;
  onClose: () => void;
}

function mapValidationToLayers(v: ValidationLayerApiResponse): LayerStatus {
  const l1 = v.layer1;
  const l2 = v.layer2;
  const l3 = v.layer3;

  const signalMap: Record<string, SignalType> = {
    'OPERAR': 'OPERAR',
    'ESPERAR': 'ESPERAR',
    'NO_OPERAR': 'NO OPERAR',
  };

  return {
    vixTermStructureOk: l1?.vixTermStructure.passed ?? null,
    ivRankOk: l1?.ivRank.passed ?? null,
    ivRankValue: l1?.ivRank.value ?? null,
    gexOk: l1?.gexTotal.passed ?? null,
    gexValue: l1?.gexTotal.value ?? null,
    spotAboveZgl: l1?.spotVsZGL.passed ?? null,
    zglValue: l1?.spotVsZGL.zgl ?? null,

    expectedMove: l2?.expectedMove ?? null,
    callWall: l2?.callWall ?? null,
    putWall: l2?.putWall ?? null,

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

  const [vlData, setVlData] = useState<ValidationLayerApiResponse | null>(null);
  const [gexData, setGexData] = useState<GammaExposureResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updated, setUpdated] = useState<Date | null>(null);

  const loadData = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      fetchValidationLayer(symbol),
      fetchGammaExposure(symbol),
    ])
      .then(([vl, gex]) => {
        setVlData(vl);
        setGexData(gex);
        setUpdated(new Date());
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [symbol]);

  React.useEffect(() => { loadData(); }, [loadData]);

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
          {symbol} · Detalle
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
            onClick={loadData}
            disabled={loading}
            className="btn"
            title="Refrescar validación"
          >
            <RefreshCw size={10} className={loading ? 'animate-spin' : ''} />
            Validar
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
              <span className="spinner" /> Cargando…
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

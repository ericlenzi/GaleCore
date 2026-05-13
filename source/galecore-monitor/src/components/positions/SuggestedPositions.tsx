import React, { useEffect, useState, useCallback } from 'react';
import { RefreshCw } from 'lucide-react';
import { SuggestedCard } from './SuggestedCard';
import { SuggestedSetup } from '../../types/position';
import { GammaExposureResponse } from '../../types/api';
import { CoreRules } from '../../types/api';
import { fetchGammaExposure, fetchImpliedVolatility } from '../../api/analytics';
import { useMarketStore } from '../../store/useMarketStore';
import { fmtPrice, fmtGex, signalColor } from '../../utils/formatters';

interface Props {
  symbol: string;
  rules: CoreRules;
  onRegister: (setup: SuggestedSetup) => void;
}

function round5(n: number): number {
  return Math.round(n / 5) * 5;
}

function computeSetups(
  spot: number,
  gexData: GammaExposureResponse,
  iv30: number,           // as percentage e.g. 16.8
  iv9d: number | undefined,
  iv3m: number | undefined,
  rules: CoreRules,
): SuggestedSetup[] {
  const dte = gexData.dte;
  const expiration = gexData.expiration;

  const rawIv = dte <= 15 ? (iv9d ?? iv30) : dte <= 60 ? iv30 : (iv3m ?? iv30);
  if (!rawIv) return [];
  const iv = rawIv / 100;
  const em = spot * iv * Math.sqrt(dte / 365);

  const symOverrides = rules.trade_construction?.spread_width?.symbol_overrides ?? {};
  const width = (symOverrides[gexData.symbol] ?? rules.trade_construction?.spread_width?.default_points ?? 5) as number;
  const maxDeltaAbs = rules.trade_construction?.short_leg_delta?.max_abs ?? 0.30;
  const creditRatioMin = rules.trade_construction?.premium_capture?.tiers?.[0]?.min_credit_width_ratio ?? 0.10;

  const findNearest = (strike: number) =>
    gexData.strikes.reduce((prev, curr) =>
      Math.abs(curr.strike - strike) < Math.abs(prev.strike - strike) ? curr : prev
    );

  // ─ PUT CS ────────────────────────────────────────────────────────────────
  let putShort = round5(spot - em);
  if (gexData.putWall  && putShort < gexData.putWall)            putShort = round5(gexData.putWall);
  if (gexData.callWall && putShort > gexData.callWall - width)   putShort = round5(gexData.callWall - width);
  const putLong = putShort - width;
  const putShortData = findNearest(putShort);
  const putPop = putShortData.putDelta != null
    ? (1 - Math.abs(putShortData.putDelta)) * 100
    : null;

  // ─ CALL CS ───────────────────────────────────────────────────────────────
  let callShort = round5(spot + em);
  if (gexData.callWall && callShort > gexData.callWall)          callShort = round5(gexData.callWall);
  if (gexData.putWall  && callShort < gexData.putWall + width)   callShort = round5(gexData.putWall + width);
  const callLong = callShort + width;
  const callShortData = findNearest(callShort);
  const callPop = callShortData.callDelta != null
    ? (1 - Math.abs(callShortData.callDelta)) * 100
    : null;

  const icPop = putPop != null && callPop != null ? Math.min(putPop, callPop) : null;

  return [
    {
      type: 'PUT_CS',
      shortStrike: putShort, longStrike: putLong,
      expiration, dte, width,
      shortLegOI:    putShortData.putOI   ?? null,
      shortLegDelta: putShortData.putDelta ?? null,
      pop: putPop, creditRatioMin, maxDeltaAbs, estimatedCredit: null,
    },
    {
      type: 'CALL_CS',
      shortStrike: callShort, longStrike: callLong,
      expiration, dte, width,
      shortLegOI:    callShortData.callOI    ?? null,
      shortLegDelta: callShortData.callDelta  ?? null,
      pop: callPop, creditRatioMin, maxDeltaAbs, estimatedCredit: null,
    },
    {
      type: 'IC',
      shortStrike: putShort, longStrike: putLong,
      secondShortStrike: callShort, secondLongStrike: callLong,
      expiration, dte, width,
      shortLegOI: Math.min(
        putShortData.putOI   ?? Infinity,
        callShortData.callOI ?? Infinity,
      ) < Infinity ? Math.min(putShortData.putOI ?? Infinity, callShortData.callOI ?? Infinity) : null,
      shortLegDelta: null,
      pop: icPop, creditRatioMin, maxDeltaAbs, estimatedCredit: null,
    },
  ];
}

function SignalPill({ label }: { label: string }) {
  return (
    <span
      className="text-xs font-bold px-2 py-0.5 rounded uppercase tracking-wider"
      style={{ backgroundColor: signalColor(label) + '22', color: signalColor(label), border: `1px solid ${signalColor(label)}44` }}
    >
      {label}
    </span>
  );
}

export function SuggestedPositions({ symbol, rules, onRegister }: Props) {
  const ticker  = useMarketStore((s) => s.tickers[symbol]);

  const [gexData,    setGexData]    = useState<GammaExposureResponse | null>(null);
  const [gexLoading, setGexLoading] = useState(false);
  const [gexError,   setGexError]   = useState<string | null>(null);

  // Local IV state: used if market store hasn't loaded IV yet
  const [localIv30, setLocalIv30] = useState<number>(0);
  const [localIv9d, setLocalIv9d] = useState<number | undefined>();
  const [localIv3m, setLocalIv3m] = useState<number | undefined>();
  const [ivLoading, setIvLoading] = useState(false);

  const loadGex = useCallback(() => {
    setGexLoading(true);
    setGexError(null);
    fetchGammaExposure(symbol)
      .then(setGexData)
      .catch((e) => setGexError(e.message))
      .finally(() => setGexLoading(false));
  }, [symbol]);

  // Fetch IV independently if not available in store
  useEffect(() => {
    if ((ticker?.iv30 ?? 0) > 0) return; // store already has it
    setIvLoading(true);
    fetchImpliedVolatility(symbol)
      .then((d) => {
        setLocalIv30(d.iv30);
        setLocalIv9d(d.iv9d);
        setLocalIv3m(d.iv3m);
        if (d.iv30 > 0) {
          useMarketStore.getState().setIV(symbol, d.iv30, d.iv9d, d.iv3m);
        }
      })
      .catch(() => {})
      .finally(() => setIvLoading(false));
  }, [symbol]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadGex(); }, [loadGex]);

  const spot  = ticker?.price ?? 0;
  // Use store IV if available, else fall back to locally fetched IV
  const iv30  = (ticker?.iv30 && ticker.iv30 > 0) ? ticker.iv30 : localIv30;
  const iv9d  = ticker?.iv9d  ?? localIv9d;
  const iv3m  = ticker?.iv3m  ?? localIv3m;
  const ivRankMin = rules?.options_filters?.iv_rank?.min ?? 25;
  const ivRankMax = rules?.options_filters?.iv_rank?.max ?? 65;
  const gexMin    = rules?.gamma_regime?.gex_total?.min_billion_usd ?? 100;

  // Derive signal from available data
  const ivRankOk  = ticker?.ivRank != null ? ticker.ivRank >= ivRankMin && ticker.ivRank <= ivRankMax : null;
  const gexOk     = gexData ? gexData.netGex >= gexMin : null;
  const zglOk     = gexData && spot ? spot > gexData.zeroGammaLevel : null;
  const checks    = [ivRankOk, gexOk, zglOk].filter((v) => v !== null);
  const passCount = checks.filter(Boolean).length;
  const signal    = checks.length === 0 ? 'NO OPERAR'
                  : passCount === checks.length ? 'OPERAR'
                  : passCount >= Math.ceil(checks.length / 2) ? 'ESPERAR'
                  : 'NO OPERAR';
  const canTrade  = signal === 'OPERAR';

  const setups = gexData && spot > 0 && iv30 > 0
    ? computeSetups(spot, gexData, iv30, iv9d, iv3m, rules)
    : [];

  return (
    <div className="p-3">
      {/* Section header */}
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
          Posiciones Sugeridas
        </div>
        <button
          onClick={loadGex}
          disabled={gexLoading}
          className="flex items-center gap-1 px-2 py-1 rounded text-xs"
          style={{ color: 'var(--text-muted)', background: 'none', border: '1px solid var(--border-dark)', cursor: 'pointer' }}
        >
          <RefreshCw size={10} className={gexLoading ? 'animate-spin' : ''} />
          GEX
        </button>
      </div>

      <div className="flex gap-3" style={{ alignItems: 'flex-start' }}>
        {/* ── Left: signal summary ── */}
        <div
          className="rounded p-3 shrink-0"
          style={{ width: 160, border: '1px solid var(--border-dark)', backgroundColor: 'var(--bg-secondary)' }}
        >
          <div className="text-xs font-bold mb-2" style={{ color: 'var(--text-primary)' }}>{symbol}</div>

          <div className="mb-2"><SignalPill label={signal} /></div>

          <div className="space-y-1 mt-2">
            <div className="flex justify-between text-xs">
              <span style={{ color: 'var(--text-muted)' }}>IV Rank</span>
              <span className="font-mono" style={{ color: ivRankOk === true ? 'var(--green)' : ivRankOk === false ? 'var(--red-gc)' : 'var(--text-muted)' }}>
                {ticker?.ivRank?.toFixed(0) ?? '—'}
              </span>
            </div>
            <div className="flex justify-between text-xs">
              <span style={{ color: 'var(--text-muted)' }}>GEX</span>
              <span className="font-mono" style={{ color: gexOk === true ? 'var(--green)' : gexOk === false ? 'var(--red-gc)' : 'var(--text-muted)' }}>
                {gexData ? fmtGex(gexData.netGex) : '—'}
              </span>
            </div>
            <div className="flex justify-between text-xs">
              <span style={{ color: 'var(--text-muted)' }}>Spot</span>
              <span className="font-mono" style={{ color: 'var(--text-primary)' }}>
                {spot > 0 ? fmtPrice(spot) : '—'}
              </span>
            </div>
            <div className="flex justify-between text-xs">
              <span style={{ color: 'var(--text-muted)' }}>ZGL</span>
              <span className="font-mono" style={{ color: zglOk === true ? 'var(--green)' : zglOk === false ? 'var(--red-gc)' : 'var(--text-muted)' }}>
                {gexData ? fmtPrice(gexData.zeroGammaLevel) : '—'}
              </span>
            </div>
            <div className="flex justify-between text-xs">
              <span style={{ color: 'var(--text-muted)' }}>IV30</span>
              <span className="font-mono" style={{ color: iv30 > 0 ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                {ivLoading ? '…' : iv30 > 0 ? `${iv30.toFixed(1)}%` : '—'}
              </span>
            </div>
            {gexData && (
              <div className="flex justify-between text-xs">
                <span style={{ color: 'var(--text-muted)' }}>DTE</span>
                <span className="font-mono" style={{ color: 'var(--text-primary)' }}>{gexData.dte}</span>
              </div>
            )}
          </div>
        </div>

        {/* ── Right: cards ── */}
        <div className="flex-1 min-w-0">
          {gexLoading && (
            <div className="flex items-center gap-2 text-xs py-6 justify-center" style={{ color: 'var(--text-muted)' }}>
              <span className="spinner" /> Cargando GEX…
            </div>
          )}
          {gexError && (
            <div className="text-xs py-4" style={{ color: 'var(--red-gc)' }}>
              Error GEX: {gexError}
            </div>
          )}
          {!gexLoading && !gexError && setups.length === 0 && (
            <div className="text-xs py-6 text-center" style={{ color: 'var(--text-muted)' }}>
              {ivLoading
                ? <span className="flex items-center justify-center gap-2"><span className="spinner" /> Cargando IV…</span>
                : iv30 === 0
                  ? 'IV no disponible — la API puede no tener datos fuera de horario'
                  : 'Sin datos suficientes para calcular setups'
              }
            </div>
          )}
          {!gexLoading && setups.length > 0 && (
            <div className="flex gap-2 flex-wrap">
              {setups.map((s) => (
                <SuggestedCard
                  key={s.type}
                  setup={s}
                  symbol={symbol}
                  canTrade={canTrade}
                  onRegister={onRegister}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

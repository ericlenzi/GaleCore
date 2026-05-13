import { useEffect, useRef } from 'react';
import { TickerCard } from './TickerCard';
import { useMarketStore } from '../../store/useMarketStore';
import { useRulesStore } from '../../store/useRulesStore';
import { fetchMarketDataByType } from '../../api/marketdata';
import { fetchIVRank, fetchImpliedVolatility } from '../../api/analytics';
import { LayerStatus, SignalType } from '../../types/market';

interface Props {
  selectedSymbol: string | null;
  onSelect: (symbol: string | null) => void;
}

const VIX_POLL_MS = 5 * 60 * 1000; // every 5 minutes

function deriveLayerStatus(
  symbol: string,
  store: ReturnType<typeof useMarketStore.getState>,
  ivRankMin: number,
  ivRankMax: number,
): LayerStatus {
  const t = store.tickers[symbol];
  const nullAtm = { atmStrike: null, atmCallOI: null, atmPutOI: null, atmCallDelta: null, atmPutDelta: null };
  if (!t) {
    return {
      vixTermStructureOk: null, ivRankOk: null, ivRankValue: null,
      gexOk: null, gexValue: null, spotAboveZgl: null, zglValue: null,
      expectedMove: null, callWall: null, putWall: null, signal: 'NO OPERAR',
      ...nullAtm,
    };
  }

  const ivRankOk = t.ivRank != null ? t.ivRank >= ivRankMin && t.ivRank <= ivRankMax : null;
  const vix9d    = store.vix9d;
  const vix3m    = store.vix3m;
  const vixOk    = vix9d != null && vix3m != null ? vix9d < vix3m : null;

  // Signal from ivRank + vix (GEX loaded only in detail)
  let passCount = 0, total = 0;
  [ivRankOk, vixOk].forEach(v => { if (v !== null) { total++; if (v) passCount++; } });
  const signal: SignalType = total === 0 ? 'NO OPERAR'
    : passCount === total ? 'ESPERAR'  // still need GEX to confirm
    : 'NO OPERAR';

  return {
    vixTermStructureOk: vixOk, ivRankOk,
    ivRankValue: t.ivRank ?? null, gexOk: null, gexValue: null,
    spotAboveZgl: null, zglValue: null, expectedMove: null,
    callWall: null, putWall: null, signal,
    ...nullAtm,
  };
}

export function TickerGrid({ selectedSymbol, onSelect }: Props) {
  const { tickers: symbols = [], rules } = useRulesStore();
  const ivRankMin   = rules?.options_filters?.iv_rank?.min ?? 25;
  const ivRankMax   = rules?.options_filters?.iv_rank?.max ?? 65;
  const marketStore = useMarketStore();
  const { tickers, initTicker, setOpen, setIVRank, setIV, setLoading, setError, setVix } = marketStore;
  const loadedRef   = useRef<Set<string>>(new Set());
  const pollRef     = useRef<Record<string, ReturnType<typeof setInterval>>>({});
  const vixPollRef  = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Load tickers on mount ─────────────────────────────────────────────────
  useEffect(() => {
    symbols.forEach((symbol) => {
      initTicker(symbol);
      if (loadedRef.current.has(symbol)) return;
      loadedRef.current.add(symbol);

      // Price + open + prevClose
      setLoading(symbol, 'price', true);
      fetchMarketDataByType(symbol)
        .then((d) => {
          setOpen(symbol, d.open, d.prevClose, d.volume);
          const t = useMarketStore.getState().tickers[symbol];
          if (!t?.price) {
            useMarketStore.getState().updatePrice(symbol, { price: d.last, size: 0, timestamp: new Date().toISOString() });
          }
          // update bid/ask from initial fetch
          useMarketStore.getState().updateQuote(symbol, { bidPrice: d.bid, askPrice: d.ask, timestamp: new Date().toISOString() });
        })
        .catch((e) => setError(symbol, 'price', e.message))
        .finally(() => setLoading(symbol, 'price', false));

      // IV Rank
      setLoading(symbol, 'ivRank', true);
      fetchIVRank(symbol)
        .then((d) => setIVRank(symbol, d.ivRank))
        .catch((e) => setError(symbol, 'ivRank', e.message))
        .finally(() => setLoading(symbol, 'ivRank', false));

      // IV
      setLoading(symbol, 'iv', true);
      fetchImpliedVolatility(symbol)
        .then((d) => setIV(symbol, d.iv30, d.iv9d, d.iv3m))
        .catch((e) => setError(symbol, 'iv', e.message))
        .finally(() => setLoading(symbol, 'iv', false));
    });

    const polls = pollRef.current;
    return () => { Object.values(polls).forEach(clearInterval); };
  }, [symbols.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── VIX term structure polling ────────────────────────────────────────────
  useEffect(() => {
    const fetchVix = () => {
      Promise.all([
        fetchMarketDataByType('VIX'),
        fetchMarketDataByType('VIX3M'),
      ]).then(([vix, vix3m]) => {
        setVix(vix.last, vix3m.last);
      }).catch(() => {}); // VIX data not critical
    };

    fetchVix(); // immediate
    vixPollRef.current = setInterval(fetchVix, VIX_POLL_MS);
    return () => { if (vixPollRef.current) clearInterval(vixPollRef.current); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── REST fallback polling (if no socket) ─────────────────────────────────
  useEffect(() => {
    const timer = setTimeout(() => {
      symbols.forEach((symbol) => {
        const t = useMarketStore.getState().tickers[symbol];
        if (!t?.isStreaming && !pollRef.current[symbol]) {
          pollRef.current[symbol] = setInterval(() => {
            fetchMarketDataByType(symbol)
              .then((d) => {
                useMarketStore.getState().updatePrice(symbol, { price: d.last, size: 0, timestamp: new Date().toISOString() });
              })
              .catch(() => {});
          }, 30000);
        }
      });
    }, 10000);
    return () => clearTimeout(timer);
  }, [symbols.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!symbols.length) {
    return (
      <div className="p-4 text-xs" style={{ color: 'var(--text-muted)' }}>
        Cargando tickers…
      </div>
    );
  }

  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))' }}>
      {symbols.map((symbol) => {
        const tickerState = tickers[symbol] ?? {
          symbol, price: 0, open: 0, bid: 0, ask: 0,
          lastUpdate: null, isStreaming: false,
          loading: { price: true, ivRank: true, iv: true, gex: false },
          error: {},
        };
        const layers = deriveLayerStatus(symbol, marketStore, ivRankMin, ivRankMax);
        return (
          <TickerCard
            key={symbol}
            ticker={tickerState}
            layers={layers}
            selected={selectedSymbol === symbol}
            onClick={() => onSelect(selectedSymbol === symbol ? null : symbol)}
          />
        );
      })}
    </div>
  );
}

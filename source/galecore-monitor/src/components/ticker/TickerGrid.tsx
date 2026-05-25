import { useEffect, useRef } from 'react';
import { TickerCard } from './TickerCard';
import { useMarketStore } from '../../store/useMarketStore';
import { useRulesStore } from '../../store/useRulesStore';
import { fetchMarketDataBatch } from '../../api/marketdata';

interface Props {
  selectedSymbol: string | null;
  onSelect: (symbol: string | null) => void;
}

function applyMarketData(d: { symbol: string; open: number; prevClose?: number; volume: number; last: number; bid: number; ask: number }) {
  const store = useMarketStore.getState();
  store.setOpen(d.symbol, d.open, d.prevClose, d.volume);
  if (!store.tickers[d.symbol]?.price) {
    store.updatePrice(d.symbol, { price: d.last, size: 0, timestamp: new Date().toISOString() });
  }
  store.updateQuote(d.symbol, { bidPrice: d.bid, askPrice: d.ask, timestamp: new Date().toISOString() });
}

export function TickerGrid({ selectedSymbol, onSelect }: Props) {
  const { tickers: symbols = [], loading: rulesLoading, error: rulesError } = useRulesStore();
  const marketStore = useMarketStore();
  const { tickers, initTicker, setLoading, setError } = marketStore;
  const loadedRef   = useRef(false);
  const pollRef     = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Load all tickers in a single batch call ───────────────────────────────
  useEffect(() => {
    if (!symbols.length || loadedRef.current) return;
    loadedRef.current = true;

    symbols.forEach((s) => {
      initTicker(s);
      setLoading(s, 'price', true);
    });

    fetchMarketDataBatch(symbols)
      .then((results) => {
        results.forEach(applyMarketData);
      })
      .catch((e) => {
        symbols.forEach((s) => setError(s, 'price', e.message));
      })
      .finally(() => {
        symbols.forEach((s) => setLoading(s, 'price', false));
      });
  }, [symbols.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── REST fallback polling (single batch call) ─────────────────────────────
  useEffect(() => {
    const timer = setTimeout(() => {
      const noStream = symbols.filter((s) => !useMarketStore.getState().tickers[s]?.isStreaming);
      if (noStream.length && !pollRef.current) {
        pollRef.current = setInterval(() => {
          fetchMarketDataBatch(noStream)
            .then((results) => {
              results.forEach((d) => {
                useMarketStore.getState().updatePrice(d.symbol, { price: d.last, size: 0, timestamp: new Date().toISOString() });
              });
            })
            .catch(() => {});
        }, 30000);
      }
    }, 10000);
    return () => {
      clearTimeout(timer);
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [symbols.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  if (rulesLoading) {
    return (
      <div className="p-4 text-xs" style={{ color: 'var(--text-muted)' }}>
        Cargando tickers…
      </div>
    );
  }

  if (rulesError) {
    return (
      <div className="p-4 text-xs" style={{ color: 'var(--red-gc)' }}>
        Error cargando reglas: {rulesError}
      </div>
    );
  }

  if (!symbols.length) {
    return (
      <div className="p-4 text-xs" style={{ color: 'var(--text-muted)' }}>
        No hay tickers configurados
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
        return (
          <TickerCard
            key={symbol}
            ticker={tickerState}
            selected={selectedSymbol === symbol}
            onClick={() => onSelect(selectedSymbol === symbol ? null : symbol)}
          />
        );
      })}
    </div>
  );
}

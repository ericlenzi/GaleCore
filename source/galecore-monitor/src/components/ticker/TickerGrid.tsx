import { useEffect, useRef } from 'react';
import { TickerCard } from './TickerCard';
import { useMarketStore } from '../../store/useMarketStore';
import { useRulesStore } from '../../store/useRulesStore';
import { fetchMarketDataByType } from '../../api/marketdata';

interface Props {
  selectedSymbol: string | null;
  onSelect: (symbol: string | null) => void;
}

export function TickerGrid({ selectedSymbol, onSelect }: Props) {
  const { tickers: symbols = [], loading: rulesLoading, error: rulesError } = useRulesStore();
  const marketStore = useMarketStore();
  const { tickers, initTicker, setOpen, setLoading, setError } = marketStore;
  const loadedRef   = useRef<Set<string>>(new Set());
  const pollRef     = useRef<Record<string, ReturnType<typeof setInterval>>>({});

  // ── Load tickers on mount ─────────────────────────────────────────────────
  useEffect(() => {
    symbols.forEach((symbol) => {
      initTicker(symbol);
      if (loadedRef.current.has(symbol)) return;
      loadedRef.current.add(symbol);

      setLoading(symbol, 'price', true);
      fetchMarketDataByType(symbol)
        .then((d) => {
          setOpen(symbol, d.open, d.prevClose, d.volume);
          const t = useMarketStore.getState().tickers[symbol];
          if (!t?.price) {
            useMarketStore.getState().updatePrice(symbol, { price: d.last, size: 0, timestamp: new Date().toISOString() });
          }
          useMarketStore.getState().updateQuote(symbol, { bidPrice: d.bid, askPrice: d.ask, timestamp: new Date().toISOString() });
        })
        .catch((e) => setError(symbol, 'price', e.message))
        .finally(() => setLoading(symbol, 'price', false));
    });

    const polls = pollRef.current;
    return () => { Object.values(polls).forEach(clearInterval); };
  }, [symbols.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

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

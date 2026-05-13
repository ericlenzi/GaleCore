import { create } from 'zustand';
import { TickerState } from '../types/market';
import { TradePayload, QuotePayload } from '../types/api';

interface MarketStore {
  tickers: Record<string, TickerState>;
  // VIX term structure (market-wide)
  vix9d: number | null;
  vix3m: number | null;

  initTicker:   (symbol: string) => void;
  updatePrice:  (symbol: string, data: TradePayload) => void;
  updateQuote:  (symbol: string, data: QuotePayload) => void;
  setOpen:      (symbol: string, open: number, prevClose?: number, volume?: number) => void;
  setStreaming: (symbol: string, streaming: boolean) => void;
  setIVRank:   (symbol: string, ivRank: number) => void;
  setIV:       (symbol: string, iv30: number, iv9d?: number, iv3m?: number) => void;
  setLoading:  (symbol: string, key: keyof TickerState['loading'], value: boolean) => void;
  setError:    (symbol: string, key: keyof TickerState['error'], msg?: string) => void;
  setVix:      (vix9d: number, vix3m: number) => void;
}

const defaultLoading = { price: false, ivRank: false, iv: false, gex: false };
const defaultError   = {};

export const useMarketStore = create<MarketStore>((set) => ({
  tickers: {},
  vix9d: null,
  vix3m: null,

  initTicker: (symbol) =>
    set((s) => {
      if (s.tickers[symbol]) return s;
      return {
        tickers: {
          ...s.tickers,
          [symbol]: {
            symbol,
            price: 0, open: 0, bid: 0, ask: 0,
            lastUpdate: null,
            isStreaming: false,
            loading: { ...defaultLoading },
            error:   { ...defaultError },
          },
        },
      };
    }),

  updatePrice: (symbol, data) =>
    set((s) => ({
      tickers: {
        ...s.tickers,
        [symbol]: {
          ...s.tickers[symbol],
          price: data.price,
          lastUpdate: new Date(),
          isStreaming: true,
          ...(data.extendedTradingHours != null && { extendedTradingHours: data.extendedTradingHours }),
        },
      },
    })),

  updateQuote: (symbol, data) =>
    set((s) => ({
      tickers: {
        ...s.tickers,
        [symbol]: {
          ...s.tickers[symbol],
          bid: data.bidPrice,
          ask: data.askPrice,
          ...(data.volume != null && { volume: data.volume }),
          lastUpdate: new Date(),
        },
      },
    })),

  setOpen: (symbol, open, prevClose, volume) =>
    set((s) => ({
      tickers: {
        ...s.tickers,
        [symbol]: { ...s.tickers[symbol], open, prevClose, volume },
      },
    })),

  setStreaming: (symbol, streaming) =>
    set((s) => ({
      tickers: { ...s.tickers, [symbol]: { ...s.tickers[symbol], isStreaming: streaming } },
    })),

  setIVRank: (symbol, ivRank) =>
    set((s) => ({
      tickers: { ...s.tickers, [symbol]: { ...s.tickers[symbol], ivRank } },
    })),

  setIV: (symbol, iv30, iv9d, iv3m) =>
    set((s) => ({
      tickers: { ...s.tickers, [symbol]: { ...s.tickers[symbol], iv30, iv9d, iv3m } },
    })),

  setLoading: (symbol, key, value) =>
    set((s) => ({
      tickers: {
        ...s.tickers,
        [symbol]: { ...s.tickers[symbol], loading: { ...s.tickers[symbol]?.loading, [key]: value } },
      },
    })),

  setError: (symbol, key, msg) =>
    set((s) => ({
      tickers: {
        ...s.tickers,
        [symbol]: { ...s.tickers[symbol], error: { ...s.tickers[symbol]?.error, [key]: msg } },
      },
    })),

  setVix: (vix9d, vix3m) => set({ vix9d, vix3m }),
}));

import apiClient from './client';
import { MarketDataByTypeApiResponse, MarketDataByTypeResponse, QuoteResponse, CandleItem } from '../types/api';

export async function fetchMarketDataByType(symbol: string): Promise<MarketDataByTypeResponse> {
  const { data } = await apiClient.get<MarketDataByTypeApiResponse>(
    '/Data/Tastytrade/MarketData/ByType',
    { params: { Symbol: symbol } }
  );
  const item = data?.data?.items?.[0];
  if (!item) throw new Error(`No market data for ${symbol}`);
  return {
    symbol:    item.symbol,
    open:      item.open,
    prevClose: item.prevClose,
    last:      item.last,
    bid:       item.bid,
    ask:       item.ask,
    volume:    item.volume,
  };
}

export async function fetchQuote(symbol: string): Promise<QuoteResponse> {
  const { data } = await apiClient.get<QuoteResponse>(
    '/Data/Tastytrade/MarketData/Quote',
    { params: { Symbol: symbol } }
  );
  return data;
}

/** Today's 09:30 ET in ISO UTC format, for use as fromTime in Candle requests. */
function todayMarketOpenISO(): string {
  const now = new Date();
  const month = now.getUTCMonth() + 1;
  const etOffset = month >= 3 && month <= 11 ? 4 : 5;
  const d = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(),
    9 + etOffset, 30
  ));
  return d.toISOString().replace('.000Z', 'Z');
}

/** Fetch N days of daily candles for a symbol */
export async function fetchDailyCandles(symbol: string, days = 5): Promise<CandleItem[]> {
  const from = new Date();
  from.setUTCDate(from.getUTCDate() - days - 2); // buffer for weekends
  const fromTime = from.toISOString().slice(0, 10);
  const { data } = await apiClient.get<{ data: any[] }>(
    '/Data/Tastytrade/MarketData/Candle',
    { params: { Symbol: symbol, Interval: 'd', FromTime: fromTime }, timeout: 20_000 }
  );
  const raw: any[] = Array.isArray(data) ? data : (data?.data ?? []);
  return raw
    .map((c: any) => {
      const t = typeof c.time === 'number'
        ? (c.time > 1e10 ? Math.floor(c.time / 1000) : c.time)
        : 0;
      return { time: t, open: c.open, high: c.high, low: c.low, close: c.close };
    })
    .filter(c => c.time > 0 && c.close > 0)
    .sort((a, b) => a.time - b.time);
}

export async function fetchEquityCandles(symbol: string, interval = '5m'): Promise<CandleItem[]> {
  const fromTime = todayMarketOpenISO();
  const { data } = await apiClient.get<{ data: any[] }>(
    '/Data/Tastytrade/MarketData/Candle',
    { params: { Symbol: symbol, Interval: interval, FromTime: fromTime }, timeout: 30_000 }
  );
  console.debug(`[Candle] ${symbol}:`, data);
  const raw: any[] = Array.isArray(data) ? data : (data?.data ?? []);
  return raw
    .map((c: any) => {
      // time can be unix ms or unix s
      const t = typeof c.time === 'number'
        ? (c.time > 1e10 ? Math.floor(c.time / 1000) : c.time)
        : 0;
      return { time: t, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume };
    })
    .filter((c) => c.time > 0 && c.close > 0 && c.open > 0)
    .sort((a, b) => a.time - b.time);
}

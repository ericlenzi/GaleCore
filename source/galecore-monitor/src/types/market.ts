export type SignalType = 'OPERAR' | 'ESPERAR' | 'NO OPERAR';

export interface TickerState {
  symbol: string;
  price: number;
  open: number;
  prevClose?: number; // previous session close — basis for daily change
  bid: number;
  ask: number;
  volume?: number;
  lastUpdate: Date | null;
  isStreaming: boolean;
  extendedTradingHours?: boolean;
  ivRank?: number;
  iv30?: number;
  iv9d?: number;
  iv3m?: number;
  loading: {
    price: boolean;
    ivRank: boolean;
    iv: boolean;
    gex: boolean;
  };
  error: {
    price?: string;
    ivRank?: string;
    iv?: string;
    gex?: string;
  };
}

export interface LayerStatus {
  // Layer 1 — Régimen & GEX
  vixTermStructureOk: boolean | null;    // VIX9D < VIX3M
  ivRankOk: boolean | null;              // 25–65
  ivRankValue: number | null;
  ivMomentumOk: boolean | null;          // IV ROC ≤ 12%
  ivMomentumValue: number | null;
  gexOk: boolean | null;                 // ≥ $100B
  gexValue: number | null;               // in billions
  spotAboveZgl: boolean | null;          // Spot > ZGL
  zglValue: number | null;

  // Layer 2 — Motor de strikes
  expectedMove: number | null;
  callWall: number | null;
  putWall: number | null;

  // Layer 3 — Microestructura (ATM)
  atmStrike: number | null;
  atmCallOI: number | null;
  atmPutOI: number | null;
  atmCallDelta: number | null;
  atmPutDelta: number | null;

  // Summary
  signal: SignalType;
}

export type MarketStatus = 'PRE-MARKET' | 'ABIERTO' | 'CERRADO';

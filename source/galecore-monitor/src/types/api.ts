// ─── Rules API ────────────────────────────────────────────────────────────────
// Matches the actual structure returned by /App/GaleCore/Rules/Core
export interface CoreRules {
  _meta: {
    version: string;
    strategy: string;
    last_updated: string;
  };
  universe: {
    tickers: string[];
    min_avg_daily_volume: number;
  };
  macro_regime: {
    vix_structure: {
      max_vix_absolute: number;
    };
    event_buffer: {
      days_to_fomc_min: number;
      days_to_cpi_min: number;
      event_alert_days: number;
    };
    sentiment_canary: {
      max_abs_change_pct: number;
    };
  };
  gamma_regime: {
    gex_total: {
      min_billion_usd: number;
    };
    spot_vs_zero_gamma: {
      buffer_pct: number;
      confirm_bars: number;
    };
    persistence: {
      consecutive_days_min: number;
    };
  };
  options_filters: {
    iv_rank: {
      min: number;
      max: number;
      lookback_days: number;
    };
    liquidity: {
      open_interest_min_short_leg: number;
      open_interest_min_long_leg: number;
      bid_ask_spread_max_pct_mid: number;
    };
  };
  trade_construction: {
    dte_target: {
      min: number;
      max: number;
      ideal: number;
    };
    short_leg_delta: {
      max_abs: number;
    };
    spread_width: {
      default_points: number;
      symbol_overrides: Record<string, number>;
    };
    premium_capture: {
      tiers: Array<{
        iv_rank_min?: number;
        iv_rank_max?: number;
        min_credit_width_ratio: number;
      }>;
    };
  };
  risk_limits: {
    risk_per_trade_pct: number;
    risk_per_trade_usd_max: number;
    portfolio_heat_max_pct: number;
    max_concurrent_positions: number;
    max_positions_per_symbol: number;
  };
  trade_management: {
    take_profit_pct_credit: number;
    stop_loss_pct_credit: number;
    time_exit_dte: number;
    adjustment_protocol: {
      min_dte_to_roll: number;
      min_credit_for_roll: number;
      trigger_loss_pct_credit: number;
    };
    hard_defense: {
      short_leg_delta_max_abs: number;
    };
  };
}

// ─── Analytics API ────────────────────────────────────────────────────────────

// Raw API response from /App.Analytics/GammaExposure
export interface GammaExposureApiResponse {
  symbol: string;
  spot: number;
  expiration: string;
  dte: number;
  expirationType: string;
  gammaZeroLevel: number;
  riskFreeRate: number;
  strikes: GexStrikeApi[];
}

export interface GexStrikeApi {
  strike: number;
  callDelta: number;
  callGamma: number;
  callIV: number;
  callOI: number;
  callGEX: number;
  putDelta: number;
  putGamma: number;
  putIV: number;
  putOI: number;
  putGEX: number;
  netGEX: number;
}

// Derived shape used throughout the app
export interface GammaExposureResponse {
  symbol: string;
  spot: number;
  dte: number;
  expiration: string;      // ISO date YYYY-MM-DD
  zeroGammaLevel: number;  // mapped from gammaZeroLevel
  netGex: number;           // sum of netGEX across strikes, in billions
  callWall: number;         // strike with max callGEX
  putWall: number;          // strike with most negative putGEX
  strikes: GexStrike[];
}

export interface GexStrike {
  strike: number;
  callGex: number;
  putGex: number;
  netGex: number;
  callOI: number;
  putOI: number;
  callDelta: number;
  putDelta: number;
}

// Raw API response from /App.Analytics/IVRank (field names TBD)
export type IVRankApiResponse = Record<string, unknown>;

// Raw API response from /App.Analytics/ImpliedVolatility (field names TBD)
export type ImpliedVolatilityApiResponse = Record<string, unknown>;

export interface IVRankResponse {
  symbol: string;
  ivRank: number;
  ivPercentile: number;
  timestamp: string;
}

export interface ImpliedVolatilityResponse {
  symbol: string;
  iv30: number;
  iv9d?: number;
  iv3m?: number;
  timestamp: string;
}

// ─── ValidationLayer API ─────────────────────────────────────────────────────
// Response from GET /App/GaleCore/ValidationLayer
export interface ValidationLayerApiResponse {
  symbol: string;
  profile: string;
  timestamp: string;
  spotPrice: number;
  signal: string;
  failedAtLayer: number | null;
  layer1: Layer1MacroResult | null;
  layer2: Layer2StrikesResult | null;
  layer3: Layer3MicroResult | null;
  layer4: Layer4SizingResult | null;
}

export interface Layer1MacroResult {
  signal: string;
  passedCount: number;
  totalChecks: number;
  vixTermStructure: { passed: boolean; iV30_9d: number | null; iV30_90d: number | null; maxVixAbsolute: number | null };
  ivRank: { passed: boolean; value: number; min: number; max: number };
  gexTotal: { passed: boolean; value: number; metric: string; threshold: number };
  spotVsZGL: { passed: boolean; spot: number; zgl: number | null; bufferPct: number };
}

export interface Layer2StrikesResult {
  signal: string;
  expectedMove: number;
  dte: number;
  expiration: string;
  callWall: number | null;
  putWall: number | null;
  zScore: number;
  selectedStructure: string;
  shortPutStrike: number | null;
  shortCallStrike: number | null;
  shortPutDelta: number | null;
  shortCallDelta: number | null;
  longPutStrike: number | null;
  longCallStrike: number | null;
  strikesInsideWalls: boolean;
}

export interface Layer3MicroResult {
  signal: string;
  atmStrike: number;
  shortCallOI: { passed: boolean; value: number; minRequired: number };
  shortPutOI: { passed: boolean; value: number; minRequired: number };
  longCallOI: { passed: boolean; value: number; minRequired: number };
  longPutOI: { passed: boolean; value: number; minRequired: number };
  atmCallDelta: number | null;
  atmPutDelta: number | null;
  bidAskSpread: { passed: boolean; spreadPct: number | null; maxSpreadPct: number } | null;
}

export interface Layer4SizingResult {
  signal: string;
  netLiq: number;
  riskPerTrade: number;
  maxRiskAmount: number;
  openPositions: number;
  maxPositions: number;
  positionsAvailable: boolean;
  currentHeatPct: number;
  maxHeatPct: number;
  heatOk: boolean;
}

// ─── Market Data API ──────────────────────────────────────────────────────────

// Raw API response from /Data/Tastytrade/MarketData/ByType
export interface MarketDataByTypeApiResponse {
  data: {
    items: MarketDataItem[];
  };
}

export interface MarketDataItem {
  symbol: string;
  bid: number;
  ask: number;
  mid: number;
  mark: number;
  last: number;       // current price
  open: number;
  prevClose?: number; // previous session close — use for daily change
  volume: number;
  beta: number;
}

// Normalized shape returned by fetchMarketDataByType
export interface MarketDataByTypeResponse {
  symbol: string;
  open: number;
  prevClose?: number; // previous session close
  last: number;       // use as current price
  bid: number;
  ask: number;
  volume: number;
}

export interface CandleItem {
  time: number;   // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface QuoteResponse {
  symbol: string;
  bid: number;
  ask: number;
  bidSize: number;
  askSize: number;
  timestamp: string;
}

// ─── Account API ──────────────────────────────────────────────────────────────
export interface BalancesResponse {
  netLiquidatingValue: number;
  buyingPower: number;
  cash: number;
  maintenanceRequirement?: number;
  timestamp: string;
}

export interface PositionResponse {
  symbol: string;
  instrumentType: string;
  quantity: number;
  marketValue: number;
  costBasis: number;
  unrealizedPnl: number;
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
}

// ─── SignalR Payloads ─────────────────────────────────────────────────────────
export interface TradePayload {
  price: number;
  size: number;
  timestamp: string;
  extendedTradingHours?: boolean;
}

export interface QuotePayload {
  bidPrice: number;
  askPrice: number;
  bidSize?: number;
  askSize?: number;
  midPrice?: number;
  volume?: number;
  timestamp?: string;
}

export interface GreeksPayload {
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  timestamp: string;
}

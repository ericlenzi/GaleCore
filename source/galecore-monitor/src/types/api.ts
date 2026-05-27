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
  overallSignal: string;
  failedAtLayer: number | null;
  macroRegime: MacroRegimeResult | null;
  positionBuilder: PositionBuilderResult | null;
  gexData: ValidationGexData | null;
}

export interface ValidationGexData {
  spot: number;
  dte: number;
  expiration: string;
  gammaZeroLevel: number | null;
  strikes: ValidationGexStrike[];
}

export interface ValidationGexStrike {
  strike: number;
  callGEX: number;
  putGEX: number;
  netGEX: number;
  callOI: number;
  putOI: number;
  callDelta: number;
  putDelta: number;
}

// ─── Macro Regime (Layer 1) ───────────────────────────────────────────────────

export interface MacroRegimeResult {
  signal: string;
  passedCount: number;
  totalChecks: number;
  checks: MacroRegimeChecks;
}

export interface MacroRegimeChecks {
  vixAbsolute: { passed: boolean; value: number | null; threshold: number };
  vixTermStructure: { passed: boolean; iv9d: number | null; iv30d: number | null };
  ivRank: { passed: boolean; value: number; min: number; max: number };
  ivMomentum: { passed: boolean; value: number | null; threshold: number };
  gexTotal: { passed: boolean; value: number; metric: string; threshold: number };
  spotVsZgl: { passed: boolean; spot: number; zgl: number | null; bufferPct: number };
}

// ─── Position Builder (Layers 2, 3, 4) ──────────────────────────────────────

export interface PositionBuilderResult {
  signal: string;
  strikeEngine: StrikeEngineResult | null;
  microstructure: MicrostructureResult | null;
  riskAndSizing: RiskAndSizingResult | null;
}

export interface LegSymbols {
  shortPut: string | null;
  longPut: string | null;
  shortCall: string | null;
  longCall: string | null;
}

export interface StrikeEngineResult {
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
  structureRuleId: number | null;
  structureRuleName: string | null;
  structureRuleLabel: string | null;
  gexSign: string | null;
  trendSignal: string | null;
  ema20: number | null;
  ema50: number | null;
  realizedVolSignal: string | null;
  rv10d: number | null;
  rv30d: number | null;
  /** Proxy POP: (1 - |delta|) × 100. IC = mínimo de ambos lados. */
  pop: number | null;
  /** Regla 1/3 Tastytrade: credit/spread_width × 100. Target ≥ 33.3%. Fuente: definitions.credit_ratio. */
  creditRatio: number | null;
  /** Score compuesto de prioridad: (pop/100)*0.6 + (credit/width)*0.4. Fuente: position_builder.ranking. */
  priorityScore: number | null;
  /** Símbolos DXLink streamer por leg — suscribir al socket para quotes live. */
  legSymbols: LegSymbols | null;
}

export interface MicrostructureResult {
  signal: string;
  atmStrike: number;
  oiChecks: OIChecks;
  atmCallDelta: number | null;
  atmPutDelta: number | null;
  bidAskChecks: BidAskChecks | null;
  creditMinimum: CreditMinimumCheck | null;
}

export interface OIChecks {
  shortPut: OICheck | null;
  shortCall: OICheck | null;
  longPut: OICheck | null;
  longCall: OICheck | null;
}

export interface OICheck {
  passed: boolean;
  value: number;
  minRequired: number;
}

export interface BidAskChecks {
  shortPut: BidAskLegCheck | null;
  shortCall: BidAskLegCheck | null;
  longPut: BidAskLegCheck | null;
  longCall: BidAskLegCheck | null;
}

export interface BidAskLegCheck {
  passed: boolean;
  spreadPct: number | null;
  maxAllowed: number;
}

export interface CreditMinimumCheck {
  passed: boolean;
  midCredit: number;
  minRequired: number;
}

export interface RiskAndSizingResult {
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
  /** Contratos máximos calculados con crédito snapshot. */
  contracts: number;
  /** Máx profit snapshot (frontend recalcula con live). */
  maxProfit: number;
  /** Máx loss snapshot (frontend recalcula con live). */
  maxLoss: number;
  /** Buying power requirement por contrato snapshot. */
  buyingPowerReq: number;
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
  accountNumber: string;
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

// ─── PositionBuilder API ─────────────────────────────────────────────────────
// Response from GET /App/GaleCore/PositionBuilder
// Reutiliza StrikeEngineResult, MicrostructureResult, RiskAndSizingResult de ValidationLayer.

export interface PositionBuilderApiResponse {
  symbol: string;
  profile: string;
  timestamp: string;
  spotPrice: number;
  overallSignal: string;
  /** GEX total neto en billions USD. Ver definitions.gex_total. */
  netGexBillions: number | null;
  /** Gamma Zero Level. Ver definitions.gamma_zero_level. */
  gammaZeroLevel: number | null;
  structureInputs: StructureInputs;
  selectedStructure: SelectedStructureResult;
  strikeEngine: StrikeEngineResult | null;
  microstructure: MicrostructureResult | null;
  riskAndSizing: RiskAndSizingResult | null;
}

export interface StructureInputs {
  priceZScore: PriceZScoreInput;
  gexSign: GexSignInput;
  trend: TrendInput;
  realizedVolRegime: RealizedVolInput;
  aggressiveFlow: AggressiveFlowInput | null;
}

export interface PriceZScoreInput {
  value: number;
  formula: string;
  ret5d: number;
  ivAtm: number;
  interpretation: string;
}

export interface GexSignInput {
  value: string;
  /** Ratio callGEX / (callGEX + |putGEX|) en [0, 1]. Ver definitions.gex_skew. */
  skewRatio: number;
  interpretation: string;
}

export interface TrendInput {
  ema20: number | null;
  ema50: number | null;
  signal: string;
  interpretation: string;
}

export interface RealizedVolInput {
  rv10d: number | null;
  rv30d: number | null;
  signal: string;
  interpretation: string;
}

export interface AggressiveFlowInput {
  signal: string;
  dataSource: string;
  note: string | null;
  bullishPremiumUsd: number | null;
  bearishPremiumUsd: number | null;
  netDeltaFlow: number | null;
  dominantSide: string | null;
  windowMinutes: number | null;
}

export interface SelectedStructureResult {
  output: string;
  ruleId: number | null;
  ruleName: string | null;
  ruleLabel: string | null;
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

// ─── Flow Payload (SignalR ReceiveFlow) ──────────────────────────────────────
export interface FlowPayload {
  symbol: string;
  expiration: string;
  windowMinutes: number;
  timestamp: string;
  bullish: FlowSide;
  bearish: FlowSide;
  netDeltaFlow: number;
  signal: string;
  recentTrades: FlowTrade[];
}

export interface FlowSide {
  premiumUsd: number;
  tradeCount: number;
  avgTradeSize: number;
  dominantStrike: number | null;
  dominantType: string | null;
}

export interface FlowTrade {
  timestamp: string;
  optionSymbol: string;
  callPut: string;
  strike: number;
  tradePrice: number;
  size: number;
  premiumUsd: number;
  aggression: string;
}

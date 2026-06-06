// ─── Rules API ────────────────────────────────────────────────────────────────
// Tipos que reflejan la estructura real de galecore_rules_core.json (v1.3.x).
// El frontend renderiza lo que el JSON declara — no hardcodea lógica de negocio.

/** Umbral de un check: valor único, rango, o referencia a definitions/marketdata. */
export interface RuleThreshold {
  value?: number;
  min?: number;
  max?: number;
  ref?: string;
}

/** Check individual de una capa de validación (macro_regime / position_builder.layers). */
export interface RuleCheck {
  id: string;
  label: string;
  operator?: string;
  metric?: { ref?: string };
  threshold?: RuleThreshold;
  side?: string;
  applies_per_leg?: string;
  applies_per_spread?: boolean;
  applies_to_symbol?: string[];
  applies_to_side?: string;
  on_fail?: string;
  rule?: string;
  note?: string;
}

/** Capa 1 — Régimen macro. */
export interface MacroRegimeRules {
  name?: string;
  description?: string;
  pass_rule?: string;
  on_fail?: string;
  checks: RuleCheck[];
}

/** Una de las reglas de selección de estructura (multi-factor) en strike_engine. */
export interface StructureSelectionRule {
  id: number;
  name: string;
  label: string;
  conditions: Record<string, string> | string;
  output: string;
  rationale: string;
}

export interface SpreadWidthOverride {
  default: number;
  min: number;
  max: number;
  step: number;
}

/** config de las capas del position_builder (strike_engine y risk_and_sizing). */
export interface LayerConfig {
  // strike_engine
  dte_selection?: {
    target: number;
    min: number;
    max: number;
    expiration_preference?: string;
    allow_weeklies?: boolean;
    weekly_condition?: string;
  };
  structure_selection?: {
    method?: string;
    description?: string;
    thresholds?: { neutral_z: number; extreme_z: number };
    inputs?: Record<string, { ref?: string }>;
    evaluation_order?: string;
    rules: StructureSelectionRule[];
  };
  spread_width?: {
    symbol_overrides?: Record<string, SpreadWidthOverride>;
    unit?: string;
    selection_rule?: string;
  };
  asymmetry_check?: {
    enabled: boolean;
    distance_ratio_threshold: number;
    absolute_distance_min_ref?: string;
    on_trigger?: string;
  };
  // risk_and_sizing
  risk_per_trade_pct?: number;
  max_positions?: number;
  max_heat_pct_net_liq?: number;
}

export interface PositionBuilderLayer {
  id: number;
  name: string;
  description?: string;
  pass_rule?: string;
  on_layer_fail?: string;
  config?: LayerConfig;
  checks?: RuleCheck[];
}

export interface RankingCriterion {
  id: string;
  label: string;
  metric?: string;
  ref?: string;
  formula?: string;
  direction?: string;
  weight: number;
  target?: number;
  note?: string;
}

export interface PositionBuilderRules {
  description?: string;
  cascade_rule?: string;
  ranking?: {
    description?: string;
    method?: string;
    score_formula?: string;
    output_field?: string;
    tiebreak?: string;
    criteria: RankingCriterion[];
  };
  layers?: PositionBuilderLayer[];
}

/** Entrada del diccionario definitions: fórmulas, lookups e interpretaciones. */
export interface RuleDefinition {
  type?: string;
  formula?: string;
  source?: string;
  endpoint?: string;
  unit?: string;
  target?: string;
  note?: string;
  interpretation?: string | Record<string, string>;
  thresholds?: Record<string, unknown>;
  ranges?: Array<{ min: number; max: number; value: number }>;
  values?: Record<string, number>;
  [k: string]: unknown;
}

export interface SignalLabel {
  color: string;
  condition: string;
}

export interface CoreRules {
  _meta: {
    version: string;
    strategy: string;
    profile?: string;
    last_updated: string;
    notes?: string;
  };
  principles?: Record<string, boolean>;
  strategy_scope?: {
    allowed_strategies: string[];
    forbidden_strategies: string[];
    default_structure: string;
    structure_selection_method?: string;
  };
  universe: {
    tickers: string[];
    mode?: string;
    min_avg_daily_volume_underlying?: number;
    min_avg_daily_volume?: number;
  };
  data_quality?: {
    max_quote_age_seconds: number;
    max_structural_levels_age_minutes: number;
    block_on_crossed_market: boolean;
    block_on_missing_critical_data: boolean;
  };
  definitions?: Record<string, RuleDefinition>;
  macro_regime: MacroRegimeRules;
  position_builder?: PositionBuilderRules;
  execution?: {
    submit_multileg_as_complex_order?: boolean;
    avoid_first_minutes_open?: number;
    avoid_last_minutes_close?: number;
    partial_fill_policy?: Record<string, unknown>;
    forced_exit_policy?: Record<string, unknown>;
    slippage?: {
      new_entries?: { max_total_cost_pct_of_expected_credit?: number };
      defensive_rolls?: { formula_ref?: string };
    };
  };
  trade_management: {
    evaluation_priority?: string[];
    daily_kill_switch?: {
      daily_portfolio_mtm_loss_pct_net_liq_max: number;
      action?: string;
    };
    take_profit?: {
      pct_of_initial_credit: number;
      action?: string;
    };
    macro_event_binary_avoidance?: {
      trigger?: string;
      action?: string;
    };
    structural_support_loss?: {
      trigger?: string;
      confirm_consecutive_recalculations?: number;
      action?: string;
    };
    hard_defense?: {
      trigger_any: {
        short_leg_delta_abs_gt: number;
        unrealized_loss_pct_of_initial_credit_gte: number;
      };
      action?: string;
    };
    defensive_roll?: {
      trigger_unrealized_loss_pct_of_initial_credit_gte: number;
      min_dte_remaining: number;
      min_net_credit_for_roll: number;
      max_rolls_per_position: number;
      slippage_rule_ref?: string;
    };
    time_exit?: {
      dte_threshold: number;
      action?: string;
    };
  };
  monitoring?: { review_frequency_minutes: number };
  display_config?: {
    signal_labels?: Record<string, SignalLabel>;
    [k: string]: unknown;
  };

  // ── Campos legacy (esquema viejo). Algunos componentes aún los leen vía ?. con
  //    defaults; se mantienen opcionales para compatibilidad de compilación.
  gamma_regime?: {
    gex_total?: { min_billion_usd?: number };
    [k: string]: unknown;
  };
  options_filters?: {
    iv_rank?: { min?: number; max?: number; lookback_days?: number };
    liquidity?: {
      open_interest_min_short_leg?: number;
      open_interest_min_long_leg?: number;
      bid_ask_spread_max_pct_mid?: number;
    };
  };
  trade_construction?: {
    dte_target?: { min?: number; max?: number; ideal?: number };
    short_leg_delta?: { max_abs?: number };
    spread_width?: { default_points?: number; symbol_overrides?: Record<string, number> };
    premium_capture?: {
      tiers?: Array<{ iv_rank_min?: number; iv_rank_max?: number; min_credit_width_ratio: number }>;
    };
  };
  risk_limits?: {
    risk_per_trade_pct?: number;
    risk_per_trade_usd_max?: number;
    portfolio_heat_max_pct?: number;
    max_concurrent_positions?: number;
    max_positions_per_symbol?: number;
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

/** OI + cierre del período anterior de un leg. Fuente: definitions.leg_open_interest / leg_prev_close. */
export interface LegMeta {
  openInterest: number | null;
  prevClose: number | null;
}

export interface LegMetaSet {
  shortPut: LegMeta | null;
  longPut: LegMeta | null;
  shortCall: LegMeta | null;
  longCall: LegMeta | null;
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
  /** OI + cierre anterior por leg. Fuente: definitions.leg_open_interest / leg_prev_close. */
  legMeta: LegMetaSet | null;
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

export interface GroupedPosition {
  underlyingSymbol: string;
  legs: PositionResponse[];
  legCount: number;
  unrealizedPnl: number;
  realizedToday: number;
  typeLabel: string;   // 'Eq' | 'Opt' | 'Eq+Opt'
}

export interface PositionResponse {
  accountNumber: string;
  symbol: string;
  instrumentType: string;
  underlyingSymbol: string;
  quantity: number;
  quantityDirection: string;
  closePrice: number;
  averageOpenPrice: number;
  multiplier: number;
  costEffect: string;
  isSuppressed: boolean;
  isFrozen: boolean;
  restrictedQuantity: number;
  realizedDayGain: number;
  realizedDayGainEffect: string;
  realizedToday: number;
  realizedTodayEffect: string;
  createdAt: string;
  updatedAt: string;
}

// ─── PositionBuilder API ─────────────────────────────────────────────────────
// Response from GET /App/GaleCore/PositionBuilder
// Reutiliza StrikeEngineResult, MicrostructureResult, RiskAndSizingResult de ValidationLayer.

/** Candidato de strikes alternativo. Rank 1 coincide con strikeEngine (óptimo). */
export interface StrikeEngineCandidate {
  rank: number;
  shortPutStrike: number | null;
  shortCallStrike: number | null;
  shortPutDelta: number | null;
  shortCallDelta: number | null;
  longPutStrike: number | null;
  longCallStrike: number | null;
  strikesInsideWalls: boolean;
  pop: number | null;
  /** Null para rank 2-3; el frontend lo calcula con live quote del socket. */
  creditRatio: number | null;
  /** Rank 1: score completo (pop + credit). Rank 2-3: solo componente pop. */
  priorityScore: number | null;
  legSymbols: LegSymbols | null;
  /** OI + cierre anterior por leg. Fuente: definitions.leg_open_interest / leg_prev_close. */
  legMeta: LegMetaSet | null;
}

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
  /** Top 3 candidatos de strikes. Rank 1 = strikeEngine (más cercano al dinero). */
  strikeCandidates: StrikeEngineCandidate[] | null;
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
  eventSymbol?: string;
  price?: number;       // theoretical option price
  volatility?: number;  // implied volatility of the contract
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  rho?: number;
  timestamp?: string;
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

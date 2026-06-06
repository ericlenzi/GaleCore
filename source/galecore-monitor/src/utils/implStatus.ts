// Estado de implementación de cada concepto/dato del JSON de reglas.
// Estimación basada en inspección del código: handlers del backend
// (ValidationLayerHandler / PositionBuilderHandler / GammaExposure / IVRank /
// ImpliedVolatility) y de qué consume hoy el frontend (PM table, validation,
// monitor). Sirve de semáforo: verde = ya cableado, rojo = todavía no.

export interface ImplStatus {
  /** Lo computa / expone el backend (DataFeed). */
  backend: boolean;
  /** Lo consume / muestra el monitor (frontend). */
  frontend: boolean;
}

/** Semáforo por clave de `definitions` del JSON. */
export const DEF_IMPL: Record<string, ImplStatus> = {
  iv_rank:                        { backend: true,  frontend: true },
  iv30_atm_roc_pct:               { backend: true,  frontend: true },
  expected_move:                  { backend: true,  frontend: true },
  directional_zscore:             { backend: true,  frontend: true },
  iv_zscore:                      { backend: false, frontend: false },
  gex_skew:                       { backend: true,  frontend: true },
  trend_ema:                      { backend: true,  frontend: true },
  realized_vol_regime:            { backend: true,  frontend: true },
  aggressive_flow:                { backend: true,  frontend: true },
  leg_open_interest:              { backend: true,  frontend: true },
  leg_prev_close:                 { backend: true,  frontend: true },
  credit_ratio:                   { backend: true,  frontend: true },
  credit_ratio_min_by_iv_rank:    { backend: true,  frontend: false },
  gex_total:                      { backend: true,  frontend: true },
  gex_threshold_by_symbol:        { backend: true,  frontend: false },
  gamma_zero_level:               { backend: true,  frontend: true },
  zgl_with_buffer:                { backend: true,  frontend: false },
  call_wall:                      { backend: true,  frontend: true },
  put_wall:                       { backend: true,  frontend: true },
  min_offset_from_spot_by_symbol: { backend: true,  frontend: false },
  pop_proxy:                      { backend: true,  frontend: true },
  portfolio_heat:                 { backend: true,  frontend: true },
  heat_pct_net_liq:               { backend: true,  frontend: true },
  max_heat:                       { backend: true,  frontend: true },
  heat_available:                 { backend: false, frontend: false },
  new_position_heat:              { backend: false, frontend: false },
  heat_after_new_position:        { backend: false, frontend: false },
  risk_per_trade:                 { backend: true,  frontend: true },
  max_risk_per_contract:          { backend: true,  frontend: false },
  max_contracts:                  { backend: true,  frontend: true },
  positions_available:            { backend: true,  frontend: true },
  bid_ask_spread_pct:             { backend: true,  frontend: true },
  slippage_entry:                 { backend: false, frontend: false },
  slippage_roll:                  { backend: false, frontend: false },
  spy_exdiv_days_until:           { backend: false, frontend: false },
  leg_mid_price:                  { backend: true,  frontend: true },
  max_profit:                     { backend: true,  frontend: true },
  max_loss:                       { backend: true,  frontend: true },
  buying_power_requirement:       { backend: true,  frontend: true },
};

export function implFor(key: string): ImplStatus | null {
  return DEF_IMPL[key] ?? null;
}

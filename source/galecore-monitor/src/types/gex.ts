import { GexStrike, MacroRegimeResult, StructureInputs } from './api';

/**
 * Tipos de la estrategia GEX (informativa). Fuente: GET /App/Gex/Analysis.
 *
 * El GEX de esta pestaña es GLOBAL: agrega todos los strikes de todos los vencimientos de la
 * cadena dentro de `gex.max_dte` (incluido 0DTE). Es un número distinto — y mayor — que el GEX
 * de Main, que mira un solo vencimiento. No se comparan entre sí.
 */

/** Strike tal como llega de la API (mismo shape que ValidationGexStrike). */
export interface GexStrikeApi {
  strike: number;
  callGEX: number;
  putGEX: number;
  netGEX: number;
  callOI: number;
  putOI: number;
  callDelta: number;
  putDelta: number;
}

export interface GexScopeApi {
  spot: number;
  callGex: number;
  putGex: number;
  /** Net GEX en billones de USD. */
  netGex: number;
  gammaZeroLevel: number | null;
  callWall: number | null;
  putWall: number | null;
  /** Vencimientos que llegaron con datos. */
  expirationsIncluded: number;
  /** Vencimientos que entraron al barrido. Si supera a expirationsIncluded, el GEX está incompleto. */
  expirationsRequested: number;
  /** Símbolos con Greeks sobre símbolos pedidos, en %. */
  coveragePct: number;
  strikes: GexStrikeApi[];
}

export interface GexExpiryApi {
  expiration: string;
  dte: number;
  expirationType: string | null;
  callGex: number;
  putGex: number;
  netGex: number;
  gammaZeroLevel: number | null;
  callWall: number | null;
  putWall: number | null;
  atmIv: number | null;
  expectedMove: number | null;
  strikes: GexStrikeApi[];
}

export interface GexScanConfig {
  maxDte: number;
  includeZeroDte: boolean;
  expirationTypes: string[];
  greeksBatchSize: number;
  greeksRetries: number;
  cacheSeconds: number;
  /** Cobertura mínima para que el backend guarde el barrido en cache. Debajo, no lo cachea. */
  cacheMinCoveragePct: number;
}

export interface GexAnalysisResponse {
  symbol: string;
  timestamp: string;
  spotPrice: number;
  fromCache: boolean;
  elapsedMs: number;
  macroRegime: MacroRegimeResult | null;
  structureInputs: StructureInputs | null;
  gex: {
    global: GexScopeApi;
    byExpiry: GexExpiryApi[];
    config: GexScanConfig;
  };
}

/** Shape que consume GexChart/GexBarsPanel, derivado de un scope (global o de un vencimiento). */
export interface GexChartData {
  symbol: string;
  spot: number;
  dte: number;
  expiration: string;
  zeroGammaLevel: number;
  netGex: number;
  callWall: number;
  putWall: number;
  strikes: GexStrike[];
}

/** Contrato de render de la pestaña: display_config.gex_tab del JSON de reglas. */
export interface GexTabDisplayConfig {
  refresh_seconds?: number;
  default_expiry?: string;
  candles?: { interval?: string; count?: number; right_pad_bars?: number };
  details_panel?: { title?: string; subtitle?: string; microstructure?: boolean; gex_scope?: string };
  expiry_engine?: { label?: string; rows?: { id: string; label: string }[] };
  options_chain?: { label?: string };
}

export interface GexRules {
  _meta?: { version?: string; strategy?: string; status?: string };
  universe?: { tickers?: string[] };
  gex?: { max_dte?: number; include_zero_dte?: boolean };
  display_config?: { gex_tab?: GexTabDisplayConfig };
}

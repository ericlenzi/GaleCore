import { GexStrike, MacroRegimeResult, StructureInputs } from './api';

/**
 * Tipos de la estrategia GEX (informativa). Fuente: GET /App/Gex/Analysis.
 *
 * El GEX de esta pestaña es GLOBAL: agrega todos los strikes de todos los vencimientos de la
 * cadena dentro de `gex.max_dte` (incluido 0DTE). Es un número distinto — y mayor — que el GEX
 * de Main, que mira un solo vencimiento. No se comparan entre sí.
 */

/**
 * Valor de `selectedExpiry` que significa "el agregado de toda la cadena" en vez de un vencimiento.
 *
 * Es un centinela y no un flag aparte a propósito: la elección de scope es UNA sola, y con dos
 * estados (`selectedExpiry` + un `isGlobal`) se puede representar el imposible "global Y el 0DTE".
 * No colisiona con un `expiration` real, que siempre es una fecha ISO.
 */
export const GLOBAL_SCOPE = 'global';

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
  /** Switch de la estrategia. En false no se barrió nada: lo que llega es el último dato. */
  switchEnabled: boolean;
  /** El dato es de un barrido anterior y nadie lo va a actualizar mientras el switch esté en OFF. */
  frozen: boolean;
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

/**
 * Un grupo del cuadro Details. Agrupa por la PREGUNTA que contestan sus métricas, no por el objeto
 * de la respuesta que las trae — `macroRegime.checks` y `structureInputs` son dos orígenes de dato
 * y ese reparto no le dice nada a quien lee.
 *
 * `scope: 'market'` es el que importa: VIX y VIX9D son índices CBOE que el backend pide como
 * símbolos fijos, así que valen lo mismo en SPY, QQQ o AAPL. Van en su propia franja y fuera del
 * encabezado "<símbolo> · Details" — mezclados con los del símbolo, cambiar de ticker y ver que
 * esos dos no se mueven es indistinguible de un dato que quedó colgado del barrido anterior.
 */
export interface DetailsGroup {
  id: string;
  label: string;
  scope?: 'market' | 'symbol';
  hint?: string;
  /** El `id` es el contrato con el panel, que mapea id → celda. El `label` es lo que se ve. */
  metrics: { id: string; label: string }[];
}

/** Contrato de render de la pestaña: display_config.gex_tab del JSON de reglas. */
export interface GexTabDisplayConfig {
  refresh_seconds?: number;
  default_expiry?: string;
  candles?: { interval?: string; count?: number; right_pad_bars?: number };
  details_panel?: {
    subtitle?: string;
    microstructure?: boolean;
    gex_scope?: string;
    /** false = sin verde/rojo ni checkmarks. GEX no tiene gates: nada acá aprueba ni reprueba. */
    semaphore?: boolean;
    /** Los grupos del cuadro Details, en orden de lectura. Ver DetailsGroup. */
    groups?: DetailsGroup[];
  };
  expiry_engine?: { label?: string; rows?: { id: string; label: string }[] };
  options_chain?: {
    label?: string;
    /** Fila fija que selecciona el agregado de toda la cadena en vez de un vencimiento. */
    global_row?: { enabled?: boolean; label?: string; scope?: string };
  };
}

export interface GexRules {
  _meta?: { version?: string; strategy?: string; status?: string };
  universe?: { tickers?: string[] };
  gex?: { max_dte?: number; include_zero_dte?: boolean };
  display_config?: { gex_tab?: GexTabDisplayConfig };
}

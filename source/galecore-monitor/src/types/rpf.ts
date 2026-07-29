// ─── Contrato de orquestación RPF (Fase 6) ──────────────────────────────────
// Espeja los DTOs del backend (DataFeed.Application/App/Rpf). SignalR serializa
// con CamelCasePropertyNamesContractResolver → nombres camelCase en el wire.

export type RpfStateName =
  | 'VETOED'
  | 'WAITING_CAPACITY'
  | 'IN_POSITION'
  | 'DORMANT'
  | 'ARMED'
  | 'COOLDOWN'
  | 'TRIGGERED';

/** Snapshot liviano del estado del loop por símbolo (evento ReceiveRpfState). */
export interface RpfStateUpdate {
  symbol: string;
  state: RpfStateName;
  /** Resultado de cada check de Tier A (gate → pass). Vacío en el snapshot de SubscribeRpf. */
  tierA?: Record<string, boolean>;
  edge?: number | null;
  bar?: number | null;
  regime?: string | null;
  capacityAvailable?: boolean;
  cooldownRemainingSec?: number | null;
  suggestionId?: string | null;
  timestamp: string;
}

export interface TradeSuggestionLeg {
  action: 'sell' | 'buy';
  streamerSymbol?: string | null;
  strike: number;
  delta?: number | null;
}

/** Sugerencia emitida al entrar en TRIGGERED (evento ReceiveTradeSuggestion). */
export interface TradeSuggestion {
  id: string;
  symbol: string;
  structure: string;
  legs: TradeSuggestionLeg[];
  credit: number;
  width: number;
  creditRatio?: number | null;
  edgeEmp?: number | null;
  bar?: number | null;
  regime: string;
  deltaShort: number;
  dte: number;
  riskPerTradePct?: number | null;
  highRisk: boolean;
  contracts: number;
  state: string;
  createdAt: string;
  ttlSeconds: number;
}

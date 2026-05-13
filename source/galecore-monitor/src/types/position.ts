export type PositionType = 'PUT_CS' | 'CALL_CS' | 'IC' | 'LONG';

export type AlertType =
  | 'CERRAR'
  | 'STOP_LOSS'
  | 'TIME_EXIT'
  | 'EVALUAR_ROLL'
  | 'MACRO_PROXIMO'
  | null;

export interface ManualPosition {
  id: string;
  symbol: string;
  type: PositionType;
  shortStrike: number;
  longStrike: number;
  shortStrike2?: number;  // IC: call side short
  longStrike2?: number;   // IC: call side long
  expiration: string;     // ISO date YYYY-MM-DD
  credit: number;
  contracts: number;
  openDate: string;       // ISO date
  note?: string;
}

export interface EnrichedPosition extends ManualPosition {
  dte: number;
  currentPnl: number | null;
  pnlPct: number | null;
  alert: AlertType;
}

/** Computed suggested setup derived from GEX + IV + rules */
export interface SuggestedSetup {
  type: 'PUT_CS' | 'CALL_CS' | 'IC';
  // Primary leg pair (or put side for IC)
  shortStrike: number;
  longStrike: number;
  // Call side for IC
  secondShortStrike?: number;
  secondLongStrike?: number;
  expiration: string;
  dte: number;
  width: number;          // points
  // From GEX data
  shortLegOI: number | null;
  shortLegDelta: number | null;
  // Computed checks
  pop: number | null;          // proxy: (1 - |delta|) × 100
  creditRatioMin: number;      // from rules (e.g. 0.10)
  maxDeltaAbs: number;         // from rules
  // Live quote (not fetched automatically)
  estimatedCredit: number | null;
}

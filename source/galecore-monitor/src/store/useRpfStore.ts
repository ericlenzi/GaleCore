import { create } from 'zustand';
import { RpfStateUpdate, TradeSuggestion } from '../types/rpf';

interface RpfStore {
  /** Último estado del loop por símbolo (ReceiveRpfState). */
  states: Record<string, RpfStateUpdate>;
  /** Sugerencia vigente por símbolo (ReceiveTradeSuggestion); null si no hay/expiró. */
  suggestions: Record<string, TradeSuggestion | null>;
  /** Switch de workers: null mientras no se leyó el estado desde /App/Rpf/Workers. */
  workersEnabled: boolean | null;

  applyState: (symbol: string, update: RpfStateUpdate) => void;
  applySuggestion: (symbol: string, suggestion: TradeSuggestion) => void;
  clearSuggestion: (symbol: string) => void;
  /** Estado del switch (fetch inicial o evento ReceiveRpfWorkers). Al apagar vuelve al estado inicial. */
  setWorkers: (enabled: boolean) => void;
  reset: () => void;
}

const EMPTY = { states: {}, suggestions: {} };

export const useRpfStore = create<RpfStore>((set) => ({
  ...EMPTY,
  workersEnabled: null,

  applyState: (symbol, update) =>
    set((s) => {
      // Un cambio de estado que no sea TRIGGERED invalida la sugerencia vigente.
      const dropSuggestion = update.state !== 'TRIGGERED';
      return {
        states: { ...s.states, [symbol]: update },
        suggestions: dropSuggestion ? { ...s.suggestions, [symbol]: null } : s.suggestions,
      };
    }),

  applySuggestion: (symbol, suggestion) =>
    set((s) => ({ suggestions: { ...s.suggestions, [symbol]: suggestion } })),

  clearSuggestion: (symbol) =>
    set((s) => ({ suggestions: { ...s.suggestions, [symbol]: null } })),

  // Apagar los workers deja el tablero como recién abierto: con el loop inerte nadie actualiza el
  // estado, y dejarlo en pantalla haría pasar datos congelados por vigentes.
  setWorkers: (enabled) =>
    set(() => (enabled ? { workersEnabled: true } : { workersEnabled: false, ...EMPTY })),

  reset: () => set({ ...EMPTY, workersEnabled: null }),
}));

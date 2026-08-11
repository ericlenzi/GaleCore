import { create } from 'zustand';
import { RpfStateUpdate, TradeSuggestion } from '../types/rpf';

interface RpfStore {
  /** Último estado del loop por símbolo (ReceiveRpfState). */
  states: Record<string, RpfStateUpdate>;
  /** Sugerencia vigente por símbolo (ReceiveTradeSuggestion); null si no hay/expiró. */
  suggestions: Record<string, TradeSuggestion | null>;
  /** Switch de la estrategia: null mientras no se leyó el estado desde /App/Rpf/Switch. */
  switchEnabled: boolean | null;

  applyState: (symbol: string, update: RpfStateUpdate) => void;
  applySuggestion: (symbol: string, suggestion: TradeSuggestion) => void;
  clearSuggestion: (symbol: string) => void;
  /** Estado del switch (fetch inicial o evento ReceiveRpfSwitch). Al apagar vuelve al estado inicial. */
  setStrategySwitch: (enabled: boolean) => void;
  reset: () => void;
}

const EMPTY = { states: {}, suggestions: {} };

export const useRpfStore = create<RpfStore>((set) => ({
  ...EMPTY,
  switchEnabled: null,

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

  // Apagar la estrategia deja el tablero como recién abierto: con el loop inerte nadie actualiza el
  // estado, y dejarlo en pantalla haría pasar datos congelados por vigentes.
  setStrategySwitch: (enabled) =>
    set(() => (enabled ? { switchEnabled: true } : { switchEnabled: false, ...EMPTY })),

  reset: () => set({ ...EMPTY, switchEnabled: null }),
}));

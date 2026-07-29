import { create } from 'zustand';
import { RpfStateUpdate, TradeSuggestion } from '../types/rpf';

interface RpfStore {
  /** Último estado del loop por símbolo (ReceiveRpfState). */
  states: Record<string, RpfStateUpdate>;
  /** Sugerencia vigente por símbolo (ReceiveTradeSuggestion); null si no hay/expiró. */
  suggestions: Record<string, TradeSuggestion | null>;
  /** true tras el primer evento del grupo rpf: el loop está emitiendo. Mientras false, el
   *  tablero muestra "loop offline" (el loop de 6a arranca inerte y no emite nada). */
  loopOnline: boolean;

  applyState: (symbol: string, update: RpfStateUpdate) => void;
  applySuggestion: (symbol: string, suggestion: TradeSuggestion) => void;
  clearSuggestion: (symbol: string) => void;
  reset: () => void;
}

export const useRpfStore = create<RpfStore>((set) => ({
  states: {},
  suggestions: {},
  loopOnline: false,

  applyState: (symbol, update) =>
    set((s) => {
      // Un cambio de estado que no sea TRIGGERED invalida la sugerencia vigente.
      const dropSuggestion = update.state !== 'TRIGGERED';
      return {
        loopOnline: true,
        states: { ...s.states, [symbol]: update },
        suggestions: dropSuggestion ? { ...s.suggestions, [symbol]: null } : s.suggestions,
      };
    }),

  applySuggestion: (symbol, suggestion) =>
    set((s) => ({
      loopOnline: true,
      suggestions: { ...s.suggestions, [symbol]: suggestion },
    })),

  clearSuggestion: (symbol) =>
    set((s) => ({ suggestions: { ...s.suggestions, [symbol]: null } })),

  reset: () => set({ states: {}, suggestions: {}, loopOnline: false }),
}));

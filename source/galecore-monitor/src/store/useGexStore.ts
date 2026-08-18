import { create } from 'zustand';
import { GexAnalysisResponse, GexRules, GexTabDisplayConfig } from '../types/gex';
import { fetchGexAnalysis, fetchGexRules } from '../api/gex';

interface GexCacheEntry {
  data: GexAnalysisResponse;
  updatedAt: Date;
}

interface GexStore {
  /** Reglas propias de la estrategia (universo + contrato de render). */
  rules: GexRules | null;
  tickers: string[];
  display: GexTabDisplayConfig | null;
  rulesLoading: boolean;
  rulesError: string | null;

  cache: Record<string, GexCacheEntry>;
  loading: Record<string, boolean>;
  error: Record<string, string | null>;

  /**
   * Scope elegido por símbolo: una fecha de vencimiento, o `GLOBAL_SCOPE` para el agregado de toda
   * la cadena. null = todavía no eligió → manda el más cercano (0DTE), como declara
   * `display_config.gex_tab.default_expiry`.
   */
  selectedExpiry: Record<string, string | null>;

  // El switch de la estrategia NO vive acá: es el mismo hecho que muestra la card de Main, así que
  // su dueño en el front es `useStrategySwitchStore`, indexado por switch_endpoint.

  loadRules: () => Promise<void>;
  fetchGex: (symbol: string, refresh?: boolean) => Promise<void>;
  selectExpiry: (symbol: string, expiration: string) => void;
}

export const useGexStore = create<GexStore>((set, get) => ({
  rules: null,
  tickers: [],
  display: null,
  rulesLoading: true,
  rulesError: null,

  cache: {},
  loading: {},
  error: {},
  selectedExpiry: {},

  loadRules: async () => {
    set({ rulesLoading: true, rulesError: null });
    try {
      const rules = await fetchGexRules();
      set({
        rules,
        tickers: rules.universe?.tickers ?? [],
        display: rules.display_config?.gex_tab ?? null,
        rulesLoading: false,
      });
    } catch (e: any) {
      set({ rulesLoading: false, rulesError: e.message ?? 'Error cargando reglas de GEX' });
    }
  },

  fetchGex: async (symbol, refresh = false) => {
    // Guarda de reentrada: el barrido de la cadena es caro y el auto-refresh no debe apilarse
    // sobre una llamada en vuelo.
    if (get().loading[symbol]) return;

    set((s) => ({
      loading: { ...s.loading, [symbol]: true },
      error: { ...s.error, [symbol]: null },
    }));
    try {
      const data = await fetchGexAnalysis(symbol, refresh);
      set((s) => ({
        cache: { ...s.cache, [symbol]: { data, updatedAt: new Date() } },
        loading: { ...s.loading, [symbol]: false },
      }));
    } catch (e: any) {
      set((s) => ({
        loading: { ...s.loading, [symbol]: false },
        error: { ...s.error, [symbol]: e.message ?? 'Error cargando GEX' },
      }));
    }
  },

  selectExpiry: (symbol, expiration) =>
    set((s) => ({ selectedExpiry: { ...s.selectedExpiry, [symbol]: expiration } })),
}));

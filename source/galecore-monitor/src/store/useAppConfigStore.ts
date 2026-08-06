import { create } from 'zustand';
import { AppConfig, StrategyEntry } from '../types/api';

/**
 * Configuración de la aplicación, leída de /App/GaleCore/Rules/Core.
 * De acá salen: el universo que se streamea por SignalR, las cards de estrategias de Main y los
 * umbrales de gestión que muestra Monitor. No contiene reglas de trading — eso vive en el JSON
 * de cada estrategia.
 */
interface AppConfigStore {
  config: AppConfig | null;
  /** Universo de la plataforma. Alimenta el Subscribe del hub. */
  tickers: string[];
  strategies: StrategyEntry[];
  loading: boolean;
  error: string | null;
  setConfig: (c: AppConfig) => void;
  setLoading: (v: boolean) => void;
  setError: (e: string | null) => void;
}

export const useAppConfigStore = create<AppConfigStore>((set) => ({
  config: null,
  tickers: [],
  strategies: [],
  loading: true,
  error: null,

  setConfig: (c) => set({
    config: c,
    tickers: c.universe?.tickers ?? [],
    strategies: c.strategies ?? [],
    error: null,
  }),
  setLoading: (v) => set({ loading: v }),
  setError: (e) => set({ error: e }),
}));

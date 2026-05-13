import { create } from 'zustand';
import { CoreRules } from '../types/api';

interface RulesStore {
  rules: CoreRules | null;
  tickers: string[];
  loading: boolean;
  error: string | null;
  setRules: (r: CoreRules) => void;
  setLoading: (v: boolean) => void;
  setError: (e: string | null) => void;
}

export const useRulesStore = create<RulesStore>((set) => ({
  rules: null,
  tickers: [],
  loading: true,
  error: null,

  setRules: (r) => set({ rules: r, tickers: r.universe?.tickers ?? [], error: null }),
  setLoading: (v) => set({ loading: v }),
  setError: (e) => set({ error: e }),
}));

import { create } from 'zustand';
import { BalancesResponse, PositionResponse } from '../types/api';

interface AccountStore {
  balances: BalancesResponse | null;
  positions: PositionResponse[];
  loadingBalances: boolean;
  loadingPositions: boolean;
  errorBalances: string | null;
  lastUpdate: Date | null;
  setBalances: (b: BalancesResponse) => void;
  setPositions: (p: PositionResponse[]) => void;
  setLoadingBalances: (v: boolean) => void;
  setLoadingPositions: (v: boolean) => void;
  setErrorBalances: (e: string | null) => void;
}

export const useAccountStore = create<AccountStore>((set) => ({
  balances: null,
  positions: [],
  loadingBalances: false,
  loadingPositions: false,
  errorBalances: null,
  lastUpdate: null,

  setBalances: (b) => set({ balances: b, lastUpdate: new Date(), errorBalances: null }),
  setPositions: (p) => set({ positions: p }),
  setLoadingBalances: (v) => set({ loadingBalances: v }),
  setLoadingPositions: (v) => set({ loadingPositions: v }),
  setErrorBalances: (e) => set({ errorBalances: e }),
}));

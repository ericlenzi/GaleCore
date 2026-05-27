import { create } from 'zustand';
import { FlowPayload } from '../types/api';

interface FlowStore {
  /** Flow snapshots indexed by underlying symbol (SPY, QQQ) */
  snapshots: Record<string, FlowPayload>;

  /** Symbols with active flow subscriptions */
  subscribedSymbols: string[];

  /** Update a flow snapshot (called from ReceiveFlow handler) */
  updateFlow: (symbol: string, payload: FlowPayload) => void;

  /** Clear a flow snapshot (called on UnsubscribeFlow) */
  clearFlow: (symbol: string) => void;

  /** Mark a symbol as subscribed to flow */
  addSubscription: (symbol: string) => void;

  /** Mark a symbol as unsubscribed from flow */
  removeSubscription: (symbol: string) => void;
}

export const useFlowStore = create<FlowStore>((set) => ({
  snapshots: {},
  subscribedSymbols: [],

  updateFlow: (symbol, payload) =>
    set((s) => ({
      snapshots: { ...s.snapshots, [symbol]: payload },
    })),

  clearFlow: (symbol) =>
    set((s) => {
      const { [symbol]: _, ...rest } = s.snapshots;
      return { snapshots: rest };
    }),

  addSubscription: (symbol) =>
    set((s) => ({
      subscribedSymbols: s.subscribedSymbols.includes(symbol)
        ? s.subscribedSymbols
        : [...s.subscribedSymbols, symbol],
    })),

  removeSubscription: (symbol) =>
    set((s) => ({
      subscribedSymbols: s.subscribedSymbols.filter((s2) => s2 !== symbol),
    })),
}));

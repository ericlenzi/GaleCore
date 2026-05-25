import { create } from 'zustand';
import { ValidationLayerApiResponse, GammaExposureResponse } from '../types/api';
import { fetchValidationLayer } from '../api/analytics';

interface ValidationCacheEntry {
  vlData: ValidationLayerApiResponse;
  gexData: GammaExposureResponse | null;
  updatedAt: Date;
}

interface ValidationStore {
  cache: Record<string, ValidationCacheEntry>;
  loading: Record<string, boolean>;
  error: Record<string, string | null>;

  fetchValidation: (symbol: string) => Promise<void>;
}

function deriveGexData(vl: ValidationLayerApiResponse): GammaExposureResponse | null {
  const g = vl.gexData;
  if (!g) return null;
  const strikes = g.strikes ?? [];
  if (!strikes.length) return null;

  const callWallStrike = strikes.reduce(
    (best, s) => (s.callGEX > best.callGEX ? s : best),
    strikes[0],
  );
  const putWallStrike = strikes.reduce(
    (best, s) => (s.putGEX < best.putGEX ? s : best),
    strikes[0],
  );
  const netGex = strikes.reduce((sum, s) => sum + s.netGEX, 0) / 1000;

  return {
    symbol: vl.symbol,
    spot: g.spot,
    dte: g.dte,
    expiration: g.expiration ?? '',
    zeroGammaLevel: g.gammaZeroLevel ?? 0,
    netGex,
    callWall: callWallStrike.strike,
    putWall: putWallStrike.strike,
    strikes: strikes.map((s) => ({
      strike: s.strike,
      callGex: s.callGEX,
      putGex: s.putGEX,
      netGex: s.netGEX,
      callOI: s.callOI,
      putOI: s.putOI,
      callDelta: s.callDelta,
      putDelta: s.putDelta,
    })),
  };
}

export const useValidationStore = create<ValidationStore>((set, get) => ({
  cache: {},
  loading: {},
  error: {},

  fetchValidation: async (symbol: string) => {
    set((s) => ({
      loading: { ...s.loading, [symbol]: true },
      error: { ...s.error, [symbol]: null },
    }));
    try {
      const vl = await fetchValidationLayer(symbol);
      const gexData = deriveGexData(vl);
      set((s) => ({
        cache: {
          ...s.cache,
          [symbol]: { vlData: vl, gexData, updatedAt: new Date() },
        },
        loading: { ...s.loading, [symbol]: false },
      }));
    } catch (e: any) {
      set((s) => ({
        loading: { ...s.loading, [symbol]: false },
        error: { ...s.error, [symbol]: e.message },
      }));
    }
  },
}));

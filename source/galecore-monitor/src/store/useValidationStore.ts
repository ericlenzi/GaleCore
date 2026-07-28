import { create } from 'zustand';
import { ValidationLayerApiResponse, GammaExposureResponse, StructureInputs } from '../types/api';
import { fetchValidationLayer, fetchPositionBuilder } from '../api/analytics';

interface ValidationCacheEntry {
  vlData: ValidationLayerApiResponse;
  gexData: GammaExposureResponse | null;
  /** Factores de contexto de mercado (z-score, skew, trend, RV, flow). Fuente: PositionBuilder,
   *  macro-independiente → disponibles aunque la cascada corte en macro. */
  structureInputs: StructureInputs | null;
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
      // ValidationLayer (cascada, primario) + PositionBuilder (motor macro-independiente) en
      // paralelo. El PB aporta structureInputs aunque macro corte. allSettled: PB no tumba a VL.
      const [vlRes, pbRes] = await Promise.allSettled([
        fetchValidationLayer(symbol),
        fetchPositionBuilder(symbol),
      ]);
      if (vlRes.status === 'rejected') throw vlRes.reason;
      const vl = vlRes.value;
      const gexData = deriveGexData(vl);
      const structureInputs = pbRes.status === 'fulfilled' ? pbRes.value.structureInputs : null;
      set((s) => ({
        cache: {
          ...s.cache,
          [symbol]: { vlData: vl, gexData, structureInputs, updatedAt: new Date() },
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

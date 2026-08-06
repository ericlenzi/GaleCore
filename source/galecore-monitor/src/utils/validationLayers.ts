import { LayerStatus, SignalType } from '../types/market';
import { ValidationLayerApiResponse } from '../types/api';

// Mapea la respuesta de ValidationLayer al shape (LayerStatus) que consumen los paneles
// de validación (ValidationLayersPanel, StrikesEnginePanel).
export function mapValidationToLayers(v: ValidationLayerApiResponse): LayerStatus {
  const mr = v.macroRegime;
  const checks = mr?.checks;
  const l2 = v.positionBuilder?.strikeEngine;
  const l3 = v.positionBuilder?.microstructure;
  const g = v.gexData;

  const signalMap: Record<string, SignalType> = {
    'OPERAR': 'OPERAR',
    'ESPERAR': 'ESPERAR',
    'NO_OPERAR': 'NO OPERAR',
  };

  let gexCallWall: number | null = null;
  let gexPutWall: number | null = null;
  if (g && g.strikes?.length) {
    const cw = g.strikes.reduce((best, s) => (s.callGEX > best.callGEX ? s : best), g.strikes[0]);
    const pw = g.strikes.reduce((best, s) => (s.putGEX < best.putGEX ? s : best), g.strikes[0]);
    gexCallWall = cw.strike;
    gexPutWall = pw.strike;
  }

  return {
    vixAbsoluteOk: checks?.vixAbsolute?.passed ?? null,
    vixAbsoluteValue: checks?.vixAbsolute?.value ?? null,
    vixTermStructureOk: checks?.vixTermStructure?.passed ?? null,
    ivRankOk: checks?.ivRank?.passed ?? null,
    ivRankValue: checks?.ivRank?.value ?? null,
    ivMomentumOk: checks?.ivMomentum?.passed ?? null,
    ivMomentumValue: checks?.ivMomentum?.value ?? null,
    // Sin umbral declarado para el símbolo no hay nada contra qué validar: el check queda en null
    // (gris, apagado) en vez de rojo, que se leería como "el GEX no alcanza".
    gexOk: checks?.gexTotal?.thresholdDeclared === false ? null : (checks?.gexTotal?.passed ?? null),
    gexValue: checks?.gexTotal?.value ?? null,
    spotAboveZgl: checks?.spotVsZgl?.passed ?? null,
    zglValue: checks?.spotVsZgl?.zgl ?? g?.gammaZeroLevel ?? null,

    expectedMove: l2?.expectedMove ?? null,
    callWall: l2?.callWall ?? gexCallWall,
    putWall: l2?.putWall ?? gexPutWall,

    atmStrike: l3?.atmStrike ?? null,
    atmCallOI: l3?.oiChecks?.shortCall?.value ?? null,
    atmPutOI: l3?.oiChecks?.shortPut?.value ?? null,
    atmCallDelta: l3?.atmCallDelta ?? null,
    atmPutDelta: l3?.atmPutDelta ?? null,

    signal: signalMap[v.overallSignal] ?? 'NO OPERAR',
  };
}

export const EMPTY_LAYERS: LayerStatus = {
  vixAbsoluteOk: null, vixAbsoluteValue: null,
  vixTermStructureOk: null, ivRankOk: null, ivRankValue: null,
  ivMomentumOk: null, ivMomentumValue: null,
  gexOk: null, gexValue: null, spotAboveZgl: null, zglValue: null,
  expectedMove: null, callWall: null, putWall: null,
  atmStrike: null, atmCallOI: null, atmPutOI: null,
  atmCallDelta: null, atmPutDelta: null, signal: 'NO OPERAR',
};

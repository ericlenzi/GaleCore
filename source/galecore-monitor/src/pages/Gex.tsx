import React, { useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { TickerGrid } from '../components/ticker/TickerGrid';
import { ValidationLayers } from '../components/validation/ValidationLayers';
import { MarketDiagnostics } from '../components/ticker/MarketDiagnostics';
import { OptionsChainList } from '../components/gex/OptionsChainList';
import { ExpiryEngine } from '../components/gex/ExpiryEngine';
import { GexChart } from '../components/chart/GexChart';
import { WorkersSwitch } from '../components/common/WorkersSwitch';
import { fetchGexWorkers, setGexWorkers } from '../api/gex';
import { useGexStore } from '../store/useGexStore';
import { useMarketStore } from '../store/useMarketStore';
import { GexAnalysisResponse, GexChartData, GexExpiryApi } from '../types/gex';
import { ValidationLayerApiResponse } from '../types/api';
import { mapValidationToLayers, EMPTY_LAYERS } from '../utils/validationLayers';
import { fmtGex, fmtPrice, fmtTime, isStale, tint } from '../utils/formatters';

// Fallback si el JSON no declara refresh_seconds. Los barridos se serializan en el backend, así que
// lo que manda es recorrer el universo entero (~383s medidos con 4 símbolos), no un barrido suelto.
const DEFAULT_REFRESH_SECONDS = 600;
const DETAIL_HEIGHT = 500;

/**
 * Adapta la respuesta de /App/Gex/Analysis al shape que consume mapValidationToLayers, para
 * reutilizar el panel de checks de Main sin duplicarlo. Acá los checks son lectura: el JSON de GEX
 * los declara con `on_fail: inform_only`.
 */
function asValidationShape(data: GexAnalysisResponse): ValidationLayerApiResponse {
  return {
    symbol: data.symbol,
    profile: 'gex',
    timestamp: data.timestamp,
    spotPrice: data.spotPrice,
    overallSignal: data.macroRegime?.signal ?? '',
    failedAtLayer: null,
    macroRegime: data.macroRegime,
    positionBuilder: null,
    gexData: null,
  };
}

/** Un vencimiento (o el agregado global) en el shape que dibuja GexChart + GexBarsPanel. */
function toChartData(symbol: string, spot: number, expiry: GexExpiryApi | null): GexChartData | null {
  if (!expiry) return null;
  return {
    symbol,
    spot,
    dte: expiry.dte,
    expiration: expiry.expiration,
    zeroGammaLevel: expiry.gammaZeroLevel ?? 0,
    netGex: expiry.netGex,
    callWall: expiry.callWall ?? 0,
    putWall: expiry.putWall ?? 0,
    strikes: expiry.strikes.map((s) => ({
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

/**
 * Pestaña GEX — estrategia informativa. Replica el layout de Main leyendo su propio JSON:
 * cards del universo, cuadro Details (checks + diagnóstico, sin microestructura) con el GEX GLOBAL,
 * y el cuadro Graph con la cadena por vencimiento. No calcula ni muestra setup candidato.
 */
export function Gex() {
  const {
    tickers, display, rulesLoading, rulesError, loadRules,
    cache, loading, error, selectedExpiry, fetchGex, selectExpiry,
    workersEnabled, setWorkers,
  } = useGexStore();

  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const active = selectedSymbol ?? tickers[0] ?? null;

  const ticker = useMarketStore((s) => (active ? s.tickers[active] : undefined));
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { loadRules(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Carga inicial + auto-refresh del símbolo activo. El período sale del JSON (display_config).
  // Con el switch en OFF no se programa nada: el backend igual rechazaría el barrido, pero pedirlo
  // sería ruido. Se hace una sola lectura para traer el dato congelado a la pantalla.
  const refreshSeconds = display?.refresh_seconds ?? DEFAULT_REFRESH_SECONDS;
  useEffect(() => {
    if (!active || workersEnabled == null) return;
    if (!cache[active]) fetchGex(active);
    if (!workersEnabled) return;

    intervalRef.current = setInterval(() => fetchGex(active), refreshSeconds * 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [active, refreshSeconds, workersEnabled]); // eslint-disable-line react-hooks/exhaustive-deps

  const entry = active ? cache[active] : undefined;
  const data = entry?.data ?? null;
  const isLoading = active ? loading[active] ?? false : false;
  const err = active ? error[active] ?? null : null;

  const expiries = useMemo(() => data?.gex.byExpiry ?? [], [data]);
  // Sin elección explícita manda el más cercano — que en día hábil es el 0DTE.
  const activeExpiration = (active ? selectedExpiry[active] : null) ?? expiries[0]?.expiration ?? null;
  const activeExpiry = useMemo(
    () => expiries.find((e) => e.expiration === activeExpiration) ?? null,
    [expiries, activeExpiration],
  );

  const layers = data ? mapValidationToLayers(asValidationShape(data)) : EMPTY_LAYERS;
  const chartData = active ? toChartData(active, data?.spotPrice ?? 0, activeExpiry) : null;

  // IV del vencimiento seleccionado, anualizada en % — alimenta las bandas ±1σ/±2σ del gráfico.
  const iv30 = activeExpiry?.atmIv != null ? activeExpiry.atmIv * 100 : undefined;

  // Un vencimiento sin Greeks no aporta al agregado: el GEX da más chico sin que se note.
  const partialScan = !!data
    && data.gex.global.expirationsRequested > data.gex.global.expirationsIncluded;

  // Switch en OFF: lo que se ve es el último barrido y nadie lo va a actualizar. Se marca con la
  // hora del dato para que no se lea como vigente.
  const frozen = workersEnabled === false || !!data?.frozen;

  const updated = entry?.updatedAt ?? null;
  const stale = isStale(updated, refreshSeconds * 1000 * 1.5);

  if (rulesLoading) {
    return <div className="p-4 text-xs" style={{ color: 'var(--text-muted)' }}>Cargando reglas de GEX…</div>;
  }
  if (rulesError) {
    return <div className="p-4 text-xs" style={{ color: 'var(--red-gc)' }}>Error cargando reglas de GEX: {rulesError}</div>;
  }

  return (
    <div className="flex flex-col">
      {/* Header — mismo formato que RPF: nombre de la estrategia + badge con su descripción. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px 0' }}>
        <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>GaleCore GEX</span>
        <span style={{
          fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4, letterSpacing: '0.06em',
          color: '#a78bfa', backgroundColor: tint('#a78bfa', 13), border: `1px solid ${tint('#a78bfa', 30)}`,
          fontFamily: 'JetBrains Mono, monospace',
        }}>
          Gamma Exposure
        </span>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 10 }}>
          <WorkersSwitch
            enabled={workersEnabled}
            fetchState={fetchGexWorkers}
            setState={setGexWorkers}
            onChange={setWorkers}
            title="Prender / apagar el barrido de la cadena. En OFF no se toca DXLink."
          />
        </span>
      </div>

      <div className="p-3">
        <TickerGrid symbols={tickers} selectedSymbol={active} onSelect={setSelectedSymbol} />
      </div>

      {active && (
        <>
          {/* ── Cuadro Details — GEX global + contexto. Sin columna Microstructure. ── */}
          <div style={{
            margin: '0 12px 12px',
            borderRadius: 10,
            border: '1px solid var(--border)',
            backgroundColor: 'var(--bg-secondary)',
            boxShadow: 'var(--shadow-sm)',
            overflow: 'hidden',
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 12px 8px',
              borderBottom: '1px solid var(--border-dark)',
            }}>
              <span style={{
                fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase',
                color: 'var(--text-muted)', fontFamily: 'Inter, sans-serif',
              }}>
                {active} · Details
              </span>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="tabular-nums" style={{
                  fontSize: 10, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-muted)',
                }}>
                  GEX global {fmtGex(data?.gex.global.netGex ?? 0)} · {data?.gex.global.expirationsIncluded ?? 0} vtos
                  {data?.gex.config.maxDte != null && ` ≤ ${data.gex.config.maxDte} DTE`}
                </span>
                {/* Barrido incompleto: sin este aviso, un GEX más chico por vencimientos faltantes
                    se lee como una caída real del gamma. */}
                {/* Barrido detenido: el dato es de antes y no se está actualizando. */}
                {frozen && (
                  <span
                    title={updated ? `Último barrido: ${fmtTime(updated)}` : 'Sin barrido en esta sesión'}
                    style={{
                      fontSize: 9, fontWeight: 700, letterSpacing: '0.06em',
                      padding: '2px 6px', borderRadius: 20,
                      color: 'var(--red-gc)',
                      backgroundColor: tint('var(--red-gc)', 10),
                      border: `1px solid ${tint('var(--red-gc)', 30)}`,
                      fontFamily: 'JetBrains Mono, monospace', whiteSpace: 'nowrap', cursor: 'help',
                    }}
                  >
                    DETENIDO{data ? ' · DATO CONGELADO' : ''}
                  </span>
                )}
                {partialScan && (
                  <span
                    title={`Faltaron ${(data!.gex.global.expirationsRequested - data!.gex.global.expirationsIncluded)} vencimientos · cobertura ${data!.gex.global.coveragePct}% de los símbolos`}
                    className="tabular-nums"
                    style={{
                      fontSize: 9, fontWeight: 700, letterSpacing: '0.06em',
                      padding: '2px 6px', borderRadius: 20,
                      color: 'var(--yellow-gc)',
                      backgroundColor: 'var(--yellow-muted)',
                      border: '1px solid var(--yellow-border)',
                      fontFamily: 'JetBrains Mono, monospace', whiteSpace: 'nowrap', cursor: 'help',
                    }}
                  >
                    PARCIAL {data!.gex.global.expirationsIncluded}/{data!.gex.global.expirationsRequested}
                  </span>
                )}
                {updated && (
                  <span className="tabular-nums" style={{
                    fontSize: 10, fontFamily: 'JetBrains Mono, monospace',
                    color: stale ? 'var(--yellow-gc)' : 'var(--text-muted)',
                  }}>
                    {fmtTime(updated)}
                  </span>
                )}
                <button
                  onClick={() => fetchGex(active, true)}
                  disabled={isLoading || frozen}
                  className="btn"
                  title={frozen ? 'Barrido detenido: prendé Workers para rebarrer' : 'Rebarrer la cadena'}
                  style={frozen ? { opacity: 0.45, cursor: 'default' } : undefined}
                >
                  <RefreshCw size={10} className={isLoading ? 'animate-spin' : ''} />
                  Reload
                </button>
              </div>
            </div>

            {err ? (
              <div style={{ padding: 16, fontSize: 12, color: 'var(--red-gc)' }}>
                Error cargando GEX: {err}
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'stretch' }}>
                <div style={{ flex: 1.4, minWidth: 0, borderRight: '1px solid var(--border-dark)' }}>
                  <ValidationLayers
                    layers={layers}
                    vlData={data ? asValidationShape(data) : null}
                    title={display?.details_panel?.title ?? 'Macro Régimen'}
                    subtitle={display?.details_panel?.subtitle
                      ?? 'Contexto de mercado — lectura informativa'}
                    gexLabel={display?.details_panel?.gex_label ?? 'GEX Global'}
                  />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <MarketDiagnostics inputs={data?.structureInputs ?? null} />
                </div>
              </div>
            )}
          </div>

          {/* ── Cuadro Graph — cadena por vencimiento ── */}
          <div style={{
            margin: '0 12px 12px',
            borderRadius: 10,
            overflow: 'hidden',
            border: '1px solid var(--border)',
            backgroundColor: 'var(--bg-secondary)',
            boxShadow: 'var(--shadow-sm)',
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '8px 14px',
              borderBottom: '1px solid var(--border-dark)',
              backgroundColor: 'var(--bg-tertiary)',
            }}>
              <span style={{
                fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, fontSize: 13,
                color: 'var(--text-primary)', letterSpacing: '0.04em',
              }}>
                {active} · Graph (GEX by Expiry)
              </span>
              <span className="tabular-nums" style={{
                fontSize: 10, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-muted)',
              }}>
                Spot {fmtPrice(ticker?.price || data?.spotPrice || 0)}
              </span>
            </div>

            <div style={{ display: 'flex', height: DETAIL_HEIGHT }}>
              {/* Izquierda: cadena + lectura numérica del vencimiento elegido */}
              <div style={{
                width: 230,
                flexShrink: 0,
                borderRight: '1px solid var(--border-dark)',
                overflowY: 'auto',
              }}>
                <OptionsChainList
                  expiries={expiries}
                  selected={activeExpiration}
                  onSelect={(exp) => selectExpiry(active, exp)}
                  label={display?.options_chain?.label}
                />
                <ExpiryEngine expiry={activeExpiry} label={display?.expiry_engine?.label} />
              </div>

              {/* Derecha: gráfico del vencimiento seleccionado */}
              <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
                {isLoading && !chartData ? (
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    height: '100%', gap: 8, fontSize: 12, color: 'var(--text-muted)',
                  }}>
                    <span className="spinner" /> Barriendo la cadena…
                  </div>
                ) : !chartData ? (
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    height: '100%', fontSize: 12, color: 'var(--text-muted)',
                  }}>
                    No GEX data
                  </div>
                ) : (
                  <GexChart
                    // Key por símbolo, no por vencimiento: cambiar de vencimiento redibuja muros y
                    // barras sin remontar el chart (remontarlo volvería a pedir las velas).
                    key={active}
                    symbol={active}
                    currentPrice={ticker?.price ?? data?.spotPrice ?? 0}
                    openPrice={ticker?.open ?? 0}
                    iv30={iv30}
                    gexData={chartData}
                    candleInterval={display?.candles?.interval ?? '1h'}
                    candleBucketSeconds={3600}
                    maxCandles={display?.candles?.count ?? 100}
                    candleFromDays={30}
                    rightPadBars={display?.candles?.right_pad_bars ?? 10}
                  />
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

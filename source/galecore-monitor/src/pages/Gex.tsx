import React, { useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, BookOpen } from 'lucide-react';
import { TickerGrid } from '../components/ticker/TickerGrid';
import { DetailsPanel } from '../components/gex/DetailsPanel';
import { OptionsChainList } from '../components/gex/OptionsChainList';
import { CHAIN_COL_W } from '../components/gex/graphLayout';
import { ExpiryEngine } from '../components/gex/ExpiryEngine';
import { GexChart } from '../components/chart/GexChart';
import { StrategySwitch } from '../components/common/StrategySwitch';
import { StrategyOffPanel } from '../components/common/StrategyOffPanel';
import { ReferencesModal } from '../components/common/ReferencesModal';
import { getStrategyReference } from '../components/strategy/strategyReferences';
import { GEX_SWITCH_ENDPOINT } from '../api/gex';
import { useGexStore } from '../store/useGexStore';
import { useMarketStore } from '../store/useMarketStore';
import { useAppConfigStore, useSwitchEndpoint } from '../store/useAppConfigStore';
import { useSwitchEnabled } from '../store/useStrategySwitchStore';
import { ConnectionStatus } from '../socket/useMarketSocket';
import {
  GexAnalysisResponse, GexChartData, GexExpiryApi, GexScopeApi, GexStrikeApi, GLOBAL_SCOPE,
} from '../types/gex';
import { fmtPrice, fmtTime, isStale, tint } from '../utils/formatters';

// Fallback si el JSON no declara refresh_seconds. Los barridos se serializan en el backend, así que
// lo que manda es recorrer el universo entero (~383s medidos con 4 símbolos), no un barrido suelto.
const DEFAULT_REFRESH_SECONDS = 600;
const DETAIL_HEIGHT = 500;

const GEX_REF = getStrategyReference('gex');

/** Strikes de la API al shape que dibuja GexBarsPanel. Igual para un vencimiento y para el agregado. */
function toChartStrikes(strikes: GexStrikeApi[]) {
  return strikes.map((s) => ({
    strike: s.strike,
    callGex: s.callGEX,
    putGex: s.putGEX,
    netGex: s.netGEX,
    callOI: s.callOI,
    putOI: s.putOI,
    callDelta: s.callDelta,
    putDelta: s.putDelta,
  }));
}

/** Un vencimiento en el shape que dibuja GexChart + GexBarsPanel. */
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
    strikes: toChartStrikes(expiry.strikes),
  };
}

/**
 * El agregado de toda la cadena en el mismo shape. ZGL y muros ya vienen calculados sobre los
 * strikes agregados, así que el gráfico no hace nada distinto: dibuja otro scope.
 *
 * `dte: 0` y `expiration: GLOBAL_SCOPE` son relleno del contrato — el agregado no tiene ninguno de
 * los dos. Nadie los lee: `expiration` no se usa en el chart, y `dte` solo entra en las bandas
 * ±1σ/±2σ, que en global no se dibujan porque no hay IV ATM que las alimente.
 */
function globalToChartData(symbol: string, spot: number, global: GexScopeApi): GexChartData | null {
  if (!global.strikes.length) return null;
  return {
    symbol,
    spot,
    dte: 0,
    expiration: GLOBAL_SCOPE,
    zeroGammaLevel: global.gammaZeroLevel ?? 0,
    netGex: global.netGex,
    callWall: global.callWall ?? 0,
    putWall: global.putWall ?? 0,
    strikes: toChartStrikes(global.strikes),
  };
}

/**
 * Pestaña GEX — estrategia informativa. Replica el layout de Main leyendo su propio JSON:
 * cards del universo, cuadro Details (checks + diagnóstico, sin microestructura) con el GEX GLOBAL,
 * y el cuadro Graph con la cadena por vencimiento. No calcula ni muestra setup candidato.
 */
interface GexProps {
  subscribeSymbol: (symbol: string) => void;
  unsubscribeSymbol: (symbol: string) => void;
  socketStatus: ConnectionStatus;
}

export function Gex({ subscribeSymbol, unsubscribeSymbol, socketStatus }: GexProps) {
  const {
    tickers, display, rulesLoading, rulesError, loadRules,
    cache, loading, error, selectedExpiry, fetchGex, selectExpiry,
  } = useGexStore();

  const platformTickers = useAppConfigStore((s) => s.tickers);

  // El switch es el mismo que muestra la card de GEX en Main: mismo endpoint, mismo store.
  const switchEndpoint = useSwitchEndpoint('gex', GEX_SWITCH_ENDPOINT);
  const switchEnabled = useSwitchEnabled(switchEndpoint);

  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [refOpen, setRefOpen] = useState(false);
  const active = selectedSymbol ?? tickers[0] ?? null;

  const ticker = useMarketStore((s) => (active ? s.tickers[active] : undefined));
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { loadRules(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Suscribir al hub el DELTA del universo de GEX: los símbolos de su JSON que la plataforma no
  // streamea. App ya suscribe universe.tickers del config de app (SPY/QQQ); acá completamos el resto
  // (AAPL, SKM…) para que sus cards tengan precio/quote/estado de mercado en vivo, no solo el REST
  // inicial. Se excluye lo que ya suscribe la plataforma para no desuscribírselo al salir de la
  // pestaña: la conexión del hub es única y compartida con Monitor/RPF/Home.
  //
  // Gateado por el switch: en OFF la estrategia no puede seguir ocupando el hub con símbolos que
  // solo ella necesita. Apagarla tiene que apagar TODA su actividad, no solo el barrido.
  const extraTickersKey = tickers.filter((s) => !platformTickers.includes(s)).join(',');
  useEffect(() => {
    if (socketStatus !== 'connected' || !switchEnabled) return;
    const extras = extraTickersKey ? extraTickersKey.split(',') : [];
    extras.forEach(subscribeSymbol);
    return () => extras.forEach(unsubscribeSymbol);
  }, [extraTickersKey, socketStatus, switchEnabled, subscribeSymbol, unsubscribeSymbol]);

  // Carga inicial + auto-refresh del símbolo activo. El período sale del JSON (display_config).
  // Con el switch en OFF no se programa nada: el backend igual rechazaría el barrido, pero pedirlo
  // sería ruido. Se hace una sola lectura para traer el dato congelado a la pantalla.
  const refreshSeconds = display?.refresh_seconds ?? DEFAULT_REFRESH_SECONDS;
  useEffect(() => {
    // En OFF no se pide NADA, ni siquiera la lectura inicial: antes se hacía un fetch para traer el
    // dato congelado a pantalla, pero con la pantalla reducida al cartel de apagado ese dato no se
    // muestra en ningún lado. Era una request al backend cuyo resultado nadie miraba.
    if (!active || !switchEnabled) return;
    if (!cache[active]) fetchGex(active);

    intervalRef.current = setInterval(() => fetchGex(active), refreshSeconds * 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [active, refreshSeconds, switchEnabled]); // eslint-disable-line react-hooks/exhaustive-deps

  const entry = active ? cache[active] : undefined;
  const data = entry?.data ?? null;
  const isLoading = active ? loading[active] ?? false : false;
  const err = active ? error[active] ?? null : null;

  const expiries = useMemo(() => data?.gex.byExpiry ?? [], [data]);
  // Sin elección explícita manda el más cercano — que en día hábil es el 0DTE. El agregado global
  // NO es el default: es una lectura distinta (sin vencimiento, sin DTE) y se pide a mano.
  const activeExpiration = (active ? selectedExpiry[active] : null) ?? expiries[0]?.expiration ?? null;
  const isGlobalScope = activeExpiration === GLOBAL_SCOPE;
  const activeExpiry = useMemo(
    () => (isGlobalScope ? null : expiries.find((e) => e.expiration === activeExpiration) ?? null),
    [expiries, activeExpiration, isGlobalScope],
  );

  const chartData = !active || !data
    ? null
    : isGlobalScope
      ? globalToChartData(active, data.spotPrice ?? 0, data.gex.global)
      : toChartData(active, data.spotPrice ?? 0, activeExpiry);

  // IV del vencimiento seleccionado, anualizada en % — alimenta las bandas ±1σ/±2σ del gráfico.
  // En global queda undefined y las bandas no se dibujan: el agregado no tiene IV ATM (ni un solo
  // vencimiento del que sacarla), y tomar la del más cercano sería mostrar otro scope.
  const iv30 = activeExpiry?.atmIv != null ? activeExpiry.atmIv * 100 : undefined;

  // Un vencimiento sin Greeks no aporta al agregado: el GEX da más chico sin que se note.
  const partialScan = !!data
    && data.gex.global.expirationsRequested > data.gex.global.expirationsIncluded;

  // Switch en OFF: lo que se ve es el último barrido y nadie lo va a actualizar. Se marca con la
  // hora del dato para que no se lea como vigente.
  const frozen = switchEnabled === false || !!data?.frozen;

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
          Gamma Exposure · v1.4
        </span>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={() => setRefOpen(true)}
            title="Definiciones de la estrategia + JSON de reglas"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 6,
              background: 'none', border: '1px solid var(--border)', cursor: 'pointer',
              fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
              color: 'var(--text-secondary)', fontFamily: 'Inter, sans-serif',
            }}
          >
            <BookOpen size={12} /> References
          </button>
          <StrategySwitch
            endpoint={switchEndpoint}
            title="Prender / apagar el barrido de la cadena. En OFF no se toca DXLink."
          />
        </span>
      </div>

      {GEX_REF && (
        <ReferencesModal
          open={refOpen}
          onClose={() => setRefOpen(false)}
          title="GEX · Referencias"
          accentColor={GEX_REF.accentColor}
          definitions={GEX_REF.definitions}
          fetchJson={GEX_REF.fetchJson}
        />
      )}

      {/* Switch en OFF: la pantalla se reduce al encabezado y un cartel. Cortar el árbol acá apaga
          actividad real, no solo píxeles — TickerGrid hace su propio polling REST de respaldo y el
          gráfico mantiene series vivas. Mostrar el último barrido "congelado" era peor: un panel
          lleno de números se lee como vigente aunque diga que no lo está. */}
      {switchEnabled === false ? (
        <div className="px-3">
          <StrategyOffPanel detail="Apagada para TODA la plataforma: no se barre la cadena, no se toca DXLink ni a pedido, y no se suscribe ningun simbolo propio de la estrategia. El estado se guarda, asi que un reinicio no la vuelve a prender sola." />
        </div>
      ) : (
      <>
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
                  {/* Solo la COBERTURA del barrido. El GEX global se fue de acá: es una métrica y
                      vive en su celda del cuadro (grupo "Estructura gamma"), donde tiene su
                      referencia al lado. Repetido en el encabezado, el mismo número aparecía dos
                      veces en la misma pantalla con dos formatos distintos. */}
                  {data?.gex.global.expirationsIncluded ?? 0} vtos
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
                  title={frozen ? 'Barrido detenido: prendé la estrategia para rebarrer' : 'Rebarrer la cadena'}
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
              <DetailsPanel
                data={data}
                groups={display?.details_panel?.groups}
                subtitle={display?.details_panel?.subtitle
                  ?? 'Contexto de mercado — lectura informativa'}
              />
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
                {active} · Graph ({isGlobalScope ? 'GEX Global — toda la cadena' : 'GEX by Expiry'})
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
                width: CHAIN_COL_W,
                flexShrink: 0,
                borderRight: '1px solid var(--border-dark)',
                overflowY: 'auto',
              }}>
                <OptionsChainList
                  expiries={expiries}
                  selected={activeExpiration}
                  onSelect={(scope) => selectExpiry(active, scope)}
                  label={display?.options_chain?.label}
                  globalNetGex={data?.gex.global.netGex}
                  maxDte={data?.gex.config.maxDte}
                  globalLabel={display?.options_chain?.global_row?.label}
                />
                <ExpiryEngine
                  scope={isGlobalScope && data
                    ? { kind: 'global', global: data.gex.global, maxDte: data.gex.config.maxDte ?? null }
                    : { kind: 'expiry', expiry: activeExpiry }}
                  label={display?.expiry_engine?.label}
                />
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
      </>
      )}
    </div>
  );
}

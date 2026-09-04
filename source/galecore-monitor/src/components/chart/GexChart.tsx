import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  createChart,
  IChartApi,
  ISeriesApi,
  CandlestickSeries,
  LineSeries,
  LineStyle,
  ColorType,
  CrosshairMode,
} from 'lightweight-charts';
import { GammaBandApi, GexChartData } from '../../types/gex';
import { BAND_FILL_ALPHA, CALL_COLOR, PUT_COLOR, sideColorAlpha } from '../../utils/optionSideColors';
import { fetchEquityCandles } from '../../api/marketdata';
import { fmtPrice, etDateParts, etOffsetMinutes } from '../../utils/formatters';
import { GexBarsPanel } from './GexBarsPanel';

interface Props {
  symbol:       string;
  currentPrice: number;
  openPrice?:   number;
  iv30?:        number;
  gexData:      GexChartData | null;
  /** Temporalidad de las velas. Default '5m' (intradía de Main). La pestaña GEX pasa '1h'. */
  candleInterval?: string;
  /** Segundos por vela — define el bucket de la actualización live. Debe acompañar a candleInterval. */
  candleBucketSeconds?: number;
  /** Se queda con las últimas N velas. Sin esto muestra todo lo que devuelva la API. */
  maxCandles?: number;
  /** Días calendario hacia atrás a pedir. Sin esto arranca en el open de hoy (intradía). */
  candleFromDays?: number;
  /** Barras vacías a la derecha: corren las velas a la izquierda y dejan aire para el precio. */
  rightPadBars?: number;
}

const DEFAULT_BUCKET = 5 * 60;

/** Píxeles de área de precio por debajo de los cuales no vale la pena descontarle el eje al sombreado. */
const MIN_ANCHO_SOMBRA = 80;

function getBucket(s: number, bucketSeconds: number) {
  return Math.floor(s / bucketSeconds) * bucketSeconds;
}

/**
 * Instante Unix del open (09:30 ET) de hoy.
 *
 * Antes calculaba el offset con una regla por mes ("marzo a noviembre = -4") y tomaba el día con
 * getUTCDate(). Las dos cosas estaban mal: la regla se equivoca la primera semana de marzo y casi
 * todo noviembre (el DST arranca el 2º domingo de marzo y termina el 1er domingo de noviembre), y
 * el día UTC no es el día ET de noche en Buenos Aires — a las 22:00 marcaba el open de mañana.
 * Ahora los dos salen de los helpers de formatters, que usan Intl.
 */
function marketOpenUnix(): number {
  const [y, m, d] = etDateParts();
  // Instante "09:30 como si ET fuera UTC"; restarle el offset lo lleva al UTC real del open.
  const asIfUtc = Date.UTC(y, m - 1, d, 9, 30);
  return Math.floor((asIfUtc - etOffsetMinutes(new Date(asIfUtc)) * 60_000) / 1000);
}

export function GexChart({
  symbol, currentPrice, openPrice, iv30, gexData,
  candleInterval = '5m',
  candleBucketSeconds = DEFAULT_BUCKET,
  maxCandles,
  candleFromDays,
  rightPadBars = 0,
}: Props) {
  const outerRef      = useRef<HTMLDivElement>(null);   // flex container
  const containerRef  = useRef<HTMLDivElement>(null);   // chart div
  const chartRef      = useRef<IChartApi | null>(null);
  const seriesRef     = useRef<ISeriesApi<'Candlestick' | 'Line', any> | null>(null);
  const gexLinesRef   = useRef<any[]>([]);
  const candlesRef    = useRef<{ time: number; open: number; high: number; low: number; close: number }[]>([]);
  const useCandlesRef = useRef(false);

  // renderTick: incremented on scroll/resize so GexBarsPanel re-renders
  const [renderTick, setRenderTick] = useState(0);
  const [chartH, setChartH] = useState(400);

  const bump = useCallback(() => setRenderTick(n => n + 1), []);

  // Encuadre del eje temporal. Con rightPadBars > 0 el rango visible se extiende N barras más allá
  // de la última vela: quedan esos slots vacíos a la derecha y las velas corridas a la izquierda.
  // fitContent() no sirve para eso — ajusta el rango exacto a los datos e ignora el offset.
  const fitView = useCallback(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const n = candlesRef.current.length;
    if (rightPadBars > 0 && n > 0) {
      chart.timeScale().setVisibleLogicalRange({ from: 0, to: n - 1 + rightPadBars });
    } else {
      chart.timeScale().fitContent();
    }
  }, [rightPadBars]);

  // ── Build chart ────────────────────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: '#080d1b' },
        textColor: '#8da5cc',
        fontFamily: 'Inter, sans-serif',
        fontSize: 11,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: 'rgba(30,48,74,0.5)', style: LineStyle.Dotted },
        horzLines: { color: 'rgba(30,48,74,0.5)', style: LineStyle.Dotted },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: '#2d4571', width: 1, style: LineStyle.Dashed, labelBackgroundColor: '#1a2844' },
        horzLine: { color: '#2d4571', width: 1, style: LineStyle.Dashed, labelBackgroundColor: '#1a2844' },
      },
      rightPriceScale: { borderColor: '#1c2f4a', textColor: '#8da5cc', scaleMargins: { top: 0.08, bottom: 0.08 } },
      // rightOffset mantiene el aire a la derecha cuando el usuario scrollea; fitView lo aplica al
      // encuadre inicial. Sin los dos, el padding se pierde en cuanto el chart se reajusta.
      timeScale: {
        borderColor: '#1c2f4a', timeVisible: true, secondsVisible: false, fixLeftEdge: true,
        rightOffset: rightPadBars,
      },
      width:  el.clientWidth,
      height: el.clientHeight || 400,
    });

    const series = chart.addSeries(LineSeries, { color: '#3b82f6', lineWidth: 2, priceLineVisible: false, lastValueVisible: true });
    const now    = Math.floor(Date.now() / 1000);
    const mktOpen = marketOpenUnix();
    const pts: { time: any; value: number }[] = [];
    // Only add open price if market already opened (mktOpen < now), otherwise time order breaks
    if (openPrice && openPrice > 0 && mktOpen < now) pts.push({ time: mktOpen, value: openPrice });
    if (currentPrice > 0)                             pts.push({ time: now, value: currentPrice });
    if (pts.length) series.setData(pts);

    chartRef.current  = chart;
    seriesRef.current = series;

    chart.timeScale().subscribeVisibleLogicalRangeChange(bump);

    const ro = new ResizeObserver(() => {
      if (el) {
        chart.applyOptions({ width: el.clientWidth, height: el.clientHeight });
        setChartH(el.clientHeight);
      }
      bump();
    });
    ro.observe(el);

    // ── Sincronización con el eje de PRECIO ───────────────────────────────────
    // `subscribeVisibleLogicalRangeChange` es del eje de TIEMPO: arrastrar o hacer rueda sobre la
    // escala vertical no lo dispara. Como el panel de barras no tiene escala propia —posiciona cada
    // strike con el `priceToCoordinate` de esta misma serie— se quedaba con las coordenadas
    // anteriores hasta el siguiente render por otra causa: un tick de precio, un scroll horizontal
    // o un resize. Con el mercado cerrado eso es "hasta que muevas otra cosa".
    //
    // lightweight-charts no publica un evento de cambio de rango de precio, así que se escuchan los
    // gestos que lo cambian y se compara el mapeo antes de re-renderizar: en un pan horizontal el
    // eje de precio no se movió y el panel no tiene por qué redibujar su SVG entero.
    // La firma son dos coordenadas fijas leídas al revés (`coordinateToPrice`): el mapeo es lineal,
    // así que dos puntos detectan tanto un desplazamiento como un zoom. Va en ese sentido y no con
    // `priceToCoordinate` de dos precios sonda porque las coordenadas 0 y 100 siempre son válidas,
    // mientras que un precio sonda fuera de la vista depende de cómo extrapole la librería.
    const firmaEscala = () => {
      const s = seriesRef.current;
      if (!s) return null;
      const arriba = s.coordinateToPrice(0);
      const abajo  = s.coordinateToPrice(100);
      return arriba == null || abajo == null ? null : `${arriba}|${abajo}`;
    };
    let firmaPrev = firmaEscala();
    const sincronizar = () => {
      const f = firmaEscala();
      if (f === firmaPrev) return;
      firmaPrev = f;
      bump();
    };
    // El doble click (reset del autoscale) y el final de un arrastre pueden aplicarse recién en el
    // frame siguiente; una segunda pasada en rAF los alcanza sin dejar un loop permanente corriendo.
    let rafId = 0;
    const sincronizarPronto = () => {
      sincronizar();
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(sincronizar);
    };

    let arrastrando = false;
    const onDown = () => { arrastrando = true; };
    const onMove = () => { if (arrastrando) sincronizar(); };
    const onUp   = () => { if (!arrastrando) return; arrastrando = false; sincronizarPronto(); };

    el.addEventListener('pointerdown', onDown);
    // move/up escuchan en window: el arrastre del eje sigue vivo aunque el puntero se salga del
    // gráfico, y ahí el evento ya no pasa por el contenedor.
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    el.addEventListener('wheel', sincronizarPronto, { passive: true });
    el.addEventListener('dblclick', sincronizarPronto);

    setChartH(el.clientHeight || 400);

    return () => {
      ro.disconnect();
      cancelAnimationFrame(rafId);
      el.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      el.removeEventListener('wheel', sincronizarPronto);
      el.removeEventListener('dblclick', sincronizarPronto);
      chart.remove();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load intraday candles ─────────────────────────────────────────────────
  useEffect(() => {
    if (!chartRef.current) return;
    fetchEquityCandles(symbol, candleInterval, { fromDays: candleFromDays, limit: maxCandles }).then(candles => {
      if (!candles.length || !chartRef.current) return;
      const chart = chartRef.current;
      if (seriesRef.current && !useCandlesRef.current) {
        chart.removeSeries(seriesRef.current);
        const cs = chart.addSeries(CandlestickSeries, {
          upColor: '#22c55e', downColor: '#f43f5e',
          borderUpColor: '#22c55e', borderDownColor: '#f43f5e',
          wickUpColor: '#22c55e', wickDownColor: '#f43f5e',
          priceLineVisible: false, lastValueVisible: true,
        });
        cs.setData(candles as any);
        seriesRef.current    = cs;
        useCandlesRef.current = true;
        candlesRef.current   = candles;
        fitView();
        bump();
      }
    }).catch(() => {});
  }, [symbol]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Live price update ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!seriesRef.current || currentPrice <= 0) return;
    const now    = Math.floor(Date.now() / 1000);
    const bucket = getBucket(now, candleBucketSeconds);
    if (useCandlesRef.current) {
      const candles = candlesRef.current;
      const last    = candles[candles.length - 1];
      if (last && last.time === bucket) {
        const updated = { ...last, close: currentPrice, high: Math.max(last.high, currentPrice), low: Math.min(last.low, currentPrice) };
        try { seriesRef.current.update({ ...updated, time: updated.time as any }); } catch {}
        candlesRef.current[candles.length - 1] = updated;
      } else if (last && bucket > last.time) {
        const newC = { time: bucket, open: currentPrice, high: currentPrice, low: currentPrice, close: currentPrice };
        try { seriesRef.current.update({ ...newC, time: newC.time as any }); } catch {}
        candlesRef.current = [...candles, newC];
      }
    } else {
      try { seriesRef.current.update({ time: now as any, value: currentPrice }); }
      catch { seriesRef.current.setData([{ time: now as any, value: currentPrice }]); }
    }
  }, [currentPrice, candleBucketSeconds]);

  // ── GEX price lines + StdDev + autoscale ──────────────────────────────────
  useEffect(() => {
    const series = seriesRef.current;
    if (!series || !gexData) return;

    gexLinesRef.current.forEach(l => { try { series.removePriceLine(l); } catch {} });
    gexLinesRef.current = [];

    const add = (price: number, color: string, label: string, width: 1|2|3|4, style: LineStyle, axis = true) => {
      if (!price) return;
      gexLinesRef.current.push(series.createPriceLine({ price, color, lineWidth: width, lineStyle: style, axisLabelVisible: axis, title: label }));
    };

    // El MURO es el nivel con nombre y valor: línea con etiqueta en el eje. La BANDA no entra acá
    // — va como sombreado (ver BandShade abajo), sin etiqueta, igual que en el panel de barras.
    add(gexData.callWall,       CALL_COLOR, `Call Wall ${fmtPrice(gexData.callWall, 0)}`,       2, LineStyle.Dashed);
    add(gexData.putWall,        PUT_COLOR,  `Put Wall ${fmtPrice(gexData.putWall, 0)}`,         2, LineStyle.Dashed);
    add(gexData.zeroGammaLevel, '#94a3b8', `ZGL ${fmtPrice(gexData.zeroGammaLevel, 0)}`,        1, LineStyle.Dashed);

    const spot = gexData.spot;
    const dte  = gexData.dte;
    if (iv30 && iv30 > 0 && spot > 0 && dte > 0) {
      const em = spot * (iv30 / 100) * Math.sqrt(dte / 365);
      add(spot + em,     '#60a5fa', `+1σ ${fmtPrice(spot+em, 0)}`,   1, LineStyle.Dotted);
      add(spot - em,     '#60a5fa', `-1σ ${fmtPrice(spot-em, 0)}`,   1, LineStyle.Dotted);
      add(spot + 2 * em, '#3b82f6', `+2σ ${fmtPrice(spot+2*em, 0)}`, 1, LineStyle.Dotted, false);
      add(spot - 2 * em, '#3b82f6', `-2σ ${fmtPrice(spot-2*em, 0)}`, 1, LineStyle.Dotted, false);
    }

    // Tight autoscale: walls + 10% margin — candles stay readable
    const lo = gexData.putWall  ? gexData.putWall  * 0.985 : undefined;
    const hi = gexData.callWall ? gexData.callWall * 1.015 : undefined;
    if (lo != null && hi != null) {
      series.applyOptions({
        autoscaleInfoProvider: () => ({ priceRange: { minValue: lo!, maxValue: hi! }, margins: { above: 0.10, below: 0.10 } }),
      });
    }

    fitView();
    bump();
  }, [gexData, iv30]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ancho del eje de precios, para que el sombreado de la banda no lo tiña: la zona es del área de
  // precio, no de la escala. Se relee en cada renderTick porque el eje cambia de ancho cuando
  // cambian los dígitos del precio (de 3 a 4 cifras) o cuando el chart se redimensiona.
  const axisW = React.useMemo(() => {
    try {
      const eje = chartRef.current?.priceScale('right').width() ?? 0;
      const total = containerRef.current?.clientWidth ?? 0;
      // Si el eje se come casi todo el ancho no se descuenta nada: con `right: eje` el sombreado
      // colapsaría a ancho cero y directamente no se vería. Pasa con la ventana angosta, porque el
      // panel de barras tiene ancho fijo y el gráfico se queda con lo que sobra. Teñir también el
      // eje es mucho menos malo que no dibujar la banda.
      return total - eje > MIN_ANCHO_SOMBRA ? eje : 0;
    } catch { return 0; }
  // renderTick no se usa adentro a propósito: es el disparador. Los dos anchos salen de refs, que
  // no disparan render — igual que priceToY acá al lado.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderTick]);

  // priceToY: maps any price → canvas Y coordinate (reads seriesRef, refreshes on renderTick)
  const priceToY = useCallback((price: number): number | null => {
    if (!seriesRef.current) return null;
    const y = seriesRef.current.priceToCoordinate(price);
    return y == null ? null : (y as number);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderTick]);

  return (
    <div ref={outerRef} style={{ display: 'flex', width: '100%', height: '100%', minHeight: 400 }}>
      {/* Candle chart — takes all available space. El wrapper es `relative` para que el sombreado
          de la banda se posicione sobre el canvas; lightweight-charts no dibuja zonas entre dos
          precios, así que va como overlay traducido con priceToCoordinate. */}
      <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
        <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
        {gexData && (
          <>
            <BandShade band={gexData.callBand} color={CALL_COLOR} priceToY={priceToY} height={chartH} rightInset={axisW} />
            <BandShade band={gexData.putBand}  color={PUT_COLOR}  priceToY={priceToY} height={chartH} rightInset={axisW} />
          </>
        )}
      </div>

      {/* GEX bars panel — fixed width, synchronized Y axis */}
      {gexData && (
        <GexBarsPanel
          strikes={gexData.strikes}
          spot={currentPrice || gexData.spot}
          callBand={gexData.callBand}
          putBand={gexData.putBand}
          callWall={gexData.callWall}
          putWall={gexData.putWall}
          zgl={gexData.zeroGammaLevel}
          priceToY={priceToY}
          height={chartH}
        />
      )}
    </div>
  );
}

/**
 * La banda de gamma sobre las velas: una zona tenue entre sus dos extremos, **sin etiqueta**.
 *
 * Es el mismo objeto que pinta `GexBarsPanel`, con el mismo color de lado y la misma opacidad
 * (`BAND_FILL_ALPHA`) — los dos gráficos comparten el eje de precio, así que dos tratamientos
 * distintos se leerían como dos cosas distintas.
 *
 * No lleva texto a propósito: el nivel con nombre y valor es el **muro**, que va como línea con
 * etiqueta en el eje. La banda dice qué tan ancha es la concentración alrededor, y eso es una
 * lectura de forma.
 *
 * **Va POR ENCIMA del canvas y no puede ir por debajo**, que es la diferencia con el panel de
 * barras —ahí el sombreado es fondo y las barras se leen arriba—. lightweight-charts pinta sobre
 * canvas con `z-index` 1 y 2 y fondo opaco (`#080d1b`), así que un overlay sin `z-index` queda
 * tapado y no se ve nada. Con 0.10 de alpha, tintar las velas en vez de quedar detrás es
 * indistinguible a ojo y las deja perfectamente legibles.
 *
 * `pointerEvents: none` para que no se coma el crosshair ni el scroll del chart. `null` no dibuja
 * nada — es lo que pasa en el scope agregado, donde la banda no está definida.
 */
function BandShade({ band, color, priceToY, height, rightInset }: {
  band: GammaBandApi | null;
  color: string;
  priceToY: (price: number) => number | null;
  height: number;
  /** Cuánto dejar libre a la derecha: el ancho del eje de precios, ya acotado por el que llama. */
  rightInset: number;
}) {
  if (!band) return null;
  const yHi = priceToY(band.high);
  const yLo = priceToY(band.low);
  if (yHi === null || yLo === null) return null;

  const top = Math.min(yHi, yLo);
  const alto = Math.abs(yHi - yLo);
  // Fuera de la vista visible no se dibuja: sin esto la zona se estira contra el borde del canvas
  // cuando el usuario scrollea el eje de precio, y una franja pegada al borde se lee como un dato.
  if (alto <= 0 || top > height || top + alto < 0) return null;

  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: rightInset,
        top,
        height: alto,
        backgroundColor: sideColorAlpha(color, BAND_FILL_ALPHA),
        pointerEvents: 'none',
        // Por encima de los dos canvas de lightweight-charts (z-index 1 y 2). Sin esto el
        // sombreado existe en el DOM, con su posición y su color correctos, y no se ve nada.
        zIndex: 3,
      }}
    />
  );
}

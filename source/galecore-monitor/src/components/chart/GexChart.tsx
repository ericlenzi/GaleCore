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
import { GammaExposureResponse } from '../../types/api';
import { fetchEquityCandles } from '../../api/marketdata';
import { fmtPrice } from '../../utils/formatters';
import { GexBarsPanel } from './GexBarsPanel';

interface Props {
  symbol:       string;
  currentPrice: number;
  openPrice?:   number;
  iv30?:        number;
  gexData:      GammaExposureResponse | null;
}

const BUCKET = 5 * 60;

function get5mBucket(s: number) { return Math.floor(s / BUCKET) * BUCKET; }

function marketOpenUnix(): number {
  const now   = new Date();
  const month = now.getUTCMonth() + 1;
  const etOff = month >= 3 && month <= 11 ? 4 : 5;
  return Math.floor(new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 9 + etOff, 30
  )).getTime() / 1000);
}

export function GexChart({ symbol, currentPrice, openPrice, iv30, gexData }: Props) {
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
      timeScale: { borderColor: '#1c2f4a', timeVisible: true, secondsVisible: false, fixLeftEdge: true },
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

    setChartH(el.clientHeight || 400);

    return () => { ro.disconnect(); chart.remove(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load intraday candles ─────────────────────────────────────────────────
  useEffect(() => {
    if (!chartRef.current) return;
    fetchEquityCandles(symbol).then(candles => {
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
        chart.timeScale().fitContent();
        bump();
      }
    }).catch(() => {});
  }, [symbol]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Live price update ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!seriesRef.current || currentPrice <= 0) return;
    const now    = Math.floor(Date.now() / 1000);
    const bucket = get5mBucket(now);
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
  }, [currentPrice]);

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

    add(gexData.callWall,       '#f43f5e', `Call Wall ${fmtPrice(gexData.callWall, 0)}`,       2, LineStyle.Dashed);
    add(gexData.putWall,        '#22c55e', `Put Wall ${fmtPrice(gexData.putWall, 0)}`,          2, LineStyle.Dashed);
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

    if (chartRef.current) chartRef.current.timeScale().fitContent();
    bump();
  }, [gexData, iv30]); // eslint-disable-line react-hooks/exhaustive-deps

  // priceToY: maps any price → canvas Y coordinate (reads seriesRef, refreshes on renderTick)
  const priceToY = useCallback((price: number): number | null => {
    if (!seriesRef.current) return null;
    const y = seriesRef.current.priceToCoordinate(price);
    return y == null ? null : (y as number);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderTick]);

  return (
    <div ref={outerRef} style={{ display: 'flex', width: '100%', height: '100%', minHeight: 400 }}>
      {/* Candle chart — takes all available space */}
      <div ref={containerRef} style={{ flex: 1, minWidth: 0 }} />

      {/* GEX bars panel — fixed width, synchronized Y axis */}
      {gexData && (
        <GexBarsPanel
          strikes={gexData.strikes}
          spot={currentPrice || gexData.spot}
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

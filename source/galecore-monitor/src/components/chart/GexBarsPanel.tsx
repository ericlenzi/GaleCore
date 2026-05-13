import React from 'react';
import { GexStrike } from '../../types/api';
import { fmtPrice } from '../../utils/formatters';

interface Props {
  strikes:  GexStrike[];
  spot:     number;
  callWall: number;
  putWall:  number;
  zgl:      number;
  priceToY: (price: number) => number | null;
  height:   number;
}

const PANEL_W  = 176;
const LABEL_W  = 38;  // px for strike labels on left
const BAR_AREA = PANEL_W - LABEL_W - 4; // total horizontal space for bars
const HALF_BAR = BAR_AREA / 2;          // each side (put left, call right)
const CENTER_X = LABEL_W + HALF_BAR;    // x=0 axis position

export const GexBarsPanel = React.memo(function GexBarsPanel({
  strikes, spot, callWall, putWall, zgl, priceToY, height,
}: Props) {
  if (!strikes.length || height <= 0) return null;

  const maxCallGex = Math.max(...strikes.map(s => s.callGex), 0.001);
  const maxPutGex  = Math.max(...strikes.map(s => Math.abs(s.putGex)), 0.001);
  const maxAbs     = Math.max(maxCallGex, maxPutGex);

  // Only render strikes in visible area (with small clip buffer)
  const visible = strikes.filter(s => {
    const y = priceToY(s.strike);
    return y !== null && y >= -10 && y <= height + 10;
  });

  const lineY = (price: number) => {
    const y = priceToY(price);
    return y !== null && y >= 0 && y <= height ? y : null;
  };

  const spotY    = lineY(spot);
  const callWallY = lineY(callWall);
  const putWallY  = lineY(putWall);
  const zglY     = lineY(zgl);

  return (
    <div style={{
      width: PANEL_W,
      flexShrink: 0,
      borderLeft: '1px solid var(--border-dark)',
      backgroundColor: 'var(--bg-primary)',
      overflow: 'hidden',
      position: 'relative',
    }}>
      <svg width={PANEL_W} height={height} style={{ display: 'block' }}>
        {/* Header labels */}
        <text x={CENTER_X - HALF_BAR / 2} y={10} fill="rgba(244,63,94,0.55)" fontSize={7} textAnchor="middle">PUT</text>
        <text x={CENTER_X + HALF_BAR / 2} y={10} fill="rgba(34,197,94,0.55)"  fontSize={7} textAnchor="middle">CALL</text>

        {/* Zero axis */}
        <line x1={CENTER_X} y1={14} x2={CENTER_X} y2={height} stroke="var(--border)" strokeWidth={1} />

        {/* Bars */}
        {visible.map(s => {
          const y = priceToY(s.strike);
          if (y === null) return null;
          const yPx = y as number;

          const callW = Math.max(1, (s.callGex / maxAbs) * HALF_BAR);
          const putW  = Math.max(1, (Math.abs(s.putGex) / maxAbs) * HALF_BAR);
          const barH  = 6;

          // Highlight the spot strike
          const isAtm = Math.abs(s.strike - spot) < 2.5;

          return (
            <g key={s.strike}>
              {/* Strike label */}
              <text
                x={LABEL_W - 3} y={yPx + 3.5}
                fill={isAtm ? 'var(--text-secondary)' : 'var(--text-muted)'}
                fontSize={isAtm ? 9.5 : 8.5}
                fontWeight={isAtm ? 600 : 400}
                textAnchor="end"
                fontFamily="JetBrains Mono, monospace"
              >
                {s.strike}
              </text>

              {/* Call GEX bar — right of center */}
              {s.callGex > 0 && (
                <rect
                  x={CENTER_X + 1}
                  y={yPx - barH / 2}
                  width={callW}
                  height={barH}
                  fill={isAtm ? 'rgba(34,197,94,0.9)' : 'rgba(34,197,94,0.55)'}
                  rx={1}
                />
              )}

              {/* Put GEX bar — left of center */}
              {s.putGex < 0 && (
                <rect
                  x={CENTER_X - putW - 1}
                  y={yPx - barH / 2}
                  width={putW}
                  height={barH}
                  fill={isAtm ? 'rgba(244,63,94,0.9)' : 'rgba(244,63,94,0.55)'}
                  rx={1}
                />
              )}

              {/* Tick mark on axis */}
              <line x1={CENTER_X - 1.5} y1={yPx} x2={CENTER_X + 1.5} y2={yPx} stroke="var(--border)" strokeWidth={0.5} />
            </g>
          );
        })}

        {/* Call Wall line */}
        {callWallY !== null && (
          <g>
            <line x1={LABEL_W} y1={callWallY} x2={PANEL_W} y2={callWallY} stroke="#f43f5e" strokeWidth={1} strokeDasharray="3,2" />
            <text x={PANEL_W - 2} y={callWallY - 2} fill="#f43f5e" fontSize={7} textAnchor="end">CW {fmtPrice(callWall, 0)}</text>
          </g>
        )}

        {/* Put Wall line */}
        {putWallY !== null && (
          <g>
            <line x1={LABEL_W} y1={putWallY} x2={PANEL_W} y2={putWallY} stroke="#22c55e" strokeWidth={1} strokeDasharray="3,2" />
            <text x={PANEL_W - 2} y={putWallY + 9} fill="#22c55e" fontSize={7} textAnchor="end">PW {fmtPrice(putWall, 0)}</text>
          </g>
        )}

        {/* ZGL line */}
        {zglY !== null && (
          <g>
            <line x1={LABEL_W} y1={zglY} x2={PANEL_W} y2={zglY} stroke="#94a3b8" strokeWidth={1} strokeDasharray="2,3" />
          </g>
        )}

        {/* Spot price line */}
        {spotY !== null && (
          <g>
            <line x1={0} y1={spotY} x2={PANEL_W} y2={spotY} stroke="#e2e8f0" strokeWidth={1} strokeDasharray="4,3" opacity={0.7} />
            <text x={LABEL_W - 3} y={spotY - 2} fill="#e2e8f0" fontSize={7.5} textAnchor="end" opacity={0.8}>
              {fmtPrice(spot, 1)}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
});

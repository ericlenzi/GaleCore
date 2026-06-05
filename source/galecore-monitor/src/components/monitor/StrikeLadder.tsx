import React from 'react';
import { PositionType } from '../../types/position';

interface Props {
  type: PositionType;
  shortStrike: number;
  longStrike: number;
  shortStrike2?: number;
  longStrike2?: number;
  spot: number;
  callWall?: number;
  putWall?: number;
}

// Extra padding so wall labels don't get cut at edges
const SIDE_PAD = 0.06; // 6% each side

export function StrikeLadder({ type, shortStrike, longStrike, shortStrike2, longStrike2, spot, callWall, putWall }: Props) {
  if (!spot) return null;

  const putShort  = (type === 'PUT_CS' || type === 'IC') ? shortStrike  : null;
  const putLong   = (type === 'PUT_CS' || type === 'IC') ? longStrike   : null;
  const callShort = type === 'CALL_CS' ? shortStrike : type === 'IC' ? (shortStrike2 ?? null) : null;
  const callLong  = type === 'CALL_CS' ? longStrike  : type === 'IC' ? (longStrike2  ?? null) : null;

  const allValues = [spot, putShort, putLong, callShort, callLong, callWall, putWall]
    .filter((v): v is number => v != null);

  const rawMin = Math.min(...allValues);
  const rawMax = Math.max(...allValues);
  const rawSpread = (rawMax - rawMin) || rawMin * 0.04;
  const min = rawMin - rawSpread * SIDE_PAD;
  const max = rawMax + rawSpread * SIDE_PAD;
  const range = max - min;

  const pct = (v: number) => Math.max(0, Math.min(100, ((v - min) / range) * 100));
  const spotPct = pct(spot);

  // Zone boundaries (% from left)
  const greenL = putShort  != null ? pct(putShort)  : 0;
  const greenR = callShort != null ? pct(callShort) : 100;
  const yellowLL = putLong  != null ? pct(putLong)  : greenL;
  const yellowRR = callLong != null ? pct(callLong) : greenR;

  const BAR_H = 40;

  return (
    <div style={{ userSelect: 'none', padding: '4px 0 0' }}>

      {/* ── Label row (above bar) ─────────────────────────────────────────── */}
      <div className="relative" style={{ height: 28, marginBottom: 2 }}>

        {/* Put Wall */}
        {putWall != null && (
          <FloatLabel pct={pct(putWall)} color="#818cf8" label="PUT WALL" sub={String(putWall)} align="center" />
        )}

        {/* Long Put */}
        {putLong != null && (
          <FloatLabel pct={pct(putLong)} color="#f87171" label="Long Put" sub={String(putLong)} align="center" />
        )}

        {/* Short Put */}
        {putShort != null && (
          <FloatLabel pct={pct(putShort)} color="#fbbf24" label="Short Put" sub={String(putShort)} align="center" />
        )}

        {/* Short Call */}
        {callShort != null && (
          <FloatLabel pct={pct(callShort)} color="#fbbf24" label="Short Call" sub={String(callShort)} align="center" />
        )}

        {/* Long Call */}
        {callLong != null && (
          <FloatLabel pct={pct(callLong)} color="#f87171" label="Long Call" sub={String(callLong)} align="center" />
        )}

        {/* Call Wall */}
        {callWall != null && (
          <FloatLabel pct={pct(callWall)} color="#818cf8" label="CALL WALL" sub={String(callWall)} align="center" />
        )}
      </div>

      {/* ── Main bar ──────────────────────────────────────────────────────── */}
      <div
        className="relative"
        style={{
          height: BAR_H,
          borderRadius: 6,
          backgroundColor: 'var(--bg-primary)',
          border: '1px solid var(--border-dark)',
          overflow: 'hidden',
        }}
      >
        {/* Red zone — left of long put */}
        {putLong != null && <Zone left={0} right={100 - yellowLL} color="rgba(239,68,68,0.35)" />}
        {/* Yellow zone — long put to short put */}
        {putLong != null && putShort != null && (
          <Zone left={yellowLL} right={100 - greenL} color="rgba(251,191,36,0.28)" />
        )}
        {/* Green zone — between short strikes */}
        <Zone left={greenL} right={100 - greenR} color="rgba(34,197,94,0.22)" />
        {/* Yellow zone — short call to long call */}
        {callShort != null && callLong != null && (
          <Zone left={greenR} right={100 - yellowRR} color="rgba(251,191,36,0.28)" />
        )}
        {/* Red zone — right of long call */}
        {callLong != null && <Zone left={yellowRR} right={0} color="rgba(239,68,68,0.35)" />}

        {/* Strike tick marks */}
        {putLong   != null && <TickMark pct={pct(putLong)}   color="rgba(248,113,113,0.9)" />}
        {putShort  != null && <TickMark pct={pct(putShort)}  color="rgba(251,191,36,0.9)"  />}
        {callShort != null && <TickMark pct={pct(callShort)} color="rgba(251,191,36,0.9)"  />}
        {callLong  != null && <TickMark pct={pct(callLong)}  color="rgba(248,113,113,0.9)" />}

        {/* GEX wall markers (dashed indigo) */}
        {putWall  != null && pct(putWall)  > 0 && pct(putWall)  < 100 && <WallMark pct={pct(putWall)} />}
        {callWall != null && pct(callWall) > 0 && pct(callWall) < 100 && <WallMark pct={pct(callWall)} />}

        {/* Zone legend — faint text in each zone */}
        {putLong != null && yellowLL > 2 && (
          <ZoneLabel left={0} right={100 - yellowLL} text="MAX LOSS" color="rgba(248,113,113,0.85)" />
        )}
        {putLong != null && putShort != null && (
          <ZoneLabel left={yellowLL} right={100 - greenL} text="RISK" color="rgba(251,191,36,0.85)" />
        )}
        <ZoneLabel left={greenL} right={100 - greenR} text="PROFIT AT EXP" color="rgba(74,222,128,0.85)" />
        {callShort != null && callLong != null && (
          <ZoneLabel left={greenR} right={100 - yellowRR} text="RISK" color="rgba(251,191,36,0.85)" />
        )}
        {callLong != null && yellowRR < 98 && (
          <ZoneLabel left={yellowRR} right={0} text="MAX LOSS" color="rgba(248,113,113,0.85)" />
        )}

        {/* Spot line — prominent white with glow */}
        <div
          style={{
            position: 'absolute',
            left: `${spotPct}%`,
            top: 0,
            bottom: 0,
            width: 3,
            backgroundColor: '#ffffff',
            transform: 'translateX(-50%)',
            zIndex: 20,
            boxShadow: '0 0 8px rgba(255,255,255,0.8)',
          }}
        />
        {/* Spot triangle indicator at top */}
        <div
          style={{
            position: 'absolute',
            left: `${spotPct}%`,
            top: -1,
            transform: 'translateX(-50%)',
            width: 0,
            height: 0,
            borderLeft: '5px solid transparent',
            borderRight: '5px solid transparent',
            borderTop: '7px solid #fff',
            zIndex: 21,
          }}
        />
      </div>

      {/* ── Spot price (centered on spot line) ────────────────────────────── */}
      <div className="relative" style={{ height: 22, marginTop: 4 }}>
        <div
          style={{
            position: 'absolute',
            left: `${spotPct}%`,
            transform: 'translateX(-50%)',
            fontSize: 13,
            fontFamily: 'JetBrains Mono, monospace',
            fontWeight: 700,
            color: '#fff',
            whiteSpace: 'nowrap',
          }}
        >
          {spot.toFixed(2)}
        </div>
      </div>
    </div>
  );
}

// ── Primitives ─────────────────────────────────────────────────────────────────

function Zone({ left, right, color }: { left: number; right: number; color: string }) {
  return (
    <div style={{ position: 'absolute', left: `${left}%`, right: `${right}%`, top: 0, bottom: 0, backgroundColor: color }} />
  );
}

function TickMark({ pct, color }: { pct: number; color: string }) {
  return (
    <div style={{
      position: 'absolute', left: `${pct}%`, top: 0, bottom: 0,
      width: 2, backgroundColor: color, transform: 'translateX(-50%)', zIndex: 10,
    }} />
  );
}

function WallMark({ pct }: { pct: number }) {
  return (
    <div style={{
      position: 'absolute', left: `${pct}%`, top: 0, bottom: 0,
      width: 1, borderLeft: '2px dashed rgba(129,140,248,0.7)',
      transform: 'translateX(-50%)', zIndex: 8,
    }} />
  );
}

function ZoneLabel({ left, right, text, color }: { left: number; right: number; text: string; color: string }) {
  const width = right === 0 ? 100 - left : left === 0 ? 100 - right : right - left;
  if (width < 5) return null;
  const centerPct = left + (100 - right - left) / 2;
  return (
    <div style={{
      position: 'absolute',
      left: `${centerPct}%`,
      top: '50%',
      transform: 'translate(-50%, -50%)',
      fontSize: 10.5,
      fontWeight: 700,
      letterSpacing: '0.06em',
      color,
      whiteSpace: 'nowrap',
      pointerEvents: 'none',
      zIndex: 2,
    }}>
      {text}
    </div>
  );
}

function FloatLabel({ pct, color, label, sub, align }: {
  pct: number; color: string; label: string; sub: string; align: 'center' | 'left' | 'right';
}) {
  return (
    <div style={{
      position: 'absolute',
      left: `${pct}%`,
      bottom: 0,
      transform: 'translateX(-50%)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      whiteSpace: 'nowrap',
    }}>
      <span style={{ fontSize: 9.5, color: 'var(--text-secondary)', letterSpacing: '0.04em', textTransform: 'uppercase', fontWeight: 600 }}>
        {label}
      </span>
      <span style={{ fontSize: 12, fontFamily: 'JetBrains Mono, monospace', color, fontWeight: 700, lineHeight: 1.1 }}>
        {sub}
      </span>
    </div>
  );
}

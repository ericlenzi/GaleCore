import { PositionResponse } from '../types/api';
import { LiveSpread, AlertType, PositionType } from '../types/position';
import { TickerState } from '../types/market';
import { parseOccSymbol, buildStreamerSymbol, legMid, computeCurrentNetCredit } from './streamerSymbol';
import { calcDte } from './formatters';

/**
 * Reconstructs structured credit spreads (PUT_CS / CALL_CS / IC)
 * from the flat list of individual option legs returned by Tastytrade.
 *
 * Grouping strategy: (underlyingSymbol, expiration).
 * Within each group:
 *   2 puts  → PUT_CS
 *   2 calls → CALL_CS
 *   4 legs (2+2) → IC
 *
 * P&L: uses live socket quotes when available, falls back to closePrice from API.
 */
export function buildLiveSpreads(
  rawPositions: PositionResponse[],
  marketTickers: Record<string, Partial<TickerState>>,
  rules?: {
    takeProfitPct: number;
    stopLossPct: number;
    rollTrigPct: number;
    rollMinDte: number;
    timeExitDte: number;
  },
): LiveSpread[] {
  const thresholds = rules ?? {
    takeProfitPct: 0.5,
    stopLossPct: 2.0,
    rollTrigPct: 1.0,
    rollMinDte: 28,
    timeExitDte: 21,
  };

  // ── 1. Filter options only ──────────────────────────────────────────────
  const optLegs = rawPositions.filter(p => p.instrumentType !== 'Equity');

  // ── 2. Parse OCC symbols ────────────────────────────────────────────────
  interface LegItem {
    leg: PositionResponse;
    parsed: ReturnType<typeof parseOccSymbol> & {};
  }

  const parsedLegs: LegItem[] = [];
  for (const leg of optLegs) {
    const parsed = parseOccSymbol(leg.symbol);
    if (parsed) parsedLegs.push({ leg, parsed });
  }

  // ── 3. Group by (underlying, expiration) ────────────────────────────────
  const groups = new Map<string, LegItem[]>();
  for (const item of parsedLegs) {
    const key = `${item.parsed.underlying}|${item.parsed.expiration}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  }

  // ── 4. Build spreads ─────────────────────────────────────────────────────
  const spreads: LiveSpread[] = [];

  for (const [key, items] of Array.from(groups.entries())) {
    const puts  = items.filter(i => i.parsed.side === 'P');
    const calls = items.filter(i => i.parsed.side === 'C');

    const shortPutItem  = puts.find(i  => i.leg.quantityDirection === 'Short');
    const longPutItem   = puts.find(i  => i.leg.quantityDirection === 'Long');
    const shortCallItem = calls.find(i => i.leg.quantityDirection === 'Short');
    const longCallItem  = calls.find(i => i.leg.quantityDirection === 'Long');

    const hasPutSpread  = !!shortPutItem  && !!longPutItem;
    const hasCallSpread = !!shortCallItem && !!longCallItem;

    let type: PositionType;
    if (hasPutSpread && hasCallSpread) type = 'IC';
    else if (hasPutSpread)  type = 'PUT_CS';
    else if (hasCallSpread) type = 'CALL_CS';
    else continue; // incomplete/unrecognized structure — skip

    const underlying = items[0].parsed.underlying;
    const expiration = items[0].parsed.expiration;
    const dte        = calcDte(expiration);
    const multiplier = items[0].leg.multiplier ?? 100;

    // Contracts: all legs should agree on quantity
    const contracts = (shortPutItem ?? shortCallItem)!.leg.quantity;

    // ── Entry prices ──────────────────────────────────────────────────────
    const spEntry = shortPutItem?.leg.averageOpenPrice ?? 0;
    const lpEntry = longPutItem?.leg.averageOpenPrice  ?? 0;
    const scEntry = shortCallItem?.leg.averageOpenPrice ?? 0;
    const lcEntry = longCallItem?.leg.averageOpenPrice  ?? 0;

    const initialCredit =
      type === 'PUT_CS'  ? spEntry - lpEntry :
      type === 'CALL_CS' ? scEntry - lcEntry :
      (spEntry + scEntry) - (lpEntry + lcEntry);

    const initialPremium = initialCredit * multiplier * contracts;

    // ── DXLink symbols ────────────────────────────────────────────────────
    const legSymbols: Record<string, string> = {};

    if (type === 'PUT_CS' || type === 'IC') {
      legSymbols.shortPut = buildStreamerSymbol(underlying, expiration, 'P', shortPutItem!.parsed.strike);
      legSymbols.longPut  = buildStreamerSymbol(underlying, expiration, 'P', longPutItem!.parsed.strike);
    }
    if (type === 'CALL_CS' || type === 'IC') {
      legSymbols.shortCall = buildStreamerSymbol(underlying, expiration, 'C', shortCallItem!.parsed.strike);
      legSymbols.longCall  = buildStreamerSymbol(underlying, expiration, 'C', longCallItem!.parsed.strike);
    }

    // ── Live mids (socket) — fallback to closePrice from API ─────────────
    const midOrClose = (streamerSym: string | undefined, closePx: number | undefined): number | null => {
      if (!streamerSym) return null;
      const t = marketTickers[streamerSym];
      const live = legMid(t?.bid, t?.ask);
      if (live != null) return live;
      return closePx ?? null;
    };

    const spMid = midOrClose(legSymbols.shortPut,  shortPutItem?.leg.closePrice);
    const lpMid = midOrClose(legSymbols.longPut,   longPutItem?.leg.closePrice);
    const scMid = midOrClose(legSymbols.shortCall, shortCallItem?.leg.closePrice);
    const lcMid = midOrClose(legSymbols.longCall,  longCallItem?.leg.closePrice);

    // ── Is live (at least one live socket quote present)? ─────────────────
    const hasLiveQuote =
      (legSymbols.shortPut  ? legMid(marketTickers[legSymbols.shortPut]?.bid,  marketTickers[legSymbols.shortPut]?.ask)  != null : false) ||
      (legSymbols.shortCall ? legMid(marketTickers[legSymbols.shortCall]?.bid, marketTickers[legSymbols.shortCall]?.ask) != null : false);

    const currentNetCredit = computeCurrentNetCredit(type, spMid, lpMid, scMid, lcMid);

    const currentPnl = currentNetCredit != null
      ? (initialCredit - currentNetCredit) * multiplier * contracts
      : null;

    const pnlPct = currentPnl != null && initialPremium > 0
      ? (currentPnl / initialPremium) * 100
      : null;

    // ── Rule alert ────────────────────────────────────────────────────────
    const alert = calcSpreadAlert(pnlPct, dte, thresholds);

    spreads.push({
      id: key,
      underlyingSymbol: underlying,
      expiration,
      dte,
      type,
      contracts,
      multiplier,
      openDate: (shortPutItem ?? shortCallItem)!.leg.createdAt,

      shortPutStrike:  shortPutItem?.parsed.strike,
      longPutStrike:   longPutItem?.parsed.strike,
      shortCallStrike: shortCallItem?.parsed.strike,
      longCallStrike:  longCallItem?.parsed.strike,

      shortPutEntry: spEntry  || undefined,
      longPutEntry:  lpEntry  || undefined,
      shortCallEntry: scEntry || undefined,
      longCallEntry:  lcEntry || undefined,

      initialCredit,
      initialPremium,

      shortPutClose:  shortPutItem?.leg.closePrice,
      longPutClose:   longPutItem?.leg.closePrice,
      shortCallClose: shortCallItem?.leg.closePrice,
      longCallClose:  longCallItem?.leg.closePrice,

      currentNetCredit,
      currentPnl,
      pnlPct,
      hasLiveQuote,
      legSymbols,
      legs: items.map(i => i.leg),
      alert,
    });
  }

  return spreads.sort(byAlertPriority);
}

// ── Alert logic (rules-driven) ─────────────────────────────────────────────

function calcSpreadAlert(
  pnlPct: number | null,
  dte: number,
  t: { takeProfitPct: number; stopLossPct: number; rollTrigPct: number; rollMinDte: number; timeExitDte: number },
): AlertType {
  if (pnlPct != null && pnlPct >= t.takeProfitPct * 100)              return 'CERRAR';
  if (pnlPct != null && pnlPct <= -(t.stopLossPct * 100))             return 'STOP_LOSS';
  if (dte <= t.timeExitDte)                                            return 'TIME_EXIT';
  if (pnlPct != null && pnlPct <= -(t.rollTrigPct * 100) && dte >= t.rollMinDte) return 'EVALUAR_ROLL';
  return null;
}

const ALERT_ORDER: Record<NonNullable<AlertType>, number> = {
  STOP_LOSS: 0, DELTA_BREACH: 1, TIME_EXIT: 2,
  EVALUAR_ROLL: 3, CERRAR: 4, MACRO_PROXIMO: 5,
};

function byAlertPriority(a: LiveSpread, b: LiveSpread): number {
  const oa = a.alert ? (ALERT_ORDER[a.alert] ?? 99) : 99;
  const ob = b.alert ? (ALERT_ORDER[b.alert] ?? 99) : 99;
  return oa - ob;
}

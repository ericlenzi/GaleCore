import React, { useState, useEffect } from 'react';
import { SuggestedPositions } from './SuggestedPositions';
import { PositionRow } from './PositionRow';
import { NewPositionForm } from './NewPositionForm';
import { ManualPosition, EnrichedPosition, AlertType, SuggestedSetup } from '../../types/position';
import { useRulesStore } from '../../store/useRulesStore';
import { calcDte } from '../../utils/formatters';

const STORAGE_KEY = 'galecore:positions';

function loadPositions(): ManualPosition[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]'); } catch { return []; }
}
function savePositions(ps: ManualPosition[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ps));
}

function calcAlert(p: ManualPosition, pnlPct: number | null, dte: number): AlertType {
  if (pnlPct != null && pnlPct >= 50)              return 'CERRAR';
  if (pnlPct != null && pnlPct <= -200)            return 'STOP_LOSS';
  if (dte <= 21)                                    return 'TIME_EXIT';
  if (pnlPct != null && pnlPct <= -100 && dte >= 14) return 'EVALUAR_ROLL';
  return null;
}

function enrich(p: ManualPosition): EnrichedPosition {
  const dte     = calcDte(p.expiration);
  const pnlPct  = null;
  return { ...p, dte, currentPnl: null, pnlPct, alert: calcAlert(p, pnlPct, dte) };
}

export function PositionMonitor() {
  const { tickers: symbols, rules } = useRulesStore();
  const maxPositions = rules?.risk_limits?.max_concurrent_positions ?? 3;

  const [positions, setPositions] = useState<ManualPosition[]>(loadPositions);
  const [selectedSymbol, setSelectedSymbol] = useState<string>('');
  const [prefill, setPrefill] = useState<(SuggestedSetup & { symbol: string }) | null>(null);
  const [showForm, setShowForm] = useState(false);

  // Default to first ticker once rules load
  useEffect(() => {
    if (!selectedSymbol && symbols.length > 0) setSelectedSymbol(symbols[0]);
  }, [symbols, selectedSymbol]);

  useEffect(() => { savePositions(positions); }, [positions]);

  const handleAdd = (p: ManualPosition) => {
    setPositions((prev) => [...prev, p]);
    setShowForm(false);
    setPrefill(null);
  };

  const handleRegister = (setup: SuggestedSetup) => {
    setPrefill({ ...setup, symbol: selectedSymbol });
    setShowForm(true);
    // Scroll form into view
    setTimeout(() => {
      document.getElementById('position-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  };

  const handleCancelForm = () => {
    setShowForm(false);
    setPrefill(null);
  };

  const enriched = positions.map(enrich);

  return (
    <div>
      {/* ── Ticker selector ─────────────────────────────────────────────────── */}
      {symbols.length > 0 && (
        <div className="flex items-center gap-1.5 px-3 pt-3">
          {symbols.map((sym) => (
            <button
              key={sym}
              onClick={() => setSelectedSymbol(sym)}
              className="px-3 py-1 rounded text-xs font-mono font-semibold"
              style={{
                backgroundColor: selectedSymbol === sym ? 'var(--blue-gc)' : 'var(--bg-tertiary)',
                color:           selectedSymbol === sym ? '#fff'           : 'var(--text-muted)',
                border:          '1px solid var(--border-dark)',
                cursor:          'pointer',
              }}
            >
              {sym}
            </button>
          ))}
        </div>
      )}

      {/* ── Suggested positions ─────────────────────────────────────────────── */}
      {selectedSymbol && rules && (
        <SuggestedPositions
          symbol={selectedSymbol}
          rules={rules}
          onRegister={handleRegister}
        />
      )}

      <div style={{ borderTop: '1px solid var(--border-dark)', margin: '0 12px' }} />

      {/* ── Mis posiciones abiertas ─────────────────────────────────────────── */}
      <div className="p-3">
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
            Mis Posiciones Abiertas
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
              {positions.length}/{maxPositions}
            </span>
            <button
              onClick={() => { setPrefill(null); setShowForm((v) => !v); }}
              className="px-3 py-1 rounded text-xs font-semibold"
              style={{
                backgroundColor: showForm && !prefill ? 'var(--bg-tertiary)' : 'var(--bg-tertiary)',
                color:           'var(--text-secondary)',
                border:          '1px solid var(--border-dark)',
                cursor:          'pointer',
              }}
            >
              + Nueva
            </button>
          </div>
        </div>

        {/* Registration form */}
        {showForm && (
          <div id="position-form" className="mb-3">
            <NewPositionForm
              onAdd={handleAdd}
              onCancel={handleCancelForm}
              prefill={prefill ?? undefined}
            />
          </div>
        )}

        {/* Positions table */}
        {positions.length === 0 ? (
          <div className="text-xs py-6 text-center" style={{ color: 'var(--text-muted)' }}>
            Sin posiciones registradas
          </div>
        ) : (
          <div className="overflow-x-auto rounded" style={{ border: '1px solid var(--border-dark)' }}>
            <table className="w-full" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr
                  className="text-xs uppercase tracking-wider"
                  style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-dark)' }}
                >
                  {['Ticker', 'Tipo', 'Strikes', 'Exp / DTE', 'Crédito', 'P&L', 'P&L %', 'Ctos.', 'Alerta'].map((h) => (
                    <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {enriched.map((p) => (
                  <PositionRow key={p.id} position={p} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

import React from 'react';
import { RefreshCw } from 'lucide-react';
import { useAccountStore } from '../../store/useAccountStore';
import { fetchBalances, fetchPositions } from '../../api/account';
import { fmtCurrency, fmtTime, isStale } from '../../utils/formatters';

export function AccountSummary() {
  const {
    balances,
    positions,
    loadingBalances,
    errorBalances,
    lastUpdate,
    setBalances,
    setPositions,
    setLoadingBalances,
    setLoadingPositions,
    setErrorBalances,
  } = useAccountStore();

  const stale = isStale(lastUpdate);

  const handleRefresh = () => {
    setLoadingBalances(true);
    fetchBalances()
      .then(setBalances)
      .catch((e) => setErrorBalances(e.message))
      .finally(() => setLoadingBalances(false));

    setLoadingPositions(true);
    fetchPositions()
      .then(setPositions)
      .catch(console.error)
      .finally(() => setLoadingPositions(false));
  };

  return (
    <div
      className="rounded p-3"
      style={{
        backgroundColor: 'var(--bg-secondary)',
        border: '1px solid var(--border-dark)',
        minWidth: 200,
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
          Cuenta
        </span>
        <button
          onClick={handleRefresh}
          disabled={loadingBalances}
          className="flex items-center gap-1 px-2 py-0.5 rounded text-xs"
          style={{
            color: 'var(--text-muted)',
            background: 'none',
            border: '1px solid var(--border-dark)',
            cursor: 'pointer',
          }}
          title="Refrescar"
        >
          <RefreshCw size={10} className={loadingBalances ? 'animate-spin' : ''} />
        </button>
      </div>

      {errorBalances ? (
        <div className="text-xs" style={{ color: 'var(--red-gc)' }}>
          {errorBalances}
        </div>
      ) : loadingBalances ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <div
              key={i}
              className="h-3 rounded animate-pulse"
              style={{ backgroundColor: 'var(--bg-tertiary)' }}
            />
          ))}
        </div>
      ) : balances ? (
        <div className="space-y-1.5">
          <Row label="Net Liq" value={fmtCurrency(balances.netLiquidatingValue)} highlight />
          <Row label="Buying Power" value={fmtCurrency(balances.buyingPower)} />
          <Row label="Cash" value={fmtCurrency(balances.cash)} />
          <div style={{ borderTop: '1px solid var(--border-dark)', marginTop: 6, paddingTop: 6 }}>
            <Row label="Posiciones" value={`${positions.length}`} />
          </div>
        </div>
      ) : (
        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Sin datos
        </div>
      )}

      {/* Timestamp */}
      {lastUpdate && (
        <div
          className="text-xs mt-2"
          style={{ color: stale ? 'var(--yellow-gc)' : 'var(--text-muted)' }}
        >
          {fmtTime(lastUpdate)}
        </div>
      )}
    </div>
  );
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
        {label}
      </span>
      <span
        className="font-mono text-sm"
        style={{ color: highlight ? 'var(--text-primary)' : 'var(--text-primary)', fontWeight: highlight ? 600 : 400 }}
      >
        {value}
      </span>
    </div>
  );
}

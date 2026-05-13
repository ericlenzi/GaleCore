import React from 'react';
import { SuggestedSetup } from '../../types/position';

interface Props {
  setup: SuggestedSetup;
  symbol: string;
  canTrade: boolean;
  onRegister: (setup: SuggestedSetup) => void;
}

const TYPE_LABEL: Record<SuggestedSetup['type'], string> = {
  PUT_CS:  'PUT Credit Spread',
  CALL_CS: 'CALL Credit Spread',
  IC:      'Iron Condor',
};

const TYPE_COLOR: Record<SuggestedSetup['type'], string> = {
  PUT_CS:  'var(--green)',
  CALL_CS: 'var(--red-gc)',
  IC:      'var(--blue-gc)',
};

function Check({ ok }: { ok: boolean | null }) {
  if (ok === null) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
  return <span style={{ color: ok ? 'var(--green)' : 'var(--red-gc)' }}>{ok ? '✓' : '✗'}</span>;
}

function MetricRow({
  label, value, check, suffix,
}: {
  label: string;
  value: string;
  check?: boolean | null;
  suffix?: string;
}) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <span className="font-mono text-xs flex items-center gap-1.5" style={{ color: 'var(--text-primary)' }}>
        {value}
        {suffix && <span style={{ color: 'var(--text-muted)' }}>{suffix}</span>}
        {check !== undefined && <Check ok={check} />}
      </span>
    </div>
  );
}

export function SuggestedCard({ setup, symbol, canTrade, onRegister }: Props) {
  const oiOk    = setup.shortLegOI    != null ? setup.shortLegOI >= 1500                      : null;
  const deltaOk = setup.shortLegDelta != null ? Math.abs(setup.shortLegDelta) <= setup.maxDeltaAbs : null;
  const popOk   = setup.pop           != null ? setup.pop >= 75                                 : null;

  const strikesDisplay = setup.type === 'IC'
    ? `${setup.shortStrike}/${setup.longStrike} · ${setup.secondShortStrike}/${setup.secondLongStrike}`
    : `${setup.shortStrike} / ${setup.longStrike}`;

  const strikesLabel = setup.type === 'PUT_CS'  ? 'Short Put / Long Put'
                     : setup.type === 'CALL_CS' ? 'Short Call / Long Call'
                     : 'Put S/L · Call S/L';

  return (
    <div
      className="rounded p-3 flex flex-col gap-2"
      style={{
        border:          `1px solid ${canTrade ? 'var(--border)' : 'var(--border-dark)'}`,
        backgroundColor: 'var(--bg-secondary)',
        opacity:         canTrade ? 1 : 0.55,
        minWidth:        220,
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold tracking-wide" style={{ color: TYPE_COLOR[setup.type] }}>
          {TYPE_LABEL[setup.type]}
        </span>
        <span className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
          {symbol} · {setup.dte}d
        </span>
      </div>

      {/* Strikes */}
      <div style={{ borderTop: '1px solid var(--border-dark)', paddingTop: 6 }}>
        <div className="text-xs mb-0.5" style={{ color: 'var(--text-muted)' }}>{strikesLabel}</div>
        <div className="font-mono text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          {strikesDisplay}
        </div>
        <div className="flex gap-3 mt-1">
          <span className="text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>
            Ancho: <span style={{ color: 'var(--text-primary)' }}>${setup.width}</span>
          </span>
          <span className="text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>
            Exp: <span style={{ color: 'var(--text-primary)' }}>{setup.expiration || '—'}</span>
          </span>
        </div>
      </div>

      {/* Metrics */}
      <div style={{ borderTop: '1px solid var(--border-dark)', paddingTop: 6 }}>
        <MetricRow
          label="OI Short"
          value={setup.shortLegOI != null ? setup.shortLegOI.toLocaleString() : '—'}
          suffix="≥1.500"
          check={oiOk}
        />
        <MetricRow
          label="Δ Short"
          value={setup.shortLegDelta != null ? setup.shortLegDelta.toFixed(3) : '—'}
          suffix={`≤${setup.maxDeltaAbs}`}
          check={deltaOk}
        />
        <MetricRow
          label="POP proxy"
          value={setup.pop != null ? `${setup.pop.toFixed(0)}%` : '—'}
          suffix="≥75%"
          check={popOk}
        />
        <MetricRow
          label="Crédito"
          value="Sin cotización"
        />
        <MetricRow
          label="Pérd. máx / cto."
          value={`$${(setup.width * 100).toLocaleString()}`}
        />
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between" style={{ borderTop: '1px solid var(--border-dark)', paddingTop: 6 }}>
        {!canTrade && (
          <span className="text-xs" style={{ color: 'var(--yellow-gc)' }}>Sin señal activa</span>
        )}
        <button
          onClick={() => onRegister(setup)}
          className="ml-auto text-xs px-3 py-1 rounded font-semibold"
          style={{
            backgroundColor: 'var(--bg-tertiary)',
            color:           'var(--text-secondary)',
            border:          '1px solid var(--border)',
            cursor:          'pointer',
          }}
        >
          Registrar →
        </button>
      </div>
    </div>
  );
}

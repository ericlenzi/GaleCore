import React from 'react';
import { WifiOff } from 'lucide-react';
import { useRpfStore } from '../store/useRpfStore';
import { useRulesStore } from '../store/useRulesStore';
import { RpfStateBadge, rpfStateHint } from '../components/rpf/RpfStateBadge';
import { RpfSuggestionCard } from '../components/rpf/RpfSuggestionCard';
import { RpfStateUpdate } from '../types/rpf';
import { tint } from '../utils/formatters';

interface Props {
  acceptSuggestion: (id: string) => void;
  dismissSuggestion: (id: string) => void;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase',
      color: 'var(--text-muted)', fontFamily: 'Inter, sans-serif',
      padding: '2px 0 8px', borderBottom: '1px solid var(--border-dark)', marginBottom: 12,
    }}>
      {children}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div style={{ padding: '8px 10px', backgroundColor: 'var(--bg-tertiary)', borderRadius: 6, minWidth: 0 }}>
      <div style={{ fontSize: 8.5, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', fontFamily: 'Inter, sans-serif' }}>{label}</div>
      <div className="tabular-nums" style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'JetBrains Mono, monospace', lineHeight: 1.15 }}>{value}</div>
      {hint && <div style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'Inter, sans-serif' }}>{hint}</div>}
    </div>
  );
}

// Semáforo de los checks de Tier A (gate → pass).
function TierABar({ tierA }: { tierA?: Record<string, boolean> }) {
  const entries = Object.entries(tierA ?? {});
  if (!entries.length) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
      {entries.map(([k, ok]) => {
        const c = ok ? 'var(--green)' : 'var(--red-gc)';
        return (
          <span key={k} style={{ fontSize: 9.5, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace', padding: '2px 8px', borderRadius: 4,
            color: c, backgroundColor: tint(c, 12), border: `1px solid ${tint(c, 30)}` }}>
            {k} {ok ? '✓' : '✗'}
          </span>
        );
      })}
    </div>
  );
}

function SymbolPanel({ symbol, st, suggestion, onAccept, onDismiss }: {
  symbol: string;
  st: RpfStateUpdate | undefined;
  suggestion: ReturnType<typeof useRpfStore.getState>['suggestions'][string];
  onAccept: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  const state = st?.state ?? 'DORMANT';
  const fmt = (n: number | null | undefined, d = 2) => (n == null ? '—' : n.toFixed(d));
  return (
    <div style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-dark)', borderRadius: 8, padding: '14px 16px', marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'JetBrains Mono, monospace' }}>{symbol}</span>
        <RpfStateBadge state={state} />
        <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'Inter, sans-serif' }}>{rpfStateHint(state)}</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8 }}>
        <Stat label="Edge" value={fmt(st?.edge)} hint={st?.bar != null ? `barra ${fmt(st.bar)}` : undefined} />
        <Stat label="Régimen" value={st?.regime ?? '—'} />
        <Stat label="Cupo" value={st?.capacityAvailable == null ? '—' : st.capacityAvailable ? 'sí' : 'no'} />
        <Stat label="Cooldown" value={st?.cooldownRemainingSec != null ? `${st.cooldownRemainingSec}s` : '—'} />
      </div>

      <TierABar tierA={st?.tierA} />

      {suggestion && (
        <div style={{ marginTop: 14 }}>
          <RpfSuggestionCard suggestion={suggestion} onAccept={onAccept} onDismiss={onDismiss} />
        </div>
      )}
    </div>
  );
}

export function Rpf({ acceptSuggestion, dismissSuggestion }: Props) {
  const { states, suggestions, loopOnline } = useRpfStore();
  const rulesTickers = useRulesStore((s) => s.tickers);

  // Símbolos a mostrar: los que emitió el loop; si aún nada, el universo de reglas (SPY).
  const stateSymbols = Object.keys(states);
  const symbols = stateSymbols.length ? stateSymbols : (rulesTickers.length ? rulesTickers : ['SPY']);

  return (
    <div style={{ padding: '14px 18px 40px', height: '100%', overflowY: 'auto', fontFamily: 'Inter, sans-serif' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>GaleCore RPF</span>
        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4, letterSpacing: '0.06em',
          color: '#a78bfa', backgroundColor: tint('#a78bfa', 13), border: `1px solid ${tint('#a78bfa', 30)}`, fontFamily: 'JetBrains Mono, monospace' }}>
          Disparo por prima real · paper
        </span>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace',
          color: loopOnline ? 'var(--green)' : 'var(--text-muted)' }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: loopOnline ? 'var(--green)' : 'var(--text-muted)' }} />
          {loopOnline ? 'LOOP ONLINE' : 'LOOP OFFLINE'}
        </span>
      </div>

      {/* Banner offline: el loop de 6a arranca inerte y no emite hasta el flip a enabled:true en paper */}
      {!loopOnline && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 14px', marginBottom: 16, borderRadius: 8,
          backgroundColor: 'var(--bg-secondary)', border: '1px dashed var(--border)' }}>
          <WifiOff size={16} style={{ color: 'var(--text-muted)', flexShrink: 0, marginTop: 1 }} />
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 3 }}>Loop offline (inerte)</div>
            <div style={{ fontSize: 10.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>
              El loop de orquestación arranca inerte y no emite hasta activar <code style={{ fontFamily: 'JetBrains Mono, monospace' }}>state_machine.enabled</code> en
              paper. El tablero mostrará estados y sugerencias en cuanto el backend empiece a empujar por el grupo <code style={{ fontFamily: 'JetBrains Mono, monospace' }}>rpf</code>.
              No se corre la cascada localmente: una sola fuente de verdad.
            </div>
          </div>
        </div>
      )}

      <SectionTitle>Estado por símbolo</SectionTitle>
      {symbols.map((sym) => (
        <SymbolPanel
          key={sym}
          symbol={sym}
          st={states[sym]}
          suggestion={suggestions[sym] ?? null}
          onAccept={acceptSuggestion}
          onDismiss={dismissSuggestion}
        />
      ))}
    </div>
  );
}

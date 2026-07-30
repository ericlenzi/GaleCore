import React from 'react';
import { WifiOff, Check, X, Circle, AlertTriangle } from 'lucide-react';
import { useRpfStore } from '../store/useRpfStore';
import { useRulesStore } from '../store/useRulesStore';
import { RpfStateBadge, rpfStateHint } from '../components/rpf/RpfStateBadge';
import { RpfSuggestionCard } from '../components/rpf/RpfSuggestionCard';
import { RpfStateUpdate, RpfCheck, RpfCandidate, RpfStateName } from '../types/rpf';
import { tint } from '../utils/formatters';

interface Props {
  acceptSuggestion: (id: string) => void;
  dismissSuggestion: (id: string) => void;
}

// Estados en los que el entorno ya armó (el eje DISPARA está activo).
const ARMED_STATES: RpfStateName[] = ['ARMED', 'WAITING_CAPACITY', 'COOLDOWN', 'TRIGGERED', 'IN_POSITION'];

// Explicación en lenguaje llano de cada estado (encima del detalle técnico).
const STATE_EXPLAIN: Record<RpfStateName, string> = {
  DORMANT: 'el entorno no habilita: sin peligro, pero todavía sin setup para operar',
  VETOED: 'peligro de cola activo: el veto manda, no se opera aunque todo lo demás dé',
  ARMED: 'entorno habilitado: vigilando que el spread pague más que el riesgo real (edge)',
  WAITING_CAPACITY: 'hay un trade que cruza la barra, pero el libro está lleno (2 posiciones)',
  COOLDOWN: 'enfriando tras el último disparo: se suprime el re-disparo un rato',
  TRIGGERED: 'disparó: hay una sugerencia lista para aceptar o descartar',
  IN_POSITION: 'libro lleno: sólo queda gestionar las posiciones abiertas',
};

const STATUS_COLOR: Record<string, string> = {
  pass: 'var(--green)', fail: 'var(--red-gc)', no_data: 'var(--yellow-gc)',
  skipped: 'var(--text-muted)', pending: 'var(--text-muted)',
};

function StatusIcon({ status }: { status: string }) {
  const c = STATUS_COLOR[status] ?? 'var(--text-muted)';
  if (status === 'pass') return <Check size={15} style={{ color: c, flexShrink: 0 }} />;
  if (status === 'fail') return <X size={15} style={{ color: c, flexShrink: 0 }} />;
  return <Circle size={9} style={{ color: c, flexShrink: 0 }} />;
}

const fmt = (n: number | null | undefined, d = 2) =>
  n == null ? '—' : Number.isInteger(n) ? `${n}` : n.toFixed(d);

// Fila de check: icono + etiqueta + valor/umbral.
function CheckRow({ c }: { c: RpfCheck }) {
  const color = STATUS_COLOR[c.status] ?? 'var(--text-muted)';
  const valTxt = c.value != null
    ? `${fmt(c.value)}${c.threshold != null ? ` / ${fmt(c.threshold)}` : ''}`
    : '';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--border-dark)' }}>
      <StatusIcon status={c.status} />
      <span style={{ flex: 1, fontSize: 12, color: 'var(--text-primary)', fontFamily: 'Inter, sans-serif' }}>{c.label}</span>
      <span className="tabular-nums" style={{ fontSize: 11, color: c.status === 'fail' ? color : 'var(--text-secondary)', fontFamily: 'JetBrains Mono, monospace' }}>{valTxt}</span>
    </div>
  );
}

function PanelHeader({ title, right, rightColor }: { title: string; right: string; rightColor: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-secondary)', fontFamily: 'Inter, sans-serif' }}>{title}</span>
      <span style={{ fontSize: 11, fontWeight: 700, color: rightColor, fontFamily: 'JetBrains Mono, monospace' }}>{right}</span>
    </div>
  );
}

// Eje ARMA: macro checks + gates de señal (VRP, cola). Si la cascada cortó en macro, los gates
// no corrieron → se muestra una nota en vez de filas vacías.
function ArmaPanel({ st, armed, vetoed }: { st: RpfStateUpdate; armed: boolean; vetoed: boolean }) {
  const macro = st.macroChecks ?? [];
  const gates = st.gates ?? [];
  const right = vetoed ? 'VETADO' : armed ? 'ARMADO' : 'NO ARMADO';
  const rightColor = vetoed ? 'var(--red-gc)' : armed ? 'var(--green)' : 'var(--text-muted)';
  return (
    <div style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-dark)', borderRadius: 10, padding: '14px 16px' }}>
      <PanelHeader title="Arma · entorno seguro" right={right} rightColor={rightColor} />
      {macro.length > 0
        ? macro.map((c) => <CheckRow key={c.id} c={c} />)
        : <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '6px 0' }}>Macro no evaluado.</div>}
      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', margin: '10px 0 2px' }}>Prima y cola</div>
      {gates.length > 0
        ? gates.map((c) => <CheckRow key={c.id} c={c} />)
        : <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '6px 0' }}>No evaluado — la cascada cortó en macro.</div>}
    </div>
  );
}

// Eje DISPARA: el PCS candidato + edge vs barra + cupo. Atenuado si el entorno no armó.
function DisparaPanel({ st, cand, active }: { st: RpfStateUpdate; cand: RpfCandidate | null; active: boolean }) {
  const box = (label: string, value: React.ReactNode, hint?: string) => (
    <div style={{ flex: 1, textAlign: 'center', padding: '8px 6px', backgroundColor: 'var(--bg-tertiary)', borderRadius: 6 }}>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'Inter, sans-serif' }}>{label}</div>
      <div className="tabular-nums" style={{ fontSize: 15, fontWeight: 700, marginTop: 2, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-primary)' }}>{value}</div>
      {hint && <div style={{ fontSize: 9.5, color: 'var(--text-muted)', fontFamily: 'Inter, sans-serif' }}>{hint}</div>}
    </div>
  );
  const edgeOk = cand?.edge != null && cand?.bar != null && cand.edge >= cand.bar;
  return (
    <div style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-dark)', borderRadius: 10, padding: '14px 16px', opacity: active ? 1 : 0.62 }}>
      <PanelHeader title="Dispara · el spread" right={active ? 'ACTIVO' : 'EN ESPERA'} rightColor={active ? 'var(--green)' : 'var(--text-muted)'} />
      {!active && (
        <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginBottom: 10, fontFamily: 'Inter, sans-serif' }}>
          no se evalúa hasta que el entorno arme — se muestra el candidato que armaría {cand && !cand.fromCascade ? '(motor)' : ''}
        </div>
      )}
      {cand && cand.shortPutStrike != null ? (
        <>
          <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
            {box('Vende put', cand.shortPutStrike, cand.shortPutDelta != null ? `Δ ${Math.abs(cand.shortPutDelta).toFixed(2)}` : undefined)}
            {box('Compra put', cand.longPutStrike ?? '—', cand.width != null ? `ancho $${fmt(cand.width)}` : undefined)}
            {box('DTE', cand.dte || '—', cand.credit != null ? `crédito $${fmt(cand.credit)}` : undefined)}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 6,
            backgroundColor: tint(edgeOk ? 'var(--green)' : 'var(--text-muted)', 12), border: `1px solid ${tint(edgeOk ? 'var(--green)' : 'var(--text-muted)', 30)}` }}>
            <span style={{ flex: 1, fontSize: 12, color: 'var(--text-secondary)', fontFamily: 'Inter, sans-serif' }}>Te pagan más que el riesgo real (edge)</span>
            <span className="tabular-nums" style={{ fontSize: 13, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace', color: edgeOk ? 'var(--green)' : 'var(--text-secondary)' }}>
              {cand.edge != null ? `${fmt(cand.edge)} ${edgeOk ? '≥' : '<'} ${fmt(cand.bar)}` : 'no evaluado'}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 8, fontSize: 12 }}>
            <span style={{ flex: 1, color: 'var(--text-secondary)', fontFamily: 'Inter, sans-serif' }}>Cupo en la cartera (máx {st.maxPositions || 2})</span>
            <span className="tabular-nums" style={{ color: 'var(--text-secondary)', fontFamily: 'JetBrains Mono, monospace' }}>
              {st.openPositions ?? 0} / {st.maxPositions || 2}{st.heatPct != null ? ` · heat ${(st.heatPct * 100).toFixed(1)}%` : ''}
            </span>
          </div>
          {cand.creditRatio != null && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 6, fontSize: 12 }}>
              <span style={{ flex: 1, color: 'var(--text-secondary)', fontFamily: 'Inter, sans-serif' }}>Regla 1/3 · POP</span>
              <span className="tabular-nums" style={{ color: 'var(--text-secondary)', fontFamily: 'JetBrains Mono, monospace' }}>
                {(cand.creditRatio * 100).toFixed(0)}%{cand.pop != null ? ` · ${cand.pop.toFixed(0)}%` : ''}
              </span>
            </div>
          )}
        </>
      ) : (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '10px 0' }}>El motor no propuso una posición candidata.</div>
      )}
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
  const state: RpfStateName = st?.state ?? 'DORMANT';
  const armed = ARMED_STATES.includes(state);
  const vetoed = state === 'VETOED';

  return (
    <div style={{ marginBottom: 18 }}>
      {/* Cabecera del símbolo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'JetBrains Mono, monospace' }}>{symbol}</span>
        <RpfStateBadge state={state} />
        <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'Inter, sans-serif' }}>{STATE_EXPLAIN[state] ?? rpfStateHint(state)}</span>
        {st && st.cascadeOk === false && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, marginLeft: 'auto', fontSize: 10, color: 'var(--yellow-gc)', fontFamily: 'JetBrains Mono, monospace' }}>
            <AlertTriangle size={11} /> sin datos de cascada
          </span>
        )}
      </div>

      {/* Dos ejes */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12 }}>
        <ArmaPanel st={st ?? { symbol, state, timestamp: '' }} armed={armed} vetoed={vetoed} />
        <DisparaPanel st={st ?? { symbol, state, timestamp: '' }} cand={st?.candidate ?? null} active={armed && !vetoed} />
      </div>

      {/* Sugerencia (cuando dispara) */}
      {suggestion && (
        <div style={{ marginTop: 12 }}>
          <RpfSuggestionCard suggestion={suggestion} onAccept={onAccept} onDismiss={onDismiss} />
        </div>
      )}

      {/* Nota de flujo */}
      <div style={{ marginTop: 10, padding: '8px 12px', backgroundColor: 'var(--bg-tertiary)', borderRadius: 6, fontSize: 11, color: 'var(--text-muted)', fontFamily: 'Inter, sans-serif' }}>
        Cuando <b style={{ color: 'var(--text-secondary)' }}>arma</b> (todos los gates en verde) y el <b style={{ color: 'var(--text-secondary)' }}>edge cruza la barra</b> con cupo, el estado pasa a <b style={{ color: 'var(--green)' }}>disparado</b> y aparece la sugerencia con aceptar / descartar.
      </div>
    </div>
  );
}

export function Rpf({ acceptSuggestion, dismissSuggestion }: Props) {
  const { states, suggestions, loopOnline } = useRpfStore();
  const rulesTickers = useRulesStore((s) => s.tickers);

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

      {!loopOnline && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 14px', marginBottom: 16, borderRadius: 8,
          backgroundColor: 'var(--bg-secondary)', border: '1px dashed var(--border)' }}>
          <WifiOff size={16} style={{ color: 'var(--text-muted)', flexShrink: 0, marginTop: 1 }} />
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 3 }}>Loop offline</div>
            <div style={{ fontSize: 10.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>
              El backend no está empujando por el grupo <code style={{ fontFamily: 'JetBrains Mono, monospace' }}>rpf</code>. El tablero se llena en cuanto el loop emite.
              No se corre la cascada localmente: una sola fuente de verdad.
            </div>
          </div>
        </div>
      )}

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

import React from 'react';
import {
  WifiOff, Check, X, Circle, AlertTriangle, Clock, ChevronDown, RefreshCw,
  Moon, Target, Zap, Ban, Hourglass, Layers, Briefcase, LucideIcon,
} from 'lucide-react';
import { useRpfStore } from '../store/useRpfStore';
import { RpfStateBadge } from '../components/rpf/RpfStateBadge';
import { RpfSuggestionCard } from '../components/rpf/RpfSuggestionCard';
import { RpfStateUpdate, RpfCheck, RpfCandidate, RpfStateName } from '../types/rpf';
import { tint } from '../utils/formatters';

interface Props {
  acceptSuggestion: (id: string) => void;
  dismissSuggestion: (id: string) => void;
}

// Estados en los que el entorno ya armó (el eje DISPARA está activo).
const ARMED_STATES: RpfStateName[] = ['ARMED', 'WAITING_CAPACITY', 'COOLDOWN', 'TRIGGERED', 'IN_POSITION'];

// Máquina de estados: icono + etiqueta en español + color, para el bloque de resolución.
const STATE_META: Record<RpfStateName, { color: string; es: string; Icon: LucideIcon }> = {
  DORMANT:          { color: 'var(--text-muted)', es: 'Dormido',        Icon: Moon },
  ARMED:            { color: '#a78bfa',           es: 'Armado',         Icon: Target },
  TRIGGERED:        { color: 'var(--green)',      es: 'Disparado',      Icon: Zap },
  COOLDOWN:         { color: '#a78bfa',           es: 'Enfriamiento',   Icon: Hourglass },
  IN_POSITION:      { color: 'var(--blue-gc)',    es: 'En posición',    Icon: Briefcase },
  WAITING_CAPACITY: { color: 'var(--yellow-gc)',  es: 'Esperando cupo', Icon: Layers },
  VETOED:           { color: 'var(--red-gc)',     es: 'Vetado',         Icon: Ban },
};

// Explicación en lenguaje llano de cada estado (la "salida" de la orquestación).
const STATE_EXPLAIN: Record<RpfStateName, string> = {
  DORMANT: 'El entorno todavía no está alineado (macro no pasa) pero no hay peligro. La cascada corta arriba y los gates de prima ni se evalúan. El loop sigue vivo y mira cada tick; el candidato se muestra solo como referencia.',
  VETOED: 'Peligro de cola activo: el veto de seguridad manda sobre todo lo demás (safety-first). Aunque hubiera edge y cupo, no se ofrece ningún trade. Es el único estado que bloquea de forma dura.',
  ARMED: 'Entorno seguro y armado: macro, VRP y cola pasan. Falta que el edge empírico llegue a la barra del régimen. Se espera con el candidato listo; no se dispara nada hasta que la prima pague.',
  WAITING_CAPACITY: 'La prima paga (el edge cruza la barra) pero la cartera está llena. El disparo queda en espera: en cuanto se libere un cupo puede emitir la sugerencia.',
  COOLDOWN: 'Se disparó hace poco y el loop está enfriando para no re-disparar la misma señal. Al terminar el timer vuelve a evaluar normalmente.',
  TRIGGERED: 'Todo alineado: entorno seguro, edge por encima de la barra, hay cupo y no hay enfriamiento. El sistema emite la sugerencia accionable. Nunca ejecuta: propone, el operador decide.',
  IN_POSITION: 'La cartera está llena y no hay señal viva (el edge no cruza la barra). No se arma nada nuevo: el sistema sólo gestiona lo que ya está abierto.',
};

const STATUS_COLOR: Record<string, string> = {
  pass: 'var(--green)', fail: 'var(--red-gc)', no_data: 'var(--yellow-gc)', wait: 'var(--yellow-gc)',
  skipped: 'var(--text-muted)', pending: 'var(--text-muted)', na: 'var(--text-muted)',
};

const panelStyle: React.CSSProperties = {
  backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-dark)', borderRadius: 10, padding: '14px 16px',
};

const fmt = (n: number | null | undefined, d = 2) =>
  n == null ? '—' : Number.isInteger(n) ? `${n}` : n.toFixed(d);

const tickTime = (iso?: string) => {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d.toLocaleTimeString('es-AR', { hour12: false });
};

// Nota contextual del candidato según en qué punto de la orquestación estamos.
function candidateNote(state: RpfStateName, armed: boolean, vetoed: boolean): string {
  if (vetoed) return 'sin disparo — entorno vetado';
  if (!armed) return 'referencia — macro no alineado';
  switch (state) {
    case 'TRIGGERED': return 'disparo — edge sobre la barra';
    case 'ARMED': return 'armado — falta que la prima pague';
    case 'COOLDOWN': return 'suprimido por enfriamiento';
    case 'WAITING_CAPACITY': return 'la prima paga pero no hay cupo';
    case 'IN_POSITION': return 'cartera llena y sin señal viva';
    default: return '';
  }
}

function StatusIcon({ status }: { status: string }) {
  const c = STATUS_COLOR[status] ?? 'var(--text-muted)';
  if (status === 'pass') return <Check size={15} style={{ color: c, flexShrink: 0 }} />;
  if (status === 'fail') return <X size={15} style={{ color: c, flexShrink: 0 }} />;
  if (status === 'wait') return <Clock size={14} style={{ color: c, flexShrink: 0 }} />;
  return <Circle size={9} style={{ color: c, flexShrink: 0 }} />;
}

// Fila de check macro/prima: icono + etiqueta + valor/umbral.
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

// Fila de gate de disparo: valor libre (texto) + estado con reloj para "esperando".
function DisparaRow({ label, hint, value, status }: {
  label: string; hint?: string; value: string; status: 'pass' | 'fail' | 'wait' | 'na';
}) {
  const color = STATUS_COLOR[status] ?? 'var(--text-muted)';
  const valColor = status === 'na' ? 'var(--text-muted)' : status === 'pass' ? 'var(--text-primary)' : color;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderBottom: '1px solid var(--border-dark)' }}>
      <StatusIcon status={status} />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12, color: 'var(--text-primary)', fontFamily: 'Inter, sans-serif' }}>{label}</div>
        {hint && <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'Inter, sans-serif' }}>{hint}</div>}
      </div>
      <span className="tabular-nums" style={{ fontSize: 12, fontWeight: 600, fontFamily: 'JetBrains Mono, monospace', color: valColor }}>{value}</span>
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

// Conector vertical del flujo: chevron hacia abajo con etiqueta opcional.
function Connector({ label }: { label?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, margin: '7px 0' }}>
      {label && <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'Inter, sans-serif' }}>{label}</span>}
      <ChevronDown size={14} style={{ color: 'var(--text-disabled)' }} />
    </div>
  );
}

// Motor: el nodo raíz del flujo. El loop corre la cascada cada tick y la reparte en los dos ejes.
function MotorStrip({ online, lastTick }: { online: boolean; lastTick: string | null }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 8, ...panelStyle, marginBottom: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <RefreshCw size={15} style={{ color: online ? 'var(--green)' : 'var(--text-muted)' }} />
        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.05em', color: 'var(--text-secondary)', fontFamily: 'Inter, sans-serif' }}>MOTOR</span>
      </div>
      <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'Inter, sans-serif' }}>
        corre la cascada de 4 capas cada tick y la reparte en los dos ejes
      </span>
      <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: online ? 'var(--green)' : 'var(--text-muted)' }}>
        <span className={online ? 'pulse-dot' : ''} style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: online ? 'var(--green)' : 'var(--text-muted)' }} />
        {online ? 'tick vivo' : 'sin tick'}{lastTick ? ` · ${lastTick}` : ''}
      </span>
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
    <div style={panelStyle}>
      <PanelHeader title="Arma · ¿el entorno es seguro?" right={right} rightColor={rightColor} />
      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', margin: '0 0 2px' }}>Macro · capa 1</div>
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

// Eje DISPARA: los gates de decisión (edge vs barra + cupo + enfriamiento). La estructura del
// spread candidato vive en su propia tarjeta abajo. Atenuado si el entorno no armó.
function DisparaPanel({ st, active }: { st: RpfStateUpdate; active: boolean }) {
  const edge = st.edge ?? st.candidate?.edge ?? null;
  const bar = st.bar ?? st.candidate?.bar ?? null;
  const edgeOk = edge != null && bar != null && edge >= bar;
  const open = st.openPositions ?? 0;
  const max = st.maxPositions || 2;
  const capOk = st.capacityAvailable ?? (open < max);
  const cd = st.cooldownRemainingSec ?? 0;
  const regimeLabel = st.regime ? `barra · régimen ${st.regime}` : 'barra del régimen';
  const heat = st.heatPct != null ? ` · heat ${(st.heatPct * 100).toFixed(0)}%` : '';

  return (
    <div style={{ ...panelStyle, opacity: active ? 1 : 0.55 }}>
      <PanelHeader title="Dispara · ¿la prima paga?" right={active ? 'ACTIVO' : 'EN ESPERA'} rightColor={active ? 'var(--green)' : 'var(--text-muted)'} />
      {!active && (
        <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginBottom: 6, fontFamily: 'Inter, sans-serif' }}>
          eje no evaluado hasta que el entorno arme
        </div>
      )}
      <DisparaRow
        label="Edge vs barra"
        hint={regimeLabel}
        value={edge != null ? `${fmt(edge)} ${edgeOk ? '≥' : '<'} ${fmt(bar)}` : '—'}
        status={edge == null ? 'na' : edgeOk ? 'pass' : 'fail'}
      />
      <DisparaRow
        label="Cupo de cartera"
        hint={`máx ${max}${heat}`}
        value={`${open} / ${max}`}
        status={!active ? 'na' : capOk ? 'pass' : 'fail'}
      />
      <DisparaRow
        label="Enfriamiento"
        hint="suprime el re-disparo"
        value={cd > 0 ? `${Math.round(cd)}s` : 'inactivo'}
        status={cd > 0 ? 'wait' : 'pass'}
      />
    </div>
  );
}

// Máquina de estados: el estado resuelto es la salida de la orquestación.
function StateResolution({ state }: { state: RpfStateName }) {
  const meta = STATE_META[state] ?? STATE_META.DORMANT;
  const { Icon } = meta;
  return (
    <div style={{ borderRadius: 10, padding: '14px 16px', backgroundColor: tint(meta.color, 9), border: `1px solid ${tint(meta.color, 30)}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 40, height: 40, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: tint(meta.color, 15), flexShrink: 0 }}>
          <Icon size={22} style={{ color: meta.color }} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 10.5, fontFamily: 'JetBrains Mono, monospace', color: meta.color, letterSpacing: '0.08em' }}>{state}</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'Inter, sans-serif' }}>{meta.es}</div>
        </div>
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.6, marginTop: 10, fontFamily: 'Inter, sans-serif' }}>
        {STATE_EXPLAIN[state]}
      </div>
    </div>
  );
}

// Tarjeta del candidato PCS: la estructura del spread (siempre visible, aun DORMANT).
function CandidateCard({ cand, note }: { cand: RpfCandidate | null; note: string }) {
  if (!cand || cand.shortPutStrike == null) {
    return (
      <div style={{ ...panelStyle, fontSize: 11, color: 'var(--text-muted)' }}>
        El motor no propuso una posición candidata.
      </div>
    );
  }
  const ratioPct = cand.creditRatio != null ? cand.creditRatio * 100 : null;
  const ratioColor = ratioPct == null ? 'var(--text-muted)' : ratioPct >= 33.3 ? 'var(--green)' : ratioPct >= 25 ? 'var(--yellow-gc)' : 'var(--red-gc)';

  const tile = (label: string, value: React.ReactNode, color: string = 'var(--text-primary)') => (
    <div style={{ minWidth: 72, flex: 1 }}>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'Inter, sans-serif', marginBottom: 2 }}>{label}</div>
      <div className="tabular-nums" style={{ fontSize: 13, fontWeight: 700, color, fontFamily: 'JetBrains Mono, monospace' }}>{value}</div>
    </div>
  );

  return (
    <div style={panelStyle}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-secondary)', fontFamily: 'Inter, sans-serif' }}>Candidato PCS · siempre visible</span>
        <span style={{ fontSize: 10.5, color: 'var(--text-muted)', fontFamily: 'Inter, sans-serif' }}>{note}</span>
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <span className="tabular-nums" style={{ fontSize: 12, fontFamily: 'JetBrains Mono, monospace', padding: '4px 10px', borderRadius: 5, color: 'var(--red-gc)', backgroundColor: tint('var(--red-gc)', 13), border: `1px solid ${tint('var(--red-gc)', 30)}` }}>
          SELL put {cand.shortPutStrike}{cand.shortPutDelta != null ? ` · Δ ${Math.abs(cand.shortPutDelta).toFixed(2)}` : ''}
        </span>
        <span className="tabular-nums" style={{ fontSize: 12, fontFamily: 'JetBrains Mono, monospace', padding: '4px 10px', borderRadius: 5, color: 'var(--text-secondary)', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-dark)' }}>
          BUY put {cand.longPutStrike ?? '—'}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {tile('DTE', cand.dte ? `${cand.dte}${cand.expiration ? ` · ${cand.expiration}` : ''}` : '—')}
        {tile('Crédito', cand.credit != null ? `$${fmt(cand.credit)}` : '—')}
        {tile('Ancho', cand.width != null ? `$${fmt(cand.width)}` : '—')}
        {tile('Regla 1/3', ratioPct != null ? `${ratioPct.toFixed(0)}%` : '—', ratioColor)}
        {tile('POP', cand.pop != null ? `${cand.pop.toFixed(0)}%` : '—')}
      </div>
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
  const active = armed && !vetoed;
  const stFull: RpfStateUpdate = st ?? { symbol, state, timestamp: '' };
  const note = candidateNote(state, armed, vetoed);

  return (
    <div style={{ marginBottom: 22 }}>
      {/* Cabecera del símbolo: scan rápido (badge) + frescura */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'JetBrains Mono, monospace' }}>{symbol}</span>
        <RpfStateBadge state={state} />
        {st && st.cascadeOk === false && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, marginLeft: 'auto', fontSize: 10, color: 'var(--yellow-gc)', fontFamily: 'JetBrains Mono, monospace' }}>
            <AlertTriangle size={11} /> sin datos de cascada
          </span>
        )}
      </div>

      {/* Flujo: dos ejes */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12 }}>
        <ArmaPanel st={stFull} armed={armed} vetoed={vetoed} />
        <DisparaPanel st={stFull} active={active} />
      </div>

      {/* AND no compensable → máquina de estados */}
      <Connector label="arma Y dispara · no compensable" />
      <StateResolution state={state} />

      {/* Candidato */}
      <Connector />
      <CandidateCard cand={st?.candidate ?? null} note={note} />

      {/* Sugerencia (solo cuando dispara) */}
      {suggestion && (
        <div style={{ marginTop: 12 }}>
          <RpfSuggestionCard suggestion={suggestion} onAccept={onAccept} onDismiss={onDismiss} />
        </div>
      )}
    </div>
  );
}

export function Rpf({ acceptSuggestion, dismissSuggestion }: Props) {
  const { states, suggestions, loopOnline } = useRpfStore();

  // Solo los símbolos que el loop RPF emitió — NO el universo del core. RPF define su propio
  // universo (SPY-only) en galecore_rules_rpf.json; caer al ticker list del core mostraría QQQ como
  // si fuera parte de RPF, que es engañoso. Mientras el loop no emite, se muestra solo el banner.
  const symbols = Object.keys(states);
  const lastTick = tickTime(
    symbols.map((s) => states[s]?.timestamp).filter(Boolean).sort().slice(-1)[0]
  );

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

      {/* Motor: nodo raíz del flujo de orquestación */}
      <MotorStrip online={loopOnline} lastTick={lastTick} />
      {symbols.length > 0 && <Connector />}

      {!loopOnline && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 14px', marginTop: 8, marginBottom: 16, borderRadius: 8,
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

      {loopOnline && symbols.length === 0 && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '10px 12px', marginTop: 8, border: '1px dashed var(--border-dark)', borderRadius: 8 }}>
          Loop conectado — esperando el primer estado del universo RPF (SPY).
        </div>
      )}
    </div>
  );
}

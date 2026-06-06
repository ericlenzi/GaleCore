import React from 'react';
import { useRulesStore } from '../../store/useRulesStore';
import {
  CoreRules,
  RuleCheck,
  RuleThreshold,
  RuleDefinition,
  StructureSelectionRule,
} from '../../types/api';

/* ════════════════════════════════════════════════════════════════════════════
   Strategy Reference — refleja galecore_rules_core.json tal cual.
   No hardcodea umbrales: todo se lee del JSON (rules) y se renderiza.
   ════════════════════════════════════════════════════════════════════════════ */

/* ──────────────── diccionarios de presentación ──────────────── */

const OP_SYMBOL: Record<string, string> = {
  gte: '≥', lte: '≤', gt: '>', lt: '<', eq: '=', between: 'entre', custom: 'ƒ',
};

const ON_FAIL_LABEL: Record<string, string> = {
  no_trade: 'No operar',
  short_circuit_no_trade: 'Cortar — no operar',
  discard_side: 'Descartar lado',
  discard_put_side: 'Descartar put',
  discard_call_side: 'Descartar call',
  wait_for_stabilization: 'Esperar estabilización',
  block_until_fresh: 'Bloquear hasta dato fresco',
  block_new_entries: 'Bloquear entradas',
  block_new_call_entries: 'Bloquear calls nuevas',
  warn: 'Advertir',
  degrade_structure: 'Degradar estructura',
  try_wider_spread_then_discard: 'Ensanchar o descartar',
  reduce_contracts_to_fit_or_discard: 'Reducir contratos o descartar',
};

/** rojo = aborta todo · ámbar = descarta/degrada · azul = informativo */
function onFailTone(action?: string): 'red' | 'yellow' | 'blue' {
  if (!action) return 'blue';
  if (action.includes('no_trade')) return 'red';
  if (action === 'warn') return 'blue';
  return 'yellow';
}

const PRINCIPLE_LABEL: Record<string, string> = {
  cash_is_a_position: 'Cash es una posición',
  execution_quality_over_frequency: 'Calidad de ejecución sobre frecuencia',
  survival_over_trade_count: 'Supervivencia sobre cantidad de trades',
  defined_risk_only: 'Solo riesgo definido',
  no_binary_macro_risk: 'Sin riesgo macro binario',
};

const PRIORITY_LABEL: Record<string, string> = {
  operational_contingency: 'Contingencia operativa',
  macro_event_binary_avoidance: 'Evitar evento macro binario',
  daily_kill_switch: 'Kill switch diario',
  take_profit: 'Toma de ganancia',
  structural_support_loss: 'Pérdida de soporte estructural',
  hard_defense: 'Defensa dura',
  defensive_roll: 'Roll defensivo',
  time_exit: 'Salida por tiempo',
};

const STRUCTURE_META: Record<string, { label: string; tone: Tone }> = {
  iron_condor:        { label: 'Iron Condor',        tone: 'blue' },
  put_credit_spread:  { label: 'Put Credit Spread',  tone: 'green' },
  call_credit_spread: { label: 'Call Credit Spread', tone: 'yellow' },
  no_trade:           { label: 'No operar',          tone: 'red' },
};

const CONDITION_KEY_LABEL: Record<string, string> = {
  price_zscore: 'Z precio',
  price_zscore_abs: '|Z| precio',
  gex_skew: 'GEX skew',
  flow: 'Flow',
  trend: 'Tendencia',
};

/** Conceptos del nodo definitions que se muestran en el glosario, en este orden. */
const GLOSSARY_KEYS = [
  'gex_skew',
  'credit_ratio',
  'directional_zscore',
  'iv_rank',
  'iv_zscore',
  'expected_move',
  'pop_proxy',
  'trend_ema',
  'realized_vol_regime',
  'aggressive_flow',
];

const DEF_TITLE: Record<string, string> = {
  gex_skew: 'GEX Skew — asimetría de muros',
  credit_ratio: 'Credit Ratio — Regla 1/3',
  directional_zscore: 'Z-Score direccional de precio',
  iv_rank: 'IV Rank',
  iv_zscore: 'IV Z-Score',
  expected_move: 'Expected Move',
  pop_proxy: 'POP (proxy)',
  trend_ema: 'Tendencia EMA 20/50',
  realized_vol_regime: 'Régimen de Volatilidad Realizada',
  aggressive_flow: 'Flow agresivo de opciones',
};

/* ──────────────── tipos de tono / chips ──────────────── */

type Tone = 'green' | 'red' | 'yellow' | 'blue' | 'muted';

const TONE_VARS: Record<Tone, { fg: string; bg: string; border: string }> = {
  green:  { fg: 'var(--green)',   bg: 'var(--green-muted)',  border: 'var(--green-border)' },
  red:    { fg: 'var(--red-gc)',  bg: 'var(--red-muted)',    border: 'var(--red-border)' },
  yellow: { fg: 'var(--yellow-gc)', bg: 'var(--yellow-muted)', border: 'var(--yellow-border)' },
  blue:   { fg: 'var(--blue-gc)',  bg: 'var(--blue-muted)',   border: 'var(--blue-border)' },
  muted:  { fg: 'var(--text-secondary)', bg: 'var(--bg-tertiary)', border: 'var(--border-dark)' },
};

/* ──────────────── helpers de formato ──────────────── */

function pct(n: number, d = 1): string {
  return `${(n * 100).toFixed(d)}%`;
}

/** Resuelve un umbral a texto legible, expandiendo refs conocidas a definitions. */
function fmtThreshold(check: RuleCheck, rules: CoreRules): string {
  const t: RuleThreshold | undefined = check.threshold;
  const op = check.operator;
  if (!t) return '—';

  if (op === 'between' && t.min != null && t.max != null) return `${t.min} – ${t.max}`;
  if (t.value != null) return `${op ? OP_SYMBOL[op] ?? '' : ''} ${t.value}`.trim();
  if (t.min != null && t.max != null) return `${t.min} – ${t.max}`;
  if (t.ref) return refToText(t.ref, rules, op);
  return '—';
}

function refToText(ref: string, rules: CoreRules, op?: string): string {
  const defs = rules.definitions ?? {};
  const key = ref.replace(/^definitions\./, '');
  const def = defs[key];

  switch (key) {
    case 'zgl_with_buffer': {
      const buf = (def?.buffer_pct as number) ?? 0.005;
      return `ZGL + ${pct(buf)}`;
    }
    case 'put_wall': return 'Put Wall';
    case 'call_wall': return 'Call Wall';
    case 'max_heat': return '4.5% Net Liq';
    case 'gex_threshold_by_symbol':
    case 'min_offset_from_spot_by_symbol': {
      const vals = def?.values ?? {};
      const unit = key.startsWith('gex') ? 'B' : 'pts';
      const parts = Object.entries(vals).map(([s, v]) => `${s} ${v}${unit}`);
      const prefix = op ? `${OP_SYMBOL[op] ?? ''} ` : '';
      return `${prefix}${parts.join(' · ')}`;
    }
    case 'credit_ratio_min_by_iv_rank':
      return 'mín. según IV Rank';
    default:
      // referencia a marketdata u otra: mostrar la cola legible
      return ref.split('.').slice(-1)[0].replace(/_/g, ' ');
  }
}

function humanize(s: string): string {
  return s.replace(/_/g, ' ');
}

function fmtVal(v: unknown): string {
  if (v == null) return '—';
  if (typeof v === 'boolean') return v ? 'sí' : 'no';
  if (Array.isArray(v)) return v.map((x) => humanize(String(x))).join(', ');
  if (typeof v === 'object') {
    return Object.entries(v as Record<string, unknown>)
      .map(([k, val]) => `${humanize(k)}: ${fmtVal(val)}`)
      .join(' · ');
  }
  return humanize(String(v));
}

/** Resumen de una definición para la tabla de referencia. */
function defSummary(def: RuleDefinition): string {
  if (def.formula) return def.formula;
  if (def.values) return Object.entries(def.values).map(([k, v]) => `${k}: ${v}`).join(' · ');
  if (def.ranges) return def.ranges.map((r) => `${r.min}–${r.max} → ${r.value}`).join(' · ');
  if (typeof def.interpretation === 'string') return def.interpretation;
  if (def.definition) return String(def.definition);
  if (def.target) return `target ${def.target}`;
  return humanize(def.type ?? '—');
}

/* ──────────────── primitivas visuales ──────────────── */

function SectionTitle({ n, children }: { n?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2 mb-3">
      {n && (
        <span
          className="text-xs font-bold px-1.5 py-0.5 rounded"
          style={{ color: 'var(--blue-gc)', backgroundColor: 'var(--blue-muted)' }}
        >
          {n}
        </span>
      )}
      <h2
        className="text-base font-semibold uppercase tracking-widest"
        style={{ color: 'var(--blue-gc)' }}
      >
        {children}
      </h2>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded-lg p-4 mb-4"
      style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-dark)' }}
    >
      {children}
    </div>
  );
}

function Chip({ tone = 'muted', children }: { tone?: Tone; children: React.ReactNode }) {
  const c = TONE_VARS[tone];
  return (
    <span
      className="inline-block text-base px-2 py-0.5 rounded font-medium whitespace-nowrap"
      style={{ color: c.fg, backgroundColor: c.bg, border: `1px solid ${c.border}` }}
    >
      {children}
    </span>
  );
}

function Mono({ children }: { children: React.ReactNode }) {
  return (
    <code
      className="text-base px-1.5 py-0.5 rounded"
      style={{
        fontFamily: 'JetBrains Mono, monospace',
        backgroundColor: 'var(--bg-tertiary)',
        color: 'var(--text-primary)',
      }}
    >
      {children}
    </code>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <span className="text-base" style={{ color: 'var(--text-secondary)' }}>{children}</span>;
}

function TH({ children, w }: { children: React.ReactNode; w?: string }) {
  return (
    <th
      className="px-3 py-2 text-left text-sm uppercase tracking-wider font-medium"
      style={{ color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-dark)', width: w }}
    >
      {children}
    </th>
  );
}

function TD({ children, top }: { children: React.ReactNode; top?: boolean }) {
  return (
    <td
      className="px-3 py-2 text-base"
      style={{
        color: 'var(--text-primary)',
        borderBottom: '1px solid var(--border-dark)',
        verticalAlign: top ? 'top' : 'middle',
      }}
    >
      {children}
    </td>
  );
}

/* ──────────────── tabla de checks de una capa ──────────────── */

function ChecksTable({
  checks,
  rules,
  withSide,
}: {
  checks: RuleCheck[];
  rules: CoreRules;
  withSide?: boolean;
}) {
  return (
    <table className="w-full" style={{ borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          {withSide && <TH w="64px">Lado</TH>}
          <TH>Condición</TH>
          <TH w="160px">Umbral</TH>
          <TH w="180px">Si falla</TH>
        </tr>
      </thead>
      <tbody>
        {checks.map((c) => {
          const isCustom = c.operator === 'custom' || !!c.rule;
          return (
            <tr key={c.id}>
              {withSide && (
                <TD top>
                  {c.side
                    ? <Chip tone={c.side === 'put' ? 'green' : 'yellow'}>{c.side}</Chip>
                    : <Muted>—</Muted>}
                </TD>
              )}
              <TD top>
                <div style={{ color: 'var(--text-primary)' }}>{c.label}</div>
                {c.note && <div className="mt-1"><Muted>{c.note}</Muted></div>}
                {isCustom && c.rule && (
                  <div className="mt-1"><Mono>{c.rule}</Mono></div>
                )}
                {(c.applies_per_leg || c.applies_per_spread || c.applies_to_symbol) && (
                  <div className="mt-1 flex gap-1 flex-wrap">
                    {c.applies_per_leg && <Chip tone="muted">por leg: {c.applies_per_leg}</Chip>}
                    {c.applies_per_spread && <Chip tone="muted">por spread</Chip>}
                    {c.applies_to_symbol && <Chip tone="muted">{c.applies_to_symbol.join(', ')}</Chip>}
                  </div>
                )}
              </TD>
              <TD top>
                {isCustom ? <Muted>—</Muted> : <Mono>{fmtThreshold(c, rules)}</Mono>}
              </TD>
              <TD top>
                {c.on_fail
                  ? <Chip tone={onFailTone(c.on_fail)}>{ON_FAIL_LABEL[c.on_fail] ?? c.on_fail}</Chip>
                  : <Muted>—</Muted>}
              </TD>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/* ──────────────── tarjeta de regla de estructura ──────────────── */

function StructureRuleRow({ rule }: { rule: StructureSelectionRule }) {
  const meta = STRUCTURE_META[rule.output] ?? { label: rule.output, tone: 'muted' as Tone };
  const conds = rule.conditions;

  return (
    <tr>
      <TD top>
        <span className="font-bold" style={{ color: 'var(--text-secondary)' }}>{rule.id}</span>
      </TD>
      <TD top>
        <div className="font-medium" style={{ color: 'var(--text-primary)' }}>{rule.label}</div>
      </TD>
      <TD top>
        {typeof conds === 'string' ? (
          <Chip tone="muted">{conds}</Chip>
        ) : (
          <div className="flex flex-col gap-1">
            {Object.entries(conds).map(([k, v]) => (
              <span key={k} className="text-base" style={{ color: 'var(--text-secondary)' }}>
                <span style={{ color: 'var(--text-secondary)' }}>{CONDITION_KEY_LABEL[k] ?? k}:</span>{' '}
                <Mono>{v}</Mono>
              </span>
            ))}
          </div>
        )}
      </TD>
      <TD top><Chip tone={meta.tone}>{meta.label}</Chip></TD>
      <TD top><Muted>{rule.rationale}</Muted></TD>
    </tr>
  );
}

/* ──────────────── glosario de conceptos (definitions) ──────────────── */

function interpretationNode(interp: string | Record<string, string> | undefined) {
  if (!interp) return null;
  if (typeof interp === 'string') {
    return <div className="mt-2"><Muted>{interp}</Muted></div>;
  }
  return (
    <div className="mt-2 flex flex-col gap-1">
      {Object.entries(interp).map(([k, v]) => (
        <div key={k} className="text-base" style={{ color: 'var(--text-secondary)' }}>
          <Mono>{k.replace(/_/g, ' ').replace('gt ', '> ').replace('lt ', '< ').replace('between ', '')}</Mono>{' '}
          {v}
        </div>
      ))}
    </div>
  );
}

function DefCard({ defKey, def }: { defKey: string; def: RuleDefinition }) {
  const title = DEF_TITLE[defKey] ?? defKey;
  const thresholds = def.thresholds;

  return (
    <div
      className="rounded-lg p-3"
      style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-dark)' }}
    >
      <div className="font-semibold text-base mb-1.5" style={{ color: 'var(--text-primary)' }}>
        {title}
      </div>

      {def.formula && (
        <div
          className="font-mono text-base px-2 py-1.5 rounded mb-1"
          style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--blue-gc)' }}
        >
          {def.formula}
        </div>
      )}

      {interpretationNode(def.interpretation)}

      {thresholds && (
        <div className="mt-2 flex gap-1.5 flex-wrap">
          {Object.entries(thresholds).map(([k, v]) => {
            const label =
              v && typeof v === 'object'
                ? ((v as { label?: string }).label ?? JSON.stringify(v))
                : String(v);
            return <Chip key={k} tone="muted">{k.replace(/_/g, ' ')}: {label}</Chip>;
          })}
        </div>
      )}

      {def.target && (
        <div className="mt-2"><Chip tone="green">target {def.target}</Chip></div>
      )}

      {def.endpoint && (
        <div className="mt-2"><Muted>fuente: </Muted><Mono>{def.endpoint}</Mono></div>
      )}
    </div>
  );
}

/* ──────────────── par etiqueta / valor ──────────────── */

function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1.5" style={{ borderBottom: '1px solid var(--border-dark)' }}>
      <span className="text-base" style={{ color: 'var(--text-secondary)' }}>{k}</span>
      <span className="text-base font-medium" style={{ color: 'var(--text-primary)' }}>{v}</span>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
   componente principal
   ════════════════════════════════════════════════════════════════════════════ */

export function StrategyReference() {
  const { rules, loading, error } = useRulesStore();

  if (loading) {
    return (
      <div className="p-4 flex items-center gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
        <span className="spinner" /> Cargando reglas…
      </div>
    );
  }
  if (error || !rules) {
    return (
      <div className="p-4 text-xs" style={{ color: 'var(--red-gc)' }}>
        Error cargando reglas: {error ?? 'sin datos'}
      </div>
    );
  }

  const meta = rules._meta;
  const defs = rules.definitions ?? {};
  const pb = rules.position_builder;
  const layers = pb?.layers ?? [];
  const strikeEngine = layers.find((l) => l.name === 'strike_engine');
  const microstructure = layers.find((l) => l.name === 'microstructure');
  const riskSizing = layers.find((l) => l.name === 'risk_and_sizing');
  const ss = strikeEngine?.config?.structure_selection;
  const tm = rules.trade_management;
  const dq = rules.data_quality;
  const exec = rules.execution;
  const signals = rules.display_config?.signal_labels;

  return (
    <div className="p-6 max-w-6xl mx-auto">

      {/* ── encabezado ── */}
      <div className="mb-5">
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
            Estrategia · Gamma Premium
          </h1>
          <Chip tone="blue">v{meta.version}</Chip>
          {meta.profile && <Chip tone="muted">perfil: {meta.profile}</Chip>}
          <Chip tone="muted">actualizado {meta.last_updated}</Chip>
        </div>
        <p className="text-base leading-relaxed" style={{ color: 'var(--text-secondary)', maxWidth: 760 }}>
          Venta sistemática de prima con riesgo definido. Captura el decay de theta sobre índices líquidos
          usando la estructura de gamma del mercado como soporte. Una señal solo abre posición si supera
          las <strong>4 capas de validación en cascada</strong> — si una falla, las siguientes ni se evalúan.
          Todo lo que ves aquí proviene de <Mono>galecore_rules_core.json</Mono>.
        </p>
        {meta.notes && (
          <p className="text-base mt-2" style={{ color: 'var(--text-secondary)' }}>{meta.notes}</p>
        )}
      </div>

      {/* ── principios + scope ── */}
      <Card>
        <SectionTitle>Principios &amp; Alcance</SectionTitle>

        {rules.principles && (
          <div className="flex gap-2 flex-wrap mb-4">
            {Object.entries(rules.principles)
              .filter(([, v]) => v)
              .map(([k]) => (
                <Chip key={k} tone="blue">{PRINCIPLE_LABEL[k] ?? k}</Chip>
              ))}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div className="text-base mb-1.5" style={{ color: 'var(--text-secondary)' }}>Estructuras permitidas</div>
            <div className="flex gap-1.5 flex-wrap mb-3">
              {(rules.strategy_scope?.allowed_strategies ?? []).map((s) => (
                <Chip key={s} tone="green">{STRUCTURE_META[s]?.label ?? s}</Chip>
              ))}
            </div>
            <div className="text-base mb-1.5" style={{ color: 'var(--text-secondary)' }}>Prohibidas</div>
            <div className="flex gap-1.5 flex-wrap">
              {(rules.strategy_scope?.forbidden_strategies ?? []).map((s) => (
                <Chip key={s} tone="red">{s.replace(/_/g, ' ')}</Chip>
              ))}
            </div>
          </div>
          <div>
            <KV k="Universo" v={rules.universe.tickers.join(', ')} />
            <KV k="Estructura por defecto" v={STRUCTURE_META[rules.strategy_scope?.default_structure ?? '']?.label ?? rules.strategy_scope?.default_structure ?? '—'} />
            <KV k="Selección de estructura" v={rules.strategy_scope?.structure_selection_method ?? '—'} />
            {rules.universe.min_avg_daily_volume_underlying && (
              <KV k="Vol. diario mín. subyacente" v={rules.universe.min_avg_daily_volume_underlying.toLocaleString()} />
            )}
          </div>
        </div>
      </Card>

      {/* ── cascada de 4 capas (overview) ── */}
      <Card>
        <SectionTitle>La cascada de 4 capas</SectionTitle>
        <div className="flex items-stretch gap-2 flex-wrap">
          {[
            { n: 1, name: 'Régimen Macro & GEX', desc: '¿El entorno permite vender prima?' },
            { n: 2, name: 'Motor de Strikes', desc: 'Estructura, expiración y strikes' },
            { n: 3, name: 'Microestructura', desc: 'Liquidez, quote y crédito mínimo' },
            { n: 4, name: 'Sizing & Riesgo', desc: 'Contratos, slots y heat del portafolio' },
          ].map((l, i, arr) => (
            <React.Fragment key={l.n}>
              <div
                className="flex-1 rounded p-3"
                style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-dark)', minWidth: 150 }}
              >
                <div className="text-base font-bold mb-1" style={{ color: 'var(--blue-gc)' }}>Capa {l.n}</div>
                <div className="text-base font-medium" style={{ color: 'var(--text-primary)' }}>{l.name}</div>
                <div className="mt-1"><Muted>{l.desc}</Muted></div>
              </div>
              {i < arr.length - 1 && (
                <div className="flex items-center" style={{ color: 'var(--text-secondary)' }}>→</div>
              )}
            </React.Fragment>
          ))}
        </div>
        <div className="mt-3">
          <Muted>
            Cortocircuitante: si una capa falla, no se evalúan las siguientes y no se abre nada.
          </Muted>
        </div>
      </Card>

      {/* ── disponibilidad de datos ── */}
      {rules.data_availability && (
        <Card>
          <SectionTitle>Disponibilidad de datos</SectionTitle>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className="text-base uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                Disponible hoy (automático)
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {(rules.data_availability.available_today ?? []).map((d) => (
                  <Chip key={d} tone="green">{humanize(d)}</Chip>
                ))}
              </div>
            </div>
            <div>
              <div className="text-base uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                Requiere chequeo manual
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {(rules.data_availability.manual_check_required ?? []).map((d) => (
                  <Chip key={d} tone="yellow">{humanize(d)}</Chip>
                ))}
              </div>
            </div>
          </div>
          {rules.data_availability.partial_availability_note && (
            <div className="mt-3 flex flex-col gap-1">
              {Object.entries(rules.data_availability.partial_availability_note).map(([k, v]) => (
                <div key={k}>
                  <Chip tone="muted">{humanize(k)}</Chip> <Muted>{v}</Muted>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* ── Capa 1 — macro_regime ── */}
      <Card>
        <SectionTitle n="Capa 1">Régimen Macro &amp; GEX</SectionTitle>
        <div className="flex gap-1.5 flex-wrap mb-3">
          {rules.macro_regime.pass_rule && <Chip tone="blue">pasa si: {rules.macro_regime.pass_rule.replace(/_/g, ' ')}</Chip>}
          {rules.macro_regime.on_fail && <Chip tone="red">{ON_FAIL_LABEL[rules.macro_regime.on_fail] ?? rules.macro_regime.on_fail.replace(/_/g, ' ')}</Chip>}
        </div>
        <ChecksTable checks={rules.macro_regime.checks} rules={rules} />
      </Card>

      {/* ── Capa 2 — strike_engine ── */}
      {strikeEngine && (
        <Card>
          <SectionTitle n="Capa 2">Motor de Strikes</SectionTitle>
          <p className="text-base mb-3" style={{ color: 'var(--text-secondary)' }}>{strikeEngine.description}</p>

          {/* DTE */}
          {strikeEngine.config?.dte_selection && (
            <div className="mb-4">
              <div className="text-base uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-secondary)' }}>Selección de expiración (DTE)</div>
              <div className="flex gap-1.5 flex-wrap">
                <Chip tone="blue">target {strikeEngine.config.dte_selection.target}d</Chip>
                <Chip tone="muted">rango {strikeEngine.config.dte_selection.min}–{strikeEngine.config.dte_selection.max}d</Chip>
                <Chip tone="muted">{strikeEngine.config.dte_selection.expiration_preference?.replace(/_/g, ' ')}</Chip>
                {strikeEngine.config.dte_selection.allow_weeklies && <Chip tone="muted">weeklies condicionales</Chip>}
              </div>
              {strikeEngine.config.dte_selection.weekly_condition && (
                <div className="mt-1.5"><Muted>weeklies: {strikeEngine.config.dte_selection.weekly_condition.replace(/_/g, ' ')}</Muted></div>
              )}
            </div>
          )}

          {/* selección de estructura — el corazón */}
          {ss && (
            <div className="mb-4">
              <div className="text-base uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                Selección de estructura · {ss.method?.replace(/_/g, ' ')}
              </div>
              <p className="text-base mb-2" style={{ color: 'var(--text-secondary)' }}>{ss.description}</p>
              <div className="flex gap-1.5 flex-wrap mb-3">
                {ss.thresholds && <Chip tone="blue">neutral |Z| &lt; {ss.thresholds.neutral_z}</Chip>}
                {ss.thresholds && <Chip tone="blue">extremo |Z| &gt; {ss.thresholds.extreme_z}</Chip>}
                {ss.evaluation_order && <Chip tone="muted">{ss.evaluation_order.replace(/_/g, ' ')}</Chip>}
              </div>

              {/* inputs */}
              {ss.inputs && (
                <div className="flex gap-1.5 flex-wrap mb-3">
                  {Object.entries(ss.inputs).map(([k, v]) => (
                    <Chip key={k} tone="muted">
                      {CONDITION_KEY_LABEL[k] ?? k} ← {(v.ref ?? '').replace('definitions.', '')}
                    </Chip>
                  ))}
                </div>
              )}

              {/* las 8 reglas */}
              <div className="overflow-x-auto">
                <table className="w-full" style={{ borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <TH w="32px">#</TH>
                      <TH w="200px">Escenario</TH>
                      <TH w="220px">Condiciones</TH>
                      <TH w="150px">Estructura</TH>
                      <TH>Razonamiento</TH>
                    </tr>
                  </thead>
                  <tbody>
                    {ss.rules.map((r) => <StructureRuleRow key={r.id} rule={r} />)}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* spread width */}
          {strikeEngine.config?.spread_width?.symbol_overrides && (
            <div className="mb-4">
              <div className="text-base uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                Ancho de spread (puntos)
              </div>
              <div className="flex gap-2 flex-wrap">
                {Object.entries(strikeEngine.config.spread_width.symbol_overrides).map(([sym, o]) => (
                  <div
                    key={sym}
                    className="rounded p-2"
                    style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-dark)' }}
                  >
                    <span className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>{sym}</span>{' '}
                    <Muted>default {o.default} · {o.min}–{o.max} · step {o.step}</Muted>
                  </div>
                ))}
              </div>
              {strikeEngine.config.spread_width.selection_rule && (
                <div className="mt-1.5"><Muted>{strikeEngine.config.spread_width.selection_rule}</Muted></div>
              )}
            </div>
          )}

          {/* checks de strikes */}
          {strikeEngine.checks && (
            <div>
              <div className="text-base uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-secondary)' }}>Validaciones de strikes</div>
              <ChecksTable checks={strikeEngine.checks} rules={rules} withSide />
            </div>
          )}
        </Card>
      )}

      {/* ── Capa 3 — microstructure ── */}
      {microstructure && (
        <Card>
          <SectionTitle n="Capa 3">Microestructura</SectionTitle>
          <p className="text-base mb-3" style={{ color: 'var(--text-secondary)' }}>{microstructure.description}</p>
          {microstructure.checks && <ChecksTable checks={microstructure.checks} rules={rules} />}
        </Card>
      )}

      {/* ── Capa 4 — risk_and_sizing ── */}
      {riskSizing && (
        <Card>
          <SectionTitle n="Capa 4">Sizing &amp; Riesgo</SectionTitle>
          <p className="text-base mb-3" style={{ color: 'var(--text-secondary)' }}>{riskSizing.description}</p>
          {riskSizing.config && (
            <div className="flex gap-1.5 flex-wrap mb-4">
              {riskSizing.config.risk_per_trade_pct != null && (
                <Chip tone="blue">riesgo/trade {pct(riskSizing.config.risk_per_trade_pct)} Net Liq</Chip>
              )}
              {riskSizing.config.max_positions != null && (
                <Chip tone="blue">máx posiciones {riskSizing.config.max_positions}</Chip>
              )}
              {riskSizing.config.max_heat_pct_net_liq != null && (
                <Chip tone="blue">heat máx {pct(riskSizing.config.max_heat_pct_net_liq)} Net Liq</Chip>
              )}
            </div>
          )}
          {riskSizing.checks && <ChecksTable checks={riskSizing.checks} rules={rules} />}

          {/* fórmulas de sizing relevantes */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-4">
            {(['max_contracts', 'max_heat', 'portfolio_heat', 'risk_per_trade'] as const).map((k) =>
              defs[k]?.formula ? (
                <div key={k}>
                  <div className="text-base mb-0.5" style={{ color: 'var(--text-secondary)' }}>{k.replace(/_/g, ' ')}</div>
                  <Mono>{defs[k].formula}</Mono>
                </div>
              ) : null
            )}
          </div>
        </Card>
      )}

      {/* ── ranking ── */}
      {pb?.ranking && (
        <Card>
          <SectionTitle>Ranking de oportunidades</SectionTitle>
          <p className="text-base mb-2" style={{ color: 'var(--text-secondary)' }}>{pb.ranking.description}</p>
          {pb.ranking.score_formula && (
            <div
              className="font-mono text-base px-3 py-2 rounded mb-3 text-center"
              style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--blue-gc)' }}
            >
              priorityScore = {pb.ranking.score_formula}
            </div>
          )}
          <div className="flex gap-2 flex-wrap">
            {pb.ranking.criteria.map((c) => (
              <div
                key={c.id}
                className="rounded p-3 flex-1"
                style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-dark)', minWidth: 200 }}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-base font-medium" style={{ color: 'var(--text-primary)' }}>{c.label}</span>
                  <Chip tone="blue">peso {pct(c.weight, 0)}</Chip>
                </div>
                {c.target && <div className="mb-1"><Chip tone="green">target {c.target}</Chip></div>}
                <Muted>{c.note}</Muted>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ── glosario de conceptos ── */}
      <Card>
        <SectionTitle>Conceptos &amp; Fórmulas</SectionTitle>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {GLOSSARY_KEYS.filter((k) => defs[k]).map((k) => (
            <DefCard key={k} defKey={k} def={defs[k]} />
          ))}
        </div>

        {/* credit_ratio_min_by_iv_rank — tabla de tramos */}
        {defs.credit_ratio_min_by_iv_rank?.ranges && (
          <div className="mt-4">
            <div className="text-base uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-secondary)' }}>
              Credit ratio mínimo según IV Rank
            </div>
            <table className="w-full md:w-1/2" style={{ borderCollapse: 'collapse' }}>
              <thead><tr><TH>IV Rank</TH><TH>Credit ratio mín.</TH></tr></thead>
              <tbody>
                {defs.credit_ratio_min_by_iv_rank.ranges!.map((r, i) => (
                  <tr key={i}>
                    <TD>{r.min} – {r.max}</TD>
                    <TD><Mono>≥ {pct(r.value, 0)}</Mono></TD>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* referencia completa de definitions */}
        {(() => {
          const shown = new Set([...GLOSSARY_KEYS, 'credit_ratio_min_by_iv_rank']);
          const rest = Object.keys(defs).filter((k) => !k.startsWith('_') && !shown.has(k));
          if (rest.length === 0) return null;
          return (
            <div className="mt-4">
              <div className="text-base uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                Referencia completa de fórmulas y lookups ({rest.length})
              </div>
              <div className="overflow-x-auto">
                <table className="w-full" style={{ borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <TH w="220px">Definición</TH>
                      <TH w="110px">Tipo</TH>
                      <TH>Fórmula / Valor</TH>
                    </tr>
                  </thead>
                  <tbody>
                    {rest.map((k) => (
                      <tr key={k}>
                        <TD top>{humanize(k)}</TD>
                        <TD top><Chip tone="muted">{humanize(defs[k].type ?? '—')}</Chip></TD>
                        <TD top><Mono>{defSummary(defs[k])}</Mono></TD>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })()}
      </Card>

      {/* ── trade management ── */}
      <Card>
        <SectionTitle>Gestión de la posición</SectionTitle>

        {tm.evaluation_priority && (
          <div className="mb-4">
            <div className="text-base uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-secondary)' }}>Prioridad de evaluación</div>
            <div className="flex gap-1.5 flex-wrap items-center">
              {tm.evaluation_priority.map((p, i) => (
                <React.Fragment key={p}>
                  <Chip tone="muted">{i + 1}. {PRIORITY_LABEL[p] ?? p.replace(/_/g, ' ')}</Chip>
                </React.Fragment>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {tm.take_profit && (
            <ExitCard tone="green" title="Toma de ganancia"
              detail={`Cerrar al ${pct(tm.take_profit.pct_of_initial_credit, 0)} del crédito inicial.`} />
          )}
          {tm.time_exit && (
            <ExitCard tone="yellow" title="Salida por tiempo"
              detail={`A ${tm.time_exit.dte_threshold} DTE → cerrar sin importar el P&L.`} />
          )}
          {tm.daily_kill_switch && (
            <ExitCard tone="red" title="Kill switch diario"
              detail={`Pérdida MtM diaria ≥ ${pct(tm.daily_kill_switch.daily_portfolio_mtm_loss_pct_net_liq_max)} Net Liq → bloquear nuevas entradas el resto de la sesión.`} />
          )}
          {tm.hard_defense && (
            <ExitCard tone="red" title="Defensa dura"
              detail={`|Δ short| > ${tm.hard_defense.trigger_any.short_leg_delta_abs_gt} o pérdida ≥ ${pct(tm.hard_defense.trigger_any.unrealized_loss_pct_of_initial_credit_gte, 0)} del crédito → evaluar reducción inmediata de riesgo.`} />
          )}
          {tm.defensive_roll && (
            <ExitCard tone="yellow" title="Roll defensivo"
              detail={`Pérdida ≥ ${pct(tm.defensive_roll.trigger_unrealized_loss_pct_of_initial_credit_gte, 0)} del crédito, con DTE ≥ ${tm.defensive_roll.min_dte_remaining} y crédito de roll ≥ $${tm.defensive_roll.min_net_credit_for_roll.toFixed(2)}. Máx ${tm.defensive_roll.max_rolls_per_position} roll por posición.`} />
          )}
          {tm.structural_support_loss && (
            <ExitCard tone="yellow" title="Pérdida de soporte estructural"
              detail={`Si un muro relevante entra dentro del short strike (confirmado en ${tm.structural_support_loss.confirm_consecutive_recalculations ?? 2} recálculos) → cerrar.`} />
          )}
          {tm.macro_event_binary_avoidance && (
            <ExitCard tone="blue" title="Evento macro binario"
              detail="Al entrar en la ventana buffer de un evento macro → cerrar antes de que comience." />
          )}
        </div>
      </Card>

      {/* ── ejecución + calidad de datos ── */}
      <Card>
        <SectionTitle>Ejecución &amp; Calidad de datos</SectionTitle>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div className="text-base uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-secondary)' }}>Ejecución</div>
            {exec?.submit_multileg_as_complex_order && <KV k="Orden multi-leg" v="orden compleja única" />}
            {exec?.avoid_first_minutes_open != null && <KV k="Evitar apertura" v={`primeros ${exec.avoid_first_minutes_open} min`} />}
            {exec?.avoid_last_minutes_close != null && <KV k="Evitar cierre" v={`últimos ${exec.avoid_last_minutes_close} min`} />}
            {exec?.slippage?.new_entries?.max_total_cost_pct_of_expected_credit != null && (
              <KV k="Slippage máx (entrada)" v={pct(exec.slippage.new_entries.max_total_cost_pct_of_expected_credit, 0) + ' del crédito esperado'} />
            )}
          </div>
          <div>
            <div className="text-base uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-secondary)' }}>Calidad de datos</div>
            {dq?.max_quote_age_seconds != null && <KV k="Antigüedad máx. quote" v={`${dq.max_quote_age_seconds}s`} />}
            {dq?.max_structural_levels_age_minutes != null && <KV k="Niveles estructurales" v={`${dq.max_structural_levels_age_minutes} min`} />}
            {dq?.block_on_crossed_market != null && <KV k="Mercado cruzado" v={dq.block_on_crossed_market ? 'bloquear' : 'permitir'} />}
            {dq?.block_on_missing_critical_data != null && <KV k="Dato crítico ausente" v={dq.block_on_missing_critical_data ? 'bloquear' : 'permitir'} />}
            {rules.monitoring?.review_frequency_minutes != null && <KV k="Frecuencia de revisión" v={`${rules.monitoring.review_frequency_minutes} min`} />}
          </div>
        </div>

        {/* políticas de ejecución detalladas */}
        {(exec?.partial_fill_policy || exec?.forced_exit_policy) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 pt-4" style={{ borderTop: '1px solid var(--border-dark)' }}>
            {exec?.partial_fill_policy && (
              <div>
                <div className="text-base uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-secondary)' }}>Política de fill parcial</div>
                {Object.entries(exec.partial_fill_policy).map(([k, v]) => (
                  <KV key={k} k={humanize(k)} v={fmtVal(v)} />
                ))}
              </div>
            )}
            {exec?.forced_exit_policy && (
              <div>
                <div className="text-base uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-secondary)' }}>Política de salida forzada</div>
                {Object.entries(exec.forced_exit_policy).map(([k, v]) => (
                  <KV key={k} k={humanize(k)} v={fmtVal(v)} />
                ))}
              </div>
            )}
          </div>
        )}
      </Card>

      {/* ── display config: alertas, columnas y enums ── */}
      {(rules.display_config?.alerts_priority || rules.display_config?.portfolio_manager_table || rules.operators || rules.on_fail_actions) && (
        <Card>
          <SectionTitle>Display, alertas y vocabulario</SectionTitle>

          {rules.display_config?.alerts_priority && (
            <div className="mb-4">
              <div className="text-base uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-secondary)' }}>Prioridad de alertas</div>
              <div className="flex gap-1.5 flex-wrap items-center">
                {rules.display_config.alerts_priority.map((a, i) => (
                  <Chip key={a} tone="muted">{i + 1}. {humanize(a)}</Chip>
                ))}
              </div>
            </div>
          )}

          {rules.display_config?.portfolio_manager_table?.columns && (
            <div className="mb-4">
              <div className="text-base uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                Columnas del Portfolio Manager ({rules.display_config.portfolio_manager_table.columns.length})
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {rules.display_config.portfolio_manager_table.columns.map((c) => (
                  <Chip key={c.id} tone={c.realtime ? 'green' : 'muted'}>
                    {c.label}{c.realtime ? ' ◷' : ''}
                  </Chip>
                ))}
              </div>
              <div className="mt-1.5"><Muted>◷ = se actualiza en tiempo real vía socket.</Muted></div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {rules.operators && (
              <div>
                <div className="text-base uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-secondary)' }}>Operadores soportados</div>
                <div className="flex gap-1.5 flex-wrap">
                  {rules.operators.values.map((o) => (
                    <Chip key={o} tone="blue">{o}{OP_SYMBOL[o] ? ` (${OP_SYMBOL[o]})` : ''}</Chip>
                  ))}
                </div>
              </div>
            )}
            {rules.on_fail_actions && (
              <div>
                <div className="text-base uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-secondary)' }}>Acciones ante fallo</div>
                <div className="flex gap-1.5 flex-wrap">
                  {rules.on_fail_actions.values.map((a) => (
                    <Chip key={a} tone={onFailTone(a)}>{ON_FAIL_LABEL[a] ?? humanize(a)}</Chip>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* ── señales ── */}
      {signals && (
        <Card>
          <SectionTitle>Señales del sistema</SectionTitle>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {Object.entries(signals).map(([name, s]) => {
              const tone: Tone = s.color === 'green' ? 'green' : s.color === 'red' ? 'red' : s.color === 'yellow' ? 'yellow' : 'muted';
              return (
                <div
                  key={name}
                  className="rounded p-3"
                  style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-dark)' }}
                >
                  <div className="mb-1"><Chip tone={tone}>{name}</Chip></div>
                  <Muted>{s.condition.replace(/_/g, ' ')}</Muted>
                </div>
              );
            })}
          </div>
        </Card>
      )}

    </div>
  );
}

/* ──────────────── tarjeta de regla de salida ──────────────── */

function ExitCard({ tone, title, detail }: { tone: Tone; title: string; detail: string }) {
  const c = TONE_VARS[tone];
  return (
    <div className="rounded-lg p-3" style={{ border: `1px solid ${c.border}`, backgroundColor: c.bg }}>
      <div className="font-semibold text-base mb-1" style={{ color: c.fg }}>{title}</div>
      <div className="text-base leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{detail}</div>
    </div>
  );
}

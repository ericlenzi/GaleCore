import React, { useEffect, useState } from 'react';
import { ChevronRight, Zap } from 'lucide-react';
import { fetchCoreRulesRaw } from '../api/rules';
import { PositionMonitor } from '../components/positions/PositionMonitor';
import { ConnectionStatus } from '../socket/useMarketSocket';
import { tint } from '../utils/formatters';

interface Props {
  subscribeLeg: (sym: string) => void;
  unsubscribeLeg: (sym: string) => void;
  socketStatus: ConnectionStatus;
}

// Símbolo de referencia para la Definición (ancho por ticker). El ancho es el mismo para
// SPY y QQQ ($5), así que alcanza con uno para la vista declarativa.
const DEF_SYMBOL = 'SPY';

// ─── átomos de estilo ────────────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase',
      color: 'var(--text-muted)', fontFamily: 'Inter, sans-serif',
      padding: '2px 0 8px', borderBottom: '1px solid var(--border-dark)', marginBottom: 10,
    }}>
      {children}
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-dark)',
      borderRadius: 8, padding: '14px 16px', marginBottom: 14,
    }}>
      {children}
    </div>
  );
}

// Card con header clickeable que colapsa su contenido. Contraído por defecto.
function CollapsibleCard({ title, titleColor = 'var(--text-muted)', defaultOpen = false, children }:
  { title: React.ReactNode; titleColor?: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card>
      <button onClick={() => setOpen((o) => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', background: 'none', border: 'none',
          padding: 0, cursor: 'pointer', color: titleColor, marginBottom: open ? 8 : 0 }}>
        <ChevronRight size={12} style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0 }} />
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase', fontFamily: 'Inter, sans-serif' }}>{title}</span>
      </button>
      {open && <div>{children}</div>}
    </Card>
  );
}

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 3, padding: '8px 10px',
      backgroundColor: 'var(--bg-tertiary)', borderRadius: 6, minWidth: 0,
    }}>
      <span style={{ fontSize: 8.5, fontWeight: 600, letterSpacing: '0.09em', textTransform: 'uppercase', color: 'var(--text-muted)', fontFamily: 'Inter, sans-serif' }}>{label}</span>
      <span className="tabular-nums" style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'JetBrains Mono, monospace', lineHeight: 1.1 }}>{value}</span>
      {hint && <span style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'Inter, sans-serif' }}>{hint}</span>}
    </div>
  );
}

// ─── página ──────────────────────────────────────────────────────────────────
//
// StrategyLive es la vista DECLARATIVA de la estrategia v1.4.0: qué es (Definición, leída del
// JSON de reglas) + qué hay abierto (Monitor de posiciones). La evaluación en vivo (correr la
// cascada de 4 capas) se movió a la tab RPF, que la consume del loop backend por SignalR —
// una sola fuente de verdad. Esta página ya NO corre fetchValidationLayer/PositionBuilder.

export function StrategyLive({ subscribeLeg, unsubscribeLeg, socketStatus }: Props) {
  const [rules, setRules] = useState<any | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Carga de reglas con reintento: si el fetch falla al montar, rules queda null y toda la
  // sección declarativa (gates, gestión) se vacía. Reintenta con backoff.
  useEffect(() => {
    let cancelled = false;
    const load = (attempt = 0) => {
      fetchCoreRulesRaw()
        .then((r) => { if (!cancelled) setRules(r); })
        .catch((e) => {
          if (cancelled) return;
          if (attempt < 3) setTimeout(() => load(attempt + 1), 1000 * (attempt + 1));
          else setErr(String(e?.message ?? e));
        });
    };
    load();
    return () => { cancelled = true; };
  }, []);

  const meta = rules?._meta;
  const l2cfg = rules?.position_builder?.layers?.find((l: any) => l.name === 'strike_engine')?.config;
  const delta = l2cfg?.delta_target;
  const width = l2cfg?.spread_width?.symbol_overrides?.[DEF_SYMBOL]?.default;
  const dte = l2cfg?.dte_selection?.target;
  const gatesDef = rules?.signal_gates?.gates ?? {};
  const tm = rules?.trade_management ?? {};

  return (
    <div style={{ padding: '14px 18px 40px', height: '100%', overflowY: 'auto', fontFamily: 'Inter, sans-serif' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>GaleCore Strategy</span>
        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4, letterSpacing: '0.06em',
          color: 'var(--blue-gc)', backgroundColor: tint('var(--blue-gc)', 13), border: `1px solid ${tint('var(--blue-gc)', 27)}`, fontFamily: 'JetBrains Mono, monospace' }}>
          v{meta?.version ?? '—'} · {meta?.status ?? '—'}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase',
          color: 'var(--text-muted)', fontFamily: 'Inter, sans-serif' }}>
          referencia · sin evaluación viva
        </span>
      </div>

      {err && <div style={{ color: 'var(--red-gc)', fontSize: 11, marginBottom: 12, fontFamily: 'JetBrains Mono, monospace' }}>⚠ {err}</div>}

      {/* ── SECCIÓN A: DEFINICIÓN ── */}
      <SectionTitle>A · Definición (v1.4.0 — fuente: JSON de reglas)</SectionTitle>
      <Card>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, marginBottom: 4 }}>
          <Stat label="Estructura" value="PCS-only" hint="put credit spread · riesgo definido" />
          <Stat label="Delta objetivo" value={delta ? `${delta.put_short_min}` : '0.25'} hint={delta ? `banda ${delta.put_short_min}–${delta.put_short_max}` : ''} />
          <Stat label={`Ancho (${DEF_SYMBOL})`} value={width != null ? `$${width}` : '$5'} hint="puntos" />
          <Stat label="DTE" value={dte ?? 45} hint="target" />
          <Stat label="Universo" value={(rules?.universe?.tickers ?? ['SPY', 'QQQ']).join(' · ')} />
        </div>
      </Card>

      <CollapsibleCard title="Embudo signal_gates (declaración)" titleColor="#a78bfa">
        {Object.entries(gatesDef).map(([id, def]: [string, any]) => {
          const thr = def.min ?? (def.min_usd != null ? `$${def.min_usd}` : undefined) ?? (def.bars_by_regime ? 'por régimen' : undefined);
          return (
            <div key={id} style={{ display: 'grid', gridTemplateColumns: '170px 1fr 70px', gap: 10, alignItems: 'center', padding: '5px 0', borderBottom: '1px solid var(--border-dark)' }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)' }}>{id}</span>
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{def.label ?? '—'}</span>
              <span style={{ fontSize: 10, fontWeight: 700, textAlign: 'right', fontFamily: 'JetBrains Mono, monospace',
                color: def.enabled ? 'var(--green)' : 'var(--text-muted)' }}>
                {def.enabled ? (thr ?? 'ON') : 'OFF'}
              </span>
            </div>
          );
        })}
        {Object.keys(gatesDef).length === 0 && <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '4px 0' }}>Reglas no cargadas.</div>}
      </CollapsibleCard>

      <CollapsibleCard title="Gestión de posición (B)" titleColor="var(--yellow-gc)">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
          {tm.take_profit?.pct_of_initial_credit != null && <Stat label="Take profit" value={`${Math.round(tm.take_profit.pct_of_initial_credit * 100)}%`} hint="del crédito inicial" />}
          {tm.defensive_roll?.trigger_unrealized_loss_pct_of_initial_credit_gte != null && <Stat label="Roll defensivo" value={`${Math.round(tm.defensive_roll.trigger_unrealized_loss_pct_of_initial_credit_gte * 100)}%`} hint="pérdida no realizada" />}
          {tm.time_exit?.dte_threshold != null && <Stat label="Salida por tiempo" value={`${tm.time_exit.dte_threshold} DTE`} />}
          {tm.hard_defense?.trigger_any?.short_leg_delta_abs_gt != null && <Stat label="Defensa dura" value={`Δ ${tm.hard_defense.trigger_any.short_leg_delta_abs_gt}`} hint="delta del short" />}
          {tm.daily_kill_switch?.daily_portfolio_mtm_loss_pct_net_liq_max != null && <Stat label="Kill switch" value={`${(tm.daily_kill_switch.daily_portfolio_mtm_loss_pct_net_liq_max * 100).toFixed(1)}%`} hint="MtM diario / NetLiq" />}
          {Object.keys(tm).length === 0 && <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '4px 0' }}>Reglas no cargadas.</div>}
        </div>
      </CollapsibleCard>

      {/* Puntero: la evaluación en vivo se movió a RPF (una sola fuente de verdad) */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 14px', marginBottom: 18, borderRadius: 8,
        backgroundColor: tint('#a78bfa', 8), border: `1px dashed ${tint('#a78bfa', 30)}`,
      }}>
        <Zap size={16} style={{ color: '#a78bfa', flexShrink: 0, marginTop: 1 }} />
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 3 }}>
            La evaluación en vivo se movió a la tab <span style={{ color: '#a78bfa' }}>RPF</span>
          </div>
          <div style={{ fontSize: 10.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            La cascada de 4 capas corre en el loop backend y se empuja por SignalR; el tablero RPF la
            consume en tiempo real con la máquina de estados. Una sola fuente de verdad — esta página
            ya no corre la evaluación por su cuenta.
          </div>
        </div>
      </div>

      {/* ── SECCIÓN B: MONITOR DE POSICIONES ── */}
      <SectionTitle>B · Monitor de posiciones</SectionTitle>
      <div style={{ border: '1px solid var(--border-dark)', borderRadius: 8, overflow: 'hidden', minHeight: 200 }}>
        <PositionMonitor subscribeLeg={subscribeLeg} unsubscribeLeg={unsubscribeLeg} socketStatus={socketStatus} />
      </div>
    </div>
  );
}

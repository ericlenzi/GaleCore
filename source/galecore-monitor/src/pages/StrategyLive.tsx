import React, { useEffect, useState, useCallback } from 'react';
import { RefreshCw } from 'lucide-react';
import { fetchCoreRulesRaw } from '../api/rules';
import { fetchValidationLayer } from '../api/analytics';
import { ValidationLayerApiResponse, GateResult } from '../types/api';
import { PositionMonitor } from '../components/positions/PositionMonitor';
import { ConnectionStatus } from '../socket/useMarketSocket';
import { signalColor } from '../utils/formatters';

interface Props {
  subscribeLeg: (sym: string) => void;
  unsubscribeLeg: (sym: string) => void;
  socketStatus: ConnectionStatus;
}

const LIVE_PROFILE = 'paper';
const DEFAULT_SYMBOLS = ['SPY', 'QQQ'];

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

const STATUS_COLOR: Record<string, string> = {
  pass: 'var(--green)', fail: 'var(--red-gc)', no_data: 'var(--yellow-gc)', skipped: 'var(--text-muted)',
};
const STATUS_LABEL: Record<string, string> = {
  pass: 'PASA', fail: 'FALLA', no_data: 'S/DATO', skipped: 'OFF',
};

function GateRow({ g }: { g: GateResult }) {
  const color = STATUS_COLOR[g.status] ?? 'var(--text-muted)';
  const fmt = (n: number | null) => (n == null ? '—' : Number.isInteger(n) ? `${n}` : n.toFixed(3));
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '150px 74px 1fr', gap: 10, alignItems: 'center',
      padding: '7px 0', borderBottom: '1px solid var(--border-dark)',
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'Inter, sans-serif' }}>{g.id}</span>
        <span style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'Inter, sans-serif' }}>{g.label}</span>
      </div>
      <span style={{
        fontSize: 9.5, fontWeight: 700, letterSpacing: '0.06em', textAlign: 'center',
        padding: '3px 6px', borderRadius: 4, fontFamily: 'JetBrains Mono, monospace',
        color, backgroundColor: color + '1e', border: `1px solid ${color}44`,
      }}>
        {STATUS_LABEL[g.status] ?? g.status}
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
        <span className="tabular-nums" style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'JetBrains Mono, monospace' }}>
          {fmt(g.value)}{g.threshold != null ? ` / ${fmt(g.threshold)}` : ''}
        </span>
        {g.detail && <span style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'Inter, sans-serif', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.detail}</span>}
      </div>
    </div>
  );
}

// ─── página ──────────────────────────────────────────────────────────────────

export function StrategyLive({ subscribeLeg, unsubscribeLeg, socketStatus }: Props) {
  const [rules, setRules] = useState<any | null>(null);
  const [vl, setVl] = useState<ValidationLayerApiResponse | null>(null);
  const [loadingVl, setLoadingVl] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [liveSymbol, setLiveSymbol] = useState('SPY');

  useEffect(() => {
    fetchCoreRulesRaw().then(setRules).catch((e) => setErr(String(e?.message ?? e)));
  }, []);

  const loadLive = useCallback(() => {
    setLoadingVl(true);
    setVl(null);
    fetchValidationLayer(liveSymbol, LIVE_PROFILE)
      .then(setVl)
      .catch((e) => setErr(String(e?.message ?? e)))
      .finally(() => setLoadingVl(false));
  }, [liveSymbol]);

  useEffect(() => { loadLive(); }, [loadLive]);

  const meta = rules?._meta;
  const symbols: string[] = rules?.universe?.tickers ?? DEFAULT_SYMBOLS;
  const l2cfg = rules?.position_builder?.layers?.find((l: any) => l.name === 'strike_engine')?.config;
  const delta = l2cfg?.delta_target;
  const width = l2cfg?.spread_width?.symbol_overrides?.[liveSymbol]?.default;
  const dte = l2cfg?.dte_selection?.target;
  const gatesDef = rules?.signal_gates?.gates ?? {};
  const tm = rules?.trade_management ?? {};

  const gates: GateResult[] = vl?.positionBuilder?.signalGates?.gates ?? [];
  const overall = vl?.overallSignal ?? '—';
  const macro = vl?.macroRegime;

  return (
    <div style={{ padding: '14px 18px 40px', height: '100%', overflowY: 'auto', fontFamily: 'Inter, sans-serif' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>GaleCore Strategy</span>
        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4, letterSpacing: '0.06em',
          color: 'var(--blue-gc)', backgroundColor: 'var(--blue-gc)22', border: '1px solid var(--blue-gc)44', fontFamily: 'JetBrains Mono, monospace' }}>
          v{meta?.version ?? '—'} · {meta?.status ?? '—'}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', padding: '4px 12px', borderRadius: 5,
          color: signalColor(overall), backgroundColor: signalColor(overall) + '22', border: `1px solid ${signalColor(overall)}44`,
          fontFamily: 'JetBrains Mono, monospace' }}>
          {liveSymbol}: {overall}
        </span>
        <button onClick={loadLive} title="Refrescar evaluación en vivo"
          style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 5, cursor: 'pointer', color: 'var(--text-muted)', padding: 5, display: 'flex' }}>
          <RefreshCw size={13} className={loadingVl ? 'animate-spin' : undefined} />
        </button>
      </div>

      {err && <div style={{ color: 'var(--red-gc)', fontSize: 11, marginBottom: 12, fontFamily: 'JetBrains Mono, monospace' }}>⚠ {err}</div>}

      {/* ── SECCIÓN A: DEFINICIÓN ── */}
      <SectionTitle>A · Definición (v1.4.0 — fuente: JSON de reglas)</SectionTitle>
      <Card>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, marginBottom: 4 }}>
          <Stat label="Estructura" value="PCS-only" hint="put credit spread · riesgo definido" />
          <Stat label="Delta objetivo" value={delta ? `${delta.put_short_min}` : '0.25'} hint={delta ? `banda ${delta.put_short_min}–${delta.put_short_max}` : ''} />
          <Stat label={`Ancho (${liveSymbol})`} value={width != null ? `$${width}` : '$5'} hint="puntos" />
          <Stat label="DTE" value={dte ?? 45} hint="target" />
          <Stat label="Universo" value={(rules?.universe?.tickers ?? ['SPY', 'QQQ']).join(' · ')} />
        </div>
      </Card>

      <Card>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase', color: '#a78bfa', marginBottom: 8 }}>
          Embudo signal_gates (declaración)
        </div>
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
      </Card>

      <Card>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase', color: 'var(--yellow-gc)', marginBottom: 8 }}>
          Gestión de posición (B)
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
          {tm.take_profit?.pct_of_initial_credit != null && <Stat label="Take profit" value={`${Math.round(tm.take_profit.pct_of_initial_credit * 100)}%`} hint="del crédito inicial" />}
          {tm.defensive_roll?.trigger_unrealized_loss_pct_of_initial_credit_gte != null && <Stat label="Roll defensivo" value={`${Math.round(tm.defensive_roll.trigger_unrealized_loss_pct_of_initial_credit_gte * 100)}%`} hint="pérdida no realizada" />}
          {tm.time_exit?.dte_threshold != null && <Stat label="Salida por tiempo" value={`${tm.time_exit.dte_threshold} DTE`} />}
          {tm.hard_defense?.trigger_any?.short_leg_delta_abs_gt != null && <Stat label="Defensa dura" value={`Δ ${tm.hard_defense.trigger_any.short_leg_delta_abs_gt}`} hint="delta del short" />}
          {tm.daily_kill_switch?.daily_portfolio_mtm_loss_pct_net_liq_max != null && <Stat label="Kill switch" value={`${(tm.daily_kill_switch.daily_portfolio_mtm_loss_pct_net_liq_max * 100).toFixed(1)}%`} hint="MtM diario / NetLiq" />}
        </div>
      </Card>

      {/* ── SECCIÓN B: EVALUACIÓN EN VIVO ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '2px 0 8px', borderBottom: '1px solid var(--border-dark)', marginBottom: 10 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text-muted)', fontFamily: 'Inter, sans-serif' }}>
          B · Evaluación en vivo (perfil {LIVE_PROFILE})
        </span>
        <div style={{ display: 'flex', gap: 2, marginLeft: 'auto', backgroundColor: 'var(--bg-tertiary)', borderRadius: 6, padding: 2 }}>
          {symbols.map((s) => {
            const active = s === liveSymbol;
            return (
              <button key={s} onClick={() => setLiveSymbol(s)}
                style={{
                  fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', padding: '3px 12px', borderRadius: 4,
                  border: 'none', cursor: 'pointer', fontFamily: 'JetBrains Mono, monospace',
                  color: active ? 'var(--bg-primary)' : 'var(--text-muted)',
                  backgroundColor: active ? 'var(--blue-gc)' : 'transparent',
                }}>
                {s}
              </button>
            );
          })}
        </div>
      </div>
      <Card>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <Stat label="Macro regime"
            value={macro ? `${macro.passedCount}/${macro.totalChecks}` : '—'}
            hint={macro?.signal ?? (loadingVl ? 'cargando…' : 'sin datos')} />
          <Stat label="Estructura" value={vl?.positionBuilder?.strikeEngine?.selectedStructure === 'put_credit_spread' ? 'PCS' : (vl?.positionBuilder?.strikeEngine?.selectedStructure ?? '—')} />
          <Stat label="Short put"
            value={vl?.positionBuilder?.strikeEngine?.shortPutStrike ?? '—'}
            hint={vl?.positionBuilder?.strikeEngine?.shortPutDelta != null ? `Δ ${Math.abs(vl.positionBuilder.strikeEngine.shortPutDelta).toFixed(2)}` : ''} />
          <Stat label="Gates"
            value={vl?.positionBuilder?.signalGates ? (vl.positionBuilder.signalGates.allPass ? '✓ todos' : `✗ ${vl.positionBuilder.signalGates.failedGate}`) : '—'} />
        </div>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase', color: '#a78bfa', marginBottom: 4 }}>
          Embudo signal_gates (en vivo)
        </div>
        {gates.length > 0
          ? gates.map((g) => <GateRow key={g.id} g={g} />)
          : <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '8px 0' }}>
              {loadingVl ? 'Evaluando…' : 'La señal no llegó al embudo (falló una capa previa o el mercado no está operable).'}
            </div>}
      </Card>

      {/* ── SECCIÓN C: MONITOR DE POSICIONES ── */}
      <SectionTitle>C · Monitor de posiciones</SectionTitle>
      <div style={{ border: '1px solid var(--border-dark)', borderRadius: 8, overflow: 'hidden', minHeight: 200 }}>
        <PositionMonitor subscribeLeg={subscribeLeg} unsubscribeLeg={unsubscribeLeg} socketStatus={socketStatus} />
      </div>
    </div>
  );
}

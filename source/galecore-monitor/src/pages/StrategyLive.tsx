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

type LineStatus = 'pass' | 'fail' | 'no_data' | 'skipped';

// Fila genérica de check: nombre + label · badge de estado · valor/umbral + detalle.
// La comparten el macro_regime (Layer 1) y el embudo signal_gates.
function CheckLine({ name, label, status, valueText, detail }: {
  name: string; label: string; status: LineStatus; valueText?: string; detail?: string | null;
}) {
  const color = STATUS_COLOR[status] ?? 'var(--text-muted)';
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '150px 74px 1fr', gap: 10, alignItems: 'center',
      padding: '7px 0', borderBottom: '1px solid var(--border-dark)',
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'Inter, sans-serif' }}>{name}</span>
        <span style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'Inter, sans-serif' }}>{label}</span>
      </div>
      <span style={{
        fontSize: 9.5, fontWeight: 700, letterSpacing: '0.06em', textAlign: 'center',
        padding: '3px 6px', borderRadius: 4, fontFamily: 'JetBrains Mono, monospace',
        color, backgroundColor: color + '1e', border: `1px solid ${color}44`,
      }}>
        {STATUS_LABEL[status] ?? status}
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
        {valueText && <span className="tabular-nums" style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'JetBrains Mono, monospace' }}>{valueText}</span>}
        {detail && <span style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'Inter, sans-serif', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{detail}</span>}
      </div>
    </div>
  );
}

function GateRow({ g }: { g: GateResult }) {
  const fmt = (n: number | null) => (n == null ? '—' : Number.isInteger(n) ? `${n}` : n.toFixed(3));
  return (
    <CheckLine
      name={g.id}
      label={g.label}
      status={g.status}
      valueText={`${fmt(g.value)}${g.threshold != null ? ` / ${fmt(g.threshold)}` : ''}`}
      detail={g.detail}
    />
  );
}

// ─── cascada: stepper de 5 stages (orden real de evaluación del backend) ────────

type StageStatus = 'pass' | 'fail' | 'wait' | 'warn' | 'idle';

const STAGE_COLOR: Record<StageStatus, string> = {
  pass: 'var(--green)', fail: 'var(--red-gc)', warn: 'var(--yellow-gc)',
  wait: 'var(--text-muted)', idle: 'var(--text-muted)',
};

interface CascadeStage { key: string; label: string; status: StageStatus }

// failedAtLayer del backend → etiqueta legible. La capa 2 cubre strike engine + gates.
const DIED_AT_LABEL: Record<number, string> = {
  1: 'falló en Layer 1 (macro regime)',
  2: 'falló en Layer 2 (strike engine / signal gates)',
  3: 'falló en Layer 3 (microestructura)',
  4: 'falló en Layer 4 (riesgo y sizing)',
};

// semáforo regla 1/3 (credit ratio en %): verde ≥33.3, amarillo ≥25, rojo <25
function creditRatioColor(ratio: number | null | undefined): string {
  if (ratio == null) return 'var(--text-primary)';
  if (ratio >= 33.3) return 'var(--green)';
  if (ratio >= 25) return 'var(--yellow-gc)';
  return 'var(--red-gc)';
}

function computeStages(vl: ValidationLayerApiResponse | null, loading: boolean): CascadeStage[] {
  const idle = (label: string, key: string): CascadeStage => ({ key, label, status: loading ? 'wait' : 'idle' });
  if (!vl) return [
    idle('Macro', 'macro'), idle('Strikes', 'strikes'), idle('Micro', 'micro'),
    idle('Riesgo', 'risk'), idle('Gates', 'gates'),
  ];
  const macro = vl.macroRegime;
  const pb = vl.positionBuilder;
  const se = pb?.strikeEngine;
  const ms = pb?.microstructure;
  const rs = pb?.riskAndSizing;
  const sg = pb?.signalGates;

  const st = (present: boolean, failed: boolean): StageStatus => (!present ? 'wait' : failed ? 'fail' : 'pass');

  return [
    { key: 'macro', label: 'Macro', status: !macro ? 'wait' : macro.signal === 'NO_OPERAR' ? 'fail' : macro.signal === 'ESPERAR' ? 'warn' : 'pass' },
    { key: 'strikes', label: 'Strikes', status: st(!!se, se?.signal === 'NO_OPERAR') },
    { key: 'micro', label: 'Micro', status: st(!!ms, ms?.signal === 'NO_OPERAR') },
    { key: 'risk', label: 'Riesgo', status: st(!!rs, rs?.signal === 'NO_OPERAR') },
    { key: 'gates', label: 'Gates', status: st(!!sg, sg ? !sg.allPass : false) },
  ];
}

function StageIcon({ status }: { status: StageStatus }) {
  if (status === 'pass') return <span>✓</span>;
  if (status === 'fail') return <span>✗</span>;
  if (status === 'warn') return <span>!</span>;
  return <span>·</span>;
}

function CascadeStepper({ vl, loading }: { vl: ValidationLayerApiResponse | null; loading: boolean }) {
  const stages = computeStages(vl, loading);
  return (
    <div style={{ display: 'flex', alignItems: 'stretch', gap: 0, marginBottom: 14 }}>
      {stages.map((s, i) => {
        const color = STAGE_COLOR[s.status];
        const dim = s.status === 'wait' || s.status === 'idle';
        return (
          <React.Fragment key={s.key}>
            <div style={{
              flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
              padding: '9px 4px', borderRadius: 7,
              backgroundColor: dim ? 'var(--bg-tertiary)' : `color-mix(in srgb, ${color} 13%, transparent)`,
              border: `1px solid ${dim ? 'var(--border-dark)' : `color-mix(in srgb, ${color} 45%, transparent)`}`,
              opacity: s.status === 'idle' ? 0.5 : 1,
            }}>
              <div style={{
                width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace',
                color: dim ? 'var(--text-muted)' : 'var(--bg-primary)',
                backgroundColor: dim ? 'transparent' : color,
                border: `1.5px solid ${dim ? 'var(--border)' : color}`,
              }}>
                <StageIcon status={s.status} />
              </div>
              <span style={{
                fontSize: 9.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
                color: dim ? 'var(--text-muted)' : color, fontFamily: 'Inter, sans-serif',
              }}>
                {s.label}
              </span>
            </div>
            {i < stages.length - 1 && (
              <div style={{ display: 'flex', alignItems: 'center', padding: '0 3px', color: 'var(--text-muted)', fontSize: 12 }}>›</div>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// mapea macroRegime.checks (6 checks del Layer 1) a líneas de check
function macroCheckLines(macro: ValidationLayerApiResponse['macroRegime']): Array<{ name: string; label: string; status: LineStatus; valueText: string }> {
  if (!macro) return [];
  const c = macro.checks;
  const n1 = (v: number | null | undefined, d = 1) => (v == null ? '—' : v.toFixed(d));
  const stat = (p: boolean): LineStatus => (p ? 'pass' : 'fail');
  return [
    { name: 'VIX', label: 'VIX < 30', status: stat(c.vixAbsolute.passed), valueText: `${n1(c.vixAbsolute.value)} / < ${c.vixAbsolute.threshold}` },
    { name: 'VIX term', label: 'VIX9D < VIX30D (contango)', status: stat(c.vixTermStructure.passed), valueText: `${n1(c.vixTermStructure.iv9d)} vs ${n1(c.vixTermStructure.iv30d)}` },
    { name: 'IV Rank', label: `entre ${c.ivRank.min}–${c.ivRank.max}`, status: stat(c.ivRank.passed), valueText: `${n1(c.ivRank.value, 0)} / ${c.ivRank.min}–${c.ivRank.max}` },
    { name: 'IV RoC', label: `momentum ≤ ${c.ivMomentum.threshold}%`, status: stat(c.ivMomentum.passed), valueText: `${n1(c.ivMomentum.value)}% / ≤ ${c.ivMomentum.threshold}%` },
    { name: 'GEX', label: 'gamma ≥ umbral', status: stat(c.gexTotal.passed), valueText: `${n1(c.gexTotal.value)}B / ≥ ${c.gexTotal.threshold}` },
    { name: 'Spot vs ZGL', label: `spot > ZGL +${(c.spotVsZgl.bufferPct * 100).toFixed(1)}%`, status: stat(c.spotVsZgl.passed), valueText: `${n1(c.spotVsZgl.spot, 2)} / ${n1(c.spotVsZgl.zgl, 2)}` },
  ];
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
  const se = vl?.positionBuilder?.strikeEngine;

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
      {/* Cascada: mapa de dónde está la señal en el embudo */}
      <CascadeStepper vl={vl} loading={loadingVl} />
      {vl && vl.failedAtLayer != null && (
        <div style={{
          fontSize: 10.5, fontWeight: 600, color: 'var(--red-gc)', fontFamily: 'Inter, sans-serif',
          padding: '6px 10px', marginBottom: 12, borderRadius: 6,
          backgroundColor: 'color-mix(in srgb, var(--red-gc) 11%, transparent)', border: '1px solid color-mix(in srgb, var(--red-gc) 33%, transparent)',
        }}>
          Señal detenida — {DIED_AT_LABEL[vl.failedAtLayer] ?? `capa ${vl.failedAtLayer}`}
        </div>
      )}

      {/* Layer 1 — Macro regime (6 checks) */}
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase', color: 'var(--blue-gc)' }}>
            Layer 1 · Macro regime
          </span>
          {macro && <span style={{ fontSize: 10, fontWeight: 700, marginLeft: 'auto', fontFamily: 'JetBrains Mono, monospace',
            color: macro.signal === 'NO_OPERAR' ? 'var(--red-gc)' : macro.signal === 'ESPERAR' ? 'var(--yellow-gc)' : 'var(--green)' }}>
            {macro.passedCount}/{macro.totalChecks} · {macro.signal}
          </span>}
        </div>
        {macro
          ? macroCheckLines(macro).map((l) => <CheckLine key={l.name} {...l} />)
          : <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '8px 0' }}>{loadingVl ? 'Evaluando…' : 'Sin datos.'}</div>}
      </Card>

      {/* Layer 2 — Strike engine (snapshot) */}
      {se && se.shortPutStrike != null && (
        <Card>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase', color: 'var(--blue-gc)', marginBottom: 8 }}>
            Layer 2 · Strike engine
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8 }}>
            <Stat label="Estructura" value={se.selectedStructure === 'put_credit_spread' ? 'PCS' : se.selectedStructure} hint={`DTE ${se.dte} · ${se.expiration}`} />
            <Stat label="Spread" value={se.longPutStrike != null ? `${se.longPutStrike} / ${se.shortPutStrike}` : `${se.shortPutStrike}`}
              hint={se.shortPutDelta != null ? `Δ short ${Math.abs(se.shortPutDelta).toFixed(2)}` : ''} />
            <Stat label="Expected move" value={se.expectedMove != null ? `±${se.expectedMove.toFixed(2)}` : '—'} hint={`z ${se.zScore?.toFixed(2) ?? '—'}`} />
            <Stat label="1/3 Rule"
              value={<span style={{ color: creditRatioColor(se.creditRatio) }}>{se.creditRatio != null ? `${se.creditRatio.toFixed(1)}%` : '—'}</span>}
              hint="credit / width" />
            <Stat label="POP" value={se.pop != null ? `${se.pop.toFixed(0)}%` : '—'} hint="1 − |Δ|" />
            <Stat label="Put wall" value={se.putWall ?? '—'} hint={`call wall ${se.callWall ?? '—'}`} />
          </div>
        </Card>
      )}

      {/* Signal gates — el embudo de research */}
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase', color: '#a78bfa' }}>
            Embudo signal_gates (en vivo)
          </span>
          {vl?.positionBuilder?.signalGates && (
            <span style={{ fontSize: 10, fontWeight: 700, marginLeft: 'auto', fontFamily: 'JetBrains Mono, monospace',
              color: vl.positionBuilder.signalGates.allPass ? 'var(--green)' : 'var(--red-gc)' }}>
              {vl.positionBuilder.signalGates.allPass ? '✓ todos' : `✗ ${vl.positionBuilder.signalGates.failedGate}`}
            </span>
          )}
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

import React, { useEffect, useState, useCallback } from 'react';
import { RefreshCw, ChevronRight } from 'lucide-react';
import { fetchCoreRulesRaw } from '../api/rules';
import { fetchValidationLayer, fetchPositionBuilder } from '../api/analytics';
import {
  ValidationLayerApiResponse, GateResult, PositionBuilderApiResponse,
  StrikeEngineResult, MicrostructureResult, RiskAndSizingResult,
} from '../types/api';
import { PositionMonitor } from '../components/positions/PositionMonitor';
import { ConnectionStatus } from '../socket/useMarketSocket';
import { signalColor, tint } from '../utils/formatters';

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
        color, backgroundColor: tint(color, 12), border: `1px solid ${tint(color, 27)}`,
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
              backgroundColor: dim ? 'var(--bg-tertiary)' : tint(color, 13),
              border: `1px solid ${dim ? 'var(--border-dark)' : tint(color, 45)}`,
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

interface CheckLineData { name: string; label: string; status: LineStatus; valueText?: string; detail?: string | null }

// Layer 3 (microstructure) → líneas de check. Usa los booleanos que ya computó la API.
function microCheckLines(m: MicrostructureResult): CheckLineData[] {
  const out: CheckLineData[] = [];
  const st = (p: boolean): LineStatus => (p ? 'pass' : 'fail');
  const oi = m.oiChecks;
  const oiRow = (leg: string, c: { passed: boolean; value: number; minRequired: number } | null) =>
    c && out.push({ name: `OI ${leg}`, label: `≥ ${c.minRequired}`, status: st(c.passed), valueText: `${c.value} / ≥ ${c.minRequired}` });
  oiRow('short put', oi.shortPut); oiRow('long put', oi.longPut);
  oiRow('short call', oi.shortCall); oiRow('long call', oi.longCall);
  const ba = m.bidAskChecks;
  const baRow = (leg: string, c: { passed: boolean; spreadPct: number | null; maxAllowed: number } | null) =>
    c && out.push({ name: `B/A ${leg}`, label: `≤ ${(c.maxAllowed * 100).toFixed(0)}% mid`, status: st(c.passed),
      valueText: `${c.spreadPct != null ? (c.spreadPct * 100).toFixed(1) : '—'}% / ≤ ${(c.maxAllowed * 100).toFixed(0)}%` });
  if (ba) { baRow('short put', ba.shortPut); baRow('long put', ba.longPut); baRow('short call', ba.shortCall); baRow('long call', ba.longCall); }
  if (m.creditMinimum)
    out.push({ name: 'Crédito spread', label: `≥ $${m.creditMinimum.minRequired.toFixed(2)}`, status: st(m.creditMinimum.passed),
      valueText: `$${m.creditMinimum.midCredit.toFixed(2)} / ≥ $${m.creditMinimum.minRequired.toFixed(2)}` });
  return out;
}

// Layer 4 (risk & sizing) → líneas de check. Usa positionsAvailable/heatOk de la API.
function riskCheckLines(r: RiskAndSizingResult): CheckLineData[] {
  const st = (p: boolean): LineStatus => (p ? 'pass' : 'fail');
  return [
    { name: 'Contratos máx', label: '≥ 1', status: st(r.contracts >= 1), valueText: `${r.contracts} / ≥ 1` },
    { name: 'Slots', label: 'disponibles ≥ 1', status: st(r.positionsAvailable), valueText: `${r.openPositions}/${r.maxPositions} · máx` },
    { name: 'Heat total', label: `≤ ${(r.maxHeatPct * 100).toFixed(1)}% NL`, status: st(r.heatOk),
      valueText: `${(r.currentHeatPct * 100).toFixed(1)}% / ≤ ${(r.maxHeatPct * 100).toFixed(1)}%` },
  ];
}

// Labels de los checks de una capa del JSON de reglas — para el estado "por evaluar".
function layerCheckLabels(rules: any, layerName: string): string[] {
  const layer = rules?.position_builder?.layers?.find((l: any) => l.name === layerName);
  return (layer?.checks ?? []).map((c: any) => c.label).filter(Boolean);
}

// Checks del strike_engine RELEVANTES a la estructura activa.
// El JSON declara los 9 (put + call + skew_degradation) para las 3 estructuras, pero en
// PCS-only (producción) solo corre el lado put. Los de call + skew son de IC/CCS (disabled).
function strikeEngineCheckLabels(rules: any, structure: string | null | undefined): string[] {
  const layer = rules?.position_builder?.layers?.find((l: any) => l.name === 'strike_engine');
  const checks: any[] = layer?.checks ?? [];
  const isIC = structure === 'iron_condor';
  const side = structure === 'call_credit_spread' ? 'call' : 'put'; // default PCS → put
  return checks
    .filter((c) => {
      if (c.id === 'skew_degradation') return isIC;   // solo aplica degradando un IC
      if (isIC) return true;                           // IC evalúa ambos lados
      return c.side === side;                          // PCS/CCS: un solo lado
    })
    .map((c) => c.label)
    .filter(Boolean);
}

// Estado "por evaluar": lista los checks que la capa correría, en gris.
function PendingChecklist({ labels, loading }: { labels: string[]; loading: boolean }) {
  if (loading) return <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '8px 0' }}>Evaluando…</div>;
  if (labels.length === 0) return <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '8px 0' }}>No evaluado — la cascada cortó antes.</div>;
  return (
    <>
      {labels.map((l) => (
        <div key={l} style={{ display: 'grid', gridTemplateColumns: '1fr 74px', gap: 10, alignItems: 'center', padding: '7px 0', borderBottom: '1px solid var(--border-dark)' }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'Inter, sans-serif' }}>{l}</span>
          <span style={{ fontSize: 9.5, fontWeight: 700, textAlign: 'center', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.06em' }}>POR EVAL.</span>
        </div>
      ))}
    </>
  );
}

// Lista neutra de "qué evalúa" una capa (sin pass/fail — la API no lo expone para Layer 2).
function RefChecklist({ labels }: { labels: string[] }) {
  if (labels.length === 0) return null;
  return (
    <div>
      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', margin: '2px 0 4px' }}>checks que corre</div>
      {labels.map((l) => (
        <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0', borderBottom: '1px solid var(--border-dark)' }}>
          <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>›</span>
          <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'Inter, sans-serif' }}>{l}</span>
        </div>
      ))}
    </div>
  );
}

// Card de capa con header (nombre + status opcional a la derecha).
function LayerCard({ title, titleColor = 'var(--blue-gc)', status, children }:
  { title: string; titleColor?: string; status?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase', color: titleColor }}>{title}</span>
        {status != null && <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace' }}>{status}</span>}
      </div>
      {children}
    </Card>
  );
}

// Panel de la posición candidata que evalúan Layer 2-4 y los gates.
// Fuente: strikeEngine (de la cascada o, si macro cortó, del motor macro-independiente PositionBuilder).
function CandidatePanel({ se, spot, fromCascade }: { se: StrikeEngineResult; spot: number | null; fromCascade: boolean }) {
  const shortOI = se.legMeta?.shortPut?.openInterest;
  const longOI = se.legMeta?.longPut?.openInterest;
  const box = (label: string, value: React.ReactNode, hint?: string, accent?: boolean): React.ReactNode => (
    <div style={{ flex: 1, padding: '7px 8px', backgroundColor: 'var(--bg-tertiary)', borderRadius: 6, textAlign: 'center',
      border: accent ? `1px solid ${tint('var(--red-gc)', 40)}` : '1px solid transparent' }}>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'Inter, sans-serif' }}>{label}</div>
      <div className="tabular-nums" style={{ fontSize: 14, fontWeight: 700, marginTop: 2, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-primary)' }}>{value}</div>
      {hint && <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'Inter, sans-serif' }}>{hint}</div>}
    </div>
  );
  const mini = (label: string, value: React.ReactNode, color?: string): React.ReactNode => (
    <div style={{ padding: 6, backgroundColor: 'var(--bg-tertiary)', borderRadius: 6 }}>
      <div style={{ fontSize: 9.5, color: 'var(--text-muted)', fontFamily: 'Inter, sans-serif' }}>{label}</div>
      <div className="tabular-nums" style={{ fontSize: 12, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace', color: color ?? 'var(--text-primary)' }}>{value}</div>
    </div>
  );
  return (
    <div style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px', marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase', color: '#a78bfa' }}>Posición candidata en evaluación</span>
        <span style={{ marginLeft: 'auto', fontSize: 9, color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
          {fromCascade ? 'de la cascada' : 'motor · sin cortocircuito'}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        {box('Long put', se.longPutStrike ?? '—', longOI != null ? `OI ${longOI}` : undefined)}
        {box('Short put', se.shortPutStrike ?? '—', `${se.shortPutDelta != null ? `Δ ${Math.abs(se.shortPutDelta).toFixed(2)}` : ''}${shortOI != null ? ` · OI ${shortOI}` : ''}`, true)}
        {box('Spot', spot != null ? spot.toFixed(2) : '—', `wall ${se.putWall ?? '—'}/${se.callWall ?? '—'}`)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6 }}>
        {mini('DTE', se.dte ?? '—')}
        {mini('Estructura', se.selectedStructure === 'put_credit_spread' ? 'PCS' : (se.selectedStructure ?? '—'))}
        {mini('1/3 Rule', se.creditRatio != null ? `${se.creditRatio.toFixed(1)}%` : '—', creditRatioColor(se.creditRatio))}
        {mini('POP', se.pop != null ? `${se.pop.toFixed(0)}%` : '—')}
        {mini('EM', se.expectedMove != null ? `±${se.expectedMove.toFixed(1)}` : '—')}
      </div>
    </div>
  );
}

// ─── página ──────────────────────────────────────────────────────────────────

export function StrategyLive({ subscribeLeg, unsubscribeLeg, socketStatus }: Props) {
  const [rules, setRules] = useState<any | null>(null);
  const [vl, setVl] = useState<ValidationLayerApiResponse | null>(null);
  const [pb, setPb] = useState<PositionBuilderApiResponse | null>(null);
  const [loadingVl, setLoadingVl] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [liveSymbol, setLiveSymbol] = useState('SPY');

  // Carga de reglas con reintento: si el fetch falla al montar, rules queda null y toda la
  // sección declarativa (gates, gestión, checklists de layers) se vacía. Reintenta con backoff.
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

  const loadLive = useCallback(() => {
    setLoadingVl(true);
    setVl(null);
    setPb(null);
    setErr(null);
    // Recuperación: si rules no cargó al montar, el refresh lo reintenta (rápido, independiente).
    fetchCoreRulesRaw().then(setRules).catch(() => {});
    // Cascada (cortocircuitante) + motor macro-independiente en paralelo. El segundo puebla
    // la posición candidata y Layer 2 aunque macro corte la cascada. allSettled: uno no tumba al otro.
    Promise.allSettled([
      fetchValidationLayer(liveSymbol, LIVE_PROFILE),
      fetchPositionBuilder(liveSymbol, LIVE_PROFILE),
    ])
      .then(([vlRes, pbRes]) => {
        if (vlRes.status === 'fulfilled') setVl(vlRes.value);
        else setErr(String(vlRes.reason?.message ?? vlRes.reason));
        if (pbRes.status === 'fulfilled') setPb(pbRes.value);
      })
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

  // Fuentes efectivas: cascada si llegó, si no el motor macro-independiente (pb).
  const seFromCascade = !!vl?.positionBuilder?.strikeEngine;
  const se = vl?.positionBuilder?.strikeEngine ?? pb?.strikeEngine ?? null;
  const micro = vl?.positionBuilder?.microstructure ?? pb?.microstructure ?? null;
  const risk = vl?.positionBuilder?.riskAndSizing ?? pb?.riskAndSizing ?? null;
  const spot = vl?.spotPrice ?? pb?.spotPrice ?? null;

  return (
    <div style={{ padding: '14px 18px 40px', height: '100%', overflowY: 'auto', fontFamily: 'Inter, sans-serif' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>GaleCore Strategy</span>
        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4, letterSpacing: '0.06em',
          color: 'var(--blue-gc)', backgroundColor: tint('var(--blue-gc)', 13), border: `1px solid ${tint('var(--blue-gc)', 27)}`, fontFamily: 'JetBrains Mono, monospace' }}>
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
          backgroundColor: tint('var(--red-gc)', 11), border: `1px solid ${tint('var(--red-gc)', 33)}`,
        }}>
          Señal detenida — {DIED_AT_LABEL[vl.failedAtLayer] ?? `capa ${vl.failedAtLayer}`}
        </div>
      )}

      {/* Posición candidata que evalúan Layer 2-4 y los gates */}
      {se && se.shortPutStrike != null
        ? <CandidatePanel se={se} spot={spot} fromCascade={seFromCascade} />
        : <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '10px 12px', marginBottom: 14, border: '1px dashed var(--border-dark)', borderRadius: 8 }}>
            {loadingVl ? 'Construyendo posición candidata…' : 'El motor no propuso una posición candidata (ningún lado pasó la selección de strikes).'}
          </div>}

      {/* Layer 1 — Macro regime */}
      <LayerCard title="Layer 1 · Macro regime"
        status={macro && <span style={{ color: macro.signal === 'NO_OPERAR' ? 'var(--red-gc)' : macro.signal === 'ESPERAR' ? 'var(--yellow-gc)' : 'var(--green)' }}>{macro.passedCount}/{macro.totalChecks} · {macro.signal}</span>}>
        {macro
          ? macroCheckLines(macro).map((l) => <CheckLine key={l.name} {...l} />)
          : <PendingChecklist labels={(rules?.macro_regime?.checks ?? []).map((c: any) => c.label)} loading={loadingVl} />}
      </LayerCard>

      {/* Layer 2 — Strike engine */}
      <LayerCard title="Layer 2 · Strike engine"
        status={se && <span style={{ color: 'var(--text-muted)' }}>{se.selectedStructure === 'put_credit_spread' ? 'PCS' : se.selectedStructure} · DTE {se.dte}{seFromCascade ? '' : ' · candidato'}</span>}>
        {se
          ? <RefChecklist labels={strikeEngineCheckLabels(rules, se.selectedStructure)} />
          : <PendingChecklist labels={strikeEngineCheckLabels(rules, pb?.selectedStructure?.output ?? 'put_credit_spread')} loading={loadingVl} />}
      </LayerCard>

      {/* Layer 3 — Microestructura */}
      <LayerCard title="Layer 3 · Microestructura"
        status={micro && <span style={{ color: micro.signal === 'NO_OPERAR' ? 'var(--red-gc)' : 'var(--green)' }}>{micro.signal}</span>}>
        {micro
          ? microCheckLines(micro).map((l) => <CheckLine key={l.name} {...l} />)
          : <PendingChecklist labels={layerCheckLabels(rules, 'microstructure')} loading={loadingVl} />}
      </LayerCard>

      {/* Layer 4 — Riesgo y sizing */}
      <LayerCard title="Layer 4 · Riesgo y sizing"
        status={risk && <span style={{ color: risk.signal === 'NO_OPERAR' ? 'var(--red-gc)' : 'var(--green)' }}>{risk.signal}</span>}>
        {risk
          ? riskCheckLines(risk).map((l) => <CheckLine key={l.name} {...l} />)
          : <PendingChecklist labels={layerCheckLabels(rules, 'risk_and_sizing')} loading={loadingVl} />}
      </LayerCard>

      {/* Signal gates — el embudo de research */}
      <LayerCard title="Embudo signal_gates" titleColor="#a78bfa"
        status={vl?.positionBuilder?.signalGates && <span style={{ color: vl.positionBuilder.signalGates.allPass ? 'var(--green)' : 'var(--red-gc)' }}>{vl.positionBuilder.signalGates.allPass ? '✓ todos' : `✗ ${vl.positionBuilder.signalGates.failedGate}`}</span>}>
        {gates.length > 0
          ? gates.map((g) => <GateRow key={g.id} g={g} />)
          : <PendingChecklist labels={Object.entries(gatesDef).filter((e) => (e[1] as any).enabled).map((e) => (e[1] as any).label ?? e[0])} loading={loadingVl} />}
      </LayerCard>

      {/* ── SECCIÓN C: MONITOR DE POSICIONES ── */}
      <SectionTitle>C · Monitor de posiciones</SectionTitle>
      <div style={{ border: '1px solid var(--border-dark)', borderRadius: 8, overflow: 'hidden', minHeight: 200 }}>
        <PositionMonitor subscribeLeg={subscribeLeg} unsubscribeLeg={unsubscribeLeg} socketStatus={socketStatus} />
      </div>
    </div>
  );
}

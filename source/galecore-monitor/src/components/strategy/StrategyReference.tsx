import React from 'react';
import { useRulesStore } from '../../store/useRulesStore';

/* ──────────────── helpers ──────────────── */

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2
      className="text-xs font-semibold uppercase tracking-widest mb-2 pt-1"
      style={{ color: 'var(--blue-gc)' }}
    >
      {children}
    </h2>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded p-4 mb-4"
      style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-dark)' }}
    >
      {children}
    </div>
  );
}

function TH({ children }: { children: React.ReactNode }) {
  return (
    <th
      className="px-3 py-1.5 text-left text-xs uppercase tracking-wider font-medium"
      style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border-dark)' }}
    >
      {children}
    </th>
  );
}

function TD({ children, mono }: { children: React.ReactNode; mono?: boolean }) {
  return (
    <td
      className="px-3 py-1.5 text-xs"
      style={{
        color: 'var(--text-primary)',
        fontFamily: mono ? 'JetBrains Mono, monospace' : 'inherit',
        borderBottom: '1px solid var(--border-dark)',
      }}
    >
      {children}
    </td>
  );
}

/* ──────────────── layer tables ──────────────── */

function Layer1Table({ minGex, ivMin, ivMax }: { minGex: number; ivMin: number; ivMax: number }) {
  const rows = [
    { cond: 'VIX9D < VIX3M',   thresh: '—',              desc: 'Term structure sana (contango)' },
    { cond: 'IV Rank',          thresh: `${ivMin}–${ivMax}`, desc: 'Volatilidad en zona vendible' },
    { cond: 'GEX',              thresh: `≥ $${minGex}B`,   desc: 'Gamma positivo, mercado anclado' },
    { cond: 'Spot > ZGL',       thresh: '—',              desc: 'Spot encima del Gamma Zero Level' },
    { cond: 'Persistencia',     thresh: '≥ 2 días',        desc: 'No entrar en día 1' },
    { cond: 'Sin FOMC/CPI',     thresh: '< 48hs',          desc: 'Evitar eventos de alta volatilidad' },
  ];
  return (
    <table className="w-full" style={{ borderCollapse: 'collapse' }}>
      <thead><tr><TH>Condición</TH><TH>Umbral</TH><TH>Descripción</TH></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.cond}>
            <TD mono>{r.cond}</TD>
            <TD mono>{r.thresh}</TD>
            <TD>{r.desc}</TD>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Layer2Table({ dte }: { dte: number }) {
  const rows = [
    { cond: 'Expected Move',  thresh: 'Spot × IV × √(DTE/365)', desc: `DTE objetivo: ${dte}d` },
    { cond: 'Call Wall',      thresh: 'desde GEX API',           desc: 'Ajustar strikes si es necesario' },
    { cond: 'Put Wall',       thresh: 'desde GEX API',           desc: 'No vender debajo del Put Wall' },
  ];
  return (
    <table className="w-full" style={{ borderCollapse: 'collapse' }}>
      <thead><tr><TH>Parámetro</TH><TH>Fórmula / Fuente</TH><TH>Descripción</TH></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.cond}>
            <TD mono>{r.cond}</TD>
            <TD mono>{r.thresh}</TD>
            <TD>{r.desc}</TD>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Layer3Table({ minOI, maxSpread, minCredit, minPop }: {
  minOI: number; maxSpread: number; minCredit: number; minPop: number;
}) {
  const rows = [
    { cond: 'Open Interest',   thresh: `≥ ${minOI.toLocaleString()}`,       desc: 'Liquidez suficiente' },
    { cond: 'Bid-Ask Spread',  thresh: `≤ $${maxSpread.toFixed(2)}`,         desc: 'Deslizamiento controlado' },
    { cond: 'Credit ratio',    thresh: `≥ ${(minCredit * 100).toFixed(0)}%`, desc: 'Del ancho del spread' },
    { cond: 'POP',             thresh: `≥ ${minPop}%`,                        desc: 'Probabilidad de ganancia' },
  ];
  return (
    <table className="w-full" style={{ borderCollapse: 'collapse' }}>
      <thead><tr><TH>Condición</TH><TH>Umbral</TH><TH>Descripción</TH></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.cond}>
            <TD mono>{r.cond}</TD>
            <TD mono>{r.thresh}</TD>
            <TD>{r.desc}</TD>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ──────────────── exit rules cards ──────────────── */

function ExitCard({
  color,
  emoji,
  title,
  detail,
}: {
  color: string;
  emoji: string;
  title: string;
  detail: string;
}) {
  return (
    <div
      className="flex-1 rounded p-3"
      style={{
        border: `1px solid ${color}`,
        backgroundColor: `${color}12`,
        minWidth: 160,
      }}
    >
      <div className="text-base mb-1">{emoji}</div>
      <div className="font-semibold text-xs mb-1" style={{ color }}>
        {title}
      </div>
      <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
        {detail}
      </div>
    </div>
  );
}

/* ──────────────── adjustment flow ──────────────── */

function FlowStep({
  label,
  isDecision = false,
  yes,
  no,
}: {
  label: string;
  isDecision?: boolean;
  yes?: string;
  no?: string;
}) {
  return (
    <div className="flex flex-col items-center">
      <div
        className="px-4 py-2 rounded text-xs font-mono text-center"
        style={{
          backgroundColor: isDecision ? 'var(--bg-tertiary)' : 'var(--bg-primary)',
          border: `1px solid ${isDecision ? 'var(--yellow-gc)' : 'var(--border-dark)'}`,
          color: isDecision ? 'var(--yellow-gc)' : 'var(--text-primary)',
          maxWidth: 260,
        }}
      >
        {label}
      </div>
      {isDecision && (yes || no) && (
        <div className="flex gap-8 mt-1">
          {yes && <span className="text-xs" style={{ color: 'var(--green)' }}>Sí → {yes}</span>}
          {no  && <span className="text-xs" style={{ color: 'var(--text-muted)' }}>No ↓</span>}
        </div>
      )}
      {!isDecision && (
        <div className="text-xs my-0.5" style={{ color: 'var(--text-muted)' }}>↓</div>
      )}
    </div>
  );
}

/* ──────────────── main component ──────────────── */

export function StrategyReference() {
  const { rules, loading, error } = useRulesStore();

  if (loading) {
    return (
      <div className="p-4 flex items-center gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
        <span className="spinner" />
        Cargando reglas…
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-xs" style={{ color: 'var(--red-gc)' }}>
        Error cargando reglas: {error}
      </div>
    );
  }

  // Map from actual CoreRules JSON structure
  const tickers = rules?.universe?.tickers ?? [];
  const gexMin  = rules?.gamma_regime?.gex_total?.min_billion_usd ?? 100;
  const ivMin   = rules?.options_filters?.iv_rank?.min ?? 25;
  const ivMax   = rules?.options_filters?.iv_rank?.max ?? 65;
  const dte     = rules?.trade_construction?.dte_target?.ideal ?? 35;
  const minOI   = rules?.options_filters?.liquidity?.open_interest_min_short_leg ?? 2000;
  const maxBA   = rules?.options_filters?.liquidity?.bid_ask_spread_max_pct_mid ?? 0.05;
  const creditTiers = rules?.trade_construction?.premium_capture?.tiers ?? [];
  const minCredit = creditTiers[0]?.min_credit_width_ratio ?? 0.10;
  const maxPos  = rules?.risk_limits?.max_concurrent_positions ?? 3;
  const sizingPct = rules?.risk_limits?.risk_per_trade_pct ?? 0.02;
  const maxTrade = rules?.risk_limits?.risk_per_trade_usd_max ?? 10000;

  return (
    <div className="p-4 max-w-4xl">

      {/* 1. Parámetros generales */}
      <Card>
        <SectionTitle>1 · Parámetros Generales</SectionTitle>
        <table className="w-full" style={{ borderCollapse: 'collapse' }}>
          <thead><tr><TH>Parámetro</TH><TH>Valor</TH></tr></thead>
          <tbody>
            <tr><TD>Tickers</TD><TD mono>{tickers.join(', ') || '—'}</TD></tr>
            <tr><TD>Máx posiciones</TD><TD mono>{maxPos}</TD></tr>
            <tr><TD>Sizing % Net Liq</TD><TD mono>{(sizingPct * 100).toFixed(2)}%</TD></tr>
            <tr><TD>Máx por trade</TD><TD mono>${maxTrade.toLocaleString()}</TD></tr>
          </tbody>
        </table>
      </Card>

      {/* 2. Las 4 capas */}
      <Card>
        <SectionTitle>2 · Capa 1 · Régimen Macro &amp; GEX</SectionTitle>
        <Layer1Table minGex={gexMin} ivMin={ivMin} ivMax={ivMax} />
      </Card>

      <Card>
        <SectionTitle>2 · Capa 2 · Motor de Strikes</SectionTitle>
        <Layer2Table dte={dte} />
      </Card>

      <Card>
        <SectionTitle>2 · Capa 3 · Microestructura</SectionTitle>
        <Layer3Table
          minOI={minOI}
          maxSpread={maxBA}
          minCredit={minCredit}
          minPop={66}
        />
      </Card>

      <Card>
        <SectionTitle>2 · Capa 4 · Sizing</SectionTitle>
        <table className="w-full" style={{ borderCollapse: 'collapse' }}>
          <thead><tr><TH>Regla</TH><TH>Valor</TH><TH>Descripción</TH></tr></thead>
          <tbody>
            <tr>
              <TD>Tamaño por posición</TD>
              <TD mono>{(sizingPct * 100).toFixed(2)}% Net Liq</TD>
              <TD>Máximo ${maxTrade.toLocaleString()} por trade</TD>
            </tr>
            <tr>
              <TD>Límite posiciones</TD>
              <TD mono>{maxPos}</TD>
              <TD>Concurrentes abiertas</TD>
            </tr>
          </tbody>
        </table>
      </Card>

      {/* 3. Motor de strikes */}
      <Card>
        <SectionTitle>3 · Fórmula Expected Move</SectionTitle>
        <div
          className="font-mono text-sm py-2 text-center rounded"
          style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}
        >
          EM = Spot × IV × √(DTE / 365)
        </div>
        <div className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
          DTE objetivo: {dte} días · IV de <code>/App.Analytics/ImpliedVolatility</code>
        </div>
      </Card>

      {/* 5. Reglas de salida */}
      <Card>
        <SectionTitle>5 · Reglas de Salida</SectionTitle>
        <div className="flex gap-3 flex-wrap">
          <ExitCard
            emoji="🟢"
            color="var(--green)"
            title="Profit Target"
            detail="50% del crédito recibido → cerrar posición"
          />
          <ExitCard
            emoji="🔴"
            color="var(--red-gc)"
            title="Stop Loss"
            detail="200% del crédito → cerrar posición sin excepción"
          />
          <ExitCard
            emoji="🕐"
            color="var(--yellow-gc)"
            title="Time Exit"
            detail="21 DTE → cerrar sin importar el P&L"
          />
        </div>
      </Card>

      {/* 6. Protocolo de ajuste */}
      <Card>
        <SectionTitle>6 · Protocolo de Ajuste</SectionTitle>
        <div className="flex flex-col items-center gap-0 py-2">
          <FlowStep label="Pérdida = 100% del crédito" />
          <FlowStep
            label="¿DTE ≥ 14 y crédito roll ≥ $0.20?"
            isDecision
            yes="ROLL de pata testada (máx 1 roll)"
            no="siguiente"
          />
          <FlowStep label="↓" />
          <FlowStep
            label="¿Pata ganadora ≥ $0.05?"
            isDecision
            yes="Convertir a spread (cerrar pata ganadora)"
            no="siguiente"
          />
          <FlowStep label="↓" />
          <div
            className="px-4 py-2 rounded text-xs font-mono text-center"
            style={{
              border: '1px solid var(--red-gc)',
              backgroundColor: 'rgba(239,68,68,0.1)',
              color: 'var(--red-gc)',
            }}
          >
            Cerrar todo
          </div>
        </div>
      </Card>
    </div>
  );
}

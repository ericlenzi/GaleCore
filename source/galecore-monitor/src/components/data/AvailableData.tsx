import React from 'react';
import { useRulesStore } from '../../store/useRulesStore';
import { RuleDefinition } from '../../types/api';
import { implFor, ImplStatus } from '../../utils/implStatus';

/* ════════════════════════════════════════════════════════════════════════════
   Available Data — referencia de aprendizaje de TODO lo que la API entrega hoy.
   Qué es cada dato, cómo se calcula (desde definitions del JSON) y un semáforo
   de si ya está cableado en backend / frontend.
   ════════════════════════════════════════════════════════════════════════════ */

type Tone = 'green' | 'red' | 'yellow' | 'blue' | 'muted';

const TONE_VARS: Record<Tone, { fg: string; bg: string; border: string }> = {
  green:  { fg: 'var(--green)',     bg: 'var(--green-muted)',  border: 'var(--green-border)' },
  red:    { fg: 'var(--red-gc)',    bg: 'var(--red-muted)',    border: 'var(--red-border)' },
  yellow: { fg: 'var(--yellow-gc)', bg: 'var(--yellow-muted)', border: 'var(--yellow-border)' },
  blue:   { fg: 'var(--blue-gc)',   bg: 'var(--blue-muted)',   border: 'var(--blue-border)' },
  muted:  { fg: 'var(--text-secondary)', bg: 'var(--bg-tertiary)', border: 'var(--border-dark)' },
};

function humanize(s: string): string {
  return s.replace(/_/g, ' ');
}

const DEF_TITLE: Record<string, string> = {
  iv_rank: 'IV Rank',
  iv30_atm_roc_pct: 'IV30 — aceleración (RoC %)',
  expected_move: 'Expected Move',
  directional_zscore: 'Z-Score direccional de precio',
  iv_zscore: 'IV Z-Score',
  gex_skew: 'GEX Skew — asimetría de muros',
  trend_ema: 'Tendencia EMA 20/50',
  realized_vol_regime: 'Volatilidad Realizada (RV)',
  aggressive_flow: 'Flow agresivo de opciones',
  leg_open_interest: 'Open Interest por leg',
  leg_prev_close: 'Cierre previo por leg',
  credit_ratio: 'Credit Ratio — Regla 1/3',
  credit_ratio_min_by_iv_rank: 'Credit ratio mínimo por IV Rank',
  gex_total: 'GEX total (neto)',
  gex_threshold_by_symbol: 'Umbral de GEX por símbolo',
  gamma_zero_level: 'Gamma Zero Level (ZGL)',
  zgl_with_buffer: 'ZGL + buffer',
  call_wall: 'Call Wall',
  put_wall: 'Put Wall',
  min_offset_from_spot_by_symbol: 'Offset mínimo desde el spot',
  pop_proxy: 'POP (proxy)',
  portfolio_heat: 'Portfolio Heat',
  heat_pct_net_liq: 'Heat % del Net Liq',
  max_heat: 'Heat máximo',
  heat_available: 'Heat disponible',
  new_position_heat: 'Heat de nueva posición',
  heat_after_new_position: 'Heat tras nueva posición',
  risk_per_trade: 'Riesgo por trade',
  max_risk_per_contract: 'Riesgo máx por contrato',
  max_contracts: 'Contratos máximos',
  positions_available: 'Slots de posición disponibles',
  bid_ask_spread_pct: 'Spread Bid/Ask (%)',
  slippage_entry: 'Slippage de entrada',
  slippage_roll: 'Slippage de roll',
  spy_exdiv_days_until: 'SPY — días hasta ex-dividendo',
  leg_mid_price: 'Mid-price por leg',
  max_profit: 'Máxima ganancia',
  max_loss: 'Máxima pérdida',
  buying_power_requirement: 'Buying Power Requirement (BPR)',
};

const TYPE_LABEL: Record<string, string> = {
  formula: 'fórmula',
  marketdata: 'market data',
  lookup_by_symbol: 'lookup',
  lookup_by_range: 'lookup',
  field: 'campo',
  realtime_stream: 'tiempo real',
  rule: 'regla',
  manual: 'manual',
};

/* endpoints que la API expone hoy (infra). fe = lo consume el monitor. */
interface EndpointRow {
  path: string;
  desc: string;
  fe: boolean;
}
const ENDPOINTS: EndpointRow[] = [
  { path: '/App/GaleCore/Rules/Core',                  desc: 'Reglas de la estrategia (este JSON)',                fe: true },
  { path: '/App/GaleCore/ValidationLayer',             desc: 'Las 4 capas en cascada (macro + position builder)',  fe: true },
  { path: '/App/GaleCore/PositionBuilder',             desc: 'Capas 2-4 + structureInputs (z, skew, trend, flow)', fe: true },
  { path: '/App/GaleCore/MacroRegime',                 desc: 'Solo Capa 1 (régimen macro)',                        fe: false },
  { path: '/App.Analytics/GammaExposure',              desc: 'GEX por strike, call/put wall, ZGL',                 fe: true },
  { path: '/App.Analytics/IVRank',                     desc: 'IV Rank + historial 252d',                           fe: true },
  { path: '/App.Analytics/ImpliedVolatility',          desc: 'IV30 / 9d / 3m + RoC %',                             fe: true },
  { path: '/Data/Tastytrade/MarketData/ByType',        desc: 'Precio, bid/ask, volumen del subyacente',            fe: true },
  { path: '/Data/Tastytrade/MarketData/Quote',         desc: 'Quote (bid/ask) por símbolo',                        fe: true },
  { path: '/Data/Tastytrade/MarketData/Candle',        desc: 'Candles diarios OHLCV + Open Interest',              fe: true },
  { path: '/Data/Tastytrade/MarketData/Greeks',        desc: 'Greeks por opción (REST)',                           fe: false },
  { path: '/Data/Tastytrade/Market-metrics/Volatility',desc: 'Índice de IV + cambio 5d (alimenta IV momentum)',    fe: false },
  { path: '/Data/Tastytrade/OptionChains',             desc: 'Cadena de opciones completa',                        fe: false },
  { path: '/Data/Tastytrade/Account/Balances',         desc: 'Net Liq, Buying Power, Cash',                         fe: true },
  { path: '/Data/Tastytrade/Account/Positions',        desc: 'Posiciones abiertas',                                fe: true },
  { path: 'ws /hubs/marketdata',                       desc: 'Trade / Quote / Greeks / Flow en tiempo real',       fe: true },
];

/* ──────────────── primitivas ──────────────── */

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded-lg p-5 mb-5"
      style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-dark)' }}
    >
      {children}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-lg font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--blue-gc)' }}>
      {children}
    </h2>
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

function Muted({ children }: { children: React.ReactNode }) {
  return <span className="text-lg" style={{ color: 'var(--text-secondary)' }}>{children}</span>;
}

/** Punto verde/rojo con etiqueta corta. */
function Dot({ on, label }: { on: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span
        className="inline-block rounded-full"
        style={{ width: 10, height: 10, backgroundColor: on ? 'var(--green)' : 'var(--red-gc)' }}
      />
      <span className="text-base" style={{ color: on ? 'var(--green)' : 'var(--red-gc)' }}>{label}</span>
    </span>
  );
}

function Semaphore({ status }: { status: ImplStatus | null }) {
  if (!status) return null;
  return (
    <div className="flex items-center gap-3">
      <Dot on={status.backend} label="BE" />
      <Dot on={status.frontend} label="FE" />
    </div>
  );
}

/* ──────────────── tarjeta de definición ──────────────── */

function defValueLine(def: RuleDefinition): string | null {
  if (def.formula) return def.formula;
  if (def.values) return Object.entries(def.values).map(([k, v]) => `${k}: ${v}`).join('   ·   ');
  if (def.ranges) return def.ranges.map((r) => `${r.min}–${r.max} → ${r.value}`).join('   ·   ');
  return null;
}

function Interpretation({ interp }: { interp: RuleDefinition['interpretation'] }) {
  if (!interp) return null;
  if (typeof interp === 'string') return <div className="mt-2"><Muted>{interp}</Muted></div>;
  return (
    <div className="mt-2 flex flex-col gap-1">
      {Object.entries(interp).map(([k, v]) => (
        <div key={k} className="text-lg" style={{ color: 'var(--text-secondary)' }}>
          <code
            className="text-base px-1.5 py-0.5 rounded mr-1.5"
            style={{ fontFamily: 'JetBrains Mono, monospace', backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}
          >
            {k.replace(/_/g, ' ').replace('gt ', '> ').replace('lt ', '< ').replace('between ', '')}
          </code>
          {v}
        </div>
      ))}
    </div>
  );
}

function DefCard({ defKey, def }: { defKey: string; def: RuleDefinition }) {
  const title = DEF_TITLE[defKey] ?? humanize(defKey);
  const value = defValueLine(def);
  const status = implFor(defKey);
  const source = def.endpoint ?? def.source;

  return (
    <div
      className="rounded-lg p-4 flex flex-col"
      style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-dark)' }}
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="font-semibold text-lg" style={{ color: 'var(--text-primary)' }}>{title}</div>
        <Semaphore status={status} />
      </div>

      <div className="mb-2">
        {def.type && <Chip tone="muted">{TYPE_LABEL[def.type] ?? humanize(def.type)}</Chip>}
      </div>

      {value && (
        <div
          className="font-mono text-base px-2.5 py-2 rounded mb-1 break-words"
          style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--blue-gc)' }}
        >
          {value}
        </div>
      )}

      <Interpretation interp={def.interpretation} />

      {def.note && <div className="mt-2"><Muted>{def.note}</Muted></div>}

      {source && (
        <div className="mt-auto pt-3">
          <span className="text-base" style={{ color: 'var(--text-secondary)' }}>fuente: </span>
          <code
            className="text-base px-1.5 py-0.5 rounded break-all"
            style={{ fontFamily: 'JetBrains Mono, monospace', backgroundColor: 'var(--bg-primary)', color: 'var(--text-secondary)' }}
          >
            {source}
          </code>
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════ */

export function AvailableData() {
  const { rules, loading, error } = useRulesStore();

  if (loading) {
    return (
      <div className="p-6 flex items-center gap-2 text-lg" style={{ color: 'var(--text-secondary)' }}>
        <span className="spinner" /> Cargando datos…
      </div>
    );
  }
  if (error || !rules) {
    return (
      <div className="p-6 text-lg" style={{ color: 'var(--red-gc)' }}>
        Error cargando reglas: {error ?? 'sin datos'}
      </div>
    );
  }

  const defs = rules.definitions ?? {};
  const da = rules.data_availability;
  const defKeys = Object.keys(defs).filter((k) => !k.startsWith('_'));

  return (
    <div className="p-6 w-full">
      {/* encabezado */}
      <div className="mb-5">
        <h1 className="text-2xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
          Available Data
        </h1>
        <p className="text-lg leading-relaxed" style={{ color: 'var(--text-secondary)', maxWidth: 900 }}>
          Todo lo que la API puede entregar hoy: qué es cada dato y cómo se calcula. Pensado para
          aprender el sistema. El semáforo indica si ya está cableado:
        </p>
        <div className="flex items-center gap-5 mt-3">
          <Dot on={true} label="BE — lo computa/expone el backend" />
          <Dot on={true} label="FE — lo muestra el monitor" />
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block rounded-full" style={{ width: 10, height: 10, backgroundColor: 'var(--red-gc)' }} />
            <span className="text-base" style={{ color: 'var(--red-gc)' }}>aún no</span>
          </span>
        </div>
      </div>

      {/* disponibilidad de datos (data_availability) */}
      {da && (
        <Card>
          <SectionTitle>Disponibilidad de datos</SectionTitle>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <div className="text-base uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }}>
                Disponible hoy (automático)
              </div>
              <div className="flex gap-2 flex-wrap">
                {(da.available_today ?? []).map((d) => <Chip key={d} tone="green">{humanize(d)}</Chip>)}
              </div>
            </div>
            <div>
              <div className="text-base uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }}>
                Requiere chequeo manual
              </div>
              <div className="flex gap-2 flex-wrap">
                {(da.manual_check_required ?? []).map((d) => <Chip key={d} tone="yellow">{humanize(d)}</Chip>)}
              </div>
            </div>
          </div>
          {da.partial_availability_note && (
            <div className="mt-3 flex flex-col gap-1.5">
              {Object.entries(da.partial_availability_note).map(([k, v]) => (
                <div key={k}><Chip tone="muted">{humanize(k)}</Chip> <Muted>{v}</Muted></div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* endpoints */}
      <Card>
        <SectionTitle>Endpoints de la API</SectionTitle>
        <div className="overflow-x-auto">
          <table className="w-full" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th className="px-3 py-2 text-left text-base uppercase tracking-wider" style={{ color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-dark)' }}>Endpoint</th>
                <th className="px-3 py-2 text-left text-base uppercase tracking-wider" style={{ color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-dark)' }}>Qué entrega</th>
                <th className="px-3 py-2 text-left text-base uppercase tracking-wider" style={{ color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-dark)', width: 150 }}>Estado</th>
              </tr>
            </thead>
            <tbody>
              {ENDPOINTS.map((e) => (
                <tr key={e.path}>
                  <td className="px-3 py-2.5 text-lg" style={{ borderBottom: '1px solid var(--border-dark)' }}>
                    <code style={{ fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-primary)' }}>{e.path}</code>
                  </td>
                  <td className="px-3 py-2.5 text-lg" style={{ color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-dark)' }}>{e.desc}</td>
                  <td className="px-3 py-2.5" style={{ borderBottom: '1px solid var(--border-dark)' }}>
                    <div className="flex items-center gap-3"><Dot on={true} label="BE" /><Dot on={e.fe} label="FE" /></div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* conceptos: qué es y cómo se calcula */}
      <Card>
        <SectionTitle>Conceptos — qué es y cómo se calcula ({defKeys.length})</SectionTitle>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {defKeys.map((k) => <DefCard key={k} defKey={k} def={defs[k]} />)}
        </div>
      </Card>
    </div>
  );
}

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

/** Qué es y qué mide cada concepto — definición concreta para aprender. */
const DEF_WHAT: Record<string, string> = {
  iv_rank: 'Posición de la IV actual dentro de su rango de los últimos 252 días (0–100). Mide cuán cara o barata está la volatilidad hoy respecto a su propio último año.',
  iv30_atm_roc_pct: 'Variación porcentual de la IV a 30 días en los últimos 5 días. Mide la aceleración de la volatilidad: si la prima se expande (riesgo) o se estabiliza.',
  expected_move: 'Movimiento esperado del subyacente hasta la expiración, derivado de la IV. Mide el rango de ~1 desvío que el mercado descuenta; sirve para ubicar strikes fuera de ese rango.',
  directional_zscore: 'Retorno de 5 días normalizado por la volatilidad diaria. Mide cuán extendido/estirado está el precio direccionalmente (sobrecompra/sobreventa) en unidades de desvío.',
  iv_zscore: 'IV actual en desvíos respecto a su media de 252 días. Mide si el régimen de volatilidad es estadísticamente alto o bajo.',
  gex_skew: 'Proporción del gamma de calls sobre el total (calls + |puts|), en [0,1]. Mide hacia qué lado está el muro de gamma dominante (soporte estructural arriba vs abajo).',
  trend_ema: 'Relación entre la EMA de 20 y la de 50 sesiones. Mide la tendencia de fondo: alcista, bajista o lateral.',
  realized_vol_regime: 'Compara la volatilidad realizada de 10 días vs 30 días (anualizadas). Mide si la volatilidad efectiva del precio se está acelerando o desacelerando.',
  aggressive_flow: 'Clasifica trades grandes de opciones por agresión (ask = comprador agresivo, bid = vendedor). Mide la presión direccional del dinero grande en tiempo real.',
  leg_open_interest: 'Contratos abiertos del leg al cierre previo. Mide la liquidez y profundidad del contrato.',
  leg_prev_close: 'Precio de cierre del leg en la sesión anterior. Mide la referencia estática de prima antes del dato en vivo.',
  credit_ratio: 'Crédito cobrado dividido por el ancho del spread. Mide la calidad del spread (regla 1/3): cuánto se cobra por unidad de riesgo.',
  credit_ratio_min_by_iv_rank: 'Credit ratio mínimo exigido según el IV Rank. Mide la prima mínima aceptable: a mayor IV, se exige más crédito.',
  gex_total: 'Gamma Exposure neto agregado de todos los strikes, en miles de millones USD. Mide cuán "anclado" está el mercado por la cobertura de los market makers.',
  gex_threshold_by_symbol: 'GEX mínimo por símbolo para habilitar operar. Mide el piso de gamma positivo necesario para que el ancla sea confiable.',
  gamma_zero_level: 'Strike donde el GEX acumulado cruza de negativo a positivo. Mide la frontera entre régimen de mean-reversion (arriba) y de momentum (abajo).',
  zgl_with_buffer: 'El ZGL más un colchón de 0.5%. Mide el nivel mínimo de spot por encima del cual el ancla es estable (evita operar en la barrera).',
  call_wall: 'Strike con mayor gamma de calls. Mide el techo estructural donde los market makers tienden a frenar las subas.',
  put_wall: 'Strike con gamma de puts más negativo. Mide el piso estructural donde los market makers tienden a frenar las bajas.',
  min_offset_from_spot_by_symbol: 'Distancia mínima en puntos entre el spot y el strike short. Mide el colchón mínimo para no vender demasiado cerca del dinero.',
  pop_proxy: 'Probabilidad de profit aproximada = (1 − |delta short|)×100. Mide la chance de que el spread expire OTM (ganador).',
  portfolio_heat: 'Suma del riesgo máximo de todas las posiciones abiertas, en USD. Mide la exposición total a pérdida del portafolio.',
  heat_pct_net_liq: 'Heat del portafolio como fracción del Net Liq. Mide qué porción del capital está en riesgo.',
  max_heat: 'Tope de heat permitido (4.5% del Net Liq). Mide el límite de riesgo agregado del portafolio.',
  heat_available: 'Heat máximo menos el heat actual. Mide cuánto riesgo nuevo se puede agregar todavía.',
  new_position_heat: 'Riesgo máximo en USD que agregaría una posición nueva. Mide el costo de riesgo de abrir ese trade.',
  heat_after_new_position: 'Heat actual más el de la nueva posición. Mide si el portafolio seguiría dentro del límite tras abrir.',
  risk_per_trade: 'Riesgo permitido por trade (1.5% del Net Liq). Mide el capital máximo a arriesgar en una sola operación.',
  max_risk_per_contract: 'Pérdida máxima de un contrato = (ancho − crédito)×100. Mide el riesgo unitario del spread.',
  max_contracts: 'Contratos máximos = riesgo por trade ÷ riesgo por contrato. Mide el sizing: cuántos contratos caben dentro del límite de riesgo.',
  positions_available: 'Posiciones máximas menos las abiertas. Mide cuántos slots de posición quedan libres.',
  bid_ask_spread_pct: 'Spread bid/ask relativo al mid. Mide la calidad y liquidez del quote (deslizamiento esperado).',
  slippage_entry: 'Diferencia entre el mid estimado y el fill real más fees, al entrar. Mide el costo de ejecución de una entrada.',
  slippage_roll: 'Fricción máxima permitida por leg al rollear (0.05/leg, 0.20 total). Mide el costo tolerable de un ajuste defensivo.',
  spy_exdiv_days_until: 'Días hasta el ex-dividendo de SPY (chequeo manual). Mide el riesgo de asignación temprana en calls ITM.',
  leg_mid_price: 'Mid del quote en vivo de cada leg = (bid+ask)/2. Mide la prima en tiempo real por pata.',
  max_profit: 'Ganancia máxima = crédito neto live × 100 × contratos. Mide lo máximo a ganar si todo expira OTM.',
  max_loss: 'Pérdida máxima = (ancho − crédito live) × 100 × contratos. Mide lo máximo a perder si el spread expira ITM.',
  buying_power_requirement: 'Capital bloqueado por contrato = (ancho − crédito live)×100. Mide el margen requerido para sostener el spread.',
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
  const what = DEF_WHAT[defKey];

  return (
    <div
      className="rounded-lg p-4 mb-3"
      style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-dark)' }}
    >
      {/* header */}
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="font-semibold text-xl" style={{ color: 'var(--text-primary)' }}>{title}</span>
          {def.type && <Chip tone="muted">{TYPE_LABEL[def.type] ?? humanize(def.type)}</Chip>}
        </div>
        <Semaphore status={status} />
      </div>

      {/* cuerpo: definición (izq) + fórmula/fuente (der) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-3">
        <div>
          {what && (
            <p className="text-lg leading-relaxed" style={{ color: 'var(--text-primary)' }}>{what}</p>
          )}
          <Interpretation interp={def.interpretation} />
          {def.note && <div className="mt-2"><Muted>{def.note}</Muted></div>}
        </div>

        <div className="flex flex-col gap-2">
          {value && (
            <div>
              <div className="text-base uppercase tracking-wider mb-1" style={{ color: 'var(--text-secondary)' }}>
                {def.type === 'formula' ? 'Fórmula' : 'Valor'}
              </div>
              <div
                className="font-mono text-lg px-3 py-2 rounded break-words"
                style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--blue-gc)' }}
              >
                {value}
              </div>
            </div>
          )}
          {source && (
            <div>
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
      </div>
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
        <div>
          {defKeys.map((k) => <DefCard key={k} defKey={k} def={defs[k]} />)}
        </div>
      </Card>
    </div>
  );
}

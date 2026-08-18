import React, { useState } from 'react';
import { DetailsGroup, GexAnalysisResponse } from '../../types/gex';
import { MacroRegimeChecks, StructureInputs } from '../../types/api';
import { fmtGex, fmtPrice } from '../../utils/formatters';
import { CALL_COLOR, PUT_COLOR } from '../../utils/optionSideColors';

/**
 * Cuadro Details de la pestaña GEX: los diez indicadores de contexto, agrupados por la PREGUNTA que
 * contestan.
 *
 * REEMPLAZA a ValidationLayers + MarketDiagnostics, que repartían estos mismos diez en dos columnas
 * según de qué objeto de la respuesta venían (`macroRegime.checks` a la izquierda,
 * `structureInputs` a la derecha). Ese es el origen del dato, no una pregunta que alguien se haga:
 * dejaba RV lejos de IV Rank —juntas son la lectura de VRP— y partía la historia del gamma
 * (tamaño, asimetría, posición del spot) entre las dos mitades. También convivían dos gramáticas
 * visuales para la misma clase de dato, tiles a la izquierda y filas a la derecha, que el ojo lee
 * como dos tipos de cosa distintos.
 *
 * SIN SEMÁFORO, a propósito (`display_config...semaphore: false`). GEX es informativa y no tiene
 * gates: los checks vienen con `on_fail: inform_only`. El verde/rojo con ✓/✗ que heredó de la
 * cascada de Main hacía que un GEX global de -$921B —que es lo normal en SPY— se leyera como una
 * avería. Cada celda muestra su referencia en texto, y el color queda para las dos métricas cuyo
 * valor ES una dirección de mercado (ver COLOR_DE_DIRECCION).
 *
 * Los grupos, sus etiquetas y qué métrica va en cada uno los declara el JSON de reglas; acá vive
 * solo el cómo se dibuja cada id. Un id que el JSON declare y este panel no conozca se omite: es
 * preferible una celda de menos a una celda vacía que se lea como "sin dato".
 */

/** Grupos por defecto si el JSON no los declara. Mismo orden y mismos ids que el JSON. */
export const DEFAULT_DETAILS_GROUPS: DetailsGroup[] = [
  {
    id: 'market', label: 'Mercado', scope: 'market', hint: 'Igual para todos los simbolos',
    metrics: [{ id: 'vix', label: 'VIX' }, { id: 'vix_term_structure', label: 'VIX TS' }],
  },
  {
    id: 'volatility', label: 'Volatilidad', scope: 'symbol', hint: 'Cuanto vale el seguro, y hacia donde va',
    metrics: [
      { id: 'iv_rank', label: 'IV Rank' },
      { id: 'iv_momentum', label: 'IV Momentum' },
      { id: 'realized_vol', label: 'RV 10 / 30' },
    ],
  },
  {
    id: 'gamma', label: 'Estructura gamma', scope: 'symbol', hint: 'Donde estan los muros, y de que lado',
    metrics: [
      { id: 'gex_global', label: 'GEX Global' },
      { id: 'gex_skew', label: 'Skew de muros' },
      { id: 'spot_vs_zgl', label: 'Spot vs ZGL' },
    ],
  },
  {
    id: 'price', label: 'Precio', scope: 'symbol', hint: 'Que esta haciendo',
    metrics: [
      { id: 'price_zscore', label: 'z-score direccional' },
      { id: 'trend_ema', label: 'Trend EMA' },
    ],
  },
];

/**
 * Las dos únicas métricas que se pintan, porque su valor ES una dirección y no un veredicto: qué
 * muro domina y hacia dónde apuntan las EMAs. Pero no se pintan con la misma escala:
 *
 * * **El skew usa la identidad del lado de la cadena** (`optionSideColors`): call verde, put rojo,
 *   los mismos colores con los que el gráfico y el panel de barras dibujan ese muro. "put 0.38" en
 *   rojo dice "el muro dominante es de puts", igual que la línea roja del Put Wall — no dice que
 *   algo esté mal.
 * * **El trend usa el verde/rojo de dirección de precio**, que es el mismo de las velas.
 *
 * Son dos ejes distintos que comparten los dos colores del tema, así que el que lee tiene que
 * apoyarse en la etiqueta de la celda. Por eso son las únicas dos con color.
 */
const TREND_UP = 'var(--green)';
const TREND_DOWN = 'var(--red-gc)';

interface Cell {
  /** El número o la palabra que se lee de un vistazo. */
  value: string;
  /** Contra qué se lee: el umbral que declara el JSON, o la interpretación que arma el backend. */
  reference: string;
  /** Solo para las métricas direccionales; el resto va en texto neutro. */
  color?: string;
  /** Filas exactas para el tooltip. Sin esto se perdían los valores crudos al redondear. */
  tooltip?: { label: string; value: string }[];
}

const NO_DATA: Cell = { value: '—', reference: 'sin dato' };

function n(v: number | null | undefined, d = 2): string {
  return v == null ? '—' : v.toFixed(d);
}

/**
 * Una celda por id de métrica. La línea de referencia sale de lo que devolvió la API
 * (`threshold` / `min` / `max` / `interpretation`) y NO del display_config: declarar el umbral en
 * los dos lados sería una segunda fuente de verdad que puede quedar desalineada de macro_regime.
 */
function buildCell(
  id: string,
  checks: MacroRegimeChecks | undefined,
  inputs: StructureInputs | null | undefined,
): Cell | null {
  switch (id) {
    case 'vix': {
      const c = checks?.vixAbsolute;
      if (!c || c.value == null) return NO_DATA;
      return {
        value: c.value.toFixed(1),
        reference: `ref < ${c.threshold}`,
        tooltip: [{ label: 'VIX', value: c.value.toFixed(2) }, { label: 'Ref', value: `< ${c.threshold}` }],
      };
    }
    case 'vix_term_structure': {
      const c = checks?.vixTermStructure;
      // noData = faltó alguno de los dos índices. El backend lo manda passed=true porque no
      // bloquea, así que mostrarlo como una lectura normal escondería que no hay dato.
      if (!c || c.noData || c.vix9d == null || c.vix30d == null) return NO_DATA;
      return {
        value: `${c.vix9d.toFixed(1)} / ${c.vix30d.toFixed(1)}`,
        reference: '9D / 30D · contango si 9D es menor',
        tooltip: [
          { label: 'VIX9D', value: c.vix9d.toFixed(2) },
          { label: 'VIX', value: c.vix30d.toFixed(2) },
        ],
      };
    }
    case 'iv_rank': {
      const c = checks?.ivRank;
      if (!c) return NO_DATA;
      return {
        value: c.value.toFixed(0),
        reference: `ref ${c.min}–${c.max}`,
        tooltip: [{ label: 'IV Rank', value: c.value.toFixed(2) }, { label: 'Ref', value: `${c.min} – ${c.max}` }],
      };
    }
    case 'iv_momentum': {
      const c = checks?.ivMomentum;
      if (!c || c.value == null) return NO_DATA;
      const signo = c.value > 0 ? '+' : '';
      return {
        value: `${signo}${c.value.toFixed(1)}%`,
        reference: `ROC 5d · ref ≤ ${c.threshold}%`,
        tooltip: [
          { label: 'ROC 5d', value: `${c.value.toFixed(2)}%` },
          { label: 'Ref', value: `≤ ${c.threshold}%` },
        ],
      };
    }
    case 'realized_vol': {
      const rv = inputs?.realizedVolRegime;
      if (!rv || rv.rv10d == null || rv.rv30d == null) return NO_DATA;
      return {
        value: `${rv.rv10d.toFixed(1)} / ${rv.rv30d.toFixed(1)}`,
        reference: `vol realizada · regimen ${rv.signal ?? '—'}`,
        tooltip: [
          { label: 'RV 10d', value: rv.rv10d.toFixed(2) },
          { label: 'RV 30d', value: rv.rv30d.toFixed(2) },
        ],
      };
    }
    case 'gex_global': {
      const c = checks?.gexTotal;
      if (!c) return NO_DATA;
      // Sin umbral propio para el símbolo no hay contra qué leerlo, y un umbral por default se
      // leería como si alguien lo hubiera elegido para este ticker.
      // Umbral 0 = el criterio es el SIGNO, no un piso. Escribirlo como "ref ≥ $0B" haría pasar
      // por piso en billones lo que es una lectura de gamma positivo contra gamma negativo, que es
      // justo la confusión que el JSON dejó anotada en gex_threshold_by_symbol.
      const umbral = c.thresholdDeclared === false ? null : c.threshold;
      const referencia = umbral == null ? 'sin umbral declarado'
        : umbral === 0 ? 'ref: gamma positivo (≥ 0)'
        : `ref ≥ ${fmtGex(umbral)}`;
      return {
        value: fmtGex(c.value),
        reference: referencia,
        tooltip: [
          { label: 'Net GEX', value: `${c.value.toFixed(1)}B` },
          {
            label: 'Ref',
            value: umbral == null ? 'sin declarar' : umbral === 0 ? '≥ 0 (signo)' : `≥ ${fmtGex(umbral)}`,
          },
        ],
      };
    }
    case 'gex_skew': {
      const g = inputs?.gexSign;
      if (!g || g.value == null) return NO_DATA;
      const lado = g.value === 'put_dominant' ? 'put' : g.value === 'call_dominant' ? 'call' : 'simetrico';
      return {
        value: `${lado} ${n(g.skewRatio)}`,
        reference: g.interpretation ?? 'callGEX / (callGEX + |putGEX|)',
        color: g.value === 'put_dominant' ? PUT_COLOR
          : g.value === 'call_dominant' ? CALL_COLOR
          : undefined,
        tooltip: [
          { label: 'Ratio', value: n(g.skewRatio) },
          { label: 'Muro', value: g.value },
        ],
      };
    }
    case 'spot_vs_zgl': {
      const c = checks?.spotVsZgl;
      if (!c) return NO_DATA;
      if (c.zgl == null) {
        return { value: '—', reference: 'sin ZGL en la cadena', tooltip: [{ label: 'Spot', value: c.spot.toFixed(2) }] };
      }
      return {
        value: c.passed ? 'encima' : 'debajo',
        reference: `spot ${fmtPrice(c.spot, 0)} · ZGL ${fmtPrice(c.zgl, 0)}`,
        tooltip: [
          { label: 'Spot', value: c.spot.toFixed(2) },
          { label: 'ZGL', value: c.zgl.toFixed(2) },
          { label: 'Buffer', value: `${(c.bufferPct * 100).toFixed(1)}%` },
        ],
      };
    }
    case 'price_zscore': {
      const z = inputs?.priceZScore;
      if (!z || z.value == null) return NO_DATA;
      return {
        value: z.value.toFixed(2),
        reference: `ret 5d en unidades de vol · ${z.interpretation ?? ''}`.trim(),
        tooltip: [
          { label: 'z-score', value: z.value.toFixed(2) },
          { label: 'Ret 5d', value: n(z.ret5d) },
          { label: 'IV ATM', value: n(z.ivAtm) },
        ],
      };
    }
    case 'trend_ema': {
      const t = inputs?.trend;
      if (!t || !t.signal) return NO_DATA;
      return {
        value: t.signal,
        reference: t.ema20 != null && t.ema50 != null
          ? `EMA20 ${t.ema20.toFixed(1)} · EMA50 ${t.ema50.toFixed(1)}`
          : (t.interpretation ?? 'EMA 20 vs EMA 50'),
        color: t.signal === 'up' ? TREND_UP : t.signal === 'down' ? TREND_DOWN : undefined,
        tooltip: [
          { label: 'EMA 20', value: n(t.ema20, 1) },
          { label: 'EMA 50', value: n(t.ema50, 1) },
        ],
      };
    }
    default:
      return null;
  }
}

/** Etiqueta de grupo: el mismo formato que ya usaban los dos paneles que este reemplaza. */
function GroupLabel({ label, hint }: { label: string; hint?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
      <span style={{
        fontSize: 9, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase',
        color: '#a78bfa', fontFamily: 'Inter, sans-serif', whiteSpace: 'nowrap',
      }}>
        {label}
      </span>
      {hint && (
        <span style={{ fontSize: 8.5, color: 'var(--text-muted)', fontFamily: 'Inter, sans-serif' }}>
          {hint}
        </span>
      )}
    </div>
  );
}

function MetricTile({ label, cell }: { label: string; cell: Cell }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  const handleEnter = (e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setPos({ x: rect.left + rect.width / 2, y: rect.bottom + 6 });
  };

  return (
    <div
      style={{
        display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0,
        padding: '7px 9px', borderRadius: 6, backgroundColor: 'var(--bg-tertiary)',
        cursor: cell.tooltip ? 'help' : undefined,
      }}
      onMouseEnter={cell.tooltip ? handleEnter : undefined}
      onMouseLeave={cell.tooltip ? () => setPos(null) : undefined}
    >
      {pos && cell.tooltip && (
        <div style={{
          position: 'fixed', top: pos.y, left: pos.x, transform: 'translateX(-50%)',
          padding: '6px 10px', backgroundColor: 'var(--bg-primary)',
          border: '1px solid var(--border)', borderRadius: 6,
          boxShadow: '0 4px 12px rgba(0,0,0,0.5)', zIndex: 9999,
          whiteSpace: 'nowrap', display: 'flex', flexDirection: 'column', gap: 3,
          pointerEvents: 'none',
        }}>
          {cell.tooltip.map((r) => (
            <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <span style={{
                fontSize: 9, color: 'var(--text-muted)', fontFamily: 'Inter, sans-serif',
                fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.07em',
              }}>
                {r.label}
              </span>
              <span className="tabular-nums" style={{
                fontSize: 10, color: 'var(--text-primary)',
                fontFamily: 'JetBrains Mono, monospace', fontWeight: 600,
              }}>
                {r.value}
              </span>
            </div>
          ))}
        </div>
      )}

      <span style={{
        fontSize: 8.5, fontWeight: 600, letterSpacing: '0.09em', textTransform: 'uppercase',
        color: 'var(--text-muted)', fontFamily: 'Inter, sans-serif',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {label}
      </span>

      <span className="tabular-nums" style={{
        fontSize: 14, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.1,
        color: cell.color ?? 'var(--text-primary)', fontFamily: 'JetBrains Mono, monospace',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {cell.value}
      </span>

      {/* La referencia ENVUELVE, no se recorta. Es la mitad que le da sentido al número, y
          cortarla con puntos suspensivos ("put wall domina —…") deja justo la parte que no dice
          nada. El tile crece un renglón; el que no lo necesita no lo usa. */}
      <span style={{
        fontSize: 9, color: 'var(--text-muted)', fontFamily: 'Inter, sans-serif', lineHeight: 1.25,
      }}>
        {cell.reference}
      </span>
    </div>
  );
}

interface Props {
  data: GexAnalysisResponse | null;
  /** Los grupos que declara display_config.gex_tab.details_panel, en orden de lectura. */
  groups?: DetailsGroup[];
  subtitle?: string;
}

export function DetailsPanel({ data, groups, subtitle }: Props) {
  const declared = groups?.length ? groups : DEFAULT_DETAILS_GROUPS;
  const checks = data?.macroRegime?.checks;
  const inputs = data?.structureInputs ?? null;

  // Un id que el JSON declare y este panel no sepa dibujar se omite en vez de rendir una celda
  // vacía, que se leería como "sin dato" cuando el problema es de contrato.
  const rendered = declared
    .map((g) => ({
      group: g,
      cells: g.metrics
        .map((m) => ({ label: m.label, cell: buildCell(m.id, checks, inputs) }))
        .filter((c): c is { label: string; cell: Cell } => c.cell !== null),
    }))
    .filter((g) => g.cells.length > 0);

  const market = rendered.filter((g) => g.group.scope === 'market');
  const symbol = rendered.filter((g) => g.group.scope !== 'market');

  return (
    <div style={{ padding: '10px 12px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {subtitle && (
        <span style={{
          fontSize: 8.5, color: 'var(--text-muted)', fontFamily: 'Inter, sans-serif', lineHeight: 1.3,
        }}>
          {subtitle}
        </span>
      )}

      {!data ? (
        <span style={{ fontSize: 10, color: 'var(--text-muted)', padding: '6px 0' }}>
          Sin barrido todavia.
        </span>
      ) : (
        <>
          {/* Franja de mercado: arriba y con su propio fondo, porque NO es del símbolo del
              encabezado. Sin este corte, cambiar de ticker y ver que el VIX no se mueve es
              indistinguible de un dato colgado del barrido anterior. */}
          {market.map(({ group, cells }) => (
            <div
              key={group.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
                padding: '7px 10px', borderRadius: 6,
                backgroundColor: 'var(--bg-tertiary)',
                border: '1px solid var(--border-dark)',
              }}
            >
              <GroupLabel label={group.label} hint={group.hint} />
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 18, flexWrap: 'wrap' }}>
                {cells.map(({ label, cell }) => (
                  <div key={label} style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
                    <span style={{
                      fontSize: 8.5, fontWeight: 600, letterSpacing: '0.09em', textTransform: 'uppercase',
                      color: 'var(--text-muted)', fontFamily: 'Inter, sans-serif',
                    }}>
                      {label}
                    </span>
                    <span className="tabular-nums" style={{
                      fontSize: 13, fontWeight: 700, color: cell.color ?? 'var(--text-primary)',
                      fontFamily: 'JetBrains Mono, monospace',
                    }}>
                      {cell.value}
                    </span>
                    <span style={{
                      fontSize: 9, color: 'var(--text-muted)', fontFamily: 'Inter, sans-serif',
                    }}>
                      {cell.reference}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* Los grupos del símbolo: mismo tile para todos, así ninguna métrica parece de otra
              clase por venir de otro objeto de la respuesta. */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${symbol.length || 1}, minmax(0, 1fr))`,
            gap: 12,
            alignItems: 'start',
          }}>
            {symbol.map(({ group, cells }) => (
              <div key={group.id} style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
                <GroupLabel label={group.label} hint={group.hint} />
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: `repeat(${cells.length}, minmax(0, 1fr))`,
                  gap: 5,
                }}>
                  {cells.map(({ label, cell }) => (
                    <MetricTile key={label} label={label} cell={cell} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

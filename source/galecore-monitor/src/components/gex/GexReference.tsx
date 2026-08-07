import React, { useEffect } from 'react';
import { useGexStore } from '../../store/useGexStore';
import { SectionTitle, Card, CollapsibleCard, Stat, TH, TD } from '../strategy/ReferencePrimitives';

/**
 * Panel de Definiciones de GEX. Se muestra dentro del modal de Referencias de la pestaña GEX.
 *
 * GEX es informativa: no propone estructura, no calcula strikes ni sizing, no emite señales. Por eso
 * este panel NO tiene gates de señal, máquina de estados ni sizing (a diferencia del de RPF) — muestra
 * lo que la estrategia sí declara: universo, contexto de mercado (lectura), config del barrido y el
 * umbral por símbolo que decide qué se evalúa.
 *
 * Lee el JSON de reglas que el store ya cargó (`useGexStore.rules`); tipado como `any` porque el tipo
 * `GexRules` del store expone solo lo que la pestaña necesita para renderizar, no el archivo entero.
 */
export function GexReference() {
  const rules = useGexStore((s) => s.rules) as any;
  const loadRules = useGexStore((s) => s.loadRules);

  // El modal de References puede abrirse desde la card de Main sin haber entrado nunca a la pestaña
  // GEX (que es quien normalmente carga las reglas). Si el store todavía no las tiene, las pedimos.
  useEffect(() => {
    if (!useGexStore.getState().rules) loadRules();
  }, [loadRules]);

  if (!rules) {
    return <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'Inter, sans-serif' }}>Cargando reglas de GEX…</div>;
  }

  const meta = rules._meta ?? {};
  const scope = rules.strategy_scope ?? {};
  const universe = rules.universe ?? {};
  const gex = rules.gex ?? {};
  const thr = rules.definitions?.gex_threshold_by_symbol ?? {};
  const zgl = rules.definitions?.zgl_with_buffer ?? {};
  const checks: any[] = rules.macro_regime?.checks ?? [];
  const regimeOnFail = rules.macro_regime?.on_fail ?? 'inform_only';
  const forbidden: string[] = scope.forbidden_strategies ?? [];
  const thrValues: Record<string, number> = thr.values ?? {};

  return (
    <div style={{ fontFamily: 'Inter, sans-serif' }}>
      {/* A · Definición */}
      <SectionTitle>A · Definición</SectionTitle>
      <Card>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, marginBottom: meta.purpose ? 12 : 4 }}>
          <Stat label="Tipo" value="Informativa" hint="sin trades" />
          <Stat label="Universo" value={(universe.tickers ?? []).join(' · ') || '—'} />
          <Stat label="Max DTE" value={gex.max_dte ?? '—'} hint="toda la cadena" />
          <Stat label="0DTE" value={gex.include_zero_dte ? 'incluido' : 'excluido'} />
          <Stat label="Vencimientos" value={(gex.expiration_types ?? []).join(' · ') || '—'} />
        </div>
        {meta.purpose && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6 }}>{meta.purpose}</div>
        )}
      </Card>

      {/* B · Macro régimen — lectura, no gate */}
      <CollapsibleCard title={`B · Macro régimen (${checks.length} checks · lectura)`} titleColor="#a78bfa" defaultOpen>
        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 8, lineHeight: 1.5 }}>
          En GEX el régimen es contexto, no un gate: ningún check bloquea nada porque no hay trade
          (<span style={{ fontFamily: 'JetBrains Mono, monospace' }}>on_fail: {regimeOnFail}</span>).
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><TH>Check</TH><TH>Label</TH><TH>On fail</TH></tr></thead>
          <tbody>
            {checks.map((c: any) => (
              <tr key={c.id}>
                <TD mono>{c.id}</TD>
                <TD>{c.label ?? '—'}</TD>
                <TD mono color="var(--text-muted)">{c.on_fail ?? regimeOnFail}</TD>
              </tr>
            ))}
          </tbody>
        </table>
      </CollapsibleCard>

      {/* C · Config del barrido */}
      <CollapsibleCard title="C · Config del barrido" titleColor="var(--blue-gc)">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
          <Stat label="Max DTE" value={gex.max_dte ?? '—'} />
          <Stat label="Cache" value={gex.cache_seconds != null ? `${gex.cache_seconds}s` : '—'} hint="TTL del barrido" />
          <Stat label="Refresh" value={rules.display_config?.gex_tab?.refresh_seconds != null ? `${rules.display_config.gex_tab.refresh_seconds}s` : '—'} hint="auto-refresh front" />
          <Stat label="Batch Greeks" value={gex.greeks_batch_size ?? '—'} />
          <Stat label="Reintentos" value={gex.greeks_retries ?? '—'} hint="Greeks" />
          <Stat label="Cobertura mín" value={gex.cache_min_coverage_pct != null ? `${gex.cache_min_coverage_pct}%` : '—'} hint="para cachear" />
          {Array.isArray(gex.oi_delta_band) && <Stat label="Banda OI |Δ|" value={gex.oi_delta_band.join(' – ')} />}
          {zgl.formula && <Stat label="ZGL buffer" value={zgl.buffer_pct != null ? `${(zgl.buffer_pct * 100).toFixed(1)}%` : '—'} hint="sobre el flip" />}
        </div>
      </CollapsibleCard>

      {/* D · Umbral por símbolo — decide qué se evalúa */}
      <CollapsibleCard title="D · Umbral de GEX por símbolo" titleColor="var(--green)" defaultOpen>
        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 8, lineHeight: 1.5 }}>
          Este umbral decide qué símbolos se evalúan: el que no figura no se valida (celda gris "sin
          umbral", no roja). Sumar un símbolo al universo no alcanza — hay que declararle el umbral.
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><TH>Símbolo</TH><TH>Umbral</TH></tr></thead>
          <tbody>
            {(universe.tickers ?? []).map((sym: string) => {
              const v = thrValues[sym];
              const declared = v != null;
              return (
                <tr key={sym}>
                  <TD mono>{sym}</TD>
                  <TD mono color={declared ? 'var(--text-primary)' : 'var(--text-muted)'}>
                    {declared ? `≥ ${v}${thr.unit === 'billions_usd' ? 'B' : ''}` : 'sin umbral'}
                  </TD>
                </tr>
              );
            })}
          </tbody>
        </table>
      </CollapsibleCard>

      {/* E · Alcance — estructuras prohibidas */}
      {forbidden.length > 0 && (
        <CollapsibleCard title="E · Alcance" titleColor="var(--red-gc)">
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 8, lineHeight: 1.5 }}>
            {scope.note ?? 'Estrategia informativa: no selecciona ni sugiere estructura alguna.'}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {forbidden.map((f) => (
              <span key={f} style={{
                padding: '3px 8px', borderRadius: 4, fontSize: 10, fontFamily: 'JetBrains Mono, monospace',
                backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-dark)', color: 'var(--text-muted)',
                textDecoration: 'line-through',
              }}>
                {f}
              </span>
            ))}
          </div>
        </CollapsibleCard>
      )}
    </div>
  );
}

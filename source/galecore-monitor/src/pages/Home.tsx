import React from 'react';
import { StrategyCard } from '../components/strategies/StrategyCard';
import { ServiceCard } from '../components/strategies/ServiceCard';
import { useAppConfigStore } from '../store/useAppConfigStore';

interface Props {
  /** Navega a la pestaña de la estrategia. El dueño del estado `tab` es App.tsx. */
  onNavigate: (tab: string) => void;
}

/**
 * Main — pantalla de inicio de la plataforma.
 *
 * GaleCore no es una estrategia: es el contexto (API, feed, cuenta, tablero) sobre el que corren
 * proyectos de estrategias. Main es el índice de ese contexto — qué estrategias hay implementadas
 * y si están corriendo. La lista sale de `strategies[]` del config de la app: una estrategia que
 * no figura ahí existe en la API pero es invisible acá.
 */
export function Home({ onNavigate }: Props) {
  const { strategies, services, loading, error } = useAppConfigStore();

  return (
    <div style={{ padding: '16px 18px 40px', fontFamily: 'Inter, sans-serif' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 16 }}>
        <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>
          GaleCore Strategies
        </span>
        <span style={{
          fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase',
          color: 'var(--text-muted)',
        }}>
          switches de estrategia
        </span>
      </div>

      {loading && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Cargando configuración…</div>
      )}

      {error && (
        <div style={{ fontSize: 12, color: 'var(--red-gc)', fontFamily: 'JetBrains Mono, monospace' }}>
          ⚠ Error cargando la configuración de la app: {error}
        </div>
      )}

      {!loading && !error && strategies.length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
          No hay estrategias declaradas en <code>strategies[]</code> del config de la app.
        </div>
      )}

      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}
      >
        {strategies.map((s) => (
          <StrategyCard key={s.id} strategy={s} onOpen={() => onNavigate(s.tab)} />
        ))}
      </div>

      {/* Servicios de plataforma: procesos que corren solos y no son de ninguna estrategia. Están en
          Main, junto a las estrategias, porque el criterio de esta pantalla es el mismo para los dos
          —qué corre y si está prendido—; la diferencia es de quién es cada cosa.
          La cuenta de bróker se fue a la pestaña Admin: es administración de credenciales, no algo
          que corra. */}
      {services.length > 0 && (
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, margin: '28px 0 16px' }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>
              GaleCore Services
            </span>
            <span style={{
              fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase',
              color: 'var(--text-muted)',
            }}>
              switches de servicio
            </span>
          </div>

          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}
          >
            {services.map((s) => (
              <ServiceCard key={s.id} service={s} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

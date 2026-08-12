import React from 'react';
import { StrategyCard } from '../components/strategies/StrategyCard';
import { ServiceCard } from '../components/strategies/ServiceCard';
import { BrokerAccountCard } from '../components/account/BrokerAccountCard';
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

      {/* Plataforma — lo que no es de ninguna estrategia. La cuenta de bróker vive acá y no en una
          pestaña de estrategia porque es transversal: de ella salen los datos de mercado que todas
          consumen y los datos de cuenta que muestra el Monitor. Los servicios están por el mismo
          motivo: corren solos, no trabajan para ninguna estrategia en particular, y hasta ahora no
          había forma de cortarlos sin reiniciar la API. */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, margin: '28px 0 16px' }}>
        <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>
          Plataforma
        </span>
        <span style={{
          fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase',
          color: 'var(--text-muted)',
        }}>
          credenciales del operador · servicios
        </span>
      </div>

      <div style={{ maxWidth: 460 }}>
        <BrokerAccountCard />
      </div>

      {services.length > 0 && (
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', marginTop: 16 }}
        >
          {services.map((s) => (
            <ServiceCard key={s.id} service={s} />
          ))}
        </div>
      )}
    </div>
  );
}

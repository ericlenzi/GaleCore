import React, { useCallback, useEffect, useState } from 'react';
import { tint } from '../../utils/formatters';

interface Props {
  /** Estado actual. null = todavía no se leyó del backend (el switch queda inerte). */
  enabled: boolean | null;
  /** Lee el estado del backend al montar. */
  fetchState: () => Promise<{ enabled: boolean }>;
  /** Persiste el cambio en el backend. */
  setState: (enabled: boolean) => Promise<{ enabled: boolean }>;
  onChange: (enabled: boolean) => void;
  title?: string;
}

/**
 * Switch "Workers" de una estrategia (regla de CLAUDE.md: todo lo que corra solo se tiene que poder
 * cortar en el acto desde el front). El estado vive en el backend y persiste a disco, así que el
 * botón no es el dueño de la verdad: la lee al montar y la reescribe al togglear.
 */
export function WorkersSwitch({ enabled, fetchState, setState, onChange, title }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetchState()
      .then((s) => { onChange(s.enabled); setError(false); })
      .catch(() => setError(true));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = useCallback(() => {
    if (enabled == null || busy) return;
    const next = !enabled;
    setBusy(true);
    setState(next)
      .then((s) => { onChange(s.enabled); setError(false); })
      .catch(() => setError(true))
      .finally(() => setBusy(false));
  }, [enabled, busy, setState, onChange]);

  const unknown = enabled == null || error;
  const color = unknown ? 'var(--text-muted)' : enabled ? 'var(--green)' : 'var(--red-gc)';

  return (
    <button
      onClick={toggle}
      disabled={unknown || busy}
      title={error ? 'No se pudo leer el estado de los workers' : (title ?? 'Prender / apagar')}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 7,
        padding: '3px 9px', borderRadius: 20,
        backgroundColor: tint(color, 10), border: `1px solid ${tint(color, 30)}`,
        color, cursor: unknown || busy ? 'default' : 'pointer',
        fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
        fontFamily: 'JetBrains Mono, monospace', opacity: busy ? 0.6 : 1,
      }}
    >
      {/* Riel del switch */}
      <span style={{
        width: 22, height: 12, borderRadius: 20, flexShrink: 0,
        backgroundColor: tint(color, 30), position: 'relative', transition: 'background-color 150ms',
      }}>
        <span style={{
          position: 'absolute', top: 2, left: enabled ? 12 : 2,
          width: 8, height: 8, borderRadius: '50%', backgroundColor: color,
          transition: 'left 150ms',
        }} />
      </span>
      WORKERS {unknown ? '—' : enabled ? 'ON' : 'OFF'}
    </button>
  );
}

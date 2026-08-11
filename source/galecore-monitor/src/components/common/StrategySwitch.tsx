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
 * Switch de una estrategia (regla de CLAUDE.md: todo lo que corra solo se tiene que poder cortar en
 * el acto desde el front). El estado vive en el backend y persiste a disco, así que el botón no es
 * el dueño de la verdad: la lee al montar y la reescribe al togglear.
 *
 * Se llamaba WorkersSwitch y decía "WORKERS ON/OFF" hasta 2026-08-10. El nombre describía la
 * implementación —un BackgroundService que en GEX ni siquiera existe— y no lo que el operador hace
 * con él: apagar la estrategia ENTERA (loop, sockets, refresh y tablero). La etiqueta quedó en solo
 * ON/OFF: qué se apaga lo dice el contexto donde vive el switch.
 */
export function StrategySwitch({ enabled, fetchState, setState, onChange, title }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const read = useCallback(() => {
    setBusy(true);
    fetchState()
      .then((s) => { onChange(s.enabled); setError(false); })
      .catch(() => setError(true))
      .finally(() => setBusy(false));
  }, [fetchState, onChange]);

  useEffect(() => { read(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Un fallo NO deja el switch muerto. Antes `error` era un latch: se pintaba deshabilitado y
  // como estaba deshabilitado nunca se podia reintentar, asi que un POST que fallaba una vez
  // (p. ej. el broadcast del backend colgado) mataba el kill switch hasta recargar la pagina.
  // Ahora, con el estado desconocido el click reintenta leerlo; con estado conocido, togglea.
  const click = useCallback(() => {
    if (busy) return;
    if (enabled == null) { read(); return; }
    const next = !enabled;
    setBusy(true);
    setState(next)
      .then((s) => { onChange(s.enabled); setError(false); })
      .catch(() => setError(true))
      .finally(() => setBusy(false));
  }, [enabled, busy, setState, onChange, read]);

  const unknown = enabled == null;
  const color = error ? 'var(--yellow-gc)'
    : unknown ? 'var(--text-muted)'
    : enabled ? 'var(--green)' : 'var(--red-gc)';

  return (
    <button
      onClick={click}
      disabled={busy}
      title={error
        ? 'El backend no respondio. El estado que se muestra puede no ser el vigente — clickeá para reintentar.'
        : (title ?? 'Prender / apagar')}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 7,
        padding: '3px 9px', borderRadius: 20,
        backgroundColor: tint(color, 10), border: `1px solid ${tint(color, 30)}`,
        color, cursor: busy ? 'default' : 'pointer',
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
      {unknown ? '—' : enabled ? 'ON' : 'OFF'}{error ? ' ⚠' : ''}
    </button>
  );
}

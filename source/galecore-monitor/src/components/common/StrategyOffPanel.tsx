import React from 'react';
import { Ban } from 'lucide-react';
import { tint } from '../../utils/formatters';

interface Props {
  /** Qué deja de correr, en concreto. Genérico no sirve: el operador tiene que poder confirmar
   *  que lo que apagó es lo que él creía que apagaba. */
  detail: string;
}

/**
 * Lo ÚNICO que se muestra en la pantalla de una estrategia con su switch en OFF.
 *
 * La regla (CLAUDE.md): en OFF la estrategia no hace nada Y su tablero vuelve al estado inicial.
 * Hasta 2026-08-10 las dos pantallas seguían renderizando todo con el último dato, marcado como
 * "congelado" — pero un panel lleno de números se lee como vigente aunque diga que no lo está, y
 * ese fue el patrón de bugs que apareció todo ese día: valores plausibles que nadie confronta.
 *
 * Cortar el árbol acá también apaga actividad real, no solo píxeles: los efectos que suscriben al
 * hub viven dentro de los componentes que dejan de montarse.
 */
export function StrategyOffPanel({ detail }: Props) {
  const color = 'var(--red-gc)';
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 12,
      margin: '16px 0', padding: '18px 20px', borderRadius: 10,
      backgroundColor: tint(color, 6), border: `1px dashed ${tint(color, 30)}`,
    }}>
      <Ban size={20} style={{ color, flexShrink: 0, marginTop: 1 }} />
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color, marginBottom: 4, fontFamily: 'Inter, sans-serif' }}>
          Estrategia apagada
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', lineHeight: 1.5, fontFamily: 'Inter, sans-serif' }}>
          {detail}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, fontFamily: 'Inter, sans-serif' }}>
          Prendé el switch de arriba para volver a levantarla.
        </div>
      </div>
    </div>
  );
}

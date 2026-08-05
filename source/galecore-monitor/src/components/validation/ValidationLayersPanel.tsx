import React from 'react';
import { ValidationLayers } from './ValidationLayers';
import { MicrostructurePanel } from './MicrostructurePanel';
import { MarketDiagnostics } from '../ticker/MarketDiagnostics';
import { useValidationStore } from '../../store/useValidationStore';
import { mapValidationToLayers, EMPTY_LAYERS } from '../../utils/validationLayers';

interface Props {
  symbol: string;
}

// Cuadro superior de Main: header "{symbol} · Details" + dos columnas
// (Capa de Validaciones a la izquierda, Diagnóstico de mercado a la derecha).
// Read-only del useValidationStore (TickerDetail es dueño del fetch + auto-refresh).
export function ValidationLayersPanel({ symbol }: Props) {
  const cached = useValidationStore((s) => s.cache[symbol]);
  const vlData = cached?.vlData ?? null;
  const structureInputs = cached?.structureInputs ?? null;
  const layers = vlData ? mapValidationToLayers(vlData) : EMPTY_LAYERS;

  return (
    <div style={{
      borderRadius: 10,
      border: '1px solid var(--border)',
      backgroundColor: 'var(--bg-secondary)',
      boxShadow: 'var(--shadow-sm)',
      overflow: 'hidden',
    }}>
      {/* Header — formato de título atenuado (no barra tipo ventana) */}
      <div style={{
        fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase',
        color: 'var(--text-muted)', fontFamily: 'Inter, sans-serif',
        padding: '10px 12px 8px',
        borderBottom: '1px solid var(--border-dark)',
      }}>
        {symbol} · Details
      </div>

      {/* Body: tres columnas — capa 1, capa 3 y contexto de mercado.
          Validaciones va más ancha porque adentro tiene una grilla de 3 celdas por fila. */}
      <div style={{ display: 'flex', alignItems: 'stretch' }}>
        <div style={{ flex: 1.4, minWidth: 0, borderRight: '1px solid var(--border-dark)' }}>
          <ValidationLayers layers={layers} vlData={vlData} />
        </div>
        <div style={{ flex: 1, minWidth: 0, borderRight: '1px solid var(--border-dark)' }}>
          <MicrostructurePanel vlData={vlData} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <MarketDiagnostics inputs={structureInputs} />
        </div>
      </div>
    </div>
  );
}

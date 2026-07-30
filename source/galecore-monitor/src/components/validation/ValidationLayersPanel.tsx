import React from 'react';
import { ValidationLayers } from './ValidationLayers';
import { MarketDiagnostics } from '../ticker/MarketDiagnostics';
import { useValidationStore } from '../../store/useValidationStore';
import { mapValidationToLayers, EMPTY_LAYERS } from '../../utils/validationLayers';

interface Props {
  symbol: string;
}

// Cuadro propio para las capas de validación del símbolo activo. Lee del useValidationStore
// (populado por TickerDetail, que es dueño del fetch + auto-refresh); es read-only.
// Contiene: capas macro + microestructura (ValidationLayers) + diagnóstico de mercado.
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
      <ValidationLayers symbol={symbol} layers={layers} vlData={vlData} />
      <div style={{ borderTop: '1px solid var(--border-dark)' }}>
        <MarketDiagnostics inputs={structureInputs} />
      </div>
    </div>
  );
}

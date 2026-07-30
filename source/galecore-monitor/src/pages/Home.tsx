import React, { useState } from 'react';
import { TickerGrid } from '../components/ticker/TickerGrid';
import { TickerDetail } from '../components/ticker/TickerDetail';
import { ValidationLayersPanel } from '../components/validation/ValidationLayersPanel';
import { PortfolioManager } from './PortfolioManager';
import { useRulesStore } from '../store/useRulesStore';
import { ConnectionStatus } from '../socket/useMarketSocket';

interface Props {
  subscribeLeg: (occ: string) => void;
  unsubscribeLeg: (occ: string) => void;
  socketStatus: ConnectionStatus;
}

export function Home({ subscribeLeg, unsubscribeLeg, socketStatus }: Props) {
  const firstTicker = useRulesStore((s) => s.tickers[0] ?? null);
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const active = selectedSymbol ?? firstTicker;

  return (
    <div className="flex flex-col">
      <div className="p-3">
        <TickerGrid
          selectedSymbol={active}
          onSelect={setSelectedSymbol}
        />
      </div>

      {/* Capas de validación del símbolo activo — cuadro propio, antes del gráfico gamma */}
      {active && (
        <div style={{ margin: '0 12px 12px' }}>
          <ValidationLayersPanel symbol={active} />
        </div>
      )}

      {/* TickerDetail panel (gráfico gamma) */}
      {active && (
        <TickerDetail
          symbol={active}
          onClose={() => setSelectedSymbol(null)}
        />
      )}

      {/* Setup candidato del símbolo activo (Portfolio Manager scopeado) */}
      {active && (
        <div className="p-3">
          <PortfolioManager
            symbols={[active]}
            embedded
            subscribeLeg={subscribeLeg}
            unsubscribeLeg={unsubscribeLeg}
            socketStatus={socketStatus}
          />
        </div>
      )}
    </div>
  );
}

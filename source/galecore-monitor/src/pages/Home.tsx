import React, { useState } from 'react';
import { TickerGrid } from '../components/ticker/TickerGrid';
import { TickerDetail } from '../components/ticker/TickerDetail';
import { useRulesStore } from '../store/useRulesStore';

export function Home() {
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

      {/* TickerDetail panel */}
      {active && (
        <TickerDetail
          symbol={active}
          onClose={() => setSelectedSymbol(null)}
        />
      )}
    </div>
  );
}

import React, { useState } from 'react';
import { TickerGrid } from '../components/ticker/TickerGrid';
import { TickerDetail } from '../components/ticker/TickerDetail';

export function Home() {
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);

  return (
    <div className="flex flex-col">
      <div className="p-3">
        <TickerGrid
          selectedSymbol={selectedSymbol}
          onSelect={setSelectedSymbol}
        />
      </div>

      {/* TickerDetail panel */}
      {selectedSymbol && (
        <TickerDetail
          symbol={selectedSymbol}
          onClose={() => setSelectedSymbol(null)}
        />
      )}
    </div>
  );
}

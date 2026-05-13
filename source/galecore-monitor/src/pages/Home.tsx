import React, { useState } from 'react';
import { AccountSummary } from '../components/account/AccountSummary';
import { TickerGrid } from '../components/ticker/TickerGrid';
import { TickerDetail } from '../components/ticker/TickerDetail';

export function Home() {
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);

  return (
    <div className="flex flex-col">
      {/* Top: AccountSummary + TickerGrid */}
      <div className="flex gap-3 p-3">
        <div className="shrink-0">
          <AccountSummary />
        </div>
        <div className="flex-1 min-w-0">
          <TickerGrid
            selectedSymbol={selectedSymbol}
            onSelect={setSelectedSymbol}
          />
        </div>
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

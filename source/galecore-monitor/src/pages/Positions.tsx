import React from 'react';
import { Monitor } from './Monitor';
import { ConnectionStatus } from '../socket/useMarketSocket';

// Positions page is an alias for Monitor — use Monitor directly from App.tsx
// This file is kept for backward compat; prefer importing Monitor with socket props.
const noop = () => {};
const noopStatus: ConnectionStatus = 'disconnected';

export function Positions() {
  return <Monitor subscribeLeg={noop} unsubscribeLeg={noop} socketStatus={noopStatus} />;
}

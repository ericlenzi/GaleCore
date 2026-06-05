import React from 'react';
import { PositionMonitor } from '../components/positions/PositionMonitor';
import { ConnectionStatus } from '../socket/useMarketSocket';

interface Props {
  subscribeLeg:   (sym: string) => void;
  unsubscribeLeg: (sym: string) => void;
  socketStatus:   ConnectionStatus;
}

export function Monitor({ subscribeLeg, unsubscribeLeg, socketStatus }: Props) {
  return (
    <PositionMonitor
      subscribeLeg={subscribeLeg}
      unsubscribeLeg={unsubscribeLeg}
      socketStatus={socketStatus}
    />
  );
}

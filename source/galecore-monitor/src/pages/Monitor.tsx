import React from 'react';
import { PositionMonitor } from '../components/positions/PositionMonitor';
import { ConnectionStatus } from '../socket/useMarketSocket';

interface Props {
  subscribeLeg:   (sym: string) => void;
  unsubscribeLeg: (sym: string) => void;
  /** Para los SUBYACENTES de las posiciones (sin Greeks). Ver el comentario en PositionMonitor. */
  subscribeSymbol:   (sym: string) => void;
  unsubscribeSymbol: (sym: string) => void;
  socketStatus:   ConnectionStatus;
}

export function Monitor({ subscribeLeg, unsubscribeLeg, subscribeSymbol, unsubscribeSymbol, socketStatus }: Props) {
  return (
    <PositionMonitor
      subscribeLeg={subscribeLeg}
      unsubscribeLeg={unsubscribeLeg}
      subscribeSymbol={subscribeSymbol}
      unsubscribeSymbol={unsubscribeSymbol}
      socketStatus={socketStatus}
    />
  );
}

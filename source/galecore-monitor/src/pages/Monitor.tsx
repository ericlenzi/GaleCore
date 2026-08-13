import React from 'react';
import { PositionMonitor } from '../components/positions/PositionMonitor';
import { SectionTitle } from '../components/common/SectionTitle';
import { ConnectionStatus } from '../socket/useMarketSocket';

interface Props {
  subscribeLeg:   (sym: string) => void;
  unsubscribeLeg: (sym: string) => void;
  /** Para los SUBYACENTES de las posiciones (sin Greeks). Ver el comentario en PositionMonitor. */
  subscribeSymbol:   (sym: string) => void;
  unsubscribeSymbol: (sym: string) => void;
  socketStatus:   ConnectionStatus;
}

/**
 * Monitor — posiciones abiertas de la cuenta. Es TRANSVERSAL: monitorea lo que hay en la cuenta sin
 * importar qué estrategia lo abrió, y por eso no tiene switch ni References.
 *
 * El título vive acá y no en `PositionMonitor` para no meterle chrome de página a un componente que
 * es contenido. `minHeight: 0` en el contenedor del scroll no es decorativo: sin él, un hijo con
 * `height: 100%` dentro de un flex column desborda en vez de scrollear.
 */
export function Monitor({ subscribeLeg, unsubscribeLeg, subscribeSymbol, unsubscribeSymbol, socketStatus }: Props) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', fontFamily: 'Inter, sans-serif' }}>
      <SectionTitle
        title="GaleCore Monitor"
        badge="Positions Manager"
        style={{ padding: '14px 18px 12px', flexShrink: 0 }}
      />

      <div style={{ flex: 1, minHeight: 0 }}>
        <PositionMonitor
          subscribeLeg={subscribeLeg}
          unsubscribeLeg={unsubscribeLeg}
          subscribeSymbol={subscribeSymbol}
          unsubscribeSymbol={unsubscribeSymbol}
          socketStatus={socketStatus}
        />
      </div>
    </div>
  );
}

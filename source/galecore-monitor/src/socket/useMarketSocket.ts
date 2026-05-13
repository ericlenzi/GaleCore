import { useEffect, useRef, useState } from 'react';
import * as signalR from '@microsoft/signalr';
import { useMarketStore } from '../store/useMarketStore';
import { TradePayload, QuotePayload } from '../types/api';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export function useMarketSocket(tickers: string[] = []) {
  const connectionRef = useRef<signalR.HubConnection | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const { updatePrice, updateQuote, setStreaming } = useMarketStore();

  useEffect(() => {
    if (!tickers.length) return;

    const hubUrl = process.env.REACT_APP_SIGNALR_HUB_URL;
    if (!hubUrl) {
      console.error('REACT_APP_SIGNALR_HUB_URL is not set');
      setStatus('error');
      return;
    }
    const apiKey = sessionStorage.getItem('galecore:apiKey') ?? '';

    const connection = new signalR.HubConnectionBuilder()
      .withUrl(`${hubUrl}?apiKey=${encodeURIComponent(apiKey)}`, {
        headers: { 'X-API-KEY': apiKey },
        transport: signalR.HttpTransportType.LongPolling,
      })
      .withAutomaticReconnect()
      .configureLogging(signalR.LogLevel.Warning)
      .build();

    connectionRef.current = connection;

    connection.on('ReceiveTrade', (symbol: string, data: TradePayload) => {
      updatePrice(symbol, data);
    });

    connection.on('ReceiveQuote', (symbol: string, data: QuotePayload) => {
      updateQuote(symbol, data);
    });

    connection.onreconnecting(() => {
      setStatus('connecting');
      tickers.forEach((s) => setStreaming(s, false));
    });

    connection.onreconnected(() => {
      setStatus('connected');
      tickers.forEach((symbol) => {
        connection.invoke('Subscribe', symbol, false).catch(console.error);
        setStreaming(symbol, true);
      });
    });

    connection.onclose(() => {
      setStatus('disconnected');
      tickers.forEach((s) => setStreaming(s, false));
    });

    setStatus('connecting');
    connection
      .start()
      .then(() => {
        setStatus('connected');
        tickers.forEach((symbol) => {
          connection.invoke('Subscribe', symbol, false).catch(console.error);
        });
      })
      .catch((err) => {
        console.error('SignalR connection error:', err);
        setStatus('error');
      });

    return () => {
      if (connection.state === signalR.HubConnectionState.Connected) {
        tickers.forEach((symbol) => {
          connection.invoke('Unsubscribe', symbol, false).catch(() => {});
        });
      }
      connection.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickers.join(',')]);

  return { status };
}

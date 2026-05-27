import { useEffect, useRef, useState, useCallback } from 'react';
import * as signalR from '@microsoft/signalr';
import { useMarketStore } from '../store/useMarketStore';
import { useFlowStore } from '../store/useFlowStore';
import { TradePayload, QuotePayload, FlowPayload } from '../types/api';

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

    // ── Price handlers ────────────────────────────────────────────────────
    connection.on('ReceiveTrade', (symbol: string, data: TradePayload) => {
      updatePrice(symbol, data);
    });

    connection.on('ReceiveQuote', (symbol: string, data: QuotePayload) => {
      updateQuote(symbol, data);
    });

    // ── Flow handler ──────────────────────────────────────────────────────
    connection.on('ReceiveFlow', (symbol: string, data: FlowPayload) => {
      useFlowStore.getState().updateFlow(symbol, data);
    });

    // ── Reconnect logic ───────────────────────────────────────────────────
    connection.onreconnecting(() => {
      setStatus('connecting');
      tickers.forEach((s) => setStreaming(s, false));
    });

    connection.onreconnected(() => {
      setStatus('connected');
      // Re-subscribe price tickers
      tickers.forEach((symbol) => {
        connection.invoke('Subscribe', symbol, false).catch(console.error);
        setStreaming(symbol, true);
      });
      // Re-subscribe flow symbols
      const flowSymbols = useFlowStore.getState().subscribedSymbols;
      flowSymbols.forEach((symbol) => {
        connection.invoke('SubscribeFlow', symbol, null, null).catch(console.error);
      });
    });

    connection.onclose(() => {
      setStatus('disconnected');
      tickers.forEach((s) => setStreaming(s, false));
    });

    // ── Start connection ──────────────────────────────────────────────────
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
        // Unsubscribe flow symbols
        const flowSymbols = useFlowStore.getState().subscribedSymbols;
        flowSymbols.forEach((symbol) => {
          connection.invoke('UnsubscribeFlow', symbol).catch(() => {});
        });
      }
      connection.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickers.join(',')]);

  // ── Flow subscription methods ─────────────────────────────────────────
  const subscribeFlow = useCallback(
    (symbol: string, expirationDate?: string, flowWindowMinutes?: number) => {
      const conn = connectionRef.current;
      if (conn?.state === signalR.HubConnectionState.Connected) {
        conn
          .invoke('SubscribeFlow', symbol, expirationDate ?? null, flowWindowMinutes ?? null)
          .then(() => useFlowStore.getState().addSubscription(symbol))
          .catch(console.error);
      }
    },
    [],
  );

  const unsubscribeFlow = useCallback((symbol: string) => {
    const conn = connectionRef.current;
    if (conn?.state === signalR.HubConnectionState.Connected) {
      conn.invoke('UnsubscribeFlow', symbol).catch(console.error);
    }
    useFlowStore.getState().removeSubscription(symbol);
    useFlowStore.getState().clearFlow(symbol);
  }, []);

  return { status, subscribeFlow, unsubscribeFlow };
}

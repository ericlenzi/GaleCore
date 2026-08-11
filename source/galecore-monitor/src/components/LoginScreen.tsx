import React, { useState } from 'react';
import apiClient from '../api/client';
import { AUTH_UNVERIFIED } from '../utils/authState';

interface Props {
  onAuthenticated: () => void;
}

export function LoginScreen({ onAuthenticated }: Props) {
  const [apiKey, setApiKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiKey.trim()) return;

    setLoading(true);
    setError(null);

    // Store temporarily so the interceptor can use it for validation
    sessionStorage.setItem('galecore:apiKey', apiKey.trim());

    try {
      // La ruta correcta lleva el segmento del proveedor. Hasta 2026-08-10 esto pegaba a
      // '/Data/Account/Balances', que NO EXISTE: devolvía 404 siempre, el 404 caía al else de abajo
      // y el else llamaba a onAuthenticated(). Resultado: la Access Key nunca se validaba y cualquier
      // clave dejaba entrar. La rama de "Invalid access key" era código muerto que nunca corrió.
      await apiClient.get('/Data/Tastytrade/Account/Balances');
      sessionStorage.removeItem(AUTH_UNVERIFIED);
      onAuthenticated();
    } catch (err: any) {
      if (err?.response?.status === 401) {
        // La API respondió y rechazó la clave. Es un no.
        sessionStorage.removeItem('galecore:apiKey');
        sessionStorage.removeItem(AUTH_UNVERIFIED);
        setError('Invalid access key');
      } else {
        // La API NO respondió (caída, timeout, CORS). Distinto de "la clave está mal": dejar al
        // operador afuera cuando el backend no contesta le impide incluso abrir el tablero para ver
        // que el backend no contesta. Se entra, pero marcado — la StatusBar muestra SIN VALIDAR,
        // porque entrar sin verificación no puede verse igual que entrar verificado.
        sessionStorage.setItem(AUTH_UNVERIFIED, '1');
        onAuthenticated();
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ backgroundColor: 'var(--bg-primary)' }}
    >
      <div
        className="w-80 rounded-lg p-8"
        style={{
          backgroundColor: 'var(--bg-secondary)',
          border: '1px solid var(--border-dark)',
        }}
      >
        {/* Logo / Title */}
        <div className="text-center mb-8">
          <div
            className="text-2xl font-bold tracking-widest mb-1"
            style={{ color: 'var(--text-primary)', fontFamily: 'Inter, sans-serif' }}
          >
            GALECORE
          </div>
          <div className="text-xs tracking-widest uppercase" style={{ color: 'var(--blue-gc)' }}>
            OPTIONS TRADING MONITOR
          </div>
        </div>

        <form onSubmit={handleConnect} className="space-y-4">
          <div>
            <label
              htmlFor="apikey"
              className="block text-xs tracking-wider mb-1"
              style={{ color: 'var(--text-muted)' }}
            >
              Access Key
            </label>
            <input
              id="apikey"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              autoFocus
              className="w-full px-3 py-2 rounded text-sm font-mono outline-none"
              style={{
                backgroundColor: 'var(--bg-tertiary)',
                border: '1px solid var(--border-dark)',
                color: 'var(--text-primary)',
              }}
              placeholder="••••••••••••"
            />
          </div>

          {error && (
            <div
              className="text-xs py-2 px-3 rounded"
              style={{ backgroundColor: 'rgba(239,68,68,0.12)', color: 'var(--red-gc)' }}
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !apiKey.trim()}
            className="w-full py-2 rounded text-sm font-medium transition-opacity"
            style={{
              backgroundColor: loading || !apiKey.trim() ? 'var(--bg-tertiary)' : 'var(--blue-gc)',
              color: loading || !apiKey.trim() ? 'var(--text-muted)' : '#fff',
              cursor: loading || !apiKey.trim() ? 'not-allowed' : 'pointer',
              border: 'none',
            }}
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="spinner" style={{ width: 14, height: 14 }} />
                Connecting…
              </span>
            ) : (
              'Connect'
            )}
          </button>
        </form>
      </div>
    </div>
  );
}

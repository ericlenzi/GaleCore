import React, { useState } from 'react';
import apiClient from '../api/client';

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
      await apiClient.get('/Data/Account/Balances');
      onAuthenticated();
    } catch (err: any) {
      if (err?.response?.status === 401) {
        sessionStorage.removeItem('galecore:apiKey');
        setError('Invalid access key');
      } else {
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

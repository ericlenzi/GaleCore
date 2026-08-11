import React, { useState } from 'react';
import { signIn, supabaseConfigured } from '../auth/supabase';

interface Props {
  onAuthenticated: () => void;
}

/**
 * Entrada al tablero, con usuario y contraseña de Supabase.
 *
 * Reemplaza a la pantalla de Access Key, que tenía dos problemas de fondo: la clave era COMPARTIDA
 * (no identificaba a nadie, así que la API no podía saber de quién era la cuenta de bróker que
 * estaba sirviendo) y no servía para autenticar el hub, porque en el upgrade a WebSocket el
 * navegador no deja mandar headers propios.
 *
 * La sesión la administra supabase-js: la guarda y renueva el access token sola antes de que venza.
 */
export function LoginScreen({ onAuthenticated }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = email.trim().length > 0 && password.length > 0 && supabaseConfigured;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    setLoading(true);
    setError(null);

    try {
      const { error: authError } = await signIn(email.trim(), password);

      if (authError) {
        // Supabase distingue credenciales inválidas de problemas de red. Mostrar el motivo real
        // evita que el operador pruebe la contraseña diez veces cuando el problema es la conexión.
        setError(
          authError.message === 'Invalid login credentials'
            ? 'Usuario o contraseña incorrectos'
            : authError.message
        );
        return;
      }

      onAuthenticated();
    } catch (err: any) {
      setError(err?.message || 'No se pudo conectar con el servicio de autenticación');
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

        {!supabaseConfigured && (
          <div
            className="text-xs py-2 px-3 rounded mb-4"
            style={{ backgroundColor: 'rgba(239,68,68,0.12)', color: 'var(--red-gc)' }}
          >
            Falta configurar REACT_APP_SUPABASE_URL y REACT_APP_SUPABASE_ANON_KEY.
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="email"
              className="block text-xs tracking-wider mb-1"
              style={{ color: 'var(--text-muted)' }}
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
              className="w-full px-3 py-2 rounded text-sm font-mono outline-none"
              style={{
                backgroundColor: 'var(--bg-tertiary)',
                border: '1px solid var(--border-dark)',
                color: 'var(--text-primary)',
              }}
              placeholder="operador@ejemplo.com"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="block text-xs tracking-wider mb-1"
              style={{ color: 'var(--text-muted)' }}
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
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
            disabled={loading || !canSubmit}
            className="w-full py-2 rounded text-sm font-medium transition-opacity"
            style={{
              backgroundColor: loading || !canSubmit ? 'var(--bg-tertiary)' : 'var(--blue-gc)',
              color: loading || !canSubmit ? 'var(--text-muted)' : '#fff',
              cursor: loading || !canSubmit ? 'not-allowed' : 'pointer',
              border: 'none',
            }}
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="spinner" style={{ width: 14, height: 14 }} />
                Entrando…
              </span>
            ) : (
              'Entrar'
            )}
          </button>
        </form>
      </div>
    </div>
  );
}

import { createClient, Session } from '@supabase/supabase-js';

/**
 * Cliente de Supabase Auth: la identidad del operador.
 *
 * La anon key es PUBLICA por diseño — va embebida en el bundle y su seguridad no depende de
 * ocultarla, sino de las políticas del lado de Supabase y de que la API valide el JWT. Por eso vive
 * en .env y no en un secreto.
 *
 * La librería guarda la sesión en localStorage y RENUEVA el access token sola antes de que venza
 * (duran una hora). Esa es la razón de usarla en vez de pegarle a /auth/v1/token con fetch: sin
 * renovación automática, el tablero se quedaría sin datos a la hora de haber entrado.
 */
const url = process.env.REACT_APP_SUPABASE_URL || '';
const anonKey = process.env.REACT_APP_SUPABASE_ANON_KEY || '';

export const supabaseConfigured = Boolean(url && anonKey);

export const supabase = createClient(url || 'http://localhost', anonKey || 'anon', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});

/**
 * Access token vigente, o null si no hay sesión.
 *
 * Pasa por getSession() en cada llamada a propósito: ahí es donde la librería decide si el token
 * está por vencer y lo renueva. Cachearlo por fuera sería quedarse con uno vencido.
 */
export async function getAccessToken(): Promise<string | null> {
  if (!supabaseConfigured) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export async function getSession(): Promise<Session | null> {
  if (!supabaseConfigured) return null;
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function signIn(email: string, password: string) {
  return supabase.auth.signInWithPassword({ email, password });
}

export async function signOut() {
  await supabase.auth.signOut();
}

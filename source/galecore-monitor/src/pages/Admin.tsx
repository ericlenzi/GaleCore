import React, { useCallback, useEffect, useState } from 'react';
import { Shield, RefreshCw, User as UserIcon } from 'lucide-react';
import { AdminUser, fetchAdminUsers, setAdminUserRole } from '../api/admin';
import { useCurrentUserStore } from '../store/useCurrentUserStore';
import { tint } from '../utils/formatters';

const ACCENT = '#a78bfa';

const thStyle: React.CSSProperties = {
  padding: '7px 10px', fontSize: 9.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
  color: 'var(--text-muted)', textAlign: 'left', fontFamily: 'Inter, sans-serif',
  borderBottom: '1px solid var(--border-dark)', whiteSpace: 'nowrap', backgroundColor: 'var(--bg-tertiary)',
};
const tdStyle: React.CSSProperties = {
  padding: '10px', fontFamily: 'JetBrains Mono, monospace', fontSize: 12,
  color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-dark)', verticalAlign: 'middle',
};

const Pill = ({ children, color, title }: { children: React.ReactNode; color: string; title?: string }) => (
  <span
    title={title}
    style={{
      fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
      padding: '2px 7px', borderRadius: 4, fontFamily: 'JetBrains Mono, monospace',
      color, backgroundColor: tint(color, 13), border: `1px solid ${tint(color, 30)}`,
    }}
  >
    {children}
  </span>
);

/**
 * Administrator — quién es quién en la plataforma. Solo para admins.
 *
 * NO DA DE ALTA USUARIOS, y no es una omisión: la identidad la maneja Supabase Auth y las altas se
 * hacen en su panel. Traerlas acá obligaría a meter la `service_role` key —la llave maestra del
 * proyecto— dentro de la aplicación, para una operación que con dos operadores pasa una vez cada
 * tanto. La fila local de cada usuario nace sola en su primer request autenticado.
 *
 * TAMPOCO MUESTRA LAS CUENTAS DE BRÓKER AJENAS. Un admin administra usuarios, no sus credenciales:
 * de la cuenta de otro solo se ve si existe, nunca el número ni el token. Cada uno administra la
 * suya desde Main.
 *
 * El gate real está en el endpoint (403), no en que esta pestaña esté escondida: ocultar una
 * pantalla no es seguridad.
 */
export function Admin() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const reloadCurrentUser = useCurrentUserStore((s) => s.reload);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAdminUsers();
      setUsers(data.users);
      setCurrentUserId(data.currentUserId);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'No se pudo leer la lista de usuarios');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleAdmin = async (u: AdminUser) => {
    setBusyId(u.id);
    setError(null);
    try {
      await setAdminUserRole(u.id, !u.isAdmin);
      await load();

      // Si me saqué el permiso a mí mismo, la pestaña y los switches tienen que reflejarlo YA. Sin
      // esto seguirían habilitados hasta recargar la página, prometiendo algo que la API rechaza.
      if (u.id === currentUserId) await reloadCurrentUser();
    } catch (err: any) {
      // El backend rechaza dejar la plataforma sin ningún admin y explica por qué: se muestra su
      // mensaje tal cual en vez de un "error al guardar" que no ayuda a nadie.
      setError(err?.response?.data?.error || err?.message || 'No se pudo cambiar el permiso');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div style={{ padding: '16px 18px 40px', fontFamily: 'Inter, sans-serif' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <Shield size={15} style={{ color: ACCENT }} />
        <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>Administrator</span>
        <span style={{
          fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase',
          color: 'var(--text-muted)',
        }}>
          usuarios · permisos
        </span>
        <button onClick={load} className="btn" title="Releer la lista" style={{ marginLeft: 'auto' }} disabled={loading}>
          <RefreshCw size={11} />
          Releer
        </button>
      </div>

      <div style={{ fontSize: 10.5, color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: 16, maxWidth: 760 }}>
        Las altas se hacen en el panel de Supabase; acá aparecen solos la primera vez que entran al
        tablero. <strong style={{ color: 'var(--text-secondary)' }}>Admin</strong> habilita prender y
        apagar estrategias y servicios, que afecta a todos los operadores. De las cuentas de bróker
        ajenas solo se ve si existen: cada uno administra la suya desde Main.
      </div>

      {error && (
        <div className="text-xs py-2 px-3 rounded" style={{ backgroundColor: 'rgba(239,68,68,0.12)', color: 'var(--red-gc)', marginBottom: 14, maxWidth: 760 }}>
          {error}
        </div>
      )}

      {loading && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Cargando usuarios…</div>}

      {!loading && users.length === 0 && !error && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          No hay usuarios en la base todavía.
        </div>
      )}

      {!loading && users.length > 0 && (
        <div style={{
          border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden',
          backgroundColor: 'var(--bg-secondary)', maxWidth: 900,
        }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thStyle}>Usuario</th>
                  <th style={thStyle}>Cuenta de bróker</th>
                  <th style={thStyle}>Desde</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Admin</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const soyYo = u.id === currentUserId;
                  const busy = busyId === u.id;
                  return (
                    <tr key={u.id}>
                      <td style={tdStyle}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <UserIcon size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                          <span style={{ color: 'var(--text-primary)' }}>{u.email}</span>
                          {soyYo && <Pill color="var(--blue-gc)">vos</Pill>}
                          {u.displayName && (
                            <span style={{ color: 'var(--text-muted)', fontSize: 10.5 }}>{u.displayName}</span>
                          )}
                        </div>
                      </td>
                      <td style={tdStyle}>
                        {u.hasBrokerAccount ? (
                          <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                            <Pill color="var(--green)">vinculada</Pill>
                            {u.hasSystemAccount && (
                              <Pill color={ACCENT} title="Con esta cuenta los procesos de fondo piden datos de mercado.">
                                sistema
                              </Pill>
                            )}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--text-muted)' }}>—</span>
                        )}
                      </td>
                      <td style={{ ...tdStyle, color: 'var(--text-muted)', fontSize: 11 }}>
                        {new Date(u.createdAt).toLocaleDateString()}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>
                        <button
                          onClick={() => toggleAdmin(u)}
                          disabled={busy}
                          title={u.isAdmin
                            ? 'Sacarle el permiso de admin'
                            : 'Darle permiso de admin: podrá prender y apagar estrategias para todos'}
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: 7,
                            padding: '3px 9px', borderRadius: 20,
                            backgroundColor: tint(u.isAdmin ? ACCENT : 'var(--text-muted)', 10),
                            border: `1px solid ${tint(u.isAdmin ? ACCENT : 'var(--text-muted)', 30)}`,
                            color: u.isAdmin ? ACCENT : 'var(--text-muted)',
                            cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1,
                            fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
                            fontFamily: 'JetBrains Mono, monospace',
                          }}
                        >
                          <span style={{
                            width: 22, height: 12, borderRadius: 20, flexShrink: 0, position: 'relative',
                            backgroundColor: tint(u.isAdmin ? ACCENT : 'var(--text-muted)', 30),
                            transition: 'background-color 150ms',
                          }}>
                            <span style={{
                              position: 'absolute', top: 2, left: u.isAdmin ? 12 : 2,
                              width: 8, height: 8, borderRadius: '50%',
                              backgroundColor: u.isAdmin ? ACCENT : 'var(--text-muted)',
                              transition: 'left 150ms',
                            }} />
                          </span>
                          {u.isAdmin ? 'SÍ' : 'NO'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

import apiClient from './client';

/**
 * Un usuario de la plataforma, como lo ve un admin.
 *
 * NO trae la cuenta de bróker ajena, y es a propósito: un admin administra usuarios, no sus
 * credenciales. Lo único que se expone es el metadato administrativo — si tiene cuenta vinculada y
 * si es la de sistema —, nunca el número de cuenta ni el refresh token.
 */
export interface AdminUser {
  id: string;
  email: string;
  displayName?: string | null;
  isAdmin: boolean;
  createdAt: string;
  hasBrokerAccount: boolean;
  hasSystemAccount: boolean;
}

export interface AdminUsersResponse {
  users: AdminUser[];
  /** Para que la pantalla pueda marcar "sos vos" sin volver a pedir /Me. */
  currentUserId: string | null;
}

export async function fetchAdminUsers(): Promise<AdminUsersResponse> {
  const { data } = await apiClient.get<AdminUsersResponse>('/App/GaleCore/Admin/Users');
  return data;
}

/**
 * Prende o apaga el permiso de admin de un usuario.
 *
 * El backend RECHAZA dejar la plataforma sin ningún admin: sin admins, el kill switch de las
 * estrategias no se puede tocar desde ningún tablero y hay que arreglarlo con SQL. Si pasa, la
 * respuesta trae el motivo en `error` y la pantalla lo muestra tal cual.
 */
export async function setAdminUserRole(id: string, isAdmin: boolean): Promise<{ id: string; isAdmin: boolean }> {
  const { data } = await apiClient.patch(`/App/GaleCore/Admin/Users/${id}`, { isAdmin });
  return data;
}

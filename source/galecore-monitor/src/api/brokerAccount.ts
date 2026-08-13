import apiClient from './client';

/**
 * Cuenta de bróker vinculada al usuario logueado.
 *
 * El refresh token NUNCA vuelve por acá: entra cifrado a la base y no sale más por HTTP. Lo único
 * que se puede leer es qué cuenta hay vinculada y desde cuándo.
 */
export interface BrokerAccountState {
  linked: boolean;
  broker?: string;
  accountNumber?: string;
  /** Marca la cuenta que usan los procesos de fondo para pedir datos de MERCADO. Hay una sola. */
  isSystem?: boolean;
  updatedAt?: string;
}

export async function fetchBrokerAccount(): Promise<BrokerAccountState> {
  const { data } = await apiClient.get<BrokerAccountState>('/App/GaleCore/Account');
  return data;
}

/**
 * Vincula o actualiza la cuenta. El uuid del usuario sale del token, no del body: por eso desde acá
 * no se puede vincular una cuenta al usuario de otro.
 *
 * Es el único camino correcto para cambiar el refresh token — es quien lo cifra con la clave del
 * servidor antes de guardarlo. Un UPDATE a mano contra Postgres dejaría la fila ilegible.
 */
export async function linkBrokerAccount(
  accountNumber: string,
  refreshToken: string,
): Promise<{ linked: boolean; accountNumber: string }> {
  const { data } = await apiClient.post('/App/GaleCore/Account', { accountNumber, refreshToken });
  return data;
}

/**
 * Desvincula la cuenta propia. Borra la fila, o sea también el refresh token cifrado — no hay
 * "desvincular pero guardar por las dudas": una credencial que nadie sabe que sigue ahí es
 * justamente lo que no se quiere.
 *
 * `wasSystem` avisa que la que se borró era la cuenta de sistema, con la que los procesos de fondo
 * piden datos de mercado. No se bloquea (a veces desvincular una credencial comprometida es
 * exactamente lo que hay que hacer), pero la pantalla tiene que decirlo fuerte.
 */
export async function unlinkBrokerAccount(): Promise<{ linked: false; wasSystem?: boolean }> {
  const { data } = await apiClient.delete('/App/GaleCore/Account');
  return data;
}

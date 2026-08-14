import apiClient from './client';
import { BalancesResponse, PositionResponse } from '../types/api';

/** Lo que devuelve la API cuando el usuario todavía no vinculó su cuenta (409). */
const NOT_LINKED = 'broker_account_not_linked';

const NOT_LINKED_MESSAGE =
  'No tenés una cuenta de bróker configurada. Vinculala en Mi Cuenta › Cuenta de bróker.';

export interface AccountFailure {
  /** Lo que se le muestra al operador. */
  message: string;
  /**
   * El caso esperado: todavía no vinculó su cuenta. Es un dato aparte del mensaje porque el Monitor
   * decide con él si muestra su cartel, y matchear el texto para eso se rompe al reescribirlo.
   */
  brokerAccountMissing: boolean;
}

/**
 * Traduce un fallo de los endpoints de cuenta a algo que el operador pueda accionar.
 *
 * NO VINCULAR LA CUENTA ES EL ESTADO NORMAL DE UN OPERADOR RECIÉN DADO DE ALTA, así que mostrarle
 * "Request failed with status code 500" —que es lo que salía— lo deja mirando un error de servidor
 * cuando lo único que le falta es cargar sus credenciales. Cualquier otra falla se muestra tal
 * cual: si la API se cayó de verdad, decirle "vinculá tu cuenta" lo manda a buscar donde no es.
 */
export function describeAccountError(err: any): AccountFailure {
  const data = err?.response?.data;

  // El caso esperado, con el contrato de hoy.
  if (data?.code === NOT_LINKED) {
    return { message: NOT_LINKED_MESSAGE, brokerAccountMissing: true };
  }

  // Una API anterior al 409 lo tiraba como 500 con el texto de la excepción en el cuerpo. Se
  // reconoce por el texto para que el tablero no dependa de que la API esté al día; se puede sacar
  // cuando no quede ninguna vieja corriendo.
  const body = typeof data === 'string' ? data : '';
  if (body.includes('no tiene una cuenta de bróker vinculada')) {
    return { message: NOT_LINKED_MESSAGE, brokerAccountMissing: true };
  }

  return {
    message: data?.error || err?.message || 'No se pudieron leer los datos de la cuenta.',
    brokerAccountMissing: false,
  };
}

export async function fetchBalances(): Promise<BalancesResponse> {
  const { data } = await apiClient.get<unknown>('/Data/Tastytrade/Account/Balances');
  console.debug('[Account/Balances] response:', data);

  // Unwrap possible { data: {...} } wrapper
  const raw = ((data as any)?.data ?? data) as Record<string, unknown>;

  return {
    accountNumber:
      (raw.accountNumber as string) ??
      (raw['account-number'] as string) ?? '',

    netLiquidatingValue:
      (raw.netLiquidatingValue as number) ??
      (raw.netLiquidation as number) ??
      (raw['net-liquidating-value'] as number) ?? 0,

    buyingPower:
      (raw.buyingPower as number) ??
      (raw.cashBuyingPower as number) ??
      (raw.derivativeBuyingPower as number) ??
      (raw['buying-power'] as number) ??
      (raw['derivative-buying-power'] as number) ?? 0,

    cash:
      (raw.cash as number) ??
      (raw.cashBalance as number) ??
      (raw['cash-balance'] as number) ??
      (raw.cashAvailableToWithdraw as number) ?? 0,

    maintenanceRequirement:
      (raw.maintenanceRequirement as number | undefined) ??
      (raw['maintenance-requirement'] as number | undefined),

    timestamp: (raw.timestamp as string) ?? new Date().toISOString(),
  };
}

export async function fetchPositions(): Promise<PositionResponse[]> {
  const { data } = await apiClient.get<unknown>('/Data/Tastytrade/Account/Positions');
  console.debug('[Account/Positions] response:', data);
  const arr = Array.isArray(data) ? data : (data as any)?.positions ?? [];
  return arr as PositionResponse[];
}

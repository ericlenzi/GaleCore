import apiClient from './client';
import { BalancesResponse, PositionResponse } from '../types/api';

export async function fetchBalances(): Promise<BalancesResponse> {
  const { data } = await apiClient.get<unknown>('/Data/Tastytrade/Account/Balances');
  console.debug('[Account/Balances] response:', data);

  // Unwrap possible { data: {...} } wrapper
  const raw = ((data as any)?.data ?? data) as Record<string, unknown>;

  return {
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
  const arr = Array.isArray(data) ? data : (data as any)?.data ?? [];
  return arr as PositionResponse[];
}

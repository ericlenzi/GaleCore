import apiClient from './client';
import { CoreRules } from '../types/api';

export async function fetchCoreRules(): Promise<CoreRules> {
  const { data } = await apiClient.get<unknown>('/App/GaleCore/Rules/Core');
  const rules: CoreRules = typeof data === 'string' ? JSON.parse(data) : data;
  console.debug('[Rules/Core] tickers:', rules?.universe?.tickers);
  return rules;
}

/**
 * Reglas v1.4.0 crudas (estructura completa del JSON, sin tipar por CoreRules que está en v1.3.1).
 * La usa la pestaña Strategy para renderizar la definición tal como la declara el JSON.
 */
export async function fetchCoreRulesRaw(): Promise<any> {
  const { data } = await apiClient.get<unknown>('/App/GaleCore/Rules/Core');
  return typeof data === 'string' ? JSON.parse(data) : data;
}

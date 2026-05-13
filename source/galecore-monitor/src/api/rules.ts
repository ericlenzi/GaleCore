import apiClient from './client';
import { CoreRules } from '../types/api';

export async function fetchCoreRules(): Promise<CoreRules> {
  const { data } = await apiClient.get<unknown>('/App/GaleCore/Rules/Core');
  const rules: CoreRules = typeof data === 'string' ? JSON.parse(data) : data;
  console.debug('[Rules/Core] tickers:', rules?.universe?.tickers);
  return rules;
}

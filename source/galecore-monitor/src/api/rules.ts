import apiClient from './client';
import { CoreRules } from '../types/api';

export async function fetchCoreRules(): Promise<CoreRules> {
  const { data } = await apiClient.get<unknown>('/App/GaleCore/Rules/Core');
  console.debug('[Rules/Core] response:', data);
  return data as CoreRules;
}

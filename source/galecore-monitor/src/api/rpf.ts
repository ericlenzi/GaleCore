import apiClient from './client';

/** Estado del switch de workers de RPF. `source` = quién manda: el override del operador o el JSON de reglas. */
export interface RpfWorkersState {
  enabled: boolean;
  source: 'override' | 'rules';
}

export async function fetchRpfWorkers(): Promise<RpfWorkersState> {
  const { data } = await apiClient.get<RpfWorkersState>('/App/Rpf/Workers');
  return data;
}

export async function setRpfWorkers(enabled: boolean): Promise<RpfWorkersState> {
  const { data } = await apiClient.post<RpfWorkersState>('/App/Rpf/Workers', { enabled });
  return data;
}

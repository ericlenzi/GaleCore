import apiClient from './client';

/** Estado del switch de la estrategia RPF. `source` = quién manda: el override del operador o el JSON de reglas. */
export interface RpfSwitchState {
  enabled: boolean;
  source: 'override' | 'rules';
}

export async function fetchRpfSwitch(): Promise<RpfSwitchState> {
  const { data } = await apiClient.get<RpfSwitchState>('/App/Rpf/Switch');
  return data;
}

export async function setRpfSwitch(enabled: boolean): Promise<RpfSwitchState> {
  const { data } = await apiClient.post<RpfSwitchState>('/App/Rpf/Switch', { enabled });
  return data;
}

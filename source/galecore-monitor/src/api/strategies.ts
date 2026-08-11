import apiClient from './client';

/**
 * Estado del switch de una estrategia.
 * `source` dice quién manda: "override" si el operador ya usó el switch (archivo de estado en
 * disco), "rules" si todavía manda lo que declara el JSON de la estrategia.
 */
export interface StrategySwitchState {
  enabled: boolean;
  source: 'override' | 'rules';
}

/**
 * Lee/escribe el switch por endpoint en vez de hardcodear la ruta: cada estrategia declara su
 * `switch_endpoint` en el config de la app, así que sumar una estrategia nueva no requiere
 * tocar el front. Contrato uniforme: GET → { enabled, source }, POST { enabled } → lo mismo.
 */
export async function fetchStrategySwitch(endpoint: string): Promise<StrategySwitchState> {
  const { data } = await apiClient.get<StrategySwitchState>(endpoint);
  return data;
}

export async function setStrategySwitch(endpoint: string, enabled: boolean): Promise<StrategySwitchState> {
  const { data } = await apiClient.post<StrategySwitchState>(endpoint, { enabled });
  return data;
}

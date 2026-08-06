import apiClient from './client';

/**
 * Estado del switch de Workers de una estrategia.
 * `source` dice quién manda: "override" si el operador ya usó el switch (archivo de estado en
 * disco), "rules" si todavía manda lo que declara el JSON de la estrategia.
 */
export interface WorkersState {
  enabled: boolean;
  source: 'override' | 'rules';
}

/**
 * Lee/escribe el switch por endpoint en vez de hardcodear la ruta: cada estrategia declara su
 * `workers_endpoint` en el config de la app, así que sumar una estrategia nueva no requiere
 * tocar el front. Contrato uniforme: GET → { enabled, source }, POST { enabled } → lo mismo.
 */
export async function fetchWorkers(endpoint: string): Promise<WorkersState> {
  const { data } = await apiClient.get<WorkersState>(endpoint);
  return data;
}

export async function setWorkers(endpoint: string, enabled: boolean): Promise<WorkersState> {
  const { data } = await apiClient.post<WorkersState>(endpoint, { enabled });
  return data;
}

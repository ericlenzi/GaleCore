import apiClient from './client';

/**
 * Estado del switch de una estrategia PARA EL USUARIO LOGUEADO.
 *
 * `source` dice qué nivel decidió el `enabled`, que se resuelve en el backend entre tres:
 *   - 'user'     — la preferencia de este usuario (tabla user_strategies)
 *   - 'platform' — el kill switch del operador, que apaga la estrategia para todos
 *   - 'rules'    — nadie tocó nada todavía: manda el JSON de reglas de la estrategia
 *
 * El POST de este endpoint escribe SIEMPRE el nivel del usuario; el de plataforma es otro endpoint
 * (`<switch_endpoint>/Platform`, solo admins) y desde el tablero no se toca. Ojo con eso al leer el
 * `enabled` que devuelve: si la plataforma está en OFF, prender el propio no lo cambia a true.
 */
export interface StrategySwitchState {
  enabled: boolean;
  source: 'user' | 'platform' | 'rules';
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

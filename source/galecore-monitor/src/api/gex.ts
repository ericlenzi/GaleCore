import apiClient from './client';
import { GexAnalysisResponse, GexRules } from '../types/gex';

/** Estado del switch de GEX. `source` = quién manda: el override del operador o el JSON de reglas. */
export interface GexWorkersState {
  enabled: boolean;
  source: 'override' | 'rules';
}

export async function fetchGexWorkers(): Promise<GexWorkersState> {
  const { data } = await apiClient.get<GexWorkersState>('/App/Gex/Workers');
  return data;
}

export async function setGexWorkers(enabled: boolean): Promise<GexWorkersState> {
  const { data } = await apiClient.post<GexWorkersState>('/App/Gex/Workers', { enabled });
  return data;
}

/** Reglas de la estrategia GEX (`Files/Gex/galecore_rules_gex.json`, servido tal cual). */
export async function fetchGexRules(): Promise<GexRules> {
  const { data } = await apiClient.get<GexRules>('/App/Gex/Rules');
  return data;
}

/**
 * GEX global + desglose por vencimiento + contexto de mercado.
 * Timeout largo a propósito: la primera llamada del día barre toda la cadena (todos los
 * vencimientos ≤ max_dte). Las siguientes salen del cache del handler.
 */
export async function fetchGexAnalysis(
  symbol: string,
  refresh = false,
): Promise<GexAnalysisResponse> {
  const { data } = await apiClient.get<GexAnalysisResponse>('/App/Gex/Analysis', {
    params: { Symbol: symbol, Refresh: refresh },
    timeout: 300_000,
  });
  return data;
}

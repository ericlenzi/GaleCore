import apiClient from './client';
import { GexAnalysisResponse, GexRules } from '../types/gex';

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

namespace DataFeed.Infrastructure.Providers.Tastytrade
{
    /// <summary>
    /// Abstracción para broadcasting de datos de mercado en tiempo real.
    /// La implementación concreta (SignalR) vive en la capa Api.
    /// </summary>
    public interface IMarketDataBroadcaster
    {
        Task BroadcastTradeAsync(string symbol, object tradeData);
        Task BroadcastQuoteAsync(string symbol, object quoteData);
        Task BroadcastGreeksAsync(string symbol, object greeksData);

        /// <summary>Emite ReceiveFlow al grupo "flow_{symbol}" con el snapshot de flow agresivo.</summary>
        Task BroadcastFlowAsync(string symbol, object flowData);

        /// <summary>
        /// Emite ReceiveRpfState al grupo "rpf" con el snapshot de estado del loop RPF (Fase 6a).
        /// El frontend es tablero: consume este evento en vez de correr la cascada.
        /// </summary>
        Task BroadcastRpfStateAsync(string symbol, object stateUpdate);

        /// <summary>
        /// Emite ReceiveTradeSuggestion al grupo "rpf" cuando la máquina entra en TRIGGERED.
        /// El sistema sugiere, nunca ejecuta: la apertura sigue siendo manual.
        /// </summary>
        Task BroadcastTradeSuggestionAsync(string symbol, object suggestion);

        /// <summary>
        /// Emite ReceiveRpfWorkers al grupo "rpf" cuando el operador toca el switch de workers.
        /// Al apagar, el tablero vuelve al estado inicial en el acto en vez de esperar el staleness.
        /// </summary>
        Task BroadcastRpfWorkersAsync(bool enabled);
    }
}

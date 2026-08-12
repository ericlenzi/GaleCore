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

        /// <summary>
        /// Emite ReceiveRpfState al grupo "rpf" con el snapshot de estado del loop RPF (Fase 6a).
        /// El frontend es tablero: consume este evento en vez de correr la cascada.
        /// </summary>
        /// <param name="ct">
        /// Corte del envío. NO es opcional a propósito: SignalR escribe en el canal de salida de cada
        /// conexión del grupo, y un cliente tapado deja el SendAsync esperando para siempre. Sin token,
        /// un solo cliente zombi cuelga al llamador — que es como el loop de RPF se quedaba mudo.
        /// </param>
        Task BroadcastRpfStateAsync(string symbol, object stateUpdate, CancellationToken ct);

        /// <summary>
        /// Emite ReceiveTradeSuggestion al grupo "rpf" cuando la máquina entra en TRIGGERED.
        /// El sistema sugiere, nunca ejecuta: la apertura sigue siendo manual.
        /// </summary>
        Task BroadcastTradeSuggestionAsync(string symbol, object suggestion);

        /// <summary>
        /// Emite ReceiveRpfSwitch cuando alguien toca el switch de la estrategia. Al apagar, el
        /// tablero vuelve al estado inicial en el acto en vez de esperar el staleness.
        /// </summary>
        /// <param name="userId">
        /// A quién avisarle. Con un uuid, solo a los tableros de ESE usuario: el switch tiene un
        /// nivel por usuario, y avisarle al resto les mostraría un OFF que no es el de ellos. Con
        /// null, a todos — es el kill switch de plataforma, que sí apaga la estrategia para todo el
        /// mundo.
        /// </param>
        Task BroadcastRpfSwitchAsync(bool enabled, string? userId);
    }
}

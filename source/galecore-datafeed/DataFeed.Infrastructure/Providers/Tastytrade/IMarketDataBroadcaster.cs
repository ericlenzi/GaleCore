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
    }
}

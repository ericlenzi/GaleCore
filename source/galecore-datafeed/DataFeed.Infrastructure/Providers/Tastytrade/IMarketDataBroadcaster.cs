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
    }
}

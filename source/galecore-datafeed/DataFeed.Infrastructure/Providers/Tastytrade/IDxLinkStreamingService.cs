namespace DataFeed.Infrastructure.Providers.Tastytrade
{
    /// <summary>
    /// Servicio de streaming persistente DXLink con multiplexing de suscripciones.
    /// Mantiene una sola conexión WebSocket y administra suscripciones por reference counting.
    /// </summary>
    public interface IDxLinkStreamingService
    {
        /// <summary>
        /// Agrega suscripciones para un símbolo. Si es la primera vez, envía FEED_SUBSCRIPTION add.
        /// </summary>
        Task SubscribeAsync(string symbol, string[] eventTypes);

        /// <summary>
        /// Remueve suscripciones para un símbolo. Si el ref count llega a 0, envía FEED_SUBSCRIPTION remove.
        /// </summary>
        Task UnsubscribeAsync(string symbol, string[] eventTypes);
    }
}

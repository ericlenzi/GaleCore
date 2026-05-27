using DataFeed.Infrastructure.Providers.Tastytrade.Models;

namespace DataFeed.Infrastructure.Providers.Tastytrade
{
    /// <summary>
    /// Servicio singleton que acumula flow agresivo de opciones en memoria.
    /// Clasifica trades por agresion (ask_side / bid_side), filtra por premium minimo,
    /// y mantiene una ventana deslizante por simbolo.
    /// El hub llama StartTracking/StopTracking; DxLinkStreamingService alimenta eventos.
    /// </summary>
    public interface IFlowAggregatorService
    {
        /// <summary>
        /// Inicia el tracking de flow para un subyacente.
        /// La suscripcion DxLink la gestiona el caller (Hub en Fase 6).
        /// </summary>
        void StartTracking(string symbol, string expiration, int windowMinutes = 60);

        /// <summary>Detiene el tracking y limpia el estado para el simbolo.</summary>
        void StopTracking(string symbol);

        /// <summary>Retorna el snapshot actual del flow acumulado, o null si no hay tracking activo.</summary>
        FlowSnapshot? GetSnapshot(string symbol);

        /// <summary>Indica si hay tracking activo para el simbolo.</summary>
        bool IsTracking(string symbol);

        /// <summary>Lista de simbolos con tracking activo.</summary>
        IReadOnlyCollection<string> GetTrackedSymbols();

        /// <summary>
        /// Alimentado por DxLinkStreamingService cuando llega un Trade de opcion.
        /// El simbolo es formato DxFeed (ej: ".SPY260620C530").
        /// </summary>
        void OnOptionTrade(string dxFeedSymbol, TradeEvent trade);

        /// <summary>
        /// Alimentado por DxLinkStreamingService cuando llega un Quote de opcion.
        /// Cachea el ultimo quote para clasificar agresion del proximo trade.
        /// </summary>
        void OnOptionQuote(string dxFeedSymbol, QuoteEvent quote);
    }
}

namespace DataFeed.Infrastructure.Providers.Tastytrade.Models
{
    /// <summary>
    /// Modelo para la respuesta de multi-candle subscription.
    /// Contiene candles del subyacente y de todas las opciones suscritas.
    /// </summary>
    public class MultiCandleModel
    {
        /// <summary>
        /// Candle del subyacente (último día)
        /// </summary>
        public CandleData Underlying { get; set; }

        /// <summary>
        /// Candles de opciones indexados por símbolo streamer (ej: ".AAPL260529C260{=d}")
        /// </summary>
        public Dictionary<string, CandleData> Options { get; set; } = new();
    }
}

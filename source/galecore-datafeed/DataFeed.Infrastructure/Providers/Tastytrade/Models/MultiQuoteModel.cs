namespace DataFeed.Infrastructure.Providers.Tastytrade.Models
{
    /// <summary>
    /// Cotizaciones bid/ask para múltiples opciones, usadas para calcular mid-price.
    /// </summary>
    public class MultiQuoteModel
    {
        /// <summary>Quotes por símbolo streamer (sin sufijos de evento)</summary>
        public Dictionary<string, QuoteEvent> Quotes { get; set; } = new();
    }
}

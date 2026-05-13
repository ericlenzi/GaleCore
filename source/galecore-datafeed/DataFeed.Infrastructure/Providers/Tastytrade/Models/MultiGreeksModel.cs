namespace DataFeed.Infrastructure.Providers.Tastytrade.Models
{
    /// <summary>
    /// Resultado de suscripción masiva a Greeks + Candle (OI) para múltiples opciones.
    /// Greeks provee IV/delta/gamma en tiempo real; Candle provee OpenInterest del cierre anterior.
    /// </summary>
    public class MultiGreeksModel
    {
        /// <summary>Greeks por símbolo streamer (sin sufijos de evento)</summary>
        public Dictionary<string, GreeksEvent> Greeks { get; set; } = new();

        /// <summary>OpenInterest por símbolo streamer, obtenido del candle diario</summary>
        public Dictionary<string, long> OpenInterest { get; set; } = new();
    }
}

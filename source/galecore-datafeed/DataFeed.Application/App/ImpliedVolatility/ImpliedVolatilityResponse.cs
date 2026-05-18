namespace DataFeed.Application.App.ImpliedVolatility
{
    public class ImpliedVolatilityResponse
    {
        /// <summary>
        /// Símbolo del subyacente
        /// </summary>
        public string Symbol { get; set; }

        /// <summary>
        /// Precio spot del subyacente
        /// </summary>
        public double Spot { get; set; }

        /// <summary>
        /// Tasa libre de riesgo utilizada
        /// </summary>
        public double RiskFreeRate { get; set; }

        /// <summary>
        /// Volatilidad implícita a 9 días DTE — CBOE model-free (% anualizado, equivalente a VIX9D)
        /// </summary>
        public double? IV30_9d { get; set; }

        /// <summary>
        /// Volatilidad implícita a 30 días DTE — CBOE model-free (% anualizado, equivalente a VIX)
        /// </summary>
        public double? IV30_30d { get; set; }

        /// <summary>
        /// Volatilidad implícita a 90 días DTE — CBOE model-free (% anualizado, equivalente a VIX3M)
        /// </summary>
        public double? IV30_90d { get; set; }

        /// <summary>
        /// Movimiento diario esperado = IV30_30d / √252
        /// </summary>
        public double? DailyMove { get; set; }

        /// <summary>
        /// Movimiento diario esperado en dólares = Spot × DailyMove
        /// </summary>
        public double? DailyMoveDollar { get; set; }

        /// <summary>
        /// IV30 actual (0 días atrás) — tomado de la última vela diaria del subyacente (ImpVolatility × 100).
        /// Fuente: /Data/Tastytrade/MarketData/Candle?Symbol={Symbol}&amp;Interval=1d
        /// </summary>
        public double? IV30_0d { get; set; }

        /// <summary>
        /// IV30 de hace 3 sesiones de trading — tomado de la vela diaria [−3] del subyacente (ImpVolatility × 100).
        /// Fuente: /Data/Tastytrade/MarketData/Candle?Symbol={Symbol}&amp;Interval=1d
        /// </summary>
        public double? IV30_3d { get; set; }

        /// <summary>
        /// Tasa de cambio de la IV30 en 3 sesiones = ((IV30_0d − IV30_3d) / IV30_3d) × 100
        /// Usado como métrica de iv_momentum en Capa 1. Si &gt; 15% indica expansión de vol.
        /// </summary>
        public double? IV30RocPct { get; set; }
    }
}

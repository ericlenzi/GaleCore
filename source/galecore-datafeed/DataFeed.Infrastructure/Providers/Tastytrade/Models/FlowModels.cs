namespace DataFeed.Infrastructure.Providers.Tastytrade.Models
{
    /// <summary>
    /// Snapshot del flujo agresivo de opciones para un subyacente,
    /// calculado sobre una ventana deslizante de N minutos.
    /// </summary>
    public class FlowSnapshot
    {
        public string Symbol { get; set; } = "";
        public string Expiration { get; set; } = "";
        public int WindowMinutes { get; set; }
        public DateTime Timestamp { get; set; }

        public FlowSide Bullish { get; set; } = new();
        public FlowSide Bearish { get; set; } = new();

        /// <summary>
        /// (bullish_premium - bearish_premium) / total_premium.
        /// Rango: -1.0 (todo bearish) a +1.0 (todo bullish).
        /// </summary>
        public double NetDeltaFlow { get; set; }

        /// <summary>"bullish", "bearish", o "neutral"</summary>
        public string Signal { get; set; } = "neutral";

        public List<FlowTrade> RecentTrades { get; set; } = new();
    }

    /// <summary>
    /// Acumulado de un lado (bullish o bearish) del flow.
    /// </summary>
    public class FlowSide
    {
        public double PremiumUsd { get; set; }
        public int TradeCount { get; set; }
        public double AvgTradeSize { get; set; }
        public double? DominantStrike { get; set; }

        /// <summary>"call" o "put"</summary>
        public string? DominantType { get; set; }
    }

    /// <summary>
    /// Trade individual clasificado como agresivo (ask_side o bid_side)
    /// con premium >= large_premium_threshold.
    /// </summary>
    public class FlowTrade
    {
        public DateTime Timestamp { get; set; }
        public string OptionSymbol { get; set; } = "";
        public string CallPut { get; set; } = "";
        public double Strike { get; set; }
        public double TradePrice { get; set; }
        public double Size { get; set; }
        public double PremiumUsd { get; set; }

        /// <summary>"ask_side" (compra agresiva) o "bid_side" (venta agresiva)</summary>
        public string Aggression { get; set; } = "";
    }
}

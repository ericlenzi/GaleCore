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
        /// Volatilidad implícita a 9 días (equivalente a VIX9D)
        /// </summary>
        public double? IV9D { get; set; }

        /// <summary>
        /// Volatilidad implícita a 30 días (equivalente a VIX)
        /// </summary>
        public double? IV30 { get; set; }

        /// <summary>
        /// Volatilidad implícita a 3 meses (equivalente a VIX3M)
        /// </summary>
        public double? IV3M { get; set; }

        /// <summary>
        /// Movimiento diario esperado = IV30 / √252
        /// </summary>
        public double? DailyMove { get; set; }

        /// <summary>
        /// Movimiento diario esperado en dólares = Spot × DailyMove
        /// </summary>
        public double? DailyMoveDollar { get; set; }

        /// <summary>
        /// Detalle del cálculo por cada plazo
        /// </summary>
        public List<IVCalculationDetail> Calculations { get; set; } = new();
    }

    public class IVCalculationDetail
    {
        /// <summary>
        /// Plazo objetivo en días (9, 30, 90)
        /// </summary>
        public int TargetDays { get; set; }

        /// <summary>
        /// Volatilidad implícita calculada (en %, ej: 25.34)
        /// </summary>
        public double? ImpliedVolatility { get; set; }

        /// <summary>
        /// Expiración near-term utilizada
        /// </summary>
        public string NearTermExpiration { get; set; }

        /// <summary>
        /// DTE de la expiración near-term
        /// </summary>
        public int? NearTermDTE { get; set; }

        /// <summary>
        /// Varianza calculada para near-term
        /// </summary>
        public double? NearTermVariance { get; set; }

        /// <summary>
        /// Cantidad de opciones OTM usadas en near-term
        /// </summary>
        public int? NearTermOptionsUsed { get; set; }

        /// <summary>
        /// Expiración next-term utilizada
        /// </summary>
        public string NextTermExpiration { get; set; }

        /// <summary>
        /// DTE de la expiración next-term
        /// </summary>
        public int? NextTermDTE { get; set; }

        /// <summary>
        /// Varianza calculada para next-term
        /// </summary>
        public double? NextTermVariance { get; set; }

        /// <summary>
        /// Cantidad de opciones OTM usadas en next-term
        /// </summary>
        public int? NextTermOptionsUsed { get; set; }
    }
}

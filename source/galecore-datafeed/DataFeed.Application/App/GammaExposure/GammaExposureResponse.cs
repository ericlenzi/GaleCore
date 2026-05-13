using System.Threading;

namespace DataFeed.Application.App.GammaExposure
{
    public class GammaExposureResponse
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
        /// Fecha de expiración utilizada
        /// </summary>
        public string Expiration { get; set; }

        /// <summary>
        /// Días hasta expiración
        /// </summary>
        public int DTE { get; set; }

        /// <summary>
        /// Tipo de expiración (Regular, Weekly)
        /// </summary>
        public string ExpirationType { get; set; }

        /// <summary>
        /// Nivel de precio donde el Net GEX cruza de negativo a positivo
        /// </summary>
        public double? GammaZeroLevel { get; set; }

        /// <summary>
        /// Strike con el máximo CallGEX (mayor gamma long de dealers)
        /// </summary>
        public double? CallWall { get; set; }

        /// <summary>
        /// Strike con el máximo |PutGEX| (mayor gamma short de dealers)
        /// </summary>
        public double? PutWall { get; set; }

        /// <summary>
        /// Tasa libre de riesgo utilizada (FRED DGS1 o default)
        /// </summary>
        public double RiskFreeRate { get; set; }

        /// <summary>
        /// GEX por cada strike
        /// </summary>
        public List<GammaExposureStrike> Strikes { get; set; } = new();

        public double CallGEX
        {
            get
            {
                return Math.Round(Strikes.Sum(x => x.CallGEX), 4);
            }
        }

        public double PutGEX
        {
            get
            {
                return Math.Round(Strikes.Sum(x => x.PutGEX), 4);
            }
        }

        public double NetGEX
        {
            get
            {
                return Math.Round((CallGEX + PutGEX) / 1000, 1);
            }
        }
    }

    public class GammaExposureStrike
    {
        public double Strike { get; set; }

        // Call
        public double CallDelta { get; set; }
        public double CallGamma { get; set; }
        public double CallIV { get; set; }
        public long CallOI { get; set; }
        public double CallGEX { get; set; }

        // Put
        public double PutDelta { get; set; }
        public double PutGamma { get; set; }
        public double PutIV { get; set; }
        public long PutOI { get; set; }
        public double PutGEX { get; set; }

        // Neto
        public double NetGEX
        {
            get
            {
                return Math.Round(CallGEX + PutGEX, 4);
            }
        }
    }
}

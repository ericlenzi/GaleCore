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
        /// GEX por cada strike. En modo global (AllExpirations) cada fila es la SUMA del strike
        /// sobre todas las expiraciones incluidas.
        /// </summary>
        public List<GammaExposureStrike> Strikes { get; set; } = new();

        /// <summary>
        /// Desglose por vencimiento. Solo se puebla con IncludeByExpiry = true (estrategia GEX);
        /// vacío en el modo de una sola expiración.
        /// </summary>
        public List<GammaExposureExpiry> ByExpiry { get; set; } = new();

        // ── Cobertura del snapshot ──────────────────────────────────────────────
        // Un símbolo sin Greeks no aporta al GEX. Con la cadena completa eso puede ser un
        // vencimiento entero, y sin estos contadores el faltante es invisible: el GEX simplemente
        // da más chico. Se publican para que el tablero pueda marcar un barrido parcial.

        /// <summary>Símbolos de opción pedidos a DXLink.</summary>
        public int SymbolsRequested { get; set; }

        /// <summary>Símbolos que efectivamente devolvieron Greeks.</summary>
        public int SymbolsWithGreeks { get; set; }

        /// <summary>Vencimientos que entraron en el barrido (los que quedaron sin datos no aparecen en ByExpiry).</summary>
        public int ExpirationsRequested { get; set; }

        public int StrikesWithOI => Strikes.Count(s => s.CallOI > 0 || s.PutOI > 0);
        public int StrikesWithGEX => Strikes.Count(s => s.CallGEX > 0 || s.PutGEX < 0);

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

    /// <summary>
    /// GEX de un vencimiento puntual de la cadena. Mismos campos derivados que la respuesta raíz,
    /// pero calculados solo con los strikes de ese vencimiento.
    /// </summary>
    public class GammaExposureExpiry
    {
        public string Expiration { get; set; } = "";
        public int DTE { get; set; }
        public string? ExpirationType { get; set; }

        /// <summary>Nivel donde el Net GEX de este vencimiento cruza de negativo a positivo.</summary>
        public double? GammaZeroLevel { get; set; }
        public double? CallWall { get; set; }
        public double? PutWall { get; set; }

        /// <summary>IV del strike más cercano al spot en este vencimiento (fuente: Greeks DXLink).</summary>
        public double? AtmIv { get; set; }

        /// <summary>spot * atmIv * sqrt(dte/365). Ver definitions.expected_move.</summary>
        public double? ExpectedMove { get; set; }

        public List<GammaExposureStrike> Strikes { get; set; } = new();

        public double CallGEX => Math.Round(Strikes.Sum(x => x.CallGEX), 4);
        public double PutGEX => Math.Round(Strikes.Sum(x => x.PutGEX), 4);

        /// <summary>Net GEX del vencimiento en billones (misma escala que la respuesta raíz).</summary>
        public double NetGEX => Math.Round((CallGEX + PutGEX) / 1000, 1);
    }

    public class GammaExposureStrike
    {
        public double Strike { get; set; }

        // Call
        public string? CallStreamerSymbol { get; set; }
        public double CallDelta { get; set; }
        public double CallGamma { get; set; }
        public double CallIV { get; set; }
        public long CallOI { get; set; }
        public double CallGEX { get; set; }
        /// <summary>Cierre del período anterior (close del candle diario) del call.</summary>
        public double? CallPrevClose { get; set; }

        // Put
        public string? PutStreamerSymbol { get; set; }
        public double PutDelta { get; set; }
        public double PutGamma { get; set; }
        public double PutIV { get; set; }
        public long PutOI { get; set; }
        public double PutGEX { get; set; }
        /// <summary>Cierre del período anterior (close del candle diario) del put.</summary>
        public double? PutPrevClose { get; set; }

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

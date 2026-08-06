using MediatR;

namespace DataFeed.Application.App.GammaExposure
{
    public class GammaExposureRequest : IRequest<GammaExposureResponse>
    {
        /// <summary>
        /// Símbolo del subyacente (ej: AAPL, MSFT, SPY)
        /// </summary>
        public string Symbol { get; set; }

        /// <summary>
        /// Máximo DTE para filtrar expiraciones (default: 60)
        /// </summary>
        public int MaxDTE { get; set; } = 60;

        // ═══════════════════════════════════════════════════════════════════
        // Modo global (estrategia GEX) — opt-in. Con todos los defaults el
        // handler se comporta exactamente como antes: una sola expiración.
        // ═══════════════════════════════════════════════════════════════════

        /// <summary>
        /// true = agrega TODAS las expiraciones dentro de MaxDTE (GEX global).
        /// false (default) = solo la expiración más cercana, como siempre.
        /// </summary>
        public bool AllExpirations { get; set; } = false;

        /// <summary>
        /// true = además del agregado, devuelve el desglose por vencimiento en <c>ByExpiry</c>.
        /// </summary>
        public bool IncludeByExpiry { get; set; } = false;

        /// <summary>
        /// Tipos de expiración a incluir. null (default) = solo "Regular", el comportamiento histórico.
        /// La estrategia GEX pasa ["Regular", "Weekly"].
        /// </summary>
        public string[]? ExpirationTypes { get; set; } = null;

        /// <summary>
        /// true = incluye el vencimiento del día (DTE 0). Default false: el filtro histórico exige DTE &gt; 0.
        /// </summary>
        public bool IncludeZeroDte { get; set; } = false;

        /// <summary>
        /// Tamaño de lote para pedir Greeks a DXLink. 0 (default) = un solo pedido con todos los símbolos.
        /// Con la cadena completa son miles de símbolos y conviene trocearlos.
        /// </summary>
        public int GreeksBatchSize { get; set; } = 0;

        /// <summary>
        /// Reintentos del snapshot de Greeks sobre los símbolos que no contestaron. 0 (default) =
        /// una sola pasada, el comportamiento histórico. Sin reintentos, un lote que agota el
        /// timeout se lleva puestos vencimientos enteros y el GEX cambia entre corridas.
        /// </summary>
        public int GreeksRetries { get; set; } = 0;

        /// <summary>Banda de |delta| para pedir OI (Candle). Fuera de la banda el gamma es ≈ 0.</summary>
        public double OiDeltaMin { get; set; } = 0.02;

        /// <summary>Banda de |delta| para pedir OI (Candle).</summary>
        public double OiDeltaMax { get; set; } = 0.98;
    }
}

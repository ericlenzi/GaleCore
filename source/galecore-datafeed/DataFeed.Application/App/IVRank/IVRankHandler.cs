using DataFeed.Infrastructure.Providers.Tastytrade;
using MediatR;
using Microsoft.Extensions.Configuration;
using System.Globalization;

namespace DataFeed.Application.App.IVRank
{
    public class IVRankHandler : IRequestHandler<IVRankRequest, IVRankResponse>
    {
        private readonly IConfiguration _config;
        private readonly ITastytradeOAuth _auth;
        private readonly IHttpClientFactory _client;

        public IVRankHandler(IConfiguration config, ITastytradeOAuth auth, IHttpClientFactory client)
        {
            _config = config;
            _auth = auth;
            _client = client;
        }

        public async Task<IVRankResponse> Handle(IVRankRequest request, CancellationToken cancellationToken)
        {
            try
            {
                // ═══════════════════════════════════════════════════════════
                // Obtener 252 candles diarios del subyacente vía WebSocket
                // 252 trading days ≈ 365 calendar days
                // ═══════════════════════════════════════════════════════════
                var socketProvider = new TastytradeSocketProvider(_config, _auth, _client);
                var fromTime = DateTime.UtcNow.AddDays(-370); // margen extra para cubrir feriados
                var candles = await socketProvider.GetCandleAsync(
                    request.Symbol,
                    "d",
                    fromTime,
                    DateTime.UtcNow,
                    cancellationToken
                );

                if (candles?.data == null || !candles.data.Any())
                    throw new Exception($"No se recibieron candles para {request.Symbol}");

                // Filtrar candles con IV válida y ordenar cronológicamente
                var validCandles = candles.data
                    .Where(c => !string.IsNullOrWhiteSpace(c.ImpVolatility)
                             && c.ImpVolatility.Trim() != "NaN"
                             && ParseDoubleOrZero(c.ImpVolatility) > 0)
                    .OrderBy(c => c.TimeStamp)
                    .ToList();

                if (!validCandles.Any())
                    throw new Exception($"No se encontraron datos de IV para {request.Symbol}");

                // Tomar los últimos 252 días con datos válidos
                var last252 = validCandles
                    .TakeLast(252)
                    .ToList();

                // Extraer valores de IV
                var ivValues = last252.Select(c => ParseDoubleOrZero(c.ImpVolatility)).ToList();
                double currentIV = ivValues.Last();
                double highIV = ivValues.Max();
                double lowIV = ivValues.Min();

                // IV Rank = (CurrentIV - LowIV) / (HighIV - LowIV) × 100
                double ivRank = 0;
                double range = highIV - lowIV;
                if (range > 0.0001)
                    ivRank = (currentIV - lowIV) / range * 100;

                // IV Percentile = % de días donde IV fue menor que la actual
                int daysBelow = ivValues.Count(iv => iv < currentIV);
                double ivPercentile = (double)daysBelow / ivValues.Count * 100;

                // Armar historial
                var history = last252.Select(c => new IVRankDay
                {
                    Date = c.TimeStamp.ToString("yyyy-MM-dd"),
                    IV = Math.Round(ParseDoubleOrZero(c.ImpVolatility), 4),
                    Close = Math.Round(ParseDoubleOrZero(c.Close), 2)
                }).ToList();

                return new IVRankResponse
                {
                    Symbol = request.Symbol,
                    CurrentIV = Math.Round(currentIV, 4),
                    HighIV = Math.Round(highIV, 4),
                    LowIV = Math.Round(lowIV, 4),
                    IVRank = Math.Round(ivRank, 2),
                    IVPercentile = Math.Round(ivPercentile, 2),
                    TradingDays = last252.Count,
                    History = history
                };
            }
            catch (Exception ex)
            {
                throw new Exception($"IVRankHandler Error: {ex.Message}");
            }
        }

        private static double ParseDoubleOrZero(string value)
        {
            if (string.IsNullOrWhiteSpace(value) || value.Trim() == "NaN")
                return 0;
            return double.TryParse(value, NumberStyles.Any, CultureInfo.InvariantCulture, out double result) ? result : 0;
        }
    }
}

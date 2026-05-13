using DataFeed.Application.Functions;
using DataFeed.Application.Shared;
using DataFeed.Infrastructure.Providers.Tastytrade;
using MediatR;
using Microsoft.Extensions.Configuration;
using System.Globalization;
using System.Net.Http;

namespace DataFeed.Application.App.GammaExposure
{
    public class GammaExposureHandler : IRequestHandler<GammaExposureRequest, GammaExposureResponse>
    {
        private readonly IConfiguration _config;
        private readonly ITastytradeOAuth _auth;
        private readonly IHttpClientFactory _client;

        // Tasa libre de riesgo por defecto (si FRED no disponible)
        private const double DEFAULT_RISK_FREE_RATE = 0.045;

        public GammaExposureHandler(IConfiguration config, ITastytradeOAuth auth, IHttpClientFactory client)
        {
            _config = config;
            _auth = auth;
            _client = client;
        }

        public async Task<GammaExposureResponse> Handle(GammaExposureRequest request, CancellationToken cancellationToken)
        {
            try
            {
                var response = new GammaExposureResponse
                {
                    Symbol = request.Symbol
                };

                // ═══════════════════════════════════════════════════════════
                // PASO 1: Obtener spot price y cadena de opciones (REST)
                // El spot se obtiene por REST para no competir con la conexión
                // persistente de DxLinkStreamingService al usar el WebSocket.
                // ═══════════════════════════════════════════════════════════
                var apiProvider = new TastytradeApiProvider(_config, _auth, _client);

                var marketData = await apiProvider.GetMarketDataByTypeAsync(request.Symbol, cancellationToken);
                double spot = marketData?.Data?.Items?.FirstOrDefault()?.Mark ?? 0;
                if (spot <= 0)
                    spot = marketData?.Data?.Items?.FirstOrDefault()?.Last ?? 0;
                if (spot <= 0)
                    throw new Exception($"No se pudo obtener el precio spot de {request.Symbol}");

                var optionChains = await apiProvider.GetOptionChainsAsync(request.Symbol, cancellationToken);

                var allExpirations = optionChains?.data?.items?.SelectMany(i => i.expirations).ToList();
                if (allExpirations == null || !allExpirations.Any())
                    throw new Exception($"No se encontraron cadenas de opciones para {request.Symbol}");

                // Filtrar: solo expiraciones Regular con DTE <= MaxDTE
                var regularExpirations = allExpirations
                    .Where(e => e.ExpirationType == "Regular" && e.DaysToExpiration > 0 && e.DaysToExpiration <= request.MaxDTE)
                    .OrderByDescending(e => e.DaysToExpiration)
                    .ToList();

                if (!regularExpirations.Any())
                    throw new Exception($"No se encontraron expiraciones regulares dentro de {request.MaxDTE} DTE para {request.Symbol}");

                // Tomar la primera expiración regular (la más cercana)
                var expiration = regularExpirations.First();
                response.Expiration = expiration.ExpirationDate;
                response.DTE = expiration.DaysToExpiration;
                response.ExpirationType = expiration.ExpirationType;

                // ═══════════════════════════════════════════════════════════
                // PASO 2: Armar lista de símbolos streamer para la suscripción
                // ═══════════════════════════════════════════════════════════
                var streamerSymbols = new List<string>();
                var strikeMap = new Dictionary<string, (double Strike, string Type)>(); // streamerSym → (strike, C/P)

                foreach (var strike in expiration.strikes)
                {
                    var strikePrice = double.Parse(strike.StrikePrice, CultureInfo.InvariantCulture);

                    // Call
                    if (!string.IsNullOrEmpty(strike.CallStreamerSymbol))
                    {
                        streamerSymbols.Add(strike.CallStreamerSymbol);
                        strikeMap[strike.CallStreamerSymbol] = (strikePrice, "C");
                    }

                    // Put
                    if (!string.IsNullOrEmpty(strike.PutStreamerSymbol))
                    {
                        streamerSymbols.Add(strike.PutStreamerSymbol);
                        strikeMap[strike.PutStreamerSymbol] = (strikePrice, "P");
                    }
                }

                // ═══════════════════════════════════════════════════════════
                // PASO 3: Greeks + OI vía WebSocket
                // Greeks provee IV/delta/gamma en tiempo real.
                // Candle (dentro de GetMultiGreeksAsync) provee OI del cierre anterior.
                // ═══════════════════════════════════════════════════════════
                var socketProvider = new TastytradeSocketProvider(_config, _auth, _client);
                var multiGreeks = await socketProvider.GetMultiGreeksAsync(
                    streamerSymbols.ToArray(),
                    cancellationToken
                );

                response.Spot = spot;

                // Tasa libre de riesgo (default, podría mejorarse con FRED)
                double r = DEFAULT_RISK_FREE_RATE;
                response.RiskFreeRate = r;

                // ═══════════════════════════════════════════════════════════
                // PASO 4: GEX por strike usando Greeks de DXLink
                // ═══════════════════════════════════════════════════════════
                var strikeResults = new Dictionary<double, GammaExposureStrike>();

                foreach (var kvp in multiGreeks.Greeks)
                {
                    var streamerSym = kvp.Key;
                    var greeksData = kvp.Value;

                    if (!strikeMap.TryGetValue(streamerSym, out var info))
                        continue;

                    double strikePrice = info.Strike;
                    string optType = info.Type;

                    // IV y Greeks directamente de DXLink (tiempo real)
                    double iv = greeksData.Volatility;
                    if (iv <= 0 || double.IsNaN(iv)) continue;

                    double delta = greeksData.Delta;
                    double gamma = greeksData.Gamma;

                    // OI del candle del cierre anterior
                    multiGreeks.OpenInterest.TryGetValue(streamerSym, out long oi);

                    // Inicializar strike si no existe
                    if (!strikeResults.ContainsKey(strikePrice))
                        strikeResults[strikePrice] = new GammaExposureStrike { Strike = strikePrice };

                    var strikeResult = strikeResults[strikePrice];

                    // GEX = Gamma × OI × 100 (contratos) × Spot²
                    // Calls: dealer long gamma (positivo)
                    // Puts: dealer short gamma (negativo)
                    double gex = gamma * oi * 100 * spot * spot;

                    if (optType == "C")
                    {
                        strikeResult.CallDelta = Math.Round(delta, 5);
                        strikeResult.CallGamma = Math.Round(gamma, 7);
                        strikeResult.CallIV = Math.Round(iv, 4);
                        strikeResult.CallOI = oi;
                        strikeResult.CallGEX = Math.Round(gex / 1_000_000, 4);
                    }
                    else
                    {
                        strikeResult.PutDelta = Math.Round(delta, 5);
                        strikeResult.PutGamma = Math.Round(gamma, 7);
                        strikeResult.PutIV = Math.Round(iv, 4);
                        strikeResult.PutOI = oi;
                        strikeResult.PutGEX = Math.Round(-gex / 1_000_000, 4);
                    }
                }

                // ═══════════════════════════════════════════════════════════
                // PASO 5: Filtrar por |Delta| >= MinDelta y ordenar
                // ═══════════════════════════════════════════════════════════
                response.Strikes = strikeResults.Values
                    //.Where(s => Math.Abs(s.CallDelta) >= request.MinDelta || Math.Abs(s.PutDelta) >= request.MinDelta)
                    .OrderBy(s => s.Strike)
                    .ToList();

                // ═══════════════════════════════════════════════════════════
                // PASO 6: Calcular Gamma Zero, Call Wall y Put Wall
                // ═══════════════════════════════════════════════════════════
                response.GammaZeroLevel = CalculateGammaZero(response.Strikes, spot);

                // Call Wall: strike con mayor CallGEX (mayor gamma long de dealers)
                var callWallStrike = response.Strikes
                    .Where(s => s.CallGEX > 0)
                    .OrderByDescending(s => s.CallGEX)
                    .FirstOrDefault();
                response.CallWall = callWallStrike?.Strike;

                // Put Wall: strike con mayor |PutGEX| (mayor gamma short de dealers)
                var putWallStrike = response.Strikes
                    .Where(s => s.PutGEX < 0)
                    .OrderBy(s => s.PutGEX)
                    .FirstOrDefault();
                response.PutWall = putWallStrike?.Strike;

                return response;
            }
            catch (Exception ex)
            {
                throw new Exception($"GammaExposureHandler Error: {ex.Message}");
            }
        }

        /// <summary>
        /// Interpola el nivel donde Net GEX cruza de negativo a positivo.
        /// Si hay múltiples cruces, retorna el más cercano al spot (gamma flip relevante).
        /// </summary>
        private double? CalculateGammaZero(List<GammaExposureStrike> strikes, double spot)
        {
            if (strikes == null || strikes.Count < 2) return null;

            var crossings = new List<double>();

            for (int i = 0; i < strikes.Count - 1; i++)
            {
                var current = strikes[i];
                var next = strikes[i + 1];

                if (current.NetGEX < 0 && next.NetGEX >= 0)
                {
                    double range = next.NetGEX - current.NetGEX;
                    if (Math.Abs(range) < 0.0001) continue;

                    double ratio = -current.NetGEX / range;
                    double crossing = current.Strike + ratio * (next.Strike - current.Strike);
                    crossings.Add(Math.Round(crossing, 2));
                }
            }

            if (!crossings.Any()) return null;

            // El gamma flip relevante es el cruce más cercano al spot actual
            return crossings.OrderBy(c => Math.Abs(c - spot)).First();
        }

        //private static double ParseDoubleOrZero(string value)
        //{
        //    if (string.IsNullOrWhiteSpace(value) || value.Trim() == "NaN")
        //        return 0;
        //    return double.TryParse(value, NumberStyles.Any, CultureInfo.InvariantCulture, out double result) ? result : 0;
        //}

        //private static long ParseLongOrZero(string value)
        //{
        //    if (string.IsNullOrWhiteSpace(value) || value.Trim() == "NaN")
        //        return 0;
        //    // OI puede venir como decimal (ej: "200.0")
        //    if (double.TryParse(value, NumberStyles.Any, CultureInfo.InvariantCulture, out double dResult))
        //        return (long)dResult;
        //    return 0;
        //}
    }
}

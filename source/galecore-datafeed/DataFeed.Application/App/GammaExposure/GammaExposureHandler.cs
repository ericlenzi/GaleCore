using DataFeed.Application.Functions;
using DataFeed.Application.Shared;
using DataFeed.Infrastructure.Providers.Tastytrade;
using DataFeed.Infrastructure.Providers.Tastytrade.Models;
using MediatR;
using Microsoft.Extensions.Configuration;
using Newtonsoft.Json.Linq;
using System.Globalization;
using System.Net.Http;

namespace DataFeed.Application.App.GammaExposure
{
    public class GammaExposureHandler : IRequestHandler<GammaExposureRequest, GammaExposureResponse>
    {
        private readonly IConfiguration _config;
        private readonly ITastytradeOAuth _auth;
        private readonly IHttpClientFactory _client;
        private readonly IDxLinkStreamingService _streaming;

        // Tasa libre de riesgo por defecto (si FRED no disponible)
        private const double DEFAULT_RISK_FREE_RATE = 0.045;

        // Cache de la cadena de opciones por símbolo/día. La chain (expiraciones, strikes,
        // streamer symbols) es estática intradía → la primera llamada del día paga el REST
        // (~1.3s) y las siguientes la reutilizan. Estático porque el handler se instancia por request.
        private static readonly System.Collections.Concurrent.ConcurrentDictionary<string, (OptionChainsModel Chain, DateTime Day)> _chainCache = new();

        // Cache diario de OI/cierre anterior por símbolo streamer (el OI settled no cambia intradía).
        private static readonly System.Collections.Concurrent.ConcurrentDictionary<string, (long Oi, double? PrevClose, DateTime Day)> _oiCache = new();

        public GammaExposureHandler(IConfiguration config, ITastytradeOAuth auth, IHttpClientFactory client, IDxLinkStreamingService streaming)
        {
            _config = config;
            _auth = auth;
            _client = client;
            _streaming = streaming;
        }

        /// <summary>
        /// Obtiene Greeks (IV/delta/gamma) + OI por símbolo vía la conexión DXLink persistente,
        /// sin abrir una sesión nueva. Greeks pasa por reference-counting (no pisa al Monitor);
        /// Candle (OI) va en lotes con cache diario. Reemplaza a TastytradeSocketProvider.GetMultiGreeksAsync.
        /// </summary>
        private async Task<MultiGreeksModel> FetchGreeksAndOIAsync(
            string[] streamerSymbols, double candleDeltaMin, double candleDeltaMax, CancellationToken ct)
        {
            var result = new MultiGreeksModel();
            if (streamerSymbols == null || streamerSymbols.Length == 0) return result;

            // ── Fase 1: Greeks (ref-counted) ──
            var greeksItems = await _streaming.RequestSnapshotAsync(
                streamerSymbols.Select(s => (s, "Greeks", (long?)null)).ToList(),
                isSymbolComplete: it => { var v = (double?)it["volatility"]; return v.HasValue && v.Value > 0; },
                timeout: TimeSpan.FromSeconds(15),
                cancellationToken: ct);

            foreach (var it in greeksItems)
            {
                var sym = it["eventSymbol"]?.ToString();
                if (string.IsNullOrEmpty(sym)) continue;
                var g = it.ToObject<GreeksEvent>();
                if (g != null && g.Volatility > 0) result.Greeks[sym] = g;
            }

            // Filtro por banda de |delta|: solo pedimos OI de strikes relevantes (deep OTM/ITM ≈ 0 gamma).
            var candleSymbols = streamerSymbols
                .Where(sym => result.Greeks.TryGetValue(sym, out var g)
                              && Math.Abs(g.Delta) >= candleDeltaMin && Math.Abs(g.Delta) <= candleDeltaMax)
                .ToArray();

            // Cache diario de OI: resolver hits sin pedir Candle; juntar los miss.
            var today = DateTime.UtcNow.Date;
            var toFetch = new List<string>();
            foreach (var sym in candleSymbols)
            {
                if (_oiCache.TryGetValue(sym, out var c) && c.Day == today)
                {
                    result.OpenInterest[sym] = c.Oi;
                    if (c.PrevClose.HasValue) result.PrevClose[sym] = c.PrevClose.Value;
                }
                else toFetch.Add(sym);
            }

            // ── Fase 2: Candle (OI) en lotes (DXLink limita las suscripciones Candle activas) ──
            const int CANDLE_BATCH_SIZE = 80;
            var fromTime = new DateTimeOffset(today.AddDays(-2), TimeSpan.Zero).ToUnixTimeMilliseconds();

            for (int i = 0; i < toFetch.Count; i += CANDLE_BATCH_SIZE)
            {
                if (ct.IsCancellationRequested) break;
                var batch = toFetch.Skip(i).Take(CANDLE_BATCH_SIZE).ToList();

                var candleItems = await _streaming.RequestSnapshotAsync(
                    batch.Select(s => (s + "{=d}", "Candle", (long?)fromTime)).ToList(),
                    // Símbolo completo al primer Candle con OI, o al SNAPSHOT_END/SNIP si no trae OI.
                    isSymbolComplete: it =>
                    {
                        if (!string.IsNullOrEmpty(it["openInterest"]?.ToString())) return true;
                        var flags = (int?)it["eventFlags"] ?? 0;
                        return (flags & 0x08) != 0 || (flags & 0x10) != 0;
                    },
                    timeout: TimeSpan.FromSeconds(6),
                    cancellationToken: ct);

                // Por símbolo, tomar el candle más reciente con OI > 0.
                var byKey = candleItems
                    .Select(it => new
                    {
                        Key = (it["eventSymbol"]?.ToString() ?? "").Replace("{=d}", ""),
                        Time = (long?)it["time"] ?? 0,
                        Cd = it.ToObject<CandleData>()
                    })
                    .Where(x => !string.IsNullOrEmpty(x.Key) && x.Cd != null && !string.IsNullOrEmpty(x.Cd.OpenInterest))
                    .GroupBy(x => x.Key);

                foreach (var grp in byKey)
                {
                    var newest = grp.OrderByDescending(x => x.Time).First();
                    if (!double.TryParse(newest.Cd.OpenInterest, NumberStyles.Any, CultureInfo.InvariantCulture, out var poi) || poi <= 0)
                        continue;

                    result.OpenInterest[grp.Key] = (long)poi;
                    double? pc = null;
                    if (!string.IsNullOrEmpty(newest.Cd.Close)
                        && double.TryParse(newest.Cd.Close, NumberStyles.Any, CultureInfo.InvariantCulture, out var pcv) && pcv > 0)
                    {
                        pc = pcv;
                        result.PrevClose[grp.Key] = pcv;
                    }
                    _oiCache[grp.Key] = ((long)poi, pc, today);
                }
            }

            return result;
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

                // El spot siempre se pide en vivo. La option chain se cachea por día:
                // si hay hit solo se pide el spot; si no, spot + chain en paralelo.
                var today = DateTime.UtcNow.Date;
                ByTypeModel? marketData;
                OptionChainsModel? optionChains;

                if (_chainCache.TryGetValue(request.Symbol, out var cachedChain) && cachedChain.Day == today)
                {
                    optionChains = cachedChain.Chain;
                    marketData = await apiProvider.GetMarketDataByTypeAsync(request.Symbol, cancellationToken);
                }
                else
                {
                    var spotTask = apiProvider.GetMarketDataByTypeAsync(request.Symbol, cancellationToken);
                    var chainTask = apiProvider.GetOptionChainsAsync(request.Symbol, cancellationToken);
                    await Task.WhenAll(spotTask, chainTask);
                    marketData = spotTask.Result;
                    optionChains = chainTask.Result;
                    if (optionChains?.data?.items != null)
                        _chainCache[request.Symbol] = (optionChains, today);
                }

                double spot = marketData?.Data?.Items?.FirstOrDefault()?.Mark ?? 0;
                if (spot <= 0)
                    spot = marketData?.Data?.Items?.FirstOrDefault()?.Last ?? 0;
                if (spot <= 0)
                    throw new Exception($"No se pudo obtener el precio spot de {request.Symbol}");

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
                // PASO 3: Greeks + OI vía la conexión DXLink persistente (sin sesión nueva).
                // Banda de |delta| 0.02–0.98 para pedir OI solo de strikes relevantes (gamma ≈ 0 afuera).
                // ═══════════════════════════════════════════════════════════
                var multiGreeks = await FetchGreeksAndOIAsync(
                    streamerSymbols.ToArray(),
                    candleDeltaMin: 0.02,
                    candleDeltaMax: 0.98,
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

                    // Cierre del período anterior (close del mismo candle diario)
                    double? prevClose = multiGreeks.PrevClose.TryGetValue(streamerSym, out double pc) ? pc : (double?)null;

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
                        strikeResult.CallStreamerSymbol = streamerSym;
                        strikeResult.CallDelta = Math.Round(delta, 5);
                        strikeResult.CallGamma = Math.Round(gamma, 7);
                        strikeResult.CallIV = Math.Round(iv, 4);
                        strikeResult.CallOI = oi;
                        strikeResult.CallGEX = Math.Round(gex / 1_000_000, 4);
                        strikeResult.CallPrevClose = prevClose.HasValue ? Math.Round(prevClose.Value, 2) : null;
                    }
                    else
                    {
                        strikeResult.PutStreamerSymbol = streamerSym;
                        strikeResult.PutDelta = Math.Round(delta, 5);
                        strikeResult.PutGamma = Math.Round(gamma, 7);
                        strikeResult.PutIV = Math.Round(iv, 4);
                        strikeResult.PutOI = oi;
                        strikeResult.PutGEX = Math.Round(-gex / 1_000_000, 4);
                        strikeResult.PutPrevClose = prevClose.HasValue ? Math.Round(prevClose.Value, 2) : null;
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

                // Call Wall: strike por encima del spot con mayor CallGEX
                var callWallStrike = response.Strikes
                    .Where(s => s.Strike > spot && s.CallGEX > 0)
                    .OrderByDescending(s => s.CallGEX)
                    .FirstOrDefault();
                response.CallWall = callWallStrike?.Strike;

                // Put Wall: strike por debajo del spot con mayor |PutGEX|
                var putWallStrike = response.Strikes
                    .Where(s => s.Strike < spot && s.PutGEX < 0)
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

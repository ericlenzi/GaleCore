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

        // Tope plausible de Open Interest por strike. El OI real no supera ~1e6; 1e9 deja 1000x
        // de holgura y queda muy por debajo de long.MaxValue (evita el overflow del cast).
        private const double MAX_PLAUSIBLE_OI = 1_000_000_000;

        /// <summary>
        /// Parsea el Open Interest de un candle y valida que sea un valor plausible para agregar al GEX.
        /// Rechaza no-parseables, &lt;= 0, NaN/Infinity e implausibles (&gt; 1e9). Sin esta guarda, un OI
        /// corrupto llega a <c>(long)poi</c> y, si el double excede long.MaxValue, desborda a
        /// <c>long.MinValue</c> (-9.2e18) — un sentinel que envenena el netGEX agregado.
        /// </summary>
        public static bool TryParseValidOpenInterest(string? raw, out long oi)
        {
            oi = 0;
            if (!double.TryParse(raw, NumberStyles.Any, CultureInfo.InvariantCulture, out var poi)
                || poi <= 0 || poi > MAX_PLAUSIBLE_OI || double.IsNaN(poi) || double.IsInfinity(poi))
                return false;
            oi = (long)poi;
            return true;
        }

        /// <summary>
        /// Clamp defensivo en el punto de uso: un OI corrupto/faltante (o cacheado antes de la
        /// validación) no debe contribuir al GEX. Nunca negativo.
        /// </summary>
        public static long SanitizeOpenInterest(long oi) => oi < 0 ? 0 : oi;

        /// <summary>
        /// Obtiene Greeks (IV/delta/gamma) + OI por símbolo vía la conexión DXLink persistente,
        /// sin abrir una sesión nueva. Greeks pasa por reference-counting (no pisa al Monitor);
        /// Candle (OI) va en lotes con cache diario.
        /// </summary>
        private async Task<MultiGreeksModel> FetchGreeksAndOIAsync(
            string[] streamerSymbols, double candleDeltaMin, double candleDeltaMax, CancellationToken ct,
            int greeksBatchSize = 0, int greeksRetries = 0)
        {
            var result = new MultiGreeksModel();
            if (streamerSymbols == null || streamerSymbols.Length == 0) return result;

            // ── Fase 1: Greeks (ref-counted) ──
            // greeksBatchSize > 0 trocea el pedido: con la cadena completa (modo global) son miles de
            // símbolos y una sola suscripción gigante hace timeout antes de completar.
            //
            // RequestSnapshotAsync devuelve lo que alcanzó a juntar cuando vence el timeout, así que
            // un lote lento deja símbolos sin Greeks — y sin Greeks el strike se cae del GEX en
            // silencio. Con la cadena completa eso significa vencimientos enteros faltantes y un
            // netGEX que cambia entre corridas. Por eso se reintenta lo que faltó: cada vuelta pide
            // solo los que quedaron y el conjunto se achica rápido.
            var pending = streamerSymbols;

            for (int attempt = 0; attempt <= greeksRetries; attempt++)
            {
                if (ct.IsCancellationRequested || pending.Length == 0) break;

                var greeksBatches = greeksBatchSize > 0
                    ? pending.Chunk(greeksBatchSize).ToList()
                    : new List<string[]> { pending };

                foreach (var batch in greeksBatches)
                {
                    if (ct.IsCancellationRequested) break;

                    var greeksItems = await _streaming.RequestSnapshotAsync(
                        batch.Select(s => (s, "Greeks", (long?)null)).ToList(),
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
                }

                pending = pending.Where(s => !result.Greeks.ContainsKey(s)).ToArray();
            }

            result.SymbolsRequested = streamerSymbols.Length;

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
            // DXLink rechaza con BAD_ACTION ("Candle subscription too big") si el lote pasa su
            // cupo de suscripciones Candle activas, y como el canal 3 es compartido, ese rechazo
            // degrada Trade/Quote/Greeks también. Con el GEX global (cadena entera) los lotes
            // llegaban al tope de 80 y disparaban el error; se baja a 40 (el orden que ya andaba
            // antes del barrido global).
            const int CANDLE_BATCH_SIZE = 40;
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
                    // Validar y sanitizar el OI antes de cachearlo (ver TryParseValidOpenInterest).
                    if (!TryParseValidOpenInterest(newest.Cd.OpenInterest, out var oiParsed))
                        continue;

                    result.OpenInterest[grp.Key] = oiParsed;
                    double? pc = null;
                    if (!string.IsNullOrEmpty(newest.Cd.Close)
                        && double.TryParse(newest.Cd.Close, NumberStyles.Any, CultureInfo.InvariantCulture, out var pcv) && pcv > 0)
                    {
                        pc = pcv;
                        result.PrevClose[grp.Key] = pcv;
                    }
                    _oiCache[grp.Key] = (oiParsed, pc, today);
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

                // Filtrar expiraciones. Por defecto (modo histórico): solo "Regular", DTE > 0.
                // La estrategia GEX pasa ExpirationTypes = [Regular, Weekly] e IncludeZeroDte = true.
                var allowedTypes = request.ExpirationTypes is { Length: > 0 }
                    ? request.ExpirationTypes
                    : new[] { "Regular" };
                int minDte = request.IncludeZeroDte ? 0 : 1;

                var candidateExpirations = allExpirations
                    .Where(e => allowedTypes.Contains(e.ExpirationType)
                             && e.DaysToExpiration >= minDte
                             && e.DaysToExpiration <= request.MaxDTE)
                    .ToList();

                if (!candidateExpirations.Any())
                    throw new Exception($"No se encontraron expiraciones ({string.Join("/", allowedTypes)}) dentro de {request.MaxDTE} DTE para {request.Symbol}");

                // Modo histórico: la más cercana (el OrderByDescending + First original devolvía la de
                // MAYOR DTE dentro del rango; se conserva ese orden para no cambiar el comportamiento).
                // Modo global: todas, ordenadas por DTE ascendente.
                var expirations = request.AllExpirations
                    ? candidateExpirations.OrderBy(e => e.DaysToExpiration).ToList()
                    : new List<Expiration> { candidateExpirations.OrderByDescending(e => e.DaysToExpiration).First() };

                // La raíz de la respuesta describe la expiración de referencia: la única en modo
                // histórico, la más cercana en modo global (el agregado abarca todas las de ByExpiry).
                var headExpiration = expirations.First();
                response.Expiration = headExpiration.ExpirationDate;
                response.DTE = headExpiration.DaysToExpiration;
                response.ExpirationType = headExpiration.ExpirationType;

                // ═══════════════════════════════════════════════════════════
                // PASO 2: Armar lista de símbolos streamer para la suscripción
                // ═══════════════════════════════════════════════════════════
                var streamerSymbols = new List<string>();
                // streamerSym → (strike, C/P, expiración a la que pertenece)
                var strikeMap = new Dictionary<string, (double Strike, string Type, Expiration Exp)>();

                foreach (var expiration in expirations)
                {
                    foreach (var strike in expiration.strikes)
                    {
                        var strikePrice = double.Parse(strike.StrikePrice, CultureInfo.InvariantCulture);

                        // Call
                        if (!string.IsNullOrEmpty(strike.CallStreamerSymbol))
                        {
                            streamerSymbols.Add(strike.CallStreamerSymbol);
                            strikeMap[strike.CallStreamerSymbol] = (strikePrice, "C", expiration);
                        }

                        // Put
                        if (!string.IsNullOrEmpty(strike.PutStreamerSymbol))
                        {
                            streamerSymbols.Add(strike.PutStreamerSymbol);
                            strikeMap[strike.PutStreamerSymbol] = (strikePrice, "P", expiration);
                        }
                    }
                }

                // ═══════════════════════════════════════════════════════════
                // PASO 3: Greeks + OI vía la conexión DXLink persistente (sin sesión nueva).
                // Banda de |delta| 0.02–0.98 para pedir OI solo de strikes relevantes (gamma ≈ 0 afuera).
                // ═══════════════════════════════════════════════════════════
                var multiGreeks = await FetchGreeksAndOIAsync(
                    streamerSymbols.ToArray(),
                    candleDeltaMin: request.OiDeltaMin,
                    candleDeltaMax: request.OiDeltaMax,
                    cancellationToken,
                    greeksBatchSize: request.GreeksBatchSize,
                    greeksRetries: request.GreeksRetries
                );

                // Cobertura del snapshot: cuántos de los símbolos pedidos volvieron con Greeks.
                // Si no es total, el GEX está incompleto y hay que poder verlo.
                response.SymbolsRequested = multiGreeks.SymbolsRequested;
                response.SymbolsWithGreeks = multiGreeks.Greeks.Count;
                response.ExpirationsRequested = expirations.Count;

                response.Spot = spot;

                // Tasa libre de riesgo (default, podría mejorarse con FRED)
                double r = DEFAULT_RISK_FREE_RATE;
                response.RiskFreeRate = r;

                // ═══════════════════════════════════════════════════════════
                // PASO 4: GEX por strike usando Greeks de DXLink
                // Se acumula por (expiración → strike). En modo de una sola expiración hay un solo
                // grupo y el agregado final es idéntico al de siempre.
                // ═══════════════════════════════════════════════════════════
                var byExpiry = new Dictionary<string, Dictionary<double, GammaExposureStrike>>();

                foreach (var kvp in multiGreeks.Greeks)
                {
                    var streamerSym = kvp.Key;
                    var greeksData = kvp.Value;

                    if (!strikeMap.TryGetValue(streamerSym, out var info))
                        continue;

                    double strikePrice = info.Strike;
                    string optType = info.Type;
                    string expKey = info.Exp.ExpirationDate;

                    // IV y Greeks directamente de DXLink (tiempo real)
                    double iv = greeksData.Volatility;
                    if (iv <= 0 || double.IsNaN(iv)) continue;

                    double delta = greeksData.Delta;
                    double gamma = greeksData.Gamma;

                    // OI del candle del cierre anterior. Clamp defensivo (ver SanitizeOpenInterest):
                    // un OI corrupto/cacheado no debe contribuir al GEX.
                    multiGreeks.OpenInterest.TryGetValue(streamerSym, out long oiRaw);
                    long oi = SanitizeOpenInterest(oiRaw);

                    // Cierre del período anterior (close del mismo candle diario)
                    double? prevClose = multiGreeks.PrevClose.TryGetValue(streamerSym, out double pc) ? pc : (double?)null;

                    // Inicializar expiración/strike si no existen
                    if (!byExpiry.TryGetValue(expKey, out var expStrikes))
                        byExpiry[expKey] = expStrikes = new Dictionary<double, GammaExposureStrike>();

                    if (!expStrikes.ContainsKey(strikePrice))
                        expStrikes[strikePrice] = new GammaExposureStrike { Strike = strikePrice };

                    var strikeResult = expStrikes[strikePrice];

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
                // PASO 5: Desglose por vencimiento + agregado global
                // ═══════════════════════════════════════════════════════════
                if (request.IncludeByExpiry)
                {
                    foreach (var exp in expirations)
                    {
                        if (!byExpiry.TryGetValue(exp.ExpirationDate, out var expStrikes) || expStrikes.Count == 0)
                            continue;

                        var strikes = expStrikes.Values.OrderBy(s => s.Strike).ToList();

                        // IV ATM del vencimiento: el strike más cercano al spot que tenga IV.
                        var atm = strikes
                            .Where(s => s.CallIV > 0 || s.PutIV > 0)
                            .OrderBy(s => Math.Abs(s.Strike - spot))
                            .FirstOrDefault();
                        double? atmIv = atm == null ? null
                            : (atm.CallIV > 0 && atm.PutIV > 0) ? (atm.CallIV + atm.PutIV) / 2
                            : (atm.CallIV > 0 ? atm.CallIV : atm.PutIV);

                        double? expectedMove = atmIv.HasValue && atmIv.Value > 0
                            ? Math.Round(spot * atmIv.Value * Math.Sqrt(Math.Max(exp.DaysToExpiration, 0) / 365.0), 2)
                            : null;

                        response.ByExpiry.Add(new GammaExposureExpiry
                        {
                            Expiration = exp.ExpirationDate,
                            DTE = exp.DaysToExpiration,
                            ExpirationType = exp.ExpirationType,
                            GammaZeroLevel = CalculateGammaZero(strikes, spot),
                            CallWall = strikes.Where(s => s.Strike > spot && s.CallGEX > 0)
                                              .OrderByDescending(s => s.CallGEX).FirstOrDefault()?.Strike,
                            PutWall = strikes.Where(s => s.Strike < spot && s.PutGEX < 0)
                                             .OrderBy(s => s.PutGEX).FirstOrDefault()?.Strike,
                            AtmIv = atmIv.HasValue ? Math.Round(atmIv.Value, 4) : null,
                            ExpectedMove = expectedMove,
                            Strikes = strikes,
                        });
                    }
                }

                // Agregado: un strike puede repetirse en varias expiraciones. GEX y OI se suman —
                // es la definición de GEX global. Delta/gamma/IV NO se suman (no tendría sentido):
                // se toman de la expiración más cercana que tenga ese strike, como referencia.
                response.Strikes = AggregateStrikes(expirations, byExpiry);

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
        /// Colapsa los strikes de todas las expiraciones en una sola curva por strike (GEX global).
        /// GEX y OI se suman; delta, gamma, IV, streamer symbol y cierre previo se toman de la
        /// expiración más cercana que tenga ese strike — sumarlos no tendría significado.
        /// Con una sola expiración devuelve exactamente sus strikes.
        /// </summary>
        private static List<GammaExposureStrike> AggregateStrikes(
            List<Expiration> expirations,
            Dictionary<string, Dictionary<double, GammaExposureStrike>> byExpiry)
        {
            var aggregated = new Dictionary<double, GammaExposureStrike>();

            // De más cercana a más lejana: la primera que toca un strike fija sus greeks de referencia.
            foreach (var exp in expirations.OrderBy(e => e.DaysToExpiration))
            {
                if (!byExpiry.TryGetValue(exp.ExpirationDate, out var expStrikes)) continue;

                foreach (var src in expStrikes.Values)
                {
                    if (!aggregated.TryGetValue(src.Strike, out var acc))
                    {
                        // Copia: el objeto de la expiración se sigue publicando en ByExpiry y no debe mutarse.
                        aggregated[src.Strike] = new GammaExposureStrike
                        {
                            Strike = src.Strike,
                            CallStreamerSymbol = src.CallStreamerSymbol,
                            CallDelta = src.CallDelta,
                            CallGamma = src.CallGamma,
                            CallIV = src.CallIV,
                            CallOI = src.CallOI,
                            CallGEX = src.CallGEX,
                            CallPrevClose = src.CallPrevClose,
                            PutStreamerSymbol = src.PutStreamerSymbol,
                            PutDelta = src.PutDelta,
                            PutGamma = src.PutGamma,
                            PutIV = src.PutIV,
                            PutOI = src.PutOI,
                            PutGEX = src.PutGEX,
                            PutPrevClose = src.PutPrevClose,
                        };
                        continue;
                    }

                    acc.CallOI += src.CallOI;
                    acc.PutOI += src.PutOI;
                    acc.CallGEX = Math.Round(acc.CallGEX + src.CallGEX, 4);
                    acc.PutGEX = Math.Round(acc.PutGEX + src.PutGEX, 4);

                    // Greeks de referencia: si la expiración más cercana no tenía ese lado, se completa.
                    if (acc.CallDelta == 0 && src.CallDelta != 0)
                    {
                        acc.CallStreamerSymbol = src.CallStreamerSymbol;
                        acc.CallDelta = src.CallDelta;
                        acc.CallGamma = src.CallGamma;
                        acc.CallIV = src.CallIV;
                        acc.CallPrevClose = src.CallPrevClose;
                    }
                    if (acc.PutDelta == 0 && src.PutDelta != 0)
                    {
                        acc.PutStreamerSymbol = src.PutStreamerSymbol;
                        acc.PutDelta = src.PutDelta;
                        acc.PutGamma = src.PutGamma;
                        acc.PutIV = src.PutIV;
                        acc.PutPrevClose = src.PutPrevClose;
                    }
                }
            }

            return aggregated.Values.OrderBy(s => s.Strike).ToList();
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

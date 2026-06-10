using Microsoft.Extensions.Configuration;
using System.Text.Json;
using DataFeed.Infrastructure.Providers.Tastytrade.Models;
using DataFeed.Infrastructure.Providers;
using System.Net.Http;
using static System.Runtime.InteropServices.JavaScript.JSType;
using System.Net.Http.Headers;
using System.Text.Json.Serialization;
using System.Threading;
using System.Threading.Tasks;
using Websocket.Client;
using System.Reactive;
using System.Net.Http.Json;
using System.Net.WebSockets;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using System.Globalization;

namespace DataFeed.Infrastructure.Providers.Tastytrade
{
    public class TastytradeSocketProvider : ITastytradeSocketProvider
    {
        private readonly HttpClient _client;
        private readonly ITastytradeOAuth _auth;
        private readonly IConfiguration _config;
        private readonly HttpRequestHeaders _request;

        private List<CandleModel> candles = new();

        // Cache de OI + cierre anterior por símbolo streamer. El OI es el settled del día previo
        // (no cambia intradía), así que se cachea por día: la primera llamada del día paga el
        // fetch de Candle; las siguientes reutilizan el valor. Estático porque el provider se
        // instancia por request. Key: símbolo streamer. Value: (OI, prevClose, día UTC del fetch).
        private static readonly System.Collections.Concurrent.ConcurrentDictionary<string, (long Oi, double? PrevClose, DateTime Day)> _oiCache = new();

        public TastytradeSocketProvider(IConfiguration config, ITastytradeOAuth auth, IHttpClientFactory client)
        {
            _config = config;
            _client = client.CreateClient();
            _client.BaseAddress = new Uri(_config["Tastytrade:BaseUrl"]);
            _auth = auth;
        }

        #region Socket

        public async Task<CandleModel> GetCandleAsync(string symbol, string interval, DateTime fromTime, DateTime? toTime, CancellationToken cancellationToken)
        {
            var response = new CandleModel()
            {
                type = "FEED_DATA",
                channel = 3,
                data = new List<CandleData>()
            };

            var tcs = new TaskCompletionSource<bool>();

            var authws = await _auth.GetWsOAuthApiAsync();
            string token = authws.Data.Token;

            using var socket = new WebsocketClient(new Uri(authws.Data.DxlinkUrl));
            socket.ReconnectTimeout = TimeSpan.FromSeconds(30);

            socket.MessageReceived.Subscribe(m =>
            {
                var json = JObject.Parse(m.Text);

                if (json["type"]?.ToString() == "FEED_DATA")
                {
                    var feedData = JsonConvert.DeserializeObject<CandleModel>(m.Text);
                    if (feedData?.data == null)
                        return;

                    // Acumular candles de cada mensaje
                    response.data.AddRange(feedData.data);

                    // Verificar si algún evento tiene SNAPSHOT_END (0x08) o SNAPSHOT_SNIP (0x10)
                    foreach (var candle in feedData.data)
                    {
                        if ((candle.EventFlags & 0x08) != 0 || (candle.EventFlags & 0x10) != 0)
                        {
                            tcs.TrySetResult(true);
                            return;
                        }
                    }
                }
                else if (json["type"]?.ToString() == "ERROR")
                {
                    tcs.TrySetResult(false);
                }
            });

            await socket.Start();
            await DxLinkHandshake.PerformAsync(socket, token);

            void Send(object msg) => socket.Send(JsonConvert.SerializeObject(msg));

            string symball = symbol + "{=" + interval + "}";
            var unixFromTime = new DateTimeOffset(fromTime, TimeSpan.Zero).ToUnixTimeMilliseconds();

            Send(new
            {
                type = "FEED_SUBSCRIPTION",
                channel = 3,
                add = new[]
                {
                    new {
                        type = "Candle",
                        symbol = symball,
                        fromTime = unixFromTime
                    }
                }
            });

            // ⏳ Esperar snapshot completo o timeout de 30 segundos
            var completed = await Task.WhenAny(tcs.Task, Task.Delay(TimeSpan.FromSeconds(30), cancellationToken));

            // 🔌 Desuscribir
            Send(new
            {
                type = "FEED_SUBSCRIPTION",
                channel = 3,
                remove = new[]
                {
                    new {
                        type = "Candle",
                        symbol = symball
                    }
                }
            });

            return response;
        }

        public async Task<TradeModel> GetTradeAsync(string symbol, CancellationToken cancellationToken)
        {
            var response = new TradeModel();
            var tcs = new TaskCompletionSource<bool>();

            var authws = await _auth.GetWsOAuthApiAsync();
            string token = authws.Data.Token;

            using var socket = new WebsocketClient(new Uri(authws.Data.DxlinkUrl));
            socket.ReconnectTimeout = TimeSpan.FromSeconds(30);

            socket.MessageReceived.Subscribe(m =>
            {
                var json = JObject.Parse(m.Text);

                if (json["type"]?.ToString() == "FEED_DATA")
                {
                    response = JsonConvert.DeserializeObject<TradeModel>(m.Text);
                    tcs.TrySetResult(true);
                }
                else if (json["type"]?.ToString() == "ERROR")
                {
                    tcs.TrySetResult(false);
                }
            });

            await socket.Start();
            await DxLinkHandshake.PerformAsync(socket, token);

            void Send(object msg) => socket.Send(JsonConvert.SerializeObject(msg));

            Send(new
            {
                type = "FEED_SUBSCRIPTION",
                channel = 3,
                add = new[]
                {
                    new { type = "Trade", symbol }
                }
            });

            await Task.WhenAny(tcs.Task, Task.Delay(TimeSpan.FromSeconds(10), cancellationToken));

            Send(new
            {
                type = "FEED_SUBSCRIPTION",
                channel = 3,
                remove = new[]
                {
                    new { type = "Trade", symbol }
                }
            });

            return response;
        }

        public async Task<QuoteModel> GetQuoteAsync(string symbol, CancellationToken cancellationToken)
        {
            var response = new QuoteModel();
            var tcs = new TaskCompletionSource<bool>();

            var authws = await _auth.GetWsOAuthApiAsync();
            string token = authws.Data.Token;

            using var socket = new WebsocketClient(new Uri(authws.Data.DxlinkUrl));
            socket.ReconnectTimeout = TimeSpan.FromSeconds(30);

            socket.MessageReceived.Subscribe(m =>
            {
                var json = JObject.Parse(m.Text);

                if (json["type"]?.ToString() == "FEED_DATA")
                {
                    response = JsonConvert.DeserializeObject<QuoteModel>(m.Text);
                    tcs.TrySetResult(true);
                }
                else if (json["type"]?.ToString() == "ERROR")
                {
                    tcs.TrySetResult(false);
                }
            });

            await socket.Start();
            await DxLinkHandshake.PerformAsync(socket, token);

            void Send(object msg) => socket.Send(JsonConvert.SerializeObject(msg));

            Send(new
            {
                type = "FEED_SUBSCRIPTION",
                channel = 3,
                add = new[]
                {
                    new { type = "Quote", symbol }
                }
            });

            await Task.WhenAny(tcs.Task, Task.Delay(TimeSpan.FromSeconds(10), cancellationToken));

            Send(new
            {
                type = "FEED_SUBSCRIPTION",
                channel = 3,
                remove = new[]
                {
                    new { type = "Quote", symbol }
                }
            });

            return response;
        }

        public async Task<GreeksModel> GetGreeksAsync(string symbol, CancellationToken cancellationToken)
        {
            var response = new GreeksModel();
            var tcs = new TaskCompletionSource<bool>();

            var authws = await _auth.GetWsOAuthApiAsync();
            string token = authws.Data.Token;

            using var socket = new WebsocketClient(new Uri(authws.Data.DxlinkUrl));
            socket.ReconnectTimeout = TimeSpan.FromSeconds(30);

            socket.MessageReceived.Subscribe(m =>
            {
                var json = JObject.Parse(m.Text);

                if (json["type"]?.ToString() == "FEED_DATA")
                {
                    response = JsonConvert.DeserializeObject<GreeksModel>(m.Text);
                    tcs.TrySetResult(true);
                }
                else if (json["type"]?.ToString() == "ERROR")
                {
                    tcs.TrySetResult(false);
                }
            });

            await socket.Start();
            await DxLinkHandshake.PerformAsync(socket, token);

            void Send(object msg) => socket.Send(JsonConvert.SerializeObject(msg));

            Send(new
            {
                type = "FEED_SUBSCRIPTION",
                channel = 3,
                add = new[]
                {
                    new { type = "Greeks", symbol }
                }
            });

            await Task.WhenAny(tcs.Task, Task.Delay(TimeSpan.FromSeconds(10), cancellationToken));

            Send(new
            {
                type = "FEED_SUBSCRIPTION",
                channel = 3,
                remove = new[]
                {
                    new { type = "Greeks", symbol }
                }
            });

            return response;
        }

        public async Task<TradeQuoteGreeksModel> GetTradeQuoteGreeksAsync(string symbol, bool includeGreeks, CancellationToken cancellationToken)
        {
            var response = new TradeQuoteGreeksModel();
            bool hasTrade = false;
            bool hasQuote = false;
            bool hasGreeks = !includeGreeks; // Si no se pide Greeks, se considera completo

            var tcs = new TaskCompletionSource<bool>();

            var authws = await _auth.GetWsOAuthApiAsync();
            string token = authws.Data.Token;

            using var socket = new WebsocketClient(new Uri(authws.Data.DxlinkUrl));
            socket.ReconnectTimeout = TimeSpan.FromSeconds(30);

            socket.MessageReceived.Subscribe(m =>
            {
                var json = JObject.Parse(m.Text);

                if (json["type"]?.ToString() == "FEED_DATA")
                {
                    var dataArray = json["data"] as JArray;
                    if (dataArray == null) return;

                    foreach (var item in dataArray)
                    {
                        var eventType = item["eventType"]?.ToString();

                        if (eventType == "Trade" && !hasTrade)
                        {
                            response.Trade = JsonConvert.DeserializeObject<TradeModel>(m.Text);
                            hasTrade = true;
                        }
                        else if (eventType == "Quote" && !hasQuote)
                        {
                            response.Quote = JsonConvert.DeserializeObject<QuoteModel>(m.Text);
                            hasQuote = true;
                        }
                        else if (eventType == "Greeks" && !hasGreeks)
                        {
                            response.Greeks = JsonConvert.DeserializeObject<GreeksModel>(m.Text);
                            hasGreeks = true;
                        }
                    }

                    // Completar cuando llegaron todos los datos esperados
                    if (hasTrade && hasQuote && hasGreeks)
                        tcs.TrySetResult(true);
                }
                else if (json["type"]?.ToString() == "ERROR")
                {
                    tcs.TrySetResult(false);
                }
            });

            await socket.Start();
            await DxLinkHandshake.PerformAsync(socket, token);

            void Send(object msg) => socket.Send(JsonConvert.SerializeObject(msg));

            // Suscribir a Trade + Quote, y Greeks solo si es opción
            var subscriptions = new List<object>
            {
                new { type = "Trade", symbol },
                new { type = "Quote", symbol }
            };
            if (includeGreeks)
                subscriptions.Add(new { type = "Greeks", symbol });

            Send(new
            {
                type = "FEED_SUBSCRIPTION",
                channel = 3,
                add = subscriptions
            });

            // ⏳ Esperar todos los datos o timeout de 10 segundos
            await Task.WhenAny(tcs.Task, Task.Delay(TimeSpan.FromSeconds(10), cancellationToken));

            // 🔌 Desuscribir
            Send(new
            {
                type = "FEED_SUBSCRIPTION",
                channel = 3,
                remove = subscriptions
            });

            return response;
        }

        /// <summary>
        /// Suscribe a Quote (bid/ask) de múltiples opciones en UNA sola conexión WebSocket.
        /// Usar mid-price = (bid+ask)/2 para cálculos CBOE VIX model-free.
        /// </summary>
        public async Task<MultiQuoteModel> GetMultiQuoteAsync(string[] optionStreamerSymbols, CancellationToken cancellationToken)
        {
            var result = new MultiQuoteModel();
            if (optionStreamerSymbols == null || optionStreamerSymbols.Length == 0)
                return result;

            var pending = new HashSet<string>(optionStreamerSymbols);
            var tcs = new TaskCompletionSource<bool>();

            var authws = await _auth.GetWsOAuthApiAsync();
            string token = authws.Data.Token;

            using var socket = new WebsocketClient(new Uri(authws.Data.DxlinkUrl));
            socket.ReconnectTimeout = TimeSpan.FromSeconds(30);

            socket.MessageReceived.Subscribe(m =>
            {
                try
                {
                    var json = JObject.Parse(m.Text);
                    if (json["type"]?.ToString() != "FEED_DATA") return;

                    var dataArray = json["data"] as JArray;
                    if (dataArray == null) return;

                    foreach (var item in dataArray)
                    {
                        var eventSymbol = item["eventSymbol"]?.ToString();
                        if (string.IsNullOrEmpty(eventSymbol)) continue;

                        var quote = item.ToObject<QuoteEvent>();
                        if (quote == null) continue;

                        // Aceptar solo quotes con al menos bid o ask válido
                        if (quote.BidPrice > 0 || quote.AskPrice > 0)
                        {
                            result.Quotes[eventSymbol] = quote;
                            pending.Remove(eventSymbol);
                        }
                    }

                    if (pending.Count == 0)
                        tcs.TrySetResult(true);
                }
                catch { }
            });

            await socket.Start();
            await DxLinkHandshake.PerformAsync(socket, token);

            void Send(object msg) => socket.Send(JsonConvert.SerializeObject(msg));

            var subscriptions = optionStreamerSymbols
                .Select(sym => (object)new { type = "Quote", symbol = sym })
                .ToList();

            Send(new { type = "FEED_SUBSCRIPTION", channel = 3, add = subscriptions });

            await Task.WhenAny(tcs.Task, Task.Delay(TimeSpan.FromSeconds(15), cancellationToken));

            Send(new { type = "FEED_SUBSCRIPTION", channel = 3, remove = subscriptions });

            return result;
        }

        /// <summary>
        /// Suscribe a Greeks + Candle (para OI) de múltiples opciones en UNA sola conexión.
        /// Greeks devuelve IV/delta/gamma en tiempo real. Candle devuelve OI del cierre anterior.
        /// </summary>
        /// <param name="candleDeltaMin">Mínimo |delta| para suscribir Candle (OI). Permite saltar
        /// strikes deep OTM/ITM que aportan gamma ≈ 0. Default 0 = sin filtro inferior.</param>
        /// <param name="candleDeltaMax">Máximo |delta| para suscribir Candle. Default 1 = sin filtro superior.</param>
        public async Task<MultiGreeksModel> GetMultiGreeksAsync(string[] optionStreamerSymbols, CancellationToken cancellationToken,
            double candleDeltaMin = 0.0, double candleDeltaMax = 1.0)
        {
            var result = new MultiGreeksModel();
            if (optionStreamerSymbols == null || optionStreamerSymbols.Length == 0)
                return result;

            // pendingGreeks: todos. pendingCandles se llena luego del filtro por delta (Fase 2).
            var pendingGreeks = new HashSet<string>(optionStreamerSymbols);
            var pendingCandles = new HashSet<string>();
            var tcs = new TaskCompletionSource<bool>();

            var authws = await _auth.GetWsOAuthApiAsync();
            string token = authws.Data.Token;

            using var socket = new WebsocketClient(new Uri(authws.Data.DxlinkUrl));
            socket.ReconnectTimeout = TimeSpan.FromSeconds(30);

            socket.MessageReceived.Subscribe(m =>
            {
                try
                {
                    var json = JObject.Parse(m.Text);
                    var msgType = json["type"]?.ToString();

                    // No tragar errores de DXLink en silencio: loguearlos (ej. límite de
                    // suscripción Candle excedido) facilita diagnosticar fallos de feed.
                    if (msgType == "ERROR")
                    {
                        Console.WriteLine($"[GetMultiGreeksAsync] DXLink ERROR: {m.Text}");
                        return;
                    }

                    if (msgType != "FEED_DATA") return;

                    var dataArray = json["data"] as JArray;
                    if (dataArray == null) return;

                    foreach (var item in dataArray)
                    {
                        var eventType = item["eventType"]?.ToString();
                        var eventSymbol = item["eventSymbol"]?.ToString();
                        if (string.IsNullOrEmpty(eventSymbol)) continue;

                        if (eventType == "Greeks")
                        {
                            var greeks = item.ToObject<GreeksEvent>();
                            if (greeks != null && greeks.Volatility > 0)
                            {
                                result.Greeks[eventSymbol] = greeks;
                                pendingGreeks.Remove(eventSymbol);
                            }
                        }
                        else
                        {
                            // Candle para OI + cierre del período anterior (eventType puede ser "Candle" o ausente)
                            var candleData = item.ToObject<CandleData>();
                            if (candleData == null) continue;

                            var candleKey = eventSymbol.Replace("{=d}", "");

                            if (!string.IsNullOrEmpty(candleData.OpenInterest))
                            {
                                // OI puede llegar como decimal ("1234.0") o entero
                                if (double.TryParse(candleData.OpenInterest,
                                    NumberStyles.Any, CultureInfo.InvariantCulture, out double parsedOI)
                                    && parsedOI > 0)
                                {
                                    result.OpenInterest[candleKey] = (long)parsedOI;

                                    // Close del mismo candle = cierre del período anterior del leg
                                    double? prevClose = null;
                                    if (!string.IsNullOrEmpty(candleData.Close)
                                        && double.TryParse(candleData.Close,
                                            NumberStyles.Any, CultureInfo.InvariantCulture, out double parsedClose)
                                        && parsedClose > 0)
                                    {
                                        prevClose = parsedClose;
                                        result.PrevClose[candleKey] = parsedClose;
                                    }

                                    // Cachear para reusar en las próximas llamadas del mismo día
                                    _oiCache[candleKey] = ((long)parsedOI, prevClose, DateTime.UtcNow.Date);
                                }

                                // Marcar candle como recibido independientemente del valor de OI
                                pendingCandles.Remove(candleKey);
                            }
                            // SNAPSHOT_END (0x08) o SNAPSHOT_SNIP (0x10): el snapshot del símbolo
                            // terminó sin OI útil → marcarlo recibido para no esperar el timeout del lote.
                            else if ((candleData.EventFlags & 0x08) != 0 || (candleData.EventFlags & 0x10) != 0)
                            {
                                pendingCandles.Remove(candleKey);
                            }
                        }
                    }

                    // Señalar cuando todos los Greeks están disponibles
                    if (pendingGreeks.Count == 0)
                        tcs.TrySetResult(true);
                }
                catch { }
            });

            await socket.Start();
            await DxLinkHandshake.PerformAsync(socket, token);

            void Send(object msg) => socket.Send(JsonConvert.SerializeObject(msg));

            // DXLink limita el TOTAL de suscripciones Candle activas en el canal (no por mensaje):
            // si se acumulan demasiadas devuelve BAD_ACTION ("subscription size for event type
            // 'Candle' is too big"). Por eso los Candle se procesan en lotes con ciclo
            // add → esperar snapshot → remove, manteniendo las activas siempre ≤ batch size.
            // Los Greeks (streaming liviano) no tienen ese límite y van en un solo bloque.
            const int CANDLE_BATCH_SIZE = 80;
            var fromTime = new DateTimeOffset(DateTime.UtcNow.Date.AddDays(-2), TimeSpan.Zero).ToUnixTimeMilliseconds();

            // Suscripción Greeks (IV/delta/gamma real-time) — un solo bloque
            var greeksSubs = optionStreamerSymbols
                .Select(sym => (object)new { type = "Greeks", symbol = sym })
                .ToList();
            Send(new { type = "FEED_SUBSCRIPTION", channel = 3, add = greeksSubs });

            // Fase 1: esperar hasta que lleguen todos los Greeks (máx 15s)
            await Task.WhenAny(tcs.Task, Task.Delay(TimeSpan.FromSeconds(15), cancellationToken));

            // Filtro por banda de |delta|: solo pedimos Candle (OI) de strikes relevantes.
            // Los deep OTM/ITM (fuera de la banda) aportan gamma ≈ 0 y solo agregan latencia.
            // Si no llegó el Greek de un símbolo, no se puede evaluar → se omite (sin OI igual).
            var candleSymbols = optionStreamerSymbols
                .Where(sym =>
                {
                    if (!result.Greeks.TryGetValue(sym, out var g)) return false;
                    var absDelta = Math.Abs(g.Delta);
                    return absDelta >= candleDeltaMin && absDelta <= candleDeltaMax;
                })
                .ToArray();

            // Cache diario: los símbolos ya cacheados hoy se resuelven sin pedir Candle.
            // Solo se fetchea (vía WebSocket) los cache-miss.
            var today = DateTime.UtcNow.Date;
            var toFetch = new List<string>();
            foreach (var sym in candleSymbols)
            {
                if (_oiCache.TryGetValue(sym, out var cached) && cached.Day == today)
                {
                    result.OpenInterest[sym] = cached.Oi;
                    if (cached.PrevClose.HasValue)
                        result.PrevClose[sym] = cached.PrevClose.Value;
                }
                else
                {
                    toFetch.Add(sym);
                    pendingCandles.Add(sym);
                }
            }

            // Fase 2: Candle (OI + cierre anterior) en lotes secuenciales add → esperar → remove
            for (int i = 0; i < toFetch.Count; i += CANDLE_BATCH_SIZE)
            {
                if (cancellationToken.IsCancellationRequested) break;

                var batchSymbols = toFetch.Skip(i).Take(CANDLE_BATCH_SIZE).ToArray();
                var addSubs = batchSymbols
                    .Select(sym => (object)new { type = "Candle", symbol = sym + "{=d}", fromTime })
                    .ToList();

                Send(new { type = "FEED_SUBSCRIPTION", channel = 3, add = addSubs });

                // Esperar a que lleguen los snapshots del lote (todos sus símbolos drenados) o timeout 4s
                var batchTimeout = Task.Delay(TimeSpan.FromSeconds(4), cancellationToken);
                var batchDone = Task.Run(async () =>
                {
                    while (batchSymbols.Any(s => pendingCandles.Contains(s)) && !cancellationToken.IsCancellationRequested)
                        await Task.Delay(100, CancellationToken.None);
                });
                await Task.WhenAny(batchDone, batchTimeout);

                // Liberar las suscripciones del lote antes de pasar al siguiente
                var removeSubs = batchSymbols
                    .Select(sym => (object)new { type = "Candle", symbol = sym + "{=d}" })
                    .ToList();
                Send(new { type = "FEED_SUBSCRIPTION", channel = 3, remove = removeSubs });
            }

            Send(new { type = "FEED_SUBSCRIPTION", channel = 3, remove = greeksSubs });

            return result;
        }

        /// <summary>
        /// Suscribe a Candle diario para el subyacente + todas las opciones en UNA sola conexión WebSocket.
        /// Espera a recibir snapshot de todos los símbolos o timeout.
        /// </summary>
        public async Task<MultiCandleModel> GetMultiCandleAsync(string underlyingSymbol, string[] optionStreamerSymbols, CancellationToken cancellationToken)
        {
            var response = new MultiCandleModel();
            var pendingSymbols = new HashSet<string>();

            // Armar lista de símbolos con formato candle diario
            var underlyingCandle = underlyingSymbol + "{=d}";
            pendingSymbols.Add(underlyingCandle);

            var optionCandles = new List<string>();
            foreach (var opt in optionStreamerSymbols)
            {
                var candleSym = opt + "{=d}";
                optionCandles.Add(candleSym);
                pendingSymbols.Add(candleSym);
            }

            int totalExpected = pendingSymbols.Count;
            var receivedSymbols = new HashSet<string>();
            var tcs = new TaskCompletionSource<bool>();

            var authws = await _auth.GetWsOAuthApiAsync();
            string token = authws.Data.Token;

            using var socket = new WebsocketClient(new Uri(authws.Data.DxlinkUrl));
            socket.ReconnectTimeout = TimeSpan.FromSeconds(30);

            socket.MessageReceived.Subscribe(m =>
            {
                try
                {
                    var json = JObject.Parse(m.Text);

                    if (json["type"]?.ToString() == "FEED_DATA")
                    {
                        var dataArray = json["data"] as JArray;
                        if (dataArray == null) return;

                        foreach (var item in dataArray)
                        {
                            var eventSymbol = item["eventSymbol"]?.ToString();
                            if (string.IsNullOrEmpty(eventSymbol)) continue;

                            var candleData = item.ToObject<CandleData>();
                            if (candleData == null) continue;

                            // Determinar si es el subyacente o una opción
                            if (eventSymbol == underlyingCandle)
                            {
                                response.Underlying = candleData;
                            }
                            else
                            {
                                // Guardar por símbolo streamer (sin el {=d})
                                var streamerKey = eventSymbol.Replace("{=d}", "");
                                response.Options[streamerKey] = candleData;
                            }

                            // Marcar como recibido si tiene SNAPSHOT_END o SNAPSHOT_SNIP
                            if ((candleData.EventFlags & 0x08) != 0 || (candleData.EventFlags & 0x10) != 0)
                            {
                                receivedSymbols.Add(eventSymbol);
                            }
                            else
                            {
                                // Si no tiene flags de snapshot, igualmente contar como recibido
                                receivedSymbols.Add(eventSymbol);
                            }

                            // Verificar si ya recibimos todos
                            if (receivedSymbols.Count >= totalExpected)
                            {
                                tcs.TrySetResult(true);
                            }
                        }
                    }
                    else if (json["type"]?.ToString() == "ERROR")
                    {
                        tcs.TrySetResult(false);
                    }
                }
                catch
                {
                    // Ignorar errores de parseo en mensajes individuales
                }
            });

            await socket.Start();
            await DxLinkHandshake.PerformAsync(socket, token);

            void Send(object msg) => socket.Send(JsonConvert.SerializeObject(msg));

            // Suscripción masiva: subyacente + todas las opciones en un solo mensaje
            var fromTime = new DateTimeOffset(DateTime.UtcNow.Date, TimeSpan.Zero).ToUnixTimeMilliseconds();
            var subscriptions = new List<object>();

            // Subyacente
            subscriptions.Add(new { type = "Candle", symbol = underlyingCandle, fromTime });

            // Todas las opciones
            foreach (var optCandle in optionCandles)
            {
                subscriptions.Add(new { type = "Candle", symbol = optCandle, fromTime });
            }

            Send(new
            {
                type = "FEED_SUBSCRIPTION",
                channel = 3,
                add = subscriptions
            });

            // ⏳ Esperar todos los snapshots o timeout de 15 segundos
            await Task.WhenAny(tcs.Task, Task.Delay(TimeSpan.FromSeconds(15), cancellationToken));

            // 🔌 Desuscribir todo
            Send(new
            {
                type = "FEED_SUBSCRIPTION",
                channel = 3,
                remove = subscriptions
            });

            return response;
        }

        #endregion

        #region Helper

        //private static decimal GetDecimalSafe(JsonElement el)
        //{
        //    return el.ValueKind switch
        //    {
        //        JsonValueKind.Number => el.GetDecimal(),
        //        JsonValueKind.String => decimal.TryParse(el.GetString(), out var result) ? result : 0m,
        //        _ => 0m
        //    };
        //}

        //private static double GetDoubleSafe(JsonElement el)
        //{
        //    return el.ValueKind switch
        //    {
        //        JsonValueKind.Number => el.GetDouble(),
        //        JsonValueKind.String => double.TryParse(el.GetString(), out var result) ? result : 0,
        //        _ => 0
        //    };
        //}

        //public static double ParseDoubleOrZero(string value)
        //{
        //    if (string.IsNullOrWhiteSpace(value) || value.Trim() == "NaN")
        //        return 0;

        //    return double.TryParse(value, NumberStyles.Any, CultureInfo.InvariantCulture, out double result) ? result : 0;
        //}

        //public static decimal ParseDecimalOrZero(string value)
        //{
        //    if (string.IsNullOrWhiteSpace(value) || value.Trim() == "NaN")
        //        return 0m;

        //    var res = decimal.TryParse(value, NumberStyles.Any, CultureInfo.InvariantCulture, out decimal result) ? result : 0m;
        //    return res;
        //}

        #endregion
    }
}
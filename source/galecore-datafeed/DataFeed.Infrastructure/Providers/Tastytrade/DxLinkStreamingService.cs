using System.Collections.Concurrent;
using System.Net.WebSockets;
using DataFeed.Infrastructure.Providers.Tastytrade.Models;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Websocket.Client;

namespace DataFeed.Infrastructure.Providers.Tastytrade
{
    public class DxLinkStreamingService : IHostedService, IDxLinkStreamingService, IDisposable
    {
        private readonly ITastytradeOAuth _auth;
        private readonly IMarketDataBroadcaster _broadcaster;
        private readonly IFlowAggregatorService _flowAggregator;
        private readonly ILogger<DxLinkStreamingService> _logger;

        private WebsocketClient? _socket;
        private readonly SemaphoreSlim _connectionLock = new(1, 1);
        private bool _isConnected;
        private bool _handshakeComplete;
        private CancellationTokenSource? _cts;

        // Handshake synchronization
        private TaskCompletionSource<bool>? _authTcs;
        private TaskCompletionSource<bool>? _channelTcs;

        // Reference counting: (symbol, eventType) -> cantidad de suscriptores
        private readonly ConcurrentDictionary<(string Symbol, string EventType), int> _subscriptions = new();
        private readonly object _subLock = new();

        // Pending subscriptions queued before handshake completes
        private readonly ConcurrentQueue<List<object>> _pendingSubscriptions = new();

        // Collectors activos para requests de snapshot (request/response sobre la conexión persistente)
        private readonly ConcurrentDictionary<Guid, SnapshotCollector> _collectors = new();

        public DxLinkStreamingService(
            ITastytradeOAuth auth,
            IMarketDataBroadcaster broadcaster,
            IFlowAggregatorService flowAggregator,
            ILogger<DxLinkStreamingService> logger)
        {
            _auth = auth;
            _broadcaster = broadcaster;
            _flowAggregator = flowAggregator;
            _logger = logger;
        }

        public async Task StartAsync(CancellationToken cancellationToken)
        {
            _cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            _logger.LogInformation("DxLinkStreamingService iniciando...");
            await ConnectAsync();
        }

        public async Task StopAsync(CancellationToken cancellationToken)
        {
            _logger.LogInformation("DxLinkStreamingService deteniendo...");
            _cts?.Cancel();

            if (_socket != null)
            {
                await _socket.Stop(WebSocketCloseStatus.NormalClosure, "Servicio detenido");
                _socket.Dispose();
                _socket = null;
            }

            _isConnected = false;
            _handshakeComplete = false;
        }

        public void Dispose()
        {
            _socket?.Dispose();
            _connectionLock.Dispose();
            _cts?.Dispose();
        }

        #region Conexión y handshake

        private async Task ConnectAsync()
        {
            await _connectionLock.WaitAsync();
            try
            {
                if (_isConnected) return;

                var authws = await _auth.GetWsOAuthApiAsync();
                var token = authws.Data.Token;
                var url = new Uri(authws.Data.DxlinkUrl);

                _socket = new WebsocketClient(url)
                {
                    ReconnectTimeout = null
                };

                _socket.ReconnectionHappened.Subscribe(info =>
                {
                    // Skip initial connection — handshake is done below in ConnectAsync
                    if (info.Type != ReconnectionType.Initial)
                    {
                        _logger.LogInformation("DxLink reconectado: {Type}", info.Type);
                        _ = OnReconnectedAsync();
                    }
                });

                _socket.DisconnectionHappened.Subscribe(info =>
                {
                    _logger.LogWarning("DxLink desconectado: {Type} - {CloseStatus}", info.Type, info.CloseStatus);
                    _isConnected = false;
                    _handshakeComplete = false;

                    if (_cts is { IsCancellationRequested: false })
                    {
                        _ = ReconnectWithDelayAsync();
                    }
                });

                _socket.MessageReceived.Subscribe(OnMessageReceived);

                await _socket.Start();
                _isConnected = true;

                await DoHandshakeAsync(token);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error conectando a DxLink");
                _isConnected = false;
                _handshakeComplete = false;

                if (_cts is { IsCancellationRequested: false })
                {
                    _ = ReconnectWithDelayAsync();
                }
            }
            finally
            {
                _connectionLock.Release();
            }
        }

        private async Task DoHandshakeAsync(string token)
        {
            _handshakeComplete = false;
            _authTcs = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            _channelTcs = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);

            // Step 1: SETUP
            Send(new { type = "SETUP", channel = 0, version = "0.1-DXF-JS/0.3.0", keepaliveTimeout = 60, acceptKeepaliveTimeout = 60 });

            // Step 2: AUTH — send and wait for AUTH_STATE: AUTHORIZED
            Send(new { type = "AUTH", channel = 0, token });
            _logger.LogInformation("DxLink: esperando AUTH_STATE AUTHORIZED...");

            if (await Task.WhenAny(_authTcs.Task, Task.Delay(10000)) != _authTcs.Task)
            {
                _logger.LogError("DxLink: timeout esperando AUTH — reintentando conexión");
                throw new TimeoutException("DxLink AUTH timeout");
            }
            _logger.LogInformation("DxLink: AUTH OK");

            // Step 3: CHANNEL_REQUEST — wait for CHANNEL_OPENED
            Send(new { type = "CHANNEL_REQUEST", channel = 3, service = "FEED", parameters = new { contract = "AUTO" } });
            _logger.LogInformation("DxLink: esperando CHANNEL_OPENED...");

            if (await Task.WhenAny(_channelTcs.Task, Task.Delay(10000)) != _channelTcs.Task)
            {
                _logger.LogError("DxLink: timeout esperando CHANNEL_OPENED — reintentando conexión");
                throw new TimeoutException("DxLink CHANNEL_OPENED timeout");
            }
            _logger.LogInformation("DxLink: CHANNEL OK");

            // Step 4: FEED_SETUP
            Send(new { type = "FEED_SETUP", channel = 3, acceptDataFormat = "FULL", parameters = new { } });

            _handshakeComplete = true;
            _logger.LogInformation("DxLink handshake completo — listo para suscripciones");

            // Flush any subscriptions queued during handshake
            FlushPendingSubscriptions();
        }

        private async Task ReconnectWithDelayAsync()
        {
            _logger.LogInformation("Reintentando conexión DxLink en 5 segundos...");
            try
            {
                await Task.Delay(TimeSpan.FromSeconds(5), _cts!.Token);
                await ConnectAsync();
            }
            catch (OperationCanceledException)
            {
                // Servicio detenido, no reintentar
            }
        }

        private async Task OnReconnectedAsync()
        {
            try
            {
                var authws = await _auth.GetWsOAuthApiAsync();
                await DoHandshakeAsync(authws.Data.Token);

                // Re-suscribir todas las suscripciones activas
                var activeSubs = _subscriptions
                    .Where(kv => kv.Value > 0)
                    .Select(kv => new { type = kv.Key.EventType, symbol = kv.Key.Symbol })
                    .ToList();

                if (activeSubs.Count > 0)
                {
                    Send(new
                    {
                        type = "FEED_SUBSCRIPTION",
                        channel = 3,
                        add = activeSubs
                    });

                    _logger.LogInformation("Re-suscripción de {Count} feeds después de reconexión", activeSubs.Count);
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error durante re-suscripción post-reconexión");
            }
        }

        private void FlushPendingSubscriptions()
        {
            while (_pendingSubscriptions.TryDequeue(out var toAdd))
            {
                Send(new { type = "FEED_SUBSCRIPTION", channel = 3, add = toAdd });
                _logger.LogInformation("FEED_SUBSCRIPTION pendiente enviado ({Count} items)", toAdd.Count);
            }
        }

        #endregion

        #region Suscripciones con reference counting

        public async Task SubscribeAsync(string symbol, string[] eventTypes)
        {
            await EnsureConnectedAsync();

            var toAdd = new List<object>();

            lock (_subLock)
            {
                foreach (var eventType in eventTypes)
                {
                    var key = (symbol, eventType);
                    var currentCount = _subscriptions.GetOrAdd(key, 0);
                    _subscriptions[key] = currentCount + 1;

                    if (currentCount == 0)
                    {
                        toAdd.Add(new { type = eventType, symbol });
                    }
                }
            }

            if (toAdd.Count > 0)
            {
                if (_handshakeComplete)
                {
                    Send(new { type = "FEED_SUBSCRIPTION", channel = 3, add = toAdd });
                    _logger.LogInformation("FEED_SUBSCRIPTION enviado: {Symbol} -> [{EventTypes}]",
                        symbol, string.Join(", ", eventTypes));
                }
                else
                {
                    _pendingSubscriptions.Enqueue(toAdd);
                    _logger.LogInformation("FEED_SUBSCRIPTION encolado (handshake pendiente): {Symbol}", symbol);
                }
            }
        }

        public Task UnsubscribeAsync(string symbol, string[] eventTypes)
        {
            var toRemove = new List<object>();

            lock (_subLock)
            {
                foreach (var eventType in eventTypes)
                {
                    var key = (symbol, eventType);
                    if (!_subscriptions.TryGetValue(key, out var currentCount) || currentCount <= 0)
                        continue;

                    var newCount = currentCount - 1;
                    _subscriptions[key] = newCount;

                    if (newCount == 0)
                    {
                        toRemove.Add(new { type = eventType, symbol });
                        _subscriptions.TryRemove(key, out _);
                    }
                }
            }

            if (toRemove.Count > 0 && _handshakeComplete)
            {
                Send(new
                {
                    type = "FEED_SUBSCRIPTION",
                    channel = 3,
                    remove = toRemove
                });

                _logger.LogInformation("Desuscripción DxLink: {Symbol} -> [{EventTypes}]",
                    symbol, string.Join(", ", eventTypes));
            }

            return Task.CompletedTask;
        }

        public async Task SubscribeBatchAsync(IEnumerable<string> symbols, string[] eventTypes)
        {
            await EnsureConnectedAsync();

            var toAdd = new List<object>();

            lock (_subLock)
            {
                foreach (var symbol in symbols)
                {
                    foreach (var eventType in eventTypes)
                    {
                        var key = (symbol, eventType);
                        var currentCount = _subscriptions.GetOrAdd(key, 0);
                        _subscriptions[key] = currentCount + 1;

                        if (currentCount == 0)
                        {
                            toAdd.Add(new { type = eventType, symbol });
                        }
                    }
                }
            }

            if (toAdd.Count > 0)
            {
                if (_handshakeComplete)
                {
                    Send(new { type = "FEED_SUBSCRIPTION", channel = 3, add = toAdd });
                    _logger.LogInformation("FEED_SUBSCRIPTION batch enviado: {Count} items", toAdd.Count);
                }
                else
                {
                    _pendingSubscriptions.Enqueue(toAdd);
                    _logger.LogInformation("FEED_SUBSCRIPTION batch encolado (handshake pendiente): {Count} items", toAdd.Count);
                }
            }
        }

        public Task UnsubscribeBatchAsync(IEnumerable<string> symbols, string[] eventTypes)
        {
            var toRemove = new List<object>();

            lock (_subLock)
            {
                foreach (var symbol in symbols)
                {
                    foreach (var eventType in eventTypes)
                    {
                        var key = (symbol, eventType);
                        if (!_subscriptions.TryGetValue(key, out var currentCount) || currentCount <= 0)
                            continue;

                        var newCount = currentCount - 1;
                        _subscriptions[key] = newCount;

                        if (newCount == 0)
                        {
                            toRemove.Add(new { type = eventType, symbol });
                            _subscriptions.TryRemove(key, out _);
                        }
                    }
                }
            }

            if (toRemove.Count > 0 && _handshakeComplete)
            {
                Send(new { type = "FEED_SUBSCRIPTION", channel = 3, remove = toRemove });
                _logger.LogInformation("Desuscripción batch DxLink: {Count} items", toRemove.Count);
            }

            return Task.CompletedTask;
        }

        private async Task EnsureConnectedAsync()
        {
            if (!_isConnected || !_handshakeComplete)
            {
                await ConnectAsync();
            }
        }

        #endregion

        #region Procesamiento de mensajes

        private void OnMessageReceived(ResponseMessage message)
        {
            try
            {
                if (string.IsNullOrEmpty(message.Text)) return;

                var json = JObject.Parse(message.Text);
                var type = json["type"]?.ToString();

                switch (type)
                {
                    case "KEEPALIVE":
                        Send(new { type = "KEEPALIVE", channel = 0 });
                        return;

                    case "FEED_DATA":
                        _ = ProcessFeedDataAsync(json);
                        return;

                    case "AUTH_STATE":
                        var state = json["state"]?.ToString();
                        _logger.LogInformation("DxLink AUTH_STATE: {State}", state);
                        if (state == "AUTHORIZED")
                            _authTcs?.TrySetResult(true);
                        return;

                    case "CHANNEL_OPENED":
                        var ch = json["channel"]?.Value<int>() ?? 0;
                        _logger.LogInformation("DxLink CHANNEL_OPENED: channel={Channel}", ch);
                        if (ch == 3)
                            _channelTcs?.TrySetResult(true);
                        return;

                    case "ERROR":
                        _logger.LogError("DxLink ERROR: {Message}", message.Text);
                        return;

                    default:
                        _logger.LogInformation("DxLink msg: {Type}", type);
                        return;
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error procesando mensaje DxLink");
            }
        }

        private async Task ProcessFeedDataAsync(JObject json)
        {
            try
            {
                var dataArray = json["data"] as JArray;
                if (dataArray == null) return;

                foreach (var item in dataArray)
                {
                    var eventType = item["eventType"]?.ToString();
                    var eventSymbol = item["eventSymbol"]?.ToString();

                    if (string.IsNullOrEmpty(eventType) || string.IsNullOrEmpty(eventSymbol))
                        continue;

                    // Fan-out a collectors de snapshot (request/response). Incluye Candle, que no se broadcastea.
                    if (!_collectors.IsEmpty && item is JObject jitem)
                    {
                        foreach (var collector in _collectors.Values)
                            collector.Offer(eventType, eventSymbol, jitem);
                    }

                    // Detectar si el simbolo es una opcion (formato DxFeed: ".SPY260620C530")
                    bool isOption = eventSymbol.StartsWith(".");

                    switch (eventType)
                    {
                        case "Trade":
                            var trade = item.ToObject<TradeEvent>();
                            if (trade != null)
                            {
                                await _broadcaster.BroadcastTradeAsync(eventSymbol, trade);
                                if (isOption)
                                    _flowAggregator.OnOptionTrade(eventSymbol, trade);
                            }
                            break;

                        case "Quote":
                            var quote = item.ToObject<QuoteEvent>();
                            if (quote != null)
                            {
                                await _broadcaster.BroadcastQuoteAsync(eventSymbol, quote);
                                if (isOption)
                                    _flowAggregator.OnOptionQuote(eventSymbol, quote);
                            }
                            break;

                        case "Greeks":
                            var greeks = item.ToObject<GreeksEvent>();
                            if (greeks != null)
                                await _broadcaster.BroadcastGreeksAsync(eventSymbol, greeks);
                            break;
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error procesando FEED_DATA");
            }
        }

        #endregion

        #region Snapshot (request/response sobre la conexión persistente)

        public async Task<IReadOnlyList<JObject>> RequestSnapshotAsync(
            IReadOnlyList<(string Symbol, string EventType, long? FromTime)> subs,
            Func<JObject, bool> isSymbolComplete,
            TimeSpan timeout,
            CancellationToken cancellationToken)
        {
            if (subs == null || subs.Count == 0)
                return Array.Empty<JObject>();

            await EnsureConnectedAsync();

            var interest = subs.Select(s => (s.Symbol, s.EventType));
            var collector = new SnapshotCollector(interest, isSymbolComplete);
            var id = Guid.NewGuid();
            _collectors[id] = collector;

            // Candle: suscripción directa (con fromTime). El Monitor no usa Candle, así que no colisiona.
            // Otros event types (Greeks/Quote/Trade): por el reference-counting, para NO pisar las
            // suscripciones persistentes del Monitor al desuscribir al terminar el snapshot.
            var candleSubs = subs.Where(s => s.EventType == "Candle").ToList();
            var refCountGroups = subs.Where(s => s.EventType != "Candle")
                                     .GroupBy(s => s.EventType)
                                     .ToList();
            try
            {
                foreach (var grp in refCountGroups)
                    await SubscribeBatchAsync(grp.Select(s => s.Symbol), new[] { grp.Key });

                if (candleSubs.Count > 0)
                {
                    var add = candleSubs.Select(s => s.FromTime.HasValue
                        ? (object)new { type = "Candle", symbol = s.Symbol, fromTime = s.FromTime.Value }
                        : new { type = "Candle", symbol = s.Symbol }).ToList();
                    Send(new { type = "FEED_SUBSCRIPTION", channel = 3, add });
                }

                await Task.WhenAny(collector.Done.Task, Task.Delay(timeout, cancellationToken));
                return collector.Items;
            }
            finally
            {
                foreach (var grp in refCountGroups)
                    await UnsubscribeBatchAsync(grp.Select(s => s.Symbol), new[] { grp.Key });

                if (candleSubs.Count > 0)
                {
                    var remove = candleSubs.Select(s => (object)new { type = "Candle", symbol = s.Symbol }).ToList();
                    Send(new { type = "FEED_SUBSCRIPTION", channel = 3, remove });
                }

                _collectors.TryRemove(id, out _);
            }
        }

        /// <summary>
        /// Acumula eventos de un request de snapshot. Acepta items cuyo (eventSymbol, eventType) está
        /// en su set de interés y marca un símbolo como completo cuando <c>isSymbolComplete</c> da true.
        /// </summary>
        private sealed class SnapshotCollector
        {
            private readonly HashSet<(string, string)> _interest;
            private readonly HashSet<(string, string)> _pending;
            private readonly Func<JObject, bool> _isSymbolComplete;
            private readonly List<JObject> _items = new();
            private readonly object _lock = new();

            public TaskCompletionSource<bool> Done { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);

            public SnapshotCollector(IEnumerable<(string Symbol, string EventType)> interest, Func<JObject, bool> isSymbolComplete)
            {
                // Normalizar el símbolo (quitar sufijo de agregación {=...}): dxFeed devuelve los
                // Candle con el sufijo normalizado (ej. se pide "SPY{=1d}" pero llega "SPY{=d}").
                _interest = new HashSet<(string, string)>(interest.Select(i => (Normalize(i.Symbol), i.EventType)));
                _pending = new HashSet<(string, string)>(_interest);
                _isSymbolComplete = isSymbolComplete;
            }

            private static string Normalize(string symbol)
            {
                var idx = symbol.IndexOf("{=", StringComparison.Ordinal);
                return idx >= 0 ? symbol.Substring(0, idx) : symbol;
            }

            public void Offer(string eventType, string eventSymbol, JObject item)
            {
                var key = (Normalize(eventSymbol), eventType);
                if (!_interest.Contains(key)) return;

                lock (_lock)
                {
                    _items.Add(item);
                    if (_pending.Contains(key) && _isSymbolComplete(item))
                    {
                        _pending.Remove(key);
                        if (_pending.Count == 0)
                            Done.TrySetResult(true);
                    }
                }
            }

            public IReadOnlyList<JObject> Items
            {
                get { lock (_lock) return _items.ToList(); }
            }
        }

        #endregion

        #region Helpers

        private void Send(object msg)
        {
            if (_socket is { IsRunning: true })
            {
                var json = JsonConvert.SerializeObject(msg);
                _socket.Send(json);
            }
        }

        #endregion
    }
}

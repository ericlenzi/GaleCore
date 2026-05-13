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
    /// <summary>
    /// IHostedService que mantiene una conexión DXLink persistente.
    /// Multiplexa FEED_SUBSCRIPTION para los símbolos suscriptos por clientes del Hub.
    /// No afecta los endpoints REST existentes que usan el modo one-shot.
    /// </summary>
    public class DxLinkStreamingService : IHostedService, IDxLinkStreamingService, IDisposable
    {
        private readonly ITastytradeOAuth _auth;
        private readonly IMarketDataBroadcaster _broadcaster;
        private readonly ILogger<DxLinkStreamingService> _logger;

        private WebsocketClient? _socket;
        private readonly SemaphoreSlim _connectionLock = new(1, 1);
        private bool _isConnected;
        private bool _handshakeComplete;
        private CancellationTokenSource? _cts;

        // Reference counting: (symbol, eventType) -> cantidad de suscriptores
        private readonly ConcurrentDictionary<(string Symbol, string EventType), int> _subscriptions = new();
        private readonly object _subLock = new();

        public DxLinkStreamingService(
            ITastytradeOAuth auth,
            IMarketDataBroadcaster broadcaster,
            ILogger<DxLinkStreamingService> logger)
        {
            _auth = auth;
            _broadcaster = broadcaster;
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
                    ReconnectTimeout = null // Manejamos reconexión manualmente
                };

                _socket.ReconnectionHappened.Subscribe(info =>
                {
                    _logger.LogInformation("DxLink reconectado: {Type}", info.Type);
                    _ = OnReconnectedAsync();
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

                // Handshake DXLink
                Send(new { type = "SETUP", channel = 0, version = "0.1-DXF-JS/0.3.0", keepaliveTimeout = 60, acceptKeepaliveTimeout = 60 });
                Send(new { type = "AUTH", channel = 0, token });
                Send(new { type = "CHANNEL_REQUEST", channel = 3, service = "FEED", parameters = new { contract = "AUTO" } });
                Send(new { type = "FEED_SETUP", channel = 3, acceptDataFormat = "FULL", parameters = new { } });

                _handshakeComplete = true;
                _logger.LogInformation("DxLink conectado y handshake completo");
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
            // Después de reconectar, re-autenticar y re-suscribir todo
            try
            {
                var authws = await _auth.GetWsOAuthApiAsync();
                Send(new { type = "SETUP", channel = 0, version = "0.1-DXF-JS/0.3.0", keepaliveTimeout = 60, acceptKeepaliveTimeout = 60 });
                Send(new { type = "AUTH", channel = 0, token = authws.Data.Token });
                Send(new { type = "CHANNEL_REQUEST", channel = 3, service = "FEED", parameters = new { contract = "AUTO" } });
                Send(new { type = "FEED_SETUP", channel = 3, acceptDataFormat = "FULL", parameters = new { } });

                _handshakeComplete = true;

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

                    // Solo enviar FEED_SUBSCRIPTION add cuando pasa de 0 a 1
                    if (currentCount == 0)
                    {
                        toAdd.Add(new { type = eventType, symbol });
                    }
                }
            }

            if (toAdd.Count > 0 && _handshakeComplete)
            {
                Send(new
                {
                    type = "FEED_SUBSCRIPTION",
                    channel = 3,
                    add = toAdd
                });

                _logger.LogInformation("Suscripción DxLink: {Symbol} -> [{EventTypes}]",
                    symbol, string.Join(", ", eventTypes));
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

                    // Solo enviar FEED_SUBSCRIPTION remove cuando llega a 0
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

                if (type == "KEEPALIVE")
                {
                    // Responder keepalive para mantener la conexión viva
                    Send(new { type = "KEEPALIVE", channel = 0 });
                    return;
                }

                if (type == "FEED_DATA")
                {
                    _ = ProcessFeedDataAsync(json, message.Text);
                }
                else if (type == "ERROR")
                {
                    _logger.LogError("Error DxLink: {Message}", message.Text);
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error procesando mensaje DxLink");
            }
        }

        private async Task ProcessFeedDataAsync(JObject json, string rawMessage)
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

                    switch (eventType)
                    {
                        case "Trade":
                            var trade = item.ToObject<TradeEvent>();
                            if (trade != null)
                                await _broadcaster.BroadcastTradeAsync(eventSymbol, trade);
                            break;

                        case "Quote":
                            var quote = item.ToObject<QuoteEvent>();
                            if (quote != null)
                                await _broadcaster.BroadcastQuoteAsync(eventSymbol, quote);
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

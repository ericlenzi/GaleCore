using System.Collections.Concurrent;
using DataFeed.Application.Data.Tastytrade.OptionChains;
using DataFeed.Infrastructure.Providers.Tastytrade;
using MediatR;
using Microsoft.AspNetCore.SignalR;

namespace DataFeed.Api.Hubs
{
    /// <summary>
    /// Hub SignalR para streaming de datos de mercado en tiempo real.
    /// Los clientes se suscriben a simbolos y reciben Trade, Quote, Greeks y Flow en tiempo real.
    /// </summary>
    public class MarketDataHub : Hub
    {
        private readonly IDxLinkStreamingService _streaming;
        private readonly IFlowAggregatorService _flowAggregator;
        private readonly IMediator _mediator;
        private readonly ILogger<MarketDataHub> _logger;

        // Tipos de evento soportados para streaming
        private static readonly string[] DefaultEventTypes = ["Trade", "Quote"];
        private static readonly string[] OptionEventTypes = ["Trade", "Quote", "Greeks"];
        private static readonly string[] FlowEventTypes = ["Trade", "Quote"];

        // Tracking: connectionId -> lista de simbolos con flow activo
        // Necesario para cleanup en OnDisconnectedAsync
        private static readonly ConcurrentDictionary<string, HashSet<string>> _flowConnections = new();

        // Tracking: symbol -> lista de DxFeed symbols suscritos (para unsubscribe batch)
        private static readonly ConcurrentDictionary<string, List<string>> _flowDxFeedSymbols = new();

        public MarketDataHub(
            IDxLinkStreamingService streaming,
            IFlowAggregatorService flowAggregator,
            IMediator mediator,
            ILogger<MarketDataHub> logger)
        {
            _streaming = streaming;
            _flowAggregator = flowAggregator;
            _mediator = mediator;
            _logger = logger;
        }

        // ═══════════════════════════════════════════════════════════════════════
        // Suscripciones de precio (existentes)
        // ═══════════════════════════════════════════════════════════════════════

        /// <summary>
        /// Cliente se suscribe a un simbolo. Si includeGreeks=true, tambien recibe Greeks (para opciones).
        /// </summary>
        public async Task Subscribe(string symbol, bool includeGreeks = false)
        {
            var eventTypes = includeGreeks ? OptionEventTypes : DefaultEventTypes;

            // Agregar al grupo del simbolo para recibir broadcasts
            await Groups.AddToGroupAsync(Context.ConnectionId, symbol);

            // Registrar suscripcion en DxLink
            await _streaming.SubscribeAsync(symbol, eventTypes);

            _logger.LogInformation("Cliente {ConnectionId} suscripto a {Symbol} (Greeks: {IncludeGreeks})",
                Context.ConnectionId, symbol, includeGreeks);
        }

        /// <summary>
        /// Cliente se desuscribe de un simbolo.
        /// </summary>
        public async Task Unsubscribe(string symbol, bool includeGreeks = false)
        {
            var eventTypes = includeGreeks ? OptionEventTypes : DefaultEventTypes;

            await Groups.RemoveFromGroupAsync(Context.ConnectionId, symbol);
            await _streaming.UnsubscribeAsync(symbol, eventTypes);

            _logger.LogInformation("Cliente {ConnectionId} desuscripto de {Symbol}",
                Context.ConnectionId, symbol);
        }

        // ═══════════════════════════════════════════════════════════════════════
        // Suscripciones de flow agresivo (nuevas — Fase 6)
        // ═══════════════════════════════════════════════════════════════════════

        /// <summary>
        /// Cliente se suscribe al flow agresivo de opciones para un subyacente.
        /// El servidor suscribe la cadena de opciones de la expiracion target via DxLink,
        /// clasifica trades por agresion, y emite ReceiveFlow cada 30 segundos.
        /// </summary>
        /// <param name="symbol">Ticker subyacente (SPY, QQQ)</param>
        /// <param name="expirationDate">Fecha de expiracion opcional (yyyy-MM-dd). Si null, usa la mas cercana con DTE 20-60.</param>
        /// <param name="flowWindowMinutes">Ventana deslizante en minutos. Default: 60.</param>
        public async Task SubscribeFlow(string symbol, string? expirationDate = null, int? flowWindowMinutes = null)
        {
            symbol = symbol.ToUpperInvariant();
            int window = flowWindowMinutes ?? 60;

            // Si ya esta trackeando este simbolo, solo agregar conexion al grupo
            if (_flowAggregator.IsTracking(symbol))
            {
                await Groups.AddToGroupAsync(Context.ConnectionId, $"flow_{symbol}");
                TrackFlowConnection(Context.ConnectionId, symbol);

                _logger.LogInformation(
                    "SubscribeFlow: {ConnectionId} agregado a flow existente {Symbol}",
                    Context.ConnectionId, symbol);
                return;
            }

            // 1. Obtener cadena de opciones
            OptionChainsResponse optionChains;
            try
            {
                optionChains = await _mediator.Send(new OptionChainsRequest { Symbol = symbol });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "SubscribeFlow: error obteniendo option chains para {Symbol}", symbol);
                throw new HubException($"No se pudo obtener option chains para {symbol}");
            }

            if (optionChains?.expirations == null || optionChains.expirations.Count == 0)
                throw new HubException($"No hay expiraciones disponibles para {symbol}");

            // 2. Encontrar expiracion target
            Expiration? targetExp;
            if (!string.IsNullOrEmpty(expirationDate))
            {
                targetExp = optionChains.expirations
                    .FirstOrDefault(e => e.ExpirationDate == expirationDate);

                if (targetExp == null)
                    throw new HubException($"Expiracion {expirationDate} no encontrada para {symbol}");
            }
            else
            {
                // Default: expiracion mas cercana con DTE entre 20 y 60
                targetExp = optionChains.expirations
                    .Where(e => e.DaysToExpiration >= 20 && e.DaysToExpiration <= 60)
                    .OrderBy(e => e.DaysToExpiration)
                    .FirstOrDefault();

                // Fallback: la primera expiracion con DTE > 0
                targetExp ??= optionChains.expirations
                    .Where(e => e.DaysToExpiration > 0)
                    .OrderBy(e => e.DaysToExpiration)
                    .FirstOrDefault();

                if (targetExp == null)
                    throw new HubException($"No se encontro expiracion valida para {symbol}");
            }

            // 3. Extraer DxFeed symbols de todos los strikes
            var dxFeedSymbols = new List<string>();
            foreach (var strike in targetExp.strikes ?? Enumerable.Empty<Strike>())
            {
                if (!string.IsNullOrEmpty(strike.CallStreamerSymbol))
                    dxFeedSymbols.Add(strike.CallStreamerSymbol);
                if (!string.IsNullOrEmpty(strike.PutStreamerSymbol))
                    dxFeedSymbols.Add(strike.PutStreamerSymbol);
            }

            if (dxFeedSymbols.Count == 0)
                throw new HubException($"No hay streamer symbols disponibles para {symbol} exp={targetExp.ExpirationDate}");

            // 4. Suscribir batch a DxLink (Trade + Quote para cada opcion)
            await _streaming.SubscribeBatchAsync(dxFeedSymbols, FlowEventTypes);

            // 5. Guardar DxFeed symbols para cleanup posterior
            _flowDxFeedSymbols[symbol] = dxFeedSymbols;

            // 6. Iniciar tracking en FlowAggregator
            _flowAggregator.StartTracking(symbol, targetExp.ExpirationDate, window);

            // 7. Agregar conexion al grupo de flow
            await Groups.AddToGroupAsync(Context.ConnectionId, $"flow_{symbol}");
            TrackFlowConnection(Context.ConnectionId, symbol);

            _logger.LogInformation(
                "SubscribeFlow: {Symbol} exp={Expiration} DTE={DTE} window={Window}min symbols={Count}",
                symbol, targetExp.ExpirationDate, targetExp.DaysToExpiration, window, dxFeedSymbols.Count);
        }

        /// <summary>
        /// Cliente se desuscribe del flow agresivo de un subyacente.
        /// Si es el ultimo cliente, se detiene el tracking y se desuscriben los DxLink symbols.
        /// </summary>
        public async Task UnsubscribeFlow(string symbol)
        {
            symbol = symbol.ToUpperInvariant();
            var connectionId = Context.ConnectionId;

            await Groups.RemoveFromGroupAsync(connectionId, $"flow_{symbol}");
            UntrackFlowConnection(connectionId, symbol);

            // Verificar si quedan conexiones para este simbolo
            bool hasOtherConnections = _flowConnections.Values
                .Any(symbols => symbols.Contains(symbol));

            if (!hasOtherConnections)
            {
                // Ultimo cliente: detener tracking y desuscribir DxLink
                _flowAggregator.StopTracking(symbol);

                if (_flowDxFeedSymbols.TryRemove(symbol, out var dxSymbols))
                {
                    await _streaming.UnsubscribeBatchAsync(dxSymbols, FlowEventTypes);
                    _logger.LogInformation(
                        "UnsubscribeFlow: {Symbol} detenido, {Count} DxLink symbols desuscritos",
                        symbol, dxSymbols.Count);
                }
            }
            else
            {
                _logger.LogInformation(
                    "UnsubscribeFlow: {ConnectionId} removido de flow {Symbol} (otros clientes activos)",
                    connectionId, symbol);
            }
        }

        // ═══════════════════════════════════════════════════════════════════════
        // Lifecycle
        // ═══════════════════════════════════════════════════════════════════════

        public override async Task OnDisconnectedAsync(Exception? exception)
        {
            var connectionId = Context.ConnectionId;

            // Cleanup flow subscriptions para esta conexion
            if (_flowConnections.TryRemove(connectionId, out var flowSymbols))
            {
                foreach (var symbol in flowSymbols)
                {
                    // Verificar si quedan otros clientes
                    bool hasOtherConnections = _flowConnections.Values
                        .Any(symbols => symbols.Contains(symbol));

                    if (!hasOtherConnections)
                    {
                        _flowAggregator.StopTracking(symbol);

                        if (_flowDxFeedSymbols.TryRemove(symbol, out var dxSymbols))
                        {
                            await _streaming.UnsubscribeBatchAsync(dxSymbols, FlowEventTypes);
                            _logger.LogInformation(
                                "OnDisconnected: flow {Symbol} detenido (ultimo cliente desconectado)",
                                symbol);
                        }
                    }
                }
            }

            _logger.LogInformation("Cliente {ConnectionId} desconectado", connectionId);
            await base.OnDisconnectedAsync(exception);
        }

        // ═══════════════════════════════════════════════════════════════════════
        // Connection tracking helpers
        // ═══════════════════════════════════════════════════════════════════════

        private static void TrackFlowConnection(string connectionId, string symbol)
        {
            var symbols = _flowConnections.GetOrAdd(connectionId, _ => new HashSet<string>());
            lock (symbols)
            {
                symbols.Add(symbol);
            }
        }

        private static void UntrackFlowConnection(string connectionId, string symbol)
        {
            if (_flowConnections.TryGetValue(connectionId, out var symbols))
            {
                lock (symbols)
                {
                    symbols.Remove(symbol);
                    if (symbols.Count == 0)
                        _flowConnections.TryRemove(connectionId, out _);
                }
            }
        }
    }
}

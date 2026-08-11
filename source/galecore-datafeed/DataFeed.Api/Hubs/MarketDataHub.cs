using System.Collections.Concurrent;
using System.Text.Json.Nodes;
using DataFeed.Application.App.Rpf;
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
    [Microsoft.AspNetCore.Authorization.Authorize(Policy = "HubAccess")]
    public class MarketDataHub : Hub
    {
        private readonly IDxLinkStreamingService _streaming;
        private readonly IFlowAggregatorService _flowAggregator;
        private readonly IMediator _mediator;
        private readonly RpfStateStore _rpfStore;
        private readonly IWebHostEnvironment _env;
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

        private readonly IConfiguration _config;

        public MarketDataHub(
            IDxLinkStreamingService streaming,
            IFlowAggregatorService flowAggregator,
            IMediator mediator,
            RpfStateStore rpfStore,
            IWebHostEnvironment env,
            IConfiguration config,
            ILogger<MarketDataHub> logger)
        {
            _streaming = streaming;
            _flowAggregator = flowAggregator;
            _mediator = mediator;
            _rpfStore = rpfStore;
            _env = env;
            _config = config;
            _logger = logger;
        }

        // ═══════════════════════════════════════════════════════════════════════
        // Autenticación
        // ═══════════════════════════════════════════════════════════════════════

        /// <summary>
        /// Estado de la autenticación del hub, en una sola línea por conexión.
        ///
        /// CONTEXTO (2026-08-11): hasta hoy el hub NO tenía autenticación de ningún tipo — está
        /// exento de ApiKeyMiddleware junto con /swagger y /mcp. Cualquiera que alcance la API puede
        /// conectarse y recibir precios, el estado de RPF y sus sugerencias de trade. NO viajan
        /// datos de cuenta por acá (balances y posiciones van por REST), así que el alcance del
        /// agujero es el feed y la estrategia, no la plata. En local es inocuo; contra Azure no.
        ///
        /// El servidor ya sabe validar el JWT que venga por ?access_token (ver OnMessageReceived en
        /// Program.cs). Lo que falta para poder EXIGIRLO es del lado del tablero: todavía entra con
        /// una Access Key y no tiene login de Supabase, así que no tiene ningún token que mandar.
        /// Exigirlo hoy dejaría el tablero sin datos en vivo.
        ///
        /// Por eso el interruptor: `Supabase:RequireAuthOnHub` arranca en false y se prende el día
        /// que el front tenga login. Mientras tanto cada conexión anónima queda registrada, para que
        /// el agujero sea visible en el log y no una nota en un documento.
        /// </summary>
        public override async Task OnConnectedAsync()
        {
            var user = Context.User;
            var authenticated = user?.Identity?.IsAuthenticated == true;

            // Acá NO se rechaza nada: de eso se encarga la política "HubAccess", que corta en el
            // negotiate antes de que la conexión exista. Esto solo deja registro de quién entró.
            if (authenticated)
            {
                var sub = user!.FindFirst("sub")?.Value
                       ?? user.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
                _logger.LogInformation("Hub: conexión autenticada, usuario {UserId} ({ConnectionId})",
                    sub, Context.ConnectionId);
            }
            else
            {
                _logger.LogInformation(
                    "Hub: conexión ANÓNIMA ({ConnectionId}). El hub no exige autenticación todavía " +
                    "(Supabase:RequireAuthOnHub=false) porque el tablero aún no tiene login de Supabase.",
                    Context.ConnectionId);
            }

            await base.OnConnectedAsync();
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
        // Orquestación RPF (Fase 6a) — tablero + ack del operador
        // ═══════════════════════════════════════════════════════════════════════

        /// <summary>
        /// Cliente (tablero) se suscribe al estado del loop RPF. Al unirse recibe un snapshot del
        /// estado actual de cada símbolo trackeado (ReceiveRpfState) para pintar el cockpit sin esperar
        /// el próximo tick.
        /// </summary>
        public async Task SubscribeRpf()
        {
            await Groups.AddToGroupAsync(Context.ConnectionId, "rpf");

            var now = DateTime.UtcNow;
            foreach (var s in _rpfStore.All())
            {
                await Clients.Caller.SendAsync("ReceiveRpfState", s.Symbol, new RpfStateUpdate
                {
                    Symbol = s.Symbol,
                    State = s.State.ToWire(),
                    CooldownRemainingSec = _rpfStore.CooldownRemainingSec(s.Symbol, now),
                    SuggestionId = s.Suggestion?.Id,
                    Timestamp = s.UpdatedAt,
                });
            }

            _logger.LogInformation("SubscribeRpf: {ConnectionId} unido al grupo rpf", Context.ConnectionId);
        }

        public Task UnsubscribeRpf()
            => Groups.RemoveFromGroupAsync(Context.ConnectionId, "rpf");

        /// <summary>
        /// El operador aprueba la sugerencia vigente. NO ejecuta la orden — confirma la intención y
        /// arranca el cooldown anti-doble-emisión. IN_POSITION lo confirma la cuenta, no este ack.
        /// Idempotente por id: un ack sobre una sugerencia vencida/reemplazada se ignora.
        /// </summary>
        public Task AcceptSuggestion(string suggestionId) => AckAsync(suggestionId, accepted: true);

        /// <summary>El operador descarta la sugerencia vigente; arranca el cooldown.</summary>
        public Task DismissSuggestion(string suggestionId) => AckAsync(suggestionId, accepted: false);

        private async Task AckAsync(string suggestionId, bool accepted)
        {
            int cooldownSeconds = ReadCooldownSeconds();
            var symbol = _rpfStore.Ack(suggestionId, accepted, cooldownSeconds, DateTime.UtcNow);

            if (symbol == null)
            {
                _logger.LogInformation("Ack ignorado (sugerencia {Id} vencida o reemplazada) accepted={Accepted}", suggestionId, accepted);
                return;
            }

            // Feedback inmediato: el símbolo entra en COOLDOWN. El loop lo refina en el próximo tick.
            _rpfStore.SetState(symbol, RpfState.Cooldown);
            var now = DateTime.UtcNow;
            await Clients.Group("rpf").SendAsync("ReceiveRpfState", symbol, new RpfStateUpdate
            {
                Symbol = symbol,
                State = RpfState.Cooldown.ToWire(),
                CooldownRemainingSec = _rpfStore.CooldownRemainingSec(symbol, now),
                Timestamp = now,
            });

            _logger.LogInformation("Ack {Verb}: sugerencia {Id} ({Symbol}) → COOLDOWN {Sec}s",
                accepted ? "ACCEPT" : "DISMISS", suggestionId, symbol, cooldownSeconds);
        }

        private int ReadCooldownSeconds()
        {
            try
            {
                var path = Path.Combine(_env.ContentRootPath, "Files", "Rpf", "galecore_rules_rpf.json");
                var root = JsonNode.Parse(File.ReadAllText(path))!.AsObject();
                return (int?)root["orchestration"]?["cooldown_seconds"] ?? 120;
            }
            catch { return 120; }
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

using DataFeed.Infrastructure.Providers.Tastytrade;
using Microsoft.AspNetCore.SignalR;

namespace DataFeed.Api.Hubs
{
    /// <summary>
    /// Hub SignalR para streaming de datos de mercado en tiempo real.
    /// Los clientes se suscriben a símbolos y reciben Trade, Quote y Greeks en tiempo real.
    /// </summary>
    public class MarketDataHub : Hub
    {
        private readonly IDxLinkStreamingService _streaming;
        private readonly ILogger<MarketDataHub> _logger;

        // Tipos de evento soportados para streaming
        private static readonly string[] DefaultEventTypes = ["Trade", "Quote"];
        private static readonly string[] OptionEventTypes = ["Trade", "Quote", "Greeks"];

        public MarketDataHub(IDxLinkStreamingService streaming, ILogger<MarketDataHub> logger)
        {
            _streaming = streaming;
            _logger = logger;
        }

        /// <summary>
        /// Cliente se suscribe a un símbolo. Si includeGreeks=true, también recibe Greeks (para opciones).
        /// </summary>
        public async Task Subscribe(string symbol, bool includeGreeks = false)
        {
            var eventTypes = includeGreeks ? OptionEventTypes : DefaultEventTypes;

            // Agregar al grupo del símbolo para recibir broadcasts
            await Groups.AddToGroupAsync(Context.ConnectionId, symbol);

            // Registrar suscripción en DxLink
            await _streaming.SubscribeAsync(symbol, eventTypes);

            _logger.LogInformation("Cliente {ConnectionId} suscripto a {Symbol} (Greeks: {IncludeGreeks})",
                Context.ConnectionId, symbol, includeGreeks);
        }

        /// <summary>
        /// Cliente se desuscribe de un símbolo.
        /// </summary>
        public async Task Unsubscribe(string symbol, bool includeGreeks = false)
        {
            var eventTypes = includeGreeks ? OptionEventTypes : DefaultEventTypes;

            await Groups.RemoveFromGroupAsync(Context.ConnectionId, symbol);
            await _streaming.UnsubscribeAsync(symbol, eventTypes);

            _logger.LogInformation("Cliente {ConnectionId} desuscripto de {Symbol}",
                Context.ConnectionId, symbol);
        }

        public override async Task OnDisconnectedAsync(Exception? exception)
        {
            _logger.LogInformation("Cliente {ConnectionId} desconectado", Context.ConnectionId);
            await base.OnDisconnectedAsync(exception);
        }
    }
}

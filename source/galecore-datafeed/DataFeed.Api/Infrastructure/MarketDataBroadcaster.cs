using DataFeed.Api.Hubs;
using DataFeed.Infrastructure.Providers.Tastytrade;
using Microsoft.AspNetCore.SignalR;

namespace DataFeed.Api.Infrastructure
{
    /// <summary>
    /// Implementación de IMarketDataBroadcaster que usa SignalR IHubContext
    /// para enviar datos a los clientes suscriptos por grupo (símbolo).
    /// </summary>
    public class MarketDataBroadcaster : IMarketDataBroadcaster
    {
        private readonly IHubContext<MarketDataHub> _hubContext;

        public MarketDataBroadcaster(IHubContext<MarketDataHub> hubContext)
        {
            _hubContext = hubContext;
        }

        public async Task BroadcastTradeAsync(string symbol, object tradeData)
        {
            await _hubContext.Clients.Group(symbol).SendAsync("ReceiveTrade", symbol, tradeData);
        }

        public async Task BroadcastQuoteAsync(string symbol, object quoteData)
        {
            await _hubContext.Clients.Group(symbol).SendAsync("ReceiveQuote", symbol, quoteData);
        }

        public async Task BroadcastGreeksAsync(string symbol, object greeksData)
        {
            await _hubContext.Clients.Group(symbol).SendAsync("ReceiveGreeks", symbol, greeksData);
        }

        public async Task BroadcastFlowAsync(string symbol, object flowData)
        {
            await _hubContext.Clients.Group($"flow_{symbol}").SendAsync("ReceiveFlow", symbol, flowData);
        }
    }
}

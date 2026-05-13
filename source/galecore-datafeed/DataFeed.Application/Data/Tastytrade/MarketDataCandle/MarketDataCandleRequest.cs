using DataFeed.Infrastructure.Providers.Tastytrade.Models;
using MediatR;

namespace DataFeed.Application.Data.Tastytrade.MarketDataCandle
{
    public class MarketDataCandleRequest : IRequest<MarketDataCandleResponse>
    {
        public string Symbol { get; set; }

        public string Interval { get; set; }

        public DateTime FromTime { get; set; }

        public DateTime? ToTime { get; set; }
    }
}
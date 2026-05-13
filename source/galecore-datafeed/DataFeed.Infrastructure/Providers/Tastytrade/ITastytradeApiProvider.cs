using System.Collections.Generic;
using System.Threading.Tasks;
using DataFeed.Infrastructure.Providers.Tastytrade.Models;

namespace DataFeed.Infrastructure.Providers.Tastytrade
{
    public interface ITastytradeApiProvider
    {
        Task<ByTypeModel?> GetMarketDataByTypeAsync(string symbol, CancellationToken cancellationToken);

        Task<OptionChainsModel?> GetOptionChainsAsync(string symbol, CancellationToken cancellationToken);

        Task<AccountBalancesModel?> GetAccountBalancesAsync(string accountNumber, CancellationToken cancellationToken);

        Task<AccountPositionsModel?> GetAccountPositionsAsync(string accountNumber, CancellationToken cancellationToken);

        Task<MarketMetricsVolatilityModel?> GetMarketMetricsVolatilityAsync(string symbols, CancellationToken cancellationToken);
    }
}

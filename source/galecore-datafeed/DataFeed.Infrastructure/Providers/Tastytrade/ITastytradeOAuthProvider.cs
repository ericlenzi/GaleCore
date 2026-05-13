using System.Collections.Generic;
using System.Threading.Tasks;
using DataFeed.Infrastructure.Providers.Tastytrade.Models;

namespace DataFeed.Infrastructure.Providers.Tastytrade
{
    public interface ITastytradeOAuth
    {
        Task<HttpRequestMessage> CreateOAuthApiRequestAsync(string endpoint);

        //Task<OAuthResponseAPIModel> GetOAuthApiAsync();

        Task<OAuthResponseWSModel> GetWsOAuthApiAsync();
    }
}

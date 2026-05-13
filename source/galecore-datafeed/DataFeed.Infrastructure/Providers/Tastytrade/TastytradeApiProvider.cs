using Microsoft.Extensions.Configuration;
using System.Text.Json;
using DataFeed.Infrastructure.Providers.Tastytrade.Models;
using DataFeed.Infrastructure.Providers;
using System.Net.Http;
using static System.Runtime.InteropServices.JavaScript.JSType;
using System.Net.Http.Headers;
using System.Text.Json.Serialization;
//using Newtonsoft.Json;
using System.Threading;

namespace DataFeed.Infrastructure.Providers.Tastytrade
{
    public class TastytradeApiProvider : ITastytradeApiProvider
    {
        private readonly HttpClient _client;
        private readonly ITastytradeOAuth _auth;
        private readonly IConfiguration _config;
        private readonly HttpRequestHeaders _request;

        public TastytradeApiProvider(IConfiguration config, ITastytradeOAuth auth, IHttpClientFactory client)
        {
            _config = config;
            _client = client.CreateClient();
            _client.BaseAddress = new Uri(_config["Tastytrade:BaseUrl"]);
            _auth = auth;

        }

        public async Task<ByTypeModel?> GetMarketDataByTypeAsync(string symbol, CancellationToken cancellationToken)
        {
            _client.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
            _client.DefaultRequestHeaders.UserAgent.ParseAdd("PostmanRuntime/7.36.0");
            var request = await _auth.CreateOAuthApiRequestAsync($"/market-data/by-type?equity={symbol}");
            var response = await _client.SendAsync(request);
            response.EnsureSuccessStatusCode();

            var content = await response.Content.ReadAsStringAsync();
            //var result = JsonSerializer.Deserialize<ByTypeModel>(content, new JsonSerializerOptions
            //{
            //    PropertyNameCaseInsensitive = true
            //});
            var options = new JsonSerializerOptions
            {
                NumberHandling = JsonNumberHandling.AllowReadingFromString,
                PropertyNameCaseInsensitive = true
            };
            var result = JsonSerializer.Deserialize<ByTypeModel>(content, options);
            return result;
        }

        public async Task<OptionChainsModel?> GetOptionChainsAsync(string symbol, CancellationToken cancellationToken)
        {
            _client.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
            _client.DefaultRequestHeaders.UserAgent.ParseAdd("PostmanRuntime/7.36.0");
            var request = await _auth.CreateOAuthApiRequestAsync($"/option-chains/{symbol}/nested");
            var response = await _client.SendAsync(request);
            response.EnsureSuccessStatusCode();

            var content = await response.Content.ReadAsStringAsync();
            var result = JsonSerializer.Deserialize<OptionChainsModel>(content, new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true
            });

            return result;
        }

        public async Task<AccountBalancesModel?> GetAccountBalancesAsync(string accountNumber, CancellationToken cancellationToken)
        {
            _client.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
            _client.DefaultRequestHeaders.UserAgent.ParseAdd("PostmanRuntime/7.36.0");
            var request = await _auth.CreateOAuthApiRequestAsync($"/accounts/{accountNumber}/balances");
            var response = await _client.SendAsync(request);
            response.EnsureSuccessStatusCode();

            var content = await response.Content.ReadAsStringAsync();
            var options = new JsonSerializerOptions
            {
                NumberHandling = JsonNumberHandling.AllowReadingFromString,
                PropertyNameCaseInsensitive = true
            };
            return JsonSerializer.Deserialize<AccountBalancesModel>(content, options);
        }

        public async Task<AccountPositionsModel?> GetAccountPositionsAsync(string accountNumber, CancellationToken cancellationToken)
        {
            _client.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
            _client.DefaultRequestHeaders.UserAgent.ParseAdd("PostmanRuntime/7.36.0");
            var request = await _auth.CreateOAuthApiRequestAsync($"/accounts/{accountNumber}/positions");
            var response = await _client.SendAsync(request);
            response.EnsureSuccessStatusCode();

            var content = await response.Content.ReadAsStringAsync();
            var options = new JsonSerializerOptions
            {
                NumberHandling = JsonNumberHandling.AllowReadingFromString,
                PropertyNameCaseInsensitive = true
            };
            return JsonSerializer.Deserialize<AccountPositionsModel>(content, options);
        }

        public async Task<MarketMetricsVolatilityModel?> GetMarketMetricsVolatilityAsync(string symbols, CancellationToken cancellationToken)
        {
            _client.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
            _client.DefaultRequestHeaders.UserAgent.ParseAdd("PostmanRuntime/7.36.0");
            var request = await _auth.CreateOAuthApiRequestAsync($"/market-metrics?symbols={Uri.EscapeDataString(symbols)}");
            var response = await _client.SendAsync(request);
            response.EnsureSuccessStatusCode();

            var content = await response.Content.ReadAsStringAsync();
            var options = new JsonSerializerOptions
            {
                NumberHandling = JsonNumberHandling.AllowReadingFromString,
                PropertyNameCaseInsensitive = true
            };
            return JsonSerializer.Deserialize<MarketMetricsVolatilityModel>(content, options);
        }
    }
}
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.Unicode;
using DataFeed.Infrastructure.Providers.Tastytrade.Models;
using Microsoft.Extensions.Configuration;

namespace DataFeed.Infrastructure.Providers.Tastytrade
{
    public class TastytradeOAuth : ITastytradeOAuth
    {
        private readonly HttpClient _client;
        private readonly IConfiguration _config;
        private OAuthResponseAPIModel _authResponseAPI;
        private OAuthResponseWSModel _authResponseWS;
        private readonly SemaphoreSlim _apiTokenLock = new(1, 1);
        private readonly SemaphoreSlim _wsTokenLock = new(1, 1);

        //private ClientWebSocket? _webSocket;
        //private const string DxfEndpoint = "wss://tasty-openapi-ws.dxfeed.com/realtime";    //"wss://streamer.dxfeed.com/smart";

        public TastytradeOAuth(IConfiguration config, IHttpClientFactory client)
        {
            _config = config;
            _client = client.CreateClient();
            _client.BaseAddress = new Uri(_config["Tastytrade:BaseUrl"]);
            // Headers fijos — se configuran una sola vez para evitar duplicados en cada refresh
            _client.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
            _client.DefaultRequestHeaders.UserAgent.ParseAdd("PostmanRuntime/7.36.0");
        }

        public async Task<HttpRequestMessage> CreateOAuthApiRequestAsync(string endpoint)
        {
            var token = await GetOAuthApiAsync();
            var method = new HttpMethod("GET");
            var request = new HttpRequestMessage(method, endpoint);
            //request.Headers.Authorization = new AuthenticationHeaderValue(token.AccessToken);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token.AccessToken);

            return request;
        }

        private async Task<OAuthResponseAPIModel> GetOAuthApiAsync()
        {
            // Verificación rápida sin lock (happy path)
            if (_authResponseAPI != null && _authResponseAPI.ExpiresAt > DateTime.UtcNow.AddMinutes(1))
                return _authResponseAPI;

            await _apiTokenLock.WaitAsync();
            try
            {
                // Re-verificar dentro del lock — otro thread pudo haber refrescado mientras esperábamos
                if (_authResponseAPI != null && _authResponseAPI.ExpiresAt > DateTime.UtcNow.AddMinutes(1))
                    return _authResponseAPI;

                var baseUrl = _config["Tastytrade:BaseUrl"].ToString();
                var request = new OAuthRequestLoginAPIModel
                {
                    GrantType = _config["Tastytrade:OAuth:grant_type"].ToString(),
                    RefreshToken = _config["Tastytrade:OAuth:refresh_token"].ToString(),
                    ClientSecret = _config["Tastytrade:OAuth:client_secret"].ToString()
                };
                var json = JsonSerializer.Serialize(request);
                var content = new StringContent(json, Encoding.UTF8, "application/json");
                var response = await _client.PostAsync(baseUrl + "/oauth/token", content);
                var responseText = await response.Content.ReadAsStringAsync();
                if (!response.IsSuccessStatusCode)
                    throw new Exception($"No se pudo autenticar con Tastytrade. Status: {response.StatusCode}");

                var auth = JsonSerializer.Deserialize<OAuthResponseAPIModel>(responseText)!;
                // Usar UtcNow consistentemente para evitar errores de zona horaria
                auth.ExpiresAt = DateTime.UtcNow.AddSeconds(auth.ExpiresIn - 60);
                _authResponseAPI = auth;
                return _authResponseAPI;
            }
            finally
            {
                _apiTokenLock.Release();
            }
        }

        public async Task<OAuthResponseWSModel> GetWsOAuthApiAsync()
        {
            // Verificación rápida sin lock (happy path)
            if (_authResponseWS != null && _authResponseWS.Data.ExpiresAt > DateTime.UtcNow.AddMinutes(1))
                return _authResponseWS;

            await _wsTokenLock.WaitAsync();
            try
            {
                // Re-verificar dentro del lock
                if (_authResponseWS != null && _authResponseWS.Data.ExpiresAt > DateTime.UtcNow.AddMinutes(1))
                    return _authResponseWS;

                var request = await this.CreateOAuthApiRequestAsync($"/api-quote-tokens");
                var response = await _client.SendAsync(request);
                response.EnsureSuccessStatusCode();

                var content = await response.Content.ReadAsStringAsync();
                var auth = JsonSerializer.Deserialize<OAuthResponseWSModel>(content)!;
                _authResponseWS = auth;
                return _authResponseWS;
            }
            finally
            {
                _wsTokenLock.Release();
            }
        }
    }
}
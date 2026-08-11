using System.Collections.Concurrent;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using DataFeed.Infrastructure.Providers.Tastytrade.Models;
using Microsoft.Extensions.Configuration;

namespace DataFeed.Infrastructure.Providers.Tastytrade
{
    /// <summary>
    /// Canjea refresh token por access token contra Tastytrade, cacheando POR CREDENCIAL.
    ///
    /// Hasta 2026-08-11 esta clase tenía UN solo juego de tokens, porque la plataforma tenía un solo
    /// operador. Con multi-usuario eso deja de servir: cada uno tiene su cuenta, y un access token
    /// no sirve para la cuenta de otro. El cache pasó a estar indexado por
    /// <see cref="TastytradeCredential.Id"/> — mezclar dos credenciales en una misma entrada le
    /// mostraría a un usuario las posiciones del otro, que es el peor error posible acá.
    ///
    /// El client_secret sigue viniendo de configuración: es de la APLICACIÓN OAuth registrada, no
    /// del usuario (se regenera desde el perfil de Tastytrade sin que cambie el client_id).
    ///
    /// De qué credencial se trata lo decide <see cref="ITastytradeCredentialStore"/>: sistema para
    /// mercado, usuario para cuenta. Ver docs/GaleCore-arquitectura-datos.md §5.4.
    /// </summary>
    public class TastytradeOAuth : ITastytradeOAuth
    {
        private readonly HttpClient _client;
        private readonly IConfiguration _config;
        private readonly ITastytradeCredentialStore _credentials;

        // Un access token por credencial. El lock también es por credencial: si fuera uno solo, el
        // refresh de un usuario bloquearía a todos los demás.
        private readonly ConcurrentDictionary<string, OAuthResponseAPIModel> _apiTokens = new();
        private readonly ConcurrentDictionary<string, SemaphoreSlim> _apiLocks = new();

        private OAuthResponseWSModel? _wsToken;
        private readonly SemaphoreSlim _wsTokenLock = new(1, 1);

        public TastytradeOAuth(IConfiguration config, IHttpClientFactory client, ITastytradeCredentialStore credentials)
        {
            _config = config;
            _credentials = credentials;
            _client = client.CreateClient();
            _client.BaseAddress = new Uri(_config["Tastytrade:BaseUrl"]!);
            // Headers fijos — se configuran una sola vez para evitar duplicados en cada refresh
            _client.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
            _client.DefaultRequestHeaders.UserAgent.ParseAdd("PostmanRuntime/7.36.0");
        }

        public async Task<HttpRequestMessage> CreateOAuthApiRequestAsync(string endpoint)
            => await CreateOAuthApiRequestAsync(endpoint, await _credentials.GetSystemAsync());

        public async Task<HttpRequestMessage> CreateOAuthApiRequestAsync(string endpoint, TastytradeCredential credential)
        {
            var token = await GetOAuthApiAsync(credential);
            var request = new HttpRequestMessage(HttpMethod.Get, endpoint);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token.AccessToken);
            return request;
        }

        private async Task<OAuthResponseAPIModel> GetOAuthApiAsync(TastytradeCredential credential)
        {
            // Verificación rápida sin lock (happy path)
            if (_apiTokens.TryGetValue(credential.Id, out var cached) &&
                cached.ExpiresAt > DateTime.UtcNow.AddMinutes(1))
                return cached;

            var gate = _apiLocks.GetOrAdd(credential.Id, _ => new SemaphoreSlim(1, 1));
            await gate.WaitAsync();
            try
            {
                // Re-verificar dentro del lock — otro thread pudo haber refrescado mientras esperábamos
                if (_apiTokens.TryGetValue(credential.Id, out cached) &&
                    cached.ExpiresAt > DateTime.UtcNow.AddMinutes(1))
                    return cached;

                var baseUrl = _config["Tastytrade:BaseUrl"]!;
                var request = new OAuthRequestLoginAPIModel
                {
                    GrantType = _config["Tastytrade:OAuth:grant_type"]!,
                    RefreshToken = credential.RefreshToken,
                    ClientSecret = _config["Tastytrade:OAuth:client_secret"]!,
                };

                var json = JsonSerializer.Serialize(request);
                var content = new StringContent(json, Encoding.UTF8, "application/json");
                var response = await _client.PostAsync(baseUrl + "/oauth/token", content);
                var responseText = await response.Content.ReadAsStringAsync();
                if (!response.IsSuccessStatusCode)
                    throw new Exception($"No se pudo autenticar con Tastytrade (credencial {credential.Source}). Status: {response.StatusCode}");

                var auth = JsonSerializer.Deserialize<OAuthResponseAPIModel>(responseText)!;
                // Usar UtcNow consistentemente para evitar errores de zona horaria
                auth.ExpiresAt = DateTime.UtcNow.AddSeconds(auth.ExpiresIn - 60);
                _apiTokens[credential.Id] = auth;
                return auth;
            }
            finally
            {
                gate.Release();
            }
        }

        public async Task<OAuthResponseWSModel> GetWsOAuthApiAsync()
        {
            if (_wsToken != null && _wsToken.Data.ExpiresAt > DateTime.UtcNow.AddMinutes(1))
                return _wsToken;

            await _wsTokenLock.WaitAsync();
            try
            {
                if (_wsToken != null && _wsToken.Data.ExpiresAt > DateTime.UtcNow.AddMinutes(1))
                    return _wsToken;

                // Siempre con la credencial de sistema: hay UNA conexión DXLink para toda la
                // plataforma y el feed de mercado es compartido.
                var system = await _credentials.GetSystemAsync();
                var request = await CreateOAuthApiRequestAsync("/api-quote-tokens", system);
                var response = await _client.SendAsync(request);
                response.EnsureSuccessStatusCode();

                var content = await response.Content.ReadAsStringAsync();
                _wsToken = JsonSerializer.Deserialize<OAuthResponseWSModel>(content)!;
                return _wsToken;
            }
            finally
            {
                _wsTokenLock.Release();
            }
        }
    }
}

using System;
using System.Net;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using DataFeed.Infrastructure.Providers.Tastytrade;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace DataFeed.Tests;

/// <summary>
/// Congela la frontera de TastytradeOAuth.Rechazo: cuando /oauth/token falla, DE QUIEN es el
/// problema.
///
/// Importa porque las dos ramas terminan en respuestas HTTP opuestas y ninguna las prueba desde
/// afuera: 400/401 sale como 409 con `broker_credential_invalid` ("re-vincula tu cuenta") y
/// cualquier otro status sale como 500 ("la plataforma tiene un problema"). Meter un 503 en la
/// primera rama le pediria al operador que rehaga una credencial que esta perfecta, mientras
/// Tastytrade se recupera solo; sacar el 400 de ahi devuelve el bug de 2026-09-01, en el que un
/// refresh token emitido por otra aplicacion OAuth se veia como una caida del servidor.
/// </summary>
public class TastytradeOAuthRejectionTests
{
    /// <summary>Contesta siempre lo mismo, sin salir a la red.</summary>
    private sealed class RespuestaFija : HttpMessageHandler
    {
        private readonly HttpStatusCode _status;
        private readonly string _body;

        public RespuestaFija(HttpStatusCode status, string body)
        {
            _status = status;
            _body = body;
        }

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
            => Task.FromResult(new HttpResponseMessage(_status) { Content = new StringContent(_body) });
    }

    private sealed class FabricaDeUnCliente : IHttpClientFactory
    {
        private readonly HttpMessageHandler _handler;
        public FabricaDeUnCliente(HttpMessageHandler handler) => _handler = handler;
        public HttpClient CreateClient(string name) => new(_handler);
    }

    /// <summary>Nunca se la consulta: el test siempre pasa la credencial a mano.</summary>
    private sealed class SinCredenciales : ITastytradeCredentialStore
    {
        public Task<TastytradeCredential> GetSystemAsync(CancellationToken ct = default)
            => throw new InvalidOperationException("El test no deberia pedir la credencial de sistema.");

        public Task<TastytradeCredential?> GetForUserAsync(Guid userId, CancellationToken ct = default)
            => Task.FromResult<TastytradeCredential?>(null);
    }

    private static TastytradeOAuth Auth(HttpStatusCode status, string body)
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Tastytrade:BaseUrl"] = "https://api.tastyworks.com",
                ["Tastytrade:OAuth:grant_type"] = "refresh_token",
                ["Tastytrade:OAuth:client_secret"] = "no-importa",
            })
            .Build();

        return new TastytradeOAuth(
            config,
            new FabricaDeUnCliente(new RespuestaFija(status, body)),
            new SinCredenciales(),
            NullLogger<TastytradeOAuth>.Instance);
    }

    private static readonly TastytradeCredential DeUnUsuario =
        new(Id: "una-fila", RefreshToken: "el-token", AccountNumber: "5WZ00000", Source: "db");

    private static readonly TastytradeCredential DeSistema =
        new(Id: "la-fila-is-system", RefreshToken: "el-token", AccountNumber: "5WZ99999",
            Source: "db", IsSystem: true);

    /// <summary>
    /// El cuerpo real que devolvio Tastytrade el 2026-09-01 ante un refresh token emitido por otra
    /// aplicacion OAuth. Es EL caso que motivo todo esto, asi que va literal.
    /// </summary>
    [Fact]
    public async Task ClientSecretMismatch_EsCredencialInvalida()
    {
        var auth = Auth(HttpStatusCode.BadRequest,
            """{"error_code":"invalid_grant","error_description":"Client secret mismatch"}""");

        var ex = await Assert.ThrowsAsync<BrokerCredentialInvalidException>(
            () => auth.CreateOAuthApiRequestAsync("/accounts/5WZ00000/balances", DeUnUsuario));

        // Lo que contesto el proveedor queda a mano para el log, y NO en el mensaje que ve el
        // operador: el mensaje le dice que rehaga el token, no que lea el vocabulario de Tastytrade.
        Assert.Contains("Client secret mismatch", ex.Detail);
        Assert.DoesNotContain("Client secret mismatch", ex.Message);
    }

    [Fact]
    public async Task TokenRevocado_TambienEsCredencialInvalida()
    {
        var auth = Auth(HttpStatusCode.Unauthorized, """{"error_code":"invalid_grant"}""");

        await Assert.ThrowsAsync<BrokerCredentialInvalidException>(
            () => auth.CreateOAuthApiRequestAsync("/x", DeUnUsuario));
    }

    /// <summary>
    /// El MISMO 400 que para un usuario es un 409, para la credencial de sistema es un 500.
    ///
    /// No es una sutileza: la de sistema es la que usan los endpoints de MERCADO, que consulta
    /// cualquiera —incluso alguien sin cuenta vinculada— y no tiene dueño a quien mandar a
    /// re-vincular. Como `DataFeedControllerBase` mapea esta excepcion a 409 para TODOS los
    /// endpoints, dejarla escapar acá haria que un precio que no se puede leer le pidiera al
    /// operador que arreglara una credencial que no es suya.
    /// </summary>
    [Fact]
    public async Task CredencialDeSistemaRechazada_NoEsCosaDelOperador()
    {
        var auth = Auth(HttpStatusCode.BadRequest,
            """{"error_code":"invalid_grant","error_description":"Client secret mismatch"}""");

        var ex = await Assert.ThrowsAnyAsync<Exception>(
            () => auth.CreateOAuthApiRequestAsync("/x", DeSistema));

        Assert.IsNotType<BrokerCredentialInvalidException>(ex);
    }

    /// <summary>
    /// Tastytrade caido NO es una credencial invalida. Si esto se rompe, el tablero le va a pedir a
    /// todo el mundo que re-vincule su cuenta cada vez que el proveedor tenga un mal rato.
    /// </summary>
    [Theory]
    [InlineData(HttpStatusCode.ServiceUnavailable)]
    [InlineData(HttpStatusCode.InternalServerError)]
    [InlineData(HttpStatusCode.TooManyRequests)]
    public async Task ProveedorCaido_NoEsCredencialInvalida(HttpStatusCode status)
    {
        var auth = Auth(status, "upstream se cayo");

        var ex = await Assert.ThrowsAnyAsync<Exception>(
            () => auth.CreateOAuthApiRequestAsync("/x", DeUnUsuario));

        Assert.IsNotType<BrokerCredentialInvalidException>(ex);
    }
}

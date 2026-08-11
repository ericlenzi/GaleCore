using AutoMapper;
using DataFeed.Infrastructure.Providers.Tastytrade;
using MediatR;
using Microsoft.Extensions.Configuration;

namespace DataFeed.Application.Data.Tastytrade.AccountBalances
{
    public class AccountBalancesHandler : IRequestHandler<AccountBalancesRequest, AccountBalancesResponse>
    {
        private readonly IConfiguration _config;
        private readonly IMapper _mapper;
        private readonly ITastytradeOAuth _auth;
        private readonly IHttpClientFactory _client;
        private readonly ICurrentUser _currentUser;
        private readonly ITastytradeCredentialStore _credentials;

        public AccountBalancesHandler(IConfiguration config, IMapper mapper, ITastytradeOAuth auth,
            IHttpClientFactory client, ICurrentUser currentUser, ITastytradeCredentialStore credentials)
        {
            _config = config;
            _mapper = mapper;
            _auth = auth;
            _client = client;
            _currentUser = currentUser;
            _credentials = credentials;
        }

        public async Task<AccountBalancesResponse> Handle(AccountBalancesRequest request, CancellationToken cancellationToken)
        {
            try
            {
                // Balances son datos DE CUENTA: si hay usuario autenticado, van con SU credencial y
                // SU número de cuenta. Sin usuario (el tablero de hoy, que entra con API key y sin
                // token) se cae al comportamiento previo. Aditivo a propósito: nada se rompe.
                var credential = await ResolveCredentialAsync(cancellationToken);

                var accountNumber = request.AccountNumber
                    ?? credential?.AccountNumber
                    ?? _config["Tastytrade:AccountNumber"]
                    ?? throw new Exception("Número de cuenta requerido. Enviarlo en el request o configurar Tastytrade:AccountNumber.");

                var provider = new TastytradeApiProvider(_config, _auth, _client);
                var balances = await provider.GetAccountBalancesAsync(accountNumber, cancellationToken, credential);

                if (balances?.Data == null)
                    throw new Exception($"No se encontraron balances para la cuenta: {accountNumber}");

                return _mapper.Map<AccountBalancesResponse>(balances.Data);
            }
            catch (Exception ex)
            {
                throw new Exception($"AccountBalancesHandler Error: {ex.Message}");
            }
        }

        /// <summary>
        /// null = usar la credencial de sistema (el camino de compatibilidad). Se devuelve null solo
        /// cuando NO hay usuario autenticado. Si hay usuario pero no tiene cuenta vinculada se
        /// LANZA: devolverle silenciosamente los datos de la cuenta de sistema sería mostrarle
        /// posiciones ajenas, que es peor que un error.
        /// </summary>
        private async Task<TastytradeCredential?> ResolveCredentialAsync(CancellationToken ct)
        {
            var userId = _currentUser.UserId;
            if (userId == null) return null;

            return await _credentials.GetForUserAsync(userId.Value, ct)
                ?? throw new Exception(
                    "El usuario autenticado no tiene una cuenta de bróker vinculada.");
        }
    }
}

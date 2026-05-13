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

        public AccountBalancesHandler(IConfiguration config, IMapper mapper, ITastytradeOAuth auth, IHttpClientFactory client)
        {
            _config = config;
            _mapper = mapper;
            _auth = auth;
            _client = client;
        }

        public async Task<AccountBalancesResponse> Handle(AccountBalancesRequest request, CancellationToken cancellationToken)
        {
            try
            {
                // Usar número de cuenta de config si no se envía en el request
                var accountNumber = request.AccountNumber
                    ?? _config["Tastytrade:AccountNumber"]
                    ?? throw new Exception("Número de cuenta requerido. Enviarlo en el request o configurar Tastytrade:AccountNumber.");

                var provider = new TastytradeApiProvider(_config, _auth, _client);
                var balances = await provider.GetAccountBalancesAsync(accountNumber, cancellationToken);

                if (balances?.Data == null)
                    throw new Exception($"No se encontraron balances para la cuenta: {accountNumber}");

                return _mapper.Map<AccountBalancesResponse>(balances.Data);
            }
            catch (Exception ex)
            {
                throw new Exception($"AccountBalancesHandler Error: {ex.Message}");
            }
        }
    }
}

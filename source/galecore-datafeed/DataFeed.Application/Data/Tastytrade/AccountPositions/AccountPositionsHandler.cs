using AutoMapper;
using DataFeed.Infrastructure.Providers.Tastytrade;
using MediatR;
using Microsoft.Extensions.Configuration;

namespace DataFeed.Application.Data.Tastytrade.AccountPositions
{
    public class AccountPositionsHandler : IRequestHandler<AccountPositionsRequest, AccountPositionsResponse>
    {
        private readonly IConfiguration _config;
        private readonly IMapper _mapper;
        private readonly ITastytradeOAuth _auth;
        private readonly IHttpClientFactory _client;

        public AccountPositionsHandler(IConfiguration config, IMapper mapper, ITastytradeOAuth auth, IHttpClientFactory client)
        {
            _config = config;
            _mapper = mapper;
            _auth = auth;
            _client = client;
        }

        public async Task<AccountPositionsResponse> Handle(AccountPositionsRequest request, CancellationToken cancellationToken)
        {
            try
            {
                var accountNumber = request.AccountNumber
                    ?? _config["Tastytrade:AccountNumber"]
                    ?? throw new Exception("Número de cuenta requerido. Enviarlo en el request o configurar Tastytrade:AccountNumber.");

                var provider = new TastytradeApiProvider(_config, _auth, _client);
                var positions = await provider.GetAccountPositionsAsync(accountNumber, cancellationToken);

                if (positions?.Data == null)
                    throw new Exception($"No se encontraron posiciones para la cuenta: {accountNumber}");

                return _mapper.Map<AccountPositionsResponse>(positions.Data);
            }
            catch (Exception ex)
            {
                throw new Exception($"AccountPositionsHandler Error: {ex.Message}");
            }
        }
    }
}

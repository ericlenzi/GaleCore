using AutoMapper;
using MediatR;
using System;
using System.ComponentModel.DataAnnotations;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using System.Collections.Generic;
using Newtonsoft.Json;
using System.IO;
using System.Globalization;
using Microsoft.Extensions.Configuration;
using AutoMapper.Internal;
using DataFeed.Infrastructure.Providers.Fred;
using DataFeed.Infrastructure.Providers.Tastytrade.Models;
using DataFeed.Infrastructure.Providers.Tastytrade;
using DataFeed.Application.Functions;
using DataFeed.Application.Shared;

namespace DataFeed.Application.Data.Tastytrade.MarketDataGreeks
{
    public class MarketDataGreeksHandler : IRequestHandler<MarketDataGreeksRequest, MarketDataGreeksResponse>
    {
        private IConfiguration _config;
        private readonly IMapper _mapper;
        private readonly ITastytradeOAuth _auth;
        private readonly IHttpClientFactory _client;

        public MarketDataGreeksHandler(IConfiguration config, IMapper mapper, ITastytradeOAuth auth, IHttpClientFactory client)
        {
            _config = config;
            _mapper = mapper;
            _auth = auth;
            _client = client;
        }

        public async Task<MarketDataGreeksResponse> Handle(MarketDataGreeksRequest request, CancellationToken cancellationToken)
        {
            try
            {
                var response = new MarketDataGreeksResponse();

                var isOption = TastytradeHelper.IsOptionSymbol(request.Symbol);
                if (!isOption)
                    throw new Exception("Symbol incorrect. Option symbol must be 6+6+1+8=21 chars");

                var symbol = isOption ? TastytradeHelper.GetOptionSymbolFromTicker(request.Symbol) : request.Symbol;
                var tastyWSProvider = new TastytradeSocketProvider(_config, _auth, _client);

                var prices = await tastyWSProvider.GetGreeksAsync(symbol, cancellationToken);
                if (prices == null)
                    return new MarketDataGreeksResponse();

                response = _mapper.Map<MarketDataGreeksResponse>(prices);
                var obsDict = new Dictionary<DateTime, decimal>();
                var shyDict = new Dictionary<DateTime, decimal>();
                return response;
            }
            catch (Exception ex)
            {
                throw new Exception($"MarketDataGreeksHandler Error: {ex.Message}");
            }
        }
    }
}
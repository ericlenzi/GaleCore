using MediatR;
using Microsoft.AspNetCore.Mvc;
using System.Threading.Tasks;
using DataFeed.Application.Data.Tastytrade.MarketDataByType;
using DataFeed.Application.Data.Tastytrade.OptionChains;
using DataFeed.Application.Data.Tastytrade.MarketDataCandle;
using DataFeed.Application.Data.Tastytrade.MarketDataTrade;
using DataFeed.Application.Data.Tastytrade.MarketDataQuote;
using DataFeed.Application.Data.Tastytrade.MarketDataGreeks;
using DataFeed.Application.Data.Tastytrade.MarketDataTradeQuoteGreeks;
using DataFeed.Application.Data.Tastytrade.AccountBalances;
using DataFeed.Application.Data.Tastytrade.AccountPositions;
using DataFeed.Application.Data.Tastytrade.MarketMetricsVolatility;

namespace DataFeed.Controllers
{
    [ApiController]
    [Route("[controller]")]
    public class DataController : DataFeedControllerBase
    {
        public DataController(IMediator mediator)
            : base(mediator)
        {
        }

        #region Api

        [Tags("Data.Api")]
        [HttpGet("Tastytrade/MarketData/ByType")]
        public async Task<IActionResult> MarketDataByTypeAsync([FromQuery] MarketDataByTypeRequest request) => await Handle(request);

        [Tags("Data.Api")]
        [HttpGet("Tastytrade/OptionChains")]
        public async Task<IActionResult> OptionChainsAsync([FromQuery] OptionChainsRequest request) => await Handle(request);

        [Tags("Data.Api")]
        [HttpGet("Tastytrade/Market-metrics/VolatilityData")]
        public async Task<IActionResult> MarketMetricsVolatilityAsync([FromQuery] MarketMetricsVolatilityRequest request) => await Handle(request);

        #endregion

        #region Stream

        [Tags("Data.Stream")]
        [HttpGet("Tastytrade/MarketData/Candle")]
        public async Task<IActionResult> MarketDataCandleAsync([FromQuery] MarketDataCandleRequest request) => await Handle(request);

        [Tags("Data.Stream")]
        [HttpGet("Tastytrade/MarketData/Trade")]
        public async Task<IActionResult> MarketDataTradeAsync([FromQuery] MarketDataTradeRequest request) => await Handle(request);

        [Tags("Data.Stream")]
        [HttpGet("Tastytrade/MarketData/Quote")]
        public async Task<IActionResult> MarketDataQuoteAsync([FromQuery] MarketDataQuoteRequest request) => await Handle(request);

        [Tags("Data.Stream")]
        [HttpGet("Tastytrade/MarketData/Greeks")]
        public async Task<IActionResult> MarketDataGreeksAsync([FromQuery] MarketDataGreeksRequest request) => await Handle(request);

        [Tags("Data.Stream")]
        [HttpGet("Tastytrade/MarketData/TradeQuoteGreeks")]
        public async Task<IActionResult> MarketDataTradeQuoteGreeksAsync([FromQuery] MarketDataTradeQuoteGreeksRequest request) => await Handle(request);

        #endregion

        #region Account

        [Tags("Data.Account")]
        [HttpGet("Tastytrade/Account/Balances")]
        public async Task<IActionResult> AccountBalancesAsync([FromQuery] AccountBalancesRequest request) => await Handle(request);

        [Tags("Data.Account")]
        [HttpGet("Tastytrade/Account/Positions")]
        public async Task<IActionResult> AccountPositionsAsync([FromQuery] AccountPositionsRequest request) => await Handle(request);

        #endregion
    }
}

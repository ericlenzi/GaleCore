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
using DataFeed.Application.Data.Tastytrade.SymbolSearch;

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

        /// <summary>
        /// Busca símbolos por texto (símbolo o parte de él) contra el catálogo de Tastytrade.
        /// `InstrumentTypes` acota el resultado ("Equity,Index"); vacío devuelve todo lo que matchea.
        ///
        /// Vive en Data.Api y no bajo el prefijo de una estrategia: buscar un símbolo es un dato de
        /// mercado de la misma clase que ByType u OptionChains. Hoy lo consume el buscador de la
        /// pestaña GEX, pero no tiene nada de GEX adentro.
        /// </summary>
        [Tags("Data.Api")]
        [HttpGet("Tastytrade/Symbols/Search")]
        public async Task<IActionResult> SymbolSearchAsync([FromQuery] SymbolSearchRequest request) => await Handle(request);

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

        // 409 = el operador todavía no vinculó su cuenta de bróker (`broker_account_not_linked`).
        // Es el estado normal de alguien recién dado de alta, no una falla: el tablero lo distingue
        // por el `code` para decirle que vincule su cuenta.
        [Tags("Data.Account")]
        [HttpGet("Tastytrade/Account/Balances")]
        [ProducesResponseType(StatusCodes.Status409Conflict)]
        public async Task<IActionResult> AccountBalancesAsync([FromQuery] AccountBalancesRequest request) => await Handle(request);

        [Tags("Data.Account")]
        [HttpGet("Tastytrade/Account/Positions")]
        [ProducesResponseType(StatusCodes.Status409Conflict)]
        public async Task<IActionResult> AccountPositionsAsync([FromQuery] AccountPositionsRequest request) => await Handle(request);

        #endregion
    }
}

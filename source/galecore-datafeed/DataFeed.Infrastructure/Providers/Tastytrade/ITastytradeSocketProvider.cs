using System.Collections.Generic;
using System.Text.Json;
using System.Threading.Tasks;
using DataFeed.Infrastructure.Providers.Tastytrade.Models;

namespace DataFeed.Infrastructure.Providers.Tastytrade
{
    public interface ITastytradeSocketProvider
    {
        Task<CandleModel> GetCandleAsync(string symbol, string interval, DateTime fromTime, DateTime? toTime, CancellationToken cancellationToken);

        Task<TradeModel> GetTradeAsync(string symbol, CancellationToken cancellationToken);

        Task<TradeQuoteGreeksModel> GetTradeQuoteGreeksAsync(string symbol, bool includeGreeks, CancellationToken cancellationToken);

        /// <summary>
        /// Suscribe a Candle (intervalo diario, último día) para múltiples símbolos en UNA sola conexión WebSocket.
        /// Devuelve OI, IV y Close de cada opción + el spot del subyacente.
        /// </summary>
        Task<MultiCandleModel> GetMultiCandleAsync(string underlyingSymbol, string[] optionStreamerSymbols, CancellationToken cancellationToken);
    }
}

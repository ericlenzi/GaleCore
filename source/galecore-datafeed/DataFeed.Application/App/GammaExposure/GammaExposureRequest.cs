using MediatR;

namespace DataFeed.Application.App.GammaExposure
{
    public class GammaExposureRequest : IRequest<GammaExposureResponse>
    {
        /// <summary>
        /// Símbolo del subyacente (ej: AAPL, MSFT, SPY)
        /// </summary>
        public string Symbol { get; set; }

        /// <summary>
        /// Máximo DTE para filtrar expiraciones (default: 60)
        /// </summary>
        public int MaxDTE { get; set; } = 60;
    }
}

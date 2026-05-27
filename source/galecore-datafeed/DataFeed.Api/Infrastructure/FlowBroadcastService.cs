using DataFeed.Infrastructure.Providers.Tastytrade;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace DataFeed.Api.Infrastructure
{
    /// <summary>
    /// Servicio hosted que cada 30 segundos emite ReceiveFlow a los clientes suscritos
    /// via SignalR para cada simbolo con flow tracking activo.
    /// </summary>
    public class FlowBroadcastService : BackgroundService
    {
        private readonly IFlowAggregatorService _flowAggregator;
        private readonly IMarketDataBroadcaster _broadcaster;
        private readonly ILogger<FlowBroadcastService> _logger;

        private const int BroadcastIntervalMs = 30_000; // 30 segundos

        public FlowBroadcastService(
            IFlowAggregatorService flowAggregator,
            IMarketDataBroadcaster broadcaster,
            ILogger<FlowBroadcastService> logger)
        {
            _flowAggregator = flowAggregator;
            _broadcaster = broadcaster;
            _logger = logger;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            _logger.LogInformation("FlowBroadcastService iniciado — intervalo {Interval}s", BroadcastIntervalMs / 1000);

            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    await Task.Delay(BroadcastIntervalMs, stoppingToken);
                    await BroadcastAllFlowSnapshotsAsync();
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
                {
                    // Servicio detenido, salir limpiamente
                    break;
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Error en FlowBroadcastService tick");
                }
            }

            _logger.LogInformation("FlowBroadcastService detenido");
        }

        private async Task BroadcastAllFlowSnapshotsAsync()
        {
            var trackedSymbols = _flowAggregator.GetTrackedSymbols();
            if (trackedSymbols.Count == 0) return;

            foreach (var symbol in trackedSymbols)
            {
                try
                {
                    var snapshot = _flowAggregator.GetSnapshot(symbol);
                    if (snapshot == null) continue;

                    await _broadcaster.BroadcastFlowAsync(symbol, snapshot);

                    _logger.LogDebug(
                        "ReceiveFlow emitido: {Symbol} signal={Signal} netDelta={NetDelta} bull=${Bull:N0} bear=${Bear:N0} trades={Trades}",
                        symbol, snapshot.Signal, snapshot.NetDeltaFlow,
                        snapshot.Bullish.PremiumUsd, snapshot.Bearish.PremiumUsd,
                        snapshot.Bullish.TradeCount + snapshot.Bearish.TradeCount);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Error emitiendo ReceiveFlow para {Symbol}", symbol);
                }
            }
        }
    }
}

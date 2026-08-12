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
        private readonly PlatformServiceSwitch _switch;
        private readonly ILogger<FlowBroadcastService> _logger;

        private const int BroadcastIntervalMs = 30_000; // 30 segundos

        // Id declarado en services[] de galecore_rules_core.json.
        private const string ServiceId = "flow";

        private bool _inertLogged;

        public FlowBroadcastService(
            IFlowAggregatorService flowAggregator,
            IMarketDataBroadcaster broadcaster,
            PlatformServiceSwitch @switch,
            ILogger<FlowBroadcastService> logger)
        {
            _flowAggregator = flowAggregator;
            _broadcaster = broadcaster;
            _switch = @switch;
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

                    // Se relee en cada tick, como el switch de las estrategias. Ojo con lo que este
                    // switch NO apaga: la suscripcion a DXLink la abre SubscribeFlow en el hub, y
                    // eso sigue vivo aunque el broadcast este en OFF. Hoy da igual porque ninguna
                    // pantalla llama a SubscribeFlow; el dia que alguna lo haga, el switch tiene que
                    // cortar tambien ahi.
                    if (!_switch.IsEnabled(ServiceId))
                    {
                        if (!_inertLogged)
                        {
                            _logger.LogInformation("FlowBroadcastService INERTE: switch en OFF — no se emite ReceiveFlow.");
                            _inertLogged = true;
                        }
                        continue;
                    }

                    _inertLogged = false;
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

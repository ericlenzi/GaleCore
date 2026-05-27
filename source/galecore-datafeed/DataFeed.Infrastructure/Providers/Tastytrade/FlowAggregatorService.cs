using System.Collections.Concurrent;
using System.Globalization;
using DataFeed.Infrastructure.Providers.Tastytrade.Models;
using Microsoft.Extensions.Logging;

namespace DataFeed.Infrastructure.Providers.Tastytrade
{
    /// <summary>
    /// Singleton que acumula flow agresivo de opciones en memoria.
    /// Recibe Trade + Quote via DxLinkStreamingService, clasifica por agresion,
    /// y expone snapshots para el endpoint REST y el hub SignalR.
    /// </summary>
    public class FlowAggregatorService : IFlowAggregatorService
    {
        private readonly ConcurrentDictionary<string, SymbolFlowState> _states = new();
        private readonly ConcurrentDictionary<string, QuoteEvent> _lastQuotes = new();
        private readonly ILogger<FlowAggregatorService> _logger;

        // Configuracion — valores por defecto del JSON (aggressive_flow)
        private const double LargePremiumThreshold = 25_000; // USD minimo por trade
        private const double NetDeltaFlowThreshold = 0.2;    // umbral para clasificar signal
        private const int MaxRecentTrades = 20;              // trades recientes en snapshot

        public FlowAggregatorService(ILogger<FlowAggregatorService> logger)
        {
            _logger = logger;
        }

        // ═══════════════════════════════════════════════════════════════════════
        // Tracking lifecycle
        // ═══════════════════════════════════════════════════════════════════════

        public void StartTracking(string symbol, string expiration, int windowMinutes = 60)
        {
            var key = symbol.ToUpperInvariant();
            _states[key] = new SymbolFlowState
            {
                Symbol = key,
                Expiration = expiration,
                WindowMinutes = windowMinutes,
                StartedAt = DateTime.UtcNow
            };
            _logger.LogInformation(
                "Flow tracking iniciado: {Symbol} exp={Expiration} window={Minutes}min",
                key, expiration, windowMinutes);
        }

        public void StopTracking(string symbol)
        {
            var key = symbol.ToUpperInvariant();
            if (_states.TryRemove(key, out _))
            {
                _logger.LogInformation("Flow tracking detenido: {Symbol}", key);
            }
        }

        public bool IsTracking(string symbol)
            => _states.ContainsKey(symbol.ToUpperInvariant());

        public IReadOnlyCollection<string> GetTrackedSymbols()
            => _states.Keys.ToList().AsReadOnly();

        // ═══════════════════════════════════════════════════════════════════════
        // Event consumers — llamados por DxLinkStreamingService
        // ═══════════════════════════════════════════════════════════════════════

        public void OnOptionQuote(string dxFeedSymbol, QuoteEvent quote)
        {
            // Cachear ultimo quote para clasificar agresion del proximo trade
            _lastQuotes[dxFeedSymbol] = quote;
        }

        public void OnOptionTrade(string dxFeedSymbol, TradeEvent trade)
        {
            // 1. Parsear simbolo DxFeed para extraer subyacente y metadata
            var parsed = ParseDxFeedOptionSymbol(dxFeedSymbol);
            if (parsed == null) return;

            var (underlying, expDate, callPut, strike) = parsed.Value;

            // 2. Verificar que estamos trackeando este subyacente
            if (!_states.TryGetValue(underlying, out var state)) return;

            // 3. Solo procesar trades de la expiracion trackeada
            if (expDate != state.Expiration) return;

            // 4. Clasificar agresion usando ultimo quote
            if (!_lastQuotes.TryGetValue(dxFeedSymbol, out var lastQuote)) return;
            if (lastQuote.AskPrice <= 0 || lastQuote.BidPrice <= 0) return;

            string aggression;
            if (trade.Price >= lastQuote.AskPrice)
                aggression = "ask_side";   // compra agresiva
            else if (trade.Price <= lastQuote.BidPrice)
                aggression = "bid_side";   // venta agresiva
            else
                return; // trade a mid — no es agresivo, ignorar

            // 5. Filtro de premium minimo
            double premium = trade.Size * trade.Price * 100;
            if (premium < LargePremiumThreshold) return;

            // 6. Clasificar como bullish o bearish
            // Bullish: compra call (ask_side call) o venta put (bid_side put)
            // Bearish: compra put (ask_side put) o venta call (bid_side call)
            bool isBullish = (callPut == "call" && aggression == "ask_side")
                          || (callPut == "put" && aggression == "bid_side");

            var classified = new ClassifiedTrade
            {
                Timestamp = trade.TimeStamp,
                DxFeedSymbol = dxFeedSymbol,
                CallPut = callPut,
                Strike = strike,
                TradePrice = trade.Price,
                Size = trade.Size,
                PremiumUsd = premium,
                Aggression = aggression,
                IsBullish = isBullish
            };

            lock (state.Lock)
            {
                state.Trades.Add(classified);
            }

            _logger.LogDebug(
                "Flow trade clasificado: {Symbol} {CallPut} {Strike} {Aggression} premium=${Premium:N0} -> {Side}",
                underlying, callPut, strike, aggression, premium, isBullish ? "BULLISH" : "BEARISH");
        }

        // ═══════════════════════════════════════════════════════════════════════
        // Snapshot
        // ═══════════════════════════════════════════════════════════════════════

        public FlowSnapshot? GetSnapshot(string symbol)
        {
            var key = symbol.ToUpperInvariant();
            if (!_states.TryGetValue(key, out var state)) return null;

            var cutoff = DateTime.UtcNow.AddMinutes(-state.WindowMinutes);
            List<ClassifiedTrade> recentTrades;

            lock (state.Lock)
            {
                // Prune trades fuera de la ventana
                state.Trades.RemoveAll(t => t.Timestamp < cutoff);
                recentTrades = state.Trades
                    .OrderByDescending(t => t.Timestamp)
                    .ToList();
            }

            var bullishTrades = recentTrades.Where(t => t.IsBullish).ToList();
            var bearishTrades = recentTrades.Where(t => !t.IsBullish).ToList();

            double bullishPremium = bullishTrades.Sum(t => t.PremiumUsd);
            double bearishPremium = bearishTrades.Sum(t => t.PremiumUsd);
            double totalPremium = bullishPremium + bearishPremium;

            // netDeltaFlow = (bull - bear) / total — rango [-1, +1]
            double netDeltaFlow = totalPremium > 0
                ? (bullishPremium - bearishPremium) / totalPremium
                : 0;

            string signal = netDeltaFlow > NetDeltaFlowThreshold ? "bullish"
                          : netDeltaFlow < -NetDeltaFlowThreshold ? "bearish"
                          : "neutral";

            return new FlowSnapshot
            {
                Symbol = key,
                Expiration = state.Expiration,
                WindowMinutes = state.WindowMinutes,
                Timestamp = DateTime.UtcNow,
                Bullish = BuildFlowSide(bullishTrades),
                Bearish = BuildFlowSide(bearishTrades),
                NetDeltaFlow = Math.Round(netDeltaFlow, 4),
                Signal = signal,
                RecentTrades = recentTrades
                    .Take(MaxRecentTrades)
                    .Select(t => new FlowTrade
                    {
                        Timestamp = t.Timestamp,
                        OptionSymbol = t.DxFeedSymbol,
                        CallPut = t.CallPut,
                        Strike = t.Strike,
                        TradePrice = t.TradePrice,
                        Size = t.Size,
                        PremiumUsd = Math.Round(t.PremiumUsd, 2),
                        Aggression = t.Aggression
                    })
                    .ToList()
            };
        }

        // ═══════════════════════════════════════════════════════════════════════
        // Helpers
        // ═══════════════════════════════════════════════════════════════════════

        private static FlowSide BuildFlowSide(List<ClassifiedTrade> trades)
        {
            if (trades.Count == 0)
                return new FlowSide();

            double totalPremium = trades.Sum(t => t.PremiumUsd);

            // Strike+tipo dominante por premium acumulado
            var dominant = trades
                .GroupBy(t => (t.Strike, t.CallPut))
                .OrderByDescending(g => g.Sum(t => t.PremiumUsd))
                .FirstOrDefault();

            return new FlowSide
            {
                PremiumUsd = Math.Round(totalPremium, 2),
                TradeCount = trades.Count,
                AvgTradeSize = Math.Round(trades.Average(t => t.Size), 0),
                DominantStrike = dominant?.Key.Strike,
                DominantType = dominant?.Key.CallPut
            };
        }

        /// <summary>
        /// Parsea un simbolo DxFeed de opcion como ".SPY260620C530".
        /// Retorna (underlying, expiration "yyyy-MM-dd", callPut "call"/"put", strike).
        /// Retorna null si no es un simbolo de opcion valido.
        /// </summary>
        internal static (string underlying, string expiration, string callPut, double strike)?
            ParseDxFeedOptionSymbol(string dxFeedSymbol)
        {
            if (string.IsNullOrEmpty(dxFeedSymbol) || dxFeedSymbol[0] != '.')
                return null;

            var raw = dxFeedSymbol.Substring(1); // quitar '.' inicial

            // Formato: {SYMBOL}{yyMMdd}{C|P}{strike}
            // Buscar C o P que este precedido por 6 digitos (fecha)
            for (int i = raw.Length - 1; i >= 7; i--)
            {
                if (raw[i] != 'C' && raw[i] != 'P') continue;

                // Verificar 6 digitos antes del C/P
                if (i < 6) continue;
                var datePart = raw.Substring(i - 6, 6);
                if (!datePart.All(char.IsDigit)) continue;

                var symbolPart = raw.Substring(0, i - 6);
                if (string.IsNullOrEmpty(symbolPart)) continue;

                var strikePart = raw.Substring(i + 1);
                if (string.IsNullOrEmpty(strikePart)) continue;
                if (!double.TryParse(strikePart, NumberStyles.Any, CultureInfo.InvariantCulture, out double strike))
                    continue;

                // Parsear fecha
                if (!DateTime.TryParseExact(datePart, "yyMMdd",
                    CultureInfo.InvariantCulture,
                    DateTimeStyles.None, out DateTime expDate))
                    continue;

                string callPut = raw[i] == 'C' ? "call" : "put";
                string expiration = expDate.ToString("yyyy-MM-dd");

                return (symbolPart.ToUpperInvariant(), expiration, callPut, strike);
            }

            return null;
        }

        // ═══════════════════════════════════════════════════════════════════════
        // Tipos internos
        // ═══════════════════════════════════════════════════════════════════════

        private class SymbolFlowState
        {
            public string Symbol { get; set; } = "";
            public string Expiration { get; set; } = "";
            public int WindowMinutes { get; set; }
            public DateTime StartedAt { get; set; }
            public List<ClassifiedTrade> Trades { get; set; } = new();
            public object Lock { get; } = new();
        }

        private class ClassifiedTrade
        {
            public DateTime Timestamp { get; set; }
            public string DxFeedSymbol { get; set; } = "";
            public string CallPut { get; set; } = "";
            public double Strike { get; set; }
            public double TradePrice { get; set; }
            public double Size { get; set; }
            public double PremiumUsd { get; set; }
            public string Aggression { get; set; } = "";
            public bool IsBullish { get; set; }
        }
    }
}

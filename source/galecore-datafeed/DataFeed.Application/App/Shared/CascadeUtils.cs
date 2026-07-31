using System.Text.Json.Nodes;
using DataFeed.Application.App.GammaExposure;
using DataFeed.Application.App.ValidationLayer;
using DataFeed.Application.Data.Tastytrade.MarketDataCandle;
using DataFeed.Application.Data.Tastytrade.MarketDataQuote;

namespace DataFeed.Application.App.Shared
{
    /// <summary>
    /// Primitivos de cálculo compartidos entre motores de decisión (RPF, ValidationLayer, PositionBuilder).
    /// Funciones puras sobre datos de mercado y nodos JSON de reglas — sin I/O ni estado.
    /// Copia íntegra de los estáticos de ValidationLayerHandler; coexisten para no romper la estrategia
    /// original mientras RPF se desacopla.
    /// </summary>
    public static class CascadeUtils
    {
        // ═══════════════════════════════════════════════════════════════════════
        // JSON helpers
        // ═══════════════════════════════════════════════════════════════════════

        internal static JsonNode? FindCheck(JsonArray? checks, string checkId)
        {
            if (checks == null) return null;
            return checks.FirstOrDefault(c => c?["id"]?.GetValue<string>() == checkId);
        }

        internal static JsonNode? GetPositionBuilderLayer(JsonObject rules, int layerId)
        {
            var layers = rules["position_builder"]?["layers"]?.AsArray();
            if (layers == null) return null;
            return layers.FirstOrDefault(l => l?["id"]?.GetValue<int>() == layerId);
        }

        internal static double? GetCheckThresholdValue(JsonArray? checks, string checkId)
        {
            var check = FindCheck(checks, checkId);
            return check?["threshold"]?["value"]?.GetValue<double>();
        }

        // ═══════════════════════════════════════════════════════════════════════
        // Multi-factor computations
        // ═══════════════════════════════════════════════════════════════════════

        internal static double ComputePriceZScore(List<CandleData> candles, double ivAtm)
        {
            if (candles.Count < 6 || ivAtm <= 0)
                return 0;

            double closeToday = candles[^1].Close;
            double close5dAgo = candles[^6].Close;

            if (close5dAgo <= 0 || closeToday <= 0)
                return 0;

            double ret5d = Math.Log(closeToday / close5dAgo);
            double dailySigma = ivAtm / Math.Sqrt(252);

            return dailySigma > 0 ? ret5d / dailySigma : 0;
        }

        internal static string ComputeGexSkew(double callGex, double putGex)
        {
            double denominator = callGex + Math.Abs(putGex);
            if (denominator == 0) return "symmetric";
            double skew = callGex / denominator;
            return skew > 0.6 ? "call_dominant" : skew < 0.4 ? "put_dominant" : "symmetric";
        }

        internal static (double? ema20, double? ema50, string signal) ComputeTrend(List<CandleData> candles)
        {
            if (candles.Count < 50)
                return (null, null, "unavailable");

            double ema20 = ComputeEMA(candles, 20);
            double ema50 = ComputeEMA(candles, 50);

            if (ema50 <= 0)
                return (ema20, ema50, "unavailable");

            double diff = Math.Abs(ema20 - ema50) / ema50;

            string signal;
            if (diff < 0.002)
                signal = "neutral";
            else if (ema20 > ema50)
                signal = "up";
            else
                signal = "down";

            return (ema20, ema50, signal);
        }

        internal static double ComputeEMA(List<CandleData> candles, int period)
        {
            if (candles.Count < period)
                return 0;

            double sma = candles.Take(period).Average(c => c.Close);
            double k = 2.0 / (period + 1);
            double ema = sma;

            for (int i = period; i < candles.Count; i++)
            {
                ema = candles[i].Close * k + ema * (1 - k);
            }

            return ema;
        }

        internal static (double? rv10d, double? rv30d, string signal) ComputeRealizedVol(List<CandleData> candles)
        {
            if (candles.Count < 31)
                return (null, null, "unavailable");

            var logReturns = new List<double>();
            for (int i = 1; i < candles.Count; i++)
            {
                if (candles[i - 1].Close > 0 && candles[i].Close > 0)
                    logReturns.Add(Math.Log(candles[i].Close / candles[i - 1].Close));
            }

            if (logReturns.Count < 30)
                return (null, null, "unavailable");

            double rv10d = ComputeAnnualizedVol(logReturns, 10);
            double rv30d = ComputeAnnualizedVol(logReturns, 30);

            string signal = rv10d > rv30d ? "high" : "low";

            return (rv10d, rv30d, signal);
        }

        internal static double ComputeAnnualizedVol(List<double> logReturns, int window)
        {
            if (logReturns.Count < window)
                return 0;

            var recent = logReturns.Skip(logReturns.Count - window).Take(window).ToList();
            double mean = recent.Average();
            double variance = recent.Sum(r => (r - mean) * (r - mean)) / (window - 1);
            double stddev = Math.Sqrt(variance);

            return stddev * Math.Sqrt(252) * 100;
        }

        // ═══════════════════════════════════════════════════════════════════════
        // Structure resolution
        // ═══════════════════════════════════════════════════════════════════════

        internal static (string structure, int? ruleId, string? ruleName, string? ruleLabel) ResolveStructure(
            JsonNode? structureConfig, double priceZScore, string gexSkew, string trendSignal,
            double neutralZ, double extremeZ)
        {
            bool enabled = structureConfig?["enabled"]?.GetValue<bool>() ?? true;
            if (!enabled)
            {
                string forced = structureConfig?["forced_structure_while_disabled"]?.GetValue<string>()
                    ?? "put_credit_spread";
                return (forced, null, "forced_pcs_only", "PCS-only (motor multi_factor desactivado)");
            }

            return EvaluateStructureRules(structureConfig, priceZScore, gexSkew, trendSignal, neutralZ, extremeZ);
        }

        internal static (string structure, int? ruleId, string? ruleName, string? ruleLabel) EvaluateStructureRules(
            JsonNode? structureConfig, double priceZScore, string gexSkew, string trendSignal,
            double neutralZ, double extremeZ)
        {
            var rulesArray = structureConfig?["rules"]?.AsArray();
            if (rulesArray == null)
                return ("iron_condor", null, null, null);

            foreach (var rule in rulesArray)
            {
                if (rule == null) continue;

                var conditions = rule["conditions"];
                string? output = rule["output"]?.GetValue<string>();
                int? id = rule["id"]?.GetValue<int>();
                string? name = rule["name"]?.GetValue<string>();
                string? label = rule["label"]?.GetValue<string>();

                if (conditions is JsonValue condValue && condValue.GetValue<string>() == "fallthrough")
                    return (output ?? "no_trade", id, name, label);

                if (conditions is not JsonObject condObj)
                    continue;

                bool allConditionsMet = true;

                foreach (var cond in condObj)
                {
                    bool condMet = EvaluateCondition(cond.Key, cond.Value?.GetValue<string>(),
                        priceZScore, gexSkew, trendSignal, neutralZ, extremeZ);

                    if (!condMet)
                    {
                        allConditionsMet = false;
                        break;
                    }
                }

                if (allConditionsMet)
                    return (output ?? "iron_condor", id, name, label);
            }

            return ("no_trade", 6, "no_trade_fallthrough", "Sin señal — ninguna condición satisfecha");
        }

        internal static bool EvaluateCondition(string conditionKey, string? conditionValue,
            double priceZScore, string gexSkew, string trendSignal,
            double neutralZ, double extremeZ)
        {
            return conditionKey switch
            {
                "price_zscore_abs" => Math.Abs(priceZScore) < neutralZ,
                "price_zscore" when conditionValue?.Contains(">") == true => priceZScore > extremeZ,
                "price_zscore" when conditionValue?.Contains("<") == true => priceZScore < -extremeZ,
                "gex_skew" => gexSkew == conditionValue,
                "trend" => trendSignal == conditionValue,
                "flow" => true,
                _ => true
            };
        }

        // ═══════════════════════════════════════════════════════════════════════
        // Strike helpers
        // ═══════════════════════════════════════════════════════════════════════

        internal static double SnapToNearestStrike(List<GammaExposureStrike> strikes, double target)
        {
            if (strikes == null || strikes.Count == 0)
                return target;

            var nearest = strikes.OrderBy(s => Math.Abs(s.Strike - target)).FirstOrDefault();
            return nearest?.Strike ?? target;
        }

        // ═══════════════════════════════════════════════════════════════════════
        // Microstructure checks
        // ═══════════════════════════════════════════════════════════════════════

        internal static BidAskChecks BuildBidAskChecks(
            Dictionary<string, QuoteEvent?> quotes, StrikeEngineResult strikeEngine, double maxPct)
        {
            return new BidAskChecks
            {
                ShortPut = strikeEngine.ShortPutStrike.HasValue
                    ? BuildSingleBidAskCheck(quotes.GetValueOrDefault("shortPut"), maxPct) : null,
                ShortCall = strikeEngine.ShortCallStrike.HasValue
                    ? BuildSingleBidAskCheck(quotes.GetValueOrDefault("shortCall"), maxPct) : null,
                LongPut = strikeEngine.LongPutStrike.HasValue
                    ? BuildSingleBidAskCheck(quotes.GetValueOrDefault("longPut"), maxPct) : null,
                LongCall = strikeEngine.LongCallStrike.HasValue
                    ? BuildSingleBidAskCheck(quotes.GetValueOrDefault("longCall"), maxPct) : null
            };
        }

        internal static BidAskLegCheck BuildSingleBidAskCheck(QuoteEvent? quote, double maxPct)
        {
            if (quote == null || quote.MidPrice <= 0)
                return new BidAskLegCheck { Passed = false, SpreadPct = null, MaxAllowed = maxPct };

            double spreadPct = (quote.AskPrice - quote.BidPrice) / quote.MidPrice;
            return new BidAskLegCheck
            {
                Passed = spreadPct <= maxPct,
                SpreadPct = Math.Round(spreadPct, 4),
                MaxAllowed = maxPct
            };
        }

        internal static CreditMinimumCheck BuildCreditCheck(
            Dictionary<string, QuoteEvent?> quotes, StrikeEngineResult strikeEngine, double minRequired)
        {
            double totalCredit = 0;
            bool hasValidQuotes = true;

            if (strikeEngine.ShortPutStrike.HasValue && strikeEngine.LongPutStrike.HasValue)
            {
                var shortQuote = quotes.GetValueOrDefault("shortPut");
                var longQuote = quotes.GetValueOrDefault("longPut");

                if (shortQuote == null || shortQuote.MidPrice <= 0
                    || longQuote == null || longQuote.MidPrice <= 0)
                {
                    hasValidQuotes = false;
                }
                else
                {
                    totalCredit += shortQuote.MidPrice - longQuote.MidPrice;
                }
            }

            if (strikeEngine.ShortCallStrike.HasValue && strikeEngine.LongCallStrike.HasValue)
            {
                var shortQuote = quotes.GetValueOrDefault("shortCall");
                var longQuote = quotes.GetValueOrDefault("longCall");

                if (shortQuote == null || shortQuote.MidPrice <= 0
                    || longQuote == null || longQuote.MidPrice <= 0)
                {
                    hasValidQuotes = false;
                }
                else
                {
                    totalCredit += shortQuote.MidPrice - longQuote.MidPrice;
                }
            }

            return new CreditMinimumCheck
            {
                Passed = hasValidQuotes && totalCredit >= minRequired,
                MidCredit = Math.Round(totalCredit, 2),
                MinRequired = minRequired
            };
        }

        // ═══════════════════════════════════════════════════════════════════════
        // Regime classification
        // ═══════════════════════════════════════════════════════════════════════

        public static string ClassifyRegime(JsonNode? regimeClassification, double? vix)
        {
            if (vix is not > 0) return "normal";
            var ranges = regimeClassification?["ranges"]?.AsArray();
            if (ranges != null)
            {
                foreach (var r in ranges)
                {
                    double min = r?["min"]?.GetValue<double>() ?? double.MinValue;
                    double max = r?["max"]?.GetValue<double>() ?? double.MaxValue;
                    if (vix.Value >= min && vix.Value < max)
                        return r?["value"]?.GetValue<string>() ?? "normal";
                }
            }
            return "normal";
        }

        // ═══════════════════════════════════════════════════════════════════════
        // OCC symbol builder
        // ═══════════════════════════════════════════════════════════════════════

        internal static string BuildOccSymbol(string underlying, string expiration, double strike, char optionType)
        {
            string symbolPart = underlying.PadRight(6);
            var dt = DateTime.Parse(expiration);
            string datePart = dt.ToString("yyMMdd");
            long strikeInt = (long)(strike * 1000);
            string strikePart = strikeInt.ToString("D8");

            return symbolPart + datePart + optionType + strikePart;
        }
    }
}

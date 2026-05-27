using MediatR;
using System.Text.Json.Nodes;
using DataFeed.Application.App.GammaExposure;
using DataFeed.Application.App.ImpliedVolatility;
using DataFeed.Application.App.IVRank;
using DataFeed.Application.App.ValidationLayer;
using DataFeed.Application.Data.Tastytrade.AccountBalances;
using DataFeed.Application.Data.Tastytrade.AccountPositions;
using DataFeed.Application.Data.Tastytrade.MarketDataCandle;
using DataFeed.Application.Data.Tastytrade.MarketDataQuote;
using DataFeed.Infrastructure.Providers.Tastytrade;
using VLH = DataFeed.Application.App.ValidationLayer.ValidationLayerHandler;

namespace DataFeed.Application.App.PositionBuilder
{
    /// <summary>
    /// Handler para GET /App/GaleCore/PositionBuilder.
    /// Ejecuta Layers 2-4 del position_builder con structureInputs detallados.
    /// Prerrequisito: macro_regime debe haber sido chequeado por el caller.
    /// </summary>
    public class PositionBuilderHandler : IRequestHandler<PositionBuilderRequest, PositionBuilderResponse>
    {
        private readonly IMediator _mediator;
        private readonly IFlowAggregatorService _flowAggregator;

        public PositionBuilderHandler(IMediator mediator, IFlowAggregatorService flowAggregator)
        {
            _mediator = mediator;
            _flowAggregator = flowAggregator;
        }

        public async Task<PositionBuilderResponse> Handle(PositionBuilderRequest request, CancellationToken cancellationToken)
        {
            var rules = JsonNode.Parse(request.RulesJson!)!.AsObject();
            var symbol = request.Symbol.ToUpperInvariant();

            // Fetch data in parallel (mismos que ValidationLayer)
            var gexTask = _mediator.Send(new GammaExposureRequest { Symbol = symbol, MaxDTE = 60 }, cancellationToken);
            var ivrTask = _mediator.Send(new IVRankRequest { Symbol = symbol }, cancellationToken);
            var ivTask = _mediator.Send(new ImpliedVolatilityRequest { Symbol = symbol }, cancellationToken);
            var candleTask = _mediator.Send(new MarketDataCandleRequest
            {
                Symbol = symbol,
                Interval = "1d",
                FromTime = DateTime.UtcNow.AddDays(-120)
            }, cancellationToken);

            await Task.WhenAll(gexTask, ivrTask, ivTask, candleTask);

            var gex = gexTask.Result;
            var ivr = ivrTask.Result;
            var iv = ivTask.Result;
            var candleResponse = candleTask.Result;
            var candles = candleResponse?.data?
                .Where(c => c.Close > 0)
                .OrderBy(c => c.Time)
                .ToList() ?? new List<CandleData>();

            double spot = gex.Spot;

            // === COMPUTE MULTI-FACTOR INPUTS ===
            var layer2Node = VLH.GetPositionBuilderLayer(rules, 2);
            var config = layer2Node?["config"];
            var structureConfig = config?["structure_selection"];
            var spreadConfig = config?["spread_width"];

            double ivAtm = (iv.IV30_30d ?? 0) / 100.0;
            double expectedMove = ivAtm > 0 ? spot * ivAtm * Math.Sqrt(gex.DTE / 365.0) : 0;

            double neutralZ = structureConfig?["thresholds"]?["neutral_z"]?.GetValue<double>() ?? 1.0;
            double extremeZ = structureConfig?["thresholds"]?["extreme_z"]?.GetValue<double>() ?? 1.5;

            double priceZScore = VLH.ComputePriceZScore(candles, ivAtm);
            string gexSkew = VLH.ComputeGexSkew(gex.CallGEX, gex.PutGEX);
            var (ema20, ema50, trendSignal) = VLH.ComputeTrend(candles);
            var (rv10d, rv30d, realizedVolSignal) = VLH.ComputeRealizedVol(candles);

            // Compute ret5d for structureInputs detail
            double ret5d = 0;
            if (candles.Count >= 6 && candles[^6].Close > 0)
                ret5d = Math.Log(candles[^1].Close / candles[^6].Close);

            // === STRUCTURE SELECTION ===
            var (selectedStructure, ruleId, ruleName, ruleLabel) = VLH.EvaluateStructureRules(
                structureConfig, priceZScore, gexSkew, trendSignal, neutralZ, extremeZ);

            // === BUILD STRUCTURE INPUTS ===
            double gexSkewRaw = (gex.CallGEX + Math.Abs(gex.PutGEX)) > 0
                ? gex.CallGEX / (gex.CallGEX + Math.Abs(gex.PutGEX)) : 0.5;
            var structureInputs = new StructureInputs
            {
                PriceZScore = new PriceZScoreInput
                {
                    Value = Math.Round(priceZScore, 4),
                    Ret5d = Math.Round(ret5d, 6),
                    IvAtm = Math.Round(ivAtm * 100, 2), // expresado como %
                    Interpretation = InterpretZScore(priceZScore, neutralZ, extremeZ)
                },
                GexSign = new GexSignInput
                {
                    Value = gexSkew,
                    NetGexBillions = Math.Round(gexSkewRaw, 3),
                    Interpretation = gexSkew == "call_dominant"
                        ? "call wall domina — soporte estructural arriba"
                        : gexSkew == "put_dominant"
                            ? "put wall domina — soporte estructural abajo"
                            : "GEX simétrico — ancla equilibrada"
                },
                Trend = new TrendInput
                {
                    Ema20 = ema20.HasValue ? Math.Round(ema20.Value, 2) : null,
                    Ema50 = ema50.HasValue ? Math.Round(ema50.Value, 2) : null,
                    Signal = trendSignal,
                    Interpretation = trendSignal switch
                    {
                        "up" => "ema_20 > ema_50",
                        "down" => "ema_20 < ema_50",
                        "neutral" => "ema_20 ≈ ema_50 (diff < 0.2%)",
                        _ => "datos insuficientes"
                    }
                },
                RealizedVolRegime = new RealizedVolInput
                {
                    Rv10d = rv10d.HasValue ? Math.Round(rv10d.Value, 2) : null,
                    Rv30d = rv30d.HasValue ? Math.Round(rv30d.Value, 2) : null,
                    Signal = realizedVolSignal,
                    Interpretation = realizedVolSignal switch
                    {
                        "high" => "rv_short > rv_long — vol en expansión",
                        "low" => "rv_short ≤ rv_long — vol en contracción",
                        _ => "datos insuficientes"
                    }
                },
                AggressiveFlow = BuildAggressiveFlowInput(symbol)
            };

            var selectedStructureResult = new SelectedStructureResult
            {
                Output = selectedStructure,
                RuleId = ruleId,
                RuleName = ruleName,
                RuleLabel = ruleLabel
            };

            // Si la estructura es no_trade, retornar sin evaluar más
            if (selectedStructure == "no_trade")
            {
                return new PositionBuilderResponse
                {
                    Symbol = symbol,
                    Profile = request.Profile,
                    Timestamp = DateTime.UtcNow,
                    SpotPrice = spot,
                    OverallSignal = "NO_OPERAR",
                    StructureInputs = structureInputs,
                    SelectedStructure = selectedStructureResult,
                    StrikeEngine = new StrikeEngineResult
                    {
                        Signal = "NO_OPERAR",
                        ExpectedMove = Math.Round(expectedMove, 2),
                        DTE = gex.DTE,
                        Expiration = gex.Expiration,
                        SelectedStructure = "no_trade"
                    }
                };
            }

            // === STRIKE ENGINE (Layer 2) ===
            var strikeChecks = layer2Node?["checks"]?.AsArray();
            double maxPutDelta = VLH.GetCheckThresholdValue(strikeChecks, "put_strike_delta") ?? 0.30;
            double maxCallDelta = VLH.GetCheckThresholdValue(strikeChecks, "call_strike_delta") ?? 0.25;

            int spreadWidth = 10;
            var symbolOverride = spreadConfig?["symbol_overrides"]?[symbol];
            if (symbolOverride != null)
                spreadWidth = symbolOverride["default"]?.GetValue<int>() ?? 10;

            double? shortPutStrike = null, shortCallStrike = null;
            double? shortPutDelta = null, shortCallDelta = null;
            double? longPutStrike = null, longCallStrike = null;
            bool strikesInsideWalls = false;

            if (expectedMove > 0 && gex.Strikes.Count > 0)
            {
                double targetPut = spot - expectedMove;
                double targetCall = spot + expectedMove;

                if (selectedStructure == "iron_condor" || selectedStructure == "put_credit_spread")
                {
                    var putCandidate = gex.Strikes
                        .Where(s => s.Strike <= targetPut && Math.Abs(s.PutDelta) <= maxPutDelta && Math.Abs(s.PutDelta) > 0)
                        .OrderByDescending(s => s.Strike)
                        .FirstOrDefault();

                    if (putCandidate != null)
                    {
                        shortPutStrike = putCandidate.Strike;
                        shortPutDelta = putCandidate.PutDelta;
                        longPutStrike = VLH.SnapToNearestStrike(gex.Strikes, putCandidate.Strike - spreadWidth);
                    }
                }

                if (selectedStructure == "iron_condor" || selectedStructure == "call_credit_spread")
                {
                    var callCandidate = gex.Strikes
                        .Where(s => s.Strike >= targetCall && Math.Abs(s.CallDelta) <= maxCallDelta && Math.Abs(s.CallDelta) > 0)
                        .OrderBy(s => s.Strike)
                        .FirstOrDefault();

                    if (callCandidate != null)
                    {
                        shortCallStrike = callCandidate.Strike;
                        shortCallDelta = callCandidate.CallDelta;
                        longCallStrike = VLH.SnapToNearestStrike(gex.Strikes, callCandidate.Strike + spreadWidth);
                    }
                }

                bool putInsideWall = !shortPutStrike.HasValue || !gex.PutWall.HasValue || shortPutStrike.Value >= gex.PutWall.Value;
                bool callInsideWall = !shortCallStrike.HasValue || !gex.CallWall.HasValue || shortCallStrike.Value <= gex.CallWall.Value;
                strikesInsideWalls = putInsideWall && callInsideWall;
            }

            bool hasValidStrikes = selectedStructure switch
            {
                "iron_condor" => shortPutStrike.HasValue && shortCallStrike.HasValue,
                "put_credit_spread" => shortPutStrike.HasValue,
                "call_credit_spread" => shortCallStrike.HasValue,
                _ => false
            };

            var strikeEngine = new StrikeEngineResult
            {
                Signal = hasValidStrikes && strikesInsideWalls ? "OPERAR" : "NO_OPERAR",
                ExpectedMove = Math.Round(expectedMove, 2),
                DTE = gex.DTE,
                Expiration = gex.Expiration,
                CallWall = gex.CallWall,
                PutWall = gex.PutWall,
                ZScore = Math.Round(priceZScore, 4),
                SelectedStructure = selectedStructure,
                ShortPutStrike = shortPutStrike,
                ShortCallStrike = shortCallStrike,
                ShortPutDelta = shortPutDelta,
                ShortCallDelta = shortCallDelta,
                LongPutStrike = longPutStrike,
                LongCallStrike = longCallStrike,
                StrikesInsideWalls = strikesInsideWalls,
                StructureRuleId = ruleId,
                StructureRuleName = ruleName,
                StructureRuleLabel = ruleLabel,
                GexSign = gexSkew,
                TrendSignal = trendSignal,
                Ema20 = ema20.HasValue ? Math.Round(ema20.Value, 2) : null,
                Ema50 = ema50.HasValue ? Math.Round(ema50.Value, 2) : null,
                RealizedVolSignal = realizedVolSignal,
                Rv10d = rv10d.HasValue ? Math.Round(rv10d.Value, 2) : null,
                Rv30d = rv30d.HasValue ? Math.Round(rv30d.Value, 2) : null
            };

            if (strikeEngine.Signal == "NO_OPERAR")
            {
                return new PositionBuilderResponse
                {
                    Symbol = symbol, Profile = request.Profile,
                    Timestamp = DateTime.UtcNow, SpotPrice = spot,
                    OverallSignal = "NO_OPERAR",
                    StructureInputs = structureInputs,
                    SelectedStructure = selectedStructureResult,
                    StrikeEngine = strikeEngine
                };
            }

            // === MICROSTRUCTURE (Layer 3) ===
            var layer3Node = VLH.GetPositionBuilderLayer(rules, 3);
            var layer3Checks = layer3Node?["checks"]?.AsArray();
            long shortLegMinOI = (long)(VLH.GetCheckThresholdValue(layer3Checks, "oi_short_leg") ?? 2000);
            long longLegMinOI = (long)(VLH.GetCheckThresholdValue(layer3Checks, "oi_long_leg") ?? 2000);
            double maxBidAskPct = VLH.GetCheckThresholdValue(layer3Checks, "bid_ask_spread") ?? 0.05;
            double minCredit = VLH.GetCheckThresholdValue(layer3Checks, "credit_minimum") ?? 0.30;

            var atmStrikeData = gex.Strikes.OrderBy(s => Math.Abs(s.Strike - spot)).FirstOrDefault();

            var shortCallOI = GetOICheck(gex, shortCallStrike, true, shortLegMinOI);
            var shortPutOI = GetOICheck(gex, shortPutStrike, false, shortLegMinOI);
            var longCallOI = GetOICheck(gex, longCallStrike, true, longLegMinOI);
            var longPutOI = GetOICheck(gex, longPutStrike, false, longLegMinOI);
            bool allOIPassed = shortCallOI.Passed && shortPutOI.Passed && longCallOI.Passed && longPutOI.Passed;

            var legQuotes = await FetchLegQuotes(symbol, strikeEngine, cancellationToken);
            var bidAskChecks = VLH.BuildBidAskChecks(legQuotes, strikeEngine, maxBidAskPct);
            bool allBidAskPassed = (bidAskChecks.ShortPut?.Passed ?? true) && (bidAskChecks.ShortCall?.Passed ?? true)
                && (bidAskChecks.LongPut?.Passed ?? true) && (bidAskChecks.LongCall?.Passed ?? true);
            var creditCheck = VLH.BuildCreditCheck(legQuotes, strikeEngine, minCredit);

            bool microPassed = allOIPassed && allBidAskPassed && creditCheck.Passed;
            var microstructure = new MicrostructureResult
            {
                Signal = microPassed ? "OPERAR" : "NO_OPERAR",
                ATMStrike = atmStrikeData?.Strike ?? spot,
                OIChecks = new OIChecks
                {
                    ShortPut = shortPutStrike.HasValue ? shortPutOI : null,
                    ShortCall = shortCallStrike.HasValue ? shortCallOI : null,
                    LongPut = longPutStrike.HasValue ? longPutOI : null,
                    LongCall = longCallStrike.HasValue ? longCallOI : null
                },
                ATMCallDelta = atmStrikeData?.CallDelta,
                ATMPutDelta = atmStrikeData?.PutDelta,
                BidAskChecks = bidAskChecks,
                CreditMinimum = creditCheck
            };

            if (microstructure.Signal == "NO_OPERAR")
            {
                return new PositionBuilderResponse
                {
                    Symbol = symbol, Profile = request.Profile,
                    Timestamp = DateTime.UtcNow, SpotPrice = spot,
                    OverallSignal = "NO_OPERAR",
                    StructureInputs = structureInputs,
                    SelectedStructure = selectedStructureResult,
                    StrikeEngine = strikeEngine,
                    Microstructure = microstructure
                };
            }

            // === RISK & SIZING (Layer 4) ===
            var layer4Node = VLH.GetPositionBuilderLayer(rules, 4);
            var l4Config = layer4Node?["config"];
            double riskPct = l4Config?["risk_per_trade_pct"]?.GetValue<double>() ?? 0.015;
            int maxPositions = l4Config?["max_positions"]?.GetValue<int>() ?? 3;
            double heatMaxPct = l4Config?["max_heat_pct_net_liq"]?.GetValue<double>() ?? 0.045;

            var balancesTask = _mediator.Send(new AccountBalancesRequest { AccountNumber = request.AccountNumber }, cancellationToken);
            var positionsTask = _mediator.Send(new AccountPositionsRequest { AccountNumber = request.AccountNumber }, cancellationToken);
            await Task.WhenAll(balancesTask, positionsTask);

            var balances = balancesTask.Result;
            var positions = positionsTask.Result;

            decimal netLiq = balances.NetLiquidatingValue;
            decimal riskPerTrade = netLiq * (decimal)riskPct;
            decimal maxRiskAmount = Math.Min(netLiq * 0.02m, 10000m);

            int openPositions = positions.Positions?
                .Where(p => p.InstrumentType == "Equity Option")
                .Select(p => p.UnderlyingSymbol)
                .Distinct()
                .Count() ?? 0;

            bool positionsAvailable = openPositions < maxPositions;
            decimal estimatedHeat = openPositions * riskPerTrade;
            double currentHeatPct = netLiq > 0 ? (double)(estimatedHeat / netLiq) : 0;
            bool heatOk = currentHeatPct <= heatMaxPct;

            var riskAndSizing = new RiskAndSizingResult
            {
                Signal = positionsAvailable && heatOk ? "OPERAR" : "NO_OPERAR",
                NetLiq = netLiq,
                RiskPerTrade = riskPerTrade,
                MaxRiskAmount = maxRiskAmount,
                OpenPositions = openPositions,
                MaxPositions = maxPositions,
                PositionsAvailable = positionsAvailable,
                CurrentHeatPct = Math.Round(currentHeatPct * 100, 2),
                MaxHeatPct = heatMaxPct * 100,
                HeatOk = heatOk
            };

            // === BUILD FINAL RESPONSE ===
            string overallSignal = (strikeEngine.Signal == "OPERAR"
                && microstructure.Signal == "OPERAR"
                && riskAndSizing.Signal == "OPERAR")
                ? "OPERAR" : "NO_OPERAR";

            return new PositionBuilderResponse
            {
                Symbol = symbol,
                Profile = request.Profile,
                Timestamp = DateTime.UtcNow,
                SpotPrice = spot,
                OverallSignal = overallSignal,
                StructureInputs = structureInputs,
                SelectedStructure = selectedStructureResult,
                StrikeEngine = strikeEngine,
                Microstructure = microstructure,
                RiskAndSizing = riskAndSizing
            };
        }

        // ═══════════════════════════════════════════════════════════════════════
        // Helpers (delegados a ValidationLayerHandler donde es static)
        // ═══════════════════════════════════════════════════════════════════════

        private AggressiveFlowInput BuildAggressiveFlowInput(string symbol)
        {
            var snapshot = _flowAggregator.GetSnapshot(symbol);
            if (snapshot == null)
            {
                return new AggressiveFlowInput(); // defaults: unavailable, not_implemented
            }

            return new AggressiveFlowInput
            {
                Signal = snapshot.Signal,
                DataSource = "stream",
                Note = null,
                BullishPremiumUsd = snapshot.Bullish.PremiumUsd,
                BearishPremiumUsd = snapshot.Bearish.PremiumUsd,
                NetDeltaFlow = snapshot.NetDeltaFlow,
                DominantSide = snapshot.NetDeltaFlow >= 0
                    ? snapshot.Bullish.DominantType
                    : snapshot.Bearish.DominantType,
                WindowMinutes = snapshot.WindowMinutes
            };
        }

        private static string InterpretZScore(double z, double neutralZ, double extremeZ)
        {
            double absZ = Math.Abs(z);
            if (absZ < neutralZ) return "neutral";
            string direction = z > 0 ? "bullish" : "bearish";
            return absZ >= extremeZ ? $"{direction}_extreme" : $"{direction}_moderate";
        }

        private static OICheck GetOICheck(GammaExposureResponse gex, double? strike, bool isCall, long minRequired)
        {
            if (!strike.HasValue)
                return new OICheck { Passed = true, Value = 0, MinRequired = minRequired };

            var strikeData = gex.Strikes
                .OrderBy(s => Math.Abs(s.Strike - strike.Value))
                .FirstOrDefault();

            long oi = strikeData != null ? (isCall ? strikeData.CallOI : strikeData.PutOI) : 0;

            return new OICheck
            {
                Passed = oi >= minRequired,
                Value = oi,
                MinRequired = minRequired
            };
        }

        private async Task<Dictionary<string, QuoteEvent?>> FetchLegQuotes(
            string symbol, StrikeEngineResult se, CancellationToken ct)
        {
            var quotes = new Dictionary<string, QuoteEvent?>();
            var tasks = new Dictionary<string, Task<MarketDataQuoteResponse>>();

            if (se.ShortPutStrike.HasValue)
                tasks["shortPut"] = _mediator.Send(new MarketDataQuoteRequest
                { Symbol = VLH.BuildOccSymbol(symbol, se.Expiration, se.ShortPutStrike.Value, 'P') }, ct);
            if (se.LongPutStrike.HasValue)
                tasks["longPut"] = _mediator.Send(new MarketDataQuoteRequest
                { Symbol = VLH.BuildOccSymbol(symbol, se.Expiration, se.LongPutStrike.Value, 'P') }, ct);
            if (se.ShortCallStrike.HasValue)
                tasks["shortCall"] = _mediator.Send(new MarketDataQuoteRequest
                { Symbol = VLH.BuildOccSymbol(symbol, se.Expiration, se.ShortCallStrike.Value, 'C') }, ct);
            if (se.LongCallStrike.HasValue)
                tasks["longCall"] = _mediator.Send(new MarketDataQuoteRequest
                { Symbol = VLH.BuildOccSymbol(symbol, se.Expiration, se.LongCallStrike.Value, 'C') }, ct);

            await Task.WhenAll(tasks.Values);

            foreach (var kvp in tasks)
                quotes[kvp.Key] = kvp.Value.Result?.Data?.FirstOrDefault();

            return quotes;
        }
    }
}

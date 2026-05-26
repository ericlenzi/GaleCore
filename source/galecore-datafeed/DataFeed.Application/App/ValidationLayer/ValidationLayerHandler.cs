using MediatR;
using System.Text.Json;
using System.Text.Json.Nodes;
using DataFeed.Application.App.GammaExposure;
using DataFeed.Application.App.ImpliedVolatility;
using DataFeed.Application.App.IVRank;
using DataFeed.Application.Data.Tastytrade.AccountBalances;
using DataFeed.Application.Data.Tastytrade.AccountPositions;

namespace DataFeed.Application.App.ValidationLayer
{
    public class ValidationLayerHandler : IRequestHandler<ValidationLayerRequest, ValidationLayerResponse>
    {
        private readonly IMediator _mediator;

        public ValidationLayerHandler(IMediator mediator)
        {
            _mediator = mediator;
        }

        public async Task<ValidationLayerResponse> Handle(ValidationLayerRequest request, CancellationToken cancellationToken)
        {
            var rules = JsonNode.Parse(request.RulesJson!)!.AsObject();
            var symbol = request.Symbol.ToUpperInvariant();

            var gexTask = _mediator.Send(new GammaExposureRequest { Symbol = symbol, MaxDTE = 60 }, cancellationToken);
            var ivrTask = _mediator.Send(new IVRankRequest { Symbol = symbol }, cancellationToken);
            var ivTask = _mediator.Send(new ImpliedVolatilityRequest { Symbol = symbol }, cancellationToken);
            await Task.WhenAll(gexTask, ivrTask, ivTask);

            var gex = gexTask.Result;
            var ivr = ivrTask.Result;
            var iv = ivTask.Result;

            var response = new ValidationLayerResponse
            {
                Symbol = symbol,
                Profile = request.Profile,
                Timestamp = DateTime.UtcNow,
                SpotPrice = gex.Spot,
                GexData = new ValidationGexData
                {
                    Spot = gex.Spot,
                    DTE = gex.DTE,
                    Expiration = gex.Expiration,
                    GammaZeroLevel = gex.GammaZeroLevel,
                    Strikes = gex.Strikes.Select(s => new ValidationGexStrike
                    {
                        Strike = s.Strike,
                        CallGEX = s.CallGEX,
                        PutGEX = s.PutGEX,
                        NetGEX = s.NetGEX,
                        CallOI = s.CallOI,
                        PutOI = s.PutOI,
                        CallDelta = s.CallDelta,
                        PutDelta = s.PutDelta,
                    }).ToList()
                }
            };

            // === LAYER 1 ===
            var layer1 = EvaluateLayer1(rules, symbol, gex, ivr, iv);
            response.Layer1 = layer1;

            if (layer1.Signal == "NO_OPERAR")
            {
                response.Signal = "NO_OPERAR";
                response.FailedAtLayer = 1;
                return response;
            }

            // === LAYER 2 ===
            var layer2 = EvaluateLayer2(rules, symbol, gex, ivr, iv);
            response.Layer2 = layer2;

            if (layer2.Signal == "NO_OPERAR")
            {
                response.Signal = layer1.Signal == "ESPERAR" ? "ESPERAR" : "NO_OPERAR";
                response.FailedAtLayer = 2;
                return response;
            }

            // === LAYER 3 ===
            var layer3 = EvaluateLayer3(rules, gex, layer2);
            response.Layer3 = layer3;

            if (layer3.Signal == "NO_OPERAR")
            {
                response.Signal = layer1.Signal == "ESPERAR" ? "ESPERAR" : "NO_OPERAR";
                response.FailedAtLayer = 3;
                return response;
            }

            // === LAYER 4 ===
            var layer4 = await EvaluateLayer4(rules, request.AccountNumber, cancellationToken);
            response.Layer4 = layer4;

            if (layer4.Signal == "NO_OPERAR")
            {
                response.Signal = layer1.Signal == "ESPERAR" ? "ESPERAR" : "NO_OPERAR";
                response.FailedAtLayer = 4;
                return response;
            }

            response.Signal = layer1.Signal;
            response.FailedAtLayer = null;
            return response;
        }

        private Layer1MacroResult EvaluateLayer1(
            JsonObject rules, string symbol,
            GammaExposureResponse gex, IVRankResponse ivr, ImpliedVolatilityResponse iv)
        {
            var macro = rules["macro_gamma_regime"]?.AsObject();

            double maxVix = GetDouble(macro, "vix_structure", "max_vix_absolute") ?? 30.0;
            bool vixPassed = iv.IV30_9d.HasValue && iv.IV30_90d.HasValue
                && iv.IV30_9d.Value < iv.IV30_90d.Value
                && iv.IV30_30d.GetValueOrDefault() < maxVix;

            var vixCheck = new VixTermStructureCheck
            {
                Passed = vixPassed,
                IV30_9d = iv.IV30_9d,
                IV30_90d = iv.IV30_90d,
                MaxVixAbsolute = maxVix
            };

            double ivMin = GetDouble(macro, "iv_rank", "min") ?? 25;
            double ivMax = GetDouble(macro, "iv_rank", "max") ?? 65;
            bool ivRankPassed = ivr.IVRank >= ivMin && ivr.IVRank <= ivMax;

            var ivRankCheck = new IVRankCheck
            {
                Passed = ivRankPassed,
                Value = ivr.IVRank,
                Min = ivMin,
                Max = ivMax
            };

            double ivMomentumThreshold = GetDouble(macro, "iv_momentum", "threshold") ?? 12.0;
            bool ivMomentumPassed = iv.IV30RocPct.HasValue && Math.Abs(iv.IV30RocPct.Value) <= ivMomentumThreshold;

            var ivMomentumCheck = new IVMomentumCheck
            {
                Passed = ivMomentumPassed,
                Value = iv.IV30RocPct,
                Threshold = ivMomentumThreshold
            };

            var symbolRules = macro?["gex_total"]?["symbol_rules"]?[symbol];
            string gexMetric = symbolRules?["metric"]?.GetValue<string>() ?? "absolute_billion_usd";
            double gexMinValue = symbolRules?["min_value"]?.GetValue<double>() ?? 100;
            double gexValue = gex.NetGEX;
            bool gexPassed = gexValue >= gexMinValue;

            var gexCheck = new GexTotalCheck
            {
                Passed = gexPassed,
                Value = gexValue,
                Metric = gexMetric,
                Threshold = gexMinValue
            };

            double bufferPct = GetDouble(macro, "spot_vs_zero_gamma", "buffer_pct") ?? 0.005;
            bool spotPassed = gex.GammaZeroLevel.HasValue
                && gex.Spot >= gex.GammaZeroLevel.Value * (1 + bufferPct);

            var spotCheck = new SpotVsZglCheck
            {
                Passed = spotPassed,
                Spot = gex.Spot,
                ZGL = gex.GammaZeroLevel,
                BufferPct = bufferPct
            };

            var checks = new[] { vixPassed, ivRankPassed, ivMomentumPassed, gexPassed, spotPassed };
            int passed = checks.Count(c => c);
            int total = checks.Length;

            string signal = passed == total ? "OPERAR"
                : passed >= total - 1 ? "ESPERAR"
                : "NO_OPERAR";

            return new Layer1MacroResult
            {
                Signal = signal,
                PassedCount = passed,
                TotalChecks = total,
                VixTermStructure = vixCheck,
                IVRank = ivRankCheck,
                IVMomentum = ivMomentumCheck,
                GexTotal = gexCheck,
                SpotVsZGL = spotCheck
            };
        }

        private Layer2StrikesResult EvaluateLayer2(
            JsonObject rules, string symbol,
            GammaExposureResponse gex, IVRankResponse ivr, ImpliedVolatilityResponse iv)
        {
            var construction = rules["trade_construction"]?.AsObject();
            var structureThresholds = rules["strategy_scope"]?["structure_selection"]?["thresholds"];

            int dte = gex.DTE;
            string expiration = gex.Expiration;
            double spot = gex.Spot;

            double ivAtm = (iv.IV30_30d ?? 0) / 100.0;
            double expectedMove = ivAtm > 0 ? spot * ivAtm * Math.Sqrt(dte / 365.0) : 0;

            double zScore = 0;
            if (ivr.History.Count >= 6 && ivAtm > 0)
            {
                var recent = ivr.History[ivr.History.Count - 1];
                var fiveDaysAgo = ivr.History[ivr.History.Count - 6];
                if (fiveDaysAgo.Close > 0 && recent.Close > 0)
                {
                    double ret5d = Math.Log(recent.Close / fiveDaysAgo.Close);
                    double dailySigma = ivAtm / Math.Sqrt(252);
                    zScore = dailySigma > 0 ? ret5d / dailySigma : 0;
                }
            }

            double neutralBand = structureThresholds?["neutral_band_abs_lte"]?.GetValue<double>() ?? 1.2;
            string selectedStructure;
            if (Math.Abs(zScore) <= neutralBand)
                selectedStructure = "iron_condor";
            else if (zScore > neutralBand)
                selectedStructure = "put_credit_spread";
            else
                selectedStructure = "call_credit_spread";

            double? callWall = gex.CallWall;
            double? putWall = gex.PutWall;

            double maxDelta = construction?["strike_selection"]?["short_delta_abs_max"]?.GetValue<double>() ?? 0.16;
            int spreadWidth = construction?["spread_width"]?["symbol_overrides"]?[symbol]?.GetValue<int>() ?? 10;

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
                        .Where(s => s.Strike <= targetPut && Math.Abs(s.PutDelta) <= maxDelta && Math.Abs(s.PutDelta) > 0)
                        .OrderByDescending(s => s.Strike)
                        .FirstOrDefault();

                    if (putCandidate != null)
                    {
                        shortPutStrike = putCandidate.Strike;
                        shortPutDelta = putCandidate.PutDelta;
                        longPutStrike = putCandidate.Strike - spreadWidth;
                    }
                }

                if (selectedStructure == "iron_condor" || selectedStructure == "call_credit_spread")
                {
                    var callCandidate = gex.Strikes
                        .Where(s => s.Strike >= targetCall && Math.Abs(s.CallDelta) <= maxDelta && Math.Abs(s.CallDelta) > 0)
                        .OrderBy(s => s.Strike)
                        .FirstOrDefault();

                    if (callCandidate != null)
                    {
                        shortCallStrike = callCandidate.Strike;
                        shortCallDelta = callCandidate.CallDelta;
                        longCallStrike = callCandidate.Strike + spreadWidth;
                    }
                }

                bool putInsideWall = !shortPutStrike.HasValue || !putWall.HasValue || shortPutStrike.Value >= putWall.Value;
                bool callInsideWall = !shortCallStrike.HasValue || !callWall.HasValue || shortCallStrike.Value <= callWall.Value;
                strikesInsideWalls = putInsideWall && callInsideWall;
            }

            bool hasValidStrikes = selectedStructure switch
            {
                "iron_condor" => shortPutStrike.HasValue && shortCallStrike.HasValue,
                "put_credit_spread" => shortPutStrike.HasValue,
                "call_credit_spread" => shortCallStrike.HasValue,
                _ => false
            };

            string signal = hasValidStrikes && strikesInsideWalls ? "OPERAR" : "NO_OPERAR";

            return new Layer2StrikesResult
            {
                Signal = signal,
                ExpectedMove = Math.Round(expectedMove, 2),
                DTE = dte,
                Expiration = expiration,
                CallWall = callWall,
                PutWall = putWall,
                ZScore = Math.Round(zScore, 4),
                SelectedStructure = selectedStructure,
                ShortPutStrike = shortPutStrike,
                ShortCallStrike = shortCallStrike,
                ShortPutDelta = shortPutDelta,
                ShortCallDelta = shortCallDelta,
                LongPutStrike = longPutStrike,
                LongCallStrike = longCallStrike,
                StrikesInsideWalls = strikesInsideWalls
            };
        }

        private Layer3MicroResult EvaluateLayer3(
            JsonObject rules, GammaExposureResponse gex, Layer2StrikesResult layer2)
        {
            var liquidity = rules["trade_construction"]?["liquidity"];
            long shortLegMinOI = liquidity?["short_leg_open_interest_min"]?.GetValue<long>() ?? 2000;
            long longLegMinOI = liquidity?["long_leg_open_interest_min"]?.GetValue<long>() ?? 500;

            double spot = gex.Spot;
            var atmStrikeData = gex.Strikes
                .OrderBy(s => Math.Abs(s.Strike - spot))
                .FirstOrDefault();

            double atmStrike = atmStrikeData?.Strike ?? spot;

            var shortCallOI = GetOICheck(gex, layer2.ShortCallStrike, true, shortLegMinOI);
            var shortPutOI = GetOICheck(gex, layer2.ShortPutStrike, false, shortLegMinOI);
            var longCallOI = GetOICheck(gex, layer2.LongCallStrike, true, longLegMinOI);
            var longPutOI = GetOICheck(gex, layer2.LongPutStrike, false, longLegMinOI);

            bool allOIPassed = shortCallOI.Passed && shortPutOI.Passed
                && longCallOI.Passed && longPutOI.Passed;

            string signal = allOIPassed ? "OPERAR" : "NO_OPERAR";

            return new Layer3MicroResult
            {
                Signal = signal,
                ATMStrike = atmStrike,
                ShortCallOI = shortCallOI,
                ShortPutOI = shortPutOI,
                LongCallOI = longCallOI,
                LongPutOI = longPutOI,
                ATMCallDelta = atmStrikeData?.CallDelta,
                ATMPutDelta = atmStrikeData?.PutDelta,
                BidAskSpread = null
            };
        }

        private OICheck GetOICheck(GammaExposureResponse gex, double? strike, bool isCall, long minRequired)
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

        private async Task<Layer4SizingResult> EvaluateLayer4(
            JsonObject rules, string? accountNumber, CancellationToken cancellationToken)
        {
            var riskLimits = rules["risk_limits"];
            double riskPct = riskLimits?["risk_per_trade_pct_net_liq_max"]?.GetValue<double>() ?? 0.015;
            int maxPositions = riskLimits?["max_simultaneous_positions"]?.GetValue<int>() ?? 3;
            double heatMaxPct = riskLimits?["portfolio_heat_pct_net_liq_max"]?.GetValue<double>() ?? 0.045;

            var balancesTask = _mediator.Send(new AccountBalancesRequest { AccountNumber = accountNumber }, cancellationToken);
            var positionsTask = _mediator.Send(new AccountPositionsRequest { AccountNumber = accountNumber }, cancellationToken);
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

            bool allPassed = positionsAvailable && heatOk;
            string signal = allPassed ? "OPERAR" : "NO_OPERAR";

            return new Layer4SizingResult
            {
                Signal = signal,
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
        }

        private static double? GetDouble(JsonObject? obj, string key1, string key2)
        {
            var node = obj?[key1]?[key2];
            if (node == null) return null;
            return node.GetValue<double>();
        }
    }
}

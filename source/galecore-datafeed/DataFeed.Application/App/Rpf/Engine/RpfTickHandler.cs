using MediatR;
using System.Text.Json.Nodes;
using DataFeed.Application.App.GammaExposure;
using DataFeed.Application.App.ImpliedVolatility;
using DataFeed.Application.App.IVRank;
using DataFeed.Application.App.PutSkew;
using DataFeed.Application.App.SignalGates;
using DataFeed.Application.App.ValidationLayer;
using DataFeed.Application.Data.Tastytrade.AccountBalances;
using DataFeed.Application.Data.Tastytrade.AccountPositions;
using DataFeed.Application.Data.Tastytrade.MarketDataCandle;
using DataFeed.Application.Data.Tastytrade.MarketDataQuote;
using DataFeed.Application.Data.Tastytrade.MarketDataTrade;
using VLH = DataFeed.Application.App.ValidationLayer.ValidationLayerHandler;

namespace DataFeed.Application.App.Rpf.Engine
{
    /// <summary>
    /// Motor de decisión PROPIO de RPF (Nivel 1 — corte total). Reemplaza el par
    /// ValidationLayerRequest + PositionBuilderRequest que el loop compartía con Main. En un solo tick:
    ///   1) corre el pipeline del candidato SIEMPRE (estructura → strikes+legs → micro → sizing), así el
    ///      candidato PCS se muestra aun en DORMANT y — a diferencia del camino viejo — SIEMPRE con legs;
    ///   2) evalúa macro_regime (Layer 1) y los signal_gates con la misma lógica/cortocircuito de la
    ///      cascada, para que el estado que consume RpfStateMachine no cambie.
    ///
    /// Reusa los primitivos ya compartidos (VLH.* estáticos, SignalGatesEvaluator, PutSkewCalculator);
    /// NO toca ValidationLayerHandler ni PositionBuilderHandler (Main queda intacto). La orquestación de
    /// capas queda deliberadamente propia de RPF (tradeoff "acotado a RPF"): consolidar los tres motores
    /// en un CascadeCore compartido es un follow-up.
    /// </summary>
    public class RpfTickHandler : IRequestHandler<RpfTickRequest, RpfTickResult>
    {
        private readonly IMediator _mediator;

        public RpfTickHandler(IMediator mediator) => _mediator = mediator;

        public async Task<RpfTickResult> Handle(RpfTickRequest request, CancellationToken ct)
        {
            var rules = JsonNode.Parse(request.RulesJson!)!.AsObject();
            var symbol = request.Symbol.ToUpperInvariant();

            // ── Data (mismos providers que la cascada) ──
            var gexTask = _mediator.Send(new GammaExposureRequest { Symbol = symbol, MaxDTE = 60 }, ct);
            var ivrTask = _mediator.Send(new IVRankRequest { Symbol = symbol }, ct);
            var ivTask = _mediator.Send(new ImpliedVolatilityRequest { Symbol = symbol }, ct);
            var candleTask = _mediator.Send(new MarketDataCandleRequest
            {
                Symbol = symbol,
                Interval = "1d",
                FromTime = DateTime.UtcNow.AddDays(-120)
            }, ct);
            var vvixTask = _mediator.Send(new MarketDataTradeRequest { Symbol = "VVIX" }, ct);

            await Task.WhenAll(gexTask, ivrTask, ivTask, candleTask, vvixTask);

            var gex = gexTask.Result;
            var ivr = ivrTask.Result;
            var iv = ivTask.Result;
            double? vvix = vvixTask.Result?.Data?.FirstOrDefault()?.Price;
            var candles = candleTask.Result?.data?
                .Where(c => c.Close > 0)
                .OrderBy(c => c.Time)
                .ToList() ?? new List<CandleData>();

            // ── Pipeline del candidato (SIEMPRE, aun si macro falla) ──
            var strikeEngine = BuildStrikeEngine(rules, symbol, gex, iv, candles, out int spreadWidth);
            var microstructure = await BuildMicrostructure(rules, symbol, gex, strikeEngine, ct);

            // Regla 1/3 + priority score sobre el crédito snapshot (espejo de PositionBuilderHandler).
            double snapshotCredit = microstructure.CreditMinimum?.MidCredit ?? 0;
            if (spreadWidth > 0 && snapshotCredit > 0)
            {
                double creditRatio = snapshotCredit / spreadWidth;
                strikeEngine.CreditRatio = Math.Round(creditRatio * 100, 1);
                if (strikeEngine.Pop.HasValue)
                    strikeEngine.PriorityScore = Math.Round(strikeEngine.Pop.Value * 0.01 * 0.6 + creditRatio * 0.4, 4);
            }

            var riskAndSizing = await BuildSizing(rules, request.AccountNumber, spreadWidth, snapshotCredit, ct);

            // ── Macro (Layer 1) ──
            var macro = BuildMacro(rules, symbol, gex, ivr, iv);

            // ── Cascada de estado (mismo cortocircuito que la cascada de Main) ──
            var result = new RpfTickResult
            {
                Symbol = symbol,
                MacroRegime = macro,
                StrikeEngine = strikeEngine,
                Microstructure = microstructure,
                RiskAndSizing = riskAndSizing,
            };

            // ── Signal gates: se evalúan SIEMPRE, independientes del cupo. VRP+tail siempre tienen data
            // (IV/RV30/VVIX/skew); edge/crédito/muro degradan a no_data sin candidato (no bloquean). Esto
            // desacopla la seguridad del sizing → el veto de cola es autoridad global y WAITING_CAPACITY se
            // vuelve alcanzable. El sizing se sigue computando (cupo + números de la sugerencia) pero NO
            // condiciona la corrida de los gates.
            double currentSkew25 = PutSkewCalculator.Compute(gex).PutSkew25d ?? 0;
            double? skewRoc = !string.IsNullOrWhiteSpace(request.SkewHistoryJson) && currentSkew25 > 0
                ? SkewHistory.Parse(request.SkewHistoryJson!).Roc5d(symbol, currentSkew25)
                : null;
            result.SignalGates = EvaluateSignalGates(rules, symbol, iv, strikeEngine, microstructure, request.PopCalibrationJson, vvix, skewRoc);

            // Cortocircuito de la SEÑAL (macro→strike→micro→gates). El cupo es ortogonal: se comunica por
            // el estado (WaitingCapacity) y la fila Cupo del panel, no corta acá.
            var (overall, failedAtLayer) = RpfCascadeResolver.Resolve(
                macro.Signal, strikeEngine.Signal, microstructure.Signal, result.SignalGates.AllPass);
            result.OverallSignal = overall;
            result.FailedAtLayer = failedAtLayer;
            return result;
        }

        // ── Layer 1: macro_regime (6 checks — misma lógica que la cascada para preservar el gate de estado) ──
        private static MacroRegimeResult BuildMacro(
            JsonObject rules, string symbol, GammaExposureResponse gex, IVRankResponse ivr, ImpliedVolatilityResponse iv)
        {
            var macroChecks = rules["macro_regime"]?["checks"]?.AsArray();
            var definitions = rules["definitions"];

            double maxVix = VLH.FindCheck(macroChecks, "vix_absolute")?["threshold"]?["value"]?.GetValue<double>() ?? 30.0;
            bool vixAbsPassed = iv.IV30_30d.HasValue && iv.IV30_30d.Value < maxVix;

            bool vixTSPassed = iv.IV30_9d.HasValue && iv.IV30_30d.HasValue && iv.IV30_9d.Value < iv.IV30_30d.Value;

            var ivRankDef = VLH.FindCheck(macroChecks, "iv_rank");
            double ivMin = ivRankDef?["threshold"]?["min"]?.GetValue<double>() ?? 25;
            double ivMax = ivRankDef?["threshold"]?["max"]?.GetValue<double>() ?? 65;
            bool ivRankPassed = ivr.IVRank >= ivMin && ivr.IVRank <= ivMax;

            double ivMomThreshold = VLH.FindCheck(macroChecks, "iv_momentum")?["threshold"]?["value"]?.GetValue<double>() ?? 12.0;
            bool ivMomentumPassed = iv.IV30RocPct.HasValue && Math.Abs(iv.IV30RocPct.Value) <= ivMomThreshold;

            double gexThreshold = definitions?["gex_threshold_by_symbol"]?["values"]?[symbol]?.GetValue<double>() ?? 50;
            double gexValue = gex.NetGEX;
            bool gexPassed = gexValue >= gexThreshold;

            double bufferPct = definitions?["zgl_with_buffer"]?["buffer_pct"]?.GetValue<double>() ?? 0.005;
            bool spotPassed = gex.GammaZeroLevel.HasValue && gex.Spot >= gex.GammaZeroLevel.Value * (1 + bufferPct);

            var checks = new[] { vixAbsPassed, vixTSPassed, ivRankPassed, ivMomentumPassed, gexPassed, spotPassed };
            int passed = checks.Count(c => c);
            int total = checks.Length;
            string signal = passed == total ? "OPERAR" : passed >= total - 1 ? "ESPERAR" : "NO_OPERAR";

            return new MacroRegimeResult
            {
                Signal = signal,
                PassedCount = passed,
                TotalChecks = total,
                Checks = new MacroRegimeChecks
                {
                    VixAbsolute = new VixAbsoluteCheck { Passed = vixAbsPassed, Value = iv.IV30_30d, Threshold = maxVix },
                    VixTermStructure = new VixTermStructureCheck { Passed = vixTSPassed, Iv9d = iv.IV30_9d, Iv30d = iv.IV30_30d },
                    IVRank = new IVRankCheck { Passed = ivRankPassed, Value = ivr.IVRank, Min = ivMin, Max = ivMax },
                    IVMomentum = new IVMomentumCheck { Passed = ivMomentumPassed, Value = iv.IV30RocPct, Threshold = ivMomThreshold },
                    GexTotal = new GexTotalCheck { Passed = gexPassed, Value = gexValue, Metric = "billions_usd", Threshold = gexThreshold },
                    SpotVsZgl = new SpotVsZglCheck { Passed = spotPassed, Spot = gex.Spot, ZGL = gex.GammaZeroLevel, BufferPct = bufferPct },
                }
            };
        }

        // ── Layer 2: strike engine (estilo PositionBuilder — filtrado por muro + legs DXLink) ──
        private static StrikeEngineResult BuildStrikeEngine(
            JsonObject rules, string symbol, GammaExposureResponse gex, ImpliedVolatilityResponse iv,
            List<CandleData> candles, out int spreadWidth)
        {
            var layer2Node = VLH.GetPositionBuilderLayer(rules, 2);
            var config = layer2Node?["config"];
            var structureConfig = config?["structure_selection"];
            var spreadConfig = config?["spread_width"];

            double spot = gex.Spot;
            double ivAtm = (iv.IV30_30d ?? 0) / 100.0;
            double expectedMove = ivAtm > 0 ? spot * ivAtm * Math.Sqrt(gex.DTE / 365.0) : 0;

            double neutralZ = structureConfig?["thresholds"]?["neutral_z"]?.GetValue<double>() ?? 1.0;
            double extremeZ = structureConfig?["thresholds"]?["extreme_z"]?.GetValue<double>() ?? 1.5;

            double priceZScore = VLH.ComputePriceZScore(candles, ivAtm);
            string gexSkew = VLH.ComputeGexSkew(gex.CallGEX, gex.PutGEX);
            var (ema20, ema50, trendSignal) = VLH.ComputeTrend(candles);
            var (rv10d, rv30d, realizedVolSignal) = VLH.ComputeRealizedVol(candles);

            var (selectedStructure, ruleId, ruleName, ruleLabel) = VLH.ResolveStructure(
                structureConfig, priceZScore, gexSkew, trendSignal, neutralZ, extremeZ);

            var deltaTarget = config?["delta_target"];
            double putDeltaMin = deltaTarget?["put_short_min"]?.GetValue<double>() ?? 0.25;
            double putDeltaMax = deltaTarget?["put_short_max"]?.GetValue<double>() ?? 0.30;
            double maxCallDelta = VLH.GetCheckThresholdValue(layer2Node?["checks"]?.AsArray(), "call_strike_delta") ?? 0.25;

            spreadWidth = 10;
            var symbolOverride = spreadConfig?["symbol_overrides"]?[symbol];
            if (symbolOverride != null)
                spreadWidth = symbolOverride["default"]?.GetValue<int>() ?? 10;

            double? shortPutStrike = null, shortCallStrike = null;
            double? shortPutDelta = null, shortCallDelta = null;
            double? longPutStrike = null, longCallStrike = null;
            bool strikesInsideWalls = false;
            GammaExposureStrike? putCandidate = null, callCandidate = null;

            if (selectedStructure != "no_trade" && gex.Strikes.Count > 0)
            {
                if (selectedStructure is "iron_condor" or "put_credit_spread")
                {
                    putCandidate = gex.Strikes
                        .Where(s => Math.Abs(s.PutDelta) >= putDeltaMin && Math.Abs(s.PutDelta) <= putDeltaMax
                                 && (!gex.PutWall.HasValue || s.Strike < gex.PutWall.Value))
                        .OrderBy(s => Math.Abs(Math.Abs(s.PutDelta) - putDeltaMin))
                        .FirstOrDefault();

                    if (putCandidate != null)
                    {
                        shortPutStrike = putCandidate.Strike;
                        shortPutDelta = putCandidate.PutDelta;
                        longPutStrike = VLH.SnapToNearestStrike(gex.Strikes, putCandidate.Strike - spreadWidth);
                    }
                }

                if (selectedStructure is "iron_condor" or "call_credit_spread")
                {
                    double targetCall = spot + expectedMove; // rama dormida (CCS REPROBADO); compat.
                    callCandidate = gex.Strikes
                        .Where(s => s.Strike >= targetCall && Math.Abs(s.CallDelta) <= maxCallDelta && Math.Abs(s.CallDelta) > 0
                                 && (!gex.CallWall.HasValue || s.Strike > gex.CallWall.Value))
                        .OrderBy(s => s.Strike)
                        .FirstOrDefault();

                    if (callCandidate != null)
                    {
                        shortCallStrike = callCandidate.Strike;
                        shortCallDelta = callCandidate.CallDelta;
                        longCallStrike = VLH.SnapToNearestStrike(gex.Strikes, callCandidate.Strike + spreadWidth);
                    }
                }

                bool putOutsideWall = !shortPutStrike.HasValue || !gex.PutWall.HasValue || shortPutStrike.Value < gex.PutWall.Value;
                bool callOutsideWall = !shortCallStrike.HasValue || !gex.CallWall.HasValue || shortCallStrike.Value > gex.CallWall.Value;
                strikesInsideWalls = putOutsideWall && callOutsideWall;
            }

            bool hasValidStrikes = selectedStructure switch
            {
                "iron_condor" => shortPutStrike.HasValue && shortCallStrike.HasValue,
                "put_credit_spread" => shortPutStrike.HasValue,
                "call_credit_spread" => shortCallStrike.HasValue,
                _ => false
            };

            double? pop = null;
            if (selectedStructure == "iron_condor" && shortPutDelta.HasValue && shortCallDelta.HasValue)
                pop = Math.Round(Math.Min((1 - Math.Abs(shortPutDelta.Value)) * 100, (1 - Math.Abs(shortCallDelta.Value)) * 100), 1);
            else if (selectedStructure == "put_credit_spread" && shortPutDelta.HasValue)
                pop = Math.Round((1 - Math.Abs(shortPutDelta.Value)) * 100, 1);
            else if (selectedStructure == "call_credit_spread" && shortCallDelta.HasValue)
                pop = Math.Round((1 - Math.Abs(shortCallDelta.Value)) * 100, 1);

            GammaExposureStrike? longPutObj = longPutStrike.HasValue
                ? gex.Strikes.OrderBy(s => Math.Abs(s.Strike - longPutStrike.Value)).FirstOrDefault() : null;
            GammaExposureStrike? longCallObj = longCallStrike.HasValue
                ? gex.Strikes.OrderBy(s => Math.Abs(s.Strike - longCallStrike.Value)).FirstOrDefault() : null;

            return new StrikeEngineResult
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
                Rv30d = rv30d.HasValue ? Math.Round(rv30d.Value, 2) : null,
                Pop = pop,
                LegSymbols = new LegSymbols
                {
                    ShortPut = putCandidate?.PutStreamerSymbol,
                    LongPut = longPutObj?.PutStreamerSymbol,
                    ShortCall = callCandidate?.CallStreamerSymbol,
                    LongCall = longCallObj?.CallStreamerSymbol,
                },
                LegMeta = new LegMetaSet
                {
                    ShortPut = BuildLegMeta(putCandidate, false),
                    LongPut = BuildLegMeta(longPutObj, false),
                    ShortCall = BuildLegMeta(callCandidate, true),
                    LongCall = BuildLegMeta(longCallObj, true),
                }
            };
        }

        // ── Layer 3: microestructura (OI/spread/crédito) ──
        private async Task<MicrostructureResult> BuildMicrostructure(
            JsonObject rules, string symbol, GammaExposureResponse gex, StrikeEngineResult se, CancellationToken ct)
        {
            var layer3Checks = VLH.GetPositionBuilderLayer(rules, 3)?["checks"]?.AsArray();
            long shortLegMinOI = (long)(VLH.GetCheckThresholdValue(layer3Checks, "oi_short_leg") ?? 2000);
            long longLegMinOI = (long)(VLH.GetCheckThresholdValue(layer3Checks, "oi_long_leg") ?? 2000);
            double maxBidAskPct = VLH.GetCheckThresholdValue(layer3Checks, "bid_ask_spread") ?? 0.05;
            double minCredit = VLH.GetCheckThresholdValue(layer3Checks, "credit_minimum") ?? 0.30;

            var atm = gex.Strikes.OrderBy(s => Math.Abs(s.Strike - gex.Spot)).FirstOrDefault();

            var shortCallOI = GetOICheck(gex, se.ShortCallStrike, true, shortLegMinOI);
            var shortPutOI = GetOICheck(gex, se.ShortPutStrike, false, shortLegMinOI);
            var longCallOI = GetOICheck(gex, se.LongCallStrike, true, longLegMinOI);
            var longPutOI = GetOICheck(gex, se.LongPutStrike, false, longLegMinOI);
            bool allOIPassed = shortCallOI.Passed && shortPutOI.Passed && longCallOI.Passed && longPutOI.Passed;

            var legQuotes = await FetchLegQuotes(symbol, se, ct);
            var bidAskChecks = VLH.BuildBidAskChecks(legQuotes, se, maxBidAskPct);
            bool allBidAskPassed = (bidAskChecks.ShortPut?.Passed ?? true) && (bidAskChecks.ShortCall?.Passed ?? true)
                && (bidAskChecks.LongPut?.Passed ?? true) && (bidAskChecks.LongCall?.Passed ?? true);
            var creditCheck = VLH.BuildCreditCheck(legQuotes, se, minCredit);

            bool allPassed = allOIPassed && allBidAskPassed && creditCheck.Passed;

            return new MicrostructureResult
            {
                Signal = allPassed ? "OPERAR" : "NO_OPERAR",
                ATMStrike = atm?.Strike ?? gex.Spot,
                OIChecks = new OIChecks
                {
                    ShortPut = se.ShortPutStrike.HasValue ? shortPutOI : null,
                    ShortCall = se.ShortCallStrike.HasValue ? shortCallOI : null,
                    LongPut = se.LongPutStrike.HasValue ? longPutOI : null,
                    LongCall = se.LongCallStrike.HasValue ? longCallOI : null
                },
                ATMCallDelta = atm?.CallDelta,
                ATMPutDelta = atm?.PutDelta,
                BidAskChecks = bidAskChecks,
                CreditMinimum = creditCheck
            };
        }

        // ── Layer 4: risk & sizing (contracts/maxLoss/heat) ──
        private async Task<RiskAndSizingResult> BuildSizing(
            JsonObject rules, string? accountNumber, int spreadWidth, double snapshotCredit, CancellationToken ct)
        {
            var config = VLH.GetPositionBuilderLayer(rules, 4)?["config"];
            double riskPct = config?["risk_per_trade_pct"]?.GetValue<double>() ?? 0.015;
            int maxPositions = config?["max_positions"]?.GetValue<int>() ?? 3;
            double heatMaxPct = config?["max_heat_pct_net_liq"]?.GetValue<double>() ?? 0.045;

            var balancesTask = _mediator.Send(new AccountBalancesRequest { AccountNumber = accountNumber }, ct);
            var positionsTask = _mediator.Send(new AccountPositionsRequest { AccountNumber = accountNumber }, ct);
            await Task.WhenAll(balancesTask, positionsTask);

            decimal netLiq = balancesTask.Result.NetLiquidatingValue;
            decimal riskPerTrade = netLiq * (decimal)riskPct;
            decimal maxRiskAmount = Math.Min(netLiq * 0.02m, 10000m);

            int openPositions = positionsTask.Result.Positions?
                .Where(p => p.InstrumentType == "Equity Option")
                .Select(p => p.UnderlyingSymbol)
                .Distinct()
                .Count() ?? 0;

            bool positionsAvailable = openPositions < maxPositions;
            double currentHeatPct = netLiq > 0 ? (double)((openPositions * riskPerTrade) / netLiq) : 0;
            bool heatOk = currentHeatPct <= heatMaxPct;

            decimal maxRiskPerContract = snapshotCredit > 0
                ? (decimal)((spreadWidth - snapshotCredit) * 100)
                : (decimal)(spreadWidth * 100);
            int contracts = maxRiskPerContract > 0 ? Math.Max(1, (int)Math.Floor(riskPerTrade / maxRiskPerContract)) : 1;

            return new RiskAndSizingResult
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
                HeatOk = heatOk,
                Contracts = contracts,
                MaxProfit = Math.Round((decimal)(snapshotCredit * 100) * contracts, 2),
                MaxLoss = Math.Round(maxRiskPerContract * contracts, 2),
                BuyingPowerReq = Math.Round(maxRiskPerContract, 2)
            };
        }

        // ── Signal gates (wrapper — reusa SignalGatesEvaluator sin cambios) ──
        private static SignalGatesResult EvaluateSignalGates(
            JsonObject rules, string symbol, ImpliedVolatilityResponse iv,
            StrikeEngineResult se, MicrostructureResult micro, string? popJson, double? vvix, double? skew25Roc)
        {
            var pop = string.IsNullOrWhiteSpace(popJson) ? null : PopCalibrationTable.Parse(popJson!);
            double? width = se.ShortPutStrike.HasValue && se.LongPutStrike.HasValue
                ? Math.Abs(se.ShortPutStrike.Value - se.LongPutStrike.Value) : null;

            var inputs = new SignalGatesInputs
            {
                Symbol = symbol,
                AtmIv30 = iv.IV30_30d,
                RealizedVol30 = se.Rv30d,
                Vvix = vvix,
                Skew25Roc5d = skew25Roc,
                ShortPutStrike = se.ShortPutStrike,
                PutWall = se.PutWall,
                Credit = micro.CreditMinimum?.MidCredit,
                SpreadWidth = width ?? 0,
                ShortPutDeltaAbs = se.ShortPutDelta.HasValue ? Math.Abs(se.ShortPutDelta.Value) : null,
                Regime = VLH.ClassifyRegime(rules["definitions"]?["regime_classification"], iv.IV30_30d),
            };

            return SignalGatesEvaluator.Evaluate(rules["signal_gates"], inputs, pop);
        }

        // ── Helpers propios (equivalentes a los private de VL/PB) ──
        private async Task<Dictionary<string, QuoteEvent?>> FetchLegQuotes(
            string symbol, StrikeEngineResult se, CancellationToken ct)
        {
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

            var quotes = new Dictionary<string, QuoteEvent?>();
            foreach (var kvp in tasks)
                quotes[kvp.Key] = kvp.Value.Result?.Data?.FirstOrDefault();
            return quotes;
        }

        private static OICheck GetOICheck(GammaExposureResponse gex, double? strike, bool isCall, long minRequired)
        {
            if (!strike.HasValue)
                return new OICheck { Passed = true, Value = 0, MinRequired = minRequired };

            var strikeData = gex.Strikes.OrderBy(s => Math.Abs(s.Strike - strike.Value)).FirstOrDefault();
            long oi = strikeData != null ? (isCall ? strikeData.CallOI : strikeData.PutOI) : 0;
            return new OICheck { Passed = oi >= minRequired, Value = oi, MinRequired = minRequired };
        }

        private static LegMeta? BuildLegMeta(GammaExposureStrike? strike, bool isCall)
        {
            if (strike == null) return null;
            return new LegMeta
            {
                OpenInterest = isCall ? strike.CallOI : strike.PutOI,
                PrevClose = isCall ? strike.CallPrevClose : strike.PutPrevClose
            };
        }
    }
}

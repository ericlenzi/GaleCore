using MediatR;
using System.Text.Json;
using System.Text.Json.Nodes;
using DataFeed.Application.App.GammaExposure;
using DataFeed.Application.App.ImpliedVolatility;
using DataFeed.Application.App.IVRank;
using DataFeed.Application.Data.Tastytrade.AccountBalances;
using DataFeed.Application.Data.Tastytrade.AccountPositions;
using DataFeed.Application.Data.Tastytrade.MarketDataCandle;
using DataFeed.Application.Data.Tastytrade.MarketDataQuote;

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

            // Fetch data in parallel: GEX + IVRank + IV + Candles (90d para EMA 50, RV 30, ret 5d)
            var gexTask = _mediator.Send(new GammaExposureRequest { Symbol = symbol, MaxDTE = 60 }, cancellationToken);
            var ivrTask = _mediator.Send(new IVRankRequest { Symbol = symbol }, cancellationToken);
            var ivTask = _mediator.Send(new ImpliedVolatilityRequest { Symbol = symbol }, cancellationToken);
            var candleTask = _mediator.Send(new MarketDataCandleRequest
            {
                Symbol = symbol,
                Interval = "1d",
                FromTime = DateTime.UtcNow.AddDays(-120) // 120 calendar days ~ 85 trading sessions, cubre EMA 50 + buffer
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

            // === LAYER 1: Macro Regime ===
            var macroRegime = EvaluateLayer1(rules, symbol, gex, ivr, iv);
            response.MacroRegime = macroRegime;

            if (macroRegime.Signal == "NO_OPERAR")
            {
                response.OverallSignal = "NO_OPERAR";
                response.FailedAtLayer = 1;
                return response;
            }

            // === LAYER 2: Strike Engine (multi-factor) ===
            var strikeEngine = EvaluateLayer2(rules, symbol, gex, ivr, iv, candles);

            // Inicializar positionBuilder con strikeEngine
            response.PositionBuilder = new PositionBuilderResult { StrikeEngine = strikeEngine };

            if (strikeEngine.Signal == "NO_OPERAR")
            {
                response.PositionBuilder.Signal = "NO_OPERAR";
                response.OverallSignal = macroRegime.Signal == "ESPERAR" ? "ESPERAR" : "NO_OPERAR";
                response.FailedAtLayer = 2;
                return response;
            }

            // === LAYER 3: Microstructure ===
            var microstructure = await EvaluateLayer3(rules, symbol, gex, strikeEngine, cancellationToken);
            response.PositionBuilder.Microstructure = microstructure;

            if (microstructure.Signal == "NO_OPERAR")
            {
                response.PositionBuilder.Signal = "NO_OPERAR";
                response.OverallSignal = macroRegime.Signal == "ESPERAR" ? "ESPERAR" : "NO_OPERAR";
                response.FailedAtLayer = 3;
                return response;
            }

            // === LAYER 4: Risk & Sizing ===
            var riskAndSizing = await EvaluateLayer4(rules, request.AccountNumber, cancellationToken);
            response.PositionBuilder.RiskAndSizing = riskAndSizing;

            if (riskAndSizing.Signal == "NO_OPERAR")
            {
                response.PositionBuilder.Signal = "NO_OPERAR";
                response.OverallSignal = macroRegime.Signal == "ESPERAR" ? "ESPERAR" : "NO_OPERAR";
                response.FailedAtLayer = 4;
                return response;
            }

            // Todas las capas pasaron
            response.PositionBuilder.Signal = "OPERAR";
            response.OverallSignal = macroRegime.Signal;
            response.FailedAtLayer = null;
            return response;
        }

        // ═══════════════════════════════════════════════════════════════════════
        // LAYER 1: Macro Regime
        // Lee de: rules["macro_regime"]["checks"] (JSON v1.1.0)
        // ═══════════════════════════════════════════════════════════════════════

        private MacroRegimeResult EvaluateLayer1(
            JsonObject rules, string symbol,
            GammaExposureResponse gex, IVRankResponse ivr, ImpliedVolatilityResponse iv)
        {
            var macroChecks = rules["macro_regime"]?["checks"]?.AsArray();
            var definitions = rules["definitions"];

            // --- VIX Absolute (proxy: IV30_30d) ---
            var vixAbsDef = FindCheck(macroChecks, "vix_absolute");
            double maxVix = vixAbsDef?["threshold"]?["value"]?.GetValue<double>() ?? 30.0;
            bool vixAbsPassed = iv.IV30_30d.HasValue && iv.IV30_30d.Value < maxVix;

            var vixAbsoluteCheck = new VixAbsoluteCheck
            {
                Passed = vixAbsPassed,
                Value = iv.IV30_30d,
                Threshold = maxVix
            };

            // --- VIX Term Structure (proxy: IV30_9d < IV30_30d = contango normal) ---
            bool vixTSPassed = iv.IV30_9d.HasValue && iv.IV30_30d.HasValue
                && iv.IV30_9d.Value < iv.IV30_30d.Value;

            var vixTSCheck = new VixTermStructureCheck
            {
                Passed = vixTSPassed,
                Iv9d = iv.IV30_9d,
                Iv30d = iv.IV30_30d
            };

            // --- IV Rank ---
            var ivRankDef = FindCheck(macroChecks, "iv_rank");
            double ivMin = ivRankDef?["threshold"]?["min"]?.GetValue<double>() ?? 25;
            double ivMax = ivRankDef?["threshold"]?["max"]?.GetValue<double>() ?? 65;
            bool ivRankPassed = ivr.IVRank >= ivMin && ivr.IVRank <= ivMax;

            var ivRankCheck = new IVRankCheck
            {
                Passed = ivRankPassed,
                Value = ivr.IVRank,
                Min = ivMin,
                Max = ivMax
            };

            // --- IV Momentum ---
            var ivMomDef = FindCheck(macroChecks, "iv_momentum");
            double ivMomentumThreshold = ivMomDef?["threshold"]?["value"]?.GetValue<double>() ?? 12.0;
            bool ivMomentumPassed = iv.IV30RocPct.HasValue && Math.Abs(iv.IV30RocPct.Value) <= ivMomentumThreshold;

            var ivMomentumCheck = new IVMomentumCheck
            {
                Passed = ivMomentumPassed,
                Value = iv.IV30RocPct,
                Threshold = ivMomentumThreshold
            };

            // --- GEX Total (threshold por símbolo desde definitions) ---
            double gexThreshold = definitions?["gex_threshold_by_symbol"]?["values"]?[symbol]?.GetValue<double>() ?? 50;
            double gexValue = gex.NetGEX;
            bool gexPassed = gexValue >= gexThreshold;

            var gexCheck = new GexTotalCheck
            {
                Passed = gexPassed,
                Value = gexValue,
                Metric = "billions_usd",
                Threshold = gexThreshold
            };

            // --- Spot vs ZGL (buffer desde definitions) ---
            double bufferPct = definitions?["zgl_with_buffer"]?["buffer_pct"]?.GetValue<double>() ?? 0.005;
            bool spotPassed = gex.GammaZeroLevel.HasValue
                && gex.Spot >= gex.GammaZeroLevel.Value * (1 + bufferPct);

            var spotCheck = new SpotVsZglCheck
            {
                Passed = spotPassed,
                Spot = gex.Spot,
                ZGL = gex.GammaZeroLevel,
                BufferPct = bufferPct
            };

            // --- Signal ---
            var checks = new[] { vixAbsPassed, vixTSPassed, ivRankPassed, ivMomentumPassed, gexPassed, spotPassed };
            int passed = checks.Count(c => c);
            int total = checks.Length;

            string signal = passed == total ? "OPERAR"
                : passed >= total - 1 ? "ESPERAR"
                : "NO_OPERAR";

            return new MacroRegimeResult
            {
                Signal = signal,
                PassedCount = passed,
                TotalChecks = total,
                Checks = new MacroRegimeChecks
                {
                    VixAbsolute = vixAbsoluteCheck,
                    VixTermStructure = vixTSCheck,
                    IVRank = ivRankCheck,
                    IVMomentum = ivMomentumCheck,
                    GexTotal = gexCheck,
                    SpotVsZgl = spotCheck
                }
            };
        }

        // ═══════════════════════════════════════════════════════════════════════
        // LAYER 2: Strike Engine (multi-factor structure selection)
        // Lee de: rules["position_builder"]["layers"][0] (id: 2, strike_engine)
        // Computa: priceZScore, gexSign, trend EMA, realized vol, 5 reglas
        // ═══════════════════════════════════════════════════════════════════════

        private StrikeEngineResult EvaluateLayer2(
            JsonObject rules, string symbol,
            GammaExposureResponse gex, IVRankResponse ivr, ImpliedVolatilityResponse iv,
            List<CandleData> candles)
        {
            var layer2Node = GetPositionBuilderLayer(rules, 2);
            var config = layer2Node?["config"];
            var structureConfig = config?["structure_selection"];
            var spreadConfig = config?["spread_width"];

            int dte = gex.DTE;
            string expiration = gex.Expiration;
            double spot = gex.Spot;

            // --- IV ATM y Expected Move ---
            double ivAtm = (iv.IV30_30d ?? 0) / 100.0;
            double expectedMove = ivAtm > 0 ? spot * ivAtm * Math.Sqrt(dte / 365.0) : 0;

            // --- Multi-factor inputs ---
            double neutralZ = structureConfig?["thresholds"]?["neutral_z"]?.GetValue<double>() ?? 1.0;
            double extremeZ = structureConfig?["thresholds"]?["extreme_z"]?.GetValue<double>() ?? 1.5;

            double priceZScore = ComputePriceZScore(candles, ivAtm);
            string gexSkew = ComputeGexSkew(gex.CallGEX, gex.PutGEX);
            var (ema20, ema50, trendSignal) = ComputeTrend(candles);
            var (rv10d, rv30d, realizedVolSignal) = ComputeRealizedVol(candles);

            // --- Evaluación de reglas de estructura (sequential first-match) ---
            var (selectedStructure, ruleId, ruleName, ruleLabel) = EvaluateStructureRules(
                structureConfig, priceZScore, gexSkew, trendSignal, neutralZ, extremeZ);

            // Si ninguna regla matcheó (no_trade), Layer 2 falla
            if (selectedStructure == "no_trade")
            {
                return new StrikeEngineResult
                {
                    Signal = "NO_OPERAR",
                    ExpectedMove = Math.Round(expectedMove, 2),
                    DTE = dte,
                    Expiration = expiration,
                    CallWall = gex.CallWall,
                    PutWall = gex.PutWall,
                    ZScore = Math.Round(priceZScore, 4),
                    SelectedStructure = "no_trade",
                    StrikesInsideWalls = false,
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
            }

            // --- Strike Selection ---
            double? callWall = gex.CallWall;
            double? putWall = gex.PutWall;

            // Delta max y spread width desde position_builder config
            var strikeChecks = layer2Node?["checks"]?.AsArray();
            double maxPutDelta = GetCheckThresholdValue(strikeChecks, "put_strike_delta") ?? 0.30;
            double maxCallDelta = GetCheckThresholdValue(strikeChecks, "call_strike_delta") ?? 0.25;

            int spreadWidth = 10; // default
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
                        // Snap long strike al strike válido más cercano al target (short - width)
                        longPutStrike = SnapToNearestStrike(gex.Strikes, putCandidate.Strike - spreadWidth);
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
                        // Snap long strike al strike válido más cercano al target (short + width)
                        longCallStrike = SnapToNearestStrike(gex.Strikes, callCandidate.Strike + spreadWidth);
                    }
                }

                bool putOutsideWall = !shortPutStrike.HasValue || !putWall.HasValue || shortPutStrike.Value < putWall.Value;
                bool callOutsideWall = !shortCallStrike.HasValue || !callWall.HasValue || shortCallStrike.Value > callWall.Value;
                strikesInsideWalls = putOutsideWall && callOutsideWall;
            }

            bool hasValidStrikes = selectedStructure switch
            {
                "iron_condor" => shortPutStrike.HasValue && shortCallStrike.HasValue,
                "put_credit_spread" => shortPutStrike.HasValue,
                "call_credit_spread" => shortCallStrike.HasValue,
                _ => false
            };

            string signal = hasValidStrikes && strikesInsideWalls ? "OPERAR" : "NO_OPERAR";

            return new StrikeEngineResult
            {
                Signal = signal,
                ExpectedMove = Math.Round(expectedMove, 2),
                DTE = dte,
                Expiration = expiration,
                CallWall = callWall,
                PutWall = putWall,
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
                GexSign = gexSign,
                TrendSignal = trendSignal,
                Ema20 = ema20.HasValue ? Math.Round(ema20.Value, 2) : null,
                Ema50 = ema50.HasValue ? Math.Round(ema50.Value, 2) : null,
                RealizedVolSignal = realizedVolSignal,
                Rv10d = rv10d.HasValue ? Math.Round(rv10d.Value, 2) : null,
                Rv30d = rv30d.HasValue ? Math.Round(rv30d.Value, 2) : null
            };
        }

        // ═══════════════════════════════════════════════════════════════════════
        // LAYER 3: Microstructure
        // Lee de: rules["position_builder"]["layers"][1] (id: 3, microstructure)
        // Checks: OI por leg, bid-ask spread por leg, crédito mínimo del spread
        // ═══════════════════════════════════════════════════════════════════════

        private async Task<MicrostructureResult> EvaluateLayer3(
            JsonObject rules, string symbol,
            GammaExposureResponse gex, StrikeEngineResult strikeEngine,
            CancellationToken cancellationToken)
        {
            var layer3Node = GetPositionBuilderLayer(rules, 3);
            var layer3Checks = layer3Node?["checks"]?.AsArray();

            // --- Thresholds desde JSON ---
            long shortLegMinOI = (long)(GetCheckThresholdValue(layer3Checks, "oi_short_leg") ?? 2000);
            long longLegMinOI = (long)(GetCheckThresholdValue(layer3Checks, "oi_long_leg") ?? 2000);
            double maxBidAskPct = GetCheckThresholdValue(layer3Checks, "bid_ask_spread") ?? 0.05;
            double minCredit = GetCheckThresholdValue(layer3Checks, "credit_minimum") ?? 0.30;

            // --- ATM Strike ---
            double spot = gex.Spot;
            var atmStrikeData = gex.Strikes
                .OrderBy(s => Math.Abs(s.Strike - spot))
                .FirstOrDefault();
            double atmStrike = atmStrikeData?.Strike ?? spot;

            // --- OI Checks (de GEX data) ---
            var shortCallOI = GetOICheck(gex, strikeEngine.ShortCallStrike, true, shortLegMinOI);
            var shortPutOI = GetOICheck(gex, strikeEngine.ShortPutStrike, false, shortLegMinOI);
            var longCallOI = GetOICheck(gex, strikeEngine.LongCallStrike, true, longLegMinOI);
            var longPutOI = GetOICheck(gex, strikeEngine.LongPutStrike, false, longLegMinOI);

            bool allOIPassed = shortCallOI.Passed && shortPutOI.Passed
                && longCallOI.Passed && longPutOI.Passed;

            // --- Fetch Quotes para bid-ask y credit (en paralelo) ---
            var legQuotes = await FetchLegQuotes(symbol, strikeEngine, cancellationToken);

            // --- Bid-Ask Checks por leg ---
            var bidAskChecks = BuildBidAskChecks(legQuotes, strikeEngine, maxBidAskPct);
            bool allBidAskPassed = (bidAskChecks.ShortPut?.Passed ?? true)
                && (bidAskChecks.ShortCall?.Passed ?? true)
                && (bidAskChecks.LongPut?.Passed ?? true)
                && (bidAskChecks.LongCall?.Passed ?? true);

            // --- Credit Minimum Check ---
            var creditCheck = BuildCreditCheck(legQuotes, strikeEngine, minCredit);

            // --- Signal: todos los checks deben pasar ---
            bool allPassed = allOIPassed && allBidAskPassed && creditCheck.Passed;
            string signal = allPassed ? "OPERAR" : "NO_OPERAR";

            return new MicrostructureResult
            {
                Signal = signal,
                ATMStrike = atmStrike,
                OIChecks = new OIChecks
                {
                    ShortPut = strikeEngine.ShortPutStrike.HasValue ? shortPutOI : null,
                    ShortCall = strikeEngine.ShortCallStrike.HasValue ? shortCallOI : null,
                    LongPut = strikeEngine.LongPutStrike.HasValue ? longPutOI : null,
                    LongCall = strikeEngine.LongCallStrike.HasValue ? longCallOI : null
                },
                ATMCallDelta = atmStrikeData?.CallDelta,
                ATMPutDelta = atmStrikeData?.PutDelta,
                BidAskChecks = bidAskChecks,
                CreditMinimum = creditCheck
            };
        }

        /// <summary>
        /// Obtiene quotes (bid/ask/mid) para cada leg del spread seleccionado en Layer 2.
        /// Construye símbolos OCC y los envía al MarketDataQuoteHandler en paralelo.
        /// </summary>
        private async Task<Dictionary<string, QuoteEvent?>> FetchLegQuotes(
            string symbol, StrikeEngineResult strikeEngine, CancellationToken ct)
        {
            var quotes = new Dictionary<string, QuoteEvent?>();
            var tasks = new Dictionary<string, Task<MarketDataQuoteResponse>>();

            // Construir OCC para cada leg que exista
            if (strikeEngine.ShortPutStrike.HasValue)
                tasks["shortPut"] = _mediator.Send(new MarketDataQuoteRequest
                { Symbol = BuildOccSymbol(symbol, strikeEngine.Expiration, strikeEngine.ShortPutStrike.Value, 'P') }, ct);

            if (strikeEngine.LongPutStrike.HasValue)
                tasks["longPut"] = _mediator.Send(new MarketDataQuoteRequest
                { Symbol = BuildOccSymbol(symbol, strikeEngine.Expiration, strikeEngine.LongPutStrike.Value, 'P') }, ct);

            if (strikeEngine.ShortCallStrike.HasValue)
                tasks["shortCall"] = _mediator.Send(new MarketDataQuoteRequest
                { Symbol = BuildOccSymbol(symbol, strikeEngine.Expiration, strikeEngine.ShortCallStrike.Value, 'C') }, ct);

            if (strikeEngine.LongCallStrike.HasValue)
                tasks["longCall"] = _mediator.Send(new MarketDataQuoteRequest
                { Symbol = BuildOccSymbol(symbol, strikeEngine.Expiration, strikeEngine.LongCallStrike.Value, 'C') }, ct);

            await Task.WhenAll(tasks.Values);

            foreach (var kvp in tasks)
            {
                var response = kvp.Value.Result;
                quotes[kvp.Key] = response?.Data?.FirstOrDefault();
            }

            return quotes;
        }

        /// <summary>
        /// Construye un símbolo OCC de 21 caracteres para una opción.
        /// Formato: SSSSSSYYMMDDTPPPPPQQQ
        /// Ejemplo: "SPY   260717P00702000" = SPY Put $702, expira 17-Jul-2026
        /// </summary>
        internal static string BuildOccSymbol(string underlying, string expiration, double strike, char optionType)
        {
            string symbolPart = underlying.PadRight(6);
            var dt = DateTime.Parse(expiration);
            string datePart = dt.ToString("yyMMdd");
            long strikeInt = (long)(strike * 1000);
            string strikePart = strikeInt.ToString("D8");

            return symbolPart + datePart + optionType + strikePart;
        }

        /// <summary>
        /// Construye los checks de bid-ask spread por leg.
        /// spreadPct = (ask - bid) / mid. Si el leg no existe, el check es null (auto-pass).
        /// </summary>
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

        /// <summary>
        /// Calcula el crédito mid del spread y verifica contra el mínimo.
        /// Put side credit: shortPut.mid - longPut.mid
        /// Call side credit: shortCall.mid - longCall.mid
        /// Total = suma de las sides que apliquen según la estructura.
        /// </summary>
        internal static CreditMinimumCheck BuildCreditCheck(
            Dictionary<string, QuoteEvent?> quotes, StrikeEngineResult strikeEngine, double minRequired)
        {
            double totalCredit = 0;
            bool hasValidQuotes = true;

            // Put side: vendemos el short put (recibimos mid) y compramos el long put (pagamos mid)
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

            // Call side: vendemos el short call (recibimos mid) y compramos el long call (pagamos mid)
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
        // LAYER 4: Risk & Sizing
        // Lee de: rules["position_builder"]["layers"][2] (id: 4, risk_and_sizing)
        // ═══════════════════════════════════════════════════════════════════════

        private async Task<RiskAndSizingResult> EvaluateLayer4(
            JsonObject rules, string? accountNumber, CancellationToken cancellationToken)
        {
            var layer4Node = GetPositionBuilderLayer(rules, 4);
            var config = layer4Node?["config"];

            double riskPct = config?["risk_per_trade_pct"]?.GetValue<double>() ?? 0.015;
            int maxPositions = config?["max_positions"]?.GetValue<int>() ?? 3;
            double heatMaxPct = config?["max_heat_pct_net_liq"]?.GetValue<double>() ?? 0.045;

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

            return new RiskAndSizingResult
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

        // ═══════════════════════════════════════════════════════════════════════
        // MULTI-FACTOR COMPUTATIONS
        // ═══════════════════════════════════════════════════════════════════════

        /// <summary>
        /// Price Z-Score: ret_5d / (iv_atm / sqrt(252))
        /// Mide cuántas desviaciones estándar se movió el precio en 5 días.
        /// </summary>
        internal static double ComputePriceZScore(List<CandleData> candles, double ivAtm)
        {
            if (candles.Count < 6 || ivAtm <= 0)
                return 0;

            double closeToday = candles[^1].Close;
            double close5dAgo = candles[^6].Close; // 5 sesiones atrás

            if (close5dAgo <= 0 || closeToday <= 0)
                return 0;

            double ret5d = Math.Log(closeToday / close5dAgo);
            double dailySigma = ivAtm / Math.Sqrt(252);

            return dailySigma > 0 ? ret5d / dailySigma : 0;
        }

        /// <summary>
        /// Trend EMA 20/50: calcula EMAs y determina señal de tendencia.
        /// trend_up: ema_20 > ema_50
        /// trend_down: ema_20 < ema_50
        /// trend_neutral: abs(ema_20 - ema_50) / ema_50 < 0.002
        /// </summary>
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

        /// <summary>
        /// Calcula EMA(N) sobre los closes del array de candles.
        /// EMA = close * k + ema_prev * (1 - k), donde k = 2/(N+1)
        /// Usa SMA de los primeros N como semilla.
        /// </summary>
        internal static double ComputeEMA(List<CandleData> candles, int period)
        {
            if (candles.Count < period)
                return 0;

            // SMA semilla con las primeras N velas
            double sma = candles.Take(period).Average(c => c.Close);
            double k = 2.0 / (period + 1);
            double ema = sma;

            for (int i = period; i < candles.Count; i++)
            {
                ema = candles[i].Close * k + ema * (1 - k);
            }

            return ema;
        }

        /// <summary>
        /// Realized Volatility Regime: rv_10d vs rv_30d
        /// rv = stddev(log_returns, window) * sqrt(252) * 100
        /// high: rv_short > rv_long (vol en expansion)
        /// low: rv_short <= rv_long
        /// </summary>
        internal static (double? rv10d, double? rv30d, string signal) ComputeRealizedVol(List<CandleData> candles)
        {
            if (candles.Count < 31) // Necesitamos 30 returns + 1 close base
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

        /// <summary>
        /// Calcula volatilidad annualizada desde los últimos N log returns.
        /// stddev(window) * sqrt(252) * 100
        /// </summary>
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

        /// <summary>
        /// Evalúa las reglas de selección de estructura en orden secuencial (first-match).
        /// Las reglas se definen en position_builder.layers[0].config.structure_selection.rules.
        ///
        /// Nota: el input "flow" (aggressive_flow) no está disponible en modo REST.
        /// Las condiciones de flow se tratan como satisfechas (pass-through) hasta Fase 5-6.
        /// </summary>
        internal static (string structure, int? ruleId, string? ruleName, string? ruleLabel) EvaluateStructureRules(
            JsonNode? structureConfig, double priceZScore, string gexSkew, string trendSignal,
            double neutralZ, double extremeZ)
        {
            var rulesArray = structureConfig?["rules"]?.AsArray();
            if (rulesArray == null)
                return ("iron_condor", null, null, null); // fallback seguro

            foreach (var rule in rulesArray)
            {
                if (rule == null) continue;

                var conditions = rule["conditions"];
                string? output = rule["output"]?.GetValue<string>();
                int? id = rule["id"]?.GetValue<int>();
                string? name = rule["name"]?.GetValue<string>();
                string? label = rule["label"]?.GetValue<string>();

                // Rule 6: fallthrough
                if (conditions is JsonValue condValue && condValue.GetValue<string>() == "fallthrough")
                    return (output ?? "no_trade", id, name, label);

                if (conditions is not JsonObject condObj)
                    continue;

                // Evaluar cada condición del rule
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

        /// <summary>
        /// Evalúa una condición individual de una regla de estructura.
        /// </summary>
        internal static bool EvaluateCondition(string conditionKey, string? conditionValue,
            double priceZScore, string gexSkew, string trendSignal,
            double neutralZ, double extremeZ)
        {
            return conditionKey switch
            {
                // |price_zscore| < neutral_z
                "price_zscore_abs" => Math.Abs(priceZScore) < neutralZ,

                // price_zscore > extreme_z (positive direction)
                "price_zscore" when conditionValue?.Contains(">") == true => priceZScore > extremeZ,

                // price_zscore < -extreme_z (negative direction)
                "price_zscore" when conditionValue?.Contains("<") == true => priceZScore < -extremeZ,

                // gex_skew: bucket match (call_dominant / put_dominant / symmetric)
                "gex_skew" => gexSkew == conditionValue,

                // trend match
                "trend" => trendSignal == conditionValue,

                // flow: pass-through (resuelto por FlowAggregatorService en PositionBuilder)
                "flow" => true,

                // Condición desconocida: pass (fail-safe)
                _ => true
            };
        }

        /// <summary>
        /// Clasifica el GEX en un bucket de skew según la proporción callGEX / (callGEX + |putGEX|).
        /// Siempre se evalúa en entorno GEX positivo (garantizado por macro_regime.gex_total).
        /// </summary>
        internal static string ComputeGexSkew(double callGex, double putGex)
        {
            double denominator = callGex + Math.Abs(putGex);
            if (denominator == 0) return "symmetric";
            double skew = callGex / denominator;
            return skew > 0.6 ? "call_dominant" : skew < 0.4 ? "put_dominant" : "symmetric";
        }

        // ═══════════════════════════════════════════════════════════════════════
        // HELPERS
        // ═══════════════════════════════════════════════════════════════════════

        /// <summary>
        /// Encuentra el strike válido más cercano al target en la lista de strikes del GEX.
        /// Usado para ajustar long strikes que podrían caer en un strike inexistente
        /// (e.g., shortPut=702, width=10 → target 692, pero la cadena tiene 690 y 695).
        /// </summary>
        internal static double SnapToNearestStrike(List<GammaExposureStrike> strikes, double target)
        {
            if (strikes == null || strikes.Count == 0)
                return target;

            var nearest = strikes.OrderBy(s => Math.Abs(s.Strike - target)).FirstOrDefault();
            return nearest?.Strike ?? target;
        }

        /// <summary>
        /// Busca un check por id en el array de checks del macro_regime.
        /// </summary>
        internal static JsonNode? FindCheck(JsonArray? checks, string checkId)
        {
            if (checks == null) return null;
            return checks.FirstOrDefault(c => c?["id"]?.GetValue<string>() == checkId);
        }

        /// <summary>
        /// Obtiene el layer node del position_builder por id (2, 3, o 4).
        /// </summary>
        internal static JsonNode? GetPositionBuilderLayer(JsonObject rules, int layerId)
        {
            var layers = rules["position_builder"]?["layers"]?.AsArray();
            if (layers == null) return null;
            return layers.FirstOrDefault(l => l?["id"]?.GetValue<int>() == layerId);
        }

        /// <summary>
        /// Extrae threshold.value de un check del array por id.
        /// </summary>
        internal static double? GetCheckThresholdValue(JsonArray? checks, string checkId)
        {
            var check = FindCheck(checks, checkId);
            return check?["threshold"]?["value"]?.GetValue<double>();
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
    }
}

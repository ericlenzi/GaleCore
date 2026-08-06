using System.Text.Json.Nodes;
using DataFeed.Application.App.Rpf;
using DataFeed.Application.App.Rpf.Engine;
using DataFeed.Application.App.SignalGates;
using DataFeed.Application.App.Shared.Dtos;
using DataFeed.Infrastructure.Providers.Tastytrade;
using MediatR;

namespace DataFeed.Api.Infrastructure
{
    /// <summary>
    /// Loop de orquestación RPF (diseño Fase 5 §3). BackgroundService singleton, molde de
    /// FlowBroadcastService/SkewSnapshotService. SPY-only. En cada tick corre la cascada existente
    /// (ValidationLayerRequest sobre galecore_rules_rpf.json) y mapea su salida a la máquina de estados
    /// (RpfStateMachine, función pura); emite RpfStateUpdate al cambiar de estado y TradeSuggestion al
    /// entrar en TRIGGERED. El sistema SUGIERE, nunca ejecuta.
    ///
    /// ARRANCA INERTE: mientras state_machine.enabled != true en el JSON, el loop no corre la cascada
    /// ni emite nada — solo late. Se activa recién tras revisión + validación en paper (Decisión de
    /// arranque, 2026-07-29). NO está registrado para emitir hasta ese flip.
    ///
    /// Nota 6a: corre la cascada COMPLETA por tick (el cache de Tier A del diseño §3.1 es una
    /// optimización de latencia que se afina en activación; con el loop inerte no hay costo).
    /// </summary>
    public class RpfLoopService : BackgroundService
    {
        private readonly IServiceScopeFactory _scopeFactory;
        private readonly IWebHostEnvironment _env;
        private readonly IMarketDataBroadcaster _broadcaster;
        private readonly RpfStateStore _store;
        private readonly RpfWorkerSwitch _workerSwitch;
        private readonly ILogger<RpfLoopService> _logger;

        // Archivos propios de RPF bajo Files/Rpf/ (regla "archivos por estrategia" de CLAUDE.md).
        private const string RulesFile = "Rpf/galecore_rules_rpf.json";
        private bool _inertLogged;

        public RpfLoopService(
            IServiceScopeFactory scopeFactory,
            IWebHostEnvironment env,
            IMarketDataBroadcaster broadcaster,
            RpfStateStore store,
            RpfWorkerSwitch workerSwitch,
            ILogger<RpfLoopService> logger)
        {
            _scopeFactory = scopeFactory;
            _env = env;
            _broadcaster = broadcaster;
            _store = store;
            _workerSwitch = workerSwitch;
            _logger = logger;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            _logger.LogInformation("RpfLoopService iniciado (arranca inerte hasta state_machine.enabled=true)");
            // Delay inicial para que DXLink complete el handshake, como los demás hosted services.
            try { await Task.Delay(TimeSpan.FromSeconds(45), stoppingToken); } catch (OperationCanceledException) { return; }

            while (!stoppingToken.IsCancellationRequested)
            {
                int tickBSeconds = 30;
                try
                {
                    var cfg = LoadConfig();
                    tickBSeconds = cfg.TickBSeconds;

                    if (!cfg.Enabled)
                    {
                        if (!_inertLogged)
                        {
                            // Al entrar en inerte se descarta el estado en memoria: con el loop parado
                            // nadie lo actualiza. Cubre también el apagado por fuera del switch (edición
                            // directa del archivo de estado o del JSON de reglas).
                            _store.Clear();
                            _logger.LogInformation("RpfLoopService INERTE: workers apagados — no se corre la cascada ni se emite.");
                            _inertLogged = true;
                        }
                    }
                    else
                    {
                        _inertLogged = false;
                        await TickAsync(cfg, stoppingToken);
                    }
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
                catch (Exception ex) { _logger.LogError(ex, "Error en RpfLoopService tick"); }

                try { await Task.Delay(TimeSpan.FromSeconds(tickBSeconds), stoppingToken); } catch (OperationCanceledException) { break; }
            }
            _logger.LogInformation("RpfLoopService detenido");
        }

        // ── Config ──

        private record LoopConfig(bool Enabled, int TickBSeconds, int CooldownSeconds, List<string> Tickers, string RulesJson, string? PopJson, string? SkewJson);

        private LoopConfig LoadConfig()
        {
            var filesDir = Path.Combine(_env.ContentRootPath, "Files");
            var rulesJson = File.ReadAllText(Path.Combine(filesDir, RulesFile));
            var root = JsonNode.Parse(rulesJson)!.AsObject();

            // El switch manual del operador (Files/Rpf/rpf_workers_state.json) pisa lo que declara el
            // JSON de reglas. Si nunca se tocó, manda state_machine.enabled. Se relee en cada tick, así
            // que apagar desde el front corta el loop dentro de un tick, sin reiniciar la API.
            bool enabled = _workerSwitch.ReadOverride() ?? (bool?)root["state_machine"]?["enabled"] ?? false;
            var orch = root["orchestration"]?.AsObject();
            int tickB = (int?)orch?["tier_b_tick_seconds"] ?? 30;
            int cooldown = (int?)orch?["cooldown_seconds"] ?? 120;

            var tickers = root["universe"]?["tickers"]?.AsArray()
                .Select(x => (string?)x).Where(s => !string.IsNullOrEmpty(s)).Select(s => s!).ToList()
                ?? new List<string> { "SPY" };

            // Quedan en la raíz de Files/, no en Files/Rpf/: hoy los lee solo RPF, pero quien
            // ESCRIBE skew25_history.json es SkewSnapshotService, que no es de ninguna estrategia.
            string? pop = ReadOrNull(Path.Combine(filesDir, "pop_calibration.json"));
            string? skew = ReadOrNull(Path.Combine(filesDir, "skew25_history.json"));

            return new LoopConfig(enabled, tickB, cooldown, tickers, rulesJson, pop, skew);
        }

        private static string? ReadOrNull(string path) => File.Exists(path) ? File.ReadAllText(path) : null;

        // ── Tick ──

        private async Task TickAsync(LoopConfig cfg, CancellationToken ct)
        {
            using var scope = _scopeFactory.CreateScope();
            var mediator = scope.ServiceProvider.GetRequiredService<IMediator>();

            foreach (var symbol in cfg.Tickers)
            {
                var now = DateTime.UtcNow;
                try
                {
                    // Motor de decisión PROPIO de RPF (corte total): un solo tick corre macro + candidato
                    // (siempre, con legs) + signal_gates sobre rpf.json. Ya no comparte VL/PB con Main.
                    var tick = await mediator.Send(new RpfTickRequest
                    {
                        Symbol = symbol,
                        RulesJson = cfg.RulesJson,
                        PopCalibrationJson = cfg.PopJson,
                        SkewHistoryJson = cfg.SkewJson,
                    }, ct);

                    bool inCooldown = _store.InCooldown(symbol, now);
                    var inputs = BuildInputs(tick, inCooldown);
                    var state = RpfStateMachine.Evaluate(inputs);

                    HandleSuggestion(symbol, state, tick, cfg, now);
                    _store.SetState(symbol, state);

                    // Heartbeat: se emite cada tick (no solo en cambio) para que el tablero sepa que
                    // el loop vive. Sin esto, un estado DORMANT que coincide con el default del store
                    // nunca se emitiría y el front quedaría en "loop offline" con el loop corriendo.
                    await _broadcaster.BroadcastRpfStateAsync(symbol, BuildStateUpdate(symbol, state, tick, inputs, now));
                }
                catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
                catch (Exception ex)
                {
                    // La cascada falló (ej. sin datos de mercado, o la integración cascada-sobre-RPF-JSON).
                    // Se emite igual un estado para que el tablero muestre LOOP ONLINE y el símbolo en
                    // DORMANT con nota de error, en vez de un silencio indistinguible de "loop apagado".
                    _logger.LogError(ex, "RpfLoop: fallo evaluando {Symbol}; emito estado de error", symbol);
                    _store.SetState(symbol, RpfState.Dormant);
                    await _broadcaster.BroadcastRpfStateAsync(symbol, new RpfStateUpdate
                    {
                        Symbol = symbol,
                        State = RpfState.Dormant.ToWire(),
                        CascadeOk = false,
                        CapacityAvailable = false,
                        CooldownRemainingSec = _store.CooldownRemainingSec(symbol, now),
                        Timestamp = now,
                    });
                }
            }
        }

        /// <summary>
        /// Mapea la respuesta de la cascada a los inputs de la máquina de estados.
        /// Short-circuit: si el macro corta, PositionBuilder viene null → tail/edge no corrieron
        /// (TailScoreAvailable=false) y Tier A no pasa → DORMANT honesto (nunca VETOED sin dato).
        /// </summary>
        private static RpfStateInputs BuildInputs(RpfTickResult tick, bool inCooldown)
        {
            var gates = tick.SignalGates;
            var tail = gates?.Gates.FirstOrDefault(g => g.Id == "tail_score");
            var edge = gates?.Gates.FirstOrDefault(g => g.Id == "edge");
            var sizing = tick.RiskAndSizing;

            bool macroPass = tick.MacroRegime?.Signal is "OPERAR" or "PASS"
                             || (tick.MacroRegime is { } m && m.PassedCount == m.TotalChecks && m.TotalChecks > 0);
            bool vrpTailPass = gates != null && gates.AllPass ||
                               (gates != null && gates.FailedGate is not ("volatility_risk_premium" or "tail_score"));

            // Los gates ahora corren SIEMPRE (desacoplados del cupo). TierA exige, además del entorno,
            // que exista un candidato válido — antes era implícito porque los gates solo corrían con
            // candidato; sin este conjunto, macro+VRP+tail bastarían para un ARMED espurio sin spread.
            bool candidateValid = tick.StrikeEngine?.Signal == "OPERAR" && tick.Microstructure?.Signal == "OPERAR";
            bool tierAPass = macroPass && candidateValid && gates != null
                             && gates.FailedGate is not ("volatility_risk_premium" or "tail_score");

            bool tailAvailable = tail is { Status: not "skipped" and not "no_data" };
            int tailScore = (int)Math.Round(tail?.Value ?? 0);

            bool edgePass = edge is { Enabled: true, Status: "pass" };

            bool capacity = sizing is { PositionsAvailable: true, HeatOk: true };
            bool hasOpen = sizing is { OpenPositions: > 0 };

            return new RpfStateInputs
            {
                TailScore = tailScore,
                TailScoreAvailable = tailAvailable,
                TierAPass = tierAPass,
                EdgePass = edgePass,
                CapacityAvailable = capacity,
                HasOpenPosition = hasOpen,
                InCooldown = inCooldown,
            };
        }

        private void HandleSuggestion(string symbol, RpfState state, RpfTickResult tick, LoopConfig cfg, DateTime now)
        {
            if (state == RpfState.Triggered)
            {
                var current = _store.CurrentSuggestion(symbol);
                if (current != null && !_store.SuggestionExpired(symbol, now))
                {
                    // Refresca la vigente (mismo id) con números actuales — evita spam (§5.3).
                    var refreshed = BuildSuggestion(symbol, tick, cfg, current.Id, current.CreatedAt);
                    _store.SetSuggestion(symbol, refreshed);
                    _ = _broadcaster.BroadcastTradeSuggestionAsync(symbol, refreshed);
                }
                else
                {
                    var fresh = BuildSuggestion(symbol, tick, cfg, Guid.NewGuid().ToString(), now);
                    _store.SetSuggestion(symbol, fresh);
                    _ = _broadcaster.BroadcastTradeSuggestionAsync(symbol, fresh);
                }
            }
            else
            {
                // Dejó de disparar: si había una sugerencia vigente y venció el TTL, se descarta.
                if (_store.CurrentSuggestion(symbol) != null && _store.SuggestionExpired(symbol, now))
                    _store.ClearSuggestion(symbol, "expired");
            }
        }

        // ── Builders del contrato (payload se finaliza en activación; acá se pueblan los campos disponibles) ──

        private static TradeSuggestion BuildSuggestion(string symbol, RpfTickResult tick, LoopConfig cfg, string id, DateTime createdAt)
        {
            var se = tick.StrikeEngine;
            var edge = tick.SignalGates?.Gates.FirstOrDefault(g => g.Id == "edge");
            var sizing = tick.RiskAndSizing;
            var credit = tick.Microstructure?.CreditMinimum?.MidCredit ?? 0;
            double width = se is { ShortPutStrike: { } sp, LongPutStrike: { } lp } ? Math.Abs(sp - lp) : 5;

            double riskPct = sizing != null && sizing.NetLiq > 0 ? (double)(sizing.MaxLoss / sizing.NetLiq) : 0;

            var legs = new List<TradeSuggestionLeg>();
            if (se?.ShortPutStrike is { } shortStrike)
                legs.Add(new TradeSuggestionLeg { Action = "sell", Strike = shortStrike, Delta = se.ShortPutDelta, StreamerSymbol = se.LegSymbols?.ShortPut });
            if (se?.LongPutStrike is { } longStrike)
                legs.Add(new TradeSuggestionLeg { Action = "buy", Strike = longStrike, StreamerSymbol = se.LegSymbols?.LongPut });

            return new TradeSuggestion
            {
                Id = id,
                Symbol = symbol,
                Structure = "put_credit_spread",
                Legs = legs,
                Credit = credit,
                Width = width,
                CreditRatio = se?.CreditRatio.HasValue == true ? se.CreditRatio / 100.0 : null,
                EdgeEmp = edge?.Value,
                Bar = edge?.Threshold,
                Regime = tick.SignalGates?.Regime ?? "normal",
                DeltaShort = Math.Abs(se?.ShortPutDelta ?? 0),
                Dte = se?.DTE ?? 0,
                RiskPerTradePct = riskPct,
                HighRisk = riskPct > 0.05,
                Contracts = sizing?.Contracts ?? 0,
                State = "TRIGGERED",
                CreatedAt = createdAt,
                TtlSeconds = cfg.TickBSeconds * 2,
            };
        }

        private RpfStateUpdate BuildStateUpdate(string symbol, RpfState state, RpfTickResult tick, RpfStateInputs inp, DateTime now)
        {
            var edge = tick.SignalGates?.Gates.FirstOrDefault(g => g.Id == "edge");
            var sizing = tick.RiskAndSizing;

            return new RpfStateUpdate
            {
                Symbol = symbol,
                State = state.ToWire(),
                Edge = edge?.Value,
                Bar = edge?.Threshold,
                // Régimen que eligió la barra del edge. Solo presente si el macro pasó (los signal
                // gates corrieron); si la cascada cortó en macro, viene null y el tablero cae a la
                // etiqueta genérica — coherente con el eje DISPARA atenuado en ese caso.
                Regime = tick.SignalGates?.Regime,
                CapacityAvailable = inp.CapacityAvailable,
                OpenPositions = sizing?.OpenPositions ?? 0,
                MaxPositions = sizing?.MaxPositions ?? 0,
                HeatPct = sizing != null ? sizing.CurrentHeatPct : null,
                CooldownRemainingSec = _store.CooldownRemainingSec(symbol, now),
                SuggestionId = state == RpfState.Triggered ? _store.CurrentSuggestion(symbol)?.Id : null,

                MacroPassed = tick.MacroRegime?.PassedCount ?? 0,
                MacroTotal = tick.MacroRegime?.TotalChecks ?? 0,
                MacroChecks = MapMacroChecks(tick.MacroRegime),
                Gates = MapGates(tick.SignalGates),
                Candidate = BuildCandidate(tick, edge),

                CascadeOk = true,
                DiedAtLayer = tick.FailedAtLayer,
                Timestamp = now,
            };
        }

        // Eje ARMA — macro_regime. Los 4 checks de RPF (sin iv_rank/spot_vs_zgl) con etiqueta legible.
        // Se computan dentro de Layer 1 aun si el macro falla, así que la fila muestra el valor igual.
        private static List<RpfCheck> MapMacroChecks(MacroRegimeResult? macro)
        {
            var list = new List<RpfCheck>();
            if (macro?.Checks is not { } c) return list;

            void Add(string id, string label, bool? passed, double? value, double? threshold, string? detail = null)
            {
                if (passed == null) return; // check no presente en el JSON de RPF
                list.Add(new RpfCheck { Id = id, Label = label, Status = passed.Value ? "pass" : "fail", Value = value, Threshold = threshold, Detail = detail });
            }

            Add("vix_absolute", "VIX bajo control", c.VixAbsolute?.Passed, c.VixAbsolute?.Value, c.VixAbsolute?.Threshold);
            Add("vix_term_structure", "Estructura VIX en calma", c.VixTermStructure?.Passed, c.VixTermStructure?.Iv9d, c.VixTermStructure?.Iv30d,
                c.VixTermStructure != null ? $"9d {c.VixTermStructure.Iv9d:0.0} vs 30d {c.VixTermStructure.Iv30d:0.0}" : null);
            Add("iv_momentum", "Momentum de vol frenado", c.IVMomentum?.Passed, c.IVMomentum?.Value, c.IVMomentum?.Threshold);
            Add("gex_total", "Dealers amortiguan (GEX≥0)", c.GexTotal?.Passed, c.GexTotal?.Value, c.GexTotal?.Threshold);
            return list;
        }

        // Eje ARMA — gates de señal (VRP, cola) + eje DISPARA (edge, crédito, muro). Solo corren si el
        // macro pasó (cascada cortocircuitante); si no, la lista viene vacía → el tablero los marca "no evaluado".
        private static List<RpfCheck> MapGates(SignalGatesResult? gates)
        {
            var list = new List<RpfCheck>();
            if (gates == null) return list;
            foreach (var g in gates.Gates)
            {
                if (!g.Enabled) continue;
                list.Add(new RpfCheck { Id = g.Id, Label = g.Label, Status = g.Status, Value = g.Value, Threshold = g.Threshold, Detail = g.Detail });
            }
            return list;
        }

        // Eje DISPARA — el PCS candidato. El motor RPF produce UN solo strikeEngine (con legs), poblado
        // siempre (aun DORMANT) — decisión candidato-siempre, ahora coherente para estado y display.
        private static RpfCandidate? BuildCandidate(RpfTickResult tick, GateResult? edge)
        {
            var se = tick.StrikeEngine;
            if (se?.ShortPutStrike is not { } shortStrike) return null;

            double? credit = tick.Microstructure?.CreditMinimum?.MidCredit;
            double? width = se.LongPutStrike is { } lp ? Math.Abs(shortStrike - lp) : 5;

            return new RpfCandidate
            {
                ShortPutStrike = shortStrike,
                LongPutStrike = se.LongPutStrike,
                ShortPutDelta = se.ShortPutDelta,
                Dte = se.DTE,
                Expiration = se.Expiration,
                Credit = credit,
                Width = width,
                CreditRatio = se.CreditRatio.HasValue ? se.CreditRatio / 100.0 : null,
                Pop = se.Pop,
                PutWall = se.PutWall,
                Edge = edge?.Value,
                Bar = edge?.Threshold,
                FromCascade = tick.FailedAtLayer != 1, // macro no cortó → candidato validado por el entorno
                // Legs DXLink + OI/cierre previo del mismo motor que armó los strikes: el tablero
                // suscribe estas patas para primas en vivo del candidato REAL de RPF (no del PositionBuilder).
                LegSymbols = se.LegSymbols,
                LegMeta = se.LegMeta,
            };
        }
    }
}

using System;
using System.IO;
using System.Linq;
using System.Text.Json.Nodes;
using DataFeed.Application.App.SignalGates;
using DataFeed.Application.App.ValidationLayer;
using Xunit;

namespace DataFeed.Tests;

/// <summary>
/// Fase 4 de la alineacion de RPF ("Disparo por prima real"): test de consistencia
/// doc &lt;-&gt; JSON &lt;-&gt; codigo sobre galecore_rules_rpf.json.
///
/// Congela los invariantes de la config de referencia (BT-17 variante C + capa gamma:
/// PCS-only, SPY-only, delta 0.25, GEX&gt;=0, VRP 1.2, barras edge, sin iv_rank, paper_only)
/// y verifica que el JSON de RPF es LEIDO por el codigo ya existente (SignalGatesEvaluator,
/// ClassifyRegime, PopCalibrationTable) sin cambios — la premisa de la Decision de Fork A.
///
/// Fuente de verdad de los valores: docs/rpf/galecore-rpf-reconciliacion.md.
/// </summary>
public class RpfRulesJsonTests
{
    private static string FilesDir()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            var candidate = Path.Combine(dir.FullName, "DataFeed.Api", "Files");
            if (Directory.Exists(candidate)) return candidate;
            dir = dir.Parent;
        }
        throw new DirectoryNotFoundException("No se encontro DataFeed.Api/Files subiendo desde " + AppContext.BaseDirectory);
    }

    private static JsonObject Load(string file)
        => JsonNode.Parse(File.ReadAllText(Path.Combine(FilesDir(), file)))!.AsObject();

    private static JsonObject Rpf() => Load("galecore_rules_rpf.json");
    private static JsonObject Core() => Load("galecore_rules_core.json");

    private static JsonObject StrikeEngine(JsonObject rules)
        => rules["position_builder"]!["layers"]!.AsArray()
            .First(l => (string?)l!["name"] == "strike_engine")!["config"]!.AsObject();

    private static JsonObject RiskAndSizing(JsonObject rules)
        => rules["position_builder"]!["layers"]!.AsArray()
            .First(l => (string?)l!["name"] == "risk_and_sizing")!["config"]!.AsObject();

    // ── Invariantes de identidad de la estrategia ──

    [Fact]
    public void Rpf_EsPcsOnly_SpyOnly_Paper()
    {
        var r = Rpf();
        var meta = r["_meta"]!.AsObject();
        Assert.Equal("paper_only", (string?)meta["status"]);
        Assert.False((bool)meta["enabled_for_live"]!);

        Assert.Equal(new[] { "SPY" }, r["universe"]!["tickers"]!.AsArray().Select(x => (string?)x));

        var scope = r["strategy_scope"]!.AsObject();
        Assert.Equal(new[] { "put_credit_spread" }, scope["allowed_strategies"]!.AsArray().Select(x => (string?)x));
        var forbidden = scope["forbidden_strategies"]!.AsArray().Select(x => (string?)x).ToHashSet();
        Assert.Contains("iron_condor", forbidden);
        Assert.Contains("call_credit_spread", forbidden);
    }

    [Fact]
    public void Rpf_MacroRegime_SinIvRank_ConGexTotal()
    {
        var checks = Rpf()["macro_regime"]!["checks"]!.AsArray().Select(c => (string?)c!["id"]).ToList();
        Assert.DoesNotContain("iv_rank", checks);   // Fork B: removido
        Assert.Contains("gex_total", checks);        // GEX>=0 vive aca, no en signal_gates
        Assert.Contains("vix_absolute", checks);
    }

    [Fact]
    public void Rpf_GexThreshold_EsCero()
    {
        var gt = Rpf()["definitions"]!["gex_threshold_by_symbol"]!["values"]!.AsObject();
        Assert.Equal(0d, (double)gt["SPY"]!);
    }

    // ── Consistencia con el core (la alineacion doc<->JSON<->codigo de Fase 4) ──

    [Fact]
    public void Rpf_SignalGates_ValoresNumericosCoincidenConCore()
    {
        var rg = Rpf()["signal_gates"]!["gates"]!.AsObject();
        var cg = Core()["signal_gates"]!["gates"]!.AsObject();

        Assert.Equal((double)cg["volatility_risk_premium"]!["min"]!, (double)rg["volatility_risk_premium"]!["min"]!);
        Assert.Equal(1.2d, (double)rg["volatility_risk_premium"]!["min"]!);

        foreach (var regime in new[] { "low_vol", "normal", "elevated", "caution" })
            Assert.Equal((double)cg["edge"]!["bars_by_regime"]![regime]!, (double)rg["edge"]!["bars_by_regime"]![regime]!);

        Assert.Equal((double)cg["credit_minimum"]!["min_usd"]!, (double)rg["credit_minimum"]!["min_usd"]!);
        Assert.Equal((double)cg["credit_minimum"]!["min_ratio_of_width"]!, (double)rg["credit_minimum"]!["min_ratio_of_width"]!);

        foreach (var comp in new[] { "vvix", "skew25_roc5d" })
            foreach (var lvl in new[] { "warn", "block" })
                Assert.Equal((double)cg["tail_score"]!["components"]![comp]![lvl]!,
                             (double)rg["tail_score"]!["components"]![comp]![lvl]!);
    }

    // ── Reuse de codigo: el JSON de RPF lo leen los evaluadores existentes (Fork A) ──

    [Fact]
    public void Rpf_SignalGates_LosLeeElEvaluadorExistente()
    {
        // El nodo signal_gates del JSON de RPF pasa directo a SignalGatesEvaluator.
        var signalGates = Rpf()["signal_gates"];
        var pop = PopCalibrationTable.Parse(File.ReadAllText(Path.Combine(FilesDir(), "pop_calibration.json")));

        // Setup bueno tipico: VRP 1.5, tail 0, short bajo el muro, credito rico, delta 0.25.
        var good = new SignalGatesInputs
        {
            Symbol = "SPY",
            AtmIv30 = 18.0, RealizedVol30 = 12.0,
            Vvix = 95, Skew25Roc5d = 0.01,
            ShortPutStrike = 690, PutWall = 700,
            Credit = 0.90, SpreadWidth = 5,
            ShortPutDeltaAbs = 0.25, Regime = "normal",
        };
        var okr = SignalGatesEvaluator.Evaluate(signalGates, good, pop);
        Assert.True(okr.AllPass, $"gate fallido inesperado: {okr.FailedGate}");

        // VRP por debajo del minimo desarma la senal (gate load-bearing).
        var lowVrp = good; lowVrp.RealizedVol30 = 18.0; // VRP 1.0 < 1.2
        var failr = SignalGatesEvaluator.Evaluate(signalGates, lowVrp, pop);
        Assert.False(failr.AllPass);
        Assert.Equal("volatility_risk_premium", failr.FailedGate);
    }

    [Theory]
    [InlineData(12, "low_vol")]
    [InlineData(18, "normal")]
    [InlineData(27, "elevated")]
    [InlineData(35, "caution")]
    public void Rpf_RegimeClassification_LaMapeaElClasificadorExistente(double iv, string esperado)
    {
        var rc = Rpf()["definitions"]!["regime_classification"];
        Assert.Equal(esperado, ValidationLayerHandler.ClassifyRegime(rc, iv));
    }

    [Fact]
    public void Rpf_PopCalibration_ServedFileParseaYDaPLoss()
    {
        var pop = PopCalibrationTable.Parse(File.ReadAllText(Path.Combine(FilesDir(), "pop_calibration.json")));
        double? p = pop.PLoss("SPY", 0.25);
        Assert.NotNull(p);
        Assert.InRange(p!.Value, 0.10, 0.20); // delta 0.25 -> ITM real ~14% (BT-1: el delta sobrestima el put)
    }

    // ── Config de referencia: strike engine, riesgo, gestion ──

    [Fact]
    public void Rpf_StrikeEngine_Delta025_Ancho5_PcsForzado()
    {
        var se = StrikeEngine(Rpf());
        Assert.Equal(0.25d, (double)se["delta_target"]!["put_short"]!);
        Assert.Equal(5d, (double)se["spread_width"]!["symbol_overrides"]!["SPY"]!["default"]!);

        var structSel = se["structure_selection"]!.AsObject();
        Assert.False((bool)structSel["enabled"]!);
        Assert.Equal("put_credit_spread", (string?)structSel["forced_structure_while_disabled"]);
    }

    [Fact]
    public void Rpf_Riesgo_V2_DosPosiciones_Heat7()
    {
        var rs = RiskAndSizing(Rpf());
        Assert.Equal(2, (int)rs["max_positions"]!);
        Assert.Equal("V2", (string?)rs["portfolio_variant"]);
        Assert.Equal(0.07d, (double)rs["max_heat_pct_net_liq"]!);
        Assert.Equal(16000d, (double)rs["capital"]!["base_reference_usd"]!);
    }

    [Fact]
    public void Rpf_Gestion_HardDefense042_SinSalidaForzadaDte()
    {
        var tm = Rpf()["trade_management"]!.AsObject();
        Assert.Equal(0.5d, (double)tm["take_profit"]!["pct_of_initial_credit"]!);
        Assert.Equal(0.42d, (double)tm["hard_defense"]!["trigger_any"]!["short_leg_delta_abs_gt"]!);
        Assert.False((bool)tm["time_exit"]!["enabled"]!); // BT-4 refuto la salida a 21 DTE
    }

    [Fact]
    public void Rpf_OrquestacionNoImplementada_EnabledFalse()
    {
        var r = Rpf();
        Assert.False((bool)r["state_machine"]!["enabled"]!);   // Fase 5
        Assert.False((bool)r["trade_suggestion"]!["enabled"]!); // Fase 5
    }

    [Fact]
    public void Rpf_Parsea() => Assert.NotNull(Rpf());
}

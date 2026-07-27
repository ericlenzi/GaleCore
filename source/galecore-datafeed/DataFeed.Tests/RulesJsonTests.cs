using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json.Nodes;
using Xunit;

namespace DataFeed.Tests;

/// <summary>
/// Regresion sobre los JSON de reglas servidos por AppController (galecore_rules_{core,live,paper}.json).
/// Congela los invariantes de la estrategia v1.4.0 PCS-only y valida que los overlays solo overrideen
/// paths que existen en el core (el DeepMerge de AppController reemplaza arrays/escalares enteros, por
/// eso un override en un path inexistente es un "override huerfano" que no hace nada — bug silencioso).
/// </summary>
public class RulesJsonTests
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

    private static JsonObject FindLayer(JsonObject core, string name)
    {
        foreach (var l in core["position_builder"]!["layers"]!.AsArray())
            if ((string?)l!["name"] == name) return l.AsObject();
        throw new Xunit.Sdk.XunitException($"No se encontro el layer '{name}' en position_builder.layers");
    }

    // Espejo fiel del DeepMerge de AppController.LoadMergedRulesJsonAsync.
    private static void DeepMerge(JsonObject target, JsonObject source)
    {
        foreach (var prop in source)
        {
            if (prop.Value is JsonObject sObj && target[prop.Key] is JsonObject tObj)
                DeepMerge(tObj, sObj);
            else
                target[prop.Key] = prop.Value?.DeepClone();
        }
    }

    [Fact]
    public void CoreEsPcsOnlyPaperV140()
    {
        var core = Load("galecore_rules_core.json");
        var meta = core["_meta"]!.AsObject();
        Assert.Equal("1.4.0", (string?)meta["version"]);
        Assert.Equal("paper_only", (string?)meta["status"]);
        Assert.False((bool)meta["enabled_for_live"]!);

        // PCS-only: el enforcement REAL vive en el layer strike_engine (no en strategy_scope, que
        // es solo descriptivo). structure_selection apagado + estructura forzada a put_credit_spread.
        var strikeEngine = FindLayer(core, "strike_engine");
        var structSel = strikeEngine["config"]!["structure_selection"]!.AsObject();
        Assert.False((bool)structSel["enabled"]!);
        Assert.Equal("put_credit_spread", (string?)structSel["forced_structure_while_disabled"]);

        // El embudo de gates existe con sus 5 gates load-bearing.
        var gates = core["signal_gates"]!["gates"]!.AsObject();
        foreach (var g in new[] { "tail_score", "volatility_risk_premium", "gamma_support" })
            Assert.True(gates.ContainsKey(g), $"Falta el gate '{g}' en signal_gates.gates");
    }

    [Theory]
    [InlineData("galecore_rules_live.json")]
    [InlineData("galecore_rules_paper.json")]
    public void LosTresJsonParsean(string file) => Assert.NotNull(Load(file));

    [Theory]
    [InlineData("live")]
    [InlineData("paper")]
    public void OverlayNoTieneOverridesHuerfanos(string profile)
    {
        var core = Load("galecore_rules_core.json");
        var overlay = Load($"galecore_rules_{profile}.json");

        // Adiciones intencionales permitidas (no existen en core a proposito).
        var allow = new HashSet<string>
        {
            "monitoring.store_intraday_decision_log",
            "monitoring.store_fill_simulation_details",
        };

        var orphans = new List<string>();
        CollectAdditions(core, overlay, "", orphans, allow);
        Assert.True(orphans.Count == 0,
            $"Overlay '{profile}' tiene overrides huerfanos (paths que no existen en core): {string.Join(", ", orphans)}");
    }

    [Theory]
    [InlineData("live")]
    [InlineData("paper")]
    public void MergePreservaLosTresLayers(string profile)
    {
        var core = Load("galecore_rules_core.json");
        var overlay = Load($"galecore_rules_{profile}.json");
        DeepMerge(core, overlay);
        var layers = core["position_builder"]!["layers"]!.AsArray();
        Assert.Equal(3, layers.Count); // strike_engine, microstructure, risk_and_sizing
    }

    private static void CollectAdditions(JsonObject core, JsonObject overlay, string path,
        List<string> orphans, HashSet<string> allow)
    {
        foreach (var prop in overlay)
        {
            var p = string.IsNullOrEmpty(path) ? prop.Key : $"{path}.{prop.Key}";
            if (p.StartsWith("_meta")) continue; // _meta del overlay es libre por diseno.

            if (!core.ContainsKey(prop.Key))
            {
                if (!allow.Contains(p)) orphans.Add(p);
            }
            else if (prop.Value is JsonObject oObj && core[prop.Key] is JsonObject cObj)
            {
                CollectAdditions(cObj, oObj, p, orphans, allow);
            }
        }
    }
}

using System;
using System.IO;
using System.Linq;
using System.Text.Json.Nodes;
using Xunit;

namespace DataFeed.Tests;

/// <summary>
/// Congela los invariantes de galecore_rules_gex.json (estrategia GEX, informativa).
///
/// El JSON no es documentacion: GexAnalysisHandler lee `gex.*` para configurar el barrido de la
/// cadena, y ValidationLayerHandler.EvaluateLayer1 lee `macro_regime.checks[].threshold` +
/// `definitions.gex_threshold_by_symbol` + `definitions.zgl_with_buffer` para armar los 6 checks
/// del cuadro Details. Un path que se renombre o se caiga no rompe el build: falla en runtime con
/// el valor por defecto, en silencio. Estos tests son la red.
/// </summary>
public class GexRulesJsonTests
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

    // GEX vive en su subcarpeta, por la regla "archivos por estrategia en Files/<Prefix>/".
    private static JsonObject Gex()
        => JsonNode.Parse(File.ReadAllText(Path.Combine(FilesDir(), "Gex", "galecore_rules_gex.json")))!.AsObject();

    [Fact]
    public void Gex_EsInformativa_YNoHabilitaOperar()
    {
        var meta = Gex()["_meta"]!.AsObject();
        Assert.Equal("gex_gamma_exposure", (string?)meta["strategy"]);
        Assert.Equal("informational", (string?)meta["status"]);
        Assert.False((bool)meta["enabled_for_live"]!);

        // Ninguna estructura permitida: la estrategia no propone operaciones.
        Assert.Empty(Gex()["strategy_scope"]!["allowed_strategies"]!.AsArray());
    }

    [Fact]
    public void Universo_EsSpyYQqq()
    {
        var tickers = Gex()["universe"]!["tickers"]!.AsArray()
            .Select(t => (string?)t).ToArray();
        Assert.Equal(new[] { "SPY", "QQQ" }, tickers);
    }

    /// <summary>
    /// Contrato con GexAnalysisHandler.ReadScanConfig: si alguno de estos paths desaparece, el
    /// handler cae a sus defaults y el barrido deja de responder al JSON sin que nadie se entere.
    /// </summary>
    [Fact]
    public void NodoGex_DeclaraElAlcanceDelBarrido()
    {
        var gex = Gex()["gex"]!.AsObject();

        Assert.True((int)gex["max_dte"]! > 0);
        Assert.True((bool)gex["include_zero_dte"]!, "La estrategia GEX debe incluir 0DTE.");

        var types = gex["expiration_types"]!.AsArray().Select(t => (string?)t).ToArray();
        Assert.Contains("Regular", types);
        Assert.Contains("Weekly", types);

        var band = gex["oi_delta_band"]!.AsArray();
        Assert.Equal(2, band.Count);
        Assert.True((double)band[0]! < (double)band[1]!);

        Assert.True((int)gex["greeks_batch_size"]! > 0, "Sin batching, la cadena completa hace timeout en DXLink.");
        Assert.True((int)gex["cache_seconds"]! > 0);

        // Sin reintentos, un lote que agota el timeout deja vencimientos enteros sin Greeks y el
        // netGEX global cambia entre corridas (medido 2026-08-05: 271B/12 vtos vs 696B/16 vtos).
        Assert.True((int)gex["greeks_retries"]! > 0, "El barrido global necesita reintentos para ser determinista.");

        // Un barrido incompleto no debe quedar cacheado: el tablero mostraria un GEX al que le
        // faltan vencimientos como si fuera el numero real.
        double minCov = (double)gex["cache_min_coverage_pct"]!;
        Assert.InRange(minCov, 90, 100);

        // El cache tiene que durar mas que un barrido (100-250s medidos), o cada refresco arranca
        // uno nuevo encima del anterior.
        Assert.True((int)gex["cache_seconds"]! >= 300);
    }

    /// <summary>
    /// Contrato con ValidationLayerHandler.EvaluateLayer1: los 6 checks que renderiza el cuadro
    /// Details y los dos nodos de definitions de los que salen sus umbrales.
    /// </summary>
    [Fact]
    public void MacroRegime_TieneLos6ChecksQueLeeElHandler()
    {
        var rules = Gex();
        var ids = rules["macro_regime"]!["checks"]!.AsArray()
            .Select(c => (string?)c!["id"]).ToArray();

        foreach (var id in new[] { "vix_absolute", "vix_term_structure", "iv_rank", "iv_momentum", "gex_total", "spot_vs_zgl" })
            Assert.Contains(id, ids);

        var checks = rules["macro_regime"]!["checks"]!.AsArray();
        JsonNode Check(string id) => checks.First(c => (string?)c!["id"] == id)!;

        Assert.True((double)Check("vix_absolute")["threshold"]!["value"]! > 0);
        Assert.True((double)Check("iv_rank")["threshold"]!["min"]! < (double)Check("iv_rank")["threshold"]!["max"]!);
        Assert.True((double)Check("iv_momentum")["threshold"]!["value"]! > 0);

        var defs = rules["definitions"]!.AsObject();
        var gexThresholds = defs["gex_threshold_by_symbol"]!["values"]!.AsObject();
        Assert.True(gexThresholds.ContainsKey("SPY"));
        Assert.True(gexThresholds.ContainsKey("QQQ"));
        Assert.True((double)defs["zgl_with_buffer"]!["buffer_pct"]! > 0);
    }

    /// <summary>
    /// El Diagnostico de mercado interpreta el z-score con estos dos umbrales, que el handler busca
    /// en position_builder.layers[id=2].config.structure_selection.thresholds (via GetPositionBuilderLayer).
    /// </summary>
    [Fact]
    public void Layer2_DeclaraLosUmbralesDelZScore()
    {
        var layer2 = Gex()["position_builder"]!["layers"]!.AsArray()
            .First(l => (int?)l!["id"] == 2)!;
        var thresholds = layer2["config"]!["structure_selection"]!["thresholds"]!;

        double neutral = (double)thresholds["neutral_z"]!;
        double extreme = (double)thresholds["extreme_z"]!;
        Assert.True(neutral > 0 && extreme > neutral);
    }

    /// <summary>
    /// La pestana GEX renderiza lo que declara display_config.gex_tab: sin este nodo el frontend
    /// se queda sin contrato (velas 1h x100, sin microstructure, sin setup candidato).
    /// </summary>
    [Fact]
    public void DisplayConfig_DeclaraElContratoDeLaPestana()
    {
        var tab = Gex()["display_config"]!["gex_tab"]!.AsObject();

        // El auto-refresh no puede ser mas corto que el cache del backend: pediria de nuevo mientras
        // el barrido anterior sigue corriendo.
        var gexNode = Gex()["gex"]!;
        Assert.True((int)tab["refresh_seconds"]! >= (int)gexNode["cache_seconds"]!);
        Assert.Equal("1h", (string?)tab["candles"]!["interval"]);
        Assert.Equal(100, (int)tab["candles"]!["count"]!);

        var details = tab["details_panel"]!.AsObject();
        Assert.False((bool)details["microstructure"]!, "Microstructure se elimino del cuadro Details de GEX.");
        Assert.Equal("global", (string?)details["gex_scope"]);

        var hidden = tab["hidden_blocks"]!.AsArray().Select(h => (string?)h).ToArray();
        Assert.Contains("setup_candidato", hidden);

        // El Expiry Engine es el Strike Engine sin las filas de estructura.
        var rowIds = tab["expiry_engine"]!["rows"]!.AsArray().Select(r => (string?)r!["id"]).ToArray();
        foreach (var id in new[] { "zgl", "call_wall", "put_wall", "expected_move" })
            Assert.Contains(id, rowIds);
        foreach (var forbidden in new[] { "structure", "short_put", "short_call", "strikes_inside_walls" })
            Assert.DoesNotContain(forbidden, rowIds);
    }
}

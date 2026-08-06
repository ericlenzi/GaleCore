using System.Text.Json.Nodes;

namespace DataFeed.Api.Infrastructure
{
    /// <summary>
    /// Switch manual de GEX (regla "switch Workers por estrategia" de CLAUDE.md).
    ///
    /// GEX no corre un BackgroundService: lo que apaga este switch es el barrido de la cadena.
    /// En OFF, /App/Gex/Analysis no toca DXLink ni siquiera a pedido — devuelve lo último que
    /// quedó en cache, marcado como congelado. Es un kill switch para que la estrategia deje de
    /// competir por el feed con RPF o con Main.
    ///
    /// El estado vive en Files/Gex/gex_workers_state.json, NO en galecore_rules_gex.json: el JSON de
    /// reglas es fuente de verdad y se edita deliberadamente, no en runtime. El archivo de estado
    /// es un override sobre lo que el JSON declara en gex.enabled.
    ///
    /// Persiste a disco a propósito: un kill switch que vuelve solo a ON después de un restart o un
    /// crash es un agujero de seguridad. Si el archivo no existe, manda el JSON de reglas.
    /// </summary>
    public class GexWorkerSwitch
    {
        private readonly IWebHostEnvironment _env;
        private readonly ILogger<GexWorkerSwitch> _logger;
        private static readonly object _fileLock = new();

        // Archivo propio de GEX bajo Files/Gex/ (regla "archivos por estrategia" de CLAUDE.md).
        private const string StateFile = "Gex/gex_workers_state.json";

        public GexWorkerSwitch(IWebHostEnvironment env, ILogger<GexWorkerSwitch> logger)
        {
            _env = env;
            _logger = logger;
        }

        private string Path_ => Path.Combine(_env.ContentRootPath, "Files", StateFile);

        /// <summary>Override del operador, o null si nunca se tocó el switch (manda el JSON de reglas).</summary>
        public bool? ReadOverride()
        {
            lock (_fileLock)
            {
                try
                {
                    if (!File.Exists(Path_)) return null;
                    var root = JsonNode.Parse(File.ReadAllText(Path_))?.AsObject();
                    return (bool?)root?["enabled"];
                }
                catch
                {
                    // Archivo corrupto: se ignora el override en vez de dejar la estrategia inservible.
                    return null;
                }
            }
        }

        public void Set(bool enabled)
        {
            lock (_fileLock)
            {
                var root = new JsonObject
                {
                    ["enabled"] = enabled,
                    ["updatedAt"] = DateTime.UtcNow.ToString("o"),
                };
                Directory.CreateDirectory(System.IO.Path.GetDirectoryName(Path_)!);
                File.WriteAllText(Path_, root.ToJsonString(new System.Text.Json.JsonSerializerOptions { WriteIndented = true }));
            }
            _logger.LogInformation("GEX Workers switch → {State}", enabled ? "ON" : "OFF");
        }
    }
}

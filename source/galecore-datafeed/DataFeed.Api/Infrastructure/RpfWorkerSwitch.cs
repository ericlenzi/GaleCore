using System.Text.Json.Nodes;

namespace DataFeed.Api.Infrastructure
{
    /// <summary>
    /// Switch manual de los workers de RPF (regla "switch Workers por estrategia" de CLAUDE.md).
    /// Permite al operador cortar el loop en el acto desde el front, sin reiniciar la API.
    ///
    /// El estado vive en Files/Rpf/rpf_workers_state.json, NO en galecore_rules_rpf.json: el JSON de
    /// reglas es fuente de verdad y se edita deliberadamente, no en runtime. El archivo de estado
    /// es un override sobre lo que el JSON declara en state_machine.enabled.
    ///
    /// Persiste a disco a propósito: un kill switch que vuelve solo a ON después de un restart o un
    /// crash es un agujero de seguridad. Si el archivo no existe, manda el JSON de reglas.
    /// </summary>
    public class RpfWorkerSwitch
    {
        private readonly IWebHostEnvironment _env;
        private readonly ILogger<RpfWorkerSwitch> _logger;
        private static readonly object _fileLock = new();

        // Archivos propios de RPF bajo Files/Rpf/ (regla "archivos por estrategia" de CLAUDE.md).
        private const string StateFile = "Rpf/rpf_workers_state.json";

        public RpfWorkerSwitch(IWebHostEnvironment env, ILogger<RpfWorkerSwitch> logger)
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
                    // Archivo corrupto: se ignora el override en vez de tumbar el loop.
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
            _logger.LogInformation("RPF Workers switch → {State}", enabled ? "ON" : "OFF");
        }
    }
}

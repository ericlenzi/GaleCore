using MediatR;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc;
using System.IO;
using System.Threading.Tasks;
using DataFeed.Application.App.GammaExposure;
using DataFeed.Application.App.Gex;
using DataFeed.Application.App.ImpliedVolatility;
using DataFeed.Application.App.IVRank;
using DataFeed.Application.App.PutSkew;

namespace DataFeed.Controllers
{
    [ApiController]
    [Route("[controller]")]
    public class AppController : DataFeedControllerBase
    {
        private readonly IWebHostEnvironment _env;
        private readonly DataFeed.Api.Infrastructure.RpfWorkerSwitch _rpfWorkerSwitch;
        private readonly DataFeed.Api.Infrastructure.GexWorkerSwitch _gexWorkerSwitch;
        private readonly DataFeed.Application.App.Rpf.RpfStateStore _rpfStore;
        private readonly DataFeed.Infrastructure.Providers.Tastytrade.IMarketDataBroadcaster _broadcaster;

        public AppController(IMediator mediator, IWebHostEnvironment env,
            DataFeed.Api.Infrastructure.RpfWorkerSwitch rpfWorkerSwitch,
            DataFeed.Api.Infrastructure.GexWorkerSwitch gexWorkerSwitch,
            DataFeed.Application.App.Rpf.RpfStateStore rpfStore,
            DataFeed.Infrastructure.Providers.Tastytrade.IMarketDataBroadcaster broadcaster)
            : base(mediator)
        {
            _env = env;
            _rpfWorkerSwitch = rpfWorkerSwitch;
            _gexWorkerSwitch = gexWorkerSwitch;
            _rpfStore = rpfStore;
            _broadcaster = broadcaster;
        }

        #region Analytics

        [Tags("App.Analytics")]
        [HttpGet("/App.Analytics/GammaExposure")]
        public async Task<IActionResult> GammaExposureAsync([FromQuery] GammaExposureRequest request) => await Handle(request);

        [Tags("App.Analytics")]
        [HttpGet("/App.Analytics/IVRank")]
        public async Task<IActionResult> IVRankAsync([FromQuery] IVRankRequest request) => await Handle(request);

        [Tags("App.Analytics")]
        [HttpGet("/App.Analytics/ImpliedVolatility")]
        public async Task<IActionResult> ImpliedVolatilityAsync([FromQuery] ImpliedVolatilityRequest request) => await Handle(request);

        [Tags("App.Analytics")]
        [HttpGet("/App.Analytics/PutSkew")]
        public async Task<IActionResult> PutSkewAsync([FromQuery] PutSkewRequest request) => await Handle(request);

        #endregion

        #region GaleCore

        // Config de la APLICACION, no de una estrategia: universo de streaming, lista de estrategias
        // implementadas y config de la pestaña Monitor. Cada estrategia sirve sus reglas por su
        // propio prefijo (/App/Rpf/Rules, /App/Gex/Rules).

        /// <summary>
        /// Configuración de la aplicación (`Files/galecore_rules_core.json`, servido tal cual).
        /// De acá salen el universo que el front streamea, las cards de estrategias de Main y los
        /// umbrales de gestión de la pestaña Monitor.
        /// </summary>
        [Tags("App.GaleCore")]
        [HttpGet("GaleCore/Rules/Core")]
        public async Task<IActionResult> RulesCoreAsync()
            => await ServeRulesFileAsync("galecore_rules_core.json");

        #endregion

        #region Rpf

        // Convención: cada estrategia cuelga de su propio prefijo de primer nivel — RPF de /App/Rpf.
        // Los endpoints existentes bajo /App/GaleCore quedan como están hasta que se revisen.
        // RPF no usa overlays (live/paper) — su JSON se sirve tal cual, sin DeepMerge.

        [Tags("App.Rpf")]
        [HttpGet("Rpf/Rules")]
        public async Task<IActionResult> RpfRulesAsync()
            => await ServeRulesFileAsync("Rpf/galecore_rules_rpf.json");

        /// <summary>
        /// Estado del switch de workers de RPF. `source` dice quién manda: "override" si el operador
        /// ya usó el switch, "rules" si todavía manda state_machine.enabled del JSON.
        /// </summary>
        [Tags("App.Rpf")]
        [HttpGet("Rpf/Workers")]
        public async Task<IActionResult> RpfWorkersGetAsync()
        {
            var ovr = _rpfWorkerSwitch.ReadOverride();
            return Ok(new
            {
                enabled = ovr ?? await ReadRpfRulesEnabledAsync(),
                source = ovr.HasValue ? "override" : "rules",
            });
        }

        /// <summary>
        /// Prende o apaga los workers de RPF. Escribe un archivo de estado aparte — no toca
        /// galecore_rules_rpf.json. `RpfLoopService` lo relee en cada tick.
        /// </summary>
        [Tags("App.Rpf")]
        [HttpPost("Rpf/Workers")]
        public async Task<IActionResult> RpfWorkersSetAsync([FromBody] RpfWorkersRequest body)
        {
            _rpfWorkerSwitch.Set(body.Enabled);

            // Al apagar, el estado en memoria se descarta: con el loop inerte nadie lo actualiza, y un
            // tablero que se conecte después vería datos viejos como si fueran vigentes.
            if (!body.Enabled) _rpfStore.Clear();

            // Aviso al grupo "rpf" para que los tableros abiertos reaccionen en el acto.
            await _broadcaster.BroadcastRpfWorkersAsync(body.Enabled);

            return Ok(new { enabled = body.Enabled, source = "override" });
        }

        public class RpfWorkersRequest
        {
            public bool Enabled { get; set; }
        }

        private async Task<bool> ReadRpfRulesEnabledAsync()
        {
            var json = await LoadFileOrNullAsync("Rpf/galecore_rules_rpf.json");
            if (json == null) return false;
            var root = System.Text.Json.Nodes.JsonNode.Parse(json)?.AsObject();
            return (bool?)root?["state_machine"]?["enabled"] ?? false;
        }

        #endregion

        #region Gex

        // Estrategia GEX (informativa): gamma exposure global del símbolo, todos los vencimientos
        // de la cadena incluido 0DTE. No propone operaciones. JSON propio en Files/Gex/, sin
        // overlays live/paper → se sirve tal cual, sin DeepMerge.

        [Tags("App.Gex")]
        [HttpGet("Gex/Rules")]
        public async Task<IActionResult> GexRulesAsync()
            => await ServeRulesFileAsync("Gex/galecore_rules_gex.json");

        /// <summary>
        /// GEX global del símbolo (agregado de toda la cadena dentro de gex.max_dte, incluido 0DTE)
        /// + desglose por vencimiento + contexto de mercado. Es la fuente única de la pestaña GEX.
        /// La primera llamada del día barre la cadena entera y puede tardar; después responde del
        /// cache del handler (gex.cache_seconds).
        /// </summary>
        [Tags("App.Gex")]
        [HttpGet("Gex/Analysis")]
        public async Task<IActionResult> GexAnalysisAsync([FromQuery] GexAnalysisRequest request)
        {
            request.RulesJson = await LoadFileOrNullAsync("Gex/galecore_rules_gex.json");
            if (request.RulesJson == null)
                return NotFound("Archivo no encontrado: Gex/galecore_rules_gex.json");

            // Kill switch: en OFF el handler no barre la cadena ni toca DXLink, devuelve lo último
            // cacheado marcado como congelado.
            request.AllowScan = await GexWorkersEnabledAsync();

            return await Handle(request);
        }

        /// <summary>
        /// Estado del switch de GEX. `source` dice quién manda: "override" si el operador ya usó el
        /// switch, "rules" si todavía manda gex.enabled del JSON.
        /// </summary>
        [Tags("App.Gex")]
        [HttpGet("Gex/Workers")]
        public async Task<IActionResult> GexWorkersGetAsync()
        {
            var ovr = _gexWorkerSwitch.ReadOverride();
            return Ok(new
            {
                enabled = ovr ?? await ReadGexRulesEnabledAsync(),
                source = ovr.HasValue ? "override" : "rules",
            });
        }

        /// <summary>
        /// Prende o apaga el barrido de GEX. Escribe un archivo de estado aparte — no toca
        /// galecore_rules_gex.json. En OFF la estrategia deja de competir por el feed DXLink.
        /// </summary>
        [Tags("App.Gex")]
        [HttpPost("Gex/Workers")]
        public IActionResult GexWorkersSet([FromBody] GexWorkersRequest body)
        {
            _gexWorkerSwitch.Set(body.Enabled);
            return Ok(new { enabled = body.Enabled, source = "override" });
        }

        public class GexWorkersRequest
        {
            public bool Enabled { get; set; }
        }

        /// <summary>Estado efectivo: override del operador si existe, si no lo que declara el JSON.</summary>
        private async Task<bool> GexWorkersEnabledAsync()
            => _gexWorkerSwitch.ReadOverride() ?? await ReadGexRulesEnabledAsync();

        private async Task<bool> ReadGexRulesEnabledAsync()
        {
            var json = await LoadFileOrNullAsync("Gex/galecore_rules_gex.json");
            if (json == null) return false;
            var root = System.Text.Json.Nodes.JsonNode.Parse(json)?.AsObject();
            // Sin el nodo, la estrategia se considera prendida: es informativa y no ejecuta nada.
            return (bool?)root?["gex"]?["enabled"] ?? true;
        }

        #endregion

        private async Task<string?> LoadFileOrNullAsync(string fileName)
        {
            var path = Path.Combine(_env.ContentRootPath, "Files", fileName);
            return System.IO.File.Exists(path) ? await System.IO.File.ReadAllTextAsync(path) : null;
        }

        private async Task<IActionResult> ServeRulesFileAsync(string fileName)
        {
            var path = Path.Combine(_env.ContentRootPath, "Files", fileName);

            if (!System.IO.File.Exists(path))
                return NotFound($"Archivo no encontrado: {fileName}");

            var json = await System.IO.File.ReadAllTextAsync(path);
            return Content(json, "application/json");
        }
    }
}

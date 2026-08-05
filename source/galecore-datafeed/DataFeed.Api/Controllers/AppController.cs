using MediatR;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc;
using System.IO;
using System.Threading.Tasks;
using DataFeed.Application.App.GammaExposure;
using DataFeed.Application.App.ImpliedVolatility;
using DataFeed.Application.App.IVRank;
using DataFeed.Application.App.ValidationLayer;
using DataFeed.Application.App.PositionBuilder;
using DataFeed.Application.App.PutSkew;

namespace DataFeed.Controllers
{
    [ApiController]
    [Route("[controller]")]
    public class AppController : DataFeedControllerBase
    {
        private readonly IWebHostEnvironment _env;
        private readonly DataFeed.Api.Infrastructure.RpfWorkerSwitch _rpfWorkerSwitch;
        private readonly DataFeed.Application.App.Rpf.RpfStateStore _rpfStore;
        private readonly DataFeed.Infrastructure.Providers.Tastytrade.IMarketDataBroadcaster _broadcaster;

        public AppController(IMediator mediator, IWebHostEnvironment env,
            DataFeed.Api.Infrastructure.RpfWorkerSwitch rpfWorkerSwitch,
            DataFeed.Application.App.Rpf.RpfStateStore rpfStore,
            DataFeed.Infrastructure.Providers.Tastytrade.IMarketDataBroadcaster broadcaster)
            : base(mediator)
        {
            _env = env;
            _rpfWorkerSwitch = rpfWorkerSwitch;
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

        [Tags("App.GaleCore")]
        [HttpGet("GaleCore/Rules/Core")]
        public async Task<IActionResult> RulesCoreAsync()
            => await ServeRulesFileAsync("galecore_rules_core.json");

        [Tags("App.GaleCore")]
        [HttpGet("GaleCore/Rules/Live")]
        public async Task<IActionResult> RulesLiveAsync()
            => await ServeRulesFileAsync("galecore_rules_live.json");

        [Tags("App.GaleCore")]
        [HttpGet("GaleCore/Rules/Paper")]
        public async Task<IActionResult> RulesPaperAsync()
            => await ServeRulesFileAsync("galecore_rules_paper.json");

        [Tags("App.GaleCore")]
        [HttpGet("GaleCore/ValidationLayer")]
        public async Task<IActionResult> ValidationLayerAsync([FromQuery] ValidationLayerRequest request)
        {
            request.RulesJson = await LoadMergedRulesJsonAsync(request.Profile);
            request.PopCalibrationJson = await LoadFileOrNullAsync("pop_calibration.json");
            request.SkewHistoryJson = await LoadFileOrNullAsync("skew25_history.json");
            return await Handle(request);
        }

        [Tags("App.GaleCore")]
        [HttpGet("GaleCore/PositionBuilder")]
        public async Task<IActionResult> PositionBuilderAsync([FromQuery] PositionBuilderRequest request)
        {
            request.RulesJson = await LoadMergedRulesJsonAsync(request.Profile);
            return await Handle(request);
        }

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

        private async Task<string?> LoadFileOrNullAsync(string fileName)
        {
            var path = Path.Combine(_env.ContentRootPath, "Files", fileName);
            return System.IO.File.Exists(path) ? await System.IO.File.ReadAllTextAsync(path) : null;
        }

        private async Task<string> LoadMergedRulesJsonAsync(string profile)
        {
            var basePath = Path.Combine(_env.ContentRootPath, "Files");
            var coreJson = await System.IO.File.ReadAllTextAsync(Path.Combine(basePath, "galecore_rules_core.json"));

            profile = profile?.ToLowerInvariant() ?? "core";
            if (profile == "live" || profile == "paper")
            {
                var overlayPath = Path.Combine(basePath, $"galecore_rules_{profile}.json");
                if (System.IO.File.Exists(overlayPath))
                {
                    var overlayJson = await System.IO.File.ReadAllTextAsync(overlayPath);
                    var core = System.Text.Json.Nodes.JsonNode.Parse(coreJson)!.AsObject();
                    var overlay = System.Text.Json.Nodes.JsonNode.Parse(overlayJson)!.AsObject();
                    DeepMerge(core, overlay);
                    return core.ToJsonString();
                }
            }

            return coreJson;
        }

        private static void DeepMerge(System.Text.Json.Nodes.JsonObject target, System.Text.Json.Nodes.JsonObject source)
        {
            foreach (var prop in source)
            {
                if (prop.Value is System.Text.Json.Nodes.JsonObject sourceObj
                    && target[prop.Key] is System.Text.Json.Nodes.JsonObject targetObj)
                {
                    DeepMerge(targetObj, sourceObj);
                }
                else
                {
                    target[prop.Key] = prop.Value?.DeepClone();
                }
            }
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

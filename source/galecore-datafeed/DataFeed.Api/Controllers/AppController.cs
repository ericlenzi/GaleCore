using MediatR;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc;
using System.IO;
using System.Threading.Tasks;
using DataFeed.Application.App.GammaExposure;
using DataFeed.Application.App.ImpliedVolatility;
using DataFeed.Application.App.IVRank;
using DataFeed.Application.App.ValidationLayer;

namespace DataFeed.Controllers
{
    [ApiController]
    [Route("[controller]")]
    public class AppController : DataFeedControllerBase
    {
        private readonly IWebHostEnvironment _env;

        public AppController(IMediator mediator, IWebHostEnvironment env)
            : base(mediator)
        {
            _env = env;
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
            return await Handle(request);
        }

        #endregion

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

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
using Microsoft.EntityFrameworkCore;

namespace DataFeed.Controllers
{
    [ApiController]
    [Route("[controller]")]
    public class AppController : DataFeedControllerBase
    {
        private readonly IWebHostEnvironment _env;
        private readonly DataFeed.Api.Infrastructure.RpfStrategySwitch _rpfSwitch;
        private readonly DataFeed.Api.Infrastructure.GexStrategySwitch _gexSwitch;
        private readonly DataFeed.Application.App.Rpf.RpfStateStore _rpfStore;
        private readonly DataFeed.Infrastructure.Providers.Tastytrade.IMarketDataBroadcaster _broadcaster;
        private readonly DataFeed.Api.Infrastructure.UserStrategySwitchStore _userSwitches;
        private readonly DataFeed.Api.Infrastructure.PlatformServiceSwitch _serviceSwitch;
        private readonly DataFeed.Infrastructure.Providers.Tastytrade.ICurrentUser _currentUser;
        private readonly ILogger<AppController> _logger;

        public AppController(IMediator mediator, IWebHostEnvironment env,
            DataFeed.Api.Infrastructure.RpfStrategySwitch rpfSwitch,
            DataFeed.Api.Infrastructure.GexStrategySwitch gexSwitch,
            DataFeed.Application.App.Rpf.RpfStateStore rpfStore,
            DataFeed.Infrastructure.Providers.Tastytrade.IMarketDataBroadcaster broadcaster,
            DataFeed.Api.Infrastructure.UserStrategySwitchStore userSwitches,
            DataFeed.Api.Infrastructure.PlatformServiceSwitch serviceSwitch,
            DataFeed.Infrastructure.Providers.Tastytrade.ICurrentUser currentUser,
            ILogger<AppController> logger)
            : base(mediator)
        {
            _serviceSwitch = serviceSwitch;
            _env = env;
            _rpfSwitch = rpfSwitch;
            _gexSwitch = gexSwitch;
            _rpfStore = rpfStore;
            _broadcaster = broadcaster;
            _userSwitches = userSwitches;
            _currentUser = currentUser;
            _logger = logger;
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

        /// <summary>
        /// Estado del switch de un servicio de plataforma (`services[]` de la config de la app).
        /// Dos niveles, no tres: estos procesos no trabajan para nadie en particular, así que no
        /// tienen preferencia por usuario. `source` vale "platform" o "rules".
        /// </summary>
        [Tags("App.GaleCore")]
        [HttpGet("GaleCore/Services/{serviceId}/Switch")]
        public IActionResult ServiceSwitchGet(string serviceId)
        {
            var resolved = _serviceSwitch.Resolve(serviceId);
            if (resolved == null)
                return NotFound(new { error = $"El servicio '{serviceId}' no está declarado en services[] de la config." });

            return Ok(new { enabled = resolved.Value.Enabled, source = resolved.Value.Source });
        }

        /// <summary>
        /// Prende o apaga un servicio de plataforma. Es kill switch para todos —no hay otro nivel—
        /// así que lo tocan solo los admin (users.is_admin).
        ///
        /// El servicio lo relee en su próximo tick: el corte de `skew` tarda hasta 6h en notarse
        /// porque esa es su cadencia, y el de `flow` hasta 30s.
        /// </summary>
        [Tags("App.GaleCore")]
        [HttpPost("GaleCore/Services/{serviceId}/Switch")]
        public async Task<IActionResult> ServiceSwitchSetAsync(
            string serviceId, [FromBody] ServiceSwitchRequest body, CancellationToken ct)
        {
            if (!_serviceSwitch.IsDeclared(serviceId))
                return NotFound(new { error = $"El servicio '{serviceId}' no está declarado en services[] de la config." });

            var denied = await DenyIfNotPlatformAdminAsync($"el servicio {serviceId}", ct);
            if (denied != null) return denied;

            _serviceSwitch.Set(serviceId, body.Enabled);

            var resolved = _serviceSwitch.Resolve(serviceId)!.Value;
            return Ok(new { enabled = resolved.Enabled, source = resolved.Source, scope = "platform" });
        }

        public class ServiceSwitchRequest
        {
            public bool Enabled { get; set; }
        }

        /// <summary>
        /// Quién es el portador del token. Endpoint de diagnóstico de la autenticación con Supabase:
        /// es la única forma de comprobar de punta a punta que la API valida los JWT del proyecto
        /// (firma ES256 contra el JWKS público, emisor y audiencia).
        ///
        /// Sin token devuelve 401; con uno válido, el uuid del usuario — que es la clave con la que
        /// se lo busca en la tabla `users`, porque users.id ES el auth.users.id de Supabase.
        ///
        /// Ojo: hoy exige TAMBIÉN la API key, porque ApiKeyMiddleware corre antes y sigue aplicando
        /// a todo /App. Las dos capas conviven mientras dure la migración al login.
        /// </summary>
        [Microsoft.AspNetCore.Authorization.Authorize]
        [Tags("App.GaleCore")]
        [HttpGet("GaleCore/Me")]
        public IActionResult Me()
        {
            // "sub" es el uuid del usuario en Supabase. ASP.NET lo mapea a NameIdentifier salvo que
            // se desactive el mapeo de claims, así que se buscan los dos nombres.
            var sub = User.FindFirst("sub")?.Value
                   ?? User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;

            return Ok(new
            {
                userId = sub,
                email = User.FindFirst("email")?.Value,
                role = User.FindFirst("role")?.Value,
                issuer = User.Claims.FirstOrDefault(c => c.Type == "iss")?.Value,
                claims = User.Claims.Select(c => new { type = c.Type, value = c.Value }),
            });
        }

        /// <summary>
        /// La cuenta de bróker vinculada al usuario autenticado. Nunca devuelve el refresh token:
        /// entra a la base cifrado y no vuelve a salir por HTTP.
        /// </summary>
        [Microsoft.AspNetCore.Authorization.Authorize]
        [Tags("App.GaleCore")]
        [HttpGet("GaleCore/Account")]
        public async Task<IActionResult> GetBrokerAccountAsync(
            [FromServices] DataFeed.Repositories.GaleCoreDbContext db,
            [FromServices] DataFeed.Infrastructure.Providers.Tastytrade.ICurrentUser currentUser,
            CancellationToken ct)
        {
            var userId = currentUser.UserId;
            if (userId == null) return Unauthorized();

            var account = await db.Accounts.AsNoTracking()
                .FirstOrDefaultAsync(a => a.UserId == userId.Value, ct);

            if (account == null) return Ok(new { linked = false });

            return Ok(new
            {
                linked = true,
                broker = account.Broker,
                accountNumber = account.AccountNumber,
                isSystem = account.IsSystem,
                updatedAt = account.UpdatedAt,
            });
        }

        /// <summary>
        /// Vincula (o actualiza) la cuenta de bróker del usuario autenticado. El refresh token se
        /// cifra con AES-GCM antes de guardarse.
        ///
        /// Crea la fila de `users` si no existe: la identidad la maneja Supabase Auth y esta tabla
        /// solo le cuelga las FK, así que la primera vez que alguien válido aparece hay que
        /// materializarlo. El uuid y el mail salen del token, NO del body — si vinieran del body,
        /// cualquiera podría vincular una cuenta al usuario de otro.
        /// </summary>
        [Microsoft.AspNetCore.Authorization.Authorize]
        [Tags("App.GaleCore")]
        [HttpPost("GaleCore/Account")]
        public async Task<IActionResult> LinkBrokerAccountAsync(
            [FromBody] DataFeed.Api.Controllers.Dtos.LinkBrokerAccountRequest body,
            [FromServices] DataFeed.Repositories.GaleCoreDbContext db,
            [FromServices] DataFeed.Infrastructure.Providers.Tastytrade.ICurrentUser currentUser,
            [FromServices] DataFeed.Infrastructure.Providers.Tastytrade.ITokenProtector protector,
            CancellationToken ct)
        {
            var userId = currentUser.UserId;
            if (userId == null) return Unauthorized();

            if (string.IsNullOrWhiteSpace(body.AccountNumber) || string.IsNullOrWhiteSpace(body.RefreshToken))
                return BadRequest(new { error = "accountNumber y refreshToken son requeridos." });

            var user = await db.Users.FirstOrDefaultAsync(u => u.Id == userId.Value, ct);

            if (user == null)
            {
                user = new DataFeed.Repositories.Entities.User
                {
                    Id = userId.Value,
                    Email = currentUser.Email ?? $"{userId.Value}@sin-mail.local",
                    CreatedAt = DateTime.UtcNow,
                    UpdatedAt = DateTime.UtcNow,
                };
                db.Users.Add(user);
            }

            var account = await db.Accounts
                .FirstOrDefaultAsync(a => a.UserId == userId.Value && a.Broker == "tastytrade", ct);

            if (account == null)
            {
                account = new DataFeed.Repositories.Entities.Account
                {
                    Id = Guid.NewGuid(),
                    UserId = userId.Value,
                    Broker = "tastytrade",
                    CreatedAt = DateTime.UtcNow,
                };
                db.Accounts.Add(account);
            }

            account.AccountNumber = body.AccountNumber.Trim();
            account.RefreshTokenEncrypted = protector.Protect(body.RefreshToken.Trim());
            account.UpdatedAt = DateTime.UtcNow;

            await db.SaveChangesAsync(ct);

            _logger.LogInformation("Cuenta de bróker vinculada para el usuario {UserId}", userId.Value);

            return Ok(new { linked = true, accountNumber = account.AccountNumber });
        }

        #endregion

        #region Switch de estrategia (transversal)

        // Lo que comparten los switches de TODAS las estrategias. No es de ninguna: cada estrategia
        // pone su archivo de plataforma, su JSON de reglas y su id, y la mecánica de los tres
        // niveles vive acá una sola vez. La tabla de verdad es StrategyEnablement.Resolve.
        //
        // El id va en MINÚSCULA (convención de CLAUDE.md): es la clave de `strategies.id` y de
        // `user_strategies.strategy_id`. El capitalizado ("Rpf") es el prefijo de la ruta HTTP y de
        // la carpeta de archivos, y no se usa acá.
        private const string RpfStrategyId = "rpf";
        private const string GexStrategyId = "gex";

        /// <summary>Lo que quedó aplicado tras un POST de switch, más el cuerpo que se devuelve.</summary>
        private record AppliedSwitch(bool Enabled, string Source, Guid? UserId, object Payload);

        /// <summary>
        /// Estado del switch para quien pregunta, con el desglose de los tres niveles. El front
        /// consume `enabled` y `source`; `platform` y `user` están para poder diagnosticar por qué
        /// una estrategia está apagada sin entrar a la base ni al disco.
        /// </summary>
        private async Task<IActionResult> SwitchStateAsync(
            string strategyId, bool? platformOverride, bool rulesEnabled, CancellationToken ct)
        {
            var userId = _currentUser.UserId;
            bool? userOverride = userId.HasValue
                ? await _userSwitches.ReadUserOverrideAsync(userId.Value, strategyId, ct)
                : null;

            var (enabled, source) = DataFeed.Application.App.Shared.StrategyEnablement.Resolve(
                rulesEnabled, platformOverride, userOverride);

            return Ok(new
            {
                enabled,
                source,
                platform = new
                {
                    enabled = platformOverride ?? rulesEnabled,
                    source = platformOverride.HasValue
                        ? DataFeed.Application.App.Shared.StrategyEnablement.SourcePlatform
                        : DataFeed.Application.App.Shared.StrategyEnablement.SourceRules,
                },
                // enabled null = este usuario nunca tocó el switch, así que manda la plataforma.
                user = new { enabled = userOverride, authenticated = userId.HasValue },
            });
        }

        /// <summary>
        /// Escribe el switch en el nivel que corresponde y devuelve el estado efectivo resultante.
        ///
        /// Con usuario y con base, escribe SU fila: apagar la estrategia desde el tablero no se la
        /// apaga a los demás. Sin usuario (llamada de máquina a máquina con API key) o sin base
        /// configurada no existe el nivel de usuario, así que escribe el de plataforma — que es cómo
        /// se comportaba este endpoint antes del switch de dos niveles, y lo que mantiene a la API
        /// funcionando sin base.
        /// </summary>
        private async Task<AppliedSwitch> ApplySwitchAsync(
            string strategyId, bool enabled,
            Func<bool?> readPlatform, Action<bool> setPlatform,
            bool rulesEnabled, CancellationToken ct)
        {
            var userId = _currentUser.UserId;

            if (userId.HasValue && _userSwitches.DatabaseConfigured)
            {
                await _userSwitches.SetUserAsync(userId.Value, _currentUser.Email, strategyId, enabled, ct);

                // El efectivo NO es lo que pidió: si la plataforma está apagada, prender el switch
                // propio no alcanza — y el front tiene que mostrar eso, no un ON que no existe.
                var (eff, src) = DataFeed.Application.App.Shared.StrategyEnablement.Resolve(
                    rulesEnabled, readPlatform(), enabled);

                return new AppliedSwitch(eff, src, userId,
                    new { enabled = eff, source = src, scope = "user" });
            }

            setPlatform(enabled);

            var (platformEff, platformSrc) = DataFeed.Application.App.Shared.StrategyEnablement.Resolve(
                rulesEnabled, enabled, user: null);

            _logger.LogInformation(
                "Switch de {StrategyId} → {State} a nivel PLATAFORMA ({Motivo}).",
                strategyId, enabled ? "ON" : "OFF",
                userId.HasValue ? "no hay base configurada" : "request sin usuario autenticado");

            return new AppliedSwitch(platformEff, platformSrc, null,
                new { enabled = platformEff, source = platformSrc, scope = "platform" });
        }

        /// <summary>
        /// Corta con 403 si quien llama no puede tocar el kill switch de plataforma. Devuelve null
        /// cuando sí puede.
        ///
        /// Deja pasar dos casos que no son un agujero: sin base configurada no hay usuarios ni
        /// permisos que consultar (la API se comporta como antes de la base), y una llamada sin
        /// usuario es la credencial de máquina —la API key, que ya no viaja en el bundle del
        /// tablero desde 7af126a y es del operador—. El caso que este chequeo existe para cortar es
        /// el otro: un segundo operador logueado apagándole la estrategia al resto.
        /// </summary>
        private async Task<IActionResult?> DenyIfNotPlatformAdminAsync(string subject, CancellationToken ct)
        {
            if (!_userSwitches.DatabaseConfigured) return null;

            var userId = _currentUser.UserId;
            if (userId == null)
            {
                _logger.LogInformation(
                    "Kill switch de plataforma de {Subject} tocado por una llamada sin usuario (API key).",
                    subject);
                return null;
            }

            if (await _userSwitches.IsAdminAsync(userId.Value, ct)) return null;

            _logger.LogWarning(
                "El usuario {UserId} intentó tocar el kill switch de plataforma de {Subject} sin ser admin.",
                userId.Value, subject);

            return StatusCode(403, new
            {
                error = "El kill switch de plataforma es solo para admins. " +
                        "Para prender o apagar una estrategia en tu tablero, usá POST del switch sin /Platform.",
            });
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
        /// Estado del switch de la estrategia RPF para quien pregunta. `source` dice qué nivel lo
        /// decidió: "user" (su fila de user_strategies), "platform" (el kill switch del operador) o
        /// "rules" (todavía manda state_machine.enabled del JSON).
        /// </summary>
        [Tags("App.Rpf")]
        [HttpGet("Rpf/Switch")]
        public async Task<IActionResult> RpfSwitchGetAsync(CancellationToken ct)
            => await SwitchStateAsync(RpfStrategyId, _rpfSwitch.ReadOverride(),
                                      await ReadRpfRulesEnabledAsync(), ct);

        /// <summary>
        /// Prende o apaga la estrategia RPF PARA EL USUARIO QUE LLAMA (fila en user_strategies). No
        /// toca galecore_rules_rpf.json ni el kill switch de plataforma, que vive en
        /// /App/Rpf/Switch/Platform y es el único que corta la estrategia para todos.
        ///
        /// Sin usuario autenticado o sin base configurada escribe el nivel de plataforma, que es
        /// exactamente cómo se comportaba este endpoint antes de que el switch tuviera dos niveles.
        /// </summary>
        [Tags("App.Rpf")]
        [HttpPost("Rpf/Switch")]
        public async Task<IActionResult> RpfSwitchSetAsync([FromBody] RpfSwitchRequest body, CancellationToken ct)
        {
            var applied = await ApplySwitchAsync(
                RpfStrategyId, body.Enabled,
                _rpfSwitch.ReadOverride, _rpfSwitch.Set,
                await ReadRpfRulesEnabledAsync(), ct);

            await AfterRpfSwitchAsync(applied, ct);
            return Ok(applied.Payload);
        }

        /// <summary>
        /// El kill switch de PLATAFORMA de RPF: corta el loop, el consumo de feed y la emisión para
        /// TODOS los usuarios. Restringido a los admin de la plataforma (users.is_admin) — un
        /// operador no puede apagarle la estrategia a otro desde su tablero, que para eso tiene su
        /// propio nivel en POST /App/Rpf/Switch.
        ///
        /// Escribe Files/Rpf/rpf_switch_state.json, que `RpfLoopService` relee en cada tick.
        /// </summary>
        [Tags("App.Rpf")]
        [HttpPost("Rpf/Switch/Platform")]
        public async Task<IActionResult> RpfPlatformSwitchSetAsync([FromBody] RpfSwitchRequest body, CancellationToken ct)
        {
            var denied = await DenyIfNotPlatformAdminAsync(RpfStrategyId, ct);
            if (denied != null) return denied;

            _rpfSwitch.Set(body.Enabled);

            var (enabled, source) = DataFeed.Application.App.Shared.StrategyEnablement.Resolve(
                await ReadRpfRulesEnabledAsync(), body.Enabled, user: null);

            // userId null: el aviso va al grupo entero, porque este nivel sí apaga para todos.
            await AfterRpfSwitchAsync(new AppliedSwitch(enabled, source, null,
                new { enabled, source, scope = "platform" }), ct);

            return Ok(new { enabled, source, scope = "platform" });
        }

        /// <summary>
        /// Lo que hay que hacer además de escribir el switch de RPF: limpiar el tablero si la
        /// estrategia queda inerte, y avisarle al front para que reaccione sin esperar su próximo GET.
        /// </summary>
        private async Task AfterRpfSwitchAsync(AppliedSwitch applied, CancellationToken ct)
        {
            // El estado en memoria se descarta cuando NO QUEDA NADIE mirando: con el loop inerte
            // nadie lo actualiza, y un tablero que se conecte después vería datos viejos como si
            // fueran vigentes. Ojo con la diferencia contra el switch de un solo nivel: que este
            // usuario la apague no basta — si otro la tiene prendida, el loop sigue y su estado es
            // legítimo. Por eso la pregunta es la misma que se hace el loop, no el estado de quien
            // llamó.
            bool platformEnabled = _rpfSwitch.ReadOverride() ?? await ReadRpfRulesEnabledAsync();
            bool loopSigue = platformEnabled
                && await _userSwitches.AnyUserEnabledAsync(RpfStrategyId, ct);

            if (!loopSigue) _rpfStore.Clear();

            // Aviso para que los tableros abiertos reaccionen en el acto.
            //
            // Acotado en el tiempo A PROPOSITO. El front fuerza transporte LongPolling, y un cliente
            // que desaparecio sin cerrar (pestaña vieja, browser dormido) sigue en el grupo hasta que
            // expira: ahi el SendAsync bloquea y se llevaba puesto al POST entero, dejando el switch
            // colgado. Un kill switch que se cuelga porque un tablero fantasma no lee es peor que
            // inutil — el estado ya quedo escrito y es lo unico que manda. Avisar es best-effort: el
            // tablero que no se entere lo va a ver en su proximo GET.
            try
            {
                await _broadcaster.BroadcastRpfSwitchAsync(applied.Enabled, applied.UserId?.ToString())
                    .WaitAsync(TimeSpan.FromSeconds(2), ct);
            }
            catch (TimeoutException)
            {
                _logger.LogWarning(
                    "RPF switch → {State}: el broadcast no completo en 2s (cliente colgado). " +
                    "El switch igual quedo aplicado.", applied.Enabled ? "ON" : "OFF");
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "RPF switch → {State}: fallo el broadcast. " +
                    "El switch igual quedo aplicado.", applied.Enabled ? "ON" : "OFF");
            }
        }

        public class RpfSwitchRequest
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
            request.AllowScan = await GexSwitchEnabledAsync(HttpContext.RequestAborted);

            return await Handle(request);
        }

        /// <summary>
        /// Estado del switch de GEX para quien pregunta. `source` dice qué nivel lo decidió: "user",
        /// "platform" o "rules" (gex.enabled del JSON).
        /// </summary>
        [Tags("App.Gex")]
        [HttpGet("Gex/Switch")]
        public async Task<IActionResult> GexSwitchGetAsync(CancellationToken ct)
            => await SwitchStateAsync(GexStrategyId, _gexSwitch.ReadOverride(),
                                      await ReadGexRulesEnabledAsync(), ct);

        /// <summary>
        /// Prende o apaga el barrido de GEX PARA EL USUARIO QUE LLAMA. El kill switch que lo saca
        /// del feed DXLink para todos es /App/Gex/Switch/Platform.
        /// </summary>
        [Tags("App.Gex")]
        [HttpPost("Gex/Switch")]
        public async Task<IActionResult> GexSwitchSetAsync([FromBody] GexSwitchRequest body, CancellationToken ct)
        {
            var applied = await ApplySwitchAsync(
                GexStrategyId, body.Enabled,
                _gexSwitch.ReadOverride, _gexSwitch.Set,
                await ReadGexRulesEnabledAsync(), ct);

            return Ok(applied.Payload);
        }

        /// <summary>
        /// El kill switch de PLATAFORMA de GEX: en OFF la estrategia deja de competir por el feed
        /// DXLink para todos. Restringido a los admin de la plataforma (users.is_admin).
        /// </summary>
        [Tags("App.Gex")]
        [HttpPost("Gex/Switch/Platform")]
        public async Task<IActionResult> GexPlatformSwitchSetAsync([FromBody] GexSwitchRequest body, CancellationToken ct)
        {
            var denied = await DenyIfNotPlatformAdminAsync(GexStrategyId, ct);
            if (denied != null) return denied;

            _gexSwitch.Set(body.Enabled);

            var (enabled, source) = DataFeed.Application.App.Shared.StrategyEnablement.Resolve(
                await ReadGexRulesEnabledAsync(), body.Enabled, user: null);

            return Ok(new { enabled, source, scope = "platform" });
        }

        public class GexSwitchRequest
        {
            public bool Enabled { get; set; }
        }

        /// <summary>
        /// Estado efectivo de GEX para quien está haciendo el request. Es lo que decide si el
        /// barrido puede tocar DXLink: un usuario que apagó la estrategia no la puede seguir
        /// disparando desde su pantalla.
        /// </summary>
        private async Task<bool> GexSwitchEnabledAsync(CancellationToken ct)
        {
            var userId = _currentUser.UserId;
            bool? userOverride = userId.HasValue
                ? await _userSwitches.ReadUserOverrideAsync(userId.Value, GexStrategyId, ct)
                : null;

            var (enabled, _) = DataFeed.Application.App.Shared.StrategyEnablement.Resolve(
                await ReadGexRulesEnabledAsync(), _gexSwitch.ReadOverride(), userOverride);

            return enabled;
        }

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

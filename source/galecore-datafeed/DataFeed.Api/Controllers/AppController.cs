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
        private readonly DataFeed.Api.Infrastructure.UserStore _users;
        private readonly DataFeed.Api.Infrastructure.PlatformServiceSwitch _serviceSwitch;
        private readonly DataFeed.Infrastructure.Providers.Tastytrade.ICurrentUser _currentUser;
        private readonly ILogger<AppController> _logger;

        public AppController(IMediator mediator, IWebHostEnvironment env,
            DataFeed.Api.Infrastructure.RpfStrategySwitch rpfSwitch,
            DataFeed.Api.Infrastructure.GexStrategySwitch gexSwitch,
            DataFeed.Application.App.Rpf.RpfStateStore rpfStore,
            DataFeed.Infrastructure.Providers.Tastytrade.IMarketDataBroadcaster broadcaster,
            DataFeed.Api.Infrastructure.UserStore users,
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
            _users = users;
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
        ///
        /// El front lo consume además para saber qué puede mostrar habilitado: `canManagePlatform`
        /// es lo que decide si el switch de una estrategia se puede tocar. Es la MISMA regla que
        /// aplica el 403 del POST (<see cref="CanManagePlatformAsync"/>), no una copia — si fueran
        /// dos, la UI y el backend se contradecirían y el operador vería un botón que no funciona.
        /// </summary>
        [Microsoft.AspNetCore.Authorization.Authorize]
        [Tags("App.GaleCore")]
        [HttpGet("GaleCore/Me")]
        public async Task<IActionResult> MeAsync(CancellationToken ct)
        {
            // "sub" es el uuid del usuario en Supabase. ASP.NET lo mapea a NameIdentifier salvo que
            // se desactive el mapeo de claims, así que se buscan los dos nombres.
            var sub = User.FindFirst("sub")?.Value
                   ?? User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;

            var userId = _currentUser.UserId;

            return Ok(new
            {
                userId = sub,
                email = User.FindFirst("email")?.Value,
                role = User.FindFirst("role")?.Value,
                issuer = User.Claims.FirstOrDefault(c => c.Type == "iss")?.Value,

                // La verdad cruda de la tabla: false sin base, sin fila o si la consulta falla.
                isAdmin = userId.HasValue && await _users.IsAdminAsync(userId.Value, ct),

                // El permiso EFECTIVO, que no es lo mismo: sin base no hay permisos que consultar
                // y la API se comporta como antes de que la base existiera.
                canManagePlatform = await CanManagePlatformAsync(ct),
                databaseConfigured = _users.DatabaseConfigured,

                claims = User.Claims.Select(c => new { type = c.Type, value = c.Value }),
            });
        }

        /// <summary>
        /// Respuesta para los endpoints que necesitan la base cuando la API está corriendo sin ella.
        ///
        /// La base es OPCIONAL a propósito (`Program.cs`): sin cadena configurada la API igual
        /// levanta y sirve mercado, GEX, RPF y el hub, porque nada de eso depende de la base. El
        /// costo era que estos endpoints estallaban con un 500 y un stack trace de DI —el cliente
        /// leía "error del servidor" cuando en realidad falta un secreto de configuración—. 503 dice
        /// la verdad: la función no está disponible en este entorno, y el mensaje dice por qué.
        ///
        /// Se resuelve el DbContext por IServiceProvider y no con [FromServices] porque el binder
        /// pide el servicio como requerido: si no está registrado, tira antes de entrar al método y
        /// no hay forma de contestar nada.
        /// </summary>
        private IActionResult DatabaseNotConfigured()
        {
            _logger.LogWarning(
                "Se pidió un endpoint que necesita la base, pero la API está corriendo sin ella " +
                "(falta ConnectionStrings:GaleCore).");

            return StatusCode(503, new
            {
                error = "Esta API está corriendo sin base de datos configurada, así que no puede " +
                        "resolver cuentas de bróker por usuario. Falta ConnectionStrings:GaleCore " +
                        "(user-secrets en local, App Settings en el hosting).",
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
            [FromServices] IServiceProvider services,
            [FromServices] DataFeed.Infrastructure.Providers.Tastytrade.ICurrentUser currentUser,
            CancellationToken ct)
        {
            var userId = currentUser.UserId;
            if (userId == null) return Unauthorized();

            var db = services.GetService<DataFeed.Repositories.GaleCoreDbContext>();
            if (db == null) return DatabaseNotConfigured();

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
            [FromServices] IServiceProvider services,
            [FromServices] DataFeed.Infrastructure.Providers.Tastytrade.ICurrentUser currentUser,
            [FromServices] DataFeed.Infrastructure.Providers.Tastytrade.ITokenProtector protector,
            CancellationToken ct)
        {
            var userId = currentUser.UserId;
            if (userId == null) return Unauthorized();

            var db = services.GetService<DataFeed.Repositories.GaleCoreDbContext>();
            if (db == null) return DatabaseNotConfigured();

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
        // pone su archivo de plataforma, su JSON de reglas y su id, y la mecánica de los dos
        // niveles vive acá una sola vez. La tabla de verdad es StrategyEnablement.Resolve.
        //
        // EL SWITCH ES GLOBAL: apagar una estrategia la apaga para todos, y por eso el POST es
        // admin-only. Hubo un tercer nivel por usuario (tabla `user_strategies`) que se eliminó el
        // 2026-08-12 — ver docs/GaleCore-plan-reorganizacion-2026-08.md, etapa 1.
        //
        // El id va en MINÚSCULA (convención de CLAUDE.md); sirve para los logs y para nombrar el
        // sujeto del 403. El capitalizado ("Rpf") es el prefijo de la ruta HTTP y de la carpeta de
        // archivos, y no se usa acá.
        private const string RpfStrategyId = "rpf";
        private const string GexStrategyId = "gex";

        /// <summary>
        /// Estado del switch, con el desglose de los dos niveles. El front consume `enabled` y
        /// `source`; `rules` y `platform` están para poder diagnosticar por qué una estrategia está
        /// apagada sin entrar al disco.
        ///
        /// No depende de quién pregunta: el switch es global.
        /// </summary>
        private IActionResult SwitchState(bool? platformOverride, bool rulesEnabled)
        {
            var (enabled, source) = DataFeed.Application.App.Shared.StrategyEnablement.Resolve(
                rulesEnabled, platformOverride);

            return Ok(new
            {
                enabled,
                source,
                // Lo que declara el JSON de reglas de la estrategia (el piso).
                rules = rulesEnabled,
                // null = nunca se tocó el switch, así que manda el JSON.
                platform = platformOverride,
            });
        }

        /// <summary>
        /// Escribe el kill switch de plataforma de una estrategia y devuelve el estado efectivo.
        ///
        /// Apaga (o prende) PARA TODOS: corta el consumo de feed y la emisión. Por eso lo tocan
        /// solo los admin — un segundo operador no puede apagarle la estrategia al resto.
        ///
        /// Devuelve el 403 en `Denied` en vez de tirar, para que quien llama pueda hacer su parte
        /// (limpiar estado, avisar por el hub) solo cuando la escritura ocurrió de verdad.
        /// </summary>
        private async Task<(IActionResult? Denied, bool Enabled, string Source)> ApplySwitchAsync(
            string strategyId, bool enabled, Action<bool> setPlatform,
            bool rulesEnabled, CancellationToken ct)
        {
            var denied = await DenyIfNotPlatformAdminAsync(strategyId, ct);
            if (denied != null) return (denied, false, string.Empty);

            setPlatform(enabled);

            var (eff, src) = DataFeed.Application.App.Shared.StrategyEnablement.Resolve(
                rulesEnabled, enabled);

            _logger.LogInformation("Switch de {StrategyId} → {State} para toda la plataforma.",
                strategyId, eff ? "ON" : "OFF");

            return (null, eff, src);
        }

        /// <summary>
        /// ¿Puede quien llama tocar el kill switch de plataforma?
        ///
        /// Deja pasar dos casos que no son un agujero: sin base configurada no hay usuarios ni
        /// permisos que consultar (la API se comporta como antes de la base), y una llamada sin
        /// usuario es la credencial de máquina —la API key, que ya no viaja en el bundle del
        /// tablero desde 7af126a y es del operador—. El caso que este chequeo existe para cortar es
        /// el otro: un segundo operador logueado apagándole la estrategia al resto.
        ///
        /// Es la ÚNICA autoridad de esta regla: la consumen el 403 de los POST y el
        /// `canManagePlatform` de /Me, para que la UI y el backend no puedan contradecirse.
        /// </summary>
        private async Task<bool> CanManagePlatformAsync(CancellationToken ct)
        {
            if (!_users.DatabaseConfigured) return true;

            var userId = _currentUser.UserId;
            if (userId == null) return true;

            return await _users.IsAdminAsync(userId.Value, ct);
        }

        /// <summary>
        /// Corta con 403 si quien llama no puede tocar el kill switch de plataforma. Devuelve null
        /// cuando sí puede. La regla vive en <see cref="CanManagePlatformAsync"/>.
        /// </summary>
        private async Task<IActionResult?> DenyIfNotPlatformAdminAsync(string subject, CancellationToken ct)
        {
            if (await CanManagePlatformAsync(ct)) return null;

            _logger.LogWarning(
                "El usuario {UserId} intentó tocar el kill switch de {Subject} sin ser admin.",
                _currentUser.UserId, subject);

            return StatusCode(403, new
            {
                error = "Prender o apagar una estrategia afecta a toda la plataforma, así que es " +
                        "solo para admins (users.is_admin).",
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
        /// Estado del switch de la estrategia RPF. `source` dice qué nivel lo decidió: "platform"
        /// (el kill switch del operador) o "rules" (todavía manda state_machine.enabled del JSON).
        /// </summary>
        [Tags("App.Rpf")]
        [HttpGet("Rpf/Switch")]
        public async Task<IActionResult> RpfSwitchGetAsync()
            => SwitchState(_rpfSwitch.ReadOverride(), await ReadRpfRulesEnabledAsync());

        /// <summary>
        /// Prende o apaga la estrategia RPF PARA TODA LA PLATAFORMA: corta el loop, el consumo de
        /// feed y la emisión. Restringido a los admin (users.is_admin).
        ///
        /// Escribe Files/Rpf/rpf_switch_state.json, que `RpfLoopService` relee en cada tick. No
        /// toca galecore_rules_rpf.json, que es fuente de verdad y se edita deliberadamente.
        /// </summary>
        [Tags("App.Rpf")]
        [HttpPost("Rpf/Switch")]
        public async Task<IActionResult> RpfSwitchSetAsync([FromBody] RpfSwitchRequest body, CancellationToken ct)
        {
            var (denied, enabled, source) = await ApplySwitchAsync(
                RpfStrategyId, body.Enabled, _rpfSwitch.Set,
                await ReadRpfRulesEnabledAsync(), ct);

            if (denied != null) return denied;

            await AfterRpfSwitchAsync(enabled, ct);
            return Ok(new { enabled, source });
        }

        /// <summary>
        /// Lo que hay que hacer además de escribir el switch de RPF: limpiar el tablero si la
        /// estrategia queda inerte, y avisarle al front para que reaccione sin esperar su próximo GET.
        /// </summary>
        private async Task AfterRpfSwitchAsync(bool enabled, CancellationToken ct)
        {
            // El estado en memoria se descarta al apagar: con el loop inerte nadie lo actualiza, y
            // un tablero que se conecte después vería datos viejos como si fueran vigentes.
            if (!enabled) _rpfStore.Clear();

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
                await _broadcaster.BroadcastRpfSwitchAsync(enabled)
                    .WaitAsync(TimeSpan.FromSeconds(2), ct);
            }
            catch (TimeoutException)
            {
                _logger.LogWarning(
                    "RPF switch → {State}: el broadcast no completo en 2s (cliente colgado). " +
                    "El switch igual quedo aplicado.", enabled ? "ON" : "OFF");
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "RPF switch → {State}: fallo el broadcast. " +
                    "El switch igual quedo aplicado.", enabled ? "ON" : "OFF");
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
            request.AllowScan = await GexSwitchEnabledAsync();

            return await Handle(request);
        }

        /// <summary>
        /// Estado del switch de GEX. `source` dice qué nivel lo decidió: "platform" o "rules"
        /// (gex.enabled del JSON).
        /// </summary>
        [Tags("App.Gex")]
        [HttpGet("Gex/Switch")]
        public async Task<IActionResult> GexSwitchGetAsync()
            => SwitchState(_gexSwitch.ReadOverride(), await ReadGexRulesEnabledAsync());

        /// <summary>
        /// Prende o apaga el barrido de GEX PARA TODA LA PLATAFORMA: en OFF la estrategia deja de
        /// competir por el feed DXLink. Restringido a los admin (users.is_admin).
        /// </summary>
        [Tags("App.Gex")]
        [HttpPost("Gex/Switch")]
        public async Task<IActionResult> GexSwitchSetAsync([FromBody] GexSwitchRequest body, CancellationToken ct)
        {
            var (denied, enabled, source) = await ApplySwitchAsync(
                GexStrategyId, body.Enabled, _gexSwitch.Set,
                await ReadGexRulesEnabledAsync(), ct);

            if (denied != null) return denied;

            return Ok(new { enabled, source });
        }

        public class GexSwitchRequest
        {
            public bool Enabled { get; set; }
        }

        /// <summary>
        /// Estado efectivo de GEX. Es lo que decide si el barrido puede tocar DXLink: con la
        /// estrategia apagada, ninguna pantalla la puede seguir disparando.
        /// </summary>
        private async Task<bool> GexSwitchEnabledAsync()
        {
            var (enabled, _) = DataFeed.Application.App.Shared.StrategyEnablement.Resolve(
                await ReadGexRulesEnabledAsync(), _gexSwitch.ReadOverride());

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

using DataFeed.Infrastructure.Providers.Tastytrade;
using DataFeed.Repositories;
using Microsoft.EntityFrameworkCore;

namespace DataFeed.Api.Infrastructure
{
    /// <summary>
    /// Resuelve credenciales de Tastytrade desde la tabla `accounts`, con caída a appsettings.
    ///
    /// Vive en Api/Infrastructure y no en DataFeed.Infrastructure porque necesita el DbContext, y
    /// Api es el único proyecto que ve las dos cosas. Mismo criterio que los switches de estrategia
    /// y los BackgroundService.
    ///
    /// COMPATIBILIDAD HACIA ATRÁS, a propósito: mientras no haya base configurada o no haya ninguna
    /// cuenta marcada `is_system`, todo sale de appsettings — o sea que la plataforma se comporta
    /// exactamente como antes de que existiera la base. La migración a credenciales por usuario se
    /// hace agregando filas, no cambiando código ni redeployando.
    ///
    /// Singleton: crea su propio scope para el DbContext en cada consulta, porque los llamadores son
    /// procesos de fondo sin scope de request.
    /// </summary>
    public class TastytradeCredentialStore : ITastytradeCredentialStore
    {
        private readonly IServiceProvider _services;
        private readonly IConfiguration _config;
        private readonly ITokenProtector _protector;
        private readonly ILogger<TastytradeCredentialStore> _logger;

        public TastytradeCredentialStore(
            IServiceProvider services,
            IConfiguration config,
            ITokenProtector protector,
            ILogger<TastytradeCredentialStore> logger)
        {
            _services = services;
            _config = config;
            _protector = protector;
            _logger = logger;
        }

        public async Task<TastytradeCredential> GetSystemAsync(CancellationToken ct = default)
        {
            var fromDb = await QueryAsync(q => q.Where(a => a.IsSystem), ct);
            if (fromDb != null) return fromDb;

            return FromConfig();
        }

        public async Task<TastytradeCredential?> GetForUserAsync(Guid userId, CancellationToken ct = default)
            => await QueryAsync(q => q.Where(a => a.UserId == userId), ct);

        /// <summary>
        /// Consulta la base si está configurada. Cualquier problema —sin base, sin fila, token que no
        /// descifra— devuelve null en vez de tirar: quien llama decide si eso es caer a config (el
        /// caso de sistema) o negar el acceso (el caso de usuario). Un error acá NO puede tumbar el
        /// feed de mercado.
        /// </summary>
        private async Task<TastytradeCredential?> QueryAsync(
            Func<IQueryable<DataFeed.Repositories.Entities.Account>, IQueryable<DataFeed.Repositories.Entities.Account>> filter,
            CancellationToken ct)
        {
            using var scope = _services.CreateScope();
            var db = scope.ServiceProvider.GetService<GaleCoreDbContext>();
            if (db == null) return null;   // la base no está configurada: no es un error

            try
            {
                var account = await filter(db.Accounts.AsNoTracking())
                    .OrderBy(a => a.CreatedAt)
                    .FirstOrDefaultAsync(ct);

                if (account == null) return null;

                return new TastytradeCredential(
                    Id: account.Id.ToString(),
                    RefreshToken: _protector.Unprotect(account.RefreshTokenEncrypted),
                    AccountNumber: account.AccountNumber,
                    Source: "db");
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "No se pudo resolver la credencial desde la base.");
                return null;
            }
        }

        private TastytradeCredential FromConfig()
        {
            var refreshToken = _config["Tastytrade:OAuth:refresh_token"];
            if (string.IsNullOrWhiteSpace(refreshToken))
                throw new InvalidOperationException(
                    "No hay credencial de sistema: ninguna cuenta marcada is_system en la base y " +
                    "Tastytrade:OAuth:refresh_token vacío en configuración.");

            return new TastytradeCredential(
                Id: "config",
                RefreshToken: refreshToken,
                AccountNumber: _config["Tastytrade:AccountNumber"],
                Source: "config");
        }
    }
}

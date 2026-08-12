using System.Collections.Concurrent;
using DataFeed.Repositories;
using DataFeed.Repositories.Entities;
using Microsoft.EntityFrameworkCore;

namespace DataFeed.Api.Infrastructure
{
    /// <summary>
    /// El nivel de USUARIO del switch de estrategia: la tabla `user_strategies`.
    ///
    /// Es el complemento de <see cref="RpfStrategySwitch"/> / <see cref="GexStrategySwitch"/>, que
    /// son el nivel de PLATAFORMA (kill switch en archivo). La resolución entre los tres niveles es
    /// <see cref="DataFeed.Application.App.Shared.StrategyEnablement.Resolve"/>.
    ///
    /// SIN BASE CONFIGURADA NO EXISTE EL NIVEL DE USUARIO, y eso no es un error: `Program.cs`
    /// registra el DbContext solo si hay cadena, a propósito, para que la API levante y sirva el
    /// feed sin base. En ese caso <see cref="DatabaseConfigured"/> es false, el switch se comporta
    /// exactamente como antes de existir esta clase (manda el archivo) y nadie ve una excepción.
    ///
    /// ANTE UNA FALLA DE LA BASE ES PERMISIVO: <see cref="AnyUserEnabledAsync"/> devuelve true si no
    /// puede consultar. No convierte a la base en un kill switch de hecho — quien corta el feed es
    /// el archivo de plataforma, que se lee sin red. Si la base se cae, lo peor que pasa es que un
    /// proceso siga corriendo con la plataforma en ON, que es justo lo que el operador autorizó.
    /// </summary>
    public class UserStrategySwitchStore
    {
        private readonly IServiceScopeFactory _scopeFactory;
        private readonly ILogger<UserStrategySwitchStore> _logger;

        // El loop de RPF pregunta en cada tick (30s) y el barrido de GEX en cada request: la
        // respuesta cambia solo cuando alguien toca su switch, y ese POST invalida la entrada.
        // El TTL es la red de seguridad para un cambio hecho por fuera (UPDATE a mano en la base).
        private static readonly TimeSpan AnyUserTtl = TimeSpan.FromSeconds(30);
        private readonly ConcurrentDictionary<string, (DateTime At, bool Value)> _anyUserCache = new();

        public UserStrategySwitchStore(IServiceScopeFactory scopeFactory, ILogger<UserStrategySwitchStore> logger)
        {
            _scopeFactory = scopeFactory;
            _logger = logger;
        }

        /// <summary>¿Hay base? Si no, no hay noción de usuario y manda el nivel de plataforma.</summary>
        public bool DatabaseConfigured
        {
            get
            {
                using var scope = _scopeFactory.CreateScope();
                return scope.ServiceProvider.GetService<GaleCoreDbContext>() != null;
            }
        }

        /// <summary>
        /// Override del usuario, o null si nunca tocó el switch (ahí manda la plataforma). También
        /// null si no hay base: sin base no hay nivel de usuario que consultar.
        /// </summary>
        public async Task<bool?> ReadUserOverrideAsync(Guid userId, string strategyId, CancellationToken ct)
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetService<GaleCoreDbContext>();
            if (db == null) return null;

            try
            {
                var row = await db.UserStrategies.AsNoTracking()
                    .FirstOrDefaultAsync(x => x.UserId == userId && x.StrategyId == strategyId, ct);
                return row?.Enabled;
            }
            catch (Exception ex)
            {
                // Que no se pueda leer la preferencia no puede tumbar la lectura del switch: se
                // reporta lo que manda la plataforma, que es lo que corta de verdad.
                _logger.LogWarning(ex, "No se pudo leer user_strategies ({StrategyId}, usuario {UserId}). " +
                    "Se resuelve con el nivel de plataforma.", strategyId, userId);
                return null;
            }
        }

        /// <summary>
        /// Escribe la preferencia del usuario. Materializa la fila de `users` si no existe: la
        /// identidad la maneja Supabase Auth y esta base solo le cuelga las FK, igual que hace
        /// LinkBrokerAccount la primera vez que alguien válido aparece.
        /// </summary>
        public async Task SetUserAsync(Guid userId, string? email, string strategyId, bool enabled, CancellationToken ct)
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<GaleCoreDbContext>();

            var user = await db.Users.FirstOrDefaultAsync(u => u.Id == userId, ct);
            if (user == null)
            {
                db.Users.Add(new User
                {
                    Id = userId,
                    Email = email ?? $"{userId}@sin-mail.local",
                    CreatedAt = DateTime.UtcNow,
                    UpdatedAt = DateTime.UtcNow,
                });
            }

            var row = await db.UserStrategies
                .FirstOrDefaultAsync(x => x.UserId == userId && x.StrategyId == strategyId, ct);

            if (row == null)
            {
                row = new UserStrategy { UserId = userId, StrategyId = strategyId };
                db.UserStrategies.Add(row);
            }

            row.Enabled = enabled;
            row.UpdatedAt = DateTime.UtcNow;

            await db.SaveChangesAsync(ct);

            _anyUserCache.TryRemove(strategyId, out _);

            _logger.LogInformation("Switch de {StrategyId} → {State} para el usuario {UserId}",
                strategyId, enabled ? "ON" : "OFF", userId);
        }

        /// <summary>
        /// ¿Le sirve a alguien que la estrategia trabaje? El loop de RPF es UNO solo para todos, así
        /// que la pregunta que decide si corre no es "¿la tiene prendida tal usuario?" sino "¿queda
        /// alguno que la tenga prendida?". Un usuario sin fila cuenta como ON: no tocó el switch.
        ///
        /// Devuelve true sin consultar si no hay base, si no hay usuarios registrados, o si la
        /// consulta falla — ver la nota de la clase sobre por qué es permisivo.
        /// </summary>
        public async Task<bool> AnyUserEnabledAsync(string strategyId, CancellationToken ct)
        {
            if (_anyUserCache.TryGetValue(strategyId, out var hit) && DateTime.UtcNow - hit.At < AnyUserTtl)
                return hit.Value;

            var value = await QueryAnyUserEnabledAsync(strategyId, ct);
            _anyUserCache[strategyId] = (DateTime.UtcNow, value);
            return value;
        }

        private async Task<bool> QueryAnyUserEnabledAsync(string strategyId, CancellationToken ct)
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetService<GaleCoreDbContext>();
            if (db == null) return true;

            try
            {
                // Sin usuarios registrados no hay a quién preguntarle. Es el caso de una instalación
                // recién migrada, donde nadie vinculó cuenta todavía: la plataforma manda sola.
                if (!await db.Users.AnyAsync(ct)) return true;

                return await db.Users.AsNoTracking().AnyAsync(
                    u => !db.UserStrategies.Any(us =>
                        us.UserId == u.Id && us.StrategyId == strategyId && !us.Enabled), ct);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "No se pudo consultar user_strategies para {StrategyId}. " +
                    "Se asume que hay al menos un usuario con la estrategia prendida.", strategyId);
                return true;
            }
        }

        /// <summary>
        /// ¿Es admin de la plataforma? Permiso de la aplicación, no del bróker: habilita tocar el
        /// kill switch de plataforma, que afecta a todos. Sin base, o sin fila, no es admin.
        /// </summary>
        public async Task<bool> IsAdminAsync(Guid userId, CancellationToken ct)
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetService<GaleCoreDbContext>();
            if (db == null) return false;

            try
            {
                return await db.Users.AsNoTracking()
                    .Where(u => u.Id == userId)
                    .Select(u => u.IsAdmin)
                    .FirstOrDefaultAsync(ct);
            }
            catch (Exception ex)
            {
                // Fail-closed: si no se puede comprobar el permiso, no se concede.
                _logger.LogWarning(ex, "No se pudo comprobar is_admin del usuario {UserId}.", userId);
                return false;
            }
        }
    }
}

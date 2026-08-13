using DataFeed.Repositories;
using DataFeed.Repositories.Entities;
using Microsoft.EntityFrameworkCore;

namespace DataFeed.Api.Infrastructure
{
    /// <summary>
    /// Lo que la API necesita saber de la tabla `users`: si quien llama es admin de la plataforma, y
    /// materializar su fila la primera vez que aparece.
    ///
    /// SIN BASE CONFIGURADA NO HAY USUARIOS QUE CONSULTAR, y eso no es un error: `Program.cs`
    /// registra el DbContext solo si hay cadena, a propósito, para que la API levante y sirva el
    /// feed sin base. En ese caso <see cref="DatabaseConfigured"/> es false y quien pregunta decide
    /// qué hacer — el switch, por ejemplo, se comporta como antes de que existiera la base.
    ///
    /// Se llamaba `UserStrategySwitchStore` hasta el 2026-08-12, cuando además del nivel por
    /// usuario del switch resolvía si un proceso compartido le servía a alguien. Ese nivel se
    /// eliminó con la tabla `user_strategies` (ver docs/GaleCore-plan-reorganizacion-2026-08.md,
    /// etapa 1): el switch es global y lo único que quedó de esta clase es el permiso.
    /// </summary>
    public class UserStore
    {
        private readonly IServiceScopeFactory _scopeFactory;
        private readonly ILogger<UserStore> _logger;

        public UserStore(IServiceScopeFactory scopeFactory, ILogger<UserStore> logger)
        {
            _scopeFactory = scopeFactory;
            _logger = logger;
        }

        /// <summary>¿Hay base? Si no, no hay noción de usuario ni de permisos.</summary>
        public bool DatabaseConfigured
        {
            get
            {
                using var scope = _scopeFactory.CreateScope();
                return scope.ServiceProvider.GetService<GaleCoreDbContext>() != null;
            }
        }

        /// <summary>
        /// Materializa la fila de `users` si no existe, y devuelve true si la creó.
        ///
        /// LA IDENTIDAD LA MANEJA SUPABASE AUTH: los usuarios se dan de alta allá y esta tabla solo
        /// les cuelga las FK y el permiso de la aplicación. Por eso la fila nace en el primer
        /// request autenticado de cada uno y no hay endpoint de alta.
        ///
        /// Se llama desde `/Me`, o sea en el primer request que hace el tablero al entrar. Eso
        /// importa para la pantalla de administración: si la fila naciera recién al vincular una
        /// cuenta de bróker, un usuario recién creado en Supabase sería INVISIBLE para el admin
        /// —y no habría forma de darle permisos— hasta que vinculara una cuenta.
        ///
        /// El uuid y el mail salen del token, nunca del body de un request.
        /// </summary>
        public async Task<bool> EnsureUserAsync(Guid userId, string? email, CancellationToken ct)
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetService<GaleCoreDbContext>();
            if (db == null) return false;

            try
            {
                if (await db.Users.AnyAsync(u => u.Id == userId, ct)) return false;

                db.Users.Add(new User
                {
                    Id = userId,
                    Email = email ?? $"{userId}@sin-mail.local",
                    CreatedAt = DateTime.UtcNow,
                    UpdatedAt = DateTime.UtcNow,
                });

                await db.SaveChangesAsync(ct);
                _logger.LogInformation("Usuario {UserId} materializado en `users` (primer request autenticado).", userId);
                return true;
            }
            catch (DbUpdateException ex)
            {
                // Dos requests del mismo usuario recién creado pueden entrar a la vez (el tablero
                // dispara varias llamadas al montar). La PK resuelve el empate; el perdedor no tiene
                // nada que hacer y no es un error.
                _logger.LogDebug(ex, "Carrera al materializar el usuario {UserId}: ya existía.", userId);
                return false;
            }
            catch (Exception ex)
            {
                // Que no se pueda materializar no puede tumbar el request: lo peor que pasa es que
                // el usuario todavía no figure en la lista del admin.
                _logger.LogWarning(ex, "No se pudo materializar el usuario {UserId}.", userId);
                return false;
            }
        }

        /// <summary>
        /// ¿Es admin de la plataforma? Permiso de la aplicación, no del bróker: habilita tocar el
        /// kill switch de las estrategias y de los servicios, que afecta a todos.
        ///
        /// FAIL-CLOSED: sin base, sin fila, o si la consulta falla, no es admin. Es lo contrario
        /// del criterio del kill switch en sí —que ante la duda deja correr— porque acá lo que se
        /// resuelve es un permiso, y un permiso que se concede cuando no se puede comprobar no es
        /// un permiso.
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
                _logger.LogWarning(ex, "No se pudo comprobar is_admin del usuario {UserId}.", userId);
                return false;
            }
        }
    }
}

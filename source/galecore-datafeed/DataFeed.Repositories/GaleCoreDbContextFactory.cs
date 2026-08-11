using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using Microsoft.Extensions.Configuration;

namespace DataFeed.Repositories
{
    /// <summary>
    /// Fábrica que usa SOLO el tooling de EF (dotnet ef migrations / database update). No participa
    /// en el runtime de la API: ahí el DbContext lo arma la inyección de dependencias.
    ///
    /// Existe para que el tooling no dependa del proyecto Api. Si no existiera, `migrations add`
    /// tendría que resolver el DbContext desde la DI de la API — y como ahí el registro es
    /// condicional a que haya cadena configurada, un desarrollador sin el secreto no podría ni
    /// generar una migración.
    ///
    /// Busca la cadena en tres lugares, en orden:
    ///   1. GALECORE_DB (variable de entorno) — para CI y para apuntar a otra base a propósito.
    ///   2. El secret store de DataFeed.Api, la MISMA cadena que usa la API en local. Así aplicar
    ///      migraciones no obliga a poner la contraseña en una variable de entorno, que quedaría en
    ///      la sesión y en el historial de la shell.
    ///   3. Un placeholder, que alcanza para `migrations add`: generar el SQL necesita el modelo,
    ///      no una conexión viva.
    /// </summary>
    public class GaleCoreDbContextFactory : IDesignTimeDbContextFactory<GaleCoreDbContext>
    {
        /// <summary>
        /// UserSecretsId de DataFeed.Api. No es un secreto — es el mismo identificador que está en
        /// el .csproj, y solo dice en qué carpeta de %APPDATA% buscar. Si se regenera allá, hay que
        /// actualizarlo acá.
        /// </summary>
        private const string ApiUserSecretsId = "129a9ead-8af9-443d-87fd-2c4529063094";

        private const string PlaceholderForModelOnly =
            "Host=localhost;Port=5432;Database=postgres;Username=postgres;Password=placeholder";

        public GaleCoreDbContext CreateDbContext(string[] args)
        {
            var options = new DbContextOptionsBuilder<GaleCoreDbContext>()
                .UseNpgsql(ResolveConnectionString())
                .UseSnakeCaseNamingConvention()
                .Options;

            return new GaleCoreDbContext(options);
        }

        private static string ResolveConnectionString()
        {
            var fromEnv = Environment.GetEnvironmentVariable("GALECORE_DB");
            if (!string.IsNullOrWhiteSpace(fromEnv)) return fromEnv;

            var fromSecrets = new ConfigurationBuilder()
                .AddUserSecrets(ApiUserSecretsId)
                .Build()
                .GetConnectionString("GaleCore");
            if (!string.IsNullOrWhiteSpace(fromSecrets)) return fromSecrets;

            return PlaceholderForModelOnly;
        }
    }
}

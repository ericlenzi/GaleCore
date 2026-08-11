using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace DataFeed.Repositories
{
    /// <summary>
    /// Fábrica que usa SOLO el tooling de EF (dotnet ef migrations / database update). No participa
    /// en el runtime de la API: ahí el DbContext lo arma la inyección de dependencias.
    ///
    /// Existe para que generar una migración no dependa del proyecto Api ni de una base viva —
    /// `migrations add` necesita el modelo, no una conexión. Por eso el connection string por
    /// defecto es un placeholder: alcanza para generar el SQL.
    ///
    /// Para APLICAR migraciones contra la base real hay que pasar la cadena de verdad por la
    /// variable de entorno GALECORE_DB, que nunca se commitea:
    ///   $env:GALECORE_DB = "Host=...;Port=6543;Database=postgres;Username=...;Password=..."
    ///   dotnet ef database update --project DataFeed.Repositories
    /// </summary>
    public class GaleCoreDbContextFactory : IDesignTimeDbContextFactory<GaleCoreDbContext>
    {
        private const string PlaceholderForModelOnly =
            "Host=localhost;Port=5432;Database=postgres;Username=postgres;Password=placeholder";

        public GaleCoreDbContext CreateDbContext(string[] args)
        {
            var cs = Environment.GetEnvironmentVariable("GALECORE_DB") ?? PlaceholderForModelOnly;

            var options = new DbContextOptionsBuilder<GaleCoreDbContext>()
                .UseNpgsql(cs)
                .UseSnakeCaseNamingConvention()
                .Options;

            return new GaleCoreDbContext(options);
        }
    }
}

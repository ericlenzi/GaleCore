using DataFeed.Repositories.Entities;
using Microsoft.EntityFrameworkCore;

namespace DataFeed.Repositories
{
    /// <summary>
    /// Base de datos de dominio de GaleCore (PostgreSQL en Supabase, base "GaleCore").
    ///
    /// ALCANCE — lo que NO va acá:
    ///   * Las REGLAS de cada estrategia (galecore_rules_&lt;prefijo&gt;.json) y pop_calibration.json
    ///     siguen en git: se editan deliberadamente, se versionan y se revisan en un PR.
    ///   * El estado de runtime (*_switch_state.json, skew25_history.json) sigue en archivos: son
    ///     ~3 KB, ya sobreviven a un reinicio, y una base le agregaría a un kill switch el modo de
    ///     falla "¿y si no responde?".
    ///   * Los datos de mercado NO se publican por acá. El camino caliente es en memoria.
    /// Ver docs/GaleCore-arquitectura-datos.md §5.
    ///
    /// Nombres en snake_case (EFCore.NamingConventions): es lo que espera cualquier SQL escrito a
    /// mano y lo que usa el propio esquema auth de Supabase. Con los nombres PascalCase de EF,
    /// Postgres los deja entre comillas y case-sensitive, que es una molestia permanente.
    /// </summary>
    public class GaleCoreDbContext : DbContext
    {
        public GaleCoreDbContext(DbContextOptions<GaleCoreDbContext> options) : base(options) { }

        public DbSet<User> Users => Set<User>();
        public DbSet<Account> Accounts => Set<Account>();
        public DbSet<Strategy> Strategies => Set<Strategy>();
        public DbSet<UserStrategy> UserStrategies => Set<UserStrategy>();

        protected override void OnModelCreating(ModelBuilder b)
        {
            b.Entity<User>(e =>
            {
                e.ToTable("users");
                e.HasKey(x => x.Id);
                // El uuid lo trae Supabase Auth: EF no debe generarlo ni pedirle uno a Postgres.
                e.Property(x => x.Id).ValueGeneratedNever();
                e.Property(x => x.Email).HasMaxLength(320).IsRequired();
                e.Property(x => x.DisplayName).HasMaxLength(120);
                e.Property(x => x.IsAdmin).HasDefaultValue(false);
                e.Property(x => x.CreatedAt).HasDefaultValueSql("now()");
                e.Property(x => x.UpdatedAt).HasDefaultValueSql("now()");
                e.HasIndex(x => x.Email).IsUnique();
            });

            b.Entity<Account>(e =>
            {
                e.ToTable("accounts");
                e.HasKey(x => x.Id);
                e.Property(x => x.Id).HasDefaultValueSql("gen_random_uuid()");
                e.Property(x => x.Broker).HasMaxLength(40).IsRequired();
                e.Property(x => x.AccountNumber).HasMaxLength(40).IsRequired();
                e.Property(x => x.RefreshTokenEncrypted).IsRequired();
                e.Property(x => x.IsSystem).HasDefaultValue(false);
                e.Property(x => x.CreatedAt).HasDefaultValueSql("now()");
                e.Property(x => x.UpdatedAt).HasDefaultValueSql("now()");

                e.HasOne(x => x.User)
                 .WithMany(u => u.Accounts)
                 .HasForeignKey(x => x.UserId)
                 .OnDelete(DeleteBehavior.Cascade);

                e.HasIndex(x => new { x.UserId, x.Broker, x.AccountNumber }).IsUnique();

                // Como máximo UNA cuenta de sistema en toda la plataforma. Se hace con un índice
                // único parcial y no con lógica de aplicación: si hubiera dos, los procesos de fondo
                // elegirían una al azar y el bug sería intermitente y carísimo de encontrar.
                e.HasIndex(x => x.IsSystem)
                 .IsUnique()
                 .HasFilter("is_system")
                 .HasDatabaseName("ix_accounts_single_system");
            });

            b.Entity<Strategy>(e =>
            {
                e.ToTable("strategies", t => t.HasCheckConstraint(
                    "ck_strategies_kind", "kind IN ('operativa', 'informativa')"));
                e.HasKey(x => x.Id);
                e.Property(x => x.Id).HasMaxLength(20).ValueGeneratedNever();
                e.Property(x => x.Prefix).HasMaxLength(20).IsRequired();
                e.Property(x => x.Label).HasMaxLength(60).IsRequired();
                e.Property(x => x.Name).HasMaxLength(120).IsRequired();
                e.Property(x => x.Description).IsRequired();
                e.Property(x => x.Kind).HasMaxLength(20).IsRequired();
                e.Property(x => x.RulesEndpoint).HasMaxLength(200).IsRequired();
                e.Property(x => x.SwitchEndpoint).HasMaxLength(200).IsRequired();
                e.Property(x => x.CreatedAt).HasDefaultValueSql("now()");
                e.Property(x => x.UpdatedAt).HasDefaultValueSql("now()");
                e.HasIndex(x => x.Prefix).IsUnique();
            });

            b.Entity<UserStrategy>(e =>
            {
                e.ToTable("user_strategies");
                e.HasKey(x => new { x.UserId, x.StrategyId });
                e.Property(x => x.StrategyId).HasMaxLength(20);
                e.Property(x => x.Enabled).HasDefaultValue(false);
                e.Property(x => x.UpdatedAt).HasDefaultValueSql("now()");

                e.HasOne(x => x.User)
                 .WithMany(u => u.Strategies)
                 .HasForeignKey(x => x.UserId)
                 .OnDelete(DeleteBehavior.Cascade);

                e.HasOne(x => x.Strategy)
                 .WithMany(s => s.Users)
                 .HasForeignKey(x => x.StrategyId)
                 .OnDelete(DeleteBehavior.Cascade);
            });
        }
    }
}

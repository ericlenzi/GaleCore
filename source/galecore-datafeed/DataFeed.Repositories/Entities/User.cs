namespace DataFeed.Repositories.Entities
{
    /// <summary>
    /// Operador de la plataforma.
    ///
    /// El <see cref="Id"/> NO lo genera esta base: es el mismo uuid que Supabase Auth le asigna al
    /// usuario en su tabla auth.users. La autenticación (contraseñas, reset, verificación de mail)
    /// la maneja Supabase; esta tabla existe para colgarle las FK de la aplicación y los datos que
    /// son nuestros. Es el patrón de "profiles" de Supabase, con el nombre que usa el proyecto.
    /// </summary>
    public class User
    {
        /// <summary>uuid de Supabase Auth (auth.users.id). No se genera acá.</summary>
        public Guid Id { get; set; }

        public string Email { get; set; } = "";

        public string? DisplayName { get; set; }

        /// <summary>
        /// Habilita la administración de usuarios desde la aplicación y el kill switch de las
        /// estrategias y servicios, que apaga para todos. Es un permiso de la plataforma, no del
        /// bróker: un admin administra usuarios, NO ve las cuentas ajenas. Las posiciones y
        /// balances siguen saliendo de la cuenta de cada uno.
        /// </summary>
        public bool IsAdmin { get; set; }

        public DateTime CreatedAt { get; set; }
        public DateTime UpdatedAt { get; set; }

        public ICollection<Account> Accounts { get; set; } = new List<Account>();
    }
}

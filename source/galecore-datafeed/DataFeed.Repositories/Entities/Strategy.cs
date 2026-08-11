namespace DataFeed.Repositories.Entities
{
    /// <summary>
    /// Catálogo de estrategias implementadas. Reemplaza a strategies[] de galecore_rules_core.json.
    ///
    /// Es SOLO catálogo: acá no vive el ON/OFF. El switch es por usuario y vive en
    /// <see cref="UserStrategy"/> — si el enabled estuviera acá sería global y los operadores se
    /// pisarían el switch entre ellos.
    ///
    /// CUIDADO CON EL CASE, que no es cosmético (convención de CLAUDE.md):
    ///   Id     minúscula  — "rpf"  (id, y tab del front)
    ///   Prefix capitalizado — "Rpf" (ruta /App/Rpf, carpeta Files/Rpf/, tag de Swagger App.Rpf)
    ///
    /// El Prefix está COMPILADO en el código ([Route("App/Rpf")], la carpeta de archivos, el tag de
    /// Swagger y el id de pestaña del front). Si la fila dice otro prefijo, la fila miente y no hay
    /// compilador que avise. Ese invariante lo cuidaba RulesJsonTests sobre el JSON; al mudarse a la
    /// base hay que reemplazarlo por un test que valide estas filas contra las rutas compiladas.
    /// </summary>
    public class Strategy
    {
        /// <summary>Clave natural en minúscula: "rpf", "gex". Es también el id de pestaña del front.</summary>
        public string Id { get; set; } = "";

        /// <summary>Prefijo capitalizado: "Rpf", "Gex". Manda en ruta HTTP, carpeta y tag de Swagger.</summary>
        public string Prefix { get; set; } = "";

        public string Label { get; set; } = "";
        public string Name { get; set; } = "";
        public string Description { get; set; } = "";

        /// <summary>"operativa" | "informativa". Restringido por check constraint.</summary>
        public string Kind { get; set; } = "";

        /// <summary>
        /// Versión de la estrategia. OJO con la doble fuente de verdad: cada
        /// galecore_rules_&lt;prefijo&gt;.json tiene su _meta.version. Si las dos se mantienen a mano
        /// van a driftear — hay que decidir cuál manda (decisión pendiente del doc de arquitectura).
        /// </summary>
        public string? Version { get; set; }

        public string RulesEndpoint { get; set; } = "";
        public string SwitchEndpoint { get; set; } = "";

        public DateTime CreatedAt { get; set; }
        public DateTime UpdatedAt { get; set; }

        public ICollection<UserStrategy> Users { get; set; } = new List<UserStrategy>();
    }
}

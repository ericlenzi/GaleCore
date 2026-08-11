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

        // NO hay columna Version a propósito. La versión de una estrategia sale del _meta.version de
        // su galecore_rules_<prefijo>.json, que es su fuente de verdad y se edita junto con las
        // reglas que describe. Guardarla también acá creaba un segundo lugar con el mismo dato y sin
        // nadie que los sincronice: el JSON manda, y quien sirva el catálogo la lee de ahí.

        public string RulesEndpoint { get; set; } = "";
        public string SwitchEndpoint { get; set; } = "";

        public DateTime CreatedAt { get; set; }
        public DateTime UpdatedAt { get; set; }

        public ICollection<UserStrategy> Users { get; set; } = new List<UserStrategy>();
    }
}

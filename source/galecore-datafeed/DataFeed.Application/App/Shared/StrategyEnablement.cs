namespace DataFeed.Application.App.Shared
{
    /// <summary>
    /// Resolución del switch ON/OFF de una estrategia, que tiene TRES niveles y no uno.
    ///
    /// Función pura y compartida por las dos estrategias, como los primitivos de
    /// <see cref="CascadeUtils"/>: no lee archivos ni base — recibe los tres valores ya leídos.
    /// Está acá y no en la capa Api para que la tabla de verdad se pueda testear sin levantar nada.
    ///
    ///   | Nivel      | Dónde vive                                   | Ausente significa     |
    ///   |------------|----------------------------------------------|-----------------------|
    ///   | reglas     | galecore_rules_&lt;prefijo&gt;.json (git)          | — (es el piso)        |
    ///   | plataforma | Files/&lt;Prefijo&gt;/&lt;prefijo&gt;_switch_state.json    | manda reglas          |
    ///   | usuario    | tabla user_strategies                        | manda plataforma      |
    ///
    /// LA PLATAFORMA GANA CUANDO APAGA. Es el kill switch del operador: corta el consumo de feed y
    /// la emisión para todos, y un usuario no puede prenderla desde su tablero. El nivel de usuario
    /// solo decide si la estrategia trabaja PARA ÉL, y por eso vive en la base (es dominio, no
    /// estado de runtime) mientras que el kill switch se queda en un archivo — una base caída no
    /// puede volver a prender algo que se apagó a propósito. Ver docs/GaleCore-arquitectura-datos.md §5.
    /// </summary>
    public static class StrategyEnablement
    {
        /// <summary>Manda el JSON de reglas: nadie tocó ningún switch.</summary>
        public const string SourceRules = "rules";

        /// <summary>Manda el archivo de estado de la estrategia (kill switch del operador).</summary>
        public const string SourcePlatform = "platform";

        /// <summary>Manda la fila de user_strategies del usuario que pregunta.</summary>
        public const string SourceUser = "user";

        /// <summary>
        /// Estado efectivo para UN usuario, y qué nivel lo decidió.
        /// </summary>
        /// <param name="rules">Lo que declara el JSON de reglas de la estrategia.</param>
        /// <param name="platform">Override de plataforma, o null si nunca se tocó.</param>
        /// <param name="user">
        /// Override del usuario, o null si nunca lo tocó — o si no hay usuario en el request, que es
        /// el caso de una llamada de máquina a máquina con API key.
        /// </param>
        public static (bool Enabled, string Source) Resolve(bool rules, bool? platform, bool? user)
        {
            var platformEnabled = platform ?? rules;
            var platformSource = platform.HasValue ? SourcePlatform : SourceRules;

            // La plataforma apagada no se discute: el usuario no puede prenderla, así que el nivel
            // que decide es el de arriba aunque el usuario también la tenga en OFF.
            if (!platformEnabled) return (false, platformSource);

            if (user == false) return (false, SourceUser);

            return (true, user == true ? SourceUser : platformSource);
        }
    }
}

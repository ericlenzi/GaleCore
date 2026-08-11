namespace DataFeed.Repositories.Entities
{
    /// <summary>
    /// El switch ON/OFF de una estrategia PARA UN USUARIO. Es el override que hoy vive en
    /// Files/&lt;Prefijo&gt;/&lt;prefijo&gt;_switch_state.json, ahora por usuario.
    ///
    /// Que sea por usuario NO significa que el backend corra un loop por usuario. El tick de una
    /// estrategia tiene una parte que no depende de nadie (régimen macro, gates, candidato: SPY es
    /// SPY para todos) y otra que depende de la cuenta (cupo, heat, IN_POSITION, sizing). El trabajo
    /// pesado se hace UNA vez y la parte de cuenta se resuelve por usuario al final. Dos loops
    /// evaluando lo mismo duplicarían el consumo del feed, que es justo lo que el doc de
    /// arquitectura viene a evitar.
    ///
    /// Fila ausente = nunca se tocó el switch. Igual que hoy, cuando no existe el archivo de estado.
    /// </summary>
    public class UserStrategy
    {
        public Guid UserId { get; set; }
        public User? User { get; set; }

        public string StrategyId { get; set; } = "";
        public Strategy? Strategy { get; set; }

        public bool Enabled { get; set; }

        public DateTime UpdatedAt { get; set; }
    }
}

namespace DataFeed.Application.App.Rpf
{
    /// <summary>
    /// Snapshot liviano del estado del loop por símbolo (diseño Fase 5 §5.4). Se emite al grupo SignalR
    /// "rpf" (evento ReceiveRpfState) en cada cambio de estado; alimenta el cockpit del tablero.
    /// </summary>
    public class RpfStateUpdate
    {
        public string Symbol { get; set; } = "";
        /// <summary>Estado canónico (IN_POSITION/VETOED/DORMANT/ARMED/WAITING_CAPACITY/COOLDOWN/TRIGGERED).</summary>
        public string State { get; set; } = "";

        /// <summary>Resultado de cada check de Tier A (gate → pass) para pintar el semáforo del cockpit.</summary>
        public Dictionary<string, bool> TierA { get; set; } = new();

        public double? Edge { get; set; }
        public double? Bar { get; set; }
        public string? Regime { get; set; }
        public bool CapacityAvailable { get; set; }

        /// <summary>Segundos restantes de cooldown (null si no está en cooldown).</summary>
        public int? CooldownRemainingSec { get; set; }
        /// <summary>Id de la sugerencia vigente si el estado es TRIGGERED (para atar el ack).</summary>
        public string? SuggestionId { get; set; }

        public DateTime Timestamp { get; set; }
    }
}

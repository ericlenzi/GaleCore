using DataFeed.Application.App.ValidationLayer;

namespace DataFeed.Application.App.PositionBuilder
{
    // ═══════════════════════════════════════════════════════════════════════
    // Top-level Response — GET /App/GaleCore/PositionBuilder
    // Incluye structureInputs detallados que ValidationLayer no expone.
    // ═══════════════════════════════════════════════════════════════════════

    public class PositionBuilderResponse
    {
        public string Symbol { get; set; }
        public string Profile { get; set; }
        public DateTime Timestamp { get; set; }
        public double SpotPrice { get; set; }
        public string OverallSignal { get; set; }

        public StructureInputs StructureInputs { get; set; }
        public SelectedStructureResult SelectedStructure { get; set; }

        /// <summary>Reutiliza el tipo de ValidationLayer (Layer 2).</summary>
        public StrikeEngineResult? StrikeEngine { get; set; }

        /// <summary>Reutiliza el tipo de ValidationLayer (Layer 3).</summary>
        public MicrostructureResult? Microstructure { get; set; }

        /// <summary>Reutiliza el tipo de ValidationLayer (Layer 4).</summary>
        public RiskAndSizingResult? RiskAndSizing { get; set; }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Structure Inputs — multi-factor inputs detallados
    // ═══════════════════════════════════════════════════════════════════════

    public class StructureInputs
    {
        public PriceZScoreInput PriceZScore { get; set; }
        public GexSignInput GexSign { get; set; }
        public TrendInput Trend { get; set; }
        public RealizedVolInput RealizedVolRegime { get; set; }
        public AggressiveFlowInput? AggressiveFlow { get; set; }
    }

    public class PriceZScoreInput
    {
        public double Value { get; set; }
        public string Formula { get; set; } = "ret_5d / (iv_atm / sqrt(252))";
        public double Ret5d { get; set; }
        public double IvAtm { get; set; }
        public string Interpretation { get; set; }
    }

    public class GexSignInput
    {
        public string Value { get; set; }
        public double NetGexBillions { get; set; }
        public string Interpretation { get; set; }
    }

    public class TrendInput
    {
        public double? Ema20 { get; set; }
        public double? Ema50 { get; set; }
        public string Signal { get; set; }
        public string Interpretation { get; set; }
    }

    public class RealizedVolInput
    {
        public double? Rv10d { get; set; }
        public double? Rv30d { get; set; }
        public string Signal { get; set; }
        public string Interpretation { get; set; }
    }

    public class AggressiveFlowInput
    {
        public string Signal { get; set; } = "unavailable";
        public string DataSource { get; set; } = "not_implemented";
        public string? Note { get; set; } = "Requiere SubscribeFlow activo via WebSocket";

        // Campos reales — poblados cuando el flow tracking esta activo
        public double? BullishPremiumUsd { get; set; }
        public double? BearishPremiumUsd { get; set; }
        public double? NetDeltaFlow { get; set; }
        public string? DominantSide { get; set; }
        public int? WindowMinutes { get; set; }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Selected Structure — regla que matcheó con condiciones evaluadas
    // ═══════════════════════════════════════════════════════════════════════

    public class SelectedStructureResult
    {
        public string Output { get; set; }
        public int? RuleId { get; set; }
        public string? RuleName { get; set; }
        public string? RuleLabel { get; set; }
    }
}

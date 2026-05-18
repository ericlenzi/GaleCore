namespace DataFeed.Application.App.ValidationLayer
{
    public class ValidationLayerResponse
    {
        public string Symbol { get; set; }
        public string Profile { get; set; }
        public DateTime Timestamp { get; set; }
        public double SpotPrice { get; set; }
        public string Signal { get; set; }
        public int? FailedAtLayer { get; set; }

        public Layer1MacroResult? Layer1 { get; set; }
        public Layer2StrikesResult? Layer2 { get; set; }
        public Layer3MicroResult? Layer3 { get; set; }
        public Layer4SizingResult? Layer4 { get; set; }
    }

    // --- Layer 1: Régimen Macro y GEX ---

    public class Layer1MacroResult
    {
        public string Signal { get; set; }
        public int PassedCount { get; set; }
        public int TotalChecks { get; set; }

        public VixTermStructureCheck VixTermStructure { get; set; }
        public IVRankCheck IVRank { get; set; }
        public GexTotalCheck GexTotal { get; set; }
        public SpotVsZglCheck SpotVsZGL { get; set; }
    }

    public class VixTermStructureCheck
    {
        public bool Passed { get; set; }
        public double? IV30_9d { get; set; }
        public double? IV30_90d { get; set; }
        public double? MaxVixAbsolute { get; set; }
    }

    public class IVRankCheck
    {
        public bool Passed { get; set; }
        public double Value { get; set; }
        public double Min { get; set; }
        public double Max { get; set; }
    }

    public class GexTotalCheck
    {
        public bool Passed { get; set; }
        public double Value { get; set; }
        public string Metric { get; set; }
        public double Threshold { get; set; }
    }

    public class SpotVsZglCheck
    {
        public bool Passed { get; set; }
        public double Spot { get; set; }
        public double? ZGL { get; set; }
        public double BufferPct { get; set; }
    }

    // --- Layer 2: Motor de Strikes ---

    public class Layer2StrikesResult
    {
        public string Signal { get; set; }
        public double ExpectedMove { get; set; }
        public int DTE { get; set; }
        public string Expiration { get; set; }
        public double? CallWall { get; set; }
        public double? PutWall { get; set; }
        public double ZScore { get; set; }
        public string SelectedStructure { get; set; }
        public double? ShortPutStrike { get; set; }
        public double? ShortCallStrike { get; set; }
        public double? ShortPutDelta { get; set; }
        public double? ShortCallDelta { get; set; }
        public double? LongPutStrike { get; set; }
        public double? LongCallStrike { get; set; }
        public bool StrikesInsideWalls { get; set; }
    }

    // --- Layer 3: Microestructura ---

    public class Layer3MicroResult
    {
        public string Signal { get; set; }
        public double ATMStrike { get; set; }
        public OICheck ShortCallOI { get; set; }
        public OICheck ShortPutOI { get; set; }
        public OICheck LongCallOI { get; set; }
        public OICheck LongPutOI { get; set; }
        public double? ATMCallDelta { get; set; }
        public double? ATMPutDelta { get; set; }
        public BidAskCheck? BidAskSpread { get; set; }
    }

    public class OICheck
    {
        public bool Passed { get; set; }
        public long Value { get; set; }
        public long MinRequired { get; set; }
    }

    public class BidAskCheck
    {
        public bool Passed { get; set; }
        public double? SpreadPct { get; set; }
        public double MaxSpreadPct { get; set; }
    }

    // --- Layer 4: Sizing y Riesgo ---

    public class Layer4SizingResult
    {
        public string Signal { get; set; }
        public decimal NetLiq { get; set; }
        public decimal RiskPerTrade { get; set; }
        public decimal MaxRiskAmount { get; set; }
        public int OpenPositions { get; set; }
        public int MaxPositions { get; set; }
        public bool PositionsAvailable { get; set; }
        public double CurrentHeatPct { get; set; }
        public double MaxHeatPct { get; set; }
        public bool HeatOk { get; set; }
    }
}

using System.Text.Json.Nodes;

namespace DataFeed.Application.App.SignalGates
{
    /// <summary>
    /// Lectura de la historia diaria de skew25 (Files/skew25_history.json), persistida por
    /// SkewSnapshotService. Formato: { "SPY": [ {"date":"2026-07-20","skew25":1.14}, ... ] }
    /// (ascendente por fecha). Se usa para el RoC 5d del componente skew del gate tail_score:
    /// roc = skew25_live / skew25(hace 5 sesiones) - 1.
    /// </summary>
    public sealed class SkewHistory
    {
        private readonly Dictionary<string, List<double>> _bySymbol; // valores en orden ascendente por fecha

        private SkewHistory(Dictionary<string, List<double>> bySymbol) => _bySymbol = bySymbol;

        public static SkewHistory Parse(string json)
        {
            var map = new Dictionary<string, List<double>>(StringComparer.OrdinalIgnoreCase);
            var root = JsonNode.Parse(json)?.AsObject();
            if (root != null)
            {
                foreach (var kvp in root)
                {
                    var rows = kvp.Value?.AsArray();
                    if (rows == null) continue;
                    var vals = new List<double>();
                    foreach (var r in rows)
                    {
                        double? s = r?["skew25"]?.GetValue<double>();
                        if (s is > 0) vals.Add(s.Value);
                    }
                    map[kvp.Key] = vals;
                }
            }
            return new SkewHistory(map);
        }

        /// <summary>
        /// Valor de skew25 de hace <paramref name="sessions"/> sesiones respecto de la sesión "actual"
        /// (que llega live, fuera de la serie). Con serie [t-5..t-1] y sessions=5 devuelve t-5.
        /// Null si no hay suficiente historia.
        /// </summary>
        public double? ValueSessionsAgo(string symbol, int sessions)
        {
            if (!_bySymbol.TryGetValue(symbol, out var vals) || vals.Count < sessions) return null;
            return vals[vals.Count - sessions];
        }

        /// <summary>RoC 5d = skew25_live / skew25(hace 5 sesiones) - 1. Null si falta historia.</summary>
        public double? Roc5d(string symbol, double currentSkew25)
        {
            var past = ValueSessionsAgo(symbol, 5);
            if (past is not > 0 || currentSkew25 <= 0) return null;
            return currentSkew25 / past.Value - 1.0;
        }
    }
}

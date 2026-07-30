namespace DataFeed.Application.App.Rpf.Engine
{
    /// <summary>
    /// Resolución PURA del cortocircuito de la cascada RPF → (OverallSignal, FailedAtLayer). Espeja la
    /// semántica de la cascada de Main: solo "NO_OPERAR" corta; "ESPERAR" (macro con 1 check flojo) se
    /// propaga como veredicto pero no frena; los signal_gates cuentan como capa 2 del embudo de strikes.
    /// Función pura y determinista: es la pieza de decisión más propensa a regresión, congelada por tests
    /// sin necesidad de mockear providers.
    /// </summary>
    public static class RpfCascadeResolver
    {
        /// <param name="gatesAllPass">Resultado de los signal_gates. Solo se consulta si macro/strike/micro/sizing pasaron.</param>
        public static (string overall, int? failedAtLayer) Resolve(
            string macroSignal, string strikeSignal, string microSignal, string sizingSignal, bool gatesAllPass)
        {
            if (macroSignal == "NO_OPERAR") return ("NO_OPERAR", 1);

            string cut = macroSignal == "ESPERAR" ? "ESPERAR" : "NO_OPERAR";
            if (strikeSignal == "NO_OPERAR") return (cut, 2);
            if (microSignal == "NO_OPERAR") return (cut, 3);
            if (sizingSignal == "NO_OPERAR") return (cut, 4);

            // Todas las capas pasaron → corren los gates. Si fallan, cortan como capa 2 (embudo de strikes).
            if (!gatesAllPass) return ("NO_OPERAR", 2);

            return (macroSignal, null);
        }
    }
}

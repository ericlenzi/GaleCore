using DataFeed.Infrastructure.Providers.Tastytrade;
using DataFeed.Infrastructure.Providers.Tastytrade.Models;
using MediatR;
using Microsoft.Extensions.Configuration;
using System.Globalization;

namespace DataFeed.Application.App.ImpliedVolatility
{
    /// <summary>
    /// Calcula la volatilidad implícita usando la metodología CBOE VIX.
    /// Fórmula model-free basada en precios de opciones OTM.
    /// Produce equivalentes a VIX9D (9d), VIX (30d) y VIX3M (90d) para cualquier símbolo.
    /// </summary>
    public class ImpliedVolatilityHandler : IRequestHandler<ImpliedVolatilityRequest, ImpliedVolatilityResponse>
    {
        private readonly IConfiguration _config;
        private readonly ITastytradeOAuth _auth;
        private readonly IHttpClientFactory _client;

        private const double DEFAULT_RISK_FREE_RATE = 0.045;

        // Plazos objetivo (en días): VIX9D, VIX, VIX3M
        private static readonly int[] TARGET_DAYS = { 9, 30, 90 };

        public ImpliedVolatilityHandler(IConfiguration config, ITastytradeOAuth auth, IHttpClientFactory client)
        {
            _config = config;
            _auth = auth;
            _client = client;
        }

        public async Task<ImpliedVolatilityResponse> Handle(ImpliedVolatilityRequest request, CancellationToken cancellationToken)
        {
            try
            {
                var response = new ImpliedVolatilityResponse
                {
                    Symbol = request.Symbol,
                    RiskFreeRate = DEFAULT_RISK_FREE_RATE
                };

                // ═══════════════════════════════════════════════════════════
                // PASO 1: Obtener spot price y cadena de opciones (REST)
                // El spot se obtiene por REST para no competir con la conexión
                // persistente de DxLinkStreamingService al usar el WebSocket.
                // ═══════════════════════════════════════════════════════════
                var apiProvider = new TastytradeApiProvider(_config, _auth, _client);

                var marketData = await apiProvider.GetMarketDataByTypeAsync(request.Symbol, cancellationToken);
                double spot = marketData?.Data?.Items?.FirstOrDefault()?.Mark ?? 0;
                if (spot <= 0)
                    spot = marketData?.Data?.Items?.FirstOrDefault()?.Last ?? 0;
                if (spot <= 0)
                    throw new Exception($"No se pudo obtener el precio spot de {request.Symbol}");

                var optionChains = await apiProvider.GetOptionChainsAsync(request.Symbol, cancellationToken);

                var allExpirations = optionChains?.data?.items?.SelectMany(i => i.expirations).ToList();
                if (allExpirations == null || !allExpirations.Any())
                    throw new Exception($"No se encontraron cadenas de opciones para {request.Symbol}");

                // Filtrar expiraciones válidas (DTE > 0), incluir Regular y Weekly
                var validExpirations = allExpirations
                    .Where(e => e.DaysToExpiration > 0 && e.strikes != null && e.strikes.Count > 0)
                    .OrderBy(e => e.DaysToExpiration)
                    .ToList();

                if (!validExpirations.Any())
                    throw new Exception($"No se encontraron expiraciones válidas para {request.Symbol}");

                // ═══════════════════════════════════════════════════════════
                // PASO 2: Seleccionar expiraciones para cada plazo objetivo
                // Para cada target, necesitamos near-term (T1 ≤ target) y
                // next-term (T2 > target) para interpolar
                // ═══════════════════════════════════════════════════════════
                var expirationsNeeded = new HashSet<Expiration>();
                var targetPairs = new Dictionary<int, (Expiration Near, Expiration Next)>();

                foreach (var target in TARGET_DAYS)
                {
                    var near = validExpirations.Where(e => e.DaysToExpiration <= target).LastOrDefault();
                    var next = validExpirations.Where(e => e.DaysToExpiration > target).FirstOrDefault();

                    // Si no hay near-term, usar las dos más cortas disponibles
                    if (near == null && next != null)
                    {
                        var nextAfter = validExpirations.Where(e => e.DaysToExpiration > next.DaysToExpiration).FirstOrDefault();
                        near = next;
                        next = nextAfter;
                    }

                    // Si no hay next-term, usar las dos más largas
                    if (next == null && near != null)
                    {
                        var prevBefore = validExpirations.Where(e => e.DaysToExpiration < near.DaysToExpiration).LastOrDefault();
                        next = near;
                        near = prevBefore;
                    }

                    targetPairs[target] = (near, next);

                    if (near != null) expirationsNeeded.Add(near);
                    if (next != null) expirationsNeeded.Add(next);
                }

                if (!expirationsNeeded.Any())
                    throw new Exception($"No se pudieron determinar expiraciones para calcular IV de {request.Symbol}");

                // ═══════════════════════════════════════════════════════════
                // PASO 3: Obtener precios de opciones vía Quote events (bid/ask)
                // Mid-price = (bid+ask)/2 es la fuente estándar para CBOE VIX.
                // Quote events son tiempo real (igual que Greeks), sin snapshot delay.
                // Secuencial por expiración para no interferir con DxLinkStreamingService.
                // ═══════════════════════════════════════════════════════════
                var socketProvider = new TastytradeSocketProvider(_config, _auth, _client);

                var expirationData = new Dictionary<Expiration, ExpirationMarketData>();

                foreach (var exp in expirationsNeeded)
                {
                    var streamerSymbols = new List<string>();
                    var strikeMap = new Dictionary<string, (double Strike, string Type)>();

                    foreach (var strike in exp.strikes)
                    {
                        var strikePrice = double.Parse(strike.StrikePrice, CultureInfo.InvariantCulture);

                        if (!string.IsNullOrEmpty(strike.CallStreamerSymbol))
                        {
                            streamerSymbols.Add(strike.CallStreamerSymbol);
                            strikeMap[strike.CallStreamerSymbol] = (strikePrice, "C");
                        }
                        if (!string.IsNullOrEmpty(strike.PutStreamerSymbol))
                        {
                            streamerSymbols.Add(strike.PutStreamerSymbol);
                            strikeMap[strike.PutStreamerSymbol] = (strikePrice, "P");
                        }
                    }

                    var multiQuote = await socketProvider.GetMultiQuoteAsync(
                        streamerSymbols.ToArray(),
                        cancellationToken
                    );

                    var strikePrices = new Dictionary<double, StrikePrices>();

                    foreach (var kvp in multiQuote.Quotes)
                    {
                        if (!strikeMap.TryGetValue(kvp.Key, out var info)) continue;

                        var q = kvp.Value;
                        // Mid-price = (bid+ask)/2; si solo hay uno, usarlo directamente
                        double price = 0;
                        if (q.BidPrice > 0 && q.AskPrice > 0)
                            price = (q.BidPrice + q.AskPrice) / 2.0;
                        else if (q.AskPrice > 0)
                            price = q.AskPrice;
                        else if (q.BidPrice > 0)
                            price = q.BidPrice;

                        if (price <= 0) continue;

                        if (!strikePrices.ContainsKey(info.Strike))
                            strikePrices[info.Strike] = new StrikePrices();

                        if (info.Type == "C")
                            strikePrices[info.Strike].CallPrice = price;
                        else
                            strikePrices[info.Strike].PutPrice = price;
                    }

                    expirationData[exp] = new ExpirationMarketData { StrikePrices = strikePrices };
                }

                response.Spot = spot;

                // ═══════════════════════════════════════════════════════════
                // PASO 4: Calcular varianza CBOE por expiración y luego
                // interpolar para cada plazo objetivo
                // ═══════════════════════════════════════════════════════════
                double r = DEFAULT_RISK_FREE_RATE;

                foreach (var target in TARGET_DAYS)
                {
                    var (near, next) = targetPairs[target];
                    var detail = new IVCalculationDetail { TargetDays = target };

                    double? nearVariance = null;
                    double? nextVariance = null;
                    int nearOptions = 0, nextOptions = 0;

                    // Calcular varianza near-term
                    if (near != null && expirationData.ContainsKey(near))
                    {
                        var data = expirationData[near];
                        var (variance, optionsUsed) = CalculateCBOEVariance(spot, near.DaysToExpiration, r, data.StrikePrices);
                        if (variance.HasValue && variance.Value > 0)
                        {
                            nearVariance = variance;
                            nearOptions = optionsUsed;
                            detail.NearTermExpiration = near.ExpirationDate;
                            detail.NearTermDTE = near.DaysToExpiration;
                            detail.NearTermVariance = Math.Round(variance.Value, 8);
                            detail.NearTermOptionsUsed = optionsUsed;
                        }
                    }

                    // Calcular varianza next-term
                    if (next != null && expirationData.ContainsKey(next))
                    {
                        var data = expirationData[next];
                        var (variance, optionsUsed) = CalculateCBOEVariance(spot, next.DaysToExpiration, r, data.StrikePrices);
                        if (variance.HasValue && variance.Value > 0)
                        {
                            nextVariance = variance;
                            nextOptions = optionsUsed;
                            detail.NextTermExpiration = next.ExpirationDate;
                            detail.NextTermDTE = next.DaysToExpiration;
                            detail.NextTermVariance = Math.Round(variance.Value, 8);
                            detail.NextTermOptionsUsed = optionsUsed;
                        }
                    }

                    // Interpolar para obtener la varianza exacta al plazo objetivo
                    double? targetIV = InterpolateIV(target, near, nearVariance, next, nextVariance);

                    if (targetIV.HasValue)
                    {
                        detail.ImpliedVolatility = Math.Round(targetIV.Value, 2);

                        // Asignar al campo correspondiente
                        switch (target)
                        {
                            case 9: response.IV9D = detail.ImpliedVolatility; break;
                            case 30: response.IV30 = detail.ImpliedVolatility; break;
                            case 90: response.IV3M = detail.ImpliedVolatility; break;
                        }
                    }

                    response.Calculations.Add(detail);
                }

                // Movimiento diario esperado (regla del VIX: IV30 / √252)
                if (response.IV30.HasValue)
                {
                    response.DailyMove = Math.Round(response.IV30.Value / Math.Sqrt(252), 2);
                    response.DailyMoveDollar = Math.Round(spot * (response.DailyMove.Value / 100), 2);
                }

                // ═══════════════════════════════════════════════════════════
                // PASO 5: IV30 histórico vía candles diarias para iv_momentum
                // IV30_0d → última vela (hoy)
                // IV30_3d → vela de hace 3 sesiones de trading
                // IV30RocPct = ((IV30_0d - IV30_3d) / IV30_3d) * 100
                // ImpVolatility en candle viene en decimal (0.17 = 17%) → ×100
                // ═══════════════════════════════════════════════════════════
                var fromTimeCandle = DateTime.UtcNow.AddDays(-15); // ~15 días para cubrir fins de semana y festivos
                var candles = await socketProvider.GetCandleAsync(request.Symbol, "1d", fromTimeCandle, null, cancellationToken);

                if (candles?.data != null && candles.data.Any())
                {
                    var ordered = candles.data
                        .Where(c => !string.IsNullOrEmpty(c.ImpVolatility)
                               && double.TryParse(c.ImpVolatility, System.Globalization.NumberStyles.Any,
                                                  System.Globalization.CultureInfo.InvariantCulture, out var iv)
                               && iv > 0)
                        .OrderByDescending(c => c.Time)
                        .ToList();

                    if (ordered.Count >= 1)
                        response.IV30_0d = Math.Round(
                            double.Parse(ordered[0].ImpVolatility, System.Globalization.CultureInfo.InvariantCulture) * 100, 2);

                    if (ordered.Count >= 4)
                        response.IV30_3d = Math.Round(
                            double.Parse(ordered[3].ImpVolatility, System.Globalization.CultureInfo.InvariantCulture) * 100, 2);

                    if (response.IV30_0d.HasValue && response.IV30_3d.HasValue && response.IV30_3d.Value != 0)
                        response.IV30RocPct = Math.Round(
                            ((response.IV30_0d.Value - response.IV30_3d.Value) / response.IV30_3d.Value) * 100, 2);
                }

                return response;
            }
            catch (Exception ex)
            {
                throw new Exception($"ImpliedVolatilityHandler Error: {ex.Message}");
            }
        }

        /// <summary>
        /// Calcula la varianza usando la fórmula CBOE VIX:
        /// σ² = (2/T) × Σ(ΔKi/Ki² × e^(rT) × Q(Ki)) - (1/T) × (F/K0 - 1)²
        ///
        /// Donde:
        /// - T = tiempo a expiración en años
        /// - F = precio forward (put-call parity en el strike donde |C-P| es mínimo)
        /// - K0 = mayor strike ≤ F
        /// - Q(Ki) = precio de la opción OTM (put si K < K0, call si K > K0, promedio en K0)
        /// - ΔKi = distancia entre strikes adyacentes
        /// </summary>
        private (double? Variance, int OptionsUsed) CalculateCBOEVariance(
            double spot,
            int dte,
            double r,
            Dictionary<double, StrikePrices> strikePrices)
        {
            if (strikePrices == null || strikePrices.Count < 3)
                return (null, 0);

            double T = dte / 365.0;
            double expRT = Math.Exp(r * T);

            // ── Paso A: Precio forward F ──
            // F = Strike + e^(rT) × (Call - Put)
            // En el strike donde |Call - Put| es mínimo (ambos deben tener precio)
            var pairStrikes = strikePrices
                .Where(s => s.Value.CallPrice > 0 && s.Value.PutPrice > 0)
                .ToList();

            if (!pairStrikes.Any())
                return (null, 0);

            var atm = pairStrikes.OrderBy(s => Math.Abs(s.Value.CallPrice - s.Value.PutPrice)).First();
            double F = atm.Key + expRT * (atm.Value.CallPrice - atm.Value.PutPrice);

            // ── Paso B: K0 = mayor strike ≤ F ──
            var sortedStrikes = strikePrices.Keys.OrderBy(k => k).ToList();
            double K0 = sortedStrikes.Where(k => k <= F).LastOrDefault();
            if (K0 == 0) K0 = sortedStrikes.First();

            // ── Paso C: Seleccionar opciones OTM con regla de "dos ceros consecutivos" ──
            // CBOE excluye opciones después de encontrar 2 consecutivas con precio 0
            var otmOptions = SelectOTMOptions(sortedStrikes, strikePrices, K0);

            if (otmOptions.Count < 2)
                return (null, 0);

            // ── Paso D: Calcular contribución de cada opción ──
            // σ² = (2/T) × Σ(ΔKi/Ki² × e^(rT) × Q(Ki)) - (1/T) × (F/K0 - 1)²
            double sumContrib = 0;

            for (int i = 0; i < otmOptions.Count; i++)
            {
                var opt = otmOptions[i];

                // ΔK: diferencia entre strikes adyacentes
                double deltaK;
                if (otmOptions.Count == 1)
                    deltaK = 1; // fallback
                else if (i == 0)
                    deltaK = otmOptions[1].Strike - otmOptions[0].Strike;
                else if (i == otmOptions.Count - 1)
                    deltaK = otmOptions[i].Strike - otmOptions[i - 1].Strike;
                else
                    deltaK = (otmOptions[i + 1].Strike - otmOptions[i - 1].Strike) / 2.0;

                if (deltaK <= 0) continue;

                // Contribución: (ΔK / K²) × e^(rT) × Q(K)
                sumContrib += (deltaK / (opt.Strike * opt.Strike)) * expRT * opt.Price;
            }

            // Varianza final
            double variance = (2.0 / T) * sumContrib - (1.0 / T) * Math.Pow(F / K0 - 1, 2);

            // Si la varianza es negativa o absurda, descartar
            if (variance <= 0 || double.IsNaN(variance) || double.IsInfinity(variance))
                return (null, 0);

            return (variance, otmOptions.Count);
        }

        /// <summary>
        /// Selecciona opciones OTM según la regla CBOE:
        /// - Puts con K < K0, calls con K > K0, promedio en K0
        /// - Excluye opciones después de encontrar 2 consecutivas con precio 0
        /// </summary>
        private List<OTMOption> SelectOTMOptions(
            List<double> sortedStrikes,
            Dictionary<double, StrikePrices> strikePrices,
            double K0)
        {
            var options = new List<OTMOption>();

            // ── Puts OTM (K < K0): recorrer de K0 hacia abajo ──
            var putStrikes = sortedStrikes.Where(k => k < K0).OrderByDescending(k => k).ToList();
            int consecutiveZeros = 0;

            foreach (var k in putStrikes)
            {
                double putPrice = strikePrices.ContainsKey(k) ? strikePrices[k].PutPrice : 0;

                if (putPrice <= 0)
                {
                    consecutiveZeros++;
                    if (consecutiveZeros >= 2) break; // Regla CBOE: 2 ceros consecutivos → parar
                    continue;
                }

                consecutiveZeros = 0;
                options.Add(new OTMOption { Strike = k, Price = putPrice });
            }

            // ── En K0: promedio de call y put (si ambos disponibles) ──
            if (strikePrices.ContainsKey(K0))
            {
                var k0Data = strikePrices[K0];
                double q;
                if (k0Data.CallPrice > 0 && k0Data.PutPrice > 0)
                    q = (k0Data.CallPrice + k0Data.PutPrice) / 2.0;
                else if (k0Data.CallPrice > 0)
                    q = k0Data.CallPrice;
                else if (k0Data.PutPrice > 0)
                    q = k0Data.PutPrice;
                else
                    q = 0;

                if (q > 0)
                    options.Add(new OTMOption { Strike = K0, Price = q });
            }

            // ── Calls OTM (K > K0): recorrer de K0 hacia arriba ──
            var callStrikes = sortedStrikes.Where(k => k > K0).OrderBy(k => k).ToList();
            consecutiveZeros = 0;

            foreach (var k in callStrikes)
            {
                double callPrice = strikePrices.ContainsKey(k) ? strikePrices[k].CallPrice : 0;

                if (callPrice <= 0)
                {
                    consecutiveZeros++;
                    if (consecutiveZeros >= 2) break;
                    continue;
                }

                consecutiveZeros = 0;
                options.Add(new OTMOption { Strike = k, Price = callPrice });
            }

            // Ordenar por strike
            return options.OrderBy(o => o.Strike).ToList();
        }

        /// <summary>
        /// Interpola la volatilidad implícita entre dos expiraciones para un plazo objetivo.
        /// Fórmula CBOE:
        /// σ²_target = {T1×σ²1 × [(T2-Tt)/(T2-T1)] + T2×σ²2 × [(Tt-T1)/(T2-T1)]} × (365/Tt)
        /// IV = 100 × √σ²_target
        /// </summary>
        private double? InterpolateIV(
            int targetDays,
            Expiration near, double? nearVariance,
            Expiration next, double? nextVariance)
        {
            double Tt = targetDays / 365.0;

            // Caso: ambas varianzas disponibles → interpolar
            if (nearVariance.HasValue && nextVariance.HasValue && near != null && next != null
                && near.DaysToExpiration != next.DaysToExpiration)
            {
                double T1 = near.DaysToExpiration / 365.0;
                double T2 = next.DaysToExpiration / 365.0;
                double sigma1 = nearVariance.Value;
                double sigma2 = nextVariance.Value;

                // Interpolación CBOE ponderada por tiempo
                double w1 = (T2 - Tt) / (T2 - T1);
                double w2 = (Tt - T1) / (T2 - T1);

                // Clamp pesos para evitar extrapolación excesiva
                w1 = Math.Max(-0.5, Math.Min(1.5, w1));
                w2 = Math.Max(-0.5, Math.Min(1.5, w2));

                double targetVariance = (T1 * sigma1 * w1 + T2 * sigma2 * w2) * (365.0 / targetDays);

                if (targetVariance > 0)
                    return 100.0 * Math.Sqrt(targetVariance);
            }

            // Caso: solo una varianza disponible → usar directamente
            if (nearVariance.HasValue && near != null)
            {
                double T1 = near.DaysToExpiration / 365.0;
                double annualizedVariance = nearVariance.Value * (365.0 / near.DaysToExpiration) * (near.DaysToExpiration / 365.0);
                // Simplificado: la varianza ya está en términos anualizados en la fórmula CBOE
                return 100.0 * Math.Sqrt(nearVariance.Value);
            }

            if (nextVariance.HasValue && next != null)
            {
                return 100.0 * Math.Sqrt(nextVariance.Value);
            }

            return null;
        }

        // ═══════════════════════════════════════════════════════════
        // Clases auxiliares internas
        // ═══════════════════════════════════════════════════════════

        private class StrikePrices
        {
            public double CallPrice { get; set; }
            public double PutPrice { get; set; }
        }

        private class OTMOption
        {
            public double Strike { get; set; }
            public double Price { get; set; }
        }

        private class ExpirationMarketData
        {
            public Dictionary<double, StrikePrices> StrikePrices { get; set; } = new();
        }

        private static double ParseDoubleOrZero(string value)
        {
            if (string.IsNullOrWhiteSpace(value) || value.Trim() == "NaN")
                return 0;
            return double.TryParse(value, NumberStyles.Any, CultureInfo.InvariantCulture, out double result) ? result : 0;
        }
    }
}

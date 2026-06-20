# F-04 — XSP (Mini-SPX) para Sizing de Cuentas Chicas

**Prioridad:** P0 — Bloquea operación en cuentas reales con net liq < ~$15K
**Fecha:** 2026-06-09

## Qué es

XSP es el mini-SPX de CBOE: 1/10 del tamaño de SPX, liquidación en efectivo, tratamiento fiscal 1256 (60/40 long-term/short-term). Spreads de 1-2 puntos permiten riesgo por contrato de ~$50-$150, compatible con el 2.5% risk_per_trade en cuentas de $5K.

## Para qué se usa (el sentido)

Con la eliminación de `floor_min: 1` en `definitions.max_contracts` (v2.1.0), cuentas donde el riesgo por contrato de SPY ($375 para spread de 5 pts) excede `risk_per_trade` ($125 para $5K) obtienen `max_contracts = 0 → no_trade` de forma estructural. Esto es correcto y protege al operador, pero deja la cuenta sin capacidad operativa.

XSP resuelve esto permitiendo spreads de menor tamaño nominal que caben dentro del presupuesto de riesgo sin relajar los controles. Es la solución al sizing, no un parche al floor_min.

## Verificación previa requerida (antes de agregar al universo)

Todos estos criterios deben cumplirse en producción antes de incluir XSP en `universe.tickers`:

1. **Liquidez — OI:** Open Interest >= 2000 contratos en strikes del rango 15-20 delta del ciclo 35-45 DTE. Verificar con `/Data/Tastytrade/MarketData/Candle → openInterest` para strikes relevantes.

2. **Liquidez — B/A:** Bid-Ask spread <= 5% del mid en esos mismos strikes. Verificar con `/Data/Tastytrade/MarketData/Quote`.

3. **Resolución de símbolos:** Confirmar que los símbolos OCC de XSP resuelven correctamente en:
   - `/Data/Tastytrade/OptionChains` (cadena de opciones)
   - `/Data/Tastytrade/MarketData/Greeks` (greeks por strike)
   - DXLink WebSocket (streamer symbols para suscripción real-time)

4. **GEX:** Verificar si `/App.Analytics/GammaExposure` puede calcular GEX para XSP o si debe heredar los niveles de SPX/SPY (dado que XSP es simplemente 1/10 de SPX, los niveles estructurales son los mismos).

## Configuración al agregar al universo

```json
// universe.tickers: agregar "XSP"

// spread_width.symbol_overrides:
"XSP": { "default": 2, "min": 1, "max": 5, "step": 1 }

// min_offset_from_spot_by_symbol:
"XSP": 1   // (XSP cotiza ~1/10 de SPY, ajustar proporcionalmente)

// gex_threshold_by_symbol:
"XSP": null  // hereda de SPY/SPX — verificar implementación

// correlation_clusters:
"us_equity_index": ["SPY", "QQQ", "XSP"]  // mismo cluster
```

## Nodo del JSON que lo consume

- `universe.tickers`: agregar `"XSP"` post-verificación
- `position_builder.layers[2].config.spread_width.symbol_overrides`: override 1-2 pts
- `definitions.min_offset_from_spot_by_symbol`: valor propio
- `definitions.correlation_clusters`: incluir en `us_equity_index`

## Criterio de aceptación

- Los 4 puntos de verificación arriba pasan en producción
- Un spread XSP de 2 pts a 15-20 delta pasa las 4 capas de validación del position_builder
- `max_contracts >= 1` con net_liq = $5,000 y risk_per_trade_pct = 0.025
- El frontend renderiza XSP como un ticker más en el Portfolio Manager

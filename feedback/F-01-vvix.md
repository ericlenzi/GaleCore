# F-01 — VVIX (Volatilidad de la Volatilidad)

**Prioridad:** P1 — Cubre grupo "riesgo de cola" ausente del framework
**Fecha:** 2026-06-09

## Qué es

El índice CBOE VVIX mide la volatilidad implícita de las opciones **sobre el VIX**: cuánto paga el mercado por optionalidad sobre la volatilidad misma. Es un derivado de segundo orden: no pregunta "cuánta vol espera el mercado" sino "cuánta incertidumbre hay sobre la vol esperada".

## Para qué se usa (el sentido)

Es uno de los indicadores tempranos más limpios de cambio de régimen: **VVIX subiendo con VIX calmo** significa que instituciones están comprando calls de VIX (cobertura contra spike) antes de que el spot vol lo refleje. Para un vendedor de prima, esa divergencia es la alerta de "te están vendiendo el riesgo que estás comprando".

Complementa al skew 25-delta (definitions.put_skew_25d): el skew mide la cola en el subyacente, VVIX la mide en el mercado de vol.

## Nodo del JSON que lo consume

- `definitions.vvix_vix_ratio` (nueva): `formula: vvix / vix`, con percentil 252d.
- Check nuevo en `regime_engine.checks`: `id: vol_of_vol_divergence` — "VVIX RoC 5d > +10% mientras VIX RoC 5d < +3%" → `on_fail: block_new_entries`. No es el nivel absoluto de VVIX lo que gatilla, es la **divergencia** VVIX sube / VIX lateral.
- `regime_engine.regimes`: insumo adicional del clasificador para degradar de `optimal`/`normal` a `caution`.

## Fuente de datos candidata

- **Opción 1:** Ticker `$VVIX.X` vía Tastytrade `ByType` (verificar primero — puede resolver directo, en cuyo caso el desarrollo es trivial: mismo path que `$VIX.X`).
- **Opción 2:** CBOE data directo.
- **Opción 3:** FRED serie `VVIXCLS` (diaria, rezago 1 día — suficiente para check de divergencia 5d, no para intradía).

## Criterio de aceptación

Endpoint `/Data/Tastytrade/MarketData/ByType?Symbol=$VVIX.X` (o `/App.Analytics/VolOfVol`) devolviendo:
- Nivel actual del VVIX
- Serie de 10 sesiones para calcular RoC 5d
- Check renderizable en el panel de régimen del frontend con los mismos estados que `iv_momentum`

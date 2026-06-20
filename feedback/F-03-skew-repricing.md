# F-03 — Skew Repricing (25Δ Put Skew · RoC 5d + percentil 252d)

**Prioridad:** P1 — Cubre grupo "riesgo de cola" en el subyacente; complementa F-01 (VVIX) y F-02 (HY OAS)
**Fecha:** 2026-06-15
**Estado:** SNAPSHOT IMPLEMENTADO, CHECK DISABLED — falta historial para RoC 5d y percentil

## Qué es

El **skew 25Δ put** mide cuánto más cara está la cola (seguro contra caída) respecto de la volatilidad neutral. Definición del JSON (`definitions.put_skew_25d`):

```
put_skew_25d = iv_put_25delta / iv_atm
```

- `iv_put_25delta` — IV del put cuyo delta está más cerca de **-0.25** (el put OTM que el mercado usa como cobertura típica).
- `iv_atm` — IV en el strike más cercano al spot (vol neutral, delta ≈ 0.5).

Un ratio > 1 significa que la cola se paga más que el ATM (lo normal en equities). Lo que importa para el régimen **no es el nivel**, sino su **empinamiento rápido**: el `put_skew_25d_roc_5d`.

```
put_skew_25d_roc_5d = ((put_skew_25d_today - put_skew_25d_5d_ago) / put_skew_25d_5d_ago) * 100   [percent]
```

## Para qué se usa (el sentido)

El skew se mueve **antes** que el VIX y el IV Rank cuando el mercado huele un shock: las manos fuertes compran puts OTM (cola) antes de que la vol ATM lo refleje. Para un vendedor de prima, un empinamiento agudo del skew = "te están repreciando el riesgo que estás por vender".

Complementa los otros termómetros de cola:
- **iv_momentum** mide la vol ATM (centro de la distribución).
- **skew_repricing** mide la cola en el **subyacente** (forma de la distribución).
- **F-01 VVIX** mide la cola en el **mercado de vol**.
- **F-02 HY OAS** mide el estrés de crédito (fuente independiente del complejo de equity).

## Nodo del JSON que lo consume

- `definitions.put_skew_25d` — formula `iv_put_25delta / iv_atm`, `lookback_percentile_window: 252`.
- `definitions.put_skew_25d_roc_5d` — formula del RoC 5d (ya definida, `ref` resuelve).
- `regime_engine.checks[id: skew_repricing]` — **`enabled: false`**. Operador `lte`, threshold `8.0` (RoC 5d ≤ 8%), `on_fail: block_new_entries` lado put.
- Interpretación: RoC 5d > +8% = repricing de crash → bloquea entradas put side. Percentil 1y < 10 = cola subpreciada → warn.

## Qué hay hoy (snapshot — 2026-06-15)

Endpoint **`GET /App.Analytics/PutSkew?Symbol=SPY&Delta=0.25`** ya implementado:
- `PutSkewHandler.cs` reutiliza `GammaExposureHandler` vía MediatR (Greeks + IV por strike de DXLink), no duplica streaming.
- Resuelve `iv_atm` (strike más cercano al spot, promedio call/put IV) e `iv_put_25delta` (put con delta más cercano a -0.25).
- Devuelve `putSkew25d` (ratio actual), `atmStrike/atmIV`, `put25DeltaStrike/IV`.
- `roc5d` y `percentile252d` → **`null`** (no hay historial).
- **Semáforo interino de NIVEL:** el handler devuelve `levelOk` (`putSkew25d ≤ levelThreshold`, threshold `1.30`) — proxy mientras no haya RoC. NO es el gate real del JSON (RoC 5d ≤ 8%). El front colorea el cuadro por `levelOk` (verde ≤ 1.30, rojo > 1.30) con threshold `≤ 1.30 · RoC pend.`.

Ejemplo real: `putSkew25d = 1.137` (put 734 IV 15.27% / ATM 756 IV 13.43%) → `levelOk: true` (verde).

> El umbral `1.30` es un proxy de nivel, no el gate del JSON. Se tunea en `PutSkewHandler.cs` (`LEVEL_THRESHOLD`). Al implementar el RoC histórico, el semáforo debe pasar a evaluar el RoC 5d ≤ 8% real y quitar este proxy.

## Qué debería tener (para activar el check)

1. **`roc5d`** real: requiere el `put_skew_25d` de **hace 5 sesiones**.
2. **`percentile252d`** real: requiere la serie del `put_skew_25d` de las **últimas 252 sesiones**.
3. Una vez ambos estables → en `PutSkewHandler` poblar `roc5d`/`percentile252d`, y en el JSON:
   - `regime_engine.checks[skew_repricing].enabled: true`
   - agregar `put_skew_roc_5d` (o equivalente) a `available_today`
   - agregar la condición de crisis `skew_repricing_roc_above: 8.0` donde corresponda
4. Frontend: el cuadro pasa de gris (informativo) a check activo con semáforo (verde RoC ≤ 8%, rojo > 8%).

## Forma ideal técnicamente

El problema es **persistir una serie diaria de un escalar** (el `put_skew_25d` de cierre), sin montar una capa de datos pesada (alineado con "strategy first, infra later — sin DB todavía").

**Opción recomendada — snapshot diario append-only en archivo (sin DB):**
- Un `IHostedService` (o trigger en el primer request del día) calcula el `put_skew_25d` de cierre una vez por sesión y lo **appendea** a `Files/history/put_skew_25d_{symbol}.jsonl` (una línea `{date, skew}` por día).
- `PutSkewHandler` lee ese archivo: `roc5d = (hoy - hace_5d)/hace_5d × 100`; `percentile252d` = rank del valor de hoy en las últimas 252 entradas.
- Ventajas: cero infra externa, idempotente por fecha, trivial de inspeccionar/versionar. Útil también para F-01 (VVIX) y F-02 (HY OAS), que tienen el mismo patrón de "escalar diario con RoC + percentil".
- Maduración: `roc5d` válido tras **5 sesiones** de acumulación; `percentile252d` válido (o con muestra parcial) tras ~1 año. Mientras tanto se devuelve `null` con un flag `samplesAvailable`.

**Alternativa si más adelante hay histórico de cadenas:** reconstruir el skew de cierre de los últimos N días desde greeks/IV históricos por strike (Tastytrade no lo expone trivialmente fuera del ATM — ver `verification_required` de `put_skew_25d`). Más caro y con staleness de greeks lejos del ATM; el append-only diario evita depender de esto.

**Riesgo a verificar (del JSON, `verification_required`):** confirmar que el strike con delta más cercano a -0.25 es estable sesión a sesión (staleness de greeks OTM en DataFeed). Si el delta del put salta de strike, el ratio puede dar saltos espurios → considerar interpolar IV al delta -0.25 exacto entre los dos strikes que lo encierran, en vez de tomar el más cercano.

## Criterio de aceptación

- [x] Endpoint `/App.Analytics/PutSkew` devuelve `putSkew25d` snapshot estable
- [x] Frontend muestra el snapshot en gris (informativo)
- [ ] Serie diaria `put_skew_25d` persistida (jsonl append-only) con ≥ 5 sesiones
- [ ] `PutSkewHandler` puebla `roc5d` y `percentile252d` desde la serie
- [ ] Interpolación de IV al delta -0.25 exacto (anti-salto de strike)
- [ ] Al estabilizar: `skew_repricing.enabled: true` + condición de crisis + render con semáforo

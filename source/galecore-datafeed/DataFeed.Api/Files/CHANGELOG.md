# CHANGELOG — galecore_rules_core.json

## v2.1.5 — 2026-06-22

Entorno conceptualmente cerrado: los 3 grupos del clasificador quedan con todas sus patas declaradas (las que andan y las que faltan). **No cambia ninguna decisión**: todo lo nuevo entra `enabled:false`, el `tail_risk_score` cuenta solo ángulos `enabled`, así que con todo apagado da 0 y la matriz de regímenes da idéntica a v2.1.4. El comportamiento solo cambia cuando se habilite el primer ángulo de cola.

- **Grupo 1 · price_of_volatility** — nuevo check `iv_vs_rv` (def `iv_rv_ratio`, IV30/rv_short ≥ 1.2): separa IV cara por miedo (edge) de IV cara por movimiento real (sin edge). Dato base (`rv_short`) ya existe, falta computar el ratio.
- **Grupo 2 · tail_risk** — completados los 4 ángulos con score de coincidencia. Nuevos checks `vvix_repricing` (def `vvix_level`) y `put_call_flow` (def `put_call_flow`), que se suman a `skew_repricing` y `credit_equity_divergence` ya existentes.
- **Forma uniforme de los 4 ángulos: `levels { warn, block }`.** Cada ángulo es **un** check con dos umbrales internos (`threshold_warn`/`threshold_block` en su definition) y acciones `on_warn`/`on_block`. El check expone el nivel alcanzado (none/warn/block) y el score lo mapea a puntos. Esto unifica tres formas que estaban divergentes: `skew_repricing` pasó de un único umbral (8.0) a dos (warn 5.0 / block 8.0, ambos en `definitions.put_skew_25d_roc_5d`); `vvix_repricing` ahora usa los dos umbrales que la definition ya tenía; y **`credit_equity_divergence` + `credit_equity_divergence_warn` se colapsaron en un solo check con `levels`** (el `_warn` se eliminó). El patrón `levels` aplica **solo** a los 4 ángulos de cola; el resto de los checks del contrato siguen binarios (`operator`/`threshold`/`on_fail`).
- **`regime_engine.tail_risk_score`** — nodo nuevo (hermano de `checks`/`regimes`). `inputs` referencia **un `check_id` por ángulo**; `points_by_level` (none=0/warn=1/block=2) mapea el nivel alcanzado a puntos. Bandas: score ≥ 2 fuerza `caution` (aunque el VIX duerma); score ≥ 4 agrega condición OR a `crisis`. Override individual: un ángulo en percentil ≥ 99 (252d) confirmado en 2 lecturas → `block_new_entries`. Ángulos `enabled:false` aportan 0.
- **Grupo 3 · fragility_structure** — distinción explícita amplificación (anda: `gex_total`, `spot_vs_zgl`) vs fragilidad acumulada (nueva, predictiva). Nuevos checks `breadth_divergence`, `concentration_risk`, `extension_stretch` (defs `breadth`, `concentration`, `extension`).
- **`data_availability.unavailable`** += `iv_rv_ratio`, `vvix_level`, `put_call_flow`, `breadth`, `concentration`, `extension`.

### Prioridad de activación (por costo de datos)

1. `iv_vs_rv` y `extension_stretch` — gratis, computables con datos que YA existen (`rv_short` y candles).
2. `concentration_risk` (proxy RSP/SPY) — barato si RSP está en DataFeed.
3. `vvix_repricing` — depende de que `$VVIX.X` resuelva en ByType (si no, fuente CBOE).
4. `skew_repricing`, `credit_equity_divergence` — verificar endpoints existentes (`/App.Analytics/PutSkew`, `/App.Analytics/CreditSpread`).
5. `put_call_flow` — definir métrica exacta (ratio de volumen vs flujo de delta); el stream agresivo ya existe.
6. `breadth_divergence` — el más caro: sin fuente identificada, requiere provider externo.

### Sub-pregunta diferida

Las 3 patas de fragilidad acumulada también son señales débiles-complementarias, como la cola. Cuando tengan datos puede convenir un mini-score de fragilidad análogo al `tail_risk_score`. **No se diseña ahora** — se dejan como checks declarados y se decide cuando lleguen los datos.

---

## v2.1.4 — 2026-06-22

Limpieza estructural. **No cambia ninguna decisión**: la matriz de regímenes da idéntico a v2.1.3.

- **Estado de datos consolidado** en `data_availability` con tres listas (`available` / `unverified` / `unavailable`) + `manual_check_required`. Fuente única: el `enabled` de cada check se justifica contra estas listas, no contra flags por check. Nombres alineados con las keys de `definitions` para que el lint pueda cruzar check → dato → estado.
- **Notas reducidas** a una línea funcional; la historia y los pasos de activación se mueven a este CHANGELOG.
- **`_reading_guide` sintético** en tres grupos (vocabulary / pipeline / cross_cutting) con invariantes.
- **`display_config.portfolio_manager_table` eliminado** — el layout de columnas vive en el frontend, fuera del contrato.
- **Divisor `_PIPELINE_`** insertado entre `definitions` y `hard_gates` para marcar la frontera vocabulario → estrategia ejecutable.

### Pasos de activación de checks DISABLED

**`credit_equity_divergence` (HY OAS widening)** — activar cuando `/App.Analytics/CreditSpread?Series=BAMLH0A0HYM2` devuelva datos estables de FRED en runtime:
1. mover `hy_oas_widening` de `data_availability.unverified` a `available`;
2. agregar `hy_oas_widening_above: 15.0` a `crisis.conditions.rules` (5ta condición de crisis);
3. cambiar `enabled` a `true` en `credit_equity_divergence` (desde v2.1.5 es un único check con `levels { warn, block }`; el antiguo `credit_equity_divergence_warn` se eliminó).

Umbrales en `definitions.hy_oas_widening`. Mientras tanto el frontend lo renderiza en gris.

**`skew_repricing` (skew 25Δ RoC 5d)** — activar cuando `/App.Analytics/PutSkew?Symbol=SPY&Delta=0.25` devuelva valor + percentil 252d + RoC 5d de forma estable:
1. mover `put_skew_25d` y `put_skew_25d_roc_5d` de `unavailable` a `available`;
2. cambiar `enabled` a `true`.

Ver `definitions.put_skew_25d.verification_required` y `feedback/F-03`.

---

## Historia previa (v2.1.0 → v2.1.3)

Relato consolidado de versiones anteriores (antes vivía en `_meta.notes` y en notas de checks):

- `gex_sign` reemplazado por `gex_skew` (asimetría de muros) — el régimen garantiza GEX positivo, por lo que `gex_sign: negative` era inalcanzable.
- `floor_min` eliminado de `max_contracts`: si `max_contracts = 0` el riesgo/contrato excede el presupuesto y corresponde `no_trade`. Solución de universo en `feedback/F-04-xsp.md`.
- `max_heat` consolidado como fuente única del heat cap; `regime_engine` aplica `heat_factor` multiplicativo.
- Régimen `unclassified` como fallback defensivo (mínimo operativo) en vez de un campo `fallback` separado.
- Post-OPEX el GEX colapsa: el ZGL sigue pero sin masa detrás (contexto del check `gex_total`).

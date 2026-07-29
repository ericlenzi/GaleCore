# RPF — "Disparo por prima real" (Real Premium Firing)

> **Subcarpeta aislada** para la estrategia nueva. Objetivo: **no perder nada de lo diseñado** y
> desarrollarla como una estrategia **independiente** de la que corre hoy, dentro de la **misma
> aplicación + API**, reutilizando el código ya desarrollado (GEX, cadenas, Greeks, SignalR, etc.).
>
> **Estado (2026-07-29):** diseño cerrado, **sin implementar**. Por ahora **no se desarrolla código**.

---

## Qué es RPF (en una línea)

Venta de prima con riesgo definido decidida por **dos ejes ortogonales**: la **seguridad *arma*** el
entorno y la **prima *dispara*** la operación (VRP + edge, en AND no-compensable). El sistema vive como
una **máquina de estados por símbolo** (VETOED · DORMANT · ARMED · WAITING_CAPACITY · TRIGGERED ·
COOLDOWN · IN_POSITION) y — a diferencia de lo implementado — el **loop corre en el backend** y empuja
`TradeSuggestion` por SignalR; el frontend es solo tablero.

Contexto completo de por qué esto es distinto de lo que corre hoy: ver la sección "Estrategia nueva
(RPF)" del [`../README.md`](../README.md).

## Contenido de esta carpeta

| Archivo | Rol |
|---|---|
| [`galecore-estrategia-rpf.md`](galecore-estrategia-rpf.md) | **Definición técnica** (13 secciones; §8 máquina de estados). Restaurado de `95ed70d`. |
| [`galecore-rpf-plan-validacion.md`](galecore-rpf-plan-validacion.md) | **Plan de validación** original (BT-1…BT-8). Restaurado de `95ed70d`. |
| [`galecore-research-backtesting-rpf.md`](galecore-research-backtesting-rpf.md) | **Backtesting ejecutado** (BT-0…BT-17). Copia RPF del research compartido de `../` (snapshot 2026-07-29). |
| `new-estrategy-one-pager.docx` | One-pager ejecutivo (lenguaje natural, los 7 estados en español). |
| `GaleCore-Resumen-Config-Referencia.docx` | Resumen ejecutivo para el socio (10-jul) de la config validada H3/Config-C. |
| `galecore_rules_rpf.json` *(pendiente)* | **JSON de reglas nuevo e independiente** — a construir y validar acá. |

## JSON de reglas — nuevo e independiente

El JSON de RPF será **completamente nuevo**, sin heredar el schema de
`../../source/galecore-datafeed/DataFeed.Api/Files/galecore_rules_core.json`. Se **arma y valida en esta
carpeta** primero (fase de diseño, sin código). Recién cuando esté cerrado se decide cómo servirlo desde
la API sin tocar la estrategia vigente. Insumos de diseño ya listos en los docs de arriba: los nodos
nuevos (§10 de la definición) — `alpha_gate`, `edge_gate`, barras `vrp_min`/`min_edge` por régimen,
`correlation_veto`, `risk_bands`, `cooldown`, la máquina de estados y el contrato `TradeSuggestion`.

## Tensiones a reconciliar antes de implementar (decisión del operador)

1. **Estructuras:** RPF admite IC/PCS/CCS; el backtesting del operador concluyó **PCS-only**.
2. **Régimen:** RPF usa el regime engine de **8 regímenes** (para las barras dinámicas); lo implementado
   relajó el macro. Hay que decidir si el regime engine vuelve para RPF.
3. **Parámetros:** las tablas `vrp_min`/`min_edge` del diseño son **placeholders**; su calibración real
   está en el backtesting ejecutado ([`galecore-research-backtesting-rpf.md`](galecore-research-backtesting-rpf.md)).

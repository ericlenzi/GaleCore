# feedback/ — Backlog de Variables para DataFeed

## Propósito

Backlog de variables que el motor de reglas (`galecore_rules_core.json`) necesita pero que DataFeed no provee hoy. Cada ítem es un archivo `.md` con formato fijo.

## Reglas de admisión

1. **Prohibido el ítem de una línea.** Cada archivo debe especificar:
   - **Qué es** la variable (definición técnica)
   - **Para qué se usa** (el sentido dentro de la estrategia)
   - **Qué nodo del JSON lo consume** (check, definition, régimen)
   - **Fuente de datos candidata** (endpoint, proveedor, ticker)
   - **Criterio de aceptación** (qué debe devolver el endpoint para considerarlo implementado)

2. **Prioridad.** Los ítems se priorizan por impacto en el motor de reglas:
   - `P0` — Bloquea operación en cuentas reales (ej: XSP para sizing $5K)
   - `P1` — Cubre un grupo de variables ausente del framework (ej: riesgo de cola)
   - `P2` — Mejora incremental sobre variable existente

3. **Ciclo de vida.** Cuando un ítem se implementa **completo** en DataFeed (backend + check activo en el JSON):
   - Actualizar `galecore_rules_core.json` con la nueva definición/check (`enabled: true`)
   - Actualizar `_meta.notes` del JSON
   - **Eliminar el archivo** del backlog (el código + el JSON + git history son la fuente de verdad; no se acumulan `.md` cerrados)
   - Si queda trabajo residual (snapshot sin RoC, check disabled), el ítem **sigue abierto** con su backlog actualizado, no se borra

## Índice actual

| ID | Variable | Prioridad | Estado |
|---|---|---|---|
| F-01 | VVIX (vol of vol) | P1 | Pendiente |
| F-03 | Skew Repricing (25Δ put · RoC 5d) | P1 | Snapshot hecho · falta historial |
| F-04 | XSP (mini-SPX para sizing) | P0 | Pendiente |
| F-05 | Lint automatizado del JSON de reglas | P1 | Pendiente |

> F-02 (HY Credit Spreads) eliminado al implementarse el backend (`CreditSpread*`). Residual menor: flip `enabled:true` tras verificar FRED en runtime — trackeado en `_meta.notes` del JSON.

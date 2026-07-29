# RPF — "Disparo por prima real" (Real Premium Firing)

> **Subcarpeta aislada** para la estrategia nueva. Objetivo: **no perder nada de lo diseñado** y
> desarrollarla como una estrategia **independiente** de la que corre hoy, dentro de la **misma
> aplicación + API**, reutilizando el código ya desarrollado (GEX, cadenas, Greeks, SignalR, etc.).
>
> **Estado (2026-07-29):** research cerrado, **definición alineada (v2)**, 5 decisiones del operador
> cerradas. **Sin código todavía** — próximo: JSON (Fase 3). Ver "Estado de la validación" abajo.

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
| [`galecore-estrategia-rpf.md`](galecore-estrategia-rpf.md) | **Definición canónica v2** — alineada al research (2026-07-29). Reemplaza al diseño original. |
| [`galecore-rpf-reconciliacion.md`](galecore-rpf-reconciliacion.md) | **Libro mayor de reconciliación (Fase 0).** Valor final · BT · estado de cada parámetro. Contrato de la validación; ante duda de un número, manda este. |
| [`galecore-research-backtesting-rpf.md`](galecore-research-backtesting-rpf.md) | **Backtesting ejecutado** (BT-0…BT-17). Evidencia empírica. Copia RPF del research compartido de `../`. |
| [`galecore-rpf-plan-validacion.md`](galecore-rpf-plan-validacion.md) | **Plan de validación** original (BT-1…BT-8). Restaurado de `95ed70d` — contexto histórico del diseño de las validaciones. |
| [`archive/galecore-estrategia-rpf.diseno-2026-07-06.md`](archive/galecore-estrategia-rpf.diseno-2026-07-06.md) | **Diseño original pre-research** (verbatim). Reemplazado por la v2; se conserva por trazabilidad. |
| `new-estrategy-one-pager.docx` | One-pager ejecutivo (lenguaje natural, los 7 estados en español). |
| `GaleCore-Resumen-Config-Referencia.docx` | Resumen ejecutivo para el socio (10-jul) de la config validada H3/Config-C. |
| `galecore_rules_rpf.json` *(pendiente — Fase 3)* | **JSON de reglas nuevo e independiente** — a construir y validar acá. |

## JSON de reglas — nuevo e independiente

El JSON de RPF será **completamente nuevo**, sin heredar el schema de
`../../source/galecore-datafeed/DataFeed.Api/Files/galecore_rules_core.json`. Se **arma y valida en esta
carpeta** primero (Fase 3, sin código). Recién cuando esté cerrado se decide cómo servirlo desde la API
sin tocar la estrategia vigente. Esqueleto diseñado: ejes A/B (arma/dispara) + `pop_calibration`
first-class + `state_machine` + `research_provenance` (ata cada nodo a su BT). Los valores salen del
libro mayor.

## Estado de la validación (2026-07-29)

Sesión de alineación en curso — plan de 6 fases (validar RPF = alinear definición ↔ research ↔ archivos):

- **Fase 0 ✅** — libro mayor de reconciliación escrito.
- **Fase 1 ✅** — las 5 decisiones del operador cerradas. Las 3 tensiones históricas quedaron
  **resueltas:** estructuras → **PCS-only** (BT-11); régimen → **flags rápidos** (no el de 8);
  parámetros → **calibración del backtest** (delta 0.25, GEX≥0, barras edge 1.05/1.10/1.20, VRP 1.2).
- **Fase 2 ✅** — definición canónica v2 escrita (este es el doc alineado).
- **Fase 3 ⏭** — JSON `galecore_rules_rpf.json`. **Fase 4** — test de consistencia doc↔JSON↔research.
  **Fase 5** — contrato `TradeSuggestion` + máquina de estados (arquitectura RPF completo).

# docs/ — Índice

Fuentes de verdad y documentación de GaleCore. Regla: **una sola versión vigente por tema.** Lo
superado va a [`archive/`](archive/) con cabecera que lo marca.

## Vigente

| Doc | Rol |
|---|---|
| [`../CLAUDE.md`](../CLAUDE.md) | **Contrato de arquitectura** (backend, front, endpoints, stack). |
| [`GaleCore-ways-of-working.md`](GaleCore-ways-of-working.md) | **Sistema de trabajo**: git, harness, agentes IA, cadencia. |
| [`galecore-estrategia-definicion.md`](galecore-estrategia-definicion.md) | Definición conceptual de la estrategia **v1.4.0 PCS-only**. |
| [`galecore-rules-reference.md`](galecore-rules-reference.md) | **Racional por nodo** del JSON de reglas (el *porqué* de cada parámetro). |
| [`galecore-research-backtesting.md`](galecore-research-backtesting.md) | Bitácora del backtesting BT-0..BT-17 (las *validaciones*). |
| [`gex_endpoint.md`](gex_endpoint.md) | Referencia del endpoint de GEX. |

**Fuente de verdad operativa** (no es doc): `../source/galecore-datafeed/DataFeed.Api/Files/galecore_rules_core.json` (+ overlays `live`/`paper`).

## Referencia externa (Tastylive)

`tastylive-options-strategy-*.md` — call/put credit spread, iron condor. `tastylive-options-strategy-guide-2023.pdf`
(⚠️ 51 MB — candidato a sacar del repo / git-lfs / Drive).

## Archivo (superado, solo registro histórico)

Ver [`archive/`](archive/): definición v2.1.5 (línea multi-factor invalidada por BT-11), mapa
v215-vs-backtest, y el candidato `v1.4.0` ya promovido a `Files/`.

## Binarios pendientes de decisión

`GaleCore-Resumen-Config-Referencia.docx`, `new-estrategy-one-pager.docx` — no diffean en git;
evaluar convertir a `.md` o mover a Drive.

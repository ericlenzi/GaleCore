---
description: >
  Estratega de retornos estables de GaleCore. Usar al trabajar con la estrategia de opciones,
  reglas de negocio, señales de trading, el embudo de gates (signal_gates), gestión de posiciones,
  protocolo de ajuste, riesgo dividendo SPY, sizing o teoría Tastytrade (theta decay, IV/VRP,
  delta como POP, skew/GEX). Activar también al revisar galecore_rules_core.json o sus overlays.
---

# Stable Returns Strategist (v1.4.0 — PCS-only)

Venta sistemática de prima con **riesgo definido** sobre índices líquidos (SPY, QQQ), capturando
theta en entornos de volatilidad estable, con la gamma del mercado como filtro de régimen.
Mecánica, sin componente discrecional.

> **Fuente de verdad — NO duplicar acá:**
> - Operativa: `source/galecore-datafeed/DataFeed.Api/Files/galecore_rules_core.json` (+ overlays `live`/`paper`).
> - Racional por nodo: `docs/galecore-rules-reference.md`.
> - Conceptual: `docs/galecore-estrategia-definicion.md`.
> - Validaciones: `docs/galecore-research-backtesting.md`.
>
> Esta skill es una **guía de activación**, no una copia de la estrategia. Si un valor acá
> contradice el JSON, **gana el JSON**. Ante cualquier cambio: JSON primero, luego código, luego esta skill.

## Estado

`paper_only`, `enabled_for_live: false`. Config C validada en BT-15/16/17. Escala ~6,4%/año sobre
$10k; $200/mes ≈ ~$32k. El sistema escala con **capital**, no con más gates.

## Estructura: PCS-only

Una sola estructura en producción: **Put Credit Spread**. Iron Condor y Call Credit Spread quedaron
`enabled:false` — BT-11: no dan edge honesto (el delta subestima el riesgo call ~1,5×). La lógica
histórica de IC/CCS y "degradación IC→PCS" está **archivada** (ver `docs/archive/`), no se usa.

**Prohibido:** naked shorts, ratio spreads, long direccional, cualquier riesgo no definido.

## El embudo (gates cortocircuitantes, se evalúan en cascada)

Si un gate falla, no se abre nada. Embudo medido (SPY, ~206 días operables/año → ~14 trades):

1. **macro_regime** — VIX<30, term structure normal, IV Rank 25–65, IV momentum ≤12%.
2. **tail_score** — VVIX + skew25 RoC (veto de cola, *load-bearing*). Usa `PutSkew`.
3. **gamma_support** — GEX≥0 (flag configurable, solo SPY).
4. **volatility_risk_premium** — VRP ≥ 1.2 (el más restrictivo).
5. **muro + crédito + edge** — put short bajo el put wall, crédito ≥ $0.30 y ≥10% del ancho,
   `edge = (crédito/ancho)/p_pérdida` ≥ barra por régimen (1.05–1.20).

## Motor de strikes y gestión

- **Delta short put ∈ [0.25, 0.30]**; **ancho $5** (max $10 solo como degradación si el crédito no cumple).
- **Microestructura:** OI ≥ 100, bid-ask ≤ 5% del mid (el gate de spread es el que trabaja).
- **Gestión B:** cierre al **50% del crédito**.
- **Cartera V2:** hasta **2 posiciones** escalonadas (vencimientos distintos).
- **hard_defense:** `short_leg_delta_abs > 0.30` (conflicto de diseño abierto: podría vivir en ~0.40–0.45).
- **Riesgo dividendo SPY:** cuidado con ex-div trimestral; el riesgo call es lateral en PCS pero
  vigilar asignación si un roll cruza el dividendo.

## Endpoints

`GET /App/GaleCore/{MacroRegime|ValidationLayer|PositionBuilder}` y `GET /App/GaleCore/Rules/{Core|Live|Paper}`.
Los handlers deben leer `signal_gates` del JSON (trabajo pendiente: hoy parte está hardcodeada).

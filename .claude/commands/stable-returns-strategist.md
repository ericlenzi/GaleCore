---
description: >
  Estratega de retornos estables de GaleCore (v2.1.1). Usar cuando se trabaje con la estrategia
  de opciones, reglas de negocio, senales de trading, hard_gates, regime_engine, las 4 capas de
  validacion, gestion de posiciones, sizing, heat, credit ratio, o teoria Tastytrade (theta decay,
  IV reversion, delta como POP, skew en mercados GEX alto). Activar tambien al revisar
  rules_core.json, rules_live.json, parametros de la estrategia o carpeta feedback/.
---

# Stable Returns Strategist — v2.1.1

Sistema de venta de prima sistematica sobre indices liquidos. Captura theta decay en entornos
de volatilidad estable usando la estructura de gamma del mercado como filtro de regimen.
La estrategia es mecanica, definida en `galecore_rules_core.json`, sin componente discrecional.

**Contrato vigente:** `rules.json` v2.1.3 (2026-06-12)

---

## Objetivo

Generar retornos consistentes vendiendo opciones OTM sobre SPY y QQQ con riesgo definido.
La rentabilidad proviene del theta decay, no de acertar direccion. La palabra que gobierna
el diseno es *consistente*: evitar sistematicamente las condiciones donde la venta de prima
pierde en una semana lo ganado en un ano.

**Metricas objetivo:**
- POP esperado: >= 80% (funcion de delta entrada 0.15-0.20)
- Profit target: 50% del credito recibido
- Riesgo por trade: <= 2.5% del Net Liq
- Heat cap: 8% base (multiplicado por heat_factor del regimen)

---

## Jerarquia de importancia: C > B > A

| Familia | Pregunta | Por que su rango |
|---|---|---|
| **C. Riesgo** (sizing, heat, correlated_exposure_cap, kill switch) | Cuanto y hasta cuando? | Unica defensa independiente. Los filtros de entorno van a fallar. |
| **B. Estructura** (riesgo definido, DTE, delta, credit ratio, forma) | Que vendo exactamente? | Define la distribucion de resultados. Riesgo definido es innegociable. |
| **A. Entorno** (los 3 grupos de variables) | Hoy es buen dia para vender? | Mejora expectancia pero sus senales estan correlacionadas en el peor momento. |

---

## Los tres grupos de variables de entorno

### A1. Precio de la volatilidad
- VIX absoluto (< 35 para operar, > 40 = crisis)
- IV Rank 20-75 (techo incluido: IV cara = tail risk)
- IV momentum (RoC 5d <= 12%, expansion rapida = stress)
- Term structure real: VIX9D vs VIX3M (vencimientos simultaneos HOY, no cierres historicos)
- Credit ratio minimo por IVR: 0.25 / 0.28 / 0.33

### A2. Riesgo de cola (parcialmente implementado)
- put_skew_25d + skew_repricing (enabled: false, pendiente verificacion DataFeed — feedback/F-03)
- VVIX (feedback/F-01) — divergencia VVIX/VIX
- HY Credit Spreads — divergencia credito/equity via FRED (BAMLH0A0HYM2). Backend CreditSpreadHandler existe pero el check credit_equity_divergence va enabled:false, pendiente verificacion en runtime; NO es condicion de crisis todavia (se incorpora como 5ta condicion al verificar). Umbrales: RoC 5d >15% = block, >10% = warn

### A3. Fragilidad / estructura del mercado
- GEX total >= umbral por simbolo (25B)
- Spot > ZGL + 0.5% buffer
- Walls como restriccion de strikes (put < put_wall, call > call_wall)
- gex_skew para seleccion de estructura (call_dominant/put_dominant/symmetric)

---

## Flujo de validacion: hard_gates -> regime_engine -> position_builder

### hard_gates (siempre, previo a todo)
Gates binarios no graduables:
- Data quality (freshness <= 15s, no crossed market, no missing data)
- SPY ex-div warn (7d) / block call entries (3d)

### regime_engine (clasificador unificado)
Evaluation order: crisis -> caution -> dislocation -> elevated_vol -> low_vol_grind -> optimal -> normal

| Regimen | Condiciones clave | Comportamiento |
|---|---|---|
| **crisis** | VIX>40 OR GEX<umbral OR TS invertida OR iv_momentum>12% (ANY) | no_new_entries (trade_management sigue para abiertas) |
| **caution** | VIX 30-40, spot>ZGL, zscore>-1.5 | PCS solo, heat_factor 0.625, delta 0.15, size 0.5 |
| **dislocation** | VIX 25-40, zscore<-1.5, IVR>45 | PCS, heat_factor 0.75, delta 0.20, size 0.7 |
| **elevated_vol** | VIX 30-40, IVR>60, spot<ZGL | PCS, heat_factor 0.625, delta 0.15, size 0.5 |
| **low_vol_grind** | VIX<15, IVR<20, GEX>50 | IC ancho, heat_factor 1.5, delta 0.20/0.18, size 1.1 |
| **optimal** | VIX<25, IVR 30-55, GEX>50, spot>ZGL, TS normal | Todas, heat_factor 1.25, delta 0.20/0.18, size 1.0 |
| **normal** | VIX<35, IVR 20-75, GEX>25, spot>ZGL | Todas, heat_factor 1.0, delta 0.20/0.18, size 1.0 |
| **unclassified** | Fallback: ningun regimen matchea | PCS solo, heat_factor 0.5, delta 0.15, max 1 pos, warn |

Heat efectivo = definitions.max_heat (8%) x heat_factor del regimen.
Principio fallback: el fallback de un clasificador de riesgo debe ser el regimen mas conservador que permita operar, nunca el estandar.

### position_builder (4 capas en cascada, cortocircuitante)

**Capa 2 — Strike engine:**
- DTE target 45, rango 35-45
- Delta entrada: put <= 0.20, call <= 0.18 (gap >= 12 puntos vs defensa 0.32)
- Strikes anclados a muros GEX (put < put_wall, call > call_wall)
- Offset minimo del spot: 10 puntos
- Credit ratio minimo por IVR (0.25/0.28/0.33)
- Seleccion de estructura multi-factor: zscore + gex_skew + trend + flow

**Capa 3 — Microestructura:**
- OI >= 2000 (short y long legs)
- B/A <= 5% mid
- Quote freshness <= 15s
- Credito minimo $0.30

**Capa 4 — Sizing y riesgo:**
- risk_per_trade: 2.5% net liq
- max_contracts: floor(risk / max_risk_per_contract) — SIN floor_min
  - Si max_contracts = 0 -> no_trade (intencional, no bug. Ver feedback/F-04 XSP)
- max_positions_hard_cap: 4
- Heat total <= max_heat (8% base x heat_factor)
- correlated_exposure_cap: max 2 posiciones mismo lado por cluster (SPY+QQQ = us_equity_index)
  - max_positions 4 solo alcanzable mezclando lados/condors

---

## Estructuras permitidas

Todas de credito con riesgo definido:
- **Iron Condor** — estructura por defecto (vende prima arriba y abajo)
- **Put Credit Spread** — solo vende prima abajo (skew/asimetria favorece ese lado)
- **Call Credit Spread** — solo vende prima arriba (idem inverso)

**Prohibido:** naked shorts, ratio spreads, posiciones long direccionales.

Degradacion automatica: si solo un lado pasa todos los checks, IC degrada a PCS o CCS.

---

## Gestion de posiciones (trade_management)

Prioridad de evaluacion:
1. operational_contingency
2. macro_event_binary_avoidance
3. daily_kill_switch (1.5% net liq MTM loss -> block rest of session)
4. take_profit (50% del credito -> cerrar)
5. structural_support_loss (wall se mueve dentro del short strike, 2 recalculos consecutivos)
6. hard_defense (delta > 0.32 OR perdida >= 200% credito)
7. defensive_roll (perdida >= 100% credito, DTE >= 28, credito neto positivo, max 1 roll)
8. time_exit (DTE <= 21 -> cerrar)

---

## Decisiones de diseno y anti-regresion

| Decision | NO revertir porque... |
|---|---|
| floor_min eliminado | El no_trade por sizing dice la verdad. Solucion: XSP (F-04) |
| Credit ratio >= 0.25 | 0.10 era 9:1 con expectancia negativa post-slippage |
| Delta entrada 0.20/0.18 | Gap >= 12 vs defensa impide posiciones que nacen en terapia intensiva |
| Heat base 8% con factors | Una sola fuente de verdad elimina el bug 4.5%/8%/10%/12% |
| Menor frecuencia de OPERAR | Es el sistema funcionando, no fallando. cash_is_a_position |
| correlated_exposure_cap | 4 posiciones SPY+QQQ = 1 apuesta de 4x el dia que los filtros fallen |
| Fallback = unclassified | Fallback 'normal' otorgaba IC + heat 1.0 en mercados no clasificados. Principio: fallback = minimo operativo |
| Checks disabled sin dato | Un check con poder de bloqueo apuntando a dato fantasma = crisis permanente si el clasificador lo evalua |

---

## Configuracion

JSON en `source/galecore-datafeed/DataFeed.Api/Files/`:
- `galecore_rules_core.json` v2.1.3 — contrato completo
- `galecore_rules_live.json` — overlay conservador
- `galecore_rules_paper.json` — overlay paper trading

Endpoint: `GET /App/GaleCore/Rules/{Core|Live|Paper}`

## Subyacentes

| Ticker | Indice | Cluster |
|---|---|---|
| SPY | S&P 500 ETF | us_equity_index |
| QQQ | Nasdaq 100 ETF | us_equity_index |

Ningun otro sin verificacion previa (ver feedback/F-04 para XSP).

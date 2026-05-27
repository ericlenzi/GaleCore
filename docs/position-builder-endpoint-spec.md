# Position Builder — Especificación de Endpoints

## Contexto

El portfolio manager necesita dos cosas del backend:

1. **Un endpoint REST** que exponga los datos del `position_builder` (layers 2, 3, 4) incluyendo todos los inputs computados para la selección de estructura (z-score, GEX sign, flow, trend, vol regime).
2. **Datos de flow de opciones via WebSocket** (`/hubs/marketdata`) para que el frontend reciba el flujo agresivo en tiempo real sin polling.

El endpoint `/App/GaleCore/ValidationLayer` existente ya corre las 4 capas pero devuelve un shape basado en el formato viejo. Hay que adaptarlo para que el response refleje la separación `macro_regime` / `position_builder` que define el JSON.

---

## 1. Endpoint: PositionBuilder

### Request

```
GET /App/GaleCore/PositionBuilder?symbol={SYMBOL}&profile={PROFILE}
```

| Parámetro | Tipo | Default | Descripción |
|---|---|---|---|
| `symbol` | string | requerido | Ticker subyacente (SPY, QQQ) |
| `profile` | string | `"core"` | Overlay de reglas: `core`, `live`, `paper` |

### Prerrequisito

Solo se evalúa si `macro_regime` pasó. El caller (frontend) debe haber chequeado `GET /App/GaleCore/MacroRegime` primero, o puede usar `GET /App/GaleCore/ValidationLayer` que corre ambos en cascada y shortcircuita si macro falla.

---

### Response

```json
{
  "symbol": "SPY",
  "profile": "core",
  "timestamp": "2026-05-26T14:32:00Z",
  "spotPrice": 528.40,

  "structureInputs": {
    "priceZScore": {
      "value": 1.72,
      "formula": "ret_5d / (iv_atm / sqrt(252))",
      "ret5d": 0.0085,
      "ivAtm": 0.178,
      "interpretation": "bullish_extreme"
    },
    "ivZScore": {
      "value": 0.94,
      "ivCurrent": 17.8,
      "ivMean252": 16.2,
      "ivStddev252": 1.7,
      "interpretation": "neutral"
    },
    "gexSign": {
      "value": "negative",
      "netGexBillions": -42.3,
      "interpretation": "dealers persiguen precio — continuation regime"
    },
    "trend": {
      "ema20": 524.10,
      "ema50": 519.80,
      "signal": "up",
      "interpretation": "ema_20 > ema_50"
    },
    "realizedVolRegime": {
      "rv10d": 14.2,
      "rv30d": 12.8,
      "signal": "high",
      "interpretation": "rv_short > rv_long — vol en expansión"
    },
    "aggressiveFlow": {
      "signal": "bullish",
      "bullishPremiumUsd": 1840000,
      "bearishPremiumUsd": 340000,
      "netDeltaFlow": 0.62,
      "dominantSide": "call",
      "windowMinutes": 60,
      "dataSource": "stream"
    }
  },

  "selectedStructure": {
    "output": "put_credit_spread",
    "ruleId": 2,
    "ruleName": "bullish_continuation",
    "ruleLabel": "Continuación alcista — Negative Gamma + Bullish Flow",
    "conditionsMet": {
      "priceZScore_gt_extremeZ": true,
      "gexSign_negative": true,
      "flow_bullish": true,
      "trend_up": true
    }
  },

  "strikeEngine": {
    "signal": "OPERAR",
    "expiration": "2026-06-20",
    "dte": 25,
    "expectedMove": 14.80,
    "callWall": 545.0,
    "putWall": 510.0,
    "shortPutStrike": 510.0,
    "shortPutDelta": -0.14,
    "longPutStrike": 505.0,
    "shortCallStrike": null,
    "shortCallDelta": null,
    "longCallStrike": null,
    "strikesInsideWalls": true,
    "creditRatioPut": 0.13,
    "creditRatioCall": null
  },

  "microstructure": {
    "signal": "OPERAR",
    "atmStrike": 528.0,
    "atmCallDelta": 0.51,
    "atmPutDelta": -0.49,
    "oiChecks": {
      "shortPut": { "passed": true, "value": 18400, "minRequired": 2000 },
      "longPut":  { "passed": true, "value": 12100, "minRequired": 2000 },
      "shortCall": null,
      "longCall":  null
    },
    "bidAskChecks": {
      "shortPut": { "passed": true, "spreadPct": 0.031, "maxAllowed": 0.05 },
      "longPut":  { "passed": true, "spreadPct": 0.028, "maxAllowed": 0.05 }
    },
    "quoteAgeSeconds": 4,
    "creditMinimum": { "passed": true, "midCredit": 0.52, "minRequired": 0.30 }
  },

  "riskAndSizing": {
    "signal": "OPERAR",
    "netLiq": 45000.00,
    "riskPerTrade": 675.00,
    "maxRiskPerContract": 450.00,
    "maxContracts": 1,
    "openPositions": 1,
    "maxPositions": 3,
    "positionsAvailable": true,
    "currentHeatPct": 1.2,
    "maxHeatPct": 4.5,
    "heatAfterEntryPct": 2.2,
    "heatOk": true
  },

  "overallSignal": "OPERAR"
}
```

---

### Campos que requieren cómputo nuevo

Los siguientes campos no existen en el handler actual y hay que agregarlos:

| Campo | Requiere | Endpoint fuente |
|---|---|---|
| `priceZScore` | candles diarios (5d) + IV30_30d | `/Data/Tastytrade/MarketData/Candle` + `/App.Analytics/ImpliedVolatility` |
| `ivZScore` | historia 252d de IV | `/App.Analytics/IVRank → history[].iv` |
| `gexSign` | `netGEX` | `/App.Analytics/GammaExposure` (ya disponible) |
| `trend.ema20 / ema50` | candles diarios (60 sesiones) | `/Data/Tastytrade/MarketData/Candle` |
| `realizedVolRegime` | candles diarios (35 sesiones) | `/Data/Tastytrade/MarketData/Candle` |
| `aggressiveFlow` | stream WebSocket (ver sección 2) | `/hubs/marketdata` |
| `selectedStructure.ruleId / ruleName` | lógica multi-factor | lógica interna del handler |
| `creditRatioPut / creditRatioCall` | quote de spread | `/Data/Tastytrade/MarketData/Quote` |
| `bidAskChecks` | quote por leg | `/Data/Tastytrade/MarketData/Quote` |
| `creditMinimum` | mid del spread | `/Data/Tastytrade/MarketData/Quote` |

---

## 2. Modificación a ValidationLayer

El endpoint existente `GET /App/GaleCore/ValidationLayer` pasa por las 4 capas en cascada. Hay que adaptar el response para reflejar la separación `macro_regime` / `position_builder`.

### Response modificado

```json
{
  "symbol": "SPY",
  "profile": "core",
  "timestamp": "2026-05-26T14:32:00Z",
  "spotPrice": 528.40,
  "overallSignal": "OPERAR",
  "failedAtLayer": null,

  "macroRegime": {
    "signal": "OPERAR",
    "checks": {
      "vixAbsolute":      { "passed": true,  "value": 18.4, "threshold": 30 },
      "vixTermStructure": { "passed": true,  "iv9d": 16.2, "iv30d": 18.4 },
      "ivRank":           { "passed": true,  "value": 42.0, "min": 25, "max": 65 },
      "ivMomentum":       { "passed": true,  "value": 3.2, "maxAllowed": 12.0 },
      "gexTotal":         { "passed": true,  "value": 82.1, "threshold": 50 },
      "spotVsZgl":        { "passed": true,  "spot": 528.40, "zgl": 512.0 }
    }
  },

  "positionBuilder": {
    "signal": "OPERAR",
    "strikeEngine": { ... },
    "microstructure": { ... },
    "riskAndSizing": { ... }
  }
}
```

> **Nota:** el shape de `positionBuilder` es idéntico al de `/App/GaleCore/PositionBuilder` pero sin `structureInputs`. Los `structureInputs` son solo del endpoint dedicado para no sobrecargar el ValidationLayer.

---

## 3. Flow de Opciones via WebSocket

### Diseño

El flow agresivo se calcula del stream en tiempo real. El servidor trackea trades de opciones del subyacente, clasifica cada trade como bullish/bearish por agresión en ask/bid, acumula el premium y emite un snapshot periódico.

El cliente **no necesita suscribirse a cada símbolo de opción individualmente**. Invoca un único método del hub por subyacente y el servidor resuelve qué cadena monitorear.

---

### Nuevo método del hub

```typescript
// Cliente invoca:
connection.invoke('SubscribeFlow', symbol, expirationDate?, flowWindowMinutes?)

// Parámetros
// symbol:             "SPY"
// expirationDate:     "2026-06-20" (opcional, si null usa la expiración target del JSON)
// flowWindowMinutes:  60 (opcional, default del JSON: aggressive_flow.flow_window_minutes)
```

```typescript
// Para dejar de recibir:
connection.invoke('UnsubscribeFlow', symbol)
```

---

### Nuevo evento del hub

```typescript
// Servidor emite cada 30 segundos o cuando el net delta flow cambia de signo:
connection.on('ReceiveFlow', (symbol, data) => { ... })
```

**Payload `ReceiveFlow`:**

```json
{
  "symbol": "SPY",
  "expiration": "2026-06-20",
  "windowMinutes": 60,
  "timestamp": "2026-05-26T14:32:00Z",

  "bullish": {
    "premiumUsd": 1840000,
    "tradeCount": 47,
    "avgTradeSize": 120,
    "dominantStrike": 530.0,
    "dominantType": "call"
  },
  "bearish": {
    "premiumUsd": 340000,
    "tradeCount": 12,
    "avgTradeSize": 85,
    "dominantStrike": 520.0,
    "dominantType": "put"
  },

  "netDeltaFlow": 0.62,
  "signal": "bullish",

  "recentTrades": [
    {
      "timestamp": "2026-05-26T14:31:45Z",
      "optionSymbol": "SPY   260620C00530000",
      "callPut": "call",
      "strike": 530.0,
      "tradePrice": 2.85,
      "size": 250,
      "premiumUsd": 71250,
      "aggression": "ask_side",
      "delta": 0.42
    }
  ]
}
```

---

### Lógica interna del servidor para flow

El servidor, al recibir `SubscribeFlow(symbol)`:

1. Llama a `/Data/Tastytrade/OptionChains?symbol={symbol}` para obtener los strikes de la expiración target.
2. Se suscribe vía DXLink WebSocket a los símbolos OCC de esa expiración (Trade + Quote events).
3. Por cada trade recibido:
   - Obtiene quote simultáneo (`ReceiveQuote`) del mismo símbolo.
   - Clasifica: `trade.price >= quote.ask` → `ask_side` (agresión compradora).
   - Clasifica: `trade.price <= quote.bid` → `bid_side` (agresión vendedora).
   - Calcula: `premium = size × trade_price × 100`.
   - Si `premium >= large_premium_threshold_usd (25000)` → incluye en flow acumulado.
   - Usa proxy de apertura: `day_volume / oi_prev_day >= 0.5`.
4. Cada 30 segundos (o en cambio de signo de `netDeltaFlow`) emite `ReceiveFlow` al grupo.

**Campo `netDeltaFlow`:**

```
netDeltaFlow = (bullish_premium - bearish_premium) / (bullish_premium + bearish_premium)
```

Rango: -1.0 (todo bearish) a +1.0 (todo bullish).

---

## 4. Flujo de datos del portfolio manager

```
Frontend (Portfolio Manager)
    │
    ├── REST (cada 15s)
    │   └── GET /App/GaleCore/PositionBuilder?symbol=SPY
    │       → structureInputs, selectedStructure, strikeEngine, microstructure, riskAndSizing
    │
    └── WebSocket /hubs/marketdata (persistente)
        ├── invoke Subscribe("SPY")         → ReceiveTrade, ReceiveQuote (precio underlying)
        └── invoke SubscribeFlow("SPY")     → ReceiveFlow (opciones flow cada 30s)
```

---

## 5. Cambios en `ValidationLayerHandler.cs`

### Lo que hay que agregar

| Sección | Cambio |
|---|---|
| `Layer1` | Renombrar response field a `macroRegime` |
| `Layer2` | Agregar cómputo de `priceZScore` con nueva lógica (thresholds 1.0 / 1.5 del JSON) |
| `Layer2` | Agregar cómputo de `ivZScore` desde `IVRankHandler.history` |
| `Layer2` | Agregar cómputo de `trend.ema20/ema50` desde candles diarios |
| `Layer2` | Agregar cómputo de `realizedVolRegime` (rv10d vs rv30d) desde candles diarios |
| `Layer2` | Reemplazar lógica de selección de estructura: evaluar las 5 reglas del JSON en orden, capturar `ruleId` y `ruleName` de la regla que matcheó |
| `Layer3` | Agregar `bidAskChecks` por leg y `creditMinimum` check |
| Response | Wrappear Layer1 en `macroRegime`, layers 2-3-4 en `positionBuilder` |

### Lo que **no** cambia

- El flujo de cascada (shortcircuit si Layer1 falla).
- Los checks existentes de OI, delta, walls, heat, positions.
- La integración con `GammaExposureHandler`, `IVRankHandler`, `AccountBalancesHandler`.

---

## 6. Nuevo handler: `PositionBuilderHandler`

Para el endpoint `/App/GaleCore/PositionBuilder` conviene un handler separado de `ValidationLayerHandler` porque:
- No corre Layer 1 (el caller ya validó macro_regime).
- Incluye `structureInputs` completo (aggressiveFlow requiere datos del stream que `ValidationLayer` no consume).
- Puede cachearse de forma independiente (el flow tiene su propio ciclo de refresco).

```
GET /App/GaleCore/PositionBuilder
    → PositionBuilderHandler
        ├── IVRankHandler            (iv_zscore)
        ├── ImpliedVolatilityHandler (iv_atm para z-score)
        ├── MarketDataCandleHandler  (returns 5d, ema 20/50, realized vol)
        ├── GammaExposureHandler     (gex_sign, walls)
        ├── MarketDataQuoteHandler   (credit ratio, bid-ask por leg)
        ├── AccountBalancesHandler   (net liq)
        ├── AccountPositionsHandler  (open positions, heat)
        └── FlowAggregatorService    (aggressiveFlow — lee del stream interno)
```

`FlowAggregatorService` es un servicio singleton (al igual que `DxLinkStreamingService`) que mantiene el acumulado de flow de los últimos N minutos en memoria y lo expone via `GetFlowSnapshot(symbol)`. El hub llama al mismo servicio para emitir `ReceiveFlow`.

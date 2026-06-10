# Endpoint GammaExposure (GEX)

Referencia de uso, arquitectura interna y guía de mejoras del endpoint de Gamma Exposure.

> Última actualización: tras la sesión de fixes de OI/muros, latencia y AUTH timeout DXLink.
> Código relevante:
> - `DataFeed.Application/App/GammaExposure/GammaExposureHandler.cs`
> - `DataFeed.Application/App/GammaExposure/GammaExposureResponse.cs`
> - `DataFeed.Infrastructure/Providers/Tastytrade/TastytradeSocketProvider.cs` (`GetMultiGreeksAsync`)
> - `DataFeed.Infrastructure/Providers/Tastytrade/DxLinkHandshake.cs`

---

## 1. Qué hace

Calcula el **Gamma Exposure (GEX) por strike** del subyacente para la expiración regular más
cercana dentro de un horizonte de DTE, e infiere niveles clave de la estructura de gamma:

- **Gamma Zero Level (ZGL)** — precio donde el Net GEX cruza de negativo a positivo (gamma flip).
- **Call Wall** — strike por **encima** del spot con mayor `CallGEX` (resistencia).
- **Put Wall** — strike por **debajo** del spot con mayor `|PutGEX|` (soporte).

Es el insumo principal de la **Capa 1** de la estrategia (régimen macro / GEX y Spot vs ZGL).

---

## 2. Request

```
GET /App.Analytics/GammaExposure?Symbol={SYMBOL}&MinDelta={delta}&MaxDTE={dte}
```

Header requerido: `X-API-KEY`.

| Parámetro  | Default | Descripción                                                        |
|------------|---------|--------------------------------------------------------------------|
| `Symbol`   | —       | Subyacente (ej. `SPY`, `QQQ`)                                      |
| `MinDelta` | `0.10`  | Delta mínimo absoluto (filtro de salida; ver nota)                |
| `MaxDTE`   | `60`    | DTE máximo para elegir la expiración regular más cercana          |

> **Nota sobre `MinDelta`:** hoy el filtro de salida por `MinDelta` está comentado en el handler
> (se devuelven todos los strikes con IV). No confundir con la **banda de delta de suscripción
> de Candle** (0.02–0.98), que es una optimización interna distinta (ver §5).

---

## 3. Response (campos principales)

```json
{
  "symbol": "SPY",
  "spot": 730.13,
  "expiration": "2026-07-17",
  "dte": 37,
  "expirationType": "Regular",
  "gammaZeroLevel": 725.98,
  "callWall": 750.0,
  "putWall": 720.0,
  "riskFreeRate": 0.045,
  "strikesWithOI": 133,
  "strikesWithGEX": 133,
  "callGEX": 106346.6,
  "putGEX": -275984.4,
  "netGEX": -169.6,
  "strikes": [
    {
      "strike": 735.0,
      "callDelta": 0.51, "callGamma": 0.0095, "callIV": 0.178,
      "callOI": 51190, "callGEX": ..., "callPrevClose": 15.5,
      "putDelta": -0.49, "putGamma": 0.0103, "putIV": 0.165,
      "putOI": ..., "putGEX": ..., "putPrevClose": ...,
      "netGEX": ...
    }
  ]
}
```

| Campo               | Descripción                                                                 |
|---------------------|-----------------------------------------------------------------------------|
| `spot`              | Precio del subyacente (REST `MarketData/ByType`, `Mark` o `Last`)          |
| `gammaZeroLevel`    | Interpolado donde Net GEX cruza de − a +; el cruce más cercano al spot      |
| `callWall`/`putWall`| Muros filtrados por lado del spot (call arriba, put abajo)                  |
| `strikesWithOI`     | Strikes con OI > 0 (diagnóstico de calidad del fetch de Candle)             |
| `strikesWithGEX`    | Strikes con GEX no nulo                                                     |
| `*PrevClose`        | Cierre del candle diario anterior por leg                                   |

`GEX (millones) = gamma × OI × 100 × spot²` ; calls positivo, puts negativo.

---

## 4. Lógica interna (flujo del handler)

1. **PASO 1 — spot + option chain (REST).**
   - Spot vía `MarketData/ByType`. Option chain vía `OptionChains` (nested).
   - La **chain se cachea por día** (`_chainCache`); en cache-miss se piden spot + chain **en paralelo** (`Task.WhenAll`).
2. **PASO 2 — armar símbolos streamer.** De cada strike se toman `CallStreamerSymbol`/`PutStreamerSymbol`
   (formato DXLink, ej. `.SPY260717P735`) y se mapea `streamerSym → (strike, C/P)`.
3. **PASO 3 — Greeks + OI vía WebSocket** (`GetMultiGreeksAsync`):
   - Suscribe **Greeks** de todos los símbolos en un bloque (IV/delta/gamma real-time).
   - Filtra por **banda de |delta| 0.02–0.98** y pide **Candle** (OI + prevClose) solo de esos.
   - OI/prevClose se **cachean por día** (`_oiCache`); en warm se saltea casi toda la Fase 2.
4. **PASO 4 — GEX por strike** con los Greeks de DXLink y el OI del candle.
5. **PASO 5 — orden por strike.**
6. **PASO 6 — Gamma Zero, Call Wall, Put Wall.**

---

## 5. Particularidades de DXLink (claves para no romper esto)

### 5.1. Límite de suscripción de Candle (CRÍTICO)
DXLink rechaza con `ERROR / BAD_ACTION: "Your subscription size for event type 'Candle' is too big"`
si hay **demasiadas suscripciones Candle ACTIVAS en el canal** (el límite es sobre el total activo,
no por mensaje). Con ~500 legs de SPY esto rompía el OI → muros y gammaZero `null`.

**Solución implementada:** los Candle se procesan en **lotes (batch 80)** con ciclo
`add → esperar snapshot → remove`, manteniendo las activas siempre ≤ batch size. Los Greeks
(streaming liviano) no tienen este límite y van en un solo bloque.

> ⚠️ No volver a suscribir todos los Candle de una. Si se sube el universo de strikes, respetar el batching.

### 5.2. No tragar los ERROR
El handler de mensajes loguea los `ERROR` de DXLink (antes un `catch {}` vacío los ocultaba, lo que
escondió el bug del límite de Candle por mucho tiempo). Mantener ese log.

### 5.3. `socket.Start()` puede no conectar
Bajo churn de conexiones, `await socket.Start()` puede retornar con `IsRunning=false` (conexión no
establecida); como `ErrorReconnectTimeout` es ~60s, no reintenta a tiempo y SETUP/AUTH se mandan al
vacío → `AUTH timeout`. **`DxLinkHandshake.EnsureConnectedAsync`** reintenta `Start()` hasta conectar
antes del handshake. (Beneficia a todos los métodos del socket provider, no solo GEX.)

### 5.4. Cierre de snapshot
Cada símbolo Candle cierra su snapshot con flag `SNAPSHOT_END (0x08)` o `SNAPSHOT_SNIP (0x10)`. Se usa
para marcar como recibido a los símbolos sin OI útil y no esperar el timeout del lote.

---

## 6. Latencia (estado actual y evolución)

Medido sobre SPY (cadena completa, ~498 legs), warm = con caches calientes:

| Hito                                         | Latencia warm |
|----------------------------------------------|---------------|
| Roto (sin OI por límite de Candle)           | — (muros null)|
| Fix base (lotes add→wait→remove)             | ~30–40s       |
| #5 SNAPSHOT_END + timeout lote 4s            | ~5s           |
| #1 Filtro banda delta 0.02–0.98              | ~4.4s         |
| #2 Cache diario de OI                        | ~3.7s         |
| #3 Cache de option chain + REST en paralelo  | **~2.4s**     |

### Desglose de los ~2.4s warm
| Segmento                       | Tiempo  |
|--------------------------------|---------|
| spot REST                      | ~210ms  |
| option chain REST              | ~1280ms (cacheado → ~0 en warm) |
| handshake DXLink (connect+auth+channel) | ~830ms  |
| Greeks (Fase 1)                | ~850ms  |
| Candle (Fase 2)                | ~2.3s cold / ~0.5s warm |

---

## 7. Próximas mejoras candidatas

- **#C — Reusar conexión DXLink persistente (~830ms).** Hoy cada llamada abre un WebSocket nuevo y
  hace el handshake completo. Ya existe `DxLinkStreamingService` con conexión persistente y
  autenticada; ruteando greeks/candles por un canal compartido se elimina ese costo por llamada.
  Es el mayor ahorro restante pero el más invasivo (multiplexar request/response, concurrencia,
  aislar suscripciones). Alto impacto / alto riesgo.
- **Cachear símbolos sin OI** (los ~115 in-band con OI=0 se re-fetchean cada vez). Llevaría `toFetch→0`
  en warm (~0.5s menos). Ganancia chica vs. complejidad; baja prioridad.
- **Tunear batch size de Candle** hacia el límite real de DXLink (probado: 80 anda, 100 acumulado falla)
  para reducir el número de lotes. Ganancia moderada.
- **Reducir la fase de Greeks (~850ms)** — sólo si se vuelve el cuello dominante tras #C.

---

## 8. Invariantes / no romper

- Mantener el **batching de Candle** (límite de DXLink). No suscribir todos de una.
- Mantener `EnsureConnectedAsync` (evita el AUTH timeout intermitente).
- Mantener el **log de ERROR de DXLink** (no volver al `catch {}` vacío).
- Los caches (`_chainCache`, `_oiCache`) son **por día UTC**; el OI es el settled del día previo y no
  cambia intradía, por eso es seguro cachearlo. Si se necesita refresco intradía de OI, invalidar por tiempo.
- Call Wall siempre **arriba** del spot; Put Wall siempre **abajo** (definición estándar de muros GEX).

---

## 9. Bugs conocidos / observaciones abiertas

- **`AUTH timeout` residual / outlier de latencia:** muy reducido tras `EnsureConnectedAsync`, pero
  puede aparecer un outlier ocasional (se vio una corrida de ~71s, no reproducible). Si reaparece,
  revisar el handshake / agregar retry de extremo a extremo.
- **Signo/magnitud de `netGEX`:** en pruebas SPY dio negativo grande (≈ −169B). La Capa macro espera
  GEX positivo; revisar la convención de signo/escala del agregado por separado (no es bug de este fix).

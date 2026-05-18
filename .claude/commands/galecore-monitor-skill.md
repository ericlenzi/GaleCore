---
description: >
  Skill para el repositorio galecore-monitor. Usar cuando se trabaje con el dashboard React,
  componentes del frontend, Zustand stores, SignalR, Tailwind, TickerCard, ValidationLayers,
  GexChart, PositionMonitor, estrategia de datos (polling vs socket), o cualquier parte del
  código TypeScript del monitor. Incluye la regla de oro del frontend y la documentación de
  la excepción layers en analytics.ts.
---

# GaleCore Monitor — Referencia

Dashboard de decisión de trading en React 18 + TypeScript. Muestra el estado del sistema,
el análisis por ticker (capas de validación) y el seguimiento de posiciones abiertas.

---

## Regla de oro: el front no calcula nada estratégico

> **El frontend es un display, no un motor.**
> Todo cálculo de negocio — GEX, IV Rank, Gamma Zero Level, Black-Scholes, Expected Move,
> selección de strikes, señal de trading — ocurre en DataFeed (el backend).
> El monitor solo muestra datos ya resueltos.

Esta regla existe por tres razones:

1. **Single source of truth**: los valores de negocio los define el backend. Si el monitor
   hiciera sus propios cálculos, podría divergir silenciosamente del motor real de señales.
2. **Testabilidad**: los cálculos en el backend son unit-testables, versionables y auditables.
   Los cálculos ocultos en un componente React no lo son.
3. **Consistencia**: la misma instancia de DataFeed alimenta el monitor, el motor de señales y
   las herramientas MCP de Claude Code. Si el monitor recalculara algo, tendríamos tres fuentes
   diferentes para el mismo dato.

**Consecuencia práctica**: si algo no viene de la API, no se muestra. Si un valor parece
necesitar un cálculo en el frontend, la solución es crear o extender un endpoint en DataFeed.

---

## La excepción: analytics.ts (combinación de datos ya resueltos)

**Archivo**: `src/api/analytics.ts` — función `fetchGammaExposure`

Esta función es la única excepción a la regla de oro, y existe por una razón concreta:
la API de GammaExposure devuelve un array de strikes con GEX individual, pero el monitor
necesita tres derivados de ese array para renderizar:

| Derivado   | Cálculo                                                        | Usado en             |
|------------|----------------------------------------------------------------|----------------------|
| `callWall` | Strike con el mayor `callGEX` positivo                        | ValidationLayers, GexChart |
| `putWall`  | Strike con el `putGEX` más negativo (mínimo del array)        | ValidationLayers, GexChart |
| `netGex`   | Suma de `netGEX` de todos los strikes, convertida M → B       | TickerCard (Capa 1)  |

```typescript
// analytics.ts — fetchGammaExposure
const callWallStrike = strikes.reduce(
  (best, s) => (s.callGEX > best.callGEX ? s : best),
  strikes[0] ?? { strike: 0, callGEX: 0, putGEX: 0, netGEX: 0 }
);
const putWallStrike = strikes.reduce(
  (best, s) => (s.putGEX < best.putGEX ? s : best),
  strikes[0] ?? { strike: 0, callGEX: 0, putGEX: 0, netGEX: 0 }
);
const netGex = strikes.reduce((sum, s) => sum + s.netGEX, 0) / 1000;
```

**Por qué existe como excepción y no viola la regla**:

La API ya calculó el `callGEX`, `putGEX` y `netGEX` de cada strike usando Black-Scholes.
Lo que hace `analytics.ts` es únicamente **navegar el array** para extraer el máximo, el mínimo
y la suma — operaciones de presentación (encontrar el muro más alto/bajo), no cálculos
financieros. No hay fórmulas de pricing, no hay estimaciones de probabilidad, no hay lógica
de negocio. Es equivalente a lo que haría un `Array.reduce` para ordenar una tabla.

**Qué no debe hacerse aquí**: si en algún momento se quisiera calcular el Expected Move,
determinar si el GEX supera el umbral de $100B con lógica propia, o derivar strikes sugeridos,
esa lógica pertenece a DataFeed — no a `analytics.ts`.

---

## Stack tecnológico

| Elemento        | Tecnología                                        |
|-----------------|---------------------------------------------------|
| Framework       | React 18 + TypeScript + Create React App          |
| Estilos         | Tailwind CSS (dark theme fijo, bloomberg-style)   |
| Charting        | `lightweight-charts` (TradingView)                |
| Real-time       | `@microsoft/signalr` (hub `/hubs/marketdata`)     |
| HTTP            | `axios` con interceptor de API Key                |
| Estado global   | Zustand                                           |
| Iconos          | `lucide-react`                                    |

---

## Fuentes de datos

| Fuente   | Descripción                                        | Protocolo            |
|----------|----------------------------------------------------|----------------------|
| `socket` | Precios y Greeks en tiempo real via SignalR        | WebSocket            |
| `data`   | Analytics: GEX, IV Rank, Account, posiciones       | REST HTTP GET        |
| `rules`  | Reglas y tickers de la estrategia                  | REST HTTP GET (JSON) |

El origen primario de datos siempre es DataFeed. El monitor nunca genera sus propios datos.

---

## Variables de entorno

```bash
# Local
PORT=3039
REACT_APP_API_BASE_URL=http://localhost:7001
REACT_APP_SIGNALR_HUB_URL=http://localhost:7001/hubs/marketdata

# Producción
REACT_APP_API_BASE_URL=https://datafeed-g5b4dkfccda5hkdh.chilecentral-01.azurewebsites.net
REACT_APP_SIGNALR_HUB_URL=https://datafeed-g5b4dkfccda5hkdh.chilecentral-01.azurewebsites.net/hubs/marketdata
```

---

## Estructura de archivos

```
src/
├── api/
│   ├── client.ts           # axios instance con X-API-KEY interceptor
│   ├── rules.ts            # GET /App/GaleCore/Rules/*
│   ├── analytics.ts        # GET /App.Analytics/* (GEX, IVRank, IV) + excepción layers
│   ├── marketdata.ts       # GET /Data/Tastytrade/MarketData/*
│   └── account.ts          # GET /Data/Account/*
├── socket/
│   └── useMarketSocket.ts  # Hook SignalR: connect, subscribe, disconnect
├── store/
│   ├── useMarketStore.ts   # Precios, Greeks y VIX term structure en tiempo real (Zustand)
│   ├── useAccountStore.ts  # Balances y posiciones
│   └── useRulesStore.ts    # Tickers y rules cargados desde /App/GaleCore/Rules/Core
├── components/
│   ├── layout/
│   │   ├── StatusBar.tsx        # Estado sistema, estado mercado, hora
│   │   └── TabNav.tsx           # Tabs: Inicio / Posiciones / Estrategia
│   ├── ticker/
│   │   ├── TickerCard.tsx       # Card por ticker: precio, variación, capas resumen
│   │   ├── TickerGrid.tsx       # Grid de TickerCards + fetch de datos de mercado
│   │   └── TickerDetail.tsx     # Panel expandible con gráfico GEX + ValidationLayers
│   ├── chart/
│   │   └── GexChart.tsx         # LW-Charts: precio + GEX barras + muros + std dev
│   ├── account/
│   │   └── AccountSummary.tsx   # Net Liq, Buying Power, Cash
│   ├── positions/
│   │   ├── PositionMonitor.tsx  # Tabla de posiciones abiertas
│   │   ├── PositionRow.tsx      # Fila: P&L, Greeks, alertas
│   │   └── NewPositionForm.tsx  # Formulario de ingreso de posición manual
│   ├── validation/
│   │   └── ValidationLayers.tsx # Las 4 capas: semáforo + valores numéricos
│   └── strategy/
│       └── StrategyReference.tsx # Tab Estrategia: reglas, umbrales, protocolo ajuste
├── pages/
│   ├── Home.tsx            # Tab Inicio: AccountSummary + TickerGrid + TickerDetail
│   ├── Positions.tsx       # Tab Posiciones
│   └── Strategy.tsx        # Tab Estrategia
├── types/
│   ├── api.ts              # Tipos de respuesta de la API
│   ├── market.ts           # TickerState, LayerStatus, SignalType, MarketStatus
│   └── position.ts         # Tipos de posiciones y P&L
└── utils/
    └── formatters.ts       # fmtPrice, fmtPct, fmtGex, calcChange, fmtTime, isStale
```

---

## Manejo de datos en tiempo real

### Conexión SignalR

```typescript
// socket/useMarketSocket.ts
const connection = new HubConnectionBuilder()
  .withUrl(process.env.REACT_APP_SIGNALR_HUB_URL)
  .withAutomaticReconnect()
  .build();

// Suscribir a tickers del rules al conectar
tickers.forEach(symbol => connection.invoke('Subscribe', symbol, false));

// Handlers
connection.on('ReceiveTrade', (symbol, data) => updatePrice(symbol, data));
connection.on('ReceiveQuote', (symbol, data) => updateQuote(symbol, data));
```

### Estado en Zustand (`useMarketStore`)

```typescript
interface TickerState {
  symbol: string;
  price: number;
  open: number;
  prevClose?: number;   // base para el % de cambio diario (como TradingView)
  bid: number;
  ask: number;
  volume?: number;
  lastUpdate: Date | null;
  isStreaming: boolean;
  extendedTradingHours?: boolean;
  ivRank?: number;
  iv30?: number; iv9d?: number; iv3m?: number;
  loading: { price: boolean; ivRank: boolean; iv: boolean; gex: boolean; };
  error: { price?: string; ivRank?: string; iv?: string; gex?: string; };
}
```

El store también maneja `vix9d` y `vix3m` a nivel global (market-wide, no por ticker).

### Fallback REST

Si el socket no está disponible al cabo de 10 segundos, `TickerGrid` activa polling REST
cada 30 segundos via `/Data/Tastytrade/MarketData/ByType`. Los datos se marcan visualmente
con `⚠ REST` en el `TickerCard`.

---

## LayerStatus — tipo central del monitor

```typescript
// types/market.ts
export interface LayerStatus {
  // Capa 1 — Régimen & GEX
  vixTermStructureOk: boolean | null;   // VIX9D < VIX3M
  ivRankOk: boolean | null;             // 25–65
  ivRankValue: number | null;
  gexOk: boolean | null;                // ≥ $100B
  gexValue: number | null;              // en billones
  spotAboveZgl: boolean | null;         // Spot > ZGL
  zglValue: number | null;

  // Capa 2 — Motor de strikes
  expectedMove: number | null;
  callWall: number | null;
  putWall: number | null;

  // Capa 3 — Microestructura (ATM)
  atmStrike: number | null;
  atmCallOI: number | null;
  atmPutOI: number | null;
  atmCallDelta: number | null;
  atmPutDelta: number | null;

  // Resumen
  signal: 'OPERAR' | 'ESPERAR' | 'NO OPERAR';
}
```

`LayerStatus` se construye en `TickerGrid.tsx` (`deriveLayerStatus`) combinando datos
del store (VIX, IV Rank) y datos del fetch de GEX (callWall, putWall, spotAboveZgl, zglValue).
Esta construcción no involucra cálculos financieros — solo agrupa datos ya resueltos por la API.

---

## Flujo de carga de datos por ticker

```
TickerGrid mount
  ├── fetchMarketDataByType(symbol) → setOpen + updatePrice + updateQuote
  ├── fetchIVRank(symbol)           → setIVRank
  ├── fetchImpliedVolatility(symbol)→ setIV (iv30, iv9d, iv3m)
  └── [VIX poll cada 5 min]
        fetchMarketDataByType('VIX') + fetchMarketDataByType('VIX3M') → setVix

TickerDetail (al seleccionar un ticker)
  └── fetchGammaExposure(symbol)    → callWall, putWall, zeroGammaLevel, netGex, strikes[]
```

El GEX solo se carga cuando el usuario expande un ticker (TickerDetail). En el grid se muestra
el estado preliminar con solo IV Rank y VIX term structure.

---

## Señal y semáforo

| Señal      | Condición                                                     | Color  |
|------------|---------------------------------------------------------------|--------|
| OPERAR     | Todas las capas en verde (requiere GEX cargado)               | Verde  |
| ESPERAR    | IV Rank y VIX OK pero GEX no cargado aún                     | Amarillo |
| NO OPERAR  | Cualquier capa en rojo                                         | Rojo   |

En el TickerCard (sin GEX cargado), la señal máxima posible es `ESPERAR`, nunca `OPERAR`.
`OPERAR` solo puede emitirse en `TickerDetail` una vez que el GEX fue fetched.

---

## Convenciones de código

- **Lenguaje**: TypeScript estricto. Sin `any` salvo en workarounds de respuestas de API no tipadas.
- **Estilos**: Tailwind classes + inline styles con CSS variables del tema. Sin módulos CSS.
- **Variables CSS del tema**: `--text-primary`, `--text-secondary`, `--text-muted`, `--green`,
  `--red-gc`, `--yellow-gc`, `--blue-gc`, `--bg-secondary`, `--bg-tertiary`, `--border`, `--border-dark`.
- **Fuentes**: `JetBrains Mono` para números/símbolos, `Inter` para labels.
- **Formateo numérico**: usar siempre `fmtPrice`, `fmtPct`, `fmtGex` de `utils/formatters.ts`.
- **Build**: `npm run build` (Create React App)
- **Dev**: `npm start` (PORT=3039)

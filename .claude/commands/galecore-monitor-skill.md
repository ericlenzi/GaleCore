---
description: >
  Skill para el repositorio galecore-monitor. Usar cuando se trabaje con el dashboard React,
  componentes del frontend, Zustand stores, SignalR, Tailwind, TickerCard, DetailsPanel,
  GexChart, PositionMonitor, estrategia de datos (polling vs socket), o cualquier parte del
  código TypeScript del monitor. Incluye la regla de oro del frontend y la documentación de
  la excepción layers en analytics.ts.
---

# GaleCore Monitor — Referencia

Dashboard de decisión de trading en React 18 + TypeScript. Es el frontend de la **plataforma**
GaleCore: muestra el estado del sistema, las posiciones abiertas de la cuenta y una pestaña por
estrategia implementada.

Pestañas reales (`components/layout/TabNav.tsx`, tipo `Tab`):
`inicio` (Main) · `monitor` · `gex` · `rpf`, más `admin` (solo con `isAdmin`) y `cuenta` (se llega
desde el menú **Mi Cuenta**, no tiene botón propio en la barra).

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
`/App.Analytics/GammaExposure` devuelve un array de strikes con GEX individual, pero quien la
consume necesita derivados de ese array para renderizar:

| Derivado   | Cálculo                                                  | Usado en                                      |
|------------|----------------------------------------------------------|-----------------------------------------------|
| `callWall` | Strike con el mayor `callGEX` positivo                   | `PositionCard` → `StrikeLadder` (tab Monitor) |
| `putWall`  | Strike con el `putGEX` más negativo (mínimo del array)   | `PositionCard` → `StrikeLadder` (tab Monitor) |
| `netGex`   | Suma de `netGEX` de todos los strikes, convertida M → B  | hoy ninguna pantalla lo renderiza             |

**Quién la llama**: un solo lugar, `components/positions/PositionMonitor.tsx` (tab Monitor), que
pide el GEX de cada subyacente con posición abierta y se lo pasa a `PositionCard`.
**Ojo**: `GexChart` **no** se alimenta de acá — en la pestaña GEX lo alimenta `pages/Gex.tsx` con
`/App/Gex/Analysis` vía `useGexStore`, donde los muros ya vienen calculados por el backend.

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
determinar si el GEX supera un umbral con lógica propia, o derivar strikes sugeridos,
esa lógica pertenece a DataFeed — no a `analytics.ts`.

---

## Stack tecnológico

| Elemento        | Tecnología                                        |
|-----------------|---------------------------------------------------|
| Framework       | React 18 + TypeScript + Create React App          |
| Estilos         | Tailwind CSS (dark theme fijo, bloomberg-style)   |
| Charting        | `lightweight-charts` (TradingView)                |
| Real-time       | `@microsoft/signalr` (hub `/hubs/marketdata`)     |
| HTTP            | `axios` con interceptor de auth                   |
| Auth            | Supabase (`auth/supabase.ts`) — JWT por request   |
| Estado global   | Zustand                                           |
| Iconos          | `lucide-react`                                    |

---

## Fuentes de datos

| Fuente   | Descripción                                                                                     | Protocolo            |
|----------|--------------------------------------------------------------------------------------------------|----------------------|
| `socket` | Precios y Greeks en tiempo real + orquestación RPF, vía SignalR                                   | WebSocket            |
| `data`   | Analytics: GEX, IV Rank, Account, posiciones                                                     | REST HTTP GET        |
| `rules`  | Config de la app (`/App/GaleCore/Rules/Core`) y JSON de cada estrategia (`/App/<Prefijo>/Rules`)  | REST HTTP GET (JSON) |

El origen primario de datos siempre es DataFeed. El monitor nunca genera sus propios datos.

Los dos niveles de `rules` **no se mezclan**: la config de la app arma las pantallas transversales
(`strategies[]` → cards de Main, `monitor` → umbrales del Monitor, `universe.tickers` → lo que se
suscribe al hub), y el JSON de cada estrategia arma su pestaña y su modal de References.

---

## Autenticación

`api/client.ts` manda **el JWT de Supabase** (`Authorization: Bearer`) cuando hay sesión, y cae a
`X-API-KEY` solo si no la hay. El hub hace lo mismo por `accessTokenFactory` — nunca por query
string a mano.

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
│   ├── client.ts           # axios instance: JWT de Supabase, fallback X-API-KEY
│   ├── rules.ts            # fetchAppConfig (/App/GaleCore/Rules/Core) + fetchRpfRulesRaw
│   ├── analytics.ts        # /App.Analytics/{GammaExposure,IVRank,ImpliedVolatility} + excepción layers
│   ├── gex.ts              # /App/Gex/{Rules,Analysis} + GEX_SWITCH_ENDPOINT
│   ├── rpf.ts              # RPF_SWITCH_ENDPOINT (el switch se llama por strategies.ts)
│   ├── strategies.ts       # fetchStrategySwitch / setStrategySwitch — genéricos por endpoint
│   ├── marketdata.ts       # /Data/Tastytrade/MarketData/* (ByType, batch, quote, candles)
│   ├── account.ts          # /Data/Account/* + describeAccountError (409 broker_account_not_linked)
│   ├── me.ts               # /App/GaleCore/Me: username, isAdmin, canManagePlatform
│   ├── admin.ts            # ABM de usuarios (solo admin)
│   └── brokerAccount.ts    # vincular / desvincular la cuenta de bróker propia
├── auth/
│   └── supabase.ts         # sesión, getAccessToken, signOut
├── socket/
│   └── useMarketSocket.ts  # Hook SignalR: connect, subscribe/unsubscribeLeg (includeGreeks=true),
│                           #   handlers ReceiveTrade/Quote/Greeks + los de RPF
├── store/
│   ├── useMarketStore.ts        # Precios, quotes y Greeks por símbolo (Zustand) + ivRank / iv
│   ├── useAccountStore.ts       # Balances y posiciones. ES DE LA PERSONA: un error PISA los datos
│   ├── useCurrentUserStore.ts   # Quién está logueado y qué puede (/App/GaleCore/Me)
│   ├── useAppConfigStore.ts     # Config de la app: universe.tickers, strategies[], monitor
│   ├── useGexStore.ts           # GEX: reglas propias + cache de /App/Gex/Analysis + scope elegido
│   ├── useRpfStore.ts           # RPF: estados por símbolo + sugerencias (SignalR)
│   ├── useStrategySwitchStore.ts # Dueño ÚNICO del estado de los switches, por switch_endpoint
│   └── resetUserScoped.ts       # Limpia lo que es de la persona al cambiar de sesión
├── components/
│   ├── LoginScreen.tsx
│   ├── layout/
│   │   ├── StatusBar.tsx        # Estado sistema, estado mercado, hora
│   │   ├── Sidebar.tsx          # AccountSummary + AccountPositionsList
│   │   ├── TabNav.tsx           # Main / Monitor / GEX / RPF · derecha: Admin (isAdmin) + AccountMenu
│   │   └── AccountMenu.tsx      # Mi Cuenta: cuenta de bróker, contraseña, salir
│   ├── common/
│   │   ├── StrategySwitch.tsx   # Switch ON/OFF reusable: recibe fetchState/setState
│   │   ├── ReferencesModal.tsx  # Modal References: solapas Definiciones + Json
│   │   ├── Modal.tsx            # Modal genérico (overlay + header + Escape)
│   │   ├── NoticePanel.tsx      # Cartel que reemplaza a una pantalla sin nada válido que mostrar
│   │   ├── StrategyOffPanel.tsx # NoticePanel en rojo: estrategia apagada
│   │   └── SectionTitle.tsx     # Encabezado de pantalla: nombre + badge + controles
│   ├── strategies/              # Tab Main
│   │   ├── StrategyCard.tsx     # Card por estrategia: identidad + switch + "Abrir"
│   │   └── ServiceCard.tsx      # Card por servicio de plataforma (services[]): solo su switch
│   ├── ticker/
│   │   ├── TickerCard.tsx       # Card por ticker: precio, variación, bid/ask/vol, badge OPEN, ⚠ REST
│   │   └── TickerGrid.tsx       # Grid de TickerCards. `symbols` es obligatorio: lo pasa la pantalla
│   ├── chart/
│   │   ├── GexChart.tsx         # LW-Charts: velas + muros + ZGL + std dev
│   │   └── GexBarsPanel.tsx     # Panel SVG de barras de gamma por strike
│   ├── gex/                     # Tab GEX
│   │   ├── DetailsPanel.tsx     # Cuadro Details: los 10 indicadores agrupados por la PREGUNTA que
│   │   │                        #   contestan (mercado / volatilidad / gamma / precio). Sin semáforo
│   │   ├── OptionsChainList.tsx # Lista de vencimientos (0DTE primero) + scope global
│   │   ├── ExpiryEngine.tsx     # ZGL, muros, EM, Net GEX del vencimiento elegido
│   │   ├── GexReference.tsx     # Panel de Definiciones de GEX (solapa del modal References)
│   │   └── graphLayout.ts       # Anchos fijos de la fila Graph (CHAIN_COL_W, GEX_BARS_W)
│   ├── account/
│   │   ├── AccountSummary.tsx       # Net Liq, Buying Power, Cash
│   │   ├── AccountPositionsList.tsx # Posiciones agrupadas en la Sidebar
│   │   ├── BrokerAccountCard.tsx    # Vincular/desvincular la cuenta propia, rotar refresh token
│   │   └── MyPasswordCard.tsx       # Cambio de la contraseña propia (directo a Supabase)
│   ├── admin/
│   │   └── UserForm.tsx         # Alta/edición de usuario (tab Admin)
│   ├── positions/
│   │   └── PositionMonitor.tsx  # Tab Monitor: posiciones abiertas (transversal a estrategias)
│   ├── monitor/                 # Piezas del tab Monitor (UI en inglés, bloomberg-style)
│   │   ├── PortfolioRiskBar.tsx # Net Liq / Buying Power / Daily P&L / Portfolio Heat / Positions
│   │   ├── PositionCard.tsx     # Card por spread: strikes, Greeks live, triggers de gestión, legs
│   │   └── StrikeLadder.tsx     # Zonas MAX LOSS / RISK / PROFIT con spot, strikes y muros GEX
│   ├── rpf/                     # Tab RPF
│   │   ├── RpfStateBadge.tsx    # Badge del estado de la máquina
│   │   └── RpfSuggestionCard.tsx # Sugerencia de trade con accept/dismiss
│   └── strategy/
│       ├── StrategyReference.tsx   # Panel de Definiciones de RPF (lee /App/Rpf/Rules)
│       ├── strategyReferences.tsx  # Registro id de estrategia → panel + fetchJson
│       └── ReferencePrimitives.tsx # Primitivas visuales de los paneles de References
├── pages/
│   ├── Home.tsx            # Tab Main: cards desde strategies[] + services[] y sus switches
│   ├── Monitor.tsx         # Tab Monitor: wrapper de PositionMonitor
│   ├── Gex.tsx             # Tab GEX: universo + Details + Graph (chain, Expiry Engine, velas, barras)
│   ├── Rpf.tsx             # Tab RPF: orquestación por SignalR
│   ├── Admin.tsx           # Tab Admin: ABM de usuarios y permisos (solo admin)
│   └── MyAccount.tsx       # Pestaña `cuenta`: la cuenta de bróker propia
├── types/
│   ├── api.ts              # AppConfig/StrategyEntry/ServiceEntry, MacroRegimeChecks, StructureInputs
│   ├── market.ts           # TickerState (lo único que quedó: el resto era de la cascada v1.4.0)
│   ├── position.ts         # Tipos de posiciones y P&L
│   ├── gex.ts              # Tipos de /App/Gex/*
│   └── rpf.ts              # Tipos de la orquestación RPF
├── utils/
│   ├── formatters.ts       # fmtPrice, fmtPct, fmtGex, fmtPnl, calcChange, fmtTime, isStale, tint…
│   ├── spreadBuilder.ts    # Arma spreads live desde las posiciones de la cuenta
│   ├── streamerSymbol.ts   # OCC → símbolo DXLink, legMid, crédito neto actual
│   └── authState.ts        # Marca "entré sin poder validar la clave" (la muestra StatusBar)
└── App.tsx                 # Login vs Dashboard. La `key` del Dashboard es el id del usuario:
                            #   si cambia la persona, el tablero se remonta y vuelve a pedir todo
```

(El scaffolding de CRA — `index.tsx`, `setupTests.ts`, `reportWebVitals.ts`,
`react-app-env.d.ts`, `App.test.tsx` — no se lista: no tiene lógica del proyecto.)

---

## Manejo de datos en tiempo real

### Conexión SignalR

```typescript
// socket/useMarketSocket.ts
const connection = new signalR.HubConnectionBuilder()
  .withUrl(hubUrl, { accessTokenFactory: async () => (await getAccessToken()) ?? '' })
  .withAutomaticReconnect()
  .build();

// Handlers
connection.on('ReceiveTrade',  (symbol, data) => updatePrice(symbol, data));
connection.on('ReceiveQuote',  (symbol, data) => updateQuote(symbol, data));
connection.on('ReceiveGreeks', (symbol, data) => updateGreeks(symbol, data)); // legs de opción
// Orquestación RPF
connection.on('ReceiveRpfState', ...); connection.on('ReceiveTradeSuggestion', ...);
connection.on('ReceiveRpfSwitch', (enabled) => useStrategySwitchStore.getState().apply(...));
```

**La conexión NO depende de tener universo** y no se ata a `tickers`: se abre una vez y vive lo que
vive el tablero. El hub transporta mucho más que precios de subyacentes (orquestación de RPF,
quotes/Greeks de los legs del Monitor), así que reconstruirla cada vez que cargaba la config dejaba
todo eso muerto. `Subscribe` es lo único condicional. Sin transporte forzado: se negocia — forzar
long-polling fue lo que hizo posible un cuelgue del loop de RPF.

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
  // Greeks por contrato, live desde DXLink (ReceiveGreeks) — solo para legs de opción
  delta?: number; gamma?: number; theta?: number; vega?: number; iv?: number;
  loading: { price: boolean; ivRank: boolean; iv: boolean; gex: boolean; };
  error: { price?: string; ivRank?: string; iv?: string; gex?: string; };
}
```

### Fallback REST

Si a los 10 segundos un símbolo no está streameando, `TickerGrid` arranca polling REST cada 30
segundos con `fetchMarketDataBatch` (`/Data/Tastytrade/MarketData/ByType`). Esos datos se marcan
con `⚠ REST` en el `TickerCard`.

---

## Cómo carga datos cada pantalla

**TickerGrid** (lo montan las pantallas que muestran universo) hace **una sola** llamada batch de
market data al montar, y nada más: no pide IV Rank, ni IV, ni VIX. El universo se lo pasa la
pantalla dueña por prop `symbols` — la grilla no conoce ningún universo por defecto.

**Tab GEX** (`pages/Gex.tsx`; se monta recién al entrar a la pestaña porque el barrido es caro):

```
loadRules()      → /App/Gex/Rules    → universo, checks, display_config (grupos del Details)
fetchGex(symbol) → /App/Gex/Analysis → cache por símbolo en useGexStore + refresh por setInterval
  ├── DetailsPanel     ← macroRegime.checks + structureInputs (el VIX viene resuelto del backend)
  ├── OptionsChainList ← vencimientos (0DTE primero) + scope global
  ├── ExpiryEngine     ← ZGL, muros, EM, Net GEX del scope elegido
  └── GexChart + GexBarsPanel ← velas 1h + strikes del scope elegido
```

**Tab Monitor** (`components/positions/PositionMonitor.tsx`, auto-refresh cada 60s):

```
fetchPositions + fetchBalances → useAccountStore → buildLiveSpreads
fetchGammaExposure(subyacente) → callWall / putWall → PositionCard → StrikeLadder
fetchIVRank(subyacente)        → useMarketStore
subscribeLeg(streamerSymbol)   → Greeks live por leg (includeGreeks=true)
```

**Ninguna pantalla transversal depende de una estrategia**: el Monitor suscribe sus propios
subyacentes, así que apagar GEX o RPF no le apaga el precio a una posición abierta.

---

## Estrategia apagada (switch en OFF)

El estado de los switches tiene un solo dueño en el front: `useStrategySwitchStore`, indexado por
`switch_endpoint`. Lo leen y lo escriben la card de Main, la pantalla de la estrategia y el evento
`ReceiveRpfSwitch` del hub.

**En OFF la pantalla se reduce al encabezado + `StrategyOffPanel`**: título, References, el switch y
el cartel. Cortar el árbol de React ahí apaga actividad real, no píxeles — los efectos que suscriben
al hub y disparan los fetch viven dentro de los componentes que dejan de montarse.

Corolario general: **un error nunca deja el dato viejo a la vista.** Números plausibles que nadie
confronta se leen como vigentes.

---

## Cómo se ordena un panel de contexto

Un panel agrupa sus métricas **por la pregunta que contesta**, no por el origen del dato.
`DetailsPanel` es el caso de referencia: reemplazó a `ValidationLayers` + `MarketDiagnostics`, que
repartían los mismos diez indicadores en dos columnas según vinieran de `macroRegime.checks` o de
`structureInputs`.

* Los grupos, sus etiquetas y qué métrica va en cada uno los declara el JSON de la estrategia
  (`display_config...details_panel.groups`); el front solo sabe dibujar cada id.
* Lo que no depende del símbolo (VIX, VIX9D) va en su propia franja rotulada, no bajo el encabezado
  del símbolo. Lo declara el `scope` del grupo (`market` / `symbol`).
* **El semáforo verde/rojo con ✓/✗ es vocabulario de decisión y no va en una pantalla informativa.**
  GEX no tiene gates (sus checks son `on_fail: inform_only`). Cada celda muestra su referencia en
  texto, y el color queda solo para las métricas cuyo valor ES una dirección de mercado (skew de
  muros, trend), con los mismos colores que los muros del gráfico.

---

## Convenciones de código

- **Lenguaje**: TypeScript estricto. Sin `any` salvo en workarounds de respuestas de API no tipadas.
- **Estilos**: Tailwind classes + inline styles con CSS variables del tema. Sin módulos CSS.
- **Variables CSS del tema**: `--text-primary`, `--text-secondary`, `--text-muted`, `--green`,
  `--red-gc`, `--yellow-gc`, `--blue-gc`, `--bg-secondary`, `--bg-tertiary`, `--bg-elevated`,
  `--border`, `--border-dark`, `--border-light`, más los `--*-muted` / `--*-border` de cada color y
  las sombras `--shadow-sm` / `--shadow-glow-blue`.
- **Fuentes**: `JetBrains Mono` para números/símbolos, `Inter` para labels.
- **Formateo numérico**: usar siempre los helpers de `utils/formatters.ts` (`fmtPrice`, `fmtPct`,
  `fmtGex`, `fmtPnl`, `fmtOI`, `fmtExpiry`), nunca un `toFixed` suelto.
- **Build**: `npm run build` (Create React App)
- **Dev**: `npm start` (PORT=3039)

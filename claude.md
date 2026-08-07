# GaleCore 

## Resumen del proyecto
GaleCore es una **plataforma** tecnológica para automatización y análisis de estrategias con opciones
financieras. **GaleCore no es una estrategia**: es el contexto sobre el que se implementan proyectos de
estrategias — cada uno con su prefijo, su JSON de reglas, sus endpoints y su pestaña.

La plataforma provee:
  * **Backend api** (`galecore-datafeed`) — datos de mercado y de cuenta, analytics compartidos, hub de tiempo real
  * **Frontend monitor** (`galecore-monitor`) — tablero: Main (índice de estrategias), Monitor (posiciones), una pestaña por estrategia
  * **Config de aplicación** — `galecore_rules_core.json`, que declara qué estrategias existen

Las estrategias son ciudadanos de primera, no parte del núcleo. Hoy hay dos: **RPF** (operativa) y
**GEX** (informativa). Cuáles son: ver "Estrategias". Cómo se agrega una: ver "Estrategias — convención".

## Estrategias

  Registro de las estrategias implementadas en GaleCore. **Cada estrategia tiene su documentación
  completa en `docs/<prefijo>/`**, y el archivo de definición que se linkea acá es su fuente de verdad
  conceptual — este nodo es solo el índice.

| Prefijo | Tipo | Nombre | Descripción | Definición |
|---|---|---|---|---|
| `Rpf` | Operativa | Disparo por prima real | Venta de prima con riesgo definido decidida por dos ejes ortogonales: la **seguridad arma** el entorno y la **prima dispara** la operación (VRP + edge, en AND no-compensable). Máquina de 7 estados por símbolo sobre un loop backend; sugiere por SignalR y **nunca ejecuta**. | [`docs/rpf/galecore-estrategia-rpf.md`](docs/rpf/galecore-estrategia-rpf.md) · [índice](docs/rpf/README.md) |
| `Gex` | Informativa | Gamma Exposure | GEX global de toda la cadena dentro de `max_dte` (50), incluido 0DTE y weeklies. **Sin trades**: no propone estructura, no calcula strikes ni sizing, no emite señales — su único producto es información para decidir. | [`docs/gex/galecore-estrategia-gex.md`](docs/gex/galecore-estrategia-gex.md) · [índice](docs/gex/README.md) |

  Los tres lugares donde vive una estrategia y que **tienen que coincidir**:
  * **Este nodo** — el índice narrativo, con el link a su doc.
  * **`strategies[]` de `galecore_rules_core.json`** — lo que Main renderiza (`prefix`, `kind`, `name`,
    `description`, `rules_endpoint`, `workers_endpoint`). Es lo que lee la app; este nodo es lo que
    leemos nosotros.
  * **`docs/<prefijo>/`** — la carpeta con toda su documentación.

  **Case del prefijo:** capitalizado en ruta HTTP (`/App/Rpf`), carpeta de archivos (`Files/Rpf/`) y tag
  de Swagger (`App.Rpf`); **minúscula** en `docs/<prefijo>/`, en el `id` y en el `tab` del config.

## Stack

### Estructura
/docs (archivos de información del proyecto)
/source (carpeta donde se guarda el código fuente del proyecto)
  /galecore-datafeed (carpeta del código backend api)
  /galecore-monitor (carpeta del código frontend monitor)


### Config de la aplicación — `galecore_rules_core.json`

  Es la configuración de la **plataforma**, no de una estrategia. Vive en `DataFeed.Api/Files/` y se
  sirve tal cual por `GET /App/GaleCore/Rules/Core`. **Nada de trading vive ahí** — ni gates, ni
  strikes, ni sizing. Contrato:

  * `strategies[]` — las estrategias implementadas. Cada entrada: `id`, `prefix`, `tab`, `label`,
    `name`, `kind` (`operativa` / `informativa`), `description`, `rules_endpoint`, `workers_endpoint`.
    Es lo que **Main** renderiza como cards. Una estrategia que no figura acá existe en la API pero
    es invisible en el tablero.
  * `monitor` — config de la pestaña Monitor, que es transversal (monitorea las posiciones de la
    cuenta sin importar quién las abrió): `monitor.trade_management` (take_profit, defensive_roll,
    time_exit, hard_defense, daily_kill_switch) y `monitor.risk_limits` (max_concurrent_positions,
    portfolio_heat_max_pct, risk_per_trade_pct).

  Lo consume `useAppConfigStore` en el front. Congelado por `DataFeed.Tests/RulesJsonTests.cs`:
  el front lee todo con optional chaining y defaults hardcodeados, así que un nodo renombrado no
  rompe el build — muestra umbrales que nadie configuró.

  **Historia:** hasta v1.4.0 este archivo (con sus overlays `live` / `paper`) era el JSON de reglas
  de la estrategia `gale_core_gamma_premium` (PCS-only, 4 capas en cascada). Esa estrategia se
  eliminó el 2026-08-06 — su evaluación en vivo ya se había mudado a RPF. Definición conceptual
  archivada en `docs/archive/`.

### Estrategias — convención

  Toda estrategia es un proyecto propio dentro de la plataforma, identificado por un `<Prefijo>`
  (`Rpf`, `Gex`, …) que manda en TODOS lados: ruta HTTP, carpeta de archivos, tag de Swagger.

  **Checklist para agregar una estrategia nueva:**
  1. Elegir `<Prefijo>`.
  2. `DataFeed.Api/Files/<Prefijo>/galecore_rules_<prefijo>.json` — su fuente de verdad.
     Revisar que el `.csproj` copie la subcarpeta (ver "archivos por estrategia").
  3. Endpoints bajo `/App/<Prefijo>/*` en `AppController.cs`, con su `#region` y su tag de Swagger
     `App.<Prefijo>`. Mínimo: `GET /App/<Prefijo>/Rules` sirviendo el JSON tal cual.
  4. **Entrada en `strategies[]` de `galecore_rules_core.json`.** Sin esto no aparece en Main.
  5. Pestaña propia en `TabNav.tsx`, con el mismo id que declara `tab` en el config.
  6. Switch **Workers** si corre procesos o mantiene sockets propios (ver "switch Workers"), con su
     `<prefijo>_workers_state.json` en su carpeta — gitignoreado.
  7. Test que congele los invariantes de su JSON, al estilo `GexRulesJsonTests.cs`.
  8. **Carpeta `docs/<prefijo>/`** (minúscula) con su definición canónica
     `galecore-estrategia-<prefijo>.md` y un `README.md` que indexe la carpeta. Ahí va TODA su
     documentación: definición, research, decisiones. **Fila nueva en el nodo "Estrategias"** de este
     archivo, linkeando esa definición.

  **Lo que las estrategias comparten:** los primitivos de cálculo de `App/Shared/CascadeUtils.cs` y
  los contratos de `App/Shared/Dtos/CascadeContracts.cs`. Cada una le pasa SU propio JSON — los
  primitivos no saben de qué estrategia son.

  **Prohibido terminantemente en cualquier estrategia:** naked shorts de cualquier tipo, ratio
  spreads, y cualquier posición long direccional. Solo estructuras de riesgo definido.


### Backend DataFeed

- Fuente de verdad — JSON de reglas
  **Cada estrategia tiene su propio JSON** en `Files/<Prefijo>/`, y ese archivo es su fuente de verdad:
  ahí viven su lógica de validación, sus umbrales, su universo y sus parámetros de riesgo.
  `galecore_rules_core.json` **no** es de ninguna estrategia — es la config de la aplicación (ver arriba).
  **Regla de trabajo:** ante cualquier cambio de lógica o parámetro, primero se actualiza el JSON y luego se ajustan
  los endpoints o handlers del backend para reflejar ese cambio. Nunca al revés.
  El backend expone los JSON tal cual — no los interpreta ni los transforma. La ruta es fija por
  estrategia, no el nombre del archivo: `GET /App/<Prefijo>/Rules` sirve
  `Files/<Prefijo>/galecore_rules_<prefijo>.json` (`/App/Rpf/Rules`, `/App/Gex/Rules`), y
  `GET /App/GaleCore/Rules/Core` sirve la config de la app.
  Ya no hay overlays ni `DeepMerge`: se fueron con la estrategia v1.4.0.

- Resumen del proyecto
  Solución .NET Core Web API API DataFeed (ASP.NET Core/.NET 8) que provee acceso a datos del mercado y cuenta de trading vía Tastytrade/DXLink.
  Esta api desarrolla el código necesario para el funcionamiento de cada estrategia. 
  
- Arquitectura
  This is a .NET 8 ASP.NET Core Web API that serves as a **financial market data feed and processes**, 
  primarily consuming the Tastytrade API and DXLink WebSocket feed for options and equity data.

  Three-Layer Clean Architecture:
  * DataFeed.Api - (Presentación) ASP.NET Core host, controllers, middleware. References both Application and Infrastructure.
  * DataFeed.Application - (Negocio) Business logic using MediatR CQRS handlers. References Infrastructure. Contains Black-Scholes pricing functions and Tastytrade symbol helpers.
  * DataFeed.Infrastructure - (Externo) External API providers (Tastytrade REST + WebSocket, FRED

  Tecnología: 
  * .NET 8
  * ASP.NET Core Web API
  * WebSockets
  * Tastytrade API
  * dxFeed

- Testing y CI
  * `DataFeed.Tests` (xUnit, net8.0). Un archivo de test por JSON, que congela su contrato:
    `RulesJsonTests.cs` (config de app: `strategies[]` completo, prefijo ↔ rutas ↔ carpeta,
    nodo `monitor`, y que no vuelvan a entrar nodos de estrategia), `RpfRulesJsonTests.cs` y
    `GexRulesJsonTests.cs`. Correr: `dotnet test DataFeed.Tests/DataFeed.Tests.csproj`.
  * CI: `.github/workflows/ci.yml` corre restore + build (Release) + test en cada push/PR a master.

- Origen de datos
  El principal origen de datos actualmente es la api de Tastytrade, cuya documentación esta disponible en https://developer.tastytrade.com/

  The API runs on local http://localhost:7001 (IIS Express) and opens Swagger UI at /swagger.
  The API runs on production: https://datafeed-g5b4dkfccda5hkdh.chilecentral-01.azurewebsites.net/swagger/index.html

- Taxonomía de la API — controllers y tags de Swagger
  Dos controllers, cada uno con su prefijo de ruta; dentro, los endpoints se agrupan por tag de Swagger.

  `AppController` → `/App`
  * `App.Analytics` — cálculos matemáticos compartidos por varias estrategias: `GammaExposure`,
    `IVRank`, `ImpliedVolatility`, `PutSkew`. Ojo: son rutas **absolutas**, la URL real es
    `/App.Analytics/<X>` (con punto), no `/App/Analytics/<X>`.
  * `App.GaleCore` — endpoints de la aplicación en general. Hoy solo `Rules/Core` (config de app).
  * `App.<Prefijo>` — un prefijo por estrategia. Hoy: `App.Rpf` → `/App/Rpf/*` y
    `App.Gex` → `/App/Gex/*`. Ver "Convención de rutas HTTP por estrategia" más abajo.

  `DataController` → `/Data`
  * `Data.Api` — datos REST de la cuenta: `Tastytrade/MarketData/ByType`, `Tastytrade/OptionChains`,
    `Tastytrade/Market-metrics/VolatilityData`.
  * `Data.Stream` — datos vía socket/streaming: `Tastytrade/MarketData/{Candle,Trade,Quote,Greeks,TradeQuoteGreeks}`.
  * `Data.Account` — cuenta: `Tastytrade/Account/{Balances,Positions}`.
  Hoy el proveedor (`Tastytrade`) vive en la **ruta**, no en el tag: los tags son planos (`Data.Api`),
  no `Data.Api.<Cuenta>`. El sub-prefijo por cuenta recién hace falta cuando se sume un segundo bróker.

- Endpoints GaleCore
  * `GET /App/GaleCore/Rules/Core` — config de la aplicación (`Files/galecore_rules_core.json`, tal cual).
    Es el único endpoint de `/App/GaleCore/*`: `MacroRegime`, `ValidationLayer`, `PositionBuilder` y
    `Rules/{Live,Paper}` se eliminaron con la estrategia v1.4.0 (2026-08-06). Lo que hacía
    `ValidationLayer` en vivo hoy lo hace el loop de RPF; los `structureInputs` los expone `/App/Gex/Analysis`.
  * WebSocket `/hubs/marketdata`:
    - `Subscribe(symbol, includeGreeks)` → `ReceiveTrade`, `ReceiveQuote` (precio); con `includeGreeks=true` también `ReceiveGreeks` (delta/gamma/theta/vega/IV por opción). Los legs del Monitor se suscriben con `includeGreeks=true`.
    - `SubscribeFlow(symbol)` → `ReceiveFlow` cada 30s (flow de opciones via `FlowBroadcastService`)

- `GammaExposureHandler` — dos modos, y el global es opt-in
  Handler **compartido**: lo consumen `PutSkew`, RPF, `SkewSnapshotService`, el
  `/App.Analytics/GammaExposure` del Monitor y `GexAnalysisHandler`.
  * **Por defecto calcula el GEX de UN vencimiento.** Con los defaults el handler se comporta igual que
    siempre, así que tocar el modo global no cambia a ningún consumidor existente.
  * **Modo global** — opt-in vía `AllExpirations` / `IncludeByExpiry` / `ExpirationTypes` /
    `IncludeZeroDte` / `GreeksBatchSize` en `GammaExposureRequest`. Hoy lo usa solo la estrategia GEX.
    En el agregado, GEX y OI **se suman** por strike; delta/gamma/IV se toman de la expiración más
    cercana (sumarlos no significaría nada).
  * **Los dos números no se comparan.** El GEX global es mayor en magnitud que el de un vencimiento, así
    que los umbrales por símbolo de una estrategia no son trasladables a la otra
    (ver [`docs/gex/galecore-estrategia-gex.md`](docs/gex/galecore-estrategia-gex.md)).

- Convención de rutas HTTP por estrategia
  Cada estrategia expone sus endpoints bajo su propio prefijo de primer nivel: `/App/<Estrategia>/*`.
  * RPF → `/App/Rpf/*`. Hoy: `GET /App/Rpf/Rules` sirve `galecore_rules_rpf.json` tal cual.
  * GEX → `/App/Gex/*`. `GET /App/Gex/Rules` (JSON tal cual) y
    `GET /App/Gex/Analysis?Symbol=` (GEX global + desglose por vencimiento + contexto).
  `/App/GaleCore/*` queda reservado para la plataforma (hoy solo `Rules/Core`); ninguna estrategia
  cuelga de ahí. En `AppController.cs` cada estrategia tiene su `#region` y su tag
  de Swagger (`App.Rpf`), para que la separación se vea tanto en el código como en la UI de Swagger.
  **Aplica solo a HTTP.** La orquestación de RPF viaja por SignalR sobre el hub compartido
  `/hubs/marketdata` (`SubscribeRpf` / `AcceptSuggestion` / `DismissSuggestion` → `ReceiveRpfState`,
  `ReceiveTradeSuggestion`); son métodos de hub, no rutas, y la convención de path no les aplica.

- Regla — archivos por estrategia en `Files/<Prefix>/`
  Los archivos propios de una estrategia (JSON de reglas, estado de runtime, etc.) van en una
  subcarpeta `DataFeed.Api/Files/<Prefix>/`, con el **mismo `<Prefix>` que su ruta HTTP** (`/App/Rpf`
  → `Files/Rpf/`). Así se ve de un vistazo qué archivo pertenece a qué estrategia.
  * RPF → `Files/Rpf/galecore_rules_rpf.json`, `Files/Rpf/rpf_workers_state.json`.
  * GEX → `Files/Gex/galecore_rules_gex.json`, `Files/Gex/gex_workers_state.json`.

  **En la raíz de `Files/` quedan la config de app y lo que no es de ninguna estrategia:**
  `galecore_rules_core.json` (config de la aplicación), `pop_calibration.json` (tabla POP del gate
  `edge`) y `skew25_history.json` (serie para el RoC de `tail_score`). Los dos últimos hoy los lee
  solo RPF, pero quien **escribe** `skew25_history.json` es `SkewSnapshotService`, que no es de
  ninguna estrategia — por eso no se mudan a `Files/Rpf/`.

  **Al agregar una subcarpeta hay que revisar el `.csproj`.** `DataFeed.Api.csproj` copia los JSON al
  output con `<Content Update="Files\**\*.json">` — el `**` es lo que hace que las subcarpetas se
  copien. Con el glob de un solo nivel (`Files\*.json`) el archivo compila pero desaparece del
  output, y el fallo aparece recién en runtime como "archivo no encontrado".

- Regla — switch "Workers" por estrategia
  Toda estrategia que corra procesos en la API (workers / `BackgroundService`) o mantenga conexiones
  socket propias **debe** exponer en el frontend un switch llamado **"Workers"** que permita prenderlos
  y apagarlos manualmente, sin reiniciar la API ni editar archivos a mano.
  Motivo: son procesos que corren solos y emiten sin que nadie los pida; el operador tiene que poder
  cortarlos en el acto.
  Workers actuales: `RpfLoopService`, `FlowBroadcastService`, `SkewSnapshotService`
  (todos en `DataFeed.Api/Infrastructure`).

  **El estado de los switches se ve también en Main**, que renderiza una card por estrategia leyendo
  `strategies[]` del config de la app; cada card monta el mismo `WorkersSwitch` apuntando al
  `workers_endpoint` que la estrategia declara. Por eso el contrato tiene que ser uniforme:
  `GET <workers_endpoint>` → `{ enabled, source }` y `POST <workers_endpoint>` con `{ enabled }`.

  **Dónde vive el estado (regla, no detalle de una estrategia):** en
  `Files/<Prefijo>/<prefijo>_workers_state.json`, **nunca** dentro del JSON de reglas. El JSON de reglas
  es fuente de verdad y se edita deliberadamente, no en runtime; el archivo de estado es un **override**
  y si no existe manda lo que declara el JSON (por eso `source` vale `"override"` o `"rules"`). Persiste
  a disco a propósito — un kill switch que vuelve solo a ON después de un restart es un agujero de
  seguridad. Está gitignoreado: un deploy pisaría el switch del operador.

  **En OFF, la estrategia no hace nada Y su tablero vuelve al estado inicial.** No alcanza con frenar el
  proceso: hay que limpiar el estado que quedó publicado, o un tablero que se conecte después recibe un
  estado congelado como si fuera vigente. Y el semáforo de "online" del front tiene que salir del switch
  **más** la frescura del último dato, para que un worker crasheado también se vea offline.

  Ambas estrategias lo tienen implementado; el cómo, en su doc:
  * **RPF** — kill switch de `RpfLoopService`. Ver
    [`docs/rpf/galecore-rpf-implementacion.md`](docs/rpf/galecore-rpf-implementacion.md).
  * **GEX** — no corre `BackgroundService`, pero el barrido de la cadena anda solo y compite por DXLink;
    el switch es un kill switch de ese barrido. Ver
    [`docs/gex/galecore-estrategia-gex.md`](docs/gex/galecore-estrategia-gex.md).

  **`FlowBroadcastService` y `SkewSnapshotService` no tienen switch todavía** — no son de una
  estrategia en particular, así que falta decidir dónde vive su estado y en qué pantalla se controlan.

- Lógica compartida — `App/Shared/`
  Lo que comparten los motores de decisión de las estrategias. Separado en dos: **lógica** en
  `App/Shared/CascadeUtils.cs` y **contratos** en `App/Shared/Dtos/CascadeContracts.cs`.

  Los contratos NO van al `Dtos/` de la raíz: esa carpeta es de la capa `Data/` (`BaseResponse`,
  `PriceQuoteDTO`, que consumen los handlers de `Data/Tastytrade/*`), y en `App/` cada contrato vive
  con su dominio (`App/Gex/GexAnalysisResponse.cs`).

  `CascadeUtils` — funciones puras, sin I/O ni estado. Cada estrategia le pasa **su** JSON:
  * `EvaluateLayer1(rules, symbol, gex, ivr, iv)` — los 6 checks de régimen macro. La usan RPF (como gate) y GEX (como lectura)
  * `ComputeGexSkew(callGex, putGex)` — `callGEX / (callGEX + |putGEX|)` → `"call_dominant"` / `"put_dominant"` / `"symmetric"`
  * `ComputePriceZScore(candles, ivAtm)` — normaliza retorno en unidades de vol diaria
  * `ComputeTrend(candles)` — EMA 20 vs EMA 50, señal `"up"` / `"down"` / `"neutral"`
  * `ComputeRealizedVol(candles)` — RV 10d/30d en base anualizada
  * `ClassifyRegime(regimeClassification, vix)` — banda de régimen (`low_vol` / `normal` / `elevated` / `caution`)
  * `ResolveStructure` / `EvaluateStructureRules` / `EvaluateCondition` — motor multi-factor declarado en el JSON
  * `BuildOccSymbol`, `SnapToNearestStrike`, `BuildBidAskChecks`, `BuildCreditCheck` y los helpers de JSON

  `CascadeContracts.cs` — `MacroRegimeResult` + sus 6 checks, `StrikeEngineResult` + `LegSymbols`/`LegMeta`,
  `MicrostructureResult` + sus checks, `RiskAndSizingResult`, `StructureInputs` + sus factores.

- FlowAggregatorService
  Singleton que clasifica trades de opciones por agresión (ask-side = bullish, bid-side = bearish).
  Filtra por premium >= $25K. Calcula `netDeltaFlow = (bullish - bearish) / (bullish + bearish)`.
  `FlowBroadcastService` lee el agregador y emite `ReceiveFlow` al hub cada 30s o en cambio de signo de `netDeltaFlow`.

- gex_skew (reemplaza gex_sign)
  Cuando una estrategia exige GEX positivo en su `macro_regime.gex_total`, `gex_sign: "negative"` es
  inalcanzable — el signo no informa nada. Se reemplazó por `gex_skew`, que mide la asimetría de muros:
  `gex_skew = callGEX / (callGEX + |putGEX|)` → `call_dominant` (>0.6), `put_dominant` (<0.4), `symmetric` (0.4-0.6)
  El umbral de GEX lo declara cada estrategia en `definitions.gex_threshold_by_symbol.values`
  (RPF: 0 para SPY). No hay un umbral global de plataforma.

- Símbolos de opción — DXLink streamer vs OCC
  Los dos formatos conviven y **no son intercambiables**: el OCC (21 chars, ver abajo) es el de
  Tastytrade REST, y **DXLink no lo interpreta**. Para suscribir un leg al feed hace falta el símbolo
  *streamer* (ej: `.SPY260717P695`), que sale de
  `GammaExposureStrike.CallStreamerSymbol / PutStreamerSymbol`, poblados en `GammaExposureHandler.cs`
  desde el `strikeMap` de la cadena de opciones. Cualquier estrategia que arme legs para el feed pasa
  por ahí (RPF los publica en `strikeEngine.legSymbols`).

- Seguridad
  * API Key Middleware:
    Valida header X-API-KEY en cada request
    Bypass para: /swagger, /mcp, /favicon.ico
    Configurado en ApiKey del appsettings

  * OAuth2 (Tastytrade):
    Refresh token -> access token (REST API)
    Refresh token -> WebSocket token (DXLink)
    Cache thread-safe con lock
    Singleton registrado como ITastytradeOAuth

- FLUJO DE REQUEST
  HTTP Request -> Controller -> mediator.Send(Request)
  -> MediatR Handler -> Infrastructure Provider (REST o WebSocket) 
  -> AutoMapper -> Response DTO -> JSON

- Potocolos de datos:
  * Tastytrade REST API:
    Market data por tipo y cadenas de opciones (rapido, ~200ms).
    Base URL configurada en Tastytrade:BaseUrl.

  * DXLink WebSocket:
    Handshake fijo: SETUP -> AUTH -> CHANNEL_REQUEST -> FEED_SETUP -> FEED_SUBSCRIPTION
    Espera FEED_DATA, deserializa, cierra conexion.
    Soporta multi-symbol subscription en un solo FEED_SUBSCRIPTION
    (usado para optimizar GammaExposure).
    Timeouts: 10s (trade/quote/greeks), 15s (multi-candle), 30s (candle historico).

- Formato de Simbolo OCC (21 chars):
  SSSSSSYYMMDDTPPPPPQQQ
  * 6 chars simbolo (padded con espacios)
  * 6 chars fecha (yyMMdd)
  * 1 char tipo (C = Call, P = Put)
  * 8 chars strike (5 enteros + 3 decimales)
  
  Ejemplo Formato OCC** (21 chars):
  SPY   260516P00520000 = SPY Put $520, expira 16-May-2026
  │     │      │ └─ Strike × 1000 (8 chars, zero-padded)
  │     │      └─── Tipo: C/P
  │     └────────── Fecha: yyMMdd
  └──────────────── Símbolo (6 chars, space-padded)


### Frontend Monitor

- Fuente de verdad — JSON
  Dos niveles, y no se mezclan:
  * **Config de app** (`/App/GaleCore/Rules/Core` → `useAppConfigStore`) — arma las pantallas
    transversales: `strategies[]` son las cards de **Main**, `monitor` son los umbrales de **Monitor**,
    `universe.tickers` es lo que se suscribe al hub.
  * **JSON de cada estrategia** (`/App/<Prefijo>/Rules`) — arma su pestaña y su modal de References.
    GEX lee su universo, sus checks y su `display_config` de `/App/Gex/Rules`; el panel de Definiciones
    de RPF lee `/App/Rpf/Rules`.

  **Regla de trabajo:** ante cualquier cambio de lógica, labels o estructura de validación, primero se
  actualiza el JSON y luego se ajusta el frontend para reflejar ese cambio. El frontend debe renderizar
  lo que el JSON declara, sin hardcodear lógica de negocio.

- Resumen del proyecto:
  Dashboard de trading en **React + TypeScript + Create React App** para la plataforma GaleCore.
  Pestañas: **Main** (índice de estrategias implementadas + estado de sus workers), **Monitor**
  (posiciones abiertas de la cuenta, transversal a estrategias) y una pestaña por estrategia
  (**GEX**, **RPF**). References dejó de ser pestaña: cada estrategia tiene un botón **References** en
  la cabecera de su pantalla, que abre un modal con dos solapas — **Definiciones** (el panel de la
  estrategia) y **Json** (su `galecore_rules_<prefijo>.json` tal cual lo sirve la API). El componente
  `ReferencesModal` es transversal; cada estrategia le pasa su panel y su `fetchJson`.

- Tecnología:
  | Elemento          | Tecnología                                            |
  |-------------------|-------------------------------------------------------|
  | Framework         | React 18 + TypeScript + Create React App              |
  | Estilos           | Tailwind CSS (dark theme fijo, bloomberg-style)       |
  | Charting          | `lightweight-charts` (TradingView)                    |
  | Real-time         | `@microsoft/signalr` (hub `/hubs/marketdata`)         |
  | HTTP              | `axios` con interceptor de API Key                    |
  | Estado global     | Zustand                                               |
  | Íconos            | `lucide-react`                                        |

- Fuente de datos:
  El origen de datos primario del monitor es la api datafeed. 
    
  | Fuente   | Descripción                                          | Protocolo        |
  |----------|------------------------------------------------------|------------------|
  | `socket` | Precios y Greeks en tiempo real via SignalR          | WebSocket        |
  | `data`   | Analytics: GEX, IV Rank, Account, posiciones         | REST HTTP GET    |
  | `rules`  | Config de la app y reglas de cada estrategia         | REST HTTP GET (json files)   |

  Consultar definición de endpoints de la api en ../swagger/index.html
  
- Variables de entorno:
  * env local
  PORT=3039
  REACT_APP_API_BASE_URL=http://localhost:7001
  REACT_APP_SIGNALR_HUB_URL=http://localhost:7001/hubs/marketdata

  * env production
  REACT_APP_API_BASE_URL=https://datafeed-g5b4dkfccda5hkdh.chilecentral-01.azurewebsites.net
  REACT_APP_SIGNALR_HUB_URL=https://datafeed-g5b4dkfccda5hkdh.chilecentral-01.azurewebsites.net/hubs/marketdata

- Estructura de archivos:
  src/
  ├── api/
  │   ├── client.ts           # axios instance con X-API-KEY interceptor
  │   ├── rules.ts            # fetchAppConfig() (/App/GaleCore/Rules/Core) + fetchRpfRulesRaw()
  │   ├── strategies.ts       # fetchWorkers(endpoint) / setWorkers(endpoint, enabled) — genéricos por endpoint
  │   ├── analytics.ts        # /App.Analytics/* (GammaExposure, IVRank, ImpliedVolatility)
  │   ├── gex.ts              # /App/Gex/{Rules,Analysis,Workers}
  │   ├── rpf.ts              # /App/Rpf/Workers
  │   ├── marketdata.ts       # /Data/Tastytrade/MarketData/*
  │   └── account.ts          # /Data/Account/*
  ├── socket/
  │   └── useMarketSocket.ts  # Hook SignalR: connect, subscribe/unsubscribe (subscribeLeg usa includeGreeks=true), subscribeFlow/unsubscribeFlow, handlers ReceiveTrade/Quote/Greeks/Flow
  ├── store/
  │   ├── useMarketStore.ts   # Estado en tiempo real (Zustand): precio/bid/ask + Greeks por símbolo (updateGreeks: delta/gamma/theta/vega/iv) + ivRank
  │   ├── useAccountStore.ts  # Balances y posiciones
  │   ├── useAppConfigStore.ts # Config de la app: universe.tickers, strategies[], monitor. Fuente: /App/GaleCore/Rules/Core
  │   ├── useGexStore.ts      # Estrategia GEX: reglas propias (/App/Gex/Rules) + cache de /App/Gex/Analysis por símbolo + vencimiento seleccionado
  │   ├── useRpfStore.ts      # Estrategia RPF: estados por símbolo + sugerencias (SignalR)
  │   └── useFlowStore.ts     # Snapshots de flow de opciones (ReceiveFlow → FlowPayload)
  ├── components/
  │   ├── layout/
  │   │   ├── Sidebar.tsx         # Barra lateral con AccountSummary
  │   │   ├── StatusBar.tsx       # Barra superior: estado sistema, estado mercado, hora
  │   │   └── TabNav.tsx          # Tabs: Main / Monitor / GEX / RPF
  │   ├── common/
  │   │   ├── WorkersSwitch.tsx   # Switch Workers reusable: recibe fetchState/setState, no conoce la estrategia
  │   │   └── ReferencesModal.tsx # Modal de References por estrategia: solapas Definiciones + Json. Transversal: recibe el panel y fetchJson
  │   ├── strategies/             # Tab Main
  │   │   └── StrategyCard.tsx    # Card por estrategia: identidad + WorkersSwitch a su workers_endpoint + "Abrir"
  │   ├── ticker/
  │   │   ├── TickerCard.tsx      # Card por ticker: precio, variación, bid/ask/vol
  │   │   ├── TickerGrid.tsx      # Grid de TickerCards. `symbols` es obligatorio: lo pasa la estrategia dueña de la pantalla
  │   │   └── MarketDiagnostics.tsx # Contexto de mercado (z-score, skew GEX, tendencia, RV) desde structureInputs
  │   ├── chart/
  │   │   ├── GexChart.tsx        # Gráfico LW-Charts: precio + GEX barras + muros + std dev
  │   │   └── GexBarsPanel.tsx    # Panel de barras de gamma por strike
  │   ├── account/
  │   │   └── AccountSummary.tsx  # Net Liq, Buying Power, Cash
  │   ├── positions/
  │   │   └── PositionMonitor.tsx # Tab Monitor: posiciones abiertas de la cuenta (transversal a estrategias)
  │   ├── rpf/                    # Tab RPF
  │   │   ├── RpfStateBadge.tsx    # Badge del estado de la máquina
  │   │   └── RpfSuggestionCard.tsx # Sugerencia de trade con accept/dismiss
  │   ├── gex/                    # Tab GEX
  │   │   ├── OptionsChainList.tsx # Lista de vencimientos (0DTE primero); elegir uno acota Expiry Engine + gráfico
  │   │   ├── ExpiryEngine.tsx     # Strike Engine sin las filas de estructura: ZGL, muros, EM, Net GEX del vencimiento
  │   │   └── GexReference.tsx     # Panel de Definiciones de GEX (solapa del modal References): universo, checks, config del barrido, umbral por símbolo
  │   ├── monitor/                # Tab Monitor (UI en inglés, bloomberg-style)
  │   │   ├── PortfolioRiskBar.tsx # Barra superior: Net Liq / Buying Power / Daily P&L / Portfolio Heat / Positions
  │   │   ├── PositionCard.tsx     # Card por spread: header (strikes/exp/DTE), StrikeLadder, métricas (Credit/P&L/Max), strip de stats (Net Delta/Theta/Vega/Gamma agregados de Greeks live + POP/Prob.+50%/IV Rank), management triggers c/ acción concreta ligada (el más imminente = "NEXT" con la ejecución: cerrar a costo X, rollear a strikes Y/Z por delta de la cadena GEX), legs con entry/valor/variación
  │   │   └── StrikeLadder.tsx     # Barra de zonas MAX LOSS / RISK / PROFIT AT EXP con spot, strikes y muros GEX
  │   ├── validation/
  │   │   └── ValidationLayers.tsx # macroRegime (6 checks) con semáforo. Lo usa la pestaña GEX
  │   └── strategy/
  │       ├── ReferencePrimitives.tsx # Primitivas visuales compartidas por los paneles de References (Card, CollapsibleCard, Stat, TH/TD)
  │       └── StrategyReference.tsx # Panel de Definiciones de RPF (solapa del modal References): reglas, umbrales, protocolo (lee /App/Rpf/Rules). `embedded` le saca el chrome de página
  ├── pages/
  │   ├── Home.tsx            # Tab Main: índice de estrategias implementadas (cards desde strategies[]) + estado de workers
  │   ├── Monitor.tsx         # Tab Monitor: wrapper de PositionMonitor
  │   ├── Rpf.tsx             # Tab RPF: tablero de orquestación (motor→ejes→estados→candidato→sugerencia) por SignalR
  │   └── Gex.tsx             # Tab GEX: universo + Details (checks + diagnóstico, GEX global) +
  │                           #   Graph (Options Chain + Expiry Engine + velas 1h×100 + barras del vencimiento).
  │                           #   Se monta recién al entrar a la pestaña (el barrido es caro).
  ├── types/
  │   ├── api.ts              # AppConfig/StrategyEntry, ValidationLayerApiResponse, StructureInputs, FlowPayload
  │   ├── market.ts           # Tipos de mercado (ticker state, capas, señal)
  │   ├── position.ts         # Tipos de posiciones y P&L
  │   ├── gex.ts              # Tipos de /App/Gex/*
  │   └── rpf.ts              # Tipos de la orquestación RPF
  ├── utils/
  │   ├── formatters.ts       # Formateo de números, fechas, colores semáforo, tint()
  │   ├── validationLayers.ts # mapValidationToLayers: adapta la respuesta al panel de checks
  │   ├── spreadBuilder.ts    # Arma spreads live desde las posiciones de la cuenta
  │   └── streamerSymbol.ts   # Símbolos DXLink y crédito neto actual
  └── App.tsx

- Manejo del tiempo real
  * Conexión SignalR
  ```typescript
  // socket/useMarketSocket.ts
  const connection = new HubConnectionBuilder()
    .withUrl(process.env.REACT_APP_SIGNALR_HUB_URL)
    .withAutomaticReconnect()
    .build();

  // Suscribir al universo de la plataforma (universe.tickers del config de app)
  tickers.forEach(symbol => connection.invoke('Subscribe', symbol, false));

  // Handlers
  connection.on('ReceiveTrade', (symbol, data) => updatePrice(symbol, data));
  connection.on('ReceiveQuote', (symbol, data) => updateQuote(symbol, data));
  ```
  **La conexión NO depende de tener universo.** El hub transporta mucho más que precios de
  subyacentes: la orquestación de RPF (`SubscribeRpf`), los quotes/Greeks de los legs del Monitor y
  el flow. Un `if (!tickers.length) return` antes de conectar dejaba todo eso muerto cuando el config
  no declaraba universo. Se conecta siempre; `Subscribe` es lo único condicional.

  * Estado en Zustand
  ```typescript
  // store/useMarketStore.ts
  interface TickerState {
    symbol: string;
    price: number;
    open: number;
    bid: number;
    ask: number;
    lastUpdate: Date;
  }

  * Fallback REST
  Si el socket no está disponible (offline), obtener precio via
  `/Data/Tastytrade/MarketData/ByType` con polling cada 30 segundos.
  Marcar visualmente los datos como "sin stream" con un indicador en el TickerCard.

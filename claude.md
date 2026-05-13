# GaleCore 

## Resumen del proyecto
Crear una plataforma tecnológica para automatización y análisis de estrategias con opciones financieras.

Tres productos fundamentales a desarrollar para implementar el proyecto: 
  * Estrategias financieras rentables con opciones
  * Backend api
  * Frontend dashboard

## Stack

### Estructura
/docs (archivos de información del proyecto)
/source (carpeta donde se guarda el código fuente del proyecto)
  /galecore-datafeed (carpeta del código backend api)
  /galecore-monitor (carpeta del código frontend monitor)


### Estrategia con opciones
- Resumen de la estrategia
  Estrategia sistemática de venta de prima, consiste en vender volatilidad en entornos estables. 
  La idea es capturar el decay temporal (theta) de opciones sobre índices líquidos usando la estructura de gamma del mercado como soporte.
  Cuando el mercado tiene GEX (gamma exposure) positivo, el precio spot está arriba del Gamma Zero Level, y la volatilidad implícita está en 
  un rango medio sin expandirse, las opciones OTM pierden valor predeciblemente. El algoritmo vende esa prima con riesgo definido y reglas mecánicas de gestión.
  
  Inicialmente se procederá sobre estos índices del mercado que tienen líquidez:
  * SPY — S&P 500 ETF
  * QQQ — Nasdaq 100 ETF
  * IWM — Russell 500 ETF

  Tres estructuras permitidas, todas de crédito con riesgo definido:
  * Iron Condor — estructura por defecto, vende prima por arriba y por abajo
  * Put Credit Spread — solo vende prima por abajo (cuando la asimetría de muros favorece ese lado)
  * Call Credit Spread — solo vende prima por arriba (idem inverso)
  Observación: Prohibido terminantemente: naked shorts de cualquier tipo, ratio spreads, y cualquier posición long direccional.

  Operación de la estrategia: 
  La señal pasa por 4 capas de validación en cascada. Si cualquier capa falla, no se abre nada. La cascada es cortocircuitante, si la Capa 1 falla, las demás ni se evalúan.
  Definición de capas: 
  * Capa 1 — Régimen macro y GEX
  * Capa 2 — Motor de strikes
  * Capa 3 — Microestructura
  * Capa 4 — Sizing y riesgo

  Configuración:
  La estrategia se configura con 3 archivos JSON que estarán disponibles en la api y serán procesados por la operación de la estrategia:
  * `rules.core.json` — reglas base, parámetros completos
  * `rules.live.json` — overlay conservador para trading real
  * `rules.paper.json` — overlay para paper trading con más observabilidad


### Backend DataFeed

- Resumen del proyecto
  Solución .NET Core Web API API DataFeed (ASP.NET Core/.NET 8) que provee acceso a datos del mercado y cuenta de trading vía Tastytrade/DXLink.
  
- Arquitectura
  This is a .NET 8 ASP.NET Core Web API that serves as a **financial market data feed**, 
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

- Origen de datos
  El principal origen de datos actualmente es la api de Tastytrade, cuya documentación esta disponible en https://developer.tastytrade.com/

  The API runs on local http://localhost:7001 (IIS Express) and opens Swagger UI at /swagger.
  The API runs on production: https://datafeed-g5b4dkfccda5hkdh.chilecentral-01.azurewebsites.net/swagger/index.html

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

- Resumen del proyecto:
  Dashboard de trading en **React + TypeScript + Create React App** para el sistema GaleCore.
  Es un monitor de decisión de operaciones: muestra el estado del sistema, el análisis
  de los tickers configurados y el seguimiento de posiciones abiertas

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
  | `rules`  | Reglas y tickers de la estrategia GaleCore           | REST HTTP GET (json files)   |

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
  │   ├── rules.ts            # /App/GaleCore/Rules/*
  │   ├── analytics.ts        # /App.Analytics/*
  │   ├── marketdata.ts       # /Data/Tastytrade/MarketData/*
  │   └── account.ts          # /Data/Account/*
  ├── socket/
  │   └── useMarketSocket.ts  # Hook SignalR: connect, subscribe, disconnect
  ├── store/
  │   ├── useMarketStore.ts   # Estado de precios y Greeks en tiempo real (Zustand)
  │   ├── useAccountStore.ts  # Balances y posiciones
  │   └── useRulesStore.ts    # Rules/tickers cargados desde /App/GaleCore/Rules/Core
  ├── components/
  │   ├── layout/
  │   │   ├── StatusBar.tsx       # Barra superior: estado sistema, estado mercado, hora
  │   │   └── TabNav.tsx          # Tabs: Inicio / Posiciones / Estrategia
  │   ├── ticker/
  │   │   ├── TickerCard.tsx      # Card por ticker: precio, variación, capas de validación
  │   │   ├── TickerGrid.tsx      # Grid de TickerCards
  │   │   └── TickerDetail.tsx    # Panel expandible con gráfico combinado
  │   ├── chart/
  │   │   └── GexChart.tsx        # Gráfico LW-Charts: precio + GEX barras + muros + std dev
  │   ├── account/
  │   │   └── AccountSummary.tsx  # Net Liq, Buying Power, Cash
  │   ├── positions/
  │   │   ├── PositionMonitor.tsx # Tab Posiciones: tabla de posiciones abiertas
  │   │   ├── PositionRow.tsx     # Fila individual con P&L, Greeks, alertas
  │   │   └── NewPositionForm.tsx # Formulario de ingreso de posición manual
  │   ├── validation/
  │   │   └── ValidationLayers.tsx # Las 4 capas con semáforo + valores numéricos
  │   └── strategy/
  │       └── StrategyReference.tsx # Tab Estrategia: reglas, umbrales, protocolo de ajuste
  ├── pages/
  │   ├── Home.tsx            # Tab Inicio
  │   ├── Positions.tsx       # Tab Posiciones
  │   └── Strategy.tsx        # Tab Estrategia
  ├── types/
  │   ├── api.ts              # Tipos de respuesta de la API
  │   ├── market.ts           # Tipos de mercado (ticker state, capas, señal)
  │   └── position.ts         # Tipos de posiciones y P&L
  ├── utils/
  │   └── formatters.ts       # Formateo de números, fechas, colores semáforo
  └── App.tsx

- Manejo del tiempo real
  * Conexión SignalR
  ```typescript
  // socket/useMarketSocket.ts
  const connection = new HubConnectionBuilder()
    .withUrl(process.env.REACT_APP_SIGNALR_HUB_URL)
    .withAutomaticReconnect()
    .build();

  // Suscribir a tickers del rules.json al conectar
  tickers.forEach(symbol => connection.invoke('Subscribe', symbol, false));

  // Handlers
  connection.on('ReceiveTrade', (symbol, data) => updatePrice(symbol, data));
  connection.on('ReceiveQuote', (symbol, data) => updateQuote(symbol, data));

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

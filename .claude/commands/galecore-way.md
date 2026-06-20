---
description: >
  Forma de trabajo de GaleCore. Activar SIEMPRE al inicio de cualquier tarea de desarrollo,
  al planificar cambios, al crear PRs, o cuando se discuta arquitectura, deploys o flujo de datos.
  Define las reglas de trabajo que aplican a toda la plataforma: JSON-first, API-first,
  frontend como renderer puro, consistencia contrato-backend-frontend.
---

# GaleCore Way — Forma de Trabajo

## Principio rector

> **El JSON manda.** `rules.json` es el contrato unico que gobierna la estrategia. El backend lo
> *ejecuta*, el frontend lo *renderiza*, el algoritmo automatico lo *obedece*. Ningun umbral,
> formula o comportamiento puede existir en codigo que no este declarado en el JSON.

---

## Flujo de cambios: JSON -> Backend -> Frontend

Todo cambio de logica, parametro o regla de negocio sigue este orden estricto:

1. **Primero el JSON** — editar `galecore_rules_core.json` (y overlays `live`/`paper` si aplica)
2. **Luego el backend** — ajustar handlers/endpoints de DataFeed API para reflejar el JSON
3. **Por ultimo el frontend** — el Monitor renderiza lo que la API expone

**Nunca al reves.** Si el backend necesita una decision que el JSON no especifica, es un gap del
JSON que se resuelve editando el JSON. Si el frontend necesita un dato que el backend no expone,
se agrega al endpoint — nunca se recalcula en el cliente.

---

## Reglas de consistencia

### El JSON y la API deben ser consistentes

Cada nodo operativo del JSON debe tener su representacion fiel en los endpoints de la API.
El frontend reproduce lo que la API le da. Las tres capas deben contar la misma historia:

| Capa | Rol | Prohibido |
|---|---|---|
| **JSON** | Define reglas, umbrales, formulas, checks | Nodos decorativos (parametros que no rigen) |
| **Backend API** | Ejecuta el JSON, expone resultados | Logica de negocio hardcodeada fuera del JSON |
| **Frontend** | Renderiza lo que la API devuelve | Calcular reglas, umbrales o formulas propias |

### Una sola fuente de verdad por concepto

Si un valor aparece dos veces, una de las dos es un bug esperando a divergir.
Usar `{ "ref": "definitions.X" }` para referenciar, nunca duplicar literales.

### Checks no implementables no pueden estar armados

Si la metrica que un check necesita no existe en DataFeed, el check va con `enabled: false`
(se renderiza en gris en el frontend) o a `feedback/`. Nunca activo apuntando a un dato fantasma.

---

## Arquitectura del stack

### Estrategia (JSON)

Archivos en `source/galecore-datafeed/DataFeed.Api/Files/`:
- `galecore_rules_core.json` — reglas base, parametros completos
- `galecore_rules_live.json` — overlay conservador para trading real
- `galecore_rules_paper.json` — overlay para paper trading

Endpoint: `GET /App/GaleCore/Rules/{Core|Live|Paper}`

### Backend — DataFeed API

- .NET 8 ASP.NET Core Web API
- Arquitectura Clean Architecture de 3 capas: Api / Application / Infrastructure
- Patron MediatR CQRS (Request -> Handler -> Response)
- Proveedores: Tastytrade REST + DXLink WebSocket + FRED
- Real-time: SignalR hub en `/hubs/marketdata`
- Local: `http://localhost:7001` | Produccion: Azure App Service
- Deploy: push a master -> Azure DevOps pipeline (o manual via Azure Portal)

### Frontend — Monitor

- React 18 + TypeScript + Create React App
- Tailwind CSS (dark theme, bloomberg-style)
- Zustand para estado global
- SignalR para datos en tiempo real
- axios con interceptor X-API-KEY
- Local: `http://localhost:3039` | Produccion: Vercel
- Deploy: push a master -> Vercel auto-deploy

---

## Reglas de desarrollo

### Commits y PRs

- Commitear en rama local, esperar confirmacion antes de pushear y crear PR
- No pushear directamente a master
- Formato de commit: `tipo(scope): descripcion` (feat, fix, refactor, chore, docs, perf)
- PRs con descripcion del cambio y su impacto en el contrato JSON

### Al hacer cambios de estrategia

1. Actualizar `_meta.version` y `_meta.notes` del JSON con versionado semantico
2. Documentar `breaking_changes` si el cambio rompe compatibilidad
3. Verificar que los checks nuevos referencien datos disponibles en `data_availability`
4. Si hay datos nuevos necesarios, ir a `feedback/` antes de armar el check

### Al desarrollar backend

- Todo endpoint nuevo debe estar motivado por un nodo del JSON
- Los handlers interpretan el JSON, no implementan logica paralela
- Los datos que el frontend necesita salen del backend, no se calculan en el front
- Validar contra `data_quality` del JSON (freshness, crossed markets, missing data)

### Al desarrollar frontend

- El frontend lee `display_config` del JSON para saber que renderizar
- Los colores de semaforo vienen del JSON (`signal_labels`)
- Las columnas del Portfolio Manager vienen de `portfolio_manager_table`
- Nunca hardcodear umbrales: si necesitas un numero, viene de la API

---

## Carpeta feedback/

Backlog de variables que el motor de reglas necesita pero DataFeed no provee hoy.
Cada item especifica: que es, para que se usa, que nodo del JSON lo consume, fuente
de datos candidata, y criterio de aceptacion. Prohibido el item de una linea.

Prioridades: P0 (bloquea operacion real), P1 (grupo de variables ausente), P2 (mejora incremental).

---

## Herramientas

| Herramienta | Uso |
|---|---|
| Visual Studio 2022 | Backend .NET |
| VS Code + Claude Code | Frontend React + todo lo demas |
| Swagger UI | Explorar y testear endpoints de la API |
| Git + GitHub | Versionado, PRs, issues |
| Azure App Service | Deploy backend produccion |
| Vercel | Deploy frontend produccion |
| Tastytrade API | Datos de mercado, cuenta, opciones |
| FRED API | Datos macroeconomicos (ya integrado en Infrastructure) |

---

## Estrategias

GaleCore soporta multiples estrategias, cada una con su JSON de reglas y su skill.
Actualmente hay 1 estrategia activa:

- **Stable Returns** (`/stable-returns-strategist`) — venta de prima sistematica sobre
  indices liquidos. JSON: `galecore_rules_core.json` v2.1.1.

La arquitectura esta preparada para sumar mas estrategias con el mismo patron:
JSON de reglas -> endpoints en DataFeed -> vista en Monitor.

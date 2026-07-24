# GaleCore — Sistema de trabajo (2 personas, poco tiempo, IA-first)

Cómo trabajamos para llegar a **paper corriendo y midiendo** sin vivir mirando el mercado.
Documento vivo. Somos 2, con 8 hs de laburo ajeno: todo lo que se pueda delegar a IA/automatización, se delega.

---

## 1. Fuentes de verdad (una por tema, sin duplicar)

| Tema | Fuente | Regla |
|---|---|---|
| Arquitectura (backend/front/endpoints) | `CLAUDE.md` | Se actualiza ante cada cambio de arquitectura/endpoint/componente. |
| **Operativa** de la estrategia | `.../Files/galecore_rules_core.json` (+ overlays) | **JSON primero**, luego código, luego docs. Nunca al revés. |
| Racional (*por qué* de cada parámetro) | `docs/galecore-rules-reference.md` | Acompaña al JSON. |
| Validaciones empíricas | `docs/galecore-research-backtesting.md` | Bitácora del backtesting. |
| Skills de IA | `.claude/commands/*.md` | Guías de activación, **no** copias de la estrategia (eso genera drift). |

Todo lo superado → `docs/archive/` con cabecera "superado". Índice en `docs/README.md`.

## 2. Flujo de git (nada de 13 ramas otra vez)

- Trunk **`master`**. Ramas `feat/*` / `chore/*` de **vida corta**.
- **Nunca push directo a master.** Commit local → confirmación del operador → push + **PR**.
- PR mergeado → borrar la rama (local y remota). Revisión semanal de ramas huérfanas.
- Trabajar **siempre desde `GaleCore/GaleCore/`** (git vive ahí, no en la raíz).

## 3. Harness (3 capas)

1. **Research/backtest** ✅ — `research/backtesting/` con specs pre-declaradas + datasets versionados.
   Es nuestro mejor activo de disciplina; todo cambio de estrategia se valida acá antes de tocar el JSON.
2. **Backend** ⏳ — pendiente: (a) test que valide los 3 JSON (parseo + cero overrides huérfanos del
   DeepMerge), (b) smoke-test de los endpoints GaleCore, (c) CI de GitHub Actions que compile + corra
   esos tests en cada PR.
3. **Operativo (humano)** ⏳ — el ritual diario de paper (§5), asistido por el agente pre-market (§4).

## 4. Agentes de IA (lo que reemplaza mirar el mercado)

Herramientas disponibles: Claude Code (`/schedule`, `/loop`, agentes), connectors MCP
(AlphaVantage con `HISTORICAL_OPTIONS`, IoL, Gmail, Drive).

### 4.1 Agente pre-market (DISEÑO — sin activar hasta v1.4.0 en backend)

- **Qué hace:** cada día hábil ~1h antes de la apertura, corre `GET /App/GaleCore/ValidationLayer`
  sobre SPY y QQQ contra el DataFeed productivo.
- **Salida:** un resumen accionable — "HAY señal PCS en SPY: vender put $X / comprar put $Y, crédito
  $Z, delta W, edge E" o "SIN señal (murió en gate: VRP)". Lo manda por **Gmail** (MCP) o lo deja en Drive.
- **Cómo montarlo:** `/schedule` (routine cron) con un prompt fijo que: (1) hace el GET, (2) formatea
  el veredicto del embudo, (3) envía el mail. Cron sugerido: L-V 09:00 ART (~pre-open NY).
- **Por qué "sin activar":** hoy el backend sirve v1.3.1 y los handlers no leen `signal_gates`.
  Activar recién cuando el PR de handlers v1.4.0 esté mergeado y verificado en Swagger.
- **Guardarraíl:** el agente **informa**, no opera. La ejecución (aunque sea en paper) es humana.

### 4.2 AlphaVantage para históricos de opciones

`HISTORICAL_OPTIONS` (MCP ya conectado) ataca el dolor de "datos históricos de opciones gratis son
escasos/rotos". Útil para validar el dataset propio (ver `reference_spy_options_dataset_quirks`) y
para futuros ciclos de research.

### 4.3 Memoria de Claude

Convenciones, decisiones y feedback persisten en la memoria del proyecto. Convertir decisiones
no-obvias en memorias; no duplicar lo que ya está en git/código.

## 5. Cadencia

- **Diario (5 min):** leer el mail del agente pre-market → si hay señal, ejecutarla en paper y
  registrar. El sistema decide; el humano ejecuta.
- **Semanal (30 min):** revisar PRs abiertos, comparar resultados de paper vs backtest, podar ramas,
  actualizar `CLAUDE.md` si hubo cambios de arquitectura.
- **Por ciclo de estrategia:** todo cambio de lógica pasa por research → JSON → backend → front → skill.

## 6. Objetivo y realidad

Meta inmediata: **paper corriendo y midiendo bien**. La cifra de $/mes se define al capitalizar
(config C ≈ 6,4%/año; $200/mes ≈ ~$32k). No se baja ningún gate para "forzar" retorno — eso es la
palanca más cargada de cola.

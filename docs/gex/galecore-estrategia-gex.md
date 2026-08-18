# GEX — Gamma Exposure (estrategia informativa)

> **Definición canónica.** Escrita el 2026-08-07 consolidando lo que hasta entonces vivía únicamente
> dentro de `CLAUDE.md`. La **fuente de verdad operativa** es
> [`galecore_rules_gex.json`](../../source/galecore-datafeed/DataFeed.Api/Files/Gex/galecore_rules_gex.json);
> este documento explica qué declara y por qué. Ante discrepancia, manda el JSON.

| | |
|---|---|
| **Prefijo** | `Gex` |
| **Tipo** | Informativa |
| **Nombre** | Gamma Exposure |
| **JSON de reglas** | `DataFeed.Api/Files/Gex/galecore_rules_gex.json` (`_meta.strategy: gex_gamma_exposure`) |
| **Endpoints** | `GET /App/Gex/Rules`, `GET /App/Gex/Analysis?Symbol=`, `GET|POST /App/Gex/Workers` |
| **Pestaña** | `gex` |
| **Universo** | SPY, QQQ, AAPL, SKM (`universe.mode: whitelist`) |

---

## 1. Qué es (en una línea)

Estrategia **sin trades**: su único producto es información de gamma exposure para que el operador
decida. No propone estructura, no calcula strikes ni sizing, no emite señales.

`strategy_scope.allowed_strategies` está **vacío** a propósito y
`structure_selection_method: "disabled_informational_only"`. Las 6 estructuras prohibidas de la
plataforma (`iron_condor`, `call_credit_spread`, `put_credit_spread`, `naked_short`, `ratio_spread`,
`long_directional`) figuran igual en `forbidden_strategies` — para GEX es redundante, pero mantiene el
contrato uniforme entre estrategias.

**Consecuencia de diseño:** ningún check de GEX gatea nada. `macro_regime.on_fail` es `inform_only`.
Un check en rojo es una lectura del mercado, no un bloqueo.

## 2. El GEX de GEX es global

Es la diferencia que más confusión genera y por eso va primero.

| | `/App/Gex/Analysis` (esta estrategia) | `/App.Analytics/GammaExposure` |
|---|---|---|
| Vencimientos | **Todos** los de la cadena dentro de `gex.max_dte` (60), incluido 0DTE y weeklies | **Uno solo** |
| Quién lo usa | Pestaña GEX | Monitor, `PutSkew`, RPF, `SkewSnapshotService` |

**Son números distintos a propósito y no se comparan.** El global es mayor en magnitud que el de un
vencimiento — por eso el umbral por símbolo de GEX (§5) no es el mismo que el de RPF.

La respuesta de `/App/Gex/Analysis` trae:
- `gex.global` — el agregado.
- `gex.byExpiry[]` — desglose por vencimiento, cada uno con su propio ZGL, muros, IV ATM y expected move.
- Contexto de mercado: `macroRegime` + `structureInputs`.

**Modo global de `GammaExposureHandler`** — es opt-in vía `AllExpirations` / `IncludeByExpiry` /
`ExpirationTypes` / `IncludeZeroDte` / `GreeksBatchSize` en `GammaExposureRequest`. Con los defaults el
handler se comporta igual que siempre, así que los consumidores del GEX de un vencimiento no cambian.
En el agregado, **GEX y OI se suman** por strike; delta/gamma/IV se toman de la expiración más
cercana — sumarlos no significaría nada.

## 3. Capa 1 compartida (`macro_regime`)

`GexAnalysisHandler` llama a `CascadeUtils.EvaluateLayer1` (en `App/Shared/`) pasándole **su** JSON.
Es la misma función que usa RPF como gate; acá es lectura. Por eso el JSON de GEX espeja los nodos que
esa función lee: `macro_regime.checks`, `definitions.gex_threshold_by_symbol` y
`definitions.zgl_with_buffer`.

Los 6 checks: `vix_absolute`, `vix_term_structure`, `iv_rank`, `iv_momentum`, `gex_total`, `spot_vs_zgl`.

`definitions` quedó reducido a los **dos** nodos que el código efectivamente lee. Las definiciones de
fórmulas que nadie consumía se sacaron.

**Estos 6 no son un bloque en la pantalla, y desde el 2026-08-18 tampoco se muestran juntos.** Que
vengan de la misma llamada es un hecho del backend, no una forma de leerlos: el cuadro Details los
reparte por la pregunta que contesta cada uno, mezclados con los 4 factores de `structureInputs` —
`vix_absolute` y `vix_term_structure` a la franja **Mercado** (no dependen del símbolo: son índices
CBOE que el handler pide como símbolos fijos, así que valen lo mismo en SPY, QQQ o AAPL),
`iv_rank` e `iv_momentum` a **Volatilidad** junto a la RV realizada, y `gex_total` con `spot_vs_zgl`
a **Estructura gamma** junto al skew de muros. Los grupos los declara
`display_config.gex_tab.details_panel.groups`.

Y **no llevan semáforo**: son `on_fail: inform_only`, así que nada de esto aprueba ni reprueba. El
✓/✗ verde-rojo que el panel había heredado de la cascada de RPF hacía que un `gex_total` de −$921B —lo
normal en SPY con el agregado de toda la cadena— se leyera como una avería.

## 4. Latencia y cache

Medido **2026-08-05** con la cadena completa de SPY a 50 DTE (17 vencimientos, ~6200 símbolos):

| Escenario | Tiempo |
|---|---|
| SPY, cache diario de OI caliente | 121s |
| QQQ, cache diario de OI caliente | 146s |
| Primer barrido tras reiniciar la API (paga el OI de toda la cadena) | 399s |
| Universo entero, mercado abierto (2026-08-06): SPY 197s + QQQ 135s + AAPL 50s + SKM 1s | ≈ **383s** |

Como los barridos **se serializan** (§6), lo que dimensiona el cache no es un símbolo sino recorrer el
universo entero. Por eso `gex.cache_seconds` y `display_config.gex_tab.refresh_seconds` quedaron en
**600** y no en 300.

**Palancas, todas en el JSON (sin recompilar):** `gex.max_dte`, `gex.oi_delta_band` (hoy
`[0.005, 0.995]` — la pata que queda afuera no tiene OI y aporta GEX 0), `gex.greeks_batch_size`
(1000), `gex.greeks_retries` (2), `gex.cache_seconds`.

El OI reusa el cache diario por símbolo del handler, **compartido** con el GEX de vencimiento único que
pide el Monitor.

**Los Greeks se reintentan** (`gex.greeks_retries`). `RequestSnapshotAsync` devuelve lo que juntó al
vencer su timeout, así que un lote lento deja símbolos sin Greeks y esos strikes **se caen del GEX en
silencio**. Sin reintentos, dos corridas seguidas dieron 271B con 12 vencimientos y 696B con 16 (faltaba
el 0DTE). Cada vuelta pide sólo los que faltan.

### Reglas del cache

1. **Editar el JSON lo invalida.** La entrada guarda el hash del `galecore_rules_gex.json` con el que se
   calculó, porque la respuesta lleva el `macroRegime` **ya evaluado**: sin eso, cambiar un umbral no se
   veía hasta `cache_seconds` después, aunque el endpoint relea el archivo en cada request. Se compara
   por **contenido** y no por fecha del archivo, así guardar sin cambios no tira a la basura un barrido
   de varios minutos.
2. **Un barrido incompleto no se cachea** (`gex.cache_min_coverage_pct` = 99, y tampoco si el cliente
   abortó). Guardarlo dejaría el tablero mostrando un GEX sin vencimientos enteros durante
   `cache_seconds`, y un GEX más chico se lee como caída del gamma, no como dato faltante.
3. **Invariantes:** `cache_seconds` > duración de un barrido, y `refresh_seconds` del front
   ≥ `cache_seconds`. Congelado por `DataFeed.Tests/GexRulesJsonTests.cs`.

## 5. El umbral de GEX decide qué símbolos se evalúan

`definitions.gex_threshold_by_symbol.values` declara un umbral por símbolo — hoy `SPY: 200`,
`QQQ: 50` (en billions USD). **El símbolo que no figura no se valida:** `EvaluateLayer1` devuelve
`gexTotal.thresholdDeclared: false` y el tablero pinta esa celda en **gris con "sin umbral"**, en vez de
rojo.

Sumar un símbolo a `universe.tickers` **no alcanza** para que su check de GEX signifique algo — hay que
declararle el umbral. Hoy AAPL y SKM están en el universo sin umbral declarado.

## 6. Barridos serializados

`GexAnalysisHandler` tiene un **semáforo global**: un barrido a la vez. Todos comparten la conexión
DXLink y dos concurrentes se pisan — medido: SPY y QQQ solapados bajaron a **60.8%** y **69.2%** de
cobertura, contra 100% de a uno. El segundo pedido espera; al entrar re-chequea el cache por si el
barrido anterior era de su mismo símbolo.

## 7. Switch "Workers"

GEX no corre `BackgroundService`, pero sí tiene algo que anda solo y compite por el feed: **el barrido
de la cadena** (auto-refresh del front). El switch es un **kill switch** de eso.

- `GET /App/Gex/Workers` → `{ enabled, source }`; `POST /App/Gex/Workers` con `{ enabled }`.
- Estado en `Files/Gex/gex_workers_state.json` — override del operador, **persiste a restart**,
  gitignoreado. Si no existe, manda `gex.enabled` del JSON de reglas. Dueño: `GexWorkerSwitch`
  (singleton).
- **En OFF `/App/Gex/Analysis` no barre ni toca DXLink**: devuelve lo último cacheado con
  `workersEnabled: false` y `frozen: true`, **ignorando el TTL** — nadie lo va a refrescar y tirarlo
  dejaría la pantalla vacía sin ganar nada. El front corta el auto-refresh, deshabilita Reload y marca
  **DETENIDO · DATO CONGELADO** con la hora del último barrido.

## 8. Contrato de render (`display_config.gex_tab`)

El frontend renderiza lo que este nodo declara. `refresh_seconds` 600, `default_expiry: "nearest"`, y
bloques: `candles`, `details_panel`, `options_chain`, `expiry_engine`.

`hidden_blocks` esconde lo que **no aplica a una estrategia informativa**: `setup_candidato`,
`portfolio_manager`, `microstructure`, `strike_engine_structure_rows`.

La pestaña se monta **recién al entrar** (el barrido es caro).

### El cuadro Graph tiene dos scopes

La lista Options Chain elige **un vencimiento** o **toda la cadena**. La fila `GLOBAL`
(`options_chain.global_row`) va fija arriba de la lista y lleva el gráfico y el Expiry Engine a
`gex.global` — el mismo agregado que ya muestra el cuadro Details. Es **elección explícita**:
`default_expiry` sigue en `"nearest"`, así que la pestaña arranca en el vencimiento más cercano
(en día hábil, el 0DTE).

Qué cambia en scope global, declarado en `expiry_engine.global_rows`:

| Fila | Global | Por qué |
|---|---|---|
| Net GEX, ZGL, Call Wall, Put Wall | del agregado | el backend ya los calcula sobre los strikes agregados |
| Vencimiento / DTE | `Cadena completa` / `≤ max_dte` | el agregado no tiene ninguno de los dos |
| Vencimientos | `incluidos [/ pedidos]` | deja a la vista un barrido corto |
| Expected Move | vacío | `spot × IV ATM × √t` necesita **un** `t`, y el agregado no lo tiene |

Por lo mismo, en global el gráfico **no dibuja las bandas ±1σ/±2σ**: salen de la IV ATM del
vencimiento, que en el agregado no existe. Ni el EM ni las bandas se rellenan con las del
vencimiento más cercano — sería un número de otro scope leído como si fuera de éste, la misma
trampa que un dato viejo que sobrevive a un error.

**Efecto esperado:** el eje de precio se autoescala a `[putWall × 0.985, callWall × 1.015]`, y los
muros globales están más separados que los de un vencimiento. En global el gráfico se abre y las
velas se achatan. Es la vista correcta del scope, no un bug.

## 9. Código relevante

| Archivo | Rol |
|---|---|
| `DataFeed.Application/App/Gex/GexAnalysisHandler.cs` | Barrido, semáforo, cache con hash, `EvaluateLayer1` |
| `DataFeed.Application/App/GammaExposure/GammaExposureHandler.cs` | Cálculo de GEX por strike; modo global opt-in |
| `DataFeed.Application/App/Shared/CascadeUtils.cs` | `EvaluateLayer1` compartida con RPF |
| `DataFeed.Api/Infrastructure/GexWorkerSwitch.cs` | Estado del kill switch |
| `DataFeed.Tests/GexRulesJsonTests.cs` | Congela los invariantes del JSON |
| `galecore-monitor/src/pages/Gex.tsx` | Pestaña |

## 10. Documentos relacionados

- [`gex_endpoint.md`](gex_endpoint.md) — referencia del endpoint `/App.Analytics/GammaExposure`
  (GEX de **un solo** vencimiento): fórmula, ZGL, muros, arquitectura interna. Es el motor de cálculo
  sobre el que se apoya esta estrategia, no la estrategia.
- [`../../CLAUDE.md`](../../CLAUDE.md) — contrato de arquitectura de la plataforma.

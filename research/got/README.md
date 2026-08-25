# Research / GOT — diseño y validación de la estrategia

GOT (GaleCore Options Trading) es una estrategia de **venta de prima con riesgo definido**,
alerts-only, que decide dónde vender por estructura de gamma (walls, ZGL, Expected Move) y valida
la compensación con un crédito requerido dinámico en vez de un mínimo fijo.

**Todavía no está implementada en la plataforma**: no tiene prefijo en `strategies[]` de
`galecore_rules_core.json`, ni JSON de reglas, ni endpoints, ni pestaña. Por eso vive acá y no en
`docs/`. Cuando se implemente, [`galecore-estrategia-got.md`](galecore-estrategia-got.md) se muda
tal cual a `docs/got/` y se sigue el checklist de "Estrategias — convención" del `CLAUDE.md`.

## Alcance del trabajo — el modo estudio se agotó (2026-08-25)

> **Corregido el 2026-08-25.** Este nodo decía que **el backtest no estaba en el camino crítico** y
> que la validación transversal sobre capturas puntuales era lo que servía. Fue cierto y rindió: en
> dos días esas capturas mataron `MaxRisk` en dólares, `RequiredCredit` como gate económico, `WD`
> como variable propia, el muro como argmax y `d_min × EM` como condición estructural. **Y ahí se
> agotó.** El [hallazgo del 2026-08-25](hallazgos/2026-08-25-el-muro-como-banda.md) muestra por qué
> no es una cuestión de correr más capturas: toda la información de estructura que hay en una foto
> —distancia, Expected Move, ZGL, crédito— resultó ser **el delta medido de cuatro formas
> distintas**, y los precios de la foto no saben del muro. El backtest dejó de estar fuera del
> camino crítico para pasar a ser **el único camino**.

**Las definiciones están cerradas.** La Sell Zone quedó definida en la
[§61](galecore-estrategia-got.md), con su procedimiento paso a paso en la §61.7, un ejemplo
trabajado sobre SPY 16-Oct, y la tabla de lo descartado en la §61.8. El corte entre definido,
validado, descartado y pendiente está en la §98.

**Queda una sola pregunta abierta, y bloquea a todas las demás** (§61.9):

> La probabilidad empírica de que el precio cruce el borde externo de una banda de gamma dominante
> es menor que el delta de ese borde.

Necesita del orden de **300 observaciones independientes** —un camino de precio por par (símbolo,
vencimiento), no un strike—. Con el universo de la §4 son unos 48 al año: **seis años**. Por eso lo
que hay que decidir ahora no es técnico sino de alcance: **ensanchar el universo a ~20 símbolos
líquidos, comprar historia de cadenas con open interest, o aceptar el negativo y plegar GOT al edge
test de RPF**. Calibrar `buffer`, `delta_max`, el ancho de banda o los umbrales de dominancia antes
de esa decisión es afinar números que no significan nada si la hipótesis es falsa.

Lo que **sí** sigue pudiendo contestar una captura transversal, y por eso la maquinaria se conserva:
si un filtro es vacuo o binding, si dos filtros son redundantes, si un parámetro se comporta
distinto por símbolo/lado/DTE, y con qué frecuencia pasa algo. Lo que **no** puede contestar es si
algo predice — y esa es la única que queda.

### La pregunta de plataforma, abierta

GaleCore ya tiene **GEX como estrategia informativa**, y su definición dice explícitamente que *no
propone estructura, no calcula strikes ni sizing, no emite señales*. GOT produciendo candidatos
concretos cruza esa línea, así que puede ser tres cosas distintas — y **cuál sea cambia las
definiciones**:

1. **Una extensión de GEX**, que dejaría de ser puramente informativa.
2. **Una tercera estrategia**, con su prefijo, JSON, pestaña y switch.
3. **Un motor que alimenta a RPF**, que ya es venta de prima de riesgo definido, alerts-only, sobre
   los mismos GEX/ZGL/walls y con push por socket.

**Actualizado el 2026-08-25:** la definición canónica de la Sell Zone ya está escrita (§61), así
que la condición que este nodo ponía se cumplió sin que la pregunta se resolviera — y la evidencia
del 25 la inclinó. Las tres siguen sobre la mesa, pero **la 3 dejó de ser una alternativa entre
iguales: es el resultado por defecto.** Si la hipótesis de la §61.9 no se mide, lo que queda de GOT
es un corte de delta más el edge test que RPF ya tiene planteado, y no hay nada que justifique un
prefijo, un JSON y una pestaña propios.

La 1 tiene además un costo que antes no estaba anotado: poner una Sell Zone en la pantalla de GEX
**cambia lo que GEX es**. Su definición dice hoy, textual, que no propone estructura ni calcula
strikes; una banda dibujada sobre el chart se lee como recomendación aunque el texto diga que no.
Se puede hacer, pero reescribiendo esa definición a propósito y no de arrastre.

Estado al 2026-08-25: **Sell Zone definida (§61), con una sola hipótesis abierta y bloqueante
(§61.9)**. El corte entre lo definido, lo validado, lo descartado y lo pendiente está en la §98.

El **flujo del proceso** —uno de los tres ejes— se redibujó el 2026-08-24 en la sección 47: seis
niveles en vez de cuatro filtros en serie, la ventana de delta como una sola variable con dos cotas
y el edge test dibujado como el gate económico que falta, con una marca por bloque que dice si está
definido, provisional, sin implementar o reprobado. Las secciones 48, 84 y 88 dibujaban el mismo
flujo desde otro ángulo y quedaron con errata apuntando ahí.

## Qué hay acá

| Ruta | Qué es |
|---|---|
| [`galecore-estrategia-got.md`](galecore-estrategia-got.md) | **La definición. Documento vivo** — es el único archivo que se edita |
| [`versiones/`](versiones/) | La cadena v1–v4, congelada. Historia del diseño, no se toca |
| [`hallazgos/`](hallazgos/) | Verificaciones fechadas, append-only |
| [`data/`](data/) | Los datasets sobre los que se validó |
| [`scripts/`](scripts/) | Lo que reproduce cada hallazgo |

### Hallazgos

| Fecha | Qué verifica | Veredicto | Estado |
|---|---|---|---|
| [2026-08-24](hallazgos/2026-08-24-credito-call-columna-equivocada.md) | Las tablas de CALL de las §24–28 (Delta Sweep TSLA) | Las §25 y §27 leyeron `pcsCredit_w5` en vez de `ccsCredit_w5`. El Hallazgo 3 se **invierte** | Aplicado — reescritas las §25, §27, §28, §39, §53, §54, §83, §98 y agregada la §43.1 |
| [2026-08-24](hallazgos/2026-08-24-sesgo-por-lado-spy-qqq.md) | La predicción de la §43.4: el sesgo put-only, ¿es del modelo o de TSLA? | Es de TSLA, y **se invierte**: sobre SPY y QQQ el filtro sesga a CALL (1.8x / 1.6x) | Aplicado — reescritas la §43.4 y la §43.5 |
| [2026-08-24](hallazgos/2026-08-24-el-4-sep-es-un-weekly.md) | Los vencimientos capturados contra el alcance del bucle recién definido en la §47.1 | El `2026-09-04` es un **weekly**: todo lo que el v5 concluyó sobre DTE corto está medido sobre un contrato que el flujo no recorre | Aplicado — anotado en la §47.1, en el pendiente de la §98 y en `data/README.md`; y `gex-strikes.ps1` ahora registra el tipo (columna `expirationType` + aviso al capturar) |
| [2026-08-25](hallazgos/2026-08-25-el-sesgo-aguanta-con-book-vivo.md) | El pendiente de la §43.4: el sesgo por lado, ¿es real o es un artefacto de haber cotizado post-cierre? | Es **real** — con book vivo y más ajustado los seis cocientes conservan signo y escala. Trae dos cosas que no se buscaban: un piso de ruido día a día de hasta 0.15, y que `-QuoteBandPct 12` **trunca la cadena** en símbolos de IV alta | Aplicado — la §43.4 lleva la confirmación y la §98 movió el pendiente a validado, con dos pendientes nuevos; `gex-strikes.ps1` avisa cuando la banda no llega al delta 0.10 y `skew_por_lado.py` marca la fila inválida y la deja fuera del agregado; `data/README.md` aclara que el `-QuoteBandPct` del ejemplo es el de SPY |
| [2026-08-25](hallazgos/2026-08-25-el-muro-como-banda.md) | El umbral de dominancia que pide la §61.4, y la validación que la §61.6 llama "la que puede matar todo" | La **banda** reemplaza al argmax y es estable (5 de 6 series), fallando sólo donde su propia métrica la marca floja. Pero el borde **restringe en 2 de 12** casos, y **no hay premio de crédito** atribuible al muro (z medio +0.56 ± 0.90). Con `d_min × EM` dando ρ = −1.0000 contra el delta, **la zona de la §61.3 no tiene contenido independiente del delta** | Aplicado — la §61 se reescribió como definición canónica (§61.3 a §61.6 reescritas, §61.7 procedimiento + ejemplo, §61.8 descartes, §61.9 la hipótesis única); erratas en §16, §18, §19, §37, §56.2 y §99; §98 reescrita entera; y este README corrigió el "modo estudio". **Queda pendiente la decisión de universo de su §6** |

Los hallazgos no se editan cuando se aplican: la columna **Estado** de este índice es la que
lleva la cuenta. El hallazgo queda como el registro de qué se encontró y cuándo.

## Disciplina de la carpeta

Sale de lo que ya se aprendió en [`research/backtesting/`](../backtesting/README.md) y de lo que
costó el v5:

* **La definición es una sola y se edita en el lugar.** Git guarda la historia y los diffs muestran
  qué cambió. No hay cadena `v5.0`, `v5.1`, `v5.2`: eso duplica lo que el repo hace solo, y con
  nombres numerados no se sabe desde afuera cuál es el vigente. Se congela una copia en
  `versiones/` solo al cruzar a una versión mayor, como se hizo de v1 a v5.
* **Los hallazgos son fechados y append-only.** Cada verificación es un archivo propio con qué se
  probó, contra qué datos, y qué dio. **Nunca se editan después de escritos** — si un hallazgo
  posterior lo contradice, se escribe uno nuevo que lo diga.
* **Un hallazgo que invalida una definición no la corrige en silencio**: deja una errata en el
  encabezado del documento vivo apuntando al hallazgo. El v5 mezcla definición con evidencia, y por
  eso cuando el Hallazgo 3 se cayó no había forma de rastrear qué definiciones dependían de él.
* **Todo número que entra a la definición tiene que ser reproducible** desde `data/` con algo de
  `scripts/`. La lección del v5 es esa: un valor pegado a mano en un documento no tiene cómo
  verificarse, y el error de columna sobrevivió cuatro secciones.

## Datos

Los CSV de `data/` se capturan con [`research/gex-strikes.ps1`](../gex-strikes.ps1), que trae el GEX
por strike de `/App/Gex/Analysis` más bid/ask por leg y el crédito del vertical de los dos lados:

```bash
./research/gex-strikes.ps1 -Symbol TSLA -Expiration 2026-10-16 -WithQuotes -SpreadWidth 5
```

Requiere la API corriendo y la estrategia GEX prendida (si está en OFF responde 409).

**Pedile siempre un vencimiento regular.** El bucle de la §47.1 recorre solo esos, y ni la fecha ni
el DTE dicen de qué tipo es. Desde el 2026-08-24 el script lo resuelve solo: lo imprime en el
encabezado, lo escribe en la columna `expirationType` del CSV, y avisa cuando no es `Regular`.

**Ojo con las dos columnas de crédito.** El CSV trae `pcsCredit_w5` **y** `ccsCredit_w5`, en ese
orden, y son de lados distintos de la cadena. La PCS viene primero, así que "la columna de crédito"
es la del put por defecto — que es exactamente el error del 2026-08-24. Chequeo rápido de sanidad:
en un vertical, `crédito / width` no puede superar aproximadamente el delta del short leg.

Estos CSV **se versionan**, apartándose de la decisión del script de escribir a `$env:TEMP` "para no
dejar capturas sin trackear" (ver su `.PARAMETER OutDir`). Acá son la evidencia de las conclusiones,
no una captura de trabajo, y pesan ~10 KB cada uno. Hay precedente: `research/data/` ya versiona
`SPY2025.csv`, `vvix_history.csv` y `tbill_3m_monthly.csv`; solo las cadenas crudas y los `.zip`
están en `.gitignore`.

El encabezado con spot, ATM IV, muros, ZGL y Expected Move lo imprime el script en pantalla pero
**no va al CSV**. Por eso `recheck_econ.py` los tiene hardcodeados por vencimiento.

## Scripts

Python 3.10+, sin dependencias externas. En consola Windows correr con `PYTHONIOENCODING=utf-8`.

| Script | Qué hace | Hallazgo |
|---|---|---|
| [`recheck_econ.py`](scripts/recheck_econ.py) | Recalcula el filtro económico del v5 (`RRreq`, `RequiredCredit`, `Cushion`, `WD_min`, `MaxRisk`) sobre los dos datasets de TSLA, mostrando el crédito correcto contra el que usó el v5 | [crédito CALL](hallazgos/2026-08-24-credito-call-columna-equivocada.md) |
| [`skew_por_lado.py`](scripts/skew_por_lado.py) | Mide cuánto paga cada lado de la cadena por unidad de delta, por símbolo y vencimiento | [sesgo por lado](hallazgos/2026-08-24-sesgo-por-lado-spy-qqq.md) |
| [`vencimientos_regulares.py`](scripts/vencimientos_regulares.py) | Cuántos vencimientos regulares entran en el bucle de la §47 según el día, y si una fecha dada es regular o weekly | §47.1 |
| [`banda_de_gamma.py`](scripts/banda_de_gamma.py) | El muro como banda en vez de argmax: si `d_min × EM` es delta, si la banda es estable, si su borde restringe, y si paga un premio que sobreviva a descontar el delta | [el muro como banda](hallazgos/2026-08-25-el-muro-como-banda.md) |

```bash
PYTHONIOENCODING=utf-8 python research/got/scripts/skew_por_lado.py
```

## Temas abiertos

**La lista corta es una sola línea:** hay que elegir cómo se mide la hipótesis de la §61.9 —universo
ancho, historia comprada, o aceptar el negativo—, y hasta entonces no hay parámetro que valga la
pena calibrar. El detalle, en la §98 del documento.

> **Podado el 2026-08-25.** Los tres ítems que encabezaban esta lista quedaron cerrados: `WD` y
> `Delta` **son** la misma variable —confirmado con ρ = −1.0000, no "prácticamente −1"— y `WD` salió
> de la definición (§18, §61.8); `MaxRisk` en dólares no se recalibra porque el problema no era de
> calibración (§39). Lo que decían que "sigue siendo informativo e independiente" —la posición del
> muro respecto del spot— es exactamente lo que ahora mide la banda de la §61.4, y es lo único que
> sobrevivió.

### Decidido el 2026-08-24, falta implementar

* **`RequiredCredit` no es el gate económico** (§43.2). Traducido a `Credit/Width` resulta un
  umbral de probabilidad risk-neutral de pérdida — un piso de riesgo, no un test de ventaja. Baja
  a piso de viabilidad y se queda simétrico entre lados.
* **El gate económico real es un edge test**: probabilidad implícita en el crédito contra
  probabilidad empírica de ese (lado, delta, DTE). Es el VRP, es lo que RPF ya hace con
  `pop_calibration.json`, y es side-aware por construcción — por eso el skew no lleva tratamiento
  explícito (§43.3).
* **El sesgo por lado depende del símbolo, no del motor** (§43.5). Medido el 2026-08-24, promediando
  el weekly del 4-sep y el regular del 16-oct: SPY 1.81 y QQQ 1.57 a favor del CALL, TSLA 0.65 a
  favor del PUT — el detalle por vencimiento, que es lo que reproduce, está en la tabla de la §43.4.
  Es la pendiente local de la superficie
  atravesando un umbral que no la mira, así que no hay constante que declarar — se mide por lado y
  por símbolo en cada corrida.
* **Las calibraciones van sobre SPY y QQQ**, que es el universo de la §4. TSLA queda como caso de
  control: tener un símbolo con la superficie invertida es lo que hizo visible este error.
  **Revisado el 2026-08-25:** sigue valiendo para calibrar, pero **no** para medir la §61.9 — con
  dos símbolos esa pregunta tarda seis años. El universo de calibración y el de medición dejaron de
  poder ser el mismo.
* **Solapamiento con RPF.** Los dos son venta de prima de riesgo definido, alerts-only, sobre
  GEX/ZGL/walls, con push por socket. La diferencia real es el eje de decisión. Conviene decidir si
  GOT es una tercera estrategia o la evolución del motor de RPF antes de duplicar la maquinaria.
  **Revisado el 2026-08-25:** con el borde de la banda restringiendo en 2 de 12 casos y sin premio
  de crédito, la diferencia de eje se achicó bastante. Si la §61.9 no se mide, no queda diferencia.

### Decidido el 2026-08-25, falta implementar

* **"No hay muro" como resultado válido** de evaluar un lado (§61.4). Hoy `SelectCallWall` /
  `SelectPutWall` siempre devuelven uno, incluso cuando los dos candidatos están empatados a 1.00x.
* **El muro pasa de argmax a banda**, con `xmed` y `xdisj` como sus dos tests. Los umbrales **no**
  se declaran todavía: hay un solo evento de inestabilidad en el dataset (§61.4).
* **Registrar cuál condición ató** en cada candidato — banda o `delta_max` (§61.3). Es lo que
  distingue un candidato estructural de un corte de delta, y sin eso la zona no se puede auditar.
* **`delta_max` se declara una sola vez, en delta.** `WD_min`, `d_min × EM` y la ventana de delta
  eran tres nombres del mismo umbral (§61.8).

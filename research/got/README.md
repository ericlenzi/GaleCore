# Research / GOT — diseño y validación de la estrategia

GOT (GaleCore Options Trading) es una estrategia de **venta de prima con riesgo definido**,
alerts-only, que decide dónde vender por estructura de gamma (walls, ZGL, Expected Move) y valida
la compensación con un crédito requerido dinámico en vez de un mínimo fijo.

**Todavía no está implementada en la plataforma**: no tiene prefijo en `strategies[]` de
`galecore_rules_core.json`, ni JSON de reglas, ni endpoints, ni pestaña. Por eso vive acá y no en
`docs/`. Cuando se implemente, [`galecore-estrategia-got.md`](galecore-estrategia-got.md) se muda
tal cual a `docs/got/` y se sigue el checklist de "Estrategias — convención" del `CLAUDE.md`.

Estado al 2026-08-24: **v5, diseño avanzado**. Lo que falta cerrar está en la sección 83 del
documento de definición, y en la 98 el corte entre lo definido, lo validado y lo pendiente.

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
| [`recheck_econ.py`](scripts/recheck_econ.py) | Recalcula el filtro económico del v5 (`RRreq`, `RequiredCredit`, `Cushion`, `WD_min`, `MaxRisk`) sobre los dos datasets de TSLA, mostrando el crédito correcto contra el que usó el v5 | 2026-08-24 |

```bash
PYTHONIOENCODING=utf-8 python research/got/scripts/recheck_econ.py
```

## Temas abiertos

Además de lo que lista la sección 83 del documento, quedaron planteados en la sesión del 2026-08-24
y **todavía no verificados**:

* **`WD` y `Delta` son casi la misma variable dentro de un vencimiento.** `WD = (muro − spot)/EM +
  f(delta)`, o sea que el muro solo aporta un offset constante; en los datos de TSLA la correlación
  es prácticamente −1. Barrer `WD_min` y `Delta_max` por separado va a dar una superficie
  degenerada. Lo informativo e independiente es la posición del muro respecto del spot.
* **Recalibrar `MaxRisk` y `Width` juntos.** Hoy uno está en dólares y el otro en strikes, y la
  combinación elimina el 100% de los candidatos en un subyacente de $355 (§39).
* **`WD` y `Delta` acotan la misma variable.** Confirmado el 2026-08-24 (§43.2): dentro de un
  vencimiento el Structural Gate es un techo de delta y el Economic Gate un piso de delta. Los
  sweeps separados de `WD_min` y `Delta_max` van a dar una superficie degenerada.

### Decidido el 2026-08-24, falta implementar

* **`RequiredCredit` no es el gate económico** (§43.2). Traducido a `Credit/Width` resulta un
  umbral de probabilidad risk-neutral de pérdida — un piso de riesgo, no un test de ventaja. Baja
  a piso de viabilidad y se queda simétrico entre lados.
* **El gate económico real es un edge test**: probabilidad implícita en el crédito contra
  probabilidad empírica de ese (lado, delta, DTE). Es el VRP, es lo que RPF ya hace con
  `pop_calibration.json`, y es side-aware por construcción — por eso el skew no lleva tratamiento
  explícito (§43.3).
* **Antes que nada, el mismo sweep sobre SPY y QQQ** (§43.4). Toda la evidencia del sesgo viene de
  un símbolo con superficie atípica; la predicción es que la brecha entre lados sea marcadamente
  menor. Si se repite igual en los tres, el problema es del modelo.
* **Hasta entonces GOT es put-biased declarado**, y el lado call se sigue registrando aunque casi
  nunca dispare — es la muestra que después calibra el edge test (§43.5).
* **Solapamiento con RPF.** Los dos son venta de prima de riesgo definido, alerts-only, sobre
  GEX/ZGL/walls, con push por socket. La diferencia real es el eje de decisión. Conviene decidir si
  GOT es una tercera estrategia o la evolución del motor de RPF antes de duplicar la maquinaria.

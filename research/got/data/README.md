# Datasets de GOT

Capturas de cadena con GEX por strike, bid/ask por leg y el crédito del vertical de los dos
lados. Se generan con [`research/gex-strikes.ps1`](../../gex-strikes.ps1):

```bash
./research/gex-strikes.ps1 -Symbol SPY -Expiration 2026-10-16 -WithQuotes -SpreadWidth 5 -QuoteBandPct 12
```

Requiere la API corriendo y la estrategia GEX prendida (si está en OFF responde 409).

## Cuidado: el nombre del archivo lleva el vencimiento, no la fecha de captura

`SPY_gex_2026-10-16.csv` es *el vencimiento del 16 de octubre*, capturado cuándo no lo dice.
Dos capturas del mismo vencimiento en días distintos **se pisan**. Por eso cada tanda va en
su propia carpeta fechada por el día de captura, y el `-OutDir` del script apunta ahí.

## Capturas

| Carpeta | Cuándo | Qué tiene | Condiciones |
|---|---|---|---|
| [`2026-08-24/`](2026-08-24/) | 24-ago-2026 | TSLA, SPY, QQQ · vencimientos 2026-09-04 (DTE 11, **weekly**), 2026-09-18 (DTE 25, regular, solo SPY y QQQ) y 2026-10-16 (DTE 53–56, regular) | **Mezcladas**: TSLA en sesión (11:57 y 12:35 ET); SPY y QQQ post-cierre (~17:25 ET, y el 09-18 a las ~18:15 ET) |

El **2026-09-18 se agregó al final del día**, después de que el hallazgo del weekly mostrara que el
dataset no tenía ningún vencimiento regular corto. Es la expiración cercana del bucle real de la
§47.1. Sigue siendo post-cierre, así que **no cierra** el pendiente de recapturar con book vivo.

**El 2026-09-04 es un weekly, no un vencimiento regular** — es el primer viernes de septiembre; el
tercero era el 18. El alcance del bucle definido en la §47.1 recorre solo vencimientos regulares,
así que la mitad de la evidencia del v5 viene de un tipo de vencimiento que el flujo no recorre.
Las capturas nuevas van sobre regulares. Verificable con
[`scripts/vencimientos_regulares.py`](../scripts/vencimientos_regulares.py).

La mezcla de la tanda del 24 está documentada y controlada: el
[hallazgo del sesgo por lado](../hallazgos/2026-08-24-sesgo-por-lado-spy-qqq.md) §3 muestra
que recalcular con mid en vez de bid/ask no mueve el resultado, y que el book de SPY/QQQ
post-cierre estaba **más ajustado** que el de TSLA en sesión. Aun así queda pendiente
recapturar SPY y QQQ con book vivo.

## Qué hay en cada CSV

```text
strike, callGEX_musd, putGEX_musd, netGEX_musd, callOI, putOI, callDelta, putDelta,
callBid, callAsk, putBid, putAsk, pcsCredit_w5, ccsCredit_w5, expirationType
```

**`expirationType` no está en todos los archivos**, y la frontera no es la carpeta sino el momento
de la captura: se agregó a `gex-strikes.ps1` el 2026-08-24 a raíz del hallazgo del weekly, así que
dentro de esta misma tanda **los dos CSV del `2026-09-18` la tienen y los otros seis no**. Para
esos el tipo se deduce con
[`scripts/vencimientos_regulares.py`](../scripts/vencimientos_regulares.py).

Es constante en todas las filas: es un hecho del archivo y no del strike, y se repite por fila para
que viaje con el dato en vez de quedarse en el encabezado de pantalla. Los valores son los de
Tastytrade (`Regular`, `Weekly`, `Quarterly`, `Mini`); el script además avisa al capturar cuando no
es `Regular`.

**Cualquier consumidor tiene que tolerar columnas no numéricas.** Agregar esta reventó
`skew_por_lado.py`, que hacía `float()` sobre toda celda — y lo hizo de la peor forma, fallando
solo con los archivos nuevos y andando con los viejos, o sea dependiendo de qué se leyera.

**Las dos columnas de crédito son de lados distintos de la cadena**, y `pcsCredit_w5` viene
primero — o sea que "la columna de crédito" es la del put por defecto. Ese fue exactamente
el error del [hallazgo del crédito CALL](../hallazgos/2026-08-24-credito-call-columna-equivocada.md).
Chequeo de sanidad: en un vertical, `crédito / width` no puede superar aproximadamente el
delta del short leg.

**El encabezado no está en el CSV.** Spot, ATM IV, muros, ZGL y DTE los imprime el script en
pantalla al capturar, pero no se guardan. Si un análisis los necesita, hay que anotarlos a
mano — `recheck_econ.py` los tiene hardcodeados por eso. `skew_por_lado.py` no los necesita.

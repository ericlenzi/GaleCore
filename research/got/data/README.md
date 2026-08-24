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
| [`2026-08-24/`](2026-08-24/) | 24-ago-2026 | TSLA, SPY, QQQ · vencimientos 2026-09-04 (DTE 11, **weekly**) y 2026-10-16 (DTE 53–56, regular) | **Mezcladas**: TSLA en sesión (11:57 y 12:35 ET); SPY y QQQ post-cierre (~17:25 ET) |

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
callBid, callAsk, putBid, putAsk, pcsCredit_w5, ccsCredit_w5
```

**Las dos columnas de crédito son de lados distintos de la cadena**, y `pcsCredit_w5` viene
primero — o sea que "la columna de crédito" es la del put por defecto. Ese fue exactamente
el error del [hallazgo del crédito CALL](../hallazgos/2026-08-24-credito-call-columna-equivocada.md).
Chequeo de sanidad: en un vertical, `crédito / width` no puede superar aproximadamente el
delta del short leg.

**El encabezado no está en el CSV.** Spot, ATM IV, muros, ZGL y DTE los imprime el script en
pantalla al capturar, pero no se guardan. Si un análisis los necesita, hay que anotarlos a
mano — `recheck_econ.py` los tiene hardcodeados por eso. `skew_por_lado.py` no los necesita.

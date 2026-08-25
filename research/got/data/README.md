# Datasets de GOT

Capturas de cadena con GEX por strike, bid/ask por leg y el crédito del vertical de los dos
lados. Se generan con [`research/gex-strikes.ps1`](../../gex-strikes.ps1):

```bash
./research/gex-strikes.ps1 -Symbol SPY -Expiration 2026-10-16 -WithQuotes -SpreadWidth 5 -QuoteBandPct 12
```

Requiere la API corriendo y la estrategia GEX prendida (si está en OFF responde 409).

**El `-QuoteBandPct` de ese ejemplo es el de SPY, y no se traslada.** La banda está en porcentaje
de spot, así que la distancia que cubre depende de la IV del símbolo: el ±12% que sobra para un ETF
de índice al 13% de IV deja afuera la zona vendible de un símbolo al 42%, y la captura sale
truncada sin decirlo. TSLA va con 35. El script avisa cuando la banda no llega al strike de delta
0.10; si avisa, hay que subirla y recapturar.

## Cuidado: el nombre del archivo lleva el vencimiento, no la fecha de captura

`SPY_gex_2026-10-16.csv` es *el vencimiento del 16 de octubre*, capturado cuándo no lo dice.
Dos capturas del mismo vencimiento en días distintos **se pisan**. Por eso cada tanda va en
su propia carpeta fechada por el día de captura, y el `-OutDir` del script apunta ahí.

## Capturas

| Carpeta | Cuándo | Qué tiene | Condiciones |
|---|---|---|---|
| [`2026-08-24/`](2026-08-24/) | 24-ago-2026 | TSLA, SPY, QQQ · vencimientos 2026-09-04 (DTE 11, **weekly**), 2026-09-18 (DTE 25, regular, solo SPY y QQQ) y 2026-10-16 (DTE 53–56, regular) | **Mezcladas**: TSLA en sesión (11:57 y 12:35 ET); SPY y QQQ post-cierre (~17:25 ET, y el 09-18 a las ~18:15 ET) |
| [`2026-08-25/`](2026-08-25/) | 25-ago-2026 | TSLA, SPY, QQQ · vencimientos 2026-09-18 (DTE 24) y 2026-10-16 (DTE 52), **los dos regulares** — son el bucle de la §47.1 mirando desde ese día | **Todas en sesión**, 10:09–10:23 ET. Horarios exactos por captura en [`2026-08-25/capturas.txt`](2026-08-25/capturas.txt) |
| [`2026-08-25-t2/`](2026-08-25-t2/) | 25-ago-2026 | SPY · los mismos dos vencimientos. **Primera captura con `callIV`/`putIV`** | En sesión, 11:57–12:01 ET. Segunda tanda del mismo día: por eso el sufijo `-t2`, ya que la carpeta se nombra por día de captura y dos tandas se pisarían |

**Dos tandas del mismo día se pisan**, porque el nombre de la carpeta es la fecha y el del archivo
es el vencimiento. El sufijo `-tN` es la salida. Y tiene un premio: la `-t2` está a **~1h50m** de
la tanda de la mañana sobre los mismos vencimientos, así que es la primera medición de estabilidad
intradía de la estructura que hay en el dataset.

La tanda del 25 la generó [`scripts/capturar_2026-08-25.ps1`](../scripts/capturar_2026-08-25.ps1),
que además **guarda el encabezado** de cada captura en su `log_<SÍMBOLO>_<venc>.txt` — spot, ATM IV,
muros, ZGL y DTE, que es justamente lo que esta página advierte más abajo que el CSV no lleva.

**Las bandas de quote no son iguales entre tandas, y eso importa.** SPY y QQQ van con
`-QuoteBandPct 12` los dos días; TSLA se capturó **sin banda** el 24 (la cadena entera, de 50 a 900)
y con **35** el 25. El promedio de spread relativo de un archivo depende de eso, así que **el ancho
de book no se compara entre capturas de banda distinta**. El primer intento de TSLA del 25 salió con
banda 12 y quedó inservible —17 strikes cotizados, los tres objetivos de delta en el mismo strike—;
está guardado en `2026-08-25/descartado-banda12/` como evidencia, fuera del glob no recursivo de
`skew_por_lado.py`. Detalle en
[el hallazgo del 25](../hallazgos/2026-08-25-el-sesgo-aguanta-con-book-vivo.md).

El **2026-09-18 se agregó al final del día**, después de que el hallazgo del weekly mostrara que el
dataset no tenía ningún vencimiento regular corto. Es la expiración cercana del bucle real de la
§47.1. Sigue siendo post-cierre, así que no cerró el pendiente de recapturar con book vivo — eso
lo cerró la tanda del 25.

**El 2026-09-04 es un weekly, no un vencimiento regular** — es el primer viernes de septiembre; el
tercero era el 18. El alcance del bucle definido en la §47.1 recorre solo vencimientos regulares,
así que la mitad de la evidencia del v5 viene de un tipo de vencimiento que el flujo no recorre.
Las capturas nuevas van sobre regulares. Verificable con
[`scripts/vencimientos_regulares.py`](../scripts/vencimientos_regulares.py).

La mezcla de la tanda del 24 está documentada y controlada: el
[hallazgo del sesgo por lado](../hallazgos/2026-08-24-sesgo-por-lado-spy-qqq.md) §3 muestra
que recalcular con mid en vez de bid/ask no mueve el resultado, y que el book de SPY/QQQ
post-cierre estaba **más ajustado** que el de TSLA en sesión. La recaptura con book vivo se hizo
el 25 y confirmó el resultado: ver
[el hallazgo del 25](../hallazgos/2026-08-25-el-sesgo-aguanta-con-book-vivo.md).

## Qué hay en cada CSV

```text
strike, callGEX_musd, putGEX_musd, netGEX_musd, callOI, putOI, callDelta, putDelta,
callBid, callAsk, putBid, putAsk, pcsCredit_w5, ccsCredit_w5, expirationType,
callIV, putIV
```

**`callIV` / `putIV` existen desde el 2026-08-25 por la tarde**, cuando la API empezó a exponer la
IV por strike (antes la calculaba y la descartaba al mapear). Van al final por la misma razón que
`expirationType`: no mover las columnas que los scripts ya parsean. Si la API que responde es
anterior al cambio, las celdas salen vacías y `gex-strikes.ps1` avisa — sin el aviso, un CSV
válido en todo lo demás con dos columnas vacías es justo la degradación silenciosa que ya costó
cara dos veces acá.

**No se pueden comparar `callIV` contra `putIV` en el mismo strike.** Por paridad put-call
deberían coincidir, y no lo hacen: medido sobre SPY, `callIV − putIV` da **+0.019 a +0.024 de
media cerca del dinero, y nunca es negativo ahí**. Las dos series están en niveles distintos —
probablemente por el forward/dividendo que asume el proveedor al invertir el precio, más el
ejercicio temprano del lado put. Cada lado se compara **contra sí mismo a través de strikes**;
la diferencia entre lados en un mismo strike no significa nada.

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

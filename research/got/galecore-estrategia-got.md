# GOT Studio V5
## Estado integral de la estrategia de opciones — TSLA / SPY / QQQ / SKM

> **Versión:** 5.0 · **Recibido:** 2026-08-24 · **Estado:** diseño avanzado, validación en curso
>
> Documento **vivo**: se edita en el lugar y la historia la guarda git. Las versiones 1 a 4 están
> congeladas en [versiones/](versiones/).
>
> **Corregido el 2026-08-24.** Las tablas de CALL de las secciones 25 y 27 leían la columna
> `pcsCredit_w5` de los datasets en vez de `ccsCredit_w5`, sobrestimando el crédito del lado call
> entre 6x y 16x. Recalculado desde los datos, el **Hallazgo 3 se invirtió** y aparecieron tres
> consecuencias que no estaban vistas. Las secciones afectadas ya están reescritas y llevan su
> propia nota: **25**, **27**, **28**, **31**, **39**, **53**, **54**, **83** y **98**, más las
> **43.1 a 43.5** que son nuevas.
> Las tablas de PUT (secciones 24 y 26) se verificaron correctas y no se tocaron.
>
> De ahí salió además una decisión de diseño que va más allá de la corrección: `RequiredCredit`
> resultó ser un **piso de riesgo y no un test de ventaja**, y baja de rango a piso de viabilidad.
> El gate económico real pasa a ser un **edge test** —probabilidad implícita contra empírica— que
> todavía no está implementado. Ver **43.2** y **43.3**.
>
> **Flujo redibujado el 2026-08-24.** La sección **47** se rehízo entera para que el diagrama diga
> lo que esas decisiones dejaron: seis niveles en vez de cuatro filtros en serie, la ventana de
> delta como una sola variable con dos cotas, el edge test dibujado como el gate económico que
> falta, y una marca por bloque para que se vea cuánto del flujo está definido. Las secciones
> **48**, **84** y **88**, que dibujan el mismo flujo desde otro ángulo, quedaron con errata
> apuntando ahí. La **47.1**, nueva, fija el alcance del bucle —vencimientos **regulares** con
> DTE ≤ 60— y de ahí sale que el `2026-09-04` sobre el que se validó medio v5 es un weekly que ese
> alcance excluye.
>
> Verificación completa, tablas recalculadas y consecuencias en
> [el hallazgo del 2026-08-24](hallazgos/2026-08-24-credito-call-columna-equivocada.md).
> Reproducible con [`scripts/recheck_econ.py`](scripts/recheck_econ.py).
>
> *Fuera de esas secciones, el texto es el recibido el 2026-08-24 sin cambios de contenido. Se
> repararon además defectos de transcripción del archivo original: un fence sin cerrar que
> aplanaba los headings de las secciones 5.2 a 99, las tablas que habían quedado separadas por
> tabs, y un fragmento del script que generó el archivo pegado al final.*

**Fecha:** 24/08/2026  
**Estado:** Diseño avanzado / validación empírica en curso  
**Objetivo:** consolidar todo lo definido, probado y pendiente antes de cerrar la estrategia de GOT (GaleCore Options Trading Monitor).

---

# 1. Resumen ejecutivo

GOT evolucionó desde una estrategia relativamente simple de Put Credit Spreads hacia un **motor de decisión estructural y económico**, cuyo principio central es:

> **El mercado define dónde vender.  
> La option chain determina el candidato.  
> Las condiciones determinan cuándo alertar.**

La estrategia ya tiene una arquitectura bastante clara:

1. **Market Diagnostic**
2. **Market Structure**
3. **Sell Zones**
4. **Safety Strike / Candidate Generation**
5. **Real Option Chain Validation**
6. **Economic Validation**
7. **Candidate Ranking**
8. **Alert Engine**

La evolución más importante fue abandonar la idea de que un crédito mínimo fijo —por ejemplo `MinCredit = $80`— pueda funcionar de manera universal.

Los tests recientes con TSLA demostraron:

- un vencimiento corto puede tener una estructura excelente pero no pagar suficiente;
- un vencimiento largo puede ofrecer créditos aparentemente pequeños y seguir siendo económicamente atractivos;
- por lo tanto, el crédito debe evaluarse **relativamente al riesgo, DTE y distancia estructural**, no mediante un mínimo absoluto fijo;
- el Delta `0.10–0.20` **no quedó demostrado como ventana**: es el rango que se barrió, y lo que se observó es que la estructura corta arriba y la economía corta abajo, en un punto que depende del lado y del DTE (ver 28, corregida el 2026-08-24);
- el Delta `0.22` no necesariamente es malo: en los últimos tests fue eliminado principalmente por **Wall Distance**, lo que sugiere que el límite de Delta podría ser consecuencia de la estructura y no una regla artificial;
- la arquitectura final debería separar claramente **filtro estructural**, **filtro económico** y **ranking de candidatos**.

La estrategia está avanzada, pero todavía faltan definiciones importantes para poder considerarla cerrada y lista para backtesting sistemático.

---

# 2. Filosofía de la estrategia

## 2.1 Principio rector

GOT no debe intentar predecir hacia dónde irá el mercado.

La estrategia busca vender opciones en zonas donde:

- existe distancia suficiente respecto de la estructura de gamma;
- la probabilidad implícita de terminar ITM es suficientemente baja;
- el crédito compensa adecuadamente el riesgo asumido;
- existe liquidez suficiente;
- las condiciones generales del mercado permiten emitir una alerta.

No se busca:

- adivinar dirección;
- encontrar el strike que maximiza crédito;
- usar un score arbitrario;
- imponer un crédito mínimo absoluto;
- operar dentro de gamma walls.

---

# 3. Objetivo operativo de GOT V5

GOT V5 es conceptualmente un **sistema de detección y alerta**, no un sistema autónomo de ejecución.

Debe:

1. analizar el mercado;
2. identificar estructura;
3. construir zonas de venta;
4. generar candidatos;
5. validar estructura;
6. validar economía;
7. seleccionar/rankear candidatos;
8. emitir alerta cuando se cumplen las condiciones.

La ejecución queda fuera del motor.

La estrategia actual es **alerts-only**.

---

# 4. Instrumentos y estrategia base

La estrategia está pensada principalmente para índices y ETFs altamente líquidos, aunque se probó también sobre acciones.

Ejemplos utilizados:

- SPY
- QQQ
- TSLA
- SKM

La estructura de la estrategia debe ser suficientemente general como para no depender de un símbolo específico.

---

# 5. Tipo de operación

La operación base es un **credit spread definido**.

## 5.1 Put Credit Spread

Se vende un PUT OTM y se compra un PUT más lejano.

Ejemplo conceptual:

```text
Sell PUT K1
Buy  PUT K2

K2 < K1 < Spot

```

El riesgo máximo es:

```text
MaxLoss = Width - Credit

```

## 5.2 Call Credit Spread

Se vende un CALL OTM y se compra un CALL más lejano.

```text
Sell CALL K1
Buy  CALL K2

Spot < K1 < K2

```

Riesgo máximo:

```text
MaxLoss = Width - Credit

```
# 6. Parámetros históricos y evolución
## 6.1 Estrategia inicial

La primera versión utilizaba aproximadamente:

DTE ~45 días;

POP ~85%;

salida al 50% de beneficio;

Put Credit Spread;

crédito mínimo fijo;

ancho relativamente pequeño respecto del riesgo.

Se observó que la estrategia podía ser razonablemente consistente, pero con rentabilidad limitada.

# 7. Evolución hacia V2

Se abandonó la idea de depender de una predicción direccional.

La lógica se simplificó a:

```text
DEFINIR SAFETY DELTA
        ↓
IDENTIFICAR STRIKE
        ↓
CALCULAR ENTRY DELTA

```
Posteriormente se incorporaron gamma walls y estructura de mercado.

# 8. Parámetros duros que fueron considerados

En etapas anteriores se utilizaron:

Max Risk: $400

Min Credit: $80

POP >= 80%

Delta entre 0.10 y 0.20

no vender dentro de gamma walls

probar primero width de 1 strike

eventualmente permitir hasta 2 strikes

Estos parámetros no deben considerarse todos definitivos.

En particular:

MinCredit = $80 fue invalidado como parámetro universal.

# 9. V3 — arquitectura conceptual

La arquitectura V3 estableció:

Market Diagnostic
Métricas:

IV

IV Rank

IV Momentum

```text
RV

GEX

```

Gamma Regime

Z-score

EMA / trend

ZGL

Expected Move

Resultado:

```text
FAVORABLE
SELECTIVE
NO OPERATE

```
# 10. Market Diagnostic

El diagnóstico no decide directamente qué lado vender.

Su función es determinar si el entorno es:

FAVORABLE
Condiciones suficientemente buenas para buscar oportunidades normalmente.

SELECTIVE
Se permite buscar oportunidades, pero con filtros más exigentes.

NO OPERATE
No se generan alertas.

# 11. Directional Z-score

Se definió un diagnóstico direccional basado en candles.

La normalización utiliza la volatilidad implícita ATM convertida a volatilidad diaria.

Conceptualmente:

dailySigma = ivAtm / sqrt(252)
y el movimiento observado se compara contra dicha sigma.

Guardas:

```text
si candles < 6 → z = 0
si ivAtm <= 0 → z = 0

```
Umbrales:

|z| < 1.0

    Neutral

1.0 <= |z| < 1.5
    Moderate

|z| >= 1.5

    Extreme
Estos umbrales fueron definidos, pero todavía requieren validación estadística más amplia.

# 12. Market Structure

Una vez superado el diagnóstico, se obtiene:

Spot

ZGL

Call Wall

Put Wall

Net GEX

Expected Move

GEX por strike

# 13. Gamma Walls
## 13.1 Call Wall

Se definió como el strike donde existe la mayor concentración relevante de gamma positiva del lado CALL.

## 13.2 Put Wall

Se definió como el strike donde existe la mayor concentración relevante de gamma negativa del lado PUT.

La intención es utilizar las walls como zonas estructurales, no como niveles exactos de soporte/resistencia.

# 14. ZGL

ZGL es el nivel estructural central utilizado por GOT.

Debe utilizarse como referencia adicional para evaluar:

distancia del candidato;

relación entre Spot y estructura;

ubicación de Sell Zones;

contexto de gamma.

ZGL no debe utilizarse como un simple target de precio.

# 15. Expected Move

El Expected Move se utiliza como referencia de dispersión esperada.

Ejemplo:

Spot = 355.10
Expected Move = ±25.7
Esto produce un rango:

329.4 → 380.8
El Expected Move no es una garantía de precio ni un límite absoluto.

Es una referencia probabilística derivada de la volatilidad implícita.

# 16. Sell Zones

Las Sell Zones convierten la estructura de mercado en zonas candidatas.

## 16.1 PUT Sell Zone

Generalmente:

Strike < Put Wall
Pero no todo strike debajo del Put Wall es automáticamente vendible.

Debe pasar:

distancia estructural;

delta;

crédito;

RequiredCredit;

POP;

liquidez;

riesgo máximo.

## 16.2 CALL Sell Zone

Generalmente:

Strike > Call Wall
Con las mismas validaciones posteriores.

# 17. Gamma Exclusion Zone

No se debe vender dentro de una gamma wall o demasiado cerca de ella.

Esto llevó al desarrollo de Wall Distance.

# 18. Wall Distance — definición

Wall Distance mide la separación del strike respecto de la gamma wall correspondiente, normalizada por Expected Move.

PUT
WD_put =
(PutWall - Strike) / ExpectedMove
CALL
WD_call =
(Strike - CallWall) / ExpectedMove
Ejemplo:

Put Wall = 330
Strike = 315
Expected Move = 59.7

WD = (330 - 315) / 59.7
   = 0.251
# 19. WD mínimo

En los tests recientes se utilizó:

WD >= 0.20
como filtro estructural.

Interpretación:

```text
WD < 0.20 → demasiado cerca de wall → NO

WD >= 0.20 → estructuralmente permitido

```

Este valor todavía necesita validación histórica.

No debe considerarse definitivamente optimizado.

# 20. Safety Strike

Dentro de la Sell Zone se buscan strikes que:

estén fuera de gamma wall;

tengan Delta suficientemente bajo;

tengan distancia suficiente;

tengan crédito razonable;

tengan liquidez.

El Safety Strike no es necesariamente el strike con menor Delta.

Es el strike que logra un equilibrio aceptable entre:

Safety
+
Economics
# 21. Delta

Delta se utiliza como proxy de probabilidad de terminar ITM.

Para PUT:

putDelta < 0
Se trabaja con:

abs(putDelta)
Para CALL:

callDelta > 0
# 22. Entry Delta Window

La hipótesis histórica fue:

0.10 <= Delta <= 0.20
Posteriormente se decidió testear:

0.10
0.12
0.15
0.18
0.20
0.22
# 23. Resultado del Delta Sweep — TSLA

Se analizaron dos vencimientos:

4 Sep 2026
Spot: 355.10

DTE: 11

Net GEX: +$3B

ZGL: 353

Call Wall: 360

Put Wall: 345

Expected Move: ±25.7

16 Oct 2026
Spot: 356.70

DTE: 56

Net GEX: -$2B

ZGL: 364

Call Wall: 400

Put Wall: 330

Expected Move: ±59.7

# 24. Resultado — TSLA 4 Sep PUT

Candidatos aproximados:

| Target Delta | Strike | Actual Delta | WD | Credit |
|---|---|---|---|---|
| 0.10 | 325 | .0996 | .778 | $0.36 |
| 0.12 | 327.5 | .1172 | .681 | $0.43 |
| 0.15 | 330 | .1365 | .584 | $0.53 |
| 0.18 | 335 | .1832 | .389 | $0.76 |
| 0.20 | 337.5 | .2103 | .292 | $0.86 |
| 0.22 | 337.5 | .2103 | .292 | $0.86 |

Resultado:

Ningún candidato pasó el filtro económico.

Conclusión:

El problema del 4 Sep PUT no es encontrar el Delta correcto; el vencimiento simplemente no paga suficiente para el riesgo exigido por el modelo.

# 25. Resultado — TSLA 4 Sep CALL

> **Sección corregida el 2026-08-24.** La versión original leía la columna `pcsCredit_w5`
> del dataset en vez de `ccsCredit_w5`, con lo que los créditos estaban sobrestimados
> entre 6x y 11x, y concluía que todos los candidatos pasaban. Ver
> [el hallazgo](hallazgos/2026-08-24-credito-call-columna-equivocada.md).

Crédito del vertical de $5 del lado CALL, con el `RequiredCredit` que le corresponde a
cada candidato por DTE 11 y su WD:

| Target Delta | Strike | Actual Delta | WD | Credit | Required | Cushion | Resultado |
|---|---|---|---|---|---|---|---|
| 0.10 | 395 | .1057 | 1.362 | $0.29 | $0.72 | −59.8% | falla |
| 0.12 | 392.5 | .1188 | 1.265 | $0.33 | $0.72 | −54.2% | falla |
| 0.15 | 387.5 | .1502 | 1.070 | $0.47 | $0.72 | −34.8% | falla |
| 0.18 | 382.5 | .1893 | .875 | $0.63 | $0.74 | −14.7% | falla |
| 0.20 | 382.5 | .1893 | .875 | $0.63 | $0.74 | −14.7% | falla |
| 0.22 | 380 | .2121 | .778 | $0.69 | $0.75 | −8.3% | falla |

Resultado:

Ningún candidato pasó el filtro económico.

Conclusión:

Combinado con la sección 24, el 4 Sep **falla de los dos lados**: los cinco candidatos
PUT y los cinco CALL quedan por debajo de su `RequiredCredit`.

No es un vencimiento bueno de un lado y malo del otro. Es un DTE corto que no paga en
ninguno: con `DTEFactor = sqrt(30/11) = 1.65`, el modelo exige del orden de $0.72 a $0.90
sobre width 5, y la cadena de 11 días no lo ofrece a ningún delta razonable de ninguno de
los dos lados.

El comportamiento es además **monótono en la dirección esperada**: el Cushion mejora al
subir el delta (de −59.8% en 0.10 a −8.3% en 0.22), o sea que el candidato menos malo es
el más agresivo. Un vencimiento que solo se vuelve viable acercándose al spot no es un
vencimiento viable.
# 26. Resultado — TSLA 16 Oct PUT


| Target Delta | Strike | Actual Delta | WD | Credit |
|---|---|---|---|---|
| 0.10 | 295 | .1070 | .586 | $0.46 |
| 0.12 | 300 | .1253 | .503 | $0.50 |
| 0.15 | 305 | .1445 | .419 | $0.65 |
| 0.18 | 310 | .1674 | .335 | $0.75 |
| 0.20 | 315 | .1925 | .251 | $0.90 |
| 0.22 | 320 | .2196 | .168 | $1.00 |

Resultado:

```text
0.10 → pasa

0.12 → pasa

0.15 → pasa

0.18 → pasa

0.20 → pasa

0.22 → falla WD

```

Este fue uno de los resultados más importantes.

# 27. Resultado — TSLA 16 Oct CALL

> **Sección corregida el 2026-08-24.** La versión original leía la columna `pcsCredit_w5`
> del dataset en vez de `ccsCredit_w5`, con lo que los créditos estaban sobrestimados
> entre 6x y 16x, y concluía que pasaban cinco de seis. Ver
> [el hallazgo](hallazgos/2026-08-24-credito-call-columna-equivocada.md).

| Target Delta | Strike | Actual Delta | WD | Credit | Required | Cushion | Resultado |
|---|---|---|---|---|---|---|---|
| 0.10 | 450 | .1098 | .838 | $0.21 | $0.36 | −41.6% | falla |
| 0.12 | 445 | .1192 | .754 | $0.20 | $0.37 | −45.4% | falla |
| 0.15 | 430 | .1569 | .503 | $0.35 | $0.38 | −9.1% | falla |
| 0.18 | 425 | .1725 | .419 | $0.40 | $0.40 | −0.1% | empata |
| 0.20 | 415 | .2064 | .251 | $0.55 | $0.46 | +20.0% | **pasa** |
| 0.22 | 410 | .2260 | .168 | $0.60 | — | — | falla WD |

Resultado:

```text
0.10 → falla economico
0.12 → falla economico
0.15 → falla economico
0.18 → empata
0.20 → pasa
0.22 → falla WD
```

Conclusión:

**Acá sí aparece la asimetría entre lados**, pero al revés de lo que decía la versión
original: el mismo vencimiento pasa 5 de 6 del lado PUT (sección 26) y 1 de 6 del lado
CALL. Y no es un accidente de este vencimiento — es **skew**. A delta equivalente:

```text
put delta .1070 -> $0.46      call delta .1098 -> $0.21
put delta .1925 -> $0.90      call delta .2064 -> $0.55
```

Las puts pagan aproximadamente el doble que las calls equidistantes, que es el
comportamiento normal de la superficie de volatilidad de un equity.

Por lo tanto la unidad de evaluación sigue siendo:

Expiration × Side × Strike

pero el motivo cambia. El lado no importa porque un vencimiento sea caprichosamente mejor
de un lado; importa porque **la cadena cotiza los dos lados a precios distintos por la
misma probabilidad**. Eso tiene una consecuencia sobre el diseño del filtro económico que
se trata en la sección 43.

**Nota sobre el rango de delta.** El candidato que pasa es el de delta 0.2064 —el más
alto que sobrevive a WD—, y los de delta bajo fallan por economía. Del lado call la
ventana queda apretada por los dos extremos a la vez: la estructura elimina los deltas
altos y la economía elimina los bajos. Del lado put, con DTE 56, los deltas bajos pasan
sin problema. La ventana de delta **no es la misma de los dos lados**, que es otra forma
de ver lo mismo.

# 28. Conclusión del Delta Sweep

El test NO demuestra que:

0.10–0.20
sea una ley universal.

Lo que demuestra es algo más interesante:

El límite superior de la ventana no es una regla de delta: es la estructura.

En particular:

Delta 0.22
    ↓
mayor crédito
    ↓
menor WD
    ↓
puede ser eliminado por Wall Distance
Por eso no conviene imponer todavía:

MaxDelta = 0.20
como regla fundamental.

> **Revisado el 2026-08-24.** La versión original afirmaba que *"la zona 0.10–0.20 aparece
> naturalmente como una región robusta"*. Con los créditos de CALL corregidos esa
> afirmación **no se sostiene tal cual**, porque descansaba en que los seis candidatos CALL
> del 4 Sep y cinco de los seis del 16 Oct pasaran. Ninguno de esos dos hechos es cierto.

Lo que queda demostrado, más acotado:

- **El límite superior sí sale de la estructura.** El delta 0.22 cae por WD en los cuatro
  sweeps, de los dos lados y en los dos vencimientos. Ese es el hallazgo firme.
- **El límite inferior lo pone la economía, y no es simétrico.** Del lado PUT con DTE 56 el
  delta 0.10 pasa cómodo (+21.5%); del lado CALL, con el mismo vencimiento y el mismo WD
  mínimo, falla por −41.6%. La misma ventana de delta no rinde igual de los dos lados.
- **Con DTE corto no hay ventana en absoluto.** En el 4 Sep no pasa nada, a ningún delta,
  de ningún lado.

O sea que `0.10–0.20` no es una región robusta observada: es el rango que se barrió. Lo
que se observó es que la estructura corta arriba y la economía corta abajo, y que dónde
corta abajo depende del lado y del DTE. La ventana efectiva es una consecuencia, no un
parámetro — que es la tesis de la sección 93, ahora con menos evidencia a favor de la que
se creía tener.

# 29. Nueva hipótesis de Delta

La hipótesis actual más sólida es:

Core Candidate Window
0.10 <= Delta <= 0.20
Extended Candidate Window
Explorar:

0.20 < Delta <= 0.25
siempre que el candidato pase:

WD >= WD_min
Credit >= RequiredCredit
POP >= POP_min
Liquidity >= Liquidity_min
Risk <= MaxRisk
Así, Delta 0.22 no se rechaza arbitrariamente.

Se rechaza si la estructura lo hace inviable.

# 30. Crédito — evolución conceptual

El parámetro:

MinCredit = $80
queda descartado como regla universal.

Motivo:

Un crédito nominal de $80 puede ser:

excelente en un vencimiento largo;

insuficiente en otro;

demasiado exigente en un DTE corto;

irrelevante dependiendo del width y riesgo.

Por lo tanto, el crédito debe ser relativo.

# 31. RequiredCredit

La estrategia evolucionó hacia:

Credit >= RequiredCredit
en lugar de:

Credit >= MinCredit
El RequiredCredit depende de:

width;

DTE;

Wall Distance;

requerimiento base de retorno.

> **Ojo con el rol de esto (decidido el 2026-08-24, ver 43.2 y 43.3).** `RequiredCredit`
> **no es el gate económico de la estrategia.** Traducido a `Credit/Width` resulta ser un
> umbral de probabilidad risk-neutral de pérdida, o sea un **piso de riesgo**: exigir más
> crédito es exigir más riesgo. No mide ventaja en ningún punto.
>
> Queda como **piso de viabilidad** —¿paga comisiones, slippage y el capital
> inmovilizado?—, que es una pregunta legítima pero secundaria. El gate económico real es
> el edge test de la sección 43.3, que todavía no está implementado.

# 32. Modelo conceptual de RequiredCredit

Se utiliza:

BaseRR = 0.12
y:

DTEFactor = sqrt(30 / DTE)
Luego se ajusta por Wall Distance.

La intención es:

```text
DTE corto → exigir mayor compensación;

DTE largo → permitir menor crédito absoluto;

menor WD → exigir mayor compensación;

mayor WD → aceptar menor compensación.

```

# 33. WDFactor utilizado en los tests

Tabla de referencia:

| WD | WDFactor |
|---|---|
| 0.20 | 1.20 |
| 0.30 | 1.10 |
| 0.40 | 1.00 |
| 0.50 | 0.95 |
| 0.75 | 0.90 |
| >= 1.00 | 0.85 |

Interpolación entre puntos.

La intención es que el modelo reconozca que una posición más alejada de la wall requiere menor compensación relativa.

# 34. Fórmula de RR requerido

El requerimiento conceptual parte de:

RRreq = BaseRR × DTEFactor × WDFactor
Luego:

RequiredCredit =
Width × RRreq / (1 + RRreq)
Esta formulación convierte un retorno requerido sobre el capital en un crédito mínimo compatible con ese retorno.

# 35. Cushion

El Cushion mide cuánto supera el crédito real al mínimo económico requerido.

Cushion =
(Credit - RequiredCredit)
/
RequiredCredit
Interpretación:

Cushion < 0
    crédito insuficiente

Cushion = 0
    exactamente requerido

Cushion > 0
    crédito superior al mínimo económico
Ejemplo:

Credit = 0.90
RequiredCredit = 0.48

Cushion =
(0.90 - 0.48) / 0.48
= +87.5%
# 36. Importante: Cushion no debe ser el único ranking

Un candidato con Cushion enorme puede estar:

demasiado cerca del wall;

demasiado cerca del Spot;

con Delta elevado;

con liquidez mediocre.

Por eso:

Cushion es un indicador económico, no el criterio único de selección.

# 37. POP

POP continúa siendo una validación.

Parámetro histórico:

POP >= 80%
Debe mantenerse como filtro hasta completar más tests.

La relación aproximada utilizada conceptualmente es:

POP ≈ 1 - abs(Delta)
para una opción individual, aunque GOT debe utilizar el POP calculado por el chain/provider si está disponible.

No debe confundirse:

Delta
con:

probabilidad real de éxito del spread
Son relacionados pero no idénticos.

# 38. Width

Se había establecido:

probar width de 1 strike primero;

permitir hasta 2 strikes.

Width no debe ser necesariamente fijo.

Debe evaluarse porque:

Width
↓
Max Risk
↓
RequiredCredit
cambian conjuntamente.

Una futura versión debe comparar:

Width 1
Width 2
Width 3
...
según disponibilidad de strikes y riesgo máximo.

# 39. Max Risk

Parámetro histórico:

MaxRisk = $400
Debe validarse.

Para un spread:

MaxLoss = Width - Credit
por contrato, multiplicado por 100:

MaxLossUSD =
(Width - Credit) × 100
El candidato debe cumplir:

MaxLossUSD <= MaxRisk
si el MaxRisk se mantiene como límite absoluto.

> **Medido el 2026-08-24: con width 5 sobre TSLA, este filtro elimina absolutamente todo.**
> El maxloss de los 22 candidatos de los dos datasets va de $409 a $480 — ninguno entra en
> $400, incluidos los cinco del 16 Oct PUT que pasan economía y el de la sección 54.
>
> No es que los candidatos sean malos: es que `MaxRisk` en dólares y `Width` en strikes se
> calibraron por separado. En un subyacente de $355 el width de $5 ya produce un maxloss
> por encima del límite antes de mirar el crédito. Las salidas son ir a width 2.5 —y ahí
> el crédito se parte, así que todo el Cushion se recalcula— o mover el riesgo a un
> porcentaje del capital como plantea la sección 72.
>
> Esto convierte a `MaxRisk = $400` en el filtro **más restrictivo de los tres**, y hasta
> el recálculo nadie lo había notado porque se lo evaluaba después del económico y sobre
> candidatos que ya venían filtrados. Ver el Hallazgo 9.

# 40. Liquidez

Todavía falta cerrar formalmente el filtro de liquidez.

El chain proporciona:

Bid

Ask

OI

Call OI

Put OI

Pero todavía no está completamente definida una regla GOT como:

minimum OI
maximum spread %
minimum bid
minimum volume
minimum liquidity score
Esto es una de las definiciones pendientes importantes.

# 41. Bid/Ask y crédito

El crédito utilizado debe estar basado en una metodología consistente.

No debe mezclarse:

mid;

bid;

ask;

crédito teórico;

crédito real de ejecución.

Debe definirse un estándar.

Una alternativa conservadora:

SpreadCredit =
ShortOptionBid - LongOptionAsk
Una alternativa más optimista:

SpreadCredit =
ShortOptionMid - LongOptionMid
GOT debe decidir cuál utiliza como:

filtro;

visualización;

alerta.

La recomendación actual es separar:

Indicative Credit
Conservative Credit
y utilizar el conservador para validar.

# 42. Market Regime

El Net GEX se utiliza para determinar el régimen gamma.

Conceptualmente:

Net GEX > 0
    positive gamma regime

Net GEX < 0
    negative gamma regime
Pero todavía falta definir exactamente cómo el régimen debe modificar:

WD mínimo;

Delta permitido;

RequiredCredit;

diagnóstico;

ranking.

No debería convertirse en una predicción direccional.

# 43. Market Bias

Decisión importante ya tomada:

GOT no debe depender de un Market Bias direccional para decidir PUT vs CALL.

El sistema debe poder evaluar ambos lados.

Puede utilizar diagnóstico para modificar selectividad, pero no debe decir:

```text
Bullish → solo PUT
Bearish → solo CALL

```
sin una validación independiente.

## 43.1 Pero el modelo actual sí tiene un sesgo, y entra por la puerta de atrás

> **Agregado el 2026-08-24**, a partir del recálculo de las secciones 25 y 27.

La decisión de arriba es sobre el **diagnóstico**: GOT no elimina un lado por una
predicción direccional. Eso se sostiene.

Lo que apareció al corregir los datos es que el sesgo se cuela igual, por el filtro
económico:

```text
RequiredCredit = f(Width, DTE, WD)
```

Ninguno de los tres argumentos sabe de qué lado de la cadena está el strike. El umbral es
**simétrico**. Pero la superficie de volatilidad **no lo es**: por skew, en un equity las
puts pagan del orden del doble que las calls equidistantes (sección 27). Aplicar un umbral
simétrico a un mercado asimétrico produce un sesgo estructural hacia el PUT.

Y no es teórico. En los datos de TSLA, con el mismo vencimiento, el mismo `WD_min` y el
mismo `RequiredCredit`:

```text
16 Oct PUT  -> pasan 5 de 6
16 Oct CALL -> pasa  1 de 6
```

**Con esta calibración GOT es un vendedor de puts de hecho**, aunque evalúe los dos lados
como manda esta sección. El sesgo no viene de una opinión sobre el mercado —que es lo que
la sección prohíbe— sino de un umbral que ignora de qué lado está mirando.

## 43.2 Qué es realmente `RequiredCredit`

> **Decidido el 2026-08-24.**

Antes de elegir cómo corregir el sesgo hay que ver qué está midiendo el filtro, porque eso
cambia cuál es la respuesta.

En un vertical, el crédito es el valor risk-neutral del spread. Dividido por el ancho:

```text
Credit / Width = perdida esperada risk-neutral, como fraccion del ancho
```

Es un número entre 0 y 1 que crece con el delta del short leg, y es **la probabilidad que
el mercado le pone a que la operación salga mal**. Traducido el `RequiredCredit` a esas
unidades:

```text
Credit / Width >= RRreq / (1 + RRreq)
```

| Caso | `Credit/Width` requerido |
|---|---|
| DTE 11, WD 0.30 | 0.179 |
| DTE 11, WD 0.60 | 0.156 |
| DTE 56, WD 0.30 | 0.088 |
| DTE 56, WD 0.60 | 0.076 |

De donde salen **dos conclusiones que no estaban vistas**:

**1. El filtro económico es un piso de riesgo, no un test de ventaja.** Dice: *tomá solo
operaciones donde el mercado asigne al menos 7.6% a 17.9% de probabilidad de perder*.
Exigir más crédito es exigir más riesgo, porque en un spread el retorno se compra con
probabilidad de pérdida. No mide edge en ningún momento — mide cuánto riesgo se está
tomando, y pide un mínimo.

**2. Con `WD_min` arriba, el motor entero es una banda de delta.** `WD` decrece
monótonamente con el delta y `Credit/Width` crece con el delta, así que:

```text
WD >= WD_min              -> techo de delta  (estructura)
Credit >= RequiredCredit  -> piso  de delta  (economia)
```

Los dos filtros que la sección 48 presenta como niveles distintos —Structural Gate y
Economic Gate— son, dentro de un vencimiento, **cotas de la misma variable**. Eso explica
la sección 28 sin misterio: la ventana de delta no emerge de nada, es la intersección de
dos cotas sobre delta.

## 43.3 La decisión

**Ninguna de las tres salidas planteadas, porque las tres contestan la pregunta
equivocada.** Preguntar si el umbral debe ser simétrico entre lados presupone que el
umbral mide lo correcto, y no lo mide de ningún lado.

Lo que se hace:

**a. `RequiredCredit` baja de rango: pasa a ser un piso de viabilidad, no el gate
económico.** La pregunta que sí contesta legítimamente es *¿esta operación paga las
comisiones, el slippage y el capital inmovilizado?*. Para eso **se queda simétrico**,
porque es una restricción del negocio y no una afirmación sobre el mercado: al bróker le
da igual de qué lado de la cadena está el strike.

**b. El gate económico de verdad es un test de edge**, que hoy no existe:

```text
P(perdida) implicita en el credito     <- lo que cobra el mercado
        vs
P(perdida) empirica de ese (lado, delta, DTE)   <- lo que pasa en realidad

edge = la diferencia
```

Eso es el VRP, y es **lo único que puede decir si la operación gana plata**. Es lo que RPF
ya hace con su tabla POP calibrada, y lo que a GOT le falta por completo.

**c. Con el edge test, la pregunta del skew se disuelve en vez de contestarse.** Un test
que compara probabilidad implícita contra probabilidad empírica **es side-aware por
construcción y sin un solo parámetro nuevo**: si las calls pagan menos a delta igual pero
también fallan menos a delta igual, el edge se empareja solo; y si pagan menos y fallan lo
mismo, el lado call queda descartado por los datos y no por una constante que alguien
eligió. El skew deja de necesitar tratamiento explícito porque queda absorbido en el lado
empírico de la comparación.

Por eso la salida 2 —un `BaseRR` por lado— es la peor de las tres: hornea la forma de una
superficie de volatilidad dentro de una constante, donde nadie la va a volver a mirar.

## 43.4 Qué NO se hace, y por qué

**No se declara put-only, y no se toca ningún parámetro todavía.** El motivo es que toda la
evidencia del sesgo viene de **un símbolo, un día, dos vencimientos** — y de un símbolo con
una superficie atípica.

TSLA tiene demanda especulativa de calls que le levanta el ala derecha; SPY y QQQ, que son
el universo declarado en la sección 4, tienen put skew fuerte y ala de call plana o
declinante. Son formas distintas. La asimetría medida acá:

```text
TSLA: (Credit/Width) / delta  ->  PUT ~0.72-0.94   CALL ~0.34-0.67
```

no es trasladable, y calibrar un parámetro por lado con esta muestra sería exactamente lo
que la sección 81 prohíbe: *optimizar sobre un único símbolo y considerarlo definitivo*.

**Predicción falsable, para hacer antes que cualquier otra cosa:** correr el mismo sweep
sobre SPY y QQQ. Si el sesgo es de la superficie de TSLA y no del modelo, la brecha entre
lados tiene que ser **marcadamente menor** que la de arriba. Si en cambio se repite igual
en los tres, entonces es del modelo y hay que atacarlo antes del backtest.

Es barato: es el mismo `gex-strikes.ps1` con otro símbolo.

> **Corrido el mismo día. La predicción se quedó corta: el signo se invierte.**
>
> Midiendo cuánto paga cada lado por unidad de delta, `(Credit/Width) / |delta|`, sobre los
> mismos dos vencimientos en los tres símbolos:
>
> | Símbolo | PUT | CALL | CALL/PUT |
> |---|---|---|---|
> | SPY | 0.51 | 0.92 | **1.81** |
> | QQQ | 0.55 | 0.86 | **1.57** |
> | TSLA | 0.84 | 0.54 | **0.65** |
>
> En el universo declarado el filtro económico simétrico **sesga hacia CALL**, no hacia PUT.
> Verificado también con mid en vez de bid/ask, para descartar el horario de captura.
> Detalle y mecanismo en
> [el hallazgo](hallazgos/2026-08-24-sesgo-por-lado-spy-qqq.md).
>
> Refuerza esta sección más de lo que se esperaba: la salida 2 —un `BaseRR` por lado
> calibrado sobre TSLA— no habría sido un parámetro subóptimo, habría tenido **el signo
> cambiado** para los símbolos que la estrategia opera.

## 43.5 Estado interino

> **Reescrita el 2026-08-24**, unas horas después de la versión original. Esa versión decía
> que GOT queda *"put-biased por construcción, y declarado"*, y era falso: se había medido
> sobre TSLA, cuya superficie va al revés que la del universo declarado. Ver
> [el hallazgo](hallazgos/2026-08-24-sesgo-por-lado-spy-qqq.md).

Hasta que exista el edge test:

* **GOT tiene un sesgo por lado, y su dirección depende del símbolo.** Sobre SPY y QQQ
  favorece al CALL (paga ~1.6–1.8x por unidad de delta); sobre TSLA favorece al PUT. No es
  una propiedad del motor: es la pendiente local de la superficie de volatilidad,
  atravesando un umbral que no la mira.
* **Por eso el sesgo no se declara como constante ni se corrige con un factor.** No hay un
  número que declarar — cambia por símbolo, por vencimiento y en el tiempo. Se deja a la
  vista y se mide.
* Toda corrida mide **frecuencia de oportunidades por lado y por símbolo**, nunca agregada.
  Un motor que emite 90% de un lado y lo reporta como "12 alertas" está escondiendo el dato
  principal, y agregando los símbolos el sesgo de uno cancela el del otro y desaparece de la
  vista.
* **Los dos lados se siguen evaluando y registrando siempre.** Es la muestra que después
  calibra el edge test. Apagar un lado ahora garantiza no tener nunca con qué decidir si
  había que apagarlo — y como se vio, el lado que parecía descartable era el equivocado.
* **Las calibraciones se hacen sobre SPY y QQQ**, que es el universo de la sección 4. TSLA
  queda como caso de control: es útil tener un símbolo con la superficie invertida para
  detectar exactamente esta clase de error.

# 44. Alert Engine

La versión actual está pensada como alert-only.

El motor monitorea:

Entry Delta;

chain;

estructura;

condiciones;

aparición de candidato válido.

Cuando aparece una oportunidad:

ALERT
La alerta debe incluir como mínimo:

símbolo;

Spot;

vencimiento;

DTE;

side;

short strike;

long strike;

Delta;

WD;

Credit;

RequiredCredit;

Cushion;

POP;

Max Risk;

Call Wall;

Put Wall;

ZGL;

Expected Move;

Market Diagnostic;

motivo de aprobación.

# 45. Alertas por WebSocket

El sistema ya contempla monitoreo de Entry Delta mediante streaming/websocket.

La idea es:

Market Data
    ↓
Update Chain
    ↓
Recalculate Candidate
    ↓
Run Validations
    ↓
Candidate appears valid
    ↓
Alert
La alerta no implica ejecución.

# 46. Telegram

V3 estableció alertas destacadas en pantalla y envío a usuarios de Telegram.

La arquitectura debe evitar enviar repetidamente la misma alerta mientras el candidato permanece válido.

Debe existir una lógica de:

New Candidate
Candidate Changed
Candidate Invalidated
Candidate Re-entered
Esto todavía necesita formalización.

# 47. Flujo completo

> **Redibujado el 2026-08-24.** El dibujo anterior tenía `Credit >= RequiredCredit` como el filtro
> económico y `WD >= WD_min` como un filtro estructural independiente, uno después del otro. Las
> dos cosas se cayeron el mismo día: `RequiredCredit` no es el gate económico sino un piso de
> riesgo (43.2), y los dos filtros no son etapas independientes — dentro de un vencimiento son las
> **dos cotas de la misma variable**, el delta (43.2). Tenía además `MaxRisk` como una etapa suelta,
> cuando está acoplado a `Width` y con la calibración de hoy elimina el 100% de los candidatos (39).
> Se redibuja para que el diagrama diga lo que la estrategia decidió — **incluido lo que le falta**.

Marcas del diagrama: `[OK]` definido · `[~]` provisional o sin calibrar · `[ ]` no implementado ·
`[X]` reprobado con la calibración actual.

```text
                         MARKET DATA
              cadena + GEX + spot + IV                    [~] freshness sin definir (68)
                              |
                              v
   NIVEL 1 - MARKET GATE                        ¿el entorno permite buscar operaciones?
        MARKET DIAGNOSTIC                                 [~] z-score provisional (83)
        FAVORABLE  /  SELECTIVE  /  NO OPERATE            [ ] SELECTIVE sin cerrar (64)
                              |                           [ ] NO OPERATE sin cerrar (65)
            NO OPERATE -------+ corta acá
                              |
                              v
   NIVEL 2 - ESTRUCTURA                         ¿dónde estaría permitido vender?
        SPOT   ZGL   CALL WALL   PUT WALL   GEX           [OK] ZGL, walls
        del agregado de la cadena:                        [~] Sell Zones conceptual (61)
        UNA VEZ POR SÍMBOLO                               [ ] conflicto ZGL vs wall (62)
                              |
                              v
        SELL ZONES:   PUT ZONE   |   CALL ZONE
                              |
                              v
   POR CADA VENCIMIENTO REGULAR CON DTE <= 60   alcance inicial: sin weeklies,
        EXPECTED MOVE del vencimiento           sin 0DTE. Son 2 por símbolo el
                              |                 90% de los días (1 a 3)
                              v
        (muro - spot) / EM  <-- lo único que la estructura aporta
                                y el delta no replica. El muro es
                                del agregado; el EM, del vencimiento
                              |
               +--------------+--------------+
               |                             |
               v                             v
             PUT                           CALL           los dos lados SIEMPRE (43.5)
               |                             |            se miden por separado,
               +--------------+--------------+            nunca agregados
                              |
                              v
   NIVEL 3 - LA VENTANA DE DELTA                una sola variable, dos cotas (43.2)

        delta  0.05 ------------------------------------------------> 0.35
                      [ piso ]                    [ techo ]
                      Credit >= RequiredCredit    WD >= WD_min
                      viabilidad del negocio:     estructura: distancia al muro
                      comisiones, slippage,       en unidades de Expected Move
                      capital inmovilizado
                      [OK] simétrico entre        [~] WD_min = 0.20 provisional
                           lados, a propósito         (es el corte que decide, 98)
                      [~] sin calibrar (43.3)

        banda vacía -> no hay candidato en ese (vencimiento, lado). No es un error.
                              |
                              v
   NIVEL 4 - CALIDAD DE LA OPCIÓN               ¿el candidato es ejecutable?
        OI   bid/ask   liquidez   slippage                [ ] sin definir (40, 41, 69)
                              |
                              v
   NIVEL 5 - RIESGO Y ANCHO                     Width y MaxRisk se calibran JUNTOS
        MaxLoss = (Width - Credit) x 100                  [X] MaxRisk 400 con width 5
        MaxLoss <= MaxRisk                                    elimina el 100% (39)
                              |                           [ ] o pasar a % del capital
                              v
   NIVEL 6 - EDGE TEST                          ¿la operación tiene ventaja?
                                                          <-- EL GATE ECONÓMICO
        P(pérdida) implícita en el crédito  =  Credit / Width
                            vs
        P(pérdida) empírica de ese (lado, delta, DTE)
        edge = implícita - empírica  >  0                 [ ] NO IMPLEMENTADO (43.3)
                              |                           [ ] falta la tabla empírica
                              v
        RANK CANDIDATES                                   [ ] sin criterio cerrado (49-51)
                              |
                              v
        BEST CANDIDATE
                              |
                              v
        ALERT    new | changed | invalidated | re-entered [ ] sin formalizar (46)
        alerts-only: la alerta no implica ejecución
                              |
                              v
        REGISTRO de frecuencia por lado y por símbolo (43.5)
```

**Tres cosas que este dibujo dice y el anterior no.**

**1. Los niveles 3 y 6 no son el mismo tipo de cosa, aunque los dos hablen de plata.** El nivel 3
es un piso sobre el delta: pide crédito suficiente para que la operación tenga sentido como
negocio, y por eso es simétrico entre lados. El nivel 6 no es una tercera cota sobre el delta —
es la única etapa del flujo que **mira afuera de la cadena de hoy**. Todo lo que va del nivel 2 al
5 se deriva de la cadena que se acaba de bajar; el edge test necesita un dato que la cadena no
tiene, que es qué pasó históricamente con ese lado, ese delta y ese DTE. De ahí que sea el último
gate y no un ajuste de los anteriores, y de ahí que sea el único que puede decir si la operación
gana plata.

**2. La ventana de delta no emerge: se construye.** Dibujar `WD >= WD_min` y
`Credit >= RequiredCredit` como dos filtros en serie hacía parecer que la banda de delta 0.10–0.20
de la sección 28 era un descubrimiento. No lo es — es la intersección de un techo y un piso
puestos sobre el mismo eje. Dibujarlos sobre una sola recta es lo que impide volver a leer esa
banda como un resultado, y es lo que anticipa que barrer `WD_min` y `Delta_max` por separado va a
dar una superficie degenerada.

**3. El flujo se recorre por `(símbolo, vencimiento regular ≤ 60 DTE, lado)` y las salidas no se
suman.** La bifurcación PUT/CALL está arriba de todo a propósito: los dos lados se evalúan y se
registran siempre, y el conteo de alertas se reporta desagregado. Agregado, el sesgo de un símbolo
cancela el del otro y desaparece justo el dato que hay que mirar (43.5).

## 47.1 El alcance inicial del bucle

> **Definido el 2026-08-24.**

El flujo recorre, por símbolo, sus **vencimientos regulares con DTE ≤ 60**. Es un alcance de
arranque y no una decisión cerrada: el tratamiento del DTE sigue abierto (56.5, 57), y de paso
este corte deja sin evaluar el bucket `61–90` que la 56.5 lista. Quedan afuera los **weeklies** y
el **0DTE**.

"Regular" es el vencimiento estándar mensual —el tercer viernes—, que es lo que Tastytrade devuelve
como `expiration-type: "Regular"`; los demás son `Weekly`, `Quarterly` o `Mini`. Reproducible con
[`scripts/vencimientos_regulares.py`](scripts/vencimientos_regulares.py).

**El bucle es corto: son 2 vencimientos por símbolo el 90% de los días**, 1 el 4.4% y 3 el 5.5%
(medido sobre 365 días de observación consecutivos). Con el universo de calibración de la 43.5
—SPY y QQQ— y los dos lados, una corrida evalúa del orden de **ocho combinaciones**, no cientos.
Eso tiene dos caras: hace barata la corrida transversal, y hace que la frecuencia de oportunidades
por lado y por símbolo se mida sobre una muestra chica. Con ocho celdas, un cero no es evidencia de
nada, y una corrida por día tarda meses en acumular estadística. Es un argumento fuerte a favor de
la captura periódica antes que de la captura puntual.

**La estructura viene de una cadena más ancha que los candidatos, y eso es deliberado.** Los muros,
el ZGL y el GEX salen del agregado de `/App/Gex/Analysis`, que dentro de sus 60 DTE **incluye
weeklies y 0DTE**. O sea que el 0DTE sí entra al flujo —pesa en dónde están los muros— pero no
genera candidatos. No es una inconsistencia: el muro es una propiedad del mercado y no del
vencimiento que uno vende. Pero es una asimetría que hay que tener declarada, porque significa que
la estructura sobre la que GOT decide puede moverse por gamma que GOT nunca va a operar.

**El Expected Move es lo que obliga a que el bucle sea por vencimiento.** `WD = (muro − spot)/EM`
necesita un EM, y el EM es `spot × IV_atm × sqrt(t)`: **no está definido para el agregado**, que no
tiene un `t` — así lo declara el JSON de GEX, que deja esa fila vacía a propósito en vez de
rellenarla con el vencimiento más cercano. El muro es el mismo para todos los vencimientos; el WD
de ese mismo muro, no. Es el mecanismo por el que dos vencimientos con idéntica estructura dan
ventanas de delta distintas, que es exactamente lo que mostraron los datasets del 16 Oct y el 4 Sep
(53 a 55).

**Ojo con la base empírica del v5: el 4 Sep es un weekly.** Los dos vencimientos sobre los que se
validó todo —`data/2026-08-24/`— son `2026-09-04` (DTE 11) y `2026-10-16` (DTE 53–56). El segundo
es el tercer viernes de octubre y entra al bucle; **el primero es el primer viernes de septiembre,
o sea un weekly, y este alcance lo excluye**. El tercer viernes de ese mes era el 18.

Eso no invalida nada de lo medido: el contraste DTE 11 contra DTE 53 sigue mostrando lo que muestra
sobre el crédito requerido, y el error de columna del hallazgo del 24 se corrigió sobre los dos por
igual. Lo que sí significa es que **la mitad de la evidencia del v5 viene de un tipo de vencimiento
que el flujo, como quedó definido, no recorre**. La próxima captura —la que la 43.4 pide sobre SPY
y QQQ con book vivo— debería usar vencimientos regulares, o el alcance y la evidencia van a seguir
apuntando a cosas distintas.

**Lo que el diagrama deja a la vista es cuánto falta.** De los seis niveles hay uno definido
(el 2), dos provisionales (1 y 3), uno vacío (4), uno reprobado con su calibración actual (5), y
el que decide si esto gana plata sin implementar (6). El flujo no está incompleto en los bordes:
le falta el centro.

# 48. Arquitectura de decisión recomendada

> **Errata del 2026-08-24.** Estos cuatro niveles quedaron superados por el flujo redibujado de la
> sección 47, que tiene seis. Dos cambios de fondo: el **Nivel 4 — Economic Gate** de acá no es un
> gate económico (`RequiredCredit` es un piso de riesgo, 43.2) y el gate económico real —el edge
> test— no figura en esta lista; y los niveles 2 y 4 **no son independientes**: dentro de un
> vencimiento son el techo y el piso de la misma variable, el delta (43.2). Se deja el texto como
> registro de la arquitectura que se pensó primero.

La lógica debe dividirse en cuatro niveles.

Nivel 1 — Market Gate
Pregunta:

¿El entorno permite buscar operaciones?

Resultado:

```text
FAVORABLE
SELECTIVE
NO OPERATE

```
Nivel 2 — Structural Gate
Pregunta:

¿Dónde está permitido vender?

Utiliza:

Put Wall;

Call Wall;

ZGL;

Expected Move;

GEX;

WD.

Nivel 3 — Option Gate
Pregunta:

¿Qué opciones concretas cumplen?

Utiliza:

Delta;

POP;

OI;

bid/ask;

credit;

width;

max risk.

Nivel 4 — Economic Gate
Pregunta:

¿La compensación justifica el riesgo?

Utiliza:

RequiredCredit;

Cushion.

# 49. Candidate Ranking

Esta es probablemente la pieza conceptual más importante que falta cerrar.

Después de todos los filtros puede haber múltiples candidatos válidos.

Ejemplo:

Delta .12
WD .75
Credit .50

Delta .15
WD .50
Credit .65

Delta .18
WD .33
Credit .75

Delta .20
WD .25
Credit .90
Todos pueden pasar.

GOT necesita decidir:

¿Cuál es el mejor?

No alcanza con:

maximum credit
ni con:

maximum cushion
ni con:

minimum delta
Debe existir una función de utilidad o ranking.

# 50. No usar un "score" arbitrario

Una decisión filosófica importante del proyecto fue evitar sistemas de scoring arbitrarios.

Por lo tanto, el ranking debería preferentemente derivarse de variables económicamente interpretables:

WD;

Cushion;

Delta;

POP;

Max Risk;

liquidity.

La futura función debería ser transparente.

# 51. Posible criterio de ranking

Una hipótesis a probar:

Primero ordenar por seguridad estructural:

WD
Luego exigir economía mínima:

Cushion >= CushionMin
Y dentro de los candidatos económicamente aceptables seleccionar el de mejor relación:

Credit / RequiredCredit
o una métrica similar.

Otra alternativa:

maximize Cushion
subject to WD >= WD_min
and POP >= POP_min
and Risk <= MaxRisk
Esto debe probarse.

# 52. Una posible nueva métrica

Podría estudiarse:

EconomicEfficiency =
Credit / MaxLoss
o:

RequiredReturnCoverage =
Credit / RequiredCredit
La segunda es particularmente útil porque ya está alineada con la filosofía del modelo.

# 53. Qué se demostró con los datasets TSLA

> **Hallazgo 3 reescrito el 2026-08-24** y agregados el 8, 9 y 10. Ver
> [el hallazgo](hallazgos/2026-08-24-credito-call-columna-equivocada.md).

Hallazgo 1
El crédito absoluto no sirve como regla universal.

Hallazgo 2
DTE modifica radicalmente el crédito necesario.

Hallazgo 3
Un DTE corto puede no pagar de ningún lado.

En el 4 Sep (DTE 11) fallan los cinco candidatos PUT y los cinco CALL. La versión original
de este hallazgo decía lo contrario —*"el mismo DTE puede tener un lado excelente y otro
malo"*— y salía de las tablas de CALL con la columna equivocada. Corregido, no agrega una
dimensión nueva sino que refuerza al 2: lo que manda es el DTE, no el lado.

Hallazgo 4
Delta no determina por sí solo la calidad.

Hallazgo 5
Wall Distance puede eliminar un candidato económicamente atractivo.

Hallazgo 6
Un crédito bajo puede ser válido si:

DTE alto
+
WD alto
+
RequiredCredit bajo
Hallazgo 7
Un crédito relativamente alto puede ser insuficiente si:

DTE corto
+
WD menos favorable

Hallazgo 8
El lado sí importa, pero por skew y no por estructura.

En el 16 Oct pasan 5 de 6 candidatos PUT y 1 de 6 CALL. A delta equivalente, las puts
pagan aproximadamente el doble que las calls. Eso no es una propiedad de ese vencimiento:
es la asimetría normal de la superficie de volatilidad de un equity. Consecuencia de
diseño en la sección 43.1.

Hallazgo 9
Los tres filtros duros juntos pueden dejar cero candidatos.

Aplicando `WD >= 0.20`, `Credit >= RequiredCredit` y `MaxLoss <= MaxRisk` a la vez, **los
22 candidatos de los dos datasets quedan afuera**. Los cinco puts del 16 Oct que pasan
economía violan `MaxRisk = $400`, incluido el de la sección 54. Un filtro que nunca
dispara es indistinguible de uno mal calibrado hasta que se cuenta cuántas veces dispara.

Hallazgo 10
Los parámetros de riesgo no son independientes de la escala del subyacente.

`MaxRisk` está en dólares y `Width` en strikes. En un subyacente de $355, el width mínimo
de la cadena ya produce un maxloss por encima del límite. Los dos parámetros hay que
calibrarlos juntos, o expresar el riesgo como fracción del capital (sección 72).
# 54. Ejemplo clave — 16 Oct PUT

Strike 315
Delta ≈ 0.1925
WD ≈ 0.251
Credit = $0.90
El crédito parece pequeño nominalmente.

Pero:

RequiredCredit ≈ $0.48
Por lo tanto:

Cushion ≈ +89%
Conclusión:

$0.90 no es "poco" en términos de esta operación.

> **Verificado el 2026-08-24 contra el dataset.** El crédito y el delta son correctos
> (`pcsCredit_w5` = 0.90, `putDelta` = −0.1925), y el Cushion recalculado da +96.4% con la
> interpolación exacta del `WDFactor` — el +89% del texto usaba un `RequiredCredit` de
> $0.48 contra los $0.4584 que da la tabla de la sección 33. La conclusión no cambia.
>
> **Pero este candidato no es operable con los parámetros actuales**: su maxloss es
> `(5 − 0.90) × 100 = $410`, por encima de `MaxRisk = $400`. Sigue siendo el mejor ejemplo
> de por qué el crédito tiene que ser relativo, que es para lo que está esta sección, pero
> no es un trade que el motor pudiera proponer hoy. Ver la sección 39 y el Hallazgo 9.

# 55. Ejemplo clave — 4 Sep PUT

Strike 337.5
Delta ≈ 0.2103
WD ≈ 0.292
Credit = $0.86
Aunque el crédito sea mayor que en el ejemplo anterior:

RequiredCredit ≈ $0.96
Entonces:

Cushion < 0
Conclusión:

$0.86 puede ser insuficiente.

Esto demuestra definitivamente por qué MinCredit = $80 no puede ser universal.

# 56. Qué NO está cerrado todavía
## 56.1 RequiredCredit

La estructura actual es prometedora, pero debe validarse sobre muchos más:

símbolos;

DTE;

regimes;

widths;

WD.

## 56.2 WD mínimo

Actualmente:

WD_min = 0.20
Es un parámetro razonable, pero todavía no probado estadísticamente.

Debe testearse:

0.10
0.15
0.20
0.25
0.30
0.40
y medir:

frecuencia de oportunidades;

retorno;

drawdown;

tasa de éxito.

## 56.3 Delta Window

Debe testearse más ampliamente:

0.05
0.08
0.10
0.12
0.15
0.18
0.20
0.22
0.25
0.30
No asumir de antemano que 0.20 es el límite.

## 56.4 Width

Debe probarse:

1 strike
2 strikes
3 strikes
4 strikes
respetando Max Risk.

## 56.5 DTE

Debe determinarse qué rangos son económicamente eficientes.

Por ejemplo:

7–14
15–21
22–30
31–45
46–60
61–90
El modelo de RequiredCredit debe comportarse correctamente en todos.

# 57. Falta definir el tratamiento de DTE

Actualmente existe un factor:

sqrt(30 / DTE)
Pero falta comprobar si esa relación es realmente la correcta.

Podría resultar que:

sqrt()
sea demasiado agresiva o demasiado suave.

Esto debe validarse empíricamente.

# 58. Falta definir la relación Width / RequiredCredit

El modelo actual utiliza:

RequiredCredit =
Width × RRreq / (1 + RRreq)
Esto es razonable conceptualmente.

Pero debe probarse si el retorno requerido debe mantenerse proporcional al width.

# 59. Falta definir el efecto de gamma regime

Hay que estudiar:

Positive GEX
¿Conviene:

menor WD?

Delta más alto?

RequiredCredit menor?

Negative GEX
¿Conviene:

mayor WD?

Delta más bajo?

RequiredCredit mayor?

Esto debe salir del backtest, no de una intuición.

# 60. Falta definir el efecto de Expected Move

Actualmente Expected Move normaliza WD.

Debe verificarse:

si el EM diario/total correcto es el utilizado;

cómo tratar expirations con EM muy grande;

si EM debe ser bidireccional;

si debe usarse EM implícito puro o una medida ajustada.

# 61. Falta cerrar la definición de Sell Zones

La definición actual:

PUT  < PutWall
CALL > CallWall
es demasiado simple para ser la versión definitiva.

Hay que determinar:

cuánto debe separarse de wall;

relación con ZGL;

relación con Expected Move;

si la zona puede cruzar ZGL;

cómo tratar wall muy cercana al Spot;

cómo tratar wall muy lejana.

# 62. Falta definir conflictos entre ZGL y Wall

Ejemplo:

Spot
ZGL
Put Wall
pueden estar ordenados de formas diferentes.

GOT necesita reglas explícitas para casos como:

PutWall > ZGL
o:

CallWall < ZGL
La lógica debe ser estructural, no depender de casos particulares.

# 63. Falta definir cuándo evaluar PUT y CALL

La recomendación actual:

Evaluar ambos lados siempre.

El Market Diagnostic puede cambiar la severidad de los filtros, pero no debería eliminar un lado únicamente por una predicción direccional.

# 64. Falta definir Selective Mode

SELECTIVE todavía necesita reglas concretas.

Por ejemplo podría exigir:

WD >= 0.30
en lugar de:

WD >= 0.20
o:

Cushion >= +20%
Pero esto todavía debe probarse.

# 65. Falta cerrar NO OPERATE

Debe existir una lista inequívoca de hard stops.

Ejemplos potenciales:

IV inválida
DTE fuera de rango
chain incompleta
wall no confiable
EM inválido
liquidez insuficiente
MaxRisk excedido
ningún candidato válido
market diagnostic extreme
# 66. Falta definir calidad de Gamma Wall

No toda wall tiene la misma calidad.

Debe evaluarse:

magnitud de GEX;

concentración;

distancia respecto del segundo máximo;

OI;

estabilidad temporal.

Un posible concepto futuro:

WallStrength
pero debe evitarse convertirlo automáticamente en un score opaco.

# 67. Falta validar estabilidad temporal

Un candidato puede aparecer durante segundos y desaparecer.

GOT necesita definir:

MinimumPersistence
Ejemplo conceptual:

candidate valid for N seconds
antes de emitir alerta.

También:

re-entry cooldown
para evitar spam.

# 68. Falta definir "freshness" del chain

Una alerta debe saber:

timestamp structure
timestamp option quote
timestamp spot
No debería comparar datos de momentos muy diferentes.

# 69. Falta definir ejecución realista

Aunque GOT sea alerts-only, el modelo debe aproximar ejecución real.

Debe probar:

Bid/Ask
Mid
Slippage
Commission
Fees
El crédito económico debe ser neto de costes si se busca evaluar rentabilidad real.

# 70. Falta definir salida

La estrategia original tenía:

Exit at 50% profit
Pero la versión V5 todavía no tiene cerrada la lógica de salida.

Debe definirse:

profit target;

stop loss;

expiration management;

DTE exit;

adjustment/no adjustment;

early close;

gamma wall movement;

alert de invalidación.

# 71. Falta definir gestión después de entrada

Aunque GOT inicialmente sea alerts-only, para backtesting debemos saber qué sucede después.

Hay que definir:

Entry
    ↓
Monitor
    ↓
Exit condition
Sin esto no existe un backtest completo de estrategia.

# 72. Falta definir capital allocation

El parámetro histórico:

MaxRisk = $400
puede ser demasiado absoluto.

Para generalizar entre símbolos convendría estudiar:

RiskPerTrade = % del capital
y eventualmente:

MaxPortfolioRisk
# 73. Falta definir correlación

Si GOT detecta simultáneamente:

SPY PUT;

QQQ PUT;

TSLA PUT;

no son tres riesgos independientes.

En una futura versión debería existir:

portfolio exposure
aunque no sea necesario para V5.

# 74. Backtesting necesario

Antes de cerrar la estrategia hay que construir un dataset histórico con:

Spot;

DTE;

IV;

IV Rank;

RV;

GEX;

walls;

ZGL;

Expected Move;

option chain;

bid/ask;

OI;

Delta;

spreads;

subsequent price path.

# 75. Backtest mínimo recomendado

Separar por:

Símbolo

```text
SPY
QQQ
TSLA
AAPL

```
otros
DTE
7–14
15–30
31–45
46–60
61–90
Gamma regime
positive
negative
neutral
Side

```text
PUT
CALL

```
Delta
0.05–0.10
0.10–0.15
0.15–0.20
0.20–0.25
0.25–0.30
# 76. Métricas que debe medir el backtest

No solamente win rate.

Debe medir:

Win Rate
Loss Rate
Average Credit
Average RequiredCredit
Average Cushion
Average WD
Average Delta
Average DTE
Average MaxLoss
Return on Risk
Return on Capital
Profit Factor
Expectancy
Max Drawdown
Average Holding Time
Tail Losses
También:

Opportunity Frequency
porque una estrategia puede ser excelente pero generar muy pocas oportunidades.

# 77. Expectancy

Una métrica fundamental:

Expectancy =
WinRate × AvgWin
-
LossRate × AvgLoss
Debe calcularse después de costes.

# 78. Profit Factor

ProfitFactor =
GrossProfit / GrossLoss
Es más útil que mirar solamente win rate.

# 79. Sensitivity Analysis

Cada parámetro importante debe someterse a sensibilidad:

WD_min
Delta_min
Delta_max
DTE range
BaseRR
MaxRisk
Width
POP_min
Liquidity thresholds
El objetivo es detectar si la estrategia funciona únicamente con un número exacto.

Si:

WD = 0.20
funciona bien pero:

WD = 0.21
colapsa, probablemente estamos overfitting.

Buscamos regiones robustas.

# 80. Robustez

La estrategia debería ser estable ante pequeñas variaciones.

Ejemplo:

DeltaMax = 0.20
debería producir resultados similares a:

DeltaMax = 0.21
0.22
0.23
siempre que la estructura siga controlando el riesgo.

# 81. Lo que NO debemos hacer

No debemos:

optimizar todos los parámetros sobre el mismo dataset;

elegir el mejor parámetro y considerarlo definitivo;

usar un único símbolo;

usar solamente un régimen;

usar solamente un vencimiento;

mirar solamente win rate;

ignorar slippage;

ignorar bid/ask;

elegir strikes retrospectivamente;

introducir parámetros después de ver resultados sin hacer out-of-sample.

# 82. Walk-forward

La validación final debería ser:

```text
TRAIN
    ↓
CALIBRATE
    ↓
VALIDATE
    ↓
OUT-OF-SAMPLE

```
Los parámetros se calibran en un período y se prueban en otro.

# 83. Parámetros actualmente definidos / provisionales


| Parámetro | Estado |
|---|---|
| Alerts-only | Definido |
| No Market Bias obligatorio | Definido |
| Put/Call evaluation | Definido — ambos lados siempre; el sesgo por lado **depende del símbolo** (43.5) |
| Simetría del filtro económico entre lados | **Resuelto** (43.3): se queda simétrico, porque baja a piso de viabilidad |
| RequiredCredit como gate económico | **Reprobado** (43.2): es un piso de riesgo, no un test de ventaja |
| Edge test (implícita vs empírica) | **Decidido, no implementado** — el gate económico real (43.3) |
| Market Diagnostic | Definido conceptualmente |
| Z-score thresholds | Provisional |
| ZGL | Definido |
| Gamma Walls | Definido |
| Sell Zones | Definido conceptualmente |
| WD formula | Definido |
| WD_min = 0.20 | Provisional |
| Delta core 0.10–0.20 | Provisional |
| Delta extended ~0.25 | Hipótesis |
| MinCredit fijo | Descartado |
| RequiredCredit | Definido conceptualmente |
| BaseRR = 0.12 | Provisional |
| DTEFactor sqrt(30/DTE) | Provisional |
| WDFactor | Provisional |
| Cushion | Definido |
| POP >= 80% | Provisional |
| MaxRisk $400 | **Reprobado con width 5** — elimina el 100% de los candidatos (39) |
| Width | Pendiente de optimización — **acoplado a MaxRisk**, no se calibra solo |
| Liquidity | Pendiente |
| Slippage | Pendiente |
| Exit | Pendiente |
| Candidate Ranking | Pendiente |
| Persistence | Pendiente |
| Portfolio risk | Futuro |

# 84. Arquitectura recomendada para cerrar V5

> **Errata del 2026-08-24.** La cadena de módulos se sostiene como descomposición, pero dos de sus
> piezas cambiaron de contenido con el flujo redibujado de la sección 47: `StructuralValidator` y
> `EconomicValidator` no son dos filtros en serie sino las dos cotas de la ventana de delta (43.2),
> y el gate económico de verdad —el edge test— **no tiene módulo en esta lista**. Necesita uno
> propio, con la tabla de probabilidad empírica por (lado, delta, DTE) como dependencia; es el
> análogo del `pop_calibration.json` de RPF.

La versión final debería tener estos módulos:

MarketDataProvider
        ↓
MarketDiagnosticEngine
        ↓
MarketStructureEngine
        ↓
SellZoneEngine
        ↓
CandidateGenerator
        ↓
StructuralValidator
        ↓
OptionValidator
        ↓
EconomicValidator
        ↓
CandidateRanker
        ↓
AlertEngine
# 85. Candidate Generator

Debe generar candidatos a partir de una ventana Delta:

0.10
0.12
0.15
0.18
0.20
0.22
0.25
No necesariamente usar todos en producción.

La función es explorar el espacio.

# 86. Structural Validator

Debe verificar:

correct side
inside Sell Zone
outside Gamma Exclusion Zone
WD >= WD_min
y eventualmente:

ZGL relationship
Expected Move relationship
WallStrength
# 87. Option Validator

Debe verificar:

Delta

```text
POP
OI

```
Bid
Ask
Spread
Width
MaxRisk
# 88. Economic Validator

> **Errata del 2026-08-24.** Lo que describe esta sección es el **piso de viabilidad**, no el gate
> económico: `Credit >= RequiredCredit` resultó ser un piso de riesgo y no un test de ventaja
> (43.2). El validador económico de verdad compara probabilidad implícita contra empírica y
> todavía no está especificado (43.3, nivel 6 de la sección 47).

Debe calcular:

DTEFactor
WDFactor
RRreq
RequiredCredit
Cushion
y validar:

Credit >= RequiredCredit
# 89. Candidate Ranker

Debe tomar únicamente candidatos que hayan pasado todos los hard filters.

Después debe seleccionar el mejor balance entre:

Safety
+
Economics
+
Liquidity
Esto debe ser transparente.

# 90. Alert Engine

Una alerta solamente debe emitirse cuando:

Market Gate = PASS
AND
Structural Gate = PASS
AND
Option Gate = PASS
AND
Economic Gate = PASS
AND
Candidate Ranker = candidate
# 91. Estado conceptual actual

La estrategia puede resumirse actualmente así:

```text
MARKET
  │
  ├── Diagnostic
  │
  ▼
STRUCTURE
  │
  ├── Spot
  ├── ZGL
  ├── Call Wall
  ├── Put Wall
  ├── GEX
  └── Expected Move
  │
  ▼
SELL ZONES
  │
  ├── PUT
  └── CALL
  │
  ▼
CANDIDATES
  │
  └── Delta 0.10–0.25
  │
  ▼
STRUCTURAL FILTER
  │
  └── WD >= threshold
  │
  ▼
OPTION FILTER
  │
  ├── POP
  ├── Liquidity
  ├── Width
  └── Max Risk
  │
  ▼
ECONOMIC FILTER
  │
  ├── RequiredCredit
  └── Cushion
  │
  ▼
RANK
  │
  ▼
ALERT

```
# 92. Mi opinión sobre el estado de la estrategia

Estamos mucho más cerca de una estrategia cerrada que al comienzo.

La parte más importante ya está resuelta conceptualmente:

GOT no debe buscar simplemente opciones con alto crédito.

Debe buscar:

opciones estructuralmente seguras cuyo crédito sea suficiente para compensar el riesgo específico de esa oportunidad.

Eso es una diferencia fundamental.

La combinación:

Wall Distance
+
RequiredCredit
+
Cushion
es probablemente la parte más original y más prometedora de la estrategia.

# 93. La principal hipótesis que queda por demostrar

La gran pregunta ahora ya no es:

"¿Qué Delta usamos?"

La pregunta correcta es:

¿Existe una región estable de WD × Delta × DTE donde el retorno esperado sea consistentemente positivo?

Si la respuesta es sí, GOT habrá encontrado una verdadera estructura de decisión.

El Delta podría entonces ser una consecuencia del equilibrio entre:

probabilidad
vs
distancia estructural
vs
compensación
y no una regla arbitraria.

# 94. Qué haría antes de declarar GOT V5 cerrada

Orden recomendado:

Test 1 — RequiredCredit
Validar:

BaseRR
DTEFactor
WDFactor
Test 2 — WD Sweep
Probar:

0.10
0.15
0.20
0.25
0.30
0.40
Test 3 — Delta Sweep
Probar:

0.05 → 0.30
Test 4 — Width Sweep
Probar diferentes widths.

Test 5 — Liquidity
Definir filtros de ejecución realista.

Test 6 — Candidate Ranking
Resolver cómo elegir entre varios candidatos válidos.

Test 7 — Exit
Definir la mecánica de salida.

Test 8 — Backtest
Aplicar la estrategia completa.

Test 9 — Walk-forward
Separar calibración de validación.

Test 10 — Stress Test
Evaluar:

gap;

volatility expansion;

gamma flip;

wall movement;

spread widening;

sudden delta movement.

# 95. Definición provisional de GOT V5

Hasta completar esos tests, la definición más sólida es:

GOT identifica zonas estructuralmente favorables mediante gamma walls, ZGL y Expected Move; genera candidatos de spreads de crédito dentro de esas zonas; utiliza Delta como variable de búsqueda y no como único criterio; descarta candidatos demasiado próximos a las gamma walls mediante Wall Distance; calcula un RequiredCredit dinámico según width, DTE y distancia estructural; exige que el crédito real supere dicho requerimiento; y finalmente selecciona el mejor candidato mediante una lógica transparente de ranking antes de emitir una alerta.

# 96. Decisión estratégica más importante hasta ahora

Queda descartado conceptualmente:

MinCredit = $80
y también debería evitarse que la estrategia quede definida como:

Delta = 0.15
o incluso:

Delta = 0.10–0.20
como regla aislada.

La arquitectura que emerge de los datos es:

```text
STRUCTURE
    ↓
SAFETY
    ↓
ECONOMICS
    ↓
RANKING

```
El Delta es una variable dentro de ese proceso.

# 97. Próximo objetivo

El próximo trabajo debería ser convertir esta definición conceptual en una tabla de especificación matemática completa, donde cada variable tenga:

nombre;

input;

fórmula;

unidad;

rango;

default;

hard filter / soft filter;

comportamiento ante null;

comportamiento ante datos faltantes;

prioridad dentro del flujo.

Después de eso, podemos implementar un backtest engine de V5 y empezar a medir la estrategia de manera objetiva.

# 98. Estado final al 24/08/2026

YA DEFINIDO
filosofía;

estructura general;

Market Diagnostic;

GEX / gamma walls;

ZGL;

Expected Move;

Sell Zones;

Wall Distance;

Delta como variable de búsqueda;

POP;

Max Risk conceptual;

RequiredCredit;

Cushion;

alerts-only;

streaming/alert architecture;

eliminación de MinCredit fijo.

VALIDADO PRELIMINARMENTE
WD como corte superior de la ventana de delta (0.22 cae por WD en los cuatro sweeps);

RequiredCredit dinámico;

DTE como factor económico;

diferencias entre vencimientos;

asimetría PUT/CALL por skew, no por estructura, y con signo propio de cada símbolo
(Hallazgo 8, y el hallazgo del 24/08 sobre SPY/QQQ);

posibilidad de aceptar créditos nominalmente pequeños en DTE largos;

rechazo de créditos mayores cuando no compensan el riesgo.

REPROBADO O INVALIDADO
0.10–0.20 como región robusta — era el rango barrido, no un resultado (28);

MaxRisk $400 con width 5 — elimina el 100% de los candidatos (39, Hallazgo 9);

RequiredCredit como gate económico — es un piso de riesgo, no un test de ventaja (43.2);

Structural Gate y Economic Gate como niveles independientes — dentro de un vencimiento son
las dos cotas de la misma variable, el delta (43.2).

DECIDIDO EL 24/08, FALTA IMPLEMENTAR
RequiredCredit baja a piso de viabilidad, y se queda simétrico entre lados (43.3);

el gate económico real es un edge test: probabilidad implícita contra empírica (43.3);

el skew no lleva tratamiento explícito — queda absorbido por el edge test (43.3);

el sesgo por lado depende del símbolo, no del motor: se mide, no se declara (43.5).

PENDIENTE
recapturar SPY y QQQ en sesión, para confirmar el sesgo invertido con book vivo (43.4) — y
**sobre vencimientos regulares**, porque el 2026-09-04 de la captura del 24 es un weekly y queda
fuera del bucle definido en la 47.1;

la tabla de probabilidad empírica por lado, delta y DTE que alimenta el edge test;

recalibrar MaxRisk y Width juntos, o pasar a riesgo como % del capital;

calibración estadística de RequiredCredit;

WD mínimo definitivo;

Delta máximo;

Width;

liquidity;

slippage;

candidate ranking;

Selective Mode;

No Operate definitivo;

exit;

persistence;

portfolio risk;

backtest;

walk-forward;

out-of-sample;

stress tests.

# 99. Conclusión

GOT ya no es simplemente:

SELL OTM OPTION
ni:

SELL DELTA 0.15
La estrategia evolucionó hacia:

```text
FIND STRUCTURAL SAFETY
        ↓
FIND ECONOMIC COMPENSATION
        ↓
SELECT BEST TRADE

```
Y el descubrimiento más importante de los últimos tests es:

El mercado determina la distancia que podemos permitirnos. El DTE determina cuánto crédito necesitamos. La cadena determina qué candidato existe.

El objetivo final de GOT debería ser que los parámetros sean consecuencia de la estructura y de la economía, y no números arbitrarios.

La estrategia está suficientemente madura para pasar de la etapa de "diseño conceptual" a la etapa de formalización matemática + backtesting sistemático.

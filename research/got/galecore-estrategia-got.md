# GOT Studio V5
## Estado integral de la estrategia de opciones — TSLA / SPY / QQQ / SKM

> **Versión:** 5.0 · **Recibido:** 2026-08-24 · **Estado:** diseño avanzado, validación en curso
>
> Documento **vivo**: se edita en el lugar y la historia la guarda git. Las versiones 1 a 4 están
> congeladas en [versiones/](versiones/).
>
> **Errata — las secciones 25 y 27 están invalidadas.** Sus tablas de CALL leyeron la columna
> `pcsCredit_w5` de los datasets en vez de `ccsCredit_w5`, con lo que los créditos del lado
> call quedaron sobrestimados entre 6x y 16x. Recalculado, el **Hallazgo 3 se invierte**. Detalle,
> tablas corregidas y consecuencias en
> [el hallazgo del 2026-08-24](hallazgos/2026-08-24-credito-call-columna-equivocada.md).
> Las tablas de PUT (secciones 24 y 26) se verificaron correctas y no se tocan.
>
> *El texto que sigue es el recibido el 2026-08-24, sin cambios de contenido. Solo se repararon
> defectos de transcripción: un fence sin cerrar que aplanaba los headings de las secciones 5.2 a
> 99, las tablas que habían quedado separadas por tabs, y un fragmento del script que generó el
> archivo pegado al final.*

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
- el Delta `0.10–0.20` aparece como una ventana muy razonable en los datos testeados, pero todavía no debe considerarse una ley fija;
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


| Target Delta | Strike | Actual Delta | WD | Credit |
|---|---|---|---|---|
| 0.10 | 395 | .1057 | 1.362 | $3.10 |
| 0.12 | 392.5 | .1188 | 1.265 | $2.50 |
| 0.15 | 387.5 | .1502 | 1.070 | $2.50 |
| 0.18 | 382.5 | .1893 | .875 | $2.70 |
| 0.20 | 382.5 | .1893 | .875 | $2.70 |
| 0.22 | 380 | .2121 | .778 | $3.45 |

Todos pasaron económicamente.

Conclusión:

Un mismo vencimiento puede ser malo para PUT y excelente para CALL.

Por lo tanto:

Expiration ≠ Trade Quality
La unidad de evaluación debe ser:

Expiration × Side × Strike
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


| Target Delta | Strike | Actual Delta | WD | Credit |
|---|---|---|---|---|
| 0.10 | 450 | .1098 | .838 | $3.30 |
| 0.12 | 445 | .1192 | .754 | $3.25 |
| 0.15 | 430 | .1569 | .503 | $3.50 |
| 0.18 | 425 | .1725 | .419 | $3.40 |
| 0.20 | 415 | .2064 | .251 | $3.25 |
| 0.22 | 410 | .2260 | .168 | $3.10 |

Resultado:

```text
0.10 → pasa

0.12 → pasa

0.15 → pasa

0.18 → pasa

0.20 → pasa

0.22 → falla WD

```

# 28. Conclusión del Delta Sweep

El test NO demuestra que:

0.10–0.20
sea una ley universal.

Lo que demuestra es algo más interesante:

La zona 0.10–0.20 aparece naturalmente como una región robusta porque los candidatos más agresivos empiezan a ser eliminados por la estructura.

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

# 47. Flujo completo propuesto


```text
MARKET DATA
    ↓
MARKET DIAGNOSTIC
    ↓
FAVORABLE / SELECTIVE / NO OPERATE
    ↓
MARKET STRUCTURE
    ↓
SPOT
ZGL
CALL WALL
PUT WALL
GEX
EXPECTED MOVE
    ↓
SELL ZONES
    ↓
PUT ZONE / CALL ZONE
    ↓
GENERATE CANDIDATES
    ↓
DELTA WINDOW
    ↓
STRUCTURAL FILTER
    ↓

```
WD >= WD_MIN

```text
    ↓
RISK FILTER
    ↓

```
MaxLoss <= MaxRisk

```text
    ↓
OPTION QUALITY
    ↓
POP / LIQUIDITY / BID-ASK
    ↓
ECONOMIC FILTER
    ↓

```
Credit >= RequiredCredit

```text
    ↓
CUSHION
    ↓
RANK CANDIDATES
    ↓
BEST CANDIDATE
    ↓
ALERT

```
# 48. Arquitectura de decisión recomendada

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

Hallazgo 1
El crédito absoluto no sirve como regla universal.

Hallazgo 2
DTE modifica radicalmente el crédito necesario.

Hallazgo 3
El mismo DTE puede tener un lado excelente y otro malo.

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
| Put/Call evaluation | Definido conceptualmente |
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
| MaxRisk $400 | Provisional |
| Width | Pendiente de optimización |
| Liquidity | Pendiente |
| Slippage | Pendiente |
| Exit | Pendiente |
| Candidate Ranking | Pendiente |
| Persistence | Pendiente |
| Portfolio risk | Futuro |

# 84. Arquitectura recomendada para cerrar V5

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
0.10–0.20 como región robusta;

WD como filtro independiente;

RequiredCredit dinámico;

DTE como factor económico;

diferencias PUT/CALL;

diferencias entre vencimientos;

posibilidad de aceptar créditos nominalmente pequeños en DTE largos;

rechazo de créditos mayores cuando no compensan el riesgo.

PENDIENTE
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

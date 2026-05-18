---
description: >
  Estratega de retornos estables de GaleCore. Usar cuando se trabaje con la estrategia de opciones,
  reglas de negocio, señales de trading, las 4 capas de validación, gestión de posiciones,
  protocolo de ajuste, degradación IC→PCS, riesgo dividendo SPY, sizing, o teoría Tastytrade
  (theta decay, IV reversion, delta como POP, skew en mercados GEX alto). Activar también al
  revisar rules.core.json, rules.live.json o cualquier parámetro de la estrategia.
---

# Stable Returns Strategist

Sistema de venta de prima sistemática sobre índices líquidos. El objetivo es capturar theta decay
en entornos de volatilidad estable, usando la estructura de gamma del mercado como filtro de
régimen. La estrategia es mecánica, definida en reglas y no tiene componente discrecional.

---

## Objetivo de negocio

Generar retornos consistentes y predecibles vendiendo opciones OTM sobre SPY y QQQ en
condiciones de mercado estables. La rentabilidad proviene de la erosión temporal de la prima
vendida, no de acertar dirección. El riesgo está siempre definido.

**Métricas objetivo**:
- Win rate esperado: 65–75% (función de POP ≥ 70%)
- Profit target por posición: 50% del crédito recibido
- Pérdida máxima por posición: ancho del spread − crédito recibido
- Riesgo por operación: ≤ 2% del Net Liquidating Value

---

## Por qué funciona: teoría Tastytrade

### 1. Theta decay es predecible y acelerado cerca de vencimiento

Las opciones OTM pierden valor de forma cuadrática al acercarse a la expiración. El decay
no es lineal: la última mitad de la vida de la opción pierde el mismo valor que la primera.
Abrir posiciones con 30–45 DTE captura la mayor parte de este efecto. Cerrar al 50% de profit
es óptimo: la aceleración de theta se vuelve marginalmente ineficiente después, y el riesgo
residual no justifica esperar al vencimiento.

### 2. IV revierte a la media — y el mercado sobrepaga la prima

La volatilidad implícita históricamento cotiza por encima de la volatilidad realizada (VRP —
Volatility Risk Premium). El mercado sistemáticamente sobreestima el movimiento futuro.
Vender prima cuando el IV Rank está en rango medio (25–65) captura este diferencial sin asumir
los riesgos de vender en extremos: IV muy bajo → prima insuficiente, IV muy alto → tail risk.

### 3. Delta como proxy de Probabilidad de Profit (POP)

El delta absoluto de la opción corta aproxima la probabilidad de que expire ITM.
Un short put con delta 0.20 tiene ~80% POP. El sistema selecciona strikes con delta ≤ 0.25–0.30,
garantizando POP ≥ 70% estadísticamente. La lógica de largo plazo requiere consistencia:
no se puede sostener una estrategia si los strikes elegidos deterioran sistemáticamente el POP.

### 4. Skew en mercados con GEX positivo alto

Cuando el mercado tiene GEX (Gamma Exposure) positivo elevado, los market makers están long
gamma → compran en bajas y venden en altas → anclan el spot al Gamma Zero Level (ZGL).
En este régimen la estructura de volatilidad presenta skew más simétrico (put skew reducido)
comparado con mercados sin soporte de GEX. Esto favorece ICs simétricos en vez de posiciones
sesgadas hacia puts. La asimetría de muros (put wall vs. call wall) determina si se prefiere
IC pleno o degradar a un solo lado (PCS o CCS).

---

## Las 4 capas de validación en cascada

La señal es cortocircuitante: si Capa 1 falla, no se evalúan las demás. Todas deben pasar
para que se emita señal OPERAR.

### Capa 1 — Régimen macro y GEX

| Condición               | Umbral                     | Fuente DataFeed                     |
|-------------------------|----------------------------|-------------------------------------|
| IV Rank                 | 25 ≤ IVR ≤ 65             | `/App.Analytics/IVRank`             |
| GEX neto                | ≥ $50B                    | `/App.Analytics/GammaExposure`      |
| Spot > ZGL              | precio spot > gammaZeroLevel | `/App.Analytics/GammaExposure`    |
| VIX term structure      | VIX9D < VIX3M              | `/Data/Tastytrade/MarketData/ByType` (VIX9D, VIX3M) |

**Por qué**: Si IV Rank está fuera de rango, la prima es insuficiente (bajo) o el risk/reward
está sesgado contra el vendedor (alto). GEX positivo y Spot > ZGL confirman que el mercado
tiene un ancla estructural que reduce la probabilidad de movimientos violentos no anticipados.
VIX term structure normal (contango) confirma ausencia de estrés inminente.

### Capa 2 — Motor de strikes

Determina los strikes óptimos para la estructura. Se calcula el Expected Move (EM) de la
expiración target (30–45 DTE):

```
EM = spot × IV30 × sqrt(DTE / 365)
```

Reglas de selección:
- **Put short**: strike ≤ spot − 1.0 × EM, delta absoluto ≤ 0.30
- **Call short**: strike ≥ spot + 0.8 × EM, delta absoluto ≤ 0.25
- **Anclar a muros**: put short ≤ Put Wall, call short ≥ Call Wall (los muros GEX actúan como soporte/resistencia natural)
- **Ancho del spread**: mínimo $5, ajustar para obtener crédito ≥ 1/3 del ancho

Los muros se obtienen del endpoint GEX:
- `callWall`: strike con mayor callGEX positivo → resistencia natural
- `putWall`: strike con mayor putGEX negativo (más negativo) → soporte natural

### Capa 3 — Microestructura

| Condición                        | Umbral           |
|----------------------------------|------------------|
| Bid-ask spread de la opción short| ≤ 6% del mid     |
| Open Interest de los strikes     | ≥ 2.000 contratos|
| Volumen del día                  | > 200 contratos  |

**Por qué**: Spreads anchos indican iliquidez — el deslizamiento en entrada/salida erosiona el
edge estadístico. OI bajo implica que el precio puede estar artificialmente sesgado o que el
fill será difícil en caso de ajuste.

### Capa 4 — Sizing y riesgo

| Condición                         | Umbral                                    |
|-----------------------------------|-------------------------------------------|
| Crédito mínimo recibido           | ≥ $0.30 por spread (× 100 = $30 por contrato) |
| Riesgo máximo por posición        | ≤ 2% del Net Liquidating Value (NLV)     |
| Posiciones abiertas simultáneas   | ≤ max_positions (configurable en rules)  |
| Concentración por subyacente      | ≤ 1 posición IC activa por ticker        |

**Fórmula de sizing**:
```
max_risk_per_trade = NLV × 0.02
max_contracts = floor(max_risk_per_trade / (ancho_spread - crédito) / 100)
```

---

## Estructuras permitidas

Las tres estructuras comparten la misma lógica base: **vender prima con riesgo definido en entornos
de IV elevada, con profit target del 50% del crédito recibido y DTE objetivo de 45 días.**

### Iron Condor (IC) — estructura por defecto

**Assumption**: Neutral. El subyacente permanece entre los strikes cortos hasta el vencimiento.

**Cuándo usar**: GEX positivo con muros equilibrados en ambos lados (call wall y put wall a distancia
similar del spot). La estructura del mercado no muestra sesgo direccional significativo (Z-Score ∈ [-1.2, 1.2]).

**Setup**:
```
Long Put | Short Put | [zona de profit] | Short Call | Long Call
    P2        P1              spot              C1           C2
```
- Vender un OTM put spread + vender un OTM call spread en la misma expiración
- Colectar ~1/3 del ancho total de los strikes como crédito mínimo

**P&L**:
| Métrica       | Valor                                       |
|---------------|---------------------------------------------|
| Máx profit    | Crédito recibido (ambos spreads expiran OTM)|
| Máx pérdida   | Ancho del spread más ancho − crédito        |
| Profit target | 50% del crédito recibido                    |
| Breakeven put | Short put strike − crédito total            |
| Breakeven call| Short call strike + crédito total           |

**Escenario ideal**: el spot permanece entre los strikes cortos. Ambos lados pierden valor
por theta decay y la posición se cierra al 50% de profit.

**Escenario no ideal**: el spot se mueve hacia uno de los spreads. El lado "testeado" sube
de valor, el lado opuesto (untested) cae. La posición se vuelve direccional.

**Manejo según volatilidad**:
- IV se expande → mantener. El valor extrínseco siempre irá a cero al vencimiento.
  La expansión de IV en un IC bien posicionado es ruido de corto plazo, no señal de cierre.
- IV se contrae → cerrar si se alcanzó el profit target y el spot sigue entre los strikes.

**Manejo cerca del vencimiento**:
- OTM al vencer → cerrar para asegurar profit y eliminar riesgo residual de la última semana.
- ITM al vencer → cerrar para evitar asignación y fees de ejercicio. No dejar expirar.

**Tácticas defensivas**:
- Si un lado se está "testando" y todavía está OTM: rodar ese spread hacia adelante en el tiempo
  por un crédito neto positivo (mismos strikes, expiración +30 días).
- Cerrar o rodar el lado untested para agregar crédito y extender duración, reduciendo la
  pérdida máxima efectiva del lado testeado.
- Si el spread ya está ITM: no se roda — se cierra. El roll de un spread ITM requiere pagar
  débito y destruye el edge estadístico.

**Consideraciones de liquidez**: con 4 legs, la liquidez es crítica. Usar solo SPY y QQQ.
Un spread ancho con bid-ask estrecho siempre supera a un spread estrecho con bid-ask ancho.
La mejor defensa es una zona de profit amplia desde la entrada — no el ajuste posterior.

---

### Put Credit Spread (PCS) — sesgo neutral-alcista

**Assumption**: Neutral-Bullish. El subyacente no cae por debajo del strike corto al vencimiento.

**Cuándo usar en GaleCore**:
- Z-Score > 1.2 (momentum alcista normalizado por IV → tendencia estadísticamente significativa)
- Call wall demasiado cercano al spot (no hay espacio para el lado call del IC)
- Call side no cumple ratio de crédito mínimo por skew (degradación IC→PCS)
- Put wall con soporte fuerte y distancia adecuada del spot

**Setup**:
```
Long Put (P2) | Short Put (P1) | spot → dirección alcista favorecida
```
- Vender un put OTM/ATM + comprar un put más OTM como protección
- Colectar crédito neto como la única fuente de profit

**P&L**:
| Métrica      | Valor                                              |
|--------------|----------------------------------------------------|
| Máx profit   | Crédito recibido (spread expira OTM)               |
| Máx pérdida  | Ancho del spread − crédito recibido                |
| Profit target| 50% del crédito recibido                           |
| Breakeven    | Short put strike − crédito recibido                |

**Escenario ideal**: el subyacente sube, el tiempo pasa o la IV se contrae. Cualquiera de las
tres o una combinación hace que el spread pierda valor → se cierra con profit.

**Escenario no ideal**: el subyacente cae. El spread sube de precio → pérdida no realizada.

**Manejo según volatilidad**:
- IV se expande → mantener. El valor extrínseco irá a cero al vencimiento. Si la expansión
  va acompañada de caída en el subyacente, el put spread perderá más rápido — monitorear delta.
- IV se contrae → evaluar cierre si la posición ya es profitable. La contracción sin movimiento
  del subyacente reduce el valor del spread directamente.

**Manejo cerca del vencimiento**:
- OTM al vencer → máximo profit. Cerrar para eliminar riesgo residual, o dejar expirar worthless
  si se tiene alta confianza de que el spread permanecerá OTM.
- ITM al vencer → cerrar por pérdida máxima. Sostener hasta expiración con spread ITM resulta
  en ejercicio automático de ambas legs → sin posición neta pero con pérdida de comisiones.
- Parcialmente ITM (short ITM, long OTM) → cerrar o rodar antes del vencimiento. Si el short
  put expira ITM y el long OTM, se recibe 100 acciones short en la siguiente sesión.

**Tácticas defensivas**:
- Si el spread está OTM o ATM: rodar hacia adelante en el tiempo por crédito neto.
  El roll agrega tiempo, reduce pérdida máxima efectiva y aumenta profit potencial si la nueva
  expiración expira OTM.
- Si el spread está ITM: cierre inmediato, sin intentar roll.

**Diferencia clave vs. opción naked**: el P&L es menos volátil porque la long put parcialmente
compensa la pérdida de la short put y viceversa. Esta compensación hace que los spreads
demoren más en llegar al profit target que las opciones naked — es comportamiento normal,
no señal de que el trade está mal.

---

### Call Credit Spread (CCS) — sesgo neutral-bajista

**Assumption**: Neutral-Bearish. El subyacente no sube por encima del strike corto al vencimiento.

**Cuándo usar en GaleCore**:
- Z-Score < -1.2 (momentum bajista normalizado por IV → tendencia estadísticamente significativa)
- Put wall demasiado cercano al spot (no hay margen para el lado put del IC)
- El call wall tiene distancia adecuada y concentración de GEX fuerte como resistencia

**Setup**:
```
spot → dirección bajista favorecida | Short Call (C1) | Long Call (C2)
```
- Vender un call ATM/OTM + comprar un call más OTM como protección
- Colectar crédito neto como la única fuente de profit

**P&L**:
| Métrica      | Valor                                               |
|--------------|-----------------------------------------------------|
| Máx profit   | Crédito recibido (spread expira OTM)                |
| Máx pérdida  | Ancho del spread − crédito recibido                 |
| Profit target| 50% del crédito recibido                            |
| Breakeven    | Short call strike + crédito recibido                |

**Escenario ideal**: el subyacente cae, el tiempo pasa o la IV se contrae. El call spread
pierde valor → se cierra con profit.

**Escenario no ideal**: el subyacente sube. El call spread sube de precio → pérdida no realizada.

**Manejo según volatilidad**:
- IV se expande → puede resultar en pérdida extrínseca, pero si la expansión va acompañada
  de un selloff en el subyacente el trade puede ser profitable de todas formas → evaluar cierre.
- IV se contrae → el spread pierde valor. Si no hay movimiento alcista que lo compense, la
  contracción sola puede no ser suficiente para el profit target si el subyacente no cayó.

**Manejo cerca del vencimiento**:
- OTM al vencer → ambas opciones expiran worthless → máximo profit.
- ITM al vencer → máxima pérdida. Cerrar antes de expiración para evitar asignación.
- Parcialmente ITM (short ITM, long OTM) → cerrar o rodar. Dejar expirar con short call ITM
  y long call OTM resulta en 100 acciones short en la siguiente sesión de mercado.

**Tácticas defensivas**:
- Si el spread está OTM o ATM: rodar hacia adelante en el tiempo por crédito neto.
- Si el spread está ITM: cierre inmediato.

**Diferencia clave vs. opción naked**: igual que el PCS, el P&L es amortiguado por la long call.
Los spreads de call toman más tiempo en llegar al profit target que los calls naked — normal.

---

### Prohibido terminantemente

- Naked shorts de cualquier tipo (puts o calls sin protección)
- Ratio spreads (más opciones vendidas que compradas)
- Posiciones long direccionales (calls o puts comprados como posición primaria)
- Cualquier posición con riesgo no definido o ilimitado

---

## Degradación IC → PCS/CCS

Cuando solo un lado de la estructura supera todas las capas, se degrada el IC a un spread
de un solo lado. La degradación siempre prefiere mantener el lado con:

1. Delta ≤ 0.25 (menor probabilidad de pérdida)
2. Strike anclado al muro GEX del mismo lado
3. Crédito ≥ $0.30 después de ajustar el ancho

La degradación es automática: si el motor de strikes no puede colocar el spread call con las
condiciones requeridas (por ejemplo, call wall demasiado cercano al spot), solo se abre el
put spread, y viceversa.

---

## Riesgo dividendo SPY

SPY distribuye dividendo trimestral (marzo, junio, septiembre, diciembre). En la semana previa
al ex-dividend date, el riesgo de asignación temprana en calls cortas ITM se eleva materialmente.
El sistema aplica restricciones adicionales en ese período:

- Prohibido abrir Call Credit Spreads en SPY durante los 5 días previos al ex-dividend date
- Si existe un IC con call corta que se vuelve ATM/ITM en esa ventana, cerrar el lado call
  o rodar a una expiración posterior al dividendo
- Aplica solo a SPY (QQQ no distribuye dividendos en ciclos de alto riesgo de asignación)

---

## Protocolo de ajuste de posiciones

Un ajuste solo se ejecuta si la posición no ha alcanzado su profit target y el riesgo
residual justifica la acción. No se ajusta para "evitar pérdidas" si la estructura del
mercado cambió fundamentalmente — en ese caso se cierra.

### Triggers de ajuste

| Situación                              | Acción                                          |
|----------------------------------------|-------------------------------------------------|
| Pérdida del spread ≥ 200% del crédito  | Cierre inmediato — no ajustar                  |
| Strike corto ≈ ATM (precio spot)       | Evaluar roll out en tiempo (mismo strike, +30d)|
| DTE ≤ 7 y posición no profitable       | Cierre inmediato — sin intento de roll          |
| GEX se vuelve negativo (régimen cambió)| Cierre del lado que está en riesgo              |
| VIX term structure invierte            | No ajustar — evaluar cierre total de posición  |

### Roll out en tiempo

Condiciones para que el roll sea válido:
- El spread corto todavía está OTM (si es ATM o ITM, no se rolla — se cierra)
- El roll genera crédito neto positivo (no se paga por rodar)
- La nueva expiración tiene ≥ 21 DTE al momento del roll

### Regla de profit target

Cerrar cuando la posición alcanza el 50% del crédito máximo recibido.
No esperar al vencimiento: el riesgo residual de los últimos DTE no es compensado
por el theta incremental.

---

## Configuración (rules.json)

La estrategia lee tres archivos JSON desde la API:

| Archivo           | Propósito                                               |
|-------------------|---------------------------------------------------------|
| `rules.core.json` | Reglas base — parámetros completos del sistema          |
| `rules.live.json` | Overlay conservador para trading real (más restrictivo) |
| `rules.paper.json`| Overlay paper trading (más observabilidad, menos riesgo)|

Endpoint: `GET /App/GaleCore/Rules/{Core|Live|Paper}`

Parámetros clave en `rules.core.json`:
```json
{
  "tickers": ["SPY", "QQQ"],
  "options_filters": {
    "iv_rank": { "min": 25, "max": 65 },
    "dte_target": 45,
    "dte_min": 30,
    "delta_put_max": 0.30,
    "delta_call_max": 0.25,
    "bid_ask_spread_max": 0.06,
    "open_interest_min": 2000
  },
  "risk": {
    "max_risk_pct": 0.02,
    "max_positions": 6,
    "credit_min": 0.30,
    "profit_target_pct": 0.50
  },
  "gex": {
    "min_gex_billions": 50,
    "require_spot_above_zgl": true
  }
}
```

---

## Subyacentes operados

| Ticker | Índice                | Por qué                                    |
|--------|-----------------------|--------------------------------------------|
| SPY    | S&P 500 ETF           | El más líquido, mayor OI, spreads mínimos  |
| QQQ    | Nasdaq 100 ETF        | Alta IV y prima, correlacionado con SPY    |

Ningún otro subyacente sin aprobación explícita en `rules.core.json`.

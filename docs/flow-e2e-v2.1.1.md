# GaleCore — Flujo E2E v2.1.3

## Flujo principal: de datos a senal

```mermaid
flowchart TD
    subgraph DATA["Fuentes de datos"]
        TT["Tastytrade REST API"]
        DX["DXLink WebSocket"]
        FRED["FRED API"]
        MAN["Manual checks"]
    end

    subgraph API["DataFeed API (.NET 8)"]
        MD["MarketData\n(price, quote, greeks)"]
        AN["Analytics\n(IVRank, GEX, IV, CreditSpread)"]
        ACC["Account\n(net_liq, positions)"]
        RULES["Rules\n(/App/GaleCore/Rules/Core)"]
    end

    TT --> MD
    TT --> AN
    DX --> MD
    FRED --> AN
    MAN --> API

    subgraph ENGINE["Motor de decision (JSON v2.1.1)"]
        direction TB
        HG["hard_gates"]
        RE["regime_engine"]
        PB["position_builder"]
        
        HG -->|pass| RE
        HG -->|fail| NO1["NO_OPERAR\n(short circuit)"]
        RE -->|crisis| NO2["NO_OPERAR\n(no_new_entries)"]
        RE -->|regimen activo| PB
        PB -->|all pass| SIGNAL["OPERAR / OPERAR_PCS"]
        PB -->|partial fail| WAIT["ESPERAR"]
        PB -->|short circuit| NO3["NO_OPERAR"]
    end

    MD --> ENGINE
    AN --> ENGINE
    ACC --> ENGINE
    RULES --> ENGINE

    subgraph FRONT["Monitor (React)"]
        DASH["Dashboard\n(signal, regime, checks)"]
        PM["Portfolio Manager\n(strikes, premium, sizing)"]
        MON["Monitor\n(posiciones abiertas)"]
    end

    ENGINE --> FRONT
    MD -->|SignalR real-time| FRONT
```

## Detalle: hard_gates

```mermaid
flowchart TD
    START["Inicio evaluacion"] --> DQ{"data_quality_gate\n(quote < 15s,\nno crossed market,\nno missing data)"}
    DQ -->|fail| BLOCK["block_until_fresh"]
    DQ -->|pass| EXDIV7{"spy_exdiv_warn\n(<= 7 dias)"}
    EXDIV7 -->|warn| W1["warn (call side SPY)"]
    EXDIV7 -->|pass| EXDIV3{"spy_exdiv_block_call\n(<= 3 dias)"}
    EXDIV3 -->|fail| BLOCKCALL["block_new_call_entries\n(SPY only)"]
    EXDIV3 -->|pass| PASS["hard_gates PASS\n-> regime_engine"]
    W1 --> EXDIV3
```

## Detalle: regime_engine

```mermaid
flowchart TD
    START["hard_gates PASS"] --> INPUTS["Recopilar inputs:\nVIX, IVR, GEX, spot vs ZGL,\nterm structure, iv_momentum,\nprice_zscore"]
    
    INPUTS --> C1{"VIX > 40?"}
    C1 -->|si| CRISIS["CRISIS"]
    C1 -->|no| C2{"GEX < umbral?"}
    C2 -->|si| CRISIS
    C2 -->|no| C3{"TS invertida?\n(VIX9D > VIX3M)"}
    C3 -->|si| CRISIS
    C3 -->|no| C4{"iv_momentum > 12%?"}
    C4 -->|si| CRISIS
    
    C4 -->|no| CAU{"VIX 30-40 AND\nspot > ZGL AND\nzscore > -1.5?"}
    CAU -->|si| CAUTION["CAUTION\nheat_factor: 0.625\nPCS only, delta 0.15"]
    
    CAU -->|no| DIS{"VIX 25-40 AND\nzscore < -1.5 AND\nIVR > 45?"}
    DIS -->|si| DISLOC["DISLOCATION\nheat_factor: 0.75\nPCS, delta 0.20"]
    
    DIS -->|no| EV{"VIX 30-40 AND\nIVR > 60 AND\nspot < ZGL?"}
    EV -->|si| ELEVATED["ELEVATED_VOL\nheat_factor: 0.625\nPCS, delta 0.15"]
    
    EV -->|no| LV{"VIX < 15 AND\nIVR < 20 AND\nGEX > 50?"}
    LV -->|si| LOWVOL["LOW_VOL_GRIND\nheat_factor: 1.5\nIC ancho"]
    
    LV -->|no| OPT{"VIX < 25 AND\nIVR 30-55 AND\nGEX > 50 AND\nspot > ZGL AND\nTS normal?"}
    OPT -->|si| OPTIMAL["OPTIMAL\nheat_factor: 1.25\nTodas estructuras"]
    
    OPT -->|no| NRM{"VIX < 35 AND\nIVR 20-75 AND\nGEX > 25 AND\nspot > ZGL?"}
    NRM -->|si| NORMAL["NORMAL\nheat_factor: 1.0\nTodas estructuras"]
    
    NRM -->|no| UNCLASS["UNCLASSIFIED\n(fallback defensivo)\nheat_factor: 0.5\nPCS only, max 1 pos\nwarn: régimen no clasificado"]

    CRISIS --> NOTRADE["NO_OPERAR\ntrade_management sigue\npara abiertas"]
```

## Detalle: position_builder (capas 2-4)

```mermaid
flowchart TD
    REG["Regimen activo\n(behavior: structures,\ndelta_max, heat_factor)"] --> L2["CAPA 2: Strike Engine"]
    
    subgraph L2_DETAIL["Capa 2 — Strikes"]
        direction TB
        DTE["DTE 35-45\n(monthly preferred)"]
        STRUCT["Seleccion de estructura\n(zscore + gex_skew +\ntrend + flow)"]
        
        PUT_SIDE["PUT SIDE"]
        PUT_WALL{"put strike\n< put_wall?"}
        PUT_DELTA{"delta put\n<= 0.20?"}
        PUT_OFFSET{"spot - strike\n>= 10pts?"}
        PUT_CR{"credit ratio\n>= min por IVR?\n(0.25/0.28/0.33)"}
        
        CALL_SIDE["CALL SIDE"]
        CALL_WALL{"call strike\n> call_wall?"}
        CALL_DELTA{"delta call\n<= 0.18?"}
        CALL_OFFSET{"strike - spot\n>= 10pts?"}
        CALL_CR{"credit ratio\n>= min por IVR?"}
        
        DTE --> STRUCT
        STRUCT --> PUT_SIDE
        STRUCT --> CALL_SIDE
        
        PUT_SIDE --> PUT_WALL -->|pass| PUT_DELTA -->|pass| PUT_OFFSET -->|pass| PUT_CR
        CALL_SIDE --> CALL_WALL -->|pass| CALL_DELTA -->|pass| CALL_OFFSET -->|pass| CALL_CR
        
        PUT_WALL -->|fail| DISCARD_PUT["discard_put_side"]
        PUT_DELTA -->|fail| DISCARD_PUT
        PUT_OFFSET -->|fail| DISCARD_PUT
        PUT_CR -->|fail| WIDER_PUT["try_wider_spread\nthen discard"]
        
        CALL_WALL -->|fail| DISCARD_CALL["discard_call_side"]
        CALL_DELTA -->|fail| DISCARD_CALL
        CALL_OFFSET -->|fail| DISCARD_CALL
        CALL_CR -->|fail| WIDER_CALL["try_wider_spread\nthen discard"]
    end
    
    L2_DETAIL -->|ambos lados pasan| L3["CAPA 3: Microestructura"]
    L2_DETAIL -->|un lado pasa| DEGRADE["Degradar IC -> PCS/CCS"]
    L2_DETAIL -->|ningun lado| NOTRADE["NO_OPERAR"]
    DEGRADE --> L3
    
    subgraph L3_DETAIL["Capa 3 — Liquidez"]
        OI_S{"OI short >= 2000?"}
        OI_L{"OI long >= 2000?"}
        BA{"B/A <= 5% mid?"}
        FRESH{"Quote < 15s?"}
        CRED{"Credito >= $0.30?"}
        
        OI_S --> OI_L --> BA --> FRESH --> CRED
    end
    
    L3 --> L3_DETAIL
    L3_DETAIL -->|pass| L4["CAPA 4: Sizing"]
    L3_DETAIL -->|fail| NOTRADE2["NO_OPERAR"]
    
    subgraph L4_DETAIL["Capa 4 — Riesgo"]
        CONTRACTS{"max_contracts >= 1?\n(sin floor_min)"}
        SLOTS{"posiciones\ndisponibles >= 1?"}
        HEAT{"heat + nueva pos\n<= max_heat x factor?"}
        CORR{"correlated_exposure\n<= 2 mismo lado\npor cluster?"}
        
        CONTRACTS --> SLOTS --> HEAT --> CORR
        CONTRACTS -->|"0 = no_trade\n(sizing insuficiente)"| SIZE_FAIL["NO_OPERAR\n+ motivo explicito"]
    end
    
    L4 --> L4_DETAIL
    L4_DETAIL -->|all pass| OPERAR["OPERAR\n(signal green)"]
    L4_DETAIL -->|fail| NOTRADE3["NO_OPERAR"]
```

## Detalle: trade_management (posiciones abiertas)

```mermaid
flowchart TD
    OPEN["Posicion abierta"] --> EVAL["Evaluar en orden\nde prioridad"]
    
    EVAL --> T1{"Contingencia\noperacional?"}
    T1 -->|si| CLOSE1["Cierre forzado"]
    T1 -->|no| T2{"Evento macro\nbinario proximo?"}
    T2 -->|si| CLOSE2["Cerrar antes\nde la ventana"]
    T2 -->|no| T3{"Daily kill switch?\n(MTM loss > 1.5% NL)"}
    T3 -->|si| BLOCK["Block new entries\nresto de sesion"]
    T3 -->|no| T4{"Take profit?\n(P&L >= 50% credito)"}
    T4 -->|si| CLOSE3["Cerrar posicion"]
    T4 -->|no| T5{"Soporte estructural\nperdido?\n(wall inside short, 2x)"}
    T5 -->|si| CLOSE4["Cerrar posicion"]
    T5 -->|no| T6{"Hard defense?\n(delta > 0.32 OR\nloss >= 200% credito)"}
    T6 -->|si| REDUCE["Reduccion inmediata\nde riesgo"]
    T6 -->|no| T7{"Defensive roll?\n(loss >= 100% credito,\nDTE >= 28)"}
    T7 -->|si| ROLL{"Roll valido?\n(credito neto > $0.20,\nmax 1 roll)"}
    ROLL -->|si| DOROLL["Ejecutar roll"]
    ROLL -->|no| HOLD["Mantener / evaluar cierre"]
    T7 -->|no| T8{"Time exit?\n(DTE <= 21)"}
    T8 -->|si| CLOSE5["Cerrar posicion"]
    T8 -->|no| CONTINUE["Mantener posicion\n(re-evaluar en 30 min)"]
```

## Flujo de datos real-time (SignalR)

```mermaid
sequenceDiagram
    participant FE as Frontend (Monitor)
    participant HUB as SignalR Hub
    participant DX as DXLink WebSocket
    participant TT as Tastytrade REST

    FE->>HUB: Subscribe(symbol, includeGreeks)
    HUB->>DX: FEED_SUBSCRIPTION(trade, quote, greeks)
    
    loop Streaming continuo
        DX-->>HUB: FEED_DATA (trade)
        HUB-->>FE: ReceiveTrade(symbol, data)
        DX-->>HUB: FEED_DATA (quote)
        HUB-->>FE: ReceiveQuote(symbol, data)
        DX-->>HUB: FEED_DATA (greeks)
        HUB-->>FE: ReceiveGreeks(symbol, data)
    end

    FE->>HUB: SubscribeFlow(symbol)
    loop Cada 30s o cambio de signo
        HUB-->>FE: ReceiveFlow(symbol, flowSnapshot)
    end

    Note over FE: Zustand actualiza estado<br/>global en tiempo real
    
    FE->>TT: GET /App/GaleCore/PositionBuilder
    TT-->>FE: macroRegime + positionBuilder + arbol de decisiones
```

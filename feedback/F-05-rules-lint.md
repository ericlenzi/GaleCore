# F-05 — Lint automatizado del JSON de reglas

**Prioridad:** P1 — Tres pasadas manuales encontraron bugs distintos cada vez; la cuarta debe ser un script
**Fecha:** 2026-06-12

## Que es

Dos scripts de validacion que se corren contra `galecore_rules_core.json` y reportan pass/fail:

### Suite 3.1 — Lint estatico (estructura del JSON)

| ID | Check | Motivacion |
|---|---|---|
| L01 | JSON parsea sin errores | Basico |
| L02 | Todo `{ ref: 'X' }` resuelve a un valor existente | Bug skew_repricing: ref a `put_skew_25d_roc_5d` que no existia |
| L03 | Todo `on_fail` esta en el enum `on_fail_actions` | Campos inventados sin soporte del motor |
| L04 | Todo `on_activate` esta en el enum `on_activate_actions` | Campo nuevo de v2.1.3 |
| L05 | No existe campo `fallback` en regime_engine | Eliminado en v2.1.3 — doble fuente de verdad con unclassified |
| L06 | Ultimo regimen del `evaluation_order` no tiene condiciones evaluables | Invariante de fallback |
| L07 | `evaluation_order` y array `regimes` contienen los mismos IDs | Regimen definido pero no evaluado, o viceversa |
| L08 | Checks con `enabled: true` no referencian fuentes "pendiente verificacion" | Bug B3: check armado apuntando a dato fantasma |
| L09 | No hay literal `0.045` ni `heat_max_pct` absoluto en regimenes | Anti-regresion heat |
| L10 | Credit ratio minimos >= 0.25 | Anti-regresion credit ratio |
| L11 | Deltas de entrada tienen gap >= 12 puntos vs `hard_defense` | Anti-regresion delta |
| L12 | `floor_min` no existe | Anti-regresion sizing |
| L13 | `macro_regime` no existe como seccion | Absorbido en v2.1.0 |
| L14 | Checks disabled tienen nota con "DISABLED" y explicacion | Documentacion |
| L15 | Todo `operator` esta en el enum `operators` | Campos inventados |

### Suite 3.2 — Matriz de regimenes (simulacion de escenarios)

Clasificador Python que replica la logica `evaluation_order` + `conditions` del JSON y corre escenarios de mercado contra el. Cada escenario define inputs (VIX, GEX, IVR, zscore, spot vs ZGL, term structure, iv_momentum) y el regimen esperado.

Escenarios criticos a cubrir:

| Escenario | Inputs | Esperado | Por que importa |
|---|---|---|---|
| Crisis — VIX spike | VIX 42 | crisis | Trigger individual |
| Crisis — GEX collapse | GEX < 25 | crisis | Trigger individual |
| Crisis — TS invertida | VIX9D > VIX3M | crisis | Trigger individual |
| Crisis — IV momentum | iv_momentum 15% | crisis | Trigger individual |
| Caution | VIX 33, spot>ZGL, zscore -0.5 | caution | Nuevo regimen v2.1.0 |
| Caution vs Dislocation boundary | VIX 33, zscore -2.0 | dislocation | caution no ensombrece (zscore > -1.5) |
| **Bug v2.1.2** | VIX 33, spot<ZGL, IVR 50, zscore -1.0 | **unclassified** | Nada matchea → fallback defensivo (no normal) |
| Elevated vol boundary | IVR 60 vs 61 | unclassified vs elevated_vol | > estricto, no >= |
| Gap VIX 28 bajo ZGL | VIX 28, spot<ZGL, IVR 40 | unclassified | No alcanza caution (VIX<30), no alcanza elevated_vol (IVR<60) |

## Implementacion sugerida

- Python puro, sin dependencias externas
- Se corre desde la raiz del proyecto: `python scripts/lint_rules.py` y `python scripts/regime_matrix.py`
- Exit code 0 = todo pasa, 1 = hay fallos
- Reporte legible con [OK] / [XX] por check
- Opcional: integrarlo como pre-commit hook o CI step

## Criterio de aceptacion

- [ ] Suite 3.1 pasa contra `galecore_rules_core.json` v2.1.3
- [ ] Suite 3.2 pasa todos los escenarios documentados
- [ ] Ambos scripts son ejecutables sin dependencias mas alla de Python 3.8+

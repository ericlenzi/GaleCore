# Research / Backtesting — scripts del ciclo BT-10…BT-12 (jul-2026)

Scripts de análisis que produjeron los veredictos documentados en
`docs/galecore-backtesting-pendientes.md` (§BT-10, BT-10b, BT-10c, BT-11, BT-12).
Se persisten acá para que sesiones futuras no tengan que reconstruir la maquinaria
(lección aprendida: los scripts de BT-0…BT-9b vivieron en un scratchpad efímero y se perdieron).

## Prerrequisitos

- Python 3.10+ con `pandas` y `pyarrow`
- Datos (no versionados, `data/` está en .gitignore):
  - `data/{spy,qqq,iwm}_options/*.parquet` — cadenas EOD 2013–2025 + underlying prices
  - `data/derived/*.parquet` — caches (calibraciones POP, GEX diario, walls, skew25, bt3_trades)
  - `data/vvix_history.csv` — bajado de CBOE (`https://cdn.cboe.com/api/global/us_indices/daily_prices/VVIX_History.csv`)
- Los paths están hardcodeados a `C:/Eric/App/Claude/Projects/GaleCore/data` (variable `BASE`).
- En consola Windows correr con `PYTHONIOENCODING=utf-8`.

## Scripts (en orden del ciclo)

| Script | Qué hace | Sección del doc |
|---|---|---|
| `wf_decompose.py` | Descompone el colapso de ocurrencia H2 en variantes (shrinkage vs tail_score vs piso anti-pennies), walk-forward SPY OOS 2018–2025 | BT-10 |
| `wf_binding.py` | Análisis de bloqueador marginal bajo H2: qué gate mata cada día operable; aritmética del crédito requerido | BT-10 |
| `scan_families.py` | Scan exploratorio de fuentes de prima (edad de régimen, skew nivel, GEX pct, IV pct, RV cayendo, VRP) sobre días bloqueados | BT-10b |
| `scan_delta.py` / `scan_delta_deep.py` | Reconstrucción de PCS a delta 0.25/0.30 desde cadenas crudas; hallazgo delta-0.30 + diagnósticos (C2, sensibilidad, tail on/off) | BT-10b |
| `bt10c_qqq.py` | Walk-forward H3 (delta 0.30, trailing sin shrinkage, tail_score) sobre QQQ — la corrida única de confirmación | BT-10c |
| `bt10_mgmtB.py` | Gestión B (cierre al 50%) path-level (MTM diario) sobre las señales H3, SPY+QQQ | BT-10c (a) |
| `bt11_build_caches.py` | Construye `pop_obs_calls_{sym}.parquet` y `{sym}_structinputs_daily.parquet` (gex_skew, call_wall, zscore, trend) | BT-11 |
| `bt11_run.py` | Test del motor de estructuras (IC/PCS/CCS, reglas 1/6/7/8 sin flow) con config H3 | BT-11 |
| `bt12_delta_grid.py` | Grilla de deltas 0.15–0.35, test de meseta/monotonía | BT-12 |

## Reglas de uso (disciplina post-BT-9)

- La ventana OOS 2018–2025 está **agotada**: cualquier corrida nueva sobre ella es
  exploratoria (genera hipótesis) — no habilita nada.
- Un cambio de config exige: hipótesis pre-declarada en el doc de backtesting ANTES de
  correr, UNA corrida, veredicto reportado tal cual.
- La config de referencia vigente (PCS delta 0.30 + trailing + tail_score + gestión B)
  no se toca por resultados observados en re-corridas de estos scripts.

---
name: write-feedback-todo
description: Write a feedback/ TODO (.md) for a variable/indicator the rules engine needs but DataFeed doesn't fully provide yet. Use when adding to GaleCore's feedback/ backlog, documenting a partially-implemented indicator (e.g. a snapshot without history), or when the user asks for "el TODO de la regla X" / "qué falta para que la regla quede bien".
---

# Escribir un TODO de feedback/ (GaleCore)

La carpeta `feedback/` es el backlog de variables que el motor de reglas (`galecore_rules_core.json`) necesita pero que DataFeed no provee **completo** hoy. Cada ítem es un `.md` con formato fijo. Este skill define ese formato.

## Cuándo se crea un ítem

- Una `definition`/`check` del JSON referencia un dato que el backend no calcula (o lo calcula parcial: snapshot sin RoC/percentil, check `enabled:false`).
- NO se crea para bugs de código ya existente (eso va al PR directo), ni para ideas sin nodo del JSON que las consuma.

## Nombre del archivo

`feedback/F-NN-slug.md` — `NN` es el siguiente ID libre (no reusar IDs eliminados salvo que el JSON reserve uno, ej. `verification_required → feedback/F-03`). `slug` en kebab-case.

## Estructura obligatoria (en este orden)

```markdown
# F-NN — Título (Indicador · sub-métrica clave)

**Prioridad:** P0|P1|P2 — una línea de por qué esa prioridad
**Fecha:** YYYY-MM-DD
**Estado:** una línea del estado real (ej. "SNAPSHOT IMPLEMENTADO, CHECK DISABLED — falta historial")

## Qué es
Definición técnica del indicador + la(s) fórmula(s) exacta(s) del JSON en bloque de código.

## Para qué se usa (el sentido)
Qué señal aporta a la estrategia y por qué importa para un vendedor de prima. Relacionar con los
otros checks del mismo grupo (no repetir lo que ya hace otro).

## Nodo del JSON que lo consume
Listar los `definitions.*`, `regime_engine.checks[id]` (con `enabled`, operador, threshold, on_fail)
y régimenes que lo usan. Citar nombres reales del JSON.

## Qué hay hoy
Lo que YA existe (endpoint, handler, campos que devuelve, qué muestra el front). Con un ejemplo de
respuesta real si se pudo levantar el endpoint. Marcar explícitamente lo que viene `null`/pendiente.

## Qué debería tener
La diferencia exacta entre hoy y "check activo": qué campos/datos faltan y los pasos de activación
(poblar campos, flip `enabled:true`, condición de crisis, render con semáforo).

## Forma ideal técnicamente
La implementación recomendada y su trade-off, alineada con "strategy first, infra later — sin DB todavía".
Incluir alternativas y el riesgo principal a verificar. Ser concreto (rutas de archivo, patrón, maduración).

## Criterio de aceptación
Checklist `- [ ]` / `- [x]` accionable. Lo hecho marcado, lo pendiente claro y verificable.
```

## Reglas de estilo

- **Prohibido el ítem de una línea.** Si no podés llenar las 8 secciones, todavía no es un ítem de feedback.
- **Fuente de verdad = JSON.** Citar nombres reales de `definitions`/`checks`; las fórmulas se copian del JSON, no se inventan.
- **Honesto sobre el estado.** "Qué hay hoy" debe distinguir lo implementado de lo `null`/stub. Nada de marcar `[x]` lo que no corre.
- **Ejemplo real cuando se pueda.** Si el endpoint existe, levantarlo y pegar una respuesta real (valores concretos > descripción).
- **Prioridad por impacto en el motor:** `P0` bloquea operación real · `P1` cubre un grupo ausente del framework · `P2` mejora incremental.

## Ciclo de vida

- Un ítem se **elimina** del backlog solo cuando está **completo** (backend + check `enabled:true` en el JSON). El código, el JSON y git history son la fuente de verdad; no se acumulan `.md` cerrados.
- Si queda residual (snapshot sin RoC, check disabled), el ítem **sigue abierto** con su backlog actualizado.
- Al cerrar/abrir un ítem, actualizar el **Índice actual** de `feedback/README.md`.

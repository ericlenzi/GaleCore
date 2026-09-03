---
description: >
  Despliega DataFeed.Api al VPS de producción: pre-flight (rama, tests), migraciones pendientes
  con migrate-db.ps1, deploy-api.ps1, y diagnóstico por journalctl si el health check falla.
  Usar cuando el operador diga "deployá la API", "subí esto a producción" o "hay que migrar y
  deployar". No toca el front: Vercel se encarga con el push a master.
argument-hint: "[--skip-publish] [--dry-run]"
---

# /deploy-api — desplegar la API al VPS

Orquesta lo que ya está escrito: [`migrate-db.ps1`](../../migrate-db.ps1) y
[`deploy-api.ps1`](../../deploy-api.ps1). **Este comando no reimplementa nada de eso** — si algo del
procedimiento cambia, cambia en el script, no acá.

## Reglas duras

1. **Nunca genero ni edito una migración dentro de este flujo.** Si `has-pending-model-changes`
   avisa que el modelo se movió, paro y lo reporto: crear la migración es un cambio de código con
   su propio commit y su propia revisión.
2. **Nunca corro `dotnet ef database update` a mano.** Siempre `migrate-db.ps1`, que muestra el SQL
   antes y clasifica el cambio. Una migración no tiene rollback.
3. **El DDL destructivo no va antes del deploy.** Se parte en dos pasos (§2 y §6).
4. **No commiteo, no pusheo, no toco los archivos de estado de runtime**
   (`Files/**/*_switch_state.json`, `Files/skew25_history.json`). El deploy ya los excluye; si
   alguno viaja, el script se planta y ahí termina el flujo.
5. **Confirmación explícita del operador antes de cada paso que toca producción** — la migración y
   el deploy. Los dos scripts ya preguntan; no los salteo con `-Yes`.
6. **El front no es asunto de este comando.** El push a master dispara Vercel solo.

## Pasos

### 0. Contexto

- `git status --short` y `git branch --show-current`.
- **`deploy-api.ps1` empaqueta el working tree, no lo que está en master.** Si la rama no es master
  o hay cambios sin commitear, lo digo antes de seguir: se va a desplegar exactamente lo que hay en
  disco. No lo bloqueo — deployar una rama para probar es legítimo—, pero que sea una decisión.

### 1. Que compile y pase los tests

```
dotnet test source/galecore-datafeed/DataFeed.Tests/DataFeed.Tests.csproj
```

Es lo mismo que corre el CI. Si falla, paro acá y reporto el fallo. No deployo con tests en rojo.

### 2. Migraciones — primero mirar, después decidir

```
.\migrate-db.ps1 -DryRun
```

Tres desenlaces, y el orden contra el deploy depende de cuál sea:

| Lo que dice el dry-run | Qué hago |
|---|---|
| Sin pendientes | Sigo al paso 3. |
| Pendientes **aditivas** | Las aplico **ahora**, antes del deploy: `.\migrate-db.ps1` (el operador escribe `aplicar`). El binario nuevo espera el esquema nuevo. |
| Pendientes **destructivas** | **No las aplico todavía.** Deploy primero (paso 3), verificar la API arriba (paso 4), y recién ahí el paso 6. La API vieja todavía usa lo que se borra. |

Si el dry-run corta por credencial o por puerto, el mensaje ya trae el comando exacto: lo paso tal
cual y espero, no improviso una cadena de conexión.

### 3. Deploy — dos caminos, y el normal es el pipeline

**Si lo que se despliega ya está en master**, el camino es `.github/workflows/deploy.yml`: dispara
solo en el merge y queda esperando aprobación en el environment `production`. Mi trabajo acá es
decirle al operador que hay una corrida esperando y **cuál es la decisión que está aprobando** —
sobre todo si el paso 2 encontró una migración destructiva pendiente. No apruebo yo: la aprobación
es de una persona, y es el único gate que tiene este despliegue.

Para redesplegar un commit viejo (el rollback de hoy): Actions → Deploy API → Run workflow, con el
commit en `ref`.

**Si hay que desplegar una rama sin pasar por master**, o Actions no está disponible:

```
.\deploy-api.ps1
```

Con `--skip-publish` en los argumentos del comando, uso `.\deploy-api.ps1 -SkipPublish` (sirve
cuando el operador ya publicó desde Visual Studio con FolderProfile). Pide la contraseña de sudo
**dos veces** (`ssh -t` abre TTY): es interactivo por diseño, el operador tiene que estar delante.

Si el workflow falla en el paso de SSH, lo más probable es que falte la puesta en marcha de una sola
vez — clave del CI, script privilegiado, sudoers, secret y environment: está en `deploy/README.md`.

### 4. Verificación

El script ya reintenta el `swagger.json` ocho veces y sale distinto de cero si no llega a 200. Además:

- Lee la última línea que imprime, la de `ls -l` sobre los archivos de estado: **las fechas tienen
  que ser ANTERIORES al deploy**. Si son de recién, el deploy pisó los switches del operador y una
  estrategia puede haber quedado apagada o prendida sin que nadie la tocara.

### 5. Si no responde

```
ssh elenzi@149.50.154.221 "sudo journalctl -u galecore-datafeed -n 80 --no-pager"
```

Leer, diagnosticar y reportar. **No reintentar el deploy a ciegas.** Dos causas que ya pasaron y
que el log muestra distinto:

- **Falta una variable de entorno** → va en `/etc/galecore/datafeed.env` (modo 600, `EnvironmentFile`
  de la unidad). El `:` de la jerarquía se escribe `__`, y **un valor con espacios va entre comillas
  dobles** o systemd lo corta en el primer espacio. Eso se edita por SSH a mano: el deploy no lo toca.
- **`permission denied` contra la base** → una tabla nueva sin grants para `galecore_api`. Las dos
  consultas de verificación las imprime `migrate-db.ps1` cuando la migración crea una tabla.

**No hay rollback automático:** `tar -xzf` extrae encima, sin backup y sin borrar lo que ya no va.
Si hay que volver atrás, es hacer checkout del commit anterior y deployar de nuevo.

### 6. La migración destructiva, si la había

Recién ahora, con la API nueva arriba y respondiendo:

```
.\migrate-db.ps1
```

### 7. Cierre

Reportar en dos líneas: qué quedó desplegado (rama + commit corto), qué migraciones se aplicaron y
en qué momento del flujo, y si quedó algo pendiente a propósito.

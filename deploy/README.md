# Deploy de la API — puesta en marcha del pipeline

El workflow [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) despliega
`DataFeed.Api` al VPS. Dispara en cada push a master y **queda esperando aprobación** en el
environment `production`; también se puede disparar a mano desde la pestaña Actions eligiendo un
commit, que hoy es el único rollback que existe.

`deploy-api.ps1` **no se elimina**: queda como camino manual para cuando querés desplegar tu working
tree sin pasar por master, y como salida de emergencia si GitHub Actions no está disponible.

Los cuatro pasos de abajo se hacen **una sola vez**. Hasta que estén hechos, el workflow falla en el
paso de SSH.

---

## 1. Clave SSH dedicada para el CI

En tu máquina, **no** reutilices tu clave personal: si esta se compromete, se revoca sola.

```bash
ssh-keygen -t ed25519 -C "github-actions-galecore" -f galecore-ci -N ""
```

Autorizala en el VPS:

```bash
ssh-copy-id -i galecore-ci.pub elenzi@149.50.154.221
```

## 2. El script privilegiado, en el servidor

Es [`galecore-deploy`](galecore-deploy), el único comando que el CI corre con `sudo`.

```bash
scp deploy/galecore-deploy elenzi@149.50.154.221:~/galecore-deploy
```

```bash
ssh -t elenzi@149.50.154.221 "sudo install -o root -g root -m 755 ~/galecore-deploy /usr/local/bin/galecore-deploy && rm ~/galecore-deploy"
```

**Cada vez que se edite el archivo en el repo hay que repetir estos dos comandos.** El script no
viaja en el paquete del deploy: es de root, y un deploy que pudiera reescribir su propio script
privilegiado no tendría ningún límite.

## 3. La regla de sudoers

Con `visudo`, que valida la sintaxis antes de guardar — un `/etc/sudoers.d/` roto deja el servidor
sin sudo:

```bash
ssh -t elenzi@149.50.154.221 "sudo visudo -f /etc/sudoers.d/galecore-deploy"
```

Contenido, dos líneas exactas:

```
elenzi ALL=(root) NOPASSWD: /usr/local/bin/galecore-deploy
elenzi ALL=(root) NOPASSWD: /usr/bin/journalctl -u galecore-datafeed -n 80 --no-pager
```

Las dos están **acotadas a comandos concretos, sin comodines**. La segunda es solo para que un
deploy fallido deje los logs en la salida del workflow en vez de obligarte a entrar a mano; sin
comodín, no sirve para leer ningún otro journal.

Verificá que quedó (tiene que fallar por falta de paquete, no por pedir contraseña):

```bash
ssh elenzi@149.50.154.221 "sudo -n /usr/local/bin/galecore-deploy"
```

Esperado: `No hay paquete en /home/elenzi/galecore-publish.tar.gz.` Si en cambio dice
`sudo: a password is required`, la regla no está tomando.

## 4. GitHub

**Secret** — en Settings → Secrets and variables → Actions:

| Nombre | Valor |
|---|---|
| `VPS_SSH_KEY` | el contenido de `galecore-ci` (la clave **privada**, entera, incluidas las líneas BEGIN/END) |

**Environment** — en Settings → Environments → New environment, nombre `production`, y tildar
**Required reviewers** agregándote. Eso es el gate: sin esa protección el workflow deploya en cada
merge sin preguntar.

Después, **borrá la clave privada de tu máquina**: ya vive en GitHub y en el VPS.

```bash
rm galecore-ci galecore-ci.pub
```

---

## Cómo se usa

| Situación | Qué hacés |
|---|---|
| Mergeaste un PR a master | El workflow arranca solo y espera tu aprobación en Actions. Aprobás y deploya. |
| Hay una migración **destructiva** pendiente | Aprobás el deploy primero, verificás que la API responda, y recién después corrés `.\migrate-db.ps1`. |
| Hay una migración **aditiva** pendiente | Corrés `.\migrate-db.ps1` **antes** de aprobar el deploy. |
| Rollback | Actions → Deploy API → Run workflow, y en `ref` ponés el commit anterior. |
| Probar una rama sin mergear | `.\deploy-api.ps1` desde tu máquina, como siempre. |

## Lo que este pipeline todavía no resuelve

* **No hay rollback real.** `tar` extrae encima: no hay copia de la versión anterior ni se borran
  los archivos que ya no van. Volver atrás es redesplegar un commit viejo, que es distinto de
  restaurar lo que había. La solución es `releases/` con symlink, y cuesta editar la unidad de
  systemd.
* **La huella del host se acepta por TOFU** (`ssh-keyscan` en cada corrida). Fijarla es agregar la
  salida de `ssh-keyscan 149.50.154.221` como un secret y escribirla en `known_hosts` en vez de
  escanear.
* **Las migraciones siguen siendo manuales**, con `migrate-db.ps1` y tu credencial. Es deliberado:
  automatizarlas exige poner en GitHub una credencial que puede `DROP TABLE`, y todo el diseño de
  dos roles existe para que esa credencial no viva lejos tuyo.

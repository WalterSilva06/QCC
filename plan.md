# Plan · Permisos aprobados en el plan de /impl (impl 0.4.0)

Hoy gran parte del trabajo vuelve al usuario porque la guardia niega lo externo y `Externo:` solo sirve si el pedido lo nombra. En las corridas recientes (`≥0.3.4`), lo que queda en «Queda para ti» incluye BD viva (25%), deploy (17,9%), servicio vivo (10,7%) y verificación visual (42,9%).

La idea: el plan propone, antes de la verificación final, cada comando que la guardia negaría, quién lo corre, qué hace y para qué. El usuario aprueba y solo entonces se puede ejecutar.

**La guardia sigue negando por defecto.** Lo aprobado es una lista blanca, y sin aprobación registrada el comando se niega. Generaliza `Externo:`, que ya hace casi todo esto.

Clasificación: CRÍTICO (cambia la guardia, que es lo que hace cumplir la aprobación).

## Comprobación previa (antes de lanzar S1)

Con la versión actual, correr un `/impl` de prueba cuyo pedido nombre `gh pr list --limit 1` como `Externo:` y aprobarlo. Mirar si Claude Code pide confirmación o frena al ejecutor aunque la guardia deje pasar el comando.

- Si corre sin freno: S1 no cambia.
- Si lo frena: S1 incluye el punto «`allow`» marcado como condicional.

Sin este resultado no se lanza S1: de él depende que un permiso aprobado sirva de algo.

## El bloque del plan

Va **antes de `Verificación final`**. La cabecera lleva dos puntos y las líneas van sangradas, para reutilizar `RE_PIE` y `bloqueDe`. Aparece completo en `PARA APROBAR`, también en el formato compacto:

```
PERMISOS A APROBAR:
  P1 · ejecutor S3 · `pnpm db:push` · Supabase dev · reversible: no
     Qué hace: revisa y aplica las migraciones pendientes en la base linkeada.
     Para qué: S3 necesita la columna nueva para probar contra datos reales.
  P2 · ejecutor S5 · `node --env-file=.env scripts/flow/tunel/ui.mjs sem4 *` · Flow sandbox · reversible: no
     Qué hace: abre Mi suscripción de la cuenta sem4 en el navegador y ejecuta la acción indicada.
     Para qué: medir qué cobra Flow al subir cupo durante el trial.
  P3 · orquestador · `pnpm dev` (en fondo, lo cierra al terminar) · local + túnel · reversible: sí
     Qué hace: levanta Vite y expone la app en dev.horaki.cl.
     Para qué: que Playwright use la app y lleguen los webhooks de Flow.
```

Campos obligatorios: id, quién (`ejecutor S<n>` u `orquestador`), comando entre comillas invertidas, servicio, `reversible`, `Qué hace` y `Para qué`. Sin `reversible`, cuenta como no. El rol `revisor` no existe en esta versión.

El comodín `*` solo vale después de una parte literal: el programa y su primer argumento no-opción tienen que ser literales, y ninguna palabra lleva `*` hasta esa posición. Con `exec`, `dlx`, `x` o `run` de un gestor, también el argumento siguiente. En `node`, el script que da `indiceScript`. Un comando que no cumple esto no se puede aprobar: `pnpm *`, `node *`, `node scripts/*` y `pnpm exec *` quedan fuera.

## Negado siempre, aun con aprobación

| Qué | Por qué |
|---|---|
| Todo `git` que no sea de lectura (lo que niega `evaluarGit`) | los commits van solo por `/commit`, y ramas y deshacer los decide el usuario |
| Destinos de escritura que niega `motivoRuta`, también en un comando aprobado (`cp`, `mv`, `sed -i`, `tee`…) | cubre `.claude/settings*.json`, `.claude/agents/`, `.git/`, secretos, protegidos, migraciones versionadas y todo lo que quede fuera del repo salvo temporales, como `~/.claude` o el git-dir de un worktree |
| `estado.mjs` con `--permiso`, `--permiso-nuevo`, `--aprobado`, `--base`, `--cambios`, `--guardar`, `--cancelar`, `--tanda`, `--reanudar`, para todos los roles | el agente se aprobaría solo |
| Leer `.env` y los secretos del proyecto, también con `Read` y `Grep` y para los cuatro roles | solo se admite `--env-file` en un `node` aprobado |
| `curl … \| sh`, `iex (irm …)` | ejecuta código bajado sin revisar |
| `format`, `diskpart`, `mkfs` | destruyen el disco |

---

## S1 · La guardia hace cumplir los permisos

**Archivos:** `qcc-implementador/herramientas/guardia.mjs`, `guardia.test.mjs` y, solo por el renombre, `estado-fotos.test.mjs` (import y línea 335).

**Cambios:**

- `externosAprobados` (`guardia.mjs:1290`) pasa a `permisosAprobados(raiz)`. Lee `permisos` de `estado.json` con la forma `{ P1: { rol, sub, comando, servicio, reversible, queHace, paraQue, aprobado?, nuevo? } }`. Un permiso vale solo si tiene `aprobado`, si `rol` es `ejecutor` y si `sub` está en `en_curso`. La guardia no evalúa los de `orquestador`: la sesión principal no trae `agent_type` (`:1452`).
- `regexDeExterno` (`:1310`) pasa a `regexDePermiso` y devuelve `null` si el comando no cumple la regla del comodín, además de los casos actuales.
- `motivoFijo(prog, args, ctx)` corre **antes** de mirar los permisos (`:1214`) y niega lo de «Negado siempre»:
  - `git`: `evaluarGit(args, ctx)`.
  - `node`: `motivoEstadoEscribe(args)`, sin la condición de rol de `:834`.
  - `format`, `diskpart`, `mkfs`.
  - Destinos: el bloque de `:1273-1281` (`motivoRuta` sobre `CON_DESTINO`, `COPIAN`, `sed -i`, `perl -i`) se mueve aquí. Los destinos de un comando aprobado dejan de estar eximidos.
- `export function motivoFijoDe(comando, { raiz })`: analiza el comando y aplica `motivoFijo` a cada comando simple. Lo usa `estado.mjs` para sus AVISOS.
- Excepción de `.env` (`:1184-1188`, `:839`): la palabra `--env-file=.env` o `--env-file=.env.<nombre>` pasa solo si el programa es `node`, si la palabra va antes del script, si el comando completo coincide con un permiso aprobado y si `indiceScript(args) >= 0`. Toda otra mención de `.env` sigue negada, también dentro de lo que cubre un `*`.
- Lecturas: `export function motivoLectura(evento, raiz)` niega `Read` de un `.env` (salvo plantillas) o de un secreto del proyecto, y `Grep` con `path` o `glob` que los nombre. Buscar el texto `.env` con `pattern` sigue permitido, y `Glob` no se revisa porque solo lista nombres. La usan `evaluar` y la rama de `ROLES_LECTURA` de `main` (`:1455`), que hoy retorna antes de `evaluar`.
- `ESTADO_ESCRIBE` (`:811`): cambiar `externo` por `permiso` y `permiso-nuevo`.
- Mensaje de negación (`:1541`): si falta un comando externo, pedir `NECESITA_PERMISO` en el reporte.
- **Condicional, `allow`** (solo si la comprobación previa mostró freno): cuando el comando completo es **un solo** comando simple y coincide con un permiso vigente, `main` responde `permissionDecision: 'allow'`.

**Hecho cuando:**

- Sin aprobación, cada comando de los grupos negados sigue negado.
- Aprobado, pasa solo el comando exacto, solo para el ejecutor y solo mientras su subtarea esté en `en_curso`.
- Se niegan aun con un permiso que coincida: `git commit`, `git merge`, `git -C . rebase`, `git reset --hard`, `format`, `estado.mjs --aprobado` y `cat .env`.
- `regexDePermiso` devuelve `null` para `pnpm *`, `node *`, `node scripts/*`, `pnpm exec *` y `node --env-file=.env * scripts/x.mjs`, y una expresión válida para los tres comandos del ejemplo.
- `node --env-file=.env scripts/x.mjs` pasa aprobado; `node --env-file=.env -e "…"` no, y `node --env-file=.env scripts/x.mjs .env` tampoco.
- Un `cp` aprobado hacia `.claude/settings.json`, `~/.claude/settings.json` o `.git/x` se niega.
- El revisor recibe negación en `estado.mjs --aprobado`.
- `Read` de `.env` y `Grep` con `path: '.env'` se niegan a ejecutor, revisor, explorador y planificador. `Read` de `.env.example` pasa.

**Tests:** en `guardia.test.mjs`, migrar los casos de `Externo` (`:847-968`, `:1048-1081`), invertir `:612` y agregar los de arriba. Los permisos se arman a mano en `estado.json`, como hoy; S2 agrega la prueba con la salida real.

**Riesgos:** comprobar primero el orden actual de `evaluarSimple` para que ninguna negación que hoy pasa antes de `:1214` quede después. `motivoFijo` mueve negaciones antes: pueden cambiar los mensajes, no el resultado.

**Reversión:** revertir los archivos.

---

## S2 · Parser, estado y aprobación de permisos

**Archivos:** `qcc-implementador/herramientas/estado.mjs`, `estado-fotos.test.mjs`, `estado-cambios.test.mjs`.

**Depende de:** S1 (usa `regexDePermiso` y `motivoFijoDe`).

**Cambios:**

- Bloque en el pie: `RE_PIE` (`estado.mjs:390`) incluye `PERMISOS A APROBAR`, y `aprobacionDe` (`:740`) lo muestra antes de `Queda para ti`.
- `externoDe` (`:486`) pasa a `permisosDe(pie)`: devuelve `[{ id, rol, sub, comando, servicio, reversible, queHace, paraQue }]`. El comando es lo que va entre comillas invertidas. El campo `Externo:` de la subtarea desaparece (`:710`, `:717`, `:723`, `:775-778`, `:791`, `:793`).
- `fusionarPlanes` (`:622`): si el re-plan trae pie sin bloque, conserva el bloque anterior.
- Cada `S<n>.md` lleva una sección `Permisos:` con los comandos de esa subtarea, para que el ejecutor los conozca.
- `--guardar plan` agrega AVISOS, resueltos a lo más estricto:
  - el bloque está pero no se leyó ningún permiso (por ejemplo, porque quedó después de `Costo:`);
  - falta un campo, o `quién` no es válido (incluido `revisor`), o nombra una subtarea que no existe;
  - `regexDePermiso` devuelve `null`;
  - `motivoFijoDe` devuelve un motivo;
  - el primer argumento no-opción del comando cae en los permitidos de alguna subtarea: un agente podría editar el script y correrlo con los secretos;
  - una subtarea parece externa y no tiene permiso (reemplaza a `parecenExternas`).
- Aprobación: `--permiso <Pn|Nn> aprobado` reemplaza a `--externo <n> aprobado` (`:2036-2045`, `:2195`, `:2235`, `:2264`, `:2301-2303`) y deja `aprobado: <iso>` en `permisos` de `estado.json`.
- `--permiso-nuevo "<comando> · <servicio> · reversible: sí|no · Qué hace: … · Para qué: …" --sub <n> --paso <k>`: agrega a mitad de corrida un permiso que el usuario ya aprobó. Asigna `N1`, `N2`…, con rol `ejecutor`, `sub: n`, `nuevo: true` y `aprobado`. Falla si no pasa `regexDePermiso` o `motivoFijoDe`.
- Re-plan: conserva la aprobación de un `P` solo si `quién` y `comando` son idénticos, aunque cambie su número. Conserva cada `N` mientras su subtarea siga en el plan.
- `LOTES:`: una subtarea con un permiso `reversible: no` va sola. En `lotesDe` (`:577`), `barrera = esBarrera(permitidos) || s.sola`.
- `--tanda <n> --sub <lista>`: `--sub` es opcional y anota `en_curso` para las correcciones de la revisión final que usan permisos. Sin `--sub`, ningún permiso queda vigente.
- `--estado` y `--reanudar` muestran los permisos y si están aprobados (`:1138`).

**Hecho cuando:**

- Un plan con los tres permisos del ejemplo sale en `PARA APROBAR`, normal y compacto, sin AVISOS.
- Cada caso de AVISO de arriba lo produce.
- `--permiso P1 aprobado` deja `aprobado` en `estado.json`; con un id inexistente, falla.
- Un re-plan que cambia el comando deja ese permiso sin aprobar. Uno que solo renumera conserva la aprobación. Un `--ajuste` sin bloque conserva los permisos.
- `--permiso-nuevo` crea `N1` aprobado; con `pnpm *` o `git commit -m x`, falla. `N1` sobrevive a un re-plan.
- `S<n>.md` lista sus permisos.
- Una subtarea con permiso irreversible queda sola en `LOTES:`.
- `--tanda 2 --sub 1,3` deja `en_curso: [1, 3]`, y `--cambios --global` lo borra.
- Test de punta a punta con la salida real (`plan.md` §3, «Contrato de datos»): `--guardar plan`, `--permiso P1 aprobado`, `--base --sub 1` y `evaluar` deja pasar el comando; tras `--cambios --sub 1`, lo niega.

**Tests:** en `estado-fotos.test.mjs`, migrar los casos de `Externo` y agregar los de arriba. El de `--tanda --sub`, en `estado-cambios.test.mjs`.

**Reversión:** revertir los archivos.

---

## S3 · Orquestador: aprobación, permisos nuevos y servidores

**Archivos:** `qcc-implementador/herramientas/pasos.md`, `comun.md`.

**Depende de:** S2.

**Cambios:**

- `pasos.md`, paso 2 (`:12`): la lista de AVISOS pasa a los de permisos.
- `pasos.md`, paso 4 (`:18-19`):
  - Reversibles: pregunta con `multiSelect`, header «Permisos» (nunca «Plan»: el panel lo toma por la aprobación), una opción por permiso con comando, servicio y `Qué hace`. Lo no marcado queda sin aprobar. `AskUserQuestion` admite de 2 a 4 opciones: con más de 4 reversibles, otra pregunta; con uno solo, «Aprobar» y «No», sin `multiSelect`.
  - Cada `reversible: no` lleva su propia pregunta y la advertencia de que no se deshace. Si no caben, va otra llamada.
  - Por cada aprobado, `estado.mjs --permiso <Pn> aprobado --paso 4`, sola en su llamada a Bash y después de `--aprobado`.
  - Lo no aprobado pasa a «Queda para ti» o se quita.
- `pasos.md`, paso 5 (`:27`): un ejecutor que necesita algo no previsto vuelve `BLOQUEADO` con `NECESITA_PERMISO: <comando> · <servicio> · reversible: sí|no · Qué hace: … · Para qué: …`. El orquestador pregunta con las reglas del paso 4, registra con `--permiso-nuevo --sub <n>` y redespacha esa subtarea sola, con `--base --sub <n>` y el comando aprobado en su `CONTEXTO`. Ese reintento no cuenta como ciclo.
- `pasos.md`, paso 6: `--tanda <n> --sub <lista>` cuando una corrección de la revisión final usa permisos.
- Servidores y túnel (permiso de `orquestador`): se levantan con `run_in_background` antes del primer lote, se comprueba que responden y se cierran con `TaskStop` en el paso 7, también si el flujo termina DETENIDO. Tras un `--reanudar` se levantan de nuevo.
- `comun.md`:
  - `:13`: `--tanda` con `--sub`.
  - `:16`, `:34`, `:36`, `:47`: `Externo` pasa a permisos. Una fila nueva para `--permiso` y `--permiso-nuevo`.
  - `:49`: «Nunca» queda solo con lo de «Negado siempre». El resto se corre con permiso aprobado.

**Hecho cuando:** ninguna mención de `Externo:` queda en `pasos.md` ni en `comun.md`, y los pasos 4, 5 y 6 cubren los casos de arriba.

**Riesgos:** el orquestador no pasa por la guardia, así que su permiso es solo regla de texto. Por eso se limita a servidores y túnel. Claude Code puede pedir confirmación para `pnpm dev`: `allowed-tools` no se toca porque esa confirmación suma control.

**Reversión:** revertir los archivos.

---

## S4 · Planificador y ejecutor

**Archivos:** `qcc-implementador/herramientas/plan.md`, `qcc-implementador/agents/qcc-planificador.md`, `qcc-ejecutor.md`.

**Depende de:** S2.

**Cambios:**

- `plan.md`:
  - `:36`: se quita el campo `Externo` de la subtarea, y el formato incluye el bloque `PERMISOS A APROBAR:` antes de `Verificación final`.
  - `:41` y `:62`: «Queda para ti» solo para lo que no se puede correr aun con aprobación (criterio visual final, revisión legal, decisiones).
  - `:61`: el servidor de desarrollo directo sigue fuera del ejecutor; lo levanta el orquestador con permiso.
  - `:63`: el planificador propone permisos aunque el pedido no los nombre, cada uno con `Qué hace` y `Para qué`. Comando exacto, con la regla del comodín. Sin rol `revisor`.
- `qcc-planificador.md:26`: la misma regla.
- `qcc-ejecutor.md:35-39`: solo corre los comandos de `Permisos:` de su contrato y los aprobados que traiga su `CONTEXTO`. Si le falta algo, reporta `NECESITA_PERMISO` y no lo rodea. `:39` nombra `--permiso` y `--permiso-nuevo`.

**Hecho cuando:** ninguna mención de `Externo:` queda en esos archivos y las reglas de arriba están escritas.

**Reversión:** revertir los archivos.

---

## S5 · Docs y versión

**Archivos:** `FLUJOS.md`, `AGENTS.md`, `qcc-implementador/herramientas/config.ejemplo.md`, `qcc-implementador/.claude-plugin/plugin.json`.

**Cambios:** documentar los permisos y «Negado siempre». En `config.ejemplo.md`, aclarar que `guardia.externos` sigue siendo la lista de programas negados del proyecto y no tiene relación con los permisos. `version` 0.3.9 → 0.4.0.

---

## Lotes

`S1 | S2 | S3+S4 | S5`. S3 y S4 no comparten archivos.

## Verificación final

```
claude plugin validate qcc-panel
claude plugin test qcc-panel
node --test "qcc-implementador/herramientas/*.test.mjs"
node --test qcc-commit/herramientas/solo-git.test.mjs
```

## Riesgos

- **La guardia frena errores, no a un agente decidido.** Un `node` sobre un script temporal pasa, y ese script puede escribir `estado.json` y aprobarse solo. No se firman las aprobaciones: el control real es qué agentes se lanzan y la revisión final.
- **Script editable.** Si un permiso corre un script que una subtarea puede editar, el agente puede cambiarlo y correrlo con los secretos. `--guardar plan` lo marca con AVISO.
- **Lo que hace un programa aprobado no se ve.** La guardia revisa el comando, no lo que ese programa hace por dentro. Por eso cada permiso nombra el servicio exacto.
- **Producción.** Cada `reversible: no` lleva su propia pregunta. En horaki, `admin()` no tiene guarda de sandbox: un `.env` equivocado escribe en la base real.
- **Lotes.** La guardia no sabe qué ejecutor del lote hizo la llamada (`guardia.mjs:1288`). Un permiso reversible lo puede usar otro miembro del mismo lote. Los irreversibles van solos.
- **Fatiga de aprobar.** Muchos permisos invitan a aprobar sin leer. Por eso se agrupan los reversibles.
- **`Grep` sin `path` ni `glob`.** No se revisa: depende de que la búsqueda omita los archivos ocultos.
- **Destinos estrictos.** Un `cp` aprobado hacia `dist/` o un lockfile queda negado. Ningún caso actual lo necesita.

## Queda para ti

- Hacer la comprobación previa y anotar su resultado antes de lanzar S1.
- Cerrar o cancelar cualquier flujo /impl abierto antes de actualizar: los planes con `Externo:` no se migran.
- Después de actualizar, `/reload-plugins` y un `/impl` de prueba con un permiso inofensivo: comprobar que sin aprobar se niega, que aprobado pasa y que `TaskStop` libera el puerto de Vite en Windows.
- En horaki-sas, actualizar `.claude/implementador.md`: hoy manda Flow y la verificación visual a «Queda para ti», y esa regla pisa las comunes.
- Antes de usar permisos en horaki, confirmar que su `.env` apunta a un Supabase de desarrollo.

## Fuera de alcance

- Permisos para el revisor: revisa con la salida de los ejecutores y `SALIDA DEL OWNER`. Si hiciera falta, se agrega después, con una ventana que abra en cualquier `--cambios … --paso 6`.
- Permisos de `git` que escriben.
- Firmar las aprobaciones.
- Esperas de días dentro de una corrida (fin de un trial, crons): siguen siendo dos `/impl`.
- Medir y después decidir en el mismo plan.
- Revisión legal y criterio visual final.

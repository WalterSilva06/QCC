# Plan · Reanudar flujos /impl sin perderlos (impl 0.3.9)

Arregla los cuatro problemas que encontró la revisión de los commits `f138fa4` a `c2ff4e8` (reanudar flujos /impl cortados), y lo que faltaba para que el cambio de cuenta funcione de punta a punta.

| # | Problema | Arreglo |
|---|---|---|
| 1 | Un flujo con plan que lleva más de 6 h cortado se borra en el preflight y ya no se puede reanudar | Un flujo con plan y sin cierre nunca se vacía solo; `--forzar` lo archiva antes de vaciarlo |
| 2 | Al cambiar de cuenta (otro `CLAUDE_CONFIG_DIR`), la otra cuenta no ve el flujo | Los archivos de cada proyecto pasan a `<git-dir>/qcc-impl/` |
| 3 | Un `--reanudar` desde la misma sesión duplica la sesión (`sesiones: 2` con una sola sesión real) | No anotar la sesión si es la misma que la última |
| 4 | `verificar.test.mjs:318` falla a veces por tiempos (espera fija de 1200 ms en `:327`) | El test espera el aviso del hijo, no un tiempo fijo |
| 5 | El cierre desde otra cuenta pierde la primera sesión del flujo (tokens, tiempos y pedido) | La primera sesión cae en el `transcript` que guardó el preflight |

Clasificación: CRÍTICO (S1 y S2: cambian dónde viven los datos del flujo y cuándo se borran). Se tocan `.mjs` de `qcc-implementador/herramientas/`, `pasos.md`/`comun.md` y los docs.

---

## S1 · Los archivos de cada proyecto pasan a `<git-dir>/qcc-impl/` (arregla el 2)

**Archivos:** `qcc-implementador/herramientas/guardia.mjs`, `estado.mjs`, `costos.mjs`, `guardia.test.mjs`, `estado-fotos.test.mjs`.

**Cambios:**

- `guardia.mjs` agrega `gitDirDe(raiz)`: lee `<raiz>/.git` sin lanzar `git`. La raíz ya viene de `git rev-parse --show-toplevel` (en `raizDe` y en el hook, `guardia.mjs:1284`), así que `<raiz>/.git` es siempre el de la raíz.
  - Si `.git` es una carpeta, devuelve esa carpeta.
  - Si `.git` es un archivo (un worktree o un submódulo), toma su línea `gitdir: <ruta>` (con `trim()`, por el `\r\n` de Windows), resuelta contra `raiz` si es relativa. Así cada worktree tiene su propio flujo.
  - Si no hay `.git`, si la línea no está o si la carpeta resuelta no existe, devuelve null.
- `guardia.mjs` agrega y exporta `nombreDe(raiz)`: el `<proyecto>-<hash>` que hoy arma `registroDe` (`guardia.mjs:74-77`). `registroDe` lo usa, y el historial también (abajo).
- `registroDe(raiz)` cambia de destino:
  - Con `FLUJOS_REGISTROS` definido, la ruta de hoy (los tests no cambian de carpeta).
  - Si no, con `gitDirDe(raiz)`, `<git-dir>/qcc-impl/registro.jsonl`.
  - Si no hay git, la ruta de hoy, `<CLAUDE>/flujos/registros/<nombreDe(raiz)>.jsonl`.
- Lo que se calcula a partir de `registroDe` se muda con él, sin más cambios:
  - `flujoDe` → `<git-dir>/qcc-impl/registro-flujo/`.
  - La rotación del registro (`registro.1.jsonl`, `guardia.mjs:1261`) y `ultimaActividad` (`estado.mjs:225`).
  - Las cachés de `verificar.mjs` (`:93`, `:130`, `:183`): `-verificar.json`, `-verificar-salidas.json` y `-verificar-curso.json`.
- `guardia.mjs` agrega `carpetaGlobal()`: `FLUJOS_REGISTROS` o `<CLAUDE>/flujos/registros`. Ahí quedan `flujos.jsonl` y `historial/`, que lee el panel (`qcc-panel/hooks/historial.ts:13`), así que el panel no cambia.
- Cambiar los tres lugares que hoy sacan la carpeta global de `path.dirname(registroDe(RAIZ))` o de `path.dirname(FLUJO)`:
  - `costos.mjs:625`: `flujos.jsonl` → `carpetaGlobal()`.
  - `estado.mjs:1818-1819` (`archivarFlujo`): `historial/` → `carpetaGlobal()`, y el nombre de la carpeta archivada sale de `nombreDe(RAIZ)`, porque `path.basename(FLUJO)` ya no lo trae (daría `registro`).
  - `estado.mjs:1886`: `flujos.jsonl` → `carpetaGlobal()`.
- `estado.mjs:251` (la condición de seguridad de `rmSync`): **no reemplazarla** por «`FLUJO` es `flujoDe(RAIZ)`». `FLUJO` ya es `flujoDe(RAIZ)` (`estado.mjs:165`), así que esa condición se cumple siempre y la guarda dejaría de proteger. La de hoy (`path.dirname(FLUJO) === path.dirname(registroDe(RAIZ))`) sigue valiendo después de la mudanza, porque los dos quedan en `<git-dir>/qcc-impl`. Se endurece así: además del `-flujo` del final, la carpeta padre tiene que llamarse `qcc-impl` o ser `carpetaGlobal()`. Nunca se borra otra ruta.
- `pedido.md`: se escribe en el primer `--guardar … exploracion` (con `pedidoDelFlujo`, mientras la sesión del preflight está a mano) si todavía no existe. Así un `--reanudar` desde otra cuenta lo tiene sin leer los transcripts de la primera cuenta. `reanudar()` sigue con su respaldo actual (`estado.mjs:1163-1172`). Un fallo al buscarlo nunca hace fallar `--guardar`: va en `try`, como en `reanudar()`.
- Comentarios con la ruta vieja, en el mismo cambio: `guardia.mjs:12`, el JSDoc de `registroDe` (`guardia.mjs:67-72`) y la cabecera de `estado.mjs` (`:33`, `:37-39`: la carpeta del flujo, `registros/flujos.jsonl` y `registros/historial/`).

**Hecho cuando:**

- Sin `FLUJOS_REGISTROS`, en un repo con `.git` como carpeta, `registroDe` y `flujoDe` caen dentro de `.git/qcc-impl/`.
- Con `.git` como archivo (`gitdir: …`, con y sin `\r\n`, relativa y absoluta), caen dentro de esa carpeta git.
- Sin `.git`, o con un `gitdir:` que apunta a una carpeta que no existe, dan la ruta de hoy.
- `flujos.jsonl` y `historial/` siguen en `<CLAUDE>/flujos/registros/`, y la carpeta archivada se sigue llamando `<AAAAMMDDTHHMMSS>-<proyecto>-<hash>` (el test `estado-cambios.test.mjs:609` pasa sin cambios).
- `pedido.md` existe después de `--guardar … exploracion`, o `--guardar` no falla si no encuentra el pedido.

**Tests:**

- `guardia.test.mjs`: `registroDe` y `flujoDe` con los casos de arriba (borrando `FLUJOS_REGISTROS` solo dentro del test y restaurándolo en un `finally`). `nombreDe` da el mismo nombre que hoy.
- `estado-fotos.test.mjs`: `pedido.md` después de `--guardar exploracion` si el fixture trae un transcript con `/impl`; si no lo trae, que `--guardar` no falle.

**Riesgos:**

- Comprobar primero que `qcc-impl/` no choca con nada de git: no es un nombre que git use, y `git gc` y `git clean` no tocan carpetas desconocidas de `.git/`.
- `arbolDe` no ve `.git/`, así que la carpeta nueva no cambia la foto ni sale en `--cambios`.
- La guardia niega escribir en `.git/` (`guardia.mjs:318`), pero solo a los subagentes, por Edit/Write y redirecciones. `estado.mjs` y `verificar.mjs` escriben con node desde el hilo principal, y las lecturas (`S<n>.md`, `mapa.md`, `plan.md`) no se filtran por ruta: los despachos siguen funcionando.
- `git worktree remove` borra `.git/worktrees/<n>/` y con ella el flujo de ese worktree. `flujos.jsonl` y `historial/` sobreviven porque están en la carpeta global.
- Un flujo abierto en la ruta vieja al actualizar no se ve: no se migra. Hay que cerrarlo antes de actualizar.
- La ruta nueva solo la prueba el test unitario de `registroDe`: los tests de integración corren con `FLUJOS_REGISTROS`. Por eso la prueba manual de «Queda para ti».

**Reversión:** revertir los cambios de los cinco archivos. Los datos nuevos quedan en `.git/qcc-impl/` y se pueden borrar.

---

## S2 · Un flujo con plan nunca se vacía solo (arregla el 1)

**Archivos:** `estado.mjs`, `estado-cambios.test.mjs`, `pasos.md` (paso 0), `comun.md` (§1, la fila del preflight).

**Cambios:**

- En `flujoAbierto()` (`estado.mjs:241`):
  - Sin plan: sigue el tope `ABIERTO_MIN` (20 min).
  - Con plan y sin cierre: devuelve el flujo siempre, sin tope de tiempo, con `minutos` y un campo nuevo `cortado: minutos >= ABIERTO_CON_PLAN_MIN`.
  - Actualizar su JSDoc (`:237-239`) y la cabecera de `estado.mjs` (`:35-36`, «o 6 h si ya tiene plan»).
- El AVISO del preflight (`estado.mjs:1363`) cambia según `cortado`:
  - Si es true: `AVISO: hay un flujo cortado en este repo («<título>», empezó …, sin actividad hace <n> h). No vacié su carpeta.` y siempre la línea `REANUDAR: …` (`:1366`).
  - Si es false: el texto de hoy.
- `--forzar` con un flujo anterior que tiene plan y no tiene cierre: antes de vaciar la carpeta, `archivarFlujo` la copia en `historial/` (sin fila en `flujos.jsonl`), para que «Empezar de cero» no borre el rastro del flujo. Sin plan, o ya cerrado, como hoy.
- `pasos.md`, paso 0:
  - Con `AVISO: hay un flujo cortado`, la pregunta ofrece solo «Reanudar» (recomendada) y «Empezar de cero» (que lo archiva y vacía la carpeta).
  - Con `AVISO: hay otro flujo abierto`, queda como hoy.
- `comun.md` §1, la fila del preflight: decir que un flujo con plan y sin cierre no se vacía sin `--forzar`, y que `--forzar` lo archiva en `historial/` antes de vaciarlo.

**Hecho cuando:**

- Un preflight con un flujo que tiene plan, no tiene cierre y lleva 7 h sin actividad no vacía la carpeta e imprime `flujo cortado` y `REANUDAR:`.
- Con `--forzar`, la archiva en `historial/` y la vacía.
- Sin plan y con más de 20 min sin actividad, la vacía, como hoy.

**Tests:** en `estado-cambios.test.mjs`, **reescribir** el tramo final del test que ya existe (`:433-447`), que hoy espera lo contrario:

- `:444-445`: después de `envejecer(7)`, hoy se espera que no haya AVISO. Pasa a esperar `^AVISO: hay un flujo cortado` y `^REANUDAR:`, y que `estado.json` siga en la carpeta con su plan.
- Después, `--paso 0 --forzar`: la carpeta queda vacía y en `historial/` hay una carpeta con el `estado.json` del flujo con plan.
- `:446-447` (sin plan, 20 min): hoy cuenta con que el preflight de las 7 h vació la carpeta. Pasa a ir después del `--forzar`, que deja un estado sin plan; ahí `envejecer(1)` sigue sin AVISO.

**Riesgos:** un flujo abandonado a propósito va a preguntar en cada `/impl` hasta que se elija «Empezar de cero». Es lo buscado.

**Reversión:** revertir los cambios de los cuatro archivos.

---

## S3 · Sin sesión duplicada en `--reanudar` (arregla el 3)

**Archivos:** `estado.mjs`, `estado-cambios.test.mjs`, `pruebas-comun.mjs`.

**Cambios:** en `reanudar()` (`estado.mjs:1154`; la sesión se anota en `:1162`):

- Si `sesionActual().id` existe y es igual al `id` de la última sesión anotada, no se agrega otra y la salida dice `REANUDADO: misma sesión del flujo · <iso>`. Igual se cierran las fases en paralelo y se borra `en_curso`.
- Si no, se agrega como hoy. Solo se compara con la última: A → B → A son tres tramos distintos en `leerFlujo` (`costos.mjs:224`) y se suman bien.

**Hecho cuando:** dos `--reanudar` seguidos con el mismo `CLAUDE_CODE_SESSION_ID` dejan una sola entrada con ese id en `estado.sesiones`. Con otro id, dejan dos.

**Tests:** en `estado-cambios.test.mjs`, en el test de `--reanudar` (`:872`):

- Cambian las aserciones que hoy dan por bueno el duplicado: `:898` (`REANUDADO: sesión 3 del flujo`) pasa a `REANUDADO: misma sesión del flujo`, y `:901` (`['sesion-b', 'sesion-b']`) pasa a `['sesion-a', 'sesion-b']` (ver abajo).
- El preflight del flujo corre dentro de `repoConPlanGuardado` (`pruebas-comun.mjs:132`), no en el test, y hereda `process.env` (`pruebas-comun.mjs:39`): corrido desde Claude Code, `sesiones[0]` toma el id de la sesión real. `repoConPlanGuardado` agrega `CLAUDE_CODE_SESSION_ID: 'sesion-a'` a su `entorno` (`:129`), y la aserción de `:901` compara la lista entera, sin `slice(1)`: `['sesion-a', 'sesion-b']`. Comprobar que el otro test que usa el helper (`estado-cambios.test.mjs:108`) sigue pasando.
- Un caso nuevo: un `--reanudar` con `sesion-b` y otro con `sesion-c` dejan `['sesion-a', 'sesion-b', 'sesion-c']`.

**Reversión:** revertir los cambios de los tres archivos.

---

## S4 · El test de la corrida en curso sin espera fija (arregla el 4)

**Archivos:** `verificar.mjs`, `verificar.test.mjs`.

**Causa:** el test escribe `fin` en la marca a los 1200 ms (`verificar.test.mjs:327`). Si el hijo tarda más en calcular el árbol (máquina cargada, `git add` lento en Windows), lee la marca ya terminada, no espera y corre sus propios pasos.

**Cambios:**

- `verificar.mjs:413-414`: imprimir `(espera la corrida en curso de las <hora>)` (con `previa.inicio`) entre `enCurso(previa, clave)` y `esperarCorrida`, no después, y quitar la línea `(esperó …)` de `:422`. Ese orden (leer la marca, avisar, esperar) es el que hace determinista al test.
- `verificar.test.mjs`:
  - `verificarAsync(raiz, alLeer)` recibe un callback que se llama con cada trozo de la salida del hijo.
  - El test `:318` escribe `fin` en la marca cuando ve `/^\(espera la corrida/m`, sin el `setTimeout` de `:327`.
  - `:296`, `:310` y `:330` cambian su regex de `esperó` a `espera la corrida`.

**Hecho cuando:** `verificar.test.mjs` no tiene ninguna espera fija para sincronizarse con el hijo y pasa 10 veces seguidas: `for i in $(seq 10); do node --test qcc-implementador/herramientas/verificar.test.mjs || break; done`.

**Riesgos:**

- La línea sale al empezar la espera, no al final. Nada la lee: se buscó «esperó» en el panel, en `estado.mjs` y en los docs, y solo aparece en estos tests.
- Si la corrida esperada muere, la salida trae la línea `(espera …)` y después la corrida propia (el bucle de `:411` puede imprimirla más de una vez). Es correcto.

**Reversión:** revertir los cambios de los dos archivos.

---

## S5 · El cierre desde otra cuenta suma la primera sesión (arregla el 5)

**Archivos:** `costos.mjs`, `costos.test.mjs`.

**Causa:** `leerFlujo` (`costos.mjs:225`) busca la primera sesión con `sesionDelFlujo`, que mira solo `projects/` de la cuenta actual y elige la sesión que vio primero la marca `BASE_GLOBAL=<base>` (`costos.mjs:158-176`). `--reanudar` también imprime esa marca (`mostrarEstado`, `estado.mjs:1115`), así que, cerrado desde la cuenta B, `sesionDelFlujo` no da null: da la sesión reanudada de B. El tramo de la cuenta A se pierde (la fila de `flujos.jsonl` pierde sus tokens, sus tiempos y el pedido) y B entra dos veces, como primera y como reanudada (`sesiones[1]`).

**Cambios:** en `leerFlujo`, si `sesiones[0]?.transcript` existe en disco (el preflight lo guarda con ruta absoluta, `estado.mjs:208-212`) y `sesionDelFlujo` da null o da otro archivo, la primera sesión es `tramoReanudado(sesiones[0], carpeta, base)`. Si da ese mismo archivo (el caso de una sola cuenta), sigue lo de hoy, así que los flujos de una cuenta no cambian de resultado. Sin `transcript` en `sesiones[0]`, también lo de hoy: sin él, `tramoReanudado` busca la marca en la cuenta actual y encontraría la sesión de `--reanudar`.

**Hecho cuando:**

- Cuenta B: su carpeta `projects/` tiene solo el transcript de la sesión reanudada, con la marca `BASE_GLOBAL=<base>` (como la deja `--reanudar`), y `sesiones[0].transcript` apunta a un transcript de la carpeta de la cuenta A. `metricasDelFlujo` da `sesiones: 2`, suma los tokens de los dos tramos una sola vez cada uno, y el pedido sale del transcript de A.
- Una sola cuenta (`sesionDelFlujo` da el mismo archivo que `sesiones[0].transcript`): lo de hoy; los tests que ya existen pasan sin cambios.
- Sin `transcript` en `sesiones[0]`: lo de hoy.

**Tests:** en `costos.test.mjs`, el caso de la cuenta B y el de sin `transcript`, con dos carpetas `projects/` temporales (una por cuenta). El transcript de B lleva la marca: sin ella `sesionDelFlujo` daría null y el test pasaría aunque el código siguiera mal.

**Riesgos:** sin `transcript` en `sesiones[0]` (preflight corrido sin `CLAUDE_CODE_SESSION_ID`), el cierre desde B sigue contando B dos veces, como hoy. Queda fuera de alcance.

**Reversión:** revertir los cambios de los dos archivos.

---

## S6 · Docs y versión

**Archivos:** `FLUJOS.md`, `AGENTS.md`, `qcc-implementador/.claude-plugin/plugin.json`.

**Cambios:**

- `FLUJOS.md:34` y `:127`, y `AGENTS.md:9` («Los registros siguen en `~/.claude/flujos/registros`»): la carpeta del flujo, el registro de la guardia y las cachés de `verificar` viven en `<git-dir>/qcc-impl/`, una por repo y por worktree, compartida entre cuentas. `flujos.jsonl` y `historial/` siguen en `~/.claude/flujos/registros/`.
- `FLUJOS.md`: un flujo con plan y sin cierre no se vacía sin `--forzar`, y `--forzar` lo archiva en `historial/` antes de vaciarlo.
- `MODS.md:108` no cambia: `flujos.jsonl` sigue donde está.
- `plugin.json`: `version` 0.3.8 → 0.3.9.

---

## Lotes

- `S1+S4 | S2+S5 | S3 | S6`.
- S1 y S4 no comparten archivos.
- S5 depende de S1 (los dos tocan `costos.mjs`). S2 y S5 no comparten archivos.
- S2 y S3 tocan funciones distintas de `estado.mjs`, pero el mismo archivo y el mismo test (`estado-cambios.test.mjs`), así que van en serie.

## Verificación final

```
claude plugin validate qcc-panel
claude plugin test qcc-panel
node --test "qcc-implementador/herramientas/*.test.mjs"
node --test qcc-commit/herramientas/solo-git.test.mjs
```

## Queda para ti

- Cerrar o cancelar cualquier flujo /impl abierto antes de actualizar: no se migra.
- Después de actualizar, `/reload-plugins` y un `/impl` de prueba con un corte simulado: preflight, aprobar, `--reanudar`, cierre. Comprobar que la carpeta del flujo quedó en `.git/qcc-impl/`.
- Si se puede, repetir el `--reanudar` y el cierre desde la otra cuenta, y ver que la fila de `flujos.jsonl` tiene `sesiones: 2`.
- Opcional: archivar a mano las carpetas viejas `~/.claude*/flujos/registros/*-flujo/` y `*-verificar*.json`.

## Fuera de alcance

- Migrar automáticamente los flujos abiertos de la ruta vieja.
- `ejecutoresDelProyecto` sigue leyendo solo los transcripts de la cuenta actual. El avance de cada subtarea ya queda en `estado.json` (`anotarAvance`), pero si cambias de cuenta justo en una tanda de correcciones, `SIGUE` puede dar la tanda «a medias» y pedir que la repitas.
- `qcc-panel/hooks/historial.ts:13` tiene `.claude` fijo y no respeta `CLAUDE_CONFIG_DIR`: es otro problema, aparte de este plan.

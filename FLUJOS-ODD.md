# /qcc-implementador-odd

Flujo en prueba, para compararlo con `/qcc-implementador` en tareas reales. Vive en `flujos-odd/` y está **separado por completo** de `flujos/`: tiene su skill, sus agentes, sus herramientas, su instalador, su config por proyecto y su registro. No usa ningún archivo de `/qcc-implementador`, y `/qcc-implementador` no usa ninguno suyo. Las reglas generales del repo están en [AGENTS.md](AGENTS.md).

Toma las ideas del ODD (Organic Driven Development) de [gentle-ai](https://github.com/Gentleman-Programming/gentle-ai) en una versión lite, enfocada en calidad y en ahorrar tokens.

## Principio

En una tarea chica, el orquestador trabaja inline: un subagente se lanza solo por un motivo nombrado, porque relee todo desde cero y eso cuesta tokens. En una grande, el orquestador solo coordina: el explorador lee el código y los ejecutores lo editan. Así su contexto no crece con cada pedido, que en las corridas grandes era ~75% del costo. Fuera de la tabla, la cantidad de líneas o de tests no lanza un agente.

| Rol | Modelo · esfuerzo | Cuándo |
|---|---|---|
| Orquestador (la skill) | Sonnet · high | siempre; implementa solo en una chica |
| `qcc-odd-explorador` | Haiku · high | **Grande prevista:** siempre, uno, antes de leer código (salvo `explorar: nunca`). **Chica:** `explorar: siempre`; o un pedido que no nombra sus archivos en un repo de más de ~200 archivos de código, con más de ~5 archivos por leer, o que pide más de una tanda de lectura (≤ 3 llamadas, ~10k tokens). Nunca con `explorar: nunca` |
| `qcc-odd-ejecutor` | Sonnet · high | **Grande:** siempre, todo el código, en 2–3 despachos (el contrato compartido primero y en serie, el resto en paralelo). **Chica:** 2 o más unidades independientes de más de ~100 líneas, en paralelo; o una salida de `odd.mjs` dice `CONTEXTO` de más de 150k |
| `qcc-odd-revisor` | Opus · high | el cambio toca un ítem de riesgo |

## Fases

1. **Inicio:** la skill inyecta `odd.mjs --inicio` con una línea `!` al cargarse, con un `|| echo "AVISO…"` que dice qué hacer si falla; el orquestador no lo vuelve a correr. Un pedido vacío, o de solo investigar o explicar, corre `odd.mjs --cancelar` (cierra la marca sin anotar la corrida) y se responde sin editar.
2. **Explorar:** primero, solo con el pedido, el tamaño previsto: grande con más de ~8 reglas, una feature que no nombra sus archivos o una tarea retomada de `odd/tasks/`. Grande → el explorador con `TAMAÑO: grande`, antes de leer código: la guardia ve el despacho y anota `grande` sola (`odd.mjs --previsto grande` explícito sigue valiendo). Chica → inline, o con el explorador por su condición. El explorador responde en ≤ 15 líneas (~40, por área, en una grande) con tramos `ruta:inicio-fin`, `USOS:` (cada llamador de una función compartida, candidato al ítem 3), `FIRMA:` (firma e invariantes, solo en una grande), `TESTS:` y `FIJAN:` (los tests que fijan constantes, listas o `deepEqual` que el cambio altera: el orquestador los suma a los `ARCHIVOS PERMITIDOS` del despacho que toca ese valor). El orquestador lee solo esos tramos. Una decisión de producto abierta se pregunta una vez. Termina con `odd.mjs --plan`, que deja visibles dos decisiones:
   - **Tamaño:** `chico` si se puede retomar solo con el pedido y el `git diff`; `grande` si no. Con `grande`, la guardia le niega al orquestador editar fuera de `odd/tasks/`.
   - **Riesgo:** los 6 ítems de la skill (datos o irreversible, seguridad, contratos que otros consumen, concurrencia, entrega o entorno, sin tests), más los `criticos` del proyecto, cada uno con `sí <motivo>` o `no`, y los bordes si hay alguno.
3. **Implementar:** test-first cuando hay runner, un test por regla. Los bordes de una regla van como tabla de casos dentro de su test. Un test de «sigue igual» va solo si ningún test existente ejercita ese camino. Una chica, inline. Una grande lleva primero `odd/tasks/<feature>.md` en el repo del proyecto:
   - `## Specs` con `S#` que citan literal el pedido;
   - `## Tasks`, cada tarea con su `Qué:` (por archivo, el cambio y las decisiones técnicas con su porqué);
   - `## Mapa`, la respuesta del explorador por `ÁREA` (tramos `(editar)`, `FIRMA:`, `USOS:`, `TESTS:`), escrita una vez;
   - `## Log`, donde `L1` es el pedido textual.

   Ese documento permite retomar la tarea en otra sesión. Después, las tareas van agrupadas por archivos en 2–3 despachos de ejecutor: primero, corto y en serie, el contrato compartido (esquema, migración, tipos, constantes, estados); después todos los demás en un mismo mensaje, en paralelo y con archivos disjuntos. El despacho es una plantilla fija (`DOC`, `ARCHIVOS PERMITIDOS`, `MAPA`, `REUSA`, `TESTS`, `CORRIGE`) sin texto extra. Su `MAPA:` (solo en una grande) no copia tramos: apunta a `## Mapa · ÁREA <nombre>` del documento, para que el ejecutor no explore. El orquestador da una línea de progreso por paso y no resume los reportes de los agentes: el resumen va solo en el reporte final. Tras cada uno, el orquestador comprueba (`git status`, el test RED→GREEN con Grep y `--diff --stat`) y marca las casillas. Lo que falta o falla, en esta fase o en la revisión, va a otro ejecutor con `CORRIGE:`.

   **Continuar agentes (supuesto).** En una grande, para `NECESITA_ALCANCE`, `CORRIGE:` y el rechequeo, el orquestador continúa al mismo agente con SendMessage (lo carga con `ToolSearch select:SendMessage` si no está) en vez de lanzar uno nuevo; el nuevo alcance va como las líneas de la plantilla que cambian, y la información nueva manda sobre la anterior. Tras un SendMessage no termina el turno: el agente se reanuda en segundo plano y su reporte llega como notificación, así que espera dentro del mismo turno con comandos cortos (por ejemplo `node -e "setTimeout(()=>{},100000)"`, nunca un `sleep` largo, que el entorno bloquea) y revisa con ListAgents hasta que deje de estar `running`. Si el mensaje falla o el agente ya terminó, lanza uno nuevo con su plantilla completa. Está sin verificar si la continuación conserva el hook de la guardia del agente: por eso el orquestador sigue comprobando con `git status --short` que cada ejecutor quedó en sus permitidos.
4. **Revisar:**
   - el formateador del proyecto, si hay, solo sobre lo tocado y antes de verificar;
   - con ítem 3 por código compartido, un diferencial, antes de verificar para que sus correcciones entren en esa verificación: `odd.mjs --diferencial -- "<comando>"` corre el comando existente que comparte ese código en la copia de la BASE y en el repo, y compara salida, errores y código de salida; `verificar.mjs` lo repite al final, así que una edición posterior solo obliga a repetir `verificar.mjs`. Si el autochequeo descubre un ítem 3 no previsto, corre entonces y obliga a repetir `verificar.mjs`;
   - `verificar.mjs` una vez, un autochequeo y la línea `Riesgo:`. El autochequeo lee `odd.mjs --diff` entero; en una grande con riesgo nombrado va por `S#` con su evidencia (RED→GREEN, `--diff --stat`, el RESULTADO de verificar) y el diff entero lo lee el revisor.

   El revisor corre solo con un ítem nombrado. El despacho es una plantilla fija, sin texto extra: `BASE`, `DOC` (o `PEDIDO`), `RIESGO`, `VERIFICACIÓN`, `DIFERENCIAL` (la línea que imprimió `--diferencial`, o `no aplica`), `FOCO` y, solo al rechequear, `REVISIÓN ANTERIOR`. El `FOCO:` son las funciones compartidas y los tramos con riesgo (de los `USOS:`), los críticos tocados y el diferencial: empieza por ahí y amplía solo si no alcanza. No rehace el diferencial que recibe. Un defecto reproducible que causa el cambio es un PROBLEMA, nunca una OBSERVACIÓN. Sus correcciones:
   - un lote que corrige todos los problemas, cada uno con un test que repite la reproducción del revisor;
   - un rechequeo limitado a esos problemas;
   - una segunda corrección, solo si el mismo problema sigue fallando.

   Lo nuevo que aparezca, y lo que siga abierto, va a «Para decidir».
5. **Cierre:** `odd.mjs --limpiar` con los temporales de la corrida, `odd.mjs --cierre` y el reporte, con su línea `PROCESO`. No hace commits (para eso, `/qcc-commit`).

No tiene aprobación del plan, ni planificador, ni revisor del plan, ni candado, ni fotos por subtarea.

## Herramientas

Se instalan en `~/.claude/flujos-odd/`. La skill y los agentes las llaman por esa ruta.

- **`odd.mjs`:**
  - `--inicio` toma la foto base como commit suelto y la imprime como `ODD_BASE=<sha>`. Además muestra rama, sucios previos, cuántos archivos de código hay y `explorar`, `criticos`, las reglas de la guardia del proyecto, pasos de verificación y los `odd/tasks/*.md` con tareas abiertas. Deja la marca de corrida abierta (`registros/activas/`), que activa la guardia del orquestador; `--cierre` o `--cancelar` la borran.
  - `--plan --base <BASE> --tamano chico|grande --reglas <n> --riesgo "1:sí <motivo>;2:no;…;6:no" [--bordes "…"]` imprime `TAMAÑO`, `RIESGO PREVISTO` y `BORDES`. Falta un ítem, un `sí` sin motivo o los bordes con algún `sí`: `ERROR` y código 2. Con más de 8 reglas y `chico`, avisa `AVISO: <n> reglas → grande`. Anota el tamaño en la marca de corrida; con `grande` imprime además `GRANDE: el código lo edita qcc-odd-ejecutor…`.
  - `--previsto chico|grande` anota solo el tamaño en la marca de corrida, igual que `--plan` pero antes de él y sin `--base`, riesgo ni bordes. Imprime `PREVISTO: <tamano>` y, con `grande`, que la guardia limita el `Read` y el `Edit`/`Write` del orquestador. Otro valor: `ERROR` y código 2, sin tocar la marca. Sin marca (sin `--inicio`) no hace nada.
  - `--diff <BASE> [--stat] [-- <rutas>]` da el cambio contra una foto nueva, archivos nuevos incluidos, recortado a 400 líneas. Con `--stat`, solo el resumen: es el control tras un despacho y no cuenta como el `--diff` del autochequeo.
  - `--cierre` borra la marca, anota la corrida en `registros/odd.jsonl` con su costo e imprime `PROCESO`: `ok`, o los desvíos que lee en el transcript (sin `--plan` o después de editar, ediciones por Bash, una edición después del último `verificar.mjs`, del último `--diff` o del diferencial, contexto de más de 150k sin ejecutor, lecturas con `cat`/`head`/`sed -n`). Con `--tamano grande`, además: sin explorador (salvo `explorar: nunca`), sin ejecutor, código editado inline y más de 2 archivos leídos enteros antes de `--plan`. Con `--tamano grande` y un `--riesgo` distinto de `ninguno`, no marca «sin --diff» ni «editó después del último --diff»: el diff entero lo lee el revisor, no el orquestador (el `riesgo` ausente o vacío sigue exigiéndolo). Despachar un ejecutor cuenta como edición; escribir en `odd/tasks/`, no. Lo que negó la guardia no cuenta.
  - Con la clave `aceptacion` en la config (ver abajo), `--cierre` corre ese comando desde la raíz del repo después de anotar la corrida e imprime `ACEPTACIÓN: <pasan>/<total>`. Guarda `aceptacion: { pasan, total }` en la fila de `registros/odd.jsonl`. Una repetición de `--cierre` reemplaza la fila, como siempre. La clave ausente o de otro tipo no hace nada.
  - `--cancelar` borra la marca de corrida sin anotar nada en `registros/odd.jsonl`, para un pedido vacío o de solo investigar que no llegó a ser una corrida. Imprime `CANCELADA: corrida cerrada sin anotar`, o `CANCELADA: no había corrida abierta` si no había marca; en los dos casos sale con código 0.
  - `--plan`, `--diff` y `--cierre` imprimen `CONTEXTO: <n>k`, el del último pedido del orquestador. Pasados los 150k agregan `> 150k: lo que falta va a qcc-odd-ejecutor`.
  - `--ultimos [n]` lista las últimas corridas con el promedio de costo y de minutos. El costo es el real, hasta el siguiente mensaje del usuario (incluye el reporte), junto al anotado al cierre. Una fila con aceptación agrega `aceptación <pasan>/<total>`; el promedio no cambia.
  - `--copia-base <BASE>` copia el árbol de la BASE en un temporal nuevo, sin tocar el índice del usuario, y lo imprime como `ODD_COPIA=<ruta>`. No trae lo ignorado (como `node_modules`).
  - `--diferencial [--base <BASE>] -- <cmd…>` corre el comando (lo que sigue a `--`, unido con espacios) en una copia de la BASE y en el repo, y compara salida, errores y código de salida. La BASE sale de `--base` o de la marca de corrida. Cada árbol corre con `ODD_DIF_DIR` apuntando a una carpeta temporal distinta, para el estado que la prueba escriba, y con `CI=1` (tope de 300 s). Imprime `DIFERENCIAL: <cmd> → igual`, o `→ DIFIERE` con hasta 40 líneas `- copia` / `+ repo` y el código de salida de cada una. Código de salida 0 si es igual, 1 si DIFIERE y 2 si hay `ERROR`: comando vacío, sin BASE (ni `--base` ni marca) o un comando que la guardia niega. Antes de ejecutar valida el comando con la guardia, con el rol `ejecutor`; si lo niega, no se ejecuta ni se guarda. Guarda el comando en la marca como `diferenciales` (sin repetidos; sin marca no guarda). Borra la copia y las carpetas de trabajo al terminar.
  - `--limpiar -- <rutas>` borra las rutas que están dentro de un temporal, también en la forma `/tmp/…` de Git Bash. No borra el temporal mismo ni nada fuera de él: lo lista en `NO BORRADOS`.
- **`verificar.mjs`:**
  - corre los pasos de `verificar` de la config, o los detecta (scripts de `package.json`, Cargo, Go o pytest);
  - corre todos aunque uno falle, con CI=1 y un tope por paso;
  - muestra una línea por paso y, solo de los que fallan, las últimas 60 líneas;
  - no tiene caché;
  - al final, con una corrida abierta cuya marca trae `diferenciales` (un arreglo; otro valor se ignora), repite cada diferencial contra la `base` de la marca, validándolo de nuevo con la guardia, e imprime una línea por comando. Uno que DIFIERE o que la guardia niega cuenta como un paso `diferencial` en ROJO (`RESULTADO: ROJO (diferencial)`). Así «verificar después de la última edición» cubre también el diferencial. Sin diferenciales no cambia nada.
- **`guardia.mjs`:** hook `PreToolUse` de `qcc-odd-ejecutor`, `qcc-odd-revisor` y la skill (rol `orquestador`).
  - **Agent/Task del orquestador:** si hay una corrida abierta y despacha `qcc-odd-explorador` con una línea `TAMAÑO: grande` en el `prompt`, la guardia anota `grande` en la marca, sin depender de que el modelo corra `--previsto`. Nunca niega y nunca baja `grande` a `chico`; sin `subagent_type` ni `prompt`, o con otro agente, pasa sin anotar. Por eso el matcher del hook de la skill incluye `Agent|Task`.
  - **Niega:**
    - git que modifica o habla con el remoto;
    - instalar o quitar dependencias;
    - red;
    - borrados recursivos;
    - secretos (`.env*`, salvo `.example`, `.sample` y `.template`);
    - servidores y modos watch;
    - escribir `.git/`, `.claude/settings*.json`, `.claude/agents/`, lockfiles o fuera del repo;
    - las reglas del proyecto: escribir un `protegido`, editar un `inmutable` versionado y correr un `scriptsNegados`.
  - **Al revisor,** además, escribir fuera del temporal. No expande `$(…)`, así que pide rutas temporales escritas a mano.
  - **Al ejecutor,** además, escribir en el repo por Bash o PowerShell (redirección, `sed -i`, `tee`, `cp`/`mv`, `Set-Content`, `Out-File`, o un script en línea o del temporal que escribe archivos del repo), con el motivo `edita con Edit o Write`: el repo se edita con esas herramientas. Pasa si el destino es el temporal, y también borrar archivos sueltos (`rm`, `Remove-Item`), crear carpetas, correr tests y scripts del proyecto y las herramientas del flujo. De un script que escribe, deja pasar el que menciona el temporal (`os.tmpdir()`, `/tmp`…) cuando no se ve el destino. El aviso termina en `usa la herramienta que dice, o anótalo en BLOQUEOS de tu reporte`.
  - **Al orquestador:** escribir en el repo por Bash o PowerShell (redirección, `sed -i`, `tee`, `cp`/`mv`, `Set-Content`, `Out-File`, o un script en línea o del temporal que escribe archivos), con el motivo `edita con Edit o Write`; y leer archivos del repo con `cat`, `head`, `tail`, `sed -n`, `Get-Content` o `type`, con el motivo `lee con Read (offset/limit) o Grep`. Las dependencias sí las instala, borra archivos sueltos y corre los scripts del proyecto. Si `--plan` o `--previsto` anotó `grande`, además le niega Edit y Write en el repo fuera de `odd/tasks/`, con el motivo `tarea grande: el código lo edita qcc-odd-ejecutor`, y Read sobre archivos del repo fuera de `odd/tasks/` sin `limit` o con `limit` mayor que 120, con el motivo `tarea grande: no leas código aquí, usa los tramos del explorador`. Un Read con `pages`, con un `limit` no numérico o fuera del repo pasa. Un hook de skill sigue activo el resto de la sesión, así que este rol solo niega con una corrida abierta (la marca de `--inicio`, que borran `--cierre` o `--cancelar` y vence a las 12 h) y nunca dentro de un subagente.
  - **El cuerpo de un heredoc** es datos: no se evalúa como comandos. `=>`, `->` y `>=` no son redirecciones, ni un `>` entre comillas. Un shell anidado (`bash -c`, `cmd /c`, `powershell -Command`) se evalúa como un comando más. Las herramientas del flujo (`~/.claude*/flujos-odd/`) corren aunque escriban archivos.
  - **Es lite a propósito:** ante la duda deja pasar, y un error propio nunca niega.
- **`costo.mjs`:** busca en los transcripts la sesión que recibió `ODD_BASE=<sha>` y suma el costo del orquestador y de cada agente, por rol, con los precios oficiales de octubre de 2026. Da también el contexto actual del orquestador.
- **`proceso.mjs`:** lee las herramientas del orquestador en el transcript y arma la línea `PROCESO` de `--cierre`. Recibe `tamano` y `riesgo` de `--cierre`; en una grande con riesgo omite los dos desvíos del `--diff`. Un comando `odd.mjs --diferencial` cuenta como diferencial, y entonces no se agrega «editó después del diferencial»: lo cubre «editó después del último verificar.mjs». El diferencial manual (`--copia-base`) conserva su comportamiento.
- **`copia.mjs`:** lo usan `odd.mjs` y `verificar.mjs`, sin importar de `odd.mjs`. `copiaBase(raiz, base)` hace el árbol de la BASE en un temporal `qcc-odd-base-*` (error claro si la BASE no existe) y `diferencial(raiz, base, cmd)` corre la comparación de `--diferencial` y limpia sus temporales (solo bajo `os.tmpdir()`, nunca el repo).

Los tests de todo están en `flujos-odd/herramientas/odd.test.mjs`.

## Configurar un proyecto

Todo es opcional. Sin config, `verificar.mjs` detecta los pasos y no hay críticos propios.

`.claude/qcc-implementador-odd.json`:

```jsonc
{
  // Pasos de verificación, en orden, desde la raíz del repo. Con [] el proyecto queda «SIN PASOS».
  // timeoutSeg (opcional): tope en segundos, 600 por defecto.
  "verificar": [
    { "nombre": "typecheck", "cmd": "pnpm run typecheck" },
    { "nombre": "test", "cmd": "pnpm run test", "timeoutSeg": 300 }
  ],
  // Cuándo se lanza el explorador: "siempre", "nunca" o, sin la clave, según el pedido y el repo.
  "explorar": "siempre",
  // Suite de aceptación (opcional), oculta al orquestador: un string con el comando, u objeto { cmd, timeoutSeg }
  // (600 s por defecto). --cierre la corre desde la raíz del repo. Resultado: la última línea
  // «ACEPTACION: <pasan>/<total>»; si no, el resumen TAP (# pass N, # fail M); si no, el código de salida
  // (0 → 1/1; otro o vencido → 0/1).
  "aceptacion": "node --test tests/aceptacion",
  // Rutas que cuentan como riesgo. riesgo: ítems 1–6 de la skill; si: condición; excepto: rutas que no cuentan.
  "criticos": [
    { "rutas": ["src/auth/"], "excepto": ["src/auth/textos.ts"], "riesgo": [2], "motivo": "autorización" },
    { "rutas": ["supabase/migrations/"], "riesgo": [1], "motivo": "esquema de la base" }
  ],
  // Reglas de la guardia, para los tres roles. Mismo significado que en la config de /qcc-implementador:
  // una clave que falta acá se toma de .claude/qcc-implementador.json (o .claude/implementador.json).
  "guardia": {
    // Archivos, carpetas (con / final) o globs que no se escriben, con el motivo.
    "protegidos": { "src/routeTree.gen.ts": "lo regenera el build" },
    // Carpetas o globs cuyos archivos versionados no se editan (los nuevos sí).
    "inmutables": ["supabase/migrations/"],
    // Scripts del gestor JS que no se corren.
    "scriptsNegados": ["db:*", "flow:*"]
  }
}
```

La config de este repo está en `.claude/qcc-implementador-odd.json`.

## Instalación

```
node flujos-odd/instalar.mjs              copia a ~/.claude lo que cambió
node flujos-odd/instalar.mjs --revisar    muestra qué cambiaría, sin copiar
node flujos-odd/instalar.mjs --traer      trae al repo lo que se editó directo en ~/.claude
node flujos-odd/instalar.mjs --forzar     pisa la copia instalada aunque sea más nueva
```

Copia `skills/` a `~/.claude/skills/`, `agents/` a `~/.claude/agents/` y `herramientas/` a `~/.claude/flujos-odd/`.
- **Copia editada:** si una copia instalada es distinta y más nueva que la del repo, se editó en `~/.claude`. El instalador la frena y termina con exit 1.
- **Nunca borra** y no toca `~/.claude/flujos-odd/registros/`.
- El flujo corre desde la copia instalada: un cambio en `flujos-odd/` no rige hasta instalarlo.

## Comparar con /qcc-implementador

```
node ~/.claude/flujos-odd/odd.mjs --ultimos 10
node ~/.claude/flujos/costos.mjs --ultimos 10
```

## Pendiente

El panel no sigue las fases en vivo de este flujo (no tiene pestaña Flujo para él). Sí registra los tokens de su orquestador en el gasto semanal (como `flujo|…`) y su historial lee `odd.jsonl` junto a `flujos.jsonl`, con la etiqueta `odd` y los tokens del orquestador; ver [MODS.md](MODS.md).

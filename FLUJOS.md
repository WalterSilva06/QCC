# Flujos

Los flujos son plugins del marketplace `qcc`: `impl` (carpeta `qcc-implementador/`), `impl-d` (carpeta `qcc-impl-directo/`) y `commit` (carpeta `qcc-commit/`). Las reglas generales del repo están en [AGENTS.md](AGENTS.md); el árbol de archivos, en [AGENTS.md](AGENTS.md#estructura).

## Comandos

| Comando | Uso | Para qué |
|---|---|---|
| `/impl` | `[-p] <qué cambiar>` | Cambios en cualquier proyecto con git: explora, clasifica, planifica, pide aprobación, ejecuta por subtareas y cierra con una revisión final independiente y verificación real. |
| `/impl-d:n` | `[-p] <qué cambiar>` | Cambios sin plan ni aprobación: explora con Haiku, la sesión implementa en Opus medium, verifica y cierra con una revisión independiente en Opus high y el % de los límites que gastó. |
| `/impl-d:e` | `[-p] <qué cambiar>` | El modo esfuerzo de `/impl-d`: el mismo flujo con la sesión en Opus high y la revisión en Opus xhigh. |
| `/commit` | `[por qué, opcional]` | Pregunta si hacer commit + push, solo commit o commit en una rama nueva; separa los cambios sin commit en commits por grupo, con mensaje en español, y los hace, todo en Haiku high. |

**`-p` (sin preguntas):** `/impl -p <qué cambiar>` y `/impl-d:n -p <qué cambiar>` corren sin AskUserQuestion, para cuando nadie responde (por ejemplo, `claude -p "/impl -p …"`). Cada duda toma la opción recomendada y el cierre la anota en `Decisiones sin preguntar:`. En `/impl` el plan se aprueba solo, `ALCANCE: FUERA` se restaura y otro flujo abierto lo termina. Ninguno aprueba permisos ni corre comandos irreversibles o externos: van a «Queda para ti». El `-p` no entra en el pedido guardado.

## /impl

`/impl` tiene un solo modo. El orquestador recibe por inyección `comun.md` (en dos partes), las reglas del proyecto y `pasos.md`; el planificador lee `plan.md`. Esos tres archivos, en `qcc-implementador/herramientas/`, son el procedimiento completo: esta sección resume cómo funciona para quien mantiene el flujo.

### Roles y modelos

| Rol | Modelo y esfuerzo |
|---|---|
| Orquestador | Sonnet high (frontmatter de la skill `impl`) |
| Explorador | Haiku low. Uno por ~2.000 líneas de código candidato (1.500 si la línea `CONTEXTO DEL PROYECTO` del preflight pasa de ~3.000 tokens; nunca más de 2.200), hasta 20 en la primera ronda (el límite de subagentes simultáneos del harness) y 4 en el reintento |
| Planificador | Opus medium; clasifica y planifica |
| Ejecutor | Sonnet high; medium en una subtarea `Crítica: no` y sus correcciones. Hasta 4 en paralelo dentro de un lote |
| Revisión final | Opus high, siempre, con cualquier Clasificación. Revisa el cambio completo contra el pedido literal, el plan, el CLAUDE.md, cada «hecho cuando» y las uniones entre subtareas |

- **Esfuerzo según el riesgo:** los rechazos de la revisión final caen en planes CRÍTICO; lo que no toca criterios baja de esfuerzo. `costos.mjs` dice si la calidad se sostiene.
- **Sin revisor por subtarea:** los defectos reales están entre archivos y los encuentra la revisión final. Esta recibe el digest `EJECUTORES` (una línea por subtarea con lo que reportó su ejecutor), no los reportes completos.
- **Fork mode:** los subagentes heredarían el modelo de la sesión y la revisión final perdería Opus. Si está activo, el flujo avisa y termina.

### Pasos

| Paso | Qué pasa |
|---|---|
| 0 · Preflight | `estado.mjs --paso 0`: candado, `BASE_GLOBAL`, mapa del repo, reglas, contexto del proyecto, autoprueba de la guardia y la verificación inicial en segundo plano |
| 1 · Exploración | Los exploradores, todos en un mensaje |
| 2 · Plan | `--guardar … exploracion`, el reintento si hace falta, el planificador y `--guardar … plan` |
| 3 | Sin uso; el número se conserva por `--paso` y el panel |
| 4 · Aprobación | El bloque `PARA APROBAR`, la pregunta «Plan» y los permisos |
| 5 · Ejecución | Un lote tras otro: foto, ejecutores, `--cambios` y `verificar.mjs` |
| 6 · Verificación final | El alcance global y la revisión final, con sus ciclos de corrección |
| 7 · Cierre | `--cambios --global --paso 7`: consumo, límites, reversión y la fila de `flujos.jsonl` |

Un pedido que no pide cambios (revisar, analizar, auditar) termina antes del preflight: `/impl` es para cambios.

### Carpeta del flujo y `estado.mjs`

El preflight abre `<git-dir>/qcc-impl/registro-flujo/`: una por repo y por worktree, compartida entre cuentas. Ahí quedan `estado.json` (fotos, plan, aprobación, avance, permisos, sesiones), `mapa.md` (archivos y líneas por carpeta y los `.md` de más de 300 líneas), `exploracion.md`, `plan.md`, un `S<n>.md` por subtarea (con los hallazgos de la exploración que citan sus permitidos), `verificacion-inicial.log`, `diff.txt` para la revisión final y un `revision-<c>.md` por ciclo. El registro de la guardia (`registro.jsonl`) y la caché de `verificar.mjs` viven en el mismo `qcc-impl/`. Sin git dir, o con `FLUJOS_REGISTROS`, todo va a `~/.claude/flujos/registros/<proyecto>-<hash>-flujo/`. `flujos.jsonl` e `historial/` están siempre en `~/.claude/flujos/registros/`.

`estado.mjs` es la entrada de línea de comandos (opciones y despacho); su código está en los módulos hermanos `estado-*.mjs`: `base` (git, fotos, `estado.json`, límites, verificación inicial), `plan`, `exploracion`, `guardar`, `avance`, `despachos`, `preflight`, `cambios` y `cierre`. La tabla de opciones está en `comun.md` §1.

- **Fotos:** una foto es un commit suelto con todo el árbol (versionados y nuevos no ignorados), armado con un índice temporal: no toca el índice ni los archivos del usuario. `--base --sub <n>` guarda la de una subtarea (un reintento conserva la primera); `--cambios --sub <n>` o `--global` toman de ahí la BASE, el DESDE y los permitidos del plan, y `--permitidos` solo suma los ampliados. La forma explícita (`--cambios <BASE> --desde <DESDE> --permitidos …`) queda de respaldo.
- **Despachos con rutas:** los despachos pasan rutas a la carpeta del flujo en vez de copiar el plan. `--guardar … plan` imprime las DECISIONES (`CICLOS DE LA REVISIÓN FINAL`, `CRÍTICO`, `ASPECTOS`), los AVISOS, `LOTES:`, las DUDAS y el bloque `PARA APROBAR`, que el orquestador muestra sin leer `plan.md`. `--estado` resume el flujo si el orquestador pierde el hilo.
- **Despachos llenos:** `estado.mjs` imprime los despachos del ejecutor y de la revisión final ya armados (`DESPACHO S<n> (Agent: …):` … `FIN DESPACHO S<n>`, con `subagent_type`, `description` y effort), un paso antes de usarlos porque el Agent va en el mismo mensaje que su Bash: `--aprobado` da los del primer lote; el `--cambios --sub` de cada lote, los del siguiente o, con todo terminado, el de la revisión final con el digest `EJECUTORES` (estado, correcciones y BLOQUEOS literales del último ejecutor de cada subtarea); el `--cambios --global --paso 6` tras una tanda, el del ciclo siguiente con `REVISIÓN ANTERIOR`; y `--estado` o `--reanudar`, el de lo que sigue. El cierre imprime el esqueleto `PARA EL CIERRE` con título, resultado, revisión, correcciones y las OBSERVACIONES de la última revisión. El orquestador solo completa lo que únicamente él sabe (imágenes, la `VERIFICACIÓN FINAL`, un `CONTEXTO` extra).
- **Candado:** si otro flujo del repo sigue abierto (sin cierre y con actividad en los últimos 20 min), el preflight avisa y no vacía la carpeta. Un flujo con plan guardado y sin cierre es un flujo cortado: nunca se vacía solo, y `--forzar` lo archiva en `historial/` antes de empezar de cero. Un flujo que termina antes de aprobar el plan corre `--cancelar`, que lo cierra como `CANCELADO` y libera el candado.
- **Reanudar:** todo el avance queda en la carpeta (la aprobación con sus `AJUSTES AL PLAN`, el estado y las correcciones de cada subtarea, los permitidos ampliados, cada revisión final, la `BASE` de cada tanda). La revisión final se guarda sola en `revision-<c>.md`: la toman de los transcripts `--estado`, `--reanudar`, `--tanda` y el `--cambios --global` de los pasos 6 y 7. Con un flujo cortado, el preflight imprime `REANUDAR:` y `/impl reanudar` sigue con `--reanudar`: no vacía la carpeta, anota la sesión e imprime el `PEDIDO` literal, `SIGUE: paso <n> · …`, lo pendiente y el despacho de lo que sigue. El orquestador retoma ahí sin explorar, re-planificar ni volver a pedir la aprobación. El cierre une todas las sesiones en una sola fila de `flujos.jsonl`, con `sesiones: <n>` y el hueco entre ellas en `tiempos.corte`.

### Exploración

- Siempre la hace el explorador: lo que leyera el orquestador se pagaría de nuevo en cada uno de sus pedidos. El orquestador lee `mapa.md`, suma las líneas de las carpetas que toca el pedido (sin las de referencia o solo lectura según las reglas del proyecto) y reparte las áreas sin solapar; un área mayor se parte por subcarpeta, y una carpeta plana por grupos de archivos. Si el código candidato no cabe en los 20, pregunta qué área acotar (header «Exploración», nunca «Plan», que el panel toma por la aprobación).
- **Documentos:** los de más de 300 líneas que nombran el pedido o las reglas del proyecto van a exploradores propios, uno cada ~35 KB (~25 KB si el documento pasa de ~120 bytes por línea), que leen su rango con `Read` y `offset`/`limit`. Los de código llevan `NO LEAS:` con esos documentos y anotan en DUDAS `regla: <qué>`, que cruza el planificador.
- **Informe:** `TOPE: 20 líneas` de hallazgos por explorador (sin contar los 5 encabezados), cada línea de hasta 160 caracteres. Lo que el pedido toca dentro de su ÁREA y no alcanzó a explorar va en DUDAS como `no explorado: <ruta> — <por qué>`; en ACOPLAMIENTOS anota la definición del tipo, unión o enum al que el pedido agrega una variante.
- **Unir y reintentar:** `--guardar <id1>,<id2> exploracion` une los informes en un `exploracion.md` sin repetir `ruta:línea` (un acoplamiento `→` cuenta con todos sus destinos) y descarta la DUDA `no explorado:` cuyos archivos ya cita otro informe. Avisa con `LARGO:` (informe sobre su tope), `CORTADO:` (la guardia le negó lecturas por contexto), `SIN EXPLORAR:` e `INCOMPLETO:`; los tres últimos comparten un solo reintento, de hasta 4 exploradores agrupados por carpeta (`REINTENTO: caben <n>`). En la segunda corrida esos avisos salen solo de los ids nuevos y no se reintentan.
- **Tope de contexto:** la guardia le niega Read, Glob y Grep al explorador cuyo contexto pasa de 90k (Haiku cobra 5× el pedido de más de 100k); el rechazo le dice que reporte ya y deje lo que falte como `no explorado:`. Al ejecutor se le niegan sobre los 100k: termina con lo leído, corre `verificar.mjs` y reporta, o `BLOQUEADO` con lo que falta. `explorador.agentes` de `flujos.jsonl` anota por explorador su contexto máximo, las líneas leídas y si lo cortó la guardia: con eso se calibran los números de esta sección.

### Plan

- El planificador clasifica (criterios #1–#10 de `plan.md`) y arma subtareas de hasta 3 archivos de código y ~150 líneas cambiadas; las pequeñas de una misma capa se fusionan, salvo lo que toca seguridad, auth o datos. El plan no tiene tope de subtareas: si el pedido es aplicar un documento, cubre todas sus fases y cada regla, valor y prueba que fija, y ni el planificador ni el orquestador ofrecen un corte del alcance.
- **Criticidad:** `Crítica: sí | no` por subtarea (ante la duda, sí). Decide qué mira primero la revisión final y el esfuerzo del ejecutor. Las rutas críticas del proyecto van en `criticos` de `.claude/qcc-implementador.json`; `--guardar … plan` avisa si una subtarea las toca sin `Crítica: sí`.
- **Lotes:** el plan marca `Depende de: ninguna | S<n>, …` (sin el campo, depende de la anterior). `--guardar … plan` arma los lotes por ondas y los imprime como `LOTES: S1 | S2+S3 | S4`: cada subtarea va al primer lote, de hasta 4, posterior a sus dependencias y a toda subtarea anterior con la que se pisa. Una con permitidos dudosos hace de barrera y va sola; una con un permiso irreversible va sola en su lote sin ser barrera.
- **Tests y documentación:** una subtarea que cambia una constante, tabla o lista lleva en permitidos los tests que la comprueban, y el revisor rechaza un camino público nuevo o cambiado sin test. La documentación de un cambio va en la subtarea que lo cambia; una subtarea aparte solo para docs transversales, al final.
- **Pendientes:** si las reglas del proyecto nombran un archivo de pendientes (en este repo, `PENDIENTES.md`), va en los permitidos de la última subtarea, que agrega lo que el plan sabe que queda abierto y borra lo resuelto. Lo que aparece después va en «Riesgos pendientes» del cierre, con una línea «Para PENDIENTES.md: …».
- **Supuestos y preguntas:** lo no confirmado va en Riesgos con «comprobar primero», y el ejecutor lo prueba antes de editar el resto. Si el pedido define entidades, cantidades o dónde vive un dato, el planificador pregunta por ese modelo, con las alternativas reales.
- **Aprobación:** el orquestador escribe el bloque `PARA APROBAR` (entero mientras quepa en 18.000 caracteres; si no, compacto) y, con más de 20 subtareas, `Estimado: ~1,7 min por subtarea`. La pregunta «Plan» lleva en el `preview` de «Aprobar» una línea `S<n> · …` por subtarea y los `P<n>`, porque el diálogo tapa el texto: `plan-visible.mjs` (PreToolUse de AskUserQuestion) niega la pregunta sin ese preview. Un solo `estado.mjs --aprobado [--ajustes …] [--sumar …] [--permisos P1,P2] --paso 4` anota la aprobación y los permisos aprobados.

### Ejecución y revisión final

- **Por lote:** un mensaje con `estado.mjs --base --sub <lista>` (una sola foto) y un ejecutor por subtarea. En un lote de varios el ejecutor no corre `verificar.mjs` (reporta «puntual (lote)»; la guardia se lo niega mientras haya una fase en paralelo abierta); al volver todos, un mensaje con `--cambios --sub <lista>` y el único `verificar.mjs`. El cierre atribuye archivos y líneas por subtarea también dentro de un lote.
- **Correcciones:** hasta 2 ciclos por subtarea. La corrección pide un test que repita la reproducción (se ve fallar antes), otro camino público al mismo estado y corregir la causa; una falla de `verificar.mjs` ya trae su test en rojo. Un ROJO en archivos de otro miembro del lote va a su dueño. Las correcciones van de a una, cada una con su `--base --sub <n> --paso 5` (conserva la foto y deja valer sus permisos).
- **Avisos de tipos:** al volver cada ejecutor, `--cambios --sub` avisa (`AVISO: S<n> · <ruta>:<línea> · «<patrón>» sin justificación`, heurístico) de un `any`, `@ts-ignore` o `eslint-disable` agregado sin justificar: una corrección de la subtarea dueña, una vez y sin contar como ciclo; si sigue, lo juzga la revisión final.
- **Subtarea BLOQUEADA:** el usuario puede ampliar, cambiar el plan, seguir sin ella (si ninguna posterior depende de ella: pasa a «Queda para ti» como `OMITIDA` y el flujo puede cerrar COMPLETO) o detener. Lo que la guardia niega al ejecutor no es subtarea: un borrado en bloque va a «Queda para ti» con el comando exacto, y la dependencia nueva la instala el orquestador antes de la foto de la subtarea que la usa.
- **Revisión final:** el despacho lleva el `PEDIDO` literal, y el revisor rechaza un plan que afloja el pedido o una regla del CLAUDE.md. Un «hecho cuando» que depende de un comando de «Queda para ti» no lo rechaza: va a CRITERIOS como `sin contrastar`. En el primer ciclo lee `diff.txt` entero; en los siguientes recibe `REVISIÓN ANTERIOR` (solo sus PROBLEMAS y CRITERIOS) y mira el diff desde la `BASE` de la tanda. Los ciclos máximos son 2 con Clasificación CRÍTICO y 1 sin criterios. Solo los PROBLEMAS se corrigen; las OBSERVACIONES van a «Riesgos pendientes».
- **Tanda de correcciones de la revisión final:** el orquestador agrupa los PROBLEMAS por archivo y abre la tanda con `estado.mjs --tanda <n> --paso 6`; hasta 4 ejecutores a la vez, uno por grupo (`GRUPO: <g>/<total>`, `LOTE: G1+…`), que verifican con tests puntuales. El único `verificar.mjs` es el del orquestador, que asigna un ROJO al grupo dueño de los archivos que fallan. La tanda cuenta como un solo ciclo; si no se puede partir, va una sola corrección.
- **Topes de reporte:** explorador, su `TOPE` (20); ejecutor, ~25 líneas (sin `ARCHIVOS`, que da `--cambios`, y en `CRITERIO` solo los «hecho cuando» en «no»; sin tope en FALLA o BLOQUEADO); revisión final, ≤ 20.

### Verificación

- El preflight lanza `verificar.mjs` desacoplado y sin ventana mientras exploran (salida en `verificacion-inicial.log`; `FLUJOS_INICIAL=0` lo desactiva). `--guardar … exploracion` y `--estado` lo esperan (tope 570 s) e imprimen `VERIFICACIÓN INICIAL: VERDE | ROJA (…) | SIN PASOS | SIN RESULTADO (…)`.
- El orquestador corre `verificar.mjs` tras cada lote o corrección; la última corrida ya es la verificación final (ni el paso 6 ni el cierre la repiten). Cada paso tiene un tope de `timeoutSeg` (600 s por defecto) y puede llevar `rutas` (globs de git): sin cambios en ellas sale `SALTADO`. Los pasos seguidos con `paralelo: true` corren a la vez (para los que no escriben archivos ni se pisan); la tabla conserva el orden. Se llama con `timeout: 600000` en Bash.
- **Caché:** una corrida con el mismo árbol y pasos que un VERDE de los últimos 30 min sale de la caché; otra corrida simultánea con el mismo árbol espera a la primera y repite su salida (`RESULTADO: EN CURSO`, exit 4, si vence la espera). Si solo pasos de build cambiaron el árbol (build, compile, codegen, generate, gen o bundle, y no lint, format, fix, prettier ni eslint), guarda también la clave del árbol posterior; ante cualquier otra escritura, no deja caché. Lo que cambió cada corrida queda en `registro-verificar-salidas.json`: `--cambios` lo muestra aparte como `(salida de verificar: <paso>)` y no lo cuenta como FUERA, salvo que la corrida se cruzara con un lote o una tanda abiertos.
- **Llamadas juntas:** lo que no depende de una salida previa va en un mismo mensaje, cada comando en su propia llamada (los exploradores; foto y ejecutores; `--cambios` y `verificar.mjs`; alcance global y revisión final). Cada llamada que se ahorra es un pedido menos con todo el contexto del orquestador; un Bash que no es de solo lectura corre solo y los Agent del mismo mensaje esperan a que termine.

### Alcance, cierre y consumo

- **Alcance:** con permitidos y nada fuera, `--cambios` imprime una línea `CAMBIOS desde <base> (<n>): <carpeta> <k> · …` y `ALCANCE: OK`; si no, el detalle (agrupado por carpeta con más de 20 archivos dentro; lo de fuera, siempre uno por uno). Todo FUERA que no venga de `verificar.mjs` se pregunta: «Aceptar» (amplía), «Restaurar» o «Detener».
- **Reversión:** el `--cambios` del cierre imprime `REVERSIÓN:` con los comandos exactos para deshacer el flujo; con más de 10 archivos los deja en `reversion.sh` de la carpeta del flujo.
- **Consumo y límites:** el cierre lee los transcripts del flujo (hilo principal y subagentes) e imprime `CONSUMO:` (minutos, tokens y pedidos por rol), `VEREDICTOS:`, `CONTEXTO:`, `LÍMITES:` y `LÍMITES POR FASE:` (el % de las ventanas de 5 h y semanal que gastó el flujo, en total y por fase: ver [LIMITES.md](LIMITES.md)). Los anota en una fila v2 de `flujos.jsonl` (Clasificación, subtareas, tiempos, resultado `COMPLETO | DETENIDO:<paso> | CANCELADO`, calidad y `explorador.agentes`) y archiva el flujo en `historial/` (los 30 más recientes). No hay dólares: el plan de suscripción gasta % de ventana; las filas con `usd` se leen ignorándolo.
- **`costos.mjs`:** `node qcc-implementador/herramientas/costos.mjs [--ultimos <n>]` lista el historial con su promedio, para comparar versiones del flujo; `--fuga` mide lo gastado en la sesión después del cierre y `--anotar <t> "<texto>"` suma un defecto al flujo cuyo `t` empieza así.
- **Queda para ti:** lista los comandos como `! <comando>  # requiere <…>`, listos para pegar. Si el flujo cierra COMPLETO, el orquestador corre sin preguntar los permisos `post-revisión` aprobados y pregunta una vez si ejecuta el resto. Al final del cierre recomienda `/clear` antes de otro `/impl` o `/commit`.

### Permisos aprobados en el plan

El plan lista en `PERMISOS A APROBAR:` cada comando que la guardia negaría y que necesita (migraciones, regenerar tipos, deploys, servicios vivos, un servidor de desarrollo), aunque las reglas del proyecto lo dejen «para el usuario»: id `P<n>`, quién (`ejecutor S<n>`, `orquestador` o `post-revisión`), comando exacto, servicio, `reversible: sí | no`, `Qué hace` y `Para qué`. El usuario los aprueba con el plan (cada `reversible: no` en su propia pregunta) y el orquestador los registra con la aprobación (`estado.mjs --aprobado --permisos P1,P2`); `--permiso-nuevo` suma uno que aparece a mitad de la ejecución.

- La guardia deja pasar solo ese comando y solo al ejecutor de esa subtarea mientras está en curso. El permiso del `orquestador` se limita a servidores y túnel. Los `post-revisión` (deploys y el `db:push` que nadie necesita aplicado antes) los corre el orquestador tras el cierre COMPLETO, en el orden del plan y parando al primer exit ≠ 0; con DETENIDO quedan en «Queda para ti» como `(aprobado)`.
- El `*` solo vale después de una parte literal (programa y primer argumento que no es opción; en `node`, el script): `pnpm *`, `node *` y `pnpm exec *` no se pueden aprobar. Un permiso reversible lo puede usar otro miembro del lote; los irreversibles van solos. No hay permisos para el revisor, el explorador ni el planificador.

| Negado siempre, aun con aprobación | Por qué |
|---|---|
| `git` que no es de lectura | los commits van solo por `/commit`; ramas y deshacer los decide el usuario |
| Destinos de escritura protegidos (`.claude/settings*.json`, `.claude/agents/`, `.git/`, secretos, protegidos, migraciones versionadas, fuera del repo salvo temporales) | también en `cp`, `mv`, `sed -i`, `tee`… de un comando aprobado |
| `estado.mjs` con `--permiso`, `--permiso-nuevo`, `--aprobado`, `--base`, `--cambios`, `--guardar`, `--cancelar`, `--tanda`, `--reanudar` | el agente se aprobaría solo |
| Leer `.env` y los secretos del proyecto (también con Read y Grep) | solo se admite `--env-file` en un `node` aprobado |
| `curl … \| sh`, `iex (irm …)` | ejecuta código bajado sin revisar |
| `format`, `diskpart`, `mkfs` | destruyen el disco |

**Límites:** la guardia frena errores, no a un agente decidido (un `node` sobre un script temporal pasa, y ese script podría escribir el estado del flujo). Las aprobaciones no se firman: el control real es qué agentes se lanzan y la revisión final. La guardia revisa el comando, no su efecto, por eso cada permiso nombra el servicio exacto. Muchos permisos invitan a aprobar sin leer: el planificador propone solo los necesarios.

### Guardia

`guardia.mjs` es el PreToolUse del plugin (Bash, PowerShell, Edit, Write, NotebookEdit, Read, Glob y Grep) y decide por el `agent_type` del evento. Si su autoprueba del preflight falla (por ejemplo, el proyecto redefine `ejecutor` o `revisor` sin la guardia), el flujo avisa y termina.

- **Revisor:** no escribe en el repo; sí en temporales (para comparar con la base con `git archive` o simular, también con `sed -i`). La guardia le niega `mover.mjs`.
- **Ejecutor:** escribe solo en sus permitidos y en temporales (scripts de medición, que `--cambios` no cuenta). Mueve bloques de líneas con `mover.mjs` en vez de retipearlos. Corre `playwright` y `playwright-cli` sin permiso (directo, con `npx`/`pnpx`/`bunx` o con `<gestor> exec|dlx|x`, salvo `npm`, que está prohibido), salvo si el gestor lleva opciones antes del subcomando o el comando define variables `npm_config_*` (o `pnpm_config_*`, `bun_config_*`, `yarn_*`). Lee de la red con `curl`, `wget`, `iwr` e `irm` solo hacia `http(s)`, con GET o HEAD, sin cuerpo y con salida a `-`, `/dev/null` o un temporal (`wget` necesita `-O` o `--spider`).
- **Todos:** siguen negados `.env` y los secretos, las redirecciones fuera de alcance, los servidores directos (`pnpm dev`…), `ssh`, `scp`, `rsync`, `nc`, `telnet`, los CLIs de nube y lo que el proyecto declare en `guardia.externos`. A ejecutor y revisor se les niega `find` desde la raíz del disco. En una copia solo cuenta el destino, y las variables asignadas en el mismo comando se expanden.

### Reglas y contexto del proyecto

- **Reglas:** `.claude/qcc-implementador/` (un archivo por sección) o `.claude/qcc-implementador.md` mandan sobre las comunes; los nombres `.claude/implementador*` valen de respaldo. Cada despacho lleva `REGLAS`, para que cada agente lea las suyas, y la skill inyecta las del orquestador con `estado.mjs --reglas`.
- **Contexto del proyecto:** el preflight imprime `CONTEXTO DEL PROYECTO: ~N tokens por agente (<archivos>)` con lo que pesan CLAUDE.md, `.claude/CLAUDE.md`, CLAUDE.local.md y sus `@import` (AGENTS.md solo si no hay CLAUDE.md o alguien lo importa; tokens ≈ bytes / 3,5). Con más de 10.000 agrega un `AVISO`, que va en el plan y no detiene nada.
- **Documentación al día:** la subtarea reescribe la parte que cambió y borra lo que dejó de ser cierto, sin «antes…/ahora…», fechas, versiones ni historial (salvo un changelog que las reglas del proyecto pidan). La revisión final rechaza el historial agregado y la documentación que quedó vieja.
- **Imágenes:** las plantillas de despacho llevan `IMÁGENES: <ruta absoluta> — <qué muestra> | ninguna` (en la del ejecutor, solo si la subtarea es visual).

### Panel

El panel muestra en qué paso va el flujo en curso (ver «Flujo» en [MODS.md](MODS.md#qué-muestra-de-arriba-abajo)). Lo deduce de los nombres de la skill y de los agentes, del header «Plan» de las preguntas, de las opciones de `estado.mjs` (con la marca `--paso <n>`, que manda) y de la línea «CIERRE ·» del cierre. Si cambia alguno de esos nombres, opciones o textos, o el orden por subtarea (`--base` → `ejecutor` → `--cambios` → `verificar.mjs`), hay que actualizar `qcc-panel/hooks/flujo.ts`.

## Convivencia con plugins de estilo

Un plugin de estilo (como Ponytail) puede pedir a los subagentes un resumen, lo omitido o riesgos al final de su reporte. El flujo lo tolera así:

- **Cierre de los agentes:** explorador, planificador, ejecutor y revisor cierran en su última etiqueta del formato. Lo que una regla externa pida va dentro del formato (DUDAS, Riesgos o PREGUNTAS, BLOQUEOS u OBSERVACIONES), nunca como prosa después.
- **Exploración:** `estado.mjs` descarta la prosa tras un renglón vacío en la última sección, al fusionar exploraciones y al contar los avisos LARGO.
- **Plan:** tras `Costo:` descarta toda línea que no sea un campo del pie.
- **Veredicto:** `costos.mjs` acepta `**VEREDICTO**: X` y `**ESTADO**: X`, además de la forma sin negrita, y anota un veredicto y sus problemas por cada informe, también si se retoma al mismo agente.
- **Tests:** un plugin que pida el cambio mínimo solo manda sobre el código, no sobre los tests (`plan.md` §3 pide un test por cada camino público).

**Opcional con Ponytail:** para sacarlo solo del explorador, agrega al `env` del `settings.json` de tu carpeta de Claude Code (`CLAUDE_CONFIG_DIR` o `~/.claude`; este repo no lo edita):

```json
"PONYTAIL_SUBAGENT_MATCHER": "^(?!impl:qcc-explorador$)"
```

No cambies de modo a mitad de un flujo.

## /impl-d

Comando aparte de `/impl`, sin carpeta de flujo, `estado.mjs` ni pasos en el panel: el plugin es `skills/n/SKILL.md` (el modo normal), `skills/e/SKILL.md` (el modo esfuerzo), los agentes `qcc-explorador-directo` y `qcc-revisor-directo`, `herramientas/corrida.mjs` y el hook `herramientas/tope-explorador.mjs`.

- **Roles y modelos:** la skill fija `model: opus` y `effort: medium` para la sesión, que implementa. Explora `impl-d:qcc-explorador-directo`, Haiku low con `tools: Read, Glob, Grep` y `maxTurns: 25`; revisa `impl-d:qcc-revisor-directo`, Opus high, con `tools: Read, Glob, Grep, Bash`.
- **Modo esfuerzo (`/impl-d:e`):** como el `effort` de una skill es fijo, el modo es otra skill y no un flag. Fija `model: opus` y `effort: high`, inyecta lo mismo que `/impl-d` (pedido, sucios previos y `corrida.mjs --inicio`) y manda a la sesión a leer `skills/n/SKILL.md` y seguirlo, con un cambio: cada revisor va con `effort: "xhigh"` (sin el parámetro `effort` en Agent, termina en el preflight). Los exploradores no cambian. La fila del registro lo anota en `modo`.
- **Al empezar:** la skill inyecta `git status --short` (los sucios previos) y la salida de `corrida.mjs --inicio`: `LÍMITES` (el % actual de cada ventana, con `MARGEN BAJO` desde 85 % de 5 h: con `-p` la corrida cierra `DETENIDO` sin explorar), `BASE` (el árbol git del estado al empezar, sucios y archivos sin seguimiento incluidos, armado con una copia del índice: el real no cambia), `MAPA` (líneas de texto por carpeta, partidas hasta ~2.000 por línea, sin lockfiles), `VERIFICAR` y `REGLAS` (de `.claude/qcc-implementador*`, con el respaldo `.claude/implementador*`) y `MEMORIA` (el `MEMORY.md` del proyecto en `projects/`, si existe).
- **Exploración:** obligatoria salvo con un MAPA de menos de ~2.000 líneas. Un explorador cada ~2.000 líneas de las carpetas que toca el pedido (nunca más de 2.200), sin solapar y hasta 24, todos en un mismo mensaje (el que el harness no deja arrancar por su tope de subagentes simultáneos se relanza al terminar otro); el prompt lleva el pedido literal y un `FOCO` por área. Cada hallazgo trae su rango `ruta:desde-hasta` y la sesión lee solo esos tramos.
- **Implementación:** la sesión edita con Edit o Write (nunca con `sed -i`, `node -e` ni heredocs), no deja temporales en el repo y para con TaskStop lo que lanzó en segundo plano antes del cierre.
- **Verificación:** los pasos de `VERIFICAR` (respeta `rutas` y `paralelo`); sin ellos, los del CLAUDE.md o AGENTS.md del proyecto. Dos correcciones sin VERDE cierran `DETENIDO`. Las pruebas que el pedido pide fuera de esos pasos (navegador, dispositivo) se corren solo si el proyecto o la memoria dicen cómo y la herramienta ya está instalada; si no, quedan como `no verificado`, el resultado es `COMPLETO (sin verificar: …)` y van a «Queda para ti».
- **Reglas del proyecto:** las mismas de `/impl`: la sesión lee `planificar.md` y `ejecutor.md`, el explorador `buscar.md` y el revisor `revisor.md`. La memoria del proyecto rige igual y el revisor la recibe.
- **Revisión:** el contrato es el pedido literal y el cambio es `corrida.mjs --diff <BASE>`: la diferencia entre la `BASE` y el estado actual, archivos nuevos incluidos, sin lo que ya estaba sucio al empezar (sin git, `git diff HEAD` y los sucios previos). El revisor prueba ejecutando cada regla con valores (números, formatos, límites) con valores que los tests no usen, juzga contra el pedido el código previo que el cambio reutiliza, pone todo defecto del cambio en PROBLEMAS y no rechaza por lo que va en `NO VERIFICADO`. Hasta 2 ciclos: tras un RECHAZADO la sesión toma `corrida.mjs --arbol`, corre el `repro` de cada PROBLEMA y corrige solo los que se reproducen (los otros van a `DESCARTADOS`, con lo que dieron); el segundo revisor lee solo `CORRECCIONES` (el diff desde ese árbol) y vuelve a correr el repro de los descartados. Tras APROBADO solo se corrige, sin otro ciclo, documentación vieja o un nombre en una línea; el resto va a «Riesgos pendientes».
- **Tope del explorador:** `hooks/hooks.json` corre `tope-explorador.mjs` en cada Read, Glob y Grep; cuando el contexto del explorador pasa de 90k (el mismo tope que en `/impl`), se los niega para que reporte con lo que tiene. A la sesión, al revisor y a cualquier otro agente los deja pasar.
- **Sin guardia:** los agentes de `impl-d` no son de `impl`, así que `guardia.mjs` no los vigila: el revisor solo tiene su prompt para limitarse a leer. La sesión no corre git que escriba ni toca `.env*`, y pregunta antes de un comando irreversible o externo.
- **Cierre y registro:** `corrida.mjs --fin --resultado <r>` imprime `LÍMITES: 5h +N % · sem +N %`, lo que subió cada ventana desde `--inicio`, con el mismo snapshot del panel y las reglas de `/impl` (ver [LIMITES.md](LIMITES.md#3-cómo-se-registra-el--por-corrida)), y anota una fila en `~/.claude/flujos/registros/impl-d.jsonl` (no en `flujos.jsonl`, que leen el panel y `costos.mjs`): pedido, modo (`normal`, `esfuerzo` o `s/d`), resultado, minutos, versión, límites, veredictos del revisor y, por rol (sesión, explorador, revisor), agentes, pedidos y tokens desde el transcript. La lectura inicial queda en el temporal del sistema (`qcc-impl-d/<sesión>.json`): `--fin` la borra y `--inicio` borra las de más de 24 h que dejó una corrida cortada.

## /commit

Comando aparte de `/impl`, sin carpeta de flujo ni registros. Toma la idea del plugin `commit` de [midudev/better-claude](https://github.com/midudev/better-claude/tree/main/plugins/commit), en español. Al escribir `/commit [por qué]`, la sesión pregunta qué hacer con los cambios y despacha al agente `qcc-generador-commit`, que los separa en grupos lógicos y propone un commit en español por grupo. La sesión hace los commits y el push si corresponde, y muestra cada mensaje con su hash.

```
❯ /commit

  Commit: ¿Qué hacer con estos cambios?
  ❯ 1. Commit + push (Recomendado)
    2. Solo commit
    3. Commit en una rama nueva
```

| Opción | Qué hace |
|---|---|
| **Commit + push** (recomendada) | Commits en la rama actual, `master` o `main` incluidas, y `git push -u origin HEAD`. |
| **Solo commit** | Commits en la rama actual, sin push. También es lo que hace si no puede preguntar (por ejemplo, con `claude -p`). |
| **Commit en una rama nueva** | Crea la rama que propone el agente (`<tipo>/<tema>`, como `feat/pregunta-de-push`) con `git switch -c`, hace los commits ahí y la sube con push. |

- **Roles y modelos:** todo en Haiku high. La skill fija `model: haiku` y `effort: high`, que rigen para la sesión cuando el usuario escribe `/commit`; la sesión pregunta, despacha y hace los commits, pero no lee el diff. El agente `qcc-generador-commit` es Haiku high, con `tools: Bash, Read`.
- **Estado inyectado:** la skill pone la rama (`git branch --show-current`) y `git status --short` en el prompt antes de que corra el modelo. Sin cambios, termina en una línea y sin preguntar. Esos dos comandos tienen que estar en `allowed-tools`, o Claude Code aborta la skill; fuera de un repo git también la aborta.
- **Alcance y grupos:** siempre todo lo que no tiene commit, esté o no en stage (los archivos nuevos se leen con Read), en hasta 8 grupos lógicos, un commit por grupo (el código con sus tests y su documentación; lo que no se relaciona va aparte). Cada archivo va en exactamente un grupo, salvo los EXCLUIDOS. Antes del primer commit la sesión corre `git reset -q` (saca todo de stage sin tocar los archivos) y por grupo agrega solo sus ARCHIVOS con `git add -A -- '<ruta>' …`; nunca `git add -A` sin rutas. Al final corre `git status --short` y avisa si queda algo que no sea EXCLUIDOS.
- **Secretos:** el agente nunca lee `.env*`, claves ni secretos. Los archivos con ese aspecto (`.env*`, `.pem`, `.key`, `.p12`, `.pfx`, `.keystore`, `id_rsa*`, `id_ed25519*` y los que por su nombre guardan credenciales) van a EXCLUIDOS: quedan fuera de todo commit y el cierre los nombra.
- **Rutas con tildes:** el agente lee el estado con `git -c core.quotePath=false status --short`, así ARCHIVOS trae las rutas tal cual y no con los escapes octales de git, que `git add` no entendería.
- **Mensaje:** resumen de hasta 50 caracteres (tope 72), sin punto final y con el verbo en tercera persona; descripción opcional de 2 a 6 viñetas de hasta 72 caracteres; nunca primera persona, emojis, `Co-Authored-By` ni menciones a IA. No usa Conventional Commits: imita el tono de `git log` del repo.
- **Respuesta del agente:** `ALCANCE: todo (<n> archivos)`, `RAMA:` (solo con `RAMA NUEVA: sí`), un bloque `COMMIT <n>` por grupo con `ARCHIVOS:`, `RESUMEN:` y `DESCRIPCIÓN:` (viñetas o «ninguna»), y al final `EXCLUIDOS:` y `NOTA:`; o solo `ALCANCE: sin cambios`.
- **Los commits:** `git commit -F -` con el mensaje exacto de cada grupo; nunca `--amend`, `--no-verify`, `--author` ni `--force`. El autor es solo la cuenta de git del usuario: la sesión nunca agrega `Co-Authored-By`, trailers de sesión ni otra atribución a Claude o Anthropic, aunque el sistema la pida. Nunca crea ni cambia de rama salvo con «Commit en una rama nueva»; si ese nombre ya existe, prueba una vez con `-2`. Si un paso falla, muestra el error y no sigue con los demás commits ni con el push. Si el push falla o no hay remoto, los commits quedan locales.
- **Permisos:** las reglas de `allowed-tools` (`git branch --show-current`, `git status --short`, `git switch -c *`, `git reset -q`, `git add -A -- *`, `git commit -F -*` y `git push -u origin HEAD`, más Agent y AskUserQuestion) son lo que la skill corre sin pedir permiso.
- **Guardia `solo-git.mjs`:** PreToolUse del plugin `commit` (matcher `Bash|PowerShell`), solo para el agente de commit. Permite `git status`, `git diff`, `git log` y `git show`, con el subcomando justo después de `git` o de `-c core.quotePath=false`, la única opción global permitida. Niega cualquier otro programa o subcomando, las demás opciones antes del subcomando, los saltos de línea, los metacaracteres de shell (punto y coma, `&`, `|`, `<`, `>`, comilla invertida, `$`, paréntesis, llaves y los comodines `*`, `?` y `[`) y las opciones que escriben archivos o ejecutan programas (`--output`, `-o`, `--ext-diff`, `--exec`, con sus formas con `=` y abreviadas). Su test es `qcc-commit/herramientas/solo-git.test.mjs`, el cuarto paso de `.claude/qcc-implementador.json`.
- **Límites de la guardia:** no reemplaza la configuración de git del repo: `diff.external` y los filtros textconv siguen rigiendo. Las rutas con metacaracteres se niegan, y el agente las anota en la NOTA sin leerlas.

## Instalación

Los flujos se instalan como plugins del marketplace `qcc` (ver [README.md](README.md#instalar)) y se leen desde este repo: tras editar, `/reload-plugins` o una sesión nueva. Sus herramientas se llaman con `${CLAUDE_PLUGIN_ROOT}/herramientas/…`, y las guardias van en el `hooks/hooks.json` de cada plugin, porque los agentes de un plugin ignoran `hooks:` en su frontmatter.

`node qcc-implementador/instalar.mjs` lista las copias de `/impl` y `/commit` que dejó en `~/.claude` una instalación por copia (las que anota `~/.claude/flujos/.instalado.json`), y `--limpiar` las mueve a `~/.claude/_archivo-limpieza-<fecha>/`: duplicarían los comandos y agentes del plugin. Una copia editada ahí no se toca. No toca `~/.claude/flujos/registros`.

El formato de `.claude/qcc-implementador.json` (`verificar`, `guardia`, `criticos`) está en `qcc-implementador/herramientas/config.ejemplo.md`; el de cada agente, en `qcc-implementador/agents/`.

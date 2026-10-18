# Flujos

Los flujos de Claude Code que viven en `flujos/`, con sus agentes y herramientas. Las reglas generales del repo están en [AGENTS.md](AGENTS.md); el árbol de archivos, en [AGENTS.md](AGENTS.md#estructura).

## Comandos

| Comando | Uso | Para qué |
|---|---|---|
| `/implementador` | `<qué cambiar>` | Cambios en cualquier proyecto con git: explora, clasifica, planifica, revisa el plan, pide aprobación, ejecuta por subtareas y cierra con una revisión final independiente y verificación real. |

## Roles y modelos

`/implementador` es un solo flujo, con un solo modo: los pasos, agentes, plantillas y ciclos están en `flujos/herramientas/pasos.md`. Opus solo corre en el planificador y en la revisión final.

| Rol | Modelo y esfuerzo |
|---|---|
| Orquestador | Sonnet high (frontmatter de la skill `implementador`) |
| Explorador | Haiku high, uno por defecto; hasta 5 en paralelo con áreas independientes y grandes |
| Planificador | Opus high; clasifica y planifica. Medium si la exploración no toca ninguna ruta de `criticos` |
| Revisor del plan | Sonnet medium; se omite con «sin criterios», ninguna subtarea crítica y 1–2 subtareas (lo suple el orquestador) |
| Ejecutor | Sonnet high; medium en una subtarea `Crítica: no` |
| Revisión final | Corre siempre, en Opus high con cualquier Clasificación. Revisa el cambio completo, cada «hecho cuando» y las uniones entre subtareas |

- **Esfuerzo según el riesgo:** del 13 al 16 oct de 2026, los 2 rechazos reales de la revisión final fueron en planes CRÍTICO, y en 74 revisiones por subtarea ningún ejecutor fue rechazado. Por eso lo que no tiene criterios baja de modelo o de esfuerzo. Hay pocos flujos «sin criterios» medidos: el historial de `costos.mjs` dirá si la calidad se sostiene.

- **Sin revisor por subtarea:** en 74 revisiones por subtarea (del 13 al 15 oct de 2026) no hubo ningún RECHAZADO; los defectos reales los encontró la revisión final, porque estaban entre archivos. Ahora solo corre la revisión final, que recibe el digest `EJECUTORES` (una línea por subtarea con lo que reportó su ejecutor) y no los reportes completos.
- **Criticidad:** el plan marca `Crítica: sí | no` por subtarea (ante la duda, sí; sin el campo, sí). Decide si corre el revisor del plan y qué mira primero la revisión final. Las rutas críticas del proyecto van en `criticos` de `.claude/implementador.json`; al guardar el plan, `estado.mjs` avisa si una subtarea las toca sin `Crítica: sí` o si la Clasificación no cita su criterio.
- **Verificación:** el orquestador corre `verificar.mjs` tras cada ejecutor. La última corrida (tras el último ejecutor o corrección) ya es la verificación final: ni el paso 6 ni el cierre la repiten, y la revisión final la recibe en `VERIFICACIÓN FINAL`. Cada paso tiene un tope de `timeoutSeg` (600 s por defecto) y `verificar.mjs` se llama con `timeout: 600000` en Bash. Si el árbol y los pasos son los de un VERDE de los últimos 30 min (por ejemplo, el del ejecutor), lo repite desde la caché.
- **Llamadas juntas:** lo que no depende de una salida previa va en un mismo mensaje, cada comando en su propia llamada: preflight, verificación inicial y explorador; foto y ejecutor; alcance y verificación; alcance global y revisión final. Cada llamada que se ahorra es un pedido menos con todo el contexto del orquestador. Guardar la exploración va antes del planificador, porque decide su esfuerzo.
- **Costo real y veredictos:** el `--cambios` del cierre lee los transcripts del flujo (hilo principal y subagentes), imprime `COSTO:` (dólares, minutos y pedidos por rol) y `VEREDICTOS:`, y los anota en `registros/flujos.jsonl`, junto con la Clasificación y las subtareas. `node ~/.claude/flujos/costos.mjs [--ultimos <n>]` lista ese historial con su promedio, para comparar versiones del flujo. Los precios están en `costos.mjs`; si cambian, se actualizan ahí.
- **Candado:** si otro flujo del repo sigue abierto (sin cierre y con actividad en los últimos 20 min, o en las últimas 6 h si ya guardó su plan, porque puede estar esperando la aprobación), el preflight avisa con el título de ese plan y no vacía la carpeta del flujo. El orquestador pregunta: si ese flujo quedó cortado, repite el preflight con `--forzar`; si sigue corriendo, termina.
- **Carpeta del flujo:** el preflight abre `~/.claude/flujos/registros/<proyecto>-<hash>-flujo/`. `estado.mjs --guardar <agentId>` deja ahí la exploración y el plan, tomados del transcript del agente, y un `S<n>.md` por subtarea. Los despachos pasan rutas en vez de copiar el plan, y `estado.mjs --estado` resume el flujo si el orquestador pierde el hilo.
- **Alcance y reversión:** con más de 20 archivos dentro del alcance, `--cambios` los agrupa por carpeta (lo de fuera va siempre uno por uno), así no llena el contexto del orquestador. El `--cambios` del cierre, con `BASE_GLOBAL`, imprime `REVERSIÓN:` con los comandos exactos para deshacer el flujo; con más de 10 archivos los deja en `reversion.sh`, en la carpeta del flujo. Si el cierre va con la foto de una subtarea, avisa.
- **Ejecutor y suite sin filtro:** si las reglas del proyecto dicen que la suite de tests no se puede filtrar, el ejecutor no la corre aparte antes de `verificar.mjs`: va directo a este, que ya la incluye. El patrón filtrado queda para diagnosticar un `test` en ROJO.
- **Exploración:** siempre la hace el explorador (Haiku), que cuesta centavos; lo que leyera el orquestador se pagaría de nuevo en cada uno de sus pedidos.
- **Reglas del proyecto:** cada despacho lleva `REGLAS` con lo que dijo el preflight, para que cada agente lea las suyas sin buscarlas. La skill inyecta las del orquestador con `estado.mjs --reglas`.
- **Supuestos:** lo que el plan no pudo confirmar va en Riesgos con «comprobar primero», y el ejecutor lo prueba antes de editar el resto. Las observaciones del revisor del plan sobre una subtarea pasan a sus Riesgos.
- **Guardia:** si la autoprueba del preflight falla (por ejemplo, el proyecto redefine `ejecutor` o `revisor` sin la guardia), el flujo avisa y termina. El revisor no escribe en el repo, pero sí en temporales (para comparar con la base con `git archive` o simular, también con `sed -i`). El ejecutor también escribe en temporales (scripts de medición), y `--cambios` no los cuenta en el alcance. En una copia solo cuenta el destino (copiar `dist/` a un temporal pasa) y las variables asignadas en el mismo comando se expanden.
- **Subtarea BLOQUEADA:** el usuario puede seguir sin ella si ninguna posterior depende de ella; pasa a «Queda para ti» como `OMITIDA` y el flujo puede cerrar COMPLETO. Lo que hay que bajar de internet también va a «Queda para ti»: los subagentes no tienen red.
- **Fork mode:** los subagentes heredarían el modelo de la sesión y el planificador y la revisión final perderían Opus. Si está activo, el flujo avisa y termina.
- **Topes de reporte:** explorador ≤ 25 líneas, ejecutor ≤ 10 y revisión final ≤ 20.
- **Contexto de la revisión final:** en sus ciclos, `REVISIÓN ANTERIOR` lleva solo sus PROBLEMAS y CRITERIOS de la vuelta previa, nunca el reporte del ejecutor.
- **Autochequeo del ejecutor:** antes de reportar repasa una lista corta propia más la sección «Revisor: rechaza también por» de las reglas del proyecto.

El panel del mod muestra en qué paso va el flujo en curso (ver «Flujo» en [MODS.md](MODS.md#qué-muestra-de-arriba-abajo)). Lo deduce de los nombres de las skills y de los agentes (el planificador marca «Plan», paso 2, y el revisor-plan «Revisión del plan», paso 3), del header «Plan» de las preguntas de aprobación (si se omite el revisor-plan, la pregunta «Plan» lleva directo a Aprobación), de las opciones de `estado.mjs` y de la línea «CIERRE ·» del cierre. La revisión final cuenta siempre en «Verificación final». El `verificar.mjs` de cada subtarea cuenta en «Ejecución»; el `estado.mjs --cambios … --paso 6` previo a la revisión final marca «Verificación final». `--guardar`, `--estado` y `--reglas` no mueven el panel por sí solos. El orden por subtarea (`--base` → `ejecutor` → `--cambios` → `verificar.mjs`) es parte de lo que lee el panel, pero el orquestador también fija el paso explícito con `--paso <n>` en cada `estado.mjs` y la heurística queda de respaldo. Las llamadas juntas siguen siendo una señal cada una. Si cambia alguno de esos nombres, opciones o textos, o ese orden, hay que actualizar `panel-uso/hooks/flujo.ts`.

## Instalación

El repo es la fuente de verdad: los flujos se editan en `flujos/` y después se instalan.

```
node flujos/instalar.mjs              copia a ~/.claude lo que cambió
node flujos/instalar.mjs --revisar    muestra qué cambiaría, sin copiar
node flujos/instalar.mjs --traer      trae al repo lo que se editó directo en ~/.claude
node flujos/instalar.mjs --forzar     pisa la copia instalada aunque se haya editado ahí
node flujos/instalar.mjs --limpiar    borra lo instalado que ya no está en el repo, si nadie lo editó
```

- Cada copia anota su hash en `~/.claude/flujos/.instalado.json`. Si la copia instalada ya no coincide con lo que se instaló (alguien la editó en `~/.claude`), `instalar.mjs` la **frena** y termina con exit 1, aunque su fecha sea más vieja, para no perder ese cambio. Se resuelve con `--traer` o con `--forzar`. Lo instalado antes del manifiesto se compara por fecha hasta la primera instalación.
- Lo instalado que ya no está en el repo sale como «huérfano»; `--limpiar` lo borra si nadie lo editó.
- No copia ni toca `registros/` (bitácoras locales de cada proyecto, la carpeta de cada flujo, la caché de `verificar.mjs` y `flujos.jsonl` con una línea por flujo, su costo y sus veredictos; no van al repo). Los tests usan una carpeta temporal (`FLUJOS_REGISTROS`), así que no tocan ese historial ni siquiera corridos desde la copia instalada.
- `/implementador` llama a sus herramientas y a `comun.md`, `plan.md` y `pasos.md` por la ruta fija `~/.claude/flujos/…`. El flujo **corre desde la copia instalada**, no desde el repo: un cambio en `flujos/` no rige hasta instalarlo.

El detalle de cada paso y herramienta está en `flujos/herramientas/comun.md`, `plan.md` (clasificación y formato del plan) y `pasos.md`; el de cada agente, en `flujos/agents/`; el formato de `.claude/implementador.json`, en `flujos/herramientas/config.ejemplo.md`.

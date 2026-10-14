# Flujos

Los flujos de Claude Code que viven en `flujos/`, con sus agentes y herramientas. Las reglas generales del repo están en [AGENTS.md](AGENTS.md); el árbol de archivos, en [AGENTS.md](AGENTS.md#estructura).

## Comandos

| Comando | Uso | Para qué |
|---|---|---|
| `/implementador` | `<qué cambiar>` | Cambios en cualquier proyecto con git: explora, clasifica, planifica, revisa el plan, pide aprobación, ejecuta por subtareas con revisión independiente y cierra con verificación real. |

## Roles y modelos

`/implementador` es un solo flujo, con un solo modo: los pasos, agentes, plantillas y ciclos están en `flujos/herramientas/pasos.md`. Opus solo corre en el planificador y en la revisión final.

| Rol | Modelo y esfuerzo |
|---|---|
| Orquestador | Sonnet high (frontmatter de la skill `implementador`) |
| Explorador | Haiku high, de 1 a 5 en paralelo (uno por área, sin solaparse) |
| Planificador | Opus high; clasifica y planifica |
| Revisor del plan | Sonnet medium |
| Ejecutor | Sonnet high |
| Revisor por subtarea | Sonnet high si `Crítica: sí`; Sonnet medium si `Crítica: no` |
| Revisión final | Opus high, siempre (también con una sola subtarea) |

- **Criticidad:** el plan marca `Crítica: sí | no` por subtarea (ante la duda, sí; sin el campo, sí) y eso decide el esfuerzo del revisor de esa subtarea. Las reglas del proyecto pueden listar rutas críticas que obligan a `Crítica: sí`.
- **Verificación:** el orquestador corre `verificar.mjs` tras cada ejecutor y se lo pasa al revisor en `VERIFICACIÓN DEL ORQUESTADOR`, así que el revisor no lo repite. La revisión final corre la suya.
- **Fork mode:** los subagentes heredarían el modelo de la sesión y el planificador y la revisión final perderían Opus. Si está activo, el flujo avisa y termina.
- **Topes de reporte:** explorador ≤ 25 líneas, ejecutor ≤ 10, revisor ≤ 12 y revisión final ≤ 15.
- **Digest `YA REVISADO`:** una línea por subtarea ya revisada. La revisión final recibe ese digest y no recibe los reportes de los ejecutores ni de los revisores.
- **Contexto del revisor:** además del digest `YA REVISADO`, `REVISIÓN ANTERIOR` lleva solo los PROBLEMAS y CRITERIOS del propio revisor de la vuelta previa (también en los ciclos de la revisión final), nunca el reporte del ejecutor.
- **Autochequeo del ejecutor:** antes de reportar repasa una lista corta propia más la sección «Revisor: rechaza también por» de las reglas del proyecto.

El panel del mod muestra en qué paso va el flujo en curso (ver «Flujo» en [MODS.md](MODS.md#qué-muestra-de-arriba-abajo)). Lo deduce de los nombres de las skills y de los agentes (el planificador marca «Plan», paso 2, y el revisor-plan «Revisión del plan», paso 3), del header «Plan» de las preguntas de aprobación, de las opciones de `estado.mjs` y de la línea «CIERRE ·» del cierre. La revisión final cuenta siempre en «Verificación final». Además, el panel marca «Verificación final» mientras corre el `verificar.mjs` del orquestador de cada subtarea, y ese revisor se cuenta en las revisiones del paso 6, hasta el siguiente `estado.mjs --base`; el ajuste de `panel-uso/hooks/flujo.ts` queda pendiente. Si cambia alguno de esos nombres, opciones o textos, hay que actualizar `panel-uso/hooks/flujo.ts`.

## Instalación

El repo es la fuente de verdad: los flujos se editan en `flujos/` y después se instalan.

```
node flujos/instalar.mjs              copia a ~/.claude lo que cambió
node flujos/instalar.mjs --revisar    muestra qué cambiaría, sin copiar
node flujos/instalar.mjs --traer      trae al repo lo que se editó directo en ~/.claude
node flujos/instalar.mjs --forzar     pisa la copia instalada aunque sea más nueva
```

- Si la copia instalada es más nueva que la del repo (alguien la editó en `~/.claude`), `instalar.mjs` la **frena** y termina con exit 1, para no perder ese cambio. Se resuelve con `--traer` o con `--forzar`.
- No toca `~/.claude/flujos/registros/` (bitácoras locales de cada proyecto, no van al repo).
- `/implementador` llama a sus herramientas y a `comun.md` y `pasos.md` por la ruta fija `~/.claude/flujos/…`. El flujo **corre desde la copia instalada**, no desde el repo: un cambio en `flujos/` no rige hasta instalarlo.

El detalle de cada paso y herramienta está en `flujos/herramientas/comun.md` y `pasos.md`; el de cada agente, en `flujos/agents/`; el formato de `.claude/implementador.json`, en `flujos/herramientas/config.ejemplo.md`.

# Flujos

Los flujos de Claude Code que viven en `flujos/`, con sus agentes y herramientas. Las reglas generales del repo están en [AGENTS.md](AGENTS.md); el árbol de archivos, en [AGENTS.md](AGENTS.md#estructura).

## Comandos

| Comando | Uso | Para qué |
|---|---|---|
| `/implementador` | `<qué cambiar> \| continuar` | Cambios en cualquier proyecto con git, en dos modos (normal y ligero, ver «Modos»): explora, clasifica, planifica, revisa el plan, pide aprobación, ejecuta por subtareas con revisión independiente y cierra con verificación real. |
| `/documentar` | `consultar <duda o idea> \| <tema> [--directo] [--profundo] \| auditar <archivo.md> [--profundo] \| siguiente \| estado` | Documentar un proyecto o carpeta, con o sin git: acuerda una ficha antes de escribir, lee las fuentes grandes con un agente lector, escribe en `.md` en la raíz y lleva un mapa de cobertura. |

## Modos

Un solo comando, dos modos con los mismos pasos, agentes, plantillas y ciclos (`flujos/herramientas/pasos.md`); solo cambian el modelo y el esfuerzo. Empieza siempre en modo normal, con la skill `implementador`.

| Rol | Normal | Ligero |
|---|---|---|
| Orquestador | Opus medium (skill `implementador`) | Sonnet high (skill `implementador-ligero`; lo fija el panel tras el relevo) |
| Explorador | Haiku high, hasta 5 en paralelo (uno por área, sin solaparse) | no corre: la exploración llega en el relevo |
| Planificador | Opus high | Sonnet high (mismo agente `planificador`, con `model: "sonnet"`) |
| Revisor del plan | Sonnet medium | Sonnet medium |
| Ejecutor | Sonnet high | Sonnet high |
| Revisor por subtarea | Opus medium (`effort: "medium"`) | Sonnet high (`model: "sonnet"`) |
| Revisión integral | 1 Opus high | 1 Opus medium (`effort: "medium"`) |

Sin el panel instalado y cargado, el orquestador del ligero sigue en el modelo de la sesión (en la práctica Opus), porque el `model:` de la skill no se aplica en un relevo por la herramienta Skill.

- **Cuándo se recomienda el ligero:** en el paso 2 (Clasificación), si no hay criterios CRÍTICOS (los de `flujos/herramientas/comun.md` §2 ni los de las reglas del proyecto), se estiman ≤ 3 subtareas y ≤ 6 archivos, y no hay fork mode. Entonces pregunta «Modo» con «Ligero (recomendado)» y «Normal». Si el cambio no califica, no pregunta y sigue en normal.
- **Relevo:** cambiar de modo es un relevo con la herramienta Skill, nunca con Agent (un subagente no puede lanzar subagentes ni preguntar). Los args empiezan con la línea `RELEVO · <inicio | vuelta | continuación>` y llevan el pedido, la base, la clasificación y la exploración. Quien lo recibe no repite el preflight ni la exploración.
  - `inicio`: normal → ligero, en el paso 2.
  - `vuelta`: ligero → normal, en el paso 3, cuando el plan resulta crítico o no cabe (más de 3 subtareas o más de 6 archivos). Normal vuelve a planificar sin `model` y no vuelve a preguntar el modo.
  - `continuación`: `continuar` en un flujo que iba en modo ligero.
- **Fork mode:** no hay relevo; todo sigue en normal y no se pregunta el modo.
- **Entrada directa:** `/implementador-ligero` sin `RELEVO` responde «Uso: /implementador <qué cambiar>». Está oculta del menú de `/` (`user-invocable: false`): solo se usa como relevo.

El panel del mod muestra en qué paso va el flujo en curso (ver «Flujo» en [MODS.md](MODS.md#qué-muestra-de-arriba-abajo)). Lo deduce de los nombres de las skills y de los agentes, de la marca `RELEVO` en el pedido de la skill, del header «Plan» de las preguntas de aprobación, de las opciones de `estado.mjs` y de la línea «CIERRE ·» del cierre. Un relevo no abre un flujo nuevo: el panel conserva el paso y los tiempos, y muestra el modo en la línea de resumen. Si cambia alguno de esos nombres, opciones o textos, hay que actualizar `panel-uso/hooks/flujo.ts`.

## Instalación

El repo es la fuente de verdad: los flujos se editan en `flujos/` y después se instalan.

```
node flujos/instalar.mjs              copia a ~/.claude lo que cambió
node flujos/instalar.mjs --revisar    muestra qué cambiaría, sin copiar
node flujos/instalar.mjs --traer      trae al repo lo que se editó directo en ~/.claude
node flujos/instalar.mjs --forzar     pisa la copia instalada aunque sea más nueva
```

- Si la copia instalada es más nueva que la del repo (alguien la editó en `~/.claude`), `instalar.mjs` la **frena** y termina con exit 1, para no perder ese cambio. Se resuelve con `--traer` o con `--forzar`.
- Nunca borra: un archivo quitado del repo sigue instalado hasta que se borre a mano. Hoy hay que borrar a mano el agente del ligero viejo, `~/.claude/agents/planificador-ligero.md`, que ya no existe en el repo.
- No toca `~/.claude/flujos/registros/` (bitácoras locales de cada proyecto, no van al repo).
- `/implementador` (en sus dos modos) llama a sus herramientas y a `comun.md` y `pasos.md` por la ruta fija `~/.claude/flujos/…` (`/documentar` no usa ninguna). Todos los flujos **corren desde la copia instalada**, no desde el repo: un cambio en `flujos/` no rige hasta instalarlo.

## Pendiente de confirmar

- Uso detallado de cada comando (pasos, opciones y qué devuelve). Se documenta en una corrida aparte de `/documentar`.
- Agentes de los flujos (`explorador`, `planificador`, `revisor-plan`, `ejecutor`, `revisor`, `lector`, `revisor-doc`): qué hace cada uno y en qué flujo entra.
- Herramientas (`estado.mjs`, `verificar.mjs`, `guardia.mjs`): opciones y qué bloquea la guardia.
- Configuración: formato de `.claude/implementador.json` y de `.claude/documentar.md`.

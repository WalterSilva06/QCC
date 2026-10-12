# Flujos

Los flujos de Claude Code que viven en `flujos/`, con sus agentes y herramientas. Las reglas generales del repo están en [AGENTS.md](AGENTS.md); el árbol de archivos, en [AGENTS.md](AGENTS.md#estructura).

## Comandos

| Comando | Uso | Para qué |
|---|---|---|
| `/implementador` | `<qué cambiar> \| continuar` | Cambios críticos o amplios en cualquier proyecto con git: explora, clasifica, planifica, pide aprobación, ejecuta por subtareas con revisión independiente y cierra con verificación real. |
| `/implementador-ligero` | `<qué cambiar, idealmente con los archivos> \| continuar` | Cambios acotados: plan breve con aprobación, un ejecutor y una revisión independiente. Si el cambio resulta crítico, se detiene y deriva a `/implementador`. |
| `/documentar` | `consultar <duda o idea> \| <tema> [--directo] [--profundo] \| auditar <archivo.md> [--profundo] \| siguiente \| estado` | Documentar un proyecto o carpeta, con o sin git: acuerda una ficha antes de escribir, lee las fuentes grandes con un agente lector, escribe en `.md` en la raíz y lleva un mapa de cobertura. |

El panel del mod muestra en qué paso va el flujo en curso (ver «Flujo» en [MODS.md](MODS.md#qué-muestra-de-arriba-abajo)). Lo deduce de los nombres de las skills y de los agentes, del header «Plan» de las preguntas de aprobación, de las opciones de `estado.mjs` y de la línea «CIERRE ·» del cierre. Si cambia alguno de esos nombres, opciones o textos, hay que actualizar `panel-uso/hooks/flujo.ts`.

## Instalación

El repo es la fuente de verdad: los flujos se editan en `flujos/` y después se instalan.

```
node flujos/instalar.mjs              copia a ~/.claude lo que cambió
node flujos/instalar.mjs --revisar    muestra qué cambiaría, sin copiar
node flujos/instalar.mjs --traer      trae al repo lo que se editó directo en ~/.claude
node flujos/instalar.mjs --forzar     pisa la copia instalada aunque sea más nueva
```

- Si la copia instalada es más nueva que la del repo (alguien la editó en `~/.claude`), `instalar.mjs` la **frena** y termina con exit 1, para no perder ese cambio. Se resuelve con `--traer` o con `--forzar`.
- Nunca borra: un archivo quitado del repo sigue instalado hasta que se borre a mano.
- No toca `~/.claude/flujos/registros/` (bitácoras locales de cada proyecto, no van al repo).
- `/implementador` e `/implementador-ligero` llaman a sus herramientas por la ruta fija `~/.claude/flujos/…` (`/documentar` no usa ninguna). Todos los flujos **corren desde la copia instalada**, no desde el repo: un cambio en `flujos/` no rige hasta instalarlo.

## Pendiente de confirmar

- Uso detallado de cada comando (pasos, opciones y qué devuelve). Se documenta en una corrida aparte de `/documentar`.
- Agentes de los flujos (`explorador`, `planificador`, `planificador-ligero`, `revisor-plan`, `ejecutor`, `revisor`, `lector`, `revisor-doc`): qué hace cada uno y en qué flujo entra.
- Herramientas (`estado.mjs`, `verificar.mjs`, `guardia.mjs`): opciones y qué bloquea la guardia.
- Configuración: formato de `.claude/implementador.json` y de `.claude/documentar.md`.

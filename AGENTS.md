# QCC (Quorum Claude Code)

Herramientas personales para Claude Code, en cuatro plugins de un marketplace (`qcc`, en `.claude-plugin/marketplace.json`; se instalan con `claude plugin install <plugin>@qcc`). Los plugins y sus comandos tienen nombre corto, pero las carpetas conservan el largo. Cada plugin lleva `.claude-plugin/plugin.json`, `skills/`, `agents/`, `hooks/hooks.json` y `herramientas/`:

- **`panel`** (carpeta `qcc-panel/`): mod con un panel lateral que muestra el contexto de la sesión, los límites de uso, el esfuerzo y el consumo de tokens. Comando `/panel`. Ver [MODS.md](MODS.md).
- **`impl`** (carpeta `qcc-implementador/`): el flujo `/impl` (con un solo modo), con sus agentes y herramientas. Ver [FLUJOS.md](FLUJOS.md).
- **`impl-d`** (carpeta `qcc-impl-directo/`): `/impl-d`, sin plan ni aprobación; la skill, su revisor y `limites.mjs` (el % de los límites que gastó), sin hooks ni guardia. Ver [FLUJOS.md](FLUJOS.md#impl-d).
- **`commit`** (carpeta `qcc-commit/`): el flujo `/commit`, con su agente y su guardia `solo-git`. Ver [FLUJOS.md](FLUJOS.md).

Los flujos corren como plugins: sus herramientas se llaman con `${CLAUDE_PLUGIN_ROOT}/herramientas/…`, y las guardias van en el `hooks/hooks.json` de cada plugin y deciden por el `agent_type` del evento (`impl:qcc-ejecutor`…), porque los agentes de un plugin ignoran `hooks:` en su frontmatter. Los `subagent_type` llevan el prefijo del plugin (`impl:`, `commit:`); los agentes conservan su nombre `qcc-…`. La carpeta de cada flujo, el registro y las cachés de verificar viven en `<git-dir>/qcc-impl/` (una por repo y por worktree, compartida entre cuentas); `flujos.jsonl` e `historial/` están en `~/.claude/flujos/registros`. Los plugins se leen desde este repo; `qcc-implementador/instalar.mjs` no instala nada: con `--limpiar` archiva en `~/.claude/_archivo-limpieza-<fecha>/` las copias de `/impl` y `/commit` que dejó en `~/.claude` una instalación por copia.

[README.md](README.md) es la entrada al repo: resume la instalación y enlaza a todo.

## Estructura

```
README.md                         entrada al repo e índice
AGENTS.md                         reglas generales (este archivo)
MODS.md                           documentación del mod panel (carpeta qcc-panel)
FLUJOS.md                         documentación de los flujos
LIMITES.md                        límites de uso (5 h y semanal) y el % que /impl anota por corrida y por fase (/impl-d, por corrida)
PENDIENTES.md                     lo que queda abierto, una línea por ítem
.claude/qcc-implementador.json    pasos de verificación para /impl
.claude/qcc-implementador/        reglas de /impl para este repo (un archivo por sección)
.claude-plugin/marketplace.json   marketplace «qcc» con los cuatro plugins (panel, impl, impl-d, commit)
qcc-implementador/                plugin impl
  .claude-plugin/plugin.json      manifiesto
  hooks/hooks.json                guardia.mjs en PreToolUse (Bash, PowerShell, Edit, Write, NotebookEdit, Read, Glob, Grep) y plan-visible.mjs (AskUserQuestion)
  instalar.mjs                    archiva (--limpiar) las copias viejas de /impl y /commit en ~/.claude
  skills/impl/SKILL.md            /impl
  agents/qcc-*.md                 explorador, planificador, ejecutor, revisor (sin hooks:, que se ignoran)
  herramientas/                   estado (entrada de línea de comandos, con --guia) y sus módulos estado-base, -plan, -exploracion, -guardar, -avance, -despachos, -preflight, -cambios y -cierre; verificar, guardia, plan-visible (la pregunta «Plan» muestra el plan), costos (consumo en tokens y % de límites por flujo y por fase, sin dólares), mover (bloques de líneas para el ejecutor), sus tests (guardia.test, plan-visible.test, estado.test, estado-fotos.test, estado-cambios.test, costos.test, verificar.test, mover.test) y pruebas-comun, comun.md, plan.md, pasos.md, config.ejemplo.md
qcc-impl-directo/                 plugin impl-d
  .claude-plugin/plugin.json      manifiesto
  skills/impl-d/SKILL.md          /impl-d
  agents/qcc-revisor-directo.md   revisor Opus high de /impl-d
  herramientas/                   limites.mjs (% de 5 h y semanal entre la carga de la skill y el cierre) y su test
qcc-commit/                       plugin commit
  .claude-plugin/plugin.json      manifiesto
  hooks/hooks.json                solo-git.mjs en PreToolUse (Bash, PowerShell)
  skills/commit/SKILL.md          /commit
  agents/qcc-generador-commit.md  agente Haiku high de /commit
  herramientas/                   solo-git.mjs y su test
qcc-panel/                        plugin panel
  .claude-plugin/plugin.json      manifiesto (nombre, versión, types)
  hooks/hooks.json                { "modules": ["./register.tsx"] }
  hooks/register.tsx              hooks, estado (atoms) y dibujo del panel
  hooks/semana.ts                 puro: registro de tokens por hora, resumen por modelo·esfuerzo
  hooks/formato.ts                puro: barras, cifras, tiempos, desglose del contexto
  hooks/carpeta.ts                puro: validar la ruta y elegir el comando que abre la carpeta
  hooks/flujo.ts                  puro: qué flujo corre y en qué paso, a partir de los eventos
  hooks/historial.ts              puro: leer flujos.jsonl y armar las líneas del historial; el snapshot de límites (qcc-limites.json) que lee /impl
  hooks/freno.ts                  puro: decidir si un envío se frena una vez con un aviso
  hooks/agentes.ts                puro: anotar los subagentes y los archivos tocados de la pestaña Agentes
  hooks/cache.ts                  puro: la cuenta regresiva del caché del prompt y su % de aciertos; los avisos de contexto
  hooks/instalados.ts             puro: detectar si hay un implementador instalado y qué vistas se muestran
  types/index.d.ts                tipos y contrato de $.state (PluginState['panel'])
  tests/panel.test.tsx            único archivo de tests
```

## Verificar

```
claude plugin validate qcc-panel
claude plugin test qcc-panel
node --test "qcc-implementador/herramientas/*.test.mjs"
node --test qcc-commit/herramientas/solo-git.test.mjs
node --test qcc-impl-directo/herramientas/limites.test.mjs
```

Los cinco comandos tienen que terminar sin errores antes de dar algo por hecho. Qué no prueban los tests del panel está en [MODS.md](MODS.md#verificar).

## Convenciones

- Código, comentarios, nombres y textos de UI en **español** (`medida`, `releerSemana`, «sin respuestas anotadas todavía»). Los términos técnicos y los niveles de esfuerzo quedan en inglés.
- Estilo: sin punto y coma, comillas simples y JSDoc breve en español. La línea en blanco antes de `return` rige solo en `qcc-panel/`; `qcc-implementador/`, `qcc-impl-directo/` y `qcc-commit/` no la usan.
- Las del panel (atoms, hotkeys, versión) están en [MODS.md](MODS.md#convenciones-del-panel).
- Documentación: describe cómo funciona el sistema ahora. Se reescribe la parte que cambió y se borra lo que dejó de ser cierto, sin «antes…/ahora…», «se cambió», fechas, versiones ni historial (eso lo guarda git), y solo con lo que un lector necesita para usar o mantener el sistema. Si un cambio no altera nada documentado, la documentación no se toca.
- Pendientes: lo que queda abierto va en [PENDIENTES.md](PENDIENTES.md), una línea por ítem, sin fecha; lo resuelto se borra, no se tacha.

## Flujo con /impl

`.claude/qcc-implementador.json` define la verificación (validate → test → test flujos → test qcc-commit → test impl-d). Las reglas propias del repo (qué es CRÍTICO, cómo buscar, motivos de rechazo) están en `.claude/qcc-implementador/` y mandan sobre las comunes. Las herramientas leen `.claude/implementador.json` y `.claude/implementador/` si `.claude/qcc-implementador*` no existe. `/impl` tiene un solo modo, con los pasos de `qcc-implementador/herramientas/pasos.md`: orquestador Sonnet high, planificador Opus medium (que además clasifica), ejecutor Sonnet (medium en subtareas `Crítica: no`; en lotes de hasta 4 en paralelo cuando el plan marca `Depende de` y los permitidos no se pisan, según la línea `LOTES:`) y revisión final siempre, Opus high, sin revisor por subtarea. Un flujo cortado se retoma con `estado.mjs --reanudar` (lo ofrece el preflight): el avance, la aprobación y cada revisión final quedan en la carpeta del flujo, y el cierre suma todas sus sesiones. Los comandos que la guardia negaría y el plan necesita (migraciones, deploys, servidores) se proponen como permisos en `PERMISOS A APROBAR`: el usuario los aprueba con el plan y solo pasan para el ejecutor de esa subtarea (los deploys y el `db:push` que nadie necesita antes son `post-revisión`: el orquestador los corre tras el cierre COMPLETO); lo de «Negado siempre» (ver [FLUJOS.md](FLUJOS.md)) se niega aun aprobado. Para cambios de documentación o pequeños, conviene trabajar directo en vez de usar el flujo completo.

**Reglas nuevas para `/impl`:** antes de sumar una regla a `comun.md`, `pasos.md`, `plan.md` o un agente por un incidente, mira con `costos.mjs --ultimos` y `~/.claude/flujos/registros/flujos.jsonl` si la regla vigente sobre lo mismo se cumple; si no se cumple, se corrige esa en vez de sumar otra. La medida que justifica la regla va en el mensaje del commit, no en la documentación. Una regla que el historial muestra sin efecto (nunca se dispara o no cambia el resultado) se borra.

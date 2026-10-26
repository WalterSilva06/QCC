# QCC (Quorum Claude Code)

Herramientas personales para Claude Code, en cuatro plugins de un marketplace (`qcc`, en `.claude-plugin/marketplace.json`; se instalan con `claude plugin install <plugin>@qcc`). Los plugins y sus comandos tienen nombre corto, pero las carpetas conservan el largo. Cada plugin lleva `.claude-plugin/plugin.json`, `skills/`, `agents/`, `hooks/hooks.json` y `herramientas/`:

- **`panel`** (carpeta `qcc-panel/`): mod con un panel lateral que muestra el contexto de la sesión, los límites de uso, el esfuerzo y el consumo de tokens. Comando `/panel`. Ver [MODS.md](MODS.md).
- **`impl`** (carpeta `qcc-implementador/`): el flujo `/impl` (con un solo modo), con sus agentes y herramientas. Ver [FLUJOS.md](FLUJOS.md).
- **`commit`** (carpeta `qcc-commit/`): el flujo `/commit`, con su agente y su guardia `solo-git`. Ver [FLUJOS.md](FLUJOS.md).
- **`odd`** (carpeta `qcc-implementador-odd/`): el flujo `/odd`, en prueba, separado por completo de `qcc-implementador/`. Tiene su skill, sus agentes, sus herramientas, su instalador, su config (`.claude/qcc-implementador-odd.json`) y su registro. Ninguno de los dos flujos usa archivos del otro. Ver [FLUJOS-ODD.md](FLUJOS-ODD.md).

Los flujos corren como plugins: sus herramientas se llaman con `${CLAUDE_PLUGIN_ROOT}/herramientas/…`, y las guardias van en el `hooks/hooks.json` de cada plugin y deciden por el `agent_type` del evento (`impl:qcc-ejecutor`…), porque los agentes de un plugin ignoran `hooks:` en su frontmatter. Los `subagent_type` llevan el prefijo del plugin (`impl:`, `odd:`, `commit:`); los agentes conservan su nombre `qcc-…`. Los registros siguen en `~/.claude/flujos/registros` y `~/.claude/flujos-odd/registros`. Los `instalar.mjs` ya no copian: `--limpiar` archiva en `~/.claude/_archivo-limpieza-<fecha>/` las copias viejas que dejaba la instalación anterior.

[README.md](README.md) es la entrada al repo: resume la instalación y enlaza a todo.

## Estructura

```
README.md                         entrada al repo e índice
AGENTS.md                         reglas generales (este archivo)
MODS.md                           documentación del mod panel (carpeta qcc-panel)
FLUJOS.md                         documentación de los flujos
FLUJOS-ODD.md                     documentación de /odd
.claude/qcc-implementador-odd.json verificación y críticos para /odd
.claude/qcc-implementador.json    pasos de verificación para /impl
.claude/qcc-implementador/        reglas de /impl para este repo (un archivo por sección)
.claude-plugin/marketplace.json   marketplace «qcc» con los cuatro plugins (panel, impl, commit, odd)
qcc-implementador/                plugin impl
  .claude-plugin/plugin.json      manifiesto
  hooks/hooks.json                guardia.mjs en PreToolUse (Bash, PowerShell, Edit, Write, NotebookEdit, Read, Glob, Grep)
  instalar.mjs                    archiva (--limpiar) las copias viejas de /impl y /commit en ~/.claude
  skills/impl/SKILL.md            /impl
  agents/qcc-*.md                 explorador, planificador, ejecutor, revisor (sin hooks:, que se ignoran)
  herramientas/                   estado (con --guia), verificar, guardia, costos, guardia.test, comun.md, plan.md, pasos.md, config.ejemplo.md
qcc-commit/                       plugin commit
  .claude-plugin/plugin.json      manifiesto
  hooks/hooks.json                solo-git.mjs en PreToolUse (Bash, PowerShell)
  skills/commit/SKILL.md          /commit
  agents/qcc-generador-commit.md  agente Haiku high de /commit
  herramientas/                   solo-git.mjs y su test
qcc-implementador-odd/            plugin odd
  .claude-plugin/plugin.json      manifiesto
  hooks/hooks.json                guardia.mjs en PreToolUse (ejecutor y revisor, por agent_type); la del orquestador va en el frontmatter del skill
  instalar.mjs                    archiva (--limpiar) la copia vieja de odd en ~/.claude
  skills/odd/SKILL.md             /odd, todas sus reglas
  agents/qcc-odd-*.md             explorador, ejecutor, revisor (sin hooks:)
  herramientas/                   odd, verificar, guardia, costo, proceso, copia, odd.test
qcc-panel/                        plugin panel
  .claude-plugin/plugin.json      manifiesto (nombre, versión, types)
  hooks/hooks.json                { "modules": ["./register.tsx"] }
  hooks/register.tsx              hooks, estado (atoms) y dibujo del panel
  hooks/semana.ts                 puro: registro de tokens por hora, resumen por modelo·esfuerzo
  hooks/formato.ts                puro: barras, cifras, tiempos, desglose del contexto
  hooks/carpeta.ts                puro: validar la ruta y elegir el comando que abre la carpeta
  hooks/flujo.ts                  puro: qué flujo corre y en qué paso, a partir de los eventos
  hooks/historial.ts              puro: leer flujos.jsonl y armar las líneas del historial
  hooks/freno.ts                  puro: decidir si un envío se frena una vez con un aviso
  hooks/agentes.ts                puro: anotar los subagentes y los archivos tocados de la pestaña Agentes
  types/index.d.ts                tipos y contrato de $.state (PluginState['panel'])
  tests/panel.test.tsx            único archivo de tests
```

## Verificar

```
claude plugin validate qcc-panel
claude plugin test qcc-panel
node --test qcc-implementador/herramientas/guardia.test.mjs
node --test qcc-commit/herramientas/solo-git.test.mjs
node --test qcc-implementador-odd/herramientas/odd.test.mjs
```

Los cinco comandos tienen que terminar sin errores antes de dar algo por hecho. Qué no prueban los tests del panel está en [MODS.md](MODS.md#verificar).

## Convenciones

- Código, comentarios, nombres y textos de UI en **español** (`medida`, `releerSemana`, «sin respuestas anotadas todavía»). Los términos técnicos y los niveles de esfuerzo quedan en inglés.
- Estilo: sin punto y coma, comillas simples y JSDoc breve en español. La línea en blanco antes de `return` rige solo en `qcc-panel/`; `qcc-implementador/`, `qcc-commit/` y `qcc-implementador-odd/` no la usan.
- Las del panel (atoms, hotkeys, versión) están en [MODS.md](MODS.md#convenciones-del-panel).

## Flujo con /impl

`.claude/qcc-implementador.json` define la verificación (validate → test → test flujos → test qcc-commit). Las reglas propias del repo (qué es CRÍTICO, cómo buscar, motivos de rechazo) están en `.claude/qcc-implementador/` y mandan sobre las comunes. Las herramientas siguen leyendo `.claude/implementador.json` y `.claude/implementador/` si el nombre nuevo no existe. `/impl` tiene un solo modo, con los pasos de `qcc-implementador/herramientas/pasos.md`: orquestador Sonnet high, planificador Sonnet high (que además clasifica), ejecutor Sonnet (medium en subtareas `Crítica: no`; en lotes de hasta 3 en paralelo cuando el plan marca `Depende de` y los permitidos no se pisan, según la línea `LOTES:`) y revisión final siempre, Opus high, sin revisor por subtarea. Para cambios de documentación o pequeños, conviene trabajar directo en vez de usar el flujo completo.

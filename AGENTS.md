# QCC (Quorum Claude Code)

Herramientas personales para Claude Code, en cinco plugins de un marketplace (`qcc`, en `.claude-plugin/marketplace.json`). Cada plugin lleva `.claude-plugin/plugin.json`, `skills/`, `agents/`, `hooks/hooks.json` y `herramientas/`:

- **`qcc-panel/`**: mod con un panel lateral que muestra el contexto de la sesión, los límites de uso, el esfuerzo y el consumo de tokens. Ver [MODS.md](MODS.md).
- **`qcc-implementador/`**: el flujo `/qcc-implementador` (con un solo modo), con sus agentes y herramientas. Ver [FLUJOS.md](FLUJOS.md).
- **`qcc-commit/`**: el flujo `/qcc-commit`, con su agente y su guardia `solo-git`. Ver [FLUJOS.md](FLUJOS.md).
- **`qcc-implementador-odd/`**: el flujo `/qcc-implementador-odd`, en prueba, separado por completo de `qcc-implementador/`. Tiene su skill, sus agentes, sus herramientas, su instalador, su config (`.claude/qcc-implementador-odd.json`) y su registro. Ninguno de los dos flujos usa archivos del otro. Ver [FLUJOS-ODD.md](FLUJOS-ODD.md).
- **`qcc/`**: el paquete, un plugin solo con `dependencies` que instala los otros cuatro.

Los flujos corren como plugins: sus herramientas se llaman con `${CLAUDE_PLUGIN_ROOT}/herramientas/…`, y las guardias van en el `hooks/hooks.json` de cada plugin y deciden por el `agent_type` del evento (`qcc-implementador:qcc-ejecutor`…), porque los agentes de un plugin ignoran `hooks:` en su frontmatter. Los `subagent_type` llevan el prefijo del plugin. Los registros siguen en `~/.claude/flujos/registros` y `~/.claude/flujos-odd/registros`. Los `instalar.mjs` ya no copian: `--limpiar` archiva en `~/.claude/_archivo-limpieza-<fecha>/` las copias viejas que dejaba la instalación anterior.

[README.md](README.md) es la entrada al repo: resume la instalación y enlaza a todo.

## Estructura

```
README.md                         entrada al repo e índice
AGENTS.md                         reglas generales (este archivo)
MODS.md                           documentación del mod qcc-panel
FLUJOS.md                         documentación de los flujos
FLUJOS-ODD.md                     documentación de /qcc-implementador-odd
.claude/qcc-implementador-odd.json verificación y críticos para /qcc-implementador-odd
.claude/qcc-implementador.json    pasos de verificación para /qcc-implementador
.claude/qcc-implementador/        reglas de /qcc-implementador para este repo (un archivo por sección)
.claude-plugin/marketplace.json   marketplace «qcc» con los cinco plugins
qcc/
  .claude-plugin/plugin.json      paquete: solo dependencies
qcc-implementador/
  .claude-plugin/plugin.json      manifiesto
  hooks/hooks.json                guardia.mjs en PreToolUse (Bash, PowerShell, Edit, Write, NotebookEdit, Read, Glob, Grep)
  instalar.mjs                    archiva (--limpiar) las copias viejas de /qcc-implementador y /qcc-commit en ~/.claude
  skills/qcc-implementador/SKILL.md   /qcc-implementador
  agents/qcc-*.md                 explorador, planificador, ejecutor, revisor (sin hooks:, que se ignoran)
  herramientas/                   estado (con --guia), verificar, guardia, costos, guardia.test, comun.md, plan.md, pasos.md, config.ejemplo.md
qcc-commit/
  .claude-plugin/plugin.json      manifiesto
  hooks/hooks.json                solo-git.mjs en PreToolUse (Bash, PowerShell)
  skills/qcc-commit/SKILL.md      /qcc-commit
  agents/qcc-generador-commit.md  agente Haiku high de /qcc-commit
  herramientas/                   solo-git.mjs y su test
qcc-implementador-odd/
  .claude-plugin/plugin.json      manifiesto
  hooks/hooks.json                guardia.mjs en PreToolUse (ejecutor y revisor, por agent_type); la del orquestador va en el frontmatter del skill
  instalar.mjs                    archiva (--limpiar) la copia vieja de odd en ~/.claude
  skills/qcc-implementador-odd/SKILL.md   todas sus reglas
  agents/qcc-odd-*.md             explorador, ejecutor, revisor (sin hooks:)
  herramientas/                   odd, verificar, guardia, costo, proceso, copia, odd.test
qcc-panel/
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
  types/index.d.ts                tipos y contrato de $.state (PluginState['qcc-panel'])
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

Los cinco tienen que terminar sin errores antes de dar algo por hecho. Qué no prueban los tests del panel está en [MODS.md](MODS.md#verificar).

## Convenciones

- Código, comentarios, nombres y textos de UI en **español** (`medida`, `releerSemana`, «sin respuestas anotadas todavía»). Los términos técnicos y los niveles de esfuerzo quedan en inglés.
- Estilo: sin punto y coma, comillas simples y JSDoc breve en español. La línea en blanco antes de `return` rige solo en `qcc-panel/`; `qcc-implementador/`, `qcc-commit/` y `qcc-implementador-odd/` no la usan.
- Las del panel (atoms, hotkeys, versión) están en [MODS.md](MODS.md#convenciones-del-panel).

## Flujo con /qcc-implementador

`.claude/qcc-implementador.json` define la verificación (validate → test → test flujos → test qcc-commit). Las reglas propias del repo (qué es CRÍTICO, cómo buscar, motivos de rechazo) están en `.claude/qcc-implementador/` y mandan sobre las comunes. Las herramientas siguen leyendo `.claude/implementador.json` y `.claude/implementador/` si el nombre nuevo no existe. `/qcc-implementador` tiene un solo modo, con los pasos de `qcc-implementador/herramientas/pasos.md`: orquestador Sonnet high, planificador Opus high (que además clasifica; medium si la exploración no toca rutas críticas), ejecutor Sonnet (medium en subtareas `Crítica: no`) y revisión final siempre, Opus high, sin revisor por subtarea. Para cambios de documentación o pequeños, conviene trabajar directo en vez de usar el flujo completo.

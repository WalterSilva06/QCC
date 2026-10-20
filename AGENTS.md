# QCC (Quorum Claude Code)

Herramientas personales para Claude Code, en dos partes separadas:

- **`qcc-panel/`**: mod (plugin) con un panel lateral que muestra el contexto de la sesión, los límites de uso, el esfuerzo y el consumo de tokens. Ver [MODS.md](MODS.md).
- **`flujos/`**: los flujos `/qcc-implementador` (con un solo modo) y `/qcc-commit`, con sus agentes y herramientas. Se instalan copiándolos a `~/.claude`. Ver [FLUJOS.md](FLUJOS.md).

[README.md](README.md) es la entrada al repo: resume la instalación y enlaza a todo.

## Estructura

```
README.md                         entrada al repo e índice
AGENTS.md                         reglas generales (este archivo)
MODS.md                           documentación del mod qcc-panel
FLUJOS.md                         documentación de los flujos
.claude/qcc-implementador.json    pasos de verificación para /qcc-implementador
.claude/qcc-implementador/        reglas de /qcc-implementador para este repo (un archivo por sección)
flujos/
  instalar.mjs                    copia los flujos a ~/.claude (o los trae con --traer)
  skills/<nombre>/SKILL.md        → ~/.claude/skills/<nombre>/SKILL.md
  agents/<nombre>.md              → ~/.claude/agents/<nombre>.md
  skills/qcc-implementador/SKILL.md → ~/.claude/skills/qcc-implementador/SKILL.md (/qcc-implementador)
  skills/qcc-commit/SKILL.md      → ~/.claude/skills/qcc-commit/SKILL.md (/qcc-commit)
  agents/qcc-*.md                 → ~/.claude/agents/qcc-*.md (explorador, planificador, revisor-plan, ejecutor, revisor y el de /qcc-commit)
  agents/qcc-generador-commit.md  agente Haiku high de /qcc-commit
  herramientas/                   → ~/.claude/flujos/ (estado, verificar, guardia, costos, guardia.test, comun.md, plan.md, pasos.md, config.ejemplo.md)
  herramientas/qcc-commit/        → ~/.claude/flujos/qcc-commit/ (solo-git.mjs y su test)
qcc-panel/
  .claude-plugin/plugin.json      manifiesto (nombre, versión, types)
  .claude-plugin/marketplace.json marketplace «mods-locales»
  hooks/hooks.json                { "modules": ["./register.tsx"] }
  hooks/register.tsx              hooks, estado (atoms) y dibujo del panel
  hooks/semana.ts                 puro: registro de tokens por hora, resumen por modelo·esfuerzo
  hooks/formato.ts                puro: barras, cifras, tiempos, desglose del contexto
  hooks/carpeta.ts                puro: validar la ruta y elegir el comando que abre la carpeta
  hooks/flujo.ts                  puro: qué flujo corre y en qué paso, a partir de los eventos
  hooks/historial.ts              puro: leer flujos.jsonl y armar las líneas del historial
  hooks/freno.ts                  puro: decidir si un envío se frena una vez con un aviso
  types/index.d.ts                tipos y contrato de $.state (PluginState['qcc-panel'])
  tests/panel.test.tsx            único archivo de tests
```

## Verificar

```
claude plugin validate qcc-panel
claude plugin test qcc-panel
node --test flujos/herramientas/guardia.test.mjs
node --test flujos/herramientas/qcc-commit/solo-git.test.mjs
```

Los cuatro tienen que terminar sin errores antes de dar algo por hecho. Qué no prueban los tests del panel está en [MODS.md](MODS.md#verificar).

## Convenciones

- Código, comentarios, nombres y textos de UI en **español** (`medida`, `releerSemana`, «sin respuestas anotadas todavía»). Los términos técnicos y los niveles de esfuerzo quedan en inglés.
- Estilo: sin punto y coma, comillas simples y JSDoc breve en español. La línea en blanco antes de `return` rige solo en `qcc-panel/`; `flujos/` no la usa.
- Las del panel (atoms, hotkeys, versión) están en [MODS.md](MODS.md#convenciones-del-panel).

## Flujo con /qcc-implementador

`.claude/qcc-implementador.json` define la verificación (validate → test → test flujos → test qcc-commit). Las reglas propias del repo (qué es CRÍTICO, cómo buscar, motivos de rechazo) están en `.claude/qcc-implementador/` y mandan sobre las comunes. Las herramientas siguen leyendo `.claude/implementador.json` y `.claude/implementador/` si el nombre nuevo no existe. `/qcc-implementador` tiene un solo modo, con los pasos de `flujos/herramientas/pasos.md`: orquestador Sonnet high, planificador Opus high (que además clasifica; medium si la exploración no toca rutas críticas), revisor del plan Sonnet medium, ejecutor Sonnet (medium en subtareas `Crítica: no`) y revisión final siempre, Opus high, sin revisor por subtarea. Para cambios de documentación o pequeños, conviene trabajar directo en vez de usar el flujo completo.

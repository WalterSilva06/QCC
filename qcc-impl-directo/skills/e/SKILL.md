---
name: e
description: "Flujo /impl-d:e, el modo esfuerzo de /impl-d: el mismo flujo con la sesión en Opus high y la revisión en Opus xhigh. Solo cuando el usuario escribe /impl-d:e; nunca por iniciativa propia."
argument-hint: "[-p] <qué cambiar>"
model: opus
effort: high
allowed-tools:
  - Read
  - Glob
  - Grep
  - Edit
  - Write
  - Agent
  - AskUserQuestion
  - TaskStop
  - Bash(git status*)
  - Bash(git diff*)
  - Bash(git log*)
  - Bash(node *${CLAUDE_PLUGIN_ROOT}/herramientas/corrida.mjs*)
---

# /impl-d:e

Modo esfuerzo de /impl-d: el mismo flujo, con la sesión en Opus high (lo fija esta skill) y el revisor en xhigh. Lee entero `${CLAUDE_PLUGIN_ROOT}/skills/n/SKILL.md` y síguelo desde «# /impl-d:n», con estos cambios:

- El `Pedido`, los `Sucios previos` y lo de `Al empezar` son los de abajo: ya corrieron, no los corras de nuevo.
- En ese archivo la variable de la carpeta del plugin sale sin expandir: la carpeta es `${CLAUDE_PLUGIN_ROOT}`, y `corrida.mjs` se corre como `node "${CLAUDE_PLUGIN_ROOT}/herramientas/corrida.mjs"`.
- El uso es `Uso: /impl-d:e [-p] <qué cambiar>`.
- **Preflight:** si tu herramienta Agent no tiene el parámetro `effort`, el revisor quedaría en high: dilo y termina.
- **Revisión:** cada revisor `impl-d:qcc-revisor-directo` va con `effort: "xhigh"`, su único override. Los exploradores, sin overrides.

**Pedido:** $ARGUMENTS

**Sucios previos** (no son del cambio): !`git status --short`

**Al empezar:** !`node "${CLAUDE_PLUGIN_ROOT}/herramientas/corrida.mjs" --inicio || echo "s/d (no corrió corrida.mjs)"`

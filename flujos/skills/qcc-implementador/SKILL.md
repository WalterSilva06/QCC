---
name: qcc-implementador
description: "Flujo /qcc-implementador multi-agente: explora, planifica, ejecuta por subtareas, verifica y cierra con una revisión final independiente. Solo cuando el usuario escribe /qcc-implementador; nunca por iniciativa propia."
argument-hint: "<qué cambiar>"
model: sonnet
effort: high
allowed-tools:
  - Read
  - Glob
  - Grep
  - AskUserQuestion
  - Bash(node *.claude/flujos/estado.mjs*)
  - Bash(node *.claude/flujos/verificar.mjs*)
  - Bash(git status*)
  - Bash(git diff*)
  - Bash(git log*)
  - Bash(cat *comun.md*)
  - Bash(cat *pasos.md*)
  - Bash(echo *)
---

# /qcc-implementador

Eres el orquestador: delegas, integras y controlas calidad.

**Pedido:** $ARGUMENTS

## Agentes

Pasa exactamente estos overrides de `model` y `effort`; «ninguno» = no pases ninguno. No hay revisor por subtarea: el `qcc-revisor` solo hace la revisión final.

| Agente | Overrides |
|---|---|
| `qcc-explorador` (Haiku, high) | ninguno; `effort: "max"` solo según el paso 1 |
| `qcc-planificador` (Opus, high) | ninguno; `effort: "medium"` si `--guardar … exploracion` dijo `RUTAS CRÍTICAS EN LA EXPLORACIÓN: ninguna` |
| `qcc-revisor-plan` (Sonnet, medium) | ninguno |
| `qcc-ejecutor` (Sonnet, high) | ninguno; `effort: "medium"` en una subtarea `Crítica: no` y sus correcciones (las correcciones de la revisión final, sin override) |
| `qcc-revisor`: revisión final y sus ciclos (Opus, high) | ninguno, también con Clasificación «sin criterios» |

## Reglas comunes

!`cat "$HOME/.claude/flujos/comun.md" || echo "AVISO: no se pudo inyectar comun.md. Léelo con Read en ~/.claude/flujos/comun.md antes de seguir."`

## Reglas del proyecto

!`node "$HOME/.claude/flujos/estado.mjs" --reglas || echo "AVISO: no se pudieron leer las reglas del proyecto. Léelas con Read en .claude/qcc-implementador/ (clasificacion.md, buscar.md, planificar.md) o en .claude/qcc-implementador.md (si no existen, valen .claude/implementador/ o .claude/implementador.md) antes de seguir."`

## Pasos

!`cat "$HOME/.claude/flujos/pasos.md" || echo "AVISO: no se pudo inyectar pasos.md. Léelo con Read en ~/.claude/flujos/pasos.md antes de seguir."`

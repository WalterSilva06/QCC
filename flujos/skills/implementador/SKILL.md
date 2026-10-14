---
name: implementador
description: "Flujo /implementador multi-agente: explora, planifica, ejecuta por subtareas con revisión independiente y verifica. Solo cuando el usuario escribe /implementador; nunca por iniciativa propia."
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
  - Bash(cat *implementador.md*)
  - Bash(echo *)
---

# /implementador

Eres el orquestador: delegas, integras y controlas calidad.

**Pedido:** $ARGUMENTS

## Agentes

Pasa exactamente estos overrides de `model` y `effort`; «ninguno» = no pases ninguno.

| Agente | Overrides |
|---|---|
| `explorador` (Haiku, high) | ninguno; `effort: "max"` solo según el paso 1 |
| `planificador` (Opus, high) | ninguno |
| `revisor-plan` (Sonnet, medium) | ninguno |
| `ejecutor` (Sonnet, high) | ninguno |
| `revisor` de subtarea `Crítica: sí` o sin el campo, y sus correcciones (Sonnet, high) | `model: "sonnet"`, `effort: "high"` |
| `revisor` de subtarea `Crítica: no`, y sus correcciones (Sonnet, medium) | `model: "sonnet"`, `effort: "medium"` |
| `revisor` de la revisión final, y sus ciclos (Opus, high) | ninguno |

## Reglas comunes

!`cat "$HOME/.claude/flujos/comun.md" || echo "AVISO: no se pudo inyectar comun.md. Léelo con Read en ~/.claude/flujos/comun.md antes de seguir."`

## Reglas del proyecto

!`cat "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || echo .)}/.claude/implementador.md" 2>/dev/null || echo "(Este proyecto no tiene .claude/implementador.md: rigen las reglas comunes, el CLAUDE.md del proyecto y lo que leas del repo.)"`

## Pasos

!`cat "$HOME/.claude/flujos/pasos.md" || echo "AVISO: no se pudo inyectar pasos.md. Léelo con Read en ~/.claude/flujos/pasos.md antes de seguir."`

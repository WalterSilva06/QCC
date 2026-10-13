---
name: implementador
description: "Flujo /implementador multi-agente (modos normal y ligero): explora, planifica, pide aprobación, ejecuta por subtareas con revisión independiente y verificación real. Solo corre cuando el usuario escribe /implementador o como relevo con args que empiezan por `RELEVO · vuelta`; nunca la invoques por iniciativa propia."
argument-hint: "<qué cambiar> | continuar"
model: opus
effort: medium
allowed-tools:
  - Read
  - Glob
  - Grep
  - AskUserQuestion
  - Skill
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

Eres el orquestador del modo **normal**: delegas, integras y controlas calidad.

**Pedido:** $ARGUMENTS

## Punto de entrada

- `RELEVO · vuelta`: vuelta desde el modo ligero; sigues en el paso 3 con los datos del RELEVO (pasos.md, Relevo) y no preguntas el modo.
- Otro `RELEVO` (`inicio`, `continuación`): no es un pedido nuevo; dilo y termina con `Uso: /implementador <qué cambiar> | continuar`.
- Si no, empiezas por el paso 0.

## Agentes de este modo

Pasa exactamente estos overrides de `model` y `effort`; «ninguno» = no pases ninguno.

| Agente | Overrides |
|---|---|
| `explorador` (Haiku, high) | ninguno; `effort: "max"` solo según el paso 1 |
| `planificador` (Opus, high) | ninguno |
| `revisor-plan` (Sonnet, medium) | ninguno |
| `ejecutor` (Sonnet, high) | ninguno |
| `revisor` de subtarea `Crítica: sí` y sus correcciones (Opus, medium) | `effort: "medium"` |
| `revisor` de subtarea `Crítica: no` y sus correcciones (Sonnet, medium) | `model: "sonnet"`, `effort: "medium"` |
| `revisor` integral (Opus, high) | ninguno |

## Reglas comunes

!`cat "$HOME/.claude/flujos/comun.md" || echo "AVISO: no se pudo inyectar comun.md. Léelo con Read en ~/.claude/flujos/comun.md antes de seguir."`

## Reglas del proyecto

!`cat "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || echo .)}/.claude/implementador.md" 2>/dev/null || echo "(Este proyecto no tiene .claude/implementador.md: rigen las reglas comunes, el CLAUDE.md del proyecto y lo que leas del repo.)"`

## Pasos

!`cat "$HOME/.claude/flujos/pasos.md" || echo "AVISO: no se pudo inyectar pasos.md. Léelo con Read en ~/.claude/flujos/pasos.md antes de seguir."`

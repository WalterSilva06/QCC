---
name: implementador-ligero
description: "Modo ligero de /implementador. Solo corre como relevo desde /implementador (args que empiezan con `RELEVO`); no la invoques ni la sugieras."
argument-hint: "RELEVO (solo desde /implementador)"
user-invocable: false
model: sonnet
effort: high
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

# /implementador — modo ligero

**Pedido:** $ARGUMENTS

## Punto de entrada

Antes de nada:

- Si el pedido no empieza con `RELEVO`, responde exactamente `Uso: /implementador <qué cambiar>` y termina.
- `RELEVO · inicio`: arrancas en el paso 3 con los datos del RELEVO.
- `RELEVO · continuación`: aplicas comun.md §8 con el ESTADO del RELEVO, sin volver a relevar.
- `RELEVO · vuelta`: responde que la vuelta va a `implementador` y termina.

Eres el orquestador del modo **ligero**: delegas y controlas calidad.

## Agentes de este modo

Pasa exactamente estos overrides de `model` y `effort`; «ninguno» = no pases ninguno.

| Agente | Overrides |
|---|---|
| `planificador` (Sonnet, high) | `model: "sonnet"` |
| `revisor-plan` (Sonnet, medium) | ninguno |
| `ejecutor` (Sonnet, high) | ninguno |
| `revisor` de subtarea y sus correcciones (Sonnet, high) | `model: "sonnet"` |
| `revisor` integral (Opus, medium) | `effort: "medium"` |

## Reglas comunes

!`cat "$HOME/.claude/flujos/comun.md" || echo "AVISO: no se pudo inyectar comun.md. Léelo con Read en ~/.claude/flujos/comun.md antes de seguir."`

## Reglas del proyecto

!`cat "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || echo .)}/.claude/implementador.md" 2>/dev/null || echo "(Este proyecto no tiene .claude/implementador.md: rigen las reglas comunes, el CLAUDE.md del proyecto y lo que leas del repo.)"`

## Pasos

!`cat "$HOME/.claude/flujos/pasos.md" || echo "AVISO: no se pudo inyectar pasos.md. Léelo con Read en ~/.claude/flujos/pasos.md antes de seguir."`

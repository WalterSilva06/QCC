---
name: implementador-ligero
description: "Modo ligero de /implementador. Solo corre como relevo desde /implementador (args que empiezan con `RELEVO`); no la invoques por tu cuenta ni la sugieras al usuario, que usa /implementador."
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

Antes de leer nada más:

- Si el pedido no empieza con `RELEVO`, responde exactamente `Uso: /implementador <qué cambiar>` y termina, sin hacer nada más.
- `RELEVO · inicio`: arrancas en el paso 3 (Plan) con los datos del RELEVO, sin preflight ni exploración.
- `RELEVO · continuación`: aplicas comun.md §8 con el ESTADO del RELEVO **sin volver a relevar** (ya estás en el modo ligero): retomas con ese ESTADO y no te relanzas a ti mismo.
- `RELEVO · vuelta` (no debería llegar aquí): responde que la vuelta va a `implementador` y termina.

## Rol

Eres el orquestador del modo **ligero** (Sonnet, esfuerzo high): delegas y controlas calidad. No escribes código. Los pasos y la vuelta a modo normal (pasos.md, paso 3) están en «Pasos»; las reglas, en «Reglas comunes».

## Agentes de este modo

Pasa exactamente estos `model` y `effort` (comun.md §4); si la celda dice «sin», no pases ese parámetro.

| Agente | Modelo | Esfuerzo |
|---|---|---|
| `explorador` | no corre (la exploración llega en el RELEVO) | — |
| `planificador` | Sonnet (`model: "sonnet"` en la llamada) | high |
| `revisor-plan` | Sonnet (sin overrides) | medium |
| `ejecutor` | Sonnet (sin overrides) | high |
| `revisor` (por subtarea y en las correcciones) | Sonnet (`model: "sonnet"` en la llamada) | high |
| `revisor` (revisión integral, uno solo) | Opus | medium (`effort: "medium"`) |

## Reglas comunes

!`cat "$HOME/.claude/flujos/comun.md" || echo "AVISO: no se pudo inyectar comun.md. Léelo con Read en ~/.claude/flujos/comun.md antes de seguir."`

## Reglas del proyecto

!`cat "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || echo .)}/.claude/implementador.md" 2>/dev/null || echo "(Este proyecto no tiene .claude/implementador.md: rigen las reglas comunes, el CLAUDE.md del proyecto y lo que leas del repo.)"`

## Pasos

!`cat "$HOME/.claude/flujos/pasos.md" || echo "AVISO: no se pudo inyectar pasos.md. Léelo con Read en ~/.claude/flujos/pasos.md antes de seguir."`

---
name: impl
description: "Flujo /impl multi-agente: explora, planifica, ejecuta por subtareas (en lotes paralelos si el plan lo permite), verifica y cierra con una revisión final independiente. Solo cuando el usuario escribe /impl; nunca por iniciativa propia."
argument-hint: "[-p] <qué cambiar>"
model: sonnet
effort: high
allowed-tools:
  - Read
  - Glob
  - Grep
  - AskUserQuestion
  - Bash(node *${CLAUDE_PLUGIN_ROOT}/herramientas/estado.mjs*)
  - Bash(node *${CLAUDE_PLUGIN_ROOT}/herramientas/verificar.mjs*)
  - Bash(git status*)
  - Bash(git diff*)
  - Bash(git log*)
  - Bash(echo *)
---

# /impl

Eres el orquestador: delegas, integras y controlas calidad.

**Pedido:** $ARGUMENTS

## Modo sin preguntas (`-p`)

Si el pedido empieza con la palabra `-p`, la quitas (el pedido es lo que sigue) y nunca llamas a AskUserQuestion: nadie va a responder, también bajo `claude -p`. Donde los pasos o las reglas comunes dicen preguntar, decides así, y cada decisión va, una línea, en `Decisiones sin preguntar:` del cierre, antes de «Queda para ti»:
- **Plan:** muestras el `PARA APROBAR` igual y lo apruebas tú (`--aprobado`, con tus `AJUSTES AL PLAN`); cada PREGUNTA del plan toma su supuesto.
- **Permisos:** ninguno se aprueba, tampoco un `NECESITA_PERMISO`: lo que los necesita va a «Queda para ti», como lo no aprobado del paso 4. Después del cierre no corres nada de «Queda para ti».
- **Otro flujo:** con el pedido `reanudar` o vacío, «Reanudar». Si no, `AVISO: hay otro flujo abierto` termina sin tocar nada (puede seguir corriendo) y `AVISO: hay un flujo cortado` es «Empezar de cero».
- **`ALCANCE: FUERA`:** «Restaurar».
- **Lo demás** (exploración que no cabe, `BLOQUEADO`, ampliar el alcance de una tanda, `SIN PASOS`): la opción que marcarías «(Recomendada)»; con `SIN PASOS`, seguir solo con revisión.

## Agentes

Pasa exactamente estos overrides de `model` y `effort`; «ninguno» = no pases ninguno. Los agentes son del plugin: el `subagent_type` lleva su prefijo, tal como sale en la tabla. No hay revisor por subtarea: el `qcc-revisor` solo hace la revisión final.

| Agente | Overrides |
|---|---|
| `impl:qcc-explorador` (Haiku, low) | ninguno |
| `impl:qcc-planificador` (Opus, medium) | ninguno |
| `impl:qcc-ejecutor` (Sonnet, high) | ninguno; `effort: "medium"` en una subtarea `Crítica: no` y sus correcciones (lo dice su DESPACHO); las correcciones de la revisión final, sin override. Los de un mismo lote de `LOTES:` van juntos en un mensaje, cada uno con su effort, y los de una tanda de correcciones de la revisión final también |
| `impl:qcc-revisor`: revisión final y sus ciclos (Opus, high) | ninguno, también con Clasificación «sin criterios» |

## Reglas comunes

!`node "${CLAUDE_PLUGIN_ROOT}/herramientas/estado.mjs" --guia comun --parte 1 || echo "AVISO: no se pudo inyectar comun.md (§1 a §4). Léelo con Read en ${CLAUDE_PLUGIN_ROOT}/herramientas/comun.md, hasta «## 5.», antes de seguir; en ese archivo, la variable CLAUDE_PLUGIN_ROOT es la carpeta que contiene herramientas/."`

!`node "${CLAUDE_PLUGIN_ROOT}/herramientas/estado.mjs" --guia comun --parte 2 || echo "AVISO: no se pudo inyectar comun.md (§5 a §7). Léelo con Read en ${CLAUDE_PLUGIN_ROOT}/herramientas/comun.md, desde «## 5.», antes de seguir; en ese archivo, la variable CLAUDE_PLUGIN_ROOT es la carpeta que contiene herramientas/."`

## Reglas del proyecto

!`node "${CLAUDE_PLUGIN_ROOT}/herramientas/estado.mjs" --reglas || echo "AVISO: no se pudieron leer las reglas del proyecto. Léelas con Read en .claude/qcc-implementador/ (clasificacion.md, buscar.md, planificar.md) o en .claude/qcc-implementador.md (si no existen, valen .claude/implementador/ o .claude/implementador.md) antes de seguir."`

## Pasos

!`node "${CLAUDE_PLUGIN_ROOT}/herramientas/estado.mjs" --guia pasos || echo "AVISO: no se pudo inyectar pasos.md. Léelo con Read en ${CLAUDE_PLUGIN_ROOT}/herramientas/pasos.md antes de seguir; en ese archivo, la variable CLAUDE_PLUGIN_ROOT es la carpeta que contiene herramientas/."`

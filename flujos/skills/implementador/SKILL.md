---
name: implementador
description: Flujo multi-agente completo para cambios críticos o amplios en cualquier proyecto con git. Explora, clasifica, planifica, pide aprobación, ejecuta por subtareas con revisión independiente y cierra con verificación real.
argument-hint: "<qué cambiar> | continuar"
disable-model-invocation: true
model: opus
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
  - Bash(cat *implementador.md*)
  - Bash(echo *)
---

# /implementador — flujo completo

Eres el **orquestador** (Opus, esfuerzo high): planificas, divides, delegas, integras y controlas calidad. No escribes código. Agentes: `explorador` (Haiku xhigh, 2 o 3 en paralelo si hay más de un área; max solo para un área muy grande), `planificador` (Opus high), `revisor-plan` (Sonnet high, una vez), `ejecutor` (Sonnet high), `revisor` (Opus high; en la revisión integral, hasta 3 en paralelo).

**Pedido:** $ARGUMENTS

## Reglas comunes

!`cat "$HOME/.claude/flujos/comun.md" || echo "AVISO: no se pudo inyectar comun.md. Léelo con Read en ~/.claude/flujos/comun.md antes de seguir."`

## Reglas del proyecto

!`cat "${CLAUDE_PROJECT_DIR:-.}/.claude/implementador.md" 2>/dev/null || echo "(Este proyecto no tiene .claude/implementador.md: rigen las reglas comunes, el CLAUDE.md del proyecto y lo que leas del repo.)"`

## Pasos

**0. Preflight**
- Pedido vacío → responde `Uso: /implementador <qué cambiar> | continuar` y termina. Pedido `continuar` → §8.
- Si tu herramienta Agent no tiene el parámetro `run_in_background`, fork mode está activo: cada subagente volverá en un turno nuevo con el modelo de la sesión. AskUserQuestion: «Seguir igual» / «Cancelar» (se arregla con `"CLAUDE_CODE_FORK_SUBAGENT": "0"` en `env` de `~/.claude/settings.json` y reiniciando Claude Code).
- `node ~/.claude/flujos/estado.mjs` → anota `BASE_GLOBAL`, `DESDE_GLOBAL`, rama y sucios previos. `ERROR` (p. ej. sin git) → dilo y termina. Si GUARDIA no dice OK, ponlo en el plan.
- `node ~/.claude/flujos/verificar.mjs` → verificación inicial. `SIN PASOS` → §1.

**1. Exploración** — `explorador` (§5): 2 o 3 en paralelo si el pedido toca más de un área, partidos por carpeta o capa sin solaparse; uno solo si nombra los archivos o es de una sola área (§5). A cada uno, sin `effort` (corre en xhigh); `effort: "max"` solo a un área muy grande, nunca a todos a la vez. Con varios, fusiona los reportes (§6) antes de clasificar.

**2. Clasificación** — cita los criterios de §2 y de las reglas del proyecto que aplican, o «sin criterios». Los usan el plan y la revisión integral. No hay otro camino: todo pedido sigue los pasos 3 a 6 tal cual.

**3. Plan** (§3)
- `planificador` (§5). Si trae PREGUNTAS, van arriba del plan. Revisa que cumpla §3 (archivos explícitos, «hecho cuando» verificable, reversión) y completa tú lo menor.
- **Revisión del plan (una vez):** con el plan entregado y lo menor completado, despacha `revisor-plan` (§5) antes de la aprobación (paso 4).
  - Fork mode: no se despacha; anótalo en el mensaje de aprobación como «revisión del plan omitida (fork mode)».
  - Falla o vuelve sin VEREDICTO claro: una repetición; si sigue igual, se sigue sin ella avisando «revisión del plan no disponible». No cuenta como ciclo.
  - `APROBADO` → paso 4.
  - `AJUSTAR` → no se relanza al planificador ni al `revisor-plan`. Aplicas tú lo menor o aditivo y muestras qué cambió. Lo que cambia el enfoque (contratos, tipos o datos de varias subtareas, o el reparto de archivos entre ellas) no lo rediseñas: va tal cual bajo el plan, en «Revisión del plan: para decidir», y lo decide el usuario en la aprobación (si pide ajustar por «Other», rige el re-plan único del paso 4).
  - En el mensaje de aprobación, una línea: `Revisión del plan: APROBADO | AJUSTAR (n corregidos por el orquestador, m para decidir) | omitida (<motivo>)`.
  - No se repite tras el re-plan del paso 4.

**4. Aprobación** — muestra el plan completo y llama a AskUserQuestion: pregunta «¿Apruebas el plan?», header «Plan», opciones «Aprobar» y «Cancelar»; los ajustes llegan por «Other».
- Cancelar → terminas sin tocar nada.
- Ajustes → por defecto los aplicas tú, sin planificador. Lo aditivo (una subtarea más, texto o formato, un límite añadido o quitado, otro orden) lo escribes en el plan y muestras solo lo que cambió y qué sigue igual. Re-planificas **una vez** solo si el ajuste cambia el enfoque de lo ya planificado (contratos, tipos o datos de subtareas existentes, o el reparto de archivos entre ellas): pasas PLAN VIGENTE y solo el ajuste (§5), y el planificador devuelve solo las subtareas afectadas. Vuelves a preguntar.

**5. Ejecución**, una subtarea a la vez
- Por subtarea: `estado.mjs --base` → `ejecutor` → `estado.mjs --cambios` → `revisor` de esa subtarea → hasta **2 ciclos** de corrección.
- Un tercer rechazo en el mismo punto → DETENIDO.

**6. Verificación final** — tu `verificar.mjs`. ROJO → 1 ciclo (corrección + revisión). Con ≥ 2 subtareas → revisión integral (§5): hasta 3 revisores en paralelo, uno por enfoque aplicable (§5), hasta 1 ciclo.

**7. Cierre** — §7.

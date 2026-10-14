**0. Preflight**
- Pedido vacío → responde `Uso: /implementador <qué cambiar> | continuar` y termina. Pedido `continuar` → comun.md §8.
- Si tu herramienta Agent no tiene el parámetro `run_in_background`, fork mode está activo: cada subagente vuelve en un turno nuevo y hereda el modelo de la sesión, así que el planificador y la revisión final pierden Opus. AskUserQuestion: «Cancelar (recomendado)» / «Seguir igual» (se arregla con `"CLAUDE_CODE_FORK_SUBAGENT": "0"` en `env` de `~/.claude/settings.json` y reiniciando Claude Code).
- `node ~/.claude/flujos/estado.mjs` → anota `BASE_GLOBAL`, `DESDE_GLOBAL`, rama y sucios previos. `ERROR` → comun.md §1. Si GUARDIA no dice OK, ponlo en el plan.
- `node ~/.claude/flujos/verificar.mjs` → verificación inicial. `SIN PASOS` → comun.md §1.

**1. Exploración** — `explorador` (comun.md §5). `effort: "max"` solo a un área muy grande, nunca a todos. Con varios, fusiona (comun.md §6) antes de planificar.

**2. Clasificación y plan** (comun.md §2 y §3)
- `planificador` (comun.md §5), que clasifica con §2 y las reglas del proyecto y marca `Crítica`. Si trae PREGUNTAS, van arriba del plan.
- Revisa que cumpla comun.md §3 (archivos explícitos, «hecho cuando» verificable, reversión, `Crítica` en cada subtarea) y completa tú lo menor. Sin Clasificación → CRÍTICO. Sin `Crítica` → `sí`. Una subtarea `no` que toca una ruta crítica de las reglas del proyecto → `sí`.

**3. Revisión del plan (una vez)** — `revisor-plan` (comun.md §5) antes del paso 4; su resultado, según comun.md §6. En fork mode no se despacha. En el mensaje de aprobación, una línea: `Revisión del plan: APROBADO | AJUSTAR (n corregidos por el orquestador, m para decidir) | omitida (<motivo>)`. No se repite tras el re-plan del paso 4.

**4. Aprobación** — muestra el plan completo y llama a AskUserQuestion: pregunta «¿Apruebas el plan?», header «Plan», opciones «Aprobar» y «Cancelar»; los ajustes llegan por «Other».
- Cancelar → terminas sin tocar nada.
- Ajustes → los aplicas tú en el plan y muestras solo lo que cambió. Re-planificas **una vez** solo si el ajuste cambia el enfoque (comun.md §6) de lo ya planificado: PLAN VIGENTE y solo el ajuste (comun.md §5); el planificador devuelve solo las subtareas afectadas. Vuelves a preguntar.

**5. Ejecución**, una subtarea a la vez: `estado.mjs --base` → `ejecutor` → `estado.mjs --cambios` → tu `verificar.mjs` (comun.md §6) → `revisor` (el de tu tabla según su `Crítica`, con `VERIFICAR`, `VERIFICACIÓN DEL ORQUESTADOR` y, en correcciones, `REVISIÓN ANTERIOR`, de comun.md §5), también en las correcciones → hasta **2 ciclos**; agotados → DETENIDO.

**6. Verificación final** — tu `verificar.mjs`. ROJO → 1 ciclo (corrección + revisión). Después, siempre, revisión final (comun.md §5), con los ciclos de comun.md §6; en ellos la revisión final lleva `REVISIÓN ANTERIOR`.

**7. Cierre** — comun.md §7.

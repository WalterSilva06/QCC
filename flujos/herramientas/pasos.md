**0. Preflight**
- Pedido vacío → responde `Uso: /implementador <qué cambiar>` y termina.
- Si tu herramienta Agent no tiene el parámetro `run_in_background`, fork mode está activo y el planificador y la revisión final perderían Opus: dilo (se apaga con `"CLAUDE_CODE_FORK_SUBAGENT": "0"` en `env` de `~/.claude/settings.json`, reiniciando Claude Code) y termina.
- `node ~/.claude/flujos/estado.mjs --paso 0` → anota `BASE_GLOBAL`, `DESDE_GLOBAL`, rama y sucios previos. `ERROR` → comun.md §1. Si GUARDIA no dice OK, ponlo en el plan.
- `node ~/.claude/flujos/verificar.mjs` → verificación inicial. `SIN PASOS` → comun.md §1.

**1. Exploración** — antes de lanzar el explorador, aplica la «Exploración mínima» (comun.md §5): si se cumple su condición la haces tú y pasas al paso 2. Si no, `explorador` (comun.md §5): uno por defecto; varios solo según comun.md §5. `effort: "max"` solo a un área muy grande, nunca a todos. Con varios, fusiona (comun.md §6) antes de planificar.

**2. Clasificación y plan** (plan.md §2 y §3)
- `planificador` (comun.md §5), que clasifica con plan.md §2 y las reglas del proyecto y marca `Crítica`. Si trae PREGUNTAS, van arriba del plan.
- Revisa que cumpla el resumen del plan en comun.md (archivos explícitos, «hecho cuando» verificable, reversión, `Crítica` en cada subtarea) y completa tú lo menor. Sin Clasificación → CRÍTICO. Sin `Crítica` → `sí`. Una subtarea `no` que toca una ruta crítica de las reglas del proyecto → `sí`.

**3. Revisión del plan (una vez)** — `revisor-plan` (comun.md §5) antes del paso 4; su resultado, según comun.md §6. Se omite solo si, después de los completados del paso 2, la Clasificación es «sin criterios», ninguna subtarea queda `Crítica: sí` y el plan tiene 1 o 2 subtareas. En ese caso compruebas además la coherencia con la EXPLORACIÓN: cada archivo acoplado está en los permitidos de alguna subtarea o en «Fuera de alcance» con motivo, y el plan no contradice las DUDAS ni una decisión registrada; lo menor lo completas y lo demás va a «para decidir». Anota `Revisión del plan: omitida (sin criterios, <n> subtarea(s))`. Con CRÍTICO o con 3 o más subtareas corre siempre. En el mensaje de aprobación, una línea: `Revisión del plan: APROBADO | AJUSTAR (n corregidos por el orquestador, m para decidir) | omitida (<motivo>)`. No se repite tras el re-plan del paso 4.

**4. Aprobación** — muestra el plan completo y llama a AskUserQuestion: pregunta «¿Apruebas el plan?», header «Plan», opciones «Aprobar» y «Cancelar»; los ajustes llegan por «Other».
- Cancelar → terminas sin tocar nada.
- Ajustes → los aplicas tú y muestras solo lo que cambió. Re-planificas **una vez** solo si el ajuste cambia el enfoque (comun.md §6): PLAN VIGENTE y solo el ajuste (comun.md §5); el planificador devuelve solo las subtareas afectadas: integras esas y muestras solo ellas más la línea `Sin cambios: …`; el resto ya lo vio el usuario. Vuelves a preguntar.

**5. Ejecución**, una subtarea a la vez (el `--paso` de cada `estado.mjs` está en comun.md §1).
- Con 2 o más subtareas: `estado.mjs --base --paso 5` → `ejecutor` → `estado.mjs --cambios … --paso 5` → tu `verificar.mjs` → `revisor` (el de tu tabla según su `Crítica`; comun.md §5 y §6), también en las correcciones → hasta **2 ciclos**; agotados → DETENIDO.
- Con una sola subtarea: `estado.mjs --base --paso 5` → `ejecutor` → `estado.mjs --cambios … --paso 6` → tu `verificar.mjs`, que ya es la verificación final (no se repite en el paso 6) → revisión final con `VERIFICACIÓN FINAL`, sin revisor por subtarea. Hasta **2 ciclos** de ejecutor/verificación; sus correcciones repiten ese tramo (`--cambios … --paso 6` → `verificar.mjs` → revisión final).

**6. Verificación final** — tu `verificar.mjs` (con una sola subtarea ya lo corriste en el paso 5). Con 2 o más, córrelo siempre después del último revisor, aunque ya tengas un VERDE previo: es la señal con la que el panel marca este paso. ROJO → 1 ciclo (corrección + revisión). Después, siempre, revisión final (comun.md §5), con los ciclos de comun.md §6. Las correcciones de este paso llevan `estado.mjs --cambios … --paso 6`.

**7. Cierre** — comun.md §7 (`estado.mjs --cambios … --paso 7`).

**0. Preflight**
- Pedido vacío → responde `Uso: /implementador <qué cambiar> | continuar` y termina. Pedido `continuar` → comun.md §8.
- Si tu herramienta Agent no tiene el parámetro `run_in_background`, fork mode está activo: cada subagente vuelve en un turno nuevo con el modelo de la sesión y no hay relevo ni modo ligero. AskUserQuestion: «Seguir igual» / «Cancelar» (se arregla con `"CLAUDE_CODE_FORK_SUBAGENT": "0"` en `env` de `~/.claude/settings.json` y reiniciando Claude Code).
- `node ~/.claude/flujos/estado.mjs` → anota `BASE_GLOBAL`, `DESDE_GLOBAL`, rama y sucios previos. `ERROR` → comun.md §1. Si GUARDIA no dice OK, ponlo en el plan.
- `node ~/.claude/flujos/verificar.mjs` → verificación inicial. `SIN PASOS` → comun.md §1.

**1. Exploración** (solo normal) — `explorador` (comun.md §5). `effort: "max"` solo a un área muy grande, nunca a todos. Con varios, fusiona (comun.md §6) antes de clasificar.

**2. Clasificación** — cita los criterios de comun.md §2 y de las reglas del proyecto que aplican, o «sin criterios».
- Si califica para ligero (comun.md §2) y no hay fork mode → AskUserQuestion con header «Modo», opciones «Ligero (recomendado)» y «Normal» (un «Other» sin elección clara cuenta como Normal). Ligero → relevo `inicio` a `implementador-ligero`.
- Si no califica, sigue en normal sin preguntar. En fork mode, avisa «modo ligero no disponible (fork mode)».

**3. Plan** (comun.md §3)
- `planificador` (comun.md §5). Si trae PREGUNTAS, van arriba del plan. Revisa que cumpla comun.md §3 (archivos explícitos, «hecho cuando» verificable, reversión, `Crítica` en cada subtarea) y completa tú lo menor; si falta `Crítica`, ponla en `sí`.
- **Vuelta (solo en ligero):** con cada plan (este paso o el re-plan del paso 4), antes del `revisor-plan`: si su Clasificación cita algún criterio CRÍTICO, o tiene más de 3 subtareas o más de 6 archivos permitidos en total → relevo `vuelta` a `implementador` con la CLASIFICACIÓN del plan y el MOTIVO. El normal rehace este paso 3 completo (`planificador` y `revisor-plan`) con esos datos.
- **Revisión del plan (una vez):** `revisor-plan` (comun.md §5) antes del paso 4; su resultado, según comun.md §6. En fork mode no se despacha. En el mensaje de aprobación, una línea: `Revisión del plan: APROBADO | AJUSTAR (n corregidos por el orquestador, m para decidir) | omitida (<motivo>)`. No se repite tras el re-plan del paso 4 dentro del mismo modo.

**4. Aprobación** — muestra el plan completo y llama a AskUserQuestion: pregunta «¿Apruebas el plan?», header «Plan», opciones «Aprobar» y «Cancelar»; los ajustes llegan por «Other».
- Cancelar → terminas sin tocar nada.
- Ajustes → los aplicas tú en el plan y muestras solo lo que cambió. Re-planificas **una vez** solo si el ajuste cambia el enfoque (comun.md §6) de lo ya planificado: PLAN VIGENTE y solo el ajuste (comun.md §5); el planificador devuelve solo las subtareas afectadas. En ligero, el re-plan pasa por la Vuelta del paso 3. Vuelves a preguntar.

**5. Ejecución**, una subtarea a la vez: `estado.mjs --base` → `ejecutor` → `estado.mjs --cambios` → `revisor` (el de tu tabla según su `Crítica`, con `VERIFICAR` de comun.md §5), también en las correcciones → hasta **2 ciclos**; agotados → DETENIDO.

**6. Verificación final** — tu `verificar.mjs`. ROJO → 1 ciclo (corrección + revisión). Con ≥ 2 subtareas → revisión integral (comun.md §5), hasta 1 ciclo.

**7. Cierre** — comun.md §7.

### Relevo

Cambiar de modo es un relevo: la herramienta Skill hacia la skill del otro modo, nunca Agent. Tras invocarla no haces nada más, salvo una línea «Relevo a modo <ligero | normal>». La primera línea de los args es exactamente `RELEVO · <inicio | vuelta | continuación>`:

```
RELEVO · <inicio | vuelta | continuación>
PEDIDO: <literal del usuario>
BASE_GLOBAL: <sha> · DESDE_GLOBAL: <iso>
RAMA: <rama> · SUCIOS PREVIOS: <lista | ninguno> · VERIFICACIÓN INICIAL: <VERDE | ROJA (…) | SIN PASOS> · GUARDIA: <OK | aviso>
CLASIFICACIÓN: <criterios #n y por qué | sin criterios>
EXPLORACIÓN: <reporte fusionado (comun.md §6), completo>
MOTIVO: <solo vuelta: por qué no cabe en ligero; si ocurre en el re-plan del paso 4, también el PLAN VIGENTE y los AJUSTES DEL USUARIO>
ESTADO: <solo continuación: el último plan y si fue aprobado, BASE/DESDE y estado de cada subtarea, ciclos usados>
```

`inicio`: normal → ligero (paso 2) · `vuelta`: ligero → normal (paso 3) · `continuación`: `continuar` (comun.md §8). Quien recibe un RELEVO no hace preflight ni exploración y usa esos datos como propios (`BASE_GLOBAL`/`DESDE_GLOBAL` del RELEVO, nunca una foto nueva).

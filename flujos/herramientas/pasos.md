# Pasos de /implementador

Fuente única, a nivel usuario (`~/.claude/flujos/pasos.md`): las dos skills (`implementador` e `implementador-ligero`) la inyectan junto con `comun.md`. Los dos modos siguen exactamente estos pasos, agentes, plantillas y ciclos; solo cambian `model` y `effort`, y los fija la tabla de tu skill (no pases otros, comun.md §4). Las reglas están en comun.md (§1–§8), que también se inyecta.

## Relevo

Cambiar de modo es un relevo: la herramienta Skill hacia la skill del otro modo, nunca Agent (un subagente no puede lanzar subagentes ni usar AskUserQuestion). Tras invocarla no haces nada más, salvo una línea «Relevo a modo <ligero | normal>». La primera línea de los args es exactamente `RELEVO · <inicio | vuelta | continuación>` (el panel la usa para no abrir un flujo nuevo). Bloque:

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

Tipos:

- `inicio`: normal → ligero, en el paso 2.
- `vuelta`: ligero → normal, en el paso 3.
- `continuación`: `continuar` (comun.md §8).

Quien recibe un RELEVO no hace preflight ni exploración y usa esos datos como propios (`BASE_GLOBAL`/`DESDE_GLOBAL` del RELEVO, nunca una foto nueva). Fork mode: no hay relevo; todo sigue en normal.

## Pasos

**0. Preflight**
- Pedido vacío → responde `Uso: /implementador <qué cambiar> | continuar` y termina. Pedido `continuar` → comun.md §8.
- Si tu herramienta Agent no tiene el parámetro `run_in_background`, fork mode está activo: cada subagente volverá en un turno nuevo con el modelo de la sesión, y no habrá relevo ni modo ligero. AskUserQuestion: «Seguir igual» / «Cancelar» (se arregla con `"CLAUDE_CODE_FORK_SUBAGENT": "0"` en `env` de `~/.claude/settings.json` y reiniciando Claude Code).
- `node ~/.claude/flujos/estado.mjs` → anota `BASE_GLOBAL`, `DESDE_GLOBAL`, rama y sucios previos. `ERROR` (p. ej. sin git) → dilo y termina. Si GUARDIA no dice OK, ponlo en el plan.
- `node ~/.claude/flujos/verificar.mjs` → verificación inicial. `SIN PASOS` → comun.md §1.

**1. Exploración** (solo en modo normal; el ligero la recibe en el RELEVO) — `explorador` (comun.md §5): 2 o 3 en paralelo si el pedido toca más de un área, partidos por carpeta o capa sin solaparse; uno solo si nombra los archivos o es de una sola área (comun.md §5). A cada uno, sin `effort` (corre en xhigh); `effort: "max"` solo a un área muy grande, nunca a todos a la vez. Con varios, fusiona los reportes (comun.md §6) antes de clasificar.

**2. Clasificación** — cita los criterios de comun.md §2 y de las reglas del proyecto que aplican, o «sin criterios». Los usan el plan y la revisión integral.
- Luego el modo. Si no hay ningún criterio CRÍTICO, se estiman ≤ 3 subtareas y ≤ 6 archivos en total (tests incluidos) y no hay fork mode → AskUserQuestion con header «Modo», opciones «Ligero (recomendado)» y «Normal» (un «Other» sin elección clara cuenta como Normal).
- Ligero → relevo `inicio` a la skill `implementador-ligero`.
- Si no califica, no se pregunta y se sigue en normal hasta el final. En fork mode no se pregunta; se avisa «modo ligero no disponible (fork mode)».

**3. Plan** (comun.md §3)
- `planificador` (comun.md §5), en los dos modos, con el `model`/`effort` de la tabla de tu skill. Si trae PREGUNTAS, van arriba del plan. Revisa que cumpla comun.md §3 (archivos explícitos, «hecho cuando» verificable, reversión) y completa tú lo menor.
- **Vuelta (solo en modo ligero):** al recibir cada plan (este paso o el re-plan del paso 4) y antes del `revisor-plan`: si su Clasificación cita algún criterio CRÍTICO, o tiene más de 3 subtareas, o más de 6 archivos permitidos en total → relevo `vuelta` a la skill `implementador` con la CLASIFICACIÓN del plan y el MOTIVO. Quien recibe la vuelta (normal) relanza `planificador` sin `model` desde este paso, con la CLASIFICACIÓN y el MOTIVO (y PLAN VIGENTE/AJUSTES DEL USUARIO si vienen), y no vuelve a preguntar el modo.
- **Revisión del plan (una vez):** con el plan entregado y lo menor completado, despacha `revisor-plan` (comun.md §5), en los dos modos, antes de la aprobación (paso 4).
  - Fork mode: no se despacha; anótalo en el mensaje de aprobación como «revisión del plan omitida (fork mode)».
  - Falla o vuelve sin VEREDICTO claro: una repetición; si sigue igual, se sigue sin ella avisando «revisión del plan no disponible». No cuenta como ciclo.
  - `APROBADO` → paso 4.
  - `AJUSTAR` → no se relanza al planificador ni al `revisor-plan`. Aplicas tú lo menor o aditivo y muestras qué cambió. Lo que cambia el enfoque (contratos, tipos o datos de varias subtareas, o el reparto de archivos entre ellas) no lo rediseñas: va tal cual bajo el plan, en «Revisión del plan: para decidir», y lo decide el usuario en la aprobación (si pide ajustar por «Other», rige el re-plan único del paso 4).
  - En el mensaje de aprobación, una línea: `Revisión del plan: APROBADO | AJUSTAR (n corregidos por el orquestador, m para decidir) | omitida (<motivo>)`.
  - No se repite tras el re-plan del paso 4, dentro del mismo modo. Si el modo normal recibe una `vuelta` (del paso 3 o de un re-plan del paso 4), hace este paso 3 completo: `planificador` sin `model` y revisión con `revisor-plan`.

**4. Aprobación** — muestra el plan completo y llama a AskUserQuestion: pregunta «¿Apruebas el plan?», header «Plan», opciones «Aprobar» y «Cancelar»; los ajustes llegan por «Other».
- Cancelar → terminas sin tocar nada.
- Ajustes → por defecto los aplicas tú, sin planificador. Lo aditivo (una subtarea más, texto o formato, un límite añadido o quitado, otro orden) lo escribes en el plan y muestras solo lo que cambió y qué sigue igual. Re-planificas **una vez** solo si el ajuste cambia el enfoque de lo ya planificado (contratos, tipos o datos de subtareas existentes, o el reparto de archivos entre ellas): pasas PLAN VIGENTE y solo el ajuste (comun.md §5), y el planificador devuelve solo las subtareas afectadas. En modo ligero, el plan re-planificado también pasa por la vuelta del paso 3. Vuelves a preguntar.

**5. Ejecución**, una subtarea a la vez
- Por subtarea: `estado.mjs --base` → `ejecutor` → `estado.mjs --cambios` → `revisor` de esa subtarea (con el `effort` de tu tabla; en ligero, `medium`, también en las correcciones) → hasta **2 ciclos** de corrección.
- Un tercer rechazo en el mismo punto → DETENIDO.

**6. Verificación final** — tu `verificar.mjs`. ROJO → 1 ciclo (corrección + revisión). Con ≥ 2 subtareas, en los dos modos → revisión integral (comun.md §5): hasta 3 revisores en paralelo, uno por enfoque aplicable (comun.md §5), con el `effort` de tu tabla (en ligero, `medium`, también en las correcciones), hasta 1 ciclo.

**7. Cierre** — comun.md §7.

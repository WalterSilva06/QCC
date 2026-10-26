# /impl: planificador siempre Sonnet high y ejecutores en lotes paralelos
Objetivo: dos mejoras a /impl (plugin qcc-implementador) · Rama: master · Tests: node --test (guardia.test.mjs) y claude plugin test qcc-panel

## Specs
S1. El planificador de /impl (clasificación y plan, paso 2) es siempre Sonnet high: sin el override a `effort: "medium"` cuando la exploración dice `RUTAS CRÍTICAS EN LA EXPLORACIÓN: ninguna` — «dejar que 2 Clasificación y plan siempre sea sonnet high» · Hecho cuando: `agents/qcc-planificador.md` dice `model: sonnet` y `effort: high`, la tabla del skill y pasos.md no mencionan ningún override del planificador, y `estado.mjs` ya no escribe «planificador con effort medium» → guardia.test.mjs verde.
S2. El rótulo del panel dice «planificador · Sonnet high» donde hoy dice «planificador · Opus high» · Hecho cuando: `claude plugin test qcc-panel` verde con los tests de flujo.ts actualizados.
S3. El plan acepta el campo opcional `- Depende de: ninguna | S<n>, S<m>` por subtarea — «si el plan lo permite» · Hecho cuando: `--guardar … plan` lo guarda como `depende` (lista de enteros; `ninguna` = lista vacía; ausente = sin valor) sin AVISO de campo faltante; ausente significa «depende de la subtarea anterior», o sea serial como hoy. Una referencia a una subtarea inexistente, a sí misma o a una posterior da un AVISO y se trata como ausente.
S4. `estado.mjs` calcula los lotes de ejecución y `--guardar … plan` (también con `--ajuste`) imprime una línea `LOTES: S1 | S2+S3 | S4` — «múltiples ejecutores como lo hace odd» · Regla: recorre las subtareas en orden; una subtarea entra al lote en curso solo si no depende de ninguna de sus miembros, sus permitidos no se pisan con los de ningún miembro (un archivo dentro de una carpeta o de un glob del otro cuenta como pisarse), tiene permitidos y el lote tiene menos de 3; si no, abre otro lote. Hecho cuando: test de `lotesDe` con serial, independientes, pisados, sin permitidos y tope de 3.
S5. `--base --sub 1,2` toma una sola foto para el lote y la guarda en cada n con `lote: [1,2]`; `--cambios --sub 1,2` mide el lote contra esa foto, con los permitidos unidos y `ALCANCE` contra la unión. `--cambios --sub n` de un miembro de un lote de varios mide el lote entero y lo avisa. Un solo número se comporta exactamente como hoy · Hecho cuando: tests con lote de 2, miembro suelto, lista inválida y compatibilidad de un solo número.
S6. El cierre atribuye archivos/mas/menos por subtarea también dentro de un lote: para cada miembro, `numstat` de la foto del lote a la siguiente (o al árbol de ahora) limitado a lo que cae en sus propios permitidos · Hecho cuando: test de `cambiosPorSubtarea` con un lote de 2 y archivos disjuntos.
S7. El paso 5 de pasos.md (y comun.md §5/§6, plan.md y la tabla del skill) describe los lotes: por cada lote de `LOTES:`, un solo mensaje con `estado.mjs --base --sub <lista>` y un `qcc-ejecutor` por subtarea (cada uno con su `SUBTAREA n/`, sus permitidos y su effort); al volver todos, un solo mensaje con `estado.mjs --cambios --sub <lista>` y `verificar.mjs`; las correcciones van una subtarea a la vez, hasta 2 ciclos por subtarea; un lote de una subtarea es el flujo de hoy. plan.md pide al planificador marcar `Depende de: ninguna` solo si la subtarea no necesita código, tipos, datos ni tests de otra y no comparten archivos · Hecho cuando: esos archivos lo dicen sin contradecirse (grep de «Uno a la vez» y «una subtarea a la vez» no deja frases desactualizadas).
S8. FLUJOS.md y AGENTS.md describen el planificador Sonnet high y los lotes; `qcc-implementador/.claude-plugin/plugin.json` sube a 0.2.0 y `qcc-panel/.claude-plugin/plugin.json` a 0.33.1 · Hecho cuando: grep de «Opus high» ligado al planificador no encuentra nada en esos archivos.

## Fuera de alcance
- `qcc-implementador-odd/` y `/odd`: no se tocan — el pedido es solo /impl.
- Verificar qué ejecutor editó qué archivo dentro de un lote (atribución por agente): la unión de permitidos solo detecta lo que sale de toda la unión; el revisor final ve el resto. Queda en «Para decidir».
- Lock de `anotarEstado`: los Bash que no son de solo lectura corren de a uno, así que las fotos no concurren.
- El panel no cambia más que el rótulo; ya no asume un ejecutor activo.

## Tasks
- [x] T1 (S1, S3, S4, S5, S6) · ejecutor (contrato compartido, va primero y en serie) · ÁREA planificador, ÁREA ejecución · guardia.test.mjs 73/73; RED→GREEN en los tests de lotesDe, foto suelta y lote de 2; corregido tras el revisor (foto suelta → ERROR, globs que se pisan)
  Qué: `qcc-implementador/herramientas/estado.mjs` y `qcc-implementador/herramientas/guardia.test.mjs`.
  - `criticasDeExploracion` (estado.mjs:546-560 y :590): la línea sigue diciendo `ninguna`, sin el paréntesis «(planificador con effort medium)». Actualiza guardia.test.mjs:1250-1253.
  - `CAMPOS_SUBTAREA` (estado.mjs:359): el campo `Depende de` es opcional (no entra en los AVISOS de campo faltante). Parsea `ninguna` o `S<n>, …` a `depende` en `estado.subtareas[i]`; referencias inválidas → AVISO `S<n> · Depende de: …` y se trata como ausente. El `--guardar … plan` y su variante `--ajuste` (imprime resumen en :611) agregan la línea `LOTES:`.
  - `lotesDe(subtareas)` exportada, con la regla del S4 (solapamiento de permitidos con `enAlcance`, ya existente, en ambos sentidos).
  - Opciones: `--sub` acepta una lista `1,2,3` (enteros ≥ 1 sin repetir; si no, el mismo error de hoy). `fotoDeSubtarea` (estado.mjs:1292) con lista toma una sola foto y la guarda como `{ base, desde, lote: [..] }` en cada n; imprime `BASE=… DESDE=…` y `LOTE=S1+S2`; si alguna ya tenía foto, conserva la primera con el AVISO de hoy, y si las previas son de fotos distintas → ERROR. `contextoDelFlujo` (:1307) con lista: todas deben compartir el mismo `lote`; permitidos = unión de los del plan + ampliados; `FOTO S1+S2: …`. Con un número que pertenece a un lote de varios: mide el lote y avisa.
  - `cambiosPorSubtarea` (:1100): agrupa por `lote`; el `siguiente` de un lote es la foto del próximo n fuera de él (o el árbol de ahora); cada miembro reporta `numstat` limitado a las rutas que caen en sus propios permitidos (`numstat` acepta un filtro). Sin `lote` en la foto, igual que hoy.
  - Tests en guardia.test.mjs: `lotesDe`, parseo de `Depende de` (válido, `ninguna`, inválido, ausente), `--base --sub 1,2` y `--cambios --sub 1,2` (lote, miembro suelto, lista inválida, un solo número), `cambiosPorSubtarea` con lote, y el texto de `criticasDeExploracion`.
- [x] T2 (S1, S7, S8) · ejecutor (documentos y prompts; después de T1, en paralelo con T3) · ÁREA planificador, ÁREA ejecución · greps de «Opus»/«medium»/«Uno a la vez» sin frases desactualizadas; corregido tras el revisor (línea `LOTE:` y ROJO ajeno que no cuenta como ciclo)
  Qué: `qcc-implementador/agents/qcc-planificador.md` (`model: sonnet`, `effort: high`; ajusta su texto si dice Opus), `qcc-implementador/skills/impl/SKILL.md` (tabla de agentes: planificador «Sonnet, high», ninguno; la línea de las juntas del paso 5 y el `description` si menciona un solo ejecutor), `qcc-implementador/herramientas/pasos.md` (paso 0: fork mode solo hace perder Opus a la revisión final; paso 2: sin override y con la línea `LOTES:`; paso 5: por lotes como en S7; paso 6: «única subtarea» pasa a «único lote que cubre todas»), `qcc-implementador/herramientas/comun.md` (:40, :42 «Uno a la vez, salvo en la Exploración»; §5 despacho del ejecutor; §6 ciclos por subtarea dentro de un lote), `qcc-implementador/herramientas/plan.md` (campo `Depende de` en el formato de subtarea, :29 y :43; regla de cuándo marcar `ninguna`), `FLUJOS.md` (:14, :20 y la descripción del paso 5), `AGENTS.md` (sección «Flujo con /impl»), `qcc-implementador/.claude-plugin/plugin.json` (version 0.2.0).
- [x] T3 (S2, S8) · ejecutor (panel; después de T1, en paralelo con T2) · ÁREA panel · claude plugin test qcc-panel 337 pass (RED 4 fail → GREEN); validate OK
  Qué: `qcc-panel/hooks/flujo.ts:825` rótulo «planificador · Sonnet high»; `qcc-panel/tests/panel.test.tsx` líneas 3547, 3548, 3578, 3609, 3930, 3931; `qcc-panel/.claude-plugin/plugin.json` version 0.33.1.

## Mapa
ÁREA planificador (mejora 1):
  qcc-implementador/agents/qcc-planificador.md:5-6 (editar)
  qcc-implementador/skills/impl/SKILL.md:28-35 (editar)
  qcc-implementador/herramientas/pasos.md:3, :10 (editar)
  qcc-implementador/herramientas/estado.mjs:546-560, :590 (editar)
  FIJAN: qcc-implementador/herramientas/guardia.test.mjs:1250-1253
  FIJAN: qcc-panel/tests/panel.test.tsx:3547, 3548, 3578, 3609, 3930, 3931
  qcc-panel/hooks/flujo.ts:825 (editar)
  FLUJOS.md:14, :20 · AGENTS.md sección «Flujo con /impl» (editar)
  costos.mjs:345 toma el effort de la llamada y, si falta, pone high (sin cambio)
ÁREA ejecución (mejora 2):
  qcc-implementador/herramientas/estado.mjs:1292-1300 fotoDeSubtarea (editar)
  qcc-implementador/herramientas/estado.mjs:1307-1336 contextoDelFlujo (editar)
  qcc-implementador/herramientas/estado.mjs:984-1064 cambios (sin cambio: recibe la unión)
  qcc-implementador/herramientas/estado.mjs:1100-1114 cambiosPorSubtarea y :1082-1094 numstat (editar)
  qcc-implementador/herramientas/estado.mjs:359 CAMPOS_SUBTAREA, :498-515 avisos, :611 resumen de subtareas (editar)
  qcc-implementador/herramientas/estado.mjs:1442-1490 main y opcionesDe (--sub, :1402 permitidos) (editar)
  FIRMA: fotoDeSubtarea(n) → guarda {base, desde} en estado.bases[n] si no hay; nunca reemplaza · cambios(base, desde, permitidos, …) → diff base→árbol; atribuye por ruta · cambiosPorSubtarea(estado) → {n: archivos, mas, menos}
  USOS: cambios → estado.mjs:1485 · cambiosPorSubtarea → estado.mjs:1246 · enAlcance → estado.mjs:1010 · fotoDeSubtarea → :1474 · contextoDelFlujo → :1481
  TESTS: guardia.test.mjs:1023-1113 (fotos y --cambios --sub en serie), :410-418 y :1116-1156 (ALCANCE FUERA y reversión), :1455-1511 (costos con dos ejecutores en un turno)
  qcc-implementador/herramientas/comun.md:40, :42, :137-143 (§6) · pasos.md:20, :22 · plan.md:29, :43 (editar)
  costos.mjs:331 agrupa ejecutores por el prefijo `SUBTAREA n/` del prompt: no depende del orden (sin cambio)
  verificar.mjs y guardia.mjs no saben de subtareas (sin cambio); el panel no asume un ejecutor activo (sin cambio)

## Log
L1 2026-10-26 pedido (literal):
> Aplica la mejora a impl 1 y 2, tarea critica
L2 2026-10-26 contexto del pedido (conversación previa, literal del usuario): «podemos dejar que 2 Clasificación y plan siempre sea sonnet high o opus medium, y que si el plan lo permite multimples ejecutores somo lo hace odd, me lo recomiendas?????». Recomendé Sonnet high (ahorra ≈ $0,42 por corrida) y ejecutores en paralelo solo por tiempo; el usuario pidió aplicar ambas.
L4 2026-10-26 contrato ya implementado por T1 (estado.mjs, 72/72 tests): `--guardar … plan` imprime `LOTES: S1+S2 | S3` (`+` junta los del lote, ` | ` separa lotes; una subtarea sola es un lote de uno); `estado.mjs --base --sub 1,2 --paso 5` imprime `BASE=… DESDE=…` y `LOTE=S1+S2`; `estado.mjs --cambios --sub 1,2 [--permitidos "<ampliados>"] --paso 5|6` mide el lote con la unión de permitidos y da `FOTO S1+S2: …`; `--cambios --sub 2` de un miembro de un lote mide el lote entero y avisa; lista inválida o sin foto → ERROR (código 2). El campo del plan se escribe `- Depende de: ninguna` o `- Depende de: S1, S2`.
L3 2026-10-26 decisión técnica: lotes calculados por código (`lotesDe`) y no por el orquestador, para que sean probables; un plan sin `Depende de` queda todo en serie, igual que hoy.

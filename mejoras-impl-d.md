# Mejoras de /impl-d:n

Base: las 27 corridas de `/impl-d:n` 0.9.0 (`registros/impl-d.jsonl`, del 23 al 27 de noviembre; 21 con Code Mode) y los transcripts de sus 101 exploradores, 24 asesores y 45 revisiones. Las mejoras de los exploradores están aparte, en [mejoras-exploradores.md](mejoras-exploradores.md).

| Medida | Hoy |
|---|---|
| Aprobadas en la primera revisión | 10 de 27 (37 %) |
| La segunda revisión rechaza | 7 de 17 (41 %) |
| DETENIDO | 7 de 27 (26 %; 10 % en 0.7 y 0.8) |
| Continuaciones manuales de un DETENIDO («Resumen para seguir…») | 6 de 27 (#8, #17, #20, #24, #25, #26), 52 min en total |
| Problemas del revisor que la sesión no pudo reproducir (`DESCARTADOS`) | 0 en 17 ciclos |

## 1. Que la sesión conozca lo que rechaza el revisor

**Problema:** de los 40 problemas de las primeras revisiones, 18 son mecánicos: 8 de documentación vieja, 7 de historial en comentarios o tests («antes», «caía», «devolvía», fechas) y 3 de formato. 9 o 10 de los 17 rechazos traen alguno, y #2, #18 y #20 se rechazaron solo por eso. El revisor rechaza por «historial agregado», que está en su propia lista (`agents/qcc-revisor-directo.md`, «Rechaza solo por defectos concretos»). Ni la skill ni los AGENTS.md de mine y horaki se lo dicen a la sesión, que lo repitió incluso dentro de una corrección (#22). La documentación vieja aparece porque la sesión arregla las líneas que le nombran el asesor o el revisor y no busca las otras apariciones (#1, #4).

**Cambio** en `qcc-impl-directo/skills/n/SKILL.md`, §2 «Implementación», junto a «la documentación que el cambio deja vieja»:
- «Comentarios, tests y documentación describen lo vigente: sin "antes", "ahora", "ya no", fechas ni verbos sobre lo que hacía el código viejo ("caía", "devolvía").»
- «Antes de verificar, Grep en todo el repo de cada nombre, valor o frase que el cambio quitó o cambió (documentación, comentarios, tests), no solo de lo que nombró el asesor.»

Hay que reescribir también la viñeta «Implementación» de la sección impl-d de `FLUJOS.md`.

**En /impl-d:p** implementa el trabajador, así que los mismos dos puntos van en `agents/qcc-trabajador-directo.md`, paso 2. Ahí la documentación vieja de un archivo que no es suyo va a `FUERA`, y el Grep va con la herramienta Grep: su Bash no puede buscar.

**Se mide** con los problemas de historial y de documentación vieja en las primeras revisiones (hoy 15 en 17 rechazos).

## 2. Corregir con un test, no solo reproduciendo

**Problema:** en 6 de los 7 DETENIDO, el defecto que rechazó la segunda revisión lo había metido la propia corrección:
- #4 arregló `jugador.js` y quedaron `hud.js` y `arbol.js` con el mismo defecto;
- #15 decide el contorno comparando colores;
- #22, #24 y #26 (la araña): cada arreglo abrió otro caso borde (un salto de 4 px, NaN con `oy` undefined, la araña creada en el suelo);
- #23 `REBOTE_MS = 1000/60`;
- #18 una frase inexacta en el comentario corregido;
- #7 un caso borde nuevo en el arreglo de la arena.

Las correcciones tardaron 0,4–2,9 min y no convirtieron el repro en test. Además, el paso actual («reproduces cada PROBLEMA con su repro») dio 0 descartes en 17 ciclos: no tiene efecto.

**Cambio** en `skills/n/SKILL.md` §4, viñeta «RECHAZADO» (línea 106), reemplazando «Después reproduces cada PROBLEMA… Corriges solo los que se reproducen». Es la regla que `/impl` ya tiene para sus correcciones (`FLUJOS.md`, «Correcciones»: «un test que repita la reproducción (se ve fallar antes), otro camino público al mismo estado y corregir la causa»):
- «Un PROBLEMA de comportamiento: su repro pasa a ser un test, que ves fallar; corriges la causa; sumas el caso vecino (undefined, estado inicial, el borde del otro lado) y buscas con Grep el mismo patrón en el resto del DIFF y en sus llamadores.»
- «Un repro que no falla no se corrige: va a `DESCARTADOS` con lo que dio.»
- «Uno de documentación o comentario: corriges y buscas con Grep la misma frase en todo el repo.»

Va también en la viñeta «Revisión» de la sección impl-d de `FLUJOS.md`.

**En /impl-d:p** corrige el trabajador (le llega `ANTERIOR` por SendMessage): la regla va también en `agents/qcc-trabajador-directo.md`, paso 4.

**Se mide** con los rechazos de la segunda revisión por defectos de la corrección (hoy 6 de 7).

## 3. Hasta 3 ciclos de revisión; el tercero solo sobre las CORRECCIONES

**Problema:** el tope de 2 ciclos cerró DETENIDO 7 de 27 corridas, y tú hiciste el tercer ciclo a mano en 6: corrida nueva, exploración, asesor y el resumen que escribiste. 5 de esas 6 aprobaron. Dentro de la misma corrida, un ciclo más cuesta una revisión de 0,4 a 3,7 min (la segunda revisión ya mira solo `CORRECCIONES`).

**Cambio:**
- `skills/n/SKILL.md` §4, línea 106: «Hasta 2 ciclos: un segundo RECHAZADO cierra `DETENIDO`…» pasa a «Hasta 3 ciclos: un tercer RECHAZADO cierra `DETENIDO` con los problemas abiertos». El tercero se lanza como el segundo: `REVISIÓN ANTERIOR` con el último reporte y `CORRECCIONES` desde el último `--arbol`.
- `FLUJOS.md`, viñeta «Revisión» de impl-d: «Hasta 2 ciclos».
- `agents/qcc-revisor-directo.md`: sin cambios; «Con `REVISIÓN ANTERIOR`» ya cubre cualquier ciclo.
- `corrida.mjs`: sin cambios; ya anota 3 veredictos (#7: `sin veredicto,RECHAZADO,RECHAZADO`).
- `/impl-d:p` (`skills/p/SKILL.md:70` y `FLUJOS.md`, «Verificación e integración») queda en 2 por frente: tiene solo 4 corridas 0.9.0 para decidir.

**Se mide** con el % de DETENIDO (hoy 26 %) y las continuaciones manuales (hoy 6 de 27).

## 4. Revisor: lo que la sesión tiene prohibido no rechaza

**Problema:** en #3 la primera revisión rechazó porque faltaba `git rm -r --cached .impeccable skills-lock.json`, un git que escribe y que la sesión tiene prohibido. La segunda aprobó lo mismo, con el comando en «Queda para ti». El rechazo solo costó un ciclo.

**Cambio** en `agents/qcc-revisor-directo.md`, sección «Rechaza solo por defectos concretos», con la misma regla que ya tiene la revisión final de `/impl` (`FLUJOS.md`, «Revisión final»: «Un "hecho cuando" que depende de un comando de "Queda para ti" no lo rechaza»):
- «Lo que la sesión no puede hacer (git que escribe, `.env*`, un comando irreversible o externo sin aprobar) no rechaza: el CRITERIO dice `queda para el usuario: <comando>` y el comando va en OBSERVACIONES.»

## 5. «snapshot viejo» en los límites: por diagnosticar

**Síntoma:** en 4 de 27 corridas (#0 en la cuenta principal; #8, #11 y #25 en `.claude-cuenta1`), `corrida.mjs --inicio` dio `LÍMITES: s/d (snapshot viejo)`, y el cierre y la fila quedaron con `5h s/d · sem s/d`, aunque al final hubiera dato.

**Lo que se sabe:**
- `corrida.mjs:24` y `:60` toman como «sin dato» un `qcc-limites.json` de más de `LIMITES_MAX_SEG` (600 s).
- El panel lo escribe en `session.measure` (`qcc-panel/hooks/register.tsx:774`, `escribirLimites` en `:369-383`), es decir, después de una respuesta de la API en alguna sesión de esa cuenta. `LIMITES.md` ya lo explica: «el panel no corrió, o la sesión no tuvo respuesta todavía».
- El `!` de la skill corre al expandirla, antes de la primera respuesta a ese pedido. Si la cuenta no tuvo ninguna respuesta en los 10 min anteriores, el snapshot llega viejo.
- Eso no alcanza a explicarlo todo:
  - los 4 casos tenían la cuenta sin corridas entre 12 y 60 min, pero otras 13 corridas con más tiempo sin uso (hasta 3022 min) sí tuvieron dato;
  - tampoco depende de que la sesión sea nueva: #8 y #11 arrancaron a 0–1 min de abrir la sesión y salieron `s/d`, igual que #2, #4 y otras que sí tuvieron dato.

  Una hipótesis es que la medición del arranque de la sesión compite con la inyección de la skill cuando el pedido se escribe apenas se abre la sesión.

**Próximo paso:**
1. Anotar en la fila de `impl-d.jsonl` la edad del snapshot al empezar y al cerrar, como ya hace `/impl` (`LIMITES.md`, ejemplo con `"edad": 700`).
2. Con ~10 corridas, ver si los `s/d` coinciden con pedidos lanzados a segundos de abrir la sesión o con cuentas sin uso.
3. Recién entonces decidir el arreglo. `LIMITES.md` (casos borde, punto 4) dice a propósito que un snapshot viejo no se toma como válido, porque no se distingue de un panel que dejó de correr. Aceptarlo cuando su `resetsAt` de 5 h sigue en el futuro implica cambiar esa decisión, también para `/impl`.

## Orden y medición

1. Aplicar 1 y 2 juntos (los dos van en `skills/n/SKILL.md` y `FLUJOS.md`), después 3 y 4, y subir impl-d a 0.10.0.
2. El 5 empieza por el diagnóstico; no cambia el flujo.
3. Medir con las próximas ~10 corridas: aprobadas en la primera revisión (hoy 37 %), rechazos de la segunda por defectos de la corrección (hoy 6 de 7), DETENIDO (hoy 26 %) y continuaciones manuales (hoy 6 de 27).

Según AGENTS.md, estas medidas van en el mensaje del commit, no en la documentación.

## Relación con mejoras-exploradores.md

La mejora 1 pide a la sesión un Grep en todo el repo. Hoy `skills/n/SKILL.md` §1 dice «Lo que cubre esa ola no lo buscas tú con Grep/Glob ni con Bash». Si se aplica la recomendación 2 de [mejoras-exploradores.md](mejoras-exploradores.md) (quitar la segunda ola), esa frase se va. Si no, necesita la excepción «salvo el Grep de lo que el cambio quitó o cambió».

## Otras, no elegidas todavía

- **`MARGEN_5H` de 85 a ~78:** la #7 arrancó en 82 % sin aviso, gastó 22 % o más y se cortó por límite en plena revisión (144 min parada). Una corrida gasta 16 % de mediana y ~22 % en el percentil 75. Se toca `corrida.mjs:26`, `corrida.test.mjs:51` y `:54`, `FLUJOS.md:171` y `LIMITES.md:3`.
- **Un worktree por corrida en paralelo:** 8 de 21 corridas con Code Mode se solaparon con otra en el mismo repo (mine). El DIFF de la revisión mezcla los cambios de la otra corrida, y la sesión tuvo que listarlos a mano en NOTAS y en SUCIOS PREVIOS (#14, #22, #24, #26). No cambia código; el costo es unir las ramas después.

## Descartado (no volver a proponer sin datos nuevos)

- **Más revisores:** el actual no tuvo falsos positivos (0 descartes en 17 ciclos) y otro costaría como él (39 % del costo con Code Mode).
- **Bajar el revisor de xhigh:** es el que encontró los 13 bugs reales de las primeras revisiones.
- **Bajar el esfuerzo de la sesión:** las 2 corridas en medium (#1, #2) también fueron rechazadas en la primera revisión y usaron más pedidos.
- **Quitar el asesor:** cuesta 5–7 % y dijo CAMBIA en 20 de 24.
- **Ajustes por Code Mode:** funciona. La sesión bajó de 65 a 20 pedidos y de 13 M a 1,8 M de caché leído (medianas), llegan el `effort` del revisor y AskUserQuestion, y agrupa lecturas con `Promise.all`.
- **Lecturas enteras de la sesión:** las 175 que se contaban son casi todas de Code Mode, de `file(ruta).text()` guardado en una variable, que no entra al contexto si el script no lo devuelve. Sin Code Mode hubo 0–3 por corrida.

## Cómo se midió

- **Filas:** `~/.claude/flujos/registros/impl-d.jsonl`, con `version: "0.9.0"` y `modo: "normal"`. `sesion` es la ruta del transcript y la ventana es de `inicio` a `t`, con ±1 min.
- **Subagentes:** `<transcript sin .jsonl>/subagents/agent-*.jsonl` y su `.meta.json` (`agentType`, `model`, `effort`); se toman los que tienen su primer timestamp dentro de la ventana. El prompt es el primer mensaje `user` y el reporte, el último texto del asistente. Los pedidos son los `requestId` distintos.
- **Code Mode:** la sesión lo tiene si `api-request-shape` incluye la tool `REPL`. Las llamadas de dentro del REPL aparecen como `tool_use`, pero los Agent no dejan `tool_result` con tiempos en el transcript principal: los tiempos de cada agente salen de su propio jsonl.
- **Veredictos y problemas:** `VEREDICTO:` y el bloque entre `PROBLEMAS:` y `OBSERVACIONES:` de cada revisor; los descartes, de `DESCARTADOS:` en el prompt del ciclo siguiente. La clasificación de los 40 problemas (bug, documentación vieja, historial, formato, test, regla, pedido) se hizo a mano.
- **Tiempo de la sesión generando:** la suma de los huecos entre cada mensaje `user` y el siguiente mensaje del asistente que no es `<synthetic>`, a ~100 tok/s.
- **Costo ponderado (aproximado):** entrada × 1, escritos × 1,25, leídos × 0,1, salida × 5; Haiku × 0,2.
- **Herramienta:** un script `node` en el scratchpad que lee cada jsonl con `fs` y `JSON.parse` por línea. `file().lines()` del REPL tarda minutos con estos transcripts. La memoria `analizar-transcripts` explica cómo deduplicar entre las dos cuentas cuando no se parte de la fila.

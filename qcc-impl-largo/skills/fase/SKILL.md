---
name: fase
description: "Una fase de /impl-l. La lanza largo.mjs con claude -p, no se usa a mano: implementa la fase en curso de <git-dir>/qcc-impl/largo/fases.md contra sus criterios, verifica, se autochequea y cierra con una revisión independiente (Opus high) y un traspaso para las fases siguientes; con `final`, la revisión de integración."
argument-hint: "-p <F<n> | final>"
model: opus
effort: medium
allowed-tools:
  - Read
  - Glob
  - Grep
  - Edit
  - Write
  - Agent
  - TaskStop
  - Bash(git status*)
  - Bash(git diff*)
  - Bash(git log*)
  - Bash(node *${CLAUDE_PLUGIN_ROOT}/herramientas/largo.mjs*)
---

# /impl-l:fase

Implementas tú **una fase** de una tarea larga. Las demás fases corren en otras sesiones: no hagas lo de otra fase, y lo que las siguientes necesitan saber va en tu `Traspaso`. La exploración y la revisión van a subagentes: lo que lees tú se paga en cada pedido, y cada pedido relee todo tu contexto. Por eso pides en un mismo mensaje todas las lecturas, ediciones y comandos que no dependen entre sí. Todo lo que escribes va en español.

**Pedido:** $ARGUMENTS

**Sucios previos** (no son del cambio): !`git status --short`

**La fase:** !`node "${CLAUDE_PLUGIN_ROOT}/herramientas/largo.mjs" --fase || echo "ERROR: no corrió largo.mjs --fase"`

`DIFF` es el comando de la línea `DIFF:` de arriba: da lo que cambió desde que empezó la fase, archivos nuevos incluidos, y acepta `--stat` y `-- <rutas>`. `ARBOL` es `node "${CLAUDE_PLUGIN_ROOT}/herramientas/largo.mjs" --arbol`.

Nadie responde: nunca llamas a AskUserQuestion. Ante una duda, la opción que recomendarías, una línea en `Decisiones sin preguntar:`. Un comando irreversible o externo (migración sobre una base real, deploy, borrado, servicio vivo) no se corre: va a «Queda para ti».

Con `FASE: final` arriba, sigue «Integración», al final; no los pasos 1 a 5.

## 0. Preflight

- Con `ERROR` arriba, cierra `DETENIDO (sin fase: <el error>)`.
- Si tu herramienta Agent no tiene el parámetro `run_in_background`, fork mode está activo y la revisión perdería Opus: cierra `DETENIDO (fork mode: se apaga con "CLAUDE_CODE_FORK_SUBAGENT": "0" en env de settings.json)`.
- **Reintento:** con `REINTENTO: <ruta>`, la fase ya se intentó y no quedó COMPLETA; lo hecho sigue sin commit y está en el `DIFF`. Lee ese cierre: completas lo que falta y resuelves sus problemas abiertos, sin rehacer lo aprobado.
- **Verificación:** la lista `VERIFICAR` de arriba; si remite al CLAUDE.md o AGENTS.md, sus comandos de verificación. Sin ninguno, sigues solo con revisión.
- **Reglas del proyecto:** la línea `REGLAS`: tú lees las de la sesión, el explorador recibe la suya y el revisor la suya. Mandan junto con el CLAUDE.md y, con `MEMORIA`, con la memoria del proyecto, que lees tú y recibe el revisor.

## 1. Lo que lees

- El bloque de la fase, sus `Criterios` y los `TRASPASOS` ya dicen qué hay que hacer y qué dejaron las fases anteriores: no lo vuelvas a buscar. Con `CRITERIOS GLOBALES` arriba (la última fase cuando no hay integración), también son tuyos: van en el autochequeo y en los `CRITERIOS` del revisor.
- Cada criterio con `fuente: <ruta:línea>`: lees ese tramo de la fuente, no solo el resumen del criterio.
- Los archivos, con Read y `offset`/`limit` sobre el tramo que necesitas; entero, solo si tiene menos de ~200 líneas. Nunca los leas con `cat`, `type`, `head`, `tail` ni `sed -n` por Bash: entra entero en tu contexto y se paga en cada pedido.
- Una captura de pantalla pesa ~15k tokens en tu contexto: solo si un criterio es visual, y una por criterio.
- **Exploradores:** solo si lo que toca la fase (su `Área`, con sus tests) suma más de ~1.500 líneas del MAPA que no conoces por los traspasos. Agent `impl-l:qcc-explorador-largo`, sin overrides y con `run_in_background: false`, hasta 8, todos en un mismo mensaje, cada uno ~2.000 líneas del MAPA sin solapar. El prompt, nada más:

```
PEDIDO: <la fase: título y objetivo>
ÁREA: <carpetas o archivos>
FOCO: <los criterios que tocan esta área, ≤ 3 líneas>
REGLAS: <la ruta del explorador en REGLAS | ninguna>
```

  Con los informes, lees solo sus rangos `ruta:desde-hasta`, todos en un mismo mensaje.

## 2. Implementación

- Solo lo de esta fase. Lo que necesitas de una fase posterior va en `Traspaso` como pendiente, no lo adelantas.
- Editas tú, con Edit o Write: nunca con `sed -i`, `node -e`, `python` ni heredocs, y nada temporal dentro del repo. Bash queda para git de lectura, la verificación y lo que la fase pide correr.
- Un test por cada camino público nuevo o cambiado y por cada criterio con valores; la documentación que el cambio deja vieja, según las reglas del proyecto.
- Si el código existente que la fase reutiliza contradice un valor que un criterio o el pedido admite, corregirlo es parte de la fase.
- Marcas de avance (un `[x]` en un plan, un checklist) solo si la fase o el pedido las piden.
- Nunca git que escriba (commit, add, stash, checkout, reset, push), ni `.env*`.
- Lo que lanzas en segundo plano (un servidor, una búsqueda larga) lo paras con TaskStop en cuanto deja de servir, y siempre antes del cierre.

## 3. Verificación

- Los comandos de `VERIFICAR`, con `timeout: 600000`; los que llevan `solo si toca`, solo si el cambio toca alguna de esas rutas; los `paralelo`, juntos en un mismo mensaje.
- ROJO por el cambio → corriges. Si tras 2 correcciones sigue ROJO, cierras `DETENIDO` sin revisión. Un fallo ajeno al cambio no se corrige: va a la revisión como «ya fallaba», con su motivo.
- No declaras éxito sin un VERDE posterior al último cambio.
- Las pruebas fuera de `VERIFICAR` que pide un criterio (navegador, dispositivo, servicio): las corres si el proyecto, sus reglas o la memoria dicen cómo y la herramienta ya está instalada. Si no, no la buscas ni la instalas: va a `NO VERIFICADO` y a «Queda para ti».

## 4. Autochequeo

Antes de la revisión, una línea por cada criterio de la fase: `ok — <evidencia: test, ruta:línea o comando>`, `no — <qué falta>` o `no verificado — <por qué>`. Un criterio con valores admitidos (decimales, límites, fechas) es `ok` solo con un test que pasa 2 o 3 de esos valores por el camino completo, código reutilizado incluido. Cada `no` lo corriges ahora y verificas de nuevo: el revisor rechaza un criterio sin cumplir, y cada ciclo de revisión cuesta más que corregirlo antes.

## 5. Revisión

Agent `impl-l:qcc-revisor-largo`, sin overrides y con `run_in_background: false`. El prompt, nada más:

```
MODO: fase
PEDIDO: <la línea PEDIDO de arriba>
FASE: <F<n> · título>
CRITERIOS: <las viñetas de Criterios de la fase, literales, con su fuente; y los CRITERIOS GLOBALES si los hay arriba>
FUERA DE LA FASE: <su «Fuera de la fase» | lo que hacen las otras fases, en ≤ 2 líneas>
REGLAS: <la ruta del revisor en REGLAS | ninguna>
MEMORIA: <la ruta de MEMORIA | ninguna>
DIFF: <el comando DIFF>
SUCIOS PREVIOS: <los de arriba | ninguno>
VERIFICACIÓN: <una línea por comando: VERDE | ROJO (ya fallaba: motivo) | SIN PASOS>
NO VERIFICADO: <lo que un criterio pide probar y no se corrió, con su motivo | nada>
AUTOCHEQUEO: <tus líneas del paso 4>
NOTAS: <lo que decidiste y lo que no hiciste, ≤ 5 líneas | ninguna>
```

- RECHAZADO → antes de tocar nada, `ARBOL` (el estado que revisó). Corriges solo sus PROBLEMAS, verificas de nuevo y lanzas otro revisor con el mismo prompt más `REVISIÓN ANTERIOR: <su reporte>` y `CORRECCIONES: <el comando DIFF con ese árbol en vez de la BASE>`. Hasta 2 ciclos: un segundo RECHAZADO cierra `DETENIDO` con los problemas abiertos (la fase se reintenta una vez en otra sesión, con tu cierre).
- Tras un APROBADO no cambias comportamiento. Una OBSERVACIÓN de documentación vieja o de un nombre que se arregla en una línea la corriges y verificas de nuevo, sin otro ciclo; va en `Cambios`. Las demás van a «Riesgos pendientes». Un revisor sin `VEREDICTO` se relanza una vez.

## Integración (`FASE: final`)

Las fases ya se revisaron una por una; aquí se juntan.

- No implementas nada nuevo. Corres todo `VERIFICAR`, también lo que lleva `solo si toca`: es la verificación final.
- Revisor `impl-l:qcc-revisor-largo` con el prompt del paso 5, salvo: `MODO: integración`; `FASE: final`; `CRITERIOS:` los `CRITERIOS GLOBALES` de arriba más «las uniones entre fases: lo que una define y otra usa»; `FUERA DE LA FASE: nada`; `DIFF:` el de arriba (desde la BASE de toda la corrida); en vez de `AUTOCHEQUEO`, `FASES:` y `TRASPASOS:` tal cual arriba.
- RECHAZADO → como en el paso 5: `ARBOL`, corriges solo sus PROBLEMAS (aunque toquen archivos de varias fases), verificas y otro revisor con `REVISIÓN ANTERIOR` y `CORRECCIONES`. Hasta 2 ciclos.
- En el cierre, `Traspaso: ninguno`.

## 6. Cierre

Con lo de segundo plano ya parado, el bloque, una sola vez y sin texto antes ni después. `COMPLETO (sin verificar: …)` cuando la revisión aprobó pero algo que un criterio pide quedó sin probar.

```
Resultado: COMPLETO | COMPLETO (sin verificar: <qué>) | DETENIDO (<motivo>)
Cambios: <ruta — qué, ≤ 15 palabras>, una línea por archivo
Verificación: <resultado por comando>
Revisión: APROBADO en ciclo <n> | RECHAZADO (<problemas abiertos>) | sin revisión
Criterios: <n ok · n no verificado · n no>
Traspaso:
- <lo que las fases siguientes necesitan: módulos, funciones, formatos y mensajes nuevos con su ruta, decisiones tomadas y lo que quedó pendiente; ≤ 15 líneas>
Riesgos pendientes: <OBSERVACIONES y lo no explorado, una por línea | ninguno>
Decisiones sin preguntar: <una por línea | ninguna>
Queda para ti: <`! <comando>  # requiere …` o la prueba sin verificar, una por línea | nada>
```

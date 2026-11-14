---
name: impl-d
description: "Flujo /impl-d: sin plan ni aprobación; explora con Haiku (hasta 24 en paralelo), la sesión implementa (Opus medium), verifica y cierra con una revisión independiente (Opus high), el % de los límites que gastó y una fila en registros/impl-d.jsonl. Solo cuando el usuario escribe /impl-d; nunca por iniciativa propia."
argument-hint: "[-p] <qué cambiar>"
model: opus
effort: medium
allowed-tools:
  - Read
  - Glob
  - Grep
  - Edit
  - Write
  - Agent
  - AskUserQuestion
  - TaskStop
  - Bash(git status*)
  - Bash(git diff*)
  - Bash(git log*)
  - Bash(node *${CLAUDE_PLUGIN_ROOT}/herramientas/corrida.mjs*)
---

# /impl-d

Implementas tú el pedido, sin planificador, plan ni aprobación. La exploración y la revisión van a subagentes: lo que lees tú se paga en cada pedido, y cada pedido relee todo tu contexto. Por eso pides en un mismo mensaje todas las lecturas, ediciones y comandos que no dependen entre sí. Todo lo que escribes va en español.

**Pedido:** $ARGUMENTS

**Sucios previos** (no son del cambio): !`git status --short`

**Al empezar:** !`node "${CLAUDE_PLUGIN_ROOT}/herramientas/corrida.mjs" --inicio || echo "s/d (no corrió corrida.mjs)"`

`DIFF` es `node "${CLAUDE_PLUGIN_ROOT}/herramientas/corrida.mjs" --diff`: con un árbol (la `BASE` de arriba o el que imprime `--arbol`) da lo que cambió desde entonces, archivos nuevos incluidos; acepta `--stat` y `-- <rutas>`.

## Modo sin preguntas (`-p`)

Si el pedido empieza con la palabra `-p`, la quitas (el pedido es lo que sigue) y nunca llamas a AskUserQuestion: nadie va a responder, también bajo `claude -p`. Sin comandos de verificación, sigues solo con revisión; un comando irreversible o externo no se corre y va a «Queda para ti»; cualquier otra duda, la opción que recomendarías. Cada decisión va, una línea, en `Decisiones sin preguntar:` del cierre.

## 0. Preflight

- Pedido vacío → responde `Uso: /impl-d [-p] <qué cambiar>` y termina. Si no pide cambios (revisar, analizar, auditar), dilo y termina.
- Si tu herramienta Agent no tiene el parámetro `run_in_background`, fork mode está activo y la revisión perdería Opus: dilo (se apaga con `"CLAUDE_CODE_FORK_SUBAGENT": "0"` en `env` de `~/.claude/settings.json`, reiniciando Claude Code) y termina.
- **Límites:** con `MARGEN BAJO` en `LÍMITES`, con `-p` vas directo al cierre con `DETENIDO (límite: 5h <n> %)`; sin `-p`, AskUserQuestion si seguir.
- **Verificación:** la lista `VERIFICAR` de arriba; si remite al CLAUDE.md o AGENTS.md, sus comandos de verificación. Sin ninguno, AskUserQuestion qué comandos verifican el proyecto, o seguir solo con revisión.
- **Reglas del proyecto:** la línea `REGLAS`: tú lees las de la sesión, el explorador recibe la suya y el revisor la suya. Mandan junto con el CLAUDE.md y, con `MEMORIA`, con la memoria del proyecto, que lees tú y recibe el revisor.

## 1. Exploración

Sin exploración solo si el MAPA suma menos de ~2.000 líneas: lees tú. Si no, o si salió `s/d`, siempre, aunque el pedido nombre archivos o un plan.

- **Reparto:** las líneas del MAPA que toca el pedido, con sus tests y documentos. Cada explorador cubre ~2.000 líneas, nunca más de 2.200, con su `ÁREA` por carpeta y sin solapar; una línea del MAPA que pasa de eso se parte por grupos de archivos (los grandes los nombra el MAPA). Un área que cabe en uno no se reparte. Hasta 24, todos en un mismo mensaje; uno que el harness no deja arrancar (tiene tope de subagentes simultáneos) lo relanzas en cuanto termina otro.
- **No caben en 24:** con `-p`, los archivos que el pedido nombra y los que importan o los importan; sin `-p`, AskUserQuestion qué acotar. Lo que queda afuera va a «Riesgos pendientes» como no explorado.
- Agent `impl-d:qcc-explorador-directo`, sin overrides y con `run_in_background: false`. El prompt, nada más; el `PEDIDO` va literal, y lo que esa área tiene que buscar va en `FOCO`:

```
PEDIDO: <literal>
ÁREA: <carpetas o archivos>
FOCO: <qué del pedido toca esta área, ≤ 2 líneas | ninguno>
REGLAS: <la ruta del explorador en REGLAS | ninguna>
```

- **Con los informes:** lees solo los rangos `ruta:desde-hasta` de ARCHIVOS y TESTS, con Read `offset`/`limit`, todos en un mismo mensaje; un archivo entero, solo si tiene menos de ~150 líneas. Lo que trajeron no lo vuelves a buscar. Un `no explorado` sobre algo que vas a editar va a otro explorador, en un mismo mensaje y dentro de los 24.

## 2. Implementación

- Editas tú, con Edit o Write: nunca con `sed -i`, `node -e`, `python` ni heredocs, y nada temporal dentro del repo. Bash queda para git de lectura, la verificación y lo que el pedido pide correr.
- Un test por cada camino público nuevo o cambiado; la documentación que el cambio deja vieja, según las reglas del proyecto.
- Marcas de avance (un `[x]` en un plan, un checklist) solo si el pedido o su plan lo piden.
- Nunca git que escriba (commit, add, stash, checkout, reset, push), ni `.env*`. AskUserQuestion antes de un comando irreversible o externo (migración, deploy, borrado, servicio vivo); si no se aprueba, va a «Queda para ti».
- Lo que lanzas en segundo plano (un servidor, una búsqueda larga) lo paras con TaskStop en cuanto deja de servir, y siempre antes del cierre.

## 3. Verificación

- Los comandos de `VERIFICAR`, con `timeout: 600000`; los que llevan `solo si toca`, solo si el cambio toca alguna de esas rutas; los `paralelo`, juntos en un mismo mensaje.
- ROJO por el cambio → corriges. Si tras 2 correcciones sigue ROJO, cierras `DETENIDO` sin revisión. Un fallo ajeno al cambio no se corrige: va a la revisión como «ya fallaba», con su motivo.
- No declaras éxito sin un VERDE posterior al último cambio.
- **Pruebas fuera de `VERIFICAR`** que pide el pedido (navegador, dispositivo, servicio): las corres si el proyecto, sus reglas o la memoria dicen cómo y la herramienta ya está instalada. Si no, no la buscas ni la instalas: va a `NO VERIFICADO` del revisor y a «Queda para ti».

## 4. Revisión

Agent `impl-d:qcc-revisor-directo`, sin overrides y con `run_in_background: false`. El prompt, nada más:

```
PEDIDO: <literal>
REGLAS: <la ruta del revisor en REGLAS | ninguna>
MEMORIA: <la ruta de MEMORIA | ninguna>
DIFF: <el comando DIFF con la BASE | git diff HEAD, si BASE es s/d>
SUCIOS PREVIOS: <los de arriba | ninguno>
VERIFICACIÓN: <una línea por comando: VERDE | ROJO (ya fallaba: motivo) | SIN PASOS>
NO VERIFICADO: <lo que el pedido pide probar y no se corrió, con su motivo | nada>
NOTAS: <lo que decidiste y lo que no hiciste, ≤ 5 líneas | ninguna>
```

- RECHAZADO → antes de tocar nada, `node "${CLAUDE_PLUGIN_ROOT}/herramientas/corrida.mjs" --arbol` (el estado que revisó). Corriges solo sus PROBLEMAS, verificas de nuevo y lanzas otro revisor con el mismo prompt más `REVISIÓN ANTERIOR: <su reporte>` y `CORRECCIONES: <el comando DIFF con ese árbol>`. Hasta 2 ciclos: un segundo RECHAZADO cierra `DETENIDO` con los problemas abiertos.
- Tras un APROBADO no cambias comportamiento. Una OBSERVACIÓN de documentación vieja o de un nombre que se arregla en una línea la corriges y verificas de nuevo, sin otro ciclo; va en `Cambios`. Las demás van a «Riesgos pendientes». Un revisor sin `VEREDICTO` se relanza una vez.

## 5. Cierre

Con lo de segundo plano ya parado: `node "${CLAUDE_PLUGIN_ROOT}/herramientas/corrida.mjs" --fin --resultado "<COMPLETO | COMPLETO (sin verificar) | DETENIDO>"`. Anota la corrida en `registros/impl-d.jsonl`; su línea `LÍMITES:` va en `Límites:` tal cual (`s/d` si no hubo dato: no lo estimas). Si imprime `REGISTRO: no (…)`, va a «Riesgos pendientes».

Luego el bloque, una sola vez y sin texto antes ni después. `COMPLETO (sin verificar: …)` cuando la revisión aprobó pero algo que el pedido pide quedó sin probar.

```
Resultado: COMPLETO | COMPLETO (sin verificar: <qué>) | DETENIDO (<motivo>)
Cambios: <ruta — qué, ≤ 15 palabras>, una línea por archivo
Verificación: <resultado por comando>
Revisión: APROBADO en ciclo <n> | RECHAZADO (<problemas abiertos>) | sin revisión
Riesgos pendientes: <OBSERVACIONES y lo no explorado, una por línea | ninguno>
Decisiones sin preguntar: <una por línea; solo con -p>
Queda para ti: <`! <comando>  # requiere …` o la prueba sin verificar, una por línea | nada>
Límites: <lo que imprimió --fin tras «LÍMITES: »: 5h +<n> % · sem +<n> %>
```

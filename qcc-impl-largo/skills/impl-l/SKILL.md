---
name: impl-l
description: "Flujo /impl-l para tareas largas: explora con Haiku, parte el pedido o el documento en fases con criterios verificables, pide aprobación y deja la corrida a largo.mjs, que corre cada fase en su propia sesión (Opus medium, revisión Opus high), espera los límites de uso, reintenta una vez la fase detenida y, con 3 fases o más, cierra con una revisión de integración. Solo cuando el usuario escribe /impl-l; nunca por iniciativa propia."
argument-hint: "[-p] <qué cambiar | ruta de un plan>"
model: opus
effort: medium
allowed-tools:
  - Read
  - Glob
  - Grep
  - Write
  - Edit
  - Agent
  - AskUserQuestion
  - Bash(git status*)
  - Bash(git diff*)
  - Bash(git log*)
  - Bash(node *${CLAUDE_PLUGIN_ROOT}/herramientas/largo.mjs*)
---

# /impl-l

Planificas una tarea larga; no implementas nada. Cada fase la hace después otra sesión, sin tu contexto: recibe solo su bloque de `fases.md`, la línea `PEDIDO` y los traspasos de las fases anteriores. Lo que no quede escrito en la fase no existe para quien la implementa. Todo lo que escribes va en español.

**Pedido:** $ARGUMENTS

**Sucios previos:** !`git status --short`

**Al empezar:** !`node "${CLAUDE_PLUGIN_ROOT}/herramientas/largo.mjs" --plan || echo "ERROR: no corrió largo.mjs --plan"`

`LARGO` es `node "${CLAUDE_PLUGIN_ROOT}/herramientas/largo.mjs"`.

## Modo sin preguntas (`-p`)

Si el pedido empieza con la palabra `-p`, la quitas (el pedido es lo que sigue) y nunca llamas a AskUserQuestion: nadie va a responder, también bajo `claude -p` y `largo.mjs --todo`. Apruebas tú el plan y no lanzas la corrida (la lanza `--todo`, o el usuario). Cada duda toma la opción que recomendarías, una línea en `Decisiones sin preguntar:` del cierre.

## 0. Preflight

- Pedido vacío y sin `AVISO` → responde `Uso: /impl-l [-p] <qué cambiar | ruta de un plan>` y termina. Si no pide cambios (revisar, analizar, auditar), dilo y termina.
- `ERROR` arriba → dilo y termina.
- Si tu herramienta Agent no tiene el parámetro `run_in_background`, fork mode está activo y los exploradores perderían Haiku: dilo (se apaga con `"CLAUDE_CODE_FORK_SUBAGENT": "0"` en `env` de `~/.claude/settings.json`, reiniciando Claude Code) y termina.
- **Corrida sin terminar** (`AVISO` arriba): con el pedido `reanudar` o vacío, la reanudas (paso 4, sin planificar). Si no, sin `-p`, AskUserQuestion header «Corrida», con «Reanudarla», «Empezar de cero» (`LARGO --plan --forzar`: la archiva en `historial/`) y «Cancelar»; con `-p`, «Empezar de cero».
- Los sucios previos quedan en la BASE: para las fases son parte del estado inicial.

## 1. Exploración

- **Documentos:** si el pedido nombra documentos (un plan, un diseño), los lees tú enteros, por tramos de hasta ~300 líneas: son la fuente de los criterios, y cada criterio cita su `ruta:línea`. También los que esos documentos nombran como reglas («ver docs/x.md»).
- **Código:** con un MAPA de menos de ~2.000 líneas lees tú lo que toca el pedido. Si no, exploradores `impl-l:qcc-explorador-largo`, sin overrides y con `run_in_background: false`: las carpetas del MAPA que toca el pedido, ~2.000 líneas cada uno, sin solapar, hasta 12, todos en un mismo mensaje. El prompt, nada más:

```
PEDIDO: <literal>
ÁREA: <carpetas o archivos>
FOCO: <qué del pedido toca esta área, ≤ 2 líneas>
REGLAS: <la ruta del explorador en REGLAS | ninguna>
```

- Con los informes, lees solo los rangos que necesitas para partir en fases (Read con `offset`/`limit`). Lo que trajeron no lo vuelves a buscar: va a las fases como `Área` y en `Objetivo`.
- Las convenciones del CLAUDE.md o AGENTS.md y las reglas de la sesión (`REGLAS`) que rigen todo el cambio van a los criterios globales.

## 2. Fases

Cada fase la hace una sesión Opus medium con su propia revisión Opus high. Cada sesión tiene un costo fijo de ~5 % de la ventana de 5 h (arrancar, releer lo que toca y revisar), así que **menos fases es más barato**. Las reglas:

- **Tamaño:** una fase entrega algo que se verifica solo, con los tests en verde al terminarla, y llega hasta ~1.500 líneas cambiadas o ~15 archivos (lo que una sesión hace en ~20 min). Un pedido que cabe ahí es **una sola fase**, aunque tenga varias partes o capas: partir por capas (dominio, comandos, formato, documentación) suma una sesión y no ahorra nada. Partes solo lo que pasa de ese tamaño, en el menor número de fases, y cada fase lleva su parte de punta a punta: dominio, comandos, tests y documentación.
- **Integración:** con 3 fases o más, una sesión final revisa las uniones y los criterios globales; con 1 o 2, los revisa la última fase.
- **Orden:** lo que otras fases usan (modelo de datos, formato guardado y su migración, validaciones compartidas) va en la primera, junto con la primera funcionalidad que lo usa; después cada funcionalidad, al final lo transversal. Los tests y la documentación de algo van en la fase que lo cambia; el README o la guía general, en la fase que agrega lo que documentan.
- **Depende de:** las fases cuyo resultado usa. Una fase que falla salta solo a las que dependen de ella: no las encadenes de más.
- Si el pedido es un documento con partes propias, las agrupas en fases de ese tamaño: varias partes chicas van juntas, en su orden.
- **Criterios:** cada regla, valor, formato, límite, mensaje, comando y test que fija el pedido o el documento va en exactamente una fase, como viñeta verificable con su fuente (`fuente: plan/x.md:12` o `fuente: pedido`). Copia los valores y los textos de salida literales; no los resumas. Cuando una fase reutiliza una validación o un cálculo existente, lees esa función y la contrastas con los valores que el pedido admite (decimales en coma flotante, límites, fechas): si rechaza uno, corregirla es criterio de esa fase.
- **Criterios globales:** las convenciones del proyecto que rigen todo el cambio y lo que una fase define y otras usan.
- **Objetivo:** lo que la sesión de la fase necesita y no está en los criterios: dónde va cada cosa (con las rutas de la exploración), qué reutiliza y cómo se prueba.

Escribes el plan con Write en la ruta de la línea `FASES:` de arriba, con este formato:

```
# <título corto>

PEDIDO: <el pedido literal, en una línea>

Criterios globales:
- <criterio> (fuente: …)

## F1 · <título>
Depende de: ninguna
Área: <rutas que toca, con sus tests>
Objetivo: <2 a 6 líneas>
Criterios:
- <criterio verificable> (fuente: …)
Fuera de la fase: <lo que parece de esta fase y va en otra | nada>

## F2 · <título>
Depende de: F1
…
```

Después, `LARGO --validar`: corriges los `ERRORES` hasta que pase.

## 3. Aprobación

- Con `-p`: `LARGO --aprobar` y vas al cierre.
- Sin `-p`: en tu texto, el resumen que imprimió `--validar` (una línea por fase) y la ruta de `fases.md`. AskUserQuestion «¿Apruebas el plan?», header «Plan largo», con «Aprobar y lanzar» (Recomendada; su `preview`, las líneas `F<n> · …` del resumen), «Aprobar sin lanzar» y «Cancelar»; los ajustes llegan por «Other»: editas `fases.md`, `--validar` y vuelves a preguntar. Aprobar → `LARGO --aprobar`. Cancelar → terminas sin aprobar.

## 4. Lanzar

- «Aprobar y lanzar» o «Reanudarla»: `LARGO --correr` con Bash `run_in_background: true`, desde la raíz del repo. Sigue mientras esta sesión esté abierta; para que sobreviva al cierre, el usuario lo corre en una terminal aparte.
- «Aprobar sin lanzar» y `-p`: no lo lanzas.

Cierre, una sola vez y sin texto antes ni después:

```
Plan: <título> · <n> fases · <ruta de fases.md>
<las líneas F<n> · … de --validar>
Lanzar: <`node "<ruta de largo.mjs>" --correr` desde <raíz del repo>, en una terminal | lanzado en segundo plano>
Estado: `node "<ruta de largo.mjs>" --estado`
Decisiones sin preguntar: <una por línea; solo con -p>
```

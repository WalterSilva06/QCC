---
name: p
description: "Flujo /impl-d:p, el modo paralelo de /impl-d para tareas largas: sin plan ni aprobación; explora con Haiku, la sesión escribe lo compartido y reparte el resto en frentes sin archivos en común que implementan trabajadores Opus medium en paralelo, integra, verifica y cierra con una revisión Opus high (una por frente si el cambio es grande). Solo cuando el usuario escribe /impl-d:p; nunca por iniciativa propia."
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

# /impl-d:p

Modo paralelo de /impl-d, para tareas largas: tú repartes e integras, y los trabajadores implementan en paralelo. Cada trabajador arranca sin tu contexto: lo que no va en su prompt no existe para él. Lo que no editas tú no lo lees: así tu contexto queda chico y cada pedido tuyo sale barato. Lee entero `${CLAUDE_PLUGIN_ROOT}/skills/n/SKILL.md` y síguelo desde «# /impl-d:n», con estos cambios:

- El `Pedido`, los `Sucios previos` y lo de `Al empezar` son los de abajo: ya corrieron, no los corras de nuevo.
- En ese archivo la variable de la carpeta del plugin sale sin expandir: la carpeta es `${CLAUDE_PLUGIN_ROOT}`, y `corrida.mjs` se corre como `node "${CLAUDE_PLUGIN_ROOT}/herramientas/corrida.mjs"`.
- El uso es `Uso: /impl-d:p [-p] <qué cambiar>`.
- **Exploración, con los informes:** lees solo los rangos que necesitas para repartir y los de lo que vas a escribir tú; los de cada frente van a su trabajador en `LEER`.
- **Implementación:** la de abajo. «2. Implementación» de /impl-d:n rige para lo que editas tú (lo compartido, la integración y las correcciones), menos su asesor, que es el de abajo. Lo que prohíbe (git que escriba, `.env*`, comandos irreversibles o externos sin aprobar, segundo plano sin parar) rige también para los trabajadores.
- **Revisión:** con el agregado de abajo.

## 2. Implementación en paralelo

Si el cambio entero es chico (menos de ~300 líneas cambiadas o hasta 3 archivos), no hay frentes: sigues «2. Implementación» de /impl-d:n tal cual.

**Reparto:**
- **Lo compartido es tuyo:** lo que usan dos frentes o más (tipos, interfaces, esquema y su migración, constantes, las firmas que un frente llama y otro escribe) y los archivos que tocarían dos frentes (un índice, un registro de comandos o rutas, `package.json`, el README general). Lo que los frentes usan lo escribes antes de lanzarlos; lo demás, en la integración.
- **Frentes:** el resto, sin ningún archivo en común, cada uno con su parte del pedido de punta a punta (código, sus tests y su documentación), de ~300 a ~1.500 líneas cambiadas, hasta 8. Menos frentes es más barato: cada trabajador relee su parte. No partas por capas (dominio, comandos, tests) lo que se edita junto.
- **Olas:** un frente que necesita lo que escribe otro, y que no cabe en lo compartido, va en una ola posterior. Lo normal es una sola ola.

**Asesor:** el de /impl-d:n, antes de escribir lo compartido, con `ENFOQUE` de hasta 25 líneas: lo compartido (qué archivo y qué define) y una línea por frente (sus archivos y su parte del pedido, con sus valores). `CAMBIA` se resuelve igual que en /impl-d:n.

**Lo compartido** lo escribes completo, no como borrador: los trabajadores lo usan tal cual y no lo cambian.

**Trabajadores:** por ola, todos en un mismo mensaje: Agent `impl-d:qcc-trabajador-directo`, sin overrides y con `run_in_background: false`; uno que el harness no deja arrancar lo relanzas en cuanto termina otro. El prompt, nada más; el `PEDIDO` va literal y la `TAREA` copia los valores, textos y formatos del pedido sin resumirlos:

```
PEDIDO: <literal>
FRENTE: <n> · <título>
ARCHIVOS: <los que edita o crea, y solo esos>
TAREA: <su parte del pedido: qué cambia en cada archivo, con sus valores; los tests y la documentación que le tocan>
COMPARTIDO: <ruta — qué define, uno por línea | nada>
LEER: <los rangos ruta:desde-hasta de la exploración para este frente>
OTROS FRENTES: <n · sus archivos, uno por línea>
TESTS: <el comando que corre solo los tests de este frente | ninguno>
REGLAS: <las rutas de la sesión en REGLAS | ninguna>
MEMORIA: <la ruta de MEMORIA | ninguna>
```

**Con los reportes:**
- `PARCIAL` o `BLOQUEADO`: lo que falta lo haces tú si es chico; si no, relanzas ese trabajador una vez con el mismo prompt más `ANTERIOR: <su reporte>`. Uno sin `ESTADO` se relanza una vez.
- Lo de `FUERA` (lo que necesita de un archivo que no es suyo) lo aplicas tú en la integración.
- Lo que editaron los trabajadores lo lees solo para integrar o corregir.

**Integración:** con todas las olas terminadas, escribes lo compartido que quedaba y lo de `FUERA`, y comparas `DIFF --stat` con los archivos de cada frente y los tuyos: uno que no es de nadie va a `NOTAS` del revisor. Después, «3. Verificación»: un ROJO en un frente lo corriges tú si es chico; si no, relanzas su trabajador con el fallo en `ANTERIOR`. Cuenta para las 2 correcciones.

## Agregado a «4. Revisión»

- Hasta ~1.500 líneas cambiadas (el total de `DIFF --stat`), un revisor, como en /impl-d:n, con `ALCANCE: todo`.
- Con más, un revisor por frente y uno de uniones, todos en un mismo mensaje, con el prompt de /impl-d:n más `ALCANCE:`. Por frente: `frente <n> · <sus archivos> — <su parte del pedido>`. Uniones: `uniones · <los archivos de lo compartido> — lo compartido, cómo lo usan los frentes y las partes del pedido que cruzan frentes`.
- RECHAZADO de cualquiera: el ciclo de /impl-d:n, con los PROBLEMAS de todos reproducidos en un mismo mensaje. Los de un frente los corriges tú si son chicos; si no, relanzas su trabajador con los PROBLEMAS en `ANTERIOR`. Relanzas solo los revisores que rechazaron.

**Pedido:** $ARGUMENTS

**Sucios previos** (no son del cambio): !`git status --short`

**Al empezar:** !`node "${CLAUDE_PLUGIN_ROOT}/herramientas/corrida.mjs" --inicio || echo "s/d (no corrió corrida.mjs)"`

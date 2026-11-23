---
name: p
description: "Flujo /impl-d:p, /impl-d:n con la implementación derivada: sin plan ni aprobación; explora con Haiku, un asesor Opus revisa el enfoque, la sesión no edita: deriva la implementación a trabajadores Opus con el esfuerzo de /effort (uno, o varios a la vez si hay partes sin archivos en común) y les devuelve cada corrección, verifica y cierra con la revisión de /impl-d:n. Solo cuando el usuario escribe /impl-d:p; nunca por iniciativa propia."
argument-hint: "[-p] <qué cambiar>"
model: opus
allowed-tools:
  - Read
  - Glob
  - Grep
  - Agent
  - SendMessage
  - AskUserQuestion
  - TaskStop
  - Bash(git status*)
  - Bash(git diff*)
  - Bash(git log*)
  - Bash(node *${CLAUDE_PLUGIN_ROOT}/herramientas/corrida.mjs*)
---

# /impl-d:p

Es /impl-d:n con una diferencia: tú no editas. Orquestas: exploras, escribes los encargos, los derivas a trabajadores, verificas y revisas; todo cambio en el repo, aunque sea de una línea, lo hace un trabajador. Cada trabajador arranca sin tu contexto: lo que no va en su prompt no existe para él. Lo que no editas no lo lees: así tu contexto queda chico y cada pedido tuyo sale barato. Lee entero `${CLAUDE_PLUGIN_ROOT}/skills/n/SKILL.md` y síguelo desde «# /impl-d:n», con estos cambios:

- El `Pedido`, los `Sucios previos` y lo de `Al empezar` son los de abajo: ya corrieron, no los corras de nuevo.
- En ese archivo las variables salen sin expandir: la carpeta del plugin es `${CLAUDE_PLUGIN_ROOT}`, `corrida.mjs` se corre como `node "${CLAUDE_PLUGIN_ROOT}/herramientas/corrida.mjs"` y el esfuerzo de la sesión es `${CLAUDE_EFFORT}`.
- El uso es `Uso: /impl-d:p [-p] <qué cambiar>`.
- **Preflight:** el trabajador lleva en `effort` el esfuerzo de la sesión: sin el parámetro `effort` en Agent, dilo y termina.
- **Exploración, con los informes:** lees solo los rangos que necesitas para escribir los encargos; los de los archivos que edita un trabajador van en su `LEER` y no los lees tú. La segunda ola cubre también lo que editan los trabajadores.
- **Implementación:** la de abajo, en vez de «2. Implementación» de /impl-d:n. Lo que esa prohíbe (git que escriba, `.env*`, segundo plano sin parar) rige igual. Un comando irreversible o externo que el pedido necesita no lo corre el trabajador: te llega en su `FUERA`, y lo preguntas y lo corres tú, como en /impl-d:n.
- **Verificación:** la corres tú, con todos los trabajadores terminados. Un ROJO por el cambio lo corrige el trabajador de esos archivos (ver «Correcciones»); cuenta para las 2 correcciones.
- **Revisión:** la de /impl-d:n. Los PROBLEMAS que se reproducen y, tras un APROBADO, la OBSERVACIÓN que se arregla en una línea los corrige su trabajador (ver «Correcciones»).

## 2. Implementación

**Frentes:** lo normal es uno, un trabajador con el pedido entero. Partes el pedido en más frentes solo si una parte se puede hacer a la vez que otra: sin ningún archivo en común con otro frente y sin usar lo que otro escribe. Una parte que necesita lo que escribe otro frente va en ese frente o en uno que lanzas cuando ese termina. No partas por capas (dominio, comandos, tests) lo que se edita junto: cada trabajador relee su parte, y menos frentes es más barato.

**Asesor:** el de /impl-d:n, antes del primer trabajador, con `ENFOQUE` de hasta 15 líneas: por frente, sus archivos y su parte del pedido, con sus valores, tests y documentación. `LEÍDO` lleva también el `LEER` de cada frente. `CAMBIA` se resuelve igual que en /impl-d:n.

**Trabajadores:** los frentes que no esperan a otro, todos en un mismo mensaje: Agent `impl-d:qcc-trabajador-directo`, con `run_in_background: false` y en `effort` el esfuerzo de la sesión (si no hay, sin override); uno que el harness no deja arrancar lo relanzas en cuanto termina otro. Uno que espera a otro lo lanzas cuando ese reporta `HECHO`. El prompt, nada más; el `PEDIDO` va literal y la `TAREA` copia los valores, textos y formatos del pedido sin resumirlos:

```
PEDIDO: <literal>
FRENTE: <n> · <título>
ARCHIVOS: <los que edita o crea, y solo esos>
TAREA: <su parte del pedido: qué cambia en cada archivo, con sus valores; los tests y la documentación que le tocan>
LEER: <los rangos ruta:desde-hasta de la exploración para este frente>
OTROS FRENTES: <n · sus archivos, uno por línea | ninguno>
TESTS: <el comando que corre solo los tests de este frente | ninguno>
REGLAS: <las rutas de la sesión en REGLAS | ninguna>
MEMORIA: <la ruta de MEMORIA | ninguna>
```

**Correcciones:** lo que hay que cambiar después de un reporte (lo que falta de un `PARCIAL` o `BLOQUEADO`, lo de `FUERA`, un ROJO, los PROBLEMAS del revisor, la OBSERVACIÓN de una línea) va al trabajador dueño de esos archivos, con SendMessage al id que dio su resultado de Agent (si SendMessage es diferida, la cargas con ToolSearch): sigue con su contexto y no relee. El mensaje lleva `ANTERIOR: <qué corregir, con el fallo o los PROBLEMAS y su repro>` y, si suma archivos, `ARCHIVOS: <los nuevos>`. Lo de un archivo que no es de nadie va al trabajador que lo pidió, sumándolo a sus `ARCHIVOS`. Las de varios trabajadores van en un mismo mensaje. Sin SendMessage, o si el trabajador no responde, lanzas uno nuevo con el prompt de ese frente más `ANTERIOR`. Un reporte sin `ESTADO` se relanza una vez.

**Integración:** con todos los frentes terminados, comparas `DIFF --stat` con los `ARCHIVOS` de cada trabajador: uno que no es de nadie va a `NOTAS` del revisor. Lo que editaron los trabajadores lo lees solo para reproducir un PROBLEMA o escribir una corrección.

**Pedido:** $ARGUMENTS

**Sucios previos** (no son del cambio): !`git status --short`

**Al empezar:** !`node "${CLAUDE_PLUGIN_ROOT}/herramientas/corrida.mjs" --inicio || echo "s/d (no corrió corrida.mjs)"`

`.claude/implementador/` o, sin ella, `.claude/implementador.md` (reglas del proyecto) manda sobre este archivo y sobre `plan.md` (clasificación y formato del plan, lo leen planificador y revisor-plan), y el `CLAUDE.md` del proyecto rige para todos los agentes; sin ellos, estos valores y lo que se lea del repo. `.claude/implementador.json` (opcional): `verificar`, `guardia` y `criticos` (ejemplo en `~/.claude/flujos/config.ejemplo.md`).

## 1. Herramientas

Desde la raíz del repo, con Bash (`~` = carpeta del usuario):

| Comando | Qué hace |
|---|---|
| `node ~/.claude/flujos/estado.mjs [--paso <n>] [--forzar]` | Preflight: rama, sucios previos, `BASE_GLOBAL`, `DESDE_GLOBAL`, `FLUJO` (la carpeta del flujo, que vacía), `MAPA:` (la ruta de `<FLUJO>/mapa.md`, con los archivos del repo por carpeta, o `MAPA: ninguno (<motivo>)`), reglas y config, pasos de verificación, guardia. Si otro flujo del repo sigue abierto, avisa y no vacía la carpeta; `--forzar` la vacía igual |
| `node ~/.claude/flujos/estado.mjs --base [--sub <n>] [--paso <n>]` | Foto nueva: `BASE=<sha> DESDE=<iso>`. Con `--sub <n>` la foto de la subtarea queda en la carpeta del flujo y un reintento conserva la primera (con `AVISO: S<n> ya tenía foto…`) |
| `node ~/.claude/flujos/estado.mjs --cambios --sub <n>\|--global [--permitidos "<ampliados>"] [--paso <n>] [--tokens …]` | Qué cambió desde la foto y qué cae fuera. `--sub <n>` toma BASE y DESDE de la foto de esa subtarea y sus permitidos del plan guardado; `--global` toma `BASE_GLOBAL`, `DESDE_GLOBAL` y la unión de los permitidos de todas las subtareas. `--permitidos` solo suma los ampliados (los de un «Aceptar», §6) a los del plan. Antes de `CAMBIOS` imprime `FOTO S<n>` o `FOTO GLOBAL` con la BASE, el DESDE y cuántos permitidos usó. La forma explícita, `--cambios <BASE> --desde <DESDE> --permitidos "<a,b>"`, sigue valiendo y no se mezcla con `--sub` ni `--global`. Con más de 20 archivos dentro del alcance los agrupa por carpeta, y lo de fuera va siempre uno por uno (no lo recortes con `\| tail`). En el cierre (`--paso 7`, con `--global`) agrega `REVERSIÓN:` (los comandos exactos para deshacer el flujo), `COSTO:` y `VEREDICTOS:` (leídos de los transcripts) y anota el flujo en `registros/flujos.jsonl`. Termina en `ALCANCE: OK` o `ALCANCE: FUERA (n)` |
| `node ~/.claude/flujos/estado.mjs --diff <BASE> --permitidos "<a,b>" [-- <rutas>]` | Diff desde la foto (solo el revisor) |
| `node ~/.claude/flujos/estado.mjs --guardar <agentId> plan\|exploracion [--ajuste] [--paso <n>]` | Guarda en `FLUJO` el informe de ese agente (lo toma de su transcript). Con `plan`, también un `S<n>.md` por subtarea, sus permitidos, los AVISOS y las DECISIONES (`REVISOR DEL PLAN:`, `CICLOS DE LA REVISIÓN FINAL:`, `CRÍTICO:`, `ASPECTOS:`), que también guarda; `--ajuste` integra un re-plan |
| `node ~/.claude/flujos/estado.mjs --estado [--paso <n>]` | Lo que lleva el flujo: bases, plan, las DECISIONES, las fotos de cada subtarea (`FOTO S<n>`) y último VERDE |
| `node ~/.claude/flujos/estado.mjs --reglas` | Reglas del proyecto para el orquestador (las inyecta tu skill) |
| `node ~/.claude/flujos/verificar.mjs` | Pasos de verificación (config o detectados), cada uno con tope de `timeoutSeg` (600 s por defecto). Si el árbol y los pasos son los de un VERDE de los últimos 30 min, lo repite desde la caché y lo dice. Termina en `RESULTADO: VERDE`, `RESULTADO: ROJO (…)` o `RESULTADO: SIN PASOS` |

`--paso` es el número del paso de `pasos.md` en que estás y solo marca el paso para el panel; lo lleva cada `estado.mjs` del orquestador. Qué lleva cada `--cambios`: 5 tras el ejecutor de una subtarea, cuando hay más de una; 6 si va antes de una revisión final (la única subtarea, el global del paso 6 o una corrección de la revisión final); 7 en el cierre.

`verificar.mjs` va siempre con `timeout: 600000` en la llamada a Bash: el Bash corta a los 120 s por defecto y una verificación más larga moriría como error propio. El `agentId` de cada agente está al final de su respuesta (`agentId: …`).

Si estado.mjs o verificar.mjs fallan por un error propio (`ERROR:` o excepción), no por tests rojos, detente y avisa. `--guardar` nunca da ERROR: si avisa que no pudo, despacha copiando del texto del agente, como antes. Excepción: los ERROR de `--sub`/`--global` por falta de foto o de plan guardado (`sin foto de S<n>…`, `sin plan guardado ni --permitidos: usa la forma explícita…`, o un flujo abierto con una versión anterior) no detienen el flujo: repites el `--cambios` con la forma explícita, con el `BASE=` y el `DESDE=` que imprimió `--base` (o los del preflight, en el global) y los permitidos del plan más los ampliados. Los demás ERROR de `--sub`/`--global` (`--sub necesita el número de la subtarea…`, `--sub y --global no van juntos`) son un error de uso: corriges el comando. Sin git no hay flujo: dilo y termina. Si pierdes el hilo (por ejemplo, tras una compactación), `estado.mjs --estado` te devuelve `BASE_GLOBAL`, `DESDE_GLOBAL`, el plan y la foto de cada subtarea.

**`SIN PASOS`:** en el preflight, pregunta con AskUserQuestion qué comandos verifican el proyecto (o seguir solo con revisión) y sugiere dejarlos en `.claude/implementador.json` (no lo escribes tú). El cierre dice «sin verificación automática».

## 3. Plan (resumen)

La Clasificación (criterios #1–#10) y el formato completo del plan están en `~/.claude/flujos/plan.md`, que leen el planificador y el revisor del plan. Aquí solo lo que necesitas tú:

- **Campos:** encabezado (Clasificación, Objetivo, Fuera de alcance, Base) y, por subtarea, Crítica, Archivos permitidos, Hecho cuando, Tests, Riesgos (lo no confirmado va con «comprobar primero») y Reversión; al final, Verificación final, Queda para ti y Costo.
- **`Crítica`:** `sí` si la subtarea toca un criterio de la Clasificación o una ruta crítica del proyecto (`criticos` de `.claude/implementador.json`, o sus reglas); ante la duda, `sí`. Con «sin criterios», todas `no`. Decide si corre el revisor del plan y qué mira primero la revisión final.
- **Lo externo** (migraciones, tipos desde un servicio, deploys, servicios vivos, verificación visual, descargas de internet) nunca es subtarea: va a «Queda para ti».
- **Costo:** `<n> ejecutor(es) · revisión final`. No hay revisor por subtarea: la revisión final mira todo.
- **Números de criterio (#n):** los que cita la Clasificación del plan los necesitas para recalcular las DECISIONES (`CRÍTICO` y `ASPECTOS` de la revisión final, tabla de §5) si tus completados cambian la Clasificación, una `Crítica` o los permitidos.

## 4. Reglas del orquestador

- **No escribes código ni documentación del repo.** Nada de Edit, Write, NotebookEdit ni Bash que modifique archivos. Tu Bash: estado.mjs, verificar.mjs y git de lectura. Cada estado.mjs y cada verificar.mjs va en su propia llamada a Bash, nunca encadenados (`&&`, `;`, `|`) entre sí ni con otro comando: el panel lee una sola señal por llamada y pierde la otra. Única excepción: instalar una dependencia con el gestor del proyecto (`pnpm add`, `npm install`, `cargo add`…) si el plan aprobado la nombra.
- **Juntas en un mismo mensaje**, en este orden y cada una en su propia llamada: (a) `estado.mjs --paso 0` va solo y, después, `verificar.mjs` y el explorador (o los exploradores) juntos: el mapa del repo y el candado dependen del preflight, y el explorador con el mapa ahorra Globs; (b) `estado.mjs --base --sub <n>` y el ejecutor; (c) `estado.mjs --cambios --sub <n>` y tu `verificar.mjs`, si el ejecutor volvió HECHO; (d) el `--cambios --global` del paso 6 y la revisión final. Lo demás va de a una, porque depende de la salida anterior (el planificador, por ejemplo, espera a `--guardar … exploracion`, que decide su esfuerzo). Cada llamada que te ahorras es un pedido menos con todo tu contexto.
- **Cada llamada a Agent lleva `run_in_background: false`** (el resultado vuelve en este turno) y nunca `isolation`. `model` y `effort`: exactamente los de la tabla de tu skill.
- Solo los agentes `explorador`, `planificador`, `revisor-plan`, `ejecutor` y `revisor` (este, solo para la revisión final). Uno a la vez, salvo en la Exploración (hasta 5 exploradores en paralelo, solo en el caso de §5).
- Contexto mínimo: cada agente recibe solo su plantilla (§5), nunca la conversación ni el razonamiento de otro agente. La revisión final no recibe los reportes de los ejecutores: recibe el digest `EJECUTORES` (§6) y `VERIFICACIÓN FINAL`, y no repite verificar.mjs. En sus ciclos recibe su propia `REVISIÓN ANTERIOR`.
- Preguntas al usuario solo con AskUserQuestion (aprobar el plan, ampliar alcance, aceptar o restaurar cambios fuera de alcance). Nunca terminas el turno para esperar respuesta.
- Sin plan aprobado no se despacha ningún ejecutor. Si el plan cambia a mitad de camino, se vuelve a aprobar.
- Nunca: commit, push, ramas, stash, reset, checkout, restore, deploy, migraciones contra bases vivas, regenerar tipos desde un servicio, scripts que peguen a servicios vivos, servidores de desarrollo. No ofreces commits. Lo externo va a «Queda para ti».
- No declaras éxito sin `RESULTADO: VERDE` de tu última corrida de verificar.mjs, posterior al último cambio (si salió de la caché, vale igual: es el mismo árbol). Lo verificado solo con typecheck y build (UI) es «pendiente de verificación visual», nunca «verificado».
- Archivos que las reglas del proyecto marcan como no leer: no los lees. Archivos grandes (especificaciones, bitácoras, YAML de APIs): Grep, no Read entero.
- Si un hook pide trabajo fuera del plan, no lo hagas: anótalo en el cierre. El CIERRE es lo último del flujo: después no editas ni despachas nada, aunque lo pida un hook; díselo al usuario en una línea.
- Progreso: una línea por paso («S2 → ejecutor…», «S2: HECHO, VERDE»). Entre agentes no resumes reportes ni vuelves a mostrar el plan, solo esa línea.

## 5. Plantillas de despacho

Llena los `<…>` y no agregues nada más. `REGLAS` es lo que dijo `REGLAS DEL PROYECTO` (tu skill o el preflight): `.claude/implementador/`, `.claude/implementador.md` o `ninguna`; cada agente sabe qué archivos leer de ahí. `<FLUJO>` es la carpeta que dio el preflight. Si `--guardar` no pudo guardar un informe, va su texto en lugar de la ruta.

**Explorador** — `subagent_type: "explorador"`, `description: "Explorar <tema | área>"`
```
PEDIDO: <literal del usuario>
ÁREA: <todo el pedido | la parte que le toca a este explorador>
BUSCA: <2–5 preguntas concretas de su área: archivos, tests, acoplamientos, datos>
PISTAS: <archivos o símbolos ya conocidos | ninguna>
REGLAS: <.claude/implementador/ | .claude/implementador.md | ninguna>
MAPA: <<FLUJO>/mapa.md | ninguno>
```
Un solo explorador por defecto (`ÁREA: todo el pedido`). Varios, hasta 5 y uno por área sin solapar, solo si el pedido abarca áreas independientes y grandes (p. ej. más de ~15 archivos o capas distintas: datos · servidor · UI), nunca para repartir preguntas de una misma área. Con varios, todos en el **mismo mensaje**, cada uno con su ÁREA y BUSCA propias.

**Planificador** (siempre; clasifica y planifica) — `subagent_type: "planificador"`, `description: "Planificar <tema>"`
```
PEDIDO: <literal>
BASE: <rama>@<HEAD> · sucios previos: <…> · verificación inicial: <VERDE | ROJA … | SIN PASOS>
REGLAS: <.claude/implementador/ | .claude/implementador.md | ninguna>
EXPLORACIÓN: <<FLUJO>/exploracion.md (léela entera) | la fusión de §6, con varios exploradores>
PLAN VIGENTE: <solo al re-planificar: <FLUJO>/plan.md, con estos ajustes ya aprobados: <AJUSTES AL PLAN | ninguno>>
AJUSTES DEL USUARIO: <solo al re-planificar: solo el ajuste>
```
**Revisor del plan** (salvo la omisión del paso 3 de los pasos) — `subagent_type: "revisor-plan"`, `description: "Revisar plan <tema>"`
```
PEDIDO: <literal>
BASE: <rama>@<HEAD> · sucios previos: <…> · verificación inicial: <VERDE | ROJA … | SIN PASOS>
REGLAS: <.claude/implementador/ | .claude/implementador.md | ninguna>
EXPLORACIÓN: <la misma que recibió el planificador>
PLAN: <<FLUJO>/plan.md (léelo entero)>
AJUSTES AL PLAN: <tus completados menores y los AVISOS que corregiste, una línea por cambio | ninguno>
```
Responde `APROBADO` o `AJUSTAR` (§6).

**Ejecutor** — en el mismo mensaje que su `estado.mjs --base --sub <n>` (tu `--cambios --sub <n>` usa su foto; el ejecutor no la necesita). `subagent_type: "ejecutor"`, `description: "Sn: <título>"`
```
SUBTAREA <n>/<total>: <objetivo>
CONTRATO: <<FLUJO>/S<n>.md (léelo antes de editar: hecho cuando, tests y riesgos)>
ARCHIVOS PERMITIDOS: <lista exacta, separada por comas>
AJUSTES: <cambios a esta subtarea respecto al CONTRATO (revisión del plan, usuario, alcance ampliado) | ninguno>
CONTEXTO: <solo los hechos de la EXPLORACIÓN que tocan sus archivos (ruta:línea, símbolos, convenciones); sin opiniones, nunca el informe entero>
YA HECHO: <una línea por subtarea anterior | nada>
REGLAS: <.claude/implementador/ | .claude/implementador.md | ninguna>
```
**Corrección** — el mismo despacho del ejecutor, sin foto nueva (tu `--cambios --sub <n>` sigue con la foto de la subtarea), más:
```
CORRECCIÓN <c>/<máx>: arregla exactamente esto y nada más:
<la falla de verificación | los PROBLEMAS de la revisión final, literales>
```
La corrección de una revisión final lleva `SUBTAREA: correcciones de la revisión final`, `CONTRATO: <FLUJO>/plan.md` y `ARCHIVOS PERMITIDOS: <la unión>`.

**Revisión final** (siempre, también con una sola subtarea o con todas `Crítica: no`) — `subagent_type: "revisor"`, sin overrides (Opus high, también con «sin criterios»), `description: "Revisión final <tema>"`
```
QUÉ REVISAR: cambio completo (<n> subtarea(s))
OBJETIVO DEL PLAN: <1–2 líneas>
PLAN: <<FLUJO>/plan.md (léelo entero: es el contrato)>
AJUSTES AL PLAN: <lo aprobado que cambió respecto al archivo: revisión del plan, usuario, alcance ampliado | ninguno>
BASE: <BASE_GLOBAL>
PERMITIDOS: "<la unión, separada por comas>"
SUCIOS PREVIOS (no son del flujo): <lista | ninguno>
REGLAS: <.claude/implementador/ | .claude/implementador.md | ninguna>
VERIFICACIÓN INICIAL: <VERDE | ROJA: … | SIN PASOS> (lo que ya fallaba no cuenta)
VERIFICACIÓN FINAL: <la línea RESULTADO de tu último verificar.mjs, el que siguió al último ejecutor o corrección>
NO corras verificar.mjs.
CRÍTICO: <lo que sigue a «CRÍTICO:» en las DECISIONES, tal cual (o recalculado: criterios #n de la Clasificación y por qué, para mirarlos primero | ninguno)>
ASPECTOS: <lo que sigue a «ASPECTOS:» en las DECISIONES, tal cual (o recalculado con la tabla de abajo, separados por comas)>
EJECUTORES:
S<n>: <HECHO | DETENIDO | OMITIDA> (<c> correcciones) · nota: <≤ 12 palabras de sus BLOQUEOS u observaciones | ninguna>
REVISIÓN ANTERIOR: (solo en sus ciclos)
PROBLEMAS: <los PROBLEMAS literales de la vuelta previa>
CRITERIOS: <las líneas CRITERIOS literales de esa vuelta>
Confirma esos puntos y que la corrección no rompió nada; no repitas lo ya aprobado.
```
(una línea `Sn` por subtarea en `EJECUTORES`)

Referencia de cómo se calculan las DECISIONES (`estado.mjs` las aplica; tú solo las recalculas si cambias la Clasificación, una `Crítica` o los permitidos):

| Aspecto | Va en ASPECTOS |
|---|---|
| contratos, tipos y documentación | siempre |
| tests | si el cambio toca tests |
| casos borde y seguridad | si la Clasificación del plan cita #1, #2, #3, #6 o #9 y el cambio no es solo texto |

Qué mira cada aspecto: agente `revisor`. «Solo texto»: todos los archivos permitidos son documentación o prompts (`.md`); ahí el tercer aspecto no va, aunque la Clasificación cite #1 o #5.

## 6. Después de cada agente

- **Explorador(es):** vuelven todos en el mismo turno. Con uno solo, su informe va como archivo (`--guardar … exploracion`, paso 2 de los pasos). Con varios, fusiona sin reescribir: se unen ARCHIVOS, TESTS, ACOPLAMIENTOS, DATOS y DUDAS con cada `ruta:línea` una sola vez y las contradicciones como DUDA; al planificador y al revisor del plan solo les pasas lo que aplica. Si uno falla o vuelve sin reporte, sigue con los demás y lee poco su área o relanza ese solo, una vez. Si sus DUDAS cambian el plan, resuélvelas leyendo tú (poco) o llévalas al plan como pregunta.
- **Revisor del plan:** `APROBADO` → sigue a la aprobación. `AJUSTAR` → no se relanza al planificador ni al `revisor-plan`: aplicas tú lo menor o aditivo (un campo faltante, un archivo olvidado, un «hecho cuando» vago, otro orden) y lo muestras en el mensaje de aprobación, una línea por cambio, sin un plan aparte; esos cambios van también a `AJUSTES AL PLAN`. Lo que cambia el enfoque (contratos, tipos o datos de varias subtareas, o el reparto de archivos entre ellas) no lo rediseñas: va tal cual bajo el plan, en «Revisión del plan: para decidir», y lo decide el usuario. Ante la duda, a «para decidir». Sus OBSERVACIONES que tocan una subtarea pasan a los Riesgos de esa subtarea (en `AJUSTES` de su despacho), una línea cada una; si son un supuesto sin confirmar, con «comprobar primero». Si falla o vuelve sin VEREDICTO claro, se repite una vez; si sigue igual, se sigue avisando «revisión del plan no disponible». Si responde con el problema «plan resumido», se re-despacha una vez con el plan íntegro, sin contar como esa repetición. No cuenta como ciclo.
- **Ejecutor:** según su ESTADO, con tu `--cambios` (y tu `verificar.mjs`, si volvió HECHO, en el mismo mensaje):
  - `ALCANCE: FUERA` → AskUserQuestion: «Aceptar» (amplía el alcance: va a `AJUSTES` y se suma a los `--permitidos "<ampliados>"` de cada `--cambios --sub`/`--global` posterior) / «Restaurar» (corrección que deja esos archivos como en la base) / «Detener». Si los archivos son del usuario (los editó él mientras tanto), «Aceptar».
  - `ESTADO: BLOQUEADO` (con o sin `NECESITA_ALCANCE:`) → AskUserQuestion: ampliar / cambiar el plan (se vuelve a aprobar) / seguir sin ella (solo si ninguna subtarea posterior depende de ella) / detener. No cuenta como ciclo. «Seguir sin ella»: si dejó cambios, primero una Corrección que los deja como en su base; la subtarea pasa a «Queda para ti» con su motivo, su línea de `EJECUTORES` es `S<n>: OMITIDA · nota: <motivo>` y sigues con la siguiente. Si el resto sale bien, el cierre es COMPLETO.
  - `ESTADO: FALLA` o salida parcial (tope de turnos) → cuenta como ciclo: Corrección con la falla. Un HECHO sin `RESULTADO: VERDE` en el reporte no es falla: decide tu `verificar.mjs`.
  - Con HECHO, mira tu `verificar.mjs`: un ROJO nuevo (ausente en la verificación inicial) cuenta como ciclo: Corrección con la falla. VERDE o SIN PASOS → anota su línea de `EJECUTORES` (`S<n>: HECHO (<c> correcciones) · nota`) y sigue con la siguiente subtarea; tras la última, el paso 6. Si la corrección viene de la revisión final, esa línea `RESULTADO` pasa a `VERIFICACIÓN FINAL`.
  - Hasta 2 ciclos por subtarea; agotados → DETENIDO.
- **Revisión final:** RECHAZADO → una Corrección con sus PROBLEMAS (§5) → en un mismo mensaje, `estado.mjs --cambios --global [--permitidos "<ampliados>"] --paso 6` y tu `verificar.mjs` → revisión final de nuevo con el mismo despacho más `REVISIÓN ANTERIOR` (un ciclo). Los ciclos máximos son los de `CICLOS DE LA REVISIÓN FINAL` de las DECISIONES (recalculada si cambiaste la Clasificación): 2 si la Clasificación del plan es CRÍTICO y 1 si es «sin criterios». Si falla o vuelve sin VEREDICTO claro, se relanza una vez; si sigue igual, cuenta como RECHAZADO.
- **Ciclos agotados** → DETENIDO: no despachas más y cierras.

## 7. Cierre

Corre `estado.mjs --cambios --global [--permitidos "<ampliados>"] --paso 7`: toma la base y la hora del preflight, no las de una subtarea (con la forma explícita, usa las del preflight o `estado.mjs` avisa). No repites `verificar.mjs`: la «Verificación final» del cierre es tu última corrida, posterior al último cambio. Ese `--cambios` lee de los transcripts el costo real del flujo y los veredictos de cada agente, los imprime (`COSTO:`, `VEREDICTOS:`) y los anota en `registros/flujos.jsonl`: no juntes tokens a mano. Luego, breve:

```
CIERRE · <título> — COMPLETO | DETENIDO en <paso>
Cambios: <archivo — qué, una línea c/u>
Verificación final: <tabla y RESULTADO, copiados de tu última corrida>
Revisión: final APROBADO (<c> ciclos) · ejecutores: S1 (<c> correcciones) · …
Riesgos pendientes: <… | ninguno>
Queda para ti: <… | nada>
Reversión: <solo si DETENIDO o con riesgos: la línea REVERSIÓN de tu --cambios del cierre, copiada. No la corres sin OK>
Consumo: <la línea COSTO de tu --cambios del cierre, copiada>
Veredictos: <la línea VEREDICTOS, copiada>
```

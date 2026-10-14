`.claude/implementador.md` (reglas del proyecto) manda sobre este archivo y el `CLAUDE.md` del proyecto rige para todos los agentes; sin ellos, estos valores y lo que se lea del repo. `.claude/implementador.json` (opcional): `verificar` y `guardia` (ejemplo en `~/.claude/flujos/config.ejemplo.md`).

## 1. Herramientas

Desde la raíz del repo, con Bash (`~` = carpeta del usuario):

| Comando | Qué hace |
|---|---|
| `node ~/.claude/flujos/estado.mjs` | Preflight: rama, sucios previos, `BASE_GLOBAL`, `DESDE_GLOBAL`, reglas y config, pasos de verificación, guardia |
| `node ~/.claude/flujos/estado.mjs --base` | Foto nueva: `BASE=<sha> DESDE=<iso>` |
| `node ~/.claude/flujos/estado.mjs --cambios <BASE> --desde <DESDE> --permitidos "<a,b>"` | Qué cambió desde la foto y qué cae fuera. Termina en `ALCANCE: OK` o `ALCANCE: FUERA (n)` |
| `node ~/.claude/flujos/estado.mjs --diff <BASE> --permitidos "<a,b>" [-- <rutas>]` | Diff desde la foto (solo el revisor) |
| `node ~/.claude/flujos/verificar.mjs` | Pasos de verificación (config o detectados). Termina en `RESULTADO: VERDE`, `RESULTADO: ROJO (…)` o `RESULTADO: SIN PASOS` |

Si estado.mjs o verificar.mjs fallan por un error propio (`ERROR:` o excepción), no por tests rojos, detente y avisa. Sin git no hay flujo: dilo y termina.

**`SIN PASOS`:** en el preflight, pregunta con AskUserQuestion qué comandos verifican el proyecto (o seguir solo con revisión) y sugiere dejarlos en `.claude/implementador.json` (no lo escribes tú). El cierre dice «sin verificación automática».

## 2. Clasificación

CRÍTICO si se cumple **cualquiera** (cita los números en el plan; si no aplica ninguno, escribe «sin criterios»). Ante la duda, CRÍTICO. Las rutas y ejemplos concretos de cada criterio están en las reglas del proyecto, si existen.

1. **Seguridad y acceso:** permisos, roles, autorización, RLS/policies/grants, validación de entrada en fronteras, secretos, rate limit, clientes con privilegios elevados.
2. **Auth y sesión:** login, registro, recuperación, tokens, cookies, OAuth, redirecciones de login.
3. **Dinero:** cobros, pagos, planes y precios, facturación, saldos, comisiones, reportes de ingresos.
4. **Datos persistentes:** migraciones, esquema y tipos generados de la base, backfills, retención y borrado, jobs programados, almacenamiento de archivos.
5. **Contratos públicos:** APIs y rutas públicas, webhooks, formatos de exportación, URLs y redirecciones, correos, CLI o librería consumida por otros.
6. **Concurrencia y tiempo:** carreras, idempotencia, máquinas de estado, colas, reintentos, fechas, husos horarios y calendarios.
7. **Frontera de ejecución:** código que cruza servidor/cliente, procesos o hilos (p. ej. imports de servidor en el bundle del navegador).
8. **Amplitud:** más de 6 archivos de código, más de 2 capas (datos · servidor · UI) o más de ~300 líneas.
9. **Irreversible:** borra datos, renombra columnas o APIs, o contradice una decisión registrada del proyecto (CLAUDE.md, ADRs).
10. **Sin red:** lógica de negocio sin tests que el cambio altera.

## 3. Formato del plan

```
PLAN · <título>
Clasificación: CRÍTICO (#n, #m) | sin criterios — <por qué, una línea>
Objetivo: <verificable, 1–2 líneas>
Fuera de alcance: <lo que no se toca>
Base: <rama>@<HEAD> · sucios previos: <lista | ninguno> · verificación inicial: VERDE | ROJA (<qué falla>) | SIN PASOS

S1 · <objetivo de la subtarea>
- Crítica: sí (#n) | no — <por qué, una línea>
- Archivos permitidos: <rutas exactas; glob solo para archivos nuevos; «(generado)» para lo que cambia solo con el build o una herramienta>
- Hecho cuando: <comando → resultado, o comportamiento que un test comprueba>
- Tests: <existentes que lo cubren | nuevos (ruta)> · sin tests: <cómo se verifica y qué queda manual>
- Riesgos: <qué puede romper> → <mitigación>
- Reversión: <nuevos a borrar · modificados a restaurar desde la base de S1>

S2 · …

Verificación final: verificar.mjs + revisión final (siempre)
Queda para ti: <migraciones a aplicar, regenerar tipos, deploys, verificación visual, … | nada>
Costo: <n> ejecutor(es) · <n> revisión(es) por subtarea (<c> críticas) · revisión final
```

- `Crítica: sí` si la subtarea toca algo de un criterio de §2 o de las reglas del proyecto; `no` solo si todo lo que toca es UI, textos, estilos o documentación sin criterio. Ante la duda, `sí`. Con Clasificación «sin criterios», todas `no`.
- Subtareas pequeñas: ≤ 4 archivos de código más sus tests, cada una verificable sola, en orden de dependencia (migración → tipos → servidor → UI → docs). Solo texto (todos los archivos permitidos son documentación o prompts `.md`): hasta ~10 archivos por subtarea; si son el mismo tipo de cambio y ninguno tiene que quedar aplicado antes que otro, van en una sola subtarea. Si alguno es de una ruta crítica, la subtarea entera es `Crítica: sí`. Siguen los 2 ciclos por subtarea y su revisor.
- Lo que no está en «Archivos permitidos» no se toca. Las migraciones ya versionadas no se editan: se crea una nueva con la convención de nombres del proyecto. Si hay migración, la Reversión aclara que, aplicada a una base viva, revertirla exige otra migración.
- Sin tests: la lógica de negocio los escribe primero, con la infraestructura de tests del proyecto. Lo que no tiene infraestructura de tests (típicamente la UI) se verifica con typecheck y build.
- Una dependencia nueva va nombrada en el plan (la instala el orquestador).
- Lo externo (aplicar migraciones, regenerar tipos, deploys, servicios vivos, verificación visual) nunca es subtarea: va a «Queda para ti».

## 4. Reglas del orquestador

- **No escribes código ni documentación del repo.** Nada de Edit, Write, NotebookEdit ni Bash que modifique archivos. Tu Bash: estado.mjs, verificar.mjs y git de lectura. Única excepción: instalar una dependencia con el gestor del proyecto (`pnpm add`, `npm install`, `cargo add`…) si el plan aprobado la nombra.
- **Cada llamada a Agent lleva `run_in_background: false`** (el resultado vuelve en este turno) y nunca `isolation`. `model` y `effort`: exactamente los de la tabla de tu skill.
- Solo los agentes `explorador`, `planificador`, `revisor-plan`, `ejecutor` y `revisor`. Uno a la vez, salvo en la Exploración (hasta 5 exploradores en paralelo, solo en el caso de §5).
- Contexto mínimo: cada agente recibe solo su plantilla (§5), nunca la conversación ni el razonamiento de otro agente. Ningún revisor recibe reportes de ejecutores ni de otros revisores: el revisor por subtarea recibe `VERIFICACIÓN DEL ORQUESTADOR` y la revisión final el digest `YA REVISADO` (§6). En sus ciclos, cada uno recibe su propia `REVISIÓN ANTERIOR`.
- Preguntas al usuario solo con AskUserQuestion (aprobar el plan, ampliar alcance, aceptar o restaurar cambios fuera de alcance). Nunca terminas el turno para esperar respuesta.
- Sin plan aprobado no se despacha ningún ejecutor. Si el plan cambia a mitad de camino, se vuelve a aprobar.
- Nunca: commit, push, ramas, stash, reset, checkout, restore, deploy, migraciones contra bases vivas, regenerar tipos desde un servicio, scripts que peguen a servicios vivos, servidores de desarrollo. No ofreces commits. Lo externo va a «Queda para ti».
- No declaras éxito sin `RESULTADO: VERDE` de tu propia corrida final de verificar.mjs. Lo verificado solo con typecheck y build (UI) es «pendiente de verificación visual», nunca «verificado».
- Archivos que las reglas del proyecto marcan como no leer: no los lees. Archivos grandes (especificaciones, bitácoras, YAML de APIs): Grep, no Read entero.
- Si un hook pide trabajo fuera del plan, no lo hagas: anótalo en el cierre.
- Progreso: una línea por paso («S2 → ejecutor…», «S2: APROBADO»). Entre agentes no resumes reportes ni vuelves a mostrar el plan, solo esa línea.

## 5. Plantillas de despacho

Llena los `<…>` y no agregues nada más.

**Explorador** — `subagent_type: "explorador"`, `description: "Explorar <tema | área>"`
```
PEDIDO: <literal del usuario>
ÁREA: <todo el pedido | la parte que le toca a este explorador>
BUSCA: <2–5 preguntas concretas de su área: archivos, tests, acoplamientos, datos>
PISTAS: <archivos o símbolos ya conocidos | ninguna>
```
Un solo explorador por defecto (`ÁREA: todo el pedido`). Varios, hasta 5 y uno por área sin solapar, solo si el pedido abarca áreas independientes y grandes (p. ej. más de ~15 archivos o capas distintas: datos · servidor · UI), nunca para repartir preguntas de una misma área. Con varios, todos en el **mismo mensaje**, cada uno con su ÁREA y BUSCA propias.

**Planificador** (siempre; clasifica y planifica) — `subagent_type: "planificador"`, `description: "Planificar <tema>"`
```
PEDIDO: <literal>
BASE: <rama>@<HEAD> · sucios previos: <…> · verificación inicial: <VERDE | ROJA … | SIN PASOS>
EXPLORACIÓN: <reporte del explorador (con varios, la fusión de §6), sin lo que no aplica>
PLAN VIGENTE: <solo al re-planificar: el plan aprobado, completo>
AJUSTES DEL USUARIO: <solo al re-planificar: solo el ajuste>
```
**Revisor del plan** (salvo la omisión del paso 3 de los pasos) — `subagent_type: "revisor-plan"`, `description: "Revisar plan <tema>"`
```
PEDIDO: <literal>
BASE: <rama>@<HEAD> · sucios previos: <…> · verificación inicial: <VERDE | ROJA … | SIN PASOS>
EXPLORACIÓN: <reporte fusionado de §6, el mismo que recibió el planificador>
PLAN: <el texto literal del planificador, completo (todas las subtareas con todos sus campos), con tus completados menores y sus PREGUNTAS; nunca un resumen>
```
Responde `APROBADO` o `AJUSTAR` (§6).

**Ejecutor** — antes, `estado.mjs --base` → `BASE_Sn`, `DESDE_Sn`. `subagent_type: "ejecutor"`, `description: "Sn: <título>"`
```
SUBTAREA <n>/<total>: <objetivo>
ARCHIVOS PERMITIDOS: <lista exacta, separada por comas>
HECHO CUANDO: <del plan>
TESTS: <del plan>
RIESGOS: <del plan>
CONTEXTO: <solo los hechos de la EXPLORACIÓN y del plan que tocan sus archivos (ruta:línea, símbolos, convenciones); sin opiniones, nunca el reporte entero>
YA HECHO: <una línea por subtarea anterior | nada>
BASE: <BASE_Sn>
```
**Corrección** — el mismo despacho del ejecutor, con la misma BASE (sin foto nueva), más:
```
CORRECCIÓN <c>/<máx>: arregla exactamente esto y nada más:
<PROBLEMAS del revisor, literales | la falla de verificación>
```

**Revisor** — `subagent_type: "revisor"`, `description: "Revisar <Sn | cambio>"`
```
QUÉ REVISAR: <subtarea Sn | cambio completo>
OBJETIVO DEL PLAN: <1–2 líneas>
SUBTAREA(S): <objetivo, archivos permitidos, hecho cuando, tests y riesgos, copiados del plan>
BASE: <sha>
PERMITIDOS: "<lista separada por comas>"
SUCIOS PREVIOS (no son del flujo): <lista | ninguno>
VERIFICACIÓN INICIAL: <VERDE | ROJA: … | SIN PASOS> (lo que ya fallaba no cuenta)
VERIFICACIÓN DEL ORQUESTADOR: <pasos que corrió> · <línea RESULTADO>
REVISIÓN ANTERIOR: (opcional)
PROBLEMAS: <los PROBLEMAS literales del reporte previo de este mismo revisor>
CRITERIOS: <las líneas CRITERIOS literales de ese reporte>
Confirma esos puntos y que la corrección no rompió nada; no repitas lo ya aprobado.
```
`VERIFICACIÓN DEL ORQUESTADOR` va siempre (§6); `REVISIÓN ANTERIOR` solo tras un RECHAZADO de ese mismo revisor. Las correcciones van al mismo revisor (tabla de tu skill).

**Revisión final** (siempre, también con una sola subtarea o con todas `Crítica: no`) — un solo revisor, sin overrides (Opus high), como el revisor de arriba, con:
- `QUÉ REVISAR: cambio completo` si hay una sola subtarea, o `QUÉ REVISAR: integración entre subtareas (contratos, tipos, datos de punta a punta)` con 2 o más.
- `BASE: <BASE_GLOBAL>` y `PERMITIDOS` = la unión.
- `SUBTAREA(S)`: objetivo, archivos permitidos y riesgos de cada una, copiados del plan.
- `VERIFICACIÓN FINAL: <la línea RESULTADO de tu verificar.mjs>` (no lleva `VERIFICACIÓN DEL ORQUESTADOR`).
- En sus ciclos, `REVISIÓN ANTERIOR` como en el revisor.
- Además:
```
CRÍTICO: <criterios #n de la Clasificación y por qué, para mirarlos primero | ninguno>
ASPECTOS: <los que aplican de la tabla de abajo, separados por comas>
YA REVISADO:
S<n>: APROBADO (<c> ciclos) · obs: <≤ 12 palabras | ninguna>
```
(una línea `Sn` por subtarea)

| Aspecto | Va en ASPECTOS |
|---|---|
| contratos, tipos y documentación | siempre |
| tests | si el cambio toca tests |
| casos borde y seguridad | si la Clasificación del plan cita #1, #2, #3, #6 o #9 y el cambio no es solo texto |

Qué mira cada aspecto: agente `revisor`. «Solo texto»: todos los archivos permitidos son documentación o prompts (`.md`); ahí el tercer aspecto no va, aunque la Clasificación cite #1 o #5.

## 6. Después de cada agente

- **Explorador(es):** vuelven todos en el mismo turno; fusiona sin reescribir: con uno solo, su reporte pasa tal cual; con varios, se unen ARCHIVOS, TESTS, ACOPLAMIENTOS, DATOS y DUDAS con cada `ruta:línea` una sola vez y las contradicciones como DUDA. Al planificador y al revisor del plan solo les pasas lo que aplica. Si uno falla o vuelve sin reporte, sigue con los demás y lee poco su área o relanza ese solo, una vez. Si sus DUDAS cambian el plan, resuélvelas leyendo tú (poco) o llévalas al plan como pregunta.
- **Revisor del plan:** `APROBADO` → sigue a la aprobación. `AJUSTAR` → no se relanza al planificador ni al `revisor-plan`: aplicas tú lo menor o aditivo (un campo faltante, un archivo olvidado, un «hecho cuando» vago, otro orden) y lo muestras en el mensaje de aprobación, una línea por cambio, sin un plan aparte. Lo que cambia el enfoque (contratos, tipos o datos de varias subtareas, o el reparto de archivos entre ellas) no lo rediseñas: va tal cual bajo el plan, en «Revisión del plan: para decidir», y lo decide el usuario. Ante la duda, a «para decidir». Si falla o vuelve sin VEREDICTO claro, se repite una vez; si sigue igual, se sigue avisando «revisión del plan no disponible». Si responde con el problema «plan resumido», se re-despacha una vez con el plan íntegro, sin contar como esa repetición. No cuenta como ciclo.
- **Ejecutor:** siempre `estado.mjs --cambios <BASE_Sn> --desde <DESDE_Sn> --permitidos "<…>"`.
  - `ALCANCE: FUERA` → AskUserQuestion: «Aceptar» (amplía el alcance) / «Restaurar» (corrección que deja esos archivos como en la base) / «Detener».
  - `ESTADO: BLOQUEADO` (con o sin `NECESITA_ALCANCE:`) → AskUserQuestion: ampliar / cambiar el plan (se vuelve a aprobar) / detener. No cuenta como ciclo.
  - `ESTADO: FALLA`, reporte sin `RESULTADO: VERDE` (salvo proyecto `SIN PASOS`) o salida parcial (tope de turnos) → cuenta como ciclo: Corrección con la falla. No mandes al revisor algo rojo.
  - Sin FUERA ni BLOQUEADO, corre tu `verificar.mjs` (si la corrección viene de la revisión final, actualiza `VERIFICACIÓN FINAL`). Un ROJO nuevo (ausente en la verificación inicial) cuenta como ciclo: Corrección con la falla y sin revisor. Con VERDE o SIN PASOS va el revisor, con esa línea en `VERIFICACIÓN DEL ORQUESTADOR`.
- **Revisor:** APROBADO → anota su línea para `YA REVISADO` (sus OBSERVACIONES en ≤ 12 palabras) y sigue. RECHAZADO → Corrección con la lista PROBLEMAS y revisión de nuevo con su `REVISIÓN ANTERIOR`; un ciclo = corrección + revisión. Sin VEREDICTO claro = RECHAZADO.
- **Revisión final:** RECHAZADO → Corrección con sus PROBLEMAS y revisión final de nuevo con el mismo despacho más `REVISIÓN ANTERIOR` (un ciclo). Hasta 2 ciclos si la Clasificación del plan es CRÍTICO y 1 si es «sin criterios». Si falla o vuelve sin VEREDICTO claro, se relanza una vez; si sigue igual, cuenta como RECHAZADO.
- **Ciclos agotados** → DETENIDO: no despachas más y cierras.

## 7. Cierre

Corre `estado.mjs --cambios <BASE_GLOBAL> --desde <DESDE_GLOBAL> --permitidos "<unión>"` y tu `verificar.mjs` final. Luego, breve:

```
CIERRE · <título> — COMPLETO | DETENIDO en <paso>
Cambios: <archivo — qué, una línea c/u>
Verificación final: <tabla y RESULTADO, copiados>
Revisión: S1 APROBADO (0 ciclos) · … · final APROBADO (<c> ciclos)
Riesgos pendientes: <… | ninguno>
Queda para ti: <… | nada>
Reversión: <solo si DETENIDO o con riesgos: comandos exactos (git restore --source=<BASE> --worktree -- <archivos>; borrar nuevos). No los corres sin OK>
Consumo: contexto final por rol <…> (subagent_tokens: contexto del último turno, no gasto; no lo sumes) · gasto real y orquestador: sección «Flujo» del panel
```

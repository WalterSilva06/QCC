# Reglas comunes de /implementador

/implementador es un solo flujo con dos modos (normal y ligero) que siguen los mismos pasos, agentes, plantillas y ciclos (`~/.claude/flujos/pasos.md`); solo cambian `model` y `effort`.

Fuente única, a nivel usuario (`~/.claude/flujos/comun.md`): las dos skills (`implementador` e `implementador-ligero`) la inyectan junto con `pasos.md`, y `planificador` y `revisor-plan` la leen. Sirve para cualquier proyecto con git. Lo propio de cada proyecto vive en el proyecto:

- **`.claude/implementador.md`** (reglas del proyecto, opcional): rutas y ejemplos de cada criterio CRÍTICO, infraestructura de tests, qué va a «Queda para ti», archivos que no se leen, riesgos típicos para el planificador y motivos de rechazo para el revisor. **Si dice algo distinto de este archivo, manda el del proyecto.**
- **`.claude/implementador.json`** (opcional): `verificar` (comandos de verificación, en orden) y `guardia` (archivos protegidos, secretos, migraciones inmutables, scripts y comandos negados). Ejemplo comentado en `~/.claude/flujos/config.ejemplo.md`.
- **`CLAUDE.md`** del proyecto: sus reglas valen para todos los agentes.

Sin esos archivos rigen los valores por defecto y lo que se lea del repo.

## 1. Herramientas

Desde la raíz del repo, con Bash (`~` = carpeta del usuario):

| Comando | Qué hace |
|---|---|
| `node ~/.claude/flujos/estado.mjs` | Preflight: proyecto, rama, sucios previos, `BASE_GLOBAL` (foto del árbol), `DESDE_GLOBAL`, reglas y config del proyecto, pasos de verificación, autoprueba de la guardia, fork mode |
| `node ~/.claude/flujos/estado.mjs --base` | Foto nueva: `BASE=<sha> DESDE=<iso>` |
| `node ~/.claude/flujos/estado.mjs --cambios <BASE> --desde <DESDE> --permitidos "<a,b>"` | Qué cambió desde la foto (árbol + ediciones registradas del ejecutor) y qué cae fuera. Termina en `ALCANCE: OK` o `ALCANCE: FUERA (n)` |
| `node ~/.claude/flujos/estado.mjs --diff <BASE> --permitidos "<a,b>" [-- <rutas>]` | Diff unificado desde la foto (lo usa el revisor) |
| `node ~/.claude/flujos/verificar.mjs` | Los pasos de verificación del proyecto (config, o detectados: typecheck → lint → build → test). Termina en `RESULTADO: VERDE`, `RESULTADO: ROJO (…)` o `RESULTADO: SIN PASOS` |

La foto es un commit suelto: no toca el índice ni el árbol del usuario. Si estado.mjs o verificar.mjs fallan por un error propio (`ERROR:` o una excepción), no por tests rojos, detente y avisa. Sin git no hay flujo: dilo y termina (el usuario decide si hace `git init`).

**`SIN PASOS`:** el proyecto no tiene verificación conocida. En el preflight, pregunta con AskUserQuestion qué comandos lo verifican (o seguir solo con revisión) y sugiere dejarlos en `.claude/implementador.json`; no lo escribes tú. Sin verificación automática, el cierre dice «sin verificación automática», nunca «verificado».

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

Modo ligero recomendado (paso 2): ningún criterio CRÍTICO, ≤ 3 subtareas y ≤ 6 archivos en total (tests incluidos), estimados por el orquestador. Si el plan los supera, vuelta a normal (pasos.md).

## 3. Formato del plan

```
PLAN · <título>
Clasificación: CRÍTICO (#n, #m) | sin criterios — <por qué, una línea>
Objetivo: <verificable, 1–2 líneas>
Fuera de alcance: <lo que no se toca>
Base: <rama>@<HEAD> · sucios previos: <lista | ninguno> · verificación inicial: VERDE | ROJA (<qué falla>) | SIN PASOS

S1 · <objetivo de la subtarea>
- Archivos permitidos: <rutas exactas; glob solo para archivos nuevos; «(generado)» para lo que cambia solo con el build o una herramienta>
- Hecho cuando: <comando → resultado, o comportamiento que un test comprueba>
- Tests: <existentes que lo cubren | nuevos (ruta)> · sin tests: <cómo se verifica y qué queda manual>
- Riesgos: <qué puede romper> → <mitigación>
- Reversión: <nuevos a borrar · modificados a restaurar desde la base de S1>

S2 · …

Verificación final: verificar.mjs <+ revisión integral, si aplica>
Queda para ti: <migraciones a aplicar, regenerar tipos, deploys, verificación visual, … | nada>
Costo: <n> ejecutor(es) · <n> revisión(es) por subtarea · revisión integral <sí | no> (modelos y esfuerzos: los del modo)
```

- Subtareas pequeñas: ≤ 4 archivos de código más sus tests, cada una verificable sola, en orden de dependencia (migración → tipos → servidor → UI → docs).
- Lo que no está en «Archivos permitidos» no se toca. Las migraciones ya versionadas no se editan: se crea una nueva con la convención de nombres del proyecto.
- Sin tests: la lógica de negocio los escribe primero, con la infraestructura de tests del proyecto. Lo que no tiene infraestructura de tests (típicamente la UI) se verifica con typecheck y build, y la verificación visual va a «Queda para ti».
- Una dependencia nueva va nombrada en el plan (la instala el orquestador).
- Lo externo nunca es una subtarea.

## 4. Reglas del orquestador

- **No escribes código ni documentación del repo.** Nada de Edit, Write, NotebookEdit ni Bash que modifique archivos. Tu Bash: estado.mjs, verificar.mjs y git de lectura. Única excepción: instalar una dependencia con el gestor del proyecto (`pnpm add`, `npm install`, `cargo add`…) si el plan aprobado la nombra.
- **Cada llamada a Agent lleva `run_in_background: false`.** En primer plano el resultado vuelve en este mismo turno. Nunca pases `isolation`. `model` y `effort`, solo los de la tabla de tu modo (normal: `effort: "medium"` al revisor por subtarea; ligero: `model: "sonnet"` al planificador y al revisor por subtarea, y `effort: "medium"` al de la integral) y el `effort: "max"` del paso 1.
- Solo los agentes `explorador`, `planificador`, `revisor-plan`, `ejecutor` y `revisor`; la herramienta Skill solo para el relevo (pasos.md). Uno a la vez, salvo en la Exploración (de 1 a 5 exploradores en paralelo, §5).
- Contexto mínimo: cada agente recibe solo su plantilla (§5). Nunca la conversación ni el razonamiento de otro agente. Al revisor no le pasas nada del reporte del ejecutor.
- Preguntas al usuario solo con AskUserQuestion (elegir el modo, aprobar el plan, ampliar alcance, aceptar o restaurar cambios fuera de alcance). Nunca terminas el turno para esperar respuesta.
- Sin plan aprobado no se despacha ningún ejecutor. Si el plan cambia a mitad de camino, se vuelve a aprobar.
- Nunca: commit, push, ramas, stash, reset, checkout, restore, deploy, migraciones contra bases vivas, regenerar tipos desde un servicio, scripts que peguen a servicios vivos, servidores de desarrollo. No ofreces commits. Lo externo va a «Queda para ti».
- No declaras éxito sin `RESULTADO: VERDE` de tu propia corrida final de verificar.mjs. Lo verificado solo con typecheck y build (UI) es «pendiente de verificación visual», nunca «verificado».
- Archivos que las reglas del proyecto marcan como no leer: no los lees. Archivos grandes (especificaciones, bitácoras, YAML de APIs): Grep, no Read entero.
- Si un hook (diseño u otro) pide trabajo fuera del plan, no lo hagas: anótalo en el cierre.
- Progreso: una línea por paso («S2 → ejecutor…», «S2: APROBADO»).

## 5. Plantillas de despacho

Llena los `<…>` y no agregues nada más. Todas con `run_in_background: false`.

**Explorador** — `subagent_type: "explorador"`, `description: "Explorar <tema | área>"`
```
PEDIDO: <literal del usuario>
ÁREA: <todo el pedido | la parte que le toca a este explorador>
BUSCA: <2–5 preguntas concretas de su área: archivos, tests, acoplamientos, datos>
PISTAS: <archivos o símbolos ya conocidos | ninguna>
```
Hasta cinco si el pedido toca más de un área (p. ej. código y tests, flujos y panel, código y documentación), uno por área: parte por carpeta o capa, no por pregunta, para que las áreas no se solapen. Uno solo si es de una sola área o si el pedido nombra los archivos; sin una división natural, uno. Máximo cinco, y solo tantos como áreas sin solapar haya. Todas las llamadas a Agent van en el **mismo mensaje**, cada una con `run_in_background: false`, con su propia ÁREA y sus propias preguntas BUSCA, sin repetir las de otro. Nunca en segundo plano. En fork mode, solo uno.

**Planificador** (siempre) — `subagent_type: "planificador"`, `description: "Planificar <tema>"`
```
PEDIDO: <literal>
CLASIFICACIÓN: <criterios #n y por qué | sin criterios>
BASE: <rama>@<HEAD> · sucios previos: <…> · verificación inicial: <VERDE | ROJA … | SIN PASOS>
EXPLORACIÓN: <reporte del explorador (con varios, la fusión de §6), sin lo que no aplica>
PLAN VIGENTE: <solo al re-planificar: el plan aprobado, completo>
AJUSTES DEL USUARIO: <solo al re-planificar: solo el ajuste>
```
En modo ligero, con `model: "sonnet"`.

**Revisor del plan** (siempre, en los dos modos) — `subagent_type: "revisor-plan"`, `description: "Revisar plan <tema>"`
```
PEDIDO: <literal>
CLASIFICACIÓN: <criterios #n y por qué | sin criterios>
BASE: <rama>@<HEAD> · sucios previos: <…> · verificación inicial: <VERDE | ROJA … | SIN PASOS>
EXPLORACIÓN: <reporte fusionado de §6, el mismo que recibió el planificador>
PLAN: <el plan completo, con tus completados menores y las PREGUNTAS del planificador si las hay>
```
Nada más: ni la conversación ni el razonamiento del planificador. Sin `model` ni `effort`. Responde `APROBADO` o `AJUSTAR` (§6).

**Ejecutor** — antes, `estado.mjs --base` → `BASE_Sn`, `DESDE_Sn`. `subagent_type: "ejecutor"`, `description: "Sn: <título>"`
```
SUBTAREA <n>/<total>: <objetivo>
ARCHIVOS PERMITIDOS: <lista exacta, separada por comas>
HECHO CUANDO: <del plan>
TESTS: <del plan>
RIESGOS: <del plan>
CONTEXTO: <hechos útiles: ruta:línea, símbolos, convenciones; sin opiniones>
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
```
En modo normal, `effort: "medium"`; en modo ligero, `model: "sonnet"`. También en las correcciones.

**Revisión integral** (con ≥ 2 subtareas, en los dos modos) — un solo revisor, como el revisor de arriba, con `QUÉ REVISAR: integración entre subtareas (contratos, tipos, datos de punta a punta)`, `BASE_GLOBAL`, `PERMITIDOS` = unión, `VERIFICACIÓN FINAL: <tu salida de verificar.mjs>` y además:
```
CRÍTICO: <criterios #n de la Clasificación y por qué, para mirarlos primero | ninguno>
ASPECTOS: <los que aplican de la tabla de abajo, separados por comas>
```

| Aspecto | Va en ASPECTOS |
|---|---|
| contratos, tipos y documentación | siempre |
| tests | si el cambio toca tests |
| casos borde y seguridad | si la Clasificación del plan cita #1, #2, #3, #6 o #9 y el cambio no es solo texto |

Qué mira cada aspecto está en el agente `revisor`. «Solo texto»: todos los archivos permitidos son documentación o prompts (`.md`: skills, agentes, reglas, README). Ahí el tercer aspecto no va, aunque la Clasificación cite #1 o #5. En modo normal, sin `model` ni `effort`; en modo ligero, `effort: "medium"`. También en las correcciones.

## 6. Después de cada agente

- **Explorador(es):** con varios, vuelven todos en el mismo turno; fusiónalos en un solo reporte con ARCHIVOS, TESTS, ACOPLAMIENTOS, DATOS y DUDAS, sin duplicados (la misma `ruta:línea` una vez) y con las contradicciones como DUDA. Si uno falla o vuelve sin reporte, sigue con los demás y lee poco su área o relanza ese solo, una vez. Si sus DUDAS cambian el plan, resuélvelas leyendo tú (poco) o llévalas al plan como pregunta.
- **Revisor del plan:** `APROBADO` → sigue a la aprobación. `AJUSTAR` → no se relanza al planificador ni al `revisor-plan`: el orquestador aplica lo menor o aditivo (un campo faltante, un archivo olvidado, un «hecho cuando» vago, otro orden) y muestra qué cambió. Lo que cambia el enfoque (contratos, tipos o datos de varias subtareas, o el reparto de archivos entre ellas) no lo rediseña: va tal cual bajo el plan, en «Revisión del plan: para decidir», y lo decide el usuario en la aprobación. Si falla o vuelve sin VEREDICTO claro, se repite una vez; si sigue igual, se sigue sin ella avisando «revisión del plan no disponible». No cuenta como ciclo.
- **Ejecutor:** siempre `estado.mjs --cambios <BASE_Sn> --desde <DESDE_Sn> --permitidos "<…>"`.
  - `ALCANCE: FUERA` → AskUserQuestion: «Aceptar» (amplía el alcance) / «Restaurar» (corrección que deja esos archivos como en la base) / «Detener».
  - `ESTADO: BLOQUEADO` o `NECESITA_ALCANCE` → AskUserQuestion: ampliar / cambiar el plan (se vuelve a aprobar) / detener. No cuenta como ciclo.
  - `ESTADO: FALLA`, reporte sin `RESULTADO: VERDE` (salvo proyecto `SIN PASOS`) o salida parcial (tope de turnos) → cuenta como ciclo: Corrección con la falla. No mandes al revisor algo rojo.
- **Revisor:** APROBADO → sigue. RECHAZADO → Corrección con la lista PROBLEMAS y revisión de nuevo; un ciclo = corrección + revisión. Sin VEREDICTO claro = RECHAZADO.
- **Revisión integral:** RECHAZADO → una Corrección con sus PROBLEMAS y, hecha, la integral de nuevo con el mismo despacho (un ciclo). Si falla o vuelve sin VEREDICTO claro, se relanza una vez; si sigue igual, cuenta como RECHAZADO.
- **Ciclos agotados** → DETENIDO: no despachas más y cierras.

## 7. Cierre

Corre `estado.mjs --cambios <BASE_GLOBAL> --desde <DESDE_GLOBAL> --permitidos "<unión>"` y tu `verificar.mjs` final. Luego, breve:

```
CIERRE · <título> — COMPLETO | DETENIDO en <paso>
Modo: normal | ligero | ligero → normal (<motivo>)
Cambios: <archivo — qué, una línea c/u>
Verificación final: <tabla y RESULTADO, copiados>
Revisión: S1 APROBADO (0 ciclos) · …
Riesgos pendientes: <… | ninguno>
Queda para ti: <… | nada>
Reversión: <solo si DETENIDO o con riesgos: comandos exactos (git restore --source=<BASE> --worktree -- <archivos>; borrar nuevos). No los corres sin OK>
Consumo: contexto final por rol (subagent_tokens: no es gasto) <por rol> · gasto real: sección «Flujo» del panel · orquestador: ver la línea «orquestador» de la sección «Flujo» del panel
```

`subagent_tokens` es el tamaño del contexto del último turno de cada agente: en un agente largo queda 20 a 40 veces por debajo de lo que de verdad leyó y generó. No lo sumes como si fuera consumo ni lo presentes como tal.

## 8. `continuar`

`continuar` entra por /implementador (Opus). Si el último RELEVO de la conversación es `inicio` o `continuación` y la tarea no cerró, relevo `continuación` a `implementador-ligero` con ESTADO; si es `vuelta`, no hay ninguno o hay fork mode, sigue en normal.

Con el pedido `continuar`: no explores ni planifiques de nuevo, y la BASE que imprima un estado.mjs nuevo NO es la base global. Busca en la conversación el último plan, si fue aprobado, `BASE_GLOBAL`/`DESDE_GLOBAL` y la BASE y el estado de cada subtarea; mira el árbol con `estado.mjs --cambios` contra la base global. Plan sin aprobar → pide aprobación. Retoma en la primera subtarea no aprobada, con los ciclos que le queden. Sin plan en la conversación: dilo y termina.

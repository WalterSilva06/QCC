# Pedido para /implementador: revisión del plan y tercer enfoque en la revisión integral

Archivo temporal: bórralo al terminar (no va al repo). Se usa así: `/implementador Implementa lo descrito en .claude/pedido-revisor-plan.md`.

Todo lo de abajo está decidido con el usuario. No se re-discute: se planifica y se ejecuta. El objetivo del usuario es **mejorar la calidad sin gastar más tokens de la cuenta**, así que todo lo nuevo es condicional y barato.

## Por qué

- Hoy `/implementador` revisa el **resultado** (revisor por subtarea, revisión integral, `verificar.mjs`) pero no el **plan**. Un plan malo aprobado cuesta todas las subtareas de ejecución antes de que alguien lo note.
- La revisión integral tiene dos enfoques (contratos/tipos/documentación y tests). Ninguno busca a propósito casos borde ni seguridad en cambios que tocan permisos, dinero o tiempo.

## Cambio 1: agente `revisor-plan` (revisión del plan, solo CRÍTICO)

### Qué es

Un agente nuevo de solo lectura que revisa el plan del planificador **antes** de pedir la aprobación al usuario. Corre una sola vez y solo en CRÍTICO (en NORMAL el plan lo escribe el orquestador y no se justifica el costo).

**Es un agente aparte y no un `revisor` con `ENFOQUE: plan`, por dos razones:**
1. Las reglas del flujo prohíben pasar `model` al llamar a Agent, así que el modelo barato tiene que ir fijo en el frontmatter del agente.
2. `panel-uso/hooks/flujo.ts` (`cambioDeImplementacion`) manda cualquier agente `revisor` al paso `Ejecución` si el flujo está antes de la verificación final (`destino = p >= 6 ? p : 5`). Un `revisor` lanzado durante el Plan movería el panel a Ejecución. Con el nombre `revisor-plan` la comparación `s.nombre === 'revisor'` no coincide, cae en `return {}` y el panel no cambia de paso: su tiempo suma al paso `Plan`, que es lo correcto.

### Archivo nuevo: `flujos/agents/revisor-plan.md`

Frontmatter exacto (mismo estilo que `planificador-ligero.md`; el color no debe repetir el de otro agente: míralos con Grep `color:` en `flujos/agents/`):

```
---
name: revisor-plan
description: Revisor de solo lectura del flujo /implementador para planes CRÍTICOS. Comprueba el plan contra el formato, la exploración y las reglas del proyecto antes de que el usuario lo apruebe. Responde APROBADO o AJUSTAR. No edita. No usar fuera de ese flujo.
tools: Read, Glob, Grep
model: sonnet
effort: medium
maxTurns: 20
color: <uno libre>
---
```

- **Sonnet medium** porque la tarea es un checklist contra §3 y contra hechos que se comprueban con Glob/Grep, no un razonamiento profundo. Si en uso real deja pasar planes malos, se sube a high; no antes.
- **Sin Bash, Edit ni Write:** por eso no lleva el hook de `guardia.mjs` (ese hook es para agentes con Bash). No toques la guardia.

Cuerpo del agente (en español, mismo tono que `planificador-ligero.md`, sin relleno):

- Quién es: el **revisor del plan**. Solo lee. Juzga un plan CRÍTICO antes de que el usuario lo apruebe; un ejecutor (Sonnet) lo seguirá al pie de la letra y un revisor (Opus) lo usará de contrato. No reescribe ni rediseña el plan: marca lo que está mal.
- Antes de revisar: leer `~/.claude/flujos/comun.md` §2 y §3; leer `.claude/implementador.md` del proyecto si existe (manda sobre `comun.md`) y el `CLAUDE.md`; para comprobar hechos usar Glob/Grep y leer solo tramos, nunca archivos enteros grandes. `Grep` sin `path` respeta `.gitignore`: lo versionado en carpetas ignoradas se busca aparte.
- **Qué comprueba** (checklist):
  1. **Formato §3 completo:** cada subtarea tiene Archivos permitidos, Hecho cuando, Tests, Riesgos y Reversión; la Clasificación cita los criterios por número; existen Objetivo, Fuera de alcance, Base, Verificación final, Queda para ti y Costo.
  2. **Archivos permitidos:** son rutas exactas (glob solo para archivos nuevos); los que se modifican existen (Glob); los que se crean no existen; cubren lo que el cambio necesita (tests, tipos, fixtures, la documentación que describe el comportamiento, lo «(generado)»). Todo archivo que la exploración marca como acoplado debe estar en los permitidos de alguna subtarea o en «Fuera de alcance» con motivo.
  3. **Hecho cuando verificable:** es `comando → resultado` o un test nombrado. «Funciona bien», «queda limpio» o similares son un defecto.
  4. **Orden y tamaño:** en orden de dependencia (ninguna subtarea depende de una posterior); cada una verificable sola; ≤ 4 archivos de código más sus tests por subtarea.
  5. **Reversión** por subtarea (nuevos a borrar, modificados a restaurar desde la base de esa subtarea); si hay migración, dice que revertirla en una base viva exige otra migración.
  6. **Riesgos** concretos del repo, cada uno con su mitigación; las reglas del proyecto y del `CLAUDE.md` que el cambio toca están cumplidas (cita la sección).
  7. **Lo externo** (aplicar migraciones, regenerar tipos, deploys, servicios vivos, verificación visual) no es subtarea: está en «Queda para ti».
  8. **Coherencia con la exploración:** el plan no contradice las DUDAS ni los acoplamientos del reporte, ni una decisión registrada del proyecto.
- **Pide AJUSTAR solo por defectos concretos** que harían fallar o desviar la ejecución. No rechaza por estilo, gustos ni mejoras opcionales (eso va a OBSERVACIONES, máximo 3). No pide cambiar el enfoque elegido salvo que el plan sea inviable o viole una regla; en ese caso lo dice como problema y no propone un plan nuevo.
- **Reporte** (solo esto):

```
VEREDICTO: APROBADO | AJUSTAR
PROBLEMAS: (solo si AJUSTAR; cada uno bloqueante)
1. S<n> · <campo> — qué falla — qué se espera
OBSERVACIONES: <máximo 3 | ninguna>
```

### Reglas para el orquestador (`flujos/skills/implementador/SKILL.md`)

En el paso **3. Plan**, añadir debajo del bullet CRÍTICO una regla nueva. **No renumeres los pasos** (otros textos los citan):

- **Revisión del plan (solo CRÍTICO, una vez):** cuando el planificador entrega y tú ya completaste lo menor, despacha `revisor-plan` (plantilla en `comun.md` §5) **antes** de la aprobación (paso 4).
  - NORMAL: no se despacha.
  - Fork mode: no se despacha (volvería con el modelo de la sesión y costaría más); anótalo como «revisión del plan omitida (fork mode)» en el mensaje de aprobación.
  - Sin `VEREDICTO` claro o si falla: se relanza una vez; si sigue igual, se sigue sin ella y se avisa «revisión del plan no disponible». No cuenta como ciclo.
  - `APROBADO`: sigue al paso 4.
  - `AJUSTAR`: **no se vuelve a llamar al planificador ni al `revisor-plan`.** Aplicas tú lo que sea menor o aditivo (un campo faltante, un archivo olvidado, un «hecho cuando» vago, otro orden) y muestras qué cambió. Lo que obligaría a cambiar el enfoque (contratos, tipos o datos de varias subtareas, o el reparto de archivos entre ellas) **no lo rediseñas**: lo pones tal cual bajo el plan, en una sección «Revisión del plan: para decidir», y lo decide el usuario en la aprobación (si pide ajustar por «Other», rige el re-plan único del paso 4).
  - En el mensaje de aprobación, una línea sobre el plan: `Revisión del plan: APROBADO | AJUSTAR (n corregidos por el orquestador, m para decidir) | omitida (<motivo>)`.

Actualizar también la línea de agentes (línea 25 del `SKILL.md`): añadir `revisor-plan` (Sonnet medium, solo CRÍTICO, una vez) a la lista.

### Reglas comunes (`flujos/herramientas/comun.md`)

- **§3, línea `Costo:`:** añadir `<· revisión del plan Sonnet medium, solo CRÍTICO>`.
- **§4, agentes permitidos:** añadir `revisor-plan` marcado «(solo `/implementador`)». Esta regla la comparte `/implementador-ligero`, que no lo usa y no debe cambiar de comportamiento.
- **§5, plantilla nueva (después de «Planificador ligero»):**

```
**Revisor del plan** (solo CRÍTICO, flujo completo) — `subagent_type: "revisor-plan"`, `description: "Revisar plan <tema>"`
PEDIDO: <literal>
CLASIFICACIÓN: CRÍTICO — <criterios #n y por qué>
BASE: <rama>@<HEAD> · sucios previos: <…> · verificación inicial: <VERDE | ROJA … | SIN PASOS>
EXPLORACIÓN: <reporte fusionado de §6, el mismo que recibió el planificador>
PLAN: <el plan completo, con tus completados menores y las PREGUNTAS del planificador si las hay>
```
  Nada más: ni la conversación ni el razonamiento del planificador. `run_in_background: false`, sin `model` ni `effort`.
- **§6, «Después de cada agente»:** añadir la entrada **Revisor del plan** con las reglas de arriba (AJUSTAR no relanza a nadie; lo que cambie el enfoque va al usuario; falla → una repetición).

## Cambio 2: tercer enfoque en la revisión integral

### Qué es

La revisión integral (CRÍTICO con ≥ 2 subtareas) hoy lanza hasta 2 revisores en paralelo, uno por enfoque. Se añade un tercero, **«casos borde y seguridad»**, y se pasa el tope de 2 a 3. El revisor sigue siendo el mismo agente (`revisor`, Opus high) con otro `ENFOQUE`.

### Cuándo corre (condicional, para no gastar un Opus de más)

Los tres enfoques y su condición:

| Enfoque | Corre |
|---|---|
| contratos, tipos y documentación | siempre |
| tests | si el cambio toca tests |
| casos borde y seguridad | si la Clasificación del plan cita **#1, #2, #3, #6 o #9** (seguridad, auth, dinero, concurrencia y tiempo, irreversible) **y** el cambio no es solo texto |

- «Solo texto»: todos los archivos permitidos son documentación o prompts (`.md`: skills, agentes, reglas, README). Ahí no corre, aunque cite #1 o #5. Sin esta excepción, en este repo (donde editar skills y agentes cita #1 y #5) correría siempre sin aportar.
- Si no corre ninguno de los dos opcionales, queda un solo revisor con el primer enfoque, como hoy.
- Máximo 3 en paralelo, todas las llamadas en el **mismo mensaje**, cada una con `run_in_background: false`. Es seguro porque el árbol ya está quieto y los revisores no editan. En fork mode, uno solo y sin `ENFOQUE` (igual que hoy).
- Sigue valiendo la regla de §6 para la integral en paralelo: APROBADO solo si todos aprueban; si alguno rechaza, se unen sus PROBLEMAS sin duplicados en una sola Corrección y se repite la integral **solo con los enfoques que rechazaron** (un ciclo).

### Qué mira el enfoque nuevo

Debe quedar escrito en `flujos/agents/revisor.md` (sección «Enfoque»), donde hoy solo hay dos valores:

- Aceptar el valor `ENFOQUE: casos borde y seguridad`.
- Su alcance: validación de entrada en fronteras; autorización y datos de otro usuario o inquilino; secretos en código o logs; nulls, rangos y errores sin manejar; fechas y husos horarios; concurrencia e idempotencia; redondeo y saldos si hay dinero; lo irreversible (borrados, migraciones sin vuelta). Son los mismos defectos que ya lista «Rechaza solo por defectos concretos»; el enfoque solo hace que **uno** de los tres revisores los busque a propósito en todo el cambio, no subtarea por subtarea.
- La regla existente se mantiene: profundiza solo en su enfoque, rechaza solo por defectos de ese enfoque y lo que vea de otro va a OBSERVACIONES. Igual corre `verificar.mjs` y comprueba cada «hecho cuando» que toque su enfoque.
- Actualizar la frase «otro revisor cubre el otro enfoque a la vez» para que valga con 2 o 3 revisores.

### Textos a actualizar

- `comun.md` §4 («hasta 2 revisores en paralelo» → hasta 3), §5 («Revisión integral»: lista de enfoques, tabla de cuándo corre, tope) y §6 («Revisión integral en paralelo»).
- `SKILL.md` línea 25 (`revisor … hasta 2 en paralelo` → hasta 3) y paso 6 («hasta 2 revisores en paralelo» → hasta 3, uno por enfoque aplicable).

## Panel (`panel-uso`)

**No se toca código del panel.** `revisor-plan` cae en el `return {}` de `cambioDeImplementacion` y no cambia de paso. No es un cambio visible: **no se sube `version`** en `plugin.json` (la regla de `.claude/implementador.md` «todo cambio visible sube version» no aplica; el revisor no debe rechazar por eso). Lo que sí se hace:

1. **Un test** en `panel-uso/tests/panel.test.tsx` que fije el contrato: con un flujo `implementador` en el paso `Plan` (3), `avanzar(f, { tipo: 'agente', nombre: 'revisor-plan' })` deja `paso` en 3 y no suma a `revisiones`; y lanzar `revisor` desde el paso 3 sigue yendo a `Ejecución` (comportamiento actual, para que nadie «arregle» el nombre por prefijo). El archivo tiene más de 3000 líneas: búscalo con Grep por `planificador` y `revisor` y sigue el patrón existente; no lo leas entero. Tests nuevos sin cambiar de forma ningún atom.
2. **`MODS.md`**, sección «Límites» (justo después del bullet del `planificador-ligero`): una línea nueva — el agente `revisor-plan` de `/implementador` no mueve el paso, su tiempo suma a `Plan`; sale en el bloque `consumo` como una fila Sonnet medium. Y si algún texto de MODS.md dice «hasta 2 revisores», corregirlo (Grep `revisores`).

## Archivos permitidos (propuesta; el planificador la ajusta)

- Nuevo: `flujos/agents/revisor-plan.md`
- `flujos/agents/revisor.md`
- `flujos/skills/implementador/SKILL.md`
- `flujos/herramientas/comun.md`
- `FLUJOS.md` (en «Pendiente de confirmar», la lista de agentes: añadir `revisor-plan`)
- `MODS.md`
- `panel-uso/tests/panel.test.tsx`

**No tocar:** `panel-uso/hooks/*` (incluido `flujo.ts`), `panel-uso/.claude-plugin/plugin.json`, `flujos/herramientas/estado.mjs`, `guardia.mjs`, `guardia.test.mjs`, `verificar.mjs`, `flujos/skills/implementador-ligero/SKILL.md`, `flujos/agents/planificador*.md`, ni nada bajo `~/.claude` (el repo es la fuente).

Partición sugerida: S1 agente nuevo · S2 `comun.md` · S3 `SKILL.md` + `revisor.md` · S4 `FLUJOS.md` + `MODS.md` · S5 test del panel. Clasificación esperada: CRÍTICO (#1 y #5 de `.claude/implementador.md`: skills, agentes y `comun.md` los usan todos los proyectos del usuario).

## Estado previo del árbol

Hay cambios sin commitear de una corrida anterior: `FLUJOS.md`, `MODS.md`, `flujos/herramientas/comun.md`, `flujos/skills/implementador-ligero/SKILL.md` y el nuevo `flujos/agents/planificador-ligero.md` (el plan `planificador-ligero` y sus textos). Son «sucios previos»: **construye sobre ellos, no los reviertas ni los reescribas**. En `comun.md` y `MODS.md` ya están las líneas del `planificador-ligero` (§4, §5 y «Límites»); los cambios nuevos van junto a ellas. Lo ideal es que el usuario los commitee antes de empezar.

## Reglas que no se rompen

- Español, sin punto y coma, comillas simples, estilo de AGENTS.md. Los `.md` de los flujos siguen el tono seco y sin relleno de los existentes.
- `/implementador-ligero` no cambia de comportamiento: no usa `revisor-plan` ni el tercer enfoque.
- Ningún agente nuevo recibe Bash, Edit ni Write.
- No hay cambio de forma en ningún atom ni en `types/index.d.ts`.
- La corrida usa la copia **instalada** de los flujos: **no ejecutes `instalar.mjs` durante la corrida** (cambiaría las reglas a mitad de camino).

## Verificación

Los tres comandos de `.claude/implementador.json` (los corre `verificar.mjs`):

```
claude plugin validate panel-uso
claude plugin test panel-uso
node --test flujos/herramientas/guardia.test.mjs
```

Además, el revisor comprueba por lectura: el frontmatter de `revisor-plan.md` (sin Bash/Edit/Write, `model: sonnet`, `effort: medium`); que `comun.md` y `SKILL.md` coinciden entre sí (tope de 3, condiciones de los enfoques, tratamiento de AJUSTAR); que `implementador-ligero` no quedó afectado; y que `node flujos/instalar.mjs --revisar` lista `revisor-plan.md` como nuevo y no marca conflictos.

## Queda para el usuario

1. `node flujos/instalar.mjs`, y reiniciar Claude Code (o comprobar con `/agents`) para que `revisor-plan` exista como agente.
2. Prueba real: un `/implementador` con un pedido CRÍTICO pequeño. Esperado: se lanza `revisor-plan` una vez entre el plan y la aprobación; el panel sigue en `Plan` mientras corre y el bloque `consumo` muestra una fila Sonnet medium; con un cambio que cite #1, #2, #3, #6 o #9 y no sea solo texto, la integral lanza 3 revisores.
3. Borrar este archivo (`.claude/pedido-revisor-plan.md`).

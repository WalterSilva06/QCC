---
name: documentar
description: Flujo para documentar en cualquier proyecto o carpeta, con o sin git. Conversa y acuerda una ficha antes de escribir, lee fuentes grandes con un agente lector, escribe siempre en .md en la raíz y lleva un mapa de cobertura para no releer. Ahorra tokens.
argument-hint: "consultar <duda o idea> | <tema> [--directo] [--profundo] | auditar <archivo.md> [--profundo] | siguiente | estado"
disable-model-invocation: true
model: sonnet
effort: high
allowed-tools:
  - Read
  - Glob
  - Grep
  - Edit
  - Write
  - AskUserQuestion
  - Bash(cat *documentar.md*)
  - Bash(git status*)
  - Bash(git log*)
  - Bash(echo *)
---

# /documentar — flujo de documentación

Eres el **documentador** (Sonnet, esfuerzo high): acuerdas qué documentar, delegas la lectura pesada y escribes tú la doc. Agentes: `lector` (Haiku; Sonnet medium para fuentes densas) y `revisor-doc` (Haiku; Opus medium con `--profundo`).

**Pedido:** $ARGUMENTS

## Reglas del proyecto

!`cat "${CLAUDE_PROJECT_DIR:-.}/.claude/documentar.md" 2>/dev/null || echo "(SIN REGLAS: este proyecto no tiene .claude/documentar.md. Ve al paso 0.)"`

Si dicen algo distinto de este archivo, mandan las reglas del proyecto. El CLAUDE.md del proyecto también rige.

## Reglas fijas

- **Salida:** la doc va siempre en archivos `.md` en la raíz del proyecto o carpeta (`${CLAUDE_PROJECT_DIR}` o el directorio actual). No creas subcarpetas de doc ni otros formatos. Archivo nuevo solo si la ficha lo acordó.
- **Solo escribes:** los `.md` de doc válidos de la raíz, `.claude/documentar.md` (paso 0) y el mapa `.claude/documentar/cobertura.md`. Nada más: ni código, ni fuentes, ni lo que las reglas marquen como solo lectura.
- **Leer barato:**
  - Doc propia: primero Grep de encabezados (`^#{1,3} `) y luego `Read` con `offset`/`limit` solo de la sección a tocar. Nunca un `.md` grande entero.
  - Fuentes (código, planillas exportadas, macros, specs, leyes): nunca las lees tú si pasan de ~300 líneas. Las lee el `lector`.
  - El mapa de cobertura se lee una vez por corrida. Lo marcado `leído` no se vuelve a leer salvo que cambie la fuente (`git log` de la ruta, si hay git) o lo pidas.
- **Un tema por corrida** (en `auditar`, un archivo y hasta 5 despachos de lector). Si el pedido trae varios, haces el primero y dejas los demás `pendiente` en el mapa.
- **No inventas.** Lo que la fuente no resuelve va a la sección de pendientes que digan las reglas del proyecto (por defecto `## Pendiente de confirmar` del doc afectado), con la pregunta concreta.
- **Precedencia:** la que digan las reglas del proyecto. Por defecto: norma legal > fuente que las reglas marquen como norma > doc existente > código.
- **Describe qué y por qué**, no dónde vive en la fuente (celdas, líneas, nombres internos), salvo que las reglas pidan trazabilidad.
- **Sin git o con git, igual:** no haces commit, push, ramas ni stash. No lo ofreces.
- **Agentes:** solo `lector` y `revisor-doc`, uno a la vez, siempre con `run_in_background: false`. Cada uno recibe solo su plantilla; nunca la conversación.
- **Preguntas:** solo con AskUserQuestion, a lo más **una ronda por corrida** (fase 0), de 2–4 preguntas, cada una con la opción recomendada primero y marcada «(Recomendado)». No preguntas lo que ya está en las reglas del proyecto, el mapa, la memoria o el repo. Lo que siga ambiguo va como «Supuesto» en la ficha.
- **Progreso:** una línea por paso («Ficha OK», «lector → <tema>…», «revisor-doc: APROBADO»).

## Mapa de cobertura

`.claude/documentar/cobertura.md`. Si no existe, lo creas en la primera corrida que lo necesite. Formato:

```
# Cobertura de documentación

| Tema | Fuentes | Doc § | Estado | Fecha |
|---|---|---|---|---|
| <tema> | <rutas o carpetas> | <ARCHIVO.md § Sección> | pendiente · en curso · leído · dudoso | AAAA-MM-DD |

## Fichas

### <tema> — AAAA-MM-DD
Objetivo: … · Audiencia: … · Fuentes: … · Destino: … · Fuera de alcance: … · Supuestos: …
```

Estados: `pendiente` (no tocado), `en curso` (ficha aprobada, sin cerrar), `leído` (doc escrita y revisada), `dudoso` (quedó con pendientes abiertos).

## Pasos

**0. Preflight**
- Pedido vacío → responde `Uso: /documentar consultar <duda> | <tema> [--directo] [--profundo] | auditar <archivo.md> [--profundo] | siguiente | estado` y termina.
- `SIN REGLAS` → una ronda de AskUserQuestion para crear `.claude/documentar.md`: qué `.md` de la raíz son doc válida, qué se excluye, qué fuentes hay y cuáles son solo lectura, y qué manda si chocan. Antes de preguntar, propón valores leídos del repo (Glob `*.md` en la raíz, carpetas de primer nivel, CLAUDE.md, memoria). Escríbelo con el formato de la plantilla de abajo y sigue con el pedido. Esta ronda cuenta como la única de la corrida si el modo es `consultar` o `estado`.

**1. Modo**

- **`consultar <duda o idea>`** — respondes, aclaras y recomiendas: estructura, dónde iría, qué falta, riesgos de duplicar. Lees solo encabezados de la doc y el mapa. No escribes nada (salvo el paso 0), no lanzas agentes. Si la respuesta necesita una fuente grande, lo dices y propones `/documentar <tema>`. Cierra con «Siguiente paso sugerido: …».
- **`estado`** — lee el mapa (o, si no existe, créalo: lista los temas que salen de los encabezados de la doc válida y de las fuentes de las reglas del proyecto, todos `pendiente`, sin leer las fuentes). Muestra un resumen: cuántos por estado, los `dudoso` y el siguiente `pendiente`. No escribe doc.
- **`auditar <archivo.md>`** — verifica y refina doc que ya existe, sección por sección, contra sus fuentes. Ve a «Auditar» (abajo); no usa los pasos 2 a 6.
- **`siguiente`** — toma el primer `en curso` del mapa (o, si no hay, el primer `pendiente`) y sigue como `<tema>`.
- **`<tema>`** — pasos 2 a 6. Con `--directo`, salta el paso 2 si el mapa ya tiene la ficha del tema o el tema es inequívoco; si no, haz el paso 2 igual y dilo. Si saltas el paso 2 sin ficha guardada, escribe tú una ficha mínima en el mapa (sin preguntar) antes de despachar agentes.

**2. Ficha (fase 0)**
- Lee el mapa, los encabezados de la doc válida y las reglas del proyecto. Nada de fuentes todavía.
- Una ronda de AskUserQuestion con 2–4 de estas preguntas, solo las que no se deducen: objetivo y audiencia; alcance (qué entra y qué queda fuera); destino (sección existente, sección nueva o archivo nuevo en la raíz); qué fuente manda si chocan.
- En el mismo mensaje, antes de las preguntas: responde las dudas que trajo el pedido y da tus recomendaciones (estructura, huecos que ves, riesgo de duplicar otra sección).
- Muestra la ficha (6–8 líneas: Tema, Objetivo, Audiencia, Fuentes, Destino, Fuera de alcance, Supuestos) y pide OK con AskUserQuestion: «¿Apruebas la ficha?», opciones «Aprobar» y «Cancelar»; los ajustes llegan por «Other». Se puede unir con la ronda anterior si ya no hay dudas.
- Aprobada → guárdala en el mapa con estado `en curso`.

**3. Lectura**
- Fuentes cortas (< ~300 líneas en total): las lees tú.
- Si no, `lector` (plantilla abajo). Con fuente densa (fórmulas, macros, lógica de negocio con redondeos, fechas o dinero, normas legales) o si las reglas del proyecto lo piden, despáchalo con `model: "sonnet"` y `effort: "medium"`; si no, sin `model` ni `effort`. Si el tema cruza varias fuentes independientes, un lector por fuente, uno a la vez.
- Si el reporte trae DUDAS que cambian el destino o el alcance: no hagas otra ronda de preguntas; anótalas como pendientes en la doc.

**4. Escritura**
- Edita con `Edit` por sección. `Write` solo para un archivo nuevo acordado en la ficha.
- Sigue el estilo del archivo destino: idioma, tono, nivel de encabezados, tablas, formato de enlaces.
- Antes de crear una sección, Grep del concepto en toda la doc válida: si ya está en otro archivo, enlaza en vez de duplicar.
- Pendientes a la sección que digan las reglas, con la pregunta concreta y a quién va.

**5. Revisión** — `revisor-doc` (plantilla abajo). Con `--profundo`, `model: "opus"` y `effort: "medium"`; si no, sin `model` ni `effort`.
- APROBADO → paso 6.
- RECHAZADO → corriges tú exactamente los PROBLEMAS y vuelves a revisar. Máximo **1 ciclo**; un segundo rechazo → cierras como DETENIDO con los problemas listados.

**6. Cierre**
- Actualiza el mapa: estado (`leído`, o `dudoso` si quedaron pendientes), fecha y Doc §.
- Responde solo esto:

```
CIERRE · <tema> — COMPLETO | DETENIDO
Doc: <ARCHIVO.md § Sección — qué cambió, una línea c/u>
Pendientes: <preguntas abiertas | ninguno>
Revisión: <APROBADO (0|1 ciclo) | RECHAZADO: …>
Mapa: <n leído · n dudoso · n pendiente> · siguiente: <tema | ninguno>
```

## Auditar

Para doc que ya está escrita: no se redacta de nuevo, se comprueba contra la fuente y se corrige solo lo que difiere. En el mapa, cada sección auditada es una fila con Tema = `ARCHIVO.md § Sección`.

**A1. Plan de auditoría** (sin lector todavía)
- El archivo debe estar en la doc válida de las reglas del proyecto; si no, dilo y termina.
- Grep de encabezados `^#{2,3} ` del archivo. Lee el mapa: las secciones ya `leído` se saltan (salvo que el pedido diga «todo» o la fuente haya cambiado según `git log`).
- Asigna a cada sección pendiente una **fuente** desde «Fuentes» de las reglas y el mapa, y un **tipo**:
  - `con fuente`: afirma reglas que una fuente puede confirmar → va al lector.
  - `solo coherencia`: sin fuente externa (diseño, arquitectura, instrucciones de uso) → solo se revisa contra el resto de la doc, sin lector.
- Muestra una tabla `Sección | Fuente | Tipo` y el tope de la corrida (abajo). Un solo AskUserQuestion: «¿Apruebas el plan de auditoría?», opciones «Aprobar» y «Cancelar»; ajustes (excluir una sección, cambiar la fuente) por «Other». Es la única ronda de preguntas de la corrida. Aprobada → filas en el mapa como `en curso`.
- **Tope:** como máximo **5 despachos de lector** por corrida, agrupando secciones que comparten fuente en un solo despacho. Lo que no entre queda `pendiente` y se retoma con el mismo comando.

**A2. Lectura** — por grupo de secciones, uno a la vez:
- Lees tú cada sección por tramos (`offset`/`limit`) y extraes sus afirmaciones verificables (reglas, números, orden de pasos, excepciones) en ≤ 8 líneas por sección.
- `lector` con la plantilla de despacho: TEMA = el grupo, FICHA = «auditar: confirmar o contradecir cada afirmación», BUSCA = una pregunta por afirmación («¿la fuente dice X?»), DOC ACTUAL = esas afirmaciones. Fuente densa o `--profundo` → `model: "sonnet"`, `effort: "medium"`.
- Las secciones `solo coherencia` se comprueban tú con Grep de sus términos clave en el resto de la doc válida.

**A3. Corrección mínima**
- Edita **solo lo que el lector contradice**, con `Edit` sobre la frase o fila afectada. No reformules, reordenes ni «mejores» lo demás.
- Aplica la precedencia de las reglas del proyecto. Si la fuente contradice a la doc pero la doc podría estar siguiendo una norma que manda sobre esa fuente (p. ej. una ley), **no cambies nada**: va a pendientes con la pregunta concreta.
- Lo que la fuente no confirma ni contradice (DUDAS del lector) tampoco se cambia: queda como está y se anota en pendientes solo si es una regla de fondo; si no, se deja `dudoso` en el mapa.
- Duplicados o términos distintos para lo mismo que encuentres: unifica al término más usado o enlaza; no rehagas secciones.

**A4. Revisión y cierre**
- Un solo `revisor-doc` al final sobre todos los cambios de la corrida (plantilla de despacho; FICHA = «auditoría de ARCHIVO.md», CAMBIOS = cada sección editada). Mismo ciclo máximo que el paso 5. Si no hubo ediciones, sin revisión.
- Mapa: cada sección auditada pasa a `leído` (sin diferencias o corregida) o `dudoso` (quedó pendiente); Fecha de hoy.
- Responde solo esto:

```
AUDITORÍA · <ARCHIVO.md> — COMPLETA | PARCIAL (n secciones pendientes)
Corregido: <ARCHIVO.md § Sección — qué difería, una línea c/u | nada>
Sin diferencias: <n secciones>
Pendientes: <preguntas abiertas | ninguno>
Revisión: <APROBADO (0|1 ciclo) | RECHAZADO: … | sin ediciones>
Mapa: <n leído · n dudoso · n pendiente> · siguiente: <comando sugerido | ninguno>
```

## Plantillas de despacho

Llena los `<…>` y no agregues nada más.

**Lector** — `subagent_type: "lector"`, `description: "Leer <tema>"`
```
TEMA: <tema>
FICHA: <objetivo, alcance y fuera de alcance, de la ficha>
FUENTES: <rutas o carpetas exactas>
BUSCA: <3–6 preguntas concretas que la doc debe responder>
DOC ACTUAL: <resumen de 3–8 líneas de lo que ya dice la doc sobre el tema | nada>
REGLAS: <las de lectura de las reglas del proyecto: solo lectura, precedencia, qué no citar | ninguna>
```

**Revisor de doc** — `subagent_type: "revisor-doc"`, `description: "Revisar doc <tema>"`
```
TEMA: <tema>
FICHA: <la ficha aprobada>
CAMBIOS: <ARCHIVO.md § Sección, uno por línea>
DOC VÁLIDA: <lista de .md de la raíz que cuentan>
REGLAS: <reglas de escritura del proyecto: precedencia, qué no citar, dónde van pendientes | ninguna>
HECHOS DEL LECTOR: <REGLAS del reporte del lector, literales | leído directo>
```

## Plantilla de `.claude/documentar.md`

```
# Reglas de /documentar

## Doc válida
- <ARCHIVO.md — de qué trata>

## Excluidos
- <archivos o carpetas que no se leen ni se tocan>

## Fuentes
- <ruta — qué es — solo lectura sí/no — densa sí/no (lector en Sonnet)>

## Precedencia
- <qué manda si chocan>

## Escritura
- <qué no citar, idioma, dónde van los pendientes, otras convenciones>
```

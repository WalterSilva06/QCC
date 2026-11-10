`.claude/qcc-implementador/` o, sin ella, `.claude/qcc-implementador.md` (reglas del proyecto; el nombre viejo `.claude/implementador/` o `.claude/implementador.md` vale de respaldo) y el `CLAUDE.md` del proyecto mandan sobre este archivo.

## 2. Clasificación

CRÍTICO si se cumple **cualquiera** (cita los números en el plan; si no aplica ninguno, escribe «sin criterios»). Ante la duda, CRÍTICO. Las rutas y ejemplos concretos de cada criterio están en las reglas del proyecto y en `criticos` de `.claude/qcc-implementador.json`, si existen; al guardar el plan, `estado.mjs` avisa si una ruta de `criticos` queda sin citar.

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
Fuera de alcance: <lo que no se toca, con el motivo de cada ítem>
Base: <rama>@<HEAD> · sucios previos: <lista | ninguno> · verificación inicial: VERDE | ROJA (<qué falla>) | SIN PASOS

S1 · <objetivo de la subtarea>
- Crítica: sí (#n) | no — <por qué, una línea>
- Depende de: ninguna | S<n>, S<m>   (en cada subtarea desde S2; sin él, depende de la anterior y serializa)
- Archivos permitidos: <rutas exactas, relativas a la raíz del repo, separadas por coma, todas en una sola línea; la explicación de una ruta, entre paréntesis, sin frases ni viñetas; glob solo para archivos nuevos; «(generado)» para lo que cambia solo con el build o una herramienta>
- Cómo: <el arreglo en 1–2 líneas: ruta:línea, función y qué cambia, de la EXPLORACIÓN o de lo que leíste; sin bloques de código>   (opcional; omítelo si no lo sabes sin leer más)
- Hecho cuando: <comando → resultado, o comportamiento que un test comprueba>
- Tests: <existentes que lo cubren | nuevos (ruta)>, uno por cada camino público que el cambio toca (de unidad y, si el repo tiene infraestructura, de integración) · sin tests: <cómo se verifica y qué queda manual>
- Riesgos: <qué puede romper> → <mitigación>; lo no confirmado, primero y con «comprobar primero: <comando o lectura>»
- Reversión: <nuevos a borrar · modificados a restaurar desde la base de S1>

S2 · …

PERMISOS A APROBAR:   (opcional; omite el bloque si ningún comando lo necesita)
  P1 · ejecutor S<n> | orquestador · `<comando exacto>` · <servicio> · reversible: sí | no
     Qué hace: <qué hace el comando, 1 línea>
     Para qué: <por qué lo necesita el plan, 1 línea>
Verificación final: verificar.mjs + revisión final (siempre)
Queda para ti: <lo que ni aprobado puede correr un agente: acciones que exigen al usuario, verificación visual, … | nada>; lo que es un comando, como `! <comando>  # [(objetivo)] requiere <permiso, red…>`
Costo: <n> ejecutor(es) · revisión final
```

- `Crítica: sí` si la subtarea toca algo de un criterio de §2, de `criticos` o de las reglas del proyecto; `no` solo si todo lo que toca es UI, textos, estilos o documentación sin criterio. Ante la duda, `sí`. Con Clasificación «sin criterios», todas `no`. No hay revisor por subtarea: la revisión final mira primero lo crítico.
- `Depende de`: va en cada subtarea desde S2; sin el campo, la subtarea depende de la anterior y corre después de ella, así que omitirlo serializa. Decídelo para que corran a la vez las que no se necesitan: una necesita a otra si usa su código, sus tipos, sus datos o sus tests. Si no necesita ninguna y sus archivos permitidos no se pisan con los de otra (un archivo dentro de una carpeta o glob de otra también se pisa), `Depende de: ninguna`. Si necesita solo algunas, nómbralas (`Depende de: S<n>, S<m>`, solo anteriores): dos que dependen solo de S1 corren juntas después de ella. `estado.mjs` arma los lotes por ondas: cada subtarea va al primer lote con menos de 4 miembros posterior a los lotes de sus dependencias (o de la anterior, si falta el campo) y a los de toda subtarea anterior con la que se pisan sus permitidos; una sin permitidos, o con uno dudoso, hace de barrera. No hace falta ponerlas seguidas: una independiente corre en la onda que le toca aunque otras la separen en el plan. No partas ni juntes subtareas para paralelizar: el corte sigue las reglas de abajo. Entre dos cortes igual de naturales, elige el que deja permitidos que no se pisan; el desempate solo elige entre cortes ya válidos. Ante la duda sobre una dependencia, cuéntala. Si la dependencia son datos que una escribe y otra lee, aplica la regla `Contrato de datos` de abajo.
- Cobertura del pedido: cada pedido concreto (cada frase del pedido que pide algo) termina en al menos un «Hecho cuando» de alguna subtarea o en «Fuera de alcance» con su motivo; ninguno queda sin destino. Si el pedido llega cortado o es ambiguo en un punto, ese punto va en `PREGUNTAS` con tu supuesto, no como supuesto silencioso dentro del plan. Si el pedido es aplicar un documento (plan, especificación), cada regla, valor y prueba que el documento fija cuenta como frase del pedido.
- Alcance: el plan cubre el pedido entero y no tiene tope de subtareas (el ~6 de abajo es por fusión). Si el pedido apunta a un documento con fases o partes, el plan cubre todas, salvo las que el pedido excluya o nombre aparte. Nunca lo acotas por tamaño ni ofreces un corte en `PREGUNTAS` («solo la Fase 0», «el resto en otro /impl»): un plan grande es más subtareas y lotes, y el usuario decide al aprobarlo.
- Tests que fijan un valor: una subtarea que cambia una constante, una tabla, una lista o un valor por defecto lleva en sus permitidos los tests que lo comprueban (búscalos con Grep por el nombre y por el valor literal, p. ej. `30`), también si solo agrega elementos a la lista. Así el ejecutor no se bloquea pidiendo alcance a mitad de la ejecución.
- Contrato de datos: si una subtarea escribe datos que otra lee (un archivo de estado, un formato, un campo), el escritor y el lector van en la misma subtarea. Si se parten igual, la subtarea que lee lleva en «Hecho cuando» un test de punta a punta que usa lo que realmente produce la que escribe (su salida real), no un dato armado a mano.
- Subtareas pequeñas: ≤ 3 archivos de código más sus tests y ~150 líneas cambiadas estimadas, cada una verificable sola, en orden de dependencia (migración → tipos → servidor → UI). Las que cambian menos de ~50 líneas y comparten capa o archivos van juntas, hasta ~6 subtareas por fusión. Una fusión no pasa de ~150 líneas cambiadas estimadas, y una subtarea que ya pasa de ese tamaño se parte. Lo que toca los criterios #1, #2 o #4 (seguridad, auth, permisos, datos, esquema) no se fusiona con otra cosa. La documentación de un cambio va en los permitidos de la subtarea que lo cambia; una subtarea aparte de documentación queda solo para docs transversales que dependen de varias subtareas, y va al final. Solo texto (todos los archivos permitidos son documentación o prompts `.md`): hasta ~10 archivos y ~150 líneas por subtarea; si son el mismo tipo de cambio y ninguno tiene que quedar aplicado antes que otro, van en una sola subtarea. Si alguno es de una ruta crítica, la subtarea entera es `Crítica: sí`. Siguen los 2 ciclos por subtarea.
- Preguntas sobre el modelo de datos: si el pedido define entidades, cantidades o dónde vive un dato (p. ej. «un texto o uno por sede»), la PREGUNTA es sobre ese modelo, con las alternativas reales, no sobre la precedencia dentro de un modelo ya supuesto.
- «Hecho cuando» con Grep: solo ausencia («0 coincidencias de <texto viejo> en <rutas>») o presencia («≥ 1 en <archivo>»), nunca un conteo exacto, y con un patrón que no coincida con texto que la subtarea no toca (pruébalo con Grep sobre el árbol actual).
- Un supuesto técnico que no pudiste confirmar leyendo (cómo se comporta una API, un motor de tests, un tipo externo) va en Riesgos con «comprobar primero»: el ejecutor lo comprueba antes de editar el resto y, si falla, se detiene.
- Lo que no está en «Archivos permitidos» no se toca. Las migraciones ya versionadas no se editan: se crea una nueva con la convención de nombres del proyecto. Si hay migración, la Reversión aclara que, aplicada a una base viva, revertirla exige otra migración.
- Sin tests: la lógica de negocio los escribe primero, con la infraestructura de tests del proyecto. Lo que no tiene infraestructura de tests (típicamente la UI) se verifica con typecheck y build.
- Si una regla externa (hook, plugin o CLAUDE.md) pide el cambio mínimo, ese criterio se aplica al código y nunca a los tests que el plan pide: cada camino público lleva su test igual.
- Una dependencia nueva va nombrada en el plan: la instala el orquestador antes del `--base --sub` de la subtarea que la usa, y esa subtarea lleva en sus permitidos el manifiesto y el lockfile (los cambia el orquestador, no el ejecutor; así el alcance no los marca fuera).
- Borrar carpetas o archivos en bloque (borrado recursivo) no es subtarea: la guardia lo niega al ejecutor. Va a «Queda para ti» con el comando exacto.
- Una subtarea que mueve código (lo pasa de un archivo a otro sin cambiarlo) pide en «Hecho cuando» la copia mecánica (`cp` desde una copia generada en el temporal) y su comparación de líneas contra la base, para que el ejecutor no retranscriba el código a mano.
- Tests E2E y de flujos con Playwright o `playwright-cli`: los corre el ejecutor y van en «Hecho cuando» (con el comando y el resultado), no en `PERMISOS A APROBAR` ni en «Queda para ti». La app la levanta el `webServer` de la config de Playwright; un servidor de desarrollo directo (`pnpm dev`…) sigue fuera del ejecutor: lo levanta el orquestador, con un permiso `orquestador` en `PERMISOS A APROBAR`.
- En «Queda para ti», los comandos de los que depende el objetivo del plan (sin su resultado no se puede dar el objetivo por cumplido: un build contra un servicio que un agente no puede correr ni aprobado) llevan `(objetivo)` al inicio del comentario: `! <comando>  # (objetivo) requiere <…>`. Antes de la revisión final el orquestador ofrece al usuario correrlos, para que la revisión contraste el resultado. Los demás comandos no llevan la marca. No marques `(objetivo)` lo que es comodidad, limpieza o verificación visual. Un comando que sí puede correr un agente con aprobación (una migración, regenerar tipos) va a `PERMISOS A APROBAR`, no aquí.
- `PERMISOS A APROBAR` lista cada comando que la guardia negaría y que el plan necesita (aplicar migraciones, regenerar tipos, deploys, servicios vivos, un servidor de desarrollo, lo que pide «Hecho cuando»), aunque el pedido no los nombre y aunque las reglas del proyecto los dejen «para el usuario» o en «Queda para ti» (son de antes de los permisos; comun.md, inicio): cada uno con su comando exacto, `Qué hace` y `Para qué`. Propón solo los necesarios: muchos permisos invitan a aprobar sin leer. El usuario aprueba el bloque con el plan; solo lo aprobado pasa, y solo para el ejecutor de esa subtarea (o el orquestador).
  - Campos obligatorios: id (`P<n>`), quién (`ejecutor S<n>` u `orquestador`), comando entre comillas invertidas, servicio, `reversible: sí | no`, `Qué hace` y `Para qué`. Sin `reversible`, cuenta como no, y cada permiso `reversible: no` se aprueba en su propia pregunta. No existe el rol `revisor`.
  - Comodín: `*` vale para cualquier argumento (cruza palabras) pero solo después de una parte literal: el programa y su primer argumento que no es opción son literales, y ninguna palabra lleva `*` hasta esa posición. Con `exec`, `dlx`, `x` o `run` de un gestor, también el argumento siguiente es literal; con `node`, el script. Un comando que no lo cumple no se puede aprobar: `pnpm *`, `node *`, `node scripts/*` y `pnpm exec *` quedan fuera. Usa `*` solo donde cualquier valor sea aceptable.
  - Se niega siempre, aun aprobado: `git` que escribe, destinos de escritura protegidos (`.claude/settings*.json`, `.git/`, secretos, fuera del repo), `.env` y secretos del proyecto, `curl … | sh`, `iex (irm …)`, `format`, `diskpart`, `mkfs` y `estado.mjs` con `--permiso`, `--permiso-nuevo`, `--aprobado`, `--base`, `--cambios`, `--guardar`, `--cancelar`, `--tanda` o `--reanudar`. No los propongas.
  - Descargar de internet al repo (fotos, fuentes, datos): el ejecutor solo lee de la red (`curl`, `wget`, `iwr`, `irm` en GET o HEAD, salida a un temporal) y escribe en el repo con Edit o Write, así que va a «Queda para ti» con las URL y la ruta donde dejar cada archivo, y la subtarea que lo usa lo da por presente.

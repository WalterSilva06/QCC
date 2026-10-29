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
- Depende de: ninguna | S<n>, S<m>   (desde S2; sin él, depende de la anterior)
- Archivos permitidos: <rutas exactas, relativas a la raíz del repo; glob solo para archivos nuevos; «(generado)» para lo que cambia solo con el build o una herramienta>
- Hecho cuando: <comando → resultado, o comportamiento que un test comprueba>
- Tests: <existentes que lo cubren | nuevos (ruta)> · sin tests: <cómo se verifica y qué queda manual>
- Riesgos: <qué puede romper> → <mitigación>; lo no confirmado, primero y con «comprobar primero: <comando o lectura>»
- Reversión: <nuevos a borrar · modificados a restaurar desde la base de S1>
- Externo: <comando o patrón exacto> · contra <servicio> · reversible: sí | no   (opcional; solo si el pedido pide correr algo externo)

S2 · …

Verificación final: verificar.mjs + revisión final (siempre)
Queda para ti: <migraciones a aplicar, regenerar tipos, deploys, verificación visual, … | nada>; lo que es un comando, como `! <comando>  # [(objetivo)] requiere <permiso, red…>`
Costo: <n> ejecutor(es) · revisión final
```

- `Crítica: sí` si la subtarea toca algo de un criterio de §2, de `criticos` o de las reglas del proyecto; `no` solo si todo lo que toca es UI, textos, estilos o documentación sin criterio. Ante la duda, `sí`. Con Clasificación «sin criterios», todas `no`. No hay revisor por subtarea: la revisión final mira primero lo crítico.
- `Depende de`: sin el campo, la subtarea depende de la anterior y corre después de ella. Desde S2, decídelo en cada subtarea para que corran a la vez las que no se necesitan: una necesita a otra si usa su código, sus tipos, sus datos o sus tests. Si no necesita ninguna y sus archivos permitidos no se pisan con los de otra (un archivo dentro de una carpeta o glob de otra también se pisa), `Depende de: ninguna`. Si necesita solo algunas, nómbralas (`Depende de: S<n>, S<m>`, solo anteriores) en vez de omitir el campo: dos que dependen solo de S1 corren juntas después de ella. `estado.mjs` junta en un lote, hasta 3 y corriendo a la vez, solo subtareas seguidas que no dependen unas de otras, así que pon seguidas las independientes sin romper el orden de dependencia. No partas ni juntes subtareas para paralelizar: el corte sigue las reglas de abajo. Ante la duda sobre una dependencia, cuéntala. Si la dependencia son datos que una escribe y otra lee, aplica la regla `Contrato de datos` de abajo.
- Cobertura del pedido: cada pedido concreto (cada frase del pedido que pide algo) termina en al menos un «Hecho cuando» de alguna subtarea o en «Fuera de alcance» con su motivo; ninguno queda sin destino. Si el pedido llega cortado o es ambiguo en un punto, ese punto va en `PREGUNTAS` con tu supuesto, no como supuesto silencioso dentro del plan.
- Contrato de datos: si una subtarea escribe datos que otra lee (un archivo de estado, un formato, un campo), el escritor y el lector van en la misma subtarea. Si se parten igual, la subtarea que lee lleva en «Hecho cuando» un test de punta a punta que usa lo que realmente produce la que escribe (su salida real), no un dato armado a mano.
- Subtareas pequeñas: ≤ 4 archivos de código más sus tests, cada una verificable sola, en orden de dependencia (migración → tipos → servidor → UI). Las que cambian menos de ~50 líneas y comparten capa o archivos van juntas, con un máximo de ~6 subtareas. Una fusión no pasa de ~300 líneas cambiadas estimadas, y una subtarea que ya pasa de ese tamaño se parte. Lo que toca los criterios #1, #2 o #4 (seguridad, auth, permisos, datos, esquema) no se fusiona con otra cosa. La documentación de un cambio va en los permitidos de la subtarea que lo cambia; una subtarea aparte de documentación queda solo para docs transversales que dependen de varias subtareas, y va al final. Solo texto (todos los archivos permitidos son documentación o prompts `.md`): hasta ~10 archivos por subtarea; si son el mismo tipo de cambio y ninguno tiene que quedar aplicado antes que otro, van en una sola subtarea. Si alguno es de una ruta crítica, la subtarea entera es `Crítica: sí`. Siguen los 2 ciclos por subtarea.
- Preguntas sobre el modelo de datos: si el pedido define entidades, cantidades o dónde vive un dato (p. ej. «un texto o uno por sede»), la PREGUNTA es sobre ese modelo, con las alternativas reales, no sobre la precedencia dentro de un modelo ya supuesto.
- «Hecho cuando» con Grep: solo ausencia («0 coincidencias de <texto viejo> en <rutas>») o presencia («≥ 1 en <archivo>»), nunca un conteo exacto, y con un patrón que no coincida con texto que la subtarea no toca (pruébalo con Grep sobre el árbol actual).
- Un supuesto técnico que no pudiste confirmar leyendo (cómo se comporta una API, un motor de tests, un tipo externo) va en Riesgos con «comprobar primero»: el ejecutor lo comprueba antes de editar el resto y, si falla, se detiene.
- Lo que no está en «Archivos permitidos» no se toca. Las migraciones ya versionadas no se editan: se crea una nueva con la convención de nombres del proyecto. Si hay migración, la Reversión aclara que, aplicada a una base viva, revertirla exige otra migración.
- Sin tests: la lógica de negocio los escribe primero, con la infraestructura de tests del proyecto. Lo que no tiene infraestructura de tests (típicamente la UI) se verifica con typecheck y build.
- Una dependencia nueva va nombrada en el plan: la instala el orquestador antes del `--base --sub` de la subtarea que la usa, y esa subtarea lleva en sus permitidos el manifiesto y el lockfile (los cambia el orquestador, no el ejecutor; así el alcance no los marca fuera).
- Borrar carpetas o archivos en bloque (borrado recursivo) no es subtarea: la guardia lo niega al ejecutor. Va a «Queda para ti» con el comando exacto.
- Una subtarea que mueve código (lo pasa de un archivo a otro sin cambiarlo) pide en «Hecho cuando» la copia mecánica (`cp` desde una copia generada en el temporal) y su comparación de líneas contra la base, para que el ejecutor no retranscriba el código a mano.
- En «Queda para ti», los comandos de los que depende el objetivo del plan (sin su resultado no se puede dar el objetivo por cumplido: una migración que el objetivo exige aplicada, un build contra un servicio) llevan `(objetivo)` al inicio del comentario: `! <comando>  # (objetivo) requiere <…>`. Antes de la revisión final el orquestador ofrece al usuario correrlos, para que la revisión contraste el resultado. Los demás comandos no llevan la marca. No marques `(objetivo)` lo que es comodidad, limpieza o verificación visual.
- `Externo` es opcional: solo lo lleva una subtarea cuyo comando externo el pedido pide correr de forma expresa (el usuario lo aprueba antes de ejecutar). Pon el comando o patrón exacto, el servicio y si es reversible; sin `reversible`, cuenta como no, y cada subtarea `reversible: no` se aprueba en su propia pregunta. En el comando, `*` vale para cualquier argumento (cruza palabras) y un comando que coincide queda eximido de las revisiones de destino de `cp` y `mv` y del `rm -r`: usa `*` solo donde cualquier valor sea aceptable. Lo externo que el pedido no pide (aplicar migraciones, regenerar tipos, deploys, servicios vivos, verificación visual) sigue yendo a «Queda para ti». También descargar de internet (fotos, fuentes, datos): los subagentes no tienen red, así que va a «Queda para ti» con las URL y la ruta donde dejar cada archivo, y la subtarea que lo usa lo da por presente.

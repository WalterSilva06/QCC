`.claude/implementador/` o, sin ella, `.claude/implementador.md` (reglas del proyecto) y el `CLAUDE.md` del proyecto mandan sobre este archivo.

## 2. Clasificación

CRÍTICO si se cumple **cualquiera** (cita los números en el plan; si no aplica ninguno, escribe «sin criterios»). Ante la duda, CRÍTICO. Las rutas y ejemplos concretos de cada criterio están en las reglas del proyecto y en `criticos` de `.claude/implementador.json`, si existen; al guardar el plan, `estado.mjs` avisa si una ruta de `criticos` queda sin citar.

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
- Archivos permitidos: <rutas exactas, relativas a la raíz del repo; glob solo para archivos nuevos; «(generado)» para lo que cambia solo con el build o una herramienta>
- Hecho cuando: <comando → resultado, o comportamiento que un test comprueba>
- Tests: <existentes que lo cubren | nuevos (ruta)> · sin tests: <cómo se verifica y qué queda manual>
- Riesgos: <qué puede romper> → <mitigación>; lo no confirmado, primero y con «comprobar primero: <comando o lectura>»
- Reversión: <nuevos a borrar · modificados a restaurar desde la base de S1>

S2 · …

Verificación final: verificar.mjs + revisión final (siempre)
Queda para ti: <migraciones a aplicar, regenerar tipos, deploys, verificación visual, … | nada>; lo que es un comando, como `! <comando>  # requiere <permiso, red…>`
Costo: <n> ejecutor(es) · revisión final
```

- `Crítica: sí` si la subtarea toca algo de un criterio de §2, de `criticos` o de las reglas del proyecto; `no` solo si todo lo que toca es UI, textos, estilos o documentación sin criterio. Ante la duda, `sí`. Con Clasificación «sin criterios», todas `no`. No hay revisor por subtarea: la revisión final mira primero lo crítico.
- Subtareas pequeñas: ≤ 4 archivos de código más sus tests, cada una verificable sola, en orden de dependencia (migración → tipos → servidor → UI). Las que cambian menos de ~50 líneas y comparten capa o archivos van juntas, con un máximo de ~6 subtareas. Una fusión no pasa de ~300 líneas cambiadas estimadas, y una subtarea que ya pasa de ese tamaño se parte. Lo que toca los criterios #1, #2 o #4 (seguridad, auth, permisos, datos, esquema) no se fusiona con otra cosa. La documentación de un cambio va en los permitidos de la subtarea que lo cambia; una subtarea aparte de documentación queda solo para docs transversales que dependen de varias subtareas, y va al final. Solo texto (todos los archivos permitidos son documentación o prompts `.md`): hasta ~10 archivos por subtarea; si son el mismo tipo de cambio y ninguno tiene que quedar aplicado antes que otro, van en una sola subtarea. Si alguno es de una ruta crítica, la subtarea entera es `Crítica: sí`. Siguen los 2 ciclos por subtarea.
- Preguntas sobre el modelo de datos: si el pedido define entidades, cantidades o dónde vive un dato (p. ej. «un texto o uno por sede»), la PREGUNTA es sobre ese modelo, con las alternativas reales, no sobre la precedencia dentro de un modelo ya supuesto.
- «Hecho cuando» con Grep: solo ausencia («0 coincidencias de <texto viejo> en <rutas>») o presencia («≥ 1 en <archivo>»), nunca un conteo exacto, y con un patrón que no coincida con texto que la subtarea no toca (pruébalo con Grep sobre el árbol actual).
- Un supuesto técnico que no pudiste confirmar leyendo (cómo se comporta una API, un motor de tests, un tipo externo) va en Riesgos con «comprobar primero»: el ejecutor lo comprueba antes de editar el resto y, si falla, se detiene.
- Lo que no está en «Archivos permitidos» no se toca. Las migraciones ya versionadas no se editan: se crea una nueva con la convención de nombres del proyecto. Si hay migración, la Reversión aclara que, aplicada a una base viva, revertirla exige otra migración.
- Sin tests: la lógica de negocio los escribe primero, con la infraestructura de tests del proyecto. Lo que no tiene infraestructura de tests (típicamente la UI) se verifica con typecheck y build.
- Una dependencia nueva va nombrada en el plan: la instala el orquestador antes del `--base --sub` de la subtarea que la usa, y esa subtarea lleva en sus permitidos el manifiesto y el lockfile (los cambia el orquestador, no el ejecutor; así el alcance no los marca fuera).
- Borrar carpetas o archivos en bloque (borrado recursivo) no es subtarea: la guardia lo niega al ejecutor. Va a «Queda para ti» con el comando exacto.
- Lo externo (aplicar migraciones, regenerar tipos, deploys, servicios vivos, verificación visual) nunca es subtarea: va a «Queda para ti». También descargar de internet (fotos, fuentes, datos): los subagentes no tienen red, así que va a «Queda para ti» con las URL y la ruta donde dejar cada archivo, y la subtarea que lo usa lo da por presente.

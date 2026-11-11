# Plan de mejoras de /impl (a partir de las corridas de la 0.5.1)

Origen: análisis de las 6 corridas de `horaki-sas` hechas con impl 0.5.1 (commit `838c2c7`): `154658` y `222349` (canceladas), `000204`, `002637`, `011249` y `034449` (completas). Tres agentes Opus medium las revisaron: tandas 1 y 2, tandas 3 y 4, y un análisis transversal.

Un segundo análisis (tres agentes Opus medium, uno por ángulo: velocidad, calidad y coste, sobre las 4 corridas completas y las 2 canceladas) añadió los puntos 20 a 28 y reforzó los puntos 2, 7, 11, 12 y 17. Sus cifras salen de los registros y los transcripts; el reparto del coste por agente usa precios de lista supuestos.

Las citas de líneas y los datos vienen de esos informes. Lo marcado «a verificar» es inferencia que nadie confirmó. Antes de cambiar un archivo, abrirlo y comprobar que la cita sigue siendo cierta.

## Prioridad alta: la revisión y los riesgos

### 1. La revisión final deja pasar defectos reales como OBSERVACIONES
- **Evidencia:** en `000204` el ejecutor de S8 escribió en BLOQUEOS que la alerta se duplica en cada reintento y `revision-1.md` dijo «S8 ok». En `011249` quedaron como observación el conteo doble de `silenciadas=`, el `any` de `bloqueoMut` y el email que no se puede vaciar. Eso costó una corrida entera (`034449`) para arreglarlos.
- **Cambios:**
  - `qcc-implementador/agents/qcc-revisor.md` («Rechaza solo por defectos concretos» y la línea «No rechaces por estilo…»): un defecto que introdujo el cambio, aunque sea menor, o un riesgo que deja al usuario sin salida (carga infinita, alertas duplicadas), va a PROBLEMAS, no a OBSERVACIONES. Cada BLOQUEO de `EJECUTORES` que describe un defecto se comprueba y termina en PROBLEMAS o en CRITERIOS con evidencia; ajustar el paso 6 («`EJECUTORES` … úsalo como pista, no como evidencia») para que diga eso. La línea «No rechaces por estilo» se queda: lo menor que no es defecto sigue en OBSERVACIONES.
  - `qcc-implementador/herramientas/comun.md` §5 (plantilla de la revisión final, línea `EJECUTORES`): hoy la nota es «≤ 12 palabras de sus BLOQUEOS u observaciones», así que el BLOQUEO de S8 llegó recortado o se perdió. Pasar los BLOQUEOS que describen un defecto o un riesgo literales (sin los de guardia, permisos ni los tests de otro miembro del lote, `qcc-ejecutor.md:74`). Ajustar también «Contexto mínimo» de §4, que dice que la revisión final no recibe los reportes, y §6 (viñeta «Con HECHO…»), donde el orquestador arma esa línea.

### 2. El plan acepta riesgos que dejan la UI sin salida, o afirma comportamiento sin comprobarlo
- **Evidencia:** `S10.md` de `002637` dice «si el reloj ya venció, el reintento corre sin reloj; se acepta» (carga infinita posible). En `034449` el plan afirmó «Queda "Volver a iniciar sesión" siempre visible (:247)» sin marcarlo «comprobar primero». El ejecutor escribió un e2e que afirma el giro infinito y el «passed» validó el defecto (rechazo de S6).
- **Cambios en `qcc-implementador/herramientas/plan.md`:**
  - Un riesgo que deje la UI en un estado sin salida no se puede aceptar.
  - La regla de «comprobar primero» se extiende a todo riesgo cuya mitigación supone un comportamiento actual de la UI, sobre todo si salió de la EXPLORACIÓN (en `034449` el explorador anotó «`callback.tsx:247` — Volver a iniciar sesión, siempre visible» y era falso).
  - «Hecho cuando»: en errores, cargas y reintentos, afirmar el estado final visible (qué ve el usuario y qué salida tiene), no solo la ausencia del estado malo. En S6 de `034449` el criterio era «no aparece el error sin el botón» y el e2e pasaba con la pantalla cargando para siempre.
  - Si un test guardián impide el arreglo correcto, va a PREGUNTAS, no a un riesgo aceptado. En S10 de `002637` el plan aceptó «el reintento corre sin reloj» por no poder agregar otro `setTimeout`, y ese riesgo fue la tarea de `034449` y su rechazo.

### 3. Deploys y migraciones corren antes de la revisión final
- **Evidencia:** en `011249`, `db:push` (irreversible) y el deploy corrieron dentro de S3 y S4. El revisor escribió «No revisé: la migración y el deploy en vivo». Un defecto del select de 1 h quedó desplegado.
- **Cambios:**
  - `plan.md` §3 (bloque `PERMISOS A APROBAR` y «Campos obligatorios»): un deploy lleva un quién nuevo, `post-revisión`. Un `db:push` también, salvo que otra subtarea o la verificación lo necesite aplicado (tipos generados, tests contra la base): entonces sigue en su subtarea, `reversible: no`. Hacer que la subtarea dependa de todas las demás no sirve: sigue corriendo antes de la revisión.
  - Quién lo corre: el orquestador, en la sesión principal, donde `guardia.mjs` no actúa (decide por `agent_type`, `guardia.mjs:7`): solo vale el prompt y los permisos de Claude Code. Por eso, solo con cierre COMPLETO y por el camino que ya existe para «Queda para ti» (`comun.md` §7, «Ejecutar»): el cierre lo lista en «Queda para ti» marcado `(aprobado)`, y después del CIERRE corre esos comandos sin volver a preguntar, tal cual el aprobado y en el orden del plan (el `db:push` antes del deploy), uno por llamada a Bash, parando al primer exit ≠ 0. Con DETENIDO, o sin aprobar, queda en «Queda para ti» como hoy. Correrlo tras el cierre evita anotar en el estado qué corrió (un `--reanudar` no puede repetirlo: el flujo ya cerró). Nunca lo de «Negado siempre».
  - `estado.mjs`: aceptar el quién nuevo en `avisosDePermisos` (:566) y en el filtro del `PARA APROBAR` (:914). `permisosDe` (:519) y `aprobarPermiso` (:2195) no miran el rol: no cambian. `guardia.mjs` no cambia: `permisosAprobados` (:1331) solo pasa los de `ejecutor`. Textos: `comun.md` §3 («Campos»), §4 («tú, únicamente servidores y túnel», :50) y §7; `pasos.md` paso 4 (última frase de «Permisos») y paso 7; `FLUJOS.md`.
  - `estado.mjs` al guardar el plan: avisar de un permiso con rol `orquestador` cuyo comando no parezca un servidor o un túnel (`dev`, `serve`, `start`, `preview`, `ngrok`, `cloudflared`…).

### 4. Un permiso con rol inválido se baja a «Queda para ti»
- **Evidencia:** en `034449` el plan propuso P1 con rol `orquestador` y `npx`. El orquestador lo movió a «Queda para ti» por su cuenta, contra la regla de `horaki` (los deploys van en PERMISOS A APROBAR, nunca en «Queda para ti»). `send-reminders` quedó sin desplegar.
- **Cambio:** `pasos.md` paso 2: si un permiso trae un rol inválido, o rol `orquestador` para algo que no es un servidor o un túnel (`estado.mjs:566` hoy lo da por válido, pero `pasos.md` paso 5 lo limita a eso; el aviso lo da el punto 3), el orquestador re-planifica una vez con el ajuste «P<n> va al ejecutor de S<m>» (o «P<n> es `post-revisión`», punto 3, si es un deploy): `--guardar … plan --ajuste` rehace los permisos del estado, el `sola` y `LOTES:`. Corregirlo solo en `AJUSTES AL PLAN` no sirve: la guardia lee el `rol` guardado en el estado y solo deja pasar los de `ejecutor` (`guardia.mjs:1331`). No lo baja a «Queda para ti» ni deja el AVISO sin resolver. Es el caso de permisos de la regla general del punto 10.

### 5. Los «Hecho cuando» aceptan «skipped»
- **Evidencia:** en `034449`, S8 aceptó «passed o skipped» y saltaron 8 de 20. S9 dio por bueno «todos skipped», sin evidencia de los tres flujos de cliente.
- **Cambio:** `plan.md` §3, regla «Tests E2E y de flujos con Playwright»: «skipped» no cuenta como hecho para lo que el pedido pide testear. Hace falta al menos un passed por ítem, y cada salto va a «Queda para ti».

## Prioridad alta: pedidos que no deberían correr el flujo

### 7. Un pedido de análisis llegó a explorar el repo entero
- **Evidencia:** `222349` («analiza todo repo… me listas mejoras») corrió `--paso 0`, despachó 21 exploradores sobre 106.442 líneas, los 21 quedaron CORTADO (contexto 93k–123k), gastó +16 % del límite de 5 h y cerró con `--cancelar --paso 2` sin guardar `exploracion.md`. `154658` se canceló bien, pero después de `--paso 0`.
- **Cambios:**
  - `pasos.md` §0, primera viñeta (junto a «Pedido vacío»): si el pedido no pide cambios (revisar, analizar, auditar, listar mejoras), decirlo y terminar sin correr `--paso 0`: `/impl` es para cambios, y el análisis se pide sin `/impl`. El orquestador no lo analiza él mismo (sería leer el repo con su contexto). `SKILL.md` no cambia: inyecta `pasos.md`.
  - `pasos.md` §1: si el código candidato no cabe en los 20 exploradores (20 × 2.000 líneas, o 20 × 1.500 si `CONTEXTO DEL PROYECTO` pasa de ~3.000 tokens, menos los exploradores de documentos), `AskUserQuestion` (header «Exploración», nunca «Plan») para acotar el área a explorar antes de despachar, en vez de acotar en silencio como dice hoy `comun.md` §5 («si el código candidato no cabe en los 20, se acota…»). Si el usuario no acota, rige ese acotado de `comun.md` §5. Acota la exploración, no el plan: no choca con «Nunca lo acotas por tamaño» de `plan.md` §3. Los topes de 2.200 líneas por explorador y 20 exploradores ya están en `pasos.md` §1 y se violaron (`222349` lanzó 21, con 379 lecturas, 250 de archivos enteros): repetirlos junto a la pregunta. Las dos canceladas gastaron 14,9M tokens (16 % de 5 h, 2 % semanal).

## Prioridad media: ejecución y lotes

### 8. Un ejecutor de lote corrió `verificar.mjs`
- **Evidencia:** S2 de `002637` lo corrió con `LOTE: S1+S2+S3+S4`. Contradice `qcc-ejecutor.md:68`. El `verificar` del orquestador salió de caché.
- **Cambio:** `guardia.mjs`: negar `verificar.mjs` a un ejecutor mientras hay una fase en paralelo abierta: una entrada de `paralelos` del estado sin `hasta`. La abren `--base --sub <lista>` (lote o correcciones en paralelo, `estado.mjs:2137`) y `--tanda <n>` con n > 1 (:2185), y la cierra `--cambios --sub|--global`; no sirve mirar `en_curso`, que una tanda sin `--sub` deja vacío. Además de la espera, una corrida cruzada con el lote marca FUERA lo que cambió mientras corría (`comun.md` §1) y dispara preguntas de alcance falsas. Una fase que queda abierta (el `--cambios` de la forma explícita, respaldo de `comun.md` §1, no la cierra: solo lo hace `--sub|--global`, :2542) dejaría sin `verificar.mjs` al ejecutor siguiente, que sí lo tiene que correr: cerrar también las abiertas en `--base --sub <n>` de una sola subtarea (`fotoDeSubtarea`, :2100) y en `--tanda 1`. Añadir test.

### 9. Un ajuste aprobado de permitidos no se aplica en el registro
- **Evidencia:** en `000204` el ajuste «S2 suma a permitidos clientes.test.ts y paywall.test.ts» no llegó a `subtareas[2].permitidos`; `--cambios` salió con «11 del plan + 0 ampliados».
- **Causa:** `--cambios` no suma solo los ampliados guardados (`estado.mjs:2289`: solo los `--permitidos` de esa llamada), y el orquestador no los pasó. La guardia no mira permitidos: el efecto es un FUERA falso o un alcance mal medido.
- **Cambio:** `estado.mjs --aprobado`: un flag explícito `--sumar "S<n>:<ruta>,<ruta>;S<m>:…"` (no leer el texto libre de `--ajustes`, que es frágil) que agrega esas rutas a `subtareas[n].permitidos` del estado, así `--cambios --sub` y `--global` las usan sin `--permitidos` y `--reanudar` las conserva. Una ruta sumada puede pisarse con otra subtarea: recalcular `lotesDe` e imprimir el `LOTES:` que rige. Un re-plan (`--guardar plan --ajuste`) rehace `subtareas` y borra la aprobación: el `--aprobado` siguiente vuelve a pasar `--sumar`. `pasos.md` §2 y §4: pasar ahí cada ajuste que suma permitidos. Añadir test.

### 10. Los AVISOS del plan quedan sin resolver
- **Evidencia:** en `000204`, «S4 parece externa y no tiene permiso» no se resolvió ni se mencionó. Los acoplados `errors.test.ts`, la migración, `ops/reconciliacion.ts` y `database.ts` no fueron a permitidos ni a «Fuera de alcance».
- **Cambio:** `pasos.md` §2: hoy dice «completa tú lo menor, AVISOS incluidos», sin destino. Precisar: cada AVISO termina, con una línea, en `AJUSTES AL PLAN` o en «Fuera de alcance» con su motivo (un acoplado, en permitidos o fuera de alcance); nunca se ignora.

### 11. `sola` convierte en barrera a una subtarea sin dependencias
- **Evidencia:** en `011249`, S3 lleva `sola: true` por P1 irreversible y `lotesDe` (`estado.mjs:665`) la trata como barrera: va después de todas las previas y todas las siguientes van después de ella. El resultado fue `LOTES: S1 | S2 | S3 | S4` en serie. Parte de la serie también viene de que S4 pisa a S1 en `base-datos.md`.
- **Cambio:** en `lotesDe`, `sola` exige lote propio (nadie comparte su lote: la guardia no distingue qué ejecutor del lote corre el permiso, comentario de `estado.mjs:664`), pero no ordena: solo espera a sus dependencias y a las previas con las que se pisa, y las siguientes no la esperan salvo que dependan de ella o se pisen. Según el análisis, con S2 y S4 en un mismo lote se ahorraban unos 60 s (lo que tarda S2; las dependencias reales de `011249` no son verificables aquí). No sirve dejarla en un lote compartido aunque no tenga dependencias: rompería ese motivo. Añadir casos en `estado.test.mjs`. Si el punto 3 saca los deploys de las subtareas, quedan menos `sola`: reevaluar después.

### 12. Un `any` evitable pasó a la revisión
- **Evidencia:** S2 de `011249` corrió con `Crítica: no` y effort medium y dejó `onSuccess: (c: any)` (`clientes/index.tsx:122`). La regla ya está en `qcc-ejecutor.md:49` para toda subtarea, pero solo nombra `as any`, `@ts-ignore`, `# type: ignore` y `unsafe`: una anotación `: any` no aparece.
- **Cambio:** `qcc-ejecutor.md:49` (Calidad, «Tipos») y `qcc-revisor.md:41`: nombrar también las anotaciones `: any` (y `any[]`) sin justificación. Ver también el punto 23, que lo detecta de forma mecánica.

## Prioridad media: contexto y costo

### 14. Seguir en la misma sesión después de /impl sale caro
- **Evidencia:** la fuga (`costos.mjs --fuga`) fue de 4,3M tokens en `011249` y 5,9M en `034449` (39 % y 41 % del flujo), por hacer `/commit` sin `/clear` con el orquestador en ~155k de contexto.
- **Cambio:** `comun.md` §7: la línea final del cierre ya pide `/clear` antes de otro `/impl`; extenderla a «`/clear` antes de `/commit`» (el agente de `/commit` lee los cambios por su cuenta y no necesita el contexto del flujo).

### 15. La exploración gasta más que la ejecución
- **Evidencia:** en `002637`, los exploradores generan 15k–39k tokens de salida cada uno para un informe de 20 líneas (~156k en total contra ~55k de los 11 ejecutores). A verificar: cuánto de eso es razonamiento de Haiku.
- **Cambios:**
  - `pasos.md` §1: repetir ahí que cada explorador va con `run_in_background: false` (hoy solo lo dice `comun.md` §4, y el Agent corre en segundo plano por defecto). En `002637` hubo 5 turnos de «N/6 listos», ~110k cada uno.
  - `agents/qcc-explorador.md` (hoy `effort: high`): probar `medium` en una corrida y comparar salida, `CORTADO` y `SIN EXPLORAR` antes de dejarlo. A verificar (también que Haiku respete el esfuerzo).

## Prioridad media: registro y herramientas

### 17. Fases de límites sin dato y totales nulos
- **Evidencia:** en `000204`, los pasos 4 y 5 tienen `sinDato: "snapshot viejo"` (917 y 922 s) tras 893 s de espera. En `011249` la ventana de 5 h se reinició y el total salió `reinicio`. `154658` arrancó con el snapshot viejo (831 s) tras `/clear`.
- **Cambios:**
  - Contexto, sin cambio: el snapshot lo escribe el panel en `session.measure` (`qcc-panel/hooks/register.tsx:813`), solo cuando hay pedidos: mientras el usuario lee el plan nadie lo pone al día, y `estado.mjs` no puede refrescarlo ni sirve reintentar. Pasado `LIMITES_MAX_SEG` (600 s, `costos.mjs:36`) la lectura sale «snapshot viejo».
  - `costos.mjs` (`fasesDeLimites`): unir el tramo de una lectura vieja con el siguiente («plan+aprobación+ejecución +13 %») en vez de tres `s/d`.
  - `costos.mjs` (`gastoDeLimites`): con reinicio de ventana, mostrar la cota mínima, lo gastado desde el reinicio (`fin`), marcada `incompleto` (`≥+`), en vez de `reinicio`. `(100 − inicio) + fin` es la cota máxima, no la mínima.
  - `costos.mjs` (`tiemposDe`): restar la espera por el límite de 5 h («You've hit your 5-hour limit» hasta «usage limit has reset»). En `011249` esos 9 min cuentan como tiempo activo y distorsionan la medición (33,4 min contra 24,4 reales). A verificar primero: si el aviso del límite cierra un turno con texto y el usuario responde, `esperasTurno` ya lo descuenta; el caso a cubrir es la espera dentro de un subagente o sin mensaje del usuario.

### 18. `negados` mezcla tope de contexto y política
- **Evidencia:** las 22 negaciones de `222349` y la de `011249` son el tope de contexto, el mecanismo funcionando. La única por política fue en `034449` (`curl localhost:3000/healthz` negado por la regla «red»).
- **Cambio:** `estado.mjs` (`filaDelFlujo` y el cierre, :2057): dejar `negados` como número (las filas viejas, los tests de `estado-cambios.test.mjs` y `FLUJOS.md` lo usan así) y sumar en `calidad` un campo `negadosContexto`, contado con el mismo criterio que `cortadosDe` (:1025: motivo registrado `contexto <N>k`). Añadir test. Abrir la red al revisor no entra: una sola negación por política no justifica aflojar la guardia.

## Del segundo análisis: velocidad, calidad y coste

Ninguno cambia el modelo ni el esfuerzo de ningún agente, ni quita la revisión final, la verificación o las reglas CRÍTICO. El análisis de coste midió que bajar el esfuerzo de los ejecutores ahorraría casi nada (entre todos piensan 4–13k tokens por corrida).

### 20. Un ejecutor repite el mismo test para cambiar cómo leer la salida
- **Evidencia:** S8 de `034449` (spec visual) tardó 517 s, el 53 % de la fase de ejecución. Corrió Playwright 4 veces (124 + 124 + 58 + 60 s); las dos últimas solo cambiaban la lectura (`tail`, `grep`, `--reporter=json`). Además releyó archivos 25 veces.
- **Cambio:** `qcc-implementador/agents/qcc-ejecutor.md` (Calidad, :50): correr cada test una sola vez, guardar la salida en un temporal con el número de la subtarea en el nombre (`> "$TEMP/impl-S<n>.log" 2>&1`: en un lote corren hasta 4 a la vez; permitido por Alcance :23 y por la guardia, que resuelve `$TEMP` en `rutaNativa`) y filtrarla con `grep` sin relanzar. Choca con «(sin redirigirla a un archivo)» de :50, que hay que cambiar. En Playwright, un solo `--project` mientras se itera. Ahorro estimado en esa corrida: 2–4 min.

### 22. Un explorador mezcla documentos y tests acoplados con código
- **Evidencia:** en `011249` un explorador que mezcló «docs, tipos y tests acoplados» quedó `CORTADO` por contexto (94k). En `002637` el reintento salió de `SIN EXPLORAR` por tests no leídos (causa exacta a verificar: solo se vieron los `SIN EXPLORAR`). Cada reintento suma 2,6–2,8 min, cerca del 47 % de la fase de exploración.
- **Cambio:** `pasos.md` §1 y `comun.md` §5: contar dentro de las ~2.000 líneas de cada explorador también las carpetas de tests y documentos de su área que están fuera de sus carpetas de código (las que el MAPA muestra junto a ellas, p. ej. `tests/<área>/`, `docs/<área>/`; el orquestador no sabe de antemano qué archivos sueltos leerá). Hoy solo cuentan las carpetas del pedido y solo salen aparte los documentos de más de 300 líneas; las líneas salen del MAPA, que las da por carpeta. No es el `TOPE`, que es de líneas del informe. No separar los tests en otro explorador: sin el código no sabe cuáles importan.

### 23. Defectos mecánicos que llegan a la revisión final
- **Evidencia:** `onSuccess: (c: any)` en `clientes/index.tsx:122` (`011249`) provocó un rechazo y una segunda revisión (corrección de 69 s más revisión 2). Una regla del proyecto lo prohíbe y se detecta con una búsqueda.
- **Cambios:**
  - `estado.mjs --cambios --sub`: en las líneas agregadas de archivos TS/JS (con los nuevos sin versionar, que ya entran en la foto), avisar de `: any`, `as any`, `any[]`, `@ts-ignore` o `eslint-disable` sin comentario de justificación en la misma línea o la anterior (no un `any` suelto: en Python es una función). El orquestador no edita: el aviso va a una Corrección de la subtarea dueña del archivo, también en un lote (un ciclo de Sonnet en vez de uno de Opus; `pasos.md` paso 5 y `comun.md` §6 lo dicen). Es heurístico: una vez por subtarea y sin contar como ciclo (no debe llevar a DETENIDO); si sigue, va a su nota de `EJECUTORES` y lo juzga la revisión final. Alternativa: una regla de eslint en el verificar de `horaki-sas`. Añadir test.
  - `qcc-ejecutor.md`, Autochequeo: buscar esos mismos patrones (los de «Tipos» de Calidad, punto 12) en lo que agregó: `git diff -U0 -- <sus permitidos>` en los modificados (`GIT_LECTURA`, `guardia.mjs:613`) y Grep en los nuevos, que `git diff` no muestra. No se puede «grepear» cada regla de `revisor.md`: son prosa.

### 24. El ejecutor avisa de un contrato dudoso y nadie actúa
- **Evidencia:** el reporte de S6 de `034449` decía «Si el reintento se cuelga para siempre, no sale ningún error. Eso es lo que pedía el contrato», con HECHO. El orquestador siguió; la revisión final lo rechazó.
- **Cambio:** `qcc-ejecutor.md`, Alcance («Si el plan resulta inviable…», :26): si cumplir el contrato deja una pantalla sin salida o se apoya en un supuesto falso, `ESTADO: BLOQUEADO` con `CONTRATO DUDOSO: <qué y por qué>` en BLOQUEOS, no HECHO. Así entra en el camino de BLOQUEADO que ya existe (`comun.md` §6: AskUserQuestion con ampliar, cambiar el plan, seguir sin ella o detener) y no hace falta un mecanismo nuevo. Redespachar como corrección no sirve: el contrato sigue igual y cambiarlo exige volver a aprobar (`comun.md` §4). Sale más barato que un ciclo de revisión. Complementa el punto 1.

### 25. Documentos y comentarios quedan viejos porque no estaban en los permitidos
- **Evidencia:** `pruebas.md:663` y el comentario de `corte-diario.ts:46-48` (`000204`; el explorador sí había señalado el comentario), y `flow.md:519` (`011249`; el explorador lo tenía como NO LEAS).
- **Cambio:** `qcc-implementador/agents/qcc-planificador.md`, Reglas: Grep en `*.md` y en los comentarios por los identificadores que el cambio renombra o cuyo comportamiento cambia; lo que describe el comportamiento que cambia va a los permitidos; lo histórico (changelog, ADR, bitácoras, planes viejos) no. Es un Grep con `-C`, sin lecturas extra ni contar en las ~8 lecturas del planificador.

### 26. El orquestador gasta pedidos que se pueden juntar
- **Evidencia:** cada pedido del orquestador cuesta ~170k de lectura de caché con su contexto de 155–196k. Hoy cada permiso aprobado va en su propia llamada (`pasos.md` paso 4: «`estado.mjs --permiso <Pn> aprobado --paso 4`, sola en su llamada a Bash»).
- **Cambio:** `estado.mjs --permiso` acepta una lista (`--permiso P1,P2 aprobado --paso 4`), y `pasos.md` paso 4 y `comun.md` §1 lo dicen. Ahorra un pedido por permiso aprobado después del primero (0–3 por corrida). `--aprobado` sigue aparte: va antes y tiene su propio modo. No tocar la salida de `--guardar plan`: el bloque `PARA APROBAR` es lo que el orquestador copia al usuario.

### 27. El primer ciclo del revisor arma el diff a pedazos
- **Evidencia:** hasta 26 pedidos, con el diff pedido en unos 10 `git diff`/`sed` sueltos (unos 70k caracteres) y el contexto hasta 100k. El segundo ciclo ya es barato (93–146k).
- **Cambio:** todo `estado.mjs --cambios … --paso 6` (el `--global` y también el `--sub` del único lote que cubre todas las subtareas, que no pasa por `--global`) escribe `<FLUJO>/diff.txt` con la salida de `--diff <BASE_GLOBAL> --permitidos <la unión más los ampliados>` sin el recorte de `TOPE_DIFF` (con los bloques movidos colapsados, como hoy). La plantilla de la revisión final (`comun.md` §5) suma `DIFF: <FLUJO>/diff.txt`, y `qcc-revisor.md` paso 3 lo lee con Read (por rangos si pasa del límite de Read) en vez de pedir el diff a pedazos. Solo el primer ciclo: con `REVISIÓN ANTERIOR` sigue pidiendo el diff desde la `BASE DE LA CORRECCIÓN`. Si el `--cambios` fue el de la forma explícita (respaldo de `comun.md` §1) no hay `diff.txt`: el despacho lleva `DIFF: ninguno` y el revisor sigue con el paso 3 de hoy. La guardia deja leer `<git-dir>/qcc-impl/` (solo niega `.env` y secretos). Baja a unos 12 pedidos y ahorra ~0,5–0,8M tokens de Opus por ciclo. Mantiene Opus high y el plan completo.

### 28. Exploradores y ejecutores releen lo mismo y buscan archivos que no existen
- **Evidencia:** cada explorador relee `mapa.md` (10 KB) e `implementador.md` y prueba `buscar.md` y `qcc-implementador.md`, que no existen en `horaki-sas`. Cada ejecutor relee `implementador.md`. Tres subtareas con 17–26 pedidos gastaron 1,0, 1,48 y 1,65M tokens cada una, con muchas lecturas de archivos enteros.
- **Causa:** `REGLAS` del despacho ya trae la ruta exacta que existe (`estado.mjs --reglas`, :1541: en `horaki-sas`, `.claude/implementador.md`), pero los agentes la toman como pista y prueban primero los nombres nuevos (`qcc-explorador.md:15`: `buscar.md` o `qcc-implementador.md`, «si no existen, sus respaldos»; igual en `qcc-ejecutor.md:15`, `qcc-revisor.md:15` y `qcc-planificador.md:16`).
- **Cambios:** en los cuatro agentes (y en el Autochequeo de `qcc-ejecutor.md:80`): leer exactamente lo que dice `REGLAS` (con una carpeta, sus archivos de ese rol), sin probar otros nombres. `qcc-ejecutor.md`: leer por rangos usando las `ruta:línea` de `S<n>.md`. No pasar el trozo del mapa en el despacho: lo tendría que escribir el orquestador (salida de Sonnet) para ahorrar lecturas de Haiku, más baratas. Ahorro estimado: 0,3–0,6M tokens por corrida (con la parte del mapa fuera, algo menos).

## Fuera de este repo

### 19. `horaki-sas` no declara `criticos`
- **Evidencia:** el preflight dice «el proyecto no declara «criticos» en .claude/implementador.json» en las dos tandas, así que el aviso de «Crítica: no sobre ruta crítica» nunca salta. Además usa el nombre viejo del archivo.
- **Cambio:** en `horaki-sas`: declarar `criticos` y pasar el archivo a `.claude/qcc-implementador.json`.

## Orden sugerido

1. Puntos 1, 2, 5, 10, 12, 24, 25 (reglas de revisión, plan, ejecutor, planificador y orquestador: texto, sin código, bajo riesgo).
2. Punto 7 (evita el mayor gasto de las corridas canceladas).
3. Puntos 20, 22 (velocidad: reglas de ejecutor y explorador, texto).
4. Puntos 3, 4, 8, 9, 23 (guardia y `estado.mjs`, con tests; el 4 es texto, pero usa el aviso y el quién `post-revisión` del 3).
5. Puntos 14, 15, 26, 27, 28 (reducción de contexto y costo).
6. Puntos 17, 18 (registro).
7. Puntos 11, 19 (según lo que quede después del resto).

## Verificación

Cada cambio de código en `qcc-implementador/herramientas/` lleva su test y termina con:

```
claude plugin validate qcc-panel
claude plugin test qcc-panel
node --test "qcc-implementador/herramientas/*.test.mjs"
node --test qcc-commit/herramientas/solo-git.test.mjs
```

Subir la versión de impl (`qcc-implementador/.claude-plugin/plugin.json`, hoy 0.5.1) al terminar, y actualizar `FLUJOS.md` si cambia el comportamiento descrito.

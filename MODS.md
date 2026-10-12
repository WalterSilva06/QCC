# Mods

Mod (plugin) de Claude Code que vive en `panel-uso/`. Hoy hay uno solo: `panel-uso`, un panel lateral que muestra el contexto de la sesión, los límites de uso, el esfuerzo y el consumo de tokens. Las reglas generales del repo están en [AGENTS.md](AGENTS.md).

## Cómo está armado

`semana.ts`, `formato.ts`, `carpeta.ts` y `flujo.ts` no usan `$`: todo lo que se pueda probar solo va ahí. `register.tsx` conecta el motor con esa lógica (hooks, estado, lectura y escritura del store) y dibuja el panel, pero no hace cálculos de negocio. El árbol de archivos está en [AGENTS.md](AGENTS.md#estructura).

## Verificar

Los comandos de verificación del mod están en [AGENTS.md](AGENTS.md#verificar).

Los tests del panel simulan el motor (`mock.clock`, `mock.store`, `on('process.run', …)`, `on('session.root', …)`), así que **no prueban** el aspecto real en pantalla ni que un proceso real abra una ventana (sí comprueban el texto, los colores y el ancho que el panel entrega al motor): eso se comprueba a mano con `/reload-plugins`.

Para «Flujo», los tests disparan `skill.prompt`, `tool.call` y `turn.complete` con datos armados a mano, pero no prueban una corrida real de `/implementador`, `/implementador-ligero` o `/documentar`.

## Instalación

El mod está registrado en local como `panel-uso@mods-locales`. Después de editar archivos, `/reload-plugins` lo vuelve a leer desde la carpeta `panel-uso`.

Para registrarlo de nuevo (por ejemplo, si la carpeta del repo cambió de ruta):

```
claude plugin uninstall panel-uso@mods-locales
claude plugin marketplace remove mods-locales
claude plugin marketplace add <ruta del repo>\panel-uso
claude plugin install panel-uso@mods-locales
```

## Qué muestra (de arriba abajo)

1. Botón **Abrir carpeta** (tecla `c`): abre en el explorador la raíz de la sesión (`$.session.root()`).
2. **Flujo** (tecla `f`): en qué paso va el flujo `/implementador`, `/implementador-ligero` o `/documentar` de esta sesión.
   - Plegada (al inicio), solo trae el título y un resumen de una línea con el tiempo total de trabajo del flujo, sin la espera al usuario: `/implementador · Ejecución · 3 min 20 s`, o `sin flujo en esta sesión` si no corre ninguno. El botón **Ver / Ocultar** la despliega y el panel lo recuerda entre sesiones.
   - Desplegada, dibuja el diagrama de pasos, uno por línea y unidos por `│`: `✓` paso ya pasado, `▸` paso actual, `○` paso por venir. Al final va «Terminado»; cuando el flujo acaba pasa a `●` (verde si se completó, amarillo si quedó detenido, rojo si se interrumpió) y se lee «Terminado · detenido» o «Terminado · interrumpido».
   - Cada paso recorrido lleva su tiempo de trabajo a la derecha (`45 s`, `3 min 20 s`, `1 h 20 min`): el paso actual cuenta lo que lleva en curso y «Terminado» el trabajo total, de principio a fin. Si el flujo esperó al usuario, ese tiempo no cuenta como trabajo: va aparte como ` · espera X` (`· espera 2 min 5 s`) en el paso donde ocurrió, y «Terminado» lleva además la espera total. Los pasos saltados y los por venir no llevan tiempo. Si la línea no alcanza, se acorta la etiqueta del paso, nunca el tiempo. Un paso al que el flujo vuelve suma el tiempo de todas sus visitas.
   - El tiempo del paso en curso (su espera, si hay una pregunta abierta, y el total del resumen) se pone al día con cada evento del flujo o, a más tardar, con el tick de 30 s, así que sin eventos puede ir hasta 30 s atrasado.
   - Los pasos son `Preflight`, `Exploración`, `Clasificación`, `Plan`, `Aprobación`, `Ejecución`, `Verificación final` y `Cierre` en `/implementador`; `Preflight`, `Exploración`, `Escalado`, `Plan breve`, `Aprobación`, `Ejecución`, `Revisión` y `Cierre` en `/implementador-ligero`; `Preflight`, `Modo`, `Ficha`, `Lectura`, `Escritura`, `Revisión` y `Cierre` en `/documentar`. Si el pedido de `/documentar` es auditar, cambian a `Preflight`, `Modo`, `Plan de auditoría`, `Lectura`, `Corrección`, `Revisión` y `Cierre`, y el resumen lleva «auditar».
   - De qué eventos sale cada paso, siempre en el hilo principal (los subagentes no mueven el flujo):
     - Empieza con el `skill.prompt` de una de las tres skills (con o sin prefijo de plugin).
     - `Preflight`: el comando `node …estado.mjs` sin opciones, o `verificar.mjs` antes de que haya corrido un `ejecutor`.
     - `Exploración`: el agente `explorador`. Pueden correr varios exploradores a la vez: cuando vuelven todos los que estaban en vuelo se marca `Clasificación` (`/implementador`) o `Escalado` (`/implementador-ligero`). Un explorador que falla cuenta como vuelto; si fallan todos, el paso queda en `Exploración`. Lanzar otro mientras corren no reinicia el tiempo del paso.
     - El paso `Exploración` lleva ` ×N` junto a su etiqueta, con los exploradores lanzados en todo el flujo: suma todas las tandas (una tanda nueva reinicia los exploradores en vuelo, pero no el total). Se ve también con el flujo terminado; no sale si no hubo ninguno ni con el paso pendiente, y no va en la línea resumen plegada. Un flujo en curso de una versión anterior toma los exploradores que siguen en vuelo como cota inferior.
     - Los demás agentes también se cuentan. En `/implementador`: ` ×N` en `Plan` (el `planificador`; un re-plan suma) y en `Ejecución` (el `ejecutor`, con las correcciones), y ` · rev ×N` en la fila del paso donde corrieron los `revisor` (en `Ejecución`, por subtarea y por corrección; en `Verificación final`, la revisión integral, hasta 3 en paralelo, que además suman ■ en «Esta sesión»: ver «Esta sesión» más abajo; uno lanzado en `Cierre` se anota en `Cierre`). En `/implementador-ligero`: ` ×N` en `Ejecución` y en `Revisión`. Se cuentan al lanzar el agente desde el hilo principal, aunque falle; siguen visibles tras «Terminado». No van en la línea resumen plegada ni con el paso pendiente, y `/documentar` no los lleva. Un flujo en curso de una versión anterior (0.9.3 a 0.9.7) cuenta desde la recarga, y toma `ejecuto` como cota inferior de `Ejecución` (×1).
     - La espera al usuario (nombre interno `esperaUsuario`, distinto de la «espera» de actividad del ■ amarillo) va desde el `tool.call` de `AskUserQuestion` del hilo principal hasta que vuelve su resultado, sea bueno, con error o cancelado. Mientras está abierta, el paso no suma trabajo, y al cerrarse la espera queda en el paso en curso. Si llega un `Escape` con la pregunta abierta, el flujo pasa a «Terminado · interrumpido» con la espera hasta ese momento y la vuelta tardía de la pregunta no cambia nada, en cualquier orden. Una pregunta que nunca vuelve la cierra `turn.complete` (`session.end` borra el flujo). Con dos preguntas a la vez cuenta el primer inicio y la primera vuelta cierra. Vale para los tres flujos.
     - `Plan`: el agente `planificador` (solo en `/implementador`); `Aprobación`: una pregunta (`AskUserQuestion`) con header «Plan».
     - `Ejecución`: `estado.mjs --base`, el agente `ejecutor`, o el agente `revisor` en `/implementador` antes de la verificación final.
     - `Revisión` (`/implementador-ligero`): el agente `revisor`.
     - `Verificación final` (`/implementador`): `verificar.mjs` tras ejecutar. `Cierre`: `estado.mjs --cambios` ya en la verificación final, y `verificar.mjs` en `/implementador-ligero`.
     - En `/documentar`: la primera pregunta al usuario → `Ficha`; el agente `lector` → `Lectura`; editar o escribir un `.md` de doc → `Escritura`; el agente `revisor-doc` → `Revisión`; escribir `.claude/documentar/cobertura.md` tras la revisión → `Cierre`. Escribir `.claude/documentar.md` no mueve el paso.
     - «Terminado»: al acabar el turno principal. Si terminó con respuesta, es completo, salvo que traiga «CIERRE · … — DETENIDO», que lo deja detenido. Cualquier otra razón (por ejemplo, un `Escape`) lo deja interrumpido.
   - Desplegada, además:
     - Bajo el resumen sale `orquestador Opus 5.5 high`: el modelo y el esfuerzo con que respondió por última vez el hilo principal durante el flujo, leído de la petición real (no de lo que dice la skill). Sirve para ver si una sesión corre el flujo con otro modelo del que pide la skill, por ejemplo al invocarla de nuevo en una sesión ya abierta. Aparece con la primera respuesta del hilo principal tras iniciar el flujo y no cambia cuando el flujo termina. Lo que gastó el orquestador con el flujo en curso sale además como el tramo rosa (`pink_FOR_SUBAGENTS_ONLY`, el color del `revisor-plan`) de las barras de «Esta sesión» y «Esta semana».
     - Tras el último paso sale el bloque `consumo`, con el gasto real del flujo: el total y la salida (`200k · sal 4k`) y una fila por modelo y esfuerzo (hilo principal y subagentes por separado, la de los subagentes con la etiqueta en `suggestion`), con total y salida de cada una. Es lo que sumó «Esta sesión» desde que empezó el flujo, con la caché incluida; lo que la sesión ya había gastado antes no cuenta. En curso se actualiza con cada respuesta; al terminar queda fijo y lo que se gaste después en la sesión no lo mueve. No sale mientras no haya gastado nada, ni en un flujo que terminó antes de existir este bloque. No separa por rol: las filas son por modelo y esfuerzo, que en la práctica distinguen al explorador, al planificador, al ejecutor y al revisor. En `/implementador-ligero` el `planificador-ligero` y el `ejecutor` comparten la fila de Sonnet high.
     - El `Consumo` del CIERRE de `/implementador` no es esto: son los `subagent_tokens` de cada agente, es decir, el tamaño del contexto de su último turno, que en un agente largo queda 20 a 40 veces por debajo de lo leído y generado de verdad.
   - Cuesta 0 tokens: solo mira los eventos que ya pasan por el motor y no llama a ningún modelo.
   - Límites:
     - `Plan breve` y `Modo` nunca son el paso actual: ningún evento los marca, así que se pasa de largo.
     - El `planificador-ligero` de `/implementador-ligero` no mueve el paso: su tiempo suma al paso en curso (normalmente `Escalado`), y por eso `Plan breve` sigue sin ser nunca el paso actual.
     - El `revisor-plan` de `/implementador` (entre el plan y la aprobación) no mueve el paso: su tiempo suma a `Plan`. No suma al ` ×N` de `Plan` ni a ` · rev ×N`, y sale en `consumo` como una fila Sonnet high.
     - Durante la Exploración, todo subagente que pide al modelo cuenta como explorador: la fila de «Esta sesión» se reconoce por observación, no por el nombre del agente. Con exploradores de distinto esfuerzo, cada una de sus filas muestra el total en vuelo. El tope es de 3 cuadrados; con 3 y anchos angostos la etiqueta se acorta más. Lo mismo vale mientras hay revisores en vuelo (la revisión integral): todo subagente que pide al modelo cuenta como revisor y se anota su fila. Al abrir una tanda nueva (el primer explorador de una exploración, o el primer revisor sin otros en vuelo) se olvidan las filas anotadas antes.
     - El fork mode y un `Escape` marcan «Terminado». Un `Escape` con una pregunta pendiente cierra también su espera (ver más arriba).
     - No se descuenta la espera de permisos de herramientas: solo la de `AskUserQuestion`.
     - En la primera corrida de `/documentar`, cuando aún no hay reglas, la ronda de preguntas se ve como `Ficha`.
     - El consumo del flujo mira solo esta sesión: no suma lo que otra terminal gaste en paralelo. Se calcula restando, fila por fila, el total de «Esta sesión» al empezar el flujo; un `/clear` a mitad de flujo borra el flujo y la sesión, y con ellos el bloque.
     - Es solo de esta terminal: otra terminal no ve el flujo de esta.
3. **Contexto**: barra por categorías (como `/context`), lista de partes y «Lo más pesado». El botón **Precisar** (tecla `p`) cambia la estimación local por un conteo exacto con la API, que gasta una petición por herramienta y por archivo de memoria.
4. **Límites de uso**: 5 horas, semanal y de gasto, con el % y la hora de reinicio.
5. **Esfuerzo**: el de la última petición del hilo principal, o el de `settings.json` antes del primer turno.
6. **Esta sesión** y **Esta semana**: tokens por modelo (familia y versión) y esfuerzo, con el total y la salida. En «Esta sesión» una fila es, por ejemplo, `Opus 5.5 high` (del hilo principal o de los subagentes): se separan por origen, y la fila del subagente se reconoce por el color de su barra (`suggestion`); una fila principal y una de subagente con el mismo modelo y esfuerzo llevan la misma etiqueta. Las filas van en columnas alineadas (familia, versión y esfuerzo, rellenadas al más largo de las filas presentes), de modo que los ■ empiezan en la misma columna; si la línea no alcanza, la etiqueta se acorta con «…» al mismo ancho, y los cuadrados y las cifras no se cortan. «Esta semana» también alinea sus etiquetas en columnas (familia · versión · esfuerzo, rellenadas al más largo de sus propias filas), pero no lleva ■; une las filas por modelo·esfuerzo (suma total y salida), así que ninguna de las dos secciones muestra « · sub», y la barra de cada fila marca en otro color (`suggestion`) la parte que fue de los subagentes, y el resto va en `claude`. Debajo de cada fila va una barra con su % de la sección; el tramo de subagentes va dentro de ella, no la alarga, y las filas sin subagentes no cambian. En «Esta sesión» y «Esta semana», la barra de una fila principal marca además en `pink_FOR_SUBAGENTS_ONLY` el tramo que el hilo principal (el orquestador) gastó con un flujo en curso; va dentro de la barra, sin alargarla, y el orden es `claude` · `pink_FOR_SUBAGENTS_ONLY` · `suggestion` · vacío. Cubre todos los flujos de la sesión (o de la semana) y todos los modelos con que respondió el orquestador. Se anota desde la 0.9.10: lo anterior queda en `claude`. Hasta la 0.9.11 iba en `success`. «Esta sesión» no lleva el tramo de subagentes, pero la barra de sus filas de subagentes va entera en `suggestion` (el mismo color que el tramo de subagentes de «Esta semana»). El esfuerzo se muestra en inglés (`low`, `medium`, `high`, `xhigh`, `max`, o `—` si no hay). «Esta semana» arranca plegada (solo título y total); el botón **Ver / Ocultar** (tecla `s`) la despliega y el panel lo recuerda entre sesiones. Al pulsar «Ver» el panel se desplaza hasta «Esta semana» para que las filas queden a la vista. Con «Esta semana» desplegada, un bloque «por día» muestra una barra y el total de cada uno de los últimos 7 días (por día local). «Esta sesión» no se pliega. El encabezado de cada sección muestra el total y la salida (`14,4M · sal 48k`), suma de todas las filas; en «Esta semana» pasa al pie si no cabe junto al botón. En «Esta sesión» cada fila lleva un ■: verde = esa fila tiene una petición en curso ahora; amarillo = esperando una herramienta (su última respuesta pidió una y aún no empezó la siguiente petición de esa fila); gris = inactiva; solo en la sesión porque cada terminal solo conoce su propia actividad. Cada fila lleva un ■; la de los exploradores o revisores lleva uno por explorador o revisor en vuelo, de 1 a 3, separados por un espacio y del color de la fila, y vuelve a uno cuando terminan todos; en la revisión integral los revisores en paralelo suman ■ en su fila y la fila de los exploradores vuelve a uno; si explorador y revisor comparten modelo·esfuerzo comparten fila, y los ■ son los exploradores más los revisores en vuelo (tope 3). Solo las filas anotadas llevan más de uno, y solo mientras el flujo sigue en curso.

La vista `inline` (terminal angosta) es una sola línea: `ctx 42% · 5h 30% (en 2 h) · sem 12% · esfuerzo high`.

## Comandos

- `/uso`: abre el panel.
- `/uso carpeta`: abre la carpeta del proyecto. Funciona sin foco en el panel y sin ratón.

## Datos

- Cada respuesta de la API (hilo principal y subagentes) se anota en `$.store` con la clave `uso:<sessionId>`, una por sesión, para que dos terminales no se pisen.
- El formato es `hora (ms, redondeada a la hora) → clave → [entrada, salida, caché leída, caché escrita]`. La clave es `modelo|esfuerzo` para el hilo principal, `modelo|esfuerzo|sub` para los subagentes y `flujo|modelo|esfuerzo` para el hilo principal con un flujo en curso, decidido al llegar la respuesta. Es un prefijo y no un sufijo para que una terminal sin recargar (que no conoce `flujo|`) lo sume como principal del mismo modelo·esfuerzo en vez de perderlo. Los datos viejos (sin `|sub` ni `flujo|`) cuentan como principal fuera de flujo.
- «Esta semana» suma todas las sesiones desde el inicio de la ventana del límite semanal (`resetsAt − 7 días`), o desde 7 días atrás si no hay límite semanal.
- Al abrir una sesión se borra lo que tenga más de 15 días (`RETENCION_MS`).
- Si «Esta semana» está desplegada se guarda en `prefs:semana` (`true`/`false`). Esa clave está fuera del prefijo `uso:` a propósito, para que la poda y la suma de la semana no la lean como uso.
- Si «Flujo» está desplegada se guarda en `prefs:flujo` (`true`/`false`), también fuera del prefijo `uso:`. El flujo en curso no se guarda en el store: vive solo en el estado del panel de esta terminal, y se borra al cerrar la sesión (un `/reload-plugins` a mitad de flujo no lo pierde). Lo mismo vale para el atom `filasExploradores` (los ids de las filas de subagente vistas con exploradores o revisores en vuelo): vive solo en el estado del panel y no va al store, se vacía al iniciar un flujo, al abrir una tanda de exploradores o revisores y al cerrar la sesión, y sobrevive a `/reload-plugins`.
- Anotar el uso y podar el store pasan por una cola (`enFila`), porque hilo principal y subagentes responden a la vez. La preferencia `prefs:semana` se escribe sin ella.
- Un tick de 30 s mueve las cuentas regresivas y relee lo que anotaron otras terminales. No llama a ningún modelo.

## Convenciones del panel

Además de las [convenciones generales](AGENTS.md#convenciones):

- Ningún hook del panel puede romper la sesión: las lecturas y escrituras van en `try/catch` y un fallo deja la sección como estaba.
- Lo que dibuja el panel sale de atoms (`atom` / `read` / `update`). Cada valor nuevo se declara en `types/index.d.ts`, porque `claude plugin validate` lo exige.
- Hotkeys en uso: `p` (Precisar), `c` (Abrir carpeta), `f` (Ver / Ocultar «Flujo») y `s` (Ver / Ocultar «Esta semana»).
- Con cada cambio visible se sube `version` en `plugin.json`.

## Trampas conocidas

- **Windows: `$.process.run` lanza los procesos con la ventana oculta** y no hay opción para cambiarlo. `explorer.exe <carpeta>` hereda esa bandera: abre una ventana invisible y termina con exit 1. Por eso `carpeta.ts` usa PowerShell con `Shell.Application.Open`, que le pide la ventana al Explorador que ya corre. Antes cierra las ventanas **ocultas** de esa carpeta, porque `Open` reutilizaría una de ellas y no se vería nada. No es un problema de permisos ni de la terminal: pasa igual en Warp que en otras.
- La ruta del proyecto nunca va como argumento de un proceso ni por un shell. Va solo como `cwd`, y antes se valida con `tipoDeRuta`.
- El `exitCode` del comando de Windows sí sirve como señal de error: si es distinto de 0, el botón avisa con un toast.
- Los hooks de observación (`skill.prompt`, `tool.call`, `turn.complete`) solo leen el evento y devuelven `next(e)` sin cambiarlo; en `tool.call` el panel espera a `next` para el `explorador` (descuenta su vuelta aunque falle) y para `AskUserQuestion` (cierra la espera aunque falle o se cancele), y un error de la herramienta sigue su camino. `claude plugin validate` avisa «gating hook without .catch: tool.call»: es esperable. Según la referencia del motor, un hook que lanza se salta y la herramienta corre igual.

## Pendiente de confirmar

- ¿Qué nombre exacto trae `skill.prompt` para las skills de `~/.claude/skills`: `implementador` a secas, con `/` o con prefijo? El panel acepta las tres formas (con o sin `/` y con o sin `plugin:`), pero no se ha comprobado con una corrida real.

- ¿Qué `reason` trae realmente `turn.complete` con un `Escape`? El panel trata como interrumpida cualquier razón distinta de `answer`, pero no se ha comprobado con una corrida real.

- ¿El `next` de `AskUserQuestion` rechaza o resuelve cuando la pregunta se cancela? El panel cubre los dos casos y también los dos órdenes (la vuelta antes o después del `turn.complete`), pero no se ha comprobado con una corrida real.

- ¿«Precisar» gasta de verdad una petición por herramienta y por archivo de memoria? El código solo le pide al motor el desglose completo (`full`) y el panel pasa de «estimado» a «exacto»; el coste no se puede comprobar desde este repo. Quien conozca el motor debe confirmar si la frase de «Qué muestra» sobre ese gasto sigue vigente.

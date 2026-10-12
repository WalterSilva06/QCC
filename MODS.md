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
   - Plegada (al inicio), solo trae el título y un resumen de una línea con el tiempo total del flujo: `/implementador · Ejecución · 3 min 20 s`, o `sin flujo en esta sesión` si no corre ninguno. El botón **Ver / Ocultar** la despliega y el panel lo recuerda entre sesiones.
   - Desplegada, dibuja el diagrama de pasos, uno por línea y unidos por `│`: `✓` paso ya pasado, `▸` paso actual, `○` paso por venir. Al final va «Terminado»; cuando el flujo acaba pasa a `●` (verde si se completó, amarillo si quedó detenido, rojo si se interrumpió) y se lee «Terminado · detenido» o «Terminado · interrumpido».
   - Cada paso recorrido lleva su tiempo a la derecha (`45 s`, `3 min 20 s`, `1 h 20 min`): el paso actual cuenta lo que lleva en curso y «Terminado» el total, de principio a fin. Los pasos saltados y los por venir no llevan tiempo. Si la línea no alcanza, se acorta la etiqueta del paso, nunca el tiempo. Un paso al que el flujo vuelve suma el tiempo de todas sus visitas.
   - El tiempo del paso en curso (y el total del resumen) se pone al día con cada evento del flujo o, a más tardar, con el tick de 30 s, así que sin eventos puede ir hasta 30 s atrasado.
   - Los pasos son `Preflight`, `Exploración`, `Clasificación`, `Plan`, `Aprobación`, `Ejecución`, `Verificación final` y `Cierre` en `/implementador`; `Preflight`, `Exploración`, `Escalado`, `Plan breve`, `Aprobación`, `Ejecución`, `Revisión` y `Cierre` en `/implementador-ligero`; `Preflight`, `Modo`, `Ficha`, `Lectura`, `Escritura`, `Revisión` y `Cierre` en `/documentar`. Si el pedido de `/documentar` es auditar, cambian a `Preflight`, `Modo`, `Plan de auditoría`, `Lectura`, `Corrección`, `Revisión` y `Cierre`, y el resumen lleva «auditar».
   - De qué eventos sale cada paso, siempre en el hilo principal (los subagentes no mueven el flujo):
     - Empieza con el `skill.prompt` de una de las tres skills (con o sin prefijo de plugin).
     - `Preflight`: el comando `node …estado.mjs` sin opciones, o `verificar.mjs` antes de que haya corrido un `ejecutor`.
     - `Exploración`: el agente `explorador`. Cuando el explorador vuelve se marca `Clasificación` (`/implementador`) o `Escalado` (`/implementador-ligero`).
     - `Plan`: el agente `planificador` (solo en `/implementador`); `Aprobación`: una pregunta (`AskUserQuestion`) con header «Plan».
     - `Ejecución`: `estado.mjs --base`, el agente `ejecutor`, o el agente `revisor` en `/implementador` antes de la verificación final.
     - `Revisión` (`/implementador-ligero`): el agente `revisor`.
     - `Verificación final` (`/implementador`): `verificar.mjs` tras ejecutar. `Cierre`: `estado.mjs --cambios` ya en la verificación final, y `verificar.mjs` en `/implementador-ligero`.
     - En `/documentar`: la primera pregunta al usuario → `Ficha`; el agente `lector` → `Lectura`; editar o escribir un `.md` de doc → `Escritura`; el agente `revisor-doc` → `Revisión`; escribir `.claude/documentar/cobertura.md` tras la revisión → `Cierre`. Escribir `.claude/documentar.md` no mueve el paso.
     - «Terminado»: al acabar el turno principal. Si terminó con respuesta, es completo, salvo que traiga «CIERRE · … — DETENIDO», que lo deja detenido. Cualquier otra razón (por ejemplo, un `Escape`) lo deja interrumpido.
   - Cuesta 0 tokens: solo mira los eventos que ya pasan por el motor y no llama a ningún modelo.
   - Límites:
     - `Plan` en modo NORMAL de `/implementador` (no corre el `planificador`), `Plan breve` y `Modo` nunca son el paso actual: ningún evento los marca, así que se pasa de largo.
     - El fork mode y un `Escape` marcan «Terminado».
     - En la primera corrida de `/documentar`, cuando aún no hay reglas, la ronda de preguntas se ve como `Ficha`.
     - Es solo de esta terminal: otra terminal no ve el flujo de esta.
3. **Contexto**: barra por categorías (como `/context`), lista de partes y «Lo más pesado». El botón **Precisar** (tecla `p`) cambia la estimación local por un conteo exacto con la API, que gasta una petición por herramienta y por archivo de memoria.
4. **Límites de uso**: 5 horas, semanal y de gasto, con el % y la hora de reinicio.
5. **Esfuerzo**: el de la última petición del hilo principal, o el de `settings.json` antes del primer turno.
6. **Esta sesión** y **Esta semana**: tokens por modelo (familia y versión) y esfuerzo, con el total y la salida. En «Esta sesión» una fila es, por ejemplo, `Opus 5.5 high` (hilo principal) u `Opus 5.5 high · sub` (subagentes): se separan por origen. «Esta semana» las une por modelo·esfuerzo (suma total y salida) y no muestra « · sub», pero la barra de cada fila marca en otro color (`suggestion`) la parte que fue de los subagentes, y el resto va en `claude`. Debajo de cada fila va una barra con su % de la sección; el tramo de subagentes va dentro de ella, no la alarga, y las filas sin subagentes no cambian. «Esta sesión» no lleva ese tramo, pero la barra de sus filas « · sub» va entera en `suggestion` (el mismo color que el tramo de subagentes de «Esta semana»). El esfuerzo se muestra en inglés (`low`, `medium`, `high`, `xhigh`, `max`, o `—` si no hay). «Esta semana» arranca plegada (solo título y total); el botón **Ver / Ocultar** (tecla `s`) la despliega y el panel lo recuerda entre sesiones. Al pulsar «Ver» el panel se desplaza hasta «Esta semana» para que las filas queden a la vista. Con «Esta semana» desplegada, un bloque «por día» muestra una barra y el total de cada uno de los últimos 7 días (por día local). «Esta sesión» no se pliega. El encabezado de cada sección muestra el total y la salida (`14,4M · sal 48k`), suma de todas las filas; en «Esta semana» pasa al pie si no cabe junto al botón. En «Esta sesión» cada fila lleva un ■: verde = esa fila tiene una petición en curso ahora; amarillo = esperando una herramienta (su última respuesta pidió una y aún no empezó la siguiente petición de esa fila); gris = inactiva; solo en la sesión porque cada terminal solo conoce su propia actividad.

La vista `inline` (terminal angosta) es una sola línea: `ctx 42% · 5h 30% (en 2 h) · sem 12% · esfuerzo high`.

## Comandos

- `/uso`: abre el panel.
- `/uso carpeta`: abre la carpeta del proyecto. Funciona sin foco en el panel y sin ratón.

## Datos

- Cada respuesta de la API (hilo principal y subagentes) se anota en `$.store` con la clave `uso:<sessionId>`, una por sesión, para que dos terminales no se pisen.
- El formato es `hora (ms, redondeada a la hora) → clave → [entrada, salida, caché leída, caché escrita]`. La clave es `modelo|esfuerzo` para el hilo principal y `modelo|esfuerzo|sub` para los subagentes; los datos viejos (sin `|sub`) cuentan como principal.
- «Esta semana» suma todas las sesiones desde el inicio de la ventana del límite semanal (`resetsAt − 7 días`), o desde 7 días atrás si no hay límite semanal.
- Al abrir una sesión se borra lo que tenga más de 15 días (`RETENCION_MS`).
- Si «Esta semana» está desplegada se guarda en `prefs:semana` (`true`/`false`). Esa clave está fuera del prefijo `uso:` a propósito, para que la poda y la suma de la semana no la lean como uso.
- Si «Flujo» está desplegada se guarda en `prefs:flujo` (`true`/`false`), también fuera del prefijo `uso:`. El flujo en curso no se guarda en el store: vive solo en el estado del panel de esta terminal, y se borra al cerrar la sesión (un `/reload-plugins` a mitad de flujo no lo pierde).
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
- Los hooks de observación (`skill.prompt`, `tool.call`, `turn.complete`) solo leen el evento y devuelven `next(e)` sin cambiarlo; en `tool.call` el panel solo espera a `next` para el `explorador`, y un error de la herramienta sigue su camino. `claude plugin validate` avisa «gating hook without .catch: tool.call»: es esperable. Según la referencia del motor, un hook que lanza se salta y la herramienta corre igual.

## Pendiente de confirmar

- ¿Qué nombre exacto trae `skill.prompt` para las skills de `~/.claude/skills`: `implementador` a secas, con `/` o con prefijo? El panel acepta las tres formas (con o sin `/` y con o sin `plugin:`), pero no se ha comprobado con una corrida real.

- ¿«Precisar» gasta de verdad una petición por herramienta y por archivo de memoria? El código solo le pide al motor el desglose completo (`full`) y el panel pasa de «estimado» a «exacto»; el coste no se puede comprobar desde este repo. Quien conozca el motor debe confirmar si la frase de «Qué muestra» sobre ese gasto sigue vigente.

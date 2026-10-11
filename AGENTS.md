# claude-config

Herramientas personales para Claude Code, en dos partes separadas:

- **`panel-uso/`**: mod (plugin) con un panel lateral que muestra el contexto de la sesión, los límites de uso, el esfuerzo y el consumo de tokens.
- **`flujos/`**: los flujos `/implementador`, `/implementador-ligero` y `/documentar`, con sus agentes y herramientas. Se instalan copiándolos a `~/.claude` (ver [Flujos](#flujos)).

## Estructura

```
.claude/implementador.json        pasos de verificación para /implementador
flujos/
  instalar.mjs                    copia los flujos a ~/.claude (o los trae con --traer)
  skills/<nombre>/SKILL.md        → ~/.claude/skills/<nombre>/SKILL.md
  agents/<nombre>.md              → ~/.claude/agents/<nombre>.md
  herramientas/                   → ~/.claude/flujos/ (estado, verificar, guardia, comun.md)
panel-uso/
  .claude-plugin/plugin.json      manifiesto (nombre, versión, types)
  .claude-plugin/marketplace.json marketplace «mods-locales»
  hooks/hooks.json                { "modules": ["./register.tsx"] }
  hooks/register.tsx              hooks, estado (atoms) y dibujo del panel
  hooks/semana.ts                 puro: registro de tokens por hora, resumen por modelo·esfuerzo
  hooks/formato.ts                puro: barras, cifras, tiempos, desglose del contexto
  hooks/carpeta.ts                puro: validar la ruta y elegir el comando que abre la carpeta
  types/index.d.ts                tipos y contrato de $.state (PluginState['panel-uso'])
  tests/panel.test.tsx            único archivo de tests
```

`semana.ts`, `formato.ts` y `carpeta.ts` no usan `$`: todo lo que se pueda probar solo va ahí, y `register.tsx` solo conecta.

## Verificar

```
claude plugin validate panel-uso
claude plugin test panel-uso
node --test flujos/herramientas/guardia.test.mjs
```

Los tres tienen que terminar sin errores antes de dar algo por hecho. Los tests del panel simulan el motor (`mock.clock`, `mock.store`, `on('process.run', …)`, `on('session.root', …)`), así que **no prueban** lo visual ni que un proceso real abra una ventana: eso se comprueba a mano con `/reload-plugins`.

## panel-uso

### Qué muestra (de arriba abajo)

1. Botón **Abrir carpeta** (tecla `c`): abre en el explorador la raíz de la sesión (`$.session.root()`).
2. **Contexto**: barra por categorías (como `/context`), lista de partes y «Lo más pesado». El botón **Precisar** (tecla `p`) cambia la estimación local por un conteo exacto con la API, que gasta una petición por herramienta y por archivo de memoria.
3. **Límites de uso**: 5 horas, semanal y de gasto, con el % y la hora de reinicio.
4. **Esfuerzo**: el de la última petición del hilo principal, o el de `settings.json` antes del primer turno.
5. **Esta sesión** y **Esta semana**: tokens por modelo (familia y versión) y esfuerzo, con el total y la salida. Una fila es, por ejemplo, `Opus 5.5 high` (hilo principal) u `Opus 5.5 high · sub` (subagentes): se separan por origen. Debajo de cada fila va una barra con su % de la sección. El esfuerzo se muestra en inglés (`low`, `medium`, `high`, `xhigh`, `max`, o `—` si no hay). «Esta semana» arranca plegada (solo título y total); el botón **Ver / Ocultar** (tecla `s`) la despliega y el panel lo recuerda entre sesiones. Al pulsar «Ver» el panel se desplaza hasta «Esta semana» para que las filas queden a la vista. Con «Esta semana» desplegada, un bloque «por día» muestra una barra y el total de cada uno de los últimos 7 días (por día local). «Esta sesión» no se pliega. El encabezado de cada sección muestra el total y la salida (`14,4M · sal 48k`), suma de todas las filas; en «Esta semana» pasa al pie si no cabe junto al botón. En «Esta sesión» cada fila lleva un ■: verde = esa fila tiene una petición en curso ahora; amarillo = esperando una herramienta (su última respuesta pidió una y aún no empezó la siguiente petición de esa fila); gris = inactiva; solo en la sesión porque cada terminal solo conoce su propia actividad.

La vista `inline` (terminal angosta) es una sola línea: `ctx 42% · 5h 30% (en 2 h) · sem 12% · esfuerzo high`.

### Comandos

- `/uso`: abre el panel.
- `/uso carpeta`: abre la carpeta del proyecto. Funciona sin foco en el panel y sin ratón.

### Datos

- Cada respuesta de la API (hilo principal y subagentes) se anota en `$.store` con la clave `uso:<sessionId>`, una por sesión, para que dos terminales no se pisen.
- El formato es `hora (ms, redondeada a la hora) → clave → [entrada, salida, caché leída, caché escrita]`. La clave es `modelo|esfuerzo` para el hilo principal y `modelo|esfuerzo|sub` para los subagentes; los datos viejos (sin `|sub`) cuentan como principal.
- «Esta semana» suma todas las sesiones desde el inicio de la ventana del límite semanal (`resetsAt − 7 días`), o desde 7 días atrás si no hay límite semanal.
- Al abrir una sesión se borra lo que tenga más de 15 días (`RETENCION_MS`).
- Si «Esta semana» está desplegada se guarda en `prefs:semana` (`true`/`false`). Esa clave está fuera del prefijo `uso:` a propósito, para que la poda y la suma de la semana no la lean como uso.
- Las escrituras al store pasan por una cola (`enFila`), porque hilo principal y subagentes responden a la vez.
- Un tick de 30 s mueve las cuentas regresivas y relee lo que anotaron otras terminales. No llama a ningún modelo.

## Convenciones

- Código, comentarios, nombres y textos de UI en **español** (`medida`, `releerSemana`, «sin respuestas anotadas todavía»). Los términos técnicos y los niveles de esfuerzo quedan en inglés.
- Estilo: sin punto y coma, comillas simples, JSDoc breve en español y una línea en blanco antes de `return`.
- Ningún hook del panel puede romper la sesión: las lecturas y escrituras van en `try/catch` y un fallo deja la sección como estaba.
- Lo que dibuja el panel sale de atoms (`atom` / `read` / `update`). Cada valor nuevo se declara en `types/index.d.ts`, porque `claude plugin validate` lo exige.
- Hotkeys en uso: `p` (Precisar), `c` (Abrir carpeta) y `s` (Ver / Ocultar «Esta semana»).
- Con cada cambio visible se sube `version` en `plugin.json`.

## Trampas conocidas

- **Windows: `$.process.run` lanza los procesos con la ventana oculta** y no hay opción para cambiarlo. `explorer.exe <carpeta>` hereda esa bandera: abre una ventana invisible y termina con exit 1. Por eso `carpeta.ts` usa PowerShell con `Shell.Application.Open`, que le pide la ventana al Explorador que ya corre. Antes cierra las ventanas **ocultas** de esa carpeta, porque `Open` reutilizaría una de ellas y no se vería nada. No es un problema de permisos ni de la terminal: pasa igual en Warp que en otras.
- La ruta del proyecto nunca va como argumento de un proceso ni por un shell. Va solo como `cwd`, y antes se valida con `tipoDeRuta`.
- El `exitCode` del comando de Windows sí sirve como señal de error: si es distinto de 0, el botón avisa con un toast.

## Flujos

El repo es la fuente de verdad: los flujos se editan en `flujos/` y después se instalan.

```
node flujos/instalar.mjs              copia a ~/.claude lo que cambió
node flujos/instalar.mjs --revisar    muestra qué cambiaría, sin copiar
node flujos/instalar.mjs --traer      trae al repo lo que se editó directo en ~/.claude
node flujos/instalar.mjs --forzar     pisa la copia instalada aunque sea más nueva
```

- Si la copia instalada es más nueva que la del repo (alguien la editó en `~/.claude`), `instalar.mjs` la **frena** y termina con exit 1, para no perder ese cambio. Se resuelve con `--traer` o con `--forzar`.
- Nunca borra: un archivo quitado del repo sigue instalado hasta que se borre a mano.
- No toca `~/.claude/flujos/registros/` (bitácoras locales de cada proyecto, no van al repo).
- Los flujos llaman a sus herramientas por la ruta fija `~/.claude/flujos/…`, así que **corren desde la copia instalada**, no desde el repo: un cambio en `flujos/` no rige hasta instalarlo.
## Instalación

El mod está registrado en local como `panel-uso@mods-locales`. Después de editar archivos, `/reload-plugins` lo vuelve a leer desde la carpeta `panel-uso`.

## Flujo con /implementador

`.claude/implementador.json` define la verificación (validate → test). No hay `.claude/implementador.md`, así que rigen las reglas comunes. Para cambios de documentación o pequeños, conviene trabajar directo en vez de usar el flujo completo.

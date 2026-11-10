# QCC

**Q**uorum **C**laude **C**ode: flujos multi-agente y panel de uso para Claude Code.
Un cambio no se da por hecho hasta que varios agentes lo aprueban: el quórum.

Son herramientas personales, en dos partes separadas.

| Parte | Carpeta | Qué es | Documentación |
|---|---|---|---|
| Mod | `qcc-panel/` | Panel lateral con los límites de uso (5 horas, semanal y de gasto) y cuatro pestañas: Inicio (contexto de la sesión y SESIÓN: modelo, esfuerzo y tokens), Flujo (el paso del flujo en curso), Semana (el gasto semanal) e Hist. (historial de flujos de `/impl`). Plugin `panel`, comandos `/panel` y `/panel carpeta`. | [MODS.md](MODS.md) |
| Flujos | `flujos/` | `/impl` (plugin `impl`: explora, planifica, pide aprobación, ejecuta por subtareas y cierra con una revisión final independiente) y `/commit` (plugin `commit`: pregunta si hacer commit + push, solo commit o commit en una rama nueva, y hace un commit por grupo de cambios, todo en Haiku high), con sus agentes y herramientas. | [FLUJOS.md](FLUJOS.md) |

## Comandos

Los flujos son skills de Claude Code: solo corren cuando el usuario escribe el comando, nunca por iniciativa del modelo.

| Comando | Para qué |
|---|---|
| `/impl <qué cambiar>` | Cambios con exploración, plan aprobado por el usuario, ejecución por subtareas, verificación real y revisión final independiente. Un flujo cortado (límite de uso, sesión cerrada, otra cuenta) se sigue con `/impl reanudar` sin perder lo hecho: el cierre suma todas sus sesiones en una sola fila del historial. |
| `/commit [por qué]` | Separa los cambios sin commit en grupos lógicos y hace un commit en español por grupo. Pregunta si hacer commit + push, solo commit o commit en una rama nueva. Es el único camino para hacer commits: ningún flujo ni agente los hace por su cuenta. |
| `/panel` · `/panel carpeta` | Panel de uso del mod; el segundo abre la carpeta del proyecto. |

Para cambios de documentación o pequeños conviene trabajar directo en vez de usar un flujo completo.

## Instalar

Los tres plugins salen del marketplace `qcc` (las carpetas del repo conservan su nombre largo: `qcc-panel/`, `qcc-implementador/`, `qcc-commit/`). Desde la raíz del repo:

```
claude plugin marketplace add <ruta del repo>
claude plugin install panel@qcc
claude plugin install impl@qcc
claude plugin install commit@qcc
```

Detalles del mod en [MODS.md](MODS.md#instalación).

Migración desde las versiones anteriores (el plugin se llamaba `panel-uso` o `qcc-panel`, y los comandos `/implementador`, `/generar-commit` o `/qcc-…`): desinstala los viejos, reinstala los nuevos y limpia lo huérfano de `~/.claude`.

```
claude plugin uninstall panel-uso@mods-locales
claude plugin marketplace remove mods-locales
claude plugin marketplace add <ruta del repo>
claude plugin install panel@qcc
node flujos/instalar.mjs
node flujos/instalar.mjs --limpiar
```

Después de editar el mod, `/reload-plugins` lo vuelve a leer.

Flujos, desde la raíz del repo (detalles y opciones en [FLUJOS.md](FLUJOS.md#instalación)):

```
node flujos/instalar.mjs
```

Los flujos corren desde la copia instalada en `~/.claude`: un cambio en `flujos/` no rige hasta volver a instalarlo. Lo que se edite directo en `~/.claude` se trae al repo con `node flujos/instalar.mjs --traer`.

Esto instala `/impl` y también `/commit` (su skill, su agente y su guardia `solo-git.mjs`).

El instalador acepta `--revisar` (muestra qué cambiaría), `--traer`, `--forzar` y `--limpiar`.

## Verificar

```
claude plugin validate qcc-panel
claude plugin test qcc-panel
node --test "qcc-implementador/herramientas/*.test.mjs"
node --test qcc-commit/herramientas/solo-git.test.mjs
```

Los cuatro comandos tienen que terminar sin errores antes de dar algo por hecho (ver [AGENTS.md](AGENTS.md#verificar)).

## Índice

- [AGENTS.md](AGENTS.md): reglas generales del repo para Claude (estructura, verificación y convenciones).
- [MODS.md](MODS.md): el panel de uso.
- [FLUJOS.md](FLUJOS.md): los flujos (`/impl` y `/commit`).
- [LIMITES.md](LIMITES.md): qué miden los límites de uso de 5 h y semanal, y cómo `/impl` anota el % que gasta cada corrida y cada fase (ya no calcula dólares).
- [comparativa-claude-5-5.md](comparativa-claude-5-5.md): comparativa de Opus, Sonnet y Haiku 5.5 (datos al 15 oct 2026), de referencia para elegir modelo y esfuerzo.
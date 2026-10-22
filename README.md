# QCC

**Q**uorum **C**laude **C**ode: flujos multi-agente y panel de uso para Claude Code.
Un cambio no se da por hecho hasta que varios agentes lo aprueban: el quórum.

Son herramientas personales, en tres partes separadas.

| Parte | Carpeta | Qué es | Documentación |
|---|---|---|---|
| Mod | `qcc-panel/` | Panel lateral con los límites de uso (5 horas, semanal y de gasto) y cuatro pestañas: Inicio (contexto de la sesión, esfuerzo y tokens), Flujo (el paso del flujo en curso), Gasto semanal e Historial de flujos (de `/qcc-implementador` y de `/qcc-implementador-odd`). Comandos `/qcc-panel` y `/qcc-panel carpeta`. | [MODS.md](MODS.md) |
| Flujos | `flujos/` | `/qcc-implementador` (explora, planifica, pide aprobación, ejecuta por subtareas y cierra con una revisión final independiente) y `/qcc-commit` (pregunta si hacer commit + push, solo commit o commit en una rama nueva, y hace un commit por grupo de cambios, todo en Haiku high), con sus agentes y herramientas. | [FLUJOS.md](FLUJOS.md) |
| Flujo odd | `flujos-odd/` | `/qcc-implementador-odd`, en prueba: versión lite inspirada en el ODD de gentle-ai. Implementa inline las tareas chicas, delega las grandes en ejecutores (con un documento `odd/tasks/<feature>.md` para retomarlas) y revisa con un agente independiente solo lo riesgoso. Separado de `flujos/`: skill, agentes, herramientas e instalador propios. | [FLUJOS-ODD.md](FLUJOS-ODD.md) |

## Comandos

Los flujos son skills de Claude Code: solo corren cuando el usuario escribe el comando, nunca por iniciativa del modelo.

| Comando | Para qué |
|---|---|
| `/qcc-implementador <qué cambiar>` | Cambios con exploración, plan aprobado por el usuario, ejecución por subtareas, verificación real y revisión final independiente. |
| `/qcc-implementador-odd <qué cambiar>` | Lo mismo, en versión lite: inline en lo chico, ejecutores en lo grande, revisor solo con riesgo. En prueba. |
| `/qcc-commit [por qué]` | Separa los cambios sin commit en grupos lógicos y hace un commit en español por grupo. Pregunta si hacer commit + push, solo commit o commit en una rama nueva. Es el único camino para hacer commits: ningún flujo ni agente los hace por su cuenta. |
| `/qcc-panel` · `/qcc-panel carpeta` | Panel de uso del mod; el segundo abre la carpeta del proyecto. |

Para cambios de documentación o pequeños conviene trabajar directo en vez de usar un flujo completo.

## Instalar

Mod, desde la raíz del repo (detalles en [MODS.md](MODS.md#instalación)):

```
claude plugin marketplace add <ruta del repo>\qcc-panel
claude plugin install qcc-panel@mods-locales
```

Migración desde la versión anterior (el plugin se llamaba `panel-uso` y los comandos `/implementador` y `/generar-commit`): desinstala el viejo, reinstala desde `qcc-panel/` y limpia lo huérfano de `~/.claude`.

```
claude plugin uninstall panel-uso@mods-locales
claude plugin marketplace remove mods-locales
claude plugin marketplace add <ruta del repo>\qcc-panel
claude plugin install qcc-panel@mods-locales
node flujos/instalar.mjs
node flujos/instalar.mjs --limpiar
```

Después de editar el mod, `/reload-plugins` lo vuelve a leer.

Flujos, desde la raíz del repo (detalles y opciones en [FLUJOS.md](FLUJOS.md#instalación)):

```
node flujos/instalar.mjs
```

Los flujos corren desde la copia instalada en `~/.claude`: un cambio en `flujos/` no rige hasta volver a instalarlo. Lo que se edite directo en `~/.claude` se trae al repo con `node flujos/instalar.mjs --traer`.

Esto instala `/qcc-implementador` y también `/qcc-commit` (su skill, su agente y su guardia `solo-git.mjs`).

Flujo odd, con su propio instalador (detalles en [FLUJOS-ODD.md](FLUJOS-ODD.md#instalación)):

```
node flujos-odd/instalar.mjs
```

Los dos instaladores aceptan `--revisar` (muestra qué cambiaría), `--traer`, `--forzar` y `--limpiar`.

## Verificar

```
claude plugin validate qcc-panel
claude plugin test qcc-panel
node --test flujos/herramientas/guardia.test.mjs
node --test flujos/herramientas/qcc-commit/solo-git.test.mjs
node --test flujos-odd/herramientas/odd.test.mjs
```

Los cinco tienen que terminar sin errores antes de dar algo por hecho (ver [AGENTS.md](AGENTS.md#verificar)).

## Índice

- [AGENTS.md](AGENTS.md): reglas generales del repo para Claude (estructura, verificación y convenciones).
- [MODS.md](MODS.md): el panel de uso.
- [FLUJOS.md](FLUJOS.md): los flujos (`/qcc-implementador` y `/qcc-commit`).
- [FLUJOS-ODD.md](FLUJOS-ODD.md): el flujo `/qcc-implementador-odd`.
- [comparativa-claude-5-5.md](comparativa-claude-5-5.md): comparativa de Opus, Sonnet y Haiku 5.5 (datos al 15 oct 2026), de referencia para elegir modelo y esfuerzo.
- `odd/tasks/`: documentos de feature que deja `/qcc-implementador-odd` en las tareas grandes (specs, tareas, mapa y log), para retomarlas en otra sesión.

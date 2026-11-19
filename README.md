# QCC

**Q**uorum **C**laude **C**ode: flujos multi-agente y panel de uso para Claude Code.
Un cambio no se da por hecho hasta que varios agentes lo aprueban: el quórum.

Son herramientas personales, en cuatro plugins del marketplace `qcc` (`.claude-plugin/marketplace.json`). Las carpetas conservan el nombre largo.

| Plugin | Carpeta | Qué es | Documentación |
|---|---|---|---|
| `panel` | `qcc-panel/` | Mod con un panel lateral: los límites de uso (5 horas, semanal y de gasto) y las pestañas Inicio (contexto de la sesión y SESIÓN: modelo, esfuerzo, tokens y el paso del flujo en curso), Semana (el gasto semanal), Hist. (historial de flujos de `/impl`) y Agentes (los subagentes de la sesión y los archivos que tocaron). | [MODS.md](MODS.md) |
| `impl` | `qcc-implementador/` | `/impl`: explora, planifica, pide aprobación, ejecuta por subtareas y cierra con una revisión final independiente. | [FLUJOS.md](FLUJOS.md) |
| `impl-d` | `qcc-impl-directo/` | `/impl-d:n`: sin plan ni aprobación; la sesión implementa en Opus medium, verifica y cierra con una revisión independiente y el % de los límites que gastó. | [FLUJOS.md](FLUJOS.md#impl-d) |
| `commit` | `qcc-commit/` | `/commit`: pregunta si hacer commit + push, solo commit o commit en una rama nueva, y hace un commit por grupo de cambios, todo en Haiku high. | [FLUJOS.md](FLUJOS.md#commit) |

## Comandos

Los flujos son skills de Claude Code: solo corren cuando el usuario escribe el comando, nunca por iniciativa del modelo.

| Comando | Para qué |
|---|---|
| `/impl <qué cambiar>` | Cambios con exploración, plan aprobado por el usuario, ejecución por subtareas, verificación real y revisión final independiente. Un flujo cortado (límite de uso, sesión cerrada, otra cuenta) se sigue con `/impl reanudar` sin perder lo hecho: el cierre suma todas sus sesiones en una sola fila del historial. Con `/impl -p` no pregunta nada (sirve con `claude -p`): ver [FLUJOS.md](FLUJOS.md#comandos). |
| `/impl-d:n <qué cambiar>` | Cambios sin plan ni aprobación: exploración con Haiku, un asesor Opus que revisa el enfoque antes de editar, la sesión implementa en Opus medium, verificación y revisión independiente en Opus high. El cierre dice el % de la ventana de 5 h y de la semanal que gastó, como `/impl`. Acepta `-p`, igual que `/impl`. Sin carpeta de flujo ni pasos en el panel; cada corrida queda en `registros/impl-d.jsonl`. |
| `/impl-d:e <qué cambiar>` | El modo esfuerzo de `/impl-d`: el mismo flujo con la sesión en Opus high y la revisión en Opus xhigh. |
| `/impl-d:p <qué cambiar>` | El modo paralelo de `/impl-d`, para tareas largas: la sesión reparte el trabajo en frentes que implementan trabajadores Opus medium en paralelo, e integra, verifica y revisa. |
| `/commit [por qué]` | Separa los cambios sin commit en grupos lógicos y hace un commit en español por grupo. Es el único camino para hacer commits: ningún flujo ni agente los hace por su cuenta. |
| `/panel` · `/panel carpeta` | Abre el panel; el segundo abre la carpeta del proyecto. |

Para cambios de documentación o pequeños conviene trabajar directo en vez de usar un flujo completo.

## Instalar

Desde la raíz del repo:

```
claude plugin marketplace add <ruta del repo>
claude plugin install panel@qcc
claude plugin install impl@qcc
claude plugin install impl-d@qcc
claude plugin install commit@qcc
```

Los plugins se leen desde el repo: después de editar uno, `/reload-plugins` lo vuelve a leer. Detalles del panel en [MODS.md](MODS.md#instalación) y de los flujos en [FLUJOS.md](FLUJOS.md#instalación).

Si quedan en `~/.claude` las copias de `/impl` y `/commit` de una instalación por copia, `node qcc-implementador/instalar.mjs` las lista y `--limpiar` las archiva en `~/.claude/_archivo-limpieza-<fecha>/`.

## Verificar

```
claude plugin validate qcc-panel
claude plugin test qcc-panel
node --test "qcc-implementador/herramientas/*.test.mjs"
node --test qcc-commit/herramientas/solo-git.test.mjs
node --test "qcc-impl-directo/herramientas/*.test.mjs"
```

Los cinco comandos tienen que terminar sin errores antes de dar algo por hecho (ver [AGENTS.md](AGENTS.md#verificar)).

## Índice

- [AGENTS.md](AGENTS.md): reglas generales del repo para Claude (estructura, verificación y convenciones).
- [MODS.md](MODS.md): el panel de uso.
- [FLUJOS.md](FLUJOS.md): los flujos (`/impl`, `/impl-d` y `/commit`).
- [LIMITES.md](LIMITES.md): qué miden los límites de uso de 5 h y semanal, y cómo `/impl` anota el % que gasta cada corrida y cada fase.
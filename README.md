# QCC

**Q**uorum **C**laude **C**ode: flujos multi-agente y panel de uso para Claude Code.
Un cambio no se da por hecho hasta que varios agentes lo aprueban: el quórum.

Son herramientas personales, en dos partes separadas.

| Parte | Carpeta | Qué es | Documentación |
|---|---|---|---|
| Mod | `qcc-panel/` | Panel lateral con los límites de uso y cuatro pestañas: Inicio (contexto de la sesión, esfuerzo y tokens), Flujo (el paso del flujo en curso), Gasto semanal e Historial de flujos. Comandos `/uso` y `/uso carpeta`. | [MODS.md](MODS.md) |
| Flujos | `flujos/` | `/qcc-implementador` (explora, planifica, ejecuta por subtareas y cierra con una revisión final independiente) y `/qcc-commit` (mensaje y commit automáticos, en Haiku high), con sus agentes y herramientas. | [FLUJOS.md](FLUJOS.md) |

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

## Verificar

```
claude plugin validate qcc-panel
claude plugin test qcc-panel
node --test flujos/herramientas/guardia.test.mjs
node --test flujos/herramientas/qcc-commit/solo-git.test.mjs
```

Los cuatro tienen que terminar sin errores antes de dar algo por hecho (ver [AGENTS.md](AGENTS.md#verificar)).

## Índice

- [AGENTS.md](AGENTS.md): reglas generales del repo para Claude (estructura, verificación y convenciones).
- [MODS.md](MODS.md): el panel de uso.
- [FLUJOS.md](FLUJOS.md): los flujos (`/qcc-implementador` y `/qcc-commit`).

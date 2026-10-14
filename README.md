# claude-config

Herramientas personales para Claude Code, en dos partes separadas.

| Parte | Carpeta | Qué es | Documentación |
|---|---|---|---|
| Mod | `panel-uso/` | Panel lateral con el contexto de la sesión, los límites de uso, el esfuerzo, el consumo de tokens y el paso del flujo en curso. Comando `/uso`. | [MODS.md](MODS.md) |
| Flujos | `flujos/` | Los flujos `/implementador` y `/documentar`, con sus agentes y herramientas. | [FLUJOS.md](FLUJOS.md) |

## Instalar

Mod, desde la raíz del repo (detalles en [MODS.md](MODS.md#instalación)):

```
claude plugin marketplace add <ruta del repo>\panel-uso
claude plugin install panel-uso@mods-locales
```

Flujos, desde la raíz del repo (detalles en [FLUJOS.md](FLUJOS.md#instalación)):

```
node flujos/instalar.mjs
```

## Verificar

Los comandos de verificación del mod y de la guardia de los flujos están en [AGENTS.md](AGENTS.md#verificar); tienen que terminar sin errores antes de dar algo por hecho.

## Índice

- [AGENTS.md](AGENTS.md): reglas generales del repo para Claude (estructura, verificación y convenciones).
- [MODS.md](MODS.md): el panel de uso.
- [FLUJOS.md](FLUJOS.md): los flujos.

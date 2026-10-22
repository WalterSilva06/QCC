## Clasificación

CRÍTICO, además de lo que diga `plan.md` §2: las rutas críticas de este repo están en `.claude/qcc-implementador.json` (o, de respaldo, `.claude/implementador.json`) → `criticos`, cada una con su criterio y su motivo. Una subtarea que toca una es `Crítica: sí` y el plan cita su criterio; `estado.mjs --guardar … plan` avisa si falta. Las reglas y la config de este flujo se tocan solo si el pedido lo dice.

- **#6 además:** cualquier cambio en la forma de un atom que sobrevive a `/reload-plugins` (`flujo`, `filasExploradores`, y los tipos de `qcc-panel/types/index.d.ts`). Un flujo guardado con la forma anterior sigue vivo tras recargar.
- **Excepción en `flujos/**`:** los `.md` de `flujos/agents/` son `Crítica: no` si no cambian su frontmatter (herramientas, modelo), y `flujos/herramientas/config.ejemplo.md`, siempre `no`; ante la duda, `sí`. Quedan siempre `Crítica: sí`: `comun.md`, `plan.md`, `pasos.md`, `SKILL.md` (tabla de overrides y líneas `!`), cualquier `.mjs`, `.claude/qcc-implementador/`, `.claude/qcc-implementador.json` y sus nombres viejos `.claude/implementador/` y `.claude/implementador.json`. La Clasificación del plan sigue citando #1 y #5 (la revisión final Opus tiene 2 ciclos).

Sin criterios: textos, colores y anchos del panel, funciones puras de `formato.ts` y `semana.ts` con tests, FLUJOS.md, MODS.md, README, AGENTS.md.

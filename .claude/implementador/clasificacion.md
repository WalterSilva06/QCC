## Clasificación

CRÍTICO, además de lo que diga `plan.md` §2: una subtarea que toca alguna de estas rutas es `Crítica: sí`, y el plan cita su criterio.

| Ruta | Criterio | Por qué |
|---|---|---|
| `flujos/**` (skills, agentes, `estado.mjs`, `verificar.mjs`, `guardia.mjs`, `guardia.test.mjs`, `instalar.mjs`, `comun.md`, `plan.md`, `pasos.md`), salvo la excepción de abajo | #1 y #5 | `guardia.mjs` es la seguridad de los subagentes; lo demás lo usan todos los proyectos del usuario |
| `.claude/implementador/`, `.claude/implementador.json` | #1 | reglas y config de este flujo (`guardia` en el JSON afloja o aprieta la guardia); solo si el pedido lo dice |
| `panel-uso/hooks/flujo.ts` | #6 | máquina de estado del flujo, tiempos y esperas |
| `panel-uso/hooks/register.tsx` | #7 | hooks que envuelven `next` (`tool.call`, `turn.step`, `turn.complete`, `skill.prompt`): un fallo frena una petición al modelo o una herramienta |

- **#6 además:** cualquier cambio en la forma de un atom que sobrevive a `/reload-plugins` (`flujo`, `filasExploradores`, y los tipos de `panel-uso/types/index.d.ts`). Un flujo guardado con la forma anterior sigue vivo tras recargar.
- **Excepción en `flujos/**`:** una subtarea cuyos archivos permitidos son solo `.md` de `flujos/agents/` o `flujos/herramientas/config.ejemplo.md` es `Crítica: no` si no cambia su frontmatter (herramientas, modelo); ante la duda, `sí`. Quedan siempre `Crítica: sí`: `comun.md`, `plan.md`, `pasos.md`, `SKILL.md` (tabla de overrides y líneas `!`), cualquier `.mjs`, `.claude/implementador/` y `.claude/implementador.json`. La Clasificación del plan sigue citando #1 y #5 (el revisor del plan corre y la revisión final Opus tiene 2 ciclos).

Sin criterios: textos, colores y anchos del panel, funciones puras de `formato.ts` y `semana.ts` con tests, FLUJOS.md, MODS.md, README, AGENTS.md.

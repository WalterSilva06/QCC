# Reglas de /implementador para claude-config

Valen para `/implementador` en este repo. Mandan sobre `~/.claude/flujos/comun.md`. Salen de corridas reales (12-oct): cada regla cita lo que la motivó.

## Clasificación

CRÍTICO, además de lo que diga `comun.md` §2: una subtarea que toca alguna de estas rutas es `Crítica: sí`, y el plan cita su criterio.

| Ruta | Criterio | Por qué |
|---|---|---|
| `flujos/**` (skills, agentes, `estado.mjs`, `verificar.mjs`, `guardia.mjs`, `guardia.test.mjs`, `instalar.mjs`, `comun.md`, `pasos.md`) | #1 y #5 | `guardia.mjs` es la seguridad de los subagentes; lo demás lo usan todos los proyectos del usuario |
| `panel-uso/hooks/flujo.ts` | #6 | máquina de estado del flujo, tiempos y esperas |
| `panel-uso/hooks/register.tsx` | #7 | hooks que envuelven `next` (`tool.call`, `turn.step`, `turn.complete`, `skill.prompt`): un fallo frena una petición al modelo o una herramienta |

No son rutas críticas (documentación): `FLUJOS.md`, `MODS.md` y `README.md`.

- **#6 además:** cualquier cambio en la forma de un atom que sobrevive a `/reload-plugins` (`flujo`, `filasExploradores`, y los tipos de `panel-uso/types/index.d.ts`). Un flujo guardado con la forma anterior sigue vivo tras recargar. Motivo: una corrida de `/implementador-ligero` (antes de los modos) dejó el panel entero sin dibujo con un atom 0.9.3 y solo lo vio el revisor.

Sin criterios: textos, colores y anchos del panel, funciones puras de `formato.ts` y `semana.ts` con tests, FLUJOS.md, MODS.md, README, AGENTS.md.

## Cómo buscar

- El mod entero son `panel-uso/hooks/*.ts(x)`, `panel-uso/types/index.d.ts` y un único `panel-uso/tests/panel.test.tsx` de más de 3000 líneas: léelo por tramos con Grep y `offset`, no entero.
- Los tipos de `claude-code` no están en el repo (no hay `node_modules`): no los busques; lo que haga cada evento está en MODS.md.
- Los flujos se editan en `flujos/` y se instalan en `~/.claude` con `node flujos/instalar.mjs`. No leas ni edites `~/.claude`: el repo es la fuente.

## Plan

- Todo cambio visible sube `version` en `panel-uso/.claude-plugin/plugin.json` y actualiza MODS.md; es una subtarea de documentación, no un extra.
- Un campo nuevo en un atom es opcional, se lee con `?? 0` (o equivalente) y solo se escribe cuando hay algo que anotar: un valor neutro (`0`, `{}`, `null`) rompe los `toEqual` de los tests.
- Una subtarea que toca estado compartido entre hooks y además tests nuevos con el motor simulado se parte en lógica pura (`flujo.ts`, `semana.ts`, `formato.ts`) y dibujo (`register.tsx`). La que se hizo junta tardó 14 min y 65 de 80 turnos.
- Queda para el usuario: la comprobación visual con `/reload-plugins` a 49 columnas (y a 32), y `node flujos/instalar.mjs` si cambió algo de `flujos/`.

## Ejecutor

- `claude plugin test panel-uso` corre todo en unos 10 s y no filtra por nombre: acota la salida con una tubería (`| grep …`), sin redirigirla a un archivo (la guardia lo niega).
- Estilo de AGENTS.md: español, sin punto y coma, comillas simples, JSDoc breve y línea en blanco antes de `return` en `panel-uso/`.

## Revisor: rechaza también por

- Un atom o un tipo que cambia de forma sin tolerar la forma anterior (flujos de las versiones 0.9.3 en adelante siguen vivos tras `/reload-plugins`).
- Un test existente relajado o convertido para que pase (`toEqual` → `toMatchObject`, un assert acotado a algo que ya no comprueba lo mismo).
- Un hook que traga o cambia el error de `next`, o que puede frenar la petición al modelo.
- Un cambio visible sin subir `version` o sin tocar MODS.md.

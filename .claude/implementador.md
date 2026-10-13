# Reglas de /implementador para claude-config

Valen para `/implementador` en sus dos modos (normal y ligero) en este repo. Mandan sobre `~/.claude/flujos/comun.md`. Salen de corridas reales (12-oct): cada regla cita lo que la motivó.

## Clasificación

CRÍTICO, además de lo que diga `comun.md` §2:

- **#6 Estado y tiempo:** `panel-uso/hooks/flujo.ts` (máquina de estado del flujo, tiempos, esperas) y cualquier cambio en la forma de un atom que sobrevive a `/reload-plugins` (`flujo`, `filasExploradores`, y los tipos de `panel-uso/types/index.d.ts`). Un flujo guardado con la forma anterior sigue vivo tras recargar. Motivo: una corrida de `/implementador-ligero` (antes de los modos) dejó el panel entero sin dibujo con un atom 0.9.3 y solo lo vio el revisor.
- **#7 Frontera de ejecución:** los hooks que envuelven `next` en `panel-uso/hooks/register.tsx` (`tool.call`, `turn.step`, `turn.complete`, `skill.prompt`). Un fallo ahí frena una petición al modelo o una herramienta.
- **#1 y #5 Los flujos mismos:** `flujos/herramientas/guardia.mjs` (seguridad), y `estado.mjs`, `verificar.mjs`, las skills y los agentes (los usan todos los proyectos del usuario, no solo este).

Sin criterios (el modo ligero se recomienda si además cabe en ≤ 3 subtareas y ≤ 6 archivos): textos, colores y anchos del panel, funciones puras de `formato.ts` y `semana.ts` con tests, MODS.md, README, AGENTS.md.

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
